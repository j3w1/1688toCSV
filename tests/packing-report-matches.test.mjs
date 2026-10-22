import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePackingReportCells } from '../src/packing-report-cells.js'
import {
  analyzePackingReport,
  validatePackingReportReview,
} from '../src/packing-report-model.js'
import { planPackingReportUpdate } from '../src/packing-report-matches.js'

const context = {
  accountId: 'local',
  orderId: '1688',
  sourceRevision: 1,
  preparationRevision: 0,
  products: [
    {
      entryId: 'A',
      groupId: 'G',
      purchased: '100',
      ceCodes: ['C'],
      supplierCodes: [],
    },
  ],
}
function report(
  rows,
  {
    header = 'Carton no\tArticle\tPieces per carton\tWeight per carton kg',
    revision = null,
    ctx = context,
    decisions = {},
    parserVersion = '1',
    sourceId = 'source',
  } = {}
) {
  const source = parsePackingReportCells({
    text: [header, ...rows].join('\n'),
    sourceId,
    rawAssetRef: `local-report:${sourceId}`,
    rawDigest: rows.join(),
  }).source
  const analysis = analyzePackingReport({
    source,
    context: ctx,
    decisions,
    parserVersion,
  })
  const review = validatePackingReportReview({
    analysis,
    context: ctx,
    previousReportRevision: revision,
    expectedContextRevisions: {
      sourceRevision: 1,
      preparationRevision: 0,
      source: { observedAt: 'opaque', fingerprint: 'x' },
      cartons: {},
    },
  })
  assert.equal(review.valid, true, JSON.stringify(review.issues))
  return review.interpretedReport
}
function accepted(rows, options) {
  const interpretedReport = report(rows, options)
  const plan = planPackingReportUpdate({
    interpretedReport,
    newIdentityPool: ['box-a', 'box-b', 'box-c', 'box-d'],
  })
  assert.equal(plan.status, 'ready', JSON.stringify(plan))
  return {
    priorReport: { ...plan.commitPayload.report, revision: 1 },
    physicalFacts: plan.commitPayload.cartonBatches.map((batch) => ({
      ...batch,
      revision: 2,
    })),
  }
}

test('identical/reordered/renamed equivalent sources are unchanged without ID allocation or duplicate revision', () => {
  const prior = accepted(['001\tC\t10\t5', '002\tC\t20\t6'])
  const sourceBefore = structuredClone(prior)
  for (const rows of [
    ['001\tC\t10\t5', '002\tC\t20\t6'],
    ['002\tC\t20\t6.0', '001\tC\t10\t5.00'],
  ]) {
    const plan = planPackingReportUpdate({
      ...prior,
      interpretedReport: report(rows, {
        revision: 1,
        sourceId: 'renamed-source',
      }),
    })
    assert.equal(plan.status, 'unchanged', JSON.stringify(plan))
    assert.deepEqual(
      plan.identityMatches.map((match) => match.batchId).sort(),
      ['box-a', 'box-b']
    )
    assert.equal(plan.commitPayload, undefined)
    assert.deepEqual(plan.additions, [])
  }
  assert.deepEqual(prior, sourceBefore)
})

test('unique supplier-label correction preserves IDs, three-way diff and independent manual decisions', () => {
  const prior = accepted(['001\tC\t10\t5', '002\tC\t20\t6'])
  const manualFacts = [
    {
      batchId: 'box-a',
      fields: { weight: '7', notes: 'owner measurement' },
      revision: 4,
    },
  ]
  const interpretedReport = report(['002\tC\t20\t6', '001\tC\t10\t5.5'], {
    revision: 1,
  })
  let plan = planPackingReportUpdate({
    ...prior,
    interpretedReport,
    manualFacts,
  })
  assert.equal(plan.status, 'review-required')
  assert(
    plan.unresolvedMatches.some((match) => match.reason === 'manual-conflict')
  )
  assert(
    plan.fieldDiff.some(
      (field) =>
        field.manualConflict &&
        field.effective === '7' &&
        field.incoming === '5.5'
    )
  )
  plan = planPackingReportUpdate({
    ...prior,
    interpretedReport,
    manualFacts,
    explicitMatches: { manualConflicts: ['box-a:weight', 'box-a:notes'] },
  })
  assert.equal(plan.status, 'ready', JSON.stringify(plan))
  assert.equal(
    plan.commitPayload.cartonBatches.find((batch) => batch.id === 'box-a')
      .weight,
    '7'
  )
  assert.equal(
    plan.commitPayload.cartonBatches.find((batch) => batch.id === 'box-a')
      .notes,
    'owner measurement'
  )
  assert.deepEqual(plan.retainedManualFacts, manualFacts)
  assert.deepEqual(plan.evidenceDiff.changed, ['box-a'])
  assert.deepEqual(plan.commitPayload.evidenceHistory, [prior.priorReport])
  assert.deepEqual(plan.expectedRevisions, interpretedReport.expectedRevisions)
})

