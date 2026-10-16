import { normalizePrice } from './money.js'

// Literal local aliases only. Product titles and article numbers are not size
// evidence; measured sizes are compared in compatible units, without area guesses.
export const SIZE_VOCABULARY_VERSION = 1

export const DEFAULT_SIZE_VOCABULARY = Object.freeze(
  [
    ['XXXS', 'XXXS'],
    ['3XS', '3XS'],
    ['XXS', 'XXS'],
    ['2XS', '2XS'],
    ['XS|加小号|特小号|特别小号|超小号|特小', 'XS'],
    ['S|小号|小码|小尺寸|小', 'S'],
    ['M|中号|中码|中尺寸|中', 'M'],
    ['L|大号|大码|大尺寸|大', 'L'],
    ['XL|加大号|特大号|特别大号|超大号|特大|超大|加大', 'XL'],
    ['XXL|加加大号', 'XXL'],
    ['2XL', '2XL'],
    ['XXXL', 'XXXL'],
    ['3XL', '3XL'],
    ['4XL', '4XL'],
    ['5XL', '5XL'],
    ['6XL', '6XL'],
    ['A3', 'A3'],
    ['A4', 'A4'],
    ['A5', 'A5'],
    ['A6', 'A6'],
  ].map(([match, suffix]) => Object.freeze({ match, suffix }))
)

const rankedSuffixes = {
  2: ['S', 'L'],
  3: ['S', 'M', 'L'],
  4: ['S', 'M', 'L', 'XL'],
  5: ['XS', 'S', 'M', 'L', 'XL'],
}
const units = {
  mm: ['length', 1],
  毫米: ['length', 1],
  cm: ['length', 10],
  厘米: ['length', 10],
  公分: ['length', 10],
  m: ['length', 1000],
  米: ['length', 1000],
  ml: ['capacity', 1],
  毫升: ['capacity', 1],
  l: ['capacity', 1000],
  升: ['capacity', 1000],
  g: ['mass', 1],
  克: ['mass', 1],
  kg: ['mass', 1000],
  千克: ['mass', 1000],
  公斤: ['mass', 1000],
  inch: ['inch', 1],
  in: ['inch', 1],
  英寸: ['inch', 1],
  // 寸 can be a nominal seller size. Compare like units without assuming its
  // conversion to centimetres or to an international inch.
  寸: ['cun', 1],
}
const sizeLabel =
  /^(?:尺寸(?:规格)?|规格尺寸|(?:内框|外框)尺寸|尺码|大小|规格|size|容量|容积|长度|宽度|高度|直径|重量|净含量)(?:\(.*\))?$/i
const identifierLabel =
  /^(?:货号|款号|商品编号|产品编号|编号|型号|model|item\s*(?:no\.?|number))$/i
