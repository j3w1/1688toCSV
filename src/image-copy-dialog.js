import { element, copied as copyFeedback, resetCopyFeedback } from './ui.js'
import { bindText, bindAttribute, message } from './i18n.js'
import { decorateIcon } from './icons.js'
import { showErrorNotice, clearErrorNotice } from './error-notice.js'
import { photoCopyTile } from './photo-copy.js'
import { popupLanguageToggle } from './popup-language-toggle.js'

export class ImageBatchTooLarge extends Error {}

function writePreparedImage({ blob, url }) {
  // Start the clipboard write within the click's user activation. A source
  // photo is already a prepared full-size PNG, never a display thumbnail.
  return navigator.clipboard.write([
    new ClipboardItem({
      'image/png': blob || (async () => (await fetch(url)).blob())(),
    }),
  ])
}

export function imageBatchPlans(count, size) {
  return Array.from({ length: Math.ceil(count / size) }, (_, index) => ({
    start: index * size,
    end: Math.min(count, (index + 1) * size),
  }))
}

// Preview-only sizing: copied blobs and label dimensions never change.
export function enableImageNavigation(
  viewport,
  figure,
  button,
  image,
  tools,
  { fitHeight = false, fitLabel = 'Fit image' } = {}
) {
  const abort = new AbortController()
  const listen = (node, name, handler, options = {}) =>
    node.addEventListener(name, handler, { ...options, signal: abort.signal })
  const zoomOut = element('button', '−')
  const zoomIn = element('button', '+')
  const fit = element('button', message(fitLabel))
  const amount = element('output', undefined, 'copy-preview-scale')
  const help = element('span', message('Scroll to zoom · drag to pan'))
  for (const [control, label] of [
    [zoomOut, 'Zoom out'],
    [zoomIn, 'Zoom in'],
  ]) {
    control.type = 'button'
    bindAttribute(control, 'aria-label', message(label))
    bindAttribute(control, 'title', message(label))
  }
  fit.type = 'button'
  tools.replaceChildren(zoomOut, amount, zoomIn, fit, help)
  let scale = 1,
    fitted = 1,
    drag,
    suppressClick = false
  // Canvas previews retain their backing pixels; only their display size changes.
  const dimensions = () => ({
    width: image.localName === 'canvas' ? image.width : image.naturalWidth,
    height: image.localName === 'canvas' ? image.height : image.naturalHeight,
  })
  const ready = () => dimensions().width > 0 && dimensions().height > 0
  const fitScale = () =>
    Math.max(
      0.001,
      Math.min(
        1,
        (viewport.clientWidth - 8) / dimensions().width,
        fitHeight ? (viewport.clientHeight - 8) / dimensions().height : 1
      )
    )
  const apply = (next, point) => {
    if (!ready()) return
    const rect = viewport.getBoundingClientRect()
    const x = point?.x ?? rect.left + viewport.clientWidth / 2
    const y = point?.y ?? rect.top + viewport.clientHeight / 2
    const old = scale
    const before = image.getBoundingClientRect()
    const sourceX = (x - before.left) / old
    const sourceY = (y - before.top) / old
    scale = Math.max(fitted, Math.min(4, next))
    image.style.inlineSize = `${dimensions().width * scale}px`
    image.style.blockSize = `${dimensions().height * scale}px`
    const enlarged = scale > fitted + 0.001
    figure.classList.toggle('is-enlarged', enlarged)
    button.setAttribute('aria-pressed', String(enlarged))
    viewport.classList.toggle('is-zoomed', enlarged)
    // Keep the same image point under the pointer, including when a fitted
    // preview is centered in a larger viewport rather than at its origin.
    const after = image.getBoundingClientRect()
    viewport.scrollLeft += after.left + sourceX * scale - x
    viewport.scrollTop += after.top + sourceY * scale - y
    amount.value = `${Math.round(scale * 100)}%`
    zoomOut.disabled = !enlarged
    zoomIn.disabled = scale >= 4
  }
  const reset = () => {
    if (!ready()) return
    fitted = fitScale()
    apply(fitted)
    viewport.scrollTo(0, 0)
  }
  listen(fit, 'click', reset)
  listen(zoomOut, 'click', () => apply(scale / 1.25))
  listen(zoomIn, 'click', () => apply(scale * 1.25))
  button.onclick = () => {
    if (suppressClick) {
      suppressClick = false
      return
    }
    if (scale > fitted + 0.001) reset()
    else apply(Math.max(1, fitted * 2))
  }
  listen(
    viewport,
    'wheel',
    (event) => {
      if (!ready() || !event.deltaY) return
      event.preventDefault()
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? viewport.clientHeight
            : 1)
      apply(scale * Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002), {
        x: event.clientX,
        y: event.clientY,
      })
    },
    { passive: false }
  )
  // Touch scrolling remains native. The explicit image is the mouse pan handle.
  listen(button, 'pointerdown', (event) => {
    suppressClick = false
    if (
      event.button !== 0 ||
      event.pointerType !== 'mouse' ||
      scale <= fitted + 0.001
    )
      return
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    }
    button.setPointerCapture(event.pointerId)
  })
  listen(button, 'pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return
    const x = event.clientX - drag.x,
      y = event.clientY - drag.y
    if (!suppressClick && Math.hypot(x, y) < 4) return
    suppressClick = true
    viewport.classList.add('is-panning')
    viewport.scrollLeft = drag.left - x
    viewport.scrollTop = drag.top - y
  })
  const endDrag = () => {
    drag = null
    viewport.classList.remove('is-panning')
  }
  listen(button, 'lostpointercapture', endDrag)
  listen(button, 'pointercancel', endDrag)
  listen(button, 'keydown', (event) => {
    const moves = {
      ArrowLeft: [-40, 0],
      ArrowRight: [40, 0],
      ArrowUp: [0, -40],
      ArrowDown: [0, 40],
    }
    if (moves[event.key]) {
      event.preventDefault()
      viewport.scrollBy(...moves[event.key])
    } else if (['+', '=', '-', '0'].includes(event.key)) {
      event.preventDefault()
      if (event.key === '0') reset()
      else apply(scale * (event.key === '-' ? 0.8 : 1.25))
    }
  })
  image.draggable = false
  listen(image, 'load', reset)
  bindAttribute(button, 'title', message('Scroll to zoom · drag to pan'))
  const observer = new ResizeObserver(() => {
    if (!ready()) return
    const wasFit = scale <= fitted + 0.001
    fitted = fitScale()
    if (wasFit) reset()
    else apply(scale)
  })
  observer.observe(viewport)
  reset()
  return () => {
    abort.abort()
    observer.disconnect()
    viewport.classList.remove('is-zoomed', 'is-panning')
    tools.replaceChildren()
  }
}

