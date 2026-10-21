import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { deepQuery } from '../src/dom.js'
import { extractOrder } from '../src/extract.js'
import {
  allocateOrderAdjustment,
  extractOrderSnapshot,
} from '../src/order-snapshot.js'
import {
  centsToMoney,
  lineGrossCents,
  moneyToCents,
  normalizePrice,
} from '../src/money.js'
import { buildOrderFixture } from './fixtures/order-fixture.mjs'
import { validateBackup } from '../src/database.js'

const orderId = '9990000000000000001'
const orderUrl = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`
const observedAt = '2026-10-13T12:00:00.000Z'

function fixture(options = {}) {
  const rows = options.rows ?? [
    { price: '12.50', quantity: '4', sourceDiscount: '2.10' },
    { price: '8.00', quantity: '2', sourceDiscount: '0.30' },
  ]
  const { document } = parseHTML('<html><body></body></html>')
  const built = buildOrderFixture(document, {
    rows: rows.map((row, index) => ({
      title: `Synthetic product ${index + 1}`,
      sku: '颜色：橙色',
      productNumber: `货号：DEMO-${index + 1}`,
      ...row,
      discounts: [],
      discountSummary: `优惠共${row.sourceDiscount ?? '0.00'}元`,
    })),
  })
  const app = built.appRoot.shadowRoot
  // This helper supplies all snapshot-specific evidence itself, independent of
  // optional defaults that the shared browser fixture may provide.
  for (const node of deepQuery(app).all(
    'order-total-price, .step-detail-header, .order-info-receipt-content-item'
  ))
    node.remove()
  function element(tag, parent, className = '', value) {
    const node = document.createElement(tag)
    node.className = className
    if (value !== undefined) node.textContent = value
    parent.append(node)
    return node
  }
  const identity = element(
    'div',
    built.orderInfo.shadowRoot,
    'order-info-receipt-content-item'
  )
  element('span', identity, 'field-name', '订单号：')
  const identityValue = element('span', identity, '', orderId)
  built.cells.forEach((cell, index) => {
    const query = deepQuery(cell.goods.root)
    const id =
      rows[index].entryId ??
      `999100000000000${String(index + 1).padStart(4, '0')}`
    const link = `https://trade.1688.com/order/offer_snapshot.htm?order_entry_id=${id}`
    for (const anchor of query.all('a[href]')) anchor.setAttribute('href', link)
    query.one('.goods-info a.oneline').setAttribute('href', link)
  })
  const status = element('div', app, 'step-detail-header')
  const statusText = element(
    'span',
    status,
    'stress',
    options.status ?? '交易已成功'
  )
  element('stage-detail-countdown', status, '', '剩余2天3小时')
  const totalHost = element('order-total-price', app)
  const total = totalHost.attachShadow({ mode: 'open' })
  const details = element('div', total, 'detail-price')
  const fields = {}
  const expected = options.totals ?? {
    goodsGross: '66.00',
    shipping: '4.40',
    sourceDiscount: '2.40',
    payable: '68.00',
  }
  function field(label, value) {
    const dl = element('dl', details)
    element('dt', dl, '', label)
    fields[label] = element('dd', dl, '', value)
    return fields[label]
  }
  field('原价总计', `¥ ${expected.goodsGross}`)
  field('运费', `¥ ${expected.shipping}`)
  if (expected.customizationService !== undefined)
    field('定制服务', expected.customizationService)
  if (expected.redPacketDiscount !== undefined)
    field('红包', expected.redPacketDiscount)
  if (expected.orderAdjustment !== undefined)
    field('商品改价', expected.orderAdjustment)
  field('商品优惠', `减 ¥ ${expected.sourceDiscount}`)
  const totalDiscount = element(
    'div',
    total,
    'total-discount',
    expected.sourceDiscount
  )
  const payable = element('div', total, 'total-sum-pay')
  element('span', payable, 'sum-pay-label', options.paymentLabel ?? '实付款')
  const parts = expected.payable.split('.')
  payable.append(document.createTextNode(` ¥ ${parts[0]}.`))
  element('span', payable, 'sub-ammount', parts[1])
  if (options.usd) payable.append(document.createTextNode(' ($10.00)'))
  return {
    document,
    ...built,
    fields,
    field,
    totalHost,
    totalDiscount,
    payable,
    identityValue,
    statusText,
  }
}

function snapshot(source) {
  return extractOrderSnapshot(source.document, `${orderUrl}&spm=tracking`, {
    observedAt,
  })
}

test('unsigned price changes require one exact direction from the complete totals', () => {
  for (const [payable, adjustment, discount] of [
    ['38.00', '-1.90', '0.00'],
    ['34.20', '1.90', '3.80'],
  ]) {
    const source = fixture({
      rows: [{ price: '0.10', quantity: '380', sourceDiscount: '1.90' }],
      paymentLabel: '待付款',
      totals: {
        goodsGross: '38.00',
        shipping: '0.00',
        sourceDiscount: '1.90',
        orderAdjustment: '¥ 1.90',
        payable,
      },
    })
    source.fields['商品优惠'].parentNode.querySelector('dt').textContent =
      'PLUS价优惠'
    const result = snapshot(source)
    assert.equal(result.totals.orderAdjustment, adjustment)
    assert.equal(result.totals.payable, payable)
    assert.equal(result.items[0].sourceDiscount, '1.90')
    assert.equal(result.items[0].allocatedDiscount, adjustment)
    assert.equal(result.items[0].discount, discount)
    source.payable.querySelector('.sub-ammount').textContent = '01'
    assert.throws(() => snapshot(source), /payable amount does not reconcile/)
  }
  const zero = fixture()
  zero.field('商品改价', '¥0.00')
  assert.equal(snapshot(zero).totals.orderAdjustment, '0.00')
})

