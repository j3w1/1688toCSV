import test from 'node:test'
import assert from 'node:assert/strict'
import { planCartonBatchChanges } from '../src/carton-batch-changes.js'
import { validateCartonBatch } from '../src/carton-batches.js'

function fixture() {
  const group = {
    id: 'group',
    baseCode: 'CE26101001',
    category: '毛绒玩具',
    variants: ['S', 'M', 'L'].map((size, index) => ({
      id: `v${index}`,
      variantSuffix: '',
      sizeSuffix: size,
      entryIds: [String(index + 1)],
    })),
  }
  const records = [
    {
      snapshot: {
        accountId: 'local',
        orderId: '1001',
        sellerMemberLogin: 'supplier',
        sellerName: 'Synthetic supplier',
        sourceType: '1688',
        items: [3, 30, 30].map((quantity, index) => ({
          entryId: String(index + 1),
          quantity: String(quantity),
        })),
      },
    },
  ]
  const beforePreparations = [
    { accountId: 'local', orderId: '1001', month: '2026-10', groups: [group] },
  ]
  const batch = validateCartonBatch({
    id: 'cartons',
    accountId: 'local',
    storeId: '["1688","supplier"]',
    month: '2026-10',
    groups: [{ orderId: '1001', groupId: 'group' }],
    contents: records[0].snapshot.items.map((item) => ({
      orderId: '1001',
      entryId: item.entryId,
      quantity: item.quantity,
    })),
    count: 6,
    len: '40.125',
    wid: '30',
    ht: '25',
    weightBasis: 'batch',
    weight: '57.2202',
    received: 6,
    loaded: 2,
    revision: 7,
    updatedAt: '2026-10-21T12:00:00.000Z',
    legacyKeys: ['synthetic-original'],
  })
  return {
    batches: [batch],
    records,
    beforePreparations,
    afterPreparations: structuredClone(beforePreparations),
  }
}

test('an intact same-month regroup reanchors physical ownership and keeps exact measurements and confirmations', () => {
  const value = fixture()
  value.afterPreparations[0].groups[0].id = 'new-group'
  const original = structuredClone(value)
  const planned = planCartonBatchChanges(value)
  assert.equal(planned.changes.length, 1)
  assert.equal(planned.changes[0].expectedRevision, 7)
  assert.deepEqual(planned.after.cartons, {
    ...value.batches[0],
    groups: [{ orderId: '1001', groupId: 'new-group' }],
  })
  assert.equal(planned.reviews[0].kind, 'reanchor')
  assert.equal(planned.reviews[0].reason, 'code-groups')
  assert.equal(planned.reviews[0].beforeMarkCode, 'CE26101001')
  assert.equal(planned.reviews[0].afterMarkCode, 'CE26101001')
  assert.deepEqual(value, original)
})

test('regrouping mixed contents within one purchase keeps physical evidence and the surviving carton mark', () => {
  const value = fixture(),
    [group] = value.afterPreparations[0].groups
  value.afterPreparations[0].groups = [
    { ...group, variants: group.variants.slice(0, 1) },
    {
      ...structuredClone(group),
      id: 'second',
      baseCode: 'CE26101002',
      variants: group.variants.slice(1),
    },
  ]
  const planned = planCartonBatchChanges(value)
  assert.equal(planned.changes.length, 1)
  assert.deepEqual(planned.after.cartons, {
    ...value.batches[0],
    groups: [
      { orderId: '1001', groupId: 'group' },
      { orderId: '1001', groupId: 'second' },
    ],
  })
  assert.equal(planned.reviews[0].kind, 'reanchor')
  assert.equal(planned.reviews[0].beforeMarkCode, 'CE26101001')
  assert.equal(planned.reviews[0].afterMarkCode, 'CE26101001')
  assert.deepEqual(planned.reviews[0].afterCodes, ['CE26101001', 'CE26101002'])
  assert.deepEqual(planned.reviews[0].destinationGroups, [
    { orderId: '1001', groupId: 'group' },
    { orderId: '1001', groupId: 'second' },
  ])
})

