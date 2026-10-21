import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import {
  openCartonBatchEditor,
  cartonBatchProposals,
} from '../src/carton-batches-ui.js'
import { cartonBatchMetrics } from '../src/carton-batches.js'
import { setLanguage } from '../src/i18n.js'

const tick = () => new Promise((resolve) => setImmediate(resolve))
const scope = {
  accountId: 'local',
  storeId: 'supplier',
  month: '2026-10',
  baseCode: 'CE26101001',
  sellerName: 'Synthetic supplier',
  groups: [
    { orderId: 'purchase1', groupId: 'g1' },
    { orderId: 'purchase2', groupId: 'g2' },
  ],
  products: [
    {
      orderId: 'purchase1',
      entryId: 'small',
      groupId: 'g1',
      quantity: '3',
      barcode: 'CE26101001S',
      description: 'Small',
      unitsPerCarton: 1,
    },
    {
      orderId: 'purchase2',
      entryId: 'medium',
      groupId: 'g2',
      quantity: '30',
      barcode: 'CE26101001M',
      description: 'Medium',
      unitsPerCarton: 10,
    },
    {
      orderId: 'purchase2',
      entryId: 'large',
      groupId: 'g2',
      quantity: '30',
      barcode: 'CE26101001L',
      description: 'Large',
      unitsPerCarton: 11,
    },
  ],
}
function batch(overrides = {}) {
  return {
    id: 'batch1',
    accountId: 'local',
    storeId: 'supplier',
    month: '2026-10',
    groups: structuredClone(scope.groups),
    contents: scope.products.map(({ orderId, entryId, quantity }) => ({
      orderId,
      entryId,
      quantity,
    })),
    count: 6,
    len: '40',
    wid: '30',
    ht: '25',
    weightBasis: 'carton',
    weight: '9.54',
    suppliedCbm: '',
    received: null,
    loaded: null,
    revision: 4,
    updatedAt: '2026-10-20T00:00:00.000Z',
    ...overrides,
  }
}
function fixture(t, options = {}) {
  const { document, window } = parseHTML('<html><body></body></html>'),
    create = document.createElement.bind(document)
  class Dialog {}
  Dialog.prototype.closedBy = 'any'
  document.createElement = (tag, ...args) => {
    const element = create(tag, ...args)
    if (tag === 'dialog') {
      element.showModal = () => {
        element.open = true
      }
      element.close = () => {
        element.open = false
        element.dispatchEvent(new window.Event('close'))
      }
    }
    return element
  }
  for (const [key, value] of Object.entries({
    document,
    window,
    HTMLDialogElement: Dialog,
    Event: window.Event,
    MutationObserver: window.MutationObserver,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() =>
      previous
        ? Object.defineProperty(globalThis, key, previous)
        : delete globalThis[key]
    )
  }
  setLanguage('en', { persist: false })
  t.after(() => setLanguage('en', { persist: false }))
  const writes = [],
    removals = [],
    promise = openCartonBatchEditor({
      scope: structuredClone(scope),
      onSave: async (next, expected) => {
        writes.push({ next: structuredClone(next), expected })
        return { ...next, revision: next.revision + 1 }
      },
      onRemove: async (next, expected) => {
        removals.push({ next, expected })
        return { ...next, deletedAt: new Date().toISOString() }
      },
      ...options,
    }),
    dialog = promise.dialog,
    input = (key) => dialog.querySelector(`input[name="${key}"]`),
    change = (key, value) => {
      input(key).value = value
      input(key).dispatchEvent(new window.Event('input', { bubbles: true }))
    },
    button = (name) =>
      [...dialog.querySelectorAll('button')].find(
        (button) => button.textContent === name
      ),
    submit = async () => {
      dialog
        .querySelector('form')
        .dispatchEvent(
          new window.Event('submit', { bubbles: true, cancelable: true })
        )
      await tick()
    }
  t.after(() => {
    if (dialog.open) dialog.close()
  })
  return {
    promise,
    dialog,
    input,
    change,
    button,
    submit,
    writes,
    removals,
    window,
  }
}

test('a shared batch records source quantities and dimensions without inventing per-carton contents', async (t) => {
  const { promise, dialog, change, submit, writes, button } = fixture(t)
  assert.equal(
    dialog.querySelector('input[name="cbm"], details, summary'),
    null
  )
  assert.equal(
    dialog.querySelectorAll('.carton-batch-product[data-selected="true"]')
      .length,
    3
  )
  assert.equal(writes.length, 0)
  button('Batch').click()
  change('count', '6')
  change('len', '40')
  change('wid', '30')
  change('ht', '25')
  change('weight', '9,54')
  await promise.flush()
  assert.equal(writes.length, 0, 'new contents require Apply')
  await submit()
  assert.equal(writes.length, 1)
  const { next, expected } = writes[0],
    metrics = cartonBatchMetrics(next)
  assert.equal(next.count, 6)
  assert.equal(next.weight, '9.54')
  assert.deepEqual(
    next.contents.map((entry) => entry.quantity),
    ['3', '30', '30']
  )
  assert.deepEqual(expected, { expectedRevision: 0 })
  assert.equal(metrics.quantity, '63')
  assert.equal(metrics.totalVolume, '0.18')
  assert.equal(metrics.totalWeight, '57.24')
  assert.doesNotMatch(dialog.textContent, /10\.5/)
})

test('received zero and partial loading autosave independently without assuming partial batch weight', async (t) => {
  const original = batch({ weightBasis: 'batch', weight: '57.22' }),
    { promise, dialog, change, writes } = fixture(t, { batches: [original] })
  change('received', '0')
  change('loaded', '2')
  await promise.flush()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].next.received, 0)
  assert.equal(writes[0].next.loaded, 2)
  assert.equal(writes[0].next.count, 6)
  assert.equal(cartonBatchMetrics(writes[0].next).loadedWeight, '')
  assert.equal(cartonBatchMetrics(writes[0].next).receivedWeight, '0')
  assert.match(
    dialog.querySelector('.carton-batch-warning').textContent,
    /Partial loaded weight is unknown/
  )
})

