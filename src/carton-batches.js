import { groupPackingMonth, barcodeValue } from './packing-model.js'
import { repeatProductStoreIdentity } from './repeat-products.js'
import { productCartonDetails } from './carton-details.js'
import { cartonBreakdown } from './carton-packing.js'
import { unresolvedCoverageFeasible } from './carton-reconciliation.js'

const sourceKey = (orderId, entryId) => JSON.stringify([orderId, entryId])
const referenceKey = (reference) =>
  JSON.stringify([reference.orderId, reference.groupId])
const timestamp = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))

/** Measurements remain exact decimal strings. These helpers never round a total's inputs. */
export function cartonDecimal(value, { positive = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '')
    return ''
  if (!['string', 'number'].includes(typeof value))
    throw new Error('Enter a decimal measurement')
  const text = String(value).trim().replace(',', '.')
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) || text.length > 60)
    throw new Error('Enter a nonnegative decimal measurement')
  const [whole, fraction = ''] = text.split('.')
  const result = `${BigInt(whole || '0')}${fraction.replace(/0+$/, '') ? `.${fraction.replace(/0+$/, '')}` : ''}`
  if (positive && result === '0')
    throw new Error('Carton dimensions must be greater than zero')
  return result
}

function multiply(values, extraScale = 0) {
  if (
    values.some(
      (value) => value === '' || value === null || value === undefined
    )
  )
    return ''
  let units = 1n,
    scale = extraScale
  for (const value of values) {
    const [whole, fraction = ''] = cartonDecimal(value).split('.')
    units *= BigInt(whole + fraction)
    scale += fraction.length
  }
  const digits = String(units).padStart(scale + 1, '0')
  return cartonDecimal(
    scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits
  )
}

function count(value, label) {
  if (value === '' || value === null || value === undefined) return null
  if (
    !['string', 'number'].includes(typeof value) ||
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new Error(`${label} must be a nonnegative whole number`)
  return Number(value)
}

function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512)
    throw new Error(`${label} is required`)
  return value
}

/** Earlier batches used their first content group as the physical carton mark. */
export function cartonBatchMark(batch) {
  const reference = batch.mark || batch.groups?.[0]
  return reference
    ? { orderId: reference.orderId, groupId: reference.groupId }
    : undefined
}

