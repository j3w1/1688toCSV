import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createContainerController,
  createContainerWorkspace,
} from '../src/container-workspace.js'
import {
  captureContainerOutput,
  outputLabelModels,
} from '../src/product-output.js'
import { parseHTML } from 'linkedom'
import { openProductDetails } from '../src/product-details.js'
import { openPackingExportDialog } from '../src/packing-export-dialog.js'
import { createProductAuthoring } from '../src/product-authoring.js'
import { validatePackingPreferences } from '../src/packing-model.js'
import {
  mountOrderCartonGrid,
  createPackingReportIntakeController,
  cartonHistoryRows,
  mountCartonHistory,
  createOrderCartonSession,
} from '../src/order-carton-grid.js'
import * as actualPlanner from '../src/carton-reconciliation.js'
import { applyCartonUnitException } from '../src/carton-batches.js'
import {
  syntheticOrder,
  syntheticBatch,
} from './fixtures/container-fixture.mjs'

test('carton history retains current, retired, legacy and prior revisions across complete order scope', () => {
  const a = syntheticOrder('1001'),
    b = syntheticOrder('1002'),
    c = syntheticOrder('1003'),
    current = syntheticBatch('1001'),
    retired = syntheticBatch('1002', 1, '10', {
      deletedAt: '2026-10-20T00:00:00Z',
    }),
    prior = {
      ...current,
      revision: 0,
      updatedAt: '2026-09-20T00:00:00Z',
      weight: '7.25',
      weightBasis: 'batch',
    },
    legacy = {
      ...syntheticBatch('1002'),
      id: 'cross-order',
      orderId: undefined,
      contents: [
        { orderId: '1001', entryId: '2001', quantity: '20' },
        { orderId: '1002', entryId: '2001', quantity: '10' },
      ],
    },
    state = {
      records: [a, b, c],
      batches: [current, retired, legacy],
      cartonHistory: [{ batch: prior }, { batch: current }],
    },
    before = structuredClone(state),
    all = cartonHistoryRows(state)
  assert.equal(all.length, 5)
  assert.equal(new Set(all.map((row) => row.key)).size, 5)
  assert.equal(
    all.find((row) => row.batch?.deletedAt).state,
    'Retired evidence'
  )
  assert.equal(
    all.find((row) => row.batch?.id === 'cross-order').state,
    'Needs review'
  )
  assert.equal(all.find((row) => row.batch?.revision === 0).weight, '7.25')
  assert.equal(
    all.find((row) => row.order === '1003').state,
    'Awaiting packing data'
  )
  assert.equal(
    cartonHistoryRows(state, [{ accountId: 'local', orderId: '1001' }]).length,
    3
  )
  assert.deepEqual(state, before)
})

test('carton history scopes account identities and never turns combined volume or unknown measurements into per-box totals', () => {
  const batch = syntheticBatch('1001', 4, '100', {
      suppliedCbm: '0.12',
      volumeBasis: 'batch',
    }),
    other = { ...batch, accountId: 'other', id: 'other-account' },
    rows = cartonHistoryRows({ records: [], batches: [batch, other] }, [
      { accountId: 'local', orderId: '1001' },
    ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].volume, '0.12')
  assert.equal(rows[0].weight, null)
  assert.equal(rows[0].count, 4)
})

function dom(context) {
  const { document, window } = parseHTML(
    '<html><body><div id="host"></div></body></html>'
  )
  for (const [key, value] of Object.entries({
    document,
    Event: window.Event,
    HTMLDialogElement: class {},
    Option: function (text, value) {
      const option = document.createElement('option')
      option.textContent = text
      option.value = value
      return option
    },
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, configurable: true })
    context.after(() =>
      previous
        ? Object.defineProperty(globalThis, key, previous)
        : delete globalThis[key]
    )
  }
  const prototype = Object.getPrototypeOf(document.createElement('dialog'))
  const selectPrototype = Object.getPrototypeOf(
      document.createElement('select')
    ),
    selectValue = Object.getOwnPropertyDescriptor(selectPrototype, 'value')
  Object.defineProperty(selectPrototype, 'value', {
    ...selectValue,
    set(value) {
      const options = [...this.querySelectorAll('option')]
      for (const option of options) option.removeAttribute('selected')
      options
        .find((option) => option.value === String(value))
        ?.setAttribute('selected', '')
    },
    configurable: true,
  })
  context.after(() =>
    Object.defineProperty(selectPrototype, 'value', selectValue)
  )
  for (const [key, value] of Object.entries({
    clientWidth: 800,
    clientHeight: 600,
    clientTop: 0,
    scrollTop: 0,
  }))
    Object.defineProperty(window.HTMLElement.prototype, key, {
      value,
      writable: true,
      configurable: true,
    })
  const previousModal = prototype.showModal,
    previousClose = prototype.close
  prototype.showModal = function () {
    this.open = true
  }
  prototype.close = function () {
    this.open = false
    this.dispatchEvent(new window.Event('close'))
  }
  context.after(() => {
    prototype.showModal = previousModal
    prototype.close = previousClose
  })
  return { document, window }
}

