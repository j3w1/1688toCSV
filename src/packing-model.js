import {
  automaticNaming,
  createNameSuggester,
  DEFAULT_VOCABULARY,
  vocabularyEntryMetadata,
} from './product-vocabulary.js'
import {
  createSizeClassifier,
  DEFAULT_SIZE_VOCABULARY,
  resolvePendingSizeMappings,
  validateSizeVocabulary,
} from './size-vocabulary.js'
import {
  suggestMaterial,
  validateMaterialVocabulary,
} from './material-vocabulary.js'
import { validateColorVocabulary } from './color-vocabulary.js'
import { normalizeAppearance } from './appearance.js'
import { normalizeOrderTags, normalizeTags } from './order-tags.js'

/** Material authoring follows source rows even when grouping is restored. */
export function variantMaterial(variant, entryId = variant.entryIds[0]) {
  return (
    variant.materialOverrides?.[entryId] || {
      value: variant.material || '',
      source:
        variant.materialSource || (variant.material ? 'manual' : 'suggested'),
    }
  )
}

function storeMaterials(variant, entries) {
  const values = variant.entryIds.map(
    (id) => entries.get(id) || variantMaterial(variant, id)
  )
  const first = values[0] || { value: '', source: 'suggested' }
  variant.material = first.value
  variant.materialSource = first.source
  delete variant.materialOverrides
  const different = variant.entryIds.filter(
    (id, index) =>
      values[index].value !== first.value ||
      values[index].source !== first.source
  )
  if (different.length)
    variant.materialOverrides = Object.fromEntries(
      different.map((id) => [id, { ...values[variant.entryIds.indexOf(id)] }])
    )
}

export function mergeVariantMaterials(target, sources) {
  storeMaterials(
    target,
    new Map(
      sources.flatMap((variant) =>
        variant.entryIds.map((id) => [id, variantMaterial(variant, id)])
      )
    )
  )
}

export function setVariantMaterial(
  variant,
  value,
  entryIds = variant.entryIds
) {
  const selected = new Set(entryIds)
  storeMaterials(
    variant,
    new Map(
      variant.entryIds.map((id) => [
        id,
        selected.has(id)
          ? { value: String(value).trim(), source: 'manual' }
          : variantMaterial(variant, id),
      ])
    )
  )
}

/** Refresh local suggestions only; authored text and deliberate clears survive. */
export function refreshPreparationMaterials(
  preparation,
  snapshot,
  suggestions
) {
  const result = structuredClone(preparation)
  const source = new Map(snapshot.items.map((item) => [item.entryId, item]))
  for (const group of result.groups)
    for (const variant of group.variants)
      storeMaterials(
        variant,
        new Map(
          variant.entryIds.map((id) => {
            const current = variantMaterial(variant, id)
            return [
              id,
              current.source === 'manual' || !source.has(id)
                ? current
                : {
                    value:
                      suggestions?.get(id) ?? suggestMaterial(source.get(id)),
                    source: 'suggested',
                  },
            ]
          })
        )
      )
  return result
}

function text(value, label, empty = true) {
  if (typeof value !== 'string' || (!empty && !value.trim()))
    throw new Error(`${label} must be text${empty ? '' : ' with a value'}`)
  return value.trim()
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value
}

function id(value, label) {
  const result = text(value, label, false)
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new Error(`${label} is invalid`)
  return result
}

export function packingMonth(value) {
  if (typeof value !== 'string' || !/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(value))
    throw new Error('Choose a packing month between 2000 and 2099')
  return value
}

export function codePrefix(month) {
  return `CE${packingMonth(month).slice(2).replace('-', '')}`
}

export function groupPackingMonth(preparation, group) {
  return packingMonth(group.month ?? preparation.month)
}

function reordered(value, label) {
  if (value !== undefined && typeof value !== 'boolean')
    throw new Error(`${label} must be true or false`)
  return value === undefined ? {} : { manualReordered: value }
}

/** A duplicate current assignment identifies its owner. */
export class CodeConflictError extends Error {
  constructor(existing, requested) {
    const otherVariant =
      existing.kind === 'barcode' &&
      requested.kind === 'barcode' &&
      existing.accountId === requested.accountId &&
      existing.orderId === requested.orderId &&
      existing.groupId === requested.groupId &&
      existing.variantId !== requested.variantId
    super(
      otherVariant
        ? `Code conflict: ${requested.code} belongs to another variant of this product. Keep different variant or size endings.`
        : `Code conflict: ${requested.code} is already reserved for ${existing.sellerId !== requested.sellerId ? 'another seller' : 'another product or variant'}`
    )
    this.name = 'CodeConflictError'
    this.code = 'PACKING_CODE_CONFLICT'
    this.conflict = {
      code: requested.code,
      kind: requested.kind,
      owner: structuredClone(existing),
      requestedOwner: structuredClone(requested),
    }
  }
}

function letters(index) {
  let result = ''
  do {
    result = String.fromCharCode(65 + (index % 26)) + result
    index = Math.floor(index / 26) - 1
  } while (index >= 0)
  return result
}

/** Suggestions are drafts. Saving confirms their editable product/variant membership. */
export function createPreparation(
  snapshot,
  month,
  vocabulary = DEFAULT_VOCABULARY,
  sizeVocabulary = DEFAULT_SIZE_VOCABULARY
) {
  packingMonth(month)
  const suggest = createNameSuggester(vocabulary)
  const sizeClassifier = createSizeClassifier(sizeVocabulary)
  const groups = new Map()
  const candidates = new Map()
  const variantKeys = new Map()
  const sourceEndings = new Map()
  for (const item of snapshot.items) {
    const title = (item.title || item.description).trim()
    // Spreadsheet group markers are authoritative even when names repeat or
    // descriptions differ. A marker is source identity, never an assigned code.
    const groupKey =
      snapshot.sourceType === 'spreadsheet' ? item.sourceGroup : title
    let group = groups.get(groupKey)
    if (!group) {
      const suggestion = suggest(title)
      group = {
        id: crypto.randomUUID(),
        title,
        baseCode: '',
        spanishName: suggestion.spanishName,
        category: suggestion.category,
        naming: automaticNaming(suggestion),
        variants: [],
      }
      groups.set(groupKey, group)
    }
    const extracted = sizeClassifier.extract(item)
    const size = item.sourceSize || extracted.size
    const variant = item.sourceVariant || extracted.variant
    const variantProperties = extracted.variantProperties
    // Only identical complete attribute sets suggest a shared variant. No source
    // row or amount is combined; entry IDs remain individually addressable.
    const attributes = (entries) =>
      entries.map((property) => [property.label.trim(), property.value.trim()])
    const variantIdentity =
      snapshot.sourceType === 'spreadsheet' && item.sourceVariant
        ? [['variant', item.sourceVariant]]
        : attributes(variantProperties)
    const key = JSON.stringify([groupKey, variantIdentity, size])
    const existing = candidates.get(key)
    if (existing) existing.entryIds.push(item.entryId)
    else {
      const candidate = {
        id: crypto.randomUUID(),
        entryIds: [item.entryId],
        variant,
        size,
        variantSuffix: '',
        sizeSuffix: '',
        needsSizeMapping: false,
      }
      candidates.set(key, candidate)
      variantKeys.set(candidate.id, JSON.stringify(variantIdentity))
      if (snapshot.sourceType === 'spreadsheet')
        sourceEndings.set(candidate.id, {
          variant: item.sourceVariant,
          size: item.sourceSize,
        })
      group.variants.push(candidate)
    }
  }
  for (const group of groups.values()) {
    const variants = [
      ...new Set(group.variants.map((variant) => variantKeys.get(variant.id))),
    ]
    const sizeSuggestions = sizeClassifier.suggest(
      group.variants.map((variant) => variant.size),
      group.variants.map((variant) => variantKeys.get(variant.id))
    )
    for (const [index, variant] of group.variants.entries()) {
      variant.variantSuffix =
        sourceEndings.get(variant.id)?.variant ||
        (variants.length > 1
          ? letters(variants.indexOf(variantKeys.get(variant.id)))
          : '')
      variant.sizeSuffix = sizeSuggestions[index].sizeSuffix
      variant.needsSizeMapping = sizeSuggestions[index].needsSizeMapping
    }
  }
  return {
    accountId: snapshot.accountId || 'local',
    orderId: snapshot.orderId,
    sellerId: snapshot.sellerUnavailable
      ? ''
      : (snapshot.sellerMemberLogin || snapshot.sellerName || '').trim(),
    month,
    revision: 0,
    updatedAt: new Date().toISOString(),
    groups: [...groups.values()],
  }
}

export function barcodeValue(group, variant) {
  if (
    !/^CE\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[1-9]\d)(?:0[1-9]|[1-9]\d)$/.test(
      group.baseCode
    )
  )
    throw new Error('Save a valid base code before generating labels')
  if (variant.needsSizeMapping)
    throw new Error('Map this variant size before generating labels')
  if (
    !/^[A-Z]*$/.test(variant.variantSuffix) ||
    !/^[A-Z0-9]*$/.test(variant.sizeSuffix)
  )
    throw new Error('Barcode suffixes must use uppercase letters and numbers')
  return `${group.baseCode}${variant.variantSuffix}${variant.sizeSuffix}`
}

