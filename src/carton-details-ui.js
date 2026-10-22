import { element as el } from './ui.js'
import { message as m, bindAttribute, bindText } from './i18n.js'
import { cartonDecimal, cartonBatchMetrics } from './carton-batches.js'
import { validateCartonDetails } from './store-order.js'
import { decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'

export { cartonDecimal } from './carton-batches.js'

export function cartonWhole(value, { minimum = 0 } = {}) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (
    !/^\d+$/.test(text) ||
    !Number.isSafeInteger(Number(text)) ||
    Number(text) < minimum
  )
    throw new Error('Carton counts must be whole numbers.')
  return Number(text)
}

/** Paste only an explicit cm tuple; never infer carton dimensions from product sizes. */
export function cartonDimensionTuple(text) {
  const match =
    /^\s*(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(?:cm|厘米)?\s*$/i.exec(
      String(text)
    )
  if (!match) return null
  try {
    return Object.fromEntries(
      ['len', 'wid', 'ht'].map((key, index) => [
        key,
        cartonDecimal(match[index + 1], { positive: true }),
      ])
    )
  } catch {
    return null
  }
}

export function cartonCube() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 80 72')
  svg.setAttribute('class', 'product-carton-cube')
  svg.setAttribute('aria-hidden', 'true')
  for (const [d, opacity] of [
    ['M40 4 73 21 40 39 7 21Z', '0.14'],
    ['M7 21 40 39 40 68 7 50Z', '0.06'],
    ['M40 39 73 21 73 50 40 68Z', '0.23'],
  ]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    path.setAttribute('fill', 'currentColor')
    path.setAttribute('fill-opacity', opacity)
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '1.5')
    svg.append(path)
  }
  return svg
}

