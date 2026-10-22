import { getLocale } from './i18n.js'

/** Display exact decimal money without converting its value to a floating point number. */
export function formatCny(value, locale = getLocale()) {
  const match = String(value).match(/^([+−-]?)(\d+)(?:\.(\d+))?$/)
  if (!match) throw new Error('Money must be an exact decimal string.')
  const decimal = new Intl.NumberFormat(locale)
    .formatToParts(1.1)
    .find((part) => part.type === 'decimal').value
  const sign = match[1] === '-' || match[1] === '−' ? '−' : match[1]
  return `${sign}¥${BigInt(match[2]).toLocaleString(locale)}${decimal}${(match[3] || '').padEnd(2, '0')}`
}
