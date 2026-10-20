import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPreparationHistory,
  preparationHistorySnapshot,
  restorePreparationHistory,
} from '../src/preparation-history.js'

const json = (name) => JSON.stringify({ groups: [{ spanishName: name }] })

test('measurement-only history retains exact patches and expected values in both directions', () => {
  const history = createPreparationHistory()
  const before = JSON.stringify({ 1: { kg: '20.5' } }),
    after = JSON.stringify({ 1: { kg: '25.125' } })
  history.recordBatch([
    {
      orderId: 'one',
      before: json('same'),
      after: json('same'),
      beforeCartons: before,
      afterCartons: after,
    },
  ])
  const undone = history.undo().changes[0]
  assert.deepEqual(undone.cartons, { 1: { kg: '20.5' } })
  assert.deepEqual(undone.expectedCartons, { 1: { kg: '25.125' } })
  const redone = history.redo().changes[0]
  assert.deepEqual(redone.cartons, { 1: { kg: '25.125' } })
  assert.deepEqual(redone.expectedCartons, { 1: { kg: '20.5' } })
  assert.ok(history.state().bytes >= 2 * (before.length + after.length))
})

test('removal scope remains undoable when saved preparation values do not change', () => {
  const history = createPreparationHistory()
  const before = json('same saved values')
  history.recordBatch([
    {
      orderId: 'one',
      before,
      after: before,
      beforeScope: '["1","2"]',
      afterScope: '["2"]',
    },
  ])
  assert.deepEqual(history.undo().changes[0].scope, ['1', '2'])
  assert.deepEqual(history.redo().changes[0].scope, ['2'])
})

test('consecutive typing coalesces and a group boundary preserves separate edits', () => {
  const history = createPreparationHistory()
  history.record('one', json(''), json('T'), 'name')
  history.record('one', json('T'), json('TA'), 'name')
  history.record('one', json('TA'), json('TAZA'), 'name')
  assert.equal(history.state().entries, 1)
  history.breakGroup()
  history.record('one', json('TAZA'), json('VASO'), 'name')
  assert.equal(history.state().entries, 2)
  assert.deepEqual(history.undo(), {
    orderId: 'one',
    value: JSON.parse(json('TAZA')),
  })
  assert.deepEqual(history.undo(), {
    orderId: 'one',
    value: JSON.parse(json('')),
  })
  assert.equal(history.undo(), null)
  assert.deepEqual(history.redo(), {
    orderId: 'one',
    value: JSON.parse(json('TAZA')),
  })
  assert.deepEqual(history.redo(), {
    orderId: 'one',
    value: JSON.parse(json('VASO')),
  })
  assert.equal(history.redo(), null)
})

test('order, field and disconnected snapshot changes do not merge', () => {
  const history = createPreparationHistory()
  history.record('one', json(''), json('A'), 'name')
  history.record('two', json(''), json('B'), 'name')
  history.record('two', json('B'), json('C'), 'category')
  history.record('two', json('outside change'), json('D'), 'category')
  history.record('two', json('D'), json('E'))
  history.record('two', json('E'), json('F'))
  assert.equal(history.state().entries, 6)
  assert.deepEqual(history.undo(), {
    orderId: 'two',
    value: JSON.parse(json('E')),
  })
  history.undo()
  history.undo()
  history.undo()
  assert.deepEqual(history.undo(), {
    orderId: 'two',
    value: JSON.parse(json('')),
  })
  assert.deepEqual(history.undo(), {
    orderId: 'one',
    value: JSON.parse(json('')),
  })
})

test('identical edits do not alter history and typing back to the original removes its step', () => {
  const history = createPreparationHistory()
  history.record('one', json(''), json('A'), 'name')
  const state = history.state()
  assert.equal(history.record('one', json('A'), json('A'), 'name'), false)
  assert.deepEqual(history.state(), state)
  history.record('one', json('A'), json(''), 'name')
  assert.deepEqual(history.state(), {
    canUndo: false,
    canRedo: false,
    entries: 0,
    bytes: 0,
  })
})

