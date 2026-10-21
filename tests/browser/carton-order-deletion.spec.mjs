import { test, expect } from './extension-fixture.mjs'

function snapshot(orderId, accountId = 'local') {
  return {
    schemaVersion: 1,
    accountId,
    orderId,
    sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
    sellerName: 'Synthetic carton deletion supplier',
    sellerMemberLogin: 'synthetic-carton-deletion',
    status: 'Completed',
    observedAt: '2026-10-01T12:00:00.000Z',
    items: [
      {
        entryId: '1',
        title: 'Synthetic carton product',
        description: 'Synthetic carton product',
        thumbnail: '',
        price: '1.00',
        quantity: '3',
        sourceDiscount: '0.00',
        allocatedDiscount: '0.00',
        discount: '0.00',
      },
    ],
    totals: {
      goodsGross: '3.00',
      shipping: '0.00',
      sourceDiscount: '0.00',
      orderAdjustment: '0.00',
      goodsNet: '3.00',
      payable: '3.00',
    },
  }
}

async function setup(extension, reference = 'contents') {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(
    async ({ sources, reference }) => {
      const { openDatabase, validateBackup } = await import('/src/database.js'),
        { createPreparation } = await import('/src/packing-model.js'),
        { validateCartonBatch } = await import('/src/carton-batches.js'),
        { repeatProductStoreIdentity } = await import('/src/repeat-products.js')
      window.databaseName = `synthetic-carton-deletion-${crypto.randomUUID()}`
      window.library = await openDatabase({ name: databaseName })
      const preparations = []
      for (const source of sources) {
        await library.saveSnapshot(source)
        preparations.push(
          await library.savePreparation(createPreparation(source, '2026-10'))
        )
      }
      await library.saveSnapshot({
        ...sources[0],
        observedAt: '2026-10-02T12:00:00.000Z',
        status: 'Shipped',
      })
      const owner =
          reference === 'other-account' ? 3 : reference === 'contents' ? 0 : 1,
        content = sources[owner],
        group = (index) => ({
          orderId: sources[index].orderId,
          groupId: preparations[index].groups[0].id,
        }),
        batch = validateCartonBatch({
          id: 'synthetic-active-carton',
          accountId: content.accountId,
          storeId: repeatProductStoreIdentity(content),
          month: '2026-10',
          groups:
            reference === 'groups' ? [group(0), group(owner)] : [group(owner)],
          mark: reference === 'mark' ? group(0) : group(owner),
          contents: [{ orderId: content.orderId, entryId: '1', quantity: '3' }],
          count: 1,
          len: '40',
          wid: '30',
          ht: '25',
          weightBasis: 'carton',
          weight: '9.5',
          received: 1,
          loaded: 0,
          revision: 0,
          updatedAt: new Date().toISOString(),
          ...(['groups', 'mark'].includes(reference)
            ? { needsReview: true }
            : {}),
        })
      if (batch.needsReview) {
        // Retained review evidence can reference an old owning group or mark.
        // Restore validates the actual source/store/quantity evidence normally.
        const backup = await library.exportBackup()
        backup.cartonBatches.push(batch)
        validateBackup(backup)
        await library.restoreBackup(backup)
      } else await library.saveCartonBatch(batch)
    },
    {
      sources: [
        snapshot('1001'),
        snapshot('1002'),
        snapshot('1003'),
        snapshot('1001', 'other-account'),
      ],
      reference,
    }
  )
  return page
}

for (const reference of ['contents', 'groups', 'mark']) {
  test(`active carton ${reference} references reject an entire order deletion atomically`, async ({
    extension,
  }) => {
    const page = await setup(extension, reference)
    const result = await page.evaluate(async () => {
      const before = await library.exportBackup()
      let error
      try {
        await library.removeOrders(['1003', '1001'])
      } catch (failure) {
        error = failure.message
      }
      const after = await library.exportBackup()
      return { before, after, error }
    })
    expect(result.error).toBe(
      'Remove this order’s active carton batches before deleting it.'
    )
    expect({ ...result.after, exportedAt: '' }).toEqual({
      ...result.before,
      exportedAt: '',
    })
    expect(result.after.orders).toHaveLength(4)
    expect(result.after.history).toHaveLength(1)
    expect(result.after.cartonBatches).toHaveLength(1)
    const batch = result.after.cartonBatches[0]
    if (reference === 'mark') {
      expect(batch.contents.every((item) => item.orderId !== '1001')).toBe(true)
      expect(batch.groups.every((group) => group.orderId !== '1001')).toBe(true)
      expect(batch.mark.orderId).toBe('1001')
    }
    if (reference === 'groups') {
      expect(batch.contents.every((item) => item.orderId !== '1001')).toBe(true)
      expect(batch.mark.orderId).not.toBe('1001')
      expect(batch.groups.some((group) => group.orderId === '1001')).toBe(true)
    }
  })
}

for (const reference of ['other-order', 'other-account']) {
  test(`active cartons from an ${reference} do not block deleting an unrelated source`, async ({
    extension,
  }) => {
    const page = await setup(extension, reference)
    const result = await page.evaluate(async (reference) => {
      const { validateBackup } = await import('/src/database.js'),
        accountId = reference === 'other-account' ? 'other-account' : 'local',
        before = await library.listCartonBatches({
          accountId,
          includeDeleted: true,
        })
      await library.removeOrders(['1001'])
      const after = await library.listCartonBatches({
          accountId,
          includeDeleted: true,
        }),
        localBackup = await library.exportBackup(),
        otherBackup = await library.exportBackup({ accountId: 'other-account' })
      validateBackup(localBackup)
      validateBackup(otherBackup)
      return {
        before,
        after,
        local: await library.listOrders(),
        other: await library.getOrder('1001', { accountId: 'other-account' }),
      }
    }, reference)
    expect(result.after).toEqual(result.before)
    expect(result.local.map((record) => record.snapshot.orderId)).toEqual([
      '1002',
      '1003',
    ])
    expect(result.other.snapshot.accountId).toBe('other-account')
  })
}

test('explicit carton cleanup permits source deletion while preserving its tombstone and valid backups', async ({
  extension,
}) => {
  const page = await setup(extension)
  const result = await page.evaluate(async () => {
    const { openDatabase, validateBackup } = await import('/src/database.js'),
      [active] = await library.listCartonBatches()
    await library.removeCartonBatch(active)
    const retired = await library.listCartonBatches({ includeDeleted: true })
    await library.removeOrders(['1001'])
    const backup = await library.exportBackup(),
      retained = await library.listCartonBatches({ includeDeleted: true })
    validateBackup(backup)
    const restored = await openDatabase({ name: `${databaseName}-restored` })
    await restored.restoreBackup(backup)
    const roundtrip = await restored.exportBackup()
    validateBackup(roundtrip)
    restored.close()
    return {
      retired,
      retained,
      backup,
      roundtrip,
      active: await library.listCartonBatches(),
    }
  })
  expect(result.retired[0].deletedAt).toBeTruthy()
  expect(result.retained).toEqual(result.retired)
  expect(result.active).toEqual([])
  expect(
    result.backup.orders.map(({ snapshot }) => [
      snapshot.accountId,
      snapshot.orderId,
    ])
  ).toEqual([
    ['local', '1002'],
    ['local', '1003'],
    ['other-account', '1001'],
  ])
  expect(result.backup.history).toEqual([])
  expect(result.backup.cartonBatches).toEqual(result.retired)
  expect(result.roundtrip.cartonBatches).toEqual(result.retired)
})
