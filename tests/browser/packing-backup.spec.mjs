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
