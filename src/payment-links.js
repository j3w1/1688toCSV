import { centsToMoney, moneyToCents } from './money.js'
import { featureUnitCost } from './product-features.js'
import {
  allocateCostCents,
  costAdjustedUnitPrice,
  orderCostAdjustments,
  productNetCents,
} from './order-charges.js'

const keyFor = (record) =>
  JSON.stringify([record.snapshot.accountId, record.snapshot.orderId])
const refKey = (accountId, orderId) => JSON.stringify([accountId, orderId])
const sourceKey = (link) =>
  JSON.stringify([link.sourceOrderId, link.sourceEntryId || null])

function identifier(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200)
    throw new Error('Payment links require valid order, product and link IDs')
  return value
}

function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new Error('Payment links require a review timestamp')
  return value
}

function money(value, { positive = false } = {}) {
  let cents
  try {
    cents = moneyToCents(value)
  } catch {
    throw new Error('Payment link amounts must use exact cents')
  }
  if (positive ? cents <= 0n : cents < 0n)
    throw new Error('Payment link amounts must be positive')
  return centsToMoney(cents)
}

function uniqueIds(value, { empty = false } = {}) {
  if (!Array.isArray(value) || (!empty && !value.length))
    throw new Error('Choose eligible goods for this payment link')
  const ids = value.map(identifier)
  if (new Set(ids).size !== ids.length)
    throw new Error('Payment links cannot repeat a product')
  return ids
}

/** Persisted reviewed links only. Draft defaults are supplied by the repository. */
export function validatePaymentLinks(value) {
  if (!Array.isArray(value)) throw new Error('Payment links must be an array')
  const ids = new Set(),
    sources = new Set()
  return value.map((link) => {
    if (!link || typeof link !== 'object' || Array.isArray(link))
      throw new Error('Payment links must contain reviewed payments')
    const id = identifier(link.id),
      sourceOrderId = identifier(link.sourceOrderId)
    const sourceEntryId =
      link.sourceEntryId === undefined
        ? undefined
        : identifier(link.sourceEntryId)
    const source = sourceKey({ sourceOrderId, sourceEntryId })
    if (ids.has(id) || sources.has(source))
      throw new Error('This payment source is already linked to this order')
    ids.add(id)
    sources.add(source)
    if (typeof link.reason !== 'string' || !link.reason.trim())
      throw new Error('Explain the reason for each linked payment')
    const evidence = link.sourceEvidence
    if (!evidence || typeof evidence !== 'object')
      throw new Error('Review the existing source amount before linking')
    const result = {
      id,
      sourceOrderId,
      ...(sourceEntryId === undefined ? {} : { sourceEntryId }),
      amount: money(link.amount, { positive: true }),
      reason: link.reason.trim(),
      ...(link.targetEntryIds === undefined
        ? {}
        : { targetEntryIds: uniqueIds(link.targetEntryIds) }),
      reviewedAt: timestamp(link.reviewedAt),
      sourceEvidence: {
        amount: money(evidence.amount, { positive: true }),
        payable: money(evidence.payable),
        shipping: money(evidence.shipping),
        observedAt: timestamp(evidence.observedAt),
      },
    }
    if (
      moneyToCents(result.amount) > moneyToCents(result.sourceEvidence.amount)
    )
      throw new Error('Linked amounts exceed the existing source payment')
    if (link.packingExclusions !== undefined) {
      if (
        !link.packingExclusions ||
        typeof link.packingExclusions !== 'object' ||
        Array.isArray(link.packingExclusions)
      )
        throw new Error('Payment skip ownership is invalid')
      result.packingExclusions = {
        entryIds: uniqueIds(link.packingExclusions.entryIds),
        updatedAt: timestamp(link.packingExclusions.updatedAt),
      }
    }
    return result
  })
}

export function mergePaymentLinks(previous, incoming, next = previous) {
  const previousClock = previous.paymentLinksUpdatedAt || ''
  const incomingClock = incoming.paymentLinksUpdatedAt || ''
  if (
    incomingClock &&
    incomingClock === previousClock &&
    JSON.stringify(incoming.paymentLinks || []) !==
      JSON.stringify(previous.paymentLinks || [])
  )
    throw new Error('Backup conflict: payment links have the same timestamp')
  if (incomingClock <= previousClock) return next
  return {
    ...next,
    paymentLinks: structuredClone(incoming.paymentLinks || []),
    paymentLinksUpdatedAt: incomingClock,
  }
}

export function paymentSourceEvidence(source, sourceEntryId) {
  const item =
    sourceEntryId === undefined
      ? undefined
      : source.snapshot.items.find((row) => row.entryId === sourceEntryId)
  if (sourceEntryId !== undefined && !item)
    throw new Error('The linked payment source product was not found')
  return {
    amount: item
      ? centsToMoney(productNetCents(item))
      : source.snapshot.totals.payable,
    payable: source.snapshot.totals.payable,
    shipping: source.snapshot.totals.shipping || '0.00',
    observedAt: source.snapshot.observedAt,
  }
}

