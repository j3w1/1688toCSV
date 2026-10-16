import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeProductRows } from '../src/order-summary.js'

test('selected row totals multiply exact unit prices before rounding each row', () => {
  const summary = summarizeProductRows([
    {
      price: '0.335',
      quantity: '3',
      sourceDiscount: '0.01',
      allocatedDiscount: '0.02',
      discount: '0.03',
    },
    { price: '0.10', quantity: '3', discount: '0.00' },
  ])
  assert.equal(summary.rowCount, 2)
  assert.equal(summary.quantity, '6')
  assert.equal(summary.gross, '1.31')
  assert.equal(summary.afterDiscount, '1.28')
  assert.deepEqual(summary.unknownCounts, {
    quantity: 0,
    gross: 0,
    afterDiscount: 0,
  })
})

test('row totals preserve large quantities and amounts beyond Number precision', () => {
  const summary = summarizeProductRows([
    { price: '1.00', quantity: '9007199254740993', discount: '0.01' },
    { price: '0.20', quantity: '1', discount: '0.00' },
  ])
  assert.equal(summary.quantity, '9007199254740994')
  assert.equal(summary.gross, '9007199254740993.20')
  assert.equal(summary.afterDiscount, '9007199254740993.19')
})

test('an empty selection reports zero and never falls back to other rows', () => {
  assert.deepEqual(summarizeProductRows([]), {
    rowCount: 0,
    quantity: '0',
    gross: '0.00',
    afterDiscount: '0.00',
    unknownCounts: { quantity: 0, gross: 0, afterDiscount: 0 },
  })
})

test('missing or invalid values make the affected complete sum unavailable, not zero', () => {
  for (const quantity of [undefined, '0', '-1', '1.5', 2]) {
    const summary = summarizeProductRows([
      { price: '1.00', quantity, discount: '0.00' },
    ])
    assert.equal(summary.quantity, null)
    assert.equal(summary.gross, null)
    assert.equal(summary.afterDiscount, null)
  }
  for (const price of [undefined, 'invalid', '-1.00', 2]) {
    const summary = summarizeProductRows([
      { price, quantity: '2', discount: '0.00' },
    ])
    assert.equal(summary.quantity, '2')
    assert.equal(summary.gross, null)
    assert.equal(summary.afterDiscount, null)
  }
  for (const discount of [undefined, 'invalid', '1.001', '3.00']) {
    const summary = summarizeProductRows([
      { price: '1.00', quantity: '1', discount: '0.00' },
      { price: '1.00', quantity: '2', discount },
    ])
    assert.equal(summary.quantity, '3')
    assert.equal(summary.gross, '3.00')
    assert.equal(summary.afterDiscount, null)
    assert.equal(summary.unknownCounts.afterDiscount, 1)
  }
})

test('negative saved discounts retain seller price increases without adding order charges', () => {
  const summary = summarizeProductRows([
    {
      price: '10.00',
      quantity: '2',
      discount: '-1.50',
      shipping: '20.00',
      orderDiscount: '3.00',
    },
  ])
  assert.equal(summary.gross, '20.00')
  assert.equal(summary.afterDiscount, '21.50')
})
