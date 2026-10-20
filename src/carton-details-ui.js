import { element as el } from './ui.js'
import { message as m, bindText } from './i18n.js'
import { cartonVolume } from './carton-details.js'
import { preparationHelp } from './preparation-help.js'

export function mountCartonDetails(host, { value = {}, onSave }) {
  const panel = el('details', undefined, 'product-carton-details'),
    title = el('summary', m('Carton details')),
    form = el('form'),
    fields = el('fieldset'),
    status = el('p', undefined, 'product-carton-status'),
    save = el('button', m('Save carton details')),
    inputs = {}
  fields.append(el('legend', m('Measurements for one carton')))
  for (const [key, label, step] of [
    ['boxes', 'Cartons', '1'],
    ['kg', 'Weight (kg/box)', 'any'],
    ['cbm', 'Volume (m³/box)', 'any'],
    ['len', 'Length (cm)', 'any'],
    ['wid', 'Width (cm)', 'any'],
    ['ht', 'Height (cm)', 'any'],
  ]) {
    const field = el('label', m(label)),
      input = el('input')
    input.name = key
    input.type = 'number'
    input.min = key === 'boxes' ? '1' : '0'
    input.step = step
    input.value = value[key] ?? ''
    inputs[key] = input
    field.append(input)
    fields.append(field)
  }
  const getValues = () =>
    Object.fromEntries(
      Object.entries(inputs)
        .filter(([, input]) => input.value !== '')
        .map(([key, input]) => [key, input.value])
    )
  const preview = el('output')
  const update = () => {
    const volume = cartonVolume(getValues())
    bindText(preview, m('Volume per carton: {0} m³', { 0: volume || '—' }))
  }
  form.addEventListener('input', update)
  status.setAttribute('role', 'status')
  preparationHelp(
    preview,
    m(
      'Complete centimetre dimensions take priority over the supplied volume. Weight and volume always describe one carton.'
    )
  )
  save.type = 'submit'
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!form.reportValidity()) return
    save.disabled = true
    try {
      await onSave(getValues())
      bindText(status, m('Saved'))
    } catch (error) {
      bindText(status, m(error.message))
    } finally {
      save.disabled = false
    }
  })
  form.append(fields, preview, save, status)
  panel.append(title, form)
  host.append(panel)
  update()
  return panel
}