/** One bounded batch stays in memory; changing batches never writes the clipboard. */
export function openImageCopyDialog({
  title,
  count,
  plan,
  prepare,
  write,
  writeImage = writePreparedImage,
  createOptions,
  interactivePreview = false,
  languageToggle = false,
  onLanguageChange,
  errorOptions,
  signal,
}) {
  if (signal?.aborted || !count) return Promise.resolve(false)
  const dialog = element('dialog', undefined, 'image-copy-dialog')
  bindAttribute(dialog, 'aria-label', message(title))
  const header = element('header', undefined, 'image-copy-header')
  const heading = element('div', undefined, 'image-copy-heading')
  const close = decorateIcon(element('button'), 'close', {
    iconOnly: true,
    label: 'Close',
  })
  close.onclick = () => dialog.close()
  heading.append(element('h2', message(title)))
  const headingActions = element('div', undefined, 'image-copy-heading-actions')
  const languages = languageToggle
    ? popupLanguageToggle(dialog, {
        onChange(language) {
          onLanguageChange?.(language)
          refresh(true)
        },
      })
    : null
  if (languages) headingActions.append(languages)
  headingActions.append(close)
  heading.append(headingActions)
  const hint = element(
    'p',
    message(
      'Copy a batch or hover over an image to copy it individually. Paste it, then continue here.'
    ),
    'image-copy-hint'
  )
  const content = element('div', undefined, 'image-copy-content')
  const body = element('div', undefined, 'image-copy-body')
  const preview = element('div', undefined, 'copy-preview')
  bindAttribute(preview, 'aria-label', message('Image preview'))
  const options = createOptions?.(() => refresh(true))
  if (options) body.append(options)
  const previewPane = element('div', undefined, 'image-copy-preview-pane')
  const previewTools = element('div', undefined, 'image-copy-preview-tools')
  previewTools.hidden = !interactivePreview
  preview.classList.toggle('copy-preview-interactive', interactivePreview)
  previewPane.append(previewTools, preview)
  body.append(previewPane)
  const navigation = element('nav', undefined, 'image-copy-navigation')
  bindAttribute(navigation, 'aria-label', message('Image batches'))
  const previous = decorateIcon(element('button'), 'previous', {
    iconOnly: true,
    label: 'Previous batch',
  })
  const next = decorateIcon(element('button'), 'next', {
    iconOnly: true,
    label: 'Next batch',
  })
  const batches = element('div', undefined, 'image-copy-batches')
  navigation.append(previous, batches, next)
  const toolbar = element('div', undefined, 'image-copy-toolbar')
  const status = element('p', undefined, 'image-copy-status')
  const progress = element('p', undefined, 'image-copy-progress')
  progress.setAttribute('role', 'status')
  progress.setAttribute('aria-live', 'polite')
  const copy = decorateIcon(
    element('button', message('Copy current batch'), 'primary'),
    'copy'
  )
  copy.classList.add('image-copy-submit')
  const done = element('button', message('Done'))
  done.onclick = () => dialog.close()
  const actions = element('div', undefined, 'image-copy-actions')
  actions.append(copy, done)
  toolbar.append(status, progress, actions)
  header.append(heading, hint, toolbar, navigation)
  content.append(body)
  dialog.append(header, content)

  let plans = [],
    current = 0,
    generation = 0,
    controller,
    ready,
    copying = false,
    copiedAny = false,
    timer,
    closed = false,
    releaseNavigation
  const copied = new Set()
  const urls = new Set()
  const key = (batch) => `${batch.start}:${batch.end}`
  const release = () => {
    releaseNavigation?.()
    releaseNavigation = undefined
    ready = null
    for (const button of preview.querySelectorAll('.photo-copy-button'))
      resetCopyFeedback(button)
    preview.replaceChildren()
    for (const url of urls) URL.revokeObjectURL(url)
    urls.clear()
  }
  function controls() {
    copy.disabled = copying || !ready
    close.disabled = copying
    done.disabled = copying
    previous.disabled = copying || current === 0 || !plans.length
    next.disabled = copying || current >= plans.length - 1
    if (options) options.disabled = copying
    if (languages)
      for (const button of languages.children) button.disabled = copying
    for (const button of preview.querySelectorAll('.photo-copy-button'))
      button.disabled = copying || !ready
    for (const button of batches.children) {
      const index = Number(button.dataset.batchIndex)
      button.disabled = copying
      button.setAttribute('aria-pressed', String(index === current))
      const wasCopied = copied.has(key(plans[index]))
      button.classList.toggle('is-copied', wasCopied)
      button.textContent = `${index + 1}${wasCopied ? ' ✓' : ''}`
      bindAttribute(
        button,
        'aria-label',
        message(wasCopied ? 'Batch {0}, copied' : 'Batch {0}', { 0: index + 1 })
      )
    }
    status.hidden = !plans.length
    if (plans.length)
      bindText(
        status,
        message('Batch {0} of {1} · items {2}–{3} of {4}', {
          0: current + 1,
          1: plans.length,
          2: plans[current].start + 1,
          3: plans[current].end,
          4: count,
        })
      )
  }
  function renderNavigation() {
    batches.replaceChildren()
    for (const [index] of plans.entries()) {
      const button = element('button')
      button.dataset.batchIndex = String(index)
      button.onclick = () => navigate(index)
      batches.append(button)
    }
    navigation.hidden = plans.length < 2
    controls()
  }
  function navigate(index) {
    if (copying || index < 0 || index >= plans.length || index === current)
      return
    current = index
    refresh()
  }
  previous.onclick = () => navigate(current - 1)
  next.onclick = () => navigate(current + 1)

  function copyError(error) {
    if (closed) return
    bindText(progress, message('Copy failed. Try again.'))
    showErrorNotice(error, {
      scope: dialog,
      key: 'image-copy',
      ...errorOptions?.(error, dialog),
    })
  }

  async function copyImage(item, index, payload) {
    if (copying || !ready) return false
    const number = plans[current].start + index + 1
    copying = true
    clearErrorNotice({ scope: dialog, key: 'image-copy' })
    bindText(progress, message('Copying…'))
    controls()
    try {
      const result = await writeImage(item, index, payload)
      if (closed) return false
      if (result === false) return false
      copiedAny = true
      bindText(
        progress,
        message(
          'Image {0} copied. Paste it before copying another. {1} of {2} batches copied.',
          {
            0: number,
            1: copied.size,
            2: plans.length,
          }
        )
      )
      return true
    } finally {
      copying = false
      if (!closed) controls()
    }
  }

  function refresh(reset = false) {
    if (closed || copying) return
    resetCopyFeedback(copy)
    const ticket = ++generation
    controller?.abort()
    controller = new AbortController()
    clearTimeout(timer)
    release()
    clearErrorNotice({ scope: dialog, key: 'image-copy' })
    if (reset) {
      copied.clear()
      current = 0
      plans = []
      renderNavigation()
    }
    const abort = controller
    preview.setAttribute('aria-busy', 'true')
    bindText(progress, message('Preparing preview…'))
    controls()
    // Column edits can arrive in quick succession. Cancel old work immediately.
    timer = setTimeout(
      async () => {
        try {
          if (reset) {
            const nextPlans = await plan(abort.signal)
            if (ticket !== generation || closed) return
            plans = nextPlans
            renderNavigation()
          }
          if (!plans.length)
            throw new Error('Select at least one column to copy.')
          let result
          while (!result) {
            try {
              result = await prepare(plans[current], {
                signal: abort.signal,
                onProgress: (text) => {
                  if (ticket === generation && !closed) bindText(progress, text)
                },
              })
            } catch (error) {
              if (abort.signal.aborted) return
              const batch = plans[current]
              if (
                !(error instanceof ImageBatchTooLarge) ||
                batch.end - batch.start < 2
              )
                throw error
              const middle =
                batch.start + Math.floor((batch.end - batch.start) / 2)
              plans.splice(
                current,
                1,
                { start: batch.start, end: middle },
                { start: middle, end: batch.end }
              )
              renderNavigation()
            }
          }
          if (ticket !== generation || closed || abort.signal.aborted) return
          for (const [index, item] of result.images.entries()) {
            const figure = element('figure')
            const zoom = element('button', undefined, 'copy-preview-zoom')
            bindAttribute(
              zoom,
              'aria-label',
              message('Enlarge preview {0}', { 0: index + 1 })
            )
            zoom.setAttribute('aria-pressed', 'false')
            zoom.onclick = () => {
              const enlarged = figure.classList.toggle('is-enlarged')
              zoom.setAttribute('aria-pressed', String(enlarged))
            }
            const img = element('img')
            if (item.blob) {
              img.src = URL.createObjectURL(item.blob)
              urls.add(img.src)
            } else img.src = item.url
            bindAttribute(
              img,
              'alt',
              message('Prepared image {0}', {
                0: plans[current].start + index + 1,
              })
            )
            zoom.append(img)
            figure.append(
              photoCopyTile(
                zoom,
                () => copyImage(item, index, result.payload),
                {
                  label: message('Copy image {0}', {
                    0: plans[current].start + index + 1,
                  }),
                  help: 'Copy only this image at its export size. The popup stays open and the batch is not marked as copied.',
                  onError: copyError,
                }
              )
            )
            if (item.label) {
              const caption = element('figcaption')
              caption.append(
                element(
                  'span',
                  item.label,
                  item.codeLabel ? 'ce-code' : undefined
                )
              )
              figure.append(caption)
            }
            preview.append(figure)
            if (interactivePreview && result.images.length === 1)
              releaseNavigation = enableImageNavigation(
                preview,
                figure,
                zoom,
                img,
                previewTools
              )
          }
          ready = result.payload
          bindText(
            progress,
            message('Copied {0} of {1} batches. Ready to copy.', {
              0: copied.size,
              1: plans.length,
            })
          )
        } catch (error) {
          if (ticket !== generation || closed || abort.signal.aborted) return
          bindText(progress, message('Preview could not be prepared.'))
          const retry = element('button', message('Retry'))
          retry.onclick = () => refresh(!plans.length)
          preview.append(retry)
          showErrorNotice(error, {
            scope: dialog,
            key: 'image-copy',
            ...errorOptions?.(error, dialog),
          })
        } finally {
          if (ticket === generation && !closed) {
            preview.setAttribute('aria-busy', 'false')
            controls()
          }
        }
      },
      reset ? 120 : 0
    )
  }
  copy.onclick = async () => {
    if (copying || !ready) return
    const payload = ready
    const batchKey = key(plans[current])
    clearErrorNotice({ scope: dialog, key: 'image-copy' })
    try {
      await copyFeedback(
        copy,
        async () => {
          copying = true
          bindText(progress, message('Copying…'))
          controls()
          const result = await write(payload)
          if (closed) return false
          if (result === false) {
            bindText(
              progress,
              message('Copied {0} of {1} batches. Ready to copy.', {
                0: copied.size,
                1: plans.length,
              })
            )
            return false
          }
          copied.add(batchKey)
          copiedAny = true
          bindText(
            progress,
            message(
              'Copied {0} of {1} batches. Paste into Excel before copying another.',
              { 0: copied.size, 1: plans.length }
            )
          )
        },
        {
          onError: copyError,
        }
      )
    } finally {
      copying = false
      if (!closed) controls()
    }
  }
  dialog.addEventListener('cancel', (event) => {
    if (copying) event.preventDefault()
  })
  document.body.append(dialog)
  dialog.showModal()
  close.focus()
  return new Promise((resolve) => {
    const cancel = () => dialog.close()
    signal?.addEventListener('abort', cancel, { once: true })
    dialog.addEventListener(
      'close',
      () => {
        closed = true
        ++generation
        clearTimeout(timer)
        controller?.abort()
        signal?.removeEventListener('abort', cancel)
        resetCopyFeedback(copy)
        release()
        dialog.remove()
        resolve(copiedAny)
      },
      { once: true }
    )
    refresh(true)
  })
}