export function validateCartonBatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Choose a carton batch')
  const id = text(input.id, 'Carton batch ID'),
    accountId = text(input.accountId || 'local', 'Account')
  const modern =
    input.orderId !== undefined ||
    input.packingBasis !== undefined ||
    input.unresolvedContents !== undefined
  if (
    (!modern || input.month !== undefined) &&
    !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(input.month)
  )
    throw new Error('Choose a packing month')
  if (
    (!modern || input.groups !== undefined) &&
    (!Array.isArray(input.groups) || (!modern && !input.groups.length))
  )
    throw new Error('Choose a code group')
  const groups = (input.groups || []).map((group) => ({
    orderId: text(group.orderId, 'Purchase'),
    groupId: text(group.groupId, 'Code group'),
  }))
  if (new Set(groups.map(referenceKey)).size !== groups.length)
    throw new Error('Choose each code group once')
  if (
    (!modern || input.contents !== undefined) &&
    (!Array.isArray(input.contents) ||
      (!modern && !input.contents.length && !input.deletedAt))
  )
    throw new Error('Choose carton contents')
  const contents = (input.contents || []).map((item) => {
    const quantity = String(item.quantity)
    if (!/^[1-9]\d*$/.test(quantity) || quantity.length > 30)
      throw new Error('Carton contents must contain positive whole quantities')
    return {
      orderId: text(item.orderId, 'Purchase'),
      entryId: text(item.entryId, 'Product'),
      quantity,
    }
  })
  if (
    new Set(contents.map((item) => sourceKey(item.orderId, item.entryId)))
      .size !== contents.length
  )
    throw new Error('Choose each source product once per batch')
  const dimensions = Object.fromEntries(
    ['len', 'wid', 'ht'].map((field) => [
      field,
      cartonDecimal(input[field], { positive: true }),
    ])
  )
  const hasDimensions = Object.values(dimensions).some(Boolean)
  if (hasDimensions && !Object.values(dimensions).every(Boolean))
    throw new Error('Enter all three carton dimensions')
  const weightBasis = input.weightBasis ?? 'carton'
  if (!['carton', 'batch'].includes(weightBasis))
    throw new Error('Choose per-carton or batch weight')
  const revision = input.revision ?? 0
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error('Invalid carton batch revision')
  if (input.updatedAt !== undefined && !timestamp(input.updatedAt))
    throw new Error('Invalid carton batch timestamp')
  if (input.deletedAt !== undefined && !timestamp(input.deletedAt))
    throw new Error('Invalid carton deletion timestamp')
  const result = {
    id,
    accountId,
    ...(input.month === undefined ? {} : { month: input.month }),
    storeId: text(input.storeId, 'Store identity'),
    groups,
    contents,
    count: count(input.count, 'Cartons'),
    ...dimensions,
    weightBasis,
    weight: cartonDecimal(input.weight),
    suppliedCbm: cartonDecimal(input.suppliedCbm),
    received: count(input.received, 'Received cartons'),
    loaded: count(input.loaded, 'Loaded cartons'),
    revision,
    updatedAt: input.updatedAt
      ? new Date(input.updatedAt).toISOString()
      : '1970-01-01T00:00:00.000Z',
  }
  if (modern) {
    const owners = [
      ...new Set(
        [
          input.orderId,
          ...contents.map((item) => item.orderId),
          ...groups.map((group) => group.orderId),
        ].filter(Boolean)
      ),
    ]
    result.orderId = text(
      input.orderId || (owners.length === 1 ? owners[0] : ''),
      'Carton purchase'
    )
    const basis =
      input.packingBasis ?? (result.count === 1 ? 'exact' : 'aggregate')
    if (
      !['exact', 'uniform', 'aggregate'].includes(basis) ||
      (basis === 'exact' && result.count !== 1)
    )
      throw new Error(
        'Choose supported exact, uniform or aggregate carton evidence'
      )
    if (
      basis === 'uniform' &&
      (result.count === null ||
        result.count < 1 ||
        contents.some((item) => BigInt(item.quantity) % BigInt(result.count)))
    )
      throw new Error(
        'Uniform carton contents require explicitly equal whole quantities'
      )
    result.packingBasis = basis
    if (
      input.volumeBasis !== undefined &&
      !['carton', 'batch'].includes(input.volumeBasis)
    )
      throw new Error('Choose per-carton or combined volume')
    result.volumeBasis = input.volumeBasis ?? 'carton'
    if (
      input.unresolvedContents !== undefined &&
      !Array.isArray(input.unresolvedContents)
    )
      throw new Error('Unresolved carton contents must be an array')
    result.unresolvedContents = (input.unresolvedContents || []).map(
      (claim) => {
        if (!claim || typeof claim !== 'object' || Array.isArray(claim))
          throw new Error('Choose unresolved content evidence')
        if (
          claim.entryIds !== undefined &&
          (!Array.isArray(claim.entryIds) ||
            claim.entryIds.some((id) => typeof id !== 'string' || !id))
        )
          throw new Error(
            'Unresolved content candidates must be source product IDs'
          )
        const quantity =
          claim.quantity == null || claim.quantity === ''
            ? null
            : String(claim.quantity)
        if (
          quantity !== null &&
          (!/^[1-9]\d*$/.test(quantity) || quantity.length > 30)
        )
          throw new Error(
            'Unresolved contents require positive whole quantities or an explicit unknown'
          )
        if (
          claim.supplierCode !== undefined &&
          (typeof claim.supplierCode !== 'string' ||
            claim.supplierCode.length > 512 ||
            /[\u0000-\u001f\u007f]/.test(claim.supplierCode))
        )
          throw new Error(
            'Supplier product identifiers must be bounded single-line text'
          )
        if (claim.orderId !== undefined && claim.orderId !== result.orderId)
          throw new Error(
            'A carton can contain products from only one purchase order.'
          )
        return {
          ...(claim.groupId
            ? { groupId: text(claim.groupId, 'Unresolved group') }
            : {}),
          entryIds: [...new Set(claim.entryIds || [])],
          quantity,
          ...(claim.supplierCode === undefined
            ? {}
            : { supplierCode: String(claim.supplierCode) }),
        }
      }
    )
    result.contentsUnknown =
      !!input.contentsUnknown ||
      (!contents.length && !result.unresolvedContents.length) ||
      result.unresolvedContents.some((claim) => claim.quantity === null)
    if (
      input.labelOrigin !== undefined &&
      !['reported', 'internal'].includes(input.labelOrigin)
    )
      throw new Error('Choose the carton reference provenance')
    result.labelOrigin =
      input.labelOrigin || (input.cartonNumber ? 'reported' : 'internal')
    if (input.entitlementIndices !== undefined) {
      if (
        !Array.isArray(input.entitlementIndices) ||
        input.entitlementIndices.length !== result.count ||
        input.entitlementIndices.some(
          (value) => !Number.isSafeInteger(value) || value < 0
        ) ||
        new Set(input.entitlementIndices).size !==
          input.entitlementIndices.length
      )
        throw new Error(
          'Carton entitlement indices must retain distinct stable identities'
        )
      result.entitlementIndices = [...input.entitlementIndices]
    }
    if (input.unitContents !== undefined) {
      if (
        !input.unitContents ||
        typeof input.unitContents !== 'object' ||
        Array.isArray(input.unitContents)
      )
        throw new Error(
          'Per-carton contents must use stable entitlement indices'
        )
      result.unitContents = {}
      const allocated = new Map()
      for (const [index, rows] of Object.entries(input.unitContents)) {
        if (
          !/^\d+$/.test(index) ||
          !Number.isSafeInteger(Number(index)) ||
          (result.entitlementIndices
            ? !result.entitlementIndices.includes(Number(index))
            : Number(index) >= (result.count || 0)) ||
          !Array.isArray(rows)
        )
          throw new Error(
            'Choose an existing physical entitlement for known contents'
          )
        const seen = new Set()
        result.unitContents[index] = rows.map((row) => {
          if (!row || row.orderId !== result.orderId || seen.has(row.entryId))
            throw new Error(
              'Per-carton contents must belong to this purchase once'
            )
          seen.add(row.entryId)
          const quantity = String(row.quantity)
          if (!/^[1-9]\d*$/.test(quantity) || quantity.length > 30)
            throw new Error(
              'Per-carton contents require positive whole quantities'
            )
          allocated.set(
            row.entryId,
            (allocated.get(row.entryId) || 0n) + BigInt(quantity)
          )
          return {
            orderId: result.orderId,
            entryId: text(row.entryId, 'Product'),
            quantity,
          }
        })
      }
      for (const [entryId, quantity] of allocated) {
        const total = contents.find((row) => row.entryId === entryId)
        if (total && quantity > BigInt(total.quantity))
          throw new Error(
            'Individual carton contents exceed the retained aggregate product total'
          )
      }
      if (result.unresolvedContents.every((claim) => claim.quantity !== null)) {
        const declared =
          contents.reduce((sum, row) => sum + BigInt(row.quantity), 0n) +
          result.unresolvedContents.reduce(
            (sum, claim) => sum + BigInt(claim.quantity),
            0n
          )
        if (
          !result.contentsUnknown &&
          [...allocated.values()].reduce(
            (sum, quantity) => sum + quantity,
            0n
          ) > declared
        )
          throw new Error(
            'Individual carton contents exceed the reported set quantity'
          )
      }
    }
    for (const field of [
      'reportRef',
      'provenance',
      'legacyReview',
      'legacyResolution',
      'sourceFacts',
      'manualFacts',
    ]) {
      if (input[field] === undefined) continue
      const encoded = JSON.stringify(input[field])
      if (encoded === undefined || encoded.length > 262144)
        throw new Error(
          'Carton evidence metadata exceeds the supported bound; retain the source asset separately'
        )
      result[field] = JSON.parse(encoded)
    }
    for (const field of ['supplierMark', 'markCode'])
      if (input[field] !== undefined) {
        if (
          typeof input[field] !== 'string' ||
          input[field].length > 512 ||
          /[\u0000-\u001f\u007f]/.test(input[field])
        )
          throw new Error('Carton marks must be bounded single-line text')
        result[field] = input[field]
      }
  }
  if (input.mark !== undefined) {
    if (
      !input.mark ||
      typeof input.mark !== 'object' ||
      Array.isArray(input.mark)
    )
      throw new Error('Choose a carton mark')
    result.mark = {
      orderId: text(input.mark.orderId, 'Carton mark purchase'),
      groupId: text(input.mark.groupId, 'Carton mark group'),
    }
  }
  if (input.cartonNumber !== undefined && input.cartonNumber !== null) {
    if (typeof input.cartonNumber !== 'string')
      throw new Error('Carton number must be text')
    const cartonNumber = input.cartonNumber.trim()
    if (
      Array.from(cartonNumber).length > 40 ||
      /[\u0000-\u001f\u007f]/.test(cartonNumber)
    )
      throw new Error(
        'Use a carton number up to 40 characters without line breaks'
      )
    if (cartonNumber) {
      if (result.count !== 1)
        throw new Error('A numbered carton must contain exactly one carton')
      result.cartonNumber = cartonNumber
    }
  }
  if (input.deletedAt)
    result.deletedAt = new Date(input.deletedAt).toISOString()
  if (input.legacyKeys !== undefined) {
    if (
      !Array.isArray(input.legacyKeys) ||
      input.legacyKeys.some((key) => typeof key !== 'string' || !key)
    )
      throw new Error('Invalid carton migration provenance')
    result.legacyKeys = [...new Set(input.legacyKeys)]
  }
  if (input.needsReview) result.needsReview = true
  return result
}

