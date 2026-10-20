import { pngWithDpi } from './png-resolution.js'
import { translateAttribute } from './product-attributes.js'
import { translateMaterial } from './material-vocabulary.js'
import { translateCategory } from './category-translation.js'
import {
  normalizeExcelImageDisplay,
  excelImagePalette,
} from './excel-image-style.js'
import { presentOrderStatus } from './order-presentation.js'
import { UI_MESSAGES } from './ui-messages.js'
import { t } from './i18n.js'
import { labelColorKey } from './appearance.js'
import { orderTagColors } from './order-tags.js'
import { createExcelImageBadges } from './excel-image-badges.js'
import { CE_CODE_DESIGN, codeDesignMetrics } from './code-design.js'

const SCALE = 2
const DPI = 192
const MAX_PIXELS = 16_000_000
const MAX_EDGE = 8192
const CACHE_BYTES = 4 * 1024 * 1024
const PADDING = 10
const LINE_HEIGHT = 20
const PHOTO_SIZE = 126
const PHOTO_PADDING = 3
const MARK_PADDING = 8
const FONT_FAMILY =
  '"Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
const BODY_FONT = `16px ${FONT_FAMILY}`
const MATERIAL_FONT = `700 16px ${FONT_FAMILY}`
const HEADER_FONT = `700 14px ${FONT_FAMILY}`
const NUMBER_FONT = `18px ${FONT_FAMILY}`
const QUANTITY_FONT = `700 19px ${FONT_FAMILY}`
const CODE_FONT_SIZE = 17
const codeFont = (size) =>
  `${CE_CODE_DESIGN.fontWeight} ${size}px ${CE_CODE_DESIGN.fontFamily}`
const TITLE_FONT = `600 16px ${FONT_FAMILY}`
const DETAIL_FONT = `14px ${FONT_FAMILY}`
const ARTICLE_FONT = `600 14px ${FONT_FAMILY}`
const DETAIL_LABEL_FONT = `600 13px ${FONT_FAMILY}`
const TAG_FONT = `13px ${FONT_FAMILY}`
const LABEL_FONT = `600 12px ${FONT_FAMILY}`

export const excelImageColumns = Object.freeze(
  [
    { key: 'number', labels: ['No.', 'N.º', '序号'], width: 50, numeric: true },
    { key: 'thumbnail', labels: ['Photo', 'Foto', '图片'], width: 132 },
    {
      key: 'description',
      labels: ['Product description', 'Descripción del producto', '产品描述'],
      width: 330,
    },
    {
      key: 'baseCode',
      labels: ['Carton mark', 'Marca de caja', '唛头货号'],
      width: 172,
    },
    {
      key: 'barcode',
      labels: ['Barcode code', 'Código de barras', '条码货号'],
      width: 142,
    },
    {
      key: 'chineseCategory',
      labels: ['Category & material', 'Categoría y material', '品类与材质'],
      width: 100,
    },
    {
      key: 'price',
      labels: ['Unit price (CNY)', 'Precio unitario (CNY)', '单价（元）'],
      width: 94,
      numeric: true,
    },
    {
      key: 'quantity',
      labels: ['Quantity', 'Cantidad', '数量'],
      width: 78,
      numeric: true,
    },
    {
      key: 'supplierDimensions',
      labels: ['Carton dimensions', 'Medidas de caja', '体积规格'],
      width: 130,
      supplier: true,
    },
    {
      key: 'supplierWeight',
      labels: ['Weight (kg)', 'Peso (kg)', '重量（KG）'],
      width: 105,
      supplier: true,
    },
    {
      key: 'supplierCarton',
      labels: ['Carton no.', 'N.º de caja', '箱号'],
      width: 100,
      supplier: true,
    },
  ].map(({ labels: [en, es, zh], ...column }) =>
    Object.freeze({
      ...column,
      label: en,
      labels: Object.freeze({ en, es, zh }),
    })
  )
)

const defaultColumnKeys = excelImageColumns
  .filter((column) => !column.supplier)
  .map((column) => column.key)

function selectedColumns(keys, language, context) {
  if (!Array.isArray(keys) || !keys.length)
    throw new Error('Choose at least one Excel image column.')
  const seen = new Set()
  return Object.freeze(
    keys.map((key) => {
      const column = excelImageColumns.find((entry) => entry.key === key)
      if (!column || seen.has(key))
        throw new Error('Choose valid, unique Excel image columns.')
      seen.add(key)
      const label = column.labels[language]
      // Headers may wrap between words, but a localized word must not be split
      // just because it is wider than the original Chinese column heading.
      const wordWidth = Math.max(
        ...label.split(/\s+/).map((word) => context.measureText(word).width)
      )
      return Object.freeze({
        ...column,
        label,
        width: Math.max(column.width, Math.ceil(wordWidth) + PADDING * 2),
      })
    })
  )
}

