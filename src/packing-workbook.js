import { columnName, createZip } from './xlsx-writer.js'
import { excelImagePalette } from './excel-image-style.js'

const encoder = new TextEncoder()
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_REL =
  'http://schemas.openxmlformats.org/package/2006/relationships'
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml'
const emu = (pixels) => Math.round(pixels * 9525)
const xml = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&apos;',
        })[character]
    )

// The source letters identify the owner's reference even when payments are omitted.
export const PACKING_WORKBOOK_COLUMNS = Object.freeze(
  [
    ['A', 'store', 'Store', 'TIENDA', '店铺', 18],
    ['B', 'photo', 'Photo', 'FOTO', '图片', 23],
    ['C', 'barcode', 'Barcode', 'COD.BARRAS', '条码', 28],
    [
      'D',
      'description',
      'Original description',
      'DESCRIPCIÓN 中文',
      '产品描述',
      38,
    ],
    ['E', 'spanishName', 'Description', 'DESCRIPCIÓN', '产品名称', 27],
    ['F', 'productNumber', 'Item', 'ITEM', '货号', 16],
    ['G', 'sourceSize', 'Size', 'MEDIDAS', '尺寸', 15],
    ['H', 'loadedBoxes', 'Loaded boxes', 'CAJAS CARGADO', '已装柜箱数', 13],
    ['I', 'receivedBoxes', 'Received boxes', 'REAL CAJAS', '实收箱数', 13],
    ['J', 'plannedBoxes', 'Planned boxes', 'CAJAS', '计划箱数', 12],
    ['K', 'unitsPerCarton', 'Pcs/box', 'PZAS', '装箱数', 12],
    ['L', 'quantity', 'Total quantity', 'CANT. TOTAL', '全部数量', 14],
    [
      'M',
      'orderQuantity',
      'Quantity / order',
      'CANT X TIENDA',
      '订单总数量',
      15,
    ],
    ['N', 'sourceUnitPrice', 'Unit price · CNY', 'PRECIO RMB', '单价', 14],
    ['O', 'orderShipping', 'Order shipping · CNY', 'ENVIO', '快递', 14],
    ['P', 'discount', 'Row discount · CNY', 'DSCTO.', '折扣', 14],
    [
      'Q',
      'effectiveUnitPrice',
      'Price + charges · CNY',
      'PRECIO + CARGOS',
      '单价含附加费用',
      16,
    ],
    ['R', 'effectiveAmount', 'Subtotal · CNY', 'SUBTOTAL', '全价', 16],
    ['S', 'cartonWeight', 'Weight kg/box', 'PESO', '单重量', 13],
    [
      'T',
      'receivedWeight',
      'Received weight · kg',
      'PESO TOTAL',
      '实收总重量',
      15,
    ],
    ['U', 'loadedWeight', 'Loaded weight · kg', 'PESO CARGADO', '装柜重量', 15],
    ['V', 'cartonLength', 'Length · cm', 'L', '长（厘米）', 11],
    ['W', 'cartonWidth', 'Width · cm', 'A', '宽（厘米）', 11],
    ['X', 'cartonHeight', 'Height · cm', 'P', '高（厘米）', 11],
    ['Y', 'cartonVolume', 'Volume m³/box', 'CBM P.CAJA', '单体积', 14],
    [
      'Z',
      'receivedVolume',
      'Received volume · m³',
      'SUBTOTAL CBM',
      '实收总体积',
      16,
    ],
    ['AA', 'loadedVolume', 'Loaded volume · m³', 'CBM CARGADO', '装柜体积', 16],
    ['AB', 'orderAmount', 'Goods / order · CNY', 'TOTAL', '订单商品总额', 17],
    ['AC', 'payments', 'Payments · CNY', 'PAGOS DEL MISTER', '付掉款', 17],
    ['AD', 'deposits', 'Deposits · CNY', 'DEPOSITOS', '定金', 15],
    ['AE', 'balance', 'Balance · CNY', 'SALDO TOTAL', '余款', 17],
    [
      'AF',
      'totalLoadedWeight',
      'Total loaded weight · kg',
      'PESO TOTAL',
      '装柜总重量',
      18,
    ],
    [
      'AG',
      'totalLoadedVolume',
      'Total loaded volume · m³',
      'CBM TOTAL',
      '装柜总体积',
      18,
    ],
    [
      'AH',
      'totalLoadedBoxes',
      'Total loaded boxes',
      'CAJAS TOTAL',
      '装柜总箱数',
      17,
    ],
  ].map(([reference, key, en, es, zh, width]) =>
    Object.freeze({
      reference,
      key,
      labels: Object.freeze({ en, es, zh }),
      width,
    })
  )
)

