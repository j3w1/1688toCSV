import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import {
  preparationTable,
  sourceSizeForCopy,
  preparationColumns,
  preparationCopyFields,
  preparationOrderFields,
  normalizePreparationColumnPreference,
  selectedPreparationColumns,
  DEFAULT_PREPARATION_COLUMNS,
} from '../src/preparation-clipboard.js'
import { createSizeClassifier } from '../src/size-vocabulary.js'
import { UI_MESSAGES } from '../src/ui-messages.js'

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

test('copy calculations preserve decimal and zero quantities for feature cost exports', () => {
  const decimal = preparationCopyFields({
    ...row,
    price: '1.005',
    quantity: '1.5',
    discount: '0.00',
    featureCharge: '0.02',
  })
  assert.equal(decimal.lineAmount, '1.51')
  assert.equal(decimal.featureCharge, '0.02')
  assert.equal(
    preparationCopyFields({ ...row, quantity: '0' }).lineAmount,
    '0.00'
  )
})

test('size wording and the assigned size code copy independently as exact text', () => {
  const rows = [
    { ...row, sourceSize: '001.50 × 020CM', sizeSuffix: '00300' },
    { ...row, sourceSize: '特别大号', sizeSuffix: 'XL' },
    { ...row, sourceSize: '', sizeSuffix: '' },
  ]
  const result = preparationTable(rows, ['sourceSize', 'sizeSuffix'], true)
  assert.equal(
    result.plain,
    'Size\tSize code\r\n001.50 × 020CM\t00300\r\n特别大号\tXL\r\n\t'
  )
  const { document } = parseHTML(result.html)
  assert.deepEqual(
    [...document.querySelectorAll('td')].map((cell) => cell.textContent),
    ['001.50 × 020CM', '00300', '特别大号', 'XL', '', '']
  )
  for (const cell of document.querySelectorAll('td'))
    assert.match(cell.getAttribute('style'), /mso-number-format/)
  assert.equal(
    preparationTable(rows, ['sourceSize']).plain,
    '001.50 × 020CM\r\n特别大号\r\n'
  )
  assert.equal(preparationTable(rows, ['sizeSuffix']).plain, '00300\r\nXL\r\n')
})

test('source sizes retain explicit measurements and unclassified seller wording', () => {
  const item = {
    title: '合成花盆',
    skuProperties: [
      { label: '规格', value: '14*65CM' },
      { label: '内框尺寸', value: '手工定制尺寸' },
      { label: '颜色', value: '黑色' },
    ],
    description: '合成花盆\n规格：14*65CM\n内框尺寸：手工定制尺寸\n颜色：黑色',
  }
  const original = structuredClone(item)
  assert.equal(sourceSizeForCopy(item), '14*65CM / 手工定制尺寸')
  assert.deepEqual(item, original)
  assert.equal(
    sourceSizeForCopy({
      title: '花瓶',
      description: '花瓶\n尺寸：10.00 × 20CM',
    }),
    '10.00 × 20CM'
  )
  assert.equal(
    sourceSizeForCopy(
      { title: '花瓶', skuProperties: [{ label: '款式', value: '特制高款' }] },
      createSizeClassifier([{ match: '特制高款', suffix: 'XL' }])
    ),
    '特制高款'
  )
  assert.equal(
    sourceSizeForCopy({ title: '特大号花瓶 A3', productNumber: 'A3' }),
    ''
  )
})

test('column preferences preserve legacy choices, exact order and an intentionally empty selection', () => {
  assert.deepEqual(selectedPreparationColumns(), DEFAULT_PREPARATION_COLUMNS)
  assert.deepEqual(
    selectedPreparationColumns([
      'quantity',
      'sourceSize',
      'quantity',
      'missing',
    ]),
    ['quantity', 'sourceSize']
  )
  const preference = normalizePreparationColumnPreference({
    selected: ['sourceSize', 'orderId', 'productTags'],
    order: ['productTags', 'orderId', 'sourceSize', 'missing', 'orderId'],
  })
  assert.deepEqual(selectedPreparationColumns(preference), [
    'productTags',
    'orderId',
    'sourceSize',
  ])
  assert.deepEqual(selectedPreparationColumns({ selected: [], order: [] }), [])
  assert.equal(new Set(preference.order).size, preparationColumns.length)
  for (const [, title, group] of preparationColumns)
    for (const key of [title, group])
      for (const language of ['zh', 'es'])
        assert.ok(UI_MESSAGES[key]?.[language], `${key}: ${language}`)
})

