import { test, expect } from './extension-fixture.mjs'

const orderId = '1234567890123456789'
const thumbnail = 'https://cbu01.alicdn.com/synthetic-order.png'
const image = {
  url: thumbnail,
  dataUrl:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2WZ4kAAAAASUVORK5CYII=',
  storedAt: '2026-01-01T12:00:00.000Z',
}

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    accountId: 'local',
    orderId,
    sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
    sellerName: 'Synthetic factory',
    status: 'Completed',
    observedAt: '2026-01-01T12:00:00.000Z',
    items: [
      {
        entryId: '2234567890123456789',
        thumbnail,
        description: 'Synthetic box',
        price: '10.00',
        quantity: '2',
        sourceDiscount: '1.00',
        allocatedDiscount: '0.00',
        discount: '1.00',
      },
      {
        entryId: '2234567890123456790',
        thumbnail,
        description: 'Synthetic bowl',
        price: '5.00',
        quantity: '1',
        sourceDiscount: '0.00',
        allocatedDiscount: '0.00',
        discount: '0.00',
      },
    ],
    totals: {
      goodsGross: '25.00',
      shipping: '2.00',
      sourceDiscount: '1.00',
      orderAdjustment: '0.00',
      goodsNet: '24.00',
      payable: '26.00',
    },
    ...overrides,
  }
}

async function openTestDatabase(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async () => {
    const { openDatabase } = await import('/src/database.js')
    window.openOrderDatabase = openDatabase
    window.databaseName = `synthetic-orders-${crypto.randomUUID()}`
    window.library = await openDatabase({ name: window.databaseName })
  })
  return page
}

test('purchase dates enrich old records, survive refresh and roundtrip without inventing dates', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    const oldBackup = await library.exportBackup()
    const enriched = await library.saveSnapshot({
      ...first,
      purchasedAt: '2025-12-01T00:10:11+08:00',
      observedAt: '2026-01-02T12:00:00.000Z',
    })
    const refreshed = await library.saveSnapshot({
      ...first,
      observedAt: '2026-01-03T12:00:00.000Z',
    })
    const alternateSource = await library.saveSnapshot({
      ...first,
      purchasedAt: '2025-11-30T23:59:59+08:00',
      observedAt: '2026-01-04T12:00:00.000Z',
    })
    const backup = await library.exportBackup()
    const restored = await openOrderDatabase({ name: `${databaseName}-dates` })
    await restored.restoreBackup(oldBackup)
    const oldRecord = await restored.getOrder(first.orderId)
    await restored.restoreBackup(backup)
    const record = await restored.getOrder(first.orderId)
    const history = await restored.getHistory(first.orderId)
    restored.close()
    return { enriched, refreshed, alternateSource, oldRecord, record, history }
  }, snapshot())
  expect(result.enriched.order.changedEntryIds).toEqual([])
  expect(result.refreshed.changed).toBe(false)
  expect(result.refreshed.order.revision).toBe(2)
  expect(result.alternateSource.changed).toBe(false)
  expect(result.alternateSource.order.revision).toBe(2)
  expect(result.alternateSource.order.snapshot.purchasedAt).toBe(
    '2025-12-01T00:10:11+08:00'
  )
  expect(result.refreshed.order.snapshot.purchasedAt).toBe(
    '2025-12-01T00:10:11+08:00'
  )
  expect(result.oldRecord.snapshot).not.toHaveProperty('purchasedAt')
  expect(result.record.snapshot.purchasedAt).toBe('2025-12-01T00:10:11+08:00')
  expect(result.history[0].snapshot).not.toHaveProperty('purchasedAt')
})

