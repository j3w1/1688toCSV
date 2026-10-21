import { createVirtualTable } from './virtual-table.js'
import { element as el } from './ui.js'

/** Editable drafts stay in their source objects while a bounded row window mounts. */
export function createVocabularyTable({
  scroller,
  body,
  render,
  remove,
  emptyMessage,
}) {
  const keys = new WeakMap(),
    sources = new WeakMap()
  let items = [],
    nextKey = 0
  const key = (entry) => {
    if (!keys.has(entry)) keys.set(entry, `rule-${++nextKey}`)
    return keys.get(entry)
  }
  const rows = createVirtualTable({
    scroller,
    body,
    limit: 100,
    render: (entries) =>
      entries.map(({ value }) => {
        const row = render(value)
        sources.set(row, value)
        return row
      }),
    remove: (row) => remove?.(sources.get(row)),
    paint: () => {
      if (items.length || !emptyMessage) return
      const row = el('tr'),
        cell = el('td', emptyMessage, 'vocabulary-empty')
      cell.colSpan = body.closest('table').querySelectorAll('thead th').length
      row.append(cell)
      body.append(row)
    },
  })
  const fields = (row) => [
    ...row.querySelectorAll(
      'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    ),
  ]
  function tab(event) {
    if (
      event.key !== 'Tab' ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.defaultPrevented
    )
      return
    const row = event.target.closest('[data-virtual-key]')
    if (!row || !body.contains(row)) return
    const controls = fields(row),
      target = event.target.closest('input,button,select,textarea')
    if (target !== (event.shiftKey ? controls[0] : controls.at(-1))) return
    const index = items.indexOf(sources.get(row)) + (event.shiftKey ? -1 : 1)
    if (index < 0 || index >= items.length) return
    const next = rows.ensureVisible(key(items[index]))
    const input = event.shiftKey ? fields(next).at(-1) : fields(next)[0]
    if (!input) return
    event.preventDefault()
    input.focus({ preventScroll: true })
  }
  body.addEventListener('keydown', tab)
  return {
    setItems(next, { reset = false } = {}) {
      items = next
      if (reset) rows.reset()
      rows.setItems(items.map((value) => ({ key: key(value), value })))
    },
    reveal(entry) {
      return rows.ensureVisible(key(entry))
    },
    destroy() {
      body.removeEventListener('keydown', tab)
      rows.destroy()
    },
  }
}
