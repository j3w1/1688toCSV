import test from 'node:test'
import assert from 'node:assert/strict'
import { validateBackup } from '../src/database.js'
import { createPreparation, allocatePreparation } from '../src/packing-model.js'
import { createPackingBackup } from '../src/packing-backup.js'
import {
  validateCartonBatch,
  createLegacyCartonBatches,
} from '../src/carton-batches.js'
import { createCartonBatchesRepository } from '../src/carton-batches-repository.js'
import { repeatProductStoreIdentity } from '../src/repeat-products.js'

function fixture() {
  const observedAt = '2026-10-20T12:00:00.000Z',
    authoredAt = '2026-10-21T12:00:00.000Z',
    snapshot = {
      schemaVersion: 1,
      accountId: 'local',
      orderId: '1001',
      sourceUrl:
        'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1001',
      sellerName: 'Synthetic carton factory',
      sellerMemberLogin: 'synthetic-carton-factory',
      status: 'Completed',
      observedAt,
      items: [
        {
          entryId: '1',
          title: 'Plush figure',
          description: 'Synthetic plush figure',
          thumbnail: '',
          price: '1.00',
          quantity: '3',
          sourceDiscount: '0.00',
          allocatedDiscount: '0.00',
          discount: '0.00',
        },
      ],
      totals: {
        goodsGross: '3.00',
        shipping: '0.00',
        sourceDiscount: '0.00',
        orderAdjustment: '0.00',
        goodsNet: '3.00',
        payable: '3.00',
      },
    },
    allocation = allocatePreparation(
      createPreparation(snapshot, '2026-10'),
      [],
      [],
      { snapshot }
    ),
    preparation = {
      ...allocation.preparation,
      revision: 1,
      updatedAt: authoredAt,
    },
    record = {
      snapshot,
      revision: 1,
      changedAt: observedAt,
      lastCheckedAt: observedAt,
      notes: '',
      tags: [],
      changedEntryIds: [],
      removedEntryIds: [],
    },
    batch = validateCartonBatch({
      id: 'cartons-1',
      accountId: 'local',
      storeId: repeatProductStoreIdentity(snapshot),
      month: '2026-10',
      groups: [{ orderId: '1001', groupId: preparation.groups[0].id }],
      contents: [{ orderId: '1001', entryId: '1', quantity: '3' }],
      count: 1,
      weightBasis: 'carton',
      weight: '9.5',
      len: '40',
      wid: '30',
      ht: '25',
      received: 1,
      loaded: 0,
      revision: 2,
      updatedAt: authoredAt,
    }),
    backup = {
      format: '1688-order-library',
      version: 4,
      exportedAt: '2026-10-23T12:00:00.000Z',
      orders: [record],
      history: [],
      images: [],
      preparations: [preparation],
      allocations: allocation.allocations,
      issuedCodes: allocation.issuedCodes,
      cartonBatches: [batch],
    }
  return { snapshot, record, preparation, batch, backup }
}

function withReducedSource() {
  const value = fixture(),
    previous = structuredClone(value.record)
  value.record.snapshot.items[0].quantity = '1'
  Object.assign(value.record.snapshot.totals, {
    goodsGross: '1.00',
    goodsNet: '1.00',
    payable: '1.00',
  })
  value.record.snapshot.observedAt = '2026-10-22T12:00:00.000Z'
  value.record.revision = 2
  value.record.changedAt = value.record.lastCheckedAt =
    value.record.snapshot.observedAt
  value.backup.history = [previous]
  return value
}

// A transaction-local collection harness exercises repository merge and revision
// rules without substituting another IndexedDB implementation or starting a browser.
function repositoryFixture({ record, preparation, backup }, batches) {
  let state = {
    orders: [structuredClone(record)],
    history: structuredClone(backup?.history || []),
    preparations: [structuredClone(preparation)],
    cartonBatches: structuredClone(batches),
  }
  async function transact(_stores, run) {
    const candidate = structuredClone(state),
      tx = {
        objectStore: (name) => ({
          getAll: () => candidate[name],
          put: (entry) => {
            const at = candidate[name].findIndex(
              (value) => value.id === entry.id
            )
            if (at < 0) candidate[name].push(structuredClone(entry))
            else candidate[name][at] = structuredClone(entry)
          },
        }),
      }
    const result = await run(tx)
    state = candidate
    return result
  }
  const repository = createCartonBatchesRepository({
    read: transact,
    write: transact,
    requested: (request) => Promise.resolve(request),
    nextEditTimestamp: (previous) =>
      new Date(
        Math.max(
          Date.parse(previous || '1970-01-01'),
          Date.parse('2026-10-24T12:00:00Z')
        ) + 1
      ).toISOString(),
  })
  return {
    api: repository.api,
    restore: (incoming) =>
      transact([], (tx) => repository.restore(tx, incoming)),
    apply: (changes, options) =>
      transact([], (tx) => repository.apply(tx, changes, options)),
    values: () => structuredClone(state.cartonBatches),
  }
}

