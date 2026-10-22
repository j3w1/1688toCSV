import test from 'node:test'
import assert from 'node:assert/strict'
import {
  purchaseMonthForCodes,
  purchaseSupplierForCodes,
  planPurchaseCodeReview,
  assertPurchaseCodeMonths,
  assertConsumedCodeChanges,
  historicalCodeReservations,
  consumptionLocksForManifest,
  assertRepeatCodeEligibility,
} from '../src/purchase-codes.js'
import {
  activePackingState,
  allocatePreparation,
  barcodeValue,
  createPreparation,
} from '../src/packing-model.js'
import {
  planSharedProductLink,
  planSharedProductUnlink,
  repeatProductCandidates,
} from '../src/repeat-products.js'
import { createRepeatProductsRepository } from '../src/repeat-products-repository.js'

function records(months = ['2026-09', '2026-10', '2026-11']) {
  return months.map((month, index) => ({
    snapshot: {
      accountId: 'local',
      orderId: String(101 + index),
      sellerName: 'Synthetic factory',
      sellerMemberLogin: 'factory-id',
      purchasedAt: month ? `${month}-30T23:30:00-05:00` : undefined,
      observedAt: '2026-11-01T12:00:00Z',
      items: [
        {
          entryId: '1',
          title: 'Cup',
          description: 'White cup',
          sourceSize: 'S',
          quantity: String((index + 1) * 10),
          price: `${index + 2}.00`,
          thumbnail: 'synthetic-photo',
        },
      ],
    },
    productWorkflow: {},
    revision: 1,
  }))
}
function state(months) {
  const source = records(months),
    preparations = []
  let packing = { allocations: [], issuedCodes: [] }
  for (const record of source) {
    const result = allocatePreparation(
      createPreparation(
        record.snapshot,
        record.snapshot.purchasedAt.slice(0, 7)
      ),
      packing.allocations,
      packing.issuedCodes,
      { snapshot: record.snapshot }
    )
    packing = result
    preparations.push({ ...result.preparation, revision: 1 })
  }
  return {
    records: source,
    preparations,
    allocations: packing.allocations,
    issuedCodes: packing.issuedCodes,
    locks: [],
  }
}
const ref = (s, index) => ({
  accountId: 'local',
  orderId: s.preparations[index].orderId,
  groupId: s.preparations[index].groups[0].id,
})
function linkedState() {
  const s = state(),
    plan = planSharedProductLink({ source: ref(s, 1), target: ref(s, 0), ...s })
  const changed = new Map(plan.preparations.map((prep) => [prep.orderId, prep]))
  s.preparations = s.preparations.map(
    (prep) => changed.get(prep.orderId) ?? prep
  )
  const packing = activePackingState(
    s.preparations,
    s.allocations,
    s.issuedCodes
  )
  return {
    ...s,
    allocations: packing.allocations,
    issuedCodes: packing.issuedCodes,
  }
}
function manifest(s, { loaded = true, revisionId = 'C/r1' } = {}) {
  const preparation = s.preparations[0],
    group = preparation.groups[0]
  const product = {
    accountId: 'local',
    orderId: preparation.orderId,
    entryId: '1',
    groupId: group.id,
    barcode: barcodeValue(group, group.variants[0]),
    baseCode: group.baseCode,
    quantity: '1',
    preparation,
    record: s.records[0],
  }
  return {
    container: { id: 'C' },
    revisionId,
    revision: 1,
    draft: false,
    status: 'sealed',
    sealedAt: '2026-11-20T12:00:00Z',
    orders: [
      {
        accountId: 'local',
        orderId: preparation.orderId,
        preparation,
        record: s.records[0],
      },
    ],
    products: loaded ? [product] : [],
    cartons: loaded
      ? [
          {
            id: 'unit-1',
            accountId: 'local',
            orderId: preparation.orderId,
            count: 1,
            state: 'loaded',
            markCode: group.baseCode,
          },
        ]
      : [],
    leftBehind: { products: [product], cartons: [], unprepared: [] },
  }
}
const selection = (record) => ({
  orderRefs: [{ accountId: 'local', orderId: record.snapshot.orderId }],
  entryRefs: [
    { accountId: 'local', orderId: record.snapshot.orderId, entryId: '1' },
  ],
})

