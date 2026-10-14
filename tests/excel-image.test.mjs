import test from 'node:test'
import assert from 'node:assert/strict'
import {
  excelImageColumns,
  planExcelImage,
  renderExcelImage,
} from '../src/excel-image.js'

const png = new Blob(
  [
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOzwAAAAASUVORK5CYII=',
      'base64'
    ),
  ],
  { type: 'image/png' }
)
const row = {
  orderId: 'order-1',
  groupId: 'group-1',
  thumbnail: 'synthetic-photo-1',
  description: 'Glass jar\n透明玻璃罐',
  baseCode: 'CE26100101',
  barcode: 'CE26100101AS',
  spanishName: 'FRASCO DE VIDRIO',
  chineseCategory: '玻璃',
  price: '3.00',
  quantity: '20',
  discount: '0.20',
}

const measure = (value) =>
  [...value].reduce(
    (width, char) => width + (/[^\u0000-\u00ff]/.test(char) ? 14 : 7),
    0
  )

// Deterministic metrics isolate batching, data preservation and resource lifetime.
// The browser acceptance suite checks the actual canvas raster and font output.
async function withCanvas(work, { bitmapHeight = 152 } = {}) {
  const previousDocument = globalThis.document
  const previousBitmap = globalThis.createImageBitmap
  const state = {
    canvases: [],
    bitmaps: [],
    text: [],
    draws: [],
    peakLiveBytes: 0,
  }
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas')
      const context = {
        measureText: (text) => ({ width: measure(text) }),
        fillText: (text, x, y) => state.text.push({ text, x, y }),
        drawImage: (...args) => state.draws.push(args),
        scale() {},
        fillRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        strokeRect() {},
      }
      const canvas = {
        width: 300,
        height: 150,
        getContext: () => context,
        toBlob: (callback) => callback(png),
      }
      state.canvases.push(canvas)
      return canvas
    },
  }
  globalThis.createImageBitmap = async (_, options) => {
    assert.equal(options.resizeWidth, 152)
    const bitmap = {
      width: 152,
      height: bitmapHeight,
      closed: false,
      close() {
        this.closed = true
      },
    }
    state.bitmaps.push(bitmap)
    state.peakLiveBytes = Math.max(
      state.peakLiveBytes,
      state.bitmaps
        .filter((entry) => !entry.closed)
        .reduce((bytes, entry) => bytes + entry.width * entry.height * 4, 0)
    )
    return bitmap
  }
  try {
    return await work(state)
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
    if (previousBitmap === undefined) delete globalThis.createImageBitmap
    else globalThis.createImageBitmap = previousBitmap
  }
}

const cell = (entry, key) =>
  entry.cells[excelImageColumns.findIndex((column) => column.key === key)]

test('Excel image keeps Chinese headers, saved values and one base code per group', async () =>
  withCanvas(({ canvases }) => {
    assert.deepEqual(
      excelImageColumns.map((column) => column.label),
      [
        '序号',
        '图片',
        '产品描述',
        '产品编码',
        '条码编号',
        '西班牙语品名',
        '中文品类',
        '单价（元）',
        '数量',
        '优惠（元）',
      ]
    )
    const input = [
      { ...row },
      { ...row, barcode: 'CE26100101AL' },
      { ...row, orderId: 'order-2' },
    ]
    const [plan] = planExcelImage(input)
    assert.equal(plan.rowCount, 3)
    assert.equal(plan.start, 0)
    assert.equal(plan.end, 3)
    assert.equal(plan.width, plan.cssWidth * 2)
    assert.equal(plan.height, plan.cssHeight * 2)
    assert.deepEqual(
      plan.rows.map((entry) => cell(entry, 'baseCode').text),
      ['CE26100101', '', 'CE26100101']
    )
    assert.deepEqual(
      plan.rows.map((entry) => entry.separator),
      ['none', 'row', 'order']
    )
    assert.equal(cell(plan.rows[0], 'price').text, '3.00')
    assert.equal(cell(plan.rows[0], 'discount').text, '0.20')
    assert.equal(cell(plan.rows[0], 'description').text, row.description)
    assert.equal(cell(plan.rows[1], 'barcode').text, 'CE26100101AL')
    assert.equal(cell(plan.rows[0], 'chineseCategory').text, '玻璃')
    input[0].spanishName = 'CHANGED AFTER CONFIRMATION'
    assert.equal(plan.rows[0].source.spanishName, 'FRASCO DE VIDRIO')
    assert.equal(Object.isFrozen(plan.rows[0].source), true)
    assert.equal(Object.isFrozen(plan.rows), true)
    assert.equal(canvases[0].width, 0)
    assert.equal(canvases[0].height, 0)
  }))

test('Excel image batching retains every row at fixed resolution and repeats its group code at the batch start', async () =>
  withCanvas(() => {
    const rows = Array.from({ length: 150 }, (_, index) => ({
      ...row,
      barcode: `${row.baseCode}${index}`,
      quantity: String(index + 1),
    }))
    const plans = planExcelImage(rows)
    assert.ok(plans.length > 1)
    let end = 0
    for (const plan of plans) {
      assert.equal(plan.start, end)
      assert.equal(plan.end - plan.start, plan.rowCount)
      assert.ok(plan.width <= 8192 && plan.height <= 8192)
      assert.ok(plan.width * plan.height <= 16_000_000)
      assert.equal(plan.width / plan.cssWidth, 2)
      assert.equal(cell(plan.rows[0], 'baseCode').text, row.baseCode)
      assert.ok(
        plan.rows.slice(1).every((entry) => cell(entry, 'baseCode').text === '')
      )
      end = plan.end
    }
    assert.equal(end, rows.length)
    assert.deepEqual(
      plans.flatMap((plan) => plan.rows.map((entry) => entry.source.number)),
      rows.map((_, index) => String(index + 1))
    )
    assert.deepEqual(
      plans.flatMap((plan) => plan.rows.map((entry) => entry.source.barcode)),
      rows.map((entry) => entry.barcode)
    )
  }))

