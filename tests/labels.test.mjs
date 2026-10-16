import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import {
  BinaryBitmap,
  HybridBinarizer,
  RGBLuminanceSource,
  Code128Reader,
  DecodeHintType,
} from '@zxing/library'
import { crc32 } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  barcodeGeometry,
  createLabelRenderer,
  normalizeLabelSettings,
} from '../src/labels.js'
import { pngWithDpi } from '../src/png-resolution.js'

const repository = fileURLToPath(new URL('../', import.meta.url))
let browser, bundle, editorBundle, css, logoDataUrl
before(async () => {
  const options = {
    absWorkingDir: repository,
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
  }
  bundle = (
    await build({
      ...options,
      entryPoints: ['src/labels.js'],
      globalName: 'Labels',
    })
  ).outputFiles[0].text
  editorBundle = (
    await build({
      ...options,
      entryPoints: ['src/label-editor.js'],
      globalName: 'LabelEditor',
    })
  ).outputFiles[0].text
  css = await readFile(
    new URL('../src/label-editor.css', import.meta.url),
    'utf8'
  )
  logoDataUrl = `data:image/png;base64,${(
    await readFile(new URL('../src/assets/casa-elida.png', import.meta.url))
  ).toString('base64')}`
  browser = await chromium.launch({
    channel: process.env.EXTENSION_TEST_CHANNEL || 'chromium',
    headless: true,
  })
})
after(async () => {
  await browser?.close()
})

async function pageFor(t, editor = false) {
  const page = await browser.newPage()
  t.after(async () => await page.close())
  await page.setContent(
    '<!doctype html><html><body><main id="editor"></main><button id="outside">Outside</button></body></html>'
  )
  await page.addScriptTag({ content: bundle })
  if (editor) {
    await page.addScriptTag({ content: editorBundle })
    await page.addStyleTag({ content: css })
  }
  return page
}

function chunks(bytes) {
  const data = Buffer.from(bytes)
  const result = []
  for (let offset = 8; offset + 12 <= data.length; ) {
    const length = data.readUInt32BE(offset)
    result.push({
      type: data.toString('ascii', offset + 4, offset + 8),
      data: data.subarray(offset + 8, offset + 8 + length),
      crc: data.readUInt32BE(offset + 8 + length),
      checked: data.subarray(offset + 4, offset + 8 + length),
    })
    offset += length + 12
  }
  return result
}

test('PNG resolution replaces canvas metadata with a valid physical-resolution chunk', async () => {
  const original = new Blob(
    [
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOzwAAAAASUVORK5CYII=',
        'base64'
      ),
    ],
    { type: 'image/png' }
  )
  const first = await pngWithDpi(original, 300)
  const final = await pngWithDpi(first, 600)
  const parsed = chunks(new Uint8Array(await final.arrayBuffer()))
  const physical = parsed.filter((chunk) => chunk.type === 'pHYs')
  assert.equal(physical.length, 1)
  assert.equal(physical[0].data.readUInt32BE(0), 23622)
  assert.equal(physical[0].data.readUInt32BE(4), 23622)
  assert.equal(physical[0].data[8], 1)
  assert.equal(physical[0].crc, crc32(physical[0].checked))
  assert.deepEqual(
    parsed.map((chunk) => chunk.type),
    ['IHDR', 'pHYs', 'IDAT', 'IEND']
  )
  await assert.rejects(pngWithDpi(new Blob(['not PNG']), 300), /PNG/)
})

test('barcode geometry leaves integer modules and quiet zones without squeezing long codes', () => {
  for (const code of ['CE26100001', 'CE26100001ABXL']) {
    const geometry = barcodeGeometry(code, 472, 300)
    assert.ok(Number.isInteger(geometry.moduleWidth))
    assert.ok(geometry.moduleWidth >= 2)
    assert.ok(geometry.x >= geometry.quietZone)
    assert.ok(
      472 - geometry.x - geometry.bits.length * geometry.moduleWidth >=
        geometry.quietZone
    )
  }
  assert.throws(
    () => barcodeGeometry(`CE26100001${'A'.repeat(40)}`, 472, 300),
    /too long/
  )
  assert.throws(
    () => normalizeLabelSettings({ barcode: { textScale: 2 } }),
    /Text scale/
  )
  assert.throws(() => normalizeLabelSettings({ dpi: 100 }), /Resolution/)
})

