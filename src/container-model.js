import { purchaseSupplierForCodes } from './purchase-codes.js'
import {
  physicalUnits,
  batchOrderIds,
  batchNeedsLegacyReview,
  orderKey,
  productKey,
  sourceRevision,
  wholeUnits,
  stableValue,
  inventoryError,
  eligibleOrderItems,
  effectiveShipments,
  committedCartonOwners,
  reservedOrderOwners,
  decimalTotal,
} from './inventory-model.js'
import { cartonBatchMetrics } from './carton-batches.js'
import { shipmentMoney } from './shipment-money.js'
import {
  validatePackingPreferences,
  barcodeValue,
  variantMaterial,
} from './packing-model.js'
import { moneyToCents, centsToMoney } from './money.js'

const clone = (value) => structuredClone(value)
export function orderScopeState(state, reference) {
  const key = orderKey(reference),
    record = state.records.find((record) => orderKey(record) === key)
  if (!record)
    throw inventoryError(
      'ORDER_MISSING',
      'This purchase is no longer in the library.',
      reference
    )
  return {
    record,
    preparation:
      state.preparations.find((prep) => orderKey(prep) === key) || null,
    batches: state.batches.filter(
      (batch) =>
        batch.accountId === (reference.accountId || 'local') &&
        batchOrderIds(batch).includes(reference.orderId)
    ),
  }
}
export function reconciliationRevisions(state, reference) {
  const { record, preparation, batches } = orderScopeState(state, reference)
  return {
    source: sourceRevision(record, preparation),
    observedAt: record.snapshot.observedAt,
    preparation: preparation?.revision || 0,
    cartons: Object.fromEntries(
      batches.map((batch) => [batch.id, batch.revision])
    ),
    reports: Object.fromEntries(
      (state.reports || [])
        .filter(
          (report) =>
            orderKey(report.orderKey || report) === orderKey(reference)
        )
        .map((report) => [report.id, report.revision])
    ),
  }
}
export function assertReconciliationRevisions(state, reference, expected) {
  const { amendmentContext, ...base } = expected || {}
  if (amendmentContext) {
    const container = state.containers.find(
      (container) => container.id === amendmentContext.containerId
    )
    if (
      !container?.amendment ||
      container.amendment.epoch !== amendmentContext.epoch
    )
      throw inventoryError(
        'AMENDMENT_CONTEXT_CONFLICT',
        'This amendment ended or changed; retain the draft.'
      )
  }
  if (
    !expected ||
    stableValue(base) !== stableValue(reconciliationRevisions(state, reference))
  )
    throw inventoryError(
      'ORDER_REVISION_CONFLICT',
      'This source, preparation, report or carton list changed. Keep the draft and reload its context.',
      reference
    )
}
export function captureContainerOrder(
  state,
  reference,
  containerId,
  { reserveRemainder = true } = {}
) {
  const accountId = reference.accountId || 'local',
    orderId = reference.orderId
  const owner = reservedOrderOwners(state.containers || [], {
    exceptContainerId: containerId,
  }).get(orderKey({ accountId, orderId }))
  if (owner && reserveRemainder)
    throw inventoryError(
      'ORDER_RESERVED',
      'This order remainder is reserved by another container.',
      { ...owner, orderId }
    )
  const { record, preparation, batches } = orderScopeState(state, {
    accountId,
    orderId,
  })
  const committed = committedCartonOwners(state.containers || [], {
    exceptContainerId: containerId,
  })
  const previous = new Map()
  for (const { manifest } of effectiveShipments(state.containers || [], {
    exceptContainerId: containerId,
  }))
    for (const row of manifest.products || [])
      if (orderKey(row) === orderKey({ accountId, orderId }))
        previous.set(
          row.entryId,
          (previous.get(row.entryId) || 0n) + wholeUnits(row.quantity)
        )
  const availableBefore = eligibleOrderItems(record, state.records).map(
    (row) => ({
      entryId: row.entryId,
      quantity:
        row.eligible === null ||
        row.legacyExclusion ||
        batches.some(
          (batch) =>
            batchNeedsLegacyReview(batch) &&
            (batch.contents.some(
              (item) => item.entryId === row.entryId && item.orderId === orderId
            ) ||
              !batch.contents.length)
        )
          ? null
          : String(BigInt(row.eligible) - (previous.get(row.entryId) || 0n)),
    })
  )
  const cartons = [],
    warnings = []
  for (const batch of batches.filter((batch) => !batch.deletedAt)) {
    if (batchNeedsLegacyReview(batch)) {
      warnings.push({
        code: 'LEGACY_REVIEW',
        batchId: batch.id,
        message:
          'Historical loading or cross-order evidence needs explicit resolution.',
      })
      continue
    }
    if (batch.count === null) {
      warnings.push({ code: 'CARTON_COUNT_UNKNOWN', batchId: batch.id })
      continue
    }
    for (const unit of physicalUnits(batch))
      if (!committed.has(unit.id))
        cartons.push({ ...unit, count: 1, state: 'unconfirmed' })
  }
  return {
    accountId,
    orderId,
    reserveRemainder,
    record: clone(record),
    preparation: clone(preparation),
    batches: clone(batches),
    cartons,
    availableBefore,
    revisions: reconciliationRevisions(state, { accountId, orderId }),
    warnings,
  }
}
export function cartonMeasurementTotals(cartons, batches) {
  const totalCount = cartons.length
  function metric(field) {
    const amounts = [],
      missing = []
    let knownCount = 0
    const byBatch = new Map()
    for (const unit of cartons) {
      if (!byBatch.has(unit.batchId)) byBatch.set(unit.batchId, [])
      byBatch.get(unit.batchId).push(unit)
    }
    for (const [batchId, units] of byBatch) {
      const batch = batches.find((batch) => batch.id === batchId)
      const combined =
        field === 'weight'
          ? batch?.weightBasis === 'batch'
            ? batch.weight
            : ''
          : batch?.volumeBasis === 'batch' && !batch.len
            ? batch.suppliedCbm
            : ''
      if (
        units.every(
          (unit) =>
            unit[field] !== null &&
            unit[field] !== undefined &&
            unit[field] !== ''
        )
      ) {
        amounts.push(...units.map((unit) => unit[field]))
        knownCount += units.length
      } else if (
        batch &&
        units.length === batch.count &&
        combined !== '' &&
        combined !== undefined &&
        combined !== null
      ) {
        amounts.push(combined)
        knownCount += units.length
      } else
        for (const unit of units) {
          if (
            unit[field] !== null &&
            unit[field] !== undefined &&
            unit[field] !== ''
          ) {
            amounts.push(unit[field])
            knownCount++
          } else missing.push(unit.id)
        }
    }
    return {
      knownCount,
      missingCount: totalCount - knownCount,
      totalCount,
      complete: knownCount === totalCount,
      knownSubtotal: amounts.length
        ? decimalTotal(amounts)
        : totalCount === 0
          ? '0'
          : null,
      missing,
    }
  }
  const weightCoverage = metric('weight'),
    volumeCoverage = metric('volume')
  return {
    cartons: totalCount,
    weight: weightCoverage.knownSubtotal,
    volume: volumeCoverage.knownSubtotal,
    weightCoverage,
    volumeCoverage,
  }
}
function knownLoadedContents(member, loaded, reports) {
  const contents = [],
    issues = [],
    coveredUnits = new Set()
  const activeBatches = member.batches.filter((batch) => !batch.deletedAt)
  // Established explicit set product coverage applies only when every retained
  // physical entitlement in that set loads. No purchase-total equality inference.
  for (const report of reports || []) {
    const claim =
      report.coverage?.completeSetCoverage || report.completeSetCoverage
    if (!claim || !['reported', 'owner-confirmed'].includes(claim.provenance))
      continue
    const batchIds = claim.batchIds || []
    if (!batchIds.length) continue
    const units = activeBatches
      .filter((batch) => batchIds.includes(batch.id))
      .flatMap((batch) => (batch.count === null ? [] : physicalUnits(batch)))
    if (
      batchIds.some((id) => !activeBatches.some((batch) => batch.id === id)) ||
      !units.length ||
      units.some((unit) => !loaded.some((selected) => selected.id === unit.id))
    )
      continue
    const scopes = activeBatches.filter((batch) => batchIds.includes(batch.id))
    // Current actual contents outrank an older aggregate interpretation.
    if (
      units.every((unit) => unit.contents !== null) ||
      scopes.every(
        (batch) => !batch.contentsUnknown && !batch.unresolvedContents?.length
      )
    )
      continue
    const minimums = new Map()
    for (const batch of scopes) {
      const known = new Map()
      for (const unit of units.filter((unit) => unit.batchId === batch.id))
        for (const row of unit.contents || [])
          known.set(
            row.entryId,
            (known.get(row.entryId) || 0n) + wholeUnits(row.quantity)
          )
      for (const row of batch.contents || [])
        if (wholeUnits(row.quantity) > (known.get(row.entryId) || 0n))
          known.set(row.entryId, wholeUnits(row.quantity))
      for (const [entryId, quantity] of known)
        minimums.set(entryId, (minimums.get(entryId) || 0n) + quantity)
    }
    const claimed = new Map()
    for (const row of claim.contents || [])
      claimed.set(
        row.entryId,
        (claimed.get(row.entryId) || 0n) + wholeUnits(row.quantity)
      )
    if (
      units.some((unit) => coveredUnits.has(unit.id)) ||
      [...minimums].some(
        ([entryId, quantity]) => quantity > (claimed.get(entryId) || 0n)
      )
    ) {
      issues.push({
        code: 'COMPLETE_SET_COVERAGE_CONFLICT',
        batchIds,
        orderId: member.orderId,
        message:
          'The aggregate product claim conflicts with current actual contents or overlapping established coverage.',
      })
      continue
    }
    for (const item of claim.contents || [])
      contents.push({
        orderId: member.orderId,
        entryId: item.entryId,
        quantity: item.quantity,
        coverageBatchIds: batchIds,
      })
    units.forEach((unit) => coveredUnits.add(unit.id))
  }
  for (const batch of activeBatches) {
    const units = loaded.filter(
      (unit) => unit.batchId === batch.id && !coveredUnits.has(unit.id)
    )
    if (!units.length) continue
    if (units.every((unit) => unit.contents !== null)) {
      units.forEach((unit) =>
        contents.push(
          ...unit.contents.map((item) => ({ ...item, cartonId: unit.id }))
        )
      )
      continue
    }
    if (
      units.length === batch.count &&
      !batch.contentsUnknown &&
      !(batch.unresolvedContents || []).length
    ) {
      contents.push(
        ...batch.contents.map((item) => ({
          ...item,
          coverageBatchIds: [batch.id],
        }))
      )
      continue
    }
    issues.push({
      code: 'LOADED_CONTENTS_UNKNOWN',
      batchId: batch.id,
      orderId: member.orderId,
      message:
        'Establish exact loaded product quantities or explicit complete-set coverage before sealing.',
    })
  }
  return { contents, issues }
}
function groupFor(preparation, entryId) {
  const group = preparation?.groups.find((group) =>
    group.variants.some((variant) => variant.entryIds.includes(entryId))
  )
  const variant = group?.variants.find((variant) =>
    variant.entryIds.includes(entryId)
  )
  let barcode = ''
  try {
    if (group && variant) barcode = barcodeValue(group, variant)
  } catch {}
  return { group, variant, barcode }
}
function measurementShares(total, rows) {
  if (total === null) return new Map()
  const [whole, fraction = ''] = total.split('.'),
    scale = Math.max(6, fraction.length),
    units = BigInt(whole + fraction.padEnd(scale, '0'))
  const denominator = rows.reduce(
    (sum, row) => sum + wholeUnits(row.quantity),
    0n
  )
  if (!denominator) return new Map()
  const shares = rows.map((row, index) => ({
    row,
    index,
    units: (units * wholeUnits(row.quantity)) / denominator,
    remainder: (units * wholeUnits(row.quantity)) % denominator,
  }))
  let left = units - shares.reduce((sum, row) => sum + row.units, 0n)
  for (const row of [...shares].sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1
  )) {
    if (!left) break
    row.units++
    left--
  }
  return new Map(
    shares.map(({ row, units }) => {
      const text = String(units).padStart(scale + 1, '0')
      return [
        row.entryId,
        `${text.slice(0, -scale)}.${text.slice(-scale)}`.replace(
          /\.?0+$/,
          ''
        ) || '0',
      ]
    })
  )
}
function buildProductRows(
  member,
  contents,
  cartons,
  prior,
  state,
  occupiedIntervals = {},
  financialRows = null
) {
  const quantities = {}
  for (const item of contents)
    quantities[item.entryId] = String(
      BigInt(quantities[item.entryId] || '0') + wholeUnits(item.quantity)
    )
  const money = new Map(
    shipmentMoney(
      member.record,
      quantities,
      prior,
      state.records,
      occupiedIntervals,
      financialRows
    ).map((row) => [row.entryId, row])
  )
  const rows = []
  for (const [entryId, quantity] of Object.entries(quantities)) {
    const item = member.record.snapshot.items.find(
      (item) => item.entryId === entryId
    )
    if (!item)
      throw inventoryError(
        'SHIPMENT_PRODUCT_MISSING',
        'Loaded products are not in the captured source.',
        { entryId }
      )
    const { group, variant, barcode } = groupFor(member.preparation, entryId)
    const actual = cartons.filter((unit) =>
        unit.contents?.some((row) => row.entryId === entryId)
      ),
      setIds = new Set(
        contents
          .filter((row) => row.entryId === entryId)
          .flatMap((row) => row.coverageBatchIds || [])
      )
    const relevant = cartons.filter(
        (unit) => actual.includes(unit) || setIds.has(unit.batchId)
      ),
      knownParticipation = setIds.size === 0
    const additive = actual.filter((unit) => {
      const marked =
        member.preparation?.groups
          .find((group) => group.id === unit.mark?.groupId)
          ?.variants.flatMap((variant) => variant.entryIds) || []
      const owner =
        unit.contents.find((row) => marked.includes(row.entryId)) ||
        [...unit.contents].sort((a, b) => a.entryId.localeCompare(b.entryId))[0]
      return owner?.entryId === entryId
    }).length
    const before = member.availableBefore.find(
      (row) => row.entryId === entryId
    )?.quantity
    rows.push({
      accountId: member.accountId,
      orderId: member.orderId,
      entryId,
      sellerName: member.record.snapshot.sellerName,
      supplierIdentity: purchaseSupplierForCodes(member.record),
      sellerMemberLogin: member.record.snapshot.sellerMemberLogin,
      orderReference: member.record.snapshot.reference || member.orderId,
      source: member.record.snapshot.source || '1688',
      title: item.title,
      description: item.description,
      spanishName: variant?.spanishName ?? group?.spanishName ?? '',
      category: group?.category || '',
      material: variant ? variantMaterial(variant, entryId).value : '',
      materialSource: variant ? variantMaterial(variant, entryId).source : '',
      size: variant?.sizeSuffix || '',
      variantSuffix: variant?.variantSuffix || '',
      sizeSuffix: variant?.sizeSuffix || '',
      needsSizeMapping: variant?.needsSizeMapping === true,
      sourceSize: variant?.size || '',
      variantDescription: variant?.variant || '',
      baseCode: group?.baseCode || '',
      barcode,
      packingMonth: group?.month || member.preparation?.month || '',
      thumbnail: item.thumbnail,
      photos: clone(item.photos || [item.thumbnail].filter(Boolean)),
      quantity,
      loadedQuantity: quantity,
      purchasedQuantity: item.quantity,
      availableBeforeQuantity: before,
      remainingQuantity:
        before === null
          ? null
          : String(BigInt(before || '0') - BigInt(quantity)),
      ...money.get(entryId),
      cartons: knownParticipation ? String(additive) : '',
      containingCartonCount: knownParticipation ? actual.length : null,
      additiveCartonCount: knownParticipation ? additive : null,
      cartonReferences: relevant.map((unit) => unit.id),
      cartonReferenceText: relevant.map((unit) => unit.reference).join(', '),
      cartonMarkCode: actual[0]?.markCode || '',
      allocatedWeight: null,
      allocatedVolume: null,
      measurementAllocationBasis: 'allocated',
      record: member.record,
      preparation: member.preparation,
      group,
      variant,
    })
  }
  // Allocate each measured physical scope once, including full aggregate totals.
  for (const batch of member.batches) {
    const selected = cartons.filter((unit) => unit.batchId === batch.id)
    if (!selected.length) continue
    const measurement = cartonMeasurementTotals(selected, [batch]),
      parts = []
    for (const row of rows) {
      const explicit = contents.filter(
        (part) =>
          part.entryId === row.entryId &&
          (part.cartonId
            ? selected.some((unit) => unit.id === part.cartonId)
            : part.coverageBatchIds?.includes(batch.id))
      )
      // A multi-batch unresolved coverage has no exact product-to-batch split.
      if (explicit.some((part) => part.coverageBatchIds?.length > 1)) continue
      const quantity = explicit.reduce(
        (sum, part) => sum + wholeUnits(part.quantity),
        0n
      )
      if (quantity)
        parts.push({ entryId: row.entryId, quantity: String(quantity) })
    }
    const weights = measurementShares(measurement.weight, parts),
      volumes = measurementShares(measurement.volume, parts)
    for (const row of rows) {
      if (weights.has(row.entryId))
        row.allocatedWeight = decimalTotal([
          row.allocatedWeight || '0',
          weights.get(row.entryId),
        ])
      if (volumes.has(row.entryId))
        row.allocatedVolume = decimalTotal([
          row.allocatedVolume || '0',
          volumes.get(row.entryId),
        ])
    }
  }
  const measuredSets = new Map()
  for (const part of contents) {
    if (part.coverageBatchIds?.length < 2 || !part.coverageBatchIds) continue
    const key = stableValue([...part.coverageBatchIds].sort())
    if (!measuredSets.has(key))
      measuredSets.set(key, { ids: part.coverageBatchIds, parts: [] })
    measuredSets.get(key).parts.push(part)
  }
  for (const { ids, parts } of measuredSets.values()) {
    const selected = cartons.filter((unit) => ids.includes(unit.batchId)),
      measurement = cartonMeasurementTotals(
        selected,
        member.batches.filter((batch) => ids.includes(batch.id))
      ),
      quantities = new Map()
    for (const part of parts)
      quantities.set(
        part.entryId,
        (quantities.get(part.entryId) || 0n) + wholeUnits(part.quantity)
      )
    const allocation = [...quantities].map(([entryId, quantity]) => ({
        entryId,
        quantity: String(quantity),
      })),
      weights = measurementShares(measurement.weight, allocation),
      volumes = measurementShares(measurement.volume, allocation)
    for (const row of rows) {
      if (weights.has(row.entryId))
        row.allocatedWeight = decimalTotal([
          row.allocatedWeight || '0',
          weights.get(row.entryId),
        ])
      if (volumes.has(row.entryId))
        row.allocatedVolume = decimalTotal([
          row.allocatedVolume || '0',
          volumes.get(row.entryId),
        ])
    }
  }
  return rows
}
function summary(products, cartons, batches, orders) {
  const totals = {
    orders,
    products: products.length,
    quantity: String(
      products.reduce((sum, row) => sum + wholeUnits(row.quantity), 0n)
    ),
    ...cartonMeasurementTotals(cartons, batches),
  }
  for (const field of [
    'sourceAmount',
    'merchandiseValue',
    'effectiveAmount',
    'additionalCharge',
    'featureCharge',
    'linkedPaymentCharge',
    'freightAllocated',
  ])
    totals[field] = centsToMoney(
      products.reduce(
        (sum, row) => sum + moneyToCents(row[field] || '0.00'),
        0n
      )
    )
  return totals
}
export function projectContainer(
  state,
  container,
  { revisionId, preferences, media, now } = {}
) {
  if (revisionId) {
    const revision = container.revisions?.find(
      (revision) => revision.revisionId === revisionId
    )
    if (!revision)
      throw inventoryError(
        'REVISION_MISSING',
        'This historical container revision is missing.'
      )
    return clone(revision)
  }
  const issues = [],
    warnings = [],
    orders = [],
    products = [],
    cartons = [],
    leftProducts = [],
    leftCartons = [],
    unprepared = [],
    batches = []
  const committed = committedCartonOwners(state.containers || [], {
      exceptContainerId: container.id,
    }),
    reserved = reservedOrderOwners(state.containers || [], {
      exceptContainerId: container.id,
    })
  const draft = container.draft
  if (!draft) {
    const revision = container.revisions?.find(
      (revision) => revision.revisionId === container.effectiveRevisionId
    )
    if (revision) return clone(revision)
    throw inventoryError(
      'CONTAINER_NOT_EDITABLE',
      'This container has no active draft.'
    )
  }
  for (const member of draft.orders) {
    if (member.availabilityPending)
      issues.push({
        code: 'AVAILABILITY_STALE',
        orderId: member.orderId,
        message: 'Review newly changed physical membership before sealing.',
      })
    const live = state.records.find(
        (record) => orderKey(record) === orderKey(member)
      ),
      prep = state.preparations.find(
        (prep) => orderKey(prep) === orderKey(member)
      )
    if (!live || sourceRevision(live, prep) !== member.revisions.source)
      issues.push({
        code: 'SOURCE_STALE',
        orderId: member.orderId,
        message:
          'The included source or preparation changed. Review availability.',
      })
    for (const batch of member.batches)
      if (
        state.batches.find((value) => value.id === batch.id)?.revision !==
        batch.revision
      )
        issues.push({
          code: 'CARTON_STALE',
          batchId: batch.id,
          orderId: member.orderId,
        })
    warnings.push(...(member.warnings || []))
    const own = member.cartons.map((unit) => {
      const group = member.preparation?.groups.find(
        (group) => group.id === unit.mark?.groupId
      )
      return {
        ...clone(unit),
        state: draft.decisions[unit.id] || 'unconfirmed',
        record: member.record,
        preparation: member.preparation,
        markCode: group?.baseCode || '',
      }
    })
    const loaded = own.filter((unit) => unit.state === 'loaded'),
      left = own.filter((unit) => unit.state === 'left-behind')
    for (const unit of own) {
      if (unit.state === 'unconfirmed')
        issues.push({
          code: 'LOADING_UNCONFIRMED',
          cartonId: unit.id,
          orderId: member.orderId,
        })
      if (unit.state === 'loaded' && committed.has(unit.id))
        issues.push({
          code: 'CARTON_COMMITTED',
          cartonId: unit.id,
          ...committed.get(unit.id),
        })
    }
    if (loaded.length && reserved.has(orderKey(member)))
      issues.push({
        code: 'ORDER_RESERVED',
        orderId: member.orderId,
        ...reserved.get(orderKey(member)),
      })
    const interpretation = knownLoadedContents(member, loaded, state.reports)
    issues.push(...interpretation.issues)
    const previous = {},
      occupiedIntervals = {},
      financialRows = []
    for (const { manifest } of effectiveShipments(state.containers || [], {
      exceptContainerId: container.id,
    }))
      for (const row of manifest.products || [])
        if (orderKey(row) === orderKey(member)) {
          previous[row.entryId] = String(
            BigInt(previous[row.entryId] || '0') + wholeUnits(row.quantity)
          )
          financialRows.push(row)
          occupiedIntervals[row.entryId] ||= []
          occupiedIntervals[row.entryId].push(
            ...(row.valuation?.intervals || [
              { from: row.valuation?.from || '0', quantity: row.quantity },
            ])
          )
        }
    let rows = []
    try {
      rows = buildProductRows(
        member,
        interpretation.contents,
        loaded,
        previous,
        state,
        occupiedIntervals,
        financialRows
      )
    } catch (error) {
      issues.push({
        code: error.code || 'LOADED_QUANTITY_INVALID',
        orderId: member.orderId,
        message: error.message,
      })
    }
    for (const row of rows) {
      const available = member.availableBefore.find(
        (item) => item.entryId === row.entryId
      )?.quantity
      if (
        available === null ||
        wholeUnits(row.quantity) > BigInt(available || '0')
      )
        issues.push({
          code: 'LOADED_OVERALLOCATION',
          orderId: member.orderId,
          entryId: row.entryId,
        })
    }
    // Left-behind quantities include unprepared remainder but only from included orders.
    const remainingContents = []
    for (const available of member.availableBefore) {
      if (available.quantity === null) continue
      const loadedQuantity =
        rows.find((row) => row.entryId === available.entryId)?.quantity || '0'
      const quantity = BigInt(available.quantity) - BigInt(loadedQuantity)
      if (quantity > 0n)
        remainingContents.push({
          orderId: member.orderId,
          entryId: available.entryId,
          quantity: String(quantity),
          coverageBatchIds: [],
        })
    }
    const leftIntervals = structuredClone(occupiedIntervals)
    for (const row of rows) {
      leftIntervals[row.entryId] ||= []
      leftIntervals[row.entryId].push(...(row.valuation?.intervals || []))
    }
    let leftRows = []
    try {
      leftRows = buildProductRows(
        member,
        remainingContents,
        left,
        Object.fromEntries(
          member.availableBefore.map((row) => [
            row.entryId,
            String(
              BigInt(previous[row.entryId] || '0') +
                BigInt(
                  rows.find((value) => value.entryId === row.entryId)
                    ?.quantity || '0'
                )
            ),
          ])
        ),
        state,
        leftIntervals,
        [...financialRows, ...rows]
      )
    } catch (error) {
      issues.push({ code: 'REMAINING_VALUE_INVALID', message: error.message })
    }
    leftRows.forEach((row) => {
      row.loadedQuantity = '0'
    })
    for (const row of leftRows)
      if (
        !left.some((unit) =>
          unit.contents?.some((item) => item.entryId === row.entryId)
        )
      )
        unprepared.push({
          accountId: member.accountId,
          orderId: member.orderId,
          entryId: row.entryId,
          quantity: row.quantity,
          reason: 'Awaiting packing data',
        })
    for (const unit of own) {
      const members = own.filter((member) => member.batchId === unit.batchId)
      const same =
        members.every((member) => member.contents !== null) &&
        new Set(
          members.map((member) =>
            stableValue({
              contents: member.contents,
              weight: member.weight,
              volume: member.volume,
              len: member.len,
              wid: member.wid,
              ht: member.ht,
            })
          )
        ).size === 1
      unit.interchangeable = same
      unit.canSelectCount = same
    }
    orders.push({
      accountId: member.accountId,
      orderId: member.orderId,
      record: member.record,
      preparation: member.preparation,
      supplierIdentity: purchaseSupplierForCodes(member.record),
      availableBefore: clone(member.availableBefore),
      batches: clone(member.batches),
      sourceReports: clone(
        (state.reports || []).filter(
          (report) => orderKey(report.orderKey || report) === orderKey(member)
        )
      ),
      revisions: clone(member.revisions),
      cartons: own,
      products: rows,
      availableBeforeQuantity: String(
        member.availableBefore.reduce(
          (sum, row) => sum + BigInt(row.quantity || '0'),
          0n
        )
      ),
      loadedQuantity: String(
        rows.reduce((sum, row) => sum + BigInt(row.quantity), 0n)
      ),
      remainingQuantity: String(
        remainingContents.reduce((sum, row) => sum + BigInt(row.quantity), 0n)
      ),
    })
    products.push(...rows)
    cartons.push(...own)
    leftProducts.push(...leftRows)
    leftCartons.push(...left)
    batches.push(...member.batches)
  }
  const loaded = cartons.filter((unit) => unit.state === 'loaded'),
    totals = summary(products, loaded, batches, orders.length)
  if (!totals.weightCoverage.complete)
    warnings.push({ code: 'WEIGHT_INCOMPLETE', ...totals.weightCoverage })
  if (!totals.volumeCoverage.complete)
    warnings.push({ code: 'VOLUME_INCOMPLETE', ...totals.volumeCoverage })
  return {
    format: '1688-container-manifest',
    version: 1,
    container: {
      id: container.id,
      accountId: container.accountId,
      name: container.name,
      period: container.period,
      loadingDate: container.loadingDate,
      revision: container.revision,
      amendment: container.amendment,
    },
    revisionId: null,
    revision: container.revision,
    draft: true,
    status: container.status,
    orders,
    products,
    cartons,
    batches,
    leftBehind: {
      products: leftProducts,
      cartons: leftCartons,
      unprepared,
      totals: summary(leftProducts, leftCartons, batches, orders.length),
    },
    totals,
    preferences: clone(
      preferences || state.preferences || validatePackingPreferences({})
    ),
    media: clone(media || { imageRefs: [] }),
    warnings,
    issues,
    readiness: { ready: issues.length === 0, issues, warnings },
  }
}
export function validateContainerRecord(value) {
  if (
    !value ||
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.accountId !== 'string' ||
    !['draft', 'sealed', 'amending', 'canceled'].includes(value.status) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !Array.isArray(value.revisions)
  )
    throw inventoryError('INVALID_CONTAINER', 'Invalid container record.')
  if (
    value.effectiveRevisionId &&
    !value.revisions.some(
      (revision) => revision.revisionId === value.effectiveRevisionId
    )
  )
    throw inventoryError(
      'INVALID_CONTAINER',
      'The effective shipment revision is missing.'
    )
  const ids = new Set()
  for (const revision of value.revisions) {
    if (
      ids.has(revision.revisionId) ||
      revision.draft !== false ||
      revision.container?.id !== value.id ||
      !Array.isArray(revision.products) ||
      !Array.isArray(revision.cartons)
    )
      throw inventoryError(
        'INVALID_CONTAINER',
        'Invalid immutable manifest history.'
      )
    assertManifestEvidence(revision)
    ids.add(revision.revisionId)
  }
  return clone(value)
}