const words = {
  en: [
    'CONTAINER PACKING LIST',
    'Generated',
    'Order',
    'Totals',
    'Unknown counts stay blank. Received and loaded boxes are confirmed separately for this packing month. Weight and volume totals include only entered counts and measurements. Price includes added charges before discounts; subtotal is after discounts. Order shipping is separate.',
    'Packing month',
  ],
  es: [
    'LISTA DE EMPAQUE DEL CONTENEDOR',
    'Generado',
    'Pedido',
    'TOTALES',
    'Los valores desconocidos quedan en blanco. Las cajas recibidas y cargadas se confirman por separado para este mes. Peso y volumen suman solo cajas y medidas registradas. El precio incluye cargos antes de descuentos; el subtotal ya descuenta las rebajas. Envío aparte.',
    'Mes de empaque',
  ],
  zh: [
    '集装箱装箱清单',
    '生成日期',
    '订单',
    '合计',
    '未知箱数保持空白。实收箱数与装柜箱数按装箱月份分别确认。重量和体积只合计已填写的箱数及测量值。单价含附加费用但未扣折扣，小计已扣除折扣，订单运费单列。',
    '装箱月份',
  ],
}

function decimal(value, { integer = false } = {}) {
  if (value === undefined || value === null || value === '') return ''
  const text = String(value)
  if (
    !(integer ? /^\d+$/ : /^-?\d+(?:\.\d+)?$/).test(text) ||
    (integer && !Number.isSafeInteger(Number(text)))
  )
    throw new Error(
      `Invalid ${integer ? 'box count' : 'decimal'} in packing workbook`
    )
  return integer ? String(BigInt(text)) : text
}

function first(...values) {
  return (
    values.find(
      (value) => value !== undefined && value !== null && value !== ''
    ) ?? ''
  )
}

function sum(values) {
  const present = values.filter((value) => value !== '' && value !== undefined)
  if (!present.length) return ''
  const precision = Math.max(
    ...present.map((value) => String(value).split('.')[1]?.length || 0)
  )
  const total = present.reduce((total, value) => {
    const text = String(value),
      negative = text.startsWith('-')
    const [whole, fraction = ''] = text.replace('-', '').split('.')
    const amount = BigInt(whole + fraction.padEnd(precision, '0'))
    return total + (negative ? -amount : amount)
  }, 0n)
  const digits = (total < 0n ? -total : total)
    .toString()
    .padStart(precision + 1, '0')
  return `${total < 0n ? '-' : ''}${precision ? `${digits.slice(0, -precision)}.${digits.slice(-precision)}` : digits}`
}

function multiply(a, b) {
  if (a === '' || b === '') return ''
  const fraction =
    (String(a).split('.')[1]?.length || 0) +
    (String(b).split('.')[1]?.length || 0)
  const amount =
    BigInt(String(a).replace('.', '')) * BigInt(String(b).replace('.', ''))
  const digits = amount.toString().padStart(fraction + 1, '0')
  return fraction
    ? `${digits.slice(0, -fraction)}.${digits.slice(-fraction)}`
    : digits
}

const textCell = (value, style = 4) => ({
  value: String(value ?? ''),
  type: 'text',
  style,
})
const numberCell = (value, style = 5) => ({
  value: decimal(value),
  type: 'number',
  style,
})
const excelNumber = (value) =>
  value !== '' &&
  String(value).replace(/[-.]/g, '').replace(/^0+/, '').length <= 15
const numericTotal = (values) =>
  values.some((value) => value !== '' && !excelNumber(value)) ? '' : sum(values)
const totalFormula = (range) =>
  `IF(OR(COUNT(${range})=0,COUNTIF(${range},"?*")>0),"",SUM(${range}))`
const formulaCell = (formula, value = '', style = 5, dependencies = []) => ({
  formula,
  value,
  type: 'number',
  style,
  dependencies,
})
const moneyColumns = new Set([
  'sourceUnitPrice',
  'effectiveUnitPrice',
  'orderShipping',
  'discount',
  'effectiveAmount',
  'orderAmount',
])
const measurementColumns = new Set([
  'cartonWeight',
  'receivedWeight',
  'loadedWeight',
  'cartonLength',
  'cartonWidth',
  'cartonHeight',
  'cartonVolume',
  'receivedVolume',
  'loadedVolume',
])
const weightColumns = new Set([
  'cartonWeight',
  'receivedWeight',
  'loadedWeight',
  'totalLoadedWeight',
])
const volumeColumns = new Set([
  'cartonVolume',
  'receivedVolume',
  'loadedVolume',
  'totalLoadedVolume',
])
const numericStyle = (key, total = false) =>
  moneyColumns.has(key)
    ? total
      ? 12
      : 10
    : weightColumns.has(key)
      ? total
        ? 13
        : 11
      : volumeColumns.has(key)
        ? total
          ? 15
          : 14
        : measurementColumns.has(key)
          ? total
            ? 17
            : 16
          : total
            ? 7
            : 5

const omittedColumns = new Set(['payments', 'deposits', 'balance'])
const availableColumns = PACKING_WORKBOOK_COLUMNS.filter(
  (column) => !omittedColumns.has(column.key)
)
// OOXML width uses the Normal font's maximum digit width (Calibri 11 = 7px).
const columnPixels = (width) => Math.floor(((256 * width + 18) / 256) * 7)
const bounded = (value, fallback, minimum, maximum) =>
  Number.isFinite(Number(value)) && value !== '' && value !== null
    ? Math.max(minimum, Math.min(maximum, Number(value)))
    : fallback
