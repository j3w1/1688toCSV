import { productAttributes } from './product-attributes.js'
import { createSizeClassifier } from './size-vocabulary.js'
import { centsToMoney, lineGrossCents, moneyToCents } from './money.js'

const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  )
const safe = (value) =>
  /^[=+@-]/.test(String(value).trimStart()) ? `'${value}` : String(value)
const normalized = (value) => String(value ?? '').replace(/[\t\r\n]+/g, ' · ')
const line = (value, numeric = false) => {
  const text = numeric ? normalized(value) : safe(normalized(value))
  return text.includes('"') ? `"${text.replaceAll('"', '""')}"` : text
}
export const preparationColumns = [
  ['baseCode', 'Product code', 'Codes & packing'],
  ['barcode', 'Barcode', 'Codes & packing'],
  ['variantSuffix', 'Variant code', 'Codes & packing'],
  ['sizeSuffix', 'Size code', 'Codes & packing'],
  ['packingMonth', 'Packing month', 'Codes & packing'],
  ['spanishName', 'Spanish description', 'Codes & packing'],
  ['chineseCategory', 'Chinese category', 'Codes & packing'],
  ['material', 'Material', 'Codes & packing'],
  ['title', 'Product title', 'Product details'],
  ['description', 'Description', 'Product details'],
  ['productNumber', 'Seller product code', 'Product details'],
  ['entryId', 'Product entry ID', 'Product details'],
  ['model', 'Model', 'Product details'],
  ['variantDescription', 'Variant', 'Product details'],
  ['sourceSize', 'Size', 'Product details'],
  ['skuDetails', 'Original specifications', 'Product details'],
  ['sourceColor', 'Original color', 'Product details'],
  ['sourceMaterial', 'Original material', 'Product details'],
  ['price', 'Price', 'Amounts'],
  ['quantity', 'Quantity', 'Amounts'],
  ['discount', 'Discount', 'Amounts'],
  ['sourceDiscount', 'Product discount', 'Amounts'],
  ['allocatedDiscount', 'Allocated price change', 'Amounts'],
  ['lineAmount', 'Item amount', 'Amounts'],
  ['lineNetAmount', 'Amount after discount', 'Amounts'],
  ['orderId', 'Order number', 'Order & supplier'],
  ['orderDate', 'Purchase date', 'Order & supplier'],
  ['orderStatus', 'Order status', 'Order & supplier'],
  ['sellerName', 'Store name', 'Order & supplier'],
  ['sellerMemberLogin', 'Seller login', 'Order & supplier'],
  ['lastChecked', 'Last checked', 'Order & supplier'],
  ['orderShipping', 'Order shipping', 'Order & supplier'],
  ['orderPayable', 'Order payable', 'Order & supplier'],
  ['orderGoodsGross', 'Order goods amount', 'Order & supplier'],
  ['orderGoodsNet', 'Order goods net', 'Order & supplier'],
  ['orderDiscount', 'Order discounts', 'Order & supplier'],
  ['orderAdjustment', 'Seller price changes', 'Order & supplier'],
  ['orderCustomization', 'Order customization service', 'Order & supplier'],
  ['orderRedPacket', 'Order red-packet discount', 'Order & supplier'],
  ['productTags', 'Product tags', 'Tags & links'],
  ['orderTags', 'Order tags', 'Tags & links'],
  ['orderNotes', 'Order notes', 'Tags & links'],
  ['orderUrl', 'Order link', 'Tags & links'],
  ['storeUrl', 'Store link', 'Tags & links'],
  ['thumbnail', 'Photo link', 'Tags & links'],
]
export const DEFAULT_PREPARATION_COLUMNS = [
  'baseCode',
  'barcode',
  'description',
  'spanishName',
  'price',
  'quantity',
  'discount',
]
export const PREPARATION_COLUMN_PREFERENCE = '1688-packing-copy-columns'
const columnKeys = preparationColumns.map(([key]) => key)
const numericFields = new Set([
  'price',
  'quantity',
  'discount',
  'sourceDiscount',
  'allocatedDiscount',
  'lineAmount',
  'lineNetAmount',
  'orderShipping',
  'orderPayable',
  'orderGoodsGross',
  'orderGoodsNet',
  'orderDiscount',
  'orderAdjustment',
  'orderCustomization',
  'orderRedPacket',
])
const numeric = (field, value) =>
  numericFields.has(field) && /^-?\d+(?:\.\d+)?$/.test(String(value))

export function normalizePreparationColumnPreference(value) {
  const selected = Array.isArray(value) ? value : value?.selected
  const chosen = [
    ...new Set(
      Array.isArray(selected) ? selected : DEFAULT_PREPARATION_COLUMNS
    ),
  ].filter((key) => columnKeys.includes(key))
  const order = [
    ...new Set([
      ...(Array.isArray(value?.order) ? value.order : chosen),
      ...DEFAULT_PREPARATION_COLUMNS,
      ...columnKeys,
    ]),
  ].filter((key) => columnKeys.includes(key))
  return { selected: chosen, order }
}

export function selectedPreparationColumns(preference) {
  const { selected, order } = normalizePreparationColumnPreference(preference)
  return order.filter((key) => selected.includes(key))
}