/** Refresh never mutates authoring; removed memberships remain in the stored draft. */
export function activeGroups(preparation, snapshot) {
  const ids = new Set(snapshot.items.map((item) => item.entryId))
  return preparation.groups
    .map((group) => ({
      ...group,
      variants: group.variants
        .map((variant) => ({
          ...variant,
          entryIds: variant.entryIds.filter((entryId) => ids.has(entryId)),
        }))
        .filter((variant) => variant.entryIds.length),
    }))
    .filter((group) => group.variants.length)
}

function orderedEntries(entries, orderedIds, label) {
  if (
    !Array.isArray(orderedIds) ||
    orderedIds.length !== entries.length ||
    new Set(orderedIds).size !== entries.length
  )
    throw new Error(`${label} must include each existing item exactly once`)
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  return orderedIds.map((entryId, index) => {
    const entry = byId.get(entryId)
    if (!entry)
      throw new Error(`${label} cannot move items from another order or group`)
    return {
      ...entry,
      ...(entries[index].id !== entryId ? { manualReordered: true } : {}),
    }
  })
}

/** Arrays are the authored export order. Reordering never changes a label code. */
export function reorderPreparationGroups(preparation, orderedGroupIds) {
  const draft = structuredClone(preparation)
  draft.groups = orderedEntries(draft.groups, orderedGroupIds, 'Group order')
  return draft
}

export function reorderPreparationVariants(
  preparation,
  groupId,
  orderedVariantIds
) {
  const draft = structuredClone(preparation)
  const group = draft.groups.find((entry) => entry.id === groupId)
  if (!group)
    throw new Error('The product group no longer exists in this order')
  group.variants = orderedEntries(
    group.variants,
    orderedVariantIds,
    'Product order'
  )
  return draft
}

export function resetPreparationOrder(preparation, snapshot) {
  if (
    preparation.orderId !== snapshot.orderId ||
    preparation.accountId !== (snapshot.accountId || 'local')
  )
    throw new Error('The source order does not match this preparation')
  const positions = new Map(
    snapshot.items.map((item, index) => [item.entryId, index])
  )
  const firstPosition = (entryIds) =>
    Math.min(...entryIds.map((entryId) => positions.get(entryId) ?? Infinity))
  const draft = structuredClone(preparation)
  for (const group of draft.groups) {
    delete group.manualReordered
    group.variants.sort(
      (a, b) => firstPosition(a.entryIds) - firstPosition(b.entryIds)
    )
    for (const variant of group.variants) delete variant.manualReordered
  }
  draft.groups.sort(
    (a, b) =>
      firstPosition(a.variants.flatMap((variant) => variant.entryIds)) -
      firstPosition(b.variants.flatMap((variant) => variant.entryIds))
  )
  return draft
}

/** Saving this draft allocates an available code against current assignments. */
export function regeneratePreparationCode(preparation, groupId) {
  const draft = structuredClone(preparation)
  const group = draft.groups.find((entry) => entry.id === groupId)
  if (!group)
    throw new Error('The product group no longer exists in this order')
  group.baseCode = ''
  return draft
}

/** Explicit, reviewable override for one product; allocation still validates codes. */
export function setGroupSizeMode(
  preparation,
  groupId,
  mode,
  { snapshot, sizeVocabulary = DEFAULT_SIZE_VOCABULARY } = {}
) {
  if (!['automatic', 'none'].includes(mode))
    throw new Error('Choose automatic size codes or no size difference')
  if (
    snapshot &&
    (snapshot.orderId !== preparation.orderId ||
      (snapshot.accountId || 'local') !== preparation.accountId)
  )
    throw new Error('The source order does not match this preparation')
  const draft = structuredClone(preparation)
  const group = draft.groups.find((entry) => entry.id === groupId)
  if (!group)
    throw new Error('The product group no longer exists in this order')
  if (mode === 'none') {
    group.sizeMode = 'none'
    for (const variant of group.variants) {
      variant.sizeSuffix = ''
      variant.needsSizeMapping = false
    }
  } else {
    delete group.sizeMode
    for (const variant of group.variants)
      if (!variant.sizeSuffix) variant.needsSizeMapping = true
    const resolved = resolvePendingSizeMappings(
      { ...draft, groups: [group] },
      sizeVocabulary,
      { snapshot }
    )
    draft.groups[draft.groups.indexOf(group)] = resolved.preparation.groups[0]
  }
  return draft
}

export function packingCheckpoint(
  preparation,
  { includeDefaults = false } = {}
) {
  const checkpoint = {
    month: preparation.month,
    sellerId: preparation.sellerId,
    updatedAt: preparation.updatedAt,
    groups: structuredClone(preparation.groups),
    ...(preparation.restoreScopes !== undefined
      ? { restoreScopes: structuredClone(preparation.restoreScopes) }
      : {}),
  }
  if (includeDefaults && preparation.defaultPacking)
    checkpoint.defaults = packingCheckpoint(preparation.defaultPacking)
  return checkpoint
}

/** Extend defaults only for newly prepared source rows, never a manual split or merge. */
export function extendDefaultPacking(preparation, snapshot) {
  if (!preparation.defaultPacking)
    return packingCheckpoint(resetPreparationOrder(preparation, snapshot))
  const baseline = {
    ...preparation,
    ...structuredClone(preparation.defaultPacking),
  }
  const knownIds = new Set(
    baseline.groups.flatMap((group) =>
      group.variants.flatMap((variant) => variant.entryIds)
    )
  )
  const byGroup = new Map(baseline.groups.map((group) => [group.id, group]))
  const byVariant = new Map(
    baseline.groups.flatMap((group) =>
      group.variants.map((variant) => [variant.id, variant])
    )
  )
  let changed = false
  for (const group of preparation.groups) {
    for (const variant of group.variants) {
      const additions = variant.entryIds.filter(
        (entryId) => !knownIds.has(entryId)
      )
      if (!additions.length) continue
      changed = true
      for (const entryId of additions) knownIds.add(entryId)
      const oldVariant = byVariant.get(variant.id)
      if (oldVariant) {
        oldVariant.entryIds.push(...additions)
        continue
      }
      let target = byGroup.get(group.id)
      if (!target) {
        target = {
          ...structuredClone(group),
          month: groupPackingMonth(preparation, group),
          variants: [],
        }
        delete target.manualReordered
        baseline.groups.push(target)
        byGroup.set(target.id, target)
      }
      const added = { ...structuredClone(variant), entryIds: additions }
      delete added.manualReordered
      target.variants.push(added)
      byVariant.set(added.id, added)
    }
  }
  if (!changed) return structuredClone(preparation.defaultPacking)
  baseline.updatedAt = preparation.updatedAt
  return packingCheckpoint(resetPreparationOrder(baseline, snapshot))
}

/** Returns a previewable draft. The caller confirms before saving its revision. */
export function restoreDefaultPacking(preparation) {
  if (!preparation.defaultPacking)
    throw new Error('This order has no saved default layout yet')
  const draft = structuredClone(preparation)
  const currentGroups = new Map(draft.groups.map((group) => [group.id, group]))
  const currentVariants = new Map(
    draft.groups.flatMap((group) =>
      group.variants.map((variant) => [variant.id, variant])
    )
  )
  const currentMaterials = new Map(
    draft.groups.flatMap((group) =>
      group.variants
        .filter(
          (variant) =>
            Object.hasOwn(variant, 'material') || variant.materialOverrides
        )
        .flatMap((variant) =>
          variant.entryIds.map((id) => [id, variantMaterial(variant, id)])
        )
    )
  )
  Object.assign(draft, structuredClone(preparation.defaultPacking))
  draft.updatedAt = preparation.updatedAt
  for (const group of draft.groups) {
    const current = currentGroups.get(group.id)
    if (current) {
      for (const field of ['spanishName', 'category', 'naming'])
        if (Object.hasOwn(current, field))
          group[field] = structuredClone(current[field])
    }
    delete group.manualReordered
    for (const variant of group.variants) {
      const currentVariant = currentVariants.get(variant.id)
      if (currentVariant) {
        variant.variant = currentVariant.variant
        if (Object.hasOwn(currentVariant, 'spanishName'))
          variant.spanishName = currentVariant.spanishName
      }
      if (variant.entryIds.some((id) => currentMaterials.has(id)))
        storeMaterials(variant, currentMaterials)
      delete variant.manualReordered
    }
  }
  return draft
}

