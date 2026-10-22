import test from 'node:test'
import assert from 'node:assert/strict'
import {
  packingListFileName,
  packingSummary,
  printSummary,
  summaryFileName,
  fileSlug,
  SUMMARY_FORMAT,
} from '../src/export-summary.js'
import { workspaceStatus } from '../src/workspace-status.js'

const day = new Date(2026, 9, 19, 10, 0)

test('export file names are predictable', () => {
  assert.equal(
    packingListFileName(['Habitat Studio'], day),
    'packing-list-2026-10-19-100000-Habitat-Studio.xlsx'
  )
  assert.equal(
    packingListFileName(['栖木家居 · Habitat'], day),
    'packing-list-2026-10-19-100000-栖木家居-Habitat.xlsx'
  )
  assert.equal(
    packingListFileName(['A', 'B', 'A'], day),
    'packing-list-2026-10-19-100000-2-sellers.xlsx'
  )
  assert.equal(
    packingListFileName(['***'], day),
    'packing-list-2026-10-19-100000-seller.xlsx'
  )
  assert.equal(
    summaryFileName('CE-labels-2026-10-19-3-products.pdf'),
    'CE-labels-2026-10-19-3-products.json'
  )
  assert.equal(fileSlug('a/b\\c:d*e?"f<g>h|i'), 'a-b-c-d-e-f-g-h-i')
})

test('a packing-list summary lists its orders, products, quantities and files', () => {
  const summary = packingSummary({
    file: 'packing-list-2026-10-19-Habitat.xlsx',
    exportedAt: '2026-10-19T10:00:00.000Z',
    rows: [
      {
        orderId: '9001',
        sellerName: 'Habitat',
        barcode: 'CE261001010101',
        spanishName: 'VELA',
        quantity: '40',
      },
      {
        orderId: '9001',
        sellerName: 'Habitat',
        baseCode: 'CE26100102',
        spanishName: 'DIFUSOR',
        quantity: 24,
      },
      {
        orderId: '9002',
        sellerName: 'Greenfield',
        baseCode: 'CE26100103',
        spanishName: 'BOLSA',
        quantity: '',
      },
    ],
  })
  assert.equal(summary.format, SUMMARY_FORMAT)
  assert.equal(summary.kind, 'packing-list')
  assert.deepEqual(summary.files, [
    'packing-list-2026-10-19-Habitat.xlsx',
    'packing-list-2026-10-19-Habitat.json',
  ])
  assert.deepEqual(summary.orders, [
    { orderId: '9001', seller: 'Habitat' },
    { orderId: '9002', seller: 'Greenfield' },
  ])
  assert.deepEqual(
    summary.products.map((product) => [product.code, product.quantity]),
    [
      ['CE261001010101', 40],
      ['CE26100102', 24],
      ['CE26100103', 0],
    ]
  )
  assert.deepEqual(summary.totals, { orders: 2, products: 3, quantity: 64 })
})

test('packing summaries keep feature, linked and manual costs separate and include custom product details', () => {
  const summary = packingSummary({
    file: 'packing-list-synthetic.xlsx',
    rows: [
      {
        orderId: '9001',
        sellerName: 'Synthetic store',
        quantity: '3',
        sourceAmount: '30.00',
        effectiveAmount: '486.00',
        additionalCharge: '0.00',
        linkedPaymentCharge: '456.00',
        featureCharge: '1.25',
        productFeatureCosts: 'Engraving (¥1.25 per piece; Added cost)',
        linkedPaymentReasons: 'Recorded lighting and rotation service',
        productFeatures: 'Lighting · Rotation',
      },
    ],
  })
  assert.equal(summary.products[0].sourceAmount, '30.00')
  assert.equal(summary.products[0].effectiveAmount, '486.00')
  assert.equal(summary.products[0].additionalCharge, '0.00')
  assert.equal(summary.products[0].linkedPaymentCharge, '456.00')
  assert.equal(summary.products[0].featureCharge, '1.25')
  assert.equal(
    summary.products[0].productFeatureCosts,
    'Engraving (¥1.25 per piece; Added cost)'
  )
  assert.equal(
    summary.products[0].linkedPaymentReasons,
    'Recorded lighting and rotation service'
  )
  assert.equal(summary.products[0].productFeatures, 'Lighting · Rotation')
  assert.equal(summary.totals.orders, 1)
  assert.equal(summary.orders[0].orderAdditionalCharges, undefined)
})

