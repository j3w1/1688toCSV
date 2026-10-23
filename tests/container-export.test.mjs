import test from 'node:test'
import assert from 'node:assert/strict'
import { read, CFB } from 'xlsx'
import { DOMParser } from 'linkedom'
import {
  planContainerWorkbook,
  createContainerWorkbook,
  createContainerSummary,
  containerPrintRows,
  containerWorkbookFileName,
} from '../src/container-export.js'
import { PACKING_PRODUCT_DEFAULT_COLUMNS } from '../src/packing-workbook.js'
import { SUMMARY_FORMAT } from '../src/export-summary.js'
import { syntheticManifest } from './fixtures/container-fixture.mjs'

test('Cartons retains trusted editable dimension formulas with exact caches, custom columns and truthful unknowns', async () => {
  const manifest = syntheticManifest(),
    cartonColumns = [
      'batch',
      'ht',
      'wid',
      'len',
      'volumePerCarton',
      'totalVolume',
      'loadedVolume',
    ],
    plan = planContainerWorkbook(manifest, { cartonColumns }),
    sheet = plan.sheets[1],
    first = sheet.records[0].row,
    bytes = await createContainerWorkbook(manifest, { cartonColumns }),
    workbook = read(bytes, { type: 'array' }),
    cartons = workbook.Sheets.Cartons
  assert.match(cartons[`E${first}`].f, /D\d+\*C\d+\*B\d+\/1000000/)
  assert.equal(cartons[`E${first}`].v, 0.125)
  assert.equal(cartons[`F${first}`].v, 0.125)
  assert.match(cartons[`F${sheet.totalRow}`].f, /^SUM\(F\d+:F\d+\)$/)
  assert.equal(cartons[`F${sheet.totalRow}`].v, 0.25)
  const hidden = planContainerWorkbook(manifest, {
    cartonColumns: ['batch', 'totalVolume'],
  }).sheets[1]
  assert.ok(
    hidden.rows.every((row) => row.cells.every((cell) => !cell.formula))
  )
  assert.equal(hidden.rows[hidden.records[0].row - 1].cells[1].value, '0.125')
  const unknown = structuredClone(manifest)
  Object.assign(unknown.cartons[0], { len: '', wid: '', ht: '', volume: null })
  unknown.totals.volume = null
  const incomplete = planContainerWorkbook(unknown, { cartonColumns }).sheets[1]
  assert.equal(
    incomplete.rows[incomplete.records[0].row - 1].cells[4].formula,
    undefined
  )
  assert.equal(
    incomplete.rows[incomplete.records[0].row - 1].cells[4].value,
    ''
  )
  assert.equal(
    incomplete.rows[incomplete.totalRow - 1].cells[5].formula,
    undefined
  )
  assert.equal(incomplete.rows[incomplete.totalRow - 1].cells[5].value, '')
  const precise = structuredClone(manifest)
  precise.cartons[0].len = '1.23456789123456789'
  precise.cartons[0].volume = '0.003086419728086419725'
  const exact = planContainerWorkbook(precise, { cartonColumns }).sheets[1]
  assert.equal(exact.rows[exact.records[0].row - 1].cells[4].formula, undefined)
  assert.equal(
    exact.rows[exact.records[0].row - 1].cells[4].value,
    precise.cartons[0].volume
  )
})

const PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2WZ4kAAAAASUVORK5CYII='
const coverage = (knownCount, missingCount, knownSubtotal) => ({
  knownCount,
  missingCount,
  totalCount: knownCount + missingCount,
  knownSubtotal,
  complete: missingCount === 0,
})
function fixture() {
  const record = {
    snapshot: {
      accountId: 'local',
      orderId: 'O1',
      items: [{ entryId: 'A', quantity: '999', price: '200' }],
      totals: { shipping: '9999.99' },
      rawSource: 'RAW-PRIVATE-ASSET',
    },
    wechat: 'PRIVATE-CONTACT',
  }
  const preparation = {
    accountId: 'local',
    orderId: 'O1',
    groups: [{ id: 'M', baseCode: 'MARK', category: '纸制品', variants: [] }],
  }
  const product = (orderId, entryId, quantity, sourceAmount, price) => ({
    accountId: 'local',
    orderId,
    entryId,
    groupId: 'G',
    variantId: 'V',
    sellerName: 'Synthetic supplier',
    orderReference: `REF-${orderId}`,
    barcode: entryId === 'B' ? 'CODE-B' : 'SHARED-CODE',
    baseCode: 'PRODUCT',
    spanishName: `Product ${entryId}`,
    description: 'Literal source & <detail>',
    sourceSize: '001 cm',
    quantity,
    sourceQuantity: '999',
    purchasedQuantity: '999',
    availableBeforeQuantity: '100',
    remainingQuantity: '3',
    sourceUnitPrice: price,
    sourcePrice: price,
    price,
    discount: '0.10',
    sourceAmount,
    effectiveAmount:
      entryId === 'C' ? '36.00' : entryId === 'B' ? '16.00' : '21.00',
    effectiveUnitPrice: '2.123456789',
    additionalCharge: '0.40',
    featureCharge: '0.20',
    linkedPaymentCharge: '0.30',
    freightAllocated: '0.10',
    additionalChargeReasons: 'Manual handling',
    productFeatureCosts: 'Feature (0.20)',
    linkedPaymentReasons: 'Balance allocation',
    freightAllocationBasis: 'source proportional; cents reconciled',
    orderShipping: '9999.99',
    orderAdditionalCharges: '9999.99',
    record: { ...record, snapshot: { ...record.snapshot, orderId } },
    preparation: { ...preparation, orderId },
    thumbnail: PHOTO,
    photos: [PHOTO],
    wechat: 'PRIVATE-CONTACT',
    rawAssets: ['RAW-PRIVATE-ASSET'],
  })
  const a = product('O1', 'A', '10', '20.00', '2.00'),
    b = product('O1', 'B', '5', '15.00', '3.00'),
    c = product('O2', 'C', '7', '35.00', '5.00')
  const unit = (id, orderId, contents, fields = {}) => ({
    id,
    cartonId: id,
    batchId: `batch-${orderId}`,
    accountId: 'local',
    orderId,
    index: 0,
    count: 1,
    state: 'loaded',
    reference: id === 'u1' ? '001' : id,
    labelOrigin: id === 'u1' ? 'reported' : 'internal',
    packingBasis: 'exact',
    contents: Object.entries(contents).map(([entryId, quantity]) => ({
      orderId,
      entryId,
      quantity,
    })),
    unresolvedContents: [],
    weight: null,
    volume: null,
    len: '',
    wid: '',
    ht: '',
    mark: { orderId, groupId: 'M' },
    markCode: 'MARK',
    record: { ...record, snapshot: { ...record.snapshot, orderId } },
    preparation: { ...preparation, orderId },
    revision: 2,
    ...fields,
  })
  const cartons = [
    unit('u1', 'O1', { A: '10', B: '5' }, { weight: '4.00', volume: '0.12' }),
    unit('u2', 'O2', { C: '7' }, { volume: '0' }),
  ]
  a.cartonReferences = ['u1']
  b.cartonReferences = ['u1']
  c.cartonReferences = ['u2']
  const left = {
    ...a,
    quantity: '3',
    sourceAmount: '6.00',
    effectiveAmount: '6.30',
    cartonReferences: ['left1'],
  }
  const leftCarton = unit('left1', 'O1', { A: '2' }, { state: 'left-behind' })
  const leftTotals = {
    orders: 1,
    products: 1,
    quantity: '3',
    cartons: 1,
    weight: null,
    volume: null,
    weightCoverage: coverage(0, 1, null),
    volumeCoverage: coverage(0, 1, null),
  }
  return {
    format: '1688-container-manifest',
    version: 1,
    container: {
      id: 'container-1',
      accountId: 'local',
      name: 'October & <source>',
      period: '2026-10',
      loadingDate: '2026-10-20',
    },
    revisionId: 'container-1/r2',
    revision: 2,
    draft: false,
    status: 'sealed',
    sealedAt: '2026-10-20T12:00:00Z',
    orders: [
      { accountId: 'local', orderId: 'O1', record, preparation },
      {
        accountId: 'local',
        orderId: 'O2',
        record: c.record,
        preparation: c.preparation,
      },
    ],
    products: [a, b, c],
    cartons,
    batches: [],
    leftBehind: {
      products: [left],
      cartons: [leftCarton],
      unprepared: [
        {
          accountId: 'local',
          orderId: 'O1',
          entryId: 'A',
          quantity: '1',
          reason: 'Awaiting report',
        },
      ],
      totals: leftTotals,
    },
    totals: {
      orders: 2,
      products: 3,
      quantity: '22',
      cartons: 2,
      weight: null,
      volume: '0.12',
      sourceAmount: '70.00',
      effectiveAmount: '73.00',
      additionalCharge: '1.20',
      featureCharge: '0.60',
      linkedPaymentCharge: '0.90',
      freightAllocated: '0.30',
      weightCoverage: coverage(1, 1, '4'),
      volumeCoverage: coverage(2, 0, '0.12'),
    },
    preferences: {
      settings: { dpi: 300 },
      logoDataUrl: PHOTO,
      vocabulary: { frozen: true },
      sizeVocabulary: { frozen: true },
    },
    media: { imageRefs: [PHOTO] },
    warnings: [{ code: 'missing-measurements', cartonId: 'u2' }],
  }
}
const settings = { language: 'en', createdAt: '2026-10-22T10:00:00Z' }
const cell = (sheet, row, key) =>
  row.cells[sheet.columns.findIndex((column) => column.key === key)]
const productRow = (sheet, id) =>
  sheet.rows[sheet.products.find((p) => p.source.entryId === id).row - 1]
const part = (archive, name) =>
  new TextDecoder().decode(
    archive.FileIndex[archive.FullPaths.indexOf(`Root Entry/${name}`)].content
  )
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

