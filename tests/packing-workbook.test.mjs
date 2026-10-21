import test from 'node:test'
import assert from 'node:assert/strict'
import { CFB, read, SSF } from 'xlsx'
import { DOMParser } from 'linkedom'
import {
  createPackingWorkbook,
  planPackingWorkbook,
  PACKING_WORKBOOK_COLUMNS,
  PACKING_WORKBOOK_COLUMN_ORDER,
  PACKING_WORKBOOK_DEFAULT_COLUMNS,
} from '../src/packing-workbook.js'
import { columnName, crc32 } from '../src/xlsx-writer.js'

const defaults = { language: 'es', createdAt: '2026-10-21T08:00:00.000Z' }
// Calculation cases explicitly cover all reference fields after Store was retired.
const options = {
  ...defaults,
  columns: PACKING_WORKBOOK_COLUMNS.map(({ key }) => key),
}
const address = (key, row, settings = options) =>
  `${columnName(settings.columns.indexOf(key))}${row}`
const field = (sheet, key, row = 7, settings = options) =>
  sheet[address(key, row, settings)]
const source = (overrides = {}) => ({
  orderId: '1001',
  entryId: '1',
  sellerName: 'Synthetic store',
  storeNumber: '0007',
  packingMonth: '2026-10',
  barcode: 'CE26103102ALS',
  baseCode: 'CE26103102',
  description: '原始描述 < & >',
  spanishName: 'PRODUCTO',
  productNumber: '0001',
  sourceSize: '20 × 30 cm',
  quantity: '100',
  unitsPerCarton: 10,
  price: '10.00',
  sourceAmount: '1000.00',
  effectiveUnitPrice: '10.25',
  effectiveAmount: '1025.00',
  discount: '0.00',
  orderShipping: '20.00',
  cartonWeight: '2.50',
  cartonVolume: '0.05',
  receivedBoxes: '8',
  loadedBoxes: '6',
  ...overrides,
})
const cell = (plan, product, key) =>
  plan.rows[product.row - 1].cells[
    plan.columns.findIndex((column) => column.key === key)
  ]
const orderLabel = (plan, index = 0) =>
  plan.rows.filter((row) => row.kind === 'order')[index].cells[0].value
const partText = (archive, name) =>
  new TextDecoder().decode(
    archive.FileIndex[archive.FullPaths.indexOf(`Root Entry/${name}`)]?.content
  )

test('exactly one localized column header follows a blank spacer and preserves product offsets', () => {
  for (const language of ['en', 'es', 'zh']) {
    const plan = planPackingWorkbook([source()], { ...options, language })
    const headings = plan.rows.filter((row) => row.kind === 'header')
    assert.equal(headings.length, 1)
    assert.equal(
      headings[0].cells[0].value,
      { en: 'Photo', es: 'Foto', zh: '图片' }[language]
    )
    assert.equal(
      headings[0].cells[
        plan.columns.findIndex((column) => column.key === 'barcode')
      ].value,
      { en: 'Code', es: 'Código', zh: '标签货号' }[language]
    )
    assert.equal(plan.rows[3].kind, 'spacer')
    assert.equal(plan.rows[3].height, 6)
    assert.deepEqual(plan.rows[3].cells, [])
    assert.equal(
      plan.merges.some((range) => /4:.*4$/.test(range)),
      false
    )
    assert.equal(plan.rows[4].kind, 'header')
    assert.equal(plan.products[0].row, 7)
  }
})

function inspectZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pointer = 0
  while (view.getUint32(pointer, true) === 0x04034b50) {
    const crc = view.getUint32(pointer + 14, true),
      size = view.getUint32(pointer + 18, true)
    const nameLength = view.getUint16(pointer + 26, true),
      extra = view.getUint16(pointer + 28, true)
    const start = pointer + 30 + nameLength + extra
    assert.equal(crc32(bytes.subarray(start, start + size)), crc)
    pointer = start + size
  }
  return CFB.read(bytes, { type: 'array' })
}

test('recommended columns keep a compact single header, bounded descriptions and square photo cells', async () => {
  const expected = [
    'photo',
    'barcode',
    'cartonMark',
    'spanishName',
    'description',
    'productNumber',
    'sourceSize',
    'quantity',
    'unitsPerCarton',
    'plannedBoxes',
    'receivedBoxes',
    'loadedBoxes',
    'cartonWeight',
    'cartonVolume',
    'loadedWeight',
    'loadedVolume',
    'effectiveUnitPrice',
    'discount',
    'effectiveAmount',
  ]
  assert.deepEqual(PACKING_WORKBOOK_DEFAULT_COLUMNS, expected)
  assert.equal(PACKING_WORKBOOK_DEFAULT_COLUMNS.length, 19)
  assert.equal(PACKING_WORKBOOK_COLUMN_ORDER.length, 25)
  assert.equal(new Set(PACKING_WORKBOOK_COLUMN_ORDER).size, 25)
  assert.deepEqual(
    new Set(PACKING_WORKBOOK_COLUMN_ORDER),
    new Set(PACKING_WORKBOOK_COLUMNS.map(({ key }) => key))
  )
  for (const key of [
    'store',
    'orderQuantity',
    'orderShipping',
    'orderAmount',
    'totalLoadedBoxes',
    'totalLoadedWeight',
    'totalLoadedVolume',
    'payments',
    'deposits',
    'balance',
  ]) {
    assert.equal(
      PACKING_WORKBOOK_COLUMNS.some((column) => column.key === key),
      false
    )
    assert.throws(
      () => planPackingWorkbook([source()], { columns: [key] }),
      /supported.*column/
    )
  }
  const description = '完整产品说明与尺寸 '.repeat(100)
  const rows = [source({ description })]
  const plan = planPackingWorkbook(rows, defaults)
  assert.deepEqual(
    plan.columns.map(({ key }) => key),
    expected
  )
  assert.equal(plan.columns.find(({ key }) => key === 'description').width, 36)
  assert.equal(
    planPackingWorkbook(rows, {
      ...defaults,
      descriptionWidth: 'invalid',
    }).columns.find(({ key }) => key === 'description').width,
    36
  )
  assert.deepEqual(plan.columnGroups, [
    { start: 0, count: 7, label: 'Producto' },
    { start: 7, count: 5, label: 'Empaque' },
    { start: 12, count: 4, label: 'Medidas' },
    { start: 16, count: 3, label: 'Costos' },
  ])
  assert.equal(plan.rows.filter(({ kind }) => kind === 'header').length, 1)
  assert.equal(
    plan.rows.some(({ kind }) => kind === 'group'),
    false
  )
  assert.equal(
    plan.merges.some((range) => /[45]:.*[45]$/.test(range)),
    false
  )
  assert.equal(plan.columns[0].pixelWidth, 120)
  assert.equal(plan.rows[plan.products[0].row - 1].height, 90)
  assert.equal(cell(plan, plan.products[0], 'description').value, description)
  for (const column of plan.columns)
    assert.equal(
      column.pixelWidth,
      Math.floor(((256 * column.width + 18) / 256) * 7)
    )
  const bytes = await createPackingWorkbook(rows, defaults)
  const archive = inspectZip(bytes)
  const worksheet = partText(archive, 'xl/worksheets/sheet1.xml')
  assert.match(worksheet, /xSplit="2" ySplit="5" topLeftCell="C6"/)
  assert.match(worksheet, /<row r="4" ht="6" customHeight="1"><\/row>/)
  const sheet = read(bytes, { type: 'array' }).Sheets['Packing list']
  assert.equal(sheet.E7.v, description)
  assert.equal(sheet.A5.v, 'Foto')
})

