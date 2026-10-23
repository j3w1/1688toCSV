import { test, expect } from './extension-fixture.mjs'
import {
  editOrderProduct,
  closeOrderProduct,
} from './smart-workspace-helpers.mjs'

function snapshot(orderId) {
  return {
    schemaVersion: 1,
    accountId: 'local',
    orderId,
    sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
    sellerName: 'Synthetic seller',
    sellerMemberLogin: 'synthetic-seller',
    status: 'Completed',
    observedAt: '2026-10-01T12:00:00.000Z',
    items: ['Red cup', 'Blue cup', 'Bowl'].map((description, index) => ({
      entryId: String(index + 1),
      thumbnail: `https://cbu01.alicdn.com/synthetic-${index}.png`,
      description,
      title: index < 2 ? 'Cup' : 'Bowl',
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

async function openTestDatabase(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async () => {
    const { openDatabase } = await import('/src/database.js')
    window.openOrderDatabase = openDatabase
    window.packingModel = await import('/src/packing-model.js')
    window.databaseName = `synthetic-packing-${crypto.randomUUID()}`
    window.library = await openDatabase({ name: window.databaseName })
    window.saveSyntheticSource = async (source, target = window.library) => {
      await target.saveSnapshot(source)
      if (!source.purchasedAt) {
        const record = await target.getOrder(source.orderId, {
          accountId: source.accountId || 'local',
        })
        if (!record.purchaseDateResolution)
          await target.resolvePurchaseDate({
            accountId: source.accountId || 'local',
            orderId: source.orderId,
            date: '2026-10-01',
            expectedObservedAt: source.observedAt,
          })
      }
    }
    // An explicit pre-SEAL archive exercises grandfathered mixed-month
    // checkpoints. Ordinary v5 writes never perform a shipment-month move.
    window.restoreLegacyMonthFixture = async (source) => {
      await window.saveSyntheticSource(source, library)
      const originalRecord = await library.getOrder(source.orderId, {
        accountId: source.accountId || 'local',
      })
      const initial = packingModel.allocatePreparation(
        { ...packingModel.createPreparation(source, '2026-10'), revision: 1 },
        [],
        [],
        { snapshot: source }
      ).preparation
      initial.defaultPacking = packingModel.packingCheckpoint(initial)
      const plan = packingModel.planSelectedPreparations(
          [{ snapshot: source, preparation: initial, entryIds: ['2'] }],
          '2026-12'
        ),
        allocation = packingModel.allocatePreparation(
          { ...plan.preparations[0], revision: 2 },
          [],
          [],
          { snapshot: source }
        ),
        moved = allocation.preparation
      moved.previousPacking = packingModel.packingCheckpoint(initial, {
        includeDefaults: true,
      })
      moved.defaultPacking = packingModel.packingCheckpoint(moved)
      await library.restoreBackup({
        format: '1688-order-library',
        version: 4,
        exportedAt: '2026-10-22T12:00:00.000Z',
        orders: [originalRecord],
        history: [],
        images: [],
        cartonBatches: [],
        preparations: [moved],
        allocations: allocation.allocations,
        issuedCodes: allocation.issuedCodes,
      })
      return library.getPreparation(source.orderId)
    }
  })
  return page
}

test('purchase-code review reserves nothing and a stale multi-order assignment fails atomically before a fresh retry', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension),
    sources = [snapshot('1001'), snapshot('1002')].map((source) => ({
      ...source,
      purchasedAt: '2026-10-01T07:30:00+08:00',
    }))
  const result = await page.evaluate(async (sources) => {
    for (const source of sources) await library.saveSnapshot(source)
    const refs = sources.map((source) => ({
        accountId: 'local',
        orderId: source.orderId,
      })),
      entryRefs = sources.flatMap((source) =>
        source.items.map((item) => ({
          accountId: 'local',
          orderId: source.orderId,
          entryId: item.entryId,
        }))
      ),
      before = await library.exportBackup(),
      review = await library.reviewPurchaseCodes({
        orderRefs: refs,
        entryRefs,
      }),
      afterPreview = await library.exportBackup(),
      concurrent = await openOrderDatabase({ name: databaseName })
    await concurrent.saveSnapshot({
      ...sources[1],
      observedAt: '2026-10-02T12:00:00.000Z',
      status: 'Changed elsewhere',
    })
    const beforeFailure = await library.exportBackup()
    let error
    try {
      await library.assignPurchaseCodes({
        plan: review.plan,
        expectedRevisions: review.expectedRevisions,
        intentId: crypto.randomUUID(),
      })
    } catch (failure) {
      error = failure.message
    }
    const afterFailure = await library.exportBackup(),
      fresh = await library.reviewPurchaseCodes({ orderRefs: refs, entryRefs })
    await library.assignPurchaseCodes({
      plan: fresh.plan,
      expectedRevisions: fresh.expectedRevisions,
      intentId: crypto.randomUUID(),
    })
    const saved = await library.exportBackup()
    concurrent.close()
    return { before, afterPreview, beforeFailure, afterFailure, error, saved }
  }, sources)
  for (const field of [
    'preparations',
    'allocations',
    'issuedCodes',
    'orders',
    'history',
  ]) {
    expect(result.afterPreview[field]).toEqual(result.before[field])
    expect(result.afterFailure[field]).toEqual(result.beforeFailure[field])
  }
  expect(result.error).toMatch(/changed|stale|revision|review/i)
  expect(result.saved.preparations).toHaveLength(2)
  for (const preparation of result.saved.preparations) {
    expect(preparation.revision).toBe(1)
    expect(
      preparation.groups.every((group) => group.baseCode.startsWith('CE2610'))
    ).toBe(true)
    expect(
      preparation.groups
        .flatMap((group) =>
          group.variants.flatMap((variant) => variant.entryIds)
        )
        .sort()
    ).toEqual(['1', '2', '3'])
  }
  for (const record of result.saved.orders) {
    const source = sources.find(
      (source) => source.orderId === record.snapshot.orderId
    )
    expect(record.snapshot.items).toEqual(source.items)
    expect(record.snapshot.totals).toEqual(source.totals)
  }
})

test('literal China purchase months survive November container naming and zero-loaded sealing without consuming codes', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension),
    sources = [
      { ...snapshot('1001'), purchasedAt: '2026-09-30T23:30:00+08:00' },
      { ...snapshot('1002'), purchasedAt: '2026-10-01T07:30:00+08:00' },
    ]
  const result = await page.evaluate(async (sources) => {
    for (const source of sources) await library.saveSnapshot(source)
    const refs = sources.map((source) => ({
        accountId: 'local',
        orderId: source.orderId,
      })),
      review = await library.reviewPurchaseCodes({
        orderRefs: refs,
        entryRefs: sources.flatMap((source) =>
          source.items.map((item) => ({
            accountId: 'local',
            orderId: source.orderId,
            entryId: item.entryId,
          }))
        ),
      })
    await library.assignPurchaseCodes({
      plan: review.plan,
      expectedRevisions: review.expectedRevisions,
      intentId: crypto.randomUUID(),
    })
    const preparations = await library.listPreparations(),
      manual = structuredClone(preparations[0])
    manual.groups[0].baseCode = manual.groups[0].baseCode.slice(0, 8) + '98'
    manual.groups[0].spanishName = 'NOMBRE MANUAL'
    await library.savePreparations([manual], {
      expectedRevisions: [manual.revision],
    })
    const before = await library.exportBackup(),
      created = await library.createContainer({
        name: 'Synthetic November2026',
        period: '2026-11',
        intentId: crypto.randomUUID(),
      }),
      container = created.container || created
    await library.includeContainerOrders({
      id: container.id,
      orderRefs: refs,
      expectedRevision: container.revision,
      intentId: crypto.randomUUID(),
    })
    const view = await library.getContainerView({ id: container.id }),
      sealReview = await library.reviewContainerSeal({
        id: container.id,
        expectedRevision: view.container.revision,
      })
    if (!sealReview.ready) throw new Error(JSON.stringify(sealReview.issues))
    await library.sealContainer({
      id: container.id,
      expectedRevision: view.container.revision,
      reviewToken: sealReview.reviewToken,
      intentId: crypto.randomUUID(),
    })
    return {
      before,
      after: await library.exportBackup(),
      state: await library.getOperationalState({}),
      manifest: await library.getContainerManifest({ id: container.id }),
    }
  }, sources)
  const byOrder = new Map(
    result.after.preparations.map((preparation) => [
      preparation.orderId,
      preparation,
    ])
  )
  expect(
    byOrder
      .get('1001')
      .groups.every((group) => group.baseCode.startsWith('CE2609'))
  ).toBe(true)
  expect(
    byOrder
      .get('1002')
      .groups.every((group) => group.baseCode.startsWith('CE2610'))
  ).toBe(true)
  expect(result.after.preparations).toEqual(result.before.preparations)
  expect(result.after.issuedCodes).toEqual(result.before.issuedCodes)
  expect(result.after.orders.map((record) => record.snapshot)).toEqual(
    result.before.orders.map((record) => record.snapshot)
  )
  expect(
    result.state.locks.filter((lock) => lock.kind === 'code-consumption')
  ).toEqual([])
  expect(result.manifest.cartons).toEqual([])
  expect(result.manifest.draft).toBe(false)
})

