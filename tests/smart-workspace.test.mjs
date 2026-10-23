import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createContainerController,
  createContainerWorkspace,
  mountBacklog,
} from '../src/container-workspace.js'
import {
  captureContainerOutput,
  outputLabelModels,
  createProductOutput,
} from '../src/product-output.js'
import { parseHTML } from 'linkedom'
import { openProductDetails } from '../src/product-details.js'
import { openPackingExportDialog } from '../src/packing-export-dialog.js'
import { createProductAuthoring } from '../src/product-authoring.js'
import { getLanguage, setLanguage } from '../src/i18n.js'
import { validatePackingPreferences } from '../src/packing-model.js'
import {
  mountOrderCartonGrid,
  createPackingReportIntakeController,
  cartonHistoryRows,
  mountCartonHistory,
  createOrderCartonSession,
  openLegacyCartonReview,
  captureGridTarget,
  PRODUCT_GRID_COLUMNS,
  mountPhysicalMarkChoices,
  openPhysicalMarkReview,
} from '../src/order-carton-grid.js'
import * as actualPlanner from '../src/carton-reconciliation.js'
import { applyCartonUnitException } from '../src/carton-batches.js'
import {
  transitionPhysicalMark,
  retainCartonEvidence,
  physicalMarkReadback,
} from '../src/physical-mark-aliases.js'
import {
  syntheticOrder,
  syntheticBatch,
  syntheticManifest,
} from './fixtures/container-fixture.mjs'

test('physical mark choices require each explicit decision, reason and fresh relabel attestation while retaining IME and live language input', (context) => {
  const { document, window } = dom(context),
    host = document.getElementById('host'),
    apply = document.createElement('button'),
    reviews = [
      {
        id: 'carton-1',
        resolutionRequired: true,
        physicalMarkCode: 'CE26090102',
        currentProductCode: 'CE26090101',
      },
    ],
    original = structuredClone(reviews),
    updates = [],
    previous = getLanguage()
  context.after(() => setLanguage(previous, { persist: false }))
  setLanguage('en', { persist: false })
  const stop = mountPhysicalMarkChoices({
      host,
      apply,
      reviews,
      onChange: (value) => updates.push(value),
    }),
    card = host.querySelector('[data-batch-id="carton-1"]'),
    keep = card.querySelector('[data-choice="keep-recorded-mark"]'),
    relabel = card.querySelector('[data-choice="relabel-reprint"]'),
    reason = card.querySelector('textarea'),
    attestation = card.querySelector('input[type="checkbox"]')
  assert.equal(apply.disabled, true)
  assert.equal(keep.name, relabel.name)
  assert.match(card.textContent, /CE26090102/)
  assert.match(card.textContent, /CE26090101/)
  keep.checked = true
  keep.dispatchEvent(new window.Event('change'))
  assert.equal(apply.disabled, true)
  reason.value = 'Confirmed old mark remains on these cartons'
  reason.dispatchEvent(new window.Event('input'))
  assert.equal(apply.disabled, false)
  assert.deepEqual(updates.at(-1).decisions, [
    {
      batchId: 'carton-1',
      choice: 'keep-recorded-mark',
      reason: reason.value,
      physicalRelabelConfirmed: false,
    },
  ])
  reason.dispatchEvent(new window.Event('compositionstart'))
  assert.equal(apply.disabled, true)
  reason.dispatchEvent(new window.Event('compositionend'))
  assert.equal(apply.disabled, false)
  relabel.checked = true
  relabel.dispatchEvent(new window.Event('change'))
  assert.equal(keep.checked, false)
  assert.equal(apply.disabled, true)
  attestation.checked = true
  attestation.dispatchEvent(new window.Event('change'))
  assert.equal(apply.disabled, false)
  setLanguage('es', { persist: false })
  assert.match(card.textContent, /marca física registrada/)
  assert.equal(card.querySelector('textarea'), reason)
  assert.equal(reason.value, 'Confirmed old mark remains on these cartons')
  setLanguage('zh', { persist: false })
  assert.match(card.textContent, /实体箱唛/)
  keep.checked = true
  keep.dispatchEvent(new window.Event('change'))
  relabel.checked = true
  relabel.dispatchEvent(new window.Event('change'))
  assert.equal(attestation.checked, false)
  assert.equal(apply.disabled, true)
  assert.deepEqual(reviews, original)
  stop()
  assert.equal(host.querySelector('.physical-mark-choices'), null)
})

test('a missing physical mark owner requires an explicit actual owner option without guessing from contents', (context) => {
  const { document, window } = dom(context),
    host = document.getElementById('host'),
    apply = document.createElement('button'),
    updates = [],
    targetMark = { orderId: '1001', groupId: 'explicit-owner' },
    reviews = [
      {
        id: 'physical',
        resolutionRequired: true,
        physicalMarkCode: 'CE26090102',
        currentProductCode: '',
        physicalMarkOwnerChoices: [
          {
            mark: targetMark,
            productCode: 'CE26090101',
            artwork: { spanishName: 'CURRENT PRODUCT' },
          },
        ],
      },
    ]
  const stop = mountPhysicalMarkChoices({
      host,
      apply,
      reviews,
      onChange: (value) => updates.push(value),
    }),
    owner = host.querySelector('[data-action="choose-physical-mark-owner"]'),
    keep = host.querySelector('[data-choice="keep-recorded-mark"]'),
    reason = host.querySelector('textarea')
  assert.equal(owner.value, '')
  keep.checked = true
  keep.dispatchEvent(new window.Event('change'))
  reason.value = 'Explicitly reviewed actual owner'
  reason.dispatchEvent(new window.Event('input'))
  assert.equal(apply.disabled, true)
  owner.value = JSON.stringify(targetMark)
  owner.dispatchEvent(new window.Event('change'))
  assert.equal(apply.disabled, false)
  assert.deepEqual(updates.at(-1).decisions[0].targetMark, targetMark)
  owner.value = JSON.stringify({ orderId: '1001', groupId: 'guessed-owner' })
  owner.dispatchEvent(new window.Event('change'))
  assert.equal(apply.disabled, true)
  assert.equal(updates.at(-1).decisions[0].targetMark, undefined)
  stop()
})

test('physical mark output uses recorded artwork after its group is gone, counts actual entitlements and rejects stale typed regeneration', async () => {
  const { record, preparation } = syntheticManifest().orders[0],
    group = preparation.groups[0],
    target = structuredClone(group)
  Object.assign(target, {
    id: 'existing-print-target',
    baseCode: 'CE26090103',
    category: '新杯',
    spanishName: 'EXISTING TARGET',
  })
  target.variants[0].id = 'existing-print-variant'
  target.variants[0].entryIds = ['2002']
  preparation.groups.push(target)
  record.snapshot.items.push({
    ...structuredClone(record.snapshot.items[0]),
    entryId: '2002',
  })
  Object.assign(record.snapshot.totals, {
    goodsGross: '2000.00',
    goodsNet: '2000.00',
    payable: '2000.00',
  })
  const artwork = {
      code: 'CE26090102',
      baseCode: 'CE26090102',
      title: 'Original carton',
      spanishName: 'CAJA ORIGINAL',
      category: '旧杯',
      chineseCategory: '旧杯',
      orderId: '1001',
      groupId: 'retired-owner',
      provenance: 'recorded-owner-text',
    },
    batch = syntheticBatch('1001', 2, '100', {
      groups: [{ orderId: '1001', groupId: group.id }],
      mark: { orderId: '1001', groupId: group.id },
      physicalMark: {
        code: 'CE26090102',
        originalCode: 'CE26090102',
        originalMark: { orderId: '1001', groupId: 'retired-owner' },
        productCode: group.baseCode,
        aliases: [
          {
            code: 'CE26090102',
            month: '2026-09',
            sellerId: 'synthetic-factory',
          },
        ],
        relatedEntryIds: ['2001'],
        resolution: {
          choice: 'keep-recorded-mark',
          reason: 'Retain actual original label',
          physicalRelabelConfirmed: false,
          provenance: 'manual-confirmed',
          resolvedAt: '2026-10-22T00:00:00.000Z',
        },
        originalArtwork: artwork,
        artwork,
        history: [],
      },
    }),
    context = {
      record,
      preparation,
      batches: [batch],
      reports: [],
      revisions: {
        source: 'captured-source',
        observedAt: record.snapshot.observedAt,
        preparation: preparation.revision,
        cartons: { [batch.id]: batch.revision },
        reports: {},
      },
    },
    original = structuredClone({ record, preparation }),
    output = createProductOutput({
      repository: {
        getOrderReconciliation: async () => structuredClone(context),
        getPackingPreferences: async () => validatePackingPreferences({}),
      },
      authoring: { flush: async () => {} },
    }),
    ref = { accountId: 'local', orderId: '1001', batchId: batch.id }
  const recorded = await output.orderCartonContext({
      ...ref,
      role: 'recorded',
    }),
    oldModel = outputLabelModels(recorded, 'mark')[0]
  assert.equal(oldModel.code, 'CE26090102')
  assert.equal(oldModel.model.category, '旧杯')
  assert.equal(oldModel.name, 'CAJA ORIGINAL')
  assert.equal(oldModel.quantity, '2')
  assert.equal(oldModel.known, 2)
  assert.deepEqual(
    oldModel.refs.map((ref) => ref.index),
    [0, 1]
  )
  assert.ok(
    oldModel.refs.every(
      (ref) =>
        ref.scope === 'order-carton-mark' &&
        ref.markRole === 'recorded' &&
        ref.groupId === undefined &&
        /^[a-f0-9]{64}$/.test(ref.sourceGuard)
    )
  )
  const current = await output.orderCartonContext({
      ...ref,
      role: 'current-product',
    }),
    newModel = outputLabelModels(current, 'mark')[0]
  assert.equal(newModel.code, group.baseCode)
  assert.equal(newModel.model.category, group.category)
  const explicit = await output.orderCartonContext({
      ...ref,
      role: 'current-product',
      productGroupId: target.id,
    }),
    targetModel = outputLabelModels(explicit, 'mark')[0]
  assert.equal(targetModel.code, target.baseCode)
  assert.equal(targetModel.model.category, target.category)
  assert.equal(explicit.products[0].entryId, '2002')
  assert.ok(
    targetModel.refs.every(
      (ref) => ref.productGroupId === target.id && ref.code === target.baseCode
    )
  )
  await assert.rejects(
    output.orderCartonContext({
      ...ref,
      role: 'current-product',
      productGroupId: 'unissued-proposed-group',
    }),
    /recorded carton mark evidence|captured carton mark changed/
  )
  assert.equal(batch.physicalMark.code, 'CE26090102')
  assert.deepEqual({ record, preparation }, original)
  batch.revision++
  context.revisions.cartons[batch.id] = batch.revision
  await assert.rejects(
    output.orderCartonContext(oldModel.refs[0]),
    /captured carton mark changed/
  )
  assert.deepEqual({ record, preparation }, original)
})

test('saved physical mark resolution uses the complete captured token and keeps committed refresh retries read-only', async (context) => {
  const { document, window } = dom(context),
    source = syntheticOrder('1001'),
    token = {
      source: 'original-source',
      preparation: 3,
      cartons: { physical: 7 },
      reports: {},
      amendmentContext: { containerId: 'c1', epoch: 'captured' },
    },
    batch = syntheticBatch('1001', 2, '100', {
      id: 'physical',
      physicalMark: {
        code: 'CE26090102',
        productCode: 'CE26090101',
        resolution: null,
      },
    }),
    original = structuredClone(source),
    calls = []
  let failRefresh = true
  const modal = await openPhysicalMarkReview({
    repository: {
      getOrderReconciliation: async () => ({
        record: source,
        batches: [batch],
        revisions: structuredClone(token),
        amendmentContext: token.amendmentContext,
      }),
      resolveCartonPhysicalMark: async (args) => {
        calls.push(structuredClone(args))
        return {
          record: source,
          batches: [batch],
          revisions: { ...token, cartons: { physical: 8 } },
        }
      },
    },
    orderRef: { accountId: 'local', orderId: '1001' },
    batchId: 'physical',
    contextContainerId: 'c1',
    onSaved: async () => {
      if (failRefresh) throw new Error('Synthetic read refresh failed')
    },
  })
  const keep = modal.querySelector('[data-choice="keep-recorded-mark"]'),
    reason = modal.querySelector('textarea'),
    save = modal.querySelector('[data-action="save-physical-mark-decision"]')
  assert.equal(
    modal.querySelector('[data-choice="relabel-reprint"]').disabled,
    true
  )
  assert.match(
    modal.textContent,
    /Relabeling must be confirmed on unsealed cartons/
  )
  assert.equal(save.disabled, true)
  keep.checked = true
  keep.dispatchEvent(new window.Event('change'))
  reason.value = 'Retain the verified printed code'
  reason.dispatchEvent(new window.Event('input'))
  save.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].expectedRevisions, token)
  assert.deepEqual(calls[0].expectedAmendment, token.amendmentContext)
  assert.equal(calls[0].contextContainerId, 'c1')
  assert.equal(calls[0].choice, 'keep-recorded-mark')
  assert.equal(calls[0].physicalRelabelConfirmed, false)
  assert.ok(calls[0].operationId)
  assert.equal(save.hidden, true)
  assert.match(modal.textContent, /Synthetic read refresh failed/)
  failRefresh = false
  modal.querySelector('[data-action="retry-physical-mark-refresh"]').click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.length, 1)
  assert.equal(
    document.querySelector('[data-action="review-physical-mark"]'),
    null
  )
  assert.deepEqual(source, original)
})

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