const ref = { accountId: 'local', orderId: '10001' }
function exceptionSessionFixture(options = {}) {
  const record = syntheticOrder('1001'),
    batch = syntheticBatch('1001', 5, '100', {
      weight: '2.5',
      len: '50',
      wid: '40',
      ht: '30',
    }),
    context = {
      record,
      preparation: { groups: [] },
      batches: [batch],
      reports: [],
      draft: null,
      projection: {},
      revisions: { source: 'source-1', cartons: { [batch.id]: 1 } },
    },
    drafts = [],
    confirmed = [],
    reads = []
  let draftRevision = 0
  const repository = {
    async getOrderReconciliation(args) {
      reads.push(args)
      return structuredClone(context)
    },
    async saveOrderCartonDraft(args) {
      drafts.push(structuredClone(args))
      return { revision: ++draftRevision }
    },
    async confirmOrderCartons(args) {
      confirmed.push(structuredClone(args))
      return {}
    },
  }
  return {
    record,
    batch,
    drafts,
    confirmed,
    reads,
    create: () =>
      createOrderCartonSession({
        repository,
        orderRef: { accountId: 'local', orderId: '1001' },
        planner: actualPlanner,
        ...options,
      }),
  }
}

test('confirmed entitlement exception uses the real domain helper and one order confirm while preserving untouched physical identities', async (context) => {
  const fixture = exceptionSessionFixture({
      getContextContainerId: () => 'amendment-container',
    }),
    session = await fixture.create()
  context.after(() => session.dispose())
  const before = structuredClone(fixture.record.snapshot),
    units = session.unitEntitlements(fixture.batch.id)
  assert.equal(units.length, 5)
  assert.equal(units[3].contents[0].quantity, '20')
  await session.stageUnitFacts({
    batchId: fixture.batch.id,
    index: 3,
    contents: [{ orderId: '1001', entryId: '2001', quantity: '17' }],
  })
  assert.equal(session.projection().unassignedPieces, '3')
  const staged = fixture.drafts.at(-1).draft.plannerDraft.cartons[0]
  assert.equal(staged.contents[0].quantity, '97')
  assert.equal(staged.packingBasis, 'aggregate')
  assert.equal(staged.unitContents[0][0].quantity, '20')
  assert.equal(staged.unitContents[3][0].quantity, '17')
  assert.equal(staged.unitMeasurements[0].weight, '2.5')
  assert.equal(staged.unitMeasurements[3].weight, '')
  assert.deepEqual(
    session.unitEntitlements(fixture.batch.id).map((unit) => unit.id),
    units.map((unit) => unit.id)
  )
  await session.undo()
  assert.equal(session.projection().unassignedPieces, '0')
  await session.redo()
  assert.equal(session.projection().unassignedPieces, '3')
  await session.confirm()
  assert.equal(fixture.confirmed.length, 1)
  assert.equal(
    fixture.confirmed[0].draft.contextContainerId,
    'amendment-container'
  )
  assert.equal(fixture.confirmed[0].draft.cartons[0].baseRevision, 1)
  assert.deepEqual(fixture.confirmed[0].expectedRevisions, {
    source: 'source-1',
    cartons: { [fixture.batch.id]: 1 },
  })
  assert.deepEqual(fixture.record.snapshot, before)
  assert.equal(fixture.reads[0].contextContainerId, 'amendment-container')
})

test('invalid entitlement raw facts survive recovery and block confirmation without partial physical writes', async (context) => {
  const fixture = exceptionSessionFixture(),
    session = await fixture.create()
  context.after(() => session.dispose())
  const value = {
    contents: [{ orderId: '1001', entryId: '2001', quantity: 'invalid' }],
    measurements: {},
  }
  session.retainUnitDraft(fixture.batch.id, 2, value)
  await session.flush()
  await assert.rejects(
    session.stageUnitFacts({ batchId: fixture.batch.id, index: 2, ...value }),
    /positive whole/
  )
  await assert.rejects(session.confirm(), /pending carton exception/)
  assert.equal(fixture.confirmed.length, 0)
  assert.equal(
    session.unitDraft(fixture.batch.id, 2).contents[0].quantity,
    'invalid'
  )
  assert.match(JSON.stringify(fixture.drafts.at(-1).draft.rawCells), /invalid/)
  assert.equal(fixture.drafts.at(-1).draft.plannerDraft.cartons.length, 0)
})

