import test from 'node:test'
import assert from 'node:assert/strict'
import {
  workbookCodeImage,
  createPackingWorkbookImages,
} from '../src/packing-workbook-images.js'

function canvasDocument() {
  const drawings = []
  const document = {
    createElement: (tag) => {
      assert.equal(tag, 'canvas')
      const canvas = { width: 0, height: 0 }
      const context = {
        font: '10px Arial',
        fillStyle: '',
        measureText(value) {
          const size = Number(this.font.match(/([\d.]+)px/)[1])
          return {
            width: value.length * size * 0.62,
            actualBoundingBoxAscent: size * 0.74,
            actualBoundingBoxDescent: size * 0.18,
          }
        },
        beginPath() {},
        roundRect(...bounds) {
          drawings.push({ kind: 'background', color: this.fillStyle, bounds })
        },
        fill() {},
        fillText(value, x, y) {
          drawings.push({
            kind: 'text',
            color: this.fillStyle,
            value,
            x,
            y,
            width: this.measureText(value).width,
          })
        },
        fillRect(...bounds) {
          drawings.push({ kind: 'underline', color: this.fillStyle, bounds })
        },
      }
      canvas.getContext = () => context
      canvas.toBlob = (callback) => callback(new Blob(['synthetic raster']))
      return canvas
    },
  }
  return { document, drawings }
}

test('workbook code art keeps its black/white design and product-number underline within encoded bounds', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
  try {
    for (const code of ['CE26103102ALS', `CE26103102${'W'.repeat(50)}`]) {
      const { document, drawings } = canvasDocument()
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: document,
      })
      const image = await workbookCodeImage(code, {
        maxWidth: 512,
        maxHeight: 128,
      })
      assert.ok(image.width > 0 && image.width <= 512)
      assert.ok(image.height > 0 && image.height <= 128)
      assert.equal(image.mimeType, 'image/png')
      assert.ok(image.bytes instanceof Blob)
      assert.equal(
        drawings.find((draw) => draw.kind === 'background').color,
        '#000'
      )
      const text = drawings.find((draw) => draw.kind === 'text')
      assert.equal(text.color, '#fff')
      assert.equal(text.value, code)
      assert.ok(text.x >= 0 && text.x + text.width <= image.width)
      const underline = drawings.find((draw) => draw.kind === 'underline')
      assert.equal(underline.color, '#fff')
      assert.ok(underline.bounds[0] >= text.x)
      assert.ok(underline.bounds[0] + underline.bounds[2] <= image.width)
      assert.ok(underline.bounds[1] + underline.bounds[3] <= image.height)
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original)
    else delete globalThis.document
  }
})

test('omitted picture columns do not generate artwork or read source photos', async () => {
  let loaded = false
  const prepare = createPackingWorkbookImages(async () => {
    loaded = true
  })
  assert.deepEqual(
    await prepare(
      { barcode: 'CE26103102ALS', thumbnail: 'synthetic-photo' },
      {}
    ),
    { code: undefined }
  )
  assert.equal(loaded, false)
  assert.equal(await workbookCodeImage(''), undefined)
})
