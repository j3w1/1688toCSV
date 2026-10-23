import test from 'node:test'
import assert from 'node:assert/strict'
import { read, CFB } from 'xlsx'
import {
  planPackingWorkbook,
  createPackingWorkbook,
  PACKING_PRODUCT_DEFAULT_COLUMNS,
} from '../src/packing-workbook.js'
import { packingSummary } from '../src/export-summary.js'

const rows = ['S', 'M', 'L'].map((ending, index) => ({
  accountId: 'local',
  orderId: 'order-1',
  entryId: String(index + 1),
  groupId: 'group-1',
  packingMonth: '2026-10',
  sellerName: 'Synthetic factory',
  barcode: `CE26101001${ending}`,
  baseCode: 'CE26101001',
  description: `Original product ${ending}`,
  sourceType: '1688',
  spanishName: 'PELUCHE',
  quantity: index ? '30' : '3',
  price: '10.00',
  effectiveAmount: index ? '300.00' : '30.00',
  unitsPerCarton: '10',
  cartonWeight: '9.54',
  cartonVolume: '0.077',
  receivedBoxes: '6',
  loadedBoxes: '6',
  orderShipping: '20.00',
}))
const batch = (overrides = {}) => ({
  id: 'cartons-1',
  accountId: 'local',
  storeId: 'store:synthetic',
  month: '2026-10',
  groups: [{ orderId: 'order-1', groupId: 'group-1' }],
  baseCode: 'CE26101001',
  sellerName: 'Synthetic factory',
  category: '毛绒玩具',
  contents: rows.map((row) => ({
    orderId: row.orderId,
    entryId: row.entryId,
    quantity: row.quantity,
    barcode: row.barcode,
  })),
  count: 6,
  len: '40',
  wid: '30',
  ht: '25',
  weightBasis: 'carton',
  weight: '9.54',
  suppliedCbm: '0.077',
  received: 6,
  loaded: 0,
  revision: 1,
  ...overrides,
})
const options = (overrides = {}) => ({
  language: 'en',
  createdAt: '2026-10-22T01:00:00Z',
  cartonBatches: [batch()],
  ...overrides,
})
const field = (plan, row, key) =>
  row.cells[plan.columns.findIndex((column) => column.key === key)]

test('carton contents display an external supplier reference while retaining the internal purchase identity', () => {
  const external = rows.map((row) => ({
    ...row,
    source: 'other',
    orderReference: 'EXT-SYNTHETIC-1001',
  }))
  const physical = batch()
  const before = structuredClone(physical)
  const plan = planPackingWorkbook(
    external,
    options({ cartonBatches: [physical] })
  )
  const cartons = plan.sheets[1]
  const carton = cartons.rows.find((row) => row.kind === 'carton')
  const contents = field(cartons, carton, 'contents').value
  assert.match(contents, /CE26101001S × 3 · Order EXT-SYNTHETIC-1001/)
  assert.doesNotMatch(contents, /Order order-1/)
  assert.deepEqual(physical, before)
  assert.equal(external[0].orderId, 'order-1')
})

test('partial carton context retains references for omitted same-order and foreign purchase contents', () => {
  const selected = [
    { ...rows[0], source: 'other', orderReference: 'EXT-SELECTED' },
  ]
  const physical = batch({
    contents: [
      ...batch().contents,
      {
        orderId: 'omitted-order',
        entryId: 'foreign-product',
        quantity: '5',
        barcode: 'CE26101002',
        orderReference: 'EXT-OMITTED',
      },
    ],
  })
  const before = structuredClone(physical)
  const plan = planPackingWorkbook(
    selected,
    options({ cartonBatches: [physical] })
  )
  const cartons = plan.sheets[1]
  const context = cartons.rows.find((row) => row.kind === 'context')
  const contents = field(cartons, context, 'contents').value
  assert.equal((contents.match(/Order EXT-SELECTED/g) || []).length, 3)
  assert.match(contents, /CE26101002 × 5 · Order EXT-OMITTED/)
  assert.doesNotMatch(contents, /Order (?:order-1|omitted-order)/)
  assert.equal(cartons.rows.filter((row) => row.kind === 'carton').length, 0)
  assert.deepEqual(physical, before)
})