test('missing seller retains complete reconciled products with an explicit unavailable identity', () => {
  const source = fixture({
    rows: [{ price: '0.53', quantity: '2', sourceDiscount: '0.00' }],
    totals: {
      goodsGross: '5.06',
      shipping: '1.75',
      sourceDiscount: '0.00',
      payable: '2.81',
    },
  })
  for (const node of deepQuery(source.document).all(
    '.order-info-user-content-item'
  ))
    node.remove()
  source.field('批发优惠', '减 ¥4.00')
  source.totalDiscount.textContent = '4.00'
  const result = snapshot(source)
  assert.equal(result.sellerName, 'Seller unavailable')
  assert.equal(result.sellerUnavailable, true)
  assert.equal(result.sellerMemberLogin, undefined)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].discount, '0.00')
  assert.equal(result.totals.priceIncludedDiscount, '4.00')
  assert.equal(result.totals.payable, '2.81')
  source.fields['运费'].textContent = '¥2.75'
  assert.throws(() => snapshot(source), /payable amount does not reconcile/)
})

test('wholesale prices and adjustments already in row discounts are not subtracted twice', () => {
  for (const includedAdjustment of [false, true]) {
    const rowDiscount = includedAdjustment ? '15.00' : '10.00'
    const source = fixture({
      rows: [{ price: '2.00', quantity: '50', sourceDiscount: rowDiscount }],
      totals: {
        goodsGross: '120.00',
        shipping: '4.00',
        sourceDiscount: '10.00',
        orderAdjustment: '减 ¥5.00',
        payable: '89.00',
      },
    })
    source.field('批发优惠', '减 ¥20.00')
    source.totalDiscount.textContent = '30.00'
    const result = snapshot(source)
    assert.equal(result.totals.goodsGross, '120.00')
    assert.equal(result.totals.priceIncludedDiscount, '20.00')
    assert.equal(
      result.totals.rowIncludedAdjustment,
      includedAdjustment ? '5.00' : undefined
    )
    assert.equal(result.totals.orderAdjustment, '5.00')
    assert.equal(result.totals.goodsNet, '85.00')
    assert.equal(result.items[0].price, '2.00')
    assert.equal(result.items[0].sourceDiscount, rowDiscount)
    assert.equal(
      result.items[0].allocatedDiscount,
      includedAdjustment ? '0.00' : '5.00'
    )
    assert.equal(result.items[0].discount, '15.00')
  }
})

test('wholesale prices coexist with order-only shop coupons and red packets', () => {
  const source = fixture({
    rows: [{ price: '2.00', quantity: '50', sourceDiscount: '10.00' }],
    totals: {
      goodsGross: '120.00',
      shipping: '4.00',
      sourceDiscount: '10.00',
      redPacketDiscount: '减 ¥2.00',
      payable: '89.00',
    },
  })
  source.field('批发优惠', '减 ¥20.00')
  source.field('店铺优惠', '减 ¥3.00')
  source.totalDiscount.textContent = '33.00'
  const result = snapshot(source)
  assert.equal(result.totals.orderDiscount, '3.00')
  assert.equal(result.totals.goodsNet, '87.00')
  assert.equal(result.totals.payable, '89.00')
  assert.equal(result.items[0].discount, '10.00')
  assert.equal(result.items[0].allocatedDiscount, '0.00')
})

test('wholesale reductions can instead be in row discounts; embedded adjustment needs no wholesale field', () => {
  for (const wholesale of [false, true]) {
    const source = fixture({
      rows: [
        {
          price: '2.40',
          quantity: '50',
          sourceDiscount: wholesale ? '35.00' : '15.00',
        },
      ],
      totals: {
        goodsGross: '120.00',
        shipping: '0.00',
        sourceDiscount: '10.00',
        orderAdjustment: '减 ¥5.00',
        payable: wholesale ? '85.00' : '105.00',
      },
    })
    if (wholesale) {
      source.field('批发优惠', '减 ¥20.00')
      source.totalDiscount.textContent = '30.00'
    }
    const result = snapshot(source)
    assert.equal(result.totals.priceIncludedDiscount, undefined)
    assert.equal(result.totals.rowIncludedAdjustment, '5.00')
    assert.equal(result.items[0].allocatedDiscount, '0.00')
  }
})

test('unexplained gross gaps, partial or ambiguous adjustments and bad payable still fail', () => {
  function discounted() {
    const source = fixture({
      rows: [{ price: '2.00', quantity: '50', sourceDiscount: '15.00' }],
      totals: {
        goodsGross: '120.00',
        shipping: '0.00',
        sourceDiscount: '10.00',
        orderAdjustment: '减 ¥5.00',
        payable: '85.00',
      },
    })
    source.field('批发优惠', '减 ¥20.00')
    source.totalDiscount.textContent = '30.00'
    return source
  }
  for (const gross of ['119.99', '100.01', '99.99']) {
    const source = discounted()
    source.fields['原价总计'].textContent = `¥${gross}`
    assert.throws(() => snapshot(source), /Product rows do not reconcile/)
  }
  const partial = discounted()
  partial.fields['商品改价'].textContent = '减 ¥6.00'
  assert.throws(() => snapshot(partial), /Product rows do not reconcile/)
  const ambiguous = discounted()
  ambiguous.field('店铺优惠', '减 ¥10.00')
  ambiguous.totalDiscount.textContent = '40.00'
  // Both row mappings must fit the payable too, leaving a genuine ambiguity.
  ambiguous.payable.innerHTML =
    '<span class="sum-pay-label">实付款</span>¥75.00'
  assert.throws(() => snapshot(ambiguous), /unambiguously/)
  const payable = discounted()
  payable.payable.querySelector('.sub-ammount').textContent = '01'
  assert.throws(() => snapshot(payable), /payable amount does not reconcile/)
  const missingWholesale = discounted()
  missingWholesale.fields['批发优惠'].parentNode.remove()
  missingWholesale.totalDiscount.textContent = '10.00'
  assert.throws(
    () => snapshot(missingWholesale),
    /Product rows do not reconcile/
  )
})

