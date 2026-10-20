import { element as el } from './ui.js'
import { bindAttribute, bindText, message as m } from './i18n.js'
import { preparationHelp } from './preparation-help.js'
import { decorateIcon } from './icons.js'
import { photoVariantTagLayout, drawPhotoVariantTags } from './product-photo.js'

const clamp = (value) => Math.max(0, Math.min(1, value))
const validCode = (value) => /^[A-Z0-9]{1,8}$/.test(value)

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
    sizeControl = el('div', undefined, 'photo-tag-size'),
    sizeLabel = el('label', m('Tag size')),
    sizeInput = el('input'),
    sizeValue = el('span', '100%'),
    list = el('div', undefined, 'photo-variant-tag-list'),
    overlay = el('div', undefined, 'photo-variant-tag-overlay'),
    artwork = document.createElement('canvas'),
    context = artwork.getContext('2d'),
    handles = new Map(),
    chips = new Map()
  code.type = 'text'
  code.id = `photo-variant-code-${crypto.randomUUID()}`
  codeLabel.htmlFor = code.id
  code.value = 'A'
  code.maxLength = 8
  code.pattern = '[A-Za-z0-9]{1,8}'
  code.required = true
  code.autocomplete = 'off'
  code.spellcheck = false
  code.placeholder = 'A / AX'
  for (const button of [add, rename, remove]) button.type = 'button'
  list.setAttribute('role', 'group')
  bindAttribute(list, 'aria-label', m('Photo variant tags'))
  entry.append(code, add)
  tools.append(rename, remove)
  for (const [button, name] of [
    [add, 'plus'],
    [rename, 'edit'],
    [remove, 'trash'],
  ])
    decorateIcon(button, name, { iconOnly: true })
  sizeInput.type = 'range'
  sizeInput.min = '0.6'
  sizeInput.max = '2.5'
  sizeInput.step = '0.05'
  sizeInput.value = '1'
  sizeInput.id = `photo-tags-size-${crypto.randomUUID()}`
  sizeLabel.htmlFor = sizeInput.id
  sizeControl.append(sizeLabel, sizeInput, sizeValue)
  controls.append(codeLabel, entry, tools, list, sizeControl)
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
  }
  function choose(id) {
    selected = id
    const tag = tags().find((tag) => tag.id === id)
    if (tag) code.value = tag.code
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
        getEdit().tagScale ?? 1
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
      drawPhotoVariantTags(context, values, size, getEdit().tagScale ?? 1)
    sizeInput.disabled = !enabled || saving()
    sizeInput.value = String(getEdit().tagScale ?? 1)
    sizeValue.textContent = `${Math.round(Number(sizeInput.value) * 100)}%`
    code.disabled = !enabled || saving()
    if (!ids.has(selected)) selected = null
    remove.disabled = !selected || saving()
    rename.disabled = !enabled || !selected || saving()
    add.disabled = !enabled || values.length >= 50 || saving()
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
        getEdit().tagScale ?? 1
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
  listen(add, 'click', () => {
    if (placing) {
      setPlacing(false)
      return
    }
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
  })
  listen(remove, 'click', removeSelected)
  listen(sizeInput, 'input', () => {
    getEdit().tagScale = Number(sizeInput.value)
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
  })
  listen(code, 'keydown', (event) => {
    if (event.key !== 'Enter') return
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
        drag = {
          pointerId: event.pointerId,
          handle,
          kind: handle.dataset.tagHandle,
          start: point(event),
          tag: { ...tag },
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
      const tag = {
        id: crypto.randomUUID(),
        code: code.value.toUpperCase(),
        x: p.x,
        y: p.y,
        labelX: clamp(p.x + 0.14),
        labelY: clamp(p.y - 0.12),
      }
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
      code.value = 'A'
      code.removeAttribute('aria-invalid')
      refresh()
    },
    cancelPlacement() {
      setPlacing(false)
    },
  }
}
