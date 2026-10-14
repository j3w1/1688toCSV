const SNAPSHOT_VERSION = 1
const BACKUP_FORMAT = '1688-order-library'
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
  const redPacketDiscount = amounts.redPacketDiscount ?? 0n
  if (
    goodsGross + priceIncludedDiscount !== amounts.goodsGross ||
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

function validateBackup(input) {
  object(input, 'Backup')
  if (input.format !== BACKUP_FORMAT || ![1, 2].includes(input.version))
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
  const state = mergePackingState(allocations, issuedCodes)
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
    validatePreparationReservations(preparation, state)
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
  return { orders, history, images, preparations, ...state, packingPreferences }
}

function validatePreparationMembership(preparation, order, history) {
  if (!order) throw new Error('Preparation is missing its saved order')
  const knownIds = new Set(
    [order, ...history].flatMap((record) =>
      record.snapshot.items.map((item) => item.entryId)
    )
  )
  if (
    preparation.groups.some((group) =>
      group.variants.some((variant) =>
        variant.entryIds.some((entryId) => !knownIds.has(entryId))
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
    const request = globalThis.indexedDB.open(name, 2)
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

  return {
    async saveSnapshot(input) {
      const snapshot = validateSnapshot(input)
      return write(['orders', 'history'], async (tx) => {
        const orders = tx.objectStore('orders')
        const previous = await requested(orders.get(keyFor(snapshot)))
        const result = reconcile(snapshot, previous)
        if (!result.ignored) {
          if (result.changed && previous)
            tx.objectStore('history').put(previous)
          orders.put(result.order)
        }
        return { changed: result.changed, order: result.order }
      })
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
      return write(['orders'], async (tx) => {
        const store = tx.objectStore('orders')
        const order = await requested(store.get([accountId, orderId]))
        if (!order) throw new Error('Order was not found')
        const result = { ...order, notes, tags: uniqueTags }
        store.put(result)
        return result
      })
    },

    async removeOrders(orderIds, { accountId = 'local' } = {}) {
      const ids = strings(orderIds, 'orderIds')
      return write(['orders', 'history', 'preparations'], async (tx) => {
        for (const id of ids) {
          tx.objectStore('orders').delete([accountId, id])
          tx.objectStore('preparations').delete([accountId, id])
          const keys = await requested(
            tx.objectStore('history').index('order').getAllKeys([accountId, id])
          )
          for (const key of keys) tx.objectStore('history').delete(key)
        }
      })
    },

    async exportBackup() {
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
          const orders = await requested(tx.objectStore('orders').getAll())
          const history = await requested(tx.objectStore('history').getAll())
          const images = await requested(tx.objectStore('images').getAll())
          const preparations = await requested(
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
          return {
            format: BACKUP_FORMAT,
            version: 2,
            exportedAt: new Date().toISOString(),
            orders,
            history,
            images,
            preparations,
            allocations,
            issuedCodes,
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
          const issuedCodes = await requested(
            tx.objectStore('issuedCodes').getAll()
          )
          const state = mergePackingState(
            [...allocations, ...backup.allocations],
            [...issuedCodes, ...backup.issuedCodes]
          )
          for (const allocation of state.allocations)
            tx.objectStore('packingAllocations').put(allocation)
          for (const issued of state.issuedCodes)
            tx.objectStore('issuedCodes').put(issued)
          for (const incoming of backup.preparations) {
            const store = tx.objectStore('preparations')
            const previous = await requested(
              store.get([incoming.accountId, incoming.orderId])
            )
            if (!previous) store.put(incoming)
            else if (incoming.updatedAt > previous.updatedAt)
              store.put({
                ...incoming,
                revision: Math.max(incoming.revision, previous.revision) + 1,
              })
            else if (incoming.updatedAt === previous.updatedAt) {
              const { revision: incomingRevision, ...incomingContent } =
                incoming
              const { revision: previousRevision, ...previousContent } =
                previous
              if (
                JSON.stringify(incomingContent) !==
                JSON.stringify(previousContent)
              )
                throw new Error(
                  'Backup conflict: preparation edits have the same timestamp'
                )
            }
          }
          if (backup.packingPreferences) {
            const store = tx.objectStore('packingPreferences')
            const previous = await requested(store.get('packing'))
            if (
              !previous ||
              previous.updatedAt < backup.packingPreferences.updatedAt
            )
              store.put({ id: 'packing', ...backup.packingPreferences })
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
              if (!result.ignored) {
                if (result.changed) {
                  history.put(previous)
                  updated += 1
                }
                orders.put(result.order)
              }
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

    async savePreparation(input, { expectedRevision = input.revision } = {}) {
      const draft = validatePreparation(input)
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        throw new Error(
          'Expected preparation revision must be a non-negative integer'
        )
      return write(
        ['orders', 'preparations', 'packingAllocations', 'issuedCodes'],
        async (tx) => {
          const store = tx.objectStore('preparations')
          const key = [draft.accountId, draft.orderId]
          const previous = await requested(store.get(key))
          if ((previous?.revision ?? 0) !== expectedRevision)
            throw new Error(
              'Preparation changed in another tab. Reload it before saving your edits.'
            )
          const order = await requested(tx.objectStore('orders').get(key))
          if (!order)
            throw new Error('Save the source order before preparing labels')
          const knownIds = new Set([
            ...order.snapshot.items.map((item) => item.entryId),
            ...(previous?.groups.flatMap((group) =>
              group.variants.flatMap((variant) => variant.entryIds)
            ) ?? []),
          ])
          for (const group of draft.groups)
            for (const variant of group.variants)
              if (variant.entryIds.some((entryId) => !knownIds.has(entryId)))
                throw new Error(
                  'Preparation contains an entry missing from this order'
                )
          const allocations = await requested(
            tx.objectStore('packingAllocations').getAll()
          )
          const issuedCodes = await requested(
            tx.objectStore('issuedCodes').getAll()
          )
          const result = allocatePreparation(draft, allocations, issuedCodes)
          const preparation = {
            ...result.preparation,
            revision: expectedRevision + 1,
            updatedAt: new Date(
              Math.max(Date.now(), Date.parse(previous?.updatedAt || 0) + 1)
            ).toISOString(),
          }
          for (const allocation of result.allocations)
            tx.objectStore('packingAllocations').put(allocation)
          for (const issued of result.issuedCodes)
            tx.objectStore('issuedCodes').put(issued)
          store.put(preparation)
          return preparation
        }
      )
    },

    async getPackingPreferences() {
      return read(['packingPreferences'], async (tx) => {
        const preferences = await requested(
          tx.objectStore('packingPreferences').get('packing')
        )
        return preferences?.value ?? validatePackingPreferences()
      })
    },

    async savePackingPreferences(input) {
      const value = validatePackingPreferences(input)
      return write(['packingPreferences'], async (tx) => {
        const store = tx.objectStore('packingPreferences')
        const previous = await requested(store.get('packing'))
        const updatedAt = new Date(
          Math.max(Date.now(), Date.parse(previous?.updatedAt || 0) + 1)
        ).toISOString()
        store.put({ id: 'packing', value, updatedAt })
        return value
      })
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
import { lineGrossCents, moneyToCents } from './money.js'
import { purchaseTimestamp } from './order-date.js'
import {
  allocatePreparation,
  mergePackingState,
  validateAllocation,
  validateIssuedCode,
  validatePackingPreferences,
  validatePreparation,
  validatePreparationReservations,
} from './packing-model.js'
