import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  openOrderReconciliation,
  productGridRow,
  realOrderContext,
  libraryBackup,
  assignSelectedPurchaseCodes,
  editOrderProduct,
  closeOrderProduct,
  shareOrderBarcode,
  createContainerThroughUI,
} from './smart-workspace-helpers.mjs'

async function seed(extension, { shared = false } = {}) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-carton-capacity'
  record.snapshot.purchasedAt = '2026-10-12T10:15:00+08:00'
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = shared ? '玻璃花瓶' : ['玻璃花瓶', '陶瓷碗', '玻璃杯'][index]
    item.productNumber = shared ? 'SYNTHETIC-VASE' : `SYNTHETIC-${index}`
    item.skuProperties = [
      { label: '颜色', value: ['白色', '红色', '黑色'][index] },
      { label: '规格', value: '20cm' },
    ]
    item.description = `${item.title}\n颜色：${item.skuProperties[0].value}\n规格：20cm`
  }
  const restored = await extension.inspector.evaluate(
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
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  return {
    page,
    record,
    ref: {
      accountId: record.accountId || record.snapshot.accountId || 'local',
      orderId: record.snapshot.orderId,
    },
  }
}
const capacity = (grid, ref, item) =>
  productGridRow(grid, { ...ref, entryId: item.entryId }).locator(
    '[data-grid-column="capacity"]'
  )
async function setCapacity(grid, ref, item, value) {
  const input = capacity(grid, ref, item)
  await input.fill(value)
  await input.blur()
}
async function assignAll(page) {
  await page.locator('[data-action="orders-products"]').click()
  await page.locator('#select-rows').click()
  await assignSelectedPurchaseCodes(page)
}

test('capacities autosave in the order grid before code assignment, retain invalid raw drafts and preserve exact source copy tools', async ({
  extension,
}) => {
  const { page, record, ref } = await seed(extension),
    items = record.snapshot.items
  let grid = await openOrderReconciliation(page, ref)
  await setCapacity(grid, ref, items[0], '0')
  await expect(capacity(grid, ref, items[0])).toHaveAttribute(
    'aria-invalid',
    'true'
  )
  expect((await libraryBackup(extension)).preparations).toEqual([])
  await setCapacity(grid, ref, items[0], '010')
  await expect
    .poll(async () =>
      String(
        (await realOrderContext(extension, ref)).record.unitsPerCarton?.[
          items[0].entryId
        ]
      )
    )
    .toBe('10')
  await setCapacity(grid, ref, items[0], '-')
  await expect(capacity(grid, ref, items[0])).toHaveValue('-')
  await grid.getByRole('searchbox').fill('陶瓷')
  await expect(grid.locator('tr[data-grid-key]')).toHaveCount(1)
  await grid.getByRole('searchbox').fill('')
  await expect(capacity(grid, ref, items[0])).toHaveValue('-')
  expect(
    String(
      (await realOrderContext(extension, ref)).record.unitsPerCarton?.[
        items[0].entryId
      ]
    )
  ).toBe('10')
  await page.reload()
  grid = await openOrderReconciliation(page, ref)
  await expect(capacity(grid, ref, items[0])).toHaveValue('-')
  await setCapacity(grid, ref, items[0], '10')
  await setCapacity(grid, ref, items[1], '10')
  await expect(
    productGridRow(grid, { ...ref, entryId: items[1].entryId }).locator(
      '[data-column="proposedCount"]'
    )
  ).toContainText('2')
  await expect(
    productGridRow(grid, { ...ref, entryId: items[1].entryId }).locator(
      '[data-column="unassigned"]'
    )
  ).toContainText('4')
  const before = await libraryBackup(extension)
  expect(before.cartonBatches).toEqual([])
  expect(before.orders[0].snapshot).toEqual(record.snapshot)
  await assignAll(page)
  const editor = await editOrderProduct(page, 0)
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.capacityCopied = text
    }
  })
  for (const [label, exact] of [
    ['Copy value: White', 'White'],
    ['Copy size: 20cm', '20cm'],
    ['Copy quantity: 40', '40'],
  ]) {
    await editor.getByRole('button', { name: label, exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => window.capacityCopied))
      .toBe(exact)
  }
  await closeOrderProduct(editor)
  await page.locator('[data-language="es"]').click()
  await page
    .locator('#sheet-body tr[data-selection-key]')
    .first()
    .getByRole('button', { name: 'Copiar valor: Blanco', exact: true })
    .click()
  await expect
    .poll(() => page.evaluate(() => window.capacityCopied))
    .toBe('Blanco')
  await page.locator('[data-language="en"]').click()
  grid = await openOrderReconciliation(page, ref)
  expect((await libraryBackup(extension)).cartonBatches).toEqual([])
  await setCapacity(grid, ref, items[0], '')
  await expect
    .poll(
      async () =>
        (await realOrderContext(extension, ref)).record.unitsPerCarton?.[
          items[0].entryId
        ] ?? null
    )
    .toBe(null)
  expect((await libraryBackup(extension)).orders[0].snapshot).toEqual(
    record.snapshot
  )
})