test('packing summaries preserve optional carton and additional-cost evidence as exact strings', () => {
  const rows = [
    {
      orderId: '9001',
      sellerName: 'Synthetic store',
      quantity: '3',
      cartons: '2',
      cartonWeight: '10.50',
      cartonVolume: '0.105',
      cartonLength: '70',
      cartonWidth: '50',
      cartonHeight: '30',
      storeNumber: '04321',
      sourceUnitPrice: '10.00',
      effectiveUnitPrice: '10.335',
      sourceAmount: '30.00',
      effectiveAmount: '31.00',
      additionalCharge: '1.00',
      additionalChargeReasons: 'Unloading (¥3.00)',
      orderAdditionalCharges: '3.00',
    },
    {
      orderId: '9001',
      sellerName: 'Synthetic store',
      quantity: '7',
      sourceUnitPrice: '10.00',
      effectiveUnitPrice: '10.28571429',
      sourceAmount: '70.00',
      effectiveAmount: '72.00',
      additionalCharge: '2.00',
      additionalChargeReasons: 'Unloading (¥3.00)',
      orderAdditionalCharges: '3.00',
    },
  ]
  const summary = packingSummary({ file: 'synthetic.xlsx', rows })
  assert.equal(summary.orders.length, 1)
  assert.equal(summary.orders[0].orderAdditionalCharges, '3.00')
  assert.equal(summary.orders[0].additionalChargeReasons, 'Unloading (¥3.00)')
  assert.equal(summary.orders[0].storeNumber, '04321')
  assert.equal(summary.products[0].cartonVolume, '0.105')
  assert.equal(summary.products[0].cartonWeight, '10.50')
  assert.equal(summary.products[0].effectiveUnitPrice, '10.335')
  assert.equal(summary.products[1].effectiveUnitPrice, '10.28571429')
  assert.equal(summary.products[1].effectiveAmount, '72.00')
  assert.equal('cartonWeight' in summary.products[1], false)
  assert.deepEqual(summary.totals, { orders: 1, products: 2, quantity: 10 })
  const invalid = structuredClone(rows)
  invalid[0].effectiveAmount = 'incorrect'
  assert.throws(
    () => packingSummary({ file: 'synthetic.xlsx', rows: invalid }),
    /Invalid effectiveAmount/
  )
  invalid[0].effectiveAmount = '31.00'
  invalid[1].orderAdditionalCharges = '4.00'
  assert.throws(
    () => packingSummary({ file: 'synthetic.xlsx', rows: invalid }),
    /Inconsistent order additional charges/
  )
})

test('label and carton-mark summaries carry pages, counts and files', () => {
  const labels = printSummary({
    kind: 'labels',
    file: 'CE-labels-2026-10-19-2-products.pdf',
    pages: 1,
    perPage: 70,
    exportedAt: '2026-10-19T10:00:00.000Z',
    items: [
      {
        code: 'CE1',
        name: 'VELA',
        orders: [{ orderId: '9001', seller: 'Habitat' }],
        requested: 40,
        extra: 7,
        total: 47,
      },
      {
        code: 'CE2',
        name: 'DIFUSOR',
        orders: [
          { orderId: '9001', seller: 'Habitat' },
          { orderId: '9002', seller: 'Greenfield' },
        ],
        requested: 20,
        extra: 3,
        total: 23,
      },
    ],
  })
  assert.equal(labels.kind, 'labels')
  assert.deepEqual(labels.files, [
    'CE-labels-2026-10-19-2-products.pdf',
    'CE-labels-2026-10-19-2-products.json',
  ])
  assert.deepEqual(labels.totals, {
    orders: 2,
    products: 2,
    requested: 60,
    printed: 70,
  })
  assert.deepEqual(labels.orders, [
    { orderId: '9001', seller: 'Habitat' },
    { orderId: '9002', seller: 'Greenfield' },
  ])
  assert.deepEqual(labels.products[1].orders, ['9001', '9002'])
  const marks = printSummary({
    kind: 'marks',
    file: 'CE-carton-marks-2026-10-19-1-product.pdf',
    pages: 2,
    perPage: 2,
    items: [{ code: 'CE1', name: 'VELA', requested: 3, total: 3 }],
  })
  assert.equal(marks.kind, 'carton-marks')
  assert.equal('extra' in marks.products[0], false)
})