const textWidth = (value) =>
  Array.from(String(value ?? '')).reduce(
    (width, character) => width + (/[^\u0000-\u00ff]/.test(character) ? 2 : 1),
    0
  )

function descriptionColumnWidth(rows, key, maximum) {
  let longest = 0
  for (const row of rows)
    for (const line of String(
      key === 'description'
        ? first(row.description, row.title)
        : (row[key] ?? '')
    ).split(/\r?\n/))
      longest = Math.max(longest, textWidth(line))
  return Math.max(24, Math.min(maximum, longest + 2))
}

function wrappedLines(value, width) {
  // Count CJK glyphs as two Latin characters and preserve authored line breaks.
  const capacity = Math.max(1, width - 2)
  return String(value ?? '')
    .split(/\r?\n/)
    .reduce((total, line) => {
      let lines = 1,
        used = 0,
        space = 0
      for (const token of line.match(
        /\s+|[\u2e80-\uffff]|[^\s\u2e80-\uffff]+/gu
      ) || []) {
        if (/^\s+$/.test(token)) {
          space = used ? textWidth(token) : 0
          continue
        }
        const size = textWidth(token)
        if (used && used + space + size > capacity) {
          lines++
          used = 0
        }
        if (size > capacity) {
          lines += Math.ceil(size / capacity) - 1
          used = size % capacity || capacity
        } else used += (used ? space : 0) + size
        space = 0
      }
      return total + lines
    }, 0)
}

function projectColumns(plan, selected) {
  const selectedKeys = new Set(selected.map((column) => column.key))
  const positions = new Map(
    plan.columns.map((column, index) => [column.key, index])
  )
  const letters = new Map(
    selected.map((column, index) => [
      columnName(positions.get(column.key)),
      columnName(index),
    ])
  )
  const projectCell = (cell) => {
    if (!cell.formula) return cell
    const { dependencies, ...result } = cell
    if (dependencies.some((key) => !selectedKeys.has(key))) {
      delete result.formula
      return result
    }
    result.formula = result.formula.replace(
      /(\$?)([A-Z]{1,3})(\$?\d+)/g,
      (_match, absolute, letter, row) =>
        `${absolute}${letters.get(letter)}${row}`
    )
    return result
  }
  const minHeight = selectedKeys.has('photo')
    ? (plan.photoPixels + 12) * 0.75
    : selectedKeys.has('barcode')
      ? 52
      : 32
  const lastColumn = columnName(selected.length - 1)
  return {
    ...plan,
    columns: selected,
    lastColumn,
    rows: plan.rows.map((row) => {
      if (row.kind === 'header')
        return {
          ...row,
          cells: selected.map((column) => row.cells[positions.get(column.key)]),
        }
      if (row.kind !== 'product' && row.kind !== 'total') {
        const width = selected.reduce(
          (total, column) => total + column.width,
          0
        )
        const lineHeight = row.kind === 'title' ? 27 : 13
        return {
          ...row,
          height: Math.max(
            row.height,
            Math.min(
              150,
              wrappedLines(row.cells[0]?.value, width) * lineHeight + 8
            )
          ),
        }
      }
      const cells = selected.map((column) =>
        projectCell(row.cells[positions.get(column.key)])
      )
      if (row.kind === 'total') {
        if (!cells[0]?.value && !cells[0]?.formula)
          cells[0] = textCell(plan.totalLabel, 7)
        return { ...row, cells }
      }
      const lines = Math.max(
        1,
        ...selected.map((column, index) =>
          ['photo', 'barcode'].includes(column.key)
            ? 1
            : wrappedLines(cells[index].value, column.width)
        )
      )
      return {
        ...row,
        height: Math.max(minHeight, Math.min(240, lines * 15 + 16)),
        cells,
      }
    }),
    merges:
      selected.length === 1
        ? []
        : plan.merges.map((range) =>
            range.replace(/:[A-Z]+(\d+)$/, `:${lastColumn}$1`)
          ),
    imageColumns: {
      photo: selectedKeys.has('photo')
        ? selected.findIndex((column) => column.key === 'photo')
        : undefined,
      code: selectedKeys.has('barcode')
        ? selected.findIndex((column) => column.key === 'barcode')
        : undefined,
    },
  }
}

function oneValue(rows, key) {
  const values = [
    ...new Set(
      rows
        .map((row) => row[key])
        .filter(
          (value) => value !== undefined && value !== null && value !== ''
        )
        .map(String)
    ),
  ]
  return values.length === 1 ? values[0] : ''
}

function batchIdentity(row) {
  const batch =
    row.cartonBatchId ??
    (row.sourceRow ? `source-row:${row.sourceRow}` : `entry:${row.entryId}`)
  return JSON.stringify([
    row.accountId || 'local',
    row.orderId,
    row.packingMonth || '',
    batch,
  ])
}

