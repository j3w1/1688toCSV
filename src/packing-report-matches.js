import {
  canonical,
  multiset,
  clone,
  issue,
  multiply,
  sum,
  decimal,
} from './packing-report-utils.js'
import {
  analyzePackingReport,
  validatePackingReportReview,
  reportCandidateSemantic,
} from './packing-report-model.js'
import {
  validateCartonBatch,
  assertSingleOrderCarton,
} from './carton-batches.js'

const manualFields = [
  'len',
  'wid',
  'ht',
  'weight',
  'weightBasis',
  'suppliedCbm',
  'volumeBasis',
  'contents',
  'unresolvedContents',
  'mark',
  'cartonNumber',
  'notes',
  'packingBasis',
  'contentsUnknown',
  'unitContents',
  'unitMeasurements',
]
const unitDependencies = {
  unitContents: ['count', 'contents', 'unresolvedContents', 'packingBasis'],
  unitMeasurements: [
    'count',
    'contents',
    'unresolvedContents',
    'len',
    'wid',
    'ht',
    'weight',
    'weightBasis',
    'suppliedCbm',
    'volumeBasis',
  ],
}

const semantic = (row, mapping = true) =>
  reportCandidateSemantic(row.candidate || row, { mapping })
const signature = (row, mapping = true) => canonical(semantic(row, mapping))
const labelKey = (row) => {
  const candidate = row.candidate || row
  return candidate.supplierLabel
    ? canonical([candidate.sectionRef, candidate.supplierLabel])
    : null
}
const byKey = (items, key) => {
  const map = new Map()
  for (const item of items) {
    const value = key(item)
    if (value === null) continue
    if (!map.has(value)) map.set(value, [])
    map.get(value).push(item)
  }
  return map
}
const fields = (candidate) => {
  const value = semantic(candidate)
  return {
    count: value.count,
    packingBasis: value.packingBasis,
    supplierLabel: value.supplierLabel,
    labels: value.labels,
    contentClaims: value.contentClaims,
    measurementFacts: value.measurementFacts,
  }
}

function batchFor(candidate, id, report) {
  const { accountId, orderId } = report.orderKey
  const contents = new Map(),
    unresolvedContents = [],
    groups = new Set()
  for (const claim of candidate.contentClaims) {
    if (claim.groupId) groups.add(claim.groupId)
    const total =
      claim.quantity === null
        ? null
        : claim.basis === 'per-carton' && candidate.count !== null
          ? multiply([claim.quantity, String(candidate.count)])
          : claim.basis === 'combined-set' || candidate.count === 1
            ? claim.quantity
            : null
    // Unknown basis remains report evidence. It never becomes an invented domain quantity.
    if (total === null) {
      unresolvedContents.push({
        groupId: claim.groupId,
        entryIds: claim.entryIds,
        quantity: null,
        supplierCode: claim.supplierCode,
      })
      continue
    }
    if (total === '0') continue
    if (claim.kind === 'entry')
      contents.set(
        claim.entryIds[0],
        sum([contents.get(claim.entryIds[0]) || '0', total])
      )
    else
      unresolvedContents.push({
        groupId: claim.groupId,
        entryIds: claim.entryIds,
        quantity: total,
        supplierCode: claim.supplierCode,
      })
  }
  const get = (field) =>
    candidate.measurementFacts.find((fact) => fact.field === field)
  const dimensions = get('dimensions'),
    weight = get('weight'),
    volume = get('volume')
  const applicable = (fact) =>
    fact &&
    fact.unit !== 'unknown' &&
    (fact.basis !== 'unknown' || candidate.count === 1)
  return {
    id,
    accountId,
    orderId,
    storeId: report.storeId || null,
    groups: [...groups].map((groupId) => ({ orderId, groupId })),
    count: candidate.count,
    contents: [...contents].map(([entryId, quantity]) => ({
      orderId,
      entryId,
      quantity,
    })),
    packingBasis: candidate.packingBasis,
    contentsUnknown: candidate.contentClaims.some(
      (claim) =>
        claim.quantity === null ||
        (claim.basis === 'unknown' && candidate.count !== 1)
    ),
    unresolvedContents,
    cartonNumber: candidate.count === 1 ? candidate.supplierLabel || '' : '',
    labelOrigin: candidate.labelOrigin,
    len:
      applicable(dimensions) &&
      (dimensions.basis === 'per-carton' || candidate.count === 1)
        ? dimensions.value[0]
        : '',
    wid:
      applicable(dimensions) &&
      (dimensions.basis === 'per-carton' || candidate.count === 1)
        ? dimensions.value[1]
        : '',
    ht:
      applicable(dimensions) &&
      (dimensions.basis === 'per-carton' || candidate.count === 1)
        ? dimensions.value[2]
        : '',
    weight: applicable(weight) ? weight.value : '',
    weightBasis: weight?.basis === 'per-carton' ? 'carton' : 'batch',
    suppliedCbm: applicable(volume) ? volume.value : '',
    volumeBasis: volume?.basis === 'per-carton' ? 'carton' : 'batch',
    reportRef: {
      sourceId: report.source.sourceId,
      candidateKey: candidate.candidateKey,
    },
    provenance: {
      type: 'packing-report',
      sourceRefs: clone(candidate.sourceRefs),
      measurementFacts: clone(candidate.measurementFacts),
      contentClaims: clone(candidate.contentClaims),
    },
    needsReview:
      candidate.count === null ||
      candidate.contentClaims.some(
        (claim) =>
          claim.quantity === null ||
          claim.kind !== 'entry' ||
          (claim.basis === 'unknown' && candidate.count !== 1)
      ) ||
      report.coverage?.feasible === false,
  }
}