test('a delayed unit exception result cannot replace newer raw facts', async (context) => {
  let release
  const wait = new Promise((resolve) => {
      release = resolve
    }),
    fixture = exceptionSessionFixture({
      applyUnitException: async (input) => {
        await wait
        return applyCartonUnitException(input)
      },
    }),
    session = await fixture.create()
  context.after(() => session.dispose())
  const old = session.stageUnitFacts({
    batchId: fixture.batch.id,
    index: 1,
    contents: [{ orderId: '1001', entryId: '2001', quantity: '18' }],
  })
  session.retainUnitDraft(fixture.batch.id, 1, {
    contents: [{ orderId: '1001', entryId: '2001', quantity: 'new raw text' }],
  })
  release()
  await assert.rejects(old, /draft changed/)
  assert.equal(
    session.unitDraft(fixture.batch.id, 1).contents[0].quantity,
    'new raw text'
  )
  assert.equal(fixture.confirmed.length, 0)
  assert.equal(session.projection().unassignedPieces, '0')
})
test('purchase evidence recovery retains invalid work, submits prior disposition guards and never edits source snapshots', async (context) => {
  const { document, window } = dom(context),
    values = new Map(),
    source = syntheticOrder('1001'),
    before = structuredClone(source.snapshot),
    calls = []
  document.body.append(document.createElement('button'))
  document.body.lastElementChild.id = 'packing-settings'
  const globals = {
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    BroadcastChannel: undefined,
  }
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, configurable: true })
    context.after(() =>
      previous
        ? Object.defineProperty(globalThis, key, previous)
        : delete globalThis[key]
    )
  }
  source.inventoryDispositions = {
    2001: {
      kind: 'canceled',
      quantity: '3',
      reason: 'Earlier documented cancellation',
    },
  }
  const repository = {
    listPreparations: async () => [],
    getPackingPreferences: async () => validatePackingPreferences({}),
    getOrderReconciliation: async () => ({
      record: structuredClone(source),
      revisions: {},
    }),
    setInventoryDispositions: async (args) => {
      calls.push(structuredClone(args))
      source.inventoryDispositions['2001'] = args.entries['2001']
      return { record: source }
    },
  }
  const authoring = await createProductAuthoring({
    repository,
    getRecords: () => [source],
  })
  context.after(() => authoring.dispose())
  await authoring.openInventoryRecovery({
    accountId: 'local',
    orderId: '1001',
    entryId: '2001',
  })
  let modal = document.querySelector(
      'dialog[data-action="review-purchase-evidence"]'
    ),
    fields = modal.querySelectorAll('input'),
    reason = modal.querySelector('textarea')
  fields[fields.length - 1].value = 'not whole'
  fields[fields.length - 1].dispatchEvent(new window.Event('input'))
  modal.querySelector('[data-action="save-inventory-disposition"]').click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.length, 0)
  assert.match(
    modal.querySelector('[role="status"]').textContent,
    /positive whole/
  )
  modal.close()
  await authoring.openInventoryRecovery({
    accountId: 'local',
    orderId: '1001',
    entryId: '2001',
  })
  modal = document.querySelector(
    'dialog[data-action="review-purchase-evidence"]'
  )
  assert.equal([...modal.querySelectorAll('input')].at(-1).value, 'not whole')
  const kind = modal.querySelector('select')
  kind.value = 'goods'
  kind.dispatchEvent(new window.Event('change'))
  reason = modal.querySelector('textarea')
  reason.value = 'Retained raw annotation'
  modal.querySelector('[data-action="save-inventory-disposition"]').click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(calls, [
    {
      accountId: 'local',
      orderId: '1001',
      entries: { 2001: null },
      expectedValues: {
        2001: {
          kind: 'canceled',
          quantity: '3',
          reason: 'Earlier documented cancellation',
        },
      },
    },
  ])
  assert.deepEqual(source.snapshot, before)
})
test('all-orders and narrowed carton history share a bounded searchable table and inspect without selecting or mutating', async (context) => {
  const { document, window } = dom(context),
    host = document.getElementById('host'),
    records = [syntheticOrder('1001'), syntheticOrder('1002')],
    batches = Array.from({ length: 140 }, (_, index) =>
      syntheticBatch(index < 70 ? '1001' : '1002', 1, '1', {
        id: `retained-${index}`,
        cartonNumber: String(index + 1),
      })
    ),
    state = { records, batches },
    calls = [],
    repository = {
      async getOperationalState(args) {
        calls.push(args)
        return structuredClone(state)
      },
    },
    history = await mountCartonHistory(host, { repository })
  assert.equal(history.rows().length, 140)
  assert.ok(host.querySelectorAll('[data-history-key]').length <= 100)
  assert.equal(host.querySelector('table').getAttribute('aria-rowcount'), '141')
  const search = host.querySelector('input')
  search.value = 'retained-139'
  search.dispatchEvent(new window.Event('input'))
  // Supplier labels, rather than internal IDs, own the visible filter.
  search.value = '140'
  search.dispatchEvent(new window.Event('input'))
  assert.equal(host.querySelectorAll('[data-history-key]').length, 1)
  host.querySelector('[data-history-key]').click()
  assert.ok(document.querySelector('[data-action="inspect-carton-history"]'))
  assert.equal(document.querySelectorAll('input[type="checkbox"]').length, 0)
  assert.deepEqual(calls, [{}])
  history.destroy()
  const narrowed = await mountCartonHistory(host, {
    repository,
    orderRefs: [{ accountId: 'local', orderId: '1001' }],
  })
  assert.equal(narrowed.rows().length, 70)
  assert.equal(host.querySelector('table').dataset.action, 'carton-history')
  assert.deepEqual(state.batches, batches)
  narrowed.destroy()
})
function view(id = 'c1', revision = 1) {
  return {
    container: { id, name: 'Synthetic October', revision },
    revisionId: `${id}-r${revision}`,
    draft: true,
    orders: [ref, { accountId: 'local', orderId: '20002' }],
    products: [],
    cartons: [{ id: 'box1', batchId: 'batch1', state: 'unconfirmed' }],
    leftBehind: { products: [], cartons: [], unprepared: [], totals: {} },
    totals: {},
    issues: [],
  }
}
function setup() {
  const writes = [],
    intents = []
  let current = view(),
    fail = false,
    reviewWait
  const repository = {
    getContainerView: async ({ id }) =>
      structuredClone({ ...current, container: { ...current.container, id } }),
    getContainerManifest: async () => current,
    reviewContainerSeal: async () => {
      if (reviewWait) await reviewWait
      return {
        ready: true,
        reviewToken: 'review-token',
        issues: [],
        warnings: [],
      }
    },
    reviewContainerAvailability: async () => ({
      before: { revision: 1 },
      after: { revision: 2 },
    }),
  }
  for (const method of [
    'setContainerLoading',
    'markContainerLoaded',
    'includeContainerOrders',
    'removeContainerOrder',
    'cancelContainer',
    'setInterchangeableLoading',
    'applyContainerAvailability',
    'sealContainer',
    'beginContainerAmendment',
    'applyContainerAmendment',
    'cancelContainerAmendment',
  ])
    repository[method] = async (args) => {
      writes.push({ method, args: structuredClone(args) })
      intents.push(args.intentId)
      if (fail) throw new Error('synthetic conflict')
      current = {
        ...current,
        container: {
          ...current.container,
          revision: current.container.revision + 1,
        },
      }
    }
  let count = 0
  const controller = createContainerController({
    repository,
    newIntent: () => `intent-${++count}`,
  })
  return {
    repository,
    controller,
    writes,
    intents,
    setView(value) {
      current = value
    },
    fail(value) {
      fail = value
    },
    holdReview(promise) {
      reviewWait = promise
    },
  }
}

