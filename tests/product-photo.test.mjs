import test from 'node:test'
import assert from 'node:assert/strict'
import { photoPlacement, productPhotoGallery } from '../src/product-photo.js'
import {
  cartonVolume,
  cartonPackingForItems,
  productCartonDetails,
} from '../src/carton-details.js'

test('square photos preserve aspect ratio and center or crop without stretching', () => {
  assert.deepEqual(photoPlacement(800, 200, 400), {
    width: 400,
    height: 100,
    x: 0,
    y: 150,
  })
  assert.deepEqual(photoPlacement(800, 200, 400, { fit: 'cover' }), {
    width: 1600,
    height: 400,
    x: -600,
    y: 0,
  })
  assert.deepEqual(photoPlacement(800, 200, 400, { scale: 0.5, x: 0.1 }), {
    width: 200,
    height: 50,
    x: 140,
    y: 175,
  })
})

test('gallery retains every photo and product association, including shared assets', () => {
  const first = { entryId: '1', photos: ['a', 'b'], thumbnail: 'square' },
    second = { entryId: '2', photos: ['a'], thumbnail: 'square' }
  const gallery = productPhotoGallery([first, second])
  assert.deepEqual(
    gallery.map(({ originalPhoto, photoIndex }) => [originalPhoto, photoIndex]),
    [
      ['a', 0],
      ['b', 1],
      ['a', 0],
    ]
  )
  assert.equal(gallery[0].photoSource, first)
  assert.equal(gallery[2].photoSource, second)
})

test('precise centimetre carton dimensions take display priority over seller CBM', () => {
  assert.equal(
    cartonVolume({ len: '70', wid: '50', ht: '30', cbm: '0.21' }),
    '0.105'
  )
  assert.equal(cartonVolume({ len: '70', cbm: '0.21' }), '0.21')
  assert.deepEqual(
    productCartonDetails(
      { entryId: '1', carton: { kg: '5' } },
      { cartonDetails: { 1: {} } }
    ),
    {}
  )
})

test('combined source variants count cartons once and partial selection requires review', () => {
  const record = {
    snapshot: {
      sourceType: 'spreadsheet',
      spreadsheet: { rows: [{ row: 5, boxes: '3', perbox: '10' }] },
      items: [
        { entryId: '1', sourceRow: 5 },
        { entryId: '2', sourceRow: 5 },
      ],
    },
  }
  assert.equal(cartonPackingForItems(record, ['1', '2']).total, 3)
  assert.equal(cartonPackingForItems(record, ['1', '2']).exact, true)
  assert.equal(cartonPackingForItems(record, ['1']).requiresReview, true)
  assert.equal(cartonPackingForItems(record, ['1']).exact, false)
})

test('1688 loose quantities still require physical carton review', () => {
  const record = {
    snapshot: { items: [{ entryId: '1', quantity: '105' }] },
    unitsPerCarton: { 1: 10 },
  }
  const result = cartonPackingForItems(record, ['1'])
  assert.equal(result.total, 10)
  assert.equal(result.exact, false)
  assert.equal(result.requiresReview, true)
})

test('editing a shared variant weight never duplicates its source cartons', () => {
  const record = {
    snapshot: {
      sourceType: 'spreadsheet',
      spreadsheet: { rows: [{ row: 5, boxes: '2', perbox: '10' }] },
      items: [
        { entryId: '1', sourceRow: 5 },
        { entryId: '2', sourceRow: 5 },
      ],
    },
    unitsPerCarton: { 1: 10, 2: 10 },
    cartonDetails: { 1: { boxes: '2', kg: '3' } },
  }
  const result = cartonPackingForItems(record, ['1', '2'])
  assert.equal(result.total, 2)
  assert.equal(result.exact, true)
  record.cartonDetails['2'] = { boxes: '1' }
  assert.equal(cartonPackingForItems(record, ['1', '2']).requiresReview, true)
  assert.equal(cartonPackingForItems(record, ['1', '2']).exact, false)
})
