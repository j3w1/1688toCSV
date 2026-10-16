import test from 'node:test'
import assert from 'node:assert/strict'
import {
  activeGroups,
  allocatePreparation,
  barcodeValue,
  createPreparation,
  defaultPackingChanges,
  extendDefaultPacking,
  hasDefaultPackingChanges,
  mergePackingState,
  packingCheckpoint,
  planSelectedPreparations,
  removeSelectedProducts,
  reorderPreparationGroups,
  reorderPreparationVariants,
  restoreDefaultPacking,
  restorePreviousPacking,
  validatePackingPreferences,
  validatePreparation,
  validatePreparationReservations,
} from '../src/packing-model.js'
import { DEFAULT_SIZE_VOCABULARY } from '../src/size-vocabulary.js'

function source(items, extra = {}) {
  return {
    accountId: 'local',
    orderId: '100000000000000001',
    sellerName: 'seller-a',
    items: items.map((item, index) => ({
      entryId: String(index + 1),
      description: 'Cup',
      title: 'Cup',
      ...item,
    })),
    ...extra,
  }
}

function sku(color, size, other = []) {
  return [
    { label: '颜色', value: color },
    ...(size ? [{ label: '尺寸', value: size }] : []),
    ...other,
  ]
}

test('unavailable seller cannot allocate labels until a real identity is supplied', () => {
  const draft = createPreparation(
    source([{}], {
      sellerName: 'Seller unavailable',
      sellerUnavailable: true,
    }),
    '2026-10'
  )
  assert.equal(draft.sellerId, '')
  for (const sellerId of ['', '   ', 'Seller unavailable', 'Unknown Seller']) {
    assert.throws(
      () => allocatePreparation({ ...draft, sellerId }, [], []),
      /Identify the seller/
    )
  }
  draft.sellerId = 'identified-synthetic-seller'
  const result = allocatePreparation(draft, [], [])
  assert.equal(result.preparation.sellerId, draft.sellerId)
  assert.equal(result.preparation.groups[0].baseCode, 'CE26100101')
})

test('suggestions retain source entries, first-seen variants, named sizes and local vocabulary', () => {
  const snapshot = source([
    { skuProperties: sku('red', 'S') },
    { skuProperties: sku('red', 'L') },
    { skuProperties: sku('blue', 'S') },
    { skuProperties: sku('red', 'S') },
  ])
  const original = structuredClone(snapshot)
  const draft = createPreparation(snapshot, '2026-06', [
    { match: 'Cup', spanishName: 'taza', category: '杯子' },
  ])
  assert.equal(draft.revision, 0)
  assert.equal(draft.groups[0].baseCode, '')
  assert.equal(draft.groups[0].spanishName, 'TAZA')
  assert.equal(draft.groups[0].category, '杯子')
  assert.deepEqual(
    draft.groups[0].variants.map((variant) => [
      variant.entryIds,
      variant.variantSuffix,
      variant.sizeSuffix,
    ]),
    [
      [['1', '4'], 'A', 'S'],
      [['2'], 'A', 'L'],
      [['3'], 'B', 'S'],
    ]
  )
  assert.deepEqual(snapshot, original)
  const allocated = allocatePreparation(draft, [], [])
  assert.equal(
    barcodeValue(
      allocated.preparation.groups[0],
      allocated.preparation.groups[0].variants[0]
    ),
    'CE26060101AS'
  )
})

test('vocabulary suggestions require agreement independently for each field', () => {
  const primary = { match: 'Cup', spanishName: 'taza', category: '杯子' }
  for (const [additional, expected] of [
    [
      { match: 'Cu', spanishName: ' TAZA ', category: ' 杯子 ' },
      ['TAZA', '杯子'],
    ],
    [{ match: 'Cu', spanishName: 'vaso', category: '杯子' }, ['', '杯子']],
    [{ match: 'Cu', spanishName: 'taza', category: '餐具' }, ['TAZA', '']],
    [{ match: 'Cu', spanishName: 'vaso', category: '餐具' }, ['', '']],
    [{ match: 'Cu', spanishName: '', category: '' }, ['TAZA', '杯子']],
    [{ match: 'Bowl', spanishName: 'bol', category: '碗' }, ['TAZA', '杯子']],
  ]) {
    for (const vocabulary of [
      [primary, additional],
      [additional, primary],
    ]) {
      const group = createPreparation(source([{}]), '2026-06', vocabulary)
        .groups[0]
      assert.deepEqual([group.spanishName, group.category], expected)
    }
  }
  const unknown = createPreparation(source([{ title: 'Unknown' }]), '2026-06', [
    primary,
  ]).groups[0]
  assert.equal(unknown.spanishName, '')
  assert.equal(unknown.category, '')
})

