import {
  assignSelectedPurchaseCodes,
  editOrderProduct,
  closeOrderProduct,
  libraryBackup,
  shareOrderBarcode,
  openOrderReconciliation,
  productGridRow,
} from './smart-workspace-helpers.mjs'
import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { centsToMoney, lineGrossCents, moneyToCents } from '../../src/money.js'

const productRows = (page) => page.locator('#sheet-body tr[data-selection-key]')

async function seedOrder(
  extension,
  quantities = ['40', '24', '80'],
  capacities = []
) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const order = record.snapshot
  order.sellerName = 'Synthetic source values shop'
  order.sellerMemberLogin = 'synthetic-source-values'
  order.purchasedAt = '2026-10-12T10:15:00+08:00'
  for (const [index, item] of order.items.entries()) {
    item.title = index < 2 ? '合成玻璃罐' : '合成收纳盒'
    item.productNumber = index < 2 ? 'VALUES-JAR' : 'VALUES-BOX'
    item.skuProperties = [
      {
        label: '颜色',
        value: ['透明', '灰色', '原色'][index],
        raw: `颜色：${['透明', '灰色', '原色'][index]}`,
      },
    ]
    item.description = `${item.title}\n${item.skuProperties[0].raw}\n货号：${item.productNumber}`
    item.price = ['12.3450', '18.900', '8.20'][index]
    item.quantity = quantities[index]
  }
  if (capacities.length) {
    record.unitsPerCarton = Object.fromEntries(
      order.items.map((item, index) => [item.entryId, capacities[index]])
    )
    record.unitsPerCartonUpdatedAt = order.observedAt
  }
  const gross = order.items.reduce(
    (sum, item) => sum + lineGrossCents(item.price, item.quantity),
    0n
  )
  const discount = order.items.reduce(
    (sum, item) => sum + moneyToCents(item.sourceDiscount),
    0n
  )
  Object.assign(order.totals, {
    goodsGross: centsToMoney(gross),
    sourceDiscount: centsToMoney(discount),
    goodsNet: centsToMoney(gross - discount),
    payable: centsToMoney(gross - discount),
  })
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
  return record
}

async function openPacking(extension, quantities, capacities) {
  const record = await seedOrder(extension, quantities, capacities)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(productRows(page)).toHaveCount(3)
  await productRows(page).first().focus()
  await page.keyboard.press('Control+a')
  await expect(page.locator('#selection-summary')).toContainText('3 selected')
  await assignSelectedPurchaseCodes(page)
  const view = page.locator('#orders-view')
  return { page, view, record }
}

test('Orders preserves exact read-only source prices and quantities independently from source discounts', async ({
  extension,
}) => {
  const { page, record } = await openPacking(extension),
    rows = productRows(page)
  for (const [index, [price, quantity]] of [
    ['12.345', '40'],
    ['18.90', '24'],
    ['8.20', '80'],
  ].entries()) {
    await expect(rows.nth(index).locator('.price-cell')).toHaveText(price)
    await expect(rows.nth(index).locator('.quantity-cell')).toHaveText(quantity)
    await expect(
      rows
        .nth(index)
        .locator(
          '.price-cell input,.quantity-cell input,.price-cell textarea,.quantity-cell textarea,[contenteditable=true]'
        )
    ).toHaveCount(0)
  }
  const saved = await libraryBackup(extension)
  expect(saved.orders[0].snapshot.items.map((item) => item.discount)).toEqual([
    '10.00',
    '12.00',
    '16.40',
  ])
  expect(saved.orders[0].snapshot).toEqual(record.snapshot)
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 850 })
    await expect(rows.first().locator('.price-cell')).toBeVisible()
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(1)
  }
  expect(extension.unexpectedRequests).toEqual([])
})

