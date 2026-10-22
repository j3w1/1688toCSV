import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSizeClassifier,
  DEFAULT_SIZE_VOCABULARY,
  resolvePendingSizeMappings,
  suggestPriceSizeMappings,
  validateSizeVocabulary,
} from '../src/size-vocabulary.js'

const classifier = createSizeClassifier()
const codes = (sizes) =>
  classifier.suggest(sizes).map((entry) => entry.sizeSuffix)
const property = (label, value) => ({ label, value })

test('Chinese size names and explicit Latin labels use editable local aliases', () => {
  assert.deepEqual(
    codes(['特别小号', '小号', '中号', '大号', '超大号', '2XL']),
    ['XS', 'S', 'M', 'L', 'XL', '2XL']
  )
  assert.deepEqual(codes(['s', 'M', 'Ｌ', '4XL']), ['S', 'M', 'L', '4XL'])
  assert.deepEqual(codes(['小号', '特别大号']), ['S', 'XL'])
  const local = createSizeClassifier([{ match: '迷你款|XS', suffix: 'A1' }])
  assert.equal(local.suggest(['迷你款', 'unmapped'])[0].sizeSuffix, 'A1')
  assert.equal(local.suggest(['小号', '大号'])[0].needsSizeMapping, true)
  assert.deepEqual(
    createSizeClassifier([])
      .suggest(['10cm', '20cm'])
      .map((entry) => entry.sizeSuffix),
    ['S', 'L']
  )
})

test('size rules validate literal alternatives and reject conflicting aliases', () => {
  const source = [{ match: ' 迷你款 | S ', suffix: ' s1 ' }]
  assert.deepEqual(validateSizeVocabulary(source), [
    { match: '迷你款|S', suffix: 'S1' },
  ])
  assert.equal(source[0].suffix, ' s1 ')
  assert.doesNotThrow(() => validateSizeVocabulary(DEFAULT_SIZE_VOCABULARY))
  for (const invalid of [
    null,
    [{ match: '', suffix: 'S' }],
    [{ match: '小号|', suffix: 'S' }],
    [{ match: '小号', suffix: '' }],
    [{ match: '小号', suffix: 'S-L' }],
    [{ match: '小号', suffix: 'ABCDEFGHIJKLM' }],
    [{ match: '小号|小号', suffix: 'S' }],
    [
      { match: 'Ｓ', suffix: 'S' },
      { match: 's', suffix: 'M' },
    ],
  ])
    assert.throws(() => validateSizeVocabulary(invalid))
  const literal = createSizeClassifier([{ match: 'tiny.*', suffix: 'XS' }])
  assert.equal(literal.suggest(['tiny cup', 'large'])[0].needsSizeMapping, true)
  assert.equal(literal.suggest(['tiny.*', 'large'])[0].sizeSuffix, 'XS')
})

test('comparable two-dimensional sizes ignore material annotations when ranking', () => {
  assert.deepEqual(codes(['50*80cm（硅藻泥）', '30*40cm（硅藻泥二代）']), [
    'L',
    'S',
  ])
  assert.deepEqual(codes(['10×20cm', '10*30cm', '20x30cm']), ['S', 'M', 'L'])
  assert.deepEqual(codes(['0.5m × 0.8m', '300mm x 40cm']), ['L', 'S'])
  assert.deepEqual(codes(['10x10x10cm', '20x20x20cm']), ['S', 'L'])
})

test('scalar units normalize length, capacity and mass without confusing L with liters', () => {
  assert.deepEqual(codes(['1 l', '250 ml']), ['L', 'S'])
  assert.deepEqual(codes(['2cm', '10mm']), ['L', 'S'])
  assert.deepEqual(codes(['1米', '20厘米', '50毫米']), ['L', 'M', 'S'])
  assert.deepEqual(codes(['.25kg', '100克']), ['L', 'S'])
  assert.deepEqual(codes(['1', '2', '3', '4', '5']), [
    'XS',
    'S',
    'M',
    'L',
    'XL',
  ])
})

test('quoted inch measurements compare with inch wording without treating seller codes as sizes', () => {
  assert.deepEqual(codes(['6"', '7.5 in', '8″', '10.5英寸']), [
    'S',
    'M',
    'L',
    'XL',
  ])
  assert.deepEqual(codes(['6"', '15cm']), ['', ''])
  const extracted = classifier.extract({
    skuProperties: [{ label: '货号', value: 'MODEL-10.5"' }],
  })
  assert.equal(extracted.size, '')
})

