import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeProductAnnotations, validateBackup } from '../src/database.js'
import {
  upgradeWorkspaceColors,
  WORKSPACE_COLOR_REVISION,
} from '../src/appearance.js'
import { initializeVocabulary } from '../src/product-vocabulary.js'
import {
  allocatePreparation,
  createPreparation,
  packingCheckpoint,
  validatePreparation,
  validatePreparationReservations,
} from '../src/packing-model.js'
import {
  createPackingBackup,
  isPackingPreparationSubset,
  mergePackingPreparation,
  selectPackingPreparation,
} from '../src/packing-backup.js'

function fixture() {
  const snapshot = {
    schemaVersion: 1,
    accountId: 'local',
    orderId: '1001',
    sourceUrl:
      'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1001',
    sellerName: 'Synthetic seller',
    sellerMemberLogin: 'synthetic-seller',
    status: 'Completed',
    observedAt: '2026-10-01T12:00:00.000Z',
    items: ['Red cup', 'Blue cup', 'Bowl'].map((description, index) => ({
      entryId: String(index + 1),
      title: index < 2 ? 'Cup' : 'Bowl',
      description,
      thumbnail: `https://cbu01.alicdn.com/synthetic-${index}.png`,
      skuProperties: [{ label: '颜色', value: index === 0 ? 'red' : 'blue' }],
      price: '10.00',
      quantity: '1',
      sourceDiscount: '0.00',
      allocatedDiscount: '0.00',
      discount: '0.00',
    })),
    totals: {
      goodsGross: '30.00',
      shipping: '0.00',
      sourceDiscount: '0.00',
      orderAdjustment: '0.00',
      goodsNet: '30.00',
      payable: '30.00',
    },
  }
  const allocated = allocatePreparation(
    createPreparation(snapshot, '2026-10'),
    [],
    [],
    { snapshot }
  )
  const preparation = {
    ...allocated.preparation,
    revision: 1,
    updatedAt: '2026-10-02T12:00:00.000Z',
  }
  preparation.defaultPacking = packingCheckpoint(preparation)
  preparation.previousPacking = packingCheckpoint(preparation, {
    includeDefaults: true,
  })
  const backup = {
    format: '1688-order-library',
    version: 2,
    exportedAt: '2026-10-04T12:00:00.000Z',
    orders: [
      {
        snapshot,
        revision: 1,
        changedAt: snapshot.observedAt,
        lastCheckedAt: snapshot.observedAt,
        notes: '',
        tags: [],
        changedEntryIds: [],
        removedEntryIds: [],
      },
    ],
    preparations: [preparation],
    allocations: allocated.allocations,
    issuedCodes: allocated.issuedCodes,
    history: [],
    images: snapshot.items.map((item) => ({
      url: item.thumbnail,
      dataUrl: 'data:image/png;base64,AAAA',
      storedAt: snapshot.observedAt,
    })),
  }
  return { snapshot, preparation, backup }
}

const selection = (entryIds = ['2']) => ({
  months: ['2026-10'],
  orders: [{ orderId: '1001', entryIds }],
})
const members = (preparation) =>
  preparation.groups.flatMap((group) =>
    group.variants.flatMap((variant) => variant.entryIds)
  )

test('scoped backup retains every local original referenced by full source dependencies', () => {
  const { backup } = fixture()
  const localUrls = ['a', 'b', 'c'].map(
    (char) => `local-image:${char.repeat(64)}`
  )
  backup.orders[0].snapshot.items.forEach((item, index) => {
    item.photos = [localUrls[index]]
  })
  backup.images.push(
    ...localUrls.map((url) => ({
      url,
      dataUrl: 'data:image/png;base64,AAAA',
      storedAt: backup.exportedAt,
    }))
  )
  const unrelated = `local-image:${'d'.repeat(64)}`
  backup.images.push({
    url: unrelated,
    dataUrl: 'data:image/png;base64,AAAA',
    storedAt: backup.exportedAt,
  })
  const scoped = createPackingBackup(backup, selection(['2']))
  assert.deepEqual(
    scoped.images
      .filter((image) => image.url.startsWith('local-image:'))
      .map((image) => image.url),
    localUrls
  )
  assert.equal(
    scoped.images.some((image) => image.url === unrelated),
    false
  )
  assert.equal(
    scoped.images.some(
      (image) => image.url === backup.orders[0].snapshot.items[0].thumbnail
    ),
    false
  )
  assert.deepEqual(members(scoped.preparations[0]), ['2'])
})

