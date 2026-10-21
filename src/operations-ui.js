import { element as el } from './ui.js'
import { bindAttribute, bindText, getLocale, message, t } from './i18n.js'
import { preparationHelp } from './preparation-help.js'
import { icon } from './icons.js'
import { storeIdentity } from './database.js'
import { centsToMoney, moneyToCents } from './money.js'
import { formatCny } from './money-format.js'
import { productFeatures, featureUnitCost } from './product-features.js'
import {
  operationsIndicators,
  productWorkflowClock,
  resolveOperations,
  reviewOperationsMigration,
  validateOrderWorkflow,
  validateProductWorkflow,
  validateStoreWorkflow,
} from './operations-workflow.js'

const own = (value, field) => Object.hasOwn(value || {}, field)
const equal = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {})
function operationIcon(name) {
  const svg = icon(
    {
      workflow: 'more',
      dispatch: 'truck',
      box: 'warehouse',
      labelWarning: 'warning',
      bulb: 'lightbulb',
    }[name] || name
  )
  svg.classList.add('operations-icon')
  return svg
}

/** Keep state actions together in a reserved trailing slot, independent of row text. */
export function mountOperationsStrip(
  host,
  { record, entryId, storeOnly = false, onEdit }
) {
  const strip = el('span', undefined, 'operations-strip')
  let rowContent
  if (host.classList.contains('row-preparation')) {
    rowContent = el('span', undefined, 'operations-row-content')
    rowContent.append(...host.childNodes)
    host.append(rowContent)
    host.classList.add('operations-row')
  }
  host.append(strip)
  function render(current) {
    record = current
    strip.replaceChildren()
    const indicators = operationsIndicators(record, { entryId, storeOnly }),
      visible =
        indicators.length > 5
          ? [
              ...indicators.slice(0, 4),
              {
                kind: 'more',
                icon: 'workflow',
                tone: 'neutral',
                label: 'More operations: {detail}',
                params: {
                  detail: () =>
                    indicators
                      .slice(4)
                      .map((item) => t(item.label, indicatorParams(item)))
                      .join(' · '),
                },
              },
            ]
          : indicators
    for (const indicator of visible) {
      const button = el(
        'button',
        undefined,
        `operations-state operations-${indicator.tone}${indicator.icon === 'workflow' ? ' operations-overflow' : ''}`
      )
      button.type = 'button'
      button.setAttribute('aria-haspopup', 'dialog')
      button.dataset.operation = indicator.kind
      bindAttribute(
        button,
        'aria-label',
        message(indicator.label, indicatorParams(indicator))
      )
      preparationHelp(
        button,
        message(indicator.label, indicatorParams(indicator))
      )
      button.append(operationIcon(indicator.icon))
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        onEdit?.({ record, entryId, storeOnly, kind: indicator.kind })
      })
      button.addEventListener('dblclick', (event) => {
        event.preventDefault()
        event.stopPropagation()
      })
      strip.append(button)
    }
  }
  render(record)
  return {
    update: render,
    destroy() {
      strip.remove()
      if (rowContent) {
        rowContent.replaceWith(...rowContent.childNodes)
        host.classList.remove('operations-row')
      }
    },
  }
}

function indicatorParams(indicator) {
  const params = { ...indicator.params }
  if (indicator.label.startsWith('Product feature:')) {
    if (indicator.translateFeatureName) {
      const name = params.name
      params.name = () => t(name)
    }
    const treatment = params.treatment
    params.treatment = () => t(treatment)
  }
  return params
}

function field(
  host,
  label,
  name,
  { value = '', type = 'text', options, onChange, help, maxLength = 2000 } = {}
) {
  if (options) {
    const wrapper = el(
        'fieldset',
        undefined,
        'operations-field operations-choice'
      ),
      choices = el('div', undefined, 'operations-choices'),
      groupName = `${name}-${crypto.randomUUID()}`
    wrapper.dataset.field = name
    wrapper.append(el('legend', message(label)), choices)
    for (const [id, text] of options) {
      const option = el('label', undefined, 'operations-option'),
        input = el('input')
      input.type = 'radio'
      input.name = groupName
      input.id = `operation-${crypto.randomUUID()}`
      input.value = id
      input.checked = value === id
      option.htmlFor = input.id
      const content = el('span'),
        marker = icon('check')
      marker.classList.add('operations-choice-marker')
      content.append(marker, el('span', message(text)))
      option.append(input, content)
      choices.append(option)
      input.addEventListener('change', () => {
        if (input.checked) onChange?.(input.value)
      })
    }
    // Read the native controls directly; the draft remains the only saved state.
    Object.defineProperty(wrapper, 'value', {
      get: () =>
        [...choices.querySelectorAll('input')].find((input) => input.checked)
          ?.value || '',
    })
    if (help) preparationHelp(wrapper, message(help))
    host.append(wrapper)
    return wrapper
  }
  const wrapper = el('div', undefined, 'operations-field'),
    title = el('label', message(label)),
    input = el(type === 'textarea' ? 'textarea' : 'input')
  wrapper.append(title, input)
  if (type !== 'textarea') input.type = type
  input.name = name
  input.id = `operation-${crypto.randomUUID()}`
  title.htmlFor = input.id
  input.value = value
  input.maxLength = maxLength
  if (type === 'textarea') input.rows = 2
  input.addEventListener('input', () => onChange?.(input.value))
  if (help) preparationHelp(input, message(help))
  host.append(wrapper)
  return input
}

