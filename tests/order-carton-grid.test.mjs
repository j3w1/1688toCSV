import test from 'node:test'
import assert from 'node:assert/strict'
import { measurementWarningMessages } from '../src/ui-messages-smart-cartons.js'
import { message, getLanguage, setLanguage } from '../src/i18n.js'

test('measurement notices keep whole-set totals distinct from original supplied basis and translate without rounding', (context) => {
  const previous = getLanguage()
  context.after(() => setLanguage(previous, { persist: false }))
  setLanguage('en', { persist: false })
  const warning = Object.freeze({
      dimensionVolume: '0.480750000000000001',
      usedVolume: '0.480750000000000001',
      suppliedVolume: '0.84',
      suppliedCbm: '0.21',
      suppliedVolumeBasis: 'carton',
      count: 4,
    }),
    notices = measurementWarningMessages(warning, message)
  assert.match(
    String(notices[0]),
    /Measured volume 0\.480750000000000001 m³ is used/
  )
  assert.match(String(notices[0]), /supplied volume 0\.84 m³ remains recorded/)
  assert.match(String(notices[1]), /0\.21 m³ · Per carton · 4 cartons/)
  setLanguage('es', { persist: false })
  assert.match(String(notices[0]), /Se usa el volumen medido/)
  assert.match(String(notices[1]), /Por caja/)
  setLanguage('zh', { persist: false })
  assert.match(String(notices[0]), /采用实测体积/)
  assert.match(String(notices[1]), /每箱/)
  assert.equal(warning.suppliedCbm, '0.21')
})

test('an exception volume notice identifies the stable carton and inherited dimensions in every live language', (context) => {
  const previous = getLanguage()
  context.after(() => setLanguage(previous, { persist: false }))
  const warning = Object.freeze({
    unitIndex: 6,
    dimensionSource: 'set',
    dimensionVolume: '0.125000000000000001',
    usedVolume: '0.125000000000000001',
    suppliedVolume: '0.30',
    suppliedCbm: '0.30',
    suppliedVolumeBasis: 'carton',
    count: 1,
  })
  setLanguage('en', { persist: false })
  const notices = measurementWarningMessages(warning, message)
  assert.match(
    String(notices[0]),
    /0\.125000000000000001 m³ is used for carton 7/
  )
  assert.match(String(notices[0]), /supplied volume 0\.30 m³ remains recorded/)
  assert.match(String(notices[1]), /0\.30 m³ · Per carton · 1 cartons/)
  assert.match(String(notices[2]), /Carton 7 inherits the set dimensions/)
  assert.match(String(notices[2]), /separately measured dimensions/)
  setLanguage('es', { persist: false })
  assert.match(String(notices[0]), /para la caja 7/)
  assert.match(String(notices[2]), /medidas individuales/)
  setLanguage('zh', { persist: false })
  assert.match(String(notices[0]), /第 7 箱采用实测体积/)
  assert.match(String(notices[2]), /单独测量的尺寸/)
  assert.equal(warning.suppliedCbm, '0.30')
  const ownDimensions = measurementWarningMessages(
    { ...warning, dimensionSource: 'unit' },
    message
  )
  assert.equal(ownDimensions.length, 2)
})

