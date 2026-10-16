import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeExcelImagePreference,
  readExcelImagePreference,
  saveExcelImagePreference,
  EXCEL_IMAGE_PREFERENCE,
} from '../src/excel-image-options.js'

test('image columns default to all product and blank supplier fields', () => {
  const value = normalizeExcelImagePreference()
  assert.equal(value.showOrderDetails, true)
  assert.equal(value.order.length, 11)
  assert.deepEqual(value.selected, value.order)
  assert.deepEqual(value.order.slice(-3), [
    'supplierDimensions',
    'supplierWeight',
    'supplierCarton',
  ])
})

test('saved image column order is validated without silently reselecting disabled fields', () => {
  const value = normalizeExcelImagePreference({
    order: ['quantity', 'price', 'quantity', 'removed'],
    selected: ['quantity', 'supplierCarton', 'removed', 'quantity'],
  })
  assert.deepEqual(value.order.slice(0, 2), ['quantity', 'price'])
  assert.equal(new Set(value.order).size, 11)
  assert.deepEqual(value.selected, ['quantity', 'supplierCarton'])
  assert.deepEqual(normalizeExcelImagePreference({ selected: [] }).selected, [])
  assert.equal(
    normalizeExcelImagePreference({ selected: ['quantity'] }).showOrderDetails,
    true
  )
  for (const value of [null, 0, 'false', {}])
    assert.equal(
      normalizeExcelImagePreference({ showOrderDetails: value })
        .showOrderDetails,
      true
    )
})

test('the same saved selection and order survive a new settings read', () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  }
  const preference = normalizeExcelImagePreference({
    order: ['price', 'quantity'],
    selected: ['price', 'quantity'],
    showOrderDetails: false,
    style: { scheme: 'custom', accent: '#ffc800' },
    details: { seller: false, productTags: true, date: true },
  })
  assert.equal(saveExcelImagePreference(preference, storage), true)
  assert.equal(values.has(EXCEL_IMAGE_PREFERENCE), true)
  assert.deepEqual(readExcelImagePreference(storage), preference)
})

test('a failed write retains the latest session choice instead of copying stale stored columns', () => {
  const previous = JSON.stringify({
    order: ['description'],
    selected: ['description'],
  })
  const storage = {
    getItem: () => previous,
    setItem() {
      throw new Error('quota exceeded')
    },
  }
  const latest = normalizeExcelImagePreference({
    order: ['quantity'],
    selected: ['quantity'],
    showOrderDetails: false,
  })
  assert.equal(saveExcelImagePreference(latest, storage), false)
  assert.deepEqual(readExcelImagePreference(storage), latest)
  const recovered = new Map()
  const writable = {
    getItem: (key) => recovered.get(key),
    setItem: (key, value) => recovered.set(key, value),
  }
  assert.equal(saveExcelImagePreference(latest, writable), true)
  assert.deepEqual(readExcelImagePreference(writable), latest)
})
