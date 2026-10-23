import { test, expect } from './extension-fixture.mjs'

function snapshot(orderId) {
  return {
    schemaVersion: 1,
    accountId: 'local',
    orderId,
    sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
    sellerName: 'Synthetic suffix seller',
    sellerMemberLogin: 'synthetic-suffix-seller',
    status: 'Completed',
    purchasedAt: '2026-10-01T12:00:00+08:00',
    observedAt: '2026-10-01T12:00:00.000Z',
    items: ['Red cup', 'Blue cup', 'Bowl'].map((description, index) => ({
      entryId: String(index + 1),
      thumbnail: `https://cbu01.alicdn.com/synthetic-suffix-${index}.png`,
      description,
      title: index < 2 ? 'Cup' : 'Bowl',
      skuProperties: [{ label: 'Color', value: index === 0 ? 'red' : 'blue' }],
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
    window.packingModel = await import('/src/packing-model.js')
    window.databaseName = `synthetic-suffixes-${crypto.randomUUID()}`
    window.library = await openDatabase({ name: window.databaseName })
    // Read every raw store, including preferences and history, so a rejected
    // preview or save cannot hide a write behind a filtered backup export.
    window.readStoredState = () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open(window.databaseName)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const names = [...db.objectStoreNames]
          const tx = db.transaction(names, 'readonly')
          const result = {}
          for (const name of names) {
            const values = tx.objectStore(name).getAll()
            values.onsuccess = () => (result[name] = values.result)
          }
          tx.oncomplete = () => {
            db.close()
            resolve(result)
          }
          tx.onerror = tx.onabort = () => {
            db.close()
            reject(tx.error)
          }
        }
      })
    window.attemptSuffixChange = async (method, drafts, options) => {
      const before = await readStoredState()
      let result, error
      try {
        result = await library[method](drafts, options)
      } catch (failure) {
        error = {
          code: failure.code,
          message: failure.message,
          packingIssue: failure.packingIssue,
        }
      }
      return { before, after: await readStoredState(), result, error }
    }
  })
  return page
}

function expectRejectedUnchanged(result, field, value) {
  expect(result.error).toMatchObject({
    code: 'PACKING_SUFFIX_FIELD_MISMATCH',
    packingIssue: { field, value },
  })
  expect(result.after).toEqual(result.before)
  expect(result.result).toBeUndefined()
}

test('preview and save reject swapped suffixes before reservation conflicts without writing any store', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(
    async (sources) => {
      for (const source of sources) await library.saveSnapshot(source)
      const saved = await library.savePreparations(
        sources.map((source) =>
          packingModel.createPreparation(source, '2026-10')
        )
      )
      const results = []
      for (const [field, value] of [
        ['sizeSuffix', 'A'],
        ['variantSuffix', 'S'],
      ])
        for (const method of ['previewPreparations', 'savePreparations']) {
          const invalid = structuredClone(saved[0])
          invalid.groups[0].variants[0][field] = value
          // This also collides with the other order's base reservation. The
          // actionable suffix-field error must be reported before ownership.
          invalid.groups[0].baseCode = saved[1].groups[0].baseCode
          const valid = structuredClone(saved[1])
          valid.groups[0].category = 'Otherwise valid batch edit'
          results.push({
            method,
            field,
            value,
            groupId: invalid.groups[0].id,
            variantId: invalid.groups[0].variants[0].id,
            attempt: await attemptSuffixChange(method, [valid, invalid]),
          })
        }
      return results
    },
    [snapshot('1001'), snapshot('1002')]
  )
  for (const entry of result) {
    expectRejectedUnchanged(
      entry.attempt,
      entry.field === 'sizeSuffix' ? 'size' : 'variant',
      entry.value
    )
    expect(entry.attempt.error.packingIssue).toMatchObject({
      orderId: '1001',
      groupId: entry.groupId,
      variantId: entry.variantId,
    })
  }
})

test('repository preview and save honor configured size suffixes and preserve custom endings', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    await library.savePackingPreferences({
      settings: {},
      vocabulary: [],
      sizeVocabulary: [
        { match: 'Configured miniature', suffix: 'A' },
        { match: 'Configured narrow', suffix: 'NARROW' },
      ],
    })
    let current = await library.savePreparation(
      packingModel.createPreparation(source, '2026-10')
    )
    const accepted = []
    for (const suffix of ['A', 'NARROW', 'A1', 'X']) {
      const draft = structuredClone(current)
      draft.groups[0].variants[0].sizeSuffix = suffix
      const preview = await attemptSuffixChange('previewPreparations', [draft])
      current = await library.savePreparation(draft)
      accepted.push({ suffix, preview, current })
    }
    const invalid = structuredClone(current)
    invalid.groups[0].variants[1].variantSuffix = 'NARROW'
    const rejected = []
    for (const method of ['previewPreparations', 'savePreparations'])
      rejected.push(await attemptSuffixChange(method, [invalid]))
    return { accepted, rejected }
  }, snapshot('1001'))
  for (const entry of result.accepted) {
    expect(entry.preview.error).toBeUndefined()
    expect(entry.preview.after).toEqual(entry.preview.before)
    expect(entry.preview.result[0].groups[0].variants[0].sizeSuffix).toBe(
      entry.suffix
    )
    expect(entry.current.groups[0].variants[0].sizeSuffix).toBe(entry.suffix)
  }
  for (const rejected of result.rejected)
    expectRejectedUnchanged(rejected, 'variant', 'NARROW')
})