test('CJK descriptions and long barcode values wrap fully without exceeding their cells', async () =>
  withCanvas(() => {
    const description =
      '玻璃罐不同颜色和尺寸'.repeat(12) + '\nA normal word sequence'
    const barcode = 'CE26100101' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(4)
    const [plan] = planExcelImage([{ ...row, description, barcode }])
    const entry = plan.rows[0]
    for (const [index, value] of entry.cells.entries()) {
      assert.ok(
        value.lines.every(
          (line) => measure(line) <= excelImageColumns[index].width - 16
        )
      )
      assert.ok(value.lines.length * 20 + 16 <= entry.height)
    }
    assert.equal(cell(entry, 'barcode').lines.join(''), barcode)
    assert.equal(
      cell(entry, 'description').lines.join('').replaceAll(' ', ''),
      description.replace(/\s/g, '')
    )
    assert.throws(
      () => planExcelImage([{ ...row, description: '玻'.repeat(6000) }]),
      /row 1 is too tall/
    )
  }))

test('Empty selections and missing photos fail before producing a partial image', async () =>
  withCanvas(() => {
    assert.throws(() => planExcelImage([]), /Select product rows/)
    assert.throws(
      () => planExcelImage([row, { ...row, thumbnail: '' }]),
      /row 2 has no photo/
    )
  }))

test('Excel image reuses photos, reports real row completion and releases resources', async () =>
  withCanvas(async (state) => {
    const [plan] = planExcelImage([
      row,
      { ...row, barcode: 'CE26100101AL' },
      row,
    ])
    let loads = 0
    const progress = []
    const result = await renderExcelImage(plan, {
      loadImage: async () => {
        loads++
        return png
      },
      onProgress: (value) => progress.push(value),
    })
    assert.equal(loads, 1)
    assert.equal(state.draws.length, 3)
    assert.deepEqual(
      progress.map((value) => value.completed),
      [0, 1, 2, 3]
    )
    assert.ok(progress.every((value) => value.total === 3))
    assert.ok(state.text.some((value) => value.text === '3.00'))
    assert.ok(state.text.some((value) => value.text === '0.20'))
    assert.equal(result.width, plan.width)
    assert.equal(result.height, plan.height)
    assert.equal(result.blob.type, 'image/png')
    const bytes = Buffer.from(await result.blob.arrayBuffer())
    const physical = bytes.indexOf('pHYs')
    assert.ok(physical > 0)
    assert.equal(bytes.readUInt32BE(physical + 4), Math.round(192 / 0.0254))
    assert.equal(bytes.readUInt32BE(physical + 8), Math.round(192 / 0.0254))
    assert.ok(state.bitmaps.every((bitmap) => bitmap.closed))
    assert.ok(
      state.canvases.every(
        (canvas) => canvas.width === 0 && canvas.height === 0
      )
    )
  }))

test('Photo cache evicts before exceeding its bounded retained memory', async () =>
  withCanvas(
    async (state) => {
      const rows = Array.from({ length: 30 }, (_, index) => ({
        ...row,
        thumbnail: `photo-${index}`,
      }))
      rows.push({ ...row, thumbnail: 'photo-0' })
      const [plan] = planExcelImage(rows)
      assert.equal(plan.rowCount, 31)
      let loads = 0
      await renderExcelImage(plan, {
        loadImage: async () => {
          loads++
          return png
        },
      })
      assert.equal(loads, 31)
      // One just-decoded bitmap may coexist with the retained cache before eviction.
      assert.ok(state.peakLiveBytes <= 4 * 1024 * 1024 + 152 * 456 * 4)
      assert.ok(state.bitmaps.every((bitmap) => bitmap.closed))
    },
    { bitmapHeight: 456 }
  ))

test('Failed photos never produce a partial PNG and close already-loaded images', async () =>
  withCanvas(async (state) => {
    const [plan] = planExcelImage([row, { ...row, thumbnail: 'failed-photo' }])
    const progress = []
    await assert.rejects(
      renderExcelImage(plan, {
        loadImage: async (source) => {
          if (source === 'failed-photo') throw new Error('Unavailable')
          return png
        },
        onProgress: ({ completed }) => progress.push(completed),
      }),
      /Photo for product row 2 could not be loaded/
    )
    assert.deepEqual(progress, [0, 1])
    assert.ok(state.bitmaps.every((bitmap) => bitmap.closed))
    assert.ok(state.canvases.every((canvas) => canvas.width === 0))
  }))

test('Cancellation interrupts a pending photo and stops subsequent row work', async () =>
  withCanvas(async (state) => {
    const [plan] = planExcelImage([row, row])
    const controller = new AbortController()
    const started = Promise.withResolvers()
    const pending = Promise.withResolvers()
    let loads = 0
    const result = renderExcelImage(plan, {
      signal: controller.signal,
      loadImage: () => {
        loads++
        started.resolve()
        return pending.promise
      },
    })
    await started.promise
    controller.abort()
    await assert.rejects(result, { name: 'AbortError' })
    pending.resolve(png)
    assert.equal(loads, 1)
    assert.equal(state.draws.length, 0)
    assert.ok(
      state.canvases.every(
        (canvas) => canvas.width === 0 && canvas.height === 0
      )
    )
  }))