export function paymentSourceClock(source) {
  return {
    observedAt: source.snapshot.observedAt,
    packingExclusionsUpdatedAt: source.packingExclusionsUpdatedAt || '',
    packingExclusionsPartialClocks: {
      ...source.packingExclusionsPartialClocks,
    },
  }
}

/** Goods eligibility is explicit; payment sources can never receive their own cost. */
export function eligiblePaymentItems(record, records = [record]) {
  const excluded = new Set(record.packingExcludedEntryIds || [])
  for (const target of records) {
    if (target.snapshot.accountId !== record.snapshot.accountId) continue
    for (const link of target.paymentLinks || []) {
      if (link.sourceOrderId !== record.snapshot.orderId) continue
      if (link.sourceEntryId === undefined)
        for (const item of record.snapshot.items) excluded.add(item.entryId)
      else excluded.add(link.sourceEntryId)
    }
  }
  return record.snapshot.items.filter(
    (item) =>
      !excluded.has(item.entryId) &&
      typeof item.quantity === 'string' &&
      /^\d+(?:\.\d+)?$/.test(item.quantity) &&
      /[1-9]/.test(item.quantity)
  )
}

function sourceRecord(records, target, link) {
  const source = records.find(
    (record) =>
      record.snapshot.accountId === target.snapshot.accountId &&
      record.snapshot.orderId === link.sourceOrderId
  )
  if (!source)
    throw new Error(
      'The linked payment source order was not found in this account'
    )
  return source
}

export function paymentLinkReviews(record, records) {
  const reviews = []
  for (const link of record.paymentLinks || []) {
    const source = sourceRecord(records, record, link)
    const current = paymentSourceEvidence(source, link.sourceEntryId)
    if (
      ['amount', 'payable', 'shipping'].some(
        (field) => money(current[field]) !== link.sourceEvidence[field]
      )
    )
      reviews.push({
        linkId: link.id,
        sourceOrderId: link.sourceOrderId,
        sourceEntryId: link.sourceEntryId,
        reviewed: structuredClone(link.sourceEvidence),
        current,
        reason: 'Review changes to the linked source payment',
      })
  }
  return reviews
}

/** Validate complete account graphs on every mutation/restore that can change references. */
export function validatePaymentGraph(records) {
  if (!Array.isArray(records))
    throw new Error('Payment links need the complete source orders')
  const keys = new Set(),
    edges = new Map(),
    budgets = new Map(),
    whole = new Set(),
    rows = new Set(),
    linkIds = new Set()
  for (const record of records) {
    const key = keyFor(record)
    if (keys.has(key))
      throw new Error('Payment links need unique source orders')
    keys.add(key)
  }
  for (const target of records) {
    const links = validatePaymentLinks(target.paymentLinks || [])
    const eligible = new Set(
      eligiblePaymentItems(target, records).map((item) => item.entryId)
    )
    for (const link of links) {
      const source = sourceRecord(records, target, link),
        from = keyFor(source),
        to = keyFor(target)
      const globalId = refKey(target.snapshot.accountId, link.id)
      if (linkIds.has(globalId))
        throw new Error('Payment link IDs must be unique in this account')
      linkIds.add(globalId)
      if (from === to && link.sourceEntryId === undefined)
        throw new Error('An order cannot link its whole payment to itself')
      if (
        link.sourceEntryId !== undefined &&
        !source.snapshot.items.some(
          (item) => item.entryId === link.sourceEntryId
        )
      )
        throw new Error('The linked payment source product was not found')
      const targets = link.targetEntryIds || [...eligible]
      if (!targets.length || targets.some((id) => !eligible.has(id)))
        throw new Error('Choose eligible goods for this payment link')
      if (from !== to) {
        if (!edges.has(from)) edges.set(from, new Set())
        edges.get(from).add(to)
      }
      const budgetKey = JSON.stringify([from, link.sourceEntryId || null])
      const budget = budgets.get(budgetKey) || {
        amount: 0n,
        available: moneyToCents(link.sourceEvidence.amount),
      }
      budget.amount += moneyToCents(link.amount)
      budget.available =
        budget.available < moneyToCents(link.sourceEvidence.amount)
          ? budget.available
          : moneyToCents(link.sourceEvidence.amount)
      budgets.set(budgetKey, budget)
      if (link.sourceEntryId === undefined) whole.add(from)
      else rows.add(from)
    }
  }
  if ([...whole].some((key) => rows.has(key)))
    throw new Error('Link either the whole payment or its fee rows, not both')
  if ([...budgets.values()].some((budget) => budget.amount > budget.available))
    throw new Error('Linked amounts exceed the existing source payment')
  const active = new Set(),
    visited = new Set()
  function visit(key) {
    if (active.has(key)) throw new Error('Payment links cannot create a cycle')
    if (visited.has(key)) return
    active.add(key)
    for (const next of edges.get(key) || []) visit(next)
    active.delete(key)
    visited.add(key)
  }
  for (const key of keys) visit(key)
  return {
    reviews: records.flatMap((record) =>
      paymentLinkReviews(record, records).map((review) => ({
        ...review,
        accountId: record.snapshot.accountId,
        orderId: record.snapshot.orderId,
      }))
    ),
  }
}

