import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COLOR_VOCABULARY,
  COLOR_VOCABULARY_VERSION,
  getItemColorHints,
} from '../src/color-vocabulary.js'

const item = (value, label = '颜色') => ({ skuProperties: [{ label, value }] })
const ids = (value, label) =>
  getItemColorHints(item(value, label)).map((hint) => hint.id)

test('color vocabulary provides unique local rules with all three languages', () => {
  assert.equal(COLOR_VOCABULARY_VERSION, 1)
  assert.ok(COLOR_VOCABULARY.length >= 100)
  assert.equal(
    new Set(COLOR_VOCABULARY.map((entry) => entry.id)).size,
    COLOR_VOCABULARY.length
  )
  const aliases = COLOR_VOCABULARY.flatMap((entry) => entry.aliases)
  assert.equal(new Set(aliases).size, aliases.length)
  for (const entry of COLOR_VOCABULARY) {
    assert.ok(entry.labels.en && entry.labels.zh && entry.labels.es)
    assert.ok(entry.swatch === null || /^#[0-9a-f]{6}$/.test(entry.swatch))
    assert.ok(
      Object.isFrozen(entry) &&
        Object.isFrozen(entry.aliases) &&
        Object.isFrozen(entry.labels)
    )
  }
})

test('hints translate colors without changing imported source values', () => {
  const source = item('深蓝色 40 × 60cm')
  const before = structuredClone(source)
  const en = getItemColorHints(source)
  assert.deepEqual(en, [
    {
      id: 'dark-blue',
      label: 'Dark blue',
      source: '深蓝色',
      kind: 'color',
      swatch: '#36547c',
    },
  ])
  assert.equal(getItemColorHints(source, 'zh')[0].label, '深蓝色')
  assert.equal(getItemColorHints(source, 'es')[0].label, 'Azul oscuro')
  assert.deepEqual(source, before)
})

test('supports UI language aliases and defaults unknown languages to English', () => {
  assert.equal(getItemColorHints(item('红色'), 'CN')[0].label, '红色')
  assert.equal(getItemColorHints(item('红色'), 'zh-CN')[0].label, '红色')
  assert.equal(getItemColorHints(item('红色'), 'SPA')[0].label, 'Rojo')
  assert.equal(getItemColorHints(item('红色'), 'es-PE')[0].label, 'Rojo')
  assert.equal(getItemColorHints(item('红色'), 'unknown')[0].label, 'Red')
})

test('longer shade names win over embedded basic colors', () => {
  assert.deepEqual(ids('浅粉紫'), ['light-pink-purple'])
  assert.deepEqual(ids('香槟金色'), ['champagne-gold'])
  assert.deepEqual(ids('深卡其布色'), ['dark-khaki'])
  assert.deepEqual(ids('奶白色'), ['milk-white'])
  assert.deepEqual(ids('粉红色'), ['pink'])
  assert.deepEqual(ids('蓝绿色'), ['teal'])
  assert.deepEqual(ids('米 白 色'), ['off-white'])
})

test('every bundled alias resolves to its own rule without partial matches', () => {
  for (const entry of COLOR_VOCABULARY) {
    for (const alias of entry.aliases) {
      assert.deepEqual(ids(alias), [entry.id], alias)
    }
  }
})

test('reads specification colors but excludes source title, identifier, and scent fields', () => {
  const source = {
    title: '黑色白色收纳产品',
    productNumber: '红色-123',
    description: '黑色白色收纳产品\n货号: 蓝色123\n香型: 紫色香薰',
    skuProperties: [
      { label: '型号', value: '黄色1' },
      { label: '规格', value: '橙色左手' },
    ],
  }
  assert.deepEqual(
    getItemColorHints(source).map((hint) => hint.id),
    ['orange']
  )
  for (const label of [
    '香型',
    '香味',
    'fragrance',
    'scent',
    '货号',
    '型号',
    '色温',
  ]) {
    assert.deepEqual(ids('蓝色', label), [])
  }
})

test('fragrances, materials, and named models do not become guessed colors', () => {
  for (const value of [
    '紫罗兰香薰',
    '茉莉香氛精油',
    '薰衣草',
    '丁香',
    '黑板',
    '银杏叶',
    '咖啡杯',
    '咖啡屋',
    '红酒杯',
    '粉末',
    '橙子',
    '绿巨人',
    '绿洲',
    'A123',
    '如图',
    '250ml',
  ]) {
    assert.deepEqual(ids(value), [], value)
  }
  assert.deepEqual(ids('咖啡'), ['coffee'])
  assert.deepEqual(ids('咖啡', '规格'), [])
})

test('old descriptions use only labeled variant lines and suppress duplicates', () => {
  const source = {
    title: '黑色商品',
    description: '黑色商品\n颜色：白色\n规格: 蓝色左手\n货号: 红色1',
    skuProperties: [{ label: '颜色', value: '白色' }],
  }
  assert.deepEqual(
    getItemColorHints(source).map((hint) => hint.id),
    ['white', 'blue']
  )
})

test('colors in capacity and other genuine SKU fields are recognized', () => {
  assert.deepEqual(ids('配银色一体盖', '容量'), ['silver'])
  assert.deepEqual(ids('灰色4层', '层数（规格）'), ['gray'])
  assert.deepEqual(
    getItemColorHints({ description: '玻璃杯\n容量: 白色150ML' }).map(
      (hint) => hint.id
    ),
    ['white']
  )
})

test('compound colors preserve multiple color names without a false solid swatch', () => {
  const hints = getItemColorHints(item('黑白花纹'), 'es')
  assert.equal(hints.length, 1)
  assert.equal(hints[0].label, 'Negro / Blanco')
  assert.equal(hints[0].swatch, null)
  assert.deepEqual(ids('灰色+紫色'), ['gray', 'purple'])
  assert.deepEqual(ids('米白黑'), ['combined-off-white-black'])
})

test('gradients, clear finishes, and random assortments have text without solid swatches', () => {
  for (const value of [
    '渐变紫',
    '紫色渐变',
    '透明灰',
    '大号透蓝色',
    '半透灰',
    '灰白拼色',
    '扎染胭脂红',
    '混色',
    '颜色随机发',
    '七彩',
  ]) {
    const hints = getItemColorHints(item(value))
    assert.ok(hints.length, value)
    assert.ok(
      hints.every((hint) => hint.swatch === null),
      value
    )
  }
  assert.deepEqual(ids('渐变紫'), ['gradient', 'purple'])
  assert.deepEqual(ids('半透明'), ['translucent'])
  assert.deepEqual(ids('透明灰'), ['clear', 'gray'])
  assert.deepEqual(ids('磨砂黑'), ['matte', 'black'])
  assert.equal(getItemColorHints(item('12色'), 'es')[0].label, '12 colores')
})

test('finishes and patterns are not presented as exact colors', () => {
  assert.deepEqual(ids('原木色5孔'), ['wood'])
  assert.deepEqual(ids('复古旧色'), ['distressed'])
  assert.deepEqual(ids('8柱,碳烧'), ['charred'])
  assert.deepEqual(ids('条纹'), ['striped'])
  assert.deepEqual(ids('黑格子'), ['black', 'checked'])
  assert.equal(getItemColorHints(item('岩粉'))[0].swatch, null)
})

test('bare colors need an exact color segment or explicit physical component', () => {
  assert.deepEqual(ids('黑'), ['black'])
  assert.deepEqual(ids('黑 / 白'), ['black', 'white'])
  assert.deepEqual(ids('灰底麋鹿'), ['gray'])
  assert.deepEqual(ids('绿盆黄刷'), ['green', 'yellow'])
  assert.deepEqual(ids('黑小号'), ['black'])
  assert.deepEqual(ids('咖啡小狗'), [])
  assert.deepEqual(ids('粉朵朵'), [])
})

test('negated color mentions do not generate misleading chips', () => {
  assert.deepEqual(ids('白色，不是灰色'), ['white'])
  assert.deepEqual(ids('透明，非黑色'), ['clear'])
  assert.deepEqual(ids('白色（不含红色盖）'), ['white'])
})

test('empty and malformed optional data does not create colors', () => {
  for (const source of [
    undefined,
    null,
    {},
    { skuProperties: [] },
    { description: '黑色商品' },
    { skuProperties: [null, {}] },
  ]) {
    assert.deepEqual(getItemColorHints(source), [])
  }
})
