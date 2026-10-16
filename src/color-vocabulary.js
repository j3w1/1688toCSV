// Local translation helpers only. A hint never changes imported text, label
// names, grouping, or codes. Swatches are illustrative, not seller color samples.
export const COLOR_VOCABULARY_VERSION = 1

// Longer aliases take precedence. Bare single characters and ambiguous nouns
// (for example 咖啡) are accepted only as complete color-field values.
const definitions = [
  [
    'black',
    '黑色|黑|墨色|纯黑|全黑|经典黑|商务黑|北欧黑|钢琴黑|神秘黑|曜夜黑|雅致黑',
    '黑色',
    'Black',
    'Negro',
    '#292724',
  ],
  ['white', '白色|白|纯白|经典白|全白', '白色', 'White', 'Blanco', '#f6f4ee'],
  [
    'gray',
    '灰色|灰|纯灰|水泥灰|古典灰|高级灰|静谧灰|北欧灰',
    '灰色',
    'Gray',
    'Gris',
    '#8d8e8b',
  ],
  [
    'light-gray',
    '浅灰色|浅灰|淡灰色|淡灰',
    '浅灰色',
    'Light gray',
    'Gris claro',
    '#c1c2bd',
  ],
  [
    'dark-gray',
    '深灰色|深灰|烟灰色|烟灰|炭灰色|炭灰',
    '深灰色',
    'Dark gray',
    'Gris oscuro',
    '#62635f',
  ],
  [
    'silver-gray',
    '银灰色|银灰|枪灰色|枪灰',
    '银灰色',
    'Silver gray',
    'Gris plata',
    '#969e9f',
  ],
  [
    'off-white',
    '米白色|米白|北欧米白',
    '米白色',
    'Off-white',
    'Blanco roto',
    '#eee8d7',
  ],
  [
    'milk-white',
    '奶白色|奶白|乳白色|乳白',
    '乳白色',
    'Milky white',
    'Blanco leche',
    '#f5f0e2',
  ],
  [
    'pearl-white',
    '珍珠白色|珍珠白',
    '珍珠白',
    'Pearl white',
    'Blanco perla',
    '#f0ede6',
  ],
  ['ivory', '象牙白色|象牙白|象牙色', '象牙白', 'Ivory', 'Marfil', '#f1e9ce'],
  ['cream', '奶油色|奶油白|奶黄色|奶黄', '奶油色', 'Cream', 'Crema', '#f2e0af'],
  ['beige', '米色|米黄|米黄色', '米色', 'Beige', 'Beige', '#d6c8a6'],
  [
    'light-beige',
    '浅米色|浅米',
    '浅米色',
    'Light beige',
    'Beige claro',
    '#e7dcc6',
  ],
  [
    'apricot',
    '奶杏色|杏色|杏黄色',
    '杏色',
    'Apricot',
    'Albaricoque',
    '#eccba6',
  ],
  ['khaki', '卡其色|卡其|卡其布色', '卡其色', 'Khaki', 'Caqui', '#b6aa84'],
  [
    'dark-khaki',
    '深卡其布色|深卡其色|深卡其',
    '深卡其色',
    'Dark khaki',
    'Caqui oscuro',
    '#938564',
  ],
  ['camel', '驼色|驼', '驼色', 'Camel', 'Camel', '#ba936b'],
  [
    'light-camel',
    '浅驼色|浅驼',
    '浅驼色',
    'Light camel',
    'Camel claro',
    '#d2b38a',
  ],
  ['brown', '棕色|褐色|啡色|棕|褐', '棕色', 'Brown', 'Marrón', '#8d6447'],
  [
    'coffee',
    '咖啡色|咖色|咖啡|咖|经典咖色',
    '咖啡色',
    'Coffee brown',
    'Café',
    '#77563e',
  ],
  [
    'light-coffee',
    '浅咖啡色|浅咖色|浅咖',
    '浅咖色',
    'Light coffee',
    'Café claro',
    '#b39476',
  ],
  [
    'dark-coffee',
    '深咖啡色|深咖色|深咖',
    '深咖色',
    'Dark coffee',
    'Café oscuro',
    '#594231',
  ],
  [
    'light-brown',
    '浅棕色|浅棕|浅褐色',
    '浅棕色',
    'Light brown',
    'Marrón claro',
    '#b5936b',
  ],
  [
    'dark-brown',
    '深棕色|深棕|深褐色',
    '深棕色',
    'Dark brown',
    'Marrón oscuro',
    '#604535',
  ],
  ['umber', '棕褐色|棕褐', '棕褐色', 'Umber', 'Pardo', '#786049'],
  ['mocha', '摩卡棕|摩卡色', '摩卡棕', 'Mocha', 'Moca', '#98735c'],
  ['amber', '琥珀棕|琥珀色', '琥珀色', 'Amber', 'Ámbar', '#b78339'],
  ['tea-brown', '茶色|茶褐色', '茶色', 'Tea brown', 'Marrón té', '#aa8055'],
  ['red', '红色|红|大红色|大红|艳红|烈焰红', '红色', 'Red', 'Rojo', '#ca4445'],
  [
    'light-red',
    '浅红色|浅红|淡红色',
    '浅红色',
    'Light red',
    'Rojo claro',
    '#df8b89',
  ],
  [
    'burgundy',
    '酒红色|酒红|绛红色|绛红|枣红色|枣红',
    '酒红色',
    'Burgundy',
    'Burdeos',
    '#7a3441',
  ],
  [
    'brick-red',
    '砖红色|砖红',
    '砖红色',
    'Brick red',
    'Rojo ladrillo',
    '#af5c4e',
  ],
  ['carmine', '胭脂红|胭红色', '胭脂红', 'Carmine', 'Carmín', '#ad4957'],
  [
    'vermilion',
    '朱砂红色|朱砂红',
    '朱砂红',
    'Vermilion',
    'Bermellón',
    '#c95c47',
  ],
  [
    'red-brown',
    '红棕色|红棕|茶红',
    '红棕色',
    'Reddish brown',
    'Marrón rojizo',
    '#9f5846',
  ],
  [
    'orange-red',
    '橙红色|橙红|桔红色|桔红',
    '橙红色',
    'Orange-red',
    'Rojo anaranjado',
    '#e66f46',
  ],
  [
    'watermelon-red',
    '西瓜红色|西瓜红',
    '西瓜红',
    'Watermelon red',
    'Rojo sandía',
    '#e75e68',
  ],
  [
    'pink',
    '粉红色|粉红|粉色|粉|北欧粉|英伦粉|公主粉|真爱粉|韩粉色',
    '粉色',
    'Pink',
    'Rosa',
    '#e5a8b8',
  ],
  [
    'light-pink',
    '浅粉色|浅粉|淡粉色|淡粉|水粉色|水粉',
    '浅粉色',
    'Light pink',
    'Rosa claro',
    '#f1c7d1',
  ],
  ['dark-pink', '深粉色|深粉', '深粉色', 'Dark pink', 'Rosa oscuro', '#bc6389'],
  [
    'rose-pink',
    '玫瑰粉色|玫瑰粉|玫粉色|玫粉',
    '玫瑰粉',
    'Rose pink',
    'Rosa rosado',
    '#d693a6',
  ],
  [
    'dusty-pink',
    '藕粉色|藕粉|烟粉色|烟粉|旧粉|皮粉|豆沙色|豆沙',
    '藕粉色',
    'Dusty pink',
    'Rosa empolvado',
    '#c89b9f',
  ],
  [
    'blush',
    '肉粉色|肉粉|米粉色|奶粉色|奶粉',
    '肉粉色',
    'Blush pink',
    'Rosa pálido',
    '#ebc3b4',
  ],
  [
    'cherry-pink',
    '樱花粉色|樱花粉',
    '樱花粉',
    'Cherry-blossom pink',
    'Rosa cerezo',
    '#efc0cc',
  ],
  ['stone-pink', '岩粉', '岩粉', 'Stone pink', 'Rosa piedra', null],
  [
    'peach',
    '蜜桃粉|蜜桃色|桃粉色|桃色|桃|浅桃|香槟桃',
    '蜜桃色',
    'Peach',
    'Melocotón',
    '#efb4a0',
  ],
  ['coral', '珊瑚粉色|珊瑚粉|珊瑚色', '珊瑚色', 'Coral', 'Coral', '#e58e80'],
  [
    'watermelon-pink',
    '西瓜粉色|西瓜粉',
    '西瓜粉',
    'Watermelon pink',
    'Rosa sandía',
    '#e58f9e',
  ],
  [
    'fuchsia',
    '玫红色|玫红|玫色|品红色|品红',
    '玫红色',
    'Fuchsia',
    'Fucsia',
    '#bc4280',
  ],
  [
    'orange',
    '橙色|橘色|桔色|橙|桔|橘|果粒橙|水果橙',
    '橙色',
    'Orange',
    'Naranja',
    '#eb9748',
  ],
  [
    'light-orange',
    '浅橙色|浅桔色|浅橘色|浅橙|浅桔',
    '浅橙色',
    'Light orange',
    'Naranja claro',
    '#f0ba7e',
  ],
  ['yellow', '黄色|黄|香黄', '黄色', 'Yellow', 'Amarillo', '#e7c84e'],
  [
    'light-yellow',
    '浅黄色|浅黄|淡黄色|淡黄',
    '浅黄色',
    'Light yellow',
    'Amarillo claro',
    '#eee1a5',
  ],
  [
    'lemon-yellow',
    '柠檬黄色|柠檬黄',
    '柠檬黄',
    'Lemon yellow',
    'Amarillo limón',
    '#e4d84f',
  ],
  ['mustard', '姜黄色|姜黄|芥末黄', '姜黄色', 'Mustard', 'Mostaza', '#c39d36'],
  [
    'green',
    '绿色|緑色|绿|北欧绿色|北欧绿|新中绿',
    '绿色',
    'Green',
    'Verde',
    '#719164',
  ],
  [
    'light-green',
    '浅绿色|浅绿|淡绿色|淡绿|嫩绿色|嫩绿',
    '浅绿色',
    'Light green',
    'Verde claro',
    '#adc995',
  ],
  [
    'dark-green',
    '深绿色|深绿|墨绿色|墨绿',
    '深绿色',
    'Dark green',
    'Verde oscuro',
    '#3e6754',
  ],
  [
    'mint',
    '薄荷绿色|薄荷绿|薄荷色',
    '薄荷绿',
    'Mint green',
    'Verde menta',
    '#9ac6b1',
  ],
  [
    'matcha',
    '抹茶绿色|抹茶绿|茶绿',
    '抹茶绿',
    'Matcha green',
    'Verde matcha',
    '#9eae7e',
  ],
  [
    'olive',
    '橄榄绿色|橄榄绿',
    '橄榄绿',
    'Olive green',
    'Verde oliva',
    '#899262',
  ],
  [
    'army-green',
    '军绿色|军绿',
    '军绿色',
    'Army green',
    'Verde militar',
    '#727a54',
  ],
  [
    'pine-green',
    '松柏绿色|松柏绿|松绿色|松绿',
    '松柏绿',
    'Pine green',
    'Verde pino',
    '#496c5b',
  ],
  [
    'avocado',
    '牛油果绿色|牛油果绿|牛油果色',
    '牛油果绿',
    'Avocado green',
    'Verde aguacate',
    '#a7b879',
  ],
  [
    'apple-green',
    '苹果绿色|苹果绿',
    '苹果绿',
    'Apple green',
    'Verde manzana',
    '#a8c56e',
  ],
  [
    'sage',
    '豆绿色|豆绿|香草绿|海藻绿',
    '豆绿',
    'Soft green',
    'Verde suave',
    '#a4b68c',
  ],
  [
    'pastel-green',
    '马卡龙绿',
    '马卡龙绿',
    'Pastel green',
    'Verde pastel',
    '#b4d5b1',
  ],
  ['cyan', '青色|青碧|青绿色|青绿', '青色', 'Cyan', 'Cian', '#71b4ad'],
  ['teal', '蓝绿色|蓝绿', '蓝绿色', 'Teal', 'Verde azulado', '#528f91'],
  ['blue', '蓝色|蓝|北欧蓝|静谧蓝|海洋蓝', '蓝色', 'Blue', 'Azul', '#648db9'],
  [
    'light-blue',
    '浅蓝色|浅蓝|淡蓝色|淡蓝',
    '浅蓝色',
    'Light blue',
    'Azul claro',
    '#a1c6df',
  ],
  [
    'sky-blue',
    '天蓝色|天蓝|天兰色|天兰|天空蓝',
    '天蓝色',
    'Sky blue',
    'Azul cielo',
    '#85bed9',
  ],
  [
    'dusty-blue',
    '雾霾蓝|烟雾蓝|烟蓝',
    '雾霾蓝',
    'Dusty blue',
    'Azul grisáceo',
    '#8195ad',
  ],
  ['stone-blue', '岩蓝', '岩蓝', 'Stone blue', 'Azul piedra', null],
  ['lake-blue', '湖蓝色|湖蓝', '湖蓝色', 'Lake blue', 'Azul lago', '#589fb5'],
  [
    'peacock-blue',
    '孔雀蓝色|孔雀蓝',
    '孔雀蓝',
    'Peacock blue',
    'Azul pavo real',
    '#407e99',
  ],
  [
    'royal-blue',
    '宝石蓝|宝蓝色|宝蓝',
    '宝蓝色',
    'Royal blue',
    'Azul real',
    '#3869a4',
  ],
  ['dark-blue', '深蓝色|深蓝', '深蓝色', 'Dark blue', 'Azul oscuro', '#36547c'],
  [
    'navy',
    '藏青色|藏青|藏蓝色|藏蓝|海军蓝|玄青',
    '藏青色',
    'Navy',
    'Azul marino',
    '#343e57',
  ],
  ['indigo', '靛蓝色|靛蓝', '靛蓝', 'Indigo', 'Índigo', '#595b94'],
  ['purple', '紫色|紫|琉璃紫|罗曼紫', '紫色', 'Purple', 'Morado', '#9279ad'],
  [
    'light-purple',
    '浅紫色|浅紫|淡紫色|淡紫|香芋紫|香芋色',
    '浅紫色',
    'Light purple',
    'Lila',
    '#bca8ce',
  ],
  [
    'dark-purple',
    '深紫色|深紫|酱紫色|酱紫',
    '深紫色',
    'Dark purple',
    'Morado oscuro',
    '#75536f',
  ],
  [
    'red-purple',
    '紫红色|紫红',
    '紫红色',
    'Reddish purple',
    'Morado rojizo',
    '#a45b91',
  ],
  [
    'pink-purple',
    '粉紫色|粉紫|英伦粉紫',
    '粉紫色',
    'Pink-purple',
    'Rosa violáceo',
    '#c392bb',
  ],
  [
    'light-pink-purple',
    '浅粉紫',
    '浅粉紫',
    'Light pink-purple',
    'Rosa violáceo claro',
    '#d8b8d2',
  ],
  [
    'dark-pink-purple',
    '深粉紫',
    '深粉紫',
    'Dark pink-purple',
    'Rosa violáceo oscuro',
    '#9c6c94',
  ],
  [
    'gray-purple',
    '灰紫色|灰紫',
    '灰紫色',
    'Gray-purple',
    'Gris violáceo',
    '#a196aa',
  ],
  ['gold', '金色|金', '金色', 'Gold', 'Dorado', '#c9aa61'],
  ['silver', '银色|银白色|银', '银色', 'Silver', 'Plateado', '#c5c8c8'],
  ['champagne', '香槟色|香槟', '香槟色', 'Champagne', 'Champán', '#ddc49a'],
  [
    'champagne-gold',
    '香槟金色|香槟金',
    '香槟金',
    'Champagne gold',
    'Dorado champán',
    '#cfb176',
  ],
  [
    'champagne-pink',
    '香槟粉色|香槟粉',
    '香槟粉',
    'Champagne pink',
    'Rosa champán',
    '#dcb8a9',
  ],
  [
    'light-champagne',
    '浅香槟',
    '浅香槟',
    'Light champagne',
    'Champán claro',
    '#e7d6b6',
  ],
  [
    'dark-champagne',
    '深香槟',
    '深香槟',
    'Dark champagne',
    'Champán oscuro',
    '#bda077',
  ],
  [
    'rose-gold',
    '玫瑰金色|玫瑰金',
    '玫瑰金',
    'Rose gold',
    'Oro rosa',
    '#cfaa96',
  ],
  ['bronze', '古铜色|青铜色|古铜', '古铜色', 'Bronze', 'Bronce', '#9a8056'],
  ['copper', '铜色|红铜色', '铜色', 'Copper', 'Cobre', '#b47855'],
  ['nude', '肤色', '肤色', 'Nude', 'Color piel', '#ddbd9f'],
  ['steel', '不锈钢本色|钢色', '钢色', 'Steel', 'Acero', '#b7bdba'],
  ['natural', '本色|原色|自然色', '本色', 'Natural', 'Natural', null, 'finish'],
  [
    'wood',
    '原木色|橡胶木色|木色',
    '原木色',
    'Natural wood',
    'Madera natural',
    null,
    'finish',
  ],
  [
    'wood-grain',
    '木纹色|木纹',
    '木纹',
    'Wood grain',
    'Veta de madera',
    null,
    'pattern',
  ],
  ['sandstone', '砂岩色', '砂岩色', 'Sandstone', 'Arenisca', null, 'finish'],
  [
    'distressed',
    '复古旧色|做旧色|复古色|旧色',
    '做旧色',
    'Distressed',
    'Envejecido',
    null,
    'finish',
  ],
  [
    'charred',
    '碳烧|炭烧',
    '碳烧',
    'Charred finish',
    'Acabado quemado',
    null,
    'finish',
  ],
  [
    'clear',
    '透明色|透明|无色',
    '透明',
    'Clear',
    'Transparente',
    null,
    'finish',
  ],
  [
    'translucent',
    '半透明|半透',
    '半透明',
    'Translucent',
    'Translúcido',
    null,
    'finish',
  ],
  ['matte', '磨砂|哑光|亚光', '哑光', 'Matte', 'Mate', null, 'finish'],
  ['glossy', '亮光|亮面', '亮面', 'Glossy', 'Brillante', null, 'finish'],
  ['gradient', '渐变色|渐变', '渐变', 'Gradient', 'Degradado', null, 'pattern'],
  ['tie-dye', '扎染', '扎染', 'Tie-dye', 'Teñido anudado', null, 'pattern'],
  [
    'striped',
    '条纹|条形纹|竖条纹|横条纹',
    '条纹',
    'Striped',
    'Rayas',
    null,
    'pattern',
  ],
  [
    'checked',
    '格子|格纹|方格|花格',
    '格纹',
    'Checked',
    'Cuadros',
    null,
    'pattern',
  ],
  ['polka-dots', '波点', '波点', 'Polka dots', 'Lunares', null, 'pattern'],
  [
    'mixed',
    '混色|混发|混款|颜色随机发|随机颜色|随机色|随机发色|颜色随机|随机混色|随机发货',
    '颜色随机',
    'Assorted colors',
    'Colores surtidos',
    null,
    'assortment',
  ],
  [
    'multicolor',
    '彩色|七彩|五彩|多色|彩虹色',
    '多色',
    'Multicolor',
    'Multicolor',
    null,
    'assortment',
  ],
  [
    'color-block',
    '拼色',
    '拼色',
    'Color block',
    'Combinación de colores',
    null,
    'pattern',
  ],
  ['light-tone', '浅色', '浅色', 'Light tone', 'Tono claro', null, 'color'],
  ['dark-tone', '深色', '深色', 'Dark tone', 'Tono oscuro', null, 'color'],
]

