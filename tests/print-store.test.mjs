import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPrintStore,
  restoreJob,
  PRINT_KEYS,
  RECENT_LIMIT,
  RECENT_PRODUCT_LIMIT,
  refKey,
  assertContainerPrintRef,
  makeOrderCartonPrintRef,
  assertOrderCartonPrintRef,
  orderCartonPrintIdentity,
} from '../src/print-store.js'

function physicalContext() {
  return {
    record: {
      snapshot: {
        accountId: 'local',
        orderId: '101',
        observedAt: '2026-10-23T04:00:00Z',
      },
    },
    preparation: {
      accountId: 'local',
      orderId: '101',
      revision: 3,
      groups: [
        {
          id: 'surviving',
          baseCode: 'CE26101001',
          category: '当前产品',
          spanishName: 'ACTUAL',
        },
      ],
    },
    batches: [
      {
        id: 'batch-a',
        accountId: 'local',
        orderId: '101',
        revision: 4,
        count: 2,
        mark: { orderId: '101', groupId: 'surviving' },
        physicalMark: {
          code: 'CE26101002',
          productCode: 'CE26101001',
          artwork: { category: '原纸箱标记', spanishName: 'ORIGINAL' },
        },
      },
    ],
    revisions: {
      source: `complete-source-and-original-photo-signature:${'synthetic-photo'.repeat(1000)}`,
      observedAt: '2026-10-23T04:00:00Z',
      preparation: 3,
      cartons: { 'batch-a': 4 },
      reports: {},
    },
  }
}

test('typed Orders carton marks retain compact complete guards and recorded/current roles without an old product group', async () => {
  const context = physicalContext(),
    original = structuredClone(context)
  const ref = await makeOrderCartonPrintRef(context, {
    batchId: 'batch-a',
    role: 'recorded',
    index: 1,
  })
  assert.equal(ref.scope, 'order-carton-mark')
  assert.equal(ref.code, 'CE26101002')
  assert.equal(ref.currentProductCode, 'CE26101001')
  assert.equal(ref.batchRevision, 4)
  assert.equal(ref.preparationRevision, 3)
  assert.equal(Object.hasOwn(ref, 'groupId'), false)
  assert.match(ref.sourceGuard, /^[0-9a-f]{64}$/)
  assert.ok(JSON.stringify(ref).length < 600)
  assert.equal(JSON.stringify(ref).includes('synthetic-photo'), false)
  const storage = memoryStorage(),
    store = createPrintStore(storage)
  const job = store.recordJob({
    kind: 'marks',
    products: [{ code: ref.code, quantity: 6, ref }],
  })
  assert.deepEqual(
    createPrintStore(storage).recentJobs()[0].products[0].ref,
    ref
  )
  assert.deepEqual(orderCartonPrintIdentity(ref), ref)
  assert.equal(
    await assertOrderCartonPrintRef(JSON.parse(JSON.stringify(ref)), context),
    true
  )
  const same = { key: 'actual-mark', code: ref.code, ref }
  assert.equal(restoreJob(job, [same]).items.length, 1)
  const current = await makeOrderCartonPrintRef(context, {
    batchId: 'batch-a',
    role: 'current-product',
    index: 1,
  })
  assert.equal(current.code, 'CE26101001')
  assert.notEqual(refKey(ref), refKey(current))
  assert.equal(restoreJob(job, [{ ...same, ref: current }]).missing.length, 1)
  assert.notEqual(
    refKey(ref),
    refKey(
      await makeOrderCartonPrintRef(context, { batchId: 'batch-a', index: 0 })
    )
  )
  assert.notEqual(refKey(ref), refKey({ orderId: '101', groupId: 'surviving' }))
  assert.deepEqual(context, original)
})

