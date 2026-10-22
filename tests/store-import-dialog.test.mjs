import test from 'node:test'
import assert from 'node:assert/strict'
import { validateStoreImportReview } from '../src/store-import-dialog.js'

const row = {
  row: 5,
  group: '1',
  boxes: 2,
  perbox: 10,
  quantity: 20,
  price: '3.00',
  amount: '60.00',
  photos: ['original-photo'],
  variants: [
    { variant: 'A', size: 'S' },
    { variant: 'B', size: 'S' },
  ],
}
const analysis = {
  rows: [row],
  issues: [
    {
      severity: 'review',
      code: 'variant-allocation',
      message: 'Split variants',
      row: 5,
    },
  ],
}
const complete = () => ({
  purchaseDate: '2026-10-20',
  storeName: 'Synthetic store',
  photosReviewed: true,
  reviewedIssues: new Set(),
  allocations: new Map([['5', ['7', '13']]]),
})

test('manual variant review preserves combined totals and source cartons once', () => {
  const original = structuredClone(analysis)
  const result = validateStoreImportReview(analysis, complete())
  assert.equal(result.valid, true)
  assert.deepEqual(result.rows[0].variantAllocations, [
    { variant: 'A', size: 'S', quantity: 7 },
    { variant: 'B', size: 'S', quantity: 13 },
  ])
  assert.equal(result.rows[0].boxes, 2)
  assert.equal(result.rows[0].amount, '60.00')
  assert.deepEqual(analysis, original)
})

test('variant allocations never infer equal splits or accept missing/fractional/negative/overflow values', () => {
  for (const values of [
    [],
    ['', ''],
    ['10', '9'],
    ['0', '20'],
    ['-1', '21'],
    ['7.5', '12.5'],
    ['9007199254740993', '1'],
  ]) {
    const review = complete()
    review.allocations.set('5', values)
    const result = validateStoreImportReview(analysis, review)
    assert.equal(result.valid, false, JSON.stringify(values))
    assert.equal(result.rows[0].variantAllocations, undefined)
  }
})

test('date, name, photo confirmation, source errors and photo review cannot be bypassed', () => {
  for (const patch of [
    { purchaseDate: '' },
    { purchaseDate: '2026-02-30' },
    { purchaseDate: '2026-10-20T12:00:00' },
    { storeName: ' ' },
    { photosReviewed: false },
  ])
    assert.equal(
      validateStoreImportReview(analysis, { ...complete(), ...patch }).valid,
      false
    )
  assert.equal(
    validateStoreImportReview({ rows: [], issues: [] }, complete()).valid,
    false
  )
  const blocking = {
    ...analysis,
    issues: [
      {
        severity: 'error',
        code: 'quantity-mismatch',
        message: 'Source quantities do not match',
      },
    ],
  }
  const review = complete()
  review.reviewedIssues.add('0')
  assert.equal(validateStoreImportReview(blocking, review).valid, false)
  const shared = {
    ...analysis,
    issues: [
      {
        severity: 'review',
        code: 'photo-shared',
        message: 'Shared source photo',
      },
    ],
  }
  assert.equal(validateStoreImportReview(shared, complete()).valid, false)
  assert.equal(validateStoreImportReview(shared, review).valid, true)
})