function shortcut(host, label, run, { help } = {}) {
  const button = el(
    'button',
    typeof label === 'string' ? message(label) : label,
    'operations-shortcut'
  )
  button.type = 'button'
  if (help) preparationHelp(button, message(help))
  button.addEventListener('click', run)
  host.append(button)
  return button
}

function fillInput(input, value) {
  input.value = value
  input.dispatchEvent(
    new input.ownerDocument.defaultView.Event('input', { bubbles: true })
  )
}

function dateShortcuts(input) {
  const actions = el(
    'div',
    undefined,
    'operations-shortcuts operations-date-shortcuts'
  )
  input.parentElement.append(actions)
  for (const [label, offset] of [
    ['Today', 0],
    ['Yesterday', -1],
  ])
    shortcut(actions, label, () => {
      if (input.disabled) return
      const date = new Date()
      date.setDate(date.getDate() + offset)
      fillInput(
        input,
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      )
    })
  shortcut(actions, 'Clear', () => {
    if (!input.disabled) fillInput(input, '')
  })
  return actions
}

function noteSuggestions(input, values = []) {
  const suggestions = [
    ...new Set(
      values.filter((value) => typeof value === 'string' && value.trim())
    ),
  ].slice(0, 5)
  if (!suggestions.length) return
  const actions = el(
    'div',
    undefined,
    'operations-shortcuts operations-note-suggestions'
  )
  input.parentElement.append(actions)
  for (const value of suggestions)
    shortcut(
      actions,
      message('Use note: {note}', { note: value }),
      () => {
        if (!input.disabled) fillInput(input, value)
      },
      {
        help: 'Use this existing note in the field. Save workflow to keep the change.',
      }
    )
}

function moneyValue(value) {
  try {
    return formatCny(value)
  } catch {
    return value || '—'
  }
}

