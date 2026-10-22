import {
  activePackingState,
  groupPackingMonth,
  packingMonth,
  validatePreparation,
  mergeVariantMaterials,
} from './packing-model.js'
import { preparationAuthoring } from './product-vocabulary.js'
import { paymentSourceDependencies } from './payment-links.js'
import { cartonBatchesForItems } from './carton-confirmations.js'
import { batchInPackingScope, cartonBatchMark } from './carton-batches.js'
import { repeatProductStoreIdentity } from './repeat-products.js'

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
  ) {
    // Financial source orders are dependencies, never additional packing scope.
    if (!Array.isArray(input.dependencies))
      throw new Error('Packing backup contains an unselected source order')
  }
  let dependencies
  if (input.dependencies !== undefined) {
    if (!Array.isArray(input.dependencies))
      throw new Error('Packing backup dependencies must be an array')
    const actual = paymentSourceDependencies(orders, scope)
    const actualKeys = new Set(actual.map((order) => key(order.snapshot)))
    const declared = new Set()
    dependencies = input.dependencies.map((dependency) => {
      if (
        !dependency ||
        typeof dependency.orderId !== 'string' ||
        !/^[1-9]\d*$/.test(dependency.orderId) ||
        (dependency.accountId !== undefined &&
          (typeof dependency.accountId !== 'string' ||
            !dependency.accountId.trim()))
      )
        throw new Error(
          'Packing backup contains an invalid financial dependency'
        )
      const dependencyKey = key(dependency)
      if (
        seen.has(dependencyKey) ||
        declared.has(dependencyKey) ||
        !actualKeys.has(dependencyKey)
      )
        throw new Error(
          'Packing backup contains an unrelated or duplicate financial dependency'
        )
      declared.add(dependencyKey)
      return {
        accountId: dependency.accountId || 'local',
        orderId: dependency.orderId,
      }
    })
    if (
      actualKeys.size !== declared.size ||
      (input.mode === 'selection' &&
        orders.some(
          (order) =>
            !seen.has(key(order.snapshot)) && !declared.has(key(order.snapshot))
        ))
    )
      throw new Error('Packing backup is missing a financial source dependency')
  }
  return {
    mode: 'selection',
    months,
    orders: scope,
    ...(dependencies?.length ? { dependencies } : {}),
  }
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