/** Current writes never combine source purchases, even when code identities are linked. */
export function assertSingleOrderCarton(batch) {
  if (batch.deletedAt) return batch.orderId
  const owners = [
    ...new Set(
      [
        batch.orderId,
        ...(batch.contents || []).map((row) => row.orderId),
        ...(batch.groups || []).map((row) => row.orderId),
        batch.mark?.orderId,
      ].filter(Boolean)
    ),
  ]
  if (owners.length !== 1)
    throw Object.assign(
      new Error('A carton can contain products from only one purchase order.'),
      { code: 'CARTON_OWNERSHIP', cartonId: batch.id }
    )
  return owners[0]
}

function modernCartonIssues(batch, records, preparations, batches) {
  const issues = [],
    orderId = batch.orderId,
    accountId = batch.accountId || 'local'
  const record = records.find(
    ({ snapshot }) =>
      (snapshot.accountId || 'local') === accountId &&
      snapshot.orderId === orderId
  )
  if (!record)
    return ['The carton purchase is no longer available. Review these cartons.']
  const storeId =
    repeatProductStoreIdentity(record.snapshot) ||
    `order:${accountId}/${orderId}`
  if (batch.storeId !== storeId)
    issues.push('Carton store identity differs from its source purchase.')
  const preparation = preparations.find(
    (value) => value.accountId === accountId && value.orderId === orderId
  )
  const groups = new Map(
    (preparation?.groups || []).map((group) => [group.id, group])
  )
  if (
    (batch.groups || []).some(
      (group) => group.orderId !== orderId || !groups.has(group.groupId)
    )
  )
    issues.push(
      'The carton code group is no longer available in this purchase.'
    )
  if (
    batch.mark &&
    (batch.mark.orderId !== orderId ||
      !groups.get(batch.mark.groupId)?.baseCode)
  )
    issues.push(
      'The carton mark does not belong to this purchase’s valid mark context.'
    )
  const quantities = Object.fromEntries(
    record.snapshot.items.map((item) => [
      item.entryId,
      /^\d+$/.test(item.quantity) ? item.quantity : null,
    ])
  )
  const claims = []
  for (const current of [
    ...batches.filter((other) => other.id !== batch.id),
    batch,
  ]) {
    if (current.deletedAt || (current.accountId || 'local') !== accountId)
      continue
    for (const item of current.contents || []) {
      if (item.orderId !== orderId) continue
      if (!(item.entryId in quantities) || quantities[item.entryId] === null) {
        issues.push(
          'Carton contents reference missing or non-whole source quantities.'
        )
        continue
      }
      quantities[item.entryId] = String(
        BigInt(quantities[item.entryId]) - BigInt(item.quantity)
      )
    }
    if (current.orderId === orderId)
      for (const claim of current.unresolvedContents || []) {
        const candidates = claim.entryIds?.length
          ? claim.entryIds
          : groups
              .get(claim.groupId)
              ?.variants.flatMap((variant) => variant.entryIds) ||
            Object.keys(quantities)
        if (candidates.some((entryId) => !(entryId in quantities)))
          issues.push(
            'Unresolved contents reference a product outside this purchase.'
          )
        claims.push({ quantity: claim.quantity, entryIds: candidates })
      }
  }
  if (
    Object.values(quantities).some(
      (value) => value !== null && BigInt(value) < 0n
    ) ||
    unresolvedCoverageFeasible(quantities, claims) === false
  )
    issues.push(
      'Confirmed and unresolved carton contents exceed the eligible purchase quantities.'
    )
  return [...new Set(issues)]
}

