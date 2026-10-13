import test from 'node:test'
import assert from 'node:assert/strict'
import { extractOrder } from '../src/extract.js'
import {
  buildOrderFixture,
  createOrderFixture,
} from './fixtures/order-fixture.mjs'

const orderUrl =
  'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1234567890123456789'

function simpleRow(overrides = {}) {
  return {
    title: 'Synthetic product',
    price: '12.50',
    quantity: '4',
    discounts: [],
    ...overrides,
  }
}

test('extracts products, seller, and exact order suffix through nested open shadows', () => {
  const document = createOrderFixture({
    rows: [
      simpleRow({
        title: ' 测试香薰蜡烛 ',
        sku: ' 颜色：暖白 ',
        productNumber: ' 货号：DEMO-001 ',
        thumbnail: 'https://example.invalid/product.64x64.jpg',
        discountedPrice: '11.975',
        discounts: ['省2.00元', '减0.10元'],
      }),
    ],
  })
  assert.deepEqual(extractOrder(document, orderUrl), {
    sellerName: '示例工厂',
    orderSuffix: '6789',
    dataRows: [
      {
        thumbnail: 'https://example.invalid/product.jpg',
        description: '测试香薰蜡烛\n颜色：暖白\n货号：DEMO-001',
        price: '12.50',
        quantity: '4',
        discount: '2.10',
      },
    ],
  })
})

test('keeps source row order and adds decimal discounts without binary precision drift', () => {
  const result = extractOrder(createOrderFixture(), orderUrl)
  assert.equal(result.dataRows.length, 2)
  assert.match(result.dataRows[0].description, /^测试香薰蜡烛/)
  assert.match(result.dataRows[1].description, /^桌面收纳盒/)
  assert.equal(result.dataRows[0].discount, '2.10')
  assert.equal(result.dataRows[1].discount, '0.30')
  assert.equal(result.dataRows[0].price, '12.50')
})

test('single prices, absent optional images/SKU/discounts, and missing seller work', () => {
  const result = extractOrder(
    createOrderFixture({
      sellerName: null,
      nested: false,
      rows: [simpleRow({ thumbnail: null, price: '0.01', quantity: '1' })],
    }),
    orderUrl
  )
  assert.equal(result.sellerName, 'Unknown Seller')
  assert.deepEqual(result.dataRows, [
    {
      thumbnail: '',
      description: 'Synthetic product',
      price: '0.01',
      quantity: '1',
      discount: '0.00',
    },
  ])
})

test('supports grouped prices and quantities without truncating the number', () => {
  const { dataRows } = extractOrder(
    createOrderFixture({
      rows: [
        simpleRow({
          price: '1,234.50',
          quantity: '1,200 件',
          discounts: ['省1,000.20元', '减0.10元'],
        }),
      ],
    }),
    orderUrl
  )
  assert.equal(dataRows[0].price, '1234.50')
  assert.equal(dataRows[0].quantity, '1200')
  assert.equal(dataRows[0].discount, '1000.30')
})

test('does not allocate unrelated whole-order discount into product rows', () => {
  const document = createOrderFixture({ rows: [simpleRow()] })
  const total = document.createElement('div')
  total.className = 'order-total-discount'
  total.textContent = '商品改价：100.00元'
  document.querySelector('app-root').shadowRoot.appendChild(total)
  assert.equal(extractOrder(document, orderUrl).dataRows[0].discount, '0.00')
})

test('rounds monetary discounts once after summing, including sub-cent amounts', () => {
  const result = extractOrder(
    createOrderFixture({
      rows: [simpleRow({ discounts: ['省0.005元', '减0.005元'] })],
    }),
    orderUrl
  )
  assert.equal(result.dataRows[0].discount, '0.01')
})

test('exports the displayed product discount total without deriving it from rounded unit prices', () => {
  const result = extractOrder(
    createOrderFixture({
      rows: [
        simpleRow({
          title: 'Synthetic discounted item',
          price: '3.00',
          discountedPrice: '2.84',
          quantity: '300',
          discountSummary: '优惠共47.20元',
        }),
      ],
    }),
    orderUrl
  )
  assert.equal(result.dataRows[0].discount, '47.20')
  assert.equal(result.dataRows[0].price, '3.00')
  assert.equal(result.dataRows[0].quantity, '300')
})

test('an explicit summary replaces its discount breakdown instead of being added to it', () => {
  const result = extractOrder(
    createOrderFixture({
      rows: [
        simpleRow({
          discountSummary: '优惠共47.20元',
          discounts: ['省40.00元', '减7.20元'],
        }),
      ],
    }),
    orderUrl
  )
  assert.equal(result.dataRows[0].discount, '47.20')
})

test('joins a summary label and amount split across whitespace, elements, and open shadows', () => {
  const result = extractOrder(
    createOrderFixture({
      rows: [
        simpleRow({
          discountSummary: [
            ' 优\n',
            '惠 ',
            '\t共\u00a0',
            '： ',
            '1,047',
            '.20',
            ' 元 ',
          ],
        }),
      ],
    }),
    orderUrl
  )
  assert.equal(result.dataRows[0].discount, '1047.20')
})

test('finds a plain summary in the product row without a discount web component', () => {
  const document = createOrderFixture()
  const fixture = buildOrderFixture(document, { rows: [simpleRow()] })
  const cell = fixture.cells[0].discount.host.parentNode
  fixture.cells[0].discount.host.remove()
  const label = document.createElement('span')
  label.textContent = '优惠共'
  const amount = document.createElement('strong')
  amount.textContent = '47.20'
  cell.append(label, amount, document.createTextNode('元'))
  assert.equal(extractOrder(document, orderUrl).dataRows[0].discount, '47.20')
})