test('only the leading photo and code pair freezes columns', async () => {
  for (const columns of [
    ['barcode', 'photo', 'description'],
    ['description', 'photo', 'barcode'],
    ['photo', 'description', 'barcode'],
  ]) {
    const archive = inspectZip(
      await createPackingWorkbook([source()], { ...defaults, columns })
    )
    const worksheet = partText(archive, 'xl/worksheets/sheet1.xml')
    assert.doesNotMatch(worksheet, /xSplit=/)
    assert.match(worksheet, /ySplit="5" topLeftCell="A6"/)
  }
})

test('stage colors match preview metadata and preserve separate numeric values, blanks and zero', async () => {
  const rows = [source({ receivedBoxes: '', loadedBoxes: '0' })]
  const settings = {
    ...defaults,
    language: 'en',
    style: { scheme: 'custom', accent: '#336699' },
  }
  const plan = planPackingWorkbook(rows, settings)
  const archive = inspectZip(await createPackingWorkbook(rows, settings))
  const document = new DOMParser().parseFromString(
    partText(archive, 'xl/styles.xml'),
    'text/xml'
  )
  const styles = document.querySelector('cellXfs').children
  const fills = document.querySelector('fills').children
  const border = document.querySelector('borders').children[2]
  assert.equal(border.querySelector('left').getAttribute('style'), 'thin')
  assert.notEqual(
    border.querySelector('left color').getAttribute('rgb'),
    border.querySelector('right color').getAttribute('rgb')
  )
  const expected = [
    ['plannedBoxes', 'planned', '#f9fafc', '#336699', '10'],
    ['receivedBoxes', 'received', '#f3f6f9', '#336699', ''],
    ['loadedBoxes', 'loaded', '#ebf0f5', '#336699', '0'],
  ]
  const header = plan.rows.find(({ kind }) => kind === 'header')
  const sheet = read(await createPackingWorkbook(rows, settings), {
    type: 'array',
  }).Sheets['Packing list']
  for (const [key, boxStage, stageBackground, stageHeader, value] of expected) {
    const index = plan.columns.findIndex((column) => column.key === key)
    assert.equal(plan.columns[index].boxStage, boxStage)
    assert.equal(plan.columns[index].stageBackground, stageBackground)
    assert.equal(plan.columns[index].stageHeader, stageHeader)
    assert.equal(cell(plan, plan.products[0], key).value, value)
    for (const [plannedCell, color, numeric] of [
      [header.cells[index], stageHeader, false],
      [cell(plan, plan.products[0], key), stageBackground, true],
      [plan.rows.at(-1).cells[index], stageBackground, true],
    ]) {
      const style = styles[plannedCell.style]
      const fill = fills[Number(style.getAttribute('fillId'))]
      assert.equal(
        fill.querySelector('fgColor').getAttribute('rgb'),
        `FF${color.slice(1).toUpperCase()}`
      )
      assert.equal(style.getAttribute('borderId'), '2')
      if (numeric)
        assert.equal(
          style.querySelector('alignment').getAttribute('horizontal'),
          'center'
        )
    }
    const nativeCell = sheet[`${columnName(index)}7`]
    assert.equal(nativeCell.v ?? '', value === '' ? '' : Number(value))
    assert.equal(nativeCell.f, undefined)
    if (value !== '') assert.equal(nativeCell.t, 'n')
  }
  assert.match(
    plan.rows.find(({ kind }) => kind === 'note').cells[0].value,
    /^Planned → Received → Loaded\. Blank = unknown; 0 = confirmed none\./
  )
  for (const [language, prefix] of [
    [
      'es',
      'Planificadas → Recibidas → Cargadas. Vacío = desconocido; 0 = ninguna confirmada.',
    ],
    ['zh', '计划 → 实收 → 装柜。空白 = 未知；0 = 确认无。'],
  ])
    assert.ok(
      planPackingWorkbook(rows, { ...defaults, language })
        .rows.find(({ kind }) => kind === 'note')
        .cells[0].value.startsWith(prefix)
    )
})

test('large legitimate numeric values widen editable columns without changing exact stored decimals', async () => {
  const rows = [
    source({
      quantity: '123456789012345',
      effectiveAmount: '1234567890123.45',
      cartonWeight: '1234567890.123',
      receivedBoxes: '2',
      loadedBoxes: '1',
    }),
  ]
  const settings = {
    ...defaults,
    columns: ['quantity', 'effectiveAmount', 'cartonWeight', 'receivedWeight'],
  }
  const plan = planPackingWorkbook(rows, settings)
  const bytes = await createPackingWorkbook(rows, settings)
  const sheet = read(bytes, { type: 'array', cellNF: true }).Sheets[
    'Packing list'
  ]
  for (const [key, raw] of [
    ['quantity', '123456789012345'],
    ['effectiveAmount', '1234567890123.45'],
    ['cartonWeight', '1234567890.123'],
    ['receivedWeight', '2469135780.246'],
  ]) {
    const index = plan.columns.findIndex((column) => column.key === key)
    const nativeCell = sheet[`${columnName(index)}7`]
    assert.equal(nativeCell.v, Number(raw))
    assert.equal(nativeCell.t, 'n')
    assert.ok(
      plan.columns[index].width >= nativeCell.w.length + 2,
      `${key}: ${nativeCell.w}`
    )
    assert.ok(
      plan.columns[index].width >
        PACKING_WORKBOOK_COLUMNS.find((column) => column.key === key).width
    )
    assert.equal(cell(plan, plan.products[0], key).value, raw)
  }
  const footer = sheet[`B${plan.lastRow}`]
  assert.ok(plan.columns[1].width >= footer.w.length + 2)
  const document = new DOMParser().parseFromString(
    partText(inspectZip(bytes), 'xl/styles.xml'),
    'text/xml'
  )
  const styles = document.querySelector('cellXfs').children
  for (const planned of plan.rows.filter(({ kind }) =>
    ['product', 'total'].includes(kind)
  ))
    for (const plannedCell of planned.cells)
      assert.equal(
        styles[plannedCell.style]
          .querySelector('alignment')
          .getAttribute('horizontal'),
        'center'
      )
})