test('packing patterns never multiply aggregate totals and retain known uneven or shared references', () => {
  const aggregate = {
    entryId: 'a',
    pattern: [{ cartonId: 'batch', count: 4, quantity: '40', perCarton: null }],
    sharedReferences: [],
  }
  assert.match(formatOrderPackingPattern(aggregate), /40 pieces in 4 cartons/)
  assert.doesNotMatch(formatOrderPackingPattern(aggregate), /4 × 40/)
  const shared = {
    entryId: 'a',
    pattern: [
      {
        cartonId: 'shared',
        count: 1,
        quantity: '20',
        perCarton: '20',
        shared: true,
      },
    ],
    sharedReferences: [
      { id: 'shared', cartonNumber: '12', quantity: '20', totalPieces: '92' },
    ],
  }
  assert.match(
    formatOrderPackingPattern(shared),
    /20 of this product · 92 total in shared 12/
  )
  const uneven = {
      entryId: 'a',
      pattern: [{ cartonId: 'set', count: 2, quantity: '25', perCarton: null }],
    },
    batch = {
      id: 'set',
      orderId: 'o',
      count: 2,
      packingBasis: 'aggregate',
      contents: [{ orderId: 'o', entryId: 'a', quantity: '25' }],
      unitContents: {
        0: [{ orderId: 'o', entryId: 'a', quantity: '13' }],
        1: [{ orderId: 'o', entryId: 'a', quantity: '12' }],
      },
      weight: '',
      len: '',
      wid: '',
      ht: '',
    }
  const pattern = formatOrderPackingPattern(uneven, [batch])
  assert.match(pattern, /13 pieces in/)
  assert.match(pattern, /12 pieces in/)
  assert.doesNotMatch(pattern, /unknown|2 × 25/)
})
import {
  formatOrderPackingPattern,
  captureGridTarget,
  assertGridTarget,
  parseGridCells,
  planGridPaste,
  planGridFill,
  nextGridCell,
  createGridDraftController,
  createOrderCartonSession,
  sourceKey,
  PRODUCT_GRID_COLUMNS,
  CARTON_GRID_COLUMNS,
} from '../src/order-carton-grid.js'
import * as planner from '../src/carton-reconciliation.js'
import {
  syntheticOrder,
  syntheticBatch,
} from './fixtures/container-fixture.mjs'

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