test('incomparable, tied, mixed and unsupported assortments need an explicit mapping', () => {
  for (const sizes of [
    ['40x50cm', '30x60cm'],
    ['1cm', '10mm'],
    ['0.3m', '30cm'],
    ['20x30cm', '200x300mm'],
    ['10cm', '20ml'],
    ['10cm', '20x30cm'],
    ['10cm', '20cm', '30cm', '40cm', '50cm', '60cm'],
    ['10-20cm', '20-30cm'],
    ['1,5cm', '2,5cm'],
    ['0cm', '10cm'],
    ['-1cm', '-2cm'],
    ['S / M', 'L / XL'],
    ['小号', 'S'],
  ]) {
    assert.ok(
      classifier.suggest(sizes).every((entry) => entry.needsSizeMapping),
      JSON.stringify(sizes)
    )
    assert.deepEqual(
      codes(sizes),
      sizes.map(() => '')
    )
  }
})

test('identical composite sets do not create a size dimension; different sets remain unresolved', () => {
  const set = '50*80+50*120cm（水晶绒）'
  assert.deepEqual(classifier.suggest([set, set]), [
    { sizeSuffix: '', needsSizeMapping: false, reason: '' },
    { sizeSuffix: '', needsSizeMapping: false, reason: '' },
  ])
  assert.ok(
    classifier
      .suggest([set, '40*60+50*120cm（水晶绒）'])
      .every((entry) => entry.needsSizeMapping)
  )
  assert.deepEqual(codes(['40cm', '40cm', '20cm']), ['L', 'L', 'S'])
  assert.deepEqual(codes(['S', 'S']), ['', ''])
  assert.deepEqual(codes(['', '']), ['', ''])
})

test('explicit names remain useful beside a measurement or missing size', () => {
  const result = classifier.suggest(['S', '30cm', ''])
  assert.equal(result[0].sizeSuffix, 'S')
  assert.equal(result[0].needsSizeMapping, false)
  assert.ok(result[1].needsSizeMapping)
  assert.ok(result[2].needsSizeMapping)
})

test('extraction retains material and all other distinguishing non-size attributes', () => {
  const source = {
    title: 'Synthetic mat',
    skuProperties: [
      property('颜色', '米色纹浅边椭圆'),
      property('尺寸', '50*80cm（硅藻泥2代）'),
      property('材质', '混合纤维'),
      property('', 'with hook'),
    ],
  }
  const original = structuredClone(source)
  const result = classifier.extract(source)
  assert.equal(result.size, '50*80cm（硅藻泥2代）')
  assert.equal(result.sizeInfo.kind, 'measurement')
  assert.deepEqual(result.sizeInfo.values, [500, 800])
  assert.deepEqual(result.variantProperties, [
    property('颜色', '米色纹浅边椭圆'),
    property('尺寸说明', '硅藻泥2代'),
    property('材质', '混合纤维'),
    property('', 'with hook'),
  ])
  assert.match(result.variant, /硅藻泥2代/)
  assert.deepEqual(source, original)
})

test('sizes embedded in variant attributes leave the color and set details intact', () => {
  const result = classifier.extract({
    skuProperties: [
      property('颜色', '黑色 小号（12件套）'),
      property('香型', '茉莉'),
    ],
  })
  assert.equal(result.size, '小号')
  assert.equal(result.sizeInfo.suffix, 'S')
  assert.deepEqual(result.variantProperties, [
    property('颜色', '黑色 12件套'),
    property('香型', '茉莉'),
  ])
  const emoji = classifier.extract({
    skuProperties: [property('颜色', '🌿绿色 30cm')],
  })
  assert.equal(emoji.size, '30cm')
  assert.equal(emoji.variantProperties[0].value, '🌿绿色')
})

