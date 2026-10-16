import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COLOR_VOCABULARY,
  validateColorVocabulary,
  configureColorVocabulary,
  getItemColorHints,
} from '../src/color-vocabulary.js'
import { validatePackingPreferences } from '../src/packing-model.js'

test('saved color edits affect helper words, aliases and swatches without changing source data', () => {
  const rules = structuredClone(COLOR_VOCABULARY),
    black = rules.find((entry) => entry.id === 'black')
  black.aliases.push('测试墨黑')
  black.labels = { en: 'Ink black', es: 'Negro tinta', zh: '墨黑' }
  black.swatch = '#131211'
  const source = {
      description: '颜色：测试墨黑',
      skuProperties: [{ label: '颜色', value: '测试墨黑' }],
    },
    before = structuredClone(source)
  const saved = validatePackingPreferences({ colorVocabulary: rules })
  configureColorVocabulary(saved.colorVocabulary)
  try {
    for (const [language, label] of Object.entries(black.labels)) {
      assert.deepEqual(getItemColorHints(source, language), [
        {
          id: 'black',
          label,
          source: '测试墨黑',
          kind: 'color',
          swatch: '#131211',
        },
      ])
    }
    assert.deepEqual(source, before)
    assert.equal(COLOR_VOCABULARY[0].labels.en, 'Black')
  } finally {
    configureColorVocabulary()
  }
})

test('removed color entries cannot produce phantom helper chips or crash combined finishes', () => {
  configureColorVocabulary([])
  try {
    assert.deepEqual(
      getItemColorHints({ description: '颜色：黑白 磨砂黑 黑底' }),
      []
    )
  } finally {
    configureColorVocabulary()
  }
})

test('color rules reject duplicate aliases, missing translations and invalid swatches with the offending rule index', () => {
  const base = () => structuredClone(COLOR_VOCABULARY.slice(0, 2))
  const duplicate = base()
  duplicate[1].aliases.push(duplicate[0].aliases[0])
  assert.throws(
    () => validateColorVocabulary(duplicate),
    (error) => error.ruleIndex === 1 && error.message.includes('黑色')
  )
  const invalid = base()
  invalid[0].swatch = 'url(unsafe)'
  assert.throws(
    () => validateColorVocabulary(invalid),
    (error) => error.ruleIndex === 0
  )
  const blank = base()
  blank[1].labels.es = ''
  assert.throws(
    () => validateColorVocabulary(blank),
    (error) => error.ruleIndex === 1
  )
  assert.throws(() => validateColorVocabulary(Array(501).fill({})), /500/)
  assert.deepEqual(validateColorVocabulary([]), [])
})