test('packing backup contains only selected prepared products and checkpoints, with full money dependencies', () => {
  const { backup } = fixture()
  const original = structuredClone(backup)
  const selected = createPackingBackup(backup, selection())
  assert.equal(selected.packingScope.mode, 'selection')
  assert.deepEqual(members(selected.preparations[0]), ['2'])
  for (const checkpoint of [
    selected.preparations[0].defaultPacking,
    selected.preparations[0].previousPacking,
    selected.preparations[0].previousPacking.defaults,
  ])
    assert.deepEqual(members(checkpoint), ['2'])
  assert.equal(selected.orders[0].snapshot.items.length, 3)
  assert.equal(selected.orders[0].snapshot.totals.payable, '30.00')
  assert.deepEqual(
    selected.images.map((image) => image.url),
    [backup.images[1].url]
  )
  const group = selected.preparations[0].groups[0]
  const variant = group.variants[0]
  assert.equal(selected.issuedCodes.length, 2)
  assert.ok(selected.issuedCodes.every((entry) => entry.groupId === group.id))
  assert.equal(
    selected.issuedCodes.find((entry) => entry.kind === 'barcode').variantId,
    variant.id
  )
  for (const entry of selected.issuedCodes)
    if (entry.ownerSnapshot)
      assert.deepEqual(entry.ownerSnapshot.entryIds, ['2'])
  assert.equal(
    selected.issuedCodes.find((entry) => entry.kind === 'base').ownerSnapshot,
    undefined
  )
  assert.deepEqual(backup, original)
  assert.deepEqual(members(validateBackup(selected).preparations[0]), ['2'])
})