test('mark-all-loaded uses complete included order scope regardless mounted or selected rows', async () => {
  const { controller, writes } = setup()
  await controller.open('c1')
  await controller.markAllLoaded()
  assert.equal(writes[0].method, 'markContainerLoaded')
  assert.deepEqual(writes[0].args.orderRefs, [
    ref,
    { accountId: 'local', orderId: '20002' },
  ])
  assert.equal(writes[0].args.expectedRevision, 1)
})

test('inclusion is whole-order reservation, never an implicit loading mutation', async () => {
  const { controller, writes } = setup()
  await controller.open('c1')
  await controller.includeOrders([ref])
  assert.equal(writes.length, 1)
  assert.equal(writes[0].method, 'includeContainerOrders')
  assert.deepEqual(writes[0].args.orderRefs, [ref])
  assert.equal(Object.hasOwn(writes[0].args, 'decisions'), false)
})

test('actual physical references supply loading decisions with a revision guard', async () => {
  const { controller, writes } = setup()
  await controller.open('c1')
  await controller.setLoading([{ cartonId: 'box1', state: 'left-behind' }])
  assert.deepEqual(writes[0].args.decisions, [
    { cartonId: 'box1', state: 'left-behind' },
  ])
  assert.equal(writes[0].args.id, 'c1')
  assert.ok(writes[0].args.intentId)
})

