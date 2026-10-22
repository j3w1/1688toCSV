import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeStoreSheet,
  parseStoreFilename,
  parseStoreNumber,
  STORE_IMPORT_MARKERS,
} from '../src/store-workbook-model.js'

const photo = 'data:image/png;base64,aA=='

function fixture(
  products = [{ group: 1, boxes: 2, perbox: 10, price: 3 }],
  extra = {}
) {
  const markers = [
    'pic',
    'desc',
    'boxes',
    'perbox',
    'qty',
    'price',
    'amount',
    'group',
    'var',
    'kg',
    'cbm',
    'cbmx',
    'cbmy',
    'cbmz',
  ]
  const rows = [
    {
      row: 1,
      cells: markers.map((value, index) => ({
        col: index + 1,
        address: `${String.fromCharCode(65 + index)}1`,
        value,
      })),
    },
  ]
  const images = []
  let sum = 0
  for (const [index, product] of products.entries()) {
    const row = index + 2
    const amount =
      Number(product.price || 0) *
      Number(product.qty ?? product.boxes * product.perbox)
    sum += amount
    const values = { desc: `Product ${index + 1}`, ...product }
    rows.push({
      row,
      cells: markers.map((marker, col) => ({
        col: col + 1,
        address: `${String.fromCharCode(65 + col)}${row}`,
        value: values[marker] ?? null,
      })),
    })
    if (product.group !== null)
      images.push({
        id: `image${index}`,
        dataUrl: photo,
        from: { row, col: 1 },
        to: { row, col: 1 },
      })
  }
  rows.push({
    row: products.length + 3,
    cells: [
      { col: 1, address: `A${products.length + 3}`, value: 'total' },
      { col: 2, address: `B${products.length + 3}`, value: sum },
      { col: 3, address: `C${products.length + 3}`, value: 'total' },
    ],
  })
  return {
    filename: '1234 (2) (Copy).xlsx',
    sheets: [{ name: 'Products', rows, images, merges: [], ...extra }],
  }
}

const analyze = (value) => analyzeStoreSheet(value, 'Products')
const errors = (result) =>
  result.issues.filter((issue) => issue.severity === 'error')

test('canonical English markers and duplicate file names have one identity', () => {
  assert.deepEqual(STORE_IMPORT_MARKERS, [
    'pic',
    'desc',
    'boxes',
    'perbox',
    'qty',
    'price',
    'amount',
    'group',
    'var',
    'kg',
    'cbm',
    'cbmx',
    'cbmy',
    'cbmz',
    'total',
  ])
  assert.deepEqual(parseStoreFilename('C:\\files\\7354 (5) (Copy).xlsx'), {
    key: 'market:7354',
    name: '7354',
    number: '7354',
    kind: 'market',
  })
  assert.deepEqual(parseStoreFilename('力嘉有限公司 (2).xls'), {
    key: 'factory:力嘉有限公司',
    name: '力嘉有限公司',
    number: '',
    kind: 'factory',
  })
})

test('numbers accept ordinary unit annotations and reject ambiguous quantities', () => {
  for (const [input, expected] of [
    ['6元', '6'],
    ['¥ 8.50 RMB', '8.5'],
    ['20.5 K.G.', '20.5'],
    ['0.14 CBM', '0.14'],
    ['1,500 pcs', '1500'],
    ['.25 立方', '0.25'],
    ['60 u.', '60'],
  ])
    assert.equal(parseStoreNumber(input), expected)
  for (const input of [
    '70*50*30',
    '70×50×30',
    '1.8x1.8',
    '10/2',
    '1,50',
    '20 30kg',
    'Infinity',
    'NaN',
    true,
    '-2',
    '5%',
    '10+2',
    '2e3',
  ])
    assert.throws(() => parseStoreNumber(input))
  assert.throws(() => parseStoreNumber('1.5', { integer: true }))
  assert.throws(() => parseStoreNumber('0', { positive: true }))
})

test('valid worksheet normalizes quantities, exact money and source descriptions', () => {
  const result = analyze(fixture())
  assert.deepEqual(errors(result), [])
  assert.equal(result.rows[0].quantity, 20)
  assert.equal(result.rows[0].price, '3.00')
  assert.equal(result.total, '60.00')
  assert.equal(result.computedTotal, '60.00')
  assert.deepEqual(result.rows[0].photos, [photo])
})