test('dimension suggestions order 2, 3 and 5 sizes and leave ambiguous sets unresolved', () => {
  for (const [dimensions, expected] of [
    [
      ['30cm', '10cm'],
      ['L', 'S'],
    ],
    [
      ['30cm', '10cm', '20cm'],
      ['L', 'S', 'M'],
    ],
    [
      ['10cm', '20cm', '30cm', '40cm', '50cm'],
      ['XS', 'S', 'M', 'L', 'XL'],
    ],
    [
      ['10x20cm', '10x30cm'],
      ['S', 'L'],
    ],
  ]) {
    const draft = createPreparation(
      source(dimensions.map((size) => ({ skuProperties: sku('red', size) }))),
      '2026-06'
    )
    assert.deepEqual(
      draft.groups[0].variants.map((variant) => variant.sizeSuffix),
      expected
    )
  }
  for (const dimensions of [
    ['10cm', '20cm', '30cm', '40cm'],
    ['short', 'long'],
    ['10x30cm', '20x20cm'],
  ]) {
    const draft = createPreparation(
      source(dimensions.map((size) => ({ skuProperties: sku('red', size) }))),
      '2026-06'
    )
    assert.ok(
      draft.groups[0].variants.every((variant) => variant.needsSizeMapping)
    )
    const allocated = allocatePreparation(draft, [], [])
    assert.equal(allocated.issuedCodes.length, 1)
    assert.throws(
      () =>
        barcodeValue(
          allocated.preparation.groups[0],
          allocated.preparation.groups[0].variants[0]
        ),
      /Map this variant size/
    )
  }
})

test('barcodes omit non-distinguishing dimensions including a single measured size', () => {
  for (const size of ['', '40cm', 'S', '20x30cm']) {
    const draft = createPreparation(
      source([{ skuProperties: sku('red', size) }]),
      '2026-06'
    )
    const state = allocatePreparation(draft, [], [])
    const group = state.preparation.groups[0]
    assert.equal(group.variants[0].variantSuffix, '')
    assert.equal(group.variants[0].sizeSuffix, '')
    assert.equal(barcodeValue(group, group.variants[0]), group.baseCode)
    assert.deepEqual(state.issuedCodes.map((entry) => entry.kind).sort(), [
      'barcode',
      'base',
    ])
  }
  const state = allocatePreparation(
    createPreparation(
      source([
        { skuProperties: sku('red', 'S') },
        { skuProperties: sku('red', 'L') },
      ]),
      '2026-06'
    ),
    [],
    []
  )
  const group = state.preparation.groups[0]
  assert.deepEqual(
    group.variants.map((variant) => barcodeValue(group, variant)),
    ['CE26060101S', 'CE26060101L']
  )
})

test('size suggestions normalize units and rank measurements only when dimensions agree', () => {
  for (const [sizes, expected] of [
    [
      ['2cm', '10mm'],
      ['L', 'S'],
    ],
    [
      ['1l', '250ml'],
      ['L', 'S'],
    ],
    [
      ['1米', '20厘米', '50毫米'],
      ['L', 'M', 'S'],
    ],
    [
      ['10x20cm', '20x30cm'],
      ['S', 'L'],
    ],
  ]) {
    const draft = createPreparation(
      source(sizes.map((size) => ({ skuProperties: sku('red', size) }))),
      '2026-06'
    )
    assert.deepEqual(
      draft.groups[0].variants.map((variant) => variant.sizeSuffix),
      expected
    )
  }
  for (const sizes of [
    ['1cm', '10mm'],
    ['10ml', '20cm'],
    ['10x40cm', '20x30cm'],
  ]) {
    const draft = createPreparation(
      source(sizes.map((size) => ({ skuProperties: sku('red', size) }))),
      '2026-06'
    )
    assert.ok(
      draft.groups[0].variants.every((variant) => variant.needsSizeMapping)
    )
  }
  const textual = createPreparation(
    source([
      { skuProperties: [{ label: '规格', value: 'with lid' }] },
      { skuProperties: [{ label: '规格', value: 'without lid' }] },
    ]),
    '2026-06'
  )
  assert.deepEqual(
    textual.groups[0].variants.map((variant) => [
      variant.variant,
      variant.size,
      variant.variantSuffix,
      variant.needsSizeMapping,
    ]),
    [
      ['规格: with lid', '', 'A', false],
      ['规格: without lid', '', 'B', false],
    ]
  )
})

