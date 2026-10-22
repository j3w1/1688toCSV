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
  expect(
    result.after.issuedCodes.some((entry) => entry.code === 'CE26100101A')
  ).toBe(false)
  expect(
    result.after.issuedCodes.some((entry) => entry.code === 'CE26100101B')
  ).toBe(true)
  expect(
    result.after.issuedCodes.some((entry) => entry.code === 'CE26120101')
  ).toBe(true)
  for (const reserved of result.before.issuedCodes.filter(
    (entry) => entry.groupId === bowl.id
  ))
    expect(result.after.issuedCodes).toContainEqual(reserved)
})

test('released codes can move to another product while current conflicts reject atomically and order deletion releases ownership', async ({
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
    await library.saveSnapshot(source)
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
    const otherSource = {
      ...source,
      orderId: '2002',
      sourceUrl: source.sourceUrl.replace(source.orderId, '2002'),
    }
    await restoredLibrary.saveSnapshot(otherSource)
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
    await library.saveSnapshot(source)
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
  // Exercise the packaged workspace startup and ordinary Prepare entry path.
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
    await workspace.locator('#prepare-orders').click()
    await expect(workspace.locator('#packing-view')).toBeVisible()
    await expect
      .poll(() =>
        workspace
          .locator('.group-name-editor')
          .evaluateAll((inputs) => inputs.map((input) => input.value))
      )
      .toEqual(result.expected.groups.map((group) => group.spanishName))
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
    await library.saveSnapshot(source)
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
    await library.saveSnapshot(source)
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
  expect(result.after.version).toBe(4)
  expect(result.after.cartonBatches).toEqual([])
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
