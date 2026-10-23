import { test, expect } from './extension-fixture.mjs'

function snapshot(
  orderId = '1001',
  sellerMemberLogin = 'synthetic-store',
  accountId = 'local'
) {
  return {
    schemaVersion: 1,
    accountId,
    orderId,
    sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
    sellerName: 'Synthetic store',
    sellerMemberLogin,
    status: 'Completed',
    purchasedAt: '2026-10-01T12:00:00+08:00',
    observedAt: '2026-10-01T12:00:00.000Z',
    items: [
      {
        entryId: '1',
        title: 'Synthetic cup',
        description: 'Synthetic cup',
        thumbnail: 'https://cbu01.alicdn.com/synthetic-wechat.png',
        price: '10.00',
        quantity: '1',
        sourceDiscount: '0.00',
        allocatedDiscount: '0.00',
        discount: '0.00',
      },
    ],
    totals: {
      goodsGross: '10.00',
      shipping: '0.00',
      sourceDiscount: '0.00',
      orderAdjustment: '0.00',
      goodsNet: '10.00',
      payable: '10.00',
    },
  }
}
const sheet = {
  filename: '4321.xlsx',
  sheetName: 'Order',
  purchaseDate: '2026-10-01',
  total: '10.00',
  store: {
    key: 'market:4321',
    name: 'Synthetic market',
    number: '4321',
    kind: 'market',
  },
  rows: [
    {
      row: 5,
      group: '1',
      title: 'Synthetic cup',
      description: 'Synthetic cup',
      boxes: '1',
      perbox: '1',
      quantity: '1',
      price: '10.00',
      amount: '10.00',
      photos: [
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2WZ4kAAAAASUVORK5CYII=',
      ],
    },
  ],
}

async function openRepository(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async () => {
    const { openDatabase } = await import('/src/database.js')
    window.openOrderDatabase = openDatabase
    window.packingModel = await import('/src/packing-model.js')
    window.packingBackup = await import('/src/packing-backup.js')
    window.databaseName = `synthetic-wechat-${crypto.randomUUID()}`
    window.repository = await openDatabase({ name: databaseName })
  })
  return page
}

test('WeChat shares by known seller identity, isolates accounts and unknown stores, and clears without changing source data', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const source = [
    snapshot(),
    snapshot('1002'),
    snapshot('1003', 'unrelated'),
    snapshot('1004', ''),
    snapshot('1005', ''),
    snapshot('1006', 'synthetic-store', 'other-account'),
  ]
  const result = await page.evaluate(async (source) => {
    for (const order of source) await repository.saveSnapshot(order)
    const saved = await repository.setStoreWechat('1001', '  Seller_微信-123  ')
    const shared = await repository.listOrders()
    const isolated = await repository.getOrder('1006', {
      accountId: 'other-account',
    })
    await repository.setStoreWechat('1004', 'Only_this_unknown_order')
    const unknown = [
      await repository.getOrder('1004'),
      await repository.getOrder('1005'),
    ]
    const cleared = await repository.setStoreWechat('1002', '   ')
    const repeated = await repository.setStoreWechat('1002', '')
    const beforeInvalid = await repository.exportBackup()
    const errors = []
    for (const value of [123, 'x'.repeat(129)])
      try {
        await repository.setStoreWechat('1001', value)
      } catch (error) {
        errors.push(error.message)
      }
    const afterInvalid = await repository.exportBackup()
    return {
      saved,
      shared,
      isolated,
      unknown,
      cleared,
      repeated,
      beforeInvalid,
      afterInvalid,
      errors,
      final: await repository.getOrder('1001'),
    }
  }, source)
  expect(result.saved.storeWechat).toBe('Seller_微信-123')
  expect(
    result.shared
      .filter((order) => order.storeWechat)
      .map((order) => order.snapshot.orderId)
      .sort()
  ).toEqual(['1001', '1002'])
  expect(result.isolated).not.toHaveProperty('storeWechat')
  expect(result.unknown[0].storeWechat).toBe('Only_this_unknown_order')
  expect(result.unknown[1]).not.toHaveProperty('storeWechat')
  expect(result.cleared).not.toHaveProperty('storeWechat')
  expect(result.final).not.toHaveProperty('storeWechat')
  expect(result.repeated.storeWechatUpdatedAt).toBe(
    result.cleared.storeWechatUpdatedAt
  )
  expect(result.saved.snapshot).toEqual(source[0])
  expect(result.saved.revision).toBe(1)
  expect(result.afterInvalid.orders).toEqual(result.beforeInvalid.orders)
  expect(result.errors).toEqual([
    'WeChat ID must be text',
    'WeChat ID must be 128 characters or fewer',
  ])
})

