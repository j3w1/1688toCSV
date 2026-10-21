// File names and machine-readable summaries for workspace exports, so an
// automation agent can find each file and check what it contains.
import { printText } from './print-language.js'

export const SUMMARY_FORMAT = '1688-export-summary'

const pad = (value) => String(value).padStart(2, '0')

export function exportDate(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Local date and time, 2026-10-19-153012: every export gets its own name, so
 * a download folder that already holds an earlier export never makes the
 * browser rename the new file behind the summary's back.
 */
export function exportStamp(now = new Date()) {
  return `${exportDate(now)}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** Print popup language controls PDF names and their matching JSON companions. */
export function printFileName(
  kind,
  productCount,
  now = new Date(),
  language = 'en'
) {
  if (kind === 'calibration')
    return `CE-${printText('fileCalibration', language)}-${exportStamp(now)}.pdf`
  const prefix = printText(
    kind === 'marks' ? 'fileMarks' : 'fileLabels',
    language
  )
  const unit = printText(
    productCount === 1 ? 'fileProduct' : 'fileProducts',
    language
  )
  return `CE-${prefix}-${exportStamp(now)}-${productCount}-${unit}.pdf`
}

/** A file-name-safe part: letters and digits in any script, joined by hyphens. */
export function fileSlug(text, limit = 40) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, limit)
    .replace(/-+$/g, '')
}

/** packing-list-2026-10-19-153012-seller.xlsx, or …-3-sellers.xlsx. */
export function packingListFileName(sellers, now = new Date()) {
  const unique = [
    ...new Set(sellers.map((seller) => String(seller || '').trim())),
  ]
  const date = exportStamp(now)
  if (unique.length === 1)
    return `packing-list-${date}-${fileSlug(unique[0]) || 'seller'}.xlsx`
  return `packing-list-${date}-${unique.length}-sellers.xlsx`
}

/** The summary sits next to its file: same name, .json. */
export const summaryFileName = (fileName) =>
  `${String(fileName).replace(/\.[A-Za-z0-9]+$/, '')}.json`

/**
 * Quantities stay exact: whole numbers become JSON numbers while safe and
 * decimal strings beyond that; totals add with BigInt.
 */
function exactQuantity(value) {
  const text = String(value ?? '').trim()
  if (/^\d+$/.test(text)) {
    const big = BigInt(text)
    return big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big.toString()
  }
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}
function exactTotal(values) {
  if (
    values.every(
      (value) => Number.isInteger(value) || typeof value === 'string'
    )
  ) {
    const total = values.reduce((sum, value) => sum + BigInt(value), 0n)
    return total <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(total)
      : total.toString()
  }
  return values.reduce((sum, value) => sum + Number(value), 0)
}

function exactAmount(value, field) {
  if (value === undefined || value === null || value === '') return undefined
  const text = String(value).trim()
  if (!/^\d+(?:\.\d+)?$/.test(text))
    throw new Error(`Invalid ${field} in export summary`)
  return text
}

const packingDetailFields = [
  'plannedBoxes',
  'receivedBoxes',
  'loadedBoxes',
  'cartons',
  'cartonWeight',
  'cartonVolume',
  'cartonLength',
  'cartonWidth',
  'cartonHeight',
  'sourceUnitPrice',
  'effectiveUnitPrice',
  'sourceAmount',
  'effectiveAmount',
  'additionalCharge',
  'featureCharge',
  'linkedPaymentCharge',
]

/** Which orders, products and quantities a packing-list export holds. */
export function packingSummary({
  rows,
  file,
  exportedAt = new Date().toISOString(),
}) {
  const orders = new Map()
  const products = []
  for (const row of rows) {
    if (!orders.has(row.orderId))
      orders.set(row.orderId, {
        orderId: row.orderId,
        seller: row.sellerName || '',
      })
    const order = orders.get(row.orderId)
    if (
      row.storeNumber !== undefined &&
      row.storeNumber !== null &&
      String(row.storeNumber).trim()
    )
      order.storeNumber = String(row.storeNumber)
    const orderCosts = exactAmount(
      row.orderAdditionalCharges,
      'orderAdditionalCharges'
    )
    if (orderCosts !== undefined && /[1-9]/.test(orderCosts)) {
      if (
        order.orderAdditionalCharges !== undefined &&
        order.orderAdditionalCharges !== orderCosts
      )
        throw new Error(
          'Inconsistent order additional charges in export summary'
        )
      order.orderAdditionalCharges = orderCosts
      if (row.additionalChargeReasons)
        order.additionalChargeReasons = String(row.additionalChargeReasons)
    }
    const details = Object.fromEntries(
      packingDetailFields.flatMap((field) => {
        const value = exactAmount(row[field], field)
        return value === undefined ? [] : [[field, value]]
      })
    )
    products.push({
      orderId: row.orderId,
      code: row.barcode || row.baseCode || '',
      name: row.spanishName || '',
      quantity: exactQuantity(row.quantity),
      ...details,
      ...(row.packingMonth ? { packingMonth: row.packingMonth } : {}),
      ...(row.cartonBatchId
        ? {
            cartonBatchId: row.cartonBatchId,
            cartonBatchComplete: row.cartonBatchComplete === true,
          }
        : {}),
      ...(row.storeNumber !== undefined &&
      row.storeNumber !== null &&
      String(row.storeNumber).trim()
        ? { storeNumber: String(row.storeNumber) }
        : {}),
      ...(row.additionalChargeReasons
        ? { additionalChargeReasons: String(row.additionalChargeReasons) }
        : {}),
      ...(row.linkedPaymentReasons
        ? { linkedPaymentReasons: String(row.linkedPaymentReasons) }
        : {}),
      ...(row.productFeatures
        ? { productFeatures: String(row.productFeatures) }
        : {}),
      ...(row.productFeatureCosts
        ? { productFeatureCosts: String(row.productFeatureCosts) }
        : {}),
    })
  }
  return {
    format: SUMMARY_FORMAT,
    version: 1,
    kind: 'packing-list',
    exportedAt,
    files: [file, summaryFileName(file)],
    orders: [...orders.values()],
    products,
    totals: {
      orders: orders.size,
      products: products.length,
      quantity: exactTotal(products.map((product) => product.quantity)),
    },
  }
}

/** Which labels or carton marks a PDF export holds, page count included. */
export function printSummary({
  kind,
  language = 'en',
  file,
  items,
  pages,
  perPage,
  exportedAt = new Date().toISOString(),
}) {
  const orders = new Map()
  for (const item of items)
    for (const source of item.orders || [])
      if (!orders.has(source.orderId))
        orders.set(source.orderId, {
          orderId: source.orderId,
          seller: source.seller || '',
        })
  const products = items.map((item) => ({
    code: item.code,
    name: item.name || '',
    orders: (item.orders || []).map((source) => source.orderId),
    requested: item.requested,
    ...(kind === 'labels' ? { extra: item.extra } : {}),
    total: item.total,
  }))
  return {
    format: SUMMARY_FORMAT,
    version: 1,
    kind: kind === 'marks' ? 'carton-marks' : 'labels',
    language,
    exportedAt,
    files: [file, summaryFileName(file)],
    pages,
    perPage,
    orders: [...orders.values()],
    products,
    totals: {
      orders: orders.size,
      products: products.length,
      requested: products.reduce((sum, product) => sum + product.requested, 0),
      printed: products.reduce((sum, product) => sum + product.total, 0),
    },
  }
}
