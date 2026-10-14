const sizeLabel = /^(?:尺寸|尺码|大小|规格(?:[（(].*[）)])?|size)$/i
const namedSize = /^(?:XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL)$/
const sizeSuggestions = {
  2: ['S', 'L'],
  3: ['S', 'M', 'L'],
  5: ['XS', 'S', 'M', 'L', 'XL'],
}

function scalarSize(value) {
  const match =
    /^(\d+(?:\.\d+)?)\s*(mm|cm|m|ml|l|毫米|厘米|米|毫升|升)?$/i.exec(
      value.trim()
    )
  if (!match) return null
  const unit = (match[2] || '').toLowerCase()
  const units = {
    mm: ['length', 1],
    毫米: ['length', 1],
    cm: ['length', 10],
    厘米: ['length', 10],
    m: ['length', 1000],
    米: ['length', 1000],
    ml: ['capacity', 1],
    毫升: ['capacity', 1],
    l: ['capacity', 1000],
    升: ['capacity', 1000],
    '': ['number', 1],
  }
  const [kind, factor] = units[unit]
  return { kind, magnitude: Number(match[1]) * factor }
}

function isSizeProperty(property) {
  const label = property.label.trim()
  if (!sizeLabel.test(label)) return false
  if (!label.startsWith('规格')) return true
  const value = property.value.trim()
  return (
    namedSize.test(value.toUpperCase()) ||
    Boolean(scalarSize(value)) ||
    /^\d+(?:\.\d+)?\s*[x×*]\s*\d/i.test(value)
  )
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

function letters(index) {
  let result = ''
  do {
    result = String.fromCharCode(65 + (index % 26)) + result
    index = Math.floor(index / 26) - 1
  } while (index >= 0)
  return result
}

function uniqueSuggestion(values) {
  const suggestions = [...new Set(values.filter(Boolean))]
  return suggestions.length === 1 ? suggestions[0] : ''
}

/** Suggestions are drafts. Saving confirms their editable product/variant membership. */
export function createPreparation(snapshot, month, vocabulary = []) {
  packingMonth(month)
  const groups = new Map()
  const candidates = new Map()
  const variantKeys = new Map()
  for (const item of snapshot.items) {
    const title = (item.title || item.description).trim()
    let group = groups.get(title)
    if (!group) {
      const suggestions = vocabulary.filter(
        (entry) => entry.match && title.includes(entry.match)
      )
      group = {
        id: crypto.randomUUID(),
        title,
        baseCode: '',
        spanishName: uniqueSuggestion(
          suggestions.map((entry) => entry.spanishName?.trim().toUpperCase())
        ),
        category: uniqueSuggestion(
          suggestions.map((entry) => entry.category?.trim())
        ),
        variants: [],
      }
      groups.set(title, group)
    }
    const properties = item.skuProperties || []
    const sizes = properties.filter(isSizeProperty)
    const size = sizes.map((property) => property.value.trim()).join(' / ')
    const variantProperties = properties.filter(
      (property) => !isSizeProperty(property)
    )
    const variant = variantProperties
      .map((property) =>
        property.label.trim()
          ? `${property.label.trim()}: ${property.value.trim()}`
          : property.value.trim()
      )
      .join(' / ')
    // Only identical complete attribute sets suggest a shared variant. No source
    // row or amount is combined; entry IDs remain individually addressable.
    const attributes = (entries) =>
      entries.map((property) => [property.label.trim(), property.value.trim()])
    const key = JSON.stringify([title, attributes(properties)])
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
    const sizes = [
      ...new Set(group.variants.map((variant) => variant.size).filter(Boolean)),
    ]
    const explicit = new Map(
      sizes
        .filter((size) => namedSize.test(size.toUpperCase()))
        .map((size) => [size, size.toUpperCase()])
    )
    // Compare scalar measurements in common units. Multidimensional, mixed
    // quantity and tied values cannot establish an unambiguous size ordering.
    const dimensions = sizes.map((size) => ({ size, ...scalarSize(size) }))
    const measurable =
      dimensions.every((entry) => Number.isFinite(entry.magnitude)) &&
      new Set(dimensions.map((entry) => entry.kind)).size === 1 &&
      new Set(dimensions.map((entry) => entry.magnitude)).size === sizes.length
    const suggested = new Map()
    if (!explicit.size && measurable && sizeSuggestions[sizes.length])
      dimensions
        .sort((a, b) => a.magnitude - b.magnitude)
        .forEach((entry, index) =>
          suggested.set(entry.size, sizeSuggestions[sizes.length][index])
        )
    for (const variant of group.variants) {
      variant.variantSuffix =
        variants.length > 1
          ? letters(variants.indexOf(variantKeys.get(variant.id)))
          : ''
      variant.sizeSuffix =
        sizes.length > 1
          ? explicit.get(variant.size) || suggested.get(variant.size) || ''
          : ''
      variant.needsSizeMapping = Boolean(
        sizes.length > 1 && variant.size && !variant.sizeSuffix
      )
    }
  }
  return {
    accountId: snapshot.accountId || 'local',
    orderId: snapshot.orderId,
    sellerId: (snapshot.sellerMemberLogin || snapshot.sellerName || '').trim(),
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
  const codes = new Set()
  const barcodes = new Set()
  const groups = input.groups.map((inputGroup) => {
    record(inputGroup, 'Product group')
    const groupId = id(inputGroup.id, 'Group ID')
    if (groupIds.has(groupId)) throw new Error('Duplicate product group ID')
    groupIds.add(groupId)
    const baseCode = text(inputGroup.baseCode, 'Base code')
    if (
      baseCode &&
      (!baseCode.startsWith(codePrefix(month)) ||
        !/^CE\d{4}(?:0[1-9]|[1-9]\d)(?:0[1-9]|[1-9]\d)$/.test(baseCode))
    )
      throw new Error(
        'Base code must use the chosen month and group/item numbers 01–99'
      )
    if (baseCode && codes.has(baseCode))
      throw new Error('Product groups need distinct base codes')
    if (baseCode) codes.add(baseCode)
    if (!Array.isArray(inputGroup.variants))
      throw new Error('Product variants must be an array')
    const group = {
      id: groupId,
      title: text(inputGroup.title, 'Product title'),
      baseCode,
      spanishName: text(
        inputGroup.spanishName ?? '',
        'Spanish name'
      ).toUpperCase(),
      category: text(inputGroup.category ?? '', 'Category'),
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
        if (barcodes.has(value))
          throw new Error('Distinct variants need unique barcode values')
        barcodes.add(value)
      }
      return variant
    })
    return group
  })
  const orderId = text(input.orderId, 'Preparation order ID', false)
  if (!/^[1-9]\d*$/.test(orderId))
    throw new Error('Preparation order ID must be a decimal ID')
  return {
    accountId: text(input.accountId, 'Preparation account', false),
    orderId,
    sellerId: text(input.sellerId, 'Seller identity', false),
    month,
    revision: input.revision,
    updatedAt: new Date(input.updatedAt).toISOString(),
    groups,
  }
}