test('shop discounts stay separate only to the extent not already present in product rows', () => {
  // The footer reports 2.40 product discounts plus a 1.60 shop coupon.
  for (const [rowDiscount, orderDiscount] of [
    ['2.10', '1.60'],
    ['2.90', '0.80'],
    ['3.70', undefined],
  ]) {
    const source = fixture({
      rows: [
        { price: '12.50', quantity: '4', sourceDiscount: rowDiscount },
        { price: '8.00', quantity: '2', sourceDiscount: '0.30' },
      ],
      totals: {
        goodsGross: '66.00',
        shipping: '4.40',
        sourceDiscount: '2.40',
        payable: '66.40',
      },
    })
    source.field('店铺优惠', '减 ¥1.60')
    source.totalDiscount.textContent = '优惠共4.00元'
    const result = snapshot(source)
    assert.equal(result.totals.orderDiscount, orderDiscount)
    assert.equal(result.totals.goodsNet, '62.00')
    assert.equal(result.totals.payable, '66.40')
    assert.equal(result.items[0].sourceDiscount, rowDiscount)
    assert.equal(result.items[0].discount, rowDiscount)
    assert.equal(result.items[0].allocatedDiscount, '0.00')
    assert.equal(
      result.totals.sourceDiscount,
      centsToMoney(moneyToCents(rowDiscount) + 30n)
    )
  }
})

test('an order-only shop coupon and red packet both reconcile without inventing product discounts', () => {
  const source = fixture({
    rows: [{ price: '2.50', quantity: '400', sourceDiscount: '0.00' }],
    totals: {
      goodsGross: '1,000.00',
      shipping: '0.00',
      sourceDiscount: '0.00',
      customizationService: '¥0.00',
      redPacketDiscount: '减 ¥\n 12.50',
      payable: '986.25',
    },
  })
  source.field('店铺优惠', '减 ¥1.25')
  source.totalDiscount.textContent = '共优惠 ¥13.75'
  const result = snapshot(source)
  assert.equal(result.totals.orderDiscount, '1.25')
  assert.equal(result.totals.redPacketDiscount, '12.50')
  assert.equal(result.totals.goodsNet, '998.75')
  assert.equal(result.totals.payable, '986.25')
  assert.equal(result.totals.sourceDiscount, '0.00')
  assert.equal(result.items[0].discount, '0.00')
  assert.equal(result.items[0].allocatedDiscount, '0.00')
})

test('a shop coupon cannot hide missing non-shop discounts, excess row discounts, incomplete goods or incorrect payable', () => {
  for (const rowDiscount of ['2.09', '3.71']) {
    const source = fixture({
      rows: [
        { price: '12.50', quantity: '4', sourceDiscount: rowDiscount },
        { price: '8.00', quantity: '2', sourceDiscount: '0.30' },
      ],
    })
    source.field('店铺优惠', '减 ¥1.60')
    source.totalDiscount.textContent = '4.00'
    assert.throws(() => snapshot(source), /Product rows do not reconcile/)
  }
  const mismatch = fixture()
  mismatch.field('店铺优惠', '减 ¥1.60')
  mismatch.totalDiscount.textContent = '4.00'
  assert.throws(() => snapshot(mismatch), /payable amount does not reconcile/)
  mismatch.fields['原价总计'].textContent = '¥67.60'
  assert.throws(() => snapshot(mismatch), /Product rows do not reconcile/)
  const noShop = fixture()
  noShop.fields['商品优惠'].textContent = '减 ¥4.00'
  noShop.totalDiscount.textContent = '4.00'
  assert.throws(() => snapshot(noShop), /Product rows do not reconcile/)
})

test('promotion discounts retain the exact row values and only separate the evidenced remainder', () => {
  for (const [rowDiscount, orderOnly] of [
    ['0.00', '4.00'],
    ['2.50', '1.50'],
    ['4.00', undefined],
  ]) {
    const source = fixture({
      rows: [{ price: '10.00', quantity: '5', sourceDiscount: rowDiscount }],
      totals: {
        goodsGross: '50.00',
        shipping: '3.00',
        sourceDiscount: '0.00',
        payable: '49.00',
      },
    })
    source.field('活动优惠', '减 ¥4.00')
    source.totalDiscount.textContent = '4.00'
    const result = snapshot(source)
    assert.equal(result.items[0].discount, rowDiscount)
    assert.equal(result.items[0].allocatedDiscount, '0.00')
    assert.equal(result.totals.orderDiscount, orderOnly)
    assert.equal(result.totals.goodsNet, '46.00')
  }
})

function crossStorePromotion(rowDiscounts = ['1.60', '2.40']) {
  const source = fixture({
    rows: [
      { price: '12.50', quantity: '4', sourceDiscount: rowDiscounts[0] },
      { price: '8.00', quantity: '2', sourceDiscount: rowDiscounts[1] },
    ],
    totals: {
      goodsGross: '66.00',
      shipping: '0.00',
      sourceDiscount: '0.00',
      payable: '62.00',
    },
  })
  source.fields['商品优惠'].parentElement.remove()
  source.field('店铺优惠', '减 ¥1.00')
  source.field('跨店满减', '减 ¥3.00')
  source.totalDiscount.textContent = '4.00'
  return source
}

test('cross-store and shop reductions already in row summaries are never subtracted twice and survive backup validation', () => {
  for (const [rowDiscounts, orderDiscount] of [
    [['1.60', '2.40'], undefined],
    [['1.00', '1.50'], '1.50'],
    [['0.00', '0.00'], '4.00'],
  ]) {
    const result = snapshot(crossStorePromotion(rowDiscounts))
    assert.deepEqual(
      result.items.map((item) => item.sourceDiscount),
      rowDiscounts
    )
    assert.deepEqual(
      result.items.map((item) => item.discount),
      rowDiscounts
    )
    assert.deepEqual(
      result.items.map((item) => item.allocatedDiscount),
      ['0.00', '0.00']
    )
    assert.equal(result.orderId, orderId)
    assert.equal(result.items[0].entryId, '9991000000000000001')
    assert.equal(result.items[1].entryId, '9991000000000000002')
    assert.equal(result.totals.orderAdjustment, '0.00')
    assert.equal(result.totals.orderDiscount, orderDiscount)
    assert.equal(
      result.totals.sourceDiscount,
      centsToMoney(
        rowDiscounts.reduce((sum, amount) => sum + moneyToCents(amount), 0n)
      )
    )
    assert.equal(result.totals.goodsNet, '62.00')
    assert.equal(result.totals.payable, '62.00')
    const restored = validateBackup(
      JSON.parse(
        JSON.stringify({
          format: '1688-order-library',
          version: 1,
          exportedAt: observedAt,
          orders: [
            {
              snapshot: result,
              revision: 1,
              changedAt: observedAt,
              lastCheckedAt: observedAt,
              notes: '',
              tags: [],
              changedEntryIds: [],
              removedEntryIds: [],
            },
          ],
          history: [],
          images: [],
        })
      )
    )
    assert.deepEqual(restored.orders[0].snapshot, result)
  }
})