/** Describe only changes Reset will make; revisions, timestamps and retained names are not changes. */
export function defaultPackingChanges(preparation) {
  if (!preparation.defaultPacking) return []
  const restored = restoreDefaultPacking(preparation)
  const beforeGroups = new Map(
    preparation.groups.map((group, index) => [group.id, { group, index }])
  )
  const afterGroups = new Map(
    restored.groups.map((group, index) => [group.id, { group, index }])
  )
  const changes = []
  for (const groupId of new Set([
    ...afterGroups.keys(),
    ...beforeGroups.keys(),
  ])) {
    const old = beforeGroups.get(groupId)
    const next = afterGroups.get(groupId)
    const before = old?.group
    const after = next?.group
    const membership = (group) =>
      group?.variants.map((variant) => [
        variant.id,
        [...variant.entryIds].sort(),
      ]) || []
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    const members = (group) =>
      group?.variants.flatMap((variant) => variant.entryIds) || []
    const beforeVariants = new Map(
      before?.variants.map((variant) => [variant.id, variant]) || []
    )
    const afterVariants = new Map(
      after?.variants.map((variant) => [variant.id, variant]) || []
    )
    const barcodeChanges = []
    for (const variantId of new Set([
      ...afterVariants.keys(),
      ...beforeVariants.keys(),
    ])) {
      const previous = beforeVariants.get(variantId)
      const current = afterVariants.get(variantId)
      const fields = (variant) =>
        variant && [
          variant.variantSuffix,
          variant.sizeSuffix,
          variant.size,
          variant.needsSizeMapping === true,
        ]
      if (same(fields(previous), fields(current))) continue
      barcodeChanges.push({
        variantId,
        entryIds: [
          ...new Set([
            ...(previous?.entryIds || []),
            ...(current?.entryIds || []),
          ]),
        ],
        before: previous
          ? `${before.baseCode}${previous.variantSuffix}${previous.sizeSuffix}`
          : '',
        after: current
          ? `${after.baseCode}${current.variantSuffix}${current.sizeSuffix}`
          : '',
        beforeVariantSuffix: previous?.variantSuffix ?? '',
        afterVariantSuffix: current?.variantSuffix ?? '',
        beforeSizeSuffix: previous?.sizeSuffix ?? '',
        afterSizeSuffix: current?.sizeSuffix ?? '',
        beforeNeedsSizeMapping: previous?.needsSizeMapping === true,
        afterNeedsSizeMapping: current?.needsSizeMapping === true,
      })
    }
    const change = {
      groupId,
      before: before ? structuredClone(before) : null,
      after: after ? structuredClone(after) : null,
      entryIds: [...new Set([...members(before), ...members(after)])],
      beforePosition: old ? old.index + 1 : null,
      afterPosition: next ? next.index + 1 : null,
      baseCodeChanged: before?.baseCode !== after?.baseCode,
      monthChanged: Boolean(
        before &&
        after &&
        groupPackingMonth(preparation, before) !==
          groupPackingMonth(restored, after)
      ),
      groupingChanged: !same(
        membership(before).sort(([a], [b]) => a.localeCompare(b)),
        membership(after).sort(([a], [b]) => a.localeCompare(b))
      ),
      sizeModeChanged:
        (before?.sizeMode || 'automatic') !== (after?.sizeMode || 'automatic'),
      orderChanged: old?.index !== next?.index,
      variantOrderChanged: !same(
        before?.variants.map((variant) => variant.id) || [],
        after?.variants.map((variant) => variant.id) || []
      ),
      clearedManualOrdering: Boolean(
        before?.manualReordered ||
        before?.variants.some((variant) => variant.manualReordered)
      ),
      barcodeChanges,
    }
    if (
      change.baseCodeChanged ||
      change.monthChanged ||
      change.groupingChanged ||
      change.sizeModeChanged ||
      change.orderChanged ||
      change.variantOrderChanged ||
      change.clearedManualOrdering ||
      barcodeChanges.length
    )
      changes.push(change)
  }
  return changes
}

export function hasDefaultPackingChanges(preparation) {
  return defaultPackingChanges(preparation).length > 0
}

/** Remove only packing membership; source rows and the issued-code ledger are untouched. */
export function removeSelectedProducts(preparation, entryIds) {
  if (
    !Array.isArray(entryIds) ||
    entryIds.some(
      (entryId) => typeof entryId !== 'string' || !/^[1-9]\d*$/.test(entryId)
    )
  )
    throw new Error('Choose products from this packing to remove')
  const selected = new Set(entryIds)
  const known = new Set(
    preparation.groups.flatMap((group) =>
      group.variants.flatMap((variant) => variant.entryIds)
    )
  )
  if ([...selected].some((entryId) => !known.has(entryId)))
    throw new Error('The selected products are no longer in this packing')
  const draft = structuredClone(preparation)
  const remove = (checkpoint) => {
    checkpoint.groups = checkpoint.groups
      .map((group) => ({
        ...group,
        variants: group.variants
          .map((variant) => ({
            ...variant,
            entryIds: variant.entryIds.filter(
              (entryId) => !selected.has(entryId)
            ),
          }))
          .filter((variant) => variant.entryIds.length),
      }))
      .filter((group) => group.variants.length)
  }
  remove(draft)
  // Reset defaults describe the current packing membership. Previous packing
  // remains a separate, explicit restore action and retains its original scope.
  if (draft.defaultPacking) remove(draft.defaultPacking)
  return draft
}

export function restorePreviousPacking(preparation) {
  if (!preparation.previousPacking)
    throw new Error('This order has no previous packing to restore')
  const previous = preparation.previousPacking
  return {
    ...structuredClone(preparation),
    ...packingCheckpoint(previous),
    updatedAt: preparation.updatedAt,
    previousPacking: packingCheckpoint(preparation, { includeDefaults: true }),
    defaultPacking: packingCheckpoint(previous.defaults || previous),
  }
}

/** Freeze source rows before planning. Allocation happens only in the database transaction. */
export function planSelectedPreparations(
  selections,
  month,
  { vocabulary = DEFAULT_VOCABULARY, sizeVocabulary } = {}
) {
  packingMonth(month)
  if (!Array.isArray(selections))
    throw new Error('Packing selection must be an array')
  const preparations = []
  const scope = []
  const changes = []
  const orders = new Set()
  for (const selection of selections) {
    const { snapshot, preparation: previous } = selection
    if (!snapshot || !Array.isArray(selection.entryIds))
      throw new Error(
        'Each packing selection needs its source order and selected entry IDs'
      )
    const key = JSON.stringify([
      snapshot.accountId || 'local',
      snapshot.orderId,
    ])
    if (orders.has(key)) throw new Error('Select each order only once')
    orders.add(key)
    const currentIds = new Set(snapshot.items.map((item) => item.entryId))
    const selected = new Set(selection.entryIds)
    if ([...selected].some((entryId) => !currentIds.has(entryId)))
      throw new Error(
        'The selected products changed. Refresh the selection before preparing.'
      )
    if (!selected.size) continue
    if (
      previous &&
      (previous.orderId !== snapshot.orderId ||
        previous.accountId !== (snapshot.accountId || 'local'))
    )
      throw new Error('Selected source order does not match its preparation')
    const draft = previous
      ? structuredClone(previous)
      : createPreparation(
          { ...snapshot, items: [] },
          month,
          vocabulary,
          sizeVocabulary
        )
    // Materialize legacy group months before changing the order's latest month.
    for (const group of draft.groups)
      group.month = groupPackingMonth(draft, group)
    draft.month = month
    const knownIds = new Set(
      draft.groups.flatMap((group) =>
        group.variants.flatMap((variant) => variant.entryIds)
      )
    )
    const missing = snapshot.items.filter(
      (item) => selected.has(item.entryId) && !knownIds.has(item.entryId)
    )
    if (missing.length) {
      const added = createPreparation(
        { ...snapshot, items: missing },
        month,
        vocabulary,
        sizeVocabulary
      )
      for (const group of added.groups) {
        group.month = month
        draft.groups.push(group)
        changes.push({
          orderId: draft.orderId,
          groupId: group.id,
          oldCode: '',
          oldMonth: '',
          newMonth: month,
          split: false,
          added: true,
          entryIds: group.variants.flatMap((variant) => variant.entryIds),
        })
      }
    }
    const selectedGroupIds = []
    const selectedVariantIds = []
    const nextGroups = []
    for (const group of draft.groups) {
      const memberIds = group.variants.flatMap((variant) => variant.entryIds)
      const selectedMembers = memberIds.filter((entryId) =>
        selected.has(entryId)
      )
      if (!selectedMembers.length) {
        nextGroups.push(group)
        continue
      }
      let target = group
      if (group.month !== month) {
        const originalCode = group.baseCode
        const oldMonth = group.month
        const partial = selectedMembers.length !== memberIds.length
        if (partial) {
          target = {
            ...structuredClone(group),
            id: crypto.randomUUID(),
            month,
            baseCode: '',
            variants: group.variants
              .filter((variant) =>
                variant.entryIds.some((entryId) => selected.has(entryId))
              )
              .map((variant) => ({
                ...structuredClone(variant),
                id: crypto.randomUUID(),
                entryIds: variant.entryIds.filter((entryId) =>
                  selected.has(entryId)
                ),
              })),
          }
          delete target.manualReordered
          for (const variant of target.variants) delete variant.manualReordered
          group.variants = group.variants
            .map((variant) => ({
              ...variant,
              entryIds: variant.entryIds.filter(
                (entryId) => !selected.has(entryId)
              ),
            }))
            .filter((variant) => variant.entryIds.length)
          nextGroups.push(group)
        } else {
          group.month = month
          group.baseCode = ''
        }
        changes.push({
          orderId: draft.orderId,
          groupId: target.id,
          previousGroupId: group.id,
          oldCode: originalCode,
          oldMonth,
          newMonth: month,
          split: partial,
          added: false,
          entryIds: selectedMembers,
        })
      }
      nextGroups.push(target)
      selectedGroupIds.push(target.id)
      selectedVariantIds.push(
        ...target.variants
          .filter((variant) =>
            variant.entryIds.some((entryId) => selected.has(entryId))
          )
          .map((variant) => variant.id)
      )
    }
    draft.groups = nextGroups
    preparations.push(draft)
    scope.push({
      accountId: draft.accountId,
      orderId: draft.orderId,
      entryIds: [...selected],
      groupIds: selectedGroupIds,
      variantIds: selectedVariantIds,
    })
  }
  return {
    month,
    preparations,
    scope,
    changes,
    orderCount: preparations.length,
    rowCount: scope.reduce((sum, entry) => sum + entry.entryIds.length, 0),
    changedCodeCount: changes.filter((change) => change.oldCode).length,
    splitGroupCount: changes.filter((change) => change.split).length,
  }
}

