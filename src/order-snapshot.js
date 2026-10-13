import { deepQuery } from './dom.js'
import { extractOrder, findOrderTable } from './extract.js'
import {
  centsToMoney,
  lineGrossCents,
  moneyToCents,
  normalizePrice,
} from './money.js'

const detailOrigin = 'https://air.1688.com'
const detailPath = '/app/ctf-page/trade-order-detail/index.html'
const amountPattern = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?'
const text = (node) => node?.textContent?.trim() || ''
const compact = (value) => value.replace(/\s+/g, '')

function one(query, selector, name) {
  const matches = query.all(selector)
  if (matches.length !== 1)
    throw new Error(
      `${name} is missing or ambiguous. Refresh the order and try again.`
    )
  return matches[0]
}

function readAmount(value, name, { signed = false } = {}) {
  const match = compact(value).match(
    new RegExp(
      `^(${signed ? '(?:减少|增加|减|增|加|[+−-])?' : ''})[¥￥]?(${amountPattern})(?:元)?$`
    )
  )
  if (!match) throw new Error(`${name} is missing or invalid.`)
  if (signed && !match[1])
    throw new Error(`${name} has no explicit increase or reduction sign.`)
  const amount = moneyToCents(match[2].replaceAll(',', ''))
  // Positive values are reductions, so they can be added to row discounts.
  return /[增加+]/.test(match[1]) ? -amount : amount
}

function orderIdentity(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('The order detail URL is invalid.')
  }
  if (
    !(
      (parsed.origin === detailOrigin && parsed.pathname === detailPath) ||
      (parsed.origin === 'https://trade.1688.com' &&
        parsed.pathname === '/order/new_step_order_detail.htm')
    ) ||
    parsed.searchParams.getAll('orderId').length !== 1 ||
    !/^[1-9]\d*$/.test(parsed.searchParams.get('orderId'))
  )
    throw new Error(
      'A supported order detail URL with a full order ID is required.'
    )
  const orderId = parsed.searchParams.get('orderId')
  return {
    orderId,
    sourceUrl: `${detailOrigin}${detailPath}?orderId=${orderId}`,
  }
}

function validateDisplayedIdentity(appQuery, orderId) {
  const fields = appQuery
    .all('.order-info-receipt-content-item')
    .filter(
      (item) => compact(text(item.querySelector('.field-name'))) === '订单号：'
    )
  if (
    fields.length !== 1 ||
    text(fields[0].querySelectorAll('span')[1]) !== orderId
  )
    throw new Error(
      'The displayed order ID is missing or does not match this page.'
    )
}

function entryIdentity(row, index) {
  const goods = deepQuery(row).one('order-table-goods')?.shadowRoot
  const ids = new Set()
  for (const anchor of deepQuery(goods).all('a[href]')) {
    let url
    try {
      url = new URL(anchor.getAttribute('href'), detailOrigin)
    } catch {
      continue
    }
    if (!url.searchParams.has('order_entry_id')) continue
    const id = url.searchParams.get('order_entry_id')
    if (
      url.origin !== 'https://trade.1688.com' ||
      url.pathname !== '/order/offer_snapshot.htm' ||
      url.searchParams.getAll('order_entry_id').length !== 1 ||
      !/^[1-9]\d*$/.test(id)
    )
      throw new Error(`Row ${index + 1}: product entry ID is invalid.`)
    ids.add(id)
  }
  if (ids.size !== 1)
    throw new Error(
      `Row ${index + 1}: product entry ID is missing or ambiguous.`
    )
  return [...ids][0]
}

function readTotals(appQuery) {
  const host = one(appQuery, 'order-total-price', 'Order totals')
  if (!host.shadowRoot) throw new Error('Order totals are not ready.')
  const query = deepQuery(host.shadowRoot)
  const fields = query.all('.detail-price dl')
  const totals = { sourceDiscount: 0n, orderAdjustment: 0n }
  const labels = new Set()
  for (const field of fields) {
    if (
      field.querySelectorAll('dt').length !== 1 ||
      field.querySelectorAll('dd').length !== 1
    )
      throw new Error('The order total field is missing or ambiguous.')
    const label = compact(text(field.querySelector('dt')))
    const value = text(field.querySelector('dd'))
    if (!label || labels.has(label))
      throw new Error('The order total labels are missing or ambiguous.')
    labels.add(label)
    if (label === '原价总计') totals.goodsGross = readAmount(value, label)
    else if (label === '运费') totals.shipping = readAmount(value, label)
    else if (label === '商品改价')
      totals.orderAdjustment = readAmount(value, label, { signed: true })
    else if (label.includes('优惠')) {
      const discount = readAmount(value, label, { signed: true })
      if (discount < 0n) throw new Error(`${label} is not a reduction.`)
      totals.sourceDiscount += discount
    } else throw new Error(`Unsupported order total: ${label}.`)
  }
  if (totals.goodsGross === undefined || totals.shipping === undefined)
    throw new Error('The original goods total or shipping total is missing.')

  const summaries = query.all('.total-discount')
  if (summaries.length > 1) throw new Error('The discount total is ambiguous.')
  if (
    summaries.length &&
    readAmount(text(summaries[0]), 'Discount total') !== totals.sourceDiscount
  )
    throw new Error('The order discount total does not match its breakdown.')

  const payable = one(query, '.total-sum-pay', 'Payable total')
  const label = compact(
    text(one(deepQuery(payable), '.sum-pay-label', 'Payable label'))
  )
  if (!['实付款', '待付款'].includes(label))
    throw new Error(
      'This payment total is not supported. A full-order total is required.'
    )
  const value = compact(
    [...payable.childNodes]
      .filter(
        (node) =>
          !node.classList?.contains('sum-pay-label') &&
          !node.classList?.contains('ask-icon-box')
      )
      .map((node) => node.textContent)
      .join('')
  )
  // Some orders also display a USD conversion. Only the explicitly marked
  // CNY amount participates in reconciliation.
  const match = value.match(
    new RegExp(`^[¥￥](${amountPattern})(?:\\(\\$${amountPattern}\\))?$`)
  )
  if (!match) throw new Error('The CNY payable amount is missing or ambiguous.')
  totals.payable = moneyToCents(match[1].replaceAll(',', ''))
  return totals
}

