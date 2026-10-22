import {
  activePackingState,
  barcodeValue,
  codeReservationIncludes,
  codeReservationMembers,
  groupPackingMonth,
  sameCodeOwner,
  validatePreparation,
  packingCodeSellerId,
} from './packing-model.js'
import { featureSignature } from './product-features.js'
import {
  assertRepeatCodeEligibility,
  purchaseMonthForCodes,
  purchaseSupplierForCodes,
  hasReviewedSupplierCodeIdentity,
  supplierCodeIdentityEquivalences,
} from './purchase-codes.js'
import { sourceRevision } from './inventory-model.js'

export const SHARED_PRODUCT_EDIT_ERROR =
  'Unlink this repeat purchase before changing its shared codes, variants, size handling or label names.'
export const SHARED_PRODUCT_FEATURE_EDIT_ERROR =
  'Unlink this repeat purchase before changing its product features.'

const key = (value) =>
  JSON.stringify([value.accountId || 'local', value.orderId])
const normalize = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en')

const featuresOf = (record, entryId) =>
  featureSignature(record?.productWorkflow?.[entryId]?.features)
const variantFeatures = (variant, record) =>
  [
    ...new Set(
      variant.entryIds.map((entryId) =>
        JSON.stringify(featuresOf(record, entryId))
      )
    ),
  ].sort()

/** Names can change; only a known source identity proves a shared store. */
export function repeatProductStoreIdentity(record) {
  const identity = purchaseSupplierForCodes(record)
  return identity.conflict ? null : identity.storeId
}

function locate(reference, preparations, records) {
  const preparation = preparations.find(
    (entry) => key(entry) === key(reference)
  )
  const record = records.find((entry) => key(entry.snapshot) === key(reference))
  const group = preparation?.groups.find(
    (entry) => entry.id === reference.groupId
  )
  if (!preparation || !record || !group)
    throw new Error(
      'The repeat purchase product is no longer available. Reopen it and try again.'
    )
  try {
    validatePreparation(preparation)
  } catch (cause) {
    throw new Error(
      `The complete products must have matching variants, sizes and features. ${cause.message}`,
      { cause }
    )
  }
  const ids = new Set(record.snapshot.items.map((item) => item.entryId))
  if (
    !group.variants.length ||
    group.variants.some(
      (variant) =>
        !variant.entryIds.length ||
        variant.entryIds.some((entryId) => !ids.has(entryId))
    )
  )
    throw new Error(
      'Review the complete current product group before linking a repeat purchase.'
    )
  if (
    !group.baseCode ||
    group.variants.some((variant) => variant.needsSizeMapping)
  )
    throw new Error(
      'Assign product codes and resolve every size before linking a repeat purchase.'
    )
  return { preparation, record, group }
}

function variantIdentity(variant, snapshot, productWorkflow = {}) {
  const selected = new Set(variant.entryIds)
  const evidence = snapshot.items
    .filter((item) => selected.has(item.entryId))
    .map((item) =>
      JSON.stringify([
        normalize(item.title),
        normalize(item.description),
        normalize(item.articleNumber || item.productNumber),
        normalize(item.sourceVariant),
        normalize(item.sourceSize),
        featuresOf({ productWorkflow }, item.entryId),
        (item.skuProperties || [])
          .map((property) => [
            normalize(property.label),
            normalize(property.value),
          ])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ])
    )
  return JSON.stringify([
    normalize(variant.variant),
    normalize(variant.size),
    [...new Set(evidence)].sort(),
  ])
}

function matchedVariants(source, target) {
  if (source.group.variants.length > target.group.variants.length)
    throw new Error(
      'The complete products must have matching variants, sizes and features.'
    )
  const targets = new Map()
  for (const variant of target.group.variants) {
    if (variantFeatures(variant, target.record).length !== 1)
      throw new Error(
        'The complete products must have matching variants, sizes and features.'
      )
    const identity = variantIdentity(
      variant,
      target.record.snapshot,
      target.record.productWorkflow
    )
    if (targets.has(identity))
      throw new Error(
        'These variants are ambiguous. Review their source details before linking.'
      )
    targets.set(identity, variant)
  }
  return source.group.variants.map((variant) => {
    if (variantFeatures(variant, source.record).length !== 1)
      throw new Error(
        'The complete products must have matching variants, sizes and features.'
      )
    const identity = variantIdentity(
      variant,
      source.record.snapshot,
      source.record.productWorkflow
    )
    const match = targets.get(identity)
    if (
      !match ||
      (variant.material &&
        match.material &&
        normalize(variant.material) !== normalize(match.material))
    )
      throw new Error(
        'The complete products must have matching variants, sizes and features.'
      )
    targets.delete(identity)
    return { source: variant, target: match }
  })
}