test('shared S/M/L packing keeps purchases separate and owns physical totals on Cartons only', async () => {
  const plan = planPackingWorkbook(rows, options()),
    cartons = plan.sheets[1]
  assert.deepEqual(
    plan.sheets.map((sheet) => sheet.name),
    ['Products', 'Cartons']
  )
  assert.deepEqual(
    plan.columns.map((column) => column.key),
    PACKING_PRODUCT_DEFAULT_COLUMNS
  )
  assert.equal(plan.products.length, 3)
  assert.equal(cartons.rows.filter((row) => row.kind === 'carton').length, 1)
  for (const row of plan.rows.filter((row) => row.kind === 'product')) {
    assert.equal(field(plan, row, 'unitsPerCarton').value, 'Shared')
    assert.equal(field(plan, row, 'unitsPerCarton').type, 'text')
    assert.equal(
      field(plan, row, 'cartonReferences').value,
      'Shared · Batch · 6 cartons · C001'
    )
    assert.match(
      field(plan, row, 'cartonReferences').hyperlink,
      /^'Cartons'!A7$/
    )
  }
  const carton = cartons.rows.find((row) => row.kind === 'carton')
  assert.match(field(cartons, carton, 'contents').value, /CE26101001S × 3/)
  assert.match(field(cartons, carton, 'contents').value, /CE26101001L × 30/)
  assert.equal(field(cartons, carton, 'volumePerCarton').value, '0.03')
  assert.equal(field(cartons, carton, 'totalVolume').value, '0.18')
  assert.equal(field(cartons, carton, 'totalWeight').value, '57.24')
  assert.equal(field(cartons, carton, 'loadedWeight').value, '0')
  assert.doesNotMatch(
    plan.rows.find((row) => row.kind === 'order').cells[0].value,
    /Loaded|m³|kg/
  )
  const workbook = read(await createPackingWorkbook(rows, options()), {
    type: 'array',
  })
  assert.deepEqual(workbook.SheetNames, ['Products', 'Cartons'])
  assert.match(workbook.Sheets.Cartons.L7.f, /G7\*H7\*I7\/1000000/)
  assert.equal(workbook.Sheets.Cartons.N7.v, 0.18)
  assert.equal(workbook.Sheets.Products.H10.v, 63)
  assert.equal(workbook.Sheets.Products.M10.v, 630)
  assert.equal(workbook.Sheets.Products.J7.l.Target, "#'Cartons'!A7")
  assert.equal(workbook.Sheets.Cartons.C7.l.Target, "#'Products'!A7")
})

test('partial selected exports show the full shared context without attributing cartons or weight', () => {
  const plan = planPackingWorkbook([rows[0]], options()),
    cartons = plan.sheets[1]
  assert.equal(cartons.records.length, 1)
  assert.equal(cartons.records[0].includedInTotals, false)
  const context = cartons.rows.find((row) => row.kind === 'context')
  assert.equal(field(cartons, context, 'count').value, '6')
  assert.match(field(cartons, context, 'contents').value, /CE26101001L × 30/)
  assert.equal(field(cartons, cartons.rows.at(-1), 'count').value, '')
  assert.equal(field(cartons, cartons.rows.at(-1), 'totalVolume').value, '')
  assert.equal(
    field(
      plan,
      plan.rows.find((row) => row.kind === 'product'),
      'cartonReferences'
    ).value,
    'Shared · Batch · 6 cartons · C001 *'
  )
})