test('count shortcut refuses uneven or differently measured cartons', async () => {
  const { controller, writes, setView } = setup()
  await controller.open('c1')
  assert.throws(
    () => controller.setInterchangeableLoading('batch1', 1),
    /actual carton references/
  )
  assert.equal(writes.length, 0)
  const next = view()
  next.cartons[0].interchangeable = true
  next.cartons[0].count = 5
  setView(next)
  await controller.open('c1')
  await controller.setInterchangeableLoading('batch1', 1)
  assert.equal(writes[0].method, 'setInterchangeableLoading')
  assert.equal(writes[0].args.leftBehind, 1)
})

test('historical and sealed views contain no loading mutation capability', async () => {
  const { controller, writes, setView } = setup()
  await controller.open('c1', 'historical-r1')
  await assert.rejects(controller.setLoading([]), /draft or amendment/)
  const sealed = view()
  sealed.draft = false
  setView(sealed)
  await controller.open('c1')
  await assert.rejects(controller.markAllLoaded(), /draft or amendment/)
  assert.equal(writes.length, 0)
})

test('failed retry reuses its intent and preserves the current view', async () => {
  const { controller, writes, intents, fail } = setup()
  await controller.open('c1')
  fail(true)
  await assert.rejects(
    controller.setLoading([{ cartonId: 'box1', state: 'loaded' }]),
    /synthetic conflict/
  )
  assert.equal(controller.view().container.revision, 1)
  fail(false)
  await controller.setLoading([{ cartonId: 'box1', state: 'loaded' }])
  assert.equal(writes.length, 2)
  assert.equal(intents[0], intents[1])
})

test('availability is reviewed before explicit apply and never silently refreshes membership', async () => {
  const { controller, writes } = setup()
  await controller.open('c1')
  const plan = await controller.reviewAvailability()
  assert.equal(writes.length, 0)
  await controller.applyAvailability(plan)
  assert.equal(writes[0].method, 'applyContainerAvailability')
  assert.deepEqual(writes[0].args.plan, plan)
})

test('seal requires a current review token and stale reviewed revisions reject', async () => {
  const { controller, writes } = setup()
  await controller.open('c1')
  assert.throws(() => controller.seal(), /Review/)
  await controller.reviewSeal()
  await controller.setLoading([{ cartonId: 'box1', state: 'loaded' }])
  assert.throws(() => controller.seal(), /Review/)
  await controller.reviewSeal()
  await controller.seal()
  assert.equal(writes.at(-1).method, 'sealContainer')
  assert.equal(writes.at(-1).args.reviewToken, 'review-token')
})

test('a late read for one container cannot replace the newer route', async () => {
  let release
  const repository = {
    getContainerView: async ({ id }) => {
      if (id === 'old')
        await new Promise((resolve) => {
          release = resolve
        })
      return view(id)
    },
  }
  const controller = createContainerController({ repository })
  const old = controller.open('old')
  await controller.open('new')
  release()
  assert.equal(await old, false)
  assert.equal(controller.view().container.id, 'new')
})

test('immutable manifest capture retains all rows and historical values despite live mutations', () => {
  const manifest = view()
  manifest.products = [
    {
      ...ref,
      entryId: 'e1',
      quantity: '20',
      purchased: '100',
      price: '2.15',
      barcode: 'CE26090101A',
      baseCode: 'CE26090101',
      spanishName: 'SYNTHETIC A',
      chineseCategory: '合成品',
    },
    {
      ...ref,
      entryId: 'e2',
      quantity: '72',
      price: '3.10',
      barcode: 'CE26090102A',
      baseCode: 'CE26090102',
      spanishName: 'SYNTHETIC B',
      chineseCategory: '合成品',
    },
  ]
  const captured = captureContainerOutput(manifest)
  manifest.products[0].spanishName = 'CHANGED'
  manifest.products.length = 1
  assert.equal(captured.products.length, 2)
  assert.equal(captured.products[0].spanishName, 'SYNTHETIC A')
  assert.equal(captured.products[0].quantity, '20')
  assert.equal(captured.products[0].purchased, '100')
  assert.throws(() => {
    captured.products[0].price = '999'
  }, TypeError)
})

test('shared-code labels retain separate source refs and exact source-line quantities', () => {
  const manifest = view()
  manifest.products = [
    {
      ...ref,
      entryId: 'a',
      quantity: '20',
      barcode: 'CE26090101A',
      spanishName: 'SYNTHETIC',
      baseCode: 'CE26090101',
      chineseCategory: '合成',
    },
    {
      accountId: 'local',
      orderId: '20002',
      entryId: 'b',
      quantity: '72',
      barcode: 'CE26090101A',
      spanishName: 'SYNTHETIC',
      baseCode: 'CE26090101',
      chineseCategory: '合成',
    },
  ]
  const labels = outputLabelModels(captureContainerOutput(manifest))
  assert.equal(labels.length, 1)
  assert.equal(labels[0].quantity, '92')
  assert.equal(labels[0].refs.length, 2)
  assert.equal(labels[0].refs[0].revisionId, 'c1-r1')
})

