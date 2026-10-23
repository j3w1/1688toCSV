import { test, expect } from './extension-fixture.mjs'

function snapshot() {
  return {
    schemaVersion: 1,
    accountId: 'local',
    orderId: '1001',
    sourceUrl:
      'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1001',
    sellerName: 'Synthetic shared carton supplier',
    sellerMemberLogin: 'shared-carton-supplier',
    status: 'Completed',
    purchasedAt: '2026-10-01T12:00:00+08:00',
    observedAt: '2026-10-01T12:00:00.000Z',
    items: [3, 30, 30].map((quantity, index) => ({
      entryId: String(index + 1),
      title: 'Plush figure',
      description: `Plush ${['S', 'M', 'L'][index]}`,
      thumbnail: '',
      price: '1.00',
      quantity: String(quantity),
      skuProperties: [{ label: '尺寸', value: ['S', 'M', 'L'][index] }],
      sourceDiscount: '0.00',
      allocatedDiscount: '0.00',
      discount: '0.00',
    })),
    totals: {
      goodsGross: '63.00',
      shipping: '0.00',
      sourceDiscount: '0.00',
      orderAdjustment: '0.00',
      goodsNet: '63.00',
      payable: '63.00',
    },
  }
}

async function setup(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async (source) => {
    const { openDatabase } = await import('/src/database.js'),
      { createPreparation } = await import('/src/packing-model.js')
    window.cartonModel = await import('/src/carton-batches.js')
    window.dbName = `synthetic-batches-${crypto.randomUUID()}`
    window.lib = await openDatabase({ name: dbName })
    await lib.saveSnapshot(source)
    const prep = createPreparation(source, '2026-10')
    if (prep.groups.length > 1) {
      const first = prep.groups[0]
      first.variants = prep.groups.flatMap((group) => group.variants)
      prep.groups = [first]
    }
    window.prep = await lib.savePreparation(prep)
    window.newBatch = () => ({
      id: crypto.randomUUID(),
      accountId: 'local',
      month: '2026-10',
      storeId: '["1688","shared-carton-supplier"]',
      groups: [{ orderId: '1001', groupId: window.prep.groups[0].id }],
      contents: [
        { orderId: '1001', entryId: '1', quantity: '3' },
        { orderId: '1001', entryId: '2', quantity: '30' },
        { orderId: '1001', entryId: '3', quantity: '30' },
      ],
      count: 6,
      len: '40',
      wid: '30',
      ht: '25',
      weightBasis: 'carton',
      weight: '9.5367',
      received: 6,
      loaded: 0,
      revision: 0,
    })
  }, snapshot())
  return page
}

test('physical carton batches persist with exact mixed totals and a stale writer cannot overwrite them', async ({
  extension,
}) => {
  const page = await setup(extension)
  const result = await page.evaluate(async () => {
    const first = await lib.saveCartonBatch(newBatch())
    const second = await lib.saveCartonBatch(
      { ...first, loaded: 3 },
      { expectedRevision: first.revision }
    )
    let conflict
    try {
      await lib.saveCartonBatch(
        { ...first, count: 7 },
        { expectedRevision: first.revision }
      )
    } catch (error) {
      conflict = error.code
    }
    let overallocated
    try {
      await lib.saveCartonBatch({
        ...newBatch(),
        contents: [{ orderId: '1001', entryId: '2', quantity: '1' }],
      })
    } catch (error) {
      overallocated = error.message
    }
    const { openDatabase } = await import('/src/database.js')
    lib.close()
    window.lib = await openDatabase({ name: dbName })
    const batches = await lib.listCartonBatches(),
      backup = await lib.exportBackup()
    const target = await openDatabase({ name: `${dbName}-restored` })
    await target.restoreBackup(backup)
    const restored = await target.listCartonBatches()
    const metrics = cartonModel.cartonBatchMetrics(restored[0])
    target.close()
    return {
      first,
      second,
      conflict,
      overallocated,
      batches,
      backupVersion: backup.version,
      operationalCounts: Object.fromEntries(
        [
          'containers',
          'packingReports',
          'reportSources',
          'orderCartonDrafts',
          'shipmentLocks',
          'operationIntents',
        ].map((key) => [key, backup[key].length])
      ),
      restored,
      metrics,
    }
  })
  expect(result.conflict).toBe('CARTON_BATCH_CONFLICT')
  expect(result.overallocated).toContain('exceed')
  expect(result.batches).toHaveLength(1)
  expect(result.backupVersion).toBe(5)
  expect(result.operationalCounts).toEqual({
    containers: 0,
    packingReports: 0,
    reportSources: 0,
    orderCartonDrafts: 0,
    shipmentLocks: 0,
    operationIntents: 0,
  })
  expect(result.restored).toEqual(result.batches)
  expect(result.metrics).toMatchObject({
    quantity: '63',
    totalWeight: '57.2202',
    totalVolume: '0.18',
    loadedWeight: '28.6101',
  })
})

