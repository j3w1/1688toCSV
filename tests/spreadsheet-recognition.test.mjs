import test from 'node:test'
import assert from 'node:assert/strict'
import { recognitionProperties } from '../src/spreadsheet-properties.js'
import {
  createSizeClassifier,
  resolvePendingSizeMappings,
} from '../src/size-vocabulary.js'
import { getItemColorHints } from '../src/color-vocabulary.js'
import { suggestMaterial } from '../src/material-vocabulary.js'
import { createPreparation } from '../src/packing-model.js'

const classifier = createSizeClassifier()
const item = (size, extra = {}) => ({
  entryId: '1',
  sourceGroup: '1',
  sourceRow: 3,
  title: `SYN-A · 黑色陶瓷盘 · ${size}`,
  description: `SYN-A · 黑色陶瓷盘 · ${size}`,
  productNumber: 'SYN-A',
  skuProperties: [{ label: '货号', value: 'SYN-A' }],
  ...extra,
})

test('marked spreadsheet descriptions feed the shared recognizers even with a code property already present', () => {
  const source = item('25cm')
  const before = structuredClone(source)
  assert.equal(classifier.extract(source).size, '25cm')
  assert.deepEqual(
    getItemColorHints(source).map((hint) => hint.id),
    ['black']
  )
  assert.equal(suggestMaterial(source), '陶瓷')
  assert.deepEqual(source, before)
  assert.deepEqual(recognitionProperties(null), [])
})

test('typed properties and seller codes stay authoritative without duplicate recognition inputs', () => {
  const source = item('25cm', {
    productNumber: 'A4',
    description: 'A4 · 黑色陶瓷盘 · 25cm',
    skuProperties: [
      { label: '货号', value: 'A4' },
      { label: '尺寸', value: '25cm' },
    ],
  })
  assert.equal(classifier.extract(source).size, '25cm')
  assert.equal(
    recognitionProperties(source).filter((p) => p.value === '25cm').length,
    1
  )
  assert.equal(
    classifier.extract(
      item('', {
        productNumber: 'MODEL-10.5"',
        description: 'MODEL-10.5" · Ceramic plate',
        skuProperties: [{ label: '货号', value: 'MODEL-10.5"' }],
      })
    ).size,
    ''
  )
})

test('comparable marked measurements rank through the standard packing workflow', () => {
  for (const [sizes, expected] of [
    [
      ['25cm', '20.5cm', '18cm'],
      ['L', 'M', 'S'],
    ],
    [
      ['10.5"', '8"', '7.5"', '6"'],
      ['XL', 'L', 'M', 'S'],
    ],
    [
      ['14*6', '19*7'],
      ['S', 'L'],
    ],
  ]) {
    const snapshot = {
      orderId: '12345',
      accountId: 'local',
      sourceType: 'spreadsheet',
      sellerMemberLogin: 'store:market:4321',
      items: sizes.map((size, index) =>
        item(size, { entryId: String(index + 1) })
      ),
    }
    const draft = createPreparation(snapshot, '2026-10', [])
    assert.deepEqual(
      draft.groups[0].variants.map((v) => v.sizeSuffix),
      expected
    )
    assert.ok(draft.groups[0].variants.every((v) => !v.needsSizeMapping))
  }
})

test('unitless or incompatible measurements are recognized without inventing centimetres or an area ranking', () => {
  assert.equal(classifier.extract(item('14*6')).size, '14*6')
  const sizes = ['25cm', '14*6', '19*4'].map(
    (value) => classifier.extract(item(value)).size
  )
  assert.ok(
    classifier.suggest(sizes).every((result) => result.needsSizeMapping)
  )
})

test('existing pending spreadsheet sizes use their marked group while mixed source groups remain protected', () => {
  const snapshot = {
    orderId: '12345',
    accountId: 'local',
    sourceType: 'spreadsheet',
    sellerMemberLogin: 'store:market:4321',
    items: ['25cm', '20.5cm'].map((size, index) =>
      item(size, { entryId: String(index + 1) })
    ),
  }
  const draft = createPreparation(snapshot, '2026-10', [])
  for (const variant of draft.groups[0].variants) {
    variant.size = ''
    variant.sizeSuffix = ''
    variant.needsSizeMapping = true
  }
  const resolved = resolvePendingSizeMappings(draft, undefined, { snapshot })
  assert.deepEqual(
    resolved.preparation.groups[0].variants.map((v) => v.sizeSuffix),
    ['L', 'S']
  )
  assert.deepEqual(
    draft.groups[0].variants.map((v) => v.sizeSuffix),
    ['', '']
  )
  snapshot.items[1].sourceGroup = '2'
  assert.deepEqual(
    resolvePendingSizeMappings(draft, undefined, { snapshot }).preparation,
    draft
  )
})

test('1688 title text stays excluded and spreadsheet recognition respects configured aliases', () => {
  const source = item('25cm')
  delete source.sourceGroup
  assert.equal(classifier.extract(source).size, '')
  assert.deepEqual(getItemColorHints(source), [])
  const custom = createSizeClassifier([
    { match: 'Mini dish', suffix: 'XS' },
    { match: 'Dinner dish', suffix: 'L' },
  ])
  assert.deepEqual(
    custom
      .suggest(
        ['Mini dish', 'Dinner dish'].map(
          (value) => custom.extract(item(value)).size
        )
      )
      .map((v) => v.sizeSuffix),
    ['XS', 'L']
  )
})
