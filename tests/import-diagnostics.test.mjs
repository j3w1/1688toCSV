import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { buildOrderFixture } from './fixtures/order-fixture.mjs'
import {
  collectFinancialDiagnostics,
  financialDiagnostics,
} from '../src/import-diagnostics.js'

test('failed-read evidence captures financial breakdown and aggregates, excluding unrelated page contents', () => {
  const { document } = parseHTML(
    '<html><body><div>Private recipient address</div><input type="password" value="not-diagnostic-data"></body></html>'
  )
  const fixture = buildOrderFixture(document, {
    rows: Array.from({ length: 35 }, () => ({
      title: 'Private product title',
      sku: 'Private attributes',
      price: '0.10',
      quantity: '3',
      discounts: [],
    })),
  })
  const totals = document.createElement('order-total-price')
  totals.attachShadow({ mode: 'open' }).innerHTML =
    '<div class="detail-price"><dl><dt>红包</dt><dd>减 ¥1.25</dd></dl><dl><dt>未知项目</dt><dd>¥2.00</dd></dl></div><div class="total-sum-pay">实付款 ¥11.25</div><div class="total-discount">优惠共1.25元</div>'
  fixture.appRoot.shadowRoot.append(totals)
  const result = collectFinancialDiagnostics(
    document,
    'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=10001',
    'synthetic-version'
  )
  assert.equal(result.totalSections, 1)
  assert.deepEqual(result.fields, [
    { label: '红包', value: '减 ¥1.25' },
    { label: '未知项目', value: '¥2.00' },
  ])
  assert.equal(result.payable, '实付款 ¥11.25')
  assert.equal(result.products.count, 35)
  assert.equal(result.products.gross, '10.50')
  assert.equal(result.products.discount, '0.00')
  assert.equal(result.products.sample.length, 25)
  assert.equal(result.products.omittedRows, 10)
  assert.equal(result.products.invalidDiscount, undefined)
  assert.doesNotMatch(
    JSON.stringify(result),
    /Private|not-diagnostic-data|thumbnail|<html/
  )
})

test('diagnostics stay bounded and allowlisted through persistence and incomplete-page failures', () => {
  const input = {
    version: 1,
    cookies: 'not diagnostic',
    html: '<html>not diagnostic</html>',
    fields: Array.from({ length: 1000 }, () => ({
      label: 'x'.repeat(1000),
      value: 'y'.repeat(1000),
      secret: 'not diagnostic',
    })),
    products: {
      count: 1000,
      invalidDiscount: {
        row: 2,
        value: 'z'.repeat(1000),
        html: 'not diagnostic',
      },
      sample: Array.from({ length: 1000 }, () => ({
        price: '1'.repeat(1000),
        quantity: '1',
        discount: '0',
        discountAmountTexts: Array(1000).fill('a'.repeat(1000)),
        discountItemTexts: Array(1000).fill('d'.repeat(1000)),
        omittedDiscountAmountTexts: 2,
        discountSummaryTexts: Array(1000).fill('b'.repeat(1000)),
        priceTexts: Array(1000).fill('c'.repeat(1000)),
        description: 'not diagnostic',
        url: 'not diagnostic',
      })),
    },
  }
  const safe = financialDiagnostics(input)
  assert.equal(safe.fields.length, 30)
  assert.equal(safe.omittedFields, 970)
  assert.equal(safe.fields[0].value.length, 160)
  assert.equal(safe.fields[0].value.at(-1), '…')
  assert.equal(safe.products.sample.length, 25)
  assert.equal(safe.products.omittedRows, 975)
  assert.deepEqual(safe.products.invalidDiscount, {
    row: 2,
    value: `${'z'.repeat(159)}…`,
  })
  assert.deepEqual(safe.products.sample[0].discountAmountTexts, [
    `${'a'.repeat(63)}…`,
    `${'a'.repeat(63)}…`,
    `${'a'.repeat(63)}…`,
  ])
  assert.equal(safe.products.sample[0].omittedDiscountAmountTexts, 999)
  assert.equal(safe.products.sample[0].omittedDiscountItemTexts, 997)
  assert.equal(safe.products.sample[0].omittedDiscountSummaryTexts, 997)
  assert.equal(safe.products.sample[0].omittedPriceTexts, 997)
  assert.ok(JSON.stringify(safe).length < 40000)
  assert.doesNotMatch(
    JSON.stringify(safe),
    /not diagnostic|secret|cookies|html/
  )
  assert.deepEqual(financialDiagnostics(safe), safe)
  const { document } = parseHTML('<html><body>Sign in</body></html>')
  const missing = collectFinancialDiagnostics(
    document,
    'https://example.test/',
    'test'
  )
  assert.equal(missing.totalSections, 0)
  assert.ok(missing.products.error)
  assert.equal(financialDiagnostics(null), undefined)
})

