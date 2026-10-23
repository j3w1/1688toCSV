import test from 'node:test'
import assert from 'node:assert/strict'
import {
  reconcileOrder,
  unresolvedCoverageFeasible,
  reconciliationMeasurementForCount,
  applyReconciliationCommand,
  createReconciliationDraft,
  createReconciliationHistory,
  commitReconciliationHistory,
  undoReconciliationHistory,
  redoReconciliationHistory,
} from '../src/carton-reconciliation.js'
import { addExact } from '../src/carton-arithmetic.js'
import { applyCartonUnitException } from '../src/carton-batches.js'

const input = (quantities, capacities = {}, rest = {}) => ({
  record: {
    snapshot: {
      accountId: 'local',
      orderId: 'O',
      items: Object.entries(quantities).map(([entryId, quantity]) => ({
        entryId,
        quantity,
      })),
    },
    unitsPerCarton: capacities,
  },
  ...rest,
})
const box = (id, contents, fields = {}) => ({
  id,
  accountId: 'local',
  orderId: 'O',
  count: 1,
  packingBasis: 'exact',
  contents: Object.entries(contents).map(([entryId, quantity]) => ({
    orderId: 'O',
    entryId,
    quantity,
  })),
  ...fields,
})
const row = (plan, id) => plan.products.find((x) => x.entryId === id)
const conservation = (plan) =>
  assert.equal(
    addExact(
      plan.coverage.confirmed,
      plan.coverage.proposed,
      plan.coverage.unresolved,
      plan.coverage.unassigned
    ),
    plan.coverage.purchased
  )

test('a stable physical exception retains untouched measured coverage without inventing an affected weight', () => {
  const batch = box(
    'uniform',
    { A: '30' },
    {
      storeId: 'synthetic-store',
      revision: 1,
      count: 3,
      packingBasis: 'uniform',
      weight: '2.5',
      weightBasis: 'carton',
      len: '50',
      wid: '40',
      ht: '30',
    }
  )
  const changed = applyCartonUnitException({
    batch,
    index: 1,
    contents: [{ orderId: 'O', entryId: 'A', quantity: '9' }],
  })
  const plan = reconcileOrder(input({ A: '30' }, {}, { batches: [changed] }))
  assert.equal(plan.knownWeight, '5')
  assert.equal(plan.weightCoverage.knownCount, 2)
  assert.equal(plan.weightCoverage.missingCount, 1)
  assert.equal(plan.knownVolume, '0.18')
  assert.equal(plan.volumeCoverage.knownCount, 3)
  assert.equal(plan.unassignedPieces, '1')
  assert.equal(plan.cartons[0].totalWeight, null)
  assert.equal(
    reconciliationMeasurementForCount(plan.cartons[0], 1).weight,
    null
  )
  const measured = applyCartonUnitException({
    batch: changed,
    index: 1,
    measurements: { weight: '2.4' },
  })
  const next = reconcileOrder(input({ A: '30' }, {}, { batches: [measured] }))
  assert.equal(next.knownWeight, '7.4')
  assert.equal(next.weightCoverage.knownCount, 3)
  assert.equal(next.weightCoverage.missingCount, 0)
  assert.equal(next.weightCoverage.complete, false) // One unassigned piece remains.
  assert.equal(
    reconciliationMeasurementForCount(next.cartons[0], 1).weight,
    null
  )
  assert.equal(
    reconciliationMeasurementForCount(next.cartons[0], 3).weight,
    '7.4'
  )
  assert.deepEqual(changed.sourceFacts.contents, batch.contents)
})

test('AC9 table: uniform proposals and exact prefilled remainder, missing capacity stays visible', () => {
  for (const [q, c, count, remainder] of [
    ['50', '10', 5, '0'],
    ['40', '30', 1, '10'],
    ['100', '45', 2, '10'],
    ['120', null, 0, '120'],
  ]) {
    const plan = reconcileOrder(input({ A: q }, { A: c }))
    assert.equal(plan.proposedCount, count)
    assert.equal(plan.unassignedPieces, remainder)
    assert.equal(row(plan, 'A').remainder, remainder)
    assert.equal(plan.confirmedCount, 0)
    assert.equal(plan.reportedCount, null)
    assert.equal(plan.countDifference, null)
    assert.equal(plan.knownWeight, null)
    conservation(plan)
  }
})