test('partial source code assignment preserves authored group/variant order and rejects an arbitrary packing-month code rewrite', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension),
    source = { ...snapshot('1001'), purchasedAt: '2026-10-01T07:30:00+08:00' }
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    const ref = { accountId: 'local', orderId: source.orderId },
      assign = async (entries) => {
        const review = await library.reviewPurchaseCodes({
          orderRefs: [ref],
          entryRefs: entries.map((entryId) => ({ ...ref, entryId })),
        })
        await library.assignPurchaseCodes({
          plan: review.plan,
          expectedRevisions: review.expectedRevisions,
          intentId: crypto.randomUUID(),
        })
      }
    await assign(['1', '3'])
    let current = await library.getPreparation(source.orderId),
      manual = packingModel.reorderPreparationGroups(
        current,
        current.groups.map((group) => group.id).reverse()
      )
    manual.groups[0].spanishName = 'NOMBRE MANUAL'
    manual.groups[0].baseCode = manual.groups[0].baseCode.slice(0, 8) + '98'
    const original = await library.savePreparation(manual),
      before = await library.exportBackup(),
      review = await library.reviewPurchaseCodes({
        orderRefs: [ref],
        entryRefs: [{ ...ref, entryId: '2' }],
      }),
      afterPreview = await library.exportBackup()
    await library.assignPurchaseCodes({
      plan: review.plan,
      expectedRevisions: review.expectedRevisions,
      intentId: crypto.randomUUID(),
    })
    current = await library.getPreparation(source.orderId)
    const beforeRefusal = await library.exportBackup(),
      illegal = structuredClone(current)
    illegal.month = '2026-12'
    for (const group of illegal.groups) {
      group.month = '2026-12'
      group.baseCode = group.baseCode.replace(/^CE2610/, 'CE2612')
    }
    let error
    try {
      await library.savePreparation(illegal)
    } catch (failure) {
      error = failure.message
    }
    return {
      original,
      before,
      afterPreview,
      current,
      beforeRefusal,
      afterRefusal: await library.exportBackup(),
      error,
    }
  }, source)
  for (const field of [
    'preparations',
    'allocations',
    'issuedCodes',
    'orders',
  ]) {
    expect(result.afterPreview[field]).toEqual(result.before[field])
    expect(result.afterRefusal[field]).toEqual(result.beforeRefusal[field])
  }
  expect(result.error).toMatch(/purchase|calendar|month/i)
  const originalIds = result.original.groups.map((group) => group.id)
  expect(
    result.current.groups
      .filter((group) => originalIds.includes(group.id))
      .map((group) => group.id)
  ).toEqual(originalIds)
  for (const group of result.original.groups) {
    const current = result.current.groups.find((value) => value.id === group.id)
    expect(current.baseCode).toBe(group.baseCode)
    expect(current.spanishName).toBe(group.spanishName)
    expect(
      current.variants.filter((variant) =>
        group.variants.some((old) => old.id === variant.id)
      )
    ).toEqual(group.variants)
  }
  expect(result.afterRefusal.orders[0].snapshot).toEqual(source)
})