/** The integration supplies the complete source IDs when a supplier row has variants. */
function cartonBatches(rows) {
  const batches = new Map()
  for (const row of rows) {
    const id = batchIdentity(row)
    if (!batches.has(id)) batches.set(id, [])
    batches.get(id).push(row)
  }
  return new Map(
    [...batches].map(([key, members]) => {
      const included = new Set(members.map((row) => String(row.entryId)))
      const shared =
        members.length > 1 ||
        members.some(
          (row) =>
            row.sourceRow ||
            (row.cartonBatchEntryIds ?? row.sourceRowEntryIds)?.length > 1
        )
      const complete = members.every((row) => {
        if (
          row.cartonBatchComplete === false ||
          row.sourceRowComplete === false
        )
          return false
        const expected = row.cartonBatchEntryIds ?? row.sourceRowEntryIds
        return Array.isArray(expected)
          ? expected.every((id) => included.has(String(id)))
          : !shared ||
              row.cartonBatchComplete === true ||
              row.sourceRowComplete === true
      })
      const values = {}
      for (const field of [
        'receivedBoxes',
        'loadedBoxes',
        'cartonWeight',
        'cartonVolume',
        'cartonLength',
        'cartonWidth',
        'cartonHeight',
      ])
        values[field] = oneValue(members, field)
      const explicit = oneValue(
        members.map((row) => ({
          planned: first(row.plannedBoxes, row.cartons),
        })),
        'planned'
      )
      let planned = explicit
      if (!planned && !shared && members.length === 1) {
        const quantity = String(members[0].quantity ?? ''),
          capacity = String(members[0].unitsPerCarton ?? '')
        if (
          /^\d+$/.test(quantity) &&
          /^[1-9]\d*$/.test(capacity) &&
          BigInt(quantity) % BigInt(capacity) === 0n
        )
          planned = String(BigInt(quantity) / BigInt(capacity))
      }
      return [
        key,
        { complete, owner: members[0], values, plannedBoxes: planned },
      ]
    })
  )
}

