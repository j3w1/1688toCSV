import test from 'node:test'
import assert from 'node:assert/strict'
import { CFB, utils, write } from 'xlsx'
import { readStoreWorkbook } from '../src/store-workbook-reader.js'

const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64'
  )
)
const text = new TextEncoder()

function xlsxFixture() {
  const workbook = utils.book_new()
  const sheet = utils.aoa_to_sheet([
    ['pic', 'desc'],
    ['', 'One'],
    ['', 'Two'],
  ])
  sheet['!merges'] = [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }]
  sheet.C2 = { t: 'n', v: 4, f: '2+2' }
  sheet['!ref'] = 'A1:C3'
  utils.book_append_sheet(workbook, sheet, 'Products & pictures')
  const archive = CFB.read(
    new Uint8Array(write(workbook, { type: 'array', bookType: 'xlsx' })),
    { type: 'array' }
  )
  const add = (path, value) =>
    CFB.utils.cfb_add(
      archive,
      path,
      typeof value === 'string' ? text.encode(value) : value
    )
  const current =
    archive.FileIndex[
      archive.FullPaths.indexOf('Root Entry/xl/worksheets/sheet1.xml')
    ]
  current.content = text.encode(
    new TextDecoder()
      .decode(current.content)
      .replace('</worksheet>', '<drawing r:id="imageDrawing"/></worksheet>')
  )
  current.size = current.content.length
  add(
    'xl/worksheets/_rels/sheet1.xml.rels',
    '<Relationships><Relationship Id="imageDrawing" Target="../drawings/drawing1.xml"/></Relationships>'
  )
  add(
    'xl/drawings/drawing1.xml',
    '<xdr:wsDr xmlns:xdr="drawing"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:row>1</xdr:row></xdr:from><xdr:to><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:blipFill><a:blip r:embed="picture"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>'
  )
  add(
    'xl/drawings/_rels/drawing1.xml.rels',
    '<Relationships><Relationship Id="picture" Target="../media/image1.png"/></Relationships>'
  )
  add('xl/media/image1.png', png)
  return CFB.write(archive, { type: 'array', fileType: 'zip' })
}

test('XLSX retains cells, cached formulas, merged ranges and embedded drawing anchors', async () => {
  const result = await readStoreWorkbook(xlsxFixture(), {
    filename: '1234.xlsx',
  })
  assert.equal(result.filename, '1234.xlsx')
  const sheet = result.sheets[0]
  assert.equal(sheet.name, 'Products & pictures')
  assert.equal(
    sheet.rows.find((row) => row.row === 2).cells.find((cell) => cell.col === 3)
      .formula,
    '2+2'
  )
  assert.deepEqual(sheet.merges, [
    { from: { row: 2, col: 1 }, to: { row: 3, col: 1 } },
  ])
  assert.equal(sheet.images.length, 1)
  assert.equal(sheet.images[0].unresolved, false)
  assert.equal(sheet.images[0].from.row, 2)
  assert.equal(sheet.images[0].to.row, 4)
  assert.match(sheet.images[0].dataUrl, /^data:image\/png;base64,/)
})

test('genuine binary XLS reads cells and does not pretend a workbook has pictures', async () => {
  const workbook = utils.book_new()
  utils.book_append_sheet(
    workbook,
    utils.aoa_to_sheet([
      ['pic', 'group'],
      ['test', 1],
    ]),
    'Binary'
  )
  const result = await readStoreWorkbook(
    write(workbook, { type: 'array', bookType: 'biff8' }),
    { filename: '1234.xls' }
  )
  assert.equal(result.sheets[0].rows[1].cells[1].value, 1)
  assert.deepEqual(result.sheets[0].images, [])
})

