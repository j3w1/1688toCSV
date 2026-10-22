import test from 'node:test'
import assert from 'node:assert/strict'
import {
  latestStoreWorkflow,
  mergeOperations,
  operationsIndicators,
  productWorkflowClock,
  resolveOperations,
  reviewOperationsMigration,
  validateOperationsMetadata,
  validateOrderWorkflow,
  validateProductWorkflow,
  validateStoreWorkflow,
  workflowRefundPending,
} from '../src/operations-workflow.js'
import { createOperationsRepository } from '../src/operations-repository.js'

const earlier = '2026-10-01T12:00:00.000Z',
  later = '2026-10-02T12:00:00.000Z'

function record(
  orderId = '1001',
  seller = 'synthetic-store',
  accountId = 'local'
) {
  return {
    snapshot: {
      accountId,
      orderId,
      sellerName: 'Synthetic store',
      sellerMemberLogin: seller,
      totals: { payable: '100.00', shipping: '5.00' },
      items: [
        {
          entryId: '1',
          description: 'Synthetic cup',
          quantity: '10',
          price: '9.50',
        },
        {
          entryId: '2',
          description: 'Synthetic plate',
          quantity: '1',
          price: '5.00',
        },
      ],
    },
    notes: 'Keep all source notes',
    tags: [],
    revision: 1,
  }
}

function fixture(records) {
  let saved = new Map(
      records.map((record) => [
        JSON.stringify([record.snapshot.accountId, record.snapshot.orderId]),
        structuredClone(record),
      ])
    ),
    timestamp = Date.parse(later),
    syncCalls = 0
  const transaction = (values) => ({
    objectStore: (name) => ({
      get: (id) => structuredClone(values.get(JSON.stringify(id))),
      getAll: () =>
        name === 'preparations' ? [] : structuredClone([...values.values()]),
      put: (record) =>
        values.set(
          JSON.stringify([record.snapshot.accountId, record.snapshot.orderId]),
          structuredClone(record)
        ),
    }),
  })
  const repository = createOperationsRepository({
    read: async (_, run) => run(transaction(saved)),
    write: async (_, run) => {
      const staged = structuredClone(saved),
        result = await run(transaction(staged))
      saved = staged
      return result
    },
    requested: async (value) => value,
    nextEditTimestamp: (previous) =>
      new Date(
        (timestamp = Math.max(timestamp + 1, Date.parse(previous || 0) + 1))
      ).toISOString(),
    storeIdentity: (snapshot) => snapshot.sellerMemberLogin || null,
    packingPreferencesFor: async () => ({}),
    syncTagCatalogs: async () => {
      syncCalls++
    },
  })
  return {
    repository,
    records: () => structuredClone([...saved.values()]),
    syncCalls: () => syncCalls,
  }
}

test('workflow validation distinguishes false overrides and validates dates, amounts and product clocks', () => {
  assert.deepEqual(validateOperationsMetadata({}), {})
  assert.deepEqual(
    validateProductWorkflow({
      delay: { status: 'none' },
      features: { lighting: false, rotation: true },
      missingLabels: { active: false },
    }),
    {
      delay: { status: 'none' },
      missingLabels: { active: false },
      features: { lighting: false, rotation: true },
    }
  )
  assert.deepEqual(
    validateStoreWorkflow({ labelPrinting: 'send', labelApplication: 'free' }),
    { labelPrinting: 'send', labelApplication: 'free' }
  )
  assert.equal(
    validateOrderWorkflow({
      refund: { actualPaid: '000.0', receivedAmount: '0' },
    }).refund.receivedAmount,
    '0.00'
  )
  for (const value of [
    { delay: { status: 'delayed', confirmedStart: '2026-02-30' } },
    {
      delay: {
        status: 'delayed',
        confirmedStart: '2026-10-10',
        confirmedEnd: '2026-10-09',
      },
    },
    { delay: { status: 'none', confirmedStart: '2026-10-10' } },
    { warehouse: { status: 'waiting', receivedOn: '2026-10-10' } },
    { refund: { actualPaid: '-1' } },
    { refund: { promisedAmount: '1.001' } },
    { sourcePrices: [] },
  ])
    assert.throws(() => validateOrderWorkflow(value))
  assert.throws(() =>
    validateProductWorkflow({
      warehouse: { status: 'partial', receivedQuantity: '1.5' },
    })
  )
  assert.throws(
    () =>
      validateOperationsMetadata({
        storeWorkflow: { labelPrinting: 'supplier' },
      }),
    /timestamp/
  )
  assert.throws(
    () =>
      validateOperationsMetadata({
        productWorkflow: { 1: { features: { rotation: true } } },
      }),
    /timestamp/
  )
  assert.equal(
    validateOperationsMetadata({
      productWorkflow: { 1: {} },
      productWorkflowPartialClocks: { 1: earlier },
    }).productWorkflowPartialClocks['1'],
    earlier
  )
})