test('invalid optional purchase dates reject backup atomically', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    const original = await library.exportBackup()
    const next = structuredClone(original.orders[0])
    next.snapshot.orderId = '9999999999999999999'
    next.snapshot.sourceUrl = first.sourceUrl.replace(
      first.orderId,
      next.snapshot.orderId
    )
    const rejected = []
    for (const purchasedAt of [
      '2026-02-30T00:00:00+08:00',
      '2026-01-01',
      'invalid',
      42,
    ]) {
      try {
        await library.restoreBackup({
          ...original,
          orders: [
            next,
            {
              ...original.orders[0],
              snapshot: { ...first, purchasedAt },
            },
          ],
        })
      } catch (error) {
        rejected.push(error.message)
      }
    }
    return { rejected, orders: await library.listOrders() }
  }, snapshot())
  expect(result.rejected).toHaveLength(4)
  expect(result.rejected.every((error) => error.includes('purchasedAt'))).toBe(
    true
  )
  expect(result.orders).toHaveLength(1)
  expect(result.orders[0].snapshot).toEqual(snapshot())
})

test('order identity stays exact and repeat reads or row reordering create no revision', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const initial = await library.saveSnapshot(first)
    await library.setNotes(first.orderId, {
      notes: 'Local packing note',
      tags: ['Review'],
    })
    const repeated = await library.saveSnapshot({
      ...first,
      observedAt: '2026-01-02T12:00:00.000Z',
      sourceUrl: `${first.sourceUrl}&tracking=changed`,
      items: [...first.items].reverse(),
    })
    return {
      initial,
      repeated,
      orders: await library.listOrders(),
      history: await library.getHistory(first.orderId),
    }
  }, snapshot())
  expect(result.initial.changed).toBe(true)
  expect(result.repeated.changed).toBe(false)
  expect(result.orders).toHaveLength(1)
  expect(result.repeated.order.snapshot.orderId).toBe(orderId)
  expect(result.repeated.order.revision).toBe(1)
  expect(result.repeated.order.lastCheckedAt).toBe('2026-01-02T12:00:00.000Z')
  expect(result.repeated.order.changedAt).toBe('2026-01-01T12:00:00.000Z')
  expect(result.repeated.order.notes).toBe('Local packing note')
  expect(result.repeated.order.tags).toEqual(['Review'])
  expect(result.history).toEqual([])
})

test('changed rows and deletions preserve the previous version and ignore stale or tied reads', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    await library.setNotes(first.orderId, { notes: 'Keep this', tags: [] })
    const second = {
      ...first,
      observedAt: '2026-01-03T12:00:00.000Z',
      items: [{ ...first.items[0], description: 'Updated synthetic box' }],
      totals: {
        ...first.totals,
        goodsGross: '20.00',
        goodsNet: '19.00',
        payable: '21.00',
      },
    }
    const changed = await library.saveSnapshot(second)
    const stale = await library.saveSnapshot({
      ...first,
      observedAt: '2026-01-02T12:00:00.000Z',
    })
    const tied = await library.saveSnapshot({
      ...first,
      observedAt: second.observedAt,
    })
    return {
      changed,
      stale,
      tied,
      history: await library.getHistory(first.orderId),
    }
  }, snapshot())
  expect(result.changed.changed).toBe(true)
  expect(result.changed.order.revision).toBe(2)
  expect(result.changed.order.changedEntryIds).toEqual(['2234567890123456789'])
  expect(result.changed.order.removedEntryIds).toEqual(['2234567890123456790'])
  expect(result.changed.order.notes).toBe('Keep this')
  expect(result.history).toHaveLength(1)
  expect(result.history[0].snapshot.items).toHaveLength(2)
  expect(result.history[0].revision).toBe(1)
  expect(result.stale).toEqual({ changed: false, order: result.changed.order })
  expect(result.tied).toEqual({ changed: false, order: result.changed.order })
})

test('malformed or partial snapshots cannot overwrite a complete order', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    const invalid = [
      { ...first, schemaVersion: 2 },
      { ...first, orderId: Number(first.orderId) },
      { ...first, items: [] },
      { ...first, items: [first.items[0], first.items[0]] },
      { ...first, items: [{ ...first.items[0], price: 10 }] },
      { ...first, observedAt: 'not a date' },
    ]
    const errors = []
    for (const candidate of invalid) {
      try {
        await library.saveSnapshot(candidate)
      } catch (error) {
        errors.push(error.message)
      }
    }
    return { errors, orders: await library.listOrders() }
  }, snapshot())
  expect(result.errors).toHaveLength(6)
  expect(result.orders).toHaveLength(1)
  expect(result.orders[0].snapshot).toEqual(snapshot())
  expect(result.orders[0].revision).toBe(1)
})

