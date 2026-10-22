import { element as el } from './ui.js'
import { message as m, bindText, bindAttribute } from './i18n.js'
import { decorateIcon } from './icons.js'
import { mountStoreSpreadsheetGuide } from './store-spreadsheet-guide.js'
import { readStoreWorkbookAsync } from './store-workbook-client.js'
import { analyzeStoreSheet } from './store-workbook-model.js'
import { createPhotoViewer } from './photo-viewer.js'
import { squareProductPhoto } from './product-photo.js'
import { popupLanguageToggle } from './popup-language-toggle.js'
import { photoCopyTile } from './photo-copy.js'
import { copySingleImage } from './clipboard.js'

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

const issueTitles = {
  'photo-shared': 'Shared product photo',
  'photo-missing': 'Missing product photo',
  'photo-unresolved': 'Unreadable photo',
  'variant-allocation': 'Split variant quantities',
  'quantity-mismatch': 'Quantity mismatch',
  'amount-mismatch': 'Product amount mismatch',
  'total-mismatch': 'Order total mismatch',
  'incomplete-dimensions': 'Incomplete carton dimensions',
}
const issueInstructions = {
  'photo-shared': 'Confirm these rows share this photo.',
  'photo-missing': 'Paste a picture into this row’s pic cell in Excel.',
  'photo-unresolved': 'Replace this picture with an embedded image in Excel.',
  'variant-allocation':
    'Allocate the combined quantity in the product row below.',
  'quantity-mismatch': 'Correct qty, boxes or perbox in Excel.',
  'amount-mismatch': 'Correct price, qty or amount in Excel.',
  'total-mismatch': 'Correct the product rows or the seller’s total in Excel.',
}

function issueContext(issue, analysis, sheet) {
  const addresses = new Set(issue.cells ?? [])
  const rows = (analysis?.rows ?? []).filter(
    (row) =>
      row.row === issue.row ||
      Object.values(row.cells)
        .flat()
        .some((cell) => addresses.has(cell))
  )
  const photos = [...new Set(rows.flatMap((row) => row.photos))]
  // Keep anchored visual evidence available for issues without an assigned photo.
  const assigned = photos.length > 0
  for (const image of sheet?.images ?? []) {
    if (assigned || !image.dataUrl || !image.from) continue
    const to = image.to || image.from,
      last = to.row - (to.row > image.from.row && to.rowOffset === 0 ? 1 : 0),
      lastColumn =
        to.col - (to.col > image.from.col && to.colOffset === 0 ? 1 : 0)
    if (
      rows.some((row) => {
        const column = [...(row.cells.pic?.match(/^[A-Z]+/)?.[0] || '')].reduce(
          (value, letter) => value * 26 + letter.charCodeAt(0) - 64,
          0
        )
        return (
          row.row >= image.from.row &&
          row.row <= last &&
          column >= image.from.col &&
          column <= lastColumn
        )
      }) &&
      !photos.includes(image.dataUrl)
    )
      photos.push(image.dataUrl)
  }
  const values = new Map(
    (sheet?.rows ?? []).flatMap((row) =>
      row.cells.map((cell) => [cell.address, cell.error || cell.value])
    )
  )
  return { rows, photos, values }
}