test('qty derives pcs/box only when division is exact', () => {
  assert.equal(
    analyze(fixture([{ group: 1, boxes: 2, qty: 20, price: 3 }])).rows[0]
      .perbox,
    10
  )
  assert.ok(
    errors(analyze(fixture([{ group: 1, boxes: 2, qty: 21, price: 3 }]))).some(
      (issue) => issue.code === 'quantity-unresolved'
    )
  )
})

test('quantity, row price and whole order totals are independently corroborated', () => {
  const quantity = analyze(
    fixture([{ group: 1, boxes: 2, perbox: 10, qty: 21, price: 3 }])
  )
  assert.ok(
    errors(quantity).some((issue) => issue.code === 'quantity-mismatch')
  )
  const amount = analyze(
    fixture([{ group: 1, boxes: 2, perbox: 10, price: 3, amount: 61 }])
  )
  assert.ok(
    errors(amount).some(
      (issue) => issue.code === 'amount-mismatch' && issue.cells.includes('G2')
    )
  )
  const source = fixture()
  source.sheets[0].rows.at(-1).cells[1].value = 61
  assert.ok(
    errors(analyze(source)).some((issue) => issue.code === 'total-mismatch')
  )
})

test('fractional unit prices round once at the product row using exact decimals', () => {
  const source = fixture([
    { group: 1, boxes: 1, perbox: 3, price: '0.335', amount: '1.01' },
  ])
  source.sheets[0].rows.at(-1).cells[1].value = '1.01'
  const result = analyze(source)
  assert.deepEqual(errors(result), [])
  assert.equal(result.computedTotal, '1.01')
})

test('blank groups skip rows even when other fields contain data', () => {
  const source = fixture([
    { group: 1, boxes: 2, perbox: 10, price: 3 },
    { group: null, boxes: 4, perbox: 10, price: 3 },
  ])
  source.sheets[0].rows.at(-1).cells[1].value = 60
  const result = analyze(source)
  assert.equal(result.rows.length, 1)
  assert.deepEqual(errors(result), [])
})

test('combined variant totals remain single and require allocation, including A/B size combinations', () => {
  const result = analyze(
    fixture([{ group: 1, boxes: 2, perbox: 10, price: 3, var: 'abs' }])
  )
  assert.deepEqual(result.rows[0].variants, [
    { variant: 'A', size: 'S' },
    { variant: 'B', size: 'S' },
  ])
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'variant-allocation' && issue.severity === 'review'
    )
  )
  assert.equal(result.computedTotal, '60.00')
  const mixed = analyze(
    fixture([
      { group: 1, boxes: 1, perbox: 10, price: 3, var: 'ab' },
      { group: 1, boxes: 1, perbox: 10, price: 3, var: 'c' },
    ])
  )
  assert.ok(errors(mixed).some((issue) => issue.code === 'nested-variants'))
  const sizes = analyze(
    fixture([
      { group: 1, boxes: 1, perbox: 10, price: 3, var: 'abs' },
      { group: 1, boxes: 1, perbox: 10, price: 3, var: 'abm' },
      { group: 1, boxes: 1, perbox: 10, price: 3, var: 'abl' },
    ])
  )
  assert.deepEqual(errors(sizes), [])
})

test('XYZ carton dimensions take precedence over supplied CBM and retain source evidence', () => {
  const result = analyze(
    fixture([
      {
        group: 1,
        boxes: 2,
        perbox: 10,
        price: 3,
        cbm: 0.2,
        cbmx: 70,
        cbmy: 50,
        cbmz: 30,
      },
    ])
  )
  assert.equal(result.rows[0].cbm, 0.105)
  assert.equal(result.rows[0].sourceCbm, 0.2)
  assert.ok(
    errors(
      analyze(fixture([{ group: 1, boxes: 2, perbox: 10, price: 3, cbmx: 70 }]))
    ).some((issue) => issue.code === 'incomplete-dimensions')
  )
})

