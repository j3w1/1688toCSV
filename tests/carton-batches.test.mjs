import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateCartonBatch,
  cartonBatchMetrics,
  cartonBatchScope,
  cartonBatchRemaining,
  assertCartonBatchContext,
  createLegacyCartonBatches,
  mergeCartonBatchRecords,
  batchInPackingScope,
  cartonBatchProjection,
  cartonBatchMark,
  cartonBatchContentGroups,
  cartonProductPacking,
} from '../src/carton-batches.js'

function fixture() {
  const group = {
    id: 'group-1',
    baseCode: 'CE26101001',
    category: '毛绒玩具',
    sharedProductId: 'repeat-1',
    variants: ['S', 'M', 'L'].map((size, index) => ({
      id: `v${index}`,
      variantSuffix: '',
      sizeSuffix: size,
      entryIds: [String(index + 1)],
    })),
  }
  const snapshot = {
    accountId: 'local',
    orderId: '1001',
    sellerMemberLogin: 'supplier',
    sellerName: 'Synthetic supplier',
    sourceType: '1688',
    observedAt: '2026-10-21T12:00:00.000Z',
    items: [3, 30, 30].map((quantity, index) => ({
      entryId: String(index + 1),
      quantity: String(quantity),
      description: `Synthetic ${index + 1}`,
    })),
  }
  const record = { snapshot },
    preparation = {
      accountId: 'local',
      orderId: '1001',
      month: '2026-10',
      updatedAt: snapshot.observedAt,
      groups: [group],
    }
  const batch = validateCartonBatch({
    id: 'batch-1',
    accountId: 'local',
    month: '2026-10',
    storeId: '["1688","supplier"]',
    groups: [{ orderId: '1001', groupId: 'group-1' }],
    contents: snapshot.items.map((item) => ({
      orderId: '1001',
      entryId: item.entryId,
      quantity: item.quantity,
    })),
    count: 6,
    len: '40',
    wid: '30',
    ht: '25',
    weight: '9.5367',
    weightBasis: 'carton',
    received: 6,
    loaded: 0,
  })
  return { records: [record], preparations: [preparation], batch }
}

test('mixed carton quantities do not invent per-carton product contents and physical totals count once', () => {
  const { batch, records, preparations } = fixture()
  assertCartonBatchContext(batch, records, preparations, [batch])
  assert.deepEqual(cartonBatchMetrics(batch), {
    volumePerCarton: '0.03',
    kgPerCarton: '9.5367',
    quantity: '63',
    totalWeight: '57.2202',
    totalVolume: '0.18',
    receivedWeight: '57.2202',
    loadedWeight: '0',
    receivedVolume: '0.18',
    loadedVolume: '0',
  })
  const projected = cartonBatchProjection([batch], records, preparations)
  assert.equal(projected.length, 1)
  assert.deepEqual(
    projected[0].contents.map((item) => item.barcode),
    ['CE26101001S', 'CE26101001M', 'CE26101001L']
  )
  assert.equal(projected[0].unitsPerCarton, undefined)
})

