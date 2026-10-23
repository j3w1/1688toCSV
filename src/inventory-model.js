import {
  cartonBatchMetrics,
  cartonBatchMark,
  cartonDecimal,
} from './carton-batches.js'

export const MAX_OPERATIONAL_CARTONS = 10_000
export const orderKey = (value) =>
  JSON.stringify([
    value.accountId || value.snapshot?.accountId || 'local',
    value.orderId || value.snapshot?.orderId,
  ])
export const productKey = (accountId, orderId, entryId) =>
  JSON.stringify([accountId || 'local', orderId, entryId])
export function inventoryError(code, message, detail = {}) {
  return Object.assign(new Error(message), { code, detail })
}
export function wholeUnits(value, label = 'Quantity') {
  const text = String(value ?? '')
  if (!/^\d+$/.test(text) || text.length > 30)
    throw inventoryError(
      'INVALID_QUANTITY',
      `${label} must be an exact nonnegative whole number.`
    )
  return BigInt(text)
}
export function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export function sourceRevision(record, preparation) {
  // Exact equality, not a lossy quantity/hash signature. This is order scoped
  // and used at transaction boundaries, never a whole-library keystroke scan.
  return stableValue({
    snapshot: record.snapshot,
    unitsPerCarton: record.unitsPerCarton,
    inventoryDispositions: record.inventoryDispositions,
    purchaseDateResolution: record.purchaseDateResolution,
    supplierIdentityResolution: record.supplierIdentityResolution,
    supplierCodeIdentityReview: record.supplierCodeIdentityReview,
    inventoryDispositionClears: record.inventoryDispositionClears,
    productWorkflow: record.productWorkflow,
    additionalCharges: record.additionalCharges,
    paymentLinks: record.paymentLinks,
    preparationRevision: preparation?.revision || 0,
  })
}
export function decimalTotal(values) {
  const parts = values.map((value) => cartonDecimal(value).split('.'))
  const scale = Math.max(
    0,
    ...parts.map(([, fraction = '']) => fraction.length)
  )
  const total = parts.reduce(
    (sum, [whole, fraction = '']) =>
      sum + BigInt((whole || '0') + fraction.padEnd(scale, '0')),
    0n
  )
  const digits = String(total).padStart(scale + 1, '0')
  return cartonDecimal(
    scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits
  )
}

export function eligibleOrderItems(record, records = [record]) {
  const paymentOnly = new Set()
  for (const target of records) {
    if (target.snapshot.accountId !== record.snapshot.accountId) continue
    for (const link of target.paymentLinks || []) {
      if (link.sourceOrderId !== record.snapshot.orderId) continue
      if (link.sourceEntryId === undefined)
        for (const item of record.snapshot.items) paymentOnly.add(item.entryId)
      else paymentOnly.add(link.sourceEntryId)
    }
  }
  return record.snapshot.items.map((item) => {
    const issues = []
    let purchased
    try {
      purchased = wholeUnits(item.quantity)
    } catch (error) {
      issues.push(error.message)
      purchased = null
    }
    const disposition = record.inventoryDispositions?.[item.entryId]
    let excluded = 0n
    if (
      paymentOnly.has(item.entryId) ||
      ['non-goods', 'fee', 'payment-only'].includes(disposition?.kind)
    )
      excluded = purchased || 0n
    else if (disposition?.kind === 'canceled') {
      try {
        excluded = wholeUnits(disposition.quantity, 'Canceled quantity')
      } catch (error) {
        issues.push(error.message)
      }
    }
    if (
      disposition &&
      (!disposition.reason?.trim() ||
        !['non-goods', 'fee', 'payment-only', 'canceled'].includes(
          disposition.kind
        ))
    )
      issues.push('Review the documented inventory exclusion.')
    if (purchased !== null && excluded > purchased)
      issues.push('Canceled quantity exceeds the purchase quantity.')
    const legacyExclusion =
      record.packingExcludedEntryIds?.includes(item.entryId) &&
      !disposition &&
      !paymentOnly.has(item.entryId) &&
      !record.inventoryDispositionClears?.includes(item.entryId)
    if (legacyExclusion)
      issues.push(
        'Review the legacy packing exclusion; it is not evidence that these goods shipped or were canceled.'
      )
    return {
      item,
      entryId: item.entryId,
      purchased: purchased === null ? null : String(purchased),
      eligible: purchased === null ? null : String(purchased - excluded),
      excluded: String(excluded),
      dispositionKind: disposition?.kind || null,
      paymentOnly: paymentOnly.has(item.entryId),
      reason:
        disposition?.reason ||
        (paymentOnly.has(item.entryId) ? 'Reviewed payment source' : ''),
      issues,
      legacyExclusion: !!legacyExclusion,
    }
  })
}

