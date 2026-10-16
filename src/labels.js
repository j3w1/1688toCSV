import JsBarcode from 'jsbarcode'
import { pngWithDpi } from './png-resolution.js'
import { CE_CODE_DESIGN, codeDesignMetrics } from './code-design.js'

export const DEFAULT_LABEL_SETTINGS = Object.freeze({
  dpi: 300,
  website: 'casaelida.com',
  destination: 'AQP, PE',
  barcode: Object.freeze({ widthMm: 40, heightMm: 20, textScale: 1 }),
  mark: Object.freeze({ widthMm: 148.5, heightMm: 105, textScale: 1 }),
})

// Shared with the constrained editor. Values are fractions of the final PNG.
export const LABEL_FIELDS = Object.freeze({
  barcode: Object.freeze({
    code: [0.4, 0.5, 0.565, 0.17],
    spanishName: [0.39, 0.715, 0.575, 0.23],
  }),
  mark: Object.freeze({
    // The code is slightly narrower than the main artwork, with room above and
    // below its proportional band. The footer keeps two distinct columns.
    code: [0.035, 0.53, 0.93, 0.26],
    category: [0.525, 0.8, 0.44, 0.19],
  }),
})

function bounded(value, fallback, minimum, maximum, label) {
  const result = value ?? fallback
  if (!Number.isFinite(result) || result < minimum || result > maximum)
    throw new Error(`${label} must be between ${minimum} and ${maximum}`)
  return result
}

export function normalizeLabelSettings(settings = {}) {
  const result = {
    dpi: bounded(settings.dpi, 300, 150, 600, 'Resolution'),
    website: String(settings.website ?? DEFAULT_LABEL_SETTINGS.website).trim(),
    destination: String(
      settings.destination ?? DEFAULT_LABEL_SETTINGS.destination
    ).trim(),
  }
  if (!Number.isInteger(result.dpi))
    throw new Error('Resolution must be a whole number')
  if (
    !result.website ||
    result.website.length > 35 ||
    !result.destination ||
    result.destination.length > 25
  )
    throw new Error('Enter a short website and destination')
  for (const kind of ['barcode', 'mark']) {
    const entry = settings[kind] ?? {}
    const defaults = DEFAULT_LABEL_SETTINGS[kind]
    result[kind] = {
      widthMm: bounded(entry.widthMm, defaults.widthMm, 20, 300, 'Label width'),
      heightMm: bounded(
        entry.heightMm,
        defaults.heightMm,
        10,
        300,
        'Label height'
      ),
      textScale: bounded(entry.textScale, 1, 0.75, 1.25, 'Text scale'),
    }
  }
  return result
}

