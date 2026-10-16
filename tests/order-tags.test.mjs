import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeOrderTags,
  mergeOrderTags,
  orderTagColors,
  parseOrderTagInput,
  recommendedTagColors,
  reconcileTagCatalog,
  assignedTagNames,
  normalizeTags,
  renameTagData,
} from '../src/order-tags.js'
import { contrastRatio } from '../src/appearance.js'
import { createAnnotationAutosave } from '../src/annotation-autosave.js'
import { validatePackingPreferences } from '../src/packing-model.js'

test('renaming an order tag updates all assignments and history, preserves default colors and lifecycle, and leaves product tags alone', () => {
  const state = {
    definitions: [
      { name: 'Fragile', colors: {}, used: true },
      { name: 'Unused', colors: {} },
    ],
    orders: [
      {
        tags: ['Fragile'],
        notes: 'Keep',
        snapshot: { orderId: '1' },
        productTags: { 1: ['Fragile'] },
      },
      { tags: ['Other', 'Fragile'], snapshot: { orderId: '2' } },
    ],
    history: [
      { tags: ['Fragile'], snapshot: { orderId: '1', observedAt: 'old' } },
    ],
  }
  const before = structuredClone(state)
  const renamed = renameTagData(state, 'Fragile', ' Handle, carefully ')
  assert.equal(renamed.renamedAssignments, 2)
  assert.deepEqual(
    renamed.orders.map((record) => record.tags),
    [['Handle, carefully'], ['Other', 'Handle, carefully']]
  )
  assert.deepEqual(renamed.history[0].tags, ['Handle, carefully'])
  assert.deepEqual(renamed.orders[0].productTags, { 1: ['Fragile'] })
  assert.equal(renamed.orders[0].snapshot, state.orders[0].snapshot)
  assert.equal(renamed.orders[0].notes, 'Keep')
  const tag = renamed.definitions.find(
    (tag) => tag.name === 'Handle, carefully'
  )
  assert.equal(tag.used, true)
  assert.deepEqual(orderTagColors(tag), orderTagColors(state.definitions[0]))
  assert.equal(
    reconcileTagCatalog(renamed.definitions, []).some(
      (tag) => tag.name === 'Handle, carefully'
    ),
    false
  )
  assert.deepEqual(state, before)
})

test('product renaming is scoped per catalog, preserves explicit colors, and rejects duplicates without a merge', () => {
  const state = {
    definitions: [
      {
        name: 'Fragile',
        colors: { light: '#123456', dark: '#abcdef' },
        textColors: { dark: '#654321' },
        used: true,
      },
      { name: 'Keep', colors: {} },
    ],
    orders: [
      {
        tags: ['Fragile'],
        productTags: { 1: ['Fragile'], 2: ['Fragile', 'Keep'], 3: ['Other'] },
      },
    ],
    history: [{ tags: [], productTags: { 1: ['Fragile'], 5: ['Archived'] } }],
  }
  const before = structuredClone(state)
  const renamed = renameTagData(state, 'Fragile', 'Careful', 'product')
  assert.equal(renamed.renamedAssignments, 2)
  assert.deepEqual(renamed.orders[0].tags, ['Fragile'])
  assert.deepEqual(renamed.orders[0].productTags, {
    1: ['Careful'],
    2: ['Careful', 'Keep'],
    3: ['Other'],
  })
  assert.deepEqual(renamed.history[0].productTags, {
    1: ['Careful'],
    5: ['Archived'],
  })
  assert.deepEqual(
    orderTagColors(renamed.definitions[0]),
    orderTagColors(state.definitions[0])
  )
  for (const name of ['Keep', 'Other', 'Archived'])
    assert.throws(
      () => renameTagData(state, 'Fragile', name, 'product'),
      /already exists/
    )
  assert.throws(
    () => renameTagData(state, 'Fragile', '  ', 'product'),
    /Enter a tag name/
  )
  assert.throws(
    () => renameTagData(state, 'Deleted', 'New', 'product'),
    /no longer exists/
  )
  const unused = renameTagData(
    { definitions: [{ name: 'Waiting', colors: {} }] },
    'Waiting',
    'Later',
    'product'
  )
  assert.equal(unused.definitions[0].used, undefined)
  assert.deepEqual(
    reconcileTagCatalog(unused.definitions, [], { scope: 'product' }),
    unused.definitions
  )
  assert.deepEqual(state, before)
})

