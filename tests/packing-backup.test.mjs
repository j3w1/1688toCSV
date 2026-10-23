import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeProductAnnotations, validateBackup } from '../src/database.js'
import { paymentSourceEvidence } from '../src/payment-links.js'
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

test('month-less physical facts require complete v5 order scope and retain exact facts and tombstones', () => {
  const { backup } = fixture()
  backup.version = 5
  const physical = {
    id: 'synthetic-modern-physical',
    accountId: 'local',
    orderId: '1001',
    storeId: '["1688","synthetic-seller"]',
    groups: [],
    contents: [{ orderId: '1001', entryId: '2', quantity: '1' }],
    count: 1,
    packingBasis: 'exact',
    unresolvedContents: [],
    len: '60',
    wid: '50',
    ht: '40',
    weight: '16.75',
    weightBasis: 'carton',
    suppliedCbm: '',
    volumeBasis: 'carton',
    received: null,
    loaded: null,
    revision: 1,
    updatedAt: '2026-10-03T12:00:00.000Z',
    sourceFacts: { supplierCarton: '0007', reportedWeight: '16.75' },
  }
  const tombstone = {
    ...physical,
    id: 'synthetic-deleted-physical',
    deletedAt: '2026-10-04T12:00:00.000Z',
  }
  backup.cartonBatches = [physical, tombstone]
  for (const field of [
    'containers',
    'packingReports',
    'reportSources',
    'orderCartonDrafts',
    'shipmentLocks',
    'operationIntents',
  ])
    backup[field] = []
  assert.throws(
    () => createPackingBackup(backup, selection()),
    (error) =>
      error.code === 'PACKING_BACKUP_DEPENDENCY_REVIEW' &&
      error.requiredOrderRefs[0].orderId === '1001'
  )
  const result = createPackingBackup(backup, selection(['1', '2', '3']))
  assert.deepEqual(result.cartonBatches, [physical, tombstone])
  assert.deepEqual(result.orders[0].snapshot, backup.orders[0].snapshot)
  assert.equal(result.version, 5)
  assert.equal(result.cartonBatches[0].month, undefined)
  assert.notStrictEqual(result.cartonBatches[0], physical)
})

test('packing backups retain complete linked payment sources without adding their packing scope', () => {
  const { backup } = fixture()
  const target = backup.orders[0]
  const source = structuredClone(target)
  source.snapshot.orderId = '1002'
  source.snapshot.sourceUrl = source.snapshot.sourceUrl.replace('1001', '1002')
  source.productWorkflow = {
    1: { features: { lighting: true } },
    3: { features: { rotation: true } },
  }
  source.productWorkflowUpdatedAt = '2026-10-02T12:00:00.000Z'
  source.packingExcludedEntryIds = ['1', '2', '3']
  source.packingExclusionsUpdatedAt = '2026-10-02T12:00:00.000Z'
  target.paymentLinks = [
    {
      id: 'synthetic-payment',
      sourceOrderId: '1002',
      amount: '30.00',
      reason: 'Recorded service payment',
      targetEntryIds: ['1', '2', '3'],
      reviewedAt: '2026-10-02T12:00:00.000Z',
      sourceEvidence: paymentSourceEvidence(source),
    },
  ]
  target.paymentLinksUpdatedAt = '2026-10-02T12:00:00.000Z'
  backup.orders.push(source)
  const partial = createPackingBackup(backup, selection())
  assert.deepEqual(partial.packingScope.orders, [
    { accountId: 'local', orderId: '1001', entryIds: ['2'] },
  ])
  assert.deepEqual(partial.packingScope.dependencies, [
    { accountId: 'local', orderId: '1002' },
  ])
  assert.deepEqual(
    partial.orders.find((record) => record.snapshot.orderId === '1002'),
    source
  )
  assert.equal(partial.preparations.length, 1)
  assert.doesNotThrow(() => validateBackup(partial))
  const missing = structuredClone(partial)
  missing.packingScope.dependencies = []
  assert.throws(() => validateBackup(missing), /financial source dependency/)
  const dangling = structuredClone(partial)
  dangling.orders = dangling.orders.filter(
    (record) => record.snapshot.orderId !== '1002'
  )
  assert.throws(() => validateBackup(dangling), /source order was not found/)
  const unrelated = structuredClone(partial)
  const extra = structuredClone(source)
  extra.snapshot.orderId = '1003'
  extra.snapshot.sourceUrl = extra.snapshot.sourceUrl.replace('1002', '1003')
  unrelated.orders.push(extra)
  assert.throws(() => validateBackup(unrelated), /financial source dependency/)
})
const members = (preparation) =>
  preparation.groups.flatMap((group) =>
    group.variants.flatMap((variant) => variant.entryIds)
  )

