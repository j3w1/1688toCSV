import { test, expect } from './extension-fixture.mjs'

function snapshot(accountId = 'local') {
  return {
    schemaVersion: 1,
    accountId,
    orderId: '1001',
    sourceUrl:
      'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1001',
    sellerName: 'Synthetic carton supplier',
    sellerMemberLogin: 'synthetic-carton-supplier',
    status: 'Completed',
    purchasedAt: '2026-10-01T12:00:00+08:00',
    observedAt: '2026-10-01T12:00:00.000Z',
    items: ['Cup', 'Bowl', 'Plate'].map((title, index) => ({
      entryId: String(index + 1),
      title,
      description: title,
      price: '10.00',
      quantity: '100',
      sourceDiscount: '0.00',
      allocatedDiscount: '0.00',
      discount: '0.00',
      thumbnail: '',
    })),
    totals: {
      goodsGross: '3000.00',
      shipping: '0.00',
      sourceDiscount: '0.00',
      orderAdjustment: '0.00',
      goodsNet: '3000.00',
      payable: '3000.00',
    },
  }
}

async function openTestDatabase(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async () => {
    const { openDatabase } = await import('/src/database.js')
    window.openOrderDatabase = openDatabase
    window.databaseName = `synthetic-cartons-${crypto.randomUUID()}`
    window.library = await openDatabase({ name: databaseName })
  })
  return page
}

test('source carton capacity edits before preparation survive refresh, reopen and full restore', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    await library.saveSnapshot({ ...source, accountId: 'other-account' })
    const saved = await library.setUnitsPerCarton('1001', '1', ' 10 ')
    const preparation = await library.getPreparation('1001')
    const unchanged = await library.setUnitsPerCarton('1001', '1', 10)
    const errors = []
    for (const value of [0, -1, 1.5, '1e2', '9007199254740993']) {
      try {
        await library.setUnitsPerCarton('1001', '1', value)
      } catch (error) {
        errors.push(error.message)
      }
    }
    const missingErrors = []
    for (const [orderId, entryId] of [
      ['1001', '99'],
      ['9999', '1'],
    ]) {
      try {
        await library.setUnitsPerCarton(orderId, entryId, 10)
      } catch (error) {
        missingErrors.push(error.message)
      }
    }
    const beforeRefresh = await library.getOrder('1001')
    await library.saveSnapshot({
      ...source,
      status: 'Awaiting shipment',
      observedAt: '2026-10-02T12:00:00.000Z',
    })
    const refreshed = await library.getOrder('1001')
    const other = await library.getOrder('1001', { accountId: 'other-account' })
    const backup = await library.exportBackup()
    library.close()
    window.library = await openOrderDatabase({ name: databaseName })
    const reopened = await library.getOrder('1001')
    const restored = await openOrderDatabase({
      name: `${databaseName}-restored`,
    })
    await restored.restoreBackup(backup)
    const fromBackup = await restored.getOrder('1001')
    const cleared = await restored.setUnitsPerCarton('1001', '1', '')
    await restored.restoreBackup(backup)
    const afterOldRestore = await restored.getOrder('1001')
    restored.close()
    library.close()
    return {
      saved,
      preparation,
      unchanged,
      errors,
      missingErrors,
      beforeRefresh,
      refreshed,
      reopened,
      other,
      fromBackup,
      cleared,
      afterOldRestore,
    }
  }, snapshot())
  expect(result.saved.unitsPerCarton).toEqual({ 1: 10 })
  expect(result.saved.unitsPerCartonUpdatedAt).toBeTruthy()
  expect(result.preparation).toBeUndefined()
  expect(result.unchanged).toEqual(result.saved)
  expect(result.errors).toHaveLength(5)
  expect(
    result.errors.every((message) => /positive whole number/.test(message))
  ).toBe(true)
  expect(result.missingErrors).toEqual([
    'Product was not found in this order',
    'Order was not found',
  ])
  expect(result.beforeRefresh).toEqual(result.saved)
  expect(result.refreshed.unitsPerCarton).toEqual({ 1: 10 })
  expect(result.refreshed.unitsPerCartonUpdatedAt).toBe(
    result.saved.unitsPerCartonUpdatedAt
  )
  expect(result.refreshed.snapshot.status).toBe('Awaiting shipment')
  expect(result.reopened).toEqual(result.refreshed)
  expect(result.fromBackup).toEqual(result.refreshed)
  expect(result.other.unitsPerCarton).toBeUndefined()
  expect(result.cleared.unitsPerCarton).toEqual({})
  expect(
    result.cleared.unitsPerCartonUpdatedAt >
      result.saved.unitsPerCartonUpdatedAt
  ).toBe(true)
  expect(result.afterOldRestore).toEqual(result.cleared)
})