test('allocation rejects too many pieces and retains the exact draft for correction', async (t) => {
  const { dialog, submit, writes, window } = fixture(t),
    quantity = dialog.querySelector(
      '[data-entry-id="small"] .carton-batch-quantity input'
    )
  quantity.value = '4'
  quantity.dispatchEvent(new window.Event('input', { bubbles: true }))
  await submit()
  assert.equal(writes.length, 0)
  assert.equal(quantity.value, '4')
  assert.equal(quantity.getAttribute('aria-invalid'), 'true')
  assert.match(
    dialog.querySelector('.carton-batch-status').textContent,
    /exceed/
  )
})

test('invalid carton counts identify the actual field and clear after correction', async (t) => {
  const { dialog, input, change, button, submit, writes } = fixture(t)
  button('Batch').click()
  assert.equal(input('count').hasAttribute('aria-invalid'), false)
  change('count', '1.5')
  await submit()
  assert.equal(writes.length, 0)
  assert.equal(input('count').value, '1.5')
  assert.equal(input('count').getAttribute('aria-invalid'), 'true')
  assert.equal(input('received').hasAttribute('aria-invalid'), false)
  assert.equal(input('loaded').hasAttribute('aria-invalid'), false)
  assert.match(
    dialog.querySelector('.carton-batch-status').textContent,
    /Carton counts must be whole numbers/
  )
  change('count', '6')
  assert.equal(input('count').hasAttribute('aria-invalid'), false)
  await submit()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].next.count, 6)
})

test('failed persistence preserves fields and expected revision through retry', async (t) => {
  const calls = []
  let fail = true
  const { promise, input, change, dialog } = fixture(t, {
    batches: [batch()],
    onSave: async (next, expected) => {
      calls.push({ next: structuredClone(next), expected })
      if (fail) throw new Error('Synthetic revision failure')
      return { ...next, revision: next.revision + 1 }
    },
  })
  change('weight', '1,23456789123456789')
  await assert.rejects(promise.flush(), /Synthetic revision failure/)
  assert.equal(input('weight').value, '1,23456789123456789')
  assert.equal(dialog.dataset.saveState, 'error')
  fail = false
  await promise.flush()
  assert.deepEqual(
    calls.map((call) => call.expected),
    [{ expectedRevision: 4 }, { expectedRevision: 4 }]
  )
  assert.equal(calls[1].next.weight, '1.23456789123456789')
  assert.equal(promise.dirty(), false)
})

test('separate proposals use exact known capacity and leave leftovers unconfirmed', () => {
  const proposals = cartonBatchProposals(scope, [])
  assert.deepEqual(
    proposals.map((entry) => entry.count),
    [3, 3, null]
  )
  assert.deepEqual(
    proposals.map((entry) => entry.contents[0].quantity),
    ['3', '30', '30']
  )
  assert.equal(new Set(proposals.map((entry) => entry.id)).size, 3)
  assert.deepEqual(
    proposals.map((entry) => entry.received),
    [null, null, null]
  )
})

