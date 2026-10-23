import { test, expect } from './extension-fixture.mjs'

function snapshot() {
  return {
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
}

async function databasePage(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async (source) => {
    window.openDatabase = (await import('/src/database.js')).openDatabase
    window.createPackingBackup = (
      await import('/src/packing-backup.js')
    ).createPackingBackup
    window.model = await import('/src/packing-model.js')
    window.library = await openDatabase({
      name: `packing-backup-${crypto.randomUUID()}`,
    })
    window.target = await openDatabase({
      name: `packing-restore-${crypto.randomUUID()}`,
    })
    await library.saveSnapshot(source)
    await library.resolvePurchaseDate({
      accountId: source.accountId,
      orderId: source.orderId,
      date: '2026-10-01',
      expectedObservedAt: source.observedAt,
    })
    await library.savePreparation(model.createPreparation(source, '2026-10'))
    window.original = await library.exportBackup()
    window.scope = {
      months: ['2026-10'],
      orders: [{ orderId: source.orderId, entryIds: ['2'] }],
    }
  }, snapshot())
  return page
}

test('selected packing backup restores into a fresh library and merges without removing other products', async ({
  extension,
}) => {
  const page = await databasePage(extension)
  const result = await page.evaluate(async () => {
    const backup = createPackingBackup(original, scope)
    await target.restoreBackup(backup)
    const fresh = await target.exportBackup()
    const existing = await openDatabase({
      name: `packing-existing-${crypto.randomUUID()}`,
    })
    await existing.restoreBackup(original)
    const local = await existing.getPreparation('1001')
    local.groups[1].spanishName = 'LOCAL BOWL'
    await existing.savePreparation(local)
    backup.preparations[0].updatedAt = '2090-10-02T12:00:00.000Z'
    backup.preparations[0].groups[0].variants[0].variant = 'Restored blue cup'
    await existing.restoreBackup(backup)
    const merged = await existing.getPreparation('1001')
    existing.close()
    return { backup, fresh, merged }
  })
  expect(result.backup.preparations[0].groups).toHaveLength(1)
  expect(result.backup.preparations[0].groups[0].variants[0].entryIds).toEqual([
    '2',
  ])
  expect(result.fresh.orders[0].snapshot.items).toHaveLength(3)
  expect(result.fresh.preparations[0].groups).toHaveLength(1)
  expect(result.merged.groups).toHaveLength(2)
  expect(result.merged.groups[0].variants).toHaveLength(2)
  expect(
    result.merged.groups[0].variants.find((variant) =>
      variant.entryIds.includes('2')
    ).variant
  ).toBe('Restored blue cup')
  expect(result.merged.groups[1].spanishName).toBe('LOCAL BOWL')
})

test('a partial group restore that would change unselected shared labels fails atomically', async ({
  extension,
}) => {
  const page = await databasePage(extension)
  const result = await page.evaluate(async () => {
    await target.restoreBackup(original)
    const before = await target.exportBackup()
    const backup = createPackingBackup(original, scope)
    backup.preparations[0].updatedAt = '2090-10-02T12:00:00.000Z'
    backup.preparations[0].groups[0].spanishName = 'NEW SHARED NAME'
    backup.orders[0].snapshot.status = 'Awaiting delivery'
    backup.orders[0].snapshot.observedAt = '2026-10-03T12:00:00.000Z'
    backup.orders[0].lastCheckedAt = backup.orders[0].snapshot.observedAt
    let error
    try {
      await target.restoreBackup(backup)
    } catch (failure) {
      error = failure.message
    }
    return { before, after: await target.exportBackup(), error }
  })
  expect(result.error).toContain('Restore the whole group')
  for (const field of [
    'orders',
    'history',
    'preparations',
    'allocations',
    'issuedCodes',
  ])
    expect(result.after[field]).toEqual(result.before[field])
})

