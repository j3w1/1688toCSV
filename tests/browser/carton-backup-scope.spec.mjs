import { test, expect } from './extension-fixture.mjs'
import { readFile } from 'node:fs/promises'
import { readBackupFile } from '../../src/backup-file.js'

const requested = { accountId: 'local', orderId: '9701', entryIds: ['1'] }
const scope = { months: ['2026-10'], orders: [requested] }
const dependency = { accountId: 'local', orderId: '9702' }

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
          thumbnail: `https://cbu01.alicdn.com/synthetic-scope-${orderId}.png`,
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

async function seed(extension, { markOnly = false } = {}) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(
    async ({ sources, markOnly }) => {
      const { openDatabase, validateBackup } = await import('/src/database.js')
      const { createPreparation, activePackingState } =
        await import('/src/packing-model.js')
      window.lib = await openDatabase({
        name: `scoped-cartons-${crypto.randomUUID()}`,
      })
      for (const source of sources) await lib.saveSnapshot(source)
      for (const source of sources)
        await lib.putImage({
          url: source.items[0].thumbnail,
          dataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8ZkAAAAASUVORK5CYII=',
          storedAt: source.observedAt,
          contentType: 'image/png',
        })
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
      const carton = {
        id: 'synthetic-cross-purchase-carton',
        accountId: 'local',
        month: '2026-10',
        storeId: '["1688","synthetic-scoped-cartons"]',
        groups: refs
          .filter((ref) => !markOnly || ref.orderId === '9702')
          .map(({ orderId, groupId }) => ({ orderId, groupId })),
        mark: { orderId: refs[0].orderId, groupId: refs[0].groupId },
        contents: sources
          .filter((source) => !markOnly || source.orderId === '9702')
          .map((source) => ({
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
        revision: 1,
        updatedAt: '2026-10-15T00:00:00.000Z',
      }
      // Explicit synthetic pre-SEAL v4 archive, built from source/preparation
      // APIs before any operational shipment exists, not a downgraded v5 graph.
      // Cross-purchase physical writes are forbidden; legacy restore is the
      // compatibility ingress for this historical mixed-purchase evidence.
      const preparations = await lib.listPreparations()
      window.legacyArchive = {
        format: '1688-order-library',
        version: 4,
        exportedAt: '2026-10-15T00:00:00.000Z',
        orders: await Promise.all(
          sources.map((source) => lib.getOrder(source.orderId))
        ),
        history: [],
        images: await Promise.all(
          sources.map((source) => lib.getImage(source.items[0].thumbnail))
        ),
        preparations,
        ...activePackingState(preparations),
        cartonBatches: [carton],
      }
      validateBackup(legacyArchive)
      await lib.restoreBackup(legacyArchive)
      // Unrelated source and same order ID in another account must not widen
      // the requested or dependency scope.
      await lib.saveSnapshot({
        ...sources[1],
        orderId: '9799',
        sourceUrl: sources[1].sourceUrl.replace('9702', '9799'),
      })
      await lib.saveSnapshot({ ...sources[1], accountId: 'other-account' })
    },
    { sources: snapshots(), markOnly }
  )
  return page
}

test('atomic v5 scoped export retains the exact cross-purchase graph and discloses dependencies; legacy clipping remains supported', async ({
  extension,
}) => {
  const page = await seed(extension)
  const result = await page.evaluate(async () => {
    const { validateBackup, openDatabase } = await import('/src/database.js')
    const { createPackingBackup } = await import('/src/packing-backup.js')
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
    const orderArchive = await lib.exportBackup({ orderIds: ['9701'] })
    validateBackup(orderArchive)
    const target = await openDatabase({
      name: `scoped-copy-${crypto.randomUUID()}`,
    })
    await target.restoreBackup(partial)
    const roundTrip = await target.exportBackup()
    target.close()
    const legacyPartial = createPackingBackup(legacyArchive, scope)
    validateBackup(legacyPartial)
    const legacyTarget = await openDatabase({
      name: `legacy-copy-${crypto.randomUUID()}`,
    })
    await legacyTarget.restoreBackup(legacyPartial)
    const legacyRestored = await legacyTarget.getOrder('9701')
    legacyTarget.close()
    const after = await lib.exportBackup()
    return {
      before,
      after,
      partial,
      full,
      orderArchive,
      roundTrip,
      legacyPartial,
      legacyRestored,
    }
  })
  for (const archive of [result.partial, result.full, result.orderArchive]) {
    expect(archive.version).toBe(5)
    expect(archive.packingScope).toBeUndefined()
    expect(archive.omittedCartonBatchIds || []).toEqual([])
    for (const field of ['orders', 'history', 'preparations'])
      expect(archive[field], field).toEqual(
        result.before[field].filter(
          (entry) =>
            (entry.snapshot || entry).accountId === 'local' &&
            ['9701', '9702'].includes((entry.snapshot || entry).orderId)
        )
      )
    for (const field of ['cartonBatches', 'images'])
      expect(archive[field], field).toEqual(result.before[field])
  }
  expect(result.partial.requestedPackingScope).toEqual(scope)
  expect(result.partial.dependencyOrderRefs).toEqual([dependency])
  expect(result.full.requestedPackingScope.orders).toEqual([
    requested,
    { ...dependency, entryIds: ['1'] },
  ])
  expect(result.full.dependencyOrderRefs).toEqual([])
  expect(result.orderArchive.requestedOrderRefs).toEqual([
    { accountId: 'local', orderId: '9701' },
  ])
  expect(result.orderArchive.dependencyOrderRefs).toEqual([dependency])
  for (const field of ['orders', 'history', 'cartonBatches', 'images'])
    expect(result.roundTrip[field], field).toEqual(result.partial[field])
  expect(result.partial.images.map((image) => image.url).sort()).toEqual([
    'https://cbu01.alicdn.com/synthetic-scope-9701.png',
    'https://cbu01.alicdn.com/synthetic-scope-9702.png',
  ])
  expect(result.legacyPartial.version).toBe(4)
  expect(
    result.legacyPartial.orders.map((order) => order.snapshot.orderId)
  ).toEqual(['9701'])
  expect(result.legacyPartial.cartonBatches).toEqual([])
  expect(result.legacyPartial.omittedCartonBatchIds).toEqual([
    'synthetic-cross-purchase-carton',
  ])
  expect(result.legacyRestored.snapshot).toEqual(
    result.legacyPartial.orders[0].snapshot
  )
  expect(result.full.cartonBatches).toHaveLength(1)
  expect(result.full.cartonBatches[0]).toMatchObject({
    count: 1,
    received: 1,
    loaded: 0,
  })
  for (const field of Object.keys(result.before).filter(
    (key) => key !== 'exportedAt'
  ))
    expect(result.after[field], field).toEqual(result.before[field])
})

test('a zero-piece carton-mark owner retains the complete v5 carton dependency and legacy omission disclosure', async ({
  extension,
}) => {
  const page = await seed(extension, { markOnly: true })
  const result = await page.evaluate(async () => {
    const { validateBackup } = await import('/src/database.js')
    const { createPackingBackup } = await import('/src/packing-backup.js')
    const before = await lib.exportBackup()
    const partial = await lib.exportBackup({
      orderIds: ['9701'],
      packingScope: {
        months: ['2026-10'],
        orders: [{ accountId: 'local', orderId: '9701', entryIds: ['1'] }],
      },
    })
    validateBackup(partial)
    const legacy = createPackingBackup(legacyArchive, {
      months: ['2026-10'],
      orders: [{ accountId: 'local', orderId: '9701', entryIds: ['1'] }],
    })
    validateBackup(legacy)
    return { partial, legacy, before }
  })
  expect(result.partial.requestedPackingScope).toEqual(scope)
  expect(result.partial.dependencyOrderRefs).toEqual([dependency])
  expect(
    result.partial.orders.map((order) => [
      order.snapshot.accountId,
      order.snapshot.orderId,
    ])
  ).toEqual([
    ['local', '9701'],
    ['local', '9702'],
  ])
  expect(result.partial.cartonBatches).toEqual(result.before.cartonBatches)
  expect(result.partial.cartonBatches[0].contents).toEqual([
    { orderId: '9702', entryId: '1', quantity: '27' },
  ])
  expect(result.partial.cartonBatches[0].mark.orderId).toBe('9701')
  expect(result.partial.images).toEqual(result.before.images)
  expect(result.partial.omittedCartonBatchIds || []).toEqual([])
  expect(result.legacy.cartonBatches).toEqual([])
  expect(result.legacy.omittedCartonBatchIds).toEqual([
    'synthetic-cross-purchase-carton',
  ])
})

test('Back up packing downloads a self-contained archive with separate requested and dependency scopes', async ({
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
  const row = page.locator(
    `#sheet-body tr[data-selection-key=${JSON.stringify(JSON.stringify(['local', '9701', '1']))}]`
  )
  await expect(row).toBeVisible()
  await row.getByRole('checkbox').check()
  await page.locator('#orders-view [data-action="open-copy-menu"]').click()
  await page
    .getByRole('button', { name: 'Back up packing', exact: true })
    .click()
  let downloaded
  await expect
    .poll(async () => {
      const files = await extension.inspector.evaluate(() =>
        chrome.downloads.search({})
      )
      downloaded = files.find((file) => file.state === 'complete')
      return files.filter((file) => file.state === 'complete').length
    })
    .toBe(1)
  const archive = await readBackupFile(
    new File([await readFile(downloaded.filename)], 'synthetic-packing.json.gz')
  )
  expect(archive.version).toBe(5)
  expect(archive.requestedPackingScope).toEqual(scope)
  expect(archive.dependencyOrderRefs).toEqual([dependency])
  expect(archive.packingScope).toBeUndefined()
  expect(archive.omittedCartonBatchIds || []).toEqual([])
  expect(
    archive.orders.map((order) => [
      order.snapshot.accountId,
      order.snapshot.orderId,
    ])
  ).toEqual([
    ['local', '9701'],
    ['local', '9702'],
  ])
  for (const field of ['orders', 'history', 'preparations'])
    expect(archive[field], field).toEqual(
      backup[field].filter(
        (entry) =>
          (entry.snapshot || entry).accountId === 'local' &&
          ['9701', '9702'].includes((entry.snapshot || entry).orderId)
      )
    )
  for (const field of ['cartonBatches', 'images'])
    expect(archive[field], field).toEqual(backup[field])
})
