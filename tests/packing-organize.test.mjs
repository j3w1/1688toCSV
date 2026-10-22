import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import {
  createOrganizeState,
  moveOrganizeKeys,
  mountPackingOrganizer,
  organizeGroupKey,
  organizeProductKey,
  organizeRemovalEntries,
} from '../src/packing-organize.js'

test('organizing moves adjacent selected blocks as blocks, retaining their order', () => {
  const keys = ['a', 'b', 'c', 'd', 'e']
  assert.deepEqual(moveOrganizeKeys(keys, new Set(['b', 'c']), -1), [
    'b',
    'c',
    'a',
    'd',
    'e',
  ])
  assert.deepEqual(moveOrganizeKeys(keys, new Set(['b', 'c']), 1), [
    'a',
    'd',
    'b',
    'c',
    'e',
  ])
  assert.deepEqual(moveOrganizeKeys(keys, new Set(['a', 'b']), -1), keys)
  assert.deepEqual(moveOrganizeKeys(keys, new Set(['d', 'e']), 1), keys)
  assert.deepEqual(keys, ['a', 'b', 'c', 'd', 'e'])
})

const fixtures = () =>
  ['one', 'two'].map((orderId) => {
    const draft = { orderId }
    return {
      key: organizeGroupKey(orderId, 'group'),
      orderId,
      groupId: 'group',
      draft,
      code: 'CE26101001',
      name: 'ADORNO',
      storeName: `Store ${orderId}`,
      quantity: 63,
      products: ['S', 'M', 'L'].map((variantId, index) => ({
        key: organizeProductKey(orderId, 'group', variantId),
        orderId,
        groupId: 'group',
        variantId,
        draft,
        code: `CE26101001${variantId}`,
        name: 'ADORNO',
        title: variantId,
        entryIds: [
          `${orderId}-${index}`,
          ...(index === 0 ? [`${orderId}-combined`] : []),
        ],
        quantity: index ? 30 : 3,
      })),
    }
  })

test('group selection resolves every scoped source row without merging linked purchase identity', () => {
  const groups = fixtures(),
    state = createOrganizeState()
  state.groups.add(groups[0].key)
  state.groups.add(groups[1].key)
  assert.deepEqual(
    organizeRemovalEntries(groups, state).map(({ draft, entryIds }) => [
      draft.orderId,
      entryIds,
    ]),
    [
      ['one', ['one-0', 'one-combined', 'one-1', 'one-2']],
      ['two', ['two-0', 'two-combined', 'two-1', 'two-2']],
    ]
  )
  assert.notEqual(groups[0].key, groups[1].key)
})

test('product selection applies only to the chosen group and remains independent of group and export selection', () => {
  const groups = fixtures(),
    state = createOrganizeState()
  const exports = new Set(['unchanged-export-selection'])
  state.mode = 'products'
  state.groupKey = groups[0].key
  state.groups.add(groups[1].key)
  state.products.add(groups[0].products[0].key)
  state.products.add(groups[1].products[0].key)
  assert.deepEqual(
    organizeRemovalEntries(groups, state).map(({ draft, entryIds }) => [
      draft.orderId,
      entryIds,
    ]),
    [['one', ['one-0', 'one-combined']]]
  )
  assert.deepEqual([...exports], ['unchanged-export-selection'])
  assert.equal(state.groups.size, 1)
})

function setup(t) {
  const globals = [
    'document',
    'ResizeObserver',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ]
  const before = Object.fromEntries(
    globals.map((name) => [name, globalThis[name]])
  )
  const { document, window } = parseHTML(
    '<html><body><main></main></body></html>'
  )
  globalThis.document = document
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.requestAnimationFrame = () => 1
  globalThis.cancelAnimationFrame = () => {}
  window.HTMLElement.prototype.getBoundingClientRect = () => ({
    height: 64,
    top: 0,
    bottom: 64,
  })
  document.querySelector('main').scrollTop = 0
  function cleanup() {
    for (const name of globals) {
      if (before[name] === undefined) delete globalThis[name]
      else globalThis[name] = before[name]
    }
  }
  return { document, cleanup }
}