test('missing photos block import; multiple photos are retained; shared merges need review', () => {
  const source = fixture()
  source.sheets[0].images = []
  assert.ok(
    errors(analyze(source)).some((issue) => issue.code === 'photo-missing')
  )
  const multi = fixture()
  multi.sheets[0].images.push({
    ...multi.sheets[0].images[0],
    id: 'second',
    dataUrl: 'data:image/png;base64,Yg==',
  })
  assert.equal(analyze(multi).rows[0].photos.length, 2)
  const shared = fixture([
    { group: 1, boxes: 1, perbox: 10, price: 3 },
    { group: 1, boxes: 1, perbox: 10, price: 3 },
  ])
  shared.sheets[0].images = [
    {
      id: 'shared',
      dataUrl: photo,
      from: { row: 2, col: 1 },
      to: { row: 3, col: 1 },
    },
  ]
  shared.sheets[0].merges = [
    { from: { row: 2, col: 1 }, to: { row: 3, col: 1 } },
  ]
  assert.deepEqual(errors(analyze(shared)), [])
  assert.ok(
    analyze(shared).issues.some((issue) => issue.code === 'photo-shared')
  )
  shared.sheets[0].rows[2].cells[7].value = 2
  shared.sheets[0].images[0].to = { row: 2, col: 1 }
  const separateGroups = analyze(shared)
  assert.deepEqual(errors(separateGroups), [])
  assert.deepEqual(
    separateGroups.rows.map((row) => row.photos),
    [[photo], [photo]]
  )
  assert.equal(separateGroups.groupCount, 2)
  assert.deepEqual(
    separateGroups.issues
      .filter((issue) => issue.code === 'photo-shared')
      .map((issue) => issue.cells),
    [['A2', 'A3']]
  )
})

test('one anchored photo serves different groups only within covered pic rows, skipping blank groups and preserving galleries', () => {
  const source = fixture([
    { group: 1, boxes: 1, perbox: 10, price: 3 },
    { group: null, boxes: 1, perbox: 10, price: 3 },
    { group: 2, boxes: 1, perbox: 10, price: 3 },
    { group: 1, boxes: 1, perbox: 10, price: 3 },
  ])
  source.sheets[0].rows.at(-1).cells[1].value = 90
  source.sheets[0].images = [
    {
      id: 'shared',
      dataUrl: photo,
      from: { row: 2, col: 1 },
      to: { row: 5, col: 2, rowOffset: 0, colOffset: 0 },
    },
    {
      id: 'second',
      dataUrl: 'data:image/png;base64,Yg==',
      from: { row: 4, col: 1 },
      to: { row: 4, col: 1 },
    },
  ]
  const result = analyze(source)
  assert.deepEqual(
    result.rows.map((row) => row.row),
    [2, 4, 5]
  )
  assert.deepEqual(
    result.rows.map((row) => row.photos),
    [[photo], [photo, 'data:image/png;base64,Yg=='], []]
  )
  assert.deepEqual(
    errors(result).map((issue) => [issue.code, issue.cells]),
    [['photo-missing', ['A5']]]
  )
  assert.deepEqual(
    result.issues.find((issue) => issue.code === 'photo-shared').cells,
    ['A2', 'A4']
  )
})

test('unreadable shared photos still block every covered group and unrelated-column pictures never fill pic rows', () => {
  const source = fixture([
    { group: 1, boxes: 1, perbox: 10, price: 3 },
    { group: 2, boxes: 1, perbox: 10, price: 3 },
  ])
  source.sheets[0].images = [
    {
      id: 'unreadable',
      unresolved: true,
      dataUrl: photo,
      from: { row: 2, col: 1 },
      to: { row: 3, col: 1 },
    },
    {
      id: 'outside-pic',
      dataUrl: photo,
      from: { row: 2, col: 2 },
      to: { row: 3, col: 2 },
    },
  ]
  const result = analyze(source)
  assert.deepEqual(
    result.rows.map((row) => row.photos),
    [[], []]
  )
  assert.deepEqual(
    errors(result).map((issue) => issue.code),
    ['photo-unresolved', 'photo-missing', 'photo-missing']
  )
  assert.deepEqual(result.issues[0].cells, ['A2', 'A3'])
  assert.equal(
    result.issues.some((issue) => issue.code === 'photo-shared'),
    false
  )
})

test('unmarked columns and unpaired controls are never guessed', () => {
  const source = fixture()
  source.sheets[0].rows[0].cells[1].value = 'unmarked'
  source.sheets[0].rows.at(-1).cells.pop()
  const result = analyze(source)
  assert.equal(result.rows[0].description, 'Group 1')
  assert.ok(errors(result).some((issue) => issue.code === 'total-control'))
})