test('six numbered cartons preserve unequal actual contents, weight and native volume without inferred capacity', () => {
  const { batch, records, preparations } = fixture(),
    actual = [
      {
        quantities: [
          ['1', '3'],
          ['2', '10'],
        ],
        dimensions: ['60', '50', '40'],
        weight: '16.75',
      },
      {
        quantities: [['2', '12']],
        dimensions: ['60', '50', '40'],
        weight: '14.62',
      },
      {
        quantities: [
          ['2', '8'],
          ['3', '3'],
        ],
        dimensions: ['50', '43', '36'],
        weight: '10.40',
      },
      {
        quantities: [['3', '9']],
        dimensions: ['48', '37', '27'],
        weight: '5.63',
      },
      {
        quantities: [['3', '9']],
        dimensions: ['48', '37', '27'],
        weight: '5.18',
      },
      {
        quantities: [['3', '9']],
        dimensions: ['48', '37', '27'],
        weight: '4.64',
      },
    ],
    batches = actual.map(({ quantities, dimensions, weight }, index) =>
      validateCartonBatch({
        ...batch,
        id: `exact-${index + 1}`,
        cartonNumber: String(index + 1),
        mark: { orderId: '1001', groupId: 'group-1' },
        contents: quantities.map(([entryId, quantity]) => ({
          orderId: '1001',
          entryId,
          quantity,
        })),
        count: 1,
        received: 1,
        loaded: 1,
        len: dimensions[0],
        wid: dimensions[1],
        ht: dimensions[2],
        weight,
      })
    ),
    metrics = batches.map(cartonBatchMetrics),
    scaled = (value, scale) => {
      const [whole, fraction = ''] = value.split('.')
      assert.ok(fraction.length <= scale)
      return BigInt(whole + fraction.padEnd(scale, '0'))
    },
    sum = (field, scale) =>
      metrics.reduce((total, entry) => total + scaled(entry[field], scale), 0n)
  for (const entry of batches)
    assertCartonBatchContext(entry, records, preparations, batches)
  assert.deepEqual(
    metrics.map((entry) => entry.quantity),
    ['13', '12', '11', '9', '9', '9']
  )
  assert.equal(sum('quantity', 0), 63n)
  assert.equal(
    batches.reduce((total, entry) => total + entry.count, 0),
    6
  )
  assert.equal(sum('totalWeight', 2), 5722n)
  assert.equal(sum('totalVolume', 6), 461256n)
  assert.equal(sum('loadedWeight', 2), 5722n)
  assert.equal(sum('loadedVolume', 6), 461256n)
  const projected = cartonBatchProjection(batches, records, preparations)
  assert.deepEqual(
    projected.map((entry) => entry.cartonNumber),
    ['1', '2', '3', '4', '5', '6']
  )
  for (const [entryId, cartons, shared] of [
    ['1', 1, 1],
    ['2', 3, 2],
    ['3', 4, 1],
  ]) {
    const packing = cartonProductPacking(
      { orderId: '1001', entryId, month: '2026-10' },
      projected
    )
    assert.equal(packing.cartons, cartons)
    assert.equal(packing.sharedCartons, shared)
    assert.equal(packing.uniformCapacity, '')
    assert.equal(packing.needsReview, false)
  }
})

test('a numeric capacity requires uniform known single-carton contents instead of aggregate divisibility', () => {
  const { batch } = fixture(),
    reference = { orderId: '1001', entryId: '2', month: '2026-10' },
    exact = (id, quantity, count = 1) => ({
      ...batch,
      id,
      count,
      contents: [{ orderId: '1001', entryId: '2', quantity }],
    })
  assert.equal(
    cartonProductPacking(reference, [exact('aggregate', '14', 2)])
      .uniformCapacity,
    ''
  )
  assert.equal(
    cartonProductPacking(reference, [exact('one', '14')]).uniformCapacity,
    '14'
  )
  assert.equal(
    cartonProductPacking(reference, [exact('one', '8'), exact('two', '6')])
      .uniformCapacity,
    ''
  )
  assert.equal(
    cartonProductPacking(reference, [exact('one', '8'), exact('two', '8')])
      .uniformCapacity,
    '8'
  )
  assert.equal(
    cartonProductPacking(reference, [
      { ...exact('one', '8'), needsReview: true },
    ]).uniformCapacity,
    ''
  )
  assert.equal(
    cartonProductPacking(reference, [exact('unknown', '8', null)]).cartons,
    ''
  )
  assert.equal(
    cartonProductPacking(reference, [
      { ...exact('removed', '8'), deletedAt: '2026-10-22T12:00:00.000Z' },
    ]).batches.length,
    0
  )
})