test('final PNGs decode with an independent Code 128 reader at default and adjusted print sizes', async (t) => {
  const page = await pageFor(t)
  for (const item of [
    {
      code: 'CE26100001',
      spanishName: 'alfombra',
      settings: {},
      expected: [472, 236],
    },
    {
      code: 'CE26100001ABXL',
      spanishName: 'CAJA ORGANIZADORA',
      settings: {},
      expected: [472, 236],
    },
    {
      code: 'CE26100001AZM',
      spanishName: 'TAZA DE CERÁMICA',
      settings: {
        dpi: 600,
        barcode: { widthMm: 50, heightMm: 25, textScale: 1.25 },
      },
      expected: [1181, 591],
    },
  ]) {
    const result = await page.evaluate(
      async (input) => {
        const label = await Labels.renderLabel({ kind: 'barcode', ...input })
        const bitmap = await createImageBitmap(label.blob)
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d')
        context.drawImage(bitmap, 0, 0)
        const rgba = context.getImageData(
          0,
          0,
          bitmap.width,
          bitmap.height
        ).data
        const luminance = Array.from(
          { length: bitmap.width * bitmap.height },
          (_, index) => rgba[index * 4]
        )
        bitmap.close()
        return {
          width: label.width,
          height: label.height,
          bytes: Array.from(new Uint8Array(await label.blob.arrayBuffer())),
          luminance,
        }
      },
      { ...item, logoUrl: logoDataUrl }
    )
    assert.deepEqual([result.width, result.height], item.expected)
    const physical = chunks(result.bytes).find((chunk) => chunk.type === 'pHYs')
    assert.equal(
      physical.data.readUInt32BE(0),
      Math.round((item.settings.dpi || 300) / 0.0254)
    )
    const source = new RGBLuminanceSource(
      Uint8ClampedArray.from(result.luminance),
      result.width,
      result.height
    )
    const decoded = new Code128Reader().decode(
      new BinaryBitmap(new HybridBinarizer(source)),
      new Map([[DecodeHintType.TRY_HARDER, true]])
    )
    assert.equal(decoded.getText(), item.code)
  }
})

test('barcode logo artwork fills a larger bounded region without entering bars or text', async (t) => {
  const page = await pageFor(t)
  const result = await page.evaluate(async (logoUrl) => {
    const draws = []
    const original = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...values) {
      if (this.canvas.width === 472 && this.canvas.height === 236)
        draws.push({
          values,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        })
      return original.call(this, image, ...values)
    }
    try {
      const label = await Labels.renderLabel({
        kind: 'barcode',
        code: 'CE26100001',
        spanishName: 'ALFOMBRA',
        logoUrl,
      })
      return { width: label.width, height: label.height, draws }
    } finally {
      CanvasRenderingContext2D.prototype.drawImage = original
    }
  }, logoDataUrl)
  assert.equal(result.draws.length, 1)
  const drawing = result.draws[0]
  const [sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height] =
    drawing.values
  assert.ok(sourceX > 0 && sourceY > 0)
  assert.ok(sourceWidth < drawing.naturalWidth)
  assert.ok(sourceHeight < drawing.naturalHeight)
  const oldWidth =
    drawing.naturalWidth *
    Math.min(
      (result.width * 0.315) / drawing.naturalWidth,
      (result.height * 0.255) / drawing.naturalHeight
    )
  assert.ok(width > oldWidth * 1.2)
  assert.ok(x >= result.width * 0.03)
  assert.ok(y >= result.height * 0.65)
  assert.ok(x + width < result.width * 0.39)
  assert.ok(y + height <= result.height * 0.96 + 0.01)
  assert.ok(Math.abs(width / height - sourceWidth / sourceHeight) < 0.001)
})