test('backup and snapshot validation reject unsafe links, invalid IDs and inconsistent money', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    const original = await library.exportBackup()
    const changeItem = (fields) => ({
      ...first,
      items: [{ ...first.items[0], ...fields }, first.items[1]],
    })
    const invalid = [
      ['symbolic order ID', { ...first, orderId: 'order-one' }],
      ['symbolic entry ID', changeItem({ entryId: 'item-one' })],
      ['script link', { ...first, sourceUrl: 'javascript:alert(1)' }],
      [
        'unrelated host',
        {
          ...first,
          sourceUrl: `https://example.invalid/?orderId=${first.orderId}`,
        },
      ],
      [
        'wrong order',
        {
          ...first,
          sourceUrl: first.sourceUrl.replace(
            first.orderId,
            '9999999999999999999'
          ),
        },
      ],
      [
        'duplicate query ID',
        { ...first, sourceUrl: `${first.sourceUrl}&orderId=${first.orderId}` },
      ],
      [
        'credentials in URL',
        {
          ...first,
          sourceUrl: first.sourceUrl.replace('https://', 'https://name@'),
        },
      ],
      ['empty seller', { ...first, sellerName: ' ' }],
      ['empty status', { ...first, status: '' }],
      ['empty description', changeItem({ description: '\n' })],
      ['zero quantity', changeItem({ quantity: '0' })],
      ['fractional quantity', changeItem({ quantity: '1.5' })],
      ['negative price', changeItem({ price: '-10.00' })],
      ['negative source discount', changeItem({ sourceDiscount: '-1.00' })],
      ['fractional cent discount', changeItem({ sourceDiscount: '1.001' })],
      ['mismatched row discount', changeItem({ discount: '2.00' })],
      [
        'discount exceeds row',
        changeItem({ sourceDiscount: '21.00', discount: '21.00' }),
      ],
      [
        'unreconciled allocation',
        changeItem({ allocatedDiscount: '1.00', discount: '2.00' }),
      ],
      [
        'wrong gross',
        { ...first, totals: { ...first.totals, goodsGross: '26.00' } },
      ],
      [
        'wrong source discount',
        { ...first, totals: { ...first.totals, sourceDiscount: '2.00' } },
      ],
      [
        'wrong goods net',
        { ...first, totals: { ...first.totals, goodsNet: '23.00' } },
      ],
      [
        'wrong payable',
        { ...first, totals: { ...first.totals, payable: '27.00' } },
      ],
      [
        'negative shipping',
        {
          ...first,
          totals: { ...first.totals, shipping: '-2.00', payable: '22.00' },
        },
      ],
    ]
    const nextRecord = structuredClone(original.orders[0])
    nextRecord.snapshot.orderId = '9999999999999999999'
    nextRecord.snapshot.sourceUrl = first.sourceUrl.replace(
      first.orderId,
      nextRecord.snapshot.orderId
    )
    const unexpectedlyAccepted = []
    for (const [label, candidate] of invalid) {
      try {
        await library.saveSnapshot(candidate)
        unexpectedlyAccepted.push(`snapshot: ${label}`)
      } catch {}
      try {
        await library.restoreBackup({
          ...original,
          orders: [nextRecord, { ...original.orders[0], snapshot: candidate }],
        })
        unexpectedlyAccepted.push(`backup: ${label}`)
      } catch {}
    }
    return { unexpectedlyAccepted, orders: await library.listOrders() }
  }, snapshot())
  expect(result.unexpectedlyAccepted).toEqual([])
  expect(result.orders).toHaveLength(1)
  expect(result.orders[0].snapshot).toEqual(snapshot())
})

