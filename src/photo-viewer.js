import { element as el } from './ui.js'

export function createPhotoViewer(loadImage) {
  let zoom = null
  async function open(item) {
    zoom?.close()
    const modal = el('dialog', undefined, 'product-photo-dialog')
    zoom = modal
    modal.setAttribute('aria-label', 'Product photo')
    const title = el('h2', 'Product photo'),
      close = el('button', '×', 'dialog-close'),
      viewport = el('div', undefined, 'photo-viewport'),
      image = el('img'),
      status = el('p', 'Loading original image…', 'packing-help'),
      actions = el('div', undefined, 'photo-zoom-actions'),
      value = el('span', '100%')
    close.setAttribute('aria-label', 'Close product photo')
    close.onclick = () => modal.close()
    image.alt = item.title || item.description?.split('\n')[0] || 'Product'
    let scale = 1,
      initialWidth = 0
    function resize(next) {
      scale = Math.min(4, Math.max(1, next))
      if (initialWidth) image.style.width = `${initialWidth * scale}px`
      value.textContent = `${Math.round(scale * 100)}%`
      minus.disabled = scale === 1
      plus.disabled = scale === 4
    }
    const minus = el('button', '−'),
      plus = el('button', '+'),
      fit = el('button', 'Fit')
    minus.setAttribute('aria-label', 'Zoom out')
    plus.setAttribute('aria-label', 'Zoom in')
    minus.onclick = () => resize(scale - 0.5)
    plus.onclick = () => resize(scale + 0.5)
    fit.onclick = () => resize(1)
    actions.append(minus, value, plus, fit)
    viewport.append(image)
    modal.append(close, title, actions, viewport, status)
    document.body.append(modal)
    modal.onclose = () => {
      image.removeAttribute('src')
      modal.remove()
      if (zoom === modal) zoom = null
    }
    modal.showModal()
    close.focus()
    try {
      const data = await loadImage(item.thumbnail)
      if (!modal.open) return
      image.src = data
      await image.decode()
      if (!modal.open) return
      initialWidth = Math.min(
        image.naturalWidth,
        viewport.clientWidth - 24,
        ((viewport.clientHeight - 24) * image.naturalWidth) /
          image.naturalHeight
      )
      resize(1)
      status.textContent =
        'Use + to enlarge; scroll to inspect details. Escape or the dark background closes this photo.'
    } catch (error) {
      if (modal.open) status.textContent = error.message
    }
  }
  return { open, close: () => zoom?.close() }
}