test('v4 carton backup validates actual purchase, store and quantities instead of accepting a review flag', () => {
  const { backup } = fixture()
  assert.equal(validateBackup(backup).cartonBatches.length, 1)
  const invalidStore = structuredClone(backup)
  invalidStore.cartonBatches[0].storeId = '["1688","other-factory"]'
  invalidStore.cartonBatches[0].needsReview = true
  assert.throws(() => validateBackup(invalidStore), /different stores/)
  const invalidQuantity = structuredClone(backup)
  invalidQuantity.cartonBatches[0].contents[0].quantity = '4'
  invalidQuantity.cartonBatches[0].needsReview = true
  assert.throws(() => validateBackup(invalidQuantity), /exceed/)
  const invalidAccount = structuredClone(backup)
  invalidAccount.cartonBatches[0].accountId = 'other-account'
  assert.throws(() => validateBackup(invalidAccount), /source evidence/)
  const missingGroup = structuredClone(backup)
  missingGroup.cartonBatches[0].groups[0].groupId = 'not-a-saved-group'
  assert.throws(() => validateBackup(missingGroup), /no longer prepared/)
})

test('multiple active batches must jointly fit the purchased quantity, including batches in different months', () => {
  const { backup } = fixture()
  backup.cartonBatches[0].contents[0].quantity = '2'
  backup.cartonBatches.push({
    ...structuredClone(backup.cartonBatches[0]),
    id: 'cartons-2',
  })
  assert.throws(() => validateBackup(backup), /exceed/)
  backup.cartonBatches[1].month = '2026-11'
  assert.throws(() => validateBackup(backup), /changed|exceed/)
})

test('a legitimate earlier carton allocation survives reduced current quantities with historical evidence', () => {
  const { backup } = withReducedSource(),
    validated = validateBackup(backup)
  assert.equal(validated.cartonBatches[0].needsReview, true)
  assert.equal(validated.cartonBatches[0].contents[0].quantity, '3')
  assert.equal(validated.cartonBatches[0].count, 1)
  assert.equal(validated.cartonBatches[0].received, 1)
  assert.equal(validated.cartonBatches[0].loaded, 0)
  assert.equal(validated.history[0].snapshot.items[0].quantity, '3')
  const impossible = structuredClone(backup)
  impossible.cartonBatches[0].contents[0].quantity = '4'
  assert.throws(() => validateBackup(impossible), /exceed.*source evidence/)
})

test('v1 remains readable and v2/v3 legacy carton measurements and confirmations migrate exactly once', () => {
  const { backup, record } = fixture()
  record.cartonDetails = { 1: { boxes: '1', kg: '9.5', cbm: '0.077' } }
  record.cartonDetailsUpdatedAt = '2026-10-21T12:00:00.000Z'
  record.cartonConfirmations = { 1: { '2026-10': { received: 1, loaded: 0 } } }
  record.cartonConfirmationClocks = {
    1: { '2026-10': '2026-10-21T12:00:00.000Z' },
  }
  for (const version of [1, 2, 3]) {
    const legacy = { ...structuredClone(backup), version }
    delete legacy.cartonBatches
    const result = validateBackup(legacy)
    assert.equal(result.orders[0].cartonConfirmations['1']['2026-10'].loaded, 0)
    assert.equal(result.cartonBatches.length, version === 1 ? 0 : 1)
    if (version > 1) {
      assert.equal(result.cartonBatches[0].count, 1)
      assert.equal(result.cartonBatches[0].received, 1)
      assert.equal(result.cartonBatches[0].loaded, 0)
      assert.equal(result.cartonBatches[0].suppliedCbm, '0.077')
      assert.equal(
        validateBackup({
          ...legacy,
          version: 4,
          cartonBatches: result.cartonBatches,
        }).cartonBatches.length,
        1
      )
    }
  }
})