test('non-size attributes distinguish variants and refresh filters without changing stable authoring', () => {
  const snapshot = source([
    { skuProperties: sku('red', '', [{ label: '香型', value: 'rose' }]) },
    { skuProperties: sku('red', '', [{ label: '香型', value: 'mint' }]) },
  ])
  const draft = createPreparation(snapshot, '2026-06')
  assert.deepEqual(
    draft.groups[0].variants.map((variant) => variant.variantSuffix),
    ['A', 'B']
  )
  assert.match(draft.groups[0].variants[0].variant, /香型: rose/)
  const active = activeGroups(draft, {
    ...snapshot,
    items: [snapshot.items[1], { ...snapshot.items[0], entryId: '3' }],
  })
  assert.equal(active[0].variants.length, 1)
  assert.equal(active[0].variants[0].id, draft.groups[0].variants[1].id)
  assert.equal(draft.groups[0].variants.length, 2)
  const invalid = structuredClone(draft)
  invalid.groups[0].variants[1].entryIds.push('1')
  assert.throws(() => validatePreparation(invalid), /only one variant/)
})

test('unlabeled source attributes remain distinct editable variant descriptions', () => {
  const snapshot = source([
    { skuProperties: [{ label: '', value: 'rose', raw: 'rose' }] },
    { skuProperties: [{ label: '', value: 'mint', raw: 'mint' }] },
  ])
  const draft = createPreparation(snapshot, '2026-06')
  assert.deepEqual(
    draft.groups[0].variants.map((variant) => [
      variant.variant,
      variant.size,
      variant.variantSuffix,
    ]),
    [
      ['rose', '', 'A'],
      ['mint', '', 'B'],
    ]
  )
  const allocated = allocatePreparation(draft, [], [])
  assert.deepEqual(
    allocated.preparation.groups[0].variants.map((variant) =>
      barcodeValue(allocated.preparation.groups[0], variant)
    ),
    ['CE26060101A', 'CE26060101B']
  )
  assert.equal(snapshot.items[0].skuProperties[0].raw, 'rose')
})

test('candidate membership uses structured attributes rather than their flattened display text', () => {
  const snapshot = source([
    { skuProperties: [{ label: 'finish', value: 'red / trim: gold' }] },
    {
      skuProperties: [
        { label: 'finish', value: 'red' },
        { label: 'trim', value: 'gold' },
      ],
    },
  ])
  const draft = createPreparation(snapshot, '2026-06')
  const variants = draft.groups[0].variants
  assert.equal(variants[0].variant, variants[1].variant)
  assert.deepEqual(
    variants.map((variant) => variant.entryIds),
    [['1'], ['2']]
  )
  assert.deepEqual(
    variants.map((variant) => variant.variantSuffix),
    ['A', 'B']
  )
})