test('different carton types and linked purchases are distinct rows and never imply a common capacity', () => {
  const linked = {
      ...rows[0],
      orderId: 'order-2',
      entryId: 'linked',
      quantity: '27',
    },
    combined = batch({
      contents: [
        batch().contents[0],
        {
          orderId: linked.orderId,
          entryId: linked.entryId,
          barcode: linked.barcode,
          quantity: '27',
        },
      ],
      count: 2,
    }),
    second = batch({
      id: 'cartons-2',
      count: 1,
      len: '60',
      contents: [{ ...batch().contents[1], quantity: '30' }],
    }),
    plan = planPackingWorkbook(
      [...rows, linked],
      options({ cartonBatches: [combined, second] })
    ),
    cartons = plan.sheets[1]
  assert.equal(plan.products.length, 4)
  assert.equal(
    cartons.records.filter((record) => record.includedInTotals).length,
    2
  )
  assert.equal(field(cartons, cartons.rows.at(-1), 'count').value, '3')
  assert.equal(
    field(cartons, cartons.rows.at(-1), 'totalVolume').value,
    '0.105'
  )
  assert.equal(
    field(
      plan,
      plan.rows.find((row) => row.kind === 'product'),
      'unitsPerCarton'
    ).value,
    'Shared'
  )
  const single = plan.products.find((product) => product.source.entryId === '2')
  assert.equal(
    field(plan, plan.rows[single.row - 1], 'unitsPerCarton').value,
    '30'
  )
})

test('six uneven numbered cartons retain exact contents and expose Varies instead of an invented average', async () => {
  const quantities = [13, 12, 11, 10, 9, 8],
    source = { ...rows[0], quantity: '63', effectiveAmount: '630.00' },
    physical = quantities.map((quantity, index) =>
      batch({
        id: `numbered-${index + 1}`,
        cartonNumber: String(index + 1),
        mark: { orderId: source.orderId, groupId: source.groupId },
        count: 1,
        received: 1,
        contents: [{ ...batch().contents[0], quantity: String(quantity) }],
      })
    ),
    settings = options({ cartonBatches: physical }),
    plan = planPackingWorkbook([source], settings),
    product = plan.rows.find((row) => row.kind === 'product'),
    cartons = plan.sheets[1],
    cartonRows = cartons.rows.filter((row) => row.kind === 'carton')
  assert.equal(plan.products.length, 1)
  assert.equal(field(plan, product, 'quantity').value, '63')
  assert.equal(field(plan, product, 'effectiveAmount').value, '630.00')
  assert.deepEqual(field(plan, product, 'unitsPerCarton'), {
    value: 'Varies',
    type: 'text',
    style: 4,
  })
  assert.equal(
    field(plan, product, 'cartonReferences').value,
    '6 cartons · #1, #2, #3, #4, #5, #6'
  )
  assert.equal(
    field(plan, product, 'cartonReferences').hyperlink,
    "'Cartons'!A7"
  )
  assert.deepEqual(
    cartons.records.map((record) => record.label),
    ['C001', 'C002', 'C003', 'C004', 'C005', 'C006']
  )
  assert.deepEqual(
    cartonRows.map((row) => field(cartons, row, 'batch').value),
    ['#1', '#2', '#3', '#4', '#5', '#6']
  )
  for (const [index, row] of cartonRows.entries()) {
    assert.equal(field(cartons, row, 'count').value, '1')
    assert.match(
      field(cartons, row, 'contents').value,
      new RegExp(`CE26101001S × ${quantities[index]} · Order order-1`)
    )
  }
  assert.equal(field(cartons, cartons.rows.at(-1), 'count').value, '6')
  assert.equal(field(cartons, cartons.rows.at(-1), 'totalVolume').value, '0.18')
  assert.match(
    cartons.rows.find((row) => row.kind === 'note').cells[0].value,
    /numbered row is one exact carton/
  )
  const workbook = read(await createPackingWorkbook([source], settings), {
    type: 'array',
  })
  assert.equal(workbook.Sheets.Products.I7.v, 'Varies')
  assert.equal(workbook.Sheets.Cartons.A7.v, '#1')
  assert.equal(workbook.Sheets.Cartons.A12.v, '#6')
  assert.equal(workbook.Sheets.Cartons.D13.v, 6)
  assert.match(workbook.Sheets.Cartons.N7.f, /L7\*D7/)
})

