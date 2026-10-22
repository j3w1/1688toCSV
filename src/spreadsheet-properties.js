const key = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

/** Read-only recognition input. Spreadsheet descriptions contain marked cells,
 * unlike 1688 titles, which can contain unrelated marketing text and numbers. */
export function recognitionProperties(item = {}) {
  item ??= {}
  const properties = Array.isArray(item.skuProperties) ? item.skuProperties : []
  if (!String(item.sourceGroup ?? '').trim()) return properties
  const result = [...properties]
  const seen = new Set(properties.map((property) => key(property.value)))
  if (item.productNumber) seen.add(key(item.productNumber))
  for (const fragment of String(item.description || item.title || '').split(
    /\s+[·•]\s+|[\r\n]+/u
  )) {
    const match = fragment.match(/^\s*([^:：]{1,40}?)\s*[:：]\s*(.+)$/u)
    const label = match ? match[1].trim() : ''
    const value = (match ? match[2] : fragment).trim()
    if (!value || seen.has(key(value))) continue
    result.push({ label, value })
    seen.add(key(value))
  }
  return result
}
