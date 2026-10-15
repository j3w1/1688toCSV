import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { readFile, stat, writeFile } from 'node:fs/promises'

async function seed(extension) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const result = await extension.inspector.evaluate(
    async (orders) =>
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
  expect(result.ok, result.error).toBe(true)
  return records
}
async function openLibrary(extension) {
  const page = await extension.context.newPage()
  await page.addInitScript(() => {
    if (localStorage.getItem('1688-library-purchase-months') === null)
      localStorage.setItem('1688-library-purchase-months', '[]')
  })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#orders-page')).toHaveText(/^1 \/ /)
  for (const toggle of await page
    .locator('.month-toggle[aria-expanded=false]')
    .all())
    await toggle.click()
  return page
}
async function confirmOperation(page, name) {
  const dialog = page.getByRole('dialog', {
    name: 'Confirm operation',
    exact: true,
  })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name, exact: true }).click()
  await expect(dialog).not.toBeVisible()
}

test('image copy stays compact with touch input and copied feedback', async ({
  extension,
}) => {
  await seed(extension)
  const page = await openLibrary(extension)
  const row = page.locator('#sheet-body tr[data-selection-key]').first()
  const copy = row.locator('.photo-copy-button')
  await expect(copy).toBeVisible()
  const session = await extension.context.newCDPSession(page)
  for (const emulateTouch of [false, true]) {
    if (emulateTouch) {
      await session.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
      })
      await expect
        .poll(() =>
          page.evaluate(() => matchMedia('(pointer: coarse)').matches)
        )
        .toBe(true)
    }
    const copyBounds = await copy.boundingBox()
    const photoBounds = await row.locator('.product-photo-button').boundingBox()
    expect(copyBounds.height).toBeGreaterThanOrEqual(24)
    expect(copyBounds.height).toBeLessThanOrEqual(30)
    expect(copyBounds.width).toBeLessThanOrEqual(100)
    expect(copyBounds.y).toBeGreaterThanOrEqual(
      photoBounds.y + photoBounds.height
    )
    // Wider fallback fonts must fit without making the photo action taller.
    // The icon and complete label stay on one line, including fallback fonts.
    for (const family of ['', 'Verdana']) {
      await copy.evaluate((node, font) => {
        node.style.fontFamily = font
      }, family)
      expect(
        await copy.evaluate(
          (node) =>
            node.scrollWidth <= node.clientWidth &&
            node.scrollHeight <= node.clientHeight
        )
      ).toBe(true)
    }
    await copy.evaluate((node) => node.style.removeProperty('font-family'))
  }
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await copy.click()
  await expect(copy).toHaveText('Copied')
  expect((await copy.boundingBox()).height).toBeLessThanOrEqual(30)
  await session.detach()
})

