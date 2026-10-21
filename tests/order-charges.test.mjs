import test from 'node:test'
import assert from 'node:assert/strict'
import {
  additionalChargesTotal,
  mergeAdditionalCharges,
  orderCostAdjustments,
  validateAdditionalCharges,
} from '../src/order-charges.js'

const row = (entryId, price, quantity = '1', discount = '0.00') => ({
  entryId,
  price,
  quantity,
  discount,
})
const record = (items, amount = '0.01') => ({
  snapshot: { items },
  additionalCharges: [{ id: 'handling', reason: 'Unload delivery', amount }],
})

test('additional charges preserve original row values and allocate every cent by source net amount', () => {
  const input = record([row('1', '10.00', '2'), row('2', '10.00')], '1.00')
  const before = structuredClone(input)
  const costs = orderCostAdjustments(input)
  assert.deepEqual(input, before)
  assert.deepEqual(costs.get('1'), {
    sourceUnitPrice: '10.00',
    effectiveUnitPrice: '10.335',
    sourceAmount: '20.00',
    effectiveAmount: '20.67',
    additionalCharge: '0.67',
    featureCharge: '0.00',
  })
  assert.equal(costs.get('2').additionalCharge, '0.33')
  assert.equal(additionalChargesTotal(input), '1.00')
})

test('equal fractional remainders are assigned deterministically in source row order', () => {
  const input = record([row('3', '1.00'), row('2', '1.00'), row('1', '1.00')])
  const costs = orderCostAdjustments(input)
  assert.equal(costs.get('3').additionalCharge, '0.01')
  assert.equal(costs.get('2').additionalCharge, '0.00')
  assert.equal(costs.get('1').additionalCharge, '0.00')
})

test('custom per-piece feature costs add only to their source product and keep already recorded costs informational', () => {
  const input = record(
    [row('1', '10.125', '3', '1.00'), row('2', '2.00', '2')],
    '0.00'
  )
  input.productWorkflow = {
    1: {
      features: {
        engraving: { name: 'Engraving', unitCost: '0.25', included: false },
        lining: { name: 'Lining', unitCost: '1.20', included: false },
        lighting: { name: 'Lighting', unitCost: '2.00', included: true },
      },
    },
    2: { features: { rotation: true } },
  }
  const before = structuredClone(input)
  const costs = orderCostAdjustments(input)
  assert.equal(costs.get('1').sourceUnitPrice, '10.125')
  assert.equal(costs.get('1').effectiveUnitPrice, '11.575')
  assert.equal(costs.get('1').sourceAmount, '29.38')
  assert.equal(costs.get('1').featureCharge, '4.35')
  assert.equal(costs.get('1').effectiveAmount, '33.73')
  assert.equal(costs.get('2').effectiveAmount, '4.00')
  assert.equal(costs.get('2').featureCharge, '0.00')
  assert.deepEqual(input, before)
})

test('feature costs round each decimal-quantity row once and zero quantity adds no row charge', () => {
  const input = record([row('1', '0.00', '1.5'), row('2', '7.00', '0')], '0.00')
  input.productWorkflow = Object.fromEntries(
    ['1', '2'].map((id) => [
      id,
      {
        features: {
          paint: { name: 'Paint', unitCost: '0.01', included: false },
          trim: { name: 'Trim', unitCost: '0.02', included: false },
        },
      },
    ])
  )
  const costs = orderCostAdjustments(input)
  assert.equal(costs.get('1').featureCharge, '0.05')
  assert.equal(costs.get('1').effectiveUnitPrice, '0.03')
  assert.equal(costs.get('1').effectiveAmount, '0.05')
  assert.equal(costs.get('2').featureCharge, '0.00')
  assert.equal(costs.get('2').effectiveAmount, '0.00')
  assert.equal(costs.get('2').effectiveUnitPrice, '7.03')
})

test('discounted source rows weight costs by net values without reducing their effective unit price', () => {
  const input = record(
    [row('1', '10.00', '1', '5.00'), row('2', '10.00')],
    '3.00'
  )
  const costs = orderCostAdjustments(input)
  assert.equal(costs.get('1').additionalCharge, '1.00')
  assert.equal(costs.get('1').effectiveUnitPrice, '11.00')
  assert.equal(costs.get('1').sourceAmount, '5.00')
  assert.equal(costs.get('1').effectiveAmount, '6.00')
  assert.equal(costs.get('2').additionalCharge, '2.00')
})