function validatePayloadBatches(batches, report) {
  const ids = new Set(
    report.reviewContext.products.map((product) => product.entryId)
  )
  const validQuantity = (value) =>
    typeof value === 'string' && /^[1-9]\d{0,29}$/.test(value)
  for (const batch of batches) {
    if (
      !['exact', 'uniform', 'aggregate'].includes(batch.packingBasis) ||
      (batch.packingBasis === 'exact' && batch.count !== 1) ||
      (batch.contentsUnknown !== undefined &&
        typeof batch.contentsUnknown !== 'boolean')
    )
      throw new Error('Invalid packing evidence basis')
    if (
      batch.orderId !== report.orderKey.orderId ||
      batch.accountId !== report.orderKey.accountId ||
      (batch.count !== null &&
        (!Number.isSafeInteger(batch.count) ||
          batch.count < 1 ||
          batch.count > 10000))
    )
      throw new Error('Invalid physical ownership/count')
    if (
      !Array.isArray(batch.contents) ||
      new Set(batch.contents.map((item) => item.entryId)).size !==
        batch.contents.length ||
      batch.contents.some(
        (item) =>
          item.orderId !== batch.orderId ||
          !ids.has(item.entryId) ||
          !validQuantity(item.quantity)
      )
    )
      throw new Error('Invalid known contents')
    if (
      !Array.isArray(batch.unresolvedContents) ||
      batch.unresolvedContents.some(
        (item) =>
          (item.quantity !== null && !validQuantity(item.quantity)) ||
          !Array.isArray(item.entryIds) ||
          item.entryIds.some((id) => !ids.has(id))
      )
    )
      throw new Error('Invalid unresolved contents')
    const dimensions = ['len', 'wid', 'ht'].map((field) => batch[field])
    if (
      dimensions.some((value) => value !== '') &&
      dimensions.some((value) => value === '' || decimal(value) === '0')
    )
      throw new Error('Invalid dimensions')
    for (const field of ['weight', 'suppliedCbm'])
      if (batch[field] !== '') decimal(batch[field])
    if (
      !['carton', 'batch'].includes(batch.weightBasis) ||
      !['carton', 'batch'].includes(batch.volumeBasis) ||
      (batch.mark && batch.mark.orderId !== batch.orderId)
    )
      throw new Error('Invalid measurement/mark ownership')
    if (
      batch.unitContents ||
      batch.unitMeasurements ||
      batch.sourceFacts ||
      batch.cartonHistory
    ) {
      // Validate shared physical proof without inventing a supplier identity.
      // The repository supplies and validates the actual order's store at commit.
      const normalized = validateCartonBatch({
        ...batch,
        storeId: batch.storeId || 'report-validation',
      })
      assertSingleOrderCarton(normalized)
      for (const contents of Object.values(normalized.unitContents || {}))
        if (contents.some((item) => !ids.has(item.entryId)))
          throw new Error('Indexed contents reference another product')
    }
  }
}