test('packing backup omits unrelated history, allocations, image blobs and global preferences', () => {
  const { backup, snapshot } = fixture()
  const other = structuredClone(snapshot)
  other.orderId = '2002'
  other.sourceUrl = other.sourceUrl.replace('1001', '2002')
  other.sellerMemberLogin = 'unrelated-seller'
  other.items = other.items.map((item) => ({
    ...item,
    thumbnail: item.thumbnail.replace('synthetic-', 'unrelated-'),
  }))
  const allocated = allocatePreparation(
    createPreparation(other, '2026-11'),
    backup.allocations,
    backup.issuedCodes,
    { snapshot: other }
  )
  backup.orders.push({ ...structuredClone(backup.orders[0]), snapshot: other })
  backup.preparations.push({
    ...allocated.preparation,
    revision: 1,
    updatedAt: backup.preparations[0].updatedAt,
  })
  backup.allocations = allocated.allocations
  backup.issuedCodes = allocated.issuedCodes
  backup.allocations[0].groups.push({
    number: 90,
    sellerId: 'inactive-seller',
    nextItem: 80,
  })
  backup.allocations.push({
    accountId: 'other-account',
    month: '2025-01',
    groups: [{ number: 1, sellerId: 'other-account-seller', nextItem: 40 }],
  })
  backup.history = backup.orders.map((order) => {
    const previous = structuredClone(order)
    previous.snapshot.observedAt =
      previous.changedAt =
      previous.lastCheckedAt =
        '2026-09-30T12:00:00.000Z'
    return previous
  })
  const largeUnusedImage = 'data:image/png;base64,' + 'AAAA'.repeat(300_000)
  backup.images.push({
    url: other.items[0].thumbnail,
    dataUrl: largeUnusedImage,
    storedAt: other.observedAt,
  })
  backup.importDiagnostics = { unrelated: 'Not part of packing' }
  backup.orders[0].tags = ['Priority']
  backup.orders[0].productTags = {
    1: ['Not packed'],
    2: ['Fragile'],
    3: ['Not packed'],
  }
  backup.orders[0].productTagsUpdatedAt = backup.exportedAt
  backup.orders[0].packingExcludedEntryIds = ['1', '2']
  backup.orders[0].packingExclusionsUpdatedAt = backup.exportedAt
  const tag = (name) => ({
    name,
    colors: { light: '#ffeedd', dark: '#332211' },
    textColors: { light: '#332211', dark: '#ffeedd' },
  })
  const labelSettings = {
    dpi: 300,
    website: 'synthetic.example',
    destination: 'AQP, PE',
    barcode: { widthMm: 48, heightMm: 24, textScale: 1.1 },
    mark: { widthMm: 140, heightMm: 100, textScale: 0.95 },
  }
  backup.packingPreferences = {
    updatedAt: backup.exportedAt,
    value: {
      settings: {
        ...labelSettings,
        barcode: { ...labelSettings.barcode, unusedEditorPreference: true },
        vocabularyInitialized: true,
        vocabularyVersion: 1,
        unrelatedSetting: 'Do not export',
      },
      logoDataUrl: 'data:image/png;base64,BBBB',
      vocabulary: [
        { match: 'Unrelated', spanishName: 'OTHER', category: '物' },
      ],
      sizeVocabulary: [],
      colorVocabulary: [],
      appearance: { lightTheme: 'apricot', darkTheme: 'terracotta' },
      orderTags: [tag('Priority'), tag('Unrelated order tag')],
      productTags: [tag('Fragile'), tag('Not packed'), tag('Unused tag')],
    },
  }
  const original = structuredClone(backup)
  const scoped = createPackingBackup(backup, selection())
  const restored = validateBackup(scoped)
  assert.deepEqual(Object.keys(scoped).sort(), [
    'allocations',
    'exportedAt',
    'format',
    'history',
    'images',
    'issuedCodes',
    'orders',
    'packingPreferences',
    'packingScope',
    'preparations',
    'version',
  ])
  assert.equal(scoped.version, 3)
  assert.equal(scoped.orders.length, 1)
  assert.deepEqual(scoped.orders[0].snapshot, snapshot)
  assert.deepEqual(scoped.history, [])
  assert.deepEqual(scoped.allocations, [
    {
      accountId: 'local',
      month: '2026-10',
      groups: [{ number: 1, sellerId: 'synthetic-seller', nextItem: 2 }],
    },
  ])
  assert.equal(scoped.issuedCodes.length, 2)
  assert.ok(
    scoped.issuedCodes.every(
      (entry) => entry.orderId === '1001' && !entry.ownerSnapshot
    )
  )
  assert.deepEqual(scoped.images, [backup.images[1]])
  assert.ok(JSON.stringify(scoped).length < 20_000)
  assert.deepEqual(scoped.orders[0].productTags, { 2: ['Fragile'] })
  assert.deepEqual(scoped.orders[0].packingExcludedEntryIds, ['2'])
  assert.deepEqual(scoped.packingPreferences, {
    updatedAt: backup.exportedAt,
    value: {
      settings: labelSettings,
      logoDataUrl: 'data:image/png;base64,BBBB',
      orderTags: [tag('Priority')],
      productTags: [tag('Fragile')],
    },
  })
  assert.deepEqual(restored.preparations, scoped.preparations)
  assert.deepEqual(restored.allocations, scoped.allocations)
  assert.deepEqual(restored.issuedCodes, scoped.issuedCodes)
  assert.deepEqual(restored.packingPreferences.value.settings, labelSettings)
  assert.deepEqual(backup, original)
  const full = validateBackup(backup)
  assert.equal(full.orders.length, 2)
  assert.equal(full.history.length, 2)
  assert.equal(full.images.at(-1).dataUrl, largeUnusedImage)
  assert.equal(full.allocations.length, 3)
  assert.equal(full.packingPreferences.value.vocabulary.length, 1)
})