test('order bands total only the selected source quantities and distinguish zero from unknown', () => {
  const rows = [
    source({ quantity: '0' }),
    source({ entryId: '2', quantity: '12' }),
  ]
  const label = (plan) =>
    plan.rows.find(({ kind }) => kind === 'order').cells[0].value
  assert.match(label(planPackingWorkbook(rows, defaults)), /Cantidad: 12 ·/)
  assert.match(
    label(planPackingWorkbook(rows.slice(0, 1), defaults)),
    /Cantidad: 0 ·/
  )
  assert.match(
    label(planPackingWorkbook(rows.slice(1), defaults)),
    /Cantidad: 12 ·/
  )
  assert.doesNotMatch(
    label(planPackingWorkbook([source({ quantity: '' })], defaults)),
    /Cantidad:/
  )
})

test('localized order headings carry known source and loaded summaries, preserving zero and unknown batches', async () => {
  for (const [language, labels] of [
    [
      'en',
      [
        'Qty',
        'Freight',
        'Goods',
        'Loaded boxes',
        'Loaded weight',
        'Loaded volume',
      ],
    ],
    [
      'es',
      [
        'Cantidad',
        'Envío',
        'Productos',
        'Cajas cargadas',
        'Peso cargado',
        'Vol. cargado',
      ],
    ],
    ['zh', ['数量', '运费', '商品金额', '装柜箱数', '装柜重量', '装柜体积']],
  ]) {
    const zero = source({
        orderId: '900000000000000001',
        quantity: '0',
        orderShipping: '0',
        effectiveAmount: '0',
        loadedBoxes: '0',
        cartonWeight: '0',
        cartonVolume: '0',
      }),
      plan = planPackingWorkbook([zero], { ...defaults, language }),
      header = orderLabel(plan)
    assert.ok(header.includes(`${labels[0]}: 0`))
    assert.ok(header.includes(`${labels[1]}: 0.00 元`))
    assert.ok(header.includes(`${labels[2]}: 0.00 元`))
    assert.ok(header.includes(`${labels[3]}: 0`))
    assert.ok(header.includes(`${labels[4]}: 0 kg`))
    assert.ok(header.includes(`${labels[5]}: 0 m³`))
    assert.equal(header.includes(zero.orderId), false)
    assert.equal(header.split('\n').length, 2)
    for (const column of plan.columns)
      assert.doesNotMatch(column.labels[language], /CNY|¥/)
    const bytes = await createPackingWorkbook([zero], {
        ...defaults,
        language,
      }),
      document = new DOMParser().parseFromString(
        partText(inspectZip(bytes), 'xl/styles.xml'),
        'text/xml'
      )
    for (const [index, style] of [
      ...document.querySelector('cellXfs').children,
    ].entries()) {
      assert.equal(
        style.querySelector('alignment').getAttribute('horizontal'),
        index === 28 ? 'left' : 'center'
      )
      assert.equal(
        style.querySelector('alignment').getAttribute('vertical'),
        'center'
      )
    }
  }
  const unknown = planPackingWorkbook(
    [
      source({
        quantity: '',
        orderShipping: undefined,
        effectiveAmount: '',
        sourceAmount: '',
        loadedBoxes: undefined,
        cartonWeight: undefined,
        cartonVolume: undefined,
      }),
    ],
    defaults
  )
  assert.doesNotMatch(
    orderLabel(unknown),
    /Cantidad:|Envío:|Productos:|Cajas cargadas|Peso cargado|Vol\. cargado/
  )
  const partial = planPackingWorkbook(
    [source({ sourceRow: 9, sourceRowEntryIds: ['1', '2'], loadedBoxes: '6' })],
    defaults
  )
  assert.doesNotMatch(
    orderLabel(partial),
    /Cajas cargadas|Peso cargado|Vol\. cargado/
  )
})

test('the planner preserves the reference columns, omits payment categories, and groups real transactions', () => {
  const plan = planPackingWorkbook(
    [
      source(),
      source({
        orderId: '1002',
        entryId: '1',
        quantity: '20',
        effectiveAmount: '205.00',
      }),
      source({ entryId: '2', quantity: '30', effectiveAmount: '307.50' }),
    ],
    options
  )
  assert.equal(PACKING_WORKBOOK_COLUMNS.length, 25)
  assert.equal(plan.columns.length, 25)
  assert.deepEqual(
    plan.columns.slice(-3).map((column) => column.reference),
    ['Y', 'Z', 'AA']
  )
  assert.equal(
    plan.columns.some((column) =>
      ['payments', 'deposits', 'balance'].includes(column.key)
    ),
    false
  )
  assert.deepEqual(
    plan.products.map((product) => [
      product.source.orderId,
      product.source.entryId,
    ]),
    [
      ['1001', '1'],
      ['1001', '2'],
      ['1002', '1'],
    ]
  )
  assert.equal(plan.rows.filter((row) => row.kind === 'order').length, 2)
  assert.deepEqual(
    plan.rows
      .filter((row) => row.kind === 'order')
      .map((row) => row.cells[0].value),
    [
      '0007 · Synthetic store    ·    Pedido 1    ·    2026-10\nCantidad: 130 · Envío: 20.00 元 · Productos: 1,332.50 元 · Cajas cargadas: 12 · Peso cargado: 30.00 kg · Vol. cargado: 0.60 m³',
      '0007 · Synthetic store    ·    Pedido 2    ·    2026-10\nCantidad: 20 · Envío: 20.00 元 · Productos: 205.00 元 · Cajas cargadas: 6 · Peso cargado: 15.00 kg · Vol. cargado: 0.30 m³',
    ]
  )
  assert.equal(cell(plan, plan.products[0], 'effectiveAmount').value, '1025.00')
  assert.equal((orderLabel(plan).match(/Envío:/g) || []).length, 1)
  assert.equal((orderLabel(plan).match(/Productos:/g) || []).length, 1)
})

test('planned, confirmed received and confirmed loaded cartons remain distinct with zero and blanks', () => {
  const plan = planPackingWorkbook(
    [
      source({ receivedBoxes: '0', loadedBoxes: undefined }),
      source({
        entryId: '2',
        receivedBoxes: undefined,
        loadedBoxes: '2',
        cartonWeight: '0',
        cartonVolume: '0',
      }),
    ],
    options
  )
  const [a, b] = plan.products
  assert.equal(cell(plan, a, 'plannedBoxes').value, '10')
  assert.equal(cell(plan, a, 'receivedBoxes').value, '0')
  assert.equal(cell(plan, a, 'loadedBoxes').value, '')
  assert.equal(cell(plan, a, 'receivedWeight').value, '0.00')
  assert.equal(cell(plan, a, 'loadedWeight').value, '')
  assert.equal(cell(plan, b, 'loadedWeight').value, '0')
  assert.equal(cell(plan, b, 'loadedVolume').value, '0')
  const total = (key) =>
    plan.rows.at(-1).cells[
      plan.columns.findIndex((column) => column.key === key)
    ]
  assert.equal(total('receivedBoxes').value, '0')
  assert.match(orderLabel(plan), /Cajas cargadas \(conocido\): 2/)
  assert.equal(total('loadedBoxes').value, '')
  assert.match(orderLabel(plan), /Peso cargado \(conocido\): 0 kg/)
  assert.match(orderLabel(plan), /Vol\. cargado \(conocido\): 0 m³/)
  const unknown = planPackingWorkbook(
    [source({ receivedBoxes: '', loadedBoxes: '' })],
    options
  )
  assert.equal(unknown.rows.at(-1).cells.at(-1).value, '')
  assert.doesNotMatch(
    orderLabel(unknown),
    /Cajas cargadas|Peso cargado|Vol\. cargado/
  )
})