test('legacy suffixes survive restore and unrelated saves but cannot move to new source entries by reusing IDs', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    const draft = packingModel.createPreparation(source, '2026-10')
    draft.groups[0].variants[0].sizeSuffix = 'A'
    // Structural allocation represents a historical backup; authored-edit
    // validation must not rewrite its existing codes during restore.
    const legacy = packingModel.allocatePreparation(draft, [], [], {
      snapshot: source,
    })
    legacy.preparation.revision = 1
    const backup = await library.exportBackup()
    backup.preparations = [legacy.preparation]
    backup.allocations = legacy.allocations
    backup.issuedCodes = legacy.issuedCodes
    await library.restoreBackup(backup)
    const restored = (await library.listPreparations())[0]
    const edit = structuredClone(restored)
    edit.groups[0].category = 'Unrelated legacy edit'
    const preview = await attemptSuffixChange('previewPreparations', [edit])
    const saved = await library.savePreparation(edit)
    const transfer = structuredClone(saved)
    const [first, second] = transfer.groups[0].variants
    ;[first.entryIds, second.entryIds] = [second.entryIds, first.entryIds]
    const rejected = []
    for (const method of ['previewPreparations', 'savePreparations'])
      rejected.push(await attemptSuffixChange(method, [transfer]))
    return { restored, preview, saved, rejected }
  }, snapshot('1001'))
  expect(result.restored.groups[0].variants[0].sizeSuffix).toBe('A')
  expect(result.preview.error).toBeUndefined()
  expect(result.preview.after).toEqual(result.preview.before)
  expect(result.saved.groups[0].category).toBe('Unrelated legacy edit')
  expect(result.saved.groups[0].variants[0].sizeSuffix).toBe('A')
  for (const rejected of result.rejected)
    expectRejectedUnchanged(rejected, 'size', 'A')
})

test('historical suffix baselines allow scoped Undo in preview and save without allowing new swapped fields', async ({
  extension,
}) => {
  const page = await openTestDatabase(extension)
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    const draft = packingModel.createPreparation(source, '2026-10')
    draft.groups[0].variants[0].sizeSuffix = 'A'
    const legacy = packingModel.allocatePreparation(draft, [], [], {
      snapshot: source,
    })
    legacy.preparation.revision = 1
    const backup = await library.exportBackup()
    backup.preparations = [legacy.preparation]
    backup.allocations = legacy.allocations
    backup.issuedCodes = legacy.issuedCodes
    await library.restoreBackup(backup)
    const restored = (await library.listPreparations())[0]
    const corrected = structuredClone(restored)
    corrected.groups[0].variants[0].sizeSuffix = 'S'
    const current = await library.savePreparation(corrected)
    const restore = structuredClone(current)
    restore.groups[0].variants[0].sizeSuffix = 'A'
    restore.groups[0].variants[0].variantSuffix = 'C'
    const denied = []
    for (const method of ['previewPreparations', 'savePreparations'])
      denied.push(await attemptSuffixChange(method, [restore]))
    const options = { suffixBaselines: [restored] }
    const preview = await attemptSuffixChange(
      'previewPreparations',
      [restore],
      options
    )
    const saved = await attemptSuffixChange(
      'savePreparations',
      [restore],
      options
    )
    const newMismatch = structuredClone(saved.result[0])
    newMismatch.groups[0].variants[0].sizeSuffix = 'B'
    const rejected = []
    for (const method of ['previewPreparations', 'savePreparations'])
      rejected.push(await attemptSuffixChange(method, [newMismatch], options))

    const next = structuredClone(saved.result[0])
    const wrongAccount = { ...restored, accountId: 'different-account' }
    const wrongOrder = { ...restored, orderId: '1002' }
    const invalidBaselines = []
    for (const suffixBaselines of [
      'invalid',
      [wrongAccount],
      [wrongOrder],
      [restored, restored],
      [{ ...restored, groups: 'invalid' }],
    ])
      for (const method of ['previewPreparations', 'savePreparations'])
        invalidBaselines.push(
          await attemptSuffixChange(method, [next], { suffixBaselines })
        )
    return { denied, preview, saved, rejected, invalidBaselines }
  }, snapshot('1001'))
  for (const denied of result.denied)
    expectRejectedUnchanged(denied, 'size', 'A')
  expect(result.preview.error).toBeUndefined()
  expect(result.preview.after).toEqual(result.preview.before)
  expect(result.saved.error).toBeUndefined()
  for (const success of [result.preview, result.saved])
    expect(success.result[0].groups[0].variants[0]).toMatchObject({
      variantSuffix: 'C',
      sizeSuffix: 'A',
    })
  for (const rejected of result.rejected)
    expectRejectedUnchanged(rejected, 'size', 'B')
  for (const rejected of result.invalidBaselines) {
    expect(rejected.error?.message).toBeTruthy()
    expect(rejected.result).toBeUndefined()
    expect(rejected.after).toEqual(rejected.before)
  }
})
