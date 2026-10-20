import { productAttributes, translateAttribute } from './product-attributes.js'
import { element as el, copyTextButton, copied, orderReference } from './ui.js'
import { message, bindAttribute, bindText, getLanguage } from './i18n.js'
import { decorateIcon } from './icons.js'
import { photoCopyTile } from './photo-copy.js'
import { preparationHelp } from './preparation-help.js'
import { mountProductTags } from './product-tags-ui.js'
import { mountCartonDetails } from './carton-details-ui.js'

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

/** Original source stays read-only; optional local product tags save separately. */
export function openProductDetails(
  item,
  { loadPhoto, onPhoto, onOrder, copyPhoto, tags, carton }
) {
  const source = productAttributes(item)
  const dialog = el('dialog', undefined, 'product-details-dialog')
  dialog.dataset.productEntryId = item.entryId || ''
  let tagEditor, closing
  // Dismissal and navigation share one transition: only its first callback runs.
  const closeDetails = (onClosed) => {
    if (closing) return closing
    if (!dialog.open) return Promise.resolve(false)
    closing = (async () => {
      tagEditor?.setBusy(true)
      try {
        await tagEditor?.flush()
        dialog.close()
        onClosed?.()
        return true
      } catch {
        return false
      } finally {
        tagEditor?.setBusy(false)
        closing = undefined
      }
    })()
    return closing
  }
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    void closeDetails()
  })
  bindAttribute(dialog, 'aria-label', message('Original product details'))
  const heading = el('header', undefined, 'product-details-heading')
  const close = el('button')
  close.type = 'button'
  decorateIcon(close, 'close', {
    iconOnly: true,
    label: message('Close product details'),
  })
  close.addEventListener('click', () => void closeDetails())
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
  order.addEventListener('click', () => void closeDetails(onOrder))
  order.disabled = !onOrder
  tools.append(copyAll, order)
  const top = el('div', undefined, 'product-details-top')
  top.append(heading, tools)
  const content = el('div', undefined, 'product-details-scroll')
  const identity = el('div', undefined, 'product-details-identity')
  if (item.sellerName)
    identity.append(
      copyTextButton(item.sellerName, { label: 'Copy store name' })
    )
  if (item.orderId)
    identity.append(
      orderReference(item.orderId, { sourceType: item.sourceType })
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
  if (carton) mountCartonDetails(data, carton)
  if (item.thumbnail) {
    const photoColumn = el('div', undefined, 'product-details-photo')
    const photoButton = el('button', undefined, 'product-photo-button')
    bindAttribute(photoButton, 'aria-label', message('Open product photo'))
    const image = el('img')
    image.alt = source.title || ''
    photoButton.append(image)
    photoButton.addEventListener('click', () => onPhoto?.())
    photoColumn.append(photoCopyTile(photoButton, copyPhoto))
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
  content.append(identity, body, original)
  dialog.append(top, content)
  if (typeof tags?.save === 'function') {
    const tagHost = el('div')
    body.after(tagHost)
    tagEditor = mountProductTags(tagHost, tags)
  }
  dialog.addEventListener(
    'close',
    () => {
      tagEditor?.destroy()
      dialog.remove()
    },
    { once: true }
  )
  document.body.append(dialog)
  dialog.showModal()
  close.focus()
  return {
    dialog,
    close: closeDetails,
    dirty: () => Boolean(tagEditor?.dirty()),
    setDefinitions: (definitions) => tagEditor?.setDefinitions(definitions),
  }
}