test('physical mark regeneration rejects changed source, batch, preparation, artwork, role, epoch and missing cartons', async () => {
  const context = physicalContext()
  context.amendmentContext = { containerId: 'container', epoch: 'first' }
  context.revisions.amendmentContext = structuredClone(context.amendmentContext)
  const ref = await makeOrderCartonPrintRef(context, { batchId: 'batch-a' })
  assert.equal(ref.contextContainerId, 'container')
  assert.equal(ref.amendmentEpoch, 'first')
  const variants = []
  for (const change of [
    (value) => {
      value.revisions.source += ':changed'
    },
    (value) => {
      value.batches[0].revision++
      value.revisions.cartons['batch-a']++
    },
    (value) => {
      value.preparation.revision++
      value.revisions.preparation++
    },
    (value) => {
      value.record.snapshot.observedAt = value.revisions.observedAt =
        '2026-10-23T05:00:00Z'
    },
    (value) => {
      value.batches[0].physicalMark.code = 'CE26101003'
    },
    (value) => {
      value.batches[0].physicalMark.artwork.category =
        'Different recorded artwork'
    },
    (value) => {
      value.amendmentContext.epoch = value.revisions.amendmentContext.epoch =
        'second'
    },
    (value) => {
      delete value.amendmentContext
      delete value.revisions.amendmentContext
    },
    (value) => {
      value.batches = []
    },
    (value) => {
      value.batches[0].deletedAt = '2026-10-23T05:00:00Z'
    },
    (value) => {
      value.record.snapshot.accountId = 'other'
    },
  ]) {
    const next = structuredClone(context)
    change(next)
    variants.push(next)
  }
  for (const next of variants)
    await assert.rejects(
      assertOrderCartonPrintRef(ref, next),
      /Review the current order/
    )
  await assert.rejects(
    assertOrderCartonPrintRef({ ...ref, markRole: 'current-product' }, context),
    /Review the current order/
  )
  await assert.rejects(
    makeOrderCartonPrintRef(context, { batchId: 'batch-a', index: 2 }),
    /Review the current order/
  )
})

test('malformed physical refs cannot fall back to legacy Orders or container identity', async () => {
  const ref = await makeOrderCartonPrintRef(physicalContext(), {
    batchId: 'batch-a',
  })
  for (const change of [
    { scope: 'orders' },
    { batchRevision: 0 },
    { preparationRevision: -1 },
    { sourceGuard: 'not-a-guard' },
    { index: -1 },
    { index: 0.5 },
    { markRole: 'guess' },
    { code: 'not-a-code' },
    { contextContainerId: 'x' },
    { amendmentEpoch: 'missing-context' },
    { containerId: 'container', revisionId: 'r1' },
  ]) {
    const candidate = {
      ...ref,
      groupId: 'legacy-does-not-rescue-it',
      ...change,
    }
    assert.equal(
      createPrintStore(memoryStorage()).recordJob({
        kind: 'marks',
        products: [{ code: ref.code, quantity: 1, ref: candidate }],
      }),
      null
    )
    assert.equal(orderCartonPrintIdentity(candidate), null)
  }
})

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    values,
  }
}

test('historical print jobs retain account/container/revision/carton identity and never resolve to another revision or live data', () => {
  const storage = memoryStorage(),
    store = createPrintStore(storage)
  const ref = {
    accountId: 'local',
    orderId: '101',
    groupId: 'g',
    variantId: null,
    containerId: 'container-a',
    revisionId: 'container-a/r1',
    cartonId: 'unit:a:1',
  }
  const job = store.recordJob({
    kind: 'marks',
    products: [{ code: 'CE26090101', quantity: 1, refs: [ref] }],
  })
  assert.deepEqual(createPrintStore(storage).recentJobs()[0].products[0].refs, [
    ref,
  ])
  const exact = { key: 'physical-one', code: 'CE26090101', refs: [ref] }
  assert.equal(restoreJob(job, [exact]).items.length, 1)
  assert.equal(
    restoreJob(job, [
      { ...exact, refs: [{ ...ref, revisionId: 'container-a/r2' }] },
    ]).missing.length,
    1
  )
  assert.equal(
    restoreJob(job, [
      { ...exact, refs: [{ orderId: '101', groupId: 'g', variantId: null }] },
    ]).missing.length,
    1
  )
  assert.notEqual(refKey(ref), refKey({ ...ref, accountId: 'another-account' }))
  const next = { ...ref, cartonId: 'unit:a:2' }
  assert.equal(
    store.recordJob({
      kind: 'marks',
      products: [{ code: 'CE26090101', quantity: 2, refs: [ref, next] }],
    }).products[0].refs.length,
    2
  )
  const productRef = { ...ref, cartonId: undefined, entryIds: ['line-a'] }
  delete productRef.cartonId
  assert.equal(
    store.recordJob({
      kind: 'labels',
      products: [
        {
          code: 'CE26090101',
          quantity: 2,
          refs: [productRef, { ...productRef, entryIds: ['line-b'] }],
        },
      ],
    }).products[0].refs.length,
    2
  )
})

