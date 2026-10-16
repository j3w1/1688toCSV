import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EXCEL_IMAGE_SCHEMES,
  normalizeExcelImageDisplay,
  excelImagePalette,
} from '../src/excel-image-style.js'
import { contrastRatio } from '../src/appearance.js'

test('new image details are opt-in and old heading preferences keep their meaning', () => {
  const defaults = normalizeExcelImageDisplay()
  assert.equal(defaults.style.scheme, 'neutral')
  assert.equal(defaults.showOrderDetails, true)
  assert.deepEqual(defaults.details, {
    seller: true,
    orderNumber: true,
    date: false,
    status: false,
    orderTags: false,
    title: true,
    specifications: true,
    model: true,
    productTags: false,
  })
  const custom = normalizeExcelImageDisplay({
    showOrderDetails: false,
    style: { scheme: 'custom', accent: '#A1B2C3' },
    details: {
      seller: false,
      orderTags: true,
      productTags: true,
      unknown: true,
    },
  })
  assert.equal(custom.showOrderDetails, false)
  assert.equal(custom.style.accent, '#a1b2c3')
  assert.equal(custom.details.seller, false)
  assert.equal(custom.details.orderTags, true)
  assert.equal(custom.details.productTags, true)
  assert.equal(Object.hasOwn(custom.details, 'unknown'), false)
  assert.equal(
    normalizeExcelImageDisplay({ details: { title: 'false' } }).details.title,
    true
  )
  assert.deepEqual(
    normalizeExcelImageDisplay({ style: { scheme: 'bad', accent: 'url(x)' } }),
    defaults
  )
})

test('every preset and custom accent produces readable header text', () => {
  for (const style of [
    ...EXCEL_IMAGE_SCHEMES.map(({ id, accent }) => ({ scheme: id, accent })),
    ...['#000000', '#ffffff', '#ffff00', '#777777', '#ff0000', '#00ff00'].map(
      (accent) => ({ scheme: 'custom', accent })
    ),
  ]) {
    const palette = excelImagePalette(style)
    assert.ok(
      contrastRatio(palette.header, palette.headerText) >= 4.5,
      JSON.stringify(style)
    )
    assert.equal(Object.isFrozen(palette), true)
  }
  assert.equal(
    excelImagePalette({ scheme: 'custom', accent: '#ffffff' }).headerText,
    '#000000'
  )
  assert.equal(
    excelImagePalette({ scheme: 'custom', accent: '#000000' }).headerText,
    '#ffffff'
  )
})
