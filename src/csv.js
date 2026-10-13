export const HEADERS = [
  'Thumbnail',
  'Description',
  'Price',
  'Quantity',
  'Discount',
]

function quote(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

export function toCsv(rows) {
  if (!Array.isArray(rows) || !rows.length)
    throw new Error('No product rows to export.')
  const lines = rows.map((row) =>
    [
      quote(row.thumbnail),
      quote(row.description),
      ...['price', 'quantity', 'discount'].map((key) => {
        const value = String(row[key] ?? '0')
        if (!/^\d+(?:\.\d+)?$/.test(value))
          throw new Error(`Invalid ${key} in export.`)
        return value
      }),
    ].join(',')
  )
  return '\uFEFF' + [HEADERS.join(','), ...lines].join('\r\n') + '\r\n'
}

export function filenameFor({ sellerName, orderSuffix }) {
  const clean = (value, fallback) =>
    String(value || fallback)
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 80) || fallback
  return `${clean(sellerName, 'Unknown Seller')}_${clean(orderSuffix, 'XXXX')}.csv`
}

export function prepareCsv(order) {
  return { filename: filenameFor(order), csv: toCsv(order.dataRows) }
}
