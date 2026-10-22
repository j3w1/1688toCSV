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
  labelCodeLayout,
  normalizeLabel,
  normalizeLabelSettings,
  renderLabel,
} from './labels.js'
import { showErrorNotice, clearErrorNotice } from './error-notice.js'
import { applyCodeDesign } from './code-design.js'
import { setCodeText } from './code-display.js'
import { decorateIcon } from './icons.js'
import { copied, resetCopyFeedback } from './ui.js'

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
  let pendingCommit = null
  let copyInProgress = false
  let destroyed = false
  let ready = false
  let codeParts = null
  let codeFieldBand = null
  let composedCode = null
  let validationError = null
  const inputs = new Map()
  const dialog = container.closest('dialog')
  const errorScope = dialog || container
  const errorKey = `label:${editorId}`
  const dismiss = async (event) => {
    // Backdrop focus changes use the same save path as ordinary field blur.
    // Keep the editor mounted until that save completes, or show its error.
    if (!dirty() && !pendingCommit) return
    event.preventDefault()
    clearErrorNotice({ scope: errorScope, key: errorKey })
    if (await commit()) {
      if (!destroyed && dialog?.open) dialog.close()
    }
  }
  dialog?.addEventListener('cancel', dismiss)
  const root = element('section', 'label-editor')
  applyCodeDesign(root)
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
  const errorDescription = element('span', 'code-error-description')
  errorDescription.id = `label-error-${editorId}`
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
  decorateIcon(copy, 'copy')
  const actions = element('div', 'label-editor-actions')
  actions.append(copy, status, resolve)
  const actionHost = dialog?.querySelector('.label-dialog-tools')
  if (actionHost) actionHost.append(actions)
  else root.append(actions)
  preview.append(image)
  root.append(preview, hint, errorDescription)
  container.append(root)

  function message(value, error = false) {
    bindText(
      status,
      error
        ? uiMessage(
            validationError?.conflict ? 'Code conflict' : 'Could not complete'
          )
        : isMessage(value)
          ? value
          : uiMessage(value)
    )
    status.classList.toggle('label-editor-error', error)
    if (error) {
      bindText(errorDescription, isMessage(value) ? value : uiMessage(value))
      showErrorNotice(value, {
        scope: errorScope,
        key: errorKey,
        deduplicate: true,
        title: dirty() ? 'Not saved' : 'Could not complete',
        detail: dirty() ? 'Your edits are still here.' : '',
        action:
          validationError?.conflict && options.onResolve
            ? { label: 'Resolve', onClick: () => resolve.click() }
            : undefined,
      })
    }
  }

  function issue(error = null) {
    if (error) invalidatePreview()
    validationError = error
    resolve.hidden = !error?.conflict || !options.onResolve
    for (const [key, input] of inputs) {
      const field = error?.packingIssue?.field
      const invalid = Boolean(
        error &&
        (field === 'size'
          ? key === 'sizeSuffix'
          : field === 'variant'
            ? key === 'variantSuffix'
            : ['code', 'variantSuffix', 'sizeSuffix'].includes(key))
      )
      if (invalid) {
        input.setAttribute('aria-invalid', 'true')
        input.setAttribute('aria-errormessage', errorDescription.id)
      } else {
        input.removeAttribute('aria-invalid')
        input.removeAttribute('aria-errormessage')
      }
    }
    if (error) message(error.message, true)
    else clearErrorNotice({ scope: errorScope, key: errorKey })
  }

  function resetCopied() {
    resetCopyFeedback(copy)
    bindText(copy, uiMessage('Copy label'))
    decorateIcon(copy, 'copy')
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

  function updateCodeLayout() {
    const codeInput = inputs.get('code')
    if (!codeParts && !codeInput) return
    if (codeParts) {
      model.code = `${model.baseCode}${model.variantSuffix}${model.sizeSuffix}`
      setCodeText(composedCode, model.code)
    }
    // Use the same glyph geometry as the PNG. Empty ending controls sit beside
    // the printed band, so a placeholder never shifts the visible CE code.
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    try {
      const normalized = normalizeLabelSettings(settings)
      const dimensions = normalized[model.kind]
      const width = Math.round((dimensions.widthMm * normalized.dpi) / 25.4),
        height = Math.round((dimensions.heightMm * normalized.dpi) / 25.4)
      const layout = labelCodeLayout(
        context,
        { ...model, code: String(model.code || '').toUpperCase() },
        normalized,
        width,
        height
      )
      const unit = (value) => `${(100 * value) / width}cqw`
      if (codeInput) {
        codeFieldBand.style.left = `${(100 * layout.band[0]) / width}%`
        codeFieldBand.style.top = `${(100 * layout.band[1]) / height}%`
        codeFieldBand.style.width = `${(100 * layout.band[2]) / width}%`
        codeFieldBand.style.height = `${(100 * layout.band[3]) / height}%`
        codeFieldBand.style.borderRadius = unit(layout.radius)
        codeInput.style.left = unit(layout.textX - layout.band[0])
        codeInput.style.top = unit(layout.box[1] - layout.band[1])
        codeInput.style.width = unit(layout.advanceWidth + 2)
        codeInput.style.height = unit(layout.box[3])
        codeInput.style.fontSize = unit(layout.fontSize)
        codeInput.style.setProperty(
          '--code-input-shift',
          unit(layout.inputShift)
        )
        return
      }
      const strip = codeParts.querySelector('.label-code-strip')
      const base = codeParts.querySelector('.label-code-base')
      codeParts.style.fontSize = unit(layout.fontSize)
      codeParts.style.setProperty('--code-input-shift', unit(layout.inputShift))
      codeParts.style.setProperty(
        '--code-band-inset',
        unit(layout.band[1] - layout.box[1])
      )
      strip.style.left = `${(100 * (layout.band[0] - layout.box[0])) / layout.box[2]}%`
      strip.style.top = `${(100 * (layout.band[1] - layout.box[1])) / layout.box[3]}%`
      strip.style.width = `${(100 * layout.band[2]) / layout.box[2]}%`
      strip.style.height = `${(100 * layout.band[3]) / layout.box[3]}%`
      strip.style.paddingLeft = unit(layout.textX - layout.band[0])
      strip.style.paddingRight = unit(
        layout.band[0] + layout.band[2] - layout.textX - layout.advanceWidth
      )
      strip.style.borderRadius = unit(layout.radius)
      context.font = layout.font
      context.fontKerning = 'none'
      base.style.width = unit(context.measureText(model.baseCode).width)
      const empty = ['variantSuffix', 'sizeSuffix'].filter((key) => !model[key])
      const slotWidth = layout.fontSize * 0.9,
        gap = Math.max(1, normalized.dpi / 300)
      const after =
        layout.band[0] + layout.band[2] + gap + empty.length * slotWidth <=
        width - width * 0.015
      let slotLeft = after
        ? layout.band[2] + gap
        : -gap - empty.length * slotWidth
      for (const key of ['variantSuffix', 'sizeSuffix']) {
        const input = inputs.get(key)
        input.style.height = unit(layout.box[3])
        input.style.marginTop = unit(layout.box[1] - layout.band[1])
        input.classList.toggle('label-code-empty', !model[key])
        input.style.width = unit(
          model[key] ? context.measureText(model[key]).width : slotWidth
        )
        if (!model[key]) {
          input.style.left = unit(slotLeft)
          slotLeft += slotWidth
        } else input.style.removeProperty('left')
      }
    } catch {
      // Keep the editable controls mounted for invalid/overlong drafts. The
      // normal preview validation supplies its actionable error description.
    } finally {
      canvas.width = canvas.height = 0
    }
  }

  function controls(disabled) {
    // Preserve keyboard focus so Escape still reaches the field during a save.
    for (const input of inputs.values()) input.readOnly = disabled
    copy.disabled = disabled || !ready || copyInProgress
  }

  function invalidatePreview() {
    clearTimeout(timer)
    previewController?.abort()
    previewVersion++
    ready = false
    latest = null
    image.hidden = true
    image.removeAttribute('src')
    delete preview.dataset.ready
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    previewUrl = null
    copy.disabled = true
  }

  async function previewNow() {
    invalidatePreview()
    previewController = new AbortController()
    const version = previewVersion
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
      previewUrl = nextUrl
      latest = { result, model: { ...model, ...normalized } }
      ready = true
      copy.disabled = Boolean(pendingCommit) || copyInProgress
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
      return null
    }
  }

  function queuePreview() {
    clearErrorNotice({ scope: errorScope, key: errorKey })
    resetCopied()
    invalidatePreview()
    message(
      uiMessage('Updating preview…{0}', {
        0: dirty() ? uiMessage(' · Unsaved text') : '',
      })
    )
    timer = setTimeout(() => void previewNow(), 150)
  }

  function syncValues() {
    for (const [key, input] of inputs) input.value = model[key] ?? ''
    updateCodeLayout()
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
    codeFieldBand?.remove()
    composedCode?.closest('.label-code-guide')?.remove()
    codeParts = null
    codeFieldBand = null
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
      if (key !== 'code') {
        input.style.left = `${box[0] * 100}%`
        input.style.top = `${box[1] * 100}%`
        input.style.width = `${box[2] * 100}%`
        input.style.height = `${box[3] * 100}%`
      }
      input.maxLength =
        key === 'spanishName' ? 80 : key === 'category' ? 30 : 40
      input.addEventListener('input', () => {
        model = { ...model, [key]: input.value }
        if (key === 'code') updateCodeLayout()
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
      if (key === 'code') {
        codeFieldBand = element('div', 'label-code-field-band')
        codeFieldBand.append(input)
        preview.append(codeFieldBand)
      } else preview.append(input)
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
    const base = element('span', 'label-code-base')
    base.append(element('span', 'label-code-base-text', model.baseCode))
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
        updateCodeLayout()
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
    composedCode = element('output', 'label-composed-code ce-code')
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
    clearErrorNotice({ scope: errorScope, key: errorKey })
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
    if (copyInProgress) return
    resetCopied()
    try {
      if (!(await commit()) || destroyed) return
      const copiedRevision = revision
      const current = await previewNow()
      if (!current || destroyed) return
      copyInProgress = true
      await copied(
        copy,
        async () => {
          if (options.onCopy) {
            if ((await options.onCopy(current.result, current.model)) === false)
              return false
          } else
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': current.result.blob }),
            ])
          if (destroyed || copiedRevision !== revision) return false
          message(uiMessage('Copied'))
        },
        {
          onError(error) {
            if (!destroyed)
              message(error.message || 'The label could not be copied', true)
          },
        }
      )
    } catch (error) {
      if (!destroyed) {
        resetCopied()
        message(error.message || 'The label could not be copied', true)
      }
    } finally {
      copyInProgress = false
      copy.removeAttribute('aria-busy')
      if (!destroyed)
        copy.disabled = !ready || dirty() || Boolean(pendingCommit)
    }
  })

  try {
    buildFields()
    void previewNow()
  } catch (error) {
    issue(error)
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
        issue(error)
      }
    },
    getLatestValidRender: () =>
      latest ? { ...latest.result, model: { ...latest.model } } : null,
    destroy() {
      destroyed = true
      clearErrorNotice({ scope: errorScope, key: errorKey })
      dialog?.removeEventListener('cancel', dismiss)
      revision++
      resetCopyFeedback(copy)
      invalidatePreview()
      actions.remove()
      root.remove()
    },
  }
}