export function normalizeLabel(request) {
  if (!['barcode', 'mark'].includes(request.kind))
    throw new Error('Choose a barcode or shipping mark')
  const code = String(request.code ?? '')
    .trim()
    .toUpperCase()
  const pattern = request.kind === 'mark' ? /^CE\d{8}$/ : /^CE\d{8}[A-Z0-9]*$/
  if (!pattern.test(code))
    throw new Error(
      request.kind === 'mark'
        ? 'Enter a base CE code with eight digits'
        : 'Enter a CE code with eight digits and optional variant letters or numbers'
    )
  const spanishName = String(request.spanishName ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
  const category = String(request.category ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  if (request.kind === 'barcode' && (!spanishName || spanishName.length > 80))
    throw new Error('Enter a short Spanish product name, up to 80 characters')
  if (request.kind === 'mark' && (!category || category.length > 30))
    throw new Error('Enter a short Chinese category, up to 30 characters')
  return { kind: request.kind, code, spanishName, category }
}

function aborted(signal) {
  if (signal?.aborted)
    throw new DOMException('Label rendering cancelled', 'AbortError')
}

async function yieldToBrowser() {
  if (globalThis.scheduler?.yield) await globalThis.scheduler.yield()
  else await new Promise((resolve) => setTimeout(resolve, 0))
}

function textBox(
  context,
  value,
  box,
  {
    size,
    minSize = size * 0.55,
    color = '#000',
    align = 'center',
    wrap = false,
    fitInk = false,
    field,
  } = {}
) {
  const [x, y, width, height] = box
  const textWidth = width
  context.textAlign = align
  context.textBaseline = 'middle'
  let lines = [value]
  let fontSize = Math.floor(size)
  let ink
  for (; fontSize >= Math.ceil(minSize); fontSize--) {
    context.font = `${CE_CODE_DESIGN.fontWeight} ${fontSize}px ${CE_CODE_DESIGN.fontFamily}`
    lines = [value]
    if (wrap && context.measureText(value).width > textWidth) {
      const words = value.includes(' ') ? value.split(' ') : [...value]
      const separator = value.includes(' ') ? ' ' : ''
      lines = ['']
      for (const word of words) {
        const candidate = lines.at(-1)
          ? `${lines.at(-1)}${separator}${word}`
          : word
        if (context.measureText(candidate).width > textWidth && lines.at(-1))
          lines.push(word)
        else lines[lines.length - 1] = candidate
      }
    }
    if (fitInk) {
      const bounds = lines.map((line, index) => {
        const measured = context.measureText(line)
        const offset = (index - (lines.length - 1) / 2) * fontSize * 1.1
        return {
          top: offset - measured.actualBoundingBoxAscent,
          bottom: offset + measured.actualBoundingBoxDescent,
        }
      })
      ink = {
        top: Math.min(...bounds.map((line) => line.top)),
        bottom: Math.max(...bounds.map((line) => line.bottom)),
      }
    }
    const fittedHeight = fitInk
      ? ink.bottom - ink.top
      : lines.length * fontSize * 1.1
    if (
      lines.length <= 2 &&
      fittedHeight <= height &&
      lines.every((line) => context.measureText(line).width <= textWidth)
    )
      break
  }
  if (fontSize < Math.ceil(minSize))
    throw Object.assign(
      new Error(
        'Text does not fit this label. Shorten it or increase the label size.'
      ),
      { labelField: field, labelValue: value }
    )
  const left =
    align === 'left' ? x : align === 'right' ? x + width : x + width / 2
  context.fillStyle = color
  lines.forEach((line, index) => {
    // Large carton identifiers fit their printed glyphs, not unused font leading.
    const inkOffset = fitInk ? -(ink.top + ink.bottom) / 2 : 0
    context.fillText(
      line,
      left,
      y +
        height / 2 +
        inkOffset +
        (index - (lines.length - 1) / 2) * fontSize * 1.1
    )
  })
}

/** Integer bars with ten-module quiet zones, never resized after drawing. */
export function barcodeGeometry(code, width, dpi) {
  const output = {}
  JsBarcode(output, code, { format: 'CODE128', displayValue: false, margin: 0 })
  const bits = output.encodings.map((entry) => entry.data).join('')
  const moduleWidth = Math.floor((width * 0.94) / (bits.length + 20))
  if (moduleWidth < Math.ceil((dpi * 0.15) / 25.4))
    throw Object.assign(
      new Error(
        'This barcode is too long for the label width. Shorten the suffix or increase the width.'
      ),
      { labelField: 'variant', labelValue: code }
    )
  return {
    bits,
    moduleWidth,
    quietZone: 10 * moduleWidth,
    x: Math.floor((width - bits.length * moduleWidth) / 2),
  }
}

function scaleBox(box, width, height) {
  return box.map((value, index) => value * (index % 2 ? height : width))
}

/** Shared printed/editor geometry, centered on visible glyphs rather than font leading. */
export function labelCodeLayout(context, model, settings, width, height) {
  const { kind, code } = model
  const box = scaleBox(LABEL_FIELDS[kind].code, width, height)
  const minimum = Math.ceil(height * (kind === 'mark' ? 0.11 : 0.065))
  let fontSize = Math.floor(
    height * (kind === 'mark' ? 0.182 : 0.12) * settings[kind].textScale
  )
  let metrics, design
  context.save()
  try {
    context.textAlign = 'left'
    context.textBaseline = 'alphabetic'
    context.fontKerning = 'none'
    for (; fontSize >= minimum; fontSize--) {
      context.font = `${CE_CODE_DESIGN.fontWeight} ${fontSize}px ${CE_CODE_DESIGN.fontFamily}`
      metrics = context.measureText(code)
      design = codeDesignMetrics(fontSize)
      if (
        Math.max(
          metrics.width,
          metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
        ) <=
          box[2] - design.paddingInline * 2 &&
        metrics.actualBoundingBoxAscent +
          metrics.actualBoundingBoxDescent +
          design.paddingBlock * 2 <=
          box[3]
      )
        break
    }
    if (fontSize < minimum)
      throw Object.assign(
        new Error(
          'Text does not fit this label. Shorten it or increase the label size.'
        ),
        { labelField: kind === 'mark' ? 'code' : 'variant', labelValue: code }
      )
    const inkWidth =
      metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
    const inkHeight =
      metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
    const padding = design.paddingInline
    const bandWidth = inkWidth + padding * 2
    const bandHeight = inkHeight + design.paddingBlock * 2
    const band = [
      box[0] + (box[2] - bandWidth) / 2,
      box[1] + (box[3] - bandHeight) / 2,
      bandWidth,
      bandHeight,
    ]
    return {
      box,
      band,
      padding,
      radius: design.radius,
      font: context.font,
      fontSize,
      advanceWidth: metrics.width,
      textX: band[0] + padding + metrics.actualBoundingBoxLeft,
      textY:
        band[1] +
        band[3] / 2 +
        (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) /
          2,
      // Native inputs center a font line box. Compensate its leading while the
      // noneditable span uses text-box trimming where the browser supports it.
      inputShift:
        (metrics.actualBoundingBoxAscent -
          metrics.actualBoundingBoxDescent -
          metrics.fontBoundingBoxAscent +
          metrics.fontBoundingBoxDescent) /
        2,
    }
  } finally {
    context.restore()
  }
}

function drawCodeBand(context, model, settings, width, height) {
  const code = labelCodeLayout(context, model, settings, width, height)
  context.save()
  context.fillStyle = CE_CODE_DESIGN.background
  context.beginPath()
  context.roundRect(...code.band, code.radius)
  context.fill()
  context.font = code.font
  context.fontKerning = 'none'
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
  context.fillStyle = CE_CODE_DESIGN.foreground
  context.fillText(model.code, code.textX, code.textY)
  context.restore()
}

async function logoArtworkBounds(image, signal) {
  const width = image.naturalWidth
  const height = image.naturalHeight
  const canvas = document.createElement('canvas')
  // Inspect original pixels in small tiles so thin or pale artwork survives.
  canvas.width = Math.min(width, 512)
  canvas.height = Math.min(height, 512)
  let left = width,
    top = height,
    right = -1,
    bottom = -1
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return [0, 0, width, height]
    for (let y = 0; y < height; y += canvas.height) {
      for (let x = 0; x < width; x += canvas.width) {
        aborted(signal)
        const tileWidth = Math.min(canvas.width, width - x)
        const tileHeight = Math.min(canvas.height, height - y)
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(
          image,
          x,
          y,
          tileWidth,
          tileHeight,
          0,
          0,
          tileWidth,
          tileHeight
        )
        const { data } = context.getImageData(0, 0, tileWidth, tileHeight)
        for (let index = 0; index < data.length; index += 4) {
          // The final label is white. Only effectively white/transparent pixels
          // are margins; internal white spaces remain part of the drawn image.
          const darkness =
            255 - Math.min(data[index], data[index + 1], data[index + 2])
          if (darkness * data[index + 3] <= 255) continue
          const pixel = index / 4
          const pixelX = x + (pixel % tileWidth)
          const pixelY = y + Math.floor(pixel / tileWidth)
          left = Math.min(left, pixelX)
          right = Math.max(right, pixelX)
          top = Math.min(top, pixelY)
          bottom = Math.max(bottom, pixelY)
        }
      }
      await yieldToBrowser()
    }
    if (right < left) return [0, 0, width, height]
    // Retain a small source-pixel margin for antialiased edges.
    left = Math.max(0, left - 2)
    top = Math.max(0, top - 2)
    right = Math.min(width - 1, right + 2)
    bottom = Math.min(height - 1, bottom + 2)
    return [left, top, right - left + 1, bottom - top + 1]
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

function createLogoBoundsCache() {
  let last
  return {
    async get(image, signal) {
      const source = image.currentSrc || image.src
      const width = image.naturalWidth
      const height = image.naturalHeight
      if (
        last?.source === source &&
        last.width === width &&
        last.height === height
      )
        return last.bounds
      const bounds = await logoArtworkBounds(image, signal)
      aborted(signal)
      // Retain only bounds for the current logo, never decoded pixels/canvases.
      last = { source, width, height, bounds }
      return bounds
    },
    clear() {
      last = null
    },
  }
}

async function drawBarcode(
  context,
  model,
  settings,
  width,
  height,
  logoUrl,
  signal,
  logoBounds
) {
  const factor = settings.barcode.textScale
  textBox(
    context,
    settings.website,
    [width * 0.035, height * 0.03, width * 0.58, height * 0.115],
    { size: height * 0.083 * factor, align: 'left', field: 'labelSettings' }
  )
  textBox(
    context,
    settings.destination,
    [width * 0.66, height * 0.03, width * 0.305, height * 0.115],
    { size: height * 0.083 * factor, align: 'right', field: 'labelSettings' }
  )
  const geometry = barcodeGeometry(model.code, width, settings.dpi)
  const top = Math.round(height * 0.175)
  const barHeight = Math.round(height * 0.29)
  context.fillStyle = '#000'
  for (let index = 0; index < geometry.bits.length; index++) {
    if (geometry.bits[index] === '1')
      context.fillRect(
        geometry.x + index * geometry.moduleWidth,
        top,
        geometry.moduleWidth,
        barHeight
      )
  }
  drawCodeBand(context, model, settings, width, height)
  textBox(
    context,
    model.spanishName,
    scaleBox(LABEL_FIELDS.barcode.spanishName, width, height),
    {
      size: height * 0.135 * factor,
      minSize: height * 0.07,
      wrap: true,
      field: 'name',
    }
  )
  if (logoUrl) {
    const image = new Image()
    image.src = logoUrl
    await image.decode()
    aborted(signal)
    const crop = await logoBounds.get(image, signal)
    aborted(signal)
    const box = [width * 0.03, height * 0.65, width * 0.335, height * 0.31]
    const ratio = Math.min(box[2] / crop[2], box[3] / crop[3])
    const imageWidth = crop[2] * ratio
    const imageHeight = crop[3] * ratio
    context.drawImage(
      image,
      ...crop,
      box[0] + (box[2] - imageWidth) / 2,
      box[1] + (box[3] - imageHeight) / 2,
      imageWidth,
      imageHeight
    )
  }
}

function drawMark(context, model, settings, width, height) {
  const factor = settings.mark.textScale
  textBox(
    context,
    'CE',
    [width * 0.035, height * 0.01, width * 0.93, height * 0.512],
    { size: height * 0.72 * factor, fitInk: true }
  )
  drawCodeBand(context, model, settings, width, height)
  for (const [caption, unit, top] of [
    ['数量：', '', 0.805],
    ['重量：', 'KG', 0.865],
    ['体积：', 'CBM', 0.925],
  ]) {
    textBox(
      context,
      caption,
      [width * 0.045, height * top, width * 0.1, height * 0.05],
      { size: height * 0.04 * factor, align: 'left' }
    )
    context.strokeStyle = '#000'
    context.lineWidth = Math.max(1, Math.round(width / 1500))
    context.beginPath()
    context.moveTo(width * 0.135, height * (top + 0.044))
    context.lineTo(width * (unit ? 0.38 : 0.475), height * (top + 0.044))
    context.stroke()
    if (unit)
      textBox(
        context,
        unit,
        [width * 0.395, height * top, width * 0.08, height * 0.05],
        { size: height * 0.037 * factor, align: 'left' }
      )
  }
  textBox(
    context,
    model.category,
    scaleBox(LABEL_FIELDS.mark.category, width, height),
    {
      size: height * 0.2 * factor,
      minSize: height * 0.066,
      wrap: true,
      fitInk: true,
      field: 'category',
    }
  )
}

async function drawLabel(request) {
  const { model, settings, logoUrl, signal, logoBounds } = request
  aborted(signal)
  const { widthMm, heightMm } = settings[model.kind]
  const width = Math.round((widthMm * settings.dpi) / 25.4)
  const height = Math.round((heightMm * settings.dpi) / 25.4)
  if (width * height > 16_000_000)
    throw new Error(
      'This label is too large. Reduce its dimensions or resolution.'
    )
  await yieldToBrowser()
  aborted(signal)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  try {
    const context = canvas.getContext('2d')
    if (!context)
      throw new Error('The browser could not create the label image')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    if (model.kind === 'barcode')
      await drawBarcode(
        context,
        model,
        settings,
        width,
        height,
        logoUrl,
        signal,
        logoBounds
      )
    else drawMark(context, model, settings, width, height)
    aborted(signal)
    await yieldToBrowser()
    const png = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error('The browser could not encode the label PNG')),
        'image/png'
      )
    )
    aborted(signal)
    const blob = await pngWithDpi(png, settings.dpi)
    aborted(signal)
    return { blob, width, height, widthMm, heightMm, dpi: settings.dpi }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

/** Only requested previews are rendered. Cache cost includes decoded pixel size. */
export function createLabelRenderer({
  maxBytes = 64 * 1024 * 1024,
  maxConcurrent = 2,
  render = drawLabel,
} = {}) {
  if (
    !Number.isFinite(maxBytes) ||
    maxBytes < 0 ||
    maxBytes > 64 * 1024 * 1024 ||
    !Number.isInteger(maxConcurrent) ||
    maxConcurrent < 1 ||
    maxConcurrent > 2
  )
    throw new Error('Use a cache up to 64 MB and one or two rendering tasks')
  const cache = new Map()
  const queue = []
  const activeTasks = new Set()
  const logoBounds = createLogoBoundsCache()
  let bytes = 0
  let disposed = false

  function cached(key) {
    const entry = cache.get(key)
    if (!entry) return null
    cache.delete(key)
    cache.set(key, entry)
    return entry.result
  }

  async function run(task) {
    try {
      aborted(task.request.signal)
      const result = cached(task.key) || (await render(task.request))
      aborted(task.request.signal)
      if (!cache.has(task.key)) {
        const cost = result.blob.size + result.width * result.height * 4
        while (cache.size && bytes + cost > maxBytes) {
          const [key, entry] = cache.entries().next().value
          cache.delete(key)
          bytes -= entry.cost
        }
        if (cost <= maxBytes && !disposed) {
          cache.set(task.key, { result, cost })
          bytes += cost
        }
      }
      task.resolve(result)
    } catch (error) {
      task.reject(error)
    } finally {
      task.cleanup()
      activeTasks.delete(task)
      drain()
    }
  }

  function drain() {
    while (!disposed && activeTasks.size < maxConcurrent && queue.length) {
      const task = queue.shift()
      activeTasks.add(task)
      void run(task)
    }
  }

  return {
    render(request) {
      try {
        if (disposed) throw new Error('The label renderer is closed')
        aborted(request.signal)
        const model = normalizeLabel(request)
        const settings = normalizeLabelSettings(request.settings)
        const logoUrl =
          request.logoUrl ??
          (typeof chrome !== 'undefined' && chrome.runtime?.getURL
            ? chrome.runtime.getURL('assets/casa-elida.png')
            : '')
        const key = JSON.stringify([model, settings, logoUrl])
        const hit = cached(key)
        if (hit) return Promise.resolve(hit)
        return new Promise((resolve, reject) => {
          const controller = new AbortController()
          const abort = () => {
            controller.abort()
            const index = queue.indexOf(task)
            if (index !== -1) {
              queue.splice(index, 1)
              task.cleanup()
              reject(
                new DOMException('Label rendering cancelled', 'AbortError')
              )
            }
          }
          const task = {
            key,
            resolve,
            reject,
            controller,
            request: {
              model,
              settings,
              logoUrl,
              signal: controller.signal,
              logoBounds,
            },
            cleanup: () => request.signal?.removeEventListener('abort', abort),
          }
          request.signal?.addEventListener('abort', abort, { once: true })
          queue.push(task)
          drain()
        })
      } catch (error) {
        return Promise.reject(error)
      }
    },
    stats: () => ({
      entries: cache.size,
      bytes,
      active: activeTasks.size,
      queued: queue.length,
    }),
    dispose() {
      disposed = true
      for (const task of queue.splice(0)) {
        task.cleanup()
        task.reject(new DOMException('Label rendering cancelled', 'AbortError'))
      }
      for (const task of activeTasks) task.controller.abort()
      cache.clear()
      logoBounds.clear()
      bytes = 0
    },
  }
}

const renderer = createLabelRenderer()
export const renderLabel = (request) => renderer.render(request)
