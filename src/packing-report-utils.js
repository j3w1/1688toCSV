/** Pure JSON/exact-decimal utilities shared only by report intake. */
export const REPORT_LIMITS = Object.freeze({
  textBytes: 5 * 1024 * 1024,
  sheets: 20,
  cells: 50000,
  rows: 10000,
  columns: 100,
  cellText: 32768,
  entitlements: 10000,
  archiveBytes: 200 * 1024 * 1024,
  archiveMembers: 10000,
})

export function limitsFor(limits = {}) {
  const result = { ...REPORT_LIMITS }
  for (const [key, value] of Object.entries(limits)) {
    if (!(key in result) || !Number.isSafeInteger(value) || value < 1)
      throw new Error(`Invalid report limit: ${key}`)
    result[key] = Math.min(value, result[key])
  }
  return result
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}

// A compact UI key only. Semantic equivalence always compares full canonical facts.
export function keyFor(prefix, value) {
  let hash = 14695981039346656037n
  for (const character of canonical(value))
    hash = BigInt.asUintN(
      64,
      (hash ^ BigInt(character.codePointAt(0))) * 1099511628211n
    )
  return `${prefix}:${hash.toString(16)}`
}

export function issue(code, severity, scope, params = {}, sourceRefs = []) {
  return {
    id: keyFor(code, scope),
    code,
    severity,
    scope,
    messageKey: `packingReport.${code}`,
    params,
    sourceRefs,
  }
}

export function decimal(value) {
  const text = String(value)
  if (!/^\d+(?:\.\d+)?$/.test(text) || text.length > 60)
    throw new Error('Invalid exact decimal')
  const [whole, fraction = ''] = text.split('.')
  const tail = fraction.replace(/0+$/, '')
  return `${BigInt(whole)}${tail ? `.${tail}` : ''}`
}
function parts(value) {
  const [whole, fraction = ''] = decimal(value).split('.')
  return { units: BigInt(whole + fraction), scale: fraction.length }
}
function format(units, scale) {
  const negative = units < 0n
  const digits = String(negative ? -units : units).padStart(scale + 1, '0')
  return `${negative ? '-' : ''}${decimal(scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits)}`
}
export function sum(values) {
  const parsed = values.map(parts)
  const scale = Math.max(0, ...parsed.map((part) => part.scale))
  return format(
    parsed.reduce(
      (total, part) => total + part.units * 10n ** BigInt(scale - part.scale),
      0n
    ),
    scale
  )
}
export function difference(a, b) {
  const x = parts(a),
    y = parts(b),
    scale = Math.max(x.scale, y.scale)
  return format(
    x.units * 10n ** BigInt(scale - x.scale) -
      y.units * 10n ** BigInt(scale - y.scale),
    scale
  )
}
export function multiply(values, extraScale = 0) {
  const parsed = values.map(parts)
  return format(
    parsed.reduce((total, part) => total * part.units, 1n),
    extraScale + parsed.reduce((total, part) => total + part.scale, 0)
  )
}
export function cellRef(cell) {
  return {
    sheet: cell.sheet,
    row: cell.row,
    col: cell.col,
    address: cell.address,
  }
}
export function columnAddress(col) {
  let text = ''
  for (let n = col; n; n = Math.floor((n - 1) / 26))
    text = String.fromCharCode(65 + ((n - 1) % 26)) + text
  return text
}
export function multiset(values) {
  return values.map(canonical).sort()
}
export function clone(value) {
  return structuredClone(value)
}