test('1688 snapshots reject non-China transport offsets without replacing valid literal purchase dates or source money', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension),
    source = { ...snapshot('1001'), purchasedAt: '2026-09-30T23:30:00+08:00' }
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    const before = await library.exportBackup(),
      errors = []
    for (const purchasedAt of [
      '2026-09-30T23:30:00Z',
      '2026-09-30T23:30:00-05:00',
    ]) {
      try {
        await library.saveSnapshot({
          ...source,
          purchasedAt,
          observedAt: '2026-10-02T12:00:00.000Z',
        })
      } catch (error) {
        errors.push(error.message)
      }
    }
    return { before, after: await library.exportBackup(), errors }
  }, source)
  expect(result.errors).toHaveLength(2)
  expect(
    result.errors.every((error) =>
      /purchasedAt|purchase timestamp|China|08:00/i.test(error)
    )
  ).toBe(true)
  for (const field of [
    'orders',
    'history',
    'preparations',
    'issuedCodes',
    'allocations',
  ])
    expect(result.after[field]).toEqual(result.before[field])
  expect(result.after.orders[0].snapshot.purchasedAt).toBe(
    '2026-09-30T23:30:00+08:00'
  )
  expect(result.after.orders[0].snapshot.items).toEqual(source.items)
  expect(result.after.orders[0].snapshot.totals).toEqual(source.totals)
})

