import { element as el } from './ui.js'
import {
  message as m,
  bindAttribute,
  bindText,
  getLanguage,
  t,
} from './i18n.js'
import { cartonVolume } from './carton-details.js'
import { decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'

export function mountCartonDetails(host, { value = {}, onSave, onBusyChange }) {
  const panel = el('section', undefined, 'product-carton-details'),
    heading = el('header', undefined, 'product-carton-heading'),
    title = el('h3', m('Carton details')),
    form = el('form'),
    fields = el('fieldset', undefined, 'product-carton-basics'),
    dimensions = el('fieldset', undefined, 'product-carton-dimensions'),
    dimensionFields = el('div', undefined, 'product-carton-dimension-fields'),
    note = el('p', undefined, 'product-carton-note'),
    footer = el('footer', undefined, 'product-carton-footer'),
    status = el('span', m('Save to apply changes'), 'product-carton-status'),
    save = el('button', m('Save carton details')),
    inputs = {},
    id = `carton-${crypto.randomUUID()}`
  let saving = false
  bindAttribute(panel, 'aria-label', m('Carton details'))
  decorateIcon(title, 'packing')
  heading.append(title, el('span', m('One carton · optional')))
  fields.append(el('legend', m('Measurements for one carton'), 'sr-only'))
  dimensions.append(el('legend', m('Carton · cm')))

  function field(key, label, accessibleLabel, unit) {
    const field = el('div', undefined, 'product-carton-field'),
      caption = el('label', m(label)),
      control = el('div', undefined, 'product-carton-control'),
      input = el('input')
    input.id = `${id}-${key}`
    caption.setAttribute('for', input.id)
    input.name = key
    input.type = 'number'
    input.min = key === 'boxes' ? '1' : '0'
    input.step = key === 'boxes' ? '1' : 'any'
    input.inputMode = key === 'boxes' ? 'numeric' : 'decimal'
    input.value = value[key] ?? ''
    bindAttribute(input, 'aria-label', m(accessibleLabel))
    inputs[key] = input
    control.append(input)
    if (unit) {
      const suffix = el('span', m(unit), 'product-carton-unit')
      suffix.setAttribute('aria-hidden', 'true')
      control.append(suffix)
    }
    field.append(caption, control)
    return { field, control, input }
  }

  const count = field('boxes', 'Cartons', 'Cartons')
  count.control.classList.add('product-carton-stepper')
  for (const [amount, label, glyph] of [
    [-1, 'Decrease cartons', '−'],
    [1, 'Increase cartons', '+'],
  ]) {
    const button = el('button', glyph)
    button.type = 'button'
    bindAttribute(button, 'aria-label', m(label))
    button.addEventListener('click', () => {
      if (saving) return
      if (count.input.value === '' && amount < 0) return
      const current = count.input.value === '' ? 0 : Number(count.input.value)
      if (!Number.isSafeInteger(current) || current < 0) return
      const next = Math.max(1, current + amount)
      if (!Number.isSafeInteger(next)) return
      count.input.value = String(next)
      count.input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    if (amount < 0) count.control.prepend(button)
    else count.control.append(button)
  }
  const weight = field('kg', 'Weight', 'Weight (kg/box)', 'kg/carton'),
    manual = field('cbm', 'Manual volume', 'Volume (m³/box)', 'm³/carton')
  fields.append(count.field, weight.field, manual.field)
  for (const [key, label] of [
    ['len', 'Length'],
    ['wid', 'Width'],
    ['ht', 'Height'],
  ]) {
    if (dimensionFields.childElementCount) {
      const times = el('span', '×', 'product-carton-times')
      times.setAttribute('aria-hidden', 'true')
      dimensionFields.append(times)
    }
    dimensionFields.append(field(key, label, `${label} (cm)`).field)
  }
  note.id = `${id}-dimensions-note`
  for (const key of ['len', 'wid', 'ht'])
    inputs[key].setAttribute('aria-describedby', note.id)
  dimensions.append(dimensionFields, note)

  const preview = el('output', undefined, 'product-carton-volume'),
    volumeLabel = el(
      'span',
      m('Volume per carton'),
      'product-carton-volume-label'
    ),
    volume = el('strong', undefined, 'product-carton-volume-value'),
    volumeSource = el('span', undefined, 'product-carton-volume-source'),
    volumeAmount = el('span', undefined, 'product-carton-volume-amount')
  preview.setAttribute(
    'for',
    ['len', 'wid', 'ht', 'cbm'].map((key) => inputs[key].id).join(' ')
  )
  preview.setAttribute('aria-live', 'polite')
  volumeAmount.append(volume, el('span', 'm³'))
  preview.append(volumeLabel, volumeAmount, volumeSource)
  preparationHelp(
    preview,
    m(
      'Complete centimetre dimensions take priority over the supplied volume. Weight and volume always describe one carton.'
    )
  )
  const getValues = () =>
    Object.fromEntries(
      Object.entries(inputs)
        .filter(([, input]) => input.value !== '')
        .map(([key, input]) => [key, input.value])
    )
  const dimensionValidity = (key) => {
    inputs[key].setCustomValidity(
      inputs[key].value !== '' && Number(inputs[key].value) <= 0
        ? t(
            'Carton dimensions must be greater than zero.',
            {},
            getLanguage(panel)
          )
        : ''
    )
  }
  for (const key of ['len', 'wid', 'ht'])
    inputs[key].addEventListener('invalid', () => dimensionValidity(key))
  const update = () => {
    const values = getValues(),
      keys = ['len', 'wid', 'ht'],
      hasDimensions = keys.some((key) => inputs[key].value !== ''),
      complete = keys.every(
        (key) =>
          Number.isFinite(Number(inputs[key].value)) &&
          Number(inputs[key].value) > 0
      ),
      result = cartonVolume(values)
    for (const key of keys) {
      inputs[key].required = hasDimensions
      dimensionValidity(key)
    }
    volume.textContent = result === '' ? '—' : String(result)
    panel.dataset.volumeSource = complete
      ? 'dimensions'
      : values.cbm !== undefined
        ? 'manual'
        : 'unknown'
    manual.field.dataset.overridden = String(complete)
    bindText(
      volumeSource,
      m(
        complete
          ? 'Calculated from dimensions'
          : values.cbm !== undefined
            ? 'Using manual volume'
            : 'Volume not set'
      )
    )
    bindText(
      note,
      m(
        hasDimensions && !complete
          ? 'Enter all three dimensions, or clear all three.'
          : 'Complete dimensions take priority. Manual volume is kept.'
      )
    )
  }
  form.addEventListener('input', () => {
    if (saving) return
    update()
    panel.dataset.saveState = 'draft'
    bindText(status, m('Not saved yet'))
  })
  status.setAttribute('role', 'status')
  decorateIcon(save, 'check')
  save.type = 'submit'
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (saving) return
    update()
    if (!form.reportValidity()) return
    const submitted = getValues()
    saving = true
    panel.dataset.saveState = 'saving'
    form.setAttribute('aria-busy', 'true')
    fields.disabled = dimensions.disabled = save.disabled = true
    bindText(status, m('Saving…'))
    onBusyChange?.(true)
    try {
      await onSave(submitted)
      panel.dataset.saveState = 'saved'
      bindText(status, m('Saved'))
    } catch (error) {
      panel.dataset.saveState = 'error'
      bindText(
        status,
        m('Not saved: {error}. Your draft is still here.', {
          error: error.message,
        })
      )
    } finally {
      saving = false
      form.setAttribute('aria-busy', 'false')
      fields.disabled = dimensions.disabled = save.disabled = false
      onBusyChange?.(false)
    }
  })
  footer.append(status, save)
  form.append(fields, dimensions, preview, footer)
  panel.append(heading, form)
  host.append(panel)
  update()
  return panel
}
