import test from 'node:test'
import assert from 'node:assert/strict'
import {
  A4,
  labelGrid,
  planLabels,
  planCartonMarks,
  cartonSlots,
  allocateSpares,
  normalizeLabelLayout,
  normalizeMarkLayout,
  labelPageOps,
  markPageOps,
  calibrationOps,
  contentBoxes,
  edgeClearance,
  pageCaption,
  drawOps,
  nextOffset,
  numberingFits,
} from '../src/print-layout.js'
import { createPdf } from '../src/pdf-writer.js'

const label = { widthMm: 40, heightMm: 20 }
const mark = { widthMm: 148.5, heightMm: 105 }
const totals = (plan) =>
  Object.fromEntries(plan.items.map((item) => [item.key, item.total]))
const grid = (perPage, columns = 10) => ({
  perPage,
  columns,
  rows: perPage / columns,
})

test('generated sheet captions and carton numbering support English, Spanish and Chinese without changing codes', () => {
  const items = [{ key: 'CE26103102A', quantity: 3 }]
  for (const [language, numbering, heading, pageWord, actual] of [
    ['en', 'Carton 1 of 3', 'CE labels', 'page 1 of', 'Actual size'],
    ['es', 'Caja 1 de 3', 'Etiquetas CE', 'página 1 de', 'Tamaño real'],
    ['zh', '第 1/3 箱', 'CE 标签', '第 1/', '实际大小'],
  ]) {
    const labelGridValue = labelGrid({}, label)
    const labelPlan = planLabels(items, labelGridValue, {})
    const labelOps = labelPageOps({
      plan: labelPlan,
      grid: labelGridValue,
      page: 0,
      language,
    })
    const caption = labelOps.find((op) => op.type === 'text').value
    assert.ok(caption.includes(heading), caption)
    assert.ok(caption.includes(pageWord), caption)
    assert.ok(caption.includes(actual), caption)
    assert.ok(caption.includes('CE26103102A'), caption)
    const markPlan = planCartonMarks(items)
    const markOps = markPageOps({
      plan: markPlan,
      slots: cartonSlots(mark),
      page: 0,
      language,
    })
    assert.equal(markOps.find((op) => op.type === 'text').value, numbering)
    assert.deepEqual(
      markOps.filter((op) => op.type === 'image').map((op) => op.key),
      ['CE26103102A', 'CE26103102A']
    )
    const calibration = calibrationOps(
      {},
      { language, presetName: '自定义 preset' }
    )
    assert.ok(
      calibration.some(
        (op) => op.type === 'text' && op.value.includes('自定义 preset')
      )
    )
    assert.ok(
      calibration.some(
        (op) =>
          op.type === 'text' &&
          op.value.includes(
            language === 'zh'
              ? '打印校准'
              : language === 'es'
                ? 'Calibración'
                : 'calibration'
          )
      )
    )
  }
})

test('40 × 20 mm labels fit 70 per A4 as 5 × 14, centred in 5 mm margins', () => {
  const result = labelGrid({}, label)
  assert.deepEqual(
    [result.columns, result.rows, result.perPage, result.rotated],
    [5, 14, 70, false]
  )
  assert.deepEqual(result.cells[0], {
    row: 0,
    column: 0,
    xMm: 5,
    yMm: 8.5,
    widthMm: 40,
    heightMm: 20,
  })
  const last = result.cells.at(-1)
  assert.equal(last.xMm + last.widthMm, 205)
  assert.equal(last.yMm + last.heightMm, 288.5)
})

test('capacity follows the label size, margins and gaps, turning labels when that fits more', () => {
  for (const [size, layout, expected] of [
    [{ widthMm: 50, heightMm: 25 }, {}, [4, 11, 44, false]],
    [{ widthMm: 100, heightMm: 50 }, {}, [2, 5, 10, false]],
    // 10 mm margins: upright 4 × 13 = 52, turned 9 × 6 = 54.
    [{ widthMm: 40, heightMm: 20 }, { marginMm: 10 }, [9, 6, 54, true]],
    // 2 mm gaps: upright 4 × 13 = 52, turned 9 × 6 = 54.
    [{ widthMm: 40, heightMm: 20 }, { gapXMm: 2, gapYMm: 2 }, [9, 6, 54, true]],
    // 30 × 15: upright 6 × 19 = 114, turned 13 × 9 = 117.
    [{ widthMm: 30, heightMm: 15 }, {}, [13, 9, 117, true]],
  ]) {
    const result = labelGrid(layout, size)
    assert.deepEqual(
      [result.columns, result.rows, result.perPage, result.rotated],
      expected,
      `${size.widthMm}×${size.heightMm} ${JSON.stringify(layout)}`
    )
  }
})

