import { test, expect } from './extension-fixture.mjs'
import { DEFAULT_SIZE_VOCABULARY } from '../../src/size-vocabulary.js'

const orderId = '1234567890123456789'
const thumbnail = 'https://cbu01.alicdn.com/synthetic-order.png'
const image = {
  url: thumbnail,
  dataUrl:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2WZ4kAAAAASUVORK5CYII=',
  storedAt: '2026-01-01T12:00:00.000Z',
}

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    accountId: 'local',
    orderId,
    sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
    sellerName: 'Synthetic factory',
    status: 'Completed',
    observedAt: '2026-01-01T12:00:00.000Z',
    items: [
      {
        entryId: '2234567890123456789',
        thumbnail,
        description: 'Synthetic box',
        price: '10.00',
        quantity: '2',
        sourceDiscount: '1.00',
        allocatedDiscount: '0.00',
        discount: '1.00',
      },
      {
        entryId: '2234567890123456790',
        thumbnail,
        description: 'Synthetic bowl',
        price: '5.00',
        quantity: '1',
        sourceDiscount: '0.00',
        allocatedDiscount: '0.00',
        discount: '0.00',
      },
    ],
    totals: {
      goodsGross: '25.00',
      shipping: '2.00',
      sourceDiscount: '1.00',
      orderAdjustment: '0.00',
      goodsNet: '24.00',
      payable: '26.00',
    },
    ...overrides,
  }
}

async function openTestDatabase(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async () => {
    const { openDatabase } = await import('/src/database.js')
    window.openOrderDatabase = openDatabase
    window.databaseName = `synthetic-orders-${crypto.randomUUID()}`
    window.library = await openDatabase({ name: window.databaseName })
  })
  return page
}

test('legacy workspace colors reseed once and later custom colors survive reload and backup restore', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    await library.setNotes(first.orderId, {
      notes: 'Keep note',
      tags: ['Display stock'],
    })
    const legacy = await library.getPackingPreferences()
    legacy.appearance = {
      lightTheme: '1688',
      darkTheme: 'terracotta',
      labelColors: { dates: { light: '#ff00ff' } },
    }
    legacy.orderTags = [
      {
        name: 'Display stock',
        colors: { light: '#123456' },
        textColors: { dark: '#fedcba' },
      },
    ]
    await library.savePackingPreferences(legacy)
    const before = await library.exportBackup()
    const upgraded = await library.getPackingPreferences()
    const after = await library.exportBackup()
    const custom = structuredClone(upgraded)
    custom.appearance.labelColors.dates = { light: '#345678' }
    custom.orderTags[0].colors.dark = '#543210'
    custom.orderTags[0].textColors = { dark: '#ffeedd' }
    await library.savePackingPreferences(custom)
    library.close()
    window.library = await openOrderDatabase({ name: databaseName })
    const reopened = await library.getPackingPreferences()
    const backup = await library.exportBackup()
    const restored = await openOrderDatabase({ name: `${databaseName}-reseed` })
    await restored.restoreBackup(backup)
    const restoredPreferences = await restored.getPackingPreferences()
    const record = await restored.getOrder(first.orderId)
    restored.close()
    return {
      upgraded,
      reopened,
      restoredPreferences,
      record,
      beforeUpdatedAt: before.packingPreferences.updatedAt,
      afterUpdatedAt: after.packingPreferences.updatedAt,
    }
  }, snapshot())
  expect(result.upgraded.appearance).toEqual({
    lightTheme: '1688',
    darkTheme: 'terracotta',
    labelColors: {},
    paletteRevision: 1,
  })
  expect(result.upgraded.orderTags).toEqual([
    { name: 'Display stock', colors: {}, used: true },
  ])
  expect(result.beforeUpdatedAt).toBe(result.afterUpdatedAt)
  expect(result.reopened.appearance.labelColors.dates).toEqual({
    light: '#345678',
  })
  expect(result.reopened.orderTags[0]).toEqual({
    name: 'Display stock',
    colors: { dark: '#543210' },
    textColors: { dark: '#ffeedd' },
    used: true,
  })
  expect(result.restoredPreferences).toEqual(result.reopened)
  expect(result.record.notes).toBe('Keep note')
  expect(result.record.tags).toEqual(['Display stock'])
  expect(result.record.snapshot).toEqual(snapshot())
})

test('order tags register atomically with notes and survive stale Settings saves and backup restore', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    const stale = await library.getPackingPreferences()
    await library.setNotes(first.orderId, {
      notes: 'Keep newest note',
      tags: ['New shared tag'],
    })
    let preferences = await library.getPackingPreferences()
    preferences.orderTags[0].colors = { light: '#301800', dark: '#ffcc88' }
    preferences.orderTags[0].textColors = { light: '#ffeedd', dark: '#543210' }
    await library.savePackingPreferences(preferences)
    stale.orderTags = [{ name: 'Created in settings', colors: {} }]
    await library.savePackingPreferences(stale)
    const backup = await library.exportBackup()
    const restored = await openOrderDatabase({ name: `${databaseName}-tags` })
    await restored.restoreBackup(backup)
    const output = {
      preferences: await restored.getPackingPreferences(),
      record: await restored.getOrder(first.orderId),
    }
    restored.close()
    return output
  }, snapshot())
  expect(result.record.notes).toBe('Keep newest note')
  expect(result.record.tags).toEqual(['New shared tag'])
  expect(result.record.snapshot).toEqual(snapshot())
  expect(result.preferences.orderTags).toEqual([
    { name: 'Created in settings', colors: {} },
    {
      name: 'New shared tag',
      colors: { light: '#301800', dark: '#ffcc88' },
      textColors: { light: '#ffeedd', dark: '#543210' },
      used: true,
    },
  ])
})

test('tag catalogs expire after last use, retain unused Settings entries and stay separate across scopes', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const second = { ...first, accountId: 'other-account' }
    await library.saveSnapshot(first)
    await library.saveSnapshot(second)
    const prefs = await library.getPackingPreferences()
    prefs.orderTags = [
      { name: 'Waiting', colors: {} },
      { name: 'Shared', colors: {} },
    ]
    prefs.productTags = [{ name: 'Unused product', colors: {} }]
    await library.savePackingPreferences(prefs)
    const stale = await library.getPackingPreferences()
    const baseline = {
      orderTags: stale.orderTags,
      productTags: stale.productTags,
    }
    await library.setNotes(first.orderId, {
      notes: 'Order note',
      tags: ['Shared'],
    })
    await library.setNotes(
      first.orderId,
      { notes: 'Other note', tags: ['Shared'] },
      { accountId: second.accountId }
    )
    await library.setProductTags(first.orderId, first.items[0].entryId, [
      'Shared',
      'One product',
    ])
    await library.setProductTags(first.orderId, first.items[1].entryId, [
      'Shared',
    ])
    await library.setProductTags(
      first.orderId,
      first.items[0].entryId,
      ['Shared'],
      { accountId: second.accountId }
    )
    const counts = [
      await library.getTagUsage('Shared'),
      await library.getTagUsage('Shared', { scope: 'product' }),
    ]
    await library.setNotes(first.orderId, { notes: 'Order note', tags: [] })
    const stillUsed = await library.getPackingPreferences()
    await library.setNotes(
      first.orderId,
      { notes: 'Other note', tags: [] },
      { accountId: second.accountId }
    )
    await library.savePackingPreferences(stale, {
      tagCatalogBaseline: baseline,
    })
    const expired = await library.getPackingPreferences()
    const removed = await library.removeTag('Shared', { scope: 'product' })
    const records = [
      await library.getOrder(first.orderId),
      await library.getOrder(first.orderId, { accountId: second.accountId }),
    ]
    const unusedRemoval = await library.removeTag('Waiting')
    return { counts, stillUsed, expired, removed, records, unusedRemoval }
  }, snapshot())
  expect(result.counts).toEqual([2, 3])
  expect(
    result.stillUsed.orderTags.find((tag) => tag.name === 'Shared').used
  ).toBe(true)
  expect(result.expired.orderTags.map((tag) => tag.name)).toEqual(['Waiting'])
  expect(result.expired.productTags.map((tag) => tag.name)).toEqual([
    'Unused product',
    'Shared',
    'One product',
  ])
  expect(result.removed.removedAssignments).toBe(3)
  expect(result.removed.preferences.productTags.map((tag) => tag.name)).toEqual(
    ['Unused product', 'One product']
  )
  expect(result.records[0].productTags).toEqual({
    [snapshot().items[0].entryId]: ['One product'],
  })
  expect(result.records[1].productTags).toEqual({})
  expect(result.records[0].notes).toBe('Order note')
  expect(result.records[0].snapshot).toEqual(snapshot())
  expect(result.unusedRemoval.removedAssignments).toBe(0)
  expect(result.unusedRemoval.preferences.orderTags).toEqual([])
})

test('tag renames update current and historical assignments atomically without reviving old catalog names', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    await library.saveSnapshot({ ...first, accountId: 'other-account' })
    for (const accountId of ['local', 'other-account']) {
      await library.setNotes(
        first.orderId,
        { notes: 'Keep note', tags: ['Shared'] },
        { accountId }
      )
      await library.setProductTags(
        first.orderId,
        first.items[0].entryId,
        ['Shared'],
        { accountId }
      )
    }
    await library.setProductTags(first.orderId, first.items[1].entryId, [
      'Shared',
    ])
    const preferences = await library.getPackingPreferences()
    preferences.orderTags.push({ name: 'Waiting', colors: {} })
    preferences.productTags.push({ name: 'Waiting', colors: {} })
    preferences.productTags.find((tag) => tag.name === 'Shared').colors = {
      dark: '#123456',
    }
    await library.savePackingPreferences(preferences)
    const stale = await library.getPackingPreferences()
    const baseline = {
      orderTags: stale.orderTags,
      productTags: stale.productTags,
    }
    await library.saveSnapshot({
      ...first,
      observedAt: '2026-01-02T12:00:00.000Z',
      items: first.items.map((item) => ({
        ...item,
        description: `${item.description} refreshed`,
      })),
    })
    const order = await library.renameTag('Shared', 'Order renamed')
    const product = await library.renameTag('Shared', 'Product renamed', {
      scope: 'product',
    })
    await library.savePackingPreferences(stale, {
      tagCatalogBaseline: baseline,
    })
    const before = await library.exportBackup()
    const errors = []
    for (const [name, nextName, scope] of [
      ['Order renamed', 'Waiting', 'order'],
      ['Product renamed', 'Waiting', 'product'],
      ['Product renamed', '', 'product'],
    ]) {
      try {
        await library.renameTag(name, nextName, { scope })
      } catch (error) {
        errors.push(error.message)
      }
    }
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (
        this.name === 'packingPreferences' &&
        args[0]?.value?.productTags?.some((tag) => tag.name === 'Broken')
      )
        throw new DOMException(
          'Synthetic catalog write unavailable',
          'QuotaExceededError'
        )
      return put.apply(this, args)
    }
    try {
      await library.renameTag('Product renamed', 'Broken', { scope: 'product' })
    } catch (error) {
      errors.push(error.message)
    } finally {
      IDBObjectStore.prototype.put = put
    }
    const after = await library.exportBackup()
    return {
      orderCount: order.renamedAssignments,
      productCount: product.renamedAssignments,
      before,
      after,
      errors,
    }
  }, snapshot())
  expect(result.orderCount).toBe(2)
  expect(result.productCount).toBe(3)
  expect(result.errors).toHaveLength(4)
  expect(result.errors[0]).toContain('already exists')
  expect(result.errors[1]).toContain('already exists')
  expect(result.errors[2]).toContain('Enter a tag name')
  expect(result.errors[3]).toContain('Synthetic catalog write unavailable')
  expect({ ...result.after, exportedAt: '' }).toEqual({
    ...result.before,
    exportedAt: '',
  })
  expect(
    result.after.orders.every(
      (record) => record.tags.join() === 'Order renamed'
    )
  ).toBe(true)
  expect(
    result.after.orders.every((record) =>
      Object.values(record.productTags)
        .flat()
        .every((name) => name === 'Product renamed')
    )
  ).toBe(true)
  expect(result.after.history[0].tags).toEqual(['Order renamed'])
  expect(Object.values(result.after.history[0].productTags).flat()).toEqual([
    'Product renamed',
    'Product renamed',
  ])
  const prefs = result.after.packingPreferences.value
  expect(prefs.orderTags.map((tag) => tag.name)).not.toContain('Shared')
  expect(prefs.productTags.map((tag) => tag.name)).not.toContain('Shared')
  expect(
    prefs.productTags.find((tag) => tag.name === 'Product renamed').colors.dark
  ).toBe('#123456')
  expect(result.after.orders[0].notes).toBe('Keep note')
})

