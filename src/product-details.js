import { productAttributes, translateAttribute } from './product-attributes.js'
import { element as el, copyTextButton, copied, orderReference } from './ui.js'
import { message, bindAttribute, bindText, getLanguage } from './i18n.js'
import { decorateIcon } from './icons.js'
import { photoCopyTile } from './photo-copy.js'
import { preparationHelp } from './preparation-help.js'
import { mountProductTags } from './product-tags-ui.js'
import { mountCartonDetails } from './carton-details-ui.js'
import { setCodeText } from './code-display.js'

/** Display helpers never rewrite the source row or the values exported to Excel. */
export function createProductDescription(item) {
  const source = productAttributes(item)
  const fragment = document.createDocumentFragment()
  const title = el('div', source.title || source.description, 'product-title')
  preparationHelp(
    title,
    message(
      'Click for original product details. Use the checkbox to select. Click an attribute value to copy it.'
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
  {
    loadPhoto,
    onPhoto,
    onOrder,
    onOperations,
    copyPhoto,
    tags,
    carton,
    mode = 'orders',
    onEditInOrders,
    shipment,
  }
) {
  const readOnly = mode === 'read-only'
  if (readOnly) {
    // Capabilities are removed before handlers are installed, including nested
    // order/operations routes. A disabled editor is not an ownership boundary.
    onOrder = undefined
    onOperations = undefined
  }
  const source = productAttributes(item)
  const dialog = el('dialog', undefined, 'product-details-dialog')
  dialog.dataset.productEntryId = item.entryId || ''
  dialog.dataset.mode = mode
  let tagEditor, cartonEditor, closing
  // Dismissal and navigation share one transition: only its first callback runs.
  const closeDetails = (onClosed) => {
    if (closing) return closing
    if (!dialog.open) return Promise.resolve(false)
    closing = (async () => {
      tagEditor?.setBusy(true)
      try {
        await tagEditor?.flush()
        await cartonEditor?.flush?.()
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
  heading.append(el('h2', message('Original product details')))
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
  tools.append(order)
  if (onEditInOrders) {
    const edit = el('button', message('Edit in Orders'))
    edit.type = 'button'
    edit.dataset.action = 'edit-in-orders'
    edit.onclick = () => void closeDetails(onEditInOrders)
    tools.append(edit)
  }
  const navigation = [close, order]
  if (onOperations) {
    const operations = decorateIcon(
      el('button', message('Operations')),
      'check'
    )
    operations.addEventListener('click', () => void closeDetails(onOperations))
    tools.append(operations)
    navigation.push(operations)
  }
  heading.append(tools, close)
  const top = el('div', undefined, 'product-details-top')
  top.append(heading)
  const content = el('div', undefined, 'product-details-scroll')
  const identity = el('div', undefined, 'product-details-identity')
  if (item.sellerName)
    identity.append(
      copyTextButton(item.sellerName, { label: 'Copy store name' })
    )
  if (item.orderId) {
    const reference = orderReference(item.orderId, {
        sourceType: item.sourceType,
        snapshot: item.record?.snapshot,
      }),
      copyOrder = reference.querySelector('button'),
      feedback = copyOrder.querySelector('.copy-text-feedback')
    decorateIcon(copyOrder, 'copy', { iconOnly: true })
    copyOrder.removeAttribute('title')
    if (feedback) copyOrder.append(feedback)
    identity.append(reference)
  }
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
  data.append(identity, title, fields)
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
  const cartonHost = el('div', undefined, 'product-details-carton')
  if (readOnly && carton) {
    const summary = el('section', undefined, 'product-carton-details')
    summary.append(
      el('h3', message('Cartons')),
      el(
        'p',
        typeof carton.summary === 'function'
          ? carton.summary()
          : carton.summary || '—'
      )
    )
    cartonHost.append(summary)
  } else if (carton?.openBatches) {
    const panel = el(
      'section',
      undefined,
      'product-carton-details product-carton-batch-context'
    )
    const code = el('code', undefined, 'ce-code'),
      summary = el('span')
    setCodeText(code, carton.baseCode)
    bindText(summary, carton.summary)
    const edit = el('button', message('Edit cartons'))
    decorateIcon(edit, 'carton')
    edit.addEventListener('click', () => {
      void carton
        .openBatches()
        .then(() => bindText(summary, carton.summary))
        .catch((error) => bindText(summary, message(error.message)))
    })
    panel.append(code, summary, edit)
    cartonHost.append(panel)
  } else if (carton)
    cartonEditor = mountCartonDetails(cartonHost, {
      ...carton,
      onBusyChange: (busy) => {
        dialog.setAttribute('aria-busy', String(busy))
        carton.onBusyChange?.(busy)
      },
    })
  const original = el('section', undefined, 'product-original-description')
  const originalHeading = el('div', undefined, 'product-original-heading')
  originalHeading.append(el('h3', message('Original description')), copyAll)
  original.append(originalHeading, el('pre', source.description))
  if (shipment) {
    const quantities = el('dl', undefined, 'product-shipment-quantities')
    for (const [key, label] of [
      ['availableBefore', 'Available before this container'],
      ['loaded', 'Loaded here'],
      ['remaining', 'Remaining'],
    ])
      quantities.append(
        el('dt', message(label)),
        el('dd', String(shipment[key] ?? '—'))
      )
    content.append(quantities)
  }
  content.append(body, cartonHost, original)
  dialog.append(top, content)
  if (readOnly && tags?.selected?.length) {
    const tagHost = el('div', undefined, 'product-row-tags')
    for (const name of tags.selected) tagHost.append(el('span', name))
    original.before(tagHost)
  } else if (typeof tags?.save === 'function') {
    const tagHost = el('div')
    original.before(tagHost)
    tagEditor = mountProductTags(tagHost, tags)
  }
  dialog.addEventListener(
    'close',
    () => {
      tagEditor?.destroy()
      cartonEditor?.destroy?.()
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