test('an explicit mark survives split contents while its group contributes zero pieces', () => {
  const value = fixture(),
    [group] = value.afterPreparations[0].groups,
    batch = value.batches[0]
  Object.assign(batch, {
    mark: { orderId: '1001', groupId: 'group' },
    cartonNumber: '箱-7',
    count: 1,
    received: 1,
    loaded: 0,
    contents: batch.contents.slice(1),
  })
  value.afterPreparations[0].groups = [
    { ...group, variants: group.variants.slice(0, 1) },
    {
      ...group,
      id: 'group-1005',
      baseCode: 'CE26101005',
      variants: group.variants.slice(1, 2),
    },
    {
      ...group,
      id: 'group-1006',
      baseCode: 'CE26101006',
      variants: group.variants.slice(2),
    },
  ]
  const planned = planCartonBatchChanges(value)
  assert.equal(planned.reviews[0].kind, 'reanchor')
  assert.deepEqual(planned.after.cartons, {
    ...batch,
    groups: [
      { orderId: '1001', groupId: 'group-1005' },
      { orderId: '1001', groupId: 'group-1006' },
    ],
  })
  assert.equal(planned.reviews[0].beforeMarkCode, 'CE26101001')
  assert.equal(planned.reviews[0].afterMarkCode, 'CE26101001')
  assert.equal(planned.reviews[0].cartonNumber, '箱-7')
  assert.deepEqual(planned.reviews[0].afterCodes, ['CE26101005', 'CE26101006'])
})

test('removing a zero-content explicit mark owner requires review and preserves the exact physical record', () => {
  const value = fixture(),
    group = value.beforePreparations[0].groups[0],
    contentGroup = {
      ...structuredClone(group),
      id: 'content-group',
      baseCode: 'CE26101005',
      variants: group.variants.slice(1),
    },
    batch = value.batches[0]
  group.variants = group.variants.slice(0, 1)
  value.beforePreparations[0].groups.push(contentGroup)
  Object.assign(batch, {
    mark: { orderId: '1001', groupId: 'group' },
    cartonNumber: '7',
    count: 1,
    received: 1,
    loaded: 0,
    groups: [{ orderId: '1001', groupId: 'content-group' }],
    contents: batch.contents.slice(1),
  })
  value.afterPreparations = structuredClone(value.beforePreparations)
  value.afterPreparations[0].groups.shift()
  const planned = planCartonBatchChanges(value)
  assert.equal(planned.reviews[0].kind, 'review')
  assert.equal(planned.reviews[0].reason, 'carton-mark')
  assert.equal(planned.reviews[0].beforeMarkCode, 'CE26101001')
  assert.equal(planned.reviews[0].afterMarkCode, '')
  assert.deepEqual(planned.after.cartons, { ...batch, needsReview: true })
  assert.deepEqual(planned.reviews[0].originalMark, {
    orderId: '1001',
    groupId: 'group',
  })
  assert.deepEqual(planned.reviews[0].destinationMark, {
    orderId: '1001',
    groupId: 'group',
  })
})

test('moving a group to a new month does not copy counts or confirmations into that month', () => {
  const value = fixture()
  value.afterPreparations[0].month = '2026-11'
  const planned = planCartonBatchChanges(value)
  assert.equal(planned.changes.length, 1)
  assert.deepEqual(planned.after.cartons, {
    ...value.batches[0],
    needsReview: true,
  })
  assert.equal(planned.after.cartons.month, '2026-10')
  assert.deepEqual(planned.reviews[0].destinationMonths, ['2026-11'])
  assert.equal(planned.reviews[0].reason, 'packing-month')
})