test('a selected row missing from newer source data cannot restore an invisible packing', async ({
  extension,
}) => {
  const page = await databasePage(extension)
  const result = await page.evaluate(async () => {
    await target.restoreBackup(original)
    const refreshed = structuredClone(original.orders[0].snapshot)
    refreshed.items = refreshed.items.filter((item) => item.entryId !== '2')
    refreshed.observedAt = '2026-10-03T12:00:00.000Z'
    refreshed.totals.goodsGross =
      refreshed.totals.goodsNet =
      refreshed.totals.payable =
        '20.00'
    await target.saveSnapshot(refreshed)
    const before = await target.exportBackup()
    let error
    try {
      await target.restoreBackup(createPackingBackup(original, scope))
    } catch (failure) {
      error = failure.message
    }
    return { before, after: await target.exportBackup(), error }
  })
  expect(result.error).toContain(
    'newer local data changed or removed selected products'
  )
  for (const field of [
    'orders',
    'history',
    'preparations',
    'allocations',
    'issuedCodes',
  ])
    expect(result.after[field]).toEqual(result.before[field])
})

test('same-revision monthly packing restores combine disjoint products and remain idempotent', async ({
  extension,
}) => {
  const page = await databasePage(extension)
  const result = await page.evaluate(async () => {
    const prepared = await library.getPreparation('1001')
    for (const checkpoint of [
      prepared,
      prepared.defaultPacking,
      prepared.previousPacking,
      prepared.previousPacking?.defaults,
    ].filter(Boolean)) {
      checkpoint.groups[1].month = '2026-11'
      checkpoint.groups[1].baseCode = checkpoint.groups[1].baseCode.replace(
        'CE2610',
        'CE2611'
      )
    }
    // Restore an explicit pre-SEAL mixed-month archive; a current v5 authoring
    // save cannot create a shipment-month code rewrite.
    const prior = await library.exportBackup(),
      state = model.activePackingState([prepared], [], [])
    library.close()
    window.library = await openDatabase({
      name: `legacy-monthly-backup-${crypto.randomUUID()}`,
    })
    await library.restoreBackup({
      format: '1688-order-library',
      version: 4,
      exportedAt: prior.exportedAt,
      orders: prior.orders,
      history: prior.history,
      images: prior.images,
      preparations: [prepared],
      allocations: state.allocations,
      issuedCodes: state.issuedCodes,
      cartonBatches: [],
    })
    const complete = await library.exportBackup()
    const october = createPackingBackup(complete, {
      months: ['2026-10'],
      orders: [{ orderId: '1001', entryIds: ['1', '2'] }],
    })
    const november = createPackingBackup(complete, {
      months: ['2026-11'],
      orders: [{ orderId: '1001', entryIds: ['3'] }],
    })
    const restored = []
    const completeScope = createPackingBackup(complete, {
      months: ['2026-10', '2026-11'],
      orders: [{ orderId: '1001', entryIds: ['1', '2', '3'] }],
    })
    for (const files of [
      [october, november],
      [november, october],
    ]) {
      const destination = await openDatabase({
        name: `packing-months-${crypto.randomUUID()}`,
      })
      for (const file of files) await destination.restoreBackup(file)
      const merged = await destination.exportBackup()
      for (const file of files) await destination.restoreBackup(file)
      const repeated = await destination.exportBackup()
      // Exercise the complete scoped and full-library paths independently from
      // the same reverse-composed state, including a serialization roundtrip.
      const completions = []
      for (const completeFile of [completeScope, complete]) {
        const roundtrip = await openDatabase({
          name: `packing-complete-${crypto.randomUUID()}`,
        })
        await roundtrip.restoreBackup(JSON.parse(JSON.stringify(merged)))
        await roundtrip.restoreBackup(completeFile)
        completions.push(await roundtrip.exportBackup())
        roundtrip.close()
      }
      const authored = await destination.getPreparation('1001')
      authored.groups.reverse()
      const saved = await destination.savePreparation(authored)
      restored.push({ merged, repeated, completions, saved })
      destination.close()
    }
    return { complete, restored }
  })
  for (const { merged, repeated, completions, saved } of result.restored) {
    const preparation = merged.preparations[0]
    const members = (checkpoint) =>
      checkpoint.groups
        .flatMap((group) =>
          group.variants.flatMap((variant) => variant.entryIds)
        )
        .sort()
    expect(members(preparation)).toEqual(['1', '2', '3'])
    expect(members(preparation.defaultPacking)).toEqual(['1', '2', '3'])
    expect(preparation.groups.map((group) => group.month).sort()).toEqual([
      '2026-10',
      '2026-11',
    ])
    expect(preparation.updatedAt).toBe(
      result.complete.preparations[0].updatedAt
    )
    for (const field of ['orders', 'history', 'preparations', 'issuedCodes'])
      expect(repeated[field]).toEqual(merged[field])
    for (const completed of completions) {
      for (const field of [undefined, 'defaultPacking']) {
        const restored = field
          ? completed.preparations[0][field]
          : completed.preparations[0]
        const original = field
          ? result.complete.preparations[0][field]
          : result.complete.preparations[0]
        const groups = (preparation) =>
          preparation.groups.map((group) => ({
            ...group,
            month: group.month ?? preparation.month,
          }))
        expect(groups(restored)).toEqual(groups(original))
        expect(restored.restoreScopes).toBeUndefined()
      }
    }
    expect(saved.restoreScopes).toBeUndefined()
    expect(saved.defaultPacking.restoreScopes).toBeUndefined()
  }
})

