import {
  PACKING_WORKBOOK_COLUMNS,
  PACKING_WORKBOOK_COLUMN_ORDER,
  PACKING_WORKBOOK_DEFAULT_COLUMNS,
} from './packing-workbook.js'

export const PACKING_EXPORT_PREFERENCE = '1688-packing-export'
export const packingExportColumns = PACKING_WORKBOOK_COLUMNS
const keys = packingExportColumns.map(({ key }) => key)
let sessionPreference
let pendingPreference = false

export function normalizePackingExportOptions(value) {
  const savedOrder = [
    ...new Set(Array.isArray(value?.order) ? value.order : []),
  ].filter((key) => keys.includes(key))
  const savedSelected = [
    ...new Set(Array.isArray(value?.selected) ? value.selected : []),
  ].filter((key) => keys.includes(key))
  // Upgrade only the former untouched 31-column layout. Authored layouts survive.
  const legacyKeys = keys.filter((key) => key !== 'cartonMark')
  const legacyDefault =
    !value?.layoutVersion &&
    savedSelected.length === legacyKeys.length &&
    savedOrder.length === legacyKeys.length &&
    savedOrder.every((key, index) => key === legacyKeys[index])
  const order = [...(legacyDefault ? [] : savedOrder)]
  order.push(
    ...PACKING_WORKBOOK_COLUMN_ORDER.filter((key) => !order.includes(key))
  )
  return {
    layoutVersion: 2,
    order,
    selected:
      !legacyDefault && Array.isArray(value?.selected)
        ? savedSelected
        : [...PACKING_WORKBOOK_DEFAULT_COLUMNS],
    scope: value?.scope === 'selected' ? 'selected' : 'all',
    photoSize: ['compact', 'standard', 'large'].includes(value?.photoSize)
      ? value.photoSize
      : 'standard',
    descriptionWidth: Number.isFinite(value?.descriptionWidth)
      ? Math.max(
          24,
          Math.min(60, 24 + Math.round((value.descriptionWidth - 24) / 4) * 4)
        )
      : 36,
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