test('legacy descriptions supply labelled and unlabelled variants without using titles or article numbers', () => {
  const result = classifier.extract({
    title: 'Synthetic 50cm S model',
    description:
      'Synthetic 50cm S model\n颜色: 红色\n尺寸：30*40cm\n货号: XL-50cm',
  })
  assert.equal(result.size, '30*40cm')
  assert.equal(result.variant, '颜色: 红色')
  const unlabelled = classifier.extract({
    title: 'Synthetic cup 500ml',
    description: 'Synthetic cup 500ml\n黑色小号\n货号: S-100',
  })
  assert.equal(unlabelled.size, '小号')
  assert.equal(unlabelled.variant, '黑色')
  const old = classifier.extract({
    description: 'Synthetic 500ml cup\n尺寸: 100ml',
  })
  assert.equal(old.size, '100ml')
  assert.equal(
    classifier.extract({ title: 'S 30cm rug', description: 'S 30cm rug' }).size,
    ''
  )
})

test('model numbers, counts and unrelated words do not manufacture sizes', () => {
  const result = classifier.extract({
    title: 'Synthetic 300ml XL-50cm',
    skuProperties: [
      property('型号', 'XL-50cm'),
      property('颜色', 'SADOER'),
      property('规格', '20入套装'),
      property('材质', 'PET300'),
    ],
  })
  assert.equal(result.size, '')
  assert.equal(result.variantProperties.length, 4)
  const unknown = classifier.extract({
    skuProperties: [property('尺寸', 'short')],
  })
  assert.equal(unknown.size, 'short')
  assert.equal(unknown.variant, '尺寸: short')
})

test('editable measurement aliases can resolve a deliberately custom assortment', () => {
  const result = createSizeClassifier([
    { match: '30*40cm', suffix: 'MAT1' },
    { match: '50*80cm', suffix: 'MAT2' },
  ]).suggest(['50*80cm（防滑）', '30*40cm'])
  assert.deepEqual(
    result.map((entry) => entry.sizeSuffix),
    ['MAT2', 'MAT1']
  )
})

test('additional size labels and full-width dimensions retain their measurement meaning', () => {
  const variants = [
    { skuProperties: [property('尺寸规格', '25Ｘ15Ｘ6')] },
    { skuProperties: [property('尺寸规格', '35Ｘ25Ｘ10')] },
  ].map((item) => classifier.extract(item))
  assert.deepEqual(
    variants.map((entry) => entry.sizeInfo.kind),
    ['measurement', 'measurement']
  )
  assert.deepEqual(codes(variants.map((entry) => entry.size)), ['S', 'L'])
  const frame = classifier.extract({
    skuProperties: [
      property('内框尺寸', '8寸'),
      property('外框尺寸', '玻璃白色'),
    ],
  })
  assert.equal(frame.size, '8寸')
  assert.equal(frame.variant, '外框尺寸: 玻璃白色')
  assert.equal(
    classifier.extract({ skuProperties: [property('长度(CM)', '25')] }).size,
    '25'
  )
})

test('nominal 寸 sizes compare only against the same unit without guessed conversion', () => {
  assert.deepEqual(codes(['7寸', '8寸', '10寸']), ['S', 'M', 'L'])
  assert.deepEqual(codes(['8寸', '20.32cm']), ['', ''])
  assert.ok(
    classifier
      .suggest(['8寸', '20.32cm'])
      .every((entry) => entry.needsSizeMapping)
  )
  assert.deepEqual(codes(['8inch', '10英寸']), ['S', 'L'])
})

test('size labels next to measurements and labelled axes remain recognizable', () => {
  assert.deepEqual(codes(['S40*50cm', 'L50*70cm']), ['S', 'L'])
  assert.deepEqual(codes(['长24*宽24*高7cm', '长30*宽30*高10cm']), ['S', 'L'])
  assert.equal(
    classifier.extract({ skuProperties: [property('颜色', '米色 25*40 黑板')] })
      .size,
    '25*40'
  )
  assert.equal(
    classifier.extract({ skuProperties: [property('型号', '25*40')] }).size,
    ''
  )
})

test('single Chinese size letters are bounded so material and descriptive words are not sizes', () => {
  assert.deepEqual(codes(['小', '中', '大']), ['S', 'M', 'L'])
  assert.deepEqual(codes(['小【整箱装】', '特大【整箱装】']), ['S', 'XL'])
  for (const value of ['金色大肚小花瓶', '小熊香薰', '中国红']) {
    assert.equal(
      classifier.extract({ skuProperties: [property('颜色', value)] }).size,
      ''
    )
  }
})

