import {
  activePackingState,
  groupPackingMonth,
  packingMonth,
  validatePreparation,
  mergeVariantMaterials,
} from './packing-model.js'
import { preparationAuthoring } from './product-vocabulary.js'

const key = (entry) =>
  JSON.stringify([entry.accountId ?? 'local', entry.orderId])
const entryIds = (preparation) =>
  preparation.groups.flatMap((group) =>
    group.variants.flatMap((variant) => variant.entryIds)
  )

/** Check the saved selection against both source rows and actual prepared membership. */
export function validatePackingScope(input, orders, preparations) {
  if (
    !input ||
    !Array.isArray(input.orders) ||
    !input.orders.length ||
    !Array.isArray(input.months) ||
    !input.months.length ||
    (input.mode !== undefined && input.mode !== 'selection')
  )
    throw new Error('Choose a file created by Back up packing')
  const months = input.months.map(packingMonth)
  if (new Set(months).size !== months.length)
    throw new Error('Packing backup contains duplicate months')
  const sources = new Map(
    orders.map((order) => [key(order.snapshot), order.snapshot])
  )
  const prepared = new Map(
    preparations.map((preparation) => [key(preparation), preparation])
  )
  const seen = new Set()
  const actualMonths = new Set()
  const scope = input.orders.map((order) => {
    if (
      !order ||
      typeof order.orderId !== 'string' ||
      !/^[1-9]\d*$/.test(order.orderId) ||
      (order.accountId !== undefined &&
        (typeof order.accountId !== 'string' || !order.accountId.trim()))
    )
      throw new Error('Packing backup contains an invalid order')
    const orderKey = key(order)
    const source = sources.get(orderKey)
    const preparation = prepared.get(orderKey)
    if (
      seen.has(orderKey) ||
      !source ||
      !preparation ||
      !Array.isArray(order.entryIds) ||
      !order.entryIds.length ||
      new Set(order.entryIds).size !== order.entryIds.length
    )
      throw new Error(
        'Packing backup contains an invalid or duplicate selection'
      )
    seen.add(orderKey)
    const sourceIds = new Set(source.items.map((item) => item.entryId))
    const preparedIds = new Set(entryIds(preparation))
    if (
      order.entryIds.some(
        (id) =>
          typeof id !== 'string' || !sourceIds.has(id) || !preparedIds.has(id)
      )
    )
      throw new Error('Packing backup selection is missing a prepared product')
    const selected = new Set(order.entryIds)
    for (const group of preparation.groups)
      if (
        group.variants.some((variant) =>
          variant.entryIds.some((id) => selected.has(id))
        )
      )
        actualMonths.add(groupPackingMonth(preparation, group))
    if (
      input.mode === 'selection' &&
      [
        preparation,
        preparation.defaultPacking,
        preparation.previousPacking,
        preparation.previousPacking?.defaults,
      ]
        .filter(Boolean)
        .some((checkpoint) =>
          entryIds(checkpoint).some((id) => !selected.has(id))
        )
    )
      throw new Error('Packing backup contains unselected preparation data')
    return {
      accountId: order.accountId ?? 'local',
      orderId: order.orderId,
      entryIds: [...order.entryIds],
    }
  })
  if (
    months.length !== actualMonths.size ||
    months.some((month) => !actualMonths.has(month))
  )
    throw new Error('Packing backup months do not match its selected products')
  if (
    input.mode === 'selection' &&
    preparations.some((preparation) => !seen.has(key(preparation)))
  )
    throw new Error('Packing backup contains an unselected order preparation')
  if (
    input.mode === 'selection' &&
    orders.some((order) => !seen.has(key(order.snapshot)))
  )
    throw new Error('Packing backup contains an unselected source order')
  return { mode: 'selection', months, orders: scope }
}

function selectedGroups(groups, selected) {
  return groups
    .map((group) => ({
      ...group,
      variants: group.variants
        .map((variant) => {
          const result = {
            ...variant,
            entryIds: variant.entryIds.filter((id) => selected.has(id)),
          }
          if (Object.hasOwn(variant, 'material') || variant.materialOverrides)
            mergeVariantMaterials(result, [variant])
          return result
        })
        .filter((variant) => variant.entryIds.length),
    }))
    .filter((group) => group.variants.length)
}

/** Checkpoints are scoped too: a selected backup must not carry other packing edits. */
export function selectPackingPreparation(preparation, ids) {
  const selected = new Set(ids)
  const result = structuredClone(preparation)
  for (const target of [
    result,
    result.defaultPacking,
    result.previousPacking,
    result.previousPacking?.defaults,
  ].filter(Boolean))
    target.groups = selectedGroups(target.groups, selected)
  return result
}

