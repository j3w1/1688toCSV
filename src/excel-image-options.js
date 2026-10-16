import { excelImageColumns } from './excel-image.js'
import { element, enableLightDismiss } from './ui.js'
import { decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'
import { bindText, bindAttribute, message, getLanguage } from './i18n.js'

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
  return { order, selected }
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

export function selectedExcelImageColumns() {
  const { order, selected } = readExcelImagePreference()
  return order.filter((key) => selected.includes(key))
}

const columnLabel = (column) => column.labels?.[getLanguage()] || column.label

export function openExcelImageOptions() {
  const dialog = element('dialog', undefined, 'excel-image-options')
  enableLightDismiss(dialog)
  bindAttribute(dialog, 'aria-label', message('Excel image columns'))
  const heading = element('div', undefined, 'excel-options-heading')
  const close = element('button')
  close.type = 'button'
  decorateIcon(close, 'close', { iconOnly: true, label: 'Close' })
  close.onclick = () => dialog.close()
  heading.append(element('h2', message('Excel image columns')), close)
  const help = element(
    'p',
    message(
      'Click columns to include them. Drag to reorder, or use the arrows. Changes are remembered for both views.'
    ),
    'muted'
  )
  const supplier = element(
    'p',
    message('Supplier details stay blank for your supplier to complete.'),
    'muted'
  )
  const list = element('ol', undefined, 'excel-column-list')
  const status = element('p', undefined, 'excel-column-status')
  status.setAttribute('role', 'status')
  let preference = readExcelImagePreference()
  let dragged = null
  let saved = true
  function persist() {
    saved = saveExcelImagePreference(preference)
    render()
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
    preference = normalizeExcelImagePreference(null)
    persist()
  }
  const done = element('button', message('Done'), 'primary')
  done.onclick = () => dialog.close()
  footer.append(reset, done)
  dialog.append(heading, help, supplier, list, status, footer)
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  render()
  document.body.append(dialog)
  dialog.showModal()
  close.focus()
  return dialog
}

/** A compact adjacent control keeps repeat copies one click, with a shared layout. */
export function mountExcelImageOptions(button) {
  const options = element('button', undefined, 'excel-image-options-trigger')
  options.type = 'button'
  decorateIcon(options, 'columns', {
    iconOnly: true,
    label: 'Excel image columns',
  })
  preparationHelp(
    options,
    'Choose image columns and their order. Your choices apply in Orders and Prepare packing.'
  )
  options.onclick = (event) => {
    event.stopPropagation()
    openExcelImageOptions()
  }
  button.after(options)
  return options
}
