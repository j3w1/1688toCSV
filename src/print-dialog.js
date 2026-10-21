import {
  message as uiMessage,
  bindText,
  bindAttribute,
  getLocale,
  getLanguage,
  onLanguageChange,
} from './i18n.js'
import { popupLanguageToggle } from './popup-language-toggle.js'
import { embedPdfCaptions } from './print-captions.js'
import { printText } from './print-language.js'
import { element as el, enableLightDismiss, pinDialogActions } from './ui.js'
import { renderLabel } from './labels.js'
import { preparationHelp } from './preparation-help.js'
import { cartonBreakdownMessage } from './carton-packing-ui.js'
import { enableImageNavigation } from './image-copy-dialog.js'
import {
  A4,
  SAFE_EDGE_MM,
  OFFSET_LIMIT_MM,
  DEFAULT_PRESET,
  labelGrid,
  planLabels,
  planCartonMarks,
  cartonSlots,
  normalizeLabelLayout,
  normalizeMarkLayout,
  labelPageOps,
  markPageOps,
  calibrationOps,
  contentBoxes,
  edgeClearance,
  drawOps,
  numberingFits,
} from './print-layout.js'
import { createPdf, rgbImage } from './pdf-writer.js'
import { canvasPage } from './print-canvas.js'
import { createPrintStore } from './print-store.js'
import { saveFile, announceExport, uniqueFileName } from './save-file.js'
import {
  printSummary,
  summaryFileName,
  printFileName,
} from './export-summary.js'

/** Labels are rendered at 600 dpi inside the PDF; the preview uses 150 dpi. */
const PDF_DPI = 600
const PREVIEW_DPI = 150
const PREVIEW_PX_PER_MM = PREVIEW_DPI / 25.4

/** File names such as CE-labels-2026-10-19-153012-3-products.pdf. */
export { printFileName }

const savePdf = (bytes, filename) =>
  saveFile(new Blob([bytes], { type: 'application/pdf' }), filename)