/** Native labeled inputs retain keyboard editing alongside the visual shortcuts. */
export function cartonNumberControl({
  key,
  label,
  value = '',
  unit,
  integer = false,
  minimum = 0,
  onInput,
}) {
  const field = el('div', undefined, 'product-carton-field'),
    caption = el('label', m(label)),
    control = el('div', undefined, 'product-carton-control'),
    input = el('input')
  input.id = `carton-${key}-${crypto.randomUUID()}`
  input.name = key
  input.type = 'text'
  input.inputMode = integer ? 'numeric' : 'decimal'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.setAttribute('enterkeyhint', 'done')
  input.setAttribute(
    'pattern',
    integer ? '[0-9]+' : '(?:[0-9]+(?:[.,][0-9]+)?|[.,][0-9]+)'
  )
  input.value = value ?? ''
  caption.setAttribute('for', input.id)
  bindAttribute(input, 'aria-label', m(label))
  bindAttribute(input, 'placeholder', '—')
  control.append(input)
  if (integer) {
    control.classList.add('product-carton-stepper')
    for (const [amount, glyph, name] of [
      [-1, '−', 'Decrease {0}'],
      [1, '+', 'Increase {0}'],
    ]) {
      const button = el('button', glyph)
      button.type = 'button'
      bindAttribute(button, 'aria-label', m(name, { 0: m(label) }))
      button.addEventListener('click', () => {
        if (input.disabled || (input.value === '' && amount < 0)) return
        let current
        try {
          current = cartonWhole(input.value) ?? 0
        } catch {
          return
        }
        const next = Math.max(minimum, current + amount)
        if (!Number.isSafeInteger(next)) return
        input.value = String(next)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      if (amount < 0) control.prepend(button)
      else control.append(button)
    }
  }
  if (unit) {
    const suffix = el('span', m(unit), 'product-carton-unit')
    suffix.setAttribute('aria-hidden', 'true')
    control.append(suffix)
  }
  input.addEventListener('input', () => onInput?.())
  field.append(caption, control)
  return { field, control, input }
}

export function mountCartonDetails(host, { value = {}, onSave, onBusyChange }) {
  const panel = el('section', undefined, 'product-carton-details'),
    heading = el('header', undefined, 'product-carton-heading'),
    title = decorateIcon(el('h3', m('Carton details')), 'packing'),
    form = el('form'),
    fields = el('fieldset', undefined, 'product-carton-basics'),
    dimensions = el('fieldset', undefined, 'product-carton-dimensions'),
    dimensionFields = el('div', undefined, 'product-carton-dimension-fields'),
    geometry = el('div', undefined, 'product-carton-geometry'),
    note = el('p', undefined, 'product-carton-note'),
    footer = el('footer', undefined, 'product-carton-footer'),
    status = el('span', m('Saved automatically'), 'product-carton-status'),
    save = decorateIcon(el('button', m('Save carton details')), 'check'),
    inputs = {}
  let saved = structuredClone(value),
    timer,
    work,
    destroyed = false
  bindAttribute(panel, 'aria-label', m('Carton details'))
  heading.append(title, el('span', m('One carton · cm')))
  fields.append(el('legend', m('Measurements for one carton'), 'sr-only'))
  dimensions.append(el('legend', m('Carton · cm')))
  for (const [key, label, unit, integer] of [
    ['boxes', 'Cartons', '', true],
    ['kg', 'Weight', 'kg/carton', false],
  ]) {
    const entry = cartonNumberControl({
      key,
      label,
      value: value[key],
      unit,
      integer,
      minimum: key === 'boxes' ? 1 : 0,
    })
    inputs[key] = entry.input
    fields.append(entry.field)
  }
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
    const entry = cartonNumberControl({ key, label, value: value[key] })
    inputs[key] = entry.input
    entry.input.addEventListener('paste', (event) => {
      const tuple = cartonDimensionTuple(
        event.clipboardData?.getData('text/plain')
      )
      if (!tuple) return
      event.preventDefault()
      for (const [key, text] of Object.entries(tuple)) inputs[key].value = text
      entry.input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    dimensionFields.append(entry.field)
  }
  note.id = `carton-note-${crypto.randomUUID()}`
  for (const key of ['len', 'wid', 'ht'])
    inputs[key].setAttribute('aria-describedby', note.id)
  dimensions.append(dimensionFields, note)
  geometry.append(cartonCube(), dimensions)
  const preview = el('output', undefined, 'product-carton-volume'),
    volume = el('strong', undefined, 'product-carton-volume-value'),
    volumeSource = el('span', undefined, 'product-carton-volume-source'),
    volumeAmount = el('span', undefined, 'product-carton-volume-amount'),
    supplied = el('p', undefined, 'product-carton-supplied')
  preview.setAttribute(
    'for',
    ['len', 'wid', 'ht'].map((key) => inputs[key].id).join(' ')
  )
  preview.setAttribute('aria-live', 'polite')
  volumeAmount.append(volume, el('span', 'm³'))
  preview.append(
    el('span', m('Volume per carton'), 'product-carton-volume-label'),
    volumeAmount,
    volumeSource
  )
  supplied.hidden = value.cbm === undefined || value.cbm === ''
  if (!supplied.hidden)
    bindText(
      supplied,
      m('Supplied volume: {0} m³ · read-only', { 0: value.cbm })
    )
  preparationHelp(
    preview,
    m(
      'Calculated from carton dimensions. Supplied volume is retained until dimensions are complete.'
    )
  )
  const getValues = () => {
    const next = {}
    if (value.cbm !== undefined && value.cbm !== '') next.cbm = value.cbm
    for (const [key, input] of Object.entries(inputs)) {
      const parsed =
        key === 'boxes'
          ? cartonWhole(input.value, { minimum: 1 })
          : cartonDecimal(input.value, {
              positive: ['len', 'wid', 'ht'].includes(key),
            })
      if (parsed !== '' && parsed !== null) next[key] = String(parsed)
    }
    return validateCartonDetails(next)
  }
  const dirty = () => {
    try {
      return (
        JSON.stringify(getValues()) !==
        JSON.stringify(validateCartonDetails(saved))
      )
    } catch {
      return true
    }
  }
  function update() {
    const keys = ['len', 'wid', 'ht'],
      partial = keys.some((key) => inputs[key].value !== '')
    let complete = true
    for (const [key, input] of Object.entries(inputs)) {
      let error = ''
      try {
        if (key === 'boxes') cartonWhole(input.value, { minimum: 1 })
        else cartonDecimal(input.value, { positive: keys.includes(key) })
      } catch (failure) {
        error = failure.message
      }
      input.setCustomValidity?.(error ? String(m(error)) : '')
      if (error) input.setAttribute('aria-invalid', 'true')
      else input.removeAttribute('aria-invalid')
      if (keys.includes(key)) {
        input.required = partial
        if (!input.value || error) complete = false
      }
    }
    let result = value.cbm ?? ''
    if (complete)
      result = cartonBatchMetrics(
        Object.fromEntries(
          keys.map((key) => [key, cartonDecimal(inputs[key].value)])
        )
      ).volumePerCarton
    volume.textContent = result === '' ? '—' : String(result)
    panel.dataset.volumeSource = complete
      ? 'dimensions'
      : value.cbm !== undefined
        ? 'supplied'
        : 'unknown'
    bindText(
      volumeSource,
      m(
        complete
          ? 'Calculated from dimensions'
          : value.cbm !== undefined
            ? 'Supplied volume'
            : 'Volume not set'
      )
    )
    bindText(
      note,
      m(
        partial && !complete
          ? 'Enter all three dimensions, or clear all three.'
          : 'Paste L × W × H, or enter centimetres.'
      )
    )
  }
  const failure = (error) => {
    panel.dataset.saveState = 'error'
    bindText(
      status,
      m('Not saved: {error}. Your draft is still here.', {
        error: m(error.message),
      })
    )
  }
  async function flush() {
    clearTimeout(timer)
    if (destroyed) return
    if (work) {
      await work
      return flush()
    }
    if (!dirty() || !onSave) return
    let submitted
    try {
      submitted = getValues()
    } catch (error) {
      failure(error)
      throw error
    }
    update()
    panel.dataset.saveState = 'saving'
    form.setAttribute('aria-busy', 'true')
    save.disabled = true
    bindText(status, m('Saving…'))
    onBusyChange?.(true)
    work = (async () => {
      await onSave(submitted)
    })()
    try {
      await work
      saved = submitted
      panel.dataset.saveState = 'saved'
      bindText(status, m('Saved'))
    } catch (error) {
      failure(error)
      throw error
    } finally {
      work = undefined
      save.disabled = false
      form.setAttribute('aria-busy', 'false')
      onBusyChange?.(false)
    }
    if (dirty()) return flush()
  }
  form.addEventListener('input', () => {
    update()
    panel.dataset.saveState = 'draft'
    bindText(status, m('Not saved yet'))
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!panel.isConnected) return
      try {
        getValues()
      } catch {
        return
      }
      void flush().catch(() => {})
    }, 450)
  })
  form.addEventListener('focusout', () => {
    try {
      getValues()
    } catch {
      return
    }
    void flush().catch(() => {})
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    update()
    if (form.reportValidity?.() === false) return
    void flush().catch(() => {})
  })
  status.setAttribute('role', 'status')
  save.type = 'submit'
  footer.append(status, save)
  form.append(fields, geometry, preview, supplied, footer)
  panel.append(heading, form)
  host.append(panel)
  panel.flush = flush
  panel.dirty = dirty
  panel.destroy = () => {
    destroyed = true
    clearTimeout(timer)
  }
  update()
  return panel
}