test('market and factory orders share WeChat independently and new orders inherit the saved contact', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(
    async ({ sheet, native }) => {
      const first = await repository.importStoreOrder(sheet)
      const second = await repository.importStoreOrder(sheet)
      const factoryInput = {
        ...sheet,
        filename: 'Synthetic company.xlsx',
        store: {
          key: 'factory:synthetic',
          name: 'Synthetic company',
          number: '',
          kind: 'factory',
        },
      }
      const factory = await repository.importStoreOrder(factoryInput)
      const secondFactory = await repository.importStoreOrder(factoryInput)
      await repository.saveSnapshot(native)
      await repository.setStoreWechat(first.snapshot.orderId, 'Market_contact')
      await repository.setStoreWechat(
        factory.snapshot.orderId,
        'Factory_contact'
      )
      await repository.renameStore(first.snapshot.orderId, 'Renamed market')
      const later = await repository.importStoreOrder({
        ...sheet,
        store: { ...sheet.store, name: 'Renamed market' },
      })
      return {
        first: await repository.getOrder(first.snapshot.orderId),
        second: await repository.getOrder(second.snapshot.orderId),
        factory: await repository.getOrder(factory.snapshot.orderId),
        secondFactory: await repository.getOrder(
          secondFactory.snapshot.orderId
        ),
        native: await repository.getOrder(native.orderId),
        later,
      }
    },
    { sheet, native: snapshot('1007', 'market:4321') }
  )
  for (const key of ['first', 'second', 'later'])
    expect(result[key].storeWechat).toBe('Market_contact')
  for (const key of ['factory', 'secondFactory'])
    expect(result[key].storeWechat).toBe('Factory_contact')
  expect(result.native).not.toHaveProperty('storeWechat')
  expect(result.first.snapshot.sellerName).toBe('Renamed market')
})

test('1688 refreshes preserve WeChat while new same-seller purchases inherit it', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(async (source) => {
    await repository.saveSnapshot(source)
    const saved = await repository.setStoreWechat(
      source.orderId,
      'Saved_contact'
    )
    const refreshed = await repository.saveSnapshot({
      ...source,
      status: 'Awaiting delivery',
      observedAt: '2026-10-02T12:00:00.000Z',
    })
    const next = {
      ...source,
      orderId: '1010',
      sourceUrl:
        'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1010',
    }
    const added = await repository.saveSnapshot(next)
    return { saved, refreshed, added }
  }, snapshot())
  expect(result.refreshed.order.storeWechat).toBe('Saved_contact')
  expect(result.refreshed.order.storeWechatUpdatedAt).toBe(
    result.saved.storeWechatUpdatedAt
  )
  expect(result.refreshed.order.snapshot.status).toBe('Awaiting delivery')
  expect(result.added.order.storeWechat).toBe('Saved_contact')
})

test('full and packing backups preserve contacts, propagate by store and keep newer clears', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(async (source) => {
    await repository.saveSnapshot(source)
    await repository.setStoreWechat(source.orderId, 'Backed_up_contact')
    await repository.savePreparation(
      packingModel.createPreparation(source, '2026-10')
    )
    const full = await repository.exportBackup()
    const scoped = packingBackup.createPackingBackup(full, {
      months: ['2026-10'],
      orders: [
        { orderId: source.orderId, accountId: 'local', entryIds: ['1'] },
      ],
    })
    const target = await openOrderDatabase({ name: `${databaseName}-target` })
    const sibling = {
      ...source,
      orderId: '1011',
      sourceUrl:
        'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1011',
    }
    await target.saveSnapshot(sibling)
    await target.restoreBackup(scoped)
    const shared = await target.getOrder('1011')
    const restored = await target.getOrder(source.orderId)
    const cleared = await target.setStoreWechat(source.orderId, '')
    await target.restoreBackup(full)
    const afterOlder = await target.getOrder(source.orderId)
    const afterOlderSibling = await target.getOrder('1011')
    const clearedBackup = await target.exportBackup()
    const copy = await openOrderDatabase({ name: `${databaseName}-copy` })
    await copy.restoreBackup(full)
    await copy.restoreBackup(clearedBackup)
    await copy.restoreBackup(full)
    const copied = await copy.getOrder(source.orderId)
    target.close()
    copy.close()
    return {
      full,
      scoped,
      shared,
      restored,
      cleared,
      afterOlder,
      afterOlderSibling,
      copied,
    }
  }, snapshot())
  expect(result.full.orders[0].storeWechat).toBe('Backed_up_contact')
  expect(result.scoped.orders[0].storeWechat).toBe('Backed_up_contact')
  expect(result.shared.storeWechat).toBe('Backed_up_contact')
  expect(result.restored.storeWechat).toBe('Backed_up_contact')
  for (const key of ['cleared', 'afterOlder', 'afterOlderSibling', 'copied'])
    expect(result[key]).not.toHaveProperty('storeWechat')
  expect(result.afterOlder.storeWechatUpdatedAt).toBe(
    result.cleared.storeWechatUpdatedAt
  )
  expect(result.copied.storeWechatUpdatedAt).toBe(
    result.cleared.storeWechatUpdatedAt
  )
})

test('tied conflicting WeChat backup edits abort the restore atomically', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(async (source) => {
    await repository.saveSnapshot(source)
    await repository.setStoreWechat(source.orderId, 'Current_contact')
    const before = await repository.exportBackup()
    const conflicting = structuredClone(before)
    conflicting.orders[0].storeWechat = 'Different_contact'
    let error
    try {
      await repository.restoreBackup(conflicting)
    } catch (failure) {
      error = failure.message
    }
    const after = await repository.exportBackup()
    return { before, after, error }
  }, snapshot())
  expect(result.error).toBe(
    'Backup conflict: WeChat IDs have the same timestamp'
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
