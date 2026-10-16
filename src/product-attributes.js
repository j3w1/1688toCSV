import { getItemColorHints } from './color-vocabulary.js'
import { DEFAULT_SIZE_VOCABULARY } from './size-vocabulary.js'

// Display-only vocabulary. Never replace imported descriptions, SKU values or
// product numbers with these helpers when saving or exporting an order.
const definitions = [
  ['颜色|颜色分类|产品颜色', 'Color', 'Color', 'color'],
  ['规格|规格分类', 'Specifications', 'Especificaciones', 'size'],
  ['货号|商品编号|产品编号|款号|编号', 'Code', 'Código', 'code'],
  ['尺码', 'Size', 'Talla', 'size'],
  ['尺寸|尺寸规格|规格尺寸', 'Dimensions', 'Medidas', 'size'],
  ['容量|容积', 'Capacity', 'Capacidad', 'size'],
  ['层数（规格）', 'Layers / specifications', 'Niveles / medidas', 'variant'],
  ['功率|光源功率', 'Power', 'Potencia', 'variant'],
  ['色温', 'Color temperature', 'Temperatura de color', 'variant'],
  ['笔芯颜色', 'Ink color', 'Color de tinta', 'color'],
  ['传输模式', 'Transmission mode', 'Transmisión', 'model'],
  ['型号|model', 'Model', 'Modelo', 'model'],
  ['封面颜色', 'Cover color', 'Color de portada', 'color'],
  ['规格（长*宽cm）', 'Length × width (cm)', 'Largo × ancho (cm)', 'size'],
  ['规格（长*宽）', 'Length × width', 'Largo × ancho', 'size'],
  ['内框尺寸', 'Inner dimensions', 'Medidas interiores', 'size'],
  ['外框尺寸', 'Outer dimensions', 'Medidas exteriores', 'size'],
  [
    '规格型号',
    'Specifications / model',
    'Especificaciones / modelo',
    'variant',
  ],
  ['画笔颜色', 'Brush color', 'Color del pincel', 'color'],
  ['长度(CM)', 'Length (cm)', 'Largo (cm)', 'size'],
  ['长度', 'Length', 'Largo', 'size'],
  ['宽度', 'Width', 'Ancho', 'size'],
  ['高度', 'Height', 'Alto', 'size'],
  ['直径', 'Diameter', 'Diámetro', 'size'],
  ['重量|净含量', 'Weight / contents', 'Peso / contenido', 'size'],
  ['花型', 'Pattern', 'Diseño', 'variant'],
  ['灯光颜色', 'Light color', 'Color de luz', 'color'],
  ['双层厚度', 'Double-layer thickness', 'Grosor doble', 'size'],
  ['外观颜色', 'Exterior color', 'Color exterior', 'color'],
  ['铅芯颜色', 'Lead color', 'Color de mina', 'color'],
  ['铅芯硬度', 'Lead hardness', 'Dureza de mina', 'variant'],
  ['笔头形状', 'Tip shape', 'Forma de punta', 'variant'],
  ['内页页数', 'Pages', 'Páginas', 'variant'],
  ['形状', 'Shape', 'Forma', 'variant'],
  ['图片', 'Image / variant', 'Imagen / variante', 'variant'],
  ['包装规格', 'Packaging', 'Presentación', 'variant'],
  ['笔头', 'Tip', 'Punta', 'variant'],
  ['香型', 'Scent', 'Aroma', 'variant'],
  ['款式', 'Style', 'Estilo', 'variant'],
]

const key = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
const labels = new Map(
  definitions.flatMap(([aliases, en, es, kind]) =>
    aliases.split('|').map((alias) => [key(alias), { en, es, kind }])
  )
)
const languageKey = (language) =>
  /^(?:zh|cn)(?:-|$)/i.test(language)
    ? 'zh'
    : /^(?:es|spa)(?:-|$)/i.test(language)
      ? 'es'
      : 'en'

function fieldKind(label) {
  return labels.get(key(label))?.kind || (label ? 'variant' : 'text')
}

