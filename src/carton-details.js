/** Local measurements override source measurements without rewriting evidence. */
import { cartonBreakdown } from './carton-packing.js'
import { validateCartonDetails } from './store-order.js'

/** Decimal editing never rounds source measurements or interprets thousands. */
export function normalizeCartonMeasurement(value, field) {
  if (!['kg', 'cbm'].includes(field))
    throw new TypeError('Unknown carton measurement field')
  if (value === undefined || value === null || value === '') return ''
  const invalid = () => {
    throw new Error(
      field === 'kg'
        ? 'Weight must be a nonnegative decimal in kg'
        : 'Volume must be a nonnegative decimal in m³'
    )
  }
  if (!['string', 'number'].includes(typeof value)) return invalid()
  const text = String(value).trim()
  if (!text) return ''
  // A single comma means a decimal separator. Grouped numbers, unit suffixes,
  // exponents and incomplete drafts are intentionally never guessed.
  if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text)) return invalid()
  const [integer, fraction = ''] = text.replace(',', '.').split('.')
  const whole = (integer || '0').replace(/^0+(?=\d)/, '')
  const decimals = fraction.replace(/0+$/, '')
  const normalized = decimals ? `${whole}.${decimals}` : whole
  return validateCartonDetails({ [field]: normalized })[field]
}

export function formatCartonMeasurement(value, field) {
  const normalized = normalizeCartonMeasurement(value, field)
  return normalized === ''
    ? '—'
    : `${normalized} ${field === 'kg' ? 'kg' : 'm³'}`
}

export function productCartonDetails(item, record) {
  return record?.cartonDetails?.[item.entryId] ?? item.carton ?? {}
}

export function cartonVolume(details) {
  const dimensions = [details.len, details.wid, details.ht].map(Number)
  if (dimensions.every((number) => Number.isFinite(number) && number > 0))
    return String(
      Number((dimensions.reduce((a, b) => a * b, 1) / 1_000_000).toFixed(9))
    )
  return details.cbm ?? ''
}

/** Count each supplier row's cartons once, including combined variants. */
export function cartonPackingForItems(record, entryIds) {
  const ids = new Set(entryIds),
    rows = [],
    seen = new Set(),
    snapshot = record?.snapshot
  for (const item of snapshot?.items || []) {
    if (!ids.has(item.entryId)) continue
    const carton = productCartonDetails(item, record)
    if (snapshot.sourceType === 'spreadsheet' && item.sourceRow) {
      if (seen.has(item.sourceRow)) continue
      seen.add(item.sourceRow)
      const source = snapshot.spreadsheet.rows.find(
        (row) => row.row === item.sourceRow
      )
      const members = snapshot.items.filter(
        (entry) => entry.sourceRow === item.sourceRow
      )
      const included = members.every((entry) => ids.has(entry.entryId))
      // A measurement edit on one allocated variant does not create another
      // physical set of cartons. Conflicting authored counts require review.
      const authoredCounts = [
        ...new Set(
          members
            .map((entry) => record.cartonDetails?.[entry.entryId]?.boxes)
            .filter((value) => value !== undefined)
            .map(Number)
        ),
      ]
      const count = authoredCounts[0] ?? Number(source?.boxes)
      const exact =
        included &&
        authoredCounts.length <= 1 &&
        Number.isSafeInteger(count) &&
        count > 0
      rows.push({
        entryId: item.entryId,
        sourceRow: item.sourceRow,
        status: exact ? 'exact' : 'partial',
        unitsPerCarton: source?.perbox ? Number(source.perbox) : null,
        fullCartons: exact ? count : 0,
        remainder: null,
        explicit: true,
      })
    } else {
      const breakdown = cartonBreakdown(
        item.quantity,
        record.unitsPerCarton?.[item.entryId]
      )
      const manualBoxes = Number(carton.boxes)
      if (Number.isSafeInteger(manualBoxes) && manualBoxes > 0)
        rows.push({
          entryId: item.entryId,
          ...breakdown,
          status: breakdown.status === 'partial' ? 'partial' : 'exact',
          fullCartons: manualBoxes,
          explicit: true,
        })
      else rows.push({ entryId: item.entryId, ...breakdown })
    }
  }
  const total = rows.reduce((sum, row) => sum + (row.fullCartons || 0), 0)
  const exact =
    rows.length > 0 &&
    rows.every((row) => row.status === 'exact') &&
    Number.isSafeInteger(total)
  return {
    rows,
    total,
    exact,
    requiresReview:
      rows.some((row) => row.explicit || row.unitsPerCarton !== null) && !exact,
  }
}
