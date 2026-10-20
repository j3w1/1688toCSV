/** A blank capacity clears the product annotation; every saved value is exact. */
export function normalizeUnitsPerCarton(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null
  if (typeof value === 'string') {
    if (!/^\d+$/.test(value.trim()))
      throw new Error('Pack size must be a positive whole number')
    value = Number(value.trim())
  }
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error('Pack size must be a positive whole number')
  return value
}

/** Remainders describe products awaiting a packing decision, never a mixed box. */
export function cartonBreakdown(quantity, capacity) {
  let unitsPerCarton = null
  try {
    unitsPerCarton = normalizeUnitsPerCarton(capacity)
  } catch {
    // Invalid legacy/input capacity is unknown until a valid edit is saved.
  }
  const unknown = {
    status: 'unknown',
    unitsPerCarton,
    fullCartons: null,
    remainder: null,
    estimatedCartons: null,
  }
  if (typeof quantity === 'string') {
    // Check decimal text before conversion so rounding cannot hide fractions.
    if (!/^\d+(?:\.0+)?$/.test(quantity.trim())) return unknown
    quantity = Number(quantity.trim())
  }
  if (
    unitsPerCarton === null ||
    !Number.isSafeInteger(quantity) ||
    quantity < 0
  )
    return unknown
  const units = BigInt(quantity)
  const capacityUnits = BigInt(unitsPerCarton)
  const fullCartons = Number(units / capacityUnits)
  const remainder = Number(units % capacityUnits)
  return {
    status: remainder ? 'partial' : 'exact',
    unitsPerCarton,
    fullCartons,
    remainder,
    estimatedCartons: fullCartons + (remainder ? 1 : 0),
  }
}