/** Compatibility scope for legacy prepared evidence; current writes have one owner. */
export function cartonBatchScope(records, preparations, reference) {
  const accountId = reference.accountId || 'local'
  const preparation = preparations.find(
    (entry) =>
      entry.accountId === accountId && entry.orderId === reference.orderId
  )
  const group = preparation?.groups.find(
    (entry) => entry.id === reference.groupId
  )
  const record = records.find(
    (entry) =>
      entry.snapshot.accountId === accountId &&
      entry.snapshot.orderId === reference.orderId
  )
  if (!group || !record || !group.baseCode)
    throw new Error('Prepare this product group before packing cartons')
  const month = groupPackingMonth(preparation, group),
    storeId = repeatProductStoreIdentity(record.snapshot)
  if (!storeId) throw new Error('Identify the store before packing cartons')
  const groups = [],
    products = [],
    initialGroupRefs = [],
    ownGroups = preparation.groups.filter(
      (other) =>
        other.baseCode && groupPackingMonth(preparation, other) === month
    ),
    sharedGroups = new Map(
      ownGroups
        .filter((other) => other.sharedProductId)
        .map((other) => [other.sharedProductId, other.baseCode])
    )
  for (const candidate of preparations) {
    if (candidate.accountId !== accountId) continue
    const owner = records.find(
      (entry) =>
        entry.snapshot.accountId === accountId &&
        entry.snapshot.orderId === candidate.orderId
    )
    if (!owner || repeatProductStoreIdentity(owner.snapshot) !== storeId)
      continue
    for (const other of candidate.groups) {
      const sameOrder = candidate.orderId === preparation.orderId
      const linked =
        other.sharedProductId &&
        sharedGroups.get(other.sharedProductId) === other.baseCode
      if (
        (!sameOrder && !linked) ||
        !other.baseCode ||
        groupPackingMonth(candidate, other) !== month
      )
        continue
      const ref = { orderId: candidate.orderId, groupId: other.id }
      groups.push({
        ...ref,
        baseCode: other.baseCode,
        category: other.category,
        sellerName: owner.snapshot.sellerName,
      })
      if (
        (sameOrder && other.id === group.id) ||
        (group.sharedProductId &&
          other.sharedProductId === group.sharedProductId &&
          other.baseCode === group.baseCode)
      )
        initialGroupRefs.push(ref)
      for (const variant of other.variants)
        for (const entryId of variant.entryIds) {
          const item = owner.snapshot.items.find(
            (entry) => entry.entryId === entryId
          )
          if (item)
            products.push({
              ...item,
              orderId: candidate.orderId,
              groupId: other.id,
              barcode: barcodeValue(other, variant),
              description: item.description || item.title || '',
              sellerName: owner.snapshot.sellerName,
              sourceType: owner.snapshot.sourceType,
              unitsPerCarton: owner.unitsPerCarton?.[entryId] ?? '',
              carton: productCartonDetails(item, owner),
            })
        }
    }
  }
  return {
    accountId,
    month,
    storeId,
    groups,
    mark: { orderId: reference.orderId, groupId: reference.groupId },
    initialGroupRefs,
    baseCode: group.baseCode,
    sellerName: record.snapshot.sellerName,
    category: group.category,
    products,
  }
}