test('packing capacity observations merge selected entries and preserve newer local clears', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    const { createPreparation } = await import('/src/packing-model.js')
    const { createPackingBackup } = await import('/src/packing-backup.js')
    await library.saveSnapshot(source)
    await library.savePreparation(createPreparation(source, '2026-10'))
    for (const [id, value] of [
      ['1', 10],
      ['2', 20],
      ['3', 30],
    ])
      await library.setUnitsPerCarton('1001', id, value)
    const full = await library.exportBackup()
    const scoped = createPackingBackup(full, {
      months: ['2026-10'],
      orders: [{ orderId: '1001', entryIds: ['2'] }],
    })
    const target = await openOrderDatabase({ name: `${databaseName}-partial` })
    await target.restoreBackup(scoped)
    const imported = await target.getOrder('1001')
    const cleared = await target.setUnitsPerCarton('1001', '2', null)
    await target.saveSnapshot({
      ...source,
      status: 'Awaiting shipment',
      observedAt: '2026-10-02T12:00:00.000Z',
    })
    const refreshed = await target.getOrder('1001')
    await target.restoreBackup(full)
    const completed = await target.getOrder('1001')
    await target.restoreBackup(scoped)
    const afterOlderScoped = await target.getOrder('1001')
    const newerScoped = structuredClone(scoped)
    newerScoped.orders[0].unitsPerCarton = { 2: 25 }
    newerScoped.orders[0].unitsPerCartonPartialClocks['2'] = new Date(
      Date.parse(cleared.unitsPerCartonPartialClocks['2']) + 1
    ).toISOString()
    await target.restoreBackup(newerScoped)
    const afterNewerScoped = await target.getOrder('1001')
    const roundTrip = await target.exportBackup()
    const copy = await openOrderDatabase({ name: `${databaseName}-copy` })
    await copy.restoreBackup(roundTrip)
    const copied = await copy.getOrder('1001')
    copy.close()
    target.close()
    library.close()
    return {
      full,
      scoped,
      imported,
      cleared,
      refreshed,
      completed,
      afterOlderScoped,
      afterNewerScoped,
      copied,
    }
  }, snapshot())
  const clock = result.full.orders[0].unitsPerCartonUpdatedAt
  expect(result.scoped.orders[0].unitsPerCarton).toEqual({ 2: 20 })
  expect(result.scoped.orders[0].unitsPerCartonUpdatedAt).toBeUndefined()
  expect(result.scoped.orders[0].unitsPerCartonPartialClocks).toEqual({
    2: clock,
  })
  expect(result.imported.unitsPerCarton).toEqual({ 2: 20 })
  expect(result.cleared.unitsPerCarton).toEqual({})
  expect(result.cleared.unitsPerCartonPartialClocks['2'] > clock).toBe(true)
  expect(result.refreshed.unitsPerCartonPartialClocks).toEqual(
    result.cleared.unitsPerCartonPartialClocks
  )
  expect(result.completed.unitsPerCarton).toEqual({ 1: 10, 3: 30 })
  expect(result.completed.unitsPerCartonUpdatedAt).toBe(clock)
  expect(result.completed.unitsPerCartonPartialClocks).toEqual(
    result.cleared.unitsPerCartonPartialClocks
  )
  expect(result.completed.snapshot.status).toBe('Awaiting shipment')
  expect(result.afterOlderScoped).toEqual(result.completed)
  expect(result.afterNewerScoped.unitsPerCarton).toEqual({
    1: 10,
    2: 25,
    3: 30,
  })
  expect(result.afterNewerScoped.snapshot.status).toBe('Awaiting shipment')
  expect(result.copied).toEqual(result.afterNewerScoped)
})