test('recommended tag colors are stable by name, varied and readable in both modes', () => {
  const backgrounds = new Set()
  for (const name of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
    const defaults = recommendedTagColors(name)
    assert.deepEqual(orderTagColors({ name }), defaults)
    backgrounds.add(defaults.light)
    for (const mode of ['light', 'dark'])
      assert.ok(contrastRatio(defaults[mode], defaults[`${mode}Text`]) >= 4.5)
  }
  assert.equal(backgrounds.size, 8)
})

test('choosing a shared tag containing a comma preserves its exact name', () => {
  assert.deepEqual(
    parseOrderTagInput('Display, upstairs', [
      { name: 'Display, upstairs', colors: {} },
    ]),
    ['Display, upstairs']
  )
  assert.deepEqual(parseOrderTagInput('New, Second', []), ['New', 'Second'])
})

test('legacy order tags keep their names and gain safe readable defaults', () => {
  const tags = mergeOrderTags(
    [{ name: 'Display', colors: { dark: '#010203' } }],
    ['Display', 'October', 'October']
  )
  assert.deepEqual(
    tags.map((entry) => entry.name),
    ['Display', 'October']
  )
  assert.equal(tags[0].colors.dark, '#010203')
  for (const entry of tags) {
    const colors = orderTagColors(entry)
    for (const mode of ['light', 'dark'])
      assert.ok(contrastRatio(colors[mode], colors[`${mode}Text`]) >= 4.5)
  }
  assert.throws(
    () => normalizeOrderTags([{ name: 'Bad', colors: { light: 'url(x)' } }]),
    /Invalid/
  )
  assert.throws(
    () => normalizeOrderTags([{ name: 'A' }, { name: 'A' }]),
    /already exists/
  )
})

test('manual tag text colors survive preference validation and independent mode reset', () => {
  const old = [{ name: 'Legacy', colors: { dark: '#123456' } }]
  assert.deepEqual(normalizeOrderTags(old), old)
  const input = {
    name: 'Display',
    colors: { light: '#301800', dark: '#ffcc88' },
    textColors: { light: '#FFEEDD', dark: '#543210' },
  }
  const [saved] = validatePackingPreferences({ orderTags: [input] }).orderTags
  assert.deepEqual(saved.textColors, { light: '#ffeedd', dark: '#543210' })
  assert.equal(orderTagColors(saved).lightText, '#ffeedd')
  assert.equal(orderTagColors(saved).darkText, '#543210')
  delete saved.textColors.dark
  const reset = normalizeOrderTags([saved])[0]
  assert.equal(orderTagColors(reset).darkText, '#000000')
  assert.equal(orderTagColors(reset).lightText, '#ffeedd')
  assert.equal(reset.colors.dark, '#ffcc88')
  assert.throws(
    () =>
      normalizeOrderTags([
        { name: 'Bad text', textColors: { light: 'red; url(x)' } },
      ]),
    /Invalid light text color/
  )
})

test('a Settings-only tag persists until first use, then expires after its last assignment', () => {
  const created = [{ name: 'Waiting', colors: { light: '#123456' } }]
  assert.deepEqual(reconcileTagCatalog(created, []), created)
  const used = reconcileTagCatalog(created, ['Waiting', 'Waiting'])
  assert.equal(used[0].used, true)
  assert.deepEqual(used[0].colors, created[0].colors)
  assert.deepEqual(reconcileTagCatalog(used, ['Waiting']), used)
  assert.deepEqual(reconcileTagCatalog(used, []), [])
  assert.deepEqual(
    reconcileTagCatalog(created, [], { previousNames: ['Waiting'] }),
    []
  )
  assert.deepEqual(reconcileTagCatalog([], [], { previous: created }), created)
  assert.deepEqual(reconcileTagCatalog(used, [], { previous: [] }), [])
  assert.deepEqual(created, [{ name: 'Waiting', colors: { light: '#123456' } }])
})