test('a seller using size fields for colors or packaging keeps them as variant data', () => {
  for (const [label, value] of [
    ['尺寸', '白色'],
    ['尺寸', '两件套'],
    ['容量', '带杯套'],
    ['尺寸', '无盒'],
    ['尺寸', '12个装'],
  ]) {
    const extracted = classifier.extract({
      skuProperties: [property(label, value)],
    })
    assert.equal(extracted.size, '')
    assert.deepEqual(extracted.variantProperties, [property(label, value)])
  }
  const unknown = classifier.extract({
    skuProperties: [property('尺寸', '请看图片')],
  })
  assert.equal(unknown.sizeInfo.kind, 'unknown')
  assert.equal(unknown.variant, '尺寸: 请看图片')
})

test('adjacent range and mass measurements stay composite; shoe ranges stay unresolved', () => {
  const range = classifier.extract({
    skuProperties: [property('尺寸', '3-5cm100克')],
  })
  assert.equal(range.sizeInfo.kind, 'composite')
  const shoe = classifier.extract({
    skuProperties: [property('尺码', '38-39(适合37-38脚)')],
  })
  assert.equal(shoe.size, '38-39(适合37-38脚)')
  assert.ok(
    classifier
      .suggest([shoe.size, '40-41(适合39-40脚)'])
      .every((entry) => entry.needsSizeMapping)
  )
  const set = classifier.extract({
    skuProperties: [property('规格（长*宽cm）', '毛巾35 75浴巾70 140')],
  })
  assert.equal(set.sizeInfo.kind, 'unknown')
})

test('beige color names following numeric style identifiers do not become meters', () => {
  for (const value of ['238米白', '12+18米色', '300米灰']) {
    const result = classifier.extract({
      skuProperties: [property('颜色', value)],
    })
    assert.equal(result.size, '')
    assert.equal(result.variantProperties[0].value, value)
  }
  assert.equal(
    classifier.extract({ skuProperties: [property('尺寸', '30cm*50米')] })
      .sizeInfo.kind,
    'measurement'
  )
})

test('equivalent measurements may share endings only when other variants distinguish them', () => {
  const sizes = ['40*60cm（吸水）', '40cm*60cm（防滑）', '50cm*80cm']
  assert.deepEqual(
    classifier
      .suggest(sizes, ['red', 'blue', 'red'])
      .map((entry) => entry.sizeSuffix),
    ['S', 'S', 'L']
  )
  const sameSize = classifier.suggest(['40*60cm', '400*600mm'], ['red', 'blue'])
  assert.ok(
    sameSize.every((entry) => !entry.needsSizeMapping && !entry.sizeSuffix)
  )
  const collision = classifier.suggest(['40*60cm', '400*600mm'], ['red', 'red'])
  assert.ok(collision.every((entry) => entry.needsSizeMapping))
  assert.throws(() => classifier.suggest(sizes, ['red']), /one variant key/)
})

test('paper sizes retain their explicit source labels', () => {
  assert.deepEqual(codes(['A3', 'A4', 'A5', 'A6']), ['A3', 'A4', 'A5', 'A6'])
  assert.equal(
    classifier.extract({ skuProperties: [property('规格', 'A4')] }).sizeInfo
      .kind,
    'named'
  )
})

function pending(sizes, extra = {}) {
  return {
    groups: [
      {
        id: 'group',
        baseCode: 'CE26100101',
        variants: sizes.map((size, index) => ({
          id: `variant-${index}`,
          entryIds: [String(index)],
          size,
          variantSuffix: '',
          sizeSuffix: '',
          needsSizeMapping: true,
          ...extra,
        })),
      },
    ],
  }
}

test('unresolved saved measurements can gain size endings without changing IDs or issued codes', () => {
  const source = pending(['50*80cm（硅藻泥）', '30*40cm（硅藻泥二代）'])
  const before = structuredClone(source)
  const result = resolvePendingSizeMappings(source)
  assert.deepEqual(result.resolvedVariantIds, ['variant-0', 'variant-1'])
  assert.equal(result.preparation.groups[0].baseCode, 'CE26100101')
  assert.deepEqual(
    result.preparation.groups[0].variants.map((variant) => variant.sizeSuffix),
    ['L', 'S']
  )
  assert.deepEqual(source, before)
})