test('labels turn 90° only when that fits strictly more, and stay upright on a tie', () => {
  // 25 × 60: upright 8 × 4 = 32; turned (60 × 25) 3 × 11 = 33.
  const turned = labelGrid({}, { widthMm: 25, heightMm: 60 })
  assert.equal(turned.rotated, true)
  assert.equal(turned.perPage, 33)
  assert.deepEqual([turned.cellWidthMm, turned.cellHeightMm], [60, 25])
  // 50 × 50 is the same both ways.
  assert.equal(labelGrid({}, { widthMm: 50, heightMm: 50 }).rotated, false)
  // 40 × 20 upright 70; turned (20 × 40) 10 × 7 = 70: a tie stays upright.
  assert.equal(labelGrid({}, label).rotated, false)
})

test('a label larger than the printable area fits nothing', () => {
  assert.equal(labelGrid({}, { widthMm: 300, heightMm: 300 }).perPage, 0)
  assert.throws(
    () => labelGrid({}, { widthMm: 0, heightMm: 10 }),
    /greater than zero/
  )
})

test('proportional spares give 44 + 56 for 40 + 50 at a capacity of 100', () => {
  const plan = planLabels(
    [
      { key: 'A', quantity: 40 },
      { key: 'B', quantity: 50 },
    ],
    grid(100)
  )
  assert.equal(plan.pages, 1)
  assert.deepEqual(totals(plan), { A: 44, B: 56 })
  assert.equal(plan.extras, 10)
  assert.equal(plan.blanks, 0)
  assert.equal(plan.excess, null)
})

test('spare shares are whole labels that add up exactly, ties to the larger then earlier request', () => {
  assert.deepEqual(
    allocateSpares([{ requested: 1 }, { requested: 1 }, { requested: 1 }], 2),
    [1, 1, 0]
  )
  assert.deepEqual(
    allocateSpares([{ requested: 10 }, { requested: 30 }], 3),
    [1, 2]
  )
  assert.deepEqual(
    allocateSpares([{ requested: 20 }, { requested: 20 }], 3),
    [2, 1]
  )
  for (let spare = 0; spare < 50; spare++) {
    const shares = allocateSpares(
      [{ requested: 7 }, { requested: 13 }, { requested: 29 }],
      spare
    )
    assert.equal(
      shares.reduce((sum, value) => sum + value, 0),
      spare
    )
  }
})

test('Equal and Leave blank are the same allocator with different weights', () => {
  const items = [
    { key: 'A', quantity: 40 },
    { key: 'B', quantity: 50 },
  ]
  assert.deepEqual(totals(planLabels(items, grid(100), { spares: 'equal' })), {
    A: 45,
    B: 55,
  })
  const blank = planLabels(items, grid(100), { spares: 'blank' })
  assert.deepEqual(totals(blank), { A: 40, B: 50 })
  assert.equal(blank.blanks, 10)
  assert.deepEqual(blank.sequence.slice(-10), Array(10).fill(null))
})

