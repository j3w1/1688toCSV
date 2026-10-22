import test from 'node:test'
import assert from 'node:assert/strict'
import { syntheticOrder } from './fixtures/container-fixture.mjs'
import { shipmentMoney, shipmentIntervalCents } from '../src/shipment-money.js'
import { moneyToCents } from '../src/money.js'
test('partial shipments use exact cumulative source cents and freight once, with final rounding reconciliation', () => {
  const record = syntheticOrder('1001', '3')
  record.snapshot.totals.shipping = '1.00'
  record.snapshot.totals.payable = '31.00'
  record.additionalCharges = [
    { id: 'fee', reason: 'Synthetic handling', amount: '0.05' },
  ]
  const rows = [0, 1, 2].map(
    (from) => shipmentMoney(record, { 2001: '1' }, { 2001: String(from) })[0]
  )
  assert.deepEqual(
    rows.map((row) => row.freightAllocated),
    ['0.33', '0.34', '0.33']
  )
  assert.equal(
    rows.reduce((sum, row) => sum + moneyToCents(row.sourceAmount), 0n),
    3000n
  )
  assert.equal(
    rows.reduce((sum, row) => sum + moneyToCents(row.additionalCharge), 0n),
    5n
  )
  assert.equal(
    rows.reduce((sum, row) => sum + moneyToCents(row.freightAllocated), 0n),
    100n
  )
  assert.equal(
    shipmentIntervalCents(-5n, '3', '0', '1') +
      shipmentIntervalCents(-5n, '3', '1', '2'),
    -5n
  )
  assert.throws(() => shipmentMoney(record, { 2001: '2' }, { 2001: '2' }), {
    code: 'SHIPMENT_VALUE_QUANTITY',
  })
})

test('amendment gaps allocate free financial source intervals without overlapping an immutable later shipment', async () => {
  const { shipmentFreeIntervals } = await import('../src/shipment-money.js')
  const occupied = [{ from: '2', quantity: '2' }]
  assert.deepEqual(shipmentFreeIntervals('10', '8', occupied), [
    { from: '0', quantity: '2' },
    { from: '4', quantity: '6' },
  ])
  const record = syntheticOrder('1001', '10')
  record.snapshot.totals.shipping = '0.07'
  const earlier = shipmentMoney(record, { 2001: '1' }, {}, [record], {
    2001: occupied,
  })[0]
  const later = shipmentMoney(record, { 2001: '7' }, {}, [record], {
    2001: [...occupied, ...earlier.valuation.intervals],
  })[0]
  const middle = shipmentIntervalCents(7n, '10', '2', '2')
  assert.equal(
    moneyToCents(earlier.freightAllocated) +
      moneyToCents(later.freightAllocated) +
      middle,
    7n
  )
  assert.deepEqual(later.valuation.intervals, [
    { from: '1', quantity: '1' },
    { from: '4', quantity: '6' },
  ])
})

test('changed source freight and feature/discount budgets subtract frozen actual cents rather than reusing old basis intervals', () => {
  const record = syntheticOrder('1001', '3')
  record.snapshot.totals.shipping = '0.02'
  record.snapshot.totals.payable = '30.02'
  record.productWorkflow = {
    2001: {
      features: {
        service: {
          name: 'Synthetic feature',
          unitCost: '0.01',
          included: false,
        },
      },
    },
  }
  const previous = {
    entryId: '2001',
    quantity: '1',
    sourceAmount: '10.00',
    sourceGrossAmount: '10.00',
    sourceDiscount: '0.00',
    allocatedDiscount: '0.00',
    additionalCharge: '0.00',
    featureCharge: '0.01',
    linkedPaymentCharge: '0.00',
    freightAllocated: '0.01',
    valuation: { intervals: [{ from: '1', quantity: '1' }] },
  }
  const result = shipmentMoney(
    record,
    { 2001: '2' },
    { 2001: '1' },
    [record],
    { 2001: previous.valuation.intervals },
    [previous]
  )[0]
  assert.equal(result.freightAllocated, '0.01')
  assert.equal(result.featureCharge, '0.02')
  assert.equal(result.sourceAmount, '20.00')
  assert.equal(
    moneyToCents(result.freightAllocated) +
      moneyToCents(previous.freightAllocated),
    2n
  )
  assert.equal(
    result.freightAllocationBasis,
    'remaining-source-cents-after-effective-shipments'
  )
})
