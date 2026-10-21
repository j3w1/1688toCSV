import { centsToMoney, lineGrossCents, normalizePrice } from './money.js'

export const OTHER_ORDER_FORMAT = '1688-order-entry'
export const OTHER_ORDER_FILE_LIMIT = 8_000_000
export const OTHER_ORDER_PHOTO_LIMIT = 2_000_000
export const OTHER_ORDER_PHOTO_FILE_LIMIT = 1_400_000
export const OTHER_ORDER_PRODUCT_LIMIT = 200

function invalid(field, reason) {
  throw Object.assign(new Error(`${field}: ${reason}`), { field, reason })
}

function record(value, fields, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(field, 'must be an object')
  for (const key of Object.keys(value))
    if (!fields.includes(key)) invalid(`${field}.${key}`, 'is not supported')
}

function text(value, field, limit, required = true) {
  if (typeof value !== 'string') invalid(field, 'must be text')
  const result = value.trim()
  if (
    (required && !result) ||
    result.length > limit ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)
  )
    invalid(field, `must contain ${required ? '1' : '0'}–${limit} characters`)
  return result
}

export function validateOtherPhoto(value, field = 'photo') {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.length > OTHER_ORDER_PHOTO_LIMIT)
    invalid(field, 'must be an inline image of at most 2 MB')
  const match = value.match(
    /^data:image\/(png|jpeg|webp|gif);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/
  )
  if (!match || !match[2])
    invalid(field, 'must be an inline PNG, JPEG, WebP or GIF image')
  const bytes = atob(match[2])
  const signature = {
    png: bytes.startsWith('\x89PNG\r\n\x1a\n'),
    jpeg: bytes.startsWith('\xff\xd8\xff'),
    gif: bytes.startsWith('GIF87a') || bytes.startsWith('GIF89a'),
    webp: bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP',
  }
  if (!signature[match[1]])
    invalid(field, 'image bytes do not match the image type')
  return value
}

/** Decode only validated inline bytes, before opening any storage transaction. */
export async function validateOtherPhotoDecoded(value, field = 'photo') {
  const photo = validateOtherPhoto(value, field)
  if (!photo) return ''
  const [header, encoded] = photo.split(',')
  const bytes = Uint8Array.from(atob(encoded), (letter) => letter.charCodeAt(0))
  let bitmap
  try {
    bitmap = await createImageBitmap(
      new Blob([bytes], { type: header.slice(5, header.indexOf(';')) })
    )
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width > 8192 ||
      bitmap.height > 8192 ||
      bitmap.width * bitmap.height > 16_777_216
    )
      invalid(
        field,
        'must be no larger than 8192 pixels per side and 16 megapixels'
      )
  } catch (error) {
    if (error.field === field) throw error
    invalid(field, 'must be a decodable raster image')
  } finally {
    bitmap?.close()
  }
  return photo
}

export async function validateOtherSnapshotPhotos(snapshot) {
  if (snapshot.source !== 'other') return
  for (const [index, item] of snapshot.items.entries())
    await validateOtherPhotoDecoded(item.thumbnail, `products.${index}.photo`)
}

/** Shared manual/file validation. This function never writes or fetches anything. */
export function validateOtherOrder(input) {
  record(
    input,
    ['format', 'version', 'supplier', 'reference', 'date', 'products'],
    'order'
  )
  if (input.format !== OTHER_ORDER_FORMAT || input.version !== 1)
    invalid('format', 'use 1688-order-entry version 1')
  const supplier = text(input.supplier, 'supplier', 160)
  const reference = text(input.reference, 'reference', 160)
  if (/[\r\n\t]/.test(supplier + reference))
    invalid('reference', 'supplier and reference must each use one line')
  const date = input.date
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  )
    invalid('date', 'must be a real date in YYYY-MM-DD form')
  if (
    !Array.isArray(input.products) ||
    !input.products.length ||
    input.products.length > OTHER_ORDER_PRODUCT_LIMIT
  )
    invalid('products', `must contain 1–${OTHER_ORDER_PRODUCT_LIMIT} products`)
  if (JSON.stringify(input).length > OTHER_ORDER_FILE_LIMIT)
    invalid('order', 'must not exceed 8 MB')
  const products = input.products.map((product, index) => {
    const field = `products.${index}`
    record(
      product,
      ['description', 'specs', 'quantity', 'unitPrice', 'photo'],
      field
    )
    const description = text(product.description, `${field}.description`, 2000)
    const specs = text(product.specs ?? '', `${field}.specs`, 2000, false)
    if (
      typeof product.quantity !== 'string' ||
      !/^[1-9]\d{0,11}$/.test(product.quantity)
    )
      invalid(
        `${field}.quantity`,
        'must be a positive whole-number string of at most 12 digits'
      )
    if (
      typeof product.unitPrice !== 'string' ||
      !/^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/.test(product.unitPrice)
    )
      invalid(
        `${field}.unitPrice`,
        'must be a nonnegative CNY decimal string, with at most 6 decimal places'
      )
    return {
      description,
      specs,
      quantity: product.quantity,
      unitPrice: normalizePrice(product.unitPrice),
      photo: validateOtherPhoto(product.photo, `${field}.photo`),
    }
  })
  return {
    format: OTHER_ORDER_FORMAT,
    version: 1,
    supplier,
    reference,
    date,
    products,
  }
}