/** Pure worksheet plan: source transactions never deduplicate by product code. */
export function planPackingWorkbook(
  rows,
  {
    language = 'es',
    createdAt = new Date().toISOString(),
    style,
    columns: requestedColumns,
    descriptionWidth = 48,
    photoSize = 'standard',
    includeOrderDetails = true,
    includeTotals = true,
    freezeHeaders = true,
    filters = true,
  } = {}
) {
  if (!Array.isArray(rows) || !rows.length)
    throw new Error('Choose packing products to export.')
  if (!words[language]) language = 'en'
  const labels = words[language]
  const selectedKeys =
    requestedColumns ?? availableColumns.map((column) => column.key)
  if (
    !Array.isArray(selectedKeys) ||
    !selectedKeys.length ||
    selectedKeys.some(
      (key) => !availableColumns.some((column) => column.key === key)
    )
  )
    throw new Error('Choose at least one supported packing workbook column.')
  const maximumDescriptionWidth = bounded(descriptionWidth, 48, 24, 60)
  const photoPixels =
    { compact: 64, standard: 120, large: 160 }[photoSize] ??
    bounded(photoSize, 120, 48, 180)
  const columns = availableColumns.map((column) => ({
    ...column,
    width:
      column.key === 'photo'
        ? Math.ceil(((photoPixels + 12) / 7) * 100) / 100
        : column.key === 'description'
          ? descriptionColumnWidth(rows, column.key, maximumDescriptionWidth)
          : column.width,
  }))
  const selected = [...new Set(selectedKeys)].map((key) =>
    columns.find((column) => column.key === key)
  )
  const indexes = new Map(columns.map((column, index) => [column.key, index]))
  const letter = (key) => columnName(indexes.get(key))
  const address = (key, row) => `${letter(key)}${row}`
  const lastColumn = columnName(columns.length - 1)
  const sheetRows = [],
    merges = [],
    products = [],
    orders = new Map()
  const addRow = (kind, height, cells = []) => {
    const row = { number: sheetRows.length + 1, kind, height, cells }
    sheetRows.push(row)
    return row
  }
  const fullRow = (kind, value, height, style) => {
    const row = addRow(kind, height, [textCell(value, style)])
    merges.push(`A${row.number}:${lastColumn}${row.number}`)
    return row
  }
  fullRow('title', labels[0], 30, 1)
  const months = [
    ...new Set(rows.map((row) => row.packingMonth).filter(Boolean)),
  ]
  fullRow(
    'metadata',
    `${labels[1]}: ${String(createdAt).slice(0, 10)}    ·    ${labels[5]}: ${months.join(' / ')}`,
    23,
    2
  )
  fullRow('note', labels[4], 33, 2)
  addRow(
    'header',
    27,
    columns.map((column) =>
      textCell(column.labels[language === 'zh' ? 'es' : 'zh'], 3)
    )
  )
  addRow(
    'header',
    39,
    columns.map((column) => textCell(column.labels[language], 3))
  )
  for (const source of rows) {
    if (!source.orderId || source.entryId === undefined)
      throw new Error('Packing products require source order and entry IDs.')
    const key = JSON.stringify([source.accountId || 'local', source.orderId])
    if (!orders.has(key)) orders.set(key, [])
    orders.get(key).push(source)
  }
  const batches = cartonBatches(rows)
  const seenProducts = new Set()
  let orderNumber = 0
  for (const sources of orders.values()) {
    const source = sources[0]
    const store = [source.storeNumber, source.sellerName]
      .filter(Boolean)
      .join(' · ')
    const orderMonths = [
      ...new Set(sources.map((row) => row.packingMonth || '')),
    ]
    const mixedMonths = orderMonths.length > 1
    if (includeOrderDetails)
      fullRow(
        'order',
        `${store}    ·    ${labels[2]} ${++orderNumber}    ·    ${orderMonths.join(' / ')}`,
        25,
        6
      )
    let firstRow, currentMonth
    for (const row of sources) {
      const identity = JSON.stringify([
        row.accountId || 'local',
        row.orderId,
        row.entryId,
      ])
      if (seenProducts.has(identity))
        throw new Error(
          'A source product occurs twice in the packing workbook.'
        )
      seenProducts.add(identity)
      if (mixedMonths && (!firstRow || row.packingMonth !== currentMonth)) {
        fullRow('month', `${labels[5]}: ${row.packingMonth || '—'}`, 20, 7)
        currentMonth = row.packingMonth
      }
      const current = addRow('product', 98)
      firstRow ??= current
      const n = current.number,
        cells = columns.map((column) =>
          moneyColumns.has(column.key) || measurementColumns.has(column.key)
            ? numberCell('', numericStyle(column.key))
            : textCell('')
        )
      const set = (key, cell) => {
        if (indexes.has(key)) cells[indexes.get(key)] = cell
      }
      const batch = batches.get(batchIdentity(row))
      const cartonOwner = batch.complete && batch.owner === row
      const counts = Object.fromEntries(
        ['receivedBoxes', 'loadedBoxes'].map((key) => [
          key,
          cartonOwner ? decimal(batch.values[key], { integer: true }) : '',
        ])
      )
      const details = Object.fromEntries(
        [
          'cartonWeight',
          'cartonVolume',
          'cartonLength',
          'cartonWidth',
          'cartonHeight',
        ].map((key) => [key, cartonOwner ? decimal(batch.values[key]) : ''])
      )
      set('store', textCell(first(row.storeNumber, row.sellerName)))
      set('barcode', textCell(first(row.barcode, row.baseCode), 8))
      set('description', textCell(first(row.description, row.title)))
      set('spanishName', textCell(row.spanishName))
      set('productNumber', textCell(first(row.productNumber, row.model)))
      set('sourceSize', textCell(row.sourceSize))
      for (const [key, value] of Object.entries({
        ...counts,
        ...details,
        plannedBoxes: cartonOwner
          ? decimal(batch.plannedBoxes, { integer: true })
          : '',
        unitsPerCarton: row.unitsPerCarton ?? '',
        quantity: row.quantity ?? '',
        sourceUnitPrice: first(row.sourceUnitPrice, row.price),
        discount: row.discount ?? '',
        effectiveUnitPrice: first(row.effectiveUnitPrice, row.price),
        effectiveAmount: first(
          row.effectiveAmount,
          row.lineNetAmount,
          row.sourceAmount,
          row.lineAmount
        ),
      }))
        set(key, numberCell(value, numericStyle(key)))
      for (const [key, count, measurement] of [
        ['receivedWeight', 'receivedBoxes', 'cartonWeight'],
        ['loadedWeight', 'loadedBoxes', 'cartonWeight'],
        ['receivedVolume', 'receivedBoxes', 'cartonVolume'],
        ['loadedVolume', 'loadedBoxes', 'cartonVolume'],
      ]) {
        if (!cartonOwner) continue
        const a = address(count, n),
          b = address(measurement, n)
        set(
          key,
          formulaCell(
            `IF(AND(ISNUMBER(${a}),ISNUMBER(${b})),${a}*${b},"")`,
            excelNumber(counts[count]) && excelNumber(details[measurement])
              ? multiply(counts[count], details[measurement])
              : '',
            numericStyle(key),
            [count, measurement]
          )
        )
      }
      current.cells = cells
      products.push({
        source: row,
        row: n,
        cartonOwner,
        cartonComplete: batch.complete,
      })
    }
    const start = firstRow.number,
      end = sheetRows.length
    const orderSum = (key, value) => {
      const values = sheetRows
        .slice(start - 1, end)
        .map((row) => row.cells[indexes.get(key)]?.value ?? '')
      return formulaCell(
        totalFormula(`${letter(key)}${start}:${letter(key)}${end}`),
        values.some((value) => value !== '' && !excelNumber(value))
          ? ''
          : value,
        numericStyle(key, true),
        [key]
      )
    }
    firstRow.cells[indexes.get('orderQuantity')] = orderSum(
      'quantity',
      sum(sources.map((row) => decimal(row.quantity ?? '')))
    )
    firstRow.cells[indexes.get('orderAmount')] = orderSum(
      'effectiveAmount',
      sum(
        sources.map((row) =>
          decimal(
            first(
              row.effectiveAmount,
              row.lineNetAmount,
              row.sourceAmount,
              row.lineAmount
            )
          )
        )
      )
    )
    firstRow.cells[indexes.get('orderShipping')] = numberCell(
      source.orderShipping ?? '',
      numericStyle('orderShipping', true)
    )
  }
  const lastProductRow = sheetRows.length
  const total = includeTotals
    ? addRow(
        'total',
        32,
        columns.map(() => textCell('', 7))
      )
    : undefined
  if (total) total.cells[0] = textCell(labels[3], 7)
  if (total)
    for (const [target, key] of [
      ...[
        'receivedBoxes',
        'plannedBoxes',
        'quantity',
        'orderShipping',
        'discount',
        'effectiveAmount',
        'receivedWeight',
        'receivedVolume',
      ].map((key) => [key, key]),
      ['totalLoadedWeight', 'loadedWeight'],
      ['totalLoadedVolume', 'loadedVolume'],
      ['totalLoadedBoxes', 'loadedBoxes'],
    ]) {
      const index = indexes.get(key),
        range = `${letter(key)}6:${letter(key)}${lastProductRow}`
      total.cells[indexes.get(target)] = formulaCell(
        totalFormula(range),
        numericTotal(
          sheetRows
            .slice(5, -1)
            .map((row) => row.cells[index]?.value ?? '')
            .filter((value) => /^-?\d+(?:\.\d+)?$/.test(String(value)))
        ),
        numericStyle(key, true),
        [key]
      )
    }
  return projectColumns(
    {
      language,
      columns,
      rows: sheetRows,
      merges,
      products,
      months,
      createdAt: String(createdAt),
      palette: excelImagePalette(style),
      lastColumn,
      totalRow: total?.number,
      lastRow: sheetRows.length,
      lastProductRow,
      photoPixels,
      freezeHeaders,
      filters,
      totalLabel: labels[3],
      imageColumns: {
        photo: indexes.get('photo'),
        code: indexes.get('barcode'),
      },
    },
    selected
  )
}