/** Content owner refs are independent from the selected physical carton mark. */
export function cartonBatchContentGroups(scope, contents) {
  const products = new Map(
      scope.products.map((product) => [
        sourceKey(product.orderId, product.entryId),
        product,
      ])
    ),
    groups = new Map()
  for (const content of contents) {
    const product = products.get(sourceKey(content.orderId, content.entryId))
    if (!product) throw new Error('Choose products from this carton scope')
    const reference = { orderId: product.orderId, groupId: product.groupId }
    groups.set(referenceKey(reference), reference)
  }
  return [...groups.values()]
}

function contextScope(batch, records, preparations) {
  const mark = cartonBatchMark(batch),
    refs = [...batch.groups, ...(mark ? [mark] : [])]
  let fallback
  for (const reference of new Map(
    refs.map((ref) => [referenceKey(ref), ref])
  ).values()) {
    let scope
    try {
      scope = cartonBatchScope(records, preparations, {
        ...reference,
        accountId: batch.accountId,
      })
    } catch {
      continue
    }
    fallback ||= scope
    const allowed = new Set(scope.groups.map(referenceKey)),
      products = new Set(
        scope.products.map((product) =>
          sourceKey(product.orderId, product.entryId)
        )
      )
    if (
      scope.month === batch.month &&
      scope.storeId === batch.storeId &&
      refs.every((ref) => allowed.has(referenceKey(ref))) &&
      batch.contents.every((item) =>
        products.has(sourceKey(item.orderId, item.entryId))
      )
    )
      return scope
  }
  return fallback
}

export function cartonBatchRemaining(scope, batches, editingId) {
  return scope.products.map((product) => {
    let used = 0n
    for (const batch of batches) {
      if (
        batch.id === editingId ||
        batch.deletedAt ||
        batch.accountId !== scope.accountId
      )
        continue
      for (const item of batch.contents)
        if (
          item.orderId === product.orderId &&
          item.entryId === product.entryId
        )
          used += BigInt(item.quantity)
    }
    const valid = /^\d+$/.test(String(product.quantity))
    const available = valid ? BigInt(product.quantity) - used : 0n
    return {
      ...product,
      remaining: String(available > 0n ? available : 0n),
      allocated: String(used),
    }
  })
}

/** Product rows link to physical cartons without spreading shared counts or averaging contents. */
export function cartonProductPacking(
  { accountId = 'local', orderId, entryId, month, quantity, unitsPerCarton },
  batches
) {
  const relevant = batches.filter(
      (batch) =>
        !batch.deletedAt &&
        batch.accountId === accountId &&
        batch.month === month &&
        batch.contents.some(
          (item) => item.orderId === orderId && item.entryId === entryId
        )
    ),
    needsReview = relevant.some(
      (batch) => batch.needsReview || batch.issues?.length
    ),
    sumCounts = (values, empty = '') => {
      if (!values.length) return empty
      if (
        values.some(
          (batch) => !Number.isSafeInteger(batch.count) || batch.count < 0
        )
      )
        return ''
      const total = values.reduce((sum, batch) => sum + BigInt(batch.count), 0n)
      return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : ''
    },
    declaredCapacity = /^[1-9]\d*$/.test(String(unitsPerCarton))
      ? BigInt(unitsPerCarton)
      : 0n,
    capacities = relevant.map((batch) => {
      if (
        batch.contents.length !== 1 ||
        !Number.isSafeInteger(batch.count) ||
        batch.count < 1
      )
        return ''
      const contents = BigInt(batch.contents[0].quantity)
      if (batch.count === 1) return String(contents)
      // A saved capacity is an explicit packing declaration, not a quotient
      // inferred from aggregate contents that may have been packed unevenly.
      return declaredCapacity &&
        contents === declaredCapacity * BigInt(batch.count)
        ? String(declaredCapacity)
        : ''
    }),
    identicalCapacity =
      capacities.length &&
      capacities.every((value) => value !== '' && value === capacities[0]),
    complete =
      quantity === undefined ||
      (/^\d+$/.test(String(quantity)) &&
        relevant.reduce(
          (total, batch) =>
            total +
            batch.contents.reduce(
              (sum, content) =>
                content.orderId === orderId && content.entryId === entryId
                  ? sum + BigInt(content.quantity)
                  : sum,
              0n
            ),
          0n
        ) === BigInt(quantity)),
    uniformCapacity =
      !needsReview && complete && identicalCapacity ? capacities[0] : ''
  let capacityStatus = ''
  if (needsReview) capacityStatus = 'review'
  else if (relevant.some((batch) => batch.contents.length > 1))
    capacityStatus = 'shared'
  else if (!uniformCapacity) {
    if (
      relevant.some(
        (batch) => Number.isSafeInteger(batch.count) && batch.count > 1
      )
    )
      capacityStatus = 'batchContents'
    else if (
      !identicalCapacity &&
      relevant.length &&
      relevant.every(
        (batch) => Number.isSafeInteger(batch.count) && batch.count > 0
      )
    )
      capacityStatus = 'varies'
  }
  return {
    batches: relevant,
    cartons: sumCounts(relevant),
    sharedCartons: sumCounts(
      relevant.filter((batch) => batch.contents.length > 1),
      0
    ),
    uniformCapacity,
    capacityStatus,
    needsReview,
  }
}

