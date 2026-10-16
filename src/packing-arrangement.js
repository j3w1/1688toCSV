import { reorderPreparationGroups } from './packing-model.js'

const compare = (a, b) =>
  String(a).localeCompare(String(b), 'en', { numeric: true })

/** Stored positions are independent of issued codes and original seller row order. */
export function orderedPreparations(preparations) {
  return [...preparations].sort(
    (a, b) =>
      (a.packingPosition ?? Number.MAX_SAFE_INTEGER) -
      (b.packingPosition ?? Number.MAX_SAFE_INTEGER)
  )
}

/** Reuse occupied ranks; normalize legacy ties/missing ranks as one transaction. */
export function arrangeOrderPositions(preparations, next, manual = false) {
  const all = orderedPreparations(preparations)
  const open = new Set(next.map((draft) => draft.orderId))
  const previous = all
    .filter((draft) => open.has(draft.orderId))
    .map((draft) => draft.orderId)
  const ranks = all.map((draft) => draft.packingPosition)
  const normalize =
    ranks.some((rank) => rank === undefined) ||
    new Set(ranks).size !== ranks.length
  let index = 0
  return all.map((draft, slot) => {
    if (!open.has(draft.orderId))
      return normalize ? { ...draft, packingPosition: slot } : draft
    const replacement = next[index]
    const moved = previous[index++] !== replacement.orderId
    return {
      ...replacement,
      packingPosition: normalize ? slot : ranks[slot],
      ...(manual && moved ? { packingManualReordered: true } : {}),
    }
  })
}

export function arrangePreparations(
  preparations,
  orderIds,
  mode,
  sources,
  groupScope
) {
  if (!['store', 'code', 'store-code'].includes(mode))
    throw new Error('Unknown packing arrangement')
  const selected = new Set(orderIds)
  const candidates = preparations
    .filter((draft) => selected.has(draft.orderId))
    .map((draft) => {
      if (mode === 'store') return draft
      const scope = new Set(
        groupScope?.get(draft.orderId) || draft.groups.map((group) => group.id)
      )
      const sorted = draft.groups
        .filter((group) => scope.has(group.id))
        .sort((a, b) => compare(a.baseCode || '\uffff', b.baseCode || '\uffff'))
      let index = 0
      const keys = draft.groups.map((group) =>
        scope.has(group.id) ? sorted[index++].id : group.id
      )
      return reorderPreparationGroups(draft, keys)
    })
  const seller = (draft) => {
    const source = sources.get(draft.orderId)
    // Member login is the identity; a display name alone must not merge stores.
    return String(
      source?.sellerMemberLogin ||
        draft.sellerId ||
        source?.sellerName ||
        draft.orderId
    ).trim()
  }
  const firstCode = (draft) =>
    draft.groups
      .filter(
        (group) =>
          !groupScope || groupScope.get(draft.orderId)?.includes(group.id)
      )
      .map((group) => group.baseCode)
      .filter(Boolean)
      .sort(compare)[0] || '\uffff'
  candidates.sort(
    (a, b) =>
      (mode !== 'code' ? compare(seller(a), seller(b)) : 0) ||
      (mode !== 'store' ? compare(firstCode(a), firstCode(b)) : 0)
  )
  let next = 0
  return preparations.map((draft) =>
    selected.has(draft.orderId) ? candidates[next++] : draft
  )
}