/** A pure correction proposal; the domain repository must revalidate all guards atomically. */
export function planPackingReportUpdate({
  interpretedReport,
  priorReport = null,
  physicalFacts = [],
  manualFacts = [],
  tombstones = [],
  sealedDependencies = [],
  explicitMatches = {},
  newIdentityPool = [],
} = {}) {
  const report = clone(interpretedReport),
    issues = [],
    identityMatches = [],
    unresolvedMatches = [],
    additions = [],
    supersessions = [],
    removals = [],
    fieldDiff = []
  const expectedRevisions = clone(
    report?.expectedRevisions ?? report?.expectedContextRevisions ?? {}
  )
  const retainedManualFacts = clone(manualFacts)
  const evidenceDiff = {
    added: [],
    changed: [],
    removed: [],
    unchanged: [],
    sourceChanged: false,
  }
  const finish = (status, extra = {}) => ({
    status,
    expectedRevisions,
    evidenceDiff,
    fieldDiff,
    identityMatches,
    unresolvedMatches,
    additions,
    supersessions,
    removals,
    retainedManualFacts,
    affectedShipmentRevisions: [],
    issues,
    ...extra,
  })
  if (
    !report?.orderKey ||
    !report.source?.rawAssetRef ||
    !report.source?.rawDigest ||
    !Array.isArray(report.candidates) ||
    !report.candidates.length
  ) {
    issues.push(issue('invalidReport', 'error', {}, {}))
    return finish('review-required')
  }
  // Retain accepted scoped alias/aggregate decisions when their premises still hold.
  // New explicit decisions take precedence; source facts are always parsed again.
  if (
    priorReport &&
    canonical(priorReport.orderKey) === canonical(report.orderKey)
  ) {
    const seeded = { ...(report.decisions || {}) }
    let changed = false
    for (const [id, decision] of Object.entries(priorReport.decisions || {}))
      if (
        id.startsWith('codeAlias:') &&
        !(id in seeded) &&
        !explicitMatches.forgetAliases?.includes(id)
      ) {
        seeded[id] = clone(decision)
        changed = true
      }
    let refreshed = analyzePackingReport({
      source: report.source,
      context: report.reviewContext,
      selection: report.selection,
      decisions: seeded,
      parserVersion: report.parserVersion,
    })
    const contentSignature = (row) => {
      const { measurementFacts, ...rest } = semantic(row)
      return rest
    }
    const oldCoverage = priorReport.coverage?.completeSetCoverage
    if (
      !report.coverage?.completeSetCoverage &&
      oldCoverage?.provenance === 'owner-confirmed' &&
      canonical(multiset((priorReport.rows || []).map(contentSignature))) ===
        canonical(multiset(refreshed.candidates.map(contentSignature)))
    ) {
      const request = refreshed.decisionRequests.find(
        (item) => item.code === 'completeSetCoverage'
      )
      if (request) {
        seeded[request.id] = {
          scope: request.scope,
          value: {
            provenance: 'owner-confirmed',
            contents: clone(oldCoverage.contents),
            sourceRefs: [],
          },
        }
        retainedManualFacts.push({
          kind: 'completeSetCoverage',
          reportId: priorReport.id,
          revision: priorReport.revision,
          claim: clone(oldCoverage),
        })
        changed = true
      }
    }
    if (changed) {
      refreshed = analyzePackingReport({
        source: report.source,
        context: report.reviewContext,
        selection: report.selection,
        decisions: seeded,
        parserVersion: report.parserVersion,
      })
      const review = validatePackingReportReview({
        analysis: refreshed,
        context: report.reviewContext,
        previousReportRevision: report.previousReportRevision,
      })
      if (review.valid) {
        const originalTokens = report.expectedRevisions
        Object.assign(report, review.interpretedReport, {
          expectedRevisions: originalTokens,
        })
      }
    }
  }
  try {
    const analysis = analyzePackingReport({
      source: report.source,
      context: report.reviewContext,
      selection: report.selection,
      decisions: report.decisions,
      parserVersion: report.parserVersion,
    })
    const validation = validatePackingReportReview({
      analysis,
      context: report.reviewContext,
      previousReportRevision: report.previousReportRevision,
    })
    if (
      !validation.valid ||
      canonical(
        multiset(
          validation.interpretedReport.candidates.map((row) => semantic(row))
        )
      ) !==
        canonical(multiset(report.candidates.map((row) => semantic(row)))) ||
      canonical(validation.interpretedReport.coverage) !==
        canonical(report.coverage) ||
      canonical(validation.interpretedReport.declaredTotals) !==
        canonical(report.declaredTotals)
    )
      throw new Error('Report review must match its complete source')
  } catch (error) {
    issues.push(
      issue('invalidReviewPayload', 'error', {}, { reason: error.message })
    )
    return finish('review-required')
  }
  if (
    priorReport &&
    canonical(priorReport.orderKey) !== canonical(report.orderKey)
  ) {
    issues.push(issue('wrongOrder', 'error', report.orderKey, {}))
    return finish('review-required')
  }
  if (
    (priorReport && report.previousReportRevision !== priorReport.revision) ||
    (!priorReport &&
      report.previousReportRevision !== null &&
      report.previousReportRevision !== undefined)
  ) {
    issues.push(
      issue(
        'staleReport',
        'error',
        {
          expected: report.previousReportRevision,
          actual: priorReport?.revision ?? null,
        },
        {}
      )
    )
    return finish('review-required')
  }
  if (
    physicalFacts.some(
      (batch) =>
        batch.accountId !== report.orderKey.accountId ||
        batch.orderId !== report.orderKey.orderId
    )
  ) {
    issues.push(issue('wrongOrderFacts', 'error', report.orderKey, {}))
    return finish('review-required')
  }
  const incoming = report.candidates,
    prior = priorReport?.rows || []
  const retired = new Set(
    tombstones.map((value) => (typeof value === 'string' ? value : value.id))
  )
  const priorIds = prior.map((row) => row.batchId)
  if (
    new Set(priorIds).size !== priorIds.length ||
    priorIds.some((id) => typeof id !== 'string' || !id)
  ) {
    issues.push(issue('invalidPriorIdentity', 'error', {}, {}))
    return finish('review-required')
  }
  const physical = new Map(physicalFacts.map((batch) => [batch.id, batch]))
  const coverageSignature = (value) =>
    canonical(
      value?.coverage?.completeSetCoverage
        ? {
            contents: multiset(value.coverage.completeSetCoverage.contents),
            provenance: value.coverage.completeSetCoverage.provenance,
          }
        : null
    )
  const coverageChanged =
    !!priorReport &&
    coverageSignature(priorReport) !== coverageSignature(report)
  evidenceDiff.coverageChanged = coverageChanged
  const equivalent =
    !coverageChanged &&
    priorReport &&
    priorReport.parserVersion === report.parserVersion &&
    canonical(multiset(prior.map((row) => semantic(row)))) ===
      canonical(multiset(incoming.map((row) => semantic(row)))) &&
    canonical(priorReport.declaredTotals || {}) ===
      canonical(report.declaredTotals || {})
  evidenceDiff.sourceChanged =
    !!priorReport && canonical(priorReport.source) !== canonical(report.source)
  if (equivalent && !prior.some((row) => retired.has(row.batchId))) {
    evidenceDiff.unchanged = priorIds
    // No arbitrary correspondence is attached to identical anonymous duplicates.
    identityMatches.push(
      ...prior.map((row) => ({
        batchId: row.batchId,
        candidateKey: null,
        reason: 'equivalent-set',
      }))
    )
    return finish('unchanged', { equivalentSource: evidenceDiff.sourceChanged })
  }
  if (
    !priorReport &&
    physicalFacts.length &&
    explicitMatches.additionalReport !== true
  ) {
    unresolvedMatches.push({
      reason: 'choose-report-lineage',
      possibleBatchIds: physicalFacts.map((batch) => batch.id),
    })
    return finish('review-required')
  }
  for (const candidate of incoming) {
    const retiredMatch = prior.find(
      (row) =>
        retired.has(row.batchId) &&
        (signature(row, false) === signature(candidate, false) ||
          (labelKey(row) && labelKey(row) === labelKey(candidate)))
    )
    if (retiredMatch)
      unresolvedMatches.push({
        candidateKey: candidate.candidateKey,
        batchId: retiredMatch.batchId,
        reason: 'tombstone',
      })
  }
  const used = new Set(),
    matched = new Map(),
    reviewedNew = new Set()
  const bind = (candidate, row, reason) => {
    if (retired.has(row.batchId)) {
      unresolvedMatches.push({
        candidateKey: candidate.candidateKey,
        batchId: row.batchId,
        reason: 'tombstone',
      })
      return
    }
    matched.set(candidate.candidateKey, row)
    used.add(row.batchId)
    identityMatches.push({
      candidateKey: candidate.candidateKey,
      batchId: row.batchId,
      reason,
    })
  }
  const choices = explicitMatches.matches || explicitMatches
  for (const candidate of incoming) {
    const choice = choices[candidate.candidateKey]
    if (choice === undefined) continue
    if (choice === 'new') {
      reviewedNew.add(candidate.candidateKey)
      continue
    }
    const row = prior.find((row) => row.batchId === choice)
    if (!row || used.has(row.batchId)) {
      issues.push(
        issue(
          'invalidMatch',
          'error',
          { candidateKey: candidate.candidateKey, choice },
          {}
        )
      )
      continue
    }
    bind(candidate, row, 'reviewed')
  }
  const pending = () =>
    incoming.filter(
      (candidate) =>
        !matched.has(candidate.candidateKey) &&
        !reviewedNew.has(candidate.candidateKey)
    )
  const remaining = () => prior.filter((row) => !used.has(row.batchId))
  // Stable source correspondence is safe only for exactly unchanged evidence cells.
  for (const candidate of pending()) {
    const same = remaining().filter(
      (row) =>
        (row.candidate || row).candidateKey === candidate.candidateKey &&
        signature(row, false) === signature(candidate, false)
    )
    if (same.length === 1) bind(candidate, same[0], 'retained-source')
  }
  const newLabels = byKey(pending(), labelKey),
    oldLabels = byKey(remaining(), labelKey)
  for (const [label, next] of newLabels) {
    const old = oldLabels.get(label) || []
    if (next.length !== 1 || old.length !== 1) continue
    const a = semantic(next[0], false),
      b = semantic(old[0], false)
    // Changed kg/cm alone is a correction; incompatible count/contents may reuse a label.
    if (
      a.count === b.count &&
      canonical(a.contentClaims) === canonical(b.contentClaims)
    )
      bind(next[0], old[0], 'unique-label')
  }
  const newSignatures = byKey(pending(), (row) => signature(row, false)),
    oldSignatures = byKey(remaining(), (row) => signature(row, false))
  for (const [value, next] of newSignatures) {
    const old = oldSignatures.get(value) || []
    if (next.length === 1 && old.length === 1)
      bind(next[0], old[0], 'unique-physical-signature')
  }
  for (const candidate of pending()) {
    if (prior.length)
      unresolvedMatches.push({
        candidateKey: candidate.candidateKey,
        possibleBatchIds: remaining().map((row) => row.batchId),
        reason: 'uncertain-correction-or-addition',
      })
    else reviewedNew.add(candidate.candidateKey)
  }
  const approvedRemovals = new Set(explicitMatches.removals || [])
  for (const row of remaining()) {
    removals.push({
      batchId: row.batchId,
      approved: approvedRemovals.has(row.batchId),
    })
    evidenceDiff.removed.push(row.batchId)
    if (!approvedRemovals.has(row.batchId))
      unresolvedMatches.push({ batchId: row.batchId, reason: 'removal-review' })
  }
  const batches = [],
    rows = [],
    pool = [...newIdentityPool],
    allocated = new Set([
      ...priorIds,
      ...physicalFacts.map((batch) => batch.id),
      ...retired,
    ])
  for (const candidate of incoming) {
    const old = matched.get(candidate.candidateKey)
    if (!old && !reviewedNew.has(candidate.candidateKey)) continue
    let id = old?.batchId
    if (!id) {
      id = pool.shift()
      if (
        typeof id !== 'string' ||
        !id.trim() ||
        id.length > 512 ||
        /[\r\n]/.test(id) ||
        allocated.has(id)
      ) {
        issues.push(
          issue(
            'identityPool',
            'error',
            { candidateKey: candidate.candidateKey },
            {}
          )
        )
        continue
      }
      allocated.add(id)
      additions.push({ candidateKey: candidate.candidateKey, batchId: id })
      evidenceDiff.added.push(id)
    }
    const batch = batchFor(candidate, id, report)
    const current = physical.get(id)
    if (old) {
      if (!current)
        issues.push(issue('missingPhysicalFact', 'error', { batchId: id }, {}))
      const before = fields(old),
        after = fields(candidate)
      for (const field of Object.keys(after))
        if (canonical(before[field]) !== canonical(after[field]))
          fieldDiff.push({
            batchId: id,
            field,
            previousReport: before[field],
            incoming: after[field],
            effective: current ? clone(current) : null,
          })
      if (signature(old) === signature(candidate))
        evidenceDiff.unchanged.push(id)
      else {
        evidenceDiff.changed.push(id)
        supersessions.push({
          batchId: id,
          before: clone(old.candidate || old),
          after: clone(candidate),
        })
      }
      if (old && (old.candidate || old).count !== candidate.count) {
        const indices = explicitMatches.entitlements?.[id]
        if (
          !Array.isArray(indices) ||
          indices.length !== candidate.count ||
          new Set(indices).size !== indices.length ||
          indices.some((index) => !Number.isSafeInteger(index) || index < 0)
        )
          unresolvedMatches.push({ batchId: id, reason: 'entitlement-review' })
        else batch.entitlementIndices = clone(indices)
      }
      if (current) {
        // Receiving/loading, independent marks and authored fields belong to the domain.
        for (const field of [
          'received',
          'loaded',
          'mark',
          'notes',
          'revision',
          'updatedAt',
          'entitlementIndices',
          'sourceFacts',
          'cartonHistory',
        ])
          if (
            current[field] !== undefined &&
            !(field === 'entitlementIndices' && batch[field] !== undefined)
          )
            batch[field] = clone(current[field])
      }
    }
    const previousBatch = old
      ? batchFor(old.candidate || old, id, priorReport)
      : null
    if (current && previousBatch) {
      const explicitFields = new Set(
        manualFacts
          .filter((fact) => (fact.batchId || fact.id) === id)
          .flatMap((fact) => Object.keys(fact.fields || {}))
      )
      const inferred = {}
      for (const field of manualFields)
        if (
          !explicitFields.has(field) &&
          current[field] !== undefined &&
          canonical(current[field]) !== canonical(previousBatch[field])
        )
          inferred[field] = clone(current[field])
      if (Object.keys(inferred).length)
        retainedManualFacts.push({
          batchId: id,
          fields: inferred,
          provenance: 'effective-override',
          revision: current.revision,
        })
    }
    const incomingFacts = clone(batch)
    for (const manual of retainedManualFacts.filter(
      (fact) => (fact.batchId || fact.id) === id
    )) {
      for (const [field, value] of Object.entries(manual.fields || {})) {
        if (!manualFields.includes(field)) {
          issues.push(
            issue('invalidManualField', 'error', { batchId: id, field }, {})
          )
          continue
        }
        const incomingValue = batch[field]
        const dependentChange =
          old &&
          unitDependencies[field]?.some(
            (dependency) =>
              canonical(previousBatch[dependency]) !==
              canonical(incomingFacts[dependency])
          )
        batch[field] = clone(value)
        if (
          dependentChange ||
          (canonical(value) !== canonical(incomingValue) &&
            old &&
            incomingValue !== undefined &&
            incomingValue !== '' &&
            incomingValue !== null &&
            canonical(previousBatch[field]) !== canonical(incomingValue))
        ) {
          fieldDiff.push({
            batchId: id,
            field,
            previousReport: old.candidate || old,
            incoming: incomingValue,
            effective: value,
            manualConflict: true,
          })
          if (!explicitMatches.manualConflicts?.includes(`${id}:${field}`))
            unresolvedMatches.push({
              batchId: id,
              field,
              reason: 'manual-conflict',
            })
        }
      }
    }
    rows.push({ batchId: id, candidate: clone(candidate) })
    batches.push(batch)
  }
  try {
    validatePayloadBatches(batches, report)
  } catch (error) {
    issues.push(
      issue('invalidCommitPayload', 'error', {}, { reason: error.message })
    )
  }
  const changedIds = new Set([
    ...evidenceDiff.changed,
    ...evidenceDiff.removed,
    ...(coverageChanged ? priorIds : []),
  ])
  const affectedShipmentRevisions = sealedDependencies
    .filter(
      (dependency) =>
        changedIds.has(dependency.batchId) ||
        (dependency.reportId &&
          dependency.reportId === priorReport?.id &&
          !equivalent)
    )
    .map(clone)
  if (issues.length || unresolvedMatches.length)
    return finish('review-required', { affectedShipmentRevisions })
  // Interpretation changes are always visible, including a parser-version change with equal facts.
  if (
    priorReport &&
    priorReport.parserVersion !== report.parserVersion &&
    explicitMatches.parserVersion !== report.parserVersion
  ) {
    issues.push(
      issue(
        'parserVersionReview',
        'decision',
        { before: priorReport.parserVersion, after: report.parserVersion },
        {}
      )
    )
    return finish('review-required')
  }
  if (affectedShipmentRevisions.length)
    return finish('amendment-required', {
      affectedShipmentRevisions,
      proposedCartonBatches: batches,
    })
  return finish('ready', {
    commitPayload: {
      orderKey: clone(report.orderKey),
      expectedRevisions,
      report: {
        ...report,
        coverage: {
          ...report.coverage,
          completeSetCoverage: report.coverage.completeSetCoverage
            ? {
                ...report.coverage.completeSetCoverage,
                batchIds: rows.map((row) => row.batchId),
              }
            : null,
        },
        id: priorReport?.id || report.source.sourceId,
        rows,
        reportedCount:
          report.declaredTotals?.count !== undefined
            ? Number(report.declaredTotals.count)
            : (report.coverage?.count ?? null),
      },
      cartonBatches: batches,
      removedBatchIds: removals.map((item) => item.batchId),
      evidenceHistory: priorReport ? [clone(priorReport)] : [],
    },
  })
}