export function paymentLinksTotal(record) {
  return centsToMoney(
    (record.paymentLinks || []).reduce(
      (sum, link) => sum + moneyToCents(link.amount),
      0n
    )
  )
}

/** Full source dependencies only, with no implied packing membership. */
export function paymentSourceDependencies(records, selectedRecordsOrKeys) {
  const byKey = new Map(records.map((record) => [keyFor(record), record]))
  const initial = new Set(
    selectedRecordsOrKeys.map((value) =>
      value.snapshot ? keyFor(value) : refKey(value.accountId, value.orderId)
    )
  )
  const visited = new Set(),
    dependencies = []
  function visit(key) {
    if (visited.has(key)) return
    visited.add(key)
    const record = byKey.get(key)
    if (!record)
      throw new Error(
        'The linked payment source order was not found in this account'
      )
    if (!initial.has(key)) dependencies.push(record)
    for (const link of record.paymentLinks || [])
      visit(refKey(record.snapshot.accountId, link.sourceOrderId))
  }
  for (const key of initial) visit(key)
  return dependencies
}

/** Source payables never change. These values describe cost attribution only. */
export function paymentCostAdjustments(record, records = [record]) {
  const all = records.some((item) => keyFor(item) === keyFor(record))
    ? records.map((item) => (keyFor(item) === keyFor(record) ? record : item))
    : [...records, record]
  const { reviews } = validatePaymentGraph(all)
  const base = orderCostAdjustments(record),
    added = new Map(),
    removed = new Map(),
    reasons = new Map()
  const add = (map, id, amount) => map.set(id, (map.get(id) || 0n) + amount)
  const eligible = eligiblePaymentItems(record, all)
  for (const link of record.paymentLinks || []) {
    const items = link.targetEntryIds
      ? eligible.filter((item) => link.targetEntryIds.includes(item.entryId))
      : eligible
    for (const [id, amount] of allocateCostCents(
      items,
      moneyToCents(link.amount)
    )) {
      add(added, id, amount)
      if (amount) reasons.set(id, [...(reasons.get(id) || []), link.reason])
    }
  }
  let wholeAmount = 0n,
    wholeBudget
  for (const target of all) {
    if (target.snapshot.accountId !== record.snapshot.accountId) continue
    for (const link of target.paymentLinks || []) {
      if (link.sourceOrderId !== record.snapshot.orderId) continue
      if (link.sourceEntryId !== undefined)
        add(removed, link.sourceEntryId, moneyToCents(link.amount))
      else {
        // Source shipping is not already in row costs. Remove only the linked
        // proportion of the source goods amount, rather than inventing a loss.
        const budget = moneyToCents(link.sourceEvidence.amount),
          amount = moneyToCents(link.amount)
        wholeAmount += amount
        wholeBudget =
          wholeBudget === undefined || budget < wholeBudget
            ? budget
            : wholeBudget
      }
    }
  }
  if (wholeAmount) {
    const net = record.snapshot.items.reduce(
      (sum, item) => sum + productNetCents(item),
      0n
    )
    const removal = (net * wholeAmount + wholeBudget / 2n) / wholeBudget
    for (const [id, value] of allocateCostCents(record.snapshot.items, removal))
      add(removed, id, value)
  }
  const needsReview = reviews.some(
    (review) =>
      review.accountId === record.snapshot.accountId &&
      (review.orderId === record.snapshot.orderId ||
        review.sourceOrderId === record.snapshot.orderId)
  )
  return new Map(
    record.snapshot.items.map((item) => {
      const cost = base.get(item.entryId),
        incoming = added.get(item.entryId) || 0n,
        outgoing = removed.get(item.entryId) || 0n
      const delta = incoming - outgoing,
        manual = moneyToCents(cost.additionalCharge),
        unitFeatureCost = featureUnitCost(
          record.productWorkflow?.[item.entryId]?.features
        ),
        featurePrice = unitFeatureCost
          ? costAdjustedUnitPrice(item.price, unitFeatureCost, '1')
          : item.price
      return [
        item.entryId,
        {
          ...cost,
          effectiveUnitPrice: delta
            ? costAdjustedUnitPrice(featurePrice, manual + delta, item.quantity)
            : cost.effectiveUnitPrice,
          effectiveAmount: centsToMoney(
            moneyToCents(cost.effectiveAmount) + delta
          ),
          linkedPaymentCharge: centsToMoney(incoming),
          linkedPaymentRemoval: centsToMoney(outgoing),
          linkedPaymentNet: centsToMoney(delta),
          linkedPaymentReasons: reasons.get(item.entryId) || [],
          needsReview,
        },
      ]
    })
  )
}