test('AC6 explicit six-carton uneven facts outrank capacity and conserve decimals', () => {
  const quantities = ['13', '12', '11', '9', '9', '9'],
    weights = ['16.75', '14.62', '10.40', '5.63', '5.18', '4.64']
  const dims = [
    ['60', '50', '40'],
    ['60', '50', '40'],
    ['50', '43', '36'],
    ...Array(3).fill(['48', '37', '27']),
  ]
  const batches = quantities.map((q, i) =>
    box(
      `physical-${i}`,
      { A: q },
      {
        cartonNumber: String(i + 1),
        weight: weights[i],
        len: dims[i][0],
        wid: dims[i][1],
        ht: dims[i][2],
      }
    )
  )
  const original = structuredClone(batches)
  const plan = reconcileOrder(
    input(
      { A: '63' },
      { A: '10' },
      { batches, reports: [{ reportedCount: 6 }] }
    )
  )
  assert.equal(plan.confirmedCount, 6)
  assert.equal(plan.proposedCount, 0)
  assert.equal(plan.unassignedPieces, '0')
  assert.equal(plan.knownWeight, '57.22')
  assert.equal(plan.knownVolume, '0.461256')
  assert.equal(plan.weightCoverage.missingCount, 0)
  assert.equal(plan.countDifference, 0)
  assert.deepEqual(
    row(plan, 'A').pattern.map((x) => x.quantity),
    quantities
  )
  assert.ok(row(plan, 'A').states.includes('uneven'))
  assert.deepEqual(batches, original)
  const edited = reconcileOrder(
    input(
      { A: '63' },
      { A: '99' },
      { batches, reports: [{ reportedCount: 6 }] }
    )
  )
  assert.deepEqual(edited.confirmed, plan.confirmed)
  assert.deepEqual(
    edited.cartons.map((x) => x.id),
    plan.cartons.map((x) => x.id)
  )
  conservation(plan)
})

test('unknown variant coverage reserves candidates without invented allocation or duplicate proposals', () => {
  const batches = [
    box(
      'unknown',
      {},
      {
        count: 6,
        packingBasis: 'aggregate',
        unresolvedContents: [
          { groupId: 'G', entryIds: ['S', 'M', 'L'], quantity: '63' },
        ],
        weight: '57.22',
        weightBasis: 'batch',
        suppliedCbm: '0.461256',
        volumeBasis: 'batch',
      }
    ),
  ]
  const plan = reconcileOrder(
    input(
      { S: '3', M: '30', L: '30' },
      { S: '1', M: '10', L: '10' },
      { batches }
    )
  )
  assert.equal(plan.coverage.feasible, true)
  assert.equal(plan.unresolvedPieces, '63')
  assert.equal(plan.unassignedPieces, '0')
  assert.equal(plan.proposedCount, 0)
  assert.ok(
    plan.products.every(
      (x) => x.availableForPacking === null && x.unassignedPieces === null
    )
  )
  assert.deepEqual(plan.cartons[0].contents, [])
  assert.deepEqual(reconciliationMeasurementForCount(plan.cartons[0], 3), {
    weight: null,
    volume: null,
  })
  assert.deepEqual(reconciliationMeasurementForCount(plan.cartons[0], 6), {
    weight: '57.22',
    volume: '0.461256',
  })
  conservation(plan)
})

test('ambiguous partial coverage retains exact order pool while unrelated products can propose', () => {
  const plan = reconcileOrder(
    input(
      { A: '10', B: '10', C: '12' },
      { A: '5', B: '5', C: '5' },
      {
        batches: [
          box(
            'u',
            {},
            { unresolvedContents: [{ entryIds: ['A', 'B'], quantity: '7' }] }
          ),
        ],
      }
    )
  )
  assert.equal(plan.unassignedPieces, '15') // A+B free 13, plus C remainder 2
  assert.equal(plan.proposedCount, 2)
  assert.equal(row(plan, 'A').unassignedPieces, null)
  assert.equal(row(plan, 'B').unresolvedPieces, null)
  assert.equal(row(plan, 'C').proposedPieces, '10')
  conservation(plan)
})

test('feasibility checks overlapping claims, not just their global sum', () => {
  assert.equal(
    unresolvedCoverageFeasible({ A: '5', B: '5', C: '20' }, [
      { entryIds: ['A', 'B'], quantity: '6' },
      { entryIds: ['A', 'B'], quantity: '5' },
    ]),
    false
  )
  assert.equal(
    unresolvedCoverageFeasible({ A: '5', B: '5' }, [
      { entryIds: ['A', 'B'], quantity: '6' },
      { entryIds: ['A'], quantity: '4' },
    ]),
    true
  )
  assert.equal(
    unresolvedCoverageFeasible({ A: '5' }, [
      { entryIds: ['A'], quantity: null },
    ]),
    null
  )
  const plan = reconcileOrder(
    input(
      { A: '5', B: '5', C: '20' },
      { A: '1', B: '1' },
      {
        batches: [
          box(
            'u',
            {},
            { unresolvedContents: [{ entryIds: ['A', 'B'], quantity: '11' }] }
          ),
        ],
      }
    )
  )
  assert.equal(plan.coverage.feasible, false)
  assert.ok(plan.issues.some((x) => x.code === 'coverage-infeasible'))
  assert.equal(plan.proposedCount, 0)
  conservation(plan)
})

