import { element as el } from './ui.js'
import { bindAttribute, bindText, message, t } from './i18n.js'
import { preparationHelp } from './preparation-help.js'
import { icon } from './icons.js'
import { storeIdentity } from './database.js'
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

/** One inline strip, with a neutral editor affordance even before any state is set. */
export function mountOperationsStrip(
  host,
  { record, entryId, storeOnly = false, onEdit }
) {
  const strip = el('span', undefined, 'operations-strip')
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
                      .map((item) => t(item.label, item.params))
                      .join(' · '),
                },
              },
            ]
          : indicators
    for (const indicator of visible) {
      const button = el(
        'button',
        undefined,
        `operations-state operations-${indicator.tone}`
      )
      button.type = 'button'
      button.dataset.operation = indicator.kind
      bindAttribute(
        button,
        'aria-label',
        message(indicator.label, indicator.params)
      )
      preparationHelp(button, message(indicator.label, indicator.params))
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
  return { update: render, destroy: () => strip.remove() }
}

function field(
  host,
  label,
  name,
  { value = '', type = 'text', options, onChange, help, maxLength = 2000 } = {}
) {
  const wrapper = el('div', undefined, 'operations-field'),
    title = el('label', message(label)),
    input = el(options ? 'select' : type === 'textarea' ? 'textarea' : 'input')
  wrapper.append(title, input)
  if (!options && type !== 'textarea') input.type = type
  input.name = name
  input.id = `operation-${crypto.randomUUID()}`
  title.htmlFor = input.id
  if (options) {
    for (const [id, text] of options) {
      const option = el('option', message(text))
      option.value = id
      input.append(option)
    }
    input.value = value
  } else {
    input.value = value
    input.maxLength = maxLength
    if (type === 'textarea') input.rows = 2
  }
  input.addEventListener(options ? 'change' : 'input', () =>
    onChange?.(input.value)
  )
  if (help) preparationHelp(input, message(help))
  host.append(wrapper)
  return input
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

function renderDelay(host, draft, { product = false, fallback } = {}) {
  const section = group(host, 'Production delay'),
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
        } else delete draft.delay
        update()
      },
    }),
    reason = field(section, 'Delay reason', 'delay-reason', {
      value: draft.delay?.reason,
      onChange: (value) => editText(draft.delay, 'reason', value),
    }),
    promise = field(section, 'Original seller promise', 'delay-promise', {
      value: draft.delay?.originalPromise,
      onChange: (value) => editText(draft.delay, 'originalPromise', value),
    }),
    dates = el('div', undefined, 'operations-pair')
  section.append(dates)
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
  section.append(
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
          detail: [
            fallback.reason,
            fallback.originalPromise,
            fallback.confirmedStart,
            fallback.confirmedEnd,
          ]
            .filter(Boolean)
            .join(' · '),
        }),
        'operations-help'
      )
    )
  function update() {
    for (const input of [reason, promise, start, end])
      input.disabled = state.value !== 'delayed'
  }
  update()
}

function renderReceipt(host, draft, { product = false, fallback } = {}) {
  const section = group(host, 'Warehouse receipt'),
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
        } else delete draft.warehouse
        update()
      },
    }),
    date = field(section, 'Received date', 'received-date', {
      type: 'date',
      value: draft.warehouse?.receivedOn,
      onChange: (value) => editText(draft.warehouse, 'receivedOn', value),
    }),
    quantity = product
      ? field(section, 'Received quantity (optional)', 'received-quantity', {
          value: draft.warehouse?.receivedQuantity,
          onChange: (value) =>
            editText(draft.warehouse, 'receivedQuantity', value),
        })
      : null
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
            ) + (fallback.receivedOn ? ` · ${fallback.receivedOn}` : ''),
        }),
        'operations-help'
      )
    )
  function update() {
    date.disabled = !state.value || state.value === 'waiting'
    if (quantity) quantity.disabled = date.disabled
  }
  update()
}

function renderMissingLabels(host, draft, { product = false } = {}) {
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
        else delete draft.missingLabels
        note.disabled = !value
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
  note.disabled = !state.value
}

