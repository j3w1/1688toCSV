// Local material hints, derived from seller wording. These helpers never rewrite
// source descriptions and do not infer composition from a product's appearance.
export const MATERIAL_VOCABULARY_VERSION = 1

const definitions = [
  ['glass', '玻璃', 'Glass', 'Vidrio', '玻璃|玻璃材质|耐热玻璃|高硼硅玻璃', ''],
  [
    'acrylic',
    '亚克力',
    'Acrylic',
    'Acrílico',
    '亚克力|有机玻璃|压克力|acrylic|PMMA',
    'plastic',
  ],
  ['ceramic', '陶瓷', 'Ceramic', 'Cerámica', '陶瓷|陶制|陶质|瓷器|ceramic', ''],
  ['resin', '树脂', 'Resin', 'Resina', '树脂|树脂材质|resin', ''],
  ['cement', '水泥', 'Cement', 'Cemento', '水泥|混凝土|cement|concrete', ''],
  ['gypsum', '石膏', 'Plaster', 'Yeso', '石膏|gypsum|plaster', ''],
  ['stone', '石材', 'Stone', 'Piedra', '石材|天然石|stone', ''],
  ['marble', '大理石', 'Marble', 'Mármol', '大理石|marble', 'stone'],
  ['plastic', '塑料', 'Plastic', 'Plástico', '塑料|塑胶|plastic', ''],
  ['abs', 'ABS', 'ABS', 'ABS', 'ABS|丙烯腈丁二烯苯乙烯', 'plastic'],
  ['pvc', 'PVC', 'PVC', 'PVC', 'PVC|聚氯乙烯', 'plastic'],
  ['pp', 'PP', 'PP', 'PP', 'PP|聚丙烯', 'plastic'],
  ['pet', 'PET', 'PET', 'PET', 'PET|聚对苯二甲酸乙二醇酯', 'plastic'],
  ['pe', 'PE', 'PE', 'PE', 'PE|聚乙烯', 'plastic'],
  ['peva', 'PEVA', 'PEVA', 'PEVA', 'PEVA', 'plastic'],
  ['eva', 'EVA', 'EVA', 'EVA', 'EVA|乙烯醋酸乙烯共聚物', 'plastic'],
  ['tpe', 'TPE', 'TPE', 'TPE', 'TPE|热塑性弹性体', 'plastic'],
  ['tpr', 'TPR', 'TPR', 'TPR', 'TPR|热塑性橡胶', 'plastic'],
  [
    'pu',
    'PU',
    'Polyurethane',
    'Poliuretano',
    'PU|聚氨酯|polyurethane',
    'plastic',
  ],
  ['pva', 'PVA', 'PVA', 'PVA', 'PVA|聚乙烯醇', 'plastic'],
  ['silicone', '硅胶', 'Silicone', 'Silicona', '硅胶|硅橡胶|silicone', ''],
  ['rubber', '橡胶', 'Rubber', 'Caucho', '橡胶|rubber', ''],
  ['latex', '乳胶', 'Latex', 'Látex', '乳胶|latex', 'rubber'],
  ['metal', '金属', 'Metal', 'Metal', '金属|metal', ''],
  [
    'stainless-steel',
    '不锈钢',
    'Stainless steel',
    'Acero inoxidable',
    '不锈钢|不銹鋼|stainless steel',
    'metal',
  ],
  ['steel', '钢', 'Steel', 'Acero', '钢制|钢材|钢质|碳钢|steel', 'metal'],
  ['iron', '铁', 'Iron', 'Hierro', '铁艺|铁制|铁质|铁皮|铸铁|iron', 'metal'],
  [
    'aluminium',
    '铝',
    'Aluminium',
    'Aluminio',
    '铝制|铝质|太空铝|aluminum|aluminium',
    'metal',
  ],
  [
    'aluminium-alloy',
    '铝合金',
    'Aluminium alloy',
    'Aleación de aluminio',
    '铝合金|aluminium alloy|aluminum alloy',
    'metal',
  ],
  [
    'aluminium-foil',
    '铝箔',
    'Aluminium foil',
    'Papel de aluminio',
    '铝箔|锡纸|aluminium foil|aluminum foil',
    'metal',
  ],
  ['copper', '铜', 'Copper', 'Cobre', '铜制|铜质|纯铜|copper', 'metal'],
  [
    'wood',
    '木',
    'Wood',
    'Madera',
    '木质|木制|实木|木材|木料|原木|木头|wood|solid wood',
    '',
  ],
  [
    'rubberwood',
    '橡胶木',
    'Rubberwood',
    'Madera de caucho',
    '橡胶木|rubberwood',
    'wood',
  ],
  ['mdf', '密度板', 'MDF', 'MDF', '密度板|中密度纤维板|MDF', 'wood'],
  ['bamboo', '竹', 'Bamboo', 'Bambú', '楠竹|竹制|竹质|竹编|bamboo', ''],
  ['bamboo-wood', '竹木', 'Bamboo / wood', 'Bambú / madera', '竹木', ''],
  ['rattan', '藤', 'Rattan', 'Ratán', '藤编|藤制|藤织|rattan', ''],
  ['willow', '柳', 'Willow', 'Mimbre', '柳编|柳制|willow|wicker', ''],
  ['straw', '草编', 'Woven straw', 'Paja tejida', '草编|woven straw', ''],
  ['fabric', '布', 'Fabric', 'Tela', '布艺|布质|布料|布制|fabric|cloth', ''],
  [
    'cotton',
    '棉',
    'Cotton',
    'Algodón',
    '纯棉|棉质|棉料|棉布|全棉|cotton',
    'fabric',
  ],
  [
    'cotton-linen',
    '棉麻',
    'Cotton / linen',
    'Algodón / lino',
    '棉麻|cotton linen|cotton/linen',
    'fabric',
  ],
  ['linen', '亚麻', 'Linen', 'Lino', '亚麻|linen', 'fabric'],
  ['burlap', '麻布', 'Burlap', 'Arpillera', '麻布|burlap|hessian', 'fabric'],
  ['jute', '黄麻', 'Jute', 'Yute', '黄麻|jute', 'fabric'],
  ['sisal', '剑麻', 'Sisal', 'Sisal', '剑麻|sisal', 'fabric'],
  ['canvas', '帆布', 'Canvas', 'Lona', '帆布|canvas', 'fabric'],
  [
    'nonwoven',
    '无纺布',
    'Nonwoven fabric',
    'Tela no tejida',
    '无纺布|无纺织布|无纺|不织布|nonwoven|non-woven',
    'fabric',
  ],
  [
    'oxford',
    '牛津布',
    'Oxford fabric',
    'Tela Oxford',
    '牛津布|oxford fabric',
    'fabric',
  ],
  ['nylon', '尼龙', 'Nylon', 'Nailon', '尼龙|锦纶|nylon', 'plastic'],
  [
    'polyester',
    '涤纶',
    'Polyester',
    'Poliéster',
    '涤纶|聚酯纤维|polyester',
    'fabric',
  ],
  ['plush', '毛绒', 'Plush', 'Felpa', '长毛绒|短毛绒|毛绒|plush', 'fabric'],
  [
    'velvet',
    '绒布',
    'Velvet fabric',
    'Terciopelo',
    '绒布|天鹅绒|velvet',
    'fabric',
  ],
  [
    'coral-fleece',
    '珊瑚绒',
    'Coral fleece',
    'Felpa coral',
    '珊瑚绒|coral fleece',
    'fabric',
  ],
  [
    'flannel',
    '法兰绒',
    'Flannel',
    'Franela',
    '法兰绒|法莱绒|flannel',
    'fabric',
  ],
  [
    'fleece',
    '摇粒绒',
    'Polar fleece',
    'Tela polar',
    '摇粒绒|polar fleece',
    'fabric',
  ],
  ['corduroy', '灯芯绒', 'Corduroy', 'Pana', '灯芯绒|corduroy', 'fabric'],
  [
    'gabardine',
    '华达呢',
    'Gabardine',
    'Gabardina',
    '华达呢|华达尼|gabardine',
    'fabric',
  ],
  [
    'knit',
    '针织布',
    'Knit fabric',
    'Tejido de punto',
    '针织布|knit fabric',
    'fabric',
  ],
  [
    'faux-suede',
    '麂皮绒',
    'Faux suede',
    'Ante sintético',
    '麂皮绒|仿麂皮|faux suede',
    'fabric',
  ],
  [
    'faux-cashmere',
    '仿羊绒',
    'Cashmere-like fabric',
    'Tejido tipo cachemira',
    '仿羊绒',
    'fabric',
  ],
  ['chenille', '雪尼尔', 'Chenille', 'Chenilla', '雪尼尔|chenille', 'fabric'],
  [
    'microfiber',
    '超细纤维',
    'Microfiber',
    'Microfibra',
    '超细纤维|microfiber|microfibre',
    'fabric',
  ],
  [
    'bamboo-fiber',
    '竹纤维',
    'Bamboo fiber',
    'Fibra de bambú',
    '竹纤维|bamboo fiber|bamboo fibre',
    'fabric',
  ],
  [
    'bamboo-charcoal-fiber',
    '竹炭纤维',
    'Bamboo charcoal fiber',
    'Fibra de carbón de bambú',
    '竹炭纤维',
    'fabric',
  ],
  ['felt', '毛毡', 'Felt', 'Fieltro', '毛毡|felt', 'fabric'],
  ['wool', '羊毛', 'Wool', 'Lana', '羊毛|wool', 'fabric'],
  ['leather', '皮革', 'Leather', 'Cuero', '皮革|皮质|真皮|leather', ''],
  [
    'faux-leather',
    '人造革',
    'Faux leather',
    'Cuero sintético',
    '人造革|仿皮|仿真皮|PU皮革|PU皮|PU革|faux leather|synthetic leather',
    '',
  ],
  ['sponge', '海绵', 'Sponge', 'Esponja', '海绵|sponge', ''],
  [
    'memory-foam',
    '记忆棉',
    'Memory foam',
    'Espuma viscoelástica',
    '记忆棉|memory foam',
    '',
  ],
  ['foam', '泡沫', 'Foam', 'Espuma', '泡沫|发泡棉|泡棉|foam', ''],
  [
    'polyfill',
    'PP棉',
    'Polyester filling',
    'Relleno de poliéster',
    'PP棉|聚酯填充棉|polyfill',
    '',
  ],
  [
    'paper',
    '纸',
    'Paper',
    'Papel',
    '纸质|纸制|卡纸|纸板|热敏纸|收银纸|打印纸|油纸|paper|cardboard',
    '',
  ],
  [
    'kraft-paper',
    '牛皮纸',
    'Kraft paper',
    'Papel kraft',
    '牛皮纸|kraft paper',
    'paper',
  ],
  [
    'corrugated-paper',
    '瓦楞纸',
    'Corrugated paper',
    'Cartón corrugado',
    '瓦楞纸|corrugated paper|corrugated cardboard',
    'paper',
  ],
  ['bark', '树皮', 'Bark', 'Corteza', '树皮|bark', 'wood'],
  [
    'wheat-straw',
    '小麦秸秆',
    'Wheat straw',
    'Paja de trigo',
    '小麦秸秆|wheat straw',
    '',
  ],
  [
    'diatomaceous-earth',
    '硅藻土',
    'Diatomaceous earth',
    'Tierra de diatomeas',
    '硅藻土|硅藻泥|diatomaceous earth',
    '',
  ],
  [
    'lava-stone',
    '火山石',
    'Lava stone',
    'Piedra volcánica',
    '火山石|lava stone',
    'stone',
  ],
  ['wax', '蜡', 'Wax', 'Cera', '蜡质|蜡制|石蜡|wax|paraffin', ''],
  ['soy-wax', '大豆蜡', 'Soy wax', 'Cera de soja', '大豆蜡|soy wax', 'wax'],
  ['beeswax', '蜂蜡', 'Beeswax', 'Cera de abeja', '蜂蜡|beeswax', 'wax'],
  [
    'vegetable-wax',
    '植物蜡',
    'Vegetable wax',
    'Cera vegetal',
    '植物蜡|vegetable wax',
    'wax',
  ],
]

