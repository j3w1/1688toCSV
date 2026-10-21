import test from 'node:test'
import assert from 'node:assert/strict'
import { CFB, read } from 'xlsx'
import { DOMParser } from 'linkedom'
import {
  createPackingWorkbook,
  planPackingWorkbook,
  PACKING_WORKBOOK_COLUMNS,
} from '../src/packing-workbook.js'
import { crc32 } from '../src/xlsx-writer.js'

const options = { language: 'es', createdAt: '2026-10-21T08:00:00.000Z' }
const source = (overrides = {}) => ({
  orderId: '1001',
  entryId: '1',
  sellerName: 'Synthetic store',
  storeNumber: '0007',
  packingMonth: '2026-10',
  barcode: 'CE26103102ALS',
  baseCode: 'CE26103102',
  description: '原始描述 < & >',
  spanishName: 'PRODUCTO',
  productNumber: '0001',
  sourceSize: '20 × 30 cm',
  quantity: '100',
  unitsPerCarton: 10,
  price: '10.00',
  sourceAmount: '1000.00',
  effectiveUnitPrice: '10.25',
  effectiveAmount: '1025.00',
  discount: '0.00',
  orderShipping: '20.00',
  cartonWeight: '2.50',
  cartonVolume: '0.05',
  receivedBoxes: '8',
  loadedBoxes: '6',
  ...overrides,
})
const cell = (plan, product, key) =>
  plan.rows[product.row - 1].cells[
    plan.columns.findIndex((column) => column.key === key)
  ]
const partText = (archive, name) =>
  new TextDecoder().decode(
    archive.FileIndex[archive.FullPaths.indexOf(`Root Entry/${name}`)]?.content
  )

test('workbook headings follow the selected language without repeating Chinese twice', () => {
  for (const language of ['en', 'es', 'zh']) {
    const plan = planPackingWorkbook([source()], { ...options, language })
    const headings = plan.rows.filter((row) => row.kind === 'header')
    assert.equal(headings.length, 2)
    assert.equal(
      headings[1].cells[0].value,
      { en: 'Store', es: 'TIENDA', zh: '店铺' }[language]
    )
    assert.equal(
      headings[0].cells[0].value,
      language === 'zh' ? 'TIENDA' : '店铺'
    )
  }
})

function inspectZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pointer = 0
  while (view.getUint32(pointer, true) === 0x04034b50) {
    const crc = view.getUint32(pointer + 14, true),
      size = view.getUint32(pointer + 18, true)
    const nameLength = view.getUint16(pointer + 26, true),
      extra = view.getUint16(pointer + 28, true)
    const start = pointer + 30 + nameLength + extra
    assert.equal(crc32(bytes.subarray(start, start + size)), crc)
    pointer = start + size
  }
  return CFB.read(bytes, { type: 'array' })
}

test('the planner preserves the reference columns, omits payment categories, and groups real transactions', () => {
  const plan = planPackingWorkbook(
    [
      source(),
      source({
        orderId: '1002',
        entryId: '1',
        quantity: '20',
        effectiveAmount: '205.00',
      }),
      source({ entryId: '2', quantity: '30', effectiveAmount: '307.50' }),
    ],
    options
  )
  assert.equal(PACKING_WORKBOOK_COLUMNS.length, 34)
  assert.equal(plan.columns.length, 31)
  assert.deepEqual(
    plan.columns.slice(-3).map((column) => column.reference),
    ['AF', 'AG', 'AH']
  )
  assert.equal(
    plan.columns.some((column) =>
      ['payments', 'deposits', 'balance'].includes(column.key)
    ),
    false
  )
  assert.deepEqual(
    plan.products.map((product) => [
      product.source.orderId,
      product.source.entryId,
    ]),
    [
      ['1001', '1'],
      ['1001', '2'],
      ['1002', '1'],
    ]
  )
  assert.equal(plan.rows.filter((row) => row.kind === 'order').length, 2)
  assert.deepEqual(
    plan.rows
      .filter((row) => row.kind === 'order')
      .map((row) => row.cells[0].value),
    [
      '0007 · Synthetic store    ·    Pedido 1    ·    2026-10',
      '0007 · Synthetic store    ·    Pedido 2    ·    2026-10',
    ]
  )
  assert.equal(cell(plan, plan.products[0], 'orderQuantity').value, '130')
  assert.equal(cell(plan, plan.products[0], 'orderAmount').value, '1332.50')
  assert.equal(cell(plan, plan.products[1], 'orderAmount').value, '')
  assert.equal(cell(plan, plan.products[0], 'orderShipping').value, '20.00')
  assert.equal(cell(plan, plan.products[1], 'orderShipping').value, '')
  assert.equal(cell(plan, plan.products[0], 'effectiveAmount').value, '1025.00')
  for (const product of plan.products)
    assert.equal(cell(plan, product, 'totalLoadedBoxes').value, '')
  assert.equal(plan.rows.at(-1).cells.at(-1).value, '18')
})