test('legacy scoped settings without initialization metadata survive later restores into a nonempty library', async ({
  extension,
}) => {
  const page = await databasePage(extension)
  const result = await page.evaluate(async () => {
    await library.savePackingPreferences({
      settings: { website: 'legacy.example', dpi: 203 },
    })
    const first = createPackingBackup(await library.exportBackup(), scope)
    const second = structuredClone(first)
    Object.assign(second.packingPreferences.value.settings, {
      website: 'second.example',
      dpi: 600,
    })
    const name = `packing-legacy-settings-${crypto.randomUUID()}`
    const destination = await openDatabase({ name })
    await destination.restoreBackup(first)
    const initial = await destination.getPackingPreferences()
    destination.close()
    const request = indexedDB.open(name)
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('packingPreferences', 'readwrite')
      const store = tx.objectStore('packingPreferences')
      const read = store.get('packing')
      read.onsuccess = () => {
        const record = read.result
        delete record.initializedFromBackup
        store.put(record)
      }
      tx.oncomplete = resolve
      tx.onabort = () => reject(tx.error)
    })
    db.close()
    const reopened = await openDatabase({ name })
    await reopened.restoreBackup(second)
    const later = await reopened.getPackingPreferences()
    reopened.close()
    const emptyRequest = indexedDB.open(name)
    const emptyDatabase = await new Promise((resolve, reject) => {
      emptyRequest.onsuccess = () => resolve(emptyRequest.result)
      emptyRequest.onerror = () => reject(emptyRequest.error)
    })
    await new Promise((resolve, reject) => {
      const stores = ['orders', 'history', 'preparations']
      const tx = emptyDatabase.transaction(stores, 'readwrite')
      for (const store of stores) tx.objectStore(store).clear()
      tx.oncomplete = resolve
      tx.onabort = () => reject(tx.error)
    })
    emptyDatabase.close()
    const emptied = await openDatabase({ name })
    await emptied.restoreBackup(second)
    const afterEmpty = await emptied.getPackingPreferences()
    emptied.close()
    const existing = await openDatabase({
      name: `packing-seeded-settings-${crypto.randomUUID()}`,
    })
    await existing.saveSnapshot(original.orders[0].snapshot)
    const seeded = await existing.getPackingPreferences()
    await existing.restoreBackup(second)
    const afterSeeded = await existing.getPackingPreferences()
    existing.close()
    return { initial, later, afterEmpty, seeded, afterSeeded }
  })
  expect(result.later).toEqual(result.initial)
  expect(result.later.settings.website).toBe('legacy.example')
  expect(result.afterEmpty).toEqual(result.initial)
  expect(result.afterSeeded).toEqual(result.seeded)
})

test('packing restore reuses selected cached originals offline for transformed thumbnails', async ({
  extension,
}) => {
  const page = await databasePage(extension)
  const result = await page.evaluate(async () => {
    const url = 'https://cbu01.alicdn.com/selected-original.jpg?_=2020'
    const dataUrl = 'data:image/png;base64,AQID'
    const thumbnail = url.replace('.jpg?', '.jpg_250x250.jpg?')
    original.orders[0].snapshot.items[1].thumbnail = thumbnail
    original.images = [{ url, dataUrl, storedAt: original.exportedAt }]
    const backup = createPackingBackup(original, scope)
    await target.restoreBackup(backup)
    const { loadThumbnail } = await import('/src/images.js')
    const fetch = window.fetch
    window.fetch = () => {
      throw new Error(
        'The restored original must not require a network request'
      )
    }
    try {
      return { image: await loadThumbnail(thumbnail, target), dataUrl }
    } finally {
      window.fetch = fetch
    }
  })
  expect(result.image).toBe(result.dataUrl)
})

