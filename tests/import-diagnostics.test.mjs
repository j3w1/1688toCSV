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
  assert.ok(JSON.stringify(safe).length < 20000)
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
    assert.deepEqual(result.products.sample, [])
    assert.deepEqual(result.products.invalidDiscount, {
      row: 2,
      value: value.length > 160 ? `${value.slice(0, 159)}…` : value,
    })
    assert.deepEqual(financialDiagnostics(result), result)
    assert.doesNotMatch(JSON.stringify(result), /Private|thumbnail|<html/)
  }
})
