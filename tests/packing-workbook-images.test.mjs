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
        drawImage(image, ...bounds) {
          drawings.push({ kind: 'photo', bounds })
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

test('workbook photo assets are always square and retain the product aspect ratio', async () => {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const oldImage = Object.getOwnPropertyDescriptor(globalThis, 'Image')
  try {
    for (const [width, height] of [
      [200, 200],
      [100, 200],
      [200, 100],
    ]) {
      const { document, drawings } = canvasDocument()
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: document,
      })
      Object.defineProperty(globalThis, 'Image', {
        configurable: true,
        value: class {
          naturalWidth = width
          naturalHeight = height
          async decode() {}
          removeAttribute() {}
        },
      })
      const prepare = createPackingWorkbookImages(
        async () => new Blob(['synthetic source'])
      )
      const result = await prepare(
        { thumbnail: 'synthetic source' },
        { photo: { maxWidth: 320, maxHeight: 240 } }
      )
      assert.equal(result.photo.width, 240)
      assert.equal(result.photo.height, 240)
      const [x, y, drawnWidth, drawnHeight] = drawings.find(
        (draw) => draw.kind === 'photo'
      ).bounds
      assert.equal(drawnWidth / drawnHeight, width / height)
      assert.equal(x + drawnWidth / 2, 120)
      assert.equal(y + drawnHeight / 2, 120)
      if (width === height)
        assert.deepEqual([x, y, drawnWidth, drawnHeight], [0, 0, 240, 240])
    }
  } finally {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
    else delete globalThis.document
    if (oldImage) Object.defineProperty(globalThis, 'Image', oldImage)
    else delete globalThis.Image
  }
})

test('carton marks reuse bounded artwork for the same group, omit missing categories and propagate failures', async (t) => {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const oldImage = Object.getOwnPropertyDescriptor(globalThis, 'Image')
  t.after(() => {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
    else delete globalThis.document
    if (oldImage) Object.defineProperty(globalThis, 'Image', oldImage)
    else delete globalThis.Image
  })
  const { document } = canvasDocument()
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: document,
  })
  Object.defineProperty(globalThis, 'Image', {
    configurable: true,
    value: class {
      naturalWidth = 1200
      naturalHeight = 800
      async decode() {}
      removeAttribute() {}
    },
  })
  let calls = 0
  const prepare = createPackingWorkbookImages(
    () => {
      throw new Error('No photo requested')
    },
    async () => {
      calls++
      return new Blob(['synthetic carton mark'])
    }
  )
  const limits = { mark: { maxWidth: 320, maxHeight: 240 } }
  const row = { baseCode: 'CE26101001', chineseCategory: '玻璃' }
  const first = await prepare(row, limits)
  assert.equal(first.mark.width, 320)
  assert.equal(first.mark.height, 213)
  assert.equal(first.mark.mimeType, 'image/png')
  assert.ok(first.mark.bytes instanceof Blob)
  assert.equal(
    (await prepare({ ...row, barcode: 'CE26101001S' }, limits)).mark,
    first.mark
  )
  assert.equal(calls, 1)
  assert.equal(
    (await prepare({ ...row, chineseCategory: '' }, limits)).mark,
    undefined
  )
  await prepare(row, {})
  assert.equal(calls, 1)
  const fail = createPackingWorkbookImages(undefined, async () => {
    throw new Error('Mark failed')
  })
  await assert.rejects(fail(row, limits), /Mark failed/)
})