export function validatePreparation(input) {
  record(input, 'Preparation')
  const month = packingMonth(input.month)
  if (!Number.isSafeInteger(input.revision) || input.revision < 0)
    throw new Error('Preparation revision must be a non-negative integer')
  if (
    typeof input.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(input.updatedAt))
  )
    throw new Error('Preparation updatedAt must be a timestamp')
  if (!Array.isArray(input.groups))
    throw new Error('Preparation groups must be an array')
  if (
    input.packingPosition !== undefined &&
    (!Number.isSafeInteger(input.packingPosition) || input.packingPosition < 0)
  )
    throw new Error('Packing position must be a non-negative integer')
  const groupIds = new Set()
  const variantIds = new Set()
  const members = new Set()
  const codes = new Map()
  const barcodes = new Map()
  const groups = input.groups.map((inputGroup) => {
    record(inputGroup, 'Product group')
    const groupId = id(inputGroup.id, 'Group ID')
    if (groupIds.has(groupId)) throw new Error('Duplicate product group ID')
    groupIds.add(groupId)
    const groupMonth = groupPackingMonth(input, inputGroup)
    const baseCode = text(inputGroup.baseCode, 'Base code')
    if (
      baseCode &&
      (!baseCode.startsWith(codePrefix(groupMonth)) ||
        !/^CE\d{4}(?:0[1-9]|[1-9]\d)(?:0[1-9]|[1-9]\d)$/.test(baseCode))
    )
      throw Object.assign(
        new Error(
          'Base code must use the chosen month and group/item numbers 01–99'
        ),
        {
          packingIssue: {
            orderId: input.orderId,
            groupId,
            field: 'code',
            value: baseCode,
          },
        }
      )
    const owner = {
      accountId: input.accountId,
      orderId: input.orderId,
      sellerId: input.sellerId,
      month: groupMonth,
      groupId,
      kind: 'base',
      code: baseCode,
      ...(inputGroup.sharedProductId !== undefined
        ? {
            sharedProductId: id(
              inputGroup.sharedProductId,
              'Shared product ID'
            ),
            sharedStoreId: text(
              inputGroup.sharedStoreId,
              'Shared store identity',
              false
            ),
          }
        : {}),
    }
    if (inputGroup.sharedStoreId !== undefined && !owner.sharedProductId)
      throw new Error('Shared store identity requires a shared product')
    if (baseCode && codes.has(baseCode))
      throw new CodeConflictError(codes.get(baseCode), owner)
    if (baseCode) codes.set(baseCode, owner)
    if (!Array.isArray(inputGroup.variants))
      throw new Error('Product variants must be an array')
    const group = {
      id: groupId,
      title: text(inputGroup.title, 'Product title'),
      baseCode,
      ...(owner.sharedProductId
        ? {
            sharedProductId: owner.sharedProductId,
            sharedStoreId: owner.sharedStoreId,
          }
        : {}),
      ...(inputGroup.month !== undefined ? { month: groupMonth } : {}),
      ...reordered(inputGroup.manualReordered, 'Group manual ordering'),
      spanishName: text(
        inputGroup.spanishName ?? '',
        'Spanish name'
      ).toUpperCase(),
      category: text(inputGroup.category ?? '', 'Category'),
      ...(inputGroup.naming !== undefined
        ? { naming: validateNaming(inputGroup.naming) }
        : {}),
      variants: [],
    }
    if (inputGroup.sizeMode !== undefined) {
      if (!['automatic', 'none'].includes(inputGroup.sizeMode))
        throw new Error('Choose automatic size codes or no size difference')
      if (inputGroup.sizeMode === 'none') group.sizeMode = 'none'
    }
    group.variants = inputGroup.variants.map((inputVariant) => {
      record(inputVariant, 'Variant')
      const variantId = id(inputVariant.id, 'Variant ID')
      if (variantIds.has(variantId)) throw new Error('Duplicate variant ID')
      variantIds.add(variantId)
      if (!Array.isArray(inputVariant.entryIds))
        throw new Error('Variant entryIds must be an array')
      const entryIds = inputVariant.entryIds.map((entryId) => {
        if (typeof entryId !== 'string' || !/^[1-9]\d*$/.test(entryId))
          throw new Error('Variant entry ID must be a decimal ID')
        if (members.has(entryId))
          throw new Error('A source entry may belong to only one variant')
        members.add(entryId)
        return entryId
      })
      const variantSuffix = text(inputVariant.variantSuffix, 'Variant suffix')
      const sizeSuffix = text(inputVariant.sizeSuffix, 'Size suffix')
      if (!/^[A-Z]*$/.test(variantSuffix) || !/^[A-Z0-9]*$/.test(sizeSuffix))
        throw Object.assign(
          new Error('Barcode suffixes must use uppercase letters and numbers'),
          {
            packingIssue: {
              orderId: input.orderId,
              groupId,
              variantId,
              field: !/^[A-Z]*$/.test(variantSuffix) ? 'variant' : 'size',
              value: variantSuffix + sizeSuffix,
            },
          }
        )
      if (
        inputVariant.needsSizeMapping !== undefined &&
        typeof inputVariant.needsSizeMapping !== 'boolean'
      )
        throw new Error('needsSizeMapping must be true or false')
      const variant = {
        id: variantId,
        entryIds,
        variant: text(inputVariant.variant, 'Variant description'),
        size: text(inputVariant.size, 'Size'),
        variantSuffix,
        sizeSuffix,
        needsSizeMapping: inputVariant.needsSizeMapping ?? false,
        ...(inputVariant.sharedVariantId !== undefined
          ? {
              sharedVariantId: id(
                inputVariant.sharedVariantId,
                'Shared variant ID'
              ),
            }
          : {}),
        ...reordered(inputVariant.manualReordered, 'Variant manual ordering'),
        ...(inputVariant.spanishName !== undefined
          ? {
              spanishName: text(
                inputVariant.spanishName,
                'Variant Spanish name'
              ).toUpperCase(),
            }
          : {}),
        ...(inputVariant.material !== undefined
          ? { material: text(inputVariant.material, 'Material') }
          : {}),
      }
      if (Boolean(group.sharedProductId) !== Boolean(variant.sharedVariantId))
        throw new Error(
          'Shared products require a shared identity for every variant'
        )
      if (inputVariant.materialSource !== undefined) {
        if (!['manual', 'suggested'].includes(inputVariant.materialSource))
          throw new Error('Material source must be manual or suggested')
        variant.materialSource = inputVariant.materialSource
      }
      if (inputVariant.materialOverrides !== undefined) {
        record(inputVariant.materialOverrides, 'Material overrides')
        const overrides = []
        for (const [entryId, input] of Object.entries(
          inputVariant.materialOverrides
        )) {
          if (!entryIds.includes(entryId)) continue // Partial moves retain only their source rows.
          record(input, 'Material override')
          if (!['manual', 'suggested'].includes(input.source))
            throw new Error('Material source must be manual or suggested')
          overrides.push([
            entryId,
            { value: text(input.value, 'Material'), source: input.source },
          ])
        }
        if (overrides.length)
          variant.materialOverrides = Object.fromEntries(overrides)
      }
      if (baseCode && !variant.needsSizeMapping) {
        const value = barcodeValue(group, variant)
        const variantOwner = {
          ...owner,
          kind: 'barcode',
          code: value,
          variantId,
          ...(variant.sharedVariantId
            ? { sharedVariantId: variant.sharedVariantId }
            : {}),
        }
        if (barcodes.has(value))
          throw new CodeConflictError(barcodes.get(value), variantOwner)
        barcodes.set(value, variantOwner)
      }
      return variant
    })
    return group
  })
  const orderId = text(input.orderId, 'Preparation order ID', false)
  if (!/^[1-9]\d*$/.test(orderId))
    throw new Error('Preparation order ID must be a decimal ID')
  const sellerId = text(input.sellerId, 'Seller identity')
  if (!sellerId || /^(?:Seller unavailable|Unknown Seller)$/i.test(sellerId))
    throw new Error(
      'Identify the seller before saving preparation or assigning label codes.'
    )
  const result = {
    accountId: text(input.accountId, 'Preparation account', false),
    orderId,
    sellerId,
    month,
    revision: input.revision,
    updatedAt: new Date(input.updatedAt).toISOString(),
    groups,
  }
  if (input.packingPosition !== undefined)
    result.packingPosition = input.packingPosition
  if (input.restoreScopes !== undefined) {
    if (
      !Array.isArray(input.restoreScopes) ||
      input.restoreScopes.length > members.size ** 2
    )
      throw new Error(
        'Packing restore scope evidence must be bounded to retained products'
      )
    const seen = new Set(),
      covered = new Set()
    result.restoreScopes = input.restoreScopes.map((scope) => {
      if (
        !Array.isArray(scope) ||
        !scope.length ||
        scope.length > members.size ||
        new Set(scope).size !== scope.length ||
        scope.some((id) => !members.has(id))
      )
        throw new Error(
          'Packing restore scope evidence contains invalid products'
        )
      const key = JSON.stringify([...scope].sort())
      if (seen.has(key))
        throw new Error(
          'Packing restore scope evidence contains duplicate scopes'
        )
      seen.add(key)
      for (const id of scope) covered.add(id)
      return [...scope]
    })
    if (covered.size !== members.size)
      throw new Error(
        'Packing restore scope evidence must cover every retained product'
      )
  }
  Object.assign(
    result,
    input.packingManualReordered === undefined
      ? {}
      : {
          packingManualReordered: reordered(
            input.packingManualReordered,
            'Order manual ordering'
          ).manualReordered,
        }
  )
  for (const field of ['defaultPacking', 'previousPacking']) {
    if (input[field] === undefined) continue
    const checkpoint = record(input[field], 'Packing checkpoint')
    if (
      checkpoint.defaultPacking !== undefined ||
      checkpoint.previousPacking !== undefined ||
      (field === 'defaultPacking' && checkpoint.defaults !== undefined)
    )
      throw new Error('Packing checkpoints cannot contain nested history')
    const validated = validatePreparation({
      accountId: result.accountId,
      orderId: result.orderId,
      revision: 0,
      sellerId: checkpoint.sellerId,
      month: checkpoint.month,
      updatedAt: checkpoint.updatedAt,
      groups: checkpoint.groups,
      ...(checkpoint.restoreScopes !== undefined
        ? { restoreScopes: checkpoint.restoreScopes }
        : {}),
    })
    result[field] = packingCheckpoint(validated)
    if (checkpoint.defaults !== undefined) {
      const defaults = record(checkpoint.defaults, 'Previous packing defaults')
      if (
        defaults.defaults !== undefined ||
        defaults.previousPacking !== undefined ||
        defaults.defaultPacking !== undefined
      )
        throw new Error('Packing checkpoints cannot contain nested history')
      const validatedDefaults = validatePreparation({
        accountId: result.accountId,
        orderId: result.orderId,
        revision: 0,
        sellerId: defaults.sellerId,
        month: defaults.month,
        updatedAt: defaults.updatedAt,
        groups: defaults.groups,
        ...(defaults.restoreScopes !== undefined
          ? { restoreScopes: defaults.restoreScopes }
          : {}),
      })
      result[field].defaults = packingCheckpoint(validatedDefaults)
    }
  }
  return result
}

