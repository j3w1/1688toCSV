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

function cleanPreset(input) {
  const name = String(input?.name ?? '')
    .trim()
    .slice(0, 40)
  if (!name) return null
  const layout = normalizeLabelLayout(input)
  return {
    id: String(
      input.id || `preset-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    ).slice(0, 64),
    name,
    marginMm: layout.marginMm,
    offsetXMm: layout.offsetXMm,
    offsetYMm: layout.offsetYMm,
  }
}

function cleanJob(input) {
  if (!input || !['labels', 'marks'].includes(input.kind)) return null
  const products = Array.isArray(input.products)
    ? input.products
        .filter((product) => typeof product?.code === 'string' && product.code)
        .slice(0, 500)
        .map((product) => ({
          code: product.code,
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
      const preset = cleanPreset(input)
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
 * Rebuild a recent job against current product data. `current` holds the
 * products found now (by code); quantities and caps come from the job.
 */
export function restoreJob(job, current) {
  const byCode = new Map(current.map((item) => [item.code, item]))
  const items = []
  const missing = []
  for (const product of job.products) {
    const item = byCode.get(product.code)
    if (!item) {
      missing.push(product)
      continue
    }
    items.push({
      ...item,
      quantity: product.quantity,
      ...(product.cap === undefined ? {} : { cap: product.cap }),
    })
  }
  return { items, missing, layout: job.layout, kind: job.kind, date: job.date }
}