test('caps re-share spares among the other products and leave blanks when all are capped', () => {
  const capped = planLabels(
    [
      { key: 'A', quantity: 40, cap: 2 },
      { key: 'B', quantity: 50 },
    ],
    grid(100)
  )
  assert.deepEqual(totals(capped), { A: 42, B: 58 })
  assert.equal(capped.blanks, 0)
  const both = planLabels(
    [
      { key: 'A', quantity: 40, cap: 2 },
      { key: 'B', quantity: 50, cap: 3 },
    ],
    grid(100)
  )
  assert.deepEqual(totals(both), { A: 42, B: 53 })
  assert.equal(both.blanks, 5)
  // A cap of zero means no extras; an empty cap means no limit.
  const zero = planLabels(
    [
      { key: 'A', quantity: 40, cap: 0 },
      { key: 'B', quantity: 50, cap: '' },
    ],
    grid(100)
  )
  assert.deepEqual(totals(zero), { A: 40, B: 60 })
  // Caps never reduce what was requested.
  const plan = planLabels(
    [{ key: 'A', quantity: 75, cap: 0 }],
    labelGrid({}, label)
  )
  assert.deepEqual([plan.pages, totals(plan).A, plan.blanks], [2, 75, 65])
})

test('90 labels on two 70-label pages show the excess warning', () => {
  const plan = planLabels([{ key: 'A', quantity: 90 }], labelGrid({}, label))
  assert.equal(plan.pages, 2)
  assert.equal(totals(plan).A, 140)
  assert.deepEqual(plan.excess, { extras: 50, requested: 90, percent: 56 })
  // 25% exactly is not over the threshold.
  const edge = planLabels([{ key: 'A', quantity: 80 }], grid(100))
  assert.equal(edge.extras, 20)
  assert.equal(edge.excess, null)
  assert.ok(planLabels([{ key: 'A', quantity: 79 }], grid(100)).excess)
})

test('products stay contiguous in selected order, share rows and continue across pages', () => {
  const plan = planLabels(
    [
      { key: 'B', quantity: 3 },
      { key: 'A', quantity: 4 },
      { key: 'C', quantity: 2 },
    ],
    grid(4, 2),
    { spares: 'blank' }
  )
  assert.equal(plan.pages, 3)
  assert.deepEqual(plan.sequence, [
    'B',
    'B',
    'B',
    'A',
    'A',
    'A',
    'A',
    'C',
    'C',
    null,
    null,
    null,
  ])
  assert.deepEqual(plan.pageSummaries, [
    [
      { key: 'B', count: 3 },
      { key: 'A', count: 1 },
    ],
    [
      { key: 'A', count: 3 },
      { key: 'C', count: 1 },
    ],
    [{ key: 'C', count: 1 }],
  ])
})

test('requested quantities always print on the minimum number of pages', () => {
  const capacity = labelGrid({}, label)
  for (const quantities of [
    [70],
    [71],
    [1, 1, 1],
    [35, 35],
    [69, 2],
    [140, 1],
  ]) {
    const plan = planLabels(
      quantities.map((quantity, index) => ({ key: `K${index}`, quantity })),
      capacity
    )
    const requested = quantities.reduce((sum, value) => sum + value, 0)
    assert.equal(plan.pages, Math.ceil(requested / 70))
    for (const [index, quantity] of quantities.entries())
      assert.ok(totals(plan)[`K${index}`] >= quantity)
    assert.equal(plan.sequence.length, plan.pages * 70)
  }
  assert.equal(planLabels([{ key: 'A', quantity: 0 }], capacity).pages, 0)
})

test('carton marks: two per page, odd totals leave a blank half or an extra copy, numbering per product', () => {
  const items = [
    { key: 'A', quantity: 2 },
    { key: 'B', quantity: 1 },
  ]
  const plan = planCartonMarks(items)
  assert.equal(plan.pages, 2)
  assert.equal(plan.blankHalf, true)
  assert.deepEqual(plan.sequence, [
    { key: 'A', number: 1, of: 2 },
    { key: 'A', number: 2, of: 2 },
    { key: 'B', number: 1, of: 1 },
    null,
  ])
  const filled = planCartonMarks(items, { fillExtra: true })
  assert.deepEqual(filled.sequence.at(-1), { key: 'B', extra: true })
  assert.deepEqual(totals(filled), { A: 2, B: 2 })
  assert.equal(filled.blankHalf, false)
  assert.equal(planCartonMarks([{ key: 'A', quantity: 4 }]).pages, 2)
})

