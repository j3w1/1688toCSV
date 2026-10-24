import { test, expect } from './extension-fixture.mjs'

function snapshot() {
  return {
    schemaVersion: 1,
    accountId: 'local',
    orderId: '1001',
    sourceUrl:
      'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1001',
    sellerName: 'Synthetic partial annotations',
    sellerMemberLogin: 'synthetic-partial-annotations',
    status: 'Completed',
    purchasedAt: '2026-10-01T12:00:00+08:00',
    observedAt: '2026-10-01T12:00:00.000Z',
    items: ['Cup', 'Bowl', 'Plate'].map((title, index) => ({
      entryId: String(index + 1),
      title,
      description: title,
      price: '10.00',
      quantity: '1',
      sourceDiscount: '0.00',
      allocatedDiscount: '0.00',
      discount: '0.00',
      thumbnail: '',
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
}

async function openSource(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async (source) => {
    const { openDatabase } = await import('/src/database.js')
    const { createPreparation } = await import('/src/packing-model.js')
    const { createPackingBackup } = await import('/src/packing-backup.js')
    window.openOrderDatabase = openDatabase
    window.databaseName = `synthetic-annotations-${crypto.randomUUID()}`
    const library = await openDatabase({ name: databaseName })
    await library.saveSnapshot(source)
    await library.savePreparation(createPreparation(source, '2026-10'))
    await library.setNotes(source.orderId, { notes: '', tags: ['Priority'] })
    await library.setProductTags(source.orderId, '1', ['Outside'])
    await library.setProductTags(source.orderId, '2', ['Fragile'])
    await library.setPackingExcluded(source.orderId, ['1', '2'], true)
    const preferences = await library.getPackingPreferences()
    const orderTag = preferences.orderTags.find(
      ({ name }) => name === 'Priority'
    )
    Object.assign(orderTag, {
      colors: { light: '#ffe8c4', dark: '#402619' },
      textColors: { light: '#6b3210', dark: '#ffd8ad' },
    })
    const productTag = preferences.productTags.find(
      ({ name }) => name === 'Fragile'
    )
    Object.assign(productTag, {
      colors: { light: '#dceee6', dark: '#243b30' },
      textColors: { light: '#274f38', dark: '#bde1cc' },
    })
    preferences.appearance.lightTheme = '1688'
    preferences.appearance.darkTheme = 'terracotta'
    preferences.appearance.labelColors.saved = {
      light: '#ddeeff',
      dark: '#112233',
    }
    await library.savePackingPreferences(preferences)
    window.full = await library.exportBackup()
    window.scoped = createPackingBackup(full, {
      months: ['2026-10'],
      orders: [{ orderId: source.orderId, entryIds: ['2'] }],
    })
    library.close()
  }, snapshot())
  return page
}

for (const authoredSettings of [false, true]) {
  test(`later packing restores merge new assigned tag definitions while preserving ${authoredSettings ? 'authored' : 'scoped-initialized'} settings`, async ({
    extension,
  }) => {
    const page = await openSource(extension)
    const result = await page.evaluate(async (authoredSettings) => {
      const { createPreparation } = await import('/src/packing-model.js')
      const { createPackingBackup } = await import('/src/packing-backup.js')
      const source = {
        ...full.orders[0].snapshot,
        orderId: '1002',
        sourceUrl: full.orders[0].snapshot.sourceUrl.replace('1001', '1002'),
        purchasedAt: '2026-11-01T12:00:00+08:00',
        observedAt: '2026-11-01T12:00:00.000Z',
      }
      const second = await openOrderDatabase({ name: `${databaseName}-second` })
      await second.saveSnapshot(source)
      await second.savePreparation(createPreparation(source, '2026-11'))
      await second.setNotes('1002', {
        notes: '',
        tags: ['Priority', 'Second order'],
      })
      await second.setProductTags('1002', '2', ['Fragile', 'Second product'])
      const incomingPreferences = await second.getPackingPreferences()
      for (const field of ['orderTags', 'productTags']) {
        for (const tag of incomingPreferences[field]) {
          tag.colors = { light: '#abcdef', dark: '#123456' }
          tag.textColors = { light: '#112233', dark: '#ddeeff' }
        }
      }
      incomingPreferences.settings.website = 'incoming.example'
      await second.savePackingPreferences(incomingPreferences)
      const incoming = createPackingBackup(await second.exportBackup(), {
        months: ['2026-11'],
        orders: [{ orderId: '1002', entryIds: ['2'] }],
      })
      second.close()
      // Valid archives may include unused definitions. Import only those whose
      // assignments survive the restore, rather than unrelated Settings entries.
      for (const field of ['orderTags', 'productTags'])
        incoming.packingPreferences.value[field].push({
          name: 'Unused incoming',
          colors: { light: '#abcdef' },
        })

      const targetName = `${databaseName}-composed-${authoredSettings}`
      const target = await openOrderDatabase({ name: targetName })
      await target.restoreBackup(scoped)
      if (authoredSettings) {
        const preferences = await target.getPackingPreferences()
        preferences.settings.website = 'local.example'
        preferences.appearance.lightTheme = 'apricot'
        await target.savePackingPreferences(preferences)
      }
      const before = await target.exportBackup()
      await target.restoreBackup(incoming)
      const restored = await target.exportBackup()
      await target.restoreBackup(incoming)
      await target.restoreBackup(scoped)
      const repeated = await target.exportBackup()
      target.close()
      const reopened = await openOrderDatabase({ name: targetName })
      const persisted = await reopened.exportBackup()
      reopened.close()
      return { before, incoming, restored, repeated, persisted }
    }, authoredSettings)

    const before = result.before.packingPreferences
    const restored = result.restored.packingPreferences
    expect(result.restored.orders).toHaveLength(2)
    expect(
      result.restored.orders.find(({ snapshot }) => snapshot.orderId === '1002')
    ).toMatchObject({
      tags: ['Priority', 'Second order'],
      productTags: { 2: ['Fragile', 'Second product'] },
    })
    const expectedValue = { ...before.value }
    for (const [field, name] of [
      ['orderTags', 'Second order'],
      ['productTags', 'Second product'],
    ]) {
      const incoming = result.incoming.packingPreferences.value[field].find(
        (tag) => tag.name === name
      )
      expectedValue[field] = [...before.value[field], incoming]
      expect(restored.value[field].find((tag) => tag.name === name)).toEqual(
        incoming
      )
    }
    // Includes existing same-named definitions, global settings, appearance,
    // catalogs and the preference timestamp; only new assigned tags are added.
    expect(restored).toEqual({ ...before, value: expectedValue })
    expect(result.repeated.packingPreferences).toEqual(restored)
    expect(result.persisted.packingPreferences).toEqual(restored)
    expect(result.repeated.orders).toEqual(result.restored.orders)
    expect(result.persisted.orders).toEqual(result.restored.orders)
  })
}

test('fresh packing restore keeps assigned tag colors and completes same-time source annotations and preparation from a full backup', async ({
  extension,
}) => {
  const page = await openSource(extension)
  const result = await page.evaluate(async () => {
    const target = await openOrderDatabase({ name: `${databaseName}-fresh` })
    await target.restoreBackup(scoped)
    const imported = await target.exportBackup()
    const stalePreparation = await target.getPreparation('1001')
    await target.restoreBackup(full)
    const completed = await target.exportBackup()
    let staleSaveError
    try {
      stalePreparation.groups[0].category = 'Stale edit'
      await target.savePreparation(stalePreparation)
    } catch (error) {
      staleSaveError = error.message
    }
    await target.setProductTags('1001', '2', [])
    await target.setPackingExcluded('1001', ['2'], false)
    const cleared = await target.getOrder('1001')
    await target.restoreBackup(full)
    const afterOlderFull = await target.getOrder('1001')
    await target.restoreBackup(scoped)
    const afterScoped = await target.getOrder('1001')
    target.close()
    const editedTarget = await openOrderDatabase({
      name: `${databaseName}-authored-settings`,
    })
    await editedTarget.restoreBackup(scoped)
    const preferences = await editedTarget.getPackingPreferences()
    preferences.settings.website = 'my-local.example'
    preferences.appearance.lightTheme = 'apricot'
    preferences.appearance.darkTheme = 'warm'
    await editedTarget.savePackingPreferences(preferences)
    const localPreferences = await editedTarget.getPackingPreferences()
    await editedTarget.restoreBackup(full)
    const preservedPreferences = await editedTarget.getPackingPreferences()
    editedTarget.close()
    return {
      full,
      scoped,
      imported,
      completed,
      staleSaveError,
      cleared,
      afterOlderFull,
      afterScoped,
      localPreferences,
      preservedPreferences,
    }
  })
  const source = result.full.orders[0]
  expect(result.imported.orders[0].productTags).toEqual({ 2: ['Fragile'] })
  expect(result.imported.orders[0].packingExcludedEntryIds).toEqual(['2'])
  expect(result.imported.orders[0].productTagsPartialClocks).toEqual({
    2: source.productTagsUpdatedAt,
  })
  expect(result.imported.orders[0].packingExclusionsPartialClocks).toEqual({
    2: source.packingExclusionsUpdatedAt,
  })
  for (const field of ['orderTags', 'productTags'])
    expect(result.imported.packingPreferences.value[field]).toEqual(
      result.scoped.packingPreferences.value[field]
    )
  expect(result.imported.packingPreferences.value.appearance).toEqual({
    lightTheme: 'warm',
    darkTheme: 'warm',
    labelColors: {},
    paletteRevision:
      result.full.packingPreferences.value.appearance.paletteRevision,
  })
  expect(result.completed.orders).toEqual(result.full.orders)
  // Joining a month-scoped restore materializes inherited group months in
  // current preparation and its checkpoints. Assert the full normalized data.
  const explicitMonths = (checkpoint) => ({
    ...checkpoint,
    groups: checkpoint.groups.map((group) => ({
      ...group,
      month: group.month ?? checkpoint.month,
    })),
  })
  expect(result.completed.preparations).toEqual(
    result.full.preparations.map((preparation) => ({
      ...explicitMonths(preparation),
      defaultPacking: explicitMonths(preparation.defaultPacking),
      revision: preparation.revision + 1,
    }))
  )
  const effectiveItemMonths = (checkpoint) =>
    checkpoint.groups.flatMap((group) =>
      group.variants.flatMap((variant) =>
        variant.entryIds.map((entryId) => [
          entryId,
          group.month ?? checkpoint.month,
        ])
      )
    )
  for (const original of result.full.preparations) {
    const restored = result.completed.preparations.find(
      ({ orderId }) => orderId === original.orderId
    )
    expect(effectiveItemMonths(restored)).toEqual(effectiveItemMonths(original))
    expect(effectiveItemMonths(restored.defaultPacking)).toEqual(
      effectiveItemMonths(original.defaultPacking)
    )
  }
  expect(result.completed.packingPreferences).toEqual(
    result.full.packingPreferences
  )
  expect(result.imported.packingPreferences.updatedAt).toBe(
    '1970-01-01T00:00:00.000Z'
  )
  expect(result.preservedPreferences.settings).toEqual(
    result.localPreferences.settings
  )
  expect(result.preservedPreferences.appearance).toEqual(
    result.localPreferences.appearance
  )
  expect(result.staleSaveError).toMatch(/changed in another tab/)
  expect(result.completed.orders[0].productTagsPartialClocks).toBeUndefined()
  expect(
    result.completed.orders[0].packingExclusionsPartialClocks
  ).toBeUndefined()
  expect(result.afterOlderFull).toEqual(result.cleared)
  expect(result.afterScoped).toEqual(result.cleared)
})

test('editing a partial restore protects selected clears while an older complete backup fills unobserved entries', async ({
  extension,
}) => {
  const page = await openSource(extension)
  const result = await page.evaluate(async () => {
    const target = await openOrderDatabase({ name: `${databaseName}-edited` })
    await target.restoreBackup(scoped)
    await target.setProductTags('1001', '2', [])
    await target.setPackingExcluded('1001', ['2'], false)
    const cleared = await target.getOrder('1001')
    // A newer seller observation must retain partial coverage, including clears.
    await target.saveSnapshot({
      ...cleared.snapshot,
      observedAt: '2026-10-02T12:00:00.000Z',
      status: 'Awaiting shipment',
    })
    const refreshed = await target.getOrder('1001')
    const partialBackup = await target.exportBackup()
    target.close()
    const reopened = await openOrderDatabase({ name: `${databaseName}-edited` })
    await reopened.restoreBackup(full)
    const completed = await reopened.getOrder('1001')
    await reopened.restoreBackup(full)
    const repeated = await reopened.getOrder('1001')
    reopened.close()
    const copied = await openOrderDatabase({ name: `${databaseName}-copied` })
    await copied.restoreBackup(partialBackup)
    await copied.restoreBackup(full)
    const fromSerialized = await copied.getOrder('1001')
    copied.close()
    return { full, cleared, refreshed, completed, repeated, fromSerialized }
  })
  expect(result.cleared.productTags).toEqual({})
  expect(result.cleared.packingExcludedEntryIds).toEqual([])
  expect(result.cleared.productTagsUpdatedAt).toBeUndefined()
  expect(result.cleared.packingExclusionsUpdatedAt).toBeUndefined()
  expect(result.cleared.productTagsPartialClocks['2']).toBeTruthy()
  expect(result.cleared.packingExclusionsPartialClocks['2']).toBeTruthy()
  expect(result.refreshed.productTagsPartialClocks).toEqual(
    result.cleared.productTagsPartialClocks
  )
  expect(result.refreshed.packingExclusionsPartialClocks).toEqual(
    result.cleared.packingExclusionsPartialClocks
  )
  expect(result.completed.productTags).toEqual({ 1: ['Outside'] })
  expect(result.completed.packingExcludedEntryIds).toEqual(['1'])
  expect(result.completed.productTagsPartialClocks).toEqual(
    result.cleared.productTagsPartialClocks
  )
  expect(result.completed.packingExclusionsPartialClocks).toEqual(
    result.cleared.packingExclusionsPartialClocks
  )
  expect(result.completed.productTagsUpdatedAt).toBe(
    result.full.orders[0].productTagsUpdatedAt
  )
  expect(result.completed.packingExclusionsUpdatedAt).toBe(
    result.full.orders[0].packingExclusionsUpdatedAt
  )
  expect(result.completed.snapshot.status).toBe('Awaiting shipment')
  expect(result.repeated).toEqual(result.completed)
  expect(result.fromSerialized).toEqual(result.completed)
})

test('global product-tag rename and removal retain newer partial edits during full restore', async ({
  extension,
}) => {
  const page = await openSource(extension)
  const result = await page.evaluate(async () => {
    const target = await openOrderDatabase({ name: `${databaseName}-tags` })
    await target.restoreBackup(scoped)
    await target.renameTag('Fragile', 'Handle carefully', { scope: 'product' })
    const renamed = await target.getOrder('1001')
    await target.restoreBackup(full)
    const afterRenameRestore = await target.getOrder('1001')
    await target.removeTag('Handle carefully', { scope: 'product' })
    const removed = await target.getOrder('1001')
    await target.restoreBackup(full)
    const afterRemoveRestore = await target.getOrder('1001')
    target.close()
    return { renamed, afterRenameRestore, removed, afterRemoveRestore }
  })
  expect(result.renamed.productTags).toEqual({ 2: ['Handle carefully'] })
  expect(result.afterRenameRestore.productTags).toEqual({
    1: ['Outside'],
    2: ['Handle carefully'],
  })
  expect(result.afterRenameRestore.productTagsPartialClocks).toEqual(
    result.renamed.productTagsPartialClocks
  )
  expect(result.removed.productTags).toEqual({ 1: ['Outside'] })
  expect(
    result.removed.productTagsPartialClocks['2'] >
      result.renamed.productTagsPartialClocks['2']
  ).toBe(true)
  expect(result.afterRemoveRestore).toEqual(result.removed)
})
