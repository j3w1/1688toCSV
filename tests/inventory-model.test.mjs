import {
  validateCartonBatch,
  assertCartonBatchContext,
} from '../src/carton-batches.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  projectBacklog,
  physicalUnits,
  physicalUnitId,
  unresolvedCoverageFeasible,
  assertOrderCartonConservation,
  committedCartonOwners,
  reservedOrderOwners,
  decimalTotal,
} from '../src/inventory-model.js'
import {
  syntheticOrder,
  syntheticBatch,
} from './fixtures/container-fixture.mjs'

test('confirmed inherited dimensions outrank unit supplied CBM while explicit unit dimensions win and unknown combined facts stay unknown', () => {
  const batch = syntheticBatch('1001', 2, '100', {
    packingBasis: 'aggregate',
    len: '50',
    wid: '50',
    ht: '50',
    unitMeasurements: { 1: { suppliedCbm: '0.3' } },
  })
  const original = structuredClone(batch)
  assert.deepEqual(
    physicalUnits(batch).map((unit) => unit.volume),
    ['0.125', '0.125']
  )
  batch.unitMeasurements[1] = {
    suppliedCbm: '0.3',
    len: '60',
    wid: '50',
    ht: '100',
  }
  assert.deepEqual(
    physicalUnits(batch).map((unit) => unit.volume),
    ['0.125', '0.3']
  )
  batch.unitMeasurements[1] = { len: '', wid: '', ht: '', suppliedCbm: '0.3' }
  assert.deepEqual(
    physicalUnits(batch).map((unit) => unit.volume),
    ['0.125', '0.3']
  )
  Object.assign(batch, {
    len: '',
    wid: '',
    ht: '',
    suppliedCbm: '0.6',
    volumeBasis: 'batch',
  })
  assert.deepEqual(
    physicalUnits(batch).map((unit) => unit.volume),
    [null, '0.3']
  )
  assert.deepEqual(original.unitMeasurements, { 1: { suppliedCbm: '0.3' } })
})

test('global Backlog includes untouched/new orders, excludes only effective shipments and keeps left-behind history separate', () => {
  const records = [
    syntheticOrder('1001', '27'),
    syntheticOrder('1002', '6'),
    syntheticOrder('1003', '10'),
  ]
  const batches = [
    syntheticBatch('1001', 27, '27'),
    syntheticBatch('1002', 6, '6'),
    syntheticBatch('1003', 10, '10'),
  ]
  const state = { records, batches, containers: [] }
  assert.equal(projectBacklog(state).totals.cartons, 43)
  const manifest = {
    revisionId: 'container-one/r1',
    revision: 1,
    cartons: [
      ...physicalUnits(batches[0]).slice(0, 26),
      ...physicalUnits(batches[1]).slice(0, 3),
    ],
    products: [
      { accountId: 'local', orderId: '1001', entryId: '2001', quantity: '26' },
      { accountId: 'local', orderId: '1002', entryId: '2001', quantity: '3' },
    ],
    leftBehind: { cartons: 4 },
  }
  state.containers.push({
    id: 'container-one',
    name: 'Synthetic shipment',
    status: 'sealed',
    effectiveRevisionId: manifest.revisionId,
    revisions: [manifest],
  })
  const after = projectBacklog(state)
  assert.equal(after.totals.cartons, 14)
  assert.deepEqual(
    after.orders.map(({ orderId }) => orderId),
    ['1001', '1002', '1003']
  )
  assert.deepEqual(
    after.orders.map(({ remainingQuantity }) => remainingQuantity),
    ['1', '3', '10']
  )
  records.push(syntheticOrder('1004', '6'))
  batches.push(syntheticBatch('1004', 6, '6'))
  records.push(syntheticOrder('1005', '120'))
  const fresh = projectBacklog(state)
  assert.equal(fresh.totals.cartons, 20)
  assert.equal(
    fresh.orders.find(({ orderId }) => orderId === '1005').cartons,
    null
  )
  assert.equal(
    fresh.orders.find(({ orderId }) => orderId === '1005').remainingQuantity,
    '120'
  )
  assert.deepEqual(manifest.leftBehind, { cartons: 4 })
})

test('draft reservations remain visible and never consume quantities; duplicate order reservations reject', () => {
  const record = syntheticOrder(),
    batch = syntheticBatch()
  const container = {
    id: 'draft-a',
    name: 'Draft A',
    status: 'draft',
    draft: { orders: [{ accountId: 'local', orderId: '1001' }] },
  }
  const state = { records: [record], batches: [batch], containers: [container] }
  assert.equal(projectBacklog(state).orders[0].remainingQuantity, '100')
  assert.equal(
    projectBacklog(state).orders[0].reservation.containerId,
    'draft-a'
  )
  assert.throws(
    () => reservedOrderOwners([container, { ...container, id: 'draft-b' }]),
    { code: 'DOUBLE_RESERVATION' }
  )
})

