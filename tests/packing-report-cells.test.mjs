import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parsePackingReportCells,
  adaptPackingReportWorkbook,
} from '../src/packing-report-cells.js'
import { readStoreWorkbook } from '../src/store-workbook-reader.js'
import { utils, write } from 'xlsx'

const refs = {
  sourceId: 'source',
  rawAssetRef: 'local-report:synthetic',
  rawDigest: 'synthetic-digest',
}

test('TSV preserves exact input, CRLF, quoted tabs/newlines, blanks, markup, formula-looking and long text IDs', () => {
  const text =
    '箱号\t货号\t备注\t\r\n001\t"旧\t号"\t"first\r\nsecond"\t\r\n\r\n=HYPERLINK(""x"")\t000000000000000000123\t<img onerror=bad>\t'
  // Quotes inside an unquoted TSV field must use Excel quoting.
  const validText = text.replace('=HYPERLINK(""x"")', '=literal')
  const result = parsePackingReportCells({ text: validText, ...refs })
  assert.deepEqual(result.issues, [])
  assert.equal(result.source.rawText, validText)
  const cells = result.source.sheets[0].cells
  assert.equal(cells.find((cell) => cell.address === 'A2').raw, '001')
  assert.equal(cells.find((cell) => cell.address === 'B2').raw, '旧\t号')
  assert.equal(
    cells.find((cell) => cell.address === 'C2').raw,
    'first\r\nsecond'
  )
  assert.equal(cells.find((cell) => cell.address === 'D2').raw, '')
  assert.equal(cells.find((cell) => cell.address === 'A3').raw, '')
  assert.equal(cells.find((cell) => cell.address === 'A4').raw, '=literal')
  assert.equal(
    cells.find((cell) => cell.address === 'B4').raw,
    '000000000000000000123'
  )
  assert.equal(
    cells.find((cell) => cell.address === 'C4').raw,
    '<img onerror=bad>'
  )
  assert.equal(cells.find((cell) => cell.address === 'D4').raw, '')
  assert.deepEqual(result.source.fidelity, {
    formattedIdentifiers: false,
    formulaMetadata: false,
  })
})

test('TSV malformed quotes and exceeded bounds fail as a whole without truncating evidence', () => {
  for (const text of ['"unfinished', '"closed"extra']) {
    const result = parsePackingReportCells({ text, ...refs })
    assert.equal(result.source, null)
    assert.equal(result.issues[0].severity, 'error')
  }
  for (const [text, limits] of [
    ['中文', { textBytes: 4 }],
    ['abcd', { cellText: 3 }],
    ['a\tb', { columns: 1 }],
    ['a\nb\nc', { rows: 1 }],
    ['a\tb', { cells: 1 }],
  ]) {
    const result = parsePackingReportCells({ text, ...refs, limits })
    assert.equal(result.source, null)
    assert.match(result.issues[0].params.reason, /limit/)
  }
  assert.equal(
    parsePackingReportCells({
      text: 'a',
      ...refs,
      rawAssetRef: 'https://remote',
    }).source,
    null
  )
})

test('rich XLSX adapter retains numeric raw/type/display/format, hidden and merged evidence independently', async () => {
  const book = utils.book_new(),
    sheet = utils.aoa_to_sheet([
      ['箱号', '货号'],
      ['001', '旧码'],
      [1, 123],
    ])
  sheet.A3.z = '000'
  sheet['!rows'] = [{}, {}, { hidden: true }]
  sheet['!cols'] = [{ hidden: true }]
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
  utils.book_append_sheet(book, sheet, '原始')
  const bytes = write(book, { type: 'array', bookType: 'xlsx' })
  const workbook = await readStoreWorkbook(bytes, {
    filename: 'renamed.xlsx',
    reportEvidence: true,
  })
  const source = adaptPackingReportWorkbook({ workbook, ...refs })
  const cell = source.sheets[0].cells.find((cell) => cell.address === 'A3')
  assert.equal(cell.raw, 1)
  assert.equal(cell.display, '001')
  assert.equal(cell.numberFormat, '000')
  assert.equal(cell.type, 'n')
  assert.deepEqual(source.sheets[0].hiddenRows, [3])
  assert.deepEqual(source.sheets[0].hiddenColumns, [1])
  assert.equal(source.sheets[0].merges.length, 1)
  assert.equal(source.rawAssetRef, refs.rawAssetRef)
  assert.equal(source.fidelity.formattedIdentifiers, true)
  assert.deepEqual(
    new Uint8Array(bytes),
    new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' }))
  )
})

test('workbook adapter rejects sparse far addresses and excess selected evidence before analysis', () => {
  const workbook = {
    filename: 'local.xls',
    sheets: [
      {
        name: 'A',
        rows: [
          { row: 1000000, cells: [{ address: 'A1000000', col: 1, value: 1 }] },
        ],
      },
    ],
  }
  assert.throws(
    () => adaptPackingReportWorkbook({ workbook, ...refs }),
    /limit/
  )
  workbook.sheets[0].rows[0].row = 1
  assert.equal(adaptPackingReportWorkbook({ workbook, ...refs }).kind, 'xls')
  workbook.sheets.push(workbook.sheets[0])
  assert.throws(
    () => adaptPackingReportWorkbook({ workbook, ...refs }),
    /Duplicate/
  )
})

test('literal formula-looking text with inner quotes stays inert TSV cell text', () => {
  const text = '=HYPERLINK("https://invalid.example","001")\t@literal\t+literal'
  const result = parsePackingReportCells({ text, ...refs })
  assert.deepEqual(result.issues, [])
  assert.deepEqual(
    result.source.sheets[0].cells.map((cell) => cell.raw),
    ['=HYPERLINK("https://invalid.example","001")', '@literal', '+literal']
  )
})