test('preparation rows preserve the authoritative spreadsheet source type for factory and market image formatting', () => {
  for (const kind of ['factory', 'market']) {
    const record = {
      snapshot: { sourceType: 'spreadsheet', store: { kind }, totals: {} },
    }
    const copied = preparationCopyFields({
      ...row,
      sourceType: '1688',
      ...preparationOrderFields(row, record),
    })
    assert.equal(copied.sourceType, 'spreadsheet')
  }
  assert.equal(
    preparationOrderFields(row, {
      snapshot: { sourceType: '1688', totals: {} },
    }).sourceType,
    '1688'
  )
})

test('expanded columns copy only the matching saved source metadata and use exact row amounts', () => {
  const input = {
    ...row,
    entryId: '5127523670009019539',
    quantity: '3',
    discount: '0.01',
    skuProperties: [
      { label: '型号', value: '001-A', raw: '型号：001-A' },
      { label: '颜色', value: '墨黑', raw: '颜色：墨黑' },
      { label: '材质', value: '玻璃', raw: '材质：玻璃' },
      { label: '尺寸', value: '14*65CM', raw: '尺寸：14*65CM' },
    ],
    sourceSize: 'Saved size 14 × 65CM',
    variantDescription: 'Saved black variant',
  }
  const record = {
    snapshot: {
      purchasedAt: '2026-10-15T03:04:05+08:00',
      observedAt: '2026-10-15T06:00:00Z',
      status: '待付款',
      sellerName: '原始卖家',
      sourceUrl:
        'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1',
      totals: { shipping: '1.20', payable: '11.80' },
    },
    lastCheckedAt: '2026-10-16T06:00:00Z',
    tags: ['Order tag'],
    notes: '=SUM(A1)',
    productTags: {
      [input.entryId]: ['Selected product'],
      other: ['Other product'],
    },
  }
  const output = preparationCopyFields({
    ...input,
    ...preparationOrderFields(input, record),
  })
  assert.equal(output.sourceSize, 'Saved size 14 × 65CM')
  assert.equal(output.variantDescription, 'Saved black variant')
  assert.equal(output.lineAmount, '0.38')
  assert.equal(output.lineNetAmount, '0.37')
  assert.equal(output.model, '001-A')
  assert.equal(output.sourceColor, '墨黑')
  assert.equal(output.sourceMaterial, '玻璃')
  assert.deepEqual(output.productTags, ['Selected product'])
  assert.equal(output.orderDate, '2026-10-15T03:04:05+08:00')
  assert.equal(output.orderStatus, '待付款')
  assert.equal(output.lastChecked, '2026-10-16T06:00:00Z')
  assert.equal(output.orderDiscount, '')
  assert.equal(output.storeUrl, '')
  assert.equal(
    preparationCopyFields({ ...input, sourceSize: '' }).sourceSize,
    ''
  )
  assert.deepEqual(preparationOrderFields(input), {})
  const result = preparationTable(
    [output],
    [
      'productTags',
      'entryId',
      'orderNotes',
      'lineNetAmount',
      'orderShipping',
      'storeUrl',
    ],
    true,
    (key) => `Header: ${key}`
  )
  assert.equal(
    result.plain.split('\r\n')[1],
    "Selected product\t5127523670009019539\t'=SUM(A1)\t0.37\t1.20\t"
  )
  assert.match(result.plain, /^Header: Product tags\tHeader: Product entry ID/)
  const { document } = parseHTML(result.html)
  assert.equal(document.querySelectorAll('td')[2].textContent, "'=SUM(A1)")
  assert.equal(record.notes, '=SUM(A1)')
  assert.deepEqual(record.productTags[input.entryId], ['Selected product'])
})

test('numeric-looking IDs and unsafe expressions stay text in arbitrary column order', () => {
  const result = preparationTable(
    [
      {
        ...row,
        entryId: '001234567890123456789',
        orderNotes: '@SUM(1)',
        price: '=1+1',
      },
    ],
    ['entryId', 'orderNotes', 'price', 'unknown', 'entryId']
  )
  assert.equal(result.plain, "001234567890123456789\t'@SUM(1)\t'=1+1")
  const { document } = parseHTML(result.html)
  assert.equal(document.querySelectorAll('td').length, 3)
  for (const cell of document.querySelectorAll('td'))
    assert.match(cell.getAttribute('style'), /mso-number-format/)
})