function serializeCell(cell, row, column) {
  const ref = `${columnName(column)}${row}`,
    style = ` s="${cell.style}"`
  if (cell.formula) {
    const value = cell.value === '' ? ' t="str"' : ''
    return `<c r="${ref}"${style}${value}><f>${xml(cell.formula)}</f><v>${xml(cell.value)}</v></c>`
  }
  const value = String(cell.value ?? '')
  // Excel stores 15 significant digits: preserve larger source values as text.
  if (cell.type === 'number' && value && excelNumber(value))
    return `<c r="${ref}"${style}><v>${value}</v></c>`
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`
}

function sheetXml(plan, images) {
  const frozenColumns = Math.min(3, Math.max(0, plan.columns.length - 1))
  const pane = plan.freezeHeaders
    ? `<pane ${frozenColumns ? `xSplit="${frozenColumns}" ` : ''}ySplit="5" topLeftCell="${columnName(frozenColumns)}6" activePane="${frozenColumns ? 'bottomRight' : 'bottomLeft'}" state="frozen"/>`
    : ''
  return `${XML_HEADER}<worksheet xmlns="${MAIN}" xmlns:r="${REL}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${plan.lastColumn}${plan.lastRow}"/><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${plan.columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`).join('')}</cols><sheetData>${plan.rows.map((row) => `<row r="${row.number}" ht="${row.height}" customHeight="1">${row.cells.map((cell, index) => serializeCell(cell, row.number, index)).join('')}</row>`).join('')}</sheetData>${plan.filters ? `<autoFilter ref="A5:${plan.lastColumn}${plan.lastProductRow}"/>` : ''}${plan.merges.length ? `<mergeCells count="${plan.merges.length}">${plan.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : ''}<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;L1688toCSV&amp;R&amp;P / &amp;N</oddFooter></headerFooter>${images.length ? '<drawing r:id="drawing1"/>' : ''}</worksheet>`
}

function stylesXml(palette) {
  const color = (key) =>
    (
      palette[key] ||
      { body: '#ffffff', text: '#222222', muted: '#666666' }[key]
    )
      .slice(1)
      .toUpperCase()
  const xf = ({
    font = 0,
    fill = 6,
    border = 0,
    format = 0,
    centered = false,
    vertical = 'center',
  } = {}) =>
    `<xf numFmtId="${format}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="${vertical}" wrapText="1" ${centered ? 'horizontal="center"' : ''}/></xf>`
  const fonts = [
    `<font><sz val="11"/><name val="Calibri"/><color rgb="FF${color('text')}"/></font>`,
    `<font><b/><sz val="20"/><name val="Calibri"/><color rgb="FF${color('text')}"/></font>`,
    `<font><b/><sz val="10"/><name val="Calibri"/><color rgb="FF${color('headerText')}"/></font>`,
    `<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF${color('text')}"/></font>`,
    `<font><sz val="9"/><name val="Calibri"/><color rgb="FF${color('muted')}"/></font>`,
    '<font><sz val="9"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>',
  ]
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    ...['header', 'store', 'order'].map(
      (key) =>
        `<fill><patternFill patternType="solid"><fgColor rgb="FF${color(key)}"/><bgColor indexed="64"/></patternFill></fill>`
    ),
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>',
    `<fill><patternFill patternType="solid"><fgColor rgb="FF${color('body')}"/><bgColor indexed="64"/></patternFill></fill>`,
  ]
  // Style indexes are shared with numericStyle and the raster-code override.
  const styles = [
    xf(),
    xf({ font: 1 }),
    xf({ font: 4 }),
    xf({ font: 2, fill: 2, border: 1, centered: true }),
    xf({ border: 1 }),
    xf({ border: 1, centered: true }),
    xf({ font: 3, fill: 3, border: 1 }),
    xf({ font: 3, fill: 4, border: 1, centered: true }),
    xf({ font: 4, border: 1, centered: true, vertical: 'bottom' }),
    xf({ font: 5, fill: 5, border: 1, format: 164 }),
    xf({ border: 1, centered: true, format: 165 }),
    xf({ border: 1, centered: true, format: 166 }),
    xf({ font: 3, fill: 4, border: 1, centered: true, format: 165 }),
    xf({ font: 3, fill: 4, border: 1, centered: true, format: 166 }),
    xf({ border: 1, centered: true, format: 167 }),
    xf({ font: 3, fill: 4, border: 1, centered: true, format: 167 }),
    xf({ border: 1, centered: true, format: 168 }),
    xf({ font: 3, fill: 4, border: 1, centered: true, format: 168 }),
  ]
  const borders = [
    '<border/>',
    `<border>${['left', 'right', 'top', 'bottom'].map((side) => `<${side} style="thin"><color rgb="FF${color('grid')}"/></${side}>`).join('')}<diagonal/></border>`,
  ]
  return [
    XML_HEADER,
    `<styleSheet xmlns="${MAIN}">`,
    `<numFmts count="5">${[
      [164, ';;;'],
      [165, '#,##0.00" CNY"'],
      [166, '0.0##" kg"'],
      [167, '0.0#####" m³"'],
      [168, '0.0#" cm"'],
    ]
      .map(
        ([id, format]) =>
          `<numFmt numFmtId="${id}" formatCode="${xml(format)}"/>`
      )
      .join('')}</numFmts>`,
    `<fonts count="${fonts.length}">${fonts.join('')}</fonts>`,
    `<fills count="${fills.length}">${fills.join('')}</fills>`,
    `<borders count="${borders.length}">${borders.join('')}</borders>`,
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
    `<cellXfs count="${styles.length}">${styles.join('')}</cellXfs>`,
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  ].join('')
}

