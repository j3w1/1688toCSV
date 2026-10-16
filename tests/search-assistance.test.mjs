import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeSearch,
  searchMatcher,
  searchSuggestions,
} from '../src/search-assistance.js'

test('Search folds accents and width, accepts one textual typo, and supports unordered terms', () => {
  assert.equal(normalizeSearch('  CERÁMICA ＡＢＣ  '), 'ceramica abc')
  for (const query of ['glsas', 'glss', 'glasss', 'gloss'])
    assert.equal(searchMatcher(query)('Clear glass vase'), true, query)
  assert.equal(searchMatcher('vase clear')('Clear glass vase'), true)
  assert.equal(searchMatcher('ceramica')('Cerámica blanca'), true)
  assert.equal(searchMatcher('白色')('陶瓷花瓶 白色'), true)
  assert.equal(searchMatcher('glitter')('Clear glass vase'), false)
})

test('Numeric IDs, codes, measurements, CJK and short names never use typo matching', () => {
  for (const [query, value] of [
    ['5127523670009019538', '5127523670009019539'],
    ['CE26100102', 'CE26100101'],
    ['14*66', '14*65'],
    ['ABCE', 'ABCD123'],
    ['M', 'S'],
    ['白包', '白色'],
  ])
    assert.equal(searchMatcher(query)(value), false, `${query} / ${value}`)
  assert.equal(searchMatcher('9019539')('5127523670009019539'), true)
  assert.equal(searchMatcher('ce2610')('CE26100101'), true)
})

test('Suggestions favor exact wording over fuzzy matches, deduplicate and stay bounded', () => {
  const choices = [
    'Gloss',
    'Glass jar',
    'GLASS',
    'glass',
    ...Array.from({ length: 40 }, (_, i) => `Glass vase ${i}`),
  ]
  const result = searchSuggestions('glass', choices)
  assert.equal(result.length, 8)
  assert.equal(result[0], 'GLASS')
  assert.equal(
    result.filter((value) => value.toLowerCase() === 'glass').length,
    1
  )
  assert.ok(!result.includes('Gloss'))
  assert.deepEqual(
    searchSuggestions('rojo', [{ value: 'Red', text: 'Red Rojo 红色' }]),
    ['Red']
  )
  assert.deepEqual(searchSuggestions('5123', ['5124', 'AB5123']), ['AB5123'])
  assert.deepEqual(searchSuggestions('nothing', choices), [])
})
