import test from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'
import { createXlsx, crc32, columnName } from '../src/xlsx-writer.js'

// Read a stored ZIP through its central directory, checking every CRC.
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (view.getUint32(end, true) !== 0x06054b50) end--
  const count = view.getUint16(end + 10, true)
  let pointer = view.getUint32(end + 16, true)
  const files = {}
  for (let index = 0; index < count; index++) {
    assert.equal(view.getUint32(pointer, true), 0x02014b50)
    const method = view.getUint16(pointer + 10, true)
    const crc = view.getUint32(pointer + 16, true)
    const size = view.getUint32(pointer + 20, true)
    const nameLength = view.getUint16(pointer + 28, true)
    const local = view.getUint32(pointer + 42, true)
    const name = new TextDecoder().decode(
      bytes.subarray(pointer + 46, pointer + 46 + nameLength)
    )
    const localName = view.getUint16(local + 26, true)
    const start = local + 30 + localName + view.getUint16(local + 28, true)
    let data = bytes.subarray(start, start + size)
    if (method === 8) data = inflateRawSync(data)
    assert.equal(crc32(data), crc, name)
    files[name] = new TextDecoder().decode(data)
    pointer +=
      46 +
      nameLength +
      view.getUint16(pointer + 30, true) +
      view.getUint16(pointer + 32, true)
  }
  return files
}

test('column names follow spreadsheet letters', () => {
  assert.deepEqual([0, 25, 26, 27, 51, 52, 701, 702].map(columnName), [
    'A',
    'Z',
    'AA',
    'AB',
    'AZ',
    'BA',
    'ZZ',
    'AAA',
  ])
})

test('a workbook holds a bold frozen header, text, numbers and escaped characters', () => {
  const bytes = createXlsx({
    sheetName: 'Packing list',
    header: ['Product code', 'Spanish description', 'Quantity', 'Price'],
    rows: [
      ['CE26100101', 'VELA <aroma> & "pura"', '40', '12.50'],
      ['', 'DIFUSOR', 24, 'n/a'],
    ],
    numeric: [false, false, true, true],
  })
  const files = unzip(bytes)
  assert.deepEqual(Object.keys(files).sort(), [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/workbook.xml',
    'xl/worksheets/sheet1.xml',
  ])
  const sheet = files['xl/worksheets/sheet1.xml']
  assert.match(
    sheet,
    /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/
  )
  assert.match(
    sheet,
    /<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Product code<\/t><\/is><\/c>/
  )
  assert.match(
    sheet,
    /<c r="B2" t="inlineStr"><is><t xml:space="preserve">VELA &lt;aroma&gt; &amp; &quot;pura&quot;<\/t><\/is><\/c>/
  )
  assert.match(sheet, /<c r="C2"><v>40<\/v><\/c>/)
  assert.match(sheet, /<c r="D2"><v>12.50<\/v><\/c>/)
  // Empty cells are left out; non-numeric text in a numeric column stays text.
  assert.doesNotMatch(sheet, /r="A3"/)
  assert.match(
    sheet,
    /<c r="D3" t="inlineStr"><is><t xml:space="preserve">n\/a<\/t>/
  )
  assert.match(
    files['xl/workbook.xml'],
    /<sheet name="Packing list" sheetId="1" r:id="rId1"\/>/
  )
})

test('the output is deterministic', () => {
  const make = () => createXlsx({ header: ['A'], rows: [['1']] })
  assert.deepEqual(make(), make())
})