test('keeps summaries isolated by product row and ignores order-wide totals and product copy', () => {
  const document = createOrderFixture({
    rows: [
      simpleRow({ discountSummary: '优惠共47.20元' }),
      simpleRow({ discountSummary: '优惠共0.20元' }),
      simpleRow({
        title: 'Synthetic label 优惠共999.00元',
        discounts: ['省0.10元', '减0.20元'],
      }),
    ],
  })
  const total = document.createElement('div')
  total.textContent = '商品改价 优惠共100.00元'
  document.querySelector('app-root').shadowRoot.appendChild(total)
  assert.deepEqual(
    extractOrder(document, orderUrl).dataRows.map((row) => row.discount),
    ['47.20', '0.20', '0.30']
  )
})

test('identical repeated summaries are counted once', () => {
  const result = extractOrder(
    createOrderFixture({
      rows: [
        simpleRow({
          discountSummary: ['优惠共47.20元', '优惠共47.2元'],
        }),
      ],
    }),
    orderUrl
  )
  assert.equal(result.dataRows[0].discount, '47.20')
})

test('rejects malformed or conflicting advertised totals instead of silently exporting zero', async (t) => {
  for (const discountSummary of [
    '优惠共元',
    '优惠共未知元',
    '优惠共-47.20元',
    '优惠共47.20.30元',
    '优惠共47,20元',
    '优惠共47.20',
    ['优惠共47.20元', '优惠共46.20元'],
    ['优惠共47.20元', '优惠共未知元'],
    ['优惠共47.201元', '优惠共47.202元'],
  ]) {
    await t.test(String(discountSummary), () => {
      assert.throws(
        () =>
          extractOrder(
            createOrderFixture({
              rows: [
                simpleRow(),
                simpleRow({ discountSummary, discounts: ['省1.00元'] }),
              ],
            }),
            orderUrl
          ),
        /Row 2:.*discount/i
      )
    })
  }
})

test('rejects unrecognized advertised discount content rather than treating it as no discount', () => {
  const document = createOrderFixture()
  const fixture = buildOrderFixture(document, { rows: [simpleRow()] })
  fixture.cells[0].discount.root.replaceChildren(
    document.createTextNode('优惠合计47.20元')
  )
  assert.throws(() => extractOrder(document, orderUrl), /Row 1:.*discount/i)
})

test('a malformed advertised discount in a plain discount cell also fails', () => {
  const document = createOrderFixture()
  const fixture = buildOrderFixture(document, { rows: [simpleRow()] })
  fixture.cells[0].discount.host.parentNode.textContent = '优惠合计47.20元'
  assert.throws(() => extractOrder(document, orderUrl), /Row 1:.*discount/i)
})

test('explicit no-discount placeholders remain zero', () => {
  for (const value of ['—', '无优惠', '0.00元']) {
    const document = createOrderFixture()
    const fixture = buildOrderFixture(document, { rows: [simpleRow()] })
    fixture.cells[0].discount.host.parentNode.textContent = value
    assert.equal(extractOrder(document, orderUrl).dataRows[0].discount, '0.00')
  }
})

test('fails clearly when the order application, table, or rows have not loaded', async (t) => {
  await t.test('missing application', () => {
    const document = createOrderFixture()
    document.body.replaceChildren()
    assert.throws(
      () => extractOrder(document, orderUrl),
      /app-root|application|page/i
    )
  })
  await t.test('missing application shadow', () => {
    const document = createOrderFixture()
    document.body.replaceChildren(document.createElement('app-root'))
    assert.throws(
      () => extractOrder(document, orderUrl),
      /shadow|application|page/i
    )
  })
  await t.test('missing table', () => {
    const document = createOrderFixture()
    buildOrderFixture(document).orderTable.remove()
    assert.throws(() => extractOrder(document, orderUrl), /table/i)
  })
  await t.test('empty table', () => {
    assert.throws(
      () => extractOrder(createOrderFixture({ rows: [] }), orderUrl),
      /row|product|empty/i
    )
  })
})

test('rejects a malformed product instead of exporting a silent partial order', async (t) => {
  const cases = [
    ['missing title', { title: '   ' }, /description|title|product/i],
    ['missing price', { price: null }, /price/i],
    ['nonnumeric price', { price: 'unavailable' }, /price/i],
    ['negative price', { price: '-2.00' }, /price/i],
    ['missing quantity', { quantity: '' }, /quantity/i],
    ['zero quantity', { quantity: '0' }, /quantity/i],
    ['negative quantity', { quantity: '-2' }, /quantity/i],
    ['fractional quantity', { quantity: '1.5' }, /quantity/i],
    ['malformed discount', { discounts: ['省未知元'] }, /discount/i],
  ]
  for (const [label, overrides, error] of cases) {
    await t.test(label, () => {
      const document = createOrderFixture({
        rows: [simpleRow(), simpleRow(overrides)],
      })
      assert.throws(() => extractOrder(document, orderUrl), error)
    })
  }
})

test('rejects a product whose required component is missing', () => {
  const document = createOrderFixture()
  const fixture = buildOrderFixture(document)
  fixture.cells[1].number.host.remove()
  assert.throws(
    () => extractOrder(document, orderUrl),
    /quantity|component|row 2/i
  )
})
