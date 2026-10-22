import { moneyToCents, centsToMoney, lineGrossCents } from './money.js'
import {
  allocateCostCents,
  orderCostAdjustments,
  costAdjustedUnitPrice,
} from './order-charges.js'
import { wholeUnits, inventoryError } from './inventory-model.js'

// A cumulative source-row interval gives the final partial shipment every
// remaining cent. It never reapplies the full freight/discount to each shipment.
export function shipmentIntervalCents(total, purchased, from, quantity) {
  const q = wholeUnits(purchased),
    a = wholeUnits(from),
    n = wholeUnits(quantity)
  if (!q || a + n > q)
    throw inventoryError(
      'SHIPMENT_VALUE_QUANTITY',
      'Shipment value exceeds its source quantity.'
    )
  const round = (units) =>
    total < 0n ? -((-total * units + q / 2n) / q) : (total * units + q / 2n) / q
  return round(a + n) - round(a)
}
export function shipmentMoney(
  record,
  quantities,
  priorQuantities = {},
  records = [record]
) {
  const items = record.snapshot.items,
    costs = orderCostAdjustments(record)
  const rowDiscounts = allocateCostCents(
    items,
    moneyToCents(record.snapshot.totals.orderDiscount || '0.00')
  )
  const freight = allocateCostCents(
    items,
    moneyToCents(record.snapshot.totals.shipping || '0.00')
  )
  const extras =
    moneyToCents(record.snapshot.totals.customizationService || '0.00') -
    moneyToCents(record.snapshot.totals.redPacketDiscount || '0.00')
  const sourceExtras = new Map(
    [...allocateCostCents(items, extras < 0n ? -extras : extras)].map(
      ([id, value]) => [id, extras < 0n ? -value : value]
    )
  )
  let linkedTotal = 0n
  for (const link of record.paymentLinks || [])
    linkedTotal += moneyToCents(link.amount || '0.00')
  const linked = allocateCostCents(items, linkedTotal)
  return items
    .filter((item) => wholeUnits(quantities[item.entryId] || '0') > 0n)
    .map((item) => {
      const quantity = String(quantities[item.entryId]),
        previous = String(priorQuantities[item.entryId] || '0'),
        whole = item.quantity
      const share = (value) =>
        shipmentIntervalCents(value, whole, previous, quantity)
      const gross = lineGrossCents(item.price, whole),
        sourceDiscount = share(moneyToCents(item.sourceDiscount || '0.00'))
      const allocatedDiscount = share(
        moneyToCents(item.allocatedDiscount || '0.00') +
          (rowDiscounts.get(item.entryId) || 0n)
      )
      const net = share(
        gross -
          moneyToCents(item.discount || '0.00') -
          (rowDiscounts.get(item.entryId) || 0n)
      )
      const additionalCharge = share(
        moneyToCents(costs.get(item.entryId).additionalCharge) +
          (sourceExtras.get(item.entryId) || 0n)
      )
      const featureCharge = share(
          moneyToCents(costs.get(item.entryId).featureCharge)
        ),
        linkedPaymentCharge = share(linked.get(item.entryId) || 0n)
      const freightAllocated = share(freight.get(item.entryId) || 0n),
        effective = net + additionalCharge + featureCharge + linkedPaymentCharge
      return {
        entryId: item.entryId,
        quantity,
        price: item.price,
        sourcePrice: item.price,
        sourceUnitPrice: item.price,
        effectiveUnitPrice: costAdjustedUnitPrice(
          item.price,
          effective - share(gross),
          quantity
        ),
        discount: centsToMoney(sourceDiscount + allocatedDiscount),
        sourceDiscount: centsToMoney(sourceDiscount),
        allocatedDiscount: centsToMoney(allocatedDiscount),
        sourceAmount: centsToMoney(net),
        merchandiseValue: centsToMoney(net),
        effectiveAmount: centsToMoney(effective),
        additionalCharge: centsToMoney(additionalCharge),
        featureCharge: centsToMoney(featureCharge),
        linkedPaymentCharge: centsToMoney(linkedPaymentCharge),
        freightAllocated: centsToMoney(freightAllocated),
        freightAllocationBasis: 'cumulative-source-row-net-value-and-quantity',
        valuation: {
          sourceQuantity: whole,
          from: previous,
          quantity,
          sourceNet: centsToMoney(
            gross -
              moneyToCents(item.discount || '0.00') -
              (rowDiscounts.get(item.entryId) || 0n)
          ),
          additionalReasons: structuredClone(record.additionalCharges || []),
        },
      }
    })
}