const normalize = (value) => value.normalize('NFKC').trim()
const keyText = (value) => normalize(value).toLowerCase().replace(/\s+/g, ' ')
const numberPattern = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`
const unitPattern = Object.keys(units)
  .sort((a, b) => b.length - a.length)
  .join('|')
const axisNames = {
  长度: 'length',
  长: 'length',
  宽度: 'width',
  宽: 'width',
  高度: 'height',
  高: 'height',
  深度: 'depth',
  深: 'depth',
  厚度: 'thickness',
  厚: 'thickness',
  直径: 'diameter',
  口径: 'opening',
  底径: 'base',
}
const axisPattern = Object.keys(axisNames)
  .sort((a, b) => b.length - a.length)
  .join('|')
const amountPattern = `${numberPattern}\\s*(?:${unitPattern})?`
const namedPartPattern = `(?:${axisPattern})\\s*-?\\s*${amountPattern}`
const partPattern = `(?:${namedPartPattern}|${amountPattern})`
const measurementPattern = new RegExp(
  `(?<![a-z0-9.])${partPattern}(?:\\s*[x×*]\\s*${partPattern}|\\s*[,，]?\\s*${namedPartPattern}){0,3}(?![a-z0-9.])`,
  'gi'
)
const componentPattern = new RegExp(
  `(?:(?<axis>${axisPattern})\\s*(?<namedAmount>-?\\s*${numberPattern})|(?<amount>${numberPattern}))\\s*(?<unit>${unitPattern})?`,
  'gi'
)
const adjacentMeasurements = new RegExp(
  `(\\d\\s*(?:${unitPattern}))(?=\\d)`,
  'gi'
)

export function validateSizeVocabulary(input) {
  if (!Array.isArray(input) || input.length > 500)
    throw new Error('Size rules must be a list with at most 500 entries')
  const seen = new Set()
  return input.map((entry, index) => {
    const label = `Size rule ${index + 1}`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error(`${label} must be an object`)
    if (
      typeof entry.match !== 'string' ||
      !entry.match.trim() ||
      entry.match.length > 1000
    )
      throw new Error(`${label} needs size names separated by |`)
    if (
      typeof entry.suffix !== 'string' ||
      !/^[A-Z0-9]{1,12}$/.test(entry.suffix.trim().toUpperCase())
    )
      throw new Error(`${label} needs a code of 1–12 letters or numbers`)
    const aliases = entry.match.split('|').map(normalize)
    for (const alias of aliases) {
      if (!alias || alias.length > 100 || !/[\p{L}\p{N}]/u.test(alias))
        throw new Error(`${label} contains an empty or invalid size name`)
      const key = keyText(alias)
      if (seen.has(key))
        throw new Error(
          `The size name “${alias}” appears in more than one rule`
        )
      seen.add(key)
    }
    return {
      match: aliases.join('|'),
      suffix: entry.suffix.trim().toUpperCase(),
    }
  })
}

function trimRemainder(value) {
  return value
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/^[\s,，;；:/+|\-]+|[\s,，;；:/+|\-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function remainingText(source, spans) {
  // These strings use BMP size tokens. Slice by UTF-16 offsets rather than
  // code-point indices so an emoji before a size cannot remove the wrong text.
  let result = '',
    offset = 0
  for (const span of spans.sort((a, b) => a.start - b.start)) {
    if (span.start >= offset) result += source.slice(offset, span.start)
    offset = Math.max(offset, span.end)
  }
  result += source.slice(offset)
  return trimRemainder(result)
}

function measurement(match) {
  const parts = [...match[0].matchAll(componentPattern)]
  const lastUnit = parts
    .findLast((part) => part.groups.unit)
    ?.groups.unit?.toLowerCase()
  const dimensions = parts.map((part) => {
    const unit = (part.groups.unit || lastUnit || '').toLowerCase()
    const [kind, scale] = unit ? units[unit] : ['number', 1]
    // The decimal conversion is exact enough for ordering after rounding away
    // binary artefacts (for example 0.3m and 30cm).
    return {
      kind,
      axis: axisNames[part.groups.axis],
      value: Number(
        (
          Number(part.groups.namedAmount ?? part.groups.amount) * scale
        ).toPrecision(12)
      ),
    }
  })
  const named = dimensions.some((part) => part.axis)
  const completeAxes =
    !named ||
    (dimensions.every((part) => part.axis) &&
      new Set(dimensions.map((part) => part.axis)).size === dimensions.length)
  if (named && completeAxes)
    dimensions.sort((a, b) => a.axis.localeCompare(b.axis))
  return {
    start: match.index,
    end: match.index + match[0].length,
    hasUnit: Boolean(lastUnit),
    unit: lastUnit,
    ...(named ? { axes: dimensions.map((part) => part.axis) } : {}),
    values: dimensions.map((part) => part.value),
    dimension: dimensions[0]?.kind,
    valid:
      dimensions.length > 0 &&
      completeAxes &&
      dimensions.every(
        (part) =>
          part.kind === dimensions[0].kind &&
          (!named || ['length', 'number', 'inch', 'cun'].includes(part.kind)) &&
          Number.isFinite(part.value) &&
          part.value > 0
      ),
  }
}

function parseSize(value, aliases, allowUnitless = true) {
  const source = normalize(value)
    .replace(adjacentMeasurements, '$1 ')
    .replace(
      /(^|[\s([])([2-6]XL|X{0,3}[SML])(?=\d+(?:\.\d+)?\s*[x×*])/gi,
      '$1$2 '
    )
  if (!source) return { kind: 'missing', remainder: '', tokens: '' }
  const lower = source.toLowerCase()
  const measured = [...source.matchAll(measurementPattern)]
    .map(measurement)
    .filter(
      (entry) =>
        !(entry.unit === '米' && /^[白色黄灰]/.test(source.slice(entry.end))) &&
        (entry.hasUnit ||
          entry.axes ||
          entry.values.length > 1 ||
          source.slice(entry.start, entry.end).trim() === source)
    )
  const names = []
  for (const alias of aliases) {
    if (!allowUnitless && /^\d+(?:\.\d+)?$/.test(alias.name)) continue
    let at = lower.indexOf(alias.name)
    while (at !== -1) {
      const end = at + alias.name.length
      const bounded =
        (!/^[a-z0-9]/.test(alias.name) ||
          !/[a-z0-9]/i.test(source[at - 1] || '')) &&
        (!/[a-z0-9]$/.test(alias.name) || !/[a-z0-9]/i.test(source[end] || ''))
      const standaloneChinese =
        alias.name.length !== 1 ||
        !/[\u3400-\u9fff]/.test(alias.name) ||
        ((!source[at - 1] || /[\s(\[【,，;；:：/+-]/.test(source[at - 1])) &&
          (!source[end] || /[\s()\[\]【】,，;；:：/+-]/.test(source[end])))
      if (
        bounded &&
        standaloneChinese &&
        !(
          units[alias.name] &&
          measured.some((entry) => at >= entry.start && end <= entry.end)
        ) &&
        !names.some((name) => at < name.end && end > name.start)
      )
        names.push({ start: at, end, suffix: alias.suffix })
      at = lower.indexOf(alias.name, at + 1)
    }
  }
  const hasMeasurements = measured.some((entry) => entry.hasUnit)
  const measurements = measured.filter(
    (entry) =>
      allowUnitless || hasMeasurements || entry.axes || entry.values.length > 1
  )
  const spans = [...names, ...measurements]
  const remainder = remainingText(source, spans)
  const tokens = spans
    .sort((a, b) => a.start - b.start)
    .map((span) => source.slice(span.start, span.end).trim())
    .join(' ')
  if (names.length) {
    const suffixes = new Set(names.map((name) => name.suffix))
    if (suffixes.size > 1) return { kind: 'ambiguous', remainder, tokens }
    return { kind: 'named', suffix: names[0].suffix, remainder, tokens }
  }
  if (!measurements.length)
    return { kind: 'unknown', remainder: source, tokens: '' }
  if (
    measurements.some((entry) => !entry.valid) ||
    /(?:^|[\s(])-\s*\d|\d[,，]\d/.test(source)
  )
    return { kind: 'ambiguous', remainder, tokens }
  if (
    measurements.length > 1 ||
    /[x×*]/i.test(remainder) ||
    /\d\s*[-~～至到+/]\s*\d/.test(source)
  )
    return { kind: 'composite', remainder, tokens }
  const { dimension, values, axes } = measurements[0]
  return {
    kind: 'measurement',
    dimension,
    values,
    ...(axes ? { axes } : {}),
    remainder,
    tokens,
  }
}

function descriptionProperties(item) {
  const description =
    typeof item.description === 'string' ? item.description : ''
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  const content =
    title && description.trim().startsWith(title)
      ? description.trim().slice(title.length)
      : description
  const lines = content
    .split(/[\r\n;；]+/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.flatMap((line, index) => {
    const labelled = /^([^:：]{1,30})[:：]\s*(.+)$/.exec(line)
    if (labelled) {
      const label = normalize(labelled[1])
      if (identifierLabel.test(label)) return []
      if (
        index === 0 &&
        content === description &&
        !sizeLabel.test(label) &&
        !/^(?:颜色|色号|款式|香型|材质|规格|color|variant)$/i.test(label)
      )
        return []
      return [{ label, value: labelled[2].trim() }]
    }
    // The first unlabelled line is the title in older exports.
    return index === 0 && content === description
      ? []
      : [{ label: '', value: line }]
  })
}

function extract(item, aliases) {
  const properties = item.skuProperties?.length
    ? item.skuProperties
    : descriptionProperties(item)
  const variantProperties = []
  const sizeSources = []
  for (const property of properties) {
    const label = (property.label || '').trim()
    const value = (property.value || '').trim()
    if (!value) continue
    const explicit = sizeLabel.test(normalize(label))
    const parsed = identifierLabel.test(label)
      ? { kind: 'unknown' }
      : parseSize(value, aliases, explicit)
    const recognized = !['unknown', 'missing'].includes(parsed.kind)
    const unknownSize =
      explicit &&
      (/均码|均号|可调|可伸缩|尺寸|看图|看图片|如图|看详情|short|long|small|large|\d\s*[-~～至到/]\s*\d/i.test(
        value
      ) ||
        (/长.*宽|宽.*长/.test(label) && /\d\s+\d/.test(value)) ||
        /^\d+(?:\.\d+)?(?:\s+\d+(?:\.\d+)?){1,2}$/.test(value))
    if (recognized || unknownSize) {
      sizeSources.push(explicit ? value : parsed.tokens)
      if (recognized && parsed.remainder)
        variantProperties.push({
          label: explicit ? `${label}说明` : label,
          value: parsed.remainder,
        })
      else if (!recognized) variantProperties.push({ label, value })
    } else variantProperties.push({ label, value })
  }
  const size = [...new Set(sizeSources)].join(' / ')
  return {
    size,
    sizeInfo: parseSize(size, aliases),
    variantProperties,
    variant: variantProperties
      .map((property) =>
        property.label ? `${property.label}: ${property.value}` : property.value
      )
      .join(' / '),
  }
}

function suggest(sizes, aliases, variantKeys) {
  if (variantKeys) {
    if (variantKeys.length !== sizes.length)
      throw new Error('Size suggestions need one variant key per size')
    const representatives = new Map()
    const normalizedSizes = sizes.map((size) => {
      const info = parseSize(size, aliases)
      const key =
        info.kind === 'measurement'
          ? JSON.stringify([info.dimension, info.axes || [], info.values])
          : info.kind === 'named'
            ? `name:${info.suffix}`
            : `source:${keyText(size)}`
      if (!representatives.has(key)) representatives.set(key, size)
      return representatives.get(key)
    })
    const results = suggest(normalizedSizes, aliases)
    const endings = new Map()
    results.forEach((result, index) => {
      if (result.needsSizeMapping) return
      const key = JSON.stringify([variantKeys[index], result.sizeSuffix])
      if (!endings.has(key)) endings.set(key, [])
      endings.get(key).push(index)
    })
    for (const indexes of endings.values()) {
      // Formatting-equivalent measurements may share an ending only when the
      // other variant attributes already distinguish these source candidates.
      if (new Set(indexes.map((index) => keyText(sizes[index]))).size <= 1)
        continue
      for (const index of indexes)
        results[index] = {
          sizeSuffix: '',
          needsSizeMapping: true,
          reason:
            'Equivalent sizes would give these variants the same barcode; choose their size codes.',
        }
    }
    return results
  }
  const unique = [...new Set(sizes.map(keyText))]
  const empty = () => ({ sizeSuffix: '', needsSizeMapping: false, reason: '' })
  if (unique.length <= 1) return sizes.map(empty)
  const parsed = new Map(unique.map((size) => [size, parseSize(size, aliases)]))
  const unresolved = (reason) => ({
    sizeSuffix: '',
    needsSizeMapping: true,
    reason,
  })
  const namedCounts = new Map()
  for (const info of parsed.values())
    if (info.kind === 'named')
      namedCounts.set(info.suffix, (namedCounts.get(info.suffix) || 0) + 1)
  const resolved = new Map()
  for (const [size, info] of parsed)
    if (info.kind === 'named' && namedCounts.get(info.suffix) === 1)
      resolved.set(size, info.suffix)

  const measurements = [...parsed].map(([size, info]) => ({ size, ...info }))
  if (
    measurements.every((entry) => entry.kind === 'measurement') &&
    rankedSuffixes[unique.length]
  ) {
    const first = measurements[0]
    const comparable = measurements.every(
      (entry) =>
        entry.dimension === first.dimension &&
        JSON.stringify(entry.axes || []) === JSON.stringify(first.axes || []) &&
        entry.values.length === first.values.length
    )
    measurements.sort((a, b) => {
      for (let index = 0; index < a.values.length; index++)
        if (a.values[index] !== b.values[index])
          return a.values[index] - b.values[index]
      return 0
    })
    const ordered =
      comparable &&
      measurements.every((entry, index) => {
        if (!index) return true
        const previous = measurements[index - 1].values
        return (
          entry.values.every(
            (value, dimension) => value >= previous[dimension]
          ) &&
          entry.values.some((value, dimension) => value > previous[dimension])
        )
      })
    if (ordered)
      measurements.forEach((entry, index) =>
        resolved.set(entry.size, rankedSuffixes[unique.length][index])
      )
  }
  return sizes.map((size) => {
    const key = keyText(size)
    if (resolved.has(key))
      return {
        sizeSuffix: resolved.get(key),
        needsSizeMapping: false,
        reason: '',
      }
    const info = parsed.get(key)
    return unresolved(
      info.kind === 'missing'
        ? 'This variant has no size; choose its size code.'
        : info.kind === 'composite'
          ? 'Different sets of measurements need a size code chosen by you.'
          : info.kind === 'named'
            ? 'Different size names map to the same code; choose distinct size codes.'
            : 'These sizes cannot be ranked reliably; choose their size codes.'
    )
  })
}

/** Compile literal aliases once per preparation, import, or rules update. */
export function createSizeClassifier(vocabulary = DEFAULT_SIZE_VOCABULARY) {
  const aliases = validateSizeVocabulary(vocabulary)
    .flatMap((entry) =>
      entry.match
        .split('|')
        .map((name) => ({ name: name.toLowerCase(), suffix: entry.suffix }))
    )
    .sort((a, b) => b.name.length - a.name.length)
  return {
    extract: (item) => extract(item, aliases),
    suggest: (sizes, variantKeys) => suggest(sizes, aliases, variantKeys),
  }
}

/** Only unfinished sizes may be filled later. Existing/manual endings stay put. */
export function resolvePendingSizeMappings(
  preparation,
  vocabulary = DEFAULT_SIZE_VOCABULARY,
  { snapshot, entryIds } = {}
) {
  const result = structuredClone(preparation)
  const classifier = createSizeClassifier(vocabulary)
  const sourceItems =
    snapshot && new Map(snapshot.items.map((item) => [item.entryId, item]))
  const selected = entryIds && new Set(entryIds)
  const resolvedVariantIds = []
  for (const group of result.groups) {
    if (
      group.sizeMode === 'none' ||
      !group.variants.some(
        (variant) => variant.needsSizeMapping && !variant.sizeSuffix
      )
    )
      continue
    const sources =
      sourceItems &&
      group.variants.flatMap((variant) =>
        variant.entryIds.map((id) => sourceItems.get(id))
      )
    // A manually merged group may contain unrelated source products. Do not
    // compare their measurements as if they described one size assortment.
    if (
      sources &&
      (sources.some((item) => !item) ||
        new Set(sources.map((item) => (item.title || item.description).trim()))
          .size !== 1)
    )
      continue
    const sourceSizes =
      sourceItems &&
      group.variants.map((variant) =>
        variant.entryIds.map(
          (id) => classifier.extract(sourceItems.get(id)).size
        )
      )
    if (sourceSizes?.some((sizes) => new Set(sizes).size !== 1)) continue
    const sizes = group.variants.map((variant, index) => {
      if (!sourceItems || !variant.needsSizeMapping || variant.sizeSuffix)
        return variant.size
      return sourceSizes[index][0]
    })
    const suggestions = classifier.suggest(
      sizes,
      group.variants.map((variant) => variant.variantSuffix)
    )
    const contradictsExisting = group.variants.some(
      (variant, index) =>
        !variant.needsSizeMapping &&
        variant.sizeSuffix &&
        !suggestions[index].needsSizeMapping &&
        suggestions[index].sizeSuffix !== variant.sizeSuffix
    )
    if (contradictsExisting) continue
    const proposed = group.variants.map((variant, index) => {
      const suggestion = suggestions[index]
      return variant.needsSizeMapping &&
        !variant.sizeSuffix &&
        (!selected || variant.entryIds.every((id) => selected.has(id))) &&
        !suggestion.needsSizeMapping
        ? {
            ...variant,
            size: sizes[index],
            sizeSuffix: suggestion.sizeSuffix,
            needsSizeMapping: false,
          }
        : variant
    })
    const codes = proposed
      .filter((variant) => !variant.needsSizeMapping)
      .map((variant) => `${variant.variantSuffix}${variant.sizeSuffix}`)
    if (new Set(codes).size !== codes.length) continue
    group.variants = proposed.map((variant, index) => {
      if (variant !== group.variants[index]) resolvedVariantIds.push(variant.id)
      return variant
    })
  }
  return { preparation: result, resolvedVariantIds }
}

/** Price is a reviewable clue only, never an automatic measurement substitute. */
export function suggestPriceSizeMappings(
  group,
  snapshot,
  vocabulary = DEFAULT_SIZE_VOCABULARY
) {
  if (
    !snapshot ||
    group.sizeMode === 'none' ||
    group.variants.length !== 2 ||
    group.variants.some(
      (variant) => !variant.needsSizeMapping || variant.sizeSuffix
    )
  )
    return []
  const classifier = createSizeClassifier(vocabulary)
  const items = new Map(snapshot.items.map((item) => [item.entryId, item]))
  let identity
  const candidates = []
  const distinctSizes = new Set()
  for (const variant of group.variants) {
    const prices = new Set()
    const sizes = new Set()
    if (!variant.entryIds.length) return []
    for (const id of variant.entryIds) {
      const item = items.get(id)
      if (!item) return []
      const extracted = classifier.extract(item)
      // A range, set, contradictory axes or explicit name must be reviewed from
      // its own evidence. Price must never override those signals.
      if (
        !extracted.size ||
        /\d/.test(extracted.size) ||
        !['unknown', 'missing'].includes(extracted.sizeInfo.kind)
      )
        return []
      sizes.add(keyText(extracted.size))
      const properties = item.skuProperties?.length
        ? item.skuProperties
        : descriptionProperties(item)
      const nonSize = properties
        .filter((property) => !sizeLabel.test(normalize(property.label || '')))
        .map((property) => [
          keyText(property.label || ''),
          keyText(property.value || ''),
        ])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      const key = JSON.stringify([
        (item.title || '').trim(),
        (item.productNumber || '').trim(),
        nonSize,
      ])
      if (!item.title?.trim() || (identity && identity !== key)) return []
      identity = key
      try {
        prices.add(normalizePrice(item.price))
      } catch {
        return []
      }
    }
    if (prices.size !== 1 || sizes.size !== 1) return []
    distinctSizes.add([...sizes][0])
    candidates.push({ variantId: variant.id, price: [...prices][0] })
  }
  if (distinctSizes.size !== 2) return []
  const scale = Math.max(
    ...candidates.map(({ price }) => price.split('.')[1].length)
  )
  const amounts = candidates.map(({ price }) => {
    const [whole, fraction] = price.split('.')
    return BigInt(whole + fraction.padEnd(scale, '0'))
  })
  if (amounts.some((amount) => amount <= 0n) || amounts[0] === amounts[1])
    return []
  const suggestions = candidates.map((candidate, index) => ({
    ...candidate,
    sizeSuffix: amounts[index] < amounts[1 - index] ? 'S' : 'L',
  }))
  const endings = suggestions.map(
    (candidate, index) =>
      group.variants[index].variantSuffix + candidate.sizeSuffix
  )
  return new Set(endings).size === endings.length ? suggestions : []
}