test('logo cropping retains pale edges and internal white spaces on transparent and white backgrounds', async (t) => {
  const page = await pageFor(t)
  const result = await page.evaluate(async () => {
    const makeLogo = (background) => {
      const canvas = document.createElement('canvas')
      canvas.width = 200
      canvas.height = 100
      const context = canvas.getContext('2d')
      if (background) {
        context.fillStyle = '#fff'
        context.fillRect(0, 0, 200, 100)
      }
      context.fillStyle = '#000'
      context.fillRect(60, 35, 80, 30)
      context.fillStyle = '#fff'
      context.fillRect(70, 40, 50, 20)
      context.fillStyle = '#f0f0f0'
      context.fillRect(30, 25, 1, 1)
      context.fillRect(169, 74, 1, 1)
      return canvas.toDataURL()
    }
    const renderer = Labels.createLabelRenderer({ maxBytes: 0 })
    const originalDraw = CanvasRenderingContext2D.prototype.drawImage
    const originalRead = CanvasRenderingContext2D.prototype.getImageData
    const crops = []
    const scratch = []
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...values) {
      if (this.canvas.width === 472 && this.canvas.height === 236)
        crops.push(values.slice(0, 4))
      return originalDraw.call(this, image, ...values)
    }
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      scratch.push(this.canvas)
      if (this.canvas.width > 512 || this.canvas.height > 512)
        throw new Error('Logo inspection exceeded its tile budget')
      return originalRead.call(this, ...args)
    }
    try {
      const transparent = makeLogo(false)
      const white = makeLogo(true)
      const reads = []
      for (const logoUrl of [transparent, transparent, white, transparent]) {
        await renderer.render({
          kind: 'barcode',
          code: 'CE26100001',
          spanishName: 'TAZA',
          logoUrl,
        })
        reads.push(scratch.length)
      }
      return {
        crops,
        reads,
        scratchReleased: scratch.every(
          (canvas) => canvas.width === 0 && canvas.height === 0
        ),
      }
    } finally {
      renderer.dispose()
      CanvasRenderingContext2D.prototype.drawImage = originalDraw
      CanvasRenderingContext2D.prototype.getImageData = originalRead
    }
  })
  assert.deepEqual(
    result.crops,
    Array.from({ length: 4 }, () => [28, 23, 144, 54])
  )
  assert.deepEqual(result.reads, [1, 1, 2, 3])
  assert.equal(result.scratchReleased, true)
})

test('barcode code bands hug the fitted text with small balanced padding', async (t) => {
  const page = await pageFor(t)
  const bands = []
  for (const input of [
    { code: 'CE26100001', settings: {} },
    { code: 'CE26100001ABXL', settings: {} },
    {
      code: 'CE26100001AZM',
      settings: {
        dpi: 600,
        barcode: { widthMm: 50, heightMm: 25, textScale: 1.25 },
      },
    },
  ]) {
    const result = await page.evaluate(async (input) => {
      const rectangles = []
      let codeText
      const prototype = CanvasRenderingContext2D.prototype
      const fillRect = prototype.fillRect
      const fillText = prototype.fillText
      prototype.fillRect = function (x, y, width, height) {
        rectangles.push({ x, y, width, height, color: this.fillStyle })
        return fillRect.call(this, x, y, width, height)
      }
      prototype.fillText = function (text, x, y, ...rest) {
        if (text === input.code)
          codeText = {
            x,
            y,
            width: this.measureText(text).width,
            color: this.fillStyle,
          }
        return fillText.call(this, text, x, y, ...rest)
      }
      try {
        const label = await Labels.renderLabel({
          kind: 'barcode',
          spanishName: 'TAZA',
          ...input,
        })
        return {
          width: label.width,
          height: label.height,
          rectangles,
          codeText,
        }
      } finally {
        prototype.fillRect = fillRect
        prototype.fillText = fillText
      }
    }, input)
    const backgrounds = result.rectangles.filter(
      (rectangle) =>
        rectangle.color === '#000000' && rectangle.width > result.width * 0.1
    )
    assert.equal(backgrounds.length, 1)
    const band = backgrounds[0]
    const padding = (band.width - result.codeText.width) / 2
    assert.ok(padding >= result.width * 0.01)
    assert.ok(padding <= result.width * 0.015)
    assert.ok(Math.abs(band.x + band.width / 2 - result.codeText.x) < 1)
    assert.ok(result.codeText.y > band.y)
    assert.ok(result.codeText.y < band.y + band.height)
    assert.equal(result.codeText.color, '#ffffff')
    assert.ok(band.y >= result.height * 0.49)
    assert.ok(band.height < result.height * 0.2)
    bands.push(band)
  }
  assert.ok(bands[0].width < 472 * 0.45)
  assert.ok(bands[1].width > bands[0].width)
})