test('carton quantities that differ from a known count are reported', () => {
  const plan = planCartonMarks([
    { key: 'A', quantity: 3, known: 3 },
    { key: 'B', quantity: 2, known: 4 },
    { key: 'C', quantity: 1, known: null },
  ])
  assert.deepEqual(plan.mismatches, [{ key: 'B', requested: 2, known: 4 }])
})

test('carton artwork fills both A4 halves at the same scale without distorting its design', () => {
  const slots = cartonSlots(mark)
  assert.equal(slots.rotated, false)
  assert.equal(slots.cutYMm, 148.5)
  for (const [index, slot] of slots.slots.entries()) {
    assert.ok(
      slot.widthMm > 180 && slot.heightMm > 130,
      'enlarge the old 148.5 × 105 mm artwork'
    )
    assert.ok(
      Math.abs(slot.widthMm / slot.heightMm - mark.widthMm / mark.heightMm) <
        1e-9
    )
    assert.ok(Math.abs(slot.xMm + slot.widthMm / 2 - 105) < 1e-9)
    assert.ok(slot.yMm >= index * 148.5 + 5)
    assert.ok(slot.yMm + slot.heightMm <= (index + 1) * 148.5 - 5)
  }
  assert.equal(slots.slots[1].widthMm, slots.slots[0].widthMm)
  assert.equal(slots.slots[1].yMm - slots.slots[0].yMm, 148.5)
  assert.equal(cartonSlots({ widthMm: 100, heightMm: 190 }).rotated, true)
  const large = cartonSlots({ widthMm: 300, heightMm: 300 })
  assert.equal(large.slots[0].widthMm, large.slots[0].heightMm)
  assert.ok(large.slots[0].heightMm < 148.5)
  assert.throws(
    () => cartonSlots({ widthMm: 0, heightMm: 105 }),
    /greater than zero/
  )
})

test('turning off carton footer text gives its space back to the artwork', () => {
  const layout = { marginMm: 0.5, numbering: false, pageSummary: false }
  const full = cartonSlots(mark, layout).slots[0]
  const numbered = cartonSlots(mark, { marginMm: 0.5 }).slots[0]
  assert.ok(full.widthMm > 208 && full.heightMm === 147.5)
  assert.ok(
    full.widthMm > numbered.widthMm && full.heightMm > numbered.heightMm
  )
  assert.ok(full.xMm >= 0.5 && full.xMm + full.widthMm <= 209.5)
})

test('settings are bounded: offsets from -5 to +5 mm in 0.1 mm steps', () => {
  const layout = normalizeLabelLayout({
    offsetXMm: 7,
    offsetYMm: -1.234,
    marginMm: 'x',
    spares: 'other',
  })
  assert.deepEqual(
    [layout.offsetXMm, layout.offsetYMm, layout.marginMm, layout.spares],
    [5, -1.2, 5, 'proportional']
  )
  assert.equal(normalizeMarkLayout({ offsetXMm: -9 }).offsetXMm, -5)
  assert.equal(normalizeMarkLayout({}).numbering, true)
})

test('page drawings place each label once, add guides and a summary line, and shift by the offsets', () => {
  const layout = { offsetXMm: 1, offsetYMm: -0.5 }
  const capacity = labelGrid(layout, label)
  const plan = planLabels(
    [
      { key: 'CE1', quantity: 40 },
      { key: 'CE2', quantity: 20 },
    ],
    capacity,
    layout
  )
  const ops = labelPageOps({ plan, grid: capacity, layout, page: 0 })
  const images = ops.filter((op) => op.type === 'image')
  assert.equal(images.length, 70)
  assert.deepEqual(images[0].box, {
    row: 0,
    column: 0,
    xMm: 6,
    yMm: 8,
    widthMm: 40,
    heightMm: 20,
  })
  const caption = ops.find((op) => op.type === 'text')
  assert.equal(
    caption.value,
    'CE labels - page 1 of 1 - CE1 x47 - CE2 x23 - print at 100% (Actual size)'
  )
  assert.ok(caption.y > 288 && caption.y < 297 - 2)
  // Cut guides sit on label edges, never across a label.
  for (const op of ops.filter((entry) => entry.type === 'line')) {
    const vertical = op.x1 === op.x2
    const position = vertical ? op.x1 - 1 : op.y1 + 0.5
    const edges = vertical
      ? capacity.cells.flatMap((cell) => [cell.xMm, cell.xMm + cell.widthMm])
      : capacity.cells.flatMap((cell) => [cell.yMm, cell.yMm + cell.heightMm])
    assert.ok(
      edges.some((edge) => Math.abs(edge - position) < 1e-9),
      JSON.stringify(op)
    )
  }
  // Without guides or the summary only the labels remain.
  const plain = labelPageOps({
    plan,
    grid: capacity,
    layout: { ...layout, guides: false, pageSummary: false },
    page: 0,
  })
  assert.equal(plain.length, 70)
})

