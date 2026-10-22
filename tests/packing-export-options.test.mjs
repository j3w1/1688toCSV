import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PACKING_EXPORT_PREFERENCE,
  normalizePackingExportOptions,
  selectedPackingExportColumns,
  readPackingExportOptions,
  savePackingExportOptions,
} from '../src/packing-export-options.js'
import {
  PACKING_PRODUCT_COLUMN_ORDER as PACKING_WORKBOOK_COLUMN_ORDER,
  PACKING_PRODUCT_DEFAULT_COLUMNS as PACKING_WORKBOOK_DEFAULT_COLUMNS,
  PACKING_CARTON_DEFAULT_COLUMNS,
  PACKING_WORKBOOK_COLUMN_ORDER as LEGACY_COLUMN_ORDER,
} from '../src/packing-workbook.js'

test('packing export choices retain only supported columns in the chosen order and preserve explicit clears', () => {
  const defaults = normalizePackingExportOptions()
  assert.deepEqual(
    selectedPackingExportColumns(defaults),
    PACKING_WORKBOOK_DEFAULT_COLUMNS
  )
  assert.equal(selectedPackingExportColumns(defaults).length, 13)
  assert.equal(defaults.order.length, 14)
  assert.deepEqual(
    selectedPackingExportColumns(defaults, 'cartons'),
    PACKING_CARTON_DEFAULT_COLUMNS
  )
  assert.ok(!defaults.order.includes('store'))
  assert.ok(!defaults.order.includes('orderQuantity'))
  assert.equal(defaults.scope, 'all')
  assert.equal(defaults.descriptionWidth, 36)
  const value = normalizePackingExportOptions({
    order: ['quantity', 'barcode', 'payments', 'quantity'],
    selected: ['barcode', 'quantity', 'made-up'],
    photoSize: 'large',
    descriptionWidth: 500,
    includeTotals: false,
    filters: false,
  })
  assert.deepEqual(selectedPackingExportColumns(value), ['quantity', 'barcode'])
  assert.equal(value.photoSize, 'large')
  assert.equal(value.descriptionWidth, 60)
  assert.equal(value.includeTotals, false)
  assert.equal(value.filters, false)
  assert.deepEqual(
    selectedPackingExportColumns(
      normalizePackingExportOptions({ selected: [] })
    ),
    []
  )
})

test('the former untouched column layout upgrades without resetting authored export controls', () => {
  const legacy = [
    'store',
    'photo',
    'barcode',
    'description',
    'spanishName',
    'productNumber',
    'sourceSize',
    'loadedBoxes',
    'receivedBoxes',
    'plannedBoxes',
    'unitsPerCarton',
    'quantity',
    'orderQuantity',
    'sourceUnitPrice',
    'orderShipping',
    'discount',
    'effectiveUnitPrice',
    'effectiveAmount',
    'cartonWeight',
    'receivedWeight',
    'loadedWeight',
    'cartonLength',
    'cartonWidth',
    'cartonHeight',
    'cartonVolume',
    'receivedVolume',
    'loadedVolume',
    'orderAmount',
    'totalLoadedWeight',
    'totalLoadedVolume',
    'totalLoadedBoxes',
  ]
  const value = normalizePackingExportOptions({
    order: legacy,
    selected: legacy,
    photoSize: 'compact',
    descriptionWidth: 32,
    scope: 'selected',
    filters: false,
  })
  assert.deepEqual(value.order, PACKING_WORKBOOK_COLUMN_ORDER)
  assert.deepEqual(value.selected, PACKING_WORKBOOK_DEFAULT_COLUMNS)
  assert.equal(value.photoSize, 'compact')
  assert.equal(value.descriptionWidth, 32)
  assert.equal(value.scope, 'selected')
  assert.equal(value.filters, false)
  const custom = normalizePackingExportOptions({
    order: ['barcode', 'store', 'quantity'],
    selected: ['barcode', 'store', 'quantity'],
  })
  assert.deepEqual(selectedPackingExportColumns(custom), [
    'barcode',
    'quantity',
  ])
  const all = normalizePackingExportOptions({ ...value, selected: value.order })
  assert.equal(selectedPackingExportColumns(all).length, 14)
})

test('authored physical columns migrate to Cartons without resetting product order or explicit clears', () => {
  const migrated = normalizePackingExportOptions({
    layoutVersion: 2,
    order: [
      'loadedBoxes',
      'barcode',
      'cartonVolume',
      'cartonWeight',
      'quantity',
    ],
    selected: ['barcode', 'quantity', 'loadedBoxes', 'cartonWeight'],
  })
  assert.deepEqual(selectedPackingExportColumns(migrated), [
    'barcode',
    'quantity',
  ])
  assert.deepEqual(selectedPackingExportColumns(migrated, 'cartons'), [
    'loaded',
    'weight',
    'batch',
    'cartonMark',
    'contents',
  ])
  const changed = normalizePackingExportOptions({
    ...migrated,
    cartons: { order: ['loaded', 'count'], selected: [] },
  })
  assert.deepEqual(selectedPackingExportColumns(changed, 'cartons'), [])
  assert.deepEqual(normalizePackingExportOptions(changed), changed)
  const authoredOrder = [...LEGACY_COLUMN_ORDER].reverse(),
    authored = normalizePackingExportOptions({
      layoutVersion: 2,
      order: authoredOrder,
      selected: [...LEGACY_COLUMN_ORDER],
    })
  assert.deepEqual(
    selectedPackingExportColumns(authored),
    authoredOrder.filter((key) => PACKING_WORKBOOK_COLUMN_ORDER.includes(key))
  )
  assert.ok(authored.selected.includes('sourceUnitPrice'))
})

test('packing workbook options save independently and stay available after a denied storage write', () => {
  const entries = new Map(),
    storage = {
      getItem: (key) => entries.get(key),
      setItem: (key, value) => entries.set(key, value),
    }
  const options = normalizePackingExportOptions({
    selected: ['description', 'barcode'],
    order: ['description', 'barcode'],
    scope: 'selected',
    freezeHeaders: false,
  })
  assert.equal(savePackingExportOptions(options, storage), true)
  assert.deepEqual(readPackingExportOptions(storage), options)
  assert.deepEqual([...entries.keys()], [PACKING_EXPORT_PREFERENCE])
  const blocked = {
    getItem: storage.getItem,
    setItem: () => {
      throw new Error('unavailable')
    },
  }
  const changed = { ...options, photoSize: 'compact' }
  assert.equal(savePackingExportOptions(changed, blocked), false)
  assert.equal(readPackingExportOptions(blocked).photoSize, 'compact')
  assert.equal(savePackingExportOptions(options, storage), true)
})