export function batchOrderIds(batch) {
  return [
    ...new Set(
      [
        batch.orderId,
        ...(batch.contents || []).map((item) => item.orderId),
        ...(batch.groups || []).map((group) => group.orderId),
        batch.mark?.orderId,
      ].filter(Boolean)
    ),
  ]
}
export function batchNeedsLegacyReview(batch) {
  return (
    !batch.legacyResolution &&
    (batchOrderIds(batch).length !== 1 ||
      Number(batch.loaded || 0) > 0 ||
      !!batch.legacyReview)
  )
}
export function physicalUnitId(batchId, index) {
  return `unit:${encodeURIComponent(batchId)}:${index + 1}`
}
export function batchPackingBasis(batch) {
  if (['exact', 'uniform', 'aggregate'].includes(batch.packingBasis))
    return batch.packingBasis
  // Old multi-box totals do not establish a per-box distribution.
  return batch.count === 1 ? 'exact' : 'aggregate'
}
export function physicalUnits(batch) {
  if (batch.deletedAt) return []
  if (!Number.isSafeInteger(batch.count) || batch.count < 0)
    throw inventoryError(
      'CARTON_COUNT_UNKNOWN',
      'Resolve the physical carton count before loading.',
      { batchId: batch.id }
    )
  if (batch.count > MAX_OPERATIONAL_CARTONS)
    throw inventoryError(
      'CARTON_LIMIT',
      'This carton set needs review before individual loading; its reported total is retained.',
      { batchId: batch.id, count: batch.count }
    )
  const basis = batchPackingBasis(batch)
  if (
    basis === 'uniform' &&
    (batch.contents || []).some(
      (item) => wholeUnits(item.quantity) % BigInt(batch.count || 1)
    )
  )
    throw inventoryError(
      'UNIFORM_CONTENTS_INVALID',
      'Uniform carton contents must be explicitly equal whole quantities.',
      { batchId: batch.id }
    )
  return Array.from({ length: batch.count }, (_, position) => {
    const index = batch.entitlementIndices?.[position] ?? position
    const known = batch.unitContents?.[index],
      measurement = batch.unitMeasurements?.[index] || {},
      dimensions = Object.fromEntries(
        ['len', 'wid', 'ht'].map((field) => [
          field,
          measurement[field] ?? batch[field] ?? '',
        ])
      ),
      unitMetrics = cartonBatchMetrics({
        ...batch,
        ...measurement,
        ...dimensions,
        count: 1,
      })
    return {
      id: physicalUnitId(batch.id, index),
      cartonId: physicalUnitId(batch.id, index),
      batchId: batch.id,
      accountId: batch.accountId || 'local',
      orderId: batch.orderId || batchOrderIds(batch)[0],
      index,
      reference:
        batch.unitLabels?.[index] ||
        batch.cartonNumber ||
        `Internal ${batch.id} / ${index + 1}`,
      labelOrigin: batch.unitLabels?.[index]
        ? 'reported'
        : batch.cartonNumber
          ? batch.labelOrigin || 'reported'
          : 'internal',
      quantity: known
        ? String(known.reduce((sum, row) => sum + wholeUnits(row.quantity), 0n))
        : basis === 'uniform' &&
            !batch.contentsUnknown &&
            !batch.unresolvedContents?.length
          ? String(
              (batch.contents || []).reduce(
                (sum, row) => sum + wholeUnits(row.quantity),
                0n
              ) / BigInt(batch.count)
            )
          : batch.count === 1 &&
              !batch.contentsUnknown &&
              (batch.unresolvedContents || []).every(
                (claim) => claim.quantity !== null
              )
            ? String(
                [
                  ...(batch.contents || []),
                  ...(batch.unresolvedContents || []),
                ].reduce((sum, row) => sum + wholeUnits(row.quantity), 0n)
              )
            : batch.provenance?.contentClaims?.length &&
                batch.provenance.contentClaims.every(
                  (claim) =>
                    claim.basis === 'per-carton' && claim.quantity !== null
                )
              ? String(
                  batch.provenance.contentClaims.reduce(
                    (sum, row) => sum + wholeUnits(row.quantity),
                    0n
                  )
                )
              : null,
      packingBasis: basis,
      batchCount: batch.count,
      revision: batch.revision,
      contents: known
        ? structuredClone(known)
        : basis === 'aggregate' ||
            batch.contentsUnknown ||
            batch.unresolvedContents?.length
          ? null
          : (batch.contents || []).map((item) => ({
              ...item,
              quantity:
                basis === 'uniform'
                  ? String(wholeUnits(item.quantity) / BigInt(batch.count))
                  : item.quantity,
            })),
      unresolvedContents: structuredClone(batch.unresolvedContents || []),
      weight:
        measurement.weight !== undefined
          ? cartonDecimal(measurement.weight) || null
          : batch.weightBasis === 'batch' && batch.count !== 1
            ? null
            : batch.weight === '' || batch.weight === undefined
              ? null
              : cartonDecimal(batch.weight),
      volume: Object.values(dimensions).every(Boolean)
        ? unitMetrics.volumePerCarton
        : measurement.suppliedCbm !== undefined
          ? cartonDecimal(measurement.suppliedCbm) || null
          : batch.volumeBasis === 'batch' && !batch.len && batch.count !== 1
            ? null
            : unitMetrics.volumePerCarton === ''
              ? null
              : unitMetrics.volumePerCarton,
      ...dimensions,
      mark: cartonBatchMark(batch),
      needsReview: !!batch.needsReview || batchNeedsLegacyReview(batch),
    }
  })
}

