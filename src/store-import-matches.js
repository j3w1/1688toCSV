import { localImageAsset } from './images.js'

const number = (value) => {
  const text = String(value ?? '')
  return /^\d+(?:\.\d+)?$/.test(text)
    ? text
        .replace(/^0+(?=\d)/, '')
        .replace(/(\.\d*?)0+$/, '$1')
        .replace(/\.$/, '')
    : text
}
const numericFields = [
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
const variants = (values) =>
  [
    ...new Set(
      values.map(({ variant, size }) =>
        JSON.stringify([
          variant?.toUpperCase() || '',
          size?.toUpperCase() || '',
        ])
      )
    ),
  ].sort()

function rowIdentity(evidence, { description, productNumber, photos, sizes }) {
  return [
    evidence.row,
    String(evidence.group),
    ...numericFields.map((field) => number(evidence[field])),
    description,
    productNumber || '',
    photos,
    sizes,
  ]
}

/** Advisory content match, including older imports without added database metadata. */
export async function findMatchingStoreImports(analysis, records) {
  const candidates = records.filter(
    ({ snapshot }) =>
      snapshot.sourceType === 'spreadsheet' &&
      snapshot.store.key === analysis.store.key &&
      snapshot.spreadsheet.sheetName === analysis.sheetName &&
      number(snapshot.spreadsheet.total) === number(analysis.total)
  )
  if (!candidates.length) return []
  const assets = new Map()
  for (const row of analysis.rows)
    for (const photo of row.photos)
      if (!assets.has(photo))
        assets.set(photo, (await localImageAsset(photo)).url)
  const incoming = JSON.stringify(
    analysis.rows.map((row) =>
      rowIdentity(row, {
        description: String(
          row.description ||
            row.title ||
            row.productNumber ||
            `Group ${row.group}`
        ).trim(),
        productNumber: row.productNumber,
        photos: [...new Set(row.photos.map((photo) => assets.get(photo)))],
        sizes: variants(row.variants?.length ? row.variants : [{}]),
      })
    )
  )
  return candidates.filter(({ snapshot }) => {
    const productsByRow = new Map()
    for (const item of snapshot.items) {
      if (!productsByRow.has(item.sourceRow))
        productsByRow.set(item.sourceRow, [])
      productsByRow.get(item.sourceRow).push(item)
    }
    const saved = snapshot.spreadsheet.rows.map((row) => {
      const products = productsByRow.get(row.row) || []
      const first = products[0]
      return rowIdentity(row, {
        description: first?.description || first?.title || '',
        productNumber: first?.productNumber,
        photos: first?.photos || [],
        sizes: variants(
          products.map((item) => ({
            variant: item.sourceVariant,
            size: item.sourceSize,
          }))
        ),
      })
    })
    return JSON.stringify(saved) === incoming
  })
}