test('pending resolution preserves manual endings and intentional clears', () => {
  for (const suffix of ['CUSTOM', '']) {
    const source = pending(['10cm', '20cm'], {
      needsSizeMapping: false,
      sizeSuffix: suffix,
    })
    const result = resolvePendingSizeMappings(source)
    assert.deepEqual(result.resolvedVariantIds, [])
    assert.deepEqual(result.preparation, source)
  }
  const source = pending(['10cm', '20cm'])
  source.groups[0].variants[0].sizeSuffix = 'XL'
  source.groups[0].variants[0].needsSizeMapping = false
  assert.deepEqual(resolvePendingSizeMappings(source).preparation, source)
})

test('pending resolution does not create duplicate barcode endings or overwrite unfinished manual input', () => {
  const source = pending(['10cm', '20cm', '20cm'])
  assert.deepEqual(resolvePendingSizeMappings(source).resolvedVariantIds, [])
  source.groups[0].variants[1].variantSuffix = 'A'
  const result = resolvePendingSizeMappings(source)
  assert.deepEqual(result.resolvedVariantIds, [
    'variant-0',
    'variant-1',
    'variant-2',
  ])
  const input = pending(['10cm', '20cm'], { sizeSuffix: 'MANUAL' })
  assert.deepEqual(resolvePendingSizeMappings(input).preparation, input)
})

test('embedded named axes retain complete dimensions and the original style text', () => {
  const item = {
    title: 'Synthetic vase',
    skuProperties: [property('颜色', '#款式四高28.5X直径13cm')],
  }
  const before = structuredClone(item)
  const extracted = classifier.extract(item)
  assert.equal(extracted.size, '高28.5X直径13cm')
  assert.deepEqual(extracted.sizeInfo.axes, ['diameter', 'height'])
  assert.deepEqual(extracted.sizeInfo.values, [130, 285])
  assert.equal(extracted.variant, '颜色: #款式四')
  assert.deepEqual(item, before)
  assert.deepEqual(
    codes(['#款式四高28.5X直径13cm', '#款式五高22X直径10.5cm']),
    ['L', 'S']
  )
})

test('named measurements compare matching axes across reordered axes and normalized units', () => {
  for (const sizes of [
    ['高28.5X直径13cm', '直径105mm×高度22cm'],
    ['直径13cm高28.5cm', '高22cm，直径13cm'],
    ['长30宽20高10cm', '高度8cm×宽度150mm×长度0.2m'],
    ['厚2mm宽3CM长5M', '长5m×厚2mm×宽2cm'],
  ])
    assert.deepEqual(codes(sizes), ['L', 'S'], JSON.stringify(sizes))
  assert.deepEqual(
    codes(['高40直径20cm', '高10直径5cm', '高30直径15cm', '高20直径10cm']),
    ['XL', 'S', 'L', 'M']
  )
})

test('identical complete measurements omit size endings without confusing different styles or prices', () => {
  const styles = ['#款式二 高33X底径10.5cm', '#款式一 高33X底径10.5cm']
  const snapshot = {
    items: styles.map((style, index) => ({
      entryId: String(index),
      title: 'Synthetic vase',
      skuProperties: [property('颜色', style)],
      price: index ? '21.5' : '23.5',
    })),
  }
  const prep = pending(styles)
  for (const [index, variant] of prep.groups[0].variants.entries())
    variant.variantSuffix = index ? 'B' : 'A'
  const before = structuredClone({ prep, snapshot })
  const extracted = snapshot.items.map((item) => classifier.extract(item))
  assert.deepEqual(
    extracted.map((item) => item.sizeInfo.values),
    [
      [105, 330],
      [105, 330],
    ]
  )
  assert.deepEqual(
    extracted.map((item) => item.variant),
    ['颜色: #款式二', '颜色: #款式一']
  )
  const result = resolvePendingSizeMappings(prep, undefined, { snapshot })
  assert.deepEqual(result.resolvedVariantIds, ['variant-0', 'variant-1'])
  assert.deepEqual(
    result.preparation.groups[0].variants.map((variant) => [
      variant.id,
      variant.variantSuffix,
      variant.sizeSuffix,
      variant.needsSizeMapping,
    ]),
    [
      ['variant-0', 'A', '', false],
      ['variant-1', 'B', '', false],
    ]
  )
  assert.deepEqual(suggestPriceSizeMappings(prep.groups[0], snapshot), [])
  assert.deepEqual({ prep, snapshot }, before)
})

