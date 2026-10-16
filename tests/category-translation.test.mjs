import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_VOCABULARY } from '../src/product-vocabulary.js'
import { translateCategory } from '../src/category-translation.js'

test('Every bundled category has deliberate English and Spanish display translations', () => {
  const categories = new Set(DEFAULT_VOCABULARY.map((entry) => entry.category))
  for (const category of categories) {
    assert.notEqual(
      translateCategory(category, 'en'),
      category,
      `English: ${category}`
    )
    assert.notEqual(
      translateCategory(category, 'es'),
      category,
      `Spanish: ${category}`
    )
    assert.equal(translateCategory(category, 'zh'), category)
  }
})

test('Category translation keeps broad categories generic and does not reclassify products', () => {
  assert.equal(translateCategory('毛绒玩具'), 'Plush toy')
  assert.equal(translateCategory('圣诞树'), 'Christmas tree')
  assert.equal(translateCategory('香薰'), 'Diffuser')
  assert.equal(translateCategory('手套'), 'Gloves')
  assert.equal(translateCategory('网络设备'), 'Network equipment')
  assert.equal(translateCategory('宠物用品', 'es'), 'ACCESORIOS PARA MASCOTAS')
  assert.equal(translateCategory('积木', 'es'), 'BLOQUES DE CONSTRUCCIÓN')
})

test('Unknown or manually customized category values stay exactly as authored', () => {
  for (const value of [
    '玻璃',
    ' My category ',
    '香薰 / 特别款',
    'SPECIAL TOY',
    '',
  ])
    for (const language of ['en', 'es', 'zh'])
      assert.equal(translateCategory(value, language), value)
  assert.equal(translateCategory(null), '')
})