test('product tags survive source refresh and backup roundtrip, and older backups cannot undo a clear', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    await library.setProductTags(first.orderId, first.items[0].entryId, [
      'Fragile',
    ])
    let preferences = await library.getPackingPreferences()
    preferences.productTags[0].colors = { light: '#301800', dark: '#ffcc88' }
    preferences.productTags[0].textColors = {
      light: '#ffeedd',
      dark: '#543210',
    }
    await library.savePackingPreferences(preferences)
    const tagged = await library.exportBackup()
    const changed = {
      ...first,
      observedAt: '2026-01-02T12:00:00.000Z',
      items: first.items.map((item) => ({
        ...item,
        description: item.description + ' updated',
      })),
    }
    await library.saveSnapshot(changed)
    const refreshed = await library.getOrder(first.orderId)
    const backup = await library.exportBackup()
    const restored = await openOrderDatabase({
      name: `${databaseName}-product-tags`,
    })
    await restored.restoreBackup(backup)
    const roundtrip = await restored.getOrder(first.orderId)
    const colors = (await restored.getPackingPreferences()).productTags
    await restored.setProductTags(first.orderId, first.items[0].entryId, [])
    await restored.restoreBackup(tagged)
    const afterOldBackup = await restored.getOrder(first.orderId)
    const catalog = (await restored.getPackingPreferences()).productTags
    const beforeInvalid = await restored.exportBackup()
    let invalidMessage = ''
    try {
      await restored.setProductTags(first.orderId, first.items[1].entryId, [
        'New',
        null,
      ])
    } catch (error) {
      invalidMessage = error.message
    }
    const afterInvalid = await restored.exportBackup()
    const bad = structuredClone(backup)
    bad.orders[0].productTags[first.items[1].entryId] = 'not a tag array'
    let backupError = ''
    try {
      await restored.restoreBackup(bad)
    } catch (error) {
      backupError = error.message
    }
    const afterBadBackup = await restored.exportBackup()
    restored.close()
    return {
      refreshed,
      roundtrip,
      colors,
      afterOldBackup,
      catalog,
      beforeInvalid,
      afterInvalid,
      afterBadBackup,
      invalidMessage,
      backupError,
    }
  }, snapshot())
  const tags = { [snapshot().items[0].entryId]: ['Fragile'] }
  expect(result.refreshed.productTags).toEqual(tags)
  expect(result.roundtrip.productTags).toEqual(tags)
  expect(result.roundtrip.snapshot).toEqual(result.refreshed.snapshot)
  expect(result.colors).toEqual([
    {
      name: 'Fragile',
      colors: { light: '#301800', dark: '#ffcc88' },
      textColors: { light: '#ffeedd', dark: '#543210' },
      used: true,
    },
  ])
  expect(result.afterOldBackup.productTags).toEqual({})
  expect(result.afterOldBackup.snapshot).toEqual(result.refreshed.snapshot)
  expect(result.catalog).toEqual([])
  expect(result.invalidMessage).toContain('Product tags')
  expect(result.backupError).toContain('Product tags')
  for (const key of ['orders', 'history', 'packingPreferences']) {
    expect(result.afterInvalid[key]).toEqual(result.beforeInvalid[key])
    expect(result.afterBadBackup[key]).toEqual(result.beforeInvalid[key])
  }
})

test('archived row tag identities remain while their order exists and global removal also clears history', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    await library.setNotes(first.orderId, {
      notes: 'Keep',
      tags: ['All orders'],
    })
    await library.setProductTags(first.orderId, first.items[0].entryId, [
      'Archived',
    ])
    const smaller = {
      ...first,
      observedAt: '2026-01-02T12:00:00.000Z',
      items: [first.items[1]],
      totals: {
        goodsGross: '5.00',
        shipping: '2.00',
        sourceDiscount: '0.00',
        orderAdjustment: '0.00',
        goodsNet: '5.00',
        payable: '7.00',
      },
    }
    await library.saveSnapshot(smaller)
    const archived = await library.getOrder(first.orderId)
    const count = await library.getTagUsage('Archived', { scope: 'product' })
    await library.removeTag('Archived', { scope: 'product' })
    await library.removeTag('All orders')
    const history = await library.getHistory(first.orderId)
    const current = await library.getOrder(first.orderId)
    const preferences = await library.getPackingPreferences()
    await library.setProductTags(first.orderId, first.items[1].entryId, [
      'Last order',
    ])
    await library.removeOrders([first.orderId])
    const removedOrderPreferences = await library.getPackingPreferences()
    return {
      archived,
      count,
      history,
      current,
      preferences,
      removedOrderPreferences,
    }
  }, snapshot())
  expect(result.archived.productTags).toEqual({
    [snapshot().items[0].entryId]: ['Archived'],
  })
  expect(result.count).toBe(1)
  expect(result.current.productTags).toEqual({})
  expect(result.current.tags).toEqual([])
  expect(result.current.notes).toBe('Keep')
  expect(result.history[0].productTags).toEqual({})
  expect(result.history[0].tags).toEqual([])
  expect(result.history[0].snapshot).toEqual(snapshot())
  expect(result.preferences.productTags).toEqual([])
  expect(result.preferences.orderTags).toEqual([])
  expect(result.removedOrderPreferences.productTags).toEqual([])
})

test('customization service survives refresh, change detection and backup without changing product amounts', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const original = await library.saveSnapshot(first)
    const oldBackup = await library.exportBackup()
    const unchanged = await library.saveSnapshot({
      ...first,
      observedAt: '2026-01-02T12:00:00.000Z',
    })
    const chargedSnapshot = {
      ...first,
      observedAt: '2026-01-03T12:00:00.000Z',
      totals: {
        ...first.totals,
        customizationService: '12.50',
        payable: '38.50',
      },
    }
    const charged = await library.saveSnapshot(chargedSnapshot)
    const repeated = await library.saveSnapshot({
      ...chargedSnapshot,
      observedAt: '2026-01-04T12:00:00.000Z',
    })
    const changed = await library.saveSnapshot({
      ...chargedSnapshot,
      observedAt: '2026-01-05T12:00:00.000Z',
      totals: {
        ...first.totals,
        customizationService: '15.00',
        payable: '41.00',
      },
    })
    const zero = await library.saveSnapshot({
      ...first,
      observedAt: '2026-01-06T12:00:00.000Z',
      totals: { ...first.totals, customizationService: '0.00' },
    })
    const backup = await library.exportBackup()
    const restored = await openOrderDatabase({
      name: `${databaseName}-customization`,
    })
    await restored.restoreBackup(oldBackup)
    const oldRecord = await restored.getOrder(first.orderId)
    await restored.restoreBackup(backup)
    const record = await restored.getOrder(first.orderId)
    const history = await restored.getHistory(first.orderId)
    restored.close()
    return {
      original,
      unchanged,
      charged,
      repeated,
      changed,
      zero,
      oldRecord,
      record,
      history,
    }
  }, snapshot())
  expect(result.unchanged.changed).toBe(false)
  expect(result.unchanged.order.revision).toBe(1)
  expect(result.oldRecord.snapshot.totals).toEqual(snapshot().totals)
  expect(result.charged.order.revision).toBe(2)
  expect(result.charged.order.snapshot.totals.customizationService).toBe(
    '12.50'
  )
  expect(result.repeated.changed).toBe(false)
  expect(result.repeated.order.revision).toBe(2)
  expect(result.changed.changed).toBe(true)
  expect(result.changed.order.revision).toBe(3)
  expect(result.changed.order.changedEntryIds).toEqual([])
  expect(result.zero.order.revision).toBe(4)
  expect(result.record.snapshot.totals).toEqual({
    ...snapshot().totals,
    customizationService: '0.00',
  })
  for (const item of [
    result.charged.order,
    result.changed.order,
    result.record,
  ])
    expect(item.snapshot.items).toEqual(result.original.order.snapshot.items)
  expect(
    result.history
      .map(({ snapshot: entry }) => entry.totals.customizationService)
      .sort()
  ).toEqual(['12.50', '15.00', undefined])
})

test('import and startup persist automatic names without preparing or allocating codes', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const first = snapshot()
  first.items[0].title = '测试 藤条扩香 香氛精油'
  first.items[1].title = '未命名测试样品'
  const result = await page.evaluate(async (input) => {
    await library.saveSnapshot(input)
    const imported = await library.getOrder(input.orderId)
    const saved = await library.exportBackup()
    const raw = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const tx = raw.transaction('orders', 'readwrite')
      const old = structuredClone(imported)
      delete old.namingSuggestions
      tx.objectStore('orders').put(old)
      tx.oncomplete = resolve
      tx.onabort = () => reject(tx.error)
    })
    raw.close()
    const backfill = await library.refreshNamingSuggestions()
    const current = await library.getOrder(input.orderId)
    const second = await library.refreshNamingSuggestions()
    const backup = await library.exportBackup()
    return { imported, saved, backfill, current, second, backup }
  }, first)
  expect(
    result.imported.namingSuggestions.groups.map(
      ({ spanishName, category, status }) => [spanishName, category, status]
    )
  ).toEqual([
    ['DIFUSOR', '香薰', 'matched'],
    ['', '', 'unknown'],
  ])
  expect(result.current.snapshot).toEqual(result.imported.snapshot)
  expect(result.current.revision).toBe(result.imported.revision)
  expect(result.backfill).toEqual({ orders: 1, preparations: 0 })
  expect(result.second).toEqual({ orders: 0, preparations: 0 })
  for (const backup of [result.saved, result.backup]) {
    expect(backup.preparations).toEqual([])
    expect(backup.allocations).toEqual([])
    expect(backup.issuedCodes).toEqual([])
  }
})

