import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPreparation,
  createVariantSuffixValidator,
  validatePreparation,
  validatePreparationSuffixEdits,
} from '../src/packing-model.js'
import { regroupSelection } from '../src/packing-grouping.js'

function snapshot(count = 2) {
  return {
    accountId: 'local',
    orderId: '100000000000000001',
    sellerName: 'synthetic-suffix-seller',
    items: Array.from({ length: count }, (_, index) => ({
      entryId: String(index + 1),
      title: 'Synthetic product',
      description: 'Synthetic product',
      skuProperties: [{ label: 'Color', value: `Color ${index}` }],
    })),
  }
}

function fixture() {
  const source = snapshot()
  const preparation = createPreparation(source, '2026-10', [])
  return { source, preparation, variant: preparation.groups[0].variants[0] }
}

function mismatch(preparation, previous, field, options) {
  const group = preparation.groups[0]
  const variant = group.variants[0]
  assert.throws(
    () => validatePreparationSuffixEdits(preparation, previous, options),
    (error) => {
      assert.equal(error.code, 'PACKING_SUFFIX_FIELD_MISMATCH')
      assert.deepEqual(error.packingIssue, {
        orderId: preparation.orderId,
        groupId: group.id,
        variantId: variant.id,
        field,
        value: variant[field === 'variant' ? 'variantSuffix' : 'sizeSuffix'],
      })
      return true
    }
  )
}

test('new model letters in Size code report the size field without changing the draft', () => {
  for (const suffix of ['A', 'B', 'C', 'D', 'Z']) {
    const { preparation, variant } = fixture()
    variant.sizeSuffix = suffix
    const original = structuredClone(preparation)
    mismatch(preparation, undefined, 'size')
    assert.deepEqual(preparation, original)
  }
})

test('standard size endings in Variant code report the variant field', () => {
  for (const suffix of ['S', 'M', 'L', 'XS', 'XL', 'XXS', 'XXXL', 'XXXXL']) {
    const { preparation, variant } = fixture()
    variant.variantSuffix = suffix
    mismatch(preparation, undefined, 'variant')
  }
})

test('blank, named and custom size endings retain the supported authoring contract', () => {
  for (const suffix of ['', 'S', 'M', 'L', 'XS', 'XL', 'A1', 'X', 'CUSTOM']) {
    const { preparation, variant } = fixture()
    variant.sizeSuffix = suffix
    assert.equal(validatePreparationSuffixEdits(preparation), preparation)
  }
  const { preparation, variant } = fixture()
  variant.variantSuffix = ''
  assert.doesNotThrow(() => validatePreparationSuffixEdits(preparation))
})

test('configured size suffixes are accepted as sizes and reserved from authored model codes', () => {
  const sizeVocabulary = [
    { match: 'Miniature', suffix: 'A' },
    { match: 'Extra narrow', suffix: 'NARROW' },
  ]
  for (const suffix of ['A', 'NARROW']) {
    const { preparation, variant } = fixture()
    variant.variantSuffix = 'B'
    variant.sizeSuffix = suffix
    assert.doesNotThrow(() =>
      validatePreparationSuffixEdits(preparation, undefined, { sizeVocabulary })
    )
    variant.variantSuffix = suffix
    mismatch(preparation, undefined, 'variant', { sizeVocabulary })
  }
})

test('saved legacy suffixes survive unrelated edits, identity changes and backup validation', () => {
  const { preparation, variant } = fixture()
  variant.variantSuffix = 'S'
  variant.sizeSuffix = 'A'
  const previous = validatePreparation(preparation)
  preparation.groups[0].category = 'Edited category'
  preparation.groups[0].variants.reverse()
  assert.doesNotThrow(() =>
    validatePreparationSuffixEdits(preparation, previous)
  )
  variant.id = 'moved-variant'
  assert.doesNotThrow(() =>
    validatePreparationSuffixEdits(preparation, previous)
  )
  variant.sizeSuffix = 'B'
  assert.throws(
    () => validatePreparationSuffixEdits(preparation, previous),
    (error) => error.packingIssue.field === 'size'
  )
  variant.sizeSuffix = ''
  variant.variantSuffix = ''
  assert.doesNotThrow(() =>
    validatePreparationSuffixEdits(preparation, previous)
  )
})

test('an unrelated account or order cannot grandfather legacy suffixes', () => {
  for (const field of ['accountId', 'orderId']) {
    const { preparation, variant } = fixture()
    variant.sizeSuffix = 'A'
    const previous = structuredClone(preparation)
    previous[field] = `other-${previous[field]}`
    mismatch(preparation, previous, 'size')
  }
})