/** New model/color endings must not borrow standard or configured size codes. */
export function createVariantSuffixValidator(
  sizeVocabulary = DEFAULT_SIZE_VOCABULARY
) {
  const sizes = new Set(
    [...DEFAULT_SIZE_VOCABULARY, ...validateSizeVocabulary(sizeVocabulary)].map(
      ({ suffix }) => suffix
    )
  )
  return (value) =>
    typeof value === 'string' &&
    /^[A-Z]*$/.test(value) &&
    !sizes.has(value) &&
    !/^(?:X*[SL]|M)$/.test(value)
}

/** Check authored suffix changes without reinterpreting saved or source codes. */
export function validatePreparationSuffixEdits(
  preparation,
  previous,
  { snapshot, restored, sizeVocabulary = DEFAULT_SIZE_VOCABULARY } = {}
) {
  const validVariantSuffix = createVariantSuffixValidator(sizeVocabulary)
  const previousVariants = new Map(),
    previousEntries = new Map(),
    restoredEntries = new Map()
  if (
    previous?.accountId === preparation.accountId &&
    previous?.orderId === preparation.orderId
  )
    for (const group of previous.groups)
      for (const variant of group.variants) {
        previousVariants.set(variant.id, variant)
        for (const entryId of variant.entryIds)
          previousEntries.set(entryId, variant)
      }
  if (
    restored?.accountId === preparation.accountId &&
    restored?.orderId === preparation.orderId
  )
    for (const group of restored.groups)
      for (const variant of group.variants)
        for (const entryId of variant.entryIds)
          restoredEntries.set(entryId, variant)
  let sourceVariants
  const sourceVariant = (variant) => {
    if (!snapshot) return false
    if (!sourceVariants)
      sourceVariants = new Map(
        createPreparation(snapshot, preparation.month, [], sizeVocabulary)
          .groups.flatMap((group) => group.variants)
          .flatMap((variant) =>
            variant.entryIds.map((entryId) => [entryId, variant.variantSuffix])
          )
      )
    return (
      variant.entryIds.length > 0 &&
      variant.entryIds.every(
        (entryId) => sourceVariants.get(entryId) === variant.variantSuffix
      )
    )
  }
  for (const group of preparation.groups)
    for (const variant of group.variants)
      for (const [field, key] of [
        ['variant', 'variantSuffix'],
        ['size', 'sizeSuffix'],
      ]) {
        const value = variant[key]
        if (
          !value ||
          (variant.entryIds.length === 0 &&
            previousVariants.get(variant.id)?.entryIds.length === 0 &&
            previousVariants.get(variant.id)[key] === value) ||
          (variant.entryIds.length > 0 &&
            variant.entryIds.every(
              (entryId) => previousEntries.get(entryId)?.[key] === value
            )) ||
          (variant.entryIds.length > 0 &&
            variant.entryIds.every(
              (entryId) => restoredEntries.get(entryId)?.[key] === value
            ))
        )
          continue
        if (
          field === 'variant'
            ? validVariantSuffix(value) || sourceVariant(variant)
            : !validVariantSuffix(value) ||
              value === 'X' ||
              !/^[A-Z]$/.test(value)
        )
          continue
        throw Object.assign(
          new Error(
            field === 'variant'
              ? 'Enter size endings in Size code; use model/color letters here.'
              : 'Enter model/color letters in Variant code; use a size code here.'
          ),
          {
            code: 'PACKING_SUFFIX_FIELD_MISMATCH',
            packingIssue: {
              orderId: preparation.orderId,
              groupId: group.id,
              variantId: variant.id,
              field,
              value,
            },
          }
        )
      }
  return preparation
}

function validateNaming(input) {
  record(input, 'Name provenance')
  const result = {}
  for (const field of ['spanishName', 'category']) {
    if (input[field] === undefined) continue
    const entry = record(input[field], 'Name provenance field')
    if (!['automatic', 'manual'].includes(entry.source))
      throw new Error('Name provenance source must be automatic or manual')
    const value = text(entry.value, 'Name provenance value')
    result[field] = {
      source: entry.source,
      value: field === 'spanishName' ? value.toUpperCase() : value,
    }
  }
  return result
}

export function validatePackingPreferences(input = {}) {
  record(input, 'Packing preferences')
  record(input.settings ?? {}, 'Packing settings')
  if (!Array.isArray(input.vocabulary ?? []))
    throw new Error('Vocabulary must be an array')
  const vocabulary = (input.vocabulary ?? []).map((entry) => {
    record(entry, 'Vocabulary entry')
    const result = {
      match: text(entry.match, 'Vocabulary match', false),
      spanishName: text(
        entry.spanishName ?? '',
        'Vocabulary Spanish name'
      ).toUpperCase(),
      category: text(entry.category ?? '', 'Vocabulary category'),
      ...(entry.exclude !== undefined
        ? { exclude: text(entry.exclude, 'Vocabulary exclusions') }
        : {}),
    }
    return { ...result, ...vocabularyEntryMetadata({ ...entry, ...result }) }
  })
  const logoDataUrl = text(input.logoDataUrl ?? '', 'Logo image')
  if (
    logoDataUrl &&
    !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(
      logoDataUrl
    )
  )
    throw new Error('The logo must be a raster image')
  const result = {
    settings: structuredClone(input.settings ?? {}),
    vocabulary,
    sizeVocabulary: validateSizeVocabulary(
      input.sizeVocabulary ?? DEFAULT_SIZE_VOCABULARY
    ),
    ...(input.colorVocabulary !== undefined
      ? { colorVocabulary: validateColorVocabulary(input.colorVocabulary) }
      : {}),
    ...(input.materialVocabulary !== undefined
      ? {
          materialVocabulary: validateMaterialVocabulary(
            input.materialVocabulary
          ),
        }
      : {}),
    ...(input.appearance !== undefined
      ? { appearance: normalizeAppearance(input.appearance) }
      : {}),
    ...(input.orderTags !== undefined
      ? { orderTags: normalizeOrderTags(input.orderTags) }
      : {}),
    ...(input.productTags !== undefined
      ? { productTags: normalizeTags(input.productTags, 'product') }
      : {}),
    logoDataUrl,
  }
  if (JSON.stringify(result).length > 3 * 1024 * 1024)
    throw new Error('Packing preferences exceed the 3 MB limit')
  return result
}

