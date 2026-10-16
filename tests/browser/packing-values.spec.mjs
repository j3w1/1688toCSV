import { clickGroupingAction } from './copy-actions-helpers.mjs'
import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { centsToMoney, lineGrossCents, moneyToCents } from '../../src/money.js'

const productRows = (page) => page.locator('#sheet-body tr[data-selection-key]')

async function seedOrder(extension, quantities = ['40', '24', '80']) {
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

async function prepare(page) {
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  const view = page.locator('#packing-view')
  const review = page.getByRole('dialog', {
    name: 'Assign product codes?',
    exact: true,
  })
  await expect
    .poll(async () => (await view.isVisible()) || (await review.isVisible()))
    .toBe(true)
  if (await review.isVisible())
    await review
      .getByRole('button', { name: 'Assign codes and prepare', exact: true })
      .click()
  await expect(view).toBeVisible()
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  return view
}

async function openPacking(extension, quantities) {
  const record = await seedOrder(extension, quantities)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(productRows(page)).toHaveCount(3)
  await productRows(page).first().focus()
  await page.keyboard.press('Control+a')
  await expect(page.locator('#selection-summary')).toContainText('3 selected')
  const view = await prepare(page)
  await expect(view.locator('.preparation-group')).toHaveCount(2)
  return { page, view, record }
}

async function mergeFirstGroup(page, view) {
  await view
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  const group = view.locator('.preparation-group').first()
  const rows = group.locator('tr[data-variant-id]')
  await rows.nth(0).focus()
  await page.keyboard.press('Space')
  await rows.nth(1).focus()
  await page.keyboard.press('Control+Space')
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true')
  await clickGroupingAction(page, 'Share one barcode')
  const review = page.getByRole('dialog', {
    name: 'Share one barcode?',
    exact: true,
  })
  await expect(review).toBeVisible()
  await review
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(group.locator('tr[data-variant-id]')).toHaveCount(1)
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  return group.locator('tr[data-variant-id]').first()
}

async function backup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}

test('packing rows show exact source unit prices and quantities as read-only facts without discounts', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const rows = view.locator('tr[data-variant-id]')
  await expect(rows).toHaveCount(3)
  for (const [index, [price, quantity]] of [
    ['¥ 12.345', '40'],
    ['¥ 18.90', '24'],
    ['¥ 8.20', '80'],
  ].entries()) {
    const facts = rows.nth(index).locator('.variant-order-facts')
    await expect(facts.locator('dt')).toHaveText(['Unit price', 'Quantity'])
    await expect(facts.locator('dd')).toHaveText([price, quantity])
    await expect(
      facts.locator('input, textarea, [contenteditable=true]')
    ).toHaveCount(0)
    await expect(facts).not.toContainText(/discount/i)
  }
  // These source discounts exist, but must not change the displayed prices.
  const saved = await backup(extension)
  expect(saved.orders[0].snapshot.items.map((item) => item.discount)).toEqual([
    '10.00',
    '12.00',
    '16.40',
  ])
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 850 })
    await expect(rows.first().locator('.variant-order-facts')).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        )
      )
      .toBeLessThanOrEqual(1)
  }
  expect(extension.unexpectedRequests).toEqual([])
})

test('a shared barcode lists distinct unit prices and sums large source quantities exactly', async ({
  extension,
}) => {
  const { page, view, record } = await openPacking(extension, [
    '9007199254740993',
    '12',
    '80',
  ])
  const merged = await mergeFirstGroup(page, view)
  await expect(merged.locator('.variant-order-facts dt')).toHaveText([
    'Unit prices',
    'Quantity',
  ])
  await expect(merged.locator('.variant-order-facts dd')).toHaveText([
    '¥ 12.345 / ¥ 18.90',
    '9,007,199,254,741,005',
  ])
  await expect(merged.locator('.variant-source-count')).toHaveText(
    '2 source rows'
  )
  const saved = await backup(extension)
  expect(saved.preparations[0].groups[0].variants[0].entryIds).toEqual(
    record.snapshot.items.slice(0, 2).map((item) => item.entryId)
  )
  expect(saved.orders[0].snapshot.items).toEqual(record.snapshot.items)
  expect(extension.unexpectedRequests).toEqual([])
})

test('reopening one selected source row of a shared barcode shows only that row price and quantity', async ({
  extension,
}) => {
  const { page, view, record } = await openPacking(extension)
  await mergeFirstGroup(page, view)
  const before = await backup(extension)
  await view.getByRole('button', { name: 'Orders', exact: true }).click()
  await expect(productRows(page)).toHaveCount(3)
  await page.locator('#clear-rows').click()
  await productRows(page).nth(1).focus()
  await page.keyboard.press('Space')
  await expect(page.locator('#packing-scope')).toHaveText(
    '1 selected products · 1 orders → October 2026'
  )
  await prepare(page)
  await expect(view.locator('tr[data-variant-id]')).toHaveCount(1)
  const row = view.locator('tr[data-variant-id]')
  await expect(row.locator('.variant-order-facts dt')).toHaveText([
    'Unit price',
    'Quantity',
  ])
  await expect(row.locator('.variant-order-facts dd')).toHaveText([
    '¥ 18.90',
    '24',
  ])
  await expect(row.locator('.variant-price')).not.toContainText('12.345')
  await expect(row.locator('.variant-source-count')).toHaveCount(0)
  await expect(view.locator('.preparation-copy-scope')).toHaveText(
    '1 selected products · 1 orders'
  )
  const after = await backup(extension)
  expect(after.preparations[0].groups[0].variants[0].entryIds).toEqual(
    record.snapshot.items.slice(0, 2).map((item) => item.entryId)
  )
  expect(after.preparations[0].groups[0].baseCode).toBe(
    before.preparations[0].groups[0].baseCode
  )
  expect(after.orders[0].snapshot.items).toEqual(record.snapshot.items)
  expect(extension.unexpectedRequests).toEqual([])
})