test('a complete allocated source row owns cartons once and a partial row cannot claim them', () => {
  const a = source({
    sourceType: 'spreadsheet',
    sourceRow: 9,
    sourceRowEntryIds: ['1', '2'],
    cartons: '3',
    receivedBoxes: '2',
    loadedBoxes: '1',
    quantity: '12',
  })
  const b = source({ ...a, entryId: '2', cartons: undefined, quantity: '18' })
  const complete = planPackingWorkbook([a, b], options)
  assert.deepEqual(
    complete.products.map((product) => product.cartonOwner),
    [true, false]
  )
  assert.equal(cell(complete, complete.products[0], 'plannedBoxes').value, '3')
  assert.equal(cell(complete, complete.products[1], 'receivedBoxes').value, '')
  assert.equal(
    cell(complete, complete.products[0], 'receivedWeight').value,
    '5.00'
  )
  const partial = planPackingWorkbook([a], options)
  assert.equal(partial.products[0].cartonComplete, false)
  for (const key of [
    'plannedBoxes',
    'receivedBoxes',
    'loadedBoxes',
    'receivedWeight',
    'loadedVolume',
  ])
    assert.equal(cell(partial, partial.products[0], key).value, '')
  const conflicting = planPackingWorkbook(
    [a, { ...b, receivedBoxes: '3' }],
    options
  )
  assert.equal(
    cell(conflicting, conflicting.products[0], 'receivedBoxes').value,
    ''
  )
  assert.equal(
    cell(conflicting, conflicting.products[0], 'loadedBoxes').value,
    '1'
  )
})

test('source row identity is order-specific, remainders stay unknown, and incomplete explicit batches stay blank', () => {
  const plan = planPackingWorkbook(
    [
      source({ sourceRow: 4, sourceRowComplete: true, cartons: '5' }),
      source({
        orderId: '1002',
        sourceRow: 4,
        sourceRowComplete: true,
        cartons: '6',
      }),
      source({
        orderId: '1003',
        quantity: '105',
        receivedBoxes: undefined,
        loadedBoxes: undefined,
      }),
      source({
        orderId: '1004',
        cartonBatchId: 'shared',
        cartonBatchComplete: false,
        cartons: '9',
      }),
    ],
    options
  )
  assert.deepEqual(
    plan.products.map((product) => cell(plan, product, 'plannedBoxes').value),
    ['5', '6', '', '']
  )
  assert.throws(
    () => planPackingWorkbook([source(), source()], options),
    /occurs twice/
  )
  assert.throws(
    () => planPackingWorkbook([source({ loadedBoxes: '-1' })], options),
    /box count/
  )
})

test('confirmation batches cannot become complete by combining different packing months', () => {
  const common = {
    cartonBatchId: 'source-9',
    cartonBatchEntryIds: ['1', '2'],
    cartons: '3',
    receivedBoxes: '2',
    loadedBoxes: '1',
  }
  const plan = planPackingWorkbook(
    [
      source(common),
      source({ ...common, entryId: '2', packingMonth: '2026-11' }),
    ],
    options
  )
  assert.deepEqual(
    plan.products.map((product) => product.cartonComplete),
    [false, false]
  )
  assert.deepEqual(
    plan.products.map((product) => cell(plan, product, 'receivedBoxes').value),
    ['', '']
  )
  const single = planPackingWorkbook(
    [source({ cartonBatchId: '1', plannedBoxes: '10' })],
    options
  )
  assert.equal(cell(single, single.products[0], 'receivedBoxes').value, '8')
})

test('mixed-month orders keep interleaved product order and label every month change without duplicating purchase totals', async () => {
  const rows = [
    source({
      entryId: '1',
      packingMonth: '2026-10',
      quantity: '10',
      effectiveAmount: '100.00',
      receivedBoxes: '1',
      loadedBoxes: '0',
    }),
    source({
      entryId: '2',
      packingMonth: '2026-11',
      quantity: '20',
      effectiveAmount: '250.00',
      receivedBoxes: '2',
      loadedBoxes: '2',
    }),
    source({
      entryId: '3',
      packingMonth: '2026-10',
      quantity: '30',
      effectiveAmount: '360.00',
      receivedBoxes: '3',
      loadedBoxes: '1',
      cartonWeight: '4',
    }),
  ]
  const plan = planPackingWorkbook(rows, options)
  assert.deepEqual(
    plan.products.map((product) => product.source.entryId),
    ['1', '2', '3']
  )
  assert.deepEqual(
    plan.products.map((product) => product.row),
    [8, 10, 12]
  )
  assert.deepEqual(
    plan.rows
      .filter((row) => row.kind === 'month')
      .map((row) => row.cells[0].value),
    [
      'Mes de empaque: 2026-10',
      'Mes de empaque: 2026-11',
      'Mes de empaque: 2026-10',
    ]
  )
  assert.match(
    plan.rows.find((row) => row.kind === 'order').cells[0].value,
    /2026-10 \/ 2026-11\nCantidad: 60 ·/
  )
  assert.deepEqual(
    plan.products.map((product) => cell(plan, product, 'receivedBoxes').value),
    ['1', '2', '3']
  )
  assert.deepEqual(
    plan.products.map((product) => cell(plan, product, 'loadedBoxes').value),
    ['0', '2', '1']
  )
  assert.match(orderLabel(plan), /Envío: 20\.00 元 · Productos: 710\.00 元/)
  assert.match(
    orderLabel(plan),
    /Cajas cargadas: 3 · Peso cargado: 9\.00 kg · Vol\. cargado: 0\.15 m³/
  )
  for (const row of plan.rows.filter((row) => row.kind === 'month'))
    assert.equal(row.cells.length, 1)
  const sheet = read(await createPackingWorkbook(rows, options), {
    type: 'array',
  }).Sheets['Packing list']
  assert.equal(sheet.A7.v, 'Mes de empaque: 2026-10')
  assert.equal(sheet.A9.v, 'Mes de empaque: 2026-11')
  assert.equal(sheet.A11.v, 'Mes de empaque: 2026-10')
  assert.equal(sheet.A6.v, orderLabel(plan))
  assert.equal(field(sheet, 'effectiveAmount', 8).v, 100)
  assert.equal(field(sheet, 'effectiveAmount', 10).v, 250)
  assert.equal(field(sheet, 'effectiveAmount', 12).v, 360)
  assert.equal(field(sheet, 'loadedWeight', 12).v, 4)
  assert.equal(
    planPackingWorkbook([source()], options).rows.some(
      (row) => row.kind === 'month'
    ),
    false
  )
})