test('anonymous duplicates retain multiplicity as an equivalent set; an anonymous correction cannot guess a correspondence', () => {
  const header = 'Article\tPieces per carton\tWeight per carton kg'
  const prior = accepted(['C\t10\t5', 'C\t10\t5'], { header })
  const unchanged = planPackingReportUpdate({
    ...prior,
    interpretedReport: report(['C\t10\t5', 'C\t10\t5'], {
      header,
      revision: 1,
    }),
  })
  assert.equal(unchanged.status, 'unchanged')
  assert.equal(unchanged.identityMatches.length, 2)
  assert(
    unchanged.identityMatches.every((match) => match.candidateKey === null)
  )
  const changed = planPackingReportUpdate({
    ...prior,
    interpretedReport: report(['C\t10\t7', 'C\t10\t5'], {
      header,
      revision: 1,
    }),
  })
  assert.equal(changed.status, 'review-required')
  assert(
    changed.unresolvedMatches.some(
      (match) => match.reason === 'uncertain-correction-or-addition'
    )
  )
})

test('renumbering, count/quantity changes, missing rows and extra reports require specific matching/removal review', () => {
  const prior = accepted(['001\tC\t10\t5', '002\tC\t20\t6'])
  const interpretedReport = report(['099\tC\t10\t5'], { revision: 1 })
  let plan = planPackingReportUpdate({ ...prior, interpretedReport })
  assert.equal(plan.status, 'review-required')
  assert.equal(plan.commitPayload, undefined)
  const key = interpretedReport.candidates[0].candidateKey
  plan = planPackingReportUpdate({
    ...prior,
    interpretedReport,
    explicitMatches: { matches: { [key]: 'box-a' }, removals: ['box-b'] },
  })
  assert.equal(plan.status, 'ready', JSON.stringify(plan))
  assert.deepEqual(plan.commitPayload.removedBatchIds, ['box-b'])
  assert.equal(plan.commitPayload.cartonBatches[0].id, 'box-a')
  const reused = planPackingReportUpdate({
    ...prior,
    interpretedReport: report(['001\tC\t90\t5', '002\tC\t20\t6'], {
      revision: 1,
    }),
  })
  assert.equal(reused.status, 'review-required')
})

test('mapping-only corrections retain physical identities, counts and measurements, with order-local alias evidence', () => {
  const oldContext = {
    ...context,
    products: [
      ...context.products,
      {
        entryId: 'B',
        groupId: 'H',
        purchased: '100',
        ceCodes: ['D'],
        supplierCodes: [],
      },
    ],
  }
  const rows = ['001\tOLD\t10\t5']
  let interpretedReport = report(rows, { ctx: oldContext })
  const alias = interpretedReport.unresolved.find(
    (item) => item.code === 'codeAlias'
  )
  assert(alias)
  const oldDecision = {
    [alias.id]: {
      scope: alias.scope,
      value: { entryIds: ['A'], orderId: '1688' },
    },
  }
  const prior = accepted(rows, { ctx: oldContext, decisions: oldDecision })
  const decisions = {
    [alias.id]: {
      scope: alias.scope,
      value: { entryIds: ['B'], orderId: '1688' },
    },
  }
  interpretedReport = report(rows, { ctx: oldContext, decisions, revision: 1 })
  const plan = planPackingReportUpdate({ ...prior, interpretedReport })
  assert.equal(plan.status, 'ready', JSON.stringify(plan))
  assert.equal(plan.commitPayload.cartonBatches[0].id, 'box-a')
  assert.equal(plan.commitPayload.cartonBatches[0].weight, '5')
  assert.equal(plan.commitPayload.cartonBatches[0].count, 1)
  assert.equal(plan.commitPayload.cartonBatches[0].contents[0].entryId, 'B')
  assert(plan.fieldDiff.some((field) => field.field === 'contentClaims'))
})