function descriptionSegments(line) {
  const segments = []
  let start = 0
  // A middle dot in a product name is not an attribute separator unless a
  // recognized field follows it (older exports also used this inline format).
  for (const match of line.matchAll(
    /\s*[·•]\s*(?=([^:：·•\n]{1,40}?)\s*[:：])/gu
  )) {
    if (!labels.has(key(match[1]))) continue
    segments.push(line.slice(start, match.index))
    start = match.index + match[0].length
  }
  segments.push(line.slice(start))
  return segments
}

/** Parse structured properties first, with a lossless fallback for old exports. */
export function productAttributes(item = {}) {
  const description = String(item.description ?? '')
  const lines = description.split(/\r?\n/)
  const title =
    String(item.title ?? '') || lines.find((line) => line.trim()) || ''
  const fields = []
  const seen = new Set()
  const rawSeen = new Set()
  const add = (label, value, raw) => {
    label = String(label ?? '')
    value = String(value ?? '')
    raw = String(raw ?? (label ? `${label}: ${value}` : value))
    if (!value.trim()) return
    const identity = `${key(label)}\u0000${value.trim()}`
    if (seen.has(identity) || (raw.trim() && rawSeen.has(raw.trim()))) return
    fields.push({ label, value, raw, kind: fieldKind(label) })
    seen.add(identity)
    if (raw.trim()) rawSeen.add(raw.trim())
  }
  for (const property of Array.isArray(item.skuProperties)
    ? item.skuProperties
    : []) {
    if (!property || typeof property !== 'object') continue
    add(property.label, property.value, property.raw)
  }
  let removedTitle = false
  for (const line of lines) {
    if (!line.trim()) continue
    if (!removedTitle && line.trim() === title.trim()) {
      removedTitle = true
      continue
    }
    for (const segment of descriptionSegments(line)) {
      const match = segment.match(/^\s*([^:：\n]{1,40}?)\s*[:：]\s*(.*)$/)
      if (match) add(match[1], match[2], segment)
      else if (!rawSeen.has(segment.trim())) add('', segment, segment)
    }
  }
  if (item.productNumber !== undefined && String(item.productNumber).trim())
    add('货号', item.productNumber)
  return { title, description: description || title, fields }
}

const sizeNames = {
  XS: ['Extra small', 'Extrapequeño'],
  S: ['Small', 'Pequeño'],
  M: ['Medium', 'Mediano'],
  L: ['Large', 'Grande'],
  XL: ['Extra large', 'Extragrande'],
  XXL: ['XXL', 'XXL'],
  XXXL: ['XXXL', 'XXXL'],
}
const words = [
  ['均码|均号', 'One size', 'Talla única'],
  ['可调节|可调', 'Adjustable', 'Ajustable'],
  ['可伸缩', 'Extendable', 'Extensible'],
  ['站立可伸缩款', 'Standing, extendable', 'De pie, extensible'],
  ['站立款|站姿', 'Standing', 'De pie'],
  ['坐姿|坐款', 'Sitting', 'Sentado'],
  ['横款|横版', 'Landscape', 'Horizontal'],
  ['竖款|竖版', 'Portrait', 'Vertical'],
  ['圆形', 'Round', 'Redondo'],
  ['方形|方型', 'Square', 'Cuadrado'],
  ['正方形', 'Square', 'Cuadrado'],
  ['长方形', 'Rectangular', 'Rectangular'],
  ['如图所示|如图|图片色|请看图片|看图片', 'As pictured', 'Como en la foto'],
  ['看详情', 'See details', 'Ver detalles'],
  ['默认尺寸', 'Default size', 'Medida estándar'],
  ['加厚', 'Thickened', 'Grueso'],
  ['无孔', 'No holes', 'Sin agujeros'],
  ['无盒', 'Without box', 'Sin caja'],
  ['盒装', 'Boxed', 'En caja'],
  ['两件套', '2-piece set', 'Juego de 2'],
]
const literalWords = [
  ...DEFAULT_SIZE_VOCABULARY.flatMap(({ match, suffix }) => {
    const names = sizeNames[suffix]
    return names
      ? match
          .split('|')
          .filter((alias) => /\p{Script=Han}/u.test(alias))
          .map((alias) => [alias, ...names])
      : []
  }),
  ...words.flatMap(([aliases, ...names]) =>
    aliases.split('|').map((alias) => [alias, ...names])
  ),
].sort((a, b) => b[0].length - a[0].length)