test('order and product catalogs share validation and lifecycle without sharing assignments', () => {
  const records = [
    {
      tags: ['Order only'],
      productTags: { 1: ['Product only'], 2: ['Product only', 'Other'] },
    },
    { tags: ['Other'] },
  ]
  assert.deepEqual(assignedTagNames(records), ['Order only', 'Other'])
  assert.deepEqual(assignedTagNames(records, 'product'), [
    'Product only',
    'Product only',
    'Other',
  ])
  const productTags = reconcileTagCatalog(
    [{ name: 'Unused', colors: {} }],
    assignedTagNames(records, 'product'),
    { scope: 'product' }
  )
  const saved = validatePackingPreferences({ productTags })
  assert.deepEqual(saved.productTags, productTags)
  assert.equal(saved.orderTags, undefined)
  assert.deepEqual(
    productTags.map(({ name, used }) => [name, Boolean(used)]),
    [
      ['Unused', false],
      ['Product only', true],
      ['Other', true],
    ]
  )
  assert.throws(
    () => normalizeTags([{ name: 'Bad', used: 'yes' }], 'product'),
    /usage/
  )
})

test('stale settings preserve concurrent definitions and cannot revive a used zero-assignment tag', () => {
  const previous = [
    { name: 'Concurrent', colors: { dark: '#123456' }, used: true },
  ]
  const draft = [
    { name: 'Retired', colors: { light: '#654321' }, used: true },
    { name: 'New in settings', colors: {} },
  ]
  const reconciled = reconcileTagCatalog(draft, ['Concurrent'], { previous })
  assert.deepEqual(reconciled, [draft[1], previous[0]])
  const baseline = [{ name: 'Initially unused', colors: {} }]
  assert.deepEqual(
    reconcileTagCatalog(baseline, [], { previous: [], baseline }),
    []
  )
  assert.deepEqual(
    reconcileTagCatalog(baseline, [], { previous: [], baseline: [] }),
    baseline
  )
})

test('autosave serializes requests and saves newer typing after an in-flight older draft', async () => {
  let finish
  const writes = [],
    states = []
  const saver = createAnnotationAutosave({
    initial: { notes: '', tags: [] },
    delay: 10000,
    write: async (value) => {
      writes.push(value)
      if (writes.length === 1)
        await new Promise((resolve) => {
          finish = resolve
        })
    },
    onState: (state) => states.push(state),
  })
  saver.update({ notes: 'first', tags: ['Keep'] })
  const first = saver.flush()
  saver.update({ notes: 'newer typing', tags: ['Keep', 'New'] })
  const closing = saver.flush()
  assert.equal(writes.length, 1)
  finish()
  await Promise.all([first, closing])
  assert.deepEqual(
    writes.map((entry) => entry.notes),
    ['first', 'newer typing']
  )
  assert.equal(saver.dirty(), false)
  assert.equal(states.at(-1), 'saved')
})

test('failed saves retain the latest draft and a retry persists it', async () => {
  let failed = true
  const writes = [],
    states = []
  const saver = createAnnotationAutosave({
    initial: { notes: '', tags: [] },
    delay: 10000,
    write: async (value) => {
      if (failed) throw new Error('disk failed')
      writes.push(value)
    },
    onState: (state) => states.push(state),
  })
  saver.update({ notes: 'keep this', tags: ['New tag'] })
  await assert.rejects(saver.flush(), /disk failed/)
  assert.equal(saver.dirty(), true)
  assert.equal(states.at(-1), 'error')
  failed = false
  await saver.flush()
  assert.equal(writes[0].notes, 'keep this')
  assert.equal(saver.dirty(), false)
})

test('reverting a pending draft reports saved without an unnecessary write', async () => {
  const states = []
  const saver = createAnnotationAutosave({
    initial: { notes: 'original', tags: [] },
    delay: 10000,
    write: async () => assert.fail('unchanged values must not be written'),
    onState: (state) => states.push(state),
  })
  saver.update({ notes: 'temporary', tags: [] })
  saver.update({ notes: 'original', tags: [] })
  await saver.flush()
  assert.equal(states.at(-1), 'saved')
})

test('reverting during an in-flight save keeps exit protection until the original value is restored', async () => {
  let finish
  const writes = []
  const saver = createAnnotationAutosave({
    initial: { notes: 'original', tags: [] },
    delay: 10000,
    write: async (value) => {
      writes.push(value.notes)
      if (writes.length === 1)
        await new Promise((resolve) => {
          finish = resolve
        })
    },
  })
  saver.update({ notes: 'temporary', tags: [] })
  const saving = saver.flush()
  saver.update({ notes: 'original', tags: [] })
  assert.equal(saver.dirty(), true)
  finish()
  await saving
  assert.deepEqual(writes, ['temporary', 'original'])
  assert.equal(saver.dirty(), false)
  await saver.flush()
})