function dateValue(value) {
  if (!value) return ''
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(getLocale(), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(date)
    : value
}

function moneyField(host, label, name, value, onChange) {
  const input = field(host, label, name, {
    value,
    onChange: (value) => onChange(value.trim().replace(',', '.')),
  })
  input.inputMode = 'decimal'
  input.addEventListener('blur', () => {
    if (!input.value.trim()) return
    try {
      fillInput(
        input,
        centsToMoney(moneyToCents(input.value.trim().replace(',', '.')))
      )
    } catch {
      /* Validate on save. */
    }
  })
  return input
}

function sourceAmount(input, label, value) {
  if (typeof value !== 'string') return
  try {
    if (moneyToCents(value) < 0n) return
  } catch {
    return
  }
  const actions = el(
    'div',
    undefined,
    'operations-shortcuts operations-source-actions'
  )
  input.parentElement.append(actions)
  shortcut(
    actions,
    message(label, { amount: () => moneyValue(value) }),
    () => fillInput(input, centsToMoney(moneyToCents(value))),
    {
      help: 'Copy the source amount only if it matches the actual amount. Save workflow to keep the change.',
    }
  )
}

function check(host, label, name, value, onChange) {
  const wrapper = el('label', undefined, 'operations-checkbox'),
    input = el('input')
  input.type = 'checkbox'
  input.name = name
  input.checked = Boolean(value)
  wrapper.append(input, el('span', message(label)))
  input.addEventListener('change', () => onChange(input.checked))
  host.append(wrapper)
  return input
}

function group(host, label) {
  const section = el('fieldset', undefined, 'operations-group')
  section.append(el('legend', message(label)))
  host.append(section)
  return section
}

function editText(object, key, value) {
  if (value) object[key] = value
  else delete object[key]
}

function renderDelay(
  host,
  draft,
  { product = false, fallback, notes = [] } = {}
) {
  const section = group(host, 'Production delay'),
    details = el('div', undefined, 'operations-details'),
    choices = [
      [product ? '' : '', product ? 'Use order default' : 'Not recorded'],
      ['none', 'No delay'],
      ['delayed', 'Delayed'],
    ],
    state = field(section, 'Delay state', 'delay-state', {
      value: draft.delay?.status || '',
      options: choices,
      onChange: (value) => {
        if (value) {
          draft.delay = { ...draft.delay, status: value }
          if (value === 'none') {
            delete draft.delay.confirmedStart
            delete draft.delay.confirmedEnd
            start.value = ''
            end.value = ''
          }
        } else {
          delete draft.delay
          for (const input of [reason, promise, start, end]) input.value = ''
        }
        update()
      },
    }),
    reason = field(details, 'Delay reason', 'delay-reason', {
      value: draft.delay?.reason,
      onChange: (value) => editText(draft.delay, 'reason', value),
    }),
    promise = field(details, 'Original seller promise', 'delay-promise', {
      value: draft.delay?.originalPromise,
      onChange: (value) => editText(draft.delay, 'originalPromise', value),
    }),
    dates = el('div', undefined, 'operations-pair')
  details.append(dates)
  section.append(details)
  const start = field(dates, 'Confirmed date / range start', 'delay-start', {
      type: 'date',
      value: draft.delay?.confirmedStart,
      onChange: (value) => editText(draft.delay, 'confirmedStart', value),
    }),
    end = field(dates, 'Range end (optional)', 'delay-end', {
      type: 'date',
      value: draft.delay?.confirmedEnd,
      onChange: (value) => editText(draft.delay, 'confirmedEnd', value),
    })
  dateShortcuts(start)
  dateShortcuts(end)
  noteSuggestions(promise, [...notes, fallback?.originalPromise])
  details.append(
    el(
      'p',
      message(
        'Keep approximate seller wording. Enter dates only when confirmed.'
      ),
      'operations-help'
    )
  )
  if (product && fallback?.status === 'delayed')
    section.append(
      el(
        'p',
        message('Order default: {detail}', {
          detail: () =>
            [
              fallback.reason,
              fallback.originalPromise,
              dateValue(fallback.confirmedStart),
              dateValue(fallback.confirmedEnd),
            ]
              .filter(Boolean)
              .join(' · '),
        }),
        'operations-help'
      )
    )
  function update() {
    details.hidden = state.value !== 'delayed'
    for (const input of [reason, promise, start, end])
      input.disabled = state.value !== 'delayed'
  }
  update()
}

function renderReceipt(host, draft, { product = false, fallback } = {}) {
  const section = group(host, 'Warehouse receipt'),
    details = el('div', undefined, 'operations-pair operations-details'),
    state = field(section, 'Warehouse receipt', 'warehouse-state', {
      value: draft.warehouse?.status || '',
      options: [
        ['', product ? 'Use order default' : 'Not recorded'],
        ['waiting', 'Waiting'],
        ['partial', 'Partially received'],
        ['received', 'Received'],
      ],
      onChange: (value) => {
        if (value) {
          draft.warehouse = { ...draft.warehouse, status: value }
          if (value === 'waiting') {
            delete draft.warehouse.receivedOn
            delete draft.warehouse.receivedQuantity
            date.value = ''
            if (quantity) quantity.value = ''
          }
        } else {
          delete draft.warehouse
          date.value = ''
          if (quantity) quantity.value = ''
        }
        update()
      },
    }),
    date = field(details, 'Received date', 'received-date', {
      type: 'date',
      value: draft.warehouse?.receivedOn,
      onChange: (value) => editText(draft.warehouse, 'receivedOn', value),
    }),
    quantity = product
      ? field(details, 'Received quantity (optional)', 'received-quantity', {
          value: draft.warehouse?.receivedQuantity,
          onChange: (value) =>
            editText(draft.warehouse, 'receivedQuantity', value),
        })
      : null
  section.append(details)
  dateShortcuts(date)
  if (quantity) {
    quantity.inputMode = 'numeric'
    quantity.pattern = '\\d*'
  }
  section.append(
    el(
      'p',
      message(
        'Warehouse receipt is separate from the supplier delivery status.'
      ),
      'operations-help'
    )
  )
  if (product && fallback)
    section.append(
      el(
        'p',
        message('Order default: {detail}', {
          detail: () =>
            t(
              fallback.status === 'received'
                ? 'Received'
                : fallback.status === 'partial'
                  ? 'Partially received'
                  : 'Waiting'
            ) +
            (fallback.receivedOn ? ` · ${dateValue(fallback.receivedOn)}` : ''),
        }),
        'operations-help'
      )
    )
  function update() {
    date.disabled = !state.value || state.value === 'waiting'
    details.hidden = date.disabled
    if (quantity) quantity.disabled = date.disabled
  }
  update()
}

function renderMissingLabels(
  host,
  draft,
  { product = false, notes = [] } = {}
) {
  const section = group(host, 'Product-label issue'),
    state = field(section, 'Arrived without product labels', 'missing-labels', {
      value: own(draft.missingLabels, 'active')
        ? String(draft.missingLabels.active)
        : '',
      options: [
        ['', product ? 'Use order default' : 'Not recorded'],
        ['false', 'No open label issue'],
        ['true', 'Labels missing'],
      ],
      onChange: (value) => {
        if (value)
          draft.missingLabels = {
            ...draft.missingLabels,
            active: value === 'true',
          }
        else {
          delete draft.missingLabels
          note.value = ''
        }
        note.disabled = !value
        note.parentElement.hidden = !value
      },
    }),
    note = field(
      section,
      'Label issue / resolution note',
      'missing-label-note',
      {
        type: 'textarea',
        value: draft.missingLabels?.note,
        onChange: (value) => editText(draft.missingLabels, 'note', value),
      }
    )
  section.classList.add('operations-wide')
  note.disabled = !state.value
  note.parentElement.hidden = note.disabled
  noteSuggestions(note, notes)
}

function renderOriginalTags(host, draft) {
  if (!draft.legacyTags?.length) return
  const section = group(host, 'Original operational tags')
  section.append(
    el('p', draft.legacyTags.join(' · '), 'operations-source-text')
  )
}

function renderStore(host, draft, count, { notes = [] } = {}) {
  host.append(
    el(
      'p',
      message(
        'Store services are shared by {count} known orders in this account.',
        { count }
      ),
      'operations-help'
    )
  )
  const labels = group(host, 'Label services'),
    services = el('div', undefined, 'operations-pair')
  labels.classList.add('operations-wide')
  labels.append(services)
  field(services, 'Product-label printing', 'store-printing', {
    value: draft.labelPrinting || '',
    options: [
      ['', 'Not recorded'],
      ['unknown', 'Unknown'],
      ['supplier', 'Supplier prints labels'],
      ['send', 'Send physical labels'],
    ],
    onChange: (value) => editText(draft, 'labelPrinting', value),
  })
  field(services, 'Product-label application', 'store-application', {
    value: draft.labelApplication || '',
    options: [
      ['', 'Not recorded'],
      ['unknown', 'Unknown'],
      ['free', 'Applies labels free'],
      ['paid', 'Applies labels for a fee'],
    ],
    onChange: (value) => editText(draft, 'labelApplication', value),
  })
  labels.append(
    el(
      'p',
      message(
        'Every store can print carton marks. Product-label printing and application are separate services.'
      ),
      'operations-help'
    )
  )
  check(
    labels,
    'Store promises excess-shipping refunds',
    'store-refund-promise',
    draft.shippingRefundPromise,
    (value) => {
      draft.shippingRefundPromise = value
    }
  )
  const note = field(labels, 'Store instructions', 'store-notes', {
    type: 'textarea',
    value: draft.notes,
    onChange: (value) => editText(draft, 'notes', value),
  })
  noteSuggestions(note, notes)
  renderOriginalTags(host, draft)
}

function renderOrder(host, draft, record) {
  const instructions = group(host, 'Instructions sent'),
    checks = el('div', undefined, 'operations-instruction-checks'),
    notes = [record.notes, ...(draft.legacyTags || [])]
  instructions.classList.add('operations-wide')
  instructions.append(checks)
  for (const [key, label] of [
    ['labelsSent', 'Label instructions sent'],
    ['cartonMarksSent', 'Carton-mark instructions sent'],
    ['requirementsSent', 'Written requirements sent'],
  ])
    check(checks, label, key, draft.instructions?.[key], (value) => {
      draft.instructions = { ...draft.instructions, [key]: value }
    })
  const dispatched = field(
    instructions,
    'Physical labels dispatched on',
    'labels-dispatched-on',
    {
      type: 'date',
      value: draft.labelsDispatchedOn,
      onChange: (value) => editText(draft, 'labelsDispatchedOn', value),
    }
  )
  dateShortcuts(dispatched)
  renderDelay(host, draft, { notes })
  renderReceipt(host, draft)
  renderMissingLabels(host, draft, { notes })
  const refund = group(host, 'Shipping refund')
  refund.classList.add('operations-wide')
  refund.append(
    el(
      'p',
      message(
        'Record actual amounts and the promise separately. Original supplier totals stay unchanged.'
      ),
      'operations-help'
    )
  )
  const pairs = el('div', undefined, 'operations-refund-amounts')
  refund.append(pairs)
  for (const [key, label] of [
    ['actualPaid', 'Actual payment · CNY'],
    ['actualFreight', 'Actual freight · CNY'],
    ['promisedAmount', 'Promised refund · CNY'],
    ['receivedAmount', 'Refund received · CNY'],
  ]) {
    const input = moneyField(
      pairs,
      label,
      `refund-${key}`,
      draft.refund?.[key],
      (value) => {
        draft.refund ||= {}
        editText(draft.refund, key, value)
      }
    )
    if (key === 'actualPaid')
      sourceAmount(
        input,
        'Source payable: {amount}',
        record.snapshot.totals?.payable
      )
    if (key === 'actualFreight')
      sourceAmount(
        input,
        'Source freight: {amount}',
        record.snapshot.totals?.shipping
      )
  }
  const note = field(refund, 'Refund notes', 'refund-notes', {
    type: 'textarea',
    value: draft.refund?.notes,
    onChange: (value) => {
      draft.refund ||= {}
      editText(draft.refund, 'notes', value)
    },
  })
  noteSuggestions(note, notes)
  renderOriginalTags(host, draft)
}

function renderFeatures(host, draft, knownNames = []) {
  const section = group(host, 'Product features'),
    list = el('div', undefined, 'operations-features'),
    header = el('div', undefined, 'operations-feature-head'),
    add = el('button', undefined, 'operations-feature-add'),
    total = el('p', undefined, 'operations-feature-total')
  section.classList.add('operations-wide')
  for (const label of ['Feature name', 'Cost / piece (¥)', 'Cost treatment'])
    header.append(el('span', message(label)))
  add.type = 'button'
  add.append(icon('plus'), el('span', message('Add feature')))
  section.append(
    header,
    list,
    add,
    total,
    el(
      'p',
      message(
        'Enter a cost per piece. Choose Already recorded when the source price, linked payment or order charges already cover it; otherwise it increases this product’s cost.'
      ),
      'operations-help'
    )
  )
  function updateTotal() {
    const names = productFeatures(draft.features).map((feature) =>
      feature.name.normalize('NFKC').trim().toLowerCase()
    )
    for (const button of section.querySelectorAll(
      '.operations-feature-suggestions button'
    ))
      button.disabled = names.includes(
        button.dataset.featureName.normalize('NFKC').trim().toLowerCase()
      )
    try {
      bindText(
        total,
        message('Additional feature cost: ¥{cost} per piece', {
          cost: centsToMoney(featureUnitCost(draft.features)),
        })
      )
    } catch {
      bindText(
        total,
        message('Enter a valid feature cost to calculate the total.')
      )
    }
  }
  function appendFeature(feature, focus = false) {
    const row = el('div', undefined, 'operations-feature-row'),
      { key } = feature,
      write = (field, value) => {
        draft.features = {
          ...draft.features,
          [key]: { ...feature, ...draft.features?.[key], [field]: value },
        }
        delete draft.features[key].key
        updateTotal()
      }
    const name = field(row, 'Feature name', `feature-name-${key}`, {
      value: feature.name,
      maxLength: 120,
      onChange: (value) => write('name', value),
    })
    name.required = true
    name.dataset.featureField = 'name'
    const cost = moneyField(
      row,
      'Cost / piece (¥)',
      `feature-cost-${key}`,
      feature.unitCost,
      (value) => write('unitCost', value)
    )
    cost.required = true
    cost.dataset.featureField = 'cost'
    const treatment = field(row, 'Cost treatment', `feature-treatment-${key}`, {
      value: feature.included ? 'included' : 'extra',
      options: [
        ['extra', 'Additional cost'],
        ['included', 'Already recorded'],
      ],
      onChange: (value) => write('included', value === 'included'),
    })
    treatment.dataset.featureField = 'treatment'
    const remove = el('button', undefined, 'operations-feature-remove')
    remove.type = 'button'
    bindAttribute(remove, 'aria-label', message('Remove feature'))
    preparationHelp(remove, message('Remove feature'))
    remove.append(icon('close'))
    remove.addEventListener('click', () => {
      draft.features = { ...draft.features }
      delete draft.features[key]
      if (!Object.keys(draft.features).length) delete draft.features
      row.remove()
      updateTotal()
      add.focus()
    })
    row.append(remove)
    list.append(row)
    if (focus) name.focus()
  }
  for (const feature of productFeatures(draft.features)) appendFeature(feature)
  function addFeature(name = '', cost = '0.00') {
    const feature = {
      key: crypto.randomUUID(),
      name,
      unitCost: cost,
      included: false,
    }
    const { key, ...value } = feature
    draft.features = { ...draft.features, [key]: value }
    appendFeature(feature, true)
    updateTotal()
  }
  add.addEventListener('click', () => addFeature())
  const suggestions = el(
    'div',
    undefined,
    'operations-shortcuts operations-feature-suggestions'
  )
  for (const name of [...new Set(knownNames)].filter(Boolean).slice(0, 6))
    shortcut(
      suggestions,
      message('Add {feature}', { feature: name }),
      () => addFeature(name, ''),
      {
        help: 'Use this existing feature name. Enter its cost and choose how it is recorded.',
      }
    ).dataset.featureName = name
  add.after(suggestions)
  updateTotal()
}

function renderProduct(host, draft, record, records) {
  host.append(
    el(
      'p',
      message(
        'Product exceptions override the order default. Choose Use order default to remove an exception.'
      ),
      'operations-help'
    )
  )
  const notes = [record.notes, ...(draft.legacyTags || [])],
    knownNames = records
      .filter(
        (entry) =>
          storeIdentity(entry.snapshot) &&
          storeIdentity(entry.snapshot) === storeIdentity(record.snapshot) &&
          entry.snapshot.accountId === record.snapshot.accountId
      )
      .flatMap((entry) =>
        Object.values(entry.productWorkflow || {}).flatMap((workflow) =>
          productFeatures(workflow.features).map((feature) => feature.name)
        )
      )
  renderFeatures(host, draft, knownNames)
  renderDelay(host, draft, {
    product: true,
    fallback: record.orderWorkflow?.delay,
    notes,
  })
  renderReceipt(host, draft, {
    product: true,
    fallback: record.orderWorkflow?.warehouse,
  })
  renderMissingLabels(host, draft, { product: true, notes })
  renderOriginalTags(host, draft)
}

function setBusy(dialog, busy) {
  dialog.setAttribute('aria-busy', String(busy))
  dialog.setAttribute('closedby', busy ? 'none' : 'any')
  for (const element of dialog.querySelectorAll(
    'form > fieldset, .operations-actions button, .operations-tabs button'
  ))
    element.disabled = busy
}

/** Resolves to the saved record, or null after cancellation. Failed saves retain all fields. */
export async function openOperationsDialog({
  record,
  entryId,
  storeOnly = false,
  records = [],
  repository,
  onSaved,
  extensionActions = [],
}) {
  const getter = repository.getOperationsWorkflow || repository.getOrder
  if (getter)
    record = await getter.call(repository, record.snapshot.orderId, {
      accountId: record.snapshot.accountId || 'local',
    })
  if (!record) throw new Error('Order was not found')
  const { store, order, product } = resolveOperations(record, entryId),
    original = structuredClone({ store, order, product }),
    draft = structuredClone(original),
    dialog = el('dialog', undefined, 'operations-dialog'),
    form = el('form'),
    title = el('h2', message('Operations workflow')),
    heading = el('div', undefined, 'operations-heading'),
    tabs = el('nav', undefined, 'operations-tabs'),
    body = el('fieldset', undefined, 'operations-body'),
    actions = el('div', undefined, 'operations-actions'),
    cancel = el('button', message('Cancel')),
    save = el('button', message('Save workflow')),
    error = el('p', undefined, 'operations-error')
  let pending = false,
    result = null
  bindAttribute(dialog, 'aria-label', message('Operations workflow'))
  bindAttribute(tabs, 'aria-label', message('Workflow scope'))
  form.method = 'dialog'
  body.append(el('legend', message('Operations workflow'), 'sr-only'))
  error.setAttribute('role', 'alert')
  error.tabIndex = -1
  error.hidden = true
  cancel.type = 'button'
  save.type = 'submit'
  cancel.addEventListener('click', () => {
    if (!pending) dialog.close()
  })
  actions.append(cancel, save)
  heading.append(
    title,
    el(
      'p',
      record.snapshot.sellerName || record.snapshot.orderId,
      'operations-source-text'
    ),
    tabs
  )
  const context = el('div', undefined, 'operations-context'),
    item = record.snapshot.items.find((item) => item.entryId === entryId)
  if (item)
    context.append(el('span', item.description, 'operations-product-context'))
  if (record.snapshot.purchasedAt) {
    const date = el('time')
    date.dateTime = record.snapshot.purchasedAt
    bindText(
      date,
      message('Purchased: {date}', {
        date: () => dateValue(record.snapshot.purchasedAt),
      })
    )
    context.append(date)
  }
  if (item)
    context.append(
      el(
        'span',
        message('Source: {price} × {quantity}', {
          price: () => moneyValue(item.price),
          quantity: item.quantity,
        })
      )
    )
  if (context.childNodes.length) tabs.before(context)
  dialog.append(heading, form)
  form.append(body, error, actions)
  const panels = new Map(),
    tabButtons = new Map(),
    initialTab = entryId ? 'product' : storeOnly ? 'store' : 'order',
    scopes = [
      ...(entryId ? [['product', 'Product']] : []),
      ['order', 'Order'],
      ['store', 'Store'],
    ]
  for (const [id, label] of scopes) {
    const tab = el('button', message(label)),
      panel = el('section', undefined, 'operations-panel')
    tab.type = 'button'
    tab.dataset.scope = id
    panel.id = `operations-panel-${crypto.randomUUID()}`
    tab.setAttribute('aria-controls', panel.id)
    tab.addEventListener('click', () => selectTab(id))
    tabs.append(tab)
    body.append(panel)
    panels.set(id, panel)
    tabButtons.set(id, tab)
    if (id === 'product')
      renderProduct(panel, draft.product, record, [record, ...records])
    if (id === 'order') renderOrder(panel, draft.order, record)
    if (id === 'store') {
      const identity = storeIdentity(record.snapshot),
        count = identity
          ? records.filter(
              (entry) =>
                entry.snapshot.accountId === record.snapshot.accountId &&
                storeIdentity(entry.snapshot) === identity
            ).length || 1
          : 1
      renderStore(panel, draft.store, count, {
        notes: [
          record.notes,
          ...(draft.store.legacyTags || []),
          ...records
            .filter(
              (entry) =>
                identity &&
                storeIdentity(entry.snapshot) === identity &&
                entry.snapshot.accountId === record.snapshot.accountId
            )
            .map((entry) => entry.storeWorkflow?.notes),
        ],
      })
    }
  }
  for (const action of extensionActions) {
    const button = el('button', message(action.label))
    button.type = 'button'
    button.addEventListener('click', async () => {
      if (!pending) await action.run({ record, entryId })
    })
    actions.prepend(button)
  }
  function selectTab(id) {
    for (const [name, panel] of panels) panel.hidden = name !== id
    for (const [name, button] of tabButtons)
      button.setAttribute('aria-pressed', String(name === id))
  }
  selectTab(initialTab)
  const dirty = () => !equal(original, draft),
    beforeUnload = (event) => {
      if (dirty() || pending) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
  globalThis.window?.addEventListener('beforeunload', beforeUnload)
  dialog.addEventListener('cancel', (event) => {
    if (pending) event.preventDefault()
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (
      pending ||
      (typeof form.reportValidity === 'function' && !form.reportValidity())
    )
      return
    error.hidden = true
    const changes = {}
    try {
      if (!equal(draft.store, original.store))
        changes.store = validateStoreWorkflow(draft.store)
      if (!equal(draft.order, original.order))
        changes.order = validateOrderWorkflow(draft.order)
      if (entryId && !equal(draft.product, original.product))
        changes.product = {
          entryId,
          value: validateProductWorkflow(draft.product),
        }
      if (!Object.keys(changes).length) {
        result = record
        dialog.close()
        return
      }
      pending = true
      setBusy(dialog, true)
      result = await repository.setOperationsWorkflow(
        record.snapshot.orderId,
        changes,
        {
          accountId: record.snapshot.accountId || 'local',
          expectedStoreClock: record.storeWorkflowUpdatedAt || '',
          expectedOrderClock: record.orderWorkflowUpdatedAt || '',
          expectedProductClock: entryId
            ? productWorkflowClock(record, entryId)
            : undefined,
        }
      )
      dialog.close()
    } catch (failure) {
      bindText(
        error,
        message(failure.message || 'Could not save workflow. Try again.')
      )
      error.hidden = false
      error.focus()
    } finally {
      pending = false
      setBusy(dialog, false)
    }
  })
  document.body.append(dialog)
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      async () => {
        globalThis.window?.removeEventListener('beforeunload', beforeUnload)
        dialog.remove()
        // A caller refresh failure must not strand the promise after a successful save.
        if (result && onSaved) {
          try {
            await onSaved(result)
          } catch {
            /* Return the saved record for recovery. */
          }
        }
        resolve(result)
      },
      { once: true }
    )
    dialog.showModal()
  })
}

