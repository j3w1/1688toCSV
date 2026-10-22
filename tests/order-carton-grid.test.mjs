import test from 'node:test'
import assert from 'node:assert/strict'
import {
  captureGridTarget,
  assertGridTarget,
  parseGridCells,
  planGridPaste,
  planGridFill,
  nextGridCell,
  createGridDraftController,
  sourceKey,
  PRODUCT_GRID_COLUMNS,
  CARTON_GRID_COLUMNS,
} from '../src/order-carton-grid.js'

const ref = { accountId: 'local', orderId: '10001' }
function fixture(count = 140) {
  const rows = Array.from({ length: count }, (_, index) => ({
    key: sourceKey({ ...ref, entryId: `e${index}` }),
    code: `CE260901${String(index).padStart(2, '0')}`,
    capacity: null,
    purchased: '100',
  }))
  const keys = rows.map((row) => row.key)
  const target = captureGridTarget({
    orderRef: ref,
    generation: 0,
    viewVersion: 0,
    visibleKeys: keys,
    selectedKeys: keys,
    columns: PRODUCT_GRID_COLUMNS,
    anchorKey: keys[0],
    anchorColumn: 'capacity',
  })
  return { rows, keys, target }
}

test('one-column paste aligns selected visible logical keys beyond mounted rows', async () => {
  const { rows, keys, target } = fixture()
  const plan = await planGridPaste(
    Array.from({ length: 140 }, (_, index) => String(index + 1)).join('\n'),
    target,
    { rows }
  )
  assert.equal(plan.valid, true)
  assert.equal(plan.changes.length, 140)
  assert.deepEqual(
    plan.changes.map((change) => change.key),
    keys
  )
  assert.equal(plan.changes.at(-1).value, '140')
})

test('single-column target excludes hidden selected keys and preserves visible sort order', async () => {
  const { rows, keys, target } = fixture(5)
  target.visibleKeys = [keys[4], keys[2]]
  target.selectedKeys = [keys[4], keys[2]]
  const plan = await planGridPaste('45\n30', target, { rows })
  assert.equal(plan.valid, true)
  assert.deepEqual(
    plan.changes.map(({ key, value }) => ({ key, value })),
    [
      { key: keys[4], value: '45' },
      { key: keys[2], value: '30' },
    ]
  )
  assert.ok(
    !plan.changes.some((change) =>
      [keys[0], keys[1], keys[3]].includes(change.key)
    )
  )
})

test('keyed paste follows source codes rather than row order', async () => {
  const { rows, target } = fixture(3)
  target.keyed = true
  const plan = await planGridPaste(
    `${rows[2].code}\t45\n${rows[0].code}\t50`,
    target,
    { rows }
  )
  assert.equal(plan.valid, true)
  assert.deepEqual(
    plan.changes.map((change) => change.key),
    [rows[2].key, rows[0].key]
  )
})

test('ambiguous, duplicate and foreign codes invalidate the entire paste without losing raw cells', async () => {
  const { rows, target } = fixture(3)
  target.keyed = true
  rows[1].code = rows[0].code
  const text = `${rows[0].code}\t45\nUNKNOWN\tnope\n${rows[2].code}\t30\n${rows[2].code}\t40`
  const plan = await planGridPaste(text, target, { rows })
  assert.equal(plan.valid, false)
  assert.equal(plan.text, text)
  assert.equal(plan.cells.length, 4)
  assert.ok(
    plan.errors.some((error) => error.message.includes('more than one'))
  )
  assert.ok(plan.errors.some((error) => error.message.includes('not in')))
  assert.ok(plan.errors.some((error) => error.message.includes('twice')))
})

test('a rectangle cannot write derived totals', async () => {
  const { rows, target } = fixture(2)
  const plan = await planGridPaste('45\t999\n50\t888', target, { rows })
  assert.equal(plan.valid, false)
  assert.equal(plan.changes.length, 4)
  assert.equal(
    plan.errors.filter(
      (error) => error.message === 'Derived values are read-only.'
    ).length,
    2
  )
})

test('dimensions fill is explicit and never supplies a weight', () => {
  const { rows, target } = fixture(3)
  target.columns = CARTON_GRID_COLUMNS
  const plan = planGridFill(rows, target, 'dimensions', '60×50×40')
  assert.equal(plan.changes.length, 3)
  for (const change of plan.changes) {
    assert.deepEqual(change.value, { len: '60', wid: '50', ht: '40' })
    assert.equal(change.column, 'dimensions')
    assert.equal(Object.hasOwn(change.value, 'weight'), false)
  }
  assert.throws(
    () => planGridFill(rows, target, 'contents', '100'),
    /read-only/
  )
})

test('native tabular quoted cells and CRLF retain source text without a formula engine', async () => {
  assert.deepEqual(
    await parseGridCells(
      '"a\tb"\t"source\nline"\r\n"quote ""kept"""\t=SUM(A1)\r\n'
    ),
    [
      ['a\tb', 'source\nline'],
      ['quote "kept"', '=SUM(A1)'],
    ]
  )
  assert.rejects(parseGridCells('a\tb\nc'), /complete rectangle/)
})