function mount(t, state, groups = fixtures()) {
  const { document, cleanup } = setup(t),
    calls = [],
    host = document.querySelector('main')
  const view = mountPackingOrganizer({
    host,
    groups,
    state,
    photo: () => assert.fail('no photos in synthetic fixture'),
    actionButton: (label, action) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.addEventListener('click', () => action())
      return button
    },
    actions: {
      mode: (mode) => calls.push(['mode', mode]),
      group: (key) => calls.push(['group', key]),
      remove: (entries) => calls.push(['remove', entries]),
      moveSelected: (direction) => calls.push(['move', direction]),
      drag: () => {},
      dragOrder: () => {},
      travel: () => {},
      done: () => {},
      arrange: () => {},
      forget: () => {},
    },
  })
  t.after(() => {
    view.destroy()
    cleanup()
  })
  return { document, view, calls }
}

test('Groups mounts only compact summaries, independent checkboxes and replacement toolbar', (t) => {
  const state = createOrganizeState()
  const { document, view } = mount(t, state)
  assert.equal(document.querySelectorAll('.packing-organize-group').length, 2)
  assert.equal(
    document.querySelectorAll(
      'table, .variants, .variant-scroll, .variant-carton-columns'
    ).length,
    0
  )
  assert.equal(document.querySelectorAll('[data-organize-select]').length, 2)
  assert.equal(document.querySelectorAll('.packing-organize-toolbar').length, 1)
  assert.equal(
    document
      .querySelector('[data-action="organize-groups"]')
      .getAttribute('aria-pressed'),
    'true'
  )
  view.selectAll()
  assert.equal(state.groups.size, 2)
  assert.equal(state.products.size, 0)
  assert.equal(
    document.querySelector('.packing-organize-count').textContent,
    '2 selected · 2 groups'
  )
  view.clear()
  assert.equal(state.groups.size, 0)
})

test('Products mounts only its chosen group and offers a searchable visual group picker without a select', (t) => {
  const state = createOrganizeState(),
    groups = fixtures()
  state.mode = 'products'
  state.groupKey = groups[1].key
  const { document, view, calls } = mount(t, state, groups)
  assert.equal(document.querySelectorAll('.packing-organize-product').length, 3)
  assert.equal(
    document.querySelectorAll('select, table, .variant-carton-columns').length,
    0
  )
  assert.equal(
    document.querySelector('[type="search"]').getAttribute('placeholder'),
    'Find group or store'
  )
  view.selectAll()
  document.querySelector('.packing-organize-remove').click()
  assert.deepEqual(
    calls[0][1].map(({ draft, entryIds }) => [draft.orderId, entryIds]),
    [['two', ['two-0', 'two-combined', 'two-1', 'two-2']]]
  )
})

test('movement controls have stable accessible names and respect selected-block boundaries', (t) => {
  const state = createOrganizeState()
  const [first] = fixtures()
  const second = {
    ...first,
    key: organizeGroupKey(first.orderId, 'second-group'),
    groupId: 'second-group',
  }
  const { document, calls } = mount(t, state, [first, second])
  const up = document.querySelector('[aria-label="Move up"]')
  const down = document.querySelector('[aria-label="Move down"]')
  assert.ok(up)
  assert.ok(down)
  assert.equal(up.querySelector('span').getAttribute('aria-hidden'), 'true')
  assert.equal(down.querySelector('span').getAttribute('aria-hidden'), 'true')
  assert.equal(up.disabled, true)
  assert.equal(down.disabled, true)
  const checkbox = document.querySelector('[data-organize-select]')
  checkbox.checked = true
  checkbox.dispatchEvent(new document.defaultView.Event('change'))
  assert.equal(up.disabled, true)
  assert.equal(down.disabled, false)
  down.click()
  assert.deepEqual(calls, [['move', 1]])
})

test('large group lists mount at most 100 cards while selecting and removing the entire logical scope', (t) => {
  const [template] = fixtures(),
    state = createOrganizeState()
  const groups = Array.from({ length: 450 }, (_, index) => ({
    ...template,
    key: organizeGroupKey('one', `g${index}`),
    groupId: `g${index}`,
    products: [
      {
        ...template.products[0],
        key: organizeProductKey('one', `g${index}`, 'S'),
        entryIds: [`entry${index}`],
      },
    ],
  }))
  const { document, view } = mount(t, state, groups)
  assert.ok(document.querySelectorAll('.packing-organize-card').length <= 100)
  view.selectAll()
  assert.equal(state.groups.size, 450)
  assert.equal(organizeRemovalEntries(groups, state)[0].entryIds.length, 450)
})
