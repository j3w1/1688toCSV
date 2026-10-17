import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allocatePreparation,
  createPreparation,
  extendDefaultPacking,
  groupPackingMonth,
  packingCheckpoint,
  planSelectedPreparations,
  regeneratePreparationCode,
  reorderPreparationGroups,
  reorderPreparationVariants,
  resetPreparationOrder,
  restoreDefaultPacking,
  restorePreviousPacking,
  validatePreparation,
  validatePreparationReservations,
} from '../src/packing-model.js'

function source(orderId = '1001') {
  return {
    accountId: 'local',
    orderId,
    sellerName: 'Synthetic seller',
    items: [
      {
        entryId: '1',
        title: 'Cup',
        description: 'Red cup',
        thumbnail: 'https://cbu01.alicdn.com/synthetic-red.png',
        skuProperties: [{ label: '颜色', value: 'red' }],
      },
      {
        entryId: '2',
        title: 'Cup',
        description: 'Blue cup',
        thumbnail: 'https://cbu01.alicdn.com/synthetic-blue.png',
        skuProperties: [{ label: '颜色', value: 'blue' }],
      },
      {
        entryId: '3',
        title: 'Bowl',
        description: 'Bowl',
        thumbnail: 'https://cbu01.alicdn.com/synthetic-bowl.png',
      },
    ],
  }
}

test('selected rows split into the chosen packing month while unselected codes and memberships stay intact', () => {
  const snapshot = source()
  const initial = allocatePreparation(
    createPreparation(snapshot, '2026-10'),
    [],
    [],
    { snapshot }
  )
  const original = structuredClone(initial.preparation)
  const oldCup = original.groups[0]
  const plan = planSelectedPreparations(
    [{ snapshot, preparation: original, entryIds: ['2', '3'] }],
    '2026-12'
  )
  assert.equal(plan.changedCodeCount, 2)
  assert.equal(plan.splitGroupCount, 1)
  assert.equal(plan.rowCount, 2)
  const result = allocatePreparation(
    plan.preparations[0],
    initial.allocations,
    initial.issuedCodes
  )
  const [old, movedCup, movedBowl] = result.preparation.groups
  assert.equal(old.id, oldCup.id)
  assert.equal(old.baseCode, 'CE26100101')
  assert.equal(groupPackingMonth(result.preparation, old), '2026-10')
  assert.deepEqual(
    old.variants.map((entry) => entry.entryIds),
    [['1']]
  )
  assert.notEqual(movedCup.id, oldCup.id)
  assert.notEqual(movedCup.variants[0].id, oldCup.variants[1].id)
  assert.equal(movedCup.baseCode, 'CE26120101')
  assert.equal(movedBowl.baseCode, 'CE26120102')
  assert.deepEqual(plan.scope[0].groupIds, [movedCup.id, movedBowl.id])
  assert.ok(result.issuedCodes.some((entry) => entry.code === 'CE26100101B'))
  assert.deepEqual(initial.preparation, original)
})

test('month planning freezes all selected orders and never treats an empty selection as all', () => {
  const first = source()
  const second = source('1002')
  const plan = planSelectedPreparations(
    [
      { snapshot: first, entryIds: ['1', '2'] },
      { snapshot: second, entryIds: ['3'] },
    ],
    '2026-12'
  )
  assert.equal(plan.orderCount, 2)
  assert.equal(plan.rowCount, 3)
  assert.deepEqual(
    plan.preparations.map((entry) => entry.groups.length),
    [1, 1]
  )
  assert.deepEqual(plan.preparations[1].groups[0].variants[0].entryIds, ['3'])
  assert.equal(plan.changedCodeCount, 0)
  assert.equal(
    planSelectedPreparations([{ snapshot: first, entryIds: [] }], '2026-12')
      .preparations.length,
    0
  )
  assert.throws(
    () =>
      planSelectedPreparations(
        [{ snapshot: first, entryIds: ['99'] }],
        '2026-12'
      ),
    /selected products changed/
  )
})