test('Excel table image batches keep every selected row across product pages', async ({
  extension,
}) => {
  const [template] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const orders = Array.from({ length: 25 }, (_, index) => {
    const record = structuredClone(template)
    record.snapshot.orderId = String(90000000 + index)
    record.snapshot.sourceUrl = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${record.snapshot.orderId}`
    for (const [position, item] of record.snapshot.items.entries())
      item.description = `BATCH-${index}-${position}`
    return record
  })
  const result = await extension.inspector.evaluate(
    async (orders) =>
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
  const page = await openLibrary(extension)
  await page
    .getByRole('button', { name: 'Select all rows', exact: true })
    .click()
  await expect(page.locator('#selection-summary')).toContainText('75 selected')
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.evaluate(() => navigator.clipboard.writeText('before-batch'))
  const copy = page.locator('#copy-excel-image')
  await copy.click()
  const batches = page.getByRole('dialog', { name: 'Choose Excel image batch' })
  await expect(batches).toBeVisible()
  await batches.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(copy).toHaveText('Copy Excel image')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'before-batch'
  )
  await copy.click()
  await batches.getByLabel('Image batch number').fill('2')
  const summary = await batches.getByText(/^Batch 2 of/).textContent()
  const [, first, last] = summary.match(/rows (\d+)–(\d+)/)
  await page.evaluate(() => {
    globalThis.drawnBatchRows = []
    const original = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (value, ...args) {
      if (String(value).startsWith('BATCH-')) drawnBatchRows.push(String(value))
      return original.call(this, value, ...args)
    }
  })
  await batches
    .getByRole('button', { name: 'Copy this batch', exact: true })
    .click()
  await expect(copy).toHaveText('Copied')
  const ordered = orders
    .toReversed()
    .flatMap((record) => record.snapshot.items.map((item) => item.description))
  expect(await page.evaluate(() => drawnBatchRows)).toEqual(
    ordered.slice(Number(first) - 1, Number(last))
  )
  await expect(page.locator('#selection-summary')).toContainText('75 selected')
  expect(extension.unexpectedRequests).toEqual([])
})

test('table photos open the shared original-image viewer; dates and statuses are readable chips', async ({
  extension,
}) => {
  await seed(extension)
  const page = await openLibrary(extension)
  const row = page.locator('#sheet-body tr[data-selection-key]').first()
  await expect(row.locator('time.purchase-date')).toHaveAttribute(
    'datetime',
    /2026-\d{2}-\d{2}/
  )
  await expect(row.locator('.order-status')).toHaveText('Awaiting shipment')
  await expect(row.locator('.order-status')).toHaveAttribute('title', '待发货')
  await row.getByRole('button', { name: /^Zoom product photo/ }).click()
  const photo = page.getByRole('dialog', { name: 'Product photo', exact: true })
  await expect(photo).toBeVisible()
  await expect(photo.locator('img')).toHaveJSProperty('complete', true)
  await expect(photo.locator('img')).toHaveJSProperty('naturalWidth', 96)
  await photo.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(photo.locator('.photo-zoom-actions')).toContainText('150%')
  await page.keyboard.press('Escape')
  await expect(photo).toHaveCount(0)
  await expect(
    row.getByRole('button', { name: /^Zoom product photo/ })
  ).toBeFocused()
  // Display translations do not replace the raw source values used by filters.
  await page.locator('#status-filter').selectOption({ label: 'Completed' })
  await expect(page.locator('#status-filter')).toHaveValue('交易成功')
  await expect(
    page.locator('#sheet-body .order-status').first()
  ).toHaveAttribute('data-tone', 'success')
})

test('Activity exports every bulk-import failure without resuming work or changing saved orders', async ({
  extension,
}) => {
  await seed(extension)
  await extension.inspector.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('1688-order-library')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('jobs', 'readwrite')
          tx.objectStore('jobs').put({
            id: 'synthetic-report',
            kind: 'import',
            scope: 'all',
            phase: 'details',
            state: 'completed-with-errors',
            total: 667,
            page: 67,
            pageSize: 10,
            filterKey: 'private filter excluded from report',
            updatedAt: new Date().toISOString(),
            orders: Array.from({ length: 667 }, (_, i) => ({
              orderId: String(10000 + i),
              sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${10000 + i}`,
              state: i < 4 ? 'failed' : 'done',
              error: i < 4 ? 'Unsupported order total: synthetic service.' : '',
              expectedRows: 2,
            })),
          })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
        }
      })
  )
  const before = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
  )
  const page = await openLibrary(extension)
  await page.getByRole('button', { name: /^Activity/ }).click()
  const downloaded = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Save import report', exact: true })
    .click()
  const download = await downloaded
  expect(await download.failure()).toBeNull()
  const downloads = await extension.inspector.evaluate(() =>
    chrome.downloads.search({})
  )
  expect(downloads).toHaveLength(1)
  expect(downloads[0].state).toBe('complete')
  const report = JSON.parse(await readFile(downloads[0].filename, 'utf8'))
  expect(report.format).toBe('1688-import-report')
  expect(report.orders).toHaveLength(667)
  expect(report.counts).toEqual({
    expected: 667,
    discovered: 667,
    saved: 663,
    failed: 4,
    pending: 0,
    undiscovered: 0,
    remaining: 4,
  })
  expect(report.errors).toEqual([
    { message: 'Unsupported order total: synthetic service.', count: 4 },
  ])
  expect(report.orders[3].error).toContain('synthetic service')
  expect(report.job.totalPages).toBe(67)
  expect(JSON.stringify(report)).not.toContain('private filter')
  await expect(page.locator('#order-count')).toHaveText('3')
  const after = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
  )
  expect(after).toEqual(before)
  expect(extension.unexpectedRequests).toEqual([])
})