function assertCompatible(source, target, preparations, locks) {
  if (key(source.preparation) === key(target.preparation))
    throw new Error('Choose a product from another purchase order.')
  const sourceStore = repeatProductStoreIdentity(source.record)
  const targetStore = repeatProductStoreIdentity(target.record)
  if (
    !sourceStore ||
    sourceStore !== targetStore ||
    source.preparation.accountId !== target.preparation.accountId
  )
    throw new Error(
      'Repeat purchases must belong to the same known store and buyer account.'
    )
  if (
    [source, target].some(
      (value) =>
        !hasReviewedSupplierCodeIdentity(value.record, value.preparation)
    )
  )
    throw Object.assign(
      new Error(
        'Review the existing legacy supplier code identity before linking or assigning new codes. Issued codes and their owner remain unchanged.'
      ),
      { code: 'LEGACY_SUPPLIER_IDENTITY_REVIEW_REQUIRED' }
    )
  assertRepeatCodeEligibility({
    references: [source, target].map((value) => ({
      ...value.preparation,
      groupId: value.group.id,
    })),
    preparations,
    locks,
  })
  if (source.group.sharedProductId)
    throw new Error(
      'Unlink this repeat purchase before linking it to another product.'
    )
  return matchedVariants(source, target)
}

export function repeatProductCandidates({
  source,
  preparations,
  records,
  locks = [],
}) {
  let selected
  try {
    selected = locate(source, preparations, records)
  } catch {
    return []
  }
  const candidates = []
  for (const preparation of preparations) {
    if (key(preparation) === key(selected.preparation)) continue
    for (const group of preparation.groups) {
      const reference = {
        accountId: preparation.accountId,
        orderId: preparation.orderId,
        groupId: group.id,
      }
      try {
        const candidate = locate(reference, preparations, records)
        const matches = assertCompatible(
          selected,
          candidate,
          preparations,
          locks
        )
        candidates.push({
          ...reference,
          ...describe(
            candidate,
            matches.map(({ target }) => target)
          ),
        })
      } catch {
        // Incompatible candidates are intentionally absent, never silently recoded.
      }
    }
  }
  return candidates
}

function describe({ preparation, record, group }, variants = group.variants) {
  const selected = new Set(variants.flatMap((variant) => variant.entryIds))
  return {
    title: group.spanishName || group.title,
    baseCode: group.baseCode,
    month: groupPackingMonth(preparation, group),
    sellerName: record.snapshot.sellerName,
    sourceType: record.snapshot.sourceType,
    purchasedAt: record.snapshot.purchasedAt,
    variants: variants.map((variant) => {
      const ids = new Set(variant.entryIds)
      const items = record.snapshot.items.filter((item) =>
        ids.has(item.entryId)
      )
      return {
        barcode: barcodeValue(group, variant),
        variant: variant.variant,
        size: variant.size,
        quantity: quantity(items),
        items,
      }
    }),
    items: record.snapshot.items.filter((item) => selected.has(item.entryId)),
    quantity: quantity(
      record.snapshot.items.filter((item) => selected.has(item.entryId))
    ),
    sharedProductId: group.sharedProductId,
  }
}

function quantity(items) {
  if (items.some((item) => !/^\d+$/.test(String(item.quantity)))) return null
  return items.reduce((sum, item) => sum + BigInt(item.quantity), 0n).toString()
}

export function sharedVariantSources(
  preparations,
  records,
  sharedProductId,
  sharedVariantId,
  { accountId } = {}
) {
  const sources = new Map(
    records.map((record) => [key(record.snapshot), record])
  )
  return preparations
    .filter((preparation) => !accountId || preparation.accountId === accountId)
    .flatMap((preparation) =>
      preparation.groups
        .filter((group) => group.sharedProductId === sharedProductId)
        .flatMap((group) =>
          group.variants
            .filter(
              (variant) =>
                !sharedVariantId || variant.sharedVariantId === sharedVariantId
            )
            .flatMap((variant) => {
              const record = sources.get(key(preparation))
              if (!record) return []
              const ids = new Set(variant.entryIds)
              return record.snapshot.items
                .filter((item) => ids.has(item.entryId))
                .map((item) => ({
                  accountId: preparation.accountId,
                  orderId: preparation.orderId,
                  groupId: group.id,
                  variantId: variant.id,
                  item,
                  record,
                  barcode: barcodeValue(group, variant),
                }))
            })
        )
    )
}