test('fresh scoped restore retains assigned custom tag colors without importing global appearance', () => {
  const { backup } = fixture()
  backup.orders[0].tags = ['Priority']
  backup.orders[0].productTags = { 1: ['Unselected'], 2: ['Fragile'] }
  backup.orders[0].productTagsUpdatedAt = backup.exportedAt
  const orderTag = {
    name: 'Priority',
    colors: { light: '#ffe8c4', dark: '#402619' },
    textColors: { light: '#6b3210', dark: '#ffd8ad' },
    used: true,
  }
  const productTag = {
    name: 'Fragile',
    colors: { light: '#dceee6', dark: '#243b30' },
    textColors: { light: '#274f38', dark: '#bde1cc' },
    used: true,
  }
  backup.packingPreferences = {
    updatedAt: backup.exportedAt,
    value: {
      settings: {},
      appearance: {
        paletteRevision: WORKSPACE_COLOR_REVISION,
        lightTheme: '1688',
        darkTheme: 'terracotta',
        labelColors: { saved: { light: '#ddeeff', dark: '#112233' } },
        labelTextColors: { saved: { light: '#112233', dark: '#ddeeff' } },
      },
      orderTags: [orderTag, { name: 'Unused order tag', colors: {} }],
      productTags: [productTag, { name: 'Unselected', colors: {} }],
      vocabulary: [{ match: 'Private catalog', spanishName: 'OTHER' }],
      colorVocabulary: [],
      sizeVocabulary: [],
    },
  }
  const scoped = createPackingBackup(backup, selection())
  assert.deepEqual(scoped.packingPreferences.value.appearance, {
    paletteRevision: WORKSPACE_COLOR_REVISION,
  })
  for (const field of ['vocabulary', 'colorVocabulary', 'sizeVocabulary'])
    assert.equal(scoped.packingPreferences.value[field], undefined)
  const validated = validateBackup(scoped).packingPreferences.value
  const initialized = initializeVocabulary(validated)
  const restored = upgradeWorkspaceColors(initialized)
  assert.deepEqual(restored.orderTags, [orderTag])
  assert.deepEqual(restored.productTags, [productTag])
  assert.deepEqual(restored.appearance, {
    lightTheme: 'warm',
    darkTheme: 'warm',
    labelColors: {},
    paletteRevision: WORKSPACE_COLOR_REVISION,
  })
  assert.ok(
    restored.vocabulary.every((rule) => rule.match !== 'Private catalog')
  )
})

test('clipped annotation clocks describe selected entries and full restore completes only unknown state', () => {
  const { backup } = fixture()
  const clock = backup.exportedAt
  Object.assign(backup.orders[0], {
    productTags: { 1: ['Outside'], 2: ['Inside'] },
    productTagsUpdatedAt: clock,
    packingExcludedEntryIds: ['1', '2'],
    packingExclusionsUpdatedAt: clock,
  })
  const scoped = createPackingBackup(backup, selection())
  const partial = validateBackup(scoped).orders[0]
  assert.equal(partial.productTagsUpdatedAt, undefined)
  assert.equal(partial.packingExclusionsUpdatedAt, undefined)
  assert.deepEqual(partial.productTagsPartialClocks, { 2: clock })
  assert.deepEqual(partial.packingExclusionsPartialClocks, { 2: clock })
  const legacyScoped = structuredClone(scoped)
  legacyScoped.orders[0].productTagsUpdatedAt = clock
  legacyScoped.orders[0].packingExclusionsUpdatedAt = clock
  delete legacyScoped.orders[0].productTagsPartialClocks
  delete legacyScoped.orders[0].packingExclusionsPartialClocks
  assert.deepEqual(validateBackup(legacyScoped).orders[0], partial)
  const complete = mergeProductAnnotations(partial, backup.orders[0])
  assert.deepEqual(complete, backup.orders[0])

  const later = '2026-10-06T12:00:00.000Z'
  const cleared = {
    ...partial,
    productTags: {},
    packingExcludedEntryIds: [],
    productTagsPartialClocks: { 2: later },
    packingExclusionsPartialClocks: { 2: later },
  }
  const filled = mergeProductAnnotations(cleared, backup.orders[0])
  assert.deepEqual(filled.productTags, { 1: ['Outside'] })
  assert.deepEqual(filled.packingExcludedEntryIds, ['1'])
  assert.deepEqual(filled.productTagsPartialClocks, { 2: later })
  assert.deepEqual(filled.packingExclusionsPartialClocks, { 2: later })
  assert.equal(filled.productTagsUpdatedAt, clock)
  assert.equal(filled.packingExclusionsUpdatedAt, clock)

  const middle = '2026-10-05T12:00:00.000Z'
  const intermediate = {
    ...backup.orders[0],
    productTags: { 1: ['Updated outside'], 2: ['Older selected'] },
    productTagsUpdatedAt: middle,
    packingExcludedEntryIds: ['2', '3'],
    packingExclusionsUpdatedAt: middle,
  }
  const merged = mergeProductAnnotations(filled, intermediate)
  assert.deepEqual(merged.productTags, { 1: ['Updated outside'] })
  assert.deepEqual(merged.packingExcludedEntryIds, ['3'])
  assert.deepEqual(merged.productTagsPartialClocks, { 2: later })
  assert.deepEqual(merged.packingExclusionsPartialClocks, { 2: later })
  assert.equal(merged.productTagsUpdatedAt, middle)

  const partialAgain = createPackingBackup(
    { ...backup, orders: [merged] },
    selection(['1', '2'])
  ).orders[0]
  assert.deepEqual(partialAgain.productTagsPartialClocks, {
    1: middle,
    2: later,
  })
  assert.deepEqual(partialAgain.packingExclusionsPartialClocks, {
    1: middle,
    2: later,
  })
  const restoredPartial = mergeProductAnnotations(
    backup.orders[0],
    partialAgain
  )
  assert.deepEqual(restoredPartial.productTags, { 1: ['Updated outside'] })
  assert.deepEqual(restoredPartial.packingExcludedEntryIds, [])

  const newest = {
    ...intermediate,
    productTagsUpdatedAt: '2026-10-07T12:00:00.000Z',
    packingExclusionsUpdatedAt: '2026-10-07T12:00:00.000Z',
  }
  const finished = mergeProductAnnotations(merged, newest)
  assert.deepEqual(finished.productTags, newest.productTags)
  assert.deepEqual(
    finished.packingExcludedEntryIds,
    newest.packingExcludedEntryIds
  )
  assert.equal(finished.productTagsPartialClocks, undefined)
  assert.equal(finished.packingExclusionsPartialClocks, undefined)
  assert.equal(mergeProductAnnotations(finished, backup.orders[0]), finished)
  const tie = { ...newest, productTags: {}, packingExcludedEntryIds: [] }
  assert.equal(mergeProductAnnotations(finished, tie), finished)
})

