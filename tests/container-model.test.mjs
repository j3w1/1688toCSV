import test from 'node:test'
import assert from 'node:assert/strict'
import {
  syntheticOrder,
  syntheticBatch,
  syntheticManifest,
} from './fixtures/container-fixture.mjs'
import {
  captureContainerOrder,
  projectContainer,
  cartonMeasurementTotals,
  assertManifestEvidence,
} from '../src/container-model.js'
import { physicalUnits } from '../src/inventory-model.js'
import { paymentSourceEvidence } from '../src/payment-links.js'
import {
  createContainerSummary,
  createContainerWorkbook,
} from '../src/container-export.js'
import { suggestMaterial } from '../src/material-vocabulary.js'
const base = () => ({
  records: [syntheticOrder()],
  preparations: [],
  batches: [syntheticBatch()],
  reports: [],
  containers: [],
})
function draft(state) {
  const container = {
    id: 'C',
    accountId: 'local',
    name: 'October',
    status: 'draft',
    revision: 1,
    revisions: [],
    draft: { orders: [], decisions: {} },
  }
  container.draft.orders = [
    captureContainerOrder(state, { orderId: '1001' }, container.id),
  ]
  return container
}

test('large source entry ids retain purchase order and photo-edit identity through UUID-sorted physical batches and workbook raster callbacks', async () => {
  const state = base(),
    record = state.records[0],
    original = record.snapshot.items[0]
  record.snapshot.items = [0, 1, 2].map((index) => ({
    ...original,
    entryId: String(900000000000000000n + BigInt(index)),
    title: `Synthetic source ${index}`,
    description: `Synthetic source ${index}`,
    quantity: '1',
    ...(index === 0
      ? {
          photoEdits: {
            0: {
              tagScale: 2.75,
              tags: [
                {
                  id: 'AX-tag',
                  code: 'AX',
                  x: 0.5,
                  y: 0.5,
                  labelX: 0.8,
                  labelY: 0.15,
                },
              ],
            },
          },
        }
      : {}),
  }))
  Object.assign(record.snapshot.totals, {
    goodsGross: '30.00',
    goodsNet: '30.00',
    payable: '30.00',
  })
  state.batches = [2, 0, 1].map((sourceIndex, batchIndex) =>
    syntheticBatch('1001', 1, '1', {
      id: `synthetic-uuid-order-${batchIndex}`,
      contents: [
        {
          orderId: '1001',
          entryId: record.snapshot.items[sourceIndex].entryId,
          quantity: '1',
        },
      ],
      packingBasis: 'exact',
    })
  )
  const container = draft(state)
  container.draft.decisions = Object.fromEntries(
    container.draft.orders[0].cartons.map((unit) => [unit.id, 'loaded'])
  )
  const view = projectContainer(state, container),
    expected = record.snapshot.items.map((item) => item.entryId)
  assert.deepEqual(
    view.products.map((row) => row.entryId),
    expected
  )
  const observed = []
  await createContainerWorkbook(
    {
      ...view,
      cartons: view.cartons.filter((unit) => unit.state === 'loaded'),
    },
    {
      prepareImages: async (row, limits) => {
        if (limits.photo)
          observed.push({ entryId: row.entryId, edits: row.photoEdits })
        return {}
      },
    }
  )
  assert.deepEqual(
    observed.map((row) => row.entryId),
    expected
  )
  assert.equal(observed[0].edits[0].tags[0].code, 'AX')
})