test('legacy loaded evidence stays held until a reason and explicit not-shipped attestation are confirmed', async (context) => {
  const { document, window } = dom(context),
    record = syntheticOrder('1001'),
    original = syntheticBatch('1001', 5, '100', { loaded: 2 }),
    calls = []
  let batch = structuredClone(original)
  const repository = {
    async getOperationalState() {
      return { records: [record], batches: [structuredClone(batch)] }
    },
    async reviewLegacyCarton() {
      return {
        batch: structuredClone(batch),
        orderContexts: [{ accountId: 'local', orderId: '1001', record }],
        expectedOrderRevisions: {
          '["local","1001"]': { source: 'original-source' },
        },
      }
    },
    async resolveLegacyCarton(args) {
      calls.push(args)
      batch = {
        ...batch,
        legacyResolution: { resolution: args.resolution, reason: args.reason },
      }
      return batch
    },
  }
  const history = await mountCartonHistory(document.getElementById('host'), {
    repository,
  })
  assert.equal(history.rows()[0].state, 'Needs review')
  document.querySelector('[data-history-key]').click()
  document.querySelector('[data-action="review-legacy-carton"]').click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const modal = document.querySelector('[data-action="legacy-carton-review"]'),
    save = modal.querySelector('[data-action="resolve-legacy-carton"]')
  save.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.length, 0)
  assert.match(
    modal.querySelector('[role="status"]').textContent,
    /document a reason/
  )
  modal.querySelector('textarea').value =
    'Synthetic evidence reviewed; goods never left warehouse'
  modal.querySelector('textarea').dispatchEvent(new window.Event('input'))
  modal.querySelector('input[type="checkbox"]').checked = true
  modal.querySelector('select').value = 'not-shipped'
  modal.querySelector('select').dispatchEvent(new window.Event('change'))
  save.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].resolution, 'not-shipped')
  assert.equal(calls[0].batchId, original.id)
  assert.equal(calls[0].expectedRevision, original.revision)
  assert.equal(calls[0].attestNotShipped, true)
  assert.equal(batch.loaded, 2)
  assert.deepEqual(batch.contents, original.contents)
  assert.equal(history.rows()[0].state, 'Confirmed facts')
  modal.close()
  history.destroy()
})

test('cross-order legacy owner correction sends supported contents for one explicitly chosen purchase and preserves original evidence', async (context) => {
  const { document, window } = dom(context),
    original = syntheticBatch('1001', 2, '30', {
      orderId: undefined,
      contents: [
        { orderId: '1001', entryId: '2001', quantity: '20' },
        { orderId: '1002', entryId: '2001', quantity: '10' },
      ],
      weight: '7.25',
      weightBasis: 'batch',
    }),
    before = structuredClone(original),
    writes = [],
    contexts = ['1001', '1002'].map((orderId) => ({
      accountId: 'local',
      orderId,
      record: syntheticOrder(orderId),
    }))
  const modal = await openLegacyCartonReview({
    repository: {
      async reviewLegacyCarton() {
        return {
          batch: original,
          orderContexts: contexts,
          expectedOrderRevisions: { a: { source: 'a' }, b: { source: 'b' } },
        }
      },
      async resolveLegacyCarton(args) {
        writes.push(args)
      },
    },
    batch: original,
  })
  const selects = modal.querySelectorAll('select')
  selects[0].value = 'owner-corrected'
  selects[0].dispatchEvent(new window.Event('change'))
  selects[1].value = JSON.stringify(['local', '1002'])
  selects[1].dispatchEvent(new window.Event('change'))
  assert.equal(modal.querySelector('[data-legacy-entry-id="2001"]').value, '10')
  modal.querySelector('textarea').value =
    'Reviewed original supplier evidence establishes actual owner'
  modal.querySelector('input[type="checkbox"]').checked = true
  modal.querySelector('[data-action="resolve-legacy-carton"]').click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].ownerRef, { accountId: 'local', orderId: '1002' })
  assert.deepEqual(writes[0].contents, [
    { orderId: '1002', entryId: '2001', quantity: '10' },
  ])
  assert.deepEqual(writes[0].expectedOrderRevisions, {
    a: { source: 'a' },
    b: { source: 'b' },
  })
  assert.equal(writes[0].resolution, 'owner-corrected')
  assert.equal(writes[0].batchId, original.id)
  assert.equal(writes[0].attestNotShipped, true)
  assert.equal(writes[0].attestRepacked, undefined)
  assert.deepEqual(original, before)
})