test('automatic naming changes preserve manual fields, explicit clears, codes and backup overrides', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const first = snapshot()
  first.items[0].title = '测试 蜡烛'
  first.items[1].title = '未命名测试样品'
  const result = await page.evaluate(async (input) => {
    const { createPreparation } = await import('/src/packing-model.js')
    await library.saveSnapshot(input)
    const original = await library.savePreparation(
      createPreparation(input, '2026-10')
    )
    const manual = structuredClone(original)
    manual.groups[0].spanishName = ''
    const edited = await library.savePreparation(manual)
    const preferences = await library.getPackingPreferences()
    preferences.vocabulary.push({
      match: '蜡烛',
      spanishName: 'VELA NUEVA',
      category: '香薰蜡烛',
    })
    await library.savePackingPreferences(preferences)
    const renamed = await library.getPreparation(input.orderId)
    await library.saveSnapshot({
      ...input,
      observedAt: '2026-02-01T00:00:00.000Z',
    })
    const current = await library.getPreparation(input.orderId)
    const backup = await library.exportBackup()
    const restored = await openOrderDatabase({
      name: `${databaseName}-names-restored`,
    })
    // Opening Settings in an empty library must not make the bundled defaults
    // newer than the user's saved vocabulary when the backup is restored.
    await restored.getPackingPreferences()
    await restored.restoreBackup(backup)
    const restoredBackup = await restored.exportBackup()
    restored.close()
    return { original, edited, renamed, current, backup, restoredBackup }
  }, first)
  expect(result.original.groups[0].spanishName).toBe('VELA')
  expect(result.edited.groups[0].naming.spanishName.source).toBe('manual')
  expect(result.renamed.groups[0].spanishName).toBe('')
  expect(result.renamed.groups[0].category).toBe('香薰蜡烛')
  expect(result.renamed.groups[0].naming.category.source).toBe('automatic')
  expect(result.current).toEqual(result.renamed)
  expect(result.renamed.groups.map((group) => group.baseCode)).toEqual(
    result.original.groups.map((group) => group.baseCode)
  )
  expect(result.restoredBackup.preparations).toEqual(result.backup.preparations)
  expect(result.restoredBackup.issuedCodes).toEqual(result.backup.issuedCodes)
  expect(result.restoredBackup.packingPreferences).toEqual(
    result.backup.packingPreferences
  )
  expect(
    result.restoredBackup.orders[0].namingSuggestions.groups[0].spanishName
  ).toBe('VELA NUEVA')
})

test('derived names preserve authoring time so newer manual backups restore and repeated legacy restores are idempotent', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const first = snapshot()
  first.items[0].title = '测试 蜡烛'
  const result = await page.evaluate(async (input) => {
    const { createPreparation } = await import('/src/packing-model.js')
    await library.saveSnapshot(input)
    await library.savePreparation(createPreparation(input, '2026-10'))
    const legacy = await library.exportBackup()
    legacy.packingPreferences = null
    legacy.preparations[0].updatedAt = '2026-10-01T00:00:00.000Z'
    for (const group of legacy.preparations[0].groups) {
      delete group.naming
      group.category = ''
      group.spanishName = ''
    }
    legacy.preparations[0].groups[0].spanishName = 'EDITADO OCT1'
    const restored = await openOrderDatabase({
      name: `${databaseName}-authored-dates`,
    })
    await restored.restoreBackup(legacy)
    const backfilled = await restored.getPreparation(input.orderId)
    await restored.restoreBackup(legacy)
    const repeatedLegacy = await restored.getPreparation(input.orderId)
    const newer = structuredClone(legacy)
    newer.preparations[0].updatedAt = '2026-10-02T00:00:00.000Z'
    newer.preparations[0].groups[0].spanishName = 'EDITADO OCT2'
    newer.preparations[0].groups[0].category = '香薰蜡烛'
    await restored.restoreBackup(newer)
    const edited = await restored.getPreparation(input.orderId)
    await restored.restoreBackup(legacy)
    await restored.restoreBackup(newer)
    const repeated = await restored.getPreparation(input.orderId)
    const conflict = structuredClone(newer)
    conflict.preparations[0].groups[0].spanishName = 'CONFLICTO'
    let error
    try {
      await restored.restoreBackup(conflict)
    } catch (failure) {
      error = failure.message
    }
    const afterConflict = await restored.getPreparation(input.orderId)
    restored.close()
    return {
      backfilled,
      repeatedLegacy,
      edited,
      repeated,
      afterConflict,
      error,
    }
  }, first)
  expect(result.backfilled.updatedAt).toBe('2026-10-01T00:00:00.000Z')
  expect(result.backfilled.groups[0].spanishName).toBe('EDITADO OCT1')
  expect(result.backfilled.groups[0].category).toBe('蜡烛')
  expect(result.backfilled.revision).toBeGreaterThan(1)
  expect(result.repeatedLegacy).toEqual(result.backfilled)
  expect(result.edited.updatedAt).toBe('2026-10-02T00:00:00.000Z')
  expect(result.edited.groups[0].spanishName).toBe('EDITADO OCT2')
  expect(result.edited.groups[0].category).toBe('香薰蜡烛')
  expect(result.repeated).toEqual(result.edited)
  expect(result.error).toContain('same timestamp')
  expect(result.afterConflict).toEqual(result.edited)
})

test('invalid customization service rejects snapshots and entire backups before writing', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    const backup = await library.exportBackup()
    const next = structuredClone(backup.orders[0])
    next.snapshot.orderId = '9999999999999999999'
    next.snapshot.sourceUrl = first.sourceUrl.replace(
      first.orderId,
      next.snapshot.orderId
    )
    const rejected = []
    const cases = [
      { customizationService: '-1.00', payable: '25.00' },
      { customizationService: '1.00', payable: '26.00' },
      { customizationService: '0.001', payable: '26.00' },
      ...[null, undefined, 1, '', '¥1.00', '+1.00', '1 2.00', 'unknown'].map(
        (customizationService) => ({ customizationService, payable: '27.00' })
      ),
    ]
    for (const values of cases) {
      const invalid = {
        ...first,
        observedAt: '2026-01-02T12:00:00.000Z',
        totals: { ...first.totals, ...values },
      }
      for (const operation of [
        () => library.saveSnapshot(invalid),
        () =>
          library.restoreBackup({
            ...backup,
            orders: [
              next,
              {
                ...backup.orders[0],
                snapshot: invalid,
                lastCheckedAt: invalid.observedAt,
              },
            ],
          }),
      ]) {
        try {
          await operation()
        } catch (error) {
          rejected.push(error.message)
        }
      }
    }
    return {
      rejected,
      expectedRejections: cases.length * 2,
      orders: await library.listOrders(),
    }
  }, snapshot())
  expect(result.rejected).toHaveLength(result.expectedRejections)
  expect(result.orders).toHaveLength(1)
  expect(result.orders[0].revision).toBe(1)
  expect(result.orders[0].snapshot.totals).toEqual(snapshot().totals)
})

test('customization inside original gross survives backups and rejects unexplained or partial gross differences', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const valid = {
      ...first,
      totals: {
        ...first.totals,
        goodsGross: '30.00',
        customizationService: '5.00',
        grossIncludedCustomization: '5.00',
        payable: '31.00',
      },
    }
    await library.saveSnapshot(valid)
    const backup = await library.exportBackup()
    const restored = await openOrderDatabase({
      name: `${databaseName}-included-customization`,
    })
    await restored.restoreBackup(backup)
    const record = await restored.getOrder(first.orderId)
    const rejected = []
    for (const change of [
      { grossIncludedCustomization: '-1.00' },
      { grossIncludedCustomization: '4.99', goodsGross: '29.99' },
      { grossIncludedCustomization: '5.01', goodsGross: '30.01' },
      { customizationService: '0.00', payable: '26.00' },
      { goodsGross: '30.01' },
      { payable: '36.00' },
      { grossIncludedCustomization: '0.001' },
    ]) {
      const invalid = {
        ...valid,
        observedAt: '2026-01-02T12:00:00.000Z',
        totals: { ...valid.totals, ...change },
      }
      for (const operation of [
        () => restored.saveSnapshot(invalid),
        () =>
          restored.restoreBackup({
            ...backup,
            orders: [{ ...backup.orders[0], snapshot: invalid }],
          }),
      ]) {
        try {
          await operation()
        } catch (error) {
          rejected.push(error.message)
        }
      }
    }
    const after = await restored.getOrder(first.orderId)
    restored.close()
    return { record, after, rejected }
  }, snapshot())
  expect(result.record.snapshot.totals).toMatchObject({
    goodsGross: '30.00',
    customizationService: '5.00',
    grossIncludedCustomization: '5.00',
    payable: '31.00',
  })
  expect(result.record.snapshot.items).toEqual(snapshot().items)
  expect(result.rejected).toHaveLength(14)
  expect(result.after).toEqual(result.record)
})

test('red packets stay separate through changes, old backups and combined customization charges', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const existing = {
      ...first,
      totals: {
        ...first.totals,
        customizationService: '5.00',
        payable: '31.00',
      },
    }
    await library.saveSnapshot(existing)
    const oldBackup = await library.exportBackup()
    const discounted = {
      ...existing,
      observedAt: '2026-01-02T12:00:00.000Z',
      totals: {
        ...existing.totals,
        redPacketDiscount: '2.00',
        payable: '29.00',
      },
    }
    const added = await library.saveSnapshot(discounted)
    const repeated = await library.saveSnapshot({
      ...discounted,
      observedAt: '2026-01-03T12:00:00.000Z',
    })
    const changed = await library.saveSnapshot({
      ...discounted,
      observedAt: '2026-01-04T12:00:00.000Z',
      totals: {
        ...existing.totals,
        redPacketDiscount: '3.00',
        payable: '28.00',
      },
    })
    const zero = await library.saveSnapshot({
      ...existing,
      observedAt: '2026-01-05T12:00:00.000Z',
      totals: { ...existing.totals, redPacketDiscount: '0.00' },
    })
    const backup = await library.exportBackup()
    const restored = await openOrderDatabase({
      name: `${databaseName}-red-packets`,
    })
    await restored.restoreBackup(oldBackup)
    const oldRecord = await restored.getOrder(first.orderId)
    await restored.restoreBackup(backup)
    const record = await restored.getOrder(first.orderId)
    const history = await restored.getHistory(first.orderId)
    restored.close()
    return { added, repeated, changed, zero, oldRecord, record, history }
  }, snapshot())
  expect(result.oldRecord.snapshot.totals).toEqual({
    ...snapshot().totals,
    customizationService: '5.00',
    payable: '31.00',
  })
  expect(result.added.changed).toBe(true)
  expect(result.added.order.revision).toBe(2)
  expect(result.added.order.snapshot.totals.redPacketDiscount).toBe('2.00')
  expect(result.repeated.changed).toBe(false)
  expect(result.repeated.order.revision).toBe(2)
  expect(result.changed.changed).toBe(true)
  expect(result.changed.order.revision).toBe(3)
  expect(result.changed.order.changedEntryIds).toEqual([])
  expect(result.zero.order.revision).toBe(4)
  expect(result.record.snapshot.totals).toEqual({
    ...snapshot().totals,
    customizationService: '5.00',
    payable: '31.00',
    redPacketDiscount: '0.00',
  })
  for (const record of [
    result.added.order,
    result.changed.order,
    result.record,
    ...result.history,
  ])
    expect(record.snapshot.items).toEqual(snapshot().items)
  expect(
    result.history
      .map(({ snapshot: item }) => item.totals.redPacketDiscount)
      .sort()
  ).toEqual(['2.00', '3.00', undefined])
})

