import { appearanceTokens, readableColor } from './appearance.js'

export const EXCEL_IMAGE_SCHEMES = Object.freeze([
  { id: 'neutral', label: 'Neutral', accent: '#49453f' },
  { id: 'warm', label: 'Warm', accent: '#775435' },
  { id: 'sage', label: 'Sage', accent: '#466153' },
  { id: 'ink', label: 'Ink', accent: '#303030' },
  { id: 'custom', label: 'Custom', accent: '#49453f' },
])

export const EXCEL_IMAGE_DETAILS = Object.freeze({
  seller: true,
  orderNumber: true,
  date: false,
  status: false,
  orderTags: false,
  title: true,
  specifications: true,
  model: true,
  productTags: false,
})

const workspacePaletteKeys = [
  'header',
  'headerText',
  'store',
  'order',
  'stripe',
  'separator',
  'grid',
  'body',
  'text',
  'muted',
]

function workspacePalette(value) {
  if (
    !workspacePaletteKeys.every(
      (key) =>
        typeof value?.[key] === 'string' && /^#[0-9a-f]{6}$/i.test(value[key])
    )
  )
    return null
  return Object.freeze(
    Object.fromEntries(
      workspacePaletteKeys.map((key) => [key, value[key].toLowerCase()])
    )
  )
}

/** Use the selected theme's light palette, independent of the workspace mode. */
export function workspaceExportStyle(
  root = globalThis.document?.documentElement
) {
  const defaults = appearanceTokens({}, 'light')
  const computed = root
    ? (root.ownerDocument?.defaultView || globalThis).getComputedStyle?.(root)
    : null
  const value =
    computed?.getPropertyValue('--excel-accent').trim() ||
    computed?.getPropertyValue('--accent').trim()
  const accent = /^#[0-9a-f]{6}$/i.test(value || '')
    ? value.toLowerCase()
    : defaults.accent
  return Object.freeze({
    scheme: 'custom',
    accent,
    workspace: excelImagePalette({ scheme: 'custom', accent }),
  })
}

/** Appearance affects only the generated picture, never source or label data. */
export function normalizeExcelImageDisplay(value) {
  const scheme =
    EXCEL_IMAGE_SCHEMES.find((entry) => entry.id === value?.style?.scheme) ||
    EXCEL_IMAGE_SCHEMES[0]
  const workspace = workspacePalette(value?.style?.workspace)
  return {
    showOrderDetails: value?.showOrderDetails !== false,
    style: {
      scheme: scheme.id,
      accent:
        typeof value?.style?.accent === 'string' &&
        /^#[0-9a-f]{6}$/i.test(value.style.accent)
          ? value.style.accent.toLowerCase()
          : scheme.accent,
      ...(workspace ? { workspace } : {}),
    },
    details: Object.fromEntries(
      Object.entries(EXCEL_IMAGE_DETAILS).map(([key, fallback]) => [
        key,
        typeof value?.details?.[key] === 'boolean'
          ? value.details[key]
          : fallback,
      ])
    ),
  }
}

function tint(hex, amount) {
  return (
    '#' +
    hex
      .slice(1)
      .match(/../g)
      .map((part) => {
        const channel = parseInt(part, 16)
        return Math.round(channel + (255 - channel) * amount)
          .toString(16)
          .padStart(2, '0')
      })
      .join('')
  )
}

export function excelImagePalette(style) {
  const workspace = workspacePalette(style?.workspace)
  if (workspace) return workspace
  const normalized = normalizeExcelImageDisplay({ style }).style
  const scheme = EXCEL_IMAGE_SCHEMES.find(
    (entry) => entry.id === normalized.scheme
  )
  const accent = scheme.id === 'custom' ? normalized.accent : scheme.accent
  return Object.freeze({
    header: accent,
    headerText: readableColor(accent),
    store: tint(accent, 0.9),
    order: tint(accent, 0.95),
    stripe: tint(accent, 0.985),
    separator: tint(accent, 0.55),
    grid: tint(accent, 0.8),
    body: '#ffffff',
    text: '#24211c',
    muted: '#746757',
  })
}