/** Counts remain source evidence; combining a code never invents mixed cartons. */
export function combineRepeatCartonPacking(packings) {
  const rows = packings.flatMap(({ packing, orderId }) =>
    packing.rows.map((row) => ({ ...row, orderId }))
  )
  const total = packings.reduce((sum, { packing }) => sum + packing.total, 0)
  const exact =
    packings.length > 0 &&
    packings.every(({ packing }) => packing.exact) &&
    Number.isSafeInteger(total)
  return {
    rows,
    total,
    exact,
    requiresReview:
      !exact &&
      (packings.length > 1 ||
        packings.some(({ packing }) => packing.requiresReview)),
  }
}

function snapshotsFor(values) {
  return values.map(({ record, group, preparation }) => ({
    accountId: record.snapshot.accountId || 'local',
    orderId: record.snapshot.orderId,
    observedAt: record.snapshot.observedAt,
    sourceRevision: sourceRevision(record, preparation),
    supplierIdentity: purchaseSupplierForCodes(record),
    codeIdentityReview: structuredClone(
      record.supplierCodeIdentityReview ?? null
    ),
    productFeatures: Object.fromEntries(
      group.variants
        .flatMap((variant) => variant.entryIds)
        .map((entryId) => [
          entryId,
          record.productWorkflow?.[entryId]?.features || {},
        ])
    ),
  }))
}

/** Whole groups link only after the exact source-row and barcode preview is accepted. */
export function planSharedProductLink({
  source,
  target,
  preparations,
  records,
  locks = [],
  allocations = [],
  issuedCodes = [],
  newId = () => crypto.randomUUID(),
}) {
  const from = locate(source, preparations, records)
  const to = locate(target, preparations, records)
  const matches = assertCompatible(from, to, preparations, locks)
  const sharedProductId = to.group.sharedProductId || newId()
  const sharedStoreId = repeatProductStoreIdentity(to.record)
  const original = structuredClone(to.preparation)
  const repeated = structuredClone(from.preparation)
  const originalGroup = original.groups.find(
    (entry) => entry.id === to.group.id
  )
  const repeatGroup = repeated.groups.find(
    (entry) => entry.id === from.group.id
  )
  for (const group of [originalGroup, repeatGroup])
    Object.assign(group, {
      sharedProductId,
      sharedStoreId,
      baseCode: to.group.baseCode,
      spanishName: to.group.spanishName,
      category: to.group.category,
    })
  repeatGroup.month = groupPackingMonth(to.preparation, to.group)
  for (const variant of originalGroup.variants)
    variant.sharedVariantId ||= newId()
  for (const { source: variant, target: match } of matches) {
    const old = originalGroup.variants.find((entry) => entry.id === match.id)
    const next = repeatGroup.variants.find((entry) => entry.id === variant.id)
    Object.assign(next, {
      sharedVariantId: old.sharedVariantId,
      variantSuffix: match.variantSuffix,
      sizeSuffix: match.sizeSuffix,
    })
    if (match.spanishName !== undefined) next.spanishName = match.spanishName
    else delete next.spanishName
  }
  const drafts = [original, repeated].map(validatePreparation)
  const byKey = new Map(drafts.map((draft) => [key(draft), draft]))
  const final = preparations.map((draft) => byKey.get(key(draft)) || draft)
  validateSharedProducts(final, { orders: records })
  activePackingState(final, allocations, issuedCodes, {
    supplierIdentityEquivalences: supplierCodeIdentityEquivalences(records),
  })
  const changes = [from, to].flatMap((entry) =>
    entry.group.variants.flatMap((variant) => {
      const draft = byKey.get(key(entry.preparation))
      const group = draft.groups.find((value) => value.id === entry.group.id)
      const next = group.variants.find((value) => value.id === variant.id)
      const combined = sharedVariantSources(
        final,
        records,
        sharedProductId,
        next.sharedVariantId,
        { accountId: entry.preparation.accountId }
      )
      return variant.entryIds.map((entryId) => {
        const item = entry.record.snapshot.items.find(
          (value) => value.entryId === entryId
        )
        return {
          accountId: entry.preparation.accountId,
          orderId: entry.preparation.orderId,
          entryId,
          sourceType: entry.record.snapshot.sourceType,
          photo: item,
          name: item.description || item.title || entry.group.title,
          before: barcodeValue(entry.group, variant),
          after: barcodeValue(group, next),
          quantity: String(item.quantity),
          price: item.price,
          combinedQuantity: quantity(combined.map((value) => value.item)),
          variant: variant.variant,
          size: variant.size,
          features: structuredClone(
            entry.record.productWorkflow?.[entryId]?.features || {}
          ),
        }
      })
    })
  )
  return {
    preparations: drafts,
    expectedSnapshots: snapshotsFor([from, to]),
    source,
    target,
    sharedProductId,
    sourceProduct: describe(from),
    targetProduct: describe(to),
    changes,
  }
}