test('Orders shows read-only source values, one capacity table and reachable label editing at wide and narrow widths', async ({
  extension,
}, testInfo) => {
  const { page, record } = await openPacking(extension, undefined, [10, 8, 10]),
    row = productRows(page).first()
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(
      row.getByRole('button', { name: 'Barcode', exact: true })
    ).toBeVisible()
    await expect(row.locator('.product-attributes')).toBeVisible()
    await expect(
      row.locator('.price-cell input,.quantity-cell input')
    ).toHaveCount(0)
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(1)
    await row.getByRole('button', { name: 'Barcode', exact: true }).click()
    const label = page.getByRole('dialog', {
      name: 'Label editor',
      exact: true,
    })
    await expect(label).toBeVisible()
    await expect(
      label.getByRole('button', { name: 'Copy label', exact: true })
    ).toBeEnabled({ timeout: 20000 })
    const bounds = await label.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    await label
      .getByRole('button', { name: 'Close label editor', exact: true })
      .click()
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.compactPreparationCopy = text
    }
  })
  const copyQuantity = row.getByRole('button', {
    name: 'Copy quantity: 40',
    exact: true,
  })
  await copyQuantity.click()
  await expect
    .poll(() => page.evaluate(() => window.compactPreparationCopy))
    .toBe('40')
  await expect(copyQuantity).toContainText('Copied')
  const ref = {
      accountId: 'local',
      orderId: record.snapshot.orderId,
      entryId: record.snapshot.items[0].entryId,
    },
    grid = await openOrderReconciliation(page, ref),
    capacity = productGridRow(grid, ref).locator(
      '[data-grid-column="capacity"]'
    )
  await expect(capacity).toHaveValue('10')
  await expect(capacity).toBeEditable()
  await expect(
    productGridRow(grid, ref).locator('[data-column="proposedCount"]')
  ).toHaveText('4')
  await expect(
    grid.locator(
      '[data-column="purchased"] input,[data-column="proposedCount"] input'
    )
  ).toHaveCount(0)
  await page.screenshot({
    path: testInfo.outputPath('order-reconciliation-wide.png'),
  })
  await page.setViewportSize({ width: 390, height: 1000 })
  await grid.screenshot({
    path: testInfo.outputPath('order-reconciliation-narrow.png'),
  })
  await page.locator('#view-packing').click()
  await expect(
    page.locator(
      '#packing-view input[data-grid-column],.reorder-handle,.packing-item-actions,.packing-remove-button'
    )
  ).toHaveCount(0)
  expect((await libraryBackup(extension)).orders[0].snapshot).toEqual(
    record.snapshot
  )
  expect(extension.unexpectedRequests).toEqual([])
})

test('shared barcode retains separate source prices and exact quantities above Number safe integer', async ({
  extension,
}) => {
  const { page, record } = await openPacking(extension, [
    '9007199254740993',
    '12',
    '80',
  ])
  await shareOrderBarcode(page)
  const rows = productRows(page)
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0).locator('.price-cell')).toHaveText('12.345')
  await expect(rows.nth(1).locator('.price-cell')).toHaveText('18.90')
  await expect(rows.nth(0).locator('.quantity-cell')).toHaveText(
    '9,007,199,254,740,993'
  )
  await expect(page.locator('#product-selection-totals')).toContainText(
    '9,007,199,254,741,005'
  )
  const saved = await libraryBackup(extension)
  expect(saved.preparations[0].groups[0].variants[0].entryIds).toEqual(
    record.snapshot.items.slice(0, 2).map((item) => item.entryId)
  )
  expect(saved.orders[0].snapshot.items).toEqual(record.snapshot.items)
  expect(extension.unexpectedRequests).toEqual([])
})

test('inspecting one source row of a shared code retains only its original price and purchase quantity', async ({
  extension,
}) => {
  const { page, record } = await openPacking(extension)
  await shareOrderBarcode(page)
  const before = await libraryBackup(extension)
  await page.locator('#clear-rows').click()
  const row = productRows(page).nth(1)
  await row.getByRole('checkbox').check()
  await row.focus()
  await row.press('Enter')
  const details = page.getByRole('dialog', {
    name: 'Original product details',
    exact: true,
  })
  await expect(details).toBeVisible()
  await expect(details).toContainText('18.90')
  await expect(details).toContainText('24')
  await expect(details).not.toContainText('12.345')
  await details.getByRole('button', { name: 'Close product details' }).click()
  await expect(
    productRows(page).locator('input[type="checkbox"]:checked')
  ).toHaveCount(1)
  const after = await libraryBackup(extension)
  expect(after.preparations[0].groups[0].variants[0].entryIds).toEqual(
    record.snapshot.items.slice(0, 2).map((item) => item.entryId)
  )
  expect(after.preparations[0].groups[0].baseCode).toBe(
    before.preparations[0].groups[0].baseCode
  )
  expect(after.orders[0].snapshot.items).toEqual(record.snapshot.items)
  expect(extension.unexpectedRequests).toEqual([])
})