test('BIFF8 OfficeArt blips and worksheet client anchors map pictures to the correct sheet', async () => {
  const workbook = utils.book_new()
  utils.book_append_sheet(
    workbook,
    utils.aoa_to_sheet([
      ['pic', 'group'],
      ['', 1],
    ]),
    'First'
  )
  utils.book_append_sheet(
    workbook,
    utils.aoa_to_sheet([
      ['pic', 'group'],
      ['', 2],
    ]),
    'Second'
  )
  const archive = CFB.read(
    new Uint8Array(write(workbook, { type: 'array', bookType: 'biff8' })),
    { type: 'array' }
  )
  const entry = archive.FileIndex.find((item) => item.name === 'Workbook')
  const raw = Uint8Array.from(entry.content)
  const view = new DataView(raw.buffer)
  const concatenate = (...parts) =>
    Uint8Array.from(parts.flatMap((part) => [...part]))
  const biff = (type, body) => {
    const header = new Uint8Array(4)
    const value = new DataView(header.buffer)
    value.setUint16(0, type, true)
    value.setUint16(2, body.length, true)
    return concatenate(header, body)
  }
  const office = (type, body, options = 0) => {
    const header = new Uint8Array(8)
    const value = new DataView(header.buffer)
    value.setUint16(0, options, true)
    value.setUint16(2, type, true)
    value.setUint32(4, body.length, true)
    return concatenate(header, body)
  }
  const global = biff(0xeb, office(0xf007, png))
  let globalEnd,
    lastSheetStart = 0
  for (let offset = 0; offset + 4 <= raw.length; ) {
    const type = view.getUint16(offset, true)
    const size = view.getUint16(offset + 2, true)
    if (type === 0x85) {
      lastSheetStart = view.getUint32(offset + 4, true)
      view.setUint32(offset + 4, lastSheetStart + global.length, true)
    }
    if (type === 0xa && globalEnd === undefined) globalEnd = offset
    offset += 4 + size
  }
  const prop = new Uint8Array(6)
  new DataView(prop.buffer).setUint16(0, 260, true)
  new DataView(prop.buffer).setUint32(2, 1, true)
  const anchor = new Uint8Array(18)
  const anchorView = new DataView(anchor.buffer)
  anchorView.setUint16(6, 1, true)
  anchorView.setUint16(14, 1, true)
  anchorView.setUint16(16, 128, true)
  const drawing = biff(
    0xec,
    office(
      0xf004,
      concatenate(office(0xf00b, prop, 16), office(0xf010, anchor)),
      15
    )
  )
  // Place the drawing after the second worksheet. Its BoundSheet offset, rather
  // than a nearest-sheet assumption, determines which sheet owns the picture.
  const resultBytes = concatenate(
    raw.subarray(0, globalEnd),
    global,
    raw.subarray(globalEnd),
    drawing
  )
  entry.content = resultBytes
  entry.size = resultBytes.length
  const result = await readStoreWorkbook(
    CFB.write(archive, { type: 'array' }),
    { filename: 'binary.xls' }
  )
  assert.equal(result.sheets[0].images.length, 0)
  assert.equal(result.sheets[1].images.length, 1)
  assert.equal(result.sheets[1].images[0].from.row, 2)
  assert.equal(result.sheets[1].images[0].unresolved, false)
  assert.match(result.sheets[1].images[0].dataUrl, /^data:image\/png;base64,/)
})

test('nonworkbooks and oversized files fail before parsing', async () => {
  await assert.rejects(
    readStoreWorkbook(text.encode('<html>wrong file</html>')),
    /Excel/
  )
  await assert.rejects(
    readStoreWorkbook(new Uint8Array(100 * 1024 * 1024 + 1)),
    /100 MB/
  )
})