test('cross-order repack retirement requires actual physical repack attestation and never supplies automatic replacement cartons', async (context) => {
  const { window } = dom(context),
    original = syntheticBatch('1001', 2, '30'),
    writes = [],
    contexts = ['1001', '1002'].map((orderId) => ({
      accountId: 'local',
      orderId,
      record: syntheticOrder(orderId),
    })),
    modal = await openLegacyCartonReview({
      repository: {
        async reviewLegacyCarton() {
          return {
            batch: original,
            orderContexts: contexts,
            expectedOrderRevisions: {},
          }
        },
        async resolveLegacyCarton(args) {
          writes.push(args)
        },
      },
      batch: original,
    })
  modal.querySelector('select').value = 'retired-after-repack'
  modal.querySelector('select').dispatchEvent(new window.Event('change'))
  modal.querySelector('textarea').value =
    'Two original sources physically repacked after review'
  const checks = modal.querySelectorAll('input[type="checkbox"]')
  checks[0].checked = true
  modal.querySelector('[data-action="resolve-legacy-carton"]').click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(writes.length, 0)
  assert.match(
    modal.querySelector('[role="status"]').textContent,
    /already happened/
  )
  checks[1].checked = true
  modal.querySelector('[data-action="resolve-legacy-carton"]').click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(writes.length, 1)
  assert.equal(writes[0].resolution, 'retired-after-repack')
  assert.equal(writes[0].attestNotShipped, true)
  assert.equal(writes[0].attestRepacked, true)
  assert.equal(writes[0].contents, undefined)
  assert.equal(writes[0].ownerRef, undefined)
  assert.equal(writes[0].replacementCartons, undefined)
  assert.equal(modal.querySelectorAll('button').length, 3)
  modal.close()
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
    MutationObserver: window.MutationObserver,
    CSS: { supports: () => false },
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
  const matches = window.HTMLElement.prototype.matches
  window.HTMLElement.prototype.matches = function (selector) {
    return selector === ':popover-open' ? false : matches.call(this, selector)
  }
  context.after(() => {
    window.HTMLElement.prototype.matches = matches
  })
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
function authoringEnvironment(context) {
  const environment = dom(context),
    values = new Map()
  const canvasContext =
    environment.window.HTMLCanvasElement.prototype.getContext
  environment.window.HTMLCanvasElement.prototype.getContext = () => ({
    measureText: (value) => ({ width: String(value).length * 7 }),
  })
  context.after(() => {
    environment.window.HTMLCanvasElement.prototype.getContext = canvasContext
  })
  const settings = environment.document.createElement('button')
  settings.id = 'packing-settings'
  environment.document.body.append(settings)
  for (const [key, value] of Object.entries({
    getComputedStyle: () => ({
      fontWeight: '400',
      fontSize: '14px',
      fontFamily: 'sans-serif',
    }),
    BroadcastChannel: undefined,
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, configurable: true })
    context.after(() =>
      previous
        ? Object.defineProperty(globalThis, key, previous)
        : delete globalThis[key]
    )
  }
  return { ...environment, values }
}

test('Orders authoring isolates staged amendment saves, recovery and Undo from effective source preparation', async (context) => {
  const { document, window } = authoringEnvironment(context),
    manifest = syntheticManifest(),
    record = manifest.orders[0].record,
    original = { ...manifest.orders[0].preparation, revision: 1 },
    writes = []
  let active = 'c1'
  const effective = structuredClone(original),
    staged = structuredClone({ ...original, revision: 7 })
  staged.groups[0].variants[0].spanishName = 'AMEND BEFORE'
  const saved = { normal: effective, c1: staged },
    repository = {
      async listPreparations(options = {}) {
        return [structuredClone(saved[options.contextContainerId || 'normal'])]
      },
      async getPackingPreferences() {
        return validatePackingPreferences({})
      },
      async savePreparations(values, options) {
        writes.push({
          values: structuredClone(values),
          options: structuredClone(options),
        })
        const name = options.contextContainerId || 'normal'
        assert.equal(options.expectedRevisions[0], saved[name].revision)
        saved[name] = {
          ...structuredClone(values[0]),
          revision: saved[name].revision + 1,
        }
        return [structuredClone(saved[name])]
      },
    },
    authoring = await createProductAuthoring({
      repository,
      getRecords: () => [record],
      getContextContainerId: () => active,
    })
  const sourceRef = { accountId: 'local', orderId: '1001', entryId: '2001' },
    open = async () => {
      await authoring.openEditor(sourceRef)
      return document.querySelector('dialog[data-action="edit-order-product"]')
    },
    close = (modal) => modal.close()
  let modal = await open(),
    input = modal.querySelector('[data-authoring-field="spanish-name"]')
  input.value = 'NEW AMENDMENT'
  input.dispatchEvent(new window.Event('input'))
  await authoring.flush()
  assert.equal(writes[0].options.contextContainerId, 'c1')
  assert.equal(saved.normal.groups[0].variants[0].spanishName, undefined)
  close(modal)
  active = undefined
  await authoring.reload()
  modal = await open()
  assert.notEqual(
    modal.querySelector('[data-authoring-field="spanish-name"]').value,
    'NEW AMENDMENT'
  )
  await authoring.undo()
  assert.equal(writes.length, 1)
  input = modal.querySelector('[data-authoring-field="spanish-name"]')
  input.value = 'NORMAL EDIT'
  input.dispatchEvent(new window.Event('input'))
  await authoring.flush()
  close(modal)
  active = 'c1'
  await authoring.reload()
  modal = await open()
  assert.equal(
    modal.querySelector('[data-authoring-field="spanish-name"]').value,
    'NEW AMENDMENT'
  )
  await authoring.undo()
  assert.equal(saved.c1.groups[0].variants[0].spanishName, 'AMEND BEFORE')
  assert.equal(saved.normal.groups[0].variants[0].spanishName, 'NORMAL EDIT')
  assert.deepEqual(record.snapshot, manifest.orders[0].record.snapshot)
  close(modal)
  authoring.dispose()
})

async function historyFixture(context, { compound = false } = {}) {
  const environment = authoringEnvironment(context),
    records = ['1001', '1002'].map((id) => syntheticOrder(id)),
    template = syntheticManifest().orders[0].preparation,
    saved = new Map(),
    writes = []
  for (const record of records) {
    const preparation = structuredClone(template)
    preparation.orderId = record.snapshot.orderId
    preparation.groups[0].baseCode =
      record.snapshot.orderId === '1001' ? 'CE26090101' : 'CE26090102'
    if (compound) {
      record.snapshot.items.push({
        ...structuredClone(record.snapshot.items[0]),
        entryId: '2002',
      })
      Object.assign(record.snapshot.totals, {
        goodsGross: '2000.00',
        goodsNet: '2000.00',
        payable: '2000.00',
      })
      const group = preparation.groups[0]
      group.variants[0].variantSuffix = 'A'
      group.variants.push({
        ...structuredClone(group.variants[0]),
        id: 'second-variant',
        entryIds: ['2002'],
        variantSuffix: 'B',
      })
    }
    saved.set(preparation.orderId, preparation)
  }
  const original = structuredClone([...saved.values()]),
    source = structuredClone(records),
    repository = {
      listPreparations: async () => structuredClone([...saved.values()]),
      getPackingPreferences: async () => validatePackingPreferences({}),
      getReservedBarcodes: async () => [],
      listCartonBatches: async () => [],
      previewPreparations: async (values) => structuredClone(values),
      async savePreparations(values, options) {
        writes.push(structuredClone({ values, options }))
        for (const [index, value] of values.entries()) {
          const current = saved.get(value.orderId),
            expected = options.expectedSnapshots.find(
              (entry) => entry.orderId === value.orderId
            ),
            record = records.find(
              (entry) => entry.snapshot.orderId === value.orderId
            )
          if (
            options.expectedRevisions[index] !== current.revision ||
            expected.observedAt !== record.snapshot.observedAt
          )
            throw new Error(
              'Preparation changed in another tab: revision/source conflict'
            )
        }
        const results = values.map((value) => ({
          ...structuredClone(value),
          revision: saved.get(value.orderId).revision + 1,
        }))
        for (const result of results) saved.set(result.orderId, result)
        return structuredClone(results)
      },
    },
    authoring = await createProductAuthoring({
      repository,
      getRecords: () => records,
    })
  context.after(() => authoring.dispose())
  const edit = async (orderId, value) => {
    await authoring.openEditor({ accountId: 'local', orderId, entryId: '2001' })
    const input = environment.document.querySelector(
      '[data-authoring-field="chinese-category"]'
    )
    input.value = value
    input.dispatchEvent(new environment.window.Event('input'))
    await authoring.flush()
    environment.document
      .querySelector('[data-action="edit-order-product"]')
      .close()
  }
  return {
    ...environment,
    records,
    source,
    saved,
    original,
    writes,
    repository,
    authoring,
    edit,
  }
}

test('closed-form history rejects a refreshed foreign owner and new adopted edits preserve the other order history', async (context) => {
  const fixture = await historyFixture(context),
    { saved, authoring, writes, edit, original, records, source } = fixture
  await edit('1002', '另一订单本地编辑')
  await edit('1001', '本地编辑')
  saved.get('1001').groups[0].category = '外部保存'
  saved.get('1001').revision++
  const foreign = structuredClone(saved.get('1001'))
  await authoring.reload()
  await assert.rejects(authoring.undo(), /changed in another tab/)
  assert.equal(writes.length, 2)
  assert.deepEqual(saved.get('1001'), foreign)
  await edit('1001', '明确采用新版后编辑')
  await authoring.undo()
  assert.equal(saved.get('1001').groups[0].category, '外部保存')
  await authoring.undo()
  assert.equal(
    saved.get('1002').groups[0].category,
    original[1].groups[0].category
  )
  await authoring.redo()
  assert.equal(saved.get('1002').groups[0].category, '另一订单本地编辑')
  assert.deepEqual(records, source)
  assert.deepEqual(writes.at(-1).options.expectedRevisions, [3])
  assert.equal(
    writes.at(-1).options.expectedSnapshots[0].observedAt,
    source[1].snapshot.observedAt
  )
})

test('a rejected foreign revision keeps local input and exposes the explicit recovered-edit review instead of trapping Close', async (context) => {
  const fixture = await historyFixture(context),
    { document, window, saved, authoring, repository } = fixture
  await authoring.openEditor({
    accountId: 'local',
    orderId: '1001',
    entryId: '2001',
  })
  const modal = document.querySelector('[data-action="edit-order-product"]'),
    input = modal.querySelector('[data-authoring-field="spanish-name"]')
  input.value = 'LOCAL DRAFT'
  input.dispatchEvent(new window.Event('input'))
  saved.get('1001').revision++
  saved.get('1001').groups[0].variants[0].spanishName = 'NEWER SAVED'
  const foreign = structuredClone(saved.get('1001'))
  repository.savePreparations = async () => {
    throw Object.assign(new Error('Preparation changed in another tab.'), {
      code: 'PACKING_REVISION_CONFLICT',
    })
  }
  await assert.rejects(authoring.flush(), /changed in another tab/)
  ;[...modal.querySelectorAll('button')]
    .find((button) => button.textContent === 'Close')
    .click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const recovery = [...modal.querySelectorAll('button')].find(
    (button) => button.textContent === 'Review recovered product edits'
  )
  assert.equal(recovery.hidden, false)
  assert.equal(input.value, 'LOCAL DRAFT')
  recovery.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const review = document.querySelector('.packing-change-dialog')
  assert.ok(review)
  assert.match(review.textContent, /NEWER SAVED/)
  assert.match(review.textContent, /LOCAL DRAFT/)
  assert.deepEqual(saved.get('1001'), foreign)
  ;[...review.querySelectorAll('button')]
    .find((button) => button.textContent === 'Cancel')
    .click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  modal.close()
})

test('a visual conflict correction acknowledges the captured live draft and preserves the untouched owner', async (context) => {
  const { document, window, authoring, saved, repository, records, source } =
    await historyFixture(context)
  const actor = saved.get('1001').groups[0],
    owner = structuredClone(saved.get('1002')),
    conflicting = owner.groups[0].baseCode
  repository.queryCodeOwnership = async () => ({
    owners: [
      { accountId: 'local', orderId: '1002', groupId: owner.groups[0].id },
    ],
  })
  repository.previewPreparations = async (values) =>
    values.map((draft) => {
      const value = structuredClone(draft)
      if (!value.groups[0].baseCode) value.groups[0].baseCode = 'CE26090199'
      return value
    })
  repository.savePreparations = async (values, options) => {
    if (values[0].groups[0].baseCode === conflicting)
      throw Object.assign(new Error(`${conflicting} is already reserved`), {
        conflict: {
          code: conflicting,
          requestedOwner: {
            accountId: 'local',
            orderId: '1001',
            groupId: actor.id,
          },
        },
      })
    assert.equal(
      new Set(values.map((value) => value.groups[0].baseCode)).size,
      values.length
    )
    for (const [index, value] of values.entries()) {
      assert.equal(
        options.expectedRevisions[index],
        saved.get(value.orderId).revision
      )
      saved.set(value.orderId, {
        ...structuredClone(value),
        revision: value.revision + 1,
      })
    }
    return values.map((value) => structuredClone(saved.get(value.orderId)))
  }
  await authoring.openEditor({
    accountId: 'local',
    orderId: '1001',
    entryId: '2001',
  })
  const input = document.querySelector('[data-authoring-field="product-code"]')
  input.value = conflicting
  input.dispatchEvent(new window.Event('input'))
  await assert.rejects(authoring.flush(), /already reserved/)
  ;[...document.querySelectorAll('[data-action="edit-order-product"] button')]
    .find((button) => button.textContent === 'Resolve code conflict')
    .click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const resolver = document.querySelector('.code-conflict-dialog')
  assert.ok(resolver)
  ;[...resolver.querySelectorAll('button')]
    .find((button) => button.textContent === 'Use next available code')
    .click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  ;[...resolver.querySelectorAll('button')]
    .find((button) => button.textContent === 'Apply corrections')
    .click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(saved.get('1001').groups[0].baseCode, 'CE26090199')
  assert.deepEqual(saved.get('1002').groups, owner.groups)
  assert.equal(
    document.querySelector('[data-authoring-field="product-code"]').value,
    'CE26090199'
  )
  assert.equal(
    document.querySelector(
      '[data-action="edit-order-product"] [aria-invalid="true"]'
    ),
    null
  )
  assert.deepEqual(records, source)
  document.querySelector('[data-action="edit-order-product"]').close()
})

test('history keeps its captured source clock across an advisory reload even when the preparation revision is unchanged', async (context) => {
  const { records, saved, authoring, writes, edit } =
    await historyFixture(context)
  await edit('1001', '本地编辑')
  const before = structuredClone(saved.get('1001'))
  records[0].snapshot.observedAt = '2026-10-24T12:00:00.000Z'
  await authoring.reload()
  await assert.rejects(authoring.undo(), /changed in another tab/)
  assert.equal(writes.length, 1)
  assert.deepEqual(saved.get('1001'), before)
})

test('a foreign save not yet observed by the UI rejects the captured Undo write atomically', async (context) => {
  const { saved, authoring, writes, edit, records, source } =
    await historyFixture(context)
  await edit('1001', '本地编辑')
  const localRevision = saved.get('1001').revision
  saved.get('1001').groups[0].category = '外部保存'
  saved.get('1001').revision++
  const before = structuredClone(saved.get('1001'))
  await assert.rejects(authoring.undo(), /revision\/source conflict/)
  assert.equal(writes.length, 2)
  assert.deepEqual(writes.at(-1).options.expectedRevisions, [localRevision])
  assert.equal(
    writes.at(-1).options.expectedSnapshots[0].observedAt,
    source[0].snapshot.observedAt
  )
  assert.deepEqual(saved.get('1001'), before)
  assert.deepEqual(records, source)
})

test('compound grouping history guards every order after its form closes and never partially restores a foreign member', async (context) => {
  const { document, records, source, saved, writes, authoring } =
    await historyFixture(context, { compound: true })
  await authoring.groupProducts(
    records.flatMap((record) =>
      record.snapshot.items.map((item) => ({
        ...item,
        accountId: 'local',
        orderId: record.snapshot.orderId,
      }))
    )
  )
  ;[...document.querySelectorAll('.orders-grouping-dialog button')]
    .find((button) => button.textContent === 'Share one barcode')
    .click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  ;[...document.querySelectorAll('.packing-change-dialog button')]
    .find((button) => button.textContent === 'Apply changes')
    .click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(writes.length, 1)
  assert.equal(writes[0].values.length, 2)
  for (const preparation of saved.values())
    assert.deepEqual(preparation.groups[0].variants[0].entryIds, [
      '2001',
      '2002',
    ])
  saved.get('1002').revision++
  saved.get('1002').groups[0].category = '外部保存'
  const before = structuredClone([...saved.values()])
  await authoring.reload()
  await assert.rejects(authoring.undo(), /changed in another tab/)
  assert.equal(writes.length, 1)
  assert.deepEqual([...saved.values()], before)
  assert.deepEqual(records, source)
})

test('canceled amendment saves retain their captured epoch and recovered values require explicit review before a new epoch', async (context) => {
  const { document, window, values } = authoringEnvironment(context),
    manifest = syntheticManifest(),
    record = manifest.orders[0].record,
    original = { ...manifest.orders[0].preparation, revision: 1 },
    writes = []
  let epoch = 'first',
    release
  const waiting = new Promise((resolve) => {
      release = resolve
    }),
    token = () => ({ containerId: 'c1', epoch }),
    repository = {
      async listPreparations() {
        return [structuredClone({ ...original, amendmentContext: token() })]
      },
      getPackingPreferences: async () => validatePackingPreferences({}),
      async savePreparations(drafts, options) {
        writes.push(structuredClone({ drafts, options }))
        if (writes.length === 1) await waiting
        if (options.expectedAmendment.epoch !== epoch)
          throw new Error('AMENDMENT_CONTEXT_CONFLICT')
        return drafts.map((draft) => ({
          ...draft,
          revision: draft.revision + 1,
        }))
      },
    },
    authoring = await createProductAuthoring({
      repository,
      getRecords: () => [record],
      getContextContainerId: () => 'c1',
    }),
    ref = { accountId: 'local', orderId: '1001', entryId: '2001' }
  context.after(() => authoring.dispose())
  await authoring.openEditor(ref)
  let modal = document.querySelector('[data-action="edit-order-product"]'),
    input = modal.querySelector('[data-authoring-field="spanish-name"]')
  input.value = 'Retained canceled-epoch text'
  input.dispatchEvent(new window.Event('input'))
  const oldSave = authoring.flush()
  await new Promise((resolve) => setTimeout(resolve, 0))
  epoch = 'reopened'
  await authoring.reload()
  release()
  await assert.rejects(oldSave, /AMENDMENT_CONTEXT_CONFLICT/)
  assert.equal(writes[0].options.expectedAmendment.epoch, 'first')
  assert.equal(writes[0].drafts[0].amendmentContext.epoch, 'first')
  assert.equal(input.value, 'Retained canceled-epoch text')
  assert.match([...values.values()].join('\n'), /RETAINED CANCELED-EPOCH TEXT/)
  modal.close()
  const opening = authoring.openEditor(ref)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const review = document.querySelector('.packing-change-dialog')
  assert.ok(review)
  assert.match(review.textContent, /Review recovered product edits/)
  assert.equal(writes.length, 1)
  ;[...review.querySelectorAll('button')]
    .find((button) => button.textContent === 'Use these reviewed edits')
    .click()
  await opening
  modal = document.querySelector('[data-action="edit-order-product"]')
  assert.equal(
    modal.querySelector('[data-authoring-field="spanish-name"]').value,
    'RETAINED CANCELED-EPOCH TEXT'
  )
  await authoring.flush()
  assert.equal(writes[1].options.expectedAmendment.epoch, 'reopened')
  assert.equal(writes[1].drafts[0].amendmentContext.epoch, 'reopened')
  assert.deepEqual(record.snapshot, manifest.orders[0].record.snapshot)
  modal.close()
})

test('a grouping review keeps its original source/revision/amendment guards when a newer read arrives before confirmation', async (testContext) => {
  const { document } = authoringEnvironment(testContext),
    manifest = syntheticManifest(),
    record = structuredClone(manifest.orders[0].record),
    preparation = {
      ...structuredClone(manifest.orders[0].preparation),
      revision: 1,
      amendmentContext: { containerId: 'c1', epoch: 'first' },
    },
    next = structuredClone(preparation.groups[0]),
    writes = []
  record.snapshot.items.push({
    ...structuredClone(record.snapshot.items[0]),
    entryId: '2002',
  })
  next.id = 'second-group'
  next.baseCode = 'CE26090102'
  next.variants[0].id = 'second-variant'
  next.variants[0].entryIds = ['2002']
  preparation.groups.push(next)
  const originalSource = record.snapshot.observedAt
  const authoring = await createProductAuthoring({
    repository: {
      listPreparations: async () => [structuredClone(preparation)],
      getPackingPreferences: async () => validatePackingPreferences({}),
      getReservedBarcodes: async () => [],
      getOrderReconciliation: async () => ({
        batches: [],
        amendmentContext: { containerId: 'c1', epoch: 'first' },
      }),
      previewPreparations: async (values) => structuredClone(values),
      savePreparations: async (values, options) => {
        writes.push(structuredClone({ values, options }))
        throw new Error('Synthetic stale grouping rejected')
      },
    },
    getRecords: () => [record],
    getContextContainerId: () => 'c1',
  })
  await authoring.groupProducts(
    record.snapshot.items.map((item) => ({
      ...item,
      accountId: 'local',
      orderId: '1001',
    }))
  )
  ;[...document.querySelectorAll('.orders-grouping-dialog button')]
    .find((button) => button.textContent === 'Merge products')
    .click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const review = document.querySelector('.packing-change-dialog')
  assert.ok(review)
  preparation.revision = 2
  preparation.amendmentContext = { containerId: 'c1', epoch: 'reopened' }
  record.snapshot.observedAt = '2026-10-23T12:00:00.000Z'
  await authoring.reload()
  ;[...review.querySelectorAll('button')]
    .find((button) => button.textContent === 'Apply changes')
    .click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].options.expectedRevisions, [1])
  assert.deepEqual(writes[0].options.expectedAmendment, {
    containerId: 'c1',
    epoch: 'first',
  })
  assert.equal(
    writes[0].options.expectedSnapshots[0].observedAt,
    originalSource
  )
  assert.match(
    document.querySelector('.error-notice').textContent,
    /stale grouping rejected/
  )
  authoring.dispose()
})

