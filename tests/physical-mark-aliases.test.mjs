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

test('native current alias reserves through carton retirement, releases only after all goods cancel, and conflicts on revival or restore atomically', async () => {
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
          expectedValues: dispositions,
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
    assert.match(result.revivalConflict, /CODE_CONFLICT|conflict/i)
    assert.match(result.restoreConflict, /CODE_CONFLICT|conflict/i)
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
        (event) => event.kind === 'revived'
      )
    )
    assert.ok(
      result.freeRevival.issuedCodes.some(
        (entry) => entry.code === 'CE26101002' && entry.orderId === '1001'
      )
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

test('native confirmed relabel survives logical grouping Undo conflict and historical Redo data never replays a physical attestation', async () => {
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
        await aliasDb.savePreparations([current], {
          expectedRevisions: [current.revision],
          cartonBatchChanges: [
            { after: historical, expectedRevision: historical.revision },
          ],
          allowCartonReview: true,
        })
        const afterRedo = await aliasDb.exportBackup({})
        return { before, afterUndo, afterRedo, undoError }
      },
      { original: state.preparations[0], batch: state.batches[0] }
    )
    assert.match(result.undoError, /CODE_CONFLICT|conflict/i)
    for (const field of [
      'orders',
      'preparations',
      'cartonBatches',
      'issuedCodes',
      'allocations',
    ])
      assert.deepEqual(result.afterUndo[field], result.before[field], field)
    assert.equal(
      result.afterRedo.cartonBatches[0].physicalMark.code,
      'CE26101001'
    )
    assert.equal(
      result.afterRedo.cartonBatches[0].physicalMark.resolution.choice,
      'relabel-reprint'
    )
    assert.equal(
      result.afterRedo.cartonBatches[0].physicalMark.resolution.reason,
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