export function validateAllocation(input) {
  record(input, 'Monthly allocation')
  if (!Array.isArray(input.groups))
    throw new Error('Allocation groups must be an array')
  const numbers = new Set()
  return {
    accountId: text(input.accountId, 'Allocation account', false),
    month: packingMonth(input.month),
    groups: input.groups.map((group) => {
      record(group, 'Seller group')
      if (
        !Number.isInteger(group.number) ||
        group.number < 1 ||
        group.number > 99 ||
        numbers.has(group.number)
      )
        throw new Error(
          'Monthly seller group numbers must be unique and between 01 and 99'
        )
      numbers.add(group.number)
      if (
        !Number.isInteger(group.nextItem) ||
        group.nextItem < 1 ||
        group.nextItem > 100
      )
        throw new Error('The next item number must be between 1 and 100')
      return {
        number: group.number,
        sellerId: text(group.sellerId, 'Seller identity', false),
        nextItem: group.nextItem,
      }
    }),
  }
}

export function validateIssuedCode(input) {
  record(input, 'Issued code')
  const result = {
    accountId: text(input.accountId, 'Issued account', false),
    code: text(input.code, 'Issued code', false),
    kind: input.kind,
    orderId: text(input.orderId, 'Issued order ID', false),
    groupId: id(input.groupId, 'Issued group ID'),
    sellerId: text(input.sellerId, 'Issued seller', false),
    month: packingMonth(input.month),
    ...(input.kind === 'barcode'
      ? { variantId: id(input.variantId, 'Issued variant ID') }
      : {}),
  }
  if (
    !['base', 'barcode'].includes(result.kind) ||
    !/^[1-9]\d*$/.test(result.orderId) ||
    !result.code.startsWith(codePrefix(result.month)) ||
    !(
      result.kind === 'base'
        ? /^CE\d{4}(?:0[1-9]|[1-9]\d)(?:0[1-9]|[1-9]\d)$/
        : /^CE\d{4}(?:0[1-9]|[1-9]\d)(?:0[1-9]|[1-9]\d)[A-Z0-9]*$/
    ).test(result.code)
  )
    throw new Error('Issued code is invalid')
  if (input.ownerSnapshot !== undefined) {
    const snapshot = record(input.ownerSnapshot, 'Code owner snapshot')
    if (!Array.isArray(snapshot.entryIds) || !Array.isArray(snapshot.photos))
      throw new Error('Code owner snapshot must contain entry IDs and photos')
    result.ownerSnapshot = {
      sellerName: text(snapshot.sellerName ?? '', 'Code owner seller name'),
      groupTitle: text(snapshot.groupTitle ?? '', 'Code owner product title'),
      spanishName: text(snapshot.spanishName ?? '', 'Code owner Spanish name'),
      category: text(snapshot.category ?? '', 'Code owner category'),
      variant: text(snapshot.variant ?? '', 'Code owner variant'),
      entryIds: snapshot.entryIds.map((entryId) => {
        if (typeof entryId !== 'string' || !/^[1-9]\d*$/.test(entryId))
          throw new Error('Code owner entry ID must be a decimal ID')
        return entryId
      }),
      photos: snapshot.photos.map((photo) => text(photo, 'Code owner photo')),
    }
  }
  if (input.sharedProductId !== undefined) {
    result.sharedProductId = id(input.sharedProductId, 'Shared product ID')
    result.sharedStoreId = text(
      input.sharedStoreId,
      'Shared store identity',
      false
    )
    if (result.kind === 'barcode')
      result.sharedVariantId = id(input.sharedVariantId, 'Shared variant ID')
    else if (input.sharedVariantId !== undefined)
      throw new Error('A base reservation cannot own a shared variant')
    if (!Array.isArray(input.members) || !input.members.length)
      throw new Error('Shared code reservation requires its source members')
    const seen = new Set()
    result.members = input.members.map((member) => {
      record(member, 'Shared code member')
      const owner = validateIssuedCode({
        ...result,
        ...member,
        sharedProductId: undefined,
        sharedStoreId: undefined,
        sharedVariantId: undefined,
        members: undefined,
      })
      const value = {
        orderId: owner.orderId,
        groupId: owner.groupId,
        ...(result.kind === 'barcode' ? { variantId: owner.variantId } : {}),
        ...(member.ownerSnapshot ? { ownerSnapshot: owner.ownerSnapshot } : {}),
      }
      const key = JSON.stringify([
        value.orderId,
        value.groupId,
        value.variantId,
      ])
      if (seen.has(key))
        throw new Error('Shared code reservation contains duplicate members')
      seen.add(key)
      return value
    })
    if (
      !result.members.some((member) =>
        sameOwner(result, { ...result, ...member })
      )
    )
      throw new Error(
        'Shared code reservation is missing its primary source member'
      )
  } else if (
    input.sharedStoreId !== undefined ||
    input.sharedVariantId !== undefined ||
    input.members !== undefined
  )
    throw new Error('Shared code members require a shared product identity')
  return result
}

function sameOwner(a, b) {
  return [
    'accountId',
    'kind',
    'orderId',
    'groupId',
    'variantId',
    'sellerId',
    'month',
  ].every((field) => a[field] === b[field])
}

/** One current code owner can have explicitly reviewed source aliases. */
export function codeReservationMembers(reservation) {
  return (
    reservation.members?.map((member) => ({
      ...reservation,
      ...member,
      ownerSnapshot: member.ownerSnapshot,
      members: undefined,
    })) || [reservation]
  )
}

export function codeReservationIncludes(reservation, owner) {
  return codeReservationMembers(reservation).some((member) =>
    sameOwner(member, owner)
  )
}

export function sameCodeOwner(a, b) {
  if (a.sharedProductId || b.sharedProductId)
    return (
      Boolean(a.sharedProductId && b.sharedProductId) &&
      [
        'accountId',
        'kind',
        'sellerId',
        'month',
        'sharedProductId',
        'sharedStoreId',
        'sharedVariantId',
      ].every((field) => a[field] === b[field])
    )
  return sameOwner(a, b)
}

function mergeCodeOwners(existing, incoming) {
  if (!existing) return incoming
  if (!sameCodeOwner(existing, incoming))
    throw new CodeConflictError(existing, incoming)
  if (!existing.sharedProductId)
    return existing.ownerSnapshot ? existing : incoming
  const members = new Map()
  for (const member of [...existing.members, ...incoming.members]) {
    const key = JSON.stringify([
      member.orderId,
      member.groupId,
      member.variantId,
    ])
    const previous = members.get(key)
    members.set(key, previous?.ownerSnapshot ? previous : member)
  }
  return { ...existing, members: [...members.values()] }
}