function appendIssue(host, issue, { check, index, context, openPhoto } = {}) {
  const item = el(
      'li',
      undefined,
      `store-import-issue is-${issue.severity ?? 'error'}`
    ),
    detail = el('div', undefined, 'store-import-issue-detail'),
    heading = el('div', undefined, 'store-import-issue-heading'),
    title = el(
      'strong',
      m(
        issueTitles[issue.code] ||
          (issue.severity === 'review' ? 'Review' : 'Fix in workbook')
      )
    )
  item.dataset.issueCode = issue.code
  heading.append(title)
  let input, checkCaption
  if (check) {
    const label = el('label', undefined, 'store-import-review-check'),
      control = textInput(`review-${index}`, 'checkbox')
    input = control
    bindAttribute(
      control,
      'aria-label',
      m('Confirm review {0}', { 0: index + 1 })
    )
    control.addEventListener('change', () => check(control.checked))
    checkCaption = el('span', m('Review'))
    label.append(control, checkCaption)
    heading.append(label)
  } else {
    heading.append(
      el(
        'span',
        m(issue.severity === 'error' ? 'Blocked' : 'Manual'),
        'store-import-issue-state'
      )
    )
  }
  detail.append(heading)
  if (context?.rows.length) {
    const identity = el('div', undefined, 'store-import-issue-identity')
    for (const group of new Set(context.rows.map((row) => row.group)))
      identity.append(el('code', m('Group {0}', { 0: group })))
    identity.append(
      el(
        'span',
        m('Rows {0}', { 0: context.rows.map((row) => row.row).join(', ') })
      )
    )
    detail.append(identity)
  }
  const visual = el('div', undefined, 'store-import-issue-visual')
  if (context?.photos.length) {
    const photos = el('div', undefined, 'store-import-issue-photos')
    for (const [photoIndex, source] of context.photos.slice(0, 3).entries()) {
      const row = context.rows.find((row) => row.photos.includes(source)),
        tile = el(row ? 'button' : 'span'),
        image = el('img')
      image.src = source
      image.loading = 'lazy'
      bindAttribute(image, 'alt', m('Review photo {0}', { 0: photoIndex + 1 }))
      if (row) {
        tile.type = 'button'
        const index = row.photos.indexOf(source)
        bindAttribute(
          tile,
          'aria-label',
          m('View review photo for row {0}, photo {1}', {
            0: row.row,
            1: index + 1,
          })
        )
        tile.onclick = () => openPhoto?.(row, index)
      }
      tile.append(image)
      photos.append(photoCopyTile(tile, () => copySingleImage(source)))
    }
    visual.append(photos)
  }
  const explanation = el('div', undefined, 'store-import-issue-explanation')
  explanation.append(
    el(
      'p',
      issueInstructions[issue.code]
        ? m(issueInstructions[issue.code])
        : issueMessage(issue)
    )
  )
  if (context?.rows.length) {
    const description = [
      ...new Set(context.rows.map((row) => row.description).filter(Boolean)),
    ].join(' · ')
    if (description)
      explanation.append(
        el('span', description, 'store-import-issue-description')
      )
    const facts = el('div', undefined, 'store-import-issue-facts'),
      sum = (key) =>
        context.rows.every((row) => Number.isSafeInteger(row[key]))
          ? context.rows
              .reduce((total, row) => total + BigInt(row[key]), 0n)
              .toString()
          : '—'
    facts.append(
      fact('Quantity', sum('quantity')),
      fact('Cartons', sum('boxes'))
    )
    explanation.append(facts)
  }
  visual.append(explanation)
  detail.append(visual)
  const mismatch = {
    'quantity-mismatch': [
      'Source qty',
      issue.params?.quantity,
      issue.params?.expected,
    ],
    'amount-mismatch': [
      'Source amount',
      issue.params?.amount,
      issue.params?.expected,
    ],
    'total-mismatch': [
      'Seller total',
      issue.params?.total,
      issue.params?.computedTotal,
    ],
  }[issue.code]
  if (mismatch) {
    const comparison = el('div', undefined, 'store-import-issue-comparison'),
      currency = issue.code !== 'quantity-mismatch',
      value = (source) => `${currency ? '¥' : ''}${source ?? '—'}`
    comparison.append(
      fact(mismatch[0], value(mismatch[1])),
      el('span', '→'),
      fact('Calculated', value(mismatch[2]))
    )
    detail.append(comparison)
    const formula =
      issue.code === 'quantity-mismatch'
        ? `${issue.params.boxes} × ${issue.params.perbox} = ${issue.params.expected}`
        : issue.code === 'amount-mismatch'
          ? `¥${issue.params.price} × ${issue.params.quantity} = ¥${issue.params.expected}`
          : null
    if (formula)
      detail.append(el('code', formula, 'store-import-issue-formula'))
  }
  if (issue.cells?.length) {
    const cells = el('div', undefined, 'store-import-cells')
    for (const address of issue.cells) {
      const cell = el('span'),
        value = context?.values.get(address)
      cell.append(el('code', String(address)))
      if (value !== null && value !== undefined && String(value).trim())
        cell.append(el('span', String(value)))
      cells.append(cell)
    }
    detail.append(cells)
  }
  item.append(detail)
  host.append(item)
  return { input, item, checkCaption }
}

function fact(label, value) {
  const item = el('span', undefined, 'store-import-fact')
  item.append(el('small', m(label)), el('strong', String(value ?? '—')))
  return item
}