/** Exact feasibility only. Its arbitrary flow is never returned as physical contents. */
export function unresolvedCoverageFeasible(capacities, claims, minimums = []) {
  if (minimums.length)
    return coverageWithUnitMinimums(capacities, claims, minimums)
  const entries = [...capacities.keys()],
    source = 0,
    firstClaim = 1,
    firstEntry = firstClaim + claims.length,
    sink = firstEntry + entries.length
  const graph = Array.from({ length: sink + 1 }, () => [])
  const edge = (from, to, capacity) => {
    const forward = { to, capacity, reverse: graph[to].length },
      backward = { to: from, capacity: 0n, reverse: graph[from].length }
    graph[from].push(forward)
    graph[to].push(backward)
  }
  let wanted = 0n
  for (const [index, claim] of claims.entries()) {
    const quantity = wholeUnits(claim.quantity)
    wanted += quantity
    edge(source, firstClaim + index, quantity)
    for (const entryId of new Set(claim.entryIds || [])) {
      const target = entries.indexOf(entryId)
      if (target >= 0) edge(firstClaim + index, firstEntry + target, quantity)
    }
  }
  for (const [index, entryId] of entries.entries()) {
    const quantity = capacities.get(entryId)
    if (quantity < 0n) return false
    edge(firstEntry + index, sink, quantity)
  }
  let flow = 0n
  for (;;) {
    const path = Array(graph.length).fill(null),
      queue = [source]
    path[source] = [-1, -1]
    for (let at = 0; at < queue.length && path[sink] === null; at++)
      for (const [index, link] of graph[queue[at]].entries())
        if (link.capacity > 0n && path[link.to] === null) {
          path[link.to] = [queue[at], index]
          queue.push(link.to)
        }
    if (path[sink] === null) return flow === wanted
    let quantity = wanted - flow
    for (let at = sink; at !== source; ) {
      const [from, index] = path[at]
      if (graph[from][index].capacity < quantity)
        quantity = graph[from][index].capacity
      at = from
    }
    if (!quantity) return flow === wanted
    for (let at = sink; at !== source; ) {
      const [from, index] = path[at],
        link = graph[from][index]
      link.capacity -= quantity
      graph[at][link.reverse].capacity += quantity
      at = from
    }
    flow += quantity
  }
}