test('cross-store reductions require explicit signs, exact breakdowns and a unique row/adjustment/payable reconciliation', () => {
  for (const value of ['¥3.00', '增 ¥3.00', '减 ¥3.001', '减 ¥3.00 ¥1.00']) {
    const source = crossStorePromotion()
    source.fields['跨店满减'].textContent = value
    assert.throws(
      () => snapshot(source),
      /explicit|reduction|invalid|two decimal places/
    )
  }
  const summary = crossStorePromotion()
  summary.totalDiscount.textContent = '4.01'
  assert.throws(() => snapshot(summary), /discount total does not match/)
  const payable = crossStorePromotion()
  payable.payable.querySelector('.sub-ammount').textContent = '01'
  assert.throws(() => snapshot(payable), /payable amount does not reconcile/)
  const gross = crossStorePromotion()
  gross.fields['原价总计'].textContent = '¥66.01'
  assert.throws(() => snapshot(gross), /Product rows do not reconcile/)
  assert.throws(
    () => snapshot(crossStorePromotion(['1.61', '2.40'])),
    /Product rows do not reconcile/
  )
  const duplicate = crossStorePromotion()
  duplicate.field('跨店满减', '减 ¥3.00')
  assert.throws(() => snapshot(duplicate), /labels are missing or ambiguous/)
  const unknown = crossStorePromotion()
  unknown.fields['跨店满减'].parentElement.querySelector('dt').textContent =
    '跨店补贴'
  assert.throws(() => snapshot(unknown), /Unsupported order total/)
  const ambiguous = crossStorePromotion(['1.00', '1.50'])
  ambiguous.field('商品改价', '减 ¥1.00')
  ambiguous.payable.querySelector('.sub-ammount').textContent = '00'
  ambiguous.payable.childNodes[1].textContent = ' ¥61.'
  assert.throws(() => snapshot(ambiguous), /unambiguously/)
})

test('promotion adjustments require one interpretation and exact cent reconciliation', () => {
  function source(
    rowDiscount,
    adjustment,
    promotion = '2.00',
    payable = '48.00'
  ) {
    const result = fixture({
      rows: [{ price: '10.00', quantity: '5', sourceDiscount: rowDiscount }],
      totals: {
        goodsGross: '50.00',
        shipping: '3.00',
        sourceDiscount: '0.00',
        orderAdjustment: `减 ¥${adjustment}`,
        payable,
      },
    })
    result.field('活动优惠', `减 ¥${promotion}`)
    result.totalDiscount.textContent = promotion
    return result
  }
  const included = snapshot(source('3.00', '3.00'))
  assert.equal(included.totals.rowIncludedAdjustment, '3.00')
  assert.equal(included.totals.orderDiscount, '2.00')
  assert.equal(included.items[0].discount, '3.00')
  const allocated = snapshot(source('0.00', '3.00'))
  assert.equal(allocated.items[0].allocatedDiscount, '3.00')
  for (const row of ['5.01', '5.24', '8.00'])
    assert.throws(() => snapshot(source(row, '3.00')), /unambiguously/)
  assert.throws(
    () => snapshot(source('1.00', '1.00', '2.00', '50.00')),
    /unambiguously/
  )
  assert.throws(
    () => snapshot(source('3.00', '3.00', '2.00', '48.01')),
    /payable amount/
  )
})

test('yuanbao reductions already displayed in rows reconcile without subtracting them twice', () => {
  const source = fixture({
    rows: [{ price: '12.00', quantity: '1', sourceDiscount: '0.40' }],
    totals: {
      goodsGross: '12.00',
      shipping: '0.00',
      sourceDiscount: '0.00',
      payable: '10.60',
    },
  })
  source.field('店铺优惠', '减 ¥1.00')
  source.field('元宝', '减 ¥0.40')
  source.totalDiscount.textContent = '1.40'
  const result = snapshot(source)
  assert.equal(result.items[0].discount, '0.40')
  assert.equal(result.totals.orderDiscount, '1.00')
  assert.equal(result.totals.payable, '10.60')
  for (const value of ['¥0.40', '加 ¥0.40', '未知', '减 ¥0.401']) {
    source.fields['元宝'].textContent = value
    assert.throws(() => snapshot(source), /sign|reduction|invalid|decimal/)
  }
})

test('customization included in the original total stays separate and is charged once', () => {
  for (const wholesale of ['0.00', '10.00']) {
    const source = fixture({
      rows: [{ price: '10.00', quantity: '5', sourceDiscount: '2.00' }],
      totals: {
        goodsGross: wholesale === '0.00' ? '55.00' : '65.00',
        shipping: '3.00',
        customizationService: '¥5.00',
        sourceDiscount: '2.00',
        payable: '56.00',
      },
    })
    if (wholesale !== '0.00') {
      source.field('批发优惠', `减 ¥${wholesale}`)
      source.totalDiscount.textContent = '12.00'
    }
    const result = snapshot(source)
    assert.equal(result.totals.grossIncludedCustomization, '5.00')
    assert.equal(result.totals.customizationService, '5.00')
    assert.equal(result.totals.goodsNet, '48.00')
    assert.equal(result.totals.payable, '56.00')
    assert.equal(result.items[0].discount, '2.00')
    source.fields['定制服务'].textContent = '¥4.99'
    assert.throws(() => snapshot(source), /Product rows do not reconcile/)
    source.fields['定制服务'].textContent = '¥5.00'
    source.payable.querySelector('.sub-ammount').textContent = '01'
    assert.throws(() => snapshot(source), /payable amount/)
  }
})