test('captured material suggestions use the library vocabulary without writes, manual-clear replacement or global rule drift', () => {
  const state = base(),
    preparation = syntheticManifest().orders[0].preparation
  state.preparations = [preparation]
  state.records[0].snapshot.items[0].title = '玻璃杯'
  const raw = structuredClone(state.preparations)
  const container = draft(state)
  container.draft.decisions = Object.fromEntries(
    container.draft.orders[0].cartons.map((unit) => [unit.id, 'loaded'])
  )
  let row = projectContainer(state, container).products[0]
  assert.equal(row.material, '玻璃')
  assert.equal(row.materialSource, 'suggested')
  assert.deepEqual(state.preparations, raw)
  const custom = base()
  custom.preparations = [structuredClone(preparation)]
  custom.records[0].snapshot.items[0].skuProperties = [
    { label: '材质', value: 'Owner synthetic material' },
  ]
  custom.preferences = {
    materialVocabulary: [
      {
        id: 'synthetic',
        aliases: ['Owner synthetic material'],
        zh: '合成测试材质',
        en: 'Synthetic material',
        es: 'Material sintético',
        parent: '',
      },
    ],
  }
  const captured = captureContainerOrder(custom, { orderId: '1001' }, 'custom')
  assert.equal(
    captured.preparation.groups[0].variants[0].material,
    '合成测试材质'
  )
  assert.equal(suggestMaterial(custom.records[0].snapshot.items[0]), '')
  assert.equal(suggestMaterial({ title: '玻璃杯' }), '玻璃')
  state.preferences = custom.preferences
  state.records[0].snapshot.items[0].title = 'Metal cup'
  row = projectContainer(state, container).products[0]
  assert.equal(row.material, '玻璃')
  state.preparations[0].groups[0].variants[0].material = ''
  state.preparations[0].groups[0].variants[0].materialSource = 'manual'
  const cleared = captureContainerOrder(state, { orderId: '1001' }, 'clear')
  assert.equal(cleared.preparation.groups[0].variants[0].material, '')
  assert.equal(
    cleared.preparation.groups[0].variants[0].materialSource,
    'manual'
  )
})

test('frozen loaded and remaining rows retain original photo edits and readable feature/payment reasons without recalculating values', () => {
  const state = base(),
    record = state.records[0],
    fee = syntheticOrder('1002', '1'),
    edits = {
      0: {
        tagScale: 2.75,
        tags: [
          {
            id: 'tag-1',
            code: 'AX',
            x: 0.5,
            y: 0.5,
            labelX: 0.8,
            labelY: 0.15,
          },
        ],
      },
    }
  record.snapshot.items[0].photoEdits = structuredClone(edits)
  record.tags = ['Shared']
  record.productTags = { 2001: ['Fragile'] }
  record.snapshot.items[0].productNumber = 'SYNTHETIC-01'
  state.preparations = [syntheticManifest().orders[0].preparation]
  record.productWorkflow = {
    2001: { features: { lighting: true, rotation: true } },
  }
  record.paymentLinks = [
    {
      id: 'synthetic-lighting',
      sourceOrderId: '1002',
      amount: '10.00',
      reason: 'Lighting and rotation service',
      targetEntryIds: ['2001'],
      reviewedAt: record.snapshot.observedAt,
      sourceEvidence: paymentSourceEvidence(fee),
    },
  ]
  state.records.push(fee)
  const container = draft(state)
  container.draft.decisions = Object.fromEntries(
    physicalUnits(state.batches[0]).map((unit, index) => [
      unit.id,
      index < 5 ? 'loaded' : 'left-behind',
    ])
  )
  const manifest = projectContainer(state, container),
    row = manifest.products[0],
    left = manifest.leftBehind.products[0]
  assert.deepEqual(row.photoEdits, edits)
  assert.deepEqual(left.photoEdits, edits)
  assert.notStrictEqual(row.photoEdits, record.snapshot.items[0].photoEdits)
  assert.equal(row.productFeatures, 'Lighting · Rotation')
  assert.equal(row.chineseCategory, '杯')
  assert.equal(row.productNumber, 'SYNTHETIC-01')
  assert.equal(row.orderDate, record.snapshot.purchasedAt)
  assert.equal(row.orderStatus, record.snapshot.status)
  assert.deepEqual(row.orderTags, ['Shared'])
  assert.deepEqual(row.productTags, ['Fragile'])
  assert.equal(row.linkedPaymentReasons, 'Lighting and rotation service')
  assert.equal(row.sourceAmount, '500.00')
  assert.equal(row.linkedPaymentCharge, '5.00')
  assert.equal(row.effectiveAmount, '505.00')
  const summary = createContainerSummary(
    {
      ...manifest,
      cartons: manifest.cartons.filter((unit) => unit.state === 'loaded'),
    },
    { file: 'DRAFT-frozen.xlsx' }
  )
  assert.equal(summary.products[0].productFeatures, 'Lighting · Rotation')
  assert.equal(
    summary.products[0].linkedPaymentReasons,
    'Lighting and rotation service'
  )
  record.snapshot.items[0].photoEdits[0].tags[0].code = 'CHANGED'
  record.productWorkflow[2001].features = { lighting: false }
  record.paymentLinks[0].reason = 'CHANGED'
  record.tags.push('CHANGED')
  record.productTags[2001].push('CHANGED')
  const retained = projectContainer(state, container).products[0]
  assert.deepEqual(retained.photoEdits, edits)
  assert.equal(retained.productFeatures, row.productFeatures)
  assert.equal(retained.linkedPaymentReasons, row.linkedPaymentReasons)
  assert.equal(retained.effectiveAmount, row.effectiveAmount)
  assert.deepEqual(retained.orderTags, ['Shared'])
  assert.deepEqual(retained.productTags, ['Fragile'])
})