test('default frozen manifest workbook exports full loaded membership with source-line values and three sheets', async () => {
  const manifest = deepFreeze(fixture()),
    before = structuredClone(manifest)
  const plan = planContainerWorkbook(manifest, {
    ...settings,
    scope: 'selected',
    selected: ['A'],
    filter: () => false,
    selection: [],
  })
  assert.deepEqual(
    plan.sheets.map((s) => s.name),
    ['Packing list', 'Cartons', 'Se quedó']
  )
  assert.deepEqual(
    plan.columns.map((c) => c.key),
    PACKING_PRODUCT_DEFAULT_COLUMNS
  )
  assert.equal(plan.products.length, 3)
  assert.equal(plan.sheets[1].records.length, 2)
  assert.equal(cell(plan, productRow(plan, 'A'), 'quantity').value, '10')
  assert.equal(cell(plan, productRow(plan, 'C'), 'quantity').value, '7')
  assert.equal(cell(plan, productRow(plan, 'A'), 'effectiveAmount').value, '21')
  assert.equal(cell(plan, productRow(plan, 'C'), 'effectiveAmount').value, '36')
  assert.equal(
    plan.rows[plan.totalRow - 1].cells[
      plan.columns.findIndex((c) => c.key === 'quantity')
    ].value,
    '22'
  )
  assert.equal(
    cell(plan, productRow(plan, 'A'), 'unitsPerCarton').value,
    'Shared'
  )
  assert.equal(cell(plan, productRow(plan, 'C'), 'unitsPerCarton').value, '7')
  const allText = plan.rows
    .map((r) => r.cells.map((c) => c.value).join(' '))
    .join('\n')
  assert.doesNotMatch(allText, /9999\.99|RAW-PRIVATE|PRIVATE-CONTACT/)
  assert.match(allText, /Allocated freight 元: 0.2/)
  const bytes = await createContainerWorkbook(manifest, settings),
    workbook = read(bytes, { type: 'array' })
  assert.deepEqual(workbook.SheetNames, ['Packing list', 'Cartons', 'Se quedó'])
  assert.deepEqual(manifest, before)
})

test('shared physical identities and missing measures do not duplicate or become zero', () => {
  const manifest = fixture(),
    plan = planContainerWorkbook(manifest, settings),
    sheet = plan.sheets[1]
  const rows = sheet.rows.filter((row) => row.kind === 'carton'),
    total = sheet.rows[sheet.totalRow - 1]
  assert.equal(rows.length, 2)
  assert.equal(cell(sheet, rows[0], 'count').value, '1')
  assert.equal(cell(sheet, total, 'count').value, '2')
  assert.equal(cell(sheet, rows[0], 'totalWeight').value, '4')
  assert.equal(cell(sheet, rows[1], 'totalWeight').value, '')
  assert.equal(cell(sheet, total, 'totalWeight').value, '')
  assert.equal(cell(sheet, rows[1], 'totalVolume').value, '0')
  assert.equal(cell(sheet, total, 'totalVolume').value, '0.12')
  assert.ok(
    sheet.rows.some(
      (r) =>
        r.kind === 'coverage' &&
        /Known subtotal: 4/.test(r.cells[0].value) &&
        /Cartons outside measurement coverage: 1/.test(r.cells[0].value)
    )
  )
  assert.equal(cell(plan, productRow(plan, 'A'), 'cartonMark').value, 'MARK')
  assert.equal(plan.products[0].markSource.baseCode, 'MARK')
  assert.equal(plan.products[0].markSource.chineseCategory, '纸制品')
  assert.match(
    cell(plan, productRow(plan, 'A'), 'cartonReferences').hyperlink,
    /^'Cartons'!A6$/
  )
})

test('full aggregate combined facts stay in authoritative totals without invented unit splits', async () => {
  const manifest = fixture()
  manifest.cartons = Array.from({ length: 3 }, (_, i) => ({
    ...manifest.cartons[0],
    id: `agg${i}`,
    cartonId: `agg${i}`,
    batchId: 'aggregate',
    reference: `unit-${i}`,
    packingBasis: 'aggregate',
    contents: null,
    weight: null,
    volume: null,
  }))
  manifest.products[0].cartonReferences = manifest.cartons.map((c) => c.id)
  manifest.products = manifest.products.slice(0, 1)
  manifest.batches = [
    {
      id: 'aggregate',
      accountId: 'local',
      orderId: 'O1',
      count: 3,
      packingBasis: 'aggregate',
      contents: [{ orderId: 'O1', entryId: 'A', quantity: '10' }],
      weight: '57.22',
      weightBasis: 'batch',
      suppliedCbm: '0.461256',
      volumeBasis: 'batch',
    },
  ]
  manifest.totals = {
    ...manifest.totals,
    products: 1,
    quantity: '10',
    cartons: 3,
    weight: '57.22',
    volume: '0.461256',
    weightCoverage: coverage(3, 0, '57.22'),
    volumeCoverage: coverage(3, 0, '0.461256'),
  }
  const plan = planContainerWorkbook(manifest, settings),
    sheet = plan.sheets[1]
  assert.equal(
    cell(plan, productRow(plan, 'A'), 'unitsPerCarton').value,
    'Aggregate'
  )
  for (const row of sheet.rows.filter((r) => r.kind === 'carton')) {
    assert.equal(cell(sheet, row, 'contents').value, 'Unknown')
    assert.equal(cell(sheet, row, 'weight').value, '')
    assert.equal(cell(sheet, row, 'totalVolume').value, '')
  }
  assert.equal(
    cell(sheet, sheet.rows[sheet.totalRow - 1], 'totalWeight').value,
    '57.22'
  )
  assert.equal(
    cell(sheet, sheet.rows[sheet.totalRow - 1], 'totalVolume').value,
    '0.461256'
  )
  assert.equal(sheet.rows.filter((r) => r.kind === 'source-evidence').length, 1)
  assert.ok(
    sheet.rows
      .find((r) => r.kind === 'source-evidence')
      .cells[0].value.includes('57.22 kg')
  )
  const workbook = read(await createContainerWorkbook(manifest, settings), {
    type: 'array',
  })
  assert.equal(workbook.Sheets.Cartons.M9.v, 57.22)
  assert.equal(workbook.Sheets.Cartons.M6.v, '')
})

