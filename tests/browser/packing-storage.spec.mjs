import { test, expect } from './extension-fixture.mjs'

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
  })
  return page
}

test('packing preview reserves nothing and multi-order month moves fail atomically on stale revisions', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(
    async (sources) => {
      for (const source of sources) await library.saveSnapshot(source)
      const originals = await library.savePreparations(
        sources.map((source) =>
          packingModel.createPreparation(source, '2026-10')
        )
      )
      const before = await library.exportBackup()
      const plan = packingModel.planSelectedPreparations(
        sources.map((source, index) => ({
          snapshot: source,
          preparation: originals[index],
          entryIds: index === 0 ? ['2'] : ['1', '2', '3'],
        })),
        '2026-12'
      )
      const preview = await library.previewPreparations(plan.preparations, {
        capturePrevious: true,
        resetDefaults: true,
      })
      const afterPreview = await library.exportBackup()
      const concurrent = await openOrderDatabase({ name: databaseName })
      const changed = structuredClone(originals[1])
      changed.groups[0].category = 'Changed elsewhere'
      await concurrent.savePreparation(changed)
      const beforeFailure = await library.exportBackup()
      let error
      try {
        await library.savePreparations(preview, {
          capturePrevious: true,
          resetDefaults: true,
        })
      } catch (failure) {
        error = failure.message
      }
      const afterFailure = await library.exportBackup()
      const current = await library.listPreparations()
      const nextPlan = packingModel.planSelectedPreparations(
        sources.map((source) => ({
          snapshot: source,
          preparation: current.find(
            (entry) => entry.orderId === source.orderId
          ),
          entryIds:
            source.orderId === sources[0].orderId ? ['2'] : ['1', '2', '3'],
        })),
        '2026-12'
      )
      const saved = await library.savePreparations(nextPlan.preparations, {
        capturePrevious: true,
        resetDefaults: true,
      })
      concurrent.close()
      return {
        before,
        afterPreview,
        preview,
        beforeFailure,
        afterFailure,
        error,
        saved,
      }
    },
    [snapshot('1001'), snapshot('1002')]
  )
  for (const field of ['preparations', 'allocations', 'issuedCodes']) {
    expect(result.afterPreview[field]).toEqual(result.before[field])
    expect(result.afterFailure[field]).toEqual(result.beforeFailure[field])
  }
  expect(result.preview.map((entry) => entry.revision)).toEqual([1, 1])
  expect(result.error).toContain('changed in another tab')
  expect(result.saved.map((entry) => entry.revision)).toEqual([2, 3])
  expect(
    result.saved[0].groups.map((entry) => [entry.month, entry.baseCode])
  ).toEqual([
    ['2026-10', 'CE26100101'],
    ['2026-12', 'CE26120101'],
    ['2026-10', 'CE26100102'],
  ])
  expect(result.saved[1].groups.map((entry) => entry.baseCode)).toEqual([
    'CE26120102',
    'CE26120103',
  ])
  expect(result.saved[0].previousPacking.groups[0].variants).toHaveLength(2)
})