test('invalid red-packet values and negative payable reject snapshots and backups atomically', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    const backup = await library.exportBackup()
    const next = structuredClone(backup.orders[0])
    next.snapshot.orderId = '9999999999999999999'
    next.snapshot.sourceUrl = first.sourceUrl.replace(
      first.orderId,
      next.snapshot.orderId
    )
    const cases = [
      { redPacketDiscount: '-1.00', payable: '27.00' },
      { redPacketDiscount: '1.00', payable: '26.00' },
      { redPacketDiscount: '0.001', payable: '26.00' },
      { redPacketDiscount: '27.00', payable: '-1.00' },
      {
        redPacketDiscount: '32.00',
        customizationService: '5.00',
        payable: '-1.00',
      },
      ...[null, undefined, 1, '', '减¥1.00', '+1.00', '1 2.00', 'unknown'].map(
        (redPacketDiscount) => ({ redPacketDiscount, payable: '25.00' })
      ),
    ]
    const rejected = []
    for (const values of cases) {
      const invalid = {
        ...first,
        observedAt: '2026-01-02T12:00:00.000Z',
        totals: { ...first.totals, ...values },
      }
      for (const operation of [
        () => library.saveSnapshot(invalid),
        () =>
          library.restoreBackup({
            ...backup,
            orders: [
              next,
              {
                ...backup.orders[0],
                snapshot: invalid,
                lastCheckedAt: invalid.observedAt,
              },
            ],
          }),
      ]) {
        try {
          await operation()
        } catch (error) {
          rejected.push(error.message)
        }
      }
    }
    return {
      rejected,
      expectedRejections: cases.length * 2,
      orders: await library.listOrders(),
    }
  }, snapshot())
  expect(result.rejected).toHaveLength(result.expectedRejections)
  expect(result.orders).toHaveLength(1)
  expect(result.orders[0].revision).toBe(1)
  expect(result.orders[0].snapshot.totals).toEqual(snapshot().totals)
})

test('order-only discounts and unspecified foreign fees preserve product rows and roundtrip current and historical observations', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    const oldBackup = await library.exportBackup()
    const discountedSnapshot = {
      ...first,
      observedAt: '2026-01-02T12:00:00.000Z',
      totals: {
        ...first.totals,
        orderDiscount: '3.00',
        goodsNet: '21.00',
        payable: '23.00',
      },
    }
    const discounted = await library.saveSnapshot(discountedSnapshot)
    const flaggedSnapshot = {
      ...discountedSnapshot,
      observedAt: '2026-01-03T12:00:00.000Z',
      foreignCurrencyFeeUnspecified: true,
    }
    const flagged = await library.saveSnapshot(flaggedSnapshot)
    const repeated = await library.saveSnapshot({
      ...flaggedSnapshot,
      observedAt: '2026-01-04T12:00:00.000Z',
    })
    const zero = await library.saveSnapshot({
      ...flaggedSnapshot,
      observedAt: '2026-01-05T12:00:00.000Z',
      totals: { ...first.totals, orderDiscount: '0.00' },
    })
    const combined = await library.saveSnapshot({
      ...flaggedSnapshot,
      observedAt: '2026-01-06T12:00:00.000Z',
      totals: {
        ...discountedSnapshot.totals,
        customizationService: '5.00',
        redPacketDiscount: '1.00',
        payable: '27.00',
      },
    })
    const backup = await library.exportBackup()
    const restored = await openOrderDatabase({
      name: `${databaseName}-order-discount`,
    })
    await restored.restoreBackup(oldBackup)
    const oldRecord = await restored.getOrder(first.orderId)
    await restored.restoreBackup(backup)
    const record = await restored.getOrder(first.orderId)
    const history = await restored.getHistory(first.orderId)
    restored.close()
    return {
      discounted,
      flagged,
      repeated,
      zero,
      combined,
      backup,
      oldRecord,
      record,
      history,
    }
  }, snapshot())
  expect(result.oldRecord.snapshot).toEqual(snapshot())
  expect(result.oldRecord.snapshot).not.toHaveProperty(
    'foreignCurrencyFeeUnspecified'
  )
  expect(result.oldRecord.snapshot.totals).not.toHaveProperty('orderDiscount')
  expect(result.discounted.changed).toBe(true)
  expect(result.discounted.order.revision).toBe(2)
  expect(result.discounted.order.snapshot.totals).toEqual({
    ...snapshot().totals,
    orderDiscount: '3.00',
    goodsNet: '21.00',
    payable: '23.00',
  })
  expect(result.flagged.changed).toBe(true)
  expect(result.flagged.order.revision).toBe(3)
  expect(result.flagged.order.changedEntryIds).toEqual([])
  expect(result.flagged.order.snapshot.totals).toEqual(
    result.discounted.order.snapshot.totals
  )
  expect(result.flagged.order.snapshot.foreignCurrencyFeeUnspecified).toBe(true)
  expect(result.repeated.changed).toBe(false)
  expect(result.repeated.order.revision).toBe(3)
  expect(result.zero.order.snapshot.totals).toEqual({
    ...snapshot().totals,
    orderDiscount: '0.00',
  })
  expect(result.combined.order.snapshot.totals).toEqual({
    ...snapshot().totals,
    orderDiscount: '3.00',
    goodsNet: '21.00',
    customizationService: '5.00',
    redPacketDiscount: '1.00',
    payable: '27.00',
  })
  expect(result.record.snapshot).toEqual(result.combined.order.snapshot)
  expect(result.backup.orders[0].snapshot).toEqual(
    result.combined.order.snapshot
  )
  const history = result.history.sort((a, b) => a.revision - b.revision)
  expect(history).toHaveLength(4)
  expect(
    history.map(({ snapshot: item }) => item.totals.orderDiscount)
  ).toEqual([undefined, '3.00', '3.00', '0.00'])
  expect(
    history.map(({ snapshot: item }) =>
      Object.hasOwn(item, 'foreignCurrencyFeeUnspecified')
    )
  ).toEqual([false, false, true, true])
  expect(history.map(({ snapshot: item }) => item)).toEqual(
    result.backup.history
      .sort((a, b) => a.revision - b.revision)
      .map(({ snapshot: item }) => item)
  )
  for (const record of [
    result.discounted.order,
    result.flagged.order,
    result.record,
    ...history,
  ])
    expect(record.snapshot.items).toEqual(snapshot().items)
})

test('included discounts survive refresh and backup while preserving source rows and original totals', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    const oldBackup = await library.exportBackup()
    const next = {
      ...first,
      observedAt: '2026-01-02T12:00:00.000Z',
      totals: {
        ...first.totals,
        goodsGross: '30.00',
        priceIncludedDiscount: '5.00',
        orderAdjustment: '0.50',
        rowIncludedAdjustment: '0.50',
      },
    }
    const saved = await library.saveSnapshot(next)
    const unchanged = await library.saveSnapshot({
      ...next,
      observedAt: '2026-01-03T12:00:00.000Z',
    })
    const backup = await library.exportBackup()
    const restored = await openOrderDatabase({
      name: `${databaseName}-included`,
    })
    await restored.restoreBackup(oldBackup)
    const old = await restored.getOrder(first.orderId)
    await restored.restoreBackup(backup)
    const current = await restored.getOrder(first.orderId)
    const history = await restored.getHistory(first.orderId)
    restored.close()
    return { saved, unchanged, old, current, history }
  }, snapshot())
  expect(result.saved.changed).toBe(true)
  expect(result.saved.order.changedEntryIds).toEqual([])
  expect(result.unchanged.changed).toBe(false)
  expect(result.old.snapshot.totals).toEqual(snapshot().totals)
  expect(result.current.snapshot.totals).toEqual({
    ...snapshot().totals,
    goodsGross: '30.00',
    priceIncludedDiscount: '5.00',
    orderAdjustment: '0.50',
    rowIncludedAdjustment: '0.50',
  })
  expect(result.current.snapshot.items).toEqual(snapshot().items)
  expect(result.history).toHaveLength(1)
})

test('invalid order-only discounts or foreign-fee flags reject snapshots and entire backups atomically', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    const backup = await library.exportBackup()
    const next = structuredClone(backup.orders[0])
    next.snapshot.orderId = '9999999999999999999'
    next.snapshot.sourceUrl = first.sourceUrl.replace(
      first.orderId,
      next.snapshot.orderId
    )
    const invalidTotals = [
      { priceIncludedDiscount: '-1.00', goodsGross: '24.00' },
      { priceIncludedDiscount: '1.00' },
      { priceIncludedDiscount: '0.001' },
      { rowIncludedAdjustment: '-1.00', orderAdjustment: '-1.00' },
      { rowIncludedAdjustment: '0.50' },
      { rowIncludedAdjustment: '5.00', orderAdjustment: '5.00' },
      { rowIncludedAdjustment: '0.001' },
      { orderDiscount: '-1.00', goodsNet: '25.00', payable: '27.00' },
      { orderDiscount: '0.001' },
      { orderDiscount: '25.00', goodsNet: '-1.00', payable: '1.00' },
      { orderDiscount: '3.00' },
      { orderDiscount: '3.00', goodsNet: '21.00', payable: '26.00' },
      ...[null, undefined, 1, '', '减¥1.00', '+1.00', '1 2.00', 'unknown'].map(
        (orderDiscount) => ({
          orderDiscount,
          goodsNet: '23.00',
          payable: '25.00',
        })
      ),
    ]
    const cases = [
      ...invalidTotals.map((totals) => ({
        totals: { ...first.totals, ...totals },
      })),
      ...[false, null, undefined, 0, 1, 'true', 'false', {}, []].map(
        (foreignCurrencyFeeUnspecified) => ({ foreignCurrencyFeeUnspecified })
      ),
    ]
    const rejected = []
    for (const values of cases) {
      const invalid = {
        ...first,
        observedAt: '2026-01-02T12:00:00.000Z',
        ...values,
      }
      for (const operation of [
        () => library.saveSnapshot(invalid),
        () =>
          library.restoreBackup({
            ...backup,
            orders: [
              next,
              {
                ...backup.orders[0],
                snapshot: invalid,
                lastCheckedAt: invalid.observedAt,
              },
            ],
          }),
        () =>
          library.restoreBackup({
            ...backup,
            orders: [
              next,
              {
                ...backup.orders[0],
                snapshot: { ...first, observedAt: '2026-01-03T12:00:00.000Z' },
                lastCheckedAt: '2026-01-03T12:00:00.000Z',
              },
            ],
            history: [
              {
                ...backup.orders[0],
                snapshot: invalid,
                lastCheckedAt: invalid.observedAt,
              },
            ],
          }),
      ]) {
        try {
          await operation()
        } catch (error) {
          rejected.push(error.message)
        }
      }
    }
    return {
      rejected,
      expectedRejections: cases.length * 3,
      orders: await library.listOrders(),
      history: await library.getHistory(first.orderId),
    }
  }, snapshot())
  expect(result.rejected).toHaveLength(result.expectedRejections)
  expect(result.orders).toHaveLength(1)
  expect(result.orders[0].revision).toBe(1)
  expect(result.orders[0].snapshot).toEqual(snapshot())
  expect(result.history).toEqual([])
})