function linkedFixture() {
  const value = fixture(),
    original = value.beforePreparations[0]
  original.groups[0].sharedProductId = 'shared'
  original.groups[0].sharedStoreId = '["1688","supplier"]'
  const repeated = structuredClone(original)
  repeated.orderId = '1002'
  value.beforePreparations.push(repeated)
  const record = structuredClone(value.records[0])
  record.snapshot.orderId = '1002'
  value.records.push(record)
  value.batches[0].groups.push({ orderId: '1002', groupId: 'group' })
  value.batches[0].contents.push({
    orderId: '1002',
    entryId: '1',
    quantity: '3',
  })
  value.afterPreparations = structuredClone(value.beforePreparations)
  const detached = value.afterPreparations[1].groups[0]
  delete detached.sharedProductId
  delete detached.sharedStoreId
  detached.baseCode = 'CE26101002'
  return value
}

test('unlinking a purchase from shared physical contents preserves one reviewed batch', () => {
  const value = linkedFixture(),
    planned = planCartonBatchChanges(value)
  assert.equal(planned.changes.length, 1)
  assert.equal(planned.reviews[0].reason, 'shared-link')
  assert.deepEqual(planned.after.cartons, {
    ...value.batches[0],
    needsReview: true,
  })
})

test('unlinking content from another purchase cannot silently replace its still-existing physical mark', () => {
  const value = linkedFixture()
  value.batches[0].contents = [{ orderId: '1002', entryId: '1', quantity: '3' }]
  const planned = planCartonBatchChanges(value)
  assert.equal(planned.reviews[0].kind, 'review')
  assert.deepEqual(planned.after.cartons, {
    ...value.batches[0],
    needsReview: true,
  })
  assert.equal(planned.after.cartons.received, 6)
  assert.equal(planned.after.cartons.loaded, 2)
})

test('unrelated edits and pre-existing quantity review issues produce no new reconciliation', () => {
  const value = fixture()
  value.records[0].snapshot.items[0].quantity = '1'
  value.afterPreparations[0].groups[0].spanishName = 'ADORNO'
  assert.deepEqual(planCartonBatchChanges(value), {
    changes: [],
    before: {},
    after: {},
    reviews: [],
  })
  value.batches[0].needsReview = true
  assert.equal(planCartonBatchChanges(value).changes.length, 0)
})

test('pre-existing review batches are reconsidered when their group or month ownership changes', () => {
  const value = fixture()
  value.batches[0].needsReview = true
  value.afterPreparations[0].month = '2026-11'
  const planned = planCartonBatchChanges(value)
  assert.equal(planned.changes.length, 1)
  assert.equal(planned.reviews[0].reason, 'packing-month')
})

test('all newly invalid batches are found, including a kept sibling whose group identity changed', () => {
  const value = fixture()
  const sibling = {
    ...structuredClone(value.batches[0]),
    id: 'kept-sibling',
    contents: [{ orderId: '1001', entryId: '2', quantity: '30' }],
  }
  value.batches[0].contents = [{ orderId: '1001', entryId: '1', quantity: '3' }]
  value.batches.push(sibling)
  value.afterPreparations[0].groups[0].id = 'restored-group'
  const planned = planCartonBatchChanges(value)
  assert.deepEqual(
    planned.changes.map((change) => change.after.id),
    ['cartons', 'kept-sibling']
  )
  assert.ok(planned.reviews.every((review) => review.kind === 'reanchor'))
})

test('missing final preparation products keep exact original contents for explicit review', () => {
  const value = fixture()
  value.afterPreparations[0].groups[0].variants.pop()
  const planned = planCartonBatchChanges(value)
  assert.equal(planned.reviews[0].reason, 'missing-products')
  assert.deepEqual(planned.after.cartons.contents, value.batches[0].contents)
  assert.equal(planned.after.cartons.needsReview, true)
})

test('deleted batches are never reconciled or resurrected', () => {
  const value = fixture()
  value.batches[0].deletedAt = '2026-10-22T00:00:00.000Z'
  value.afterPreparations[0].month = '2026-11'
  assert.deepEqual(planCartonBatchChanges(value), {
    changes: [],
    before: {},
    after: {},
    reviews: [],
  })
})