test('shared codes retain each source capacity, unknown capacity remains visible and print counts derive only confirmed physical cartons', async ({
  extension,
}) => {
  const { page, record, ref } = await seed(extension, { shared: true }),
    items = record.snapshot.items
  await assignAll(page)
  await shareOrderBarcode(page, [0, 1, 2])
  const before = await libraryBackup(extension)
  let grid = await openOrderReconciliation(page, ref)
  for (const [index, item] of items.entries())
    await setCapacity(grid, ref, item, ['10', '12', '20'][index])
  await expect
    .poll(async () =>
      Object.values(
        (await realOrderContext(extension, ref)).record.unitsPerCarton || {}
      ).map(String)
    )
    .toEqual(['10', '12', '20'])
  expect((await libraryBackup(extension)).cartonBatches).toEqual([])
  await setCapacity(grid, ref, items[2], '')
  const unknown = productGridRow(grid, { ...ref, entryId: items[2].entryId })
  await expect(unknown.locator('[data-column="unassigned"]')).toContainText(
    items[2].quantity
  )
  await expect(unknown.locator('[data-column="proposedCount"]')).toContainText(
    '0'
  )
  expect(
    Object.values(
      (await realOrderContext(extension, ref)).record.unitsPerCarton
    ).map(String)
  ).toEqual(['10', '12'])
  await setCapacity(grid, ref, items[2], '20')
  await grid.locator('[data-action="confirm-order-cartons"]').click()
  await expect
    .poll(async () =>
      (await realOrderContext(extension, ref)).batches.reduce(
        (n, batch) => n + batch.count,
        0
      )
    )
    .toBe(10)
  await createContainerThroughUI(page, [ref], 'Synthetic shared-code cartons')
  await page.locator('[data-action="mark-all-loaded"]').click()
  await page
    .locator('[data-action="container-view"][data-view="packing-list"]')
    .click()
  await page.locator('#packing-view [data-action="open-print-menu"]').click()
  await page.locator('#packing-view [data-action="print-carton-marks"]').click()
  const print = page.getByRole('dialog', {
    name: 'Print carton marks',
    exact: true,
  })
  await expect(print.getByLabel(/^Quantity for /)).toHaveValue('10')
  await expect(
    print.getByRole('checkbox', { name: /^Carton count reviewed for / })
  ).toHaveCount(0)
  expect((await libraryBackup(extension)).orders[0].snapshot).toEqual(
    record.snapshot
  )
  expect((await libraryBackup(extension)).preparations[0].groups).toEqual(
    before.preparations[0].groups
  )
})

test('capacity changes refresh unedited grids in another tab without creating cartons, and a later physical confirm supplies print counts', async ({
  extension,
}) => {
  const { page, record, ref } = await seed(extension),
    item = record.snapshot.items[0]
  await assignAll(page)
  const viewer = await openOrderReconciliation(page, ref)
  await setCapacity(viewer, ref, item, '10')
  await expect
    .poll(async () =>
      String(
        (await realOrderContext(extension, ref)).record.unitsPerCarton?.[
          item.entryId
        ]
      )
    )
    .toBe('10')
  const other = await extension.context.newPage()
  await other.goto(`${extension.extensionBaseUrl}/inspector.html`)
  await other.evaluate(
    async ({ ref, entryId }) => {
      const repository = await window.testRepository,
        current = await repository.getOrderReconciliation(ref)
      await repository.updateOrderCapacities({
        ...ref,
        values: { [entryId]: '20' },
        expectedValues: { [entryId]: current.record.unitsPerCarton[entryId] },
        expectedObservedAt: current.record.snapshot.observedAt,
      })
    },
    { ref, entryId: item.entryId }
  )
  await expect(capacity(viewer, ref, item)).toHaveValue('20')
  await expect(
    productGridRow(viewer, { ...ref, entryId: item.entryId }).locator(
      '[data-column="proposedCount"]'
    )
  ).toContainText('2')
  const saved = await libraryBackup(extension)
  expect(saved.orders[0].snapshot).toEqual(record.snapshot)
  expect(saved.cartonBatches).toEqual([])
  await page.reload()
  const refreshed = await openOrderReconciliation(page, ref)
  await refreshed.locator('[data-action="confirm-order-cartons"]').click()
  await expect
    .poll(async () =>
      (await realOrderContext(extension, ref)).batches.reduce(
        (n, batch) => n + batch.count,
        0
      )
    )
    .toBe(2)
  await createContainerThroughUI(page, [ref], 'Synthetic refreshed capacity')
  await page.locator('[data-action="mark-all-loaded"]').click()
  await page.locator('#packing-view [data-action="open-print-menu"]').click()
  await page.locator('#packing-view [data-action="print-carton-marks"]').click()
  await expect(
    page
      .getByRole('dialog', { name: 'Print carton marks', exact: true })
      .getByLabel(/^Quantity for /)
  ).toHaveValue('2')
})
