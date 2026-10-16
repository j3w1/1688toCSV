import { productAttributes, translateAttribute } from './product-attributes.js'
import { element as el, copyTextButton, copied } from './ui.js'
import { message, bindAttribute, bindText, getLanguage } from './i18n.js'
import { decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'

/** Display helpers never rewrite the source row or the values exported to Excel. */
export function createProductDescription(item) {
  const source = productAttributes(item)
  const fragment = document.createDocumentFragment()
  const title = el('div', source.title || source.description, 'product-title')
  preparationHelp(
    title,
    message(
      'Double-click for original product details. Click an attribute value to copy it.'
    )
  )
  fragment.append(title)
  if (!source.fields.length) return fragment
  const attributes = el('dl', undefined, 'product-attributes')
  for (const field of source.fields) {
    const translated = translateAttribute(field, getLanguage())
    const pair = el('div')
    pair.dataset.attribute = field.kind
    const value = el('dd')
    const text = translated.measurement?.numberText ?? translated.value
    const copy = copyTextButton(text, { label: message('Copy value') })
    if (translated.colors?.length) {
      copy.classList.add('product-color-hint')
      if (translated.colors.length === 1 && translated.colors[0].swatch) {
        const swatch = el('i')
        swatch.style.backgroundColor = translated.colors[0].swatch
        swatch.setAttribute('aria-hidden', 'true')
        copy.prepend(swatch)
      }
    }
    value.append(copy)
    if (translated.measurement?.unit)
      value.append(el('span', translated.measurement.unit, 'attribute-unit'))
    pair.append(el('dt', translated.label), value)
    attributes.append(pair)
  }
  fragment.append(attributes)
  return fragment
}

/** Read-only original source details, deliberately unaffected by UI translations. */
export function openProductDetails(
  item,
  { loadPhoto, onPhoto, onOrder, copyPhoto }
) {
  const source = productAttributes(item)
  const dialog = el('dialog', undefined, 'product-details-dialog')
  bindAttribute(dialog, 'aria-label', message('Original product details'))
  const heading = el('header', undefined, 'product-details-heading')
  const close = el('button')
  close.type = 'button'
  decorateIcon(close, 'close', {
    iconOnly: true,
    label: message('Close product details'),
  })
  close.addEventListener('click', () => dialog.close())
  heading.append(el('h2', message('Original product details')), close)
  const tools = el('div', undefined, 'product-details-tools')
  const copyAll = el('button', message('Copy description'))
  decorateIcon(copyAll, 'copy')
  copyAll.addEventListener(
    'click',
    () =>
      void copied(copyAll, () =>
        navigator.clipboard.writeText(source.description)
      )
  )
  const order = el('button', message('Order details'))
  decorateIcon(order, 'store')
  order.addEventListener('click', () => {
    dialog.close()
    onOrder?.()
  })
  order.disabled = !onOrder
  tools.append(copyAll, order)
  const identity = el('div', undefined, 'product-details-identity')
  if (item.sellerName)
    identity.append(
      copyTextButton(item.sellerName, { label: 'Copy store name' })
    )
  if (item.orderId)
    identity.append(
      copyTextButton(item.orderId, { label: 'Copy order number' })
    )
  const body = el('div', undefined, 'product-details-body')
  const data = el('div', undefined, 'product-details-data')
  const title = el('h3')
  title.append(
    copyTextButton(source.title || source.description, {
      label: 'Copy original title',
    })
  )
  const fields = el('dl', undefined, 'product-original-fields')
  const add = (label, value) => {
    if (!String(value ?? '').trim()) return
    const pair = el('div')
    const cell = el('dd')
    cell.append(copyTextButton(value, { label: 'Copy original value' }))
    pair.append(el('dt', label), cell)
    fields.append(pair)
  }
  for (const field of source.fields) add(field.label, field.value)
  add('单价', item.price)
  add('数量', item.quantity)
  data.append(title, fields)
  if (item.thumbnail) {
    const photoColumn = el('div', undefined, 'product-details-photo')
    const photoButton = el('button', undefined, 'product-photo-button')
    bindAttribute(photoButton, 'aria-label', message('Open product photo'))
    const image = el('img')
    image.alt = source.title || ''
    photoButton.append(image)
    photoButton.addEventListener('click', () => onPhoto?.())
    const photoCopy = el('button', message('Copy image'), 'photo-copy-button')
    decorateIcon(photoCopy, 'image')
    photoCopy.addEventListener('click', () => void copied(photoCopy, copyPhoto))
    photoCopy.disabled = !copyPhoto
    photoColumn.append(photoButton, photoCopy)
    body.append(photoColumn)
    const error = el('p', undefined, 'product-details-photo-error')
    error.setAttribute('role', 'status')
    photoColumn.append(error)
    void (async () => {
      try {
        const url = await loadPhoto(item.thumbnail)
        if (!dialog.isConnected) return
        image.src = url
        await image.decode()
      } catch {
        if (dialog.isConnected) {
          photoButton.hidden = true
          bindText(error, message('Product photo unavailable'))
        }
      }
    })()
  }
  body.append(data)
  const original = el('section', undefined, 'product-original-description')
  original.append(
    el('h3', message('Original description')),
    el('pre', source.description)
  )
  dialog.append(heading, tools, identity, body, original)
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  document.body.append(dialog)
  dialog.showModal()
  close.focus()
  return dialog
}