test('reuse is limited to the same account and store and copies no counts or confirmations', async (t) => {
  const { promise, button, dialog, input, writes } = fixture(t, {
    batches: [
      batch(),
      batch({
        id: 'other-month',
        month: '2026-09',
        groups: [{ orderId: 'previous-purchase', groupId: 'previous-group' }],
        contents: [
          {
            orderId: 'previous-purchase',
            entryId: 'previous-product',
            quantity: '99',
          },
        ],
        len: '50',
        wid: '40',
        ht: '20',
        count: 99,
        received: 99,
        loaded: 99,
        weight: '11',
      }),
      batch({
        id: 'wrong-store',
        storeId: 'another',
        month: '2026-09',
        groups: [{ orderId: 'another-purchase', groupId: 'another-group' }],
        contents: [
          {
            orderId: 'another-purchase',
            entryId: 'another-product',
            quantity: '3',
          },
        ],
        len: '88',
      }),
    ],
  })
  button('Reuse measurements').click()
  const choices = [
    ...dialog.querySelectorAll('.carton-batch-reuse-list button'),
  ]
  assert.equal(choices.length, 1)
  choices[0].click()
  assert.equal(input('len').value, '50')
  assert.equal(input('count').value, '6')
  assert.equal(input('received').value, '')
  await promise.flush()
  assert.equal(writes[0].next.loaded, null)
  assert.equal(writes[0].next.count, 6)
})

test('switching batch cards retains incomplete measurement drafts and dismissal reviews unapplied proposals', async (t) => {
  const { dialog, input, change, button, writes } = fixture(t, {
    batches: [batch()],
  })
  change('len', '1,')
  button('New batch').click()
  await tick()
  dialog.querySelector('[data-batch-id="batch1"]').click()
  await tick()
  assert.equal(input('len').value, '1,')
  assert.equal(writes.length, 0)
  button('Done').click()
  await tick()
  assert.equal(dialog.open, true)
  assert.equal(dialog.querySelector('.carton-batch-dismissal').hidden, false)
  button('Discard unapplied changes').click()
  await tick()
  assert.equal(dialog.open, false)
})

test('removal requires an explicit review and preserves products rather than deleting purchases', async (t) => {
  const { promise, button, removals, dialog } = fixture(t, {
    batches: [batch()],
  })
  button('Remove batch').click()
  assert.equal(removals.length, 0)
  assert.match(
    dialog.querySelector('.carton-batch-status').textContent,
    /Products stay in packing/
  )
  button('Remove this batch?').click()
  await tick()
  assert.equal(removals.length, 1)
  assert.deepEqual(removals[0].expected, { expectedRevision: 4 })
  dialog.close()
  const result = await promise
  assert.ok(result.batches[0].deletedAt)
  assert.deepEqual(
    scope.products.map((entry) => entry.quantity),
    ['3', '30', '30']
  )
})

test('opening and dismissing an untouched initial proposal has no writes or discard prompt', async (t) => {
  const { promise, dialog, button, writes } = fixture(t)
  assert.equal(promise.dirty(), false)
  button('Done').click()
  await promise
  assert.equal(dialog.open, false)
  assert.equal(writes.length, 0)
})

test('Done queues behind an in-flight autosave and closes after its persisted result', async (t) => {
  let finish
  const { promise, dialog, button, change } = fixture(t, {
    batches: [batch()],
    onSave: (value) =>
      new Promise((resolve) => {
        finish = () => resolve({ ...value, revision: value.revision + 1 })
      }),
  })
  change('weight', '12.5')
  const saving = promise.flush()
  assert.equal(button('Done').disabled, false)
  button('Done').click()
  await tick()
  assert.equal(dialog.open, true)
  finish()
  await saving
  const result = await promise
  assert.equal(dialog.open, false)
  assert.equal(result.batches[0].weight, '12.5')
})

test('a reviewed old-month batch remains discoverable and read-only after its group vanishes, with removal releasing only its allocation', async (t) => {
  const prior = batch({
      month: '2026-09',
      groups: [{ orderId: 'purchase1', groupId: 'retired-group' }],
      needsReview: true,
      received: 6,
      loaded: 3,
    }),
    { promise, dialog, button, input, writes, removals } = fixture(t, {
      batches: [prior],
    })
  assert.equal(
    dialog
      .querySelector('.carton-batch-card[data-month="2026-09"]')
      .getAttribute('aria-current'),
    'true'
  )
  assert.equal(
    dialog.querySelector('.carton-batch-month').textContent,
    '2026-09'
  )
  assert.match(
    dialog.querySelector('.carton-batch-readonly-note').textContent,
    /2026-09.*read-only.*original month/
  )
  assert.equal(input('received').value, '6')
  assert.equal(input('loaded').value, '3')
  assert.ok(
    [
      ...dialog.querySelectorAll(
        '.carton-batch-editor input, .carton-batch-editor button'
      ),
    ].every((node) => node.disabled)
  )
  assert.equal(button('Apply carton contents').hidden, true)
  await promise.flush()
  assert.equal(writes.length, 0)
  button('Remove batch').click()
  button('Remove this batch?').click()
  await tick()
  assert.equal(removals.length, 1)
  assert.equal(removals[0].next.month, '2026-09')
  assert.equal(removals[0].next.received, 6)
  assert.equal(removals[0].next.loaded, 3)
  dialog.close()
  const result = await promise
  assert.equal(result.batches[0].month, '2026-09')
  assert.equal(result.batches[0].received, 6)
  assert.equal(result.batches[0].loaded, 3)
  assert.ok(result.batches[0].deletedAt)
})

