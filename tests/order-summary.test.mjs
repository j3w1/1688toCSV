import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeOrders } from '../src/order-summary.js'

function order(overrides = {}, fields = {}) {
  return {
    accountId: 'local',
    orderId: '9990000000000000001',
    observedAt: '2026-10-15T00:00:00.000Z',
    items: [{}, {}],
    ...fields,
    totals: {
      goodsGross: '100.00',
      shipping: '5.00',
      sourceDiscount: '10.00',
      orderAdjustment: '2.00',
      goodsNet: '88.00',
      payable: '93.00',
      ...overrides,
    },
  }
}

test('sums complete orders once and preserves exact fractional cents in totals', () => {
  const first = order()
  const second = order(
    {
      goodsGross: '0.30',
      shipping: '0.10',
      sourceDiscount: '0.00',
      orderAdjustment: '0.00',
      goodsNet: '0.30',
      payable: '0.40',
    },
    { orderId: '9990000000000000002' }
  )
  const result = summarizeOrders([
    { snapshot: first },
    { snapshot: first },
    second,
  ])
  assert.equal(result.scope, 'complete-orders')
  assert.equal(result.orderCount, 2)
  assert.equal(result.productRowCount, 4)
  assert.equal(result.amounts.originalTotal, '100.30')
  assert.equal(result.amounts.shipping, '5.10')
  assert.equal(result.amounts.payable, '93.40')
  assert.equal(result.reconciled, true)
  assert.deepEqual(result.warnings, [])
})

test('seller changes included in row discounts are not deducted twice', () => {
  const result = summarizeOrders([
    order({
      sourceDiscount: '12.00',
      rowIncludedAdjustment: '2.00',
    }),
  ])
  assert.equal(result.amounts.productDiscount, '10.00')
  assert.equal(result.amounts.sellerAdjustment, '2.00')
  assert.equal(result.amounts.payable, '93.00')
  assert.equal(result.reconciled, true)
})

test('already-in-price wholesale reductions, order discounts and red packets stay distinct', () => {
  const result = summarizeOrders([
    order({
      goodsGross: '120.00',
      priceIncludedDiscount: '20.00',
      orderDiscount: '3.00',
      redPacketDiscount: '1.00',
      goodsNet: '85.00',
      payable: '89.00',
    }),
  ])
  assert.equal(result.amounts.productDiscount, '30.00')
  assert.equal(result.amounts.orderDiscount, '3.00')
  assert.equal(result.amounts.redPacketDiscount, '1.00')
  assert.equal(result.amounts.payable, '89.00')
  assert.equal(result.reconciled, true)
})

test('customization already included in original gross is not charged twice', () => {
  const included = order({
    goodsGross: '160.00',
    customizationService: '60.00',
    grossIncludedCustomization: '60.00',
    payable: '153.00',
  })
  const extra = order(
    { customizationService: '60.00', payable: '153.00' },
    { orderId: '9990000000000000002' }
  )
  const result = summarizeOrders([included, extra])
  assert.equal(result.amounts.originalTotal, '260.00')
  assert.equal(result.amounts.customizationService, '60.00')
  assert.equal(result.amounts.payable, '306.00')
  assert.equal(result.reconciled, true)
})

test('seller price increases remain signed and add to payable', () => {
  const result = summarizeOrders([
    order({
      orderAdjustment: '-2.00',
      goodsNet: '92.00',
      payable: '97.00',
    }),
  ])
  assert.equal(result.amounts.sellerAdjustment, '-2.00')
  assert.equal(result.reconciled, true)
})

test('missing or invalid amounts remain unknown with an explicit partial sum', () => {
  const result = summarizeOrders([
    order(),
    order(
      { shipping: undefined, payable: 'unavailable' },
      { orderId: '9990000000000000002' }
    ),
  ])
  assert.equal(result.amounts.shipping, null)
  assert.equal(result.amounts.payable, null)
  assert.equal(result.knownAmounts.shipping, '5.00')
  assert.equal(result.knownAmounts.payable, '93.00')
  assert.equal(result.unknownCounts.payable, 1)
  assert.equal(result.amounts.originalTotal, '200.00')
  assert.equal(result.missingOrderCount, 1)
  assert.equal(result.reconciled, null)
  assert.equal(result.warnings[0].code, 'missing-amounts')
})

test('missing total records do not invent zero-valued optional discounts', () => {
  const snapshot = order()
  delete snapshot.totals
  const result = summarizeOrders([snapshot])
  assert.equal(result.amounts.orderDiscount, null)
  assert.equal(result.amounts.redPacketDiscount, null)
  assert.equal(result.reconciled, null)
})

test('currency-fee placeholders remain disclosed while known CNY totals reconcile', () => {
  const result = summarizeOrders([
    order({}, { foreignCurrencyFeeUnspecified: true }),
  ])
  assert.equal(result.foreignCurrencyFeeUnknownCount, 1)
  assert.equal(result.amounts.payable, '93.00')
  assert.equal(result.reconciled, true)
})

test('distinct accounts retain their orders and duplicate observations use latest snapshot', () => {
  const first = order()
  const latest = order(
    { shipping: '6.00', payable: '94.00' },
    { observedAt: '2026-10-15T01:00:00.000Z' }
  )
  const anotherAccount = order({}, { accountId: 'other' })
  const result = summarizeOrders([latest, first, anotherAccount])
  assert.equal(result.orderCount, 2)
  assert.equal(result.amounts.payable, '187.00')
  assert.equal(result.reconciled, true)
})

test('reports even one cent of inconsistent source totals without hiding the source value', () => {
  const result = summarizeOrders([order({ payable: '93.01' })])
  assert.equal(result.amounts.payable, '93.01')
  assert.equal(result.reconciled, false)
  assert.equal(result.inconsistentOrderCount, 1)
  assert.equal(result.warnings[0].code, 'inconsistent-amounts')
})

test('empty scopes stay empty and totals are exact above Number safe integer range', () => {
  const empty = summarizeOrders([])
  assert.equal(empty.orderCount, 0)
  assert.equal(empty.amounts.payable, '0.00')
  const result = summarizeOrders([
    order({
      goodsGross: '9007199254740993.11',
      goodsNet: '9007199254740981.11',
      payable: '9007199254740986.11',
    }),
  ])
  assert.equal(result.amounts.payable, '9007199254740986.11')
  assert.equal(result.reconciled, true)
})