/** Read-only evidence for old reservations whose group was later split or merged. */
export function codeOwnerEvidence(reservation, preparation, issuedCodes = []) {
  if (reservation.sharedProductId && preparation) {
    const alias = codeReservationMembers(reservation).find(
      (member) =>
        member.accountId === preparation.accountId &&
        member.orderId === preparation.orderId
    )
    if (alias) reservation = alias
  }
  if (
    !preparation ||
    preparation.accountId !== reservation.accountId ||
    preparation.orderId !== reservation.orderId
  )
    return {}
  const views = [
    preparation,
    preparation.defaultPacking,
    preparation.previousPacking,
    preparation.previousPacking?.defaults,
  ]
    .filter((view) => view?.sellerId === reservation.sellerId)
    .map((view) => ({
      current: view === preparation,
      groups: view.groups.filter(
        (group) => groupPackingMonth(view, group) === reservation.month
      ),
    }))
  const currentGroups = views.find((view) => view.current)?.groups || []
  const group = currentGroups.find((entry) => entry.id === reservation.groupId)
  const variant = group?.variants.find(
    (entry) => entry.id === reservation.variantId
  )
  const exactEvidenceGroup = views
    .flatMap((view) => view.groups)
    .find(
      (entry) =>
        entry.id === reservation.groupId &&
        (reservation.kind === 'base' ||
          entry.variants.some((item) => item.id === reservation.variantId))
    )
  const variantIds = new Set(
    reservation.kind === 'barcode'
      ? [reservation.variantId]
      : issuedCodes
          .filter(
            (entry) =>
              entry.kind === 'barcode' &&
              sameOwner(reservation, {
                ...entry,
                kind: 'base',
                variantId: undefined,
              }) &&
              entry.code.slice(0, 10) === reservation.code
          )
          .map((entry) => entry.variantId)
  )
  const findVariants = (groups) =>
    groups.flatMap((entry) =>
      entry.variants
        .filter((item) => variantIds.has(item.id))
        .map((item) => ({ group: entry, variant: item }))
    )
  const currentMatches = findVariants(currentGroups)
  const evidence = new Map()
  for (const view of views)
    for (const match of findVariants(view.groups))
      if (!evidence.has(match.variant.id)) evidence.set(match.variant.id, match)
  const matches = [...evidence.values()]
  const singleGroup = (items) =>
    items.length && new Set(items.map((entry) => entry.group.id)).size === 1
      ? items[0].group
      : undefined
  const recoveredCurrentGroup =
    currentMatches.length === variantIds.size
      ? singleGroup(currentMatches)
      : undefined
  const currentGroup =
    reservation.kind === 'base'
      ? group || recoveredCurrentGroup
      : variant
        ? group
        : recoveredCurrentGroup
  const evidenceGroup = exactEvidenceGroup || singleGroup(matches)
  const evidenceVariant =
    reservation.kind === 'barcode'
      ? evidenceGroup?.variants.find(
          (entry) => entry.id === reservation.variantId
        )
      : undefined
  return {
    group,
    variant,
    evidenceGroup,
    evidenceVariant,
    currentGroup,
    currentVariant:
      reservation.kind === 'barcode' ? currentMatches[0]?.variant : undefined,
    recovered: !exactEvidenceGroup && matches.length > 0,
    entryIds: [
      ...new Set(
        exactEvidenceGroup
          ? (evidenceVariant
              ? [evidenceVariant]
              : exactEvidenceGroup.variants
            ).flatMap((entry) => entry.entryIds)
          : matches.flatMap((entry) => entry.variant.entryIds)
      ),
    ],
  }
}

export function mergePackingState(allocations, issuedCodes) {
  const months = new Map()
  for (const input of allocations) {
    const allocation = validateAllocation(input)
    const key = JSON.stringify([allocation.accountId, allocation.month])
    const merged = months.get(key) || { ...allocation, groups: [] }
    for (const group of allocation.groups) {
      const existing = merged.groups.find(
        (entry) => entry.number === group.number
      )
      if (existing && existing.sellerId !== group.sellerId)
        throw new Error(
          'Backup conflict: monthly group belongs to another seller'
        )
      if (existing)
        existing.nextItem = Math.max(existing.nextItem, group.nextItem)
      else merged.groups.push({ ...group })
    }
    months.set(key, merged)
  }
  const issued = new Map()
  for (const input of issuedCodes) {
    const reservation = validateIssuedCode(input)
    const key = JSON.stringify([
      reservation.accountId,
      reservation.kind,
      reservation.code,
    ])
    const existing = issued.get(key)
    // Keep the first captured owner evidence even if that product is renamed.
    issued.set(key, mergeCodeOwners(existing, reservation))
    const allocation = months.get(
      JSON.stringify([reservation.accountId, reservation.month])
    )
    const group = allocation?.groups.find(
      (entry) => entry.number === Number(reservation.code.slice(6, 8))
    )
    if (
      !group ||
      group.sellerId !== reservation.sellerId ||
      group.nextItem <= Number(reservation.code.slice(8, 10))
    )
      throw new Error(
        'Issued code is missing its monthly allocation reservation'
      )
  }
  for (const reservation of issued.values()) {
    if (reservation.kind !== 'barcode') continue
    const base = issued.get(
      JSON.stringify([
        reservation.accountId,
        'base',
        reservation.code.slice(0, 10),
      ])
    )
    if (
      !base ||
      !sameCodeOwner(base, {
        ...reservation,
        kind: 'base',
        variantId: undefined,
        sharedVariantId: undefined,
      }) ||
      codeReservationMembers(reservation).some(
        (member) =>
          !codeReservationIncludes(base, {
            ...member,
            kind: 'base',
            variantId: undefined,
          })
      )
    )
      throw new Error('Issued barcode is missing its owning base reservation')
  }
  const shared = new Map()
  for (const reservation of issued.values()) {
    if (!reservation.sharedProductId) continue
    const key = JSON.stringify([
      reservation.accountId,
      reservation.sharedProductId,
    ])
    const identity = [
      reservation.sellerId,
      reservation.month,
      reservation.sharedStoreId,
      reservation.code.slice(0, 10),
    ]
    const previous = shared.get(key)
    if (
      previous &&
      JSON.stringify(previous.identity) !== JSON.stringify(identity)
    )
      throw new Error(
        'Shared product identity has inconsistent store, packing month or product codes'
      )
    const entry = previous || { identity, variants: new Map() }
    if (reservation.kind === 'barcode') {
      const code = entry.variants.get(reservation.sharedVariantId)
      if (code && code !== reservation.code)
        throw new Error(
          'Shared variant identity has inconsistent barcode endings'
        )
      entry.variants.set(reservation.sharedVariantId, reservation.code)
    }
    shared.set(key, entry)
  }
  return {
    allocations: [...months.values()],
    issuedCodes: [...issued.values()],
  }
}

/** Call inside one readwrite transaction with the complete existing reservation set. */
export function allocatePreparation(
  input,
  allocations,
  issuedCodes,
  { snapshot, historicalReservations = [] } = {}
) {
  const preparation = validatePreparation(input)
  const state = withHistoricalReservations(
    allocations,
    issuedCodes,
    historicalReservations
  )
  const issuedByCode = new Map(
    state.issuedCodes.map((entry) => [
      JSON.stringify([entry.accountId, entry.kind, entry.code]),
      entry,
    ])
  )
  const historicalKeys = new Set(
    historicalReservations.map((entry) =>
      JSON.stringify([entry.accountId, entry.kind, entry.code])
    )
  )
  const reserve = (code, group, variant) => {
    const entryIds =
      variant?.entryIds ?? group.variants.flatMap((entry) => entry.entryIds)
    const members = new Set(entryIds)
    const reservation = {
      accountId: preparation.accountId,
      code,
      kind: variant ? 'barcode' : 'base',
      orderId: preparation.orderId,
      groupId: group.id,
      ...(variant ? { variantId: variant.id } : {}),
      sellerId: preparation.sellerId,
      month: groupPackingMonth(preparation, group),
      ...(group.sharedProductId
        ? {
            sharedProductId: group.sharedProductId,
            sharedStoreId: group.sharedStoreId,
            ...(variant ? { sharedVariantId: variant.sharedVariantId } : {}),
          }
        : {}),
      ...(snapshot
        ? {
            ownerSnapshot: {
              sellerName: snapshot.sellerName || '',
              groupTitle: group.title,
              spanishName: group.spanishName,
              category: group.category,
              variant: variant?.variant || '',
              entryIds: [...entryIds],
              photos: [
                ...new Set(
                  snapshot.items
                    .filter((item) => members.has(item.entryId))
                    .map((item) => item.thumbnail)
                    .filter(Boolean)
                ),
              ].slice(0, 6),
            },
          }
        : {}),
    }
    if (group.sharedProductId)
      reservation.members = [
        {
          orderId: reservation.orderId,
          groupId: reservation.groupId,
          ...(variant ? { variantId: variant.id } : {}),
          ...(reservation.ownerSnapshot
            ? { ownerSnapshot: reservation.ownerSnapshot }
            : {}),
        },
      ]
    const key = JSON.stringify([
      reservation.accountId,
      reservation.kind,
      reservation.code,
    ])
    const existing = issuedByCode.get(key)
    issuedByCode.set(
      key,
      historicalKeys.has(key)
        ? mergeHistoricalCodeOwners(existing, reservation)
        : mergeCodeOwners(existing, reservation)
    )
  }
  const claimGroup = (allocation, number) => {
    let group = allocation.groups.find((entry) => entry.number === number)
    if (group && group.sellerId !== preparation.sellerId)
      throw new Error('This monthly group belongs to another seller')
    if (!group) {
      group = { number, sellerId: preparation.sellerId, nextItem: 1 }
      allocation.groups.push(group)
    }
    return group
  }
  for (const group of preparation.groups) {
    const month = groupPackingMonth(preparation, group)
    let allocation = state.allocations.find(
      (entry) =>
        entry.accountId === preparation.accountId && entry.month === month
    )
    if (!allocation) {
      allocation = { accountId: preparation.accountId, month, groups: [] }
      state.allocations.push(allocation)
    }
    if (!group.baseCode) {
      let slot = [...allocation.groups]
        .reverse()
        .find(
          (entry) =>
            entry.sellerId === preparation.sellerId && entry.nextItem <= 99
        )
      if (!slot) {
        const used = new Set(allocation.groups.map((entry) => entry.number))
        let number = 1
        while (used.has(number)) number += 1
        if (number > 99)
          throw new Error(
            'All 99 seller groups for this packing month are exhausted'
          )
        slot = claimGroup(allocation, number)
      }
      group.baseCode = `${codePrefix(month)}${String(slot.number).padStart(2, '0')}${String(slot.nextItem).padStart(2, '0')}`
    }
    reserve(group.baseCode, group)
    const slot = claimGroup(allocation, Number(group.baseCode.slice(6, 8)))
    slot.nextItem = Math.max(
      slot.nextItem,
      Number(group.baseCode.slice(8, 10)) + 1
    )
    for (const variant of group.variants)
      if (!variant.needsSizeMapping)
        reserve(barcodeValue(group, variant), group, variant)
  }
  const validated = mergePackingState(state.allocations, [
    ...issuedByCode.values(),
  ])
  return { preparation: validatePreparation(preparation), ...validated }
}

