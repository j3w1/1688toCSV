const SNAPSHOT_VERSION = 1
const BACKUP_FORMAT = '1688-order-library'
const productAnnotationFields = [
  ['productTags', 'productTagsUpdatedAt', 'productTagsPartialClocks'],
  [
    'packingExcludedEntryIds',
    'packingExclusionsUpdatedAt',
    'packingExclusionsPartialClocks',
  ],
]
const decimalFields = [
  'price',
  'quantity',
  'sourceDiscount',
  'allocatedDiscount',
  'discount',
]
const totalFields = [
  'goodsGross',
  'shipping',
  'sourceDiscount',
  'orderAdjustment',
  'goodsNet',
  'payable',
]
const optionalTotalFields = [
  'customizationService',
  'grossIncludedCustomization',
  'redPacketDiscount',
  'orderDiscount',
  'priceIncludedDiscount',
  'rowIncludedAdjustment',
]

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value
}

function string(value, label, { empty = true } = {}) {
  if (typeof value !== 'string' || (!empty && !value.trim()))
    throw new Error(`${label} must be a string${empty ? '' : ' with a value'}`)
  return value
}

function date(value, label) {
  string(value, label, { empty: false })
  if (!Number.isFinite(Date.parse(value)))
    throw new Error(`${label} must be a valid timestamp`)
  return new Date(value).toISOString()
}

function strings(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  const result = value.map((item) => string(item, label, { empty: false }))
  if (new Set(result).size !== result.length)
    throw new Error(`${label} contains duplicate values`)
  return result
}

function decimals(value, fields, label) {
  object(value, label)
  return Object.fromEntries(
    fields.map((field) => {
      const amount = string(value[field], `${label}.${field}`)
      if (!/^-?\d+(?:\.\d+)?$/.test(amount))
        throw new Error(`${label}.${field} must be a decimal string`)
      return [field, amount]
    })
  )
}

function identifier(value, label) {
  string(value, label, { empty: false })
  if (!/^[1-9]\d*$/.test(value))
    throw new Error(`${label} must be a full decimal ID string`)
  return value
}

function detailUrl(value, orderId) {
  string(value, 'sourceUrl', { empty: false })
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('The order source URL is invalid')
  }
  const supported =
    (url.origin === 'https://air.1688.com' &&
      url.pathname === '/app/ctf-page/trade-order-detail/index.html') ||
    (url.origin === 'https://trade.1688.com' &&
      url.pathname === '/order/new_step_order_detail.htm')
  if (
    !supported ||
    url.username ||
    url.password ||
    url.searchParams.getAll('orderId').length !== 1 ||
    url.searchParams.get('orderId') !== orderId
  )
    throw new Error(
      'The order source URL must identify the same supported order'
    )
  return url.href
}

function validateAmounts(items, totals) {
  let goodsGross = 0n
  let sourceDiscount = 0n
  let orderAdjustment = 0n
  for (const item of items) {
    const gross = lineGrossCents(item.price, item.quantity)
    const source = moneyToCents(item.sourceDiscount)
    const allocated = moneyToCents(item.allocatedDiscount)
    const discount = moneyToCents(item.discount)
    if (
      source < 0n ||
      source > gross ||
      discount !== source + allocated ||
      discount > gross
    )
      throw new Error(
        'Product discounts do not reconcile with their row values'
      )
    goodsGross += gross
    sourceDiscount += source
    orderAdjustment += allocated
  }
  const amounts = Object.fromEntries(
    Object.entries(totals).map(([field, value]) => [field, moneyToCents(value)])
  )
  const orderDiscount = amounts.orderDiscount ?? 0n
  const priceIncludedDiscount = amounts.priceIncludedDiscount ?? 0n
  const rowIncludedAdjustment = amounts.rowIncludedAdjustment ?? 0n
  const goodsNet = goodsGross - sourceDiscount - orderAdjustment - orderDiscount
  const customizationService = amounts.customizationService ?? 0n
  const grossIncludedCustomization = amounts.grossIncludedCustomization ?? 0n
  const redPacketDiscount = amounts.redPacketDiscount ?? 0n
  if (
    goodsGross + priceIncludedDiscount + grossIncludedCustomization !==
      amounts.goodsGross ||
    sourceDiscount !== amounts.sourceDiscount ||
    orderAdjustment + rowIncludedAdjustment !== amounts.orderAdjustment ||
    priceIncludedDiscount < 0n ||
    rowIncludedAdjustment < 0n ||
    rowIncludedAdjustment > sourceDiscount ||
    (rowIncludedAdjustment !== 0n &&
      rowIncludedAdjustment !== amounts.orderAdjustment) ||
    goodsNet !== amounts.goodsNet ||
    goodsNet < 0n ||
    orderDiscount < 0n ||
    amounts.shipping < 0n ||
    customizationService < 0n ||
    grossIncludedCustomization < 0n ||
    (grossIncludedCustomization !== 0n &&
      grossIncludedCustomization !== customizationService) ||
    redPacketDiscount < 0n ||
    amounts.payable < 0n ||
    goodsNet + amounts.shipping + customizationService - redPacketDiscount !==
      amounts.payable
  )
    throw new Error('Product amounts do not reconcile with the order totals')
}

function validateSnapshot(input) {
  object(input, 'Snapshot')
  if (input.schemaVersion !== SNAPSHOT_VERSION)
    throw new Error('Unsupported snapshot schema version')
  if (!Array.isArray(input.items) || !input.items.length)
    throw new Error('A complete order must contain product rows')
  const items = input.items.map((item) => {
    object(item, 'Product row')
    return {
      entryId: identifier(item.entryId, 'entryId'),
      thumbnail: string(item.thumbnail, 'thumbnail'),
      description: string(item.description, 'description', { empty: false }),
      ...(item.title !== undefined
        ? { title: string(item.title, 'Product title') }
        : {}),
      ...(item.productNumber !== undefined
        ? { productNumber: string(item.productNumber, 'Product number') }
        : {}),
      ...(item.skuProperties !== undefined
        ? { skuProperties: validateSkuProperties(item.skuProperties) }
        : {}),
      ...decimals(item, decimalFields, 'Product row'),
    }
  })
  if (new Set(items.map((item) => item.entryId)).size !== items.length)
    throw new Error('An order contains duplicate product entry IDs')
  const orderId = identifier(input.orderId, 'orderId')
  const totalValues = object(input.totals, 'Order totals')
  const totals = decimals(
    totalValues,
    [
      ...totalFields,
      ...optionalTotalFields.filter((field) =>
        Object.hasOwn(totalValues, field)
      ),
    ],
    'Order totals'
  )
  validateAmounts(items, totals)
  if (Object.hasOwn(input, 'sellerUnavailable')) {
    if (
      input.sellerUnavailable !== true ||
      input.sellerName !== 'Seller unavailable' ||
      (input.sellerMemberLogin !== undefined && input.sellerMemberLogin !== '')
    )
      throw new Error(
        'Unavailable seller must have no member login and use the Seller unavailable name'
      )
  } else if (input.sellerName === 'Seller unavailable') {
    throw new Error(
      'Seller unavailable requires an explicit sellerUnavailable flag'
    )
  }
  if (
    Object.hasOwn(input, 'foreignCurrencyFeeUnspecified') &&
    input.foreignCurrencyFeeUnspecified !== true
  )
    throw new Error('foreignCurrencyFeeUnspecified must be true when present')
  const purchasedAt = purchaseTimestamp(input.purchasedAt)
  if (input.purchasedAt !== undefined && !purchasedAt)
    throw new Error('purchasedAt must be a valid purchase timestamp')
  return {
    schemaVersion: SNAPSHOT_VERSION,
    accountId: string(input.accountId, 'accountId', { empty: false }),
    orderId,
    sourceUrl: detailUrl(input.sourceUrl, orderId),
    sellerName: string(input.sellerName, 'sellerName', { empty: false }),
    ...(input.sellerUnavailable ? { sellerUnavailable: true } : {}),
    ...(input.sellerMemberLogin !== undefined
      ? {
          sellerMemberLogin: string(
            input.sellerMemberLogin,
            'sellerMemberLogin'
          ),
        }
      : {}),
    ...(input.sellerShopOrigin !== undefined
      ? { sellerShopOrigin: sellerShopOrigin(input.sellerShopOrigin) }
      : {}),
    status: string(input.status, 'status', { empty: false }),
    ...(input.foreignCurrencyFeeUnspecified
      ? { foreignCurrencyFeeUnspecified: true }
      : {}),
    observedAt: date(input.observedAt, 'observedAt'),
    ...(purchasedAt ? { purchasedAt } : {}),
    items,
    totals,
  }
}