test('allocation continues across orders, starts monthly at 01 and rolls over without reusing other sellers', () => {
  const first = createPreparation(
    source(
      Array.from({ length: 99 }, (_, index) => ({ title: `Product ${index}` }))
    ),
    '2026-06'
  )
  const state = allocatePreparation(first, [], [])
  assert.equal(state.preparation.groups[0].baseCode, 'CE26060101')
  assert.equal(state.preparation.groups[98].baseCode, 'CE26060199')
  const second = createPreparation(
    source([{}], { orderId: '2', sellerName: 'seller-b' }),
    '2026-06'
  )
  const secondState = allocatePreparation(
    second,
    state.allocations,
    state.issuedCodes
  )
  assert.equal(secondState.preparation.groups[0].baseCode, 'CE26060201')
  const third = createPreparation(source([{}], { orderId: '3' }), '2026-06')
  const thirdState = allocatePreparation(
    third,
    secondState.allocations,
    secondState.issuedCodes
  )
  assert.equal(thirdState.preparation.groups[0].baseCode, 'CE26060301')
  const nextMonth = allocatePreparation(
    { ...third, month: '2026-07' },
    thirdState.allocations,
    thirdState.issuedCodes
  )
  assert.equal(nextMonth.preparation.groups[0].baseCode, 'CE26070101')
  assert.equal(state.allocations[0].groups.length, 1)
})

test('manual base edits reserve old codes, advance allocation and reject seller/code collisions', () => {
  const first = allocatePreparation(
    createPreparation(source([{}]), '2026-06'),
    [],
    []
  )
  const changed = structuredClone(first.preparation)
  changed.groups[0].baseCode = 'CE26060108'
  const edited = allocatePreparation(
    changed,
    first.allocations,
    first.issuedCodes
  )
  assert.ok(edited.issuedCodes.some((entry) => entry.code === 'CE26060101'))
  assert.equal(edited.allocations[0].groups[0].nextItem, 9)
  const next = createPreparation(source([{}], { orderId: '2' }), '2026-06')
  const allocated = allocatePreparation(
    next,
    edited.allocations,
    edited.issuedCodes
  )
  assert.equal(allocated.preparation.groups[0].baseCode, 'CE26060109')
  next.groups[0].baseCode = 'CE26060101'
  assert.throws(
    () => allocatePreparation(next, edited.allocations, edited.issuedCodes),
    /Code conflict/
  )
  next.sellerId = 'seller-b'
  assert.throws(
    () => allocatePreparation(next, edited.allocations, edited.issuedCodes),
    /another seller/
  )
  next.groups[0].baseCode = 'CE26070101'
  assert.throws(
    () => allocatePreparation(next, edited.allocations, edited.issuedCodes),
    /chosen month/
  )
})

test('actual concatenated barcode collisions fail and exhausted allocations stay unchanged', () => {
  const draft = createPreparation(
    source([
      { skuProperties: sku('red', 'S') },
      { skuProperties: sku('blue', 'M') },
    ]),
    '2026-06'
  )
  draft.groups[0].variants[0].variantSuffix = 'AS'
  draft.groups[0].variants[0].sizeSuffix = 'M'
  draft.groups[0].variants[1].variantSuffix = 'A'
  draft.groups[0].variants[1].sizeSuffix = 'SM'
  assert.throws(() => allocatePreparation(draft, [], []), /Code conflict/)
  const allocation = {
    accountId: 'local',
    month: '2026-06',
    groups: Array.from({ length: 99 }, (_, index) => ({
      number: index + 1,
      sellerId: 'seller-a',
      nextItem: 100,
    })),
  }
  const original = structuredClone(allocation)
  assert.throws(
    () =>
      allocatePreparation(
        createPreparation(source([{}]), '2026-06'),
        [allocation],
        []
      ),
    /exhausted/
  )
  assert.deepEqual(allocation, original)
})

test('reservation union preserves high water marks and rejects independent conflicting ownership', () => {
  const first = allocatePreparation(
    createPreparation(source([{}]), '2026-06'),
    [],
    []
  )
  const independent = allocatePreparation(
    createPreparation(source([{}]), '2026-06'),
    [],
    []
  )
  assert.throws(
    () =>
      mergePackingState(
        [...first.allocations, ...independent.allocations],
        [...first.issuedCodes, ...independent.issuedCodes]
      ),
    /Code conflict/
  )
  const higher = structuredClone(first.allocations)
  higher[0].groups[0].nextItem = 90
  assert.equal(
    mergePackingState([...higher, ...first.allocations], first.issuedCodes)
      .allocations[0].groups[0].nextItem,
    90
  )
  assert.throws(
    () =>
      mergePackingState(
        first.allocations,
        first.issuedCodes.filter((entry) => entry.kind !== 'base')
      ),
    /owning base/
  )
})

