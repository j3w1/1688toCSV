import test from 'node:test'
import assert from 'node:assert/strict'
import { syntheticOrder } from './fixtures/container-fixture.mjs'
import { shipmentMoney, shipmentIntervalCents } from '../src/shipment-money.js'
import { moneyToCents } from '../src/money.js'
test('partial shipments use exact cumulative source cents and freight once, with final rounding reconciliation', () => {
  const record = syntheticOrder('1001', '3')
  record.snapshot.totals.shipping = '1.00'
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