test('purchase calendar month preserves literal source date across timezone edges and never uses import/device/shipment date', () => {
  for (const date of [
    '2026-09-30T23:30:00-05:00',
    '2026-09-01T00:30:00+14:00',
    '2026-09-30',
    '2026-09-30T23:30:00Z',
  ])
    assert.equal(
      purchaseMonthForCodes({
        snapshot: { purchasedAt: date, observedAt: '2026-11-01T00:00:00Z' },
      }),
      '2026-09'
    )
  for (const invalid of [
    undefined,
    '',
    '09/10/2026',
    '2026-02-30',
    '2025-02-29',
    '2026-13-01',
    '2026-00-01',
    '2026-09-00',
    '2026-09-30junk',
    '2026-09-30T25:00:00Z',
  ])
    assert.equal(
      purchaseMonthForCodes({
        snapshot: { purchasedAt: invalid, observedAt: '2026-10-01T00:00:00Z' },
      }),
      null
    )
  assert.equal(purchaseMonthForCodes({ purchasedAt: '2024-02-29' }), '2024-02')
})

test('manual-confirmed missing-date resolution is explicit, validated and subordinate to original source date', () => {
  const resolution = {
    date: '2026-08-04',
    provenance: 'manual-confirmed',
    updatedAt: '2026-11-01T00:00:00Z',
  }
  assert.equal(
    purchaseMonthForCodes({ snapshot: {}, purchaseDateResolution: resolution }),
    '2026-08'
  )
  assert.equal(
    purchaseMonthForCodes({
      snapshot: { purchasedAt: '2026-09-30T23:00:00Z' },
      purchaseDateResolution: resolution,
    }),
    '2026-09'
  )
  for (const patch of [
    { provenance: 'inferred' },
    { date: '2026-02-30' },
    { date: '2026-08-04T00:00:00Z' },
    { updatedAt: 'bad' },
  ])
    assert.equal(
      purchaseMonthForCodes({
        snapshot: {},
        purchaseDateResolution: { ...resolution, ...patch },
      }),
      null
    )
})

test('review proposes September codes without reserving and emits exact full source-row barcode/photo and revisions', () => {
  const source = records(['2026-09']),
    s = {
      records: source,
      preparations: [],
      allocations: [],
      issuedCodes: [],
      locks: [],
    },
    before = structuredClone(s)
  const review = planPurchaseCodeReview(s, selection(source[0]))
  assert.deepEqual(review.issues, [])
  assert.equal(review.changes[0].baseCode, 'CE26090101')
  assert.equal(review.changes[0].after, 'CE26090101')
  assert.equal(review.changes[0].before, '')
  assert.deepEqual(review.changes[0].photo, source[0].snapshot.items[0])
  assert.equal(review.changes[0].quantity, '10')
  assert.equal(review.changes[0].price, '2.00')
  assert.deepEqual(review.expectedRevisions, [0])
  assert.ok(
    review.plan.expectedSnapshots[0].sourceRevision.includes('purchasedAt')
  )
  assert.equal(
    planPurchaseCodeReview(s, selection(source[0])).changes[0].after,
    review.changes[0].after
  )
  assert.deepEqual(s, before)
  const existing = state(['2026-09'])
  existing.preparations[0].groups[0].variants[0].variantSuffix = 'A'
  existing.preparations[0].groups[0].variants[0].sizeSuffix = 'S'
  assert.equal(
    planPurchaseCodeReview(existing, selection(existing.records[0])).changes[0]
      .after,
    'CE26090101AS'
  )
})

test('missing/ambiguous date, missing supplier, ineligible rows and stale selection yield no effective allocation', () => {
  const source = records([null]),
    s = { records: source, preparations: [], locks: [] }
  let review = planPurchaseCodeReview(s, selection(source[0]))
  assert.equal(review.plan.preparations.length, 0)
  assert.ok(
    review.issues.some((issue) => issue.code === 'PURCHASE_DATE_REQUIRED')
  )
  source[0].snapshot.purchasedAt = '10/11/2026'
  assert.ok(
    planPurchaseCodeReview(s, selection(source[0])).issues.some(
      (issue) => issue.code === 'PURCHASE_DATE_REQUIRED'
    )
  )
  source[0].snapshot.purchasedAt = '2026-09-30'
  source[0].snapshot.sellerMemberLogin = ''
  assert.ok(
    planPurchaseCodeReview(s, selection(source[0])).issues.some(
      (issue) => issue.code === 'SELLER_IDENTITY_REQUIRED'
    )
  )
  source[0].snapshot.sellerMemberLogin = 'factory-id'
  source[0].inventoryDispositions = {
    1: { kind: 'fee', reason: 'Payment row' },
  }
  assert.ok(
    planPurchaseCodeReview(s, selection(source[0])).issues.some(
      (issue) => issue.code === 'PURCHASE_PRODUCT_INELIGIBLE'
    )
  )
  assert.ok(
    planPurchaseCodeReview(s, {
      entryRefs: [{ accountId: 'local', orderId: '101', entryId: 'missing' }],
    }).issues.some((issue) => issue.code === 'PURCHASE_SOURCE_CHANGED')
  )
})

