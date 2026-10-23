import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acknowledgePreparation,
  samePreparation,
} from '../src/preparation-save.js'
import {
  automaticNaming,
  recordNamingEdits,
  refreshPreparationNames,
} from '../src/product-vocabulary.js'

test('save equality ignores validation key order but retains field changes and row order', () => {
  const draft = {
    groups: [{ id: 'g', baseCode: 'CE26100101' }],
    defaultPacking: { groups: [] },
    packingPosition: 3,
  }
  const saved = {
    packingPosition: 3,
    defaultPacking: { groups: [] },
    groups: [{ baseCode: 'CE26100101', id: 'g' }],
  }
  assert.equal(samePreparation(draft, saved), true)
  assert.equal(samePreparation(draft, { ...saved, packingPosition: 2 }), false)
  assert.equal(
    samePreparation(
      { groups: [{ id: 'a' }, { id: 'b' }] },
      { groups: [{ id: 'b' }, { id: 'a' }] }
    ),
    false
  )
  assert.equal(
    samePreparation(draft, {
      ...saved,
      groups: [{ id: 'g', baseCode: 'CE26100102' }],
    }),
    false
  )
})

test('save acknowledgement applies codes without replacing live objects or later typing', () => {
  const draft = {
    orderId: '1',
    revision: 0,
    updatedAt: 'old',
    groups: [
      {
        id: 'g',
        baseCode: '',
        spanishName: 'OLD',
        variants: [
          {
            id: 'v',
            entryIds: ['1', '2'],
            variant: 'black',
            size: '300ml',
            variantSuffix: '',
            sizeSuffix: 'S',
          },
        ],
      },
    ],
  }
  const submitted = structuredClone(draft)
  const saved = structuredClone(draft)
  saved.revision = 1
  saved.updatedAt = 'new'
  saved.groups[0].baseCode = 'CE26100101'
  const group = draft.groups[0],
    variant = group.variants[0]
  group.spanishName = 'NEWER TYPING'
  variant.variant = 'white'
  acknowledgePreparation(draft, submitted, saved)
  assert.equal(draft.groups[0], group)
  assert.equal(group.variants[0], variant)
  assert.equal(draft.revision, 1)
  assert.equal(draft.updatedAt, 'new')
  assert.equal(group.baseCode, 'CE26100101')
  assert.equal(group.spanishName, 'NEWER TYPING')
  assert.equal(variant.variant, 'white')
  assert.deepEqual(variant.entryIds, ['1', '2'])
})

test('a manual base edit during an allocation is retained for the next validated write', () => {
  const draft = { revision: 0, groups: [{ id: 'g', baseCode: '' }] }
  const submitted = structuredClone(draft)
  const saved = {
    revision: 1,
    updatedAt: 'new',
    groups: [{ id: 'g', baseCode: 'CE26100101' }],
  }
  draft.groups[0].baseCode = 'CE26100202'
  acknowledgePreparation(draft, submitted, saved)
  assert.equal(draft.groups[0].baseCode, 'CE26100202')
  assert.equal(draft.revision, 1)
})

test('acknowledged Undo clears removed optional names so a later autosave cannot resurrect them', () => {
  const draft = {
    revision: 2,
    updatedAt: 'second',
    groups: [
      {
        id: 'g',
        variants: [
          {
            id: 'v',
            spanishName: 'SECOND SAVED',
            naming: {
              spanishName: { source: 'manual', value: 'SECOND SAVED' },
            },
          },
        ],
      },
    ],
  }
  const submitted = structuredClone(draft)
  const saved = {
    revision: 3,
    updatedAt: 'undo',
    groups: [{ id: 'g', variants: [{ id: 'v' }] }],
  }
  const group = draft.groups[0]
  const variant = group.variants[0]
  acknowledgePreparation(draft, submitted, saved)
  assert.equal(samePreparation(draft, saved), true)
  assert.equal(draft.groups[0], group)
  assert.equal(group.variants[0], variant)
  assert.equal(Object.hasOwn(variant, 'spanishName'), false)
  assert.equal(Object.hasOwn(variant, 'naming'), false)
  const nextSubmission = structuredClone(draft)
  assert.equal(
    Object.hasOwn(nextSubmission.groups[0].variants[0], 'spanishName'),
    false
  )

  const newer = structuredClone(submitted)
  newer.groups[0].variants[0].spanishName = 'NEWER TYPING'
  newer.groups[0].variants[0].naming.spanishName.value = 'NEWER TYPING'
  acknowledgePreparation(newer, submitted, saved)
  assert.equal(newer.groups[0].variants[0].spanishName, 'NEWER TYPING')
  assert.equal(
    newer.groups[0].variants[0].naming.spanishName.value,
    'NEWER TYPING'
  )
})