test('product boundary marks are off by default and follow the change between products', () => {
  const capacity = grid(4, 2)
  capacity.cells = [0, 1, 2, 3].map((index) => ({
    row: Math.floor(index / 2),
    column: index % 2,
    xMm: 10 + (index % 2) * 40,
    yMm: 10 + Math.floor(index / 2) * 20,
    widthMm: 40,
    heightMm: 20,
  }))
  const plan = planLabels(
    [
      { key: 'A', quantity: 3 },
      { key: 'B', quantity: 1 },
    ],
    capacity
  )
  const strong = (ops) =>
    ops.filter((op) => op.type === 'line' && op.widthPt === 0.6)
  assert.equal(
    strong(labelPageOps({ plan, grid: capacity, layout: {}, page: 0 })).length,
    0
  )
  const marked = strong(
    labelPageOps({
      plan,
      grid: capacity,
      layout: { boundaries: true },
      page: 0,
    })
  )
  // A A / A B: B's left edge and top edge.
  assert.deepEqual(
    marked.map((op) => [op.x1, op.y1, op.x2, op.y2]),
    [
      [50, 30, 90, 30],
      [50, 30, 50, 50],
    ]
  )
})

test('the summary line is omitted when less than 4 mm of bottom margin is free', () => {
  const layout = { marginMm: 1 }
  const capacity = labelGrid(layout, { widthMm: 52, heightMm: 29.5 })
  const plan = planLabels([{ key: 'A', quantity: 1 }], capacity, layout)
  const bottom = Math.max(
    ...capacity.cells.map((cell) => cell.yMm + cell.heightMm)
  )
  assert.ok(A4.heightMm - bottom < 4)
  assert.equal(
    labelPageOps({ plan, grid: capacity, layout, page: 0 }).filter(
      (op) => op.type === 'text'
    ).length,
    0
  )
})

test('long page summaries count the products that do not fit', () => {
  const runs = Array.from({ length: 40 }, (_, index) => ({
    key: `CE2610${String(index).padStart(4, '0')}`,
    count: 2,
  }))
  const caption = pageCaption(
    'CE labels - page 1 of 1',
    runs,
    'print at 100% (Actual size)'
  )
  assert.match(caption, /\+\d+ more - print at 100% \(Actual size\)$/)
  assert.ok(
    caption.length <= Math.floor((A4.widthMm - 16) / ((5 * 0.5 * 25.4) / 72))
  )
})

test('the printable-area warning measures content after offsets', () => {
  const capacity = labelGrid({}, label)
  const plan = planLabels([{ key: 'A', quantity: 70 }], capacity)
  const clearance = (layout) =>
    edgeClearance(
      contentBoxes(labelPageOps({ plan, grid: capacity, layout, page: 0 }))
    )
  assert.equal(clearance({}), 5)
  assert.ok(Math.abs(clearance({ offsetXMm: 1.5 }) - 3.5) < 1e-9)
  assert.ok(Math.abs(clearance({ offsetXMm: -1 }) - 4) < 1e-9)
})

