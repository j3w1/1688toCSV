import {
  barcodeValue,
  groupPackingMonth,
  mergeVariantMaterials,
} from './packing-model.js'
import { message as uiMessage, t } from './i18n.js'

/** Compare each affected source row, including rows whose barcode is shared. */
export function groupingReviewChanges(entries, previews, records) {
  const sources = new Map(
    records.map(({ snapshot }) => [snapshot.orderId, snapshot])
  )
  const nextRows = new Map()
  for (const draft of previews)
    for (const group of draft.groups)
      for (const variant of group.variants)
        for (const entryId of variant.entryIds)
          nextRows.set(`${draft.orderId}/${entryId}`, { group, variant })
  const code = (group, variant) => {
    if (variant.needsSizeMapping) return uiMessage('Choose a size code')
    try {
      return barcodeValue(group, variant)
    } catch {
      return uiMessage('Not prepared')
    }
  }
  return entries.flatMap(({ draft, group, variants }) => {
    const source = sources.get(draft.orderId)
    const items = new Map(
      source?.items.map((item) => [item.entryId, item]) || []
    )
    return variants.flatMap((variant) =>
      variant.entryIds.map((entryId) => {
        const next = nextRows.get(`${draft.orderId}/${entryId}`)
        if (!next)
          throw new Error(
            'A selected product is missing from the grouping preview.'
          )
        const item = items.get(entryId)
        return {
          entryId,
          name:
            item?.description || item?.title || variant.variant || group.title,
          photo: item,
          order: source?.sellerName || draft.sellerId,
          orderId: draft.orderId,
          before: code(group, variant),
          after: code(next.group, next.variant),
          detail: uiMessage('{0}', {
            0: () =>
              `${t('Product code')}: ${group.baseCode || t('Not prepared')} → ${next.group.baseCode || t('Not prepared')} · ${t('Product rows')}: ${variant.entryIds.length} → ${next.variant.entryIds.length}`,
          }),
        }
      })
    )
  })
}

export function unusedSuffix(used, sizeSuffix = '') {
  for (let number = 1; ; number++) {
    let n = number,
      value = ''
    while (n) {
      n--
      value = String.fromCharCode(65 + (n % 26)) + value
      n = Math.floor(n / 26)
    }
    if (!used.has(value + sizeSuffix)) return value
  }
}

/** Selection entries contain one source group and only its selected variants. */
export function groupingAvailability(entries) {
  const incomplete =
    'These groups include products outside this packing selection. Select all their products in Orders before changing their grouping.'
  const available = (affected, emptyReason) => ({
    entries: affected,
    reason: !affected.length
      ? emptyReason
      : affected.some((entry) => !entry.complete)
        ? incomplete
        : '',
  })
  const share = available(
    entries.filter((entry) => entry.variants.length > 1),
    'Select at least two variants in a product group to share a barcode.'
  )
  const separate = available(
    entries.filter((entry) =>
      entry.variants.some((variant) => variant.entryIds.length > 1)
    ),
    'Select a variant containing multiple source rows.'
  )
  const split = available(entries, 'Select products first.')
  if (
    !split.reason &&
    entries.some(
      ({ group, variants }) => variants.length === group.variants.length
    )
  )
    split.reason =
      'Select some, but not all, variants in each group to move them into new products.'
  const merge = available(
    entries,
    'Select at least two product groups to merge.'
  )
  if (!merge.reason) {
    if (entries.length < 2)
      merge.reason = 'Select at least two product groups to merge.'
    else if (new Set(entries.map(({ draft }) => draft.orderId)).size > 1)
      merge.reason =
        'Merge groups from one order at a time. Groups from different orders cannot share a product code.'
    else if (
      entries.some(
        ({ group, variants }) => variants.length !== group.variants.length
      )
    )
      merge.reason =
        'Select every product in each group before merging product groups.'
    else if (
      new Set(
        entries.map(({ draft, group }) => groupPackingMonth(draft, group))
      ).size > 1
    )
      merge.reason =
        'Groups from different packing months cannot be merged. Move the selected products to the same packing month first.'
  }
  return { share, separate, split, merge }
}

/** Build one atomic candidate per order; code reservations are never reassigned. */
export async function regroupSelection(
  entries,
  operation,
  { getReservedBarcodes, newId = () => crypto.randomUUID() }
) {
  const availability = groupingAvailability(entries)[operation]
  if (!availability) throw new Error('Unknown grouping operation')
  if (availability.reason) throw new Error(availability.reason)
  const candidates = new Map()
  for (const { draft } of availability.entries)
    if (!candidates.has(draft.orderId))
      candidates.set(draft.orderId, structuredClone(draft))
  async function usedEndings(draft, group) {
    const used = new Set(
      group.variants.map(
        (variant) => variant.variantSuffix + variant.sizeSuffix
      )
    )
    if (group.baseCode)
      for (const code of await getReservedBarcodes(group.baseCode, {
        accountId: draft.accountId,
      }))
        used.add(code.slice(group.baseCode.length))
    return used
  }
  if (operation === 'merge') {
    const candidate = candidates.values().next().value
    const ids = new Set(availability.entries.map(({ group }) => group.id))
    const selectedGroups = candidate.groups.filter((group) => ids.has(group.id))
    const target = selectedGroups[0]
    // A no-size override belongs to its original assortment. Mixed merges return
    // to automatic handling without reclassifying or clearing existing sizes.
    if (
      new Set(selectedGroups.map((group) => group.sizeMode || 'automatic'))
        .size > 1
    )
      delete target.sizeMode
    const used = await usedEndings(candidate, target)
    for (const group of selectedGroups.slice(1))
      for (const variant of group.variants) {
        if (used.has(variant.variantSuffix + variant.sizeSuffix))
          variant.variantSuffix = unusedSuffix(used, variant.sizeSuffix)
        used.add(variant.variantSuffix + variant.sizeSuffix)
        target.variants.push(variant)
      }
    candidate.groups = candidate.groups.filter(
      (group) => !ids.has(group.id) || group === target
    )
  } else {
    for (const { draft, group, variants } of availability.entries) {
      const candidate = candidates.get(draft.orderId)
      const edited = candidate.groups.find((entry) => entry.id === group.id)
      const ids = new Set(variants.map((variant) => variant.id))
      const selected = edited.variants.filter((variant) => ids.has(variant.id))
      if (operation === 'share') {
        const target = selected[0]
        const materials = structuredClone(selected)
        for (const variant of selected.slice(1))
          target.entryIds.push(...variant.entryIds)
        mergeVariantMaterials(target, materials)
        edited.variants = edited.variants.filter(
          (variant) => !ids.has(variant.id) || variant === target
        )
      } else if (operation === 'separate') {
        const used = await usedEndings(draft, group)
        for (const variant of selected) {
          for (const entryId of variant.entryIds.slice(1)) {
            const suffix = unusedSuffix(used, variant.sizeSuffix)
            used.add(suffix + variant.sizeSuffix)
            edited.variants.push({
              ...structuredClone(variant),
              id: newId(),
              entryIds: [entryId],
              variantSuffix: suffix,
            })
          }
          variant.entryIds = variant.entryIds.slice(0, 1)
        }
      } else if (operation === 'split') {
        edited.variants = edited.variants.filter(
          (variant) => !ids.has(variant.id)
        )
        candidate.groups.push({
          ...structuredClone(group),
          id: newId(),
          baseCode: '',
          variants: selected,
        })
      }
    }
  }
  return [...candidates.values()]
}
