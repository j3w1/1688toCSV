import { element as el } from './ui.js'

export function createPhotoViewer(loadImage) {
  let current = null

  async function open(item) {
    current?.close()
    const modal = el('dialog', undefined, 'product-photo-dialog')
    current = modal
    modal.setAttribute('aria-label', 'Product photo')
    const frame = el('div', undefined, 'photo-viewer-frame'),
      title = el('h2', 'Product photo'),
      close = el('button', '×', 'dialog-close'),
      viewport = el('div', undefined, 'photo-viewport'),
      image = el('img'),
      status = el('p', 'Loading original image…', 'photo-viewer-status'),
      actions = el('div', undefined, 'photo-zoom-actions'),
      value = el('span', '—', 'photo-zoom-value'),
      minus = el('button', '−'),
      plus = el('button', '+'),
      fit = el('button', 'Fit'),
      actual = el('button', '100%'),
      fullscreen = el('button', 'Fullscreen'),
      events = new AbortController()
    close.setAttribute('aria-label', 'Close product photo')
    minus.setAttribute('aria-label', 'Zoom out')
    plus.setAttribute('aria-label', 'Zoom in')
    actual.setAttribute('aria-label', 'Actual size (100%)')
    fullscreen.setAttribute('aria-pressed', 'false')
    viewport.tabIndex = 0
    viewport.setAttribute('role', 'region')
    viewport.setAttribute(
      'aria-label',
      'Product image. Use arrow keys to move, plus or minus to zoom, and 0 to fit.'
    )
    status.setAttribute('role', 'status')
    image.alt = item.title || item.description?.split('\n')[0] || 'Product'
    image.draggable = false
    image.hidden = true
    let ready = false,
      scale = 1,
      fitScale = 1,
      x = 0,
      y = 0,
      width = 0,
      height = 0,
      fitted = true,
      drag = null
    const maximumScale = 8
    const listen = (target, name, handler, options = {}) =>
      target.addEventListener(name, handler, {
        ...options,
        signal: events.signal,
      })
    function paint() {
      const renderedWidth = image.naturalWidth * scale,
        renderedHeight = image.naturalHeight * scale
      x =
        renderedWidth <= width
          ? (width - renderedWidth) / 2
          : Math.max(width - renderedWidth, Math.min(0, x))
      y =
        renderedHeight <= height
          ? (height - renderedHeight) / 2
          : Math.max(height - renderedHeight, Math.min(0, y))
      image.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
      value.textContent = `${Math.round(scale * 100)}%`
      minus.disabled = scale <= fitScale
      plus.disabled = scale >= maximumScale
      viewport.classList.toggle(
        'can-pan',
        renderedWidth > width || renderedHeight > height
      )
    }
    function zoomTo(next, anchor = { x: width / 2, y: height / 2 }) {
      if (!ready) return
      const previous = scale
      scale = Math.max(fitScale, Math.min(maximumScale, next))
      fitted = Math.abs(scale - fitScale) < 0.0001
      x = anchor.x - ((anchor.x - x) * scale) / previous
      y = anchor.y - ((anchor.y - y) * scale) / previous
      paint()
    }
    function resize() {
      if (!ready) return
      const nextWidth = viewport.clientWidth,
        nextHeight = viewport.clientHeight
      x += (nextWidth - width) / 2
      y += (nextHeight - height) / 2
      width = nextWidth
      height = nextHeight
      fitScale = Math.min(
        1,
        Math.max(1, width - 24) / image.naturalWidth,
        Math.max(1, height - 24) / image.naturalHeight
      )
      if (fitted) scale = fitScale
      else scale = Math.max(fitScale, scale)
      paint()
    }
    function pointerPosition(event) {
      const rect = viewport.getBoundingClientRect()
      return {
        x: event.clientX - rect.left - viewport.clientLeft,
        y: event.clientY - rect.top - viewport.clientTop,
      }
    }
    function stopDrag(event) {
      if (event && drag && event.pointerId !== drag.pointerId) return
      const pointerId = drag?.pointerId
      drag = null
      viewport.classList.remove('dragging')
      if (pointerId !== undefined && viewport.hasPointerCapture(pointerId))
        viewport.releasePointerCapture(pointerId)
    }
    close.onclick = () => modal.close()
    minus.onclick = () => zoomTo(scale / 1.5)
    plus.onclick = () => zoomTo(scale * 1.5)
    fit.onclick = () => zoomTo(fitScale)
    actual.onclick = () => zoomTo(1)
    fullscreen.onclick = async () => {
      try {
        // Dialog elements cannot request fullscreen; use their inner frame.
        if (document.fullscreenElement === frame)
          await document.exitFullscreen()
        else if (document.fullscreenEnabled && frame.requestFullscreen)
          await frame.requestFullscreen()
        else throw new Error('Fullscreen unavailable')
      } catch {
        status.textContent =
          'Fullscreen is unavailable in this browser. You can still zoom and drag the image.'
      }
    }
    listen(document, 'fullscreenchange', () => {
      const active = document.fullscreenElement === frame
      fullscreen.textContent = active ? 'Exit fullscreen' : 'Fullscreen'
      fullscreen.setAttribute('aria-pressed', String(active))
      resize()
    })
    listen(modal, 'cancel', async (event) => {
      if (document.fullscreenElement === frame) {
        event.preventDefault()
        try {
          await document.exitFullscreen()
        } catch {
          status.textContent =
            'Use Exit fullscreen or your browser’s fullscreen control to return.'
        }
      }
    })
    listen(
      viewport,
      'wheel',
      (event) => {
        if (!ready) return
        event.preventDefault()
        const unit =
          event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1
        zoomTo(
          scale *
            Math.exp(
              -Math.max(-500, Math.min(500, event.deltaY * unit)) * 0.002
            ),
          pointerPosition(event)
        )
      },
      { passive: false }
    )
    listen(viewport, 'dblclick', (event) => {
      event.preventDefault()
      zoomTo(
        fitted ? Math.max(1, fitScale * 2) : fitScale,
        pointerPosition(event)
      )
    })
    listen(viewport, 'pointerdown', (event) => {
      if (!ready || event.button !== 0 || !event.isPrimary) return
      viewport.focus({ preventScroll: true })
      if (!viewport.classList.contains('can-pan')) return
      event.preventDefault()
      drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        imageX: x,
        imageY: y,
      }
      viewport.setPointerCapture(event.pointerId)
    })
    listen(viewport, 'pointermove', (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return
      viewport.classList.add('dragging')
      x = drag.imageX + event.clientX - drag.x
      y = drag.imageY + event.clientY - drag.y
      paint()
    })
    listen(viewport, 'pointerup', stopDrag)
    listen(viewport, 'pointercancel', stopDrag)
    listen(viewport, 'lostpointercapture', stopDrag)
    listen(modal, 'keydown', (event) => {
      if (!ready || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === '+' || event.key === '=') zoomTo(scale * 1.5)
      else if (event.key === '-' || event.key === '_') zoomTo(scale / 1.5)
      else if (event.key === '0' || event.key.toLowerCase() === 'f')
        zoomTo(fitScale)
      else if (
        event.target === viewport &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      ) {
        const step = event.shiftKey ? 120 : 40
        x +=
          event.key === 'ArrowLeft'
            ? step
            : event.key === 'ArrowRight'
              ? -step
              : 0
        y +=
          event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0
        paint()
      } else return
      event.preventDefault()
    })
    const observer = new ResizeObserver(resize)
    observer.observe(viewport)
    for (const button of [minus, plus, fit, actual]) button.disabled = true
    actions.append(minus, value, plus, fit, actual, fullscreen)
    viewport.append(image)
    frame.append(close, title, actions, viewport, status)
    modal.append(frame)
    document.body.append(modal)
    modal.onclose = () => {
      stopDrag()
      events.abort()
      observer.disconnect()
      image.removeAttribute('src')
      // Removing the fullscreen frame exits fullscreen through the platform.
      modal.remove()
      if (current === modal) current = null
    }
    modal.showModal()
    close.focus()
    try {
      const data = await loadImage(item.thumbnail)
      if (!modal.open) return
      image.src = data
      await image.decode()
      if (!modal.open) return
      image.style.width = `${image.naturalWidth}px`
      image.style.height = `${image.naturalHeight}px`
      ready = true
      for (const button of [plus, fit, actual]) button.disabled = false
      image.hidden = false
      resize()
      status.textContent =
        'Scroll to zoom · Drag to move · Double-click to zoom or fit · + / − zoom · Arrow keys move · 0 fits'
    } catch (error) {
      if (modal.open) status.textContent = error.message
    }
  }
  return { open, close: () => current?.close() }
}
