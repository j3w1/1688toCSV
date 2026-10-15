import test from 'node:test'
import assert from 'node:assert/strict'
import {
  automaticNaming,
  createNameSuggester,
  DEFAULT_VOCABULARY,
  initializeVocabulary,
  orderNamingSuggestions,
  preparationAuthoring,
  recordNamingEdits,
  refreshPreparationNames,
} from '../src/product-vocabulary.js'
import {
  createPreparation,
  validatePackingPreferences,
  validatePreparation,
} from '../src/packing-model.js'

test('local rules identify actual product types and leave unknown or conflicting names blank', () => {
  const suggest = createNameSuggester()
  for (const [title, spanishName, category] of [
    ['合成测试 藤条扩香 香氛精油 58ml', 'DIFUSOR', '香薰'],
    ['合成测试 香薰蜡烛', 'VELA', '蜡烛'],
    ['合成测试 金属烛台', 'PORTAVELA', '烛台'],
    ['合成测试 牙刷架', 'PORTACEPILLOS', '牙刷架'],
    ['合成测试 未定义样品', '', ''],
  ]) {
    const result = suggest(title)
    assert.equal(result.spanishName, spanishName)
    assert.equal(result.category, category)
  }
  const ambiguous = createNameSuggester([
    { match: '样品', spanishName: 'VASO', category: '杯子' },
    { match: '样品', spanishName: 'JARRA', category: '水壶' },
  ])('样品')
  assert.deepEqual(ambiguous, {
    spanishName: '',
    category: '',
    status: 'ambiguous',
  })
})

test('vocabulary seeds once, respects explicit removals, and validates edited defaults as user overrides', () => {
  const initial = initializeVocabulary(validatePackingPreferences())
  assert.equal(initial.vocabulary.length, DEFAULT_VOCABULARY.length)
  assert.equal(initializeVocabulary(initial), initial)
  const removed = { ...initial, vocabulary: [] }
  assert.equal(initializeVocabulary(removed), removed)
  const explicit = initializeVocabulary(
    validatePackingPreferences({
      settings: { vocabularyInitialized: true },
      vocabulary: [],
    })
  )
  assert.deepEqual(explicit.vocabulary, [])
  const modified = structuredClone(initial)
  const entry = modified.vocabulary.find((rule) => rule.seed === 'candle')
  entry.spanishName = 'VELA PERFUMADA'
  const saved = validatePackingPreferences(modified)
  const override = saved.vocabulary.find(
    (rule) => rule.spanishName === 'VELA PERFUMADA'
  )
  assert.equal(override.seed, undefined)
  assert.equal(override.exclude, entry.exclude)
  assert.equal(
    createNameSuggester(saved.vocabulary)('香薰蜡烛').spanishName,
    'VELA PERFUMADA'
  )
})

test('automatic names preserve independent manual fields, manual clears and legacy authored names', () => {
  const original = {
    groups: [
      {
        id: 'g',
        title: '测试蜡烛',
        spanishName: 'VELA',
        category: '蜡烛',
        naming: automaticNaming({ spanishName: 'VELA', category: '蜡烛' }),
      },
    ],
  }
  const edited = structuredClone(original)
  edited.groups[0].spanishName = ''
  const manual = recordNamingEdits(edited, original)
  assert.deepEqual(manual.groups[0].naming.spanishName, {
    source: 'manual',
    value: '',
  })
  const refreshed = refreshPreparationNames(manual, () => ({
    spanishName: 'VELA NUEVA',
    category: '香薰蜡烛',
  }))
  assert.equal(refreshed.groups[0].spanishName, '')
  assert.equal(refreshed.groups[0].category, '香薰蜡烛')
  assert.equal(refreshed.groups[0].naming.category.source, 'automatic')
  const legacy = {
    groups: [
      { id: 'g', title: '测试蜡烛', spanishName: 'MANUAL', category: '' },
    ],
  }
  const legacyRefresh = refreshPreparationNames(legacy, createNameSuggester())
  assert.equal(legacyRefresh.groups[0].spanishName, 'MANUAL')
  assert.equal(legacyRefresh.groups[0].category, '蜡烛')
  assert.equal(
    refreshPreparationNames(legacyRefresh, createNameSuggester()),
    legacyRefresh
  )
})

test('scanning derives names without mutating financial rows or allocating packing codes', () => {
  const snapshot = {
    accountId: 'local',
    orderId: '10001',
    sellerName: 'Synthetic seller',
    items: [
      {
        entryId: '1',
        title: '测试 藤条扩香',
        description: '测试 藤条扩香',
        price: '3.90',
        quantity: '20',
        discount: '0.20',
      },
      {
        entryId: '2',
        title: '测试 藤条扩香',
        description: '测试 藤条扩香',
        price: '3.90',
        quantity: '40',
        discount: '0.40',
      },
    ],
  }
  const before = structuredClone(snapshot)
  const derived = orderNamingSuggestions(snapshot, createNameSuggester())
  assert.equal(derived.groups.length, 1)
  assert.deepEqual(derived.groups[0].entryIds, ['1', '2'])
  assert.equal(derived.groups[0].spanishName, 'DIFUSOR')
  assert.equal(derived.groups[0].baseCode, undefined)
  const draft = createPreparation(snapshot, '2026-10')
  assert.equal(draft.groups[0].baseCode, '')
  assert.equal(draft.groups[0].spanishName, 'DIFUSOR')
  assert.deepEqual(
    validatePreparation(draft).groups[0].naming,
    draft.groups[0].naming
  )
  assert.deepEqual(snapshot, before)
})

test('authoring comparison ignores derived naming but retains manual clears and edits', () => {
  const legacy = {
    revision: 1,
    updatedAt: '2026-10-01T00:00:00.000Z',
    groups: [
      { id: 'g', title: '测试 蜡烛', spanishName: 'MANUAL', category: '' },
    ],
  }
  const backfilled = {
    ...refreshPreparationNames(legacy, createNameSuggester()),
    revision: 2,
  }
  assert.equal(backfilled.groups[0].category, '蜡烛')
  assert.deepEqual(
    preparationAuthoring(legacy),
    preparationAuthoring(backfilled)
  )
  const manual = structuredClone(backfilled)
  manual.groups[0].category = ''
  manual.groups[0].naming.category = { source: 'manual', value: '' }
  assert.notDeepEqual(
    preparationAuthoring(manual),
    preparationAuthoring(legacy)
  )
  const changed = structuredClone(backfilled)
  changed.groups[0].spanishName = 'OTRO NOMBRE'
  assert.notDeepEqual(
    preparationAuthoring(changed),
    preparationAuthoring(legacy)
  )
})