test('the status line reports the most urgent state', () => {
  assert.deepEqual(workspaceStatus(), { status: 'idle' })
  const exportDone = { files: ['a.xlsx', 'a.json'], at: 'now' }
  assert.equal(
    workspaceStatus({ lastExport: exportDone }).status,
    'export-finished'
  )
  const paused = {
    id: 'j1',
    state: 'paused',
    attention: { kind: 'sign-in', tabId: 4 },
  }
  assert.equal(
    workspaceStatus({ jobs: [paused], lastExport: exportDone }).status,
    'needs-sign-in'
  )
  assert.equal(
    workspaceStatus({ jobs: [{ ...paused, dismissedAt: 'x' }] }).status,
    'idle'
  )
  const running = { id: 'j2', state: 'running' }
  assert.equal(
    workspaceStatus({ jobs: [paused, running], lastExport: exportDone }).status,
    'importing'
  )
  assert.equal(
    workspaceStatus({ jobs: [{ id: 'j3', state: 'paused', attention: null }] })
      .status,
    'idle'
  )
  const visible = {
    id: 'j4',
    state: 'paused',
    attention: { kind: 'visible-reader', tabId: null },
  }
  // Older paused jobs can be resumed from Activity without an obsolete warning.
  assert.equal(workspaceStatus({ jobs: [visible] }).status, 'idle')
})

test('a repeated export gets a predictable suffix instead of a silent browser rename', async () => {
  const { uniqueFileName } = await import('../src/save-file.js')
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  const name = 'CE-labels-2026-10-19-2-products.pdf'
  assert.equal(uniqueFileName(name, storage), name)
  assert.equal(
    uniqueFileName(name, storage),
    'CE-labels-2026-10-19-2-products-2.pdf'
  )
  assert.equal(
    uniqueFileName(name, storage),
    'CE-labels-2026-10-19-2-products-3.pdf'
  )
  assert.equal(
    summaryFileName('CE-labels-2026-10-19-2-products-3.pdf'),
    'CE-labels-2026-10-19-2-products-3.json'
  )
  assert.equal(
    uniqueFileName('packing-list-2026-10-19-A.xlsx', storage),
    'packing-list-2026-10-19-A.xlsx'
  )
  // Blocked storage still saves under the predictable name.
  assert.equal(uniqueFileName(name, null), name)
})

test('export names carry the local date and time, so each export has its own files', async () => {
  const { printFileName, exportStamp } =
    await import('../src/export-summary.js')
  const at = new Date(2026, 9, 19, 15, 30, 12)
  assert.equal(exportStamp(at), '2026-10-19-153012')
  assert.equal(
    printFileName('labels', 3, at),
    'CE-labels-2026-10-19-153012-3-products.pdf'
  )
  assert.equal(
    printFileName('marks', 1, at),
    'CE-carton-marks-2026-10-19-153012-1-product.pdf'
  )
  assert.equal(
    printFileName('calibration', 0, at),
    'CE-print-calibration-2026-10-19-153012.pdf'
  )
  assert.notEqual(
    printFileName('labels', 3, new Date(2026, 9, 19, 15, 30, 13)),
    printFileName('labels', 3, at)
  )
})

test('print filenames use the chosen language for PDFs, matching summaries and calibration', async () => {
  const { printFileName } = await import('../src/export-summary.js')
  const at = new Date(2026, 9, 21, 18, 5, 51)
  for (const [language, labels, marks, calibration, single, plural] of [
    [
      'en',
      'labels',
      'carton-marks',
      'print-calibration',
      'product',
      'products',
    ],
    [
      'es',
      'etiquetas',
      'marcas-de-caja',
      'calibracion-de-impresion',
      'producto',
      'productos',
    ],
    ['zh', '标签', '唛头', '打印校准', '产品', '产品'],
  ]) {
    for (const [kind, name] of [
      ['labels', labels],
      ['marks', marks],
    ])
      for (const [count, unit] of [
        [1, single],
        [52, plural],
      ]) {
        const stem = `CE-${name}-2026-10-21-180551-${count}-${unit}`
        const file = printFileName(kind, count, at, language)
        assert.equal(file, `${stem}.pdf`)
        assert.equal(summaryFileName(file), `${stem}.json`)
      }
    assert.equal(
      printFileName('calibration', 0, at, language),
      `CE-${calibration}-2026-10-21-180551.pdf`
    )
  }
  assert.equal(
    printFileName('labels', 1, at, 'unsupported'),
    printFileName('labels', 1, at, 'en')
  )
})

test('summary quantities stay exact beyond the safe integer range', () => {
  const summary = packingSummary({
    file: 'packing-list.xlsx',
    rows: [
      { orderId: '1', baseCode: 'CE1', quantity: '9007199254740993' },
      { orderId: '1', baseCode: 'CE2', quantity: '2' },
    ],
  })
  assert.equal(summary.products[0].quantity, '9007199254740993')
  assert.equal(summary.products[1].quantity, 2)
  assert.equal(summary.totals.quantity, '9007199254740995')
})
