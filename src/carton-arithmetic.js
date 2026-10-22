/** Exact, bounded decimal arithmetic. No floats, locale guessing or implicit rounding. */
function decimal(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value))
    value = String(value)
  if (
    typeof value !== 'string' ||
    value.length > 240 ||
    !/^-?\d+(?:\.\d+)?$/.test(value)
  )
    throw new Error('Expected an exact decimal string')
  const [whole, fraction = ''] = value.split('.')
  return { units: BigInt(whole + fraction), scale: fraction.length }
}

function format(units, scale) {
  const sign = units < 0n ? '-' : ''
  const digits = String(units < 0n ? -units : units).padStart(scale + 1, '0')
  const fraction = scale ? digits.slice(-scale).replace(/0+$/, '') : ''
  return `${units === 0n ? '' : sign}${scale ? digits.slice(0, -scale) : digits}${fraction ? `.${fraction}` : ''}`
}

export function exactDecimal(value) {
  const { units, scale } = decimal(value)
  return format(units, scale)
}

export function exactWhole(value, { positive = false } = {}) {
  const normalized = exactDecimal(value)
  if (!/^\d+$/.test(normalized) || (positive && normalized === '0'))
    throw new Error('Expected a nonnegative whole quantity')
  return normalized
}

export function addExact(...values) {
  const parts = values.map(decimal)
  const scale = Math.max(0, ...parts.map((part) => part.scale))
  return format(
    parts.reduce(
      (sum, part) => sum + part.units * 10n ** BigInt(scale - part.scale),
      0n
    ),
    scale
  )
}

export function subtractExact(left, right) {
  const b = decimal(right)
  return addExact(left, format(-b.units, b.scale))
}

export function compareExact(left, right) {
  const result = decimal(subtractExact(left, right)).units
  return result < 0n ? -1 : result > 0n ? 1 : 0
}

export function multiplyExact(...values) {
  const parts = values.map(decimal)
  return format(
    parts.reduce((product, part) => product * part.units, 1n),
    parts.reduce((sum, part) => sum + part.scale, 0)
  )
}

export function dividePowerOfTen(value, places) {
  if (!Number.isSafeInteger(places) || places < 0 || places > 240)
    throw new Error('Invalid decimal scale')
  const part = decimal(value)
  return format(part.units, part.scale + places)
}

/** Large quantities stay strings; a UI/domain count must separately check safe integers. */
export function wholeCartonBreakdown(quantity, capacity) {
  const q = BigInt(exactWhole(quantity)),
    c = BigInt(exactWhole(capacity, { positive: true }))
  return { fullCartons: String(q / c), remainder: String(q % c) }
}

/** Costing allocation only, never physical per-box evidence. Largest remainder, stable IDs. */
export function allocateExactDecimal(total, entries, { places = 6 } = {}) {
  const amount = decimal(total)
  if (!Number.isSafeInteger(places) || places < 0 || places > 120)
    throw new Error('Invalid allocation precision')
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
    throw new Error('Allocation IDs must be unique')
  const scale = Math.max(places, amount.scale)
  const units = amount.units * 10n ** BigInt(scale - amount.scale)
  const sign = units < 0n ? -1n : 1n,
    absolute = units * sign
  const rows = entries.map((entry) => ({
    id: entry.id,
    quantity: BigInt(exactWhole(entry.quantity)),
    units: 0n,
    remainder: 0n,
  }))
  const quantity = rows.reduce((sum, row) => sum + row.quantity, 0n)
  if (quantity === 0n && absolute !== 0n)
    throw new Error('Cannot allocate a nonzero measurement without quantities')
  for (const row of rows) {
    row.units = quantity ? (absolute * row.quantity) / quantity : 0n
    row.remainder = quantity ? (absolute * row.quantity) % quantity : 0n
  }
  let left = absolute - rows.reduce((sum, row) => sum + row.units, 0n)
  const ranked = [...rows].sort((a, b) =>
    a.remainder !== b.remainder
      ? a.remainder > b.remainder
        ? -1
        : 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
  )
  for (const row of ranked)
    if (left > 0n) {
      row.units++
      left--
    }
  return rows.map((row) => ({
    id: row.id,
    value: format(row.units * sign, scale),
    basis: 'allocated',
  }))
}
