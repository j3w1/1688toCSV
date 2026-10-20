import { element as el } from './ui.js'
import { message as m, bindText, bindAttribute } from './i18n.js'
import { decorateIcon } from './icons.js'
import { mountStoreSpreadsheetGuide } from './store-spreadsheet-guide.js'
import { readStoreWorkbookAsync } from './store-workbook-client.js'
import { analyzeStoreSheet } from './store-workbook-model.js'
import { createPhotoViewer } from './photo-viewer.js'
import { squareProductPhoto } from './product-photo.js'

const positiveInteger = (value) =>
  /^\d+$/.test(String(value ?? '')) &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) > 0

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  )
}

/** Review gate shared by the dialog and focused regression tests. No writes. */
export function validateStoreImportReview(analysis, review) {
  const issues = []
  if (!analysis?.rows?.length)
    issues.push({
      message: 'Choose a workbook with at least one included product row.',
    })
  if (!validDate(review.purchaseDate ?? ''))
    issues.push({ message: 'Confirm the purchase date before importing.' })
  if (!review.storeName?.trim())
    issues.push({ message: 'Enter the store or factory name.' })
  if (!review.photosReviewed)
    issues.push({
      message: 'Review the product photos and source totals before importing.',
    })
  for (const [index, issue] of (analysis?.issues ?? []).entries()) {
    if (issue.severity === 'error') issues.push(issue)
    else if (
      issue.code !== 'variant-allocation' &&
      !review.reviewedIssues?.has(String(index))
    )
      issues.push({
        ...issue,
        message: 'Confirm each highlighted review item before importing.',
      })
  }
  const rows = (analysis?.rows ?? []).map((row) => {
    if ((row.variants?.length ?? 0) <= 1) return row
    const values = review.allocations?.get(String(row.row)) ?? []
    if (
      values.length !== row.variants.length ||
      values.some((quantity) => !positiveInteger(quantity)) ||
      values.reduce((sum, quantity) => sum + Number(quantity), 0) !==
        Number(row.quantity)
    ) {
      issues.push({
        message:
          'Row {0}: enter a positive quantity for every variant; the sum must be {1}.',
        params: { 0: row.row, 1: row.quantity },
        row: row.row,
      })
      return row
    }
    return {
      ...row,
      variantAllocations: row.variants.map((variant, index) => ({
        ...variant,
        quantity: Number(values[index]),
      })),
    }
  })
  return { valid: issues.length === 0, issues, rows }
}

function field(label, input, help) {
  const root = el('div', undefined, 'store-import-field'),
    id = `store-import-field-${crypto.randomUUID()}`,
    caption = el('label', m(label))
  input.id = id
  caption.htmlFor = id
  root.append(caption, input)
  if (help) {
    const note = el('small', m(help))
    note.id = `${id}-help`
    input.setAttribute('aria-describedby', note.id)
    root.append(note)
  }
  return root
}

function textInput(name, type = 'text') {
  const input = el('input')
  input.name = name
  input.type = type
  return input
}

const issueMessage = (issue) =>
  m(issue.message, {
    ...issue.params,
    ...(issue.params?.reason ? { reason: m(issue.params.reason) } : {}),
  })

function appendIssue(host, issue, { check, index } = {}) {
  const item = el(
      'li',
      undefined,
      `store-import-issue is-${issue.severity ?? 'error'}`
    ),
    detail = el('div'),
    title = el(
      'strong',
      m(issue.severity === 'review' ? 'Review' : 'Fix in workbook')
    )
  detail.append(title, el('p', issueMessage(issue)))
  if (issue.cells?.length) {
    const cells = el('div', undefined, 'store-import-cells')
    for (const cell of issue.cells) cells.append(el('code', String(cell)))
    detail.append(cells)
  }
  if (check) {
    const label = el('label', undefined, 'store-import-review-check'),
      input = textInput(`review-${index}`, 'checkbox')
    input.addEventListener('change', () => check(input.checked))
    label.append(input, el('span', m('Checked')))
    item.append(label)
  }
  item.append(detail)
  host.append(item)
}

function fact(label, value) {
  const item = el('span', undefined, 'store-import-fact')
  item.append(el('small', m(label)), el('strong', String(value ?? '—')))
  return item
}

