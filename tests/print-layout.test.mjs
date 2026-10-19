import test from 'node:test'
import assert from 'node:assert/strict'
import {
  labelGrid,
  planLabels,
  planCartonMarks,
  cartonSlots,
  shareSpares,
  normalizePrintLayout,
} from '../src/print-layout.js'

const label = { widthMm: 40, heightMm: 20 }
const counts = (plan) =>
  Object.fromEntries(plan.items.map((item) => [item.key, item.total]))
const grid = (perPage, columns = 10) => ({
  perPage,
  columns,
  rows: perPage / columns,
})

test('default 40 × 20 mm labels fit 70 per A4 as 5 × 14, centred in 5 mm margins', () => {
  const result = labelGrid({}, label)
  assert.equal(result.perPage, 70)
  assert.equal(result.columns, 5)
  assert.equal(result.rows, 14)
  assert.equal(result.rotated, false)
  assert.deepEqual(result.cells[0], {
    xMm: 5,
    yMm: 8.5,
    widthMm: 40,
    heightMm: 20,
  })
  const last = result.cells.at(-1)
  assert.ok(last.yMm + last.heightMm <= 297 - 5)
})

test('automatic rotation is used only when it fits more labels', () => {
  const upright = labelGrid({ marginMm: 5 }, { widthMm: 60, heightMm: 30 })
  assert.equal(upright.perPage, 27)
  assert.equal(upright.rotated, false)
  const turned = labelGrid({ marginMm: 5 }, { widthMm: 140, heightMm: 30 })
  assert.equal(turned.rotated, true)
  assert.equal(turned.perPage, 12)
  assert.equal(turned.cells[0].widthMm, 30)
  const kept = labelGrid({ rotate: false }, { widthMm: 140, heightMm: 30 })
  assert.equal(kept.perPage, 9)
})

test('gaps and margins reduce the grid', () => {
  const result = labelGrid({ marginMm: 10, gapXMm: 2, gapYMm: 2 }, label)
  assert.equal(result.columns, 4)
  assert.equal(result.rows, 12)
  assert.equal(result.cells[1].xMm - result.cells[0].xMm, 42)
})

test('pre-cut sheets use their offset and pitch and reject sheets that overflow A4', () => {
  const result = labelGrid(
    {
      sheet: 'precut',
      precut: {
        columns: 5,
        rows: 13,
        offsetXMm: 5,
        offsetYMm: 10.7,
        pitchXMm: 40,
        pitchYMm: 21.2,
      },
    },
    label
  )
  assert.equal(result.perPage, 65)
  assert.deepEqual(result.cells[6], {
    xMm: 45,
    yMm: 10.7 + 21.2,
    widthMm: 40,
    heightMm: 20,
  })
  assert.throws(
    () =>
      labelGrid(
        {
          sheet: 'precut',
          precut: { columns: 6, rows: 13, offsetXMm: 5, pitchXMm: 40 },
        },
        label
      ),
    /does not fit/
  )
})

test('owner example: 40 + 50 labels at 100 per page fill 10 spares by mode', () => {
  const items = [
    { key: '1001', quantity: 40 },
    { key: '1002', quantity: 50 },
  ]
  const equal = planLabels(items, grid(100), { spares: 'equal' })
  assert.deepEqual(counts(equal), { 1001: 45, 1002: 55 })
  assert.equal(equal.pages, 1)
  assert.equal(equal.sequence.filter(Boolean).length, 100)
  const proportional = planLabels(items, grid(100), { spares: 'proportional' })
  assert.deepEqual(counts(proportional), { 1001: 44, 1002: 56 })
  const blank = planLabels(items, grid(100), { spares: 'blank' })
  assert.deepEqual(counts(blank), { 1001: 40, 1002: 50 })
  assert.equal(blank.sequence.filter((key) => key === null).length, 10)
})

test('spares are whole labels that add up exactly and never reduce a request', () => {
  for (const mode of ['equal', 'proportional']) {
    const items = [
      { key: 'a', quantity: 7 },
      { key: 'b', quantity: 11 },
      { key: 'c', quantity: 3 },
    ]
    const plan = planLabels(items, grid(70, 5), { spares: mode })
    assert.equal(plan.pages, 1)
    const total = plan.items.reduce((sum, item) => sum + item.total, 0)
    assert.equal(total, 70)
    for (const [index, item] of plan.items.entries())
      assert.ok(item.total >= items[index].quantity)
  }
  assert.deepEqual(
    shareSpares([{ weight: 1 }, { weight: 1 }, { weight: 1 }], 2, 'equal'),
    [1, 1, 0]
  )
  assert.deepEqual(
    shareSpares([{ weight: 1 }, { weight: 2 }], 1, 'equal'),
    [0, 1]
  )
})