test('partial aggregate does not inherit combined source weight or volume', () => {
  const manifest = fixture()
  manifest.cartons = [
    {
      ...manifest.cartons[0],
      batchId: 'agg',
      packingBasis: 'aggregate',
      contents: null,
      weight: null,
      volume: null,
    },
  ]
  manifest.batches = [
    {
      id: 'agg',
      count: 6,
      weight: '57.22',
      weightBasis: 'batch',
      suppliedCbm: '0.461256',
      volumeBasis: 'batch',
      contents: [],
    },
  ]
  manifest.totals = {
    ...manifest.totals,
    cartons: 1,
    weight: null,
    volume: null,
    weightCoverage: coverage(0, 1, null),
    volumeCoverage: coverage(0, 1, null),
  }
  const sheet = planContainerWorkbook(manifest, settings).sheets[1],
    total = sheet.rows[sheet.totalRow - 1]
  assert.equal(cell(sheet, total, 'totalWeight').value, '')
  assert.equal(cell(sheet, total, 'totalVolume').value, '')
  assert.ok(
    sheet.rows.some(
      (r) => r.kind === 'coverage' && /kg: Unknown/.test(r.cells[0].value)
    )
  )
})

test('left-behind remains historical with known cartons separate from unprepared goods', () => {
  const manifest = fixture(),
    plan = planContainerWorkbook(manifest, settings),
    left = plan.sheets[2]
  assert.equal(left.products.length, 1)
  assert.equal(cell(left, productRow(left, 'A'), 'quantity').value, '3')
  assert.equal(left.rows.filter((r) => r.kind === 'left-carton').length, 1)
  assert.equal(left.rows.filter((r) => r.kind === 'unprepared').length, 1)
  assert.match(
    left.rows.find((r) => r.kind === 'unprepared').cells[0].value,
    /Quantity: 1/
  )
  assert.match(
    cell(left, productRow(left, 'A'), 'cartonReferences').hyperlink,
    /^'Se quedó'!A/
  )
  assert.equal(
    left.products.some((p) => p.source.orderId === 'O2'),
    false
  )
  assert.equal(plan.totals.quantity, '22')
  assert.equal(plan.leftBehind.totals.quantity, '3')
})

test('operator supplier identity remains explicitly authored in revision output without leaking unselected metadata', () => {
  const manifest = fixture()
  const identity = {
    sellerId: 'synthetic-manual-factory',
    storeId: '["1688","synthetic-manual-factory"]',
    provenance: 'manual-confirmed',
    conflict: false,
    sourceSellerId: null,
    resolvedSellerId: 'synthetic-manual-factory',
    contact: 'PRIVATE-CONTACT',
    rawAsset: 'RAW-PRIVATE-ASSET',
  }
  manifest.orders[0].supplierIdentity = identity
  manifest.products[0].supplierIdentity = identity
  manifest.leftBehind.products[0].supplierIdentity = identity
  const summary = createContainerSummary(manifest, { file: 'actual-r2.xlsx' })
  for (const row of [
    summary.orders[0],
    summary.products[0],
    summary.leftBehind.products[0],
  ]) {
    assert.equal(row.supplierIdentity.provenance, 'manual-confirmed')
    assert.equal(row.supplierIdentity.sellerId, identity.sellerId)
    assert.equal('contact' in row.supplierIdentity, false)
    assert.equal('rawAsset' in row.supplierIdentity, false)
  }
  for (const [language, wording] of [
    ['en', 'Operator-confirmed supplier identity'],
    ['es', 'Identidad del proveedor confirmada por el operador'],
    ['zh', '操作员确认的供应商身份'],
  ]) {
    const plan = planContainerWorkbook(manifest, { ...settings, language })
    assert(
      plan.sheets.every((sheet) => JSON.stringify(sheet.rows).includes(wording))
    )
  }
  assert.doesNotMatch(
    JSON.stringify(summary),
    /PRIVATE-CONTACT|RAW-PRIVATE-ASSET/
  )
})

test('summary discloses frozen full costs and reasons independently of XLSX columns, without source assets/contacts', () => {
  const manifest = fixture(),
    summary = createContainerSummary(manifest, {
      file: 'actual-container-r2.xlsx',
      exportedAt: '2026-10-22T10:00:00Z',
    })
  assert.equal(summary.format, SUMMARY_FORMAT)
  assert.equal(summary.version, 3)
  assert.equal(summary.scope, 'container-revision')
  assert.deepEqual(summary.files, [
    'actual-container-r2.xlsx',
    'actual-container-r2.json',
  ])
  assert.equal(summary.containerId, 'container-1')
  assert.equal(summary.revisionId, 'container-1/r2')
  assert.equal(summary.products[0].sourceAmount, '20.00')
  assert.equal(summary.products[0].effectiveAmount, '21.00')
  assert.equal(summary.products[0].additionalCharge, '0.40')
  assert.equal(summary.products[0].featureCharge, '0.20')
  assert.equal(summary.products[0].linkedPaymentCharge, '0.30')
  assert.equal(summary.products[0].freightAllocated, '0.10')
  assert.equal(summary.products[0].linkedPaymentReasons, 'Balance allocation')
  assert.equal(summary.products[0].purchasedQuantity, '999')
  assert.deepEqual(summary.totals, manifest.totals)
  assert.equal(summary.leftBehind.products[0].quantity, '3')
  assert.equal(summary.leftBehind.unprepared[0].quantity, '1')
  assert.doesNotMatch(
    JSON.stringify(summary),
    /PRIVATE-CONTACT|RAW-PRIVATE-ASSET|data:image|imageRefs|9999\.99/
  )
  assert.equal('snapshot' in summary, false)
  const minimal = planContainerWorkbook(manifest, {
    ...settings,
    columns: ['quantity'],
  })
  assert.deepEqual(
    minimal.columns.map((c) => c.key),
    ['quantity']
  )
  assert.equal(summary.products.length, 3)
  assert.throws(() => createContainerSummary(manifest), /actual.*filename/)
})