test('released codes can move to another product while current conflicts reject atomically and order deletion releases ownership', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    await saveSyntheticSource(source)
    const original = await library.savePreparation(
      packingModel.createPreparation(source, '2026-10')
    )
    const code = original.groups[0].baseCode
    const active = await library.queryCodeOwnership(code)
    const changed = await library.savePreparation(
      packingModel.regeneratePreparationCode(original, original.groups[0].id)
    )
    const released = await library.queryCodeOwnership(code)
    const conflicting = structuredClone(changed)
    conflicting.groups[1].baseCode = changed.groups[0].baseCode
    const beforeFailure = await library.exportBackup()
    let conflict
    try {
      await library.savePreparation(conflicting)
    } catch (error) {
      conflict = { code: error.code, detail: error.conflict }
    }
    const afterFailure = await library.exportBackup()
    const available = structuredClone(changed)
    available.groups[1].baseCode = code
    const reused = await library.savePreparation(available)
    const ownerAfterReuse = await library.queryCodeOwnership(code)
    await library.removeOrders([source.orderId])
    const deleted = await library.queryCodeOwnership(code)
    const backup = await library.exportBackup()
    return {
      active,
      released,
      deleted,
      conflict,
      backup,
      beforeFailure,
      afterFailure,
      reused,
      ownerAfterReuse,
    }
  }, snapshot('1001'))
  expect(result.active.owners[0].status).toBe('active')
  expect(result.released.owners).toEqual([])
  expect(result.conflict.code).toBe('PACKING_CODE_CONFLICT')
  expect(result.conflict.detail.owner.orderId).toBe('1001')
  for (const field of ['orders', 'preparations', 'allocations', 'issuedCodes'])
    expect(result.afterFailure[field]).toEqual(result.beforeFailure[field])
  expect(result.ownerAfterReuse.owners[0]).toMatchObject({
    status: 'active',
    groupId: result.reused.groups[1].id,
    orderExists: true,
    groupExists: true,
    sellerName: 'Synthetic seller',
    groupTitle: 'Bowl',
    entryIds: ['3'],
    photos: ['https://cbu01.alicdn.com/synthetic-2.png'],
  })
  expect(result.deleted.owners).toEqual([])
  expect(result.backup.issuedCodes).toEqual([])
})

test('legacy backups discard retired reservations after merge and split while retaining current ownership evidence', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    const { regroupSelection } = await import('/src/packing-grouping.js')
    await saveSyntheticSource(source)
    const first = await library.savePreparation(
      packingModel.createPreparation(source, '2026-10')
    )
    const initialBackup = await library.exportBackup()
    const [merged] = await regroupSelection(
      first.groups.map((group) => ({
        draft: first,
        group,
        variants: group.variants,
        complete: true,
      })),
      'merge',
      { getReservedBarcodes: (code) => library.getReservedBarcodes(code) }
    )
    const combined = await library.savePreparation(merged)
    const group = combined.groups[0]
    const [split] = await regroupSelection(
      [
        {
          draft: combined,
          group,
          variants: group.variants.slice(0, 2),
          complete: true,
        },
      ],
      'split',
      { getReservedBarcodes: (code) => library.getReservedBarcodes(code) }
    )
    await library.savePreparation(split)
    const legacy = await library.exportBackup()
    legacy.version = 2
    for (const entry of initialBackup.issuedCodes.filter(
      (entry) => entry.groupId === first.groups[1].id
    ))
      legacy.issuedCodes.push({
        ...entry,
        code: entry.code.replace('CE26100102', 'CE26100198'),
      })
    legacy.allocations[0].groups[0].nextItem = 99
    for (const entry of legacy.issuedCodes) delete entry.ownerSnapshot
    legacy.preparations[0].defaultPacking = packingModel.packingCheckpoint(
      legacy.preparations[0]
    )
    const restored = await openOrderDatabase({
      name: `${databaseName}-legacy-owner`,
    })
    await restored.restoreBackup(legacy)
    const before = await restored.exportBackup()
    const ownership = await restored.queryCodeOwnership('CE26100198')
    const conflicting = await restored.getPreparation(source.orderId)
    const activeCode = conflicting.groups[0].baseCode
    const activeOwnership = await restored.queryCodeOwnership(activeCode)
    conflicting.groups[1].baseCode = activeCode
    let conflict
    try {
      await restored.savePreparation(conflicting)
    } catch (error) {
      conflict = error.code
    }
    const after = await restored.exportBackup()
    const available = await restored.getPreparation(source.orderId)
    available.groups[1].baseCode = 'CE26100198'
    const reused = await restored.savePreparation(available)
    const reusedOwnership = await restored.queryCodeOwnership('CE26100198')
    restored.close()
    return {
      first,
      ownership,
      activeOwnership,
      reused,
      reusedOwnership,
      conflict,
      before,
      after,
    }
  }, snapshot('1001'))
  expect(result.ownership.owners).toEqual([])
  expect(result.activeOwnership.owners.length).toBeGreaterThan(0)
  for (const owner of result.activeOwnership.owners) {
    expect(owner.status).toBe('active')
    expect(owner.groupExists).toBe(true)
    expect(owner.photos.length).toBeGreaterThan(0)
  }
  expect(result.conflict).toBe('PACKING_CODE_CONFLICT')
  expect(result.after.preparations).toEqual(result.before.preparations)
  expect(result.after.issuedCodes).toEqual(result.before.issuedCodes)
  expect(result.reusedOwnership.owners[0]).toMatchObject({
    status: 'active',
    groupId: result.reused.groups[1].id,
  })
})

