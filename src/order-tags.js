import { readableColor } from './appearance.js'

const tagPalette = [
  ['#f8e4d2', '#7c4c26', '#443022', '#e8bc94'],
  ['#ede7d5', '#69582c', '#3d3724', '#d8c68e'],
  ['#e4eddf', '#4b6339', '#303b28', '#bed3a7'],
  ['#e1eeea', '#3f675b', '#293d35', '#b2d6c8'],
  ['#e2ebf0', '#416276', '#2b3a44', '#b9d0df'],
  ['#eee3ec', '#75536e', '#3e2f3d', '#d9bdd5'],
  ['#f4e1dc', '#804e43', '#432e29', '#e2b8ad'],
  ['#eae5de', '#655a4d', '#39332b', '#cdc2b0'],
]

export function recommendedTagColors(name = '') {
  let hash = 0
  for (const character of name)
    hash = (hash * 31 + character.codePointAt(0)) >>> 0
  const [light, lightText, dark, darkText] =
    tagPalette[hash % tagPalette.length]
  return { light, lightText, dark, darkText }
}

export function normalizeTags(input = [], scope = 'order') {
  const label = scope === 'product' ? 'Product' : 'Order'
  if (!Array.isArray(input)) throw new Error(`${label} tags must be a list`)
  const names = new Set()
  return input.map((entry) => {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim())
      throw new Error(`Each ${scope} tag needs a name`)
    const name = entry.name.trim()
    if (names.has(name)) throw new Error(`${label} tag already exists: ${name}`)
    names.add(name)
    const colors = {},
      textColors = {}
    for (const [field, target] of [
      ['colors', colors],
      ['textColors', textColors],
    ]) {
      for (const mode of ['light', 'dark']) {
        const color = entry[field]?.[mode]
        if (color !== undefined) {
          if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))
            throw new Error(
              `Invalid ${mode} ${field === 'textColors' ? 'text ' : ''}color for ${scope} tag: ${name}`
            )
          target[mode] = color.toLowerCase()
        }
      }
    }
    if (entry.used !== undefined && typeof entry.used !== 'boolean')
      throw new Error(`Tag usage must be true or false: ${name}`)
    return {
      name,
      colors,
      ...(Object.keys(textColors).length ? { textColors } : {}),
      ...(entry.used ? { used: true } : {}),
    }
  })
}

export const normalizeOrderTags = (input) => normalizeTags(input, 'order')

/** Existing string tags remain their identity; creating a tag never renames another. */
export function mergeTags(definitions = [], names = [], scope = 'order') {
  const result = normalizeTags(definitions, scope)
  const known = new Set(result.map((entry) => entry.name))
  for (const raw of names) {
    const name = raw.trim()
    if (name && !known.has(name)) {
      result.push({ name, colors: {} })
      known.add(name)
    }
  }
  return result
}

export const mergeOrderTags = (definitions, names) =>
  mergeTags(definitions, names)

/** Unused Settings entries survive; a previously assigned tag expires with its last use. */
export function reconcileTagCatalog(
  definitions = [],
  assignedNames = [],
  { previous = [], previousNames = [], baseline, scope = 'order' } = {}
) {
  const prior = normalizeTags(previous, scope)
  const previousCatalog = new Set(prior.map((entry) => entry.name))
  const baselineNames = new Set(
    normalizeTags(baseline, scope).map((entry) => entry.name)
  )
  const current = normalizeTags(definitions, scope).filter(
    (entry) => !baselineNames.has(entry.name) || previousCatalog.has(entry.name)
  )
  const byName = new Map(current.map((entry) => [entry.name, entry]))
  for (const entry of prior) {
    if (!byName.has(entry.name)) {
      current.push(entry)
      byName.set(entry.name, entry)
    } else if (entry.used) byName.get(entry.name).used = true
  }
  const assigned = new Set(assignedNames)
  const formerlyAssigned = new Set(previousNames)
  return mergeTags(current, assignedNames, scope).filter((entry) => {
    if (assigned.has(entry.name)) {
      entry.used = true
      return true
    }
    return !entry.used && !formerlyAssigned.has(entry.name)
  })
}

export function assignedTagNames(records, scope = 'order') {
  return records.flatMap((record) =>
    scope === 'product'
      ? Object.values(record.productTags || {}).flat()
      : record.tags || []
  )
}

/** Rename one exact identity; never merge another tag or alter seller snapshots. */
export function renameTagData(
  { definitions = [], orders = [], history = [] },
  previousName,
  requestedName,
  scope = 'order'
) {
  if (!['order', 'product'].includes(scope))
    throw new Error('Choose order or product tags')
  if (typeof requestedName !== 'string' || !requestedName.trim())
    throw new Error('Enter a tag name.')
  const name = requestedName.trim()
  const catalog = mergeTags(definitions, assignedTagNames(orders, scope), scope)
  const entry = catalog.find((tag) => tag.name === previousName)
  if (!entry)
    throw new Error(
      'This tag no longer exists. Reopen Settings to refresh the catalog.'
    )
  const usedNames = assignedTagNames([...orders, ...history], scope)
  if (
    name !== previousName &&
    (catalog.some((tag) => tag.name === name) || usedNames.includes(name))
  )
    throw new Error('This tag already exists. Choose a different name.')
  if (name === previousName)
    return { definitions: catalog, orders, history, renamedAssignments: 0 }
  const colors = orderTagColors(entry)
  const renamed = {
    ...entry,
    name,
    // Name-derived default colors must not change just because the name changes.
    colors: { light: colors.light, dark: colors.dark },
    textColors: { light: colors.lightText, dark: colors.darkText },
    ...(usedNames.includes(previousName) ? { used: true } : {}),
  }
  let renamedAssignments = 0
  const update = (record, count) => {
    const replace = (tags) => {
      if (!tags.includes(previousName)) return tags
      if (count) renamedAssignments += 1
      return tags.map((tag) => (tag === previousName ? name : tag))
    }
    if (scope === 'order') {
      const previous = record.tags || []
      const tags = replace(previous)
      return tags === previous ? record : { ...record, tags }
    }
    const productTags = Object.fromEntries(
      Object.entries(record.productTags || {}).map(([id, tags]) => [
        id,
        replace(tags),
      ])
    )
    return Object.entries(productTags).some(
      ([id, tags]) => tags !== record.productTags[id]
    )
      ? { ...record, productTags }
      : record
  }
  return {
    definitions: catalog.map((tag) => (tag === entry ? renamed : tag)),
    orders: orders.map((record) => update(record, true)),
    history: history.map((record) => update(record, false)),
    renamedAssignments,
  }
}

export function orderTagColors(definition) {
  const defaults = recommendedTagColors(definition?.name)
  const light = definition?.colors?.light || defaults.light
  const dark = definition?.colors?.dark || defaults.dark
  return {
    light,
    dark,
    lightText:
      definition?.textColors?.light ||
      (definition?.colors?.light ? readableColor(light) : defaults.lightText),
    darkText:
      definition?.textColors?.dark ||
      (definition?.colors?.dark ? readableColor(dark) : defaults.darkText),
  }
}

export function parseOrderTagInput(value, definitions = []) {
  const entered = value.trim()
  // Selecting a reusable name from the suggestions must preserve its identity,
  // even when that name contains a comma; otherwise commas separate new tags.
  return definitions.some((entry) => entry.name === entered)
    ? [entered]
    : entered
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
}