export function cartonBatchMetrics(batch) {
  const dimensions = ['len', 'wid', 'ht'].map((field) => batch[field] || '')
  const volumePerCarton = dimensions.every(Boolean)
    ? multiply(dimensions, 6)
    : batch.suppliedCbm || ''
  const kgPerCarton = batch.weightBasis === 'batch' ? '' : batch.weight || ''
  const weightFor = (number) => {
    if (number === 0) return '0'
    if (
      number === null ||
      number === undefined ||
      number === '' ||
      batch.weight === '' ||
      batch.weight === undefined
    )
      return ''
    return batch.weightBasis === 'batch'
      ? batch.count !== null && number === batch.count
        ? batch.weight
        : ''
      : multiply([batch.weight, number])
  }
  const volumeFor = (number) =>
    number === 0 ? '0' : multiply([volumePerCarton, number])
  return {
    volumePerCarton,
    kgPerCarton,
    quantity: String(
      (batch.contents || []).reduce(
        (sum, item) => sum + BigInt(item.quantity),
        0n
      )
    ),
    totalWeight: weightFor(batch.count),
    totalVolume: volumeFor(batch.count),
    receivedWeight: weightFor(batch.received),
    loadedWeight: weightFor(batch.loaded),
    receivedVolume: volumeFor(batch.received),
    loadedVolume: volumeFor(batch.loaded),
  }
}

export function cartonBatchIssues(batch, records, preparations, batches = []) {
  if (batch.deletedAt) return []
  try {
    assertSingleOrderCarton(batch)
  } catch (error) {
    return [error.message]
  }
  if (batch.orderId)
    return modernCartonIssues(batch, records, preparations, batches)
  const issues = []
  const scope = contextScope(batch, records, preparations)
  if (!scope)
    return ['The code group is no longer prepared. Review these cartons.']
  if (scope.month !== batch.month || scope.storeId !== batch.storeId)
    issues.push('The packing month or store changed. Review these cartons.')
  const allowed = new Set(scope.groups.map(referenceKey))
  if (batch.groups.some((group) => !allowed.has(referenceKey(group))))
    issues.push('These products no longer share an eligible carton scope.')
  const mark = cartonBatchMark(batch)
  if (!mark || !allowed.has(referenceKey(mark)))
    issues.push('The carton mark is no longer available in this packing scope.')
  const remaining = cartonBatchRemaining(scope, batches, batch.id)
  const actualGroups = new Set()
  for (const item of batch.contents) {
    const product = remaining.find(
      (entry) =>
        entry.orderId === item.orderId && entry.entryId === item.entryId
    )
    if (product) actualGroups.add(referenceKey(product))
    if (
      !product ||
      !/^\d+$/.test(String(product.quantity)) ||
      BigInt(item.quantity) > BigInt(product.remaining)
    )
      issues.push(
        'Carton contents exceed the current available product quantity.'
      )
  }
  const declaredGroups = new Set(batch.groups.map(referenceKey))
  if (
    [...actualGroups].some((key) => !declaredGroups.has(key)) ||
    (batch.mark && declaredGroups.size !== actualGroups.size)
  )
    issues.push('Carton content groups no longer match their product owners.')
  return [...new Set(issues)]
}

export function assertCartonBatchContext(
  batch,
  records,
  preparations,
  batches = []
) {
  if (batch.deletedAt) return batch
  const issues = cartonBatchIssues(batch, records, preparations, batches)
  if (issues.length) throw new Error(issues[0])
  return batch
}

/** Display/export fields are resolved from source IDs; physical data is never copied to products. */
export function cartonBatchProjection(batches, records, preparations) {
  return batches
    .filter((batch) => !batch.deletedAt)
    .map((batch) => {
      const scope = contextScope(batch, records, preparations),
        mark = cartonBatchMark(batch),
        markGroup =
          scope?.month === batch.month && scope.storeId === batch.storeId
            ? scope.groups.find(
                (group) => referenceKey(group) === referenceKey(mark || {})
              )
            : undefined
      const contents = batch.contents.map((allocation) => {
        const record = records.find(
          (entry) =>
            entry.snapshot.accountId === batch.accountId &&
            entry.snapshot.orderId === allocation.orderId
        )
        const product = scope?.products.find(
          (entry) =>
            entry.orderId === allocation.orderId &&
            entry.entryId === allocation.entryId
        )
        const item = record?.snapshot.items.find(
          (entry) => entry.entryId === allocation.entryId
        )
        return {
          ...item,
          ...product,
          ...allocation,
          ...(record?.snapshot.source === 'other'
            ? { orderReference: record.snapshot.reference }
            : {}),
          barcode: product?.barcode || '',
          description: item?.description || product?.description || '',
          sourceQuantity: item?.quantity || '',
        }
      })
      const issues = cartonBatchIssues(batch, records, preparations, batches)
      return {
        ...batch,
        mark,
        baseCode: markGroup?.baseCode || '',
        category: markGroup?.category || '',
        sellerName:
          scope?.sellerName ||
          records.find(
            (record) =>
              record.snapshot.accountId === batch.accountId &&
              record.snapshot.orderId === batch.contents[0]?.orderId
          )?.snapshot.sellerName ||
          '',
        contents,
        issues,
        needsReview: Boolean(batch.needsReview || issues.length),
        ...cartonBatchMetrics(batch),
      }
    })
}