test('partial annotation metadata is validated and survives backup validation', () => {
  const { backup } = fixture()
  Object.assign(backup.orders[0], {
    productTags: { 2: ['Inside'] },
    productTagsUpdatedAt: backup.exportedAt,
    packingExcludedEntryIds: ['2'],
    packingExclusionsUpdatedAt: backup.exportedAt,
  })
  const scoped = createPackingBackup(backup, selection())
  assert.deepEqual(validateBackup(scoped).orders, scoped.orders)
  for (const field of [
    'productTagsPartialClocks',
    'packingExclusionsPartialClocks',
  ]) {
    for (const value of [
      [],
      { 2: 'yesterday' },
      { bad: backup.exportedAt },
      {},
    ]) {
      const invalid = structuredClone(scoped)
      invalid.orders[0][field] = value
      assert.throws(() => validateBackup(invalid), /Partial product annotation/)
    }
  }
  for (const [clock, partial] of [
    ['productTagsUpdatedAt', 'productTagsPartialClocks'],
    ['packingExclusionsUpdatedAt', 'packingExclusionsPartialClocks'],
  ]) {
    const invalid = structuredClone(backup)
    invalid.orders[0][partial] = { 2: invalid.orders[0][clock] }
    assert.throws(() => validateBackup(invalid), /must follow/)
  }
})