test('AC11 contradictory counts, negative budget and source discrepancy are not clamped', () => {
  const plan = reconcileOrder(
    input(
      { A: '100' },
      { A: '10' },
      {
        batches: Array.from({ length: 8 }, (_, i) => box(`b${i}`, { A: '10' })),
        reports: [{ reportedCount: 7 }],
      }
    )
  )
  assert.equal(plan.confirmedCount, 8)
  assert.equal(plan.proposedCount, 2)
  assert.equal(plan.countDifference, -3)
  assert.equal(plan.coverage.purchased, '100')
  assert.ok(plan.issues.some((x) => x.code === 'negative-carton-budget'))
  const over = reconcileOrder(
    input(
      { A: '100' },
      { A: '10' },
      { batches: [box('too-many', { A: '110' })] }
    )
  )
  assert.equal(over.unassignedPieces, '-10')
  assert.equal(row(over, 'A').availableForPacking, '-10')
  assert.ok(
    over.issues.some(
      (x) =>
        x.code === 'product-overallocated' && x.cartonIds.includes('too-many')
    )
  )
  const gap = reconcileOrder(
    input({ A: '100' }, {}, { batches: [box('ninety', { A: '90' })] })
  )
  assert.equal(gap.unassignedPieces, '10')
  const unknown = reconcileOrder(
    input(
      { A: '100' },
      { A: 'bad' },
      {
        batches: [
          box(
            'count-unknown',
            { A: '90' },
            { count: null, packingBasis: 'aggregate' }
          ),
        ],
      }
    )
  )
  assert.equal(unknown.confirmedCount, null)
  assert.equal(unknown.unassignedPieces, '10')
  assert.equal(unknown.weightCoverage.missingCount, null)
  assert.ok(unknown.issues.some((x) => x.code === 'invalid-capacity'))
  conservation(plan)
  conservation(over)
  conservation(gap)
})

test('AC12 shared cartons count and weigh once, participation differs from additive attribution', () => {
  const plan = reconcileOrder(
    input(
      { A: '500', B: '100', C: '300', D: '90' },
      {},
      {
        batches: [
          box(
            'shared',
            { A: '500', B: '100', C: '300', D: '90' },
            { weight: '57.22', suppliedCbm: '0.461256' }
          ),
        ],
      }
    )
  )
  assert.equal(plan.confirmedCount, 1)
  assert.equal(plan.knownWeight, '57.22')
  assert.equal(
    addExact(...plan.products.map((x) => x.allocatedWeight)),
    '57.22'
  )
  assert.equal(
    addExact(...plan.products.map((x) => x.allocatedVolume)),
    '0.461256'
  )
  assert.equal(
    plan.products.reduce((s, x) => s + x.additiveCartonCount, 0),
    1
  )
  assert.ok(
    plan.products.every(
      (x) =>
        x.containingCartonCount === 1 && x.sharedReferences[0].id === 'shared'
    )
  )
  assert.ok(
    plan.products.every(
      (x) =>
        x.sharedReferences[0].totalPieces === '990' &&
        x.measurementAllocationBasis === 'allocated'
    )
  )
  conservation(plan)
})

test('measurement coverage retains missing/zero, supplied and dimension evidence separately', () => {
  const plan = reconcileOrder(
    input(
      { A: '3' },
      {},
      {
        batches: [
          box('zero', { A: '1' }, { weight: '0' }),
          box('missing', { A: '1' }),
          box(
            'disagree',
            { A: '1' },
            {
              weight: '1.25',
              len: '100',
              wid: '100',
              ht: '100',
              suppliedCbm: '2',
            }
          ),
        ],
      }
    )
  )
  assert.equal(plan.knownWeight, '1.25')
  assert.equal(plan.weightCoverage.knownCount, 2)
  assert.equal(plan.weightCoverage.missingCount, 1)
  assert.equal(plan.knownVolume, '1')
  assert.equal(plan.cartons[2].suppliedVolume, '2')
  assert.ok(plan.issues.some((x) => x.code === 'volume-discrepancy'))
})

test('confirmed dimensions supersede differing supplied CBM with disclosed totals while ambiguous bases and quantity conflicts remain errors', () => {
  const batch = box(
    'measured',
    { A: '40' },
    {
      count: 4,
      packingBasis: 'uniform',
      len: '80.125',
      wid: '50',
      ht: '30',
      weight: '25.25',
      suppliedCbm: '0.21',
      volumeBasis: 'batch',
    }
  )
  for (const [basis, suppliedTotal] of [
    ['batch', '0.21'],
    ['carton', '0.84'],
  ]) {
    const plan = reconcileOrder(
      input(
        { A: '40' },
        {},
        {
          batches: [{ ...batch, volumeBasis: basis }],
        }
      )
    )
    assert.equal(plan.knownVolume, '0.48075')
    assert.equal(plan.knownWeight, '101')
    assert.equal(
      plan.issues.some((value) => value.severity === 'error'),
      false
    )
    const warning = plan.issues.find(
      (value) => value.code === 'volume-discrepancy'
    )
    assert.deepEqual(
      {
        severity: warning.severity,
        measured: warning.dimensionVolume,
        supplied: warning.suppliedVolume,
        used: warning.usedVolume,
        usedBasis: warning.usedVolumeBasis,
        raw: warning.suppliedCbm,
        rawBasis: warning.suppliedVolumeBasis,
      },
      {
        severity: 'warning',
        measured: '0.48075',
        supplied: suppliedTotal,
        used: '0.48075',
        usedBasis: 'measured',
        raw: '0.21',
        rawBasis: basis,
      }
    )
    assert.equal(plan.cartons[0].suppliedCbm, '0.21')
    conservation(plan)
  }
  for (const [changes, code] of [
    [{ volumeBasis: 'unknown' }, 'invalid-measurement-basis'],
    [{ count: 3 }, 'uniform-contents-conflict'],
    [{ orderId: 'another-order' }, 'cross-order-carton'],
  ]) {
    const plan = reconcileOrder(
      input({ A: '40' }, {}, { batches: [{ ...batch, ...changes }] })
    )
    assert.ok(
      plan.issues.some((value) => value.severity === 'error'),
      code
    )
  }
})