export const MATERIAL_VOCABULARY = Object.freeze(
  definitions.map(([id, zh, en, es, aliases, parent]) =>
    Object.freeze({
      id,
      zh,
      en,
      es,
      aliases: Object.freeze(aliases.split('|')),
      parent,
    })
  )
)

const normalize = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
const languageKey = (language) =>
  /^(?:zh|cn)(?:-|$)/i.test(language)
    ? 'zh'
    : /^(?:es|spa)(?:-|$)/i.test(language)
      ? 'es'
      : 'en'
const aliases = MATERIAL_VOCABULARY.flatMap((material) =>
  [
    ...new Set([material.zh, material.en, material.es, ...material.aliases]),
  ].map((alias) => ({
    alias: normalize(alias),
    material,
  }))
).sort((a, b) => b.alias.length - a.alias.length)
const byValue = new Map(aliases.map(({ alias, material }) => [alias, material]))

/** Translate complete material names; leave unknown user-authored wording intact. */
export function translateMaterial(value, language = 'en') {
  const text = String(value ?? '').trim()
  const locale = languageKey(language)
  const exact = byValue.get(normalize(text))
  if (exact) return exact[locale]
  return text
    .split(/(\s*[+＋/、,，;&]\s*)/u)
    .map((part, index) =>
      index % 2 ? part : (byValue.get(normalize(part))?.[locale] ?? part)
    )
    .join('')
}