test('an explicit no-size override suppresses automatic and price suggestions only for its group', () => {
  const prep = pending(['10cm', '20cm'])
  const automatic = structuredClone(prep.groups[0])
  automatic.id = 'automatic'
  automatic.variants.forEach((variant) => {
    variant.id += '-automatic'
  })
  prep.groups[0].sizeMode = 'none'
  prep.groups.push(automatic)
  const result = resolvePendingSizeMappings(prep)
  assert.deepEqual(result.preparation.groups[0], prep.groups[0])
  assert.deepEqual(result.resolvedVariantIds, [
    'variant-0-automatic',
    'variant-1-automatic',
  ])
  const { group, snapshot } = priceCandidates()
  group.sizeMode = 'none'
  assert.deepEqual(suggestPriceSizeMappings(group, snapshot), [])
})

test('different, crossed, incomplete and duplicate axes never rank by one dimension or price', () => {
  for (const sizes of [
    ['高28.5X直径10cm', '高22X直径13cm'],
    ['高30cm', '宽20cm'],
    ['高30X底径13cm', '高20X直径10cm'],
    ['高30X口径13cm', '高20X底径10cm'],
    ['高30X13cm', '高20X10cm'],
    ['高30X高13cm', '高20X高10cm'],
    ['长10ml', '长20ml'],
    ['高30cm', '20cm'],
    ['高-10cm', '高-20cm'],
  ])
    assert.ok(
      classifier.suggest(sizes).every((entry) => entry.needsSizeMapping),
      JSON.stringify(sizes)
    )
  const negative = classifier.extract({
    skuProperties: [property('颜色', '高-10cm')],
  })
  assert.equal(negative.size, '高-10cm')
  assert.equal(negative.sizeInfo.kind, 'ambiguous')
  assert.deepEqual(codes(['S高28.5X直径13cm', 'L高22X直径10.5cm']), ['S', 'L'])
  assert.deepEqual(
    createSizeClassifier([{ match: '高28.5X直径13cm', suffix: 'CUSTOM' }])
      .suggest(['高28.5X直径13cm', 'unknown'])
      .map((entry) => entry.sizeSuffix),
    ['CUSTOM', '']
  )
})

test('source reanalysis resolves only selected unfinished variants and does not compare merged products', () => {
  const prep = pending(['unrecognized height', 'unrecognized height'])
  const snapshot = {
    items: [
      {
        entryId: '0',
        title: 'Synthetic vase',
        skuProperties: [property('尺寸', '高28.5X直径13cm')],
      },
      {
        entryId: '1',
        title: 'Synthetic vase',
        skuProperties: [property('尺寸', '高22X直径10.5cm')],
      },
    ],
  }
  const before = structuredClone(prep)
  const result = resolvePendingSizeMappings(prep, undefined, {
    snapshot,
    entryIds: ['0'],
  })
  assert.deepEqual(result.resolvedVariantIds, ['variant-0'])
  assert.equal(result.preparation.groups[0].variants[0].sizeSuffix, 'L')
  assert.deepEqual(
    result.preparation.groups[0].variants[1],
    prep.groups[0].variants[1]
  )
  assert.deepEqual(prep, before)
  snapshot.items[1].title = 'Different source product'
  assert.deepEqual(
    resolvePendingSizeMappings(prep, undefined, { snapshot })
      .resolvedVariantIds,
    []
  )
})

test('source reanalysis refuses inconsistent shared sizes and leaves partially selected shared variants unchanged', () => {
  const prep = pending(['unrecognized height', 'unrecognized height'])
  prep.groups[0].variants[0].entryIds.push('extra')
  const snapshot = {
    items: [
      {
        entryId: '0',
        title: 'Synthetic vase',
        skuProperties: [property('尺寸', '高28.5X直径13cm')],
      },
      {
        entryId: 'extra',
        title: 'Synthetic vase',
        skuProperties: [property('尺寸', '高28.5X直径13cm')],
      },
      {
        entryId: '1',
        title: 'Synthetic vase',
        skuProperties: [property('尺寸', '高22X直径10.5cm')],
      },
    ],
  }
  const partial = resolvePendingSizeMappings(prep, undefined, {
    snapshot,
    entryIds: ['0', '1'],
  })
  assert.deepEqual(partial.resolvedVariantIds, ['variant-1'])
  assert.deepEqual(
    partial.preparation.groups[0].variants[0],
    prep.groups[0].variants[0]
  )
  snapshot.items[1].skuProperties[0].value = '高24X直径11cm'
  assert.deepEqual(
    resolvePendingSizeMappings(prep, undefined, { snapshot })
      .resolvedVariantIds,
    []
  )
})

