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
  assert.equal(workspaceStatus({ jobs: [visible] }).status, 'needs-visible-tab')
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
