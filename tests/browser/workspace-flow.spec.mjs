import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { summarizeOrders } from '../../src/order-summary.js'

async function open(extension, { longSeller = false } = {}) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  if (longSeller)
    records[0].snapshot.sellerName =
      'Synthetic Homewares Workshop / 合成家居用品测试店铺名称'
  const restored = await extension.inspector.evaluate(
    (orders) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders,
          history: [],
          images: [],
        },
      }),
    records
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00+08:00'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#order-count')).toHaveText('3')
  return { page, records }
}
const money = (value) =>
  `¥ ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

test('month headings collapse independently; month choices toggle and Shift includes a range', async ({
  extension,
}) => {
  const { page } = await open(extension)
  const october = page.getByRole('button', {
    name: 'October 2026 orders',
    exact: true,
  })
  const september = page.getByRole('button', {
    name: 'September 2026 orders',
    exact: true,
  })
  await expect(october).toHaveAttribute('aria-expanded', 'true')
  await expect(september).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.order-card')).toHaveCount(2)
  await october.click()
  await expect(page.locator('.order-card')).toHaveCount(0)
  await expect(page.locator('#sheet-body tr')).toHaveCount(8)
  await september.click()
  await expect(page.locator('.order-card')).toHaveCount(1)
  await page.locator('#month-filter > summary').click()
  await page.locator('[data-month="2026-09"]').click()
  await expect(page.locator('#sheet-body tr')).toHaveCount(2)
  await page.locator('[data-month="2026-10"]').click({ modifiers: ['Shift'] })
  await expect(page.locator('#month-options [aria-pressed=true]')).toHaveCount(
    2
  )
  await expect(page.locator('#sheet-body tr')).toHaveCount(8)
  await page.locator('[data-month="2026-09"]').click()
  await expect(page.locator('#sheet-body tr')).toHaveCount(6)
  await expect(page.locator('#refresh-orders')).toHaveText('Refresh 2 orders')
  await expect(page.locator('#refresh-scope')).toHaveText(
    'Selected months · matching search'
  )
})

test('filtered totals count each whole order once and row clicks toggle without intercepting controls', async ({
  extension,
}) => {
  const { page, records } = await open(extension)
  const total = page.locator('#order-totals .totals-payable dd')
  await expect(total).toHaveText(
    money(summarizeOrders(records).amounts.payable)
  )
  await page.locator('.order-card').first().click()
  await expect(page.locator('.order-card[aria-selected=true]')).toHaveCount(1)
  await expect(total).toHaveText(money(records[0].snapshot.totals.payable))
  await page.locator('.order-card').first().click()
  await expect(page.locator('.order-card[aria-selected=true]')).toHaveCount(0)
  await expect(total).toHaveText(
    money(summarizeOrders(records).amounts.payable)
  )
  await page.locator('#search').fill('warm amber')
  await expect(page.locator('#sheet-body tr')).toHaveCount(1)
  await expect(page.locator('.totals-scope')).toHaveText(
    'Whole-order totals · 1 matching order'
  )
  await expect(total).toHaveText(money(records[0].snapshot.totals.payable))
  const row = page.locator('#sheet-body tr')
  await row.locator('.row-number').click()
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await row.locator('.row-number').click()
  await expect(row).toHaveAttribute('aria-selected', 'false')
  await row.locator('.product-photo-button').click()
  await expect(row).toHaveAttribute('aria-selected', 'false')
  await page
    .getByRole('button', { name: 'Close product photo', exact: true })
    .click()
  await page.locator('#search').fill('no matching product')
  await expect(page.locator('.totals-scope')).toHaveText(
    'Whole-order totals · 0 matching orders'
  )
  await expect(total).toHaveText('¥ 0.00')
  await expect(page.locator('#refresh-orders')).toBeDisabled()
})

test('packing is the primary action while full refresh and backups stay in compact Settings', async ({
  extension,
}) => {
  const { page } = await open(extension)
  await expect(page.locator('.brand')).toContainText('1688 Packing workspace')
  await expect(page.locator('.brand img')).toHaveJSProperty('naturalWidth', 48)
  await expect(
    page.getByRole('button', { name: 'Prepare packing list', exact: true })
  ).toBeVisible()
  await expect(page.locator('#refresh-all')).not.toBeVisible()
  const settings = page.getByRole('button', { name: 'Settings', exact: true })
  const size = await settings.boundingBox()
  expect(size.width).toBeLessThanOrEqual(36)
  expect(size.height).toBeLessThanOrEqual(36)
  await settings.click()
  await page.getByRole('tab', { name: 'Data', exact: true }).click()
  await expect(page.locator('#settings-data')).toBeVisible()
  await page.locator('#refresh-all').click()
  const confirm = page.getByRole('dialog', {
    name: 'Confirm operation',
    exact: true,
  })
  await expect(confirm).toContainText('3 orders')
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
  const jobs = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
  )
  expect(jobs.data.jobs).toEqual([])
})

test('seller names and full order numbers wrap without clipping at desktop and mobile widths', async ({
  extension,
}) => {
  const { page, records } = await open(extension, { longSeller: true })
  const reference = `Order ${records[0].snapshot.orderId}`
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 960 })
    const card = page.locator('.order-card').first()
    const identity = page.locator('#sheet-body .row-identity').first()
    await expect(card.locator('strong')).toHaveText(
      records[0].snapshot.sellerName
    )
    await expect(card.locator('.order-reference')).toHaveText(reference)
    await expect(identity.locator('.meta-seller')).toHaveText(
      records[0].snapshot.sellerName
    )
    await expect(identity.locator('.meta-order')).toHaveText(reference)
    for (const block of [card.locator('.order-summary'), identity])
      expect(
        await block.evaluate(
          (element) =>
            element.scrollWidth <= element.clientWidth &&
            [...element.children].every((child) => {
              const rect = child.getBoundingClientRect()
              const parent = element.getBoundingClientRect()
              return (
                rect.left >= parent.left - 1 && rect.right <= parent.right + 1
              )
            })
        )
      ).toBe(true)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
  }
})

test('workspace hints are compact, hoverable and dismiss when editing starts', async ({
  extension,
}) => {
  const { page } = await open(extension)
  const settings = page.getByRole('button', { name: 'Settings', exact: true })
  await settings.hover()
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toHaveText(
    'Label layout, naming rules, backup and restore.'
  )
  expect(
    await tooltip.evaluate((node) =>
      parseFloat(getComputedStyle(node).fontSize)
    )
  ).toBeLessThanOrEqual(12)
  expect((await tooltip.boundingBox()).width).toBeLessThanOrEqual(280)
  await tooltip.hover()
  await expect(tooltip).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tooltip).toHaveCount(0)
  await expect(page.locator('#settings-dialog')).not.toBeVisible()
  const search = page.locator('#order-search')
  await search.focus()
  await expect(tooltip).toContainText('full order number')
  await search.fill('Habitat')
  await expect(tooltip).toHaveCount(0)
  await expect(page.locator('#sheet-body tr')).toHaveCount(3)
  await expect(settings).toHaveCSS('text-decoration-line', 'none')
})