test('shipping marks export one landscape image with blank operational fields', async (t) => {
  const page = await pageFor(t)
  const result = await page.evaluate(async () => {
    const calls = [],
      lines = []
    const original = CanvasRenderingContext2D.prototype.fillText
    const originalMove = CanvasRenderingContext2D.prototype.moveTo
    const originalLine = CanvasRenderingContext2D.prototype.lineTo
    let lineStart
    CanvasRenderingContext2D.prototype.moveTo = function (x, y) {
      lineStart = { x, y }
      return originalMove.call(this, x, y)
    }
    CanvasRenderingContext2D.prototype.lineTo = function (x, y) {
      lines.push({ start: lineStart, end: { x, y } })
      return originalLine.call(this, x, y)
    }
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      const measured = this.measureText(text)
      calls.push({
        text,
        size: Number(this.font.match(/([\d.]+)px/)[1]),
        x: args[0],
        y: args[1],
        left: args[0] - measured.actualBoundingBoxLeft,
        right: args[0] + measured.actualBoundingBoxRight,
        top: args[1] - measured.actualBoundingBoxAscent,
        bottom: args[1] + measured.actualBoundingBoxDescent,
      })
      return original.call(this, text, ...args)
    }
    try {
      const label = await Labels.renderLabel({
        kind: 'mark',
        code: 'CE26100002',
        category: '工艺品',
      })
      return {
        width: label.width,
        height: label.height,
        type: label.blob.type,
        bytes: Array.from(new Uint8Array(await label.blob.arrayBuffer())),
        fields: Labels.LABEL_FIELDS.mark,
        calls,
        lines,
      }
    } finally {
      CanvasRenderingContext2D.prototype.fillText = original
      CanvasRenderingContext2D.prototype.moveTo = originalMove
      CanvasRenderingContext2D.prototype.lineTo = originalLine
    }
  })
  assert.deepEqual([result.width, result.height], [1754, 1240])
  assert.equal(result.type, 'image/png')
  assert.deepEqual(
    result.calls.map((call) => call.text),
    ['CE', 'CE26100002', '数量：', '重量：', 'KG', '体积：', 'CBM', '工艺品']
  )
  const physical = chunks(result.bytes).find((chunk) => chunk.type === 'pHYs')
  assert.equal(physical.data.readUInt32BE(0), Math.round(300 / 0.0254))
  const ce = result.calls.find((call) => call.text === 'CE')
  const code = result.calls.find((call) => call.text === 'CE26100002')
  const category = result.calls.find((call) => call.text === '工艺品')
  assert.ok(ce.size >= result.height * 0.68)
  assert.ok(ce.bottom - ce.top >= result.height * 0.49)
  assert.ok(code.size >= result.height * 0.19)
  assert.ok(code.right - code.left >= result.width * 0.79)
  assert.ok(category.size >= result.height * 0.19)
  assert.ok(ce.bottom < code.top)
  assert.ok(code.top - ce.bottom < result.height * 0.06)
  assert.ok(code.bottom < category.top)
  assert.ok(ce.top >= result.height * 0.01)
  assert.ok(ce.left >= result.width * 0.03)
  assert.ok(ce.right <= result.width * 0.97)
  for (const [key, text] of [
    ['code', code],
    ['category', category],
  ]) {
    const [x, y, width, height] = result.fields[key]
    assert.ok(text.left >= x * result.width)
    assert.ok(text.right <= (x + width) * result.width)
    assert.ok(text.top >= y * result.height)
    assert.ok(text.bottom <= (y + height) * result.height)
  }
  const blanks = result.calls.filter((call) =>
    ['数量：', '重量：', '体积：'].includes(call.text)
  )
  assert.ok(blanks.every((call) => call.size < result.height * 0.045))
  assert.ok(blanks[0].top > code.bottom)
  assert.ok(blanks.at(-1).bottom - blanks[0].top < result.height * 0.2)
  assert.equal(result.lines.length, 3)
  for (let index = 0; index < result.lines.length; index++) {
    const line = result.lines[index]
    assert.ok(line.start.x > blanks[index].right)
    assert.equal(line.start.y, line.end.y)
    assert.ok(line.end.x < category.left)
    assert.ok(line.end.y < result.height * 0.97)
    assert.ok(((line.end.x - line.start.x) / result.width) * 148.5 >= 27)
  }
})