test('same-month partial selection retains shared barcode membership without another group', () => {
  const snapshot = source()
  snapshot.items[1].skuProperties = snapshot.items[0].skuProperties
  const original = allocatePreparation(
    createPreparation(snapshot, '2026-10'),
    [],
    []
  ).preparation
  const plan = planSelectedPreparations(
    [{ snapshot, preparation: original, entryIds: ['2'] }],
    '2026-10'
  )
  assert.equal(plan.changes.length, 0)
  assert.equal(plan.preparations[0].groups.length, 2)
  assert.deepEqual(plan.preparations[0].groups[0].variants[0].entryIds, [
    '1',
    '2',
  ])
  assert.deepEqual(plan.scope[0].entryIds, ['2'])
})

test('manual group and product ordering persists flags but never renumbers codes or crosses containers', () => {
  const snapshot = source()
  const initial = allocatePreparation(
    createPreparation(snapshot, '2026-10'),
    [],
    []
  ).preparation
  const groups = reorderPreparationGroups(
    initial,
    initial.groups.map((entry) => entry.id).reverse()
  )
  const cup = groups.groups[1]
  const moved = reorderPreparationVariants(
    groups,
    cup.id,
    cup.variants.map((entry) => entry.id).reverse()
  )
  const valid = validatePreparation(moved)
  assert.deepEqual(
    valid.groups.map((entry) => entry.baseCode),
    ['CE26100102', 'CE26100101']
  )
  assert.ok(valid.groups.every((entry) => entry.manualReordered))
  assert.ok(valid.groups[1].variants.every((entry) => entry.manualReordered))
  assert.equal(valid.groups[1].variants[0].variantSuffix, 'B')
  const reset = resetPreparationOrder(valid, snapshot)
  assert.deepEqual(reset, initial)
  assert.throws(
    () =>
      reorderPreparationGroups(initial, [
        initial.groups[0].id,
        'foreign-group',
      ]),
    /another order/
  )
  assert.throws(
    () =>
      reorderPreparationVariants(initial, initial.groups[0].id, [
        initial.groups[0].variants[0].id,
        initial.groups[1].variants[0].id,
      ]),
    /another order or group/
  )
  assert.throws(
    () =>
      validatePreparation({
        ...initial,
        groups: [{ ...initial.groups[0], manualReordered: 'yes' }],
      }),
    /true or false/
  )
})

test('code conflicts expose original ownership and next-code drafts keep prior codes reserved', () => {
  const snapshot = source()
  const first = allocatePreparation(
    createPreparation(snapshot, '2026-10'),
    [],
    [],
    { snapshot }
  )
  const requested = createPreparation(source('1002'), '2026-10')
  requested.groups[0].baseCode = first.preparation.groups[0].baseCode
  assert.throws(
    () => allocatePreparation(requested, first.allocations, first.issuedCodes),
    (error) => {
      assert.equal(error.code, 'PACKING_CODE_CONFLICT')
      assert.equal(error.conflict.owner.orderId, '1001')
      assert.equal(error.conflict.requestedOwner.orderId, '1002')
      assert.equal(
        error.conflict.owner.ownerSnapshot.photos[0],
        snapshot.items[0].thumbnail
      )
      return true
    }
  )
  const changed = regeneratePreparationCode(
    first.preparation,
    first.preparation.groups[0].id
  )
  const result = allocatePreparation(
    changed,
    first.allocations,
    first.issuedCodes
  )
  assert.equal(result.preparation.groups[0].baseCode, 'CE26100103')
  assert.ok(result.issuedCodes.some((entry) => entry.code === 'CE26100101'))
})

