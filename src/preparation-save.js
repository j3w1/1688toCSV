// A write acknowledges only the values it received. Keep newer typing and the
// existing objects used by field/preview closures while applying allocated codes.
export function samePreparation(left, right) {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object')
    return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const keys = Object.keys(left).filter((key) => left[key] !== undefined)
  const otherKeys = Object.keys(right).filter((key) => right[key] !== undefined)
  return (
    keys.length === otherKeys.length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) && samePreparation(left[key], right[key])
    )
  )
}

export function acknowledgePreparation(draft, submitted, saved) {
  function merge(target, before, after) {
    for (const [key, value] of Object.entries(after)) {
      if (Array.isArray(value)) {
        for (const item of target[key]) {
          if (!item || typeof item !== 'object' || !item.id) continue
          const old = before[key].find((entry) => entry.id === item.id)
          const next = value.find((entry) => entry.id === item.id)
          if (old && next) merge(item, old, next)
        }
      } else if (
        value &&
        typeof value === 'object' &&
        target[key] &&
        before[key]
      ) {
        // Provenance is nested data too. A structured-clone submission never
        // shares its object identity with the live draft.
        merge(target[key], before[key], value)
      } else if (target[key] === before[key]) target[key] = value
    }
  }
  merge(draft, submitted, saved)
  draft.revision = saved.revision
  draft.updatedAt = saved.updatedAt
  return draft
}