const explicitLabel =
  /^(?:材质|材料|产品材质|商品材质|主要材质|主体材质|面料|面料材质|面料成分|材质成分|主要成分|成分|material|materials|materiales|composition)$/i
const ambiguousAfter = /^(?:色|纹|风格|效果|质感|感|宝宝)/u
const accessoryAfter =
  /^(?:(?:空心|实心)?(?:盖(?!布)|塞|手柄|柄|底座|底托|托|绳|扣|包装|袋装|包边|龙头|油嘴|刷头))/u
const auxiliaryBefore =
  /(?:带|配|附送|赠送|赠|送|搭配|装饰用)(?:透明|加厚|优质|金色|银色)?$/u

function materialMatches(value, explicit = false) {
  const text = normalize(value)
  const found = []
  const occupied = []
  const imitations = new Set()
  for (const { alias, material } of aliases) {
    // Bare Chinese characters are useful in an explicit material field, but in
    // a title they also occur in plant names, colors and unrelated product names.
    if (!explicit && /^[\p{Script=Han}]$/u.test(alias)) continue
    let start = text.indexOf(alias)
    while (start >= 0) {
      const end = start + alias.length
      const before = text.slice(Math.max(0, start - 12), start)
      const after = text.slice(end)
      const latin = /^[a-z]/i.test(alias)
      const overlaps = occupied.some(([a, b]) => start < b && end > a)
      const inWord =
        latin &&
        (/[a-z0-9]$/i.test(before) ||
          /^[a-z]/i.test(after) ||
          (alias.length <= 4 && /^\d/u.test(after)))
      const imitation =
        /仿(?:真|制|编|老根|亚)?$/u.test(before) &&
        material.id !== 'faux-leather' &&
        !(before.endsWith('仿真') && /^(?:花(?!瓶|盆)|植物|叶|树)/u.test(after))
      const notMaterial = /(?:非|不是|不含|无)$/u.test(before)
      const auxiliary =
        !explicit &&
        (accessoryAfter.test(after) || auxiliaryBefore.test(before))
      const useContext =
        !explicit &&
        ((material.id === 'glass' &&
          /^(?:刷|清洁|清洗|清理|刮|擦|笔|贴膜)/u.test(after)) ||
          (material.id === 'cement' && /^灰/u.test(after)) ||
          (material.id === 'foam' &&
            /^(?:洗手液|沐浴|洗面奶|洁面|起泡|打泡|瓶)/u.test(after)))
      if (!overlaps && !inWord) occupied.push([start, end])
      if (imitation) imitations.add(material.id)
      if (
        !overlaps &&
        !inWord &&
        !imitation &&
        !notMaterial &&
        !ambiguousAfter.test(after) &&
        !auxiliary &&
        !useContext
      ) {
        found.push({ material, start })
      }
      start = text.indexOf(alias, end)
    }
  }
  const unique = [
    ...new Map(
      found
        .sort((a, b) => a.start - b.start)
        .map(({ material }) => [material.id, material])
    ).values(),
  ]
  return unique.filter(
    (candidate) =>
      !imitations.has(candidate.id) &&
      !unique.some((other) => other.parent === candidate.id) &&
      !(
        candidate.id === 'rattan' &&
        !explicit &&
        /(?:塑料|塑胶|\bpp\b|pp藤|仿藤)/iu.test(text)
      )
  )
}

