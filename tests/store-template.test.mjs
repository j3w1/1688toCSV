import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CFB } from 'xlsx'
import { readStoreWorkbook } from '../src/store-workbook-reader.js'
import {
  analyzeStoreSheet,
  STORE_IMPORT_MARKERS,
} from '../src/store-workbook-model.js'

const templateUrl = new URL(
  '../src/assets/store-order-template.xlsx',
  import.meta.url
)
const text = new TextEncoder(),
  decode = new TextDecoder()

function completedTemplate(source, { photos = true } = {}) {
  const archive = CFB.read(new Uint8Array(source), { type: 'array' })
  const part =
    archive.FileIndex[
      archive.FullPaths.indexOf('Root Entry/xl/worksheets/sheet1.xml')
    ]
  let xml = decode
    .decode(part.content)
    .replace(/(<\/?)x:/g, '$1')
    .replace('xmlns:x=', 'xmlns=')
  const put = (address, value) => {
    const cell = new RegExp(
      `<c\\b(?=[^>]*\\br="${address}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`
    )
    const current = xml.match(cell)?.[0]
    assert.ok(current, `${address} should be editable in the template`)
    const style = current.match(/\bs="([^"]+)"/)?.[1]
    const formula = current.match(/<f\b[^>]*>[\s\S]*?<\/f>/)?.[0] || ''
    const type = typeof value === 'number' ? 'n' : 'str'
    xml = xml.replace(
      cell,
      `<c r="${address}"${style ? ` s="${style}"` : ''} t="${type}">${formula}<v>${value}</v></c>`
    )
  }
  for (const [address, value] of Object.entries({
    A7: 1,
    C7: '0001',
    D7: 'Synthetic glass tray',
    E7: '红色',
    F7: '大号',
    G7: 'A',
    H7: 2,
    I7: 10,
    J7: 20,
    K7: 3,
    L7: 60,
    M7: 12.5,
    N7: 0.04,
    O7: 50,
    P7: 40,
    Q7: 20,
    L30: 60,
    L32: 60,
  }))
    put(address, value)
  const add = (path, value) =>
    CFB.utils.cfb_add(
      archive,
      path,
      typeof value === 'string' ? text.encode(value) : value
    )
  if (photos) {
    xml = xml.replace(
      '</worksheet>',
      '<drawing r:id="templatePhotos"/></worksheet>'
    )
    add(
      'xl/worksheets/_rels/sheet1.xml.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="templatePhotos" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>'
    )
    add(
      'xl/drawings/drawing1.xml',
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>6</xdr:row></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:row>7</xdr:row><xdr:colOff>0</xdr:colOff><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:blipFill><a:blip r:embed="photo1"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>'
    )
    add(
      'xl/drawings/_rels/drawing1.xml.rels',
      '<Relationships><Relationship Id="photo1" Target="../media/template-photo.png"/></Relationships>'
    )
    add(
      'xl/media/template-photo.png',
      new Uint8Array(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
          'base64'
        )
      )
    )
  }
  part.content = text.encode(xml)
  part.size = part.content.length
  return CFB.write(archive, { type: 'array', fileType: 'zip' })
}

test('downloadable template has every canonical marker, cached blank formulas and no example products to import', async () => {
  const source = await readFile(templateUrl)
  const workbook = await readStoreWorkbook(source, { filename: '7953.xlsx' })
  assert.deepEqual(
    workbook.sheets.map((sheet) => sheet.name),
    ['Orders', 'Guide']
  )
  const sheet = workbook.sheets[0]
  const markerRow = sheet.rows.find((row) => row.row === 5)
  const markers = markerRow.cells.map((cell) => cell.value)
  const controls = sheet.rows
    .find((row) => row.row === 30)
    .cells.map((cell) => cell.value)
  for (const marker of STORE_IMPORT_MARKERS)
    assert.ok([...markers, ...controls].includes(marker), marker)
  const analysis = analyzeStoreSheet(workbook, 'Orders')
  assert.equal(analysis.rows.length, 0)
  assert.equal(analysis.markerRow, 5)
  assert.ok(
    analysis.issues.every(
      (issue) =>
        ![
          'missing-marker',
          'duplicate-marker',
          'missing-quantity-marker',
        ].includes(issue.code)
    )
  )
  const archive = CFB.read(new Uint8Array(source), { type: 'array' })
  const xml = decode.decode(
    archive.FileIndex[
      archive.FullPaths.indexOf('Root Entry/xl/worksheets/sheet1.xml')
    ].content
  )
  assert.match(xml, /<(?:\w+:)?pane\b[^>]*state="frozen"/)
})

test('a populated copy of the actual template imports photos, variants, leading-zero seller codes and calculated amounts', async () => {
  const source = await readFile(templateUrl)
  const workbook = await readStoreWorkbook(completedTemplate(source), {
    filename: '7953 (2).xlsx',
  })
  const result = analyzeStoreSheet(workbook, 'Orders')
  assert.deepEqual(
    result.issues.filter((issue) => issue.severity === 'error'),
    []
  )
  assert.equal(result.rows.length, 1)
  assert.equal(result.store.number, '7953')
  assert.equal(result.rows[0].productNumber, '0001')
  assert.equal(result.rows[0].quantity, 20)
  assert.equal(result.rows[0].amount, '60.00')
  assert.equal(result.rows[0].kg, 12.5)
  assert.equal(result.rows[0].photos.length, 1)
  assert.deepEqual(result.rows[0].variants, [{ variant: 'A', size: '' }])
  assert.equal(result.computedTotal, '60.00')
  const missing = analyzeStoreSheet(
    await readStoreWorkbook(completedTemplate(source, { photos: false }), {
      filename: '7953.xlsx',
    }),
    'Orders'
  )
  assert.ok(
    missing.issues.some(
      (issue) => issue.code === 'photo-missing' && issue.severity === 'error'
    )
  )
})
