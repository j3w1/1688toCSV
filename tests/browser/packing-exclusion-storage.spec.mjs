import { test, expect } from './extension-fixture.mjs'

const orderId = '1234567890123456789'
function snapshot() {
  return {
    schemaVersion: 1,
    accountId: 'local',
    orderId,
    sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
    sellerName: 'Synthetic packing exclusions',
    sellerMemberLogin: 'synthetic-packing-exclusions',
    status: 'Completed',
    observedAt: '2026-10-01T12:00:00.000Z',
    items: ['Cup', 'Bowl', 'Box'].map((title, index) => ({
      entryId: String(index + 1),
      thumbnail: `https://cbu01.alicdn.com/exclusion-${index}.png`,
      title,
      description: title,
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

async function openTestDatabase(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async () => {
    const { openDatabase } = await import('/src/database.js')
    window.openOrderDatabase = openDatabase
    window.packingModel = await import('/src/packing-model.js')
    window.packingBackup = await import('/src/packing-backup.js')
    window.databaseName = `synthetic-packing-exclusions-${crypto.randomUUID()}`
    window.library = await openDatabase({ name: databaseName })
  })
  return page
}

test('packing exclusions commit metadata only, persist across reopen and leave no-op edit clocks untouched', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    await library.setNotes(source.orderId, {
      notes: 'Keep this note',
      tags: ['Keep tag'],
    })
    await library.setProductTags(source.orderId, '1', ['Fragile'])
    await library.savePreparation(
      packingModel.createPreparation(source, '2026-10')
    )
    const before = await library.exportBackup()
    const alreadyIncluded = await library.setPackingExcluded(
      source.orderId,
      ['1'],
      false
    )
    const skipped = await library.setPackingExcluded(
      source.orderId,
      ['1', '2'],
      true
    )
    const repeat = await library.setPackingExcluded(
      source.orderId,
      ['2', '1'],
      true
    )
    const empty = await library.setPackingExcluded(source.orderId, [], true)
    const included = await library.setPackingExcluded(
      source.orderId,
      ['1'],
      false
    )
    const committed = await library.getOrder(source.orderId)
    const after = await library.exportBackup()
    library.close()
    window.library = await openOrderDatabase({ name: databaseName })
    return {
      before,
      alreadyIncluded,
      skipped,
      repeat,
      empty,
      included,
      committed,
      after,
      reopened: await library.getOrder(source.orderId),
    }
  }, snapshot())
  expect(result.alreadyIncluded).toEqual(result.before.orders[0])
  expect(result.skipped.packingExcludedEntryIds).toEqual(['1', '2'])
  expect(result.repeat).toEqual(result.skipped)
  expect(result.empty).toEqual(result.skipped)
  expect(result.included.packingExcludedEntryIds).toEqual(['2'])
  expect(
    result.included.packingExclusionsUpdatedAt >
      result.skipped.packingExclusionsUpdatedAt
  ).toBe(true)
  expect(result.included).toEqual(result.committed)
  expect(result.reopened).toEqual(result.committed)
  const { packingExcludedEntryIds, packingExclusionsUpdatedAt, ...unchanged } =
    result.committed
  expect(packingExcludedEntryIds).toEqual(['2'])
  expect(packingExclusionsUpdatedAt).toBeTruthy()
  expect(unchanged).toEqual(result.before.orders[0])
  for (const key of [
    'preparations',
    'allocations',
    'issuedCodes',
    'history',
    'images',
    'packingPreferences',
  ])
    expect(result.after[key]).toEqual(result.before[key])
})

test('source refresh preserves excluded absent rows, supports reinclude after removal and restores choices on reappearance', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    const skipped = await library.setPackingExcluded(
      source.orderId,
      ['1', '2'],
      true
    )
    const missing = structuredClone(source)
    missing.observedAt = '2026-10-02T12:00:00.000Z'
    missing.items = missing.items.slice(2)
    for (const key of ['goodsGross', 'goodsNet', 'payable'])
      missing.totals[key] = '10.00'
    const refreshed = (await library.saveSnapshot(missing)).order
    const included = await library.setPackingExcluded(
      source.orderId,
      ['2'],
      false
    )
    let absentError
    try {
      await library.setPackingExcluded(source.orderId, ['2'], true)
    } catch (error) {
      absentError = error.message
    }
    const reappeared = (
      await library.saveSnapshot({
        ...source,
        observedAt: '2026-10-03T12:00:00.000Z',
      })
    ).order
    return { skipped, refreshed, included, absentError, reappeared }
  }, snapshot())
  expect(result.refreshed.packingExcludedEntryIds).toEqual(['1', '2'])
  expect(result.refreshed.packingExclusionsUpdatedAt).toBe(
    result.skipped.packingExclusionsUpdatedAt
  )
  expect(result.included.packingExcludedEntryIds).toEqual(['1'])
  expect(result.absentError).toMatch(/Product was not found/)
  expect(result.reappeared.packingExcludedEntryIds).toEqual(['1'])
  expect(result.reappeared.packingExclusionsUpdatedAt).toBe(
    result.included.packingExclusionsUpdatedAt
  )
  expect(result.reappeared.snapshot.items).toEqual(snapshot().items)
})