test('preferences retain local vocabulary and reject executable logo formats', () => {
  assert.deepEqual(
    validatePackingPreferences({
      vocabulary: [{ match: '杯', spanishName: 'taza', category: '杯子' }],
      settings: { labelFontSize: 12 },
    }),
    {
      vocabulary: [{ match: '杯', spanishName: 'TAZA', category: '杯子' }],
      settings: { labelFontSize: 12 },
      logoDataUrl: '',
      sizeVocabulary: DEFAULT_SIZE_VOCABULARY,
    }
  )
  assert.throws(
    () =>
      validatePackingPreferences({
        logoDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
      }),
    /raster/
  )
})

function resettablePacking() {
  const snapshot = source([
    { title: 'Cup', skuProperties: sku('red', 'S') },
    { title: 'Cup', skuProperties: sku('red', 'L') },
    { title: 'Cup', skuProperties: sku('red', 'S') },
    { title: 'Plate' },
  ])
  const allocated = allocatePreparation(
    createPreparation(snapshot, '2026-10'),
    [],
    []
  )
  allocated.preparation.revision = 1
  allocated.preparation.defaultPacking = packingCheckpoint(
    allocated.preparation
  )
  return { snapshot, ...allocated }
}

test('reset is a no-op for saved defaults and retained names, even after saving again', () => {
  const original = resettablePacking()
  const draft = structuredClone(original.preparation)
  draft.groups[0].spanishName = 'TAZA'
  draft.groups[0].category = '杯子'
  draft.groups[0].variants[0].variant = 'Editable product description'
  draft.groups[0].variants[0].spanishName = 'TAZA ROJA'
  draft.updatedAt = '2026-10-16T00:00:00.000Z'
  draft.revision = 2
  assert.equal(hasDefaultPackingChanges(draft), false)
  assert.deepEqual(defaultPackingChanges(draft), [])
  const reset = restoreDefaultPacking(draft)
  assert.equal(reset.groups[0].spanishName, 'TAZA')
  assert.equal(
    reset.groups[0].variants[0].variant,
    'Editable product description'
  )
  assert.equal(reset.groups[0].variants[0].spanishName, 'TAZA ROJA')
  const saved = allocatePreparation(
    reset,
    original.allocations,
    original.issuedCodes
  )
  saved.preparation.revision = 3
  assert.equal(hasDefaultPackingChanges(saved.preparation), false)
})

test('reset reports group and variant order and suffix changes when the product code stays the same', () => {
  const original = resettablePacking()
  let draft = reorderPreparationGroups(
    original.preparation,
    [...original.preparation.groups].reverse().map((group) => group.id)
  )
  const cup = draft.groups[1]
  draft = reorderPreparationVariants(
    draft,
    cup.id,
    [...cup.variants].reverse().map((variant) => variant.id)
  )
  draft.groups[1].variants[0].variantSuffix = 'Z'
  draft.groups[1].variants[0].sizeSuffix = 'XL'
  const changes = defaultPackingChanges(draft)
  assert.equal(changes.length, 2)
  const change = changes.find((entry) => entry.groupId === cup.id)
  assert.equal(change.baseCodeChanged, false)
  assert.equal(change.beforePosition, 2)
  assert.equal(change.afterPosition, 1)
  assert.equal(change.orderChanged, true)
  assert.equal(change.variantOrderChanged, true)
  assert.equal(change.clearedManualOrdering, true)
  assert.equal(change.groupingChanged, false)
  assert.equal(change.barcodeChanges.length, 1)
  assert.equal(change.barcodeChanges[0].before, 'CE26100101ZXL')
  assert.equal(change.barcodeChanges[0].after, 'CE26100101L')
  const saved = allocatePreparation(
    restoreDefaultPacking(draft),
    original.allocations,
    original.issuedCodes
  )
  assert.deepEqual(
    saved.preparation.groups.map((group) => group.id),
    original.preparation.groups.map((group) => group.id)
  )
  assert.equal(hasDefaultPackingChanges(saved.preparation), false)
})

