import { paymentCostAdjustments } from './payment-links.js'
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
export function shipmentFreeIntervals(purchased, quantity, occupied = []) {
  const maximum = wholeUnits(purchased),
    wanted = wholeUnits(quantity)
  const used = occupied
    .map((part) => ({
      from: wholeUnits(part.from),
      end: wholeUnits(part.from) + wholeUnits(part.quantity),
    }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  let cursor = 0n,
    remaining = wanted
  const result = []
  for (const part of [...used, { from: maximum, end: maximum }]) {
    if (part.from < cursor || part.end > maximum)
      throw inventoryError(
        'SHIPMENT_VALUE_CONFLICT',
        'Financial source intervals overlap or exceed the source row.'
      )
    const available = part.from - cursor,
      take = available < remaining ? available : remaining
    if (take > 0n) {
      result.push({ from: String(cursor), quantity: String(take) })
      remaining -= take
    }
    cursor = part.end
  }
  if (remaining > 0n)
    throw inventoryError(
      'SHIPMENT_VALUE_QUANTITY',
      'No unallocated source value interval remains for these goods.'
    )
  return result
}
export function shipmentMoney(
  record,
  quantities,
  priorQuantities = {},
  records = [record],
  occupiedIntervals = {},
  priorRows = null
) {
  const items = record.snapshot.items,
    costs = paymentCostAdjustments(record, records)
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
  return items
    .filter((item) => wholeUnits(quantities[item.entryId] || '0') > 0n)
    .map((item) => {
      const quantity = String(quantities[item.entryId]),
        previous = String(priorQuantities[item.entryId] || '0'),
        whole = item.quantity
      const intervals = occupiedIntervals[item.entryId]
        ? shipmentFreeIntervals(
            whole,
            quantity,
            occupiedIntervals[item.entryId]
          )
        : [{ from: previous, quantity }]
      const previousRows =
        priorRows?.filter((row) => row.entryId === item.entryId) || []
      const already = previousRows.reduce(
          (sum, row) => sum + wholeUnits(row.quantity),
          0n
        ),
        remainingQuantity = wholeUnits(whole) - already
      const budgets = {}
      const share = (value, field) => {
        if (priorRows === null)
          return intervals.reduce(
            (total, part) =>
              total +
              shipmentIntervalCents(value, whole, part.from, part.quantity),
            0n
          )
        const spent = previousRows.reduce(
            (total, row) =>
              total +
              (field === 'sourceGrossAmount' && !row.sourceGrossAmount
                ? moneyToCents(row.sourceAmount || '0.00') +
                  moneyToCents(row.discount || '0.00')
                : moneyToCents(row[field] || '0.00')),
            0n
          ),
          remaining = value - spent,
          n = wholeUnits(quantity)
        if (
          remainingQuantity <= 0n ||
          n > remainingQuantity ||
          (value >= 0n &&
            remaining < 0n &&
            [
              'sourceAmount',
              'sourceDiscount',
              'featureCharge',
              'linkedPaymentCharge',
              'freightAllocated',
            ].includes(field))
        )
          throw inventoryError(
            'SHIPMENT_VALUE_CONFLICT',
            'Frozen shipments exceed the current source value budget.',
            { entryId: item.entryId, field }
          )
        budgets[field] = {
          source: centsToMoney(value),
          alreadyAllocated: centsToMoney(spent),
          remaining: centsToMoney(remaining),
          remainingQuantity: String(remainingQuantity),
        }
        return remaining < 0n
          ? -((-remaining * n + remainingQuantity / 2n) / remainingQuantity)
          : (remaining * n + remainingQuantity / 2n) / remainingQuantity
      }
      const gross = lineGrossCents(item.price, whole),
        sourceDiscount = share(
          moneyToCents(item.sourceDiscount || '0.00'),
          'sourceDiscount'
        )
      const allocatedDiscount = share(
        moneyToCents(item.allocatedDiscount || '0.00') +
          (rowDiscounts.get(item.entryId) || 0n),
        'allocatedDiscount'
      )
      const sourceGrossAmount = share(gross, 'sourceGrossAmount')
      const net = sourceGrossAmount - sourceDiscount - allocatedDiscount
      const additionalCharge = share(
        moneyToCents(costs.get(item.entryId).additionalCharge) +
          (sourceExtras.get(item.entryId) || 0n),
        'additionalCharge'
      )
      const featureCharge = share(
          moneyToCents(costs.get(item.entryId).featureCharge),
          'featureCharge'
        ),
        linkedPaymentCharge = share(
          moneyToCents(costs.get(item.entryId).linkedPaymentCharge || '0.00'),
          'linkedPaymentCharge'
        )
      const freightAllocated = share(
          freight.get(item.entryId) || 0n,
          'freightAllocated'
        ),
        effective = net + additionalCharge + featureCharge + linkedPaymentCharge
      return {
        entryId: item.entryId,
        quantity,
        price: item.price,
        sourcePrice: item.price,
        sourceUnitPrice: item.price,
        effectiveUnitPrice: costAdjustedUnitPrice('0.00', effective, quantity),
        discount: centsToMoney(sourceDiscount + allocatedDiscount),
        sourceDiscount: centsToMoney(sourceDiscount),
        allocatedDiscount: centsToMoney(allocatedDiscount),
        sourceGrossAmount: centsToMoney(sourceGrossAmount),
        sourceAmount: centsToMoney(net),
        merchandiseValue: centsToMoney(net),
        effectiveAmount: centsToMoney(effective),
        additionalCharge: centsToMoney(additionalCharge),
        featureCharge: centsToMoney(featureCharge),
        linkedPaymentCharge: centsToMoney(linkedPaymentCharge),
        freightAllocated: centsToMoney(freightAllocated),
        freightAllocationBasis:
          priorRows === null
            ? 'cumulative-source-row-net-value-and-quantity'
            : 'remaining-source-cents-after-effective-shipments',
        valuation: {
          sourceQuantity: whole,
          from: intervals[0]?.from || previous,
          intervals: structuredClone(intervals),
          budgets,
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