test('sealed corrections route every dependency to amendment and never expose ordinary commit payload', () => {
  const prior = accepted(['001\tC\t10\t5'])
  const interpretedReport = report(['001\tC\t10\t6'], { revision: 1 })
  const dependencies = [
    { batchId: 'box-a', containerId: 'ship-1', revisionId: 'v1' },
    { batchId: 'box-a', containerId: 'ship-2', revisionId: 'v2' },
  ]
  const before = structuredClone(prior)
  const plan = planPackingReportUpdate({
    ...prior,
    interpretedReport,
    sealedDependencies: dependencies,
  })
  assert.equal(plan.status, 'amendment-required', JSON.stringify(plan))
  assert.deepEqual(plan.affectedShipmentRevisions, dependencies)
  assert.equal(plan.commitPayload, undefined)
  assert.deepEqual(prior, before)
})

test('stale source/report tokens, tombstones, invalid identity pools and forged partial payload reject atomically', () => {
  const prior = accepted(['001\tC\t10\t5'])
  assert.equal(
    planPackingReportUpdate({
      ...prior,
      interpretedReport: report(['001\tC\t10\t6']),
    }).status,
    'review-required'
  )
  const interpretedReport = report(['001\tC\t10\t6'], { revision: 1 })
  const retired = planPackingReportUpdate({
    ...prior,
    interpretedReport,
    tombstones: ['box-a'],
  })
  assert.equal(retired.status, 'review-required')
  assert.equal(retired.commitPayload, undefined)
  for (const pool of [[], [''], ['same', 'same']]) {
    const plan = planPackingReportUpdate({
      interpretedReport: report(['001\tC\t10\t5', '002\tC\t20\t6']),
      newIdentityPool: pool,
    })
    assert.equal(plan.status, 'review-required')
    assert.equal(plan.commitPayload, undefined)
  }
  const forged = report(['001\tC\t10\t5', '002\tC\t20\t6'])
  forged.candidates.pop()
  assert.equal(
    planPackingReportUpdate({
      interpretedReport: forged,
      newIdentityPool: ['a'],
    }).status,
    'review-required'
  )
  const wrongOrder = planPackingReportUpdate({
    ...prior,
    interpretedReport,
    physicalFacts: prior.physicalFacts.map((batch) => ({
      ...batch,
      orderId: 'linked-order',
    })),
  })
  assert.equal(wrongOrder.status, 'review-required')
})

test('different parser interpretation requires explicit version review even when reported facts are equal', () => {
  const prior = accepted(['001\tC\t10\t5'])
  const interpretedReport = report(['001\tC\t10\t5'], {
    revision: 1,
    parserVersion: '2',
  })
  const plan = planPackingReportUpdate({ ...prior, interpretedReport })
  assert.equal(plan.status, 'review-required')
  assert(plan.issues.some((issue) => issue.code === 'parserVersionReview'))
})

test('a report over existing physical facts needs explicit lineage choice instead of assuming additional goods', () => {
  const prior = accepted(['001\tC\t10\t5'])
  const interpretedReport = report(['001\tC\t10\t5'])
  const plan = planPackingReportUpdate({
    interpretedReport,
    physicalFacts: prior.physicalFacts,
    newIdentityPool: ['new-id'],
  })
  assert.equal(plan.status, 'review-required')
  assert(
    plan.unresolvedMatches.some(
      (match) => match.reason === 'choose-report-lineage'
    )
  )
})

test('effective manual overrides survive mapping/source updates without redundant notes review', () => {
  const prior = accepted(['001\tC\t10\t5'])
  prior.physicalFacts[0].weight = '7'
  prior.physicalFacts[0].notes = 'keep this'
  const interpretedReport = report(['001\tC\t10\t6'], { revision: 1 })
  const blocked = planPackingReportUpdate({ ...prior, interpretedReport })
  assert.equal(blocked.status, 'review-required')
  assert.deepEqual(
    blocked.unresolvedMatches
      .filter((match) => match.reason === 'manual-conflict')
      .map((match) => match.field),
    ['weight']
  )
  const ready = planPackingReportUpdate({
    ...prior,
    interpretedReport,
    explicitMatches: { manualConflicts: ['box-a:weight'] },
  })
  assert.equal(ready.status, 'ready', JSON.stringify(ready))
  assert.equal(ready.commitPayload.cartonBatches[0].weight, '7')
  assert.equal(ready.commitPayload.cartonBatches[0].notes, 'keep this')
  assert(
    ready.retainedManualFacts.some((fact) => fact.fields.notes === 'keep this')
  )
})