test('carton pages draw two marks, numbering, a midpoint cut guide and offsets', () => {
  const slots = cartonSlots(mark)
  const plan = planCartonMarks([{ key: 'M1', quantity: 3 }])
  const ops = markPageOps({ plan, slots, layout: { offsetYMm: 0.5 }, page: 1 })
  const images = ops.filter((op) => op.type === 'image')
  assert.equal(images.length, 1)
  assert.equal(images[0].box.yMm, slots.slots[0].yMm + 0.5)
  const texts = ops.filter((op) => op.type === 'text').map((op) => op.value)
  assert.deepEqual(texts, [
    'Carton 3 of 3',
    'CE carton marks - page 2 of 2 - M1 x1 - print at 100% (Actual size)',
  ])
  const cut = ops.find((op) => op.type === 'line' && op.dash)
  assert.deepEqual([cut.y1, cut.y2], [149, 149])
  const quiet = markPageOps({
    plan,
    slots,
    layout: { numbering: false, guides: false, pageSummary: false },
    page: 0,
  })
  assert.deepEqual(
    quiet.map((op) => op.type),
    ['image', 'image']
  )
})

test('the calibration sheet has 100 mm and 10 mm rulers on both axes with mm ticks', () => {
  const ops = calibrationOps(
    { offsetXMm: -1, offsetYMm: 0.5 },
    { presetName: 'Office' }
  )
  const lines = ops.filter((op) => op.type === 'line')
  const lengths = lines
    .filter((op) => op.widthPt === 0.3 && op.gray === 0.15)
    .map((op) => Math.hypot(op.x2 - op.x1, op.y2 - op.y1))
  for (const length of [100, 10])
    assert.equal(
      lengths.filter((value) => Math.abs(value - length) < 1e-9).length,
      2
    )
  // The long horizontal ruler starts at 55 mm, shifted by the X offset.
  const horizontal = lines.find(
    (op) => op.y1 === op.y2 && Math.abs(op.x2 - op.x1 - 100) < 1e-9
  )
  assert.deepEqual([horizontal.x1, horizontal.y1], [54, 125.5])
  // 101 ticks on each long ruler and 11 on each short one.
  const ticks = lines.filter((op) => op.gray === 0.15).length - 4
  assert.equal(ticks, 101 * 2 + 11 * 2)
  assert.ok(
    ops.some(
      (op) =>
        op.type === 'text' &&
        op.value.includes('X -1.0 mm, Y +0.5 mm - preset Office')
    )
  )
})

test('the preview and the PDF draw the same operations', () => {
  const capacity = labelGrid({}, label)
  const plan = planLabels([{ key: 'A', quantity: 3 }], capacity)
  const ops = labelPageOps({ plan, grid: capacity, layout: {}, page: 0 })
  const calls = []
  const recorder = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...args) =>
          calls.push([name, ...args]),
    }
  )
  drawOps(recorder, ops, (key) => `image:${key}`)
  assert.equal(calls.length, ops.length)
  assert.equal(calls.filter(([name]) => name === 'image').length, 70)
  // The PDF page accepts every call the preview receives.
  const pdf = createPdf()
  const name = pdf.addImage({
    width: 1,
    height: 1,
    bytes: new Uint8Array([120, 156, 99, 0, 0, 0, 1, 0, 1]),
  })
  drawOps(pdf.page(), ops, () => name)
  const text = Buffer.from(pdf.build()).toString('latin1')
  assert.equal(text.match(/ Do Q/g).length, 70)
  assert.match(text, /\/MediaBox \[0 0 595\.276 841\.89\]/)
  assert.match(text, /\/PrintScaling \/None/)
})

