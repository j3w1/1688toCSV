import test from 'node:test'
import assert from 'node:assert/strict'
import {
  exactDecimal,
  exactWhole,
  addExact,
  subtractExact,
  compareExact,
  multiplyExact,
  dividePowerOfTen,
  wholeCartonBreakdown,
  allocateExactDecimal,
} from '../src/carton-arithmetic.js'

test('decimal arithmetic retains signs, tiny values and arbitrary whole precision', () => {
  assert.equal(exactDecimal('-000.05000'), '-0.05')
  assert.equal(exactDecimal('-0.000'), '0')
  assert.equal(
    addExact('9007199254740993.00000001', '0.00000009'),
    '9007199254740993.0000001'
  )
  assert.equal(subtractExact('7', '8'), '-1')
  assert.equal(compareExact('-1.1', '-1.01'), -1)
  assert.equal(multiplyExact('16.75', '6'), '100.5')
  assert.equal(dividePowerOfTen(multiplyExact('48', '37', '27'), 6), '0.047952')
  assert.equal(exactWhole('013.000'), '13')
  for (const invalid of [
    '1e3',
    '1,5',
    ' 2',
    '',
    null,
    0.1,
    9007199254740992,
    '1+2',
  ])
    assert.throws(() => exactDecimal(invalid))
  assert.throws(() => exactWhole('1.5'))
  assert.throws(() => exactWhole('-1'))
  assert.throws(() => wholeCartonBreakdown('2', '0'))
})

test('table and property: quotient and remainder conserve exact whole units', () => {
  for (const [q, c, full, remainder] of [
    ['50', '10', '5', '0'],
    ['40', '30', '1', '10'],
    ['100', '45', '2', '10'],
    ['900719925474099312345', '45', '20015998343868873607', '30'],
  ])
    assert.deepEqual(wholeCartonBreakdown(q, c), {
      fullCartons: full,
      remainder,
    })
  for (let q = 0; q < 150; q++)
    for (let c = 1; c < 50; c++) {
      const result = wholeCartonBreakdown(String(q), String(c))
      assert.equal(
        addExact(
          multiplyExact(result.fullCartons, String(c)),
          result.remainder
        ),
        String(q)
      )
      assert.ok(BigInt(result.remainder) < BigInt(c))
    }
})

test('allocated measurement totals conserve and are row-order independent', () => {
  const entries = [
    { id: 'D', quantity: '90' },
    { id: 'A', quantity: '500' },
    { id: 'C', quantity: '300' },
    { id: 'B', quantity: '100' },
  ]
  for (const total of [
    '57.22',
    '0.461256',
    '-0.01',
    '0',
    '0.000000000000000001',
  ]) {
    const result = allocateExactDecimal(total, entries)
    assert.equal(addExact(...result.map((x) => x.value)), total)
    assert.ok(result.every((x) => x.basis === 'allocated'))
    assert.deepEqual(
      new Map(result.map((x) => [x.id, x.value])),
      new Map(
        allocateExactDecimal(total, [...entries].reverse()).map((x) => [
          x.id,
          x.value,
        ])
      )
    )
  }
  assert.throws(() => allocateExactDecimal('1', [{ id: 'A', quantity: '0' }]))
  assert.throws(() =>
    allocateExactDecimal('1', [
      { id: 'A', quantity: '1' },
      { id: 'A', quantity: '1' },
    ])
  )
})
