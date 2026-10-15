import {
  automaticNaming,
  createNameSuggester,
  DEFAULT_VOCABULARY,
  vocabularyEntryMetadata,
} from './product-vocabulary.js'
import {
  createSizeClassifier,
  DEFAULT_SIZE_VOCABULARY,
  validateSizeVocabulary,
} from './size-vocabulary.js'

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

/** Code reservations survive edits and deletion; a conflict identifies its owner. */
export class CodeConflictError extends Error {
  constructor(existing, requested) {
    super(
      `Code conflict: ${requested.code} is already reserved for ${existing.sellerId !== requested.sellerId ? 'another seller' : 'another product or variant'}`
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
  for (const item of snapshot.items) {
    const title = (item.title || item.description).trim()
    let group = groups.get(title)
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
      groups.set(title, group)
    }
    const { size, variantProperties, variant } = sizeClassifier.extract(item)
    // Only identical complete attribute sets suggest a shared variant. No source
    // row or amount is combined; entry IDs remain individually addressable.
    const attributes = (entries) =>
      entries.map((property) => [property.label.trim(), property.value.trim()])
    const key = JSON.stringify([title, attributes(variantProperties), size])
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
      variantKeys.set(
        candidate.id,
        JSON.stringify(attributes(variantProperties))
      )
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
        variants.length > 1
          ? letters(variants.indexOf(variantKeys.get(variant.id)))
          : ''
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

/** Saving this draft allocates a fresh unused code; old reservations remain. */
export function regeneratePreparationCode(preparation, groupId) {
  const draft = structuredClone(preparation)
  const group = draft.groups.find((entry) => entry.id === groupId)
  if (!group)
    throw new Error('The product group no longer exists in this order')
  group.baseCode = ''
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
      delete variant.manualReordered
    }
  }
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
      throw new Error(
        'Base code must use the chosen month and group/item numbers 01–99'
      )
    const owner = {
      accountId: input.accountId,
      orderId: input.orderId,
      sellerId: input.sellerId,
      month: groupMonth,
      groupId,
      kind: 'base',
      code: baseCode,
    }
    if (baseCode && codes.has(baseCode))
      throw new CodeConflictError(codes.get(baseCode), owner)
    if (baseCode) codes.set(baseCode, owner)
    if (!Array.isArray(inputGroup.variants))
      throw new Error('Product variants must be an array')
    const group = {
      id: groupId,
      title: text(inputGroup.title, 'Product title'),
      baseCode,
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
        throw new Error(
          'Barcode suffixes must use uppercase letters and numbers'
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
        ...reordered(inputVariant.manualReordered, 'Variant manual ordering'),
        ...(inputVariant.spanishName !== undefined
          ? {
              spanishName: text(
                inputVariant.spanishName,
                'Variant Spanish name'
              ).toUpperCase(),
            }
          : {}),
      }
      if (baseCode && !variant.needsSizeMapping) {
        const value = barcodeValue(group, variant)
        const variantOwner = {
          ...owner,
          kind: 'barcode',
          code: value,
          variantId,
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
      })
      result[field].defaults = packingCheckpoint(validatedDefaults)
    }
  }
  return result
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
    if (existing && !sameOwner(existing, reservation))
      throw new CodeConflictError(existing, reservation)
    // Keep the first captured owner evidence even if that product is renamed.
    issued.set(key, existing?.ownerSnapshot ? existing : reservation)
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
      !sameOwner(base, { ...reservation, kind: 'base', variantId: undefined })
    )
      throw new Error('Issued barcode is missing its owning base reservation')
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
  { snapshot } = {}
) {
  const preparation = validatePreparation(input)
  const state = mergePackingState(allocations, issuedCodes)
  const issuedByCode = new Map(
    state.issuedCodes.map((entry) => [
      JSON.stringify([entry.accountId, entry.kind, entry.code]),
      entry,
    ])
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
    const key = JSON.stringify([
      reservation.accountId,
      reservation.kind,
      reservation.code,
    ])
    const existing = issuedByCode.get(key)
    if (existing && !sameOwner(existing, reservation))
      throw new CodeConflictError(existing, reservation)
    issuedByCode.set(key, existing || reservation)
    state.issuedCodes.push(reservation)
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
  const validated = mergePackingState(state.allocations, state.issuedCodes)
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
  for (const checkpoint of [
    preparation.defaultPacking,
    preparation.previousPacking,
    preparation.previousPacking?.defaults,
  ].filter(Boolean))
    validatePreparationReservations(
      {
        ...preparation,
        ...checkpoint,
        defaultPacking: undefined,
        previousPacking: undefined,
      },
      state
    )
}