test('carton mark layout keeps enlarged identifiers and writable fields within adjusted print sizes', async (t) => {
  const page = await pageFor(t)
  for (const settings of [
    { dpi: 150, mark: { widthMm: 148.5, heightMm: 105, textScale: 0.75 } },
    { dpi: 300, mark: { widthMm: 200, heightMm: 140, textScale: 1.25 } },
    { dpi: 600, mark: { widthMm: 148.5, heightMm: 105, textScale: 1.25 } },
  ]) {
    const result = await page.evaluate(async (settings) => {
      const calls = []
      const original = CanvasRenderingContext2D.prototype.fillText
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y) {
        const bounds = this.measureText(text)
        calls.push({
          text,
          left: x - bounds.actualBoundingBoxLeft,
          right: x + bounds.actualBoundingBoxRight,
          top: y - bounds.actualBoundingBoxAscent,
          bottom: y + bounds.actualBoundingBoxDescent,
        })
        return original.call(this, text, x, y)
      }
      try {
        const label = await Labels.renderLabel({
          kind: 'mark',
          code: 'CE26100003',
          category: '玻璃制品',
          settings,
        })
        return {
          width: label.width,
          height: label.height,
          fields: Labels.LABEL_FIELDS.mark,
          calls,
        }
      } finally {
        CanvasRenderingContext2D.prototype.fillText = original
      }
    }, settings)
    assert.equal(
      result.width,
      Math.round((settings.mark.widthMm * settings.dpi) / 25.4)
    )
    assert.equal(
      result.height,
      Math.round((settings.mark.heightMm * settings.dpi) / 25.4)
    )
    for (const text of result.calls) {
      assert.ok(text.left >= 0, text.text)
      assert.ok(text.top >= 0, text.text)
      assert.ok(text.right <= result.width, text.text)
      assert.ok(text.bottom <= result.height, text.text)
    }
    const ce = result.calls.find((call) => call.text === 'CE')
    const code = result.calls.find((call) => call.text === 'CE26100003')
    assert.ok(ce.bottom < code.top)
    const [x, y, width, height] = result.fields.code
    assert.ok(code.left >= x * result.width)
    assert.ok(code.right <= (x + width) * result.width)
    assert.ok(code.top >= y * result.height)
    assert.ok(code.bottom <= (y + height) * result.height)
    for (const text of result.calls.filter(
      (call) => !['CE', 'CE26100003'].includes(call.text)
    ))
      assert.ok(text.top > code.bottom)
  }
})

test('label text still wraps within its region or rejects overflow without clipping', async (t) => {
  const page = await pageFor(t)
  const result = await page.evaluate(async () => {
    const requests = [
      { kind: 'mark', code: 'CE26100001', category: '工艺品'.repeat(4) },
      { kind: 'mark', code: 'CE26100001', category: '工艺品'.repeat(10) },
      { kind: 'barcode', code: 'CE26100001', spanishName: 'W'.repeat(80) },
    ]
    const results = []
    for (const request of requests) {
      try {
        await Labels.renderLabel(request)
        results.push('rendered')
      } catch (error) {
        results.push(error.message)
      }
    }
    return results
  })
  assert.equal(result[0], 'rendered')
  assert.match(result[1], /Text does not fit/)
  assert.match(result[2], /Text does not fit/)
})

test('oversized label dimensions are rejected before allocating any canvas', async (t) => {
  const page = await pageFor(t)
  const results = await page.evaluate(async () => {
    const createElement = document.createElement
    let canvases = 0
    document.createElement = function (tag, ...args) {
      if (tag === 'canvas') canvases++
      return createElement.call(this, tag, ...args)
    }
    try {
      const results = []
      for (const kind of ['barcode', 'mark']) {
        try {
          await Labels.renderLabel({
            kind,
            code: 'CE26100001',
            spanishName: 'TAZA',
            category: '玻璃',
            settings: { dpi: 600, [kind]: { widthMm: 300, heightMm: 300 } },
          })
          results.push({ kind, error: '', canvases })
        } catch (error) {
          results.push({ kind, error: error.message, canvases })
        }
      }
      return results
    } finally {
      document.createElement = createElement
    }
  })
  for (const result of results) {
    assert.match(result.error, /too large.*dimensions or resolution/)
    assert.equal(result.canvases, 0)
  }
})