function validateSkuProperties(input) {
  if (!Array.isArray(input)) throw new Error('SKU properties must be an array')
  return input.map((property) => {
    object(property, 'SKU property')
    return {
      label: string(property.label, 'SKU label'),
      value: string(property.value, 'SKU value', { empty: false }),
      ...(property.raw !== undefined
        ? { raw: string(property.raw, 'Raw SKU property') }
        : {}),
    }
  })
}

function sellerShopOrigin(value) {
  string(value, 'sellerShopOrigin')
  if (!value) return value
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Seller shop origin is invalid')
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.1688.com') ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error('Seller shop origin must be an HTTPS 1688 shop')
  return url.origin
}

function validateRecord(input) {
  object(input, 'Order record')
  if (!Number.isSafeInteger(input.revision) || input.revision < 1)
    throw new Error('Order revision must be a positive integer')
  const record = {
    snapshot: validateSnapshot(input.snapshot),
    revision: input.revision,
    changedAt: date(input.changedAt, 'changedAt'),
    lastCheckedAt: date(input.lastCheckedAt, 'lastCheckedAt'),
    notes: string(input.notes, 'notes'),
    tags: strings(input.tags, 'tags'),
    changedEntryIds: strings(input.changedEntryIds, 'changedEntryIds'),
    removedEntryIds: strings(input.removedEntryIds, 'removedEntryIds'),
  }
  if (input.productTags !== undefined) {
    object(input.productTags, 'Product tags')
    record.productTags = Object.fromEntries(
      Object.entries(input.productTags).map(([entryId, tags]) => [
        identifier(entryId, 'Product tag entry ID'),
        strings(tags, 'Product tags'),
      ])
    )
  }
  if (input.productTagsUpdatedAt !== undefined)
    record.productTagsUpdatedAt = date(
      input.productTagsUpdatedAt,
      'Product tags updatedAt'
    )
  if (input.packingExcludedEntryIds !== undefined)
    record.packingExcludedEntryIds = strings(
      input.packingExcludedEntryIds,
      'Packing excluded entry IDs'
    ).map((entryId) => identifier(entryId, 'Packing excluded entry ID'))
  if (input.packingExclusionsUpdatedAt !== undefined)
    record.packingExclusionsUpdatedAt = date(
      input.packingExclusionsUpdatedAt,
      'Packing exclusions updatedAt'
    )
  for (const [field, clock, partial] of productAnnotationFields) {
    if (input[partial] === undefined) continue
    object(input[partial], 'Partial product annotation clocks')
    record[partial] = Object.fromEntries(
      Object.entries(input[partial]).map(([id, value]) => [
        identifier(id, 'Partial product annotation entry ID'),
        date(value, 'Partial product annotation timestamp'),
      ])
    )
    if (
      record[clock] &&
      Object.values(record[partial]).some((value) => value <= record[clock])
    )
      throw new Error(
        'Partial product annotation clocks must follow the complete annotation timestamp'
      )
    const ids =
      field === 'productTags'
        ? Object.keys(record[field] || {})
        : record[field] || []
    if (!record[clock] && ids.some((id) => !record[partial][id]))
      throw new Error('Partial product annotations are missing an entry clock')
  }
  if (record.lastCheckedAt < record.snapshot.observedAt)
    throw new Error('Order lastCheckedAt precedes its observation')
  if (record.changedAt > record.snapshot.observedAt)
    throw new Error('Order changedAt follows its observation')
  const currentIds = new Set(record.snapshot.items.map((item) => item.entryId))
  for (const id of record.changedEntryIds) {
    identifier(id, 'changedEntryId')
    if (!currentIds.has(id))
      throw new Error('Changed row is missing from the order')
  }
  for (const id of record.removedEntryIds) {
    identifier(id, 'removedEntryId')
    if (currentIds.has(id))
      throw new Error('A removed row is still present in the order')
  }
  return record
}

function validateImage(input) {
  object(input, 'Cached image')
  const url = string(input.url, 'Cached image URL', { empty: false })
  const dataUrl = string(input.dataUrl, 'Cached image data', { empty: false })
  const raster =
    /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/
  let allowed = raster.test(url)
  if (!allowed) {
    try {
      const parsed = new URL(url)
      allowed =
        parsed.protocol === 'https:' &&
        !parsed.username &&
        !parsed.password &&
        (parsed.hostname === 'alicdn.com' ||
          parsed.hostname.endsWith('.alicdn.com'))
    } catch {
      allowed = false
    }
  }
  const image = {
    url,
    dataUrl,
    storedAt: date(input.storedAt, 'Image storedAt'),
  }
  if (!allowed || !raster.test(dataUrl))
    throw new Error(
      'Cached images must use an Alibaba CDN URL and raster image data'
    )
  if (JSON.stringify(image).length > 2 * 1024 * 1024)
    throw new Error('Cached image exceeds the 2 MB limit')
  return image
}

function keyFor(snapshot) {
  return [snapshot.accountId, snapshot.orderId]
}

function historicalRecord(record) {
  const { namingSuggestions, ...source } = record
  return source
}

function comparable(snapshot) {
  const { observedAt, sourceUrl, purchasedAt, ...data } = snapshot
  return JSON.stringify({
    ...data,
    purchasedAt,
    items: [...data.items].sort((a, b) =>
      a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0
    ),
  })
}

function reconcile(snapshot, previous) {
  // Purchase time is immutable. The detail timeline can differ slightly from
  // the list's creation time; later reads must not move an order between dates.
  if (previous?.snapshot.purchasedAt)
    snapshot = { ...snapshot, purchasedAt: previous.snapshot.purchasedAt }
  if (previous && snapshot.observedAt < previous.snapshot.observedAt)
    return { changed: false, order: previous, ignored: true }
  const changed =
    !previous || comparable(snapshot) !== comparable(previous.snapshot)
  // Two conflicting observations with the same timestamp have no reliable order.
  if (
    previous &&
    changed &&
    snapshot.observedAt === previous.snapshot.observedAt
  )
    return { changed: false, order: previous, ignored: true }
  if (!changed)
    return {
      changed: false,
      order: { ...previous, snapshot, lastCheckedAt: snapshot.observedAt },
    }
  const previousItems = new Map(
    previous?.snapshot.items.map((item) => [item.entryId, item]) ?? []
  )
  const currentIds = new Set(snapshot.items.map((item) => item.entryId))
  return {
    changed: true,
    order: {
      snapshot,
      revision: (previous?.revision ?? 0) + 1,
      changedAt: snapshot.observedAt,
      lastCheckedAt: snapshot.observedAt,
      notes: previous?.notes ?? '',
      tags: previous?.tags ?? [],
      ...(previous?.productTags !== undefined
        ? { productTags: previous.productTags }
        : {}),
      ...(previous?.productTagsUpdatedAt !== undefined
        ? { productTagsUpdatedAt: previous.productTagsUpdatedAt }
        : {}),
      ...(previous?.packingExcludedEntryIds !== undefined
        ? { packingExcludedEntryIds: previous.packingExcludedEntryIds }
        : {}),
      ...(previous?.packingExclusionsUpdatedAt !== undefined
        ? { packingExclusionsUpdatedAt: previous.packingExclusionsUpdatedAt }
        : {}),
      ...Object.fromEntries(
        productAnnotationFields
          .filter(([, , partial]) => previous?.[partial] !== undefined)
          .map(([, , partial]) => [partial, previous[partial]])
      ),
      changedEntryIds: previous
        ? snapshot.items
            .filter(
              (item) =>
                JSON.stringify(item) !==
                JSON.stringify(previousItems.get(item.entryId))
            )
            .map((item) => item.entryId)
        : [],
      removedEntryIds: [...previousItems.keys()].filter(
        (id) => !currentIds.has(id)
      ),
    },
  }
}