test('planned, confirmed received and confirmed loaded cartons remain distinct with zero and blanks', () => {
  const plan = planPackingWorkbook(
    [
      source({ receivedBoxes: '0', loadedBoxes: undefined }),
      source({
        entryId: '2',
        receivedBoxes: undefined,
        loadedBoxes: '2',
        cartonWeight: '0',
        cartonVolume: '0',
      }),
    ],
    options
  )
  const [a, b] = plan.products
  assert.equal(cell(plan, a, 'plannedBoxes').value, '10')
  assert.equal(cell(plan, a, 'receivedBoxes').value, '0')
  assert.equal(cell(plan, a, 'loadedBoxes').value, '')
  assert.equal(cell(plan, a, 'receivedWeight').value, '0.00')
  assert.equal(cell(plan, a, 'loadedWeight').value, '')
  assert.equal(cell(plan, b, 'loadedWeight').value, '0')
  assert.equal(cell(plan, b, 'loadedVolume').value, '0')
  const total = (key) =>
    plan.rows.at(-1).cells[
      plan.columns.findIndex((column) => column.key === key)
    ]
  assert.equal(total('receivedBoxes').value, '0')
  assert.equal(total('totalLoadedBoxes').value, '2')
  assert.equal(total('loadedBoxes').value, '')
  assert.match(
    total('totalLoadedWeight').formula,
    /^IF\(OR\(COUNT\(U6:U8\)=0,COUNTIF\(U6:U8,"\?\*"\)>0\),"",SUM\(U6:U8\)\)$/
  )
  const unknown = planPackingWorkbook(
    [source({ receivedBoxes: '', loadedBoxes: '' })],
    options
  )
  assert.equal(unknown.rows.at(-1).cells.at(-1).value, '')
})

test('a complete allocated source row owns cartons once and a partial row cannot claim them', () => {
  const a = source({
    sourceType: 'spreadsheet',
    sourceRow: 9,
    sourceRowEntryIds: ['1', '2'],
    cartons: '3',
    receivedBoxes: '2',
    loadedBoxes: '1',
    quantity: '12',
  })
  const b = source({ ...a, entryId: '2', cartons: undefined, quantity: '18' })
  const complete = planPackingWorkbook([a, b], options)
  assert.deepEqual(
    complete.products.map((product) => product.cartonOwner),
    [true, false]
  )
  assert.equal(cell(complete, complete.products[0], 'plannedBoxes').value, '3')
  assert.equal(cell(complete, complete.products[1], 'receivedBoxes').value, '')
  assert.equal(
    cell(complete, complete.products[0], 'receivedWeight').value,
    '5.00'
  )
  const partial = planPackingWorkbook([a], options)
  assert.equal(partial.products[0].cartonComplete, false)
  for (const key of [
    'plannedBoxes',
    'receivedBoxes',
    'loadedBoxes',
    'receivedWeight',
    'loadedVolume',
  ])
    assert.equal(cell(partial, partial.products[0], key).value, '')
  const conflicting = planPackingWorkbook(
    [a, { ...b, receivedBoxes: '3' }],
    options
  )
  assert.equal(
    cell(conflicting, conflicting.products[0], 'receivedBoxes').value,
    ''
  )
  assert.equal(
    cell(conflicting, conflicting.products[0], 'loadedBoxes').value,
    '1'
  )
})