test('dimension and numeric validation preserve exact decimals and reject partial or negative evidence', async () => {
  const { rows, target } = fixture(1)
  target.columns = CARTON_GRID_COLUMNS
  target.anchorColumn = 'dimensions'
  const valid = await planGridPaste('60x50x40\t16,750\t0.120000', target, {
    rows,
  })
  assert.equal(valid.valid, true)
  assert.equal(valid.changes[1].value, '16.750')
  assert.equal(valid.changes[2].value, '0.120000')
  const invalid = await planGridPaste('60x50\t-1\tguess', target, { rows })
  assert.equal(invalid.valid, false)
  assert.equal(invalid.errors.length, 3)
})

test('changed view, sort, generation or order invalidates a captured target', () => {
  const { target } = fixture(3)
  for (const current of [
    { ...target, viewVersion: 1 },
    { ...target, generation: 1 },
    { ...target, visibleKeys: [...target.visibleKeys].reverse() },
    { ...target, orderRef: { ...ref, orderId: '20002' } },
  ])
    assert.throws(() => assertGridTarget(target, current), /target changed/)
})

test('Tab and Enter navigate logical keys across virtual boundaries and skip derived columns', () => {
  const { keys } = fixture(140)
  assert.deepEqual(
    nextGridCell(keys, PRODUCT_GRID_COLUMNS, keys[99], 'capacity', {
      key: 'Tab',
    }),
    { key: keys[100], column: 'capacity' }
  )
  assert.deepEqual(
    nextGridCell(keys, PRODUCT_GRID_COLUMNS, keys[99], 'capacity', {
      key: 'Enter',
      shiftKey: true,
    }),
    { key: keys[98], column: 'capacity' }
  )
  assert.equal(
    nextGridCell(keys, PRODUCT_GRID_COLUMNS, keys[139], 'capacity', {
      key: 'Tab',
    }),
    null
  )
})

test('invalid paste is durable recovery data and never becomes facts', async () => {
  const { rows, target } = fixture(2),
    writes = []
  const draft = createGridDraftController({
    persist: async (value) => writes.push(value),
  })
  const plan = await draft.parse('45\ninvalid', target, { rows })
  assert.equal(draft.apply(plan, target), false)
  await draft.flush()
  assert.equal(writes.length, 1)
  assert.deepEqual(Object.values(writes[0].rawCells), ['45', 'invalid'])
  assert.equal(writes[0].history.length, 1)
  const restored = createGridDraftController({
    draft: writes[0],
    persist: async () => {},
  })
  assert.deepEqual(restored.state().rawCells, draft.state().rawCells)
  assert.equal(restored.undo(), true)
  assert.deepEqual(Object.values(restored.state().rawCells), ['', ''])
  assert.equal(restored.redo(), true)
  assert.deepEqual(Object.values(restored.state().rawCells), ['45', 'invalid'])
})

test('a successful bulk paste is one compound Undo/Redo operation', async () => {
  const { rows, target } = fixture(140),
    draft = createGridDraftController({ persist: async () => {} })
  const plan = await draft.parse(Array(140).fill('45').join('\n'), target, {
    rows,
  })
  assert.equal(draft.apply(plan, target), true)
  assert.equal(draft.state().history.length, 1)
  draft.undo()
  assert.equal(
    Object.values(draft.state().rawCells).filter((value) => value !== '')
      .length,
    0
  )
  draft.redo()
  assert.equal(Object.keys(draft.state().rawCells).length, 140)
})

test('late parsing cannot replace newer edits and cancellation releases work', async () => {
  const { rows, target } = fixture(2),
    draft = createGridDraftController({ persist: async () => {} })
  let release
  const parsing = draft.parse('45\n30', target, {
    rows,
    yieldWork: () =>
      new Promise((resolve) => {
        release = resolve
      }),
  })
  draft.edit({ cell: 'newer' })
  release()
  await assert.rejects(parsing, { name: 'AbortError' })
  assert.equal(draft.state().rawCells.cell, 'newer')
})

test('a late save acknowledgement never replaces newer raw input and flush persists the new generation', async () => {
  let release
  const writes = []
  const draft = createGridDraftController({
    persist: async (value) => {
      writes.push(value)
      if (writes.length === 1)
        await new Promise((resolve) => {
          release = resolve
        })
    },
  })
  draft.edit({ cell: '45' })
  const saving = draft.flush()
  draft.edit({ cell: 'invalid-newer' })
  release()
  await saving
  assert.equal(writes.length, 2)
  assert.equal(writes[0].rawCells.cell, '45')
  assert.equal(writes[1].rawCells.cell, 'invalid-newer')
  assert.equal(draft.state().rawCells.cell, 'invalid-newer')
})

test('failed recovery write retains raw cells and supports a deliberate retry', async () => {
  let reject = true
  const draft = createGridDraftController({
    persist: async () => {
      if (reject) throw new Error('synthetic write failure')
    },
  })
  draft.edit({ cell: 'invalid' })
  await assert.rejects(draft.flush(), /synthetic write failure/)
  assert.equal(draft.state().rawCells.cell, 'invalid')
  reject = false
  await draft.flush()
  assert.equal(draft.status().error, null)
})