/** Allocate a signed reduction in exact cents, preserving source item order. */
export function allocateOrderAdjustment(items, adjustment) {
  const amount = moneyToCents(adjustment)
  const ids = new Set()
  const entries = items.map((item) => {
    if (
      typeof item.entryId !== 'string' ||
      !/^[1-9]\d*$/.test(item.entryId) ||
      ids.has(item.entryId)
    )
      throw new Error('Product entry IDs must be unique decimal strings.')
    ids.add(item.entryId)
    const sourceDiscount = moneyToCents(item.sourceDiscount)
    const weight = lineGrossCents(item.price, item.quantity) - sourceDiscount
    if (sourceDiscount < 0n || weight < 0n)
      throw new Error('A product discount exceeds its original row value.')
    return { entryId: item.entryId, weight, cents: 0n, remainder: 0n }
  })
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0n)
  if (amount > total || (amount !== 0n && total === 0n))
    throw new Error(
      'The order adjustment cannot be allocated to its product values.'
    )
  if (amount === 0n) return entries.map(() => '0.00')
  const absolute = amount < 0n ? -amount : amount
  for (const entry of entries) {
    const numerator = absolute * entry.weight
    entry.cents = numerator / total
    entry.remainder = numerator % total
  }
  let remaining =
    absolute - entries.reduce((sum, entry) => sum + entry.cents, 0n)
  const ranked = [...entries].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1
    return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0
  })
  for (const entry of ranked) {
    if (remaining === 0n) break
    entry.cents += 1n
    remaining -= 1n
  }
  return entries.map((entry) =>
    centsToMoney(amount < 0n ? -entry.cents : entry.cents)
  )
}

/** Read a complete, reconciled order. Failure leaves persistence to the caller. */
export function extractOrderSnapshot(
  document,
  url,
  { observedAt = new Date().toISOString() } = {}
) {
  if (
    typeof observedAt !== 'string' ||
    !Number.isFinite(Date.parse(observedAt))
  )
    throw new Error('The observation timestamp is invalid.')
  const identity = orderIdentity(url)
  const order = extractOrder(document, url)
  const appQuery = deepQuery(document.querySelector('app-root').shadowRoot)
  validateDisplayedIdentity(appQuery, identity.orderId)
  const status = text(
    one(appQuery, '.step-detail-header .stress', 'Order status')
  )
  if (!status) throw new Error('Order status is missing.')
  if (!order.sellerName || order.sellerName === 'Unknown Seller')
    throw new Error('The seller name is missing.')
  const rows = deepQuery(findOrderTable(document)).all('tr.table-row')
  const items = order.dataRows.map(({ discount, ...row }, index) => ({
    entryId: entryIdentity(rows[index], index),
    ...row,
    price: normalizePrice(row.price),
    sourceDiscount: discount,
  }))
  const totals = readTotals(appQuery)
  const actualGross = items.reduce(
    (sum, item) => sum + lineGrossCents(item.price, item.quantity),
    0n
  )
  const actualDiscount = items.reduce(
    (sum, item) => sum + moneyToCents(item.sourceDiscount),
    0n
  )
  if (
    actualGross !== totals.goodsGross ||
    actualDiscount !== totals.sourceDiscount
  )
    throw new Error(
      'Product rows do not reconcile with the order totals. The order may be incomplete.'
    )
  totals.goodsNet =
    totals.goodsGross - totals.sourceDiscount - totals.orderAdjustment
  if (
    totals.goodsNet < 0n ||
    totals.goodsNet + totals.shipping !== totals.payable
  )
    throw new Error(
      'The payable amount does not reconcile with the order totals.'
    )
  const allocations = allocateOrderAdjustment(
    items,
    centsToMoney(totals.orderAdjustment)
  )
  return {
    schemaVersion: 1,
    accountId: 'local',
    ...identity,
    sellerName: order.sellerName,
    status,
    observedAt: new Date(observedAt).toISOString(),
    items: items.map((item, index) => ({
      ...item,
      allocatedDiscount: allocations[index],
      discount: centsToMoney(
        moneyToCents(item.sourceDiscount) + moneyToCents(allocations[index])
      ),
    })),
    totals: Object.fromEntries(
      Object.entries(totals).map(([name, value]) => [name, centsToMoney(value)])
    ),
  }
}