export function assertOrderCartonConservation(
  record,
  batches,
  { records = [record], allowLegacy = false } = {}
) {
  const accountId = record.snapshot.accountId || 'local',
    orderId = record.snapshot.orderId
  const capacities = new Map(
    eligibleOrderItems(record, records).map((entry) => [
      entry.entryId,
      entry.eligible === null ? 0n : BigInt(entry.eligible),
    ])
  )
  const claims = [],
    minimums = []
  for (const batch of batches) {
    if (
      batch.deletedAt ||
      (batch.accountId || 'local') !== accountId ||
      !batchOrderIds(batch).includes(orderId)
    )
      continue
    const owners = batchOrderIds(batch)
    if (owners.length !== 1) {
      if (!(allowLegacy && batchNeedsLegacyReview(batch)))
        throw inventoryError(
          'CARTON_OWNERSHIP',
          'A carton can contain products from only one purchase order.',
          { batchId: batch.id, orderIds: owners }
        )
    }
    if (batch.orderId && batch.orderId !== orderId)
      throw inventoryError(
        'CARTON_OWNERSHIP',
        'Carton purchase ownership changed.',
        { batchId: batch.id }
      )
    for (const item of batch.contents || []) {
      if (allowLegacy && item.orderId !== orderId) continue
      if (!capacities.has(item.entryId))
        throw inventoryError(
          'CARTON_SOURCE_MISSING',
          'A carton references a product outside its purchase.',
          { batchId: batch.id, entryId: item.entryId }
        )
      capacities.set(
        item.entryId,
        capacities.get(item.entryId) - wholeUnits(item.quantity)
      )
    }
    const units = new Map()
    for (const rows of Object.values(batch.unitContents || {}))
      for (const row of rows) {
        if (row.orderId !== orderId || !capacities.has(row.entryId))
          throw inventoryError(
            'CARTON_SOURCE_MISSING',
            'Known physical unit contents belong to another purchase.'
          )
        units.set(
          row.entryId,
          (units.get(row.entryId) || 0n) + wholeUnits(row.quantity)
        )
      }
    for (const [entryId, quantity] of units) {
      const covered = (batch.contents || [])
        .filter((row) => row.entryId === entryId && row.orderId === orderId)
        .reduce((sum, row) => sum + wholeUnits(row.quantity), 0n)
      if (quantity > covered)
        minimums.push({
          batchId: batch.id,
          entryId,
          quantity: String(quantity - covered),
        })
    }
    if (batch.contentsUnknown && !(batch.unresolvedContents || []).length)
      claims.push({
        batchId: batch.id,
        entryIds: [...capacities.keys()],
        quantity: null,
      })
    for (const claim of batch.unresolvedContents || []) {
      const entryIds = claim.entryIds?.length
        ? claim.entryIds
        : [...capacities.keys()]
      if (entryIds.some((id) => !capacities.has(id)))
        throw inventoryError(
          'CARTON_SOURCE_MISSING',
          'Unresolved content candidates belong to another purchase.',
          { batchId: batch.id }
        )
      claims.push({ ...claim, entryIds, batchId: batch.id })
    }
  }
  if (
    !unresolvedCoverageFeasible(
      capacities,
      minimums.length
        ? claims
        : claims.filter((claim) => claim.quantity !== null),
      minimums
    )
  )
    throw inventoryError(
      'CARTON_OVERALLOCATION',
      'Confirmed and unresolved carton contents exceed the eligible purchase quantities.',
      { orderId }
    )
  return true
}

