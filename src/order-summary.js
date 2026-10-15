import { centsToMoney, moneyToCents } from './money.js'

const requiredFields = [
  'goodsGross',
  'shipping',
  'sourceDiscount',
  'orderAdjustment',
  'goodsNet',
  'payable',
]
const optionalFields = [
  'priceIncludedDiscount',
  'rowIncludedAdjustment',
  'orderDiscount',
  'redPacketDiscount',
  'customizationService',
  'grossIncludedCustomization',
]
const amountFields = [
  'originalTotal',
  'shipping',
  'sellerAdjustment',
  'productDiscount',
  'orderDiscount',
  'redPacketDiscount',
  'customizationService',
  'payable',
]

function amount(value) {
  try {
    return moneyToCents(value)
  } catch {
    return null
  }
}

function derive(values, calculate) {
  return values.includes(null) ? null : calculate(...values)
}

/**
 * Summarize complete source orders, even when the caller found them by matching
 * individual product rows. Duplicate observations of an order count only once;
 * its latest snapshot wins. No shipping or discount is apportioned to matches.
 * Amounts stay decimal strings. A null amount means its complete sum is unknown;
 * knownAmounts and unknownCounts expose the explicitly partial alternative.
 */
export function summarizeOrders(records) {
  const orders = new Map()
  for (const [index, record] of records.entries()) {
    const snapshot = record?.snapshot ?? record
    const key =
      snapshot?.accountId && snapshot?.orderId
        ? JSON.stringify([snapshot.accountId, snapshot.orderId])
        : `unknown:${index}`
    const previous = orders.get(key)
    if (
      !previous ||
      (Date.parse(snapshot?.observedAt) || 0) >
        (Date.parse(previous.observedAt) || 0)
    )
      orders.set(key, snapshot ?? {})
  }

  const known = Object.fromEntries(amountFields.map((key) => [key, 0n]))
  const unknownCounts = Object.fromEntries(amountFields.map((key) => [key, 0]))
  const warnings = []
  let productRowCount = 0
  let missingOrderCount = 0
  let inconsistentOrderCount = 0
  let foreignCurrencyFeeUnknownCount = 0

  for (const snapshot of orders.values()) {
    productRowCount += snapshot.items?.length ?? 0
    foreignCurrencyFeeUnknownCount += Number(
      !!snapshot.foreignCurrencyFeeUnspecified
    )
    const totals = snapshot.totals
    const raw = Object.fromEntries(
      [...requiredFields, ...optionalFields].map((key) => [
        key,
        totals && optionalFields.includes(key) && !Object.hasOwn(totals, key)
          ? 0n
          : amount(totals?.[key]),
      ])
    )
    const missing = Object.keys(raw).filter((key) => raw[key] === null)
    if (missing.length) {
      missingOrderCount++
      warnings.push({
        code: 'missing-amounts',
        orderId: snapshot.orderId ?? '',
        fields: missing,
      })
    }
    // Source row discounts can already include seller changes, and wholesale
    // reductions can already be in unit prices. Present each reduction once.
    const amounts = {
      originalTotal: raw.goodsGross,
      shipping: raw.shipping,
      sellerAdjustment: raw.orderAdjustment,
      productDiscount: derive(
        [
          raw.sourceDiscount,
          raw.rowIncludedAdjustment,
          raw.priceIncludedDiscount,
        ],
        (source, sellerIncluded, priceIncluded) =>
          source - sellerIncluded + priceIncluded
      ),
      orderDiscount: raw.orderDiscount,
      redPacketDiscount: raw.redPacketDiscount,
      customizationService: derive(
        [raw.customizationService, raw.grossIncludedCustomization],
        (service, grossIncluded) => service - grossIncluded
      ),
      payable: raw.payable,
    }
    const payable = derive(
      amountFields.map((field) => amounts[field]),
      (gross, shipping, seller, product, order, packet, service) =>
        gross + shipping - seller - product - order - packet + service
    )
    const goodsNet = derive(
      [
        amounts.originalTotal,
        raw.grossIncludedCustomization,
        amounts.sellerAdjustment,
        amounts.productDiscount,
        amounts.orderDiscount,
      ],
      (gross, serviceIncluded, seller, product, order) =>
        gross - serviceIncluded - seller - product - order
    )
    if (
      (payable !== null && payable !== raw.payable) ||
      (goodsNet !== null &&
        raw.goodsNet !== null &&
        goodsNet !== raw.goodsNet) ||
      Object.entries(amounts).some(
        ([field, value]) =>
          field !== 'sellerAdjustment' && value !== null && value < 0n
      )
    ) {
      inconsistentOrderCount++
      warnings.push({
        code: 'inconsistent-amounts',
        orderId: snapshot.orderId ?? '',
      })
    }
    for (const [key, value] of Object.entries(amounts)) {
      if (value === null) unknownCounts[key]++
      else known[key] += value
    }
  }

  const knownAmounts = Object.fromEntries(
    amountFields.map((key) => [key, centsToMoney(known[key])])
  )
  return {
    scope: 'complete-orders',
    orderCount: orders.size,
    productRowCount,
    amounts: Object.fromEntries(
      amountFields.map((key) => [
        key,
        unknownCounts[key] ? null : knownAmounts[key],
      ])
    ),
    knownAmounts,
    unknownCounts,
    missingOrderCount,
    inconsistentOrderCount,
    foreignCurrencyFeeUnknownCount,
    reconciled: inconsistentOrderCount
      ? false
      : missingOrderCount
        ? null
        : true,
    warnings,
  }
}
