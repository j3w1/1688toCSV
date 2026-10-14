import { pngWithDpi } from './png-resolution.js'

const SCALE = 2
const DPI = 192
const MAX_PIXELS = 16_000_000
const MAX_EDGE = 8192
const CACHE_BYTES = 4 * 1024 * 1024
const PADDING = 8
const LINE_HEIGHT = 20
const PHOTO_SIZE = 76
const FONT_FAMILY =
  '"Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
const BODY_FONT = `14px ${FONT_FAMILY}`
const HEADER_FONT = `600 13px ${FONT_FAMILY}`
const NUMBER_FONT = `15px ${FONT_FAMILY}`

export const excelImageColumns = Object.freeze(
  [
    { key: 'number', label: '序号', width: 46, numeric: true },
    { key: 'thumbnail', label: '图片', width: 92 },
    { key: 'description', label: '产品描述', width: 280 },
    { key: 'baseCode', label: '产品编码', width: 118 },
    { key: 'barcode', label: '条码编号', width: 145 },
    { key: 'spanishName', label: '西班牙语品名', width: 180 },
    { key: 'chineseCategory', label: '中文品类', width: 112 },
    { key: 'price', label: '单价（元）', width: 86, numeric: true },
    { key: 'quantity', label: '数量', width: 72, numeric: true },
    { key: 'discount', label: '优惠（元）', width: 86, numeric: true },
  ].map(Object.freeze)
)

