import test from 'node:test'
import assert from 'node:assert/strict'
import { acknowledgePreparation } from '../src/preparation-save.js'

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