test('later scoped restores preserve settings established by the first one after reopen', async ({
  extension,
}) => {
  const page = await databasePage(extension)
  const result = await page.evaluate(async () => {
    await library.savePackingPreferences({
      settings: { dpi: 203, website: 'first.example', destination: 'FIRST' },
    })
    const complete = await library.exportBackup()
    const first = createPackingBackup(complete, scope)
    const second = structuredClone(first)
    Object.assign(second.packingPreferences.value.settings, {
      dpi: 600,
      website: 'second.example',
      destination: 'SECOND',
    })
    const name = `packing-settings-${crypto.randomUUID()}`
    let destination = await openDatabase({ name })
    await destination.getPackingPreferences()
    await destination.restoreBackup(first)
    const initial = await destination.getPackingPreferences()
    destination.close()
    destination = await openDatabase({ name })
    await destination.restoreBackup(second)
    const later = await destination.getPackingPreferences()
    const roundtrip = await openDatabase({
      name: `packing-settings-roundtrip-${crypto.randomUUID()}`,
    })
    await roundtrip.restoreBackup(await destination.exportBackup())
    await roundtrip.restoreBackup(second)
    const roundtripSettings = await roundtrip.getPackingPreferences()
    roundtrip.close()
    // A complete backup still replaces scoped-only defaults, including its catalogs.
    complete.packingPreferences.value.settings.website = 'complete.example'
    await destination.restoreBackup(complete)
    const full = await destination.getPackingPreferences()
    await destination.savePackingPreferences({
      ...full,
      settings: { ...full.settings, website: 'local.example', dpi: 300 },
    })
    await destination.restoreBackup(second)
    const local = await destination.getPackingPreferences()
    destination.close()
    return { initial, later, roundtripSettings, full, local }
  })
  expect(result.initial.settings.website).toBe('first.example')
  expect(result.initial.settings.dpi).toBe(203)
  expect(result.later).toEqual(result.initial)
  expect(result.roundtripSettings).toEqual(result.initial)
  expect(result.full.settings.website).toBe('complete.example')
  expect(result.local.settings.website).toBe('local.example')
  expect(result.local.settings.dpi).toBe(300)
})

test('contradictory overlapping same-time packing restore rolls back preceding preparations', async ({
  extension,
}) => {
  const page = await databasePage(extension)
  const result = await page.evaluate(async () => {
    await target.restoreBackup(createPackingBackup(original, scope))
    const other = structuredClone(original.orders[0].snapshot)
    other.orderId = '1002'
    other.sourceUrl = other.sourceUrl.replace('1001', '1002')
    await library.saveSnapshot(other)
    await library.resolvePurchaseDate({
      accountId: other.accountId,
      orderId: other.orderId,
      date: '2026-10-01',
      expectedObservedAt: other.observedAt,
    })
    await library.savePreparation(model.createPreparation(other, '2026-10'))
    const combined = createPackingBackup(await library.exportBackup(), {
      months: ['2026-10'],
      orders: [
        { orderId: '1002', entryIds: ['1'] },
        { orderId: '1001', entryIds: ['1', '2', '3'] },
      ],
    })
    combined.preparations.sort((a, b) => b.orderId.localeCompare(a.orderId))
    const conflicting = combined.preparations.find(
      (entry) => entry.orderId === '1001'
    )
    conflicting.groups[0].variants.find((entry) =>
      entry.entryIds.includes('2')
    ).variant = 'Contradictory overlap'
    const before = await target.exportBackup()
    let error
    try {
      await target.restoreBackup(combined)
    } catch (failure) {
      error = failure.message
    }
    return { before, after: await target.exportBackup(), error }
  })
  expect(result.error).toContain('same timestamp')
  for (const field of [
    'orders',
    'history',
    'preparations',
    'allocations',
    'issuedCodes',
    'packingPreferences',
    'images',
    'cartonBatches',
  ])
    expect(result.after[field]).toEqual(result.before[field])
})