test('purchase dates enrich old records, survive refresh and roundtrip without inventing dates', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    const oldBackup = await library.exportBackup()
    const enriched = await library.saveSnapshot({
      ...first,
      purchasedAt: '2025-12-01T00:10:11+08:00',
      observedAt: '2026-01-02T12:00:00.000Z',
    })
    const refreshed = await library.saveSnapshot({
      ...first,
      observedAt: '2026-01-03T12:00:00.000Z',
    })
    const alternateSource = await library.saveSnapshot({
      ...first,
      purchasedAt: '2025-11-30T23:59:59+08:00',
      observedAt: '2026-01-04T12:00:00.000Z',
    })
    const backup = await library.exportBackup()
    const restored = await openOrderDatabase({ name: `${databaseName}-dates` })
    await restored.restoreBackup(oldBackup)
    const oldRecord = await restored.getOrder(first.orderId)
    await restored.restoreBackup(backup)
    const record = await restored.getOrder(first.orderId)
    const history = await restored.getHistory(first.orderId)
    restored.close()
    return { enriched, refreshed, alternateSource, oldRecord, record, history }
  }, snapshot())
  expect(result.enriched.order.changedEntryIds).toEqual([])
  expect(result.refreshed.changed).toBe(false)
  expect(result.refreshed.order.revision).toBe(2)
  expect(result.alternateSource.changed).toBe(false)
  expect(result.alternateSource.order.revision).toBe(2)
  expect(result.alternateSource.order.snapshot.purchasedAt).toBe(
    '2025-12-01T00:10:11+08:00'
  )
  expect(result.refreshed.order.snapshot.purchasedAt).toBe(
    '2025-12-01T00:10:11+08:00'
  )
  expect(result.oldRecord.snapshot).not.toHaveProperty('purchasedAt')
  expect(result.record.snapshot.purchasedAt).toBe('2025-12-01T00:10:11+08:00')
  expect(result.history[0].snapshot).not.toHaveProperty('purchasedAt')
})

test('invalid optional purchase dates reject backup atomically', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    const original = await library.exportBackup()
    const next = structuredClone(original.orders[0])
    next.snapshot.orderId = '9999999999999999999'
    next.snapshot.sourceUrl = first.sourceUrl.replace(
      first.orderId,
      next.snapshot.orderId
    )
    const rejected = []
    for (const purchasedAt of [
      '2026-02-30T00:00:00+08:00',
      '2026-01-01',
      'invalid',
      42,
    ]) {
      try {
        await library.restoreBackup({
          ...original,
          orders: [
            next,
            {
              ...original.orders[0],
              snapshot: { ...first, purchasedAt },
            },
          ],
        })
      } catch (error) {
        rejected.push(error.message)
      }
    }
    return { rejected, orders: await library.listOrders() }
  }, snapshot())
  expect(result.rejected).toHaveLength(4)
  expect(result.rejected.every((error) => error.includes('purchasedAt'))).toBe(
    true
  )
  expect(result.orders).toHaveLength(1)
  expect(result.orders[0].snapshot).toEqual(snapshot())
})

test('order identity stays exact and repeat reads or row reordering create no revision', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const initial = await library.saveSnapshot(first)
    await library.setNotes(first.orderId, {
      notes: 'Local packing note',
      tags: ['Review'],
    })
    const repeated = await library.saveSnapshot({
      ...first,
      observedAt: '2026-01-02T12:00:00.000Z',
      sourceUrl: `${first.sourceUrl}&tracking=changed`,
      items: [...first.items].reverse(),
    })
    return {
      initial,
      repeated,
      orders: await library.listOrders(),
      history: await library.getHistory(first.orderId),
    }
  }, snapshot())
  expect(result.initial.changed).toBe(true)
  expect(result.repeated.changed).toBe(false)
  expect(result.orders).toHaveLength(1)
  expect(result.repeated.order.snapshot.orderId).toBe(orderId)
  expect(result.repeated.order.revision).toBe(1)
  expect(result.repeated.order.lastCheckedAt).toBe('2026-01-02T12:00:00.000Z')
  expect(result.repeated.order.changedAt).toBe('2026-01-01T12:00:00.000Z')
  expect(result.repeated.order.notes).toBe('Local packing note')
  expect(result.repeated.order.tags).toEqual(['Review'])
  expect(result.history).toEqual([])
})

test('changed rows and deletions preserve the previous version and ignore stale or tied reads', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    await library.setNotes(first.orderId, { notes: 'Keep this', tags: [] })
    const second = {
      ...first,
      observedAt: '2026-01-03T12:00:00.000Z',
      items: [{ ...first.items[0], description: 'Updated synthetic box' }],
      totals: {
        ...first.totals,
        goodsGross: '20.00',
        goodsNet: '19.00',
        payable: '21.00',
      },
    }
    const changed = await library.saveSnapshot(second)
    const stale = await library.saveSnapshot({
      ...first,
      observedAt: '2026-01-02T12:00:00.000Z',
    })
    const tied = await library.saveSnapshot({
      ...first,
      observedAt: second.observedAt,
    })
    return {
      changed,
      stale,
      tied,
      history: await library.getHistory(first.orderId),
    }
  }, snapshot())
  expect(result.changed.changed).toBe(true)
  expect(result.changed.order.revision).toBe(2)
  expect(result.changed.order.changedEntryIds).toEqual(['2234567890123456789'])
  expect(result.changed.order.removedEntryIds).toEqual(['2234567890123456790'])
  expect(result.changed.order.notes).toBe('Keep this')
  expect(result.history).toHaveLength(1)
  expect(result.history[0].snapshot.items).toHaveLength(2)
  expect(result.history[0].revision).toBe(1)
  expect(result.stale).toEqual({ changed: false, order: result.changed.order })
  expect(result.tied).toEqual({ changed: false, order: result.changed.order })
})

test('malformed or partial snapshots cannot overwrite a complete order', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    const invalid = [
      { ...first, schemaVersion: 2 },
      { ...first, orderId: Number(first.orderId) },
      { ...first, items: [] },
      { ...first, items: [first.items[0], first.items[0]] },
      { ...first, items: [{ ...first.items[0], price: 10 }] },
      { ...first, observedAt: 'not a date' },
    ]
    const errors = []
    for (const candidate of invalid) {
      try {
        await library.saveSnapshot(candidate)
      } catch (error) {
        errors.push(error.message)
      }
    }
    return { errors, orders: await library.listOrders() }
  }, snapshot())
  expect(result.errors).toHaveLength(6)
  expect(result.orders).toHaveLength(1)
  expect(result.orders[0].snapshot).toEqual(snapshot())
  expect(result.orders[0].revision).toBe(1)
})

test('backup and snapshot validation reject unsafe links, invalid IDs and inconsistent money', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    const original = await library.exportBackup()
    const changeItem = (fields) => ({
      ...first,
      items: [{ ...first.items[0], ...fields }, first.items[1]],
    })
    const invalid = [
      ['symbolic order ID', { ...first, orderId: 'order-one' }],
      ['symbolic entry ID', changeItem({ entryId: 'item-one' })],
      ['script link', { ...first, sourceUrl: 'javascript:alert(1)' }],
      [
        'unrelated host',
        {
          ...first,
          sourceUrl: `https://example.invalid/?orderId=${first.orderId}`,
        },
      ],
      [
        'wrong order',
        {
          ...first,
          sourceUrl: first.sourceUrl.replace(
            first.orderId,
            '9999999999999999999'
          ),
        },
      ],
      [
        'duplicate query ID',
        { ...first, sourceUrl: `${first.sourceUrl}&orderId=${first.orderId}` },
      ],
      [
        'credentials in URL',
        {
          ...first,
          sourceUrl: first.sourceUrl.replace('https://', 'https://name@'),
        },
      ],
      ['empty seller', { ...first, sellerName: ' ' }],
      ['empty status', { ...first, status: '' }],
      ['empty description', changeItem({ description: '\n' })],
      ['zero quantity', changeItem({ quantity: '0' })],
      ['fractional quantity', changeItem({ quantity: '1.5' })],
      ['negative price', changeItem({ price: '-10.00' })],
      ['negative source discount', changeItem({ sourceDiscount: '-1.00' })],
      ['fractional cent discount', changeItem({ sourceDiscount: '1.001' })],
      ['mismatched row discount', changeItem({ discount: '2.00' })],
      [
        'discount exceeds row',
        changeItem({ sourceDiscount: '21.00', discount: '21.00' }),
      ],
      [
        'unreconciled allocation',
        changeItem({ allocatedDiscount: '1.00', discount: '2.00' }),
      ],
      [
        'wrong gross',
        { ...first, totals: { ...first.totals, goodsGross: '26.00' } },
      ],
      [
        'wrong source discount',
        { ...first, totals: { ...first.totals, sourceDiscount: '2.00' } },
      ],
      [
        'wrong goods net',
        { ...first, totals: { ...first.totals, goodsNet: '23.00' } },
      ],
      [
        'wrong payable',
        { ...first, totals: { ...first.totals, payable: '27.00' } },
      ],
      [
        'negative shipping',
        {
          ...first,
          totals: { ...first.totals, shipping: '-2.00', payable: '22.00' },
        },
      ],
    ]
    const nextRecord = structuredClone(original.orders[0])
    nextRecord.snapshot.orderId = '9999999999999999999'
    nextRecord.snapshot.sourceUrl = first.sourceUrl.replace(
      first.orderId,
      nextRecord.snapshot.orderId
    )
    const unexpectedlyAccepted = []
    for (const [label, candidate] of invalid) {
      try {
        await library.saveSnapshot(candidate)
        unexpectedlyAccepted.push(`snapshot: ${label}`)
      } catch {}
      try {
        await library.restoreBackup({
          ...original,
          orders: [nextRecord, { ...original.orders[0], snapshot: candidate }],
        })
        unexpectedlyAccepted.push(`backup: ${label}`)
      } catch {}
    }
    return { unexpectedlyAccepted, orders: await library.listOrders() }
  }, snapshot())
  expect(result.unexpectedlyAccepted).toEqual([])
  expect(result.orders).toHaveLength(1)
  expect(result.orders[0].snapshot).toEqual(snapshot())
})

test('exact fractional unit prices and signed allocated adjustments survive backup validation', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const fractional = {
      ...first,
      items: [
        {
          ...first.items[0],
          price: '0.125',
          quantity: '4',
          sourceDiscount: '0.00',
          allocatedDiscount: '0.07',
          discount: '0.07',
        },
        {
          ...first.items[1],
          price: '0.20',
          quantity: '1',
          sourceDiscount: '0.00',
          allocatedDiscount: '0.03',
          discount: '0.03',
        },
      ],
      totals: {
        goodsGross: '0.70',
        sourceDiscount: '0.00',
        orderAdjustment: '0.10',
        goodsNet: '0.60',
        shipping: '0.10',
        payable: '0.70',
      },
    }
    await library.saveSnapshot(fractional)
    const surcharge = {
      ...fractional,
      observedAt: '2026-01-02T12:00:00.000Z',
      items: fractional.items.map((item) => ({
        ...item,
        allocatedDiscount: `-${item.allocatedDiscount}`,
        discount: `-${item.discount}`,
      })),
      totals: {
        ...fractional.totals,
        orderAdjustment: '-0.10',
        goodsNet: '0.80',
        payable: '0.90',
      },
    }
    await library.saveSnapshot(surcharge)
    const backup = await library.exportBackup()
    const restored = await openOrderDatabase({
      name: `${databaseName}-exact-money`,
    })
    await restored.restoreBackup(backup)
    const result = {
      order: await restored.getOrder(first.orderId),
      history: await restored.getHistory(first.orderId),
    }
    restored.close()
    return result
  }, snapshot())
  expect(result.order.snapshot.items[0].price).toBe('0.125')
  expect(result.order.snapshot.items[0].discount).toBe('-0.07')
  expect(result.order.snapshot.totals.payable).toBe('0.90')
  expect(result.history[0].snapshot.totals.payable).toBe('0.70')
})