test('reset reports merged or missing products as membership changes without unrelated groups', () => {
  const original = resettablePacking()
  const draft = structuredClone(original.preparation)
  draft.groups[0].variants.push(...draft.groups[1].variants)
  draft.groups.splice(1, 1)
  const changes = defaultPackingChanges(draft)
  assert.equal(changes.length, 2)
  assert.ok(changes.every((entry) => entry.groupingChanged))
  assert.equal(changes.find((entry) => entry.before === null).afterPosition, 2)
  assert.equal(hasDefaultPackingChanges(restoreDefaultPacking(draft)), false)
})

test('remove packing products preserves partial shared variants, source rows and issued codes', () => {
  const original = resettablePacking()
  const unchanged = structuredClone(original)
  original.preparation.previousPacking = packingCheckpoint(
    original.preparation,
    { includeDefaults: true }
  )
  const removed = removeSelectedProducts(original.preparation, ['1', '4'])
  assert.equal(removed.groups.length, 1)
  assert.deepEqual(
    removed.groups[0].variants.map((variant) => variant.entryIds),
    [['3'], ['2']]
  )
  assert.equal(removed.groups[0].id, original.preparation.groups[0].id)
  assert.equal(
    removed.groups[0].variants[0].id,
    original.preparation.groups[0].variants[0].id
  )
  assert.equal(removed.groups[0].baseCode, 'CE26100101')
  assert.deepEqual(removed.defaultPacking.groups, removed.groups)
  assert.equal(hasDefaultPackingChanges(removed), false)
  assert.deepEqual(
    extendDefaultPacking(removed, original.snapshot),
    removed.defaultPacking
  )
  assert.deepEqual(original.snapshot, unchanged.snapshot)
  assert.deepEqual(original.preparation.groups, unchanged.preparation.groups)
  assert.deepEqual(
    restorePreviousPacking(removed).groups,
    original.preparation.groups
  )
  const saved = allocatePreparation(
    removed,
    original.allocations,
    original.issuedCodes
  )
  assert.deepEqual(saved.issuedCodes, original.issuedCodes)
  assert.deepEqual(saved.allocations, original.allocations)
  validatePreparationReservations(saved.preparation, saved)
  assert.deepEqual(
    activeGroups(saved.preparation, original.snapshot).flatMap((group) =>
      group.variants.flatMap((variant) => variant.entryIds)
    ),
    ['3', '2']
  )
})

test('removing the final packing products keeps a valid empty record and re-addition requires explicit selection', () => {
  const original = resettablePacking()
  const removed = removeSelectedProducts(original.preparation, [
    '1',
    '2',
    '3',
    '4',
  ])
  const saved = allocatePreparation(
    removed,
    original.allocations,
    original.issuedCodes
  )
  assert.deepEqual(saved.preparation.groups, [])
  assert.deepEqual(saved.preparation.defaultPacking.groups, [])
  validatePreparationReservations(saved.preparation, saved)
  assert.deepEqual(activeGroups(saved.preparation, original.snapshot), [])
  assert.equal(hasDefaultPackingChanges(saved.preparation), false)
  const plan = planSelectedPreparations(
    [
      {
        snapshot: original.snapshot,
        preparation: saved.preparation,
        entryIds: ['1'],
      },
    ],
    '2026-10'
  )
  const added = allocatePreparation(
    plan.preparations[0],
    saved.allocations,
    saved.issuedCodes
  )
  assert.deepEqual(added.preparation.groups[0].variants[0].entryIds, ['1'])
  assert.equal(added.preparation.groups[0].baseCode, 'CE26100103')
  assert.ok(added.issuedCodes.some((entry) => entry.code === 'CE26100101'))
  assert.equal(
    hasDefaultPackingChanges({
      ...saved.preparation,
      defaultPacking: undefined,
    }),
    false
  )
})

test('removal rejects stale or malformed memberships without changing the draft', () => {
  const { preparation } = resettablePacking()
  const original = structuredClone(preparation)
  assert.deepEqual(removeSelectedProducts(preparation, []), preparation)
  for (const ids of [['9'], ['1', '9'], ['not-an-id'], [1], null])
    assert.throws(() => removeSelectedProducts(preparation, ids), /products/)
  assert.deepEqual(preparation, original)
})