test('resuming an old bulk import requires a visible scope confirmation', async ({
  extension,
}) => {
  await seed(extension)
  await extension.inspector.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('1688-order-library')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('jobs', 'readwrite')
          tx.objectStore('jobs').put({
            id: 'legacy-bulk-test',
            state: 'paused',
            phase: 'details',
            kind: 'import',
            page: 67,
            total: 667,
            orders: [],
            error: 'Previous job paused',
            updatedAt: new Date().toISOString(),
          })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
        }
      })
  )
  const page = await openLibrary(extension)
  await page.getByRole('button', { name: /^Activity/ }).click()
  await page
    .getByRole('button', { name: 'Resume / retry', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Confirm bulk import' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('667 orders')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('#jobs')).toContainText('paused')
  expect(extension.unexpectedRequests).toEqual([])
})
test('library restores complete orders and copies five columns with separate images', async ({
  extension,
}) => {
  await seed(extension)
  const page = await openLibrary(extension)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    8
  )
  await expect(page.locator('#order-count')).toHaveText('3')
  await expect(
    page.getByRole('checkbox', { name: 'Headers', exact: true })
  ).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'Headers', exact: true }).check()
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.getByRole('button', { name: 'Copy to Excel', exact: true }).click()
  await expect(page.locator('#copy-excel')).toHaveText('Copied')
  await expect(page.locator('#copy-excel')).toHaveClass(/copied/)
  await expect(page.locator('#feedback')).toBeEmpty()
  const copied = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0]
    return {
      text: await (await item.getType('text/plain')).text(),
      html: await (await item.getType('text/html')).text(),
    }
  })
  expect(copied.text.split('\r\n')).toHaveLength(9)
  expect(
    copied.text.split('\r\n').every((line) => line.split('\t').length === 5)
  ).toBe(true)
  expect(copied.html.match(/<img /g)).toHaveLength(8)
  expect(copied.text).toContain('颜色：橄榄绿 · 尺码：均码')
  expect(extension.unexpectedRequests).toEqual([])
})
test('filters and explicit product selections determine copy scope', async ({
  extension,
}) => {
  await seed(extension)
  const page = await openLibrary(extension)
  await page
    .getByRole('searchbox', { name: 'Search products and orders', exact: true })
    .fill('candle')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    2
  )
  await page
    .locator('#sheet-body tr[data-selection-key]')
    .first()
    .locator('.product-title')
    .click()
  await page.getByRole('checkbox', { name: 'Headers', exact: true }).uncheck()
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.getByRole('button', { name: 'Copy values', exact: true }).click()
  await expect(page.locator('#copy-values')).toHaveText('Copied')
  await expect(page.locator('#feedback')).toBeEmpty()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).not.toContain('Thumbnail')
  expect(text.split('\t')).toHaveLength(5)
  expect(text).toContain('warm amber')
  await page
    .getByRole('searchbox', { name: 'Search products and orders', exact: true })
    .clear()
  await page
    .getByRole('checkbox', { name: 'Changed only', exact: true })
    .check()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    1
  )
})
test('order cards select across their full surface, range-select and open details only on double-click or Enter', async ({
  extension,
}) => {
  await seed(extension)
  const page = await openLibrary(extension)
  const cards = page.locator('.order-card')
  const card = cards.first()
  const details = page.locator('#order-details')
  const close = details.getByRole('button', { name: 'Close order details' })
  await expect(cards).toHaveCount(3)
  await expect(cards.locator('input[type=checkbox]')).toHaveCount(0)
  await expect(card).toHaveAttribute('aria-selected', 'false')
  for (const target of [
    card.locator('.badge'),
    card.locator('.order-status'),
    card.locator('.purchase-date'),
  ]) {
    await target.click()
    await expect(card).toHaveAttribute('aria-selected', 'true')
    await expect(details).not.toBeVisible()
    await expect(
      page.locator('#sheet-body tr[data-selection-key]')
    ).toHaveCount(3)
    await page.getByRole('button', { name: 'Show all', exact: true }).click()
  }
  // Padding and labels belong to the same selection and hover surface.
  const box = await card.boundingBox()
  await page.mouse.click(box.x + box.width - 3, box.y + box.height - 3)
  await expect(card).toHaveAttribute('aria-selected', 'true')
  await expect(details).not.toBeVisible()
  await cards.last().click({ modifiers: ['Shift'] })
  await expect(page.locator('.order-card[aria-selected=true]')).toHaveCount(3)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    8
  )
  await cards.nth(1).click({ modifiers: ['Control'] })
  await expect(page.locator('.order-card[aria-selected=true]')).toHaveCount(2)
  await expect(cards.nth(1)).toHaveAttribute('aria-selected', 'false')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    5
  )
  await cards.nth(1).click()
  await expect(page.locator('.order-card[aria-selected=true]')).toHaveCount(1)
  await expect(cards.nth(1)).toHaveAttribute('aria-selected', 'true')

  await card.dblclick()
  await expect(details).toBeVisible()
  await close.click()
  await expect(card).toBeFocused()
  await card.press('Enter')
  await expect(details).toBeVisible()
  await close.click()
  await expect(card).toBeFocused()
  await card.locator('.badge').hover()
  expect(
    await card.evaluate((node) => getComputedStyle(node).backgroundColor)
  ).not.toBe('rgba(0, 0, 0, 0)')
  expect(extension.unexpectedRequests).toEqual([])
})