export function effectiveContainerRevision(container) {
  return (
    (container.revisions || []).find(
      (revision) => revision.revisionId === container.effectiveRevisionId
    ) ||
    (container.revisions || []).find(
      (revision) => revision.revision === container.effectiveRevision
    ) ||
    null
  )
}
export function effectiveShipments(containers, { exceptContainerId } = {}) {
  return containers
    .filter((container) => container.id !== exceptContainerId)
    .flatMap((container) => {
      const manifest = effectiveContainerRevision(container)
      return manifest ? [{ container, manifest }] : []
    })
}
export function committedCartonOwners(containers, options) {
  const owners = new Map()
  for (const { container, manifest } of effectiveShipments(containers, options))
    for (const carton of manifest.cartons || []) {
      if (owners.has(carton.id || carton.cartonId))
        throw inventoryError(
          'DOUBLE_SHIPMENT',
          'A physical carton is committed in more than one container.',
          { cartonId: carton.id || carton.cartonId }
        )
      owners.set(carton.id || carton.cartonId, {
        containerId: container.id,
        containerName: container.name,
        revisionId: manifest.revisionId,
        batchId: carton.batchId,
      })
    }
  return owners
}
export function reservedOrderOwners(containers, { exceptContainerId } = {}) {
  const owners = new Map()
  for (const container of containers) {
    if (
      container.id === exceptContainerId ||
      !['draft', 'amending'].includes(container.status)
    )
      continue
    for (const member of container.draft?.orders || []) {
      if (member.reserveRemainder === false) continue
      const key = orderKey(member)
      if (owners.has(key))
        throw inventoryError(
          'DOUBLE_RESERVATION',
          'An order remainder is reserved in more than one draft container.',
          { orderId: member.orderId }
        )
      owners.set(key, {
        containerId: container.id,
        containerName: container.name,
      })
    }
  }
  return owners
}