test('legacy backups retain derived historical totals but v4 defaults never create physical contents while listing or restoring', async () => {
  const value = fixture()
  value.record.unitsPerCarton = { 1: 3 }
  value.record.cartonDetails = {
    1: { kg: '4.5', len: '40', wid: '30', ht: '25' },
  }
  value.backup.cartonBatches = []
  for (const version of [2, 3]) {
    const legacy = { ...structuredClone(value.backup), version }
    delete legacy.cartonBatches
    const converted = validateBackup(legacy)
    assert.equal(converted.cartonBatches.length, 1)
    assert.equal(converted.cartonBatches[0].count, 1)
    assert.equal(converted.cartonBatches[0].weight, '4.5')
  }
  assert.deepEqual(validateBackup(value.backup).cartonBatches, [])
  const repo = repositoryFixture(value, [])
  assert.deepEqual(await repo.api.listCartonBatches(), [])
  assert.deepEqual(await repo.api.listCartonBatches(), [])
  await repo.restore([])
  assert.deepEqual(repo.values(), [])
  // A batch already saved by a previous release remains physical evidence.
  const existing = repositoryFixture(value, [value.batch])
  assert.deepEqual(await existing.api.listCartonBatches(), [value.batch])
  assert.deepEqual(existing.values(), [value.batch])
})

test('an older backup cannot resurrect a tombstone and an equal-time conflict is atomic', async () => {
  const value = fixture(),
    removed = {
      ...value.batch,
      revision: 3,
      deletedAt: '2026-10-22T12:00:00.000Z',
      updatedAt: '2026-10-22T12:00:00.000Z',
    },
    repo = repositoryFixture(value, [removed])
  await repo.restore([value.batch])
  assert.deepEqual(await repo.api.listCartonBatches(), [])
  assert.deepEqual(repo.values(), [removed])
  await assert.rejects(
    repo.restore([{ ...removed, loaded: 1 }]),
    /same timestamp/
  )
  assert.deepEqual(repo.values(), [removed])
  await assert.rejects(
    repo.api.saveCartonBatch(
      { ...removed, deletedAt: undefined },
      { expectedRevision: removed.revision }
    ),
    /was removed/
  )
  assert.deepEqual(repo.values(), [removed])
})

test('a changed existing restore invalidates a pre-restore editor revision', async () => {
  const value = fixture(),
    repo = repositoryFixture(value, [value.batch])
  await repo.restore([
    {
      ...value.batch,
      loaded: 1,
      revision: 1,
      updatedAt: '2026-10-22T12:00:00.000Z',
    },
  ])
  assert.equal(repo.values()[0].revision, 3)
  await assert.rejects(
    repo.api.saveCartonBatch(
      { ...value.batch, count: 2 },
      { expectedRevision: value.batch.revision }
    ),
    { code: 'CARTON_BATCH_CONFLICT' }
  )
  assert.equal(repo.values()[0].loaded, 1)
})

test('scoped backups retain enough history to restore an older physical allocation reviewably', () => {
  const { backup } = withReducedSource(),
    scoped = createPackingBackup(backup, {
      months: ['2026-10'],
      orders: [{ orderId: '1001', entryIds: ['1'] }],
    })
  const validated = validateBackup(scoped)
  assert.equal(validated.cartonBatches.length, 1)
  assert.equal(validated.cartonBatches[0].needsReview, true)
  assert.equal(validated.cartonBatches[0].contents[0].quantity, '3')
})

test('scoped backups require the independent physical mark context as well as every content item', () => {
  const { backup, snapshot } = fixture()
  snapshot.items.push({
    ...structuredClone(snapshot.items[0]),
    entryId: '2',
    title: 'Second toy',
    description: 'Synthetic second toy',
  })
  Object.assign(snapshot.totals, {
    goodsGross: '6.00',
    goodsNet: '6.00',
    payable: '6.00',
  })
  const allocation = allocatePreparation(
      createPreparation(snapshot, '2026-10'),
      [],
      [],
      { snapshot }
    ),
    preparation = {
      ...allocation.preparation,
      revision: 1,
      updatedAt: backup.preparations[0].updatedAt,
    },
    [markGroup, contentGroup] = preparation.groups,
    batch = validateCartonBatch({
      ...backup.cartonBatches[0],
      cartonNumber: '7',
      mark: { orderId: '1001', groupId: markGroup.id },
      groups: [{ orderId: '1001', groupId: contentGroup.id }],
      contents: [{ orderId: '1001', entryId: '2', quantity: '3' }],
    })
  Object.assign(backup, {
    preparations: [preparation],
    allocations: allocation.allocations,
    issuedCodes: allocation.issuedCodes,
    cartonBatches: [batch],
  })
  assert.equal(validateBackup(backup).cartonBatches[0].cartonNumber, '7')
  const partial = createPackingBackup(backup, {
    months: ['2026-10'],
    orders: [{ orderId: '1001', entryIds: ['2'] }],
  })
  assert.deepEqual(partial.cartonBatches, [])
  assert.deepEqual(partial.omittedCartonBatchIds, [batch.id])
  assert.equal(validateBackup(partial).cartonBatches.length, 0)
  assert.throws(
    () => validateBackup({ ...partial, cartonBatches: [batch] }),
    /partial carton batch/
  )
  const complete = createPackingBackup(backup, {
    months: ['2026-10'],
    orders: [{ orderId: '1001', entryIds: ['1', '2'] }],
  })
  assert.deepEqual(complete.omittedCartonBatchIds, [])
  assert.deepEqual(validateBackup(complete).cartonBatches, [batch])
})