test('equal customization and wholesale amounts use the full breakdown to identify the presentation', () => {
  for (const [rowDiscount, payable, included] of [
    ['2.00', '61.00', false],
    ['12.00', '51.00', true],
  ]) {
    const source = fixture({
      rows: [{ price: '10.00', quantity: '5', sourceDiscount: rowDiscount }],
      totals: {
        goodsGross: '60.00',
        shipping: '3.00',
        customizationService: '¥10.00',
        sourceDiscount: '2.00',
        payable,
      },
    })
    source.field('批发优惠', '减 ¥10.00')
    source.totalDiscount.textContent = '12.00'
    const result = snapshot(source)
    assert.equal(
      result.totals.grossIncludedCustomization,
      included ? '10.00' : undefined
    )
    assert.equal(
      result.totals.priceIncludedDiscount,
      included ? undefined : '10.00'
    )
    assert.equal(result.items[0].discount, rowDiscount)
  }
})

test('a foreign-currency fee placeholder is preserved as unspecified only when CNY independently reconciles', () => {
  for (const value of ['（≈）', ' ( ≈ ) ']) {
    const source = fixture({ usd: true })
    source.field('外币支付手续费', value)
    const result = snapshot(source)
    assert.equal(result.foreignCurrencyFeeUnspecified, true)
    assert.deepEqual(result.totals, snapshot(fixture()).totals)
    assert.deepEqual(result.items, snapshot(fixture()).items)
    source.fields['运费'].textContent = '¥5.00'
    assert.throws(() => snapshot(source), /payable amount does not reconcile/)
  }
  assert.equal(snapshot(fixture()).foreignCurrencyFeeUnspecified, undefined)
  for (const value of [
    '',
    '0',
    '¥0.00',
    '（≈$1.00）',
    '（≈）¥1.00',
    'unknown',
    '（≈）extra',
  ]) {
    const source = fixture()
    source.field('外币支付手续费', value)
    assert.throws(
      () => snapshot(source),
      /foreign-currency payment fee display is not supported/
    )
  }
  const duplicate = fixture()
  duplicate.field('外币支付手续费', '（≈）')
  duplicate.field('外币支付手续费', '（≈）')
  assert.throws(() => snapshot(duplicate), /labels are missing or ambiguous/)
})

test('purchase date uses the first creation step, never payment or import time', () => {
  const source = fixture()
  const addStep = (order, title, date) => {
    const step = source.document.createElement('q-step')
    step.className = 'order-stage-step-item'
    step.setAttribute('order', order)
    step.setAttribute('title', title)
    step.innerHTML = `<div class="order-stage-step-item-content">${date}</div>`
    source.appRoot.shadowRoot.append(step)
    return step
  }
  const first = addStep('1', '等待买家付款', '2026-03-01 00:10:11')
  addStep('2', '等待卖家发货', '2026-03-03 14:45:59')
  assert.equal(snapshot(source).purchasedAt, '2026-03-01T00:10:11+08:00')
  first.remove()
  assert.equal(snapshot(source).purchasedAt, undefined)
  const invalid = addStep('1', '等待买家付款', '2026-02-30 12:00:00')
  assert.equal(snapshot(source).purchasedAt, undefined)
  invalid.remove()
  addStep('1', '等待买家付款', '2026-03-01 00:10:11')
  addStep('1', '等待买家付款', '2026-03-02 00:10:11')
  assert.equal(snapshot(source).purchasedAt, undefined)
})

test('optional discount summaries allow labels and empty presentation states', () => {
  for (const summary of [
    '优惠共 ¥ 2.40 元',
    '已优惠2.40元 查看明细',
    '',
    '查看优惠明细',
  ]) {
    const source = fixture()
    source.totalDiscount.textContent = summary
    assert.equal(snapshot(source).totals.sourceDiscount, '2.40')
  }
  const conflicting = fixture()
  conflicting.totalDiscount.textContent = '优惠共2.41元'
  assert.throws(() => snapshot(conflicting), /discount total does not match/)
})

test('payable text ignores framework comments around split currency and decimals', () => {
  const source = fixture({ usd: true })
  for (const child of [...source.payable.childNodes]) {
    source.payable.insertBefore(
      source.document.createComment('?lit$8321$'),
      child
    )
  }
  source.payable.append(source.document.createComment('/render:amount'))
  assert.equal(snapshot(source).totals.payable, '68.00')
  source.payable.append(source.document.createTextNode(' ¥1.00'))
  assert.throws(() => snapshot(source), /CNY payable amount/)
})

test('reads a complete canonical snapshot with full string identities and isolated status', () => {
  const result = snapshot(fixture({ usd: true }))
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(result).filter(
        ([name]) => !['items', 'totals'].includes(name)
      )
    ),
    {
      schemaVersion: 1,
      accountId: 'local',
      orderId,
      sourceUrl: orderUrl,
      sellerName: '示例工厂',
      sellerMemberLogin: '示例工厂',
      status: '交易已成功',
      observedAt,
    }
  )
  assert.deepEqual(result.totals, {
    goodsGross: '66.00',
    shipping: '4.40',
    sourceDiscount: '2.40',
    orderAdjustment: '0.00',
    goodsNet: '63.60',
    payable: '68.00',
  })
  assert.equal(result.items[0].entryId, '9991000000000000001')
  assert.equal(result.items[0].title, 'Synthetic product 1')
  assert.deepEqual(result.items[0].skuProperties, [
    { label: '颜色', value: '橙色', raw: '颜色：橙色' },
  ])
  assert.equal(result.items[0].productNumber, 'DEMO-1')
  assert.equal(result.items[0].price, '12.50')
  assert.equal(result.items[0].quantity, '4')
  assert.equal(result.items[0].sourceDiscount, '2.10')
  assert.equal(result.items[0].allocatedDiscount, '0.00')
  assert.equal(result.items[0].discount, '2.10')
  assert.equal(result.items.length, 2)
})