test('the workbook is styled and editable with literal identifiers, safe text and recalculating formulas', async () => {
  const rows = [
    source({ productNumber: '=1+1', storeNumber: '0007' }),
    source({
      entryId: '2',
      receivedBoxes: '',
      loadedBoxes: '0',
      cartonVolume: '0',
    }),
  ]
  const bytes = await createPackingWorkbook(rows, options)
  const archive = inspectZip(bytes)
  const workbook = read(bytes, { type: 'array', cellStyles: true })
  const sheet = workbook.Sheets['Packing list']
  assert.equal(field(sheet, 'productNumber').v, '=1+1')
  assert.equal(field(sheet, 'productNumber').t, 's')
  assert.equal(field(sheet, 'productNumber').f, undefined)
  assert.equal(field(sheet, 'barcode').v, 'CE26103102ALS')
  assert.equal(field(sheet, 'loadedBoxes').t, 'n')
  assert.equal(field(sheet, 'loadedBoxes').v, 6)
  assert.equal(field(sheet, 'loadedBoxes', 8).v, 0)
  assert.equal(field(sheet, 'receivedBoxes', 8).v ?? '', '')
  assert.equal(field(sheet, 'description').v, '原始描述 < & >')
  assert.equal(field(sheet, 'receivedWeight').v, 20)
  const count = address('loadedBoxes', 7),
    weight = address('cartonWeight', 7)
  assert.equal(
    field(sheet, 'loadedWeight').f,
    `IF(AND(ISNUMBER(${count}),ISNUMBER(${weight})),${count}*${weight},"")`
  )
  assert.equal(field(sheet, 'loadedWeight').v, 15)
  assert.ok(sheet['!merges'].length >= 4)
  const worksheet = partText(archive, 'xl/worksheets/sheet1.xml')
  assert.match(worksheet, /xSplit="2" ySplit="5" topLeftCell="C6"/)
  assert.match(worksheet, /autoFilter ref="A5:Y8"/)
  assert.match(worksheet, /0007 · Synthetic store/)
  assert.match(
    worksheet,
    /orientation="landscape" fitToWidth="1" fitToHeight="0"/
  )
  assert.match(worksheet, /<row r="7" ht="90" customHeight="1">/)
  assert.match(
    partText(archive, 'xl/workbook.xml'),
    /fullCalcOnLoad="1" forceFullCalc="1"/
  )
  assert.match(partText(archive, 'xl/styles.xml'), /patternType="solid"/)
  assert.match(
    partText(archive, 'xl/styles.xml'),
    /vertical="center" horizontal="center" wrapText="1"/
  )
  for (let index = 0; index < archive.FullPaths.length; index++) {
    if (!archive.FullPaths[index].endsWith('.xml')) continue
    const document = new DOMParser().parseFromString(
      new TextDecoder().decode(archive.FileIndex[index].content),
      'text/xml'
    )
    assert.equal(
      document.querySelector('parsererror'),
      null,
      archive.FullPaths[index]
    )
  }
  // SheetJS/CFB annotates input typed arrays; compare the actual package bytes.
  assert.deepEqual(
    Buffer.from(bytes),
    Buffer.from(await createPackingWorkbook(rows, options))
  )
})

const png = () =>
  new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64'
    )
  )

const rectangle = (width, height) => {
  const bytes = png()
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return { bytes, mimeType: 'image/png' }
}

test('bounded raster assets have complete drawing, sheet and content-type relationships', async () => {
  const asset = { bytes: png(), mimeType: 'image/png' },
    calls = []
  const bytes = await createPackingWorkbook(
    [source(), source({ entryId: '2' })],
    {
      ...options,
      prepareImages: async (row, bounds) => {
        calls.push([row.entryId, bounds])
        return {
          photo: asset,
          code: { bytes: new Blob([png()]), mimeType: 'image/png' },
        }
      },
    }
  )
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0][1].photo, { maxWidth: 320, maxHeight: 240 })
  assert.deepEqual(calls[0][1].mark, { maxWidth: 320, maxHeight: 240 })
  const archive = inspectZip(bytes)
  assert.equal(
    archive.FullPaths.filter((name) => /xl\/media\/image\d+\.png$/.test(name))
      .length,
    3
  )
  const drawing = partText(archive, 'xl/drawings/drawing1.xml')
  assert.equal((drawing.match(/<xdr:oneCellAnchor>/g) || []).length, 4)
  assert.match(drawing, /<xdr:col>1<\/xdr:col>/)
  assert.match(drawing, /<xdr:row>6<\/xdr:row>/)
  assert.match(drawing, /<a:picLocks noChangeAspect="1"\/>/)
  assert.match(drawing, /cx="1143000" cy="1143000"/)
  const rels = partText(archive, 'xl/drawings/_rels/drawing1.xml.rels')
  assert.equal((rels.match(/Type="[^"]+\/image"/g) || []).length, 3)
  assert.match(rels, /Target="\.\.\/media\/image1.png"/)
  assert.match(
    partText(archive, 'xl/worksheets/_rels/sheet1.xml.rels'),
    /Id="drawing1"/
  )
  assert.match(
    partText(archive, '[Content_Types].xml'),
    /Extension="png" ContentType="image\/png"/
  )
  assert.match(
    partText(archive, 'xl/worksheets/sheet1.xml'),
    /<drawing r:id="drawing1"\/>/
  )
  assert.equal(
    field(read(bytes, { type: 'array' }).Sheets['Packing list'], 'barcode').v,
    'CE26103102ALS'
  )
})

test('visible order bands omit internal IDs and raster codes hide duplicate native text without losing its value', async () => {
  const first = source({ orderId: '900000000000000001' })
  const second = source({ orderId: '900000000000000002' })
  const bytes = await createPackingWorkbook([first, second], {
    ...options,
    prepareImages: async (row) =>
      row.orderId === first.orderId
        ? { code: { bytes: png(), mimeType: 'image/png' } }
        : {},
  })
  const archive = inspectZip(bytes)
  const worksheet = partText(archive, 'xl/worksheets/sheet1.xml')
  assert.equal(worksheet.includes(first.orderId), false)
  assert.equal(worksheet.includes(second.orderId), false)
  assert.match(worksheet, /Pedido 1/)
  assert.match(worksheet, /Pedido 2/)
  const sheet = read(bytes, { type: 'array', cellNF: true }).Sheets[
    'Packing list'
  ]
  assert.equal(field(sheet, 'barcode').v, first.barcode)
  assert.equal(field(sheet, 'barcode').z, ';;;')
  assert.equal(field(sheet, 'barcode', 9).v, second.barcode)
  assert.notEqual(field(sheet, 'barcode', 9).z, ';;;')
  assert.ok(
    worksheet.includes(`<c r="${address('barcode', 7)}" s="9" t="inlineStr">`)
  )
  assert.ok(
    worksheet.includes(`<c r="${address('barcode', 9)}" s="8" t="inlineStr">`)
  )
  assert.match(
    partText(archive, 'xl/styles.xml'),
    /numFmtId="164" formatCode=";;;"/
  )
  const styles = new DOMParser().parseFromString(
    partText(archive, 'xl/styles.xml'),
    'text/xml'
  )
  const hidden = styles.querySelector('cellXfs').children[9]
  assert.equal(hidden.getAttribute('fontId'), '5')
  assert.equal(hidden.getAttribute('fillId'), '5')
  assert.equal(hidden.getAttribute('numFmtId'), '164')
  assert.equal(
    styles
      .querySelector('fonts')
      .children[5].querySelector('color')
      .getAttribute('rgb'),
    'FFFFFFFF'
  )
  assert.equal(
    styles
      .querySelector('fills')
      .children[5].querySelector('fgColor')
      .getAttribute('rgb'),
    'FFFFFFFF'
  )
  assert.equal(
    styles.querySelector('cellXfs').children[8].getAttribute('fontId'),
    '4'
  )
})

