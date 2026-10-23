import test from 'node:test'
import assert from 'node:assert/strict'
import {
  groupingAvailability,
  groupingReviewChanges,
  regroupSelection,
} from '../src/packing-grouping.js'

function order(id) {
  return {
    accountId: 'test',
    orderId: id,
    month: '2026-10',
    groups: [1, 2].map((number) => ({
      id: `${id}-group-${number}`,
      baseCode: `CE2610010${number}`,
      month: '2026-10',
      variants: [1, 2].map((value) => ({
        id: `${id}-${number}-${value}`,
        entryIds: [`${id}-${number}-${value}`],
        variantSuffix: value === 1 ? 'A' : 'B',
        sizeSuffix: '',
        material: value === 1 ? '玻璃' : '铁',
      })),
    })),
  }
}
const scope = (draft, index = 0, variants = draft.groups[index].variants) => ({
  draft,
  group: draft.groups[index],
  variants,
  complete: true,
})
const options = { getReservedBarcodes: async () => [] }

test('same order IDs in different accounts produce independent share/split candidates and cannot merge ownership', async () => {
  const a = order('same'),
    b = order('same')
  a.accountId = 'buyer-a'
  b.accountId = 'buyer-b'
  b.groups[0].variants[0].entryIds = ['buyer-b-source']
  const original = structuredClone([a, b])
  const shared = await regroupSelection([scope(a), scope(b)], 'share', options)
  assert.equal(shared.length, 2)
  assert.deepEqual(
    shared.map((value) => value.accountId),
    ['buyer-a', 'buyer-b']
  )
  assert.deepEqual(shared[0].groups[0].variants[0].entryIds, [
    'same-1-1',
    'same-1-2',
  ])
  assert.deepEqual(shared[1].groups[0].variants[0].entryIds, [
    'buyer-b-source',
    'same-1-2',
  ])
  const split = await regroupSelection(
    [
      scope(a, 0, [a.groups[0].variants[0]]),
      scope(b, 0, [b.groups[0].variants[0]]),
    ],
    'split',
    { ...options, newId: () => crypto.randomUUID() }
  )
  assert.equal(split.length, 2)
  assert.deepEqual(split[0].groups.at(-1).variants[0].entryIds, ['same-1-1'])
  assert.deepEqual(split[1].groups.at(-1).variants[0].entryIds, [
    'buyer-b-source',
  ])
  await assert.rejects(
    () => regroupSelection([scope(a), scope(b, 1)], 'merge', options),
    /one order/
  )
  assert.deepEqual([a, b], original)
})

test('a claimed complete selection cannot move part of a shared variant or omit merge members', async () => {
  const draft = order('same')
  draft.groups[0].variants[0].entryIds.push('hidden-shared-row')
  const selected = structuredClone(draft.groups[0].variants[0])
  selected.entryIds.pop()
  await assert.rejects(
    () => regroupSelection([scope(draft, 0, [selected])], 'split', options),
    /outside this packing selection/
  )
  const partial = scope(draft)
  partial.group = { ...partial.group, variants: [partial.group.variants[0]] }
  await assert.rejects(
    () => regroupSelection([partial, scope(draft, 1)], 'merge', options),
    /outside this packing selection/
  )
})

function recordsFor(draft) {
  return [
    {
      snapshot: {
        accountId: draft.accountId,
        orderId: draft.orderId,
        sellerName: 'Synthetic supplier',
        items: draft.groups.flatMap((group) =>
          group.variants.flatMap((variant) =>
            variant.entryIds.map((entryId) => ({
              entryId,
              description: `Original description ${entryId}`,
              thumbnail: `synthetic-${entryId}.png`,
            }))
          )
        ),
      },
    },
  ]
}

test('sharing selected variants batches within groups without merging orders or touching other groups', async () => {
  const a = order('a'),
    b = order('b')
  const original = structuredClone([a, b])
  const results = await regroupSelection([scope(a), scope(b)], 'share', options)
  assert.equal(results.length, 2)
  for (const result of results) {
    const before = original.find((entry) => entry.orderId === result.orderId)
    assert.equal(result.groups[0].variants.length, 1)
    assert.deepEqual(
      result.groups[0].variants[0].entryIds,
      before.groups[0].variants.flatMap((entry) => entry.entryIds)
    )
    assert.deepEqual(result.groups[1], before.groups[1])
    assert.equal(
      result.groups[0].variants[0].materialOverrides[
        result.groups[0].variants[0].entryIds[1]
      ].value,
      '铁'
    )
  }
  assert.deepEqual([a, b], original)
})

