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
import { element as el } from './ui.js'
import { icon, decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'
import {
  productPhotoGallery,
  squareProductPhoto,
  DEFAULT_PHOTO_EDIT,
  reprojectPhotoVariantTags,
} from './product-photo.js'
import { mountPhotoVariantTagEditor } from './photo-variant-tag-editor.js'

export function createPhotoViewer(loadImage, { onEdit } = {}) {
  let current = null

  async function open(item, availableItems = [], photoIndex = 0) {
    current?.close()
    let gallery = productPhotoGallery(availableItems)
    // Packing photos retain their source objects. Table rows are recreated on
    // filtering, so only their full order/entry pair is a safe fallback.
    let index = gallery.findIndex(
      (entry) => entry.photoSource === item && entry.photoIndex === photoIndex
    )
    if (index < 0 && item.orderId && item.entryId)
      index = gallery.findIndex(
        (entry) =>
          entry.orderId === item.orderId &&
          entry.entryId === item.entryId &&
          entry.photoIndex === photoIndex
      )
    // Evidence/review photos outside the active product scope remain standalone.
    if (index < 0) {
      gallery = productPhotoGallery([item])
      index = 0
    }
    if (!gallery.length) return
    const modal = el('dialog', undefined, 'product-photo-dialog')
    current = modal
    bindAttribute(modal, 'aria-label', uiMessage('Product photo'))
    const frame = el('div', undefined, 'photo-viewer-frame'),
      title = el('h2', uiMessage('Product photo')),
      heading = el('div', undefined, 'photo-viewer-heading'),
      caption = el('p', undefined, 'photo-viewer-caption'),
      close = el('button', '×', 'dialog-close'),
      viewport = el('div', undefined, 'photo-viewport'),
      status = el(
        'p',
        uiMessage('Loading original image…'),
        'photo-viewer-status'
      ),
      actions = el('div', undefined, 'photo-zoom-actions'),
      value = el('span', '—', 'photo-zoom-value'),
      minus = el('button', '−'),
      plus = el('button', '+'),
      fit = el('button', uiMessage('Fit')),
      actual = el('button', '100%'),
      fullscreen = el('button', uiMessage('Fullscreen')),
      navigation = el('div', undefined, 'photo-gallery-actions'),
      previous = el('button', undefined, 'photo-gallery-button'),
      next = el('button', undefined, 'photo-gallery-button'),
      counter = el('span', undefined, 'photo-gallery-count'),
      events = new AbortController()
    const editButton = el('button', uiMessage('Edit photo')),
      editor = el('section', undefined, 'product-photo-editor'),
      mode = el('select'),
      background = el('input'),
      apply = el('button', uiMessage('Save photo')),
      reset = el('button', uiMessage('Reset photo')),
      cancelEdit = el('button', uiMessage('Cancel'))
    let editing = false,
      originalData,
      originalSize,
      editCanvasReady = false,
      editingVersion = 0,
      draftEdit = { ...DEFAULT_PHOTO_EDIT }
    let savingPhoto = false
    editor.hidden = true
    const sliders = {}
    const editControl = (label, control) => {
      const field = el('div'),
        caption = el('label', uiMessage(label))
      control.id = `photo-edit-${crypto.randomUUID()}`
      caption.htmlFor = control.id
      field.append(caption, control)
      editor.append(field)
    }
    for (const [label, value] of [
      ['Fit inside square', 'contain'],
      ['Fill square (crop)', 'cover'],
    ]) {
      const option = new Option('', value)
      bindText(option, uiMessage(label))
      mode.append(option)
    }
    editControl('Canvas fit', mode)
    for (const [key, label, min, max, step] of [
      ['scale', 'Image size', 0.1, 4, 0.05],
      ['x', 'Horizontal position', -1, 1, 0.01],
      ['y', 'Vertical position', -1, 1, 0.01],
    ]) {
      const input = el('input')
      input.type = 'range'
      input.min = min
      input.max = max
      input.step = step
      sliders[key] = input
      editControl(label, input)
      input.addEventListener('input', () => {
        updateComposition({ [key]: Number(input.value) })
      })
    }
    background.type = 'color'
    editControl('Canvas background', background)
    const editActions = el('div', undefined, 'product-photo-editor-actions')
    decorateIcon(reset, 'undo', { iconOnly: true })
    apply.classList.add('primary')
    editActions.append(reset, cancelEdit, apply)
    mode.onchange = () => {
      updateComposition({ fit: mode.value })
    }
    background.oninput = () => {
      draftEdit.background = background.value
      void renderEdit()
    }
    const setEditorControls = () => {
      mode.value = draftEdit.fit
      background.value = draftEdit.background
      for (const [key, input] of Object.entries(sliders))
        input.value = draftEdit[key]
    }
    function updateComposition(patch) {
      const next = { ...draftEdit, ...patch }
      try {
        if (draftEdit.tags?.length)
          next.tags = reprojectPhotoVariantTags(
            draftEdit.tags,
            originalSize,
            draftEdit,
            next
          )
        draftEdit = next
        tagEditor.refresh()
        void renderEdit()
      } catch (error) {
        setEditorControls()
        bindText(status, uiMessage(error.message))
      }
    }
    async function displayPhoto(
      data,
      isCurrent = () => true,
      preserveView = false
    ) {
      const loaded = el('img')
      loaded.draggable = false
      loaded.alt = caption.textContent || t('Product')
      loaded.src = data
      await loaded.decode()
      if (!modal.open || !isCurrent()) return
      const sameSize =
        preserveView &&
        ready &&
        image.naturalWidth === loaded.naturalWidth &&
        image.naturalHeight === loaded.naturalHeight
      image.replaceWith(loaded)
      image = loaded
      image.style.width = `${image.naturalWidth}px`
      image.style.height = `${image.naturalHeight}px`
      ready = true
      if (!sameSize) {
        fitted = true
        x = y = 0
      }
      resize()
    }
    async function renderEdit() {
      if (!originalData) return
      const version = ++editingVersion
      apply.disabled = true
      try {
        const result = await squareProductPhoto(originalData, {
          ...structuredClone(draftEdit),
          tags: [],
        })
        if (version !== editingVersion || !modal.open || !editing) return
        await displayPhoto(
          result,
          () => version === editingVersion && editing,
          true
        )
        if (version === editingVersion && editing) {
          editCanvasReady = true
          tagEditor.refresh()
          apply.disabled = false
        }
      } catch (error) {
        bindText(status, uiMessage(error.message))
      }
    }
    editButton.onclick = () => {
      if (!originalData) return
      editing = true
      editCanvasReady = false
      editor.hidden = false
      editButton.hidden = true
      draftEdit = {
        ...DEFAULT_PHOTO_EDIT,
        ...structuredClone(
          gallery[index].photoEdits?.[gallery[index].photoIndex] || {}
        ),
      }
      tagEditor.reset()
      setEditorControls()
      void renderEdit()
      bindText(
        status,
        uiMessage(
          'Compose the photo and add variant tags. The original photo is kept.'
        )
      )
    }
    reset.onclick = () => {
      draftEdit = { ...DEFAULT_PHOTO_EDIT }
      tagEditor.reset()
      setEditorControls()
      void renderEdit()
    }
    cancelEdit.onclick = () => {
      editing = false
      tagEditor.reset()
      editor.hidden = true
      void showPhoto(index)
    }
    apply.onclick = async () => {
      if (savingPhoto || !tagEditor.valid()) return
      tagEditor.cancelPlacement()
      savingPhoto = true
      apply.disabled = true
      for (const control of editor.querySelectorAll('input,select,button'))
        control.disabled = true
      previous.disabled = next.disabled = true
      const selected = gallery[index],
        edit = structuredClone(draftEdit)
      try {
        const thumbnail = await squareProductPhoto(originalData, edit)
        await onEdit(selected.photoSource, {
          photoIndex: selected.photoIndex,
          thumbnail,
          edit,
          originalPhoto: selected.originalPhoto,
        })
        selected.photoSource.photos ||= [selected.originalPhoto]
        if (selected.photoIndex === 0)
          selected.photoSource.thumbnail = thumbnail
        selected.photoSource.photoEdits = {
          ...selected.photoSource.photoEdits,
          [selected.photoIndex]: edit,
        }
        selected.photoEdits = selected.photoSource.photoEdits
        await displayPhoto(thumbnail, () => modal.open, true)
        editing = false
        tagEditor.reset()
        editor.hidden = true
        editButton.hidden = false
        bindText(status, uiMessage('Photo saved. Original preserved.'))
      } catch (error) {
        bindText(status, uiMessage(error.message))
      } finally {
        savingPhoto = false
        for (const control of editor.querySelectorAll('input,select,button'))
          control.disabled = false
        previous.disabled = index === 0
        next.disabled = index === gallery.length - 1
        apply.disabled = false
        tagEditor.refresh()
      }
    }
    let image = el('img'),
      loadVersion = 0
    const tagEditor = mountPhotoVariantTagEditor({
      host: editor,
      actions: editActions,
      viewport,
      getImage: () => image,
      getEdit: () => draftEdit,
      active: () => editing && editCanvasReady,
      saving: () => savingPhoto,
      status,
      signal: events.signal,
    })
    bindAttribute(close, 'aria-label', uiMessage('Close product photo'))
    bindAttribute(minus, 'aria-label', uiMessage('Zoom out'))
    bindAttribute(plus, 'aria-label', uiMessage('Zoom in'))
    minus.setAttribute('aria-keyshortcuts', 'ArrowDown -')
    plus.setAttribute('aria-keyshortcuts', 'ArrowUp')
    fit.setAttribute('aria-keyshortcuts', '0 F')
    bindAttribute(actual, 'aria-label', uiMessage('Actual size (100%)'))
    for (const [button, name, symbol] of [
      [previous, 'Previous photo', 'previous'],
      [next, 'Next photo', 'next'],
    ]) {
      button.type = 'button'
      bindAttribute(button, 'aria-label', uiMessage(name))
      preparationHelp(button, uiMessage(name))
      button.append(icon(symbol))
    }
    fullscreen.setAttribute('aria-pressed', 'false')
    previous.setAttribute('aria-keyshortcuts', 'ArrowLeft PageUp')
    next.setAttribute('aria-keyshortcuts', 'ArrowRight PageDown')
    viewport.tabIndex = 0
    viewport.setAttribute('role', 'region')
    bindAttribute(
      viewport,
      'aria-label',
      uiMessage(
        'Product image. Left and right arrows change photos; up and down arrows or plus and minus zoom; 0 fits.'
      )
    )
    status.setAttribute('role', 'status')
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
      tagEditor.paint(image.style.transform)
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
    close.onclick = () => {
      if (!savingPhoto) modal.close()
    }
    previous.onclick = () => void showPhoto(index - 1)
    next.onclick = () => void showPhoto(index + 1)
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
        bindText(
          status,
          uiMessage(
            'Fullscreen is unavailable in this browser. You can still zoom and drag the image.'
          )
        )
      }
    }
    listen(document, 'fullscreenchange', () => {
      const active = document.fullscreenElement === frame
      bindText(
        fullscreen,
        active ? uiMessage('Exit fullscreen') : uiMessage('Fullscreen')
      )
      fullscreen.setAttribute('aria-pressed', String(active))
      resize()
    })
    listen(modal, 'cancel', async (event) => {
      if (savingPhoto) {
        event.preventDefault()
        return
      }
      if (document.fullscreenElement === frame) {
        event.preventDefault()
        try {
          await document.exitFullscreen()
        } catch {
          bindText(
            status,
            uiMessage(
              'Use Exit fullscreen or your browser’s fullscreen control to return.'
            )
          )
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
      if (
        event.target.closest('[data-tag-handle]') ||
        viewport.classList.contains('is-placing-tag')
      )
        return
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
      if (savingPhoto) return
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.target.closest?.(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"]'
        ) ||
        (event.shiftKey && /^(Arrow|Page)/.test(event.key))
      )
        return
      if (
        ['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(event.key)
      ) {
        event.preventDefault()
        void showPhoto(
          index + (event.key === 'ArrowLeft' || event.key === 'PageUp' ? -1 : 1)
        )
        return
      }
      if (!ready) return
      if (['ArrowUp', '+', '='].includes(event.key)) zoomTo(scale * 1.5)
      else if (['ArrowDown', '-', '_'].includes(event.key)) zoomTo(scale / 1.5)
      else if (event.key === '0' || event.key.toLowerCase() === 'f')
        zoomTo(fitScale)
      else return
      event.preventDefault()
    })
    const observer = new ResizeObserver(resize)
    observer.observe(viewport)
    for (const button of [minus, plus, fit, actual]) button.disabled = true
    navigation.append(previous, counter, next)
    actions.append(
      minus,
      value,
      plus,
      fit,
      actual,
      fullscreen,
      editButton,
      navigation
    )
    heading.append(title, caption)
    viewport.append(image)
    frame.append(close, heading, actions, editor, viewport, status)
    modal.append(frame)
    document.body.append(modal)
    modal.onclose = () => {
      loadVersion++
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
    async function showPhoto(position) {
      if (
        savingPhoto ||
        position < 0 ||
        position >= gallery.length ||
        !modal.open
      )
        return
      const version = ++loadVersion,
        selected = gallery[position]
      index = position
      editing = false
      editCanvasReady = false
      tagEditor.reset()
      editingVersion++
      editor.hidden = true
      originalData = undefined
      originalSize = undefined
      editButton.hidden = !onEdit
      editButton.disabled = true
      stopDrag()
      ready = false
      image.hidden = true
      image.removeAttribute('src')
      viewport.classList.remove('can-pan')
      value.textContent = '—'
      previous.disabled = index === 0
      next.disabled = index === gallery.length - 1
      bindText(
        counter,
        () =>
          `${(index + 1).toLocaleString(getLocale())} / ${gallery.length.toLocaleString(getLocale())}`
      )
      preparationHelp(
        counter,
        uiMessage('Photo {position} of {total}', {
          position: () => index + 1,
          total: gallery.length,
        })
      )
      const sourceName =
        selected.title || selected.description?.split('\n')[0] || ''
      caption.textContent = sourceName
      caption.hidden = !sourceName
      for (const button of [minus, plus, fit, actual]) button.disabled = true
      bindText(status, uiMessage('Loading original image…'))
      try {
        const data = await loadImage(
          selected.originalPhoto || selected.thumbnail
        )
        if (!modal.open || version !== loadVersion) return
        originalData = data
        const sourceImage = new Image()
        sourceImage.src = data
        await sourceImage.decode()
        if (!modal.open || version !== loadVersion) return
        originalSize = {
          width: sourceImage.naturalWidth,
          height: sourceImage.naturalHeight,
        }
        const displayData = selected.photoEdits?.[selected.photoIndex]
          ? await squareProductPhoto(
              data,
              selected.photoEdits[selected.photoIndex]
            )
          : data
        if (!modal.open || version !== loadVersion) return
        const loaded = el('img')
        loaded.draggable = false
        if (sourceName) loaded.alt = sourceName
        else bindAttribute(loaded, 'alt', uiMessage('Product'))
        loaded.src = displayData
        await loaded.decode()
        if (!modal.open || version !== loadVersion) return
        image.replaceWith(loaded)
        image = loaded
        image.style.width = `${image.naturalWidth}px`
        image.style.height = `${image.naturalHeight}px`
        ready = true
        fitted = true
        x = y = 0
        for (const button of [plus, fit, actual]) button.disabled = false
        resize()
        editButton.disabled = false
        bindText(
          status,
          uiMessage(
            '← / → photos · ↑ / ↓ or + / − zoom · Scroll to zoom · Drag to move · Double-click to zoom or fit · 0 fits'
          )
        )
      } catch (error) {
        if (modal.open && version === loadVersion)
          bindText(status, error.message)
      }
    }
    await showPhoto(index)
  }
  return { open, close: () => current?.close() }
}