test('revision identity and prominent draft labels survive minimal advanced layout and filename sanitization', () => {
  const manifest = fixture()
  manifest.draft = true
  manifest.status = 'draft'
  manifest.revisionId = null
  manifest.revision = 7
  const plan = planContainerWorkbook(manifest, {
    ...settings,
    columns: ['quantity', 'spanishName'],
    cartonColumns: ['count'],
    includeOrderDetails: false,
    includeTotals: false,
    freezeHeaders: false,
    filters: false,
    photoSize: 'large',
    descriptionWidth: 60,
    style: 'soft',
  })
  assert.equal(plan.draft, true)
  assert.match(plan.fileName, /^DRAFT-/)
  assert.match(plan.fileName, /container-1-draft-r7\.xlsx$/)
  for (const sheet of plan.sheets) {
    assert.match(sheet.rows[0].cells[0].value, /DRAFT.*unsealed/)
    assert.match(sheet.rows[1].cells[0].value, /container-1/)
    assert.match(sheet.rows[1].cells[0].value, /draft-r7/)
    assert.equal(sheet.freezeHeaders, false)
    assert.equal(sheet.filters, false)
  }
  assert.equal(
    createContainerSummary(manifest, { file: plan.fileName }).draft,
    true
  )
  assert.doesNotMatch(
    containerWorkbookFileName(fixture(), new Date('2026-10-22T10:00:00Z')),
    /[<>/&]/
  )
})

test('zero-loaded sealed revision produces valid empty sheets and zero physical totals', async () => {
  const manifest = fixture()
  manifest.products = []
  manifest.cartons = []
  manifest.totals = {
    quantity: '0',
    cartons: 0,
    weight: '0',
    volume: '0',
    weightCoverage: coverage(0, 0, '0'),
    volumeCoverage: coverage(0, 0, '0'),
  }
  manifest.leftBehind = {
    products: [],
    cartons: [],
    unprepared: [],
    totals: { quantity: '0', cartons: 0, weight: '0', volume: '0' },
  }
  const plan = planContainerWorkbook(manifest, settings)
  assert.equal(plan.products.length, 0)
  assert.equal(plan.sheets[1].records.length, 0)
  assert.equal(
    cell(
      plan.sheets[1],
      plan.sheets[1].rows[plan.sheets[1].totalRow - 1],
      'count'
    ).value,
    '0'
  )
  const workbook = read(await createContainerWorkbook(manifest, settings), {
    type: 'array',
  })
  assert.equal(workbook.SheetNames.length, 3)
  assert.deepEqual(containerPrintRows(manifest), [])
  assert.deepEqual(containerPrintRows(manifest, { kind: 'mark' }), [])
  assert.equal(
    createContainerSummary(manifest, { file: 'zero.xlsx' }).totals.quantity,
    '0'
  )
})

test('print rows preserve frozen source-line purchases, independent marks and physical identity', () => {
  const manifest = deepFreeze(fixture())
  const barcode = containerPrintRows(manifest),
    marks = containerPrintRows(manifest, { kind: 'mark' })
  assert.equal(barcode.length, 3)
  assert.equal(barcode[0].barcode, barcode[2].barcode)
  assert.deepEqual(
    barcode.map((r) => r.quantity),
    ['10', '5', '7']
  )
  assert.equal(barcode[0].record.snapshot.items[0].quantity, '999')
  assert.deepEqual(barcode[0].preferences, manifest.preferences)
  assert.deepEqual(
    marks.map((r) => r.quantity),
    ['1', '1']
  )
  assert.ok(
    marks.every(
      (r) =>
        r.known === 1 &&
        r.markCode === 'MARK' &&
        r.baseCode === 'MARK' &&
        r.chineseCategory === '纸制品'
    )
  )
  assert.deepEqual(
    marks.map((r) => r.cartonId),
    ['u1', 'u2']
  )
  assert.deepEqual(marks[0].mark, { orderId: 'O1', groupId: 'M' })
  marks[0].preparation.groups[0].category = 'changed outside'
  assert.equal(manifest.cartons[0].preparation.groups[0].category, '纸制品')
  assert.throws(
    () => containerPrintRows(manifest, { kind: 'live' }),
    /barcode or mark/
  )
})

test('frozen revision outputs remain unchanged after unrelated live-source/preferences mutation', async () => {
  const manifest = structuredClone(fixture()),
    before = createContainerSummary(manifest, {
      file: 'old.xlsx',
      exportedAt: 'fixed',
    })
  const live = fixture()
  live.products[0].quantity = '9999'
  live.products[0].effectiveAmount = '99999'
  live.preferences.settings.dpi = 600
  live.leftBehind.products[0].quantity = '777'
  assert.deepEqual(
    createContainerSummary(manifest, { file: 'old.xlsx', exportedAt: 'fixed' }),
    before
  )
  const rows = []
  await createContainerWorkbook(manifest, {
    ...settings,
    columns: ['spanishName'],
    cartonColumns: ['count'],
    prepareImages: async () => {
      throw new Error('omitted artwork must not render')
    },
  })
  assert.equal(rows.length, 0)
})

