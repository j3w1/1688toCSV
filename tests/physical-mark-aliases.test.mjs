import test from 'node:test'
import assert from 'node:assert/strict'
import { read } from 'xlsx'
import {
  createPreparation,
  allocatePreparation,
  activePackingState,
} from '../src/packing-model.js'
import { regroupSelection } from '../src/packing-grouping.js'
import {
  planCartonBatchChanges,
  resolvePhysicalMarkChange,
} from '../src/carton-batch-changes.js'
import { cartonBatchReviewChanges } from '../src/carton-batch-review.js'
import { validateCartonBatch } from '../src/carton-batches.js'
import {
  transitionPhysicalMark,
  physicalMarkReadback,
} from '../src/physical-mark-aliases.js'
import {
  physicalMarkReservations,
  consumptionLocksForManifest,
  historicalCodeReservations,
  assertConsumedCodeChanges,
  recoverPhysicalMarkAliases,
  retirePhysicalMarkAliases,
} from '../src/purchase-codes.js'
import {
  captureContainerOrder,
  projectContainer,
  assertManifestEvidence,
} from '../src/container-model.js'
import {
  createContainerSummary,
  createContainerWorkbook,
  containerPrintRows,
} from '../src/container-export.js'
import {
  syntheticOrder,
  syntheticBatch,
} from './fixtures/container-fixture.mjs'
import { databaseBrowser } from './fixtures/database-browser.mjs'
import { createPackingBackup } from '../src/packing-backup.js'

const time = '2026-10-23T05:00:00.000Z'
function fixture({ legacy = false } = {}) {
  const record = syntheticOrder('1001', '30', {
    purchasedAt: '2026-10-04T12:00:00+08:00',
  })
  record.snapshot.items.push({
    ...structuredClone(record.snapshot.items[0]),
    entryId: '2002',
    title: 'Synthetic plates',
    description: 'Synthetic plates',
  })
  for (const key of ['goodsGross', 'goodsNet', 'payable'])
    record.snapshot.totals[key] = '600.00'
  const draft = createPreparation(record.snapshot, '2026-10')
  for (const group of draft.groups) {
    group.spanishName = 'PRODUCTO'
    group.category = '合成商品'
  }
  draft.groups[0].category = '首组'
  draft.groups[1].category = '原唛'
  const allocated = allocatePreparation(
    draft,
    [
      {
        accountId: 'local',
        month: '2026-10',
        groups: [{ number: 10, sellerId: 'synthetic-factory', nextItem: 1 }],
      },
    ],
    [],
    { snapshot: record.snapshot }
  )
  const preparation = { ...allocated.preparation, revision: 1, updatedAt: time }
  const batch = validateCartonBatch(
    syntheticBatch('1001', 6, '30', {
      month: '2026-10',
      packingBasis: 'aggregate',
      groups: [{ orderId: '1001', groupId: preparation.groups[1].id }],
      contents: [{ orderId: '1001', entryId: '2002', quantity: '30' }],
      len: '40.125',
      wid: '30',
      ht: '25',
      weightBasis: 'batch',
      weight: '57.2202',
      received: 6,
      loaded: legacy ? 2 : 0,
      sourceFacts: {
        report: 'Synthetic original six-carton report',
        suppliedWeight: '57.2202',
      },
      cartonHistory: [
        {
          id: 'retained-original',
          weight: '0',
          sourceFacts: { original: true },
        },
      ],
      ...(legacy
        ? {
            legacyReview: {
              kind: 'legacy-loading',
              reason: 'Retain unverified historical loading.',
            },
            needsReview: true,
          }
        : {}),
    })
  )
  if (legacy) {
    delete batch.orderId
    delete batch.packingBasis
    delete batch.unresolvedContents
    delete batch.volumeBasis
  }
  return {
    records: [record],
    preparations: [preparation],
    batches: [batch],
    allocations: allocated.allocations,
    issuedCodes: allocated.issuedCodes,
    containers: [],
    reports: [],
    locks: [],
  }
}

function independentMarkFixture() {
  const state = fixture(),
    record = state.records[0],
    prep = state.preparations[0]
  const item = {
    ...structuredClone(record.snapshot.items[0]),
    entryId: '2003',
    title: 'Synthetic bowls',
    description: 'Synthetic bowls',
  }
  record.snapshot.items.push(item)
  for (const field of ['goodsGross', 'goodsNet', 'payable'])
    record.snapshot.totals[field] = '900.00'
  const draft = createPreparation(
    { ...record.snapshot, items: [item] },
    '2026-10'
  )
  draft.groups[0].spanishName = 'CONTENIDO'
  draft.groups[0].category = '内装'
  const added = allocatePreparation(
    draft,
    state.allocations,
    state.issuedCodes,
    { snapshot: record.snapshot }
  )
  prep.groups.push(...added.preparation.groups)
  state.allocations = added.allocations
  state.issuedCodes = added.issuedCodes
  const batch = state.batches[0]
  batch.mark = { orderId: '1001', groupId: prep.groups[1].id }
  batch.groups = [{ orderId: '1001', groupId: prep.groups[2].id }]
  batch.contents = [{ orderId: '1001', entryId: '2003', quantity: '30' }]
  return state
}
async function mergePlan(state) {
  const prep = state.preparations[0]
  const next = await regroupSelection(
    prep.groups.map((group) => ({
      draft: prep,
      group,
      variants: group.variants,
      complete: true,
    })),
    'merge',
    { getReservedBarcodes: async () => [] }
  )
  return {
    next,
    plan: planCartonBatchChanges({
      batches: state.batches,
      records: state.records,
      beforePreparations: state.preparations,
      afterPreparations: next,
    }),
  }
}
function projected(state) {
  const container = {
    id: 'physical-alias-container',
    accountId: 'local',
    name: 'Synthetic alias',
    period: '2026-11',
    loadingDate: '2026-11-01',
    status: 'draft',
    revision: 1,
    revisions: [],
    draft: { orders: [], decisions: {} },
  }
  container.draft.orders = [
    captureContainerOrder(state, { orderId: '1001' }, container.id),
  ]
  for (const carton of container.draft.orders[0].cartons)
    container.draft.decisions[carton.id] = 'loaded'
  return projectContainer(state, container)
}

test('six-carton merge review preserves evidence and makes the old physical code an explicit pending alias', async () => {
  const state = fixture({ legacy: true }),
    original = structuredClone(state)
  const { next, plan } = await mergePlan(state)
  assert.deepEqual(state, original)
  assert.equal(next[0].groups.length, 1)
  assert.equal(plan.changes.length, 1)
  const after = plan.after[state.batches[0].id]
  assert.equal(after.physicalMark.originalCode, 'CE26101002')
  assert.equal(after.physicalMark.code, 'CE26101002')
  assert.equal(after.physicalMark.productCode, 'CE26101001')
  assert.equal(after.physicalMark.resolution, null)
  for (const field of [
    'id',
    'count',
    'len',
    'wid',
    'ht',
    'received',
    'loaded',
    'weight',
    'weightBasis',
    'contents',
    'sourceFacts',
    'cartonHistory',
  ])
    assert.deepEqual(after[field], original.batches[0][field], field)
  assert.equal(plan.reviews[0].resolutionRequired, true)
  assert.deepEqual(plan.reviews[0].resolutionChoices, [
    'keep-recorded-mark',
    'relabel-reprint',
  ])
  assert.equal(
    cartonBatchReviewChanges(plan)[0].physicalMark.originalCode,
    'CE26101002'
  )
  const reserved = physicalMarkReservations({
    ...state,
    preparations: next,
    batches: [after],
  })
  assert.equal(reserved[0].code, 'CE26101002')
  assert.equal(reserved[0].groupId, next[0].groups[0].id)
  const missingSource = structuredClone(state.records[0])
  missingSource.snapshot.items = []
  assert.ok(
    physicalMarkReservations({
      ...state,
      records: [missingSource],
      preparations: next,
      batches: [after],
    }).some((entry) => entry.code === 'CE26101002'),
    'A missing source observation is not an authored retirement'
  )
  const reprint = resolvePhysicalMarkChange(plan, {
    batchId: after.id,
    choice: 'relabel-reprint',
    reason: 'Synthetic reprint preview',
    physicalRelabelConfirmed: true,
  })
  const keep = resolvePhysicalMarkChange(reprint, {
    batchId: after.id,
    choice: 'keep-recorded-mark',
    reason: 'Keep actual recorded mark instead',
  })
  assert.equal(keep.after[after.id].physicalMark.code, 'CE26101002')
  assert.equal(plan.after[after.id].physicalMark.resolution, null)
})

for (const choice of ['keep-recorded-mark', 'relabel-reprint'])
  test(`${choice} retains provenance and freezes both codes in manifest, print, XLSX and JSON`, async () => {
    const state = fixture(),
      { next, plan } = await mergePlan(state)
    const chosen = resolvePhysicalMarkChange(plan, {
      batchId: state.batches[0].id,
      choice,
      reason: 'Synthetic explicit physical review',
      physicalRelabelConfirmed: true,
    })
    const after = transitionPhysicalMark(
      state.batches[0],
      chosen.changes[0].after,
      state.preparations,
      next,
      {
        decision: chosen.changes[0].physicalMarkResolution,
        updatedAt: time,
        issuedCodes: state.issuedCodes,
      }
    )
    const current = {
      ...state,
      preparations: next,
      batches: [validateCartonBatch(after)],
    }
    const draft = projected(current)
    assert.equal(draft.readiness.ready, true, JSON.stringify(draft.issues))
    const manifest = {
      ...draft,
      draft: false,
      status: 'sealed',
      revisionId: 'physical-alias-r1',
      sealedAt: time,
    }
    const expected =
      choice === 'keep-recorded-mark' ? 'CE26101002' : 'CE26101001'
    assert.equal(manifest.cartons.length, 6)
    assert.equal(manifest.totals.weight, '57.2202')
    assert.equal(manifest.cartons[0].markCode, expected)
    assert.equal(manifest.cartons[0].currentProductCode, 'CE26101001')
    assert.deepEqual(manifest.cartons[0].physicalMark, after.physicalMark)
    assertManifestEvidence(manifest)
    const print = containerPrintRows(manifest, { kind: 'mark' })
    assert.equal(print[0].baseCode, expected)
    assert.equal(print[0].physicalMark.originalCode, 'CE26101002')
    assert.equal(
      print[0].category,
      choice === 'keep-recorded-mark' ? '原唛' : '首组'
    )
    assert.equal(print[0].group.baseCode, expected)
    assert.equal(print[0].currentProductGroup.baseCode, 'CE26101001')
    assert.equal(print[0].currentProductArtwork.category, '首组')
    assert.equal(print[0].physicalMark.originalArtwork.category, '原唛')
    assert.equal(print[0].physicalMark.artwork.category, print[0].category)
    const summary = createContainerSummary(manifest, {
      file: 'synthetic-physical.xlsx',
    })
    assert.equal(summary.cartons[0].physicalMarkCode, expected)
    assert.equal(summary.cartons[0].currentProductCode, 'CE26101001')
    assert.equal(
      summary.cartons[0].physicalMark.resolution.reason,
      'Synthetic explicit physical review'
    )
    const workbook = read(
      await createContainerWorkbook(manifest, { language: 'en' }),
      { type: 'array' }
    )
    const cells = Object.values(workbook.Sheets.Cartons).map((cell) => cell?.v)
    assert.ok(cells.includes(expected))
    assert.ok(cells.includes('CE26101001'))
    assert.ok(cells.includes('Current product code'))
    const locks = consumptionLocksForManifest(manifest, current)
    assert.ok(
      historicalCodeReservations(locks).some(
        (reservation) => reservation.code === 'CE26101002'
      )
    )
    const aliases = locks
      .flatMap((lock) => lock.lineages)
      .filter((lineage) => lineage.physicalMarkAlias)
    assert.ok(aliases.length)
    assert.doesNotThrow(() =>
      assertConsumedCodeChanges({ previous: next, preparations: next, locks })
    )
    const foreign = structuredClone(next[0])
    foreign.orderId = '1002'
    foreign.groups[0].id = 'unrelated'
    foreign.groups[0].baseCode = 'CE26101002'
    assert.throws(
      () =>
        activePackingState([...next, foreign], current.allocations, [], {
          historicalReservations: historicalCodeReservations(locks),
        }),
      /already|conflict|owned|assigned/i
    )
    assert.throws(
      () =>
        resolvePhysicalMarkChange(plan, {
          batchId: after.id,
          choice: 'relabel-reprint',
          reason: 'No attestation',
        }),
      { code: 'PHYSICAL_MARK_REVIEW_REQUIRED' }
    )
  })

test('unresolved physical marks block verified readiness without altering known aggregate contents or measurements', async () => {
  const state = fixture(),
    { next, plan } = await mergePlan(state)
  const manifest = projected({
    ...state,
    preparations: next,
    batches: [plan.changes[0].after],
  })
  assert.equal(manifest.readiness.ready, false)
  assert.ok(
    manifest.issues.some((issue) => issue.code === 'PHYSICAL_MARK_UNRESOLVED')
  )
  assert.equal(manifest.cartons[0].contents, null)
  assert.equal(manifest.totals.weight, '57.2202')
  assert.equal(manifest.products[0].quantity, '30')
})

test('a zero-piece independent mark follows its own source lineage after grouping, with month-less facts and distinct contained product codes intact', async () => {
  const state = fixture(),
    prep = state.preparations[0]
  const third = structuredClone(prep.groups[0])
  third.id = 'independent-contents-group'
  third.baseCode = 'CE26101003'
  third.variants[0].id = 'independent-contents-variant'
  third.variants[0].entryIds = ['2003']
  prep.groups.push(third)
  state.records[0].snapshot.items.push({
    ...state.records[0].snapshot.items[0],
    entryId: '2003',
    title: 'Synthetic third product',
  })
  const batch = state.batches[0]
  batch.mark = structuredClone(batch.groups[0])
  batch.groups = [{ orderId: '1001', groupId: third.id }]
  batch.contents = [{ orderId: '1001', entryId: '2003', quantity: '30' }]
  delete batch.month
  const next = await regroupSelection(
    prep.groups.slice(0, 2).map((group) => ({
      draft: prep,
      group,
      variants: group.variants,
      complete: true,
    })),
    'merge',
    { getReservedBarcodes: async () => [] }
  )
  const plan = planCartonBatchChanges({
    batches: state.batches,
    records: state.records,
    beforePreparations: state.preparations,
    afterPreparations: next,
  })
  const after = plan.changes[0].after
  assert.equal(after.mark.groupId, next[0].groups[0].id)
  assert.equal(after.groups[0].groupId, third.id)
  assert.equal(after.physicalMark.productCode, 'CE26101001')
  assert.equal(after.physicalMark.code, 'CE26101002')
  assert.ok(after.physicalMark.relatedEntryIds.includes('2003'))
  const canceled = structuredClone(state.records[0])
  canceled.inventoryDispositions = Object.fromEntries(
    ['2001', '2002'].map((id) => [
      id,
      {
        kind: 'canceled',
        quantity: '30',
        reason:
          'Marked product retired; physically contained goods remain current',
      },
    ])
  )
  assert.ok(
    physicalMarkReservations({
      ...state,
      records: [canceled],
      preparations: next,
      batches: [after],
    }).some((reservation) => reservation.code === 'CE26101002')
  )
  assert.deepEqual(after.contents, batch.contents)
})

async function openFixture(browser, state) {
  return browser.page.evaluate(async (state) => {
    window.aliasDb = await modules.openDatabase({
      name: 'synthetic-physical-aliases',
    })
    await aliasDb.restoreBackup({
      format: '1688-order-library',
      version: 4,
      exportedAt: '2026-10-23T05:00:00.000Z',
      orders: state.records,
      history: [],
      images: [],
      preparations: state.preparations,
      allocations: state.allocations,
      issuedCodes: state.issuedCodes,
      packingPreferences: null,
      cartonBatches: state.batches,
    })
    return aliasDb.getOperationalState({})
  }, state)
}
async function saveMerge(browser, state, next, plan) {
  return browser.page.evaluate(
    async ({ next, plan, state }) => {
      return aliasDb.savePreparations(next, {
        expectedRevisions: state.preparations.map((prep) => prep.revision),
        expectedSnapshots: state.records.map((record) => ({
          accountId: record.snapshot.accountId,
          orderId: record.snapshot.orderId,
          observedAt: record.snapshot.observedAt,
        })),
        cartonBatchChanges: plan.changes,
        allowCartonReview: true,
      })
    },
    { state, next, plan }
  )
}

