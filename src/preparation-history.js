// Session history contains preparation snapshots only, never database state or
// reservations. Saving acknowledges a revision without discarding user edits.
export function preparationHistorySnapshot(preparation) {
  return JSON.stringify({ ...preparation, revision: 0, updatedAt: '' })
}

export function restorePreparationHistory(value, current) {
  if (
    !current ||
    value.orderId !== current.orderId ||
    value.accountId !== current.accountId
  )
    throw new Error('Preparation history does not match this order.')
  return {
    ...structuredClone(value),
    revision: current.revision,
    updatedAt: current.updatedAt,
  }
}

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
    if (entry.changes)
      return entry.changes.reduce((total, change) => total + size(change), 0)
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

  function changes(entry) {
    return entry.changes || [entry]
  }

  function result(entry, direction) {
    const values = changes(entry).map((change) => ({
      orderId: change.orderId,
      value: JSON.parse(direction === 'undo' ? change.before : change.after),
    }))
    return entry.changes ? { changes: values } : values[0]
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

    recordBatch(values) {
      const changed = values.filter((entry) => entry.before !== entry.after)
      if (!changed.length) return false
      if (
        changed.some(
          ({ orderId, before, after }) =>
            typeof orderId !== 'string' ||
            typeof before !== 'string' ||
            typeof after !== 'string'
        ) ||
        new Set(changed.map((entry) => entry.orderId)).size !== changed.length
      )
        throw new TypeError(
          'History requires unique order IDs and JSON strings'
        )
      breakGroup()
      for (const removed of entries.splice(position)) bytes -= size(removed)
      const entry = {
        changes: changed.map(({ orderId, before, after }) => ({
          orderId,
          before,
          after,
        })),
      }
      entries.push(entry)
      bytes += size(entry)
      position = entries.length
      trim()
      return true
    },

    peek(direction) {
      const entry = entries[direction === 'undo' ? position - 1 : position]
      return entry ? result(entry, direction) : null
    },

    undo() {
      breakGroup()
      if (!position) return null
      const entry = entries[position - 1]
      position -= 1
      return result(entry, 'undo')
    },

    redo() {
      breakGroup()
      if (position === entries.length) return null
      const entry = entries[position]
      position += 1
      return result(entry, 'redo')
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
        // A batch cannot safely survive with only half its orders retained.
        if (changes(entry).some((change) => change.orderId === orderId)) {
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
