import test from 'node:test'
import assert from 'node:assert/strict'
import {
  arrangePreparations,
  orderedPreparations,
  arrangeOrderPositions,
} from '../src/packing-arrangement.js'
import { createPreparation, validatePreparation } from '../src/packing-model.js'

const draft = (orderId, sellerId, codes) => ({
  orderId,
  sellerId,
  groups: codes.map((baseCode, index) => ({
    id: `${orderId}-${index}`,
    baseCode,
    variants: [],
  })),
})
test('arranging stores, codes and both keeps complete orders and issued codes together', () => {
  const drafts = [
    draft('1', 'z', ['CE26100102', 'CE26100101']),
    draft('2', 'a', ['CE26100201']),
    draft('3', 'z', ['CE26100103']),
  ]
  const original = structuredClone(drafts)
  const ids = drafts.map((value) => value.orderId)
  const store = arrangePreparations(drafts, ids, 'store', new Map())
  assert.deepEqual(
    store.map((value) => value.orderId),
    ['2', '1', '3']
  )
  assert.deepEqual(
    store[1].groups.map((group) => group.baseCode),
    ['CE26100102', 'CE26100101']
  )
  const code = arrangePreparations(drafts, ids, 'code', new Map())
  assert.deepEqual(
    code.map((value) => value.orderId),
    ['1', '3', '2']
  )
  assert.deepEqual(
    code[0].groups.map((group) => group.baseCode),
    ['CE26100101', 'CE26100102']
  )
  const both = arrangePreparations(drafts, ids, 'store-code', new Map())
  assert.deepEqual(
    both.map((value) => value.orderId),
    ['2', '1', '3']
  )
  assert.deepEqual(
    both[1].groups.map((group) => group.baseCode),
    ['CE26100101', 'CE26100102']
  )
  assert.deepEqual(drafts, original)
})
test('filtered arrangement retains other order positions and stable equal-store order', () => {
  const drafts = [
    draft('1', 'z', ['CE26100102']),
    draft('2', 'a', ['CE26100201']),
    draft('3', 'z', ['CE26100101']),
  ]
  assert.deepEqual(
    arrangePreparations(drafts, ['1', '3'], 'code', new Map()).map(
      (value) => value.orderId
    ),
    ['3', '2', '1']
  )
  assert.deepEqual(
    orderedPreparations([
      { orderId: 'a', packingPosition: 2 },
      { orderId: 'b' },
      { orderId: 'c', packingPosition: 0 },
    ]).map((value) => value.orderId),
    ['c', 'a', 'b']
  )
  const groups = arrangePreparations(
    [draft('1', 'z', ['CE26100103', 'CE26100102', 'CE26100101'])],
    ['1'],
    'code',
    new Map(),
    new Map([['1', ['1-0', '1-2']]])
  )[0].groups
  assert.deepEqual(
    groups.map((group) => group.baseCode),
    ['CE26100101', 'CE26100102', 'CE26100103']
  )
  assert.equal(groups[1].manualReordered, undefined)
})

test('partial order arrangement reuses sparse slots and normalizes legacy ties only once', () => {
  const c = { ...draft('c', 'c', []), packingPosition: 20 }
  const b = { ...draft('b', 'b', []), packingPosition: 10 }
  const a = { ...draft('a', 'a', []), packingPosition: 0 }
  const changed = arrangeOrderPositions([c, b, a], [b, a], true)
  assert.deepEqual(
    orderedPreparations(changed).map(({ orderId }) => orderId),
    ['b', 'a', 'c']
  )
  assert.equal(changed[2], c)
  assert.deepEqual(
    changed.map(({ packingPosition }) => packingPosition),
    [0, 10, 20]
  )
  const legacy = [
    c,
    { ...b, packingPosition: 20 },
    { ...a, packingPosition: undefined },
  ]
  const normalized = arrangeOrderPositions(legacy, [a, b])
  assert.deepEqual(
    normalized.map(({ orderId, packingPosition }) => [
      orderId,
      packingPosition,
    ]),
    [
      ['c', 0],
      ['a', 1],
      ['b', 2],
    ]
  )
  const repeated = arrangeOrderPositions(normalized, [
    normalized[2],
    normalized[1],
  ])
  assert.equal(repeated[0], normalized[0])
  assert.deepEqual(
    orderedPreparations(repeated).map(({ orderId }) => orderId),
    ['c', 'b', 'a']
  )
})
test('packing positions and manual order marks survive validation and backup serialization', () => {
  const source = {
    accountId: 'local',
    orderId: '1001',
    sellerName: 'a',
    items: [{ entryId: '1', title: 'Cup', description: 'Cup' }],
  }
  const prepared = {
    ...createPreparation(source, '2026-10'),
    packingPosition: 3,
    packingManualReordered: true,
  }
  assert.equal(
    validatePreparation(JSON.parse(JSON.stringify(prepared))).packingPosition,
    3
  )
  assert.equal(validatePreparation(prepared).packingManualReordered, true)
  assert.throws(
    () => validatePreparation({ ...prepared, packingPosition: -1 }),
    /Packing position/
  )
})