export function selectPackingOrder(order, ids) {
  const selected = new Set(ids)
  const result = structuredClone(order)
  if (result.productTags)
    result.productTags = Object.fromEntries(
      Object.entries(result.productTags).filter(([id]) => selected.has(id))
    )
  if (result.unitsPerCarton)
    result.unitsPerCarton = Object.fromEntries(
      Object.entries(result.unitsPerCarton).filter(([id]) => selected.has(id))
    )
  if (result.cartonDetails)
    result.cartonDetails = Object.fromEntries(
      Object.entries(result.cartonDetails).filter(([id]) => selected.has(id))
    )
  if (result.packingExcludedEntryIds)
    result.packingExcludedEntryIds = result.packingExcludedEntryIds.filter(
      (id) => selected.has(id)
    )
  for (const [clock, partial] of [
    ['productTagsUpdatedAt', 'productTagsPartialClocks'],
    ['unitsPerCartonUpdatedAt', 'unitsPerCartonPartialClocks'],
    ['cartonDetailsUpdatedAt', 'cartonDetailsPartialClocks'],
    ['packingExclusionsUpdatedAt', 'packingExclusionsPartialClocks'],
  ])
    if (order[clock] || order[partial]) {
      result[partial] = Object.fromEntries(
        ids
          .map((id) => [id, order[partial]?.[id] || order[clock]])
          .filter(([, value]) => value)
      )
      // Clipping observes selected entries, never the complete annotation map.
      delete result[clock]
    }
  return result
}

/** Label artwork and assigned tag colors travel with packing, not global catalogs. */
function packingPreferences(preferences, orders) {
  if (!preferences) return null
  const value = preferences.value
  const settings = {}
  for (const field of ['dpi', 'website', 'destination'])
    if (value.settings?.[field] !== undefined)
      settings[field] = value.settings[field]
  for (const kind of ['barcode', 'mark'])
    if (value.settings?.[kind])
      settings[kind] = Object.fromEntries(
        ['widthMm', 'heightMm', 'textScale']
          .filter((field) => value.settings[kind][field] !== undefined)
          .map((field) => [field, value.settings[kind][field]])
      )
  const result = { settings, logoDataUrl: value.logoDataUrl || '' }
  // Preserve the tag palette's migration state without exporting global themes.
  if (value.appearance?.paletteRevision !== undefined)
    result.appearance = { paletteRevision: value.appearance.paletteRevision }
  for (const [field, names] of [
    ['orderTags', orders.flatMap((order) => order.tags)],
    [
      'productTags',
      orders.flatMap((order) => Object.values(order.productTags || {}).flat()),
    ],
  ]) {
    const assigned = new Set(names)
    const tags = value[field]?.filter((tag) => assigned.has(tag.name))
    if (tags?.length) result[field] = structuredClone(tags)
  }
  return { value: result, updatedAt: preferences.updatedAt }
}

/** Full source orders remain dependencies so their money totals still reconcile. */
export function createPackingBackup(backup, selection) {
  const scope = validatePackingScope(
    { ...selection, mode: undefined },
    backup.orders,
    backup.preparations
  )
  const selected = new Map(
    scope.orders.map((order) => [key(order), order.entryIds])
  )
  const orders = backup.orders
    .filter((order) => selected.has(key(order.snapshot)))
    .map((order) =>
      selectPackingOrder(order, selected.get(key(order.snapshot)))
    )
  const preparations = backup.preparations
    .filter((preparation) => selected.has(key(preparation)))
    .map((preparation) =>
      selectPackingPreparation(preparation, selected.get(key(preparation)))
    )
  const urls = new Set(
    orders.flatMap((order) =>
      order.snapshot.items
        .filter((item) =>
          selected.get(key(order.snapshot)).includes(item.entryId)
        )
        .flatMap((item) => [item.thumbnail, ...(item.photos || [])])
    )
  )
  // Full source rows are retained to reconcile money. Local originals have no
  // remote fallback, so keep every original referenced by those dependencies.
  for (const order of orders)
    for (const item of order.snapshot.items)
      for (const url of [item.thumbnail, ...(item.photos || [])])
        if (url?.startsWith('local-image:')) urls.add(url)
  return {
    format: '1688-order-library',
    version: 3,
    exportedAt: backup.exportedAt,
    orders,
    // Every scoped preparation/checkpoint entry exists in its current source.
    // Prior scraped snapshots and retired ownership are not restore dependencies.
    history: [],
    preparations,
    ...activePackingState(preparations),
    images: structuredClone(
      (backup.images || []).filter((image) => urls.has(image.url))
    ),
    packingPreferences: packingPreferences(backup.packingPreferences, orders),
    packingScope: scope,
  }
}

function groupAuthoring(group) {
  const { variants, ...fields } = preparationAuthoring({ groups: [group] })
    .groups[0]
  return fields
}

function groupsWithMonths(preparation) {
  return (preparation?.groups ?? []).map(({ month, ...group }) => ({
    ...group,
    month: month ?? preparation.month,
  }))
}

function normalizedAuthoring(preparation) {
  const result = { ...preparation, groups: groupsWithMonths(preparation) }
  for (const field of ['defaultPacking', 'previousPacking', 'defaults'])
    if (preparation[field])
      result[field] = normalizedAuthoring(preparation[field])
  return preparationAuthoring(result)
}

