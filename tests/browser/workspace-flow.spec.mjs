import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { summarizeOrders } from '../../src/order-summary.js'

async function open(extension, { longSeller = false, configure } = {}) {
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
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00+08:00'))
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

async function watchCopyToolbar(page, id) {
  return page.evaluate((id) => {
    window.copyToolbarObserver?.disconnect()
    const toolbar = document.querySelector('.export-toolbar')
    const button = document.getElementById(id)
    window.copyToolbarGeometry = () => {
      const outer = toolbar.getBoundingClientRect()
      const controls = [
        ...toolbar.querySelectorAll(
          '.copy-actions > button:not(.copy-cancel), .copy-actions > .check'
        ),
      ].map((node) => {
        const box = node.getBoundingClientRect()
        return {
          id: node.id || node.textContent.trim(),
          x: box.left - outer.left,
          y: box.top - outer.top,
          width: box.width,
          height: box.height,
        }
      })
      return {
        width: outer.width,
        height: outer.height,
        rows: new Set(controls.map((box) => Math.round(box.y))).size,
        controls,
      }
    }
    window.copyToolbarSamples = []
    window.copyToolbarObserver = new MutationObserver(() => {
      window.copyToolbarSamples.push({
        label: button.textContent.trim().replace(/\s+/g, ' '),
        geometry: window.copyToolbarGeometry(),
      })
    })
    window.copyToolbarObserver.observe(button, {
      attributes: true,
      childList: true,
      subtree: true,
    })
    return window.copyToolbarGeometry()
  }, id)
}

function sameToolbar(actual, before) {
  expect(actual.rows).toBe(before.rows)
  for (const dimension of ['width', 'height'])
    expect(actual[dimension]).toBeCloseTo(before[dimension], 1)
  expect(actual.controls).toHaveLength(before.controls.length)
  actual.controls.forEach((control, index) => {
    expect(control.id).toBe(before.controls[index].id)
    for (const dimension of ['x', 'y', 'width', 'height'])
      expect(control[dimension]).toBeCloseTo(
        before.controls[index][dimension],
        1
      )
  })
}

async function assertToolbarStable(page, before, labels = []) {
  const { current, samples, fits } = await page.evaluate(() => ({
    current: window.copyToolbarGeometry(),
    samples: window.copyToolbarSamples,
    fits:
      document.documentElement.scrollWidth <= innerWidth &&
      [
        ...document.querySelectorAll(
          '.export-toolbar button, .copy-progress, .copy-error'
        ),
      ]
        .filter((node) => node.getClientRects().length && !node.hidden)
        .every((node) => {
          const box = node.getBoundingClientRect()
          return (
            box.left >= 0 &&
            box.right <= innerWidth &&
            node.scrollWidth <= node.clientWidth + 1
          )
        }),
  }))
  sameToolbar(current, before)
  for (const sample of samples) sameToolbar(sample.geometry, before)
  for (const label of labels)
    expect(samples.some((sample) => sample.label === label)).toBe(true)
  expect(fits).toBe(true)
}

async function enableClipboard(extension, page) {
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.bringToFront()
}

for (const width of [1440, 390]) {
  test(`copy group codes keeps the toolbar steady through success and reset at ${width}px`, async ({
    extension,
  }) => {
    const { page } = await open(extension, {
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
    const view = page.locator('#packing-view')
    await expect(view).toBeVisible()
    await expect(view.locator('.preparation-save-status')).toHaveText(
      'Saved automatically'
    )
    await view.getByRole('button', { name: 'Orders', exact: true }).click()
    const code = await page
      .locator('#sheet-body .row-preparation code')
      .first()
      .textContent()
    expect(code).toMatch(/^CE2610\d{4}$/)
    const before = await watchCopyToolbar(page, 'copy-group-codes')
    const button = page.locator('#copy-group-codes')
    await button.click()
    await expect(button).toHaveText('Copied')
    await expect(button).toHaveClass(/copied/)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code)
    await assertToolbarStable(page, before, ['Copying…', 'Copied'])
    await expect(button).toHaveText('Copy group codes', { timeout: 4500 })
    await assertToolbarStable(page, before, ['Copy group codes'])
    expect(extension.unexpectedRequests).toEqual([])
  })

  test(`image-copy progress preserves the toolbar and the frozen rows at ${width}px`, async ({
    extension,
  }) => {
    const { page } = await open(extension)
    await page.setViewportSize({ width, height: 960 })
    await enableClipboard(extension, page)
    const before = await watchCopyToolbar(page, 'copy-images')
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
    const progress = page.locator('.copy-progress')
    await expect(progress).toHaveText('Preparing images 1–8 of 8…')
    await expect(progress).toHaveAttribute('role', 'status')
    await assertToolbarStable(page, before, ['Copying…'])
    await page.locator('#search').fill('no matching product')
    await expect(page.locator('#sheet-body tr.selectable-row')).toHaveCount(0)
    await expect(button).toBeDisabled()
    await page.evaluate(() => window.finishCopyImage())
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
    await assertToolbarStable(page, before, ['Copied'])
    await page.locator('#search').fill('')
    await expect(button).toHaveText('Copy images', { timeout: 4500 })
    await expect(button).toBeEnabled()
    await assertToolbarStable(page, before, ['Copy images'])
    expect(extension.unexpectedRequests).toEqual([])
  })

  test(`Excel image cancellation stays outside the toolbar and leaves the clipboard unchanged at ${width}px`, async ({
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
    const before = await watchCopyToolbar(page, 'copy-excel-image')
    const button = page.locator('#copy-excel-image')
    await button.click()
    await expect
      .poll(() => page.evaluate(() => Boolean(window.finishCopyTableImage)))
      .toBe(true)
    await expect(button).toHaveText('Copying…')
    await expect(page.locator('.copy-progress')).toContainText(
      'Creating image 8/8…'
    )
    await assertToolbarStable(page, before, ['Copying…'])
    await page
      .locator('.copy-progress')
      .getByRole('button', { name: 'Cancel image', exact: true })
      .click()
    await expect(button).toHaveText('Copy Excel image')
    await expect(page.locator('.copy-progress')).toHaveCount(0)
    await expect(button).toBeEnabled()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'Synthetic copy cancellation sentinel'
    )
    await assertToolbarStable(page, before, ['Copy Excel image'])
    expect(extension.unexpectedRequests).toEqual([])
  })

  test(`image-copy errors stay available and retry without toolbar movement at ${width}px`, async ({
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
    const before = await watchCopyToolbar(page, 'copy-images')
    const button = page.locator('#copy-images')
    await button.click()
    await expect(button).toHaveText('Try again')
    await expect(button).toHaveClass(/copy-failed/)
    const error = page.locator('.copy-error')
    await expect(error).toHaveText('Thumbnail could not be loaded (503).')
    await expect(error).toHaveAttribute('role', 'alert')
    await assertToolbarStable(page, before, ['Copying…', 'Try again'])
    await expect(button).toHaveText('Copy images', { timeout: 4500 })
    await expect(error).toBeVisible()
    await assertToolbarStable(page, before, ['Copy images'])
    unavailable = false
    await button.click()
    await expect(button).toHaveText('Copied')
    await expect(button).toHaveClass(/copied/)
    await expect(error).toHaveCount(0)
    expect(
      await page.evaluate(async () => {
        const item = (await navigator.clipboard.read())[0]
        const html = await (await item.getType('text/html')).text()
        return new DOMParser()
          .parseFromString(html, 'text/html')
          .querySelectorAll('img').length
      })
    ).toBe(1)
    await assertToolbarStable(page, before, ['Copied'])
    expect(extension.unexpectedRequests).toEqual([])
  })
}

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
  await page.locator('#month-filter > summary').click()
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

test('workspace hints are compact, leave with the pointer and dismiss when editing starts', async ({
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