test('cross-code contents use the actual physical mark in product artwork and keep a partial selection out of physical totals', async () => {
  const first = { ...rows[0], quantity: '3' },
    other = {
      ...rows[1],
      entryId: 'other',
      groupId: 'group-5',
      baseCode: 'CE26101005',
      barcode: 'CE26101005M',
      quantity: '9',
      effectiveAmount: '90.00',
    },
    physical = batch({
      cartonNumber: '1',
      count: 1,
      received: 1,
      mark: { orderId: first.orderId, groupId: first.groupId },
      groups: [
        { orderId: first.orderId, groupId: first.groupId },
        { orderId: other.orderId, groupId: other.groupId },
      ],
      contents: [
        { ...batch().contents[0], quantity: first.quantity },
        {
          orderId: other.orderId,
          entryId: other.entryId,
          barcode: other.barcode,
          quantity: other.quantity,
        },
      ],
    }),
    plan = planPackingWorkbook(
      [first, other],
      options({ cartonBatches: [physical] })
    ),
    product = plan.products.find(
      (product) => product.source.entryId === other.entryId
    ),
    productRow = plan.rows[product.row - 1]
  assert.equal(product.source.baseCode, 'CE26101005')
  assert.equal(product.source.barcode, 'CE26101005M')
  assert.equal(product.markSource.baseCode, 'CE26101001')
  assert.equal(product.markSource.chineseCategory, '毛绒玩具')
  assert.equal(field(plan, productRow, 'cartonMark').value, 'CE26101001')
  assert.equal(field(plan, productRow, 'unitsPerCarton').value, 'Shared')
  assert.equal(
    field(plan, productRow, 'cartonReferences').value,
    'Shared · 1 carton · #1 (CE26101001)'
  )
  const imageRequests = []
  await createPackingWorkbook(
    [first, other],
    options({
      cartonBatches: [physical],
      prepareImages: async (source, limits) => {
        imageRequests.push({ source, limits })
        return {}
      },
    })
  )
  const artwork = imageRequests.find(
    ({ source }) => source.entryId === other.entryId
  )
  assert.equal(artwork.source.baseCode, 'CE26101001')
  assert.equal(artwork.source.barcode, 'CE26101005M')
  assert.ok(artwork.limits.mark)
  const partial = planPackingWorkbook(
      [other],
      options({ cartonBatches: [physical] })
    ),
    cartons = partial.sheets[1]
  assert.equal(cartons.records[0].includedInTotals, false)
  assert.equal(field(cartons, cartons.rows.at(-1), 'count').value, '')
  assert.equal(field(cartons, cartons.rows.at(-1), 'totalWeight').value, '')
  assert.match(
    field(
      partial,
      partial.rows.find((row) => row.kind === 'product'),
      'cartonReferences'
    ).value,
    /#1 \* \(CE26101001\)/
  )
  assert.equal(partial.products[0].markSource.baseCode, 'CE26101001')
})

test('one product in different physical marks shows explicit references and suppresses a misleading single mark image', async () => {
  const source = {
      ...rows[0],
      groupId: 'group-5',
      baseCode: 'CE26101005',
      barcode: 'CE26101005S',
      quantity: '9',
    },
    physical = [5, 4].map((quantity, index) =>
      batch({
        id: `mixed-mark-${index}`,
        cartonNumber: String(index + 1),
        count: 1,
        received: 1,
        baseCode: `CE2610100${index + 1}`,
        mark: { orderId: source.orderId, groupId: `group-${index + 1}` },
        groups: [{ orderId: source.orderId, groupId: source.groupId }],
        contents: [
          {
            orderId: source.orderId,
            entryId: source.entryId,
            barcode: source.barcode,
            quantity: String(quantity),
          },
        ],
      })
    ),
    plan = planPackingWorkbook([source], options({ cartonBatches: physical })),
    product = plan.rows.find((row) => row.kind === 'product'),
    marks = field(plan, product, 'cartonMark').value
  assert.equal(marks, 'CE26101001 · #1\nCE26101002 · #2')
  assert.doesNotMatch(marks, /CE26101005/)
  assert.equal(field(plan, product, 'unitsPerCarton').value, 'Varies')
  assert.equal(
    field(plan, product, 'cartonReferences').value,
    'Shared · 2 cartons · #1 (CE26101001), #2 (CE26101002)'
  )
  assert.equal(plan.products[0].hideMark, true)
  const requests = []
  await createPackingWorkbook(
    [source],
    options({
      cartonBatches: physical,
      prepareImages: async (source, limits) => {
        requests.push({ source, limits })
        return {}
      },
    })
  )
  const productRequest = requests.find(
    ({ source: requested }) => requested.entryId === source.entryId
  )
  assert.equal(requests[0].limits.mark, undefined)
  assert.equal(productRequest.source.barcode, source.barcode)
  assert.ok(requests.slice(1).every(({ limits }) => limits.mark))
})