test('checkpoint restores survive backup round trips without reserving retired codes and active restore conflicts are atomic', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    const moved = await restoreLegacyMonthFixture(source)
    let edited = packingModel.reorderPreparationGroups(
      moved,
      moved.groups.map((entry) => entry.id).reverse()
    )
    edited = packingModel.regeneratePreparationCode(edited, edited.groups[0].id)
    edited.groups[0].spanishName = 'NOMBRE MANUAL'
    edited = await library.savePreparation(edited)
    const reset = await library.savePreparation(
      packingModel.restoreDefaultPacking(edited)
    )
    const backup = await library.exportBackup()
    const restoredLibrary = await openOrderDatabase({
      name: `${databaseName}-restored`,
    })
    await restoredLibrary.restoreBackup(backup)
    const restored = await restoredLibrary.getPreparation(source.orderId)
    const restoredPrevious = await restoredLibrary.savePreparation(
      packingModel.restorePreviousPacking(restored)
    )
    const otherSource = {
      ...source,
      orderId: '2002',
      purchasedAt: '2026-12-01T10:00:00+08:00',
      sourceUrl: source.sourceUrl.replace(source.orderId, '2002'),
    }
    await saveSyntheticSource(otherSource, restoredLibrary)
    const other = packingModel.createPreparation(otherSource, '2026-12')
    other.groups[0].baseCode = moved.groups.find(
      (group) => group.month === '2026-12'
    ).baseCode
    await restoredLibrary.savePreparation(other)
    const beforeFailure = await restoredLibrary.exportBackup()
    const colliding = structuredClone(backup)
    colliding.preparations[0].updatedAt = new Date(
      Date.now() + 1000
    ).toISOString()
    let failure
    try {
      await restoredLibrary.restoreBackup(colliding)
    } catch (error) {
      failure = error.code
    }
    const afterFailure = await restoredLibrary.exportBackup()
    const unchanged = await restoredLibrary.getPreparation(source.orderId)
    restoredLibrary.close()
    return {
      moved,
      reset,
      restored,
      restoredPrevious,
      unchanged,
      failure,
      beforeFailure,
      afterFailure,
    }
  }, snapshot('1001'))
  expect(
    result.reset.groups.map((entry) => [entry.id, entry.baseCode])
  ).toEqual(
    result.moved.defaultPacking.groups.map((entry) => [
      entry.id,
      entry.baseCode,
    ])
  )
  expect(result.reset.groups[2].spanishName).toBe('NOMBRE MANUAL')
  expect(result.restored.defaultPacking).toEqual(result.reset.defaultPacking)
  expect(result.restoredPrevious.groups).toHaveLength(2)
  expect(result.restoredPrevious.groups[0].baseCode).toBe('CE26100101')
  expect(result.restoredPrevious.groups[0].variants).toHaveLength(2)
  expect(result.failure).toBe('PACKING_CODE_CONFLICT')
  expect(result.unchanged).toEqual(result.restoredPrevious)
  for (const field of [
    'orders',
    'history',
    'images',
    'preparations',
    'allocations',
    'issuedCodes',
    'packingPreferences',
  ])
    expect(result.afterFailure[field]).toEqual(result.beforeFailure[field])
})

test('packing-only backups keep complete included preparations and only their current code reservations', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const first = snapshot('1001')
  const second = snapshot('1002')
  second.items = second.items.map((entry) => ({
    ...entry,
    thumbnail: entry.thumbnail.replace('synthetic-', 'other-'),
  }))
  const result = await page.evaluate(
    async (sources) => {
      await restoreLegacyMonthFixture(sources[0])
      await saveSyntheticSource(sources[1])
      await library.savePreparation(
        packingModel.createPreparation(sources[1], '2026-10')
      )
      const dataUrl =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2WZ4kAAAAASUVORK5CYII='
      for (const source of sources)
        await library.putImage({
          url: source.items[0].thumbnail,
          dataUrl,
          storedAt: '2026-10-01T12:00:00.000Z',
        })
      const full = await library.exportBackup()
      const scoped = await library.exportBackup({
        orderIds: [sources[0].orderId],
      })
      const empty = await library.exportBackup({ orderIds: [] })
      const restored = await openOrderDatabase({
        name: `${databaseName}-scoped`,
      })
      await restored.restoreBackup(scoped)
      const output = await restored.exportBackup()
      restored.close()
      return { full, scoped, empty, output }
    },
    [first, second]
  )
  expect(result.scoped.orders.map((entry) => entry.snapshot.orderId)).toEqual([
    '1001',
  ])
  expect(result.scoped.preparations).toHaveLength(1)
  expect(
    result.scoped.preparations[0].groups.map((entry) => entry.month)
  ).toEqual(['2026-10', '2026-12', '2026-10'])
  expect(result.scoped.preparations[0].previousPacking.groups).toHaveLength(2)
  expect(result.scoped.images).toHaveLength(1)
  expect(result.scoped.issuedCodes).toEqual(
    result.full.issuedCodes.filter((entry) => entry.orderId === '1001')
  )
  expect(result.output.preparations).toEqual(result.scoped.preparations)
  expect(result.output.issuedCodes).toEqual(result.scoped.issuedCodes)
  expect(result.output.allocations).toEqual(result.scoped.allocations)
  expect(result.empty.orders).toEqual([])
  expect(result.empty.preparations).toEqual([])
  expect(result.empty.images).toEqual([])
  expect(result.empty.issuedCodes).toEqual([])
})

