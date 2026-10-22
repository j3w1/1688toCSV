// The print preview's drawing adapter: the PDF page API on a 2D canvas, with
// the same units (millimetres, dash lengths included) and caption placement.
import { captionText, captionLeftMm } from './pdf-writer.js'
import {
  hasUnicodeCaption,
  unicodeCaption,
  printCaptionFont,
} from './print-captions.js'

/** Canvas drawing with the PDF page API, at `k` pixels per millimetre. */
export function canvasPage(context, k) {
  const shade = (gray) => {
    const value = Math.round(gray * 255)
    return `rgb(${value},${value},${value})`
  }
  const api = {
    image(image, box, { rotate = false } = {}) {
      if (!image) {
        context.fillStyle = '#eee'
        context.fillRect(
          box.xMm * k,
          box.yMm * k,
          box.widthMm * k,
          box.heightMm * k
        )
        return api
      }
      context.save()
      if (rotate) {
        context.translate(box.xMm * k, (box.yMm + box.heightMm) * k)
        context.rotate(-Math.PI / 2)
        context.drawImage(image, 0, 0, box.heightMm * k, box.widthMm * k)
      } else
        context.drawImage(
          image,
          box.xMm * k,
          box.yMm * k,
          box.widthMm * k,
          box.heightMm * k
        )
      context.restore()
      return api
    },
    line(x1, y1, x2, y2, { gray = 0.6, widthPt = 0.25, dash = null } = {}) {
      context.save()
      context.strokeStyle = shade(gray)
      context.lineWidth = Math.max(0.5, (widthPt / 72) * 25.4 * k)
      context.setLineDash(dash ? dash.map((d) => d * k) : [])
      context.beginPath()
      context.moveTo(x1 * k, y1 * k)
      context.lineTo(x2 * k, y2 * k)
      context.stroke()
      context.restore()
      return api
    },
    circle(cx, cy, r, { gray = 0.6 } = {}) {
      context.save()
      context.strokeStyle = shade(gray)
      context.lineWidth = 0.6
      context.beginPath()
      context.arc(cx * k, cy * k, r * k, 0, Math.PI * 2)
      context.stroke()
      context.restore()
      return api
    },
    // ASCII shares Helvetica geometry; Unicode shares the PDF caption raster font.
    text(value, x, y, { size = 6, gray = 0.45, align = 'left' } = {}) {
      const unicode = hasUnicodeCaption(value)
      const text = unicode ? unicodeCaption(value) : captionText(value)
      if (!text) return api
      context.save()
      context.fillStyle = shade(gray)
      context.font = unicode
        ? printCaptionFont((size / 72) * 25.4 * k)
        : `${(size / 72) * 25.4 * k}px Helvetica, Arial, sans-serif`
      context.textAlign = unicode ? align : 'left'
      context.fillText(
        text,
        (unicode ? x : captionLeftMm(value, x, size, align)) * k,
        y * k
      )
      context.restore()
      return api
    },
  }
  return api
}
