import { test, expect } from './extension-fixture.mjs'

function snapshots() {
  return [3, 27].map((quantity, index) => {
    const orderId = String(9701 + index)
    return {
      schemaVersion: 1,
      accountId: 'local',
      orderId,
      sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
      sellerName: 'Synthetic scoped carton supplier',
      sellerMemberLogin: 'synthetic-scoped-cartons',
      status: 'Completed',
      observedAt: '2026-10-15T00:00:00.000Z',
      purchasedAt: '2026-10-12T08:00:00+08:00',
      items: [
        {
          entryId: '1',
          title: 'Cup',
          description: 'Red cup',
          thumbnail: '',
          price: '1.00',
          quantity: String(quantity),
          skuProperties: [{ label: '颜色', value: '红色' }],
          sourceDiscount: '0.00',
          allocatedDiscount: '0.00',
          discount: '0.00',
        },
      ],
      totals: {
        goodsGross: `${quantity}.00`,
        shipping: '0.00',
        sourceDiscount: '0.00',
        orderAdjustment: '0.00',
        goodsNet: `${quantity}.00`,
        payable: `${quantity}.00`,
      },
    }
  })
}

async function seed(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async (sources) => {
    const { openDatabase } = await import('/src/database.js')
    const { createPreparation } = await import('/src/packing-model.js')
    window.lib = await openDatabase({
      name: `scoped-cartons-${crypto.randomUUID()}`,
    })
    for (const source of sources) await lib.saveSnapshot(source)
    const preps = await lib.savePreparations(
      sources.map((source) => createPreparation(source, '2026-10'))
    )
    const refs = preps.map((prep) => ({
      accountId: 'local',
      orderId: prep.orderId,
      groupId: prep.groups[0].id,
    }))
    await lib.linkRepeatProduct(
      await lib.previewRepeatProductLink({ source: refs[1], target: refs[0] })
    )
    await lib.saveCartonBatch(
      {
        id: 'synthetic-cross-purchase-carton',
        accountId: 'local',
        month: '2026-10',
        storeId: '["1688","synthetic-scoped-cartons"]',
        groups: refs.map(({ orderId, groupId }) => ({ orderId, groupId })),
        mark: { orderId: refs[0].orderId, groupId: refs[0].groupId },
        contents: sources.map((source) => ({
          orderId: source.orderId,
          entryId: '1',
          quantity: source.items[0].quantity,
        })),
        cartonNumber: '1',
        count: 1,
        len: '40',
        wid: '30',
        ht: '25',
        weightBasis: 'carton',
        weight: '9.5',
        received: 1,
        loaded: 0,
      },
      { expectedRevision: 0 }
    )
  }, snapshots())
  return page
}

test('atomic scoped export reports a cross-purchase carton before clipping its missing purchase', async ({
  extension,
}) => {
  const page = await seed(extension)
  const result = await page.evaluate(async () => {
    const { validateBackup } = await import('/src/database.js')
    const before = await lib.exportBackup()
    const scope = {
      months: ['2026-10'],
      orders: [{ accountId: 'local', orderId: '9701', entryIds: ['1'] }],
    }
    const partial = await lib.exportBackup({
      orderIds: ['9701'],
      packingScope: scope,
    })
    validateBackup(partial)
    const full = await lib.exportBackup({
      orderIds: ['9701', '9702'],
      packingScope: {
        ...scope,
        orders: [
          ...scope.orders,
          { accountId: 'local', orderId: '9702', entryIds: ['1'] },
        ],
      },
    })
    validateBackup(full)
    const after = await lib.exportBackup()
    return { before, after, partial, full }
  })
  expect(result.partial.orders.map((order) => order.snapshot.orderId)).toEqual([
    '9701',
  ])
  expect(result.partial.cartonBatches).toEqual([])
  expect(result.partial.omittedCartonBatchIds).toEqual([
    'synthetic-cross-purchase-carton',
  ])
  expect(result.full.cartonBatches).toHaveLength(1)
  expect(result.full.cartonBatches[0]).toMatchObject({
    count: 1,
    received: 1,
    loaded: 0,
  })
  expect(result.full.omittedCartonBatchIds).toEqual([])
  for (const field of ['orders', 'history', 'preparations', 'cartonBatches'])
    expect(result.after[field]).toEqual(result.before[field])
})

test('a scoped carton-mark owner also reports omitted cartons when it contributes no pieces', async ({
  extension,
}) => {
  const page = await seed(extension)
  const result = await page.evaluate(async () => {
    const { validateBackup } = await import('/src/database.js')
    const [batch] = await lib.listCartonBatches()
    await lib.saveCartonBatch(
      {
        ...batch,
        groups: batch.groups.filter((group) => group.orderId === '9702'),
        contents: batch.contents.filter((item) => item.orderId === '9702'),
      },
      { expectedRevision: batch.revision }
    )
    const partial = await lib.exportBackup({
      orderIds: ['9701'],
      packingScope: {
        months: ['2026-10'],
        orders: [{ accountId: 'local', orderId: '9701', entryIds: ['1'] }],
      },
    })
    validateBackup(partial)
    return partial
  })
  expect(result.cartonBatches).toEqual([])
  expect(result.omittedCartonBatchIds).toEqual([
    'synthetic-cross-purchase-carton',
  ])
})

test('Back up packing downloads one purchase and explains its omitted shared carton', async ({
  extension,
}) => {
  const storage = await seed(extension)
  const backup = await storage.evaluate(() => lib.exportBackup())
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    backup
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const row = page.locator('#sheet-body tr[data-selection-key="9701/1"]')
  await expect(row).toBeVisible()
  await row.click()
  await page.locator('[data-action="prepare-packing-list"]').click()
  await expect(page.locator('#packing-view')).toBeVisible()
  await page.locator('#packing-view [data-action="open-copy-menu"]').click()
  await page
    .getByRole('button', { name: 'Back up packing', exact: true })
    .click()
  await expect(page.locator('#feedback')).toContainText(
    '1 partial carton batches omitted'
  )
  await expect
    .poll(async () => {
      const files = await extension.inspector.evaluate(() =>
        chrome.downloads.search({})
      )
      return files.filter((file) => file.state === 'complete').length
    })
    .toBe(1)
})