export function selectPackingOrder(order, ids, preparation) {
  const selected = new Set(ids)
  const confirmedBatches = new Set(
    cartonBatchesForItems(order, ids)
      .filter((batch) => batch.complete)
      .map((batch) => batch.entryId)
  )
  const confirmationMonths = new Map()
  if (preparation) {
    const selectedByMonth = new Map()
    for (const group of preparation.groups) {
      const month = groupPackingMonth(preparation, group)
      if (!selectedByMonth.has(month)) selectedByMonth.set(month, new Set())
      for (const id of group.variants.flatMap((variant) => variant.entryIds))
        if (selected.has(id)) selectedByMonth.get(month).add(id)
    }
    for (const [month, monthIds] of selectedByMonth)
      for (const batch of cartonBatchesForItems(order, monthIds)) {
        if (!batch.complete) continue
        if (!confirmationMonths.has(batch.entryId))
          confirmationMonths.set(batch.entryId, new Set())
        confirmationMonths.get(batch.entryId).add(month)
      }
  }
  const result = structuredClone(order)
  if (result.productTags)
    result.productTags = Object.fromEntries(
      Object.entries(result.productTags).filter(([id]) => selected.has(id))
    )
  if (result.productWorkflow)
    result.productWorkflow = Object.fromEntries(
      Object.entries(result.productWorkflow).filter(([id]) => selected.has(id))
    )
  if (result.unitsPerCarton)
    result.unitsPerCarton = Object.fromEntries(
      Object.entries(result.unitsPerCarton).filter(([id]) => selected.has(id))
    )
  if (result.cartonDetails)
    result.cartonDetails = Object.fromEntries(
      Object.entries(result.cartonDetails).filter(([id]) => selected.has(id))
    )
  for (const field of ['cartonConfirmations', 'cartonConfirmationClocks'])
    if (result[field])
      result[field] = Object.fromEntries(
        Object.entries(result[field])
          .filter(([id]) => confirmedBatches.has(id))
          .map(([id, months]) => [
            id,
            Object.fromEntries(
              Object.entries(months).filter(
                ([month]) =>
                  !preparation || confirmationMonths.get(id)?.has(month)
              )
            ),
          ])
          .filter(([, months]) => Object.keys(months).length)
      )
  if (result.packingExcludedEntryIds)
    result.packingExcludedEntryIds = result.packingExcludedEntryIds.filter(
      (id) => selected.has(id)
    )
  for (const [clock, partial] of [
    ['productTagsUpdatedAt', 'productTagsPartialClocks'],
    ['productWorkflowUpdatedAt', 'productWorkflowPartialClocks'],
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

/** Retain only historical observations required to prove included physical allocations. */
function cartonSourceHistory(backup, batches, orders) {
  const demands = new Map(),
    current = new Map(orders.map((order) => [key(order.snapshot), order])),
    history = [...(backup.history || [])].sort((a, b) =>
      b.snapshot.observedAt.localeCompare(a.snapshot.observedAt)
    ),
    retained = new Map()
  for (const batch of batches) {
    if (batch.deletedAt) continue
    for (const item of batch.contents) {
      const identity = JSON.stringify([
        batch.accountId,
        item.orderId,
        item.entryId,
      ])
      if (!demands.has(identity))
        demands.set(identity, {
          accountId: batch.accountId,
          orderId: item.orderId,
          entryId: item.entryId,
          quantity: 0n,
          stores: new Set(),
        })
      const demand = demands.get(identity)
      demand.quantity += BigInt(item.quantity)
      demand.stores.add(batch.storeId)
    }
  }
  const quantity = (record, entryId) => {
    const value = record?.snapshot.items.find(
      (item) => item.entryId === entryId
    )?.quantity
    return /^\d+$/.test(value || '') ? BigInt(value) : 0n
  }
  const keep = (record) => {
    if (record)
      retained.set(
        JSON.stringify([
          record.snapshot.accountId,
          record.snapshot.orderId,
          record.snapshot.observedAt,
        ]),
        record
      )
  }
  for (const demand of demands.values()) {
    const orderKey = key(demand),
      source = current.get(orderKey),
      candidates = history.filter(
        (record) =>
          key(record.snapshot) === orderKey &&
          record.snapshot.items.some((item) => item.entryId === demand.entryId)
      )
    if (quantity(source, demand.entryId) < demand.quantity)
      keep(
        candidates.find(
          (record) => quantity(record, demand.entryId) >= demand.quantity
        )
      )
    for (const storeId of demand.stores)
      if (!source || repeatProductStoreIdentity(source.snapshot) !== storeId)
        keep(
          candidates.find(
            (record) => repeatProductStoreIdentity(record.snapshot) === storeId
          )
        )
  }
  return [...retained.values()].map((record) =>
    structuredClone({
      snapshot: record.snapshot,
      revision: record.revision,
      changedAt: record.changedAt,
      lastCheckedAt: record.lastCheckedAt,
      notes: '',
      tags: [],
      changedEntryIds: [],
      removedEntryIds: [],
    })
  )
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
  const selectedOrders = backup.orders
    .filter((order) => selected.has(key(order.snapshot)))
    .map((order) =>
      selectPackingOrder(
        order,
        selected.get(key(order.snapshot)),
        backup.preparations.find(
          (preparation) => key(preparation) === key(order.snapshot)
        )
      )
    )
  const dependencies = paymentSourceDependencies(backup.orders, selectedOrders)
  if (dependencies.length)
    scope.dependencies = dependencies.map(({ snapshot }) => ({
      accountId: snapshot.accountId || 'local',
      orderId: snapshot.orderId,
    }))
  const orders = [...selectedOrders, ...structuredClone(dependencies)]
  const preparations = backup.preparations
    .filter((preparation) => selected.has(key(preparation)))
    .map((preparation) =>
      selectPackingPreparation(preparation, selected.get(key(preparation)))
    )
  const cartonBatches = structuredClone(
      (backup.cartonBatches || []).filter(
        (batch) =>
          scope.months.includes(batch.month) &&
          batchInPackingScope(batch, scope.orders, preparations)
      )
    ),
    history = cartonSourceHistory(backup, cartonBatches, selectedOrders)
  const urls = new Set(
    orders.flatMap((order) =>
      order.snapshot.items
        .filter((item) =>
          selected.get(key(order.snapshot))?.includes(item.entryId)
        )
        .flatMap((item) => [item.thumbnail, ...(item.photos || [])])
    )
  )
  // Full source rows are retained to reconcile money. Local originals have no
  // remote fallback, so keep every original referenced by those dependencies.
  for (const order of [...orders, ...history])
    for (const item of order.snapshot.items)
      for (const url of [item.thumbnail, ...(item.photos || [])])
        if (url?.startsWith('local-image:')) urls.add(url)
  return {
    format: '1688-order-library',
    version: 4,
    exportedAt: backup.exportedAt,
    orders,
    // Physical allocations can predate reduced current purchase quantities.
    history,
    preparations,
    ...activePackingState(preparations),
    images: structuredClone(
      (backup.images || []).filter((image) => urls.has(image.url))
    ),
    packingPreferences: packingPreferences(backup.packingPreferences, orders),
    packingScope: scope,
    cartonBatches,
    omittedCartonBatchIds: (backup.cartonBatches || [])
      .filter(
        (batch) =>
          !batch.deletedAt &&
          scope.months.includes(batch.month) &&
          !batchInPackingScope(batch, scope.orders, preparations) &&
          (batch.contents.some((item) =>
            scope.orders.some(
              (order) =>
                (order.accountId || 'local') === batch.accountId &&
                order.orderId === item.orderId &&
                order.entryIds.includes(item.entryId)
            )
          ) ||
            [...batch.groups, cartonBatchMark(batch)].some(
              (reference) =>
                reference &&
                preparations.some(
                  (preparation) =>
                    preparation.accountId === batch.accountId &&
                    preparation.orderId === reference.orderId &&
                    preparation.groups.some(
                      (group) => group.id === reference.groupId
                    )
                )
            ))
      )
      .map((batch) => batch.id),
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