/** Restorable manifests must prove physical/product correspondence, not just totals. */
export function assertManifestEvidence(manifest) {
  if (
    manifest?.format !== '1688-container-manifest' ||
    manifest.version !== 1 ||
    manifest.draft !== false ||
    !Array.isArray(manifest.orders) ||
    !Array.isArray(manifest.products) ||
    !Array.isArray(manifest.cartons) ||
    !Array.isArray(manifest.batches)
  )
    throw inventoryError(
      'INVALID_MANIFEST',
      'A sealed manifest must retain complete frozen evidence.'
    )
  const batches = new Map(manifest.batches.map((batch) => [batch.id, batch])),
    units = new Map(),
    expected = new Map(),
    actual = new Map(),
    seen = new Set()
  for (const unit of manifest.cartons) {
    const batch = batches.get(unit.batchId)
    if (
      !batch ||
      batch.deletedAt ||
      batchOrderIds(batch).length !== 1 ||
      unit.state !== 'loaded' ||
      seen.has(unit.id)
    )
      throw inventoryError(
        'INVALID_MANIFEST',
        'A sealed physical carton is missing, duplicated or belongs to several orders.'
      )
    seen.add(unit.id)
    if (!units.has(batch.id)) units.set(batch.id, physicalUnits(batch))
    const source = units.get(batch.id).find((value) => value.id === unit.id)
    const meaning = (value) =>
      value &&
      stableValue({
        id: value.id,
        batchId: value.batchId,
        index: value.index,
        accountId: value.accountId,
        orderId: value.orderId,
        reference: value.reference,
        labelOrigin: value.labelOrigin,
        contents: value.contents,
        weight: value.weight,
        volume: value.volume,
        len: value.len,
        wid: value.wid,
        ht: value.ht,
        mark: value.mark,
      })
    if (!source || meaning(source) !== meaning(unit))
      throw inventoryError(
        'INVALID_MANIFEST',
        'A sealed carton differs from its frozen physical entitlement.',
        { cartonId: unit.id }
      )
  }
  for (const order of manifest.orders) {
    if (
      order.record?.snapshot?.orderId !== order.orderId ||
      (order.record.snapshot.accountId || 'local') !==
        (order.accountId || 'local')
    )
      throw inventoryError(
        'INVALID_MANIFEST',
        'A frozen source belongs to another purchase.'
      )
    const selected = manifest.cartons.filter(
        (unit) => orderKey(unit) === orderKey(order)
      ),
      member = {
        ...order,
        batches:
          order.batches ||
          manifest.batches.filter(
            (batch) =>
              batchOrderIds(batch).includes(order.orderId) &&
              batch.accountId === (order.accountId || 'local')
          ),
      }
    const interpreted = knownLoadedContents(
      member,
      selected,
      order.sourceReports || manifest.reportSnapshots || []
    )
    if (interpreted.issues.length)
      throw inventoryError(
        'INVALID_MANIFEST',
        'Loaded quantities cannot be established from the frozen physical evidence.',
        { issues: interpreted.issues }
      )
    for (const row of interpreted.contents) {
      const key = productKey(order.accountId, order.orderId, row.entryId)
      expected.set(key, (expected.get(key) || 0n) + wholeUnits(row.quantity))
    }
    const sourceIds = new Set(
      order.record.snapshot.items.map((item) => item.entryId)
    )
    if (interpreted.contents.some((row) => !sourceIds.has(row.entryId)))
      throw inventoryError(
        'INVALID_MANIFEST',
        'A loaded product is missing from its frozen source.'
      )
  }
  for (const row of manifest.products) {
    const key = productKey(row.accountId, row.orderId, row.entryId)
    if (
      actual.has(key) ||
      !manifest.orders.some((order) => orderKey(order) === orderKey(row))
    )
      throw inventoryError(
        'INVALID_MANIFEST',
        'Manifest financial rows have duplicate or foreign purchase ownership.'
      )
    actual.set(key, wholeUnits(row.quantity))
  }
  if (
    stableValue(
      [...expected]
        .filter(([, quantity]) => quantity > 0n)
        .map(([key, quantity]) => [key, String(quantity)])
        .sort()
    ) !==
    stableValue(
      [...actual].map(([key, quantity]) => [key, String(quantity)]).sort()
    )
  )
    throw inventoryError(
      'INVALID_MANIFEST',
      'Manifest products differ from frozen loaded physical contents.'
    )
  const cartonIds = new Set(manifest.cartons.map((unit) => unit.id)),
    left = manifest.leftBehind?.cartons || []
  if (
    left.some(
      (unit) =>
        cartonIds.has(unit.id) ||
        unit.state !== 'left-behind' ||
        !manifest.orders.some((order) => orderKey(order) === orderKey(unit))
    )
  )
    throw inventoryError(
      'INVALID_MANIFEST',
      'Historical left-behind cartons overlap loading or belong to untouched purchases.'
    )
  for (const row of manifest.leftBehind?.products || [])
    if (!manifest.orders.some((order) => orderKey(order) === orderKey(row)))
      throw inventoryError(
        'INVALID_MANIFEST',
        'Historical left-behind products belong to an untouched purchase.'
      )
  const physical = cartonMeasurementTotals(manifest.cartons, manifest.batches)
  if (
    manifest.totals.cartons !== physical.cartons ||
    manifest.totals.weight !== physical.weight ||
    manifest.totals.volume !== physical.volume ||
    String(manifest.totals.quantity) !==
      String([...actual.values()].reduce((sum, quantity) => sum + quantity, 0n))
  )
    throw inventoryError(
      'INVALID_MANIFEST',
      'Frozen physical/product totals do not reconcile.'
    )
  validatePackingPreferences(manifest.preferences)
  return true
}
