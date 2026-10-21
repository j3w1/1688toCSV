import { groupPackingMonth, barcodeValue } from './packing-model.js'
import { repeatProductStoreIdentity } from './repeat-products.js'
import { productCartonDetails } from './carton-details.js'
import { cartonBreakdown } from './carton-packing.js'

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
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(input.month))
    throw new Error('Choose a packing month')
  if (!Array.isArray(input.groups) || !input.groups.length)
    throw new Error('Choose a code group')
  const groups = input.groups.map((group) => ({
    orderId: text(group.orderId, 'Purchase'),
    groupId: text(group.groupId, 'Code group'),
  }))
  if (new Set(groups.map(referenceKey)).size !== groups.length)
    throw new Error('Choose each code group once')
  if (
    !Array.isArray(input.contents) ||
    (!input.contents.length && !input.deletedAt)
  )
    throw new Error('Choose carton contents')
  const contents = input.contents.map((item) => {
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
    month: input.month,
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

/** Own-order groups can share cartons; other purchases enter only through explicit repeat links. */
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
  { accountId = 'local', orderId, entryId, month },
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
    capacities = relevant.map((batch) => {
      if (
        batch.contents.length !== 1 ||
        !Number.isSafeInteger(batch.count) ||
        batch.count !== 1
      )
        return ''
      return String(BigInt(batch.contents[0].quantity))
    })
  return {
    batches: relevant,
    cartons: sumCounts(relevant),
    sharedCartons: sumCounts(
      relevant.filter((batch) => batch.contents.length > 1),
      0
    ),
    uniformCapacity:
      !needsReview &&
      capacities.length &&
      capacities.every((value) => value !== '' && value === capacities[0])
        ? capacities[0]
        : '',
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
