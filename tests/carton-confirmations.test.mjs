import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cartonBatchForItem,
  cartonBatchesForItems,
  cartonConfirmationForItem,
  editCartonConfirmation,
  normalizeCartonConfirmation,
  validateCartonConfirmations,
  validateCartonConfirmationMetadata,
  mergeCartonConfirmations,
} from '../src/carton-confirmations.js'
import { validateBackup } from '../src/database.js'
import { selectPackingOrder } from '../src/packing-backup.js'

function fixture() {
  const snapshot = {
    schemaVersion: 1,
    accountId: 'local',
    orderId: '1001',
    sourceUrl:
      'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1001',
    sellerName: 'Synthetic store',
    sellerMemberLogin: 'synthetic-store',
    observedAt: '2026-10-01T12:00:00.000Z',
    status: 'Completed',
    items: ['1', '2', '3'].map((entryId) => ({
      entryId,
      title: 'Synthetic product',
      description: 'Synthetic product',
      thumbnail: '',
      price: '10.00',
      quantity: '10',
      sourceDiscount: '0.00',
      allocatedDiscount: '0.00',
      discount: '0.00',
    })),
    totals: {
      goodsGross: '300.00',
      shipping: '0.00',
      sourceDiscount: '0.00',
      orderAdjustment: '0.00',
      goodsNet: '300.00',
      payable: '300.00',
    },
  }
  return {
    snapshot,
    revision: 1,
    changedAt: snapshot.observedAt,
    lastCheckedAt: snapshot.observedAt,
    notes: '',
    tags: [],
    changedEntryIds: [],
    removedEntryIds: [],
  }
}

function sharedFixture() {
  const record = fixture()
  record.snapshot.sourceType = 'spreadsheet'
  record.snapshot.items[0].sourceRow = 5
  record.snapshot.items[1].sourceRow = 5
  record.snapshot.items[2].sourceRow = 6
  return record
}