test('invalid or failed exclusion writes are atomic and concurrent connections retain both choices', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    const before = await library.getOrder(source.orderId)
    const errors = []
    for (const [ids, excluded] of [
      [['1', '999'], true],
      [['1', '1'], true],
      [['0'], true],
      ['1', true],
      [['1'], 'yes'],
    ]) {
      try {
        await library.setPackingExcluded(source.orderId, ids, excluded)
      } catch (error) {
        errors.push(error.message)
      }
    }
    const afterInvalid = await library.getOrder(source.orderId)
    const concurrent = await openOrderDatabase({ name: databaseName })
    await Promise.all([
      library.setPackingExcluded(source.orderId, ['1'], true),
      concurrent.setPackingExcluded(source.orderId, ['2'], true),
    ])
    concurrent.close()
    const combined = await library.getOrder(source.orderId)
    const put = IDBObjectStore.prototype.put
    let failure
    try {
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'orders')
          throw new DOMException(
            'Synthetic exclusion write failure',
            'QuotaExceededError'
          )
        return put.apply(this, args)
      }
      await library.setPackingExcluded(source.orderId, ['1', '2'], false)
    } catch (error) {
      failure = error.message
    } finally {
      IDBObjectStore.prototype.put = put
    }
    return {
      before,
      errors,
      afterInvalid,
      combined,
      failure,
      afterFailure: await library.getOrder(source.orderId),
    }
  }, snapshot())
  expect(result.errors).toHaveLength(5)
  expect(result.afterInvalid).toEqual(result.before)
  expect(result.combined.packingExcludedEntryIds.toSorted()).toEqual(['1', '2'])
  expect(result.failure).toMatch(/Synthetic exclusion write failure/)
  expect(result.afterFailure).toEqual(result.combined)
})

