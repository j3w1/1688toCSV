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
    for (const key of Object.keys(before))
      if (
        !Object.hasOwn(after, key) &&
        samePreparation(target[key], before[key])
      )
        delete target[key]
    for (const [key, value] of Object.entries(after)) {
      if (Array.isArray(value)) {
        const current = target[key],
          previous = before[key]
        if (!Array.isArray(current) || !Array.isArray(previous)) {
          if (samePreparation(current, previous))
            target[key] = structuredClone(value)
          continue
        }
        // Undo can remove a group or restore membership. Apply that structure
        // only while it still matches the submission, retaining live objects
        // for surviving IDs and the array used by existing editor closures.
        if (samePreparation(current, previous)) {
          const next = value.map((item) => {
            const live = item?.id
                ? current.find((entry) => entry?.id === item.id)
                : null,
              old = item?.id
                ? previous.find((entry) => entry?.id === item.id)
                : null
            if (!live || !old) return structuredClone(item)
            merge(live, old, item)
            return live
          })
          current.splice(0, current.length, ...next)
          continue
        }
        for (const item of current) {
          if (!item || typeof item !== 'object' || !item.id) continue
          const old = previous.find((entry) => entry.id === item.id)
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
