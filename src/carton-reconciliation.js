import {
  exactDecimal,
  exactWhole,
  addExact,
  subtractExact,
  compareExact,
  multiplyExact,
  dividePowerOfTen,
  wholeCartonBreakdown,
  allocateExactDecimal,
} from './carton-arithmetic.js'

const clone = (value) => structuredClone(value)
const missing = (value) => value === null || value === undefined || value === ''
const sum = (values) =>
  values.some((value) => value === null) ? null : addExact(...values)
const unique = (values) => [...new Set(values)]
const issue = (issues, code, details = {}) =>
  issues.push({ code, severity: 'error', ...details })
const safeCount = (value) => {
  if (missing(value)) return null
  const text = exactWhole(value)
  if (BigInt(text) > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Carton count exceeds the safe integer limit')
  return Number(text)
}
const countTotal = (rows) => {
  if (rows.some((row) => row.count === null)) return null
  const total = addExact(...rows.map((row) => String(row.count)))
  return BigInt(total) > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(total)
}
function readWhole(value, issues, code, details = {}) {
  if (missing(value)) return null
  try {
    return exactWhole(value)
  } catch {
    issue(issues, code, { ...details, value })
    return null
  }
}
function readCount(value, issues, details) {
  try {
    return safeCount(value)
  } catch {
    issue(issues, 'invalid-count', { ...details, value })
    return null
  }
}

/** Feasibility only: the arbitrary flow is deliberately neither returned nor stored. */
export function unresolvedCoverageFeasible(quantities, claims) {
  const entries = Object.entries(quantities)
  if (
    entries.some(([, q]) => q === null) ||
    claims.some((claim) => claim.quantity === null)
  )
    return null
  const size = entries.length + claims.length + 2,
    source = size - 2,
    sink = size - 1
  const graph = Array.from({ length: size }, () => [])
  const edge = (from, to, capacity) => {
    const forward = { to, capacity, reverse: graph[to].length }
    const reverse = { to: from, capacity: 0n, reverse: graph[from].length }
    graph[from].push(forward)
    graph[to].push(reverse)
  }
  const byId = new Map(entries.map(([id], index) => [id, index]))
  for (let index = 0; index < entries.length; index++) {
    const q = BigInt(entries[index][1])
    if (q < 0n) return false
    edge(claims.length + index, sink, q)
  }
  let required = 0n
  for (let index = 0; index < claims.length; index++) {
    const claim = claims[index],
      q = BigInt(claim.quantity)
    required += q
    edge(source, index, q)
    for (const id of unique(claim.entryIds))
      if (byId.has(id)) edge(index, claims.length + byId.get(id), q)
  }
  let flow = 0n
  for (;;) {
    const parent = Array(size).fill(null),
      queue = [source]
    parent[source] = [-1, -1]
    for (let head = 0; head < queue.length && !parent[sink]; head++) {
      const from = queue[head]
      for (let i = 0; i < graph[from].length; i++) {
        const next = graph[from][i]
        if (next.capacity > 0n && !parent[next.to]) {
          parent[next.to] = [from, i]
          queue.push(next.to)
        }
      }
    }
    if (!parent[sink]) return flow === required
    let amount = required - flow
    for (let node = sink; node !== source; node = parent[node][0])
      amount =
        amount < graph[parent[node][0]][parent[node][1]].capacity
          ? amount
          : graph[parent[node][0]][parent[node][1]].capacity
    for (let node = sink; node !== source; node = parent[node][0]) {
      const next = graph[parent[node][0]][parent[node][1]]
      next.capacity -= amount
      graph[node][next.reverse].capacity += amount
    }
    flow += amount
    if (flow === required) return true
  }
}

function measurement(batch, field, issues) {
  const value = batch[field]
  if (missing(value)) return null
  try {
    const result = exactDecimal(value)
    if (compareExact(result, '0') < 0) throw new Error('Negative measurement')
    return result
  } catch {
    issue(issues, 'invalid-measurement', { cartonId: batch.id, field, value })
    return null
  }
}

/** Full-set facts only. Combined totals never become invented per-unit facts. */
function cartonMeasurements(batch, issues) {
  if (batch.unitMeasurements && batch.count !== null) {
    const { unitMeasurements, ...base } = batch
    const indices = batch.entitlementIndices || null
    const overrides = Object.entries(unitMeasurements).filter(([index]) =>
      indices ? indices.includes(Number(index)) : Number(index) < batch.count
    )
    const unit = {
      ...base,
      count: 1,
      weight: (base.weightBasis ?? 'carton') === 'carton' ? base.weight : null,
      suppliedCbm:
        (base.volumeBasis ?? 'carton') === 'carton' ? base.suppliedCbm : null,
      weightBasis: 'carton',
      volumeBasis: 'carton',
    }
    const unchangedCount = batch.count - overrides.length
    const measurements = overrides.map(([, values]) => ({
      count: 1,
      ...cartonMeasurements({ ...unit, ...values }, issues),
    }))
    if (unchangedCount)
      measurements.push({
        count: unchangedCount,
        ...cartonMeasurements(unit, issues),
      })
    const metric = (field) => {
      const known = measurements.filter((row) => row[field] !== null)
      const knownCount = known.reduce((total, row) => total + row.count, 0)
      const knownSubtotal = known.length
        ? addExact(
            ...known.map((row) => multiplyExact(row[field], String(row.count)))
          )
        : batch.count === 0
          ? '0'
          : null
      return {
        knownCount,
        missingCount: batch.count - knownCount,
        knownSubtotal,
        total: knownCount === batch.count ? knownSubtotal : null,
        perCarton:
          knownCount === batch.count &&
          known.length &&
          known.every((row) => row[field] === known[0][field])
            ? known[0][field]
            : null,
      }
    }
    const weight = metric('totalWeight'),
      volume = metric('totalVolume')
    return {
      totalWeight: weight.total,
      totalVolume: volume.total,
      dimensionVolume: null,
      suppliedVolume: null,
      suppliedTotalVolume: null,
      weightPerCarton: weight.perCarton,
      volumePerCarton: volume.perCarton,
      unitMeasurementCoverage: { totalWeight: weight, totalVolume: volume },
    }
  }
  const weight = measurement(batch, 'weight', issues)
  const suppliedVolume = measurement(batch, 'suppliedCbm', issues)
  const dimensions = ['len', 'wid', 'ht'].map((field) =>
    measurement(batch, field, issues)
  )
  if (
    dimensions.some((value) => value !== null) &&
    (dimensions.some((value) => value === null) ||
      dimensions.some((value) => value === '0'))
  )
    issue(issues, 'incomplete-dimensions', { cartonId: batch.id })
  const dimensionVolume = dimensions.every(
    (value) => value !== null && value !== '0'
  )
    ? dividePowerOfTen(multiplyExact(...dimensions), 6)
    : null
  for (const [field, basis] of [
    ['weightBasis', batch.weightBasis],
    ['volumeBasis', batch.volumeBasis],
  ])
    if (basis !== undefined && !['carton', 'batch'].includes(basis))
      issue(issues, 'invalid-measurement-basis', {
        cartonId: batch.id,
        field,
        value: basis,
      })
  const totalFor = (value, basis) =>
    value === null || !['carton', 'batch'].includes(basis)
      ? null
      : basis === 'batch'
        ? value
        : batch.count === null
          ? null
          : multiplyExact(value, String(batch.count))
  const totalWeight = totalFor(weight, batch.weightBasis ?? 'carton')
  const dimensionTotal = totalFor(dimensionVolume, 'carton')
  const suppliedTotal = totalFor(suppliedVolume, batch.volumeBasis ?? 'carton')
  if (
    dimensionTotal !== null &&
    suppliedTotal !== null &&
    compareExact(dimensionTotal, suppliedTotal)
  )
    issue(issues, 'volume-discrepancy', {
      severity: 'warning',
      cartonId: batch.id,
      dimensionVolume: dimensionTotal,
      suppliedVolume: suppliedTotal,
      usedVolume: dimensionTotal,
      usedVolumeBasis: 'measured',
      suppliedCbm: suppliedVolume,
      suppliedVolumeBasis: batch.volumeBasis ?? 'carton',
      count: batch.count,
      message: `Measured volume ${dimensionTotal} m³ is used; supplied volume ${suppliedTotal} m³ is retained.`,
    })
  return {
    totalWeight,
    totalVolume: dimensionTotal ?? suppliedTotal,
    dimensionVolume,
    suppliedVolume,
    suppliedTotalVolume: suppliedTotal,
    weightPerCarton:
      (batch.weightBasis ?? 'carton') === 'carton' ? weight : null,
    volumePerCarton:
      dimensionVolume ??
      ((batch.volumeBasis ?? 'carton') === 'carton' ? suppliedVolume : null),
  }
}

/** Reuse confirmed measurement evidence when capturing an immutable shipment. */
export function cartonMeasurementWarnings(batch) {
  const issues = []
  cartonMeasurements(batch, issues)
  return issues.filter((issue) => issue.severity === 'warning')
}

/** Selected aggregates disclose unknown partial measurements; never prorate a combined total. */
export function reconciliationMeasurementForCount(carton, selectedCount) {
  const selected = safeCount(selectedCount)
  if (selected === null || (carton.count !== null && selected > carton.count))
    throw new Error('Invalid selected carton count')
  const value = (total, perCarton) =>
    selected === 0
      ? '0'
      : selected === carton.count
        ? total
        : perCarton === null
          ? null
          : multiplyExact(perCarton, String(selected))
  return {
    weight: value(carton.totalWeight, carton.weightPerCarton),
    volume: value(carton.totalVolume, carton.volumePerCarton),
  }
}

function coverage(cartons, field) {
  if (cartons.some((carton) => carton.unitMeasurementCoverage)) {
    const rows = cartons.map(
      (carton) =>
        carton.unitMeasurementCoverage?.[field] || {
          knownCount: carton[field] === null ? 0 : carton.count,
          missingCount: carton[field] === null ? carton.count : 0,
          knownSubtotal: carton[field],
        }
    )
    const total = (key) =>
      rows.some((row) => row[key] === null)
        ? null
        : rows.reduce((value, row) => value + row[key], 0)
    const values = rows
      .map((row) => row.knownSubtotal)
      .filter((value) => value !== null)
    return {
      knownCount: total('knownCount'),
      missingCount: total('missingCount'),
      totalCount: countTotal(cartons),
      unknownCountBatches: cartons
        .filter((carton) => carton.count === null)
        .map((carton) => carton.id),
      complete: rows.every((row) => row.missingCount === 0),
      knownSubtotal:
        values.length || !cartons.length ? addExact(...values) : null,
    }
  }
  const measured = cartons.filter((carton) => carton[field] !== null)
  const absent = cartons.filter((carton) => carton[field] === null)
  return {
    knownCount: countTotal(measured),
    missingCount: countTotal(absent),
    totalCount: countTotal(cartons),
    unknownCountBatches: cartons
      .filter((carton) => carton.count === null)
      .map((carton) => carton.id),
    complete: absent.length === 0,
    knownSubtotal:
      measured.length || !cartons.length
        ? addExact(...measured.map((carton) => carton[field]))
        : null,
  }
}

function owner(input) {
  const snapshot = input.record?.snapshot ?? input.record
  if (!snapshot || !snapshot.orderId || !Array.isArray(snapshot.items))
    throw new Error('Reconciliation requires one order snapshot')
  return {
    snapshot,
    orderId: snapshot.orderId,
    accountId: snapshot.accountId || 'local',
  }
}
const proposalId = (accountId, orderId, entryId, capacity, quantity) =>
  `capacity:${JSON.stringify([accountId, orderId, entryId, capacity, quantity])}`

/**
 * One-order projection only. Original quantities are not decremented by shipment
 * projections: existing physical batches already cover those same source units.
 * All quantities are decimal strings (pieces are whole); unknown values are null.
 */
export function reconcileOrder(input) {
  const { snapshot, accountId, orderId } = owner(input),
    issues = []
  const draft = input.draft ?? {},
    preparation = input.preparation ?? {},
    batches = input.batches ?? []
  for (const value of [draft, preparation])
    if (
      (value.orderId && value.orderId !== orderId) ||
      (value.accountId && value.accountId !== accountId)
    )
      throw new Error('Reconciliation scope differs from the order')
  const source = new Map(),
    groups = new Map()
  for (const group of preparation.groups ?? [])
    groups.set(
      group.id,
      unique(
        (group.variants ?? []).flatMap((variant) => variant.entryIds ?? [])
      )
    )
  for (const item of snapshot.items) {
    if (source.has(item.entryId)) throw new Error('Duplicate source entry ID')
    const purchased = readWhole(
      item.quantity,
      issues,
      'invalid-source-quantity',
      { entryId: item.entryId }
    )
    const eligibility = input.projection?.eligibility?.[item.entryId]
    let eligible = eligibility
      ? readWhole(eligibility.eligible, issues, 'invalid-eligible-quantity', {
          entryId: item.entryId,
        })
      : purchased
    if (
      eligibility &&
      (purchased === null ||
        eligible === null ||
        (!missing(eligibility.purchased) &&
          String(eligibility.purchased) !== purchased) ||
        compareExact(eligible, purchased) > 0 ||
        (eligible !== purchased && !eligibility.reason))
    ) {
      issue(issues, 'invalid-eligibility', { entryId: item.entryId })
      eligible = null
    }
    source.set(item.entryId, {
      ...clone(item),
      purchased,
      eligible,
      eligibilityReason: eligibility?.reason ?? null,
    })
  }
  const capacities = {
    ...(input.record?.unitsPerCarton ?? {}),
    ...(input.capacities ?? {}),
    ...(draft.capacities ?? {}),
  }
  const original = new Map()
  let invalidOwnership = false
  for (const batch of batches.filter((batch) => !batch.deletedAt)) {
    if (original.has(batch.id)) {
      issue(issues, 'duplicate-carton-id', { cartonId: batch.id })
      invalidOwnership = true
      continue
    }
    original.set(batch.id, clone(batch))
  }
  const staged = new Map()
  for (const batch of draft.cartons ?? []) {
    if (staged.has(batch.id)) throw new Error('Duplicate draft carton ID')
    staged.set(batch.id, clone(batch))
  }
  const effective = [...original.values()].map(
    (batch) => staged.get(batch.id) ?? batch
  )
  effective.push(
    ...[...staged.values()].filter((batch) => !original.has(batch.id))
  )
  const known = new Map([...source.keys()].map((id) => [id, '0']))
  const pending = new Map(known),
    claims = [],
    cartons = []
  for (const raw of effective) {
    const localIssues = [],
      contents = []
    const modified = staged.has(raw.id),
      existing = original.has(raw.id)
    if (
      modified &&
      existing &&
      raw.baseRevision !== undefined &&
      raw.baseRevision !== (original.get(raw.id).revision ?? 0)
    )
      issue(localIssues, 'stale-carton-revision', {
        cartonId: raw.id,
        expectedRevision: raw.baseRevision,
        currentRevision: original.get(raw.id).revision ?? 0,
      })
    const count = readCount(raw.count, localIssues, { cartonId: raw.id })
    const references = [
      ...(raw.contents ?? []),
      ...(raw.groups ?? []),
      ...(raw.mark ? [raw.mark] : []),
      ...(raw.unresolvedContents ?? []),
    ]
    if (
      (raw.accountId && raw.accountId !== accountId) ||
      (raw.orderId && raw.orderId !== orderId) ||
      references.some((ref) => ref.orderId && ref.orderId !== orderId)
    ) {
      issue(localIssues, 'cross-order-carton', { cartonId: raw.id })
      invalidOwnership = true
    }
    const seen = new Set()
    for (const item of raw.contents ?? []) {
      if (seen.has(item.entryId))
        issue(localIssues, 'duplicate-content', {
          cartonId: raw.id,
          entryId: item.entryId,
        })
      seen.add(item.entryId)
      const quantity = readWhole(
        item.quantity,
        localIssues,
        'invalid-content-quantity',
        { cartonId: raw.id, entryId: item.entryId }
      )
      contents.push({
        ...clone(item),
        orderId: item.orderId ?? orderId,
        quantity,
      })
      if (
        !source.has(item.entryId) ||
        (item.orderId && item.orderId !== orderId)
      ) {
        issue(localIssues, 'unknown-content-entry', {
          cartonId: raw.id,
          entryId: item.entryId,
        })
        invalidOwnership = true
        continue
      }
      const target = modified ? pending : known
      target.set(
        item.entryId,
        target.get(item.entryId) === null || quantity === null
          ? null
          : addExact(target.get(item.entryId), quantity)
      )
    }
    const sourceClaims = raw.unresolvedContents?.length
      ? raw.unresolvedContents
      : !contents.length && !raw.removalRequested
        ? [
            {
              entryIds: [...source.keys()],
              quantity: null,
              coverageBasis: 'unknown',
            },
          ]
        : []
    const unresolvedContents = sourceClaims.map((claim, index) => {
      let ids = unique(
        claim.entryIds?.length
          ? claim.entryIds
          : (groups.get(claim.groupId) ?? [])
      )
      if (!ids.length) {
        ids = [...source.keys()]
        issue(localIssues, 'unresolved-candidates-unknown', {
          cartonId: raw.id,
          claimIndex: index,
        })
      }
      if (ids.some((id) => !source.has(id))) {
        issue(localIssues, 'unknown-candidate-entry', {
          cartonId: raw.id,
          claimIndex: index,
        })
        // An unmapped reference cannot establish that any local entry is free.
        ids = [...source.keys()]
      }
      const result = {
        ...clone(claim),
        id: `${raw.id}:claim:${index}`,
        cartonId: raw.id,
        entryIds: ids.filter((id) => source.has(id)),
        quantity: readWhole(
          claim.quantity,
          localIssues,
          'invalid-unresolved-quantity',
          { cartonId: raw.id, claimIndex: index }
        ),
      }
      claims.push(result)
      return result
    })
    const packingBasis =
      raw.packingBasis ?? (count === 1 ? 'exact' : 'aggregate')
    if (!['exact', 'uniform', 'aggregate'].includes(packingBasis))
      issue(localIssues, 'invalid-packing-basis', { cartonId: raw.id })
    if (packingBasis === 'exact' && count !== 1)
      issue(localIssues, 'exact-count-conflict', { cartonId: raw.id })
    if (
      packingBasis === 'uniform' &&
      (count === null ||
        count < 1 ||
        contents.some(
          (item) =>
            item.quantity === null ||
            BigInt(item.quantity) % BigInt(count) !== 0n
        ))
    )
      issue(localIssues, 'uniform-contents-conflict', { cartonId: raw.id })
    const measurementFields = cartonMeasurements({ ...raw, count }, localIssues)
    const item = {
      ...clone(raw),
      orderId: raw.orderId ?? orderId,
      accountId: raw.accountId ?? accountId,
      count,
      packingBasis,
      contents,
      unresolvedContents,
      state: raw.removalRequested
        ? 'removal-proposed'
        : modified
          ? existing
            ? 'modified'
            : 'proposed'
          : 'confirmed',
      labelOrigin:
        raw.labelOrigin ?? (raw.cartonNumber ? 'reported' : 'internal'),
      ...measurementFields,
      issues: localIssues,
    }
    cartons.push(item)
    issues.push(...localIssues)
  }
  const residual = Object.fromEntries(
    [...source].map(([id, item]) => [
      id,
      item.eligible === null ||
      known.get(id) === null ||
      pending.get(id) === null
        ? null
        : subtractExact(
            item.eligible,
            addExact(known.get(id), pending.get(id))
          ),
    ])
  )
  const feasible = unresolvedCoverageFeasible(residual, claims)
  if (feasible === false)
    issue(issues, 'coverage-infeasible', {
      cartonIds: unique(claims.map((claim) => claim.cartonId)),
    })
  const proposals = cartons.filter((carton) => carton.state === 'proposed'),
    products = []
  for (const [entryId, item] of source) {
    const ownClaims = claims.filter((claim) => claim.entryIds.includes(entryId))
    const ambiguous = ownClaims.some(
      (claim) => claim.entryIds.length !== 1 || claim.quantity === null
    )
    const unresolvedPieces = ambiguous
      ? null
      : sum(ownClaims.map((claim) => claim.quantity))
    const available =
      invalidOwnership ||
      ambiguous ||
      residual[entryId] === null ||
      unresolvedPieces === null
        ? null
        : subtractExact(residual[entryId], unresolvedPieces)
    const rawCapacity = capacities[entryId],
      capacity = readWhole(rawCapacity, issues, 'invalid-capacity', { entryId })
    if (capacity === '0')
      issue(issues, 'invalid-capacity', { entryId, value: rawCapacity })
    let fullCartons = null,
      remainder = available,
      proposedPieces = pending.get(entryId)
    if (available !== null && compareExact(available, '0') < 0)
      issue(issues, 'product-overallocated', {
        entryId,
        remaining: available,
        cartonIds: cartons
          .filter((carton) =>
            carton.contents.some((part) => part.entryId === entryId)
          )
          .map((carton) => carton.id),
      })
    if (
      available !== null &&
      compareExact(available, '0') >= 0 &&
      capacity !== null &&
      capacity !== '0' &&
      !invalidOwnership
    ) {
      const breakdown = wholeCartonBreakdown(available, capacity)
      fullCartons = readCount(breakdown.fullCartons, issues, { entryId })
      const id = proposalId(accountId, orderId, entryId, capacity, available)
      if (fullCartons === null || (draft.rejected ?? []).includes(id)) {
        fullCartons = 0
        remainder = available
      } else {
        remainder = breakdown.remainder
        if (fullCartons > 0) {
          const quantity = multiplyExact(String(fullCartons), capacity)
          const proposal = {
            id,
            accountId,
            orderId,
            count: fullCartons,
            packingBasis: 'uniform',
            unitsPerCarton: capacity,
            contents: [{ orderId, entryId, quantity }],
            unresolvedContents: [],
            kind: 'capacity',
            state: 'proposed',
            labelOrigin: 'internal',
            totalWeight: null,
            totalVolume: null,
            weightPerCarton: null,
            volumePerCarton: null,
            issues: [],
            requiresConfirmation: true,
          }
          proposals.push(proposal)
          cartons.push(proposal)
          proposedPieces =
            proposedPieces === null ? null : addExact(proposedPieces, quantity)
        }
      }
    }
    const references = cartons.filter((carton) =>
      carton.contents.some((part) => part.entryId === entryId)
    )
    const sharedReferences = references
      .filter(
        (carton) =>
          carton.contents.length > 1 || carton.unresolvedContents.length > 0
      )
      .map((carton) => ({
        id: carton.id,
        cartonNumber: carton.cartonNumber ?? null,
        labelOrigin: carton.labelOrigin,
        count: carton.count,
        quantity: sum(
          carton.contents
            .filter((part) => part.entryId === entryId)
            .map((part) => part.quantity)
        ),
        totalPieces: sum(
          [...carton.contents, ...carton.unresolvedContents].map(
            (part) => part.quantity
          )
        ),
        state: carton.state,
      }))
    const pattern = references.map((carton) => {
      const quantity = sum(
        carton.contents
          .filter((part) => part.entryId === entryId)
          .map((part) => part.quantity)
      )
      return {
        cartonId: carton.id,
        count: carton.count,
        quantity,
        perCarton:
          carton.packingBasis === 'exact' && carton.count === 1
            ? quantity
            : carton.packingBasis === 'uniform' &&
                carton.count &&
                quantity !== null &&
                BigInt(quantity) % BigInt(carton.count) === 0n
              ? String(BigInt(quantity) / BigInt(carton.count))
              : null,
        shared: sharedReferences.some((ref) => ref.id === carton.id),
        state: carton.state,
      }
    })
    const individual = pattern
      .filter((part) => !part.shared)
      .map((part) => part.perCarton)
    const states = []
    if (sharedReferences.length) states.push('shared')
    if (individual.length)
      states.push(
        individual.every((value) => value !== null && value === individual[0])
          ? 'uniform'
          : 'uneven'
      )
    if (remainder === null || remainder !== '0') states.push('unassigned')
    if (ambiguous || compareExact(available ?? '0', '0') < 0)
      states.push('needs-review')
    products.push({
      ...item,
      entryId,
      orderId,
      capacity: capacity === '0' ? null : capacity,
      rawCapacity: rawCapacity ?? null,
      availableForPacking: available,
      confirmedPieces: known.get(entryId),
      proposedPieces,
      unresolvedPieces,
      unassignedPieces: remainder,
      fullCartons,
      remainder,
      pattern,
      sharedReferences,
      states,
      unresolvedClaimIds: ownClaims.map((claim) => claim.id),
    })
  }
  const totals = {
    purchased: sum(products.map((row) => row.purchased)),
    eligible: sum(products.map((row) => row.eligible)),
    confirmed: sum(products.map((row) => row.confirmedPieces)),
    proposed: sum(products.map((row) => row.proposedPieces)),
    unresolved: sum(claims.map((claim) => claim.quantity)),
  }
  const unassignedPieces = [
    totals.eligible,
    totals.confirmed,
    totals.proposed,
    totals.unresolved,
  ].some((value) => value === null)
    ? null
    : subtractExact(
        totals.eligible,
        addExact(totals.confirmed, totals.proposed, totals.unresolved)
      )
  const activeCartons = cartons.filter((carton) => !carton.removalRequested)
  const existingCartons = activeCartons.filter((carton) =>
      original.has(carton.id)
    ),
    newCartons = activeCartons.filter((carton) => !original.has(carton.id))
  const confirmedCount = countTotal(existingCartons),
    proposedCount = countTotal(newCartons)
  const reports = (
    Array.isArray(input.reports)
      ? input.reports
      : input.reports
        ? [input.reports]
        : []
  ).filter((report) => {
    if (report.deletedAt || report.supersededAt) return false
    if (
      (report.orderId && report.orderId !== orderId) ||
      (report.accountId && report.accountId !== accountId)
    ) {
      issue(issues, 'cross-order-report', { reportId: report.id })
      return false
    }
    return true
  })
  const reportedTotals = unique(
    reports
      .filter((report) => !missing(report.reportedCount))
      .map((report) =>
        readCount(report.reportedCount, issues, { reportId: report.id })
      )
  )
  if (reportedTotals.length > 1)
    issue(issues, 'reported-count-conflict', { values: reportedTotals })
  const reportedCount = reportedTotals.length === 1 ? reportedTotals[0] : null
  if (
    (confirmedCount === null &&
      existingCartons.every((carton) => carton.count !== null)) ||
    (proposedCount === null &&
      newCartons.every((carton) => carton.count !== null))
  )
    issue(issues, 'count-overflow')
  const countDifferenceExact =
    reportedCount === null ||
    activeCartons.some((carton) => carton.count === null)
      ? null
      : subtractExact(
          String(reportedCount),
          addExact(...activeCartons.map((carton) => String(carton.count)))
        )
  const countDifference =
    countDifferenceExact === null ||
    BigInt(countDifferenceExact) < -BigInt(Number.MAX_SAFE_INTEGER) ||
    BigInt(countDifferenceExact) > BigInt(Number.MAX_SAFE_INTEGER)
      ? null
      : Number(countDifferenceExact)
  if (
    countDifferenceExact !== null &&
    compareExact(countDifferenceExact, '0') < 0
  )
    issue(issues, 'negative-carton-budget', {
      countDifference,
      countDifferenceExact,
    })
  // Additive attribution is a display allocation, separate from participation.
  for (const product of products) {
    product.additiveCartonCount = 0
    product.containingCartonCount = 0
    product.allocatedWeight = '0'
    product.allocatedVolume = '0'
    product.measurementAllocationBasis = 'allocated'
  }
  for (const carton of activeCartons) {
    const members = unique(carton.contents.map((part) => part.entryId))
      .filter((id) => source.has(id))
      .sort()
    const markMembers = groups.get(carton.mark?.groupId) ?? []
    const attributedEntryId =
      members.find((id) => markMembers.includes(id)) ?? members[0] ?? null
    carton.attributedEntryId = attributedEntryId
    const weights = members.map((id) => ({
      id,
      quantity: sum(
        carton.contents
          .filter((part) => part.entryId === id)
          .map((part) => part.quantity)
      ),
    }))
    const allocate = (value) =>
      value !== null &&
      weights.length &&
      weights.every((row) => row.quantity !== null) &&
      addExact(...weights.map((row) => row.quantity)) !== '0' &&
      !carton.unresolvedContents.length
        ? allocateExactDecimal(value, weights)
        : null
    const kg = allocate(carton.totalWeight),
      cbm = allocate(carton.totalVolume)
    carton.productMeasurementAllocations = members.map((entryId) => ({
      entryId,
      weight: kg?.find((row) => row.id === entryId)?.value ?? null,
      volume: cbm?.find((row) => row.id === entryId)?.value ?? null,
      basis: 'allocated',
    }))
    for (const entryId of members) {
      const product = products.find((row) => row.entryId === entryId)
      const participation =
        carton.count === 1 || carton.packingBasis === 'uniform'
          ? carton.count
          : null
      product.containingCartonCount =
        product.containingCartonCount === null || participation === null
          ? null
          : countTotal([
              { count: product.containingCartonCount },
              { count: participation },
            ])
      if (entryId === attributedEntryId)
        product.additiveCartonCount =
          product.additiveCartonCount === null || carton.count === null
            ? null
            : countTotal([
                { count: product.additiveCartonCount },
                { count: carton.count },
              ])
      const allocation = carton.productMeasurementAllocations.find(
        (row) => row.entryId === entryId
      )
      product.allocatedWeight =
        product.allocatedWeight === null || allocation.weight === null
          ? null
          : addExact(product.allocatedWeight, allocation.weight)
      product.allocatedVolume =
        product.allocatedVolume === null || allocation.volume === null
          ? null
          : addExact(product.allocatedVolume, allocation.volume)
    }
  }
  const weightCoverage = coverage(activeCartons, 'totalWeight'),
    volumeCoverage = coverage(activeCartons, 'totalVolume')
  for (const item of [weightCoverage, volumeCoverage]) {
    item.unassignedPieces = unassignedPieces
    if (unassignedPieces === null || compareExact(unassignedPieces, '0') > 0) {
      item.complete = false
      if (!activeCartons.length) item.knownSubtotal = null
    }
  }
  const suggestions = mixedSuggestions(
    reports,
    products,
    activeCartons,
    { accountId, orderId },
    draft,
    issues
  )
  for (const product of products)
    product.issues = issues.filter(
      (value) =>
        value.entryId === product.entryId ||
        value.cartonIds?.some((id) =>
          product.pattern.some((part) => part.cartonId === id)
        )
    )
  return {
    accountId,
    orderId,
    reportedCount,
    confirmedCount,
    proposedCount,
    unassignedPieces,
    unresolvedPieces: totals.unresolved,
    countDifference,
    countDifferenceExact,
    knownWeight: weightCoverage.knownSubtotal,
    weightCoverage,
    knownVolume: volumeCoverage.knownSubtotal,
    volumeCoverage,
    products,
    confirmed: [...original.values()],
    cartons,
    proposals,
    suggestions,
    unresolved: claims,
    unassigned: {
      quantity: unassignedPieces,
      products: products.map((row) => ({
        entryId: row.entryId,
        quantity: row.unassignedPieces,
      })),
    },
    coverage: { ...totals, unassigned: unassignedPieces, feasible },
    issues,
    projection: clone(input.projection ?? null),
  }
}

/** Bounded report-constrained subset search; alternatives remain choices, never allocations. */
function mixedSuggestions(reports, products, cartons, scope, draft, issues) {
  const result = []
  for (const constraint of reports.flatMap((report) =>
    (report.mixedConstraints ?? []).map((value) => ({
      ...value,
      reportId: report.id,
    }))
  )) {
    if (
      !constraint.id ||
      !constraint.evidence ||
      !Array.isArray(constraint.entryIds)
    ) {
      issue(issues, 'invalid-mixed-constraint', {
        constraintId: constraint.id ?? null,
      })
      continue
    }
    const total = readWhole(
      constraint.totalPieces,
      issues,
      'invalid-mixed-total',
      { constraintId: constraint.id }
    )
    if (total === null) continue
    const destination = constraint.destinationId
      ? cartons.find((carton) => carton.id === constraint.destinationId)
      : null
    if (
      constraint.destinationId &&
      (!destination ||
        destination.count !== 1 ||
        destination.unresolvedContents.length)
    ) {
      issue(issues, 'mixed-destination-unknown', {
        constraintId: constraint.id,
      })
      continue
    }
    const existing = destination
      ? sum(destination.contents.map((part) => part.quantity))
      : '0'
    if (existing === null) continue
    const remaining = subtractExact(total, existing)
    if (compareExact(remaining, '0') <= 0) continue
    const candidates = products
      .filter(
        (row) =>
          constraint.entryIds.includes(row.entryId) &&
          row.unassignedPieces !== null &&
          compareExact(row.unassignedPieces, '0') > 0
      )
      .sort((a, b) =>
        a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0
      )
    // Fixed bounds stop combinatorial work. Never truncate into an apparently unique answer.
    if (candidates.length > 12) {
      issue(issues, 'mixed-search-bound', { constraintId: constraint.id })
      continue
    }
    const choices = []
    for (let mask = 1; mask < 2 ** candidates.length; mask++) {
      const selected = candidates.filter((_, index) => mask & (1 << index))
      if (
        compareExact(
          addExact(...selected.map((row) => row.unassignedPieces)),
          remaining
        ) !== 0
      )
        continue
      if (!destination && selected.length < 2) continue
      choices.push(
        selected.map((row) => ({
          orderId: scope.orderId,
          entryId: row.entryId,
          quantity: row.unassignedPieces,
        }))
      )
      if (choices.length > 32) break
    }
    if (choices.length > 32) {
      issue(issues, 'mixed-search-bound', { constraintId: constraint.id })
      continue
    }
    const id = `mix:${JSON.stringify([scope.accountId, scope.orderId, constraint.reportId, constraint.id, remaining, choices])}`
    if (choices.length && !(draft.rejected ?? []).includes(id))
      result.push({
        id,
        kind: 'mixed',
        constraintId: constraint.id,
        reportId: constraint.reportId,
        destinationId: destination?.id ?? null,
        totalPieces: total,
        evidence: clone(constraint.evidence),
        choices,
        ambiguous: choices.length > 1,
        requiresConfirmation: true,
        physicalFit: 'unknown',
      })
  }
  return result
}

/** JSON recovery state. Raw invalid capacities remain here, never in physical facts. */
export function createReconciliationDraft(context = {}) {
  const scope = context.record ? owner(context) : context
  return {
    version: 1,
    ...(scope.accountId ? { accountId: scope.accountId } : {}),
    ...(scope.orderId ? { orderId: scope.orderId } : {}),
    capacities: {},
    cartons: [],
    rejected: [],
    nextId: 1,
    generation: 0,
  }
}
function normalizedDraft(value, context) {
  const scope = owner(context)
  if (value?.version !== undefined && value.version !== 1)
    throw new Error('Unsupported reconciliation draft version')
  if (
    (value?.orderId && value.orderId !== scope.orderId) ||
    (value?.accountId && value.accountId !== scope.accountId)
  )
    throw new Error('Draft belongs to another order')
  const result = {
    ...createReconciliationDraft(scope),
    ...clone(value ?? {}),
    accountId: scope.accountId,
    orderId: scope.orderId,
  }
  if (
    !Number.isSafeInteger(result.generation) ||
    result.generation < 0 ||
    result.generation >= Number.MAX_SAFE_INTEGER
  )
    throw new Error('Invalid draft generation')
  return result
}
function nextDraftId(draft) {
  if (
    !Number.isSafeInteger(draft.nextId) ||
    draft.nextId < 1 ||
    draft.nextId >= Number.MAX_SAFE_INTEGER
  )
    throw new Error('Invalid draft identity counter')
  let id
  do {
    id = `draft:${JSON.stringify([draft.accountId, draft.orderId, draft.nextId++])}`
  } while (draft.cartons.some((carton) => carton.id === id))
  return id
}
function storeDraftCarton(draft, carton) {
  const index = draft.cartons.findIndex((value) => value.id === carton.id)
  if (index < 0) draft.cartons.push(carton)
  else draft.cartons[index] = carton
  return carton
}
function manualCarton(draft, contents) {
  return {
    id: nextDraftId(draft),
    accountId: draft.accountId,
    orderId: draft.orderId,
    count: 1,
    packingBasis: 'exact',
    labelOrigin: 'internal',
    contents: clone(contents),
    unresolvedContents: [],
    draftKind: 'manual',
  }
}
function editableCarton(draft, plan, id, index, context) {
  const existing = draft.cartons.find((carton) => carton.id === id)
  if (existing) return existing
  const carton = plan.cartons.find((value) => value.id === id)
  if (!carton) throw new Error('Destination carton is no longer in this order')
  if (carton.state === 'confirmed') {
    if (carton.count !== 1)
      throw new Error('Choose one physical carton, not a combined aggregate')
    const original = (context.batches ?? []).find((value) => value.id === id)
    return storeDraftCarton(draft, {
      ...clone(original),
      draftKind: 'override',
      baseRevision: original.revision ?? 0,
      requiresDomainReview: true,
    })
  }
  if (carton.kind !== 'capacity') throw new Error('Choose a staged carton')
  if (
    carton.count > 1 &&
    (!Number.isSafeInteger(index) || index < 0 || index >= carton.count)
  )
    throw new Error(
      'Choose an explicit carton index from this uniform proposal'
    )
  const perCarton = carton.contents.map((part) => ({
    ...part,
    quantity: String(BigInt(part.quantity) / BigInt(carton.count)),
  }))
  const selected = manualCarton(draft, perCarton)
  storeDraftCarton(draft, selected)
  // Only the touched carton becomes a manual decision. The untouched uniform
  // remainder stays derived, so a later capacity edit recalculates it.
  return selected
}
function addContent(carton, orderId, entryId, quantity) {
  if (carton.removalRequested)
    throw new Error(
      'This carton has a pending removal; undo that change before placing goods'
    )
  if (carton.count !== 1)
    throw new Error('Choose one physical carton, not a combined aggregate')
  if ((carton.unresolvedContents ?? []).length)
    throw new Error(
      'Resolve this carton coverage before adding a guessed allocation'
    )
  const old = carton.contents.find(
    (part) => part.entryId === entryId && part.orderId === orderId
  )
  if (old) old.quantity = addExact(old.quantity, quantity)
  else carton.contents.push({ orderId, entryId, quantity })
  carton.packingBasis = 'exact'
}
function currentRemainder(plan, entryId) {
  const product = plan.products.find((row) => row.entryId === entryId)
  if (
    !product ||
    product.unassignedPieces === null ||
    compareExact(product.unassignedPieces, '0') <= 0
  )
    throw new Error('This product has no known positive unassigned remainder')
  return product.unassignedPieces
}
function applySingleCommand(draft, command, context) {
  if (!command || typeof command.type !== 'string')
    throw new Error('Choose a reconciliation command')
  if (
    (command.orderId && command.orderId !== draft.orderId) ||
    (command.accountId && command.accountId !== draft.accountId)
  )
    throw new Error('Command belongs to another order')
  if (command.type === 'compound') {
    if (!Array.isArray(command.commands) || command.commands.length > 1000)
      throw new Error('Invalid compound command')
    for (const child of command.commands) {
      if (child.type === 'compound')
        throw new Error('Nested compound commands are not supported')
      applySingleCommand(draft, child, context)
    }
    return
  }
  if (command.type === 'set-capacities') {
    const { snapshot } = owner(context),
      allowed = new Set(snapshot.items.map((item) => item.entryId))
    if (
      !command.values ||
      typeof command.values !== 'object' ||
      Array.isArray(command.values)
    )
      throw new Error('Provide source-keyed capacities')
    for (const [id, value] of Object.entries(command.values)) {
      if (!allowed.has(id))
        throw new Error('Capacity targets a product outside this order')
      if (
        value !== null &&
        typeof value !== 'string' &&
        !(typeof value === 'number' && Number.isSafeInteger(value))
      )
        throw new Error('Capacity cells must be raw text or a whole integer')
    }
    draft.capacities = { ...draft.capacities, ...clone(command.values) }
    return
  }
  const plan = reconcileOrder({ ...context, draft })
  if (command.type === 'separate') {
    const quantity = currentRemainder(plan, command.entryId)
    storeDraftCarton(
      draft,
      manualCarton(draft, [
        { orderId: draft.orderId, entryId: command.entryId, quantity },
      ])
    )
  } else if (command.type === 'place') {
    const quantity = currentRemainder(plan, command.entryId)
    const carton = editableCarton(
      draft,
      plan,
      command.destinationId,
      command.destinationIndex,
      context
    )
    addContent(carton, draft.orderId, command.entryId, quantity)
  } else if (command.type === 'move') {
    if (command.fromId === command.destinationId)
      throw new Error('Choose a different destination')
    const source = editableCarton(
      draft,
      plan,
      command.fromId,
      command.fromIndex,
      context
    )
    const part = source.contents.find(
      (value) =>
        value.entryId === command.entryId && value.orderId === draft.orderId
    )
    if (!part) throw new Error('Source carton does not contain this product')
    const quantity =
      command.quantity === undefined
        ? part.quantity
        : exactWhole(command.quantity, { positive: true })
    if (compareExact(quantity, part.quantity) > 0)
      throw new Error('Move exceeds the source carton quantity')
    // Resolve the second identity against the updated plan after any uniform split.
    const destination = editableCarton(
      draft,
      reconcileOrder({ ...context, draft }),
      command.destinationId,
      command.destinationIndex,
      context
    )
    addContent(destination, draft.orderId, command.entryId, quantity)
    part.quantity = subtractExact(part.quantity, quantity)
    source.contents = source.contents.filter((value) => value.quantity !== '0')
    if (!source.contents.length) {
      if ((context.batches ?? []).some((value) => value.id === source.id)) {
        source.removalRequested = true
        source.requiresDomainReview = true
      } else
        draft.cartons = draft.cartons.filter((value) => value.id !== source.id)
    }
  } else if (command.type === 'reject') {
    const staged = draft.cartons.find((carton) => carton.id === command.id)
    if (staged)
      draft.cartons = draft.cartons.filter((carton) => carton.id !== command.id)
    else if (
      !plan.proposals.some((value) => value.id === command.id) &&
      !plan.suggestions.some((value) => value.id === command.id)
    )
      throw new Error('This proposal is no longer current')
    draft.rejected = unique([...draft.rejected, command.id])
  } else if (command.type === 'accept-suggestion') {
    if (command.confirmed !== true)
      throw new Error('Operator confirmation of actual packing is required')
    const suggestion = plan.suggestions.find((value) => value.id === command.id)
    if (!suggestion) throw new Error('This suggestion is no longer current')
    if (
      !Number.isSafeInteger(command.choiceIndex) ||
      !suggestion.choices[command.choiceIndex]
    )
      throw new Error('Choose one explicit suggested arrangement')
    const contents = suggestion.choices[command.choiceIndex]
    if (suggestion.destinationId) {
      const destination = editableCarton(
        draft,
        plan,
        suggestion.destinationId,
        undefined,
        context
      )
      for (const part of contents)
        addContent(destination, draft.orderId, part.entryId, part.quantity)
    } else
      storeDraftCarton(draft, {
        ...manualCarton(draft, contents),
        evidence: clone(suggestion.evidence),
        acceptedSuggestionId: suggestion.id,
      })
  } else throw new Error('Unknown reconciliation command')
}

/** One immutable atomic draft transition. Only the domain repository can confirm facts. */
export function applyReconciliationCommand(value, command, context) {
  const draft = normalizedDraft(value, context)
  if (
    command.expectedGeneration !== undefined &&
    command.expectedGeneration !== draft.generation
  )
    throw new Error(
      'The reconciliation draft changed; retain and review the current edit'
    )
  const before = reconcileOrder({ ...context, draft })
  applySingleCommand(draft, command, context)
  const after = reconcileOrder({ ...context, draft })
  if (
    command.type !== 'set-capacities' &&
    after.coverage.feasible === false &&
    before.coverage.feasible !== false
  )
    throw new Error(
      'Command would duplicate or overallocate covered source goods'
    )
  const newlyInvalid = after.products.some(
    (product) =>
      product.availableForPacking !== null &&
      compareExact(product.availableForPacking, '0') < 0 &&
      !before.products.some(
        (previous) =>
          previous.entryId === product.entryId &&
          previous.availableForPacking !== null &&
          compareExact(
            previous.availableForPacking,
            product.availableForPacking
          ) <= 0
      )
  )
  if (newlyInvalid) throw new Error('Command would overallocate source goods')
  draft.generation++
  return draft
}

function jsonCopy(value) {
  const text = JSON.stringify(value)
  if (!text || new TextEncoder().encode(text).byteLength > 8 * 1024 * 1024)
    throw new Error('Reconciliation history exceeds its recovery size limit')
  return JSON.parse(text)
}
export function createReconciliationHistory(draft = {}) {
  return { past: [], present: jsonCopy(draft), future: [] }
}
export function commitReconciliationHistory(history, command, context) {
  const result = jsonCopy(history)
  const next = applyReconciliationCommand(result.present, command, context)
  result.past.push(result.present)
  if (result.past.length > 50) result.past.shift()
  result.present = next
  result.future = []
  return jsonCopy(result)
}
export function undoReconciliationHistory(history) {
  const result = jsonCopy(history)
  if (result.past.length) {
    result.future.push(result.present)
    result.present = result.past.pop()
  }
  return result
}
export function redoReconciliationHistory(history) {
  const result = jsonCopy(history)
  if (result.future.length) {
    result.past.push(result.present)
    result.present = result.future.pop()
  }
  return result
}
