// Print settings, A4 presets and recent export jobs, kept in this browser's
// local storage. Labels and carton marks remember their settings separately.
import {
  DEFAULT_PRESET,
  normalizeLabelLayout,
  normalizeMarkLayout,
} from './print-layout.js'

export const PRINT_KEYS = Object.freeze({
  labels: '1688-print-labels',
  marks: '1688-print-carton-marks',
  presets: '1688-print-presets',
  recent: '1688-print-recent',
})
export const RECENT_LIMIT = 5
/** Larger exports are not kept in history rather than kept incomplete. */
export const RECENT_PRODUCT_LIMIT = 500
const PRESET_LIMIT = 20

function safeStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

const normalize = (kind, value) =>
  kind === 'marks' ? normalizeMarkLayout(value) : normalizeLabelLayout(value)

// Ids never derive from the name: any two distinct names stay distinct presets.
const newPresetId = () =>
  `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function cleanPreset(input) {
  const name = String(input?.name ?? '')
    .trim()
    .slice(0, 40)
  if (!name) return null
  const layout = normalizeLabelLayout(input)
  return {
    id: String(input.id || newPresetId()).slice(0, 64),
    name,
    marginMm: layout.marginMm,
    offsetXMm: layout.offsetXMm,
    offsetYMm: layout.offsetYMm,
  }
}

/** Where a product lives: its order, group and (for labels) variant ids. */
function cleanRef(ref) {
  const text = (value) =>
    typeof value === 'string' && value && value.length <= 200 ? value : null
  if (!ref || !text(ref.orderId) || !text(ref.groupId)) return null
  return {
    orderId: ref.orderId,
    groupId: ref.groupId,
    variantId: text(ref.variantId),
  }
}
export const refKey = (ref) =>
  ref ? `${ref.orderId}/${ref.groupId}/${ref.variantId ?? ''}` : ''

function cleanJob(input) {
  if (!input || !['labels', 'marks'].includes(input.kind)) return null
  if (
    !Array.isArray(input.products) ||
    input.products.length > RECENT_PRODUCT_LIMIT
  )
    return null
  const products = Array.isArray(input.products)
    ? input.products
        .filter((product) => typeof product?.code === 'string' && product.code)
        .map((product) => ({
          code: product.code,
          ...(cleanRef(product.ref) ? { ref: cleanRef(product.ref) } : {}),
          name:
            typeof product.name === 'string' ? product.name.slice(0, 120) : '',
          quantity: Math.max(0, Math.floor(Number(product.quantity)) || 0),
          ...(product.cap === null ||
          product.cap === undefined ||
          product.cap === ''
            ? {}
            : { cap: Math.max(0, Math.floor(Number(product.cap)) || 0) }),
        }))
    : []
  if (!products.length) return null
  const date = new Date(input.date)
  return {
    id: String(input.id || `${input.kind}-${date.getTime()}`).slice(0, 80),
    kind: input.kind,
    date: Number.isNaN(date.getTime())
      ? new Date(0).toISOString()
      : date.toISOString(),
    products,
    layout: normalize(input.kind, input.layout),
    pages: Math.max(0, Math.floor(Number(input.pages)) || 0),
    total: Math.max(0, Math.floor(Number(input.total)) || 0),
  }
}

/** Settings, presets and recent jobs over a Storage-like object. */
export function createPrintStore(storage = safeStorage()) {
  const read = (key, fallback) => {
    try {
      const value = JSON.parse(storage?.getItem(key) ?? 'null')
      return value ?? fallback
    } catch {
      return fallback
    }
  }
  const write = (key, value) => {
    try {
      storage?.setItem(key, JSON.stringify(value))
    } catch {}
  }
  const store = {
    layout(kind) {
      return normalize(kind, read(PRINT_KEYS[kind], {}))
    },
    saveLayout(kind, layout) {
      const value = normalize(kind, layout)
      write(PRINT_KEYS[kind], value)
      return value
    },
    presets() {
      const custom = read(PRINT_KEYS.presets, [])
      return [
        { ...DEFAULT_PRESET },
        ...(Array.isArray(custom) ? custom : [])
          .map(cleanPreset)
          .filter((preset) => preset && preset.id !== DEFAULT_PRESET.id),
      ]
    },
    /** Save or replace a named preset; returns it. */
    savePreset(input) {
      const name = String(input?.name ?? '').trim()
      // Saving under an existing name replaces that preset and keeps its id.
      const existing = store
        .presets()
        .slice(1)
        .find((entry) => entry.name === name)
      const preset = cleanPreset({
        ...input,
        id: existing?.id ?? newPresetId(),
      })
      if (!preset) throw new Error('Name the preset first.')
      if (
        preset.name === DEFAULT_PRESET.name ||
        preset.id === DEFAULT_PRESET.id
      )
        throw new Error(
          'Choose another name; the default preset stays as it is.'
        )
      const others = store
        .presets()
        .slice(1)
        .filter((entry) => entry.id !== preset.id && entry.name !== preset.name)
      write(PRINT_KEYS.presets, [...others, preset].slice(-PRESET_LIMIT))
      return preset
    },
    deletePreset(id) {
      if (id === DEFAULT_PRESET.id) return
      write(
        PRINT_KEYS.presets,
        store
          .presets()
          .slice(1)
          .filter((entry) => entry.id !== id)
      )
    },
    recentJobs() {
      const jobs = read(PRINT_KEYS.recent, [])
      return (Array.isArray(jobs) ? jobs : [])
        .map(cleanJob)
        .filter(Boolean)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, RECENT_LIMIT)
    },
    /** Remember an export; the five most recent across both types are kept. */
    recordJob(input) {
      const job = cleanJob({
        ...input,
        date: input.date ?? new Date().toISOString(),
      })
      if (!job) return null
      write(
        PRINT_KEYS.recent,
        [
          job,
          ...store.recentJobs().filter((entry) => entry.id !== job.id),
        ].slice(0, RECENT_LIMIT)
      )
      return job
    },
  }
  return store
}

/**
 * Rebuild a recent job against current product data. Products are found again
 * by their order, group and variant, never by code alone: a released code can
 * belong to another product now. `current` holds the entries found for the
 * job's references (each with its `ref`); quantities and caps come from the job.
 */
export function restoreJob(job, current) {
  const byRef = new Map(current.map((item) => [refKey(item.ref), item]))
  const items = new Map()
  const missing = []
  const changed = []
  for (const product of job.products) {
    const item = product.ref ? byRef.get(refKey(product.ref)) : undefined
    if (!item) {
      missing.push(product)
      continue
    }
    if (item.code !== product.code)
      changed.push({ from: product.code, to: item.code })
    const existing = items.get(item.key)
    if (existing) existing.quantity += product.quantity
    else
      items.set(item.key, {
        ...item,
        quantity: product.quantity,
        ...(product.cap === undefined ? {} : { cap: product.cap }),
      })
  }
  return {
    items: [...items.values()],
    missing,
    changed,
    layout: job.layout,
    kind: job.kind,
    date: job.date,
  }
}