/** Partial packing imports preserve known entries without claiming unknown clears. */
export function mergeProductAnnotations(previous, incoming, next = previous) {
  for (const [field, clock, partial] of productAnnotationFields) {
    const previousClock = previous[clock] || ''
    const incomingClock = incoming[clock] || ''
    const completeClock =
      incomingClock > previousClock ? incomingClock : previousClock
    const isTags = field === 'productTags'
    let value = structuredClone(previous[field] || (isTags ? {} : []))
    let entryClocks = { ...previous[partial] }
    let changed = false
    const assignEntry = (source, id) => {
      if (isTags) {
        if (source[field]?.[id]?.length) value[id] = [...source[field][id]]
        else delete value[id]
      } else {
        const ids = new Set(value)
        if (source[field]?.includes(id)) ids.add(id)
        else ids.delete(id)
        value = [...ids]
      }
    }
    if (incomingClock > previousClock) {
      value = structuredClone(incoming[field] || (isTags ? {} : []))
      entryClocks = {}
      for (const [id, timestamp] of Object.entries(previous[partial] || {})) {
        if (timestamp >= incomingClock) assignEntry(previous, id)
        if (timestamp > incomingClock) entryClocks[id] = timestamp
      }
      changed = true
    }
    for (const [id, timestamp] of Object.entries(incoming[partial] || {})) {
      const existing =
        (entryClocks[id] || '') > completeClock
          ? entryClocks[id]
          : completeClock
      if (timestamp <= existing) continue
      assignEntry(incoming, id)
      entryClocks[id] = timestamp
      changed = true
    }
    if (!changed) continue
    next = { ...next, [field]: value }
    if (completeClock) next[clock] = completeClock
    else delete next[clock]
    if (Object.keys(entryClocks).length) next[partial] = entryClocks
    else delete next[partial]
  }
  return next
}

function requested(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transaction(database, stores, mode, run) {
  const tx = database.transaction(stores, mode)
  const finished = new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onabort = () =>
      reject(tx.error ?? new Error('Database transaction aborted'))
    tx.onerror = () =>
      reject(tx.error ?? new Error('Database transaction failed'))
  })
  // Attach immediately: a failing request can abort before the body finishes.
  finished.catch(() => {})
  try {
    const result = await run(tx)
    await finished
    return result
  } catch (error) {
    try {
      tx.abort()
    } catch {
      // The request may already have aborted the transaction.
    }
    await finished.catch(() => {})
    throw error
  }
}

export function validateBackup(input) {
  object(input, 'Backup')
  if (input.format !== BACKUP_FORMAT || ![1, 2, 3].includes(input.version))
    throw new Error('Unsupported order-library backup')
  date(input.exportedAt, 'exportedAt')
  if (!Array.isArray(input.orders) || !Array.isArray(input.history))
    throw new Error('Backup orders and history must be arrays')
  const orders = input.orders.map(validateRecord)
  const history = input.history.map(validateRecord)
  if (input.images !== undefined && !Array.isArray(input.images))
    throw new Error('Backup images must be an array')
  const images = (input.images ?? []).map(validateImage)
  if (new Set(images.map((image) => image.url)).size !== images.length)
    throw new Error('Backup contains duplicate cached images')
  const current = new Map()
  for (const record of orders) {
    const key = JSON.stringify(keyFor(record.snapshot))
    if (current.has(key)) throw new Error('Backup contains duplicate order IDs')
    current.set(key, record)
  }
  const historyKeys = new Set()
  for (const record of history) {
    const owner = current.get(JSON.stringify(keyFor(record.snapshot)))
    if (!owner || record.snapshot.observedAt >= owner.snapshot.observedAt)
      throw new Error('Backup history must precede its current order')
    const key = JSON.stringify([
      ...keyFor(record.snapshot),
      record.snapshot.observedAt,
    ])
    if (historyKeys.has(key))
      throw new Error('Backup contains duplicate history entries')
    historyKeys.add(key)
  }
  if (input.version === 1)
    return {
      orders,
      history,
      images,
      preparations: [],
      allocations: [],
      issuedCodes: [],
    }
  for (const field of ['preparations', 'allocations', 'issuedCodes'])
    if (!Array.isArray(input[field]))
      throw new Error(`Backup ${field} must be an array`)
  const preparations = input.preparations.map(validatePreparation)
  const allocations = input.allocations.map(validateAllocation)
  const issuedCodes = input.issuedCodes.map(validateIssuedCode)
  for (const [records, key, label] of [
    [preparations, (entry) => [entry.accountId, entry.orderId], 'preparations'],
    [allocations, (entry) => [entry.accountId, entry.month], 'allocations'],
    [
      issuedCodes,
      (entry) => [entry.accountId, entry.kind, entry.code],
      'issued codes',
    ],
  ])
    if (
      new Set(records.map((entry) => JSON.stringify(key(entry)))).size !==
      records.length
    )
      throw new Error(`Backup contains duplicate ${label}`)
  const originalState = mergePackingState(allocations, issuedCodes)
  const state = activePackingState(preparations, allocations, issuedCodes)
  for (const preparation of preparations) {
    const key = JSON.stringify([preparation.accountId, preparation.orderId])
    const owner = current.get(key)
    validatePreparationMembership(
      preparation,
      owner,
      history.filter(
        (record) => JSON.stringify(keyFor(record.snapshot)) === key
      )
    )
    validatePreparationReservations(preparation, originalState)
  }
  const packingPreferences =
    input.packingPreferences == null
      ? undefined
      : {
          value: validatePackingPreferences(input.packingPreferences.value),
          updatedAt: date(
            input.packingPreferences.updatedAt,
            'Packing preferences updatedAt'
          ),
        }
  const packingScope =
    input.packingScope === undefined
      ? undefined
      : validatePackingScope(input.packingScope, orders, preparations)
  const scopedPreparations = packingScope
    ? packingScope.orders.map((order) =>
        selectPackingPreparation(
          preparations.find(
            (preparation) =>
              preparation.accountId === order.accountId &&
              preparation.orderId === order.orderId
          ),
          order.entryIds
        )
      )
    : preparations
  const scopedOrderKeys = packingScope
    ? new Set(
        packingScope.orders.map((order) =>
          JSON.stringify([order.accountId, order.orderId])
        )
      )
    : null
  const inPackingScope = (record) =>
    !scopedOrderKeys ||
    scopedOrderKeys.has(JSON.stringify(keyFor(record.snapshot)))
  return {
    orders: orders
      .filter(inPackingScope)
      .map((record) =>
        packingScope
          ? selectPackingOrder(
              record,
              packingScope.orders.find(
                (scope) =>
                  scope.accountId === record.snapshot.accountId &&
                  scope.orderId === record.snapshot.orderId
              ).entryIds
            )
          : record
      ),
    history: history.filter(inPackingScope),
    images,
    preparations: scopedPreparations,
    ...state,
    packingPreferences,
    packingScope,
  }
}

function validatePreparationMembership(preparation, order, history) {
  if (!order) throw new Error('Preparation is missing its saved order')
  const knownIds = new Set(
    [order, ...history].flatMap((record) =>
      record.snapshot.items.map((item) => item.entryId)
    )
  )
  if (
    [
      preparation,
      preparation.defaultPacking,
      preparation.previousPacking,
      preparation.previousPacking?.defaults,
    ]
      .filter(Boolean)
      .some((entry) =>
        entry.groups.some((group) =>
          group.variants.some((variant) =>
            variant.entryIds.some((entryId) => !knownIds.has(entryId))
          )
        )
      )
  )
    throw new Error(
      'Preparation contains an entry missing from its order and history'
    )
}

