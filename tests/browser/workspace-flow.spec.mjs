import {
  copyCurrentImageBatch,
  revealCopyActions,
} from './copy-actions-helpers.mjs'
import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { summarizeOrders } from '../../src/order-summary.js'

async function open(
  extension,
  { longSeller = false, configure, clock = false } = {}
) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  if (longSeller)
    records[0].snapshot.sellerName =
      'Synthetic Homewares Workshop / 合成家居用品测试店铺名称'
  configure?.(records)
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
  const now = new Date('2026-10-15T12:00:00+08:00')
  if (clock) await page.clock.install({ time: now })
  else await page.clock.setFixedTime(now)
  await page.addInitScript(() => {
    if (localStorage.getItem('1688-library-purchase-months') === null)
      localStorage.setItem('1688-library-purchase-months', '[]')
  })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#order-count')).toHaveText('3')
  return { page, records }
}
const money = (value) =>
  `¥ ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function enableClipboard(extension, page) {
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.bringToFront()
}

test.describe('copy progress and recovery', () => {
  const width = 390
  test(`group codes confirm completed copying and reset for the next copy`, async ({
    extension,
  }) => {
    const { page } = await open(extension, {
      clock: true,
      configure(records) {
        records[0].snapshot.sellerMemberLogin = 'synthetic-copy-toolbar-store'
      },
    })
    await page.setViewportSize({ width, height: 960 })
    await enableClipboard(extension, page)
    await page
      .locator('#sheet-body tr.selectable-row .row-number')
      .first()
      .click()
    await page.locator('#prepare-orders').click()
    await page
      .getByRole('button', { name: 'Assign codes and prepare', exact: true })
      .click()
    const view = page.locator('#packing-view')
    await expect(view).toBeVisible()
    await expect(view.locator('.preparation-save-status')).toHaveText(
      'Saved automatically'
    )
    await view.page().locator('#view-orders').click()
    const code = await page
      .locator('#sheet-body .row-code-copy')
      .first()
      .textContent()
    expect(code).toMatch(/^CE2610\d{4}$/)
    await revealCopyActions(page)
    const button = page.locator('#copy-group-codes')
    await button.click()
    await expect(button).toHaveText('Copied')
    await expect(button).toHaveClass(/copied/)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code)
    await page.clock.fastForward(3001)
    await expect(button).toHaveText('Group codes')
    expect(extension.unexpectedRequests).toEqual([])
  })

  test(`image-copy progress retains the chosen rows while filters change`, async ({
    extension,
  }) => {
    const { page } = await open(extension)
    await page.setViewportSize({ width, height: 960 })
    await enableClipboard(extension, page)
    await revealCopyActions(page)
    // Hold one genuine image decode while the user changes the visible scope.
    // Conversion and the final HTML clipboard write still use native browser APIs.
    await page.evaluate(() => {
      const decode = Image.prototype.decode
      let held = false
      Image.prototype.decode = function (...args) {
        const decoded = decode.apply(this, args)
        if (
          held ||
          document.getElementById('copy-images').getAttribute('aria-busy') !==
            'true'
        )
          return decoded
        held = true
        return decoded.then(
          () =>
            new Promise((resolve) => {
              window.finishCopyImage = resolve
            })
        )
      }
    })
    const button = page.locator('#copy-images')
    await button.click()
    await expect
      .poll(() => page.evaluate(() => Boolean(window.finishCopyImage)))
      .toBe(true)
    await expect(button).toHaveText('Copying…')
    await expect(button).toBeDisabled()
    const dialog = page.locator('.image-copy-dialog')
    const progress = dialog.locator('.image-copy-progress')
    await expect(progress).toContainText('Preparing')
    await expect(progress).toHaveAttribute('role', 'status')
    await expect(dialog.locator('.image-copy-submit')).toBeDisabled()
    await page.evaluate(() => {
      const search = document.getElementById('search')
      search.value = 'no matching product'
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await expect(page.locator('#sheet-body tr.selectable-row')).toHaveCount(0)
    await expect(button).toBeDisabled()
    await page.evaluate(() => window.finishCopyImage())
    await expect(dialog.locator('.copy-preview img')).toHaveCount(8)
    await copyCurrentImageBatch(page)
    await expect(button).toHaveText('Copied')
    await expect(button).toBeDisabled()
    await expect(progress).toHaveCount(0)
    const count = await page.evaluate(async () => {
      const item = (await navigator.clipboard.read())[0]
      const html = await (await item.getType('text/html')).text()
      return new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelectorAll('tr img').length
    })
    expect(count).toBe(8)
    await page.locator('#search').fill('')
    await expect(button).toHaveText('Product photos', { timeout: 4500 })
    await expect(button).toBeEnabled()
    expect(extension.unexpectedRequests).toEqual([])
  })

  test(`Excel image dialog cancellation preserves the clipboard`, async ({
    extension,
  }) => {
    const { page } = await open(extension)
    await page.setViewportSize({ width, height: 960 })
    await enableClipboard(extension, page)
    await page.evaluate(async () => {
      await navigator.clipboard.writeText(
        'Synthetic copy cancellation sentinel'
      )
      const encode = HTMLCanvasElement.prototype.toBlob
      HTMLCanvasElement.prototype.toBlob = function (...args) {
        if (this.width > 1500)
          window.finishCopyTableImage = () => encode.apply(this, args)
        else return encode.apply(this, args)
      }
    })
    const button = page.locator('#copy-excel-image')
    await button.click()
    await expect
      .poll(() => page.evaluate(() => Boolean(window.finishCopyTableImage)))
      .toBe(true)
    await expect(button).toHaveText('Copying…')
    const dialog = page.locator('.image-copy-dialog')
    await expect(dialog.locator('.image-copy-progress')).toContainText(
      'Creating image 8/8…'
    )
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.evaluate(() => window.finishCopyTableImage())
    await expect(button).toHaveText('Excel image')
    await expect(dialog).toHaveCount(0)
    await expect(button).toBeEnabled()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'Synthetic copy cancellation sentinel'
    )
    expect(extension.unexpectedRequests).toEqual([])
  })

  test(`image-copy errors persist until a successful retry`, async ({
    extension,
  }) => {
    let unavailable = true,
      picture
    const url = 'https://cbu01.alicdn.com/img/ibank/synthetic-toolbar-copy.png'
    await extension.context.route(url, (route) =>
      unavailable
        ? route.fulfill({
            status: 503,
            contentType: 'text/plain',
            body: 'Synthetic image unavailable',
          })
        : route.fulfill({
            contentType: 'image/png',
            body: Buffer.from(picture.split(',')[1], 'base64'),
          })
    )
    const { page } = await open(extension, {
      clock: true,
      configure(records) {
        picture = records[0].snapshot.items[0].thumbnail
        records[0].snapshot.items[0].thumbnail = url
      },
    })
    await page.setViewportSize({ width, height: 960 })
    await enableClipboard(extension, page)
    await page
      .locator('#sheet-body tr.selectable-row .row-number')
      .first()
      .click()
    await revealCopyActions(page)
    const button = page.locator('#copy-images')
    await button.click()
    const dialog = page.locator('.image-copy-dialog')
    const error = dialog.getByRole('alert')
    await expect(error).toContainText('Thumbnail could not be loaded (503).')
    await expect(dialog.locator('.image-copy-submit')).toBeDisabled()
    await expect(error).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Retry', exact: true })
    ).toBeEnabled()
    await page.clock.fastForward(3100)
    await expect(error).toBeVisible()
    unavailable = false
    await dialog.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
    await expect(error).toHaveCount(0)
    await copyCurrentImageBatch(page)
    await expect(button).toHaveText('Copied')
    await expect(button).toHaveClass(/copied/)
    expect(
      await page.evaluate(async () => {
        const item = (await navigator.clipboard.read())[0]
        const html = await (await item.getType('text/html')).text()
        return new DOMParser()
          .parseFromString(html, 'text/html')
          .querySelectorAll('img').length
      })
    ).toBe(1)
    expect(extension.unexpectedRequests).toEqual([])
  })
})

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
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    8
  )
  await september.click()
  await expect(page.locator('.order-card')).toHaveCount(1)
  await page.locator('[data-month="2026-09"]').click()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    2
  )
  await page.locator('[data-month="2026-10"]').click({ modifiers: ['Shift'] })
  await expect(page.locator('#month-options [aria-pressed=true]')).toHaveCount(
    2
  )
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    8
  )
  await page.locator('[data-month="2026-09"]').click()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    6
  )
  await expect(page.locator('#refresh-orders')).toHaveText('Refresh 2 orders')
  await expect(page.locator('#refresh-scope')).toHaveText(
    'Selected months · matching search'
  )
})

test('filtered totals count each whole order once and row clicks toggle without intercepting controls', async ({
  extension,
}) => {
  const { page, records } = await open(extension, { longSeller: true })
  for (const host of [
    page.locator('.order-card').first(),
    page.locator('.order-section-band').first(),
  ]) {
    await expect(host.locator('.order-seller')).toHaveText(
      records[0].snapshot.sellerName
    )
    await expect(
      host.locator('.order-reference, .order-section-number')
    ).toHaveText(records[0].snapshot.orderId)
  }
  const total = page.locator('#order-totals .totals-payable dd')
  await expect(total).toHaveText(
    money(summarizeOrders(records).amounts.payable)
  )
  await page.locator('.order-card-meta').first().click()
  await expect(page.locator('.order-card[aria-selected=true]')).toHaveCount(1)
  await expect(total).toHaveText(money(records[0].snapshot.totals.payable))
  await page.locator('.order-card-meta').first().click()
  await expect(page.locator('.order-card[aria-selected=true]')).toHaveCount(0)
  await expect(total).toHaveText(
    money(summarizeOrders(records).amounts.payable)
  )
  await page.locator('#search').fill('warm amber')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    1
  )
  await expect(page.locator('.totals-scope')).toHaveText(
    'Whole-order totals · 1 matching order'
  )
  await expect(total).toHaveText(money(records[0].snapshot.totals.payable))
  const row = page.locator('#sheet-body tr[data-selection-key]')
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

test('workspace hints are compact, leave with the pointer and dismiss when editing starts', async ({
  extension,
}) => {
  const { page } = await open(extension)
  const settings = page.getByRole('button', { name: 'Settings', exact: true })
  await settings.hover()
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip.locator(':scope > span').first()).toHaveText(
    'Label layout, naming rules, backup and restore.'
  )
  await expect(tooltip.locator('kbd')).toHaveText('Alt+Shift+S')
  expect(
    await tooltip.evaluate((node) =>
      parseFloat(getComputedStyle(node).fontSize)
    )
  ).toBeLessThanOrEqual(12)
  expect((await tooltip.boundingBox()).width).toBeLessThanOrEqual(280)
  await page.mouse.move(5, 5)
  await expect(tooltip).toHaveCount(0)
  await settings.hover()
  await expect(tooltip).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tooltip).toHaveCount(0)
  await expect(page.locator('#settings-dialog')).not.toBeVisible()
  const search = page.locator('#order-search')
  await search.focus()
  await expect(tooltip).toContainText('full order number')
  await search.fill('Habitat')
  await expect(tooltip).toHaveCount(0)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await expect(settings).toHaveCSS('text-decoration-line', 'none')
})
