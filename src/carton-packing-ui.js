import { cartonBreakdown, normalizeUnitsPerCarton } from './carton-packing.js'
import { element as el, copyTextButton } from './ui.js'
import { bindAttribute, bindText, message } from './i18n.js'
import { preparationHelp } from './preparation-help.js'

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
  const label = el('label', message('Pack size'), 'sr-only')
  const input = el('input')
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
      'Units packed inside one full carton. Leave blank if unknown. Saves automatically; leftovers need packing review. This does not change the ordered quantity.'
    )
  )
  control.append(label, input, summary, status)
  host.append(control)
  let saved = value ?? null
  let timer, work
  const parse = () => {
    if (input.validity?.badInput)
      throw new Error('Pack size must be a positive whole number')
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

export function cartonCapacityReadout(item, capacity) {
  const row = el('div', undefined, 'carton-capacity carton-capacity-readout')
  row.append(el('span', message('Pack size')))
  row.append(
    capacity == null
      ? el('span', '—')
      : copyTextButton(String(capacity), {
          label: message('Copy pack size'),
        })
  )
  if (capacity != null)
    row.append(
      el(
        'small',
        cartonBreakdownMessage(cartonBreakdown(item.quantity, capacity))
      )
    )
  return row
}