test('physical identity is independent of supplier number, shared codes and display rows; aggregate contents are not divided', () => {
  const first = syntheticBatch('1001', 1, '100', { cartonNumber: '001' })
  const second = syntheticBatch('1002', 1, '100', { cartonNumber: '001' })
  assert.notEqual(physicalUnits(first)[0].id, physicalUnits(second)[0].id)
  assert.equal(physicalUnits(first)[0].reference, '001')
  const aggregate = syntheticBatch('1001', 6, '63', {
    packingBasis: 'aggregate',
    weightBasis: 'batch',
    weight: '57.22',
    volumeBasis: 'batch',
    suppliedCbm: '0.461256',
  })
  const units = physicalUnits(aggregate)
  assert.equal(units.length, 6)
  assert.ok(
    units.every(
      (unit) =>
        unit.contents === null && unit.weight === null && unit.volume === null
    )
  )
  assert.equal(physicalUnits(first)[0].contents[0].quantity, '100')
})

test('unresolved coverage is feasible without inventing a variant distribution and cannot fund duplicate known cartons', () => {
  const capacities = new Map([
    ['a', 5n],
    ['b', 5n],
  ])
  assert.equal(
    unresolvedCoverageFeasible(capacities, [
      { entryIds: ['a', 'b'], quantity: '10' },
    ]),
    true
  )
  assert.equal(
    unresolvedCoverageFeasible(
      new Map([
        ['a', 4n],
        ['b', 5n],
      ]),
      [{ entryIds: ['a', 'b'], quantity: '10' }]
    ),
    false
  )
  const record = syntheticOrder('1001', '10')
  const batch = syntheticBatch('1001', 1, '10', {
    contents: [],
    unresolvedContents: [{ entryIds: ['2001'], quantity: '10' }],
  })
  assert.doesNotThrow(() => assertOrderCartonConservation(record, [batch]))
  assert.throws(
    () =>
      assertOrderCartonConservation(record, [
        batch,
        syntheticBatch('1001', 1, '1', { id: 'duplicate' }),
      ]),
    { code: 'CARTON_OVERALLOCATION' }
  )
})

test('legacy positive loading stays unknown and never appears as confidently available or an invented shipment', () => {
  const result = projectBacklog({
    records: [syntheticOrder()],
    batches: [syntheticBatch('1001', 10, '100', { loaded: 6 })],
  })
  assert.equal(result.orders[0].remainingQuantity, null)
  assert.equal(result.orders[0].shipmentStatus, 'needs-review')
  assert.equal(result.orders[0].cartons, null)
  assert.equal(result.totals.quantityComplete, false)
  assert.equal(result.totals.unknownQuantityOrders, 1)
})

test('arbitrary legacy skip cannot remove goods, but a documented cancellation may exclude only its stated units', () => {
  const record = syntheticOrder()
  record.packingExcludedEntryIds = ['2001']
  assert.equal(
    projectBacklog({ records: [record] }).orders[0].remainingQuantity,
    '100'
  )
  record.inventoryDispositions = {
    2001: {
      kind: 'canceled',
      quantity: '10',
      reason: 'Synthetic supplier cancellation',
    },
  }
  assert.equal(
    projectBacklog({ records: [record] }).orders[0].remainingQuantity,
    '90'
  )
})

test('effective revision is counted once while amendment drafts preserve the previous commitment', () => {
  const carton = physicalUnits(syntheticBatch('1001', 1, '100'))[0]
  const old = {
    revisionId: 'c/r1',
    revision: 1,
    cartons: [carton],
    products: [{ orderId: '1001', entryId: '2001', quantity: '100' }],
  }
  const newer = { revisionId: 'c/r2', revision: 2, cartons: [], products: [] }
  const c = {
    id: 'c',
    status: 'amending',
    effectiveRevisionId: old.revisionId,
    revisions: [old],
    draft: { orders: [] },
  }
  assert.equal(
    projectBacklog({
      records: [syntheticOrder()],
      batches: [syntheticBatch('1001', 1, '100')],
      containers: [c],
    }).orders.length,
    0
  )
  c.revisions.push(newer)
  c.effectiveRevisionId = newer.revisionId
  assert.equal(
    projectBacklog({
      records: [syntheticOrder()],
      batches: [syntheticBatch('1001', 1, '100')],
      containers: [c],
    }).orders[0].remainingQuantity,
    '100'
  )
  assert.throws(
    () =>
      committedCartonOwners([
        { ...c, effectiveRevisionId: old.revisionId },
        { ...c, id: 'other', effectiveRevisionId: old.revisionId },
      ]),
    { code: 'DOUBLE_SHIPMENT' }
  )
  assert.equal(carton.id, physicalUnitId('batch-1001', 0))
  assert.equal(
    decimalTotal(['16.75', '14.62', '10.40', '5.63', '5.18', '4.64']),
    '57.22'
  )
})