test('product false, none and waiting overrides survive resolution, while absent fields inherit', () => {
  const value = record()
  value.orderWorkflow = {
    delay: { status: 'delayed', originalPromise: 'unas semanas' },
    warehouse: { status: 'received', receivedOn: '2026-10-01' },
    missingLabels: { active: true },
  }
  value.productWorkflow = {
    1: {
      delay: { status: 'none' },
      warehouse: { status: 'waiting' },
      missingLabels: { active: false },
      features: { lighting: false, rotation: true },
    },
  }
  const override = resolveOperations(value, '1'),
    inherited = resolveOperations(value, '2')
  assert.equal(override.effective.delay.status, 'none')
  assert.equal(override.effective.missingLabels.active, false)
  assert.equal(override.effective.warehouse.status, 'waiting')
  assert.equal(override.effective.features.lighting, false)
  assert.equal(inherited.effective.delay.originalPromise, 'unas semanas')
  assert.equal(inherited.inherited.delay, true)
  assert.deepEqual(
    operationsIndicators(value, { entryId: '2' }).map((entry) => entry.kind),
    ['workflow']
  )
  assert.deepEqual(
    operationsIndicators(value, { entryId: '1' }).map((entry) => entry.kind),
    ['receipt', 'rotation']
  )
  assert.equal(
    operationsIndicators(value, { entryId: '2', includeInherited: true }).some(
      (entry) => entry.kind === 'delay'
    ),
    true
  )
  assert.deepEqual(
    operationsIndicators(record()).map((entry) => entry.kind),
    ['workflow']
  )
})

test('store/order restore merger preserves newer authored values and tombstones independently', () => {
  const previous = {
      storeWorkflow: { labelPrinting: 'supplier' },
      storeWorkflowUpdatedAt: earlier,
      orderWorkflow: { delay: { status: 'delayed' } },
      orderWorkflowUpdatedAt: later,
    },
    incoming = {
      storeWorkflowUpdatedAt: later,
      orderWorkflow: { delay: { status: 'none' } },
      orderWorkflowUpdatedAt: earlier,
    },
    result = mergeOperations(previous, incoming, { notes: 'Keep this' })
  assert.deepEqual(result, {
    notes: 'Keep this',
    storeWorkflowUpdatedAt: later,
  })
  assert.deepEqual(mergeOperations(incoming, previous), {
    ...incoming,
    orderWorkflow: previous.orderWorkflow,
    orderWorkflowUpdatedAt: later,
  })
  assert.throws(
    () =>
      mergeOperations(previous, {
        storeWorkflow: { labelPrinting: 'send' },
        storeWorkflowUpdatedAt: earlier,
      }),
    /same timestamp/
  )
  assert.equal(latestStoreWorkflow([previous, incoming]), incoming)
})

test('shipping refunds use exact authored amounts and leave original money unchanged', () => {
  const value = record(),
    before = structuredClone(value.snapshot)
  value.storeWorkflow = { shippingRefundPromise: true }
  assert.equal(workflowRefundPending(value), true)
  value.orderWorkflow = {
    refund: {
      actualPaid: '12.00',
      actualFreight: '7.00',
      promisedAmount: '5.00',
      receivedAmount: '4.99',
    },
  }
  assert.equal(workflowRefundPending(value), true)
  value.orderWorkflow.refund.receivedAmount = '5.00'
  assert.equal(workflowRefundPending(value), false)
  assert.deepEqual(value.snapshot, before)
})

test('store saves share only known identity in the same account and stale dialogs cannot overwrite', async () => {
  const a = record(),
    b = record('1002'),
    c = record('1003', 'other'),
    unknown1 = record('1004', ''),
    unknown2 = record('1005', ''),
    otherAccount = record('1006', 'synthetic-store', 'elsewhere'),
    { repository, records } = fixture([
      a,
      b,
      c,
      unknown1,
      unknown2,
      otherAccount,
    ])
  const result = await repository.setStoreWorkflow(
    '1001',
    { labelPrinting: 'send', labelApplication: 'free' },
    { expectedClock: '' }
  )
  assert.deepEqual(
    records().find((value) => value.snapshot.orderId === '1002').storeWorkflow,
    result.storeWorkflow
  )
  for (const id of ['1003', '1004', '1005', '1006'])
    assert.equal(
      records().find((value) => value.snapshot.orderId === id).storeWorkflow,
      undefined
    )
  assert.deepEqual(result.snapshot, a.snapshot)
  const before = records()
  await assert.rejects(
    repository.setStoreWorkflow('1001', {}, { expectedClock: '' }),
    /another tab/
  )
  assert.deepEqual(records(), before)
  const cleared = await repository.setStoreWorkflow(
    '1001',
    {},
    { expectedClock: result.storeWorkflowUpdatedAt }
  )
  assert.equal(cleared.storeWorkflow, undefined)
  assert.ok(cleared.storeWorkflowUpdatedAt > result.storeWorkflowUpdatedAt)
  await repository.setStoreWorkflow('1004', { labelApplication: 'paid' })
  assert.equal(
    records().find((value) => value.snapshot.orderId === '1005').storeWorkflow,
    undefined
  )
})

