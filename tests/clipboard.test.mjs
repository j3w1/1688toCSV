import test from 'node:test'
import assert from 'node:assert/strict'
import { clipboardTable, columns } from '../src/clipboard.js'

const item = {
  description: '蜡烛\n颜色：暖白',
  price: '12.50',
  quantity: '4',
  discount: '2.10',
}
const png = 'data:image/png;base64,iVBORw0KGgo='
test('clipboard emits exactly five cells in Excel order with a plain TSV alternative', () => {
  const result = clipboardTable([item])
  assert.deepEqual(columns, [
    'Thumbnail',
    'Description',
    'Price',
    'Quantity',
    'Discount',
  ])
  assert.equal(
    result.plain,
    'Thumbnail\tDescription\tPrice\tQuantity\tDiscount\r\n\t蜡烛 · 颜色：暖白\t12.50\t4\t2.10'
  )
  assert.equal((result.html.match(/<td(?: |>|\b)/g) || []).length, 5)
  assert.match(result.html, /mso-number-format/)
})
test('bulk images remain individual img elements in their own table rows', () => {
  const result = clipboardTable([item, item], {
    images: [png, png],
    imagesOnly: true,
    headers: false,
  })
  assert.equal((result.html.match(/<img /g) || []).length, 2)
  assert.equal((result.html.match(/<td /g) || []).length, 2)
  assert.match(result.html, /height="20"/)
  assert.doesNotMatch(result.html, /<th/)
})
test('source descriptions cannot inject HTML or plain-text spreadsheet formulas', () => {
  const result = clipboardTable([
    { ...item, description: '=SUM(1,2) <script>&"' },
  ])
  assert.match(result.plain, /\t"'=/)
  assert.match(result.html, /&lt;script&gt;&amp;&quot;/)
  assert.doesNotMatch(result.html, /<script>/)
})
test('missing image slots, unsafe image formats and empty selection fail explicitly', () => {
  assert.throws(() => clipboardTable([]), /Select/)
  assert.throws(() => clipboardTable([item, item], { images: [png] }), /Every/)
  assert.throws(
    () => clipboardTable([item], { images: ['https://example.invalid/a.png'] }),
    /PNG/
  )
})