test('exact fractional unit prices and signed allocated adjustments survive backup validation', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    const fractional = {
      ...first,
      items: [
        {
          ...first.items[0],
          price: '0.125',
          quantity: '4',
          sourceDiscount: '0.00',
          allocatedDiscount: '0.07',
          discount: '0.07',
        },
        {
          ...first.items[1],
          price: '0.20',
          quantity: '1',
          sourceDiscount: '0.00',
          allocatedDiscount: '0.03',
          discount: '0.03',
        },
      ],
      totals: {
        goodsGross: '0.70',
        sourceDiscount: '0.00',
        orderAdjustment: '0.10',
        goodsNet: '0.60',
        shipping: '0.10',
        payable: '0.70',
      },
    }
    await library.saveSnapshot(fractional)
    const surcharge = {
      ...fractional,
      observedAt: '2026-01-02T12:00:00.000Z',
      items: fractional.items.map((item) => ({
        ...item,
        allocatedDiscount: `-${item.allocatedDiscount}`,
        discount: `-${item.discount}`,
      })),
      totals: {
        ...fractional.totals,
        orderAdjustment: '-0.10',
        goodsNet: '0.80',
        payable: '0.90',
      },
    }
    await library.saveSnapshot(surcharge)
    const backup = await library.exportBackup()
    const restored = await openOrderDatabase({
      name: `${databaseName}-exact-money`,
    })
    await restored.restoreBackup(backup)
    const result = {
      order: await restored.getOrder(first.orderId),
      history: await restored.getHistory(first.orderId),
    }
    restored.close()
    return result
  }, snapshot())
  expect(result.order.snapshot.items[0].price).toBe('0.125')
  expect(result.order.snapshot.items[0].discount).toBe('-0.07')
  expect(result.order.snapshot.totals.payable).toBe('0.90')
  expect(result.history[0].snapshot.totals.payable).toBe('0.70')
})

test('backup roundtrip preserves versions, notes and deduplicated images without import jobs', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(
    async ({ first, image }) => {
      await library.saveSnapshot(first)
      await library.saveSnapshot({
        ...first,
        observedAt: '2026-01-02T12:00:00.000Z',
        status: 'Refunded',
      })
      await library.setNotes(first.orderId, {
        notes: 'Packing note',
        tags: ['Sample'],
      })
      await library.putImage(image)
      await library.putImage(image)
      await library.putJob({
        id: 'test-job',
        status: 'running',
        remaining: ['2'],
      })
      const backup = JSON.parse(JSON.stringify(await library.exportBackup()))
      const restored = await openOrderDatabase({
        name: `${databaseName}-restored`,
      })
      const firstRestore = await restored.restoreBackup(backup)
      const secondRestore = await restored.restoreBackup(backup)
      const output = {
        backup,
        firstRestore,
        secondRestore,
        record: await restored.getOrder(first.orderId),
        history: await restored.getHistory(first.orderId),
        image: await restored.getImage(image.url),
        jobs: await restored.listJobs(),
      }
      restored.close()
      return output
    },
    { first: snapshot(), image }
  )
  expect(result.backup.images).toHaveLength(1)
  expect(result.backup).not.toHaveProperty('jobs')
  expect(result.firstRestore).toEqual({ imported: 1, updated: 0 })
  expect(result.secondRestore).toEqual({ imported: 0, updated: 0 })
  expect(result.record.revision).toBe(2)
  expect(result.record.notes).toBe('Packing note')
  expect(result.history).toHaveLength(1)
  expect(result.image).toEqual(image)
  expect(result.jobs).toEqual([])
})

