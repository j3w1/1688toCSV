import { element as el } from './ui.js'
import { bindAttribute, bindText, message as m } from './i18n.js'
import { preparationHelp } from './preparation-help.js'
import { decorateIcon } from './icons.js'
import {
  photoVariantTagLayout,
  drawPhotoVariantTags,
  PHOTO_TAG_SCALE,
  PHOTO_POINTER_SCALE,
  nearestPhotoTagCorner,
} from './product-photo.js'
import { DEFAULT_SIZE_VOCABULARY } from './size-vocabulary.js'

const clamp = (value) => Math.max(0, Math.min(1, value))
const validCode = (value) => /^[A-Z0-9]{1,8}$/.test(value)
const sizeSuffixes = [
  ...new Set(DEFAULT_SIZE_VOCABULARY.map(({ suffix }) => suffix)),
].sort((a, b) => b.length - a.length)
const quickSizes = DEFAULT_SIZE_VOCABULARY.map(({ suffix }) => suffix).filter(
  (suffix) => ['XS', 'S', 'M', 'L', 'XL'].includes(suffix)
)
const splitCode = (code) => {
  const size = sizeSuffixes.find((suffix) => code.endsWith(suffix)) || ''
  return { model: size ? code.slice(0, -size.length) : code, size }
}
const nearestScaleStop = (value, stops) =>
  stops.reduce(
    (nearest, stop, index) =>
      Math.abs(stop - value) < Math.abs(stops[nearest] - value)
        ? index
        : nearest,
    0
  )

function showScale(input, output, value, { stops }) {
  // An older continuous value remains exact in the draft. Only moving the
  // indexed control chooses a new standard size; opening or saving does not.
  input.value = String(nearestScaleStop(value, stops))
  output.textContent = `${Number((value * 100).toFixed(8))}%`
  input.setAttribute('aria-valuetext', output.textContent)
}