test('backup roundtrip preserves versions, notes and deduplicated images without import jobs', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(
    async ({ first, image }) => {
      await library.saveSnapshot(first)
      await library.saveSnapshot({
        ...first,
        observedAt: '2026-01-02T12:00:00.000Z',
        status: 'Refunded',
      })
      await library.setNotes(first.orderId, {
        notes: 'Packing note',
        tags: ['Sample'],
      })
      await library.putImage(image)
      await library.putImage(image)
      await library.putJob({
        id: 'test-job',
        status: 'running',
        remaining: ['2'],
      })
      const backup = JSON.parse(JSON.stringify(await library.exportBackup()))
      const restored = await openOrderDatabase({
        name: `${databaseName}-restored`,
      })
      const firstRestore = await restored.restoreBackup(backup)
      const secondRestore = await restored.restoreBackup(backup)
      const output = {
        backup,
        firstRestore,
        secondRestore,
        record: await restored.getOrder(first.orderId),
        history: await restored.getHistory(first.orderId),
        image: await restored.getImage(image.url),
        jobs: await restored.listJobs(),
      }
      restored.close()
      return output
    },
    { first: snapshot(), image }
  )
  expect(result.backup.images).toHaveLength(1)
  expect(result.backup).not.toHaveProperty('jobs')
  expect(result.firstRestore).toEqual({ imported: 1, updated: 0 })
  expect(result.secondRestore).toEqual({ imported: 0, updated: 0 })
  expect(result.record.revision).toBe(2)
  expect(result.record.notes).toBe('Packing note')
  expect(result.history).toHaveLength(1)
  expect(result.image).toEqual(image)
  expect(result.jobs).toEqual([])
})

test('restore merges newer data and historical snapshots while keeping local notes', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    const older = await library.exportBackup()
    const source = await openOrderDatabase({ name: `${databaseName}-source` })
    await source.restoreBackup(older)
    await source.saveSnapshot({
      ...first,
      observedAt: '2026-01-03T12:00:00.000Z',
      status: 'Refunded',
    })
    await source.setNotes(first.orderId, {
      notes: 'Backup note',
      tags: ['Backup'],
    })
    const newer = await source.exportBackup()
    source.close()
    await library.setNotes(first.orderId, {
      notes: 'Local note',
      tags: ['Local'],
    })
    const restore = await library.restoreBackup(newer)
    await library.restoreBackup(older)
    const current = await library.getOrder(first.orderId)
    const history = await library.getHistory(first.orderId)
    await library.removeOrders([first.orderId])
    return {
      restore,
      current,
      history,
      remaining: await library.listOrders(),
      remainingHistory: await library.getHistory(first.orderId),
    }
  }, snapshot())
  expect(result.restore).toEqual({ imported: 0, updated: 1 })
  expect(result.current.snapshot.status).toBe('Refunded')
  expect(result.current.notes).toBe('Local note')
  expect(result.current.tags).toEqual(['Local'])
  expect(result.history).toHaveLength(1)
  expect(result.remaining).toEqual([])
  expect(result.remainingHistory).toEqual([])
})

test('invalid backup rows and image data reject the whole restore before writing', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(
    async ({ first, image }) => {
      await library.saveSnapshot(first)
      const original = await library.exportBackup()
      const nextRecord = structuredClone(original.orders[0])
      nextRecord.snapshot.orderId = '9999999999999999999'
      nextRecord.snapshot.sourceUrl = first.sourceUrl.replace(
        first.orderId,
        nextRecord.snapshot.orderId
      )
      const candidate = {
        ...original,
        orders: [nextRecord, original.orders[0]],
      }
      const invalid = [
        { ...candidate, version: 4 },
        {
          ...candidate,
          orders: [nextRecord, { ...original.orders[0], revision: 0 }],
        },
        { ...candidate, orders: [nextRecord, nextRecord] },
        {
          ...candidate,
          images: [{ ...image, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }],
        },
        {
          ...candidate,
          images: [{ ...image, url: 'https://example.invalid/image.png' }],
        },
        {
          ...candidate,
          images: [
            {
              ...image,
              dataUrl: `data:image/png;base64,${'A'.repeat(2 * 1024 * 1024)}`,
            },
          ],
        },
      ]
      const errors = []
      for (const backup of invalid) {
        try {
          await library.restoreBackup(backup)
        } catch (error) {
          errors.push(error.message)
        }
      }
      return {
        errors,
        orders: await library.listOrders(),
        images: (await library.exportBackup()).images,
      }
    },
    { first: snapshot(), image }
  )
  expect(result.errors).toHaveLength(6)
  expect(result.orders).toHaveLength(1)
  expect(result.orders[0].snapshot.orderId).toBe(orderId)
  expect(result.images).toEqual([])
})

test('queued jobs survive reopened connections and accounts cannot overwrite each other', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await Promise.all([
      library.saveSnapshot(first),
      library.saveSnapshot({
        ...first,
        accountId: 'future-account',
        sellerName: 'Other seller',
      }),
    ])
    const job = {
      id: 'persistent-job',
      status: 'paused',
      remaining: [first.orderId],
    }
    await library.putJob(job)
    library.close()
    window.library = await openOrderDatabase({ name: databaseName })
    const readJob = await library.getJob(job.id)
    const jobs = await library.listJobs()
    await library.deleteJob(job.id)
    await library.removeOrders([first.orderId])
    return {
      readJob,
      jobs,
      afterDelete: await library.listJobs(),
      local: await library.listOrders(),
      other: await library.getOrder(first.orderId, {
        accountId: 'future-account',
      }),
    }
  }, snapshot())
  expect(result.readJob.status).toBe('paused')
  expect(result.jobs).toHaveLength(1)
  expect(result.afterDelete).toEqual([])
  expect(result.local).toEqual([])
  expect(result.other.snapshot.sellerName).toBe('Other seller')
})

test('v1 databases upgrade in place with orders, history, images and jobs preserved', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(
    async ({ first, image }) => {
      await library.saveSnapshot(first)
      const record = await library.getOrder(first.orderId)
      const name = `${databaseName}-legacy`
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1)
        request.onupgradeneeded = () => {
          const db = request.result
          const orders = db.createObjectStore('orders', {
            keyPath: ['snapshot.accountId', 'snapshot.orderId'],
          })
          orders.createIndex('account', 'snapshot.accountId')
          const history = db.createObjectStore('history', {
            keyPath: [
              'snapshot.accountId',
              'snapshot.orderId',
              'snapshot.observedAt',
            ],
          })
          history.createIndex('order', [
            'snapshot.accountId',
            'snapshot.orderId',
          ])
          db.createObjectStore('jobs', { keyPath: 'id' })
          db.createObjectStore('images', { keyPath: 'url' })
        }
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction(['orders', 'jobs', 'images'], 'readwrite')
          tx.objectStore('orders').put(record)
          tx.objectStore('jobs').put({ id: 'keep-job', status: 'paused' })
          tx.objectStore('images').put(image)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onabort = () => reject(tx.error)
        }
      })
      const upgraded = await openOrderDatabase({ name })
      const output = {
        order: await upgraded.getOrder(first.orderId),
        job: await upgraded.getJob('keep-job'),
        image: await upgraded.getImage(image.url),
        preparations: await upgraded.listPreparations(),
        backup: await upgraded.exportBackup(),
      }
      upgraded.close()
      return output
    },
    { first: snapshot(), image }
  )
  expect(result.order.snapshot).toEqual(snapshot())
  expect(result.job.status).toBe('paused')
  expect(result.image).toEqual(image)
  expect(result.preparations).toEqual([])
  expect(result.backup.version).toBe(3)
  expect(result.backup.issuedCodes).toEqual([])
})

test('structured source fields survive snapshot and backup validation', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    first.sellerMemberLogin = 'seller-member'
    first.sellerShopOrigin =
      'https://seller-example.1688.com/shop?tracking=removed'
    first.items[0].title = 'Synthetic cup'
    first.items[0].productNumber = 'ART-01'
    first.items[0].skuProperties = [
      { label: '颜色', value: 'red', raw: '颜色: red' },
      { label: '', value: 'unlabeled detail', raw: 'unlabeled detail' },
    ]
    await library.saveSnapshot(first)
    const backup = await library.exportBackup()
    const restored = await openOrderDatabase({
      name: `${databaseName}-structured`,
    })
    await restored.restoreBackup(backup)
    const output = await restored.getOrder(first.orderId)
    restored.close()
    let rejected = false
    try {
      await library.saveSnapshot({
        ...first,
        items: [
          { ...first.items[0], skuProperties: [{ label: '颜色', value: 12 }] },
          first.items[1],
        ],
      })
    } catch {
      rejected = true
    }
    return { output, rejected }
  }, snapshot())
  expect(result.output.snapshot.sellerMemberLogin).toBe('seller-member')
  expect(result.output.snapshot.sellerShopOrigin).toBe(
    'https://seller-example.1688.com'
  )
  expect(result.output.snapshot.items[0]).toMatchObject({
    title: 'Synthetic cup',
    productNumber: 'ART-01',
    skuProperties: [
      { label: '颜色', value: 'red', raw: '颜色: red' },
      { label: '', value: 'unlabeled detail', raw: 'unlabeled detail' },
    ],
  })
  expect(result.rejected).toBe(true)
})

test('unavailable source sellers require an authored identity before codes and preserve it through refresh and backup', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const { createPreparation, validatePreparation } =
      await import('/src/packing-model.js')
    const missing = {
      ...first,
      sellerName: 'Seller unavailable',
      sellerUnavailable: true,
    }
    await library.saveSnapshot(missing)
    const draft = createPreparation(missing, '2026-10')
    const initialSeller = draft.sellerId
    const preparationErrors = []
    for (const sellerId of [
      '',
      '  ',
      'Seller unavailable',
      ' Unknown Seller ',
    ]) {
      for (const operation of [
        () => validatePreparation({ ...draft, sellerId }),
        () => library.savePreparation({ ...draft, sellerId }),
      ]) {
        try {
          await operation()
        } catch (error) {
          preparationErrors.push(error.message)
        }
      }
    }
    const afterRejected = await library.exportBackup()
    draft.sellerId = 'verified-seller'
    draft.groups[0].spanishName = 'CAJA'
    const authored = await library.savePreparation(draft)
    await library.saveSnapshot({
      ...missing,
      observedAt: '2026-01-02T12:00:00.000Z',
      status: 'Updated while unavailable',
    })
    const afterRefresh = await library.getPreparation(first.orderId)
    const backup = await library.exportBackup()
    const restored = await openOrderDatabase({
      name: `${databaseName}-missing-seller`,
    })
    await restored.restoreBackup(backup)
    const roundtrip = {
      order: await restored.getOrder(first.orderId),
      preparation: await restored.getPreparation(first.orderId),
      backup: await restored.exportBackup(),
    }
    const newOrder = structuredClone(backup.orders[0])
    newOrder.snapshot.orderId = '9999999999999999999'
    newOrder.snapshot.sourceUrl = first.sourceUrl.replace(
      first.orderId,
      newOrder.snapshot.orderId
    )
    const malformed = [
      ...[false, undefined, null, 'true'].map((sellerUnavailable) => ({
        ...backup.orders[0].snapshot,
        sellerUnavailable,
      })),
      { ...backup.orders[0].snapshot, sellerName: 'Named seller' },
      { ...backup.orders[0].snapshot, sellerMemberLogin: 'real-login' },
    ]
    const flagAbsent = structuredClone(backup.orders[0].snapshot)
    delete flagAbsent.sellerUnavailable
    malformed.push(flagAbsent)
    const restoreErrors = []
    for (const snapshot of malformed) {
      try {
        await restored.restoreBackup({
          ...backup,
          orders: [newOrder, { ...backup.orders[0], snapshot }],
        })
      } catch (error) {
        restoreErrors.push(error.message)
      }
    }
    const afterMalformed = await restored.exportBackup()
    const identified = {
      ...missing,
      sellerName: 'Seller supplied by source',
      sellerMemberLogin: 'source-login',
      observedAt: '2026-01-03T12:00:00.000Z',
    }
    delete identified.sellerUnavailable
    await restored.saveSnapshot(identified)
    const afterIdentified = {
      order: await restored.getOrder(first.orderId),
      preparation: await restored.getPreparation(first.orderId),
      backup: await restored.exportBackup(),
    }
    restored.close()
    return {
      initialSeller,
      preparationErrors,
      afterRejected,
      authored,
      afterRefresh,
      backup,
      roundtrip,
      restoreErrors,
      afterMalformed,
      afterIdentified,
    }
  }, snapshot())
  expect(result.initialSeller).toBe('')
  expect(result.preparationErrors).toHaveLength(8)
  expect(
    result.preparationErrors.every((error) =>
      error.includes('Identify the seller')
    )
  ).toBe(true)
  for (const field of ['preparations', 'allocations', 'issuedCodes'])
    expect(result.afterRejected[field]).toEqual([])
  expect(result.afterRejected.orders[0].snapshot.sellerUnavailable).toBe(true)
  expect(result.authored.sellerId).toBe('verified-seller')
  expect(result.authored.groups.map((group) => group.baseCode)).toEqual([
    'CE26100101',
    'CE26100102',
  ])
  expect(result.afterRefresh).toEqual(result.authored)
  expect(result.roundtrip.order.snapshot.sellerUnavailable).toBe(true)
  expect(result.roundtrip.order.snapshot).not.toHaveProperty(
    'sellerMemberLogin'
  )
  expect(result.roundtrip.preparation).toEqual(result.authored)
  expect(result.restoreErrors).toHaveLength(7)
  for (const field of [
    'orders',
    'history',
    'preparations',
    'allocations',
    'issuedCodes',
  ]) {
    expect(result.roundtrip.backup[field]).toEqual(result.backup[field])
    expect(result.afterMalformed[field]).toEqual(result.backup[field])
  }
  expect(result.afterIdentified.order.snapshot).not.toHaveProperty(
    'sellerUnavailable'
  )
  expect(result.afterIdentified.order.snapshot.sellerMemberLogin).toBe(
    'source-login'
  )
  expect(result.afterIdentified.preparation).toEqual(result.authored)
  for (const field of ['allocations', 'issuedCodes'])
    expect(result.afterIdentified.backup[field]).toEqual(result.backup[field])
})