test('product rows support ranges and toggles while image and copy actions preserve selection', async ({
  extension,
}) => {
  await seed(extension)
  const page = await openLibrary(extension)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(8)
  await expect(rows.locator('input[type=checkbox]')).toHaveCount(0)
  const selected = page.locator('#sheet-body tr[aria-selected=true]')
  await rows.nth(1).locator('.product-title').click()
  await rows
    .nth(4)
    .locator('.product-title')
    .click({ modifiers: ['Shift'] })
  await expect(selected).toHaveCount(4)
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'false')
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(rows.nth(4)).toHaveAttribute('aria-selected', 'true')
  await rows
    .nth(2)
    .locator('.product-title')
    .click({ modifiers: ['Control'] })
  await expect(selected).toHaveCount(3)
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'false')
  await rows
    .nth(6)
    .locator('.product-title')
    .click({ modifiers: ['Control'] })
  await expect(selected).toHaveCount(4)
  await expect(page.locator('#selection-summary')).toContainText('4 selected')

  const beforeActions = await selected.evaluateAll((items) =>
    items.map((item) => item.dataset.selectionKey)
  )
  await rows
    .first()
    .getByRole('button', { name: /^Zoom product photo/ })
    .click()
  const photo = page.getByRole('dialog', { name: 'Product photo', exact: true })
  await expect(photo).toBeVisible()
  await photo
    .getByRole('button', { name: 'Close product photo', exact: true })
    .click()
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await rows
    .first()
    .getByRole('button', { name: 'Copy image', exact: true })
    .click()
  await expect(
    rows.first().getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible()
  expect(
    await selected.evaluateAll((items) =>
      items.map((item) => item.dataset.selectionKey)
    )
  ).toEqual(beforeActions)
  await expect(page.locator('#order-details')).not.toBeVisible()

  await page
    .getByRole('button', { name: 'Select all rows', exact: true })
    .click()
  await expect(selected).toHaveCount(8)
  await page
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  await expect(selected).toHaveCount(0)
  await rows.nth(2).locator('.product-title').click()
  await expect(selected).toHaveCount(1)
  await rows.nth(2).press('Shift+ArrowDown')
  await expect(selected).toHaveCount(2)
  await expect(rows.nth(3)).toBeFocused()
  await rows.nth(3).press('Control+Space')
  await expect(selected).toHaveCount(1)
  await expect(rows.nth(3)).toHaveAttribute('aria-selected', 'false')
  await rows.nth(3).press('Control+ArrowDown')
  await expect(rows.nth(4)).toBeFocused()
  await expect(selected).toHaveCount(1)
  // Move away from the last clicked action so its hover hint does not own Escape.
  await page.mouse.move(0, 0)
  await expect(page.locator('.preparation-help-popover:visible')).toHaveCount(0)
  await rows.nth(4).press('Escape')
  await expect(selected).toHaveCount(0)
  await rows.nth(4).press('Control+a')
  await expect(selected).toHaveCount(8)
  await expect(page.locator('.order-card[aria-selected=true]')).toHaveCount(0)
  await page
    .getByRole('searchbox', { name: 'Search products and orders', exact: true })
    .fill('candle')
  await expect(rows).toHaveCount(2)
  await rows.first().locator('.product-title').click()
  await rows
    .last()
    .locator('.product-title')
    .click({ modifiers: ['Shift'] })
  await expect(selected).toHaveCount(2)
  await expect(page.locator('#selection-summary')).toHaveText(
    '2 rows · 2 selected'
  )
  await page.locator('.order-card').first().click()
  await expect(rows).toHaveCount(1)
  await expect(selected).toHaveCount(0)
  await expect(page.locator('.order-card[aria-selected=true]')).toHaveCount(1)
  expect(extension.unexpectedRequests).toEqual([])
})

test('notes are editable separately and survive a later source revision', async ({
  extension,
}) => {
  const records = await seed(extension)
  const page = await openLibrary(extension)
  await page
    .locator('.order-card')
    .filter({ hasText: 'Habitat Studio' })
    .dblclick()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByLabel('Your notes').fill('Reserved for display')
  await page.getByLabel('Tags (comma separated)').fill('October, home')
  await page.getByRole('button', { name: 'Save notes', exact: true }).click()
  await expect(page.locator('#feedback')).toContainText('Notes saved')
  const incoming = structuredClone(records[0])
  incoming.snapshot.observedAt = '2026-10-14T12:00:00.000Z'
  incoming.lastCheckedAt = incoming.changedAt = incoming.snapshot.observedAt
  incoming.snapshot.items[0].description = 'Revised synthetic product'
  const response = await extension.inspector.evaluate(
    async (record) =>
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
    incoming
  )
  expect(response.ok, response.error).toBe(true)
  await page.reload()
  await expect(page.locator('#sheet-body')).toContainText(
    'Revised synthetic product'
  )
  await page
    .locator('.order-card')
    .filter({ hasText: 'Habitat Studio' })
    .dblclick()
  await expect(page.getByLabel('Your notes')).toHaveValue(
    'Reserved for display'
  )
  await expect(page.getByLabel('Tags (comma separated)')).toHaveValue(
    'October, home'
  )
  await page.getByText('Previous versions', { exact: true }).click()
  await expect(page.locator('.history-entry')).toContainText('description:')
})
test('empty library gives a starting action and narrow widths contain table overflow', async ({
  extension,
}) => {
  const page = await openLibrary(extension)
  await expect(page.getByText('Your orders belong here.')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Copy to Excel', exact: true })
  ).toBeDisabled()
  await seed(extension)
  await page.reload()
  await page.setViewportSize({ width: 320, height: 700 })
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    8
  )
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  expect(
    await page
      .locator('.table-scroll')
      .evaluate((el) => el.scrollWidth > el.clientWidth)
  ).toBe(true)
})
test('copy images only produces one picture per selected row', async ({
  extension,
}) => {
  const records = await seed(extension)
  const page = await openLibrary(extension)
  await page
    .getByRole('option', {
      name: `Order ${records[0].snapshot.orderId}`,
      exact: true,
    })
    .click()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.getByRole('button', { name: 'Copy images', exact: true }).click()
  await expect(page.locator('#copy-images')).toHaveText('Copied')
  await expect(page.locator('#feedback')).toBeEmpty()
  const html = await page.evaluate(
    async () =>
      await (
        await (await navigator.clipboard.read())[0].getType('text/html')
      ).text()
  )
  expect(html.match(/<img /g)).toHaveLength(3)
  expect(html).not.toContain('Description')
})