export const COLOR_VOCABULARY = Object.freeze(
  definitions.map(([id, match, zh, en, es, swatch, kind = 'color']) =>
    Object.freeze({
      id,
      aliases: Object.freeze(match.split('|')),
      labels: Object.freeze({ en, zh, es }),
      swatch,
      kind,
    })
  )
)

const normalize = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
const colorField = /(?:颜色|色彩|花色|配色|color|colour)/i
const variantField =
  /^(?:规格(?:分类|型号)?|尺寸(?:规格)?|尺码|款式|花型|外观|样式|容量|容积|层数|长度|宽度|高度|内框尺寸|外框尺寸|功率|包装规格|variant|style|size|specifications?)(?:\(.*\))?$/i
const excludedField =
  /(?:货号|款号|编号|型号|香型|香味|香氛|香气|气味|色温|product\s*(?:no\.?|number)|model|fragrance|scent|temperature)/i
const ambiguous = new Set(['咖啡', '水粉', '奶粉', '桃', '香槟'])
const bareColors = new Map(
  COLOR_VOCABULARY.flatMap((entry) =>
    entry.aliases
      .filter((alias) => alias.length === 1)
      .map((alias) => [alias, entry])
  )
)
const tokens = COLOR_VOCABULARY.flatMap((entry) =>
  entry.aliases.map((alias) => ({ alias, entry }))
).sort((a, b) => b.alias.length - a.alias.length)