test('render queue limits concurrency, cancels queued work and evicts least-recently-used images', async () => {
  const releases = []
  let running = 0,
    peak = 0
  const renderer = createLabelRenderer({
    maxBytes: 810,
    render: async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => releases.push(resolve))
      running--
      return { blob: new Blob(['x']), width: 10, height: 10 }
    },
  })
  const request = (suffix, signal) => ({
    kind: 'barcode',
    code: `CE2610000${suffix}`,
    spanishName: 'TAZA',
    signal,
  })
  const first = renderer.render(request(1))
  const second = renderer.render(request(2))
  const controller = new AbortController()
  const third = renderer.render(request(3, controller.signal))
  const cancelled = assert.rejects(third, { name: 'AbortError' })
  controller.abort()
  await cancelled
  assert.equal(renderer.stats().queued, 0)
  releases.shift()()
  releases.shift()()
  await Promise.all([first, second])
  assert.equal(peak, 2)
  assert.equal(renderer.stats().entries, 2)
  await renderer.render(request(1))
  const fourth = renderer.render(request(4))
  releases.shift()()
  await fourth
  assert.equal(renderer.stats().entries, 2)
  assert.ok(renderer.stats().bytes <= 810)
  const secondAgain = renderer.render(request(2))
  assert.equal(renderer.stats().active, 1)
  releases.shift()()
  await secondAgain
  renderer.dispose()
  assert.equal(renderer.stats().bytes, 0)
})

test('editor previews text, Escape restores it, and allocator-returned codes determine copied PNGs', async (t) => {
  const page = await pageFor(t, true)
  await page.evaluate(() => {
    globalThis.commits = []
    globalThis.copies = []
    globalThis.editor = LabelEditor.mountLabelEditor(
      document.getElementById('editor'),
      {
        model: { kind: 'barcode', code: 'CE26100001', spanishName: 'TAZA' },
        onCommit: async (next) => {
          commits.push(next)
          await new Promise((resolve) => setTimeout(resolve, 30))
          return { ...next, code: 'CE26100002' }
        },
        onCopy: async (result, model) => {
          copies.push({ code: model.code, type: result.blob.type })
        },
      }
    )
  })
  await page.waitForFunction(
    () => !document.querySelector('.label-editor-copy').disabled
  )
  const name = page.getByRole('textbox', {
    name: 'Spanish product name',
    exact: true,
  })
  await name.fill('ALFOMBRA')
  await page.waitForFunction(
    () => editor.getLatestValidRender()?.model.spanishName === 'ALFOMBRA'
  )
  await name.press('Escape')
  assert.equal(await name.inputValue(), 'TAZA')
  assert.equal(await page.evaluate(() => commits.length), 0)
  await name.fill('caja azul')
  await name.press('Enter')
  await page.waitForFunction(
    () =>
      editor.getLatestValidRender()?.model.code === 'CE26100002' &&
      !document.querySelector('.label-editor-copy').disabled
  )
  assert.equal(await name.inputValue(), 'CAJA AZUL')
  await page.getByRole('button', { name: 'Copy label', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('.label-editor-status').textContent === 'Copied'
  )
  assert.deepEqual(await page.evaluate(() => copies), [
    { code: 'CE26100002', type: 'image/png' },
  ])
  assert.equal(await page.evaluate(() => commits.length), 1)
  const copy = page.locator('.label-editor-copy')
  assert.equal(await copy.textContent(), 'Copied')
  assert.equal(
    await copy.evaluate((button) => button.classList.contains('copied')),
    true
  )
  assert.equal(
    await copy.evaluate((button) => getComputedStyle(button).backgroundColor),
    'rgb(233, 241, 229)'
  )
  await name.fill('unsaved change')
  assert.equal(await copy.textContent(), 'Copy label')
  assert.equal(
    await copy.evaluate((button) => button.classList.contains('copied')),
    false
  )
  await name.press('Escape')
  await page.waitForFunction(
    () => !document.querySelector('.label-editor-copy').disabled
  )
  await copy.click()
  await page.waitForFunction(
    () => document.querySelector('.label-editor-copy').textContent === 'Copied'
  )
  await page.waitForFunction(
    () =>
      document.querySelector('.label-editor-copy').textContent === 'Copy label'
  )
  assert.equal(
    await copy.evaluate((button) => button.classList.contains('copied')),
    false
  )
})

test('clicking Copy directly from a focused draft saves and copies its latest PNG', async (t) => {
  const page = await pageFor(t, true)
  await page.evaluate(() => {
    globalThis.commits = []
    globalThis.copies = []
    globalThis.editor = LabelEditor.mountLabelEditor(
      document.getElementById('editor'),
      {
        model: { kind: 'barcode', code: 'CE26100001', spanishName: 'TAZA' },
        onCommit: async (next) => {
          commits.push(next)
          await new Promise((resolve) => setTimeout(resolve, 30))
          return { ...next, code: 'CE26100002' }
        },
        onCopy: async (result, model) => {
          copies.push({
            model,
            bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())),
          })
        },
      }
    )
  })
  const name = page.getByRole('textbox', {
    name: 'Spanish product name',
    exact: true,
  })
  await name.fill('jarra azul')
  assert.equal(
    await name.evaluate((input) => document.activeElement === input),
    true
  )
  // A real pointer gesture, with no Enter or explicit blur beforehand.
  await page.getByRole('button', { name: 'Copy label', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('.label-editor-copy').textContent === 'Copied'
  )
  const actual = await page.evaluate(() => ({ commits, copies }))
  assert.equal(actual.commits.length, 1)
  assert.equal(actual.copies.length, 1)
  assert.equal(actual.copies[0].model.spanishName, 'JARRA AZUL')
  assert.equal(actual.copies[0].model.code, 'CE26100002')
  const expected = await page.evaluate(async () => {
    const result = await Labels.renderLabel({
      kind: 'barcode',
      code: 'CE26100002',
      spanishName: 'JARRA AZUL',
    })
    return Array.from(new Uint8Array(await result.blob.arrayBuffer()))
  })
  assert.deepEqual(actual.copies[0].bytes, expected)
})