test('active shell removes obsolete workflow actions and Packing authoring dependencies', () => {
  const shell = readFileSync(
      new URL('../src/packing-workspace.js', import.meta.url),
      'utf8'
    ),
    html = readFileSync(
      new URL('../src/library.html', import.meta.url),
      'utf8'
    ),
    container = readFileSync(
      new URL('../src/container-workspace.js', import.meta.url),
      'utf8'
    )
  for (const obsolete of [
    'prepare-packing-list',
    'packing-month',
    'organize-packing',
    'open-grouping-menu',
    'preparation-content',
  ])
    assert.equal(html.includes(obsolete), false, obsolete)
  for (const obsolete of [
    'packing-organize.js',
    'packing-reorder.js',
    'preparation-removal.js',
    'openCartonBatchEditor',
    'planSelectedPreparations',
  ])
    assert.equal(shell.includes(obsolete), false, obsolete)
  for (const writable of [
    'savePreparations',
    'setUnitsPerCarton',
    'setProductPhoto',
    'mountLabelEditor',
    'setProductTags',
  ])
    assert.equal(container.includes(writable), false, writable)
})

test('read-only Packing details discard supplied mutation callbacks and keep explicit Orders navigation', async (context) => {
  const { document } = dom(context)
  let mutations = 0,
    edits = 0
  const details = openProductDetails(
    {
      entryId: 'e1',
      description: '原始 source text',
      price: '2.15',
      quantity: '20',
    },
    {
      mode: 'read-only',
      tags: { selected: ['Synthetic tag'], save: () => mutations++ },
      carton: {
        summary: 'A20+B72',
        openBatches: () => mutations++,
        onSave: () => mutations++,
      },
      onOperations: () => mutations++,
      onOrder: () => mutations++,
      onEditInOrders: () => edits++,
      loadPhoto: async () => '',
    }
  )
  assert.equal(details.dialog.dataset.mode, 'read-only')
  assert.equal(
    details.dialog.querySelectorAll('input,textarea,select').length,
    0
  )
  assert.equal(details.dialog.textContent.includes('原始 source text'), true)
  assert.equal(
    [...details.dialog.querySelectorAll('button')].some(
      (button) => button.textContent === 'Edit cartons'
    ),
    false
  )
  assert.equal(
    [...details.dialog.querySelectorAll('button')].some(
      (button) => button.textContent === 'Operations'
    ),
    false
  )
  details.dialog.querySelector('[data-action="edit-in-orders"]').click()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(edits, 1)
  assert.equal(mutations, 0)
  assert.equal(document.querySelector('.product-details-dialog'), null)
})

test('virtual grid inspection and explicit checkbox selection stay independent; IME retains one editor', async (context) => {
  let mounted
  context.after(() => mounted?.destroy())
  const { document, window } = dom(context),
    rows = Array.from({ length: 140 }, (_, index) => ({
      key: `row-${index}`,
      code: `CODE-${index}`,
      purchased: '100',
      available: '100',
      capacity: '45',
      proposedCount: 2,
      unassigned: '10',
      pattern: '2 × 45',
    })),
    edits = [],
    raw = new Map()
  let inspected = 0,
    generation = 0
  const session = {
    orderRef: ref,
    state: () => ({ generation, canUndo: edits.length > 0, canRedo: false }),
    projection: () => ({
      products: rows,
      cartons: [],
      summary: { proposedCount: 280, unassignedPieces: '1400' },
    }),
    dirtyKeys: () => [],
    rawCell: (key, column) =>
      raw.get(`${key}/${column}`) ??
      rows.find((row) => row.key === key)?.[column],
    editCell: (key, column, value) => {
      raw.set(`${key}/${column}`, value)
      edits.push({ key, column, value })
      generation++
    },
    flush: async () => {},
    subscribe: () => () => {},
    cancelParse() {},
    changeView() {},
    undo() {},
    redo() {},
    confirm() {},
  }
  mounted = mountOrderCartonGrid(document.querySelector('#host'), {
    session,
    onInspect: () => inspected++,
  })
  // Model the browser's scrolling body offset; linkedom has no layout engine.
  const scroller = document.querySelector('.smart-grid-scroll')
  document.querySelector('tbody').getBoundingClientRect = () => ({
    top: -scroller.scrollTop,
  })
  assert.equal(
    document.querySelectorAll('tbody > tr[data-grid-key]').length,
    100
  )
  const first = document.querySelector('tr[data-grid-key="row-0"]'),
    check = first.querySelector('input[type="checkbox"]')
  first.dispatchEvent(new window.Event('click', { bubbles: true }))
  assert.equal(inspected, 1)
  assert.equal(check.checked, false)
  check.checked = true
  check.dispatchEvent(new window.Event('change', { bubbles: true }))
  assert.equal(inspected, 1)
  assert.equal(first.getAttribute('aria-selected'), 'true')
  const input = first.querySelector('[data-grid-column="capacity"]')
  input.oncompositionstart()
  input.value = '未完成'
  input.oninput()
  assert.equal(edits.length, 0)
  input.value = '50'
  input.oncompositionend()
  assert.equal(edits.length, 1)
  assert.deepEqual(edits[0], { key: 'row-0', column: 'capacity', value: '50' })
  assert.equal(first.querySelector('[data-grid-column="capacity"]'), input)
  let prevented = false
  input.onkeydown({
    key: 'Enter',
    isComposing: true,
    preventDefault() {
      prevented = true
    },
  })
  assert.equal(prevented, false)
  const last = document.querySelector(
    'tr[data-grid-key="row-99"] [data-grid-column="capacity"]'
  )
  last.onkeydown({
    key: 'Tab',
    isComposing: false,
    preventDefault() {
      prevented = true
    },
  })
  assert.equal(prevented, true)
  assert.ok(document.querySelector('tr[data-grid-key="row-100"]'))
})