test('guides stay inside the 4 mm printable area after offsets and text counts as content', () => {
  for (const layout of [
    {},
    { offsetXMm: -5, offsetYMm: 5 },
    { offsetXMm: 5, offsetYMm: -5 },
    { marginMm: 1 },
  ]) {
    const capacity = labelGrid(layout, label)
    const plan = planLabels([{ key: 'CE1', quantity: 70 }], capacity, layout)
    const ops = labelPageOps({ plan, grid: capacity, layout, page: 0 })
    for (const op of ops.filter((entry) => entry.guide)) {
      for (const x of [op.x1, op.x2])
        assert.ok(x >= 4 - 1e-9 && x <= 206 + 1e-9, JSON.stringify(op))
      for (const y of [op.y1, op.y2])
        assert.ok(y >= 4 - 1e-9 && y <= 293 + 1e-9, JSON.stringify(op))
    }
    const caption = ops.find((op) => op.type === 'text')
    if (caption) {
      const [box] = contentBoxes([caption])
      assert.ok(box.yMm + box.heightMm <= 293 + 1e-9, JSON.stringify(box))
    }
  }
  // Default page: the caption sits inside the printable area, below the labels.
  const capacity = labelGrid({}, label)
  const plan = planLabels([{ key: 'CE1', quantity: 70 }], capacity)
  const caption = labelPageOps({
    plan,
    grid: capacity,
    layout: {},
    page: 0,
  }).find((op) => op.type === 'text')
  const [box] = contentBoxes([caption])
  assert.ok(box.yMm > 288.5 && box.yMm + box.heightMm <= 293 + 1e-9)
  // A caption pushed toward the edge by the offset is reported as content.
  const shiftedCaption = { ...caption, y: 295.5 }
  assert.ok(edgeClearance(contentBoxes([shiftedCaption])) < 4)
})

test('carton cut guides and scissors stay inside the printable area', () => {
  const slots = cartonSlots(mark)
  const plan = planCartonMarks([{ key: 'M1', quantity: 2 }])
  for (const layout of [{}, { offsetXMm: -5 }, { offsetXMm: 5 }]) {
    const ops = markPageOps({ plan, slots, layout, page: 0 })
    for (const op of ops.filter((entry) => entry.guide)) {
      if (op.type === 'circle')
        assert.ok(op.x - op.r >= 4 && op.x + op.r <= 206)
      else
        for (const x of [op.x1, op.x2])
          assert.ok(x >= 4 - 1e-9 && x <= 206 + 1e-9)
    }
    for (const box of contentBoxes(ops))
      assert.ok(box.yMm + box.heightMm <= 293 + 1e-9, JSON.stringify(box))
  }
})

test('recalibration adjusts the current offset instead of replacing it', () => {
  assert.equal(nextOffset(0, 21), -1)
  assert.equal(nextOffset(2, 22), 0)
  assert.equal(nextOffset(-1, 19.4), -0.4)
  assert.equal(nextOffset(4, 12), 5)
  const ops = calibrationOps({ offsetXMm: 2 })
  const texts = ops.filter((op) => op.type === 'text').map((op) => op.value)
  assert.ok(
    texts.some((value) =>
      value.includes('New offset X = current X + 20 - measured')
    )
  )
  assert.ok(texts.some((value) => value.includes('X +2.0 mm')))
  // With X +2.0 applied, an ideal printer puts the reference line at 22 mm and the rule gives 0.
  const vertical = ops.find(
    (op) => op.type === 'line' && op.x1 === op.x2 && op.gray === 0.1
  )
  assert.equal(vertical.x1, 22)
  assert.equal(nextOffset(2, vertical.x1), 0)
})

test('large carton artwork keeps numbering and the summary outside the design', () => {
  const plan = planCartonMarks([{ key: 'M1', quantity: 2 }])
  const big = cartonSlots({ widthMm: 200, heightMm: 138.5 })
  assert.equal(numberingFits(big), true)
  const ops = markPageOps({ plan, slots: big, layout: {}, page: 0 })
  assert.equal(
    ops.filter((op) => op.type === 'text' && op.value.startsWith('Carton'))
      .length,
    2
  )
  assert.ok(
    ops.some(
      (op) => op.type === 'text' && op.value.startsWith('CE carton marks')
    )
  )
  const boxes = contentBoxes(ops)
  for (const box of boxes) assert.ok(box.yMm + box.heightMm <= 293 + 1e-9)
  const normal = cartonSlots(mark)
  assert.equal(numberingFits(normal), true)
  const placed = markPageOps({
    plan,
    slots: normal,
    layout: {},
    page: 0,
  }).filter((op) => op.type === 'text' && op.value.startsWith('Carton'))
  assert.equal(placed.length, 2)
  for (const [index, op] of placed.entries()) {
    const [box] = contentBoxes([op])
    const slot = normal.slots[index]
    assert.ok(
      box.yMm >= slot.yMm + slot.heightMm,
      'numbering stays below its mark'
    )
  }
})