test('numbered cartons require one physical carton and keep a trimmed human-readable number', () => {
  const { batch } = fixture(),
    numbered = validateCartonBatch({
      ...batch,
      count: 1,
      cartonNumber: '  箱-一/1  ',
    })
  assert.equal(numbered.cartonNumber, '箱-一/1')
  assert.throws(
    () => validateCartonBatch({ ...batch, cartonNumber: '1' }),
    /exactly one/
  )
  assert.throws(
    () => validateCartonBatch({ ...batch, count: 1, cartonNumber: '1\n2' }),
    /without line breaks/
  )
  assert.throws(
    () =>
      validateCartonBatch({
        ...batch,
        count: 1,
        cartonNumber: '箱'.repeat(41),
      }),
    /40 characters/
  )
  assert.equal(
    validateCartonBatch({ ...batch, cartonNumber: ' ' }).cartonNumber,
    undefined
  )
})

test('the physical mark is independent of actual cross-group contents, including zero pieces of its owner group', () => {
  const { batch, records, preparations } = fixture(),
    [original] = preparations[0].groups
  preparations[0].groups = [
    { ...original, variants: original.variants.slice(0, 1) },
    {
      ...original,
      id: 'group-1005',
      baseCode: 'CE26101005',
      category: '其他玩具',
      variants: original.variants.slice(1),
    },
  ]
  const scope = cartonBatchScope(records, preparations, {
      orderId: '1001',
      groupId: 'group-1',
    }),
    contents = [{ orderId: '1001', entryId: '2', quantity: '30' }],
    crossGroup = validateCartonBatch({
      ...batch,
      mark: { orderId: '1001', groupId: 'group-1' },
      groups: cartonBatchContentGroups(scope, contents),
      contents,
      count: 1,
      cartonNumber: '7',
    })
  assert.deepEqual(crossGroup.groups, [
    { orderId: '1001', groupId: 'group-1005' },
  ])
  assertCartonBatchContext(crossGroup, records, preparations, [crossGroup])
  const [projected] = cartonBatchProjection([crossGroup], records, preparations)
  assert.equal(projected.baseCode, 'CE26101001')
  assert.equal(projected.category, '毛绒玩具')
  assert.equal(projected.contents[0].barcode, 'CE26101005M')
  assert.deepEqual(cartonBatchMark(crossGroup), {
    orderId: '1001',
    groupId: 'group-1',
  })
  assert.throws(
    () =>
      assertCartonBatchContext(
        { ...crossGroup, groups: scope.groups },
        records,
        preparations,
        [crossGroup]
      ),
    /content groups/
  )
  // Earlier records could store the complete eligible scope without an explicit mark.
  assertCartonBatchContext(
    { ...crossGroup, mark: undefined, groups: scope.groups },
    records,
    preparations,
    []
  )
  assert.throws(
    () =>
      cartonBatchContentGroups(scope, [
        { orderId: 'unknown', entryId: '2', quantity: '1' },
      ]),
    /this carton scope/
  )
})

