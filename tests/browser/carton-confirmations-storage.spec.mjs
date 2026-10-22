import { test, expect } from './extension-fixture.mjs'

function snapshot(accountId = 'local') {
  return {
    schemaVersion: 1,
    accountId,
    orderId: '1001',
    sourceUrl:
      'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1001',
    sellerName: 'Synthetic confirmation supplier',
    sellerMemberLogin: 'synthetic-confirmation-supplier',
    status: 'Completed',
    observedAt: '2026-10-01T12:00:00.000Z',
    items: ['Cup', 'Bowl', 'Plate'].map((title, index) => ({
      entryId: String(index + 1),
      title,
      description: title,
      thumbnail: '',
      price: '10.00',
      quantity: '10',
      sourceDiscount: '0.00',
      allocatedDiscount: '0.00',
      discount: '0.00',
    })),
    totals: {
      goodsGross: '300.00',
      shipping: '0.00',
      sourceDiscount: '0.00',
      orderAdjustment: '0.00',
      goodsNet: '300.00',
      payable: '300.00',
    },
  }
}

async function databasePage(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async () => {
    window.openOrderDatabase = (await import('/src/database.js')).openDatabase
    window.databaseName = `synthetic-confirmations-${crypto.randomUUID()}`
    window.library = await openOrderDatabase({ name: databaseName })
  })
  return page
}

test('monthly carton confirmations persist, preserve zero and clears, survive source refresh and full restore', async ({
  extension,
}) => {
  const page = await databasePage(extension)
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    await library.saveSnapshot({ ...source, accountId: 'other-account' })
    const saved = await library.setCartonConfirmation(
      '1001',
      '1',
      '2026-10',
      'received',
      0
    )
    const unchanged = await library.setCartonConfirmation(
      '1001',
      '1',
      '2026-10',
      'received',
      '0'
    )
    await library.setCartonConfirmation('1001', '1', '2026-10', 'loaded', 3)
    await library.setCartonConfirmation('1001', '1', '2026-11', 'received', 8)
    const errors = []
    for (const [id, month, field, value] of [
      ['1', '2026-10', 'received', -1],
      ['1', '2026-10', 'received', 1.5],
      ['1', '2026-10', 'loaded', '1e2'],
      ['1', '2026-10', 'loaded', '9007199254740993'],
      ['99', '2026-10', 'received', 1],
      ['1', '2026-00', 'received', 1],
      ['1', '2026-10', 'planned', 1],
    ]) {
      try {
        await library.setCartonConfirmation('1001', id, month, field, value)
      } catch (error) {
        errors.push(error.message)
      }
    }
    const beforeRefresh = await library.getOrder('1001')
    await library.saveSnapshot({
      ...source,
      status: 'Awaiting shipment',
      observedAt: '2026-10-02T12:00:00.000Z',
    })
    const refreshed = await library.getOrder('1001')
    library.close()
    window.library = await openOrderDatabase({ name: databaseName })
    const reopened = await library.getOrder('1001')
    const backup = await library.exportBackup()
    const target = await openOrderDatabase({ name: `${databaseName}-restored` })
    await target.restoreBackup(backup)
    const restored = await target.getOrder('1001')
    await target.setCartonConfirmation('1001', '1', '2026-10', 'received', '')
    const cleared = await target.setCartonConfirmation(
      '1001',
      '1',
      '2026-10',
      'loaded',
      null
    )
    await target.restoreBackup(backup)
    const afterOldRestore = await target.getOrder('1001')
    const other = await target.getOrder('1001', { accountId: 'other-account' })
    const roundTrip = await target.exportBackup()
    const copy = await openOrderDatabase({ name: `${databaseName}-copy` })
    await copy.restoreBackup(roundTrip)
    const copied = await copy.getOrder('1001')
    copy.close()
    target.close()
    library.close()
    return {
      saved,
      unchanged,
      errors,
      beforeRefresh,
      refreshed,
      reopened,
      restored,
      cleared,
      afterOldRestore,
      other,
      copied,
    }
  }, snapshot())
  expect(result.saved.cartonConfirmations).toEqual({
    1: { '2026-10': { received: 0 } },
  })
  expect(result.unchanged).toEqual(result.saved)
  expect(result.errors).toHaveLength(7)
  expect(result.beforeRefresh.cartonConfirmations).toEqual({
    1: { '2026-10': { received: 0, loaded: 3 }, '2026-11': { received: 8 } },
  })
  expect(result.refreshed.cartonConfirmations).toEqual(
    result.beforeRefresh.cartonConfirmations
  )
  expect(result.refreshed.cartonConfirmationClocks).toEqual(
    result.beforeRefresh.cartonConfirmationClocks
  )
  expect(result.reopened).toEqual(result.refreshed)
  expect(result.restored).toEqual(result.refreshed)
  expect(result.cleared.cartonConfirmations).toEqual({
    1: { '2026-11': { received: 8 } },
  })
  expect(result.afterOldRestore).toEqual(result.cleared)
  expect(result.other.cartonConfirmations).toBeUndefined()
  expect(result.copied).toEqual(result.cleared)
})