test('separating selected combined rows across orders skips reserved suffixes and leaves unselected variants intact', async () => {
  const a = order('a'),
    b = order('b')
  for (const draft of [a, b])
    draft.groups[0].variants[0].entryIds.push(`${draft.orderId}-extra`)
  const results = await regroupSelection(
    [
      scope(a, 0, [a.groups[0].variants[0]]),
      scope(b, 0, [b.groups[0].variants[0]]),
    ],
    'separate',
    {
      getReservedBarcodes: async (base) => [`${base}C`],
      newId: (() => {
        let id = 0
        return () => `new-${++id}`
      })(),
    }
  )
  for (const result of results) {
    const original = result.orderId === 'a' ? a : b
    assert.equal(result.groups[0].variants.length, 3)
    assert.equal(result.groups[0].variants[2].variantSuffix, 'D')
    assert.deepEqual(
      result.groups[0].variants[1],
      original.groups[0].variants[1]
    )
    assert.deepEqual(result.groups[1], original.groups[1])
  }
})

test('moving partial selections creates one new group per source group and never transfers source orders', async () => {
  const a = order('a'),
    b = order('b')
  const results = await regroupSelection(
    [
      scope(a, 0, [a.groups[0].variants[1]]),
      scope(b, 1, [b.groups[1].variants[0]]),
    ],
    'split',
    options
  )
  assert.equal(results[0].groups[0].variants.length, 1)
  assert.deepEqual(results[0].groups[2].variants[0].entryIds, ['a-1-2'])
  assert.deepEqual(results[1].groups[2].variants[0].entryIds, ['b-2-1'])
  assert.equal(results[0].groups[2].baseCode, '')
  assert.equal(results[1].groups[2].baseCode, '')
})

test('group merging only accepts complete groups from one order and month', async () => {
  const a = order('a'),
    b = order('b')
  assert.match(
    groupingAvailability([scope(a), scope(b)]).merge.reason,
    /one order/
  )
  assert.match(
    groupingAvailability([scope(a), scope(a, 1, [a.groups[1].variants[0]])])
      .merge.reason,
    /every product/
  )
  a.groups[1].month = '2026-11'
  assert.match(
    groupingAvailability([scope(a), scope(a, 1)]).merge.reason,
    /different packing months/
  )
  a.groups[1].month = '2026-10'
  const [merged] = await regroupSelection([scope(a), scope(a, 1)], 'merge', {
    getReservedBarcodes: async (base) => [`${base}C`],
  })
  assert.equal(merged.groups.length, 1)
  assert.equal(merged.groups[0].baseCode, a.groups[0].baseCode)
  assert.deepEqual(
    merged.groups[0].variants.map((variant) => variant.variantSuffix),
    ['A', 'B', 'D', 'E']
  )
  assert.equal(a.groups.length, 2)
})

for (const noSizeIndex of [0, 1])
  test(`mixed size modes return to automatic without changing sizes when the no-size group is ${noSizeIndex === 0 ? 'the target' : 'incoming'}`, async () => {
    const draft = order('a')
    draft.groups[noSizeIndex].sizeMode = 'none'
    const automatic = draft.groups[1 - noSizeIndex]
    automatic.variants[0].size = '300 ml'
    automatic.variants[0].sizeSuffix = 'S'
    automatic.variants[0].needsSizeMapping = false
    automatic.variants[1].size = 'Unclear size'
    automatic.variants[1].needsSizeMapping = true
    draft.groups
      .flatMap((group) => group.variants)
      .forEach((variant, index) => {
        variant.variantSuffix = String.fromCharCode(65 + index)
      })
    const before = structuredClone(draft)
    const [merged] = await regroupSelection(
      [scope(draft), scope(draft, 1)],
      'merge',
      options
    )
    assert.equal(merged.groups.length, 1)
    assert.equal(merged.groups[0].sizeMode, undefined)
    assert.equal(merged.groups[0].baseCode, before.groups[0].baseCode)
    assert.deepEqual(
      merged.groups[0].variants,
      before.groups.flatMap((group) => group.variants)
    )
    assert.deepEqual(draft, before)
  })

test('merging only no-size groups keeps their shared no-size override', async () => {
  const draft = order('a')
  for (const group of draft.groups) {
    group.sizeMode = 'none'
    for (const variant of group.variants) variant.needsSizeMapping = false
  }
  draft.groups
    .flatMap((group) => group.variants)
    .forEach((variant, index) => {
      variant.variantSuffix = String.fromCharCode(65 + index)
    })
  const before = structuredClone(draft)
  const [merged] = await regroupSelection(
    [scope(draft), scope(draft, 1)],
    'merge',
    options
  )
  assert.equal(merged.groups[0].sizeMode, 'none')
  assert.deepEqual(
    merged.groups[0].variants,
    before.groups.flatMap((group) => group.variants)
  )
  assert.deepEqual(draft, before)
})