test('includes every SKU field in the legacy and canonical descriptions', () => {
  const source = fixture()
  const sku = deepQuery(source.cells[0].goods.root).one('.sku')
  const size = source.document.createElement('c-t')
  size.textContent = '尺寸：大号'
  sku.append(size)
  const expected = 'Synthetic product 1\n颜色：橙色\n尺寸：大号\n货号：DEMO-1'
  assert.equal(
    extractOrder(source.document, orderUrl).dataRows[0].description,
    expected
  )
  assert.equal(snapshot(source).items[0].description, expected)
})

test('rejects malformed or negative source numbers instead of reading a valid-looking suffix', () => {
  for (const price of ['1,2', '12.34.56', '−2.00', '1 23.00']) {
    const source = fixture({ rows: [{ price, quantity: '1' }] })
    assert.throws(() => extractOrder(source.document, orderUrl), /price/i)
  }
  for (const quantity of ['1,2', '1.2.3', '1 2']) {
    const source = fixture({ rows: [{ price: '1.00', quantity }] })
    assert.throws(() => extractOrder(source.document, orderUrl), /quantity/i)
  }
})

test('keeps explicit per-product discounts separate from shipping for a five-row order', () => {
  const source = fixture({
    rows: [
      { price: '3.00', quantity: '300', sourceDiscount: '47.20' },
      ...Array.from({ length: 4 }, () => ({
        price: '3.00',
        quantity: '26',
        sourceDiscount: '0.20',
      })),
    ],
    status: '等待买家付款',
    paymentLabel: '待付款',
    totals: {
      goodsGross: '1,212.00',
      shipping: '70.90',
      sourceDiscount: '48.00',
      payable: '1,234.90',
    },
  })
  const result = snapshot(source)
  assert.equal(result.totals.payable, '1234.90')
  assert.equal(result.totals.goodsNet, '1164.00')
  assert.deepEqual(
    result.items.map((item) => item.discount),
    ['47.20', '0.20', '0.20', '0.20', '0.20']
  )
})

test('allocates an explicit whole-order reduction across forty synthetic products without losing cents', () => {
  const result = snapshot(
    fixture({
      rows: [
        ...Array.from({ length: 39 }, () => ({
          price: '600.00',
          quantity: '1',
          sourceDiscount: '10.00',
        })),
        { price: '1806.70', quantity: '1', sourceDiscount: '37.84' },
      ],
      totals: {
        goodsGross: '25,206.70',
        shipping: '0.00',
        sourceDiscount: '427.84',
        orderAdjustment: '减 ¥278.86',
        payable: '24,500.00',
      },
    })
  )
  assert.equal(result.items.length, 40)
  assert.equal(result.totals.goodsNet, '24500.00')
  assert.equal(
    result.items.reduce(
      (sum, row) => sum + moneyToCents(row.allocatedDiscount),
      0n
    ),
    27886n
  )
  assert.equal(
    result.items.reduce((sum, row) => sum + moneyToCents(row.discount), 0n),
    70670n
  )
  assert.equal(result.items[39].sourceDiscount, '37.84')
})

test('allocation weights use row value after source discounts and deterministic entry ID ties', () => {
  const item = (entryId, price, sourceDiscount = '0.00') => ({
    entryId,
    price,
    quantity: '1',
    sourceDiscount,
  })
  assert.deepEqual(
    allocateOrderAdjustment(
      [item('2', '3.00', '1.00'), item('1', '1.00')],
      '1.00'
    ),
    ['0.67', '0.33']
  )
  const original = [item('20', '1.00'), item('10', '1.00'), item('30', '1.00')]
  assert.deepEqual(allocateOrderAdjustment(original, '0.02'), [
    '0.01',
    '0.01',
    '0.00',
  ])
  assert.deepEqual(allocateOrderAdjustment([...original].reverse(), '0.02'), [
    '0.00',
    '0.01',
    '0.01',
  ])
  assert.deepEqual(allocateOrderAdjustment(original, '-0.02'), [
    '-0.01',
    '-0.01',
    '0.00',
  ])
  assert.deepEqual(
    allocateOrderAdjustment([item('1', '0.00'), item('2', '2.00')], '0.01'),
    ['0.00', '0.01']
  )
})

test('signed price increases produce negative allocations and reconcile the increased payable', () => {
  const source = fixture({
    totals: {
      goodsGross: '66.00',
      shipping: '4.40',
      sourceDiscount: '2.40',
      orderAdjustment: '加 ¥1.01',
      payable: '69.01',
    },
  })
  const result = snapshot(source)
  assert.equal(result.totals.orderAdjustment, '-1.01')
  assert.equal(result.totals.goodsNet, '64.61')
  assert.equal(
    result.items.reduce(
      (sum, row) => sum + moneyToCents(row.allocatedDiscount),
      0n
    ),
    -101n
  )
  assert.equal(
    result.items.reduce((sum, row) => sum + moneyToCents(row.discount), 0n),
    139n
  )
})

test('customization service is an optional separate charge, never a product price or discount', () => {
  const original = snapshot(fixture())
  assert.equal(Object.hasOwn(original.totals, 'customizationService'), false)
  for (const [value, charge, payable] of [
    ['¥ 12.50', '12.50', '80.50'],
    ['￥1,000.00 元', '1000.00', '1068.00'],
    ['0', '0.00', '68.00'],
  ]) {
    const result = snapshot(
      fixture({
        totals: {
          ...original.totals,
          orderAdjustment: '减 ¥0.00',
          customizationService: value,
          payable,
        },
      })
    )
    assert.equal(result.totals.customizationService, charge)
    assert.equal(result.totals.payable, payable)
    assert.equal(result.totals.goodsNet, original.totals.goodsNet)
    assert.equal(result.totals.shipping, original.totals.shipping)
    assert.deepEqual(result.items, original.items)
  }
})