test('required marker omissions, duplicate markers, blank required cells and formula failures block import', () => {
  for (const marker of ['pic', 'group', 'boxes', 'price']) {
    const source = fixture()
    source.sheets[0].rows[0].cells.find((cell) => cell.value === marker).value =
      'unmarked'
    assert.ok(
      errors(analyze(source)).some(
        (issue) =>
          issue.code === 'missing-marker' && issue.params.marker === marker
      )
    )
  }
  const missingQuantity = fixture()
  for (const cell of missingQuantity.sheets[0].rows[0].cells)
    if (['qty', 'perbox'].includes(cell.value)) cell.value = 'unmarked'
  assert.ok(
    errors(analyze(missingQuantity)).some(
      (issue) => issue.code === 'missing-quantity-marker'
    )
  )
  const duplicate = fixture()
  duplicate.sheets[0].rows[0].cells[6].value = 'price'
  assert.ok(
    errors(analyze(duplicate)).some(
      (issue) => issue.code === 'duplicate-marker'
    )
  )
  for (const col of [3, 6]) {
    const source = fixture()
    source.sheets[0].rows[1].cells.find((cell) => cell.col === col).value = null
    assert.ok(
      errors(analyze(source)).some((issue) => issue.code === 'missing-value')
    )
  }
  for (const sourceCell of [
    { formula: 'A100+1', value: null },
    { formula: 'A100/0', value: '#DIV/0!', error: '#DIV/0!' },
  ]) {
    const source = fixture()
    Object.assign(
      source.sheets[0].rows[1].cells.find((cell) => cell.col === 6),
      sourceCell
    )
    assert.ok(
      errors(analyze(source)).some(
        (issue) => issue.code === 'formula-value' && issue.cells.includes('F2')
      )
    )
  }
})

test('ordinary supplier headers are skipped and marked description roles retain size evidence', () => {
  const source = fixture()
  source.sheets[0].rows[1].row++
  for (const cell of source.sheets[0].rows[1].cells)
    cell.address = cell.address.replace('2', '3')
  source.sheets[0].rows[1].cells[1].value = '10×20cm'
  source.sheets[0].rows.splice(1, 0, {
    row: 2,
    cells: [
      { col: 2, address: 'B2', value: '尺寸' },
      { col: 3, address: 'C2', value: '箱数' },
      { col: 4, address: 'D2', value: '装箱数' },
      { col: 6, address: 'F2', value: '单价' },
      { col: 8, address: 'H2', value: '唛头' },
    ],
  })
  source.sheets[0].images[0].from.row = source.sheets[0].images[0].to.row = 3
  const result = analyze(source)
  assert.deepEqual(errors(result), [])
  assert.equal(result.rows.length, 1)
  assert.deepEqual(result.rows[0].skuProperties, [
    { label: '尺寸', value: '10×20cm' },
  ])
})

test('Excel binary floating point tails do not create false monetary disagreements', () => {
  const source = fixture([
    { group: 1, boxes: 1, perbox: 3, price: 1.1, amount: 3.3000000000000003 },
  ])
  source.sheets[0].rows.at(-1).cells[1].value = 3.3000000000000003
  assert.deepEqual(errors(analyze(source)), [])
})

test('whole-order controls reject numeric Excel errors and formulas without cached values', () => {
  for (const change of [
    { value: 7, formula: '1/0', error: '#DIV/0!' },
    { value: 7, error: '#DIV/0!' },
    { value: null, formula: 'SUM(G2:G3)' },
    { value: undefined, formula: 'SUM(G2:G3)' },
  ]) {
    const source = fixture([{ group: 1, boxes: 1, perbox: 1, price: 7 }])
    const control = source.sheets[0].rows.at(-1).cells[1]
    Object.assign(control, change)
    const result = analyze(source)
    assert.equal(result.total, null)
    assert.ok(
      errors(result).some(
        (issue) =>
          issue.code === 'formula-value' &&
          issue.cells.includes(control.address)
      )
    )
  }
  const source = fixture([{ group: 1, boxes: 1, perbox: 1, price: 7 }])
  source.sheets[0].rows.at(-1).cells[1].formula = 'SUM(G2:G3)'
  const result = analyze(source)
  assert.equal(result.total, '7.00')
  assert.deepEqual(errors(result), [])
})