test('incomplete packing scopes are disabled before changing any grouping', async () => {
  const a = order('a')
  const entries = [{ ...scope(a), complete: false }]
  assert.match(
    groupingAvailability(entries).share.reason,
    /outside this packing selection/
  )
  await assert.rejects(
    regroupSelection(entries, 'share', options),
    /outside this packing selection/
  )
  assert.match(
    groupingAvailability([scope(a)]).split.reason,
    /some, but not all/
  )
  assert.match(groupingAvailability([]).share.reason, /at least two/)
})

test('share review shows affected original rows and exact barcodes, excluding unaffected selected groups', async () => {
  const draft = order('a')
  const entries = [scope(draft), scope(draft, 1, [draft.groups[1].variants[0]])]
  const preview = await regroupSelection(entries, 'share', options)
  const records = recordsFor(draft)
  const changes = groupingReviewChanges(
    groupingAvailability(entries).share.entries,
    preview,
    records
  )
  assert.deepEqual(
    changes.map(({ entryId, before, after }) => ({ entryId, before, after })),
    [
      { entryId: 'a-1-1', before: 'CE26100101A', after: 'CE26100101A' },
      { entryId: 'a-1-2', before: 'CE26100101B', after: 'CE26100101A' },
    ]
  )
  for (const [index, change] of changes.entries()) {
    assert.equal(change.photo, records[0].snapshot.items[index])
    assert.equal(change.name, records[0].snapshot.items[index].description)
    assert.equal(change.order, 'Synthetic supplier')
    assert.match(String(change.detail), /Product rows: 1 → 2/)
  }
})

test('separate review follows each source row to its new barcode even when the variant ID changes', async () => {
  const draft = order('a')
  draft.groups[0].variants[0].entryIds.push('extra')
  const entries = [scope(draft, 0, [draft.groups[0].variants[0]])]
  const preview = await regroupSelection(entries, 'separate', options)
  const changes = groupingReviewChanges(entries, preview, recordsFor(draft))
  assert.deepEqual(
    changes.map(({ entryId, before, after }) => ({ entryId, before, after })),
    [
      { entryId: 'a-1-1', before: 'CE26100101A', after: 'CE26100101A' },
      { entryId: 'extra', before: 'CE26100101A', after: 'CE26100101C' },
    ]
  )
  assert.ok(
    changes.every((change) =>
      String(change.detail).includes('Product rows: 2 → 1')
    )
  )
})

test('split and merge reviews use the allocated preview codes and omit unselected rows', async () => {
  const draft = order('a')
  const selected = [scope(draft, 0, [draft.groups[0].variants[1]])]
  const split = await regroupSelection(selected, 'split', options)
  // The database preview allocates the new group's base before it is reviewed.
  split[0].groups.at(-1).baseCode = 'CE26100103'
  const splitChanges = groupingReviewChanges(selected, split, recordsFor(draft))
  assert.deepEqual(
    splitChanges.map(({ before, after }) => [before, after]),
    [['CE26100101B', 'CE26100103B']]
  )
  const all = [scope(draft), scope(draft, 1)]
  const merged = await regroupSelection(all, 'merge', options)
  const mergeChanges = groupingReviewChanges(all, merged, recordsFor(draft))
  assert.deepEqual(
    mergeChanges.map(({ before, after }) => [before, after]),
    [
      ['CE26100101A', 'CE26100101A'],
      ['CE26100101B', 'CE26100101B'],
      ['CE26100102A', 'CE26100101C'],
      ['CE26100102B', 'CE26100101D'],
    ]
  )
})

test('grouping review labels unresolved or missing codes without inventing barcode values', async () => {
  const draft = order('a')
  draft.groups[0].variants[0].needsSizeMapping = true
  const entries = [scope(draft)]
  const preview = await regroupSelection(entries, 'share', options)
  const changes = groupingReviewChanges(entries, preview, recordsFor(draft))
  assert.equal(String(changes[0].before), 'Choose a size code')
  assert.ok(
    changes.every((change) => String(change.after) === 'Choose a size code')
  )
  draft.groups[0].baseCode = ''
  draft.groups[0].variants[0].needsSizeMapping = false
  const missing = groupingReviewChanges(entries, preview, recordsFor(draft))
  assert.equal(String(missing[0].before), 'Not prepared')
  assert.throws(
    () => groupingReviewChanges(entries, [], recordsFor(draft)),
    /missing from the grouping preview/
  )
})