function priceCandidates(sizes = ['待确认尺寸甲', '待确认尺寸乙']) {
  const group = pending(sizes).groups[0]
  return {
    group,
    snapshot: {
      items: sizes.map((size, index) => ({
        entryId: String(index),
        title: 'Synthetic vase',
        productNumber: 'SYNTHETIC-1',
        skuProperties: [property('颜色', '白色'), property('尺寸', size)],
        price: index ? '18.90' : '12.50',
      })),
    },
  }
}

test('two otherwise matching unknown sizes receive only reviewable exact unit-price suggestions', () => {
  const { group, snapshot } = priceCandidates()
  const before = structuredClone({ group, snapshot })
  assert.deepEqual(suggestPriceSizeMappings(group, snapshot), [
    { variantId: 'variant-0', price: '12.50', sizeSuffix: 'S' },
    { variantId: 'variant-1', price: '18.90', sizeSuffix: 'L' },
  ])
  snapshot.items[0].price = '0.101'
  snapshot.items[1].price = '0.1001'
  assert.deepEqual(
    suggestPriceSizeMappings(group, snapshot).map((item) => item.sizeSuffix),
    ['L', 'S']
  )
  assert.deepEqual(group, before.group)
})

test('price suggestions refuse real size evidence, ranges, differing materials/models and manual endings', () => {
  for (const sizes of [
    ['高28.5X直径10cm', '高22X直径13cm'],
    ['10-20cm', '20-30cm'],
    ['5/10cm', '20/30cm'],
    ['38-39(适合37-38脚)', '40-41(适合39-40脚)'],
    ['S', 'L'],
    ['10cm', '20cm'],
    ['未知尺寸10', '未知尺寸20'],
    ['待确认尺寸', '待确认尺寸'],
  ]) {
    const { group, snapshot } = priceCandidates(sizes)
    assert.deepEqual(
      suggestPriceSizeMappings(group, snapshot),
      [],
      JSON.stringify(sizes)
    )
  }
  for (const mutate of [
    ({ group }) => {
      group.variants[0].needsSizeMapping = false
    },
    ({ group }) => {
      group.variants[0].sizeSuffix = 'MANUAL'
    },
    ({ snapshot }) => {
      snapshot.items[1].productNumber = 'OTHER'
    },
    ({ snapshot }) => {
      snapshot.items[1].title = 'Other source product'
    },
    ({ snapshot }) => {
      snapshot.items[1].skuProperties.push(property('材质', '木'))
    },
    ({ snapshot }) => {
      snapshot.items[1].skuProperties[0].value = '黑色'
    },
    ({ snapshot }) => {
      snapshot.items[1].price = '12.50'
    },
    ({ snapshot }) => {
      snapshot.items[1].price = '0'
    },
    ({ group, snapshot }) => {
      group.variants[0].entryIds.push('extra')
      snapshot.items.push({
        ...snapshot.items[0],
        entryId: 'extra',
        price: '13.00',
      })
    },
    ({ group, snapshot }) => {
      group.variants[0].entryIds.push('extra')
      snapshot.items.push({
        ...snapshot.items[0],
        entryId: 'extra',
        skuProperties: [
          property('颜色', '白色'),
          property('尺寸', '待确认尺寸丙'),
        ],
      })
    },
  ]) {
    const candidate = priceCandidates()
    mutate(candidate)
    assert.deepEqual(
      suggestPriceSizeMappings(candidate.group, candidate.snapshot),
      []
    )
  }
  const { group, snapshot } = priceCandidates()
  assert.deepEqual(
    suggestPriceSizeMappings(group, snapshot, [
      { match: '待确认尺寸甲', suffix: 'CUSTOM' },
    ]),
    []
  )
})
