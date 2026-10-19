// Minimal PDF 1.4 writer for print sheets: A4 pages, deflated RGB images,
// hairlines and short Helvetica captions. Coordinates are millimetres from the
// page's top-left corner; output is exact at 100% scale.

export const POINTS_PER_MM = 72 / 25.4

const encoder = new TextEncoder()

function format(value) {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/** WinAnsi-safe caption text: printable ASCII only, PDF string escapes applied. */
export function pdfText(value) {
  return String(value)
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
    .replace(/[\\()]/g, (character) => `\\${character}`)
}

async function deflate(bytes) {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** RGBA pixels (canvas ImageData) to a deflated RGB image on a white page. */
export async function rgbImage({ width, height, data }) {
  const rgb = new Uint8Array(width * height * 3)
  for (let source = 0, target = 0; source < data.length; source += 4) {
    const alpha = data[source + 3] / 255
    rgb[target++] = Math.round(data[source] * alpha + 255 * (1 - alpha))
    rgb[target++] = Math.round(data[source + 1] * alpha + 255 * (1 - alpha))
    rgb[target++] = Math.round(data[source + 2] * alpha + 255 * (1 - alpha))
  }
  return { width, height, bytes: await deflate(rgb) }
}

export function createPdf({
  title = 'Print sheet',
  widthMm = 210,
  heightMm = 297,
} = {}) {
  const pageWidth = widthMm * POINTS_PER_MM
  const pageHeight = heightMm * POINTS_PER_MM
  const images = []
  const pages = []
  const x = (mm) => format(mm * POINTS_PER_MM)
  const y = (mm) => format(pageHeight - mm * POINTS_PER_MM)

  return {
    pageWidth,
    pageHeight,
    /** Register a deflated RGB image once; pages refer to it by name. */
    addImage(image) {
      const name = `Im${images.length + 1}`
      images.push({ ...image, name })
      return name
    },
    page() {
      const ops = []
      const page = {
        /** Place an image in a box; `rotate` turns it 90° counter-clockwise. */
        image(name, box, { rotate = false } = {}) {
          const w = box.widthMm * POINTS_PER_MM
          const h = box.heightMm * POINTS_PER_MM
          const left = box.xMm * POINTS_PER_MM
          const bottom = pageHeight - (box.yMm + box.heightMm) * POINTS_PER_MM
          const matrix = rotate
            ? [0, h, -w, 0, left + w, bottom]
            : [w, 0, 0, h, left, bottom]
          ops.push(`q ${matrix.map(format).join(' ')} cm /${name} Do Q`)
          return page
        },
        /** A stroked segment; `dash` lengths are millimetres, like coordinates. */
        line(x1, y1, x2, y2, { gray = 0.6, widthPt = 0.25, dash = null } = {}) {
          const pattern = dash
            ? `[${dash.map((mm) => format(mm * POINTS_PER_MM)).join(' ')}] 0 d`
            : '[] 0 d'
          ops.push(
            `q ${format(gray)} G ${format(widthPt)} w ${pattern} ${x(x1)} ${y(y1)} m ${x(x2)} ${y(y2)} l S Q`
          )
          return page
        },
        circle(cx, cy, rMm, { gray = 0.6, widthPt = 0.25 } = {}) {
          const r = rMm * POINTS_PER_MM
          const k = 0.5523 * r
          const px = cx * POINTS_PER_MM
          const py = pageHeight - cy * POINTS_PER_MM
          const pts = [
            [px + r, py],
            [px + r, py + k, px + k, py + r, px, py + r],
            [px - k, py + r, px - r, py + k, px - r, py],
            [px - r, py - k, px - k, py - r, px, py - r],
            [px + k, py - r, px + r, py - k, px + r, py],
          ]
          ops.push(
            `q ${format(gray)} G ${format(widthPt)} w [] 0 d ${pts[0].map(format).join(' ')} m ${pts
              .slice(1)
              .map((curve) => `${curve.map(format).join(' ')} c`)
              .join(' ')} S Q`
          )
          return page
        },
        text(value, xMm, yMm, { size = 6, gray = 0.45, align = 'left' } = {}) {
          const text = pdfText(value)
          if (!text) return page
          // Helvetica averages about half an em per character; captions only.
          const width = text.length * size * 0.5
          const left =
            xMm * POINTS_PER_MM -
            (align === 'right' ? width : align === 'center' ? width / 2 : 0)
          ops.push(
            `BT /F1 ${format(size)} Tf ${format(gray)} g ${format(left)} ${y(yMm)} Td (${text}) Tj ET`
          )
          return page
        },
      }
      pages.push(ops)
      return page
    },
    /** Serialise the document with an exact cross-reference table. */
    build() {
      const objects = []
      const add = (parts) => {
        objects.push(parts)
        return objects.length
      }
      const catalog = add(null)
      const pagesNode = add(null)
      const font = add([
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      ])
      const imageRefs = images.map((image) =>
        add([
          `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.bytes.length} >>\nstream\n`,
          image.bytes,
          '\nendstream',
        ])
      )
      const xobjects = images
        .map((image, index) => `/${image.name} ${imageRefs[index]} 0 R`)
        .join(' ')
      const pageRefs = pages.map((ops) => {
        const content = encoder.encode(ops.join('\n'))
        const contentRef = add([
          `<< /Length ${content.length} >>\nstream\n`,
          content,
          '\nendstream',
        ])
        return add([
          `<< /Type /Page /Parent ${pagesNode} 0 R /MediaBox [0 0 ${format(pageWidth)} ${format(pageHeight)}] /Resources << /Font << /F1 ${font} 0 R >> /XObject << ${xobjects} >> >> /Contents ${contentRef} 0 R >>`,
        ])
      })
      objects[catalog - 1] = [
        `<< /Type /Catalog /Pages ${pagesNode} 0 R /ViewerPreferences << /PrintScaling /None >> >>`,
      ]
      objects[pagesNode - 1] = [
        `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`,
      ]
      const info = add([
        `<< /Title (${pdfText(title)}) /Producer (1688toCSV) >>`,
      ])
      // The header's binary marker uses raw bytes, not UTF-8.
      const chunks = [
        new Uint8Array([
          ...encoder.encode('%PDF-1.4\n%'),
          0xe2,
          0xe3,
          0xcf,
          0xd3,
          0x0a,
        ]),
      ]
      let offset = chunks[0].length
      const offsets = []
      for (const [index, parts] of objects.entries()) {
        offsets.push(offset)
        const pieces = [
          encoder.encode(`${index + 1} 0 obj\n`),
          ...parts.map((part) =>
            typeof part === 'string' ? encoder.encode(part) : part
          ),
          encoder.encode('\nendobj\n'),
        ]
        for (const piece of pieces) {
          chunks.push(piece)
          offset += piece.length
        }
      }
      const xref = [
        `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
        ...offsets.map(
          (value) => `${String(value).padStart(10, '0')} 00000 n \n`
        ),
        `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`,
      ].join('')
      chunks.push(encoder.encode(xref))
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const result = new Uint8Array(total)
      let position = 0
      for (const chunk of chunks) {
        result.set(chunk, position)
        position += chunk.length
      }
      return result
    },
  }
}
