import { centsToMoney, moneyToCents } from './money.js'
import { productFeatures, validateProductFeatures } from './product-features.js'

export const OPERATIONS_METADATA_FIELDS = [
  'storeWorkflow',
  'storeWorkflowUpdatedAt',
  'orderWorkflow',
  'orderWorkflowUpdatedAt',
  'productWorkflow',
  'productWorkflowUpdatedAt',
  'productWorkflowPartialClocks',
]

const own = (value, key) => Object.hasOwn(value || {}, key)
const equal = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {})

function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Workflow must be an object')
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('Unknown workflow field')
  return value
}

function text(value) {
  if (typeof value !== 'string') throw new Error('Workflow text is invalid')
  return value.trim()
}

function choice(value, choices) {
  if (!choices.includes(value)) throw new Error('Choose a valid workflow state')
  return value
}

function boolean(value) {
  if (typeof value !== 'boolean')
    throw new Error('Workflow choice must be true or false')
  return value
}

function day(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) ||
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value
  )
    throw new Error('Enter a valid workflow date')
  return value
}

function clock(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error('Workflow requires a valid update timestamp')
  return new Date(value).toISOString()
}

function identifier(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))
    throw new Error('Workflow product ID is invalid')
  return value
}

function fields(value, rules) {
  object(value, Object.keys(rules))
  return Object.fromEntries(
    Object.entries(rules)
      .filter(([key]) => own(value, key))
      .map(([key, validate]) => [key, validate(value[key])])
  )
}

function legacyTags(value) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || !entry.trim())
  )
    throw new Error('Workflow source tags are invalid')
  return [...new Set(value.map((entry) => entry.trim()))]
}

function delay(value) {
  const result = fields(value, {
    status: (state) => choice(state, ['delayed', 'none']),
    reason: text,
    originalPromise: text,
    confirmedStart: day,
    confirmedEnd: day,
  })
  if (!result.status) throw new Error('Choose a valid workflow state')
  if (
    result.confirmedEnd &&
    (!result.confirmedStart || result.confirmedEnd < result.confirmedStart)
  )
    throw new Error('The confirmed end date must follow the start date')
  if (
    result.status === 'none' &&
    (result.confirmedStart || result.confirmedEnd)
  )
    throw new Error('A delivery date requires an active delay')
  return result
}

function warehouse(value, product = false) {
  const result = fields(value, {
    status: (state) => choice(state, ['waiting', 'partial', 'received']),
    receivedOn: day,
    ...(product
      ? {
          receivedQuantity: (quantity) => {
            if (typeof quantity !== 'string' || !/^\d+$/.test(quantity))
              throw new Error(
                'Received quantity must be a non-negative whole number'
              )
            return String(BigInt(quantity))
          },
        }
      : {}),
  })
  if (!result.status) throw new Error('Choose a valid workflow state')
  if (
    result.status === 'waiting' &&
    (result.receivedOn || result.receivedQuantity !== undefined)
  )
    throw new Error('Receipt details require a partial or received state')
  return result
}

const missingLabels = (value) => fields(value, { active: boolean, note: text })
const money = (value) => {
  if (typeof value !== 'string' || moneyToCents(value) < 0n)
    throw new Error('Workflow amounts must be non-negative')
  return centsToMoney(moneyToCents(value))
}

export const validateStoreWorkflow = (value = {}) =>
  fields(value, {
    labelPrinting: (state) => choice(state, ['unknown', 'supplier', 'send']),
    labelApplication: (state) => choice(state, ['unknown', 'free', 'paid']),
    shippingRefundPromise: boolean,
    notes: text,
    legacyTags,
  })

export const validateOrderWorkflow = (value = {}) =>
  fields(value, {
    delay,
    instructions: (value) =>
      fields(value, {
        labelsSent: boolean,
        cartonMarksSent: boolean,
        requirementsSent: boolean,
      }),
    labelsDispatchedOn: day,
    warehouse,
    missingLabels,
    refund: (value) =>
      fields(value, {
        actualPaid: money,
        actualFreight: money,
        promisedAmount: money,
        receivedAmount: money,
        notes: text,
      }),
    legacyTags,
  })

export const validateProductWorkflow = (value = {}) =>
  fields(value, {
    delay,
    warehouse: (value) => warehouse(value, true),
    missingLabels,
    features: validateProductFeatures,
    legacyTags,
  })

export function validateProductWorkflowMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Product workflows must be an object')
  return Object.fromEntries(
    Object.entries(value).map(([id, workflow]) => [
      identifier(id),
      validateProductWorkflow(workflow),
    ])
  )
}

