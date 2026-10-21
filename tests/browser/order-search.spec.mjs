import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

test('order search combines seller, member login and order IDs with purchase filters and freezes refresh scope', async ({
  extension,
}) => {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  records[1].snapshot.sellerMemberLogin = 'demo_factory_42'
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
  await page.addInitScript(() => {
    if (localStorage.getItem('1688-library-purchase-months') === null)
      localStorage.setItem('1688-library-purchase-months', '[]')
  })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('.month-toggle')).not.toHaveCount(0)
  for (const toggle of await page
    .locator('.month-toggle[aria-expanded=false]')
    .all())
    await toggle.click()
  await expect(page.locator('.order-card')).toHaveCount(3)
  const search = page.getByRole('combobox', {
    name: 'Search orders',
    exact: true,
  })
  await expect(search).toBeVisible()
  await page.evaluate(() => {
    window.refreshScopeMessages = []
    const send = chrome.runtime.sendMessage.bind(chrome.runtime)
    chrome.runtime.sendMessage = (...args) => {
      if (args[0]?.type === 'REFRESH_ORDERS') {
        window.refreshScopeMessages.push(args[0])
        // Inspect the requested scope without navigating a reader to a live order.
        return Promise.resolve({ ok: true, data: {} })
      }
      return send(...args)
    }
  })

  await search.fill('  HABITAT  ')
  await expect(page.locator('.order-card')).toHaveCount(1)
  await expect(page.locator('.order-card')).toContainText('Habitat Studio')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  const suggestions = page.locator('.order-search > .search-suggestions')
  await expect(suggestions).toBeVisible()
  const [suggestionBounds, monthBounds] = await Promise.all([
    suggestions.boundingBox(),
    page.locator('#month-filter').boundingBox(),
  ])
  expect(suggestionBounds.y + suggestionBounds.height).toBeLessThanOrEqual(
    monthBounds.y
  )
  await page.locator('[data-month="2026-09"]').click()
  await expect(search).toHaveAttribute('aria-expanded', 'false')
  await expect(search).toHaveValue('  HABITAT  ')
  await expect(page.locator('.order-card')).toHaveCount(0)
  await expect(page.locator('.order-search-empty')).toHaveText(
    'No orders match these filters.'
  )
  await expect(page.locator('#refresh-orders')).toHaveText('Refresh 0 orders')
  await expect(page.locator('#refresh-orders')).toBeDisabled()
  await page.locator('#refresh-orders').dispatchEvent('click')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    0
  )
  expect(await page.evaluate(() => window.refreshScopeMessages)).toEqual([])

  // Clearing text keeps the independent purchase filter in place.
  await search.clear()
  await expect(page.locator('.order-card')).toHaveCount(1)
  await expect(page.locator('.order-card')).toContainText('Simple Goods')
  await search.fill(records[2].snapshot.orderId)
  await expect(page.locator('.order-card')).toHaveCount(1)
  await search.fill(records[2].snapshot.orderId.slice(-6))
  await expect(page.locator('.order-card')).toHaveCount(1)

  await page.getByRole('button', { name: 'Show all', exact: true }).click()
  await expect(search).toHaveValue('')
  await expect(page.locator('.order-card')).toHaveCount(3)
  await search.fill('DEMO_FACTORY')
  await expect(page.locator('.order-card')).toHaveCount(1)
  await expect(page.locator('.order-card')).toContainText('Greenfield')
  await page.locator('[data-month="2026-10"]').click()
  await page.locator('.date-range > summary').click()
  await page.getByLabel('From', { exact: true }).fill('2026-10-08')
  await page.getByLabel('Through', { exact: true }).fill('2026-10-08')
  await expect(page.locator('.order-card')).toHaveCount(1)
  await page.locator('.order-card-meta').click()
  await expect(page.locator('#refresh-orders')).toHaveText('Refresh 1 order')
  await search.fill('unknown seller')
  await expect(page.locator('.order-card')).toHaveCount(0)
  await expect(page.locator('#refresh-orders')).toBeDisabled()
  await expect(page.locator('#refresh-orders')).toBeDisabled()
  await page.locator('#refresh-orders').dispatchEvent('click')
  expect(await page.evaluate(() => window.refreshScopeMessages)).toEqual([])

  await search.clear()
  await expect(page.locator('.order-card')).toHaveCount(1)
  await page.getByLabel('Through', { exact: true }).fill('2026-10-12')
  await expect(page.locator('.order-card')).toHaveCount(2)
  await page
    .getByRole('button', { name: 'Refresh 2 orders', exact: true })
    .click()
  const confirmation = page.getByRole('dialog', {
    name: 'Confirm operation',
    exact: true,
  })
  await expect(confirmation).toBeVisible()
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  expect(await page.evaluate(() => window.refreshScopeMessages)).toEqual([])

  await page
    .getByRole('button', { name: 'Refresh 2 orders', exact: true })
    .click()
  await expect(confirmation).toBeVisible()
  // A scope change while the modal is open cannot replace its frozen IDs.
  await search.evaluate((input) => {
    input.value = 'Habitat'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(page.locator('.order-card')).toHaveCount(1)
  await confirmation
    .getByRole('button', { name: 'Refresh 2 orders', exact: true })
    .click()
  await expect
    .poll(() => page.evaluate(() => window.refreshScopeMessages))
    .toEqual([
      {
        type: 'REFRESH_ORDERS',
        orderIds: records.slice(0, 2).map((record) => record.snapshot.orderId),
      },
    ])
  const jobs = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
  )
  expect(jobs.ok, jobs.error).toBe(true)
  expect(jobs.data.jobs).toEqual([])
  expect(extension.unexpectedRequests).toEqual([])
})
