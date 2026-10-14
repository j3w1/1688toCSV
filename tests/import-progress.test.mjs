import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import {
  importProgress,
  progressPresentation,
  createProgressView,
} from '../src/import-progress.js'

const job = (extra = {}) => ({
  id: 'synthetic',
  state: 'running',
  phase: 'details',
  total: 4,
  orders: [
    { orderId: '10001', state: 'done', savedRows: 5 },
    { orderId: '10002', state: 'failed' },
    { orderId: '10003', state: 'pending' },
    { orderId: '10004', state: 'pending' },
  ],
  currentOrderId: '10003',
  detailStage: 'reading',
  detailStartedAt: 1000,
  detailAttempts: 1,
  ...extra,
})

test('progress counts terminal attempts separately from saved rows and survives compact transport', () => {
  const full = job()
  const compact = importProgress(full)
  assert.equal(compact.collectedRows, 5)
  assert.equal(compact.countedOrders, 1)
  assert.equal(compact.remaining, 3)
  assert.equal(compact.orders, undefined)
  const display = progressPresentation(compact, 11000)
  assert.deepEqual(display, progressPresentation(full, 11000))
  assert.equal(display.meter, '2 / 4 processed · 50%')
  assert.equal(display.counts, '1 saved · 1 need attention · 2 pending')
  assert.equal(display.rows, '5 product rows saved')
  assert.match(
    display.current,
    /Reading products.*attempt 1\/3.*10s on this order/
  )
  const later = progressPresentation(compact, 41000)
  assert.equal(later.value, display.value)
  assert.match(later.current, /40s.*Taking longer/)
})

test('discovery is page progress and never implies product collection', () => {
  const display = progressPresentation(
    job({
      phase: 'scan',
      page: 12,
      pageSize: 10,
      total: 667,
      orders: Array.from({ length: 120 }, () => ({ state: 'pending' })),
    })
  )
  assert.equal(display.max, 67)
  assert.equal(display.value, 12)
  assert.equal(display.label, 'List pages scanned')
  assert.match(display.current, /120 orders found.*after discovery/)
  assert.equal(display.rows, '0 product rows saved')
  assert.equal(progressPresentation(job({ orders: [], total: 0 })).max, 0)
})

test('legacy jobs never claim an unknown row count is zero; partial counts are explicit', () => {
  assert.equal(
    progressPresentation(job({ orders: [{ state: 'done' }] })).rows,
    'Product-row count available after resuming'
  )
  assert.equal(
    progressPresentation(
      job({ orders: [{ state: 'done' }, { state: 'done', savedRows: 5 }] })
    ).rows,
    '5 product rows counted in 1 of 2 saved orders'
  )
})

test('retry, saving, paused and completed states do not invent successful collection', () => {
  const retry = progressPresentation(
    job({
      detailStage: 'retrying',
      detailError: 'Waiting for totals',
      detailAttempts: 2,
    }),
    6000
  )
  assert.match(retry.current, /Waiting to retry.*attempt 2\/3/)
  assert.equal(retry.error, 'Waiting for totals')
  assert.equal(
    progressPresentation(job({ detailStage: 'saving', currentRows: 20 })).rows,
    '5 product rows saved'
  )
  assert.match(
    progressPresentation(job({ detailStage: 'saving', currentRows: 20 }))
      .current,
    /Saving 20 product rows/
  )
  const paused = progressPresentation(
    job({ state: 'paused', error: 'Browser restarted.' })
  )
  assert.equal(paused.current, '')
  assert.equal(paused.error, 'Browser restarted.')
  assert.match(
    progressPresentation(job({ state: 'completed-with-errors' })).title,
    /need attention/
  )
})

test('latest result shows only confirmed success or explicit failure and uses text safely', () => {
  const value = job({
    latestResult: {
      orderId: '10001',
      outcome: 'saved',
      rows: 5,
      sellerName: '<img src=x>',
      payable: '65.00',
      at: new Date(5000).toISOString(),
    },
  })
  const { document } = parseHTML('<html><body></body></html>')
  const view = createProgressView(document)
  view.update(value, 9000)
  const bar = view.element.querySelector('progress')
  assert.equal(bar.textContent, '')
  assert.equal(bar.getAttribute('aria-label'), 'Orders processed')
  assert.match(
    view.element.querySelector('.import-latest').textContent,
    /<img src=x>.*CNY 65.00.*4s ago/
  )
  assert.equal(view.element.querySelector('img'), null)
  const current = view.element.querySelector('.import-current')
  view.update(value, 11000)
  assert.equal(view.element.querySelector('.import-current'), current)
  const failure = progressPresentation(
    job({
      latestResult: {
        orderId: '10002',
        outcome: 'failed',
        error: 'Totals missing',
      },
    })
  )
  assert.match(failure.latest, /not saved — Totals missing/)
})