test('existing legacy codes survive missing dates, carryover and unrelated new purchase month without regeneration', () => {
  const s = state(['2026-09'])
  s.records[0].snapshot.purchasedAt = undefined
  const old = structuredClone(s.preparations[0])
  const review = planPurchaseCodeReview(s, selection(s.records[0]))
  assert.deepEqual(review.issues, [])
  assert.equal(review.changes[0].before, review.changes[0].after)
  assert.equal(
    review.plan.preparations[0].groups[0].baseCode,
    old.groups[0].baseCode
  )
  assertPurchaseCodeMonths({
    records: s.records,
    previous: s.preparations,
    preparations: review.plan.preparations,
  })
  assert.deepEqual(s.preparations[0], old)
})

test('new identity month validation rejects shipment month while valid original month and legacy ownership pass', () => {
  const source = records(['2026-09'])
  const wrong = allocatePreparation(
    createPreparation(source[0].snapshot, '2026-11'),
    [],
    []
  ).preparation
  assert.throws(
    () => assertPurchaseCodeMonths({ records: source, preparations: [wrong] }),
    /original purchase calendar month/
  )
  const right = allocatePreparation(
    createPreparation(source[0].snapshot, '2026-09'),
    [],
    []
  ).preparation
  assert.doesNotThrow(() =>
    assertPurchaseCodeMonths({ records: source, preparations: [right] })
  )
  assert.doesNotThrow(() =>
    assertPurchaseCodeMonths({
      records: source,
      previous: [wrong],
      preparations: [wrong],
    })
  )
})

test('cross-month unconsumed repeat links keep target prefix and distinct quantities/prices then unlink into own purchase month', () => {
  const s = state(),
    before = structuredClone(s.records)
  assert.equal(repeatProductCandidates({ source: ref(s, 1), ...s }).length, 2)
  const plan = planSharedProductLink({
    source: ref(s, 1),
    target: ref(s, 0),
    ...s,
  })
  assert.ok(
    plan.preparations.every((prep) => prep.groups[0].baseCode === 'CE26090101')
  )
  assert.equal(
    plan.preparations.find((prep) => prep.orderId === '102').month,
    '2026-10'
  )
  assert.equal(
    plan.preparations.find((prep) => prep.orderId === '102').groups[0].month,
    '2026-09'
  )
  assert.deepEqual(plan.changes.map((row) => row.price).sort(), [
    '2.00',
    '3.00',
  ])
  assert.deepEqual(s.records, before)
  assert.doesNotThrow(() =>
    assertPurchaseCodeMonths({
      records: s.records,
      previous: s.preparations,
      preparations: plan.preparations,
    })
  )
  const final = { ...s, preparations: plan.preparations }
  const unlink = planSharedProductUnlink({ source: ref(final, 1), ...final })
  assert.equal(unlink.preparations[0].groups[0].month, '2026-10')
  assert.equal(unlink.preparations[0].groups[0].baseCode, '')
})