test('bounded packing snapshots preserve restore values without reserving inactive codes', () => {
  const initial = allocatePreparation(
    createPreparation(source(), '2026-10'),
    [],
    []
  )
  initial.preparation.revision = 1
  const base = packingCheckpoint(initial.preparation)
  const changed = regeneratePreparationCode(
    initial.preparation,
    initial.preparation.groups[0].id
  )
  changed.defaultPacking = base
  changed.previousPacking = base
  changed.groups[0].spanishName = 'TAZA PERSONALIZADA'
  const result = allocatePreparation(
    changed,
    initial.allocations,
    initial.issuedCodes
  )
  const reset = restoreDefaultPacking(result.preparation)
  assert.equal(reset.groups[0].baseCode, 'CE26100101')
  assert.equal(reset.groups[0].spanishName, 'TAZA PERSONALIZADA')
  const previous = restorePreviousPacking(result.preparation)
  assert.equal(previous.groups[0].baseCode, 'CE26100101')
  assert.equal(previous.groups[0].spanishName, base.groups[0].spanishName)
  assert.equal(previous.previousPacking.groups[0].baseCode, 'CE26100103')
  validatePreparationReservations(result.preparation, result)
  const unreserved = structuredClone(result.preparation)
  unreserved.defaultPacking.groups[0].baseCode = 'CE26100199'
  validatePreparationReservations(unreserved, result)
  unreserved.groups[0].baseCode = 'CE26100199'
  assert.throws(
    () => validatePreparationReservations(unreserved, result),
    /missing issued code reservations/
  )
  const nested = structuredClone(result.preparation)
  nested.previousPacking.previousPacking = base
  assert.throws(() => validatePreparation(nested), /nested history/)
})

test('default baselines append newly prepared source rows without absorbing manual regrouping', () => {
  const snapshot = source()
  const initial = allocatePreparation(
    createPreparation({ ...snapshot, items: [snapshot.items[0]] }, '2026-10'),
    [],
    []
  )
  initial.preparation.defaultPacking = packingCheckpoint(initial.preparation)
  const plan = planSelectedPreparations(
    [{ snapshot, preparation: initial.preparation, entryIds: ['2', '3'] }],
    '2026-10'
  )
  const additional = allocatePreparation(
    plan.preparations[0],
    initial.allocations,
    initial.issuedCodes
  )
  const baseline = extendDefaultPacking(additional.preparation, snapshot)
  assert.equal(baseline.groups.length, 3)
  assert.equal(baseline.groups[0].id, initial.preparation.groups[0].id)
  assert.equal(
    baseline.groups[0].baseCode,
    initial.preparation.groups[0].baseCode
  )
  assert.deepEqual(
    baseline.groups.flatMap((group) =>
      group.variants.flatMap((variant) => variant.entryIds)
    ),
    ['1', '2', '3']
  )
  const regrouped = structuredClone(additional.preparation)
  regrouped.defaultPacking = baseline
  regrouped.groups[0].variants.push(...regrouped.groups[1].variants)
  regrouped.groups.splice(1, 1)
  assert.deepEqual(extendDefaultPacking(regrouped, snapshot), baseline)
})

test('reset restores a same-owner original base with its original barcode suffixes', () => {
  const snapshot = source()
  const original = allocatePreparation(
    createPreparation(snapshot, '2026-10'),
    [],
    []
  )
  const draft = regeneratePreparationCode(
    original.preparation,
    original.preparation.groups[0].id
  )
  draft.defaultPacking = packingCheckpoint(original.preparation)
  draft.groups[0].variants[0].variantSuffix = 'ZZ'
  const changed = allocatePreparation(
    draft,
    original.allocations,
    original.issuedCodes
  )
  const restored = allocatePreparation(
    restoreDefaultPacking(changed.preparation),
    changed.allocations,
    changed.issuedCodes
  )
  assert.equal(restored.preparation.groups[0].baseCode, 'CE26100101')
  assert.deepEqual(
    restored.preparation.groups[0].variants.map(
      (variant) => variant.variantSuffix
    ),
    ['A', 'B']
  )
  assert.ok(restored.issuedCodes.some((entry) => entry.code === 'CE26100103ZZ'))
  assert.ok(restored.issuedCodes.some((entry) => entry.code === 'CE26100101A'))
})