test('restore merges newer data and historical snapshots while keeping local notes', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await library.saveSnapshot(first)
    const older = await library.exportBackup()
    const source = await openOrderDatabase({ name: `${databaseName}-source` })
    await source.restoreBackup(older)
    await source.saveSnapshot({
      ...first,
      observedAt: '2026-01-03T12:00:00.000Z',
      status: 'Refunded',
    })
    await source.setNotes(first.orderId, {
      notes: 'Backup note',
      tags: ['Backup'],
    })
    const newer = await source.exportBackup()
    source.close()
    await library.setNotes(first.orderId, {
      notes: 'Local note',
      tags: ['Local'],
    })
    const restore = await library.restoreBackup(newer)
    await library.restoreBackup(older)
    const current = await library.getOrder(first.orderId)
    const history = await library.getHistory(first.orderId)
    await library.removeOrders([first.orderId])
    return {
      restore,
      current,
      history,
      remaining: await library.listOrders(),
      remainingHistory: await library.getHistory(first.orderId),
    }
  }, snapshot())
  expect(result.restore).toEqual({ imported: 0, updated: 1 })
  expect(result.current.snapshot.status).toBe('Refunded')
  expect(result.current.notes).toBe('Local note')
  expect(result.current.tags).toEqual(['Local'])
  expect(result.history).toHaveLength(1)
  expect(result.remaining).toEqual([])
  expect(result.remainingHistory).toEqual([])
})

test('invalid backup rows and image data reject the whole restore before writing', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(
    async ({ first, image }) => {
      await library.saveSnapshot(first)
      const original = await library.exportBackup()
      const nextRecord = structuredClone(original.orders[0])
      nextRecord.snapshot.orderId = '9999999999999999999'
      nextRecord.snapshot.sourceUrl = first.sourceUrl.replace(
        first.orderId,
        nextRecord.snapshot.orderId
      )
      const candidate = {
        ...original,
        orders: [nextRecord, original.orders[0]],
      }
      const invalid = [
        { ...candidate, version: 2 },
        {
          ...candidate,
          orders: [nextRecord, { ...original.orders[0], revision: 0 }],
        },
        { ...candidate, orders: [nextRecord, nextRecord] },
        {
          ...candidate,
          images: [{ ...image, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }],
        },
        {
          ...candidate,
          images: [{ ...image, url: 'https://example.invalid/image.png' }],
        },
        {
          ...candidate,
          images: [
            {
              ...image,
              dataUrl: `data:image/png;base64,${'A'.repeat(2 * 1024 * 1024)}`,
            },
          ],
        },
      ]
      const errors = []
      for (const backup of invalid) {
        try {
          await library.restoreBackup(backup)
        } catch (error) {
          errors.push(error.message)
        }
      }
      return {
        errors,
        orders: await library.listOrders(),
        images: (await library.exportBackup()).images,
      }
    },
    { first: snapshot(), image }
  )
  expect(result.errors).toHaveLength(6)
  expect(result.orders).toHaveLength(1)
  expect(result.orders[0].snapshot.orderId).toBe(orderId)
  expect(result.images).toEqual([])
})

test('queued jobs survive reopened connections and accounts cannot overwrite each other', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (first) => {
    await Promise.all([
      library.saveSnapshot(first),
      library.saveSnapshot({
        ...first,
        accountId: 'future-account',
        sellerName: 'Other seller',
      }),
    ])
    const job = {
      id: 'persistent-job',
      status: 'paused',
      remaining: [first.orderId],
    }
    await library.putJob(job)
    library.close()
    window.library = await openOrderDatabase({ name: databaseName })
    const readJob = await library.getJob(job.id)
    const jobs = await library.listJobs()
    await library.deleteJob(job.id)
    await library.removeOrders([first.orderId])
    return {
      readJob,
      jobs,
      afterDelete: await library.listJobs(),
      local: await library.listOrders(),
      other: await library.getOrder(first.orderId, {
        accountId: 'future-account',
      }),
    }
  }, snapshot())
  expect(result.readJob.status).toBe('paused')
  expect(result.jobs).toHaveLength(1)
  expect(result.afterDelete).toEqual([])
  expect(result.local).toEqual([])
  expect(result.other.snapshot.sellerName).toBe('Other seller')
})