test('full backups merge exclusion clocks independently of source age and preserve a newer clear against old or legacy backups', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    const legacy = await library.exportBackup()
    await library.setPackingExcluded(source.orderId, ['1'], true)
    const skippedBackup = await library.exportBackup()
    const target = await openOrderDatabase({ name: `${databaseName}-restored` })
    await target.restoreBackup(skippedBackup)
    const restored = await target.getOrder(source.orderId)
    const cleared = await target.setPackingExcluded(
      source.orderId,
      ['1'],
      false
    )
    await target.restoreBackup(skippedBackup)
    await target.restoreBackup(legacy)
    const afterOld = await target.getOrder(source.orderId)
    await target.saveSnapshot({
      ...source,
      observedAt: '2026-10-04T12:00:00.000Z',
    })
    const newer = structuredClone(skippedBackup)
    newer.orders[0].packingExcludedEntryIds = ['2', '999']
    newer.orders[0].packingExclusionsUpdatedAt = new Date(
      Date.parse(cleared.packingExclusionsUpdatedAt) + 1000
    ).toISOString()
    await target.restoreBackup(newer)
    const afterNew = await target.getOrder(source.orderId)
    const tied = structuredClone(newer)
    tied.orders[0].packingExcludedEntryIds = ['3']
    await target.restoreBackup(tied)
    const afterTie = await target.getOrder(source.orderId)
    const invalid = structuredClone(newer)
    invalid.orders[0].packingExcludedEntryIds = ['1', '1']
    let invalidError
    try {
      await target.restoreBackup(invalid)
    } catch (error) {
      invalidError = error.message
    }
    const malformed = structuredClone(newer)
    malformed.orders[0].packingExclusionsUpdatedAt = 'yesterday'
    let timestampError
    try {
      await target.restoreBackup(malformed)
    } catch (error) {
      timestampError = error.message
    }
    const afterInvalid = await target.getOrder(source.orderId)
    target.close()
    return {
      skippedBackup,
      restored,
      cleared,
      afterOld,
      newer,
      afterNew,
      afterTie,
      invalidError,
      timestampError,
      afterInvalid,
    }
  }, snapshot())
  expect(result.restored.packingExcludedEntryIds).toEqual(['1'])
  expect(result.restored.packingExclusionsUpdatedAt).toBe(
    result.skippedBackup.orders[0].packingExclusionsUpdatedAt
  )
  expect(result.afterOld).toEqual(result.cleared)
  expect(result.afterNew.packingExcludedEntryIds).toEqual(['2', '999'])
  expect(result.afterNew.packingExclusionsUpdatedAt).toBe(
    result.newer.orders[0].packingExclusionsUpdatedAt
  )
  expect(result.afterNew.snapshot.observedAt).toBe('2026-10-04T12:00:00.000Z')
  expect(result.afterTie).toEqual(result.afterNew)
  expect(result.invalidError).toMatch(/duplicate/)
  expect(result.timestampError).toMatch(/date|timestamp/i)
  expect(result.afterInvalid).toEqual(result.afterNew)
})

test('scoped packing backups carry exclusions into missing orders but preserve existing local choices', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    await library.savePreparation(
      packingModel.createPreparation(source, '2026-10')
    )
    await library.setPackingExcluded(source.orderId, ['1'], true)
    const full = await library.exportBackup({ orderIds: [source.orderId] })
    const scoped = packingBackup.createPackingBackup(full, {
      months: ['2026-10'],
      orders: [
        { accountId: 'local', orderId: source.orderId, entryIds: ['1'] },
      ],
    })
    const fresh = await openOrderDatabase({
      name: `${databaseName}-scoped-fresh`,
    })
    await fresh.restoreBackup(scoped)
    const imported = await fresh.getOrder(source.orderId)
    fresh.close()
    const existing = await openOrderDatabase({
      name: `${databaseName}-scoped-existing`,
    })
    await existing.restoreBackup(full)
    const local = await existing.setPackingExcluded(
      source.orderId,
      ['1'],
      false
    )
    scoped.orders[0].packingExcludedEntryIds = ['1']
    scoped.orders[0].packingExclusionsPartialClocks = {
      1: new Date(
        Date.parse(local.packingExclusionsUpdatedAt) + 1000
      ).toISOString(),
    }
    const before = await existing.exportBackup()
    await existing.restoreBackup(scoped)
    const after = await existing.exportBackup()
    existing.close()
    return { full, imported, local, before, after }
  }, snapshot())
  expect(result.full.orders[0].packingExcludedEntryIds).toEqual(['1'])
  expect(result.imported.packingExcludedEntryIds).toEqual(['1'])
  expect(result.imported.packingExclusionsUpdatedAt).toBeUndefined()
  expect(result.imported.packingExclusionsPartialClocks).toEqual({
    1: result.full.orders[0].packingExclusionsUpdatedAt,
  })
  expect(result.after.orders[0].packingExcludedEntryIds).toEqual([])
  expect(result.after.orders[0].packingExclusionsUpdatedAt).toBe(
    result.local.packingExclusionsUpdatedAt
  )
  expect(result.after.preparations).toEqual(result.before.preparations)
  expect(result.after.issuedCodes).toEqual(result.before.issuedCodes)
})
