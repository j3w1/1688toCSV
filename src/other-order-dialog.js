import { message, t } from './i18n.js'
import { element, enableLightDismiss, pinDialogActions } from './ui.js'
import {
  OTHER_ORDER_FORMAT,
  OTHER_ORDER_FILE_LIMIT,
  OTHER_ORDER_PHOTO_LIMIT,
  OTHER_ORDER_PRODUCT_LIMIT,
  validateOtherOrder,
  validateOtherPhoto,
  parseOtherOrderFile,
} from './other-orders.js'

export function openOtherOrderDialog({ save }) {
  const dialog = element('dialog', undefined, 'other-order-dialog')
  enableLightDismiss(dialog)
  const heading = element('h2', message('Add order from another source'))
  heading.id = 'other-order-heading'
  dialog.setAttribute('aria-labelledby', heading.id)
  const form = element('form')
  form.id = 'other-order-form'
  form.noValidate = true
  const error = element('p', undefined, 'other-order-error')
  error.setAttribute('role', 'alert')
  error.hidden = true
  const metadata = element('div', undefined, 'other-order-metadata')
  const field = (parent, label, name, type = 'text', value = '') => {
    const host = element('label')
    host.append(element('span', message(label)))
    const input = element(type === 'textarea' ? 'textarea' : 'input')
    if (type !== 'textarea') input.type = type
    input.value = value
    input.dataset.field = name
    input.dataset.action = `other-order-${name
      .split('.')
      .at(-1)
      .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
    input.autocomplete = 'off'
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'))
    host.append(input)
    parent.append(host)
    return input
  }
  const supplier = field(metadata, 'Supplier', 'supplier')
  const reference = field(metadata, 'Order reference', 'reference')
  const date = field(
    metadata,
    'Order date',
    'date',
    'date',
    new Date().toLocaleDateString('en-CA')
  )
  const products = element('div', undefined, 'other-order-products')
  let rows = [],
    busy = false
  const button = (label, action, handler) => {
    const result = element('button', message(label))
    result.type = 'button'
    result.dataset.action = action
    if (handler) result.addEventListener('click', handler)
    return result
  }
  const showError = (failure) => {
    error.textContent = t(failure.message)
    error.hidden = false
    for (const control of form.querySelectorAll('[aria-invalid]'))
      control.removeAttribute('aria-invalid')
    const control = [...form.querySelectorAll('[data-field]')].find(
      (input) => input.dataset.field === failure.field
    )
    control?.setAttribute('aria-invalid', 'true')
    control?.focus()
  }
  const setBusy = (value) => {
    busy = value
    for (const control of dialog.querySelectorAll('input,textarea,button'))
      control.disabled = value
    for (const control of products.querySelectorAll(
      '[data-action="other-order-remove-product"]'
    ))
      control.disabled = value || rows.length === 1
  }
  const values = () =>
    rows.map((row) => ({
      description: row.description.value,
      specs: row.specs.value,
      quantity: row.quantity.value,
      unitPrice: row.unitPrice.value,
      photo: row.photo,
    }))
  const render = (items) => {
    products.replaceChildren()
    rows = items.map((product, index) => {
      const section = element('fieldset', undefined, 'other-order-product')
      section.append(
        element('legend', message('Product {0}', { 0: index + 1 }))
      )
      const row = { photo: product.photo || '' }
      for (const [key, label, type, fallback] of [
        ['description', 'Description', 'textarea', ''],
        ['specs', 'Specs', 'text', ''],
        ['quantity', 'Quantity', 'text', '1'],
        ['unitPrice', 'Unit price (CNY)', 'text', ''],
      ]) {
        row[key] = field(
          section,
          label,
          `products.${index}.${key}`,
          type,
          product[key] ?? fallback
        )
        if (['quantity', 'unitPrice'].includes(key))
          row[key].inputMode = key === 'quantity' ? 'numeric' : 'decimal'
      }
      const photo = field(
        section,
        'Photo (optional)',
        `products.${index}.photo`,
        'file'
      )
      photo.accept = 'image/png,image/jpeg,image/webp,image/gif'
      const preview = element('img')
      preview.alt = t('Product photo')
      preview.hidden = !row.photo
      if (row.photo) preview.src = row.photo
      section.append(preview)
      const clear = button('Remove photo', 'other-order-clear-photo', () => {
        row.photo = ''
        photo.value = ''
        preview.removeAttribute('src')
        preview.hidden = true
      })
      section.append(clear)
      photo.addEventListener('change', async () => {
        const file = photo.files[0]
        if (!file) return
        setBusy(true)
        try {
          if (file.size > OTHER_ORDER_PHOTO_LIMIT * 0.74)
            throw new Error('Photo must be smaller than 1.4 MB')
          const bytes = new Uint8Array(await file.arrayBuffer())
          let binary = ''
          for (let offset = 0; offset < bytes.length; offset += 8192)
            binary += String.fromCharCode(
              ...bytes.subarray(offset, offset + 8192)
            )
          row.photo = validateOtherPhoto(
            `data:${file.type};base64,${btoa(binary)}`,
            `products.${index}.photo`
          )
          preview.src = row.photo
          preview.hidden = false
          error.hidden = true
        } catch (failure) {
          photo.value = ''
          showError(failure)
        } finally {
          setBusy(false)
        }
      })
      const remove = button(
        'Remove product',
        'other-order-remove-product',
        () => render(values().filter((_, i) => i !== index))
      )
      remove.disabled = items.length === 1
      section.append(remove)
      products.append(section)
      return row
    })
  }
  const add = button('Add product', 'other-order-add-product', () => {
    if (rows.length >= OTHER_ORDER_PRODUCT_LIMIT)
      return showError(new Error('An order can contain at most 200 products'))
    render([...values(), {}])
  })
  const file = element('input')
  file.type = 'file'
  file.accept = '.json,application/json'
  file.hidden = true
  file.dataset.action = 'other-order-file'
  const importFile = button(
    'Import order JSON',
    'other-order-import-json',
    () => file.click()
  )
  file.addEventListener('change', async () => {
    const selected = file.files[0]
    if (!selected) return
    setBusy(true)
    try {
      if (selected.size > OTHER_ORDER_FILE_LIMIT)
        throw new Error('Order file must be smaller than 8 MB')
      const order = parseOtherOrderFile(await selected.text())
      supplier.value = order.supplier
      reference.value = order.reference
      date.value = order.date
      render(order.products)
      error.hidden = true
    } catch (failure) {
      showError(failure)
    } finally {
      file.value = ''
      setBusy(false)
    }
  })
  const actions = element('div', undefined, 'dialog-actions')
  const cancel = button('Cancel', 'other-order-cancel', () => {
    if (!busy) dialog.close()
  })
  const submit = button('Save order', 'other-order-save')
  submit.type = 'submit'
  submit.setAttribute('form', form.id)
  actions.append(cancel, submit)
  form.append(metadata, importFile, file, error, products, add, actions)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy) return
    try {
      const order = validateOtherOrder({
        format: OTHER_ORDER_FORMAT,
        version: 1,
        supplier: supplier.value,
        reference: reference.value,
        date: date.value,
        products: values(),
      })
      error.hidden = true
      setBusy(true)
      await save(order)
      dialog.close()
    } catch (failure) {
      showError(failure)
    } finally {
      setBusy(false)
    }
  })
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault()
  })
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  dialog.append(
    heading,
    element(
      'p',
      message('Enter CNY prices. This order will not have a 1688 link.')
    ),
    form
  )
  pinDialogActions(dialog, actions)
  render([{}])
  document.body.append(dialog)
  dialog.showModal()
  supplier.focus()
  return dialog
}