test('draft and zero-loaded seals do not consume; zero seals retain referenced history without freezing eligible linking', () => {
  const s = state()
  assert.deepEqual(
    consumptionLocksForManifest(
      { ...manifest(s), draft: true, status: 'draft' },
      s
    ),
    []
  )
  const locks = consumptionLocksForManifest(manifest(s, { loaded: false }), s)
  assert.ok(
    locks.length > 0 && locks.every((lock) => lock.kind === 'code-history')
  )
  assert.equal(historicalCodeReservations(locks).length, 2)
  assert.doesNotThrow(() =>
    planSharedProductLink({ source: ref(s, 1), target: ref(s, 0), ...s, locks })
  )
  const plan = planSharedProductLink({
    source: ref(s, 1),
    target: ref(s, 0),
    ...s,
    locks,
  })
  const shared = activePackingState(
    plan.preparations,
    s.allocations,
    s.issuedCodes,
    { historicalReservations: historicalCodeReservations(locks) }
  )
  assert.ok(
    shared.issuedCodes.find(
      (code) => code.code === 'CE26090101' && code.kind === 'base'
    ).members.length === 2
  )
})

test('positive seal permanently freezes unshipped aliases and all prepared groups, not just loaded product rows', () => {
  const s = linkedState()
  const extra = createPreparation(
    {
      ...s.records[0].snapshot,
      items: [
        { ...s.records[0].snapshot.items[0], entryId: '2', title: 'Plate' },
      ],
    },
    '2026-09'
  ).groups[0]
  extra.baseCode = 'CE26090109'
  extra.month = '2026-09'
  s.preparations[0].groups.push(extra)
  const locks = consumptionLocksForManifest(manifest(s), s),
    consumed = locks.find((lock) => lock.kind === 'code-consumption')
  assert.equal(consumed.lineages.length, 2)
  assert.ok(
    consumed.lineages.some((lineage) =>
      lineage.members.some((member) => member.orderId === '102')
    )
  )
  assert.throws(
    () =>
      planSharedProductLink({
        source: ref(s, 2),
        target: ref(s, 1),
        ...s,
        locks,
      }),
    /consumed code lineage/
  )
  assert.throws(
    () => planSharedProductUnlink({ source: ref(s, 1), ...s, locks }),
    /consumed code lineage/
  )
  assert.equal(
    repeatProductCandidates({ source: ref(s, 2), ...s, locks }).length,
    0
  )
  assert.doesNotThrow(() =>
    assertConsumedCodeChanges({
      previous: s.preparations,
      preparations: s.preparations,
      locks,
    })
  )
})

test('amendments/retries preserve first consumption and history after all loading is released', () => {
  const s = linkedState(),
    initial = consumptionLocksForManifest(manifest(s), s)
  const corrected = {
    ...manifest(s, { loaded: false, revisionId: 'C/r2' }),
    sealedAt: '2026-12-01T00:00:00Z',
  }
  const after = consumptionLocksForManifest(corrected, { ...s, locks: initial })
  const lock = after.find((value) => value.kind === 'code-consumption')
  assert.equal(lock.firstRevisionId, 'C/r1')
  assert.equal(lock.consumedAt, '2026-11-20T12:00:00Z')
  assert.deepEqual(
    consumptionLocksForManifest(corrected, { ...s, locks: after }),
    after
  )
  assert.throws(
    () =>
      assertRepeatCodeEligibility({
        references: [ref(s, 1)],
        preparations: s.preparations,
        locks: after,
      }),
    /consumed/
  )
})

test('consumed code changes reject membership/variant edits; amendment-only code correction never opens lineage to new orders', () => {
  const s = linkedState(),
    locks = consumptionLocksForManifest(manifest(s), s)
  const edited = structuredClone(s.preparations[0])
  edited.groups[0].baseCode = 'CE26090108'
  assert.throws(
    () =>
      assertConsumedCodeChanges({
        previous: s.preparations,
        preparations: [edited],
        locks,
      }),
    /consumed code lineage/
  )
  assert.doesNotThrow(() =>
    assertConsumedCodeChanges({
      previous: s.preparations,
      preparations: [edited],
      locks,
      amendment: true,
    })
  )
  const newMember = structuredClone(s.preparations[2])
  newMember.groups[0] = {
    ...structuredClone(s.preparations[1].groups[0]),
    id: newMember.groups[0].id,
  }
  assert.throws(
    () =>
      assertConsumedCodeChanges({
        previous: s.preparations,
        preparations: [newMember],
        locks,
        amendment: true,
      }),
    /cannot admit new links/
  )
  const mutated = structuredClone(s.preparations[0])
  mutated.groups[0].variants[0].entryIds = ['different']
  assert.throws(
    () =>
      assertConsumedCodeChanges({
        previous: s.preparations,
        preparations: [mutated],
        locks,
        amendment: true,
      }),
    /cannot admit new links/
  )
})

