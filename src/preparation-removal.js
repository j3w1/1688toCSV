import {
  groupPackingMonth,
  removeSelectedProducts,
  variantMaterial,
} from './packing-model.js'

const entries = (group) => group.variants.flatMap((variant) => variant.entryIds)
const sameEntries = (a, b) =>
  a.length === b.length && a.every((id) => b.includes(id))

export function preparationProducts(preparation) {
  return new Map(
    (preparation?.groups || []).flatMap((group) =>
      group.variants.flatMap((variant) =>
        variant.entryIds.map((id) => [id, { group, variant }])
      )
    )
  )
}

/** Restore only the removed rows and the shared structure needed to represent them.
 * Other source rows keep their variant edits; shared group fields are reviewed by
 * the caller. Source entry IDs remain the identity after splitting or merging.
 */
export function discardPreparationProducts(current, baseline, entryIds) {
  const selected = new Set(entryIds)
  const next = removeSelectedProducts(current, entryIds)
  if (!baseline) return next
  if (
    baseline.orderId !== current.orderId ||
    baseline.accountId !== current.accountId
  )
    throw new Error('Preparation history does not match this order.')
  const before = preparationProducts(baseline)
  const live = preparationProducts(current)
  const restore = new Set([...selected].filter((id) => before.has(id)))

  // Grouping operations can connect several original groups. Restore their
  // original boundaries together, without adding already removed source rows.
  for (const id of restore) {
    const oldGroup = before.get(id).group
    for (const sibling of entries(oldGroup)) {
      if (!live.has(sibling)) continue
      restore.add(sibling)
      const currentGroup = live.get(sibling).group
      for (const linked of entries(currentGroup))
        if (before.has(linked)) restore.add(linked)
    }
  }
  if (!restore.size) return next
  const pruned = removeSelectedProducts(current, [
    ...new Set([...selected, ...restore]),
  ])
  const replacementGroups = []
  for (const group of baseline.groups) {
    if (!entries(group).some((id) => restore.has(id))) continue
    const restored = {
      ...structuredClone(group),
      ...(group.month !== undefined || baseline.month !== current.month
        ? { month: groupPackingMonth(baseline, group) }
        : {}),
      variants: [],
    }
    for (const variant of group.variants) {
      const ids = variant.entryIds.filter((id) => restore.has(id))
      if (!ids.length) continue
      const existing = live.get(ids[0])?.variant
      // Keep unrelated variant edits where the original source-row grouping
      // still exists; otherwise the grouping change itself is shared.
      const untouched =
        ids.every((id) => !selected.has(id)) &&
        existing &&
        sameEntries(existing.entryIds, ids)
      const replacement = {
        ...structuredClone(untouched ? existing : variant),
        entryIds: ids,
      }
      if (
        !untouched &&
        (Object.hasOwn(variant, 'material') ||
          variant.materialOverrides ||
          ids.some(
            (id) =>
              !selected.has(id) &&
              (Object.hasOwn(live.get(id)?.variant || {}, 'material') ||
                live.get(id)?.variant.materialOverrides)
          ))
      ) {
        const materials = ids.map((id) => [
          id,
          variantMaterial(
            selected.has(id) ? variant : live.get(id)?.variant || variant,
            id
          ),
        ])
        replacement.material = materials[0][1].value
        replacement.materialSource = materials[0][1].source
        delete replacement.materialOverrides
        const overrides = materials.filter(
          ([, material]) =>
            material.value !== replacement.material ||
            material.source !== replacement.materialSource
        )
        if (overrides.length)
          replacement.materialOverrides = Object.fromEntries(overrides)
      }
      restored.variants.push(replacement)
    }
    replacementGroups.push(restored)
  }
  // Put restored groups back beside their original neighbors; unrelated group
  // ordering remains as authored. No product outside the current draft returns.
  for (const restored of replacementGroups) {
    const residualIndex = pruned.groups.findIndex(
      (group) => group.id === restored.id
    )
    if (residualIndex >= 0) {
      for (const variant of pruned.groups[residualIndex].variants) {
        const shared = restored.variants.find(
          (entry) => entry.id === variant.id
        )
        if (shared) {
          const values = variant.entryIds.map((id) => [
            id,
            variantMaterial(variant, id),
          ])
          shared.entryIds.push(...variant.entryIds)
          shared.materialOverrides = {
            ...shared.materialOverrides,
            ...Object.fromEntries(values),
          }
        } else restored.variants.push(variant)
      }
      pruned.groups.splice(residualIndex, 1)
    }
    const oldIndex = baseline.groups.findIndex(
      (group) => group.id === restored.id
    )
    const following = new Set(
      baseline.groups.slice(oldIndex + 1).map((group) => group.id)
    )
    const index = pruned.groups.findIndex((group) => following.has(group.id))
    pruned.groups.splice(index < 0 ? pruned.groups.length : index, 0, restored)
  }
  // Reset defaults must not later resurrect the discarded automatic assignment.
  if (current.defaultPacking) {
    const oldDefaults = baseline.defaultPacking || baseline
    const defaults = discardPreparationProducts(
      { ...current, ...current.defaultPacking, defaultPacking: undefined },
      { ...baseline, ...oldDefaults, defaultPacking: undefined },
      entryIds.filter((id) =>
        preparationProducts(current.defaultPacking).has(id)
      )
    )
    pruned.defaultPacking = {
      ...structuredClone(current.defaultPacking),
      groups: defaults.groups,
    }
  }
  return pruned
}
