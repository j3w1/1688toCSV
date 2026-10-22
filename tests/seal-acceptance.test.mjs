import test from 'node:test'
import assert from 'node:assert/strict'
import { read } from 'xlsx'
import { createStoreOrder } from '../src/store-order.js'
import { createPreparation, allocatePreparation } from '../src/packing-model.js'
import {
  createLegacyCartonBatches,
  validateCartonBatch,
} from '../src/carton-batches.js'
import {
  captureContainerOrder,
  projectContainer,
} from '../src/container-model.js'
import { reconcileOrder } from '../src/carton-reconciliation.js'
import { parsePackingReportCells } from '../src/packing-report-cells.js'
import {
  analyzePackingReport,
  validatePackingReportReview,
} from '../src/packing-report-model.js'
import { planPackingReportUpdate } from '../src/packing-report-matches.js'
import {
  createContainerWorkbook,
  createContainerSummary,
} from '../src/container-export.js'
import {
  syntheticOrder,
  SYNTHETIC_PHOTO,
} from './fixtures/container-fixture.mjs'

// Cross-module calculation/transport acceptance. Real IndexedDB transactions
// and operator browser flows have separate tests; these fixtures certify neither.
function prepared(record) {
  const draft = createPreparation(record.snapshot, '2026-09')
  for (const group of draft.groups) {
    group.spanishName = 'PRODUCTO SINTETICO'
    group.category = '合成商品'
  }
  return allocatePreparation(draft, [], [], { snapshot: record.snapshot })
    .preparation
}
function loadedProjection(state) {
  const container = {
    id: 'synthetic-acceptance-container',
    accountId: 'local',
    name: 'Synthetic acceptance',
    period: '2026-11',
    loadingDate: '2026-11-01',
    status: 'draft',
    revision: 1,
    revisions: [],
    draft: { orders: [], decisions: {} },
  }
  container.draft.orders = state.records.map((record) =>
    captureContainerOrder(state, record.snapshot, container.id)
  )
  for (const member of container.draft.orders)
    for (const carton of member.cartons)
      container.draft.decisions[carton.id] = 'loaded'
  const manifest = projectContainer(state, container)
  assert.equal(manifest.readiness.ready, true, JSON.stringify(manifest.issues))
  return manifest
}
async function workbookAndSummary(manifest) {
  const bytes = await createContainerWorkbook(manifest, {
    columns: ['barcode', 'quantity', 'sourceUnitPrice', 'effectiveAmount'],
  })
  const workbook = read(bytes, { type: 'array' })
  assert.deepEqual(workbook.SheetNames, ['Packing list', 'Cartons', 'Se quedó'])
  const summary = createContainerSummary(manifest, {
    file: 'DRAFT-synthetic-acceptance.xlsx',
  })
  assert.equal(summary.draft, true)
  assert.equal(summary.scope, 'container-revision')
  assert.equal(summary.containerId, manifest.container.id)
  return { workbook, summary }
}

test('AC2/18 China declared purchases preserve1350 source units through15 physical cartons and three-sheet output', async () => {
  const quantities = [100, 150, 500, 500, 100],
    capacities = [50, 75, 100, 100, 100]
  const record = await createStoreOrder(
    {
      filename: '1234.xlsx',
      sheetName: 'Synthetic products',
      purchaseDate: '2026-09-04',
      store: {
        key: 'market:1234',
        name: 'Synthetic market',
        number: '1234',
        kind: 'market',
      },
      total: '1350.00',
      rows: quantities.map((quantity, index) => ({
        row: index + 7,
        group: String(index + 1),
        title: `Synthetic product ${index + 1}`,
        description: `Synthetic product ${index + 1}`,
        boxes: quantity / capacities[index],
        perbox: capacities[index],
        quantity,
        price: '1.00',
        amount: `${quantity}.00`,
        photos: [SYNTHETIC_PHOTO],
      })),
    },
    { orderId: '880002', now: '2026-10-22T12:00:00.000Z' }
  )
  const preparation = prepared(record)
  const batches = createLegacyCartonBatches([record], [preparation], {
    physicalEvidenceOnly: true,
  })
  assert.equal(
    batches.reduce((count, batch) => count + batch.count, 0),
    15
  )
  assert.equal(
    record.snapshot.items.reduce((q, item) => q + BigInt(item.quantity), 0n),
    1350n
  )
  const original = structuredClone(record.snapshot)
  const manifest = loadedProjection({
    records: [record],
    preparations: [preparation],
    batches,
    reports: [],
    containers: [],
  })
  assert.equal(manifest.totals.quantity, '1350')
  assert.equal(manifest.totals.cartons, 15)
  assert.equal(manifest.totals.sourceAmount, '1350.00')
  assert.equal(manifest.leftBehind.totals.quantity, '0')
  const { summary } = await workbookAndSummary(manifest)
  assert.equal(summary.totals.cartons, 15)
  assert.equal(
    summary.products.reduce((q, row) => q + BigInt(row.quantity), 0n),
    1350n
  )
  assert.deepEqual(record.snapshot, original)
})