export function validatePackingPreferences(input = {}) {
  record(input, 'Packing preferences')
  record(input.settings ?? {}, 'Packing settings')
  if (!Array.isArray(input.vocabulary ?? []))
    throw new Error('Vocabulary must be an array')
  const vocabulary = (input.vocabulary ?? []).map((entry) => {
    record(entry, 'Vocabulary entry')
    return {
      match: text(entry.match, 'Vocabulary match', false),
      spanishName: text(
        entry.spanishName ?? '',
        'Vocabulary Spanish name'
      ).toUpperCase(),
      category: text(entry.category ?? '', 'Vocabulary category'),
    }
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
      throw new Error(
        `Code conflict: ${reservation.code} is already reserved for another product or variant`
      )
    issued.set(key, reservation)
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
export function allocatePreparation(input, allocations, issuedCodes) {
  const preparation = validatePreparation(input)
  const state = mergePackingState(allocations, issuedCodes)
  let allocation = state.allocations.find(
    (entry) =>
      entry.accountId === preparation.accountId &&
      entry.month === preparation.month
  )
  if (!allocation) {
    allocation = {
      accountId: preparation.accountId,
      month: preparation.month,
      groups: [],
    }
    state.allocations.push(allocation)
  }
  const reserve = (code, groupId, variantId) => {
    state.issuedCodes.push({
      accountId: preparation.accountId,
      code,
      kind: variantId ? 'barcode' : 'base',
      orderId: preparation.orderId,
      groupId,
      ...(variantId ? { variantId } : {}),
      sellerId: preparation.sellerId,
      month: preparation.month,
    })
  }
  const claimGroup = (number) => {
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
        slot = claimGroup(number)
      }
      group.baseCode = `${codePrefix(preparation.month)}${String(slot.number).padStart(2, '0')}${String(slot.nextItem).padStart(2, '0')}`
    }
    const slot = claimGroup(Number(group.baseCode.slice(6, 8)))
    slot.nextItem = Math.max(
      slot.nextItem,
      Number(group.baseCode.slice(8, 10)) + 1
    )
    reserve(group.baseCode, group.id)
    for (const variant of group.variants)
      if (!variant.needsSizeMapping)
        reserve(barcodeValue(group, variant), group.id, variant.id)
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
}
