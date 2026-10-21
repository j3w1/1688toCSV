import { cartonBreakdown, normalizeUnitsPerCarton } from './carton-packing.js'
import { element as el, copyTextButton } from './ui.js'
import { bindAttribute, bindText, message } from './i18n.js'
import { preparationHelp } from './preparation-help.js'
import { icon, decorateIcon } from './icons.js'
import { setCodeText } from './code-display.js'

export function cartonBreakdownMessage(result) {
  if (result.status === 'unknown') return message('Carton count unknown')
  if (result.status === 'partial')
    return message('{0} full cartons + {1} loose units · Review packing', {
      0: result.fullCartons,
      1: result.remainder,
    })
  return message('{0} full cartons', { 0: result.fullCartons })
}

/** Capacity belongs to a source product, including products not yet prepared. */
export function mountCartonCapacity(host, { quantity, value, onSave }) {
  const control = el('div', undefined, 'carton-capacity')
  const label = el('label', message('Pcs/box'), 'sr-only')
  const input = el('input')
  const unit = el('span', message('/box'), 'carton-capacity-unit')
  unit.setAttribute('aria-hidden', 'true')
  input.type = 'number'
  input.min = '1'
  input.max = String(Number.MAX_SAFE_INTEGER)
  input.step = '1'
  input.inputMode = 'numeric'
  input.id = `carton-capacity-${crypto.randomUUID()}`
  input.value = value ?? ''
  bindAttribute(input, 'placeholder', '—')
  label.htmlFor = input.id
  const summary = el('span', undefined, 'carton-capacity-summary sr-only')
  summary.id = `${input.id}-summary`
  const status = el('span', undefined, 'carton-capacity-status sr-only')
  status.setAttribute('role', 'status')
  status.id = `${input.id}-status`
  input.setAttribute('aria-describedby', `${summary.id} ${status.id}`)
  preparationHelp(
    input,
    message(
      'Units per full carton. Blank: unknown. Saves automatically; review loose units.'
    )
  )
  control.append(label, input, unit, summary, status)
  host.append(control)
  let saved = value ?? null
  let timer, work
  const parse = () => {
    if (input.validity?.badInput)
      throw new Error('Pcs/box must be a positive whole number')
    return normalizeUnitsPerCarton(input.value)
  }
  const dirty = () => {
    try {
      return parse() !== saved
    } catch {
      return true
    }
  }
  const showSummary = () => {
    let capacity
    try {
      capacity = parse()
    } catch {
      capacity = null
    }
    summary.hidden = capacity === null
    unit.hidden = capacity === null
    bindText(
      summary,
      cartonBreakdownMessage(cartonBreakdown(quantity, capacity))
    )
  }
  const failure = (error) => {
    input.setAttribute('aria-invalid', 'true')
    control.dataset.state = 'error'
    bindText(status, message(error.message))
  }
  const flush = async () => {
    clearTimeout(timer)
    if (work) {
      await work
      return flush()
    }
    if (!dirty()) return
    let next
    try {
      next = parse()
    } catch (error) {
      failure(error)
      throw error
    }
    input.removeAttribute('aria-invalid')
    control.dataset.state = 'saving'
    bindText(status, message('Saving…'))
    work = onSave(next)
    try {
      await work
      saved = next
      control.dataset.state = 'saved'
      bindText(status, message('Saved'))
    } catch (error) {
      failure(error)
      throw error
    } finally {
      work = undefined
    }
    if (dirty()) return flush()
  }
  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid')
    delete control.dataset.state
    bindText(status, '')
    showSummary()
    clearTimeout(timer)
    timer = setTimeout(() => {
      // Let incomplete native number drafts remain quiet until blur or Enter.
      // Valid edits still save without requiring another interaction.
      try {
        parse()
      } catch {
        return
      }
      void flush().catch(() => {})
    }, 450)
  })
  input.addEventListener('change', () => void flush().catch(() => {}))
  input.addEventListener('blur', () => void flush().catch(() => {}))
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    void flush().catch(() => {})
  })
  showSummary()
  return {
    control,
    input,
    flush,
    dirty,
    update(next) {
      quantity = next.quantity
      if (!dirty() && !work) {
        saved = next.value ?? null
        input.value = saved ?? ''
      }
      showSummary()
    },
  }
}