test('identical exact cartons or explicit matching aggregate capacity stay numeric; unspecified aggregate divisibility does not', () => {
  const source = { ...rows[0], quantity: '28', unitsPerCarton: '' },
    exact = [1, 2].map((number) =>
      batch({
        id: `uniform-${number}`,
        cartonNumber: String(number),
        count: 1,
        contents: [{ ...batch().contents[0], quantity: '14' }],
      })
    ),
    aggregate = batch({
      count: 2,
      contents: [{ ...batch().contents[0], quantity: '28' }],
    }),
    numeric = planPackingWorkbook([source], options({ cartonBatches: exact })),
    uncertain = planPackingWorkbook(
      [source],
      options({ cartonBatches: [aggregate] })
    )
  const numericValue = field(
      numeric,
      numeric.rows.find((row) => row.kind === 'product'),
      'unitsPerCarton'
    ),
    aggregateValue = field(
      uncertain,
      uncertain.rows.find((row) => row.kind === 'product'),
      'unitsPerCarton'
    )
  assert.equal(numericValue.value, '14')
  assert.equal(numericValue.type, 'number')
  assert.equal(aggregateValue.value, 'Batch')
  assert.equal(aggregateValue.type, 'text')
  for (const [language, expected] of [
    ['es', 'Lote'],
    ['zh', '整批'],
  ]) {
    const localized = planPackingWorkbook(
      [source],
      options({ language, cartonBatches: [aggregate] })
    )
    assert.equal(
      field(
        localized,
        localized.rows.find((row) => row.kind === 'product'),
        'unitsPerCarton'
      ).value,
      expected
    )
  }
})

test('Products retains 10 pcs per box for 150 pieces across 15 explicitly matching cartons', async () => {
  const source = {
      ...rows[0],
      quantity: '150',
      unitsPerCarton: '10',
      effectiveAmount: '1500.00',
    },
    physical = batch({
      count: 15,
      received: 4,
      loaded: 0,
      contents: [{ ...batch().contents[0], quantity: '150' }],
    }),
    settings = options({ cartonBatches: [physical] }),
    plan = planPackingWorkbook([source], settings),
    product = plan.rows.find((row) => row.kind === 'product'),
    cartons = plan.sheets[1],
    carton = cartons.rows.find((row) => row.kind === 'carton')
  assert.equal(field(plan, product, 'unitsPerCarton').value, '10')
  assert.equal(field(plan, product, 'unitsPerCarton').type, 'number')
  assert.equal(field(cartons, carton, 'count').value, '15')
  assert.equal(field(cartons, carton, 'received').value, '4')
  assert.equal(field(cartons, carton, 'loaded').value, '0')
  const workbook = read(await createPackingWorkbook([source], settings), {
    type: 'array',
  })
  assert.equal(workbook.Sheets.Products.I7.v, 10)
  assert.equal(workbook.Sheets.Products.I7.t, 'n')
  assert.equal(workbook.Sheets.Cartons.D7.v, 15)
  assert.equal(workbook.Sheets.Cartons.E7.v, 4)
  assert.equal(workbook.Sheets.Cartons.F7.v, 0)
  for (const [sourceChanges, batchChanges, expected] of [
    [{ unitsPerCarton: '' }, {}, 'Batch'],
    [{ unitsPerCarton: '12' }, {}, 'Batch'],
    [{ quantity: '160' }, {}, 'Batch'],
    [{}, { count: 14 }, 'Batch'],
    [{}, { count: null }, ''],
  ]) {
    const candidate = planPackingWorkbook(
      [{ ...source, ...sourceChanges }],
      options({ cartonBatches: [{ ...physical, ...batchChanges }] })
    )
    assert.equal(
      field(
        candidate,
        candidate.rows.find((row) => row.kind === 'product'),
        'unitsPerCarton'
      ).value,
      expected
    )
  }
})