test('AC10 report-constrained mixed suggestions remain unallocated, ambiguous choices explicit', () => {
  const plan = reconcileOrder(
    input(
      { X: '500', Y: '100', A: '320', B: '72' },
      { X: '600', Y: '600', A: '300', B: '100' },
      {
        reports: [
          {
            id: 'report',
            mixedConstraints: [
              {
                id: '600',
                totalPieces: '600',
                entryIds: ['X', 'Y'],
                evidence: { row: 1 },
              },
              {
                id: '92',
                totalPieces: '92',
                entryIds: ['A', 'B'],
                evidence: { row: 2 },
              },
            ],
          },
        ],
      }
    )
  )
  assert.equal(plan.proposedCount, 1)
  assert.equal(plan.unassignedPieces, '692')
  assert.equal(plan.suggestions.length, 2)
  assert.deepEqual(
    plan.suggestions[0].choices[0].map((x) => [x.entryId, x.quantity]),
    [
      ['X', '500'],
      ['Y', '100'],
    ]
  )
  assert.ok(
    plan.suggestions.every(
      (x) => x.requiresConfirmation && x.physicalFit === 'unknown'
    )
  )
  const ambiguous = reconcileOrder(
    input(
      { A: '10', B: '10', C: '10' },
      {},
      {
        reports: [
          {
            id: 'r',
            mixedConstraints: [
              {
                id: 'm',
                totalPieces: '20',
                entryIds: ['C', 'B', 'A'],
                evidence: 'reported',
              },
            ],
          },
        ],
      }
    )
  )
  assert.equal(ambiguous.suggestions[0].choices.length, 3)
  assert.equal(ambiguous.suggestions[0].ambiguous, true)
  const reversed = reconcileOrder(
    input(
      { C: '10', B: '10', A: '10' },
      {},
      {
        reports: [
          {
            id: 'r',
            mixedConstraints: [
              {
                id: 'm',
                totalPieces: '20',
                entryIds: ['A', 'B', 'C'],
                evidence: 'reported',
              },
            ],
          },
        ],
      }
    )
  )
  assert.deepEqual(reversed.suggestions, ambiguous.suggestions)
  assert.equal(
    reconcileOrder(input({ X: '500', Y: '100' })).suggestions.length,
    0
  )
  conservation(plan)
})

test('property: repeated quantities/capacities conserve without expanding grouped proposals', () => {
  for (let q = 0; q < 80; q++)
    for (let c = 1; c <= 15; c++) {
      const plan = reconcileOrder(
        input(
          { A: String(q + 3), B: '7' },
          { A: String(c) },
          { batches: [box('fixed', { A: '3' })] }
        )
      )
      conservation(plan)
      assert.equal(row(plan, 'A').confirmedPieces, '3')
      assert.equal(row(plan, 'A').unassignedPieces, String(q % c))
      assert.ok(plan.proposals.length <= 1)
    }
  const huge = reconcileOrder(input({ A: '900719925474099300000' }, { A: '1' }))
  assert.equal(huge.proposedCount, 0)
  assert.equal(huge.unassignedPieces, '900719925474099300000')
  assert.ok(huge.issues.some((x) => x.code === 'invalid-count'))
})

test('AC9 separate/place/move/reject are atomic and derive the current remainder', () => {
  const context = input({ A: '100', B: '30' }, { A: '45', B: '30' })
  const initial = createReconciliationDraft(context)
  const separate = applyReconciliationCommand(
    initial,
    { type: 'separate', entryId: 'A' },
    context
  )
  assert.deepEqual(initial.cartons, [])
  assert.equal(separate.cartons[0].contents[0].quantity, '10')
  let plan = reconcileOrder({ ...context, draft: separate })
  assert.equal(plan.proposedCount, 4)
  assert.equal(plan.unassignedPieces, '0')
  const b = plan.proposals.find((x) =>
    x.contents.some((part) => part.entryId === 'B')
  )
  const moved = applyReconciliationCommand(
    separate,
    {
      type: 'move',
      entryId: 'A',
      fromId: separate.cartons[0].id,
      destinationId: b.id,
    },
    context
  )
  plan = reconcileOrder({ ...context, draft: moved })
  assert.equal(plan.proposedCount, 3)
  assert.equal(plan.unassignedPieces, '0')
  const shared = plan.cartons.find((x) => x.contents.length === 2)
  assert.equal(shared.contents.find((x) => x.entryId === 'A').quantity, '10')
  assert.equal(shared.contents.find((x) => x.entryId === 'B').quantity, '30')
  assert.equal(plan.products[0].sharedReferences[0].id, shared.id)
  conservation(plan)
  const rejected = applyReconciliationCommand(
    separate,
    { type: 'reject', id: separate.cartons[0].id },
    context
  )
  assert.equal(
    reconcileOrder({ ...context, draft: rejected }).unassignedPieces,
    '10'
  )
  const placed = applyReconciliationCommand(
    initial,
    {
      type: 'place',
      entryId: 'A',
      destinationId: reconcileOrder(context).proposals.find(
        (x) => x.contents[0].entryId === 'B'
      ).id,
    },
    context
  )
  assert.equal(
    reconcileOrder({ ...context, draft: placed }).unassignedPieces,
    '0'
  )
  assert.throws(() =>
    applyReconciliationCommand(
      initial,
      { type: 'place', entryId: 'A', destinationId: 'missing' },
      context
    )
  )
  assert.deepEqual(initial.cartons, [])
})