test('slow repeated mark rendering shows pending work until the current image is ready', async (t) => {
  const page = await pageFor(t, true)
  await page.evaluate(() => {
    globalThis.commits = []
    globalThis.editor = LabelEditor.mountLabelEditor(
      document.getElementById('editor'),
      {
        model: { kind: 'mark', code: 'CE26100001', category: '玻璃' },
        onCommit: async (next) => {
          commits.push(next)
          return next
        },
      }
    )
  })
  await page.waitForFunction(
    () => !document.querySelector('.label-editor-copy').disabled
  )
  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      toBlob.call(
        this,
        (blob) => {
          globalThis.finishRendering = () => {
            globalThis.finishRendering = null
            callback(blob)
          }
        },
        ...args
      )
    }
  })
  for (const [name, value] of [
    ['Chinese category', '玻璃制品'],
    ['Base CE code', 'CE26100002'],
  ]) {
    const field = page.getByRole('textbox', { name, exact: true })
    await field.fill(value)
    assert.match(
      await page.locator('.label-editor-status').textContent(),
      /(?:Updating preview|Preparing label).*Unsaved text/
    )
    await field.press('Enter')
    await page.waitForFunction(() => typeof finishRendering === 'function')
    assert.equal(await page.locator('.label-editor-copy').isDisabled(), true)
    assert.match(
      await page.locator('.label-editor-status').textContent(),
      /Preparing label.*Unsaved text/
    )
    await page.evaluate(() => finishRendering())
    await page.waitForFunction(
      () => !document.querySelector('.label-editor-copy').disabled
    )
    assert.equal(
      await page.locator('.label-editor-status').textContent(),
      '148.5 × 105 mm · 300 dpi'
    )
  }
  assert.equal(await page.evaluate(() => commits.length), 2)
  assert.equal(
    await page.evaluate(() => editor.getLatestValidRender().model.code),
    'CE26100002'
  )
  assert.equal(
    await page.evaluate(() => editor.getLatestValidRender().model.category),
    '玻璃制品'
  )
})