test('exact fit, several pages and a single product', () => {
  const exact = planLabels([{ key: 'a', quantity: 70 }], grid(70, 5))
  assert.equal(exact.pages, 1)
  assert.equal(exact.spare, 0)
  assert.equal(exact.items[0].total, 70)
  const several = planLabels(
    [
      { key: 'a', quantity: 100 },
      { key: 'b', quantity: 30 },
    ],
    grid(70, 5),
    { spares: 'proportional' }
  )
  assert.equal(several.pages, 2)
  assert.equal(several.spare, 10)
  assert.deepEqual(counts(several), { a: 108, b: 32 })
  assert.equal(several.sequence.length, 140)
  const single = planLabels([{ key: 'a', quantity: 3 }], grid(70, 5))
  assert.equal(single.items[0].total, 70)
  const none = planLabels([{ key: 'a', quantity: 0 }], grid(70, 5))
  assert.equal(none.pages, 0)
})

test('new-row mode keeps each product on whole rows and shares spare rows', () => {
  const plan = planLabels(
    [
      { key: 'a', quantity: 7 },
      { key: 'b', quantity: 3 },
    ],
    { perPage: 20, columns: 5, rows: 4 },
    { newRow: true, spares: 'equal' }
  )
  // a needs 2 rows, b 1 row; the fourth row goes to the larger request.
  assert.deepEqual(counts(plan), { a: 15, b: 5 })
  assert.deepEqual(plan.sequence.slice(0, 15), Array(15).fill('a'))
  assert.deepEqual(plan.sequence.slice(15), Array(5).fill('b'))
  const blank = planLabels(
    [
      { key: 'a', quantity: 7 },
      { key: 'b', quantity: 3 },
    ],
    { perPage: 20, columns: 5, rows: 4 },
    { newRow: true, spares: 'blank' }
  )
  assert.deepEqual(counts(blank), { a: 7, b: 3 })
  assert.deepEqual(blank.sequence.slice(5, 10), ['a', 'a', null, null, null])
  assert.equal(blank.sequence[10], 'b')
})

test('carton marks: two per page, numbered per product, odd totals leave a blank or an extra copy', () => {
  const plan = planCartonMarks([
    { key: 'g1', quantity: 2 },
    { key: 'g2', quantity: 1 },
  ])
  assert.equal(plan.pages, 2)
  assert.deepEqual(plan.sequence.slice(0, 3), [
    { key: 'g1', number: 1, of: 2 },
    { key: 'g1', number: 2, of: 2 },
    { key: 'g2', number: 1, of: 1 },
  ])
  assert.equal(plan.sequence[3], null)
  const filled = planCartonMarks([{ key: 'g1', quantity: 3 }], {
    fillExtra: true,
  })
  assert.deepEqual(filled.sequence[3], { key: 'g1', extra: true })
  assert.equal(filled.items[0].total, 4)
})

test('carton slots split A4 at 148.5 mm and centre the default mark in each half', () => {
  const result = cartonSlots({ widthMm: 148.5, heightMm: 105 })
  assert.equal(result.cutYMm, 148.5)
  assert.equal(result.rotated, false)
  assert.deepEqual(result.slots[0], {
    xMm: 30.75,
    yMm: 21.75,
    widthMm: 148.5,
    heightMm: 105,
  })
  assert.equal(result.slots[1].yMm, 148.5 + 21.75)
  assert.equal(cartonSlots({ widthMm: 120, heightMm: 190 }).rotated, true)
  assert.throws(
    () => cartonSlots({ widthMm: 200, heightMm: 200 }),
    /larger than half/
  )
})

test('layout settings are bounded', () => {
  const layout = normalizePrintLayout({
    marginMm: -4,
    dpi: 1200,
    spares: 'other',
    precut: { columns: 0 },
  })
  assert.equal(layout.marginMm, 0)
  assert.equal(layout.dpi, 300)
  assert.equal(layout.spares, 'equal')
  assert.equal(layout.precut.columns, 1)
})
