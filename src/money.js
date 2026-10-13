const decimalPattern = /^(-?)(\d+)(?:\.(\d+))?$/

function decimal(value) {
  const match = typeof value === 'string' && value.match(decimalPattern)
  if (!match) throw new Error('Money must be an exact decimal string.')
  return {
    negative: match[1] === '-',
    whole: match[2],
    fraction: match[3] || '',
  }
}

export function moneyToCents(value) {
  const { negative, whole, fraction } = decimal(value)
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2)))
    throw new Error('A monetary total has more than two decimal places.')
  const cents = BigInt(whole + fraction.slice(0, 2).padEnd(2, '0'))
  return negative ? -cents : cents
}

export function centsToMoney(value) {
  const absolute = value < 0n ? -value : value
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}

// Unit prices may have fractional cents. Multiply the exact decimal first,
// then round the product-row amount once, half up, to the currency's cents.
export function lineGrossCents(price, quantity) {
  const { negative, whole, fraction } = decimal(price)
  if (negative || typeof quantity !== 'string' || !/^[1-9]\d*$/.test(quantity))
    throw new Error('Product price or quantity is invalid.')
  const scale = 10n ** BigInt(Math.max(2, fraction.length))
  const units = BigInt(
    whole + fraction.padEnd(Math.max(2, fraction.length), '0')
  )
  return (units * BigInt(quantity) * 100n + scale / 2n) / scale
}

export function normalizePrice(value) {
  const { negative, whole, fraction } = decimal(value)
  if (negative) throw new Error('Product price must not be negative.')
  return `${BigInt(whole)}.${fraction.replace(/0+$/, '').padEnd(2, '0')}`
}