test('reviewed aggregate count changes also require explicit retained entitlement indices', () => {
  const header =
    'Carton no\tArticle\tTotal pieces\tCarton count\tTotal weight kg'
  const prior = accepted(['SET\tC\t30\t3\t15'], { header })
  prior.physicalFacts[0].entitlementIndices = [2, 3, 4]
  const interpretedReport = report(['SET\tC\t20\t2\t10'], {
    header,
    revision: 1,
  })
  const key = interpretedReport.candidates[0].candidateKey
  const explicitMatches = { matches: { [key]: 'box-a' } }
  const uncertain = planPackingReportUpdate({
    ...prior,
    interpretedReport,
    explicitMatches,
  })
  assert.equal(uncertain.status, 'review-required')
  assert(
    uncertain.unresolvedMatches.some(
      (match) => match.reason === 'entitlement-review'
    )
  )
  const ready = planPackingReportUpdate({
    ...prior,
    interpretedReport,
    explicitMatches: { ...explicitMatches, entitlements: { 'box-a': [2, 4] } },
  })
  assert.equal(ready.status, 'ready', JSON.stringify(ready))
  assert.deepEqual(
    ready.commitPayload.cartonBatches[0].entitlementIndices,
    [2, 4]
  )
})

test('accepted order-local alias and explicit aggregate coverage decisions survive equivalent or measurement-only correction', () => {
  const ctx = {
    ...context,
    products: [
      context.products[0],
      {
        entryId: 'B',
        groupId: 'G',
        purchased: '100',
        ceCodes: ['C'],
        supplierCodes: [],
      },
    ],
  }
  const rows = ['001\tOLD\t10\t5']
  const initial = report(rows, { ctx })
  const request = initial.unresolved.find((item) => item.code === 'codeAlias')
  const decisions = {
    [request.id]: { scope: request.scope, value: { entryIds: ['A', 'B'] } },
  }
  let withAlias = report(rows, { ctx, decisions })
  const sourceAnalysis = analyzePackingReport({
    source: withAlias.source,
    context: ctx,
    decisions,
  })
  const coverageRequest = sourceAnalysis.decisionRequests.find(
    (item) => item.code === 'completeSetCoverage'
  )
  decisions[coverageRequest.id] = {
    scope: coverageRequest.scope,
    value: {
      provenance: 'owner-confirmed',
      contents: [
        { entryId: 'A', quantity: '4' },
        { entryId: 'B', quantity: '6' },
      ],
    },
  }
  const prior = accepted(rows, { ctx, decisions })
  const unchanged = planPackingReportUpdate({
    ...prior,
    interpretedReport: report(rows, { ctx, revision: 1 }),
  })
  assert.equal(unchanged.status, 'unchanged', JSON.stringify(unchanged))
  const corrected = planPackingReportUpdate({
    ...prior,
    interpretedReport: report(['001\tOLD\t10\t6'], { ctx, revision: 1 }),
  })
  assert.equal(corrected.status, 'ready', JSON.stringify(corrected))
  assert.deepEqual(
    corrected.commitPayload.report.coverage.completeSetCoverage.contents,
    [
      { entryId: 'A', quantity: '4' },
      { entryId: 'B', quantity: '6' },
    ]
  )
  assert.equal(corrected.commitPayload.cartonBatches[0].contents.length, 0)
  assert.equal(
    corrected.commitPayload.cartonBatches[0].unresolvedContents[0].quantity,
    '10'
  )
})

test('invalid manual structural payload cannot partly commit alongside valid parsed rows', () => {
  const prior = accepted(['001\tC\t10\t5', '002\tC\t20\t6'])
  const interpretedReport = report(['001\tC\t10\t5.5', '002\tC\t20\t6'], {
    revision: 1,
  })
  for (const fields of [
    { weight: '-1' },
    { len: '60', wid: '', ht: '' },
    { contents: [{ orderId: 'linked-order', entryId: 'A', quantity: '10' }] },
    { unresolvedContents: [{ entryIds: ['foreign'], quantity: '10' }] },
  ]) {
    const plan = planPackingReportUpdate({
      ...prior,
      interpretedReport,
      manualFacts: [{ batchId: 'box-a', fields }],
      explicitMatches: {
        manualConflicts: Object.keys(fields).map((field) => `box-a:${field}`),
      },
    })
    assert.equal(plan.status, 'review-required')
    assert.equal(plan.commitPayload, undefined)
    assert(plan.issues.some((item) => item.code === 'invalidCommitPayload'))
  }
})