/** Validate authored metadata without touching source snapshots or money. */
export function validateOperationsMetadata(input) {
  const result = {}
  for (const [field, validate] of [
    ['storeWorkflow', validateStoreWorkflow],
    ['orderWorkflow', validateOrderWorkflow],
    ['productWorkflow', validateProductWorkflowMap],
  ]) {
    if (own(input, field)) result[field] = validate(input[field])
    const timestamp = `${field}UpdatedAt`
    if (own(input, timestamp)) result[timestamp] = clock(input[timestamp])
    if (
      field !== 'productWorkflow' &&
      Object.keys(result[field] || {}).length &&
      !result[timestamp]
    )
      throw new Error('Workflow requires a valid update timestamp')
  }
  if (own(input, 'productWorkflowPartialClocks')) {
    if (
      !input.productWorkflowPartialClocks ||
      typeof input.productWorkflowPartialClocks !== 'object' ||
      Array.isArray(input.productWorkflowPartialClocks)
    )
      throw new Error('Product workflow clocks must be an object')
    result.productWorkflowPartialClocks = Object.fromEntries(
      Object.entries(input.productWorkflowPartialClocks).map(([id, value]) => [
        identifier(id),
        clock(value),
      ])
    )
  }
  for (const id of Object.keys(result.productWorkflow || {}))
    if (
      !result.productWorkflowUpdatedAt &&
      !result.productWorkflowPartialClocks?.[id]
    )
      throw new Error('Workflow requires a valid update timestamp')
  return result
}

function mergeClocked(previous, incoming, next, field) {
  const timestamp = `${field}UpdatedAt`,
    prior = previous[timestamp] || '',
    current = incoming[timestamp] || ''
  if (current && current === prior && !equal(previous[field], incoming[field]))
    throw new Error('Backup conflict: workflows have the same timestamp')
  if (current <= prior) return next
  const result = { ...next, [timestamp]: current }
  if (Object.keys(incoming[field] || {}).length)
    result[field] = structuredClone(incoming[field])
  else delete result[field]
  return result
}

export const mergeStoreWorkflow = (previous, incoming, next = previous) =>
  mergeClocked(previous, incoming, next, 'storeWorkflow')

/** Product metadata is merged by the repository's common per-entry clock merger. */
export function mergeOperations(previous, incoming, next = previous) {
  return mergeClocked(
    previous,
    incoming,
    mergeStoreWorkflow(previous, incoming, next),
    'orderWorkflow'
  )
}

export function latestStoreWorkflow(records) {
  const newest = records.reduce(
    (latest, record) =>
      (record.storeWorkflowUpdatedAt || '') >
      (latest.storeWorkflowUpdatedAt || '')
        ? record
        : latest,
    {}
  )
  for (const record of records) mergeStoreWorkflow(newest, record)
  return newest
}

export function productWorkflowClock(record, entryId) {
  return [
    record.productWorkflowUpdatedAt || '',
    record.productWorkflowPartialClocks?.[entryId] || '',
  ]
    .sort()
    .at(-1)
}

/** An own false/none/waiting value overrides an order default just like true does. */
export function resolveOperations(record, entryId) {
  const store = record.storeWorkflow || {},
    order = record.orderWorkflow || {},
    product = entryId ? record.productWorkflow?.[entryId] || {} : {},
    effective = {},
    inherited = {}
  for (const field of ['delay', 'warehouse', 'missingLabels']) {
    effective[field] =
      entryId && own(product, field) ? product[field] : order[field]
    inherited[field] = Boolean(
      entryId && !own(product, field) && own(order, field)
    )
  }
  effective.features = product.features || {}
  return {
    store,
    order,
    product,
    effective,
    inherited,
    ready: ['labelsSent', 'cartonMarksSent', 'requirementsSent'].every(
      (field) => order.instructions?.[field] === true
    ),
  }
}

export function workflowRefundPending(record) {
  const { store, order } = resolveOperations(record),
    refund = order.refund || {}
  if (refund.promisedAmount !== undefined)
    return (
      moneyToCents(refund.promisedAmount) >
      moneyToCents(refund.receivedAmount || '0')
    )
  return (
    store.shippingRefundPromise === true && refund.receivedAmount === undefined
  )
}

