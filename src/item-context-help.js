import { preparationHelp } from './preparation-help.js'
import { bindText, message, getLocale } from './i18n.js'
import { productAttributes } from './product-attributes.js'
import { setCodeText } from './code-display.js'
import { lineGrossCents, centsToMoney } from './money.js'
import { presentOrderStatus } from './order-presentation.js'

const present = (value) => value !== undefined && value !== null && value !== ''
const node = (doc, tag, value, className) => {
  const element = doc.createElement(tag)
  if (value !== undefined) element.textContent = String(value)
  if (className) element.className = className
  return element
}
const label = (doc, tag, value, className) => {
  const element = node(doc, tag, undefined, className)
  bindText(element, message(value))
  return element
}

function money(value, locale) {
  const text = String(value ?? '')
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return ''
  const negative = text.startsWith('-')
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.')
  const separator = new Intl.NumberFormat(locale)
    .formatToParts(1.1)
    .find((part) => part.type === 'decimal').value
  return `${negative ? '-' : ''}${BigInt(whole).toLocaleString(locale)}${separator}${fraction.padEnd(2, '0')} CNY`
}

function facts(doc, entries) {
  const list = node(doc, 'dl', undefined, 'item-context-facts')
  for (const [name, value] of entries) {
    if (!present(value)) continue
    const pair = node(doc, 'div')
    pair.append(label(doc, 'dt', name), node(doc, 'dd', value))
    list.append(pair)
  }
  return list
}

function photo(doc, item, lifecycle, loadImage) {
  const source = item.thumbnail || item.photos?.[0]
  if (!source) return undefined
  const image = node(doc, 'img', undefined, 'item-context-photo')
  image.alt = ''
  image.width = image.height = 64
  image.addEventListener('load', lifecycle.requestPosition, {
    once: true,
    signal: lifecycle.signal,
  })
  image.addEventListener(
    'error',
    () => {
      image.remove()
      lifecycle.requestPosition()
    },
    { once: true, signal: lifecycle.signal }
  )
  void (async () => {
    try {
      const loaded = await loadImage(source)
      if (!lifecycle.signal.aborted)
        image.src = typeof loaded === 'string' ? loaded : loaded.dataUrl
    } catch {
      if (!lifecycle.signal.aborted) {
        image.remove()
        lifecycle.requestPosition()
      }
    }
  })()
  return image
}

function productPreview(doc, item, lifecycle, loadImage, compact = false) {
  const row = node(
    doc,
    'div',
    undefined,
    `item-context-product${compact ? ' item-context-compact' : ''}`
  )
  const image = photo(doc, item, lifecycle, loadImage)
  if (image) row.append(image)
  const text = node(doc, 'div', undefined, 'item-context-product-text')
  const code = item.barcode || item.baseCode
  if (code) {
    const badge = node(doc, 'code', undefined, 'ce-code')
    setCodeText(badge, code)
    text.append(badge)
  }
  if (item.spanishName)
    text.append(node(doc, 'strong', item.spanishName, 'item-context-name'))
  const source = productAttributes(item)
  text.append(
    node(
      doc,
      'p',
      item.description || source.description || source.title,
      'item-context-description'
    )
  )
  if (compact) {
    const price = money(item.price, getLocale())
    const summary = node(doc, 'p', undefined, 'item-context-product-amount')
    if (present(item.quantity)) {
      summary.append(label(doc, 'span', 'Quantity'), `: ${item.quantity}`)
      if (price) summary.append(` · ${price}`)
    } else if (price) summary.textContent = price
    text.append(summary)
  }
  row.append(text)
  return row
}

function notes(doc, record) {
  if (!record?.notes?.trim()) return undefined
  const section = node(doc, 'section', undefined, 'item-context-notes')
  section.append(label(doc, 'h4', 'Order notes'), node(doc, 'p', record.notes))
  return section
}

/** Context is built only when the existing helper opens; no extra selection handlers. */
export function productContextHelp(
  target,
  { getProduct, getRecord, loadImage = async (source) => source }
) {
  return preparationHelp(target, message('Original product details'), {
    panelClass: 'item-context-popover',
    renderContent(content, lifecycle) {
      const item = getProduct(),
        record = getRecord?.() || item.record
      const doc = target.ownerDocument
      const header = node(doc, 'header', undefined, 'item-context-heading')
      header.append(
        node(
          doc,
          'strong',
          item.sellerName || record?.snapshot?.sellerName || ''
        )
      )
      if (item.orderId) header.append(node(doc, 'span', item.orderId))
      content.append(header, productPreview(doc, item, lifecycle, loadImage))
      let subtotal = ''
      try {
        subtotal =
          item.quantity === '0'
            ? '0.00'
            : centsToMoney(lineGrossCents(item.price, item.quantity))
      } catch {
        /* Unknown source amounts stay absent. */
      }
      content.append(
        facts(doc, [
          ['Quantity', item.quantity],
          ['Unit price', money(item.price, getLocale())],
          ['Price × quantity', money(subtotal, getLocale())],
          [
            'Discount',
            Number(item.discount) ? money(item.discount, getLocale()) : '',
          ],
        ])
      )
      const note = notes(doc, record)
      if (note) content.append(note)
    },
  })
}

export function orderContextHelp(
  target,
  { getRecord, getProducts, loadImage = async (source) => source }
) {
  return preparationHelp(target, message('Order details'), {
    panelClass: 'item-context-popover',
    renderContent(content, lifecycle) {
      const record = getRecord(),
        order = record.snapshot,
        doc = target.ownerDocument
      const header = node(doc, 'header', undefined, 'item-context-heading')
      header.append(
        node(doc, 'strong', order.sellerName),
        node(doc, 'span', order.orderId)
      )
      const status = presentOrderStatus(order.status).label
      header.append(label(doc, 'span', status))
      content.append(header)
      const locale = getLocale()
      const products = getProducts?.() || order.items
      const list = node(doc, 'div', undefined, 'item-context-products')
      for (const product of products.slice(0, 3))
        list.append(productPreview(doc, product, lifecycle, loadImage, true))
      content.append(
        list,
        facts(doc, [
          ['Products', String(order.items.length)],
          ['Shipping', money(order.totals?.shipping, locale)],
          ['Order total', money(order.totals?.payable, locale)],
        ])
      )
      const note = notes(doc, record)
      if (note) content.append(note)
    },
  })
}