test('free goods allocate handling costs by unit quantities instead of losing the charges', () => {
  const costs = orderCostAdjustments(
    record([row('1', '0.00', '2'), row('2', '0.00')], '1.00')
  )
  assert.equal(costs.get('1').additionalCharge, '0.67')
  assert.equal(costs.get('2').additionalCharge, '0.33')
})

test('fractional-cent source prices retain precision and effective amounts remain exact cents', () => {
  const costs = orderCostAdjustments(
    record([row('1', '0.123456789', '3')], '0.01')
  )
  assert.equal(costs.get('1').sourceUnitPrice, '0.123456789')
  assert.equal(costs.get('1').effectiveUnitPrice, '0.126790122')
  assert.equal(costs.get('1').effectiveAmount, '0.38')
  assert.equal(costs.get('1').additionalCharge, '0.01')
})

test('multiple reasons and costs validate without changing the entered source amounts', () => {
  const value = validateAdditionalCharges([
    { id: '1', reason: ' Worker unloading ', amount: '6' },
    { id: '2', reason: 'Labels', amount: '2.30' },
  ])
  assert.equal(additionalChargesTotal({ additionalCharges: value }), '8.30')
  assert.equal(value[0].reason, 'Worker unloading')
  assert.equal(value[0].amount, '6.00')
  for (const invalid of [
    null,
    {},
    [{ id: '', reason: 'Why', amount: '1' }],
    [{ id: '1', reason: '', amount: '1' }],
    [{ id: '1', reason: 'Why', amount: '-1' }],
    [{ id: '1', reason: 'Why', amount: '0' }],
    [{ id: '1', reason: 'Why', amount: '1.001' }],
    [...value, value[0]],
  ])
    assert.throws(() => validateAdditionalCharges(invalid))
})

test('charge restores preserve newer edits, apply newer clears and reject equal-time conflicts', () => {
  const previous = {
    ...record([row('1', '1.00')]),
    additionalChargesUpdatedAt: '2026-10-21T12:00:00Z',
  }
  assert.equal(
    mergeAdditionalCharges(previous, {
      additionalCharges: [],
      additionalChargesUpdatedAt: '2026-10-20T12:00:00Z',
    }),
    previous
  )
  assert.deepEqual(
    mergeAdditionalCharges(previous, {
      additionalCharges: [],
      additionalChargesUpdatedAt: '2026-10-22T12:00:00Z',
    }).additionalCharges,
    []
  )
  assert.throws(
    () =>
      mergeAdditionalCharges(previous, {
        additionalCharges: [],
        additionalChargesUpdatedAt: previous.additionalChargesUpdatedAt,
      }),
    /same timestamp/
  )
})

test('fractional and trailing-zero quantities allocate by exact decimal values', () => {
  const costs = orderCostAdjustments(
    record([row('1', '10.00', '1.5'), row('2', '10.00', '10.0')], '1.15')
  )
  assert.equal(costs.get('1').sourceAmount, '15.00')
  assert.equal(costs.get('1').additionalCharge, '0.15')
  assert.equal(costs.get('1').effectiveUnitPrice, '10.10')
  assert.equal(costs.get('2').additionalCharge, '1.00')
  assert.equal(costs.get('2').effectiveUnitPrice, '10.10')
})

test('zero-quantity rows are harmless without costs and cannot silently receive costs', () => {
  assert.equal(
    orderCostAdjustments(record([row('1', '10.00', '0')], '0.00')).get('1')
      .effectiveAmount,
    '0.00'
  )
  assert.throws(
    () => orderCostAdjustments(record([row('1', '10.00', '0')], '1.00')),
    /zero quantity/
  )
  const costs = orderCostAdjustments(
    record([row('1', '10.00', '0'), row('2', '10.00')], '1.00')
  )
  assert.equal(costs.get('1').additionalCharge, '0.00')
  assert.equal(costs.get('2').additionalCharge, '1.00')
})
