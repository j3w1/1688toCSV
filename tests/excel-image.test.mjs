import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import {
  excelImageColumns as allExcelImageColumns,
  planExcelImage as planExcelImageBase,
  renderExcelImage as renderExcelImageBase,
} from '../src/excel-image.js'

const excelImageColumns = allExcelImageColumns
  .filter((column) => !column.supplier)
  .map((column) => ({ ...column, label: column.labels.zh }))
const planExcelImage = (rows, options = {}) =>
  planExcelImageBase(rows, { language: 'zh', ...options })

const png = new Blob(
  [
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOzwAAAAASUVORK5CYII=',
      'base64'
    ),
  ],
  { type: 'image/png' }
)
const renderExcelImage = (plan, options) =>
  renderExcelImageBase(plan, {
    renderCartonMark: async () => png,
    ...options,
  })
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
async function withCanvas(
  work,
  { bitmapHeight = 252, headerWidthScale = 1 } = {}
) {
  const previousDocument = globalThis.document
  const previousBitmap = globalThis.createImageBitmap
  const state = {
    canvases: [],
    bitmaps: [],
    text: [],
    draws: [],
    paths: [],
    encoded: 0,
    peakLiveBytes: 0,
  }
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas')
      const context = {
        measureText(text) {
          return {
            width:
              measure(text) *
              (this.font?.startsWith('700 14px') ? headerWidthScale : 1),
          }
        },
        fillText(text, x, y) {
          state.text.push({
            text,
            x,
            y,
            font: this.font,
            color: this.fillStyle,
            baseline: this.textBaseline,
          })
        },
        drawImage: (...args) => state.draws.push(args),
        scale() {},
        fillRect() {},
        beginPath() {
          this.path = []
        },
        moveTo(x, y) {
          this.path.push(['move', x, y])
        },
        lineTo(x, y) {
          this.path.push(['line', x, y])
        },
        stroke() {
          state.paths.push(this.path)
        },
        strokeRect() {},
      }
      const canvas = {
        width: 300,
        height: 150,
        getContext: () => context,
        toBlob: (callback) => {
          state.encoded++
          callback(png)
        },
      }
      state.canvases.push(canvas)
      return canvas
    },
  }
  globalThis.createImageBitmap = async (_, options) => {
    assert.ok([252, 312].includes(options.resizeWidth))
    const mark = options.resizeWidth === 312
    const bitmap = {
      width: options.resizeWidth,
      height: mark ? (options.resizeWidth * 105) / 148.5 : bitmapHeight,
      kind: mark ? 'mark' : 'photo',
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

test('Localized headers grow narrow columns enough to keep whole words such as Cantidad intact', async () =>
  withCanvas(
    () => {
      const [plan] = planExcelImageBase([row], {
        language: 'es',
        columns: ['quantity', 'chineseCategory', 'price'],
      })
      assert.deepEqual(plan.headers[0], ['Cantidad'])
      assert.ok(plan.columns[0].width > 78)
      for (const [index, column] of plan.columns.entries()) {
        for (const word of column.label.split(/\s+/))
          assert.ok(
            plan.headers[index].some((line) =>
              line.split(/\s+/).includes(word)
            ),
            word
          )
      }
    },
    { headerWidthScale: 1.2 }
  ))

test('Custom image columns preserve the chosen order and leave supplier fields blank', async () =>
  withCanvas(async (state) => {
    const columns = [
      'supplierCarton',
      'quantity',
      'supplierDimensions',
      'price',
      'supplierWeight',
    ]
    const input = {
      ...row,
      thumbnail: '',
      chineseCategory: '',
      supplierCarton: 'must not be printed',
      supplierDimensions: 'must not be printed',
      supplierWeight: 'must not be printed',
    }
    const [plan] = planExcelImageBase([input], { columns, language: 'es' })
    assert.deepEqual(
      plan.columns.map((column) => column.key),
      columns
    )
    assert.deepEqual(
      plan.columns.map((column) => column.label),
      [
        'N.º de caja',
        'Cantidad',
        'Medidas de caja',
        'Precio unitario (CNY)',
        'Peso (kg)',
      ]
    )
    assert.deepEqual(
      plan.rows[0].cells.map((cell) => cell.text),
      ['', '20', '', '¥ 3.00', '']
    )
    assert.equal(
      plan.cssWidth,
      2 + plan.columns.reduce((total, column) => total + column.width, 0)
    )
    assert.deepEqual(plan.markSpans, [])
    const result = await renderExcelImageBase(plan)
    assert.equal(result.blob.type, 'image/png')
    assert.equal(state.draws.length, 0)
    assert.ok(!state.text.some((entry) => entry.text.includes('must not')))
    assert.ok(Object.isFrozen(plan.columns))
    assert.ok(Object.isFrozen(plan.columns[0]))
  }))

test('English is the default image language and unsupported or repeated column keys are rejected', async () =>
  withCanvas(() => {
    const [plan] = planExcelImageBase([row])
    assert.equal(plan.language, 'en')
    assert.equal(plan.columns[0].label, 'No.')
    assert.equal(plan.columns.length, 8)
    assert.equal(allExcelImageColumns.length, 11)
    assert.throws(
      () => planExcelImageBase([row], { columns: [] }),
      /at least one/
    )
    assert.throws(
      () => planExcelImageBase([row], { columns: ['unknown'] }),
      /valid, unique/
    )
    assert.throws(
      () => planExcelImageBase([row], { columns: ['price', 'price'] }),
      /valid, unique/
    )
  }))

test('Image descriptions use safe language helpers and category materials appear bold underneath', async () =>
  withCanvas(async (state) => {
    const input = {
      ...row,
      title: '玻璃罐',
      description:
        '玻璃罐\n颜色：红色\n规格：14*65CM\n货号：ABC-1\n材质：玻璃\n定制说明：未知卖家文字',
      spanishName: 'FRASCO',
      chineseCategory: '玻璃罐',
      material: '玻璃',
    }
    for (const [language, category, material, codeLabel, sizeLabel, color] of [
      ['en', '玻璃罐', 'Glass', 'Code: ', 'Specifications: ', 'Red'],
      ['es', 'FRASCO', 'Vidrio', 'Código: ', 'Especificaciones: ', 'Rojo'],
      ['zh', '玻璃罐', '玻璃', '货号：', '规格：', '红色'],
    ]) {
      const [plan] = planExcelImageBase([input], {
        language,
        columns: ['description', 'chineseCategory'],
      })
      const [description, categoryCell] = plan.rows[0].cells
      assert.ok(description.text.includes(`${codeLabel}ABC-1`))
      assert.ok(
        description.text.includes(
          `${sizeLabel}14*65${language === 'zh' ? '' : ' '}CM`
        )
      )
      assert.ok(description.text.includes(color))
      assert.ok(description.text.includes('未知卖家文字'))
      assert.equal(categoryCell.text, `${category}\n${material}`)
      assert.ok(categoryCell.richLines.at(-1)[0].font.startsWith('700 16px'))
      assert.equal(plan.rows[0].source.description, input.description)
      await renderExcelImageBase(plan)
      assert.ok(
        state.text.some(
          (entry) =>
            entry.text === material && entry.font.startsWith('700 16px')
        )
      )
    }
    const [manual] = planExcelImageBase(
      [{ ...input, material: 'My own material' }],
      { columns: ['chineseCategory'], language: 'es' }
    )
    assert.equal(manual.rows[0].cells[0].text, 'FRASCO\nMy own material')
  }))

test('Omitted photo and carton columns do not require their resources or category', async () =>
  withCanvas(async () => {
    const [textOnly] = planExcelImageBase(
      [{ ...row, thumbnail: '', chineseCategory: '' }],
      { columns: ['barcode'] }
    )
    await renderExcelImageBase(textOnly)
    const [markOnly] = planExcelImageBase([{ ...row, thumbnail: '' }], {
      columns: ['baseCode'],
    })
    await renderExcelImageBase(markOnly, { renderCartonMark: async () => png })
    const [photoOnly] = planExcelImageBase([{ ...row, chineseCategory: '' }], {
      columns: ['thumbnail'],
    })
    await renderExcelImageBase(photoOnly, { loadImage: async () => png })
    await assert.rejects(renderExcelImageBase(photoOnly), /photo loader/)
    assert.throws(
      () =>
        planExcelImageBase([{ ...row, chineseCategory: '' }], {
          columns: ['baseCode'],
        }),
      /Chinese category/
    )
  }))

test('Known categories translate for export while authored Spanish names and original carton categories remain intact', async () =>
  withCanvas(async () => {
    const input = {
      ...row,
      chineseCategory: '毛绒玩具',
      spanishName: 'MI PELUCHE',
      material: '棉',
    }
    const [english] = planExcelImageBase([input], {
      language: 'en',
      columns: ['chineseCategory', 'baseCode'],
    })
    assert.equal(english.rows[0].cells[0].text, 'Plush toy\nCotton')
    let markCategory
    await renderExcelImageBase(english, {
      renderCartonMark: async (source) => {
        markCategory = source.chineseCategory
        return png
      },
    })
    assert.equal(markCategory, '毛绒玩具')
    const [spanish] = planExcelImageBase([input], {
      language: 'es',
      columns: ['chineseCategory'],
    })
    assert.equal(spanish.rows[0].cells[0].text, 'MI PELUCHE\nAlgodón')
    const [fallback] = planExcelImageBase([{ ...input, spanishName: '' }], {
      language: 'es',
      columns: ['chineseCategory'],
    })
    assert.equal(fallback.rows[0].cells[0].text, 'PELUCHE\nAlgodón')
  }))

test('Combined variant descriptions omit exact repeated attributes but preserve changed values', async () =>
  withCanvas(() => {
    const input = {
      ...row,
      title: '毛绒玩具',
      description: '毛绒玩具\n颜色：红色\n高度：55CM',
      skuProperties: [
        { label: '颜色', value: '红色' },
        { label: '高度', value: '55CM' },
      ],
    }
    for (const separator of [' / ', ' · ', '\n']) {
      const [plan] = planExcelImage([
        { ...input, variantDescription: `颜色: 红色${separator}高度: 55CM` },
      ])
      const description = cell(plan.rows[0], 'description')
      assert.deepEqual(
        description.blocks.map((block) => block.label),
        ['', '颜色：', '高度：']
      )
    }
    for (const variantDescription of [
      '颜色: 红色 / 高度: 65CM',
      '颜色: 红',
      '颜色: 红色 / 高度: 55CM / 新说明',
    ]) {
      const [plan] = planExcelImage([{ ...input, variantDescription }])
      assert.ok(
        cell(plan.rows[0], 'description').text.includes(variantDescription)
      )
    }
    const [slash] = planExcelImage([
      {
        ...input,
        description: '毛绒玩具\n规格：14/65CM',
        skuProperties: [],
        variantDescription: '规格: 14/65CM',
      },
    ])
    assert.deepEqual(
      cell(slash.rows[0], 'description').blocks.map((block) => block.label),
      ['', '规格：']
    )
  }))

test('Reordered merged carton columns contain only the mark image with no repeated code caption', async () =>
  withCanvas(async (state) => {
    const [plan] = planExcelImageBase(
      [row, { ...row, barcode: `${row.baseCode}AM` }],
      { columns: ['quantity', 'baseCode', 'price'] }
    )
    await renderExcelImageBase(plan, { renderCartonMark: async () => png })
    assert.equal(plan.markSpans.length, 1)
    assert.equal(state.draws.length, 1)
    assert.ok(!state.text.some((entry) => entry.text === row.baseCode))
    const [, left, top, width, height] = state.draws[0]
    assert.equal(left + width / 2, 1 + 78 + 172 / 2)
    assert.equal(
      top + height / 2,
      plan.headerHeight + 1 + plan.markSpans[0].height / 2
    )
  }))

test('Chinese Excel image keeps saved values and one carton mark per group', async () =>
  withCanvas(({ canvases }) => {
    assert.deepEqual(
      excelImageColumns.map((column) => column.label),
      [
        '序号',
        '图片',
        '产品描述',
        '唛头货号',
        '条码货号',
        '品类与材质',
        '单价（元）',
        '数量',
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
    assert.equal(cell(plan.rows[0], 'price').text, '¥ 3.00')
    assert.equal(plan.rows[0].source.price, '3.00')
    assert.equal(cell(plan.rows[0], 'description').text, row.description)
    assert.equal(cell(plan.rows[1], 'barcode').text, 'CE26100101AL')
    assert.equal(cell(plan.rows[0], 'chineseCategory').text, '玻璃')
    input[0].chineseCategory = 'CHANGED AFTER CONFIRMATION'
    assert.equal(plan.rows[0].source.chineseCategory, '玻璃')
    assert.equal(input[0].discount, '0.20')
    assert.equal(input[0].spanishName, 'FRASCO DE VIDRIO')
    assert.ok(
      !excelImageColumns.some(({ key }) =>
        ['spanishName', 'discount'].includes(key)
      )
    )
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
      assert.equal(plan.markSpans.length, 1)
      assert.equal(plan.markSpans[0].start, 0)
      assert.equal(plan.markSpans[0].end, plan.rowCount)
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
          (line) => measure(line) <= excelImageColumns[index].width - 20
        )
      )
      assert.ok(value.height + 20 <= entry.height)
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

test('Code emphasis preserves complete values and marks every reordered row without repeating group codes', async () =>
  withCanvas(async (state) => {
    const barcode = `${row.baseCode}ABCDEFGHIJKLMNOPQRSTUVWXYZAMBS`
    const [plan] = planExcelImage([
      { ...row, barcode, manualReordered: true },
      { ...row, barcode: `${row.baseCode}BS`, manualReordered: true },
      { ...row, orderId: 'normal-order', barcode: `${row.baseCode}XL` },
    ])
    const first = cell(plan.rows[0], 'barcode')
    assert.equal(first.lines.join(''), barcode)
    const firstRuns = first.richLines.flat()
    assert.equal(
      firstRuns
        .filter((run) => !run.font.startsWith('700'))
        .map((run) => run.text)
        .join(''),
      row.baseCode
    )
    assert.equal(
      firstRuns
        .filter((run) => run.font.startsWith('700'))
        .map((run) => run.text)
        .join(''),
      barcode.slice(10)
    )
    assert.ok(
      firstRuns
        .filter((run) => !run.font.startsWith('700'))
        .every((run) => run.color === '#1d4ed8')
    )
    assert.ok(
      firstRuns
        .filter((run) => run.font.startsWith('700'))
        .every((run) => run.color === '#24211c')
    )
    assert.equal(cell(plan.rows[1], 'baseCode').text, '')
    assert.equal(cell(plan.rows[1], 'barcode').richLines[0][0].color, '#1d4ed8')
    assert.equal(
      cell(plan.rows[2], 'baseCode').richLines[0][0].color,
      '#24211c'
    )
    assert.equal(Object.isFrozen(first.richLines[0][0]), true)
    for (const entry of plan.rows)
      for (const column of ['baseCode', 'barcode']) {
        const code = cell(entry, column)
        const width =
          excelImageColumns.find(({ key }) => key === column).width - 20
        assert.ok(
          code.richLines.every(
            (line) =>
              line.reduce((sum, run) => sum + measure(run.text), 0) <= width
          )
        )
      }
    await renderExcelImage(plan, { loadImage: async () => png })
    assert.ok(
      state.text.some(
        (value) => value.text === row.baseCode && value.color === '#1d4ed8'
      )
    )
    assert.ok(
      state.text.some(
        (value) => value.text === 'BS' && value.font.startsWith('700 17px')
      )
    )
  }))

test('Headers, numeric cells and mixed-style descriptions center horizontally and vertically', async () =>
  withCanvas(async (state) => {
    const [plan] = planExcelImage([
      {
        ...row,
        title: '透明玻璃罐',
        description: '透明玻璃罐\n颜色：透明',
      },
    ])
    await renderExcelImage(plan, { loadImage: async () => png })
    let x = 1
    const centers = Object.fromEntries(
      excelImageColumns.map((column) => {
        const center = x + column.width / 2
        x += column.width
        return [column.key, center]
      })
    )
    const inkCenter = (draw) => {
      const size = Number(draw.font.match(/([\d.]+)px/)[1])
      return { x: draw.x + measure(draw.text) / 2, y: draw.y - size * 0.3 }
    }
    for (const column of excelImageColumns) {
      const draw = state.text.find((entry) => entry.text === column.label)
      assert.equal(draw.baseline, 'alphabetic')
      assert.equal(inkCenter(draw).x, centers[column.key])
      assert.ok(
        Math.abs(inkCenter(draw).y - (1 + plan.headerHeight / 2)) < 0.001
      )
    }
    const rowCenter = plan.headerHeight + 1 + plan.rows[0].height / 2
    for (const [key, text] of [
      ['number', '1'],
      ['price', '¥ 3.00'],
      ['quantity', '20'],
      ['chineseCategory', '玻璃'],
    ]) {
      const draw = state.text.find((entry) => entry.text === text)
      assert.equal(inkCenter(draw).x, centers[key])
      assert.ok(Math.abs(inkCenter(draw).y - rowCenter) < 0.001)
    }
    const label = state.text.find((entry) => entry.text === '颜色：')
    const value = state.text.find((entry) => entry.text === '透明')
    assert.equal(label.y, value.y)
    assert.equal(
      (label.x + value.x + measure(value.text)) / 2,
      centers.description
    )
    const [, photoX, photoY, photoWidth, photoHeight] = state.draws[0]
    assert.equal(photoWidth, 126)
    assert.equal(photoHeight, 126)
    assert.equal(photoX + photoWidth / 2, centers.thumbnail)
    assert.equal(photoY + photoHeight / 2, rowCenter)
  }))

test('Large financial values remain complete and portrait photos fit the available cell without distortion', async () =>
  withCanvas(
    async (state) => {
      const input = {
        ...row,
        price: '1234567890123.4567',
        quantity: '987654321012345',
      }
      const [plan] = planExcelImage([input])
      for (const key of ['price', 'quantity']) {
        const value = cell(plan.rows[0], key)
        assert.equal(
          value.lines.join('').replaceAll(' ', ''),
          `${key === 'price' ? '¥' : ''}${input[key]}`
        )
        assert.ok(value.height + 20 <= plan.rows[0].height)
      }
      await renderExcelImage(plan, { loadImage: async () => png })
      const [, , photoY, photoWidth, photoHeight] = state.draws[0]
      assert.ok(photoWidth <= 126)
      assert.ok(photoHeight <= plan.rows[0].height - 6)
      assert.equal(photoWidth / photoHeight, 1 / 3)
      assert.equal(
        photoY + photoHeight / 2,
        plan.headerHeight + 1 + plan.rows[0].height / 2
      )
      assert.equal(plan.rows[0].source.price, input.price)
    },
    { bitmapHeight: 756 }
  ))

test('Rich descriptions separate original titles and attributes and include latest variant notes once', async () =>
  withCanvas(async (state) => {
    const input = {
      ...row,
      title: '香薰玻璃罐',
      description: '香薰玻璃罐\n颜色：透明\n容量：300ml\n货号：TEST-01',
      skuProperties: [
        { label: '颜色', value: '透明' },
        { label: '容量', value: '300ml' },
      ],
      productNumber: 'TEST-01',
      variantDescription: '透明 · 300ml',
      sourceSize: '300ml',
    }
    const [plan] = planExcelImage([input])
    const description = cell(plan.rows[0], 'description')
    assert.equal(description.blocks[0].font.startsWith('600 16px'), true)
    assert.deepEqual(
      description.blocks.map((block) => block.label),
      ['', '颜色：', '容量：', '货号：']
    )
    assert.equal(
      description.blocks.filter((block) => block.label === '尺寸：').length,
      0
    )
    input.skuProperties[0].value = 'CHANGED'
    assert.equal(plan.rows[0].source.skuProperties[0].value, '透明')
    await renderExcelImage(plan, { loadImage: async () => png })
    assert.ok(
      state.text.some(
        (entry) => entry.text === '颜色：' && entry.font.startsWith('600 13px')
      )
    )
    assert.ok(
      state.text.some(
        (entry) => entry.text === '透明' && entry.font.startsWith('14px')
      )
    )
    assert.equal(
      state.text.filter((entry) => entry.text === 'TEST-01').length,
      1
    )

    const [exactNote] = planExcelImage([
      { ...input, variantDescription: '颜色: 透明', skuProperties: [] },
    ])
    assert.equal(
      cell(exactNote.rows[0], 'description').blocks.some(
        (block) => block.label === '产品规格：'
      ),
      false
    )
  }))

test('Long edited variant notes and attribute labels remain fully visible at smaller detail type', async () =>
  withCanvas(() => {
    const variantDescription = '新品彩色玻璃礼盒'.repeat(30)
    const longLabel = '适用于多种场景的详细产品尺寸说明'
    const [plan] = planExcelImage([
      {
        ...row,
        title: '玻璃罐',
        description: '玻璃罐',
        variantDescription,
        skuProperties: [{ label: longLabel, value: '300ml / 500ml' }],
      },
    ])
    const description = cell(plan.rows[0], 'description')
    const variant = description.blocks.find(
      (block) => block.label === '产品规格：'
    )
    assert.equal(variant.lines.join(''), variantDescription)
    assert.equal(variant.font.startsWith('14px'), true)
    const attribute = description.blocks.find(
      (block) => block.label === `${longLabel}：`
    )
    assert.equal(attribute.labelLines.join(''), `${longLabel}：`)
    assert.ok(description.height + 20 <= plan.rows[0].height)
    assert.ok(description.lines.every((line) => measure(line) <= 310))
  }))

test('Empty selections and missing photos fail before producing a partial image', async () =>
  withCanvas(() => {
    assert.throws(() => planExcelImage([]), /Select product rows/)
    assert.throws(
      () => planExcelImage([row, { ...row, thumbnail: '' }]),
      /row 2 has no photo/
    )
  }))

test('Carton marks merge only contiguous matching order/group/code rows and leave unprepared rows blank', async () =>
  withCanvas(async (state) => {
    const [plan] = planExcelImage([
      row,
      { ...row, barcode: `${row.baseCode}BS`, manualReordered: true },
      { ...row, baseCode: '', barcode: '', chineseCategory: '' },
      row,
      { ...row, orderId: 'another-order' },
      { ...row, baseCode: 'CE26100102', barcode: 'CE26100102A' },
    ])
    assert.deepEqual(
      plan.markSpans.map(({ start, end }) => [start, end]),
      [
        [0, 2],
        [3, 4],
        [4, 5],
        [5, 6],
      ]
    )
    assert.equal(cell(plan.rows[3], 'baseCode').text, row.baseCode)
    assert.equal(plan.markSpans[0].manualReordered, true)
    assert.equal(plan.markSpans[0].caption, undefined)
    const marks = []
    await renderExcelImage(plan, {
      loadImage: async () => png,
      renderCartonMark: async (source) => {
        marks.push([source.orderId, source.groupId, source.baseCode])
        return png
      },
    })
    assert.equal(marks.length, 3)
    assert.equal(
      state.draws.filter(([bitmap]) => bitmap.kind === 'mark').length,
      4
    )
    const markIndex = excelImageColumns.findIndex(
      (column) => column.key === 'baseCode'
    )
    const markLeft =
      1 +
      excelImageColumns
        .slice(0, markIndex)
        .reduce((width, column) => width + column.width, 0)
    const separatorY = plan.headerHeight + 1 + plan.rows[0].height
    assert.ok(
      state.paths.some(
        (path) =>
          JSON.stringify(path) ===
          JSON.stringify([
            ['move', 1, separatorY],
            ['line', markLeft, separatorY],
            ['move', markLeft + excelImageColumns[markIndex].width, separatorY],
            ['line', plan.cssWidth - 1, separatorY],
          ])
      )
    )
    assert.ok(state.bitmaps.every((bitmap) => bitmap.closed))
  }))

test('Prepared products require Chinese categories and real mark generation while unprepared rows need no renderer', async () =>
  withCanvas(async (state) => {
    assert.throws(
      () => planExcelImage([{ ...row, chineseCategory: '' }]),
      /row 1 \(CE26100101\) needs a Chinese category/
    )
    const [prepared] = planExcelImage([row])
    await assert.rejects(
      renderExcelImageBase(prepared, { loadImage: async () => png }),
      /carton mark renderer/
    )
    const [unprepared] = planExcelImage([
      { ...row, baseCode: '', barcode: '', chineseCategory: '' },
    ])
    assert.equal(unprepared.markSpans.length, 0)
    await renderExcelImageBase(unprepared, { loadImage: async () => png })
    assert.equal(state.draws.length, 1)
  }))

test('Mark generation failures and cancellation leave no partial PNG or retained bitmap', async () =>
  withCanvas(async (state) => {
    const [plan] = planExcelImage([row])
    await assert.rejects(
      renderExcelImage(plan, {
        loadImage: async () => png,
        renderCartonMark: async () => {
          throw new Error('Invalid mark settings')
        },
      }),
      /Carton mark for product row 1 could not be created/
    )
    assert.equal(state.encoded, 0)
    assert.ok(state.bitmaps.every((bitmap) => bitmap.closed))
    const controller = new AbortController()
    const started = Promise.withResolvers()
    const pending = Promise.withResolvers()
    const result = renderExcelImage(plan, {
      loadImage: async () => png,
      signal: controller.signal,
      renderCartonMark: (source, { signal }) => {
        assert.equal(source.baseCode, row.baseCode)
        assert.equal(signal, controller.signal)
        started.resolve()
        return pending.promise
      },
    })
    await started.promise
    controller.abort()
    await assert.rejects(result, { name: 'AbortError' })
    pending.resolve(png)
    assert.equal(state.encoded, 0)
    assert.ok(state.bitmaps.every((bitmap) => bitmap.closed))
  }))

test('Centered Chinese descriptions avoid orphan characters and separate titles, variants and article numbers without invented fields', async () =>
  withCanvas(() => {
    const title = '玻'.repeat(21) + '销售'
    const [plan] = planExcelImage([
      {
        ...row,
        title,
        description: `${title}\n颜色：透明\n货号：TEST-01`,
        productNumber: 'TEST-01',
      },
    ])
    const description = cell(plan.rows[0], 'description')
    assert.equal(description.blocks[0].lines.join(''), title)
    assert.ok(description.blocks[0].lines.every((line) => [...line].length > 1))
    assert.deepEqual(
      description.blocks.map((block) => block.label),
      ['', '颜色：', '货号：']
    )
    assert.ok(description.blocks[2].font.startsWith('600'))
    const [missing] = planExcelImage([
      {
        ...row,
        title: '',
        description: '型号：A12',
        productNumber: '',
        variantDescription: '',
      },
    ])
    assert.deepEqual(
      cell(missing.rows[0], 'description').blocks.map((block) => block.label),
      ['型号：']
    )
    assert.ok(!cell(missing.rows[0], 'description').text.includes('货号'))
    const [paragraph] = planExcelImage([
      { ...row, title: '简短标题', description: '简短标题\n销' },
    ])
    assert.deepEqual(
      cell(paragraph.rows[0], 'description').blocks.map((block) =>
        block.lines.join('')
      ),
      ['简短标题', '销']
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
    assert.equal(
      state.draws.filter(([bitmap]) => bitmap.kind === 'photo').length,
      3
    )
    assert.equal(
      state.draws.filter(([bitmap]) => bitmap.kind === 'mark').length,
      1
    )
    assert.deepEqual(
      progress.map((value) => value.completed),
      [0, 1, 2, 3]
    )
    assert.ok(progress.every((value) => value.total === 3))
    assert.ok(state.text.some((value) => value.text === '¥ 3.00'))
    assert.ok(!state.text.some((value) => value.text === '0.20'))
    assert.ok(!state.text.some((value) => value.text === 'FRASCO DE VIDRIO'))
    assert.ok(
      state.text.some(
        (value) => value.text === '20' && value.font.startsWith('700 19px')
      )
    )
    assert.ok(
      state.text.some(
        (value) =>
          value.text === 'Glass jar' && value.font.startsWith('600 16px')
      )
    )
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
      assert.ok(plan.rowCount > 5)
      let loads = 0
      await renderExcelImage(plan, {
        loadImage: async () => {
          loads++
          return png
        },
      })
      assert.equal(loads, plan.rowCount)
      // One just-decoded bitmap may coexist with the retained cache before eviction.
      assert.ok(state.peakLiveBytes <= 4 * 1024 * 1024 + 252 * 756 * 4)
      assert.ok(state.bitmaps.every((bitmap) => bitmap.closed))
    },
    { bitmapHeight: 756 }
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

test('Real canvas output preserves centered rich text, blue reordered codes and contained photos', async (t) => {
  const { build } = await import('esbuild')
  const { chromium } = await import('@playwright/test')
  const bundle = await build({
    entryPoints: [
      fileURLToPath(new URL('../src/excel-image.js', import.meta.url)),
    ],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'ExcelImage',
  })
  const browser = await chromium.launch({
    channel: process.env.EXTENSION_TEST_CHANNEL || 'chromium',
    headless: true,
  })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const actual = await page.evaluate(async (input) => {
    const photo = document.createElement('canvas')
    photo.width = 180
    photo.height = 90
    const photoContext = photo.getContext('2d')
    photoContext.fillStyle = '#bc3232'
    photoContext.fillRect(0, 0, 180, 90)
    photoContext.fillStyle = '#fff'
    photoContext.fillRect(20, 20, 140, 50)
    const photoData = photo.toDataURL()
    const mark = document.createElement('canvas')
    mark.width = 297
    mark.height = 210
    const markContext = mark.getContext('2d')
    markContext.fillStyle = '#fff'
    markContext.fillRect(0, 0, mark.width, mark.height)
    markContext.fillStyle = '#000'
    markContext.font = 'bold 100px sans-serif'
    markContext.fillText('CE', 60, 110)
    markContext.font = '24px sans-serif'
    markContext.fillText(input.baseCode, 60, 160)
    const markBlob = await new Promise((resolve) => mark.toBlob(resolve))
    const rows = [
      {
        ...input,
        description: '透明玻璃罐\n颜色：透明',
        manualReordered: true,
      },
      {
        ...input,
        barcode: `${input.baseCode}ABCDEFGHIJKLMNOPQRSTUVWXYZAMBS`,
        quantity: '987654321012345',
        price: '1234567890123.4567',
        manualReordered: true,
      },
    ]
    const [plan] = ExcelImage.planExcelImage(rows, { language: 'zh' })
    const headerChecks = ['en', 'es', 'zh'].map((language) => {
      const [localized] = ExcelImage.planExcelImage(rows, {
        language,
        columns: ExcelImage.excelImageColumns.map((column) => column.key),
      })
      return {
        language,
        columns: localized.columns,
        headers: localized.headers,
      }
    })
    const calls = []
    const photos = []
    const prototype = CanvasRenderingContext2D.prototype
    const fillText = prototype.fillText
    const drawImage = prototype.drawImage
    prototype.fillText = function (text, x, y) {
      const bounds = this.measureText(text)
      calls.push({
        text,
        x,
        y,
        width: bounds.width,
        font: this.font,
        color: this.fillStyle,
        left: x - bounds.actualBoundingBoxLeft,
        right: x + bounds.actualBoundingBoxRight,
        top: y - bounds.actualBoundingBoxAscent,
        bottom: y + bounds.actualBoundingBoxDescent,
      })
      return fillText.call(this, text, x, y)
    }
    prototype.drawImage = function (bitmap, ...args) {
      photos.push({
        bitmapWidth: bitmap.width,
        bitmapHeight: bitmap.height,
        args,
      })
      return drawImage.call(this, bitmap, ...args)
    }
    let result
    try {
      result = await ExcelImage.renderExcelImage(plan, {
        loadImage: async () => photoData,
        renderCartonMark: async () => markBlob,
      })
    } finally {
      prototype.fillText = fillText
      prototype.drawImage = drawImage
    }
    const bitmap = await createImageBitmap(result.blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0)
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
    let bluePixels = 0
    for (let index = 0; index < data.length; index += 4)
      if (
        data[index] === 29 &&
        data[index + 1] === 78 &&
        data[index + 2] === 216
      )
        bluePixels++
    bitmap.close()
    canvas.width = canvas.height = 0
    photo.width = photo.height = 0
    mark.width = mark.height = 0
    return {
      calls,
      photos,
      bluePixels,
      plan,
      headerChecks,
      width: result.width,
      height: result.height,
    }
  }, row)
  assert.ok(actual.bluePixels > 100)
  for (const check of actual.headerChecks) {
    for (const [index, column] of check.columns.entries())
      for (const word of column.label.split(/\s+/))
        assert.ok(
          check.headers[index].some((line) => line.split(/\s+/).includes(word)),
          `${check.language}: ${word}`
        )
    if (check.language === 'es')
      assert.deepEqual(
        check.headers[
          check.columns.findIndex((column) => column.key === 'quantity')
        ],
        ['Cantidad']
      )
  }
  assert.equal(actual.width, actual.plan.width)
  assert.equal(actual.height, actual.plan.height)
  let x = 1
  for (const column of excelImageColumns) {
    const header = actual.calls.find((call) => call.text === column.label)
    assert.ok(
      Math.abs(header.x + header.width / 2 - (x + column.width / 2)) < 0.01
    )
    assert.ok(
      Math.abs(
        (header.top + header.bottom) / 2 - (1 + actual.plan.headerHeight / 2)
      ) < 0.01
    )
    const body = actual.calls.filter(
      (call) =>
        call.y > actual.plan.headerHeight &&
        call.x >= x &&
        call.x < x + column.width
    )
    assert.ok(
      body.every(
        (call) => call.left >= x + 8 && call.right <= x + column.width - 8
      )
    )
    x += column.width
  }
  const prefix = actual.calls.find((call) => call.text === row.baseCode)
  assert.equal(prefix.color, '#1d4ed8')
  assert.ok(prefix.font.startsWith('17px'))
  const barcodeIndex = excelImageColumns.findIndex(
    (column) => column.key === 'barcode'
  )
  const barcodeLeft =
    1 +
    excelImageColumns
      .slice(0, barcodeIndex)
      .reduce((width, column) => width + column.width, 0)
  const barcodeRight = barcodeLeft + excelImageColumns[barcodeIndex].width
  let barcodeTop = actual.plan.headerHeight + 1
  for (const [index, expected] of [
    row.barcode,
    `${row.baseCode}ABCDEFGHIJKLMNOPQRSTUVWXYZAMBS`,
  ].entries()) {
    const barcodeBottom = barcodeTop + actual.plan.rows[index].height
    const calls = actual.calls.filter(
      (call) =>
        call.x >= barcodeLeft &&
        call.x < barcodeRight &&
        call.y >= barcodeTop &&
        call.y < barcodeBottom
    )
    // Font metrics differ by OS. Verify every drawn character and its style,
    // including suffixes that wrap into separate draw calls.
    assert.equal(calls.map((call) => call.text).join(''), expected)
    let offset = 0
    for (const call of calls) {
      if (offset < row.baseCode.length) {
        assert.ok(offset + call.text.length <= row.baseCode.length)
        assert.ok(call.font.startsWith('17px'))
        assert.equal(call.color, '#1d4ed8')
      } else {
        assert.match(call.font, /^(?:700|bold) 17px/)
        assert.equal(call.color, '#24211c')
      }
      offset += call.text.length
    }
    barcodeTop = barcodeBottom
  }
  assert.ok(actual.calls.some((call) => call.text.startsWith('¥ ')))
  const photos = actual.photos.filter((photo) => photo.bitmapWidth === 252)
  const marks = actual.photos.filter((photo) => photo.bitmapWidth === 312)
  assert.equal(photos.length, 2)
  assert.equal(marks.length, 1)
  let y = actual.plan.headerHeight + 1
  for (const [index, photo] of photos.entries()) {
    const [left, top, width, height] = photo.args
    assert.equal(width, 126)
    assert.equal(width / height, photo.bitmapWidth / photo.bitmapHeight)
    assert.equal(left + width / 2, 117)
    assert.equal(top + height / 2, y + actual.plan.rows[index].height / 2)
    y += actual.plan.rows[index].height
  }
  const [, markTop, markWidth, markHeight] = marks[0].args
  assert.equal(
    markWidth / markHeight,
    marks[0].bitmapWidth / marks[0].bitmapHeight
  )
  assert.ok(markTop > actual.plan.headerHeight)
})
