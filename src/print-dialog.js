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
  labelGrid,
  planLabels,
  planCartonMarks,
  cartonSlots,
  normalizePrintLayout,
} from './print-layout.js'
import { createPdf, rgbImage } from './pdf-writer.js'

const LAYOUT_KEY = '1688-print-layout'
const MARKS_KEY = '1688-print-marks'
const PREVIEW_PX_PER_MM = 2

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') || {}
  } catch {
    return {}
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

function localDate(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** File names such as CE-labels-2026-10-19-3-products.pdf. */
export function printFileName(kind, productCount, now = new Date()) {
  const prefix = kind === 'marks' ? 'CE-carton-marks' : 'CE-labels'
  return `${prefix}-${localDate(now)}-${productCount}-${productCount === 1 ? 'product' : 'products'}.pdf`
}

function savePdf(bytes, filename) {
  const url = URL.createObjectURL(
    new Blob([bytes], { type: 'application/pdf' })
  )
  const anchor = el('a')
  anchor.href = url
  anchor.download = filename
  anchor.hidden = true
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
}

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

/** Draw label-sheet guidance: crop marks in the margins and dotted cut lines. */
function labelGuides(draw, grid, layout) {
  if (!layout.guides || grid.sheet === 'precut' || !grid.cells.length) return
  const xs = [...new Set(grid.cells.flatMap((c) => [c.xMm, c.xMm + c.widthMm]))]
  const ys = [
    ...new Set(grid.cells.flatMap((c) => [c.yMm, c.yMm + c.heightMm])),
  ]
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  for (const x of xs) {
    draw.line(x, top, x, bottom, { gray: 0.82, widthPt: 0.2, dash: [0.6, 1.6] })
    if (top > 2) draw.line(x, Math.max(0.5, top - 4), x, top - 1, { gray: 0.6 })
    if (A4.heightMm - bottom > 2)
      draw.line(x, bottom + 1, x, Math.min(A4.heightMm - 0.5, bottom + 4), {
        gray: 0.6,
      })
  }
  for (const y of ys) {
    draw.line(left, y, right, y, { gray: 0.82, widthPt: 0.2, dash: [0.6, 1.6] })
    if (left > 2)
      draw.line(Math.max(0.5, left - 4), y, left - 1, y, { gray: 0.6 })
    if (A4.widthMm - right > 2)
      draw.line(right + 1, y, Math.min(A4.widthMm - 0.5, right + 4), y, {
        gray: 0.6,
      })
  }
}

/** A 10 mm calibration bar and a short caption along the bottom edge. */
function calibration(draw, caption, bottomSpaceMm, yMm = A4.heightMm - 2.2) {
  if (bottomSpaceMm < 3) return
  draw.line(8, yMm, 18, yMm, { gray: 0.45, widthPt: 0.3 })
  draw.line(8, yMm - 0.8, 8, yMm + 0.8, { gray: 0.45, widthPt: 0.3 })
  draw.line(18, yMm - 0.8, 18, yMm + 0.8, { gray: 0.45, widthPt: 0.3 })
  draw.text('10 mm', 19.5, yMm + 0.9, { size: 5, gray: 0.5 })
  draw.text(caption, A4.widthMm - 8, yMm + 0.9, {
    size: 5,
    gray: 0.5,
    align: 'right',
  })
}

/** A dashed cut line at mid-page with a small scissors mark at its start. */
function cutLine(draw, yMm) {
  draw.circle(4.2, yMm - 1.3, 0.9, { gray: 0.5 })
  draw.circle(4.2, yMm + 1.3, 0.9, { gray: 0.5 })
  draw.line(5, yMm - 0.9, 9.5, yMm + 0.6, { gray: 0.5 })
  draw.line(5, yMm + 0.9, 9.5, yMm - 0.6, { gray: 0.5 })
  draw.line(11, yMm, A4.widthMm - 4, yMm, {
    gray: 0.6,
    widthPt: 0.3,
    dash: [2, 1.5],
  })
}

/** Canvas drawing with the PDF page API, for the page-1 preview. */
function canvasPage(context, images) {
  const k = PREVIEW_PX_PER_MM
  const api = {
    image(key, box, { rotate = false } = {}) {
      const image = images.get(key)
      if (!image) {
        context.fillStyle = '#eee'
        context.fillRect(
          box.xMm * k,
          box.yMm * k,
          box.widthMm * k,
          box.heightMm * k
        )
        return api
      }
      context.save()
      if (rotate) {
        context.translate(box.xMm * k, (box.yMm + box.heightMm) * k)
        context.rotate(-Math.PI / 2)
        context.drawImage(image, 0, 0, box.heightMm * k, box.widthMm * k)
      } else
        context.drawImage(
          image,
          box.xMm * k,
          box.yMm * k,
          box.widthMm * k,
          box.heightMm * k
        )
      context.restore()
      return api
    },
    line(x1, y1, x2, y2, { gray = 0.6, widthPt = 0.25, dash = null } = {}) {
      context.save()
      const value = Math.round(gray * 255)
      context.strokeStyle = `rgb(${value},${value},${value})`
      context.lineWidth = Math.max(0.6, (widthPt / 72) * 25.4 * k)
      context.setLineDash(dash ? dash.map((d) => d * k) : [])
      context.beginPath()
      context.moveTo(x1 * k, y1 * k)
      context.lineTo(x2 * k, y2 * k)
      context.stroke()
      context.restore()
      return api
    },
    circle(cx, cy, r, { gray = 0.6 } = {}) {
      context.save()
      const value = Math.round(gray * 255)
      context.strokeStyle = `rgb(${value},${value},${value})`
      context.lineWidth = 0.6
      context.beginPath()
      context.arc(cx * k, cy * k, r * k, 0, Math.PI * 2)
      context.stroke()
      context.restore()
      return api
    },
    text(value, x, y, { size = 6, gray = 0.45, align = 'left' } = {}) {
      context.save()
      const shade = Math.round(gray * 255)
      context.fillStyle = `rgb(${shade},${shade},${shade})`
      context.font = `${Math.max(7, (size / 72) * 25.4 * k)}px Helvetica, Arial, sans-serif`
      context.textAlign = align
      context.fillText(String(value), x * k, y * k)
      context.restore()
      return api
    },
  }
  return api
}

/**
 * Print labels or carton marks for the selected products on A4 pages.
 * `items`: [{ key, code, name, detail, quantity, model }] with one entry per
 * distinct label; `settings`/`logoUrl` are the label settings in use.
 */
export function openPrintDialog({ kind, items, settings, logoUrl }) {
  const marks = kind === 'marks'
  const stored = marks ? load(MARKS_KEY) : load(LAYOUT_KEY)
  let layout = normalizePrintLayout(stored)
  let numbering = marks ? stored.numbering !== false : false
  let fillExtra = marks ? stored.fillExtra === true : false
  const quantities = new Map(items.map((item) => [item.key, item.quantity]))
  const labelSize = settings[marks ? 'mark' : 'barcode']

  const dialog = el('dialog', undefined, 'print-dialog packing-review')
  bindAttribute(
    dialog,
    'aria-label',
    uiMessage(marks ? 'Print carton marks' : 'Print labels')
  )
  const heading = el(
    'h2',
    uiMessage(marks ? 'Print carton marks' : 'Print labels')
  )
  const cancel = el('button', uiMessage('Cancel'))
  const exportButton = el('button', uiMessage('Export PDF'), 'primary')
  const actions = el('div', undefined, 'dialog-actions')
  actions.append(cancel, exportButton)
  dialog.append(heading, actions)
  const body = pinDialogActions(dialog, actions)

  const layoutPane = el('div', undefined, 'print-settings')
  const summary = el('p', undefined, 'print-summary')
  summary.setAttribute('role', 'status')
  const status = el('p', undefined, 'print-status')
  status.setAttribute('role', 'status')
  const advice = el(
    'p',
    uiMessage('Print at 100% (Actual size). The preview shows page 1.'),
    'print-advice'
  )
  const table = el('table', undefined, 'print-counts')
  const preview = el('canvas', undefined, 'print-preview')
  preview.width = A4.widthMm * PREVIEW_PX_PER_MM
  preview.height = A4.heightMm * PREVIEW_PX_PER_MM
  bindAttribute(preview, 'aria-label', uiMessage('Page 1 preview'))
  preview.setAttribute('role', 'img')
  const previewPane = el('div', undefined, 'print-preview-pane')
  previewPane.append(preview)
  const columns = el('div', undefined, 'print-columns')
  const left = el('div', undefined, 'print-left')
  left.append(summary, layoutPane, table, advice, status)
  columns.append(left, previewPane)
  body.append(columns)

  // Settings controls.
  const quality = el('select')
  for (const [value, label] of [
    [300, '300 dpi'],
    [600, '600 dpi (sharper, larger file)'],
  ]) {
    const option = el('option', uiMessage(label))
    option.value = String(value)
    quality.append(option)
  }
  quality.value = String(layout.dpi)
  const controls = []
  if (marks) {
    const numberBox = check('Number cartons (Carton 1 of 3)', numbering)
    const extraBox = check(
      'Fill an odd last half with an extra copy',
      fillExtra
    )
    layoutPane.append(
      el('p', uiMessage('Two carton marks per A4, cut in half.'), 'print-hint'),
      numberBox.wrapper,
      extraBox.wrapper,
      field('Quality', quality)
    )
    controls.push(() => {
      numbering = numberBox.input.checked
      fillExtra = extraBox.input.checked
    })
  } else {
    const sheet = choice(
      'print-sheet',
      [
        ['plain', 'Plain paper (cut with guides)'],
        ['precut', 'Pre-cut label sheet'],
      ],
      layout.sheet
    )
    const margin = numberInput(layout.marginMm, { min: 0, max: 30 })
    const gapX = numberInput(layout.gapXMm, { min: 0, max: 20 })
    const gapY = numberInput(layout.gapYMm, { min: 0, max: 20 })
    const rotate = check('Turn labels when more fit', layout.rotate !== false)
    const plain = el('div', undefined, 'print-grid-fields')
    plain.append(
      field('Margin (mm)', margin),
      field('Horizontal gap (mm)', gapX),
      field('Vertical gap (mm)', gapY),
      rotate.wrapper
    )
    const pre = layout.precut
    const precutInputs = {
      columns: numberInput(pre.columns, { min: 1, max: 30, step: 1 }),
      rows: numberInput(pre.rows, { min: 1, max: 60, step: 1 }),
      offsetXMm: numberInput(pre.offsetXMm, { min: 0, max: 100, step: 0.1 }),
      offsetYMm: numberInput(pre.offsetYMm, { min: 0, max: 150, step: 0.1 }),
      pitchXMm: numberInput(pre.pitchXMm, { min: 5, max: 210, step: 0.1 }),
      pitchYMm: numberInput(pre.pitchYMm, { min: 5, max: 297, step: 0.1 }),
    }
    const precut = el('div', undefined, 'print-grid-fields')
    precut.append(
      field('Columns', precutInputs.columns),
      field('Rows', precutInputs.rows),
      field('First label left (mm)', precutInputs.offsetXMm),
      field('First label top (mm)', precutInputs.offsetYMm),
      field('Horizontal pitch (mm)', precutInputs.pitchXMm),
      field('Vertical pitch (mm)', precutInputs.pitchYMm)
    )
    const spares = choice(
      'print-spares',
      [
        ['equal', 'Share equally'],
        ['proportional', 'Share by quantity'],
        ['blank', 'Leave blank'],
      ],
      layout.spares
    )
    const newRow = check('Start each product on a new row', layout.newRow)
    const guides = check('Cut guides', layout.guides)
    const spareSet = el('fieldset', undefined, 'print-fieldset')
    spareSet.append(
      el('legend', uiMessage('Spare places on the last page')),
      spares.group
    )
    const sheetSet = el('fieldset', undefined, 'print-fieldset')
    sheetSet.append(
      el('legend', uiMessage('Sheet')),
      sheet.group,
      plain,
      precut
    )
    layoutPane.append(
      sheetSet,
      spareSet,
      newRow.wrapper,
      guides.wrapper,
      field('Quality', quality)
    )
    controls.push(() => {
      layout = normalizePrintLayout({
        sheet: sheet.value(),
        marginMm: margin.value,
        gapXMm: gapX.value,
        gapYMm: gapY.value,
        rotate: rotate.input.checked ? 'auto' : false,
        spares: spares.value(),
        newRow: newRow.input.checked,
        guides: guides.input.checked,
        dpi: Number(quality.value),
        precut: Object.fromEntries(
          Object.entries(precutInputs).map(([key, input]) => [key, input.value])
        ),
      })
      plain.hidden = layout.sheet === 'precut'
      precut.hidden = layout.sheet !== 'precut'
    })
    plain.hidden = layout.sheet === 'precut'
    precut.hidden = layout.sheet !== 'precut'
  }
  controls.push(() => {
    layout = { ...layout, dpi: Number(quality.value) === 600 ? 600 : 300 }
  })

  // Quantities table.
  const thead = el('thead')
  const headRow = el('tr')
  for (const label of marks
    ? ['Product', 'Marks', 'Total']
    : ['Product', 'Requested', 'Spares', 'Total'])
    headRow.append(el('th', uiMessage(label)))
  thead.append(headRow)
  const tbody = el('tbody')
  const tfoot = el('tfoot')
  table.append(thead, tbody, tfoot)
  const cellsByKey = new Map()
  for (const item of items) {
    const row = el('tr')
    const name = el('td')
    const code = el('code', item.code, 'ce-code')
    name.append(code, el('span', item.name || '', 'print-name'))
    if (item.detail) name.append(el('small', item.detail))
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
    const spares = el('td', '', 'numeric')
    const total = el('td', '', 'numeric')
    row.append(name, requested, ...(marks ? [] : [spares]), total)
    tbody.append(row)
    cellsByKey.set(item.key, { spares, total })
  }
  const footRow = el('tr')
  const footLabel = el('th', uiMessage('Total'))
  const footTotal = el('td', '', 'numeric')
  footLabel.colSpan = marks ? 2 : 3
  footRow.append(footLabel, footTotal)
  tfoot.append(footRow)

  const images = new Map()
  let plan = null
  let grid = null
  let slots = null
  let renderToken = 0
  let busy = false

  function currentItems() {
    return items.map((item) => ({
      key: item.key,
      quantity: quantities.get(item.key),
    }))
  }

  function update() {
    for (const read of controls) read()
    save(
      marks ? MARKS_KEY : LAYOUT_KEY,
      marks ? { dpi: layout.dpi, numbering, fillExtra } : layout
    )
    let error = ''
    try {
      if (marks) {
        slots = cartonSlots(labelSize)
        plan = planCartonMarks(currentItems(), { fillExtra })
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
    const locale = getLocale()
    if (error) bindText(summary, uiMessage(error))
    else if (marks)
      bindText(
        summary,
        uiMessage('2 carton marks per A4 · Pages: {0} · Marks: {1}', {
          0: () => plan.pages.toLocaleString(locale),
          1: () =>
            plan.items
              .reduce((sum, item) => sum + item.total, 0)
              .toLocaleString(locale),
        })
      )
    else
      bindText(
        summary,
        uiMessage('{0} labels per A4 ({1} × {2}) · Pages: {3}', {
          0: () => grid.perPage.toLocaleString(locale),
          1: grid.columns,
          2: grid.rows,
          3: () => plan.pages.toLocaleString(locale),
        })
      )
    const byKey = new Map((plan?.items || []).map((item) => [item.key, item]))
    let total = 0
    for (const [key, cells] of cellsByKey) {
      const entry = byKey.get(key)
      cells.spares.textContent = entry && entry.spares ? `+${entry.spares}` : ''
      cells.total.textContent = entry ? String(entry.total) : '0'
      total += entry?.total || 0
    }
    footTotal.textContent = String(total)
    exportButton.disabled = busy || !plan?.pages
    void drawPreview()
  }

  async function ensureImages(keys, dpi, signal) {
    const missing = keys.filter((key) => key && !images.has(`${key}@${dpi}`))
    for (const key of missing) {
      const item = items.find((entry) => entry.key === key)
      const result = await renderLabel({
        ...item.model,
        settings: { ...settings, dpi },
        logoUrl,
        signal,
      })
      images.set(`${key}@${dpi}`, await decode(result.blob))
    }
  }

  function pageEntries(page) {
    if (!plan) return []
    if (marks) return plan.sequence.slice(page * 2, page * 2 + 2)
    return plan.sequence.slice(page * grid.perPage, (page + 1) * grid.perPage)
  }

  function drawPage(draw, page, keyFor) {
    if (marks) {
      const entries = pageEntries(page)
      for (const [index, entry] of entries.entries()) {
        if (!entry) continue
        const slot = slots.slots[index]
        draw.image(keyFor(entry.key), slot, { rotate: slots.rotated })
        if (numbering && entry.number)
          draw.text(
            `Carton ${entry.number} of ${entry.of}`,
            A4.widthMm / 2,
            Math.min(
              slot.yMm + slot.heightMm + 6,
              (index + 1) * slots.cutYMm - 2
            ),
            { size: 9, gray: 0.25, align: 'center' }
          )
      }
      cutLine(draw, slots.cutYMm)
      calibration(
        draw,
        `CE carton marks - page ${page + 1} of ${plan.pages} - print at 100% (Actual size)`,
        4
      )
      return
    }
    for (const [index, key] of pageEntries(page).entries())
      if (key)
        draw.image(keyFor(key), grid.cells[index], { rotate: grid.rotated })
    labelGuides(draw, grid, layout)
    const bottom = Math.max(
      ...grid.cells.map((cell) => cell.yMm + cell.heightMm)
    )
    calibration(
      draw,
      `CE labels - page ${page + 1} of ${plan.pages} - print at 100% (Actual size)`,
      A4.heightMm - bottom
    )
  }

  async function drawPreview() {
    const token = ++renderToken
    const context = preview.getContext('2d')
    try {
      if (!plan?.pages) {
        context.fillStyle = '#fff'
        context.fillRect(0, 0, preview.width, preview.height)
        return
      }
      const keys = [
        ...new Set(
          pageEntries(0)
            .map((entry) => (marks ? entry?.key : entry))
            .filter(Boolean)
        ),
      ]
      await ensureImages(keys, 150)
      if (token !== renderToken) return
      context.fillStyle = '#fff'
      context.fillRect(0, 0, preview.width, preview.height)
      const bitmaps = new Map(
        keys.map((key) => [key, images.get(`${key}@150`).bitmap])
      )
      drawPage(canvasPage(context, bitmaps), 0, (key) => key)
      bindText(status, '')
    } catch (error) {
      if (token === renderToken) bindText(status, uiMessage(error.message))
    }
  }

  async function exportPdf() {
    if (!plan?.pages || busy) return
    busy = true
    exportButton.disabled = true
    try {
      const keys = [
        ...new Set(
          plan.sequence
            .map((entry) => (marks ? entry?.key : entry))
            .filter(Boolean)
        ),
      ]
      const pdf = createPdf({ title: marks ? 'CE carton marks' : 'CE labels' })
      const names = new Map()
      for (const [index, key] of keys.entries()) {
        bindText(
          status,
          uiMessage('Preparing {0} of {1}', { 0: index + 1, 1: keys.length })
        )
        await ensureImages([key], layout.dpi)
        names.set(
          key,
          pdf.addImage(
            await rgbImage(images.get(`${key}@${layout.dpi}`).pixels)
          )
        )
      }
      bindText(status, uiMessage('Building PDF…'))
      for (let page = 0; page < plan.pages; page++)
        drawPage(pdf.page(), page, (key) => names.get(key))
      const filename = printFileName(kind, plan.items.length)
      savePdf(pdf.build(), filename)
      bindText(
        status,
        uiMessage('PDF saved to your downloads: {0}', { 0: filename })
      )
      dialog.dataset.exported = filename
    } catch (error) {
      bindText(status, uiMessage(error.message))
    } finally {
      busy = false
      exportButton.disabled = !plan?.pages
    }
  }

  layoutPane.addEventListener('input', update)
  layoutPane.addEventListener('change', update)
  exportButton.onclick = () => void exportPdf()
  cancel.onclick = () => dialog.close()
  enableLightDismiss(dialog)
  dialog.addEventListener('close', () => {
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
