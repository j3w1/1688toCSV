// File names and machine-readable summaries for workspace exports, so an
// automation agent can find each file and check what it contains.

export const SUMMARY_FORMAT = '1688-export-summary'

export function exportDate(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
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

/** packing-list-2026-10-19-seller.xlsx, or packing-list-2026-10-19-3-sellers.xlsx. */
export function packingListFileName(sellers, now = new Date()) {
  const unique = [
    ...new Set(sellers.map((seller) => String(seller || '').trim())),
  ]
  const date = exportDate(now)
  if (unique.length === 1)
    return `packing-list-${date}-${fileSlug(unique[0]) || 'seller'}.xlsx`
  return `packing-list-${date}-${unique.length}-sellers.xlsx`
}

/** The summary sits next to its file: same name, .json. */
export const summaryFileName = (fileName) =>
  `${String(fileName).replace(/\.[A-Za-z0-9]+$/, '')}.json`

const whole = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

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
    products.push({
      orderId: row.orderId,
      code: row.barcode || row.baseCode || '',
      name: row.spanishName || '',
      quantity: whole(row.quantity),
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
      quantity: products.reduce((sum, product) => sum + product.quantity, 0),
    },
  }
}

/** Which labels or carton marks a PDF export holds, page count included. */
export function printSummary({
  kind,
  file,
  items,
  pages,
  perPage,
  exportedAt = new Date().toISOString(),
}) {
  const products = items.map((item) => ({
    code: item.code,
    name: item.name || '',
    requested: item.requested,
    ...(kind === 'labels' ? { extra: item.extra } : {}),
    total: item.total,
  }))
  return {
    format: SUMMARY_FORMAT,
    version: 1,
    kind: kind === 'marks' ? 'carton-marks' : 'labels',
    exportedAt,
    files: [file, summaryFileName(file)],
    pages,
    perPage,
    products,
    totals: {
      products: products.length,
      requested: products.reduce((sum, product) => sum + product.requested, 0),
      printed: products.reduce((sum, product) => sum + product.total, 0),
    },
  }
}