async function decode(blob) {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(bitmap, 0, 0)
    return {
      bitmap,
      pixels: context.getImageData(0, 0, canvas.width, canvas.height),
    }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

function field(label, input, help) {
  const wrapper = el('label', undefined, 'print-field')
  wrapper.append(el('span', uiMessage(label)), input)
  if (help) preparationHelp(wrapper, uiMessage(help))
  return wrapper
}
function numberInput(value, { min, max, step = 0.5 }) {
  const input = el('input')
  input.type = 'number'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  return input
}
function check(label, checked, help) {
  const input = el('input')
  input.type = 'checkbox'
  input.checked = checked
  const wrapper = el('label', undefined, 'print-check')
  wrapper.append(input, el('span', uiMessage(label)))
  if (help) preparationHelp(wrapper, uiMessage(help))
  return { wrapper, input }
}
function choice(name, options, current) {
  const group = el('div', undefined, 'print-choice')
  group.setAttribute('role', 'radiogroup')
  const inputs = options.map(([value, label, help]) => {
    const input = el('input')
    input.type = 'radio'
    input.name = name
    input.value = value
    input.checked = value === current
    const wrapper = el('label', undefined, 'print-check')
    wrapper.append(input, el('span', uiMessage(label)))
    if (help) preparationHelp(wrapper, uiMessage(help))
    group.append(wrapper)
    return input
  })
  return { group, value: () => inputs.find((input) => input.checked)?.value }
}

const formatDate = (iso, scope) =>
  new Date(iso).toLocaleString(getLocale(scope), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

/**
 * Print labels or carton marks for the selected products on A4 pages.
 * `items`: [{ key, code, name, detail, quantity, known?, cap?, model }], one
 * per distinct label. `problems`: products the label validation refused.
 * `job`: a recent job being regenerated, with its `missing` products.
 */
export function openPrintDialog({
  kind,
  items,
  problems = [],
  settings,
  logoUrl,
  job = null,
  store = createPrintStore(),
}) {
  const marks = kind === 'marks'
  const quantityStep = marks ? 1 : 5
  const normalize = marks ? normalizeMarkLayout : normalizeLabelLayout
  let layout = normalize(job?.layout ?? store.layout(kind))
  const quantities = new Map(items.map((item) => [item.key, item.quantity]))
  const caps = new Map(items.map((item) => [item.key, item.cap ?? '']))
  const labelSize = settings[marks ? 'mark' : 'barcode']
  let page = 0

  const title = marks ? 'Print carton marks' : 'Print labels'
  const dialog = el('dialog', undefined, 'print-dialog packing-review')
  bindAttribute(dialog, 'aria-label', uiMessage(title))
  const heading = el('h2', uiMessage(title))
  const cancel = el('button', uiMessage('Cancel'))
  cancel.dataset.action = 'close-print-dialog'
  const exportButton = el('button', uiMessage('Export PDF'), 'primary')
  exportButton.dataset.action = 'export-pdf'
  preparationHelp(
    exportButton,
    uiMessage(
      'Save every preview page as an A4 PDF, plus a JSON summary. Print the PDF at 100% (Actual size).'
    )
  )
  preparationHelp(
    cancel,
    uiMessage('Close this dialog. Paper and sheet settings are remembered.')
  )
  const actions = el('div', undefined, 'dialog-actions')
  const languages = popupLanguageToggle(dialog, { language: job?.language })
  actions.append(languages, cancel, exportButton)
  dialog.append(heading, actions)
  const body = pinDialogActions(dialog, actions)

  const left = el('div', undefined, 'print-left')
  left.append(
    el(
      'p',
      uiMessage(
        'Language also applies to PDF captions and carton numbers. Codes and saved label text stay unchanged.'
      ),
      'print-hint'
    )
  )
  if (job) {
    const note = el('p', undefined, 'print-note')
    bindText(
      note,
      uiMessage(
        'Regenerated from the print job of {0}. Product data may have changed since; check the preview before printing.',
        { 0: () => formatDate(job.date, dialog) }
      )
    )
    left.append(note)
  }
  const summary = el('p', undefined, 'print-summary')
  summary.setAttribute('role', 'status')
  const warnings = el('ul', undefined, 'print-warnings')
  warnings.setAttribute('aria-live', 'polite')
  const table = el('table', undefined, 'print-counts')
  table.classList.toggle('print-counts-marks', marks)
  const settingsPane = el('div', undefined, 'print-settings')
  const advice = el(
    'p',
    uiMessage('Print at 100% (Actual size).'),
    'print-advice'
  )
  const status = el('p', undefined, 'print-status')
  status.setAttribute('role', 'status')
  const tableScroll = el('div', undefined, 'print-table-scroll')
  tableScroll.append(table)
  const quantitySection = el('div', undefined, 'print-quantity-section')
  const toolbar = el('div', undefined, 'print-quantity-toolbar')
  toolbar.setAttribute('role', 'group')
  bindAttribute(
    toolbar,
    'aria-label',
    uiMessage('Adjust all requested quantities')
  )
  const quantityHeading = el('div', undefined, 'print-quantity-heading')
  const quantityPreview = el('output', undefined, 'print-quantity-preview')
  quantityPreview.setAttribute('aria-live', 'polite')
  quantityHeading.append(
    el('strong', uiMessage('Adjust quantities')),
    quantityPreview
  )
  const quantityControls = el('div', undefined, 'print-quantity-actions')
  const quantityOperation = el('select')
  bindAttribute(quantityOperation, 'aria-label', uiMessage('Operation'))
  for (const [value, text] of [
    ['multiply', '× Multiply'],
    ['divide', '÷ Divide'],
  ]) {
    const option = el('option', uiMessage(text))
    option.value = value
    quantityOperation.append(option)
  }
  const quantityFactor = numberInput(2, { min: 1, max: 9999, step: 1 })
  bindAttribute(quantityFactor, 'aria-label', uiMessage('Factor'))
  const applyQuantities = el(
    'button',
    undefined,
    'print-quantity-apply primary'
  )
  applyQuantities.type = 'button'
  applyQuantities.dataset.action = 'apply-print-quantities'
  bindAttribute(applyQuantities, 'aria-label', uiMessage('Apply to all'))
  const arrow = el('span', '✓', 'print-quantity-apply-icon')
  arrow.setAttribute('aria-hidden', 'true')
  applyQuantities.append(arrow)
  preparationHelp(
    applyQuantities,
    uiMessage(
      'Apply the chosen operation to every requested quantity below. Only this print dialog changes; packing quantities and extra-copy limits stay unchanged.'
    )
  )
  quantityControls.append(
    field(
      'Operation',
      quantityOperation,
      'Multiply increases requested quantities; Divide reduces them, rounding up to whole copies. Zero stays zero.'
    ),
    field(
      'Factor',
      quantityFactor,
      'Enter a whole number from 1 to 9999. For example, multiply by 3 for three copies per requested item, or divide by 2 to halve the quantities.'
    ),
    applyQuantities
  )
  toolbar.append(quantityHeading, quantityControls)
  const quantityReason = el('p', undefined, 'print-hint print-quantity-reason')
  quantityReason.setAttribute('role', 'status')
  quantitySection.append(toolbar, quantityReason)
  quantitySection.append(tableScroll)
  left.append(summary, warnings, quantitySection, settingsPane, advice, status)

  const pageLabel = el('span', undefined, 'print-page-label')
  const previous = el('button', undefined, 'icon-button print-page-previous')
  previous.textContent = '‹'
  bindAttribute(previous, 'aria-label', uiMessage('Previous page'))
  bindAttribute(previous, 'title', uiMessage('Previous page'))
  preparationHelp(
    previous,
    uiMessage('View the previous A4 page. All pages are included in the PDF.')
  )
  const next = el('button', undefined, 'icon-button print-page-next')
  next.textContent = '›'
  bindAttribute(next, 'aria-label', uiMessage('Next page'))
  bindAttribute(next, 'title', uiMessage('Next page'))
  preparationHelp(
    next,
    uiMessage('View the next A4 page. All pages are included in the PDF.')
  )
  const pager = el('div', undefined, 'print-pager')
  pager.append(previous, pageLabel, next)
  const pageContents = el('p', undefined, 'print-page-contents')
  const preview = el('canvas', undefined, 'print-preview')
  preview.width = Math.round(A4.widthMm * PREVIEW_PX_PER_MM)
  preview.height = Math.round(A4.heightMm * PREVIEW_PX_PER_MM)
  preview.setAttribute('role', 'img')
  bindAttribute(
    preview,
    'aria-label',
    uiMessage('Page {0} preview', { 0: () => page + 1 })
  )
  const previewStatus = el('p', undefined, 'print-status')
  previewStatus.setAttribute('role', 'status')
  const previewPane = el('div', undefined, 'print-preview-pane')
  const previewTools = el('div', undefined, 'print-preview-tools')
  const previewViewport = el('div', undefined, 'print-preview-viewport')
  const previewFigure = el('figure', undefined, 'print-preview-figure')
  const previewPan = el('button', undefined, 'print-preview-pan')
  previewPan.type = 'button'
  previewPan.dataset.action = 'print-preview'
  bindAttribute(
    previewPan,
    'aria-label',
    uiMessage('Page {0} preview', { 0: () => page + 1 })
  )
  previewPan.append(preview)
  // Preview-only guides make even small changes to the minimum margin visible.
  // They are DOM overlays, so neither canvas artwork nor the PDF includes them.
  const safeArea = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  safeArea.classList.add('print-safe-area')
  safeArea.setAttribute('viewBox', `0 0 ${A4.widthMm} ${A4.heightMm}`)
  safeArea.setAttribute('aria-hidden', 'true')
  const safeRects = Array.from({ length: marks ? 2 : 1 }, () => {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    safeArea.append(rect)
    return rect
  })
  previewPan.append(safeArea)
  previewFigure.append(previewPan)
  previewViewport.append(previewFigure)
  previewPane.append(
    pager,
    pageContents,
    previewTools,
    previewViewport,
    previewStatus
  )
  const columns = el('div', undefined, 'print-columns')
  columns.append(left, previewPane)
  body.append(columns)

  // Paper: presets, margin and printer offsets, shared by labels and marks.
  const presetSelect = el('select')
  bindAttribute(presetSelect, 'aria-label', uiMessage('A4 preset'))
  const margin = numberInput(layout.marginMm, { min: 0, max: 30, step: 0.5 })
  const offsetX = numberInput(layout.offsetXMm, {
    min: -OFFSET_LIMIT_MM,
    max: OFFSET_LIMIT_MM,
    step: 0.1,
  })
  const offsetY = numberInput(layout.offsetYMm, {
    min: -OFFSET_LIMIT_MM,
    max: OFFSET_LIMIT_MM,
    step: 0.1,
  })
  const presetName = el('input')
  presetName.type = 'text'
  presetName.maxLength = 40
  bindAttribute(presetName, 'placeholder', uiMessage('Preset name'))
  bindAttribute(presetName, 'aria-label', uiMessage('Preset name'))
  const savePreset = el('button', uiMessage('Save preset'))
  savePreset.type = 'button'
  const deletePreset = el('button', uiMessage('Delete preset'))
  deletePreset.type = 'button'
  const calibrate = el('button', uiMessage('Calibration sheet'))
  calibrate.dataset.action = 'print-calibration'
  calibrate.type = 'button'
  const presetRow = el('div', undefined, 'print-preset-row')
  const presetActions = el('div', undefined, 'print-preset-actions')
  presetActions.append(savePreset, deletePreset)
  presetRow.append(
    field(
      'A4 preset',
      presetSelect,
      'Apply this preset’s margin and X/Y printer offsets to the preview and PDF.'
    ),
    field(
      'Preset name',
      presetName,
      'Name these margin and printer-offset settings, then choose Save preset to reuse them.'
    ),
    presetActions
  )
  preparationHelp(
    savePreset,
    uiMessage(
      'Save the current margin and printer offsets under this name. Reusing a name replaces that preset.'
    )
  )
  preparationHelp(
    deletePreset,
    uiMessage(
      'Remove this saved preset. The preview keeps its current margin and offsets.'
    )
  )
  preparationHelp(
    calibrate,
    uiMessage(
      'Export an A4 test page with rulers and reference crosses to check printer scale and alignment.'
    )
  )
  const paperFields = el('div', undefined, 'print-grid-fields')
  paperFields.append(
    field(
      marks ? 'Safe margin (mm)' : 'Margin (mm)',
      margin,
      marks
        ? 'Reserve this much space inside each A4 half. The carton mark scales to fit the remaining area.'
        : 'Reserve empty space around the label grid. Larger margins can fit fewer labels per page.'
    ),
    field(
      'Offset X (mm)',
      offsetX,
      'Move all printed content left with negative values or right with positive values, in millimetres.'
    ),
    field(
      'Offset Y (mm)',
      offsetY,
      'Move all printed content up with negative values or down with positive values, in millimetres.'
    )
  )
  const paper = el('fieldset', undefined, 'print-fieldset')
  const calibrateHint = el(
    'p',
    uiMessage(
      'Print the calibration sheet once per printer, measure it and enter the offsets.'
    ),
    'print-hint'
  )
  paper.append(
    el('legend', uiMessage('Paper and printer')),
    presetRow,
    paperFields,
    calibrateHint,
    calibrate
  )

  function renderPresets() {
    const presets = store.presets()
    const matching = presets.find(
      (preset) =>
        preset.id === layout.preset &&
        preset.marginMm === layout.marginMm &&
        preset.offsetXMm === layout.offsetXMm &&
        preset.offsetYMm === layout.offsetYMm
    )
    const options = presets.map((preset) => {
      const option = el(
        'option',
        preset.id === DEFAULT_PRESET.id ? uiMessage(preset.name) : preset.name
      )
      option.value = preset.id
      return option
    })
    if (!matching) {
      const custom = el('option', uiMessage('Custom (not saved)'))
      custom.value = ''
      options.push(custom)
    }
    presetSelect.replaceChildren(...options)
    presetSelect.value = matching ? matching.id : ''
    deletePreset.hidden = !matching || matching.id === DEFAULT_PRESET.id
  }
  presetSelect.addEventListener('change', () => {
    const preset = store
      .presets()
      .find((entry) => entry.id === presetSelect.value)
    if (!preset) return
    margin.value = String(preset.marginMm)
    offsetX.value = String(preset.offsetXMm)
    offsetY.value = String(preset.offsetYMm)
    layout = { ...layout, preset: preset.id }
    update()
  })
  savePreset.addEventListener('click', () => {
    try {
      const preset = store.savePreset({
        name: presetName.value,
        marginMm: margin.value,
        offsetXMm: offsetX.value,
        offsetYMm: offsetY.value,
      })
      layout = { ...layout, preset: preset.id }
      presetName.value = ''
      update()
      bindText(status, uiMessage('Preset saved: {0}', { 0: preset.name }))
    } catch (error) {
      bindText(status, uiMessage(error.message))
    }
  })
  deletePreset.addEventListener('click', () => {
    store.deletePreset(presetSelect.value)
    layout = { ...layout, preset: '' }
    update()
  })

  const controls = []
  const kindFields = el('fieldset', undefined, 'print-fieldset print-options')
  let capsBox = null
  if (marks) {
    const numbering = check(
      'Number cartons (Carton 1 of 3)',
      layout.numbering,
      'Print each carton’s sequence below its mark, such as Carton 1 of 3.'
    )
    const extra = check(
      'Fill an odd last half with an extra copy',
      layout.fillExtra,
      'Repeat the last carton mark once to fill an empty final half page.'
    )
    const guides = check(
      'Cut guide',
      layout.guides,
      'Show the cut line between the two A4 halves.'
    )
    const pageSummary = check(
      'Page summary line',
      layout.pageSummary,
      'Print a small line with the page number, product codes and quantities below the artwork when space allows.'
    )
    kindFields.append(
      el('legend', uiMessage('Two carton marks per A4, cut in half.')),
      numbering.wrapper,
      extra.wrapper,
      guides.wrapper,
      pageSummary.wrapper
    )
    controls.push(() => ({
      numbering: numbering.input.checked,
      fillExtra: extra.input.checked,
      guides: guides.input.checked,
      pageSummary: pageSummary.input.checked,
    }))
    settingsPane.append(kindFields, paper)
  } else {
    const guides = check(
      'Cut guides',
      layout.guides,
      'Show dotted label edges and crop marks to guide cutting.'
    )
    const pageSummary = check(
      'Page summary line',
      layout.pageSummary,
      'Print a small line with the page number, product codes and quantities below the artwork when space allows.'
    )
    const boundaries = check(
      'Mark where products change',
      layout.boundaries,
      'Draw solid separators where neighbouring labels belong to different products.'
    )
    kindFields.append(
      el('legend', uiMessage('Sheet')),
      guides.wrapper,
      pageSummary.wrapper,
      boundaries.wrapper
    )
    const spares = choice(
      'print-spares',
      [
        [
          'proportional',
          'Share by quantity (recommended)',
          'Fill spare places on the last page in proportion to each product’s requested quantity.',
        ],
        [
          'equal',
          'Share equally',
          'Share spare places on the last page equally between products.',
        ],
        [
          'blank',
          'Leave blank',
          'Leave unused label places empty on the last page.',
        ],
      ],
      layout.spares
    )
    capsBox = check(
      'Limit extra copies per product',
      layout.limitExtras ||
        items.some((item) => item.cap !== undefined && item.cap !== ''),
      'Set a maximum number of extra labels for each product. Places that no product can use stay blank.'
    )
    const gapX = numberInput(layout.gapXMm, { min: 0, max: 20 })
    const gapY = numberInput(layout.gapYMm, { min: 0, max: 20 })
    const gaps = el('div', undefined, 'print-grid-fields')
    gaps.append(
      field(
        'Horizontal gap (mm)',
        gapX,
        'Add horizontal space between labels. Larger gaps can fit fewer labels per page.'
      ),
      field(
        'Vertical gap (mm)',
        gapY,
        'Add vertical space between labels. Larger gaps can fit fewer labels per page.'
      )
    )
    const advanced = el('details', undefined, 'print-advanced')
    const advancedSummary = el('summary', uiMessage('Advanced'))
    preparationHelp(
      advancedSummary,
      uiMessage(
        'Set how spare label places are filled, limit extra copies and adjust gaps. The preview updates as you change them.'
      )
    )
    const spareSet = el('fieldset', undefined, 'print-fieldset')
    spareSet.append(
      el('legend', uiMessage('Spare places on the last page')),
      spares.group,
      capsBox.wrapper
    )
    advanced.append(advancedSummary, spareSet, gaps)
    advanced.open = layout.spares !== 'proportional' || capsBox.input.checked
    controls.push(() => ({
      guides: guides.input.checked,
      pageSummary: pageSummary.input.checked,
      boundaries: boundaries.input.checked,
      spares: spares.value(),
      limitExtras: capsBox.input.checked,
      gapXMm: gapX.value,
      gapYMm: gapY.value,
    }))
    settingsPane.append(kindFields, paper, advanced)
  }

  // Quantities table.
  const thead = el('thead')
  const headRow = el('tr')
  const capHead = el('th', uiMessage('Max extra'), 'print-cap-column')
  for (const label of marks
    ? ['Product', 'Cartons', 'Total']
    : ['Product', 'Requested', 'Extra'])
    headRow.append(el('th', uiMessage(label)))
  if (!marks) headRow.append(capHead, el('th', uiMessage('Total')))
  thead.append(headRow)
  const tbody = el('tbody')
  const tfoot = el('tfoot')
  table.append(thead, tbody, tfoot)
  const cellsByKey = new Map()
  for (const item of items) {
    const row = el('tr')
    const name = el('td')
    name.append(
      el('code', item.code, 'ce-code'),
      el('span', item.name || '', 'print-name')
    )
    if (item.detail) name.append(el('small', item.detail))
    if (marks && item.cartonPacking) {
      for (const entry of item.cartonPacking.rows)
        name.append(
          el(
            'small',
            entry.unitsPerCarton == null
              ? uiMessage(
                  'Carton count unknown. Enter the actual count manually.'
                )
              : uiMessage('Pcs/box: {0} · {1}', {
                  0: entry.unitsPerCarton,
                  1: cartonBreakdownMessage(entry),
                }),
            'print-carton-breakdown'
          )
        )
    }
    if (marks && item.known !== undefined && item.known !== null)
      name.append(
        el(
          'small',
          uiMessage(
            item.cartonPacking
              ? 'Calculated cartons: {0}'
              : 'Recorded cartons: {0}',
            { 0: item.known }
          ),
          'print-known'
        )
      )
    const input = numberInput(item.quantity, { min: 0, max: 9999, step: 1 })
    if (item.quantity === '') input.value = ''
    let review
    bindAttribute(
      input,
      'aria-label',
      uiMessage('Quantity for {0}', { 0: item.code })
    )
    input.addEventListener('input', () => {
      quantities.set(item.key, input.value)
      if (review) review.checked = false
      update()
    })
    preparationHelp(
      input,
      uiMessage(
        marks
          ? 'Set how many copies of this carton mark to print. The page count and carton numbering update immediately.'
          : 'Set required copies of this barcode label. Extra copies are calculated separately to fill the last page.'
      )
    )
    const requested = el('td')
    const quantityInput = el('div', undefined, 'print-quantity-input')
    const increment = el('button', `+${quantityStep}`, 'print-quantity-add')
    increment.type = 'button'
    increment.dataset.action = 'increment-print-quantity'
    bindAttribute(
      increment,
      'aria-label',
      uiMessage('Add {0} to requested quantity for {1}', {
        0: quantityStep,
        1: item.code,
      })
    )
    preparationHelp(
      increment,
      uiMessage(
        'Add {0} to this product’s requested quantity. The preview updates immediately; the maximum is 9999.',
        { 0: quantityStep }
      )
    )
    increment.addEventListener('click', () => {
      if (busy || closed) return
      const value = whole(quantities.get(item.key), 0)
      if (!Number.isInteger(value) || value > 9999 - quantityStep) return
      input.value = String(value + quantityStep)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    quantityInput.append(input, increment)
    requested.append(quantityInput)
    if (marks && item.cartonPacking?.requiresReview) {
      const confirm = check(
        'Reviewed',
        false,
        'Confirm the actual carton count, including any partial or mixed cartons. Loose units are never silently assigned to another box.'
      )
      confirm.wrapper.classList.add('print-carton-review')
      review = confirm.input
      bindAttribute(
        review,
        'aria-label',
        uiMessage('Carton count reviewed for {0}', { 0: item.code })
      )
      review.addEventListener('change', update)
      requested.append(confirm.wrapper)
    }
    const extra = el('td', '', 'numeric')
    const total = el('td', '', 'numeric')
    const capCell = el('td', undefined, 'print-cap-column')
    let cap = null
    if (!marks) {
      cap = numberInput(caps.get(item.key), {
        min: 0,
        max: 9999,
        step: 1,
      })
      cap.value = String(caps.get(item.key))
      bindAttribute(
        cap,
        'aria-label',
        uiMessage('Max extra for {0}', { 0: item.code })
      )
      bindAttribute(cap, 'placeholder', uiMessage('No limit'))
      preparationHelp(
        cap,
        uiMessage(
          'Limit extra copies of this barcode label. Leave empty for no limit or enter 0 for none.'
        )
      )
      cap.addEventListener('input', () => {
        caps.set(item.key, cap.value)
        update()
      })
      capCell.append(cap)
    }
    row.append(name, requested, ...(marks ? [total] : [extra, capCell, total]))
    tbody.append(row)
    cellsByKey.set(item.key, { extra, total, input, cap, increment, review })
  }
  const footRow = el('tr')
  const footLabel = el('th', uiMessage('Total'))
  const footRequested = el('td', '', 'numeric')
  const footExtra = el('td', '', 'numeric')
  const footCap = el('td', '', 'print-cap-column')
  const footTotal = el('td', '', 'numeric')
  footRow.append(
    footLabel,
    ...(marks
      ? [footRequested, footTotal]
      : [footRequested, footExtra, footCap, footTotal])
  )
  tfoot.append(footRow)

  const images = new Map()
  const pendingImages = new Map()
  let desiredPreviewImages = new Set()
  let plan = null
  let grid = null
  let slots = null
  let renderToken = 0
  let busy = false
  let closed = false
  let disposeNavigation
  const closing = new AbortController()
  // Quantities and caps are whole numbers; an empty quantity means none and an empty cap no limit.
  const whole = (value, empty) => {
    const text = String(value ?? '').trim()
    if (!text) return empty
    return /^\d{1,4}$/.test(text) ? Number(text) : NaN
  }
  function quantityAdjustment() {
    const factor = whole(quantityFactor.value, NaN)
    if (!Number.isInteger(factor) || factor < 1)
      return {
        error: uiMessage('Enter a whole factor from 1 to 9999.'),
        field: quantityFactor,
      }
    const values = [...quantities].map(([key, value]) => [key, whole(value, 0)])
    const invalid = values.find(([, value]) => !Number.isInteger(value))
    if (invalid)
      return {
        error: uiMessage('{0}: enter a requested quantity from 0 to 9999.', {
          0: invalid[0],
        }),
        field: cellsByKey.get(invalid[0]).input,
      }
    const divide = quantityOperation.value === 'divide'
    const changed = values.map(([key, value]) => [
      key,
      divide ? Math.ceil(value / factor) : value * factor,
    ])
    const overflow = changed.find(([, value]) => value > 9999)
    if (overflow)
      return {
        error: uiMessage(
          '{0} would become {1}, above the 9999 limit. Lower the factor or requested quantity.',
          { 0: overflow[0], 1: overflow[1] }
        ),
        field: quantityFactor,
      }
    return {
      changed,
      before: values.reduce((sum, [, value]) => sum + value, 0),
      after: changed.reduce((sum, [, value]) => sum + value, 0),
      differs: changed.some(([, value], index) => value !== values[index][1]),
      rounded: divide && values.some(([, value]) => value % factor !== 0),
      factor,
      divide,
    }
  }
  function updateQuantityControls() {
    const adjustment = quantityAdjustment()
    applyQuantities.disabled =
      busy || (!adjustment.error && !adjustment.differs)
    if (adjustment.field === quantityFactor)
      quantityFactor.setAttribute('aria-invalid', 'true')
    else quantityFactor.removeAttribute('aria-invalid')
    toolbar.classList.toggle('has-error', Boolean(adjustment.error))
    bindText(
      quantityPreview,
      adjustment.error
        ? ''
        : uiMessage('Total requested: {0} → {1}', {
            0: () => adjustment.before.toLocaleString(getLocale()),
            1: () => adjustment.after.toLocaleString(getLocale()),
          })
    )
    bindText(
      quantityReason,
      adjustment.error ||
        uiMessage(
          !adjustment.differs
            ? 'No quantities would change.'
            : adjustment.divide
              ? 'Division rounds each product up to a whole copy; zero stays zero.'
              : 'Applies to all requested quantities. Extra copies are recalculated separately.'
        )
    )
  }
  applyQuantities.addEventListener('click', () => {
    if (busy || closed) return
    const adjustment = quantityAdjustment()
    if (adjustment.error) {
      updateQuantityControls()
      adjustment.field.focus()
      return
    }
    if (!adjustment.differs) return
    // Validate the entire change first; an overflowing product must never
    // leave any other product partially updated.
    for (const [key, value] of adjustment.changed) {
      quantities.set(key, value)
      cellsByKey.get(key).input.value = String(value)
      if (cellsByKey.get(key).review) cellsByKey.get(key).review.checked = false
    }
    update()
    bindText(
      quantityReason,
      uiMessage('Applied {0}{1} to all requested quantities: {2} → {3}.{4}', {
        0: adjustment.divide ? '÷' : '×',
        1: adjustment.factor,
        2: () => adjustment.before.toLocaleString(getLocale()),
        3: () => adjustment.after.toLocaleString(getLocale()),
        4: adjustment.rounded
          ? uiMessage(' Non-whole results were rounded up.')
          : '',
      })
    )
  })
  quantityOperation.addEventListener('change', updateQuantityControls)
  quantityFactor.addEventListener('input', updateQuantityControls)
  quantityFactor.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    applyQuantities.click()
  })

  const itemByKey = new Map(items.map((item) => [item.key, item]))
  const currentItems = () =>
    items.map((item) => ({
      key: item.key,
      quantity: whole(quantities.get(item.key), 0),
      known: item.known,
      cap:
        !marks && layout.limitExtras ? whole(caps.get(item.key), null) : null,
    }))

  const opsFor = (state, index) =>
    marks
      ? markPageOps({
          plan: state.plan,
          slots: state.slots,
          layout: state.layout,
          page: index,
          language: state.language ?? getLanguage(dialog),
        })
      : labelPageOps({
          plan: state.plan,
          grid: state.grid,
          layout: state.layout,
          page: index,
          language: state.language ?? getLanguage(dialog),
        })
  const pageOps = (index) => opsFor({ plan, grid, slots, layout }, index)

  function warning(text) {
    const entry = el('li')
    bindText(entry, text)
    warnings.append(entry)
  }

  function update() {
    const read = controls.reduce(
      (value, control) => ({ ...value, ...control() }),
      {}
    )
    layout = normalize({
      ...layout,
      ...read,
      marginMm: margin.value,
      offsetXMm: offsetX.value,
      offsetYMm: offsetY.value,
    })
    for (const [index, rect] of safeRects.entries()) {
      const half = marks ? A4.heightMm / 2 : A4.heightMm
      rect.setAttribute('x', String(layout.marginMm))
      rect.setAttribute('y', String(index * half + layout.marginMm))
      rect.setAttribute('width', String(A4.widthMm - 2 * layout.marginMm))
      rect.setAttribute('height', String(half - 2 * layout.marginMm))
    }
    store.saveLayout(kind, layout)
    renderPresets()
    table.classList.toggle('print-caps', !marks && layout.limitExtras === true)
    warnings.replaceChildren()
    let error = ''
    let invalid = false
    for (const [key, cells] of cellsByKey) {
      const quantity = whole(quantities.get(key), 0)
      const badQuantity = Number.isNaN(quantity)
      cells.increment.disabled =
        busy || badQuantity || quantity > 9999 - quantityStep
      const badCap =
        !marks && layout.limitExtras && Number.isNaN(whole(caps.get(key), null))
      // Explicit "true": the app rejects values the native input accepts (1e2).
      for (const [field, bad] of [
        [cells.input, badQuantity],
        [cells.cap, badCap],
      ])
        if (bad) field?.setAttribute('aria-invalid', 'true')
        else field?.removeAttribute('aria-invalid')
      invalid ||= badQuantity || badCap
    }
    updateQuantityControls()
    try {
      if (invalid) throw new Error('Enter whole numbers from 0 to 9999.')
      if (marks) {
        slots = cartonSlots(labelSize, layout)
        plan = planCartonMarks(currentItems(), layout)
      } else {
        grid = labelGrid(layout, labelSize)
        if (!grid.perPage)
          throw new Error('No label fits on A4 with these margins.')
        plan = planLabels(currentItems(), grid, layout)
      }
    } catch (issue) {
      error = issue.message
      plan = null
    }
    page = Math.min(page, Math.max(0, (plan?.pages || 1) - 1))
    const locale = getLocale(dialog)
    const count = (value) => () => value.toLocaleString(locale)
    if (error) bindText(summary, uiMessage(error))
    else if (marks)
      bindText(
        summary,
        uiMessage('2 carton marks per A4 · Pages: {0} · Marks: {1}', {
          0: count(plan.pages),
          1: count(plan.items.reduce((sum, item) => sum + item.total, 0)),
        })
      )
    else
      bindText(
        summary,
        uiMessage('{0} labels per A4 ({1} × {2}) · Pages: {3}', {
          0: count(grid.perPage),
          1: grid.columns,
          2: grid.rows,
          3: count(plan.pages),
        })
      )
    for (const problem of problems)
      warning(
        uiMessage('Not printable: {0}. {1}', {
          0: problem.code || problem.name,
          1: uiMessage(problem.message),
        })
      )
    for (const change of job?.changed || [])
      warning(
        uiMessage('{0} now has the code {1}; its labels use the new code.', {
          0: change.from,
          1: change.to,
        })
      )
    for (const product of job?.missing || [])
      warning(
        uiMessage('No longer found: {0}. It is left out.', { 0: product.code })
      )
    if (plan && !marks) {
      if (grid.rotated)
        warning(uiMessage('Labels are turned 90° because more fit that way.'))
      if (plan.excess)
        warning(
          uiMessage(
            '{0} extra labels for {1} requested ({2}% more). Lower the quantities or leave the spares blank under Advanced.',
            {
              0: count(plan.excess.extras),
              1: count(plan.excess.requested),
              2: plan.excess.percent,
            }
          )
        )
      if (plan.blanks > 0 && plan.pages)
        warning(
          uiMessage('{0} places on the last page stay blank.', {
            0: count(plan.blanks),
          })
        )
    }
    if (plan && marks) {
      if (
        [...cellsByKey.values()].some(
          (cells) =>
            cells.review && (!cells.review.checked || !cells.input.value.trim())
        )
      )
        warning(
          uiMessage(
            'Review loose units and enter the actual carton count. Confirm each affected product before exporting.'
          )
        )
      for (const mismatch of plan.mismatches)
        warning(
          uiMessage(
            itemByKey.get(mismatch.key)?.cartonPacking
              ? '{0}: {1} cartons entered, {2} calculated from Pcs/box.'
              : '{0}: {1} cartons entered, {2} recorded in the packing data.',
            {
              0: mismatch.key,
              1: mismatch.requested,
              2: mismatch.known,
            }
          )
        )
      if (plan.blankHalf) warning(uiMessage('The last half page stays blank.'))
      if (layout.numbering && !numberingFits(slots))
        warning(
          uiMessage(
            'Carton numbers do not fit below marks of this size and are left out.'
          )
        )
    }
    if (plan?.pages) {
      let clearance = Infinity
      for (let index = 0; index < plan.pages; index++)
        clearance = Math.min(
          clearance,
          edgeClearance(contentBoxes(pageOps(index)))
        )
      if (clearance < SAFE_EDGE_MM - 1e-9)
        warning(
          uiMessage(
            'Some content is {0} mm from the paper edge; most printers need at least 4 mm. Reduce the offsets or increase the margin.',
            {
              0: () =>
                Math.max(0, clearance).toLocaleString(locale, {
                  maximumFractionDigits: 1,
                }),
            }
          )
        )
    }
    warnings.hidden = !warnings.children.length

    const byKey = new Map((plan?.items || []).map((item) => [item.key, item]))
    let requested = 0
    let extra = 0
    let total = 0
    for (const [key, cells] of cellsByKey) {
      const entry = byKey.get(key)
      cells.extra.textContent = entry?.extra ? `+${entry.extra}` : ''
      cells.total.textContent = entry ? String(entry.total) : '0'
      requested += entry?.requested || 0
      extra += entry?.extra || 0
      total += entry?.total || 0
    }
    footRequested.textContent = String(requested)
    footExtra.textContent = extra ? `+${extra}` : ''
    footTotal.textContent = String(total)
    exportButton.disabled =
      busy ||
      !plan?.pages ||
      [...cellsByKey.values()].some(
        (cells) =>
          cells.review && (!cells.review.checked || !cells.input.value.trim())
      )
    dialog.dataset.pages = String(plan?.pages || 0)
    void drawPreview()
  }

  const artworkKey = (key, dpi, language) => `${key}@${dpi}@${language}`
  function selectPreviewImages(keys, language) {
    desiredPreviewImages = new Set(
      keys.map((key) => artworkKey(key, PREVIEW_DPI, language))
    )
    for (const [key, image] of images) {
      if (image.dpi !== PREVIEW_DPI || desiredPreviewImages.has(key)) continue
      image.bitmap.close?.()
      images.delete(key)
    }
  }
  async function ensureImages(keys, dpi, language, signal = closing.signal) {
    for (const key of keys) {
      if (!key) continue
      const cacheKey = artworkKey(key, dpi, language)
      if (dpi === PREVIEW_DPI && !desiredPreviewImages.has(cacheKey))
        throw new DOMException('Preview superseded', 'AbortError')
      if (images.has(cacheKey)) continue
      let pending = pendingImages.get(cacheKey)
      if (!pending) {
        pending = (async () => {
          const item = itemByKey.get(key)
          const result = await renderLabel({
            ...item.model,
            language,
            settings: { ...settings, dpi },
            logoUrl,
            signal,
          })
          const full = await decode(result.blob)
          if (
            closed ||
            signal?.aborted ||
            (dpi === PREVIEW_DPI && !desiredPreviewImages.has(cacheKey))
          ) {
            full.bitmap.close?.()
            throw new DOMException('Preview superseded or closed', 'AbortError')
          }
          images.set(cacheKey, { ...full, dpi })
        })()
        pendingImages.set(cacheKey, pending)
      }
      try {
        await pending
      } finally {
        if (pendingImages.get(cacheKey) === pending)
          pendingImages.delete(cacheKey)
      }
    }
  }

  async function drawPreview() {
    const token = ++renderToken
    const language = getLanguage(dialog)
    const context = preview.getContext('2d')
    preview.dataset.previewState = 'loading'
    preview.setAttribute('aria-busy', 'true')
    bindText(previewStatus, uiMessage('Updating preview…'))
    for (const target of [preview, previewPan])
      bindAttribute(
        target,
        'aria-label',
        uiMessage('Page {0} preview', { 0: page + 1 })
      )
    const pages = plan?.pages || 0
    previous.disabled = page <= 0
    next.disabled = page >= pages - 1
    bindText(
      pageLabel,
      pages ? uiMessage('Page {0} of {1}', { 0: page + 1, 1: pages }) : ''
    )
    const runs = plan?.pageSummaries?.[page] || []
    pageContents.replaceChildren(
      ...runs.map((run) => {
        const part = el('span', undefined, 'print-page-run')
        part.append(
          el('code', run.key, 'ce-code'),
          el('span', `× ${run.count.toLocaleString(getLocale(dialog))}`)
        )
        return part
      })
    )
    try {
      if (!pages) {
        selectPreviewImages([], language)
        context.fillStyle = '#fff'
        context.fillRect(0, 0, preview.width, preview.height)
        preview.dataset.previewState = 'empty'
        bindText(previewStatus, '')
        return
      }
      const ops = pageOps(page)
      const keys = [
        ...new Set(ops.filter((op) => op.type === 'image').map((op) => op.key)),
      ]
      selectPreviewImages(keys, language)
      await ensureImages(keys, PREVIEW_DPI, language)
      if (token !== renderToken) return
      context.fillStyle = '#fff'
      context.fillRect(0, 0, preview.width, preview.height)
      drawOps(
        canvasPage(context, PREVIEW_PX_PER_MM),
        ops,
        (key) => images.get(artworkKey(key, PREVIEW_DPI, language))?.bitmap
      )
      preview.dataset.ops = String(ops.length)
      preview.dataset.previewState = 'ready'
      bindText(previewStatus, '')
    } catch (error) {
      if (token === renderToken && !closed) {
        context.fillStyle = '#fff'
        context.fillRect(0, 0, preview.width, preview.height)
        preview.dataset.previewState = 'error'
        bindText(previewStatus, uiMessage(error.message))
      }
    } finally {
      if (token === renderToken) preview.removeAttribute('aria-busy')
    }
  }

  async function exportPdf() {
    if (!plan?.pages || busy || exportButton.disabled) return
    let saved = false
    busy = true
    for (const button of languages.children) button.disabled = true
    exportButton.disabled = true
    // Freeze what is exported: edits wait until the PDF is saved or fails.
    left.inert = true
    const state = {
      plan,
      grid,
      slots,
      layout,
      caps: new Map(caps),
      language: getLanguage(dialog),
    }
    try {
      const pages = Array.from({ length: state.plan.pages }, (_, index) =>
        opsFor(state, index)
      )
      const keys = [
        ...new Set(
          pages
            .flat()
            .filter((op) => op.type === 'image')
            .map((op) => op.key)
        ),
      ]
      const pdf = createPdf({
        title: printText(marks ? 'marks' : 'labels', state.language),
      })
      const names = new Map()
      for (const [index, key] of keys.entries()) {
        bindText(
          status,
          uiMessage('Preparing {0} of {1}', { 0: index + 1, 1: keys.length })
        )
        await ensureImages([key], PDF_DPI, state.language, closing.signal)
        if (closed) return
        const full = images.get(artworkKey(key, PDF_DPI, state.language))
        names.set(key, pdf.addImage(await rgbImage(full.pixels)))
        // Full-resolution pixels are needed once; free them before the next label.
        full.bitmap.close?.()
        images.delete(artworkKey(key, PDF_DPI, state.language))
        if (closed) return
      }
      bindText(status, uiMessage('Building PDF…'))
      const captions = await embedPdfCaptions(pdf, pages, {
        dpi: PDF_DPI,
        signal: closing.signal,
      })
      for (const [key, name] of captions.images) names.set(key, name)
      for (const ops of captions.pages)
        drawOps(pdf.page(), ops, (key) => names.get(key))
      const bytes = pdf.build()
      // Cancel or close while preparing means no download and no recent job.
      if (closed) return
      const filename = uniqueFileName(
        printFileName(kind, state.plan.items.length, new Date(), state.language)
      )
      savePdf(bytes, filename)
      saved = true
      // A small machine-readable summary sits next to every PDF.
      const summary = printSummary({
        kind,
        language: state.language,
        file: filename,
        pages: state.plan.pages,
        perPage: marks ? 2 : state.grid.perPage,
        items: state.plan.items.map((entry) => ({
          code: entry.key,
          name: itemByKey.get(entry.key)?.name || '',
          orders: itemByKey.get(entry.key)?.orders || [],
          requested: entry.requested,
          extra: entry.extra ?? 0,
          total: entry.total,
        })),
      })
      saveFile(
        new Blob([JSON.stringify(summary, null, 2)], {
          type: 'application/json',
        }),
        summaryFileName(filename)
      )
      announceExport(summary.files)
      const cap = (key) => whole(state.caps.get(key), null)
      const recorded = store.recordJob({
        kind,
        language: state.language,
        products: state.plan.items.map((entry) => ({
          code: entry.key,
          name: itemByKey.get(entry.key)?.name || '',
          ref: itemByKey.get(entry.key)?.ref,
          ...(itemByKey.get(entry.key)?.refs
            ? { refs: itemByKey.get(entry.key).refs }
            : {}),
          quantity: entry.requested,
          ...(marks || !state.layout.limitExtras || cap(entry.key) === null
            ? {}
            : { cap: cap(entry.key) }),
        })),
        layout: state.layout,
        pages: state.plan.pages,
        total: state.plan.items.reduce((sum, entry) => sum + entry.total, 0),
      })
      bindText(
        status,
        recorded
          ? uiMessage('PDF saved to your downloads: {0}', { 0: filename })
          : uiMessage(
              'PDF saved to your downloads: {0}. It has too many products to keep in recent jobs.',
              { 0: filename }
            )
      )
      dialog.dataset.exported = filename
    } catch (error) {
      if (!closed) bindText(status, uiMessage(error.message))
    } finally {
      busy = false
      for (const button of languages.children) button.disabled = false
      left.inert = false
      exportButton.disabled = !plan?.pages
      // Observable end of every export attempt, saved or abandoned.
      document.dispatchEvent(
        new CustomEvent('print-export-settled', {
          detail: { saved },
        })
      )
    }
  }

  async function exportCalibration() {
    if (busy || closed) return
    const language = getLanguage(dialog)
    const pdf = createPdf({ title: printText('calibration', language) })
    const preset = store.presets().find((entry) => entry.id === layout.preset)
    const captions = await embedPdfCaptions(
      pdf,
      [calibrationOps(layout, { presetName: preset?.name || '', language })],
      { dpi: PDF_DPI, signal: closing.signal }
    )
    if (closed) return
    drawOps(pdf.page(), captions.pages[0], (key) => captions.images.get(key))
    const filename = uniqueFileName(
      printFileName('calibration', 0, new Date(), language)
    )
    savePdf(pdf.build(), filename)
    announceExport([filename])
    bindText(
      status,
      uiMessage('PDF saved to your downloads: {0}', { 0: filename })
    )
    dialog.dataset.exported = filename
  }

  settingsPane.addEventListener('input', (event) => {
    if (event.target === presetName || event.target === presetSelect) return
    if ([margin, offsetX, offsetY].includes(event.target))
      layout = { ...layout, preset: '' }
    update()
  })
  settingsPane.addEventListener('change', (event) => {
    if (event.target === presetSelect || event.target === presetName) return
    update()
  })
  previous.onclick = () => {
    page = Math.max(0, page - 1)
    void drawPreview()
  }
  next.onclick = () => {
    page = Math.min((plan?.pages || 1) - 1, page + 1)
    void drawPreview()
  }
  calibrate.onclick = () =>
    void exportCalibration().catch((error) => {
      if (!closed) bindText(status, uiMessage(error.message))
    })
  exportButton.onclick = () => void exportPdf()
  cancel.onclick = () => dialog.close()
  enableLightDismiss(dialog)
  dialog.addEventListener('close', () => {
    closed = true
    closing.abort()
    disposeNavigation?.()
    renderToken++
    desiredPreviewImages.clear()
    for (const { bitmap } of images.values()) bitmap.close?.()
    images.clear()
    dialog.remove()
  })
  const stopLanguage = onLanguageChange(() => {
    if (!closed && !busy) update()
  }, dialog)
  dialog.addEventListener('close', stopLanguage, { once: true })
  document.body.append(dialog)
  update()
  dialog.showModal()
  disposeNavigation = enableImageNavigation(
    previewViewport,
    previewFigure,
    previewPan,
    preview,
    previewTools,
    { fitHeight: true, fitLabel: 'Fit page' }
  )
  bindText(
    previewTools.querySelector(':scope > span'),
    uiMessage(
      'Scroll to zoom · drag to pan. Dashed outlines show safe margins; they are not printed.'
    )
  )
  for (const button of previewTools.querySelectorAll('button'))
    preparationHelp(
      button,
      uiMessage(
        button.textContent === String(uiMessage('Fit page'))
          ? 'Fit the whole A4 page in the preview without changing the PDF.'
          : 'Zoom the preview without changing the PDF or printed size.'
      )
    )
  preparationHelp(
    previewPan,
    uiMessage(
      'Scroll to zoom around the pointer; drag to pan. Use +/− to zoom, arrow keys to pan, and 0 to fit the page.'
    )
  )
  return dialog
}

/** The five most recent exports; choosing one regenerates it from current data. */
export function openRecentPrintJobs({
  store = createPrintStore(),
  onRegenerate,
}) {
  const dialog = el('dialog', undefined, 'print-recent-dialog packing-review')
  bindAttribute(dialog, 'aria-label', uiMessage('Recent print jobs'))
  const heading = el('h2', uiMessage('Recent print jobs'))
  const close = el('button', uiMessage('Close'))
  const actions = el('div', undefined, 'dialog-actions')
  actions.append(close)
  dialog.append(heading, actions)
  const body = pinDialogActions(dialog, actions)
  const jobs = store.recentJobs()
  body.append(
    el(
      'p',
      uiMessage(
        'An exact reprint is the saved PDF printed again. Regenerate builds a new PDF from current product data.'
      ),
      'print-hint'
    )
  )
  const status = el('p', undefined, 'print-status')
  status.setAttribute('role', 'status')
  if (!jobs.length)
    body.append(el('p', uiMessage('No recent print jobs yet.'), 'print-empty'))
  const list = el('ul', undefined, 'print-recent-list')
  for (const job of jobs) {
    const row = el('li')
    const what = el('div')
    const kindLabel = el(
      'strong',
      uiMessage(job.kind === 'marks' ? 'Carton marks' : 'Labels')
    )
    const when = el('span')
    bindText(when, () => formatDate(job.date))
    const detail = el('small')
    bindText(
      detail,
      uiMessage('{0} products · {1}', {
        0: job.products.length,
        1: () =>
          job.products
            .slice(0, 4)
            .map((product) => `${product.code} × ${product.quantity}`)
            .join(', ') + (job.products.length > 4 ? '…' : ''),
      })
    )
    what.append(kindLabel, when, detail)
    const regenerate = el('button', uiMessage('Regenerate'))
    preparationHelp(
      regenerate,
      uiMessage(
        'Build a new PDF using current product data and this job’s requested quantities and layout.'
      )
    )
    bindAttribute(
      regenerate,
      'aria-label',
      uiMessage('Regenerate the print job of {0}', {
        0: () => formatDate(job.date),
      })
    )
    regenerate.onclick = async () => {
      try {
        await onRegenerate(job)
        dialog.close()
      } catch (error) {
        bindText(status, uiMessage(error.message))
      }
    }
    row.append(what, regenerate)
    list.append(row)
  }
  body.append(list, status)
  close.onclick = () => dialog.close()
  enableLightDismiss(dialog)
  dialog.addEventListener('close', () => dialog.remove())
  document.body.append(dialog)
  dialog.showModal()
  return dialog
}