test('money and measurements display typed units without rounding their underlying values', async () => {
  const rows = [
    source({
      sourceUnitPrice: '12.5',
      effectiveUnitPrice: '18.91234567',
      effectiveAmount: '1234567.89',
      discount: '0.1',
      cartonWeight: '1.234567891',
      cartonVolume: '0.012345678',
      receivedBoxes: '2',
      loadedBoxes: '1',
    }),
    source({ entryId: '2', effectiveAmount: '12.50' }),
  ]
  const bytes = await createPackingWorkbook(rows, options)
  const sheet = read(bytes, { type: 'array', cellNF: true }).Sheets[
    'Packing list'
  ]
  for (const [key, row] of [
    ['sourceUnitPrice', 7],
    ['discount', 7],
    ['effectiveUnitPrice', 7],
    ['effectiveAmount', 7],
    ['discount', 9],
    ['effectiveAmount', 9],
  ]) {
    assert.equal(field(sheet, key, row).z, '#,##0.00" 元"', key)
    assert.equal(field(sheet, key, row).t, 'n', key)
  }
  assert.equal(field(sheet, 'sourceUnitPrice').v, 12.5)
  assert.equal(field(sheet, 'sourceUnitPrice').w, '12.50 元')
  assert.equal(field(sheet, 'discount').w, '0.10 元')
  assert.equal(field(sheet, 'effectiveUnitPrice').v, 18.91234567)
  assert.equal(field(sheet, 'effectiveUnitPrice').w, '18.91 元')
  assert.equal(field(sheet, 'effectiveAmount').v, 1234567.89)
  assert.equal(field(sheet, 'effectiveAmount').w, '1,234,567.89 元')
  assert.match(sheet.A6.v, /Productos: 1,234,580\.39 元/)
  for (const [key, row] of [
    ['cartonWeight', 7],
    ['receivedWeight', 7],
    ['loadedWeight', 7],
    ['receivedWeight', 9],
  ])
    assert.equal(field(sheet, key, row).z, '0.0##" kg"', key)
  for (const [key, row] of [
    ['cartonVolume', 7],
    ['receivedVolume', 7],
    ['loadedVolume', 7],
    ['receivedVolume', 9],
  ])
    assert.equal(field(sheet, key, row).z, '0.0#####" m³"', key)
  assert.equal(field(sheet, 'cartonWeight').v, 1.234567891)
  assert.equal(field(sheet, 'cartonWeight').w, '1.235 kg')
  assert.equal(field(sheet, 'cartonVolume').v, 0.012345678)
  assert.equal(field(sheet, 'cartonVolume').w, '0.012346 m³')
  assert.equal(SSF.format(field(sheet, 'cartonWeight').z, 57), '57.0 kg')
  assert.equal(SSF.format(field(sheet, 'cartonWeight').z, 0), '0.0 kg')
  assert.equal(SSF.format(field(sheet, 'cartonVolume').z, 0), '0.0 m³')
  assert.equal(SSF.format(field(sheet, 'cartonVolume').z, 1), '1.0 m³')
  const worksheet = partText(inspectZip(bytes), 'xl/worksheets/sheet1.xml')
  assert.ok(
    worksheet.includes(
      `<c r="${address('effectiveUnitPrice', 7)}" s="10"><v>18.91234567</v></c>`
    )
  )
  assert.ok(
    worksheet.includes(
      `<c r="${address('cartonVolume', 7)}" s="14"><v>0.012345678</v></c>`
    )
  )
})

test('Excel precision limits preserve large source values as text and leave dependent totals unresolved', async () => {
  const rows = [
    source({
      quantity: '9007199254740993',
      loadedBoxes: '9007199254740991',
      effectiveAmount: '1234567890123456.78',
    }),
  ]
  const plan = planPackingWorkbook(rows, options)
  assert.doesNotMatch(
    plan.rows.find((row) => row.kind === 'order').cells[0].value,
    /Cantidad:/
  )
  assert.doesNotMatch(
    orderLabel(plan),
    /Productos:|Cajas cargadas:|Peso cargado:|Vol\. cargado:/
  )
  assert.equal(cell(plan, plan.products[0], 'loadedWeight').value, '')
  assert.equal(plan.rows.at(-1).cells.at(-1).value, '')
  const sheet = read(await createPackingWorkbook(rows, options), {
    type: 'array',
  }).Sheets['Packing list']
  assert.equal(field(sheet, 'quantity').t, 's')
  assert.equal(field(sheet, 'quantity').v, '9007199254740993')
  assert.equal(field(sheet, 'effectiveAmount').v, '1234567890123456.78')
})

test('oversized or unsupported images and failed image preparation produce no partial workbook', async () => {
  const large = png(),
    view = new DataView(large.buffer)
  view.setUint32(16, 2048)
  await assert.rejects(
    createPackingWorkbook([source()], {
      ...options,
      prepareImages: async () => ({
        photo: { bytes: large, mimeType: 'image/png' },
      }),
    }),
    /resized/
  )
  await assert.rejects(
    createPackingWorkbook([source()], {
      ...options,
      prepareImages: async () => ({
        code: { bytes: encoder.encode('<svg/>'), mimeType: 'image/svg+xml' },
      }),
    }),
    /PNG or JPEG/
  )
  await assert.rejects(
    createPackingWorkbook([source()], {
      ...options,
      prepareImages: async () => {
        throw new Error('Synthetic photo failure')
      },
    }),
    /Synthetic photo failure/
  )
})

const encoder = new TextEncoder()

