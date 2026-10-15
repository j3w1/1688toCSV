let activeHint = null
const hints = new WeakMap()

/** Add help to an existing field or action, without another button or tab stop. */
export function preparationHelp(target, text) {
  if (hints.has(target)) {
    hints.get(target).textContent = text
    return target
  }
  const doc = target.ownerDocument,
    panel = doc.createElement('div'),
    nativePopover = 'popover' in panel
  panel.id = `help-${crypto.randomUUID()}`
  panel.className = 'preparation-help-popover'
  panel.textContent = text
  hints.set(target, panel)
  target.removeAttribute('title')
  panel.setAttribute('role', 'tooltip')
  if (nativePopover) panel.setAttribute('popover', 'manual')
  else panel.hidden = true
  target.classList.add('preparation-hint')
  let hovered = false,
    panelHovered = false,
    focused = false,
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
    panelHovered = false
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
      !target.isConnected ||
      !target.getClientRects().length ||
      target.querySelector('.preparation-hint:hover') ||
      !ownsDialog(doc.activeElement)
    )
      return
    if (activeHint === close) return
    activeHint?.()
    activeHint = close
    // Keep the tooltip in its modal dialog's top layer and accessibility tree.
    const host = target.closest('dialog') || doc.body
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
        event.preventDefault()
        event.stopPropagation()
        dismissed = hovered || focused
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
    if (!hovered && !focused) dismissed = false
    if (!hovered && !focused && !panelHovered) timer = setTimeout(close, 150)
  }
  target.addEventListener('pointerover', (event) => {
    if (!ownsHint(event.target) || ownsHint(event.relatedTarget)) return
    hovered = true
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
    show()
  })
  target.addEventListener('focusout', (event) => {
    focused = ownsHint(event.relatedTarget)
    leave()
  })
  for (const name of ['pointerdown', 'input'])
    target.addEventListener(name, () => {
      dismissed = hovered || focused
      close()
    })
  panel.addEventListener('pointerenter', () => {
    panelHovered = true
    clearTimeout(timer)
  })
  panel.addEventListener('pointerleave', () => {
    panelHovered = false
    leave()
  })
  return target
}