test('a carton scope includes own-purchase code groups and only their explicit foreign counterparts', () => {
  const { records, preparations } = fixture(),
    [original] = preparations[0].groups
  original.variants = original.variants.slice(0, 1)
  preparations[0].groups.push({
    ...structuredClone(original),
    id: 'group-1005',
    baseCode: 'CE26101005',
    sharedProductId: 'repeat-5',
    variants: [
      { id: 'v5', variantSuffix: '', sizeSuffix: 'M', entryIds: ['2'] },
    ],
  })
  const counterpart = (
    orderId,
    {
      accountId = 'local',
      store = 'supplier',
      month = '2026-10',
      linked = true,
    } = {}
  ) => {
    const snapshot = structuredClone(records[0].snapshot),
      preparation = structuredClone(preparations[0])
    Object.assign(snapshot, { orderId, accountId, sellerMemberLogin: store })
    Object.assign(preparation, { orderId, accountId, month })
    preparation.groups[0].id = `linked-1-${orderId}`
    preparation.groups[1].id = `linked-5-${orderId}`
    if (!linked)
      for (const group of preparation.groups) delete group.sharedProductId
    records.push({ snapshot })
    preparations.push(preparation)
  }
  counterpart('1002')
  counterpart('1003', { linked: false })
  counterpart('1004', { month: '2026-11' })
  counterpart('1005', { store: 'other-store' })
  counterpart('1006', { accountId: 'other-account' })
  const scope = cartonBatchScope(records, preparations, {
    orderId: '1001',
    groupId: 'group-1',
  })
  assert.deepEqual(
    scope.groups.map(({ orderId, groupId }) => ({ orderId, groupId })),
    [
      { orderId: '1001', groupId: 'group-1' },
      { orderId: '1001', groupId: 'group-1005' },
      { orderId: '1002', groupId: 'linked-1-1002' },
      { orderId: '1002', groupId: 'linked-5-1002' },
    ]
  )
  assert.deepEqual(scope.initialGroupRefs, [
    { orderId: '1001', groupId: 'group-1' },
    { orderId: '1002', groupId: 'linked-1-1002' },
  ])
  assert.deepEqual(
    new Set(scope.products.map((product) => product.orderId)),
    new Set(['1001', '1002'])
  )
})

test('whole-batch weight is never prorated to partial receipt or loading', () => {
  const { batch } = fixture()
  const result = cartonBatchMetrics({
    ...batch,
    weightBasis: 'batch',
    weight: '57.22',
    received: 3,
    loaded: 2,
  })
  assert.equal(result.totalWeight, '57.22')
  assert.equal(result.kgPerCarton, '')
  assert.equal(result.receivedWeight, '')
  assert.equal(result.loadedWeight, '')
  assert.equal(
    cartonBatchMetrics({
      ...batch,
      weightBasis: 'batch',
      weight: '57.22',
      loaded: 6,
    }).loadedWeight,
    '57.22'
  )
})

test('carton dimensions accept decimal commas and compute before rounding; supplied CBM stays available', () => {
  const { batch } = fixture()
  const parsed = validateCartonBatch({
    ...batch,
    len: '12,25',
    wid: '20.01',
    ht: '33.3',
    suppliedCbm: '0.8',
  })
  assert.equal(parsed.len, '12.25')
  assert.equal(cartonBatchMetrics(parsed).volumePerCarton, '0.00816257925')
  assert.equal(
    cartonBatchMetrics({ ...parsed, len: '', wid: '', ht: '' }).volumePerCarton,
    '0.8'
  )
  assert.throws(() => validateCartonBatch({ ...batch, ht: '' }), /all three/)
  assert.throws(
    () => validateCartonBatch({ ...batch, len: 0 }),
    /greater than zero/
  )
  for (const field of ['count', 'received', 'loaded']) {
    assert.equal(validateCartonBatch({ ...batch, [field]: '' })[field], null)
    assert.equal(validateCartonBatch({ ...batch, [field]: 0 })[field], 0)
    for (const value of [-1, 1.5, '1e2', true])
      assert.throws(() => validateCartonBatch({ ...batch, [field]: value }))
  }
})

test('one source product can be split among carton types but quantities cannot be overallocated', () => {
  const { batch, records, preparations } = fixture()
  const first = {
    ...batch,
    contents: [{ orderId: '1001', entryId: '2', quantity: '20' }],
  }
  const second = {
    ...batch,
    id: 'batch-2',
    contents: [{ orderId: '1001', entryId: '2', quantity: '10' }],
    len: '50',
  }
  assertCartonBatchContext(first, records, preparations, [first, second])
  assertCartonBatchContext(second, records, preparations, [first, second])
  const scope = cartonBatchScope(records, preparations, {
    orderId: '1001',
    groupId: 'group-1',
  })
  assert.equal(
    cartonBatchRemaining(scope, [first, second]).find(
      (item) => item.entryId === '2'
    ).remaining,
    '0'
  )
  assert.throws(
    () =>
      assertCartonBatchContext(
        {
          ...second,
          contents: [{ orderId: '1001', entryId: '2', quantity: '11' }],
        },
        records,
        preparations,
        [first, second]
      ),
    /exceed/
  )
  assert.equal(
    cartonBatchRemaining(scope, [
      { ...first, deletedAt: '2026-10-21T13:00:00.000Z' },
      second,
    ]).find((item) => item.entryId === '2').remaining,
    '20'
  )
})