/** File parsing and review stay local; only a fully valid submission is saved. */
export function openStoreImportDialog({
  repository,
  onImported = () => {},
  getSizeClassifier,
}) {
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
    layout = el('div', undefined, 'store-import-layout'),
    body = el('div', undefined, 'store-import-body'),
    guide = el('aside', undefined, 'store-import-sidebar'),
    guideTitle = el('h3', m('Workbook guide')),
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
    checksHeader = el('div', undefined, 'store-import-checks-header'),
    checksTitle = el('h3', m('Workbook checks')),
    checksStatus = el('span', undefined, 'store-import-checks-status'),
    allReviews = textInput('allReviews', 'checkbox'),
    allReviewsLabel = el('label', undefined, 'store-import-check-all'),
    summary = el('div', undefined, 'store-import-summary'),
    products = el('div', undefined, 'store-import-products'),
    reviewLabel = el('label', undefined, 'store-import-final-review'),
    photosReviewed = textInput('photosReviewed', 'checkbox')
  let workbook,
    analysis,
    generation = 0,
    busy = false,
    saveLocked = false,
    readingController,
    submitted = false
  const allocations = new Map(),
    reviewedIssues = new Set(),
    reviewChecks = new Map()
  const updateReviews = () => {
    const checked = reviewedIssues.size,
      total = reviewChecks.size
    allReviews.checked = Boolean(total && checked === total)
    allReviews.indeterminate = checked > 0 && checked < total
    allReviews.disabled = busy || !total
    allReviewsLabel.hidden = !total
    for (const [index, { input, item, checkCaption }] of reviewChecks) {
      input.checked = reviewedIssues.has(index)
      input.disabled = busy
      item.classList.toggle('is-checked', input.checked)
      bindText(checkCaption, m(input.checked ? 'Checked' : 'Review'))
    }
    const blocking =
      analysis?.issues.filter((issue) => issue.severity === 'error').length ?? 0
    bindText(
      checksStatus,
      m('{checked}/{total} reviews checked · {blocking} blocking', {
        checked,
        total,
        blocking,
      })
    )
    checksStatus.classList.toggle('has-blockers', blocking > 0)
  }
  allReviews.addEventListener('change', () => {
    for (const index of reviewChecks.keys())
      if (allReviews.checked) reviewedIssues.add(index)
      else reviewedIssues.delete(index)
    updateReviews()
  })
  const photoViewer = createPhotoViewer(async (source) => source, {
    getSizeClassifier,
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
  decorateIcon(submit, 'upload')
  actions.append(popupLanguageToggle(dialog), submit, close)
  header.append(heading, actions)
  const dateField = field('Purchase date', purchaseDate)
  dateField.classList.add('store-import-date-field')
  setup.append(
    field('Workbook', file),
    field('Sheet', sheet),
    field('Store or factory name', storeName),
    dateField
  )
  const template = decorateIcon(
    el('a', m('Download template'), 'button store-import-template'),
    'download',
    { iconOnly: true }
  )
  template.href = 'assets/store-order-template.xlsx'
  template.download = 'store-order-template.xlsx'
  bindAttribute(
    template,
    'title',
    m(
      'Download an editable workbook with ready import markers, formatted product rows and formulas.'
    )
  )
  dateField.append(template)
  reviewLabel.append(
    photosReviewed,
    el('span', m('I checked the product photos, quantities and order total.'))
  )
  reviewLabel.hidden = true
  guideTitle.id = `store-import-guide-heading-${crypto.randomUUID()}`
  guide.setAttribute('aria-labelledby', guideTitle.id)
  guide.append(guideTitle)
  mountStoreSpreadsheetGuide(guide, { initialSection: 'markers' })
  allReviewsLabel.append(allReviews, el('span', m('Check all reviews')))
  bindAttribute(
    allReviews,
    'aria-description',
    m(
      'Confirms review warnings only. Workbook errors, variant quantities and the final photo check still need attention.'
    )
  )
  bindAttribute(
    allReviewsLabel,
    'title',
    m(
      'Confirms review warnings only. Workbook errors, variant quantities and the final photo check still need attention.'
    )
  )
  checksStatus.setAttribute('role', 'status')
  checksHeader.append(checksTitle, checksStatus, allReviewsLabel)
  checksHeader.hidden = true
  body.append(
    setup,
    identity,
    status,
    checksHeader,
    issues,
    summary,
    products,
    reviewLabel
  )
  layout.append(body, guide)
  form.append(header, layout)
  dialog.append(form)

  const setBusy = (value, { saving = false } = {}) => {
    busy = value
    saveLocked = value && saving
    submit.disabled = value || submitted
    close.disabled = saveLocked
    file.disabled = value
    sheet.disabled = value || !workbook
    form.setAttribute('aria-busy', String(value))
    updateReviews()
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
    reviewChecks.clear()
    checksHeader.hidden = !analysis?.issues.length
    updateReviews()
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
      const controls = appendIssue(issues, issue, {
        index,
        context: issueContext(
          issue,
          analysis,
          workbook?.sheets.find((sheet) => sheet.name === analysis.sheetName)
        ),
        openPhoto: (row, index) => {
          void photoViewer.open(row, analysis.rows, index)
        },
        check:
          issue.severity === 'review' && issue.code !== 'variant-allocation'
            ? (checked) => {
                checked
                  ? reviewedIssues.add(String(index))
                  : reviewedIssues.delete(String(index))
                updateReviews()
              }
            : null,
      })
      if (controls.input) reviewChecks.set(String(index), controls)
    }
    updateReviews()
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
        images.append(
          photoCopyTile(view, () =>
            copySingleImage(
              typeof source === 'string' ? source : source.dataUrl
            )
          )
        )
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
