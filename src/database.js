import {
  otherOrderSnapshot,
  validateOtherPhoto,
  validateOtherSnapshotPhotos,
  assertUniqueOtherReferences,
} from './other-orders.js'

const SNAPSHOT_VERSION = 1
const BACKUP_FORMAT = '1688-order-library'
import {
  OPERATIONS_METADATA_FIELDS,
  validateOperationsMetadata,
  mergeOperations,
  latestStoreWorkflow,
  mergeStoreWorkflow,
} from './operations-workflow.js'
import { createOperationsRepository } from './operations-repository.js'
import {
  validatePaymentLinks,
  mergePaymentLinks,
  validatePaymentGraph,
  paymentSourceDependencies,
} from './payment-links.js'
import { createPaymentLinksRepository } from './payment-links-repository.js'
import {
  validateSharedProducts,
  assertSharedPreparationEdit,
  repeatProductStoreIdentity,
} from './repeat-products.js'
import { createRepeatProductsRepository } from './repeat-products-repository.js'
import {
  editCartonConfirmation,
  validateCartonConfirmationMetadata,
  mergeCartonConfirmations,
} from './carton-confirmations.js'
import { createCartonBatchesRepository } from './carton-batches-repository.js'
import {
  validateCartonBatch,
  createLegacyCartonBatches,
  cartonBatchIssues,
  assertCartonBatchEvidence,
} from './carton-batches.js'
const productAnnotationFields = [
  [
    'productWorkflow',
    'productWorkflowUpdatedAt',
    'productWorkflowPartialClocks',
    'map',
  ],
  ['productTags', 'productTagsUpdatedAt', 'productTagsPartialClocks', 'map'],
  [
    'unitsPerCarton',
    'unitsPerCartonUpdatedAt',
    'unitsPerCartonPartialClocks',
    'map',
  ],
  [
    'cartonDetails',
    'cartonDetailsUpdatedAt',
    'cartonDetailsPartialClocks',
    'map',
  ],
  [
    'packingExcludedEntryIds',
    'packingExclusionsUpdatedAt',
    'packingExclusionsPartialClocks',
    'list',
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
  const other = input.source === 'other'
  if (input.source !== undefined && !['1688', 'other'].includes(input.source))
    throw new Error('Order source must be 1688 or other')
  if (
    other &&
    (input.accountId !== 'local' ||
      input.sourceUrl !== '' ||
      !input.purchasedAt ||
      typeof input.reference !== 'string' ||
      !input.reference.trim() ||
      input.reference.length > 160 ||
      /[\u0000-\u001f]/.test(input.reference) ||
      typeof input.sellerName !== 'string' ||
      input.sellerName.length > 160 ||
      /[\u0000-\u001f]/.test(input.sellerName) ||
      ['sellerMemberLogin', 'sellerShopOrigin', 'sellerUnavailable'].some(
        (key) => Object.hasOwn(input, key)
      ))
  )
    throw new Error(
      'Other-source orders need a supplier, reference and date, with no 1688 source URL or account identity'
    )
  if (input.schemaVersion !== SNAPSHOT_VERSION)
    throw new Error('Unsupported snapshot schema version')
  if (!Array.isArray(input.items) || !input.items.length)
    throw new Error('A complete order must contain product rows')
  const spreadsheet = input.sourceType === 'spreadsheet'
  if (
    input.sourceType !== undefined &&
    !['1688', 'spreadsheet'].includes(input.sourceType)
  )
    throw new Error('Unsupported order source type')
  const items = input.items.map((item) => {
    object(item, 'Product row')
    return {
      entryId: identifier(item.entryId, 'entryId'),
      thumbnail: other
        ? validateOtherPhoto(item.thumbnail)
        : string(item.thumbnail, 'thumbnail'),
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
      ...(spreadsheet ? validateStoreItem(item) : {}),
      ...(!spreadsheet && item.photoEdits !== undefined
        ? { photoEdits: validatePhotoEdits(item.photoEdits, 1) }
        : {}),
      ...(!spreadsheet && item.photos !== undefined
        ? { photos: strings(item.photos, 'Original product photos') }
        : {}),
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
  const storeSource = spreadsheet
    ? validateStoreSource(input.spreadsheet)
    : null
  if (spreadsheet) {
    if (input.sourceUrl !== '')
      throw new Error('Spreadsheet orders do not have a 1688 source URL')
    const rows = new Map(storeSource.rows.map((row) => [row.row, row]))
    const identity = validateStoreIdentity(input.store)
    if (
      input.sellerName !== identity.name ||
      input.sellerMemberLogin !== `store:${identity.key}`
    )
      throw new Error('Spreadsheet seller must match its store identity')
    for (const item of items) {
      const row = rows.get(item.sourceRow)
      if (
        !row ||
        row.group !== item.sourceGroup ||
        row.price !== item.price ||
        [item.sourceDiscount, item.allocatedDiscount, item.discount].some(
          (value) => moneyToCents(value) !== 0n
        )
      )
        throw new Error('Spreadsheet item does not match its source row')
    }
    for (const row of rows.values()) {
      const entries = items.filter((item) => item.sourceRow === row.row)
      if (
        !entries.length ||
        entries.reduce((sum, item) => sum + BigInt(item.quantity), 0n) !==
          BigInt(row.quantity) ||
        entries.filter((item) => item.carton).length !== 1
      )
        throw new Error(
          'Spreadsheet allocations do not reconcile with source rows'
        )
      const carton = entries.find((item) => item.carton).carton
      if (
        ['boxes', 'kg', 'cbm', 'len', 'wid', 'ht'].some(
          (field) => carton[field] !== row[field]
        )
      )
        throw new Error('Spreadsheet carton data does not match its source row')
    }
  }
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
  if (spreadsheet && !purchasedAt)
    throw new Error('Spreadsheet orders require a confirmed purchase date')
  if (input.purchasedAt !== undefined && !purchasedAt)
    throw new Error('purchasedAt must be a valid purchase timestamp')
  return {
    schemaVersion: SNAPSHOT_VERSION,
    accountId: string(input.accountId, 'accountId', { empty: false }),
    orderId,
    sourceUrl: spreadsheet || other ? '' : detailUrl(input.sourceUrl, orderId),
    ...(spreadsheet
      ? {
          sourceType: 'spreadsheet',
          store: validateStoreIdentity(input.store),
          spreadsheet: storeSource,
        }
      : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(other ? { reference: input.reference.trim() } : {}),
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

export function normalizeStoreWechat(value) {
  if (typeof value !== 'string') throw new Error('WeChat ID must be text')
  const id = value.trim()
  if (id.length > 128)
    throw new Error('WeChat ID must be 128 characters or fewer')
  return id
}

/** Source names are editable display data, never proof of a shared store. */
export function storeIdentity(snapshot) {
  return repeatProductStoreIdentity(snapshot)
}

export function mergeStoreWechat(previous, incoming, next = previous) {
  const previousClock = previous.storeWechatUpdatedAt || ''
  const incomingClock = incoming.storeWechatUpdatedAt || ''
  if (
    incomingClock &&
    incomingClock === previousClock &&
    (incoming.storeWechat || '') !== (previous.storeWechat || '')
  )
    throw new Error('Backup conflict: WeChat IDs have the same timestamp')
  if (incomingClock <= previousClock) return next
  const result = { ...next, storeWechatUpdatedAt: incomingClock }
  if (incoming.storeWechat) result.storeWechat = incoming.storeWechat
  else delete result.storeWechat
  return result
}

function latestStoreWechat(records) {
  const newest = records.reduce(
    (result, record) =>
      (record.storeWechatUpdatedAt || '') > (result.storeWechatUpdatedAt || '')
        ? record
        : result,
    {}
  )
  for (const record of records) mergeStoreWechat(newest, record)
  return newest
}

function validateRecord(input, sourceSnapshots = []) {
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
  Object.assign(record, validateOperationsMetadata(input))
  if (input.paymentLinks !== undefined)
    record.paymentLinks = validatePaymentLinks(input.paymentLinks)
  if (input.paymentLinksUpdatedAt !== undefined)
    record.paymentLinksUpdatedAt = date(
      input.paymentLinksUpdatedAt,
      'Payment links updatedAt'
    )
  if (record.paymentLinks?.length && !record.paymentLinksUpdatedAt)
    throw new Error('Payment links require an update timestamp')
  if (input.storeWechat !== undefined) {
    const id = normalizeStoreWechat(input.storeWechat)
    if (id) record.storeWechat = id
  }
  if (input.storeWechatUpdatedAt !== undefined)
    record.storeWechatUpdatedAt = date(
      input.storeWechatUpdatedAt,
      'WeChat ID updatedAt'
    )
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
  if (input.unitsPerCarton !== undefined) {
    object(input.unitsPerCarton, 'Pcs/box')
    record.unitsPerCarton = Object.fromEntries(
      Object.entries(input.unitsPerCarton).map(([entryId, value]) => {
        identifier(entryId, 'Pcs/box entry ID')
        if (!Number.isSafeInteger(value) || value < 1)
          throw new Error('Pcs/box must be a positive whole number')
        return [entryId, value]
      })
    )
  }
  if (input.unitsPerCartonUpdatedAt !== undefined)
    record.unitsPerCartonUpdatedAt = date(
      input.unitsPerCartonUpdatedAt,
      'Pcs/box updatedAt'
    )
  if (input.cartonDetails !== undefined) {
    object(input.cartonDetails, 'Carton details')
    record.cartonDetails = Object.fromEntries(
      Object.entries(input.cartonDetails).map(([entryId, value]) => [
        identifier(entryId, 'Carton entry ID'),
        validateCartonDetails(value),
      ])
    )
  }
  if (input.cartonDetailsUpdatedAt !== undefined)
    record.cartonDetailsUpdatedAt = date(
      input.cartonDetailsUpdatedAt,
      'Carton details updatedAt'
    )
  Object.assign(
    record,
    validateCartonConfirmationMetadata(input, record, sourceSnapshots)
  )
  if (input.additionalCharges !== undefined)
    record.additionalCharges = validateAdditionalCharges(
      input.additionalCharges
    )
  if (input.additionalChargesUpdatedAt !== undefined)
    record.additionalChargesUpdatedAt = date(
      input.additionalChargesUpdatedAt,
      'Additional charges updatedAt'
    )
  if (record.additionalCharges?.length && !record.additionalChargesUpdatedAt)
    throw new Error('Additional charges require an update timestamp')
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
  for (const [field, clock, partial, kind] of productAnnotationFields) {
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
      kind === 'map' ? Object.keys(record[field] || {}) : record[field] || []
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
    /^data:image\/(?:png|jpeg|webp|gif|bmp);base64,[A-Za-z0-9+/]+={0,2}$/
  const local = localImageReference.test(url)
  let allowed = raster.test(url) || local
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
  if (JSON.stringify(image).length > (local ? 32 : 2) * 1024 * 1024)
    throw new Error(`Cached image exceeds the ${local ? 32 : 2} MB limit`)
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
  if (
    previous &&
    (snapshot.source === 'other') !== (previous.snapshot.source === 'other')
  )
    throw new Error(
      'An existing order cannot change between 1688 and another source'
    )
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
      ...Object.fromEntries(
        [...OPERATIONS_METADATA_FIELDS, 'paymentLinks', 'paymentLinksUpdatedAt']
          .filter((field) => previous?.[field] !== undefined)
          .map((field) => [field, previous[field]])
      ),
      ...(previous?.storeWechat ? { storeWechat: previous.storeWechat } : {}),
      ...(previous?.storeWechatUpdatedAt
        ? { storeWechatUpdatedAt: previous.storeWechatUpdatedAt }
        : {}),
      ...Object.fromEntries(
        productAnnotationFields
          .flatMap(([field, clock, partial]) => [field, clock, partial])
          .filter((field) => previous?.[field] !== undefined)
          .map((field) => [field, previous[field]])
      ),
      ...Object.fromEntries(
        ['cartonConfirmations', 'cartonConfirmationClocks']
          .filter((field) => previous?.[field] !== undefined)
          .map((field) => [field, previous[field]])
      ),
      ...(previous?.additionalCharges !== undefined
        ? { additionalCharges: previous.additionalCharges }
        : {}),
      ...(previous?.additionalChargesUpdatedAt
        ? { additionalChargesUpdatedAt: previous.additionalChargesUpdatedAt }
        : {}),
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
  for (const [field, clock, partial, kind] of productAnnotationFields) {
    const previousClock = previous[clock] || ''
    const incomingClock = incoming[clock] || ''
    const completeClock =
      incomingClock > previousClock ? incomingClock : previousClock
    const isMap = kind === 'map'
    let value = structuredClone(previous[field] || (isMap ? {} : []))
    let entryClocks = { ...previous[partial] }
    let changed = false
    const assignEntry = (source, id) => {
      if (isMap) {
        if (
          Object.hasOwn(source[field] || {}, id) &&
          (!Array.isArray(source[field][id]) || source[field][id].length)
        )
          value[id] = structuredClone(source[field][id])
        else delete value[id]
      } else {
        const ids = new Set(value)
        if (source[field]?.includes(id)) ids.add(id)
        else ids.delete(id)
        value = [...ids]
      }
    }
    if (incomingClock > previousClock) {
      value = structuredClone(incoming[field] || (isMap ? {} : []))
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
  if (input.format !== BACKUP_FORMAT || ![1, 2, 3, 4].includes(input.version))
    throw new Error('Unsupported order-library backup')
  date(input.exportedAt, 'exportedAt')
  if (!Array.isArray(input.orders) || !Array.isArray(input.history))
    throw new Error('Backup orders and history must be arrays')
  const sourceSnapshots = new Map()
  for (const record of [...input.orders, ...input.history]) {
    const snapshot = record?.snapshot
    const key = JSON.stringify([snapshot?.accountId, snapshot?.orderId])
    if (!sourceSnapshots.has(key)) sourceSnapshots.set(key, [])
    if (snapshot) sourceSnapshots.get(key).push(snapshot)
  }
  const validatedRecord = (record) =>
    validateRecord(
      record,
      sourceSnapshots.get(
        JSON.stringify([record?.snapshot?.accountId, record?.snapshot?.orderId])
      ) || []
    )
  const orders = input.orders.map(validatedRecord)
  const history = input.history.map(validatedRecord)
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
  assertUniqueOtherReferences(
    orders,
    'Backup contains duplicate other-source supplier references'
  )
  const historyKeys = new Set()
  for (const record of history) {
    const owner = current.get(JSON.stringify(keyFor(record.snapshot)))
    if (!owner || record.snapshot.observedAt >= owner.snapshot.observedAt)
      throw new Error('Backup history must precede its current order')
    if (
      (record.snapshot.source === 'other') !==
      (owner.snapshot.source === 'other')
    )
      throw new Error('Backup history must keep the same order source')
    const key = JSON.stringify([
      ...keyFor(record.snapshot),
      record.snapshot.observedAt,
    ])
    if (historyKeys.has(key))
      throw new Error('Backup contains duplicate history entries')
    historyKeys.add(key)
  }
  validatePaymentGraph(orders)
  if (input.version === 1)
    return {
      orders,
      history,
      images,
      preparations: [],
      allocations: [],
      issuedCodes: [],
      cartonBatches: [],
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
  validateSharedProducts(preparations, { orders, issuedCodes })
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
  if (input.version === 4 && !Array.isArray(input.cartonBatches))
    throw new Error('Backup cartonBatches must be an array')
  const cartonBatches = (
    input.cartonBatches ?? createLegacyCartonBatches(orders, preparations)
  ).map(validateCartonBatch)
  if (
    new Set(cartonBatches.map((batch) => batch.id)).size !==
    cartonBatches.length
  )
    throw new Error('Backup contains duplicate carton batches')
  assertCartonBatchEvidence(cartonBatches, orders, {
    history,
    packingScope: packingScope?.orders,
    preparations: scopedPreparations,
  })
  for (const batch of cartonBatches) {
    if (batch.deletedAt) continue
    const issues = cartonBatchIssues(batch, orders, preparations, cartonBatches)
    if (issues.length) {
      const changedSource = batch.contents.some((item) =>
        orders.some(
          (record) =>
            record.snapshot.accountId === batch.accountId &&
            record.snapshot.orderId === item.orderId &&
            record.snapshot.observedAt > batch.updatedAt
        )
      )
      if (!batch.needsReview && !batch.legacyKeys?.length && !changedSource)
        throw new Error(issues[0])
      batch.needsReview = true
    }
  }
  return {
    orders: orders
      .filter(
        (record) =>
          inPackingScope(record) ||
          packingScope?.dependencies?.some(
            (entry) =>
              entry.accountId === record.snapshot.accountId &&
              entry.orderId === record.snapshot.orderId
          )
      )
      .map((record) =>
        packingScope && inPackingScope(record)
          ? selectPackingOrder(
              record,
              packingScope.orders.find(
                (scope) =>
                  scope.accountId === record.snapshot.accountId &&
                  scope.orderId === record.snapshot.orderId
              ).entryIds,
              preparations.find(
                (preparation) =>
                  preparation.accountId === record.snapshot.accountId &&
                  preparation.orderId === record.snapshot.orderId
              )
            )
          : record
      ),
    history: history.filter(inPackingScope),
    images,
    preparations: scopedPreparations,
    ...state,
    packingPreferences,
    packingScope,
    cartonBatches,
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
    const request = globalThis.indexedDB.open(name, 4)
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
      if (event.oldVersion < 4) {
        const batches = db.createObjectStore('cartonBatches', { keyPath: 'id' })
        batches.createIndex('accountMonth', ['accountId', 'month'])
        // Freeze historical defaults once during the schema upgrade. Later
        // capacity and measurement edits remain proposals until Apply.
        const tx = request.transaction
        void Promise.all([
          requested(tx.objectStore('orders').getAll()),
          requested(tx.objectStore('preparations').getAll()),
        ])
          .then(([records, preparations]) => {
            for (const batch of createLegacyCartonBatches(
              records,
              preparations
            ))
              batches.put(batch)
          })
          .catch((error) => {
            reject(error)
            try {
              tx.abort()
            } catch {
              // A failed request may already have aborted the upgrade.
            }
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
  const cartonBatchesRepository = createCartonBatchesRepository({
    read,
    write,
    requested,
    nextEditTimestamp,
  })

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

  async function sameStoreOrders(tx, record) {
    const identity = storeIdentity(record.snapshot)
    if (!identity) return [record]
    return (
      await requested(
        tx
          .objectStore('orders')
          .index('account')
          .getAll(record.snapshot.accountId)
      )
    ).filter((entry) => storeIdentity(entry.snapshot) === identity)
  }

  async function inheritStoreWechat(tx, record) {
    const siblings = [record, ...(await sameStoreOrders(tx, record))]
    const contact = mergeStoreWechat(record, latestStoreWechat(siblings))
    return mergeStoreWorkflow(contact, latestStoreWorkflow(siblings))
  }

  async function shareRestoredWechat(tx) {
    const store = tx.objectStore('orders')
    const records = await requested(store.getAll())
    const contacts = new Map()
    for (const record of records) {
      const identity = storeIdentity(record.snapshot)
      if (!identity || !record.storeWechatUpdatedAt) continue
      const key = JSON.stringify([record.snapshot.accountId, identity])
      if (!contacts.has(key)) contacts.set(key, [])
      contacts.get(key).push(record)
    }
    for (const [key, entries] of contacts)
      contacts.set(key, latestStoreWechat(entries))
    for (const record of records) {
      const identity = storeIdentity(record.snapshot)
      if (!identity) continue
      const contact = contacts.get(
        JSON.stringify([record.snapshot.accountId, identity])
      )
      if (!contact) continue
      const next = mergeStoreWechat(record, contact)
      if (next !== record) store.put(next)
    }
    for (const record of await requested(store.getAll())) {
      const siblings = await sameStoreOrders(tx, record)
      const next = mergeStoreWorkflow(record, latestStoreWorkflow(siblings))
      if (next !== record) store.put(next)
    }
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

  function validateCartonMeasurementEdits(edits) {
    if (!Array.isArray(edits))
      throw new Error('Carton measurement edits must be an array')
    const seen = new Set()
    return edits.map((edit) => {
      object(edit, 'Carton measurement edit')
      const entryId = identifier(edit.entryId, 'Carton measurement entryId')
      if (seen.has(entryId))
        throw new Error('Edit each product carton measurement only once')
      seen.add(entryId)
      const before = object(edit.before, 'Previous carton measurements')
      const after = object(edit.after, 'New carton measurements')
      const fields = Object.keys(before)
      if (
        !fields.length ||
        fields.some(
          (field) => !['kg', 'cbm', 'len', 'wid', 'ht'].includes(field)
        ) ||
        fields.length !== Object.keys(after).length ||
        fields.some((field) => !Object.hasOwn(after, field))
      )
        throw new Error('Edit matching carton measurement fields only')
      for (const field of fields) {
        string(before[field], `Previous carton ${field}`)
        string(after[field], `New carton ${field}`)
      }
      return {
        entryId,
        before: { ...before },
        after: { ...after },
      }
    })
  }

  // Build a complete validated result before either standalone edits or a
  // preparation/history batch writes it. Comparing only edited effective fields
  // permits unrelated concurrent product edits without overwriting them.
  async function cartonMeasurementResult(tx, orderId, accountId, edits) {
    const order = await requested(
      tx.objectStore('orders').get([accountId, orderId])
    )
    if (!order) throw new Error('Order was not found')
    const cartonDetails = { ...order.cartonDetails }
    const changedIds = []
    for (const { entryId, before, after } of edits) {
      const item = order.snapshot.items.find((item) => item.entryId === entryId)
      if (!item) throw new Error('Product was not found in this order')
      const current = productCartonDetails(item, order)
      const fields = Object.keys(before)
      if (fields.some((field) => (current[field] ?? '') !== before[field])) {
        const error = new Error(
          'Carton measurements changed in another tab. Reload before saving your edits.'
        )
        error.code = 'CARTON_MEASUREMENTS_CONFLICT'
        throw error
      }
      const next = { ...current, ...after }
      const validated = validateCartonDetails(next)
      if (
        fields.some(
          (field) => (current[field] ?? '') !== (validated[field] ?? '')
        )
      ) {
        cartonDetails[entryId] = validated
        changedIds.push(entryId)
      }
    }
    if (!changedIds.length) return { order, changed: false }
    return {
      changed: true,
      order: {
        ...order,
        cartonDetails,
        ...annotationEditClock(order, 'cartonDetails', changedIds),
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
      cartonMeasurements = [],
      cartonBatchChanges = [],
      allowCartonReview = false,
      suffixBaselines = [],
      expectedSnapshots = [],
      allowSharedProductEdits = false,
    } = {}
  ) {
    if (!Array.isArray(inputs) || !inputs.length)
      throw new Error('Choose at least one order to prepare')
    if (!Array.isArray(expectedSnapshots))
      throw new Error('Expected source observations must be an array')
    for (const expected of expectedSnapshots) {
      object(expected, 'Expected source observation')
      string(expected.accountId, 'Expected buyer account', { empty: false })
      identifier(expected.orderId, 'Expected source order ID')
      date(expected.observedAt, 'Expected source observation timestamp')
      if (expected.productFeatures !== undefined)
        object(expected.productFeatures, 'Expected product features')
    }
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
    if (!Array.isArray(suffixBaselines))
      throw new Error('Suffix restoration baselines must be an array')
    const restoredByKey = new Map()
    for (const input of suffixBaselines) {
      const baseline = validatePreparation(input)
      const key = JSON.stringify([baseline.accountId, baseline.orderId])
      if (!selectedKeys.has(key))
        throw new Error(
          'Suffix restoration baseline contains an order outside this preparation batch'
        )
      if (restoredByKey.has(key))
        throw new Error(
          'Provide only one suffix restoration baseline per order'
        )
      restoredByKey.set(key, baseline)
    }
    if (!Array.isArray(cartonMeasurements))
      throw new Error('Carton measurement batches must be an array')
    const measurementKeys = new Set()
    const measurementBatches = cartonMeasurements.map((batch) => {
      object(batch, 'Carton measurement batch')
      const orderId = identifier(batch.orderId, 'Carton measurement orderId')
      const accountId = string(batch.accountId ?? 'local', 'accountId', {
        empty: false,
      })
      const key = JSON.stringify([accountId, orderId])
      if (!selectedKeys.has(key))
        throw new Error(
          'Carton measurements contain an order outside this preparation batch'
        )
      if (measurementKeys.has(key))
        throw new Error(
          'Edit each order carton measurement only once in a batch'
        )
      measurementKeys.add(key)
      return {
        orderId,
        accountId,
        edits: validateCartonMeasurementEdits(batch.edits),
      }
    })
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
      [
        'orders',
        'history',
        'preparations',
        'packingAllocations',
        'issuedCodes',
        'packingPreferences',
        'cartonBatches',
      ],
      async (tx) => {
        const store = tx.objectStore('preparations')
        const preferences = await requested(
          tx.objectStore('packingPreferences').get('packing')
        )
        let allocations = await requested(
          tx.objectStore('packingAllocations').getAll()
        )
        let issuedCodes = await requested(
          tx.objectStore('issuedCodes').getAll()
        )
        const previousPreparations = await requested(store.getAll())
        for (const expected of expectedSnapshots) {
          const order = await requested(
            tx.objectStore('orders').get([expected.accountId, expected.orderId])
          )
          if (!order || order.snapshot.observedAt !== expected.observedAt)
            throw new Error(
              'The source order changed. Review the linked products again.'
            )
          for (const [entryId, features] of Object.entries(
            expected.productFeatures || {}
          )) {
            const signature = (value) =>
              JSON.stringify(
                Object.entries(value || {}).sort(([a], [b]) =>
                  a.localeCompare(b)
                )
              )
            if (
              signature(order.productWorkflow?.[entryId]?.features) !==
              signature(features)
            )
              throw new Error(
                'The source order changed. Review the linked products again.'
              )
          }
        }
        const previousByKey = new Map(
          previousPreparations.map((entry) => [
            JSON.stringify([entry.accountId, entry.orderId]),
            entry,
          ])
        )
        const orders = await requested(tx.objectStore('orders').getAll())
        const ordersByKey = new Map(
          orders.map((order) => [
            JSON.stringify([order.snapshot.accountId, order.snapshot.orderId]),
            order,
          ])
        )
        for (const [index, draft] of drafts.entries()) {
          const previous = previousByKey.get(keys[index])
          if (!allowSharedProductEdits)
            assertSharedPreparationEdit(previous, draft, previousPreparations)
          if ((previous?.revision ?? 0) !== expectedRevisions[index]) {
            const error = new Error(
              'Preparation changed in another tab. Reload it before saving your edits.'
            )
            error.code = 'PACKING_REVISION_CONFLICT'
            error.packingIssue = { orderId: draft.orderId }
            throw error
          }
          const order = ordersByKey.get(keys[index])
          if (!order)
            throw new Error('Save the source order before preparing labels')
          validatePreparationSuffixEdits(draft, previous, {
            snapshot: order.snapshot,
            restored: restoredByKey.get(keys[index]),
            sizeVocabulary: preferences?.value.sizeVocabulary,
          })
        }
        const measurementResults = []
        for (const { orderId, accountId, edits } of measurementBatches)
          measurementResults.push(
            await cartonMeasurementResult(tx, orderId, accountId, edits)
          )
        validateSharedProducts(
          [
            ...previousPreparations.filter(
              (entry) =>
                !selectedKeys.has(
                  JSON.stringify([entry.accountId, entry.orderId])
                )
            ),
            ...drafts,
          ],
          { orders }
        )
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
          const previous = previousByKey.get(keys[index])
          const order = ordersByKey.get(keys[index])
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
        const nextPreparations = previousPreparations
          .filter(
            (entry) =>
              !selectedKeys.has(
                JSON.stringify([entry.accountId, entry.orderId])
              )
          )
          .concat(results)
        const physical = await requested(
          tx.objectStore('cartonBatches').getAll()
        )
        const changedBatchIds = new Set(
          cartonBatchChanges.map(
            (change) => change.after?.id || change.batch?.id
          )
        )
        const affected = physical.filter(
          (batch) =>
            !batch.deletedAt &&
            !batch.needsReview &&
            !changedBatchIds.has(batch.id) &&
            !cartonBatchIssues(batch, orders, previousPreparations, physical)
              .length &&
            cartonBatchIssues(batch, orders, nextPreparations, physical).length
        )
        if (affected.length && !(preview && allowCartonReview)) {
          const error = new Error(
            'Review the affected cartons before changing their products or packing month.'
          )
          error.code = 'CARTON_BATCHES_AFFECTED'
          error.cartonBatches = affected
          throw error
        }
        // No writes occur until every draft, reservation and physical batch has been checked.
        if (!preview) {
          if (cartonBatchChanges.length)
            await cartonBatchesRepository.apply(tx, cartonBatchChanges, {
              records: orders,
              preparations: nextPreparations,
              allowReview: allowCartonReview,
            })
          for (const result of measurementResults)
            if (result.changed) tx.objectStore('orders').put(result.order)
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
    ...cartonBatchesRepository.api,
    ...createOperationsRepository({
      read,
      write,
      requested,
      nextEditTimestamp,
      storeIdentity,
      sameStoreOrders,
      syncTagCatalogs,
      packingPreferencesFor,
      annotationEditClock,
    }),
    ...createPaymentLinksRepository({
      read,
      write,
      requested,
      nextEditTimestamp,
      annotationEditClock,
    }),
    ...createRepeatProductsRepository({
      read,
      write,
      requested,
      savePreparations,
      replaceActiveCodes,
      storeIdentity,
    }),
    async importStoreOrder(input) {
      const random = new Uint32Array(2)
      crypto.getRandomValues(random)
      const orderId = `9${Date.now()}${String(random[0]).padStart(10, '0')}${String(random[1]).padStart(10, '0')}`
      const prepared = await createStoreOrder(input, { orderId })
      const snapshot = validateSnapshot(prepared.snapshot)
      const images = prepared.images.map(validateImage)
      return write(['orders', 'images', 'packingPreferences'], async (tx) => {
        const orders = tx.objectStore('orders')
        if (await requested(orders.get(keyFor(snapshot))))
          throw new Error('Import identity collision; retry this import')
        let record = reconcile(snapshot).order
        record = await inheritStoreWechat(tx, record)
        record.unitsPerCarton = prepared.unitsPerCarton
        record.unitsPerCartonUpdatedAt = snapshot.observedAt
        const preferences = await packingPreferencesFor(tx)
        record.namingSuggestions = orderNamingSuggestions(
          snapshot,
          createNameSuggester(preferences.vocabulary)
        )
        for (const image of images) tx.objectStore('images').put(image)
        orders.add(record)
        return record
      })
    },

    async renameStore(orderId, name, { accountId = 'local' } = {}) {
      string(name, 'Store name', { empty: false })
      return write(['orders'], async (tx) => {
        const store = tx.objectStore('orders')
        const order = await requested(store.get([accountId, orderId]))
        if (order?.snapshot.sourceType !== 'spreadsheet')
          throw new Error('Only imported store names can be edited')
        const records = await requested(
          store.index('account').getAll(accountId)
        )
        for (const record of records) {
          if (
            record.snapshot.sourceType !== 'spreadsheet' ||
            record.snapshot.store.key !== order.snapshot.store.key
          )
            continue
          record.snapshot.sellerName = name.trim()
          record.snapshot.store.name = name.trim()
          record.revision++
          record.snapshot.observedAt = nextEditTimestamp(
            record.snapshot.observedAt
          )
          record.changedAt = record.snapshot.observedAt
          record.lastCheckedAt = record.snapshot.observedAt
          store.put(record)
        }
        return requested(store.get([accountId, orderId]))
      })
    },

    async setStoreWechat(orderId, wechatId, { accountId = 'local' } = {}) {
      identifier(orderId, 'WeChat orderId')
      string(accountId, 'accountId', { empty: false })
      const id = normalizeStoreWechat(wechatId)
      return write(['orders'], async (tx) => {
        const store = tx.objectStore('orders')
        const order = await requested(store.get([accountId, orderId]))
        if (!order) throw new Error('Order was not found')
        const records = await sameStoreOrders(tx, order)
        if (records.every((record) => (record.storeWechat || '') === id))
          return order
        const timestamp = nextEditTimestamp(
          records
            .map((record) => record.storeWechatUpdatedAt || '')
            .sort()
            .at(-1)
        )
        for (const record of records) {
          const next = { ...record, storeWechatUpdatedAt: timestamp }
          if (id) next.storeWechat = id
          else delete next.storeWechat
          store.put(next)
        }
        return requested(store.get([accountId, orderId]))
      })
    },

    async setCartonDetails(
      orderId,
      entryId,
      details,
      { accountId = 'local' } = {}
    ) {
      const value = validateCartonDetails(details)
      return write(['orders'], async (tx) => {
        const store = tx.objectStore('orders'),
          order = await requested(store.get([accountId, orderId]))
        if (!order?.snapshot.items.some((item) => item.entryId === entryId))
          throw new Error('Product was not found in this order')
        const result = {
          ...order,
          cartonDetails: { ...order.cartonDetails, [entryId]: value },
          ...annotationEditClock(order, 'cartonDetails', [entryId]),
        }
        store.put(result)
        return result
      })
    },

    async createOtherOrder(input) {
      const snapshot = validateSnapshot(otherOrderSnapshot(input))
      await validateOtherSnapshotPhotos(snapshot)
      return write(['orders', 'packingPreferences'], async (tx) => {
        const orders = tx.objectStore('orders')
        const existing = await requested(orders.getAll())
        assertUniqueOtherReferences([...existing, { snapshot }])
        if (await requested(orders.getKey(keyFor(snapshot))))
          throw new Error(
            'The new internal order ID is already used; try again'
          )
        const result = reconcile(snapshot)
        const preferences = await packingPreferencesFor(tx)
        result.order.namingSuggestions = orderNamingSuggestions(
          snapshot,
          createNameSuggester(preferences.vocabulary)
        )
        orders.add(result.order)
        return result
      })
    },

    async setCartonMeasurements(orderId, edits, { accountId = 'local' } = {}) {
      identifier(orderId, 'Carton measurement orderId')
      string(accountId, 'accountId', { empty: false })
      const validated = validateCartonMeasurementEdits(edits)
      return write(['orders'], async (tx) => {
        const result = await cartonMeasurementResult(
          tx,
          orderId,
          accountId,
          validated
        )
        if (result.changed) tx.objectStore('orders').put(result.order)
        return result.order
      })
    },

    async setAdditionalCharges(orderId, charges, { accountId = 'local' } = {}) {
      const value = validateAdditionalCharges(charges)
      return write(['orders'], async (tx) => {
        const store = tx.objectStore('orders')
        const order = await requested(store.get([accountId, orderId]))
        if (!order) throw new Error('Order was not found')
        const result = {
          ...order,
          additionalCharges: value,
          additionalChargesUpdatedAt: nextEditTimestamp(
            order.additionalChargesUpdatedAt
          ),
        }
        orderCostAdjustments(result)
        store.put(result)
        return result
      })
    },

    async setProductPhoto(
      orderId,
      entryId,
      { photoIndex = 0, thumbnail, edit, originalPhoto },
      { accountId = 'local' } = {}
    ) {
      if (
        thumbnail !== undefined &&
        (typeof thumbnail !== 'string' ||
          !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
            thumbnail
          ) ||
          thumbnail.length > 2_000_000)
      )
        throw new Error('Edited photo thumbnail is invalid')
      return write(['orders'], async (tx) => {
        const store = tx.objectStore('orders'),
          order = await requested(store.get([accountId, orderId]))
        const item = order?.snapshot.items.find(
          (entry) => entry.entryId === entryId
        )
        if (
          !item ||
          !Number.isInteger(photoIndex) ||
          photoIndex < 0 ||
          photoIndex >= (item.photos?.length || 1)
        )
          throw new Error('Product photo was not found')
        if (
          originalPhoto !== undefined &&
          originalPhoto !== (item.photos?.[photoIndex] || item.thumbnail)
        )
          throw new Error(
            'The source photo changed. Reopen the photo before editing it.'
          )
        if (!item.photos) item.photos = [item.thumbnail]
        if (edit !== undefined)
          item.photoEdits = validatePhotoEdits(
            { ...item.photoEdits, [photoIndex]: edit },
            item.photos?.length || 1
          )
        if (thumbnail !== undefined && photoIndex === 0)
          item.thumbnail = thumbnail
        order.revision++
        order.snapshot.observedAt = nextEditTimestamp(order.snapshot.observedAt)
        order.changedAt = order.snapshot.observedAt
        order.lastCheckedAt = order.snapshot.observedAt
        store.put(order)
        return order
      })
    },

    async saveSnapshot(input) {
      if (input?.source === 'other')
        throw new Error('Create other-source orders through order entry')
      const snapshot = validateSnapshot(input)
      return write(
        ['orders', 'history', 'preparations', 'packingPreferences'],
        async (tx) => {
          const orders = tx.objectStore('orders')
          const previous = await requested(orders.get(keyFor(snapshot)))
          if (snapshot.sourceType !== 'spreadsheet') {
            for (const item of snapshot.items) {
              const saved = previous?.snapshot.items.find(
                (entry) => entry.entryId === item.entryId
              )
              if (saved?.photoEdits && saved.photos?.[0] === item.thumbnail) {
                item.photos = saved.photos
                item.photoEdits = saved.photoEdits
                item.thumbnail = saved.thumbnail
              }
            }
          }
          const result = reconcile(snapshot, previous)
          if (!result.ignored) {
            result.order = await inheritStoreWechat(tx, result.order)
            const preferences = await packingPreferencesFor(tx)
            const suggest = createNameSuggester(preferences.vocabulary)
            if (result.changed && previous)
              tx.objectStore('history').put(historicalRecord(previous))
            result.order.namingSuggestions = orderNamingSuggestions(
              result.order.snapshot,
              suggest
            )
            orders.put(result.order)
            validatePaymentGraph(await requested(orders.getAll()))
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

    async setCartonConfirmation(
      orderId,
      entryId,
      month,
      field,
      value,
      { accountId = 'local' } = {}
    ) {
      identifier(orderId, 'Order ID')
      identifier(entryId, 'Carton confirmation entry ID')
      return write(['orders'], async (tx) => {
        const store = tx.objectStore('orders')
        const order = await requested(store.get([accountId, orderId]))
        if (!order) throw new Error('Order was not found')
        const edited = editCartonConfirmation(
          order,
          entryId,
          month,
          field,
          value
        )
        if (
          JSON.stringify(order.cartonConfirmations || {}) ===
            JSON.stringify(edited.cartonConfirmations) &&
          order.cartonConfirmationClocks?.[edited.entryId]?.[month]
        )
          return order
        const result = {
          ...order,
          cartonConfirmations: edited.cartonConfirmations,
          cartonConfirmationClocks: {
            ...order.cartonConfirmationClocks,
            [edited.entryId]: {
              ...order.cartonConfirmationClocks?.[edited.entryId],
              [month]: nextEditTimestamp(
                order.cartonConfirmationClocks?.[edited.entryId]?.[month]
              ),
            },
          },
        }
        store.put(result)
        return result
      })
    },

    async setUnitsPerCarton(
      orderId,
      entryId,
      value,
      { accountId = 'local' } = {}
    ) {
      identifier(orderId, 'Order ID')
      identifier(entryId, 'Pcs/box entry ID')
      const capacity = normalizeUnitsPerCarton(value)
      return write(['orders'], async (tx) => {
        const store = tx.objectStore('orders')
        const order = await requested(store.get([accountId, orderId]))
        if (!order) throw new Error('Order was not found')
        if (
          !order.snapshot.items.some((item) => item.entryId === entryId) &&
          !Object.hasOwn(order.unitsPerCarton || {}, entryId)
        )
          throw new Error('Product was not found in this order')
        if (
          (order.unitsPerCarton?.[entryId] ?? null) === capacity &&
          (order.unitsPerCartonUpdatedAt ||
            order.unitsPerCartonPartialClocks?.[entryId])
        )
          return order
        const unitsPerCarton = { ...order.unitsPerCarton }
        if (capacity === null) delete unitsPerCarton[entryId]
        else unitsPerCarton[entryId] = capacity
        const result = {
          ...order,
          unitsPerCarton,
          ...annotationEditClock(order, 'unitsPerCarton', [entryId]),
        }
        store.put(result)
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
        validatePaymentGraph(await requested(store.getAll()))
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
          'cartonBatches',
          'images',
        ],
        async (tx) => {
          const allOrders = await requested(tx.objectStore('orders').getAll())
          const removed = new Set(ids)
          const cartonBatches = await requested(
            tx.objectStore('cartonBatches').getAll()
          )
          if (
            cartonBatches.some(
              (batch) =>
                batch.accountId === accountId &&
                !batch.deletedAt &&
                (batch.contents.some((item) => removed.has(item.orderId)) ||
                  batch.groups.some((group) => removed.has(group.orderId)) ||
                  (batch.mark && removed.has(batch.mark.orderId)))
            )
          )
            throw new Error(
              'Remove this order’s active carton batches before deleting it.'
            )
          for (const record of allOrders)
            if (
              record.snapshot.accountId === accountId &&
              removed.has(record.snapshot.orderId)
            )
              if (
                (record.paymentLinks || []).some(
                  (link) => !removed.has(link.sourceOrderId)
                )
              )
                throw new Error(
                  'Unlink this order’s payments before deleting it. The payment sources will stay in the library.'
                )
          validatePaymentGraph(
            allOrders.filter(
              (record) =>
                record.snapshot.accountId !== accountId ||
                !removed.has(record.snapshot.orderId)
            )
          )
          const previousRecords = []
          const deletedRecords = []
          for (const id of ids) {
            const record = await requested(
              tx.objectStore('orders').get([accountId, id])
            )
            if (record) {
              previousRecords.push(record)
              deletedRecords.push(record)
            }
            tx.objectStore('orders').delete([accountId, id])
            tx.objectStore('preparations').delete([accountId, id])
            const history = await requested(
              tx.objectStore('history').index('order').getAll([accountId, id])
            )
            deletedRecords.push(...history)
            for (const entry of history)
              tx.objectStore('history').delete([
                ...keyFor(entry.snapshot),
                entry.snapshot.observedAt,
              ])
          }
          const localPhotos = (records) =>
            new Set(
              records
                .flatMap(({ snapshot }) => [
                  ...snapshot.items.flatMap((item) => [
                    item.thumbnail,
                    ...(item.photos || []),
                  ]),
                  ...(snapshot.spreadsheet?.rows || []).flatMap(
                    (row) => row.photos || []
                  ),
                ])
                .filter((photo) => localImageReference.test(photo))
            )
          const candidates = localPhotos(deletedRecords)
          if (candidates.size) {
            // Only collect assets owned by the removed orders. Other cached
            // photos stay intact, and another order/history can share an original.
            const retained = localPhotos([
              ...(await requested(tx.objectStore('orders').getAll())),
              ...(await requested(tx.objectStore('history').getAll())),
            ])
            for (const photo of candidates)
              if (!retained.has(photo)) tx.objectStore('images').delete(photo)
          }
          await syncTagCatalogs(tx, await packingPreferencesFor(tx), {
            previousRecords,
            touch: true,
          })
          await replaceActiveCodes(tx)
        }
      )
    },

    async exportBackup({ orderIds, accountId = 'local', packingScope } = {}) {
      const includedIds =
        orderIds === undefined
          ? null
          : new Set(
              strings(orderIds, 'Backup order IDs').map((id) =>
                identifier(id, 'Backup order ID')
              )
            )
      return write(
        [
          'orders',
          'history',
          'images',
          'preparations',
          'packingAllocations',
          'issuedCodes',
          'packingPreferences',
          'cartonBatches',
        ],
        async (tx) => {
          const physical = await cartonBatchesRepository.seed(tx)
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
            const dependencies = paymentSourceDependencies(
              orders,
              orders.filter(
                (entry) =>
                  entry.snapshot.accountId === accountId &&
                  includedIds.has(entry.snapshot.orderId)
              )
            )
            for (const record of dependencies)
              includedIds.add(record.snapshot.orderId)
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
                entry.snapshot.items.flatMap((item) => [
                  item.thumbnail,
                  ...(item.photos || []),
                ])
              ),
              ...issuedCodes
                .filter(included)
                .flatMap((entry) => entry.ownerSnapshot?.photos || []),
            ])
            images = images.filter((entry) => photoUrls.has(entry.url))
          }
          const backup = {
            format: BACKUP_FORMAT,
            version: 4,
            exportedAt: new Date().toISOString(),
            orders,
            history,
            images,
            preparations,
            cartonBatches: physical.batches.filter(
              (batch) =>
                !includedIds ||
                (batch.accountId === accountId &&
                  batch.contents.every((item) => includedIds.has(item.orderId)))
            ),
            ...activePackingState(preparations, allocations, issuedCodes),
            packingPreferences: preferences
              ? { value: preferences.value, updatedAt: preferences.updatedAt }
              : null,
          }
          // Scope physical cartons only after the packing planner has seen
          // every intersecting batch, so omitted linked purchases are reported.
          return packingScope
            ? createPackingBackup(
                { ...backup, cartonBatches: physical.batches },
                packingScope
              )
            : backup
        }
      )
    },

    async restoreBackup(input) {
      // Validate every record before opening a write transaction. A malformed
      // trailing record must never leave a partially restored library.
      const backup = validateBackup(input)
      for (const record of [...backup.orders, ...backup.history])
        await validateOtherSnapshotPhotos(record.snapshot)
      return write(
        [
          'orders',
          'history',
          'images',
          'preparations',
          'packingAllocations',
          'issuedCodes',
          'packingPreferences',
          'cartonBatches',
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
              // Packing restores merge selected capacity observations. Existing
              // local tags/exclusions retain their established restore policy.
              // Full restores fill partial observations without undoing newer edits.
              next = mergeProductAnnotations(
                previous,
                backup.packingScope
                  ? Object.fromEntries(
                      productAnnotationFields
                        .filter(([field]) =>
                          [
                            'unitsPerCarton',
                            'cartonDetails',
                            'productWorkflow',
                          ].includes(field)
                        )
                        .flatMap(([field, clock, partial]) => [
                          field,
                          clock,
                          partial,
                        ])
                        .filter((field) => incoming[field] !== undefined)
                        .map((field) => [field, incoming[field]])
                    )
                  : incoming,
                next
              )
              next = mergeAdditionalCharges(previous, incoming, next)
              next = mergeCartonConfirmations(previous, incoming, next)
              next = mergeStoreWechat(previous, incoming, next)
              next = mergeOperations(previous, incoming, next)
              next = mergePaymentLinks(previous, incoming, next)
              if (next !== previous) orders.put(next)
              // An older backup's current version is still useful history.
              if (incoming.snapshot.observedAt < previous.snapshot.observedAt) {
                const historyKey = [...key, incoming.snapshot.observedAt]
                if (!(await requested(history.getKey(historyKey))))
                  history.put(incoming)
              }
            }
          }
          // Reconciliation can keep a newer local snapshot. Validate the actual
          // final records, not a projection which assumes incoming ids replace it.
          assertUniqueOtherReferences(await requested(orders.getAll()))
          // Physical allocations may depend on an older source quantity. Make
          // its evidence visible to merged-batch validation in this transaction.
          for (const record of backup.history) {
            const key = [...keyFor(record.snapshot), record.snapshot.observedAt]
            if (!(await requested(history.getKey(key)))) history.put(record)
          }
          await cartonBatchesRepository.restore(tx, backup.cartonBatches || [])
          await shareRestoredWechat(tx)
          const mergedOrders = await requested(orders.getAll())
          validatePaymentGraph(mergedOrders)
          validateSharedProducts(
            await requested(tx.objectStore('preparations').getAll()),
            { orders: mergedOrders }
          )
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
            for (const dependency of backup.packingScope.dependencies || [])
              restoredOrders.push(
                await requested(
                  orders.get([dependency.accountId, dependency.orderId])
                )
              )
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
            const activeReservation = await requested(
              tx.objectStore('issuedCodes').get([accountId, kind, code])
            )
            if (!activeReservation) continue
            for (const reservation of codeReservationMembers(
              activeReservation
            )) {
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
                ...(activeReservation.sharedProductId
                  ? { sharedProductId: activeReservation.sharedProductId }
                  : {}),
              })
            }
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
import { normalizeUnitsPerCarton } from './carton-packing.js'
import { productCartonDetails } from './carton-details.js'
import {
  validateAdditionalCharges,
  mergeAdditionalCharges,
  orderCostAdjustments,
} from './order-charges.js'
import { localImageReference } from './images.js'
import {
  createStoreOrder,
  validateStoreIdentity,
  validateStoreSource,
  validateStoreItem,
  validatePhotoEdits,
  validateCartonDetails,
} from './store-order.js'
import {
  createPackingBackup,
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
  codeReservationMembers,
  extendDefaultPacking,
  mergePackingState,
  packingCheckpoint,
  resetPreparationOrder,
  validateAllocation,
  validateIssuedCode,
  validatePackingPreferences,
  validatePreparation,
  validatePreparationSuffixEdits,
  validatePreparationReservations,
} from './packing-model.js'