/** An unchanged scoped copy can be completed by its exact same-time source. */
export function isPackingPreparationSubset(partial, complete) {
  const ids = entryIds(partial)
  const completeIds = new Set(entryIds(complete))
  return (
    ids.length < completeIds.size &&
    ids.every((id) => completeIds.has(id)) &&
    JSON.stringify(normalizedAuthoring(partial)) ===
      JSON.stringify(
        normalizedAuthoring(selectPackingPreparation(complete, ids))
      )
  )
}

/** Replace only selected slots; intervening unselected rows retain their position. */
function mergeSlots(previous, kept, incoming) {
  const remaining = new Map(kept.map((entry) => [entry.id, entry]))
  const replacing = new Set(incoming.map((entry) => entry.id))
  let cursor = 0
  const result = []
  for (const entry of previous) {
    if (replacing.has(entry.id) || !remaining.has(entry.id)) {
      if (cursor < incoming.length) result.push(incoming[cursor++])
    } else result.push(remaining.get(entry.id))
  }
  result.push(...incoming.slice(cursor))
  return result
}

function mergeGroups(previous, incoming, selected) {
  const remaining = selectedGroups(
    previous,
    new Set(
      previous
        .flatMap((group) =>
          group.variants.flatMap((variant) => variant.entryIds)
        )
        .filter((id) => !selected.has(id))
    )
  )
  const byId = new Map(remaining.map((group) => [group.id, group]))
  const merged = incoming.map((group) => {
    const kept = byId.get(group.id)
    if (!kept) return structuredClone(group)
    if (
      JSON.stringify(groupAuthoring(kept)) !==
      JSON.stringify(groupAuthoring(group))
    )
      throw new Error(
        'Packing restore conflict: this product group also contains unselected products. Restore the whole group to change its shared name or code.'
      )
    const variants = group.variants.map((variant) => {
      const old = kept.variants.find((entry) => entry.id === variant.id)
      if (!old) return structuredClone(variant)
      const oldIds = old.entryIds,
        newIds = variant.entryIds
      const sharedFields = (value) =>
        Object.fromEntries(
          Object.entries(value).filter(
            ([key]) =>
              ![
                'entryIds',
                'material',
                'materialSource',
                'materialOverrides',
              ].includes(key)
          )
        )
      const oldFields = sharedFields(old),
        newFields = sharedFields(variant)
      if (JSON.stringify(oldFields) !== JSON.stringify(newFields))
        throw new Error(
          'Packing restore conflict: this variant also contains unselected products. Restore the whole variant to change its shared details.'
        )
      const original = previous
        .find((entry) => entry.id === group.id)
        .variants.find((entry) => entry.id === variant.id)
      const result = {
        ...variant,
        entryIds: mergeSlots(
          original.entryIds.map((id) => ({ id })),
          oldIds.map((id) => ({ id })),
          newIds.map((id) => ({ id }))
        ).map((entry) => entry.id),
      }
      if (
        [old, variant].some(
          (entry) => Object.hasOwn(entry, 'material') || entry.materialOverrides
        )
      )
        mergeVariantMaterials(result, [old, variant])
      return result
    })
    return {
      ...group,
      variants: mergeSlots(
        previous.find((entry) => entry.id === group.id).variants,
        kept.variants,
        variants
      ),
    }
  })
  return mergeSlots(previous, remaining, merged)
}

/** Merge only the saved selection. Shared edits may not silently alter other products. */
export function mergePackingPreparation(previous, incoming, ids) {
  const selected = new Set(ids)
  const scoped = selectPackingPreparation(incoming, ids)
  if (!previous) return scoped
  if (incoming.updatedAt < previous.updatedAt) return previous
  if (incoming.updatedAt === previous.updatedAt) {
    if (
      JSON.stringify(
        normalizedAuthoring(selectPackingPreparation(previous, ids))
      ) !== JSON.stringify(normalizedAuthoring(scoped))
    )
      throw new Error(
        'Backup conflict: preparation edits have the same timestamp'
      )
    return previous
  }
  if (
    previous.sellerId !== incoming.sellerId &&
    entryIds(previous).some((id) => !selected.has(id))
  )
    throw new Error(
      'Packing restore conflict: the seller differs for unselected products'
    )
  const result = {
    ...previous,
    sellerId: incoming.sellerId,
    updatedAt: incoming.updatedAt,
    revision: Math.max(previous.revision, incoming.revision) + 1,
    groups: mergeGroups(
      groupsWithMonths(previous),
      groupsWithMonths(scoped),
      selected
    ),
  }
  for (const field of ['defaultPacking', 'previousPacking']) {
    const old = previous[field]
    const next = scoped[field]
    if (!old && !next) continue
    const checkpoint = {
      ...(old ?? next),
      groups: mergeGroups(
        groupsWithMonths(old),
        groupsWithMonths(next),
        selected
      ),
    }
    if (field === 'previousPacking' && (old?.defaults || next?.defaults)) {
      const older = old?.defaults
      const newer = next?.defaults
      checkpoint.defaults = {
        ...(older ?? newer),
        groups: mergeGroups(
          groupsWithMonths(older),
          groupsWithMonths(newer),
          selected
        ),
      }
    }
    result[field] = checkpoint
  }
  return validatePreparation(result)
}