function imageSize(bytes, mimeType) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    mimeType === 'image/png' &&
    bytes.length >= 24 &&
    view.getUint32(0) === 0x89504e47 &&
    view.getUint32(4) === 0x0d0a1a0a
  )
    return { width: view.getUint32(16), height: view.getUint32(20) }
  if (mimeType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) break
      const marker = bytes[offset++]
      if (marker === 0xd9 || marker === 0xda) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 7)
        return {
          width: view.getUint16(offset + 5),
          height: view.getUint16(offset + 3),
        }
      offset += length
    }
  }
  throw new Error('Packing workbook images must be PNG or JPEG raster images.')
}

async function prepareWorkbookImages(plan, prepareImages) {
  if (
    !prepareImages ||
    Object.values(plan.imageColumns).every((column) => column === undefined)
  )
    return []
  const images = [],
    cache = new Map()
  let totalBytes = 0
  for (const product of plan.products) {
    const assets = await prepareImages(product.source, {
      photo:
        plan.imageColumns.photo === undefined
          ? undefined
          : { maxWidth: 320, maxHeight: 240 },
      code:
        plan.imageColumns.code === undefined
          ? undefined
          : { maxWidth: 512, maxHeight: 128 },
    })
    for (const kind of ['photo', 'code']) {
      const column = plan.imageColumns[kind]
      if (column === undefined) continue
      const asset = assets?.[kind]
      if (!asset) continue
      let bytes = asset.bytes ?? asset.blob
      if (bytes instanceof Blob)
        bytes = new Uint8Array(await bytes.arrayBuffer())
      else if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes)
      if (!(bytes instanceof Uint8Array))
        throw new Error('Packing workbook image bytes are missing.')
      const mimeType =
        asset.mimeType || (bytes[0] === 0x89 ? 'image/png' : 'image/jpeg')
      const size = imageSize(bytes, mimeType)
      const max = kind === 'photo' ? [320, 240] : [512, 128]
      if (
        !size.width ||
        !size.height ||
        size.width > max[0] ||
        size.height > max[1] ||
        bytes.length > 384 * 1024
      )
        throw new Error(
          'Packing workbook images must be resized before export.'
        )
      let media = cache.get(asset)
      if (!media) {
        totalBytes += bytes.length
        if (totalBytes > 24 * 1024 * 1024)
          throw new Error(
            'Packing workbook images exceed the export size limit.'
          )
        media = {
          bytes,
          mimeType,
          extension: mimeType === 'image/png' ? 'png' : 'jpg',
          id: cache.size + 1,
        }
        cache.set(asset, media)
      }
      const cellWidth = columnPixels(plan.columns[column].width)
      const cellHeight = plan.rows[product.row - 1].height / 0.75
      const box =
        kind === 'photo'
          ? [
              Math.min(plan.photoPixels, cellWidth - 12),
              Math.min(plan.photoPixels, cellHeight - 12),
            ]
          : [cellWidth - 16, Math.min(47, cellHeight - 16)]
      const scale = Math.min(box[0] / size.width, box[1] / size.height)
      const width = size.width * scale,
        height = size.height * scale
      images.push({
        kind,
        row: product.row - 1,
        column,
        width,
        height,
        x: (cellWidth - width) / 2,
        y: (cellHeight - height) / 2,
        media,
      })
    }
  }
  return images
}