function reportFixture() {
  const calls = [],
    assets = new Map(),
    context = {
      ...ref,
      sourceRevision: 1,
      preparationRevision: 2,
      expectedRevisions: { source: 1, preparation: 2 },
      products: [
        {
          entryId: 'e1',
          groupId: 'g1',
          purchased: '13',
          ceCodes: ['CE26090101'],
        },
      ],
      previousReports: [],
      batches: [],
    }
  let holdParse, releaseParse, holdCommit, releaseCommit
  const repository = {
    getPackingReportContext: async () => structuredClone(context),
    savePackingReportSource: async (input) => {
      calls.push({ operation: 'save-source', input: structuredClone(input) })
      assets.set('asset-1', structuredClone(input))
      return {
        sourceId: 'source-1',
        rawAssetRef: 'asset-1',
        rawDigest: 'digest-1',
        kind: input.kind,
      }
    },
    getPackingReportSource: async () => assets.get('asset-1'),
    commitPackingReportUpdate: async (input) => {
      calls.push({ operation: 'commit', input: structuredClone(input) })
      if (holdCommit)
        await new Promise((resolve) => {
          releaseCommit = resolve
        })
      return { revision: 3 }
    },
  }
  const createClient = () => ({
    cancel() {},
    async run({ operation, input }) {
      calls.push({ operation, input: structuredClone(input) })
      if (operation === 'parse' && holdParse)
        await new Promise((resolve) => {
          releaseParse = resolve
        })
      const result =
        operation === 'parse'
          ? { sourceId: input.sourceId, rawAssetRef: input.rawAssetRef }
          : operation === 'analyze'
            ? {
                analysisId: 'analysis-1',
                input: { source: input.source, context: input.context },
                candidates: [{ candidateKey: 'row1' }],
                decisionRequests: [],
                issues: [],
              }
            : operation === 'validate'
              ? {
                  valid: true,
                  issues: [],
                  interpretedReport: { candidates: [{ candidateKey: 'row1' }] },
                }
              : {
                  status: 'ready',
                  expectedRevisions: context.expectedRevisions,
                  commitPayload: { report: { id: 'source-1' } },
                }
      return { generation: 1, result }
    },
  })
  return {
    calls,
    repository,
    createClient,
    holdParse() {
      holdParse = true
    },
    releaseParse() {
      releaseParse()
    },
    holdCommit() {
      holdCommit = true
    },
    releaseCommit() {
      releaseCommit()
    },
  }
}

test('report UI persists original source before parser transfer and commits only a ready explicit review', async () => {
  const fixture = reportFixture(),
    controller = await createPackingReportIntakeController({
      ...fixture,
      orderRef: ref,
    })
  const text = '箱号\t货号\t装箱数\r\n001\t0007\t13\r\n'
  await controller.read({ text })
  assert.equal(fixture.calls[0].operation, 'save-source')
  assert.equal(fixture.calls[0].input.text, text)
  assert.equal(fixture.calls[1].operation, 'parse')
  assert.equal(
    fixture.calls.some((call) => call.operation === 'commit'),
    false
  )
  await controller.plan()
  await controller.commit()
  const commit = fixture.calls.find((call) => call.operation === 'commit')
  assert.deepEqual(commit.input.expectedRevisions, {
    source: 1,
    preparation: 2,
  })
  assert.equal(commit.input.orderId, ref.orderId)
  assert.ok(commit.input.intentId)
  controller.dispose()
})

