import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clipboardTable,
  columns,
  copySingleImage,
  pngImage,
  pngThumbnail,
} from '../src/clipboard.js'

const item = {
  description: '蜡烛\n颜色：暖白',
  price: '12.50',
  quantity: '4',
  discount: '2.10',
}
const png = 'data:image/png;base64,iVBORw0KGgo='
test('clipboard emits exactly five cells in Excel order with a plain TSV alternative', () => {
  const result = clipboardTable([item])
  assert.deepEqual(columns, [
    'Thumbnail',
    'Description',
    'Price',
    'Quantity',
    'Discount',
  ])
  assert.equal(
    result.plain,
    'Thumbnail\tDescription\tPrice\tQuantity\tDiscount\r\n\t蜡烛 · 颜色：暖白\t12.50\t4\t2.10'
  )
  assert.equal((result.html.match(/<td(?: |>|\b)/g) || []).length, 5)
  assert.match(result.html, /mso-number-format/)
})
test('bulk images remain individual img elements in their own table rows', () => {
  const result = clipboardTable([item, item], {
    images: [png, png],
    imagesOnly: true,
    headers: false,
  })
  assert.equal((result.html.match(/<img /g) || []).length, 2)
  assert.equal((result.html.match(/<td /g) || []).length, 2)
  assert.match(result.html, /height="20"/)
  assert.doesNotMatch(result.html, /<th/)
})
test('source descriptions cannot inject HTML or plain-text spreadsheet formulas', () => {
  const result = clipboardTable([
    { ...item, description: '=SUM(1,2) <script>&"' },
  ])
  assert.match(result.plain, /\t"'=/)
  assert.match(result.html, /&lt;script&gt;&amp;&quot;/)
  assert.doesNotMatch(result.html, /<script>/)
})
test('missing image slots, unsafe image formats and empty selection fail explicitly', () => {
  assert.throws(() => clipboardTable([]), /Select/)
  assert.throws(() => clipboardTable([item, item], { images: [png] }), /Every/)
  assert.throws(
    () => clipboardTable([item], { images: ['https://example.invalid/a.png'] }),
    /PNG/
  )
})

test('image conversion and single-image copying retain original pixels and aspect ratio', async (t) => {
  const canvases = [],
    clipboard = []
  const replace = (object, name, value) => {
    const previous = Object.getOwnPropertyDescriptor(object, name)
    Object.defineProperty(object, name, { value, configurable: true })
    t.after(() => {
      if (previous) Object.defineProperty(object, name, previous)
      else delete object[name]
    })
  }
  replace(
    globalThis,
    'Image',
    class {
      naturalWidth = 1200
      naturalHeight = 900
      async decode() {}
    }
  )
  replace(globalThis, 'document', {
    createElement(tag) {
      assert.equal(tag, 'canvas')
      const canvas = {
        getContext(kind) {
          assert.equal(kind, '2d')
          return { drawImage: (...args) => (canvas.draw = args) }
        },
        toDataURL(type) {
          assert.equal(type, 'image/png')
          return png
        },
      }
      canvases.push(canvas)
      return canvas
    },
  })
  replace(
    globalThis,
    'ClipboardItem',
    class {
      constructor(data) {
        this.data = data
      }
    }
  )
  replace(globalThis.navigator, 'clipboard', {
    async write(items) {
      clipboard.push(...items)
    },
  })

  assert.equal(await pngImage('data:image/jpeg;base64,AQID'), png)
  await copySingleImage('data:image/jpeg;base64,AQID')
  for (const canvas of canvases) {
    assert.equal(canvas.width, 1200)
    assert.equal(canvas.height, 900)
    assert.deepEqual(canvas.draw.slice(1), [0, 0])
  }
  assert.equal(clipboard[0].data['image/png'].type, 'image/png')
  assert.equal(
    Buffer.from(await clipboard[0].data['image/png'].arrayBuffer()).toString(
      'base64'
    ),
    png.split(',')[1]
  )

  // The compact on-screen preview remains a separate, explicit resize.
  await pngThumbnail('data:image/jpeg;base64,AQID')
  assert.equal(canvases.at(-1).width, 64)
  assert.equal(canvases.at(-1).height, 64)
  assert.deepEqual(canvases.at(-1).draw.slice(1), [0, 8, 64, 48])
})
