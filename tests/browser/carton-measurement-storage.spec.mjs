import { test, expect } from './extension-fixture.mjs'

const photo =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2WZ4kAAAAASUVORK5CYII='

const input = {
  filename: '4321.xlsx',
  sheetName: 'Order',
  purchaseDate: '2026-10-01',
  total: '120.00',
  store: {
    key: 'market:4321',
    name: 'Synthetic store',
    number: '4321',
    kind: 'market',
  },
  rows: [1, 2].map((group) => ({
    row: group + 4,
    group: String(group),
    title: `Synthetic cup ${group}`,
    description: `Synthetic cup ${group}`,
    boxes: '2',
    perbox: '10',
    quantity: '20',
    price: '3.00',
    amount: '60.00',
    kg: '4',
    cbm: '0.05',
    len: '50',
    wid: '40',
    ht: '25',
    photos: [photo],
  })),
}

async function openRepository(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async () => {
    const { openDatabase } = await import('/src/database.js')
    window.packingModel = await import('/src/packing-model.js')
    window.openOrderDatabase = openDatabase
    window.databaseName = `synthetic-measurements-${crypto.randomUUID()}`
    window.repository = await openDatabase({ name: window.databaseName })
  })
  return page
}

test('partial carton measurements preserve source cartons, other fields and products', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(async (input) => {
    const imported = await repository.importStoreOrder(input)
    const orderId = imported.snapshot.orderId
    await repository.setUnitsPerCarton(orderId, '1', '12')
    const saved = await repository.setCartonMeasurements(orderId, [
      { entryId: '1', before: { kg: '4' }, after: { kg: '5.25' } },
      { entryId: '2', before: { cbm: '0.05' }, after: { cbm: '0.06' } },
    ])
    const noOp = await repository.setCartonMeasurements(orderId, [])
    const sameValue = await repository.setCartonMeasurements(orderId, [
      { entryId: '1', before: { kg: '5.25' }, after: { kg: '5.25' } },
    ])
    const cleared = await repository.setCartonMeasurements(orderId, [
      { entryId: '1', before: { kg: '5.25' }, after: { kg: '' } },
    ])
    return { imported, saved, noOp, sameValue, cleared }
  }, input)
  expect(result.saved.snapshot).toEqual(result.imported.snapshot)
  expect(result.saved.cartonDetails['1']).toEqual({
    boxes: '2',
    kg: '5.25',
    cbm: '0.05',
    len: '50',
    wid: '40',
    ht: '25',
  })
  expect(result.saved.cartonDetails['2']).toEqual({
    boxes: '2',
    kg: '4',
    cbm: '0.06',
    len: '50',
    wid: '40',
    ht: '25',
  })
  expect(result.saved.unitsPerCarton['1']).toBe(12)
  expect(result.noOp).toEqual(result.saved)
  expect(result.sameValue).toEqual(result.saved)
  expect(result.cleared.cartonDetails['1']).not.toHaveProperty('kg')
  expect(result.cleared.cartonDetails['1'].boxes).toBe('2')
  expect(result.cleared.cartonDetails['2']).toEqual(
    result.saved.cartonDetails['2']
  )
})

test('measurement writes compare only edited fields and reject stale edits atomically', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(async (input) => {
    const imported = await repository.importStoreOrder(input)
    const orderId = imported.snapshot.orderId
    const concurrent = await openOrderDatabase({ name: databaseName })
    await concurrent.setCartonMeasurements(orderId, [
      { entryId: '1', before: { cbm: '0.05' }, after: { cbm: '0.08' } },
    ])
    // A stale copy of an unrelated field must not prevent or overwrite this edit.
    const saved = await repository.setCartonMeasurements(orderId, [
      { entryId: '1', before: { kg: '4' }, after: { kg: '5' } },
    ])
    await concurrent.setCartonMeasurements(orderId, [
      { entryId: '2', before: { kg: '4' }, after: { kg: '6' } },
    ])
    const beforeFailure = await repository.getOrder(orderId)
    let error
    try {
      await repository.setCartonMeasurements(orderId, [
        { entryId: '1', before: { kg: '5' }, after: { kg: '8' } },
        { entryId: '2', before: { kg: '4' }, after: { kg: '9' } },
      ])
    } catch (failure) {
      error = { message: failure.message, code: failure.code }
    }
    const afterFailure = await repository.getOrder(orderId)
    concurrent.close()
    return { saved, beforeFailure, afterFailure, error }
  }, input)
  expect(result.saved.cartonDetails['1'].kg).toBe('5')
  expect(result.saved.cartonDetails['1'].cbm).toBe('0.08')
  expect(result.afterFailure).toEqual(result.beforeFailure)
  expect(result.error).toEqual({
    message:
      'Carton measurements changed in another tab. Reload before saving your edits.',
    code: 'CARTON_MEASUREMENTS_CONFLICT',
  })
})