test('full and scoped 1688 backups retain optional independent pointer sizes without rewriting legacy photos', () => {
  const { backup } = fixture()
  const edit = {
    tagScale: 1.5,
    pointerScale: 3.25,
    invertPointer: true,
    tags: [
      { id: 'tag-a', code: 'A', x: 0.25, y: 0.3, labelX: 0.8, labelY: 0.8 },
    ],
  }
  backup.orders[0].snapshot.items[1].photoEdits = { 0: edit }
  for (const data of [
    validateBackup(backup),
    validateBackup(createPackingBackup(backup, selection())),
  ]) {
    assert.deepEqual(data.orders[0].snapshot.items[1].photoEdits, { 0: edit })
    assert.equal(data.orders[0].snapshot.items[0].photoEdits, undefined)
  }
  const invalid = structuredClone(backup)
  invalid.orders[0].snapshot.items[1].photoEdits['0'].pointerScale = NaN
  assert.throws(() => validateBackup(invalid), /Photo pointer size/)
  for (const invertPointer of [false, true]) {
    backup.orders[0].snapshot.items[1].photoEdits['0'].invertPointer =
      invertPointer
    for (const data of [
      validateBackup(backup),
      validateBackup(createPackingBackup(backup, selection())),
    ])
      assert.equal(
        data.orders[0].snapshot.items[1].photoEdits['0'].invertPointer,
        invertPointer
      )
  }
  const wrongInversion = structuredClone(backup)
  wrongInversion.orders[0].snapshot.items[1].photoEdits['0'].invertPointer =
    'false'
  assert.throws(
    () => validateBackup(wrongInversion),
    /Photo pointer color inversion/
  )
})

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

test('scoped backup retains cached originals for transformed thumbnails and gallery photos', () => {
  const { backup } = fixture()
  const item = backup.orders[0].snapshot.items[1]
  const original = 'https://cbu01.alicdn.com/selected.jpg?_=2020'
  const gallery = 'https://cbu01.alicdn.com/gallery.png?_=2021'
  item.thumbnail = original.replace('.jpg?', '.jpg_250x250.jpg?')
  item.photos = [gallery.replace('.png?', '.png_300x300q90.jpg_.webp?')]
  const cached = [original, gallery].map((url) => ({
    url,
    dataUrl: 'data:image/png;base64,AAAA',
    storedAt: backup.exportedAt,
  }))
  backup.images.push(...cached)
  const scoped = createPackingBackup(backup, selection())
  assert.deepEqual(scoped.images, cached)
  assert.doesNotThrow(() => validateBackup(scoped))
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
    'cartonBatches',
    'exportedAt',
    'format',
    'history',
    'images',
    'issuedCodes',
    'omittedCartonBatchIds',
    'orders',
    'packingPreferences',
    'packingScope',
    'preparations',
    'version',
  ])
  assert.equal(scoped.version, 4)
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