/** Selected conversions are visible before a single, explicit atomic apply. */
export function openOperationsMigrationDialog({
  records,
  repository,
  onSaved,
}) {
  const review = reviewOperationsMigration(records),
    dialog = el(
      'dialog',
      undefined,
      'operations-dialog operations-migration-dialog'
    ),
    heading = el('div', undefined, 'operations-heading'),
    form = el('form'),
    body = el('fieldset', undefined, 'operations-body'),
    actions = el('div', undefined, 'operations-actions'),
    apply = el('button', message('Apply selected conversions')),
    cancel = el('button', message('Cancel')),
    error = el('p', undefined, 'operations-error'),
    selected = new Set()
  let pending = false,
    result = null
  bindAttribute(dialog, 'aria-label', message('Review operational tags'))
  heading.append(
    el('h2', message('Review operational tags')),
    el(
      'p',
      message(
        'Only selected recognized tags become workflow fields. Original wording is retained; other tags and notes stay unchanged.'
      ),
      'operations-help'
    )
  )
  body.append(el('legend', message('Recognized operational tags'), 'sr-only'))
  form.method = 'dialog'
  error.hidden = true
  error.tabIndex = -1
  error.setAttribute('role', 'alert')
  for (const item of review.items) {
    const card = el('article', undefined, 'operations-migration-item'),
      record = records.find(
        (entry) =>
          (entry.snapshot.accountId || 'local') === item.accountId &&
          entry.snapshot.orderId === item.orderId
      ),
      product = item.entryId
        ? record?.snapshot.items.find((entry) => entry.entryId === item.entryId)
        : null,
      checkbox = check(card, 'Convert this tag', item.id, false, (value) => {
        if (value) selected.add(item.id)
        else selected.delete(item.id)
      })
    checkbox.disabled = item.conflict
    card.append(
      el('strong', item.tag, 'operations-source-text'),
      el(
        'span',
        message('→ {state}', { state: () => t(item.label, item.params) }),
        'operations-migration-after'
      )
    )
    card.append(
      el(
        'span',
        [
          record?.snapshot.sellerName,
          item.orderId,
          product?.description || product?.title,
        ]
          .filter(Boolean)
          .join(' · '),
        'operations-source-text operations-help'
      )
    )
    if (product?.thumbnail) {
      const image = el('img')
      image.src = product.thumbnail
      image.alt = ''
      image.loading = 'lazy'
      card.prepend(image)
    }
    card.append(
      el(
        'span',
        message(
          item.target === 'store'
            ? 'Store service (shared with known same-account store orders)'
            : item.entryId
              ? 'Product exception'
              : 'Order default'
        ),
        'operations-help'
      )
    )
    if (item.requiresEditing)
      card.append(
        el(
          'p',
          message(
            'Original wording will be kept. Open the workflow after conversion to confirm details; no date is invented.'
          ),
          'operations-help'
        )
      )
    if (item.conflict)
      card.append(
        el(
          'p',
          message(
            'An existing workflow value conflicts with this tag. Edit it individually.'
          ),
          'operations-error'
        )
      )
    body.append(card)
  }
  if (!review.items.length)
    body.append(el('p', message('No recognized operational tags to convert.')))
  body.append(
    el(
      'p',
      message(
        '{count} unrecognized tags will stay unchanged, including payment and code references.',
        { count: review.unresolved.length }
      ),
      'operations-help'
    )
  )
  const confirmation = check(
    body,
    'I reviewed the selected conversions',
    'confirm-conversions',
    false,
    () => {}
  )
  apply.type = 'submit'
  cancel.type = 'button'
  actions.append(cancel, apply)
  form.append(body, error, actions)
  dialog.append(heading, form)
  cancel.addEventListener('click', () => {
    if (!pending) dialog.close()
  })
  dialog.addEventListener('cancel', (event) => {
    if (pending) event.preventDefault()
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (pending) return
    try {
      if (!selected.size) throw new Error('Choose at least one tag to migrate')
      if (!confirmation.checked)
        throw new Error('Review and confirm the workflow migration first')
      pending = true
      setBusy(dialog, true)
      result = await repository.applyOperationsMigration(
        { items: review.items.filter((item) => selected.has(item.id)) },
        { confirmed: true }
      )
      dialog.close()
    } catch (failure) {
      bindText(
        error,
        message(failure.message || 'Could not save workflow. Try again.')
      )
      error.hidden = false
      error.focus()
    } finally {
      pending = false
      setBusy(dialog, false)
    }
  })
  document.body.append(dialog)
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      async () => {
        dialog.remove()
        if (result && onSaved) {
          try {
            await onSaved(result)
          } catch {
            /* Return the saved result for recovery. */
          }
        }
        resolve(result)
      },
      { once: true }
    )
    dialog.showModal()
  })
}

export const openOperationsMigration = openOperationsMigrationDialog
export const reviewMigration = openOperationsMigrationDialog