/** File parsing and review stay local; only a fully valid submission is saved. */
export function openStoreImportDialog({ repository, onImported = () => {} }) {
  const dialog = el('dialog', undefined, 'store-import-dialog'),
    form = el('form', undefined, 'store-import-form'),
    header = el('header', undefined, 'store-import-header'),
    heading = el('div'),
    title = el('h2', m('Import store spreadsheet')),
    subtitle = el('p', m('Review one sheet, then save it as a new order.')),
    actions = el('div', undefined, 'store-import-actions'),
    submit = el('button', m('Import order'), 'primary'),
    close = decorateIcon(el('button', m('Close import')), 'close', {
      iconOnly: true,
    }),
    body = el('div', undefined, 'store-import-body'),
    setup = el('section', undefined, 'store-import-setup'),
    file = textInput('workbook', 'file'),
    sheet = el('select'),
    storeName = textInput('storeName'),
    purchaseDate = textInput('purchaseDate', 'date'),
    identity = el('p', undefined, 'store-import-identity'),
    status = el(
      'p',
      m('Choose the marked .xlsx or .xls file to begin.'),
      'store-import-status'
    ),
    issues = el('ul', undefined, 'store-import-issues'),
    summary = el('div', undefined, 'store-import-summary'),
    products = el('div', undefined, 'store-import-products'),
    reviewLabel = el('label', undefined, 'store-import-final-review'),
    photosReviewed = textInput('photosReviewed', 'checkbox'),
    guide = el('details', undefined, 'store-import-embedded-guide'),
    guideHost = el('div', undefined, 'store-import-guide-frame')
  let workbook,
    analysis,
    generation = 0,
    busy = false,
    saveLocked = false,
    readingController,
    submitted = false
  const allocations = new Map(),
    reviewedIssues = new Set()
  const photoViewer = createPhotoViewer(async (source) => source, {
    onEdit: async (row, { photoIndex, thumbnail, edit }) => {
      row.photoEdits = { ...row.photoEdits, [photoIndex]: edit }
      if (photoIndex === 0) row.thumbnail = thumbnail
      const preview = products.querySelector(
        `[data-source-row="${row.row}"] .store-import-photos img[data-photo-index="${photoIndex}"]`
      )
      if (preview) preview.src = thumbnail
    },
  })
  title.id = `store-import-title-${crypto.randomUUID()}`
  dialog.setAttribute('aria-labelledby', title.id)
  status.id = `store-import-status-${crypto.randomUUID()}`
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.tabIndex = -1
  form.noValidate = true
  submit.type = 'submit'
  close.type = 'button'
  close.addEventListener('click', () => dialog.close())
  file.accept = '.xlsx,.xls'
  sheet.name = 'sheet'
  sheet.disabled = true
  storeName.required = true
  purchaseDate.required = true
  for (const input of [storeName, purchaseDate]) {
    input.setAttribute('aria-errormessage', status.id)
    input.addEventListener('input', () => {
      if (input.hasAttribute('aria-invalid'))
        input.setAttribute(
          'aria-invalid',
          String(
            input === storeName
              ? !storeName.value.trim()
              : !validDate(purchaseDate.value)
          )
        )
    })
  }
  heading.append(title, subtitle)
  actions.append(submit, close)
  header.append(heading, actions)
  setup.append(
    field('Workbook', file),
    field('Sheet', sheet),
    field('Store or factory name', storeName),
    field(
      'Purchase date',
      purchaseDate,
      'Confirm the date of this purchase; the filename only identifies the store.'
    )
  )
  reviewLabel.append(
    photosReviewed,
    el('span', m('I checked the product photos, quantities and order total.'))
  )
  reviewLabel.hidden = true
  const guideSummary = el('summary', m('File naming, markers and review rules'))
  guide.append(guideSummary, guideHost)
  guide.open = true
  mountStoreSpreadsheetGuide(guideHost)
  body.append(
    setup,
    identity,
    status,
    issues,
    summary,
    products,
    reviewLabel,
    guide
  )
  form.append(header, body)
  dialog.append(form)

  const setBusy = (value, { saving = false } = {}) => {
    busy = value
    saveLocked = value && saving
    submit.disabled = value || submitted
    close.disabled = saveLocked
    file.disabled = value
    sheet.disabled = value || !workbook
    form.setAttribute('aria-busy', String(value))
  }
  const fail = (error) => {
    bindText(
      status,
      m(
        error.message ||
          'Could not read this workbook. Check the file and try again.'
      )
    )
    status.classList.add('is-error')
    status.focus()
  }
  const render = () => {
    issues.replaceChildren()
    summary.replaceChildren()
    products.replaceChildren()
    allocations.clear()
    reviewedIssues.clear()
    photosReviewed.checked = false
    reviewLabel.hidden = !analysis?.rows?.length
    if (!analysis) {
      identity.replaceChildren()
      storeName.value = ''
      return
    }
    storeName.value = analysis.store.name ?? ''
    bindText(
      identity,
      analysis.store.number
        ? m('Store number {0} · Each import creates a separate order.', {
            0: analysis.store.number,
          })
        : m('Factory · No store number · Each import creates a separate order.')
    )
    for (const [index, issue] of analysis.issues.entries()) {
      appendIssue(issues, issue, {
        index,
        check:
          issue.severity === 'review' && issue.code !== 'variant-allocation'
            ? (checked) =>
                checked
                  ? reviewedIssues.add(String(index))
                  : reviewedIssues.delete(String(index))
            : null,
      })
    }
    const groupCount = new Set(analysis.rows.map((row) => row.group)).size
    summary.append(
      fact('Included rows', analysis.rows.length),
      fact('Skipped rows', analysis.skippedRows ?? 0),
      fact('Product groups', groupCount),
      fact('Calculated total · CNY', analysis.computedTotal),
      fact('Seller total · CNY', analysis.total)
    )
    for (const row of analysis.rows) {
      const card = el('article', undefined, 'store-import-product'),
        images = el('div', undefined, 'store-import-photos'),
        content = el('div', undefined, 'store-import-product-detail'),
        rowTitle = el('div', undefined, 'store-import-product-heading'),
        facts = el('div', undefined, 'store-import-facts')
      card.dataset.sourceRow = String(row.row)
      rowTitle.append(
        el('strong', m('Row {0}', { 0: row.row })),
        el('code', m('Group {0}', { 0: row.group }))
      )
      for (const [index, source] of (row.photos ?? []).entries()) {
        const image = el('img')
        image.src = typeof source === 'string' ? source : source.dataUrl
        image.loading = 'lazy'
        bindAttribute(
          image,
          'alt',
          m('Row {0}, photo {1}', { 0: row.row, 1: index + 1 })
        )
        image.dataset.photoIndex = String(index)
        const view = el('button', undefined, 'store-import-photo-button')
        view.type = 'button'
        bindAttribute(
          view,
          'aria-label',
          m('View or adjust row {0}, photo {1}', { 0: row.row, 1: index + 1 })
        )
        view.append(image)
        view.addEventListener('click', () => {
          void photoViewer.open(row, analysis.rows, index)
        })
        images.append(view)
      }
      if (!images.childElementCount)
        images.append(el('span', m('Photo missing'), 'is-error'))
      facts.append(
        fact('Quantity', row.quantity),
        fact('Cartons', row.boxes),
        fact('Pcs/box', row.perbox),
        fact('Unit price', row.price),
        fact('Product amount', row.amount)
      )
      if (row.kg != null) facts.append(fact('kg/carton', row.kg))
      if (row.cbm != null) facts.append(fact('m³/carton', row.cbm))
      if (row.len != null && row.wid != null && row.ht != null)
        facts.append(fact('Carton · cm', `${row.len} × ${row.wid} × ${row.ht}`))
      content.append(
        rowTitle,
        el('p', row.description || row.title || row.productNumber || ''),
        facts
      )
      if ((row.variants?.length ?? 0) > 1) {
        const split = el('fieldset', undefined, 'store-import-allocation'),
          result = el('p', undefined, 'store-import-allocation-total'),
          controls = el('div', undefined, 'store-import-allocation-controls'),
          values = row.variants.map(() => '')
        allocations.set(String(row.row), values)
        result.id = `store-import-allocation-${crypto.randomUUID()}`
        split.append(
          el('legend', m('Split the combined quantity')),
          controls,
          result,
          el(
            'small',
            m(
              'These variants share the source row’s cartons. Their physical packing needs review; carton counts are never multiplied.'
            )
          )
        )
        const update = () => {
          const assigned = values.reduce(
            (sum, quantity) => sum + (Number(quantity) || 0),
            0
          )
          bindText(
            result,
            m('{0} of {1} units allocated', { 0: assigned, 1: row.quantity })
          )
          const valid =
            values.every(positiveInteger) && assigned === Number(row.quantity)
          result.classList.toggle('is-valid', valid)
          result.classList.toggle('is-error', !valid)
          for (const input of controls.querySelectorAll('input'))
            input.setAttribute(
              'aria-invalid',
              String(!valid && values.some(Boolean))
            )
        }
        for (const [index, variant] of row.variants.entries()) {
          const input = textInput(`row-${row.row}-variant-${index}`, 'number'),
            label = el('label'),
            name = [variant.variant, variant.size].filter(Boolean).join(' · ')
          input.min = '1'
          input.step = '1'
          input.inputMode = 'numeric'
          input.required = true
          input.setAttribute('aria-describedby', result.id)
          bindAttribute(
            input,
            'aria-label',
            m('Row {0}, variant {1} quantity', { 0: row.row, 1: name })
          )
          input.addEventListener('input', () => {
            values[index] = input.value
            update()
          })
          label.append(el('span', name), input)
          controls.append(label)
        }
        update()
        content.append(split)
      }
      card.append(images, content)
      products.append(card)
    }
    const errors = analysis.issues.filter(
      (issue) => issue.severity === 'error'
    ).length
    bindText(
      status,
      errors
        ? m(
            '{0} workbook issues block import. Fix the marked cells and choose the corrected file.',
            { 0: errors }
          )
        : m(
            'Check the photos and totals, confirm the date, and complete the highlighted reviews.'
          )
    )
    status.classList.toggle('is-error', errors > 0)
    guide.open = false
  }
  const analyze = async () => {
    analysis = await analyzeStoreSheet(workbook, sheet.value)
    render()
  }
  file.addEventListener('change', async () => {
    const selected = file.files?.[0]
    if (!selected) return
    const current = ++generation
    purchaseDate.value = ''
    purchaseDate.removeAttribute('aria-invalid')
    storeName.removeAttribute('aria-invalid')
    analysis = undefined
    workbook = undefined
    render()
    setBusy(true)
    bindText(status, m('Reading workbook and product photos…'))
    status.classList.remove('is-error')
    try {
      readingController = new AbortController()
      const result = await readStoreWorkbookAsync(
        await selected.arrayBuffer(),
        { filename: selected.name, signal: readingController.signal }
      )
      if (current !== generation || !dialog.isConnected) return
      workbook = result
      sheet.replaceChildren(
        ...workbook.sheets.map((entry) => {
          const option = el('option', entry.name)
          option.value = entry.name
          return option
        })
      )
      await analyze()
    } catch (error) {
      if (current === generation)
        fail({
          message: [
            'The spreadsheet exceeds the 100 MB import limit.',
            'Choose an Excel .xlsx or .xls workbook.',
          ].includes(error.message)
            ? error.message
            : 'Could not read this workbook. Check the file and try again.',
        })
    } finally {
      if (current === generation) setBusy(false)
    }
  })
  sheet.addEventListener('change', async () => {
    purchaseDate.value = ''
    purchaseDate.removeAttribute('aria-invalid')
    setBusy(true)
    try {
      await analyze()
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy || submitted) return
    const review = validateStoreImportReview(analysis, {
      purchaseDate: purchaseDate.value,
      storeName: storeName.value,
      allocations,
      reviewedIssues,
      photosReviewed: photosReviewed.checked,
    })
    purchaseDate.setAttribute(
      'aria-invalid',
      String(!validDate(purchaseDate.value))
    )
    storeName.setAttribute('aria-invalid', String(!storeName.value.trim()))
    if (!review.valid) {
      bindText(status, issueMessage(review.issues[0]))
      status.classList.add('is-error')
      status.focus()
      return
    }
    setBusy(true, { saving: true })
    bindText(status, m('Saving the reviewed order…'))
    try {
      const importRows = [],
        thumbnails = new Map()
      for (const [index, row] of review.rows.entries()) {
        bindText(
          status,
          m('Preparing photo {0} of {1}…', {
            0: index + 1,
            1: review.rows.length,
          })
        )
        const original = row.photos[0]
        if (!row.thumbnail && !thumbnails.has(original))
          thumbnails.set(original, await squareProductPhoto(original))
        importRows.push({
          ...row,
          thumbnail: row.thumbnail || thumbnails.get(original),
        })
      }
      bindText(status, m('Saving the reviewed order…'))
      const record = await repository.importStoreOrder({
        filename: analysis.filename,
        sheetName: analysis.sheetName,
        total: analysis.total,
        purchaseDate: purchaseDate.value,
        store: { ...analysis.store, name: storeName.value.trim() },
        rows: importRows,
      })
      submitted = true
      await onImported(record)
      dialog.close()
    } catch (error) {
      fail(
        submitted
          ? {
              message:
                'The order was imported. Close this window and reopen the workspace to refresh the table.',
            }
          : error
      )
    } finally {
      setBusy(false)
    }
  })
  dialog.addEventListener('cancel', (event) => {
    if (saveLocked) event.preventDefault()
  })
  dialog.addEventListener(
    'close',
    () => {
      generation++
      readingController?.abort()
      photoViewer.close()
      dialog.remove()
    },
    { once: true }
  )
  document.body.append(dialog)
  dialog.showModal()
  file.focus()
  return dialog
}
