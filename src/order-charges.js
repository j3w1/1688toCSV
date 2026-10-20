import { centsToMoney, moneyToCents } from './money.js'

function decimalParts(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))
    throw new Error('Product price or quantity is invalid')
  const [whole, fraction = ''] = value.split('.')
  return {
    units: BigInt(whole + fraction),
    scale: 10n ** BigInt(fraction.length),
  }
}

function grossCents(price, quantity) {
  const p = decimalParts(price),
    q = decimalParts(quantity),
    divisor = p.scale * q.scale
  return (p.units * q.units * 100n + divisor / 2n) / divisor
}

export function validateAdditionalCharges(value) {
  if (!Array.isArray(value))
    throw new Error('Additional charges must be an array')
  const ids = new Set()
  return value.map((charge) => {
    if (
      !charge ||
      typeof charge !== 'object' ||
      typeof charge.id !== 'string' ||
      !charge.id.trim() ||
      ids.has(charge.id)
    )
      throw new Error('Additional charges require unique IDs')
    ids.add(charge.id)
    if (typeof charge.reason !== 'string' || !charge.reason.trim())
      throw new Error('Explain the reason for each additional charge')
    if (typeof charge.amount !== 'string' || moneyToCents(charge.amount) <= 0n)
      throw new Error('Additional charge amounts must be positive')
    return {
      id: charge.id,
      reason: charge.reason.trim(),
      amount: centsToMoney(moneyToCents(charge.amount)),
    }
  })
}

export function additionalChargesTotal(record) {
  return centsToMoney(
    (record.additionalCharges || []).reduce(
      (sum, charge) => sum + moneyToCents(charge.amount),
      0n
    )
  )
}

export function costAdjustedUnitPrice(price, charge, quantity) {
  const [whole, fractionPart = ''] = price.split('.')
  const precision = Math.max(8, fractionPart.length)
  const scale = 10n ** BigInt(precision),
    units = decimalParts(quantity)
  const source = BigInt(whole + fractionPart.padEnd(precision, '0'))
  const divisor = units.units * 100n
  if (!divisor) return price
  const delta = charge * scale * units.scale
  const rounded =
    source +
    (delta < 0n
      ? -((-delta + divisor / 2n) / divisor)
      : (delta + divisor / 2n) / divisor)
  const absolute = rounded < 0n ? -rounded : rounded
  const fraction = String(absolute % scale)
    .padStart(precision, '0')
    .replace(/0+$/, '')
    .padEnd(2, '0')
  return `${rounded < 0n ? '-' : ''}${absolute / scale}.${fraction}`
}

export function productNetCents(item) {
  return grossCents(item.price, item.quantity) - moneyToCents(item.discount)
}

/** Deterministic cent allocation shared by manual charges and linked payments. */
export function allocateCostCents(items, total) {
  const source = items.map(productNetCents)
  if (source.some((amount) => amount < 0n))
    throw new Error('Product net amounts cannot be negative')
  let weights = source
  let weightTotal = weights.reduce((sum, value) => sum + value, 0n)
  // Free goods have no monetary proportions. Their quantities provide a stable
  // allocation instead of silently dropping the order's transport/handling cost.
  if (weightTotal === 0n) {
    const quantities = items.map((item) => decimalParts(item.quantity))
    const commonScale = quantities.reduce(
      (scale, quantity) => (quantity.scale > scale ? quantity.scale : scale),
      1n
    )
    weights = quantities.map(
      (quantity) => (quantity.units * commonScale) / quantity.scale
    )
    weightTotal = weights.reduce((sum, value) => sum + value, 0n)
  }
  if (total && !weightTotal)
    throw new Error(
      'Additional charges cannot be allocated to an order with zero quantity'
    )
  const shares = weights.map((weight, index) => ({
    index,
    amount: weightTotal ? (total * weight) / weightTotal : 0n,
    remainder: weightTotal ? (total * weight) % weightTotal : 0n,
  }))
  let remaining = total - shares.reduce((sum, share) => sum + share.amount, 0n)
  for (const share of [...shares].sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1
  )) {
    if (!remaining) break
    share.amount++
    remaining--
  }
  return new Map(
    items.map((item, index) => [item.entryId, shares[index].amount])
  )
}

/** Allocate whole-order costs once; views select from these exact source-row shares. */
export function orderCostAdjustments(record) {
  const items = record.snapshot.items
  const shares = allocateCostCents(
    items,
    moneyToCents(additionalChargesTotal(record))
  )
  return new Map(
    items.map((item) => {
      const amount = productNetCents(item),
        additionalCharge = shares.get(item.entryId)
      return [
        item.entryId,
        {
          sourceUnitPrice: item.price,
          effectiveUnitPrice: additionalCharge
            ? costAdjustedUnitPrice(item.price, additionalCharge, item.quantity)
            : item.price,
          sourceAmount: centsToMoney(amount),
          effectiveAmount: centsToMoney(amount + additionalCharge),
          additionalCharge: centsToMoney(additionalCharge),
        },
      ]
    })
  )
}

export function mergeAdditionalCharges(previous, incoming, next = previous) {
  const previousClock = previous.additionalChargesUpdatedAt || ''
  const incomingClock = incoming.additionalChargesUpdatedAt || ''
  if (
    incomingClock === previousClock &&
    incomingClock &&
    JSON.stringify(incoming.additionalCharges || []) !==
      JSON.stringify(previous.additionalCharges || [])
  )
    throw new Error(
      'Backup conflict: additional charges have the same timestamp'
    )
  if (incomingClock <= previousClock) return next
  return {
    ...next,
    additionalCharges: structuredClone(incoming.additionalCharges || []),
    additionalChargesUpdatedAt: incomingClock,
  }
}