test('compound paste/fill/assignment is one JSON Undo/Redo step; failed commands retain full input', () => {
  const context = input({ A: '100', B: '40' }, { A: '45', B: '30' })
  let history = createReconciliationHistory(createReconciliationDraft(context))
  const baseline = structuredClone(history)
  history = commitReconciliationHistory(
    history,
    {
      type: 'compound',
      commands: [
        { type: 'set-capacities', values: { A: '45', B: '30' } },
        { type: 'separate', entryId: 'A' },
        { type: 'separate', entryId: 'B' },
      ],
    },
    context
  )
  assert.equal(history.past.length, 1)
  assert.equal(history.present.generation, 1)
  assert.equal(history.present.cartons.length, 2)
  assert.equal(
    reconcileOrder({ ...context, draft: history.present }).unassignedPieces,
    '0'
  )
  const undone = undoReconciliationHistory(JSON.parse(JSON.stringify(history)))
  assert.deepEqual(undone.present, baseline.present)
  assert.deepEqual(redoReconciliationHistory(undone), history)
  const bad = {
    type: 'compound',
    commands: [
      { type: 'set-capacities', values: { A: 'bad' } },
      { type: 'place', entryId: 'A', destinationId: 'absent' },
    ],
  }
  const snapshot = structuredClone(history)
  assert.throws(() => commitReconciliationHistory(history, bad, context))
  assert.deepEqual(history, snapshot)
  const invalid = commitReconciliationHistory(
    history,
    { type: 'set-capacities', values: { A: '45x' } },
    context
  )
  assert.equal(invalid.present.capacities.A, '45x')
  assert.ok(
    reconcileOrder({ ...context, draft: invalid.present }).issues.some(
      (x) => x.code === 'invalid-capacity'
    )
  )
  assert.throws(() =>
    applyReconciliationCommand(
      history.present,
      { type: 'separate', entryId: 'A', expectedGeneration: 0 },
      context
    )
  )
})

test('manual arrangement survives capacity edits; full proposal rejection restores its whole pool', () => {
  const context = input({ A: '100' }, { A: '45' })
  const separate = applyReconciliationCommand(
    {},
    { type: 'separate', entryId: 'A' },
    context
  )
  const fixed = structuredClone(separate.cartons)
  for (const capacity of ['30', '60', '20', null, 'bad', '45']) {
    const changed = applyReconciliationCommand(
      separate,
      { type: 'set-capacities', values: { A: capacity } },
      context
    )
    const plan = reconcileOrder({ ...context, draft: changed })
    assert.deepEqual(changed.cartons, fixed)
    assert.equal(
      plan.cartons.find((x) => x.id === fixed[0].id).contents[0].quantity,
      '10'
    )
    conservation(plan)
  }
  const full = reconcileOrder(context).proposals[0]
  const rejected = applyReconciliationCommand(
    {},
    { type: 'reject', id: full.id },
    context
  )
  const plan = reconcileOrder({ ...context, draft: rejected })
  assert.equal(plan.proposedCount, 0)
  assert.equal(plan.unassignedPieces, '100')
  conservation(plan)
})

test('AC10 accepting constrained mixes requires confirmation and leaves quantities conserved', () => {
  const context = input(
    { X: '500', Y: '100', A: '320', B: '72' },
    { X: '600', Y: '600', A: '300', B: '100' },
    {
      reports: [
        {
          id: 'r',
          mixedConstraints: [
            {
              id: '600',
              totalPieces: '600',
              entryIds: ['X', 'Y'],
              evidence: 'report row 1',
            },
            {
              id: '92',
              totalPieces: '92',
              entryIds: ['A', 'B'],
              evidence: 'report row 2',
            },
          ],
        },
      ],
    }
  )
  let draft = createReconciliationDraft(context),
    plan = reconcileOrder({ ...context, draft })
  assert.throws(() =>
    applyReconciliationCommand(
      draft,
      { type: 'accept-suggestion', id: plan.suggestions[0].id, choiceIndex: 0 },
      context
    )
  )
  for (let i = 0; i < 2; i++) {
    plan = reconcileOrder({ ...context, draft })
    draft = applyReconciliationCommand(
      draft,
      {
        type: 'accept-suggestion',
        id: plan.suggestions[0].id,
        choiceIndex: 0,
        confirmed: true,
      },
      context
    )
  }
  plan = reconcileOrder({ ...context, draft })
  assert.equal(plan.proposedCount, 3)
  assert.equal(plan.unassignedPieces, '0')
  assert.deepEqual(
    plan.cartons
      .map((x) => addExact(...x.contents.map((part) => part.quantity)))
      .sort(),
    ['300', '600', '92']
  )
  conservation(plan)
  const rejected = applyReconciliationCommand(
    draft,
    { type: 'reject', id: draft.cartons[0].id },
    context
  )
  assert.equal(
    reconcileOrder({ ...context, draft: rejected }).unassignedPieces,
    '600'
  )
})