test('acknowledged grouping Undo restores exact memberships without replacing surviving editor objects', () => {
  const draft = {
    revision: 4,
    updatedAt: 'split',
    groups: [
      { id: 'g', variants: [{ id: 'a', entryIds: ['1'] }] },
      { id: 'split', variants: [{ id: 'b', entryIds: ['2'] }] },
    ],
  }
  const submitted = structuredClone(draft)
  const saved = {
    revision: 5,
    updatedAt: 'undo',
    groups: [{ id: 'g', variants: [{ id: 'a', entryIds: ['1', '2'] }] }],
  }
  const groups = draft.groups
  const group = groups[0]
  const variant = group.variants[0]
  const entryIds = variant.entryIds
  acknowledgePreparation(draft, submitted, saved)
  assert.equal(samePreparation(draft, saved), true)
  assert.equal(draft.groups, groups)
  assert.equal(groups[0], group)
  assert.equal(group.variants[0], variant)
  assert.equal(variant.entryIds, entryIds)
  assert.deepEqual(entryIds, ['1', '2'])
  assert.deepEqual(structuredClone(draft).groups, saved.groups)
})

test('repeated autosaves retain manual names and clears after returning to the initial suggestion', () => {
  for (const initial of ['VELA', '']) {
    let stored = {
      orderId: '1',
      revision: 1,
      groups: [
        {
          id: 'g',
          title: 'Synthetic product',
          spanishName: initial,
          category: initial,
          naming: automaticNaming({ spanishName: initial, category: initial }),
          variants: [{ id: 'v', variantSuffix: 'A' }],
        },
      ],
    }
    const draft = structuredClone(stored)
    const save = () => {
      const submitted = structuredClone(draft)
      stored = {
        ...recordNamingEdits(submitted, stored),
        revision: stored.revision + 1,
      }
      acknowledgePreparation(draft, submitted, stored)
    }
    draft.groups[0].spanishName = 'MANUAL'
    draft.groups[0].category = '测试'
    save()
    draft.groups[0].spanishName = initial
    draft.groups[0].category = initial
    save()
    draft.groups[0].variants[0].variantSuffix = 'B'
    save()
    for (const field of ['spanishName', 'category']) {
      assert.deepEqual(stored.groups[0].naming[field], {
        source: 'manual',
        value: initial,
      })
      assert.deepEqual(
        draft.groups[0].naming[field],
        stored.groups[0].naming[field]
      )
    }
    const refreshed = refreshPreparationNames(stored, () => ({
      spanishName: 'NEW SUGGESTION',
      category: '新建议',
    }))
    assert.equal(refreshed.groups[0].spanishName, initial)
    assert.equal(refreshed.groups[0].category, initial)
  }
})

test('acknowledging name provenance preserves independent typing during a pending save', () => {
  const previous = {
    revision: 1,
    groups: [
      {
        id: 'g',
        title: 'Synthetic product',
        spanishName: 'VELA',
        category: '蜡烛',
        naming: automaticNaming({ spanishName: 'VELA', category: '蜡烛' }),
        variants: [],
      },
    ],
  }
  const draft = structuredClone(previous)
  draft.groups[0].spanishName = 'VELA AROMATICA'
  const submitted = structuredClone(draft)
  const saved = { ...recordNamingEdits(submitted, previous), revision: 2 }
  draft.groups[0].spanishName = 'VELA GRANDE'
  draft.groups[0].category = '香薰蜡烛'
  acknowledgePreparation(draft, submitted, saved)
  assert.equal(draft.groups[0].spanishName, 'VELA GRANDE')
  assert.equal(draft.groups[0].category, '香薰蜡烛')
  const nextSaved = recordNamingEdits(draft, saved)
  const refreshed = refreshPreparationNames(nextSaved, () => ({
    spanishName: 'NEW SUGGESTION',
    category: '新建议',
  }))
  assert.deepEqual(refreshed.groups[0].naming.spanishName, {
    source: 'manual',
    value: 'VELA GRANDE',
  })
  assert.deepEqual(refreshed.groups[0].naming.category, {
    source: 'manual',
    value: '香薰蜡烛',
  })
  assert.equal(refreshed.groups[0].spanishName, 'VELA GRANDE')
  assert.equal(refreshed.groups[0].category, '香薰蜡烛')
})