test('concurrent database connections allocate unique codes and reject stale preparation edits', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const { createPreparation } = await import('/src/packing-model.js')
    const second = {
      ...first,
      orderId: '9999999999999999999',
      sourceUrl: first.sourceUrl.replace(first.orderId, '9999999999999999999'),
    }
    await library.saveSnapshot(first)
    await library.saveSnapshot(second)
    const other = await openOrderDatabase({ name: databaseName })
    const saved = await Promise.all([
      library.savePreparation(createPreparation(first, '2026-06')),
      other.savePreparation(createPreparation(second, '2026-06')),
    ])
    const editA = structuredClone(saved[0])
    editA.groups[0].spanishName = 'TAZA'
    const editB = structuredClone(saved[0])
    editB.groups[0].spanishName = 'BOL'
    const edits = await Promise.allSettled([
      library.savePreparation(editA),
      other.savePreparation(editB),
    ])
    const output = {
      saved,
      statuses: edits.map((entry) => entry.status),
      errors: edits
        .filter((entry) => entry.status === 'rejected')
        .map((entry) => entry.reason.message),
      current: await library.getPreparation(first.orderId),
      backup: await library.exportBackup(),
    }
    other.close()
    return output
  }, snapshot())
  expect(
    result.saved.flatMap((entry) => entry.groups.map((group) => group.baseCode))
  ).toEqual(['CE26060101', 'CE26060102', 'CE26060103', 'CE26060104'])
  expect(result.statuses.sort()).toEqual(['fulfilled', 'rejected'])
  expect(result.errors[0]).toContain('another tab')
  expect(result.current.revision).toBe(2)
  expect(result.backup.issuedCodes).toHaveLength(8)
})

test('refresh preserves authoring and removed memberships while new entries remain unassigned', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const { createPreparation, activeGroups } =
      await import('/src/packing-model.js')
    await library.saveSnapshot(first)
    const draft = createPreparation(first, '2026-06')
    draft.groups[0].spanishName = 'TAZA'
    const saved = await library.savePreparation(draft)
    const refreshed = {
      ...first,
      observedAt: '2026-01-02T12:00:00.000Z',
      items: [
        first.items[0],
        { ...first.items[1], entryId: '3234567890123456790' },
      ],
    }
    await library.saveSnapshot(refreshed)
    const retained = await library.getPreparation(first.orderId)
    const edited = await library.savePreparation({
      ...retained,
      groups: retained.groups.map((group) => ({ ...group, category: '餐具' })),
    })
    const bad = structuredClone(edited)
    bad.groups[0].variants[0].entryIds.push('999')
    let error
    try {
      await library.savePreparation(bad)
    } catch (failure) {
      error = failure.message
    }
    const restored = await openOrderDatabase({
      name: `${databaseName}-removed-members`,
    })
    await restored.restoreBackup(await library.exportBackup())
    const restoredPreparation = await restored.getPreparation(first.orderId)
    restored.close()
    return {
      saved,
      retained,
      edited,
      active: activeGroups(retained, refreshed),
      error,
      restoredPreparation,
      source: await library.getOrder(first.orderId),
    }
  }, snapshot())
  expect(result.retained).toEqual(result.saved)
  expect(result.active).toHaveLength(1)
  expect(result.edited.groups[1].variants[0].entryIds).toEqual([
    '2234567890123456790',
  ])
  expect(result.error).toContain('entry missing')
  expect(result.source.snapshot.totals).toEqual(snapshot().totals)
  expect(result.source.snapshot.items).toHaveLength(2)
  expect(result.restoredPreparation).toEqual(result.edited)
})

test('manual base edits update variant codes and deletion releases current assignments', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const { createPreparation, barcodeValue } =
      await import('/src/packing-model.js')
    await library.saveSnapshot(first)
    const saved = await library.savePreparation(
      createPreparation(first, '2026-06')
    )
    saved.groups[0].baseCode = 'CE26060107'
    const edited = await library.savePreparation(saved)
    const code = barcodeValue(edited.groups[0], edited.groups[0].variants[0])
    await library.removeOrders([first.orderId])
    const afterDelete = await library.exportBackup()
    await library.saveSnapshot(first)
    const regenerated = await library.savePreparation(
      createPreparation(first, '2026-06')
    )
    const collided = structuredClone(regenerated)
    collided.groups[0].baseCode = regenerated.groups[1].baseCode
    let error
    try {
      await library.savePreparation(collided)
    } catch (failure) {
      error = failure.message
    }
    return {
      code,
      afterDelete,
      regenerated,
      error,
      current: await library.getPreparation(first.orderId),
    }
  }, snapshot())
  expect(result.code).toBe('CE26060107')
  expect(result.afterDelete.orders).toEqual([])
  expect(result.afterDelete.preparations).toEqual([])
  expect(result.afterDelete.issuedCodes).toHaveLength(0)
  expect(result.regenerated.groups.map((group) => group.baseCode)).toEqual([
    'CE26060101',
    'CE26060102',
  ])
  expect(result.error).toContain('Code conflict')
  expect(result.current).toEqual(result.regenerated)
})

test('barcode lookup includes only current suffixes and isolates the base and account', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const { createPreparation } = await import('/src/packing-model.js')
    await library.saveSnapshot(first)
    const draft = createPreparation(first, '2026-06')
    draft.groups[0].variants[0].variantSuffix = 'A'
    const saved = await library.savePreparation(draft)
    const baseCode = saved.groups[0].baseCode
    saved.groups[0].variants[0].variantSuffix = 'B'
    await library.savePreparation(saved)

    const otherAccount = { ...first, accountId: 'other' }
    await library.saveSnapshot(otherAccount)
    const otherDraft = createPreparation(otherAccount, '2026-06')
    otherDraft.groups[0].variants[0].variantSuffix = 'C'
    await library.savePreparation(otherDraft)

    const before = await library.exportBackup()
    const reserved = await library.getReservedBarcodes(baseCode)
    const otherReserved = await library.getReservedBarcodes(baseCode, {
      accountId: 'other',
    })
    const absent = await library.getReservedBarcodes('CE26069999')
    const after = await library.exportBackup()
    await library.removeOrders([first.orderId])
    return {
      reserved,
      otherReserved,
      absent,
      afterDelete: await library.getReservedBarcodes(baseCode),
      before: { ...before, exportedAt: '' },
      after: { ...after, exportedAt: '' },
    }
  }, snapshot())
  expect(result.reserved).toEqual(['CE26060101B'])
  expect(result.otherReserved).toEqual(['CE26060101C'])
  expect(result.absent).toEqual([])
  expect(result.afterDelete).toEqual([])
  expect(result.after).toEqual(result.before)
})

test('saved product codes roundtrip and released barcode endings can be reused', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const { createPreparation, restoreDefaultPacking } =
      await import('/src/packing-model.js')
    first.items[1].description = first.items[0].description
    first.items.forEach((item, index) => {
      const color = index ? 'blue' : 'red'
      item.skuProperties = [
        { label: '颜色', value: color, raw: `颜色：${color}` },
      ]
    })
    await library.saveSnapshot(first)
    const draft = createPreparation(first, '2026-10')
    draft.groups[0].variants[0].variantSuffix = ''
    const original = await library.savePreparation(draft)
    const base = original.groups[0].baseCode
    const changed = structuredClone(original)
    changed.groups[0].baseCode = 'CE26100107'
    await library.savePreparation(changed)
    const reloaded = await library.getPreparation(first.orderId)
    reloaded.groups[0].baseCode = base
    const returned = await library.savePreparation(reloaded)
    const sameVariant = structuredClone(returned)
    sameVariant.groups[0].variants[0].variantSuffix = 'A'
    const moved = await library.savePreparation(sameVariant)
    const ownership = await library.queryCodeOwnership(base)
    const otherVariant = structuredClone(moved)
    otherVariant.groups[0].variants[1].variantSuffix = ''
    const reassigned = await library.savePreparation(otherVariant)
    const duplicate = structuredClone(reassigned)
    duplicate.groups[0].variants[0].variantSuffix = ''
    let conflict
    try {
      await library.savePreparation(duplicate)
    } catch (error) {
      conflict = error.conflict
    }
    const unchanged = await library.getPreparation(first.orderId)
    const restored = await library.savePreparation(
      restoreDefaultPacking(unchanged)
    )
    const final = await library.exportBackup()
    return {
      original,
      returned,
      moved,
      reassigned,
      ownership,
      conflict,
      unchanged,
      restored,
      final,
    }
  }, snapshot())
  expect(result.returned.groups).toEqual(result.original.groups)
  expect(result.unchanged).toEqual(result.reassigned)
  expect(result.restored.groups).toEqual(result.original.groups)
  const base = result.original.groups[0].baseCode
  const baseOwner = result.ownership.owners.find(
    (entry) => entry.kind === 'base'
  )
  const barcodeOwner = result.ownership.owners.find(
    (entry) => entry.kind === 'barcode'
  )
  expect(baseOwner.status).toBe('active')
  expect(baseOwner.currentCode).toBe(base)
  expect(barcodeOwner).toBeUndefined()
  expect(result.conflict.kind).toBe('barcode')
  expect(result.conflict.owner.groupId).toBe(
    result.conflict.requestedOwner.groupId
  )
  expect(result.conflict.owner.variantId).not.toBe(
    result.conflict.requestedOwner.variantId
  )
  expect(result.final.issuedCodes).toHaveLength(3)
})

