import test from 'node:test'
import assert from 'node:assert/strict'
import {
  activePackingState,
  allocatePreparation,
  barcodeValue,
  codeOwnerEvidence,
  codeReservationMembers,
  createPreparation,
  packingCheckpoint,
  validatePreparation,
  validatePreparationReservations,
} from '../src/packing-model.js'
import {
  assertSharedPreparationEdit,
  assertSharedProductFeatureEdit,
  combineRepeatCartonPacking,
  planSharedProductLink,
  planSharedProductUnlink,
  repeatProductCandidates,
  sharedVariantSources,
  validateSharedProducts,
} from '../src/repeat-products.js'
import { createPackingBackup } from '../src/packing-backup.js'
import { validateBackup } from '../src/database.js'
import { repeatSubsetFixture } from './fixtures/repeat-subset-fixture.mjs'

function fixture(quantities = ['3', '27']) {
  const records = quantities.map((quantity, index) => {
    const price = index ? '10.00' : '12.00'
    const gross = (Number(quantity) * Number(price)).toFixed(2)
    return {
      snapshot: {
        schemaVersion: 1,
        accountId: 'local',
        orderId: String(101 + index),
        sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${101 + index}`,
        sellerName: 'Synthetic repeat supplier',
        sellerMemberLogin: 'synthetic-repeat',
        observedAt: '2026-10-01T00:00:00.000Z',
        status: 'Completed',
        items: [
          {
            entryId: '1',
            title: 'Cup',
            description: 'Red cup',
            thumbnail: '',
            skuProperties: [
              { label: '颜色', value: '红色' },
              { label: '尺寸', value: 'S' },
            ],
            quantity,
            price,
            sourceDiscount: '0.00',
            allocatedDiscount: '0.00',
            discount: '0.00',
          },
        ],
        totals: {
          goodsGross: gross,
          shipping: '0.00',
          sourceDiscount: '0.00',
          orderAdjustment: '0.00',
          goodsNet: gross,
          payable: gross,
        },
      },
      tags: [],
      notes: '',
      revision: 1,
      changedEntryIds: [],
      removedEntryIds: [],
      changedAt: '2026-10-01T00:00:00.000Z',
      lastCheckedAt: '2026-10-01T00:00:00.000Z',
    }
  })
  let allocations = [],
    issuedCodes = []
  const preparations = records.map((record) => {
    const draft = createPreparation(record.snapshot, '2026-10')
    draft.groups[0].spanishName = 'TAZA'
    draft.groups[0].category = '杯子'
    const result = allocatePreparation(draft, allocations, issuedCodes, {
      snapshot: record.snapshot,
    })
    allocations = result.allocations
    issuedCodes = result.issuedCodes
    const prep = { ...result.preparation, revision: 1 }
    prep.defaultPacking = packingCheckpoint(prep)
    return prep
  })
  const ref = (index) => ({
    accountId: 'local',
    orderId: preparations[index].orderId,
    groupId: preparations[index].groups[0].id,
  })
  const plan = () => {
    let next = 0
    return planSharedProductLink({
      source: ref(1),
      target: ref(0),
      preparations,
      records,
      newId: () => `synthetic-shared-${++next}`,
    })
  }
  return { records, preparations, allocations, issuedCodes, ref, plan }
}

test('a reviewed repeat shares the original code and canonical reservation while preserving 3 + 27 source rows and costs', () => {
  const data = fixture()
  const original = structuredClone({
    records: data.records,
    preparations: data.preparations,
  })
  const plan = data.plan()
  assert.equal(plan.changes.length, 2)
  assert.deepEqual(
    new Set(plan.changes.map((change) => change.quantity)),
    new Set(['3', '27'])
  )
  assert.deepEqual(
    new Set(plan.changes.map((change) => change.price)),
    new Set(['10.00', '12.00'])
  )
  assert.ok(plan.changes.every((change) => change.combinedQuantity === '30'))
  assert.ok(
    plan.preparations.every(
      (preparation) =>
        preparation.groups[0].baseCode ===
        data.preparations[0].groups[0].baseCode
    )
  )
  const state = activePackingState(
    plan.preparations,
    data.allocations,
    data.issuedCodes
  )
  assert.equal(state.issuedCodes.length, 2)
  assert.ok(
    state.issuedCodes.every((reservation) => reservation.members.length === 2)
  )
  assert.equal(
    new Set(
      state.issuedCodes.map((entry) =>
        JSON.stringify([entry.accountId, entry.kind, entry.code])
      )
    ).size,
    2
  )
  for (const preparation of plan.preparations)
    validatePreparationReservations(preparation, state)
  const first = plan.preparations[0].groups[0]
  const sources = sharedVariantSources(
    plan.preparations,
    data.records,
    first.sharedProductId,
    first.variants[0].sharedVariantId
  )
  assert.equal(sources.length, 2)
  assert.deepEqual(data.records, original.records)
  assert.deepEqual(data.preparations, original.preparations)
})

test('only complete matching variants from the same known store, account and packing month are candidates', () => {
  const data = fixture()
  assert.equal(
    repeatProductCandidates({ source: data.ref(1), ...data }).length,
    1
  )
  for (const mutate of [
    (value) => {
      value.records[0].snapshot.sellerMemberLogin = ''
    },
    (value) => {
      value.records[0].snapshot.sellerMemberLogin = 'different-store'
    },
    (value) => {
      value.preparations[0].accountId = 'other-account'
      value.records[0].snapshot.accountId = 'other-account'
    },
    (value) => {
      value.preparations[0].groups[0].month = '2026-11'
    },
    (value) => {
      value.records[0].snapshot.items[0].skuProperties.push({
        label: '旋转',
        value: '有',
      })
    },
    (value) => {
      value.preparations[0].groups[0].variants[0].size = 'L'
    },
    (value) => {
      value.preparations[0].groups[0].variants[0].entryIds.push('2')
    },
  ]) {
    const value = {
      records: structuredClone(data.records),
      preparations: structuredClone(data.preparations),
    }
    mutate(value)
    assert.equal(
      repeatProductCandidates({ source: data.ref(1), ...value }).length,
      0
    )
    assert.throws(() =>
      planSharedProductLink({
        source: data.ref(1),
        target: data.ref(0),
        ...value,
      })
    )
  }
})

test('shared ownership rejects unrelated collisions and inconsistent identity/code combinations', () => {
  const data = fixture(['3', '27', '5'])
  const plan = data.plan()
  const third = structuredClone(data.preparations[2])
  third.groups[0].baseCode = plan.preparations[0].groups[0].baseCode
  assert.throws(
    () => activePackingState([...plan.preparations, third]),
    /Code conflict/
  )
  const inconsistent = structuredClone(plan.preparations)
  inconsistent[1].groups[0].baseCode = 'CE26100199'
  assert.throws(
    () => activePackingState(inconsistent),
    /Shared product identity has inconsistent/
  )
  assert.throws(
    () => validateSharedProducts(inconsistent, { orders: data.records }),
    /inconsistent/
  )
  const barcode = structuredClone(plan.preparations)
  barcode[1].groups[0].variants[0].variantSuffix = 'Z'
  assert.throws(
    () => activePackingState(barcode),
    /Shared variant identity has inconsistent/
  )
})

test('shared code aliases resolve owner evidence and survive removal of the primary purchase', () => {
  const data = fixture()
  const plan = data.plan()
  const state = activePackingState(
    plan.preparations,
    data.allocations,
    data.issuedCodes
  )
  const reservation = state.issuedCodes.find(
    (entry) => entry.kind === 'barcode'
  )
  const second = plan.preparations[1]
  assert.equal(
    codeOwnerEvidence(reservation, second, state.issuedCodes).group.id,
    second.groups[0].id
  )
  const captured = allocatePreparation(
    second,
    state.allocations,
    state.issuedCodes,
    { snapshot: data.records[1].snapshot }
  )
  const surviving = activePackingState(
    [second],
    captured.allocations,
    captured.issuedCodes
  )
  assert.ok(
    surviving.issuedCodes.every(
      (entry) => entry.orderId === second.orderId && entry.members.length === 1
    )
  )
  assert.equal(
    surviving.issuedCodes.find((entry) => entry.kind === 'barcode')
      .ownerSnapshot.entryIds[0],
    '1'
  )
})

test('shared code edits, stale reset and grouping require unlink first; removal and material edits remain possible', () => {
  const data = fixture()
  const previous = data.plan().preparations[1]
  for (const mutate of [
    (next) => {
      next.groups[0].baseCode = 'CE26100199'
    },
    (next) => {
      next.groups[0].variants[0].sizeSuffix = 'L'
    },
    (next) => {
      next.groups[0].variants[0].id = 'split-variant'
    },
    (next) => {
      next.groups[0].id = 'new-unlinked-group'
      delete next.groups[0].sharedProductId
      delete next.groups[0].sharedStoreId
      delete next.groups[0].variants[0].sharedVariantId
    },
    (next) => {
      delete next.groups[0].sharedProductId
    },
    (next) => {
      next.groups = structuredClone(data.preparations[1].groups)
    },
  ]) {
    const next = structuredClone(previous)
    mutate(next)
    assert.throws(
      () => assertSharedPreparationEdit(previous, next),
      /Unlink this repeat purchase/
    )
  }
  const removed = { ...previous, groups: [] }
  assert.doesNotThrow(() => assertSharedPreparationEdit(previous, removed))
  const material = structuredClone(previous)
  material.groups[0].variants[0].material = '玻璃'
  assert.doesNotThrow(() => assertSharedPreparationEdit(previous, material))
})

test('unlink releases one alias, allocates a free different code and preserves the surviving original code', () => {
  const data = fixture()
  const linked = data.plan().preparations
  const plan = planSharedProductUnlink({
    source: data.ref(1),
    preparations: linked,
    records: data.records,
  })
  assert.equal(plan.preparations[0].groups[0].baseCode, '')
  assert.equal(plan.preparations[0].groups[0].sharedProductId, undefined)
  const surviving = activePackingState(
    [linked[0]],
    data.allocations,
    data.issuedCodes
  )
  const result = allocatePreparation(
    plan.preparations[0],
    surviving.allocations,
    surviving.issuedCodes
  )
  assert.notEqual(
    result.preparation.groups[0].baseCode,
    linked[0].groups[0].baseCode
  )
  assert.equal(
    result.issuedCodes.filter((entry) => entry.sharedProductId).length,
    2
  )
  assert.ok(
    result.issuedCodes
      .filter((entry) => entry.sharedProductId)
      .every((entry) => entry.members.length === 1)
  )
})

test('a scoped backup carries its selected shared identity without unrelated linked packing membership', () => {
  const data = fixture()
  const linked = data.plan().preparations
  const state = activePackingState(linked, data.allocations, data.issuedCodes)
  const backup = {
    format: '1688-order-library',
    version: 3,
    exportedAt: '2026-10-21T00:00:00.000Z',
    orders: data.records,
    preparations: linked,
    history: [],
    images: [],
    ...state,
  }
  const partial = createPackingBackup(backup, {
    months: ['2026-10'],
    orders: [{ accountId: 'local', orderId: '102', entryIds: ['1'] }],
  })
  assert.equal(partial.orders.length, 1)
  assert.equal(partial.preparations.length, 1)
  assert.equal(
    partial.preparations[0].groups[0].sharedProductId,
    linked[1].groups[0].sharedProductId
  )
  assert.ok(
    partial.issuedCodes.every(
      (entry) => entry.members.length === 1 && entry.orderId === '102'
    )
  )
  assert.doesNotThrow(() => validateBackup(partial))
  const full = structuredClone(backup)
  full.issuedCodes[0].members.pop()
  assert.throws(
    () => validateBackup(full),
    /Shared code reservation|missing issued code|missing its owning base reservation/
  )
  const wrongStore = structuredClone(backup)
  wrongStore.orders[1].snapshot.sellerMemberLogin = 'other-synthetic-store'
  assert.throws(
    () => validateBackup(wrongStore),
    /Shared product identity does not match/
  )
})

test('shared carton totals sum source cartons and preserve partial/unknown source review', () => {
  const exact = (total, entryId) => ({
    rows: [{ entryId, status: 'exact', fullCartons: total }],
    total,
    exact: true,
    requiresReview: false,
  })
  const combined = combineRepeatCartonPacking([
    { orderId: '101', packing: exact(1, '1') },
    { orderId: '102', packing: exact(9, '1') },
  ])
  assert.equal(combined.total, 10)
  assert.equal(combined.exact, true)
  assert.deepEqual(
    combined.rows.map((row) => row.orderId),
    ['101', '102']
  )
  const partial = combineRepeatCartonPacking([
    { orderId: '101', packing: exact(1, '1') },
    { orderId: '102', packing: { ...exact(0, '1'), exact: false } },
  ])
  assert.equal(partial.exact, false)
  assert.equal(partial.requiresReview, true)
})

test('linked physical features cannot diverge through product editing or restored metadata', () => {
  const data = fixture()
  const linked = data.plan().preparations
  const changed = structuredClone(data.records[1])
  changed.productWorkflow = { 1: { features: { lighting: true } } }
  assert.throws(
    () => assertSharedProductFeatureEdit(data.records[1], changed, linked),
    /Unlink this repeat purchase/
  )
  assert.throws(
    () =>
      validateSharedProducts(linked, { orders: [data.records[0], changed] }),
    /matching product features/
  )
  const statusOnly = structuredClone(data.records[1])
  statusOnly.productWorkflow = {
    1: {
      features: { lighting: false, rotation: false },
      missingLabels: { active: true },
    },
  }
  assert.doesNotThrow(() =>
    assertSharedProductFeatureEdit(data.records[1], statusOnly, linked)
  )
  assert.doesNotThrow(() =>
    validateSharedProducts(linked, { orders: [data.records[0], statusOnly] })
  )
  const both = data.records.map((record) => ({
    ...record,
    productWorkflow: { 1: { features: { lighting: true, rotation: true } } },
  }))
  assert.doesNotThrow(() => validateSharedProducts(linked, { orders: both }))
  const preview = planSharedProductLink({
    source: data.ref(1),
    target: data.ref(0),
    preparations: data.preparations,
    records: both,
  })
  assert.ok(
    preview.changes.every(
      (change) =>
        change.features.lighting === true && change.features.rotation === true
    )
  )
  preview.changes[0].features.lighting = false
  assert.equal(both[1].productWorkflow['1'].features.lighting, true)
})

test('repeat identity matches custom feature names independently from local IDs and source-specific prices', () => {
  const data = fixture()
  const originalFeature = {
    name: 'Engraving',
    unitCost: '1.00',
    included: false,
  }
  data.records[0].productWorkflow = {
    1: { features: { sourceFeature: originalFeature } },
  }
  data.records[1].productWorkflow = {
    1: {
      features: {
        repeatFeature: { name: 'engraving', unitCost: '2.50', included: true },
      },
    },
  }
  const plan = data.plan()
  assert.equal(plan.changes.length, 2)
  assert.equal(plan.changes[0].features.repeatFeature.unitCost, '2.50')
  assert.equal(
    plan.expectedSnapshots[0].productFeatures['1'].repeatFeature.unitCost,
    '2.50'
  )
  const priceEdit = structuredClone(data.records[1])
  priceEdit.productWorkflow['1'].features.repeatFeature.unitCost = '3.00'
  priceEdit.productWorkflow['1'].features.repeatFeature.included = false
  assert.doesNotThrow(() =>
    assertSharedProductFeatureEdit(
      data.records[1],
      priceEdit,
      plan.preparations
    )
  )
  assert.doesNotThrow(() =>
    validateSharedProducts(plan.preparations, {
      orders: [data.records[0], priceEdit],
    })
  )
  for (const changed of [
    { features: {} },
    {
      features: {
        repeatFeature: { ...originalFeature, name: 'Different feature' },
      },
    },
    {
      features: {
        ...priceEdit.productWorkflow['1'].features,
        lining: { name: 'Lining', unitCost: '0.00', included: true },
      },
    },
  ]) {
    const next = { ...priceEdit, productWorkflow: { 1: changed } }
    assert.throws(
      () =>
        assertSharedProductFeatureEdit(
          data.records[1],
          next,
          plan.preparations
        ),
      /changing its product features/
    )
    assert.throws(
      () =>
        validateSharedProducts(plan.preparations, {
          orders: [data.records[0], next],
        }),
      /matching product features/
    )
  }
})

test('a single 55cm reorder shares the original S barcode while M/L retain their codes, quantities and reservations', () => {
  const data = repeatSubsetFixture()
  const before = structuredClone({
    records: data.records,
    preparations: data.preparations,
  })
  const candidates = repeatProductCandidates({ source: data.ref(1), ...data })
  assert.equal(candidates.length, 1)
  assert.deepEqual(
    candidates[0].variants.map((variant) => [
      variant.barcode,
      variant.size,
      variant.quantity,
    ]),
    [['CE26101001S', '55cm', '3']]
  )
  const plan = planSharedProductLink({
    source: data.ref(1),
    target: data.ref(0),
    ...data,
  })
  const original = plan.preparations.find((draft) => draft.orderId === '8801')
  const repeated = plan.preparations.find((draft) => draft.orderId === '8805')
  const group = original.groups[0]
  assert.deepEqual(
    group.variants.map((variant) => barcodeValue(group, variant)),
    ['CE26101001S', 'CE26101001M', 'CE26101001L']
  )
  assert.equal(
    barcodeValue(repeated.groups[0], repeated.groups[0].variants[0]),
    'CE26101001S'
  )
  assert.equal(
    new Set(group.variants.map((variant) => variant.sharedVariantId)).size,
    3
  )
  assert.ok(group.variants.every((variant) => variant.sharedVariantId))
  assert.equal(
    repeated.groups[0].variants[0].sharedVariantId,
    group.variants[0].sharedVariantId
  )
  for (const [index, variant] of group.variants.entries()) {
    const { sharedVariantId, ...unchanged } = variant
    assert.deepEqual(
      unchanged,
      before.preparations[0].groups[0].variants[index]
    )
  }
  const state = activePackingState(
    plan.preparations,
    data.allocations,
    data.issuedCodes
  )
  const members = Object.fromEntries(
    state.issuedCodes
      .filter((entry) => entry.kind === 'barcode')
      .map((entry) => [entry.code, codeReservationMembers(entry).length])
  )
  assert.deepEqual(members, { CE26101001S: 2, CE26101001M: 1, CE26101001L: 1 })
  for (const draft of plan.preparations)
    validatePreparationReservations(draft, state)
  validateSharedProducts(plan.preparations, {
    orders: data.records,
    issuedCodes: state.issuedCodes,
  })
  const backup = {
    format: '1688-order-library',
    version: 3,
    exportedAt: '2026-10-21T00:00:00.000Z',
    orders: data.records,
    preparations: plan.preparations,
    history: [],
    images: [],
    ...state,
  }
  assert.doesNotThrow(() => validateBackup(backup))
  const clipped = createPackingBackup(backup, {
    months: ['2026-10'],
    orders: [{ accountId: 'local', orderId: '8805', entryIds: ['1'] }],
  })
  assert.doesNotThrow(() => validateBackup(clipped))
  assert.deepEqual(
    { records: data.records, preparations: data.preparations },
    before
  )
  const unlink = planSharedProductUnlink({
    source: data.ref(1),
    preparations: plan.preparations,
    records: data.records,
  })
  const surviving = activePackingState(
    [original],
    state.allocations,
    state.issuedCodes
  )
  const detached = allocatePreparation(
    unlink.preparations[0],
    surviving.allocations,
    surviving.issuedCodes
  )
  assert.notEqual(detached.preparation.groups[0].baseCode, group.baseCode)
  assert.ok(
    detached.issuedCodes
      .filter((entry) => entry.sharedProductId)
      .every((entry) => codeReservationMembers(entry).length === 1)
  )
  assert.equal(
    sharedVariantSources(
      plan.preparations,
      data.records,
      group.sharedProductId,
      group.variants[0].sharedVariantId
    ).length,
    2
  )
})

test('subset repeat matching stays injective and rejects changed sizes, features and materials', () => {
  for (const mutate of [
    (data) => {
      data.preparations[1].groups[0].variants[0].size = '60cm'
    },
    (data) => {
      data.records[1].productWorkflow = { 1: { features: { lighting: true } } }
    },
    (data) => {
      data.preparations[0].groups[0].variants[0].material = '玻璃'
      data.preparations[1].groups[0].variants[0].material = '塑料'
    },
    (data) => {
      const copy = structuredClone(data.preparations[1].groups[0].variants[0])
      copy.id += '-duplicate'
      data.preparations[1].groups[0].variants.push(copy)
    },
  ]) {
    const data = repeatSubsetFixture()
    mutate(data)
    assert.equal(
      repeatProductCandidates({ source: data.ref(1), ...data }).length,
      0
    )
    assert.throws(
      () =>
        planSharedProductLink({
          source: data.ref(1),
          target: data.ref(0),
          ...data,
        }),
      /matching variants, sizes and features/
    )
  }
})
