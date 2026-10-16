import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MATERIAL_VOCABULARY,
  MATERIAL_VOCABULARY_VERSION,
  suggestMaterial,
  translateMaterial,
} from '../src/material-vocabulary.js'

test('every material has unique, complete translations and immutable aliases', () => {
  assert.equal(MATERIAL_VOCABULARY_VERSION, 1)
  assert.ok(MATERIAL_VOCABULARY.length >= 60)
  assert.equal(
    new Set(MATERIAL_VOCABULARY.map((entry) => entry.id)).size,
    MATERIAL_VOCABULARY.length
  )
  for (const entry of MATERIAL_VOCABULARY) {
    for (const locale of ['en', 'es', 'zh']) {
      assert.ok(entry[locale])
      assert.equal(translateMaterial(entry.zh, locale), entry[locale])
    }
    assert.ok(Object.isFrozen(entry))
    assert.ok(Object.isFrozen(entry.aliases))
  }
})

test('translates known materials and leaves unfamiliar manual wording intact', () => {
  assert.equal(translateMaterial('玻璃'), 'Glass')
  assert.equal(translateMaterial('玻璃', 'es'), 'Vidrio')
  assert.equal(translateMaterial('Vidrio', 'cn'), '玻璃')
  assert.equal(
    translateMaterial('STAINLESS STEEL', 'es-PE'),
    'Acero inoxidable'
  )
  assert.equal(translateMaterial('材质待确认', 'en'), '材质待确认')
  assert.equal(
    translateMaterial('Glass with a handmade finish', 'es'),
    'Glass with a handmade finish'
  )
  assert.equal(translateMaterial(null), '')
})

test('translates compound materials without discarding unknown components', () => {
  assert.equal(translateMaterial('玻璃 + 铁', 'es'), 'Vidrio + Hierro')
  assert.equal(
    translateMaterial('PP + special coating', 'zh'),
    'PP + special coating'
  )
  assert.equal(translateMaterial('木、玻璃', 'en'), 'Wood、Glass')
  assert.equal(translateMaterial('竹木', 'es'), 'Bambú / madera')
  assert.equal(translateMaterial('Bambú / madera', 'zh'), '竹木')
})

test('explicit material properties take priority over title marketing keywords', () => {
  assert.equal(
    suggestMaterial({
      title: '陶瓷风格杯',
      skuProperties: [{ label: '材质', value: '玻璃' }],
    }),
    '玻璃'
  )
  assert.equal(
    suggestMaterial({
      title: '玻璃杯',
      skuProperties: [{ label: '材质', value: '未注明' }],
    }),
    ''
  )
  assert.equal(suggestMaterial({ title: '木质架子', material: '铁' }), '铁')
  assert.equal(
    suggestMaterial({
      title: '杯子',
      description: '杯子\n材质：玻璃 + 不锈钢',
    }),
    '玻璃 + 不锈钢'
  )
  assert.equal(
    suggestMaterial({
      skuProperties: [{ label: 'Material', value: 'cotton' }],
    }),
    '棉'
  )
})

test('explicit alternatives and negated materials do not become confident suggestions', () => {
  assert.equal(
    suggestMaterial({
      skuProperties: [{ label: '材质', value: '玻璃或陶瓷' }],
    }),
    ''
  )
  assert.equal(
    suggestMaterial({
      skuProperties: [{ label: '材质', value: '不是玻璃，是塑料' }],
    }),
    '塑料'
  )
  assert.equal(suggestMaterial({ description: '材料：随机' }), '')
})

test('uses clear title material names without inferring unstated composition', () => {
  const cases = [
    ['高硼硅玻璃花瓶', '玻璃'],
    ['陶瓷杯子', '陶瓷'],
    ['ABS塑料收纳盒', 'ABS'],
    ['PP棉靠枕', 'PP棉'],
    ['纯棉帆布袋', '棉 + 帆布'],
    ['毛绒玩具', '毛绒'],
    ['棉麻收纳袋', '棉麻'],
    ['仿皮收纳包', '人造革'],
    ['PEVA桌布', 'PEVA'],
    ['木质玻璃相框', '木 + 玻璃'],
    ['橡胶木桌子', '橡胶木'],
    ['铁艺金属花架', '铁'],
    ['带柄陶瓷碗', '陶瓷'],
    ['PEVA盖布桌垫', 'PEVA'],
    ['牛皮纸便签', '牛皮纸'],
    ['仿真塑料花', '塑料'],
    ['TPR宠物球', 'TPR'],
    ['PU鞋垫', 'PU'],
  ]
  for (const [title, expected] of cases)
    assert.equal(suggestMaterial({ title }), expected, title)
  assert.equal(suggestMaterial({ title: '收纳盒' }), '')
})