test('Products leaves partial identical exact allocations blank and lets full exact contents override defaults', () => {
  const source = { ...rows[0], quantity: '30', unitsPerCarton: '10' },
    exact = (quantity) =>
      batch({
        count: 1,
        contents: [{ ...batch().contents[0], quantity }],
      })
  for (const [physical, expected] of [
    [[exact('10')], ''],
    [[exact('30')], '30'],
    [[exact('13'), { ...exact('17'), id: 'uneven-2' }], 'Varies'],
  ]) {
    const candidate = planPackingWorkbook(
      [source],
      options({ cartonBatches: physical })
    )
    assert.equal(
      field(
        candidate,
        candidate.rows.find((row) => row.kind === 'product'),
        'unitsPerCarton'
      ).value,
      expected
    )
  }
})

test('batch-total weight does not prorate partial loading; legacy supplied volume stays separate', async () => {
  const physical = batch({
      weightBasis: 'batch',
      weight: '57.22',
      loaded: 3,
      len: '',
      wid: '',
      ht: '',
    }),
    plan = planPackingWorkbook(rows, options({ cartonBatches: [physical] })),
    cartons = plan.sheets[1],
    carton = cartons.rows.find((row) => row.kind === 'carton')
  assert.equal(field(cartons, carton, 'loadedWeight').value, '')
  assert.equal(field(cartons, carton, 'totalWeight').value, '57.22')
  assert.equal(field(cartons, carton, 'volumePerCarton').value, '0.077')
  assert.equal(field(cartons, carton, 'totalVolume').value, '0.462')
  assert.match(field(cartons, carton, 'loadedWeight').formula, /F7=D7/)
  const custom = planPackingWorkbook(
      rows,
      options({
        cartonBatches: [physical],
        cartonColumns: ['totalVolume', 'batch', 'loadedWeight'],
      })
    ).sheets[1],
    customRow = custom.rows.find((row) => row.kind === 'carton')
  assert.equal(field(custom, customRow, 'totalVolume').value, '0.462')
  assert.equal(field(custom, customRow, 'totalVolume').formula, undefined)
  assert.equal(field(custom, customRow, 'loadedWeight').value, '')
  const workbook = read(
    await createPackingWorkbook(rows, options({ cartonBatches: [physical] })),
    { type: 'array' }
  )
  assert.equal(workbook.Sheets.Cartons.O7.v, '')
})

test('localized two-sheet workbooks have one header row each and preserve crosslinks and precision', async () => {
  for (const [language, names] of [
    ['es', ['Productos', 'Cajas']],
    ['zh', ['商品', '纸箱']],
  ]) {
    const settings = options({
        language,
        cartonBatches: [
          batch({ len: '40.123456', wid: '30.987654', ht: '25.123456' }),
        ],
      }),
      plan = planPackingWorkbook(rows, settings),
      workbook = read(await createPackingWorkbook(rows, settings), {
        type: 'array',
      })
    assert.deepEqual(workbook.SheetNames, names)
    assert.equal(
      plan.sheets[1].rows.filter((row) => row.kind === 'header').length,
      1
    )
    assert.equal(workbook.Sheets[names[1]].G7.v, 40.123456)
    assert.equal(workbook.Sheets[names[0]].J7.l.Target, `#'${names[1]}'!A7`)
    assert.doesNotMatch(workbook.Sheets[names[1]].L7.f, /ROUND/)
  }
})

test('new packing summaries retain batch source identities and exclude row carton duplicates', () => {
  const summary = packingSummary({
    rows,
    cartonBatches: [batch()],
    file: 'synthetic.xlsx',
  })
  assert.equal(summary.version, 2)
  assert.equal(summary.products.length, 3)
  assert.equal(summary.products[0].cartonVolume, undefined)
  assert.equal(summary.cartonBatches.length, 1)
  assert.equal(summary.cartonBatches[0].quantity, '63')
  assert.equal(summary.cartonBatches[0].includedInTotals, true)
  assert.equal(
    packingSummary({
      rows: [rows[0]],
      cartonBatches: [batch()],
      file: 'synthetic.xlsx',
    }).cartonBatches[0].includedInTotals,
    false
  )
})