test('backups preserve independent authoring and preferences without reviving retired codes', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(
    async ({ first, image }) => {
      const { createPreparation } = await import('/src/packing-model.js')
      await library.saveSnapshot(first)
      let saved = await library.savePreparation(
        createPreparation(first, '2026-06')
      )
      await library.savePackingPreferences({
        settings: { fontSize: 12 },
        vocabulary: [{ match: 'box', spanishName: 'caja', category: '盒子' }],
        logoDataUrl: image.dataUrl,
      })
      saved = await library.getPreparation(first.orderId)
      const older = await library.exportBackup()
      saved.groups[0].baseCode = 'CE26060110'
      saved.groups[0].spanishName = 'CAJA'
      const newerPreparation = await library.savePreparation(saved)
      const newer = await library.exportBackup()
      const restored = await openOrderDatabase({
        name: `${databaseName}-packing-restored`,
      })
      await restored.restoreBackup(newer)
      await restored.restoreBackup(older)
      await restored.restoreBackup({
        format: older.format,
        version: 1,
        exportedAt: older.exportedAt,
        orders: older.orders,
        history: older.history,
        images: older.images,
      })
      const beforeUpdate = await restored.getPreparation(first.orderId)
      await restored.saveSnapshot({
        ...first,
        observedAt: '2026-02-02T00:00:00.000Z',
        status: 'Refunded',
      })
      await restored.restoreBackup(newer)
      const output = {
        newerPreparation,
        beforeUpdate,
        preparation: await restored.getPreparation(first.orderId),
        preferences: await restored.getPackingPreferences(),
        backup: await restored.exportBackup(),
        source: await restored.getOrder(first.orderId),
      }
      restored.close()
      return output
    },
    { first: snapshot(), image }
  )
  expect(result.beforeUpdate).toEqual(result.newerPreparation)
  expect(result.preparation).toEqual(result.newerPreparation)
  expect(result.source.snapshot.status).toBe('Refunded')
  expect(result.backup.issuedCodes).toHaveLength(4)
  expect(result.preferences).toEqual({
    appearance: {
      lightTheme: 'warm',
      darkTheme: 'warm',
      labelColors: {},
      paletteRevision: 1,
    },
    sizeVocabulary: DEFAULT_SIZE_VOCABULARY,
    settings: {
      fontSize: 12,
      vocabularyInitialized: true,
      vocabularyVersion: 1,
    },
    vocabulary: [{ match: 'box', spanishName: 'CAJA', category: '盒子' }],
    logoDataUrl: image.dataUrl,
  })
})

test('cross-library code conflicts and malformed packing backups roll back the entire restore', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const { createPreparation } = await import('/src/packing-model.js')
    await library.saveSnapshot(first)
    await library.savePreparation(createPreparation(first, '2026-06'))
    const original = await library.exportBackup()
    const incoming = await openOrderDatabase({
      name: `${databaseName}-conflicting`,
    })
    const second = {
      ...first,
      orderId: '9999999999999999999',
      sourceUrl: first.sourceUrl.replace(first.orderId, '9999999999999999999'),
    }
    await incoming.saveSnapshot(second)
    await incoming.savePreparation(createPreparation(second, '2026-06'))
    const conflicting = await incoming.exportBackup()
    incoming.close()
    const malformed = structuredClone(original)
    malformed.issuedCodes = []
    const repeated = structuredClone(original)
    repeated.preparations.push(repeated.preparations[0])
    const tiedEdit = structuredClone(original)
    tiedEdit.preparations[0].groups[0].spanishName = 'CONFLICT'
    tiedEdit.allocations[0].groups[0].nextItem = 80
    const unknownMember = structuredClone(original)
    unknownMember.preparations[0].groups[0].variants[0].entryIds.push('777')
    const errors = []
    for (const backup of [
      conflicting,
      malformed,
      repeated,
      tiedEdit,
      unknownMember,
    ]) {
      try {
        await library.restoreBackup(backup)
      } catch (error) {
        errors.push(error.message)
      }
    }
    const after = await library.exportBackup()
    return {
      errors,
      original: { ...original, exportedAt: '' },
      after: { ...after, exportedAt: '' },
    }
  }, snapshot())
  expect(result.errors).toHaveLength(5)
  expect(result.errors[0]).toContain('Code conflict')
  expect(result.after).toEqual(result.original)
})

test('restore rolls back authoring whose members disappear in tied source or history merges', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const results = await page.evaluate(async (first) => {
    const { createPreparation } = await import('/src/packing-model.js')
    await library.saveSnapshot(first)
    const output = []
    for (const kind of ['source', 'history']) {
      if (kind === 'history')
        await library.saveSnapshot({
          ...first,
          observedAt: '2026-01-03T12:00:00.000Z',
          status: 'Refunded',
        })
      const before = await library.exportBackup()
      const incoming = await openOrderDatabase({
        name: `${databaseName}-tied-${kind}`,
      })
      const distinct = {
        ...first,
        items: [{ ...first.items[0], entryId: '777' }, first.items[1]],
      }
      await incoming.saveSnapshot(distinct)
      await incoming.savePreparation(createPreparation(distinct, '2026-06'))
      if (kind === 'history')
        await incoming.saveSnapshot({
          ...first,
          observedAt: '2026-01-02T12:00:00.000Z',
        })
      const backup = await incoming.exportBackup()
      incoming.close()
      let error
      try {
        await library.restoreBackup(backup)
      } catch (failure) {
        error = failure.message
      }
      const after = await library.exportBackup()
      output.push({
        kind,
        error,
        before: { ...before, exportedAt: '' },
        after: { ...after, exportedAt: '' },
      })
    }
    return output
  }, snapshot())
  for (const result of results) {
    expect(result.error).toContain('entry missing from its order and history')
    expect(result.after).toEqual(result.before)
  }
})

test('current assignments allow the 3103 to 3105 to 3103 sequence and release 3104 for another product', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const { createPreparation } = await import('/src/packing-model.js')
    first.sellerMemberLogin = 'same-synthetic-seller'
    await library.saveSnapshot(first)
    const second = { ...structuredClone(first), orderId: '9988776655443322110' }
    second.sourceUrl = first.sourceUrl.replace(first.orderId, second.orderId)
    second.items = [second.items[0]]
    second.totals = {
      goodsGross: '20.00',
      shipping: '0.00',
      sourceDiscount: '1.00',
      orderAdjustment: '0.00',
      goodsNet: '19.00',
      payable: '19.00',
    }
    await library.saveSnapshot(second)
    const existing = createPreparation(first, '2026-10')
    existing.groups[0].baseCode = 'CE26103101'
    existing.groups[1].baseCode = 'CE26103102'
    let original = await library.savePreparation(existing)
    const draft = createPreparation(second, '2026-10')
    const before = await library.exportBackup()
    const [preview] = await library.previewPreparations([draft])
    const afterPreview = await library.exportBackup()
    let added = await library.savePreparation(preview)
    const transitions = [added.groups[0].baseCode]
    for (const code of [
      'CE26103105',
      'CE26103103',
      'CE26103104',
      'CE26103103',
    ]) {
      added.groups[0].baseCode = code
      added = await library.savePreparation(added)
      transitions.push(added.groups[0].baseCode)
    }
    library.close()
    window.library = await openOrderDatabase({ name: databaseName })
    const freed = await library.queryCodeOwnership('CE26103104')
    original = await library.getPreparation(first.orderId)
    original.groups[0].baseCode = 'CE26103104'
    original.groups[0].spanishName = 'NOMBRE ACTUAL'
    original.groups[0].category = '当前品类'
    original = await library.savePreparation(original)
    const adopted = await library.queryCodeOwnership('CE26103104')
    const beforeConflict = await library.exportBackup()
    added = await library.getPreparation(second.orderId)
    added.groups[0].baseCode = 'CE26103102'
    let conflict
    try {
      await library.savePreparation(added)
    } catch (error) {
      conflict = error.conflict
    }
    const afterConflict = await library.exportBackup()
    // Re-importing an older backup must not restore inactive code ownership.
    await library.restoreBackup(before)
    const afterOlderRestore = await library.queryCodeOwnership('CE26103101')
    const restored = await openOrderDatabase({
      name: `${databaseName}-current-codes`,
    })
    await restored.restoreBackup(afterConflict)
    const roundtrip = await restored.exportBackup()
    restored.close()
    return {
      before,
      afterPreview,
      transitions,
      freed,
      adopted,
      beforeConflict,
      afterConflict,
      conflict,
      afterOlderRestore,
      roundtrip,
    }
  }, snapshot())
  expect(result.transitions).toEqual([
    'CE26103103',
    'CE26103105',
    'CE26103103',
    'CE26103104',
    'CE26103103',
  ])
  expect({ ...result.afterPreview, exportedAt: '' }).toEqual({
    ...result.before,
    exportedAt: '',
  })
  expect(result.freed.owners).toEqual([])
  expect(
    result.adopted.owners.every((owner) => owner.orderId === orderId)
  ).toBe(true)
  expect(
    result.adopted.owners.every(
      (owner) =>
        owner.spanishName === 'NOMBRE ACTUAL' && owner.category === '当前品类'
    )
  ).toBe(true)
  expect(result.conflict.code).toBe('CE26103102')
  expect(result.conflict.owner.orderId).toBe(orderId)
  expect({ ...result.afterConflict, exportedAt: '' }).toEqual({
    ...result.beforeConflict,
    exportedAt: '',
  })
  expect(result.afterOlderRestore.owners).toEqual([])
  expect(result.roundtrip.preparations).toEqual(
    result.afterConflict.preparations
  )
  expect(result.roundtrip.issuedCodes).toEqual(result.afterConflict.issuedCodes)
  expect(result.roundtrip.version).toBe(3)
})

test('an atomic code swap checks final assignments and rejects a duplicate without partial writes', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const { createPreparation } = await import('/src/packing-model.js')
    await library.saveSnapshot(first)
    const second = {
      ...first,
      orderId: '9988776655443322110',
      sourceUrl: first.sourceUrl.replace(first.orderId, '9988776655443322110'),
    }
    await library.saveSnapshot(second)
    const originals = await library.savePreparations(
      [first, second].map((source) => createPreparation(source, '2026-10'))
    )
    const edits = structuredClone(originals)
    const code = edits[0].groups[0].baseCode
    edits[0].groups[0].baseCode = edits[1].groups[0].baseCode
    edits[1].groups[0].baseCode = code
    const swapped = await library.savePreparations(edits)
    const before = await library.exportBackup()
    const invalid = structuredClone(swapped)
    invalid[0].groups[0].baseCode = invalid[1].groups[0].baseCode
    let conflict
    try {
      await library.savePreparations(invalid)
    } catch (error) {
      conflict = error.code
    }
    const after = await library.exportBackup()
    return { originals, swapped, before, after, conflict }
  }, snapshot())
  expect(result.swapped[0].groups[0].baseCode).toBe(
    result.originals[1].groups[0].baseCode
  )
  expect(result.swapped[1].groups[0].baseCode).toBe(
    result.originals[0].groups[0].baseCode
  )
  expect(result.conflict).toBe('PACKING_CODE_CONFLICT')
  expect({ ...result.after, exportedAt: '' }).toEqual({
    ...result.before,
    exportedAt: '',
  })
})