const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wordPattern = new RegExp(
  `(?<![\\p{L}])(?:${literalWords.map(([alias]) => escaped(alias)).join('|')})(?![\\p{L}])`,
  'gu'
)
const wordTranslations = new Map(
  literalWords.map(([alias, en, es]) => [alias, { en, es }])
)
// Replace standalone known words, never substrings inside unknown model names.
function translateWords(value, language) {
  return value.replace(
    wordPattern,
    (word) => wordTranslations.get(word)?.[language] || word
  )
}

const unitPattern =
  '(?:毫米|厘米|公分|千克|公斤|毫升|英寸|mm|cm|kg|ml|inch|in|米|升|克|寸|m|l|g)'
const numberPattern = '(?:\\d+(?:\\.\\d+)?|\\.\\d+)'
const measurementPattern = new RegExp(
  `^\\s*(${numberPattern}(?:\\s*[xX×*]\\s*${numberPattern}){0,2})\\s*(${unitPattern})\\s*$`,
  'i'
)
const standardUnits = {
  毫米: 'mm',
  厘米: 'cm',
  公分: 'cm',
  千克: 'kg',
  公斤: 'kg',
  毫升: 'ml',
  英寸: 'in',
  米: 'm',
  升: 'l',
  克: 'g',
}

/** Translate recognized helpers only. originalValue/raw always remain exact. */
export function translateAttribute(field, language = 'en') {
  const lang = languageKey(language)
  const originalLabel = String(field.label ?? '')
  const originalValue = String(field.value ?? '')
  const definition = labels.get(key(originalLabel))
  const kind = field.kind || fieldKind(originalLabel)
  const label =
    lang === 'zh'
      ? originalLabel || '说明'
      : definition?.[lang] ||
        originalLabel ||
        (lang === 'es' ? 'Detalle' : 'Details')
  const colors = ['code', 'model', 'text'].includes(kind)
    ? []
    : getItemColorHints(
        { skuProperties: [{ label: originalLabel, value: originalValue }] },
        lang
      )
  let value = originalValue
  if (lang !== 'zh' && !['code', 'model', 'text'].includes(kind)) {
    // The color vocabulary excludes ambiguous terms and scent names. Preserve
    // any unrecognized remainder instead of replacing a seller's variant name.
    if (colors.length)
      value = value.replace(/[^\s,，;；/+:：()【】\[\]\-]+/gu, (segment) => {
        // Recheck each segment so a valid 咖啡 color elsewhere cannot translate
        // the same characters inside 咖啡杯, an unrelated product/model name.
        const hints = getItemColorHints(
          { skuProperties: [{ label: originalLabel, value: segment }] },
          lang
        )
          .filter((hint) => colors.some((color) => color.id === hint.id))
          .sort((a, b) => b.source.length - a.source.length)
        if (!hints.length) return segment
        return segment.replace(
          new RegExp(hints.map(({ source }) => escaped(source)).join('|'), 'g'),
          (source) =>
            hints.find((hint) => hint.source === source)?.label || source
        )
      })
    value = translateWords(value, lang)
  }
  // Units are split only for a complete explicit measurement. Model/article
  // numbers and partial/range/set measurements must retain their whole value.
  const measured =
    kind === 'size' ? originalValue.match(measurementPattern) : null
  const measurement = measured
    ? {
        numberText: measured[1],
        unit:
          lang === 'zh'
            ? measured[2]
            : standardUnits[measured[2]] || measured[2],
      }
    : null
  return {
    ...field,
    label,
    value,
    originalLabel,
    originalValue,
    colors,
    measurement,
  }
}