export function cartonCapacityReadout(
  item,
  capacity,
  { onEdit, onError } = {}
) {
  const row = el('div', undefined, 'carton-capacity carton-capacity-readout')
  try {
    capacity = normalizeUnitsPerCarton(capacity)
  } catch {
    capacity = null
  }
  row.append(el('span', message('Pcs/box')))
  if (capacity != null) {
    const copy = copyTextButton(String(capacity), {
      label: message('Copy Pcs/box'),
    })
    const unit = el('span', message('/box'), 'carton-capacity-unit')
    unit.setAttribute('aria-hidden', 'true')
    copy.append(unit)
    row.append(copy)
  }
  if (onEdit) {
    const edit = el(
      'button',
      capacity == null ? '—' : undefined,
      'carton-capacity-edit copyable-text'
    )
    edit.type = 'button'
    bindAttribute(edit, 'aria-label', message('Edit Pcs/box in Orders'))
    preparationHelp(
      edit,
      message('Edit in Orders. Packing changes save first.')
    )
    if (capacity != null) edit.append(icon('edit'))
    let pending = false
    edit.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (pending) return
      pending = true
      edit.disabled = true
      try {
        await onEdit(item)
      } catch (error) {
        if (onError) onError(error)
        else {
          const status = el('small', message(error.message))
          status.setAttribute('role', 'alert')
          row.append(status)
        }
      } finally {
        pending = false
        edit.disabled = false
      }
    })
    row.append(edit)
  } else {
    if (capacity == null) row.append(el('span', '—'))
    row.setAttribute('role', 'group')
    row.tabIndex = 0
    bindAttribute(row, 'aria-label', message('Pcs/box'))
    preparationHelp(row, message('Source product unavailable in Orders.'))
  }
  if (capacity != null)
    row.append(
      el(
        'small',
        cartonBreakdownMessage(cartonBreakdown(item.quantity, capacity))
      )
    )
  return row
}

/** Reuse the Orders controller when its source row is hidden by the current filters. */
export function openCartonCapacityEditor({
  item,
  code,
  controller,
  loadPhoto,
}) {
  const dialog = el(
      'dialog',
      undefined,
      'product-details-dialog carton-capacity-dialog'
    ),
    heading = el('header', undefined, 'product-details-heading'),
    title = el('h2', message('Edit Pcs/box in Orders')),
    close = decorateIcon(el('button'), 'close', {
      iconOnly: true,
      label: message('Close'),
    }),
    context = el('div', undefined, 'carton-capacity-context'),
    text = el('div'),
    fieldset = el('fieldset'),
    error = el('p', undefined, 'carton-capacity-error')
  close.type = 'button'
  bindAttribute(dialog, 'aria-label', message('Edit Pcs/box in Orders'))
  heading.append(title, close)
  if (code) {
    const badge = el('code', undefined, 'ce-code')
    setCodeText(badge, code)
    text.append(badge)
  }
  text.append(el('p', item.sellerName), el('p', item.description || item.title))
  context.append(text)
  const photo = item.thumbnail || item.photos?.[0]
  if (photo && loadPhoto) {
    const image = el('img')
    image.alt = ''
    context.prepend(image)
    void (async () => {
      try {
        const url = await loadPhoto(photo)
        if (dialog.isConnected) image.src = url
      } catch {
        image.remove()
      }
    })()
  }
  fieldset.append(el('legend', message('Pcs/box')), controller.control)
  error.setAttribute('role', 'status')
  error.hidden = true
  dialog.append(heading, context, fieldset, error)
  let closing
  const finish = () => {
    if (closing) return closing
    closing = (async () => {
      fieldset.disabled = close.disabled = true
      try {
        await controller.flush()
        dialog.close()
        return true
      } catch (failure) {
        bindText(error, message(failure.message))
        error.hidden = false
        return false
      } finally {
        fieldset.disabled = close.disabled = false
        closing = undefined
        if (dialog.isConnected) controller.input.focus()
      }
    })()
    return closing
  }
  close.addEventListener('click', finish)
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    void finish()
  })
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  document.body.append(dialog)
  dialog.showModal()
  controller.input.focus()
  controller.input.select?.()
  return { dialog, close: finish }
}
