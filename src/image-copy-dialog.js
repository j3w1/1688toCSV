import { element } from './ui.js'
import { bindText, bindAttribute, message } from './i18n.js'
import { decorateIcon } from './icons.js'
import { showErrorNotice, clearErrorNotice } from './error-notice.js'

export class ImageBatchTooLarge extends Error {}

export function imageBatchPlans(count, size) {
  return Array.from({ length: Math.ceil(count / size) }, (_, index) => ({
    start: index * size,
    end: Math.min(count, (index + 1) * size),
  }))
}

/** One bounded batch stays in memory; changing batches never writes the clipboard. */
export function openImageCopyDialog({
  title,
  count,
  plan,
  prepare,
  write,
  createOptions,
  signal,
}) {
  if (signal?.aborted || !count) return Promise.resolve(false)
  const dialog = element('dialog', undefined, 'image-copy-dialog')
  bindAttribute(dialog, 'aria-label', message(title))
  const heading = element('header', undefined, 'image-copy-heading')
  const close = decorateIcon(element('button'), 'close', {
    iconOnly: true,
    label: 'Close',
  })
  close.onclick = () => dialog.close()
  heading.append(element('h2', message(title)), close)
  const hint = element(
    'p',
    message('Copy a batch, paste it into Excel, then continue here.'),
    'image-copy-hint'
  )
  const body = element('div', undefined, 'image-copy-body')
  const preview = element('div', undefined, 'copy-preview')
  bindAttribute(preview, 'aria-label', message('Image preview'))
  const options = createOptions?.(() => refresh(true))
  if (options) body.append(options)
  body.append(preview)
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
  const footer = element('footer', undefined, 'image-copy-footer')
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
  footer.append(status, progress, actions)
  dialog.append(heading, hint, navigation, body, footer)

  let plans = [],
    current = 0,
    generation = 0,
    controller,
    ready,
    copying = false,
    copiedAny = false,
    timer,
    closed = false
  const copied = new Set()
  const urls = new Set()
  const key = (batch) => `${batch.start}:${batch.end}`
  const release = () => {
    ready = null
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
    bindText(
      status,
      plans.length
        ? message('Batch {0} of {1} · items {2}–{3} of {4}', {
            0: current + 1,
            1: plans.length,
            2: plans[current].start + 1,
            3: plans[current].end,
            4: count,
          })
        : message('Preparing…')
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

  function refresh(reset = false) {
    if (closed || copying) return
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
            figure.append(zoom)
            if (item.label) figure.append(element('figcaption', item.label))
            preview.append(figure)
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
          showErrorNotice(error.message, { scope: dialog, key: 'image-copy' })
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
    copying = true
    const payload = ready
    const batchKey = key(plans[current])
    clearErrorNotice({ scope: dialog, key: 'image-copy' })
    bindText(progress, message('Copying…'))
    controls()
    try {
      await write(payload)
      copied.add(batchKey)
      copiedAny = true
      if (!closed)
        bindText(
          progress,
          message(
            'Copied {0} of {1} batches. Paste into Excel before copying another.',
            { 0: copied.size, 1: plans.length }
          )
        )
    } catch (error) {
      if (!closed) {
        bindText(progress, message('Copy failed. Try again.'))
        showErrorNotice(error.message, { scope: dialog, key: 'image-copy' })
      }
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
        release()
        dialog.remove()
        resolve(copiedAny)
      },
      { once: true }
    )
    refresh(true)
  })
}