test('same-time disjoint monthly preparations complete missing groups and every checkpoint in either restore order', () => {
  const { preparation } = fixture()
  for (const checkpoint of [
    preparation,
    preparation.defaultPacking,
    preparation.previousPacking,
    preparation.previousPacking.defaults,
  ]) {
    checkpoint.groups[1].month = '2026-11'
    checkpoint.groups[1].baseCode = checkpoint.groups[1].baseCode.replace(
      'CE2610',
      'CE2611'
    )
  }
  for (const [firstIds, secondIds] of [
    [['1', '2'], ['3']],
    [['3'], ['1', '2']],
    [['1'], ['2']],
  ]) {
    const first = selectPackingPreparation(preparation, firstIds)
    const second = selectPackingPreparation(preparation, secondIds)
    const before = structuredClone(first)
    const merged = mergePackingPreparation(first, second, secondIds)
    const expected = [...firstIds, ...secondIds].sort()
    for (const checkpoint of [
      merged,
      merged.defaultPacking,
      merged.previousPacking,
      merged.previousPacking.defaults,
    ])
      assert.deepEqual(members(checkpoint).sort(), expected)
    assert.equal(merged.updatedAt, preparation.updatedAt)
    assert.equal(merged.revision, first.revision + 1)
    assert.equal(mergePackingPreparation(merged, first, firstIds), merged)
    assert.equal(mergePackingPreparation(merged, second, secondIds), merged)
    assert.deepEqual(first, before)
  }
})

test('same-time completion rejects overlapping product, shared group and checkpoint contradictions', () => {
  const { preparation } = fixture()
  const first = selectPackingPreparation(preparation, ['1', '2'])
  const incoming = selectPackingPreparation(preparation, ['2', '3'])
  assert.deepEqual(
    members(mergePackingPreparation(first, incoming, ['2', '3'])),
    ['1', '2', '3']
  )
  for (const change of [
    (value) => (value.groups[0].variants[0].variant = 'Changed overlap'),
    (value) => (value.defaultPacking.groups[0].spanishName = 'Changed reset'),
    (value) =>
      (value.previousPacking.defaults.groups[0].baseCode = 'CE26100199'),
  ]) {
    const conflicting = structuredClone(incoming)
    change(conflicting)
    assert.throws(
      () => mergePackingPreparation(first, conflicting, ['2', '3']),
      /same timestamp/
    )
  }
  const disjoint = selectPackingPreparation(preparation, ['1'])
  const contradictoryGroup = selectPackingPreparation(preparation, ['2'])
  contradictoryGroup.groups[0].spanishName = 'Contradictory group'
  assert.throws(
    () => mergePackingPreparation(disjoint, contradictoryGroup, ['2']),
    /Restore the whole group/
  )
})

test('reverse same-time scope composition accepts the unchanged complete ordering at every level', () => {
  const checkpoints = (value) =>
    [
      value,
      value.defaultPacking,
      value.previousPacking,
      value.previousPacking?.defaults,
    ].filter(Boolean)
  const layout = (value) =>
    value.groups.map((group) => ({
      id: group.id,
      variants: group.variants.map((variant) => ({
        id: variant.id,
        entryIds: variant.entryIds,
      })),
    }))
  for (const sharedEntries of [false, true]) {
    const { preparation } = fixture()
    if (sharedEntries)
      for (const checkpoint of checkpoints(preparation))
        checkpoint.groups[0].variants = [
          { ...checkpoint.groups[0].variants[0], entryIds: ['1', '2'] },
        ]
    for (const [firstIds, secondIds] of [
      [['3'], ['1', '2']],
      [['2'], ['1']],
    ]) {
      const first = selectPackingPreparation(preparation, firstIds)
      const second = selectPackingPreparation(preparation, secondIds)
      const composed = mergePackingPreparation(first, second, secondIds)
      const restored = mergePackingPreparation(composed, preparation, [
        '1',
        '2',
        '3',
      ])
      for (const [index, checkpoint] of checkpoints(restored).entries()) {
        assert.deepEqual(
          layout(checkpoint),
          layout(checkpoints(preparation)[index])
        )
        assert.equal(checkpoint.restoreScopes, undefined)
      }
      assert.equal(
        mergePackingPreparation(restored, preparation, ['1', '2', '3']),
        restored
      )
    }
  }
})