test('customization service rejects ambiguous or invalid amounts and unreconciled payable', () => {
  for (const value of [
    '',
    '待定',
    '-1.00',
    '−1.00',
    '+1.00',
    '减 ¥1.00',
    '$1.00',
    '¥1.00 ¥2.00',
    '1,00.00',
    '1.001',
    '1 2.00',
    '12 .00',
    '免费',
    '¥1.00 起',
  ]) {
    const source = fixture()
    source.field('定制服务', value)
    assert.throws(
      () => snapshot(source),
      /Customization service|decimal places/,
      value
    )
  }
  const mismatch = fixture()
  mismatch.field('定制服务', '¥1.00')
  assert.throws(() => snapshot(mismatch), /payable amount does not reconcile/)
  const duplicate = fixture()
  duplicate.field('定制服务', '¥0.00')
  duplicate.field('定制服务', '¥0.00')
  assert.throws(() => snapshot(duplicate), /labels are missing or ambiguous/)
})

test('red packets reduce the payable separately from goods, product discounts and customization', () => {
  const original = snapshot(fixture())
  assert.equal(Object.hasOwn(original.totals, 'redPacketDiscount'), false)
  for (const [value, discount, payable, customizationService] of [
    ['减 ¥1.00', '1.00', '67.00', undefined],
    ['减少￥1.50元', '1.50', '66.50', undefined],
    ['− ¥ 2.00', '2.00', '66.00', undefined],
    ['-1.00', '1.00', '67.00', undefined],
    ['减¥0.00', '0.00', '68.00', undefined],
    ['减¥68.00', '68.00', '0.00', undefined],
    ['减¥12.50', '12.50', '60.50', '¥5.00'],
  ]) {
    const result = snapshot(
      fixture({
        totals: {
          ...original.totals,
          orderAdjustment: '减 ¥0.00',
          redPacketDiscount: value,
          ...(customizationService ? { customizationService } : {}),
          payable,
        },
      })
    )
    assert.equal(result.totals.redPacketDiscount, discount)
    assert.equal(result.totals.payable, payable)
    assert.equal(result.totals.goodsNet, original.totals.goodsNet)
    assert.equal(result.totals.sourceDiscount, original.totals.sourceDiscount)
    assert.equal(result.totals.orderAdjustment, original.totals.orderAdjustment)
    if (customizationService)
      assert.equal(result.totals.customizationService, '5.00')
    assert.deepEqual(result.items, original.items)
  }
})

test('red-packet discount summaries accept only reconciled product or combined reductions', () => {
  for (const [summary, accepted] of [
    ['优惠共2.40元', true],
    ['优惠共3.40元', true],
    ['', true],
    ['查看优惠明细', true],
    ['优惠共3.41元', false],
    ['商品2.40元 红包1.00元', false],
  ]) {
    const source = fixture({
      totals: {
        goodsGross: '66.00',
        shipping: '4.40',
        sourceDiscount: '2.40',
        redPacketDiscount: '减¥1.00',
        payable: '67.00',
      },
    })
    source.totalDiscount.textContent = summary
    if (accepted)
      assert.equal(snapshot(source).totals.redPacketDiscount, '1.00')
    else assert.throws(() => snapshot(source), /discount total/, summary)
  }
})

test('red packets reject unsigned, increased, invalid, duplicate and mismatched amounts', () => {
  for (const value of [
    '',
    '待定',
    '1.00',
    '¥1.00',
    '减免费',
    '减$1.00',
    '加¥1.00',
    '+1.00',
    '增加￥0.00',
    '+0.00',
    '减¥1.00 ¥2.00',
    '减¥1,00.00',
    '减¥0.001',
    '减1 2.00',
    '减12 .00',
    '减¥1.00起',
  ]) {
    const source = fixture()
    source.field('红包', value)
    assert.throws(
      () => snapshot(source),
      /Red-packet discount|decimal places/,
      value
    )
  }
  const mismatch = fixture()
  mismatch.field('红包', '减¥1.00')
  assert.throws(() => snapshot(mismatch), /payable amount does not reconcile/)
  const duplicate = fixture()
  duplicate.field('红包', '减¥0.00')
  duplicate.field('红包', '减¥0.00')
  assert.throws(() => snapshot(duplicate), /labels are missing or ambiguous/)
  const excessive = fixture({
    totals: {
      goodsGross: '66.00',
      shipping: '4.40',
      sourceDiscount: '2.40',
      redPacketDiscount: '减¥69.00',
      payable: '-1.00',
    },
  })
  assert.throws(() => snapshot(excessive), /CNY payable|does not reconcile/)
})

test('red packets already folded into row or breakdown discounts cannot be counted twice', () => {
  const options = {
    totals: {
      goodsGross: '66.00',
      shipping: '4.40',
      sourceDiscount: '2.40',
      redPacketDiscount: '减¥1.00',
      payable: '67.00',
    },
  }
  const rowsIncludePacket = fixture({
    ...options,
    rows: [
      { price: '12.50', quantity: '4', sourceDiscount: '3.10' },
      { price: '8.00', quantity: '2', sourceDiscount: '0.30' },
    ],
  })
  assert.throws(
    () => snapshot(rowsIncludePacket),
    /Product rows do not reconcile/
  )
  const breakdownIncludesPacket = fixture({
    totals: { ...options.totals, sourceDiscount: '3.40' },
  })
  assert.throws(
    () => snapshot(breakdownIncludesPacket),
    /Product rows do not reconcile/
  )
  const bothIncludePacket = fixture({
    rows: [
      { price: '12.50', quantity: '4', sourceDiscount: '3.10' },
      { price: '8.00', quantity: '2', sourceDiscount: '0.30' },
    ],
    totals: { ...options.totals, sourceDiscount: '3.40' },
  })
  assert.throws(
    () => snapshot(bothIncludePacket),
    /payable amount does not reconcile/
  )
})

test('money arithmetic preserves fractional unit prices and values beyond JS safe integers', () => {
  assert.equal(normalizePrice('012.500'), '12.50')
  assert.equal(lineGrossCents('0.105', '3'), 32n)
  assert.equal(lineGrossCents('0.105', '2'), 21n)
  assert.equal(
    centsToMoney(moneyToCents('90071992547409931.01')),
    '90071992547409931.01'
  )
  assert.equal(centsToMoney(-1n), '-0.01')
  const result = snapshot(
    fixture({
      rows: [{ price: '0.105', quantity: '3' }],
      totals: {
        goodsGross: '0.32',
        shipping: '0.00',
        sourceDiscount: '0.00',
        payable: '0.32',
      },
    })
  )
  assert.equal(result.items[0].price, '0.105')
})