export function validatePreparationReservations(preparation, state) {
  if (
    preparation.revision < 1 ||
    preparation.groups.some((group) => !group.baseCode)
  )
    throw new Error('Saved preparation is missing allocated codes or revision')
  const allocated = allocatePreparation(
    preparation,
    state.allocations,
    state.issuedCodes
  )
  if (
    allocated.issuedCodes.length !== state.issuedCodes.length ||
    JSON.stringify(allocated.allocations) !== JSON.stringify(state.allocations)
  )
    throw new Error('Preparation is missing issued code reservations')
  for (const reservation of allocated.issuedCodes) {
    const existing = state.issuedCodes.find(
      (entry) =>
        entry.accountId === reservation.accountId &&
        entry.kind === reservation.kind &&
        entry.code === reservation.code
    )
    if (
      !existing ||
      !sameCodeOwner(existing, reservation) ||
      codeReservationMembers(reservation).some(
        (member) =>
          member.orderId === preparation.orderId &&
          member.accountId === preparation.accountId &&
          !codeReservationIncludes(existing, member)
      )
    )
      throw new Error('Preparation is missing issued code reservations')
  }
}

/** Rebuild ownership from current assignments. Checkpoints never reserve codes. */
export function activePackingState(
  preparations,
  allocations = [],
  issuedCodes = [],
  { historicalReservations = [] } = {}
) {
  // Keep seller/month slots stable, but discard item counters from retired codes.
  const state = mergePackingState(allocations, [])
  const months = new Map(
    state.allocations.map((entry) => [
      JSON.stringify([entry.accountId, entry.month]),
      entry,
    ])
  )
  for (const allocation of state.allocations)
    for (const group of allocation.groups) group.nextItem = 1
  const evidence = new Map()
  for (const entry of issuedCodes) {
    const key = JSON.stringify([entry.accountId, entry.kind, entry.code])
    const owners = evidence.get(key) || []
    owners.push(entry)
    evidence.set(key, owners)
  }
  const current = []
  for (const input of preparations) {
    const preparation = validatePreparation(input)
    for (const group of preparation.groups) {
      if (!group.baseCode)
        throw new Error(
          'Saved preparation is missing allocated codes or revision'
        )
      const month = groupPackingMonth(preparation, group)
      const key = JSON.stringify([preparation.accountId, month])
      let allocation = months.get(key)
      if (!allocation) {
        allocation = { accountId: preparation.accountId, month, groups: [] }
        months.set(key, allocation)
        state.allocations.push(allocation)
      }
      const number = Number(group.baseCode.slice(6, 8))
      let slot = allocation.groups.find((entry) => entry.number === number)
      if (slot && slot.sellerId !== preparation.sellerId)
        throw new Error('This monthly group belongs to another seller')
      if (!slot) {
        slot = { number, sellerId: preparation.sellerId, nextItem: 1 }
        allocation.groups.push(slot)
      }
      slot.nextItem = Math.max(
        slot.nextItem,
        Number(group.baseCode.slice(8, 10)) + 1
      )
      const owner = {
        accountId: preparation.accountId,
        orderId: preparation.orderId,
        groupId: group.id,
        sellerId: preparation.sellerId,
        month,
        ...(group.sharedProductId
          ? {
              sharedProductId: group.sharedProductId,
              sharedStoreId: group.sharedStoreId,
            }
          : {}),
      }
      const entries = [
        { ...owner, kind: 'base', code: group.baseCode },
        ...group.variants
          .filter((variant) => !variant.needsSizeMapping)
          .map((variant) => ({
            ...owner,
            kind: 'barcode',
            code: barcodeValue(group, variant),
            variantId: variant.id,
            ...(variant.sharedVariantId
              ? { sharedVariantId: variant.sharedVariantId }
              : {}),
          })),
      ]
      for (const entry of entries) {
        if (group.sharedProductId)
          entry.members = [
            {
              orderId: entry.orderId,
              groupId: entry.groupId,
              ...(entry.variantId ? { variantId: entry.variantId } : {}),
            },
          ]
        const previous = evidence
          .get(JSON.stringify([entry.accountId, entry.kind, entry.code]))
          ?.flatMap(codeReservationMembers)
          .find((value) => value.ownerSnapshot && sameOwner(value, entry))
        const variant = group.variants.find(
          (value) => value.id === entry.variantId
        )
        const entryIds =
          variant?.entryIds ?? group.variants.flatMap((value) => value.entryIds)
        // Snapshot photos have no per-entry mapping. Retain them only when the
        // membership is identical, so scoped backups cannot retain other rows.
        const snapshot = previous?.ownerSnapshot
        const sameMembers =
          snapshot &&
          snapshot.entryIds.length === entryIds.length &&
          snapshot.entryIds.every((id) => entryIds.includes(id))
        if (sameMembers) {
          entry.ownerSnapshot = snapshot
          if (entry.members) entry.members[0].ownerSnapshot = snapshot
        }
        current.push(entry)
      }
    }
  }
  // Validate duplicates once for the complete final set; rebuilding must stay
  // linear in product count rather than revalidating every growing prefix.
  return withHistoricalReservations(
    state.allocations,
    current,
    historicalReservations
  )
}

/** Sealed history occupies its old slots independently of ordinary checkpoints. */
function withHistoricalReservations(
  allocations,
  issuedCodes,
  historicalReservations
) {
  const state = mergePackingState(allocations, [])
  const reservations = historicalReservations.map(validateIssuedCode)
  for (const reservation of reservations) {
    let allocation = state.allocations.find(
      (value) =>
        value.accountId === reservation.accountId &&
        value.month === reservation.month
    )
    if (!allocation) {
      allocation = {
        accountId: reservation.accountId,
        month: reservation.month,
        groups: [],
      }
      state.allocations.push(allocation)
    }
    const number = Number(reservation.code.slice(6, 8))
    let slot = allocation.groups.find((value) => value.number === number)
    if (slot && slot.sellerId !== reservation.sellerId)
      throw new Error('Historical code group belongs to another seller')
    if (!slot) {
      slot = { number, sellerId: reservation.sellerId, nextItem: 1 }
      allocation.groups.push(slot)
    }
    slot.nextItem = Math.max(
      slot.nextItem,
      Number(reservation.code.slice(8, 10)) + 1
    )
  }
  const owners = new Map()
  for (const reservation of [...reservations, ...issuedCodes]) {
    const normalized = validateIssuedCode(reservation)
    const key = JSON.stringify([
      normalized.accountId,
      normalized.kind,
      normalized.code,
    ])
    owners.set(key, mergeHistoricalCodeOwners(owners.get(key), normalized))
  }
  return mergePackingState(state.allocations, [...owners.values()])
}

// Historical aliases are evidence, not current membership. A reviewed unconsumed
// link may promote an existing owner to a shared identity, but never steal it.
function mergeHistoricalCodeOwners(existing, incoming) {
  if (!existing || sameCodeOwner(existing, incoming))
    return mergeCodeOwners(existing, incoming)
  if (
    !['accountId', 'kind', 'code', 'sellerId', 'month'].every(
      (field) => existing[field] === incoming[field]
    ) ||
    !codeReservationMembers(existing).some((left) =>
      codeReservationMembers(incoming).some((right) => sameOwner(left, right))
    )
  )
    throw new CodeConflictError(existing, incoming)
  const canonical = incoming.sharedProductId
    ? incoming
    : existing.sharedProductId
      ? existing
      : incoming
  if (!canonical.sharedProductId) return mergeCodeOwners(existing, incoming)
  const members = new Map()
  for (const owner of [
    ...codeReservationMembers(existing),
    ...codeReservationMembers(incoming),
  ]) {
    const key = JSON.stringify([owner.orderId, owner.groupId, owner.variantId])
    const old = members.get(key)
    if (!old?.ownerSnapshot)
      members.set(key, {
        orderId: owner.orderId,
        groupId: owner.groupId,
        ...(owner.variantId ? { variantId: owner.variantId } : {}),
        ...(owner.ownerSnapshot ? { ownerSnapshot: owner.ownerSnapshot } : {}),
      })
  }
  return { ...canonical, members: [...members.values()] }
}