test('restoring a separately valid batch cannot overallocate existing active cartons under another ID', async () => {
  const value = fixture(),
    local = {
      ...value.batch,
      contents: [{ orderId: '1001', entryId: '1', quantity: '2' }],
    },
    incoming = {
      ...value.batch,
      id: 'independent-backup-batch',
      contents: [{ orderId: '1001', entryId: '1', quantity: '2' }],
    },
    repo = repositoryFixture(value, [local])
  assert.equal(
    validateBackup({ ...value.backup, cartonBatches: [incoming] }).cartonBatches
      .length,
    1
  )
  await assert.rejects(repo.restore([incoming]), /exceed|conflict/)
  assert.deepEqual(repo.values(), [local])
})

test('reviewed preparation changes cannot bypass store identity or purchased quantity evidence', async () => {
  const value = fixture(),
    repo = repositoryFixture(value, [value.batch]),
    wrongStore = {
      ...value.batch,
      needsReview: true,
      storeId: '["1688","foreign-factory"]',
    },
    overallocated = {
      ...value.batch,
      needsReview: true,
      contents: [{ orderId: '1001', entryId: '1', quantity: '4' }],
    }
  await assert.rejects(
    repo.apply(
      [{ after: wrongStore, expectedRevision: value.batch.revision }],
      { allowReview: true }
    ),
    /different stores/
  )
  await assert.rejects(
    repo.apply(
      [{ after: overallocated, expectedRevision: value.batch.revision }],
      { allowReview: true }
    ),
    /exceed/
  )
  assert.deepEqual(repo.values(), [value.batch])
})

test('restored legacy tombstone identities prevent reseeding even without retained content or provenance fields', async () => {
  const value = fixture()
  value.record.cartonDetails = { 1: { boxes: '1', kg: '9.5', cbm: '0.077' } }
  value.record.cartonDetailsUpdatedAt = '2026-10-21T12:00:00.000Z'
  const [legacy] = createLegacyCartonBatches(
      [value.record],
      [value.preparation]
    ),
    removed = validateCartonBatch({
      ...legacy,
      contents: [],
      legacyKeys: undefined,
      revision: 3,
      updatedAt: '2026-10-22T12:00:00.000Z',
      deletedAt: '2026-10-22T12:00:00.000Z',
    }),
    repo = repositoryFixture(value, [])
  await repo.restore([removed])
  assert.deepEqual(await repo.api.listCartonBatches(), [])
  assert.deepEqual(repo.values(), [removed])
})

test('scoped history includes only observations required by selected stale cartons', () => {
  const { backup } = withReducedSource(),
    unnecessary = structuredClone(backup.history[0])
  unnecessary.snapshot.observedAt =
    unnecessary.changedAt =
    unnecessary.lastCheckedAt =
      '2026-10-19T12:00:00.000Z'
  backup.history.push(unnecessary)
  const unrelated = structuredClone(unnecessary)
  unrelated.snapshot.orderId = '1002'
  unrelated.snapshot.sourceUrl = unrelated.snapshot.sourceUrl.replace(
    '1001',
    '1002'
  )
  backup.history.push(unrelated)
  const scoped = createPackingBackup(backup, {
    months: ['2026-10'],
    orders: [{ orderId: '1001', entryIds: ['1'] }],
  })
  assert.equal(scoped.history.length, 1)
  assert.equal(scoped.history[0].snapshot.orderId, '1001')
  assert.equal(
    scoped.history[0].snapshot.observedAt,
    '2026-10-20T12:00:00.000Z'
  )
  assert.deepEqual(scoped.history[0].tags, [])
  assert.equal(validateBackup(scoped).cartonBatches[0].needsReview, true)
})

test('legacy seeding cannot allocate purchased pieces again after their preparation month changes', async () => {
  const value = fixture()
  value.record.cartonDetails = { 1: { boxes: '1', kg: '9.5', cbm: '0.077' } }
  value.preparation.groups[0].month = '2026-11'
  const previous = {
      ...value.batch,
      contents: [{ orderId: '1001', entryId: '1', quantity: '2' }],
    },
    repo = repositoryFixture(value, [previous])
  const batches = await repo.api.listCartonBatches()
  assert.equal(batches.length, 1)
  assert.equal(batches[0].id, previous.id)
  assert.equal(batches[0].needsReview, true)
  assert.equal(repo.values().length, 1)
})
