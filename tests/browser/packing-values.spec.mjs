import { clickGroupingAction } from './copy-actions-helpers.mjs'
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

async function openPacking(extension, quantities, capacities) {
  const record = await seedOrder(extension, quantities, capacities)
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
    await expect(facts.locator('dt')).toHaveText(['Unit price'])
    await expect(facts.locator('dd')).toHaveText([price])
    await expect(
      rows.nth(index).locator('.variant-numeric-row .variant-quantity')
    ).toHaveText(quantity)
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

test('preparation keeps facts compact and read-only beside a visible label editor at wide and narrow widths', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension, undefined, [10, 8, 10])
  const row = view.locator('tr[data-variant-id]').first()
  const facts = row.locator('.variant-numeric-row')
  const capacity = facts.locator('.carton-capacity-readout')
  await expect(capacity).toContainText('10')
  await expect(capacity).toContainText('4 full cartons')
  await expect(capacity.locator('input, textarea')).toHaveCount(0)
  await expect(
    row.locator('.variant-source-attributes .product-attributes')
  ).toBeVisible()
  await expect(
    row.locator('.variant-heading .variant-code-options')
  ).toBeVisible()
  const copyQuantity = facts.getByRole('button', {
    name: 'Copy quantity: 40',
    exact: true,
  })
  await expect(copyQuantity).toHaveCSS('padding', '0px')
  await expect(copyQuantity).toHaveCSS('min-height', '0px')

  await page.setViewportSize({ width: 1440, height: 1000 })
  const quantityBox = await row.locator('.variant-quantity').boundingBox()
  const packBox = await capacity.boundingBox()
  expect(Math.abs(packBox.y - quantityBox.y)).toBeLessThanOrEqual(5)
  expect(packBox.x).toBeGreaterThan(quantityBox.x + quantityBox.width)
  const rowBounds = await row.boundingBox()
  expect(rowBounds.height).toBeLessThanOrEqual(148)
  const widths = await row
    .locator(':scope > td')
    .evaluateAll((cells) =>
      cells.map((cell) => cell.getBoundingClientRect().width)
    )
  expect(widths[0]).toBeLessThanOrEqual(58)
  expect(widths[1]).toBeLessThanOrEqual(96)
  expect(widths[2]).toBeGreaterThan(rowBounds.width * 0.35)
  expect(widths[3]).toBeLessThanOrEqual(286)
  expect(widths[4]).toBeLessThanOrEqual(176)

  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const editor = row.getByRole('button', {
      name: 'Edit barcode',
      exact: true,
    })
    const carton = view.locator('.carton-preview').first()
    await expect(editor).toBeVisible()
    await expect(carton).toBeVisible()
    const within = await row.evaluate((node) => {
      const bounds = node.getBoundingClientRect()
      return [...node.querySelectorAll('td')].every((cell) => {
        const value = cell.getBoundingClientRect()
        return value.left >= bounds.left - 1 && value.right <= bounds.right + 1
      })
    })
    expect(within).toBe(true)
    for (const control of [editor, carton]) {
      const bounds = await control.boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    }
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
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(
    view.locator('.preparation-label-preview img:visible')
  ).toHaveCount(5)
  await page.screenshot({ path: 'work/compact-preparation-wide.png' })
  await page.setViewportSize({ width: 390, height: 1000 })
  await view.locator('.preparation-group').first().screenshot({
    path: 'work/compact-preparation-narrow.png',
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.compactPreparationCopy = text
    }
  })
  await copyQuantity.click()
  await expect
    .poll(() => page.evaluate(() => window.compactPreparationCopy))
    .toBe('40')
  await expect(copyQuantity).toContainText('Copied')
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
  await view.page().locator('#view-orders').click()
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
  ])
  await expect(row.locator('.variant-order-facts dd')).toHaveText(['¥ 18.90'])
  await expect(
    row.locator('.variant-numeric-row .variant-quantity')
  ).toHaveText('24')
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