/** Message keys and values remain separate so seller wording is never translated. */
export function operationsIndicators(
  record,
  { entryId, storeOnly = false, includeInherited = false } = {}
) {
  const { store, order, product, effective, ready, inherited } =
      resolveOperations(record, entryId),
    result = []
  const add = (kind, icon, tone, label, params = {}) =>
    result.push({ kind, icon, tone, label, params })
  if (!entryId) {
    if (store.labelPrinting === 'supplier')
      add('printing', 'printer', 'neutral', 'Supplier prints product labels')
    if (store.labelPrinting === 'send')
      add(
        'printing',
        'dispatch',
        'neutral',
        'Physical product labels must be sent'
      )
    if (store.labelApplication === 'free')
      add('application', 'tag', 'good', 'Store applies product labels free')
    if (store.labelApplication === 'paid')
      add(
        'application',
        'tag',
        'neutral',
        'Store applies product labels for a fee'
      )
  }
  if (!storeOnly) {
    const receipt = effective.warehouse || { status: 'waiting' }
    if (
      entryId
        ? own(product, 'warehouse') || includeInherited
        : own(order, 'warehouse')
    )
      add(
        'receipt',
        'box',
        receipt.status === 'received'
          ? 'good'
          : receipt.status === 'partial'
            ? 'warning'
            : 'neutral',
        receipt.status === 'received'
          ? 'Warehouse received{detail}'
          : receipt.status === 'partial'
            ? 'Warehouse partially received{detail}'
            : 'Waiting for warehouse receipt',
        {
          detail: [
            receipt.receivedOn,
            receipt.receivedQuantity !== undefined
              ? `×${receipt.receivedQuantity}`
              : '',
          ]
            .filter(Boolean)
            .map((value) => ` · ${value}`)
            .join(''),
        }
      )
    if (
      effective.delay?.status === 'delayed' &&
      (!entryId || own(product, 'delay') || includeInherited)
    ) {
      const value = effective.delay
      add('delay', 'clock', 'warning', 'Production delay: {detail}', {
        detail: [
          value.reason,
          value.originalPromise,
          value.confirmedStart
            ? `${value.confirmedStart}${value.confirmedEnd ? ` – ${value.confirmedEnd}` : ''}`
            : '',
        ]
          .filter(Boolean)
          .join(' · '),
      })
    }
    if (
      effective.missingLabels?.active &&
      (!entryId || own(product, 'missingLabels') || includeInherited)
    )
      add(
        'missingLabels',
        'labelWarning',
        'danger',
        'Arrived without product labels{detail}',
        {
          detail: effective.missingLabels.note
            ? ` · ${effective.missingLabels.note}`
            : '',
        }
      )
    if (!entryId && ready)
      add(
        'instructions',
        'check',
        'good',
        'Labels, carton marks and written requirements sent'
      )
    if (!entryId && order.labelsDispatchedOn)
      add(
        'dispatch',
        'dispatch',
        'good',
        'Physical labels dispatched: {date}',
        { date: order.labelsDispatchedOn }
      )
    if (!entryId && workflowRefundPending(record))
      add('refund', 'refund', 'warning', 'Shipping refund needs follow-up')
    if (entryId)
      for (const feature of productFeatures(effective.features)) {
        const preset = ['Lighting', 'Rotation'].includes(feature.name)
          ? feature.name
          : ''
        add(
          feature.key,
          preset === 'Lighting'
            ? 'bulb'
            : preset === 'Rotation'
              ? 'rotation'
              : 'tag',
          'neutral',
          'Product feature: {name} · ¥{cost}/piece · {treatment}',
          {
            name: feature.name,
            cost: feature.unitCost,
            treatment: feature.included
              ? 'Already recorded'
              : 'Additional cost',
          }
        )
        result.at(-1).translateFeatureName =
          effective.features[feature.key] === true
      }
  }
  if (!result.length)
    add('workflow', 'workflow', 'neutral', 'Edit operations workflow')
  return result.map((entry) => ({
    ...entry,
    inherited: Boolean(
      inherited[entry.kind === 'receipt' ? 'warehouse' : entry.kind]
    ),
  }))
}

const normalizeTag = (value) =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')

