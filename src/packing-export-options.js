import {
  PACKING_PRODUCT_COLUMNS,
  PACKING_PRODUCT_COLUMN_ORDER,
  PACKING_PRODUCT_DEFAULT_COLUMNS,
  PACKING_WORKBOOK_DEFAULT_COLUMNS,
  PACKING_WORKBOOK_COLUMN_ORDER,
  PACKING_WORKBOOK_COLUMNS,
  PACKING_CARTON_COLUMNS,
  PACKING_CARTON_COLUMN_ORDER,
  PACKING_CARTON_DEFAULT_COLUMNS,
} from './packing-workbook.js'

export const PACKING_EXPORT_PREFERENCE = '1688-packing-export'
export const packingExportColumns = PACKING_PRODUCT_COLUMNS
export const packingCartonExportColumns = PACKING_CARTON_COLUMNS
const keys = packingExportColumns.map(({ key }) => key)
const cartonKeys = PACKING_CARTON_COLUMN_ORDER
const cartonMigration = {
  plannedBoxes: 'count',
  receivedBoxes: 'received',
  loadedBoxes: 'loaded',
  cartonLength: 'len',
  cartonWidth: 'wid',
  cartonHeight: 'ht',
  cartonWeight: 'weight',
  cartonVolume: 'volumePerCarton',
  loadedWeight: 'loadedWeight',
  loadedVolume: 'loadedVolume',
}
let sessionPreference
let pendingPreference = false

export function normalizePackingExportOptions(value) {
  const savedOrder = [
    ...new Set(Array.isArray(value?.order) ? value.order : []),
  ].filter((key) => keys.includes(key))
  const savedSelected = [
    ...new Set(Array.isArray(value?.selected) ? value.selected : []),
  ].filter((key) => keys.includes(key))
  // Upgrade untouched defaults. Authored product/physical choices move to their sheet.
  const rawOrder = Array.isArray(value?.order) ? value.order : [],
    sameOrder = (a, b) =>
      a.length === b.length && a.every((key, index) => key === b[index]),
    formerReferenceOrder = PACKING_WORKBOOK_COLUMNS.map(
      ({ key }) => key
    ).filter((key) => key !== 'cartonMark'),
    legacyOrder = rawOrder.filter((key) =>
      PACKING_WORKBOOK_COLUMN_ORDER.includes(key)
    ),
    untouchedOrder =
      sameOrder(rawOrder, PACKING_WORKBOOK_COLUMN_ORDER) ||
      (!value?.layoutVersion && sameOrder(legacyOrder, formerReferenceOrder))
  const legacyDefault =
    value?.layoutVersion !== 3 &&
    untouchedOrder &&
    Array.isArray(value?.selected) &&
    ((value.selected.length === PACKING_WORKBOOK_DEFAULT_COLUMNS.length &&
      PACKING_WORKBOOK_DEFAULT_COLUMNS.every((key) =>
        value.selected.includes(key)
      )) ||
      (!value?.layoutVersion &&
        value.selected.length >= 25 &&
        value.selected.includes('orderQuantity'))) &&
    keys
      .filter(
        (key) =>
          !['cartonReferences', 'cartonMark', 'sourceUnitPrice'].includes(key)
      )
      .every((key) => savedSelected.includes(key))
  const order = [...(legacyDefault ? [] : savedOrder)]
  order.push(
    ...PACKING_PRODUCT_COLUMN_ORDER.filter((key) => !order.includes(key))
  )
  const oldCartonOrder = (
      Array.isArray(value?.order) ? value.order : []
    ).flatMap((key) => (cartonMigration[key] ? [cartonMigration[key]] : [])),
    oldCartonSelected = (
      Array.isArray(value?.selected) ? value.selected : []
    ).flatMap((key) => (cartonMigration[key] ? [cartonMigration[key]] : [])),
    cartonValue = value?.cartons,
    cartonOrder = [
      ...new Set(
        (Array.isArray(cartonValue?.order)
          ? cartonValue.order
          : !legacyDefault && oldCartonOrder.length
            ? oldCartonOrder
            : []
        ).filter((key) => cartonKeys.includes(key))
      ),
    ],
    cartonSelected = Array.isArray(cartonValue?.selected)
      ? [
          ...new Set(
            cartonValue.selected.filter((key) => cartonKeys.includes(key))
          ),
        ]
      : !legacyDefault && oldCartonSelected.length
        ? [
            ...new Set([
              'batch',
              'cartonMark',
              'contents',
              ...oldCartonSelected,
            ]),
          ]
        : [...PACKING_CARTON_DEFAULT_COLUMNS]
  cartonOrder.push(...cartonKeys.filter((key) => !cartonOrder.includes(key)))
  return {
    layoutVersion: 3,
    order,
    selected:
      !legacyDefault && Array.isArray(value?.selected)
        ? savedSelected
        : [...PACKING_PRODUCT_DEFAULT_COLUMNS],
    cartons: { order: cartonOrder, selected: cartonSelected },
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
    includeAutomationJson: value?.includeAutomationJson === true,
    ...Object.fromEntries(
      ['includeOrderDetails', 'includeTotals', 'freezeHeaders', 'filters'].map(
        (key) => [key, value?.[key] !== false]
      )
    ),
  }
}

export function selectedPackingExportColumns(options, sheet = 'products') {
  const value = sheet === 'cartons' ? options.cartons : options
  return value.order.filter((key) => value.selected.includes(key))
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