test('reusing a legacy variant identity cannot transfer its suffix to different source entries', () => {
  for (const expand of [false, true]) {
    const { preparation, variant } = fixture()
    variant.sizeSuffix = 'A'
    const previous = structuredClone(preparation)
    if (expand) {
      variant.entryIds.push('2')
      preparation.groups[0].variants.pop()
    } else {
      variant.entryIds = ['2']
      preparation.groups[0].variants[1].entryIds = ['1']
    }
    mismatch(preparation, previous, 'size')
  }
})

test('restoring an exact historical field permits Undo while new swapped fields remain invalid', () => {
  const { preparation: restored, variant } = fixture()
  variant.sizeSuffix = 'A'
  const previous = structuredClone(restored)
  previous.groups[0].variants[0].sizeSuffix = 'S'
  const candidate = structuredClone(previous)
  candidate.groups[0].variants[0].sizeSuffix = 'A'
  candidate.groups[0].variants[0].variantSuffix = 'C'
  mismatch(candidate, previous, 'size')
  assert.doesNotThrow(() =>
    validatePreparationSuffixEdits(candidate, previous, { restored })
  )
  candidate.groups[0].variants[0].sizeSuffix = 'B'
  mismatch(candidate, previous, 'size', { restored })
})

test('restored suffix exceptions remain scoped to their account, order and source entries', () => {
  const { preparation: restored } = fixture()
  restored.groups[0].variants[0].sizeSuffix = 'A'
  const previous = structuredClone(restored)
  previous.groups[0].variants[0].sizeSuffix = ''
  const candidate = structuredClone(previous)
  candidate.groups[0].variants[0].sizeSuffix = 'A'
  for (const key of ['accountId', 'orderId']) {
    const unrelated = structuredClone(restored)
    unrelated[key] = `other-${unrelated[key]}`
    mismatch(candidate, previous, 'size', { restored: unrelated })
  }
  const [first, second] = restored.groups[0].variants
  ;[first.entryIds, second.entryIds] = [second.entryIds, first.entryIds]
  mismatch(candidate, previous, 'size', { restored })
})

test('separating thirteen shared source rows generates endings accepted by semantic validation', async () => {
  const source = snapshot(13)
  const original = createPreparation(source, '2026-10', [])
  const selection = (draft) =>
    draft.groups.map((group) => ({
      draft,
      group,
      variants: group.variants,
      complete: true,
    }))
  const options = { getReservedBarcodes: async () => [] }
  const [shared] = await regroupSelection(selection(original), 'share', options)
  assert.equal(shared.groups[0].variants[0].entryIds.length, 13)
  const [separated] = await regroupSelection(
    selection(shared),
    'separate',
    options
  )
  const endings = separated.groups[0].variants.map(
    ({ variantSuffix }) => variantSuffix
  )
  assert.equal(endings.length, 13)
  assert.equal(new Set(endings).size, 13)
  assert.ok(endings.every(createVariantSuffixValidator()))
  assert.doesNotThrow(() =>
    validatePreparationSuffixEdits(separated, shared, { snapshot: source })
  )
})

test('separating two rows skips a configured size ending A when generating model codes', async () => {
  const source = snapshot(2)
  source.items[1].skuProperties = structuredClone(source.items[0].skuProperties)
  const original = createPreparation(source, '2026-10', [])
  const group = original.groups[0]
  const sizeVocabulary = [{ match: 'Configured miniature', suffix: 'A' }]
  const [separated] = await regroupSelection(
    [{ draft: original, group, variants: group.variants, complete: true }],
    'separate',
    { getReservedBarcodes: async () => [], sizeVocabulary }
  )
  assert.deepEqual(
    separated.groups[0].variants.map(({ variantSuffix }) => variantSuffix),
    ['', 'B']
  )
  assert.doesNotThrow(() =>
    validatePreparationSuffixEdits(separated, original, {
      snapshot: source,
      sizeVocabulary,
    })
  )
})

