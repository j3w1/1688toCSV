import { excelImageColumns } from './excel-image.js'
import { element } from './ui.js'
import { preparationHelp } from './preparation-help.js'
import { bindText, bindAttribute, message, getLanguage } from './i18n.js'
import {
  EXCEL_IMAGE_SCHEMES,
  normalizeExcelImageDisplay,
} from './excel-image-style.js'

export const EXCEL_IMAGE_PREFERENCE = '1688-excel-image-columns'
const keys = excelImageColumns.map(({ key }) => key)
let sessionPreference
let pendingSessionPreference = false

export function normalizeExcelImagePreference(value) {
  const order = [
    ...new Set(Array.isArray(value?.order) ? value.order : []),
  ].filter((key) => keys.includes(key))
  order.push(...keys.filter((key) => !order.includes(key)))
  const selected = Array.isArray(value?.selected)
    ? [...new Set(value.selected)].filter((key) => keys.includes(key))
    : [...keys]
  return {
    order,
    selected,
    ...normalizeExcelImageDisplay(value),
  }
}

export function readExcelImagePreference(storage = globalThis.localStorage) {
  if (pendingSessionPreference)
    return normalizeExcelImagePreference(sessionPreference)
  try {
    const stored = storage?.getItem(EXCEL_IMAGE_PREFERENCE)
    return normalizeExcelImagePreference(
      stored ? JSON.parse(stored) : sessionPreference
    )
  } catch {
    return normalizeExcelImagePreference(sessionPreference)
  }
}

export function saveExcelImagePreference(
  value,
  storage = globalThis.localStorage
) {
  sessionPreference = normalizeExcelImagePreference(value)
  try {
    storage.setItem(EXCEL_IMAGE_PREFERENCE, JSON.stringify(sessionPreference))
    pendingSessionPreference = false
    return true
  } catch {
    pendingSessionPreference = true
    return false
  }
}

export function selectedExcelImageColumns(
  preference = readExcelImagePreference()
) {
  const { order, selected } = preference
  return order.filter((key) => selected.includes(key))
}

const columnLabel = (column) => column.labels?.[getLanguage()] || column.label

