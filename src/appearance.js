// Display preferences only. These never change seller data or printed artwork.
export const APPEARANCE_CACHE = '1688-workspace-appearance'
export const WORKSPACE_COLOR_REVISION = 1
export const THEME_PALETTES = [
  {
    id: 'warm',
    name: 'Warm orange',
    light: '#f6f3ee',
    dark: '#171512',
    accent: '#e8ad63',
  },
  {
    id: '1688',
    name: '1688 orange',
    light: '#fff7f0',
    dark: '#1d1713',
    accent: '#ff9d63',
  },
  {
    id: 'apricot',
    name: 'Soft apricot',
    light: '#fff9f3',
    dark: '#211c18',
    accent: '#edbd8b',
  },
  {
    id: 'terracotta',
    name: 'Terracotta',
    light: '#faf3ef',
    dark: '#211815',
    accent: '#eca18c',
  },
]
export const UI_LABEL_COLORS = [
  ['awaiting-payment', 'Awaiting payment', 'warning'],
  ['awaiting-shipment', 'Awaiting shipment', 'info'],
  ['awaiting-delivery', 'Awaiting delivery', 'info'],
  ['completed', 'Completed', 'success'],
  ['closed', 'Closed', 'hover'],
  ['cancelled', 'Cancelled', 'hover'],
  ['refund-in-progress', 'Refund in progress', 'warning'],
  ['refunded', 'Refunded', 'hover'],
  ['status-unavailable', 'Other statuses', 'hover'],
  ['dates', 'Dates', 'hover'],
  ['saved', 'Saved', 'hover'],
  ['updated', 'Updated', 'hover'],
  ['activity-running', 'Ongoing activity', 'info'],
  ['activity-new', 'New activity', 'success'],
]
// Quiet, distinct roles; row selection and printed artwork use other tokens.
const labelPalette = {
  'awaiting-payment': ['#fff1cf', '#775116', '#45371f', '#f1d28e'],
  'awaiting-shipment': ['#ffe7d5', '#8a4b22', '#472e21', '#ffc79d'],
  'awaiting-delivery': ['#e3edf2', '#315d72', '#253a43', '#b7d6e4'],
  completed: ['#e7efdc', '#47612c', '#2c3b27', '#c2d7aa'],
  closed: ['#eae4dd', '#62574c', '#38312b', '#cfc1b2'],
  cancelled: ['#f4e1dd', '#824d46', '#452e2b', '#e6bcb4'],
  'refund-in-progress': ['#efe3ee', '#74536f', '#3f2e3e', '#dbc0d9'],
  refunded: ['#e9e5ed', '#62566e', '#36303f', '#cbc0d9'],
  'status-unavailable': ['#e8e7e3', '#5d5c55', '#32332f', '#c9c9bc'],
  dates: ['#eee8dc', '#6d5d3d', '#393427', '#d7c8a6'],
  saved: ['#e5ebe9', '#4a625b', '#2c3733', '#bdcec6'],
  updated: ['#eee6d8', '#715c3d', '#3a3328', '#d7c6a8'],
  'activity-running': ['#f8e3d6', '#854a2a', '#452e22', '#edbea0'],
  'activity-new': ['#e0eee9', '#3b655b', '#263d35', '#b4d8cb'],
}
const light = {
  page: '#f6f3ee',
  surface: '#fffdf9',
  text: '#2c2723',
  muted: '#6f6358',
  border: '#d8cfc3',
  divider: '#e9e1d6',
  hover: '#eee6da',
  field: '#faf7f1',
  accent: '#c74335',
  'accent-hover': '#ab342b',
  'on-accent': '#fffdf9',
  'accent-text': '#855621',
  'control-accent': '#9b5b25',
  selected: '#eee7db',
  success: '#eaf1df',
  'success-text': '#48652b',
  warning: '#fff2ce',
  'warning-text': '#785516',
  'warning-border': '#e9d4a5',
  info: '#f2e5dd',
  'info-text': '#875237',
  danger: '#fce8e2',
  'danger-text': '#9c3542',
  changed: '#fffaf0',
  thumb: '#ede5da',
  focus: '#95511d',
  feedback: '#45382b',
  'on-feedback': '#fffdf9',
  error: '#b5363e',
  'on-error': '#fffdf9',
  'variant-code': '#855621',
  'size-code': '#9a4435',
  'product-name': '#82471e',
  'category-text': '#38645c',
  'material-text': '#596331',
  'attribute-label': '#705c4b',
  'amount-text': '#805a24',
  'quantity-text': '#486078',
  'description-text': '#4a4038',
}
const dark = {
  page: '#171512',
  surface: '#24211d',
  text: '#f3eee5',
  muted: '#c2b5a2',
  border: '#544a3e',
  divider: '#3d352c',
  hover: '#332d25',
  field: '#1d1a16',
  accent: '#fb8b79',
  'accent-hover': '#ff9d8d',
  'on-accent': '#291714',
  'accent-text': '#e8bd7c',
  'control-accent': '#e8ad63',
  selected: '#39342c',
  success: '#2c3824',
  'success-text': '#bbd99b',
  warning: '#43351c',
  'warning-text': '#f1ce86',
  'warning-border': '#705c33',
  info: '#402e23',
  'info-text': '#edbd97',
  danger: '#482824',
  'danger-text': '#ffb6a6',
  changed: '#393023',
  thumb: '#393126',
  focus: '#e8b875',
  feedback: '#493a29',
  'on-feedback': '#fff4e3',
  error: '#f5a099',
  'on-error': '#381918',
  'variant-code': '#e8bd7c',
  'size-code': '#f1aa98',
  'product-name': '#e3ad7c',
  'category-text': '#a6c8c1',
  'material-text': '#bec396',
  'attribute-label': '#bead9b',
  'amount-text': '#dec18e',
  'quantity-text': '#b4c3d6',
  'description-text': '#ddd2c5',
}
const variants = {
  1688: {
    light: {
      page: '#fff7f0',
      surface: '#fffcf8',
      field: '#fffaf5',
      hover: '#f7e8db',
      selected: '#f2e1d3',
      accent: '#b7470d',
      'accent-hover': '#963b0d',
      'accent-text': '#854217',
      'control-accent': '#a4430e',
      focus: '#9e400b',
    },
    dark: {
      page: '#1d1713',
      surface: '#2b221c',
      field: '#211a15',
      hover: '#392b20',
      selected: '#403023',
      accent: '#ff9d63',
      'accent-hover': '#ffb17d',
      'on-accent': '#321a0d',
      'control-accent': '#f5aa72',
      focus: '#f5aa72',
    },
  },
  apricot: {
    light: {
      page: '#fff9f3',
      surface: '#fffdf9',
      field: '#fffaf5',
      hover: '#f3e8dc',
      selected: '#eee1d4',
      accent: '#aa521e',
      'accent-hover': '#8d4218',
      'accent-text': '#814d25',
      'control-accent': '#955221',
    },
    dark: {
      page: '#211c18',
      surface: '#2b251f',
      field: '#231d17',
      hover: '#383026',
      selected: '#3d3429',
      accent: '#edbd8b',
      'accent-hover': '#f5cda8',
      'on-accent': '#302115',
      'control-accent': '#edbd8b',
    },
  },
  terracotta: {
    light: {
      muted: '#685a4f',
      page: '#faf3ef',
      surface: '#fffaf7',
      field: '#fcf6f1',
      hover: '#eee2db',
      selected: '#f0e5de',
      accent: '#ac482d',
      'accent-hover': '#903b27',
      'accent-text': '#804329',
      'control-accent': '#9b4c2e',
    },
    dark: {
      page: '#211815',
      surface: '#2d221e',
      field: '#241a16',
      hover: '#3b2b24',
      selected: '#403028',
      accent: '#eca18c',
      'accent-hover': '#f6b7a2',
      'on-accent': '#351b13',
      'control-accent': '#efac91',
    },
  },
}
export function normalizeAppearance(input = {}) {
  const known = new Set(THEME_PALETTES.map((theme) => theme.id))
  const result = {
    lightTheme: known.has(input?.lightTheme) ? input.lightTheme : 'warm',
    darkTheme: known.has(input?.darkTheme) ? input.darkTheme : 'warm',
    labelColors: {},
    ...(Number.isSafeInteger(input?.paletteRevision) &&
    input.paletteRevision > 0
      ? { paletteRevision: input.paletteRevision }
      : {}),
  }
  for (const [key] of UI_LABEL_COLORS) {
    const colors = {}
    for (const mode of ['light', 'dark']) {
      const value = input?.labelColors?.[key]?.[mode]
      if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
        colors[mode] = value.toLowerCase()
    }
    if (Object.keys(colors).length) result.labelColors[key] = colors
    const textColors = {}
    for (const mode of ['light', 'dark']) {
      const value = input?.labelTextColors?.[key]?.[mode]
      if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
        textColors[mode] = value.toLowerCase()
    }
    if (Object.keys(textColors).length) {
      result.labelTextColors ??= {}
      result.labelTextColors[key] = textColors
    }
  }
  return result
}
/** An explicit reset affects display colors only; names, assignments and themes stay intact. */
export function resetWorkspaceColors(preferences) {
  const { labelTextColors, ...appearance } = normalizeAppearance(
    preferences.appearance
  )
  return {
    ...preferences,
    appearance: {
      ...appearance,
      labelColors: {},
      paletteRevision: WORKSPACE_COLOR_REVISION,
    },
    ...Object.fromEntries(
      ['orderTags', 'productTags']
        .filter((key) => preferences[key])
        .map((key) => [
          key,
          preferences[key].map(({ colors, textColors, ...tag }) => ({
            ...tag,
            colors: {},
          })),
        ])
    ),
  }
}
/** Owner-requested one-time reseed. Later color edits and versioned backups survive. */
export function upgradeWorkspaceColors(preferences) {
  return preferences.appearance?.paletteRevision >= WORKSPACE_COLOR_REVISION
    ? preferences
    : resetWorkspaceColors(preferences)
}
export function contrastRatio(first, second) {
  const luminance = (hex) => {
    const channels = hex
      .slice(1)
      .match(/../g)
      .map((part) => parseInt(part, 16) / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      )
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  const a = luminance(first),
    b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
export function readableColor(background) {
  return contrastRatio('#000000', background) >=
    contrastRatio('#ffffff', background)
    ? '#000000'
    : '#ffffff'
}
/** Curated pairs retain quiet surfaces and readable colored text in both modes. */
export function randomizeReadableColors(current = {}, random = Math.random) {
  const choices = Object.values(labelPalette).filter(
    ([light, , dark]) => light !== current.light && dark !== current.dark
  )
  const sample = Math.max(0, Math.min(0.999999, Number(random()) || 0))
  const [light, lightText, dark, darkText] =
    choices[Math.floor(sample * choices.length)]
  return { light, lightText, dark, darkText }
}
export function appearanceTokens(input, mode) {
  const value = normalizeAppearance(input)
  const theme = value[`${mode}Theme`]
  const tokens = {
    ...(mode === 'dark' ? dark : light),
    ...variants[theme]?.[mode],
  }
  for (const [key] of UI_LABEL_COLORS) {
    const offset = mode === 'dark' ? 2 : 0
    const background =
      value.labelColors[key]?.[mode] || labelPalette[key][offset]
    tokens[`label-${key}-bg`] = background
    const foreground = value.labelTextColors?.[key]?.[mode]
    tokens[`label-${key}-text`] =
      foreground && contrastRatio(foreground, background) >= 4.5
        ? foreground
        : value.labelColors[key]?.[mode]
          ? readableColor(background)
          : labelPalette[key][offset + 1]
  }
  return tokens
}
export function labelColorKey(label) {
  return (
    UI_LABEL_COLORS.find(([, name]) => name === label)?.[0] ||
    'status-unavailable'
  )
}
/** IndexedDB preferences are authoritative. This small derived cache only prevents a wrong-color first paint. */
export function applyAppearance(input) {
  const cache = {
    light: appearanceTokens(input, 'light'),
    dark: appearanceTokens(input, 'dark'),
  }
  try {
    globalThis.localStorage?.setItem(APPEARANCE_CACHE, JSON.stringify(cache))
  } catch {}
  globalThis.dispatchEvent?.(
    new CustomEvent('workspace-appearance-change', { detail: cache })
  )
}
