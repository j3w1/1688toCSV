const controls =
  'button, a, input, select, textarea, label, [contenteditable]:not([contenteditable="false"])'

/** Shared selection for ordered lists. Keys come from the current filtered scope. */
export function createRowSelection({
  selected,
  getKeys,
  onChange,
  onActivate,
}) {
  const rows = new Map()
  let anchor = null,
    focused = null

  function paint() {
    for (const [key, row] of rows)
      if (!row.element.isConnected) rows.delete(key)
    const visible = getKeys().filter((key) => rows.has(key))
    if (!visible.includes(focused)) focused = visible[0] ?? null
    for (const [key, { element, attribute }] of rows) {
      element.setAttribute(attribute, String(selected.has(key)))
      element.classList.toggle('is-selected', selected.has(key))
      element.tabIndex = key === focused ? 0 : -1
    }
  }
  function notify() {
    onChange?.()
    paint()
  }
  function select(key, event = {}) {
    const keys = getKeys()
    if (!keys.includes(key)) return
    const additive = event.ctrlKey || event.metaKey
    if (event.shiftKey && keys.includes(anchor)) {
      if (!additive) selected.clear()
      const start = keys.indexOf(anchor),
        end = keys.indexOf(key)
      for (const id of keys.slice(
        Math.min(start, end),
        Math.max(start, end) + 1
      ))
        selected.add(id)
    } else {
      const wasSelected = selected.has(key)
      if (!additive) selected.clear()
      if (wasSelected) selected.delete(key)
      else selected.add(key)
      anchor = key
    }
    focused = key
    notify()
  }
  function clear() {
    reset()
    notify()
  }
  function reset() {
    selected.clear()
    anchor = null
    focused = null
  }
  function selectAll() {
    const keys = getKeys()
    selected.clear()
    for (const key of keys) selected.add(key)
    if (!keys.includes(anchor)) anchor = keys[0] ?? null
    notify()
  }
  function bind(element, key, { attribute = 'aria-selected' } = {}) {
    rows.set(key, { element, attribute })
    if (focused === null) focused = getKeys()[0] ?? null
    element.dataset.selectionKey = key
    element.classList.add('selectable-row')
    element.setAttribute(attribute, String(selected.has(key)))
    element.classList.toggle('is-selected', selected.has(key))
    element.tabIndex = focused === key ? 0 : -1
    const ownsEvent = (event) => {
      const target = event.target
      const control = target.closest(controls)
      return (
        target.closest('[data-selection-key]') === element &&
        (!control || control === element)
      )
    }
    element.addEventListener('pointerdown', (event) => {
      if (ownsEvent(event) && event.shiftKey) event.preventDefault()
    })
    element.addEventListener('click', (event) => {
      if (!ownsEvent(event)) return
      if (event.detail > 1) return
      element.focus({ preventScroll: true })
      select(key, event)
    })
    element.addEventListener('dblclick', (event) => {
      if (
        ownsEvent(event) &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey
      )
        onActivate?.(key)
    })
    element.addEventListener('keydown', (event) => {
      if (!ownsEvent(event) || event.altKey) return
      const additive = event.ctrlKey || event.metaKey
      if (additive && event.key.toLowerCase() === 'a') selectAll()
      else if (event.key === 'Escape') clear()
      else if (event.key === 'Enter' && onActivate) onActivate(key)
      else if (event.key === ' ' || event.key === 'Enter') select(key, event)
      else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        const visible = getKeys().filter(
          (id) => rows.get(id)?.element.isConnected
        )
        const index = visible.indexOf(key)
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? visible.length - 1
              : Math.max(
                  0,
                  Math.min(
                    visible.length - 1,
                    index + (event.key === 'ArrowDown' ? 1 : -1)
                  )
                )
        const id = visible[next]
        if (!id) return
        focused = id
        if (!additive || event.shiftKey) select(id, event)
        else paint()
        rows.get(id)?.element.focus()
      } else return
      event.preventDefault()
      event.stopPropagation()
    })
    return element
  }
  return {
    bind,
    select,
    paint,
    clear,
    selectAll,
    reset,
    detach: () => rows.clear(),
  }
}
