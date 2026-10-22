import { createTableHeights, tableWindow } from './virtual-table.js'

/** Variable-height cards retain their DOM while a nearby window stays mounted. */
export function createVirtualList({
  scroller,
  sections,
  render,
  remove,
  paint,
  pinned = () => [],
  limit = 20,
}) {
  const entries = sections.flatMap((section) => section.entries),
    positions = new Map(entries.map((entry, index) => [entry.key, index])),
    nodes = new Map(),
    measured = new Map()
  let layout = createTableHeights(entries, measured, 450),
    range = { start: 0, end: 0 },
    frame,
    width = scroller.clientWidth,
    updating = false,
    disposed = false
  const observer = new ResizeObserver(schedule)
  function schedule() {
    if (disposed || updating || frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      update()
    })
  }
  function anchor() {
    const index = layout.at(scroller.scrollTop)
    return {
      key: entries[index]?.key,
      within: scroller.scrollTop - layout.offsets[index],
    }
  }
  function restore(value) {
    const index = positions.get(value?.key)
    if (index !== undefined)
      scroller.scrollTop = Math.max(0, layout.offsets[index] + value.within)
  }
  function update() {
    if (disposed) return
    updating = true
    const before = anchor()
    if (width && scroller.clientWidth !== width) measured.clear()
    width = scroller.clientWidth
    const first = layout.at(scroller.scrollTop)
    if (!range.end || first < range.start + 2 || first >= range.end - 4)
      range = tableWindow(entries, first, limit, 4)
    const indexes = new Set(
      Array.from({ length: range.end - range.start }, (_, i) => range.start + i)
    )
    const active =
      document.activeElement?.closest('[data-virtual-key]')?.dataset.virtualKey
    for (const key of [active, ...pinned(nodes)]) {
      const index = positions.get(key)
      if (index !== undefined) indexes.add(index)
    }
    const wanted = new Set([...indexes].map((index) => entries[index].key))
    for (const [key, node] of nodes)
      if (!wanted.has(key)) {
        observer.unobserve(node)
        remove?.(node, entries[positions.get(key)])
        node.remove()
        nodes.delete(key)
      }
    for (const index of [...indexes].sort((a, b) => a - b)) {
      const entry = entries[index]
      if (nodes.has(entry.key)) continue
      const node = render(entry)
      node.dataset.virtualKey = entry.key
      nodes.set(entry.key, node)
      observer.observe(node)
    }
    let position = 0
    for (const section of sections) {
      const desired = []
      let gapStart = position
      function gap(to) {
        if (gapStart === to) return
        const spacer = document.createElement('div')
        spacer.className = 'virtual-list-spacer'
        spacer.setAttribute('aria-hidden', 'true')
        spacer.dataset.from = String(gapStart)
        spacer.dataset.to = String(to)
        spacer.style.blockSize = `${layout.offsets[to] - layout.offsets[gapStart]}px`
        desired.push(spacer)
      }
      for (const entry of section.entries) {
        if (nodes.has(entry.key)) {
          gap(position)
          desired.push(nodes.get(entry.key))
          gapStart = position + 1
        }
        position++
      }
      gap(position)
      const wantedNodes = new Set(desired)
      for (const node of [...section.element.children])
        if (!wantedNodes.has(node)) node.remove()
      let cursor = section.element.firstChild
      for (const node of desired) {
        if (node === cursor) cursor = cursor.nextSibling
        else section.element.insertBefore(node, cursor)
      }
    }
    let changed = false
    for (const [key, node] of nodes) {
      const height = node.getBoundingClientRect().height
      if (height > 0 && Math.abs((measured.get(key) || 0) - height) > 0.5) {
        measured.set(key, height)
        changed = true
      }
    }
    if (changed) {
      const values = entries
        .filter((entry) => !entry.heading && measured.has(entry.key))
        .map((entry) => measured.get(entry.key))
      const estimate = values.length
        ? values.reduce((sum, height) => sum + height, 0) / values.length
        : 450
      layout = createTableHeights(entries, measured, estimate)
      for (const spacer of scroller.querySelectorAll('.virtual-list-spacer'))
        spacer.style.blockSize = `${layout.offsets[Number(spacer.dataset.to)] - layout.offsets[Number(spacer.dataset.from)]}px`
      restore(before)
    }
    paint?.()
    updating = false
  }
  scroller.addEventListener('scroll', schedule, { passive: true })
  scroller.addEventListener('focusout', schedule)
  scroller.addEventListener('lostpointercapture', schedule)
  observer.observe(scroller)
  return {
    anchor,
    element: (key) => nodes.get(key),
    update(value) {
      update()
      if (value) {
        restore(value)
        range = { start: 0, end: 0 }
        update()
      }
    },
    ensureVisible(key) {
      const index = positions.get(key)
      if (index === undefined) return
      const top = layout.offsets[index],
        bottom = layout.offsets[index + 1]
      if (top < scroller.scrollTop) scroller.scrollTop = top
      else if (bottom > scroller.scrollTop + scroller.clientHeight)
        scroller.scrollTop = Math.max(top, bottom - scroller.clientHeight)
      range = tableWindow(entries, index, limit, 4)
      update()
      return nodes.get(key)
    },
    destroy() {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      scroller.removeEventListener('scroll', schedule)
      scroller.removeEventListener('focusout', schedule)
      scroller.removeEventListener('lostpointercapture', schedule)
    },
  }
}