test('referenced historical codes cannot be recycled for unrelated later purchases; inactive checkpoint namespace is ignored', () => {
  const s = state(['2026-09']),
    locks = consumptionLocksForManifest(manifest(s, { loaded: false }), s)
  const later = records(['2026-09'])[0]
  later.snapshot.orderId = '999'
  const review = planPurchaseCodeReview(
    { records: [later], preparations: [], locks },
    selection(later)
  )
  assert.deepEqual(review.issues, [])
  assert.equal(review.changes[0].baseCode, 'CE26090102')
  const ordinary = planPurchaseCodeReview(
    {
      records: [later],
      preparations: [],
      locks: [{ kind: 'checkpoint', lineages: locks[0].lineages }],
    },
    selection(later)
  )
  assert.equal(ordinary.changes[0].baseCode, 'CE26090101')
  const original = planPurchaseCodeReview(
    { ...s, locks },
    selection(s.records[0])
  )
  assert.equal(original.changes[0].baseCode, 'CE26090101')
})

test('historical barcode reservations cover actual referenced variants and accumulate across sealed revisions', () => {
  const s = state(['2026-09']),
    group = s.preparations[0].groups[0]
  group.variants.push({
    ...structuredClone(group.variants[0]),
    id: 'second',
    entryIds: ['2'],
    variantSuffix: 'B',
  })
  const first = consumptionLocksForManifest(manifest(s, { loaded: false }), s)
  assert.equal(
    historicalCodeReservations(first).filter((code) => code.kind === 'barcode')
      .length,
    1
  )
  const next = manifest(s, { loaded: false, revisionId: 'C/r2' })
  next.leftBehind.products[0].barcode = barcodeValue(group, group.variants[1])
  const all = consumptionLocksForManifest(next, { ...s, locks: first })
  assert.equal(
    historicalCodeReservations(all).filter((code) => code.kind === 'barcode')
      .length,
    2
  )
})

test('repeat repository checks current locks and exact source revisions again before final save', async () => {
  const s = state(),
    stored = {
      orders: s.records,
      preparations: s.preparations,
      cartonBatches: [],
      shipmentLocks: [],
    }
  let saves = 0
  const repository = createRepeatProductsRepository({
    read: async (stores, callback) => {
      assert.ok(stores.includes('shipmentLocks'))
      return callback({
        objectStore: (name) => ({
          getAll: () => structuredClone(stored[name]),
        }),
      })
    },
    requested: async (value) => value,
    savePreparations: async (values) => {
      saves++
      return values
    },
  })
  const plan = await repository.previewRepeatProductLink({
    source: ref(s, 1),
    target: ref(s, 0),
  })
  const previewSaves = saves
  stored.orders[0].snapshot.items[0].price = '99.99'
  await assert.rejects(
    () => repository.linkRepeatProduct(plan),
    /source order or preparation changed/
  )
  assert.equal(saves, previewSaves)
  stored.orders[0].snapshot.items[0].price = '2.00'
  stored.shipmentLocks = consumptionLocksForManifest(manifest(s), s)
  await assert.rejects(() => repository.linkRepeatProduct(plan), /consumed/)
  assert.equal(saves, previewSaves)
})

test('reviewed supplier resolution fills missing identity with provenance, preserves source and reveals source disagreement', () => {
  const source = records(['2026-09'])[0]
  delete source.snapshot.sellerMemberLogin
  source.snapshot.sellerUnavailable = true
  const original = structuredClone(source.snapshot)
  assert.equal(purchaseSupplierForCodes(source).sellerId, null)
  source.supplierIdentityResolution = {
    sellerId: 'factory-id',
    provenance: 'manual-confirmed',
    updatedAt: '2026-11-01T00:00:00Z',
    reason: 'Reviewed supplier evidence',
  }
  const resolved = purchaseSupplierForCodes(source)
  assert.equal(resolved.sellerId, 'factory-id')
  assert.equal(resolved.storeId, JSON.stringify(['1688', 'factory-id']))
  assert.equal(resolved.provenance, 'manual-confirmed')
  const review = planPurchaseCodeReview(
    { records: [source], preparations: [] },
    selection(source)
  )
  assert.deepEqual(review.issues, [])
  assert.equal(review.plan.preparations[0].sellerId, 'factory-id')
  assert.equal(
    review.changes[0].supplierIdentity.provenance,
    'manual-confirmed'
  )
  assert.deepEqual(source.snapshot, original)
  source.snapshot.sellerUnavailable = false
  source.snapshot.sellerMemberLogin = 'actual-source-seller'
  assert.equal(
    purchaseSupplierForCodes(source).sellerId,
    'actual-source-seller'
  )
  assert.equal(purchaseSupplierForCodes(source).provenance, 'source')
  assert.equal(purchaseSupplierForCodes(source).conflict, true)
  assert.ok(
    planPurchaseCodeReview(
      { records: [source], preparations: [] },
      selection(source)
    ).issues.some((issue) => issue.code === 'SUPPLIER_IDENTITY_CONFLICT')
  )
})

