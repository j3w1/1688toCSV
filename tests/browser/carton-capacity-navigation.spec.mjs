import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  assignSelectedPurchaseCodes,
  editOrderProduct,
  closeOrderProduct,
  libraryBackup,
  openOrderReconciliation,
  productGridRow,
  realOrderContext,
} from './smart-workspace-helpers.mjs'

async function prepare(extension) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const result = await extension.inspector.evaluate(
    (record) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders: [record],
          history: [],
          images: [],
        },
      }),
    record
  )
  expect(result.ok, result.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await page.locator('#select-rows').click()
  await assignSelectedPurchaseCodes(page)
  return { page, record }
}

const refFor = (record, index) => ({
  accountId: 'local',
  orderId: record.snapshot.orderId,
  entryId: record.snapshot.items[index].entryId,
})

test('Orders capacity edits preserve pending names and source quantities, with no editable Packing capacity', async ({
  extension,
}) => {
  const { page, record } = await prepare(extension),
    ref = refFor(record, 2)
  const editor = await editOrderProduct(page, 0, {
    'Spanish name': 'PENDING CAPACITY NAVIGATION',
  })
  await closeOrderProduct(editor)
  const before = await libraryBackup(extension)
  const grid = await openOrderReconciliation(page, ref),
    row = productGridRow(grid, ref),
    capacity = row.locator('[data-grid-column="capacity"]')
  await expect(capacity).toHaveValue('')
  await capacity.fill('12')
  await capacity.press('Tab')
  await expect
    .poll(
      async () =>
        (await realOrderContext(extension, ref)).record.unitsPerCarton?.[
          ref.entryId
        ]
    )
    .toBe(12)
  await expect(row.locator('[data-column="proposedCount"]')).toHaveText('6')
  await expect(row.locator('[data-column="unassigned"]')).toContainText('8')
  for (const language of ['es', 'zh', 'en']) {
    await page.locator(`#language-toggle [data-language="${language}"]`).click()
    await expect(capacity).toHaveValue('12')
  }
  const saved = await libraryBackup(extension)
  expect(saved.orders[0].snapshot).toEqual(record.snapshot)
  expect(saved.orders[0].unitsPerCarton).toEqual({ [ref.entryId]: 12 })
  expect(saved.preparations).toEqual(before.preparations)
  expect(saved.cartonBatches).toEqual([])
  await page.locator('#view-packing').click()
  await expect(
    page.locator('#packing-view [data-grid-column="capacity"]')
  ).toHaveCount(0)
  expect(extension.unexpectedRequests).toEqual([])
})

test('order reconciliation reaches a filtered-out source without redirecting paste or losing an invalid draft', async ({
  extension,
}, testInfo) => {
  const { page, record } = await prepare(extension),
    ref = refFor(record, 2)
  const search = record.snapshot.items[0].description.split('\n')[0]
  await page.locator('#search').fill(search)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    1
  )
  await page.locator('#sheet-body input[type="checkbox"]').first().check()
  const grid = await openOrderReconciliation(page, ref),
    row = productGridRow(grid, ref),
    capacity = row.locator('[data-grid-column="capacity"]')
  await capacity.fill('0')
  await capacity.press('Tab')
  await expect(capacity).toHaveAttribute('aria-invalid', 'true')
  await expect
    .poll(
      async () =>
        (await realOrderContext(extension, ref)).draft?.value?.rawCells?.[
          JSON.stringify([
            JSON.stringify(['local', ref.orderId, ref.entryId]),
            'capacity',
          ])
        ]
    )
    .toBe('0')
  expect(
    (await realOrderContext(extension, ref)).record.unitsPerCarton?.[
      ref.entryId
    ]
  ).toBeUndefined()
  await page.reload()
  await expect(
    productGridRow(grid, ref).locator('[data-grid-column="capacity"]')
  ).toHaveValue('0')
  await capacity.fill('8')
  await page.screenshot({
    path: testInfo.outputPath('capacity-source-editor.png'),
  })
  await capacity.press('Tab')
  await expect
    .poll(
      async () =>
        (await realOrderContext(extension, ref)).record.unitsPerCarton?.[
          ref.entryId
        ]
    )
    .toBe(8)
  await expect(row.locator('[data-column="proposedCount"]')).toHaveText('10')
  await page.locator('#view-orders').click()
  await page.locator('[data-orders-view="products"]').click()
  await expect(page.locator('#search')).toHaveValue(search)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    1
  )
  await expect(
    page.locator('#sheet-body tr[aria-selected="true"]')
  ).toHaveCount(1)
  const saved = await libraryBackup(extension)
  expect(saved.orders[0].snapshot).toEqual(record.snapshot)
  expect(saved.cartonBatches).toEqual([])
})
