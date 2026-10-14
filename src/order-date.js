/** 1688 renders purchase timestamps in China Standard Time, without an offset. */
export function purchaseTimestamp(value) {
  if (typeof value !== 'string') return undefined
  const match = value
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\+08:00)?$/)
  if (!match) return undefined
  const local = `${match[1]}T${match[2]}`
  const parsed = Date.parse(`${local}Z`)
  // Round-trip explicitly: Date.parse accepts impossible dates such as Feb 30.
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 19) !== local
  )
    return undefined
  return `${local}+08:00`
}