test('failed authoring save keeps the mounted raw code, error relation and recovery; a corrected retry clears its error', async (context) => {
  const { document, window, values } = authoringEnvironment(context),
    manifest = syntheticManifest(),
    record = manifest.orders[0].record
  let saved = { ...manifest.orders[0].preparation, revision: 1 },
    fail = true
  const repository = {
    async listPreparations() {
      return [structuredClone(saved)]
    },
    async getPackingPreferences() {
      return validatePackingPreferences({})
    },
    async savePreparations(values) {
      if (fail)
        throw Object.assign(new Error('CE26090102 is already reserved'), {
          conflict: { code: 'CE26090102' },
        })
      saved = { ...structuredClone(values[0]), revision: saved.revision + 1 }
      return [saved]
    },
  }
  const authoring = await createProductAuthoring({
    repository,
    getRecords: () => [record],
  })
  await authoring.openEditor({
    accountId: 'local',
    orderId: '1001',
    entryId: '2001',
  })
  const modal = document.querySelector(
      'dialog[data-action="edit-order-product"]'
    ),
    input = modal.querySelector('[data-authoring-field="product-code"]')
  input.value = 'CE26090102'
  input.dispatchEvent(new window.Event('input'))
  await assert.rejects(authoring.flush(), /already reserved/)
  assert.equal(input.value, 'CE26090102')
  assert.equal(input.getAttribute('aria-invalid'), 'true')
  assert.ok(
    document
      .getElementById(input.getAttribute('aria-errormessage'))
      .textContent.includes('CE26090102')
  )
  assert.ok(modal.querySelector('.error-notice'))
  assert.ok(
    [...values.entries()].some(
      ([key, value]) =>
        key.includes('authoring-draft') && value.includes('CE26090102')
    )
  )
  fail = false
  input.value = 'CE26090101'
  input.dispatchEvent(new window.Event('input'))
  await authoring.flush()
  assert.equal(input.getAttribute('aria-invalid'), null)
  assert.equal(modal.querySelector('.error-notice'), null)
  assert.equal(
    modal.querySelector('[data-authoring-field="product-code"]'),
    input
  )
  modal.close()
  authoring.dispose()
})
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
    async updateOrderCapacities({ values, expectedValues }) {
      record.unitsPerCarton ||= {}
      for (const [entryId, value] of Object.entries(values)) {
        assert.equal(
          record.unitsPerCarton[entryId] ?? null,
          expectedValues[entryId]
        )
        if (value === null) delete record.unitsPerCarton[entryId]
        else record.unitsPerCarton[entryId] = value
      }
      return {
        record: structuredClone(record),
        revisions: structuredClone(context.revisions),
      }
    },
  }
  return {
    record,
    batch,
    context,
    drafts,
    confirmed,
    reads,
    repository,
    create: () =>
      createOrderCartonSession({
        repository,
        orderRef: { accountId: 'local', orderId: '1001' },
        planner: actualPlanner,
        ...options,
      }),
  }
}

test('physical confirmation disables only its action and clears the acknowledged planner before recovery observers can persist it', async (context) => {
  const { document } = dom(context),
    fixture = exceptionSessionFixture()
  let release
  const waiting = new Promise((resolve) => {
    release = resolve
  })
  fixture.repository.confirmOrderCartons = async (args) => {
    fixture.confirmed.push(structuredClone(args))
    await waiting
  }
  const session = await fixture.create(),
    grid = mountOrderCartonGrid(document.getElementById('host'), {
      session,
      kind: 'cartons',
    }),
    button = document.querySelector('[data-action="confirm-order-cartons"]')
  await session.commitCell(fixture.batch.id, 'weight', '0')
  const pending = session.confirm()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(button.disabled, true)
  assert.equal(
    document.querySelector('[data-grid-column="weight"]').disabled,
    false
  )
  let observed = false
  const stop = session.subscribe(() => {
    if (
      fixture.confirmed.length &&
      !Object.keys(session.state().rawCells).length &&
      !observed
    ) {
      observed = true
      session.setActiveCell(fixture.batch.id, 'weight')
    }
  })
  release()
  await pending
  await session.flush()
  assert.equal(observed, true)
  assert.equal(button.disabled, false)
  assert.deepEqual(fixture.drafts.at(-1).draft.plannerDraft.cartons, [])
  assert.deepEqual(fixture.drafts.at(-1).draft.rawCells, {})
  stop()
  grid.destroy()
  session.dispose()
})

test('reviewed grouping captures actual physical revisions and compound Undo/Redo retains every carton fact while rejecting foreign changes', async (context) => {
  const { document, window } = authoringEnvironment(context),
    { record, preparation } = syntheticManifest().orders[0],
    first = preparation.groups[0],
    second = structuredClone(first)
  record.snapshot.items.push({
    ...structuredClone(record.snapshot.items[0]),
    entryId: '2002',
  })
  Object.assign(record.snapshot.totals, {
    goodsGross: '2000.00',
    goodsNet: '2000.00',
    payable: '2000.00',
  })
  second.id = 'second-product'
  second.baseCode = 'CE26090102'
  second.variants[0].id = 'second-variant'
  second.variants[0].entryIds = ['2002']
  preparation.groups.push(second)
  let saved = structuredClone(preparation),
    physical = syntheticBatch('1001', 2, '100', {
      contents: [{ orderId: '1001', entryId: '2002', quantity: '100' }],
      groups: [{ orderId: '1001', groupId: second.id }],
      weight: '57.2202',
      len: '40.125',
      wid: '30',
      ht: '25',
      weightBasis: 'batch',
      revision: 7,
    })
  const original = structuredClone({ record, preparation, physical }),
    writes = [],
    reads = [],
    printed = [],
    authoring = await createProductAuthoring({
      getRecords: () => [record],
      onPrintMark: async (ref) => {
        printed.push(structuredClone(ref))
      },
      repository: {
        listPreparations: async () => [structuredClone(saved)],
        getPackingPreferences: async () => validatePackingPreferences({}),
        getReservedBarcodes: async () => [],
        getOrderReconciliation: async () => ({
          record: structuredClone(record),
          preparation: structuredClone(saved),
          batches: [structuredClone(physical)],
          reports: [],
          revisions: {
            source: 'actual-captured-source',
            observedAt: record.snapshot.observedAt,
            preparation: saved.revision,
            cartons: { [physical.id]: physical.revision },
            reports: {},
          },
        }),
        listCartonBatches: async (args) => {
          reads.push(structuredClone(args))
          return [structuredClone(physical)]
        },
        previewPreparations: async (values, options) => {
          assert.equal(options.allowCartonReview, true)
          return structuredClone(values)
        },
        savePreparations: async (values, options) => {
          writes.push(structuredClone({ values, options }))
          assert.deepEqual(options.expectedRevisions, [saved.revision])
          assert.equal(
            options.cartonBatchChanges[0].expectedRevision,
            physical.revision
          )
          assert.equal(options.allowCartonReview, true)
          const change = options.cartonBatchChanges[0],
            updatedAt = `2026-10-23T00:00:0${writes.length}.000Z`,
            nextPhysical = retainCartonEvidence(
              physical,
              transitionPhysicalMark(physical, change.after, [saved], values, {
                decision: change.physicalMarkResolution,
                restoreHistory: change.restorePhysicalMarkHistory,
                updatedAt,
              })
            )
          saved = {
            ...structuredClone(values[0]),
            revision: saved.revision + 1,
          }
          physical = {
            ...nextPhysical,
            revision: physical.revision + 1,
            updatedAt,
          }
          return [structuredClone(saved)]
        },
      },
    })
  context.after(() => authoring.dispose())
  await authoring.groupProducts(
    record.snapshot.items.map((item) => ({
      ...item,
      accountId: 'local',
      orderId: '1001',
    }))
  )
  ;[...document.querySelectorAll('.orders-grouping-dialog button')]
    .find((button) => button.textContent === 'Merge products')
    .click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const review = document.querySelector('.packing-change-dialog')
  assert.ok(review)
  assert.match(review.textContent, /CE26090102/)
  assert.match(review.textContent, /CE26090101/)
  const currentPrint = review.querySelector(
    '[data-action="print-order-carton-mark"][data-mark-role="current-product"]'
  )
  assert.equal(currentPrint.disabled, false)
  currentPrint.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(printed.length, 1)
  assert.equal(printed[0].code, first.baseCode)
  assert.equal(printed[0].productGroupId, first.id)
  assert.equal(printed[0].batchId, physical.id)
  assert.deepEqual(saved, original.preparation)
  assert.deepEqual(physical, original.physical)
  const apply = [...review.querySelectorAll('button')].find(
      (button) => button.textContent === 'Apply changes'
    ),
    keep = review.querySelector('[data-choice="keep-recorded-mark"]'),
    reason = review.querySelector('[data-action="physical-mark-reason"]')
  assert.equal(apply.disabled, true)
  keep.checked = true
  keep.dispatchEvent(new window.Event('change'))
  reason.value = 'Actual old printed mark remains on the same cartons'
  reason.dispatchEvent(new window.Event('input'))
  assert.equal(apply.disabled, false)
  assert.equal(writes.length, 0)
  apply.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(saved.groups.length, 1)
  assert.equal(physical.revision, 8)
  assert.equal(physical.physicalMark.code, 'CE26090102')
  assert.equal(physical.physicalMark.productCode, 'CE26090101')
  assert.deepEqual(
    physical.physicalMark.originalMark,
    original.physical.groups[0]
  )
  assert.equal(physical.physicalMark.resolution.choice, 'keep-recorded-mark')
  assert.equal(
    writes[0].options.cartonBatchChanges[0].physicalMarkResolution.choice,
    'keep-recorded-mark'
  )
  await authoring.undo()
  assert.equal(saved.groups.length, 2)
  assert.equal(physical.revision, 9)
  assert.equal(physical.physicalMark.code, 'CE26090102')
  assert.equal(physical.physicalMark.productCode, 'CE26090102')
  assert.equal(
    physicalMarkReadback(physical, [saved]).physicalMarkResolutionRequired,
    false
  )
  await authoring.redo()
  assert.equal(saved.groups.length, 1)
  assert.equal(physical.revision, 10)
  assert.equal(physical.physicalMark.code, 'CE26090102')
  assert.equal(
    writes[2].options.cartonBatchChanges[0].restorePhysicalMarkHistory,
    true
  )
  assert.equal(
    writes[2].options.cartonBatchChanges[0].physicalMarkResolution,
    undefined
  )
  assert.deepEqual(
    writes.map((write) => write.options.cartonBatchChanges[0].expectedRevision),
    [7, 8, 9]
  )
  assert.ok(
    reads.every(
      (args) =>
        args.accountId === 'local' &&
        args.includeDeleted === true &&
        !Object.hasOwn(args, 'month')
    )
  )
  for (const write of writes) {
    const batch = write.options.cartonBatchChanges[0].after
    for (const key of [
      'contents',
      'count',
      'weight',
      'weightBasis',
      'len',
      'wid',
      'ht',
    ])
      assert.deepEqual(batch[key], original.physical[key])
  }
  physical.revision++
  const foreign = structuredClone(physical)
  await assert.rejects(authoring.undo(), /cartons changed in another tab/)
  assert.equal(writes.length, 3)
  assert.deepEqual(physical, foreign)
  assert.deepEqual(record, original.record)
})