test('native grouping and compound Undo preserve actual legacy history/source facts even from empty caller histories', async () => {
  const browser = await databaseBrowser()
  try {
    const state = await openFixture(browser, fixture({ legacy: true }))
    const { next, plan } = await mergePlan(state)
    plan.changes[0].after.cartonHistory = []
    plan.changes[0].after.sourceFacts = {
      caller: 'must not replace supplier facts',
    }
    const saved = await saveMerge(browser, state, next, plan)
    const after = await browser.page.evaluate(() =>
      aliasDb.getOperationalState({})
    )
    const batch = after.batches[0]
    assert.equal(
      batch.cartonHistory.length,
      state.batches[0].cartonHistory.length + 1
    )
    assert.deepEqual(batch.sourceFacts, state.batches[0].sourceFacts)
    assert.deepEqual(
      batch.cartonHistory.at(-1).contents,
      state.batches[0].contents
    )
    assert.equal(batch.physicalMark.originalCode, 'CE26101002')
    assert.ok(
      after.issuedCodes.some(
        (reservation) =>
          reservation.code === 'CE26101002' &&
          reservation.groupId === saved[0].groups[0].id
      )
    )
    const undo = structuredClone(state.preparations[0])
    undo.revision = saved[0].revision
    const undoResult = await browser.page.evaluate(
      async ({ undo, original, revision }) => {
        await aliasDb.savePreparations([undo], {
          expectedRevisions: [undo.revision],
          cartonBatchChanges: [
            {
              after: { ...original, cartonHistory: [], sourceFacts: {} },
              expectedRevision: revision,
            },
          ],
          allowCartonReview: true,
          suffixBaselines: [undo],
        })
        return aliasDb.getOperationalState({})
      },
      { undo, original: state.batches[0], revision: batch.revision }
    )
    assert.equal(undoResult.preparations[0].groups.length, 2)
    assert.equal(undoResult.batches[0].id, batch.id)
    assert.equal(undoResult.batches[0].count, 6)
    assert.equal(undoResult.batches[0].loaded, 2)
    assert.equal(
      undoResult.batches[0].cartonHistory.length,
      batch.cartonHistory.length + 1
    )
    assert.equal(
      undoResult.batches[0].cartonHistory.at(-1).physicalMark.originalCode,
      'CE26101002'
    )
    assert.equal(undoResult.batches[0].physicalMark.code, 'CE26101002')
    assert.equal(undoResult.batches[0].physicalMarkResolutionRequired, false)
    assert.equal(undoResult.batches[0].physicalMark.artwork.category, '原唛')
    assert.deepEqual(
      undoResult.batches[0].sourceFacts,
      state.batches[0].sourceFacts
    )
    assert.deepEqual(undoResult.records, state.records)
  } finally {
    await browser.close()
  }
})

test('native guarded resolution refuses stale source, forged attestation and foreign owner, then keeps exact outputs across backup restore', async () => {
  const browser = await databaseBrowser()
  try {
    const state = await openFixture(browser, fixture()),
      { next, plan } = await mergePlan(state)
    await saveMerge(browser, state, next, plan)
    const result = await browser.page.evaluate(async () => {
      const before = await aliasDb.exportBackup({}),
        context = await aliasDb.getOrderReconciliation({ orderId: '1001' })
      const errors = []
      for (const extra of [
        { expectedRevisions: { ...context.revisions, source: 'stale' } },
        { choice: 'relabel-reprint' },
        { orderId: '1002' },
      ]) {
        try {
          await aliasDb.resolveCartonPhysicalMark({
            orderId: '1001',
            batchId: context.batches[0].id,
            expectedRevisions: context.revisions,
            choice: 'keep-recorded-mark',
            reason: 'Keep actual synthetic marks',
            ...extra,
          })
        } catch (error) {
          errors.push(error.code)
        }
      }
      const refused = await aliasDb.exportBackup({})
      const resolved = await aliasDb.resolveCartonPhysicalMark({
        orderId: '1001',
        batchId: context.batches[0].id,
        expectedRevisions: context.revisions,
        choice: 'keep-recorded-mark',
        reason: 'Keep actual synthetic marks',
        operationId: 'physical-resolution-1',
      })
      const replay = await aliasDb.resolveCartonPhysicalMark({
        orderId: '1001',
        batchId: context.batches[0].id,
        expectedRevisions: context.revisions,
        choice: 'keep-recorded-mark',
        reason: 'Keep actual synthetic marks',
        operationId: 'physical-resolution-1',
      })
      const backup = await aliasDb.exportBackup({})
      const other = await modules.openDatabase({
        name: 'synthetic-physical-alias-restored',
      })
      await other.restoreBackup(backup)
      const restored = await other.exportBackup({})
      other.close()
      return { before, refused, errors, resolved, replay, backup, restored }
    })
    assert.deepEqual(result.errors, [
      'ORDER_REVISION_CONFLICT',
      'PHYSICAL_MARK_REVIEW_REQUIRED',
      'CARTON_OWNERSHIP',
    ])
    for (const field of [
      'orders',
      'preparations',
      'cartonBatches',
      'issuedCodes',
      'operationIntents',
    ])
      assert.deepEqual(result.refused[field], result.before[field], field)
    assert.equal(result.resolved.batches[0].physicalMarkCode, 'CE26101002')
    assert.equal(result.resolved.batches[0].currentProductCode, 'CE26101001')
    assert.equal(
      result.resolved.batches[0].physicalMarkResolutionRequired,
      false
    )
    assert.deepEqual(result.replay, result.resolved)
    assert.deepEqual(result.restored.cartonBatches, result.backup.cartonBatches)
    assert.deepEqual(result.restored.issuedCodes, result.backup.issuedCodes)
    assert.deepEqual(result.backup.orders, result.before.orders)
  } finally {
    await browser.close()
  }
})

test('native legacy owner correction reopens the physical mark relation and retains original evidence before a fresh keep and seal', async () => {
  const browser = await databaseBrowser()
  try {
    const input = independentMarkFixture(),
      prep = input.preparations[0]
    input.batches[0].groups = [{ orderId: '1001', groupId: prep.groups[1].id }]
    input.batches[0].contents = [
      { orderId: '1001', entryId: '2002', quantity: '30' },
    ]
    const state = await openFixture(browser, input),
      next = await regroupSelection(
        state.preparations[0].groups.slice(0, 2).map((group) => ({
          draft: state.preparations[0],
          group,
          variants: group.variants,
          complete: true,
        })),
        'merge',
        { getReservedBarcodes: async () => [] }
      ),
      plan = resolvePhysicalMarkChange(
        planCartonBatchChanges({
          batches: state.batches,
          records: state.records,
          beforePreparations: state.preparations,
          afterPreparations: next,
        }),
        {
          batchId: state.batches[0].id,
          choice: 'keep-recorded-mark',
          reason: 'Keep original recorded marks',
        }
      )
    await saveMerge(browser, state, next, plan)
    const result = await browser.page.evaluate(async () => {
      const before = await aliasDb.getOrderReconciliation({ orderId: '1001' }),
        batch = before.batches[0],
        target = before.preparation.groups.find((group) =>
          group.variants.some((variant) => variant.entryIds.includes('2003'))
        ),
        review = await aliasDb.reviewLegacyCarton({
          batchId: batch.id,
          expectedRevision: batch.revision,
        })
      await aliasDb.resolveLegacyCarton({
        batchId: batch.id,
        expectedRevision: batch.revision,
        resolution: 'owner-corrected',
        ownerRef: { accountId: 'local', orderId: '1001' },
        mark: { orderId: '1001', groupId: target.id },
        contents: [{ orderId: '1001', entryId: '2003', quantity: '30' }],
        reason: 'Reviewed original transcription against actual contents',
        attestNotShipped: true,
        expectedOrderRevisions: review.expectedOrderRevisions,
      })
      const corrected = await aliasDb.getOrderReconciliation({
          orderId: '1001',
        }),
        container = await aliasDb.createContainer({
          name: 'Legacy corrected ownership',
        })
      let view = await aliasDb.includeContainerOrders({
        id: container.id,
        expectedRevision: container.revision,
        orderRefs: [{ orderId: '1001' }],
      })
      view = await aliasDb.markContainerLoaded({
        id: container.id,
        expectedRevision: view.container.revision,
      })
      const pending = await aliasDb.reviewContainerSeal({
        id: container.id,
        expectedRevision: view.container.revision,
      })
      await aliasDb.cancelContainer({
        id: container.id,
        expectedRevision: view.container.revision,
      })
      const kept = await aliasDb.resolveCartonPhysicalMark({
        orderId: '1001',
        batchId: batch.id,
        expectedRevisions: corrected.revisions,
        choice: 'keep-recorded-mark',
        reason: 'Fresh decision for the corrected product',
      })
      const notShippedReview = await aliasDb.reviewLegacyCarton({
        batchId: batch.id,
        expectedRevision: kept.batches[0].revision,
      })
      await aliasDb.resolveLegacyCarton({
        batchId: batch.id,
        expectedRevision: kept.batches[0].revision,
        resolution: 'not-shipped',
        reason: 'Independent legacy loading review',
        attestNotShipped: true,
        expectedOrderRevisions: notShippedReview.expectedOrderRevisions,
      })
      const sameRelation = await aliasDb.getOrderReconciliation({
        orderId: '1001',
      })
      const finalContainer = await aliasDb.createContainer({
        name: 'Fresh corrected mark',
      })
      view = await aliasDb.includeContainerOrders({
        id: finalContainer.id,
        expectedRevision: finalContainer.revision,
        orderRefs: [{ orderId: '1001' }],
      })
      view = await aliasDb.markContainerLoaded({
        id: finalContainer.id,
        expectedRevision: view.container.revision,
      })
      const ready = await aliasDb.reviewContainerSeal({
          id: finalContainer.id,
          expectedRevision: view.container.revision,
        }),
        manifest = await aliasDb.sealContainer({
          id: finalContainer.id,
          expectedRevision: view.container.revision,
          reviewToken: ready.reviewToken,
        })
      return {
        before,
        corrected,
        kept,
        sameRelation,
        pending: pending.issues,
        ready: ready.issues,
        manifest,
        backup: await aliasDb.exportBackup({}),
      }
    })
    const old = result.before.batches[0],
      corrected = result.corrected.batches[0]
    assert.equal(corrected.currentProductCode, 'CE26101003')
    assert.equal(corrected.physicalMark.code, 'CE26101002')
    assert.equal(corrected.physicalMark.productCode, 'CE26101003')
    assert.equal(corrected.physicalMark.resolution, null)
    assert.equal(corrected.physicalMarkResolutionRequired, true)
    assert.ok(corrected.physicalMark.relatedEntryIds.includes('2003'))
    assert.equal(
      corrected.physicalMark.history.at(-1).kind,
      'product-code-change'
    )
    assert.deepEqual(
      corrected.physicalMark.history.at(-1).resolution,
      old.physicalMark.resolution
    )
    assert.deepEqual(corrected.physicalMark.artwork, old.physicalMark.artwork)
    assert.deepEqual(corrected.sourceFacts, old.sourceFacts)
    assert.equal(corrected.cartonHistory.length, old.cartonHistory.length + 1)
    for (const field of [
      'id',
      'count',
      'len',
      'wid',
      'ht',
      'weight',
      'weightBasis',
      'received',
      'loaded',
    ])
      assert.deepEqual(corrected[field], old[field], field)
    assert.ok(result.pending.some((issue) => /PHYSICAL_MARK/.test(issue.code)))
    assert.equal(
      result.sameRelation.batches[0].physicalMarkResolutionRequired,
      false
    )
    assert.deepEqual(
      result.sameRelation.batches[0].physicalMark.resolution,
      result.kept.batches[0].physicalMark.resolution
    )
    assert.deepEqual(result.ready, [])
    assert.equal(result.manifest.cartons[0].markCode, 'CE26101002')
    assert.equal(result.manifest.cartons[0].currentProductCode, 'CE26101003')
    assert.deepEqual(result.backup.orders, state.records)
  } finally {
    await browser.close()
  }
})

test('native current alias reserves through carton retirement, releases after all goods cancel, and recovers an occupied revival without stealing the alias', async () => {
  const browser = await databaseBrowser()
  try {
    const state = await openFixture(browser, fixture()),
      { next, plan } = await mergePlan(state)
    await saveMerge(browser, state, next, plan)
    const foreignRecord = syntheticOrder('1002', '30', {
      purchasedAt: '2026-10-05T12:00:00+08:00',
    })
    const foreign = createPreparation(foreignRecord.snapshot, '2026-10')
    foreign.groups[0].baseCode = 'CE26101002'
    const result = await browser.page.evaluate(
      async ({ foreignRecord, foreign }) => {
        await aliasDb.restoreBackup({
          format: '1688-order-library',
          version: 1,
          exportedAt: '2026-10-23T05:00:00.000Z',
          orders: [foreignRecord],
          history: [],
          images: [],
        })
        const liveBackup = await aliasDb.exportBackup({}),
          live = await aliasDb.getOrderReconciliation({ orderId: '1001' })
        let currentConflict
        try {
          await aliasDb.savePreparations([foreign], { expectedRevisions: [0] })
        } catch (error) {
          currentConflict = error.code || error.message
        }
        const afterCurrentRefusal = await aliasDb.exportBackup({})
        await aliasDb.removeCartonBatch(live.batches[0])
        const retiredBoxes = await aliasDb.getOperationalState({})
        const dispositions = Object.fromEntries(
          ['2001', '2002'].map((id) => [
            id,
            {
              kind: 'canceled',
              quantity: '30',
              reason: 'All synthetic related goods canceled',
            },
          ])
        )
        await aliasDb.setInventoryDispositions({
          orderId: '1001',
          entries: dispositions,
        })
        const canceled = await aliasDb.getOperationalState({})
        await aliasDb.savePreparations([foreign], { expectedRevisions: [0] })
        const beforeRevival = await aliasDb.exportBackup({})
        let revivalConflict
        try {
          await aliasDb.setInventoryDispositions({
            orderId: '1001',
            entries: { 2001: null, 2002: null },
            expectedValues: dispositions,
          })
        } catch (error) {
          revivalConflict = error.code || error.message
        }
        const afterRevival = await aliasDb.exportBackup({})
        const newer = structuredClone(liveBackup)
        // Keep the real tombstone. This probes alias revival through source
        // restore, independently of the stronger prohibition on reviving boxes.
        newer.cartonBatches = canceled.batches
        newer.orders.find(
          (record) => record.snapshot.orderId === '1001'
        ).inventoryDispositions = {}
        newer.orders.find(
          (record) => record.snapshot.orderId === '1001'
        ).inventoryDispositionsUpdatedAt = '2099-01-01T00:00:00.000Z'
        let restoreConflict
        try {
          await aliasDb.restoreBackup(newer)
        } catch (error) {
          restoreConflict = error.code || error.message
        }
        const afterRestore = await aliasDb.exportBackup({})
        const foreignSaved = (
          await aliasDb.getOperationalState({})
        ).preparations.find((prep) => prep.orderId === '1002')
        await aliasDb.savePreparations([{ ...foreignSaved, groups: [] }], {
          expectedRevisions: [foreignSaved.revision],
        })
        await aliasDb.setInventoryDispositions({
          orderId: '1001',
          entries: { 2001: null, 2002: null },
          expectedValues: { 2001: null, 2002: null },
        })
        const freeRevival = await aliasDb.getOperationalState({})
        return {
          currentConflict,
          revivalConflict,
          restoreConflict,
          liveBackup,
          afterCurrentRefusal,
          retiredBoxes,
          canceled,
          beforeRevival,
          afterRevival,
          afterRestore,
          freeRevival,
        }
      },
      { foreignRecord, foreign }
    )
    assert.match(result.currentConflict, /CODE_CONFLICT|conflict/i)
    assert.ok(
      result.retiredBoxes.issuedCodes.some(
        (entry) => entry.code === 'CE26101002' && entry.orderId === '1001'
      )
    )
    assert.ok(result.canceled.batches[0].physicalMark.retiredAt)
    assert.ok(
      result.canceled.batches[0].physicalMark.history.some(
        (event) => event.kind === 'retired'
      )
    )
    assert.equal(
      result.canceled.issuedCodes.some((entry) => entry.code === 'CE26101002'),
      false
    )
    assert.equal(result.revivalConflict, undefined)
    assert.equal(result.restoreConflict, undefined)
    for (const field of [
      'orders',
      'preparations',
      'cartonBatches',
      'issuedCodes',
      'shipmentLocks',
    ]) {
      assert.deepEqual(
        result.afterCurrentRefusal[field],
        result.liveBackup[field],
        `current ${field}`
      )
      if (['preparations', 'shipmentLocks'].includes(field)) {
        assert.deepEqual(
          result.afterRevival[field],
          result.beforeRevival[field],
          `revival ${field}`
        )
        assert.deepEqual(
          result.afterRestore[field],
          result.beforeRevival[field],
          `restore ${field}`
        )
      }
    }
    for (const restored of [result.afterRevival, result.afterRestore]) {
      assert.deepEqual(
        restored.orders.find((record) => record.snapshot.orderId === '1001')
          .snapshot,
        state.records[0].snapshot
      )
      assert.deepEqual(
        restored.orders.find((record) => record.snapshot.orderId === '1002'),
        result.beforeRevival.orders.find(
          (record) => record.snapshot.orderId === '1002'
        )
      )
      assert.ok(restored.cartonBatches[0].deletedAt)
      assert.equal(
        restored.cartonBatches[0].physicalMark.supersededAliases[0].code,
        'CE26101002'
      )
      assert.equal(
        restored.issuedCodes.find(
          (entry) => entry.kind === 'base' && entry.code === 'CE26101002'
        ).orderId,
        '1002'
      )
      for (const field of [
        'id',
        'contents',
        'count',
        'len',
        'wid',
        'ht',
        'weight',
        'weightBasis',
        'received',
        'loaded',
        'sourceFacts',
      ])
        assert.deepEqual(
          restored.cartonBatches[0][field],
          state.batches[0][field],
          field
        )
    }
    assert.deepEqual(
      result.canceled.records.find(
        (record) => record.snapshot.orderId === '1001'
      ).snapshot,
      state.records[0].snapshot
    )
    assert.equal(
      result.freeRevival.batches[0].physicalMark.retiredAt,
      undefined
    )
    assert.ok(
      result.freeRevival.batches[0].physicalMark.history.some(
        (event) => event.kind === 'superseded'
      )
    )
    assert.equal(
      result.freeRevival.issuedCodes.some(
        (entry) => entry.code === 'CE26101002' && entry.orderId === '1001'
      ),
      true
    )
  } finally {
    await browser.close()
  }
})