test('large image backups restore and export without runtime message limits', async ({
  extension,
}, testInfo) => {
  test.setTimeout(90_000)
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  // A valid synthetic PNG with trailing padding provides bounded image records
  // whose combined backup exceeds Chrome's 64 MiB runtime message ceiling.
  const raster = Buffer.concat([
    Buffer.from(records[0].snapshot.items[0].thumbnail.split(',')[1], 'base64'),
    Buffer.alloc(1_400_000),
  ])
  const dataUrl = `data:image/png;base64,${raster.toString('base64')}`
  const backup = {
    format: '1688-order-library',
    version: 1,
    exportedAt: new Date().toISOString(),
    orders: records,
    history: [],
    images: Array.from({ length: 37 }, (_, index) => ({
      url: `https://cbu01.alicdn.com/synthetic-backup-${index}.png`,
      dataUrl,
      storedAt: new Date().toISOString(),
    })),
  }
  const buffer = Buffer.from(JSON.stringify(backup))
  expect(buffer.byteLength).toBeGreaterThan(64 * 1024 * 1024)
  const page = await openLibrary(extension)
  const backupPath = testInfo.outputPath('large-synthetic-backup.json')
  await writeFile(backupPath, buffer)
  await page.locator('#backup-file').setInputFiles(backupPath)
  await expect(page.locator('#feedback')).toContainText('Backup restored', {
    timeout: 30_000,
  })
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    8
  )
  const saved = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('tab', { name: 'Data', exact: true }).click()
  await page.getByRole('button', { name: 'Back up', exact: true }).click()
  const download = await saved
  expect(await download.failure()).toBeNull()
  const downloads = await extension.inspector.evaluate(() =>
    chrome.downloads.search({})
  )
  expect(downloads).toHaveLength(1)
  expect(downloads[0].state).toBe('complete')
  expect((await stat(downloads[0].filename)).size).toBeGreaterThan(
    64 * 1024 * 1024
  )
})

test('purchase dates group orders by month while separators stay out of copied values', async ({
  extension,
}) => {
  await seed(extension)
  const page = await openLibrary(extension)
  await expect(page.locator('.month-toggle > span')).toHaveText([
    'October 2026',
    'September 2026',
  ])
  await expect(page.locator('.order-card .purchase-date')).toHaveText([
    '12 Oct 2026',
    '8 Oct 2026',
    '25 Sept 2026',
  ])
  await expect(
    page.locator('#sheet-body tr[data-selection-key]').first()
  ).toContainText('12 Oct 2026')
  await page
    .locator('.order-card')
    .filter({ hasText: 'Habitat Studio' })
    .dblclick()
  await expect(page.locator('#order-details time.purchase-date')).toHaveText(
    '12 Oct 2026'
  )
  await expect(
    page.locator('#order-details time.purchase-date')
  ).toHaveAttribute('datetime', '2026-10-12')
  await expect(
    page.locator('#order-details time.purchase-date')
  ).toHaveAttribute('title', 'Purchase date')
  await page.getByRole('button', { name: 'Close order details' }).click()
  await page.getByRole('button', { name: 'Show all', exact: true }).click()
  const orderBands = page.locator('.order-section-heading')
  await expect(orderBands).toHaveCount(3)
  await expect(orderBands.first()).toContainText('Habitat Studio')
  await expect(orderBands.first()).toContainText('3 matching products')
  await expect(orderBands.first().locator('.order-section-number')).toHaveText(
    /^Order \d+$/
  )
  await orderBands.first().click()
  await expect(page.locator('#sheet-body tr.is-selected')).toHaveCount(0)
  const productRows = page.locator('#sheet-body tr[data-selection-key]')
  await productRows.first().locator('.row-number').click()
  await productRows
    .nth(4)
    .locator('.row-number')
    .click({ modifiers: ['Shift'] })
  await expect(page.locator('#sheet-body tr.is-selected')).toHaveCount(5)
  await expect(orderBands.locator('[aria-selected]')).toHaveCount(0)
  await page.locator('#clear-rows').click()
  await page.locator('#month-filter > summary').click()
  await page.locator('[data-month="2026-09"]').click()
  await expect(page.locator('.order-card')).toHaveCount(1)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    2
  )
  await expect(orderBands).toHaveCount(1)
  await expect(orderBands.first()).toContainText('2 matching products')
  await page.getByRole('button', { name: 'Show all', exact: true }).click()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    8
  )
  await page.getByRole('checkbox', { name: 'Headers', exact: true }).uncheck()
  await page.reload()
  await expect(
    page.getByRole('checkbox', { name: 'Headers', exact: true })
  ).not.toBeChecked()
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.locator('#copy-values').click()
  await expect(page.locator('#copy-values')).toHaveText('Copied')
  const copied = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0]
    return {
      text: await (await item.getType('text/plain')).text(),
      html: await (await item.getType('text/html')).text(),
    }
  })
  expect(copied.text.split('\r\n')).toHaveLength(8)
  expect(copied.text).not.toContain('Thumbnail')
  expect(copied.html.match(/<tr\b/g)).toHaveLength(8)
  expect(copied.html).not.toContain('order-section')
  expect(copied.html).not.toContain('October')
  await expect(page.locator('#feedback')).toBeEmpty()
})