test('new changes discard redo, while a no-op after undo preserves it', () => {
  const history = createPreparationHistory()
  history.record('one', json(''), json('A'), 'name')
  history.record('two', json(''), json('B'), 'name')
  history.undo()
  const state = history.state()
  history.record('two', json(''), json(''), 'name')
  assert.deepEqual(history.state(), state)
  history.record('one', json('A'), json('C'), 'name')
  assert.equal(history.state().canRedo, false)
  assert.equal(history.state().entries, 2)
  assert.equal(history.redo(), null)
  assert.deepEqual(history.undo(), {
    orderId: 'one',
    value: JSON.parse(json('A')),
  })
})

test('returned drafts are independent and undo/redo end typing coalescence', () => {
  const history = createPreparationHistory()
  const before = json('')
  const after = json('A')
  history.record('one', before, after, 'name')
  history.undo().value.groups[0].spanishName = 'MUTATED'
  history.redo().value.groups[0].spanishName = 'MUTATED'
  history.record('one', after, json('B'), 'name')
  assert.equal(history.state().entries, 2)
  assert.deepEqual(history.undo(), { orderId: 'one', value: JSON.parse(after) })
  assert.deepEqual(history.undo(), {
    orderId: 'one',
    value: JSON.parse(before),
  })
  assert.deepEqual(history.redo(), { orderId: 'one', value: JSON.parse(after) })
  assert.equal(before, json(''))
  assert.equal(after, json('A'))
})

test('explicit reload clears an order and retains history for other orders', () => {
  const history = createPreparationHistory()
  history.record('one', json(''), json('A'))
  history.record('two', json(''), json('B'))
  history.record('one', json('A'), json('C'))
  history.record('three', json(''), json('D'))
  history.undo()
  history.undo()
  const before = history.state()
  history.clear('one')
  assert.equal(history.state().entries, 2)
  assert.ok(history.state().bytes < before.bytes)
  assert.deepEqual(history.redo(), {
    orderId: 'three',
    value: JSON.parse(json('D')),
  })
  history.undo()
  assert.deepEqual(history.undo(), {
    orderId: 'two',
    value: JSON.parse(json('')),
  })
  assert.equal(history.undo(), null)
  history.clear()
  assert.deepEqual(history.state(), {
    canUndo: false,
    canRedo: false,
    entries: 0,
    bytes: 0,
  })
  assert.equal(history.redo(), null)
})

test('saved revisions are ignored by history and restored from the current acknowledged draft', () => {
  const before = {
    accountId: 'buyer',
    orderId: 'one',
    revision: 1,
    updatedAt: '2026-10-16T00:00:00Z',
    groups: [{ id: 'group', category: 'old', variants: [{ id: 'variant' }] }],
  }
  const after = structuredClone(before)
  after.groups[0].category = 'new'
  const history = createPreparationHistory()
  history.record(
    'one',
    preparationHistorySnapshot(before),
    preparationHistorySnapshot(after)
  )
  const acknowledged = {
    ...after,
    revision: 8,
    updatedAt: '2026-10-16T01:00:00Z',
  }
  assert.equal(
    preparationHistorySnapshot(acknowledged),
    preparationHistorySnapshot(after)
  )
  const restored = restorePreparationHistory(history.undo().value, acknowledged)
  assert.equal(restored.revision, 8)
  assert.equal(restored.updatedAt, acknowledged.updatedAt)
  assert.deepEqual(restored.groups, before.groups)
  assert.equal(history.state().canRedo, true)
  assert.throws(() =>
    restorePreparationHistory(restored, { ...acknowledged, orderId: 'other' })
  )
  assert.throws(() =>
    restorePreparationHistory(restored, { ...acknowledged, accountId: 'other' })
  )
})

test('multi-order operations remain one reversible step and peek does not consume a failed write', () => {
  const history = createPreparationHistory()
  history.recordBatch([
    { orderId: 'one', before: json('A'), after: json('B') },
    { orderId: 'two', before: json('C'), after: json('D') },
  ])
  assert.equal(history.state().entries, 1)
  const undo = {
    changes: [
      { orderId: 'one', value: JSON.parse(json('A')) },
      { orderId: 'two', value: JSON.parse(json('C')) },
    ],
  }
  assert.deepEqual(history.peek('undo'), undo)
  assert.equal(history.state().canUndo, true)
  assert.deepEqual(history.undo(), undo)
  assert.equal(history.state().canUndo, false)
  assert.deepEqual(history.redo(), {
    changes: [
      { orderId: 'one', value: JSON.parse(json('B')) },
      { orderId: 'two', value: JSON.parse(json('D')) },
    ],
  })
  history.record('three', json('E'), json('F'))
  history.clear('one')
  assert.equal(history.state().entries, 1)
  assert.deepEqual(history.undo(), {
    orderId: 'three',
    value: JSON.parse(json('E')),
  })
})

