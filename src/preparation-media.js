import {
  message as uiMessage,
  bindText,
  bindAttribute,
  isMessage,
  t,
  getLocale,
  getLanguage,
  onLanguageChange,
} from './i18n.js'
import { createPhotoViewer } from './photo-viewer.js'
import { createLabelRenderer } from './labels.js'
import { element as el } from './ui.js'
import { icon } from './icons.js'
import { photoCopyTile } from './photo-copy.js'
import { copySingleImage } from './clipboard.js'
export { preparationHelp } from './preparation-help.js'

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
  getPhotoItems = () => [],
  getPhotoContext,
  getSizeClassifier,
  onPhotoEdit,
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
    timer
  const zoom = createPhotoViewer(loadImage, {
    onEdit: onPhotoEdit,
    getProductContext: getPhotoContext,
    getSizeClassifier,
  })
  const photoQueue = []
  async function thumbnail(url) {
    if (photos.has(url)) return photos.get(url)
    if (pendingPhotos.has(url)) return pendingPhotos.get(url)
    const work = (async () => {
      const data = await loadImage(url)
      const blob = await smallImage(await (await fetch(data)).blob(), 224)
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
    if (tile.placeholder) tile.placeholder.hidden = true
    tile.root.classList.remove('label-unfinished')
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
        incomplete:
          model.kind === 'barcode' && !model.spanishName?.trim()
            ? 'name'
            : model.kind === 'mark' && !model.category?.trim()
              ? 'category'
              : '',
      }
    } catch (error) {
      return {
        error: error.message,
        pending: Boolean(error.previewPending),
        recovery: error.noticeOptions?.action,
      }
    }
  }
  function showLabelIssue(tile, request) {
    if (!request.error) return false
    tile.root.dataset.previewState = request.pending ? 'checking' : 'invalid'
    bindText(tile.status, uiMessage(request.error))
    bindAttribute(
      tile.root,
      'title',
      request.pending
        ? uiMessage(request.error)
        : uiMessage('Click to resolve this label issue')
    )
    return true
  }
  async function draw(tile) {
    release(tile)
    const version = tile.version
    tile.controller = new AbortController()
    bindText(tile.status, uiMessage('Loading preview…'))
    try {
      let blob
      if (tile.photo) blob = await thumbnail(tile.photo)
      else {
        const request = labelRequest(tile)
        tile.signature = JSON.stringify(request)
        if (showLabelIssue(tile, request)) return
        tile.root.dataset.previewState = 'loading'
        if (request.incomplete) {
          tile.root.classList.add('label-unfinished')
          bindAttribute(
            tile.root,
            'title',
            request.incomplete === 'name'
              ? uiMessage('Name this product to preview its barcode')
              : uiMessage('Add a Chinese category to preview its carton mark')
          )
          tile.placeholder.hidden = false
          tile.status.textContent = ''
          return
        }
        bindAttribute(
          tile.root,
          'title',
          uiMessage('Click the preview to edit or copy this label')
        )
        if (!request.code)
          throw new Error(
            'Assigning a product code… Enter the seller login if requested.'
          )
        const result = await renderer.render({
          ...request,
          signal: tile.controller.signal,
        })
        blob = await smallImage(result.blob)
      }
      if (disposed || version !== tile.version || !tile.visible) return
      // A model or ownership check may change while rendering/reducing a blob.
      // Never publish that result, even if no refresh happened in between.
      if (
        !tile.photo &&
        tile.signature !== JSON.stringify(labelRequest(tile))
      ) {
        void draw(tile)
        return
      }
      tile.url = URL.createObjectURL(blob)
      tile.image.src = tile.url
      tile.image.hidden = false
      tile.status.textContent = ''
      if (!tile.photo) tile.root.dataset.previewState = 'ready'
    } catch (error) {
      if (!disposed && version === tile.version && error.name !== 'AbortError')
        if (tile.photo) bindText(tile.status, error.message)
        else showLabelIssue(tile, { error: error.message })
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

  return {
    photo(item, { interactive = true } = {}) {
      const root = el(
          interactive ? 'button' : 'span',
          undefined,
          'preparation-photo'
        ),
        image = el('img'),
        status = el('span')
      if (interactive) {
        root.type = 'button'
        bindAttribute(
          root,
          'aria-label',
          uiMessage('Zoom product photo {0}', { 0: item.entryId })
        )
      } else root.setAttribute('aria-hidden', 'true')
      bindAttribute(image, 'alt', uiMessage('Product photo'))
      image.width = image.height = 96
      image.hidden = true
      root.append(image, status)
      if (item.photos?.length > 1)
        root.append(
          el('small', String(item.photos.length), 'product-photo-count')
        )
      if (item.thumbnail) {
        if (interactive) {
          root.onclick = () => void zoom.open(item, getPhotoItems())
          observe(root, image, status, {
            photo: item.thumbnail,
            sourceItem: item,
          })
        } else {
          const tile = {
            root,
            image,
            status,
            version: 0,
            visible: true,
            photo: item.thumbnail,
          }
          tiles.set(root, tile)
          photoQueue.push(tile)
          drainPhotos()
        }
      } else {
        root.disabled = true
        bindText(status, uiMessage('No photo'))
      }
      return interactive
        ? photoCopyTile(
            root,
            async () => copySingleImage(await loadImage(item.thumbnail)),
            { disabled: !item.thumbnail }
          )
        : root
    },
    label(model, onEdit, kind) {
      const root = el('button', undefined, `preparation-label-preview ${kind}`),
        image = el('img'),
        status = el('span'),
        placeholder = el('span', undefined, 'label-placeholder')
      placeholder.append(icon(kind === 'mark' ? 'carton' : 'barcode'))
      placeholder.hidden = true
      root.type = 'button'
      bindAttribute(
        root,
        'aria-label',
        kind === 'mark'
          ? uiMessage('Edit carton mark')
          : uiMessage('Edit barcode')
      )
      bindAttribute(
        root,
        'title',
        uiMessage('Click the preview to edit or copy this label')
      )
      bindAttribute(
        image,
        'alt',
        kind === 'mark'
          ? uiMessage('Carton mark preview')
          : uiMessage('Barcode preview')
      )
      image.hidden = true
      status.id = `label-preview-status-${crypto.randomUUID()}`
      root.setAttribute('aria-describedby', status.id)
      root.append(image, placeholder, status)
      root.addEventListener('click', async () => {
        try {
          const request = labelRequest({ model })
          if (request.recovery?.onClick) {
            await request.recovery.onClick()
            return
          }
          await onEdit()
        } catch (error) {
          const tile = tiles.get(root)
          if (tile) {
            release(tile)
            showLabelIssue(tile, { error: error.message })
          }
        }
      })
      observe(root, image, status, { model, placeholder })
      return root
    },
    refresh() {
      clearTimeout(timer)
      for (const tile of tiles.values()) {
        if (tile.photo || !tile.visible) continue
        const request = labelRequest(tile)
        const signature = JSON.stringify(request)
        if (tile.signature !== signature) {
          release(tile)
          tile.signature = signature
          tile.dirty = !showLabelIssue(tile, request)
          if (tile.dirty) bindText(tile.status, uiMessage('Loading preview…'))
        }
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
    updatePhoto(item, thumbnail) {
      for (const tile of tiles.values())
        if (tile.sourceItem === item) {
          release(tile)
          tile.photo = thumbnail
          if (tile.visible) photoQueue.push(tile)
        }
      drainPhotos()
    },
    reset() {
      clearTimeout(timer)
      zoom.close()
      observer.disconnect()
      for (const tile of tiles.values()) release(tile)
      tiles.clear()
      photoQueue.length = 0
    },
    destroy() {
      disposed = true
      this.reset()
      zoom.close()
      photos.clear()
      renderer.dispose()
    },
  }
}