test('compound capacity Undo replays its known baseline even when the retained textarea still needs a new paste preview', async (testContext) => {
  const fixture = exceptionSessionFixture(),
    session = await fixture.create(),
    rows = session.projection().products,
    state = session.state(),
    target = captureGridTarget({
      orderRef: session.orderRef,
      generation: state.generation,
      viewVersion: state.viewVersion,
      visibleKeys: rows.map((row) => row.key),
      selectedKeys: rows.map((row) => row.key),
      columns: PRODUCT_GRID_COLUMNS,
      anchorKey: rows[0].key,
      anchorColumn: 'capacity',
    })
  testContext.after(() => session.dispose())
  session.retainPasteText('45')
  const actualTarget = { ...target, generation: session.state().generation }
  const plan = await session.previewPaste('45', actualTarget, rows)
  await session.applyPaste(plan, actualTarget)
  assert.equal(fixture.record.unitsPerCarton['2001'], '45')
  await session.undo()
  assert.deepEqual(fixture.record.unitsPerCarton, {})
  assert.equal(session.state().alignment.requirePreview, true)
  await session.redo()
  assert.equal(fixture.record.unitsPerCarton['2001'], '45')
  assert.equal(fixture.confirmed.length, 0)
})

test('physical recovery and one-order confirmation carry the originally captured amendment epoch', async (testContext) => {
  const fixture = exceptionSessionFixture({
      getContextContainerId: () => 'c1',
    }),
    token = { containerId: 'c1', epoch: 'first' }
  fixture.context.amendmentContext = token
  fixture.context.revisions.amendmentContext = token
  const session = await fixture.create()
  testContext.after(() => session.dispose())
  session.retainUnitDraft(fixture.batch.id, 1, {
    measurements: { weight: '3.125' },
  })
  await session.flush()
  assert.deepEqual(fixture.drafts.at(-1).expectedAmendment, token)
  assert.deepEqual(fixture.drafts.at(-1).draft.amendmentContext, token)
  // A later read in another context must not rebind this session's old work.
  fixture.context.amendmentContext = { containerId: 'c1', epoch: 'reopened' }
  await session.stageUnitFacts({
    batchId: fixture.batch.id,
    index: 1,
    measurements: { weight: '3.125' },
  })
  await session.confirm()
  assert.deepEqual(
    fixture.confirmed[0].expectedRevisions.amendmentContext,
    token
  )
  assert.deepEqual(fixture.confirmed[0].draft.amendmentContext, token)
})

test('older physical drafts stay separate until review and retain invalid cells under the deliberately reviewed current epoch', async (testContext) => {
  const { document } = dom(testContext),
    fixture = exceptionSessionFixture({ getContextContainerId: () => 'c1' }),
    oldToken = { containerId: 'c1', epoch: 'first' },
    currentToken = { containerId: 'c1', epoch: 'reopened' },
    cell = JSON.stringify([
      JSON.stringify(['local', '1001', '2001']),
      'capacity',
    ]),
    old = {
      revision: 4,
      amendmentContext: oldToken,
      updatedAt: '2026-10-22T12:00:00Z',
      value: {
        version: 1,
        amendmentContext: oldToken,
        plannerDraft: actualPlanner.createReconciliationDraft(fixture.context),
        rawCells: { [cell]: 'invalid retained quantity' },
        generation: 2,
      },
    },
    original = structuredClone(old)
  fixture.context.amendmentContext = currentToken
  fixture.context.revisions.amendmentContext = currentToken
  fixture.context.recoveredDrafts = [old]
  const session = await fixture.create(),
    grid = mountOrderCartonGrid(document.getElementById('host'), { session })
  testContext.after(() => session.dispose())
  assert.equal(session.state().rawCells[cell], undefined)
  document
    .querySelector('[data-action="review-recovered-carton-draft"]')
    .click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const review = document.querySelector('.packing-change-dialog')
  assert.match(review.textContent, /invalid retained quantity/)
  assert.equal(fixture.drafts.length, 0)
  ;[...review.querySelectorAll('button')]
    .find((button) => button.textContent === 'Use these reviewed edits')
    .click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(session.state().rawCells[cell], 'invalid retained quantity')
  assert.deepEqual(fixture.drafts.at(-1).expectedAmendment, currentToken)
  assert.deepEqual(fixture.drafts.at(-1).draft.amendmentContext, currentToken)
  assert.deepEqual(old, original)
  await assert.rejects(session.confirm(), /whole/)
  assert.equal(fixture.confirmed.length, 0)
  grid.destroy()
})

test('label validation identifies the exact source and field instead of losing the affected product', () => {
  const product = {
    accountId: 'local',
    orderId: '1001',
    entryId: '2001',
    groupId: 'g1',
    variantId: 'v1',
    barcode: 'CE26090101',
    baseCode: 'CE26090101',
    spanishName: 'SYNTHETIC',
    chineseCategory: '',
  }
  assert.throws(
    () => outputLabelModels({ products: [product] }, 'mark'),
    (error) => {
      assert.equal(error.packingIssue.orderId, '1001')
      assert.equal(error.packingIssue.entryId, '2001')
      assert.equal(error.packingIssue.field, 'category')
      return true
    }
  )
  assert.throws(
    () =>
      outputLabelModels({ products: [{ ...product, needsSizeMapping: true }] }),
    (error) => {
      assert.equal(error.packingIssue.entryId, '2001')
      assert.equal(error.packingIssue.field, 'size')
      return true
    }
  )
})

test('a failed draft repository write survives reload in tab-local recovery without committing invalid cells', async (testContext) => {
  const { values } = authoringEnvironment(testContext),
    tab = new Map(),
    previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key) => tab.get(key),
      setItem: (key, value) => tab.set(key, value),
    },
  })
  testContext.after(() =>
    previous
      ? Object.defineProperty(globalThis, 'sessionStorage', previous)
      : delete globalThis.sessionStorage
  )
  const fixture = exceptionSessionFixture(),
    key = JSON.stringify(['local', '1001', '2001'])
  fixture.repository.saveOrderCartonDraft = async () => {
    throw new Error('Synthetic durable write unavailable')
  }
  let session = await fixture.create()
  session.editCell(key, 'capacity', 'invalid retained raw')
  await assert.rejects(session.flush(), /write unavailable/)
  assert.ok(
    [...values.entries()].some(
      ([key, value]) =>
        key.includes('carton-recovery') &&
        value.includes('invalid retained raw')
    )
  )
  session.dispose()
  session = await fixture.create()
  assert.equal(session.rawCell(key, 'capacity'), 'invalid retained raw')
  await assert.rejects(session.confirm(), /write unavailable/)
  assert.equal(fixture.confirmed.length, 0)
  session.dispose()
})

test('acknowledged capacity edits refresh live scalar values while a new edit retains the original concurrent-write guard', async (testContext) => {
  const record = syntheticOrder('1001'),
    context = {
      record,
      preparation: { groups: [] },
      batches: [],
      reports: [],
      draft: null,
      revisions: { capacity: 0 },
    },
    ref = { accountId: 'local', orderId: '1001' },
    key = JSON.stringify(['local', '1001', '2001']),
    writes = []
  let draftRevision = 0
  const session = await createOrderCartonSession({
    repository: {
      getOrderReconciliation: async () => structuredClone(context),
      saveOrderCartonDraft: async (args) => {
        context.draft = {
          revision: ++draftRevision,
          value: structuredClone(args.draft),
        }
        return { revision: draftRevision }
      },
      updateOrderCapacities: async (args) => {
        writes.push(structuredClone(args))
        for (const entryId of Object.keys(args.values))
          if (
            (context.record.unitsPerCarton?.[entryId] ?? null) !==
            args.expectedValues[entryId]
          )
            throw new Error('The capacity changed in another tab')
        context.record.unitsPerCarton = {
          ...context.record.unitsPerCarton,
          ...args.values,
        }
        context.revisions.capacity++
        return {
          record: structuredClone(context.record),
          revisions: structuredClone(context.revisions),
        }
      },
    },
    orderRef: ref,
    planner: actualPlanner,
  })
  testContext.after(() => session.dispose())
  session.editCell(key, 'capacity', '10')
  await session.flush()
  assert.equal(
    session.state().rawCells[JSON.stringify([key, 'capacity'])],
    undefined
  )
  context.record.unitsPerCarton['2001'] = '20'
  context.revisions.capacity++
  await session.refresh()
  assert.equal(session.rawCell(key, 'capacity'), '20')
  assert.equal(session.projection().products[0].proposedCount, 5)
  session.editCell(key, 'capacity', '45')
  await assert.rejects(session.flush(), /changed in another tab/)
  assert.equal(writes.at(-1).expectedValues['2001'], '10')
  assert.equal(context.record.unitsPerCarton['2001'], '20')
  assert.equal(session.rawCell(key, 'capacity'), '45')
})

test('reloading a draft after a foreign physical revision requires review and preserves the old raw values across later recovery writes', async (testContext) => {
  const { document } = dom(testContext),
    fixture = exceptionSessionFixture(),
    original = structuredClone(fixture.record.snapshot),
    save = fixture.repository.saveOrderCartonDraft
  fixture.repository.saveOrderCartonDraft = async (args) => {
    const result = await save(args)
    fixture.context.draft = {
      id: 'cartons:["local","1001"]',
      revision: result.revision,
      updatedAt: '2026-10-22T12:00:00.000Z',
      value: structuredClone(args.draft),
    }
    return result
  }
  let session = await fixture.create()
  session.editCell(fixture.batch.id, 'weight', '-')
  await assert.rejects(
    session.flush(),
    /Enter a nonnegative decimal or leave the measurement unknown/
  )
  session.dispose()
  fixture.context.batches[0].weight = '6'
  fixture.context.batches[0].revision = 2
  fixture.context.revisions.cartons[fixture.batch.id] = 2
  session = await fixture.create()
  assert.equal(session.rawCell(fixture.batch.id, 'weight'), '6')
  await session.refresh()
  assert.equal(session.recoveredDrafts().length, 1)
  assert.ok(
    Object.values(session.recoveredDrafts()[0].value.rawCells).includes('-')
  )
  session.setActiveCell(fixture.batch.id, 'weight')
  await session.flush()
  session.dispose()
  session = await fixture.create()
  assert.equal(session.recoveredDrafts().length, 1)
  const grid = mountOrderCartonGrid(document.getElementById('host'), {
    session,
    kind: 'cartons',
  })
  document
    .querySelector('[data-action="review-recovered-carton-draft"]')
    .click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const review = document.querySelector('.packing-change-dialog')
  assert.match(review.textContent, /earlier order revision or amendment/)
  ;[...review.querySelectorAll('button')]
    .find((button) => button.textContent === 'Keep saved version')
    .click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(session.rawCell(fixture.batch.id, 'weight'), '6')
  assert.equal(fixture.context.batches[0].weight, '6')
  assert.equal(fixture.confirmed.length, 0)
  assert.deepEqual(fixture.record.snapshot, original)
  grid.destroy()
  session.dispose()
})

test('intentional blank Spanish names and pending size mappings remain label blockers in Orders output', async (testContext) => {
  authoringEnvironment(testContext)
  const manifest = syntheticManifest(),
    preparation = structuredClone(manifest.orders[0].preparation),
    record = manifest.orders[0].record,
    variant = preparation.groups[0].variants[0],
    ref = { accountId: 'local', orderId: '1001', entryId: '2001' }
  preparation.groups[0].spanishName = 'GROUP FALLBACK'
  variant.spanishName = ''
  variant.needsSizeMapping = false
  const authoring = await createProductAuthoring({
    repository: {
      listPreparations: async () => [structuredClone(preparation)],
      getPackingPreferences: async () => validatePackingPreferences({}),
    },
    getRecords: () => [record],
  })
  const rows = authoring.preparedRows([ref])
  assert.equal(rows[0].spanishName, '')
  assert.equal(rows[0].needsSizeMapping, false)
  assert.throws(() => outputLabelModels({ products: rows }), /Spanish name/)
  variant.spanishName = 'EXPLICIT NAME'
  variant.needsSizeMapping = true
  await authoring.reload()
  assert.throws(
    () => outputLabelModels({ products: authoring.preparedRows([ref]) }),
    /Map this variant size/
  )
  authoring.dispose()
})

test('an Orders code badge displays its exact barcode once and keeps its copy feedback separate', async (testContext) => {
  const { document } = authoringEnvironment(testContext),
    manifest = syntheticManifest(),
    { record, preparation } = manifest.orders[0],
    ref = { accountId: 'local', orderId: '1001', entryId: '2001' },
    authoring = await createProductAuthoring({
      repository: {
        listPreparations: async () => [structuredClone(preparation)],
        getPackingPreferences: async () => validatePackingPreferences({}),
      },
      getRecords: () => [record],
    }),
    host = document.createElement('div'),
    expected = authoring.preparedRows([ref])[0].barcode
  document.body.append(host)
  authoring.decorateRow(host, ref)
  const code = host.querySelector('.row-code-copy')
  assert.ok(expected)
  assert.equal(code.textContent, expected)
  assert.equal(code.querySelectorAll('[data-code-part="product"]').length, 1)
  assert.equal(code.querySelectorAll('.copy-text-feedback').length, 1)
  authoring.dispose()
})