test('explicit uniform destination index creates one manual box and retains full remainder batch', () => {
  const context = input({ A: '100', B: '100' }, { A: '45', B: '10' })
  const b = reconcileOrder(context).proposals.find(
    (x) => x.contents[0].entryId === 'B'
  )
  assert.throws(
    () =>
      applyReconciliationCommand(
        {},
        { type: 'place', entryId: 'A', destinationId: b.id },
        context
      ),
    /explicit carton index/
  )
  const draft = applyReconciliationCommand(
    {},
    { type: 'place', entryId: 'A', destinationId: b.id, destinationIndex: 3 },
    context
  )
  const plan = reconcileOrder({ ...context, draft })
  assert.equal(plan.proposedCount, 12)
  assert.equal(plan.unassignedPieces, '0')
  assert.equal(plan.cartons.filter((x) => x.contents.length === 2).length, 1)
  conservation(plan)
})

test('unknown candidate coverage cannot be spent by explicit remainder commands', () => {
  const context = input(
    { A: '100', B: '100' },
    { A: '45', B: '45' },
    {
      batches: [
        box(
          'unknown',
          {},
          { unresolvedContents: [{ entryIds: ['A', 'B'], quantity: '100' }] }
        ),
      ],
    }
  )
  for (const type of ['separate', 'place'])
    assert.throws(
      () =>
        applyReconciliationCommand(
          {},
          { type, entryId: 'A', destinationId: 'unknown' },
          context
        ),
      /known positive/
    )
  const draft = applyReconciliationCommand(
    {},
    { type: 'set-capacities', values: { A: '10', B: '10' } },
    context
  )
  assert.equal(reconcileOrder({ ...context, draft }).proposedCount, 0)
})

test('confirmed destination override retains identity and base facts, pending pieces never count twice', () => {
  const context = input(
    { A: '10', B: '100' },
    {},
    {
      batches: [
        box(
          'reported-final',
          { B: '90' },
          { revision: 3, weight: '5', cartonNumber: '001' }
        ),
      ],
      reports: [
        {
          id: 'r',
          mixedConstraints: [
            {
              id: 'final',
              destinationId: 'reported-final',
              entryIds: ['A'],
              totalPieces: '100',
              evidence: { row: 7 },
            },
          ],
        },
      ],
    }
  )
  const original = structuredClone(context)
  const before = reconcileOrder(context)
  assert.equal(before.unassignedPieces, '20')
  const draft = applyReconciliationCommand(
    {},
    {
      type: 'accept-suggestion',
      id: before.suggestions[0].id,
      choiceIndex: 0,
      confirmed: true,
    },
    context
  )
  const plan = reconcileOrder({ ...context, draft })
  assert.equal(plan.confirmedCount, 1)
  assert.equal(plan.proposedCount, 0)
  assert.equal(plan.cartons.length, 1)
  assert.equal(plan.cartons[0].id, 'reported-final')
  assert.equal(plan.cartons[0].state, 'modified')
  assert.equal(draft.cartons[0].baseRevision, 3)
  assert.equal(draft.cartons[0].requiresDomainReview, true)
  assert.equal(plan.unassignedPieces, '10')
  assert.equal(row(plan, 'B').unassignedPieces, '10')
  assert.deepEqual(plan.confirmed, original.batches)
  assert.deepEqual(context, original)
  conservation(plan)
  const stale = reconcileOrder({
    ...context,
    batches: [{ ...context.batches[0], revision: 4 }],
    draft,
  })
  assert.ok(
    stale.issues.some(
      (x) =>
        x.code === 'stale-carton-revision' && x.cartonId === 'reported-final'
    )
  )
})

test('moving all contents from confirmed carton stages explicit removal retaining measured history', () => {
  const context = input(
    { A: '10', B: '20' },
    {},
    {
      batches: [
        box('a', { A: '10' }, { revision: 2, weight: '2.5' }),
        box('b', { B: '20' }, { revision: 4, weight: '7' }),
      ],
    }
  )
  const draft = applyReconciliationCommand(
    {},
    { type: 'move', entryId: 'A', fromId: 'a', destinationId: 'b' },
    context
  )
  const plan = reconcileOrder({ ...context, draft })
  assert.equal(plan.confirmedCount, 1)
  assert.equal(plan.proposedCount, 0)
  assert.equal(plan.unassignedPieces, '0')
  assert.equal(plan.cartons.find((x) => x.id === 'a').removalRequested, true)
  assert.equal(draft.cartons.find((x) => x.id === 'a').weight, '2.5')
  assert.equal(
    plan.confirmed.find((x) => x.id === 'a').contents[0].quantity,
    '10'
  )
  assert.equal(plan.knownWeight, '7')
  assert.throws(
    () =>
      applyReconciliationCommand(draft, { type: 'reject', id: 'a' }, context),
    /overallocate|duplicate/
  )
  conservation(plan)
})