/** Snapshot metadata is copied per source entry, never inferred from another row. */
export function preparationOrderFields(row, record = row.record) {
  const order = record?.snapshot
  if (!order) return {}
  const totals = order.totals || {}
  return {
    orderDate: order.purchasedAt || '',
    ...(order.source === 'other'
      ? { source: 'other', orderReference: order.reference }
      : {}),
    orderStatus: order.status || '',
    sellerName: order.sellerUnavailable ? '' : order.sellerName || '',
    sellerMemberLogin: order.sellerMemberLogin || '',
    lastChecked: record.lastCheckedAt ?? order.observedAt ?? '',
    productTags: [...(record.productTags?.[row.entryId] || [])],
    orderTags: [...(record.tags || [])],
    orderNotes: record.notes || '',
    orderUrl: order.sourceUrl || '',
    storeUrl: order.sellerShopOrigin || '',
    orderShipping: totals.shipping ?? '',
    orderPayable: totals.payable ?? '',
    orderGoodsGross: totals.goodsGross ?? '',
    orderGoodsNet: totals.goodsNet ?? '',
    orderDiscount: totals.orderDiscount ?? '',
    orderAdjustment: totals.orderAdjustment ?? '',
    orderCustomization: totals.customizationService ?? '',
    orderRedPacket: totals.redPacketDiscount ?? '',
  }
}

/** Keep seller size wording, even when it cannot be assigned a barcode ending. */
export function sourceSizeForCopy(item, classifier = createSizeClassifier()) {
  const values = productAttributes(item)
    .fields.filter((field) => field.kind === 'size')
    .map((field) => field.value)
  return values.length
    ? [...new Set(values)].join(' / ')
    : classifier.extract(item).size
}

/** Derive display-only fields with exact decimal arithmetic; source values stay intact. */
export function preparationCopyFields(
  row,
  classifier = createSizeClassifier()
) {
  const source = productAttributes(row)
  const fieldValues = (kind) =>
    source.fields
      .filter((field) => field.kind === kind)
      .map((field) => field.value)
      .join(' / ')
  let lineAmount = '',
    lineNetAmount = ''
  if (row.price !== undefined && row.quantity !== undefined) {
    const gross = lineGrossCents(row.price, row.quantity)
    lineAmount = centsToMoney(gross)
    if (row.discount !== undefined)
      lineNetAmount = centsToMoney(gross - moneyToCents(row.discount))
  }
  return {
    ...row,
    title: source.title,
    productNumber: row.productNumber ?? fieldValues('code'),
    model: fieldValues('model'),
    variantDescription:
      row.variantDescription ?? classifier.extract(row).variant,
    sourceSize: row.sourceSize ?? sourceSizeForCopy(row, classifier),
    skuDetails: source.fields.map((field) => field.raw).join(' · '),
    sourceColor: fieldValues('color'),
    sourceMaterial: fieldValues('material'),
    lineAmount,
    lineNetAmount,
  }
}

/**
 * The packing rows as a grid: translated titles, raw cell values and which
 * columns are numeric. Copying and the file export share this one model.
 */
export function preparationGrid(rows, fields, translate = (value) => value) {
  const chosen = [...new Set(fields)]
    .map((key) => preparationColumns.find(([field]) => key === field))
    .filter(Boolean)
  if (!chosen.length || !rows.length)
    throw new Error('Choose columns and product rows to copy.')
  const seen = new Set()
  const values = rows.map((row) => {
    const key = `${row.orderId}/${row.groupId}`
    const first = !seen.has(key)
    seen.add(key)
    return chosen.map(([field]) => {
      const value =
        field === 'baseCode' && !first
          ? ''
          : field === 'orderId'
            ? (row.orderReference ?? row.orderId ?? '')
            : (row[field] ?? '')
      return Array.isArray(value) ? value.join(' · ') : value
    })
  })
  return {
    fields: chosen.map(([field]) => field),
    titles: chosen.map(([, title]) => translate(title)),
    values,
    numeric: chosen.map(([field]) => numericFields.has(field)),
  }
}

export function preparationTable(
  rows,
  fields,
  headers = false,
  translate = (value) => value
) {
  const grid = preparationGrid(rows, fields, translate)
  const chosen = grid.fields.map((field, index) => [field, grid.titles[index]])
  const values = grid.values
  const plain = [...(headers ? [grid.titles] : []), ...values]
    .map((row) =>
      row
        .map((value, index) => line(value, numeric(chosen[index][0], value)))
        .join('\t')
    )
    .join('\r\n')
  const head = headers
    ? `<tr>${chosen.map(([, title]) => `<th>${escape(title)}</th>`).join('')}</tr>`
    : ''
  const html = `<table>${head}${values.map((row) => `<tr>${row.map((value, i) => `<td${numeric(chosen[i][0], value) ? '' : ' style="mso-number-format:\'\\@\'"'}>${escape(numeric(chosen[i][0], value) ? normalized(value) : safe(normalized(value)))}</td>`).join('')}</tr>`).join('')}</table>`
  return { plain, html }
}
export async function writeTable({ plain, html }) {
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/plain': new Blob([plain], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    }),
  ])
}
export async function labelClipboard(results) {
  if (!results.length) throw new Error('No labels are ready to copy.')
  const images = Promise.all(
    results.map(async (result) => ({
      ...result,
      data: await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(result.blob)
      }),
    }))
  )
  // Keep the clipboard call in the click's user activation while data URLs
  // are encoded. Excel still receives the label's physical dimensions.
  const html = (async () => {
    const items = await images
    return new Blob(
      [
        `<table>${items.map((item) => `<tr style="height:${(item.heightMm * 72) / 25.4}pt"><td style="width:${(item.widthMm * 72) / 25.4}pt"><img src="${item.data}" width="${(item.widthMm * 96) / 25.4}" height="${(item.heightMm * 96) / 25.4}" style="width:${item.widthMm}mm;height:${item.heightMm}mm"></td></tr>`).join('')}</table>`,
      ],
      { type: 'text/html' }
    )
  })()
  const formats = { 'text/html': html }
  if (results.length === 1) formats['image/png'] = results[0].blob
  await navigator.clipboard.write([new ClipboardItem(formats)])
}