function drawingXml(images) {
  return `${XML_HEADER}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}">${images.map((image, index) => `<xdr:oneCellAnchor><xdr:from><xdr:col>${image.column}</xdr:col><xdr:colOff>${emu(image.x)}</xdr:colOff><xdr:row>${image.row}</xdr:row><xdr:rowOff>${emu(image.y)}</xdr:rowOff></xdr:from><xdr:ext cx="${emu(image.width)}" cy="${emu(image.height)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${index + 1}" name="${image.kind}-${index + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="image${image.media.id}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(image.width)}" cy="${emu(image.height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`).join('')}</xdr:wsDr>`
}

/** Editable cells plus bounded, composed raster assets. No original photos are fetched here. */
export async function createPackingWorkbook(rows, options = {}) {
  const plan = planPackingWorkbook(rows, options)
  const images = await prepareWorkbookImages(plan, options.prepareImages)
  // Preserve the editable code string while its standard raster badge is visible.
  const codeRows = new Set(
    images
      .filter((image) => image.kind === 'code')
      .map((image) => image.row + 1)
  )
  const renderedPlan = {
    ...plan,
    rows: plan.rows.map((row) =>
      codeRows.has(row.number)
        ? {
            ...row,
            cells: row.cells.map((cell, column) =>
              column === plan.imageColumns.code ? { ...cell, style: 9 } : cell
            ),
          }
        : row
    ),
  }
  const media = [
    ...new Map(images.map((image) => [image.media.id, image.media])).values(),
  ]
  const relationships = (items) =>
    `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL}">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${xml(target)}"/>`).join('')}</Relationships>`
  const files = [
    [
      '[Content_Types].xml',
      `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...new Set(media.map((asset) => asset.extension))].map((extension) => `<Default Extension="${extension}" ContentType="image/${extension === 'jpg' ? 'jpeg' : 'png'}"/>`).join('')}<Override PartName="/xl/workbook.xml" ContentType="${MIME}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${MIME}.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${MIME}.worksheet+xml"/>${images.length ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}</Types>`,
    ],
    [
      '_rels/.rels',
      relationships([['workbook', 'officeDocument', 'xl/workbook.xml']]),
    ],
    [
      'xl/workbook.xml',
      `${XML_HEADER}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets><sheet name="Packing list" sheetId="1" r:id="sheet1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'Packing list'!$1:$5</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">'Packing list'!$A$1:$${plan.lastColumn}$${plan.lastRow}</definedName></definedNames><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      relationships([
        ['sheet1', 'worksheet', 'worksheets/sheet1.xml'],
        ['styles', 'styles', 'styles.xml'],
      ]),
    ],
    ['xl/styles.xml', stylesXml(plan.palette)],
    ['xl/worksheets/sheet1.xml', sheetXml(renderedPlan, images)],
  ]
  if (images.length)
    files.push(
      [
        'xl/worksheets/_rels/sheet1.xml.rels',
        relationships([['drawing1', 'drawing', '../drawings/drawing1.xml']]),
      ],
      ['xl/drawings/drawing1.xml', drawingXml(images)],
      [
        'xl/drawings/_rels/drawing1.xml.rels',
        relationships(
          media.map((asset) => [
            `image${asset.id}`,
            'image',
            `../media/image${asset.id}.${asset.extension}`,
          ])
        ),
      ],
      ...media.map((asset) => [
        `xl/media/image${asset.id}.${asset.extension}`,
        asset.bytes,
      ])
    )
  return createZip(
    files.map(([name, data]) => ({
      name,
      data: typeof data === 'string' ? encoder.encode(data) : data,
    }))
  )
}