export function projectBacklog(
  { records = [], preparations = [], batches = [], containers = [] },
  { accountId = 'local', exceptContainerId, includeFullyShipped = false } = {}
) {
  const shipments = effectiveShipments(containers, { exceptContainerId })
  const committed = committedCartonOwners(containers, { exceptContainerId })
  const reserved = reservedOrderOwners(containers, { exceptContainerId })
  const shipped = new Map(),
    usedCounts = new Map()
  for (const owner of committed.values())
    usedCounts.set(owner.batchId, (usedCounts.get(owner.batchId) || 0) + 1)
  for (const { manifest } of shipments)
    for (const row of manifest.products || []) {
      const key = productKey(row.accountId, row.orderId, row.entryId)
      shipped.set(key, (shipped.get(key) || 0n) + wholeUnits(row.quantity))
    }
  const orders = []
  let knownCartons = 0n,
    remainingPieces = 0n,
    unknownOrders = 0
  for (const record of records) {
    if ((record.snapshot.accountId || 'local') !== accountId) continue
    const orderId = record.snapshot.orderId,
      key = orderKey(record)
    const own = batches.filter(
      (batch) =>
        (!batch.deletedAt || batchNeedsLegacyReview(batch)) &&
        (batch.accountId || 'local') === accountId &&
        batchOrderIds(batch).includes(orderId)
    )
    const issues = []
    const items = eligibleOrderItems(record, records).map((entry) => {
      const loaded =
        shipped.get(productKey(accountId, orderId, entry.entryId)) || 0n
      const remaining =
        entry.eligible === null ? null : BigInt(entry.eligible) - loaded
      const legacy = own.some(
        (batch) =>
          batchNeedsLegacyReview(batch) &&
          (batch.contents || []).some(
            (content) =>
              content.orderId === orderId && content.entryId === entry.entryId
          )
      )
      issues.push(...entry.issues)
      if (remaining !== null && remaining < 0n)
        issues.push(
          'Committed shipment quantity exceeds the current eligible source quantity.'
        )
      if (legacy)
        issues.push(
          'Historical loading or cross-order carton contents need review before availability is known.'
        )
      return {
        ...entry,
        loaded: String(loaded),
        remaining: remaining === null || legacy ? null : String(remaining),
        legacyReview: legacy,
      }
    })
    const eligible = items.reduce(
      (sum, entry) =>
        sum + (entry.eligible === null ? 0n : BigInt(entry.eligible)),
      0n
    )
    const loaded = items.reduce((sum, entry) => sum + BigInt(entry.loaded), 0n)
    const quantityKnown = items.every((entry) => entry.remaining !== null)
    const quantity = items.reduce(
      (sum, entry) =>
        sum + (entry.remaining === null ? 0n : BigInt(entry.remaining)),
      0n
    )
    const preparation = preparations.find((prep) => orderKey(prep) === key)
    const sizeMappingEntryIds = [
      ...new Set(
        (preparation?.groups || [])
          .flatMap((group) =>
            group.variants
              .filter((variant) => variant.needsSizeMapping)
              .flatMap((variant) => variant.entryIds)
          )
          .filter((entryId) =>
            items.some(
              (entry) => entry.entryId === entryId && entry.remaining !== '0'
            )
          )
      ),
    ]
    const warnings = sizeMappingEntryIds.map((entryId) => ({
      code: 'SIZE_MAPPING_REQUIRED',
      severity: 'warning',
      accountId,
      orderId,
      entryId,
      message: 'Map this variant size before generating labels',
    }))
    if (eligible <= 0n && !issues.length) continue
    if (
      !includeFullyShipped &&
      quantity === 0n &&
      quantityKnown &&
      !issues.length
    )
      continue
    let count = 0,
      countKnown = !!own.length
    for (const batch of own) {
      if (!Number.isSafeInteger(batch.count) || batchNeedsLegacyReview(batch)) {
        countKnown = false
        continue
      }
      count += batch.count - (usedCounts.get(batch.id) || 0)
    }
    const packed = own.reduce(
      (sum, batch) =>
        sum +
        (batch.contents || [])
          .filter((content) => content.orderId === orderId)
          .reduce(
            (total, content) => total + wholeUnits(content.quantity),
            0n
          ) +
        (batch.unresolvedContents || []).reduce(
          (total, claim) =>
            total + (claim.quantity === null ? 0n : wholeUnits(claim.quantity)),
          0n
        ),
      0n
    )
    if (
      packed < eligible ||
      own.some(
        (batch) =>
          batch.needsReview ||
          batch.contentsUnknown ||
          batch.unresolvedContents?.some((claim) => claim.quantity === null)
      )
    )
      countKnown = false
    const status = !quantityKnown
      ? 'needs-review'
      : loaded === 0n
        ? 'not-shipped'
        : quantity > 0n
          ? 'partially-shipped'
          : 'fully-shipped'
    const readiness =
      issues.length || own.some((batch) => batch.needsReview)
        ? 'needs-reconciliation'
        : countKnown
          ? 'ready'
          : 'awaiting-report'
    orders.push({
      accountId,
      orderId,
      record,
      preparation,
      sizeMappingEntryIds,
      warnings,
      items,
      purchasedQuantity: String(
        items.reduce(
          (sum, entry) =>
            sum + (entry.purchased === null ? 0n : BigInt(entry.purchased)),
          0n
        )
      ),
      eligibleQuantity: String(eligible),
      loadedQuantity: String(loaded),
      remainingQuantity: quantityKnown ? String(quantity) : null,
      knownRemainingQuantity: String(quantity),
      remainingQuantityKnown: quantityKnown,
      knownCartons: count,
      cartons: countKnown ? count : null,
      cartonsUnknown: !countKnown,
      shipmentStatus: status,
      packingReadiness: readiness,
      reservation: reserved.get(key) || null,
      carryover: loaded > 0n && (!quantityKnown || quantity > 0n),
      issues: [...new Set(issues)],
    })
    knownCartons += BigInt(count)
    remainingPieces += quantity
    if (!countKnown) unknownOrders++
  }
  orders.sort(
    (a, b) =>
      Number(b.carryover) - Number(a.carryover) ||
      Number(b.packingReadiness === 'ready') -
        Number(a.packingReadiness === 'ready') ||
      String(b.record.snapshot.purchasedAt || '').localeCompare(
        String(a.record.snapshot.purchasedAt || '')
      ) ||
      a.orderId.localeCompare(b.orderId)
  )
  return {
    orders,
    totals: {
      orders: orders.length,
      cartons: Number(knownCartons),
      quantity: String(remainingPieces),
      quantityComplete: orders.every((order) => order.remainingQuantityKnown),
      unknownQuantityOrders: orders.filter(
        (order) => !order.remainingQuantityKnown
      ).length,
      unknownCartonOrders: unknownOrders,
    },
    issues: orders.flatMap((order) =>
      order.issues.map((message) => ({ orderId: order.orderId, message }))
    ),
  }
}

