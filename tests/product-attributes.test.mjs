import test from 'node:test'
import assert from 'node:assert/strict'
import {
  productAttributes,
  translateAttribute,
} from '../src/product-attributes.js'

test('structured fields take precedence and retain original values and raw lines', () => {
  const item = {
    title: '示例摆件',
    description: '示例摆件\n颜色： 绿色\n规格：14*65CM\n货号: 001-A',
    productNumber: '001-A',
    skuProperties: [
      { label: '颜色', value: '绿色', raw: '颜色： 绿色' },
      { label: '规格', value: '14*65CM', raw: '规格：14*65CM' },
    ],
  }
  const parsed = productAttributes(item)
  assert.equal(parsed.description, item.description)
  assert.equal(parsed.fields.length, 3)
  assert.deepEqual(parsed.fields[0], {
    label: '颜色',
    value: '绿色',
    raw: '颜色： 绿色',
    kind: 'color',
  })
  assert.deepEqual(translateAttribute(parsed.fields[1]).measurement, {
    numberText: '14*65',
    unit: 'CM',
  })
  assert.equal(translateAttribute(parsed.fields[1]).label, 'Specifications')
  assert.equal(translateAttribute(parsed.fields[2], 'es').label, 'Código')
})

test('legacy and free-text lines are retained without interpreting the title as properties', () => {
  const parsed = productAttributes({
    description:
      '示例标题\n颜色：米白色\n这一行是原始备注\n型号: A-14CM\n货号: 007',
  })
  assert.equal(parsed.title, '示例标题')
  assert.deepEqual(
    parsed.fields.map(({ label, value }) => [label, value]),
    [
      ['颜色', '米白色'],
      ['', '这一行是原始备注'],
      ['型号', 'A-14CM'],
      ['货号', '007'],
    ]
  )
  assert.equal(parsed.fields[1].kind, 'text')
  assert.equal(
    translateAttribute(parsed.fields[1], 'es').value,
    '这一行是原始备注'
  )
  assert.equal(translateAttribute(parsed.fields[2]).measurement, null)
})

test('color and size helpers translate conservatively without modifying source', () => {
  const source = {
    label: '封面颜色',
    value: '绿色（中号）',
    raw: '封面颜色:绿色（中号）',
    kind: 'color',
  }
  const translated = translateAttribute(source, 'es')
  assert.equal(translated.label, 'Color de portada')
  assert.equal(translated.value, 'Verde（Mediano）')
  assert.equal(translated.originalValue, source.value)
  assert.equal(translated.originalLabel, source.label)
  assert.equal(translated.raw, source.raw)
  assert.equal(translated.colors[0].label, 'Verde')
  assert.equal(source.value, '绿色（中号）')
  assert.equal(translateAttribute(source, 'zh').value, source.value)
  assert.equal(
    translateAttribute({
      label: '颜色',
      value: '小熊（站立款）',
      kind: 'color',
    }).value,
    '小熊（Standing）'
  )
  assert.equal(
    translateAttribute({ label: '颜色', value: '未知名字', kind: 'color' })
      .value,
    '未知名字'
  )
})

test('only whole size measurements split units, never identifiers or complex measurements', () => {
  for (const value of ['14*65CM', '0.5L', '2000毫升', '30 × 50 cm']) {
    assert.ok(translateAttribute({ label: '尺寸', value }).measurement)
  }
  for (const value of [
    '14cm*65cm',
    '30-50cm',
    '30*50cm+枕头',
    'ABC-14CM',
    '14*65',
    '30*50cm（含框）',
  ]) {
    assert.equal(translateAttribute({ label: '尺寸', value }).measurement, null)
  }
  for (const label of ['货号', '型号', '传输模式'])
    assert.equal(
      translateAttribute({ label, value: '14*65CM' }).measurement,
      null
    )
})