test('resolved same-store source can link without source mutation while display-name equality alone cannot', () => {
  const source = records(['2026-09', '2026-10'])
  delete source[1].snapshot.sellerMemberLogin
  source[1].snapshot.sellerUnavailable = true
  const noResolution = planPurchaseCodeReview(
    { records: source, preparations: [] },
    {
      orderRefs: source.map((record) => ({
        accountId: 'local',
        orderId: record.snapshot.orderId,
      })),
    }
  )
  assert.ok(
    noResolution.issues.some(
      (issue) => issue.code === 'SELLER_IDENTITY_REQUIRED'
    )
  )
  source[1].supplierIdentityResolution = {
    sellerId: 'factory-id',
    provenance: 'manual-confirmed',
    updatedAt: '2026-11-01T00:00:00Z',
  }
  const review = planPurchaseCodeReview(
    { records: source, preparations: [] },
    {
      orderRefs: source.map((record) => ({
        accountId: 'local',
        orderId: record.snapshot.orderId,
      })),
    }
  )
  assert.deepEqual(review.issues, [])
  const s = { records: source, preparations: review.plan.preparations }
  assert.doesNotThrow(() =>
    planSharedProductLink({ source: ref(s, 1), target: ref(s, 0), ...s })
  )
  source[1].supplierIdentityResolution.sellerId = 'different-reviewed-id'
  assert.equal(repeatProductCandidates({ source: ref(s, 1), ...s }).length, 0)
})

test('partial purchase review preserves unselected old identities and adds only selected new source rows', () => {
  const s = state(['2026-09']),
    existing = structuredClone(s.preparations[0].groups[0])
  s.records[0].snapshot.items.push(
    { ...s.records[0].snapshot.items[0], entryId: '2', title: 'Plate' },
    { ...s.records[0].snapshot.items[0], entryId: '3', title: 'Fork' }
  )
  const review = planPurchaseCodeReview(s, {
    orderRefs: [{ accountId: 'local', orderId: '101' }],
    entryRefs: [{ accountId: 'local', orderId: '101', entryId: '2' }],
  })
  assert.deepEqual(review.issues, [])
  assert.deepEqual(
    review.changes.map((row) => row.entryId),
    ['2']
  )
  assert.deepEqual(
    review.plan.preparations[0].groups.find(
      (group) => group.id === existing.id
    ),
    existing
  )
  assert.ok(
    review.plan.preparations[0].groups.some((group) =>
      group.variants.some((variant) => variant.entryIds.includes('2'))
    )
  )
  assert.ok(
    !review.plan.preparations[0].groups.some((group) =>
      group.variants.some((variant) => variant.entryIds.includes('3'))
    )
  )
})

test('positive order consumption exists without prepared codes and an unchanged unresolved group remains valid evidence', () => {
  const blank = consumptionLocksForManifest(
    {
      container: { id: 'C' },
      revisionId: 'C/r1',
      sealedAt: '2026-11-20T12:00:00Z',
      draft: false,
      status: 'sealed',
      cartons: [
        {
          id: 'unit',
          orderId: '101',
          accountId: 'local',
          count: 1,
          state: 'loaded',
        },
      ],
      products: [],
      leftBehind: { products: [] },
    },
    { preparations: [] }
  )
  assert.equal(blank.length, 1)
  assert.equal(blank[0].kind, 'code-consumption')
  assert.deepEqual(blank[0].lineages, [])
  const s = state()
  assert.throws(
    () =>
      assertRepeatCodeEligibility({
        references: [ref(s, 0)],
        preparations: s.preparations,
        locks: blank,
      }),
    /consumed/
  )
  const unknown = structuredClone(s.preparations[0].groups[0])
  unknown.id = 'unresolved'
  unknown.baseCode = 'CE26090109'
  unknown.variants[0].id = 'unresolved-variant'
  unknown.variants[0].entryIds = ['2']
  unknown.variants[0].needsSizeMapping = true
  s.preparations[0].groups.push(unknown)
  s.records[0].snapshot.items.push({
    ...s.records[0].snapshot.items[0],
    entryId: '2',
  })
  const locks = consumptionLocksForManifest(manifest(s), s)
  assert.doesNotThrow(() =>
    assertConsumedCodeChanges({
      previous: s.preparations,
      preparations: s.preparations,
      locks,
    })
  )
})