test('confirmation normalization preserves zero, unknown and safe whole counts', () => {
  for (const value of ['', '  ', null, undefined])
    assert.equal(normalizeCartonConfirmation(value), null)
  for (const [value, expected] of [
    [0, 0],
    [' 000 ', 0],
    ['002', 2],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ])
    assert.equal(normalizeCartonConfirmation(value), expected)
  for (const value of [
    -1,
    1.2,
    NaN,
    Infinity,
    true,
    [],
    {},
    '1.0',
    '1e2',
    '5 boxes',
    '1,000',
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(
      () => normalizeCartonConfirmation(value),
      /nonnegative whole number/
    )
})

test('split spreadsheet variants resolve one batch while ordinary products and purchases stay separate', () => {
  const shared = sharedFixture()
  assert.deepEqual(cartonBatchForItem(shared, '2'), {
    entryId: '1',
    entryIds: ['1', '2'],
    sourceRow: 5,
  })
  assert.deepEqual(cartonBatchesForItems(shared, ['1', '2', '3']), [
    { entryId: '1', entryIds: ['1', '2'], sourceRow: 5, complete: true },
    { entryId: '3', entryIds: ['3'], sourceRow: 6, complete: true },
  ])
  assert.equal(cartonBatchesForItems(shared, ['2'])[0].complete, false)
  assert.equal(cartonBatchesForItems(shared, ['2', '1', '2']).length, 1)
  assert.deepEqual(cartonBatchForItem(fixture(), '2'), {
    entryId: '2',
    entryIds: ['2'],
  })
  assert.throws(() => cartonBatchForItem(shared, '99'), /not found/)
  const saved = {
    ...shared,
    ...editCartonConfirmation(shared, '2', '2026-10', 'received', 4),
  }
  assert.deepEqual(cartonConfirmationForItem(saved, '1', '2026-10'), {
    received: 4,
  })
  assert.deepEqual(cartonConfirmationForItem(saved, '2', '2026-10'), {
    received: 4,
  })
  assert.deepEqual(
    cartonConfirmationForItem(sharedFixture(), '2', '2026-10'),
    {}
  )
})

test('month edits preserve the other confirmation, other months and source evidence', () => {
  const record = fixture(),
    source = structuredClone(record)
  let saved = {
    ...record,
    ...editCartonConfirmation(record, '1', '2026-10', 'received', 0),
  }
  saved = {
    ...saved,
    ...editCartonConfirmation(saved, '1', '2026-10', 'loaded', 3),
  }
  saved = {
    ...saved,
    ...editCartonConfirmation(saved, '1', '2026-11', 'received', 7),
  }
  assert.deepEqual(saved.cartonConfirmations, {
    1: { '2026-10': { received: 0, loaded: 3 }, '2026-11': { received: 7 } },
  })
  saved = {
    ...saved,
    ...editCartonConfirmation(saved, '1', '2026-10', 'received', ''),
  }
  assert.deepEqual(cartonConfirmationForItem(saved, '1', '2026-10'), {
    loaded: 3,
  })
  saved = {
    ...saved,
    ...editCartonConfirmation(saved, '1', '2026-10', 'loaded', null),
  }
  assert.deepEqual(saved.cartonConfirmations, {
    1: { '2026-11': { received: 7 } },
  })
  saved = {
    ...saved,
    ...editCartonConfirmation(saved, '1', '2026-11', 'received', undefined),
  }
  assert.deepEqual(saved.cartonConfirmations, {})
  assert.deepEqual(record, source)
  for (const month of ['2026-00', '2026-13', '2026-1', '26-10', '', null])
    assert.throws(
      () => editCartonConfirmation(record, '1', month, 'received', 1),
      /packing month/
    )
  assert.throws(
    () => editCartonConfirmation(record, '1', '2026-10', 'planned', 1),
    /received or loaded/
  )
})

test('backup validation rejects unknown owners, noncanonical batches, invalid fields and coerced counts', () => {
  const shared = sharedFixture()
  const valid = { 1: { '2026-10': { received: 0, loaded: 9 } } }
  assert.deepEqual(validateCartonConfirmations(valid, shared), valid)
  for (const value of [
    null,
    [],
    { 99: { '2026-10': { received: 1 } } },
    { 2: { '2026-10': { received: 1 } } },
    { 1: { '2026-10': { received: '1' } } },
    { 1: { '2026-10': { received: -1 } } },
    { 1: { '2026-10': { other: 1 } } },
    { 1: { '2026-10': {} } },
    { 1: {} },
  ])
    assert.throws(() => validateCartonConfirmations(value, shared))
  const record = fixture()
  record.cartonConfirmations = valid
  record.cartonConfirmationClocks = {
    1: { '2026-10': '2026-10-03T12:00:00.000Z' },
  }
  const backup = {
    format: '1688-order-library',
    version: 3,
    exportedAt: '2026-10-03T12:00:00.000Z',
    orders: [record],
    history: [],
    images: [],
    preparations: [],
    allocations: [],
    issuedCodes: [],
  }
  assert.deepEqual(validateBackup(backup).orders[0], record)
  for (const input of [
    { cartonConfirmations: valid },
    { cartonConfirmationClocks: [] },
    { cartonConfirmationClocks: { 1: { '2026-10': 'invalid' } } },
    {
      cartonConfirmationClocks: {
        1: { '2026-13': '2026-10-03T12:00:00.000Z' },
      },
    },
    {
      cartonConfirmationClocks: {
        99: { '2026-10': '2026-10-03T12:00:00.000Z' },
      },
    },
  ])
    assert.throws(() => validateCartonConfirmationMetadata(input, record))
})

test('older backup restores preserve newer month clears', () => {
  const record = fixture()
  record.cartonConfirmations = {
    1: { '2026-10': { received: 0, loaded: 3 }, '2026-11': { loaded: 7 } },
  }
  record.cartonConfirmationClocks = {
    1: {
      '2026-10': '2026-10-03T12:00:00.000Z',
      '2026-11': '2026-10-04T12:00:00.000Z',
    },
  }
  const cleared = {
    ...record,
    cartonConfirmations: {},
    cartonConfirmationClocks: {
      1: {
        '2026-10': '2026-10-05T12:00:00.000Z',
        '2026-11': '2026-10-06T12:00:00.000Z',
      },
    },
  }
  assert.equal(mergeCartonConfirmations(cleared, record), cleared)
})

test('scoped backup retains complete shared batches once and never changes an outside variant', () => {
  const record = sharedFixture()
  record.cartonConfirmations = {
    1: { '2026-10': { received: 0, loaded: 3 } },
    3: { '2026-10': { received: 5 } },
  }
  const clock = '2026-10-03T12:00:00.000Z'
  record.cartonConfirmationClocks = {
    1: { '2026-10': clock },
    3: { '2026-10': clock },
  }
  const partial = selectPackingOrder(record, ['2'])
  assert.deepEqual(partial.cartonConfirmations, {})
  assert.deepEqual(partial.cartonConfirmationClocks, {})
  const selected = selectPackingOrder(record, ['1', '2'])
  assert.deepEqual(selected.cartonConfirmations, {
    1: { '2026-10': { received: 0, loaded: 3 } },
  })
  assert.deepEqual(selected.cartonConfirmationClocks, {
    1: { '2026-10': clock },
  })
  const local = {
    ...record,
    cartonConfirmations: { 3: { '2026-10': { received: 8 } } },
    cartonConfirmationClocks: { 3: { '2026-10': '2026-10-02T12:00:00.000Z' } },
  }
  assert.deepEqual(
    mergeCartonConfirmations(local, selected).cartonConfirmations,
    {
      1: { '2026-10': { received: 0, loaded: 3 } },
      3: { '2026-10': { received: 8 } },
    }
  )
  const newerClear = {
    ...selected,
    cartonConfirmations: {},
    cartonConfirmationClocks: { 1: { '2026-10': '2026-10-06T12:00:00.000Z' } },
  }
  const completed = mergeCartonConfirmations(newerClear, record)
  assert.deepEqual(completed.cartonConfirmations, {
    3: { '2026-10': { received: 5 } },
  })
  assert.deepEqual(
    completed.cartonConfirmationClocks['1'],
    newerClear.cartonConfirmationClocks['1']
  )
})

test('month-scoped restore merges October without overwriting newer November confirmations', () => {
  const record = fixture()
  const october = '2026-10-03T12:00:00.000Z',
    november = '2026-11-03T12:00:00.000Z'
  record.cartonConfirmations = {
    1: { '2026-10': { received: 3, loaded: 2 }, '2026-11': { received: 8 } },
  }
  record.cartonConfirmationClocks = {
    1: { '2026-10': october, '2026-11': november },
  }
  const preparation = {
    month: '2026-10',
    groups: [{ variants: [{ entryIds: ['1'] }] }],
  }
  const selected = selectPackingOrder(record, ['1'], preparation)
  assert.deepEqual(selected.cartonConfirmations, {
    1: { '2026-10': { received: 3, loaded: 2 } },
  })
  assert.deepEqual(selected.cartonConfirmationClocks, {
    1: { '2026-10': october },
  })
  const local = {
    ...record,
    cartonConfirmations: { 1: { '2026-11': { received: 9 } } },
    cartonConfirmationClocks: { 1: { '2026-11': '2026-11-04T12:00:00.000Z' } },
  }
  const merged = mergeCartonConfirmations(local, selected)
  assert.deepEqual(merged.cartonConfirmations, {
    1: { '2026-10': { received: 3, loaded: 2 }, '2026-11': { received: 9 } },
  })
  assert.equal(
    merged.cartonConfirmationClocks['1']['2026-11'],
    local.cartonConfirmationClocks['1']['2026-11']
  )
  const cleared = {
    ...selected,
    cartonConfirmations: {},
    cartonConfirmationClocks: { 1: { '2026-10': '2026-10-04T12:00:00.000Z' } },
  }
  const afterFullRestore = mergeCartonConfirmations(
    mergeCartonConfirmations(local, cleared),
    record
  )
  assert.deepEqual(afterFullRestore.cartonConfirmations, {
    1: { '2026-11': { received: 9 } },
  })
  assert.throws(
    () =>
      mergeCartonConfirmations(record, {
        ...record,
        cartonConfirmations: {
          1: { '2026-10': { received: 4 }, '2026-11': { received: 8 } },
        },
      }),
    /same month timestamp/
  )
  assert.equal(
    mergeCartonConfirmations(record, {
      ...record,
      cartonConfirmations: {
        1: {
          '2026-10': { loaded: 2, received: 3 },
          '2026-11': { received: 8 },
        },
      },
    }),
    record
  )
})

test('retired source products remain restorable only with same-account purchase evidence', () => {
  const prior = fixture()
  const record = structuredClone(prior)
  record.snapshot.observedAt = '2026-10-04T12:00:00.000Z'
  record.changedAt = record.lastCheckedAt = record.snapshot.observedAt
  record.revision = 2
  record.snapshot.items = record.snapshot.items.slice(1)
  record.snapshot.totals = {
    ...record.snapshot.totals,
    goodsGross: '200.00',
    goodsNet: '200.00',
    payable: '200.00',
  }
  record.removedEntryIds = ['1']
  record.cartonConfirmations = { 1: { '2026-10': { received: 3 } } }
  record.cartonConfirmationClocks = {
    1: { '2026-10': '2026-10-03T12:00:00.000Z' },
  }
  const backup = {
    format: '1688-order-library',
    version: 3,
    exportedAt: record.snapshot.observedAt,
    orders: [record],
    history: [prior],
    preparations: [],
    allocations: [],
    issuedCodes: [],
    images: [],
  }
  assert.deepEqual(
    validateBackup(backup).orders[0].cartonConfirmations,
    record.cartonConfirmations
  )
  assert.throws(
    () => validateBackup({ ...backup, history: [] }),
    /missing from source evidence/
  )
  const otherAccount = structuredClone(prior)
  otherAccount.snapshot.accountId = 'other-account'
  assert.throws(
    () => validateBackup({ ...backup, history: [otherAccount] }),
    /missing from source evidence/
  )
})

test('scoped confirmations require complete shared-carton membership within each selected month', () => {
  const record = sharedFixture()
  const october = '2026-10-03T12:00:00.000Z',
    november = '2026-11-03T12:00:00.000Z'
  record.cartonConfirmations = {
    1: { '2026-10': { received: 2 }, '2026-11': { loaded: 1 } },
    3: { '2026-11': { received: 4 } },
  }
  record.cartonConfirmationClocks = {
    1: { '2026-10': october, '2026-11': november },
    3: { '2026-11': november },
  }
  const group = (month, ...ids) => ({ month, variants: [{ entryIds: ids }] })

  const splitMonths = selectPackingOrder(record, ['1', '2'], {
    month: '2026-10',
    groups: [group('2026-10', '1'), group('2026-11', '2')],
  })
  assert.deepEqual(splitMonths.cartonConfirmations, {})
  assert.deepEqual(splitMonths.cartonConfirmationClocks, {})

  const sameMonthDifferentGroups = selectPackingOrder(record, ['1', '2'], {
    month: '2026-10',
    groups: [group('2026-10', '1'), group('2026-10', '2')],
  })
  assert.deepEqual(sameMonthDifferentGroups.cartonConfirmations, {
    1: { '2026-10': { received: 2 } },
  })
  assert.deepEqual(sameMonthDifferentGroups.cartonConfirmationClocks, {
    1: { '2026-10': october },
  })

  const partialScope = selectPackingOrder(record, ['1', '3'], {
    month: '2026-10',
    groups: [group('2026-10', '1', '2'), group('2026-11', '3')],
  })
  assert.deepEqual(partialScope.cartonConfirmations, {
    3: { '2026-11': { received: 4 } },
  })
  assert.deepEqual(partialScope.cartonConfirmationClocks, {
    3: { '2026-11': november },
  })
})