test('mixed purchases require explicit repeat linking, matching store and matching month', () => {
  const { batch, records, preparations } = fixture()
  records.push({
    snapshot: {
      ...records[0].snapshot,
      orderId: '1002',
      items: [{ entryId: '4', quantity: '27' }],
    },
  })
  preparations.push({
    ...preparations[0],
    orderId: '1002',
    groups: [
      {
        ...preparations[0].groups[0],
        id: 'group-2',
        variants: [
          { id: 'v4', variantSuffix: '', sizeSuffix: 'S', entryIds: ['4'] },
        ],
      },
    ],
  })
  const mixed = {
    ...batch,
    groups: [...batch.groups, { orderId: '1002', groupId: 'group-2' }],
    contents: [
      ...batch.contents,
      { orderId: '1002', entryId: '4', quantity: '27' },
    ],
  }
  assertCartonBatchContext(mixed, records, preparations, [mixed])
  assert.equal(cartonBatchMetrics(mixed).quantity, '90')
  delete preparations[1].groups[0].sharedProductId
  assert.throws(
    () => assertCartonBatchContext(mixed, records, preparations, [mixed]),
    /eligible carton scope|exceed/
  )
  preparations[1].groups[0].sharedProductId = 'repeat-1'
  preparations[1].month = '2026-11'
  assert.throws(() =>
    assertCartonBatchContext(mixed, records, preparations, [mixed])
  )
  preparations[1].month = '2026-10'
  records[1].snapshot.sellerMemberLogin = 'other-store'
  assert.throws(() =>
    assertCartonBatchContext(mixed, records, preparations, [mixed])
  )
})

test('legacy supplier row cartons migrate once, preserve independent month confirmations and tombstones', () => {
  const { records, preparations } = fixture()
  const record = records[0]
  record.snapshot.sourceType = 'spreadsheet'
  record.snapshot.store = { key: 'factory-1' }
  record.snapshot.spreadsheet = { rows: [{ row: 7, boxes: '6', perbox: '63' }] }
  for (const item of record.snapshot.items) {
    item.sourceRow = 7
    item.carton = { boxes: '6', kg: '9.5367', cbm: '0.076876' }
  }
  record.cartonConfirmations = {
    1: { '2026-10': { received: 6, loaded: 0 }, '2026-11': { received: 2 } },
  }
  const migrated = createLegacyCartonBatches(records, preparations)
  assert.equal(migrated.length, 1)
  assert.equal(migrated[0].count, 6)
  assert.equal(migrated[0].received, 6)
  assert.equal(migrated[0].loaded, 0)
  assert.equal(cartonBatchMetrics(migrated[0]).totalVolume, '0.461256')
  assert.equal(cartonBatchMetrics(migrated[0]).quantity, '63')
  const removed = {
    ...migrated[0],
    deletedAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
    revision: 2,
  }
  assert.deepEqual(mergeCartonBatchRecords([removed], migrated), [removed])
  assert.throws(
    () => mergeCartonBatchRecords([removed], [{ ...removed, count: 5 }]),
    /same timestamp/
  )
  assert.equal(
    batchInPackingScope(migrated[0], [
      { orderId: '1001', entryIds: ['1', '2', '3'] },
    ]),
    true
  )
  assert.equal(
    batchInPackingScope(migrated[0], [
      { orderId: '1001', entryIds: ['1', '2'] },
    ]),
    false
  )
})