test('old import messages can be dismissed persistently without losing orders or queues', async ({
  extension,
}) => {
  await seed(extension)
  await extension.inspector.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('1688-order-library')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('jobs', 'readwrite')
          for (const [id, updatedAt, error] of [
            ['z-old', '2026-10-01T00:00:00Z', 'Old stopped import'],
            ['a-new', '2026-10-14T00:00:00Z', 'Recent stopped import'],
          ]) {
            tx.objectStore('jobs').put({
              id,
              state: 'paused',
              phase: 'details',
              kind: 'import',
              updatedAt,
              orders: [],
              error,
            })
          }
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
        }
      })
  )
  const page = await openLibrary(extension)
  await page.getByRole('button', { name: /^Activity/ }).click()
  await expect(page.locator('.job').first()).toContainText(
    'Recent stopped import'
  )
  const actions = page.locator('.job').first().locator('.job-actions button')
  await expect(actions).toHaveText([
    'Resume / retry',
    'Save import report',
    'Dismiss',
  ])
  for (const action of await actions.all()) {
    const box = await action.boundingBox()
    expect(box.height).toBeGreaterThanOrEqual(28)
    expect(box.height).toBeLessThanOrEqual(34)
    await expect(action).toHaveCSS('border-top-width', '1px')
  }
  await page
    .getByRole('button', { name: 'Dismiss', exact: true })
    .first()
    .click()
  await expect(page.locator('.job')).toHaveCount(1)
  await page.getByRole('button', { name: 'Dismiss all', exact: true }).click()
  await confirmOperation(page, 'Dismiss 1 activities')
  await expect(page.locator('.job')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: /^Activity/ }).click()
  await expect(page.locator('.job')).toHaveCount(0)
  await expect(page.locator('#order-count')).toHaveText('3')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    8
  )
  await page
    .getByRole('button', { name: 'Show dismissed', exact: true })
    .click()
  await expect(page.locator('.job')).toHaveCount(2)
  await expect(
    page.getByRole('button', { name: 'Resume / retry', exact: true })
  ).toHaveCount(2)
  const result = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
  )
  expect(result.ok).toBe(true)
  expect(result.data.jobs).toHaveLength(2)
  expect(
    result.data.jobs.every((job) => job.state === 'paused' && job.dismissedAt)
  ).toBe(true)
  expect(extension.unexpectedRequests).toEqual([])
})

test('copy completion keeps controls disabled when the filter changes to no products', async ({
  extension,
}) => {
  await seed(extension)
  const page = await openLibrary(extension)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.evaluate(() => {
    const write = navigator.clipboard.write.bind(navigator.clipboard)
    navigator.clipboard.write = async (items) => {
      await new Promise((resolve) => {
        window.finishSyntheticCopy = resolve
      })
      return write(items)
    }
  })
  await page.locator('#copy-values').click()
  await expect(page.locator('#copy-values')).toHaveAttribute(
    'aria-busy',
    'true'
  )
  await page
    .getByRole('searchbox', { name: 'Search products and orders', exact: true })
    .fill('no matching synthetic products')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    0
  )
  await page.evaluate(() => window.finishSyntheticCopy())
  await expect(page.locator('#copy-values')).toHaveText('Copied')
  for (const id of ['copy-values', 'copy-images', 'copy-excel'])
    await expect(page.locator(`#${id}`)).toBeDisabled()
  await expect(page.locator('#feedback')).toBeEmpty()
})