/** Stable provenance prevents a refresh or an old backup from duplicating migrated cartons. */
export function createLegacyCartonBatches(
  records,
  preparations,
  { physicalEvidenceOnly = false } = {}
) {
  const batches = []
  for (const record of records) {
    const snapshot = record.snapshot,
      accountId = snapshot.accountId || 'local'
    const preparation = preparations.find(
      (entry) =>
        entry.accountId === accountId && entry.orderId === snapshot.orderId
    )
    if (!preparation) continue
    const owners = new Map()
    for (const group of preparation.groups)
      for (const variant of group.variants)
        for (const entryId of variant.entryIds) {
          const item = snapshot.items.find((entry) => entry.entryId === entryId)
          if (!item) continue
          const owner =
            snapshot.sourceType === 'spreadsheet' && item.sourceRow
              ? `row:${item.sourceRow}`
              : `entry:${entryId}`
          const month = groupPackingMonth(preparation, group),
            key = JSON.stringify([accountId, snapshot.orderId, month, owner])
          if (!owners.has(key))
            owners.set(key, { month, owner, products: [], groups: [] })
          const batch = owners.get(key)
          batch.products.push(item)
          if (!batch.groups.some((ref) => ref.groupId === group.id))
            batch.groups.push({ orderId: snapshot.orderId, groupId: group.id })
        }
    for (const [key, value] of owners) {
      const item = value.products[0],
        sourceMembers =
          snapshot.sourceType === 'spreadsheet' && item.sourceRow
            ? snapshot.items.filter(
                (product) => product.sourceRow === item.sourceRow
              )
            : [item],
        owner = sourceMembers[0],
        partialSourceRow = sourceMembers.some(
          (member) =>
            !value.products.some(
              (product) => product.entryId === member.entryId
            )
        ),
        originalDetails = productCartonDetails(owner, record),
        sourceRow = snapshot.spreadsheet?.rows?.find(
          (row) => row.row === item.sourceRow
        )
      let conflicting = false
      const details = { ...originalDetails }
      if (value.products.length > 1)
        for (const field of ['boxes', 'kg', 'cbm', 'len', 'wid', 'ht']) {
          const values = [
            ...new Set(
              value.products
                .map((product) => productCartonDetails(product, record)[field])
                .filter((entry) => entry !== undefined && entry !== '')
                .map(String)
            ),
          ]
          if (values.length > 1) {
            details[field] = ''
            conflicting = true
          } else if (values.length === 1) details[field] = values[0]
        }
      const lengths = ['len', 'wid', 'ht'].filter(
        (field) => details[field] !== undefined && details[field] !== ''
      )
      if (lengths.length && lengths.length < 3) {
        for (const field of ['len', 'wid', 'ht']) details[field] = ''
        conflicting = true
      }
      const confirmations =
        record.cartonConfirmations?.[owner.entryId]?.[value.month] || {}
      let planned = details.boxes ?? sourceRow?.boxes ?? null
      const hasLegacyPlan = [details.boxes, sourceRow?.boxes].some(
        (count) => count !== undefined && count !== null && count !== ''
      )
      // New product defaults describe a possible packing arrangement. Only
      // historical conversion may turn capacity or measurements into a batch.
      if (
        physicalEvidenceOnly &&
        !hasLegacyPlan &&
        confirmations.received === undefined &&
        confirmations.loaded === undefined
      )
        continue
      if (partialSourceRow) planned = null
      if (
        !physicalEvidenceOnly &&
        !partialSourceRow &&
        planned === null &&
        value.products.length === 1
      ) {
        const breakdown = cartonBreakdown(
          item.quantity,
          record.unitsPerCarton?.[item.entryId]
        )
        if (breakdown.status === 'exact') planned = breakdown.fullCartons
      }
      if (
        planned === null &&
        !hasLegacyPlan &&
        !['kg', 'cbm', 'len', 'wid', 'ht'].some(
          (field) => details[field] !== undefined && details[field] !== ''
        ) &&
        confirmations.received === undefined &&
        confirmations.loaded === undefined
      )
        continue
      if (
        value.products.some(
          (product) => !/^[1-9]\d*$/.test(String(product.quantity))
        )
      )
        continue
      const grouped = value.groups.map((ref) =>
        preparation.groups.find((group) => group.id === ref.groupId)
      )
      const needsReview =
        conflicting ||
        grouped.some((group) => !group.baseCode) ||
        new Set(grouped.map((group) => group.baseCode)).size !== 1 ||
        !repeatProductStoreIdentity(snapshot) ||
        partialSourceRow
      try {
        batches.push(
          validateCartonBatch({
            id: `legacy:${key}`,
            accountId,
            month: value.month,
            storeId:
              repeatProductStoreIdentity(snapshot) ||
              `legacy:${accountId}/${snapshot.orderId}`,
            groups: value.groups,
            contents: value.products.map((product) => ({
              orderId: snapshot.orderId,
              entryId: product.entryId,
              quantity: String(product.quantity),
            })),
            count: planned,
            len: details.len || '',
            wid: details.wid || '',
            ht: details.ht || '',
            weightBasis: 'carton',
            weight: details.kg ?? '',
            suppliedCbm: details.cbm ?? '',
            received: confirmations.received ?? null,
            loaded: confirmations.loaded ?? null,
            revision: 1,
            updatedAt:
              record.cartonConfirmationClocks?.[owner.entryId]?.[value.month] ||
              record.cartonDetailsUpdatedAt ||
              preparation.updatedAt ||
              snapshot.observedAt,
            legacyKeys: [key],
            ...(needsReview ? { needsReview: true } : {}),
          })
        )
      } catch {
        /* Incomplete legacy measurements remain intact in their original source record. */
      }
    }
  }
  return batches
}

