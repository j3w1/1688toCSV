import { createLabelRenderer } from './labels.js'
import { element as el } from './ui.js'

async function smallImage(blob, width = 360) {
  const source = await createImageBitmap(blob, {
    resizeWidth: width,
    resizeQuality: 'high',
  })
  const ratio = Math.min(1, width / source.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * ratio))
  canvas.height = Math.max(1, Math.round(source.height * ratio))
  try {
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error('Image preview unavailable')),
        'image/png'
      )
    )
  } finally {
    source.close()
    canvas.width = canvas.height = 0
  }
}

/** Visible previews only; full-resolution labels remain in the copy/editor path. */
export function createPreparationMedia({
  container,
  loadImage,
  settings,
  logoUrl,
}) {
  const renderer = createLabelRenderer({
    maxBytes: 16 * 1024 * 1024,
    maxConcurrent: 1,
  })
  const tiles = new Map(),
    photos = new Map(),
    pendingPhotos = new Map()
  let photoBytes = 0,
    activePhotos = 0,
    disposed = false,
    zoom = null,
    timer
  const photoQueue = []
  async function thumbnail(url) {
    if (photos.has(url)) return photos.get(url)
    if (pendingPhotos.has(url)) return pendingPhotos.get(url)
    const work = (async () => {
      const data = await loadImage(url)
      const blob = await smallImage(await (await fetch(data)).blob(), 192)
      if (!disposed) {
        while (
          photos.size &&
          (photoBytes + blob.size > 4 * 1024 * 1024 || photos.size >= 40)
        ) {
          const [key, value] = photos.entries().next().value
          photoBytes -= value.size
          photos.delete(key)
        }
        photos.set(url, blob)
        photoBytes += blob.size
      }
      return blob
    })()
    pendingPhotos.set(url, work)
    try {
      return await work
    } finally {
      pendingPhotos.delete(url)
    }
  }
  function release(tile) {
    tile.version++
    tile.controller?.abort()
    if (tile.url) URL.revokeObjectURL(tile.url)
    tile.url = null
    tile.image.removeAttribute('src')
    tile.image.hidden = true
  }
  function labelRequest(tile) {
    try {
      const model = tile.model()
      return {
        kind: model.kind,
        code: model.code,
        ...(model.kind === 'mark'
          ? { category: model.category }
          : { spanishName: model.spanishName }),
        settings: settings(),
        logoUrl: logoUrl(),
      }
    } catch (error) {
      return { error: error.message }
    }
  }
  async function draw(tile) {
    release(tile)
    const version = tile.version
    tile.controller = new AbortController()
    tile.status.textContent = 'Loading preview…'
    try {
      let blob
      if (tile.photo) blob = await thumbnail(tile.photo)
      else {
        const request = labelRequest(tile)
        tile.signature = JSON.stringify(request)
        if (request.error) throw new Error(request.error)
        if (!request.code)
          throw new Error(
            'Save preparation to assign a code and show this label.'
          )
        const result = await renderer.render({
          ...request,
          signal: tile.controller.signal,
        })
        blob = await smallImage(result.blob)
      }
      if (disposed || version !== tile.version || !tile.visible) return
      tile.url = URL.createObjectURL(blob)
      tile.image.src = tile.url
      tile.image.hidden = false
      tile.status.textContent = ''
    } catch (error) {
      if (!disposed && version === tile.version && error.name !== 'AbortError')
        tile.status.textContent = error.message
    }
  }
  function drainPhotos() {
    while (activePhotos < 2 && photoQueue.length) {
      const tile = photoQueue.shift()
      if (!tile.visible || !tiles.has(tile.root)) continue
      activePhotos++
      void (async () => {
        try {
          await draw(tile)
        } finally {
          activePhotos--
          drainPhotos()
        }
      })()
    }
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const tile = tiles.get(entry.target)
        if (!tile || tile.visible === entry.isIntersecting) continue
        tile.visible = entry.isIntersecting
        if (!tile.visible) release(tile)
        else if (tile.photo) {
          photoQueue.push(tile)
          drainPhotos()
        } else void draw(tile)
      }
    },
    { root: container, rootMargin: '100px' }
  )
  function observe(root, image, status, extra) {
    const tile = { root, image, status, version: 0, visible: false, ...extra }
    tiles.set(root, tile)
    observer.observe(root)
  }
  async function zoomPhoto(item) {
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
  return {
    photo(item) {
      const root = el('button', undefined, 'preparation-photo'),
        image = el('img'),
        status = el('span')
      root.type = 'button'
      root.setAttribute('aria-label', `Zoom product photo ${item.entryId}`)
      image.alt = 'Product photo'
      image.width = image.height = 96
      image.hidden = true
      root.append(image, status)
      if (item.thumbnail) {
        root.onclick = () => void zoomPhoto(item)
        observe(root, image, status, { photo: item.thumbnail })
      } else {
        root.disabled = true
        status.textContent = 'No photo'
      }
      return root
    },
    label(model, onEdit, kind) {
      const root = el('button', undefined, `preparation-label-preview ${kind}`),
        image = el('img'),
        status = el('span')
      root.type = 'button'
      root.setAttribute(
        'aria-label',
        kind === 'mark' ? 'Edit carton mark' : 'Edit barcode'
      )
      root.title = 'Click the preview to edit or copy this label'
      image.alt = kind === 'mark' ? 'Carton mark preview' : 'Barcode preview'
      image.hidden = true
      root.append(image, status)
      root.addEventListener('click', async () => {
        try {
          await onEdit()
        } catch (error) {
          status.textContent = error.message
        }
      })
      observe(root, image, status, { model })
      return root
    },
    refresh() {
      clearTimeout(timer)
      for (const tile of tiles.values())
        if (
          !tile.photo &&
          tile.visible &&
          tile.signature !== JSON.stringify(labelRequest(tile))
        ) {
          release(tile)
          tile.dirty = true
        }
      timer = setTimeout(() => {
        for (const tile of tiles.values())
          if (tile.dirty && tile.visible) {
            tile.dirty = false
            void draw(tile)
          }
      }, 180)
    },
    forget(root) {
      for (const [element, tile] of tiles) {
        if (element === root || root.contains(element)) {
          observer.unobserve(element)
          release(tile)
          tiles.delete(element)
        }
      }
    },
    reset() {
      clearTimeout(timer)
      zoom?.close()
      observer.disconnect()
      for (const tile of tiles.values()) release(tile)
      tiles.clear()
      photoQueue.length = 0
    },
    destroy() {
      disposed = true
      this.reset()
      zoom?.close()
      photos.clear()
      renderer.dispose()
    },
  }
}

export function preparationHelp(title, text) {
  const wrap = el('span', undefined, 'preparation-help'),
    trigger = el('button', '?'),
    panel = el('div', undefined, 'preparation-help-popover')
  trigger.type = 'button'
  trigger.setAttribute('aria-label', `Help: ${title}`)
  panel.id = `help-${crypto.randomUUID()}`
  panel.append(el('strong', title), el('p', text))
  const close = el('button', 'Close')
  panel.append(close)
  if ('popover' in HTMLElement.prototype) {
    panel.setAttribute('popover', 'auto')
    trigger.setAttribute('popovertarget', panel.id)
    close.onclick = () => panel.hidePopover()
  } else {
    panel.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    trigger.setAttribute('aria-controls', panel.id)
    const toggle = (open) => {
      panel.hidden = !open
      trigger.setAttribute('aria-expanded', String(open))
    }
    trigger.onclick = () => toggle(panel.hidden)
    close.onclick = () => {
      toggle(false)
      trigger.focus()
    }
    panel.onkeydown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        toggle(false)
        trigger.focus()
      }
    }
  }
  wrap.append(trigger, panel)
  return wrap
}