/** Transparent, keyboard-operable handles sit over the same rendered callouts. */
export function mountPhotoVariantTagEditor({
  host,
  actions,
  viewport,
  getImage,
  getEdit,
  active,
  saving,
  status,
  signal,
}) {
  const controls = el('div', undefined, 'photo-variant-tag-controls'),
    codeLabel = el('label', m('Variant tag')),
    code = el('input'),
    add = el('button', m('Add tag')),
    rename = el('button', m('Rename tag')),
    remove = el('button', m('Remove tag')),
    entry = el('div', undefined, 'photo-tag-entry'),
    tools = el('div', undefined, 'photo-tag-tools'),
    quick = el('div', undefined, 'photo-tag-quick'),
    quickPalette = el('div', undefined, 'photo-tag-palette'),
    quickSize = el('div', undefined, 'photo-tag-quick'),
    custom = el('div', undefined, 'photo-tag-custom'),
    scales = el('div', undefined, 'photo-tag-scales'),
    sizeControl = el('div', undefined, 'photo-tag-size'),
    sizeLabel = el('label', m('Tag size')),
    sizeInput = el('input'),
    sizeValue = el('span', '100%'),
    pointerControl = el('div', undefined, 'photo-tag-size photo-pointer-size'),
    pointerLabel = el('label', m('Pointer size')),
    pointerInput = el('input'),
    pointerValue = el('span', '100%'),
    invert = el('button', undefined, 'photo-pointer-invert'),
    list = el('div', undefined, 'photo-variant-tag-list'),
    overlay = el('div', undefined, 'photo-variant-tag-overlay'),
    artwork = document.createElement('canvas'),
    context = artwork.getContext('2d'),
    handles = new Map(),
    chips = new Map(),
    quickButtons = new Map(),
    quickSizeButtons = new Map()
  code.type = 'text'
  code.id = `photo-variant-code-${crypto.randomUUID()}`
  codeLabel.htmlFor = code.id
  code.value = ''
  code.maxLength = 8
  code.pattern = '[A-Za-z0-9]{1,8}'
  code.required = true
  code.autocomplete = 'off'
  code.setAttribute('autocorrect', 'off')
  code.setAttribute('autocapitalize', 'off')
  code.spellcheck = false
  code.placeholder = 'A / AX'
  for (const button of [add, rename, remove]) button.type = 'button'
  list.setAttribute('role', 'group')
  bindAttribute(list, 'aria-label', m('Photo variant tags'))
  quick.setAttribute('role', 'group')
  bindAttribute(quick, 'aria-label', m('Quick model tags'))
  quick.append(el('span', m('Color / model'), 'photo-tag-quick-label'))
  for (const value of ['A', 'B', 'C', 'D', 'E']) {
    const button = el('button', value, 'photo-tag-quick-button')
    button.type = 'button'
    bindAttribute(button, 'aria-label', m('Add tag {0}', { 0: value }))
    button.setAttribute('aria-pressed', 'false')
    quickButtons.set(value, button)
    quick.append(button)
  }
  quickSize.setAttribute('role', 'group')
  bindAttribute(quickSize, 'aria-label', m('Quick size tags'))
  quickSize.append(el('span', m('Size'), 'photo-tag-quick-label'))
  for (const value of quickSizes) {
    const button = el('button', value, 'photo-tag-quick-button')
    button.type = 'button'
    bindAttribute(button, 'aria-label', m('Use tag size {0}', { 0: value }))
    button.setAttribute('aria-pressed', 'false')
    quickSizeButtons.set(value, button)
    quickSize.append(button)
  }
  quickPalette.append(quick, quickSize)
  entry.append(code, add)
  tools.append(rename, remove)
  for (const [button, name] of [
    [add, 'plus'],
    [rename, 'edit'],
    [remove, 'trash'],
  ])
    decorateIcon(button, name, { iconOnly: true })
  sizeInput.type = 'range'
  sizeInput.min = '0'
  sizeInput.max = String(PHOTO_TAG_SCALE.stops.length - 1)
  sizeInput.step = '1'
  sizeInput.value = String(PHOTO_TAG_SCALE.stops.indexOf(1))
  sizeInput.id = `photo-tags-size-${crypto.randomUUID()}`
  sizeLabel.htmlFor = sizeInput.id
  sizeControl.append(sizeLabel, sizeInput, sizeValue)
  pointerInput.type = 'range'
  pointerInput.min = '0'
  pointerInput.max = String(PHOTO_POINTER_SCALE.stops.length - 1)
  pointerInput.step = '1'
  pointerInput.value = String(PHOTO_POINTER_SCALE.stops.indexOf(1))
  pointerInput.id = `photo-pointer-size-${crypto.randomUUID()}`
  pointerLabel.htmlFor = pointerInput.id
  invert.type = 'button'
  bindAttribute(invert, 'aria-label', m('Invert pointer'))
  bindAttribute(invert, 'title', m('Invert pointer'))
  invert.setAttribute('aria-pressed', 'false')
  const swatch = el('i', undefined, 'photo-pointer-swatch')
  swatch.setAttribute('aria-hidden', 'true')
  invert.append(swatch)
  pointerControl.append(pointerLabel, pointerInput, pointerValue, invert)
  custom.append(codeLabel, entry, tools)
  scales.append(sizeControl, pointerControl)
  controls.append(quickPalette, custom, list, scales)
  if (actions) controls.append(actions)
  host.append(controls)
  overlay.append(artwork)
  viewport.append(overlay)
  preparationHelp(
    code,
    m(
      'Use 1–8 letters or numbers. These photo tags do not change the product barcode.'
    )
  )
  preparationHelp(
    sizeInput,
    m(
      'Resize every tag, point and connecting line in this photo together. Save photo to keep this size.'
    )
  )
  preparationHelp(
    pointerInput,
    m(
      'Resize every pointing circle in this photo without changing the labels or lines. Save photo to keep this size.'
    )
  )
  preparationHelp(
    invert,
    m(
      'Use white lines and white circles with black centers on dark products. Labels stay black with white text. Save photo to keep this setting.'
    )
  )
  preparationHelp(
    add,
    m(
      'Enter a variant code, choose Add tag, then click its product in the photo. Drag the dot or label to position it.'
    )
  )
  preparationHelp(
    remove,
    m('Remove the selected photo tag. Save photo to keep your changes.')
  )
  preparationHelp(
    rename,
    m('Select a tag, enter its new code, then choose Rename tag.')
  )
  let selected = null,
    placing = false,
    drag = null
  const tags = () => getEdit().tags || []
  const listen = (target, name, fn, options = {}) =>
    target.addEventListener(name, fn, { ...options, signal })
  const point = (event) => {
    const bounds = getImage().getBoundingClientRect()
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    }
  }
  function setPlacing(value) {
    placing = value
    viewport.classList.toggle('is-placing-tag', value)
    add.setAttribute('aria-pressed', String(value))
    decorateIcon(add, value ? 'close' : 'plus', {
      iconOnly: true,
      label: m(value ? 'Cancel placement' : 'Add tag'),
    })
    syncQuickButtons()
  }
  function syncQuickButtons() {
    const parts = splitCode(code.value)
    for (const [values, part] of [
      [quickButtons, parts.model],
      [quickSizeButtons, parts.size],
    ])
      for (const [value, button] of values)
        button.setAttribute('aria-pressed', String(part === value))
  }
  function choose(id) {
    selected = id
    const tag = tags().find((tag) => tag.id === id)
    if (tag) code.value = tag.code
    setPlacing(false)
    code.removeAttribute('aria-invalid')
    refresh()
  }
  function removeSelected() {
    if (!selected || saving()) return
    getEdit().tags = tags().filter((tag) => tag.id !== selected)
    selected = null
    refresh()
  }
  function move(tag, kind, px, py) {
    if (kind === 'point') {
      tag.x = clamp(px)
      tag.y = clamp(py)
    } else {
      const size = getImage()?.naturalWidth || 640
      const { badge } = photoVariantTagLayout(
        { ...tag, labelX: clamp(px), labelY: clamp(py) },
        size,
        context,
        getEdit().tagScale ?? 1,
        getEdit().pointerScale ?? 1
      )
      tag.labelX = (badge.x + badge.width / 2) / size
      tag.labelY = (badge.y + badge.height / 2) / size
    }
    refresh()
  }
  function makeHandle(tag, kind) {
    const button = el('button', undefined, `photo-tag-handle photo-tag-${kind}`)
    button.type = 'button'
    button.dataset.photoTag = tag.id
    button.dataset.tagHandle = kind
    preparationHelp(
      button,
      m(
        'Drag to move. Arrow keys make small adjustments; Shift moves farther. Delete removes the tag.'
      )
    )
    listen(button, 'click', (event) => {
      event.stopPropagation()
      choose(tag.id)
    })
    listen(button, 'keydown', (event) => {
      if (!active() || saving()) return
      const current = tags().find((value) => value.id === tag.id)
      if (!current) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        event.stopPropagation()
        choose(tag.id)
        removeSelected()
        return
      }
      const delta = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[event.key]
      if (!delta) return
      event.preventDefault()
      event.stopPropagation()
      choose(tag.id)
      const step = event.shiftKey ? 0.02 : 0.005
      move(
        current,
        kind,
        (kind === 'point' ? current.x : current.labelX) + delta[0] * step,
        (kind === 'point' ? current.y : current.labelY) + delta[1] * step
      )
    })
    overlay.append(button)
    return button
  }
  function refresh() {
    const enabled = active(),
      values = tags(),
      ids = new Set(values.map((tag) => tag.id))
    overlay.hidden = !enabled
    const size = enabled ? getImage()?.naturalWidth || 640 : 640
    if (artwork.width !== size) artwork.width = artwork.height = size
    context.clearRect(0, 0, size, size)
    if (enabled)
      drawPhotoVariantTags(
        context,
        values,
        size,
        getEdit().tagScale ?? 1,
        getEdit().pointerScale ?? 1,
        getEdit().invertPointer ?? false
      )
    sizeInput.disabled = !enabled || saving()
    showScale(sizeInput, sizeValue, getEdit().tagScale ?? 1, PHOTO_TAG_SCALE)
    pointerInput.disabled = !enabled || saving()
    invert.disabled = !enabled || saving()
    invert.setAttribute(
      'aria-pressed',
      String(getEdit().invertPointer ?? false)
    )
    showScale(
      pointerInput,
      pointerValue,
      getEdit().pointerScale ?? 1,
      PHOTO_POINTER_SCALE
    )
    code.disabled = !enabled || saving()
    syncQuickButtons()
    if (!ids.has(selected)) selected = null
    remove.disabled = !selected || saving()
    rename.disabled = !enabled || !selected || saving()
    add.disabled = !enabled || values.length >= 50 || saving()
    for (const button of [
      ...quickButtons.values(),
      ...quickSizeButtons.values(),
    ])
      button.disabled = add.disabled
    for (const [id, pair] of handles)
      if (!ids.has(id)) {
        pair.point.remove()
        pair.label.remove()
        handles.delete(id)
      }
    for (const [id, button] of chips)
      if (!ids.has(id)) {
        button.remove()
        chips.delete(id)
      }
    for (const tag of values) {
      let pair = handles.get(tag.id)
      if (!pair) {
        pair = {
          point: makeHandle(tag, 'point'),
          label: makeHandle(tag, 'label'),
        }
        handles.set(tag.id, pair)
      }
      const layout = photoVariantTagLayout(
        tag,
        size,
        context,
        getEdit().tagScale ?? 1,
        getEdit().pointerScale ?? 1
      )
      for (const kind of ['point', 'label'])
        bindAttribute(
          pair[kind],
          'aria-label',
          m(
            kind === 'point'
              ? 'Move point for tag {0}'
              : 'Move label for tag {0}',
            { 0: tag.code }
          )
        )
      const hit = Math.max(24, layout.dot.radius * 2 + 6)
      Object.assign(pair.point.style, {
        left: `${layout.anchor.x - hit / 2}px`,
        top: `${layout.anchor.y - hit / 2}px`,
        width: `${hit}px`,
        height: `${hit}px`,
      })
      Object.assign(pair.label.style, {
        left: `${layout.badge.x}px`,
        top: `${layout.badge.y}px`,
        width: `${layout.badge.width}px`,
        height: `${layout.badge.height}px`,
      })
      for (const handle of Object.values(pair))
        handle.classList.toggle('is-selected', selected === tag.id)
      let chip = chips.get(tag.id)
      if (!chip) {
        chip = el('button', tag.code, 'photo-variant-tag-chip')
        chip.type = 'button'
        listen(chip, 'click', () => choose(tag.id))
        chips.set(tag.id, chip)
        list.append(chip)
      }
      chip.textContent = tag.code
      bindAttribute(chip, 'aria-label', m('Select tag {0}', { 0: tag.code }))
      chip.setAttribute('aria-pressed', String(selected === tag.id))
    }
  }
  function beginPlacement() {
    if (!active() || saving() || tags().length >= 50) return
    if (!validCode(code.value.toUpperCase())) {
      code.reportValidity()
      code.focus()
      return
    }
    selected = null
    setPlacing(true)
    bindText(status, m('Click the photo to place the variant tag.'))
    viewport.focus({ preventScroll: true })
    refresh()
  }
  listen(add, 'click', () => {
    if (placing) setPlacing(false)
    else beginPlacement()
  })
  for (const [value, button] of quickButtons)
    listen(button, 'click', () => {
      const parts = splitCode(code.value)
      useQuickCode(`${parts.model === value ? '' : value}${parts.size}`)
    })
  for (const [value, button] of quickSizeButtons)
    listen(button, 'click', () => {
      const parts = splitCode(code.value)
      useQuickCode(`${parts.model}${parts.size === value ? '' : value}`)
    })
  function useQuickCode(value) {
    if (value.length > code.maxLength) {
      bindText(
        status,
        m('Photo variant tag codes require 1–8 uppercase letters or digits')
      )
      return
    }
    selected = null
    code.value = value
    code.removeAttribute('aria-invalid')
    if (value) beginPlacement()
    else {
      setPlacing(false)
      refresh()
    }
  }
  listen(remove, 'click', removeSelected)
  listen(sizeInput, 'input', () => {
    getEdit().tagScale =
      PHOTO_TAG_SCALE.stops[Math.round(Number(sizeInput.value))]
    refresh()
  })
  listen(pointerInput, 'input', () => {
    getEdit().pointerScale =
      PHOTO_POINTER_SCALE.stops[Math.round(Number(pointerInput.value))]
    refresh()
  })
  listen(invert, 'click', () => {
    if (!active() || saving()) return
    getEdit().invertPointer = !(getEdit().invertPointer ?? false)
    refresh()
  })
  listen(rename, 'click', () => {
    if (!selected || !validCode(code.value)) {
      code.reportValidity()
      code.focus()
      return
    }
    const tag = tags().find((tag) => tag.id === selected)
    if (tag) {
      tag.code = code.value
      refresh()
    }
  })
  listen(code, 'input', () => {
    code.value = code.value.toUpperCase()
    code.removeAttribute('aria-invalid')
    setPlacing(placing)
  })
  listen(code, 'keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    if (selected) rename.click()
    else add.click()
  })
  listen(code, 'blur', () => {
    if (selected && !validCode(code.value))
      code.setAttribute('aria-invalid', 'true')
  })
  listen(
    viewport,
    'pointerdown',
    (event) => {
      if (!active() || saving() || event.button !== 0 || !event.isPrimary)
        return
      const handle = event.target.closest('[data-tag-handle]')
      if (handle) {
        event.preventDefault()
        event.stopPropagation()
        choose(handle.dataset.photoTag)
        setPlacing(false)
        handle.focus({ preventScroll: true })
        const tag = tags().find((tag) => tag.id === selected)
        let origin = { ...tag }
        if (handle.dataset.tagHandle === 'label') {
          // A renamed or resized badge may be clamped closer to the canvas
          // edge than its stored center. Drag from the center actually shown.
          const size = getImage()?.naturalWidth || 640
          const { badge } = photoVariantTagLayout(
            tag,
            size,
            context,
            getEdit().tagScale ?? 1,
            getEdit().pointerScale ?? 1
          )
          origin = {
            ...origin,
            labelX: (badge.x + badge.width / 2) / size,
            labelY: (badge.y + badge.height / 2) / size,
          }
        }
        drag = {
          pointerId: event.pointerId,
          handle,
          kind: handle.dataset.tagHandle,
          start: point(event),
          tag: origin,
        }
        handle.setPointerCapture(event.pointerId)
        return
      }
      if (!placing) return
      event.preventDefault()
      event.stopPropagation()
      if (!validCode(code.value.toUpperCase()) || tags().length >= 50) {
        code.reportValidity()
        code.focus()
        return
      }
      const p = point(event)
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return
      const tag = nearestPhotoTagCorner(
        {
          id: crypto.randomUUID(),
          code: code.value.toUpperCase(),
          x: p.x,
          y: p.y,
        },
        getImage()?.naturalWidth || 640,
        context,
        getEdit().tagScale ?? 1
      )
      getEdit().tags = [...tags(), tag]
      setPlacing(false)
      choose(tag.id)
      bindText(
        status,
        m('Drag the tag or its point to adjust it, then save the photo.')
      )
    },
    { capture: true }
  )
  listen(viewport, 'pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId || saving()) return
    event.preventDefault()
    const p = point(event),
      dx = p.x - drag.start.x,
      dy = p.y - drag.start.y
    const tag = tags().find((tag) => tag.id === drag.tag.id)
    if (tag)
      move(
        tag,
        drag.kind,
        (drag.kind === 'point' ? drag.tag.x : drag.tag.labelX) + dx,
        (drag.kind === 'point' ? drag.tag.y : drag.tag.labelY) + dy
      )
  })
  const stop = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const old = drag
    drag = null
    if (old.handle.hasPointerCapture(old.pointerId))
      old.handle.releasePointerCapture(old.pointerId)
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    listen(viewport, type, stop)
  listen(viewport, 'keydown', (event) => {
    if (event.key !== 'Escape' || !placing) return
    event.preventDefault()
    event.stopPropagation()
    setPlacing(false)
  })
  return {
    refresh,
    valid() {
      if (!selected || validCode(code.value)) return true
      code.setAttribute('aria-invalid', 'true')
      code.reportValidity()
      code.focus()
      return false
    },
    paint(transform) {
      overlay.style.transform = transform
      refresh()
    },
    reset() {
      selected = null
      setPlacing(false)
      code.value = ''
      code.removeAttribute('aria-invalid')
      refresh()
    },
    cancelPlacement() {
      setPlacing(false)
    },
  }
}
