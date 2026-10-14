import JsBarcode from 'jsbarcode'
import { pngWithDpi } from './png-resolution.js'

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
    code: [0.245, 0.425, 0.7, 0.145],
    category: [0.62, 0.64, 0.33, 0.28],
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
  } = {}
) {
  const [x, y, width, height] = box
  context.textAlign = align
  context.textBaseline = 'middle'
  context.fillStyle = color
  let lines = [value]
  let fontSize = Math.floor(size)
  for (; fontSize >= Math.ceil(minSize); fontSize--) {
    context.font = `700 ${fontSize}px Arial, "Microsoft YaHei", sans-serif`
    lines = [value]
    if (wrap && context.measureText(value).width > width) {
      const words = value.includes(' ') ? value.split(' ') : [...value]
      const separator = value.includes(' ') ? ' ' : ''
      lines = ['']
      for (const word of words) {
        const candidate = lines.at(-1)
          ? `${lines.at(-1)}${separator}${word}`
          : word
        if (context.measureText(candidate).width > width && lines.at(-1))
          lines.push(word)
        else lines[lines.length - 1] = candidate
      }
    }
    if (
      lines.length <= 2 &&
      lines.length * fontSize * 1.1 <= height &&
      lines.every((line) => context.measureText(line).width <= width)
    )
      break
  }
  if (fontSize < Math.ceil(minSize))
    throw new Error(
      'Text does not fit this label. Shorten it or increase the label size.'
    )
  const left =
    align === 'left' ? x : align === 'right' ? x + width : x + width / 2
  lines.forEach((line, index) =>
    context.fillText(
      line,
      left,
      y + height / 2 + (index - (lines.length - 1) / 2) * fontSize * 1.1
    )
  )
}

/** Integer bars with ten-module quiet zones, never resized after drawing. */
export function barcodeGeometry(code, width, dpi) {
  const output = {}
  JsBarcode(output, code, { format: 'CODE128', displayValue: false, margin: 0 })
  const bits = output.encodings.map((entry) => entry.data).join('')
  const moduleWidth = Math.floor((width * 0.94) / (bits.length + 20))
  if (moduleWidth < Math.ceil((dpi * 0.15) / 25.4))
    throw new Error(
      'This barcode is too long for the label width. Shorten the suffix or increase the width.'
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

async function drawBarcode(
  context,
  model,
  settings,
  width,
  height,
  logoUrl,
  signal
) {
  const factor = settings.barcode.textScale
  textBox(
    context,
    settings.website,
    [width * 0.035, height * 0.03, width * 0.58, height * 0.115],
    { size: height * 0.083 * factor, align: 'left' }
  )
  textBox(
    context,
    settings.destination,
    [width * 0.66, height * 0.03, width * 0.305, height * 0.115],
    { size: height * 0.083 * factor, align: 'right' }
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
  const codeBox = scaleBox(LABEL_FIELDS.barcode.code, width, height)
  context.fillRect(...codeBox)
  textBox(
    context,
    model.code,
    [
      codeBox[0] + width * 0.012,
      codeBox[1],
      codeBox[2] - width * 0.024,
      codeBox[3],
    ],
    { size: height * 0.12 * factor, minSize: height * 0.065, color: '#fff' }
  )
  textBox(
    context,
    model.spanishName,
    scaleBox(LABEL_FIELDS.barcode.spanishName, width, height),
    { size: height * 0.135 * factor, minSize: height * 0.07, wrap: true }
  )
  if (logoUrl) {
    const image = new Image()
    image.src = logoUrl
    await image.decode()
    aborted(signal)
    const box = [width * 0.035, height * 0.705, width * 0.315, height * 0.255]
    const ratio = Math.min(
      box[2] / image.naturalWidth,
      box[3] / image.naturalHeight
    )
    const imageWidth = image.naturalWidth * ratio
    const imageHeight = image.naturalHeight * ratio
    context.drawImage(
      image,
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
    [width * 0.15, height * 0.04, width * 0.7, height * 0.33],
    { size: height * 0.36 * factor }
  )
  textBox(
    context,
    '货号：',
    [width * 0.045, height * 0.425, width * 0.185, height * 0.145],
    { size: height * 0.065 * factor, align: 'left' }
  )
  textBox(
    context,
    model.code,
    scaleBox(LABEL_FIELDS.mark.code, width, height),
    { size: height * 0.105 * factor }
  )
  for (const [caption, unit, top] of [
    ['数量：', '', 0.635],
    ['重量：', 'KG', 0.75],
    ['体积：', 'CBM', 0.865],
  ]) {
    textBox(
      context,
      caption,
      [width * 0.045, height * top, width * 0.17, height * 0.08],
      { size: height * 0.046 * factor, align: 'left' }
    )
    context.strokeStyle = '#000'
    context.lineWidth = Math.max(1, Math.round(width / 1500))
    context.beginPath()
    context.moveTo(width * 0.225, height * (top + 0.065))
    context.lineTo(width * (unit ? 0.46 : 0.56), height * (top + 0.065))
    context.stroke()
    if (unit)
      textBox(
        context,
        unit,
        [width * 0.47, height * top, width * 0.09, height * 0.08],
        { size: height * 0.04 * factor, align: 'left' }
      )
  }
  textBox(
    context,
    model.category,
    scaleBox(LABEL_FIELDS.mark.category, width, height),
    { size: height * 0.12 * factor, wrap: true }
  )
}

async function drawLabel(request) {
  const { model, settings, logoUrl, signal } = request
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
        signal
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
            request: { model, settings, logoUrl, signal: controller.signal },
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
      bytes = 0
    },
  }
}

const renderer = createLabelRenderer()
export const renderLabel = (request) => renderer.render(request)