test('supplier resolution drift is rejected by repeat wrapper even before its source observation changes', async () => {
  const s = state(),
    stored = {
      orders: s.records,
      preparations: s.preparations,
      cartonBatches: [],
      shipmentLocks: [],
    }
  let saved = 0
  const repository = createRepeatProductsRepository({
    read: async (stores, callback) =>
      callback({
        objectStore: (name) => ({
          getAll: () => structuredClone(stored[name]),
        }),
      }),
    requested: async (value) => value,
    savePreparations: async (values) => {
      saved++
      return values
    },
  })
  const plan = await repository.previewRepeatProductLink({
    source: ref(s, 1),
    target: ref(s, 0),
  })
  stored.orders[1].supplierIdentityResolution = {
    sellerId: 'wrong',
    provenance: 'manual-confirmed',
    updatedAt: '2026-11-01T00:00:00Z',
  }
  const count = saved
  await assert.rejects(
    () => repository.linkRepeatProduct(plan),
    /source order or preparation changed/
  )
  assert.equal(saved, count)
})

test('calendar property: all source months in the supported century ignore offset-induced neighbouring UTC days', () => {
  let count = 0
  for (let year = 2000; year <= 2099; year++)
    for (let month = 1; month <= 12; month++) {
      const m = String(month).padStart(2, '0'),
        last = new Date(Date.UTC(year, month, 0)).getUTCDate()
      for (const [day, time] of [
        [1, '00:01:00+14:00'],
        [last, '23:59:00-12:00'],
      ]) {
        assert.equal(
          purchaseMonthForCodes({
            purchasedAt: `${year}-${m}-${String(day).padStart(2, '0')}T${time}`,
          }),
          `${year}-${m}`
        )
        count++
      }
    }
  assert.equal(count, 2400)
})

test('unreviewed legacy display-owner/canonical supplier mismatch holds linking and preserves codes, owner and history', () => {
  const s = state()
  s.preparations[0].sellerId = 'Legacy displayed owner'
  for (const allocation of s.allocations.filter(
    (value) => value.month === '2026-09'
  ))
    for (const group of allocation.groups)
      group.sellerId = 'Legacy displayed owner'
  for (const reservation of s.issuedCodes.filter(
    (value) => value.month === '2026-09'
  ))
    reservation.sellerId = 'Legacy displayed owner'
  const locks = consumptionLocksForManifest(manifest(s, { loaded: false }), s)
  const original = structuredClone({ ...s, locks })
  const review = planPurchaseCodeReview(
    { ...s, locks },
    selection(s.records[0])
  )
  assert.ok(
    review.issues.some(
      (issue) => issue.code === 'LEGACY_SUPPLIER_IDENTITY_REVIEW_REQUIRED'
    )
  )
  assert.equal(review.plan.preparations.length, 0)
  assert.throws(
    () =>
      planSharedProductLink({
        source: ref(s, 1),
        target: ref(s, 0),
        ...s,
        locks,
      }),
    /legacy supplier code identity/
  )
  assert.equal(
    repeatProductCandidates({ source: ref(s, 1), ...s, locks }).some(
      (candidate) => candidate.orderId === '101'
    ),
    false
  )
  assert.equal(s.preparations[0].groups[0].baseCode, 'CE26090101')
  assert.equal(
    s.issuedCodes.find(
      (value) => value.code === 'CE26090101' && value.kind === 'base'
    ).sellerId,
    'Legacy displayed owner'
  )
  assert.deepEqual({ ...s, locks }, original)
})