test('source row identity is order-specific, remainders stay unknown, and incomplete explicit batches stay blank', () => {
  const plan = planPackingWorkbook(
    [
      source({ sourceRow: 4, sourceRowComplete: true, cartons: '5' }),
      source({
        orderId: '1002',
        sourceRow: 4,
        sourceRowComplete: true,
        cartons: '6',
      }),
      source({
        orderId: '1003',
        quantity: '105',
        receivedBoxes: undefined,
        loadedBoxes: undefined,
      }),
      source({
        orderId: '1004',
        cartonBatchId: 'shared',
        cartonBatchComplete: false,
        cartons: '9',
      }),
    ],
    options
  )
  assert.deepEqual(
    plan.products.map((product) => cell(plan, product, 'plannedBoxes').value),
    ['5', '6', '', '']
  )
  assert.throws(
    () => planPackingWorkbook([source(), source()], options),
    /occurs twice/
  )
  assert.throws(
    () => planPackingWorkbook([source({ loadedBoxes: '-1' })], options),
    /box count/
  )
})

test('confirmation batches cannot become complete by combining different packing months', () => {
  const common = {
    cartonBatchId: 'source-9',
    cartonBatchEntryIds: ['1', '2'],
    cartons: '3',
    receivedBoxes: '2',
    loadedBoxes: '1',
  }
  const plan = planPackingWorkbook(
    [
      source(common),
      source({ ...common, entryId: '2', packingMonth: '2026-11' }),
    ],
    options
  )
  assert.deepEqual(
    plan.products.map((product) => product.cartonComplete),
    [false, false]
  )
  assert.deepEqual(
    plan.products.map((product) => cell(plan, product, 'receivedBoxes').value),
    ['', '']
  )
  const single = planPackingWorkbook(
    [source({ cartonBatchId: '1', plannedBoxes: '10' })],
    options
  )
  assert.equal(cell(single, single.products[0], 'receivedBoxes').value, '8')
})

test('mixed-month orders keep interleaved product order and label every month change without duplicating purchase totals', async () => {
  const rows = [
    source({
      entryId: '1',
      packingMonth: '2026-10',
      quantity: '10',
      effectiveAmount: '100.00',
      receivedBoxes: '1',
      loadedBoxes: '0',
    }),
    source({
      entryId: '2',
      packingMonth: '2026-11',
      quantity: '20',
      effectiveAmount: '250.00',
      receivedBoxes: '2',
      loadedBoxes: '2',
    }),
    source({
      entryId: '3',
      packingMonth: '2026-10',
      quantity: '30',
      effectiveAmount: '360.00',
      receivedBoxes: '3',
      loadedBoxes: '1',
      cartonWeight: '4',
    }),
  ]
  const plan = planPackingWorkbook(rows, options)
  assert.deepEqual(
    plan.products.map((product) => product.source.entryId),
    ['1', '2', '3']
  )
  assert.deepEqual(
    plan.products.map((product) => product.row),
    [8, 10, 12]
  )
  assert.deepEqual(
    plan.rows
      .filter((row) => row.kind === 'month')
      .map((row) => row.cells[0].value),
    [
      'Mes de empaque: 2026-10',
      'Mes de empaque: 2026-11',
      'Mes de empaque: 2026-10',
    ]
  )
  assert.match(
    plan.rows.find((row) => row.kind === 'order').cells[0].value,
    /2026-10 \/ 2026-11$/
  )
  assert.deepEqual(
    plan.products.map((product) => cell(plan, product, 'receivedBoxes').value),
    ['1', '2', '3']
  )
  assert.deepEqual(
    plan.products.map((product) => cell(plan, product, 'loadedBoxes').value),
    ['0', '2', '1']
  )
  assert.deepEqual(
    plan.products.map((product) => cell(plan, product, 'orderShipping').value),
    ['20.00', '', '']
  )
  assert.deepEqual(
    plan.products.map((product) => cell(plan, product, 'orderAmount').value),
    ['710.00', '', '']
  )
  assert.deepEqual(
    plan.products.map((product) => cell(plan, product, 'orderQuantity').value),
    ['60', '', '']
  )
  for (const row of plan.rows.filter((row) => row.kind === 'month'))
    assert.equal(row.cells.length, 1)
  assert.match(
    cell(plan, plan.products[0], 'orderAmount').formula,
    /SUM\(R8:R12\)/
  )
  const sheet = read(await createPackingWorkbook(rows, options), {
    type: 'array',
  }).Sheets['Packing list']
  assert.equal(sheet.A7.v, 'Mes de empaque: 2026-10')
  assert.equal(sheet.A9.v, 'Mes de empaque: 2026-11')
  assert.equal(sheet.A11.v, 'Mes de empaque: 2026-10')
  assert.equal(sheet.M8.v, 60)
  assert.equal(sheet.AB8.v, 710)
  assert.equal(sheet.O8.v, 20)
  assert.equal(sheet.O10.v ?? '', '')
  assert.equal(sheet.O12.v ?? '', '')
  assert.equal(sheet.AC13.v, 9)
  assert.equal(sheet.AE13.v, 3)
  assert.equal(
    planPackingWorkbook([source()], options).rows.some(
      (row) => row.kind === 'month'
    ),
    false
  )
})