/** Feasibility circulation: known unit facts impose minima, never a saved split. */
function coverageWithUnitMinimums(capacities, claims, minimums) {
  const source = 0,
    sink = 1,
    graph = [[], []],
    balance = [0n, 0n],
    node = () => {
      graph.push([])
      balance.push(0n)
      return graph.length - 1
    }
  const entries = new Map(
    [...capacities].map(([id, capacity]) => [id, { node: node(), capacity }])
  )
  if ([...capacities.values()].some((quantity) => quantity < 0n)) return false
  const total = [...capacities.values()].reduce(
      (sum, value) => sum + value,
      0n
    ),
    batchEntries = new Map()
  const edge = (from, to, capacity) => {
    const a = { to, capacity, reverse: graph[to].length },
      b = { to: from, capacity: 0n, reverse: graph[from].length }
    graph[from].push(a)
    graph[to].push(b)
  }
  const bounded = (from, to, lower, upper) => {
    if (lower > upper) return false
    edge(from, to, upper - lower)
    balance[from] -= lower
    balance[to] += lower
    return true
  }
  const batchNode = (batchId, entryId) => {
    const key = JSON.stringify([batchId, entryId])
    if (!batchEntries.has(key))
      batchEntries.set(key, { node: node(), batchId, entryId })
    return batchEntries.get(key).node
  }
  if (
    claims.reduce((sum, claim) => sum + (claim.entryIds?.length || 0), 0) >
    1000000
  )
    throw inventoryError(
      'COVERAGE_LIMIT',
      'Review this bounded coverage set before confirming it.'
    )
  for (const claim of claims) {
    const q = claim.quantity === null ? null : wholeUnits(claim.quantity),
      id = node()
    if (!bounded(source, id, q || 0n, q === null ? total : q)) return false
    for (const entryId of new Set(claim.entryIds || []))
      if (entries.has(entryId))
        edge(id, batchNode(claim.batchId, entryId), q === null ? total : q)
  }
  for (const minimum of minimums) batchNode(minimum.batchId, minimum.entryId)
  for (const value of batchEntries.values()) {
    const minimum = minimums
        .filter(
          (row) =>
            row.batchId === value.batchId && row.entryId === value.entryId
        )
        .reduce((sum, row) => sum + wholeUnits(row.quantity), 0n),
      entry = entries.get(value.entryId)
    if (!entry || !bounded(value.node, entry.node, minimum, total)) return false
  }
  for (const entry of entries.values()) edge(entry.node, sink, entry.capacity)
  edge(sink, source, total)
  const superSource = node(),
    superSink = node()
  let required = 0n
  for (let index = 0; index < superSource; index++) {
    if (balance[index] > 0n) {
      edge(superSource, index, balance[index])
      required += balance[index]
    } else if (balance[index] < 0n) edge(index, superSink, -balance[index])
  }
  let flow = 0n
  while (flow < required) {
    const paths = Array(graph.length).fill(null),
      queue = [superSource]
    paths[superSource] = [-1, -1]
    for (let at = 0; at < queue.length && !paths[superSink]; at++)
      graph[queue[at]].forEach((edge, index) => {
        if (edge.capacity > 0n && !paths[edge.to]) {
          paths[edge.to] = [queue[at], index]
          queue.push(edge.to)
        }
      })
    if (!paths[superSink]) return false
    let amount = required - flow
    for (let at = superSink; at !== superSource; ) {
      const [from, index] = paths[at]
      if (graph[from][index].capacity < amount)
        amount = graph[from][index].capacity
      at = from
    }
    for (let at = superSink; at !== superSource; ) {
      const [from, index] = paths[at],
        link = graph[from][index]
      link.capacity -= amount
      graph[at][link.reverse].capacity += amount
      at = from
    }
    flow += amount
  }
  return true
}