test('inclusion captures whole remainder without loading; logical mark all and exceptions derive products', () => {
  const state = base(),
    container = draft(state)
  let view = projectContainer(state, container)
  assert.equal(view.cartons.length, 10)
  assert.equal(view.products.length, 0)
  assert.equal(view.readiness.ready, false)
  container.draft.decisions = Object.fromEntries(
    view.cartons.map((unit, index) => [
      unit.id,
      index === 9 ? 'left-behind' : 'loaded',
    ])
  )
  view = projectContainer(state, container)
  assert.equal(view.products[0].quantity, '90')
  assert.equal(view.leftBehind.products[0].quantity, '10')
  assert.equal(view.totals.cartons, 9)
  assert.equal(view.readiness.ready, true)
  assert.equal(view.totals.weight, null)
  state.batches.push(syntheticBatch('1001', 1, '1', { id: 'new' }))
  assert.equal(projectContainer(state, container).cartons.length, 10)
})
test('aggregate measurements are known only for full supported scope; no averaging or chosen arbitrary box', () => {
  const batch = syntheticBatch('1001', 6, '63', {
    packingBasis: 'aggregate',
    weightBasis: 'batch',
    weight: '57.22',
    volumeBasis: 'batch',
    suppliedCbm: '0.461256',
  })
  const units = physicalUnits(batch)
  assert.equal(cartonMeasurementTotals(units, [batch]).weight, '57.22')
  assert.equal(cartonMeasurementTotals(units.slice(0, 5), [batch]).weight, null)
  const state = { ...base(), batches: [batch] },
    container = draft(state)
  container.draft.decisions = Object.fromEntries(
    units.map((unit, index) => [unit.id, index < 5 ? 'loaded' : 'left-behind'])
  )
  let view = projectContainer(state, container)
  assert.equal(view.readiness.ready, false)
  assert(view.issues.some((issue) => issue.code === 'LOADED_CONTENTS_UNKNOWN'))
  container.draft.decisions[units[5].id] = 'loaded'
  view = projectContainer(state, container)
  assert.equal(view.readiness.ready, true)
  assert.equal(view.products[0].quantity, '63')
  assert.equal(view.totals.weight, '57.22')
})
test('unknown variants need explicit full-set coverage; numeric equality with purchase is insufficient', () => {
  const state = base()
  state.batches = [
    syntheticBatch('1001', 6, '100', {
      packingBasis: 'aggregate',
      contents: [],
      contentsUnknown: true,
      unresolvedContents: [{ entryIds: ['2001'], quantity: null }],
    }),
  ]
  const container = draft(state)
  container.draft.decisions = Object.fromEntries(
    container.draft.orders[0].cartons.map((unit) => [unit.id, 'loaded'])
  )
  assert.equal(projectContainer(state, container).readiness.ready, false)
  state.reports = [
    {
      coverage: {
        completeSetCoverage: {
          batchIds: [state.batches[0].id],
          provenance: 'owner-confirmed',
          contents: [{ entryId: '2001', quantity: '100' }],
        },
      },
    },
  ]
  const full = projectContainer(state, container)
  assert.equal(full.readiness.ready, true)
  assert.equal(full.products[0].quantity, '100')
  assert(full.cartons.every((unit) => unit.contents === null))
  container.draft.decisions[container.draft.orders[0].cartons[0].id] =
    'left-behind'
  assert.equal(projectContainer(state, container).readiness.ready, false)
})
test('stable per-unit contents and measured exceptions identify actual boxes and stale facts block seal', () => {
  const state = base()
  state.batches = [
    syntheticBatch('1001', 3, '30', {
      packingBasis: 'aggregate',
      entitlementIndices: [1, 4, 8],
      unitContents: {
        4: [{ orderId: '1001', entryId: '2001', quantity: '12' }],
      },
      unitMeasurements: { 4: { weight: '7.25' } },
    }),
  ]
  const container = draft(state),
    units = container.draft.orders[0].cartons
  container.draft.decisions = Object.fromEntries(
    units.map((unit) => [unit.id, unit.index === 4 ? 'loaded' : 'left-behind'])
  )
  let view = projectContainer(state, container)
  assert.equal(view.readiness.ready, true)
  assert.equal(view.products[0].quantity, '12')
  assert.equal(view.totals.weight, '7.25')
  assert(view.cartons.every((unit) => !unit.interchangeable))
  state.batches[0].revision++
  view = projectContainer(state, container)
  assert(view.issues.some((issue) => issue.code === 'CARTON_STALE'))
})

