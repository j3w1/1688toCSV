import { normalizeCartonMeasurement } from './carton-details.js'
import { element as el } from './ui.js'
import { bindAttribute, bindText, message as m } from './i18n.js'
import { preparationHelp } from './preparation-help.js'

/** Quiet inline editors share one validation/save path in both tables. */
export function mountCartonMeasurement(host, { field, value, onSave }) {
  return mountCartonNumber(host, {
    field,
    value,
    onSave,
    normalize: (value) => normalizeCartonMeasurement(value, field),
    label: field === 'kg' ? 'Weight (kg/box)' : 'Volume (m³/box)',
    unit: field === 'kg' ? 'kg' : 'm³',
    help:
      field === 'kg'
        ? 'Weight of one carton in kg. Leave blank if unknown. Decimals may use a dot or comma. Saves automatically.'
        : 'Volume of one carton in m³. Leave blank if unknown. Decimals may use a dot or comma. Saves automatically.',
  })
}

/** A shared commit path retains pending numeric drafts during virtual scrolling. */
export function mountCartonNumber(
  host,
  {
    field,
    value,
    onSave,
    normalize,
    label: labelText,
    help,
    unit: unitText = '',
    inputMode = 'decimal',
    pattern = '(?:[0-9]+(?:[.,][0-9]+)?|[.,][0-9]+)',
  }
) {
  let saved = normalize(value)
  const control = el('div', undefined, 'carton-measurement'),
    input = el('input'),
    unit = el('span', unitText, 'carton-measurement-unit'),
    label = el('label', m(labelText), 'sr-only'),
    status = el('span', undefined, 'carton-measurement-status sr-only')
  control.dataset.field = field
  input.type = 'text'
  input.inputMode = inputMode
  input.autocomplete = 'off'
  input.spellcheck = false
  input.setAttribute('enterkeyhint', 'done')
  input.setAttribute('pattern', pattern)
  input.id = `carton-${field}-${crypto.randomUUID()}`
  input.value = saved
  unit.setAttribute('aria-hidden', 'true')
  const updateUnit = () => {
    try {
      unit.hidden = !unitText || normalize(input.value) === ''
    } catch {
      unit.hidden = true
    }
  }
  updateUnit()
  bindAttribute(input, 'placeholder', '—')
  label.htmlFor = input.id
  status.id = `${input.id}-status`
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  input.setAttribute('aria-describedby', status.id)
  preparationHelp(input, m(help))
  control.append(label, input, unit, status)
  host.append(control)
  let timer, work
  const parse = () => {
    // Never turn a browser's bad input state into an explicit blank clear.
    if (input.validity?.badInput) return normalize('!')
    return normalize(input.value)
  }
  const dirty = () => {
    try {
      return parse() !== saved
    } catch {
      return true
    }
  }
  const failure = (error) => {
    input.setAttribute('aria-invalid', 'true')
    control.dataset.state = 'error'
    bindText(status, m(error.message))
  }
  const flush = async () => {
    clearTimeout(timer)
    if (work) {
      await work
      return flush()
    }
    if (!dirty()) {
      // A formatting-only edit still settles to the canonical display on commit.
      input.value = saved
      updateUnit()
      return
    }
    let next
    try {
      next = parse()
    } catch (error) {
      failure(error)
      throw error
    }
    input.removeAttribute('aria-invalid')
    control.dataset.state = 'saving'
    bindText(status, m('Saving…'))
    // The async wrapper also captures synchronous repository failures.
    work = (async () => {
      await onSave(next)
    })()
    try {
      await work
      saved = next
      // Preserve anything typed during persistence; flush it next instead.
      if (!dirty()) input.value = saved
      updateUnit()
      control.dataset.state = 'saved'
      bindText(status, m('Saved'))
    } catch (error) {
      failure(error)
      throw error
    } finally {
      work = undefined
    }
    if (dirty()) return flush()
  }
  input.addEventListener('input', () => {
    updateUnit()
    input.removeAttribute('aria-invalid')
    delete control.dataset.state
    bindText(status, '')
    clearTimeout(timer)
    timer = setTimeout(() => {
      // Incomplete decimal drafts stay quiet until blur, Enter or a form flush.
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
  return {
    control,
    input,
    flush,
    dirty,
    update(next) {
      if (dirty() || work) return false
      saved = normalize(next.value)
      input.value = saved
      updateUnit()
      return true
    },
  }
}