test('report decisions retain exact scoped premises and unknown mappings cannot become a hidden commit', async () => {
  const fixture = reportFixture(),
    controller = await createPackingReportIntakeController({
      ...fixture,
      orderRef: ref,
    })
  assert.throws(() => controller.commit(), /Resolve the report review/)
  await controller.read({ text: 'source\tvalues' })
  const request = { id: 'alias-1', scope: { code: '0007', orderKey: ref } }
  controller.choose(request, { entryIds: ['e1'], ...ref })
  await controller.updateReview()
  const analysis = fixture.calls
    .filter((call) => call.operation === 'analyze')
    .at(-1)
  assert.deepEqual(analysis.input.decisions['alias-1'], {
    scope: request.scope,
    value: { entryIds: ['e1'], ...ref },
  })
  assert.equal(
    fixture.calls.some((call) => call.operation === 'commit'),
    false
  )
  controller.dispose()
})

test('late report parsing cannot replace newly edited source text', async () => {
  const fixture = reportFixture()
  fixture.holdParse()
  const controller = await createPackingReportIntakeController({
      ...fixture,
      orderRef: ref,
    }),
    reading = controller.read({ text: 'old\ttext' })
  while (!fixture.calls.some((call) => call.operation === 'parse'))
    await Promise.resolve()
  controller.inputText('new\ttext')
  fixture.releaseParse()
  await assert.rejects(reading, { name: 'AbortError' })
  assert.equal(controller.state().text, 'new\ttext')
  assert.equal(controller.state().analysis, null)
  assert.equal(controller.state().source, null)
  controller.dispose()
})

test('double-clicked report commit is one in-flight repository intent', async () => {
  const fixture = reportFixture(),
    controller = await createPackingReportIntakeController({
      ...fixture,
      orderRef: ref,
    })
  await controller.read({ text: 'source\tvalues' })
  await controller.plan()
  fixture.holdCommit()
  const first = controller.commit(),
    second = controller.commit()
  fixture.releaseCommit()
  await Promise.all([first, second])
  assert.equal(
    fixture.calls.filter((call) => call.operation === 'commit').length,
    1
  )
  controller.dispose()
})

test('zero-loaded container export keeps full-revision scope, three sheets and fresh default-off JSON', async (context) => {
  const { document } = dom(context),
    manifest = captureContainerOutput(view()),
    sheet = { palette: {}, columns: [], rows: [], products: [] }
  const opening = openPackingExportDialog({
    context: manifest,
    getRows: () => [],
    getCartonBatches: () => [],
    planWorkbook: () => ({ sheets: [sheet, sheet, sheet] }),
    onExport: async () => {},
  })
  const dialog = document.querySelector('.packing-export-dialog')
  assert.ok(dialog)
  assert.equal(
    dialog.querySelector('[data-action="download-packing-list"]').disabled,
    false
  )
  assert.equal(dialog.querySelectorAll('[data-option="scope"]').length, 0)
  assert.equal(
    dialog.querySelector('input[name="includeAutomationJson"]').checked,
    false
  )
  assert.equal(
    dialog.querySelectorAll('.packing-export-sheet-tabs input').length,
    3
  )
  ;[...dialog.querySelectorAll('button')]
    .find((button) => button.getAttribute('aria-label') === 'Close export')
    .click()
  assert.equal(await opening, false)
})

test('interchangeable count control uses complete logical set size once and is absent from sealed history', async (context) => {
  let workspace
  context.after(() => workspace?.dispose())
  const { document } = dom(context),
    fixture = setup(),
    draft = view()
  draft.cartons = Array.from({ length: 5 }, (_, index) => ({
    id: `unit-${index}`,
    batchId: 'batch1',
    accountId: 'local',
    orderId: '10001',
    count: 1,
    state: 'unconfirmed',
    canSelectCount: index === 0,
    contents: [],
  }))
  fixture.setView(draft)
  workspace = createContainerWorkspace({
    host: document.querySelector('#host'),
    repository: fixture.repository,
    output: {},
    inspectProduct() {},
    editInOrders() {},
  })
  await workspace.open('c1')
  document
    .querySelector('.container-order [data-action="expand-container-order"]')
    .click()
  await Promise.resolve()
  await Promise.resolve()
  const counts = document.querySelectorAll(
    '.container-main input[type="number"]'
  )
  assert.equal(counts.length, 1)
  assert.equal(counts[0].max, '5')
  assert.equal(counts[0].getAttribute('aria-label'), 'Left behind out of 5')
  draft.draft = false
  fixture.setView(draft)
  await workspace.open('c1', 'sealed-r1')
  document
    .querySelector('.container-order [data-action="expand-container-order"]')
    .click()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(
    document.querySelectorAll('.container-main input[type="number"]').length,
    0
  )
})