test('the workbook is styled and editable with literal identifiers, safe text and recalculating formulas', async () => {
  const rows = [
    source({ productNumber: '=1+1', storeNumber: '0007' }),
    source({
      entryId: '2',
      receivedBoxes: '',
      loadedBoxes: '0',
      cartonVolume: '0',
    }),
  ]
  const bytes = await createPackingWorkbook(rows, options)
  const archive = inspectZip(bytes)
  const workbook = read(bytes, { type: 'array', cellStyles: true })
  const sheet = workbook.Sheets['Packing list']
  assert.equal(sheet.A7.v, '0007')
  assert.equal(sheet.F7.v, '=1+1')
  assert.equal(sheet.F7.t, 's')
  assert.equal(sheet.F7.f, undefined)
  assert.equal(sheet.C7.v, 'CE26103102ALS')
  assert.equal(sheet.H7.t, 'n')
  assert.equal(sheet.H7.v, 6)
  assert.equal(sheet.H8.v, 0)
  assert.equal(sheet.I8.v ?? '', '')
  assert.equal(sheet.D7.v, '原始描述 < & >')
  assert.equal(sheet.T7.v, 20)
  assert.match(
    sheet.U7.f,
    /^IF\(AND\(ISNUMBER\(H7\),ISNUMBER\(S7\)\),H7\*S7,""\)$/
  )
  assert.equal(sheet.U7.v, 15)
  assert.ok(sheet['!merges'].length >= 4)
  const worksheet = partText(archive, 'xl/worksheets/sheet1.xml')
  assert.match(worksheet, /xSplit="3" ySplit="5" topLeftCell="D6"/)
  assert.match(worksheet, /autoFilter ref="A5:AE8"/)
  assert.match(
    worksheet,
    /orientation="landscape" fitToWidth="1" fitToHeight="0"/
  )
  assert.match(worksheet, /<row r="7" ht="98" customHeight="1">/)
  assert.match(
    partText(archive, 'xl/workbook.xml'),
    /fullCalcOnLoad="1" forceFullCalc="1"/
  )
  assert.match(partText(archive, 'xl/styles.xml'), /patternType="solid"/)
  assert.match(
    partText(archive, 'xl/styles.xml'),
    /vertical="bottom" wrapText="1" horizontal="center"/
  )
  for (let index = 0; index < archive.FullPaths.length; index++) {
    if (!archive.FullPaths[index].endsWith('.xml')) continue
    const document = new DOMParser().parseFromString(
      new TextDecoder().decode(archive.FileIndex[index].content),
      'text/xml'
    )
    assert.equal(
      document.querySelector('parsererror'),
      null,
      archive.FullPaths[index]
    )
  }
  // SheetJS/CFB annotates input typed arrays; compare the actual package bytes.
  assert.deepEqual(
    Buffer.from(bytes),
    Buffer.from(await createPackingWorkbook(rows, options))
  )
})

const png = () =>
  new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64'
    )
  )