test('captured product rows retain canonical variant names, explicit blanks, material overrides and size state', () => {
  const state = base(),
    preparation = syntheticManifest().orders[0].preparation
  const variant = preparation.groups[0].variants[0]
  preparation.groups[0].spanishName = 'GRUPO'
  preparation.groups[0].material = 'OBSOLETE GROUP MATERIAL'
  Object.assign(variant, {
    spanishName: '',
    material: 'VIDRIO',
    materialSource: 'manual',
    materialOverrides: { 2001: { value: 'ACERO', source: 'manual' } },
    variantSuffix: 'A',
    sizeSuffix: '02',
    needsSizeMapping: false,
    size: 'XL',
    variant: 'Red / XL',
  })
  state.preparations = [preparation]
  state.batches[0].groups = [
    { orderId: '1001', groupId: preparation.groups[0].id },
  ]
  const container = draft(state)
  container.draft.decisions = Object.fromEntries(
    container.draft.orders[0].cartons.map((unit) => [unit.id, 'loaded'])
  )
  const row = projectContainer(state, container).products[0]
  assert.equal(row.spanishName, '')
  assert.equal(row.material, 'ACERO')
  assert.equal(row.materialSource, 'manual')
  assert.equal(row.variantSuffix, 'A')
  assert.equal(row.sizeSuffix, '02')
  assert.equal(row.needsSizeMapping, false)
  assert.equal(row.sourceSize, 'XL')
  assert.equal(row.variantDescription, 'Red / XL')
  assert.equal(row.cartonMarkCode, preparation.groups[0].baseCode)
  variant.spanishName = 'LATER LIVE NAME'
  variant.materialOverrides['2001'].value = 'LATER LIVE MATERIAL'
  assert.equal(projectContainer(state, container).products[0].spanishName, '')
  assert.equal(projectContainer(state, container).products[0].material, 'ACERO')
})