/** Extension-origin IndexedDB is the only durable store for orders and import jobs. */
export async function openDatabase({ name = '1688-order-library' } = {}) {
  const database = await new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(name, 3)
    let blocked = false
    request.onupgradeneeded = (event) => {
      const db = request.result
      if (event.oldVersion < 1) {
        const orders = db.createObjectStore('orders', {
          keyPath: ['snapshot.accountId', 'snapshot.orderId'],
        })
        orders.createIndex('account', 'snapshot.accountId')
        const history = db.createObjectStore('history', {
          keyPath: [
            'snapshot.accountId',
            'snapshot.orderId',
            'snapshot.observedAt',
          ],
        })
        history.createIndex('order', ['snapshot.accountId', 'snapshot.orderId'])
        db.createObjectStore('jobs', { keyPath: 'id' })
        db.createObjectStore('images', { keyPath: 'url' })
      }
      if (event.oldVersion < 2) {
        const preparations = db.createObjectStore('preparations', {
          keyPath: ['accountId', 'orderId'],
        })
        preparations.createIndex('account', 'accountId')
        db.createObjectStore('packingAllocations', {
          keyPath: ['accountId', 'month'],
        })
        db.createObjectStore('issuedCodes', {
          keyPath: ['accountId', 'kind', 'code'],
        })
        db.createObjectStore('packingPreferences', { keyPath: 'id' })
      }
      if (event.oldVersion < 3) {
        const tx = request.transaction
        void replaceActiveCodes(tx).catch((error) => {
          reject(error)
          tx.abort()
        })
      }
    }
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      blocked = true
      reject(
        new Error(
          'Close other order-library tabs before upgrading the database'
        )
      )
    }
  })
  database.onversionchange = () => database.close()
  const read = (stores, run) => transaction(database, stores, 'readonly', run)
  const write = (stores, run) => transaction(database, stores, 'readwrite', run)

  async function replaceActiveCodes(
    tx,
    allocationInputs,
    incomingEvidence = []
  ) {
    const state = activePackingState(
      await requested(tx.objectStore('preparations').getAll()),
      allocationInputs ??
        (await requested(tx.objectStore('packingAllocations').getAll())),
      [
        ...incomingEvidence,
        ...(await requested(tx.objectStore('issuedCodes').getAll())),
      ]
    )
    tx.objectStore('issuedCodes').clear()
    tx.objectStore('packingAllocations').clear()
    for (const entry of state.issuedCodes)
      tx.objectStore('issuedCodes').put(entry)
    for (const entry of state.allocations)
      tx.objectStore('packingAllocations').put(entry)
    return state
  }

  async function packingPreferencesFor(tx) {
    const store = tx.objectStore('packingPreferences')
    const previous = await requested(store.get('packing'))
    const value = upgradeWorkspaceColors(
      initializeVocabulary(
        previous?.value
          ? previous.value.sizeVocabulary === undefined
            ? validatePackingPreferences(previous.value)
            : previous.value
          : validatePackingPreferences()
      )
    )
    if (!previous || value !== previous.value)
      store.put({
        id: 'packing',
        value,
        // Seeding is not an authored preference edit and must not outrank a
        // user's older backup when restoring into a freshly opened library.
        updatedAt: previous?.updatedAt ?? '1970-01-01T00:00:00.000Z',
      })
    return value
  }

  function nextEditTimestamp(previous) {
    return new Date(
      Math.max(Date.now(), Date.parse(previous || 0) + 1)
    ).toISOString()
  }

  function annotationEditClock(record, field, ids) {
    const [, clock, partial] = productAnnotationFields.find(
      ([name]) => name === field
    )
    const previous = [
      record[clock] || '',
      ...Object.values(record[partial] || {}),
    ]
      .sort()
      .at(-1)
    const timestamp = nextEditTimestamp(previous)
    if (record[partial] === undefined) return { [clock]: timestamp }
    return {
      [partial]: {
        ...record[partial],
        ...Object.fromEntries(ids.map((id) => [id, timestamp])),
      },
    }
  }

  async function syncTagCatalogs(
    tx,
    value,
    { previousRecords = [], touch = false } = {}
  ) {
    const records = await requested(tx.objectStore('orders').getAll())
    const next = { ...value }
    for (const scope of ['order', 'product']) {
      const field = `${scope}Tags`
      const catalog = reconcileTagCatalog(
        value[field],
        assignedTagNames(records, scope),
        {
          previousNames: assignedTagNames(previousRecords, scope),
          scope,
        }
      )
      if (catalog.length || value[field] !== undefined) next[field] = catalog
    }
    if (JSON.stringify(next) !== JSON.stringify(value)) {
      const store = tx.objectStore('packingPreferences')
      const previous = await requested(store.get('packing'))
      store.put({
        id: 'packing',
        value: next,
        updatedAt: touch
          ? nextEditTimestamp(previous?.updatedAt)
          : previous?.updatedAt || '1970-01-01T00:00:00.000Z',
      })
    }
    return next
  }

  function refreshPreparedNames(
    tx,
    preparation,
    suggest,
    { replaceAutomatic = false } = {}
  ) {
    if (!preparation) return false
    const refreshed = refreshPreparationNames(preparation, suggest, {
      replaceAutomatic,
    })
    if (refreshed === preparation) return false
    // Invalidate open drafts without promoting derived names over newer
    // authoring in a backup. updatedAt remains the user's edit timestamp.
    tx.objectStore('preparations').put({
      ...refreshed,
      revision: preparation.revision + 1,
    })
    return true
  }

  async function refreshNames(tx, preferences, options) {
    const suggest = createNameSuggester(preferences.vocabulary)
    let orders = 0
    let preparations = 0
    const store = tx.objectStore('orders')
    for (const order of await requested(store.getAll())) {
      const namingSuggestions = orderNamingSuggestions(order.snapshot, suggest)
      if (
        JSON.stringify(order.namingSuggestions) !==
        JSON.stringify(namingSuggestions)
      ) {
        store.put({ ...order, namingSuggestions })
        orders += 1
      }
    }
    for (const preparation of await requested(
      tx.objectStore('preparations').getAll()
    ))
      if (refreshPreparedNames(tx, preparation, suggest, options))
        preparations += 1
    return { orders, preparations }
  }

  async function savePreparations(
    inputs,
    {
      expectedRevisions = inputs.map((entry) => entry.revision),
      capturePrevious = false,
      resetDefaults = false,
      preview = false,
      preserveNaming = false,
    } = {}
  ) {
    if (!Array.isArray(inputs) || !inputs.length)
      throw new Error('Choose at least one order to prepare')
    const drafts = inputs.map(validatePreparation)
    if (
      !Array.isArray(expectedRevisions) ||
      expectedRevisions.length !== drafts.length ||
      expectedRevisions.some(
        (value) => !Number.isSafeInteger(value) || value < 0
      )
    )
      throw new Error(
        'Expected preparation revisions must be non-negative integers'
      )
    const keys = drafts.map((draft) =>
      JSON.stringify([draft.accountId, draft.orderId])
    )
    if (new Set(keys).size !== keys.length)
      throw new Error('Save each order preparation only once in a batch')
    const selectedKeys = new Set(keys)
    const selectedOrderIds = new Set(drafts.map((draft) => draft.orderId))
    function checkpointScope(value, label) {
      if (typeof value === 'boolean')
        return value ? selectedOrderIds : new Set()
      const orderIds = strings(value, label)
      if (orderIds.some((orderId) => !selectedOrderIds.has(orderId)))
        throw new Error(
          `${label} contains an order outside this preparation batch`
        )
      return new Set(orderIds)
    }
    const previousOrderIds = checkpointScope(capturePrevious, 'capturePrevious')
    const defaultOrderIds = checkpointScope(resetDefaults, 'resetDefaults')
    return (preview ? read : write)(
      ['orders', 'preparations', 'packingAllocations', 'issuedCodes'],
      async (tx) => {
        const store = tx.objectStore('preparations')
        let allocations = await requested(
          tx.objectStore('packingAllocations').getAll()
        )
        let issuedCodes = await requested(
          tx.objectStore('issuedCodes').getAll()
        )
        const previousPreparations = await requested(store.getAll())
        const previousByKey = new Map(
          previousPreparations.map((entry) => [
            JSON.stringify([entry.accountId, entry.orderId]),
            entry,
          ])
        )
        for (const [index, draft] of drafts.entries()) {
          const previous = previousByKey.get(keys[index])
          if ((previous?.revision ?? 0) !== expectedRevisions[index]) {
            const error = new Error(
              'Preparation changed in another tab. Reload it before saving your edits.'
            )
            error.code = 'PACKING_REVISION_CONFLICT'
            error.packingIssue = { orderId: draft.orderId }
            throw error
          }
        }
        // Reserve the complete final set of explicit codes before allocating blanks.
        // This makes swaps and bulk edits atomic and ignores retired assignments.
        const current = activePackingState(
          [
            ...previousPreparations.filter(
              (entry) =>
                !selectedKeys.has(
                  JSON.stringify([entry.accountId, entry.orderId])
                )
            ),
            ...drafts.map((draft) => ({
              ...draft,
              groups: draft.groups.filter((group) => group.baseCode),
            })),
          ],
          allocations,
          issuedCodes
        )
        allocations = current.allocations
        issuedCodes = current.issuedCodes
        const results = []
        for (let index = 0; index < drafts.length; index += 1) {
          const draft = drafts[index]
          const resetOrderDefaults = defaultOrderIds.has(draft.orderId)
          const expectedRevision = expectedRevisions[index]
          const key = [draft.accountId, draft.orderId]
          const previous = previousByKey.get(keys[index])
          const order = await requested(tx.objectStore('orders').get(key))
          if (!order)
            throw new Error('Save the source order before preparing labels')
          const knownIds = new Set([
            ...order.snapshot.items.map((item) => item.entryId),
            ...(previous?.groups.flatMap((group) =>
              group.variants.flatMap((variant) => variant.entryIds)
            ) ?? []),
            ...[
              previous?.defaultPacking,
              previous?.previousPacking,
              previous?.previousPacking?.defaults,
            ]
              .filter(Boolean)
              .flatMap((checkpoint) =>
                checkpoint.groups.flatMap((group) =>
                  group.variants.flatMap((variant) => variant.entryIds)
                )
              ),
          ])
          for (const group of draft.groups)
            for (const variant of group.variants)
              if (variant.entryIds.some((entryId) => !knownIds.has(entryId)))
                throw new Error(
                  'Preparation contains an entry missing from this order'
                )
          const result = allocatePreparation(
            preserveNaming ? draft : recordNamingEdits(draft, previous),
            allocations,
            issuedCodes,
            { snapshot: order.snapshot }
          )
          const preparation = {
            ...result.preparation,
            revision: expectedRevision + (preview ? 0 : 1),
            updatedAt: new Date(
              Math.max(Date.now(), Date.parse(previous?.updatedAt || 0) + 1)
            ).toISOString(),
          }
          if (previousOrderIds.has(draft.orderId) && previous)
            preparation.previousPacking = packingCheckpoint(previous, {
              includeDefaults: true,
            })
          if (resetOrderDefaults || !preparation.defaultPacking)
            preparation.defaultPacking = packingCheckpoint(
              resetPreparationOrder(preparation, order.snapshot)
            )
          else {
            preparation.defaultPacking = extendDefaultPacking(
              preparation,
              order.snapshot
            )
          }
          validatePreparationReservations(
            { ...preparation, revision: 1 },
            result
          )
          allocations = result.allocations
          issuedCodes = result.issuedCodes
          results.push(preparation)
        }
        // No writes occur until every draft and reservation has been checked.
        if (!preview) {
          tx.objectStore('packingAllocations').clear()
          tx.objectStore('issuedCodes').clear()
          for (const allocation of allocations)
            tx.objectStore('packingAllocations').put(allocation)
          for (const issued of issuedCodes)
            tx.objectStore('issuedCodes').put(issued)
          for (const preparation of results) store.put(preparation)
        }
        return results
      }
    )
  }

  return {
    async saveSnapshot(input) {
      const snapshot = validateSnapshot(input)
      return write(
        ['orders', 'history', 'preparations', 'packingPreferences'],
        async (tx) => {
          const orders = tx.objectStore('orders')
          const previous = await requested(orders.get(keyFor(snapshot)))
          const result = reconcile(snapshot, previous)
          if (!result.ignored) {
            const preferences = await packingPreferencesFor(tx)
            const suggest = createNameSuggester(preferences.vocabulary)
            if (result.changed && previous)
              tx.objectStore('history').put(historicalRecord(previous))
            result.order.namingSuggestions = orderNamingSuggestions(
              result.order.snapshot,
              suggest
            )
            orders.put(result.order)
            refreshPreparedNames(
              tx,
              await requested(
                tx.objectStore('preparations').get(keyFor(snapshot))
              ),
              suggest
            )
          }
          return { changed: result.changed, order: result.order }
        }
      )
    },

    async listOrders({ accountId = 'local' } = {}) {
      return read(['orders'], (tx) =>
        requested(tx.objectStore('orders').index('account').getAll(accountId))
      )
    },

    async getOrder(orderId, { accountId = 'local' } = {}) {
      return read(['orders'], (tx) =>
        requested(tx.objectStore('orders').get([accountId, orderId]))
      )
    },

    async getHistory(orderId, { accountId = 'local' } = {}) {
      const records = await read(['history'], (tx) =>
        requested(
          tx.objectStore('history').index('order').getAll([accountId, orderId])
        )
      )
      return records.sort((a, b) =>
        b.snapshot.observedAt.localeCompare(a.snapshot.observedAt)
      )
    },

    async setNotes(orderId, { notes, tags }, { accountId = 'local' } = {}) {
      string(notes, 'notes')
      const uniqueTags = strings(tags, 'tags')
      return write(['orders', 'packingPreferences'], async (tx) => {
        const store = tx.objectStore('orders')
        const order = await requested(store.get([accountId, orderId]))
        if (!order) throw new Error('Order was not found')
        const result = { ...order, notes, tags: uniqueTags }
        store.put(result)
        const value = await packingPreferencesFor(tx)
        await syncTagCatalogs(tx, value, {
          previousRecords: [order],
          touch: true,
        })
        return result
      })
    },

    async setProductTags(orderId, entryId, tags, { accountId = 'local' } = {}) {
      identifier(entryId, 'Product tag entry ID')
      const uniqueTags = strings(tags, 'Product tags')
      return write(['orders', 'packingPreferences'], async (tx) => {
        const store = tx.objectStore('orders')
        const order = await requested(store.get([accountId, orderId]))
        if (!order) throw new Error('Order was not found')
        if (
          !order.snapshot.items.some((item) => item.entryId === entryId) &&
          !Object.hasOwn(order.productTags || {}, entryId)
        )
          throw new Error('Product was not found in this order')
        const productTags = { ...order.productTags }
        if (uniqueTags.length) productTags[entryId] = uniqueTags
        else delete productTags[entryId]
        const result = {
          ...order,
          productTags,
          ...annotationEditClock(order, 'productTags', [entryId]),
        }
        store.put(result)
        await syncTagCatalogs(tx, await packingPreferencesFor(tx), {
          previousRecords: [order],
          touch: true,
        })
        return result
      })
    },

    async setPackingExcluded(
      orderId,
      entryIds,
      excluded,
      { accountId = 'local' } = {}
    ) {
      identifier(orderId, 'Order ID')
      const ids = strings(entryIds, 'Packing entry IDs').map((entryId) =>
        identifier(entryId, 'Packing entry ID')
      )
      if (typeof excluded !== 'boolean')
        throw new Error('Packing exclusion must be a boolean')
      return write(['orders'], async (tx) => {
        const store = tx.objectStore('orders')
        const order = await requested(store.get([accountId, orderId]))
        if (!order) throw new Error('Order was not found')
        const currentIds = new Set(
          order.snapshot.items.map((item) => item.entryId)
        )
        const excludedIds = new Set(order.packingExcludedEntryIds || [])
        if (
          ids.some(
            (id) => !currentIds.has(id) && (excluded || !excludedIds.has(id))
          )
        )
          throw new Error('Product was not found in this order')
        let changed = false
        for (const id of ids) {
          if (excludedIds.has(id) === excluded) continue
          if (excluded) excludedIds.add(id)
          else excludedIds.delete(id)
          changed = true
        }
        if (!changed) return order
        const result = {
          ...order,
          packingExcludedEntryIds: [...excludedIds],
          ...annotationEditClock(order, 'packingExcludedEntryIds', ids),
        }
        store.put(result)
        return result
      })
    },

    async removeTag(name, { scope = 'order' } = {}) {
      string(name, 'Tag name', { empty: false })
      if (!['order', 'product'].includes(scope))
        throw new Error('Choose order or product tags')
      return write(['orders', 'history', 'packingPreferences'], async (tx) => {
        let removedAssignments = 0
        for (const storeName of ['orders', 'history']) {
          const store = tx.objectStore(storeName)
          for (const record of await requested(store.getAll())) {
            let count = 0
            const next = { ...record }
            if (scope === 'order') {
              count = record.tags.includes(name) ? 1 : 0
              if (count) next.tags = record.tags.filter((tag) => tag !== name)
            } else {
              const entries = Object.entries(record.productTags || {})
              count = entries.filter(([, tags]) => tags.includes(name)).length
              if (count) {
                next.productTags = Object.fromEntries(
                  entries
                    .map(([id, tags]) => [
                      id,
                      tags.filter((tag) => tag !== name),
                    ])
                    .filter(([, tags]) => tags.length)
                )
                Object.assign(
                  next,
                  annotationEditClock(
                    record,
                    'productTags',
                    entries
                      .filter(([, tags]) => tags.includes(name))
                      .map(([id]) => id)
                  )
                )
              }
            }
            if (count) store.put(next)
            if (storeName === 'orders') removedAssignments += count
          }
        }
        const value = await packingPreferencesFor(tx)
        const preferences = {
          ...value,
          [`${scope}Tags`]: (value[`${scope}Tags`] || []).filter(
            (entry) => entry.name !== name
          ),
        }
        const store = tx.objectStore('packingPreferences')
        const previous = await requested(store.get('packing'))
        store.put({
          id: 'packing',
          value: preferences,
          updatedAt: nextEditTimestamp(previous?.updatedAt),
        })
        return { removedAssignments, preferences }
      })
    },

    async getTagUsage(name, { scope = 'order' } = {}) {
      string(name, 'Tag name', { empty: false })
      if (!['order', 'product'].includes(scope))
        throw new Error('Choose order or product tags')
      return read(
        ['orders'],
        async (tx) =>
          assignedTagNames(
            await requested(tx.objectStore('orders').getAll()),
            scope
          ).filter((tag) => tag === name).length
      )
    },

    async renameTag(name, nextName, { scope = 'order' } = {}) {
      string(name, 'Tag name', { empty: false })
      return write(['orders', 'history', 'packingPreferences'], async (tx) => {
        const orders = await requested(tx.objectStore('orders').getAll())
        const history = await requested(tx.objectStore('history').getAll())
        const value = await packingPreferencesFor(tx)
        const renamed = renameTagData(
          { definitions: value[`${scope}Tags`], orders, history },
          name,
          nextName,
          scope
        )
        for (const [storeName, originals] of [
          ['orders', orders],
          ['history', history],
        ]) {
          const store = tx.objectStore(storeName)
          renamed[storeName].forEach((record, index) => {
            if (record === originals[index]) return
            store.put(
              scope === 'product'
                ? {
                    ...record,
                    ...annotationEditClock(
                      record,
                      'productTags',
                      Object.entries(originals[index].productTags || {})
                        .filter(([, tags]) => tags.includes(name))
                        .map(([id]) => id)
                    ),
                  }
                : record
            )
          })
        }
        const preferences = { ...value, [`${scope}Tags`]: renamed.definitions }
        const store = tx.objectStore('packingPreferences')
        const previous = await requested(store.get('packing'))
        store.put({
          id: 'packing',
          value: preferences,
          updatedAt: nextEditTimestamp(previous?.updatedAt),
        })
        return { renamedAssignments: renamed.renamedAssignments, preferences }
      })
    },

    async removeOrders(orderIds, { accountId = 'local' } = {}) {
      const ids = strings(orderIds, 'orderIds')
      return write(
        [
          'orders',
          'history',
          'preparations',
          'packingPreferences',
          'issuedCodes',
          'packingAllocations',
        ],
        async (tx) => {
          const previousRecords = []
          for (const id of ids) {
            const record = await requested(
              tx.objectStore('orders').get([accountId, id])
            )
            if (record) previousRecords.push(record)
            tx.objectStore('orders').delete([accountId, id])
            tx.objectStore('preparations').delete([accountId, id])
            const keys = await requested(
              tx
                .objectStore('history')
                .index('order')
                .getAllKeys([accountId, id])
            )
            for (const key of keys) tx.objectStore('history').delete(key)
          }
          await syncTagCatalogs(tx, await packingPreferencesFor(tx), {
            previousRecords,
            touch: true,
          })
          await replaceActiveCodes(tx)
        }
      )
    },

    async exportBackup({ orderIds, accountId = 'local' } = {}) {
      const includedIds =
        orderIds === undefined
          ? null
          : new Set(
              strings(orderIds, 'Backup order IDs').map((id) =>
                identifier(id, 'Backup order ID')
              )
            )
      return read(
        [
          'orders',
          'history',
          'images',
          'preparations',
          'packingAllocations',
          'issuedCodes',
          'packingPreferences',
        ],
        async (tx) => {
          let orders = await requested(tx.objectStore('orders').getAll())
          let history = await requested(tx.objectStore('history').getAll())
          let images = await requested(tx.objectStore('images').getAll())
          let preparations = await requested(
            tx.objectStore('preparations').getAll()
          )
          const allocations = await requested(
            tx.objectStore('packingAllocations').getAll()
          )
          const issuedCodes = await requested(
            tx.objectStore('issuedCodes').getAll()
          )
          const preferences = await requested(
            tx.objectStore('packingPreferences').get('packing')
          )
          if (includedIds) {
            const included = (entry) =>
              entry.accountId === accountId && includedIds.has(entry.orderId)
            orders = orders.filter((entry) => included(entry.snapshot))
            const includedKeys = new Set(
              orders.map((entry) => JSON.stringify(keyFor(entry.snapshot)))
            )
            history = history.filter((entry) =>
              includedKeys.has(JSON.stringify(keyFor(entry.snapshot)))
            )
            preparations = preparations.filter((entry) =>
              includedKeys.has(JSON.stringify([entry.accountId, entry.orderId]))
            )
            const photoUrls = new Set([
              ...[...orders, ...history].flatMap((entry) =>
                entry.snapshot.items.map((item) => item.thumbnail)
              ),
              ...issuedCodes
                .filter(included)
                .flatMap((entry) => entry.ownerSnapshot?.photos || []),
            ])
            images = images.filter((entry) => photoUrls.has(entry.url))
          }
          return {
            format: BACKUP_FORMAT,
            version: 3,
            exportedAt: new Date().toISOString(),
            orders,
            history,
            images,
            preparations,
            ...activePackingState(preparations, allocations, issuedCodes),
            packingPreferences: preferences
              ? { value: preferences.value, updatedAt: preferences.updatedAt }
              : null,
          }
        }
      )
    },

    async restoreBackup(input) {
      // Validate every record before opening a write transaction. A malformed
      // trailing record must never leave a partially restored library.
      const backup = validateBackup(input)
      return write(
        [
          'orders',
          'history',
          'images',
          'preparations',
          'packingAllocations',
          'issuedCodes',
          'packingPreferences',
        ],
        async (tx) => {
          const orders = tx.objectStore('orders')
          const history = tx.objectStore('history')
          const allocations = await requested(
            tx.objectStore('packingAllocations').getAll()
          )
          const state = mergePackingState(
            [...allocations, ...backup.allocations],
            []
          )
          for (const incoming of backup.preparations) {
            const store = tx.objectStore('preparations')
            const previous = await requested(
              store.get([incoming.accountId, incoming.orderId])
            )
            if (backup.packingScope) {
              const scope = backup.packingScope.orders.find(
                (order) =>
                  order.accountId === incoming.accountId &&
                  order.orderId === incoming.orderId
              )
              const merged = mergePackingPreparation(
                previous,
                incoming,
                scope.entryIds
              )
              if (merged !== previous) store.put(merged)
            } else if (!previous) store.put(incoming)
            else if (incoming.updatedAt > previous.updatedAt)
              store.put({
                ...incoming,
                revision: Math.max(incoming.revision, previous.revision) + 1,
              })
            else if (incoming.updatedAt === previous.updatedAt) {
              if (
                JSON.stringify(preparationAuthoring(incoming)) !==
                JSON.stringify(preparationAuthoring(previous))
              ) {
                if (isPackingPreparationSubset(previous, incoming))
                  store.put({
                    ...incoming,
                    revision:
                      Math.max(previous.revision, incoming.revision) + 1,
                  })
                else if (!isPackingPreparationSubset(incoming, previous))
                  throw new Error(
                    'Backup conflict: preparation edits have the same timestamp'
                  )
              }
            }
          }
          if (backup.packingPreferences) {
            const store = tx.objectStore('packingPreferences')
            const previous = await requested(store.get('packing'))
            if (
              !previous ||
              previous.updatedAt === '1970-01-01T00:00:00.000Z' ||
              (!backup.packingScope &&
                previous.updatedAt < backup.packingPreferences.updatedAt)
            )
              store.put({
                id: 'packing',
                ...backup.packingPreferences,
                // Scoped artwork/tag defaults do not claim a complete Settings edit.
                updatedAt: backup.packingScope
                  ? '1970-01-01T00:00:00.000Z'
                  : backup.packingPreferences.updatedAt,
              })
          }
          let imported = 0
          let updated = 0
          for (const incoming of backup.orders) {
            const key = keyFor(incoming.snapshot)
            const previous = await requested(orders.get(key))
            if (!previous) {
              orders.put(incoming)
              imported += 1
            } else {
              const result = reconcile(incoming.snapshot, previous)
              let next = result.ignored ? previous : result.order
              if (!result.ignored) {
                if (result.changed) {
                  history.put(historicalRecord(previous))
                  updated += 1
                }
              }
              // A packing restore never replaces existing local annotations.
              // Full restores fill partial observations without undoing newer edits.
              if (!backup.packingScope)
                next = mergeProductAnnotations(previous, incoming, next)
              if (next !== previous) orders.put(next)
              // An older backup's current version is still useful history.
              if (incoming.snapshot.observedAt < previous.snapshot.observedAt) {
                const historyKey = [...key, incoming.snapshot.observedAt]
                if (!(await requested(history.getKey(historyKey))))
                  history.put(incoming)
              }
            }
          }
          for (const record of backup.history) {
            const key = [...keyFor(record.snapshot), record.snapshot.observedAt]
            if (!(await requested(history.getKey(key)))) history.put(record)
          }
          for (const image of backup.images) {
            const existing = await requested(
              tx.objectStore('images').get(image.url)
            )
            if (!existing || existing.storedAt < image.storedAt)
              tx.objectStore('images').put(image)
          }
          // A tied source/history observation can be retained from the local
          // library instead of the incoming backup. Verify the actual merged
          // records before committing authoring that depends on their entries.
          for (const preparation of await requested(
            tx.objectStore('preparations').getAll()
          )) {
            const key = [preparation.accountId, preparation.orderId]
            validatePreparationMembership(
              preparation,
              await requested(orders.get(key)),
              await requested(history.index('order').getAll(key))
            )
          }
          // Only the final merged preparations own codes. Old backups cannot
          // revive retired reservations; current collisions abort the whole restore.
          await replaceActiveCodes(tx, state.allocations, backup.issuedCodes)
          if (backup.packingScope) {
            // Newer local source/preparation data wins. Do not reopen a scope
            // whose selected rows have since disappeared from either record.
            const restoredOrders = []
            const restoredPreparations = []
            for (const scope of backup.packingScope.orders) {
              const key = [scope.accountId, scope.orderId]
              restoredOrders.push(await requested(orders.get(key)))
              restoredPreparations.push(
                await requested(tx.objectStore('preparations').get(key))
              )
            }
            try {
              // Local preparations legitimately retain unselected products.
              validatePackingScope(
                {
                  ...backup.packingScope,
                  mode: undefined,
                  months: [
                    ...new Set(
                      restoredPreparations.flatMap((preparation, index) => {
                        const selected = new Set(
                          backup.packingScope.orders[index].entryIds
                        )
                        return preparation.groups
                          .filter((group) =>
                            group.variants.some((variant) =>
                              variant.entryIds.some((id) => selected.has(id))
                            )
                          )
                          .map((group) => group.month ?? preparation.month)
                      })
                    ),
                  ],
                },
                restoredOrders,
                restoredPreparations
              )
            } catch {
              throw new Error(
                'Packing restore conflict: newer local data changed or removed selected products. Review the current order before restoring this packing.'
              )
            }
          }
          const preferences = await syncTagCatalogs(
            tx,
            await packingPreferencesFor(tx)
          )
          // Packing carries exact prepared label values, not the global naming
          // catalog that originally suggested them. Preserve that saved artwork.
          if (!backup.packingScope)
            await refreshNames(tx, preferences, { replaceAutomatic: true })
          return { imported, updated }
        }
      )
    },

    async getPreparation(orderId, { accountId = 'local' } = {}) {
      return read(['preparations'], (tx) =>
        requested(tx.objectStore('preparations').get([accountId, orderId]))
      )
    },

    async listPreparations({ accountId = 'local' } = {}) {
      return read(['preparations'], (tx) =>
        requested(
          tx.objectStore('preparations').index('account').getAll(accountId)
        )
      )
    },

    async getReservedBarcodes(baseCode, { accountId = 'local' } = {}) {
      string(baseCode, 'Base code', { empty: false })
      const range = globalThis.IDBKeyRange.bound(
        [accountId, 'barcode', baseCode],
        [accountId, 'barcode', `${baseCode}\uffff`]
      )
      const keys = await read(['issuedCodes'], (tx) =>
        requested(tx.objectStore('issuedCodes').getAllKeys(range))
      )
      return keys.map((key) => key[2])
    },

    async getOwnedProductCodes({ accountId = 'local', orderId, groupId }) {
      string(orderId, 'Order ID', { empty: false })
      string(groupId, 'Group ID', { empty: false })
      const range = globalThis.IDBKeyRange.bound(
        [accountId, 'base', ''],
        [accountId, 'base', '\uffff']
      )
      const reservations = await read(['issuedCodes'], (tx) =>
        requested(tx.objectStore('issuedCodes').getAll(range))
      )
      return reservations
        .filter(
          (entry) => entry.orderId === orderId && entry.groupId === groupId
        )
        .map((entry) => ({ code: entry.code, month: entry.month }))
        .sort((a, b) => a.code.localeCompare(b.code))
    },

    async queryCodeOwnership(code, { accountId = 'local' } = {}) {
      string(code, 'Code', { empty: false })
      return read(
        ['issuedCodes', 'preparations', 'orders', 'history'],
        async (tx) => {
          const owners = []
          for (const kind of ['base', 'barcode']) {
            const reservation = await requested(
              tx.objectStore('issuedCodes').get([accountId, kind, code])
            )
            if (!reservation) continue
            const key = [accountId, reservation.orderId]
            const preparation = await requested(
              tx.objectStore('preparations').get(key)
            )
            const order = await requested(tx.objectStore('orders').get(key))
            const barcodeReservations =
              kind === 'base'
                ? await requested(
                    tx
                      .objectStore('issuedCodes')
                      .getAll(
                        globalThis.IDBKeyRange.bound(
                          [accountId, 'barcode', code],
                          [accountId, 'barcode', `${code}\uffff`]
                        )
                      )
                  )
                : []
            const evidence = codeOwnerEvidence(
              reservation,
              preparation,
              barcodeReservations
            )
            const {
              group,
              variant,
              evidenceGroup,
              evidenceVariant,
              currentGroup,
              currentVariant,
            } = evidence
            const snapshot = reservation.ownerSnapshot
            const entryIds = evidence.entryIds ?? snapshot?.entryIds ?? []
            const members = new Set(entryIds)
            const sourceTitle = [
              ...new Set(
                order?.snapshot.items
                  .filter((item) => members.has(item.entryId))
                  .map((item) => item.title || item.description)
                  .filter(Boolean) || []
              ),
            ].join(' · ')
            let photos = snapshot?.photos || []
            if (!photos.length && order) {
              const records = [
                order,
                ...(await requested(
                  tx.objectStore('history').index('order').getAll(key)
                )),
              ]
              photos = [
                ...new Set(
                  records.flatMap((record) =>
                    record.snapshot.items
                      .filter((item) => members.has(item.entryId))
                      .map((item) => item.thumbnail)
                      .filter(Boolean)
                  )
                ),
              ].slice(0, 6)
            }
            const currentCode =
              kind === 'base'
                ? currentGroup?.baseCode
                : currentGroup &&
                    currentVariant &&
                    !currentVariant.needsSizeMapping
                  ? barcodeValue(currentGroup, currentVariant)
                  : ''
            owners.push({
              kind,
              accountId,
              orderId: reservation.orderId,
              groupId: reservation.groupId,
              ...(reservation.variantId
                ? { variantId: reservation.variantId }
                : {}),
              month: reservation.month,
              sellerId: reservation.sellerId,
              status: 'active',
              orderExists: Boolean(order),
              groupExists: Boolean(group),
              sellerName:
                order?.snapshot.sellerName ||
                snapshot?.sellerName ||
                reservation.sellerId,
              groupTitle:
                currentGroup?.title ||
                snapshot?.groupTitle ||
                (evidence.recovered ? sourceTitle : evidenceGroup?.title) ||
                '',
              spanishName:
                currentGroup?.spanishName ?? snapshot?.spanishName ?? '',
              category: currentGroup?.category ?? snapshot?.category ?? '',
              variant:
                currentVariant?.variant ??
                snapshot?.variant ??
                evidenceVariant?.variant ??
                '',
              entryIds,
              photos,
              currentCode: currentCode || '',
              currentBaseCode: currentGroup?.baseCode || '',
              currentGroupId: currentGroup?.id || '',
            })
          }
          return { code, owners }
        }
      )
    },

    async savePreparation(
      input,
      { expectedRevision = input.revision, ...options } = {}
    ) {
      return (
        await savePreparations([input], {
          ...options,
          expectedRevisions: [expectedRevision],
        })
      )[0]
    },

    savePreparations,

    async previewPreparations(inputs, options = {}) {
      return savePreparations(inputs, { ...options, preview: true })
    },

    async getPackingPreferences() {
      return write(['packingPreferences', 'orders'], async (tx) =>
        syncTagCatalogs(tx, await packingPreferencesFor(tx))
      )
    },

    async getWorkspaceDisplay() {
      return read(['packingPreferences'], async (tx) => {
        const store = tx.objectStore('packingPreferences')
        const packing = await requested(store.get('packing'))
        const display = await requested(store.get('workspace-display'))
        return {
          appearance: packing?.value?.appearance,
          colorScheme: display?.colorScheme || 'dark',
        }
      })
    },

    async setWorkspaceColorScheme(colorScheme) {
      if (!['light', 'dark', 'system'].includes(colorScheme))
        throw new Error('The workspace color scheme is invalid.')
      return write(['packingPreferences'], async (tx) => {
        const store = tx.objectStore('packingPreferences')
        const previous = await requested(store.get('workspace-display'))
        if (previous?.colorScheme !== colorScheme)
          store.put({ id: 'workspace-display', colorScheme })
      })
    },

    async savePackingPreferences(input, { tagCatalogBaseline } = {}) {
      const validated = validatePackingPreferences(input)
      const value = initializeVocabulary({
        ...validated,
        settings: { ...validated.settings, vocabularyInitialized: true },
      })
      return write(
        ['packingPreferences', 'orders', 'preparations'],
        async (tx) => {
          const store = tx.objectStore('packingPreferences')
          const previous = await requested(store.get('packing'))
          const records = await requested(tx.objectStore('orders').getAll())
          for (const scope of ['order', 'product']) {
            const field = `${scope}Tags`
            const catalog = reconcileTagCatalog(
              value[field],
              assignedTagNames(records, scope),
              {
                previous: previous?.value?.[field],
                baseline: tagCatalogBaseline?.[field],
                scope,
              }
            )
            if (
              catalog.length ||
              value[field] !== undefined ||
              previous?.value?.[field] !== undefined
            )
              value[field] = catalog
          }
          const updatedAt = new Date(
            Math.max(Date.now(), Date.parse(previous?.updatedAt || 0) + 1)
          ).toISOString()
          store.put({ id: 'packing', value, updatedAt })
          // Seed rules and saved rules can have different property ordering.
          // Compare their effective, validated values rather than raw records.
          const previousVocabulary = validatePackingPreferences(
            initializeVocabulary(validatePackingPreferences(previous?.value))
          ).vocabulary
          await refreshNames(tx, value, {
            replaceAutomatic:
              JSON.stringify(previousVocabulary) !==
              JSON.stringify(value.vocabulary),
          })
          return value
        }
      )
    },

    async refreshNamingSuggestions() {
      return write(
        ['orders', 'preparations', 'packingPreferences'],
        async (tx) => refreshNames(tx, await packingPreferencesFor(tx))
      )
    },

    async getImage(url) {
      return read(['images'], (tx) =>
        requested(tx.objectStore('images').get(url))
      )
    },

    async putImage(input) {
      const image = validateImage(input)
      return write(['images'], async (tx) => {
        await requested(tx.objectStore('images').put(image))
        return image
      })
    },

    async getJob(id) {
      return read(['jobs'], (tx) => requested(tx.objectStore('jobs').get(id)))
    },

    async putJob(job) {
      object(job, 'Import job')
      string(job.id, 'Import job ID', { empty: false })
      const copy = structuredClone(job)
      return write(['jobs'], async (tx) => {
        await requested(tx.objectStore('jobs').put(copy))
        return copy
      })
    },

    async listJobs() {
      return read(['jobs'], (tx) => requested(tx.objectStore('jobs').getAll()))
    },

    async deleteJob(id) {
      return write(['jobs'], (tx) =>
        requested(tx.objectStore('jobs').delete(id))
      )
    },

    close() {
      database.close()
    },
  }
}
import {
  assignedTagNames,
  reconcileTagCatalog,
  renameTagData,
} from './order-tags.js'
import { upgradeWorkspaceColors } from './appearance.js'
import { lineGrossCents, moneyToCents } from './money.js'
import { purchaseTimestamp } from './order-date.js'
import {
  isPackingPreparationSubset,
  mergePackingPreparation,
  selectPackingOrder,
  selectPackingPreparation,
  validatePackingScope,
} from './packing-backup.js'
import {
  createNameSuggester,
  initializeVocabulary,
  orderNamingSuggestions,
  preparationAuthoring,
  recordNamingEdits,
  refreshPreparationNames,
} from './product-vocabulary.js'
import {
  activePackingState,
  allocatePreparation,
  barcodeValue,
  codeOwnerEvidence,
  extendDefaultPacking,
  mergePackingState,
  packingCheckpoint,
  resetPreparationOrder,
  validateAllocation,
  validateIssuedCode,
  validatePackingPreferences,
  validatePreparation,
  validatePreparationReservations,
} from './packing-model.js'
