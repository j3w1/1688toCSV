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
import { preparationHelp } from './preparation-help.js'

/** A separate grip keeps text editing, row selection and photo clicks independent. */
export function reorderHandle({ key, label, items, element, move }) {
  const handle = el('button', '⠿', 'reorder-handle')
  handle.type = 'button'
  bindAttribute(
    handle,
    'aria-label',
    uiMessage('Move {0}; use Up or Down arrows', { 0: label })
  )
  preparationHelp(
    handle,
    uiMessage(
      'Drag to reorder. Or focus here and press ↑ or ↓. Codes stay with their products.'
    )
  )
  let drag, scrollFrame
  function clear() {
    cancelAnimationFrame(scrollFrame)
    scrollFrame = undefined
    if (!drag) return
    for (const id of items())
      element(id)?.classList.remove('drop-before', 'drop-after')
    element(key)?.classList.remove('is-dragging')
    handle.classList.remove('dragging')
    delete handle.dataset.reorderCaptured
    drag = null
  }
  function edgeScroll() {
    scrollFrame = undefined
    if (!drag?.started) return
    const scroller = handle.closest('.packing-order-sections')
    const bounds = scroller?.getBoundingClientRect() || {
      top: 0,
      bottom: innerHeight,
    }
    const delta =
      drag.y < bounds.top + 60 ? -16 : drag.y > bounds.bottom - 60 ? 16 : 0
    if (delta) {
      if (scroller) scroller.scrollBy(0, delta)
      else window.scrollBy(0, delta)
      findTarget(drag.x, drag.y)
      scrollFrame = requestAnimationFrame(edgeScroll)
    }
  }
  function findTarget(x, y) {
    drag.target = null
    for (const id of items()) {
      const target = element(id)
      if (!target) continue
      target.classList.remove('drop-before', 'drop-after')
      if (id === key) continue
      const box = target.getBoundingClientRect()
      if (y >= box.top && y <= box.bottom && x >= box.left && x <= box.right) {
        drag.target = id
        drag.after = y > box.top + box.height / 2
        target.classList.add(drag.after ? 'drop-after' : 'drop-before')
      }
    }
  }
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    drag = {
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      target: null,
      after: false,
    }
    handle.dataset.reorderCaptured = ''
    handle.setPointerCapture(event.pointerId)
  })
  handle.addEventListener('pointermove', (event) => {
    if (!drag || !handle.hasPointerCapture(event.pointerId)) return
    if (
      !drag.started &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5
    )
      return
    drag.started = true
    drag.x = event.clientX
    drag.y = event.clientY
    handle.classList.add('dragging')
    element(key)?.classList.add('is-dragging')
    findTarget(event.clientX, event.clientY)
    if (scrollFrame === undefined)
      scrollFrame = requestAnimationFrame(edgeScroll)
  })
  handle.addEventListener('pointerup', (event) => {
    if (!drag) return
    const { target, after, started } = drag
    clear()
    if (handle.hasPointerCapture(event.pointerId))
      handle.releasePointerCapture(event.pointerId)
    if (started && target) move(key, target, after)
  })
  handle.addEventListener('lostpointercapture', clear)
  handle.addEventListener('pointercancel', clear)
  handle.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
    const keys = items(),
      index = keys.indexOf(key),
      next = index + (event.key === 'ArrowDown' ? 1 : -1)
    if (index < 0 || next < 0 || next >= keys.length) return
    event.preventDefault()
    event.stopPropagation()
    move(key, keys[next], next > index)
  })
  return handle
}

export function movedKeys(keys, key, target, after) {
  if (key === target || !keys.includes(key) || !keys.includes(target))
    return keys
  const result = keys.filter((entry) => entry !== key)
  result.splice(result.indexOf(target) + Number(after), 0, key)
  return result
}
