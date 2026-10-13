import { deepQuery } from './dom.js'
import { orderIdFromUrl } from './page.js'

const text = (element) => element?.textContent?.trim() || ''
const numberPattern = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/

export function findOrderTable(document) {
  const appRoot = document.querySelector('app-root')?.shadowRoot
  if (!appRoot) return null
  return deepQuery(appRoot).one('order-table')?.shadowRoot || null
}

export function orderReadiness(document) {
  const table = findOrderTable(document)
  const rowCount = table ? deepQuery(table).all('tr.table-row').length : 0
  return { status: rowCount ? 'ready' : 'loading', rowCount }
}

function requiredNumber(value, field, rowNumber, { integer = false } = {}) {
  const match = value.match(numberPattern)
  const result = match?.[0].replaceAll(',', '')
  if (
    !result ||
    /[-−]\s*\d/.test(value) ||
    !Number.isFinite(Number(result)) ||
    (integer && (!/^\d+$/.test(result) || Number(result) <= 0))
  ) {
    throw new Error(
      `Row ${rowNumber}: ${field} is missing or invalid. Refresh the order and try again.`
    )
  }
  return result
}

function sumDiscounts(amounts) {
  const precision = Math.max(
    2,
    ...amounts.map((amount) => amount.split('.')[1]?.length || 0)
  )
  const total = amounts.reduce((sum, amount) => {
    const [whole, fraction = ''] = amount.split('.')
    return sum + BigInt(whole + fraction.padEnd(precision, '0'))
  }, 0n)
  const divisor = 10n ** BigInt(precision - 2)
  const cents = (total + divisor / 2n) / divisor
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}

// textContent does not cross shadow boundaries. Follow the rendered component
// tree, including assigned slot content, without reading product copy or prices
// as if they were row discounts.
function discountText(node) {
  if (node.nodeType === 3) return node.textContent
  if (
    [
      'order-table-goods',
      'order-table-pay',
      'order-table-number',
      'script',
      'style',
      'template',
    ].includes(node.localName)
  )
    return ''
  const assigned =
    node.localName === 'slot' && node.assignedNodes?.({ flatten: true })
  const children = assigned?.length
    ? assigned
    : (node.shadowRoot || node).childNodes
  return [...children].map(discountText).join('')
}

function rowDiscount(row, discount, rowNumber) {
  const rowText = discountText(row).replace(/\s+/g, '')
  const summaries = rowText.split('优惠共').slice(1)
  if (summaries.length) {
    const amounts = summaries.map((summary) => {
      const amount = summary.match(
        new RegExp(`^[:：]?[¥￥]?(${numberPattern.source})元`)
      )?.[1]
      if (!amount) {
        throw new Error(
          `Row ${rowNumber}: the advertised discount summary is missing or invalid.`
        )
      }
      return amount
        .replaceAll(',', '')
        .replace(/^0+(?=\d)/, '')
        .replace(/(\.\d*?)0+$/, '$1')
        .replace(/\.$/, '')
    })
    if (new Set(amounts).size !== 1) {
      throw new Error(
        `Row ${rowNumber}: conflicting discount summaries were found.`
      )
    }
    // The displayed per-product total is authoritative. Adding its breakdown
    // again, or deriving it from a rounded discounted unit price, overcounts it.
    return sumDiscounts([amounts[0]])
  }

  const amounts = []
  const discountArea = row.querySelector(':scope > td:nth-child(4)') || discount
  if (discountArea) {
    for (const item of deepQuery(discountArea).all(
      '.order-table-discount-item-price'
    )) {
      amounts.push(requiredNumber(discountText(item), 'discount', rowNumber))
    }
    const advertised = discountText(discountArea).replace(/\s+/g, '')
    if (
      !amounts.length &&
      advertised &&
      !/^(?:[-—–]+|无|无优惠|暂无优惠|无折扣|0(?:\.0+)?(?:元)?)$/.test(
        advertised
      )
    ) {
      throw new Error(
        `Row ${rowNumber}: the advertised discount could not be read.`
      )
    }
  }
  return sumDiscounts(amounts)
}

function extractRow(row, index) {
  const rowNumber = index + 1
  const cells = deepQuery(row)
  const goods = cells.one('order-table-goods')?.shadowRoot
  const pay = cells.one('order-table-pay')?.shadowRoot
  const number = cells.one('order-table-number')?.shadowRoot
  const discount = cells.one('order-table-discount')?.shadowRoot
  if (!goods || !pay || !number) {
    throw new Error(
      `Row ${rowNumber}: product details are incomplete. Refresh the order and try again.`
    )
  }
  const goodsQuery = deepQuery(goods)
  const title = text(goodsQuery.one('.goods-info a.oneline'))
  if (!title)
    throw new Error(`Row ${rowNumber}: product description is missing.`)
  const description = [
    title,
    text(goodsQuery.one('.sku c-t')),
    text(goodsQuery.one('.sku .product-number')),
  ]
    .filter(Boolean)
    .join('\n')
  const image = goodsQuery.one('img')
  const thumbnail = (image?.src || image?.getAttribute('src') || '').replace(
    /\.64x64\.jpg/,
    '.jpg'
  )
  const priceBlock = deepQuery(pay).one('.order-table-pay .pay')
  // 1688 displays the discounted price first and the original price second.
  const priceElement =
    priceBlock?.querySelector(':scope > div:nth-child(2)') ||
    priceBlock?.querySelector(':scope > div')
  const priceText = text(priceElement)
  const price = requiredNumber(
    priceText.match(new RegExp(`(-?${numberPattern.source})\\s*元`))?.[1] || '',
    'price',
    rowNumber
  )
  const quantity = requiredNumber(
    text(deepQuery(number).one('.order-table-number')),
    'quantity',
    rowNumber,
    { integer: true }
  )
  return {
    thumbnail,
    description,
    price,
    quantity,
    discount: rowDiscount(row, discount, rowNumber),
  }
}

export function extractOrder(document, url) {
  const table = findOrderTable(document)
  if (!table)
    throw new Error(
      'Order table is not ready. Wait for the page to load, then try again.'
    )
  const rows = deepQuery(table).all('tr.table-row')
  if (!rows.length)
    throw new Error(
      'No product rows found. Wait for the page to load, then try again.'
    )
  const info = deepQuery(document.querySelector('app-root').shadowRoot).one(
    'order-info'
  )?.shadowRoot
  let sellerName = 'Unknown Seller'
  if (info) {
    for (const item of deepQuery(info).all('.order-info-user-content-item')) {
      if (text(item.querySelector('.field-name')).includes('会员登录名')) {
        sellerName = text(item.querySelectorAll('span')[1]) || sellerName
        break
      }
    }
  }
  const orderId = orderIdFromUrl(url)
  return {
    sellerName,
    orderSuffix: /^\d+$/.test(orderId) ? orderId.slice(-4) : 'XXXX',
    dataRows: rows.map(extractRow),
  }
}
