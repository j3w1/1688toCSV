import { element as el } from './ui.js'
import { decorateIcon } from './icons.js'
import {
  bindText,
  getLanguage,
  message as m,
  onLanguageChange,
  t,
} from './i18n.js'
import { popupLanguageToggle } from './popup-language-toggle.js'
import { setCodeText } from './code-display.js'
import { planPackingWorkbook } from './packing-workbook.js'
import { workspaceExportStyle } from './excel-image-style.js'
import {
  packingExportColumns,
  readPackingExportOptions,
  savePackingExportOptions,
  selectedPackingExportColumns,
  normalizePackingExportOptions,
} from './packing-export-options.js'

/** Configure a native editable workbook without allocating its images until Download. */
export async function openPackingExportDialog({
  getRows,
  hasSelection = false,
  onExport,
  loadImage = async (source) => source,
}) {
  const modal = el('dialog', undefined, 'packing-export-dialog'),
    header = el('header', undefined, 'packing-export-header'),
    heading = el('h2', m('Export packing list')),
    close = decorateIcon(el('button'), 'close', {
      iconOnly: true,
      label: m('Close export'),
    }),
    content = el('div', undefined, 'packing-export-content'),
    columns = el('aside', undefined, 'packing-export-columns'),
    searchLabel = el('label', m('Search columns')),
    search = el('input'),
    choices = el('div', undefined, 'packing-export-column-list'),
    actions = el('div', undefined, 'packing-export-column-actions'),
    main = el('section', undefined, 'packing-export-main'),
    controls = el('div', undefined, 'packing-export-controls'),
    preview = el('div', undefined, 'packing-export-preview'),
    note = el(
      'p',
      m(
        'Preview shows the first 5 products. The workbook includes every product in the chosen scope.'
      ),
      'packing-export-note'
    ),
    footer = el('footer', undefined, 'packing-export-footer'),
    status = el('p'),
    download = el('button', m('Download Excel'), 'primary')
  let options = readPackingExportOptions(),
    busy = false,
    storageFailed = false
  const photos = new Map()
  if (!hasSelection) options.scope = 'all'
  const local = (value, params) => t(value, params, getLanguage(modal))
  const columnName = (key) =>
    packingExportColumns.find((column) => column.key === key).labels[
      getLanguage(modal)
    ]
  heading.id = `packing-export-${crypto.randomUUID()}`
  modal.setAttribute('aria-labelledby', heading.id)
  close.type = download.type = 'button'
  download.dataset.action = 'download-packing-list'
  search.type = 'search'
  search.autocomplete = 'off'
  searchLabel.append(search)
  status.setAttribute('role', 'status')
  const languages = popupLanguageToggle(modal)
  header.append(heading, languages, close)
  columns.append(searchLabel, actions, choices)
  main.append(controls, note, preview)
  content.append(columns, main)
  footer.append(status, download)
  modal.append(header, content, footer)

  function persist() {
    storageFailed = !savePackingExportOptions(options)
    render()
  }
  for (const [name, change] of [
    [
      'Select all columns',
      () => {
        options.selected = packingExportColumns.map(({ key }) => key)
      },
    ],
    [
      'Clear columns',
      () => {
        options.selected = []
      },
    ],
    [
      'Restore default columns',
      () => {
        const defaults = normalizePackingExportOptions()
        options.order = defaults.order
        options.selected = defaults.selected
      },
    ],
  ]) {
    const button = el('button', m(name))
    button.type = 'button'
    button.onclick = () => {
      change()
      persist()
    }
    actions.append(button)
  }

  function optionGroup(name, key, values) {
    const group = el('fieldset', undefined, 'packing-export-choice-group')
    group.append(el('legend', m(name)))
    for (const [value, label] of values) {
      const button = el('button', m(label))
      button.type = 'button'
      button.dataset.option = key
      button.dataset.value = value
      button.disabled = key === 'scope' && value === 'selected' && !hasSelection
      button.onclick = () => {
        options[key] = value
        persist()
      }
      group.append(button)
    }
    controls.append(group)
  }
  optionGroup('Products to export', 'scope', [
    ['all', 'All packing products'],
    ['selected', 'Selected products'],
  ])
  optionGroup('Photo size', 'photoSize', [
    ['compact', 'Compact'],
    ['standard', 'Standard'],
    ['large', 'Large'],
  ])
  const widths = el(
      'label',
      m('Description width'),
      'packing-export-description-width'
    ),
    width = el('input'),
    widthValue = el('output')
  width.type = 'range'
  width.min = '24'
  width.max = '60'
  width.step = '4'
  widths.append(width, widthValue)
  width.oninput = () => {
    options.descriptionWidth = Number(width.value)
    persist()
  }
  controls.append(widths)
  const flags = el('div', undefined, 'packing-export-flags')
  for (const [key, title] of [
    ['includeOrderDetails', 'Store and order headings'],
    ['includeTotals', 'Totals row'],
    ['freezeHeaders', 'Freeze headers'],
    ['filters', 'Column filters'],
  ]) {
    const label = el('label', m(title)),
      check = el('input')
    check.type = 'checkbox'
    check.dataset.option = key
    check.onchange = () => {
      options[key] = check.checked
      persist()
    }
    label.prepend(check)
    flags.append(label)
  }
  controls.append(
    flags,
    el(
      'p',
      m('Export colors follow the current workspace theme.'),
      'packing-export-note'
    )
  )
  function renderChoices() {
    const query = search.value.normalize('NFKC').trim().toLowerCase()
    choices.replaceChildren()
    const selected = selectedPackingExportColumns(options)
    for (const key of options.order) {
      const name = columnName(key)
      if (
        query &&
        ![
          name,
          key,
          ...Object.values(
            packingExportColumns.find((column) => column.key === key).labels
          ),
        ]
          .join(' ')
          .normalize('NFKC')
          .toLowerCase()
          .includes(query)
      )
        continue
      const row = el('div', undefined, 'packing-export-column'),
        label = el('label', name),
        check = el('input'),
        moves = el('span', undefined, 'packing-export-moves')
      row.dataset.column = key
      check.type = 'checkbox'
      check.checked = options.selected.includes(key)
      check.value = key
      check.onchange = () => {
        options.selected = check.checked
          ? [...options.selected, key]
          : options.selected.filter((entry) => entry !== key)
        persist()
        choices.querySelector(`input[value="${key}"]`)?.focus()
      }
      label.prepend(check)
      const at = selected.indexOf(key)
      for (const [offset, symbol, title] of [
        [-1, 'previous', 'Move {0} left'],
        [1, 'next', 'Move {0} right'],
      ]) {
        const button = decorateIcon(el('button'), symbol, {
          iconOnly: true,
          label: m(title, { 0: name }),
        })
        button.type = 'button'
        button.disabled =
          at < 0 || at + offset < 0 || at + offset >= selected.length
        button.dataset.offset = offset
        button.onclick = () => {
          const next = [...selected]
          next.splice(at, 1)
          next.splice(at + offset, 0, key)
          options.order = [
            ...next,
            ...options.order.filter((entry) => !next.includes(entry)),
          ]
          persist()
          const move = choices.querySelector(
            `[data-column="${key}"] [data-offset="${offset}"]`
          )
          if (move && !move.disabled) move.focus()
          else choices.querySelector(`input[value="${key}"]`)?.focus()
        }
        moves.append(button)
      }
      row.append(label, moves)
      choices.append(row)
    }
    if (!choices.childNodes.length)
      choices.append(el('p', m('No matching columns.')))
  }
  function exportOptions() {
    return {
      ...options,
      columns: selectedPackingExportColumns(options),
      language: getLanguage(modal),
      style: workspaceExportStyle(),
    }
  }
  function render() {
    for (const button of controls.querySelectorAll('button[data-option]'))
      button.setAttribute(
        'aria-pressed',
        String(options[button.dataset.option] === button.dataset.value)
      )
    for (const input of flags.querySelectorAll('input'))
      input.checked = options[input.dataset.option]
    width.value = options.descriptionWidth
    widthValue.textContent = String(options.descriptionWidth)
    renderChoices()
    preview.replaceChildren()
    const rows = getRows(options.scope),
      selected = selectedPackingExportColumns(options)
    download.disabled = busy || !selected.length || !rows.length
    bindText(
      status,
      m('Products: {0} · Columns: {1}', { 0: rows.length, 1: selected.length })
    )
    status.classList.toggle('storage-warning', storageFailed)
    if (storageFailed)
      bindText(
        status,
        m('Export options are active but could not be saved in this browser.')
      )
    if (!selected.length) {
      preview.append(el('p', m('Select columns to export.')))
      return
    }
    try {
      const plan = planPackingWorkbook(rows, exportOptions()),
        table = el('table'),
        head = el('thead'),
        body = el('tbody'),
        tr = el('tr')
      for (const column of plan.columns)
        tr.append(el('th', column.labels[getLanguage(modal)]))
      head.append(tr)
      for (const row of plan.rows
        .filter((row) => row.kind === 'product')
        .slice(0, 5)) {
        const tr = el('tr')
        row.cells.forEach((cell, index) => {
          const td = el('td'),
            key = plan.columns[index].key
          td.style.maxInlineSize = `${Math.min(420, plan.columns[index].width * 7)}px`
          if (key === 'barcode' && cell.value) {
            const code = el('code', undefined, 'ce-code')
            setCodeText(code, cell.value)
            td.append(code)
          } else if (key === 'photo') {
            const product = rows[body.childElementCount]
            if (product?.thumbnail) {
              const image = el('img')
              image.style.inlineSize =
                image.style.blockSize = `${Math.min(120, plan.photoPixels)}px`
              image.alt = ''
              td.append(image)
              void (async () => {
                try {
                  if (!photos.has(product.thumbnail))
                    photos.set(product.thumbnail, loadImage(product.thumbnail))
                  const loaded = await photos.get(product.thumbnail)
                  if (image.isConnected)
                    image.src =
                      typeof loaded === 'string' ? loaded : loaded.dataUrl
                } catch {
                  image.remove()
                }
              })()
            }
          } else if (
            cell.type === 'number' &&
            cell.value !== '' &&
            Number.isFinite(Number(cell.value)) &&
            Math.abs(Number(cell.value)) <= Number.MAX_SAFE_INTEGER
          ) {
            const weight = /Weight$/.test(key),
              volume = /Volume$/.test(key),
              money =
                /Price$|Amount$/.test(key) ||
                ['orderShipping', 'discount'].includes(key),
              dimension = [
                'cartonLength',
                'cartonWidth',
                'cartonHeight',
              ].includes(key)
            td.textContent =
              new Intl.NumberFormat(getLanguage(modal), {
                minimumFractionDigits: money ? 2 : 0,
                maximumFractionDigits: money
                  ? 2
                  : volume
                    ? 6
                    : weight
                      ? 3
                      : dimension
                        ? 2
                        : 0,
              }).format(Number(cell.value)) +
              (weight
                ? ' kg'
                : volume
                  ? ' m³'
                  : money
                    ? ' CNY'
                    : dimension
                      ? ' cm'
                      : '')
          } else td.textContent = String(cell.value ?? '')
          if (key === 'description') td.style.whiteSpace = 'pre-line'
          if (cell.type === 'number') td.classList.add('numeric')
          tr.append(td)
        })
        body.append(tr)
      }
      table.append(head, body)
      preview.append(table)
    } catch (error) {
      preview.append(el('p', local(error.message)))
      download.disabled = true
    }
  }
  search.oninput = renderChoices
  const stopLanguage = onLanguageChange(render, modal)
  close.onclick = () => {
    if (!busy) modal.close()
  }
  modal.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault()
  })
  download.onclick = async () => {
    if (download.disabled || busy) return
    busy = true
    content.inert = true
    close.disabled = download.disabled = true
    for (const button of languages.children) button.disabled = true
    bindText(status, m('Preparing packing workbook…'))
    try {
      await onExport(getRows(options.scope), exportOptions())
      modal.close('exported')
    } catch (error) {
      bindText(status, m(error.message))
    } finally {
      busy = false
      content.inert = false
      close.disabled = false
      for (const button of languages.children) button.disabled = false
      download.disabled = !selectedPackingExportColumns(options).length
    }
  }
  document.body.append(modal)
  render()
  modal.showModal()
  return new Promise((resolve) => {
    modal.addEventListener(
      'close',
      () => {
        stopLanguage()
        modal.remove()
        resolve(modal.returnValue === 'exported')
      },
      { once: true }
    )
  })
}