test('actual full and per-unit product proof outranks stale complete-set claims and conflicting or overlapping coverage blocks seal', () => {
  const state = base()
  state.batches = [syntheticBatch('1001', 3, '30')]
  state.reports = [
    {
      coverage: {
        completeSetCoverage: {
          batchIds: ['batch-1001'],
          provenance: 'owner-confirmed',
          contents: [{ entryId: '2001', quantity: '100' }],
        },
      },
    },
  ]
  let container = draft(state)
  container.draft.decisions = Object.fromEntries(
    container.draft.orders[0].cartons.map((unit) => [unit.id, 'loaded'])
  )
  let view = projectContainer(state, container)
  assert.equal(view.products[0].quantity, '30')
  assert.equal(view.readiness.ready, true)
  state.batches = [
    syntheticBatch('1001', 3, '30', {
      packingBasis: 'aggregate',
      contents: [],
      contentsUnknown: true,
      unresolvedContents: [{ entryIds: ['2001'], quantity: null }],
      unitContents: {
        0: [{ orderId: '1001', entryId: '2001', quantity: '12' }],
      },
    }),
  ]
  state.reports[0].coverage.completeSetCoverage.contents[0].quantity = '5'
  container = draft(state)
  container.draft.decisions = Object.fromEntries(
    container.draft.orders[0].cartons.map((unit) => [unit.id, 'loaded'])
  )
  view = projectContainer(state, container)
  assert.equal(view.readiness.ready, false)
  assert(
    view.issues.some((issue) => issue.code === 'COMPLETE_SET_COVERAGE_CONFLICT')
  )
  state.reports[0].coverage.completeSetCoverage.contents[0].quantity = '30'
  state.reports.push(structuredClone(state.reports[0]))
  view = projectContainer(state, container)
  assert.equal(view.readiness.ready, false)
  assert(
    view.issues.some((issue) => issue.code === 'COMPLETE_SET_COVERAGE_CONFLICT')
  )
})

test('full multi-batch coverage allocates exact set measurements without inventing per-box product composition', () => {
  const state = base(),
    record = state.records[0]
  record.snapshot.items.push({ ...record.snapshot.items[0], entryId: '2002' })
  Object.assign(record.snapshot.totals, {
    goodsGross: '2000.00',
    goodsNet: '2000.00',
    payable: '2000.00',
  })
  state.batches = [
    syntheticBatch('1001', 2, '0', {
      id: 'set-a',
      packingBasis: 'aggregate',
      contents: [],
      contentsUnknown: true,
      unresolvedContents: [{ entryIds: ['2001', '2002'], quantity: null }],
      weight: '7.25',
      weightBasis: 'batch',
      suppliedCbm: '0.1',
      volumeBasis: 'batch',
    }),
    syntheticBatch('1001', 2, '0', {
      id: 'set-b',
      packingBasis: 'aggregate',
      contents: [],
      contentsUnknown: true,
      unresolvedContents: [{ entryIds: ['2001', '2002'], quantity: null }],
      weight: '2.75',
      weightBasis: 'batch',
      suppliedCbm: '0.2',
      volumeBasis: 'batch',
    }),
  ]
  state.reports = [
    {
      coverage: {
        completeSetCoverage: {
          batchIds: ['set-a', 'set-b'],
          provenance: 'owner-confirmed',
          contents: [
            { entryId: '2001', quantity: '30' },
            { entryId: '2002', quantity: '70' },
          ],
        },
      },
    },
  ]
  const container = draft(state)
  container.draft.decisions = Object.fromEntries(
    container.draft.orders[0].cartons.map((unit) => [unit.id, 'loaded'])
  )
  const view = projectContainer(state, container)
  assert.equal(view.readiness.ready, true)
  assert.equal(view.totals.weight, '10')
  assert.equal(view.totals.volume, '0.3')
  assert.deepEqual(
    view.products.map((row) => [
      row.quantity,
      row.allocatedWeight,
      row.allocatedVolume,
      row.measurementAllocationBasis,
    ]),
    [
      ['30', '3', '0.09', 'allocated'],
      ['70', '7', '0.21', 'allocated'],
    ]
  )
  assert(view.cartons.every((unit) => unit.contents === null))
  assert(view.products.every((row) => row.additiveCartonCount === null))
})