for (const choice of ['keep-recorded-mark', 'relabel-reprint'])
  test(`native ${choice} blocks unresolved seal, then permanently consumes aliases through amendment and full restore`, async () => {
    const browser = await databaseBrowser()
    try {
      const state = await openFixture(browser, fixture()),
        { next, plan } = await mergePlan(state)
      await saveMerge(browser, state, next, plan)
      const result = await browser.page.evaluate(async (choice) => {
        const c = await aliasDb.createContainer({ name: `Synthetic ${choice}` })
        let view = await aliasDb.includeContainerOrders({
          id: c.id,
          expectedRevision: c.revision,
          orderRefs: [{ orderId: '1001' }],
        })
        view = await aliasDb.markContainerLoaded({
          id: c.id,
          expectedRevision: view.container.revision,
        })
        let review = await aliasDb.reviewContainerSeal({
          id: c.id,
          expectedRevision: view.container.revision,
        })
        const pendingIssues = review.issues,
          beforeRefusal = await aliasDb.exportBackup({})
        let sealError
        try {
          await aliasDb.sealContainer({
            id: c.id,
            expectedRevision: view.container.revision,
            reviewToken: review.reviewToken,
          })
        } catch (error) {
          sealError = error.code
        }
        const afterRefusal = await aliasDb.exportBackup({})
        const context = await aliasDb.getOrderReconciliation({
          orderId: '1001',
        })
        await aliasDb.resolveCartonPhysicalMark({
          orderId: '1001',
          batchId: context.batches[0].id,
          expectedRevisions: context.revisions,
          choice,
          physicalRelabelConfirmed: choice === 'relabel-reprint',
          reason: 'Physical synthetic operator confirmation',
        })
        view = await aliasDb.getContainerView({ id: c.id })
        const availability = await aliasDb.reviewContainerAvailability({
          id: c.id,
          expectedRevision: view.container.revision,
        })
        view = await aliasDb.applyContainerAvailability({
          id: c.id,
          expectedRevision: view.container.revision,
          plan: availability,
        })
        review = await aliasDb.reviewContainerSeal({
          id: c.id,
          expectedRevision: view.container.revision,
        })
        if (!review.ready) throw new Error(JSON.stringify(review.issues))
        const manifest = await aliasDb.sealContainer({
          id: c.id,
          expectedRevision: view.container.revision,
          reviewToken: review.reviewToken,
        })
        const sealed = await aliasDb.exportBackup({})
        const restoredDb = await modules.openDatabase({
          name: `synthetic-sealed-${choice}`,
        })
        await restoredDb.restoreBackup(sealed)
        const restored = await restoredDb.exportBackup({})
        restoredDb.close()
        view = await aliasDb.getContainerView({ id: c.id })
        view = await aliasDb.beginContainerAmendment({
          id: c.id,
          expectedRevision: view.container.revision,
          reason: 'All loading corrected away; identity remains consumed',
        })
        view = await aliasDb.setContainerLoading({
          id: c.id,
          expectedRevision: view.container.revision,
          decisions: view.cartons.map((unit) => ({
            cartonId: unit.id,
            state: 'left-behind',
          })),
        })
        review = await aliasDb.reviewContainerSeal({
          id: c.id,
          expectedRevision: view.container.revision,
        })
        const amended = await aliasDb.applyContainerAmendment({
          id: c.id,
          expectedRevision: view.container.revision,
          reviewToken: review.reviewToken,
        })
        const afterAmendment = await aliasDb.exportBackup({})
        view = await aliasDb.getContainerView({ id: c.id })
        view = await aliasDb.beginContainerAmendment({
          id: c.id,
          expectedRevision: view.container.revision,
          reason:
            'Retire all remaining synthetic goods while preserving consumed identity',
        })
        const retireContext = await aliasDb.getOrderReconciliation({
          orderId: '1001',
          contextContainerId: c.id,
        })
        await aliasDb.saveOrderCartonFacts({
          orderId: '1001',
          contextContainerId: c.id,
          expectedAmendment: retireContext.amendmentContext,
          expectedRevisions: retireContext.revisions,
          changes: [
            {
              after: {
                ...retireContext.batches[0],
                deletedAt: new Date().toISOString(),
              },
              expectedRevision: retireContext.batches[0].revision,
            },
          ],
        })
        const metadataContext = await aliasDb.getOrderReconciliation({
          orderId: '1001',
          contextContainerId: c.id,
        })
        await aliasDb.setInventoryDispositions({
          orderId: '1001',
          contextContainerId: c.id,
          expectedAmendment: metadataContext.amendmentContext,
          entries: Object.fromEntries(
            ['2001', '2002'].map((id) => [
              id,
              {
                kind: 'canceled',
                quantity: '30',
                reason: 'All remaining synthetic goods canceled',
              },
            ])
          ),
        })
        view = await aliasDb.getContainerView({ id: c.id })
        const retiredAvailability = await aliasDb.reviewContainerAvailability({
          id: c.id,
          expectedRevision: view.container.revision,
        })
        view = await aliasDb.applyContainerAvailability({
          id: c.id,
          expectedRevision: view.container.revision,
          plan: retiredAvailability,
        })
        review = await aliasDb.reviewContainerSeal({
          id: c.id,
          expectedRevision: view.container.revision,
        })
        if (!review.ready) throw new Error(JSON.stringify(review.issues))
        await aliasDb.applyContainerAmendment({
          id: c.id,
          expectedRevision: view.container.revision,
          reviewToken: review.reviewToken,
        })
        const fullyRetired = await aliasDb.exportBackup({})
        return {
          manifest,
          pendingIssues,
          sealError,
          beforeRefusal,
          afterRefusal,
          sealed,
          restored,
          amended,
          afterAmendment,
          fullyRetired,
        }
      }, choice)
      assert.ok(
        result.pendingIssues.some(
          (issue) => issue.code === 'PHYSICAL_MARK_UNRESOLVED'
        )
      )
      assert.ok(result.sealError)
      for (const field of [
        'orders',
        'preparations',
        'cartonBatches',
        'containers',
        'shipmentLocks',
        'issuedCodes',
      ])
        assert.deepEqual(
          result.beforeRefusal[field],
          result.afterRefusal[field],
          field
        )
      assert.equal(
        result.manifest.cartons[0].markCode,
        choice === 'keep-recorded-mark' ? 'CE26101002' : 'CE26101001'
      )
      assert.equal(result.manifest.cartons[0].currentProductCode, 'CE26101001')
      assert.equal(result.manifest.cartons.length, 6)
      assert.equal(result.amended.cartons.length, 0)
      assert.ok(
        result.afterAmendment.shipmentLocks
          .flatMap((lock) => lock.lineages)
          .some(
            (lineage) =>
              lineage.baseCode === 'CE26101002' && lineage.physicalMarkAlias
          )
      )
      assert.deepEqual(
        result.restored.shipmentLocks,
        result.sealed.shipmentLocks
      )
      assert.deepEqual(
        result.restored.cartonBatches,
        result.sealed.cartonBatches
      )
      assert.deepEqual(
        result.afterAmendment.containers[0].revisions[0],
        result.manifest
      )
      assert.deepEqual(result.sealed.orders, state.records)
      assert.ok(result.fullyRetired.cartonBatches[0].physicalMark.retiredAt)
      assert.ok(
        result.fullyRetired.issuedCodes.some(
          (entry) => entry.code === 'CE26101002'
        )
      )
      assert.deepEqual(
        result.fullyRetired.shipmentLocks,
        result.afterAmendment.shipmentLocks
      )
    } finally {
      await browser.close()
    }
  })

test('native stale compound grouping, foreign batch and source-clock failures preserve every preparation, carton and reservation', async () => {
  const browser = await databaseBrowser()
  try {
    const state = await openFixture(browser, fixture()),
      { next, plan } = await mergePlan(state)
    const foreignRecord = syntheticOrder('1002', '30', {
      purchasedAt: '2026-10-05T12:00:00+08:00',
    })
    const foreign = createPreparation(foreignRecord.snapshot, '2026-10')
    const result = await browser.page.evaluate(
      async ({ state, next, plan, foreignRecord, foreign }) => {
        await aliasDb.restoreBackup({
          format: '1688-order-library',
          version: 1,
          exportedAt: '2026-10-23T05:00:00.000Z',
          orders: [foreignRecord],
          history: [],
          images: [],
        })
        const saved = (
          await aliasDb.savePreparations([foreign], { expectedRevisions: [0] })
        )[0]
        const before = await aliasDb.exportBackup({}),
          refusals = []
        const attempts = [
          {
            drafts: [next[0], { ...saved, revision: 0 }],
            options: { expectedRevisions: [state.preparations[0].revision, 0] },
          },
          {
            drafts: next,
            options: {
              cartonBatchChanges: [
                {
                  after: {
                    ...plan.changes[0].after,
                    accountId: 'foreign-account',
                  },
                  expectedRevision: state.batches[0].revision,
                },
              ],
            },
          },
          {
            drafts: next,
            options: {
              expectedSnapshots: [
                {
                  accountId: 'local',
                  orderId: '1001',
                  observedAt: '2026-10-01T11:00:00.000Z',
                },
              ],
            },
          },
        ]
        for (const attempt of attempts) {
          let error
          try {
            await aliasDb.savePreparations(attempt.drafts, {
              expectedRevisions: attempt.drafts.map((prep) => prep.revision),
              cartonBatchChanges: plan.changes,
              allowCartonReview: true,
              ...attempt.options,
            })
          } catch (value) {
            error = { code: value.code, message: value.message }
          }
          refusals.push({ error, backup: await aliasDb.exportBackup({}) })
        }
        return { before, refusals }
      },
      { state, next, plan, foreignRecord, foreign }
    )
    assert.equal(result.refusals.length, 3)
    assert.match(result.refusals[0].error.message, /another tab|revision/i)
    assert.match(
      result.refusals[1].error.message,
      /purchase|ownership|account/i
    )
    assert.match(result.refusals[2].error.message, /source.*changed/i)
    for (const refused of result.refusals)
      for (const field of [
        'orders',
        'preparations',
        'cartonBatches',
        'issuedCodes',
        'allocations',
        'shipmentLocks',
        'operationIntents',
      ])
        assert.deepEqual(refused.backup[field], result.before[field], field)
  } finally {
    await browser.close()
  }
})

test('native confirmed relabel survives original-owner grouping Undo and historical Redo data never replays a physical attestation', async () => {
  const browser = await databaseBrowser()
  try {
    const state = await openFixture(browser, fixture()),
      { next, plan } = await mergePlan(state)
    const chosen = resolvePhysicalMarkChange(plan, {
      batchId: state.batches[0].id,
      choice: 'relabel-reprint',
      reason: 'Actual synthetic boxes were physically relabeled',
      physicalRelabelConfirmed: true,
    })
    await saveMerge(browser, state, next, chosen)
    const result = await browser.page.evaluate(
      async ({ original, batch }) => {
        const before = await aliasDb.exportBackup({}),
          current = await aliasDb.getPreparation('1001')
        let undoError
        try {
          await aliasDb.savePreparations(
            [{ ...original, revision: current.revision }],
            {
              expectedRevisions: [current.revision],
              cartonBatchChanges: [
                {
                  after: batch,
                  expectedRevision: before.cartonBatches[0].revision,
                },
              ],
              allowCartonReview: true,
              suffixBaselines: [original],
            }
          )
        } catch (error) {
          undoError = error.code || error.message
        }
        const afterUndo = await aliasDb.exportBackup({})
        const historical = structuredClone(before.cartonBatches[0])
        historical.physicalMark.code = historical.physicalMark.originalCode
        historical.physicalMark.resolution = {
          ...historical.physicalMark.resolution,
          choice: 'keep-recorded-mark',
          physicalRelabelConfirmed: false,
          reason: 'An old logical snapshot is not a new physical action',
        }
        const afterUndoPrep = await aliasDb.getPreparation('1001')
        await aliasDb.savePreparations(
          [{ ...current, revision: afterUndoPrep.revision }],
          {
            expectedRevisions: [afterUndoPrep.revision],
            cartonBatchChanges: [
              {
                after: historical,
                expectedRevision: afterUndo.cartonBatches[0].revision,
              },
            ],
            allowCartonReview: true,
          }
        )
        const afterRedo = await aliasDb.exportBackup({})
        return { before, afterUndo, afterRedo, undoError }
      },
      { original: state.preparations[0], batch: state.batches[0] }
    )
    assert.equal(result.undoError, undefined)
    assert.deepEqual(result.afterUndo.orders, result.before.orders)
    assert.equal(result.afterUndo.preparations[0].groups.length, 2)
    assert.equal(
      result.afterUndo.cartonBatches[0].physicalMark.code,
      'CE26101001'
    )
    assert.equal(
      result.afterUndo.cartonBatches[0].physicalMark.productCode,
      'CE26101002'
    )
    assert.equal(
      result.afterUndo.cartonBatches[0].physicalMark.resolution,
      null
    )
    for (const field of [
      'id',
      'contents',
      'count',
      'len',
      'wid',
      'ht',
      'weight',
      'weightBasis',
      'received',
      'loaded',
      'sourceFacts',
    ])
      assert.deepEqual(
        result.afterUndo.cartonBatches[0][field],
        result.before.cartonBatches[0][field],
        field
      )
    assert.deepEqual(
      result.afterUndo.cartonBatches[0].physicalMark.artwork,
      result.before.cartonBatches[0].physicalMark.artwork
    )
    assert.equal(
      result.afterRedo.cartonBatches[0].physicalMark.code,
      'CE26101001'
    )
    assert.equal(
      result.afterRedo.cartonBatches[0].physicalMark.resolution,
      null
    )
    assert.equal(
      result.afterRedo.cartonBatches[0].physicalMark.history.find(
        (event) => event.kind === 'resolution'
      ).resolution.reason,
      'Actual synthetic boxes were physically relabeled'
    )
    assert.equal(
      result.afterRedo.cartonBatches[0].physicalMark.history.filter(
        (event) => event.kind === 'resolution'
      ).length,
      1
    )
    assert.deepEqual(result.afterRedo.orders, result.before.orders)
  } finally {
    await browser.close()
  }
})

test('native keep-mark Undo/Redo restores only exact server provenance with unchanged actual artwork and refuses invented history', async () => {
  const browser = await databaseBrowser()
  try {
    const state = await openFixture(browser, fixture()),
      { next, plan } = await mergePlan(state)
    const chosen = resolvePhysicalMarkChange(plan, {
      batchId: state.batches[0].id,
      choice: 'keep-recorded-mark',
      reason: 'Keep original synthetic marks and original category text',
    })
    await saveMerge(browser, state, next, chosen)
    const result = await browser.page.evaluate(
      async ({ original, batch }) => {
        const saved = await aliasDb.exportBackup({}),
          prep = await aliasDb.getPreparation('1001')
        await aliasDb.savePreparations(
          [{ ...original, revision: prep.revision }],
          {
            expectedRevisions: [prep.revision],
            cartonBatchChanges: [
              {
                after: batch,
                expectedRevision: saved.cartonBatches[0].revision,
              },
            ],
            allowCartonReview: true,
            suffixBaselines: [original],
          }
        )
        const undo = await aliasDb.exportBackup({}),
          undone = await aliasDb.getOrderReconciliation({ orderId: '1001' })
        const refusals = []
        for (const variant of ['reason', 'artwork', 'relabel']) {
          const after = structuredClone(saved.cartonBatches[0])
          if (variant === 'reason')
            after.physicalMark.resolution.reason = 'Invented unreviewed reason'
          if (variant === 'artwork')
            after.physicalMark.artwork.category = '伪造'
          if (variant === 'relabel') {
            after.physicalMark.resolution.choice = 'relabel-reprint'
            after.physicalMark.resolution.physicalRelabelConfirmed = true
          }
          let error
          try {
            await aliasDb.savePreparations(
              [{ ...prep, revision: undone.preparation.revision }],
              {
                expectedRevisions: [undone.preparation.revision],
                cartonBatchChanges: [
                  {
                    after,
                    expectedRevision: undone.batches[0].revision,
                    restorePhysicalMarkHistory: true,
                  },
                ],
                allowCartonReview: true,
              }
            )
          } catch (value) {
            error = value.code
          }
          refusals.push({ error, backup: await aliasDb.exportBackup({}) })
        }
        const after = structuredClone(saved.cartonBatches[0])
        after.physicalMark.resolution.resolvedAt = null // UI preview retained no server clock.
        await aliasDb.savePreparations(
          [{ ...prep, revision: undone.preparation.revision }],
          {
            expectedRevisions: [undone.preparation.revision],
            cartonBatchChanges: [
              {
                after,
                expectedRevision: undone.batches[0].revision,
                restorePhysicalMarkHistory: true,
              },
            ],
            allowCartonReview: true,
          }
        )
        const redo = await aliasDb.exportBackup({}),
          context = await aliasDb.getOrderReconciliation({ orderId: '1001' })
        return { saved, undo, undone, refusals, redo, context }
      },
      { original: state.preparations[0], batch: state.batches[0] }
    )
    assert.equal(result.undone.batches[0].physicalMarkResolutionRequired, false)
    assert.equal(result.undo.cartonBatches[0].physicalMark.code, 'CE26101002')
    assert.equal(
      result.undo.cartonBatches[0].physicalMark.artwork.category,
      '原唛'
    )
    for (const refusal of result.refusals) {
      assert.equal(refusal.error, 'PHYSICAL_MARK_REVIEW_REQUIRED')
      for (const field of [
        'orders',
        'preparations',
        'cartonBatches',
        'issuedCodes',
        'allocations',
      ])
        assert.deepEqual(refusal.backup[field], result.undo[field], field)
    }
    const physical = result.redo.cartonBatches[0].physicalMark
    assert.equal(physical.code, 'CE26101002')
    assert.equal(physical.productCode, 'CE26101001')
    assert.equal(
      result.context.batches[0].physicalMarkResolutionRequired,
      false
    )
    assert.deepEqual(
      physical.resolution,
      result.saved.cartonBatches[0].physicalMark.resolution
    )
    assert.deepEqual(
      physical.artwork,
      result.saved.cartonBatches[0].physicalMark.artwork
    )
    assert.deepEqual(
      physical.originalArtwork,
      result.saved.cartonBatches[0].physicalMark.originalArtwork
    )
    assert.equal(
      physical.history.filter((entry) => entry.kind === 'resolution').length,
      1
    )
    assert.equal(physical.history.at(-1).kind, 'logical-history-restore')
    assert.deepEqual(result.redo.orders, result.saved.orders)
  } finally {
    await browser.close()
  }
})