test('product saves use per-entry clocks and clears retain tombstones without touching other products', async () => {
  const value = record()
  value.productWorkflow = {
    1: { features: { lighting: true } },
    2: { features: { rotation: true } },
  }
  value.productWorkflowUpdatedAt = earlier
  const { repository, records } = fixture([value])
  const result = await repository.setProductWorkflow(
    '1001',
    '1',
    {},
    { expectedClock: earlier }
  )
  assert.equal(result.productWorkflow['1'], undefined)
  assert.equal(result.productWorkflow['2'].features.rotation, true)
  assert.equal(result.productWorkflowUpdatedAt, earlier)
  assert.ok(productWorkflowClock(result, '1') > earlier)
  assert.equal(productWorkflowClock(result, '2'), earlier)
  await assert.rejects(
    repository.setProductWorkflow(
      '1001',
      '1',
      { features: { lighting: true } },
      { expectedClock: earlier }
    ),
    /another tab/
  )
  assert.deepEqual(records()[0], result)
  await assert.rejects(
    repository.setProductWorkflow('1001', '99', {}),
    /not found/
  )
})

test('an atomic combined save rejects stale product edits before changing the store or order', async () => {
  const value = record()
  value.productWorkflowPartialClocks = { 1: later }
  const { repository, records } = fixture([value]),
    before = records()
  await assert.rejects(
    repository.setOperationsWorkflow(
      '1001',
      {
        store: { labelPrinting: 'supplier' },
        order: { instructions: { labelsSent: true } },
        product: { entryId: '1', value: { features: { lighting: true } } },
      },
      { expectedProductClock: earlier }
    ),
    /another tab/
  )
  assert.deepEqual(records(), before)
})

test('migration proposes only recognized operations and retains approximate original wording', () => {
  const value = record()
  value.tags = [
    'Retraso: varias semanas',
    'Imprime etiquetas',
    'Pago complementario: referencia 42',
    'CE26X01001',
  ]
  value.productTags = { 1: ['Con luz', 'Rotación', 'Azul'] }
  const review = reviewOperationsMigration([value])
  assert.equal(review.items.length, 4)
  assert.deepEqual(
    review.unresolved.map((entry) => entry.tag),
    ['Pago complementario: referencia 42', 'CE26X01001', 'Azul']
  )
  const delay = review.items.find((item) => item.target === 'order')
  assert.equal(delay.patch.delay.originalPromise, 'Retraso: varias semanas')
  assert.equal(delay.patch.delay.confirmedStart, undefined)
  assert.equal(delay.requiresEditing, true)
  assert.equal(value.orderWorkflow, undefined)
})

test('confirmed migration is atomic, preserves unresolved notes/tags and shares known store services', async () => {
  const value = record(),
    sibling = record('1002')
  value.tags = ['Retrasado', 'Imprime etiquetas', 'Pago extra de otro pedido']
  value.productTags = { 1: ['Con luz', 'Rotación', 'Marca propia'] }
  const { repository, records, syncCalls } = fixture([value, sibling]),
    review = reviewOperationsMigration(records())
  await assert.rejects(repository.applyOperationsMigration(review), /confirm/)
  assert.deepEqual(records()[0], value)
  const result = await repository.applyOperationsMigration(review, {
    confirmed: true,
  })
  assert.equal(result.migrated, 4)
  assert.equal(syncCalls(), 1)
  const [a, b] = records()
  assert.deepEqual(a.tags, ['Pago extra de otro pedido'])
  assert.deepEqual(a.productTags['1'], ['Marca propia'])
  assert.deepEqual(a.productWorkflow['1'].features, {
    lighting: true,
    rotation: true,
  })
  assert.deepEqual(a.productWorkflow['1'].legacyTags, ['Con luz', 'Rotación'])
  assert.equal(a.orderWorkflow.delay.originalPromise, 'Retrasado')
  assert.equal(a.orderWorkflow.delay.confirmedStart, undefined)
  assert.equal(b.storeWorkflow.labelPrinting, 'supplier')
  assert.deepEqual(a.snapshot, value.snapshot)
  assert.equal(a.notes, value.notes)
  validateOperationsMetadata(a)
  validateOperationsMetadata(b)
})

test('migration rejects stale reviews and mutually conflicting selected store tags without partial effects', async () => {
  const value = record(),
    other = record('1002')
  value.tags = ['Imprime etiquetas']
  other.tags = ['No imprime etiquetas']
  const { repository, records } = fixture([value, other]),
    review = reviewOperationsMigration(records()),
    before = records()
  await assert.rejects(
    repository.applyOperationsMigration(review, { confirmed: true }),
    /conflict/
  )
  assert.deepEqual(records(), before)
  await repository.setOrderWorkflow('1001', {
    warehouse: { status: 'received' },
  })
  const changed = records()
  await assert.rejects(
    repository.applyOperationsMigration(
      { items: [review.items[0]] },
      { confirmed: true }
    ),
    /another tab/
  )
  assert.deepEqual(records(), changed)
})