test('an assigned base with unresolved size stays visibly pending and never becomes a guessed variant barcode', async (testContext) => {
  const { document } = authoringEnvironment(testContext),
    { record, preparation } = syntheticManifest().orders[0],
    ref = { accountId: 'local', orderId: '1001', entryId: '2001' },
    original = structuredClone(record)
  preparation.groups[0].variants[0].needsSizeMapping = true
  const authoring = await createProductAuthoring({
      repository: {
        listPreparations: async () => [structuredClone(preparation)],
        getPackingPreferences: async () => validatePackingPreferences({}),
      },
      getRecords: () => [record],
    }),
    host = document.createElement('div')
  document.body.append(host)
  authoring.decorateRow(host, ref)
  assert.equal(host.querySelector('.row-code-copy'), null)
  assert.equal(authoring.canCopyLabels([ref]), true)
  assert.equal(
    host.querySelector('.row-base-code').textContent,
    preparation.groups[0].baseCode
  )
  assert.match(
    host.querySelector('.size-mapping-status[role="status"]').textContent,
    /Map this variant size/
  )
  assert.throws(
    () => outputLabelModels({ products: authoring.preparedRows([ref]) }),
    /Map this variant size before generating labels/
  )
  assert.deepEqual(record, original)
  authoring.dispose()
})

test('same-base variant collisions mark the edited ending and retain saved sibling identities', async (testContext) => {
  const { document, window } = authoringEnvironment(testContext),
    { record, preparation } = syntheticManifest().orders[0],
    group = preparation.groups[0],
    first = group.variants[0]
  record.snapshot.items.push({
    ...structuredClone(record.snapshot.items[0]),
    entryId: '2002',
  })
  Object.assign(record.snapshot.totals, {
    goodsGross: '2000.00',
    goodsNet: '2000.00',
    payable: '2000.00',
  })
  Object.assign(first, {
    variantSuffix: 'A',
    sizeSuffix: '',
    needsSizeMapping: false,
  })
  group.variants.push({
    ...structuredClone(first),
    id: 'sibling-variant',
    entryIds: ['2002'],
    variantSuffix: 'B',
  })
  const before = structuredClone(preparation),
    authoring = await createProductAuthoring({
      repository: {
        listPreparations: async () => [structuredClone(preparation)],
        getPackingPreferences: async () => validatePackingPreferences({}),
        savePreparations: async () => {
          throw Object.assign(
            new Error(`${group.baseCode}B belongs to another variant`),
            {
              conflict: {
                edit: { groupId: group.id, variantId: first.id },
                owner: { groupId: group.id, variantId: 'sibling-variant' },
              },
            }
          )
        },
      },
      getRecords: () => [record],
    })
  await authoring.openEditor({
    accountId: 'local',
    orderId: '1001',
    entryId: '2001',
  })
  const ending = document.querySelector(
      '[data-authoring-field="variant-ending"]'
    ),
    base = document.querySelector('[data-authoring-field="product-code"]')
  ending.value = 'B'
  ending.dispatchEvent(new window.Event('input'))
  await assert.rejects(authoring.flush(), /belongs to another variant/)
  assert.equal(ending.getAttribute('aria-invalid'), 'true')
  assert.equal(base.getAttribute('aria-invalid'), null)
  assert.equal(base.value, group.baseCode)
  assert.equal(ending.value, 'B')
  assert.deepEqual(preparation, before)
  document.querySelector('[data-action="edit-order-product"]').close()
  authoring.dispose()
})

test('Orders authoring copies translated source attributes and exact quantity while language changes retain pending editors and originals', async (context) => {
  const { document, window } = authoringEnvironment(context),
    { record, preparation } = syntheticManifest().orders[0],
    item = record.snapshot.items[0],
    previous = getLanguage()
  Object.assign(item, {
    description: 'Synthetic cups\n颜色：白色\n尺寸：20cm',
    skuProperties: [
      { label: '颜色', value: '白色' },
      { label: '尺寸', value: '20cm' },
    ],
  })
  const original = structuredClone(record),
    authoring = await createProductAuthoring({
      repository: {
        listPreparations: async () => [structuredClone(preparation)],
        getPackingPreferences: async () => validatePackingPreferences({}),
      },
      getRecords: () => [record],
    })
  context.after(() => {
    authoring.dispose()
    setLanguage(previous, { persist: false })
  })
  setLanguage('en', { persist: false })
  await authoring.openEditor({
    accountId: 'local',
    orderId: '1001',
    entryId: item.entryId,
  })
  const modal = document.querySelector('[data-action="edit-order-product"]'),
    input = modal.querySelector('[data-authoring-field="spanish-name"]'),
    labels = () =>
      [...modal.querySelectorAll('.product-authoring-source-facts button')].map(
        (button) => button.getAttribute('aria-label')
      )
  assert.ok(labels().includes('Copy value: White'))
  assert.ok(labels().includes('Copy size: 20cm'))
  assert.ok(labels().includes('Copy quantity: 100'))
  input.value = 'Retained pending source name'
  input.dispatchEvent(new window.Event('input'))
  setLanguage('es', { persist: false })
  assert.ok(labels().includes('Copiar valor: Blanco'))
  assert.equal(
    modal.querySelector('[data-authoring-field="spanish-name"]'),
    input
  )
  assert.equal(input.value, 'Retained pending source name')
  assert.deepEqual(record, original)
  modal.close()
})

test('purchase-code review excludes documented fee quantities but retains unknown source quantities for domain validation', async (context) => {
  const { document } = authoringEnvironment(context),
    record = syntheticOrder('1001'),
    selected = [],
    calls = []
  record.snapshot.items.push(
    { ...structuredClone(record.snapshot.items[0]), entryId: '2002' },
    {
      ...structuredClone(record.snapshot.items[0]),
      entryId: '2003',
      quantity: '0.5',
    }
  )
  Object.assign(record.snapshot.totals, {
    goodsGross: '2005.00',
    goodsNet: '2005.00',
    payable: '2005.00',
  })
  record.inventoryDispositions = {
    2002: {
      kind: 'fee',
      reason: 'Documented freight-only row',
      updatedAt: '2026-10-20T00:00:00.000Z',
    },
  }
  selected.push(
    ...record.snapshot.items.map((item) => ({
      ...item,
      accountId: 'local',
      orderId: '1001',
    }))
  )
  const original = structuredClone({ record, selected }),
    authoring = await createProductAuthoring({
      repository: {
        listPreparations: async () => [],
        getPackingPreferences: async () => validatePackingPreferences({}),
        reviewPurchaseCodes: async (args) => {
          calls.push(structuredClone(args))
          return { changes: [], issues: [] }
        },
      },
      getRecords: () => [record],
    })
  context.after(() => authoring.dispose())
  await authoring.reviewCodes(selected)
  assert.deepEqual(
    calls[0].entryRefs.map((ref) => ref.entryId),
    ['2001', '2003']
  )
  assert.deepEqual(calls[0].orderRefs, [
    { accountId: 'local', orderId: '1001' },
  ])
  assert.deepEqual({ record, selected }, original)
  document.querySelector('.purchase-code-review').close()
})

test('grouping separates complete source scope from chosen variants and protects unselected shared source rows', async (testContext) => {
  const { document } = authoringEnvironment(testContext),
    { record, preparation } = syntheticManifest().orders[0],
    first = preparation.groups[0],
    variant = first.variants[0]
  record.snapshot.items.push(
    ...['2002', '2003'].map((entryId) => ({
      ...structuredClone(record.snapshot.items[0]),
      entryId,
    }))
  )
  Object.assign(record.snapshot.totals, {
    goodsGross: '3000.00',
    goodsNet: '3000.00',
    payable: '3000.00',
  })
  Object.assign(variant, {
    variantSuffix: 'A',
    sizeSuffix: '',
    needsSizeMapping: false,
  })
  first.variants.push({
    ...structuredClone(variant),
    id: 'second-variant',
    entryIds: ['2002'],
    variantSuffix: 'B',
  })
  const second = {
    ...structuredClone(first),
    id: 'second-group',
    baseCode: 'CE26090102',
    variants: [
      {
        ...structuredClone(variant),
        id: 'third-variant',
        entryIds: ['2003'],
        variantSuffix: '',
      },
    ],
  }
  preparation.groups.push(second)
  const originalSource = structuredClone(record.snapshot),
    authoring = await createProductAuthoring({
      repository: {
        listPreparations: async () => [structuredClone(preparation)],
        getPackingPreferences: async () => validatePackingPreferences({}),
      },
      getRecords: () => [record],
    }),
    select = (ids) =>
      ids.map((entryId) => ({ accountId: 'local', orderId: '1001', entryId })),
    button = (name) =>
      [...document.querySelectorAll('.orders-grouping-dialog button')].find(
        (node) => node.textContent === name
      ),
    close = () => document.querySelector('.orders-grouping-dialog').close()
  await authoring.groupProducts(select(['2001']))
  assert.equal(button('Move to new product').disabled, false)
  close()
  await authoring.groupProducts(select(['2001', '2003']))
  assert.equal(button('Merge products').disabled, true)
  close()
  await authoring.groupProducts(select(['2001', '2002', '2003']))
  assert.equal(button('Merge products').disabled, false)
  close()
  preparation.groups = [first]
  first.variants[0].entryIds = ['2001', '2002']
  first.variants[1].entryIds = ['2003']
  await authoring.reload()
  await authoring.groupProducts(select(['2001', '2003']))
  assert.equal(button('Share one barcode').disabled, true)
  assert.deepEqual(record.snapshot, originalSource)
  close()
  authoring.dispose()
})

test('Orders reuses automatic source material suggestions and preserves a deliberate manual clear without writes on inspection', async (testContext) => {
  const { document } = authoringEnvironment(testContext),
    { record, preparation } = syntheticManifest().orders[0],
    variant = preparation.groups[0].variants[0],
    ref = { accountId: 'local', orderId: '1001', entryId: '2001' }
  delete variant.material
  delete variant.materialSource
  delete variant.materialOverrides
  record.snapshot.items[0].skuProperties = [{ label: '材质', value: '玻璃' }]
  const original = structuredClone(record),
    authoring = await createProductAuthoring({
      repository: {
        listPreparations: async () => [structuredClone(preparation)],
        getPackingPreferences: async () => validatePackingPreferences({}),
      },
      getRecords: () => [record],
    })
  assert.equal(authoring.preparedRows([ref])[0].material, '玻璃')
  await authoring.openEditor(ref)
  assert.equal(
    document.querySelector('[data-authoring-field="material"]').value,
    'Glass'
  )
  document.querySelector('[data-action="edit-order-product"]').close()
  variant.material = ''
  variant.materialSource = 'manual'
  await authoring.reload()
  assert.equal(authoring.preparedRows([ref])[0].material, '')
  await authoring.openEditor(ref)
  assert.equal(
    document.querySelector('[data-authoring-field="material"]').value,
    ''
  )
  assert.deepEqual(record, original)
  document.querySelector('[data-action="edit-order-product"]').close()
  authoring.dispose()
})

test('Backlog exposes the repository size-mapping warning without changing shipment or remainder facts', async (testContext) => {
  const { document } = dom(testContext),
    record = syntheticOrder('1001'),
    order = {
      accountId: 'local',
      orderId: '1001',
      record,
      remainingQuantity: '100',
      knownCartons: 5,
      shipmentStatus: 'not-shipped',
      packingReadiness: 'ready',
      issues: ['SIZE_MAPPING_REQUIRED'],
    },
    before = structuredClone(order),
    backlog = await mountBacklog(document.getElementById('host'), {
      repository: {
        getBacklog: async () => ({
          orders: [order],
          totals: { quantity: '100', cartons: 5 },
        }),
      },
    })
  assert.match(
    document.querySelector('tbody [role="status"]').textContent,
    /Map this variant size/
  )
  assert.match(document.querySelector('tbody tr').textContent, /100/)
  assert.deepEqual(order, before)
  backlog.destroy()
})

test('measurements on calculated capacity proposals stay in the same draft until one physical confirmation', async (testContext) => {
  const fixture = exceptionSessionFixture()
  fixture.context.batches = []
  fixture.context.record.unitsPerCarton = { 2001: '50' }
  const session = await fixture.create()
  testContext.after(() => session.dispose())
  const proposed = session.projection().cartons[0]
  assert.equal(proposed.count, 2)
  session.editCell(proposed.key, 'dimensions', '50×50×50')
  await session.commitCell(proposed.key, 'dimensions', '50×50×50')
  session.editCell(proposed.key, 'weight', '9.5')
  await session.commitCell(proposed.key, 'weight', '9.5')
  assert.equal(fixture.confirmed.length, 0)
  const staged = fixture.drafts.at(-1).draft.plannerDraft.cartons[0]
  assert.equal(staged.count, 2)
  assert.equal(staged.weight, '9.5')
  assert.equal(staged.len, '50')
  await session.confirm()
  assert.equal(fixture.confirmed.length, 1)
  assert.equal(fixture.confirmed[0].draft.cartons[0].weight, '9.5')
})

