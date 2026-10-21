import { PACKING_WORKBOOK_COLUMNS } from './packing-workbook.js'

export const PACKING_EXPORT_PREFERENCE = '1688-packing-export'
export const packingExportColumns = PACKING_WORKBOOK_COLUMNS.filter(
  ({ key }) => !['payments', 'deposits', 'balance'].includes(key)
)
const keys = packingExportColumns.map(({ key }) => key)
let sessionPreference
let pendingPreference = false

export function normalizePackingExportOptions(value) {
  const order = [
    ...new Set(Array.isArray(value?.order) ? value.order : []),
  ].filter((key) => keys.includes(key))
  order.push(...keys.filter((key) => !order.includes(key)))
  return {
    order,
    selected: Array.isArray(value?.selected)
      ? [...new Set(value.selected)].filter((key) => keys.includes(key))
      : [...keys],
    scope: value?.scope === 'selected' ? 'selected' : 'all',
    photoSize: ['compact', 'standard', 'large'].includes(value?.photoSize)
      ? value.photoSize
      : 'standard',
    descriptionWidth: Number.isFinite(value?.descriptionWidth)
      ? Math.max(
          24,
          Math.min(60, 24 + Math.round((value.descriptionWidth - 24) / 4) * 4)
        )
      : 48,
    ...Object.fromEntries(
      ['includeOrderDetails', 'includeTotals', 'freezeHeaders', 'filters'].map(
        (key) => [key, value?.[key] !== false]
      )
    ),
  }
}

export function selectedPackingExportColumns(options) {
  return options.order.filter((key) => options.selected.includes(key))
}

export function readPackingExportOptions(storage = globalThis.localStorage) {
  if (pendingPreference) return normalizePackingExportOptions(sessionPreference)
  try {
    const saved = storage?.getItem(PACKING_EXPORT_PREFERENCE)
    return normalizePackingExportOptions(
      saved ? JSON.parse(saved) : sessionPreference
    )
  } catch {
    return normalizePackingExportOptions(sessionPreference)
  }
}

export function savePackingExportOptions(
  value,
  storage = globalThis.localStorage
) {
  sessionPreference = normalizePackingExportOptions(value)
  try {
    storage.setItem(
      PACKING_EXPORT_PREFERENCE,
      JSON.stringify(sessionPreference)
    )
    pendingPreference = false
    return true
  } catch {
    pendingPreference = true
    return false
  }
}
