import { parseHTML } from 'linkedom'

/**
 * Synthetic order DOM; no account, customer, or production order information.
 * Keep this function self-contained so Chromium can execute it with page.evaluate.
 */
export function buildOrderFixture(document, options = {}) {
  const defaults = [
    {
      title: '测试香薰蜡烛',
      sku: '颜色：暖白',
      productNumber: '货号：DEMO-001',
      price: '12.50',
      discountedPrice: '11.975',
      quantity: '4',
      discounts: ['省2.00元', '减0.10元'],
    },
    {
      title: '桌面收纳盒',
      sku: '款式：小号',
      productNumber: '货号：DEMO-002',
      price: '8.00',
      quantity: '2',
      discounts: ['省0.10元', '减0.20元'],
    },
  ]
  const rows = options.rows ?? defaults
  const nested = options.nested ?? true
  const thumbnail =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="12" fill="#fff0e5"/><path d="M21 22h22v29H21z" fill="#f87432"/><path d="M32 9c8 7 5 12 0 12s-8-5 0-12" fill="#fbbf24"/></svg>'
    )

  function element(tag, parent, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    parent.appendChild(node)
    return node
  }

  function shadow(tag, parent) {
    const host = element(tag, parent)
    return { host, root: host.attachShadow({ mode: 'open' }) }
  }

  function maybeNest(parent, tag) {
    return nested ? shadow(tag, parent).root : parent
  }

  document.body.replaceChildren()
  const app = shadow('app-root', document.body)
  const layout = maybeNest(app.root, 'order-layout')
  const info = shadow('order-info', layout)
  const sellerName = Object.hasOwn(options, 'sellerName')
    ? options.sellerName
    : '示例工厂'
  if (sellerName !== null) {
    const infoRoot = maybeNest(info.root, 'order-info-fields')
    const seller = element('div', infoRoot, 'order-info-user-content-item')
    element('span', seller, 'field-name', '会员登录名：')
    element('span', seller, '', sellerName)
  }

  const section = maybeNest(layout, 'order-section')
  const order = shadow('order-table', section)
  const tableRoot = maybeNest(order.root, 'order-table-body')
  const table = element('table', tableRoot)
  const tbody = element('tbody', table)
  const rowElements = []
  const cells = []

  for (const row of rows) {
    const tr = element('tr', tbody, 'table-row')
    const goods = shadow('order-table-goods', element('td', tr))
    const pay = shadow('order-table-pay', element('td', tr))
    const number = shadow('order-table-number', element('td', tr))
    const discount = shadow('order-table-discount', element('td', tr))
    const goodsRoot = maybeNest(goods.root, 'goods-content')
    if (row.thumbnail !== null) {
      const img = element('img', goodsRoot)
      img.setAttribute('src', row.thumbnail ?? thumbnail)
      img.setAttribute('alt', '')
    }
    const goodsInfo = element('div', goodsRoot, 'goods-info')
    element('a', goodsInfo, 'oneline', row.title ?? '')
    const sku = element('div', goodsInfo, 'sku')
    if (row.sku !== undefined) element('c-t', sku, '', row.sku)
    if (row.productNumber !== undefined)
      element('span', sku, 'product-number', row.productNumber)

    const payRoot = maybeNest(pay.root, 'pay-content')
    const payWrapper = element('div', payRoot, 'order-table-pay')
    const payValue = element('div', payWrapper, 'pay')
    if (row.discountedPrice !== undefined)
      element('div', payValue, '', `优惠后${row.discountedPrice}元/件`)
    if (row.price !== null)
      element('div', payValue, '', `${row.price ?? ''} 元/件`)

    const numberRoot = maybeNest(number.root, 'quantity-content')
    element('div', numberRoot, 'order-table-number', row.quantity ?? '')

    const discountRoot = maybeNest(discount.root, 'discount-content')
    const discountValues = element('div', discountRoot, 'order-table-discount')
    if (row.discountSummary !== undefined) {
      const summary = element(
        'div',
        discountValues,
        'order-table-discount-summary'
      )
      const parts = Array.isArray(row.discountSummary)
        ? row.discountSummary
        : [row.discountSummary]
      for (const part of parts) {
        const partRoot = maybeNest(summary, 'discount-summary-part')
        element('span', partRoot, '', part)
      }
    }
    for (const amount of row.discounts ?? []) {
      const itemRoot = maybeNest(discountValues, 'discount-line')
      element('span', itemRoot, 'order-table-discount-item-price', amount)
    }
    rowElements.push(tr)
    cells.push({ goods, pay, number, discount })
  }

  return {
    appRoot: app.host,
    orderInfo: info.host,
    orderTable: order.host,
    rowElements,
    cells,
  }
}

/** Make a unit-test document with the same DOM used by the browser smoke test. */
export function createOrderFixture(options = {}) {
  const { document } = parseHTML('<!doctype html><html><body></body></html>')
  buildOrderFixture(document, options)
  return document
}