test('rejects duplicate, absent, conflicting, or foreign product entry IDs', async (t) => {
  const cases = [
    [
      'duplicate',
      (source) => {
        const href = deepQuery(source.cells[0].goods.root)
          .one('a.oneline')
          .getAttribute('href')
        deepQuery(source.cells[1].goods.root)
          .one('a.oneline')
          .setAttribute('href', href)
      },
    ],
    [
      'absent',
      (source) =>
        deepQuery(source.cells[0].goods.root)
          .one('a.oneline')
          .removeAttribute('href'),
    ],
    [
      'conflicting',
      (source) => {
        const link = source.document.createElement('a')
        link.href =
          'https://trade.1688.com/order/offer_snapshot.htm?order_entry_id=88888888'
        source.cells[0].goods.root.append(link)
      },
    ],
    [
      'foreign',
      (source) =>
        deepQuery(source.cells[0].goods.root)
          .one('a.oneline')
          .setAttribute(
            'href',
            'https://example.invalid/?order_entry_id=88888888'
          ),
    ],
  ]
  for (const [label, change] of cases)
    await t.test(label, () => {
      const source = fixture()
      change(source)
      assert.throws(() => snapshot(source), /entry ID/i)
    })
})

test('rejects missing, ambiguous, unsupported, incomplete, or unreconciled totals', async (t) => {
  const cases = [
    ['missing totals', (source) => source.totalHost.remove()],
    [
      'missing shipping',
      (source) => source.fields['运费'].parentElement.remove(),
    ],
    [
      'unreadable shipping',
      (source) => {
        source.fields['运费'].textContent = '待定'
      },
    ],
    [
      'malformed grouping',
      (source) => {
        source.fields['原价总计'].textContent = '6,6.00'
      },
    ],
    [
      'fractional cent totals',
      (source) => {
        source.fields['运费'].textContent = '4.401'
      },
    ],
    ['duplicate totals', (source) => source.field('原价总计', '66.00')],
    [
      'ambiguous field amounts',
      (source) => {
        const extra = source.document.createElement('dd')
        extra.textContent = '66.00'
        source.fields['原价总计'].parentNode.append(extra)
      },
    ],
    ['unknown totals', (source) => source.field('税额', '1.00')],
    ['unsigned adjustment', (source) => source.field('商品改价', '1.00')],
    ['unknown discount', (source) => source.field('其他优惠', '未知')],
    [
      'conflicting discount summary',
      (source) => {
        source.totalDiscount.textContent = '2.41'
      },
    ],
    ['partial product rows', (source) => source.rowElements[1].remove()],
    [
      'unreconciled source discount',
      (source) => {
        source.fields['商品优惠'].textContent = '减¥1.00'
        source.totalDiscount.textContent = '1.00'
      },
    ],
    [
      'wrong final amount',
      (source) => {
        source.payable.querySelector('.sub-ammount').textContent = '01'
      },
    ],
    [
      'duplicate final amount',
      (source) =>
        source.payable.parentNode.append(source.payable.cloneNode(true)),
    ],
    [
      'unsupported installment total',
      (source) => {
        source.payable.querySelector('.sum-pay-label').textContent = '待付尾款'
      },
    ],
    [
      'ambiguous currencies',
      (source) =>
        source.payable.append(source.document.createTextNode(' ¥1.00')),
    ],
  ]
  for (const [label, change] of cases)
    await t.test(label, () => {
      const source = fixture()
      change(source)
      assert.throws(() => snapshot(source))
    })
})

test('rejects identity/status gaps before data can overwrite an existing snapshot', async (t) => {
  for (const [label, change] of [
    ['missing displayed ID', (source) => source.identityValue.remove()],
    [
      'mismatched displayed ID',
      (source) => {
        source.identityValue.textContent = '9990000000000000002'
      },
    ],
    ['missing status', (source) => source.statusText.remove()],
    [
      'empty status',
      (source) => {
        source.statusText.textContent = ''
      },
    ],
    [
      'ambiguous status',
      (source) =>
        source.statusText.parentElement.append(
          source.statusText.cloneNode(true)
        ),
    ],
  ])
    await t.test(label, () => {
      const source = fixture()
      change(source)
      assert.throws(() => snapshot(source))
    })
  for (const url of [
    'invalid',
    'https://example.invalid/?orderId=123',
    `${orderUrl}&orderId=1`,
    orderUrl.replace(orderId, '1e19'),
  ])
    assert.throws(
      () => extractOrderSnapshot(fixture().document, url),
      /URL|ID/i
    )
  assert.throws(
    () =>
      extractOrderSnapshot(fixture().document, orderUrl, {
        observedAt: 'unknown',
      }),
    /timestamp/i
  )
})

test('rejects discounts exceeding a product, impossible adjustments, or allocation with no basis', () => {
  const item = {
    entryId: '1',
    price: '1.00',
    quantity: '1',
    sourceDiscount: '0.00',
  }
  assert.throws(
    () => allocateOrderAdjustment([item], '1.01'),
    /cannot be allocated/
  )
  assert.throws(
    () =>
      allocateOrderAdjustment([{ ...item, sourceDiscount: '1.01' }], '0.00'),
    /exceeds/
  )
  assert.throws(
    () =>
      allocateOrderAdjustment([{ ...item, sourceDiscount: '-0.01' }], '0.00'),
    /discount/
  )
  assert.throws(
    () =>
      allocateOrderAdjustment([{ ...item, sourceDiscount: '1.00' }], '-0.01'),
    /cannot be allocated/
  )
  assert.deepEqual(
    allocateOrderAdjustment([{ ...item, sourceDiscount: '1.00' }], '0.00'),
    ['0.00']
  )
})