test('report evidence is opt-in: default China decoder cell contract stays exactly unchanged', async () => {
  const workbook = utils.book_new(),
    sheet = utils.aoa_to_sheet([['Code'], [1]])
  sheet.A2.z = '000'
  utils.book_append_sheet(workbook, sheet, 'Evidence')
  const bytes = write(workbook, { type: 'array', bookType: 'xlsx' })
  const legacy = await readStoreWorkbook(bytes)
  assert.deepEqual(legacy.sheets[0].rows[1].cells[0], {
    col: 1,
    address: 'A2',
    value: 1,
  })
  assert.equal('reportEvidence' in legacy, false)
  assert.equal('hiddenRows' in legacy.sheets[0], false)
  const rich = await readStoreWorkbook(bytes, { reportEvidence: true })
  assert.deepEqual(rich.sheets[0].rows[1].cells[0], {
    col: 1,
    address: 'A2',
    value: 1,
    type: 'n',
    display: '001',
    numberFormat: '000',
  })
})

test('report ZIP member/inflated limits preflight before decode; sparse/long worksheet evidence rejects explicitly', async () => {
  const workbook = utils.book_new(),
    sheet = utils.aoa_to_sheet([['a'], ['b']])
  utils.book_append_sheet(workbook, sheet, 'Synthetic')
  const raw = new Uint8Array(
    write(workbook, { type: 'array', bookType: 'xlsx' })
  )
  await assert.rejects(
    readStoreWorkbook(raw, {
      reportEvidence: true,
      limits: { archiveMembers: 1 },
    }),
    /archive member/
  )
  await assert.rejects(
    readStoreWorkbook(raw, {
      reportEvidence: true,
      limits: { archiveBytes: 10 },
    }),
    /inflated archive/
  )
  await assert.rejects(
    readStoreWorkbook(raw, { reportEvidence: true, limits: { cells: 1 } }),
    /cell\/row\/column/
  )
  const altered = raw.slice(),
    view = new DataView(altered.buffer)
  for (let offset = 0; offset + 46 < altered.length; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint32(offset + 24, 201 * 1024 * 1024, true)
      break
    }
  }
  await assert.rejects(
    readStoreWorkbook(altered, { reportEvidence: true }),
    /inflated archive/
  )
  sheet.A1000000 = { t: 's', v: 'far' }
  sheet['!ref'] = 'A1:A1000000'
  const sparse = write(workbook, { type: 'array', bookType: 'xlsx' })
  await assert.rejects(
    readStoreWorkbook(sparse, { reportEvidence: true }),
    /cell\/row\/column/
  )
  delete sheet.A1000000
  sheet['!ref'] = 'A1:A2'
  sheet.A2.v = 'long text'
  await assert.rejects(
    readStoreWorkbook(write(workbook, { type: 'array', bookType: 'xlsx' }), {
      reportEvidence: true,
      limits: { cellText: 2 },
    }),
    /cell\/row\/column/
  )
})

test('rich report decode retains an actual uncached formula and enforces the sheet ceiling', async () => {
  const archive = CFB.read(new Uint8Array(xlsxFixture()), { type: 'array' })
  const part =
    archive.FileIndex[
      archive.FullPaths.indexOf('Root Entry/xl/worksheets/sheet1.xml')
    ]
  part.content = text.encode(
    new TextDecoder()
      .decode(part.content)
      .replace('<f>2+2</f><v>4</v>', '<f>2+2</f>')
  )
  part.size = part.content.length
  const decoded = await readStoreWorkbook(
    CFB.write(archive, { type: 'array', fileType: 'zip' }),
    { reportEvidence: true }
  )
  const formula = decoded.sheets[0].rows
    .find((row) => row.row === 2)
    .cells.find((cell) => cell.col === 3)
  assert.equal(formula.formula, '2+2')
  assert.equal(formula.value, null)
  assert.equal(formula.formulaCachePresent, false)
  assert.equal(formula.display, '')
  const workbook = utils.book_new()
  for (let index = 0; index < 21; index++)
    utils.book_append_sheet(
      workbook,
      utils.aoa_to_sheet([['synthetic']]),
      `Sheet ${index}`
    )
  await assert.rejects(
    readStoreWorkbook(write(workbook, { type: 'array', bookType: 'xlsx' }), {
      reportEvidence: true,
    }),
    /sheet limit/
  )
})