test('reported padded references and actual independent mark owners follow stable entitlement indices into output', () => {
  const state = base(),
    preparation = syntheticManifest().orders[0].preparation
  const mark = structuredClone(preparation.groups[0])
  mark.id = 'other-mark'
  mark.baseCode = 'CE26090102'
  mark.variants[0].id = 'mark-variant'
  mark.variants[0].entryIds = []
  preparation.groups.push(mark)
  state.preparations = [preparation]
  state.batches = [
    syntheticBatch('1001', 2, '20', {
      groups: [
        { orderId: '1001', groupId: preparation.groups[0].id },
        { orderId: '1001', groupId: mark.id },
      ],
      mark: { orderId: '1001', groupId: mark.id },
      entitlementIndices: [1, 4],
      unitLabels: { 1: '001', 4: '005' },
    }),
  ]
  const container = draft(state)
  container.draft.decisions = Object.fromEntries(
    container.draft.orders[0].cartons.map((unit) => [unit.id, 'loaded'])
  )
  const view = projectContainer(state, container)
  assert.deepEqual(
    view.cartons.map((unit) => [
      unit.index,
      unit.reference,
      unit.markCode,
      unit.labelOrigin,
    ]),
    [
      [1, '001', 'CE26090102', 'reported'],
      [4, '005', 'CE26090102', 'reported'],
    ]
  )
  assert.equal(view.products[0].cartonReferenceText, '001, 005')
  assert.equal(view.products[0].cartonMarkCode, 'CE26090102')
  assert.equal(view.products[0].baseCode, 'CE26090101')
})

test('historical remaining projection separates exact unprepared pieces from known left boxes and never reports their missing measures as zero', () => {
  const state = base()
  state.batches = [
    syntheticBatch('1001', 3, '30', { weight: '1', suppliedCbm: '0.1' }),
  ]
  const container = draft(state)
  container.draft.decisions = Object.fromEntries(
    container.draft.orders[0].cartons.map((unit, index) => [
      unit.id,
      index === 0 ? 'loaded' : 'left-behind',
    ])
  )
  const view = projectContainer(state, container)
  assert.equal(view.products[0].quantity, '10')
  assert.equal(view.leftBehind.products[0].quantity, '90')
  assert.equal(view.leftBehind.products[0].remainingQuantity, '90')
  assert.equal(view.leftBehind.unprepared[0].quantity, '70')
  assert.equal(view.leftBehind.totals.knownCartons, 2)
  assert.equal(view.leftBehind.totals.cartons, null)
  assert.equal(view.leftBehind.totals.weight, null)
  assert.equal(view.leftBehind.totals.volume, null)
  assert.equal(view.leftBehind.totals.weightCoverage.knownSubtotal, '2')
  assert.equal(view.leftBehind.totals.weightCoverage.complete, false)
  assert.equal(view.leftBehind.totals.weightCoverage.unpreparedQuantity, '70')
  state.records.push(syntheticOrder('1002'))
  assert.equal(projectContainer(state, container).leftBehind.products.length, 1)
})

test('synthetic manifest fixture uses the authoritative frozen schema and proves physical/product/value/remaining correspondence', () => {
  const manifest = syntheticManifest()
  assert.doesNotThrow(() => assertManifestEvidence(manifest))
  assert.equal(manifest.products[0].quantity, '20')
  assert.equal(manifest.products[0].effectiveAmount, '200.00')
  assert.equal(manifest.products[0].sourcePrice, '10.00')
  assert.equal(manifest.products[0].valuation.sourceNet, '1000.00')
  assert.equal(
    manifest.products[0].valuation.budgets.sourceGrossAmount.source,
    '1000.00'
  )
  assert.equal(manifest.leftBehind.products[0].quantity, '80')
  assert.equal(manifest.leftBehind.totals.weight, '10')
  assert.equal(manifest.totals.weight, '2.5')
  assert.equal(manifest.orders[0].sourceReports.length, 0)
})