test('a saved single-order operation retains its atomic persistence boundary', () => {
  const history = createPreparationHistory()
  history.recordBatch([
    { orderId: 'hidden', before: json('old rank'), after: json('new rank') },
  ])
  const before = {
    changes: [{ orderId: 'hidden', value: JSON.parse(json('old rank')) }],
  }
  const after = {
    changes: [{ orderId: 'hidden', value: JSON.parse(json('new rank')) }],
  }
  assert.deepEqual(history.peek('undo'), before)
  assert.deepEqual(history.undo(), before)
  assert.deepEqual(history.peek('redo'), after)
  assert.deepEqual(history.redo(), after)
})

test('batch history is bounded, ignores no-ops, and rejects repeated orders', () => {
  const history = createPreparationHistory({ maxEntries: 1 })
  history.record('one', json('A'), json('B'))
  assert.equal(
    history.recordBatch([
      { orderId: 'one', before: json('B'), after: json('B') },
    ]),
    false
  )
  assert.equal(history.state().entries, 1)
  assert.throws(
    () =>
      history.recordBatch([
        { orderId: 'one', before: json('A'), after: json('B') },
        { orderId: 'one', before: json('B'), after: json('C') },
      ]),
    TypeError
  )
  history.recordBatch([
    { orderId: 'two', before: json('C'), after: json('D') },
    { orderId: 'three', before: json('E'), after: json('F') },
  ])
  assert.equal(history.state().entries, 1)
  assert.equal(history.undo().changes.length, 2)
  assert.equal(history.undo(), null)
})

test('entry cap evicts oldest changes and counts the redo timeline too', () => {
  const history = createPreparationHistory({ maxEntries: 2 })
  history.record('one', json(''), json('A'))
  history.record('one', json('A'), json('B'))
  history.record('one', json('B'), json('C'))
  const { bytes } = history.state()
  assert.equal(history.state().entries, 2)
  assert.deepEqual(history.undo(), {
    orderId: 'one',
    value: JSON.parse(json('B')),
  })
  assert.deepEqual(history.undo(), {
    orderId: 'one',
    value: JSON.parse(json('A')),
  })
  assert.deepEqual(history.state(), {
    canUndo: false,
    canRedo: true,
    entries: 2,
    bytes,
  })
  assert.equal(history.undo(), null)
  history.redo()
  history.record('two', json(''), json('D'))
  assert.equal(history.state().entries, 2)
  assert.equal(history.redo(), null)
})

test('byte cap bounds growing typing groups and drops a change larger than the budget', () => {
  const history = createPreparationHistory({ maxBytes: 550 })
  history.record('one', json(''), json('A'))
  history.record('two', json(''), json('玻璃'.repeat(60)), 'name')
  assert.equal(history.state().entries, 2)
  history.record(
    'two',
    json('玻璃'.repeat(60)),
    json('玻璃'.repeat(80)),
    'name'
  )
  assert.equal(history.state().entries, 1)
  assert.ok(history.state().bytes <= 550)
  assert.deepEqual(history.undo(), {
    orderId: 'two',
    value: JSON.parse(json('')),
  })
  const undoState = history.state()
  history.redo()
  assert.equal(history.state().bytes, undoState.bytes)
  history.record('three', json(''), json('x'.repeat(1000)))
  assert.deepEqual(history.state(), {
    canUndo: false,
    canRedo: false,
    entries: 0,
    bytes: 0,
  })
})

test('zero limits disable retention and invalid bounds are rejected', () => {
  for (const options of [{ maxEntries: 0 }, { maxBytes: 0 }]) {
    const history = createPreparationHistory(options)
    history.record('one', json(''), json('A'))
    assert.equal(history.state().entries, 0)
    assert.equal(history.state().bytes, 0)
    assert.equal(history.undo(), null)
  }
  for (const limit of [-1, 1.5, NaN, Infinity]) {
    assert.throws(
      () => createPreparationHistory({ maxEntries: limit }),
      RangeError
    )
    assert.throws(
      () => createPreparationHistory({ maxBytes: limit }),
      RangeError
    )
  }
})