/** Detachment releases only this source alias; allocation chooses a fresh free code. */
export function planSharedProductUnlink({
  source,
  preparations,
  records,
  locks = [],
}) {
  const from = locate(source, preparations, records)
  assertRepeatCodeEligibility({ references: [source], preparations, locks })
  if (!from.group.sharedProductId)
    throw new Error('This product is not linked to another purchase.')
  const draft = structuredClone(from.preparation)
  const group = draft.groups.find((entry) => entry.id === from.group.id)
  const month = purchaseMonthForCodes(from.record)
  if (!month)
    throw Object.assign(
      new Error(
        'Resolve the original purchase date before generating new codes.'
      ),
      { code: 'PURCHASE_DATE_REQUIRED' }
    )
  group.month = month
  delete group.sharedProductId
  delete group.sharedStoreId
  group.baseCode = ''
  for (const variant of group.variants) delete variant.sharedVariantId
  return {
    preparations: [validatePreparation(draft)],
    expectedSnapshots: snapshotsFor([from]),
    source,
  }
}

/** Normal edit/reset/Undo paths may remove source rows, but cannot rewrite a shared identity. */
export function assertSharedPreparationEdit(previous, next) {
  if (!previous) {
    if (next.groups.some((group) => group.sharedProductId))
      throw new Error(SHARED_PRODUCT_EDIT_ERROR)
    return
  }
  const oldGroups = new Map(previous.groups.map((group) => [group.id, group]))
  const sharedRows = new Map(
    previous.groups
      .filter((group) => group.sharedProductId)
      .flatMap((group) =>
        group.variants.flatMap((variant) =>
          variant.entryIds.map((entryId) => [entryId, { group, variant }])
        )
      )
  )
  for (const group of next.groups) {
    for (const variant of group.variants)
      for (const entryId of variant.entryIds) {
        const owner = sharedRows.get(entryId)
        if (
          owner &&
          (owner.group.id !== group.id || owner.variant.id !== variant.id)
        )
          throw new Error(SHARED_PRODUCT_EDIT_ERROR)
      }
    const old = oldGroups.get(group.id)
    if (!old?.sharedProductId && !group.sharedProductId) continue
    if (
      !old ||
      [
        'sharedProductId',
        'sharedStoreId',
        'baseCode',
        'spanishName',
        'category',
        'sizeMode',
      ].some((field) => old[field] !== group[field]) ||
      groupPackingMonth(previous, old) !== groupPackingMonth(next, group)
    )
      throw new Error(SHARED_PRODUCT_EDIT_ERROR)
    for (const variant of group.variants) {
      const before = old.variants.find((entry) => entry.id === variant.id)
      if (
        !before ||
        [
          'sharedVariantId',
          'variantSuffix',
          'sizeSuffix',
          'variant',
          'size',
          'needsSizeMapping',
          'spanishName',
        ].some((field) => before[field] !== variant[field]) ||
        variant.entryIds.some((entryId) => !before.entryIds.includes(entryId))
      )
        throw new Error(SHARED_PRODUCT_EDIT_ERROR)
    }
  }
}

/** Product workflow status may change; a linked physical feature needs review after unlink. */
export function assertSharedProductFeatureEdit(
  previousOrder,
  nextOrder,
  preparations
) {
  const previousKey = key(previousOrder.snapshot)
  for (const preparation of preparations) {
    if (key(preparation) !== previousKey) continue
    for (const group of preparation.groups || []) {
      if (!group.sharedProductId) continue
      for (const variant of group.variants)
        for (const entryId of variant.entryIds)
          if (
            JSON.stringify(featuresOf(previousOrder, entryId)) !==
            JSON.stringify(featuresOf(nextOrder, entryId))
          )
            throw new Error(SHARED_PRODUCT_FEATURE_EDIT_ERROR)
    }
  }
}