function canvasContext() {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('This browser cannot create the Excel image.')
  return { canvas, context }
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Keep words together where possible; long codes and CJK wrap without truncation. */
function wrap(context, value, width) {
  const lines = []
  for (const paragraph of String(value)
    .replaceAll('\r\n', '\n')
    .split(/[\r\n]/)) {
    if (!paragraph.trim()) {
      lines.push('')
      continue
    }
    let line = ''
    for (const token of paragraph.match(/\s+|\S+/gu) || []) {
      if (context.measureText(line + token).width <= width) {
        line += token
        continue
      }
      if (line.trim()) lines.push(line.trimEnd())
      line = token.trimStart()
      if (context.measureText(line).width <= width) continue
      const parts = [...graphemes.segment(line)].map((entry) => entry.segment)
      let start = 0
      while (start < parts.length) {
        let low = 1
        let high = 1
        const remaining = parts.length - start
        while (
          high < remaining &&
          context.measureText(parts.slice(start, start + high).join(''))
            .width <= width
        )
          high = Math.min(remaining, high * 2)
        let fits = 0
        while (low <= high) {
          const length = Math.floor((low + high) / 2)
          const candidate = parts.slice(start, start + length).join('')
          if (context.measureText(candidate).width <= width) {
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
    lines.push(line.trimEnd())
  }
  return lines
}

function snapshot(row, index) {
  if (!row || typeof row !== 'object')
    throw new Error(`Product row ${index + 1} is invalid.`)
  const values = {}
  for (const key of [
    'orderId',
    'groupId',
    ...excelImageColumns.map((column) => column.key),
  ])
    values[key] = key === 'number' ? String(index + 1) : String(row[key] ?? '')
  if (!values.thumbnail.trim())
    throw new Error(
      `Product row ${index + 1} has no photo. Add or refresh its photo before copying.`
    )
  return Object.freeze(values)
}

/** Plan every selected row before choosing a numbered batch; does not load photos. */
export function planExcelImage(rows) {
  if (!Array.isArray(rows) || !rows.length)
    throw new Error('Select product rows to copy as an image.')
  const { canvas, context } = canvasContext()
  try {
    const cssWidth =
      2 + excelImageColumns.reduce((sum, column) => sum + column.width, 0)
    const width = cssWidth * SCALE
    const maxHeight = Math.floor(
      Math.min(MAX_EDGE, Math.floor(MAX_PIXELS / width)) / SCALE
    )
    if (width > MAX_EDGE)
      throw new Error('The Excel image is too wide to render safely.')
    context.font = HEADER_FONT
    const headers = excelImageColumns.map((column) =>
      Object.freeze(wrap(context, column.label, column.width - PADDING * 2))
    )
    const headerHeight = Math.max(
      36,
      ...headers.map((lines) => lines.length * LINE_HEIGHT + PADDING * 2)
    )
    const plans = []
    let entries = []
    let start = 0
    let cssHeight = headerHeight + 2
    let seen = new Set()
    let previous = null
    function finish() {
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
          headers: Object.freeze(headers),
          rows: Object.freeze(entries),
        })
      )
      start += entries.length
      entries = []
      cssHeight = headerHeight + 2
      seen = new Set()
      previous = null
    }
    function prepare(source, groupKey) {
      const cells = excelImageColumns.map((column) => {
        const text =
          column.key === 'thumbnail' ||
          (column.key === 'baseCode' && seen.has(groupKey))
            ? ''
            : source[column.key]
        const font = column.numeric ? NUMBER_FONT : BODY_FONT
        context.font = font
        return Object.freeze({
          text,
          font,
          lines: Object.freeze(wrap(context, text, column.width - PADDING * 2)),
        })
      })
      const height = Math.max(
        96,
        ...cells.map((cell) => cell.lines.length * LINE_HEIGHT + PADDING * 2)
      )
      return Object.freeze({
        source,
        cells: Object.freeze(cells),
        height,
        separator: !previous
          ? 'none'
          : previous.source.orderId !== source.orderId
            ? 'order'
            : previous.groupKey !== groupKey
              ? 'group'
              : 'row',
        groupKey,
      })
    }
    for (const [index, row] of rows.entries()) {
      const source = snapshot(row, index)
      const groupKey = source.groupId
        ? JSON.stringify([source.orderId, source.groupId])
        : `row:${index}`
      let entry = prepare(source, groupKey)
      if (entry.height + headerHeight + 2 > maxHeight)
        throw new Error(
          `Product row ${index + 1} is too tall for one image. Shorten its description or copy its values instead.`
        )
      if (entries.length && cssHeight + entry.height > maxHeight) {
        finish()
        entry = prepare(source, groupKey)
      }
      entries.push(entry)
      cssHeight += entry.height
      seen.add(groupKey)
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
  { loadImage, onProgress, signal } = {}
) {
  if (!plan?.rows?.length || typeof loadImage !== 'function')
    throw new Error('Choose an Excel image batch and photo loader.')
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
  async function photo(source, number) {
    const cached = photos.get(source)
    if (cached) {
      photos.delete(source)
      photos.set(source, cached)
      return cached.bitmap
    }
    let bitmap
    try {
      const loaded = await abortable(Promise.resolve(loadImage(source)), signal)
      aborted(signal)
      if (!(loaded instanceof Blob) && (typeof loaded !== 'string' || !loaded))
        throw new Error('No photo data was returned.')
      const blob =
        loaded instanceof Blob
          ? loaded
          : await (await fetch(loaded, { signal })).blob()
      aborted(signal)
      bitmap = await createImageBitmap(blob, {
        resizeWidth: PHOTO_SIZE * SCALE,
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
      photos.set(source, { bitmap, bytes })
      cacheBytes += bytes
      return bitmap
    } catch (error) {
      bitmap?.close()
      if (error.name === 'AbortError') throw error
      throw new Error(
        `Photo for product row ${number} could not be loaded. Refresh the photo and try again. ${error.message}`
      )
    }
  }
  function text(lines, x, y, column, font, header = false) {
    context.font = font
    context.fillStyle = header ? '#39342b' : '#24211c'
    context.textAlign = column.numeric ? 'right' : 'left'
    context.textBaseline = 'top'
    const left = column.numeric ? x + column.width - PADDING : x + PADDING
    for (const [index, line] of lines.entries())
      context.fillText(line, left, y + PADDING + index * LINE_HEIGHT)
  }
  try {
    canvas.width = plan.width
    canvas.height = plan.height
    context.scale(SCALE, SCALE)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.fillStyle = '#fff'
    context.fillRect(0, 0, plan.cssWidth, plan.cssHeight)
    context.fillStyle = '#eeeae3'
    context.fillRect(1, 1, plan.cssWidth - 2, plan.headerHeight)
    let x = 1
    for (const [index, column] of excelImageColumns.entries()) {
      text(plan.headers[index], x, 1, column, HEADER_FONT, true)
      x += column.width
    }
    onProgress?.({ completed: 0, total: plan.rowCount })
    let y = plan.headerHeight + 1
    for (const [index, row] of plan.rows.entries()) {
      await yieldUI()
      aborted(signal)
      const bitmap = await photo(row.source.thumbnail, row.source.number)
      aborted(signal)
      if (index % 2) {
        context.fillStyle = '#faf9f6'
        context.fillRect(1, y, plan.cssWidth - 2, row.height)
      }
      x = 1
      for (const [cellIndex, column] of excelImageColumns.entries()) {
        if (column.key === 'thumbnail') {
          const ratio = Math.min(
            PHOTO_SIZE / bitmap.width,
            PHOTO_SIZE / bitmap.height
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
        } else
          text(
            row.cells[cellIndex].lines,
            x,
            y,
            column,
            row.cells[cellIndex].font
          )
        x += column.width
      }
      context.beginPath()
      context.lineWidth =
        row.separator === 'order' ? 2 : row.separator === 'group' ? 1.5 : 1
      context.strokeStyle =
        row.separator === 'order' || row.separator === 'group'
          ? '#a79f92'
          : '#ded9cf'
      context.moveTo(1, y)
      context.lineTo(plan.cssWidth - 1, y)
      context.stroke()
      y += row.height
      onProgress?.({ completed: index + 1, total: plan.rowCount })
    }
    aborted(signal)
    context.lineWidth = 1
    context.strokeStyle = '#d3cdc2'
    x = 1
    context.beginPath()
    for (const column of excelImageColumns) {
      context.moveTo(x, 1)
      context.lineTo(x, plan.cssHeight - 1)
      x += column.width
    }
    context.stroke()
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