test('invalid row discounts retain only the bounded amount text without accepting the failed extraction', () => {
  for (const value of [
    '',
    '—',
    '-1.00',
    '省1.00元 减2.00元',
    '?'.repeat(1000),
  ]) {
    const { document } = parseHTML(
      '<html><body><div>Private recipient address</div></body></html>'
    )
    buildOrderFixture(document, {
      rows: [
        {
          title: 'Private product title',
          price: '10',
          quantity: '1',
          discounts: [],
        },
        {
          title: 'Private product title',
          sku: 'Private attributes',
          price: '10',
          quantity: '1',
          discounts: [value],
        },
      ],
    })
    const result = collectFinancialDiagnostics(
      document,
      'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=10001',
      'synthetic-version'
    )
    assert.match(
      result.products.error,
      /^Row 2: discount is missing or invalid\./
    )
    assert.equal(result.products.count, 0)
    assert.equal(result.products.gross, '')
    assert.equal(result.products.discount, '')
    assert.equal(result.products.sample.length, 2)
    assert.deepEqual(result.products.sample[1], {
      row: 2,
      price: '',
      quantity: '',
      discount: '',
      discountAmountTexts: [
        value.length > 64 ? `${value.slice(0, 63)}…` : value,
      ],
      omittedDiscountAmountTexts: 0,
      discountSummaryTexts: [],
      omittedDiscountSummaryTexts: 0,
      priceTexts: ['10 元/件'],
      omittedPriceTexts: 0,
    })
    assert.deepEqual(result.products.invalidDiscount, {
      row: 2,
      value: value.length > 160 ? `${value.slice(0, 159)}…` : value,
    })
    assert.deepEqual(financialDiagnostics(result), result)
    assert.doesNotMatch(JSON.stringify(result), /Private|thumbnail|<html/)
  }
})

test('financial samples retain source amounts and both displayed prices without surrounding product copy', () => {
  const { document } = parseHTML('<html><body></body></html>')
  const fixture = buildOrderFixture(document, {
    rows: [
      {
        title: 'Private product 优惠共999.00元',
        sku: 'Private variant',
        price: '3.00',
        discountedPrice: '2.843',
        quantity: '300',
        discounts: ['省40.00元', '\n 包邮\n', '减7.20元'],
        discountSummary: ['优\n惠 ', '共 ： ￥47.20 元'],
      },
      {
        title: 'Private product',
        price: '8.00',
        quantity: '2',
        discounts: [],
      },
    ],
  })
  fixture.cells[1].discount.host.parentNode.textContent =
    '优惠共0.30元 Private trailing text https://private.invalid'
  const result = collectFinancialDiagnostics(
    document,
    'https://example.test/',
    'test'
  )
  assert.equal(result.products.error, '')
  assert.deepEqual(result.products.sample[0], {
    row: 1,
    price: '3.00',
    quantity: '300',
    discount: '47.20',
    discountAmountTexts: ['省40.00元', '\n 包邮\n', '减7.20元'],
    omittedDiscountAmountTexts: 0,
    discountSummaryTexts: ['优\n惠 共 ： ￥47.20 元'],
    omittedDiscountSummaryTexts: 0,
    priceTexts: ['优惠后2.843元/件', '3.00 元/件'],
    omittedPriceTexts: 0,
  })
  assert.deepEqual(result.products.sample[1].discountSummaryTexts, [
    '优惠共0.30元',
  ])
  assert.doesNotMatch(
    JSON.stringify(result),
    /Private|private.invalid|999.00|thumbnail/
  )
  assert.deepEqual(financialDiagnostics(result), result)
})

