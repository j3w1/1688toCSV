import { centsToMoney, lineGrossCents, moneyToCents } from './money.js'
import { localImageAsset } from './images.js'
import {
  validatePhotoVariantTags,
  validatePhotoTagScale,
} from './product-photo.js'

const positiveDecimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/
const whole = /^[1-9]\d*$/
const cartonFields = [
  'boxes',
  'perbox',
  'quantity',
  'price',
  'amount',
  'kg',
  'cbm',
  'sourceCbm',
  'len',
  'wid',
  'ht',
]

function text(value, label) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} is required`)
  return value.trim()
}

function decimal(value, label, { integer = false, positive = false } = {}) {
  const result = String(value ?? '')
  if (
    !(integer ? whole : positiveDecimal).test(result) ||
    (positive && Number(result) <= 0) ||
    (integer && !Number.isSafeInteger(Number(result)))
  )
    throw new Error(
      `${label} must be a ${integer ? 'positive whole number' : 'nonnegative decimal'}`
    )
  return result
}

export function validateStoreIdentity(value) {
  if (!value || typeof value !== 'object')
    throw new Error('Store identity is required')
  const kind = value.kind === 'futian' ? 'market' : value.kind
  if (!['market', 'factory'].includes(kind))
    throw new Error('Store kind must be market or factory')
  const number =
    value.number === undefined || value.number === ''
      ? ''
      : text(String(value.number), 'Store number')
  if (
    (kind === 'market' && !/^\d+$/.test(number)) ||
    (kind === 'factory' && number)
  )
    throw new Error('Only market stores have a numeric store number')
  return {
    key: text(value.key, 'Store key'),
    name: text(value.name, 'Store name'),
    number,
    kind,
  }
}

export function validateStoreSource(value) {
  if (!value || typeof value !== 'object')
    throw new Error('Spreadsheet source is required')
  if (!Array.isArray(value.rows) || !value.rows.length)
    throw new Error('Spreadsheet source rows are required')
  const seen = new Set()
  const rows = value.rows.map((row) => {
    if (!Number.isSafeInteger(row.row) || row.row < 1 || seen.has(row.row))
      throw new Error('Spreadsheet source row must be unique and positive')
    seen.add(row.row)
    const result = {
      row: row.row,
      group: text(String(row.group ?? ''), 'Source group'),
    }
    for (const field of cartonFields) {
      if (row[field] === undefined || row[field] === null || row[field] === '')
        continue
      result[field] = decimal(row[field], `Source row ${row.row} ${field}`, {
        integer: ['boxes', 'perbox', 'quantity'].includes(field),
        positive: ['len', 'wid', 'ht'].includes(field),
      })
    }
    if (!result.boxes || !result.quantity || result.price === undefined)
      throw new Error('Spreadsheet rows require boxes, quantity and price')
    if (
      result.perbox &&
      BigInt(result.boxes) * BigInt(result.perbox) !== BigInt(result.quantity)
    )
      throw new Error(`Source row ${row.row} quantities do not reconcile`)
    if (
      result.amount !== undefined &&
      moneyToCents(result.amount) !==
        lineGrossCents(result.price, result.quantity)
    )
      throw new Error(`Source row ${row.row} amount does not reconcile`)
    const dimensions = ['len', 'wid', 'ht'].filter(
      (field) => result[field] !== undefined
    )
    if (dimensions.length && dimensions.length !== 3)
      throw new Error('Carton dimensions require length, width and height')
    return result
  })
  const importedAt = new Date(value.importedAt)
  if (!Number.isFinite(importedAt.getTime()))
    throw new Error('Spreadsheet import timestamp is invalid')
  const total = decimal(value.total, 'Spreadsheet control total')
  if (
    moneyToCents(total) !==
    rows.reduce((sum, row) => sum + lineGrossCents(row.price, row.quantity), 0n)
  )
    throw new Error(
      'Spreadsheet control total does not reconcile with its source rows'
    )
  return {
    filename: text(value.filename, 'Spreadsheet filename'),
    sheetName: text(value.sheetName, 'Spreadsheet sheet'),
    importedAt: importedAt.toISOString(),
    total,
    rows,
  }
}

export function validateStoreItem(item) {
  const sourceGroup = text(item.sourceGroup, 'Source group')
  if (!Number.isSafeInteger(item.sourceRow) || item.sourceRow < 1)
    throw new Error('Product source row is invalid')
  if (
    !Array.isArray(item.photos) ||
    !item.photos.length ||
    item.photos.some((photo) => !/^local-image:[a-f0-9]{64}$/.test(photo))
  )
    throw new Error('Spreadsheet product requires original local photos')
  const result = {
    sourceGroup,
    sourceRow: item.sourceRow,
    photos: [...item.photos],
  }
  for (const field of ['sourceVariant', 'sourceSize']) {
    if (item[field] !== undefined) result[field] = text(item[field], field)
  }
  if (item.carton !== undefined) {
    if (!item.carton || typeof item.carton !== 'object')
      throw new Error('Product carton data is invalid')
    result.carton = {}
    for (const field of ['boxes', 'kg', 'cbm', 'len', 'wid', 'ht']) {
      if (item.carton[field] !== undefined)
        result.carton[field] = decimal(item.carton[field], `Carton ${field}`, {
          integer: field === 'boxes',
        })
    }
  }
  if (item.photoEdits !== undefined)
    result.photoEdits = validatePhotoEdits(item.photoEdits, item.photos.length)
  return result
}

export function validatePhotoEdits(edits, count) {
  if (!edits || typeof edits !== 'object' || Array.isArray(edits))
    throw new Error('Photo edits are invalid')
  return Object.fromEntries(
    Object.entries(edits).map(([index, edit]) => {
      if (
        !/^\d+$/.test(index) ||
        Number(index) >= count ||
        !edit ||
        typeof edit !== 'object'
      )
        throw new Error('Photo edit index is invalid')
      const result = {}
      if (edit.fit !== undefined) {
        if (!['contain', 'cover'].includes(edit.fit))
          throw new Error('Photo fit is invalid')
        result.fit = edit.fit
      }
      for (const field of ['scale', 'x', 'y']) {
        if (edit[field] === undefined) continue
        if (
          !Number.isFinite(edit[field]) ||
          (field === 'scale' && (edit[field] <= 0 || edit[field] > 10)) ||
          (field !== 'scale' && Math.abs(edit[field]) > 10)
        )
          throw new Error('Photo transform is invalid')
        result[field] = edit[field]
      }
      if (edit.background !== undefined) {
        if (!/^#[a-f\d]{6}$/i.test(edit.background))
          throw new Error('Photo background is invalid')
        result.background = edit.background
      }
      if (edit.tags !== undefined)
        result.tags = validatePhotoVariantTags(edit.tags)
      if (edit.tagScale !== undefined)
        result.tagScale = validatePhotoTagScale(edit.tagScale)
      return [index, result]
    })
  )
}

export function validateCartonDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Carton details are invalid')
  const result = {}
  for (const field of ['boxes', 'kg', 'cbm', 'len', 'wid', 'ht']) {
    if (
      value[field] === undefined ||
      value[field] === null ||
      value[field] === ''
    )
      continue
    result[field] = decimal(value[field], `Carton ${field}`, {
      integer: field === 'boxes',
      positive: ['len', 'wid', 'ht'].includes(field),
    })
  }
  const dimensions = ['len', 'wid', 'ht'].filter(
    (field) => result[field] !== undefined
  )
  if (dimensions.length && dimensions.length !== 3)
    throw new Error('Carton dimensions require length, width and height')
  return result
}

/** Build and validate everything before an IndexedDB write transaction is opened. */
export async function createStoreOrder(
  input,
  { now = new Date().toISOString(), orderId } = {}
) {
  const store = validateStoreIdentity(input.store)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate || '') ||
    new Date(`${input.purchaseDate}T12:00:00Z`).toISOString().slice(0, 10) !==
      input.purchaseDate
  )
    throw new Error('Confirm a valid purchase date before importing')
  if (!Array.isArray(input.rows) || !input.rows.length)
    throw new Error('Choose product rows to import')
  if (input.total === undefined || input.total === null || input.total === '')
    throw new Error('Confirm the marked whole-order total before importing')
  const source = validateStoreSource({
    filename: input.filename,
    sheetName: input.sheetName,
    importedAt: now,
    total: input.total,
    rows: input.rows,
  })
  const images = new Map(),
    originalAssets = new Map(),
    items = [],
    unitsPerCarton = {}
  let sequence = 1
  for (let index = 0; index < input.rows.length; index++) {
    const row = input.rows[index],
      evidence = source.rows[index]
    if (!Array.isArray(row.photos) || !row.photos.length)
      throw new Error(`Row ${row.row} is missing a linked photo`)
    const photos = []
    for (const photo of row.photos) {
      let asset = originalAssets.get(photo)
      if (!asset) {
        asset = await localImageAsset(photo, now)
        originalAssets.set(photo, asset)
      }
      images.set(asset.url, asset)
      if (!photos.includes(asset.url)) photos.push(asset.url)
    }
    const declarations = row.variants || []
    const allocations =
      row.variantAllocations ||
      (declarations.length <= 1
        ? [{ ...(declarations[0] || {}), quantity: evidence.quantity }]
        : [])
    if (
      !allocations.length ||
      allocations.reduce(
        (sum, entry) =>
          sum +
          BigInt(
            decimal(entry.quantity, 'Variant quantity', { integer: true })
          ),
        0n
      ) !== BigInt(evidence.quantity)
    )
      throw new Error(
        `Row ${row.row} variant quantities must add up to the source quantity`
      )
    if (
      declarations.length > 1 &&
      (allocations.length !== declarations.length ||
        declarations.some(
          (entry) =>
            !allocations.some(
              (allocation) =>
                (allocation.variant || '') === (entry.variant || '') &&
                (allocation.size || '') === (entry.size || '')
            )
        ))
    )
      throw new Error(`Row ${row.row} must allocate every declared variant`)
    let allocationGross = 0n
    for (
      let allocationIndex = 0;
      allocationIndex < allocations.length;
      allocationIndex++
    ) {
      const allocation = allocations[allocationIndex],
        entryId = String(sequence++)
      const quantity = decimal(allocation.quantity, 'Variant quantity', {
        integer: true,
      })
      const description = text(
        row.description ||
          row.title ||
          row.productNumber ||
          `Group ${row.group}`,
        'Product description'
      )
      const item = {
        entryId,
        thumbnail: row.thumbnail || row.photos[0],
        photos,
        title: String(row.title || row.description || `Group ${row.group}`),
        description,
        ...(row.productNumber
          ? { productNumber: String(row.productNumber) }
          : {}),
        sourceGroup: evidence.group,
        sourceRow: evidence.row,
        ...(allocation.variant
          ? { sourceVariant: String(allocation.variant).toUpperCase() }
          : {}),
        ...(allocation.size
          ? { sourceSize: String(allocation.size).toUpperCase() }
          : {}),
        ...(row.photoEdits
          ? { photoEdits: validatePhotoEdits(row.photoEdits, photos.length) }
          : {}),
        price: evidence.price,
        quantity,
        sourceDiscount: '0.00',
        allocatedDiscount: '0.00',
        discount: '0.00',
        ...(allocationIndex === 0
          ? {
              carton: Object.fromEntries(
                ['boxes', 'kg', 'cbm', 'len', 'wid', 'ht']
                  .filter((field) => evidence[field] !== undefined)
                  .map((field) => [field, evidence[field]])
              ),
            }
          : {}),
      }
      const sourceProperties = (row.skuProperties || []).map((property) => {
        if (typeof property?.label !== 'string')
          throw new Error('Source SKU label is invalid')
        return {
          label: property.label,
          value: text(property.value, 'Source SKU property'),
          ...(property.raw !== undefined ? { raw: String(property.raw) } : {}),
        }
      })
      const combinedProperties = [
        ...sourceProperties,
        ...(allocation.variant
          ? [
              {
                label: 'Variant',
                value: String(allocation.variant).toUpperCase(),
              },
            ]
          : []),
        ...(allocation.size
          ? [{ label: 'Size', value: String(allocation.size).toUpperCase() }]
          : []),
      ]
      item.skuProperties = combinedProperties.filter(
        (property, propertyIndex) =>
          combinedProperties.findIndex(
            (candidate) =>
              candidate.label === property.label &&
              candidate.value === property.value
          ) === propertyIndex
      )
      validateStoreItem(item)
      items.push(item)
      allocationGross += lineGrossCents(item.price, item.quantity)
      if (evidence.perbox) unitsPerCarton[entryId] = Number(evidence.perbox)
    }
    if (allocationGross !== lineGrossCents(evidence.price, evidence.quantity))
      throw new Error(
        `Row ${row.row} split amounts need review because fractional-cent rounding changes its total`
      )
  }
  const gross = items.reduce(
    (sum, item) => sum + lineGrossCents(item.price, item.quantity),
    0n
  )
  if (input.total !== undefined && moneyToCents(String(input.total)) !== gross)
    throw new Error('Order total does not reconcile with product amounts')
  const amount = centsToMoney(gross)
  return {
    snapshot: {
      schemaVersion: 1,
      accountId: input.accountId || 'local',
      orderId,
      sourceType: 'spreadsheet',
      sourceUrl: '',
      store,
      spreadsheet: source,
      sellerName: store.name,
      sellerMemberLogin: `store:${store.key}`,
      status: 'Imported',
      observedAt: now,
      purchasedAt: `${input.purchaseDate}T12:00:00+08:00`,
      items,
      totals: {
        goodsGross: amount,
        shipping: '0.00',
        sourceDiscount: '0.00',
        orderAdjustment: '0.00',
        goodsNet: amount,
        payable: amount,
      },
    },
    unitsPerCarton,
    images: [...images.values()],
  }
}
