import {
  message as uiMessage,
  bindText,
  bindAttribute,
  getLocale,
} from './i18n.js'
import { element as el, enableLightDismiss, pinDialogActions } from './ui.js'
import { renderLabel } from './labels.js'
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
import { saveFile, announceExport } from './save-file.js'
import { printSummary, summaryFileName } from './export-summary.js'

/** Labels are rendered at 600 dpi inside the PDF; the preview uses 150 dpi. */
const PDF_DPI = 600
const PREVIEW_DPI = 150
const PREVIEW_PX_PER_MM = 3

function localDate(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** File names such as CE-labels-2026-10-19-3-products.pdf. */
export function printFileName(kind, productCount, now = new Date()) {
  if (kind === 'calibration')
    return `CE-print-calibration-${localDate(now)}.pdf`
  const prefix = kind === 'marks' ? 'CE-carton-marks' : 'CE-labels'
  return `${prefix}-${localDate(now)}-${productCount}-${productCount === 1 ? 'product' : 'products'}.pdf`
}

/** Offline download through a Blob URL and a temporary anchor. */
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

function field(label, input, className = '') {
  const wrapper = el('label', undefined, `print-field ${className}`.trim())
  wrapper.append(el('span', uiMessage(label)), input)
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
function check(label, checked) {
  const input = el('input')
  input.type = 'checkbox'
  input.checked = checked
  const wrapper = el('label', undefined, 'print-check')
  wrapper.append(input, el('span', uiMessage(label)))
  return { wrapper, input }
}
function choice(name, options, current) {
  const group = el('div', undefined, 'print-choice')
  group.setAttribute('role', 'radiogroup')
  const inputs = options.map(([value, label]) => {
    const input = el('input')
    input.type = 'radio'
    input.name = name
    input.value = value
    input.checked = value === current
    const wrapper = el('label', undefined, 'print-check')
    wrapper.append(input, el('span', uiMessage(label)))
    group.append(wrapper)
    return input
  })
  return { group, value: () => inputs.find((input) => input.checked)?.value }
}

const formatDate = (iso) =>
  new Date(iso).toLocaleString(getLocale(), {
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
  const actions = el('div', undefined, 'dialog-actions')
  actions.append(cancel, exportButton)
  dialog.append(heading, actions)
  const body = pinDialogActions(dialog, actions)

  const left = el('div', undefined, 'print-left')
  if (job) {
    const note = el('p', undefined, 'print-note')
    bindText(
      note,
      uiMessage(
        'Regenerated from the print job of {0}. Product data may have changed since; check the preview before printing.',
        { 0: () => formatDate(job.date) }
      )
    )
    left.append(note)
  }
  const summary = el('p', undefined, 'print-summary')
  summary.setAttribute('role', 'status')
  const warnings = el('ul', undefined, 'print-warnings')
  warnings.setAttribute('aria-live', 'polite')
  const table = el('table', undefined, 'print-counts')
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
  left.append(summary, warnings, tableScroll, settingsPane, advice, status)

  const pageLabel = el('span', undefined, 'print-page-label')
  const previous = el('button', undefined, 'icon-button print-page-previous')
  previous.textContent = '‹'
  bindAttribute(previous, 'aria-label', uiMessage('Previous page'))
  bindAttribute(previous, 'title', uiMessage('Previous page'))
  const next = el('button', undefined, 'icon-button print-page-next')
  next.textContent = '›'
  bindAttribute(next, 'aria-label', uiMessage('Next page'))
  bindAttribute(next, 'title', uiMessage('Next page'))
  const pager = el('div', undefined, 'print-pager')
  pager.append(previous, pageLabel, next)
  const pageContents = el('p', undefined, 'print-page-contents')
  const preview = el('canvas', undefined, 'print-preview')
  preview.width = A4.widthMm * PREVIEW_PX_PER_MM
  preview.height = A4.heightMm * PREVIEW_PX_PER_MM
  preview.setAttribute('role', 'img')
  bindAttribute(
    preview,
    'aria-label',
    uiMessage('Page {0} preview', { 0: () => page + 1 })
  )
  const previewStatus = el('p', undefined, 'print-status')
  previewStatus.setAttribute('role', 'status')
  const previewPane = el('div', undefined, 'print-preview-pane')
  previewPane.append(pager, pageContents, preview, previewStatus)
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
  presetRow.append(
    field('A4 preset', presetSelect),
    presetName,
    savePreset,
    deletePreset
  )
  const paperFields = el('div', undefined, 'print-grid-fields')
  paperFields.append(
    field(marks ? 'Safe margin (mm)' : 'Margin (mm)', margin),
    field('Offset X (mm)', offsetX),
    field('Offset Y (mm)', offsetY)
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
    const numbering = check('Number cartons (Carton 1 of 3)', layout.numbering)
    const extra = check(
      'Fill an odd last half with an extra copy',
      layout.fillExtra
    )
    const guides = check('Cut guide', layout.guides)
    const pageSummary = check('Page summary line', layout.pageSummary)
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
    const guides = check('Cut guides', layout.guides)
    const pageSummary = check('Page summary line', layout.pageSummary)
    const boundaries = check('Mark where products change', layout.boundaries)
    kindFields.append(
      el('legend', uiMessage('Sheet')),
      guides.wrapper,
      pageSummary.wrapper,
      boundaries.wrapper
    )
    const spares = choice(
      'print-spares',
      [
        ['proportional', 'Share by quantity (recommended)'],
        ['equal', 'Share equally'],
        ['blank', 'Leave blank'],
      ],
      layout.spares
    )
    capsBox = check(
      'Limit extra copies per product',
      layout.limitExtras ||
        items.some((item) => item.cap !== undefined && item.cap !== '')
    )
    const gapX = numberInput(layout.gapXMm, { min: 0, max: 20 })
    const gapY = numberInput(layout.gapYMm, { min: 0, max: 20 })
    const gaps = el('div', undefined, 'print-grid-fields')
    gaps.append(
      field('Horizontal gap (mm)', gapX),
      field('Vertical gap (mm)', gapY)
    )
    const advanced = el('details', undefined, 'print-advanced')
    const advancedSummary = el('summary', uiMessage('Advanced'))
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
    if (marks && item.known !== undefined && item.known !== null)
      name.append(
        el(
          'small',
          uiMessage('Recorded cartons: {0}', { 0: item.known }),
          'print-known'
        )
      )
    const input = numberInput(item.quantity, { min: 0, max: 9999, step: 1 })
    bindAttribute(
      input,
      'aria-label',
      uiMessage('Quantity for {0}', { 0: item.code })
    )
    input.addEventListener('input', () => {
      quantities.set(item.key, input.value)
      update()
    })
    const requested = el('td')
    requested.append(input)
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
      cap.addEventListener('input', () => {
        caps.set(item.key, cap.value)
        update()
      })
      capCell.append(cap)
    }
    row.append(name, requested, ...(marks ? [total] : [extra, capCell, total]))
    tbody.append(row)
    cellsByKey.set(item.key, { extra, total, input, cap })
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
  let plan = null
  let grid = null
  let slots = null
  let renderToken = 0
  let busy = false
  let closed = false
  const closing = new AbortController()
  // Quantities and caps are whole numbers; an empty quantity means none and an empty cap no limit.
  const whole = (value, empty) => {
    const text = String(value ?? '').trim()
    if (!text) return empty
    return /^\d{1,4}$/.test(text) ? Number(text) : NaN
  }

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
        })
      : labelPageOps({
          plan: state.plan,
          grid: state.grid,
          layout: state.layout,
          page: index,
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
    store.saveLayout(kind, layout)
    renderPresets()
    table.classList.toggle('print-caps', !marks && layout.limitExtras === true)
    warnings.replaceChildren()
    let error = ''
    let invalid = false
    for (const [key, cells] of cellsByKey) {
      const badQuantity = Number.isNaN(whole(quantities.get(key), 0))
      const badCap =
        !marks && layout.limitExtras && Number.isNaN(whole(caps.get(key), null))
      cells.input.toggleAttribute('aria-invalid', badQuantity)
      cells.cap?.toggleAttribute('aria-invalid', badCap)
      invalid ||= badQuantity || badCap
    }
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
    const locale = getLocale()
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
      for (const mismatch of plan.mismatches)
        warning(
          uiMessage(
            '{0}: {1} cartons entered, {2} recorded in the packing data.',
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
    exportButton.disabled = busy || !plan?.pages
    dialog.dataset.pages = String(plan?.pages || 0)
    void drawPreview()
  }

  async function ensureImages(keys, dpi, signal) {
    for (const key of keys.filter(
      (key) => key && !images.has(`${key}@${dpi}`)
    )) {
      const item = itemByKey.get(key)
      const result = await renderLabel({
        ...item.model,
        settings: { ...settings, dpi },
        logoUrl,
        signal,
      })
      images.set(`${key}@${dpi}`, await decode(result.blob))
    }
  }

  async function drawPreview() {
    const token = ++renderToken
    const context = preview.getContext('2d')
    const pages = plan?.pages || 0
    previous.disabled = page <= 0
    next.disabled = page >= pages - 1
    bindText(
      pageLabel,
      pages ? uiMessage('Page {0} of {1}', { 0: page + 1, 1: pages }) : ''
    )
    const runs = plan?.pageSummaries?.[page] || []
    bindText(
      pageContents,
      runs.length
        ? () =>
            runs
              .map(
                (run) => `${run.key} × ${run.count.toLocaleString(getLocale())}`
              )
              .join(' · ')
        : ''
    )
    try {
      context.fillStyle = '#fff'
      context.fillRect(0, 0, preview.width, preview.height)
      if (!pages) return
      const ops = pageOps(page)
      const keys = [
        ...new Set(ops.filter((op) => op.type === 'image').map((op) => op.key)),
      ]
      await ensureImages(keys, PREVIEW_DPI)
      if (token !== renderToken) return
      context.fillStyle = '#fff'
      context.fillRect(0, 0, preview.width, preview.height)
      drawOps(
        canvasPage(context, PREVIEW_PX_PER_MM),
        ops,
        (key) => images.get(`${key}@${PREVIEW_DPI}`)?.bitmap
      )
      preview.dataset.ops = String(ops.length)
      bindText(previewStatus, '')
    } catch (error) {
      if (token === renderToken)
        bindText(previewStatus, uiMessage(error.message))
    }
  }

  async function exportPdf() {
    if (!plan?.pages || busy) return
    busy = true
    exportButton.disabled = true
    // Freeze what is exported: edits wait until the PDF is saved or fails.
    left.inert = true
    const state = { plan, grid, slots, layout, caps: new Map(caps) }
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
      const pdf = createPdf({ title: marks ? 'CE carton marks' : 'CE labels' })
      const names = new Map()
      for (const [index, key] of keys.entries()) {
        bindText(
          status,
          uiMessage('Preparing {0} of {1}', { 0: index + 1, 1: keys.length })
        )
        await ensureImages([key], PDF_DPI, closing.signal)
        if (closed) return
        const full = images.get(`${key}@${PDF_DPI}`)
        names.set(key, pdf.addImage(await rgbImage(full.pixels)))
        // Full-resolution pixels are needed once; free them before the next label.
        full.bitmap.close?.()
        images.delete(`${key}@${PDF_DPI}`)
        if (closed) return
      }
      bindText(status, uiMessage('Building PDF…'))
      for (const ops of pages) drawOps(pdf.page(), ops, (key) => names.get(key))
      const bytes = pdf.build()
      // Cancel or close while preparing means no download and no recent job.
      if (closed) return
      const filename = printFileName(kind, state.plan.items.length)
      savePdf(bytes, filename)
      // A small machine-readable summary sits next to every PDF.
      const summary = printSummary({
        kind,
        file: filename,
        pages: state.plan.pages,
        perPage: marks ? 2 : state.grid.perPage,
        items: state.plan.items.map((entry) => ({
          code: entry.key,
          name: itemByKey.get(entry.key)?.name || '',
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
        products: state.plan.items.map((entry) => ({
          code: entry.key,
          name: itemByKey.get(entry.key)?.name || '',
          ref: itemByKey.get(entry.key)?.ref,
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
      left.inert = false
      exportButton.disabled = !plan?.pages
    }
  }

  function exportCalibration() {
    const pdf = createPdf({ title: 'CE print calibration' })
    const preset = store.presets().find((entry) => entry.id === layout.preset)
    drawOps(
      pdf.page(),
      calibrationOps(layout, { presetName: preset?.name || '' }),
      () => null
    )
    const filename = printFileName('calibration', 0)
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
  calibrate.onclick = () => exportCalibration()
  exportButton.onclick = () => void exportPdf()
  cancel.onclick = () => dialog.close()
  enableLightDismiss(dialog)
  dialog.addEventListener('close', () => {
    closed = true
    closing.abort()
    renderToken++
    for (const { bitmap } of images.values()) bitmap.close?.()
    images.clear()
    dialog.remove()
  })
  document.body.append(dialog)
  update()
  dialog.showModal()
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