test('confirmed zero stays numeric with missing measurements, while unknown stays blank and months stay isolated', () => {
  const physical = batch({
      count: 0,
      len: '',
      wid: '',
      ht: '',
      weight: '',
      suppliedCbm: '',
      loaded: 0,
      received: null,
    }),
    plan = planPackingWorkbook(rows, options({ cartonBatches: [physical] }))
      .sheets[1],
    carton = plan.rows.find((row) => row.kind === 'carton')
  for (const key of [
    'count',
    'loaded',
    'totalWeight',
    'totalVolume',
    'loadedWeight',
    'loadedVolume',
  ])
    assert.equal(field(plan, carton, key).value, '0')
  assert.equal(field(plan, carton, 'received').value, '')
  assert.match(field(plan, carton, 'totalVolume').formula, /D7=0,0/)
  const otherMonth = planPackingWorkbook(
    rows,
    options({ cartonBatches: [batch({ month: '2026-11' })] })
  )
  assert.equal(otherMonth.sheets[1].records.length, 0)
  assert.equal(
    packingSummary({
      rows,
      cartonBatches: [batch({ month: '2026-11' })],
      file: 'synthetic.xlsx',
    }).cartonBatches.length,
    0
  )
})

test('hundreds of carton batches use bounded range formulas instead of exceeding Excel argument limits', () => {
  const physical = Array.from({ length: 300 }, (_, index) =>
      batch({
        id: `batch-${index}`,
        count: 1,
        contents: [{ ...batch().contents[0], quantity: '3' }],
      })
    ),
    plan = planPackingWorkbook(
      [{ ...rows[0], quantity: '900' }],
      options({ cartonBatches: physical })
    ).sheets[1],
    total = field(plan, plan.rows.at(-1), 'count')
  assert.equal(total.value, '300')
  assert.equal(plan.records.length, 300)
  assert.match(total.formula, /SUM\(D6:D306\)/)
  assert.ok(total.formula.length < 100)
})

test('two sheet drawings share identical media while retaining every product and physical carton placement', async () => {
  const png = new Uint8Array(24)
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  new DataView(png.buffer).setUint32(16, 32)
  new DataView(png.buffer).setUint32(20, 32)
  const bytes = await createPackingWorkbook(
      rows,
      options({
        prepareImages: async (_row, limits) =>
          Object.fromEntries(
            Object.keys(limits)
              .filter((key) => limits[key])
              .map((key) => [key, { bytes: png, mimeType: 'image/png' }])
          ),
      })
    ),
    archive = CFB.read(bytes, { type: 'array' }),
    part = (name) =>
      new TextDecoder().decode(
        archive.FileIndex[archive.FullPaths.indexOf(`Root Entry/${name}`)]
          ?.content
      )
  assert.match(part('xl/worksheets/_rels/sheet2.xml.rels'), /drawing2.xml/)
  assert.equal(
    archive.FullPaths.filter((name) => /xl\/media\/image\d+\.png$/.test(name))
      .length,
    1
  )
  for (const [sheet, placements] of [
    [1, 9],
    [2, 1],
  ]) {
    const drawing = part(`xl/drawings/drawing${sheet}.xml`)
    assert.equal(
      (drawing.match(/<xdr:oneCellAnchor>/g) || []).length,
      placements
    )
    assert.equal((drawing.match(/r:embed="image1"/g) || []).length, placements)
    const relationships = part(`xl/drawings/_rels/drawing${sheet}.xml.rels`)
    assert.equal((relationships.match(/Type="[^"]+\/image"/g) || []).length, 1)
    assert.match(relationships, /Target="\.\.\/media\/image1.png"/)
  }
  assert.match(part('[Content_Types].xml'), /sheet2.xml/)
})