test('deleted batches survive old backups without resurrection and source refresh flags reduced quantities', async ({
  extension,
}) => {
  const page = await setup(extension)
  const result = await page.evaluate(async (source) => {
    const first = await lib.saveCartonBatch(newBatch()),
      old = await lib.exportBackup()
    await lib.removeCartonBatch(first)
    const beforeRestore = await lib.exportBackup()
    let conflict
    try {
      await lib.restoreBackup(old)
    } catch (error) {
      conflict = error.code
    }
    const afterRestore = await lib.exportBackup()
    const stable = (backup) => JSON.stringify({ ...backup, exportedAt: '' })
    const visible = await lib.listCartonBatches(),
      retired = await lib.listCartonBatches({ includeDeleted: true })
    const restored = await lib.saveCartonBatches([
      {
        after: { ...first, deletedAt: undefined },
        expectedRevision: retired[0].revision,
        restore: true,
      },
    ])
    await lib.saveSnapshot({
      ...source,
      observedAt: '2026-10-02T12:00:00.000Z',
      items: source.items.map((item) => ({ ...item, quantity: '1' })),
      totals: {
        ...source.totals,
        goodsGross: '3.00',
        goodsNet: '3.00',
        payable: '3.00',
      },
    })
    const reduced = await lib.listCartonBatches()
    return {
      visible,
      retired,
      restored,
      reduced,
      conflict,
      atomic: stable(beforeRestore) === stable(afterRestore),
    }
  }, snapshot())
  expect(result.conflict).toBe('RESTORE_CARTON_TOMBSTONE')
  expect(result.atomic).toBe(true)
  expect(result.visible).toEqual([])
  expect(result.retired).toHaveLength(1)
  expect(result.retired[0].deletedAt).toBeTruthy()
  expect(result.reduced).toHaveLength(1)
  expect(result.reduced[0]).toMatchObject({ needsReview: true, count: 6 })
  expect(result.reduced[0].contents.map((item) => item.quantity)).toEqual([
    '3',
    '30',
    '30',
  ])
})

test('purchase-month codes reject shipment-month moves and reviewed unassignment retires carton context atomically', async ({
  extension,
}) => {
  const page = await setup(extension)
  const result = await page.evaluate(async () => {
    const batch = await lib.saveCartonBatch(newBatch())
    const before = await lib.getPreparation('1001')
    const sourceBefore = await lib.getOrder('1001')
    const wrongMonth = structuredClone(before)
    wrongMonth.groups[0].month = '2026-11'
    wrongMonth.groups[0].baseCode = wrongMonth.groups[0].baseCode.replace(
      'CE2610',
      'CE2611'
    )
    const cartonBatchChanges = [
      {
        after: { ...batch, deletedAt: new Date().toISOString() },
        expectedRevision: batch.revision,
      },
    ]
    const monthErrors = []
    for (const options of [{}, { cartonBatchChanges }]) {
      try {
        await lib.savePreparation(wrongMonth, options)
      } catch (error) {
        monthErrors.push(error.code)
      }
    }
    const unchanged = await lib.getPreparation('1001')
    const physicalBefore = await lib.listCartonBatches()
    const candidate = { ...before, groups: [] }
    let blocked
    try {
      await lib.savePreparation(candidate)
    } catch (error) {
      blocked = error.code
    }
    const after = await lib.savePreparation(candidate, { cartonBatchChanges })
    const retired = (await lib.listCartonBatches({ includeDeleted: true }))[0]
    return {
      blocked,
      batch,
      before,
      unchanged,
      physicalBefore,
      monthErrors,
      after,
      sourceUnchanged:
        JSON.stringify(sourceBefore) ===
        JSON.stringify(await lib.getOrder('1001')),
      retired,
    }
  })
  expect(result.monthErrors).toEqual([
    'PURCHASE_CODE_MONTH',
    'PURCHASE_CODE_MONTH',
  ])
  expect(result.unchanged).toEqual(result.before)
  expect(result.physicalBefore).toEqual([result.batch])
  expect(result.blocked).toBe('CARTON_BATCHES_AFFECTED')
  expect(result.after.groups).toEqual([])
  expect(result.sourceUnchanged).toBe(true)
  expect(result.retired).toMatchObject({
    month: '2026-10',
    received: 6,
    loaded: 0,
  })
  expect(result.retired.deletedAt).toBeTruthy()
  for (const key of ['count', 'weight', 'contents']) {
    expect(result.retired[key]).toEqual(result.batch[key])
  }
})