export function parseOtherOrderFile(content) {
  if (typeof content !== 'string' || content.length > OTHER_ORDER_FILE_LIMIT)
    invalid('file', 'must not exceed 8 MB')
  let value
  try {
    value = JSON.parse(content)
  } catch {
    invalid('file', 'must contain valid JSON')
  }
  return validateOtherOrder(value)
}

/** Full-decimal application ids keep existing packing keys; never 1688 source ids. */
export function otherOrderSnapshot(
  input,
  { id, now = new Date().toISOString() } = {}
) {
  const order = validateOtherOrder(input)
  id ??= BigInt(`0x${crypto.randomUUID().replaceAll('-', '')}`).toString()
  if (!/^[1-9]\d*$/.test(id))
    invalid('id', 'must be an internal full-decimal id')
  const items = order.products.map((product, index) => ({
    entryId: String(index + 1),
    title: product.description,
    description: [product.description, product.specs]
      .filter(Boolean)
      .join('\n'),
    skuProperties: product.specs
      ? [{ label: 'Specs', value: product.specs }]
      : [],
    thumbnail: product.photo,
    price: product.unitPrice,
    quantity: product.quantity,
    sourceDiscount: '0.00',
    allocatedDiscount: '0.00',
    discount: '0.00',
  }))
  const gross = centsToMoney(
    items.reduce(
      (sum, item) => sum + lineGrossCents(item.price, item.quantity),
      0n
    )
  )
  return {
    schemaVersion: 1,
    accountId: 'local',
    orderId: id,
    source: 'other',
    reference: order.reference,
    sourceUrl: '',
    sellerName: order.supplier,
    status: 'Entered order',
    observedAt: now,
    purchasedAt: `${order.date}T00:00:00+08:00`,
    items,
    totals: {
      goodsGross: gross,
      shipping: '0.00',
      sourceDiscount: '0.00',
      orderAdjustment: '0.00',
      goodsNet: gross,
      payable: gross,
    },
  }
}

export function otherOrderDuplicateKey(snapshot) {
  const canonical = (value) => value.normalize('NFKC').trim().toLowerCase()
  return JSON.stringify([
    canonical(snapshot.sellerName),
    canonical(snapshot.reference),
  ])
}

/** One invariant for creation, a backup's own records and the final merged state. */
export function assertUniqueOtherReferences(
  records,
  message = 'An other-source order with this supplier and reference already exists'
) {
  const seen = new Set()
  for (const { snapshot } of records) {
    if (snapshot.source !== 'other') continue
    const key = otherOrderDuplicateKey(snapshot)
    if (seen.has(key)) throw new Error(message)
    seen.add(key)
  }
}

/** Read existing evidence; never stamp a guessed source onto legacy records. */
export function orderSource(snapshot) {
  if (snapshot?.source === 'other') return 'other'
  try {
    const url = new URL(snapshot.sourceUrl)
    if (
      !url.username &&
      !url.password &&
      ((url.origin === 'https://air.1688.com' &&
        url.pathname === '/app/ctf-page/trade-order-detail/index.html') ||
        (url.origin === 'https://trade.1688.com' &&
          url.pathname === '/order/new_step_order_detail.htm')) &&
      url.searchParams.getAll('orderId').length === 1 &&
      url.searchParams.get('orderId') === snapshot.orderId
    )
      return '1688'
  } catch {
    /* Ambiguous legacy provenance stays unknown. */
  }
  return ''
}

export const orderDisplayReference = (snapshot) =>
  snapshot?.source === 'other' ? snapshot.reference : snapshot?.orderId