test('chosen columns retain their order and remap formulas without exporting hidden dependencies', async () => {
  const columns = [
    'loadedWeight',
    'cartonWeight',
    'loadedBoxes',
    'description',
    'effectiveAmount',
  ]
  const plan = planPackingWorkbook([source()], { ...options, columns })
  assert.deepEqual(
    plan.columns.map((column) => column.key),
    columns
  )
  assert.equal(plan.rows.find((row) => row.kind === 'header').cells.length, 5)
  assert.equal(cell(plan, plan.products[0], 'loadedWeight').value, '15.00')
  assert.equal(
    cell(plan, plan.products[0], 'loadedWeight').formula,
    'IF(AND(ISNUMBER(C7),ISNUMBER(B7)),C7*B7,"")'
  )
  assert.equal(cell(plan, plan.products[0], 'effectiveAmount').value, '1025.00')
  assert.equal(
    cell(plan, plan.products[0], 'effectiveAmount').formula,
    undefined
  )
  const bytes = await createPackingWorkbook([source()], { ...options, columns })
  const archive = inspectZip(bytes)
  const worksheet = partText(archive, 'xl/worksheets/sheet1.xml')
  const document = new DOMParser().parseFromString(worksheet, 'text/xml')
  assert.equal(document.querySelectorAll('cols col').length, 5)
  assert.equal(document.querySelector('[hidden="1"]'), null)
  for (const row of document.querySelectorAll('row'))
    assert.ok(row.querySelectorAll('c').length <= 5)
  assert.equal(worksheet.includes('undefined'), false)
  assert.equal(worksheet.includes('#REF!'), false)
  const sheet = read(bytes, { type: 'array' }).Sheets['Packing list']
  assert.equal(sheet.A7.f, 'IF(AND(ISNUMBER(C7),ISNUMBER(B7)),C7*B7,"")')
  assert.equal(sheet.E7.v, 1025)
  assert.equal(sheet.E7.f, undefined)
  assert.throws(
    () => planPackingWorkbook([source()], { columns: [] }),
    /column/
  )
  assert.throws(
    () => planPackingWorkbook([source()], { columns: ['payments'] }),
    /column/
  )
})

test('selected calculated fields keep zero, unknown and shared-carton ownership without their inputs', () => {
  const rows = [
    source({ sourceRow: 9, sourceRowEntryIds: ['1', '2'], loadedBoxes: '0' }),
    source({
      entryId: '2',
      sourceRow: 9,
      sourceRowEntryIds: ['1', '2'],
      loadedBoxes: '0',
    }),
    source({ entryId: '3', loadedBoxes: '' }),
  ]
  const plan = planPackingWorkbook(rows, {
    ...options,
    columns: ['loadedWeight', 'loadedVolume'],
  })
  assert.deepEqual(
    plan.products.map((product) => cell(plan, product, 'loadedWeight').value),
    ['0.00', '', '']
  )
  assert.deepEqual(
    plan.products.map((product) => cell(plan, product, 'loadedWeight').formula),
    [undefined, undefined, undefined]
  )
  assert.match(orderLabel(plan), /Cajas cargadas \(conocido\): 0/)
  assert.match(orderLabel(plan), /Peso cargado \(conocido\): 0\.00 kg/)
  assert.match(orderLabel(plan), /Vol\. cargado \(conocido\): 0\.00 m³/)
})

test('order details, totals, freezing and filters can be omitted with valid print and sheet bounds', async () => {
  const settings = {
    ...options,
    columns: ['quantity'],
    includeOrderDetails: false,
    includeTotals: false,
    freezeHeaders: false,
    filters: false,
  }
  const plan = planPackingWorkbook([source()], settings)
  assert.equal(
    plan.rows.some((row) => ['order', 'total'].includes(row.kind)),
    false
  )
  assert.equal(plan.products[0].row, 6)
  assert.equal(plan.totalRow, undefined)
  assert.equal(plan.lastRow, 6)
  const archive = inspectZip(await createPackingWorkbook([source()], settings))
  const worksheet = partText(archive, 'xl/worksheets/sheet1.xml')
  assert.match(worksheet, /dimension ref="A1:A6"/)
  assert.doesNotMatch(worksheet, /<pane|<autoFilter|<mergeCells/)
  assert.match(partText(archive, 'xl/workbook.xml'), /\$A\$1:\$A\$6/)
  const mixed = planPackingWorkbook(
    [source(), source({ entryId: '2', packingMonth: '2026-11' })],
    settings
  )
  assert.equal(mixed.rows.filter((row) => row.kind === 'month').length, 2)
})

test('description widths and wrapped row heights adapt within the chosen bounds', () => {
  const short = planPackingWorkbook([source({ description: '短说明' })], {
    ...options,
    columns: ['description'],
    descriptionWidth: 40,
  })
  const long = planPackingWorkbook(
    [source({ description: '完整产品说明与尺寸 '.repeat(40) })],
    { ...options, columns: ['description'], descriptionWidth: 40 }
  )
  assert.equal(short.columns[0].width, 24)
  assert.equal(long.columns[0].width, 40)
  assert.ok(
    long.rows[long.products[0].row - 1].height >
      short.rows[short.products[0].row - 1].height
  )
  assert.ok(long.rows[long.products[0].row - 1].height <= 240)
  assert.equal(
    cell(long, long.products[0], 'description').value,
    '完整产品说明与尺寸 '.repeat(40)
  )
  assert.equal(
    planPackingWorkbook([source({ description: '长'.repeat(200) })], {
      descriptionWidth: 999,
    }).columns.find((column) => column.key === 'description').width,
    60
  )
  const words = planPackingWorkbook(
    [source({ description: Array(8).fill('abcdefghijklmnop').join(' ') })],
    { ...options, columns: ['description'], descriptionWidth: 24 }
  )
  assert.ok(words.rows[words.products[0].row - 1].height >= 8 * 15)
})

test('workspace palette colors the native workbook body and text while code artwork retains white backing', async () => {
  const workspace = {
    header: '#d48a45',
    headerText: '#101010',
    store: '#41372e',
    order: '#2e2925',
    stripe: '#201c19',
    separator: '#705b48',
    grid: '#655342',
    body: '#211c18',
    text: '#f5e9dd',
    muted: '#cbb6a3',
  }
  const archive = inspectZip(
    await createPackingWorkbook([source()], {
      ...options,
      style: { workspace },
    })
  )
  const document = new DOMParser().parseFromString(
    partText(archive, 'xl/styles.xml'),
    'text/xml'
  )
  assert.equal(
    document
      .querySelector('fonts')
      .children[0].querySelector('sz')
      .getAttribute('val'),
    '11'
  )
  assert.equal(
    document
      .querySelector('fonts')
      .children[0].querySelector('color')
      .getAttribute('rgb'),
    'FFF5E9DD'
  )
  assert.equal(
    document
      .querySelector('fills')
      .children[6].querySelector('fgColor')
      .getAttribute('rgb'),
    'FF211C18'
  )
  assert.equal(
    document.querySelector('cellXfs').children[4].getAttribute('fillId'),
    '6'
  )
  const header = document.querySelector('cellXfs').children[3]
  assert.equal(
    document
      .querySelector('fills')
      .children[Number(header.getAttribute('fillId'))].querySelector('fgColor')
      .getAttribute('rgb'),
    'FFD48A45'
  )
  assert.equal(
    document
      .querySelector('fonts')
      .children[Number(header.getAttribute('fontId'))].querySelector('color')
      .getAttribute('rgb'),
    'FF101010'
  )
  assert.equal(
    document
      .querySelector('fills')
      .children[5].querySelector('fgColor')
      .getAttribute('rgb'),
    'FFFFFFFF'
  )
})