test('source strings and exact large quantities remain literal safe XML, without formulas or external references', async () => {
  const manifest = fixture()
  manifest.products[0].description = '=HYPERLINK("https://invalid","<&>")\u0001'
  manifest.products[0].barcode = '001=2+3'
  manifest.products[0].quantity = '900719925474099312345'
  manifest.products[0].effectiveAmount = null
  const bytes = await createContainerWorkbook(manifest, {
    ...settings,
    columns: ['description', 'barcode', 'quantity', 'effectiveAmount'],
    cartonColumns: ['batch', 'contents'],
  })
  const archive = CFB.read(bytes, { type: 'array' }),
    xml = part(archive, 'xl/worksheets/sheet1.xml')
  assert.match(xml, /&lt;&amp;&gt;/)
  assert.match(xml, /HYPERLINK/)
  assert.doesNotMatch(xml, /<f>|externalLink|\u0001/)
  const parsed = new DOMParser().parseFromString(xml, 'application/xml')
  assert.equal(parsed.getElementsByTagName('parsererror').length, 0)
  const workbook = read(bytes, { type: 'array' })
  const sheet = workbook.Sheets['Packing list'],
    plan = planContainerWorkbook(manifest, {
      ...settings,
      columns: ['description', 'barcode', 'quantity', 'effectiveAmount'],
    })
  const n = plan.products.find((p) => p.source.entryId === 'A').row
  assert.equal(sheet[`B${n}`].v, '001=2+3')
  assert.equal(sheet[`C${n}`].t, 's')
  assert.equal(sheet[`C${n}`].v, '900719925474099312345')
  assert.equal(sheet[`D${n}`].v, '')
})

test('duplicate physical/source identities and inconsistent unit shape reject rather than silently trimming scope', () => {
  const manifest = fixture()
  manifest.cartons.push(structuredClone(manifest.cartons[0]))
  assert.throws(() => planContainerWorkbook(manifest), /twice/)
  const duplicate = fixture()
  duplicate.products.push(structuredClone(duplicate.products[0]))
  assert.throws(
    () => createContainerSummary(duplicate, { file: 'bad.xlsx' }),
    /unique source/
  )
  const count = fixture()
  count.cartons[0].count = 3
  assert.throws(
    () => containerPrintRows(count, { kind: 'mark' }),
    /distinct physical/
  )
})

test('frozen image callback receives exact references and independent mark artwork without live lookup', async () => {
  const manifest = deepFreeze(fixture()),
    calls = []
  const bytes = Uint8Array.from(Buffer.from(PHOTO.split(',')[1], 'base64'))
  const output = await createContainerWorkbook(manifest, {
    ...settings,
    prepareImages: async (source, limits) => {
      calls.push({ source, limits })
      assert.deepEqual(source.preferences, manifest.preferences)
      assert.ok(source.record && source.preparation)
      assert.equal(source.containerId, 'container-1')
      return Object.fromEntries(
        ['photo', 'code', 'mark']
          .filter((key) => limits[key])
          .map((key) => [key, { bytes, mimeType: 'image/png' }])
      )
    },
  })
  assert.ok(calls.length >= 5)
  assert.ok(
    calls.some(
      (call) =>
        call.source.baseCode === 'MARK' &&
        call.source.chineseCategory === '纸制品'
    )
  )
  const archive = CFB.read(output, { type: 'array' })
  assert.equal(
    archive.FullPaths.filter((p) => /xl\/media\/image\d+\.png$/.test(p)).length,
    1
  )
  assert.match(part(archive, 'xl/worksheets/_rels/sheet1.xml.rels'), /drawing1/)
})

test('localized sheets preserve advanced column order, native formats, source wording and links', async () => {
  for (const [language, names] of [
    ['en', ['Packing list', 'Cartons', 'Se quedó']],
    ['es', ['Lista de empaque', 'Cajas', 'Se quedó']],
    ['zh', ['装箱单', '纸箱', '未装柜']],
  ]) {
    const manifest = fixture()
    const plan = planContainerWorkbook(manifest, {
      ...settings,
      language,
      columns: [
        'sourceUnitPrice',
        'effectiveAmount',
        'description',
        'quantity',
        'cartonReferences',
      ],
      cartonColumns: ['totalWeight', 'count', 'contents', 'batch'],
      photoSize: 'compact',
      descriptionWidth: 60,
    })
    assert.deepEqual(
      plan.sheets.map((sheet) => sheet.name),
      names
    )
    assert.deepEqual(
      plan.columns.map((column) => column.key),
      [
        'sourceUnitPrice',
        'effectiveAmount',
        'description',
        'quantity',
        'cartonReferences',
      ]
    )
    assert.equal(
      cell(plan, productRow(plan, 'A'), 'description').value,
      'Literal source & <detail>'
    )
    assert.match(
      cell(plan, productRow(plan, 'A'), 'cartonReferences').hyperlink,
      new RegExp(`^'${names[1]}'!A6$`)
    )
    const workbook = read(
      await createContainerWorkbook(manifest, {
        ...settings,
        language,
        columns: ['sourceUnitPrice', 'effectiveAmount', 'quantity'],
      }),
      { type: 'array', cellNF: true }
    )
    assert.deepEqual(workbook.SheetNames, names)
    assert.equal(workbook.Sheets[names[0]].A7.t, 'n')
    assert.match(workbook.Sheets[names[0]].A7.z, /元/)
  }
})

