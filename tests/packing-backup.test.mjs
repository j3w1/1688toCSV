import test from 'node:test'
import assert from 'node:assert/strict'
import { validateBackup } from '../src/database.js'
import {
  allocatePreparation,
  createPreparation,
  packingCheckpoint,
  validatePreparation,
  validatePreparationReservations,
} from '../src/packing-model.js'
import {
  createPackingBackup,
  mergePackingPreparation,
  selectPackingPreparation,
} from '../src/packing-backup.js'

function fixture() {
  const snapshot = {
    schemaVersion: 1,
    accountId: 'local',
    orderId: '1001',
    sourceUrl:
      'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1001',
    sellerName: 'Synthetic seller',
    sellerMemberLogin: 'synthetic-seller',
    status: 'Completed',
    observedAt: '2026-10-01T12:00:00.000Z',
    items: ['Red cup', 'Blue cup', 'Bowl'].map((description, index) => ({
      entryId: String(index + 1),
      title: index < 2 ? 'Cup' : 'Bowl',
      description,
      thumbnail: `https://cbu01.alicdn.com/synthetic-${index}.png`,
      skuProperties: [{ label: '颜色', value: index === 0 ? 'red' : 'blue' }],
      price: '10.00',
      quantity: '1',
      sourceDiscount: '0.00',
      allocatedDiscount: '0.00',
      discount: '0.00',
    })),
    totals: {
      goodsGross: '30.00',
      shipping: '0.00',
      sourceDiscount: '0.00',
      orderAdjustment: '0.00',
      goodsNet: '30.00',
      payable: '30.00',
    },
  }
  const allocated = allocatePreparation(
    createPreparation(snapshot, '2026-10'),
    [],
    [],
    { snapshot }
  )
  const preparation = {
    ...allocated.preparation,
    revision: 1,
    updatedAt: '2026-10-02T12:00:00.000Z',
  }
  preparation.defaultPacking = packingCheckpoint(preparation)
  preparation.previousPacking = packingCheckpoint(preparation, {
    includeDefaults: true,
  })
  const backup = {
    format: '1688-order-library',
    version: 2,
    exportedAt: '2026-10-04T12:00:00.000Z',
    orders: [
      {
        snapshot,
        revision: 1,
        changedAt: snapshot.observedAt,
        lastCheckedAt: snapshot.observedAt,
        notes: '',
        tags: [],
        changedEntryIds: [],
        removedEntryIds: [],
      },
    ],
    preparations: [preparation],
    allocations: allocated.allocations,
    issuedCodes: allocated.issuedCodes,
    history: [],
    images: snapshot.items.map((item) => ({
      url: item.thumbnail,
      dataUrl: 'data:image/png;base64,AAAA',
      storedAt: snapshot.observedAt,
    })),
  }
  return { snapshot, preparation, backup }
}

const selection = (entryIds = ['2']) => ({
  months: ['2026-10'],
  orders: [{ orderId: '1001', entryIds }],
})
const members = (preparation) =>
  preparation.groups.flatMap((group) =>
    group.variants.flatMap((variant) => variant.entryIds)
  )

test('packing backup contains only selected prepared products and checkpoints, with full money dependencies', () => {
  const { backup } = fixture()
  const original = structuredClone(backup)
  const selected = createPackingBackup(backup, selection())
  assert.equal(selected.packingScope.mode, 'selection')
  assert.deepEqual(members(selected.preparations[0]), ['2'])
  for (const checkpoint of [
    selected.preparations[0].defaultPacking,
    selected.preparations[0].previousPacking,
    selected.preparations[0].previousPacking.defaults,
  ])
    assert.deepEqual(members(checkpoint), ['2'])
  assert.equal(selected.orders[0].snapshot.items.length, 3)
  assert.equal(selected.orders[0].snapshot.totals.payable, '30.00')
  assert.deepEqual(
    selected.images.map((image) => image.url),
    [backup.images[1].url]
  )
  assert.deepEqual(selected.issuedCodes, backup.issuedCodes)
  assert.deepEqual(backup, original)
  assert.deepEqual(members(validateBackup(selected).preparations[0]), ['2'])
})

test('an empty backup selection never means all products', () => {
  const { backup } = fixture()
  assert.throws(
    () => createPackingBackup(backup, selection([])),
    /invalid or duplicate selection/
  )
  assert.throws(
    () => createPackingBackup(backup, { months: ['2026-10'], orders: [] }),
    /Back up packing/
  )
})

test('scope rejects unprepared entries, duplicate months and month mismatches', () => {
  const { backup } = fixture()
  const missingPreparation = structuredClone(backup)
  missingPreparation.preparations[0].groups[0].variants.splice(1, 1)
  assert.throws(
    () => createPackingBackup(missingPreparation, selection()),
    /missing a prepared product/
  )
  for (const months of [
    ['2026-10', '2026-10'],
    ['2026-11'],
    ['2026-10', '2026-11'],
  ])
    assert.throws(
      () => createPackingBackup(backup, { ...selection(), months }),
      /months/
    )
})