test('Escape during an in-flight label save restores rejected drafts and preserves accepted saves', async (t) => {
  for (const rejectSave of [true, false]) {
    const page = await pageFor(t, true)
    await page.evaluate((rejectSave) => {
      const dialog = document.createElement('dialog')
      dialog.append(document.getElementById('editor'))
      document.body.append(dialog)
      dialog.showModal()
      globalThis.attempts = 0
      globalThis.editor = LabelEditor.mountLabelEditor(
        document.getElementById('editor'),
        {
          model: {
            kind: 'barcode',
            code: 'CE26100101S',
            spanishName: 'TAZA',
          },
          onCommit: (next) => {
            attempts++
            return new Promise((resolve, reject) => {
              globalThis.finishCommit = () => {
                if (rejectSave) reject(new Error('Code is already assigned'))
                else resolve(next)
              }
            })
          },
        }
      )
    }, rejectSave)
    await page.waitForFunction(
      () => !document.querySelector('.label-editor-copy').disabled
    )
    const code = page.getByRole('textbox', {
      name: 'Barcode code',
      exact: true,
    })
    await code.fill('CE26100101L')
    await code.press('Enter')
    await page.waitForFunction(() => typeof finishCommit === 'function')
    // Use the keyboard's actual focus, as a person does while the save is pending.
    await page.keyboard.press('Escape')
    await page.evaluate(() => finishCommit())
    await page.waitForFunction(() => {
      const input = document.querySelector('.label-editor-code')
      return !input.disabled && !input.readOnly
    })
    assert.equal(
      await code.inputValue(),
      rejectSave ? 'CE26100101S' : 'CE26100101L'
    )
    await page.waitForFunction(
      () => !document.querySelector('.label-editor-copy').disabled
    )
    assert.equal(await page.evaluate(() => attempts), 1)
    assert.equal(
      await page.evaluate(() => document.querySelector('dialog').open),
      true
    )
    assert.equal(
      await page.evaluate(() => editor.getLatestValidRender().model.code),
      rejectSave ? 'CE26100101S' : 'CE26100101L'
    )
  }
})

test('editor reports save and copy failures without reporting success or copying stale drafts', async (t) => {
  const page = await pageFor(t, true)
  await page.evaluate(() => {
    globalThis.copies = 0
    globalThis.editor = LabelEditor.mountLabelEditor(
      document.getElementById('editor'),
      {
        model: { kind: 'barcode', code: 'CE26100001', spanishName: 'TAZA' },
        onCommit: async () => {
          throw new Error('Code is already assigned')
        },
        onCopy: async () => {
          copies++
          throw new Error('Clipboard unavailable')
        },
      }
    )
  })
  await page.waitForFunction(
    () => !document.querySelector('.label-editor-copy').disabled
  )
  await page.getByRole('button', { name: 'Copy label', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('.error-notice-message')?.textContent ===
      'Clipboard unavailable'
  )
  assert.equal(
    await page.locator('.label-editor-copy').textContent(),
    'Copy label'
  )
  assert.equal(
    await page
      .locator('.label-editor-copy')
      .evaluate((button) => button.classList.contains('copied')),
    false
  )
  const code = page.getByRole('textbox', { name: 'Barcode code', exact: true })
  await code.fill('CE26100002')
  await page.getByRole('button', { name: 'Copy label', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('.error-notice-message')?.textContent ===
      'Code is already assigned'
  )
  assert.equal(
    await page
      .getByRole('button', { name: 'Copy label', exact: true })
      .isDisabled(),
    true
  )
  assert.equal(await page.evaluate(() => copies), 1)
  assert.equal(
    await page
      .locator('.label-editor-status')
      .evaluate((status) => status.classList.contains('label-editor-error')),
    true
  )
  assert.equal(await code.inputValue(), 'CE26100002')
  await code.press('Escape')
  await page.waitForFunction(
    () => !document.querySelector('.label-editor-copy').disabled
  )
  assert.equal(await code.inputValue(), 'CE26100001')
  assert.equal(
    await page.evaluate(() => editor.getLatestValidRender().model.code),
    'CE26100001'
  )
  await code.fill('bad code')
  await code.press('Enter')
  assert.match(
    await page.locator('.error-notice-message').textContent(),
    /Enter a CE code/
  )
  assert.equal(await page.evaluate(() => copies), 1)
})