test('eligibility exclusions adjust only eligible budget; source and shipment projection remain intact', () => {
  const context = input(
    { A: '100', Fee: '10' },
    { A: '45', Fee: '1' },
    {
      projection: {
        eligibility: {
          A: {
            purchased: '100',
            eligible: '90',
            reason: 'documented cancellation',
          },
          Fee: { purchased: '10', eligible: '0', reason: 'payment-only' },
        },
        shipped: { A: '45' },
      },
    }
  )
  const plan = reconcileOrder(context)
  assert.equal(row(plan, 'A').purchased, '100')
  assert.equal(row(plan, 'A').eligible, '90')
  assert.equal(plan.coverage.purchased, '110')
  assert.equal(plan.coverage.eligible, '90')
  assert.equal(plan.proposedCount, 2)
  assert.equal(plan.unassignedPieces, '0')
  assert.deepEqual(plan.projection, context.projection)
  assert.equal(
    addExact(
      plan.coverage.confirmed,
      plan.coverage.proposed,
      plan.coverage.unresolved,
      plan.coverage.unassigned
    ),
    plan.coverage.eligible
  )
  const invalid = reconcileOrder({
    ...context,
    projection: {
      eligibility: { A: { eligible: '200', reason: 'cancellation' } },
    },
  })
  assert.equal(row(invalid, 'A').eligible, null)
  assert.ok(invalid.issues.some((x) => x.code === 'invalid-eligibility'))
})

test('review-held cross-order and conflicting duplicate facts do not create confident free proposals', () => {
  const foreign = box('foreign', { A: '10' }, { orderId: 'Other' })
  const cross = reconcileOrder(
    input({ A: '100' }, { A: '10' }, { batches: [foreign] })
  )
  assert.equal(cross.proposedCount, 0)
  assert.equal(row(cross, 'A').availableForPacking, null)
  assert.ok(cross.issues.some((x) => x.code === 'cross-order-carton'))
  assert.throws(() =>
    applyReconciliationCommand(
      {},
      { type: 'separate', entryId: 'A' },
      input({ A: '100' }, { A: '10' }, { batches: [foreign] })
    )
  )
  const duplicate = reconcileOrder(
    input(
      { A: '100' },
      { A: '10' },
      { batches: [box('same', { A: '10' }), box('same', { A: '20' })] }
    )
  )
  assert.equal(duplicate.proposedCount, 0)
  assert.equal(duplicate.confirmedCount, 1)
  assert.ok(duplicate.issues.some((x) => x.code === 'duplicate-carton-id'))
})

test('unknown quantities, unknown count, invalid numeric facts and missing bases stay visible', () => {
  const unknown = reconcileOrder(input({ A: 'bad' }, { A: '10' }))
  assert.equal(unknown.unassignedPieces, null)
  assert.equal(unknown.proposedCount, 0)
  const claim = reconcileOrder(
    input(
      { A: '10' },
      { A: '1' },
      {
        batches: [
          box(
            'u',
            {},
            {
              count: null,
              packingBasis: 'aggregate',
              unresolvedContents: [{ entryIds: ['A'], quantity: null }],
            }
          ),
        ],
      }
    )
  )
  assert.equal(claim.unassignedPieces, null)
  assert.equal(claim.unresolvedPieces, null)
  assert.equal(claim.confirmedCount, null)
  assert.equal(claim.proposedCount, 0)
  const invalid = reconcileOrder(
    input(
      { A: '1' },
      {},
      {
        batches: [
          box(
            'm',
            { A: '1' },
            { weight: '1', weightBasis: 'guess', len: '1', wid: '', ht: '2' }
          ),
        ],
      }
    )
  )
  assert.equal(invalid.knownWeight, null)
  assert.equal(invalid.knownVolume, null)
  assert.ok(invalid.issues.some((x) => x.code === 'invalid-measurement-basis'))
  assert.ok(invalid.issues.some((x) => x.code === 'incomplete-dimensions'))
})

test('property: feasibility matches exhaustive integer allocations for all small overlapping claim sets', () => {
  const masks = [['A'], ['B'], ['A', 'B']]
  const canAllocate = (available, claims, index = 0) => {
    if (index === claims.length) return true
    const claim = claims[index]
    for (let a = 0; a <= claim.quantity; a++) {
      const b = claim.quantity - a
      if (
        (a && !claim.entryIds.includes('A')) ||
        (b && !claim.entryIds.includes('B')) ||
        a > available.A ||
        b > available.B
      )
        continue
      if (
        canAllocate(
          { A: available.A - a, B: available.B - b },
          claims,
          index + 1
        )
      )
        return true
    }
    return false
  }
  let cases = 0
  for (let a = 0; a < 4; a++)
    for (let b = 0; b < 4; b++)
      for (const first of masks)
        for (const second of masks)
          for (let x = 0; x < 5; x++)
            for (let y = 0; y < 5; y++) {
              const claims = [
                { entryIds: first, quantity: x },
                { entryIds: second, quantity: y },
              ]
              assert.equal(
                unresolvedCoverageFeasible(
                  { A: String(a), B: String(b) },
                  claims.map((c) => ({ ...c, quantity: String(c.quantity) }))
                ),
                canAllocate({ A: a, B: b }, claims)
              )
              cases++
            }
  assert.equal(cases, 3600)
})