test('scoped confirmation restore observes only selected products and months without overwriting other accounts', async ({
  extension,
}) => {
  const page = await databasePage(extension)
  const result = await page.evaluate(async (source) => {
    const { createPreparation } = await import('/src/packing-model.js')
    const { createPackingBackup } = await import('/src/packing-backup.js')
    await library.saveSnapshot(source)
    await library.savePreparation(createPreparation(source, '2026-10'))
    await library.setCartonConfirmation('1001', '2', '2026-10', 'received', 4)
    await library.setCartonConfirmation('1001', '2', '2026-11', 'received', 6)
    await library.setCartonConfirmation('1001', '3', '2026-10', 'received', 5)
    const full = await library.exportBackup()
    const scoped = createPackingBackup(full, {
      months: ['2026-10'],
      orders: [{ orderId: '1001', entryIds: ['2'] }],
    })
    const target = await openOrderDatabase({ name: `${databaseName}-target` })
    await target.saveSnapshot(source)
    await target.saveSnapshot({ ...source, accountId: 'other-account' })
    await target.setCartonConfirmation('1001', '1', '2026-10', 'loaded', 7)
    await target.setCartonConfirmation('1001', '2', '2026-11', 'received', 9)
    const other = await target.setCartonConfirmation(
      '1001',
      '2',
      '2026-10',
      'received',
      10,
      { accountId: 'other-account' }
    )
    await target.restoreBackup(scoped)
    const restored = await target.getOrder('1001')
    const otherAfter = await target.getOrder('1001', {
      accountId: 'other-account',
    })
    const cleared = await target.setCartonConfirmation(
      '1001',
      '2',
      '2026-10',
      'received',
      ''
    )
    await target.restoreBackup(full)
    const completed = await target.getOrder('1001')
    await target.restoreBackup(scoped)
    const repeated = await target.getOrder('1001')
    target.close()
    library.close()
    return {
      full,
      scoped,
      restored,
      other,
      otherAfter,
      cleared,
      completed,
      repeated,
    }
  }, snapshot())
  expect(result.scoped.orders[0].cartonConfirmations).toEqual({
    2: { '2026-10': { received: 4 } },
  })
  expect(Object.keys(result.scoped.orders[0].cartonConfirmationClocks)).toEqual(
    ['2']
  )
  expect(
    Object.keys(result.scoped.orders[0].cartonConfirmationClocks['2'])
  ).toEqual(['2026-10'])
  expect(result.restored.cartonConfirmations).toEqual({
    1: { '2026-10': { loaded: 7 } },
    2: { '2026-10': { received: 4 }, '2026-11': { received: 9 } },
  })
  expect(result.otherAfter).toEqual(result.other)
  expect(result.completed.cartonConfirmations).toEqual({
    1: { '2026-10': { loaded: 7 } },
    2: { '2026-11': { received: 9 } },
    3: { '2026-10': { received: 5 } },
  })
  expect(result.repeated).toEqual(result.completed)
  expect(result.completed.cartonConfirmationClocks['2']['2026-10']).toBe(
    result.cleared.cartonConfirmationClocks['2']['2026-10']
  )
})

test('shared supplier rows save one confirmation owner and partial-variant backups carry none', async ({
  extension,
}) => {
  const page = await databasePage(extension)
  const result = await page.evaluate(async () => {
    const { createPreparation } = await import('/src/packing-model.js')
    const { createPackingBackup } = await import('/src/packing-backup.js')
    const input = {
      filename: '4321.xlsx',
      sheetName: 'Order',
      purchaseDate: '2026-10-01',
      store: {
        key: 'market:4321',
        name: 'Synthetic shared carton store',
        number: '4321',
        kind: 'market',
      },
      total: '100.00',
      rows: [
        {
          row: 5,
          group: '1',
          description: 'Synthetic assortment',
          boxes: 2,
          perbox: 5,
          quantity: 10,
          price: '10.00',
          amount: '100.00',
          photos: ['data:image/png;base64,AQID'],
          variants: [{ variant: 'A' }, { variant: 'B' }],
          variantAllocations: [
            { variant: 'A', quantity: 3 },
            { variant: 'B', quantity: 7 },
          ],
        },
      ],
    }
    const first = await library.importStoreOrder(input)
    const orderId = first.snapshot.orderId
    const saved = await library.setCartonConfirmation(
      orderId,
      '2',
      '2026-10',
      'received',
      2
    )
    await library.setCartonConfirmation(orderId, '1', '2026-10', 'loaded', 1)
    await library.savePreparation(createPreparation(saved.snapshot, '2026-10'))
    const second = await library.importStoreOrder(input)
    const backup = await library.exportBackup()
    const scope = (ids) => ({
      months: ['2026-10'],
      orders: [{ orderId, entryIds: ids }],
    })
    const partial = createPackingBackup(backup, scope(['2']))
    const complete = createPackingBackup(backup, scope(['1', '2']))
    const target = await openOrderDatabase({ name: `${databaseName}-target` })
    await target.restoreBackup(complete)
    const restored = await target.getOrder(orderId)
    target.close()
    library.close()
    return { saved, second, partial, complete, restored }
  })
  expect(result.saved.cartonConfirmations).toEqual({
    1: { '2026-10': { received: 2 } },
  })
  expect(result.partial.orders[0].cartonConfirmations).toEqual({})
  expect(result.partial.orders[0].cartonConfirmationClocks).toEqual({})
  expect(result.complete.orders[0].cartonConfirmations).toEqual({
    1: { '2026-10': { received: 2, loaded: 1 } },
  })
  expect(result.restored.cartonConfirmations).toEqual(
    result.complete.orders[0].cartonConfirmations
  )
  expect(result.second.cartonConfirmations).toBeUndefined()
})
