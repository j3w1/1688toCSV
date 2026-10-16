import {
  message as uiMessage,
  bindText,
  bindAttribute,
  isMessage,
  t,
  getLocale,
  getLanguage,
  onLanguageChange,
  attributeMessage,
} from './i18n.js'
import {
  LABEL_FIELDS,
  normalizeLabel,
  normalizeLabelSettings,
  renderLabel,
} from './labels.js'

let nextEditorId = 0

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (isMessage(text)) bindText(node, text)
  else if (text) node.textContent = text
  return node
}

/** Fixed-position text editing; grouping, numbering and persistence remain with the caller. */
export function mountLabelEditor(container, options) {
  const editorId = ++nextEditorId
  let model = { ...options.model }
  let committed = { ...model }
  let settings = options.settings
  let logoUrl = options.logoUrl
  let latest = null
  let previewUrl = null
  let previewController = null
  let previewVersion = 0
  let revision = 0
  let timer = null
  let copiedTimer = null
  let pendingCommit = null
  let destroyed = false
  let ready = false
  let codeParts = null
  let composedCode = null
  let validationError = null
  const inputs = new Map()
  const dialog = container.closest('dialog')
  const dismiss = async (event) => {
    // Backdrop focus changes use the same save path as ordinary field blur.
    // Keep the editor mounted until that save completes, or show its error.
    if (!dirty() && !pendingCommit) return
    event.preventDefault()
    if (await commit()) {
      if (!destroyed && dialog?.open) dialog.close()
    }
  }
  dialog?.addEventListener('cancel', dismiss)
  const root = element('section', 'label-editor')
  const preview = element('div', 'label-editor-preview')
  const image = element('img', 'label-editor-image')
  bindAttribute(image, 'alt', uiMessage('Printable label preview'))
  image.hidden = true
  const hint = element(
    'p',
    'label-editor-hint',
    uiMessage('Click a label field to edit. Enter saves; Escape cancels.')
  )
  const status = element('p', 'label-editor-status')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.id = `label-status-${editorId}`
  const resolve = element(
    'button',
    'label-editor-resolve',
    uiMessage('Resolve code')
  )
  resolve.type = 'button'
  resolve.hidden = true
  const copy = element('button', 'label-editor-copy', uiMessage('Copy label'))
  copy.type = 'button'
  copy.disabled = true
  preview.append(image)
  root.append(preview, hint, status, resolve, copy)
  container.append(root)

  function message(value, error = false) {
    bindText(status, isMessage(value) ? value : uiMessage(value))
    status.classList.toggle('label-editor-error', error)
  }

  function issue(error = null) {
    validationError = error
    resolve.hidden = !error?.conflict || !options.onResolve
    for (const [key, input] of inputs) {
      const invalid = Boolean(
        error && ['code', 'variantSuffix', 'sizeSuffix'].includes(key)
      )
      if (invalid) {
        input.setAttribute('aria-invalid', 'true')
        input.setAttribute('aria-errormessage', status.id)
      } else {
        input.removeAttribute('aria-invalid')
        input.removeAttribute('aria-errormessage')
      }
    }
    if (error) message(error.message, true)
  }

  function resetCopied() {
    clearTimeout(copiedTimer)
    bindText(copy, uiMessage('Copy label'))
    copy.classList.remove('copied')
  }

  function dirty() {
    return (
      [...inputs.keys()].some((key) => model[key] !== committed[key]) ||
      model.needsSizeMapping !== committed.needsSizeMapping
    )
  }

  function structuredCode() {
    return model.kind === 'barcode' && typeof model.baseCode === 'string'
  }

  function printableModel() {
    if (structuredCode()) {
      if (model.needsSizeMapping)
        throw new Error('Choose a size code before copying this label.')
      if (!/^[A-Z]*$/.test(model.variantSuffix))
        throw new Error('Variant code uses letters only, such as A or AB.')
      if (!/^[A-Z0-9]*$/.test(model.sizeSuffix))
        throw new Error('Size code uses letters or numbers, such as S or 300.')
    }
    return normalizeLabel(model)
  }

  function updateCodeParts() {
    if (!codeParts) return
    model.code = `${model.baseCode}${model.variantSuffix}${model.sizeSuffix}`
    composedCode.value = model.code
    // Fit the editing strip to the same fixed code area without distorting the
    // printable barcode. Empty endings retain a visible, keyboard-focusable slot.
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    context.font = '700 100px Arial'
    let units = context.measureText(model.baseCode).width / 100
    for (const key of ['variantSuffix', 'sizeSuffix']) {
      const input = inputs.get(key)
      const width = Math.max(
        1.2,
        context.measureText(model[key] || '+').width / 100 + 0.25
      )
      input.style.width = `${width}em`
      units += width
    }
    const normalized = normalizeLabelSettings(settings).barcode
    const maximum =
      ((12 * normalized.heightMm) / normalized.widthMm) * normalized.textScale
    codeParts.style.fontSize = `${Math.min(maximum, 52 / (units + 0.6))}cqw`
    canvas.width = canvas.height = 0
  }

  function controls(disabled) {
    // Preserve keyboard focus so Escape still reaches the field during a save.
    for (const input of inputs.values()) input.readOnly = disabled
    copy.disabled = disabled || !ready
  }

  async function previewNow() {
    clearTimeout(timer)
    previewController?.abort()
    previewController = new AbortController()
    const version = ++previewVersion
    ready = false
    copy.disabled = true
    message(
      uiMessage('Preparing label…{0}', {
        0: dirty() ? uiMessage(' · Unsaved text') : '',
      })
    )
    try {
      const normalized = printableModel()
      // Check reservations without issuing a code or disturbing the active field.
      await options.onValidate?.({ ...model, ...normalized })
      if (destroyed || version !== previewVersion) return null
      issue()
      const result = await renderLabel({
        ...normalized,
        settings,
        logoUrl,
        signal: previewController.signal,
      })
      if (destroyed || version !== previewVersion) return null
      const nextUrl = URL.createObjectURL(result.blob)
      image.src = nextUrl
      image.hidden = false
      preview.dataset.ready = 'true'
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      previewUrl = nextUrl
      latest = { result, model: { ...model, ...normalized } }
      ready = true
      copy.disabled = Boolean(pendingCommit)
      if (!pendingCommit)
        message(
          uiMessage('{0} × {1} mm · {2} dpi{3}', {
            0: result.widthMm,
            1: result.heightMm,
            2: result.dpi,
            3: dirty() ? uiMessage(' · Unsaved text') : '',
          })
        )
      return latest
    } catch (error) {
      if (
        destroyed ||
        version !== previewVersion ||
        error.name === 'AbortError'
      )
        return null
      issue(error)
      copy.disabled = true
      return null
    }
  }

  function queuePreview() {
    resetCopied()
    clearTimeout(timer)
    previewController?.abort()
    previewVersion++
    ready = false
    copy.disabled = true
    message(
      uiMessage('Updating preview…{0}', {
        0: dirty() ? uiMessage(' · Unsaved text') : '',
      })
    )
    timer = setTimeout(() => void previewNow(), 150)
  }

  function syncValues() {
    for (const [key, input] of inputs) input.value = model[key] ?? ''
    updateCodeParts()
  }

  async function commit() {
    if (pendingCommit) return pendingCommit
    if (!dirty()) return true
    const epoch = ++revision
    try {
      const next = { ...model, ...printableModel() }
      const operation = async () => {
        // Expose the in-flight operation before locking fields and rendering.
        await Promise.resolve()
        try {
          controls(true)
          // Validate printable text before an allocator/persistence mutation.
          const checked = await previewNow()
          if (!checked || destroyed || epoch !== revision) return false
          message(uiMessage('Saving label…'))
          const saved = await options.onCommit?.(next)
          if (destroyed || epoch !== revision) return false
          model = { ...(saved || next) }
          committed = { ...model }
          syncValues()
          const result = await previewNow()
          if (result)
            message(
              uiMessage('{0} × {1} mm · {2} dpi', {
                0: result.result.widthMm,
                1: result.result.heightMm,
                2: result.result.dpi,
              })
            )
          return Boolean(result)
        } catch (error) {
          if (!destroyed && epoch === revision) issue(error)
          return false
        } finally {
          pendingCommit = null
          if (!destroyed) {
            controls(false)
            // A failed save must not enable a copy that appears to be committed.
            if (
              dirty() ||
              !ready ||
              Object.keys(LABEL_FIELDS[model.kind] || {}).some(
                (key) => latest.model[key] !== model[key]
              )
            )
              copy.disabled = true
          }
        }
      }
      pendingCommit = operation()
      return pendingCommit
    } catch (error) {
      issue(error)
      copy.disabled = true
      return false
    }
  }

  async function resetDraft() {
    // A write already sent cannot be cancelled. Restore the last accepted value
    // after it settles, retaining a successful save or discarding a rejected draft.
    if (pendingCommit) await pendingCommit
    if (destroyed) return
    resetCopied()
    revision++
    model = { ...committed }
    syncValues()
    void previewNow()
  }

  function buildFields() {
    for (const input of inputs.values()) input.remove()
    inputs.clear()
    codeParts?.remove()
    composedCode?.closest('.label-code-guide')?.remove()
    codeParts = null
    composedCode = null
    const kind = model.kind
    const fields = LABEL_FIELDS[kind]
    if (!fields) throw new Error('Choose a barcode or shipping mark')
    preview.dataset.kind = kind
    const normalizedSettings = normalizeLabelSettings(settings)
    preview.style.aspectRatio = `${normalizedSettings[kind].widthMm} / ${normalizedSettings[kind].heightMm}`
    for (const [key, box] of Object.entries(fields)) {
      if (key === 'code' && structuredCode()) {
        buildCodeParts(box)
        continue
      }
      const input = element('input', `label-editor-field label-editor-${key}`)
      input.type = 'text'
      input.autocomplete = 'off'
      input.spellcheck = false
      input.setAttribute('autocorrect', 'off')
      bindAttribute(
        input,
        'aria-label',
        key === 'code'
          ? kind === 'mark'
            ? uiMessage('Base CE code')
            : uiMessage('Barcode code')
          : key === 'category'
            ? uiMessage('Chinese category')
            : uiMessage('Spanish product name')
      )
      bindAttribute(
        input,
        'title',
        uiMessage('{0} — Enter saves, Escape restores', {
          0: attributeMessage(input, 'aria-label'),
        })
      )
      bindAttribute(input, 'placeholder', attributeMessage(input, 'aria-label'))
      input.style.left = `${box[0] * 100}%`
      input.style.top = `${box[1] * 100}%`
      input.style.width = `${box[2] * 100}%`
      input.style.height = `${box[3] * 100}%`
      input.maxLength =
        key === 'spanishName' ? 80 : key === 'category' ? 30 : 40
      input.addEventListener('input', () => {
        model = { ...model, [key]: input.value }
        revision++
        queuePreview()
      })
      input.addEventListener('keydown', async (event) => {
        if (event.isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          void commit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          await resetDraft()
          if (!destroyed) input.blur()
        }
      })
      input.addEventListener('blur', () => void commit())
      inputs.set(key, input)
      preview.append(input)
    }
    syncValues()
  }

  function buildCodeParts(box) {
    codeParts = element('div', 'label-editor-code-parts')
    codeParts.style.left = `${box[0] * 100}%`
    codeParts.style.top = `${box[1] * 100}%`
    codeParts.style.width = `${box[2] * 100}%`
    codeParts.style.height = `${box[3] * 100}%`
    const strip = element('div', 'label-code-strip')
    const base = element('span', 'label-code-base', model.baseCode)
    bindAttribute(
      base,
      'title',
      uiMessage('Product code · edit on the carton mark')
    )
    strip.append(base)
    for (const [key, title] of [
      ['variantSuffix', 'Variant code'],
      ['sizeSuffix', 'Size code'],
    ]) {
      const input = element('input', `label-code-part label-code-${key}`)
      input.type = 'text'
      bindAttribute(input, 'aria-label', title)
      bindAttribute(
        input,
        'title',
        uiMessage('{0} · leave empty if not needed · Enter saves', {
          0: uiMessage(title),
        })
      )
      input.autocomplete = 'off'
      input.setAttribute('autocorrect', 'off')
      input.spellcheck = false
      input.maxLength = 30
      input.placeholder = '+'
      input.addEventListener('input', () => {
        model[key] = input.value.toUpperCase()
        if (key === 'sizeSuffix') model.needsSizeMapping = false
        updateCodeParts()
        revision++
        queuePreview()
      })
      input.addEventListener('keydown', async (event) => {
        if (event.isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          void commit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          await resetDraft()
          if (!destroyed) input.blur()
        }
      })
      input.addEventListener('blur', () => void commit())
      inputs.set(key, input)
      strip.append(input)
    }
    codeParts.append(strip)
    preview.append(codeParts)
    const guide = element('div', 'label-code-guide')
    guide.append(
      element('span', 'label-code-base-key', uiMessage('Product code'))
    )
    for (const [key, title] of [
      ['variantSuffix', 'Variant'],
      ['sizeSuffix', 'Size'],
    ]) {
      const label = element(
        'label',
        `label-code-key label-code-key-${key}`,
        uiMessage(title)
      )
      const input = inputs.get(key)
      input.id = `label-${key}-${editorId}`
      label.htmlFor = input.id
      guide.append(label)
    }
    composedCode = element('output', 'label-composed-code')
    bindAttribute(composedCode, 'aria-label', uiMessage('Barcode code'))
    guide.append(composedCode)
    hint.before(guide)
    bindText(
      hint,
      uiMessage(
        'Edit Variant or Size on the black band. Leave + empty when not needed. Enter saves; Escape cancels.'
      )
    )
  }

  copy.addEventListener('pointerdown', (event) => {
    // Let click commit the focused draft. Blurring first can disable this button
    // while saving and prevent the browser from dispatching the click at all.
    if (event.button === 0) event.preventDefault()
  })
  resolve.addEventListener('pointerdown', (event) => {
    if (event.button === 0) event.preventDefault()
  })
  resolve.addEventListener('click', async () => {
    if (!validationError || resolve.disabled) return
    resolve.disabled = true
    try {
      const next = await options.onResolve(validationError, { ...model })
      if (!next || destroyed) return
      model = { ...next }
      committed = { ...model }
      revision++
      syncValues()
      await previewNow()
    } catch (error) {
      if (!destroyed) issue(error)
    } finally {
      resolve.disabled = false
    }
  })
  copy.addEventListener('click', async () => {
    resetCopied()
    try {
      if (!(await commit()) || destroyed) return
      const copiedRevision = revision
      const current = await previewNow()
      if (!current || destroyed) return
      copy.disabled = true
      bindText(copy, uiMessage('Copying…'))
      if (options.onCopy) await options.onCopy(current.result, current.model)
      else
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': current.result.blob }),
        ])
      if (!destroyed && copiedRevision === revision) {
        bindText(copy, uiMessage('Copied'))
        copy.classList.add('copied')
        copiedTimer = setTimeout(resetCopied, 3000)
        message(uiMessage('Copied'))
      }
    } catch (error) {
      if (!destroyed) {
        resetCopied()
        message(error.message || 'The label could not be copied', true)
      }
    } finally {
      if (!destroyed) copy.disabled = !ready || dirty()
    }
  })

  try {
    buildFields()
    void previewNow()
  } catch (error) {
    message(error.message, true)
  }

  return {
    update(next) {
      if (destroyed) return
      resetCopied()
      revision++
      if (next.model) {
        model = { ...next.model }
        committed = { ...model }
      }
      if ('settings' in next) settings = next.settings
      if ('logoUrl' in next) logoUrl = next.logoUrl
      try {
        buildFields()
        void previewNow()
      } catch (error) {
        message(error.message, true)
        ready = false
        copy.disabled = true
      }
    },
    getLatestValidRender: () =>
      latest ? { ...latest.result, model: { ...latest.model } } : null,
    destroy() {
      destroyed = true
      dialog?.removeEventListener('cancel', dismiss)
      revision++
      previewVersion++
      clearTimeout(timer)
      clearTimeout(copiedTimer)
      previewController?.abort()
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      root.remove()
    },
  }
}