test('large libraries bound order and product DOM while progress updates avoid rereading orders', async ({
  extension,
}) => {
  const [template] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const orders = Array.from({ length: 750 }, (_, index) => {
    const record = structuredClone(template)
    const number = String(index).padStart(4, '0')
    const orderId = (920000000000000000n + BigInt(index)).toString()
    record.snapshot.orderId = orderId
    record.snapshot.sourceUrl = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`
    record.snapshot.sellerName = `Synthetic load supplier ${number}`
    record.snapshot.items.forEach((item, itemIndex) => {
      item.entryId = `${orderId}${itemIndex}`
      item.description = `Load-test product ${number}/${itemIndex}`
    })
    record.revision = 1
    record.changedEntryIds = []
    return record
  })
  const restored = await extension.inspector.evaluate(
    async (orders) =>
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
  expect(restored.ok, restored.error).toBe(true)
  const page = await openLibrary(extension)
  await expect(page.locator('#product-count')).toHaveText('2,250')
  await expect(page.locator('#order-count')).toHaveText('750')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    100
  )
  await expect(page.locator('.order-card')).toHaveCount(50)
  await expect(page.locator('#page-label')).toHaveText('1 / 23')
  await expect(page.locator('#orders-page')).toHaveText('1 / 15')
  const initialProducts = await page
    .locator('#sheet-body tr[data-selection-key]')
    .allTextContents()
  const initialOrders = await page.locator('.order-card').allTextContents()
  await page
    .locator('#sheet-body tr[data-selection-key]')
    .nth(98)
    .locator('.product-title')
    .click()
  await page
    .getByRole('button', { name: 'Next product page', exact: true })
    .click()
  await expect(page.locator('#page-label')).toHaveText('2 / 23')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    100
  )
  expect(
    await page.locator('#sheet-body tr[data-selection-key]').allTextContents()
  ).not.toEqual(initialProducts)
  await page
    .locator('#sheet-body tr[data-selection-key]')
    .nth(1)
    .locator('.product-title')
    .click({ modifiers: ['Shift'] })
  await expect(page.locator('#selection-summary')).toContainText('4 selected')
  await expect(page.locator('#sheet-body tr[aria-selected=true]')).toHaveCount(
    2
  )
  await page
    .getByRole('button', { name: 'Previous product page', exact: true })
    .click()
  await expect(page.locator('#sheet-body tr[aria-selected=true]')).toHaveCount(
    2
  )
  await page
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()

  await page.locator('.order-card').nth(49).click()
  await page
    .getByRole('button', { name: 'Next order page', exact: true })
    .click()
  await expect(page.locator('#orders-page')).toHaveText('2 / 15')
  await expect(page.locator('.order-card')).toHaveCount(50)
  expect(await page.locator('.order-card').allTextContents()).not.toEqual(
    initialOrders
  )
  await page
    .locator('.order-card')
    .nth(1)
    .click({ modifiers: ['Shift'] })
  await expect(page.locator('#refresh-orders')).toHaveText('Refresh 3 orders')
  await expect(page.locator('.order-card[aria-selected=true]')).toHaveCount(2)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    9
  )
  await page
    .getByRole('searchbox', { name: 'Search orders', exact: true })
    .fill('SUPPLIER 0749')
  await expect(page.locator('.order-card')).toHaveCount(1)
  await expect(page.locator('.order-card')).toContainText(
    'Synthetic load supplier 0749'
  )
  await expect(page.locator('#orders-page')).toHaveText('1 / 1')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await page.locator('.order-card').click({ modifiers: ['Shift'] })
  await expect(page.locator('#refresh-orders')).toHaveText('Refresh 1 order')
  await page
    .getByRole('searchbox', { name: 'Search orders', exact: true })
    .clear()
  await expect(page.locator('.order-card')).toHaveCount(50)
  await expect(page.locator('#orders-page')).toHaveText('1 / 15')
  await page
    .getByRole('searchbox', { name: 'Search products and orders', exact: true })
    .fill('Load-test product 0749/0')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    1
  )
  await expect(page.locator('#sheet-body')).toContainText(
    'Load-test product 0749/0'
  )
  await expect(page.locator('#page-label')).toHaveText('1 / 1')
  await page
    .locator('#sheet-body tr[data-selection-key]')
    .locator('.product-title')
    .click({ modifiers: ['Shift'] })
  await expect(page.locator('#selection-summary')).toContainText('1 selected')
  await page
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  await page
    .getByRole('searchbox', { name: 'Search products and orders', exact: true })
    .clear()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    100
  )
  await expect(page.locator('#selection-summary')).toContainText('2,250 rows')
  await page.getByRole('button', { name: /^Activity/ }).click()

  // Pass through real messages/IndexedDB reads; observe that progress does not
  // fetch or rebuild the complete library when no saved order changed.
  await page.evaluate(() => {
    window.libraryProgressProbe = {
      messages: [],
      orderReads: 0,
      firstRow: document.querySelector('#sheet-body tr[data-selection-key]'),
      firstOrder: document.querySelector('.order-card'),
    }
    const send = chrome.runtime.sendMessage.bind(chrome.runtime)
    chrome.runtime.sendMessage = (...args) => {
      window.libraryProgressProbe.messages.push(args[0]?.type)
      return send(...args)
    }
    for (const prototype of [IDBIndex.prototype, IDBObjectStore.prototype]) {
      const getAll = prototype.getAll
      prototype.getAll = function (...args) {
        if ((this.objectStore?.name || this.name) === 'orders')
          window.libraryProgressProbe.orderReads++
        return getAll.apply(this, args)
      }
    }
  })
  await extension.inspector.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('1688-order-library')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction('jobs', 'readwrite')
        transaction.objectStore('jobs').put({
          id: 'synthetic-load-progress',
          state: 'paused',
          phase: 'details',
          kind: 'import',
          done: 2,
          total: 750,
          discovered: 750,
          remaining: 748,
          orders: [],
          updatedAt: new Date().toISOString(),
        })
        transaction.oncomplete = () => {
          db.close()
          resolve()
        }
        transaction.onerror = () => {
          db.close()
          reject(transaction.error)
        }
      }
    })
    // Broadcasts have no reply; the rendered progress below proves delivery.
    await chrome.runtime
      .sendMessage({ type: 'IMPORT_PROGRESS' })
      .catch(() => {})
  })
  await expect(page.locator('.job')).toContainText(
    '2 saved · 0 need attention · 748 pending'
  )
  await expect(page.locator('.job progress')).toHaveAttribute('value', '2')
  await expect(page.locator('.job progress')).toHaveAttribute('max', '750')
  const progress = await page.evaluate(() => ({
    messages: window.libraryProgressProbe.messages,
    orderReads: window.libraryProgressProbe.orderReads,
    sameRow:
      window.libraryProgressProbe.firstRow ===
      document.querySelector('#sheet-body tr[data-selection-key]'),
    sameOrder:
      window.libraryProgressProbe.firstOrder ===
      document.querySelector('.order-card'),
  }))
  expect(progress.messages).toContain('JOBS_QUERY')
  expect(progress.messages).not.toContain('LIBRARY_QUERY')
  expect(progress.orderReads).toBe(0)
  expect(progress.sameRow).toBe(true)
  expect(progress.sameOrder).toBe(true)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    100
  )
  await expect(page.locator('.order-card')).toHaveCount(50)
  expect(extension.unexpectedRequests).toEqual([])
})

test('purchase date refresh scopes are inclusive, cancellable and inert when empty', async ({
  extension,
}) => {
  await seed(extension)
  const page = await openLibrary(extension)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    8
  )
  await page.evaluate(() => {
    window.refreshScopeMessages = []
    const send = chrome.runtime.sendMessage.bind(chrome.runtime)
    chrome.runtime.sendMessage = (...args) => {
      if (args[0]?.type === 'REFRESH_ORDERS')
        window.refreshScopeMessages.push(args[0])
      return send(...args)
    }
  })
  const initialTabs = await extension.inspector.evaluate(() =>
    chrome.tabs.query({})
  )
  await page.locator('.date-range > summary').click()
  await page.getByLabel('From', { exact: true }).fill('2026-10-08')
  await page.getByLabel('Through', { exact: true }).fill('2026-10-12')
  await expect(page.locator('.order-card')).toHaveCount(2)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    6
  )
  await page
    .getByRole('button', { name: 'Refresh 2 orders', exact: true })
    .click()
  const confirmation = page.getByRole('dialog', {
    name: 'Confirm operation',
    exact: true,
  })
  await expect(
    confirmation.getByRole('button', { name: 'Refresh 2 orders', exact: true })
  ).toBeVisible()
  expect(await page.evaluate(() => window.refreshScopeMessages)).toEqual([])
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await expect(confirmation).not.toBeVisible()

  await page.getByLabel('Through', { exact: true }).fill('2026-10-08')
  await expect(page.locator('.order-card')).toHaveCount(1)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await expect(page.locator('.order-card .purchase-date')).toHaveText(
    '8 Oct 2026'
  )
  await page.locator('.order-card').click()
  await expect(page.locator('#refresh-orders')).toHaveText('Refresh 1 order')
  await page.getByLabel('From', { exact: true }).fill('2026-10-20')
  await page.getByLabel('Through', { exact: true }).fill('2026-10-21')
  await expect(page.locator('.order-card')).toHaveCount(0)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    0
  )
  await expect(page.locator('#refresh-orders')).toHaveText('Refresh 0 orders')
  await expect(page.locator('#refresh-orders')).toBeDisabled()
  await expect(page.locator('#refresh-orders')).toBeDisabled()
  // Exercise the empty-scope guard even if an event is dispatched programmatically.
  await page.locator('#refresh-orders').dispatchEvent('click')
  await expect(confirmation).not.toBeVisible()

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('tab', { name: 'Data', exact: true }).click()
  await page
    .getByRole('button', { name: 'Refresh all orders', exact: true })
    .click()
  await expect(
    confirmation.getByRole('button', { name: 'Refresh 3 orders', exact: true })
  ).toBeVisible()
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await expect(confirmation).not.toBeVisible()
  expect(await page.evaluate(() => window.refreshScopeMessages)).toEqual([])
  const jobs = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
  )
  expect(jobs.ok, jobs.error).toBe(true)
  expect(jobs.data.jobs).toEqual([])
  const finalTabs = await extension.inspector.evaluate(() =>
    chrome.tabs.query({})
  )
  expect(finalTabs.map((tab) => tab.id).sort()).toEqual(
    initialTabs.map((tab) => tab.id).sort()
  )
  expect(extension.unexpectedRequests).toEqual([])
})
