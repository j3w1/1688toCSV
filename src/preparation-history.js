// This history holds unsaved JSON snapshots only. Saving an order must clear it.
export function createPreparationHistory({
  maxEntries = 50,
  maxBytes = 8 * 1024 * 1024,
} = {}) {
  for (const limit of [maxEntries, maxBytes]) {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new RangeError('History limits must be non-negative safe integers')
  }

  let entries = []
  let position = 0
  let bytes = 0
  let mergeEntry = null

  function size(entry) {
    // Account conservatively for UTF-16 strings without encoding every keystroke.
    return (
      2 *
      (entry.orderId.length +
        entry.before.length +
        entry.after.length +
        (entry.mergeKey?.length || 0))
    )
  }

  function breakGroup() {
    mergeEntry = null
  }

  function trim() {
    while (entries.length > maxEntries || bytes > maxBytes) {
      const removed = entries.shift()
      bytes -= size(removed)
      position = Math.max(0, position - 1)
      if (removed === mergeEntry) breakGroup()
    }
  }

  return {
    // before/after must be JSON.stringify output; parsing waits until undo/redo.
    record(orderId, before, after, mergeKey = null) {
      if (
        typeof orderId !== 'string' ||
        typeof before !== 'string' ||
        typeof after !== 'string' ||
        (mergeKey !== null && typeof mergeKey !== 'string')
      )
        throw new TypeError('History requires an order ID and JSON strings')
      if (before === after) return false

      for (const removed of entries.splice(position)) bytes -= size(removed)
      const previous = entries.at(-1)
      if (
        mergeKey !== null &&
        previous === mergeEntry &&
        previous?.orderId === orderId &&
        previous.mergeKey === mergeKey &&
        previous.after === before
      ) {
        bytes -= size(previous)
        previous.after = after
        if (previous.before === after) {
          entries.pop()
          breakGroup()
        } else bytes += size(previous)
      } else {
        const entry = { orderId, before, after, mergeKey }
        entries.push(entry)
        bytes += size(entry)
        mergeEntry = mergeKey === null ? null : entry
      }
      position = entries.length
      trim()
      return true
    },

    breakGroup,

    undo() {
      breakGroup()
      if (!position) return null
      const entry = entries[position - 1]
      const value = JSON.parse(entry.before)
      position -= 1
      return { orderId: entry.orderId, value }
    },

    redo() {
      breakGroup()
      if (position === entries.length) return null
      const entry = entries[position]
      const value = JSON.parse(entry.after)
      position += 1
      return { orderId: entry.orderId, value }
    },

    clear(orderId) {
      breakGroup()
      if (orderId === undefined) {
        entries = []
        position = 0
        bytes = 0
        return
      }
      let nextPosition = 0
      entries = entries.filter((entry, index) => {
        if (entry.orderId === orderId) {
          bytes -= size(entry)
          return false
        }
        if (index < position) nextPosition += 1
        return true
      })
      position = nextPosition
    },

    state() {
      return {
        canUndo: position > 0,
        canRedo: position < entries.length,
        entries: entries.length,
        bytes,
      }
    },
  }
}
