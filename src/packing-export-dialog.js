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
import { createPackingWorkbookImages } from './packing-workbook-images.js'
import { preparationHelp } from './preparation-help.js'
import {
  packingExportColumns,
  packingCartonExportColumns,
  readPackingExportOptions,
  savePackingExportOptions,
  selectedPackingExportColumns,
  normalizePackingExportOptions,
} from './packing-export-options.js'

/** Configure an editable workbook with small preview assets for five products. */
export async function openPackingExportDialog({
  context,
  planWorkbook = planPackingWorkbook,
  getRows,
  getCartonBatches = () => [],
  hasSelection = false,
  onExport,
  loadImage = async (source) => source,
  renderCartonMark,
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
    sheets = el('fieldset', undefined, 'packing-export-sheet-tabs'),
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
    activeSheet = 'products',
    busy = false,
    storageFailed = false
  const prepareImages = createPackingWorkbookImages(loadImage, renderCartonMark)
  const imageUrls = new Set()
  let previewVersion = 0
  function clearPreviewImages() {
    previewVersion++
    for (const url of imageUrls) URL.revokeObjectURL(url)
    imageUrls.clear()
  }
  const containerOutput = context?.kind === 'container-revision'
  if (!hasSelection || containerOutput) options.scope = 'all'
  // Detailed JSON requires a fresh deliberate choice for every export.
  options.includeAutomationJson = false
  const local = (value, params) => t(value, params, getLanguage(modal))
  const availableColumns = () =>
    activeSheet === 'cartons'
      ? packingCartonExportColumns
      : packingExportColumns
  const sheetOptions = () =>
    activeSheet === 'cartons' ? options.cartons : options
  const columnName = (key) =>
    availableColumns().find((column) => column.key === key).labels[
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
  sheets.append(el('legend', m('Worksheet')))
  for (const [value, title] of [
    ['products', containerOutput ? 'Packing list' : 'Products'],
    ['cartons', 'Cartons'],
    ...(containerOutput ? [['left-behind', 'Se quedó']] : []),
  ]) {
    const label = el('label', m(title)),
      radio = el('input')
    radio.type = 'radio'
    radio.name = `packing-sheet-${heading.id}`
    radio.value = value
    radio.checked = value === activeSheet
    radio.onchange = () => {
      if (!radio.checked) return
      activeSheet = value
      search.value = ''
      render()
    }
    label.prepend(radio)
    sheets.append(label)
  }
  columns.append(sheets, searchLabel, actions, choices)
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
        sheetOptions().selected = availableColumns().map(({ key }) => key)
      },
    ],
    [
      'Clear columns',
      () => {
        sheetOptions().selected = []
      },
    ],
    [
      'Restore default columns',
      () => {
        const defaults = normalizePackingExportOptions()
        const restored = activeSheet === 'cartons' ? defaults.cartons : defaults
        sheetOptions().order = restored.order
        sheetOptions().selected = restored.selected
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
  if (!containerOutput)
    optionGroup('Products to export', 'scope', [
      ['all', 'All packing products'],
      ['selected', 'Selected products'],
    ])
  else {
    const identity = el('p', undefined, 'container-export-identity')
    bindText(
      identity,
      m('{0} · {1} · {2}', {
        0: context.container.name,
        1: context.containerId,
        2: context.draft
          ? m('Draft revision {0}', { 0: context.revision })
          : context.revisionId,
      })
    )
    controls.append(
      identity,
      el(
        'p',
        m(
          context.draft
            ? 'DRAFT — unsealed container'
            : 'Sealed container revision'
        )
      )
    )
    bindText(
      note,
      m(
        'Exports include the complete loaded container revision, regardless of selected or filtered rows.'
      )
    )
  }
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
  const flags = el('div', undefined, 'packing-export-flags'),
    automationHelp = el(
      'p',
      m(
        'Optional JSON includes full costs, charge reasons and source identifiers for the chosen products and related cartons, regardless of Excel columns.'
      ),
      'packing-export-note'
    )
  automationHelp.id = `${heading.id}-automation-help`
  if (containerOutput)
    bindText(
      automationHelp,
      m(
        'Optional JSON includes full costs, charge reasons and source identifiers for this complete container revision, regardless of Excel columns.'
      )
    )
  for (const [key, title] of [
    ['includeOrderDetails', 'Store and order headings'],
    ['includeTotals', 'Totals row'],
    ['freezeHeaders', 'Freeze headers'],
    ['filters', 'Column filters'],
    ['includeAutomationJson', 'Include detailed automation JSON'],
  ]) {
    const label = el('label', m(title)),
      check = el('input')
    check.type = 'checkbox'
    check.id = `${heading.id}-${key}`
    check.name = key
    label.htmlFor = check.id
    if (key === 'includeAutomationJson')
      check.setAttribute('aria-describedby', automationHelp.id)
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
    automationHelp,
    el(
      'p',
      m('Excel exports use the current theme in light mode.'),
      'packing-export-note'
    )
  )
  function renderChoices() {
    const query = search.value.normalize('NFKC').trim().toLowerCase()
    choices.replaceChildren()
    const selected = selectedPackingExportColumns(options, activeSheet),
      current = sheetOptions()
    for (const key of current.order) {
      const name = columnName(key)
      if (
        query &&
        ![
          name,
          key,
          ...Object.values(
            availableColumns().find((column) => column.key === key).labels
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
      check.checked = current.selected.includes(key)
      check.value = key
      check.onchange = () => {
        current.selected = check.checked
          ? [...current.selected, key]
          : current.selected.filter((entry) => entry !== key)
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
          current.order = [
            ...next,
            ...current.order.filter((entry) => !next.includes(entry)),
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
      cartonColumns: selectedPackingExportColumns(options, 'cartons'),
      cartonBatches: getCartonBatches(options.scope),
      language: getLanguage(modal),
      style: workspaceExportStyle(),
      ...(containerOutput
        ? {
            containerId: context.containerId,
            revisionId: context.revisionId,
            draft: context.draft,
            scope: 'all',
          }
        : {}),
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
    clearPreviewImages()
    preview.replaceChildren()
    const rows = getRows(options.scope),
      selected = selectedPackingExportColumns(options, activeSheet),
      ready =
        selectedPackingExportColumns(options).length &&
        selectedPackingExportColumns(options, 'cartons').length
    download.disabled = busy || !ready || (!containerOutput && !rows.length)
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
      const workbook = planWorkbook(rows, exportOptions()),
        plan =
          workbook.sheets[
            activeSheet === 'cartons'
              ? 1
              : activeSheet === 'left-behind'
                ? 2
                : 0
          ],
        table = el('table'),
        columnSizes = el('colgroup'),
        head = el('thead'),
        body = el('tbody'),
        tr = el('tr')
      tr.className = 'packing-export-headings'
      for (const [key, value] of Object.entries(plan.palette))
        preview.style.setProperty(`--packing-export-${key}`, value)
      for (const column of plan.columns) {
        const col = el('col')
        col.style.inlineSize = `${column.pixelWidth}px`
        columnSizes.append(col)
        const th = el('th', column.labels[getLanguage(modal)])
        th.scope = 'col'
        if (column.boxStage) {
          th.dataset.boxStage = column.boxStage
          th.style.background = column.stageHeader
          th.style.color = plan.palette.headerText
        }
        tr.append(th)
      }
      table.style.inlineSize = `${plan.columns.reduce((total, column) => total + column.pixelWidth, 0)}px`
      head.append(tr)
      bindText(
        note,
        containerOutput
          ? m(
              'Exports include the complete loaded container revision, regardless of selected or filtered rows.'
            )
          : activeSheet === 'cartons'
            ? m(
                'Carton totals include complete batches only. Shared context is marked and excluded from totals.'
              )
            : m(
                'Preview shows the first 5 products. The workbook includes every product in the chosen scope.'
              )
      )
      for (const row of plan.rows
        .filter((row) => ['product', 'carton', 'context'].includes(row.kind))
        .slice(0, 5)) {
        const tr = el('tr')
        if (row.kind === 'context') {
          tr.className = 'packing-export-context'
          preparationHelp(tr, m('Shared context — excluded from totals'))
        }
        const source = plan.products.find(
          (product) => product.row === row.number
        )?.source
        tr.style.blockSize = `${row.height / 0.75}px`
        row.cells.forEach((cell, index) => {
          const td = el('td'),
            key = plan.columns[index].key,
            content = el('div', undefined, 'packing-export-value')
          td.dataset.column = key
          if (plan.columns[index].boxStage) {
            td.dataset.boxStage = plan.columns[index].boxStage
            td.style.background = plan.columns[index].stageBackground
          }
          content.style.maxBlockSize = `${row.height / 0.75 - 12}px`
          if (key === 'barcode' && cell.value) {
            const code = el('code', undefined, 'ce-code')
            setCodeText(code, cell.value)
            content.append(code)
          } else if (key === 'photo' || key === 'cartonMark') {
            if (key === 'cartonMark' && !source?.chineseCategory?.trim()) {
              content.textContent = '—'
              preparationHelp(
                td,
                m(
                  'Add a Chinese category in Preparation to generate a carton mark.'
                )
              )
              td.append(content)
            }
          } else if (
            cell.type === 'number' &&
            cell.value !== '' &&
            Number.isFinite(Number(cell.value)) &&
            Math.abs(Number(cell.value)) <= Number.MAX_SAFE_INTEGER
          ) {
            const weight = /Weight$/.test(key) || key === 'weight',
              volume = /Volume$/.test(key) || key === 'volumePerCarton',
              money =
                /Price$|Amount$/.test(key) ||
                ['orderShipping', 'discount'].includes(key),
              dimension =
                ['cartonLength', 'cartonWidth', 'cartonHeight'].includes(key) ||
                ['len', 'wid', 'ht'].includes(key)
            content.textContent =
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
                    ? ' 元'
                    : dimension
                      ? ' cm'
                      : key === 'unitsPerCarton'
                        ? { en: '/box', es: '/ctn', zh: '/箱' }[
                            getLanguage(modal)
                          ] || '/box'
                        : '')
          } else content.textContent = String(cell.value ?? '')
          if (key === 'description') {
            content.style.whiteSpace = 'pre-line'
            td.style.textAlign =
              source?.sourceType === 'spreadsheet' ? 'center' : 'start'
            preparationHelp(td, () => String(cell.value ?? ''))
          }
          if (cell.type === 'number') td.classList.add('numeric')
          if (!['photo', 'cartonMark'].includes(key)) td.append(content)
          tr.append(td)
        })
        body.append(tr)
      }
      table.append(columnSizes, head, body)
      preview.append(table)
      const version = previewVersion
      void (async () => {
        const limits = {
          ...(selected.includes('photo')
            ? { photo: { maxWidth: 320, maxHeight: 240 } }
            : {}),
          ...(selected.includes('cartonMark')
            ? { mark: { maxWidth: 320, maxHeight: 240 } }
            : {}),
        }
        for (const [index, product] of plan.products.slice(0, 5).entries()) {
          if (version !== previewVersion) return
          try {
            const assets = await prepareImages(product.source, limits)
            if (version !== previewVersion) return
            for (const [column, asset] of [
              ['photo', assets.photo],
              ['cartonMark', assets.mark],
            ]) {
              if (!asset) continue
              const cell = body.children[index]?.querySelector(
                `td[data-column="${column}"]`
              )
              if (!cell) continue
              const image = el('img')
              image.alt = ''
              image.src = URL.createObjectURL(asset.bytes)
              imageUrls.add(image.src)
              cell.replaceChildren(image)
            }
          } catch (error) {
            if (version !== previewVersion) return
            bindText(status, m(error.message))
            download.disabled = true
            return
          }
        }
      })()
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
      download.disabled =
        !selectedPackingExportColumns(options).length ||
        !selectedPackingExportColumns(options, 'cartons').length
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
        clearPreviewImages()
        modal.remove()
        resolve(modal.returnValue === 'exported')
      },
      { once: true }
    )
  })
}
