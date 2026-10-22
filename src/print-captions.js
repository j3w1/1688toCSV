import { rgbImage, POINTS_PER_MM } from './pdf-writer.js'

export const hasUnicodeCaption = (value) => /[^\x20-\x7e]/u.test(String(value))
export const unicodeCaption = (value) =>
  String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/ +/g, ' ')
    .trim()
export const printCaptionFont = (pixels) =>
  `${pixels}px Helvetica, Arial, "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`

// A conservative advance for layout bounds/truncation, including full-width CJK.
export const captionUnits = (value) =>
  [...unicodeCaption(value)].reduce(
    (sum, character) => sum + (/[^\u0000-\u024f]/u.test(character) ? 2 : 1),
    0
  )

/**
 * The lightweight PDF writer embeds Helvetica for ASCII. Non-ASCII captions use
 * a small high-resolution raster, with the same font and baseline as the preview.
 * This preserves Chinese glyphs and Spanish accents without a system PDF font.
 */
export async function embedPdfCaptions(pdf, pages, { dpi = 600, signal } = {}) {
  await document.fonts.ready
  signal?.throwIfAborted()
  const k = dpi / 25.4
  const images = new Map()
  const cache = new Map()
  const result = []
  for (const ops of pages) {
    const page = []
    for (const op of ops) {
      signal?.throwIfAborted()
      if (op.type !== 'text' || !hasUnicodeCaption(op.value)) {
        page.push(op)
        continue
      }
      const value = unicodeCaption(op.value)
      const size = op.size ?? 6
      const gray = op.gray ?? 0.45
      const signature = JSON.stringify([value, size, gray])
      let entry = cache.get(signature)
      if (!entry) {
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d', { willReadFrequently: true })
        const font = printCaptionFont((size / POINTS_PER_MM) * k)
        context.font = font
        const metrics = context.measureText(value)
        const pad = 2
        const ascent = Math.ceil(
          metrics.actualBoundingBoxAscent || (size / POINTS_PER_MM) * k
        )
        const descent = Math.ceil(
          metrics.actualBoundingBoxDescent || (size / POINTS_PER_MM) * k * 0.25
        )
        const advance = Math.ceil(metrics.width)
        canvas.width = Math.max(1, advance + 2 * pad)
        canvas.height = Math.max(1, ascent + descent + 2 * pad)
        context.fillStyle = '#fff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.font = font
        const shade = Math.round(gray * 255)
        context.fillStyle = `rgb(${shade},${shade},${shade})`
        context.fillText(value, pad, pad + ascent)
        const key = Symbol('print-caption')
        images.set(
          key,
          pdf.addImage(
            await rgbImage(
              context.getImageData(0, 0, canvas.width, canvas.height)
            )
          )
        )
        entry = {
          key,
          widthMm: canvas.width / k,
          heightMm: canvas.height / k,
          advanceMm: advance / k,
          padMm: pad / k,
          baselineMm: (pad + ascent) / k,
        }
        cache.set(signature, entry)
        canvas.width = canvas.height = 0
      }
      const aligned =
        op.align === 'center'
          ? entry.advanceMm / 2
          : op.align === 'right'
            ? entry.advanceMm
            : 0
      page.push({
        type: 'image',
        key: entry.key,
        box: {
          xMm: op.x - aligned - entry.padMm,
          yMm: op.y - entry.baselineMm,
          widthMm: entry.widthMm,
          heightMm: entry.heightMm,
        },
      })
    }
    result.push(page)
  }
  return { pages: result, images }
}
