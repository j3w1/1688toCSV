import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cartonBreakdown,
  normalizeUnitsPerCarton,
} from '../src/carton-packing.js'

test('carton capacity accepts positive safe integers and explicit blank clears', () => {
  for (const [input, expected] of [
    [10, 10],
    [' 10 ', 10],
    ['0010', 10],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ['', null],
    ['  ', null],
    [null, null],
    [undefined, null],
  ])
    assert.equal(normalizeUnitsPerCarton(input), expected)
  for (const input of [
    0,
    -1,
    1.5,
    Infinity,
    NaN,
    true,
    [],
    {},
    '1.5',
    '10.0',
    '1e2',
    '0x10',
    '-10',
    '0',
    Number.MAX_SAFE_INTEGER + 1,
    '9007199254740993',
  ])
    assert.throws(() => normalizeUnitsPerCarton(input), /positive whole number/)
})

test('carton breakdown distinguishes complete cartons and leftovers requiring review', () => {
  for (const [quantity, fullCartons, remainder, estimatedCartons, status] of [
    ['100', 10, 0, 10, 'exact'],
    ['105', 10, 5, 11, 'partial'],
    ['5', 0, 5, 1, 'partial'],
    ['0', 0, 0, 0, 'exact'],
    ['100.00', 10, 0, 10, 'exact'],
    [105, 10, 5, 11, 'partial'],
  ])
    assert.deepEqual(cartonBreakdown(quantity, 10), {
      status,
      unitsPerCarton: 10,
      fullCartons,
      remainder,
      estimatedCartons,
    })
})

test('unknown capacity and invalid or fractional source quantities never produce carton counts', () => {
  for (const capacity of [undefined, null, '', 0, -10, 1.5, 'bad'])
    assert.deepEqual(cartonBreakdown('100', capacity), {
      status: 'unknown',
      unitsPerCarton: null,
      fullCartons: null,
      remainder: null,
      estimatedCartons: null,
    })
  for (const quantity of [
    undefined,
    null,
    '',
    true,
    [],
    {},
    '-1',
    '1.5',
    '1e2',
    '0x10',
    '9007199254740990.1',
    '9007199254740993',
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.deepEqual(cartonBreakdown(quantity, 10), {
      status: 'unknown',
      unitsPerCarton: 10,
      fullCartons: null,
      remainder: null,
      estimatedCartons: null,
    })
})

test('large safe quantities retain exact carton counts and remainders', () => {
  assert.deepEqual(cartonBreakdown(Number.MAX_SAFE_INTEGER, 2), {
    status: 'partial',
    unitsPerCarton: 2,
    fullCartons: 4_503_599_627_370_495,
    remainder: 1,
    estimatedCartons: 4_503_599_627_370_496,
  })
  assert.deepEqual(cartonBreakdown(Number.MAX_SAFE_INTEGER, 1), {
    status: 'exact',
    unitsPerCarton: 1,
    fullCartons: Number.MAX_SAFE_INTEGER,
    remainder: 0,
    estimatedCartons: Number.MAX_SAFE_INTEGER,
  })
})