test('same-time composition preserves known overlapping group, variant and source-row order', () => {
  const { preparation } = fixture()
  const checkpoints = (value) => [
    value,
    value.defaultPacking,
    value.previousPacking,
    value.previousPacking.defaults,
  ]
  for (const [firstIds, secondIds, change] of [
    [['1', '3'], ['2'], (value) => value.groups.reverse()],
    [['1', '2'], ['3'], (value) => value.groups[0].variants.reverse()],
  ]) {
    const composed = mergePackingPreparation(
      selectPackingPreparation(preparation, firstIds),
      selectPackingPreparation(preparation, secondIds),
      secondIds
    )
    for (let index = 0; index < 4; index++) {
      const conflicting = structuredClone(preparation)
      change(checkpoints(conflicting)[index])
      assert.throws(
        () => mergePackingPreparation(composed, conflicting, ['1', '2', '3']),
        /same timestamp/
      )
    }
  }
  for (const checkpoint of checkpoints(preparation))
    checkpoint.groups[0].variants = [
      { ...checkpoint.groups[0].variants[0], entryIds: ['1', '2'] },
    ]
  const composed = mergePackingPreparation(
    selectPackingPreparation(preparation, ['1', '2']),
    selectPackingPreparation(preparation, ['3']),
    ['3']
  )
  const conflicting = structuredClone(preparation)
  conflicting.groups[0].variants[0].entryIds.reverse()
  assert.throws(
    () => mergePackingPreparation(composed, conflicting, ['1', '2', '3']),
    /same timestamp/
  )
})

test('same-time checkpoint conflicts are checked for checkpoint-only rows independently of active membership', () => {
  const { preparation } = fixture()
  const previous = selectPackingPreparation(preparation, ['1'])
  previous.defaultPacking = structuredClone(preparation.defaultPacking)
  previous.previousPacking = structuredClone(preparation.previousPacking)
  for (const field of ['defaultPacking', 'previousPacking', 'defaults']) {
    const incoming = selectPackingPreparation(preparation, ['2'])
    const checkpoint =
      field === 'defaults' ? incoming.previousPacking.defaults : incoming[field]
    checkpoint.groups[0].spanishName = 'CONTRADICTORY DEFAULT'
    assert.doesNotThrow(() => validatePreparation(previous))
    assert.doesNotThrow(() => validatePreparation(incoming))
    assert.throws(
      () => mergePackingPreparation(previous, incoming, ['2']),
      /same timestamp/
    )
  }
})

test('restore order provenance validates retained coverage and is clipped without unselected IDs', () => {
  const { preparation } = fixture()
  const composed = mergePackingPreparation(
    selectPackingPreparation(preparation, ['3']),
    selectPackingPreparation(preparation, ['1', '2']),
    ['1', '2']
  )
  assert.deepEqual(composed.restoreScopes, [['3'], ['1', '2']])
  assert.deepEqual(
    validatePreparation(composed).restoreScopes,
    composed.restoreScopes
  )
  const selected = selectPackingPreparation(composed, ['1', '3'])
  assert.deepEqual(selected.restoreScopes, [['3'], ['1']])
  for (const restoreScopes of [
    [['1']],
    [['1', '2', '3', '4']],
    [
      ['1', '1'],
      ['2', '3'],
    ],
    [
      ['1', '2', '3'],
      ['3', '2', '1'],
    ],
    Array.from({ length: 10 }, () => ['1']),
  ]) {
    assert.throws(
      () => validatePreparation({ ...composed, restoreScopes }),
      /restore scope evidence/
    )
  }
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
