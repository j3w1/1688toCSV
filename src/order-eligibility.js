import { wholeUnits, inventoryError, stableValue } from './inventory-model.js'

export function validateInventoryDispositions(input = {}, record) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw inventoryError(
      'INVALID_DISPOSITION',
      'Inventory dispositions must be keyed by source product.'
    )
  const ids = new Map(record.snapshot.items.map((item) => [item.entryId, item]))
  const result = {}
  for (const [entryId, disposition] of Object.entries(input)) {
    if (!ids.has(entryId))
      throw inventoryError(
        'INVALID_DISPOSITION',
        'The source product is not in this purchase.',
        { entryId }
      )
    if (disposition == null) continue
    if (
      !['non-goods', 'fee', 'payment-only', 'canceled'].includes(
        disposition.kind
      ) ||
      typeof disposition.reason !== 'string' ||
      !disposition.reason.trim()
    )
      throw inventoryError(
        'INVALID_DISPOSITION',
        'Explain the supported inventory exclusion.',
        { entryId }
      )
    const quantity =
      disposition.kind === 'canceled'
        ? wholeUnits(disposition.quantity, 'Canceled quantity')
        : wholeUnits(ids.get(entryId).quantity)
    if (quantity > wholeUnits(ids.get(entryId).quantity))
      throw inventoryError(
        'INVALID_DISPOSITION',
        'Canceled quantity exceeds the purchase.',
        { entryId }
      )
    result[entryId] = {
      kind: disposition.kind,
      ...(disposition.kind === 'canceled'
        ? { quantity: String(quantity) }
        : {}),
      reason: disposition.reason.trim(),
      ...(disposition.updatedAt ? { updatedAt: disposition.updatedAt } : {}),
    }
  }
  return result
}
export function resolvedPurchaseDate(date) {
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) ||
    new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw inventoryError(
      'INVALID_PURCHASE_DATE',
      'Choose a valid original purchase calendar date.'
    )
  return date
}
export function mergeInventoryMetadata(previous, incoming, next = previous) {
  let result = next
  for (const [field, clock] of [
    ['inventoryDispositions', 'inventoryDispositionsUpdatedAt'],
    ['purchaseDateResolution', 'purchaseDateResolutionUpdatedAt'],
    ['supplierIdentityResolution', 'supplierIdentityResolutionUpdatedAt'],
    ['supplierCodeIdentityReview', 'supplierCodeIdentityReviewUpdatedAt'],
  ]) {
    const oldClock = previous[clock] || '',
      newClock = incoming[clock] || ''
    if (!newClock || newClock < oldClock) continue
    if (
      oldClock === newClock &&
      stableValue(previous[field]) !== stableValue(incoming[field])
    )
      throw inventoryError(
        'RESTORE_CONFLICT',
        'Inventory metadata conflicts at the same revision.',
        { field }
      )
    result = {
      ...result,
      [field]: structuredClone(incoming[field]),
      [clock]: newClock,
      inventoryMetadataHistory: [
        ...new Map(
          [
            ...(previous.inventoryMetadataHistory || []),
            ...(incoming.inventoryMetadataHistory || []),
          ].map((entry) => [stableValue(entry), entry])
        ).values(),
      ],
    }
  }
  return result
}