function joinedMaterials(matches) {
  return matches.map((material) => material.zh).join(' + ')
}

/** Suggest only materials stated by the seller, never an inferred composition. */
export function suggestMaterial(item = {}) {
  const explicitValues = []
  for (const property of Array.isArray(item.skuProperties)
    ? item.skuProperties
    : []) {
    if (explicitLabel.test(normalize(property?.label).replace(/\s+/g, '')))
      explicitValues.push(property?.value)
  }
  if (
    item.material !== undefined &&
    item.material !== null &&
    String(item.material).trim()
  )
    explicitValues.push(item.material)
  for (const line of String(item.description ?? '').split(/[\n；;·•]/u)) {
    const match = line.match(/^\s*([^：:]{1,30})\s*[:：]\s*(.+)$/u)
    if (match && explicitLabel.test(normalize(match[1]).replace(/\s+/g, '')))
      explicitValues.push(match[2])
  }
  // An explicit but unfamiliar material is stronger evidence than a title's
  // marketing keywords. Do not replace it with a conflicting title inference.
  if (explicitValues.length) {
    const value = explicitValues.join(' + ')
    return /或|随机|可选/u.test(value)
      ? ''
      : joinedMaterials(materialMatches(value, true))
  }
  const title =
    String(item.title ?? '').trim() ||
    String(item.description ?? '')
      .split(/\r?\n/)
      .find((line) => line.trim()) ||
    ''
  // Variant properties can add useful evidence, but model numbers and packaging
  // details are never material sources. Color lookalikes are excluded above.
  const variants = (
    Array.isArray(item.skuProperties) ? item.skuProperties : []
  ).filter((property) =>
    /^(?:颜色|颜色分类|产品颜色|规格|尺寸|尺寸规格|规格尺寸|款式|容量)$/u.test(
      String(property?.label ?? '').trim()
    )
  )
  const variantMatches = materialMatches(
    variants.map((property) => property.value).join(' ; ')
  )
  // Glue titles list compatible surfaces, not the glue's material. Several
  // incompatible composition keywords without a join are usually SEO or options.
  const titleMatches = /胶水|粘合剂|粘接剂|焊接剂/u.test(title)
    ? []
    : materialMatches(title)
  const conflictingFamilies = [
    [
      'pvc',
      'pp',
      'pet',
      'pe',
      'peva',
      'eva',
      'tpe',
      'tpr',
      'pu',
      'pva',
      'abs',
      'silicone',
      'latex',
    ],
    ['ceramic', 'cement', 'gypsum'],
    ['flannel', 'coral-fleece'],
  ]
  const conflict =
    !/[+＋&]/u.test(title) &&
    conflictingFamilies.some(
      (family) =>
        titleMatches.filter((material) => family.includes(material.id)).length >
        1
    )
  if (conflict)
    return variantMatches.length === 1 ? joinedMaterials(variantMatches) : ''
  return joinedMaterials(titleMatches.length ? titleMatches : variantMatches)
}