function renderOriginalTags(host, draft) {
  if (!draft.legacyTags?.length) return
  const section = group(host, 'Original operational tags')
  section.append(
    el('p', draft.legacyTags.join(' · '), 'operations-source-text')
  )
}

function renderStore(host, draft, count) {
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
  const labels = group(host, 'Label services')
  field(labels, 'Product-label printing', 'store-printing', {
    value: draft.labelPrinting || '',
    options: [
      ['', 'Not recorded'],
      ['unknown', 'Unknown'],
      ['supplier', 'Supplier prints labels'],
      ['send', 'Send physical labels'],
    ],
    onChange: (value) => editText(draft, 'labelPrinting', value),
  })
  field(labels, 'Product-label application', 'store-application', {
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
  field(labels, 'Store instructions', 'store-notes', {
    type: 'textarea',
    value: draft.notes,
    onChange: (value) => editText(draft, 'notes', value),
  })
  renderOriginalTags(host, draft)
}

function renderOrder(host, draft) {
  const instructions = group(host, 'Instructions sent')
  for (const [key, label] of [
    ['labelsSent', 'Label instructions sent'],
    ['cartonMarksSent', 'Carton-mark instructions sent'],
    ['requirementsSent', 'Written requirements sent'],
  ])
    check(instructions, label, key, draft.instructions?.[key], (value) => {
      draft.instructions = { ...draft.instructions, [key]: value }
    })
  field(instructions, 'Physical labels dispatched on', 'labels-dispatched-on', {
    type: 'date',
    value: draft.labelsDispatchedOn,
    onChange: (value) => editText(draft, 'labelsDispatchedOn', value),
  })
  renderDelay(host, draft)
  renderReceipt(host, draft)
  renderMissingLabels(host, draft)
  const refund = group(host, 'Shipping refund')
  refund.append(
    el(
      'p',
      message(
        'Record actual amounts and the promise separately. Original supplier totals stay unchanged.'
      ),
      'operations-help'
    )
  )
  const pairs = el('div', undefined, 'operations-pair')
  refund.append(pairs)
  for (const [key, label] of [
    ['actualPaid', 'Actual payment · CNY'],
    ['actualFreight', 'Actual freight · CNY'],
    ['promisedAmount', 'Promised refund · CNY'],
    ['receivedAmount', 'Refund received · CNY'],
  ]) {
    const input = field(pairs, label, `refund-${key}`, {
      value: draft.refund?.[key],
      onChange: (value) => {
        draft.refund ||= {}
        editText(draft.refund, key, value)
      },
    })
    input.inputMode = 'decimal'
  }
  field(refund, 'Refund notes', 'refund-notes', {
    type: 'textarea',
    value: draft.refund?.notes,
    onChange: (value) => {
      draft.refund ||= {}
      editText(draft.refund, 'notes', value)
    },
  })
  renderOriginalTags(host, draft)
}

function renderProduct(host, draft, record) {
  host.append(
    el(
      'p',
      message(
        'Product exceptions override the order default. Choose Use order default to remove an exception.'
      ),
      'operations-help'
    )
  )
  const features = group(host, 'Product features')
  for (const [key, label] of [
    ['lighting', 'Lighting'],
    ['rotation', 'Rotation'],
  ])
    check(features, label, key, draft.features?.[key], (value) => {
      draft.features = { ...draft.features, [key]: value }
    })
  renderDelay(host, draft, {
    product: true,
    fallback: record.orderWorkflow?.delay,
  })
  renderReceipt(host, draft, {
    product: true,
    fallback: record.orderWorkflow?.warehouse,
  })
  renderMissingLabels(host, draft, { product: true })
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
    if (id === 'product') renderProduct(panel, draft.product, record)
    if (id === 'order') renderOrder(panel, draft.order)
    if (id === 'store') {
      const identity = storeIdentity(record.snapshot),
        count = identity
          ? records.filter(
              (entry) =>
                entry.snapshot.accountId === record.snapshot.accountId &&
                storeIdentity(entry.snapshot) === identity
            ).length || 1
          : 1
      renderStore(panel, draft.store, count)
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