test('each drawing fits its selected cell and code badges never exceed native 16px scale', async () => {
  for (const photoSize of ['compact', 'standard', 'large']) {
    const settings = {
      ...options,
      columns: ['description', 'barcode', 'cartonMark', 'photo'],
      photoSize,
    }
    const plan = planPackingWorkbook([source()], settings)
    const archive = inspectZip(
      await createPackingWorkbook([source()], {
        ...settings,
        prepareImages: async () => ({
          photo: rectangle(240, 240),
          code: rectangle(512, 90),
          mark: rectangle(320, 240),
        }),
      })
    )
    const drawing = new DOMParser().parseFromString(
      partText(archive, 'xl/drawings/drawing1.xml'),
      'text/xml'
    )
    for (const anchor of drawing.querySelectorAll('xdr\\:oneCellAnchor')) {
      const from = anchor.querySelector('xdr\\:from')
      const column = Number(from.querySelector('xdr\\:col').textContent)
      const row = Number(from.querySelector('xdr\\:row').textContent)
      const x = Number(from.querySelector('xdr\\:colOff').textContent) / 9525
      const y = Number(from.querySelector('xdr\\:rowOff').textContent) / 9525
      const extent = anchor.querySelector('xdr\\:ext')
      const width = Number(extent.getAttribute('cx')) / 9525
      const height = Number(extent.getAttribute('cy')) / 9525
      if (plan.columns[column].key === 'photo') {
        assert.equal(x, 0)
        assert.equal(y, 0)
        assert.equal(
          width,
          Math.floor(((256 * plan.columns[column].width + 18) / 256) * 7)
        )
        assert.equal(height, width)
        assert.equal(plan.rows[row].height, width * 0.75)
        continue
      }
      if (plan.columns[column].key === 'barcode') {
        assert.ok(width <= 512 * 0.5)
        assert.ok(height <= 90 * 0.5)
      }
      assert.ok(x >= 5 && y >= 5, photoSize)
      assert.ok(
        x + width <=
          Math.floor(((256 * plan.columns[column].width + 18) / 256) * 7) - 5,
        photoSize
      )
      assert.ok(y + height <= plan.rows[row].height / 0.75 - 5, photoSize)
    }
    assert.equal(drawing.querySelectorAll('xdr\\:oneCellAnchor').length, 3)
  }
  let prepared = false
  await createPackingWorkbook([source()], {
    ...options,
    columns: ['quantity'],
    prepareImages: async () => {
      prepared = true
    },
  })
  assert.equal(prepared, false)
})

test('carton marks request only their selected artwork and absent marks leave editable blank cells', async () => {
  const settings = { ...defaults, columns: ['cartonMark'] }
  const plan = planPackingWorkbook([source()], settings)
  assert.deepEqual(plan.imageColumns, {
    photo: undefined,
    code: undefined,
    mark: 0,
  })
  let calls = 0
  const bytes = await createPackingWorkbook([source()], {
    ...settings,
    prepareImages: async (_row, bounds) => {
      calls++
      assert.deepEqual(bounds, {
        photo: undefined,
        code: undefined,
        mark: { maxWidth: 320, maxHeight: 240 },
      })
      return { mark: undefined }
    },
  })
  assert.equal(calls, 1)
  const archive = inspectZip(bytes)
  assert.equal(
    archive.FullPaths.some((name) => /xl\/drawings\//.test(name)),
    false
  )
  const worksheet = partText(archive, 'xl/worksheets/sheet1.xml')
  assert.doesNotMatch(worksheet, /<drawing/)
  const sheet = read(bytes, { type: 'array', cellNF: true }).Sheets[
    'Packing list'
  ]
  const mark = field(sheet, 'cartonMark', plan.products[0].row, settings)
  assert.equal(mark?.v ?? '', '')
  assert.equal(mark?.f, undefined)
  assert.doesNotMatch(
    partText(archive, 'xl/styles.xml'),
    /<protection|<sheetProtection/
  )

  for (const [width, height] of [
    [321, 240],
    [320, 241],
  ]) {
    await assert.rejects(
      createPackingWorkbook([source()], {
        ...settings,
        prepareImages: async () => ({ mark: rectangle(width, height) }),
      }),
      /resized/
    )
  }
})

test('small code artwork retains its native half-resolution size without enlargement', async () => {
  const archive = inspectZip(
    await createPackingWorkbook([source()], {
      ...defaults,
      columns: ['barcode'],
      prepareImages: async () => ({ code: rectangle(40, 20) }),
    })
  )
  const drawing = new DOMParser().parseFromString(
    partText(archive, 'xl/drawings/drawing1.xml'),
    'text/xml'
  )
  const extent = drawing.querySelector('xdr\\:oneCellAnchor xdr\\:ext')
  assert.equal(Number(extent.getAttribute('cx')) / 9525, 20)
  assert.equal(Number(extent.getAttribute('cy')) / 9525, 10)
})

test('capacity suffixes stay native while 1688 Details uses 10pt left-aligned text and spreadsheet descriptions keep 11pt centered', async () => {
  for (const [language, suffix] of [
    ['en', '/box'],
    ['es', '/ctn'],
    ['zh', '/箱'],
  ]) {
    const rows = [
      source(),
      source({ orderId: '1002', sourceType: 'spreadsheet' }),
      source({ orderId: '1003', unitsPerCarton: '' }),
    ]
    const settings = {
      ...defaults,
      language,
      columns: ['unitsPerCarton', 'description'],
    }
    const plan = planPackingWorkbook(rows, settings)
    const bytes = await createPackingWorkbook(rows, settings)
    const sheet = read(bytes, { type: 'array' }).Sheets['Packing list']
    const styleDocument = new DOMParser().parseFromString(
      partText(inspectZip(bytes), 'xl/styles.xml'),
      'text/xml'
    )
    const styles = styleDocument.querySelector('cellXfs').children,
      fonts = styleDocument.querySelector('fonts').children
    const fontFor = (cell) =>
      fonts[Number(styles[cell.style].getAttribute('fontId'))]
    for (const [index, product] of plan.products.entries()) {
      const capacity = sheet[`A${product.row}`]
      assert.equal(capacity?.v ?? '', index === 2 ? '' : 10)
      if (index < 2) {
        assert.equal(capacity.t, 'n')
        assert.equal(capacity.w, `10${suffix}`)
      }
      const description = cell(plan, product, 'description')
      assert.equal(description.value, rows[index].description)
      assert.equal(
        fontFor(description).querySelector('sz').getAttribute('val'),
        index === 1 ? '11' : '10'
      )
      assert.equal(
        fontFor(cell(plan, product, 'unitsPerCarton'))
          .querySelector('sz')
          .getAttribute('val'),
        '11'
      )
      assert.equal(
        styles[description.style]
          .querySelector('alignment')
          .getAttribute('horizontal'),
        index === 1 ? 'center' : 'left'
      )
    }
  }
})
