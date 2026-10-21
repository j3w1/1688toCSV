import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PACKING_EXPORT_PREFERENCE,
  normalizePackingExportOptions,
  selectedPackingExportColumns,
  readPackingExportOptions,
  savePackingExportOptions,
} from '../src/packing-export-options.js'

test('packing export choices retain only supported columns in the chosen order and preserve explicit clears', () => {
  const defaults = normalizePackingExportOptions()
  assert.equal(selectedPackingExportColumns(defaults).length, 31)
  assert.equal(defaults.scope, 'all')
  assert.equal(defaults.descriptionWidth, 48)
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