function fieldsForItem(item) {
  const fields = []
  const seen = new Set()
  function add(label, value, isProperty = false) {
    label = normalize(label)
    value = normalize(value)
    const key = `${label}\u0000${value}`
    if (!value || seen.has(key) || excludedField.test(label)) return
    if (!isProperty && !colorField.test(label) && !variantField.test(label))
      return
    fields.push({ label, value, color: colorField.test(label) })
    seen.add(key)
  }
  for (const property of item?.skuProperties ?? [])
    add(property?.label, property?.value, true)
  // Older imports can have only a description. Read labeled variant lines,
  // never the title, product number, or unlabelled marketing description.
  for (const line of String(item?.description ?? '').split(/\r?\n/)) {
    const match = line.match(/^\s*([^:：\n]{1,40})\s*[:：]\s*(.+)$/)
    if (match) add(match[1], match[2])
  }
  return fields
}

function languageKey(language) {
  const key = String(language ?? '').toLowerCase()
  return /^(?:zh|cn)(?:-|$)/.test(key)
    ? 'zh'
    : /^(?:es|spa)(?:-|$)/.test(key)
      ? 'es'
      : 'en'
}

function hintsForField(field, language) {
  // Sellers sometimes put scent names in their color selector. They are not
  // evidence of an actual product color, even if the scent contains 紫 or 茶.
  if (/(?:香薰|香氛|香型|香味|精油|香精|fragrance|scent)/i.test(field.value))
    return []
  const text = field.value.replace(
    /([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu,
    '$1'
  )
  const matches = []
  const occupied = new Uint8Array(text.length)
  const add = (entry, source, start, end, swatch = entry.swatch) => {
    if (occupied.slice(start, end).some(Boolean)) return
    if (
      /(?:不是|并非|非|不要|不含)[^,，;；。()【】]*$/.test(text.slice(0, start))
    )
      return
    occupied.fill(1, start, end)
    matches.push({
      ...entry,
      label: entry.labels[language],
      source,
      start,
      swatch,
    })
  }

  // Explicitly combined bare colors (黑白, 红绿, 米白黑) should stay combined;
  // each component is named, with no invented solid-color swatch.
  const combinations =
    /(?:米白|黑|白|灰|粉|红|绿|蓝|黄|紫|棕|金|银|橙|咖){2,}(?:色)?/g
  for (const match of text.matchAll(combinations)) {
    const raw = match[0]
    if (tokens.some(({ alias }) => alias === raw || alias === `${raw}色`))
      continue
    const components = raw.replace(/色$/, '').match(/米白|./g)
    const entries = components.map((part) =>
      part === '米白'
        ? COLOR_VOCABULARY.find((entry) => entry.id === 'off-white')
        : bareColors.get(part)
    )
    if (entries.some((entry) => !entry)) continue
    const id = entries.map((entry) => entry.id).join('-')
    add(
      {
        id: `combined-${id}`,
        kind: 'color',
        swatch: null,
        labels: Object.fromEntries(
          ['en', 'zh', 'es'].map((lang) => [
            lang,
            entries.map((entry) => entry.labels[lang]).join(' / '),
          ])
        ),
      },
      raw,
      match.index,
      match.index + raw.length,
      null
    )
  }
  for (const { alias, entry } of tokens) {
    let offset = 0
    while ((offset = text.indexOf(alias, offset)) !== -1) {
      const start = offset
      offset += alias.length
      if (alias.length === 1 || ambiguous.has(alias)) {
        // Exact field/segment values allow 红 or 咖啡 without interpreting
        // 红包, 咖啡杯, 丁香, 黑板, or model names as colors.
        const before = text.slice(0, start)
        const after = text.slice(offset)
        if (
          !field.color ||
          !/^(?:|.*[\s,，;；/+:：()【】\[\]\-])$/.test(before) ||
          !/^(?:|[\s,，;；/+:：()【】\[\]\-].*)$/.test(after)
        )
          continue
      }
      add(entry, text.slice(start, offset), start, offset)
    }
  }
  // Common physical components give a bare character an explicit color role,
  // for example 灰底 or 黄刷. Do not extend this to arbitrary words (黑板,
  // 银杏, 绿洲, 红包, and 粉末 are not independent color evidence).
  for (const match of text.matchAll(
    /(黑|白|灰|粉|红|绿|蓝|黄|紫|棕|金|银|橙|咖)(?=盖|底|边|圈|字|柄|绳|盆|刷|窗|格子|竖条|横条|大号|小号)/g
  )) {
    const entry = bareColors.get(match[1])
    add(entry, match[1], match.index, match.index + 1)
  }
  // Shades in explicit effect names, such as 渐变紫 / 透明灰 / 磨砂黑,
  // keep their named color and the effect as separate text helpers.
  for (const match of text.matchAll(
    /(渐变|透明|半透|透|磨砂)(黑|白|灰|粉|红|绿|蓝|黄|紫|棕|金|银|橙|咖)(?:色)?/g
  )) {
    const entry = bareColors.get(match[2])
    if (!entry) continue
    const start = match.index + match[1].length
    const effectId =
      match[1] === '渐变'
        ? 'gradient'
        : match[1] === '磨砂'
          ? 'matte'
          : match[1] === '半透'
            ? 'translucent'
            : 'clear'
    const effect = COLOR_VOCABULARY.find((value) => value.id === effectId)
    add(effect, match[1], match.index, start, null)
    add(entry, match[2], start, start + 1, null)
  }
  for (const match of text.matchAll(/(?<!\d)(\d{1,2})色(?!温)/g)) {
    const count = Number(match[1])
    if (count < 2) continue
    add(
      {
        id: `colors-${count}`,
        kind: 'assortment',
        swatch: null,
        labels: {
          en: `${count} colors`,
          zh: `${count}色`,
          es: `${count} colores`,
        },
      },
      match[0],
      match.index,
      match.index + match[0].length,
      null
    )
  }
  return matches
    .sort((a, b) => a.start - b.start)
    .map(({ id, label, source, kind, swatch }) => ({
      id,
      label,
      source,
      kind,
      swatch,
    }))
}

/**
 * Translate explicitly named colors/finishes from an imported snapshot item.
 * Returns helper chips; source text is preserved and unknown names are omitted.
 * The optional swatch illustrates a standard color family, never the actual photo.
 */
export function getItemColorHints(item, language = 'en') {
  const hints = []
  const seen = new Set()
  for (const field of fieldsForItem(item)) {
    for (const hint of hintsForField(field, languageKey(language))) {
      if (seen.has(hint.id)) continue
      seen.add(hint.id)
      hints.push(hint)
    }
  }
  // A mixed finish/gradient or assortment must not imply a single solid shade.
  if (
    hints.some(
      (hint) =>
        hint.kind === 'assortment' ||
        ['gradient', 'tie-dye', 'clear', 'translucent', 'color-block'].includes(
          hint.id
        )
    )
  ) {
    for (const hint of hints) hint.swatch = null
  }
  return hints
}