test('bounded raster assets have complete drawing, sheet and content-type relationships', async () => {
  const asset = { bytes: png(), mimeType: 'image/png' },
    calls = []
  const bytes = await createPackingWorkbook(
    [source(), source({ entryId: '2' })],
    {
      ...options,
      prepareImages: async (row, bounds) => {
        calls.push([row.entryId, bounds])
        return {
          photo: asset,
          code: { bytes: new Blob([png()]), mimeType: 'image/png' },
        }
      },
    }
  )
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0][1].photo, { maxWidth: 320, maxHeight: 240 })
  const archive = inspectZip(bytes)
  assert.equal(
    archive.FullPaths.filter((name) => /xl\/media\/image\d+\.png$/.test(name))
      .length,
    3
  )
  const drawing = partText(archive, 'xl/drawings/drawing1.xml')
  assert.equal((drawing.match(/<xdr:oneCellAnchor>/g) || []).length, 4)
  assert.match(drawing, /<xdr:col>1<\/xdr:col>/)
  assert.match(drawing, /<xdr:row>6<\/xdr:row>/)
  assert.match(drawing, /<a:picLocks noChangeAspect="1"\/>/)
  assert.match(drawing, /cx="1143000" cy="1143000"/)
  const rels = partText(archive, 'xl/drawings/_rels/drawing1.xml.rels')
  assert.equal((rels.match(/Type="[^"]+\/image"/g) || []).length, 3)
  assert.match(rels, /Target="\.\.\/media\/image1.png"/)
  assert.match(
    partText(archive, 'xl/worksheets/_rels/sheet1.xml.rels'),
    /Id="drawing1"/
  )
  assert.match(
    partText(archive, '[Content_Types].xml'),
    /Extension="png" ContentType="image\/png"/
  )
  assert.match(
    partText(archive, 'xl/worksheets/sheet1.xml'),
    /<drawing r:id="drawing1"\/>/
  )
  assert.equal(
    read(bytes, { type: 'array' }).Sheets['Packing list'].C7.v,
    'CE26103102ALS'
  )
})

test('visible order bands omit internal IDs and raster codes hide duplicate native text without losing its value', async () => {
  const first = source({ orderId: '900000000000000001' })
  const second = source({ orderId: '900000000000000002' })
  const bytes = await createPackingWorkbook([first, second], {
    ...options,
    prepareImages: async (row) =>
      row.orderId === first.orderId
        ? { code: { bytes: png(), mimeType: 'image/png' } }
        : {},
  })
  const archive = inspectZip(bytes)
  const worksheet = partText(archive, 'xl/worksheets/sheet1.xml')
  assert.equal(worksheet.includes(first.orderId), false)
  assert.equal(worksheet.includes(second.orderId), false)
  assert.match(worksheet, /Pedido 1/)
  assert.match(worksheet, /Pedido 2/)
  const sheet = read(bytes, { type: 'array', cellNF: true }).Sheets[
    'Packing list'
  ]
  assert.equal(sheet.C7.v, first.barcode)
  assert.equal(sheet.C7.z, ';;;')
  assert.equal(sheet.C9.v, second.barcode)
  assert.notEqual(sheet.C9.z, ';;;')
  assert.match(worksheet, /<c r="C7" s="9" t="inlineStr">/)
  assert.match(worksheet, /<c r="C9" s="8" t="inlineStr">/)
  assert.match(
    partText(archive, 'xl/styles.xml'),
    /numFmtId="164" formatCode=";;;"/
  )
  const styles = new DOMParser().parseFromString(
    partText(archive, 'xl/styles.xml'),
    'text/xml'
  )
  const hidden = styles.querySelector('cellXfs').children[9]
  assert.equal(hidden.getAttribute('fontId'), '5')
  assert.equal(hidden.getAttribute('fillId'), '5')
  assert.equal(hidden.getAttribute('numFmtId'), '164')
  assert.equal(
    styles
      .querySelector('fonts')
      .children[5].querySelector('color')
      .getAttribute('rgb'),
    'FFFFFFFF'
  )
  assert.equal(
    styles
      .querySelector('fills')
      .children[5].querySelector('fgColor')
      .getAttribute('rgb'),
    'FFFFFFFF'
  )
  assert.equal(
    styles.querySelector('cellXfs').children[8].getAttribute('fontId'),
    '4'
  )
})

