import test from 'node:test'
import assert from 'node:assert/strict'
import { toCsv, filenameFor } from '../src/csv.js'

function row(overrides = {}) {
  return {
    thumbnail: 'https://example.invalid/product.jpg',
    description: 'Synthetic product',
    price: '12.50',
    quantity: '4',
    discount: '2.10',
    ...overrides,
  }
}

// An independent reader checks field round trips, including embedded newlines.
function readCsv(text) {
  const rows = []
  let values = []
  let value = ''
  let quoted = false
  const input = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < input.length; index++) {
    const character = input[index]
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        value += '"'
        index++
      } else quoted = !quoted
    } else if (character === ',' && !quoted) {
      values.push(value)
      value = ''
    } else if (character === '\r' && input[index + 1] === '\n' && !quoted) {
      values.push(value)
      rows.push(values)
      values = []
      value = ''
      index++
    } else value += character
  }
  assert.equal(quoted, false, 'all quoted CSV fields must close')
  if (value || values.length) {
    values.push(value)
    rows.push(values)
  }
  return rows
}

test('emits an Excel-friendly BOM, stable header order, and CRLF record separators', () => {
  const csv = toCsv([
    row(),
    row({ description: 'Second product', discount: '0.00' }),
  ])
  assert.equal(csv.charCodeAt(0), 0xfeff)
  assert.match(csv, /^\uFEFFThumbnail,Description,Price,Quantity,Discount\r\n/)
  assert.equal(csv.replaceAll('\r\n', '').includes('\n'), false)
  assert.deepEqual(readCsv(csv), [
    ['Thumbnail', 'Description', 'Price', 'Quantity', 'Discount'],
    [
      'https://example.invalid/product.jpg',
      'Synthetic product',
      '12.50',
      '4',
      '2.10',
    ],
    [
      'https://example.invalid/product.jpg',
      'Second product',
      '12.50',
      '4',
      '0.00',
    ],
  ])
})

test('round-trips Chinese text, quotes, commas, and multiline fields in every text column', () => {
  const data = row({
    thumbnail: 'https://example.invalid/image?label="demo",small',
    description: '测试商品, "暖白"\n款式：小号\r\n货号：DEMO-001',
  })
  const csv = toCsv([data])
  assert.deepEqual(readCsv(csv)[1], [
    data.thumbnail,
    data.description,
    data.price,
    data.quantity,
    data.discount,
  ])
  assert.ok(csv.includes('""暖白""'))
})

test('preserves empty optional thumbnails and zero discounts', () => {
  assert.deepEqual(
    readCsv(toCsv([row({ thumbnail: '', discount: '0.00' })]))[1],
    ['', 'Synthetic product', '12.50', '4', '0.00']
  )
})

test('refuses an empty export instead of producing a misleading headers-only file', () => {
  assert.throws(() => toCsv([]), /empty|row|product/i)
})

test('names exports using Unicode seller and order suffix', () => {
  assert.equal(
    filenameFor({ sellerName: '示例工厂', orderSuffix: '6789' }),
    '示例工厂_6789.csv'
  )
})

test('provides useful filenames when order metadata is missing', () => {
  assert.equal(filenameFor({}), 'Unknown Seller_XXXX.csv')
  assert.equal(
    filenameFor({ sellerName: '   ', orderSuffix: '' }),
    'Unknown Seller_XXXX.csv'
  )
})

test('prevents filename path separators, control characters, and forbidden Windows characters', () => {
  const name = filenameFor({
    sellerName: '  示例 / factory\\\r\n"<>:*?|  ',
    orderSuffix: '6789',
  })
  assert.match(name, /示例/)
  assert.match(name, /_6789\.csv$/)
  assert.doesNotMatch(name, /[<>:"/\\|?*\x00-\x1f]/)
  assert.equal(name, name.trim())
})