test('collision-driven merging skips reserved and size-like model candidates', async () => {
  const source = snapshot(13)
  for (const [index, item] of source.items.entries())
    item.title = `Synthetic product ${index}`
  const original = createPreparation(source, '2026-10', [])
  for (const [index, group] of original.groups.entries())
    group.baseCode = `CE261001${String(index + 1).padStart(2, '0')}`
  const [merged] = await regroupSelection(
    original.groups.map((group) => ({
      draft: original,
      group,
      variants: group.variants,
      complete: true,
    })),
    'merge',
    {
      getReservedBarcodes: async (base) =>
        [...'ABCDEFGHIJK'].map((suffix) => base + suffix),
    }
  )
  const endings = merged.groups[0].variants.map(
    ({ variantSuffix }) => variantSuffix
  )
  assert.equal(endings[1], 'N')
  assert.equal(new Set(endings).size, 13)
  assert.ok(endings.every(createVariantSuffixValidator()))
  assert.doesNotThrow(() =>
    validatePreparationSuffixEdits(merged, original, { snapshot: source })
  )
})

test('sharing A and B under a configured size A generates a valid model ending', async () => {
  const source = snapshot(2)
  const original = createPreparation(source, '2026-10', [])
  const group = original.groups[0]
  const sizeVocabulary = [{ match: 'Configured miniature', suffix: 'A' }]
  const [shared] = await regroupSelection(
    [{ draft: original, group, variants: group.variants, complete: true }],
    'share',
    { getReservedBarcodes: async () => [], sizeVocabulary }
  )
  assert.equal(shared.groups[0].variants[0].variantSuffix, 'C')
  assert.deepEqual(shared.groups[0].variants[0].entryIds, ['1', '2'])
  assert.doesNotThrow(() =>
    validatePreparationSuffixEdits(shared, original, {
      snapshot: source,
      sizeVocabulary,
    })
  )
})

test('sharing source-derived L and M generates a suitable ending without changing other variants', async () => {
  const source = snapshot(13)
  const original = createPreparation(source, '2026-10', [])
  const group = original.groups[0]
  const [shared] = await regroupSelection(
    [
      {
        draft: original,
        group,
        variants: group.variants.slice(11),
        complete: true,
      },
    ],
    'share',
    { getReservedBarcodes: async () => [] }
  )
  assert.equal(shared.groups[0].variants.length, 12)
  assert.equal(shared.groups[0].variants[11].variantSuffix, 'N')
  assert.deepEqual(shared.groups[0].variants[11].entryIds, ['12', '13'])
  assert.deepEqual(
    shared.groups[0].variants.slice(0, 11),
    group.variants.slice(0, 11)
  )
  assert.doesNotThrow(() =>
    validatePreparationSuffixEdits(shared, original, { snapshot: source })
  )
})

test('sharing an already common legacy model ending leaves it unchanged', async () => {
  const source = snapshot(2)
  for (const [index, item] of source.items.entries())
    item.skuProperties = [{ label: 'Size', value: index ? 'M' : 'S' }]
  const original = createPreparation(source, '2026-10', [])
  const group = original.groups[0]
  for (const variant of group.variants) variant.variantSuffix = 'L'
  const [shared] = await regroupSelection(
    [{ draft: original, group, variants: group.variants, complete: true }],
    'share',
    { getReservedBarcodes: async () => [] }
  )
  assert.equal(shared.groups[0].variants[0].variantSuffix, 'L')
  assert.doesNotThrow(() =>
    validatePreparationSuffixEdits(shared, original, { snapshot: source })
  )
})

test('source-derived model numbering and explicit spreadsheet variants retain their existing meanings', () => {
  const source = snapshot(26)
  const preparation = createPreparation(source, '2026-10', [])
  assert.equal(preparation.groups[0].variants[11].variantSuffix, 'L')
  assert.equal(preparation.groups[0].variants[12].variantSuffix, 'M')
  assert.equal(preparation.groups[0].variants[18].variantSuffix, 'S')
  assert.doesNotThrow(() =>
    validatePreparationSuffixEdits(preparation, undefined, { snapshot: source })
  )
  preparation.groups[0].variants[0].variantSuffix = 'M'
  mismatch(preparation, undefined, 'variant', { snapshot: source })

  const spreadsheet = snapshot(1)
  spreadsheet.sourceType = 'spreadsheet'
  spreadsheet.items[0].sourceGroup = '1'
  spreadsheet.items[0].sourceVariant = 'L'
  const declared = createPreparation(spreadsheet, '2026-10', [])
  assert.equal(declared.groups[0].variants[0].variantSuffix, 'L')
  assert.doesNotThrow(() =>
    validatePreparationSuffixEdits(declared, undefined, {
      snapshot: spreadsheet,
    })
  )
})