test('same-month review requires explicit Apply before reanchoring to current groups and clearing the review flag', async (t) => {
  const previous = batch({
      groups: [{ orderId: 'purchase1', groupId: 'retired-group' }],
      needsReview: true,
      received: 6,
      loaded: 3,
    }),
    { promise, dialog, change, submit, writes } = fixture(t, {
      batches: [previous],
    })
  assert.equal(
    dialog.querySelector('.carton-batch-month').textContent,
    '2026-10'
  )
  assert.equal(dialog.querySelector('.carton-batch-readonly-note'), null)
  change('weight', '12,25')
  await promise.flush()
  assert.equal(
    writes.length,
    0,
    'reviewed batches never clear or rewrite context through autosave'
  )
  await submit()
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].next.groups, scope.groups)
  assert.equal(writes[0].next.needsReview, undefined)
  assert.equal(writes[0].next.weight, '12.25')
  assert.equal(writes[0].next.month, '2026-10')
  assert.equal(writes[0].next.received, 6)
  assert.equal(writes[0].next.loaded, 3)
  assert.equal(promise.dirty(), false)
  assert.equal(dialog.querySelector('.carton-batch-review'), null)
  assert.deepEqual(previous.groups, [
    { orderId: 'purchase1', groupId: 'retired-group' },
  ])
  assert.equal(previous.needsReview, true)
})

test('review correction retains missing contents until the user explicitly deselects them', async (t) => {
  const missing = {
      orderId: 'purchase1',
      entryId: 'retired-product',
      quantity: '2',
    },
    original = batch({
      needsReview: true,
      contents: [...batch().contents, missing],
    }),
    { promise, dialog, change, submit, writes, window } = fixture(t, {
      batches: [original],
    })
  const orphan = dialog.querySelector(
    '.carton-batch-missing input[type="checkbox"]'
  )
  assert.equal(orphan.checked, true)
  change('count', '7')
  await promise.flush()
  assert.equal(writes.length, 0)
  await submit()
  assert.equal(
    writes.length,
    0,
    'missing allocations cannot silently disappear during review'
  )
  assert.equal(orphan.checked, true)
  orphan.checked = false
  orphan.dispatchEvent(new window.Event('change', { bubbles: true }))
  await submit()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].next.needsReview, undefined)
  assert.equal(
    writes[0].next.contents.some((entry) => entry.entryId === missing.entryId),
    false
  )
  assert.equal(original.contents.at(-1).entryId, missing.entryId)
})

function crossCodeScope() {
  return {
    ...structuredClone(scope),
    groups: [
      { orderId: 'purchase1', groupId: 'g1', baseCode: 'CE26101001' },
      { orderId: 'purchase1', groupId: 'g3', baseCode: 'CE26101002' },
    ],
    mark: { orderId: 'purchase1', groupId: 'g1' },
    initialGroupRefs: [{ orderId: 'purchase1', groupId: 'g1' }],
    products: [
      structuredClone(scope.products[0]),
      {
        orderId: 'purchase1',
        entryId: 'other-code',
        groupId: 'g3',
        quantity: '10',
        barcode: 'CE26101002A',
        description: 'Another code',
        thumbnail: 'data:image/png;base64,AA==',
      },
    ],
  }
}

