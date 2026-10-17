import { bindText, message } from './i18n.js'

let activeHint = null
const hints = new WeakMap()
const shortcutKeys = new WeakMap()
const interactionModes = new WeakMap()

function interactionMode(doc) {
  if (interactionModes.has(doc)) return interactionModes.get(doc)
  const mode = { keyboard: true, pointerVersion: 0 }
  doc.addEventListener(
    'pointerdown',
    () => {
      mode.keyboard = false
      mode.pointerVersion++
      activeHint?.()
    },
    true
  )
  doc.addEventListener(
    'keydown',
    (event) => {
      if (!['Alt', 'Control', 'Meta', 'Shift'].includes(event.key))
        mode.keyboard = true
    },
    true
  )
  interactionModes.set(doc, mode)
  return mode
}

/** Add help to an existing field or action, without another button or tab stop. */
export function preparationHelp(target, text) {
  if (hints.has(target)) {
    bindText(hints.get(target).content, text)
    return target
  }
  const doc = target.ownerDocument,
    mode = interactionMode(doc),
    panel = doc.createElement('div'),
    nativePopover = 'popover' in panel
  panel.id = `help-${crypto.randomUUID()}`
  panel.className = 'preparation-help-popover'
  const content = doc.createElement('span')
  bindText(content, text)
  panel.append(content)
  hints.set(target, { panel, content })
  target.removeAttribute('title')
  panel.setAttribute('role', 'tooltip')
  if (nativePopover) panel.setAttribute('popover', 'manual')
  else panel.hidden = true
  target.classList.add('preparation-hint')
  let hovered = false,
    pointerPosition,
    focused = false,
    keyboardFocused = false,
    focusPointerVersion = mode.pointerVersion,
    dismissed = false,
    timer,
    listeners,
    observer,
    controls = []

  function ownsDialog(node) {
    return (node?.closest?.('dialog') ?? null) === target.closest('dialog')
  }
  function ownsHint(node) {
    return node?.closest?.('.preparation-hint') === target
  }
  function keyboardFocus() {
    return (
      focused && keyboardFocused && focusPointerVersion === mode.pointerVersion
    )
  }

  function pointerOwnsTarget() {
    if (!hovered || !pointerPosition) return false
    const hit = doc.elementFromPoint(pointerPosition.x, pointerPosition.y)
    // A disabled pagination button can send focus back to the document body.
    // Pointer help follows the actual hit target instead, while a newer modal
    // or popover covering this control still prevents its helper from opening.
    return Boolean(hit && target.contains(hit) && ownsDialog(hit))
  }

  function position() {
    if (!target.isConnected || !target.getClientRects().length) return close()
    const bounds = target.getBoundingClientRect(),
      size = panel.getBoundingClientRect(),
      width = doc.documentElement.clientWidth,
      height = doc.documentElement.clientHeight
    panel.style.left = `${Math.max(8, Math.min(bounds.left, width - size.width - 8))}px`
    const top =
      bounds.bottom + size.height + 16 <= height
        ? bounds.bottom + 8
        : bounds.top - size.height - 8
    panel.style.top = `${Math.max(8, Math.min(top, height - size.height - 8))}px`
  }
  function close() {
    clearTimeout(timer)
    listeners?.abort()
    observer?.disconnect()
    if (nativePopover && panel.matches(':popover-open')) panel.hidePopover()
    panel.hidden = !nativePopover
    panel.remove()
    for (const control of controls) {
      const description = (control.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((id) => id && id !== panel.id)
        .join(' ')
      if (description) control.setAttribute('aria-describedby', description)
      else control.removeAttribute('aria-describedby')
    }
    controls = []
    if (activeHint === close) activeHint = null
  }
  function show() {
    clearTimeout(timer)
    if (
      dismissed ||
      (!pointerOwnsTarget() &&
        !(keyboardFocus() && ownsDialog(doc.activeElement))) ||
      !target.isConnected ||
      !target.getClientRects().length ||
      target.querySelector('.preparation-hint:hover')
    )
      return
    if (activeHint === close) return
    activeHint?.()
    activeHint = close
    // Keep the tooltip in its modal dialog's top layer and accessibility tree.
    const host = target.closest('dialog') || doc.body
    const keys = shortcutKeys.get(target)
    let shortcut = panel.querySelector('.preparation-help-shortcut')
    if (keys && !shortcut) {
      shortcut = doc.createElement('span')
      shortcut.className = 'preparation-help-shortcut'
      const label = doc.createElement('span')
      bindText(label, message('Shortcut outside text fields'))
      const keyboard = doc.createElement('kbd')
      keyboard.textContent = keys[0].replace('Control', 'Ctrl')
      shortcut.append(label, keyboard)
      panel.append(shortcut)
    }
    host.append(panel)
    if (nativePopover) panel.showPopover()
    else panel.hidden = false
    controls = target.matches(
      'input, select, textarea, button, summary, a, [tabindex]'
    )
      ? [target]
      : [
          ...target.querySelectorAll(
            'input, select, textarea, button, summary, a, [tabindex]'
          ),
        ].filter(ownsHint)
    for (const control of controls) {
      const previous = control.getAttribute('aria-describedby')
      control.setAttribute(
        'aria-describedby',
        previous ? `${previous} ${panel.id}` : panel.id
      )
    }
    position()
    listeners = new AbortController()
    const options = { capture: true, signal: listeners.signal }
    doc.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return
        // A photo or label dialog above this form owns its own Escape action.
        if (!ownsDialog(event.target)) return close()
        // A helper inside a modal closes before that modal. On the workspace,
        // let the owning view handle the same Escape (for example, save and
        // return from packing to Orders) after dismissing this nonmodal hint.
        if (target.closest('dialog')) {
          event.preventDefault()
          event.stopPropagation()
        }
        dismissed = hovered || keyboardFocus()
        close()
      },
      options
    )
    doc.addEventListener(
      'focusin',
      (event) => {
        if (!ownsDialog(event.target)) close()
      },
      options
    )
    doc.addEventListener('scroll', position, options)
    doc.defaultView.addEventListener('resize', position, options)
    host.addEventListener('close', close, { signal: listeners.signal })
    observer = new MutationObserver(() => {
      if (!target.isConnected) close()
    })
    observer.observe(host, { childList: true, subtree: true })
  }
  function leave() {
    clearTimeout(timer)
    if (!hovered && !keyboardFocus()) {
      dismissed = false
      close()
    }
  }
  target.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return
    if (!ownsHint(event.target) || ownsHint(event.relatedTarget)) return
    hovered = true
    pointerPosition = { x: event.clientX, y: event.clientY }
    clearTimeout(timer)
    if (!dismissed) timer = setTimeout(show, 500)
  })
  target.addEventListener('pointerout', (event) => {
    if (ownsHint(event.relatedTarget)) return
    hovered = false
    leave()
  })
  target.addEventListener('focusin', (event) => {
    if (!ownsHint(event.target)) {
      focused = false
      clearTimeout(timer)
      if (activeHint === close) close()
      return
    }
    focused = true
    // Row clicks can rerender and focus a fresh element. Remember the document's
    // input mode so that newly mounted helper cannot turn the click into a pin.
    keyboardFocused = mode.keyboard
    focusPointerVersion = mode.pointerVersion
    if (keyboardFocus()) show()
  })
  target.addEventListener('focusout', (event) => {
    focused = ownsHint(event.relatedTarget)
    leave()
  })
  for (const name of ['pointerdown', 'input'])
    target.addEventListener(name, () => {
      dismissed = hovered || keyboardFocus()
      close()
    })
  return target
}

/** Add shortcut metadata without replacing the action's changing scope help. */
export function preparationShortcut(target, keys) {
  shortcutKeys.set(target, keys)
  target.setAttribute('aria-keyshortcuts', keys.join(' '))
}