test('does not mistake colors, finishes and imitations for actual composition', () => {
  const cases = [
    ['水泥灰花盆', ''],
    ['金色银色摆件', ''],
    ['仿金属塑料花盆', '塑料'],
    ['水泥仿老根木头花盆', '水泥'],
    ['仿亚麻橡胶地垫亚麻纹', '橡胶'],
    ['仿藤编塑料藤编篮', '塑料'],
    ['PP藤编织篮', 'PP'],
    ['橡胶木色花架', ''],
  ]
  for (const [title, expected] of cases)
    assert.equal(suggestMaterial({ title }), expected, title)
})

test('does not confuse product uses, characters and accessory material with the main material', () => {
  const cases = [
    ['泡沫洗手液瓶子', ''],
    ['泡沫仿真花', '泡沫'],
    ['海绵宝宝钥匙扣', ''],
    ['玻璃笔', ''],
    ['玻璃刷子海绵清洁刷', '海绵'],
    ['焊接剂胶水粘金属陶瓷木头', ''],
    ['不锈钢空心手柄硅胶厨具', '硅胶'],
    ['玻璃油瓶带不锈钢油嘴', '玻璃'],
    ['竹木盖塑料纸巾盒', '塑料'],
    ['透明玻璃瓶带竹盖', '玻璃'],
  ]
  for (const [title, expected] of cases)
    assert.equal(suggestMaterial({ title }), expected, title)
})

test('rejects conflicting title keywords unless a selected variant identifies one material', () => {
  assert.equal(suggestMaterial({ title: 'TPE加厚PVC乳胶橡胶手套' }), '')
  assert.equal(suggestMaterial({ title: '水泥陶瓷花盆' }), '')
  assert.equal(
    suggestMaterial({
      title: 'PVC或PET收纳盒',
      skuProperties: [{ label: '规格', value: 'PET盒' }],
    }),
    'PET'
  )
  assert.equal(suggestMaterial({ title: 'PVC + ABS复合板' }), 'PVC + ABS')
})

test('variant evidence is limited to useful fields and excludes packaging and identifiers', () => {
  assert.equal(
    suggestMaterial({
      title: '水杯',
      skuProperties: [{ label: '容量', value: '玻璃材质（300ML）' }],
    }),
    '玻璃'
  )
  assert.equal(
    suggestMaterial({
      title: '收纳架',
      skuProperties: [{ label: '颜色', value: '橡胶木色' }],
    }),
    ''
  )
  assert.equal(
    suggestMaterial({
      title: '摆件',
      skuProperties: [{ label: '包装材质', value: '塑料' }],
    }),
    ''
  )
  assert.equal(
    suggestMaterial({
      title: '套装',
      skuProperties: [{ label: '规格', value: '带竹木盖' }],
    }),
    ''
  )
  assert.equal(
    suggestMaterial({
      title: '笔记本',
      skuProperties: [{ label: '货号', value: 'ABS' }],
    }),
    ''
  )
  assert.equal(
    suggestMaterial({
      title: '商品',
      skuProperties: [{ label: '颜色', value: 'Make it Happen 01' }],
    }),
    ''
  )
  assert.equal(
    suggestMaterial({
      title: '商品',
      skuProperties: [{ label: '规格', value: 'ABS123' }],
    }),
    ''
  )
})

test('supports old exports without mutating the item or throwing on absent properties', () => {
  const item = { description: '陶瓷碗\n颜色：白色', skuProperties: [null, {}] }
  const original = structuredClone(item)
  assert.equal(suggestMaterial(item), '陶瓷')
  assert.deepEqual(item, original)
  assert.equal(suggestMaterial(), '')
})