test('runtime seeding keeps new capacity and measurement defaults as proposals while legacy conversion preserves them', () => {
  const { records, preparations } = fixture(),
    record = records[0]
  record.unitsPerCarton = { 1: 3 }
  record.cartonDetails = { 2: { kg: '5', len: '40', wid: '30', ht: '25' } }
  const original = structuredClone({ records, preparations }),
    historical = createLegacyCartonBatches(records, preparations)
  assert.equal(historical.length, 2)
  assert.equal(historical[0].count, 1)
  assert.equal(historical[1].count, null)
  assert.equal(historical[1].weight, '5')
  assert.deepEqual(
    createLegacyCartonBatches(records, preparations, {
      physicalEvidenceOnly: true,
    }),
    []
  )
  assert.deepEqual({ records, preparations }, original)
})

test('runtime seeding preserves explicit boxes and independent confirmations without inferring planned cartons from capacity', () => {
  const { records, preparations } = fixture(),
    record = records[0]
  record.unitsPerCarton = { 1: 3, 2: 10, 3: 10 }
  record.cartonDetails = { 1: { boxes: '2', kg: '4.5' } }
  record.cartonConfirmations = {
    2: { '2026-10': { received: 2, loaded: 0 } },
    3: { '2026-10': { received: 0 } },
  }
  const batches = createLegacyCartonBatches(records, preparations, {
    physicalEvidenceOnly: true,
  })
  assert.equal(batches.length, 3)
  assert.equal(batches[0].count, 2)
  assert.equal(batches[0].weight, '4.5')
  assert.equal(batches[1].count, null)
  assert.equal(batches[1].received, 2)
  assert.equal(batches[1].loaded, 0)
  assert.equal(batches[2].count, null)
  assert.equal(batches[2].received, 0)
})

test('runtime supplier-row seeding retains actual source box counts and physical totals once', () => {
  const { records, preparations } = sharedLegacyFixture(),
    batches = createLegacyCartonBatches(records, preparations, {
      physicalEvidenceOnly: true,
    })
  assert.equal(batches.length, 1)
  assert.equal(batches[0].count, 6)
  assert.equal(cartonBatchMetrics(batches[0]).totalVolume, '0.462')
  assert.equal(cartonBatchMetrics(batches[0]).totalWeight, '57')
})

function sharedLegacyFixture() {
  const value = fixture(),
    record = value.records[0]
  record.snapshot.sourceType = 'spreadsheet'
  record.snapshot.store = { key: 'factory-legacy' }
  record.snapshot.spreadsheet = { rows: [{ row: 7, boxes: '6' }] }
  for (const item of record.snapshot.items) item.sourceRow = 7
  record.snapshot.items[0].carton = { boxes: '6', kg: '9.5', cbm: '0.077' }
  record.cartonConfirmations = {
    1: { '2026-10': { received: 6, loaded: 0 }, '2026-11': { received: 2 } },
  }
  record.cartonConfirmationClocks = {
    1: {
      '2026-10': '2026-10-22T01:00:00.000Z',
      '2026-11': '2026-11-01T01:00:00.000Z',
    },
  }
  return value
}

test('legacy confirmation ownership follows source row order after preparation variants are reordered', () => {
  const { records, preparations } = sharedLegacyFixture()
  preparations[0].groups[0].variants.reverse()
  const [migrated] = createLegacyCartonBatches(records, preparations)
  assert.equal(migrated.contents[0].entryId, '3')
  assert.equal(migrated.count, 6)
  assert.equal(migrated.received, 6)
  assert.equal(migrated.loaded, 0)
  assert.equal(migrated.weight, '9.5')
  assert.equal(migrated.updatedAt, '2026-10-22T01:00:00.000Z')
})