test('legacy v3 confirmations migrate without guessed per-variant box counts or duplicate batches', async ({
  extension,
}) => {
  const page = await setup(extension)
  const result = await page.evaluate(async () => {
    const old = await lib.exportBackup()
    old.version = 3
    delete old.cartonBatches
    const owner = old.orders[0]
    owner.cartonDetails = { 1: { boxes: '6', kg: '9.5367', cbm: '0.076876' } }
    owner.cartonDetailsUpdatedAt = '2026-10-03T12:00:00.000Z'
    owner.cartonConfirmations = {
      1: { '2026-10': { received: 6, loaded: 0 }, '2026-11': { received: 9 } },
    }
    owner.cartonConfirmationClocks = {
      1: {
        '2026-10': '2026-10-03T12:00:00.000Z',
        '2026-11': '2026-11-03T12:00:00.000Z',
      },
    }
    const { openDatabase } = await import('/src/database.js'),
      target = await openDatabase({ name: `${dbName}-legacy` })
    await target.restoreBackup(old)
    const first = await target.listCartonBatches(),
      second = await target.listCartonBatches(),
      backup = await target.exportBackup()
    target.close()
    return { first, second, backup }
  })
  expect(result.first).toHaveLength(1)
  expect(result.second).toEqual(result.first)
  expect(result.first[0]).toMatchObject({
    count: 6,
    received: 6,
    loaded: 0,
    suppliedCbm: '0.076876',
    month: '2026-10',
  })
  expect(result.backup.version).toBe(5)
  expect(
    result.backup.orders[0].cartonConfirmations['1']['2026-11'].received
  ).toBe(9)
})

test('v3 database upgrade converts historical defaults once and later v4 defaults remain proposals', async ({
  extension,
}) => {
  const page = await setup(extension)
  const result = await page.evaluate(async () => {
    const backup = await lib.exportBackup(),
      source = structuredClone(backup.orders[0]),
      name = `${dbName}-upgrade-v3`
    source.unitsPerCarton = { 1: 3 }
    source.cartonDetails = { 2: { kg: '4.5', len: '40', wid: '30', ht: '25' } }
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 3)
      request.onupgradeneeded = () => {
        const db = request.result,
          orders = db.createObjectStore('orders', {
            keyPath: ['snapshot.accountId', 'snapshot.orderId'],
          }),
          history = db.createObjectStore('history', {
            keyPath: [
              'snapshot.accountId',
              'snapshot.orderId',
              'snapshot.observedAt',
            ],
          }),
          preparations = db.createObjectStore('preparations', {
            keyPath: ['accountId', 'orderId'],
          })
        orders.createIndex('account', 'snapshot.accountId')
        history.createIndex('order', ['snapshot.accountId', 'snapshot.orderId'])
        preparations.createIndex('account', 'accountId')
        db.createObjectStore('jobs', { keyPath: 'id' })
        db.createObjectStore('images', { keyPath: 'url' })
        db.createObjectStore('packingAllocations', {
          keyPath: ['accountId', 'month'],
        })
        db.createObjectStore('issuedCodes', {
          keyPath: ['accountId', 'kind', 'code'],
        })
        db.createObjectStore('packingPreferences', { keyPath: 'id' })
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction(
            ['orders', 'preparations', 'packingAllocations', 'issuedCodes'],
            'readwrite'
          )
        tx.objectStore('orders').put(source)
        for (const preparation of backup.preparations)
          tx.objectStore('preparations').put(preparation)
        for (const allocation of backup.allocations)
          tx.objectStore('packingAllocations').put(allocation)
        for (const issued of backup.issuedCodes)
          tx.objectStore('issuedCodes').put(issued)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onabort = () => {
          db.close()
          reject(tx.error)
        }
      }
    })
    const { openDatabase } = await import('/src/database.js')
    let upgraded = await openDatabase({ name })
    const first = await upgraded.listCartonBatches(),
      sourceAfterUpgrade = await upgraded.getOrder('1001')
    await upgraded.setUnitsPerCarton('1001', '3', 10)
    await upgraded.setCartonDetails('1001', '3', {
      kg: '5',
      len: '50',
      wid: '40',
      ht: '30',
    })
    const afterDefaults = await upgraded.listCartonBatches(),
      exported = await upgraded.exportBackup()
    upgraded.close()
    upgraded = await openDatabase({ name })
    const reopened = await upgraded.listCartonBatches()
    await upgraded.setCartonDetails('1001', '3', {
      boxes: '2',
      kg: '5',
      len: '50',
      wid: '40',
      ht: '30',
    })
    const withExplicitBoxes = await upgraded.listCartonBatches()
    upgraded.close()
    return {
      source,
      sourceAfterUpgrade,
      first,
      afterDefaults,
      exported,
      reopened,
      withExplicitBoxes,
    }
  })
  expect(result.sourceAfterUpgrade).toEqual(result.source)
  expect(result.first).toHaveLength(2)
  expect(
    result.first.find((batch) => batch.contents[0].entryId === '1').count
  ).toBe(1)
  expect(
    result.first.find((batch) => batch.contents[0].entryId === '2')
  ).toMatchObject({ count: null, weight: '4.5' })
  expect(result.afterDefaults).toEqual(result.first)
  expect(result.exported.cartonBatches).toEqual(result.first)
  expect(result.reopened).toEqual(result.first)
  expect(result.withExplicitBoxes).toHaveLength(3)
  expect(
    result.withExplicitBoxes.find((batch) => batch.contents[0].entryId === '3')
      .count
  ).toBe(2)
})