test('order-owned facts need no preparation/month and retain unknown group quantities and measurement bases', () => {
  const source = syntheticOrder()
  const input = syntheticBatch('1001', 2, '100', {
    month: undefined,
    contents: [],
    packingBasis: 'aggregate',
    unresolvedContents: [
      { entryIds: ['2001'], quantity: null, supplierCode: '0007' },
    ],
    contentsUnknown: true,
    volumeBasis: 'batch',
    suppliedCbm: '0.25',
    reportRef: { id: 'synthetic-report', revision: 1 },
    provenance: { kind: 'reported' },
  })
  const batch = validateCartonBatch(input)
  assert.equal(batch.month, undefined)
  assert.equal(batch.orderId, '1001')
  assert.equal(batch.unresolvedContents[0].quantity, null)
  assert.equal(batch.unresolvedContents[0].supplierCode, '0007')
  assert.equal(batch.volumeBasis, 'batch')
  assert.equal(batch.contentsUnknown, true)
  assert.doesNotThrow(() =>
    assertCartonBatchContext(batch, [source], [], [batch])
  )
  assert.ok(
    physicalUnits(batch).every(
      (unit) => unit.contents === null && unit.volume === null
    )
  )
})

test('reviewed entitlement indices and unit facts retain identity without distributing an aggregate remainder', () => {
  const batch = validateCartonBatch(
    syntheticBatch('1001', 3, '100', {
      packingBasis: 'aggregate',
      entitlementIndices: [0, 4, 5],
      unitContents: {
        4: [{ orderId: '1001', entryId: '2001', quantity: '20' }],
      },
    })
  )
  const units = physicalUnits(batch)
  assert.deepEqual(
    units.map((unit) => unit.id),
    [
      physicalUnitId(batch.id, 0),
      physicalUnitId(batch.id, 4),
      physicalUnitId(batch.id, 5),
    ]
  )
  assert.equal(units[0].contents, null)
  assert.equal(units[1].contents[0].quantity, '20')
  assert.equal(units[2].contents, null)
  assert.throws(
    () =>
      validateCartonBatch({
        ...batch,
        unitContents: {
          4: [{ orderId: '1001', entryId: '2001', quantity: '101' }],
        },
      }),
    /exceed/
  )
  assert.throws(
    () => validateCartonBatch({ ...batch, entitlementIndices: [0, 0, 5] }),
    /distinct stable/
  )
})

test('known per-unit variant facts constrain unresolved group feasibility without saving an arbitrary split', () => {
  const record = syntheticOrder('1001', '10')
  record.snapshot.items.push({
    ...record.snapshot.items[0],
    entryId: '2002',
    quantity: '5',
  })
  const batch = syntheticBatch('1001', 2, '10', {
    packingBasis: 'aggregate',
    contents: [],
    unresolvedContents: [{ entryIds: ['2001', '2002'], quantity: '10' }],
    unitContents: { 0: [{ orderId: '1001', entryId: '2002', quantity: '6' }] },
  })
  assert.throws(() => assertOrderCartonConservation(record, [batch]), {
    code: 'CARTON_OVERALLOCATION',
  })
  batch.unitContents[0][0].quantity = '5'
  assert.doesNotThrow(() => assertOrderCartonConservation(record, [batch]))
  assert.throws(
    () =>
      assertOrderCartonConservation(record, [
        batch,
        syntheticBatch('1001', 1, '1', {
          id: 'other',
          contents: [{ orderId: '1001', entryId: '2002', quantity: '1' }],
        }),
      ]),
    { code: 'CARTON_OVERALLOCATION' }
  )
  batch.unresolvedContents[0].entryIds = ['2001']
  assert.throws(() => assertOrderCartonConservation(record, [batch]), {
    code: 'CARTON_OVERALLOCATION',
  })
})

test('reported unit labels preserve padded numbers and explicit per-carton group pieces remain known without variant allocation', () => {
  const batch = syntheticBatch('1001', 3, '27', {
    packingBasis: 'aggregate',
    contents: [],
    unitLabels: { 0: '001', 1: '002', 2: '003' },
    unresolvedContents: [{ entryIds: ['2001'], quantity: '27' }],
    provenance: { contentClaims: [{ quantity: '9', basis: 'per-carton' }] },
  })
  const units = physicalUnits(batch)
  assert.deepEqual(
    units.map((unit) => unit.reference),
    ['001', '002', '003']
  )
  assert(
    units.every(
      (unit) =>
        unit.labelOrigin === 'reported' &&
        unit.quantity === '9' &&
        unit.contents === null
    )
  )
})