test('native fresh relabel attestations cannot live only in a cancelable shipment draft through any carton write API', async () => {
  const browser = await databaseBrowser()
  try {
    const state = await openFixture(browser, fixture()),
      { next, plan } = await mergePlan(state)
    const chosen = resolvePhysicalMarkChange(plan, {
      batchId: state.batches[0].id,
      choice: 'keep-recorded-mark',
      reason: 'Keep actual marks for first shipment',
    })
    await saveMerge(browser, state, next, chosen)
    const result = await browser.page.evaluate(async () => {
      const c = await aliasDb.createContainer({
        name: 'Synthetic physical confirmation fence',
      })
      let view = await aliasDb.includeContainerOrders({
        id: c.id,
        expectedRevision: c.revision,
        orderRefs: [{ orderId: '1001' }],
      })
      view = await aliasDb.markContainerLoaded({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      const review = await aliasDb.reviewContainerSeal({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      const manifest = await aliasDb.sealContainer({
        id: c.id,
        expectedRevision: view.container.revision,
        reviewToken: review.reviewToken,
      })
      view = await aliasDb.getContainerView({ id: c.id })
      view = await aliasDb.beginContainerAmendment({
        id: c.id,
        expectedRevision: view.container.revision,
        reason: 'Logical draft cannot erase an actual relabel confirmation',
      })
      const context = await aliasDb.getOrderReconciliation({
        orderId: '1001',
        contextContainerId: c.id,
      })
      const decision = {
        choice: 'relabel-reprint',
        reason: 'Must not be accepted into cancelable state',
        physicalRelabelConfirmed: true,
      }
      const base = {
        orderId: '1001',
        contextContainerId: c.id,
        expectedAmendment: context.amendmentContext,
        expectedRevisions: context.revisions,
      }
      const change = {
        after: context.batches[0],
        expectedRevision: context.batches[0].revision,
        physicalMarkResolution: decision,
      }
      const before = await aliasDb.exportBackup({}),
        refused = []
      for (const call of [
        () =>
          aliasDb.resolveCartonPhysicalMark({
            ...base,
            batchId: context.batches[0].id,
            ...decision,
          }),
        () => aliasDb.saveOrderCartonFacts({ ...base, changes: [change] }),
        () =>
          aliasDb.savePreparations([context.preparation], {
            contextContainerId: c.id,
            expectedAmendment: context.amendmentContext,
            expectedRevisions: [context.preparation.revision],
            cartonBatchChanges: [change],
            allowCartonReview: true,
          }),
      ]) {
        let error, message
        try {
          await call()
        } catch (value) {
          error = value.code
          message = value.message
        }
        refused.push({ error, message, backup: await aliasDb.exportBackup({}) })
      }
      const kept = await aliasDb.resolveCartonPhysicalMark({
        ...base,
        batchId: context.batches[0].id,
        choice: 'keep-recorded-mark',
        reason: 'A logical keep decision remains safe inside the amendment',
      })
      view = await aliasDb.getContainerView({ id: c.id })
      await aliasDb.cancelContainerAmendment({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      return {
        before,
        refused,
        manifest,
        after: await aliasDb.getContainerManifest({ id: c.id }),
        kept,
        afterBackup: await aliasDb.exportBackup({}),
      }
    })
    for (const refusal of result.refused) {
      assert.equal(refusal.error, 'PHYSICAL_RELABEL_AMENDMENT_PENDING')
      assert.equal(
        refusal.message,
        'Relabeling must be confirmed on unsealed cartons. In an amendment, keep the recorded mark (shown beside the code) or finish the amendment first.'
      )
      for (const field of [
        'orders',
        'preparations',
        'cartonBatches',
        'containers',
        'issuedCodes',
        'shipmentLocks',
        'operationIntents',
      ])
        assert.deepEqual(refusal.backup[field], result.before[field], field)
    }
    assert.deepEqual(result.after, result.manifest)
    assert.equal(
      result.kept.batches[0].physicalMark.resolution.choice,
      'keep-recorded-mark'
    )
    assert.equal(result.kept.batches[0].physicalMark.code, 'CE26101002')
    assert.deepEqual(
      result.afterBackup.cartonBatches,
      result.before.cartonBatches
    )
  } finally {
    await browser.close()
  }
})

for (const choice of ['keep-recorded-mark', 'relabel-reprint'])
  test(`native removed zero-piece mark owner keeps a live alias and resolves ${choice} through an explicit same-order target`, async () => {
    const browser = await databaseBrowser()
    try {
      await openFixture(browser, independentMarkFixture())
      const state = await browser.page.evaluate(async () => {
        await aliasDb.setInventoryDispositions({
          orderId: '1001',
          entries: {
            2002: {
              kind: 'canceled',
              quantity: '30',
              reason: 'Only the old zero-piece mark product retired',
            },
          },
        })
        return aliasDb.getOperationalState({})
      })
      const next = structuredClone(state.preparations)
      next[0].groups.splice(1, 1)
      const plan = planCartonBatchChanges({
        batches: state.batches,
        records: state.records,
        beforePreparations: state.preparations,
        afterPreparations: next,
      })
      const targetMark = { orderId: '1001', groupId: next[0].groups[0].id }
      assert.equal(plan.changes[0].after.physicalMark.productCode, '')
      assert.deepEqual(plan.changes[0].after.mark, state.batches[0].mark)
      assert.ok(
        plan.reviews[0].physicalMarkOwnerChoices.some(
          (owner) => owner.productCode === 'CE26101001'
        )
      )
      assert.ok(
        plan.reviews[0].physicalMarkOwnerChoices.some(
          (owner) => owner.productCode === 'CE26101003'
        )
      )
      assert.equal(
        plan.reviews[0].physicalMarkOwnerChoices.some(
          (owner) => owner.mark.groupId === state.batches[0].mark.groupId
        ),
        false
      )
      assert.throws(
        () =>
          resolvePhysicalMarkChange(plan, {
            batchId: state.batches[0].id,
            choice,
            reason: 'No explicit target',
            physicalRelabelConfirmed: true,
          }),
        /explicit current mark owner/
      )
      if (choice === 'relabel-reprint') {
        const resolved = resolvePhysicalMarkChange(plan, {
          batchId: state.batches[0].id,
          choice,
          targetMark,
          reason: 'Reviewed target in the same grouping confirmation',
          physicalRelabelConfirmed: true,
        })
        assert.equal(resolved.changes[0].after.needsReview, undefined)
        await saveMerge(browser, state, next, resolved)
      } else await saveMerge(browser, state, next, plan)
      const foreignRecord = syntheticOrder('1002', '30', {
          purchasedAt: '2026-10-05T12:00:00+08:00',
        }),
        foreign = createPreparation(foreignRecord.snapshot, '2026-10')
      foreign.groups[0].baseCode = 'CE26101002'
      const result = await browser.page.evaluate(
        async ({ choice, targetMark, foreignRecord, foreign }) => {
          await aliasDb.restoreBackup({
            format: '1688-order-library',
            version: 1,
            exportedAt: '2026-10-23T05:00:00.000Z',
            orders: [foreignRecord],
            history: [],
            images: [],
          })
          const pending = await aliasDb.getOrderReconciliation({
              orderId: '1001',
            }),
            before = await aliasDb.exportBackup({})
          const refusals = []
          try {
            await aliasDb.savePreparations([foreign], {
              expectedRevisions: [0],
            })
          } catch (error) {
            refusals.push(error.code)
          }
          if (choice === 'keep-recorded-mark') {
            for (const target of [
              { orderId: '1002', groupId: targetMark.groupId },
              { orderId: '1001', groupId: 'missing-current-owner' },
            ]) {
              try {
                await aliasDb.resolveCartonPhysicalMark({
                  orderId: '1001',
                  batchId: pending.batches[0].id,
                  expectedRevisions: pending.revisions,
                  targetMark: target,
                  choice,
                  reason: 'Foreign target cannot steal a physical identity',
                })
              } catch (error) {
                refusals.push(error.code)
              }
            }
          }
          const afterRefusals = await aliasDb.exportBackup({})
          let resolved = pending
          if (choice === 'keep-recorded-mark')
            resolved = await aliasDb.resolveCartonPhysicalMark({
              orderId: '1001',
              batchId: pending.batches[0].id,
              expectedRevisions: pending.revisions,
              targetMark,
              choice,
              reason:
                'Explicit independent mark owner selected after retirement',
            })
          const container = await aliasDb.createContainer({
            name: `Explicit target ${choice}`,
          })
          let view = await aliasDb.includeContainerOrders({
            id: container.id,
            expectedRevision: container.revision,
            orderRefs: [{ orderId: '1001' }],
          })
          view = await aliasDb.markContainerLoaded({
            id: container.id,
            expectedRevision: view.container.revision,
          })
          const review = await aliasDb.reviewContainerSeal({
            id: container.id,
            expectedRevision: view.container.revision,
          })
          if (!review.ready) throw new Error(JSON.stringify(review.issues))
          const manifest = await aliasDb.sealContainer({
            id: container.id,
            expectedRevision: view.container.revision,
            reviewToken: review.reviewToken,
          })
          const backup = await aliasDb.exportBackup({}),
            other = await modules.openDatabase({
              name: `synthetic-target-${choice}-restored`,
            })
          await other.restoreBackup(backup)
          const restored = await other.exportBackup({})
          other.close()
          return {
            pending,
            before,
            afterRefusals,
            refusals,
            resolved,
            manifest,
            backup,
            restored,
          }
        },
        { choice, targetMark, foreignRecord, foreign }
      )
      assert.equal(result.refusals[0], 'PACKING_CODE_CONFLICT')
      if (choice === 'keep-recorded-mark') {
        assert.deepEqual(result.refusals.slice(1), [
          'PHYSICAL_MARK_OWNER_REQUIRED',
          'PHYSICAL_MARK_OWNER_REQUIRED',
        ])
        assert.equal(result.pending.batches[0].physicalMark.productCode, '')
        assert.equal(
          result.pending.batches[0].physicalMarkResolutionRequired,
          true
        )
        assert.ok(
          result.pending.batches[0].physicalMarkOwnerChoices.some(
            (owner) => owner.productCode === 'CE26101003'
          )
        )
      }
      for (const field of [
        'orders',
        'preparations',
        'cartonBatches',
        'issuedCodes',
        'containers',
        'operationIntents',
      ])
        assert.deepEqual(
          result.afterRefusals[field],
          result.before[field],
          field
        )
      const batch = result.resolved.batches[0],
        expected = choice === 'keep-recorded-mark' ? 'CE26101002' : 'CE26101001'
      assert.equal(batch.physicalMark.code, expected)
      assert.equal(batch.currentProductCode, 'CE26101001')
      assert.deepEqual(batch.currentProductCodes, ['CE26101003'])
      assert.equal(batch.physicalMarkResolutionRequired, false)
      assert.equal(Boolean(batch.needsReview), false)
      assert.deepEqual(batch.contents, state.batches[0].contents)
      assert.deepEqual(batch.physicalMark.originalArtwork.entryIds, ['2002'])
      assert.equal(batch.physicalMark.originalArtwork.category, '原唛')
      assert.equal(result.manifest.cartons.length, 6)
      assert.equal(result.manifest.cartons[0].markCode, expected)
      assert.equal(result.manifest.cartons[0].currentProductCode, 'CE26101001')
      assert.deepEqual(result.manifest.cartons[0].currentProductCodes, [
        'CE26101003',
      ])
      assert.equal(result.manifest.products[0].baseCode, 'CE26101003')
      assert.deepEqual(
        result.backup.orders.find(
          (record) => record.snapshot.orderId === '1001'
        ).snapshot,
        state.records[0].snapshot
      )
      assert.deepEqual(
        result.restored.cartonBatches,
        result.backup.cartonBatches
      )
      const summary = createContainerSummary(result.manifest, {
        file: 'explicit-physical-target.xlsx',
      })
      assert.equal(summary.cartons[0].physicalMarkCode, expected)
      assert.equal(summary.cartons[0].currentProductCode, 'CE26101001')
    } finally {
      await browser.close()
    }
  })

test('an independent mark retains its exact original current primary reservation, then hands it over with no release gap', () => {
  const state = fixture(),
    prep = state.preparations[0],
    before = state.batches[0]
  before.mark = { orderId: prep.orderId, groupId: prep.groups[0].id }
  const after = transitionPhysicalMark(
    before,
    { ...before, mark: { orderId: prep.orderId, groupId: prep.groups[1].id } },
    state.preparations,
    state.preparations,
    { issuedCodes: state.issuedCodes, updatedAt: time }
  )
  const reservations = physicalMarkReservations({ ...state, batches: [after] })
  assert.equal(reservations[0].code, 'CE26101001')
  assert.equal(reservations[0].groupId, prep.groups[0].id)
  const current = activePackingState(
    state.preparations,
    state.allocations,
    state.issuedCodes,
    { historicalReservations: reservations }
  )
  assert.equal(
    current.issuedCodes.filter(
      (entry) => entry.kind === 'base' && entry.code === 'CE26101001'
    ).length,
    1
  )
  const kept = transitionPhysicalMark(
    after,
    after,
    state.preparations,
    state.preparations,
    {
      updatedAt: time,
      decision: {
        choice: 'keep-recorded-mark',
        reason: 'Exact original primary remains current',
      },
      issuedCodes: current.issuedCodes,
    }
  )
  const manifest = {
    ...projected({ ...state, batches: [kept] }),
    draft: false,
    status: 'sealed',
    revisionId: 'original-primary-r1',
    sealedAt: time,
  }
  assert.equal(manifest.readiness.ready, true)
  const locks = consumptionLocksForManifest(manifest, {
    ...state,
    batches: [kept],
  })
  const frozenOriginal = historicalCodeReservations(locks).find(
    (entry) => entry.kind === 'base' && entry.code === 'CE26101001'
  )
  assert.equal(frozenOriginal.groupId, prep.groups[0].id)
  assert.equal(
    locks
      .flatMap((lock) => lock.lineages)
      .some(
        (lineage) =>
          lineage.physicalMarkAlias && lineage.baseCode === 'CE26101001'
      ),
    false
  )
  const retired = { ...prep, groups: prep.groups.slice(1) }
  const handed = physicalMarkReservations({
    ...state,
    preparations: [retired],
    batches: [after],
  })
  assert.equal(handed[0].groupId, retired.groups[0].id)
  assert.equal(handed[0].code, 'CE26101001')
  assert.doesNotThrow(() =>
    activePackingState([retired], current.allocations, current.issuedCodes, {
      historicalReservations: handed,
    })
  )
  const unrelated = structuredClone(retired)
  unrelated.groups.push({
    ...structuredClone(prep.groups[0]),
    id: 'unrelated-primary',
    baseCode: 'CE26101001',
  })
  assert.throws(
    () =>
      activePackingState(
        [unrelated],
        current.allocations,
        current.issuedCodes,
        {
          historicalReservations: physicalMarkReservations({
            ...state,
            preparations: [unrelated],
            batches: [after],
          }),
        }
      ),
    { code: 'PACKING_CODE_CONFLICT' }
  )
})

test('physical related goods include actual corrected after contents, unit contents and unresolved source claims', () => {
  const state = independentMarkFixture(),
    batch = state.batches[0]
  const changed = transitionPhysicalMark(
    batch,
    {
      ...batch,
      mark: { orderId: '1001', groupId: state.preparations[0].groups[0].id },
      contents: [{ orderId: '1001', entryId: '2004', quantity: '1' }],
      unitContents: {
        0: [{ orderId: '1001', entryId: '2005', quantity: '1' }],
      },
      unresolvedContents: [{ orderId: '1001', entryIds: ['2006'] }],
    },
    state.preparations,
    state.preparations,
    { updatedAt: time }
  )
  for (const id of ['2002', '2003', '2004', '2005', '2006'])
    assert.ok(changed.physicalMark.relatedEntryIds.includes(id), id)
  assert.deepEqual(changed.physicalMark.originalArtwork.entryIds, ['2002'])
})

test('native deleted purchase reimports with fresh codes after a released alias is sealed elsewhere, and restored old-code cartons require an actual relabel', async () => {
  const browser = await databaseBrowser()
  try {
    const state = await openFixture(browser, fixture()),
      { next, plan } = await mergePlan(state)
    await saveMerge(browser, state, next, plan)
    const foreignRecord = syntheticOrder('1002', '30', {
      purchasedAt: '2026-10-05T12:00:00+08:00',
    })
    const foreign = createPreparation(foreignRecord.snapshot, '2026-10')
    foreign.groups[0].baseCode = 'CE26101002'
    const fresh = createPreparation(state.records[0].snapshot, '2026-10')
    const result = await browser.page.evaluate(
      async ({ original, foreignRecord, foreign, fresh }) => {
        const backupState = () => aliasDb.exportBackup({})
        let rc = await aliasDb.getOrderReconciliation({ orderId: '1001' })
        await aliasDb.removeCartonBatch(rc.batches[0])
        await aliasDb.removeOrders(['1001'])
        const removed = await backupState()
        await aliasDb.restoreBackup({
          format: '1688-order-library',
          version: 1,
          exportedAt: '2026-10-23T05:00:00.000Z',
          orders: [foreignRecord],
          history: [],
          images: [],
        })
        const [foreignSaved] = await aliasDb.savePreparations([foreign], {
          expectedRevisions: [0],
        })
        rc = await aliasDb.getOrderReconciliation({ orderId: '1002' })
        const target = { orderId: '1002', groupId: foreignSaved.groups[0].id }
        await aliasDb.saveOrderCartonFacts({
          orderId: '1002',
          expectedRevisions: rc.revisions,
          changes: [
            {
              after: modules.fixture.syntheticBatch('1002', 1, '30', {
                id: 'foreign-sealed-carton',
                month: '2026-10',
                revision: 0,
                groups: [target],
                mark: target,
                len: '50',
                wid: '40',
                ht: '30',
                weight: '8.2504',
                received: 1,
              }),
              expectedRevision: 0,
            },
          ],
        })
        async function loaded(orderId, name) {
          const container = await aliasDb.createContainer({ name })
          let view = await aliasDb.includeContainerOrders({
            id: container.id,
            expectedRevision: container.revision,
            orderRefs: [{ orderId }],
          })
          view = await aliasDb.markContainerLoaded({
            id: container.id,
            expectedRevision: view.container.revision,
          })
          return view
        }
        let view = await loaded('1002', 'Foreign alias holder')
        let review = await aliasDb.reviewContainerSeal({
          id: view.container.id,
          expectedRevision: view.container.revision,
        })
        if (!review.ready) throw new Error(JSON.stringify(review.issues))
        const sealedForeign = await aliasDb.sealContainer({
          id: view.container.id,
          expectedRevision: view.container.revision,
          reviewToken: review.reviewToken,
        })
        const beforeReimport = await backupState()
        await aliasDb.restoreBackup({
          format: '1688-order-library',
          version: 1,
          exportedAt: '2026-10-23T05:00:00.000Z',
          orders: original.records,
          history: [],
          images: [],
        })
        await aliasDb.savePreparations([fresh], { expectedRevisions: [0] })
        const reprepared = await backupState()
        let tombstone = (await aliasDb.getOperationalState({})).batches.find(
          (batch) => batch.id === original.batches[0].id
        )
        const targetChoice = tombstone.physicalMarkOwnerChoices.find(
          (choice) => choice.groups.length === 1
        )
        if (!targetChoice)
          throw new Error(
            'Missing current explicit physical mark owner choices'
          )
        const after = {
          ...tombstone,
          mark: targetChoice.mark,
          groups: targetChoice.groups,
        }
        delete after.deletedAt
        rc = await aliasDb.getOrderReconciliation({ orderId: '1001' })
        const beforeStale = await backupState()
        const refused = []
        for (const attempt of [
          {
            expectedRevisions: {
              ...rc.revisions,
              preparation: rc.revisions.preparation - 1,
            },
          },
          { expectedRevisions: { ...rc.revisions, source: 'stale-source' } },
        ]) {
          try {
            await aliasDb.saveOrderCartonFacts({
              orderId: '1001',
              ...attempt,
              changes: [
                { after, restore: true, expectedRevision: tombstone.revision },
              ],
            })
            refused.push('ACCEPTED')
          } catch (error) {
            refused.push(error.code)
          }
        }
        const afterStale = await backupState()
        await aliasDb.saveOrderCartonFacts({
          orderId: '1001',
          expectedRevisions: rc.revisions,
          changes: [
            { after, restore: true, expectedRevision: tombstone.revision },
          ],
        })
        const pending = await aliasDb.getOrderReconciliation({
          orderId: '1001',
        })
        const active = pending.batches.find(
          (batch) => batch.id === tombstone.id
        )
        const beforeKeep = await backupState(),
          keepRefusals = []
        const forged = structuredClone(active)
        delete forged.physicalMark.supersededAliases
        forged.physicalMark.resolution = {
          choice: 'keep-recorded-mark',
          reason: 'Caller cannot free a superseded code',
          provenance: 'manual-confirmed',
          physicalRelabelConfirmed: false,
          resolvedAt: '2099-01-01T00:00:00.000Z',
        }
        const forgedBackup = structuredClone(beforeKeep)
        const forgedRestore = forgedBackup.cartonBatches.find(
          (batch) => batch.id === active.id
        )
        forgedRestore.updatedAt = '2099-01-01T00:00:00.000Z'
        forgedRestore.physicalMark.code = active.currentProductCode
        forgedRestore.physicalMark.artwork = active.currentProductArtwork
        forgedRestore.physicalMark.resolution = {
          ...forged.physicalMark.resolution,
          choice: 'relabel-reprint',
          physicalRelabelConfirmed: true,
        }
        for (const run of [
          () =>
            aliasDb.resolveCartonPhysicalMark({
              orderId: '1001',
              batchId: active.id,
              expectedRevisions: pending.revisions,
              choice: 'keep-recorded-mark',
              reason: 'Refuse physical reuse',
              physicalRelabelConfirmed: false,
            }),
          () =>
            aliasDb.saveOrderCartonFacts({
              orderId: '1001',
              expectedRevisions: pending.revisions,
              changes: [
                {
                  after: forged,
                  expectedRevision: active.revision,
                  physicalMarkResolution: {
                    choice: 'keep-recorded-mark',
                    reason: 'Forged keep',
                  },
                },
              ],
            }),
          () =>
            aliasDb.saveCartonBatches([
              {
                after: forged,
                expectedRevision: active.revision,
                restorePhysicalMarkHistory: true,
              },
            ]),
          () =>
            aliasDb.resolveCartonPhysicalMark({
              orderId: '1001',
              batchId: active.id,
              expectedRevisions: pending.revisions,
              choice: 'relabel-reprint',
              reason: 'No physical confirmation',
              physicalRelabelConfirmed: false,
            }),
          () =>
            aliasDb.savePreparations([pending.preparation], {
              expectedRevisions: [pending.preparation.revision],
              cartonBatchChanges: [
                {
                  after: forged,
                  expectedRevision: active.revision,
                  physicalMarkResolution: {
                    choice: 'keep-recorded-mark',
                    reason: 'Forged compound keep',
                  },
                },
              ],
              allowCartonReview: true,
            }),
          () => aliasDb.restoreBackup(forgedBackup),
          () =>
            aliasDb.resolveCartonPhysicalMark({
              orderId: '1001',
              batchId: active.id,
              expectedRevisions: pending.revisions,
              targetMark: target,
              choice: 'relabel-reprint',
              reason: 'Foreign owner refused',
              physicalRelabelConfirmed: true,
            }),
        ]) {
          try {
            await run()
            keepRefusals.push('ACCEPTED')
          } catch (error) {
            keepRefusals.push(error.code)
          }
        }
        const afterKeep = await backupState()
        view = await loaded('1001', 'Recovered original cartons')
        review = await aliasDb.reviewContainerSeal({
          id: view.container.id,
          expectedRevision: view.container.revision,
        })
        const held = { ready: review.ready, issues: review.issues },
          beforeSeal = await backupState()
        let sealError
        try {
          await aliasDb.sealContainer({
            id: view.container.id,
            expectedRevision: view.container.revision,
            reviewToken: review.reviewToken,
          })
        } catch (error) {
          sealError = error.code
        }
        const afterSeal = await backupState()
        // Release the unsealed capture, then explicitly attest actual reprinting.
        await aliasDb.removeContainerOrder({
          id: view.container.id,
          expectedRevision: view.container.revision,
          orderRef: { orderId: '1001' },
        })
        rc = await aliasDb.getOrderReconciliation({ orderId: '1001' })
        await aliasDb.resolveCartonPhysicalMark({
          orderId: '1001',
          batchId: active.id,
          expectedRevisions: rc.revisions,
          targetMark: targetChoice.mark,
          choice: 'relabel-reprint',
          reason:
            'Fresh current labels printed and physically replaced the superseded mark',
          physicalRelabelConfirmed: true,
        })
        const resolved = await aliasDb.getOrderReconciliation({
          orderId: '1001',
        })
        const currentView = await aliasDb.getContainerView({
          id: view.container.id,
        })
        view = await aliasDb.includeContainerOrders({
          id: view.container.id,
          expectedRevision: currentView.container.revision,
          orderRefs: [{ orderId: '1001' }],
        })
        view = await aliasDb.markContainerLoaded({
          id: view.container.id,
          expectedRevision: view.container.revision,
        })
        review = await aliasDb.reviewContainerSeal({
          id: view.container.id,
          expectedRevision: view.container.revision,
        })
        if (!review.ready) throw new Error(JSON.stringify(review.issues))
        const recoveredManifest = await aliasDb.sealContainer({
          id: view.container.id,
          expectedRevision: view.container.revision,
          reviewToken: review.reviewToken,
        })
        const final = await backupState()
        const restoredDb = await modules.openDatabase({
          name: 'synthetic-superseded-roundtrip',
        })
        await restoredDb.restoreBackup(final)
        const restored = await restoredDb.exportBackup({})
        restoredDb.close()
        return {
          removed,
          sealedForeign,
          beforeReimport,
          reprepared,
          tombstone,
          refused,
          beforeStale,
          afterStale,
          active,
          keepRefusals,
          beforeKeep,
          afterKeep,
          held,
          beforeSeal,
          afterSeal,
          sealError,
          resolved,
          recoveredManifest,
          final,
          restored,
        }
      },
      { original: state, foreignRecord, foreign, fresh }
    )
    assert.ok(result.removed.cartonBatches[0].deletedAt)
    assert.equal(result.removed.orders.length, 0)
    assert.equal(
      result.removed.issuedCodes.some((code) => code.code === 'CE26101002'),
      false
    )
    const revived = result.reprepared.preparations.find(
      (prep) => prep.orderId === '1001'
    )
    assert.equal(revived.groups.length, 2)
    assert.ok(
      revived.groups.every(
        (group) => group.baseCode && group.baseCode !== 'CE26101002'
      )
    )
    assert.ok(
      result.tombstone.deletedAt,
      'Fresh preparation must not revive cartons'
    )
    assert.equal(result.tombstone.physicalMarkRelabelOnly, true)
    assert.deepEqual(result.tombstone.physicalMarkResolutionChoices, [
      'relabel-reprint',
    ])
    assert.equal(result.active.physicalMarkResolutionRequired, true)
    assert.equal(result.active.physicalMarkRelabelOnly, true)
    assert.equal(result.active.physicalMarkCode, 'CE26101002')
    const superseded = result.active.physicalMarkSupersessions[0]
    assert.equal(superseded.code, 'CE26101002')
    assert.ok(
      superseded.conflicts.some(
        (owner) =>
          owner.kind === 'code-consumption' &&
          owner.orderId === '1002' &&
          owner.containerId === result.sealedForeign.container.id &&
          owner.revisionId === result.sealedForeign.revisionId
      )
    )
    assert.deepEqual(
      superseded.currentProducts.map((entry) => entry.productCode).sort(),
      revived.groups.map((group) => group.baseCode).sort()
    )
    assert.ok(
      result.active.physicalMark.history.some(
        (event) => event.kind === 'superseded' && event.code === 'CE26101002'
      )
    )
    assert.ok(
      result.active.physicalMark.history.some(
        (event) =>
          event.kind === 'superseded-update' &&
          event.code === 'CE26101002' &&
          event.currentProducts.length === 2 &&
          event.conflicts.some((owner) => owner.kind === 'code-consumption')
      )
    )
    for (const field of [
      'id',
      'contents',
      'count',
      'received',
      'loaded',
      'len',
      'wid',
      'ht',
      'weight',
      'weightBasis',
      'sourceFacts',
    ])
      assert.deepEqual(result.active[field], state.batches[0][field], field)
    assert.deepEqual(result.active.physicalMark.originalArtwork.entryIds, [
      '2002',
    ])
    assert.deepEqual(result.refused, [
      'ORDER_REVISION_CONFLICT',
      'ORDER_REVISION_CONFLICT',
    ])
    assert.deepEqual(result.keepRefusals, [
      'PHYSICAL_MARK_RELABEL_REQUIRED',
      'PHYSICAL_MARK_RELABEL_REQUIRED',
      'PHYSICAL_MARK_RELABEL_REQUIRED',
      'PHYSICAL_MARK_REVIEW_REQUIRED',
      'PHYSICAL_MARK_RELABEL_REQUIRED',
      'PHYSICAL_MARK_RESTORE_CONFLICT',
      'PHYSICAL_MARK_OWNER_REQUIRED',
    ])
    for (const [before, after] of [
      [result.beforeStale, result.afterStale],
      [result.beforeKeep, result.afterKeep],
      [result.beforeSeal, result.afterSeal],
    ])
      for (const field of [
        'orders',
        'preparations',
        'cartonBatches',
        'containers',
        'issuedCodes',
        'shipmentLocks',
        'images',
        'operationIntents',
      ])
        assert.deepEqual(after[field], before[field], field)
    assert.equal(result.held.ready, false)
    assert.ok(
      result.held.issues.some(
        (issue) => issue.code === 'PHYSICAL_MARK_UNRESOLVED'
      )
    )
    assert.ok(result.sealError)
    const resolvedBatch = result.resolved.batches.find(
      (batch) => batch.id === state.batches[0].id
    )
    assert.equal(resolvedBatch.physicalMarkRelabelOnly, false)
    assert.equal(resolvedBatch.physicalMarkResolutionRequired, false)
    assert.equal(
      resolvedBatch.physicalMark.resolution.choice,
      'relabel-reprint'
    )
    assert.equal(
      resolvedBatch.physicalMark.resolution.physicalRelabelConfirmed,
      true
    )
    assert.equal(
      resolvedBatch.physicalMark.code,
      resolvedBatch.currentProductCode
    )
    assert.equal(resolvedBatch.physicalMark.originalCode, 'CE26101002')
    assert.equal(result.recoveredManifest.draft, false)
    assert.equal(
      result.recoveredManifest.cartons[0].markCode,
      resolvedBatch.currentProductCode
    )
    for (const field of ['containers', 'shipmentLocks']) {
      const foreignOnly = (values) =>
        values.filter((value) =>
          field === 'containers'
            ? value.id === result.sealedForeign.container.id
            : value.orderId === '1002'
        )
      assert.equal(
        JSON.stringify(foreignOnly(result.final[field])),
        JSON.stringify(foreignOnly(result.beforeReimport[field])),
        `Foreign ${field} exact bytes`
      )
    }
    assert.equal(
      JSON.stringify(
        result.final.orders.find((record) => record.snapshot.orderId === '1002')
      ),
      JSON.stringify(
        result.beforeReimport.orders.find(
          (record) => record.snapshot.orderId === '1002'
        )
      )
    )
    assert.deepEqual(
      result.final.orders.find((record) => record.snapshot.orderId === '1001')
        .snapshot,
      state.records[0].snapshot
    )
    const aliasOwner = result.final.issuedCodes.filter(
      (entry) => entry.code === 'CE26101002' && entry.kind === 'base'
    )
    assert.equal(aliasOwner.length, 1)
    assert.equal(aliasOwner[0].orderId, '1002')
    assert.deepEqual(result.restored.shipmentLocks, result.final.shipmentLocks)
    assert.equal(
      result.final.shipmentLocks
        .filter((lock) => lock.orderId === '1001')
        .flatMap((lock) => lock.lineages)
        .some((lineage) => lineage.baseCode === 'CE26101002'),
      false
    )
    assert.deepEqual(result.restored.containers, result.final.containers)
    assert.deepEqual(
      result.restored.cartonBatches[0].physicalMark,
      result.final.cartonBatches[0].physicalMark
    )
  } finally {
    await browser.close()
  }
})

test('supersession requires actual stored retirement and same-account conflicting ownership, and pure choices become relabel-only', async () => {
  const state = fixture(),
    { next, plan } = await mergePlan(state)
  const pending = plan.changes[0].after
  const inactive = structuredClone(state.records[0])
  inactive.inventoryDispositions = Object.fromEntries(
    ['2001', '2002'].map((id) => [
      id,
      { kind: 'canceled', quantity: '30', reason: 'Retire all related goods' },
    ])
  )
  const retired = retirePhysicalMarkAliases(
    { ...state, records: [inactive], preparations: next, batches: [pending] },
    () => time
  )
  const foreign = structuredClone(state.preparations[0])
  foreign.orderId = '1002'
  foreign.groups = [foreign.groups[1]]
  const shared = {
    ...state,
    preparations: [...next, foreign],
    batches: retired,
  }
  const recovered = recoverPhysicalMarkAliases(shared, retired, time)
  assert.equal(
    recovered[0].physicalMark.supersededAliases[0].code,
    'CE26101002'
  )
  assert.equal(
    recovered[0].physicalMark.supersededAliases[0].conflicts[0].orderId,
    '1002'
  )
  const readback = physicalMarkReadback(recovered[0], next)
  assert.equal(readback.physicalMarkRelabelOnly, true)
  assert.equal(readback.physicalMarkResolutionRequired, true)
  assert.deepEqual(readback.physicalMarkResolutionChoices, ['relabel-reprint'])
  assert.equal(
    physicalMarkReservations({ ...shared, batches: recovered }).length,
    0
  )
  const purePlan = {
    ...plan,
    changes: [{ after: recovered[0], expectedRevision: pending.revision }],
    after: { [pending.id]: recovered[0] },
  }
  assert.throws(
    () =>
      resolvePhysicalMarkChange(purePlan, {
        batchId: pending.id,
        choice: 'keep-recorded-mark',
        reason: 'Cannot reuse',
      }),
    { code: 'PHYSICAL_MARK_RELABEL_REQUIRED' }
  )
  assert.throws(
    () =>
      transitionPhysicalMark(recovered[0], recovered[0], next, next, {
        restoreHistory: true,
        updatedAt: time,
      }),
    { code: 'PHYSICAL_MARK_RELABEL_REQUIRED' }
  )
  const relabeled = resolvePhysicalMarkChange(purePlan, {
    batchId: pending.id,
    choice: 'relabel-reprint',
    reason: 'Actual synthetic relabel',
    physicalRelabelConfirmed: true,
  })
  assert.equal(
    physicalMarkReadback(relabeled.after[pending.id]).physicalMarkRelabelOnly,
    false
  )
  assert.equal(relabeled.after[pending.id].physicalMark.code, 'CE26101001')
  assert.equal(
    relabeled.after[pending.id].physicalMark.originalCode,
    'CE26101002'
  )
  assert.deepEqual(
    relabeled.after[pending.id].physicalMark.originalArtwork,
    pending.physicalMark.originalArtwork
  )
  const fake = {
    ...pending,
    physicalMark: {
      ...pending.physicalMark,
      retiredAt: time,
      retirementReason: 'Forged release',
      supersededAliases: recovered[0].physicalMark.supersededAliases,
    },
  }
  assert.throws(
    () => recoverPhysicalMarkAliases({ ...shared, batches: [fake] }, [pending]),
    { code: 'PHYSICAL_MARK_RESTORE_CONFLICT' }
  )
  assert.throws(
    () =>
      recoverPhysicalMarkAliases(
        { ...shared, preparations: next, batches: [fake] },
        retired
      ),
    { code: 'PHYSICAL_MARK_RESTORE_CONFLICT' }
  )
  const otherAccount = { ...foreign, accountId: 'acct-b' }
  assert.equal(
    recoverPhysicalMarkAliases(
      { ...shared, preparations: [...next, otherAccount] },
      retired
    )[0].physicalMark.supersededAliases,
    undefined
  )
  const free = retirePhysicalMarkAliases(
    { ...state, preparations: next, batches: retired },
    () => time
  )
  assert.equal(free[0].physicalMark.retiredAt, undefined)
  assert.equal(free[0].physicalMark.history.at(-1).kind, 'revived')
  assert.equal(
    physicalMarkReservations({ ...state, preparations: next, batches: free })[0]
      .code,
    'CE26101002'
  )
})

test('native public carton identity correction retains the original current primary and physical facts, then grouping atomically hands its reservation over', async () => {
  const browser = await databaseBrowser()
  try {
    const original = independentMarkFixture(),
      prep = original.preparations[0],
      orderId = prep.orderId
    prep.groups[0].variants.push(...prep.groups[2].variants)
    prep.groups.pop()
    for (const [index, variant] of prep.groups[0].variants.entries()) {
      variant.variant = ['A', 'B'][index]
      variant.variantSuffix = variant.variant
    }
    const first = { orderId, groupId: prep.groups[0].id },
      second = { orderId, groupId: prep.groups[1].id }
    original.batches = [
      syntheticBatch(orderId, 1, '2', {
        id: 'retained-001',
        month: '2026-10',
        groups: [first],
        mark: first,
        cartonNumber: '001',
        weight: '9.53',
        len: '40',
        wid: '30',
        ht: '25',
        sourceFacts: { supplierCode: '001', original: true },
      }),
      syntheticBatch(orderId, 1, '1', {
        id: 'retained-3',
        month: '2026-10',
        groups: [first],
        mark: second,
        cartonNumber: '3',
        weight: '5.25',
      }),
      syntheticBatch(orderId, 1, '11', {
        id: 'retained-2',
        month: '2026-10',
        groups: [first, second],
        mark: second,
        cartonNumber: '2',
        weight: '11.25',
        contents: [
          { orderId, entryId: '2003', quantity: '3' },
          { orderId, entryId: '2002', quantity: '8' },
        ],
      }),
    ]
    Object.assign(
      original,
      activePackingState(
        original.preparations,
        original.allocations,
        original.issuedCodes
      )
    )
    const state = await openFixture(browser, original)
    const corrected = await browser.page.evaluate(
      async ({ second }) => {
        const ctx = await aliasDb.getOrderReconciliation({ orderId: '1001' }),
          before = await aliasDb.exportBackup({})
        const cartons = ctx.batches.map((batch) => ({
          ...batch,
          mark: second,
          len: '40',
          wid: '30',
          ht: '25',
          cartonNumber:
            batch.cartonNumber === '001' ? '0001' : batch.cartonNumber,
          baseRevision: batch.revision,
          draftKind: 'override',
          requiresDomainReview: true,
        }))
        const result = await aliasDb.confirmOrderCartons({
          orderId: '1001',
          expectedRevisions: ctx.revisions,
          draft: {
            version: 1,
            accountId: 'local',
            orderId: '1001',
            capacities: {},
            cartons,
            rejected: [],
            nextId: 1,
            generation: 0,
          },
        })
        return {
          before,
          after: await aliasDb.exportBackup({}),
          context: result,
        }
      },
      { second }
    )
    for (const field of [
      'orders',
      'preparations',
      'issuedCodes',
      'images',
      'allocations',
    ])
      assert.deepEqual(corrected.after[field], corrected.before[field], field)
    const carton = corrected.after.cartonBatches.find(
      (batch) => batch.id === 'retained-001'
    )
    assert.equal(carton.cartonNumber, '0001')
    assert.deepEqual(carton.mark, second)
    assert.equal(carton.physicalMark.originalCode, 'CE26101001')
    assert.equal(carton.physicalMark.productCode, 'CE26101002')
    assert.equal(carton.physicalMark.code, 'CE26101001')
    assert.equal(carton.physicalMark.resolution, null)
    assert.equal(
      corrected.after.issuedCodes.find(
        (entry) => entry.kind === 'base' && entry.code === 'CE26101001'
      ).groupId,
      first.groupId
    )
    for (const before of corrected.before.cartonBatches) {
      const after = corrected.after.cartonBatches.find(
        (batch) => batch.id === before.id
      )
      for (const field of [
        'id',
        'contents',
        'count',
        'received',
        'loaded',
        'weight',
        'weightBasis',
        'sourceFacts',
      ])
        assert.deepEqual(after[field], before[field], `${before.id} ${field}`)
      assert.deepEqual([after.len, after.wid, after.ht], ['40', '30', '25'])
      assert.ok(
        after.cartonHistory.some(
          (history) =>
            history.id === before.id &&
            history.revision === before.revision &&
            JSON.stringify(history.sourceFacts) ===
              JSON.stringify(before.sourceFacts)
        )
      )
    }
    const prepared = corrected.after.preparations[0],
      surviving = structuredClone(prepared)
    surviving.groups = [
      {
        ...surviving.groups[1],
        variants: [
          ...surviving.groups[1].variants,
          ...surviving.groups[0].variants,
        ],
      },
    ]
    const afterPlan = planCartonBatchChanges({
      batches: corrected.after.cartonBatches,
      records: corrected.after.orders,
      beforePreparations: [prepared],
      afterPreparations: [surviving],
      issuedCodes: corrected.after.issuedCodes,
    })
    await saveMerge(
      browser,
      { ...state, preparations: [prepared], records: corrected.after.orders },
      [surviving],
      afterPlan
    )
    const handed = await browser.page.evaluate(() => aliasDb.exportBackup({}))
    const handedIssued = await browser.page.evaluate(
      async () => (await aliasDb.getOperationalState({})).issuedCodes
    )
    assert.equal(
      handedIssued.find(
        (entry) => entry.kind === 'base' && entry.code === 'CE26101001'
      ).groupId,
      second.groupId
    )
    assert.equal(handed.preparations[0].groups[0].baseCode, 'CE26101002')
    assert.deepEqual(handed.orders, corrected.after.orders)
    assert.deepEqual(
      handed.cartonBatches.find((batch) => batch.id === carton.id).physicalMark
        .originalArtwork,
      carton.physicalMark.originalArtwork
    )
    const foreign = structuredClone(handed.preparations[0])
    foreign.groups.push({
      ...structuredClone(original.preparations[0].groups[0]),
      id: 'unrelated-primary',
      baseCode: 'CE26101001',
    })
    const refusal = await browser.page.evaluate(async (foreign) => {
      const before = await aliasDb.exportBackup({})
      let error
      try {
        await aliasDb.savePreparations([foreign], {
          expectedRevisions: [foreign.revision],
        })
      } catch (failure) {
        error = failure.code || failure.message
      }
      return { error, before, after: await aliasDb.exportBackup({}) }
    }, foreign)
    assert.match(refusal.error, /CONFLICT|already|duplicate/i)
    for (const field of [
      'orders',
      'preparations',
      'cartonBatches',
      'issuedCodes',
      'allocations',
    ])
      assert.deepEqual(refusal.after[field], refusal.before[field], field)
  } finally {
    await browser.close()
  }
})

for (const writer of [
  'modern-facts',
  'legacy-batches',
  'legacy-owner-correction',
])
  test(`native ${writer} retains after-only related goods through old-owner cancellation and preparation retirement`, async () => {
    const browser = await databaseBrowser()
    try {
      const input = independentMarkFixture(),
        prep = input.preparations[0],
        batch = input.batches[0]
      batch.mark = { orderId: '1001', groupId: prep.groups[1].id }
      batch.groups = [{ orderId: '1001', groupId: prep.groups[0].id }]
      batch.contents = [{ orderId: '1001', entryId: '2001', quantity: '30' }]
      batch.physicalMark = transitionPhysicalMark(
        batch,
        { ...batch, mark: { orderId: '1001', groupId: prep.groups[0].id } },
        input.preparations,
        input.preparations,
        {
          decision: {
            choice: 'keep-recorded-mark',
            reason: 'Actual retained independent physical mark',
          },
          updatedAt: time,
          issuedCodes: input.issuedCodes,
        }
      ).physicalMark
      batch.mark = { orderId: '1001', groupId: prep.groups[0].id }
      if (writer === 'legacy-batches') {
        delete batch.orderId
        delete batch.packingBasis
        delete batch.unresolvedContents
        delete batch.volumeBasis
      }
      const state = await openFixture(browser, input)
      const corrected = await browser.page.evaluate(async (writer) => {
        let ctx = await aliasDb.getOrderReconciliation({ orderId: '1001' }),
          before = ctx.batches[0]
        const target = ctx.preparation.groups.find((group) =>
          group.variants.some((variant) => variant.entryIds.includes('2003'))
        )
        const after = {
          ...before,
          groups: [{ orderId: '1001', groupId: target.id }],
          contents: [{ orderId: '1001', entryId: '2003', quantity: '30' }],
          cartonHistory: [],
          sourceFacts: { forged: true },
        }
        if (writer === 'modern-facts')
          await aliasDb.saveOrderCartonFacts({
            orderId: '1001',
            expectedRevisions: ctx.revisions,
            changes: [{ after, expectedRevision: before.revision }],
          })
        else if (writer === 'legacy-batches')
          await aliasDb.saveCartonBatches([
            { after, expectedRevision: before.revision },
          ])
        else {
          const review = await aliasDb.reviewLegacyCarton({
            batchId: before.id,
            expectedRevision: before.revision,
          })
          await aliasDb.resolveLegacyCarton({
            batchId: before.id,
            expectedRevision: before.revision,
            resolution: 'owner-corrected',
            ownerRef: { accountId: 'local', orderId: '1001' },
            mark: before.mark,
            contents: after.contents,
            reason:
              'Reviewed actual contents; independent physical mark is unchanged',
            attestNotShipped: true,
            expectedOrderRevisions: review.expectedOrderRevisions,
          })
        }
        ctx = await aliasDb.getOrderReconciliation({ orderId: '1001' })
        await aliasDb.setInventoryDispositions({
          orderId: '1001',
          entries: Object.fromEntries(
            ['2001', '2002'].map((id) => [
              id,
              {
                kind: 'canceled',
                quantity: '30',
                reason: 'Only corrected minority goods remain current',
              },
            ])
          ),
        })
        return {
          before,
          context: ctx,
          state: await aliasDb.getOperationalState({}),
        }
      }, writer)
      const after = corrected.context.batches[0]
      assert.equal(after.physicalMark.code, 'CE26101002')
      assert.ok(after.physicalMark.relatedEntryIds.includes('2003'))
      for (const field of [
        'id',
        'count',
        'received',
        'loaded',
        'len',
        'wid',
        'ht',
        'weight',
        'weightBasis',
        'sourceFacts',
      ])
        assert.deepEqual(after[field], corrected.before[field], field)
      assert.deepEqual(
        after.physicalMark.originalArtwork,
        corrected.before.physicalMark.originalArtwork
      )
      assert.equal(
        after.cartonHistory.length,
        corrected.before.cartonHistory.length + 1
      )
      assert.deepEqual(
        after.cartonHistory.at(-1).contents,
        corrected.before.contents
      )
      const retained = structuredClone(corrected.state.preparations[0])
      retained.groups = retained.groups.filter((group) =>
        group.variants.some((variant) => variant.entryIds.includes('2003'))
      )
      const plan = planCartonBatchChanges({
        batches: corrected.state.batches,
        records: corrected.state.records,
        beforePreparations: corrected.state.preparations,
        afterPreparations: [retained],
        issuedCodes: corrected.state.issuedCodes,
      })
      await saveMerge(browser, corrected.state, [retained], plan)
      const final = await browser.page.evaluate(() =>
        aliasDb.getOperationalState({})
      )
      const actual = final.batches.find((value) => value.id === batch.id)
      assert.equal(actual.physicalMark.retiredAt, undefined)
      assert.ok(actual.physicalMark.relatedEntryIds.includes('2003'))
      assert.ok(
        final.issuedCodes.some(
          (value) => value.code === 'CE26101002' && value.orderId === '1001'
        )
      )
      assert.deepEqual(final.records[0].snapshot, state.records[0].snapshot)
    } finally {
      await browser.close()
    }
  })

test('native active boxes whose released alias was reused return with a pending relabel-only review and retained physical evidence', async () => {
  const browser = await databaseBrowser()
  try {
    const state = await openFixture(browser, fixture()),
      { next, plan } = await mergePlan(state)
    await saveMerge(
      browser,
      state,
      next,
      resolvePhysicalMarkChange(plan, {
        batchId: state.batches[0].id,
        choice: 'keep-recorded-mark',
        reason: 'Original recorded mark kept before cancellation',
      })
    )
    const foreignRecord = syntheticOrder('1002', '30', {
        purchasedAt: '2026-10-05T12:00:00+08:00',
      }),
      foreign = createPreparation(foreignRecord.snapshot, '2026-10')
    foreign.groups[0].baseCode = 'CE26101002'
    const result = await browser.page.evaluate(
      async ({ foreignRecord, foreign }) => {
        const before = await aliasDb.exportBackup({})
        const dispositions = Object.fromEntries(
          ['2001', '2002'].map((id) => [
            id,
            {
              kind: 'canceled',
              quantity: '30',
              reason: 'All related goods canceled',
            },
          ])
        )
        await aliasDb.setInventoryDispositions({
          orderId: '1001',
          entries: dispositions,
        })
        const retired = await aliasDb.getOperationalState({})
        await aliasDb.restoreBackup({
          format: '1688-order-library',
          version: 1,
          exportedAt: '2026-10-23T05:00:00.000Z',
          orders: [foreignRecord],
          history: [],
          images: [],
        })
        await aliasDb.savePreparations([foreign], { expectedRevisions: [0] })
        await aliasDb.setInventoryDispositions({
          orderId: '1001',
          entries: { 2001: null, 2002: null },
          expectedValues: dispositions,
        })
        const ctx = await aliasDb.getOrderReconciliation({ orderId: '1001' })
        let error
        const beforeKeep = await aliasDb.exportBackup({})
        try {
          await aliasDb.resolveCartonPhysicalMark({
            orderId: '1001',
            batchId: ctx.batches[0].id,
            expectedRevisions: ctx.revisions,
            choice: 'keep-recorded-mark',
            reason: 'Old keep confirmation cannot be reused',
          })
        } catch (failure) {
          error = failure.code
        }
        return {
          before,
          retired,
          ctx,
          error,
          beforeKeep,
          afterKeep: await aliasDb.exportBackup({}),
          final: await aliasDb.getOperationalState({}),
        }
      },
      { foreignRecord, foreign }
    )
    assert.equal(result.retired.batches[0].deletedAt, undefined)
    assert.ok(result.retired.batches[0].physicalMark.retiredAt)
    const returned = result.ctx.batches[0]
    assert.equal(returned.deletedAt, undefined)
    assert.equal(returned.physicalMarkRelabelOnly, true)
    assert.equal(returned.physicalMarkResolutionRequired, true)
    assert.equal(returned.physicalMark.resolution, null)
    assert.equal(result.error, 'PHYSICAL_MARK_RELABEL_REQUIRED')
    for (const field of [
      'id',
      'contents',
      'count',
      'received',
      'loaded',
      'len',
      'wid',
      'ht',
      'weight',
      'weightBasis',
      'sourceFacts',
    ])
      assert.deepEqual(
        returned[field],
        result.before.cartonBatches[0][field],
        field
      )
    assert.deepEqual(
      returned.physicalMark.originalArtwork,
      result.before.cartonBatches[0].physicalMark.originalArtwork
    )
    assert.equal(
      result.final.issuedCodes.find(
        (value) => value.kind === 'base' && value.code === 'CE26101002'
      ).orderId,
      '1002'
    )
    for (const field of [
      'orders',
      'preparations',
      'cartonBatches',
      'containers',
      'issuedCodes',
      'shipmentLocks',
      'images',
    ])
      assert.deepEqual(result.afterKeep[field], result.beforeKeep[field], field)
    assert.deepEqual(result.ctx.record.snapshot, state.records[0].snapshot)
  } finally {
    await browser.close()
  }
})

async function recoveryArchiveFixture(
  browser,
  {
    sealedHolder = true,
    removeHolder = false,
    withDependencies = false,
    stopBeforeRelabel = false,
  } = {}
) {
  const input = fixture()
  for (const item of input.records[0].snapshot.items)
    item.thumbnail = `https://cbu01.alicdn.com/recovery-original-${item.entryId}.png`
  const state = await openFixture(browser, input),
    { next, plan } = await mergePlan(state)
  await saveMerge(browser, state, next, plan)
  const foreignRecord = syntheticOrder('1002', '30', {
      purchasedAt: '2026-10-05T12:00:00+08:00',
    }),
    foreign = createPreparation(foreignRecord.snapshot, '2026-10')
  foreignRecord.snapshot.items[0].thumbnail =
    'https://cbu01.alicdn.com/recovery-foreign-original.png'
  foreign.groups[0].baseCode = 'CE26101002'
  const fresh = createPreparation(state.records[0].snapshot, '2026-10')
  const support = syntheticOrder('1003', '7', {
      purchasedAt: '2026-10-06T12:00:00+08:00',
    }),
    other = syntheticOrder('1002', '5', {
      accountId: 'acct-b',
      purchasedAt: '2026-10-06T12:00:00+08:00',
    })
  support.snapshot.items[0].thumbnail =
    'https://cbu01.alicdn.com/recovery-support-original.png'
  other.snapshot.items[0].thumbnail =
    'https://cbu01.alicdn.com/recovery-other-account-original.png'
  const supportPrep = createPreparation(support.snapshot, '2026-10'),
    otherPrep = createPreparation(other.snapshot, '2026-10')
  supportPrep.groups[0].baseCode = 'CE26101003'
  otherPrep.groups[0].baseCode = 'CE26101002'
  return browser.page.evaluate(
    async ({
      state,
      foreignRecord,
      foreign,
      fresh,
      sealedHolder,
      removeHolder,
      withDependencies,
      support,
      supportPrep,
      other,
      otherPrep,
      stopBeforeRelabel,
    }) => {
      for (const record of [
        ...state.records,
        foreignRecord,
        ...(withDependencies ? [support, other] : []),
      ])
        for (const item of record.snapshot.items)
          await aliasDb.putImage({
            url: item.thumbnail,
            dataUrl: modules.fixture.SYNTHETIC_PHOTO,
            storedAt: '2026-10-23T05:00:00.000Z',
          })
      let ctx = await aliasDb.getOrderReconciliation({ orderId: '1001' })
      await aliasDb.removeCartonBatch(ctx.batches[0])
      await aliasDb.removeOrders(['1001'])
      await aliasDb.restoreBackup({
        format: '1688-order-library',
        version: 1,
        exportedAt: '2026-10-23T05:00:00.000Z',
        orders: [foreignRecord],
        history: [],
        images: [],
      })
      const [foreignSaved] = await aliasDb.savePreparations([foreign], {
        expectedRevisions: [0],
      })
      if (withDependencies) {
        await aliasDb.restoreBackup({
          format: '1688-order-library',
          version: 1,
          exportedAt: '2026-10-23T05:00:00.000Z',
          orders: [support, other],
          history: [],
          images: [],
        })
        const [saved] = await aliasDb.savePreparations(
          [supportPrep, otherPrep],
          { expectedRevisions: [0, 0] }
        )
        const mark = { orderId: '1003', groupId: saved.groups[0].id },
          scope = await aliasDb.getOrderReconciliation({ orderId: '1003' })
        await aliasDb.saveOrderCartonFacts({
          orderId: '1003',
          expectedRevisions: scope.revisions,
          changes: [
            {
              after: modules.fixture.syntheticBatch('1003', 1, '7', {
                month: '2026-10',
                groups: [mark],
                mark,
                received: 1,
                weight: '4.2501',
                len: '40',
                wid: '30',
                ht: '25',
                revision: 0,
              }),
              expectedRevision: 0,
            },
          ],
        })
      }
      async function seal(orderId, name) {
        const c = await aliasDb.createContainer({ name })
        let v = await aliasDb.includeContainerOrders({
          id: c.id,
          expectedRevision: c.revision,
          orderRefs: [
            { orderId },
            ...(withDependencies && orderId === '1002'
              ? [{ orderId: '1003' }]
              : []),
          ],
        })
        v = await aliasDb.markContainerLoaded({
          id: c.id,
          expectedRevision: v.container.revision,
        })
        const r = await aliasDb.reviewContainerSeal({
          id: c.id,
          expectedRevision: v.container.revision,
        })
        if (!r.ready) throw new Error(JSON.stringify(r.issues))
        return aliasDb.sealContainer({
          id: c.id,
          expectedRevision: v.container.revision,
          reviewToken: r.reviewToken,
        })
      }
      let foreignManifest
      if (sealedHolder) {
        ctx = await aliasDb.getOrderReconciliation({ orderId: '1002' })
        const mark = { orderId: '1002', groupId: foreignSaved.groups[0].id }
        await aliasDb.saveOrderCartonFacts({
          orderId: '1002',
          expectedRevisions: ctx.revisions,
          changes: [
            {
              after: modules.fixture.syntheticBatch('1002', 1, '30', {
                month: '2026-10',
                groups: [mark],
                mark,
                received: 1,
                weight: '8.2504',
                len: '50',
                wid: '40',
                ht: '30',
                revision: 0,
              }),
              expectedRevision: 0,
            },
          ],
        })
        foreignManifest = await seal('1002', 'Actual superseding holder')
      }
      await aliasDb.restoreBackup({
        format: '1688-order-library',
        version: 1,
        exportedAt: '2026-10-23T05:00:00.000Z',
        orders: state.records,
        history: [],
        images: [],
      })
      await aliasDb.savePreparations([fresh], { expectedRevisions: [0] })
      const archives = []
      async function capture(stage) {
        const full = await aliasDb.exportBackup({})
        archives.push({
          stage,
          full,
          order: await aliasDb.exportBackup({ orderIds: ['1001'] }),
        })
      }
      if (removeHolder) {
        await capture('foreign-current')
        const current = await aliasDb.getPreparation('1002')
        await aliasDb.savePreparations([{ ...current, groups: [] }], {
          expectedRevisions: [current.revision],
        })
        await capture('foreign-retired')
        await aliasDb.removeOrders(['1002'])
        await capture('foreign-deleted')
        return { archives, original: state, foreignManifest }
      }
      await capture('tombstoned-before-relabel')
      ctx = await aliasDb.getOrderReconciliation({ orderId: '1001' })
      const batch = ctx.batches[0],
        owner = batch.physicalMarkOwnerChoices[0],
        after = { ...batch, groups: owner.groups, mark: owner.mark }
      delete after.deletedAt
      await aliasDb.saveOrderCartonFacts({
        orderId: '1001',
        expectedRevisions: ctx.revisions,
        changes: [{ after, restore: true, expectedRevision: batch.revision }],
      })
      await capture('active-before-relabel')
      if (stopBeforeRelabel)
        return { archives, original: state, foreignManifest }
      ctx = await aliasDb.getOrderReconciliation({ orderId: '1001' })
      await aliasDb.resolveCartonPhysicalMark({
        orderId: '1001',
        batchId: batch.id,
        expectedRevisions: ctx.revisions,
        targetMark: owner.mark,
        choice: 'relabel-reprint',
        reason: 'Confirmed fresh current physical labels',
        physicalRelabelConfirmed: true,
      })
      await capture('after-relabel')
      await seal('1001', 'Recovered original shipment')
      await capture('after-new-seal')
      return { archives, original: state, foreignManifest }
    },
    {
      state,
      foreignRecord,
      foreign,
      fresh,
      sealedHolder,
      removeHolder,
      withDependencies,
      support,
      supportPrep,
      other,
      otherPrep,
      stopBeforeRelabel,
    }
  )
}

for (const archiveKind of ['order', 'packing'])
  test(`native superseded recovery ${archiveKind} archives retain P1 requested scope and complete foreign dependencies before and after relabel/seal`, async () => {
    const browser = await databaseBrowser()
    try {
      const result = await recoveryArchiveFixture(browser)
      for (const stage of result.archives) {
        const prep = stage.full.preparations.find((p) => p.orderId === '1001'),
          selection = {
            months: ['2026-10'],
            orders: [
              {
                accountId: 'local',
                orderId: '1001',
                entryIds: prep.groups.flatMap((g) =>
                  g.variants.flatMap((v) => v.entryIds)
                ),
              },
            ],
          }
        const archive =
          archiveKind === 'order'
            ? stage.order
            : createPackingBackup(stage.full, selection)
        const restored = await browser.page.evaluate(
          async ({ archive, name }) => {
            const db = await modules.openDatabase({ name })
            try {
              await db.restoreBackup(archive)
              return {
                backup: await db.exportBackup({}),
                state: await db.getOperationalState({}),
              }
            } finally {
              db.close()
            }
          },
          { archive, name: `synthetic-recovery-${archiveKind}-${stage.stage}` }
        )
        assert.deepEqual(
          archive.orders.map((o) => o.snapshot.orderId).sort(),
          ['1001', '1002'],
          stage.stage
        )
        assert.deepEqual(
          archiveKind === 'packing'
            ? archive.requestedPackingScope.orders
            : archive.requestedOrderRefs,
          archiveKind === 'packing'
            ? selection.orders
            : [{ accountId: 'local', orderId: '1001' }]
        )
        assert.deepEqual(archive.dependencyOrderRefs, [
          { accountId: 'local', orderId: '1002' },
        ])
        assert.equal(
          JSON.stringify(restored.backup.containers),
          JSON.stringify(stage.full.containers),
          stage.stage
        )
        assert.equal(
          JSON.stringify(restored.backup.shipmentLocks),
          JSON.stringify(stage.full.shipmentLocks),
          stage.stage
        )
        assert.deepEqual(restored.backup.orders, stage.full.orders)
        assert.deepEqual(restored.backup.images, stage.full.images)
        assert.equal(archive.images.length, 3)
        assert.deepEqual(
          restored.backup.cartonBatches,
          stage.full.cartonBatches
        )
        const actual = restored.state.batches.find((b) => b.orderId === '1001')
        assert.equal(
          Boolean(actual.deletedAt),
          stage.stage === 'tombstoned-before-relabel'
        )
        assert.equal(
          actual.physicalMarkRelabelOnly,
          stage.stage.endsWith('before-relabel')
        )
        assert.equal(actual.physicalMark.originalCode, 'CE26101002')
        assert.equal(
          restored.state.issuedCodes.find(
            (c) => c.kind === 'base' && c.code === 'CE26101002'
          ).orderId,
          '1002'
        )
        if (archiveKind === 'packing')
          assert.throws(
            () =>
              createPackingBackup(stage.full, {
                ...selection,
                orders: [
                  {
                    ...selection.orders[0],
                    entryIds: selection.orders[0].entryIds.slice(0, 1),
                  },
                ],
              }),
            { code: 'PACKING_BACKUP_DEPENDENCY_REVIEW' }
          )
      }
    } finally {
      await browser.close()
    }
  })

test('native witnessed supersession restores after an unconsumed foreign holder is deleted, re-reserves the free alias and permits keep', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await recoveryArchiveFixture(browser, {
        sealedHolder: false,
        removeHolder: true,
      }),
      full = result.archives.find((a) => a.stage === 'foreign-deleted').full
    assert.deepEqual(
      full.orders.map((o) => o.snapshot.orderId),
      ['1001']
    )
    const restored = await browser.page.evaluate(async (full) => {
      const db = await modules.openDatabase({
        name: 'synthetic-historical-supersession-full',
      })
      try {
        await db.restoreBackup(full)
        return {
          backup: await db.exportBackup({}),
          state: await db.getOperationalState({}),
        }
      } finally {
        db.close()
      }
    }, full)
    const actual = restored.state.batches[0]
    assert.equal(actual.physicalMarkRelabelOnly, false)
    assert.equal(actual.physicalMarkConflictKind, 'none')
    assert.equal(actual.physicalMark.supersededAliases[0].active, false)
    assert.ok(actual.physicalMark.supersededAliases[0].reservationWitness)
    assert.ok(actual.deletedAt)
    assert.equal(actual.physicalMark.originalCode, 'CE26101002')
    assert.equal(
      restored.state.issuedCodes.find(
        (c) => c.code === 'CE26101002' && c.kind === 'base'
      ).orderId,
      '1001'
    )
    assert.deepEqual(restored.backup.orders, full.orders)
    assert.deepEqual(restored.backup.cartonBatches, full.cartonBatches)
    assert.deepEqual(restored.backup.shipmentLocks, [])
    assert.equal(
      full.images.length,
      3,
      'The actual retired reservation witness retains the foreign original photo'
    )
    const kept = await browser.page.evaluate(async (full) => {
      const db = await modules.openDatabase({
        name: 'synthetic-historical-keep-after-release',
      })
      try {
        await db.restoreBackup(full)
        let ctx = await db.getOrderReconciliation({ orderId: '1001' }),
          batch = ctx.batches[0],
          owner = batch.physicalMarkOwnerChoices[0],
          after = { ...batch, groups: owner.groups, mark: owner.mark }
        delete after.deletedAt
        await db.saveOrderCartonFacts({
          orderId: '1001',
          expectedRevisions: ctx.revisions,
          changes: [{ after, restore: true, expectedRevision: batch.revision }],
        })
        ctx = await db.getOrderReconciliation({ orderId: '1001' })
        const kept = await db.resolveCartonPhysicalMark({
          orderId: '1001',
          batchId: batch.id,
          expectedRevisions: ctx.revisions,
          targetMark: owner.mark,
          choice: 'keep-recorded-mark',
          reason:
            'Actual unused foreign code is free and recorded boxes were kept',
        })
        const c = await db.createContainer({ name: 'Permitted returned alias' })
        let v = await db.includeContainerOrders({
          id: c.id,
          expectedRevision: c.revision,
          orderRefs: [{ orderId: '1001' }],
        })
        v = await db.markContainerLoaded({
          id: c.id,
          expectedRevision: v.container.revision,
        })
        const r = await db.reviewContainerSeal({
          id: c.id,
          expectedRevision: v.container.revision,
        })
        if (!r.ready) throw new Error(JSON.stringify(r.issues))
        const manifest = await db.sealContainer({
          id: c.id,
          expectedRevision: v.container.revision,
          reviewToken: r.reviewToken,
        })
        const final = await db.exportBackup({})
        const copy = await modules.openDatabase({
          name: 'synthetic-kept-returned-alias-full',
        })
        let roundtrip
        try {
          await copy.restoreBackup(final)
          roundtrip = await copy.exportBackup({})
        } finally {
          copy.close()
        }
        return {
          kept,
          manifest,
          final,
          roundtrip,
          state: await db.getOperationalState({}),
        }
      } finally {
        db.close()
      }
    }, full)
    assert.equal(
      kept.kept.batches[0].physicalMark.resolution.choice,
      'keep-recorded-mark'
    )
    assert.equal(kept.manifest.cartons[0].markCode, 'CE26101002')
    assert.deepEqual(kept.roundtrip.containers, kept.final.containers)
    assert.deepEqual(kept.roundtrip.shipmentLocks, kept.final.shipmentLocks)
    assert.deepEqual(kept.roundtrip.cartonBatches, kept.final.cartonBatches)
    assert.ok(
      kept.state.locks.some(
        (lock) =>
          lock.kind === 'code-consumption' &&
          lock.orderId === '1001' &&
          lock.lineages.some((l) => l.baseCode === 'CE26101002')
      )
    )
  } finally {
    await browser.close()
  }
})

test('native recovery archive dependency closure follows the actual foreign shipment across whole orders and excludes an unrelated account', async () => {
  const browser = await databaseBrowser()
  try {
    const { archives } = await recoveryArchiveFixture(browser, {
        withDependencies: true,
      }),
      stage = archives[0],
      prep = stage.full.preparations.find(
        (p) => p.accountId === 'local' && p.orderId === '1001'
      )
    const selection = {
      months: ['2026-10'],
      orders: [
        {
          accountId: 'local',
          orderId: '1001',
          entryIds: prep.groups.flatMap((g) =>
            g.variants.flatMap((v) => v.entryIds)
          ),
        },
      ],
    }
    for (const [kind, archive] of [
      ['order', stage.order],
      ['packing', createPackingBackup(stage.full, selection)],
    ]) {
      assert.deepEqual(
        archive.orders.map((r) => [r.snapshot.accountId, r.snapshot.orderId]),
        [
          ['local', '1001'],
          ['local', '1002'],
          ['local', '1003'],
        ]
      )
      assert.deepEqual(archive.dependencyOrderRefs, [
        { accountId: 'local', orderId: '1002' },
        { accountId: 'local', orderId: '1003' },
      ])
      assert.equal(
        archive.preparations.some((p) => p.accountId === 'acct-b'),
        false
      )
      assert.equal(
        archive.issuedCodes.some((c) => c.accountId === 'acct-b'),
        false
      )
      assert.equal(archive.images.length, 4)
      assert.equal(
        archive.images.some((image) => image.url.includes('other-account')),
        false
      )
      const restored = await browser.page.evaluate(
        async ({ archive, name }) => {
          const db = await modules.openDatabase({ name })
          try {
            await db.restoreBackup(archive)
            return db.exportBackup({})
          } finally {
            db.close()
          }
        },
        { archive, name: `synthetic-transitive-recovery-${kind}` }
      )
      assert.equal(
        JSON.stringify(restored.containers),
        JSON.stringify(stage.full.containers)
      )
      assert.equal(
        JSON.stringify(restored.shipmentLocks),
        JSON.stringify(stage.full.shipmentLocks)
      )
      assert.deepEqual(
        restored.orders,
        stage.full.orders.filter((r) => r.snapshot.accountId === 'local')
      )
      assert.deepEqual(restored.images, archive.images)
    }
  } finally {
    await browser.close()
  }
})

test('native witnessless historical archive restores held, ignores forged clearance and completes only through a fresh confirmed physical review', async () => {
  const browser = await databaseBrowser()
  try {
    const scenario = await recoveryArchiveFixture(browser, {
        sealedHolder: false,
        removeHolder: true,
      }),
      archive = structuredClone(
        scenario.archives.find((a) => a.stage === 'foreign-deleted').full
      )
    const strip = (value) => {
      if (!value || typeof value !== 'object') return
      delete value.reservationWitness
      delete value.active
      delete value.reviewRequired
      delete value.reviewedAt
      Object.values(value).forEach(strip)
    }
    strip(archive.cartonBatches)
    const result = await browser.page.evaluate(async (archive) => {
      const db = await modules.openDatabase({
        name: 'synthetic-old-witnessless-held',
      })
      try {
        await db.restoreBackup(archive)
        let ctx = await db.getOrderReconciliation({ orderId: '1001' }),
          held = ctx.batches[0],
          draft = structuredClone(held)
        draft.physicalMark.supersededAliases[0].reviewRequired = false
        draft.physicalMark.supersededAliases[0].active = false
        await db.saveOrderCartonFacts({
          orderId: '1001',
          expectedRevisions: ctx.revisions,
          changes: [{ after: draft, expectedRevision: held.revision }],
        })
        const ignored = await db.getOrderReconciliation({ orderId: '1001' }),
          before = await db.exportBackup({})
        let error
        try {
          await db.resolveCartonPhysicalMark({
            orderId: '1001',
            batchId: held.id,
            expectedRevisions: ignored.revisions,
            targetMark: ignored.batches[0].physicalMarkOwnerChoices[0].mark,
            choice: 'keep-recorded-mark',
            reason: 'Arbitrary old history cannot prove release',
          })
        } catch (failure) {
          error = failure.code
        }
        const after = await db.exportBackup({}),
          owner = ignored.batches[0].physicalMarkOwnerChoices[0],
          restored = {
            ...ignored.batches[0],
            mark: owner.mark,
            groups: owner.groups,
          }
        delete restored.deletedAt
        await db.saveOrderCartonFacts({
          orderId: '1001',
          expectedRevisions: ignored.revisions,
          changes: [
            {
              after: restored,
              restore: true,
              expectedRevision: restored.revision,
            },
          ],
        })
        ctx = await db.getOrderReconciliation({ orderId: '1001' })
        const reviewed = await db.resolveCartonPhysicalMark({
          orderId: '1001',
          batchId: held.id,
          expectedRevisions: ctx.revisions,
          targetMark: owner.mark,
          choice: 'relabel-reprint',
          reason:
            'Reviewed uncertain imported history and physically applied the current fresh labels',
          physicalRelabelConfirmed: true,
        })
        const c = await db.createContainer({
          name: 'Explicitly reviewed old archive',
        })
        let view = await db.includeContainerOrders({
          id: c.id,
          expectedRevision: c.revision,
          orderRefs: [{ orderId: '1001' }],
        })
        view = await db.markContainerLoaded({
          id: c.id,
          expectedRevision: view.container.revision,
        })
        const sealReview = await db.reviewContainerSeal({
          id: c.id,
          expectedRevision: view.container.revision,
        })
        if (!sealReview.ready)
          throw new Error(JSON.stringify(sealReview.issues))
        const manifest = await db.sealContainer({
          id: c.id,
          expectedRevision: view.container.revision,
          reviewToken: sealReview.reviewToken,
        })
        return {
          held,
          ignored,
          error,
          before,
          after,
          reviewed,
          manifest,
          backup: await db.exportBackup({}),
        }
      } finally {
        db.close()
      }
    }, archive)
    assert.equal(result.held.physicalMarkHistoricalReviewRequired, true)
    assert.equal(result.held.physicalMarkConflictKind, 'historical-review')
    assert.equal(
      result.ignored.batches[0].physicalMarkHistoricalReviewRequired,
      true
    )
    assert.equal(result.error, 'PHYSICAL_MARK_RELABEL_REQUIRED')
    for (const field of [
      'orders',
      'preparations',
      'cartonBatches',
      'issuedCodes',
      'shipmentLocks',
      'containers',
      'operationIntents',
    ])
      assert.deepEqual(result.before[field], result.after[field], field)
    assert.equal(
      result.reviewed.batches[0].physicalMarkHistoricalReviewRequired,
      false
    )
    assert.equal(
      result.reviewed.batches[0].physicalMarkResolutionRequired,
      false
    )
    assert.equal(
      result.reviewed.batches[0].physicalMark.resolution
        .physicalRelabelConfirmed,
      true
    )
    assert.equal(result.manifest.draft, false)
    assert.deepEqual(result.backup.orders, archive.orders)
    for (const field of [
      'id',
      'count',
      'contents',
      'len',
      'wid',
      'ht',
      'weight',
      'weightBasis',
      'sourceFacts',
      'received',
      'loaded',
    ])
      assert.deepEqual(
        result.reviewed.batches[0][field],
        archive.cartonBatches[0][field],
        field
      )
    assert.deepEqual(
      result.reviewed.batches[0].physicalMark.originalArtwork,
      archive.cartonBatches[0].physicalMark.originalArtwork
    )
  } finally {
    await browser.close()
  }
})

test('native archival witness and current release forgeries fail atomically, including resurrection of a former live holder', async () => {
  const browser = await databaseBrowser()
  try {
    const scenario = await recoveryArchiveFixture(browser, {
        sealedHolder: false,
        removeHolder: true,
      }),
      free = scenario.archives.find((a) => a.stage === 'foreign-deleted').full,
      occupied = scenario.archives.find(
        (a) => a.stage === 'foreign-current'
      ).full
    const copies = []
    for (const mutate of [
      (w) => {
        w.reservation.sellerId = 'forged-namespace'
      },
      (w) => {
        w.reservation.orderId = '9999'
      },
      (w) => {
        w.retiredRevision = 9999
      },
    ]) {
      const bad = structuredClone(free)
      mutate(
        bad.cartonBatches[0].physicalMark.supersededAliases[0]
          .reservationWitness
      )
      copies.push(bad)
    }
    const result = await browser.page.evaluate(
      async ({ copies, free, occupied }) => {
        const failures = []
        for (const [index, bad] of copies.entries()) {
          const db = await modules.openDatabase({
            name: `synthetic-forged-witness-${index}`,
          })
          try {
            const before = await db.exportBackup({})
            let error
            try {
              await db.restoreBackup(bad)
            } catch (failure) {
              error = failure.code || failure.message
            }
            failures.push({ error, before, after: await db.exportBackup({}) })
          } finally {
            db.close()
          }
        }
        const db = await modules.openDatabase({
          name: 'synthetic-current-alias-cannot-be-stolen',
        })
        try {
          await db.restoreBackup(free)
          const before = await db.exportBackup({})
          let error
          try {
            await db.restoreBackup(occupied)
          } catch (failure) {
            error = failure.code || failure.message
          }
          return {
            failures,
            current: { error, before, after: await db.exportBackup({}) },
            state: await db.getOperationalState({}),
          }
        } finally {
          db.close()
        }
      },
      { copies, free, occupied }
    )
    for (const failure of result.failures) {
      assert.equal(failure.error, 'PHYSICAL_MARK_RESTORE_CONFLICT')
      for (const field of [
        'orders',
        'preparations',
        'cartonBatches',
        'issuedCodes',
        'shipmentLocks',
        'containers',
        'images',
      ])
        assert.deepEqual(failure.after[field], failure.before[field], field)
    }
    assert.match(
      result.current.error,
      /PACKING_CODE_CONFLICT|PHYSICAL_MARK_RESTORE_CONFLICT/
    )
    for (const field of [
      'orders',
      'preparations',
      'cartonBatches',
      'issuedCodes',
      'shipmentLocks',
      'containers',
      'images',
    ])
      assert.deepEqual(
        result.current.after[field],
        result.current.before[field],
        field
      )
    assert.equal(
      result.state.issuedCodes.find(
        (c) => c.kind === 'base' && c.code === 'CE26101002'
      ).orderId,
      '1001'
    )
  } finally {
    await browser.close()
  }
})

test('native unused-holder retirement and deletion preserve witnessed full, order and packing archives with free P1 alias ownership', async () => {
  const browser = await databaseBrowser()
  try {
    const { archives } = await recoveryArchiveFixture(browser, {
      sealedHolder: false,
      removeHolder: true,
    })
    for (const stage of archives.filter((a) => a.stage !== 'foreign-current')) {
      const prep = stage.full.preparations.find((p) => p.orderId === '1001'),
        selection = {
          months: ['2026-10'],
          orders: [
            {
              accountId: 'local',
              orderId: '1001',
              entryIds: prep.groups.flatMap((g) =>
                g.variants.flatMap((v) => v.entryIds)
              ),
            },
          ],
        }
      for (const [kind, archive] of [
        ['full', stage.full],
        ['order', stage.order],
        ['packing', createPackingBackup(stage.full, selection)],
      ]) {
        const restored = await browser.page.evaluate(
          async ({ archive, name }) => {
            const db = await modules.openDatabase({ name })
            try {
              await db.restoreBackup(archive)
              return {
                backup: await db.exportBackup({}),
                state: await db.getOperationalState({}),
              }
            } finally {
              db.close()
            }
          },
          { archive, name: `synthetic-unused-holder-${stage.stage}-${kind}` }
        )
        assert.equal(restored.state.batches[0].physicalMarkRelabelOnly, false)
        assert.equal(
          restored.state.batches[0].physicalMarkHistoricalReviewRequired,
          false
        )
        assert.equal(restored.state.batches[0].physicalMarkConflictKind, 'none')
        assert.equal(
          restored.state.issuedCodes.find(
            (c) => c.code === 'CE26101002' && c.kind === 'base'
          ).orderId,
          '1001'
        )
        assert.deepEqual(restored.backup.orders, stage.full.orders)
        assert.deepEqual(
          restored.backup.cartonBatches,
          stage.full.cartonBatches
        )
        assert.deepEqual(restored.backup.images, stage.full.images)
        assert.equal(restored.backup.images.length, 3)
        assert.deepEqual(restored.backup.containers, [])
        assert.deepEqual(restored.backup.shipmentLocks, [])
        if (kind !== 'full')
          assert.deepEqual(
            archive.dependencyOrderRefs,
            stage.stage === 'foreign-retired'
              ? [{ accountId: 'local', orderId: '1002' }]
              : []
          )
      }
    }
  } finally {
    await browser.close()
  }
})

test('native current-holder conflict is temporary and becomes permanent if that actual holder seals before release', async () => {
  const browser = await databaseBrowser()
  try {
    await recoveryArchiveFixture(browser, {
      sealedHolder: false,
      stopBeforeRelabel: true,
    })
    const result = await browser.page.evaluate(async () => {
      const temporary = await aliasDb.getOrderReconciliation({
          orderId: '1001',
        }),
        batch = temporary.batches[0],
        target = batch.physicalMarkOwnerChoices[0].mark,
        before = await aliasDb.exportBackup({})
      let keepError
      try {
        await aliasDb.resolveCartonPhysicalMark({
          orderId: '1001',
          batchId: batch.id,
          expectedRevisions: temporary.revisions,
          targetMark: target,
          choice: 'keep-recorded-mark',
          reason: 'Cannot steal a current primary',
        })
      } catch (error) {
        keepError = error.code
      }
      const after = await aliasDb.exportBackup({}),
        foreign = await aliasDb.getOrderReconciliation({ orderId: '1002' }),
        mark = { orderId: '1002', groupId: foreign.preparation.groups[0].id }
      await aliasDb.saveOrderCartonFacts({
        orderId: '1002',
        expectedRevisions: foreign.revisions,
        changes: [
          {
            after: modules.fixture.syntheticBatch('1002', 1, '30', {
              month: '2026-10',
              groups: [mark],
              mark,
              received: 1,
              weight: '8.2504',
              len: '50',
              wid: '40',
              ht: '30',
              revision: 0,
            }),
            expectedRevision: 0,
          },
        ],
      })
      const c = await aliasDb.createContainer({
        name: 'Temporary holder becomes sealed',
      })
      let view = await aliasDb.includeContainerOrders({
        id: c.id,
        expectedRevision: c.revision,
        orderRefs: [{ orderId: '1002' }],
      })
      view = await aliasDb.markContainerLoaded({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      const review = await aliasDb.reviewContainerSeal({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      if (!review.ready) throw new Error(JSON.stringify(review.issues))
      const sealed = await aliasDb.sealContainer({
          id: c.id,
          expectedRevision: view.container.revision,
          reviewToken: review.reviewToken,
        }),
        permanent = await aliasDb.getOrderReconciliation({ orderId: '1001' })
      let permanentError
      try {
        await aliasDb.resolveCartonPhysicalMark({
          orderId: '1001',
          batchId: batch.id,
          expectedRevisions: permanent.revisions,
          targetMark: target,
          choice: 'keep-recorded-mark',
          reason: 'Cannot take sealed goods code',
        })
      } catch (error) {
        permanentError = error.code
      }
      return {
        temporary,
        before,
        after,
        keepError,
        sealed,
        permanent,
        permanentError,
        state: await aliasDb.getOperationalState({}),
      }
    })
    assert.equal(
      result.temporary.batches[0].physicalMarkConflictKind,
      'temporary'
    )
    assert.match(
      result.temporary.batches[0].physicalMarkConflictReason,
      /1002.*currently owns.*clears.*releases/
    )
    assert.equal(result.keepError, 'PHYSICAL_MARK_RELABEL_REQUIRED')
    for (const field of [
      'orders',
      'preparations',
      'cartonBatches',
      'issuedCodes',
      'containers',
      'shipmentLocks',
    ])
      assert.deepEqual(result.after[field], result.before[field], field)
    assert.equal(
      result.permanent.batches[0].physicalMarkConflictKind,
      'permanent'
    )
    assert.deepEqual(
      result.permanent.batches[0].physicalMarkResolutionChoices,
      ['relabel-reprint']
    )
    assert.equal(result.permanentError, 'PHYSICAL_MARK_RELABEL_REQUIRED')
    assert.ok(
      result.permanent.batches[0].physicalMarkSupersessions[0].conflicts.some(
        (c) =>
          c.kind === 'code-consumption' &&
          c.containerId === result.sealed.container.id
      )
    )
    assert.equal(
      result.state.issuedCodes.find(
        (c) => c.kind === 'base' && c.code === 'CE26101002'
      ).orderId,
      '1002'
    )
  } finally {
    await browser.close()
  }
})