test('draft print refs survive JSON storage, retain their explicit null revision and require the exact draft to regenerate', () => {
  const storage = memoryStorage(),
    store = createPrintStore(storage),
    ref = {
      accountId: 'local',
      orderId: '101',
      groupId: 'g',
      variantId: null,
      containerId: 'draft-container',
      revisionId: null,
      draft: true,
      draftRevision: 3,
    },
    job = store.recordJob({
      kind: 'labels',
      products: [{ code: 'CE26090101', quantity: 10, refs: [ref] }],
    }),
    manifest = {
      container: { id: 'draft-container', accountId: 'local' },
      draft: true,
      status: 'draft',
      revision: 3,
      revisionId: null,
    }
  assert.ok(job)
  assert.deepEqual(createPrintStore(storage).recentJobs()[0].products[0].refs, [
    ref,
  ])
  const json = JSON.parse(JSON.stringify(job))
  assert.equal(
    assertContainerPrintRef(json.products[0].refs[0], manifest),
    true
  )
  for (const candidate of [
    null,
    { ...manifest, revision: 4 },
    {
      ...manifest,
      draft: false,
      status: 'sealed',
      revisionId: 'draft-container/r1',
    },
    { ...manifest, container: { id: 'another' } },
    { ...manifest, container: { ...manifest.container, accountId: 'another' } },
  ]) {
    assert.throws(
      () => assertContainerPrintRef(ref, candidate),
      /Review the current container/
    )
  }
  const exact = { key: 'captured', code: 'CE26090101', refs: [ref] }
  assert.equal(restoreJob(json, [exact]).items.length, 1)
  assert.equal(
    restoreJob(json, [{ ...exact, refs: [{ ...ref, draftRevision: 4 }] }])
      .missing.length,
    1
  )
  assert.notEqual(
    refKey(ref),
    refKey({
      ...ref,
      draft: undefined,
      draftRevision: undefined,
      revisionId: 'draft-container/r1',
    })
  )
  for (const draftRevision of [
    undefined,
    0,
    -1,
    '3',
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.equal(
      store.recordJob({
        kind: 'labels',
        products: [
          { code: 'CE26090101', quantity: 1, ref: { ...ref, draftRevision } },
        ],
      }),
      null
    )
  const sealed = { ...ref, revisionId: 'draft-container/r1' }
  delete sealed.draft
  delete sealed.draftRevision
  assert.equal(
    assertContainerPrintRef(sealed, {
      ...manifest,
      draft: false,
      status: 'sealed',
      revisionId: sealed.revisionId,
    }),
    true
  )
})

test('incomplete or unbounded historical print refs are rejected whole instead of silently becoming live source refs', () => {
  const store = createPrintStore(memoryStorage())
  for (const ref of [
    { orderId: '101', groupId: 'g', containerId: 'a' },
    { orderId: '101', groupId: 'g', revisionId: 'a/r1' },
    {
      orderId: '101',
      groupId: 'g',
      containerId: 'a',
      revisionId: 'x'.repeat(513),
    },
  ])
    assert.equal(
      store.recordJob({
        kind: 'marks',
        products: [{ code: 'CE26090101', quantity: 1, ref }],
      }),
      null
    )
  const ref = {
    accountId: 'local',
    orderId: '101',
    containerId: 'a',
    revisionId: 'a/r1',
    cartonId: 'unit:a:1',
  }
  assert.deepEqual(
    store.recordJob({
      kind: 'marks',
      products: [{ code: 'SUPPLIER-001', quantity: 1, refs: [ref] }],
    }).products[0].refs[0],
    { ...ref, variantId: null }
  )
})

test('recent physical marks retain numbered carton identities even when their contents use another code group', () => {
  const storage = memoryStorage(),
    store = createPrintStore(storage)
  const ref = {
    orderId: '101',
    groupId: 'physical-mark',
    variantId: null,
    cartonBatchIds: ['carton-1', 'carton-2', 'carton-1'],
  }
  const job = store.recordJob({
    kind: 'marks',
    products: [{ code: 'CE26101001', quantity: 2, refs: [ref] }],
  })
  assert.deepEqual(job.products[0].refs[0].cartonBatchIds, [
    'carton-1',
    'carton-2',
  ])
  assert.deepEqual(
    createPrintStore(storage).recentJobs()[0].products[0].refs,
    job.products[0].refs
  )
})

test('recent shared labels retain every source reference and refuse a partial or split recovery', () => {
  const storage = memoryStorage()
  const store = createPrintStore(storage)
  const refs = [
    { orderId: '101', groupId: 'original', variantId: 'red', entryIds: ['1'] },
    {
      orderId: '102',
      groupId: 'repeat',
      variantId: 'red-repeat',
      entryIds: ['1'],
    },
  ]
  const job = store.recordJob({
    kind: 'labels',
    products: [{ code: 'CE26100101AS', quantity: 30, ref: refs[0], refs }],
  })
  assert.deepEqual(job.products[0].refs, refs)
  assert.deepEqual(
    createPrintStore(storage).recentJobs()[0].products[0].refs,
    refs
  )
  const item = {
    key: 'CE26100101AS',
    code: 'CE26100101AS',
    ref: refs[0],
    refs,
    orders: [{ orderId: '101' }, { orderId: '102' }],
  }
  const restored = restoreJob(job, [item])
  assert.equal(restored.items.length, 1)
  assert.equal(restored.items[0].quantity, 30)
  assert.equal(restored.items[0].refs.length, 2)
  const partial = restoreJob(job, [{ ...item, refs: [refs[1]], ref: refs[1] }])
  assert.equal(partial.items.length, 0)
  assert.equal(partial.missing.length, 1)
  const split = restoreJob(job, [
    { ...item, refs: [refs[0]] },
    {
      ...item,
      key: 'CE26100102AS',
      code: 'CE26100102AS',
      ref: refs[1],
      refs: [refs[1]],
    },
  ])
  assert.equal(split.items.length, 0)
  assert.equal(split.missing.length, 1)
})

test('a shared print job that exceeds source-reference history capacity is refused whole', () => {
  const store = createPrintStore(memoryStorage())
  const refs = Array.from({ length: RECENT_PRODUCT_LIMIT + 1 }, (_, index) => ({
    orderId: String(index + 1),
    groupId: 'synthetic',
    variantId: 'a',
  }))
  assert.equal(
    store.recordJob({
      kind: 'labels',
      products: [{ code: 'CE26100101AS', quantity: 30, ref: refs[0], refs }],
    }),
    null
  )
})

test('recent jobs retain the output language independently of later workspace changes', () => {
  const storage = memoryStorage()
  const store = createPrintStore(storage)
  for (const language of ['en', 'es', 'zh']) {
    store.recordJob({
      id: language,
      kind: 'marks',
      language,
      products: [{ code: 'CE26103102', quantity: 1 }],
    })
  }
  assert.deepEqual(
    new Set(
      createPrintStore(storage)
        .recentJobs()
        .map((job) => job.language)
    ),
    new Set(['en', 'es', 'zh'])
  )
  assert.equal(
    store.recordJob({
      id: 'old',
      kind: 'labels',
      products: [{ code: 'CE26103102', quantity: 1 }],
    }).language,
    'en'
  )
})

test('labels and carton marks keep separate settings', () => {
  const storage = memoryStorage()
  const store = createPrintStore(storage)
  store.saveLayout('labels', { spares: 'equal', offsetXMm: 1.2 })
  store.saveLayout('marks', { numbering: false, offsetXMm: -0.4 })
  const again = createPrintStore(storage)
  assert.equal(again.layout('labels').spares, 'equal')
  assert.equal(again.layout('labels').offsetXMm, 1.2)
  assert.equal(again.layout('marks').numbering, false)
  assert.equal(again.layout('marks').offsetXMm, -0.4)
  assert.notEqual(PRINT_KEYS.labels, PRINT_KEYS.marks)
})

test('unreadable or missing storage falls back to defaults', () => {
  const storage = memoryStorage()
  storage.setItem(PRINT_KEYS.labels, '{not json')
  assert.equal(
    createPrintStore(storage).layout('labels').spares,
    'proportional'
  )
  const broken = {
    getItem() {
      throw new Error('blocked')
    },
    setItem() {
      throw new Error('blocked')
    },
  }
  const store = createPrintStore(broken)
  assert.equal(store.layout('marks').numbering, true)
  assert.doesNotThrow(() => store.saveLayout('labels', {}))
  assert.equal(createPrintStore(null).recentJobs().length, 0)
})

test('named A4 presets start with the fixed default and replace by name', () => {
  const store = createPrintStore(memoryStorage())
  assert.deepEqual(store.presets(), [
    { id: 'a4-5', name: 'A4 · 5 mm', marginMm: 5, offsetXMm: 0, offsetYMm: 0 },
  ])
  const office = store.savePreset({
    name: 'Office HP',
    marginMm: 6,
    offsetXMm: 0.8,
    offsetYMm: -9,
  })
  assert.match(office.id, /^preset-/)
  assert.deepEqual(
    { ...office, id: undefined },
    {
      id: undefined,
      name: 'Office HP',
      marginMm: 6,
      offsetXMm: 0.8,
      offsetYMm: -5,
    }
  )
  store.savePreset({
    name: 'Office HP',
    marginMm: 5,
    offsetXMm: 0.5,
    offsetYMm: 0,
  })
  assert.equal(store.presets().length, 2)
  assert.equal(store.presets()[1].offsetXMm, 0.5)
  assert.throws(() => store.savePreset({ name: '  ' }), /Name the preset/)
  assert.throws(() => store.savePreset({ name: 'A4 · 5 mm' }), /default preset/)
  store.deletePreset('a4-5')
  store.deletePreset(office.id)
  assert.equal(store.presets().length, 1)
})

test('recent jobs keep the five most recent exports across both types, newest first', () => {
  const store = createPrintStore(memoryStorage())
  for (let index = 0; index < 7; index++)
    store.recordJob({
      kind: index % 2 ? 'marks' : 'labels',
      date: new Date(Date.UTC(2026, 9, 19, 10, index)).toISOString(),
      products: [
        { code: `CE2610010${index}`, name: 'VELA', quantity: index + 1 },
      ],
      layout: { spares: 'equal' },
      pages: 1,
      total: 70,
    })
  const jobs = store.recentJobs()
  assert.equal(jobs.length, RECENT_LIMIT)
  assert.deepEqual(
    jobs.map((job) => job.products[0].code),
    ['CE26100106', 'CE26100105', 'CE26100104', 'CE26100103', 'CE26100102']
  )
  assert.equal(jobs[0].kind, 'labels')
  assert.equal(jobs[1].kind, 'marks')
  assert.equal(jobs[0].layout.spares, 'equal')
  assert.equal(jobs[1].layout.numbering, true)
  // A job without products is not recorded.
  assert.equal(store.recordJob({ kind: 'labels', products: [] }), null)
})

test('regenerating a job revalidates products against current data and keeps quantities and caps', () => {
  const ref = (variantId) => ({ orderId: 'O1', groupId: 'G1', variantId })
  const job = {
    kind: 'labels',
    date: '2026-10-19T10:00:00.000Z',
    products: [
      {
        code: 'CE26100101',
        name: 'VELA',
        quantity: 40,
        cap: 2,
        ref: ref('V1'),
      },
      { code: 'CE26100102', name: 'DIFUSOR', quantity: 50, ref: ref('V2') },
      { code: 'CE26100199', name: 'GONE', quantity: 5, ref: ref('V9') },
    ],
    layout: { spares: 'proportional', limitExtras: true },
  }
  const current = [
    {
      key: 'CE26100102',
      code: 'CE26100102',
      name: 'DIFUSOR AROMA',
      quantity: 24,
      ref: ref('V2'),
    },
    {
      key: 'CE26100101',
      code: 'CE26100101',
      name: 'VELA',
      quantity: 1,
      ref: ref('V1'),
    },
  ]
  const restored = restoreJob(job, current)
  assert.deepEqual(
    restored.items.map((item) => [
      item.code,
      item.quantity,
      item.cap,
      item.name,
    ]),
    [
      ['CE26100101', 40, 2, 'VELA'],
      ['CE26100102', 50, undefined, 'DIFUSOR AROMA'],
    ]
  )
  assert.deepEqual(
    restored.missing.map((product) => product.code),
    ['CE26100199']
  )
  assert.deepEqual(restored.changed, [])
  assert.equal(restored.layout.limitExtras, true)
})

test('regeneration finds products by order, group and variant, never by a reused code', () => {
  const ref = (variantId) => ({ orderId: 'O1', groupId: 'G1', variantId })
  const store = createPrintStore(memoryStorage())
  const job = store.recordJob({
    kind: 'labels',
    date: '2026-10-19T10:00:00.000Z',
    products: [
      { code: 'CE26100101', name: 'VELA', quantity: 40, ref: ref('V1') },
      { code: 'CE26100102', name: 'DIFUSOR', quantity: 10, ref: ref('V2') },
      { code: 'CE26100103', name: 'OLD', quantity: 5 },
    ],
    layout: {},
  })
  assert.deepEqual(job.products[0].ref, ref('V1'))
  assert.equal(job.products[2].ref, undefined)
  const current = [
    // CE26100101 was released and reused by another product elsewhere.
    {
      key: 'CE26100101',
      code: 'CE26100101',
      name: 'OTRO',
      ref: { orderId: 'O9', groupId: 'G9', variantId: 'V9' },
    },
    // The original product now carries a new code.
    { key: 'CE26100111', code: 'CE26100111', name: 'VELA', ref: ref('V1') },
    { key: 'CE26100102', code: 'CE26100102', name: 'DIFUSOR', ref: ref('V2') },
  ]
  const restored = restoreJob(job, current)
  assert.deepEqual(
    restored.items.map((item) => [item.code, item.name, item.quantity]),
    [
      ['CE26100111', 'VELA', 40],
      ['CE26100102', 'DIFUSOR', 10],
    ]
  )
  assert.deepEqual(restored.changed, [{ from: 'CE26100101', to: 'CE26100111' }])
  assert.deepEqual(
    restored.missing.map((product) => product.code),
    ['CE26100103']
  )
})

test('distinct non-Latin preset names stay distinct; the same name replaces in place', () => {
  const store = createPrintStore(memoryStorage())
  const office = store.savePreset({
    name: '办公室',
    marginMm: 5,
    offsetXMm: 0.5,
  })
  const storeroom = store.savePreset({ name: '仓库', marginMm: 6 })
  assert.notEqual(office.id, storeroom.id)
  assert.deepEqual(
    store.presets().map((preset) => preset.name),
    ['A4 · 5 mm', '办公室', '仓库']
  )
  const again = store.savePreset({ name: '办公室', marginMm: 7 })
  assert.equal(again.id, office.id)
  assert.deepEqual(
    store.presets().map((preset) => [preset.name, preset.marginMm]),
    [
      ['A4 · 5 mm', 5],
      ['仓库', 6],
      ['办公室', 7],
    ]
  )
})

test('an export with more products than history can hold is not kept rather than kept incomplete', () => {
  const store = createPrintStore(memoryStorage())
  const products = (count) =>
    Array.from({ length: count }, (_, index) => ({
      code: `CE${String(index).padStart(8, '0')}`,
      quantity: 1,
    }))
  assert.equal(
    store.recordJob({
      kind: 'labels',
      products: products(RECENT_PRODUCT_LIMIT + 1),
      layout: {},
    }),
    null
  )
  assert.equal(store.recentJobs().length, 0)
  const kept = store.recordJob({
    kind: 'labels',
    products: products(RECENT_PRODUCT_LIMIT),
    layout: {},
  })
  assert.equal(kept.products.length, RECENT_PRODUCT_LIMIT)
})