test('legacy packing scopes are clipped on read, while full v1 and v2 backups stay full', () => {
  const { backup } = fixture()
  const legacy = { ...backup, packingScope: selection() }
  assert.deepEqual(members(validateBackup(legacy).preparations[0]), ['2'])
  assert.deepEqual(members(validateBackup(backup).preparations[0]), [
    '1',
    '2',
    '3',
  ])
  assert.deepEqual(validateBackup({ ...backup, version: 1 }).preparations, [])
  assert.throws(
    () =>
      validateBackup({
        ...backup,
        packingScope: { ...selection(), mode: 'selection' },
      }),
    /unselected preparation data/
  )
})

test('restoring selected variants preserves all other product authoring and issued codes', () => {
  const { preparation, backup } = fixture()
  const incoming = selectPackingPreparation(preparation, ['2'])
  incoming.updatedAt = '2026-10-03T12:00:00.000Z'
  incoming.groups[0].variants[0].variant = 'Updated blue cup'
  const original = structuredClone(preparation)
  const merged = mergePackingPreparation(preparation, incoming, ['2'])
  assert.deepEqual(members(merged), ['1', '2', '3'])
  assert.deepEqual(merged.groups[1], {
    ...preparation.groups[1],
    month: '2026-10',
  })
  assert.deepEqual(
    merged.groups[0].variants.find((variant) => variant.entryIds.includes('1')),
    preparation.groups[0].variants[0]
  )
  assert.equal(
    merged.groups[0].variants.find((variant) => variant.entryIds.includes('2'))
      .variant,
    'Updated blue cup'
  )
  assert.equal(merged.revision, 2)
  validatePreparationReservations(merged, backup)
  assert.deepEqual(preparation, original)
})

test('newer local packing edits win and tied conflicting edits fail', () => {
  const { preparation } = fixture()
  const incoming = selectPackingPreparation(preparation, ['2'])
  incoming.updatedAt = '2026-10-01T12:00:00.000Z'
  incoming.groups[0].variants[0].variant = 'Old'
  assert.equal(
    mergePackingPreparation(preparation, incoming, ['2']),
    preparation
  )
  incoming.updatedAt = preparation.updatedAt
  assert.throws(
    () => mergePackingPreparation(preparation, incoming, ['2']),
    /same timestamp/
  )
  assert.equal(
    mergePackingPreparation(
      preparation,
      selectPackingPreparation(preparation, ['2']),
      ['2']
    ),
    preparation
  )
})

test('shared group edits cannot modify unselected products during restore', () => {
  const { preparation } = fixture()
  const incoming = selectPackingPreparation(preparation, ['2'])
  incoming.updatedAt = '2026-10-03T12:00:00.000Z'
  incoming.groups[0].spanishName = 'NEW NAME'
  assert.throws(
    () => mergePackingPreparation(preparation, incoming, ['2']),
    /Restore the whole group/
  )
  const whole = selectPackingPreparation(preparation, ['1', '2'])
  whole.updatedAt = incoming.updatedAt
  whole.groups[0].spanishName = 'NEW NAME'
  assert.equal(
    mergePackingPreparation(preparation, whole, ['1', '2']).groups[0]
      .spanishName,
    'NEW NAME'
  )
})

test('fresh-library restore keeps a partial preparation partial', () => {
  const { preparation } = fixture()
  const restored = mergePackingPreparation(undefined, preparation, ['2'])
  assert.deepEqual(members(restored), ['2'])
  assert.deepEqual(members(restored.defaultPacking), ['2'])
})

test('partial restore keeps unselected group slots and applies only selected group ordering', () => {
  const { preparation } = fixture()
  preparation.groups.push({
    ...structuredClone(preparation.groups[1]),
    id: 'plate',
    title: 'Plate',
    baseCode: 'CE26100103',
    variants: [
      {
        ...preparation.groups[1].variants[0],
        id: 'plate-variant',
        entryIds: ['4'],
      },
    ],
  })
  preparation.defaultPacking = packingCheckpoint(preparation)
  const incoming = selectPackingPreparation(preparation, ['1', '2', '4'])
  incoming.updatedAt = '2026-10-03T12:00:00.000Z'
  incoming.groups[0].variants[0].variant = 'Changed cup description'
  const originalOrder = preparation.groups.map((group) => group.id)
  const restored = mergePackingPreparation(preparation, incoming, [
    '1',
    '2',
    '4',
  ])
  assert.deepEqual(
    restored.groups.map((group) => group.id),
    originalOrder
  )
  incoming.groups.reverse()
  incoming.defaultPacking.groups.reverse()
  const reordered = mergePackingPreparation(preparation, incoming, [
    '1',
    '2',
    '4',
  ])
  assert.deepEqual(
    reordered.groups.map((group) => group.id),
    [originalOrder[2], originalOrder[1], originalOrder[0]]
  )
  assert.deepEqual(
    reordered.defaultPacking.groups.map((group) => group.id),
    [originalOrder[2], originalOrder[1], originalOrder[0]]
  )
})

