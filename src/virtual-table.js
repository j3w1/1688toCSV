/** Measured table rows share one scroll space; only a nearby window stays mounted. */
export function createTableHeights(
  entries,
  measured = new Map(),
  estimate = 120
) {
  const offsets = [0]
  for (const entry of entries)
    offsets.push(
      offsets.at(-1) +
        (measured.get(entry.key) ?? (entry.heading ? 40 : estimate))
    )
  const at = (offset) => {
    let low = 0,
      high = entries.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (offsets[middle + 1] <= offset) low = middle + 1
      else high = middle
    }
    return Math.min(low, Math.max(0, entries.length - 1))
  }
  return { offsets, at, total: offsets.at(-1) }
}

export function tableWindow(entries, first, limit = 100, overscan = 20) {
  if (!entries.length) return { start: 0, end: 0 }
  let start = Math.min(first, entries.length - 1),
    before = 0
  while (start > 0 && before < overscan) {
    start--
    if (!entries[start].heading) before++
  }
  if (start > 0 && entries[start - 1].heading) start--
  let end = start,
    count = 0
  while (end < entries.length && count < limit) {
    if (!entries[end].heading) count++
    end++
  }
  if (end === entries.length)
    while (start > 0 && count < limit) {
      start--
      if (!entries[start].heading) count++
    }
  return { start, end }
}