test('mixed-month batches checkpoint only moved orders and preserve existing manual order, codes and history', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(
    async (sources) => {
      for (const source of sources) await library.saveSnapshot(source)
      const initial = await library.savePreparations(
        sources.map((source) =>
          packingModel.createPreparation(source, '2026-10')
        )
      )
      const firstMove = packingModel.planSelectedPreparations(
        [
          {
            snapshot: sources[1],
            preparation: initial[1],
            entryIds: ['1', '2', '3'],
          },
        ],
        '2026-12'
      )
      const [movedEarlier] = await library.savePreparations(
        firstMove.preparations,
        { capturePrevious: true, resetDefaults: true }
      )
      const manual = packingModel.reorderPreparationGroups(
        movedEarlier,
        movedEarlier.groups.map((group) => group.id).reverse()
      )
      manual.groups[0].baseCode = 'CE26129998'
      manual.groups[0].spanishName = 'NOMBRE MANUAL'
      const unchanged = await library.savePreparation(manual)
      const plan = packingModel.planSelectedPreparations(
        [
          {
            snapshot: sources[0],
            preparation: initial[0],
            entryIds: ['1', '2', '3'],
          },
          {
            snapshot: sources[1],
            preparation: unchanged,
            entryIds: ['1', '2', '3'],
          },
        ],
        '2026-12'
      )
      const options = {
        capturePrevious: [sources[0].orderId],
        resetDefaults: [sources[0].orderId],
      }
      const before = await library.exportBackup()
      const preview = await library.previewPreparations(
        plan.preparations,
        options
      )
      const afterPreview = await library.exportBackup()
      const errors = []
      for (const invalid of [
        { capturePrevious: [sources[0].orderId, '9999'] },
        { resetDefaults: [sources[0].orderId, sources[0].orderId] },
        { capturePrevious: sources[0].orderId },
        { resetDefaults: [1] },
      ]) {
        try {
          await library.savePreparations(plan.preparations, invalid)
        } catch (error) {
          errors.push(error.message)
        }
      }
      const afterInvalid = await library.exportBackup()
      const saved = await library.savePreparations(preview, options)
      return {
        initial,
        unchanged,
        before,
        preview,
        afterPreview,
        afterInvalid,
        saved,
        errors,
      }
    },
    [snapshot('1001'), snapshot('1002')]
  )
  for (const field of ['preparations', 'allocations', 'issuedCodes']) {
    expect(result.afterPreview[field]).toEqual(result.before[field])
    expect(result.afterInvalid[field]).toEqual(result.before[field])
  }
  expect(result.errors).toEqual([
    'capturePrevious contains an order outside this preparation batch',
    'resetDefaults contains duplicate values',
    'capturePrevious must be an array',
    'resetDefaults must be a string with a value',
  ])
  const [moved, unchanged] = result.saved
  expect(
    moved.groups.every(
      (group) =>
        group.month === '2026-12' && group.baseCode.startsWith('CE2612')
    )
  ).toBe(true)
  expect(moved.previousPacking.groups).toEqual(result.initial[0].groups)
  expect(moved.previousPacking.defaults).toEqual(
    result.initial[0].defaultPacking
  )
  expect(moved.defaultPacking.groups).toEqual(moved.groups)
  for (const candidate of [result.preview[1], unchanged]) {
    expect(candidate.groups).toEqual(result.unchanged.groups)
    expect(candidate.defaultPacking).toEqual(result.unchanged.defaultPacking)
    expect(candidate.previousPacking).toEqual(result.unchanged.previousPacking)
  }
  expect(unchanged.groups[0].baseCode).toBe('CE26129998')
  expect(unchanged.groups[0].spanishName).toBe('NOMBRE MANUAL')
  expect(unchanged.groups[0].manualReordered).toBe(true)
  expect(unchanged.revision).toBe(result.unchanged.revision + 1)
})

test('moving part of an order preserves its manual group and product order outside the selected rows', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    const initial = await library.savePreparation(
      packingModel.createPreparation(source, '2026-10')
    )
    let manual = packingModel.reorderPreparationGroups(
      initial,
      initial.groups.map((group) => group.id).reverse()
    )
    manual = packingModel.reorderPreparationVariants(
      manual,
      manual.groups[1].id,
      manual.groups[1].variants.map((variant) => variant.id).reverse()
    )
    manual.groups[0].baseCode = 'CE26109998'
    manual.groups[0].spanishName = 'NOMBRE MANUAL'
    const original = await library.savePreparation(manual)
    const plan = packingModel.planSelectedPreparations(
      [{ snapshot: source, preparation: original, entryIds: ['1'] }],
      '2026-12'
    )
    const options = {
      capturePrevious: [source.orderId],
      resetDefaults: [source.orderId],
    }
    const before = await library.exportBackup()
    const [preview] = await library.previewPreparations(
      plan.preparations,
      options
    )
    const afterPreview = await library.exportBackup()
    const [saved] = await library.savePreparations([preview], options)
    const after = await library.exportBackup()
    return { original, plan, preview, saved, before, afterPreview, after }
  }, snapshot('1001'))
  for (const field of ['preparations', 'allocations', 'issuedCodes'])
    expect(result.afterPreview[field]).toEqual(result.before[field])
  const [bowl, cup] = result.original.groups
  for (const candidate of [result.preview, result.saved]) {
    expect(candidate.groups.map((group) => group.id)).toEqual(
      result.plan.preparations[0].groups.map((group) => group.id)
    )
    expect(candidate.groups[0]).toEqual({ ...bowl, month: '2026-10' })
    expect(candidate.groups[1]).toEqual({
      ...cup,
      month: '2026-10',
      variants: cup.variants.filter((variant) => variant.entryIds[0] === '2'),
    })
    expect(candidate.groups[0].manualReordered).toBe(true)
    expect(candidate.groups[1].variants[0].manualReordered).toBe(true)
    expect(candidate.groups[2].baseCode).toBe('CE26120101')
    expect(candidate.groups[2].variants[0].entryIds).toEqual(['1'])
    expect(candidate.previousPacking.groups).toEqual(result.original.groups)
    expect(candidate.defaultPacking.groups.map((group) => group.id)).toEqual([
      candidate.groups[2].id,
      cup.id,
      bowl.id,
    ])
    expect(
      candidate.defaultPacking.groups.some((group) => group.manualReordered)
    ).toBe(false)
  }
  expect(result.after.orders).toEqual(result.before.orders)
  for (const reserved of result.before.issuedCodes)
    expect(result.after.issuedCodes).toContainEqual(reserved)
})