/** Only anchored, unambiguous operational wording is proposed; financial/code text stays a tag. */
function recognizeTag(tag, product) {
  const normalized = normalizeTag(tag)
  if (
    product &&
    /^(?:con luz|con luces|iluminacion|iluminado|luces|luz)$/.test(normalized)
  )
    return {
      target: 'product',
      patch: { features: { lighting: true } },
      label: 'Lighting',
    }
  if (
    product &&
    /^(?:gira|giratorio|giratoria|rotacion|con rotacion)$/.test(normalized)
  )
    return {
      target: 'product',
      patch: { features: { rotation: true } },
      label: 'Rotation',
    }
  if (
    /^(?:retrasado|retrasada|retraso|demora|demorado)(?:\s*[:–-].+)?$/.test(
      normalized
    )
  )
    return {
      target: product ? 'product' : 'order',
      patch: { delay: { status: 'delayed', originalPromise: tag } },
      label: 'Production delay',
      requiresEditing: true,
    }
  if (
    /^(?:sin etiquetas|llego sin etiquetas|recibido sin etiquetas)$/.test(
      normalized
    )
  )
    return {
      target: product ? 'product' : 'order',
      patch: { missingLabels: { active: true, note: tag } },
      label: 'Arrived without product labels',
    }
  if (
    /^(?:recibido|recibida|recibido en almacen|recibido en bodega)$/.test(
      normalized
    )
  )
    return {
      target: product ? 'product' : 'order',
      patch: { warehouse: { status: 'received' } },
      label: 'Warehouse received{detail}',
      params: { detail: '' },
      requiresEditing: true,
    }
  if (product) return null
  if (/^(?:instrucciones enviadas|requisitos enviados)$/.test(normalized))
    return {
      target: 'order',
      patch: { instructions: { requirementsSent: true } },
      label: 'Written requirements sent',
    }
  if (/^(?:etiquetas enviadas|disenos de etiquetas enviados)$/.test(normalized))
    return {
      target: 'order',
      patch: { instructions: { labelsSent: true } },
      label: 'Label instructions sent',
    }
  if (
    /^(?:marcas de carton enviadas|marcas de caja enviadas)$/.test(normalized)
  )
    return {
      target: 'order',
      patch: { instructions: { cartonMarksSent: true } },
      label: 'Carton-mark instructions sent',
    }
  if (/^(?:imprime etiquetas|proveedor imprime etiquetas)$/.test(normalized))
    return {
      target: 'store',
      patch: { labelPrinting: 'supplier' },
      label: 'Supplier prints product labels',
    }
  if (/^(?:enviar etiquetas fisicas|no imprime etiquetas)$/.test(normalized))
    return {
      target: 'store',
      patch: { labelPrinting: 'send' },
      label: 'Physical product labels must be sent',
    }
  if (/^(?:pega etiquetas gratis|aplica etiquetas gratis)$/.test(normalized))
    return {
      target: 'store',
      patch: { labelApplication: 'free' },
      label: 'Store applies product labels free',
    }
  if (
    /^(?:cobra por pegar etiquetas|cobra por aplicar etiquetas)$/.test(
      normalized
    )
  )
    return {
      target: 'store',
      patch: { labelApplication: 'paid' },
      label: 'Store applies product labels for a fee',
    }
  if (
    /^(?:devuelve exceso de envio|devuelve excedente de envio|reembolsa exceso de flete)$/.test(
      normalized
    )
  )
    return {
      target: 'store',
      patch: { shippingRefundPromise: true },
      label: 'Store promises excess-shipping refunds',
    }
  return null
}

export function mergeWorkflowPatch(previous = {}, patch = {}, tag) {
  const result = structuredClone(previous)
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value))
      result[key] = { ...result[key], ...value }
    else result[key] = value
  }
  if (tag) result.legacyTags = [...new Set([...(result.legacyTags || []), tag])]
  return result
}

function patchConflict(current, patch) {
  return Object.entries(patch).some(([key, value]) => {
    if (!own(current, key)) return false
    if (value && typeof value === 'object' && !Array.isArray(value))
      return patchConflict(current[key], value)
    return current[key] !== value
  })
}

export function migrationFingerprint(record) {
  return JSON.stringify([
    record.snapshot.accountId,
    record.snapshot.orderId,
    record.snapshot.sourceType || '1688',
    record.snapshot.store?.key || '',
    record.snapshot.sellerMemberLogin || '',
    record.snapshot.items.map((item) => [
      item.entryId,
      item.description || item.title || '',
    ]),
    record.tags || [],
    record.productTags || {},
    record.notes || '',
    ...OPERATIONS_METADATA_FIELDS.map((field) => record[field] ?? null),
  ])
}

/** A preview carries source tags and the exact state it reviewed; applying is explicit and atomic. */
export function reviewOperationsMigration(records) {
  const items = [],
    unresolved = []
  for (const record of records) {
    const groups = [
      [undefined, record.tags || []],
      ...Object.entries(record.productTags || {}),
    ]
    for (const [entryId, tags] of groups)
      for (const tag of tags) {
        const identity = {
            accountId: record.snapshot.accountId || 'local',
            orderId: record.snapshot.orderId,
            ...(entryId ? { entryId } : {}),
          },
          recognized =
            entryId &&
            !record.snapshot.items.some((item) => item.entryId === entryId)
              ? null
              : recognizeTag(tag, Boolean(entryId))
        if (!recognized) {
          unresolved.push({ ...identity, tag })
          continue
        }
        const current =
            recognized.target === 'product'
              ? record.productWorkflow?.[entryId]
              : record[`${recognized.target}Workflow`],
          conflict = patchConflict(current || {}, recognized.patch)
        items.push({
          ...identity,
          tag,
          ...recognized,
          conflict,
          id: JSON.stringify([
            identity.accountId,
            identity.orderId,
            entryId || '',
            tag,
          ]),
          before: migrationFingerprint(record),
        })
      }
  }
  return { items, unresolved }
}