test('successive measurements on a confirmed carton retain all previously staged fields in durable recovery', async (testContext) => {
  const fixture = exceptionSessionFixture(),
    session = await fixture.create()
  testContext.after(() => session.dispose())
  session.editCell(fixture.batch.id, 'dimensions', '80.125×50×30')
  await session.commitCell(fixture.batch.id, 'dimensions', '80.125×50×30')
  session.editCell(fixture.batch.id, 'weight', '30.750000000000000001')
  await session.commitCell(fixture.batch.id, 'weight', '30.750000000000000001')
  const staged = fixture.drafts.at(-1).draft.plannerDraft.cartons[0]
  assert.equal(staged.len, '80.125')
  assert.equal(staged.wid, '50')
  assert.equal(staged.ht, '30')
  assert.equal(staged.weight, '30.750000000000000001')
  assert.deepEqual(staged.contents, fixture.batch.contents)
  assert.equal(fixture.batch.len, '50')
  assert.equal(fixture.confirmed.length, 0)
})

test('independent same-order marks and literal carton references stage without changing contents, measurements or source history', async (testContext) => {
  const fixture = exceptionSessionFixture(),
    before = structuredClone(fixture.batch)
  fixture.context.preparation.groups = [
    { id: 'g1', baseCode: 'CE26090101', variants: [] },
    { id: 'g2', baseCode: 'CE26090102', variants: [] },
  ]
  const session = await fixture.create()
  testContext.after(() => session.dispose())
  await assert.rejects(
    session.stageCartonIdentity({
      batchId: fixture.batch.id,
      cartonNumber: '001',
      markGroupId: 'other-order',
    }),
    /must belong/
  )
  assert.equal(fixture.drafts.length, 0)
  await session.stageCartonIdentity({
    batchId: fixture.batch.id,
    cartonNumber: '001',
    markGroupId: 'g2',
  })
  assert.equal(fixture.confirmed.length, 0)
  const staged = fixture.drafts.at(-1).draft.plannerDraft.cartons[0]
  assert.deepEqual(staged.mark, { orderId: '1001', groupId: 'g2' })
  assert.equal(staged.cartonNumber, '001')
  for (const key of [
    'id',
    'count',
    'contents',
    'len',
    'wid',
    'ht',
    'weight',
    'weightBasis',
  ])
    assert.deepEqual(staged[key], before[key])
  await session.confirm()
  assert.equal(fixture.confirmed.length, 1)
  assert.deepEqual(fixture.batch, before)
})

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
test('purchase evidence refresh retry never repeats a committed mutation after a failed read', async (testContext) => {
  const { document } = authoringEnvironment(testContext),
    record = syntheticOrder('1001')
  let writes = 0,
    failRead = true
  const authoring = await createProductAuthoring({
    repository: {
      listPreparations: async () => [],
      getPackingPreferences: async () => validatePackingPreferences({}),
      getOrderReconciliation: async () => ({ record, revisions: {} }),
      setInventoryDispositions: async () => {
        writes++
        return { record }
      },
    },
    getRecords: () => [record],
    changed: async () => {
      if (failRead) throw new Error('Synthetic refresh unavailable')
    },
  })
  await authoring.openInventoryRecovery({
    accountId: 'local',
    orderId: '1001',
    entryId: '2001',
  })
  const modal = document.querySelector(
      '[data-action="review-purchase-evidence"]'
    ),
    save = modal.querySelector('[data-action="save-inventory-disposition"]')
  save.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(writes, 1)
  assert.equal(save.disabled, true)
  assert.match(
    modal.querySelector('[role="status"]').textContent,
    /refresh unavailable/
  )
  failRead = false
  modal.querySelector('[data-action="retry-evidence-refresh"]').click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(writes, 1)
  assert.equal(modal.isConnected, false)
  authoring.dispose()
})

