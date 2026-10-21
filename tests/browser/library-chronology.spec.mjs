import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

test('a newly saved matching order returns both lists to their newest position and preserves filters and product selection', async ({
  extension,
}) => {
  const [template] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const makeOrder = (index, purchasedAt) => {
    const record = structuredClone(template)
    record.changedEntryIds = []
    const orderId = String(90000000 + index)
    Object.assign(record.snapshot, {
      orderId,
      purchasedAt,
      sellerName: `Paging supplier ${index}`,
      sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
    })
    record.snapshot.items.forEach(
      (item, position) => (item.entryId = `${orderId}${position}`)
    )
    return record
  }
  const save = (orders) =>
    extension.inspector.evaluate(
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
      orders
    )
  const initial =
    await test.step('Seed more orders and products than fit in one view', () =>
      save(
        Array.from({ length: 51 }, (_, index) =>
          makeOrder(index, '2026-10-17T08:00:00+08:00')
        )
      ))
  expect(initial.ok, initial.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-17T04:00:00Z'))
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#orders-page')).toHaveText('1 / 2')
  await page.locator('#order-search').fill('Paging supplier')
  // Escape dismisses suggestions only after they open; before that, the
  // native search input clears its value. Keep the filter active for this test.
  await expect(page.locator('#order-search')).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  await page.locator('#order-search').press('Escape')
  await expect(page.locator('#order-search')).toHaveValue('Paging supplier')
  await page.locator('.date-range > summary').click()
  await page.locator('#date-from').fill('2026-10-17')
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(100)
  await expect(page.locator('#orders-page')).toHaveText('1 / 2')
  await page.locator('#orders-next').click()
  await page.locator('.table-scroll').evaluate((scroller) => {
    scroller.scrollTop = scroller.scrollHeight
  })
  await expect(page.locator('#orders-page')).toHaveText('2 / 2')
  await expect(rows.last().locator('.row-number')).toHaveText('153')
  const selectedKey = await rows.last().getAttribute('data-selection-key')
  const selected = page.locator(
    `#sheet-body tr[data-selection-key="${selectedKey}"]`
  )
  await selected.focus()
  await page.keyboard.press('Space')
  const newest = makeOrder(100, '2026-10-17T15:00:00+08:00')
  const result =
    await test.step('Commit the new order and notify the open library', () =>
      save([newest]))
  expect(result.ok, result.error).toBe(true)
  await expect(page.locator('#orders-page')).toHaveText('1 / 2')
  await expect(page.locator('.order-card').first()).toHaveAttribute(
    'data-selection-key',
    newest.snapshot.orderId
  )
  await expect(
    page.locator('#sheet-body tr[data-selection-key]').first()
  ).toHaveAttribute(
    'data-selection-key',
    `${newest.snapshot.orderId}/${newest.snapshot.items[0].entryId}`
  )
  await expect
    .poll(() =>
      page.locator('.table-scroll').evaluate((scroller) => scroller.scrollTop)
    )
    .toBe(0)
  await expect(page.locator('#order-search')).toHaveValue('Paging supplier')
  await expect(page.locator('#date-from')).toHaveValue('2026-10-17')
  await expect(page.locator('#selection-summary')).toContainText('1 selected')
  await rows.first().focus()
  await page.keyboard.press('Control+End')
  await expect(rows.last().locator('.row-number')).toHaveText('156')
  await expect(
    page.locator(`#sheet-body tr[data-selection-key="${selectedKey}"]`)
  ).toHaveAttribute('aria-selected', 'true')
  expect(extension.unexpectedRequests).toEqual([])
})

test('main order and product views retain purchase chronology and source rows after manual packing arrangement', async ({
  extension,
}) => {
  const [template] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const orders = [
    ['9000000000000000099', '2026-10-17T08:30:00+08:00'],
    ['9000000000000000088', '2026-10-17T14:15:00+08:00'],
    ['9000000000000000011', '2026-10-17T14:15:01+08:00'],
    ['9000000000000000001', undefined],
  ].map(([orderId, purchasedAt], index) => {
    const record = structuredClone(template)
    record.changedEntryIds = []
    Object.assign(record.snapshot, {
      orderId,
      sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
      sellerName: `Chronology supplier ${index}`,
      sellerMemberLogin: `chronology-shop-${index}`,
      // Refresh activity runs in the opposite direction from purchase time.
      observedAt: `2026-10-${22 - index}T00:00:00Z`,
    })
    record.lastCheckedAt = record.snapshot.observedAt
    if (purchasedAt) record.snapshot.purchasedAt = purchasedAt
    else delete record.snapshot.purchasedAt
    for (const [position, item] of record.snapshot.items.entries())
      item.entryId = `${orderId}${position}`
    return record
  })
  const result = await extension.inspector.evaluate(
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
    orders
  )
  expect(result.ok, result.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-17T04:00:00Z'))
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    12
  )
  for (const toggle of await page
    .locator('.month-toggle[aria-expanded=false]')
    .all())
    await toggle.click()
  const expectedOrders = [orders[2], orders[1], orders[0], orders[3]]
  const orderIds = expectedOrders.map(({ snapshot }) => snapshot.orderId)
  const expectedRows = expectedOrders.flatMap(({ snapshot }) =>
    snapshot.items.map((item) => `${snapshot.orderId}/${item.entryId}`)
  )
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  const keys = (locator) =>
    locator.evaluateAll((elements) =>
      elements.map((element) => element.dataset.selectionKey)
    )
  expect(await keys(page.locator('.order-card'))).toEqual(orderIds)
  expect(await keys(rows)).toEqual(expectedRows)

  // Preparing and moving the oldest dated order used to push it ahead of all
  // unprepared orders in the main product table, but not the order selector.
  await page
    .locator(`.order-card[data-selection-key="${orders[0].snapshot.orderId}"]`)
    .focus()
  await page.keyboard.press('Space')
  await page.locator('#select-rows').click()
  await page.locator('#packing-month').fill('2026-10')
  await page.locator('#prepare-orders').click()
  await page
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const view = page.locator('#packing-view')
  await expect(view).toBeVisible()
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  const groupIds = () =>
    view
      .locator('.preparation-group')
      .evaluateAll((groups) => groups.map((group) => group.dataset.groupId))
  const originalGroups = await groupIds()
  expect(originalGroups.length).toBeGreaterThan(1)
  await view
    .getByRole('button', {
      name: 'Move group 1; use Up or Down arrows',
      exact: true,
    })
    .press('ArrowDown')
  const arranged = [
    originalGroups[1],
    originalGroups[0],
    ...originalGroups.slice(2),
  ]
  await expect.poll(groupIds).toEqual(arranged)
  await view.page().locator('#view-orders').click()
  await page.getByRole('button', { name: 'Show all', exact: true }).click()
  expect(await keys(page.locator('.order-card'))).toEqual(orderIds)
  expect(await keys(rows)).toEqual(expectedRows)

  const saved = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(saved.data.preparations[0].groups.map((group) => group.id)).toEqual(
    arranged
  )
  await page.reload()
  await expect(rows).toHaveCount(12)
  expect(await keys(rows)).toEqual(expectedRows)
  expect(extension.unexpectedRequests).toEqual([])
})