test('carton capacity survives full backup validation and rejects malformed saved values', () => {
  const { backup } = fixture()
  Object.assign(backup.orders[0], {
    unitsPerCarton: { 1: 10, 2: 20 },
    unitsPerCartonUpdatedAt: backup.exportedAt,
  })
  assert.deepEqual(validateBackup(backup).orders, backup.orders)
  for (const unitsPerCarton of [
    [],
    { bad: 10 },
    { 1: 0 },
    { 1: -1 },
    { 1: 1.5 },
    { 1: '10' },
    { 1: null },
    { 1: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    const invalid = structuredClone(backup)
    invalid.orders[0].unitsPerCarton = unitsPerCarton
    assert.throws(() => validateBackup(invalid), /Pcs\/box/)
  }
})

test('packing capacity backup clips entries and clocks while full restore preserves newer clears', () => {
  const { backup } = fixture()
  const clock = backup.exportedAt
  const later = '2026-10-06T12:00:00.000Z'
  Object.assign(backup.orders[0], {
    unitsPerCarton: { 1: 10, 2: 20, 3: 30 },
    unitsPerCartonUpdatedAt: clock,
  })
  const scoped = createPackingBackup(backup, selection())
  const partial = validateBackup(scoped).orders[0]
  assert.deepEqual(partial.unitsPerCarton, { 2: 20 })
  assert.deepEqual(partial.unitsPerCartonPartialClocks, { 2: clock })
  assert.equal(partial.unitsPerCartonUpdatedAt, undefined)
  assert.deepEqual(
    mergeProductAnnotations(partial, backup.orders[0]),
    backup.orders[0]
  )
  const cleared = {
    ...partial,
    unitsPerCarton: {},
    unitsPerCartonPartialClocks: { 2: later },
  }
  const completed = mergeProductAnnotations(cleared, backup.orders[0])
  assert.deepEqual(completed.unitsPerCarton, { 1: 10, 3: 30 })
  assert.equal(completed.unitsPerCartonUpdatedAt, clock)
  assert.deepEqual(completed.unitsPerCartonPartialClocks, { 2: later })
  const clearedBackup = createPackingBackup(
    { ...backup, orders: [completed] },
    selection(['1', '2'])
  )
  assert.deepEqual(clearedBackup.orders[0].unitsPerCartonPartialClocks, {
    1: clock,
    2: later,
  })
  assert.deepEqual(clearedBackup.orders[0].unitsPerCarton, { 1: 10 })
  assert.deepEqual(validateBackup(clearedBackup).orders, clearedBackup.orders)
  assert.equal(mergeProductAnnotations(completed, partial), completed)
  const merged = mergeProductAnnotations(
    backup.orders[0],
    clearedBackup.orders[0]
  )
  assert.deepEqual(merged.unitsPerCarton, { 1: 10, 3: 30 })
  const newest = {
    ...backup.orders[0],
    unitsPerCartonUpdatedAt: '2026-10-07T12:00:00.000Z',
  }
  assert.equal(
    mergeProductAnnotations(completed, newest).unitsPerCartonPartialClocks,
    undefined
  )
})

test('capacity partial clocks must cover every saved value and follow the complete clock', () => {
  const { backup } = fixture()
  Object.assign(backup.orders[0], {
    unitsPerCarton: { 2: 10 },
    unitsPerCartonPartialClocks: { 2: backup.exportedAt },
  })
  assert.deepEqual(validateBackup(backup).orders, backup.orders)
  for (const value of [
    [],
    {},
    { 2: 'yesterday' },
    { bad: backup.exportedAt },
  ]) {
    const invalid = structuredClone(backup)
    invalid.orders[0].unitsPerCartonPartialClocks = value
    assert.throws(() => validateBackup(invalid), /Partial product annotation/)
  }
  const invalid = structuredClone(backup)
  invalid.orders[0].unitsPerCartonUpdatedAt = backup.exportedAt
  assert.throws(() => validateBackup(invalid), /must follow/)
})

test('same-time preparation completion accepts exact subsets but rejects changed shared authoring', () => {
  const { preparation } = fixture()
  const partial = selectPackingPreparation(preparation, ['2'])
  assert.equal(isPackingPreparationSubset(partial, preparation), true)
  assert.equal(isPackingPreparationSubset(preparation, partial), false)
  assert.equal(isPackingPreparationSubset(preparation, preparation), false)
  partial.groups[0].baseCode = 'CE26100105'
  assert.equal(isPackingPreparationSubset(partial, preparation), false)
})

test('an empty backup selection never means all products', () => {
  const { backup } = fixture()
  assert.throws(
    () => createPackingBackup(backup, selection([])),
    /invalid or duplicate selection/
  )
  assert.throws(
    () => createPackingBackup(backup, { months: ['2026-10'], orders: [] }),
    /Back up packing/
  )
})

test('scope rejects unprepared entries, duplicate months and month mismatches', () => {
  const { backup } = fixture()
  const missingPreparation = structuredClone(backup)
  missingPreparation.preparations[0].groups[0].variants.splice(1, 1)
  assert.throws(
    () => createPackingBackup(missingPreparation, selection()),
    /missing a prepared product/
  )
  for (const months of [
    ['2026-10', '2026-10'],
    ['2026-11'],
    ['2026-10', '2026-11'],
  ])
    assert.throws(
      () => createPackingBackup(backup, { ...selection(), months }),
      /months/
    )
})

test('legacy packing scopes are clipped on read, while full v1 and v2 backups stay full', () => {
  const { backup } = fixture()
  const legacy = { ...backup, packingScope: selection() }
  assert.deepEqual(members(validateBackup(legacy).preparations[0]), ['2'])
  assert.deepEqual(members(validateBackup(backup).preparations[0]), [
    '1',
    '2',
    '3',
  ])
  assert.deepEqual(validateBackup({ ...backup, version: 1 }).preparations, [])
  assert.throws(
    () =>
      validateBackup({
        ...backup,
        packingScope: { ...selection(), mode: 'selection' },
      }),
    /unselected preparation data/
  )
})

test('restoring selected variants preserves all other product authoring and issued codes', () => {
  const { preparation, backup } = fixture()
  const incoming = selectPackingPreparation(preparation, ['2'])
  incoming.updatedAt = '2026-10-03T12:00:00.000Z'
  incoming.groups[0].variants[0].variant = 'Updated blue cup'
  const original = structuredClone(preparation)
  const merged = mergePackingPreparation(preparation, incoming, ['2'])
  assert.deepEqual(members(merged), ['1', '2', '3'])
  assert.deepEqual(merged.groups[1], {
    ...preparation.groups[1],
    month: '2026-10',
  })
  assert.deepEqual(
    merged.groups[0].variants.find((variant) => variant.entryIds.includes('1')),
    preparation.groups[0].variants[0]
  )
  assert.equal(
    merged.groups[0].variants.find((variant) => variant.entryIds.includes('2'))
      .variant,
    'Updated blue cup'
  )
  assert.equal(merged.revision, 2)
  validatePreparationReservations(merged, backup)
  assert.deepEqual(preparation, original)
})

test('newer local packing edits win and tied conflicting edits fail', () => {
  const { preparation } = fixture()
  const incoming = selectPackingPreparation(preparation, ['2'])
  incoming.updatedAt = '2026-10-01T12:00:00.000Z'
  incoming.groups[0].variants[0].variant = 'Old'
  assert.equal(
    mergePackingPreparation(preparation, incoming, ['2']),
    preparation
  )
  incoming.updatedAt = preparation.updatedAt
  assert.throws(
    () => mergePackingPreparation(preparation, incoming, ['2']),
    /same timestamp/
  )
  assert.equal(
    mergePackingPreparation(
      preparation,
      selectPackingPreparation(preparation, ['2']),
      ['2']
    ),
    preparation
  )
})

test('shared group edits cannot modify unselected products during restore', () => {
  const { preparation } = fixture()
  const incoming = selectPackingPreparation(preparation, ['2'])
  incoming.updatedAt = '2026-10-03T12:00:00.000Z'
  incoming.groups[0].spanishName = 'NEW NAME'
  assert.throws(
    () => mergePackingPreparation(preparation, incoming, ['2']),
    /Restore the whole group/
  )
  const whole = selectPackingPreparation(preparation, ['1', '2'])
  whole.updatedAt = incoming.updatedAt
  whole.groups[0].spanishName = 'NEW NAME'
  assert.equal(
    mergePackingPreparation(preparation, whole, ['1', '2']).groups[0]
      .spanishName,
    'NEW NAME'
  )
})

test('fresh-library restore keeps a partial preparation partial', () => {
  const { preparation } = fixture()
  const restored = mergePackingPreparation(undefined, preparation, ['2'])
  assert.deepEqual(members(restored), ['2'])
  assert.deepEqual(members(restored.defaultPacking), ['2'])
})

test('partial restore keeps unselected group slots and applies only selected group ordering', () => {
  const { preparation } = fixture()
  preparation.groups.push({
    ...structuredClone(preparation.groups[1]),
    id: 'plate',
    title: 'Plate',
    baseCode: 'CE26100103',
    variants: [
      {
        ...preparation.groups[1].variants[0],
        id: 'plate-variant',
        entryIds: ['4'],
      },
    ],
  })
  preparation.defaultPacking = packingCheckpoint(preparation)
  const incoming = selectPackingPreparation(preparation, ['1', '2', '4'])
  incoming.updatedAt = '2026-10-03T12:00:00.000Z'
  incoming.groups[0].variants[0].variant = 'Changed cup description'
  const originalOrder = preparation.groups.map((group) => group.id)
  const restored = mergePackingPreparation(preparation, incoming, [
    '1',
    '2',
    '4',
  ])
  assert.deepEqual(
    restored.groups.map((group) => group.id),
    originalOrder
  )
  incoming.groups.reverse()
  incoming.defaultPacking.groups.reverse()
  const reordered = mergePackingPreparation(preparation, incoming, [
    '1',
    '2',
    '4',
  ])
  assert.deepEqual(
    reordered.groups.map((group) => group.id),
    [originalOrder[2], originalOrder[1], originalOrder[0]]
  )
  assert.deepEqual(
    reordered.defaultPacking.groups.map((group) => group.id),
    [originalOrder[2], originalOrder[1], originalOrder[0]]
  )
})

test('partial restore keeps unselected variant slots and shared source-row positions', () => {
  const { preparation } = fixture()
  preparation.groups[0].variants.push({
    ...structuredClone(preparation.groups[0].variants[1]),
    id: 'green-cup',
    entryIds: ['4'],
    variantSuffix: 'C',
  })
  const originalIds = preparation.groups[0].variants.map(
    (variant) => variant.id
  )
  const incoming = selectPackingPreparation(preparation, ['1', '4'])
  incoming.updatedAt = '2026-10-03T12:00:00.000Z'
  incoming.groups[0].variants.reverse()
  const reordered = mergePackingPreparation(preparation, incoming, ['1', '4'])
  assert.deepEqual(
    reordered.groups[0].variants.map((variant) => variant.id),
    [originalIds[2], originalIds[1], originalIds[0]]
  )
  preparation.groups[0].variants = [
    { ...preparation.groups[0].variants[0], entryIds: ['1', '2', '4'] },
  ]
  const shared = selectPackingPreparation(preparation, ['2'])
  shared.updatedAt = incoming.updatedAt
  assert.deepEqual(
    mergePackingPreparation(preparation, shared, ['2']).groups[0].variants[0]
      .entryIds,
    ['1', '2', '4']
  )
})

test('implicit and explicit effective months compare equally, including all checkpoints', () => {
  const { preparation } = fixture()
  const incoming = selectPackingPreparation(preparation, ['2'])
  for (const checkpoint of [
    incoming,
    incoming.defaultPacking,
    incoming.previousPacking,
    incoming.previousPacking.defaults,
  ])
    for (const group of checkpoint.groups) group.month = checkpoint.month
  assert.equal(
    mergePackingPreparation(preparation, validatePreparation(incoming), ['2']),
    preparation
  )
  incoming.updatedAt = '2026-10-03T12:00:00.000Z'
  incoming.groups[0].variants[0].variant = 'Changed description'
  const merged = mergePackingPreparation(preparation, incoming, ['2'])
  assert.deepEqual(members(merged), ['1', '2', '3'])
  assert.deepEqual(members(merged.defaultPacking), ['1', '2', '3'])
  assert.deepEqual(members(merged.previousPacking), ['1', '2', '3'])
  assert.deepEqual(members(merged.previousPacking.defaults), ['1', '2', '3'])
})

test('selection-only backups reject extra source orders outside the declared restore scope', () => {
  const { backup } = fixture()
  const extra = structuredClone(backup.orders[0])
  extra.snapshot.orderId = '2002'
  extra.snapshot.sourceUrl =
    'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=2002'
  backup.orders.push(extra)
  const selected = createPackingBackup(backup, selection())
  assert.equal(selected.orders.length, 1)
  selected.orders.push(extra)
  assert.throws(() => validateBackup(selected), /unselected source order/)
})

test('legacy scoped backups retain complete scoped orders and history without importing unrelated orders', () => {
  const { backup } = fixture()
  const unrelated = structuredClone(backup.orders[0])
  unrelated.snapshot.orderId = '2002'
  unrelated.snapshot.sourceUrl =
    'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=2002'
  const otherAccount = structuredClone(backup.orders[0])
  otherAccount.snapshot.accountId = 'other-account'
  backup.orders.push(unrelated, otherAccount)
  backup.history = backup.orders.map((order) => {
    const history = structuredClone(order)
    history.snapshot.observedAt =
      history.changedAt =
      history.lastCheckedAt =
        '2026-09-30T12:00:00.000Z'
    return history
  })
  const full = validateBackup(backup)
  assert.equal(full.orders.length, 3)
  assert.equal(full.history.length, 3)
  const scoped = validateBackup({ ...backup, packingScope: selection() })
  assert.equal(scoped.orders.length, 1)
  assert.equal(scoped.history.length, 1)
  for (const record of [...scoped.orders, ...scoped.history]) {
    assert.equal(record.snapshot.orderId, '1001')
    assert.equal(record.snapshot.accountId, 'local')
    assert.equal(record.snapshot.items.length, 3)
    assert.equal(record.snapshot.totals.payable, '30.00')
  }
  assert.deepEqual(members(scoped.preparations[0]), ['2'])
})