test('grid basis values translate live without replacing pending input and styled codes retain their copy feedback', async (testContext) => {
  const { document, window } = dom(testContext),
    fixture = exceptionSessionFixture(),
    language = getLanguage()
  fixture.context.preparation = syntheticManifest().orders[0].preparation
  const session = await fixture.create(),
    host = document.getElementById('host')
  let grid = mountOrderCartonGrid(host, { session })
  assert.ok(host.querySelector('[data-column="code"] .ce-code [role="status"]'))
  grid.destroy()
  grid = mountOrderCartonGrid(host, { session, kind: 'cartons' })
  const input = host.querySelector('[data-grid-column="weight"]'),
    basis = host.querySelector('[data-column="weightBasis"] button')
  input.value = '保留原始草稿'
  input.dispatchEvent(new window.Event('input'))
  setLanguage('es', { persist: false })
  assert.equal(basis.firstElementChild.textContent, 'Por caja')
  assert.equal(host.querySelector('[data-grid-column="weight"]'), input)
  assert.equal(input.value, '保留原始草稿')
  setLanguage('zh', { persist: false })
  assert.equal(basis.firstElementChild.textContent, '每箱')
  assert.equal(input.value, '保留原始草稿')
  grid.destroy()
  session.dispose()
  setLanguage(language, { persist: false })
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
    revisionId: null,
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
    listContainers: async () => [structuredClone(current.container)],
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

test('Packing filters only row facts and full logical selection spans the virtual window without domain writes', async (testContext) => {
  const { document, window } = dom(testContext),
    fixture = setup(),
    state = view(),
    original = {
      snapshot: {
        items: [{ entryId: 'e149', description: 'TARGET ONLY LAST' }],
      },
    }
  state.products = Array.from({ length: 150 }, (_, index) => ({
    accountId: 'local',
    orderId: '1001',
    entryId: `e${index}`,
    description: index === 149 ? 'TARGET ONLY LAST' : `Other source ${index}`,
    barcode: `CE2609${String(index).padStart(4, '0')}`,
    quantity: '10',
    loadedQuantity: '10',
    price: '2.00',
    record: original,
  }))
  fixture.setView(state)
  const host = document.getElementById('host'),
    workspace = createContainerWorkspace({
      host,
      repository: fixture.repository,
      output: {},
    })
  await workspace.open('c1')
  workspace.show('packing-list')
  assert.equal(host.querySelectorAll('tr[data-container-row]').length, 100)
  host.querySelector('[data-action="select-all-rows"]').click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(
    host.querySelector('[data-selected-count]').dataset.selectedCount,
    '150'
  )
  workspace.show('loading')
  assert.equal(
    host.querySelector('[data-selected-count]').dataset.selectedCount,
    '0'
  )
  workspace.show('packing-list')
  assert.equal(
    host.querySelector('[data-selected-count]').dataset.selectedCount,
    '150'
  )
  const search = host.querySelector('input[type="search"]')
  search.value = 'TARGET ONLY LAST'
  search.dispatchEvent(new window.Event('input'))
  assert.equal(host.querySelectorAll('tr[data-container-row]').length, 1)
  assert.equal(
    host.querySelector('tr[data-container-row]').dataset.containerRow,
    JSON.stringify(['local', '1001', 'e149'])
  )
  assert.equal(
    host.querySelector('[data-selected-count]').dataset.selectedCount,
    '150'
  )
  host.querySelector('[data-action="clear-selection"]').click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(
    host.querySelector('[data-selected-count]').dataset.selectedCount,
    '0'
  )
  host.querySelector('[data-action="select-all-rows"]').click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(
    host.querySelector('[data-selected-count]').dataset.selectedCount,
    '1'
  )
  assert.equal(fixture.writes.length, 0)
  workspace.dispose()
})

test('a pending container read blocks old-view loading decisions until the selected route has settled', async () => {
  const fixture = setup(),
    read = fixture.repository.getContainerView
  let release
  const wait = new Promise((resolve) => {
    release = resolve
  })
  fixture.repository.getContainerView = async (args) => {
    if (args.id === 'c2') await wait
    return read(args)
  }
  await fixture.controller.open('c1')
  const opening = fixture.controller.open('c2')
  assert.equal(fixture.controller.busy(), true)
  await assert.rejects(
    fixture.controller.markAllLoaded(),
    /Wait for the current container operation/
  )
  assert.equal(fixture.writes.length, 0)
  release()
  await opening
  await fixture.controller.markAllLoaded()
  assert.equal(fixture.writes[0].args.id, 'c2')
})

test('direct container routes populate the selector and preserve a historical revision on view refresh', async (testContext) => {
  const { document } = dom(testContext),
    fixture = setup(),
    state = view()
  state.draft = false
  state.revisionId = 'c1-r1'
  state.container.revisions = ['c1-r1']
  fixture.setView(state)
  const reads = [],
    read = fixture.repository.getContainerView
  fixture.repository.getContainerView = async (args) => {
    reads.push(args)
    return read(args)
  }
  const workspace = createContainerWorkspace({
    host: document.getElementById('host'),
    repository: fixture.repository,
    output: {},
  })
  await workspace.open('c1', 'c1-r1')
  assert.equal(
    document.querySelector('[data-action="choose-container"]').value,
    'c1'
  )
  await workspace.reload()
  assert.equal(reads.at(-1).revisionId, 'c1-r1')
  assert.equal(workspace.route().revisionId, 'c1-r1')
  assert.equal(fixture.writes.length, 0)
  workspace.dispose()
})

test('partial marks use captured physical participation, Se quedó copies its own side and workbook export keeps the full revision', async (testContext) => {
  const { document, window } = dom(testContext),
    fixture = setup(),
    state = view(),
    calls = []
  state.draft = false
  state.revisionId = 'c1-r1'
  state.products = [
    {
      ...ref,
      entryId: 'a',
      quantity: '10',
      barcode: 'CE26090101',
      cartonReferences: ['box1'],
    },
    {
      ...ref,
      entryId: 'b',
      quantity: '20',
      barcode: 'CE26090102',
      cartonReferences: ['box2'],
    },
  ]
  state.cartons = [
    { id: 'box1', batchId: 'b1', state: 'loaded' },
    { id: 'box2', batchId: 'b2', state: 'loaded' },
  ]
  state.leftBehind.products = [
    { ...ref, entryId: 'c', quantity: '5', cartonReferences: ['box3'] },
  ]
  state.leftBehind.cartons = [
    { id: 'box3', batchId: 'b3', state: 'left-behind' },
  ]
  fixture.setView(state)
  const workspace = createContainerWorkspace({
    host: document.getElementById('host'),
    repository: fixture.repository,
    output: {
      containerContext: async (scope) => {
        assert.equal(scope.revisionId, 'c1-r1')
        return captureContainerOutput(state)
      },
      copyLabels: async (kind, context) => calls.push({ kind, context }),
      copy: async (context, format) => calls.push({ kind: format, context }),
      openWorkbook: async (context) =>
        calls.push({ kind: 'workbook', context }),
    },
  })
  await workspace.open('c1')
  workspace.show('packing-list')
  const check = document.querySelector(
    'tr[data-container-row] input[type="checkbox"]'
  )
  check.checked = true
  check.dispatchEvent(new window.Event('click', { bubbles: true }))
  document.querySelector('[data-action="copy-container-marks"]').click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(
    calls[0].context.products.map((row) => row.entryId),
    ['a']
  )
  assert.deepEqual(
    calls[0].context.cartons.map((row) => row.id),
    ['box1']
  )
  assert.equal(calls[0].context.partial, true)
  assert.equal(calls[0].context.revisionId, state.revisionId)
  workspace.show('left-behind')
  document.querySelector('[data-action="copy-values"]').click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(
    calls[1].context.products.map((row) => row.entryId),
    ['c']
  )
  assert.deepEqual(
    calls[1].context.cartons.map((row) => row.id),
    ['box3']
  )
  assert.equal(calls[1].context.outputSide, 'left-behind')
  document.querySelector('[data-action="export-packing-list"]').click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls[2].kind, 'workbook')
  assert.equal(calls[2].context.products.length, 2)
  assert.equal(calls[2].context.cartons.length, 2)
  assert.equal(fixture.writes.length, 0)
  workspace.dispose()
})

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

test('Loading action availability follows real complete-set and physical selection state', async (testContext) => {
  const { document } = dom(testContext),
    fixture = setup(),
    state = view()
  state.cartons[0].state = 'loaded'
  fixture.setView(state)
  const workspace = createContainerWorkspace({
    host: document.getElementById('host'),
    repository: fixture.repository,
    output: {},
  })
  await workspace.open('c1')
  const all = document.querySelector('[data-action="mark-all-loaded"]'),
    selected = document.querySelector('[data-action="mark-cartons-loaded"]')
  assert.equal(all.disabled, true)
  assert.equal(selected.disabled, true)
  state.cartons[0].state = 'unconfirmed'
  fixture.setView(state)
  await workspace.reload()
  assert.equal(all.disabled, false)
  workspace.selectAll()
  assert.equal(selected.disabled, false)
  workspace.clearSelection()
  assert.equal(selected.disabled, true)
  assert.equal(fixture.writes.length, 0)
  workspace.dispose()
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

test('unsealed output captures its actual numeric draft revision without fabricating a sealed identity', () => {
  const draft = {
      ...view(),
      revisionId: null,
      revision: 4,
      draft: true,
      status: 'draft',
      products: [
        {
          ...ref,
          entryId: '2001',
          quantity: '20',
          barcode: 'CE26090101A',
          baseCode: 'CE26090101',
          spanishName: 'SYNTHETIC DRAFT',
          chineseCategory: '合成',
        },
      ],
    },
    output = captureContainerOutput(draft)
  assert.equal(output.revisionId, null)
  assert.equal(output.revision, 4)
  assert.equal(output.draft, true)
  const labels = outputLabelModels(output)
  assert.equal(labels.length, 1)
  assert.equal(labels[0].quantity, '20')
  for (const item of labels)
    for (const ref of item.refs) {
      assert.equal(ref.containerId, output.containerId)
      assert.equal(ref.revisionId, null)
      assert.equal(ref.draft, true)
      assert.equal(ref.draftRevision, output.revision)
    }
  assert.equal(output.containerId, 'c1')
  draft.products.push({ orderId: 'later', entryId: 'later' })
  assert.equal(output.products.length, 1)
  assert.throws(
    () => captureContainerOutput({ ...draft, draft: false, status: 'sealed' }),
    /complete container revision/
  )
  assert.throws(
    () => captureContainerOutput({ ...draft, revisionId: 'fake-sealed-id' }),
    /complete container revision/
  )
  assert.throws(
    () =>
      captureContainerOutput({
        ...draft,
        revision: '4',
        container: { ...draft.container, revision: '4' },
      }),
    /complete container revision/
  )
})

test('whole-container historical routes need no product ref and captured draft output rejects a changed draft revision', async () => {
  const sealed = syntheticManifest(),
    draft = { ...sealed, draft: true, revisionId: null, revision: 4 },
    reads = []
  let current = sealed
  const output = createProductOutput({
    repository: {
      getContainerManifest: async (args) => {
        reads.push(args)
        return current
      },
    },
    authoring: {},
  })
  const historical = await output.containerContext({
    containerId: sealed.container.id,
    revisionId: sealed.revisionId,
  })
  assert.equal(historical.revisionId, sealed.revisionId)
  assert.deepEqual(reads[0], {
    id: sealed.container.id,
    revisionId: sealed.revisionId,
  })
  current = draft
  await assert.rejects(
    output.containerContext({
      containerId: draft.container.id,
      draft: true,
      draftRevision: 3,
    }),
    /container changed before output was captured/
  )
  const captured = await output.containerContext({
    containerId: draft.container.id,
    draft: true,
    draftRevision: 4,
  })
  assert.equal(captured.revisionId, null)
  assert.equal(captured.revision, 4)
})

test('chosen-column output exposes the shared Headers preference and the captured row count across reopening and languages', async (testContext) => {
  const { document, window } = authoringEnvironment(testContext),
    context = captureContainerOutput(syntheticManifest()),
    previousLanguage = getLanguage()
  let includeHeaders = true
  const output = createProductOutput({
    repository: {},
    authoring: {},
    headers: () => includeHeaders,
    setHeaders: (value) => {
      includeHeaders = value
    },
  })
  testContext.after(() => setLanguage(previousLanguage, { persist: false }))
  await output.copyPreparation(context)
  let modal = document.querySelector('.preparation-column-dialog'),
    header = modal.querySelector('input[aria-label="Headers"]')
  assert.equal(header.checked, true)
  assert.equal(
    modal.querySelector('.copy-row-count').textContent,
    `Copy ${context.products.length} product rows`
  )
  header.checked = false
  header.dispatchEvent(new window.Event('change'))
  assert.equal(includeHeaders, false)
  modal.close()
  await output.copyPreparation(context)
  modal = document.querySelector('.preparation-column-dialog')
  header = modal.querySelector('input[aria-label="Headers"]')
  assert.equal(header.checked, false)
  modal.querySelector('.popup-language-toggle [data-language="zh"]').click()
  assert.notEqual(header.getAttribute('aria-label'), 'Headers')
  assert.equal(getLanguage(), previousLanguage)
  assert.equal(header.checked, false)
  modal.close()
})

test('chosen-column barcode copying refuses an unresolved variant before any clipboard write', async (testContext) => {
  const { document } = authoringEnvironment(testContext),
    source = syntheticManifest()
  source.products[0].needsSizeMapping = true
  source.products[0].barcode = ''
  const context = captureContainerOutput(source),
    output = createProductOutput({ repository: {}, authoring: {} })
  await output.copyPreparation(context)
  const modal = document.querySelector('.preparation-column-dialog'),
    copy = modal.querySelector('button.primary')
  assert.equal(modal.querySelector('input[value="barcode"]').checked, true)
  copy.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.match(
    document.body.textContent,
    /Map this variant size before generating labels/
  )
  assert.equal(copy.classList.contains('copy-failed'), true)
  assert.equal(
    modal.querySelector('input[aria-label="Headers"]').disabled,
    false
  )
  modal.close()
})

test('shared-code labels retain separate source refs and exact source-line quantities', () => {
  const manifest = view()
  manifest.draft = false
  manifest.revisionId = 'c1-r1'
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

test('pending variant sizes block barcode output while a known base carton mark keeps its own identity', () => {
  const context = {
    kind: 'orders-selection',
    products: [
      {
        ...ref,
        entryId: '2001',
        groupId: 'g1',
        variantId: 'v1',
        baseCode: 'CE26090101',
        barcode: '',
        needsSizeMapping: true,
        chineseCategory: '合成纸箱',
        spanishName: 'SYNTHETIC',
        quantity: '100',
      },
    ],
  }
  assert.throws(
    () => outputLabelModels(context, 'barcode'),
    /Map this variant size/
  )
  const marks = outputLabelModels(context, 'mark')
  assert.equal(marks.length, 1)
  assert.equal(marks[0].code, 'CE26090101')
  assert.equal(context.products[0].needsSizeMapping, true)
  assert.equal(context.products[0].barcode, '')
})

test('captured manual-source label and mark summaries preserve the exact original reference field', () => {
  const row = {
    ...ref,
    entryId: '2001',
    groupId: 'g1',
    variantId: 'v1',
    source: 'other',
    orderReference: 'EXT-MANUAL-1',
    barcode: 'CE26090101',
    baseCode: 'CE26090101',
    spanishName: 'SYNTHETIC',
    chineseCategory: '合成',
    quantity: '2',
  }
  for (const kind of ['barcode', 'mark']) {
    const item = outputLabelModels(
      { kind: 'orders-selection', products: [row] },
      kind
    )[0]
    assert.deepEqual(item.orders[0], {
      accountId: 'local',
      orderId: ref.orderId,
      seller: '',
      source: 'other',
      reference: 'EXT-MANUAL-1',
    })
  }
  const explicit = outputLabelModels({
    products: [{ ...row, reference: 'DIRECT-REFERENCE' }],
  })[0]
  assert.equal(explicit.orders[0].reference, 'DIRECT-REFERENCE')
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
    context,
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

test('report recovery isolates canceled epochs while retaining exact text and scoped decisions for explicit reuse', async (testContext) => {
  authoringEnvironment(testContext)
  const fixture = reportFixture(),
    token = { containerId: 'c1', epoch: 'first' }
  fixture.context.expectedRevisions.amendmentContext = token
  const options = { ...fixture, orderRef: ref, contextContainerId: 'c1' },
    first = await createPackingReportIntakeController(options),
    text = '箱号\t货号\t装箱数\r\n001\t0007\t13\r\n',
    request = { id: 'meaning', scope: { header: '装箱数' } }
  await first.read({ text })
  first.choose(request, 'per-carton')
  fixture.context.expectedRevisions.amendmentContext = {
    containerId: 'c1',
    epoch: 'reopened',
  }
  const reopened = await createPackingReportIntakeController(options)
  assert.equal(reopened.state().text, undefined)
  assert.equal(reopened.state().source, null)
  assert.equal(reopened.state().recoveredDrafts[0].text, text)
  assert.deepEqual(reopened.state().recoveredDrafts[0].amendmentContext, token)
  reopened.inputText('new draft must not erase older source')
  const again = await createPackingReportIntakeController(options),
    old = again.state().recoveredDrafts[0]
  assert.equal(old.text, text)
  again.recoverReviewed(old)
  assert.equal(again.state().text, text)
  assert.deepEqual(again.state().decisions.meaning, {
    scope: request.scope,
    value: 'per-carton',
  })
  assert.equal(again.state().plan, null)
  await again.updateReview()
  await again.plan()
  await again.commit()
  assert.equal(
    fixture.calls.filter((call) => call.operation === 'commit').length,
    1
  )
  assert.equal(
    fixture.calls.at(-1).input.expectedRevisions.amendmentContext.epoch,
    'reopened'
  )
})

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

test('repository amendment routing retains report recovery and forwards the active amendment context on reads and commit', async (context) => {
  const fixture = reportFixture(),
    values = new Map(),
    reads = [],
    commits = [],
    previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    configurable: true,
  })
  context.after(() =>
    previous
      ? Object.defineProperty(globalThis, 'localStorage', previous)
      : delete globalThis.localStorage
  )
  const originalRead = fixture.repository.getPackingReportContext
  fixture.repository.getPackingReportContext = async (args) => {
    reads.push(args)
    return originalRead(args)
  }
  fixture.repository.commitPackingReportUpdate = async (args) => {
    commits.push(args)
    return {
      status: 'amendment-required',
      affectedShipmentRevisions: [{ containerId: 'c1', revisionId: 'c1-r1' }],
    }
  }
  const controller = await createPackingReportIntakeController({
    ...fixture,
    orderRef: ref,
    contextContainerId: 'active-amendment',
  })
  context.after(() => controller.dispose())
  await controller.read({ text: '箱号\t货号\t装箱数\r\n001\t0007\t13' })
  await controller.plan()
  const result = await controller.commit()
  assert.equal(result.status, 'amendment-required')
  assert.equal(controller.state().plan.status, 'amendment-required')
  assert.equal(commits.length, 1)
  assert.equal(commits[0].contextContainerId, 'active-amendment')
  assert.ok(
    reads.every((args) => args.contextContainerId === 'active-amendment')
  )
  const recovered = JSON.parse([...values.values()][0])
  assert.equal(
    recovered.source.rawAssetRef,
    controller.state().source.rawAssetRef
  )
  assert.equal(recovered.text, '箱号\t货号\t装箱数\r\n001\t0007\t13')
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

test('blank and invalid loading counts remain recoverable UI drafts and never become zero loading decisions', async (testContext) => {
  const { document, window, values } = authoringEnvironment(testContext),
    fixture = setup(),
    state = view()
  state.cartons = Array.from({ length: 5 }, (_, index) => ({
    id: `count-${index}`,
    batchId: 'batch1',
    accountId: 'local',
    orderId: '10001',
    count: 1,
    state: 'unconfirmed',
    canSelectCount: index === 0,
    contents: [],
  }))
  fixture.setView(state)
  const make = async () => {
    const workspace = createContainerWorkspace({
      host: document.getElementById('host'),
      repository: fixture.repository,
      output: {},
    })
    await workspace.open('c1')
    document
      .querySelector('.container-order [data-action="expand-container-order"]')
      .click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    return workspace
  }
  let workspace = await make(),
    input = document.querySelector('input[role="spinbutton"]')
  input.value = '-'
  input.dispatchEvent(new window.Event('input'))
  input.dispatchEvent(new window.Event('blur'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(fixture.writes.length, 0)
  assert.equal(input.getAttribute('aria-invalid'), 'true')
  assert.ok([...values.values()].some((value) => value.includes('"raw":"-"')))
  workspace.dispose()
  workspace = await make()
  input = document.querySelector('input[role="spinbutton"]')
  assert.equal(input.value, '-')
  assert.equal(input.getAttribute('aria-invalid'), 'true')
  input.value = ''
  input.dispatchEvent(new window.Event('input'))
  input.dispatchEvent(new window.Event('blur'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(fixture.writes.length, 0)
  input.value = '0'
  input.dispatchEvent(new window.Event('input'))
  const enter = new window.Event('keydown')
  enter.key = 'Enter'
  input.dispatchEvent(enter)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(fixture.writes.length, 1)
  assert.equal(fixture.writes[0].args.leftBehind, 0)
  workspace.dispose()
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
    '.container-main input[role="spinbutton"]'
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
    document.querySelectorAll('.container-main input[role="spinbutton"]')
      .length,
    0
  )
})