test('all observed attribute labels have short English and Spanish helpers', () => {
  const observed = [
    '颜色',
    '规格',
    '货号',
    '尺码',
    '容量',
    '层数（规格）',
    '尺寸',
    '功率',
    '色温',
    '笔芯颜色',
    '传输模式',
    '型号',
    '封面颜色',
    '规格（长*宽cm）',
    '尺寸规格',
    '内框尺寸',
    '外框尺寸',
    '规格型号',
    '画笔颜色',
    '长度(CM)',
    '规格（长*宽）',
    '花型',
    '高度',
    '灯光颜色',
    '光源功率',
    '双层厚度',
    '外观颜色',
    '铅芯颜色',
    '铅芯硬度',
    '笔头形状',
    '内页页数',
    '形状',
    '颜色分类',
    '图片',
    '包装规格',
    '笔头',
    '规格分类',
    '产品颜色',
    '香型',
  ]
  for (const label of observed) {
    for (const language of ['en', 'es'])
      assert.notEqual(
        translateAttribute({ label, value: '示例' }, language).label,
        label
      )
    assert.equal(
      translateAttribute({ label, value: '示例' }, 'zh').label,
      label
    )
  }
})

test('unknown labels and source spacing remain available for exact copying', () => {
  const source = {
    title: '示例',
    description: '示例\n自定义:  原始值  ',
    skuProperties: [
      { label: '自定义', value: ' 原始值  ', raw: '自定义:  原始值  ' },
    ],
  }
  const parsed = productAttributes(source)
  assert.equal(parsed.fields.length, 1)
  assert.equal(parsed.fields[0].value, ' 原始值  ')
  assert.equal(translateAttribute(parsed.fields[0], 'es').value, ' 原始值  ')
  assert.equal(translateAttribute(parsed.fields[0], 'es').label, '自定义')
})

test('deduplication preserves distinguishable model codes and empty raw properties', () => {
  const { fields } = productAttributes({
    title: '示例',
    skuProperties: ['A B', 'AB', 'ab'].map((value) => ({
      label: '型号',
      value,
      raw: '',
    })),
  })
  assert.deepEqual(
    fields.map(({ value }) => value),
    ['A B', 'AB', 'ab']
  )
})

test('legacy inline attributes deduplicate structured data without splitting free text', () => {
  const source = {
    title: '示例',
    description: '示例\n颜色：原色 · 尺寸：中号\n款式：春日 · 花园',
    skuProperties: [
      { label: '颜色', value: '原色' },
      { label: '尺寸', value: '中号' },
    ],
  }
  const parsed = productAttributes(source)
  assert.deepEqual(
    parsed.fields.map(({ label, value }) => [label, value]),
    [
      ['颜色', '原色'],
      ['尺寸', '中号'],
      ['款式', '春日 · 花园'],
    ]
  )
  assert.equal(parsed.description, source.description)
})

test('ambiguous color names do not rewrite similar product words', () => {
  assert.equal(
    translateAttribute({ label: '颜色', value: '咖啡 / 咖啡杯' }).value,
    'Coffee brown / 咖啡杯'
  )
  assert.equal(
    translateAttribute({ label: '颜色', value: '红 / 红包' }).value,
    'Red / 红包'
  )
  assert.equal(
    translateAttribute({ label: '颜色', value: '不要白色，红色' }).value,
    '不要白色，Red'
  )
})

test('Chinese explicit units use standard display symbols without changing source', () => {
  const field = { label: '规格', value: '14*65厘米', raw: '规格：14*65厘米' }
  assert.deepEqual(translateAttribute(field).measurement, {
    numberText: '14*65',
    unit: 'cm',
  })
  assert.deepEqual(translateAttribute(field, 'zh').measurement, {
    numberText: '14*65',
    unit: '厘米',
  })
  assert.equal(translateAttribute(field, 'es').originalValue, '14*65厘米')
  assert.equal(
    translateAttribute({ label: '规格', value: '14*65CM' }).measurement.unit,
    'CM'
  )
})