test('money displays two decimals and measurements use flexible nine-decimal formats without rounding underlying values', async () => {
  const rows = [
    source({
      sourceUnitPrice: '12.5',
      effectiveUnitPrice: '18.91234567',
      effectiveAmount: '1234567.89',
      discount: '0.1',
      cartonWeight: '1.234567891',
      cartonVolume: '0.012345678',
      receivedBoxes: '2',
      loadedBoxes: '1',
    }),
    source({ entryId: '2', effectiveAmount: '12.50' }),
  ]
  const bytes = await createPackingWorkbook(rows, options)
  const sheet = read(bytes, { type: 'array', cellNF: true }).Sheets[
    'Packing list'
  ]
  for (const address of [
    'N7',
    'O7',
    'P7',
    'Q7',
    'R7',
    'AB7',
    'O9',
    'P9',
    'R9',
  ]) {
    assert.equal(sheet[address].z, '#,##0.00', address)
    assert.equal(sheet[address].t, 'n', address)
  }
  assert.equal(sheet.N7.v, 12.5)
  assert.equal(sheet.N7.w, '12.50')
  assert.equal(sheet.P7.w, '0.10')
  assert.equal(sheet.Q7.v, 18.91234567)
  assert.equal(sheet.Q7.w, '18.91')
  assert.equal(sheet.R7.v, 1234567.89)
  assert.equal(sheet.R7.w, '1,234,567.89')
  assert.equal(sheet.AB7.v, 1234580.39)
  for (const address of [
    'S7',
    'T7',
    'U7',
    'Y7',
    'Z7',
    'AA7',
    'T9',
    'Z9',
    'AC9',
    'AD9',
  ])
    assert.equal(sheet[address].z, '#,##0.#########', address)
  assert.equal(sheet.S7.v, 1.234567891)
  assert.equal(sheet.Y7.v, 0.012345678)
  const worksheet = partText(inspectZip(bytes), 'xl/worksheets/sheet1.xml')
  assert.match(worksheet, /<c r="Q7" s="10"><v>18.91234567<\/v><\/c>/)
  assert.match(worksheet, /<c r="Y7" s="11"><v>0.012345678<\/v><\/c>/)
})

test('Excel precision limits preserve large source values as text and leave dependent totals unresolved', async () => {
  const rows = [
    source({
      quantity: '9007199254740993',
      loadedBoxes: '9007199254740991',
      effectiveAmount: '1234567890123456.78',
    }),
  ]
  const plan = planPackingWorkbook(rows, options)
  assert.equal(cell(plan, plan.products[0], 'orderQuantity').value, '')
  assert.equal(cell(plan, plan.products[0], 'orderAmount').value, '')
  assert.equal(cell(plan, plan.products[0], 'loadedWeight').value, '')
  assert.equal(plan.rows.at(-1).cells.at(-1).value, '')
  const sheet = read(await createPackingWorkbook(rows, options), {
    type: 'array',
  }).Sheets['Packing list']
  assert.equal(sheet.L7.t, 's')
  assert.equal(sheet.L7.v, '9007199254740993')
  assert.equal(sheet.R7.v, '1234567890123456.78')
  assert.match(sheet.M7.f, /COUNTIF\(L7:L7,"\?\*"\)>0/)
})

test('oversized or unsupported images and failed image preparation produce no partial workbook', async () => {
  const large = png(),
    view = new DataView(large.buffer)
  view.setUint32(16, 2048)
  await assert.rejects(
    createPackingWorkbook([source()], {
      ...options,
      prepareImages: async () => ({
        photo: { bytes: large, mimeType: 'image/png' },
      }),
    }),
    /resized/
  )
  await assert.rejects(
    createPackingWorkbook([source()], {
      ...options,
      prepareImages: async () => ({
        code: { bytes: encoder.encode('<svg/>'), mimeType: 'image/svg+xml' },
      }),
    }),
    /PNG or JPEG/
  )
  await assert.rejects(
    createPackingWorkbook([source()], {
      ...options,
      prepareImages: async () => {
        throw new Error('Synthetic photo failure')
      },
    }),
    /Synthetic photo failure/
  )
})

const encoder = new TextEncoder()