test('AC6/18 one reviewed exact report keeps six identities and57.22kg/0.461256m3 through reconciliation, loading and workbook', async () => {
  const record = syntheticOrder('880003', '63'),
    preparation = prepared(record)
  const context = {
    accountId: 'local',
    orderId: '880003',
    storeId: '["1688","synthetic-factory"]',
    sourceRevision: 1,
    preparationRevision: 1,
    products: [
      {
        entryId: '2001',
        groupId: preparation.groups[0].id,
        purchased: '63',
        ceCodes: [preparation.groups[0].baseCode],
        supplierCodes: ['SYNTHETIC-OLD-01'],
      },
    ],
  }
  const rows = [
    ['001', '13', '60×50×40', '16.75'],
    ['002', '12', '60×50×40', '14.62'],
    ['003', '11', '50×43×36', '10.40'],
    ['004', '9', '48×37×27', '5.63'],
    ['005', '9', '48×37×27', '5.18'],
    ['006', '9', '48×37×27', '4.64'],
  ]
  const text = [
    '箱号\t货号\t装箱数 每箱\t体积 每箱\t重量 (KG) 每箱',
    ...rows.map(([id, q, dimensions, kg]) =>
      [id, 'SYNTHETIC-OLD-01', q, dimensions, kg].join('\t')
    ),
  ].join('\n')
  const { source } = parsePackingReportCells({
    text,
    sourceId: 'synthetic-report',
    rawAssetRef: 'local-report:synthetic',
    rawDigest: 'synthetic',
  })
  const initial = analyzePackingReport({ source, context })
  const decisions = Object.fromEntries(
    initial.decisionRequests
      .filter((request) => request.severity === 'decision')
      .map((request) => {
        assert.equal(request.code, 'measurementUnit')
        return [request.id, { scope: request.scope, value: 'cm' }]
      })
  )
  const analysis = analyzePackingReport({ source, context, decisions })
  const review = validatePackingReportReview({ analysis, decisions, context })
  assert.equal(review.valid, true, JSON.stringify(review.issues))
  const plan = planPackingReportUpdate({
    interpretedReport: review.interpretedReport,
    newIdentityPool: rows.map(([id]) => `synthetic-physical-${id}`),
  })
  assert.equal(plan.status, 'ready', JSON.stringify(plan.issues))
  const batches = plan.commitPayload.cartonBatches.map((batch) =>
    validateCartonBatch(batch)
  )
  const state = {
    records: [record],
    preparations: [preparation],
    batches,
    reports: [plan.commitPayload.report],
    containers: [],
  }
  const reconciliation = reconcileOrder({
    record,
    preparation,
    batches,
    reports: state.reports,
  })
  assert.equal(reconciliation.knownWeight, '57.22')
  assert.equal(reconciliation.knownVolume, '0.461256')
  assert.equal(reconciliation.unassignedPieces, '0')
  assert.deepEqual(
    batches.map((batch) => batch.contents[0].quantity),
    ['13', '12', '11', '9', '9', '9']
  )
  const manifest = loadedProjection(state)
  assert.equal(manifest.totals.quantity, '63')
  assert.equal(manifest.totals.weight, '57.22')
  assert.equal(manifest.totals.volume, '0.461256')
  const { summary } = await workbookAndSummary(manifest)
  assert.equal(
    new Set(summary.cartons.map((carton) => carton.cartonId || carton.id)).size,
    6
  )
  assert.deepEqual(
    summary.cartons.map((carton) => carton.contents[0].quantity),
    ['13', '12', '11', '9', '9', '9']
  )
  assert.equal(summary.totals.sourceAmount, '630.00')
})
