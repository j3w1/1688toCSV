import test from 'node:test'
import assert from 'node:assert/strict'
import {
  syntheticOrder,
  syntheticBatch,
} from './fixtures/container-fixture.mjs'
import {
  captureContainerOrder,
  projectContainer,
  cartonMeasurementTotals,
} from '../src/container-model.js'
import { physicalUnits } from '../src/inventory-model.js'
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