test('property: repeated compound assignment/capacity/history edits preserve base facts and conservation', () => {
  for (let capacity = 2; capacity < 20; capacity++) {
    const context = input(
      { A: '103', B: '21' },
      { A: String(capacity), B: '20' },
      { batches: [box('base', { A: '3' }, { revision: 1, weight: '1.2' })] }
    )
    let history = createReconciliationHistory(
      createReconciliationDraft(context)
    )
    const initial = reconcileOrder(context)
    for (let step = 0; step < 5; step++) {
      const capacityValue = String(capacity + step)
      history = commitReconciliationHistory(
        history,
        { type: 'set-capacities', values: { A: capacityValue } },
        context
      )
      let plan = reconcileOrder({ ...context, draft: history.present })
      conservation(plan)
      if (row(plan, 'A').unassignedPieces !== '0')
        history = commitReconciliationHistory(
          history,
          { type: 'separate', entryId: 'A' },
          context
        )
      plan = reconcileOrder({ ...context, draft: history.present })
      conservation(plan)
      assert.deepEqual(plan.confirmed, initial.confirmed)
      const undone = undoReconciliationHistory(history)
      assert.deepEqual(redoReconciliationHistory(undone), history)
    }
  }
})

test('mixed search bounds are disclosed without truncating into unique or arbitrary choices', () => {
  const quantities = Object.fromEntries(
    Array.from({ length: 13 }, (_, i) => [`P${i}`, '1'])
  )
  const plan = reconcileOrder(
    input(
      quantities,
      {},
      {
        reports: [
          {
            id: 'r',
            mixedConstraints: [
              {
                id: 'wide',
                entryIds: Object.keys(quantities),
                totalPieces: '2',
                evidence: 'report',
              },
            ],
          },
        ],
      }
    )
  )
  assert.equal(plan.suggestions.length, 0)
  assert.ok(plan.issues.some((x) => x.code === 'mixed-search-bound'))
  assert.equal(plan.unassignedPieces, '13')
})

test('unmapped claims and count-only facts conservatively hold order coverage unknown', () => {
  for (const batch of [
    box('counts-only', {}, { count: 6, packingBasis: 'aggregate' }),
    box(
      'unmapped',
      {},
      { unresolvedContents: [{ entryIds: ['missing-code'], quantity: '10' }] }
    ),
  ]) {
    const plan = reconcileOrder(
      input({ A: '20', B: '20' }, { A: '10', B: '10' }, { batches: [batch] })
    )
    assert.equal(plan.proposedCount, 0)
    assert.ok(plan.products.every((x) => x.availableForPacking === null))
    assert.equal(plan.cartons[0].contents.length, 0)
    assert.ok(
      plan.unresolved[0].entryIds.includes('A') &&
        plan.unresolved[0].entryIds.includes('B')
    )
  }
})

test('count overflow retains an exact negative budget and foreign report constraints cannot leak in', () => {
  const plan = reconcileOrder(
    input(
      { A: '2' },
      {},
      {
        batches: [
          box(
            'large1',
            { A: '1' },
            { count: Number.MAX_SAFE_INTEGER, packingBasis: 'aggregate' }
          ),
          box(
            'large2',
            { A: '1' },
            { count: Number.MAX_SAFE_INTEGER, packingBasis: 'aggregate' }
          ),
        ],
        reports: [{ reportedCount: 0 }],
      }
    )
  )
  assert.equal(plan.confirmedCount, null)
  assert.equal(plan.countDifference, null)
  assert.equal(plan.countDifferenceExact, '-18014398509481982')
  assert.ok(plan.issues.some((x) => x.code === 'count-overflow'))
  assert.ok(plan.issues.some((x) => x.code === 'negative-carton-budget'))
  const foreign = reconcileOrder(
    input(
      { A: '10', B: '10' },
      {},
      {
        reports: [
          {
            id: 'foreign',
            orderId: 'Other',
            reportedCount: 1,
            mixedConstraints: [
              {
                id: 'mix',
                entryIds: ['A', 'B'],
                totalPieces: '20',
                evidence: 'other order',
              },
            ],
          },
        ],
      }
    )
  )
  assert.equal(foreign.reportedCount, null)
  assert.deepEqual(foreign.suggestions, [])
  assert.ok(foreign.issues.some((x) => x.code === 'cross-order-report'))
})

test('touching one compact proposal keeps untouched dependencies derived after later capacity edits', () => {
  const context = input({ A: '100', B: '100' }, { A: '45', B: '10' })
  const b = reconcileOrder(context).proposals.find(
    (x) => x.contents[0].entryId === 'B'
  )
  const placed = applyReconciliationCommand(
    {},
    { type: 'place', entryId: 'A', destinationId: b.id, destinationIndex: 4 },
    context
  )
  assert.equal(placed.cartons.length, 1)
  const changed = applyReconciliationCommand(
    placed,
    { type: 'set-capacities', values: { B: '15' } },
    context
  )
  const plan = reconcileOrder({ ...context, draft: changed })
  assert.equal(plan.proposedCount, 9) // A:2, manual shared:1, remaining B90:6
  assert.equal(
    plan.cartons
      .find((x) => x.id === placed.cartons[0].id)
      .contents.find((x) => x.entryId === 'B').quantity,
    '10'
  )
  assert.equal(
    plan.proposals.find(
      (x) => x.kind === 'capacity' && x.contents[0].entryId === 'B'
    ).count,
    6
  )
  conservation(plan)
})