test('scoped packing restore preserves saved automatic label values and arrangement without importing global vocabularies', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    const { createPackingBackup } = await import('/src/packing-backup.js')
    const vocabulary = [
      { match: 'Cup', spanishName: 'TAZA GUARDADA', category: '保存杯' },
      { match: 'Bowl', spanishName: 'CUENCO GUARDADO', category: '保存碗' },
    ]
    await library.savePackingPreferences({ settings: {}, vocabulary })
    await saveSyntheticSource(source)
    const first = await library.savePreparation(
      packingModel.createPreparation(source, '2026-10', vocabulary)
    )
    const edited = packingModel.reorderPreparationGroups(
      first,
      first.groups.map((group) => group.id).reverse()
    )
    edited.previousPacking = packingModel.packingCheckpoint(first, {
      includeDefaults: true,
    })
    for (const group of edited.groups) {
      group.variants.reverse()
      for (const variant of group.variants) {
        variant.material = '玻璃'
        variant.materialSource = 'manual'
      }
    }
    edited.groups[0].baseCode = 'CE26100108'
    const expected = await library.savePreparation(edited)
    const full = await library.exportBackup()
    const scoped = createPackingBackup(full, {
      months: ['2026-10'],
      orders: [{ orderId: source.orderId, entryIds: ['1', '2', '3'] }],
    })
    const outputs = []
    const globalVocabulary = [
      { match: 'Cup|Bowl', spanishName: 'GLOBAL NAME', category: '全局' },
    ]
    for (const [mode, vocabulary] of [
      ['fresh', undefined],
      ['empty', []],
      ['global', globalVocabulary],
    ]) {
      const target = await openOrderDatabase({
        name: `${databaseName}-${mode}`,
      })
      if (vocabulary)
        await target.savePackingPreferences({ settings: {}, vocabulary })
      await target.restoreBackup(scoped)
      await target.refreshNamingSuggestions()
      const appearanceOnly = await target.getPackingPreferences()
      appearanceOnly.settings.dpi = 600
      await target.savePackingPreferences(appearanceOnly)
      outputs.push({
        mode,
        preparation: await target.getPreparation(source.orderId),
        preferences: await target.getPackingPreferences(),
      })
      const changedRules = await target.getPackingPreferences()
      changedRules.vocabulary = [
        { match: 'Cup|Bowl', spanishName: 'NEW RULE', category: '新规则' },
      ]
      await target.savePackingPreferences(changedRules)
      outputs.at(-1).afterRuleChange = await target.getPreparation(
        source.orderId
      )
      target.close()
    }
    const fullTarget = await openOrderDatabase({
      name: `${databaseName}-full`,
    })
    await fullTarget.savePackingPreferences({
      settings: {},
      vocabulary: globalVocabulary,
    })
    await fullTarget.restoreBackup({ ...full, packingPreferences: null })
    const fullPreparation = await fullTarget.getPreparation(source.orderId)
    fullTarget.close()
    return { expected, scoped, outputs, fullPreparation, globalVocabulary }
  }, snapshot('1001'))
  expect(result.scoped.history).toEqual([])
  expect(result.scoped.packingPreferences.value.vocabulary).toBeUndefined()
  for (const { preparation } of result.outputs) {
    expect(preparation).toEqual(result.expected)
    expect(preparation.groups[0].naming.spanishName.source).toBe('automatic')
    expect(preparation.groups[0].baseCode).toBe('CE26100108')
    expect(preparation.groups[0].variants[0].material).toBe('玻璃')
  }
  for (const { afterRuleChange } of result.outputs) {
    expect(afterRuleChange.groups.map((group) => group.spanishName)).toEqual([
      'NEW RULE',
      'NEW RULE',
    ])
    expect(afterRuleChange.groups[0].naming.spanishName.source).toBe(
      'automatic'
    )
  }
  expect(
    result.outputs.find((entry) => entry.mode === 'empty').preferences
      .vocabulary
  ).toEqual([])
  expect(
    result.outputs.find((entry) => entry.mode === 'global').preferences
      .vocabulary
  ).toEqual(result.globalVocabulary)
  expect(
    result.fullPreparation.groups.map((group) => group.spanishName)
  ).toEqual(['GLOBAL NAME', 'GLOBAL NAME'])
  expect(result.fullPreparation.groups.map((group) => group.category)).toEqual([
    '全局',
    '全局',
  ])
  // Restored names remain visible in the contextual Orders editor after startup
  // and reload, without reopening the retired preparation screen.
  const uiBackup = structuredClone(result.scoped)
  for (const { snapshot } of uiBackup.orders)
    for (const item of snapshot.items) item.thumbnail = ''
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    uiBackup
  )
  expect(restored.ok, restored.error).toBe(true)
  const workspace = await extension.context.newPage()
  await workspace.clock.setFixedTime(new Date('2026-10-17T04:00:00Z'))
  await workspace.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await workspace.goto(`${extension.extensionBaseUrl}/library.html`)
  for (let opening = 0; opening < 2; opening++) {
    if (opening) await workspace.reload()
    const names = []
    for (const group of result.expected.groups) {
      const editor = await editOrderProduct(workspace, {
        accountId: result.expected.accountId,
        orderId: result.expected.orderId,
        entryId: group.variants[0].entryIds[0],
      })
      names.push(
        await editor
          .locator('[data-authoring-field="spanish-name"]')
          .inputValue()
      )
      await closeOrderProduct(editor)
    }
    expect(names).toEqual(
      result.expected.groups.map((group) => group.spanishName)
    )
    await expect(workspace.locator('#packing-view')).toBeHidden()
    const backup = await extension.inspector.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
    )
    expect(backup.ok, backup.error).toBe(true)
    expect(
      backup.data.preparations[0].groups.map((group) => group.naming)
    ).toEqual(result.expected.groups.map((group) => group.naming))
  }
})