test('positive whole capacities normalize leading zeros while retaining the pasted source and refusing zero/exponent values', async () => {
  const { rows, target } = fixture(3),
    plan = await planGridPaste('010\n00012\n1', target, { rows })
  assert.equal(plan.valid, true)
  assert.deepEqual(
    plan.changes.map((change) => change.value),
    ['10', '12', '1']
  )
  assert.deepEqual(
    plan.changes.map((change) => change.raw),
    ['010', '00012', '1']
  )
  const invalid = await planGridPaste('00\n-1\n1e2', target, { rows })
  assert.equal(invalid.valid, false)
  assert.equal(invalid.errors.length, 3)
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
  const zero = await planGridPaste('60x50x40\t0\t0', target, { rows })
  assert.equal(zero.valid, true)
  assert.equal(zero.changes[1].value, '0')
  assert.equal(zero.changes[2].value, '0')
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

function focusedCartonFixture(weight) {
  const batch = syntheticBatch(ref.orderId, 1, '100', { weight }),
    context = {
      record: syntheticOrder(ref.orderId),
      preparation: { groups: [] },
      batches: [batch],
      reports: [],
      draft: null,
      revisions: { source: 'source-1', cartons: { [batch.id]: 1 } },
    },
    drafts = [],
    confirmations = []
  let draftRevision = 0
  const repository = {
    getOrderReconciliation: async () => structuredClone(context),
    async saveOrderCartonDraft(input) {
      assert.equal(input.expectedRevision, draftRevision)
      drafts.push(structuredClone(input))
      context.draft = {
        revision: ++draftRevision,
        value: structuredClone(input.draft),
      }
      return { revision: draftRevision }
    },
    async confirmOrderCartons(input) {
      confirmations.push(structuredClone(input))
      assert.deepEqual(
        input.expectedRevisions,
        context.revisions,
        'The carton changed in another tab'
      )
      for (const override of input.draft.cartons) {
        assert.equal(override.baseRevision, context.batches[0].revision)
        context.batches[0] = {
          ...context.batches[0],
          ...structuredClone(override),
          revision: context.batches[0].revision + 1,
        }
        context.revisions.cartons[batch.id] = context.batches[0].revision
      }
      context.draft = { revision: ++draftRevision, value: {} }
    },
  }
  return {
    context,
    drafts,
    confirmations,
    key: batch.id,
    async create(testContext) {
      const session = await createOrderCartonSession({
        repository,
        orderRef: ref,
        planner,
      })
      testContext.after(() => session.dispose())
      return session
    },
    foreignWeight(value) {
      context.batches[0].weight = value
      context.batches[0].revision++
      context.revisions.cartons[batch.id] = context.batches[0].revision
    },
  }
}

for (const baseline of ['', '2.5'])
  test(`a focused unedited carton weight (${JSON.stringify(baseline)}) writes nothing on foreign refresh, blur or Confirm`, async (t) => {
    const fixture = focusedCartonFixture(baseline),
      session = await fixture.create(t)
    session.setActiveCell(fixture.key, 'weight', baseline)
    await session.flush()
    const draftCount = fixture.drafts.length
    fixture.foreignWeight('3.125')
    const foreign = structuredClone(fixture.context)
    await session.refresh()
    assert.equal(session.rawCell(fixture.key, 'weight'), '3.125')
    assert.equal(fixture.drafts.length, draftCount)
    await session.commitCell(fixture.key, 'weight', baseline)
    assert.equal(fixture.drafts.length, draftCount)
    assert.deepEqual(session.state().rawCells, {})
    assert.equal(session.state().canUndo, false)
    await session.confirm()
    assert.equal(fixture.confirmations.length, 0)
    assert.equal(fixture.drafts.length, draftCount)
    assert.deepEqual(fixture.context, foreign)
  })

for (const value of ['', '2.5', '0', '12.500000000000000001'])
  test(`an explicit raw carton edit (${JSON.stringify(value)}) after a clean foreign refresh keeps exact values and current revisions`, async (t) => {
    const fixture = focusedCartonFixture('2.5'),
      session = await fixture.create(t)
    session.setActiveCell(fixture.key, 'weight', '2.5')
    await session.flush()
    fixture.foreignWeight('3.125')
    const source = structuredClone(fixture.context.record.snapshot)
    await session.refresh()
    session.editCell(fixture.key, 'weight', value)
    await session.commitCell(fixture.key, 'weight', value)
    assert.equal(
      session.state().rawCells[JSON.stringify([fixture.key, 'weight'])],
      value
    )
    assert.equal(fixture.confirmations.length, 0)
    const staged = fixture.drafts.at(-1).draft.plannerDraft.cartons[0]
    assert.equal(staged.weight, value || null)
    assert.equal(staged.baseRevision, 2)
    await session.confirm()
    assert.equal(fixture.confirmations.length, 1)
    assert.equal(
      fixture.confirmations[0].expectedRevisions.cartons[fixture.key],
      2
    )
    assert.equal(fixture.context.batches[0].weight, value || null)
    assert.equal(fixture.context.batches[0].revision, 3)
    assert.deepEqual(fixture.context.record.snapshot, source)
    assert.deepEqual(session.state().rawCells, {})
  })

test('a clean session still confirms outstanding capacity proposals', async (t) => {
  const fixture = focusedCartonFixture('')
  fixture.context.batches = []
  fixture.context.record.unitsPerCarton = { 2001: '50' }
  const session = await fixture.create(t)
  assert.deepEqual(session.state().rawCells, {})
  assert.equal(session.projection().proposals[0].count, 2)
  await session.confirm()
  assert.equal(fixture.confirmations.length, 1)
})

test('a dirty raw carton edit survives a foreign refresh and retains its original revision guard', async (t) => {
  const fixture = focusedCartonFixture('2.5'),
    session = await fixture.create(t),
    encoded = JSON.stringify([fixture.key, 'weight'])
  session.setActiveCell(fixture.key, 'weight', '2.5')
  session.editCell(fixture.key, 'weight', '12..')
  await assert.rejects(session.flush(), /nonnegative decimal/)
  fixture.foreignWeight('3.125')
  const foreign = structuredClone(fixture.context.batches)
  await session.refresh()
  assert.equal(session.rawCell(fixture.key, 'weight'), '12..')
  assert.equal(session.state().rawCells[encoded], '12..')
  await assert.rejects(
    session.commitCell(fixture.key, 'weight', '12..'),
    /nonnegative decimal/
  )
  const corrected = '12.500000000000000001'
  session.editCell(fixture.key, 'weight', corrected)
  await session.commitCell(fixture.key, 'weight', corrected)
  assert.equal(
    fixture.drafts.at(-1).draft.plannerDraft.cartons[0].baseRevision,
    1
  )
  await assert.rejects(session.confirm(), /changed in another tab/)
  assert.equal(
    fixture.confirmations[0].expectedRevisions.cartons[fixture.key],
    1
  )
  assert.deepEqual(fixture.context.batches, foreign)
  assert.equal(session.state().rawCells[encoded], corrected)
})
