import test from 'node:test'
import assert from 'node:assert/strict'
import { createTableHeights, tableWindow } from '../src/virtual-table.js'

const entries = (count) =>
  Array.from({ length: count }, (_, index) => [
    ...(index % 3 === 0 ? [{ key: `heading:${index}`, heading: true }] : []),
    { key: `product:${index}` },
  ]).flat()

test('continuous table exposes every product while each window mounts at most 100 products', () => {
  const source = entries(2250),
    reached = new Set()
  for (let index = 0; index < source.length; index += 17) {
    const { start, end } = tableWindow(source, index)
    assert.ok(start <= index && index < end)
    const products = source.slice(start, end).filter((entry) => !entry.heading)
    assert.equal(products.length, 100)
    for (const product of products) reached.add(product.key)
  }
  assert.equal(reached.size, 2250)
  assert.deepEqual(tableWindow([], 0), { start: 0, end: 0 })
  assert.equal(tableWindow(entries(3), 2).end, 4)
})

test('table offsets use actual variable row heights and clamp both ends without rounding rows', () => {
  const source = entries(5),
    measured = new Map([
      ['heading:0', 35.5],
      ['product:0', 90],
      ['product:1', 170.25],
    ]),
    layout = createTableHeights(source, measured, 110)
  assert.equal(layout.offsets[1], 35.5)
  assert.equal(layout.offsets[3], 295.75)
  assert.equal(layout.at(35.5), 1)
  assert.equal(layout.at(35.49), 0)
  assert.equal(layout.at(-100), 0)
  assert.equal(layout.at(layout.total + 1000), source.length - 1)
  assert.equal(layout.total, 665.75)
})