function canvasContext() {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('This browser cannot create the Excel image.')
  return { canvas, context }
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Keep words together where possible; long codes and CJK wrap without truncation. */
function wrap(context, value, width, firstWidth = width) {
  const lines = []
  const available = () => (lines.length ? width : firstWidth)
  for (const paragraph of String(value)
    .replaceAll('\r\n', '\n')
    .split(/[\r\n]/)) {
    const paragraphStart = lines.length
    if (!paragraph.trim()) {
      lines.push('')
      continue
    }
    let line = ''
    for (const token of paragraph.match(/\s+|\S+/gu) || []) {
      if (context.measureText(line + token).width <= available()) {
        line += token
        continue
      }
      if (line.trim()) lines.push(line.trimEnd())
      line = token.trimStart()
      if (context.measureText(line).width <= available()) continue
      const parts = [...graphemes.segment(line)].map((entry) => entry.segment)
      let start = 0
      while (start < parts.length) {
        let low = 1
        let high = 1
        const remaining = parts.length - start
        while (
          high < remaining &&
          context.measureText(parts.slice(start, start + high).join(''))
            .width <= available()
        )
          high = Math.min(remaining, high * 2)
        let fits = 0
        while (low <= high) {
          const length = Math.floor((low + high) / 2)
          const candidate = parts.slice(start, start + length).join('')
          if (context.measureText(candidate).width <= available()) {
            fits = length
            low = length + 1
          } else high = length - 1
        }
        if (!fits)
          throw new Error('A product character cannot fit in the Excel image.')
        const part = parts.slice(start, start + fits).join('')
        start += fits
        if (start < parts.length) lines.push(part)
        else line = part
      }
    }
    line = line.trimEnd()
    // A lone final Han character is hard to read (for example 销 / 售).
    // Move a short suffix from the preceding line without removing source text.
    const previous = lines.at(-1)
    if (
      lines.length > paragraphStart &&
      /^\p{Script=Han}$/u.test(line) &&
      previous &&
      /\p{Script=Han}{2}$/u.test(previous)
    ) {
      const parts = [...graphemes.segment(previous)].map(
        (entry) => entry.segment
      )
      const suffix = parts.slice(-2).join('')
      if (
        parts.length > 2 &&
        context.measureText(suffix + line).width <= width
      ) {
        lines[lines.length - 1] = parts.slice(0, -2).join('')
        line = suffix + line
      }
    }
    lines.push(line)
  }
  return lines
}

function balancedWrap(context, value, width) {
  let result = wrap(context, value, width)
  if (result.length < 2 || /[\r\n]/.test(value)) return result
  const count = result.length
  let low = width / 2
  let high = width
  // Find the narrowest line width that still fits the same number of lines.
  // This balances centered titles instead of leaving a very short final line.
  for (let step = 0; step < 9; step++) {
    const middle = (low + high) / 2
    const candidate = wrap(context, value, middle)
    if (candidate.length <= count) {
      high = middle
      result = candidate
    } else low = middle
  }
  return result
}

function productImageError(message, row, field) {
  return Object.assign(new Error(message), { packingIssue: { row, field } })
}

function snapshot(row, index, columns) {
  if (!row || typeof row !== 'object')
    throw new Error(`Product row ${index + 1} is invalid.`)
  const values = {}
  for (const key of [
    'orderId',
    'entryId',
    'sellerName',
    'sellerMemberLogin',
    'orderDate',
    'orderStatus',
    'groupId',
    'title',
    'productNumber',
    'variantDescription',
    'sourceSize',
    'spanishName',
    'material',
    ...excelImageColumns.map((column) => column.key),
  ])
    values[key] = key === 'number' ? String(index + 1) : String(row[key] ?? '')
  values.manualReordered = row.manualReordered === true
  for (const field of ['orderTags', 'productTags'])
    values[field] = Object.freeze([
      ...new Set(
        (Array.isArray(row[field]) ? row[field] : [])
          .map((tag) => String(tag ?? '').trim())
          .filter(Boolean)
      ),
    ])
  values.skuProperties = Object.freeze(
    (Array.isArray(row.skuProperties) ? row.skuProperties : []).map(
      (property) =>
        Object.freeze({
          label: String(property?.label ?? ''),
          value: String(property?.value ?? ''),
        })
    )
  )
  if (
    columns.some((column) => column.key === 'thumbnail') &&
    !values.thumbnail.trim()
  )
    throw productImageError(
      `Product row ${index + 1} has no photo. Add or refresh its photo before copying.`,
      row,
      'photo'
    )
  if (
    columns.some((column) => column.key === 'baseCode') &&
    values.baseCode.trim() &&
    !values.chineseCategory.trim()
  )
    throw productImageError(
      `Product row ${index + 1} (${values.baseCode}) needs a Chinese category before copying its carton mark.`,
      row,
      'category'
    )
  return Object.freeze(values)
}

const normalized = (value) => String(value).replace(/[\s:：·]/g, '')

function tagBadges(names, catalog, mode) {
  return names.map((name) => {
    const fallback = orderTagColors({ name })
    const colors = Object.hasOwn(catalog || {}, name) ? catalog[name] : null
    return {
      name,
      background: colors?.background || fallback[mode],
      foreground: colors?.foreground || fallback[`${mode}Text`],
    }
  })
}

function layoutTags(context, badges, width) {
  const rows = []
  let current = [],
    used = 0
  for (const badge of badges) {
    const font = badge.font || TAG_FONT
    const lineHeight = badge.lineHeight || 18
    const paddingBlock = badge.paddingBlock || 1
    context.font = font
    const lines = Object.freeze(wrap(context, badge.name, width - 12))
    const tag = Object.freeze({
      ...badge,
      font,
      lineHeight,
      paddingBlock,
      radius: badge.radius || 4,
      lines,
      width: Math.min(
        width,
        Math.max(...lines.map((line) => context.measureText(line).width)) + 12
      ),
      height: lines.length * lineHeight + paddingBlock * 2,
    })
    if (current.length && used + 6 + tag.width > width) {
      rows.push(Object.freeze(current))
      current = []
      used = 0
    }
    if (current.length) used += 6
    current.push(tag)
    used += tag.width
  }
  if (current.length) rows.push(Object.freeze(current))
  return Object.freeze({
    rows: Object.freeze(rows),
    height:
      rows.reduce(
        (height, tags) => height + Math.max(...tags.map((tag) => tag.height)),
        0
      ) +
      Math.max(0, rows.length - 1) * 5,
  })
}

function orderDateLabel(value, language) {
  const day = value.slice(0, 10)
  const date = new Date(`${day}T12:00:00Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  )
    return value
  return date.toLocaleDateString(
    { en: 'en-GB', es: 'es-PE', zh: 'zh-CN' }[language],
    {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }
  )
}

function descriptionCell(context, source, width, language, details, badges) {
  const articleLabel =
    /^(?:货号|款号|商品编号|产品编号|型号|模型|model|article(?: number)?|item(?: no\.?)?|sku)$/i
  const isDisplayed = (section) =>
    section.title
      ? details.title
      : articleLabel.test(section.label || '')
        ? details.model
        : details.specifications
  const paragraphs = source.description
    .replaceAll('\r\n', '\n')
    .split(/[\r\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
  const title =
    source.title.trim() ||
    (/^[^:：]{1,24}[:：]/.test(paragraphs[0] || '') ? '' : paragraphs[0]) ||
    ''
  if (paragraphs[0] === title) paragraphs.shift()
  else if (source.description.trim().startsWith(title) && title)
    paragraphs.splice(
      0,
      paragraphs.length,
      source.description.trim().slice(title.length).trim()
    )
  const sections = details.title ? [{ value: title, title: true }] : []
  for (let index = 0; index < paragraphs.length; index++) {
    let value = paragraphs[index]
    if (/^[^:：]{1,24}[:：]$/.test(value) && paragraphs[index + 1])
      value += paragraphs[++index]
    const match = value.match(/^([^:：]{1,24})[:：]\s*(.+)$/s)
    const section = match ? { label: match[1], value: match[2] } : { value }
    if (value && isDisplayed(section)) sections.push(section)
  }
  function append(label, value) {
    if (!value.trim() || !isDisplayed({ label })) return
    // A combined source variant often repeats the structured SKU fields.
    // Compare complete label/value pairs, so a code substring or a changed
    // measurement cannot accidentally suppress genuinely new information.
    if (label === '产品规格') {
      const attributes = value.split(
        /\s*(?:[·•\n]|\/(?=\s*[^/:：]{1,24}[:：]))\s*/
      )
      const pairs = attributes.map((part) =>
        part.match(/^\s*([^:：]{1,24})[:：]\s*(.+)\s*$/s)
      )
      if (
        pairs.length &&
        pairs.every(
          (pair) =>
            pair &&
            sections.some(
              (section) =>
                normalized(section.label || '') === normalized(pair[1]) &&
                normalized(section.value) === normalized(pair[2])
            )
        )
      )
        return
      if (pairs.every(Boolean)) {
        sections.push({ label, value })
        return
      }
    }
    const existing = normalized(
      sections
        .map((section) => `${section.label || ''}${section.value}`)
        .join('')
    )
    const parts = value.split(/\s+·\s+|[\r\n]+/).filter((part) => part.trim())
    if (!parts.every((part) => existing.includes(normalized(part))))
      sections.push({ label, value })
  }
  for (const property of source.skuProperties)
    append(property.label, property.value)
  append('货号', source.productNumber)
  append('产品规格', source.variantDescription)
  append('尺寸', source.sourceSize)

  const displayedSections = sections.map((section) => {
    if (!section.label || language === 'zh') return section
    const translated = translateAttribute(section, language)
    const extraLabel =
      section.label === '产品规格'
        ? { en: 'Specifications', es: 'Especificaciones' }[language]
        : /^(?:材质|材料)$/.test(section.label)
          ? 'Material'
          : ''
    return {
      ...section,
      label: extraLabel || translated.label,
      value: /^(?:材质|材料)$/.test(section.label)
        ? translateMaterial(section.value, language)
        : translated.measurement
          ? `${translated.measurement.numberText} ${translated.measurement.unit}`
          : translated.value,
      article: articleLabel.test(section.label),
    }
  })

  let height = 0
  const blocks = displayedSections
    .filter((section) => section.value)
    .map((section, index) => {
      const article = section.article || articleLabel.test(section.label || '')
      const font = section.title
        ? TITLE_FONT
        : article
          ? ARTICLE_FONT
          : DETAIL_FONT
      const lineHeight = section.title ? 23 : LINE_HEIGHT
      const label = section.label
        ? `${section.label}${language === 'zh' ? '：' : ': '}`
        : ''
      context.font = DETAIL_LABEL_FONT
      let labelWidth = context.measureText(label).width
      // Very long imported attribute labels get their own fully wrapped block.
      const ownLabel = labelWidth > width / 2
      const labelLines = ownLabel ? wrap(context, label, width) : []
      if (ownLabel) labelWidth = 0
      context.font = font
      const lines = section.title
        ? balancedWrap(context, section.value, width)
        : wrap(context, section.value, width, width - labelWidth)
      const gapBefore = index ? (index === 1 || article ? 7 : 4) : 0
      const blockHeight = (lines.length + labelLines.length) * lineHeight
      height += gapBefore + blockHeight
      return Object.freeze({
        label,
        labelWidth,
        labelLines: Object.freeze(labelLines),
        lines: Object.freeze(lines),
        font,
        lineHeight,
        color: section.title ? '#25221d' : '#514a40',
        gapBefore,
        height: blockHeight,
      })
    })
  const tags = details.productTags
    ? layoutTags(
        context,
        tagBadges(source.productTags, badges.productTags, badges.mode),
        width
      )
    : null
  if (tags?.height) height += (height ? 8 : 0) + tags.height
  return Object.freeze({
    text: displayedSections
      .map(
        ({ label, value }) =>
          `${label ? `${label}${language === 'zh' ? '：' : ': '}` : ''}${value}`
      )
      .join('\n'),
    font: BODY_FONT,
    blocks: Object.freeze(blocks),
    tags,
    lines: Object.freeze(
      blocks.flatMap((block) => [
        ...block.labelLines,
        ...block.lines.map((line, index) =>
          index === 0 && !block.labelLines.length ? block.label + line : line
        ),
      ])
    ),
    height,
  })
}

function categoryCell(context, source, width, language) {
  const category =
    language === 'es'
      ? source.spanishName ||
        translateCategory(source.chineseCategory, language)
      : translateCategory(source.chineseCategory, language) ||
        source.spanishName
  const material = translateMaterial(source.material, language)
  const richLines = []
  for (const [value, font] of [
    [category, BODY_FONT],
    [material, MATERIAL_FONT],
  ]) {
    if (!value.trim()) continue
    context.font = font
    for (const text of wrap(context, value, width))
      richLines.push(Object.freeze([Object.freeze({ text, font })]))
  }
  return Object.freeze({
    text: [category, material].filter(Boolean).join('\n'),
    font: BODY_FONT,
    richLines: Object.freeze(richLines),
    lines: Object.freeze(richLines.map((line) => line[0].text)),
    lineHeight: 22,
    height: richLines.length * 22,
  })
}

/** Printed codes use one unsegmented black/white badge, including endings. */
function codeCell(context, value, width) {
  context.font = codeFont(CODE_FONT_SIZE)
  const naturalWidth =
    context.measureText(value).width +
    2 * codeDesignMetrics(CODE_FONT_SIZE).paddingInline
  // Fit ordinary payloads on one line; only long endings need wrapping.
  const fontSize = Math.max(
    12,
    Math.min(
      CODE_FONT_SIZE,
      Math.floor((CODE_FONT_SIZE * width) / naturalWidth)
    )
  )
  const font = codeFont(fontSize)
  const design = codeDesignMetrics(fontSize)
  const innerWidth = width - 2 * design.paddingInline
  const lines = []
  let runs = []
  for (const { segment } of graphemes.segment(value)) {
    const color = CE_CODE_DESIGN.foreground
    context.font = font
    const last = runs.at(-1)
    const sameStyle = last?.font === font && last.color === color
    const candidate = sameStyle ? last.text + segment : segment
    const measured = context.measureText(candidate).width
    const previousWidth = runs.reduce((sum, run) => sum + run.width, 0)
    if (previousWidth - (sameStyle ? last.width : 0) + measured > innerWidth) {
      if (!runs.length)
        throw new Error('A product character cannot fit in the Excel image.')
      lines.push(runs)
      runs = []
    }
    const current = runs.at(-1)
    if (current?.font === font && current.color === color) {
      current.text += segment
      current.width = context.measureText(current.text).width
    } else
      runs.push({
        text: segment,
        font,
        color,
        width: context.measureText(segment).width,
      })
  }
  if (runs.length || !lines.length) lines.push(runs)
  return Object.freeze({
    text: value,
    font,
    codeBadge: true,
    codeFontSize: fontSize,
    richLines: Object.freeze(
      lines.map((line) => Object.freeze(line.map(Object.freeze)))
    ),
    lines: Object.freeze(
      lines.map((line) => line.map((run) => run.text).join(''))
    ),
    lineHeight: Math.ceil((32 * fontSize) / CODE_FONT_SIZE),
    height: lines.length * Math.ceil((32 * fontSize) / CODE_FONT_SIZE),
  })
}

/** Plan every selected row before choosing a numbered batch; does not load photos. */
export function planExcelImage(
  rows,
  {
    columns: columnKeys = defaultColumnKeys,
    language = 'en',
    showOrderDetails = true,
    style,
    details: detailOptions,
    badges: badgeOptions,
  } = {}
) {
  if (!Array.isArray(rows) || !rows.length)
    throw new Error('Select product rows to copy as an image.')
  language = ['en', 'es', 'zh'].includes(language) ? language : 'en'
  const display = normalizeExcelImageDisplay({
    showOrderDetails,
    style,
    details: detailOptions,
  })
  const details = display.details
  const badges = badgeOptions || createExcelImageBadges()
  const { canvas, context } = canvasContext()
  try {
    context.font = HEADER_FONT
    const columns = selectedColumns(columnKeys, language, context)
    const hasMarks = columns.some((column) => column.key === 'baseCode')
    const hasPhotos = columns.some((column) => column.key === 'thumbnail')
    const cssWidth = 2 + columns.reduce((sum, column) => sum + column.width, 0)
    const width = cssWidth * SCALE
    const maxHeight = Math.floor(
      Math.min(MAX_EDGE, Math.floor(MAX_PIXELS / width)) / SCALE
    )
    if (width > MAX_EDGE)
      throw new Error('The Excel image is too wide to render safely.')
    context.font = HEADER_FONT
    const headers = columns.map((column) =>
      Object.freeze(wrap(context, column.label, column.width - PADDING * 2))
    )
    const headerHeight = Math.max(
      44,
      ...headers.map((lines) => lines.length * LINE_HEIGHT + PADDING * 2)
    )
    const plans = []
    let entries = []
    let start = 0
    let cssHeight = headerHeight + 2
    let previous = null
    function finish() {
      const markSpans = []
      for (const [index, row] of entries.entries()) {
        if (!hasMarks || !row.source.baseCode.trim()) continue
        const last = markSpans.at(-1)
        if (last && last.end === index && last.groupKey === row.groupKey) {
          last.end++
          last.height += row.height
          last.manualReordered ||= row.source.manualReordered
        } else
          markSpans.push({
            start: index,
            end: index + 1,
            height: row.height,
            groupKey: row.groupKey,
            source: row.source,
            manualReordered: row.source.manualReordered,
          })
      }
      plans.push(
        Object.freeze({
          start,
          end: start + entries.length,
          rowCount: entries.length,
          width,
          height: cssHeight * SCALE,
          cssWidth,
          cssHeight,
          headerHeight,
          columns,
          language,
          ...display,
          palette: excelImagePalette(display.style),
          headers: Object.freeze(headers),
          rows: Object.freeze(entries),
          markSpans: Object.freeze(markSpans.map(Object.freeze)),
        })
      )
      start += entries.length
      entries = []
      cssHeight = headerHeight + 2
      previous = null
    }
    function prepare(source, groupKey) {
      const sellerKey = source.sellerMemberLogin || source.sellerName
      const previousSeller =
        previous?.source.sellerMemberLogin || previous?.source.sellerName
      const newOrder = !previous || previous.source.orderId !== source.orderId
      const newStore =
        Boolean(sellerKey) && (!previous || sellerKey !== previousSeller)
      const band = (() => {
        if (!newOrder) return null
        // Hide only the identity heading, not the source identities needed for
        // safe grouping, carton-mark ownership, and precise error reporting.
        const separator = () =>
          previous
            ? Object.freeze({
                lines: Object.freeze([]),
                kind: newStore ? 'store' : 'order',
                height: newStore ? 10 : 6,
              })
            : null
        if (!display.showOrderDetails) return separator()
        // Retain the previous sellerless-row layout unless extra order details
        // were explicitly enabled; old exports need no new identity band.
        if (
          !sellerKey &&
          !details.date &&
          !details.status &&
          !details.orderTags
        )
          return null
        const orderLabel = { en: 'Order', es: 'Pedido', zh: '订单' }[language]
        const status = presentOrderStatus(source.orderStatus).label
        const text = [
          details.seller && (source.sellerName || source.sellerMemberLogin),
          details.orderNumber &&
            source.orderId &&
            `${orderLabel} ${source.orderId}`,
        ]
          .filter(Boolean)
          .join('  ·  ')
        context.font = HEADER_FONT
        const lines = Object.freeze(
          text ? wrap(context, text, cssWidth - PADDING * 2) : []
        )
        const labels = []
        const addLabel = (name, key) => {
          if (!name) return
          labels.push({
            name,
            ...badges.labels[key],
            font: LABEL_FONT,
            lineHeight: 16,
            paddingBlock: 2,
            radius: 5,
          })
        }
        if (details.date && source.orderDate)
          addLabel(orderDateLabel(source.orderDate, language), 'dates')
        if (details.status && source.orderStatus)
          addLabel(
            UI_MESSAGES[status]?.[language] || status,
            labelColorKey(status)
          )
        if (details.orderTags)
          labels.push(
            ...tagBadges(source.orderTags, badges.orderTags, badges.mode)
          )
        const tags = layoutTags(context, labels, cssWidth - PADDING * 2)
        if (!lines.length && !tags?.height) return separator()
        return Object.freeze({
          lines,
          tags,
          kind: newStore ? 'store' : 'order',
          height:
            lines.length * LINE_HEIGHT +
            (tags?.height || 0) +
            (lines.length && tags?.height ? 6 : 0) +
            16,
        })
      })()
      const cells = columns.map((column) => {
        if (column.key === 'description')
          return descriptionCell(
            context,
            source,
            column.width - PADDING * 2,
            language,
            details,
            badges
          )
        if (column.key === 'chineseCategory')
          return categoryCell(
            context,
            source,
            column.width - PADDING * 2,
            language
          )
        let text =
          column.supplier ||
          column.key === 'thumbnail' ||
          (column.key === 'baseCode' && previous?.groupKey === groupKey)
            ? ''
            : source[column.key]
        if (column.key === 'baseCode' || column.key === 'barcode')
          return codeCell(context, text, column.width - PADDING * 2)
        if (column.key === 'price' && text.trim()) text = `¥ ${text}`
        const font =
          column.key === 'quantity'
            ? QUANTITY_FONT
            : column.numeric
              ? NUMBER_FONT
              : BODY_FONT
        context.font = font
        const lines = Object.freeze(
          wrap(context, text, column.width - PADDING * 2)
        )
        return Object.freeze({
          text,
          font,
          lines,
          lineHeight: column.numeric ? 24 : 22,
          height: lines.length * (column.numeric ? 24 : 22),
        })
      })
      const height = Math.max(
        hasPhotos || hasMarks ? PHOTO_SIZE + PHOTO_PADDING * 2 : 56,
        ...cells.map((cell) => cell.height + PADDING * 2)
      )
      return Object.freeze({
        source,
        cells: Object.freeze(cells),
        height,
        band,
        separator: !previous
          ? 'none'
          : newStore
            ? 'store'
            : previous.source.orderId !== source.orderId
              ? 'order'
              : previous.groupKey !== groupKey
                ? 'group'
                : 'row',
        groupKey,
      })
    }
    for (const [index, row] of rows.entries()) {
      const source = snapshot(row, index, columns)
      const groupKey =
        source.groupId && source.baseCode
          ? JSON.stringify([
              source.orderId,
              source.groupId,
              source.baseCode,
              source.chineseCategory,
            ])
          : `row:${index}`
      let entry = prepare(source, groupKey)
      if (
        entry.height + (entry.band?.height || 0) + headerHeight + 2 >
        maxHeight
      )
        throw new Error(
          `Product row ${index + 1} is too tall for one image. Shorten its description or copy its values instead.`
        )
      if (
        entries.length &&
        cssHeight + entry.height + (entry.band?.height || 0) > maxHeight
      ) {
        finish()
        entry = prepare(source, groupKey)
      }
      if (
        entry.height + (entry.band?.height || 0) + headerHeight + 2 >
        maxHeight
      )
        throw new Error(
          `Product row ${index + 1} is too tall for one image. Shorten its description or copy its values instead.`
        )
      entries.push(entry)
      cssHeight += entry.height + (entry.band?.height || 0)
      previous = entry
    }
    if (entries.length) finish()
    return Object.freeze(plans)
  } finally {
    canvas.width = canvas.height = 0
  }
}

function aborted(signal) {
  if (signal?.aborted)
    throw new DOMException('Excel image cancelled.', 'AbortError')
}

async function abortable(work, signal) {
  aborted(signal)
  if (!signal) return work
  let cancel
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        cancel = () =>
          reject(new DOMException('Excel image cancelled.', 'AbortError'))
        signal.addEventListener('abort', cancel, { once: true })
      }),
    ])
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

async function yieldUI() {
  if (globalThis.scheduler?.yield) await scheduler.yield()
  else await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Render one confirmed batch, with sequential photos and a bounded bitmap cache. */
export async function renderExcelImage(
  plan,
  { loadImage, renderCartonMark, onProgress, signal } = {}
) {
  if (!plan?.rows?.length || !plan.columns?.length)
    throw new Error('Choose an Excel image batch.')
  const columns = plan.columns
  const palette = plan.palette || excelImagePalette(plan.style)
  const hasPhotos = columns.some((column) => column.key === 'thumbnail')
  if (hasPhotos && typeof loadImage !== 'function')
    throw new Error('Choose a photo loader for the Excel image.')
  if (plan.markSpans.length && typeof renderCartonMark !== 'function')
    throw new Error('A carton mark renderer is required for prepared products.')
  if (
    plan.width > MAX_EDGE ||
    plan.height > MAX_EDGE ||
    plan.width * plan.height > MAX_PIXELS
  )
    throw new Error(
      'The Excel image exceeds the memory limit. Choose a smaller batch.'
    )
  aborted(signal)
  const { canvas, context } = canvasContext()
  const photos = new Map()
  let cacheBytes = 0
  const markColumn = columns.find((column) => column.key === 'baseCode')
  const markLeft =
    1 +
    columns
      .slice(0, columns.indexOf(markColumn))
      .reduce((width, column) => width + column.width, 0)
  const markRows = new Map(
    plan.markSpans.flatMap((span) =>
      Array.from({ length: span.end - span.start }, (_, offset) => [
        span.start + offset,
        span,
      ])
    )
  )
  async function bitmapFor(source, row, { mark = false, loader } = {}) {
    const cacheKey = `${mark ? 'mark' : 'photo'}:${source}`
    const cached = photos.get(cacheKey)
    if (cached) {
      photos.delete(cacheKey)
      photos.set(cacheKey, cached)
      return cached.bitmap
    }
    let bitmap
    try {
      const loaded = await abortable(
        Promise.resolve(loader ? loader() : loadImage(source)),
        signal
      )
      aborted(signal)
      if (mark && !(loaded instanceof Blob))
        throw new Error('No carton mark image was returned.')
      if (!(loaded instanceof Blob) && (typeof loaded !== 'string' || !loaded))
        throw new Error('No photo data was returned.')
      const blob =
        loaded instanceof Blob
          ? loaded
          : await (await fetch(loaded, { signal })).blob()
      aborted(signal)
      bitmap = await createImageBitmap(blob, {
        resizeWidth:
          (mark ? markColumn.width - MARK_PADDING * 2 : PHOTO_SIZE) * SCALE,
        resizeQuality: 'high',
      })
      aborted(signal)
      const bytes = bitmap.width * bitmap.height * 4
      if (!bitmap.width || !bitmap.height || bytes > CACHE_BYTES)
        throw new Error('The photo has unsupported dimensions.')
      while (
        photos.size &&
        (photos.size >= 32 || cacheBytes + bytes > CACHE_BYTES)
      ) {
        const [key, oldest] = photos.entries().next().value
        oldest.bitmap.close()
        cacheBytes -= oldest.bytes
        photos.delete(key)
      }
      photos.set(cacheKey, { bitmap, bytes })
      cacheBytes += bytes
      return bitmap
    } catch (error) {
      bitmap?.close()
      if (error.name === 'AbortError') throw error
      if (mark)
        throw productImageError(
          `Carton mark for product row ${row.number} could not be created. Check its code and Chinese category, then try again. ${t(error.message)}`,
          row,
          error.packingIssue?.field || 'code'
        )
      throw productImageError(
        `Photo for product row ${row.number} could not be loaded. Refresh the photo and try again. ${t(error.message)}`,
        row,
        'photo'
      )
    }
  }
  function line(runs, center, top, lineHeight) {
    context.textAlign = 'left'
    context.textBaseline = 'alphabetic'
    let width = 0,
      ascent = 0,
      descent = 0
    const measured = runs.map((run) => {
      context.font = run.font
      const bounds = context.measureText(run.text)
      const size = Number(run.font.match(/([\d.]+)px/)[1])
      width += bounds.width
      ascent = Math.max(ascent, bounds.actualBoundingBoxAscent ?? size * 0.8)
      descent = Math.max(descent, bounds.actualBoundingBoxDescent ?? size * 0.2)
      return { ...run, width: bounds.width }
    })
    const baseline = top + (lineHeight - ascent - descent) / 2 + ascent
    let left = center - width / 2
    for (const run of measured) {
      context.font = run.font
      context.fillStyle = run.color || '#24211c'
      context.fillText(run.text, left, baseline)
      left += run.width
    }
  }
  function text(cell, x, y, column, rowHeight) {
    const top = y + (rowHeight - cell.height) / 2
    if (cell.codeBadge && cell.text) {
      context.font = cell.font
      const bounds = cell.lines.map((value) => context.measureText(value))
      const design = codeDesignMetrics(cell.codeFontSize)
      const inkHeight = Math.max(
        ...bounds.map(
          (metrics) =>
            (metrics.actualBoundingBoxAscent ?? cell.codeFontSize * 0.8) +
            (metrics.actualBoundingBoxDescent ?? cell.codeFontSize * 0.2)
        )
      )
      const width =
        Math.max(...bounds.map((metrics) => metrics.width)) +
        2 * design.paddingInline
      const lineHeight = inkHeight + 2 * design.paddingBlock
      // A wrapped payload still belongs to one code, so keep one backing.
      const height = lineHeight + (cell.lines.length - 1) * cell.lineHeight
      context.fillStyle = CE_CODE_DESIGN.background
      context.beginPath()
      context.roundRect(
        x + (column.width - width) / 2,
        top + (cell.lineHeight - lineHeight) / 2,
        width,
        height,
        design.radius
      )
      context.fill()
    }
    for (const [index, value] of cell.lines.entries())
      line(
        cell.richLines?.[index] || [{ text: value, font: cell.font }],
        x + column.width / 2,
        top + index * cell.lineHeight,
        cell.lineHeight
      )
  }
  function tags(layout, center, top) {
    if (!layout?.height) return
    for (const row of layout.rows) {
      const width =
        row.reduce((sum, tag) => sum + tag.width, 0) + (row.length - 1) * 6
      const height = Math.max(...row.map((tag) => tag.height))
      let left = center - width / 2
      for (const tag of row) {
        const y = top + (height - tag.height) / 2
        context.fillStyle = tag.background
        context.beginPath()
        context.roundRect(left, y, tag.width, tag.height, tag.radius)
        context.fill()
        for (const [index, value] of tag.lines.entries())
          line(
            [{ text: value, font: tag.font, color: tag.foreground }],
            left + tag.width / 2,
            y + tag.paddingBlock + index * tag.lineHeight,
            tag.lineHeight
          )
        left += tag.width + 6
      }
      top += height + 5
    }
  }
  function description(cell, x, y, column, rowHeight) {
    let top = y + (rowHeight - cell.height) / 2
    const center = x + column.width / 2
    for (const block of cell.blocks) {
      top += block.gapBefore
      for (const label of block.labelLines) {
        line(
          [{ text: label, font: DETAIL_LABEL_FONT, color: '#746757' }],
          center,
          top,
          block.lineHeight
        )
        top += block.lineHeight
      }
      for (const [index, value] of block.lines.entries()) {
        const runs = [{ text: value, font: block.font, color: block.color }]
        if (!index && block.label && !block.labelLines.length)
          runs.unshift({
            text: block.label,
            font: DETAIL_LABEL_FONT,
            color: '#746757',
          })
        line(runs, center, top, block.lineHeight)
        top += block.lineHeight
      }
    }
    tags(cell.tags, center, top + (cell.blocks.length ? 8 : 0))
  }
  async function cartonMark(span, top) {
    const bitmap = await bitmapFor(span.groupKey, span.source, {
      mark: true,
      loader: () => renderCartonMark(span.source, { signal }),
    })
    aborted(signal)
    const ratio = Math.min(
      (markColumn.width - MARK_PADDING * 2) / bitmap.width,
      (span.height - MARK_PADDING * 2) / bitmap.height
    )
    if (!(ratio > 0))
      throw new Error('The carton mark cannot fit in the Excel image.')
    const width = bitmap.width * ratio
    const height = bitmap.height * ratio
    const y = top + (span.height - height) / 2
    context.fillStyle = '#fff'
    context.fillRect(
      markLeft + 1,
      top + 1,
      markColumn.width - 2,
      span.height - 2
    )
    context.drawImage(
      bitmap,
      markLeft + (markColumn.width - width) / 2,
      y,
      width,
      height
    )
  }
  try {
    canvas.width = plan.width
    canvas.height = plan.height
    context.scale(SCALE, SCALE)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.fillStyle = '#fff'
    context.fillRect(0, 0, plan.cssWidth, plan.cssHeight)
    context.fillStyle = palette.header
    context.fillRect(1, 1, plan.cssWidth - 2, plan.headerHeight)
    let x = 1
    for (const [index, column] of columns.entries()) {
      const top =
        1 + (plan.headerHeight - plan.headers[index].length * LINE_HEIGHT) / 2
      for (const [lineIndex, value] of plan.headers[index].entries())
        line(
          [{ text: value, font: HEADER_FONT, color: palette.headerText }],
          x + column.width / 2,
          top + lineIndex * LINE_HEIGHT,
          LINE_HEIGHT
        )
      x += column.width
    }
    onProgress?.({ completed: 0, total: plan.rowCount })
    let y = plan.headerHeight + 1
    const bands = []
    for (const [index, row] of plan.rows.entries()) {
      await yieldUI()
      aborted(signal)
      if (row.band) {
        bands.push({ ...row.band, top: y })
        y += row.band.height
      }
      const bitmap = hasPhotos
        ? await bitmapFor(row.source.thumbnail, row.source)
        : null
      aborted(signal)
      if (index % 2) {
        context.fillStyle = palette.stripe
        context.fillRect(1, y, plan.cssWidth - 2, row.height)
      }
      x = 1
      for (const [cellIndex, column] of columns.entries()) {
        if (column.key === 'thumbnail') {
          const ratio = Math.min(
            (column.width - PHOTO_PADDING * 2) / bitmap.width,
            (row.height - PHOTO_PADDING * 2) / bitmap.height
          )
          const width = bitmap.width * ratio
          const height = bitmap.height * ratio
          context.drawImage(
            bitmap,
            x + (column.width - width) / 2,
            y + (row.height - height) / 2,
            width,
            height
          )
        } else if (column.key === 'baseCode') {
          // Draw one mark after every row in its contiguous merged cell is painted.
        } else if (column.key === 'description')
          description(row.cells[cellIndex], x, y, column, row.height)
        else text(row.cells[cellIndex], x, y, column, row.height)
        x += column.width
      }
      context.beginPath()
      context.lineWidth =
        row.separator === 'store'
          ? 1.25
          : row.separator === 'order'
            ? 1
            : row.separator === 'group'
              ? 0.85
              : 0.65
      context.strokeStyle =
        row.separator === 'store' || row.separator === 'order'
          ? palette.separator
          : palette.grid
      context.moveTo(1, y)
      const span = markRows.get(index)
      if (span && index > span.start) {
        context.lineTo(markLeft, y)
        context.moveTo(markLeft + markColumn.width, y)
      }
      context.lineTo(plan.cssWidth - 1, y)
      context.stroke()
      y += row.height
      if (span && index === span.end - 1)
        await cartonMark(span, y - span.height)
      onProgress?.({ completed: index + 1, total: plan.rowCount })
    }
    aborted(signal)
    context.lineWidth = 1
    context.strokeStyle = palette.grid
    x = 1
    context.beginPath()
    for (const column of columns) {
      context.moveTo(x, 1)
      context.lineTo(x, plan.cssHeight - 1)
      x += column.width
    }
    context.stroke()
    // Merged spreadsheet heading rows sit above the cell grid, never in its
    // columns, so omitted/reordered columns and merged marks keep their shape.
    for (const band of bands) {
      context.fillStyle = band.kind === 'store' ? palette.store : palette.order
      context.fillRect(1, band.top, plan.cssWidth - 2, band.height)
      context.strokeStyle = palette.separator
      context.lineWidth = band.kind === 'store' ? 1 : 0.75
      context.beginPath()
      context.moveTo(1, band.top)
      context.lineTo(plan.cssWidth - 1, band.top)
      context.moveTo(1, band.top + band.height)
      context.lineTo(plan.cssWidth - 1, band.top + band.height)
      context.stroke()
      for (const [index, value] of band.lines.entries())
        line(
          [{ text: value, font: HEADER_FONT, color: '#383128' }],
          plan.cssWidth / 2,
          band.top + 8 + index * LINE_HEIGHT,
          LINE_HEIGHT
        )
      tags(
        band.tags,
        plan.cssWidth / 2,
        band.top +
          8 +
          band.lines.length * LINE_HEIGHT +
          (band.lines.length ? 6 : 0)
      )
    }
    context.lineWidth = 1
    context.strokeStyle = palette.grid
    context.strokeRect(0.5, 0.5, plan.cssWidth - 1, plan.cssHeight - 1)
    const encoded = await abortable(
      new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(new Error('The Excel image could not be encoded.')),
          'image/png'
        )
      }),
      signal
    )
    const blob = await pngWithDpi(encoded, DPI)
    aborted(signal)
    return { blob, width: plan.width, height: plan.height }
  } finally {
    for (const entry of photos.values()) entry.bitmap.close()
    photos.clear()
    canvas.width = canvas.height = 0
  }
}