test('code ownership distinguishes active and historical codes and retains photos after order deletion', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    const original = await library.savePreparation(
      packingModel.createPreparation(source, '2026-10')
    )
    const code = original.groups[0].baseCode
    const active = await library.queryCodeOwnership(code)
    const changed = await library.savePreparation(
      packingModel.regeneratePreparationCode(original, original.groups[0].id)
    )
    const historical = await library.queryCodeOwnership(code)
    const conflicting = structuredClone(changed)
    conflicting.groups[1].baseCode = code
    let conflict
    try {
      await library.savePreparation(conflicting)
    } catch (error) {
      conflict = { code: error.code, detail: error.conflict }
    }
    await library.removeOrders([source.orderId])
    const deleted = await library.queryCodeOwnership(code)
    const backup = await library.exportBackup()
    return { active, historical, deleted, conflict, backup }
  }, snapshot('1001'))
  expect(result.active.owners[0].status).toBe('active')
  expect(result.historical.owners[0].status).toBe('historical')
  expect(result.historical.owners[0].currentBaseCode).toBe('CE26100103')
  expect(result.conflict.code).toBe('PACKING_CODE_CONFLICT')
  expect(result.conflict.detail.owner.orderId).toBe('1001')
  expect(result.deleted.owners[0]).toMatchObject({
    status: 'historical',
    orderExists: false,
    groupExists: false,
    sellerName: 'Synthetic seller',
    groupTitle: 'Cup',
    entryIds: ['1', '2'],
  })
  expect(result.deleted.owners[0].photos).toHaveLength(2)
  expect(
    result.backup.issuedCodes.some((entry) => entry.code === 'CE26100101')
  ).toBe(true)
})

test('default and previous packing restore codes with reserved ownership through backup round trips', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    const first = await library.savePreparation(
      packingModel.createPreparation(source, '2026-10')
    )
    const plan = packingModel.planSelectedPreparations(
      [{ snapshot: source, preparation: first, entryIds: ['2'] }],
      '2026-12'
    )
    const [moved] = await library.savePreparations(plan.preparations, {
      capturePrevious: true,
      resetDefaults: true,
    })
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
    const tampered = structuredClone(backup)
    tampered.preparations[0].previousPacking.groups[0].baseCode = 'CE26100199'
    let failure
    try {
      await restoredLibrary.restoreBackup(tampered)
    } catch (error) {
      failure = error.message
    }
    const unchanged = await restoredLibrary.getPreparation(source.orderId)
    restoredLibrary.close()
    return { moved, reset, restored, restoredPrevious, unchanged, failure }
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
  expect(result.failure).toContain('missing issued code reservations')
  expect(result.unchanged).toEqual(result.restoredPrevious)
})

test('packing-only backups keep complete included preparations and all issued reservations', async ({
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
      for (const source of sources) await library.saveSnapshot(source)
      const preparations = await library.savePreparations(
        sources.map((source) =>
          packingModel.createPreparation(source, '2026-10')
        )
      )
      const plan = packingModel.planSelectedPreparations(
        [
          {
            snapshot: sources[0],
            preparation: preparations[0],
            entryIds: ['2'],
          },
        ],
        '2026-12'
      )
      await library.savePreparations(plan.preparations, {
        capturePrevious: true,
        resetDefaults: true,
      })
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
  expect(result.scoped.issuedCodes).toEqual(result.full.issuedCodes)
  expect(result.scoped.allocations).toEqual(result.full.allocations)
  expect(result.output.preparations).toEqual(result.scoped.preparations)
  expect(result.output.issuedCodes).toEqual(result.full.issuedCodes)
  expect(result.empty.orders).toEqual([])
  expect(result.empty.preparations).toEqual([])
  expect(result.empty.images).toEqual([])
  expect(result.empty.issuedCodes).toEqual(result.full.issuedCodes)
})

test('new memberships extend defaults and reserve their original-base barcodes after a manual code edit', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    const first = await library.savePreparation(
      packingModel.createPreparation(
        { ...source, items: [source.items[0]] },
        '2026-10'
      )
    )
    const edited = await library.savePreparation(
      packingModel.regeneratePreparationCode(first, first.groups[0].id)
    )
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
    const reset = await library.savePreparation(
      packingModel.restoreDefaultPacking(added),
      { preserveNaming: true }
    )
    return {
      first,
      extended,
      added,
      reset,
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
  expect(result.reset.groups[0].baseCode).toBe('CE26100101')
  expect(
    result.reset.groups.flatMap((group) =>
      group.variants.flatMap((variant) => variant.entryIds)
    )
  ).toEqual(['1', '2', '3'])
  expect(result.originalCodeOwner.owners[0].status).toBe('active')
})
