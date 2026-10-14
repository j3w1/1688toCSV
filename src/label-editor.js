import {
  LABEL_FIELDS,
  normalizeLabel,
  normalizeLabelSettings,
  renderLabel,
} from './labels.js'

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

/** Fixed-position text editing; grouping, numbering and persistence remain with the caller. */
export function mountLabelEditor(container, options) {
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
  image.alt = 'Printable label preview'
  image.hidden = true
  const hint = element(
    'p',
    'label-editor-hint',
    'Click the code or description to edit. Enter saves; Escape restores the saved text.'
  )
  const status = element('p', 'label-editor-status')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  const copy = element('button', 'label-editor-copy', 'Copy label')
  copy.type = 'button'
  copy.disabled = true
  preview.append(image)
  root.append(preview, hint, status, copy)
  container.append(root)

  function message(value, error = false) {
    status.textContent = value
    status.classList.toggle('label-editor-error', error)
  }

  function resetCopied() {
    clearTimeout(copiedTimer)
    copy.textContent = 'Copy label'
    copy.classList.remove('copied')
  }

  function dirty() {
    return [...inputs.keys()].some((key) => model[key] !== committed[key])
  }

  function controls(disabled) {
    for (const input of inputs.values()) input.disabled = disabled
    copy.disabled = disabled || !ready
  }

  async function previewNow() {
    clearTimeout(timer)
    previewController?.abort()
    previewController = new AbortController()
    const version = ++previewVersion
    ready = false
    copy.disabled = true
    message(`Preparing label…${dirty() ? ' · Unsaved text' : ''}`)
    try {
      const normalized = normalizeLabel(model)
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
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      previewUrl = nextUrl
      latest = { result, model: { ...model, ...normalized } }
      ready = true
      copy.disabled = Boolean(pendingCommit)
      if (!pendingCommit)
        message(
          `${result.widthMm} × ${result.heightMm} mm · ${result.dpi} dpi${dirty() ? ' · Unsaved text' : ''}`
        )
      return latest
    } catch (error) {
      if (
        destroyed ||
        version !== previewVersion ||
        error.name === 'AbortError'
      )
        return null
      message(error.message, true)
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
    message(`Updating preview…${dirty() ? ' · Unsaved text' : ''}`)
    timer = setTimeout(() => void previewNow(), 150)
  }

  function syncValues() {
    for (const [key, input] of inputs) input.value = model[key] ?? ''
  }

  async function commit() {
    if (pendingCommit) return pendingCommit
    if (!dirty()) return true
    const epoch = ++revision
    try {
      const next = { ...model, ...normalizeLabel(model) }
      const operation = async () => {
        // Set pendingCommit before disabling the focused input can trigger blur.
        await Promise.resolve()
        try {
          controls(true)
          // Validate printable text before an allocator/persistence mutation.
          const checked = await previewNow()
          if (!checked || destroyed || epoch !== revision) return false
          message('Saving label…')
          const saved = await options.onCommit?.(next)
          if (destroyed || epoch !== revision) return false
          model = { ...(saved || next) }
          committed = { ...model }
          syncValues()
          const result = await previewNow()
          if (result)
            message(
              `${result.result.widthMm} × ${result.result.heightMm} mm · ${result.result.dpi} dpi`
            )
          return Boolean(result)
        } catch (error) {
          if (!destroyed && epoch === revision)
            message(error.message || 'The label could not be saved', true)
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
      message(error.message, true)
      copy.disabled = true
      return false
    }
  }

  function resetDraft() {
    if (pendingCommit) return
    resetCopied()
    revision++
    model = { ...committed }
    syncValues()
    void previewNow()
  }

  function buildFields() {
    for (const input of inputs.values()) input.remove()
    inputs.clear()
    const kind = model.kind
    const fields = LABEL_FIELDS[kind]
    if (!fields) throw new Error('Choose a barcode or shipping mark')
    preview.dataset.kind = kind
    const normalizedSettings = normalizeLabelSettings(settings)
    preview.style.aspectRatio = `${normalizedSettings[kind].widthMm} / ${normalizedSettings[kind].heightMm}`
    for (const [key, box] of Object.entries(fields)) {
      const input = element('input', `label-editor-field label-editor-${key}`)
      input.type = 'text'
      input.autocomplete = 'off'
      input.spellcheck = false
      input.setAttribute(
        'aria-label',
        key === 'code'
          ? kind === 'mark'
            ? 'Base CE code'
            : 'Barcode code'
          : key === 'category'
            ? 'Chinese category'
            : 'Spanish product name'
      )
      input.title = `${input.getAttribute('aria-label')} — Enter saves, Escape restores`
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
      input.addEventListener('keydown', (event) => {
        if (event.isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          void commit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          resetDraft()
          input.blur()
        }
      })
      input.addEventListener('blur', () => void commit())
      inputs.set(key, input)
      preview.append(input)
    }
    syncValues()
  }

  copy.addEventListener('pointerdown', (event) => {
    // Let click commit the focused draft. Blurring first can disable this button
    // while saving and prevent the browser from dispatching the click at all.
    if (event.button === 0) event.preventDefault()
  })
  copy.addEventListener('click', async () => {
    resetCopied()
    try {
      if (!(await commit()) || destroyed) return
      const copiedRevision = revision
      const current = await previewNow()
      if (!current || destroyed) return
      copy.disabled = true
      copy.textContent = 'Copying…'
      if (options.onCopy) await options.onCopy(current.result, current.model)
      else
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': current.result.blob }),
        ])
      if (!destroyed && copiedRevision === revision) {
        copy.textContent = 'Copied'
        copy.classList.add('copied')
        copiedTimer = setTimeout(resetCopied, 3000)
        message('Copied')
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
