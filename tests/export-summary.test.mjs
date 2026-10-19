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
    'packing-list-2026-10-19-Habitat-Studio.xlsx'
  )
  assert.equal(
    packingListFileName(['栖木家居 · Habitat'], day),
    'packing-list-2026-10-19-栖木家居-Habitat.xlsx'
  )
  assert.equal(
    packingListFileName(['A', 'B', 'A'], day),
    'packing-list-2026-10-19-2-sellers.xlsx'
  )
  assert.equal(
    packingListFileName(['***'], day),
    'packing-list-2026-10-19-seller.xlsx'
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
      { code: 'CE1', name: 'VELA', requested: 40, extra: 7, total: 47 },
      { code: 'CE2', name: 'DIFUSOR', requested: 20, extra: 3, total: 23 },
    ],
  })
  assert.equal(labels.kind, 'labels')
  assert.deepEqual(labels.files, [
    'CE-labels-2026-10-19-2-products.pdf',
    'CE-labels-2026-10-19-2-products.json',
  ])
  assert.deepEqual(labels.totals, { products: 2, requested: 60, printed: 70 })
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
})
