import { element as el } from './ui.js'
import { bindText, message } from './i18n.js'
import { decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'
import { centsToMoney, moneyToCents } from './money.js'
import { formatCny } from './money-format.js'
import {
  additionalChargesTotal,
  orderCostAdjustments,
  validateAdditionalCharges,
} from './order-charges.js'

/** Authored order costs stay separate from the seller's original prices/totals. */
export function mountOrderCharges(host, { record, onSave }) {
  const details = el('section', undefined, 'order-charges')
  const summary = el('header', undefined, 'order-charges-heading')
  summary.append(el('strong', message('Additional charges')))
  const summaryTotal = el('span', undefined, 'order-charges-summary-total')
  summary.append(summaryTotal)
  details.append(summary)
  const help = el(
    'p',
    message(
      'External costs are shared by product value. Use Linked payments for payments already recorded in an order.'
    ),
    'order-charges-help'
  )
  const form = el('form')
  form.noValidate = true
  const fields = el('fieldset')
  fields.append(el('legend', message('Additional charges'), 'sr-only'))
  const toolbar = el('div', undefined, 'order-charges-toolbar')
  const add = el('button', message('Add charge'), 'compact-button')
  add.type = 'button'
  preparationHelp(
    add,
    message('Add a reason and the total extra cost for this order.')
  )
  const save = el('button', message('Save charges'), 'primary compact-button')
  save.type = 'submit'
  preparationHelp(
    save,
    message(
      'Save these costs without replacing any source prices or quantities.'
    )
  )
  toolbar.append(add, save)
  summary.append(toolbar)
  const status = el('span', undefined, 'order-charges-status')
  status.setAttribute('role', 'status')
  const error = el('p', undefined, 'order-charges-error')
  error.id = `order-charge-error-${crypto.randomUUID()}`
  error.setAttribute('role', 'alert')
  error.hidden = true
  const table = el('table', undefined, 'order-charges-inputs')
  const head = el('thead'),
    header = el('tr')
  for (const label of ['Reason', 'Amount · CNY', 'Actions']) {
    const cell = el('th', message(label))
    if (label === 'Actions') cell.className = 'sr-only'
    header.append(cell)
  }
  head.append(header)
  const body = el('tbody')
  table.append(head, body)
  const empty = el(
    'p',
    message('No additional charges.'),
    'order-charges-empty'
  )
  const preview = el('div', undefined, 'order-charges-preview')
  preview.setAttribute('aria-live', 'polite')
  const quickReasons = el('div', undefined, 'order-charges-quick-reasons')
  for (const text of ['Unloading', 'Label printing', 'Local delivery']) {
    const quick = el('button', message(text))
    quick.type = 'button'
    quick.addEventListener('click', () => {
      const row = appendCharge({
        id: crypto.randomUUID(),
        reason: String(message(text)),
        amount: '',
      })
      renderPreview()
      row.amount.focus()
    })
    quickReasons.append(quick)
  }
  fields.append(
    summary,
    help,
    quickReasons,
    table,
    empty,
    status,
    error,
    preview
  )
  form.append(fields)
  details.append(form)
  host.append(details)
  const rows = []
  let saved = structuredClone(record.additionalCharges || []),
    saving = false

  const showError = (value) => {
    error.hidden = !value
    bindText(error, value ? message(value) : '')
  }
  const read = ({ validate = false } = {}) =>
    rows.map((row) => {
      row.reason.removeAttribute('aria-invalid')
      row.amount.removeAttribute('aria-invalid')
      if (!row.reason.value.trim() && validate) {
        row.reason.setAttribute('aria-invalid', 'true')
        throw new Error('Explain the reason for each additional charge')
      }
      let amount
      try {
        amount = moneyToCents(row.amount.value.trim())
        if (amount <= 0n)
          throw new Error('Additional charge amounts must be positive')
      } catch {
        if (validate) row.amount.setAttribute('aria-invalid', 'true')
        throw new Error(
          'Enter a positive amount with at most two decimal places.'
        )
      }
      return {
        id: row.id,
        reason: row.reason.value.trim(),
        amount: centsToMoney(amount),
      }
    })
  const dirty = () => {
    try {
      return JSON.stringify(read()) !== JSON.stringify(saved)
    } catch {
      return true
    }
  }
  const moneyChange = (before, after, className = '') => {
    const value = el(
      'span',
      undefined,
      `order-charge-comparison ${className}`.trim()
    )
    value.append(
      bindText(el('span', undefined, 'order-charge-source'), () =>
        formatCny(before)
      ),
      el('span', '→', 'order-charge-arrow'),
      bindText(
        el(
          'strong',
          undefined,
          after !== before ? 'order-charge-increase' : ''
        ),
        () => formatCny(after)
      )
    )
    return value
  }
  const renderPreview = () => {
    const show = (text) =>
      preview.replaceChildren(el('p', message(text), 'order-charges-help'))
    empty.hidden = rows.length > 0
    table.hidden = rows.length === 0
    preview.hidden = rows.length === 0 && saved.length === 0
    save.disabled = saving || !dirty()
    let charges, adjusted
    try {
      charges = read()
      adjusted = orderCostAdjustments({ ...record, additionalCharges: charges })
    } catch {
      bindText(summaryTotal, '')
      show('Complete the charge amounts to preview their effect.')
      return
    }
    const total = additionalChargesTotal({ additionalCharges: charges })
    bindText(summaryTotal, total === '0.00' ? '' : () => formatCny(`+${total}`))
    const originalTotal = record.snapshot.totals.payable
    const finalTotal = centsToMoney(
      moneyToCents(originalTotal) + moneyToCents(total)
    )
    const totalLine = el('div', undefined, 'order-charges-total')
    totalLine.append(
      el('span', message('Order total')),
      moneyChange(originalTotal, finalTotal)
    )
    const explanation = el(
      'p',
      message(
        'Unit prices show the added cost; exact row totals are used for reconciliation. Product discounts remain unchanged.'
      ),
      'order-charges-help'
    )
    const list = el('div', undefined, 'order-charges-products')
    for (const item of record.snapshot.items) {
      const cost = adjusted.get(item.entryId)
      if (!cost || cost.additionalCharge === '0.00') continue
      const product = el('div', undefined, 'order-charge-product')
      if (item.thumbnail) {
        const image = el('img')
        image.src = item.thumbnail
        image.alt = ''
        image.loading = 'lazy'
        product.append(image)
      }
      const info = el('div', undefined, 'order-charge-product-info')
      info.append(
        el('span', item.title || item.description, 'order-charge-product-name')
      )
      const unit = el('div', undefined, 'order-charge-product-cost')
      unit.append(
        el('span', message('Unit price')),
        moneyChange(cost.sourceUnitPrice, cost.effectiveUnitPrice)
      )
      const amount = el('div', undefined, 'order-charge-product-cost')
      amount.append(
        el('span', message('Row amount')),
        moneyChange(cost.sourceAmount, cost.effectiveAmount)
      )
      info.append(unit, amount)
      product.append(
        info,
        bindText(el('strong', undefined, 'order-charge-increase'), () =>
          formatCny(`+${cost.additionalCharge}`)
        )
      )
      list.append(product)
    }
    preview.replaceChildren(
      totalLine,
      ...(list.childNodes.length ? [explanation, list] : [])
    )
  }
  const appendCharge = (
    charge = { id: crypto.randomUUID(), reason: '', amount: '' },
    { focus = false } = {}
  ) => {
    const tr = el('tr'),
      reasonCell = el('td'),
      amountCell = el('td'),
      actions = el('td')
    const reason = el('input'),
      amount = el('input')
    reason.type = 'text'
    reason.required = true
    reason.value = charge.reason
    reason.name = `reason-${charge.id}`
    amount.type = 'number'
    amount.inputMode = 'decimal'
    amount.min = '0.01'
    amount.step = '0.01'
    amount.required = true
    amount.value = charge.amount
    amount.name = `amount-${charge.id}`
    amount.addEventListener('blur', () => {
      try {
        amount.value = centsToMoney(moneyToCents(amount.value.trim()))
      } catch {
        // Preserve invalid drafts for the existing validation message.
      }
    })
    for (const [input, label, cell] of [
      [reason, 'Reason', reasonCell],
      [amount, 'Amount · CNY', amountCell],
    ]) {
      input.id = `charge-${crypto.randomUUID()}`
      const caption = el('label', message(label), 'sr-only')
      caption.htmlFor = input.id
      input.setAttribute('aria-describedby', error.id)
      cell.append(caption, input)
      input.addEventListener('input', () => {
        showError('')
        bindText(status, '')
        renderPreview()
      })
      input.addEventListener('blur', () => {
        try {
          read({ validate: true })
        } catch (failure) {
          showError(failure.message)
        }
      })
    }
    const remove = el('button', undefined, 'icon-button')
    remove.type = 'button'
    decorateIcon(remove, 'trash', {
      iconOnly: true,
      label: message('Remove charge'),
    })
    preparationHelp(
      remove,
      message(
        'Remove this extra cost from the draft. Save charges to apply the change.'
      )
    )
    const row = { id: charge.id, reason, amount, tr }
    remove.addEventListener('click', () => {
      rows.splice(rows.indexOf(row), 1)
      tr.remove()
      showError('')
      renderPreview()
    })
    actions.append(remove)
    tr.append(reasonCell, amountCell, actions)
    rows.push(row)
    body.append(tr)
    if (focus) reason.focus()
    return row
  }
  for (const charge of saved) appendCharge(charge)
  add.addEventListener('click', () => {
    appendCharge(undefined, { focus: true })
    renderPreview()
  })
  const flush = async () => {
    if (saving || !dirty()) return
    const charges = validateAdditionalCharges(read({ validate: true }))
    orderCostAdjustments({ ...record, additionalCharges: charges })
    saving = true
    fields.disabled = true
    bindText(status, 'Saving…')
    showError('')
    try {
      const result = await onSave(charges)
      saved = structuredClone(charges)
      record = result?.snapshot
        ? result
        : { ...record, additionalCharges: charges }
      bindText(status, 'Saved')
    } finally {
      saving = false
      fields.disabled = false
      renderPreview()
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void flush().catch((failure) => {
      bindText(status, '')
      showError(failure.message)
      fields.querySelector('[aria-invalid="true"]')?.focus()
    })
  })
  renderPreview()
  return {
    control: details,
    flush,
    dirty,
    update(next) {
      record = next
      renderPreview()
    },
  }
}
