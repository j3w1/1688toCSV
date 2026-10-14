import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { preparationTable } from '../src/preparation-clipboard.js'

const row = {
  orderId: '1',
  groupId: 'g',
  baseCode: 'CE26100101',
  barcode: 'CE26100101AS',
  description: 'Glass "jar"\n透明',
  spanishName: 'FRASCO',
  price: '0.125',
  quantity: '20',
  discount: '-2.50',
}
test('preparation clipboard keeps exact numbers, quoted text and one base code per group', () => {
  const fields = [
    'baseCode',
    'barcode',
    'description',
    'price',
    'quantity',
    'discount',
  ]
  const result = preparationTable(
    [row, { ...row, barcode: 'CE26100101AL' }],
    fields
  )
  assert.equal(
    result.plain.split('\r\n')[0],
    'CE26100101\tCE26100101AS\t"Glass ""jar"" · 透明"\t0.125\t20\t-2.50'
  )
  assert.ok(result.plain.split('\r\n')[1].startsWith('\tCE26100101AL\t'))
  const { document } = parseHTML(result.html)
  assert.equal(document.querySelectorAll('th').length, 0)
  assert.equal(
    document.querySelectorAll('tr')[1].firstElementChild.textContent,
    ''
  )
  assert.equal(
    document.querySelectorAll('td')[2].textContent,
    'Glass "jar" · 透明'
  )
})
test('individual columns respect optional headers and text formula safety', () => {
  const result = preparationTable(
    [{ ...row, spanishName: '=SUM(A1)' }],
    ['spanishName'],
    true
  )
  assert.equal(result.plain, "Spanish description\r\n'=SUM(A1)")
  assert.match(result.html, /mso-number-format/)
  assert.throws(() => preparationTable([row], []), /Choose columns/)
})