export function createExcelImageOptions(onChange, { rows = [] } = {}) {
  const fieldset = element('fieldset', undefined, 'excel-image-options')
  const identity = element('label', undefined, 'excel-order-details-toggle')
  const showOrderDetails = element('input')
  showOrderDetails.type = 'checkbox'
  identity.append(
    showOrderDetails,
    element('span', message('Show store and order details'))
  )
  preparationHelp(
    identity,
    message(
      'Include the selected order details in the image. Turning this off hides store names, order numbers, dates, status and order tags, while keeping order separators.'
    )
  )
  const details = element('details')
  details.open = matchMedia('(min-width: 701px)').matches
  details.append(element('summary', message('Excel image columns')))
  const help = element(
    'p',
    message(
      'Click columns to include them. Drag to reorder, or use the arrows. Changes are remembered for both views.'
    ),
    'excel-options-help'
  )
  const supplier = element(
    'p',
    message('Supplier details stay blank for your supplier to complete.'),
    'excel-options-help'
  )
  const list = element('ol', undefined, 'excel-column-list')
  const status = element('p', undefined, 'excel-column-status')
  status.setAttribute('role', 'status')
  let preference = readExcelImagePreference()
  let dragged = null
  let saved = true
  const styleDetails = element('details', undefined, 'excel-style-details')
  styleDetails.append(element('summary', message('Style & details')))
  const stylePanel = element('div', undefined, 'excel-style-panel')
  const paletteLabel = element('label', undefined, 'excel-palette-field')
  const palette = element('select')
  bindAttribute(palette, 'aria-label', message('Image color scheme'))
  for (const scheme of EXCEL_IMAGE_SCHEMES) {
    const option = element('option', message(scheme.label))
    option.value = scheme.id
    palette.append(option)
  }
  paletteLabel.append(element('span', message('Color scheme')), palette)
  const accentLabel = element('label', undefined, 'excel-accent-field')
  const accent = element('input')
  accent.type = 'color'
  bindAttribute(accent, 'aria-label', message('Custom image accent'))
  accentLabel.append(element('span', message('Accent')), accent)
  preparationHelp(
    accentLabel,
    message('Choose a header color. Text contrast is adjusted automatically.')
  )
  const colors = element('div', undefined, 'excel-image-colors')
  colors.append(paletteLabel, accentLabel)
  stylePanel.append(colors)
  palette.onchange = () => {
    preference.style.scheme = palette.value
    if (palette.value !== 'custom')
      preference.style.accent = EXCEL_IMAGE_SCHEMES.find(
        (entry) => entry.id === palette.value
      ).accent
    persist()
  }
  accent.oninput = () => {
    preference.style = { scheme: 'custom', accent: accent.value }
    persist()
  }
  const available = {
    seller: rows.some((row) => row.sellerName || row.sellerMemberLogin),
    orderNumber: rows.some((row) => row.orderId),
    date: rows.some((row) => row.orderDate),
    status: rows.some((row) => row.orderStatus),
    orderTags: rows.some((row) => row.orderTags?.length),
    title: rows.some((row) => row.title || row.description),
    specifications: rows.some(
      (row) =>
        row.description ||
        row.skuProperties?.length ||
        row.variantDescription ||
        row.sourceSize
    ),
    model: rows.some((row) => row.productNumber || row.description),
    productTags: rows.some((row) => row.productTags?.length),
  }
  const toggles = []
  for (const [heading, fields] of [
    [
      'Order heading',
      [
        ['seller', 'Store name'],
        ['orderNumber', 'Order number'],
        ['date', 'Purchase date'],
        ['status', 'Order status'],
        ['orderTags', 'Order tags'],
      ],
    ],
    [
      'Product description',
      [
        ['title', 'Original product name'],
        ['specifications', 'Specifications'],
        ['model', 'Article number'],
        ['productTags', 'Product tags'],
      ],
    ],
  ]) {
    const section = element('fieldset', undefined, 'excel-detail-fields')
    section.append(element('legend', message(heading)))
    for (const [key, text] of fields) {
      const label = element('label', undefined, 'excel-detail-toggle')
      const input = element('input')
      input.type = 'checkbox'
      input.dataset.imageDetail = key
      label.append(input, element('span', message(text)))
      input.onchange = () => {
        preference.details[key] = input.checked
        persist()
      }
      const order = heading === 'Order heading'
      const help = () => {
        if (!available[key])
          return message('Not available in the selected products.')
        if (order && !preference.showOrderDetails)
          return message('Enable store and order details first.')
        if (!order && !preference.selected.includes('description'))
          return message('Include the Product description column first.')
        return message(
          'Show this detail in the image. Source values stay unchanged.'
        )
      }
      toggles.push({ input, key, order, label, help })
      section.append(label)
    }
    stylePanel.append(section)
  }
  const resetStyle = element('button', message('Reset style & details'))
  resetStyle.type = 'button'
  resetStyle.onclick = () => {
    preference = { ...preference, ...normalizeExcelImageDisplay() }
    persist()
  }
  const styleFooter = element('div', undefined, 'excel-options-footer')
  styleFooter.append(resetStyle)
  stylePanel.append(styleFooter)
  styleDetails.append(stylePanel)
  showOrderDetails.onchange = () => {
    preference.showOrderDetails = showOrderDetails.checked
    persist()
  }
  function persist() {
    saved = saveExcelImagePreference(preference)
    render()
    onChange()
  }
  function move(key, target) {
    const from = preference.order.indexOf(key)
    if (from === target || target < 0 || target >= preference.order.length)
      return
    preference.order.splice(from, 1)
    preference.order.splice(target, 0, key)
    persist()
  }
  function render() {
    showOrderDetails.checked = preference.showOrderDetails
    palette.value = preference.style.scheme
    accent.value = preference.style.accent
    for (const { input, key, order, label, help } of toggles) {
      input.checked = preference.details[key]
      input.disabled =
        !available[key] ||
        (order
          ? !preference.showOrderDetails
          : !preference.selected.includes('description'))
      preparationHelp(label, help)
    }
    list.replaceChildren()
    for (const [index, key] of preference.order.entries()) {
      const column = excelImageColumns.find((entry) => entry.key === key)
      const row = element('li', undefined, 'excel-column-item')
      row.dataset.column = key
      const handle = element('button', '⠿', 'excel-column-grip')
      handle.type = 'button'
      handle.draggable = true
      bindAttribute(
        handle,
        'aria-label',
        message('Move {0}', { 0: () => columnLabel(column) })
      )
      preparationHelp(
        handle,
        'Drag to change the column order. The arrows also work with a keyboard.'
      )
      handle.ondragstart = (event) => {
        dragged = key
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', key)
      }
      handle.ondragend = () => {
        dragged = null
        list
          .querySelectorAll('.is-drop-target')
          .forEach((item) => item.classList.remove('is-drop-target'))
      }
      row.ondragover = (event) => {
        if (!dragged) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        row.classList.add('is-drop-target')
      }
      row.ondragleave = () => row.classList.remove('is-drop-target')
      row.ondrop = (event) => {
        if (!dragged) return
        event.preventDefault()
        const key = dragged
        dragged = null
        move(key, index)
      }
      const toggle = element('button', undefined, 'excel-column-toggle')
      toggle.type = 'button'
      toggle.setAttribute(
        'aria-pressed',
        String(preference.selected.includes(key))
      )
      const check = element(
        'span',
        preference.selected.includes(key) ? '✓' : '＋',
        'excel-column-check'
      )
      check.setAttribute('aria-hidden', 'true')
      const label = element('span')
      bindText(label, () => columnLabel(column))
      toggle.append(check, label)
      if (column.supplier)
        toggle.append(element('small', message('Supplier details')))
      toggle.onclick = () => {
        preference.selected = preference.selected.includes(key)
          ? preference.selected.filter((value) => value !== key)
          : [...preference.selected, key]
        persist()
        list
          .querySelector(`[data-column="${key}"] .excel-column-toggle`)
          .focus()
      }
      const arrows = element('span', undefined, 'excel-column-moves')
      for (const [offset, glyph, text] of [
        [-1, '↑', 'Move {0} left'],
        [1, '↓', 'Move {0} right'],
      ]) {
        const arrow = element('button', glyph, 'icon-button')
        arrow.type = 'button'
        arrow.dataset.direction = String(offset)
        bindAttribute(
          arrow,
          'aria-label',
          message(text, { 0: () => columnLabel(column) })
        )
        preparationHelp(arrow, message(text, { 0: () => columnLabel(column) }))
        arrow.disabled =
          index + offset < 0 || index + offset >= preference.order.length
        arrow.onclick = () => {
          move(key, index + offset)
          const next = list.querySelector(
            `[data-column="${key}"] [data-direction="${offset}"]`
          )
          if (!next.disabled) next.focus()
          else
            list
              .querySelector(`[data-column="${key}"] .excel-column-toggle`)
              .focus()
        }
        arrows.append(arrow)
      }
      row.append(handle, toggle, arrows)
      list.append(row)
    }
    bindText(
      status,
      !saved
        ? message(
            'Saved for this session only; browser storage is unavailable.'
          )
        : preference.selected.length
          ? message('{0} columns · saved automatically', {
              0: preference.selected.length,
            })
          : message('Select at least one column to copy.')
    )
  }
  const footer = element('div', undefined, 'excel-options-footer')
  const reset = element('button', message('Default columns'))
  reset.onclick = () => {
    const defaults = normalizeExcelImagePreference()
    preference = {
      ...preference,
      order: defaults.order,
      selected: defaults.selected,
    }
    persist()
  }
  footer.append(reset)
  details.append(help, supplier, list, status, footer)
  fieldset.append(identity, styleDetails, details)
  render()
  return fieldset
}
