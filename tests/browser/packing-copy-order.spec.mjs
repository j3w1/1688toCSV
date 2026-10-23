import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  allocatePreparation,
  barcodeValue,
  createPreparation,
  reorderPreparationGroups,
} from '../../src/packing-model.js'
import { revealCopyActions } from './copy-actions-helpers.mjs'

async function exportBackup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}

test('Orders barcode and carton previews agree on source/code order while preserving legacy packing arrangement metadata', async ({
  extension,
}) => {
  const demos = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const records = demos.slice(0, 2).map((record, orderIndex) => ({
    ...record,
    changedEntryIds: [],
    snapshot: {
      ...record.snapshot,
      sellerMemberLogin: `synthetic-copy-order-${orderIndex}`,
      items: record.snapshot.items.slice(0, 2).map((item, itemIndex) => ({
        ...item,
        title: `合成花瓶 ${orderIndex}-${itemIndex}`,
        description: `合成花瓶 ${orderIndex}-${itemIndex}`,
        skuProperties: [],
        price: '10.00',
        quantity: '1',
        sourceDiscount: '0.00',
        allocatedDiscount: '0.00',
        discount: '0.00',
      })),
      totals: {
        goodsGross: '20.00',
        shipping: '0.00',
        sourceDiscount: '0.00',
        orderAdjustment: '0.00',
        goodsNet: '20.00',
        payable: '20.00',
      },
    },
  }))
  let allocations = []
  let issuedCodes = []
  const preparations = records.map(({ snapshot }, orderIndex) => {
    const draft = createPreparation(snapshot, '2026-10')
    for (const group of draft.groups) {
      group.spanishName = 'FLORERO'
      group.category = '花瓶'
      group.naming = {
        spanishName: { source: 'manual', value: group.spanishName },
        category: { source: 'manual', value: group.category },
      }
    }
    const allocated = allocatePreparation(draft, allocations, issuedCodes, {
      snapshot,
    })
    allocations = allocated.allocations
    issuedCodes = allocated.issuedCodes
    const preparation = reorderPreparationGroups(
      allocated.preparation,
      allocated.preparation.groups.map(({ id }) => id).reverse()
    )
    preparation.revision = 1
    preparation.packingPosition = records.length - orderIndex - 1
    preparation.packingManualReordered = true
    return preparation
  })
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    {
      format: '1688-order-library',
      version: 3,
      exportedAt: '2026-10-15T04:00:00.000Z',
      orders: records,
      history: [],
      images: [],
      preparations,
      allocations,
      issuedCodes,
    }
  )
  expect(restored.ok, restored.error).toBe(true)

  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(4)
  // Orders and its label previews follow current source/code order. Legacy
  // packing positions remain backed up without driving the active output.
  expect(
    await rows.evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-selection-key'))
    )
  ).toEqual(
    records.flatMap(({ snapshot }) =>
      snapshot.items.map((item) =>
        JSON.stringify([
          snapshot.accountId || 'local',
          snapshot.orderId,
          item.entryId,
        ])
      )
    )
  )
  await page.locator('#select-rows').click()
  const saved = await exportBackup(extension)
  for (const preparation of preparations) {
    const retained = saved.preparations.find(
      (entry) => entry.orderId === preparation.orderId
    )
    expect(retained.packingPosition).toBe(preparation.packingPosition)
    expect(retained.packingManualReordered).toBe(true)
    expect(retained.groups.map(({ id }) => id)).toEqual(
      preparation.groups.map(({ id }) => id)
    )
  }
  const packingGroups = [...preparations]
    .sort((a, b) => a.packingPosition - b.packingPosition)
    .flatMap(({ groups }) => groups)
  const sourceOrderGroups = preparations.flatMap(({ groups }) =>
    [...groups].reverse()
  )
  expect(packingGroups.map(({ baseCode }) => baseCode)).not.toEqual(
    sourceOrderGroups.map(({ baseCode }) => baseCode)
  )

  const pageCodes = ['CE26100101', 'CE26100102', 'CE26100201', 'CE26100202']
  expect(sourceOrderGroups.map(({ baseCode }) => baseCode)).toEqual(pageCodes)
  const previews = []
  for (const [buttonId, expected] of [
    [
      'copy-barcodes',
      sourceOrderGroups.flatMap((group) =>
        group.variants.map((variant) => barcodeValue(group, variant))
      ),
    ],
    ['copy-carton-marks', sourceOrderGroups.map(({ baseCode }) => baseCode)],
  ]) {
    await revealCopyActions(page)
    await expect(page.locator(`#${buttonId}`)).toBeEnabled()
    await page.locator(`#${buttonId}`).click()
    const dialog = page.locator('.image-copy-dialog')
    await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
    await expect(dialog.locator('figcaption .ce-code')).toHaveText(expected)
    previews.push(await dialog.locator('figcaption .ce-code').allTextContents())
    await expect(dialog.locator('.copy-preview img')).toHaveCount(4)
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(dialog).not.toBeVisible()
  }

  expect(previews).toEqual([pageCodes, pageCodes])
  const after = await exportBackup(extension)
  expect(after.orders).toEqual(saved.orders)
  expect(after.preparations).toEqual(saved.preparations)
})
