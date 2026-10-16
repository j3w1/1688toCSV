import test from 'node:test'
import assert from 'node:assert/strict'
import { createRowSelection } from '../src/row-selection.js'

function setup(options = {}) {
  const selected = new Set()
  let keys = ['a', 'b', 'c', 'd', 'e']
  const selection = createRowSelection({
    selected,
    getKeys: () => keys,
    ...options,
  })
  return {
    selected,
    selection,
    filter: (value) => {
      keys = value
    },
  }
}

test('packing groups toggle independently by default and Shift adds a range', () => {
  const { selected, selection } = setup({ additive: true })
  selection.select('a')
  selection.select('c')
  assert.deepEqual([...selected], ['a', 'c'])
  selection.select('e', { shiftKey: true })
  assert.deepEqual([...selected], ['a', 'c', 'd', 'e'])
  selection.select('c')
  assert.deepEqual([...selected], ['a', 'd', 'e'])
  selection.clear()
  assert.equal(selected.size, 0)
})

test('row clicks replace selection; Ctrl and Meta independently toggle rows', () => {
  const { selected, selection } = setup()
  selection.select('b')
  selection.select('d', { ctrlKey: true })
  assert.deepEqual([...selected], ['b', 'd'])
  selection.select('b', { metaKey: true })
  assert.deepEqual([...selected], ['d'])
  selection.select('c')
  assert.deepEqual([...selected], ['c'])
  selection.select('c')
  assert.deepEqual([...selected], [])
  selection.select('c')
  assert.deepEqual([...selected], ['c'])
})

test('Shift extends and contracts an inclusive range from the unchanged anchor', () => {
  const { selected, selection } = setup()
  selection.select('c')
  selection.select('e', { shiftKey: true })
  assert.deepEqual([...selected], ['c', 'd', 'e'])
  selection.select('a', { shiftKey: true })
  assert.deepEqual([...selected], ['a', 'b', 'c'])
  selection.select('b', { shiftKey: true })
  assert.deepEqual([...selected], ['b', 'c'])
})

test('Ctrl-Shift adds a range without losing other selected rows', () => {
  const { selected, selection } = setup()
  selection.select('a')
  selection.select('c', { ctrlKey: true })
  selection.select('e', { shiftKey: true, ctrlKey: true })
  assert.deepEqual([...selected], ['a', 'c', 'd', 'e'])
})

test('ranges use current filtered order and ignore keys outside that scope', () => {
  const { selected, selection, filter } = setup()
  selection.select('a')
  filter(['e', 'c', 'b'])
  selection.select('c', { shiftKey: true })
  assert.deepEqual([...selected], ['c'])
  selection.select('b', { shiftKey: true })
  assert.deepEqual([...selected], ['c', 'b'])
  selection.select('a')
  assert.deepEqual([...selected], ['c', 'b'])
})

test('clearing resets the anchor, select-all uses filtered rows, empty scopes stay empty', () => {
  const { selected, selection, filter } = setup()
  selection.select('a')
  selection.clear()
  selection.select('e', { shiftKey: true })
  assert.deepEqual([...selected], ['e'])
  filter(['b', 'd'])
  selection.selectAll()
  assert.deepEqual([...selected], ['b', 'd'])
  filter([])
  selection.selectAll()
  assert.equal(selected.size, 0)
})