export function createVirtualTable({
  scroller,
  body,
  render,
  remove,
  paint,
  limit = 100,
}) {
  let entries = [],
    positions = new Map(),
    nodes = new Map(),
    measured = new Map(),
    layout = createTableHeights([]),
    range = { start: 0, end: 0 },
    frame,
    reset = true,
    width = 0,
    measuring = false
  const table = body.closest('table')
  const headingHeight = () => table.tHead?.getBoundingClientRect().height || 0
  const bodyTop = () =>
    scroller.scrollTop +
    body.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top -
    scroller.clientTop
  const offset = () =>
    Math.max(0, scroller.scrollTop + headingHeight() - bodyTop())
  const activeKey = () =>
    document.activeElement?.closest('[data-virtual-key]')?.dataset.virtualKey
  const schedule = () => {
    frame ??= requestAnimationFrame(() => {
      frame = undefined
      update()
    })
  }
  const observer = new ResizeObserver(() => {
    if (!measuring) schedule()
  })
  function recompute() {
    const productHeights = entries
      .filter((entry) => !entry.heading && measured.has(entry.key))
      .map((entry) => measured.get(entry.key))
    const estimate = productHeights.length
      ? productHeights.reduce((sum, value) => sum + value, 0) /
        productHeights.length
      : 120
    layout = createTableHeights(entries, measured, estimate)
  }
  function measure() {
    if (!entries.length || !scroller.clientWidth) return
    const anchor = layout.at(offset()),
      within = offset() - layout.offsets[anchor]
    let changed = false
    for (const [key, element] of nodes) {
      const height = element.getBoundingClientRect().height
      if (height > 0 && Math.abs((measured.get(key) || 0) - height) > 0.5) {
        measured.set(key, height)
        changed = true
      }
    }
    if (changed) {
      recompute()
      for (const cell of body.querySelectorAll('.virtual-table-spacer > td'))
        cell.style.height = `${Math.max(0, layout.offsets[Number(cell.dataset.to)] - layout.offsets[Number(cell.dataset.from)])}px`
      scroller.scrollTop = Math.max(
        0,
        bodyTop() - headingHeight() + layout.offsets[anchor] + within
      )
    }
    return changed
  }
  function update() {
    measuring = true
    scroller.style.setProperty(
      '--virtual-table-heading-height',
      `${headingHeight()}px`
    )
    const nextWidth = scroller.clientWidth
    if (nextWidth && width && Math.abs(nextWidth - width) > 1) {
      // Keep the old offsets until measure captures the visible logical anchor.
      // Re-estimating here would interpret the same scrollTop as a different row.
      measured.clear()
    }
    if (nextWidth) width = nextWidth
    const first = layout.at(offset())
    // Keep a generous buffer; ordinary scrolling does not repeatedly rebuild rows.
    if (
      reset ||
      first < range.start ||
      first >= range.end ||
      (first < range.start + 8 && range.start > 0) ||
      (first > range.end - 30 && range.end < entries.length)
    )
      range = tableWindow(entries, first, limit)
    const indexes = Array.from(
      { length: range.end - range.start },
      (_, index) => index + range.start
    )
    const pinned = positions.get(activeKey())
    if (pinned !== undefined && !indexes.includes(pinned)) indexes.push(pinned)
    indexes.sort((a, b) => a - b)
    const wantedKeys = new Set(indexes.map((index) => entries[index].key))
    for (const [key, element] of nodes)
      if (!wantedKeys.has(key) || reset) {
        observer.unobserve(element)
        remove?.(element)
        element.remove()
        nodes.delete(key)
      }
    const missing = indexes.filter((index) => !nodes.has(entries[index].key))
    const rendered = missing.length
      ? render(missing.map((index) => entries[index]))
      : []
    for (const [position, index] of missing.entries()) {
      const element = rendered[position],
        entry = entries[index]
      element.dataset.virtualKey = entry.key
      element.setAttribute('aria-rowindex', String(index + 2))
      nodes.set(entry.key, element)
      observer.observe(element)
    }
    const desired = []
    let previous = 0
    function gap(from, to) {
      if (from === to) return
      const spacer = document.createElement('tr'),
        cell = document.createElement('td')
      spacer.className = 'virtual-table-spacer'
      spacer.setAttribute('aria-hidden', 'true')
      cell.colSpan = table.tHead?.rows[0]?.cells.length || 9
      cell.style.height = `${Math.max(0, layout.offsets[to] - layout.offsets[from])}px`
      cell.dataset.from = String(from)
      cell.dataset.to = String(to)
      spacer.append(cell)
      desired.push(spacer)
    }
    for (const index of indexes) {
      gap(previous, index)
      desired.push(nodes.get(entries[index].key))
      previous = index + 1
    }
    gap(previous, entries.length)
    // Retained rows stay in place, including the active inline editor.
    const wanted = new Set(desired)
    for (const element of [...body.children])
      if (!wanted.has(element)) element.remove()
    let cursor = body.firstChild
    for (const element of desired) {
      if (element === cursor) cursor = cursor.nextSibling
      else body.insertBefore(element, cursor)
    }
    reset = false
    measure()
    paint?.()
    measuring = false
  }
  scroller.addEventListener('scroll', schedule, { passive: true })
  body.addEventListener('focusout', schedule)
  observer.observe(scroller)
  return {
    reset() {
      reset = true
      scroller.scrollTop = 0
    },
    setItems(next) {
      const anchor = entries[layout.at(offset())]?.key,
        within = offset() - (layout.offsets[layout.at(offset())] || 0)
      entries = next
      positions = new Map(entries.map((entry, index) => [entry.key, index]))
      measured = new Map([...measured].filter(([key]) => positions.has(key)))
      recompute()
      table.setAttribute('aria-rowcount', String(entries.length + 1))
      if (!reset && positions.has(anchor))
        scroller.scrollTop = Math.max(
          0,
          layout.offsets[positions.get(anchor)] + within
        )
      else scroller.scrollTop = 0
      // Data changes refresh readouts; scroll updates alone retain the mounted nodes.
      const wasReset = reset
      reset = true
      range = tableWindow(entries, wasReset ? 0 : layout.at(offset()), limit)
      update()
    },
    ensureVisible(key) {
      const index = positions.get(key)
      if (index === undefined) return
      const top = layout.offsets[index],
        bottom = layout.offsets[index + 1],
        current = offset(),
        height = scroller.clientHeight - headingHeight()
      if (top < current) scroller.scrollTop += top - current
      else if (bottom > current + height)
        scroller.scrollTop += bottom - current - height
      range = tableWindow(entries, index, limit)
      update()
      return nodes.get(key)
    },
  }
}