test('failed price and summary validation still keeps bounded source financial evidence', () => {
  for (const overrides of [
    { price: 'unavailable' },
    { discountSummary: ['优惠共47.201元', '优惠共47.202元'] },
    { discountSummary: '优惠共-47.20元' },
  ]) {
    const { document } = parseHTML('<html><body></body></html>')
    buildOrderFixture(document, {
      rows: [
        {
          title: 'Private product',
          price: '3.00',
          quantity: '300',
          ...overrides,
        },
      ],
    })
    const result = collectFinancialDiagnostics(
      document,
      'https://example.test/',
      'test'
    )
    assert.ok(result.products.error)
    assert.equal(result.products.count, 0)
    assert.equal(result.products.gross, '')
    assert.equal(result.products.sample.length, 1)
    assert.deepEqual(result.products.sample[0].priceTexts, [
      `${overrides.price || '3.00'} 元/件`,
    ])
    if (overrides.discountSummary) {
      assert.deepEqual(
        result.products.sample[0].discountSummaryTexts,
        [overrides.discountSummary].flat()
      )
    }
    assert.doesNotMatch(JSON.stringify(result), /Private|thumbnail/)
  }
})

test('discount labels stay paired with amounts inside bounded discount-item snippets', () => {
  const { document } = parseHTML('<html><body></body></html>')
  const fixture = buildOrderFixture(document, {
    rows: [{ title: 'Private product', price: '10.00', quantity: '10' }],
  })
  fixture.cells[0].discount.root.innerHTML =
    '<p>Private outside discount items</p>' +
    Array.from(
      { length: 5 },
      (_, index) =>
        `<div class="order-table-discount-item"><span class="order-table-discount-item-name">商品改价增加</span><span class="order-table-discount-item-price">${index + 1}.00元</span><order-table-goods>Private nested product</order-table-goods></div>`
    ).join('')
  const result = collectFinancialDiagnostics(
    document,
    'https://example.test/',
    'test'
  )
  assert.equal(result.products.error, '')
  assert.deepEqual(result.products.sample[0].discountAmountTexts, [
    '1.00元',
    '2.00元',
    '3.00元',
  ])
  assert.equal(result.products.sample[0].omittedDiscountAmountTexts, 2)
  assert.deepEqual(result.products.sample[0].discountItemTexts, [
    '商品改价增加1.00元',
    '商品改价增加2.00元',
    '商品改价增加3.00元',
  ])
  assert.equal(result.products.sample[0].omittedDiscountItemTexts, 2)
  assert.doesNotMatch(JSON.stringify(result), /Private|thumbnail/)
  assert.deepEqual(financialDiagnostics(result), result)
})

test('older financial samples retain their shape when normalized again', () => {
  const previous = financialDiagnostics({
    version: 1,
    products: {
      count: 1,
      sample: [{ row: 1, price: '3.00', quantity: '2', discount: '0.10' }],
    },
  })
  assert.deepEqual(previous.products.sample, [
    { row: 1, price: '3.00', quantity: '2', discount: '0.10' },
  ])
  assert.deepEqual(
    financialDiagnostics(JSON.parse(JSON.stringify(previous))),
    previous
  )
})