test('exact cartons default to one numbered carton and support explicit cross-code contents and an independent actual mark', async (t) => {
  const extended = crossCodeScope(),
    { promise, dialog, input, change, submit, writes, window } = fixture(t, {
      scope: extended,
      loadPhoto: async (value) => value,
    })
  assert.equal(input('cartonNumber').value, '1')
  assert.equal(input('count').value, '1')
  assert.equal(input('count').disabled, true)
  const first = dialog.querySelector('[data-entry-id="small"]'),
    other = dialog.querySelector('[data-entry-id="other-code"]')
  assert.equal(first.querySelector('input[type="checkbox"]').checked, true)
  assert.equal(other.querySelector('input[type="checkbox"]').checked, false)
  assert.equal(
    other.querySelector('.photo-copy-tile .photo-copy-button').closest('label'),
    null
  )
  assert.ok(other.querySelector('.photo-copy-tile .photo-copy-source img'))
  first.querySelector('.carton-batch-quantity input').value = '2'
  first
    .querySelector('.carton-batch-quantity input')
    .dispatchEvent(new window.Event('input', { bubbles: true }))
  const otherChoice = other.querySelector('input[type="checkbox"]')
  otherChoice.checked = true
  otherChoice.dispatchEvent(new window.Event('change', { bubbles: true }))
  other.querySelector('.carton-batch-quantity input').value = '5'
  other
    .querySelector('.carton-batch-quantity input')
    .dispatchEvent(new window.Event('input', { bubbles: true }))
  dialog.querySelector('[data-mark-group="g3"]').click()
  change('cartonNumber', 'A-01')
  await promise.flush()
  assert.equal(writes.length, 0)
  await submit()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].next.cartonNumber, 'A-01')
  assert.equal(writes[0].next.count, 1)
  assert.deepEqual(writes[0].next.mark, { orderId: 'purchase1', groupId: 'g3' })
  assert.deepEqual(writes[0].next.groups, [
    { orderId: 'purchase1', groupId: 'g1' },
    { orderId: 'purchase1', groupId: 'g3' },
  ])
  assert.deepEqual(
    writes[0].next.contents.map((entry) => entry.quantity),
    ['2', '5']
  )
  assert.match(
    dialog.querySelector('.carton-batch-summary').textContent,
    /Carton volume/
  )
  assert.doesNotMatch(
    dialog.querySelector('.carton-batch-summary').textContent,
    /Batch volume|average/i
  )
})

test('Another carton keeps dimensions and mark, with fresh numbered count, contents, weight and confirmations', async (t) => {
  const { dialog, input, change, button, submit, writes, window } = fixture(t, {
    scope: crossCodeScope(),
    loadPhoto: async (value) => value,
  })
  dialog.querySelector('[data-mark-group="g3"]').click()
  const quantity = dialog.querySelector(
    '[data-entry-id="small"] .carton-batch-quantity input'
  )
  quantity.value = '1'
  quantity.dispatchEvent(new window.Event('input', { bubbles: true }))
  for (const [key, value] of [
    ['len', '40'],
    ['wid', '30'],
    ['ht', '25'],
    ['weight', '12.5'],
    ['received', '1'],
    ['loaded', '1'],
  ])
    change(key, value)
  await submit()
  assert.deepEqual(writes[0].next.groups, [
    { orderId: 'purchase1', groupId: 'g1' },
  ])
  assert.deepEqual(writes[0].next.mark, { orderId: 'purchase1', groupId: 'g3' })
  button('Another carton').click()
  await tick()
  assert.equal(input('cartonNumber').value, '2')
  assert.equal(input('count').value, '1')
  for (const [key, value] of [
    ['len', '40'],
    ['wid', '30'],
    ['ht', '25'],
  ])
    assert.equal(input(key).value, value)
  for (const key of ['weight', 'received', 'loaded'])
    assert.equal(input(key).value, '')
  assert.equal(
    dialog.querySelectorAll('.carton-batch-product[data-selected="true"]')
      .length,
    0
  )
  assert.equal(
    dialog.querySelector('[data-mark-group="g3"]').getAttribute('aria-pressed'),
    'true'
  )
  assert.equal(
    dialog.querySelector('[data-entry-id="small"] .carton-batch-quantity input')
      .value,
    '2'
  )
  const other = dialog.querySelector('[data-entry-id="other-code"]'),
    checked = other.querySelector('input[type="checkbox"]')
  checked.checked = true
  checked.dispatchEvent(new window.Event('change', { bubbles: true }))
  const secondQuantity = other.querySelector('.carton-batch-quantity input')
  secondQuantity.value = '2'
  secondQuantity.dispatchEvent(new window.Event('input', { bubbles: true }))
  await submit()
  assert.equal(writes.length, 2)
  assert.equal(writes[1].next.cartonNumber, '2')
  assert.equal(writes[1].next.weight, '')
  assert.equal(writes[1].next.received, null)
  assert.equal(writes[1].next.loaded, null)
  assert.deepEqual(writes[1].next.contents, [
    { orderId: 'purchase1', entryId: 'other-code', quantity: '2' },
  ])
})