test('new memberships extend defaults without reserving old barcodes until those defaults are restored', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    await saveSyntheticSource(source)
    const first = await library.savePreparation(
      packingModel.createPreparation(
        { ...source, items: [source.items[0]] },
        '2026-10'
      )
    )
    const manual = structuredClone(first)
    manual.groups[0].baseCode = 'CE26100102'
    const edited = await library.savePreparation(manual)
    edited.groups[0].variants.push({
      ...structuredClone(edited.groups[0].variants[0]),
      id: crypto.randomUUID(),
      entryIds: ['2'],
      variant: 'blue',
      variantSuffix: 'A',
    })
    const extended = await library.savePreparation(edited)
    const plan = packingModel.planSelectedPreparations(
      [{ snapshot: source, preparation: extended, entryIds: ['3'] }],
      '2026-10'
    )
    const [added] = await library.savePreparations(plan.preparations)
    const beforeResetOwner = await library.queryCodeOwnership('CE26100101A')
    const reset = await library.savePreparation(
      packingModel.restoreDefaultPacking(added),
      { preserveNaming: true }
    )
    return {
      first,
      extended,
      added,
      reset,
      beforeResetOwner,
      originalCodeOwner: await library.queryCodeOwnership('CE26100101A'),
    }
  }, snapshot('1001'))
  expect(result.extended.groups[0].baseCode).toBe('CE26100102')
  expect(result.extended.defaultPacking.groups[0].baseCode).toBe('CE26100101')
  expect(
    result.extended.defaultPacking.groups[0].variants.map(
      (entry) => entry.entryIds
    )
  ).toEqual([['1'], ['2']])
  expect(result.added.defaultPacking.groups).toHaveLength(2)
  expect(result.beforeResetOwner.owners).toEqual([])
  expect(result.reset.groups[0].baseCode).toBe('CE26100101')
  expect(
    result.reset.groups.flatMap((group) =>
      group.variants.flatMap((variant) => variant.entryIds)
    )
  ).toEqual(['1', '2', '3'])
  expect(result.originalCodeOwner.owners[0].status).toBe('active')
})