export function mergeCartonBatchRecords(previous, incoming) {
  const result = new Map(previous.map((batch) => [batch.id, batch]))
  for (const raw of incoming) {
    const batch = validateCartonBatch(raw),
      old = result.get(batch.id)
    if (!old) result.set(batch.id, batch)
    else if (Date.parse(batch.updatedAt) > Date.parse(old.updatedAt))
      result.set(batch.id, {
        ...batch,
        revision: Math.max(old.revision, batch.revision) + 1,
      })
    else if (
      Date.parse(batch.updatedAt) === Date.parse(old.updatedAt) &&
      JSON.stringify({ ...validateCartonBatch(old), revision: 0 }) !==
        JSON.stringify({ ...batch, revision: 0 })
    )
      throw new Error('Backup conflict: carton batches have the same timestamp')
  }
  return [...result.values()]
}

export function batchInPackingScope(batch, scope, preparations) {
  const completeContents = batch.contents.every((item) =>
    scope.some(
      (order) =>
        (order.accountId || 'local') === batch.accountId &&
        order.orderId === item.orderId &&
        order.entryIds.includes(item.entryId)
    )
  )
  if (!completeContents || !preparations) return completeContents
  const mark = cartonBatchMark(batch),
    preparation = preparations.find(
      (entry) =>
        entry.accountId === batch.accountId && entry.orderId === mark?.orderId
    ),
    group = preparation?.groups.find((entry) => entry.id === mark?.groupId)
  return Boolean(
    group?.baseCode && groupPackingMonth(preparation, group) === batch.month
  )
}

/** Source evidence and purchased quantities remain hard limits, including reviewed legacy batches. */
export function assertCartonBatchEvidence(
  batches,
  records,
  { history = [], packingScope, preparations } = {}
) {
  const evidence = new Map(),
    available = new Map(),
    allocated = new Map()
  for (const record of [...records, ...history]) {
    const snapshot = record.snapshot
    for (const item of snapshot.items) {
      const key = JSON.stringify([
        snapshot.accountId || 'local',
        snapshot.orderId,
        item.entryId,
      ])
      if (!evidence.has(key)) evidence.set(key, [])
      evidence.get(key).push(record)
      if (/^\d+$/.test(item.quantity || '')) {
        const quantity = BigInt(item.quantity)
        if (quantity > (available.get(key) || 0n)) available.set(key, quantity)
      }
    }
  }
  for (const batch of batches) {
    if (batch.deletedAt) continue
    for (const item of batch.contents) {
      const key = JSON.stringify([batch.accountId, item.orderId, item.entryId]),
        sources = evidence.get(key)
      if (!sources?.length)
        throw new Error(
          'Carton batch contents are missing from source evidence'
        )
      const legacyStore =
        batch.id.startsWith('legacy:') &&
        batch.legacyKeys?.length &&
        batch.storeId === `legacy:${batch.accountId}/${item.orderId}` &&
        sources.every((record) => !repeatProductStoreIdentity(record.snapshot))
      if (
        !legacyStore &&
        !sources.some(
          (record) =>
            repeatProductStoreIdentity(record.snapshot) === batch.storeId
        )
      )
        throw new Error(
          'Carton batches cannot combine products from different stores'
        )
      allocated.set(key, (allocated.get(key) || 0n) + BigInt(item.quantity))
    }
    if (batch.mark) {
      const sources = [...records, ...history].filter(
        (record) =>
          (record.snapshot.accountId || 'local') === batch.accountId &&
          record.snapshot.orderId === batch.mark.orderId
      )
      if (
        sources.length &&
        !sources.some(
          (record) =>
            repeatProductStoreIdentity(record.snapshot) === batch.storeId
        )
      )
        throw new Error(
          'Carton marks must belong to the same store as their contents'
        )
    }
    if (packingScope && !batchInPackingScope(batch, packingScope, preparations))
      throw new Error('Packing backup contains a partial carton batch')
  }
  for (const [key, quantity] of allocated)
    if (quantity > (available.get(key) || 0n))
      throw new Error(
        'Carton contents exceed the purchased quantity in source evidence'
      )
}