test('interleaved orders never realign quantities, prices or photos by display row position', () => {
  const manifest = fixture()
  manifest.products = [
    manifest.products[0],
    manifest.products[2],
    manifest.products[1],
  ]
  const plan = planContainerWorkbook(manifest, {
    ...settings,
    columns: ['quantity', 'sourceUnitPrice', 'effectiveAmount'],
  })
  for (const [id, quantity, price, amount] of [
    ['A', '10', '2', '21'],
    ['B', '5', '3', '16'],
    ['C', '7', '5', '36'],
  ]) {
    const row = productRow(plan, id)
    assert.equal(cell(plan, row, 'quantity').value, quantity)
    assert.equal(cell(plan, row, 'sourceUnitPrice').value, price)
    assert.equal(cell(plan, row, 'effectiveAmount').value, amount)
    assert.equal(
      plan.products.find((product) => product.source.entryId === id).source
        .thumbnail,
      PHOTO
    )
  }
})

test('no DOM, storage or network fallback is used when creating from frozen values', async () => {
  const descriptors = new Map(
    ['document', 'localStorage', 'fetch'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  )
  try {
    for (const key of ['document', 'localStorage'])
      Object.defineProperty(globalThis, key, {
        configurable: true,
        get() {
          throw new Error(`live ${key} access forbidden`)
        },
      })
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value() {
        throw new Error('network forbidden')
      },
    })
    const manifest = fixture(),
      plan = planContainerWorkbook(manifest, settings)
    assert.equal(plan.products.length, 3)
    assert.equal(
      createContainerSummary(manifest, { file: 'frozen.xlsx' }).products.length,
      3
    )
    assert.equal(containerPrintRows(manifest).length, 3)
    assert.ok(
      (await createContainerWorkbook(manifest, settings)).byteLength > 0
    )
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

test('explicit unknown loaded quantities and effective prices stay unknown instead of source or zero fallbacks', () => {
  const manifest = fixture()
  manifest.draft = true
  manifest.status = 'draft'
  manifest.products[0].quantity = null
  manifest.products[0].effectiveUnitPrice = null
  manifest.products[0].effectiveAmount = null
  const plan = planContainerWorkbook(manifest, settings),
    row = productRow(plan, 'A')
  assert.equal(cell(plan, row, 'quantity').value, '')
  assert.equal(cell(plan, row, 'effectiveUnitPrice').value, '')
  assert.equal(cell(plan, row, 'effectiveAmount').value, '')
  assert.equal(
    createContainerSummary(manifest, { file: 'DRAFT.xlsx' }).products[0]
      .quantity,
    null
  )
  assert.equal(containerPrintRows(manifest)[0].quantity, null)
})

test('supplied and measured source evidence, warnings and purchase references survive the XLSX projection', async () => {
  const manifest = fixture()
  manifest.batches = [
    {
      id: 'batch-O1',
      count: 1,
      contents: [{ orderId: 'O1', entryId: 'A', quantity: '10' }],
      len: '50',
      wid: '50',
      ht: '50',
      suppliedCbm: '0.2',
      volumeBasis: 'carton',
      weight: '4',
      weightBasis: 'carton',
    },
  ]
  manifest.cartons[0].len = '50'
  manifest.cartons[0].wid = '50'
  manifest.cartons[0].ht = '50'
  manifest.warnings.push({
    code: 'volume-discrepancy',
    batchId: 'batch-O1',
    message: 'Source supplied0.2; measured0.12',
  })
  const plan = planContainerWorkbook(manifest, settings),
    sheet = plan.sheets[1]
  assert.ok(
    sheet.rows.some(
      (r) =>
        r.kind === 'source-evidence' &&
        /Supplied volume: 0.2 m³ · Per carton/.test(r.cells[0].value)
    )
  )
  assert.ok(
    sheet.rows.some(
      (r) =>
        r.kind === 'warning' &&
        /volume-discrepancy.*batch-O1/.test(r.cells[0].value)
    )
  )
  assert.ok(
    plan.rows.some(
      (r) => r.kind === 'order' && /Order: REF-O1/.test(r.cells[0].value)
    )
  )
  assert.equal(
    createContainerSummary(manifest, { file: 'evidence.xlsx' }).cartonBatches[0]
      .suppliedCbm,
    '0.2'
  )
  const xml = part(
    CFB.read(await createContainerWorkbook(manifest, settings), {
      type: 'array',
    }),
    'xl/worksheets/sheet2.xml'
  )
  assert.match(xml, /Supplied volume: 0.2/)
  assert.match(xml, /volume-discrepancy/)
})

test('product packing pattern links minority quantities and exact repeated boxes without averaging', () => {
  const manifest = fixture(),
    plan = planContainerWorkbook(manifest, settings)
  assert.match(
    cell(plan, productRow(plan, 'A'), 'cartonReferences').value,
    /10 in shared 001 · 15 total pieces/
  )
  assert.match(
    cell(plan, productRow(plan, 'B'), 'cartonReferences').value,
    /5 in shared 001 · 15 total pieces/
  )
  assert.match(
    cell(plan, productRow(plan, 'C'), 'cartonReferences').value,
    /1 × 7/
  )
  const physical = plan.sheets[1]
  assert.match(
    cell(physical, physical.rows[5], 'contents').hyperlink,
    /^'Packing list'!A7$/
  )
})

test('an asynchronous image render cannot replace captured revision values with newer mutations', async () => {
  const manifest = fixture()
  let release, entered
  const pending = new Promise((resolve) => {
      release = resolve
    }),
    started = new Promise((resolve) => {
      entered = resolve
    })
  let first = true
  const output = createContainerWorkbook(manifest, {
    ...settings,
    prepareImages: async (source) => {
      if (first) {
        first = false
        entered()
        await pending
      }
      assert.equal(source.preferences.settings.dpi, 300)
      assert.notEqual(source.quantity, '9999')
      return {}
    },
  })
  await started
  manifest.products[0].quantity = '9999'
  manifest.products[0].effectiveAmount = '99999'
  manifest.preferences.settings.dpi = 600
  release()
  const workbook = read(await output, { type: 'array' })
  assert.equal(workbook.Sheets['Packing list'].H7.v, 10)
  assert.equal(workbook.Sheets['Packing list'].M7.v, 21)
})

test('detailed revision summary retains frozen cost reasons, source evidence and allocation budgets without recomputing amounts', () => {
  const manifest = fixture(),
    row = manifest.products[0],
    record = row.record
  record.additionalCharges = [
    {
      id: 'synthetic-handling',
      amount: '10.00',
      reason: 'Original handling reason',
      privateContact: 'PRIVATE-CONTACT',
    },
  ]
  record.productWorkflow = {
    A: {
      features: {
        light: {
          name: 'Synthetic lighting',
          unitCost: '0.01',
          included: false,
        },
        rotation: true,
      },
    },
  }
  record.paymentLinks = [
    {
      id: 'synthetic-balance',
      sourceOrderId: 'SYNTHETIC-SOURCE',
      sourceEntryId: 'FEE',
      amount: '3.00',
      reason: 'Original linked balance reason',
      targetEntryIds: ['A'],
      reviewedAt: '2026-10-20T10:00:00.000Z',
      sourceEvidence: {
        amount: '3.00',
        payable: '3.00',
        shipping: '0.00',
        observedAt: '2026-10-20T09:00:00.000Z',
        rawAsset: 'RAW-PRIVATE-ASSET',
      },
      wechat: 'PRIVATE-CONTACT',
    },
  ]
  row.valuation = {
    sourceQuantity: '999',
    quantity: '10',
    from: '2',
    sourceNet: '1000.00',
    intervals: [{ from: '2', quantity: '10' }],
    budgets: {
      additionalCharge: {
        source: '10.00',
        alreadyAllocated: '1.00',
        remaining: '9.00',
        remainingQuantity: '997',
        privateContact: 'PRIVATE-CONTACT',
      },
      privateContact: 'PRIVATE-CONTACT',
    },
    privateRecord: 'RAW-PRIVATE-ASSET',
  }
  manifest.orders[0].record = record
  manifest.leftBehind.unprepared.push({
    accountId: 'local',
    orderId: 'O1',
    entryId: 'A',
    quantity: '1',
  })
  const summary = createContainerSummary(manifest, {
    file: 'minimal-quantity-only.xlsx',
  })
  const result = summary.products[0],
    evidence = result.costEvidence
  assert.equal(result.sourceAmount, '20.00')
  assert.equal(result.effectiveAmount, '21.00')
  assert.equal(evidence.scope, 'frozen-source-evidence')
  assert.equal(evidence.allocated.additionalCharge, '0.40')
  assert.deepEqual(evidence.additionalCharges, [
    {
      scope: 'source-order',
      id: 'synthetic-handling',
      amount: '10.00',
      reason: 'Original handling reason',
    },
  ])
  assert.deepEqual(evidence.productFeatures, [
    {
      scope: 'source-unit',
      key: 'light',
      name: 'Synthetic lighting',
      unitCost: '0.01',
      included: false,
    },
    {
      scope: 'source-unit',
      key: 'rotation',
      name: 'Rotation',
      unitCost: '0.00',
      included: true,
    },
  ])
  assert.equal(
    evidence.linkedPayments[0].reason,
    'Original linked balance reason'
  )
  assert.equal(evidence.linkedPayments[0].sourceOrderId, 'SYNTHETIC-SOURCE')
  assert.deepEqual(evidence.allocation.budgets.additionalCharge, {
    source: '10.00',
    alreadyAllocated: '1.00',
    remaining: '9.00',
    remainingQuantity: '997',
  })
  assert.deepEqual(evidence.allocation.intervals, [
    { from: '2', quantity: '10' },
  ])
  assert.equal(
    summary.leftBehind.unprepared.find((product) => product.entryId === 'A')
      .costEvidence.additionalCharges[0].reason,
    'Original handling reason'
  )
  assert.doesNotMatch(
    JSON.stringify(summary),
    /PRIVATE-CONTACT|RAW-PRIVATE-ASSET|data:image/
  )
  record.additionalCharges[0].reason = 'Later live reason'
  record.paymentLinks[0].reason = 'Later live balance'
  row.valuation.budgets.additionalCharge.remaining = '0.00'
  assert.equal(evidence.additionalCharges[0].reason, 'Original handling reason')
  assert.equal(
    evidence.linkedPayments[0].reason,
    'Original linked balance reason'
  )
  assert.equal(evidence.allocation.budgets.additionalCharge.remaining, '9.00')
})