/** Current shared assignments must agree even when a scoped file contains one alias. */
export function validateSharedProducts(
  preparations,
  { orders, issuedCodes } = {}
) {
  const records =
    orders && new Map(orders.map((record) => [key(record.snapshot), record]))
  const identities = new Map()
  const equivalences = supplierCodeIdentityEquivalences(orders ?? [])
  for (const preparation of preparations)
    for (const group of preparation.groups) {
      if (!group.sharedProductId) continue
      const source = records?.get(key(preparation))
      if (
        records &&
        (!source ||
          !repeatProductStoreIdentity(source) ||
          repeatProductStoreIdentity(source) !== group.sharedStoreId)
      )
        throw new Error(
          'Shared product identity does not match its source store.'
        )
      const identityKey = JSON.stringify([
        preparation.accountId,
        group.sharedProductId,
      ])
      const descriptor = JSON.stringify([
        packingCodeSellerId(preparation, group, {
          issuedCodes: issuedCodes ?? [],
          supplierIdentityEquivalences: equivalences,
        }),
        group.sharedStoreId,
        groupPackingMonth(preparation, group),
        group.baseCode,
        group.spanishName,
        group.category,
      ])
      const existing = identities.get(identityKey)
      if (existing && existing.descriptor !== descriptor)
        throw new Error(
          'Shared product identity has inconsistent store, packing month or product codes'
        )
      const state = existing || {
        descriptor,
        variants: new Map(),
        featureVariants: new Map(),
        sourceVariants: new Map(),
        members: new Set(),
      }
      const memberKey = key(preparation)
      if (state.members.has(memberKey))
        throw new Error(
          'A purchase may contain only one group for each shared product identity.'
        )
      state.members.add(memberKey)
      const seen = new Set()
      for (const variant of group.variants) {
        if (
          !variant.sharedVariantId ||
          seen.has(variant.sharedVariantId) ||
          variant.needsSizeMapping
        )
          throw new Error(
            'Shared products require distinct, resolved shared variant identities.'
          )
        seen.add(variant.sharedVariantId)
        const descriptor = JSON.stringify([
          variant.variantSuffix,
          variant.sizeSuffix,
          normalize(variant.variant),
          normalize(variant.size),
          variant.spanishName || '',
        ])
        const previous = state.variants.get(variant.sharedVariantId)
        if (previous && previous !== descriptor)
          throw new Error(
            'Shared variant identity has inconsistent barcode endings'
          )
        state.variants.set(variant.sharedVariantId, descriptor)
        if (records) {
          const features = variantFeatures(
            variant,
            records.get(key(preparation))
          )
          const signature = JSON.stringify(features)
          const previousFeatures = state.featureVariants.get(
            variant.sharedVariantId
          )
          if (
            features.length !== 1 ||
            (previousFeatures && previousFeatures !== signature)
          )
            throw new Error(
              'Shared repeat purchases must have matching product features.'
            )
          state.featureVariants.set(variant.sharedVariantId, signature)
          const sourceIdentity = variantIdentity(
            variant,
            records.get(key(preparation)).snapshot,
            records.get(key(preparation)).productWorkflow
          )
          const previousSource = state.sourceVariants.get(
            variant.sharedVariantId
          )
          if (previousSource && previousSource !== sourceIdentity)
            throw new Error(
              'Shared repeat purchases must have matching original product variants.'
            )
          state.sourceVariants.set(variant.sharedVariantId, sourceIdentity)
        }
      }
      identities.set(identityKey, state)
    }
  if (issuedCodes) {
    const expected = activePackingState(preparations, [], issuedCodes, {
      supplierIdentityEquivalences: equivalences,
    }).issuedCodes
    for (const reservation of issuedCodes.filter(
      (entry) => entry.sharedProductId
    )) {
      const current = expected.find(
        (entry) =>
          entry.accountId === reservation.accountId &&
          entry.kind === reservation.kind &&
          entry.code === reservation.code
      )
      if (
        !current ||
        !sameCodeOwner(current, reservation) ||
        codeReservationMembers(reservation).some(
          (member) => !codeReservationIncludes(current, member)
        ) ||
        codeReservationMembers(current).some(
          (member) => !codeReservationIncludes(reservation, member)
        )
      )
        throw new Error(
          'Shared code reservation does not match its current source members.'
        )
    }
  }
  return preparations
}