test('a shared supplier row split between packing months never clones its physical carton count', () => {
  const { records, preparations } = sharedLegacyFixture(),
    preparation = preparations[0],
    group = preparation.groups[0]
  preparation.groups = [
    { ...group, month: '2026-10', variants: group.variants.slice(0, 1) },
    {
      ...group,
      id: 'group-2',
      month: '2026-11',
      variants: group.variants.slice(1),
    },
  ]
  const migrated = createLegacyCartonBatches(records, preparations)
  assert.equal(migrated.length, 2)
  for (const batch of migrated) {
    assert.equal(batch.count, null)
    assert.equal(batch.needsReview, true)
    assert.equal(cartonBatchMetrics(batch).totalVolume, '')
    assert.equal(batch.suppliedCbm, '0.077')
  }
  assert.equal(migrated[0].received, 6)
  assert.equal(migrated[0].loaded, 0)
  assert.equal(migrated[1].received, 2)
  assert.equal(migrated[1].loaded, null)
  assert.equal(migrated[1].updatedAt, '2026-11-01T01:00:00.000Z')
})

test('a changed restored batch advances the local revision beyond both copies', () => {
  const { batch } = fixture(),
    previous = { ...batch, revision: 3, updatedAt: '2026-10-21T12:00:00.000Z' },
    incoming = {
      ...batch,
      revision: 1,
      loaded: 2,
      updatedAt: '2026-10-22T12:00:00.000Z',
    }
  const [restored] = mergeCartonBatchRecords([previous], [incoming])
  assert.equal(restored.revision, 4)
  assert.notEqual(restored.revision, previous.revision)
  assert.equal(restored.loaded, 2)
  assert.equal(
    mergeCartonBatchRecords([previous], [{ ...incoming, revision: 8 }])[0]
      .revision,
    9
  )
  assert.equal(mergeCartonBatchRecords([], [incoming])[0].revision, 1)
  assert.equal(
    mergeCartonBatchRecords([previous], [{ ...previous, revision: 1 }])[0],
    previous
  )
})

test('offset timestamps cannot resurrect a newer tombstone or create a false equal-time conflict', () => {
  const { batch } = fixture(),
    removed = {
      ...batch,
      revision: 2,
      updatedAt: '2026-10-22T00:00:00.000Z',
      deletedAt: '2026-10-22T00:00:00.000Z',
    },
    older = { ...batch, updatedAt: '2026-10-22T07:00:00+08:00' }
  assert.equal(validateCartonBatch(older).updatedAt, '2026-10-21T23:00:00.000Z')
  assert.deepEqual(mergeCartonBatchRecords([removed], [older]), [removed])
  assert.deepEqual(
    mergeCartonBatchRecords(
      [removed],
      [{ ...removed, updatedAt: '2026-10-22T08:00:00+08:00' }]
    ),
    [removed]
  )
})

test('older-month active allocations consume the same purchased pieces until explicitly removed', () => {
  const { batch, records, preparations } = fixture(),
    previous = {
      ...batch,
      contents: [{ orderId: '1001', entryId: '2', quantity: '20' }],
    },
    next = {
      ...batch,
      id: 'new-month-batch',
      month: '2026-11',
      contents: [{ orderId: '1001', entryId: '2', quantity: '10' }],
    }
  preparations[0].month = '2026-11'
  const scope = cartonBatchScope(records, preparations, {
    orderId: '1001',
    groupId: 'group-1',
  })
  assert.equal(
    cartonBatchRemaining(scope, [previous]).find((item) => item.entryId === '2')
      .remaining,
    '10'
  )
  assertCartonBatchContext(next, records, preparations, [previous, next])
  assert.throws(
    () =>
      assertCartonBatchContext(
        {
          ...next,
          contents: [{ orderId: '1001', entryId: '2', quantity: '11' }],
        },
        records,
        preparations,
        [previous, next]
      ),
    /exceed/
  )
  assert.equal(
    cartonBatchRemaining(scope, [
      { ...previous, accountId: 'other-account' },
    ]).find((item) => item.entryId === '2').remaining,
    '30'
  )
  assert.equal(
    cartonBatchRemaining(scope, [
      { ...previous, deletedAt: '2026-10-22T12:00:00.000Z' },
    ]).find((item) => item.entryId === '2').remaining,
    '30'
  )
})