test('invalid fields and incomplete or invalid dimensions do not save partial measurements', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(async (input) => {
    const imported = await repository.importStoreOrder(input)
    const orderId = imported.snapshot.orderId
    const invalid = [
      [{ entryId: '1', before: { boxes: '2' }, after: { boxes: '3' } }],
      [{ entryId: '1', before: { kg: '4' }, after: { kg: '-1' } }],
      [{ entryId: '1', before: { kg: '4' }, after: { cbm: '1' } }],
      [{ entryId: '1', before: { kg: '4' }, after: { kg: 5 } }],
      [{ entryId: '1', before: { len: '50' }, after: { len: '' } }],
      [{ entryId: '99', before: { kg: '' }, after: { kg: '5' } }],
      [
        { entryId: '1', before: { kg: '4' }, after: { kg: '5' } },
        { entryId: '1', before: { kg: '4' }, after: { kg: '6' } },
      ],
    ]
    const errors = []
    for (const edits of invalid) {
      try {
        await repository.setCartonMeasurements(orderId, edits)
      } catch (error) {
        errors.push(error.message)
      }
    }
    const unchanged = await repository.getOrder(orderId)
    const cleared = await repository.setCartonMeasurements(orderId, [
      {
        entryId: '1',
        before: { len: '50', wid: '40', ht: '25' },
        after: { len: '', wid: '', ht: '' },
      },
    ])
    return { imported, unchanged, cleared, errors }
  }, input)
  expect(result.errors).toHaveLength(7)
  expect(result.unchanged).toEqual(result.imported)
  expect(result.cleared.cartonDetails['1']).toEqual({
    boxes: '2',
    kg: '4',
    cbm: '0.05',
  })
})

test('preparation previews validate measurement rollback without writes and save both atomically', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(async (input) => {
    const imported = await repository.importStoreOrder(input)
    const orderId = imported.snapshot.orderId
    const original = await repository.savePreparation(
      packingModel.createPreparation(imported.snapshot, '2026-10')
    )
    await repository.setCartonMeasurements(orderId, [
      { entryId: '1', before: { kg: '4' }, after: { kg: '5.25' } },
    ])
    const draft = structuredClone(original)
    draft.groups[0].category = 'Edited category'
    const options = {
      cartonMeasurements: [
        {
          orderId,
          edits: [{ entryId: '1', before: { kg: '5.25' }, after: { kg: '4' } }],
        },
      ],
    }
    const before = await repository.exportBackup()
    const preview = await repository.previewPreparations([draft], options)
    const afterPreview = await repository.exportBackup()
    const saved = await repository.savePreparations([draft], options)
    const afterSaved = await repository.exportBackup()
    // A stale preparation cannot apply an otherwise valid carton rollback.
    const staleOptions = structuredClone(options)
    staleOptions.cartonMeasurements[0].edits[0] = {
      entryId: '1',
      before: { kg: '4' },
      after: { kg: '10' },
    }
    let staleError
    try {
      await repository.savePreparations([draft], staleOptions)
    } catch (error) {
      staleError = error.message
    }
    const afterFailure = await repository.exportBackup()
    return {
      before,
      preview,
      afterPreview,
      saved,
      afterSaved,
      afterFailure,
      staleError,
    }
  }, input)
  for (const field of [
    'orders',
    'preparations',
    'allocations',
    'issuedCodes',
  ]) {
    expect(result.afterPreview[field]).toEqual(result.before[field])
    expect(result.afterFailure[field]).toEqual(result.afterSaved[field])
  }
  expect(result.preview[0].revision).toBe(1)
  expect(result.saved[0].revision).toBe(2)
  expect(result.saved[0].groups[0].category).toBe('Edited category')
  expect(result.afterSaved.orders[0].cartonDetails['1'].kg).toBe('4')
  expect(result.staleError).toContain('Preparation changed in another tab')
})

test('one conflicting order prevents all preparation and measurement changes in a batch', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(async (input) => {
    const orders = [
      await repository.importStoreOrder(input),
      await repository.importStoreOrder(input),
    ]
    const originals = await repository.savePreparations(
      orders.map((order) =>
        packingModel.createPreparation(order.snapshot, '2026-10')
      )
    )
    const drafts = structuredClone(originals)
    for (const draft of drafts) draft.groups[0].category = 'Should not save'
    const options = {
      cartonMeasurements: orders.map((order) => ({
        orderId: order.snapshot.orderId,
        edits: [{ entryId: '1', before: { kg: '4' }, after: { kg: '8' } }],
      })),
    }
    await repository.setCartonMeasurements(orders[1].snapshot.orderId, [
      { entryId: '1', before: { kg: '4' }, after: { kg: '6' } },
    ])
    const before = await repository.exportBackup()
    const errors = []
    for (const method of ['previewPreparations', 'savePreparations']) {
      try {
        await repository[method](drafts, options)
      } catch (error) {
        errors.push(error.code)
      }
    }
    const after = await repository.exportBackup()
    return { before, after, errors }
  }, input)
  expect(result.errors).toEqual([
    'CARTON_MEASUREMENTS_CONFLICT',
    'CARTON_MEASUREMENTS_CONFLICT',
  ])
  for (const field of ['orders', 'preparations', 'allocations', 'issuedCodes'])
    expect(result.after[field]).toEqual(result.before[field])
})