test('v2 databases migrate to current ownership without changing source records, settings, images or import jobs', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    await saveSyntheticSource(source)
    const original = await library.savePreparation(
      packingModel.createPreparation(source, '2026-10')
    )
    const originalBackup = await library.exportBackup()
    const changed = structuredClone(original)
    changed.groups[0].baseCode = 'CE26100105'
    await library.savePreparation(changed)
    await library.saveSnapshot({
      ...source,
      observedAt: '2026-10-02T12:00:00.000Z',
      status: 'Awaiting shipment',
    })
    await library.setNotes(source.orderId, {
      notes: 'Preserve this synthetic source note.',
      tags: ['Keep this tag'],
    })
    const preferences = await library.getPackingPreferences()
    preferences.settings.companyName = 'Synthetic preserved company'
    await library.savePackingPreferences(preferences)
    const image = {
      url: source.items[0].thumbnail,
      dataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2WZ4kAAAAASUVORK5CYII=',
      storedAt: '2026-10-01T12:00:00.000Z',
    }
    await library.putImage(image)
    const before = await library.exportBackup()
    const job = {
      id: 'keep-paused-import',
      status: 'paused',
      orderIds: ['1001'],
      completed: ['1001'],
      progress: 1,
    }
    const display = { id: 'workspace-display', colorScheme: 'light' }
    const legacy = structuredClone(before)
    legacy.allocations[0].groups[0].nextItem = 99
    const retired = originalBackup.issuedCodes.filter(
      (entry) => entry.groupId === original.groups[0].id
    )
    legacy.issuedCodes.push(...retired)
    const orphanGroupId = crypto.randomUUID()
    legacy.issuedCodes.push(
      ...retired.map((entry) => ({
        ...entry,
        code: entry.code.replace('CE26100101', 'CE26100198'),
        orderId: '9999',
        groupId: orphanGroupId,
      }))
    )
    const name = `${databaseName}-v2-migration`
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 2)
      request.onupgradeneeded = () => {
        const db = request.result
        const orders = db.createObjectStore('orders', {
          keyPath: ['snapshot.accountId', 'snapshot.orderId'],
        })
        orders.createIndex('account', 'snapshot.accountId')
        const history = db.createObjectStore('history', {
          keyPath: [
            'snapshot.accountId',
            'snapshot.orderId',
            'snapshot.observedAt',
          ],
        })
        history.createIndex('order', ['snapshot.accountId', 'snapshot.orderId'])
        db.createObjectStore('images', { keyPath: 'url' })
        db.createObjectStore('jobs', { keyPath: 'id' })
        const preparations = db.createObjectStore('preparations', {
          keyPath: ['accountId', 'orderId'],
        })
        preparations.createIndex('account', 'accountId')
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
        const db = request.result
        const tx = db.transaction([...db.objectStoreNames], 'readwrite')
        for (const [storeName, entries] of [
          ['orders', legacy.orders],
          ['history', legacy.history],
          ['images', legacy.images],
          ['preparations', legacy.preparations],
          ['packingAllocations', legacy.allocations],
          ['issuedCodes', legacy.issuedCodes],
          ['jobs', [job]],
          [
            'packingPreferences',
            [{ id: 'packing', ...legacy.packingPreferences }, display],
          ],
        ])
          for (const entry of entries) tx.objectStore(storeName).put(entry)
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
    const upgraded = await openOrderDatabase({ name })
    const after = await upgraded.exportBackup()
    const preservedJob = await upgraded.getJob(job.id)
    const preservedDisplay = await upgraded.getWorkspaceDisplay()
    const retiredOwner = await upgraded.queryCodeOwnership('CE26100101')
    const orphanOwner = await upgraded.queryCodeOwnership('CE26100198')
    const activeOwner = await upgraded.queryCodeOwnership('CE26100105')
    upgraded.close()
    const reopened = await openOrderDatabase({ name })
    const afterReopen = await reopened.exportBackup()
    const available = await reopened.getPreparation(source.orderId)
    available.groups[1].baseCode = 'CE26100101'
    const reused = await reopened.savePreparation(available)
    const reusedOwner = await reopened.queryCodeOwnership('CE26100101')
    reopened.close()
    return {
      before,
      after,
      afterReopen,
      preservedJob,
      job,
      preservedDisplay,
      retiredOwner,
      orphanOwner,
      activeOwner,
      reused,
      reusedOwner,
    }
  }, snapshot('1001'))
  expect(result.before.history).toHaveLength(1)
  expect(result.after.version).toBe(5)
  expect(result.after.cartonBatches).toEqual([])
  for (const field of [
    'containers',
    'packingReports',
    'reportSources',
    'orderCartonDrafts',
    'shipmentLocks',
    'operationIntents',
  ]) {
    expect(result.after[field]).toEqual([])
    expect(result.afterReopen[field]).toEqual([])
  }
  for (const field of [
    'orders',
    'history',
    'images',
    'preparations',
    'packingPreferences',
    'issuedCodes',
    'allocations',
  ]) {
    expect(result.after[field]).toEqual(result.before[field])
    expect(result.afterReopen[field]).toEqual(result.after[field])
  }
  expect(result.preservedJob).toEqual(result.job)
  expect(result.preservedDisplay.colorScheme).toBe('light')
  expect(result.retiredOwner.owners).toEqual([])
  expect(result.orphanOwner.owners).toEqual([])
  expect(result.activeOwner.owners[0]).toMatchObject({
    status: 'active',
    groupTitle: 'Cup',
    entryIds: ['1', '2'],
  })
  expect(result.reusedOwner.owners[0]).toMatchObject({
    status: 'active',
    groupId: result.reused.groups[1].id,
    groupTitle: 'Bowl',
    entryIds: ['3'],
  })
})