test('partial restore keeps unselected variant slots and shared source-row positions', () => {
  const { preparation } = fixture()
  preparation.groups[0].variants.push({
    ...structuredClone(preparation.groups[0].variants[1]),
    id: 'green-cup',
    entryIds: ['4'],
    variantSuffix: 'C',
  })
  const originalIds = preparation.groups[0].variants.map(
    (variant) => variant.id
  )
  const incoming = selectPackingPreparation(preparation, ['1', '4'])
  incoming.updatedAt = '2026-10-03T12:00:00.000Z'
  incoming.groups[0].variants.reverse()
  const reordered = mergePackingPreparation(preparation, incoming, ['1', '4'])
  assert.deepEqual(
    reordered.groups[0].variants.map((variant) => variant.id),
    [originalIds[2], originalIds[1], originalIds[0]]
  )
  preparation.groups[0].variants = [
    { ...preparation.groups[0].variants[0], entryIds: ['1', '2', '4'] },
  ]
  const shared = selectPackingPreparation(preparation, ['2'])
  shared.updatedAt = incoming.updatedAt
  assert.deepEqual(
    mergePackingPreparation(preparation, shared, ['2']).groups[0].variants[0]
      .entryIds,
    ['1', '2', '4']
  )
})

test('implicit and explicit effective months compare equally, including all checkpoints', () => {
  const { preparation } = fixture()
  const incoming = selectPackingPreparation(preparation, ['2'])
  for (const checkpoint of [
    incoming,
    incoming.defaultPacking,
    incoming.previousPacking,
    incoming.previousPacking.defaults,
  ])
    for (const group of checkpoint.groups) group.month = checkpoint.month
  assert.equal(
    mergePackingPreparation(preparation, validatePreparation(incoming), ['2']),
    preparation
  )
  incoming.updatedAt = '2026-10-03T12:00:00.000Z'
  incoming.groups[0].variants[0].variant = 'Changed description'
  const merged = mergePackingPreparation(preparation, incoming, ['2'])
  assert.deepEqual(members(merged), ['1', '2', '3'])
  assert.deepEqual(members(merged.defaultPacking), ['1', '2', '3'])
  assert.deepEqual(members(merged.previousPacking), ['1', '2', '3'])
  assert.deepEqual(members(merged.previousPacking.defaults), ['1', '2', '3'])
})

test('selection-only backups reject extra source orders outside the declared restore scope', () => {
  const { backup } = fixture()
  const extra = structuredClone(backup.orders[0])
  extra.snapshot.orderId = '2002'
  extra.snapshot.sourceUrl =
    'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=2002'
  backup.orders.push(extra)
  const selected = createPackingBackup(backup, selection())
  assert.equal(selected.orders.length, 1)
  selected.orders.push(extra)
  assert.throws(() => validateBackup(selected), /unselected source order/)
})

test('legacy scoped backups retain complete scoped orders and history without importing unrelated orders', () => {
  const { backup } = fixture()
  const unrelated = structuredClone(backup.orders[0])
  unrelated.snapshot.orderId = '2002'
  unrelated.snapshot.sourceUrl =
    'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=2002'
  const otherAccount = structuredClone(backup.orders[0])
  otherAccount.snapshot.accountId = 'other-account'
  backup.orders.push(unrelated, otherAccount)
  backup.history = backup.orders.map((order) => {
    const history = structuredClone(order)
    history.snapshot.observedAt =
      history.changedAt =
      history.lastCheckedAt =
        '2026-09-30T12:00:00.000Z'
    return history
  })
  const full = validateBackup(backup)
  assert.equal(full.orders.length, 3)
  assert.equal(full.history.length, 3)
  const scoped = validateBackup({ ...backup, packingScope: selection() })
  assert.equal(scoped.orders.length, 1)
  assert.equal(scoped.history.length, 1)
  for (const record of [...scoped.orders, ...scoped.history]) {
    assert.equal(record.snapshot.orderId, '1001')
    assert.equal(record.snapshot.accountId, 'local')
    assert.equal(record.snapshot.items.length, 3)
    assert.equal(record.snapshot.totals.payable, '30.00')
  }
  assert.deepEqual(members(scoped.preparations[0]), ['2'])
})
