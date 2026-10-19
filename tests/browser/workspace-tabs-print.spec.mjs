import { readFile } from 'node:fs/promises'
import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function open(extension) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
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
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#order-count')).toHaveText('3')
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(8)
  return { page, rows }
}

// The disposable profile saves downloads under their suggested names.
async function savedPath(extension, index) {
  await expect
    .poll(
      async () =>
        (
          await extension.inspector.evaluate(() => chrome.downloads.search({}))
        ).filter((file) => file.state === 'complete').length
    )
    .toBeGreaterThan(index)
  const files = await extension.inspector.evaluate(() =>
    chrome.downloads.search({ orderBy: ['startTime'] })
  )
  return files[index].filename
}

async function assign(page, rows, indexes) {
  await rows.nth(indexes[0]).locator('td.price-cell').click()
  for (const index of indexes.slice(1))
    await rows
      .nth(index)
      .locator('td.price-cell')
      .click({ modifiers: ['Control'] })
  await page.locator('#prepare-orders').click()
  await page
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  await expect(page.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  // Synthetic products may lack a suggested Spanish name; labels need one.
  const names = page.locator('#packing-view .group-name-editor')
  for (let index = 0; index < (await names.count()); index++)
    if (!(await names.nth(index).inputValue()))
      await names.nth(index).fill(`PRODUCTO ${index + 1}`)
  const categories = page.locator(
    '#packing-view .preparation-group [data-packing-field="category"]'
  )
  for (let index = 0; index < (await categories.count()); index++)
    if (!(await categories.nth(index).inputValue()))
      await categories.nth(index).fill('测试')
  await expect(page.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  await page.locator('#view-orders').click()
  await expect(page.locator('#orders-view')).toBeVisible()
}

test('the Packing list tab reopens the month without the Orders selection and keeps Prepare usable', async ({
  extension,
}) => {
  const { page, rows } = await open(extension)
  await page.locator('#packing-month').fill('2026-10')
  await page.locator('#packing-month').blur()
  await assign(page, rows, [0])
  // Select an unassigned product, then activate the tab twice quickly.
  await rows.nth(2).locator('td.price-cell').click()
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true')
  await page.locator('#view-packing').click()
  await page.locator('#view-packing').click()
  await expect(page.locator('#packing-view')).toBeVisible()
  await expect(
    page.getByRole('dialog', { name: 'Assign product codes?', exact: true })
  ).toHaveCount(0)
  await expect(page.locator('#packing-view .preparation-group')).toHaveCount(1)
  await expect(page.locator('#view-packing')).toHaveAttribute(
    'aria-current',
    'page'
  )
  await page.locator('#view-orders').click()
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true')
  // A month without assigned products explains itself and leaves Prepare usable.
  await page.locator('#packing-month').fill('2026-12')
  await page.locator('#packing-month').blur()
  await page.locator('#view-packing').click()
  await expect(page.locator('#feedback, .error-notice').first()).toContainText(
    'No products are assigned to this packing month'
  )
  await expect(page.locator('#orders-view')).toBeVisible()
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#prepare-orders')).toBeEnabled()
})

test('selected amounts stay visible in the action bar on narrow screens', async ({
  extension,
}) => {
  const { page, rows } = await open(extension)
  await rows.nth(0).locator('td.price-cell').click()
  await rows
    .nth(1)
    .locator('td.price-cell')
    .click({ modifiers: ['Control'] })
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 })
    for (const key of ['rows', 'quantity', 'gross', 'after-discounts'])
      await expect(
        page.locator(`.action-bar [data-selection-total="${key}"] dd`)
      ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
  }
})

test('labels export print-ready A4 PDFs with proportional spares, caps, warnings, calibration and recent jobs', async ({
  extension,
}) => {
  const { page, rows } = await open(extension)
  await page.locator('#packing-month').fill('2026-10')
  await page.locator('#packing-month').blur()
  await assign(page, rows, [0, 1])
  // The two prepared rows stay selected after returning to Orders.
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true')
  await page.locator('#orders-print-actions .copy-actions-trigger').click()
  await page.locator('#print-labels').click()
  const dialog = page.getByRole('dialog', { name: 'Print labels', exact: true })
  const quantities = dialog.getByLabel(/^Quantity for /)
  const totals = dialog.locator('.print-counts tbody td:last-child')
  const warnings = dialog.locator('.print-warnings')
  await quantities.first().fill('80')
  await quantities.nth(1).fill('30')
  // 110 labels need two pages; 30 spares are shared by quantity: 22 + 8.
  await expect(dialog.locator('.print-summary')).toHaveText(
    '70 labels per A4 (5 × 14) · Pages: 2'
  )
  await expect(totals).toHaveText(['102', '38'])
  await expect(warnings).toContainText(
    '30 extra labels for 110 requested (27% more)'
  )
  await expect(dialog.locator('.print-page-label')).toHaveText('Page 1 of 2')
  await dialog.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(dialog.locator('.print-page-label')).toHaveText('Page 2 of 2')
  await expect(dialog.locator('.print-page-contents')).toContainText('× 32')
  await quantities.first().fill('40')
  await quantities.nth(1).fill('20')
  await expect(dialog.locator('.print-summary')).toHaveText(
    '70 labels per A4 (5 × 14) · Pages: 1'
  )
  await expect(dialog.locator('.print-page-label')).toHaveText('Page 1 of 1')
  await expect(totals).toHaveText(['47', '23'])
  await expect(warnings).toBeHidden()
  // Secondary modes and caps live under Advanced.
  await dialog.getByText('Advanced', { exact: true }).click()
  await dialog.getByLabel('Share equally', { exact: true }).check()
  await expect(totals).toHaveText(['45', '25'])
  await dialog.getByLabel('Leave blank', { exact: true }).check()
  await expect(totals).toHaveText(['40', '20'])
  await expect(warnings).toContainText('10 places on the last page stay blank.')
  await dialog
    .getByLabel('Share by quantity (recommended)', { exact: true })
    .check()
  await dialog
    .getByLabel('Limit extra copies per product', { exact: true })
    .check()
  await dialog
    .getByLabel(/^Max extra for /)
    .first()
    .fill('2')
  await expect(totals).toHaveText(['42', '28'])
  // Offsets move everything; content closer than 4 mm to an edge is flagged.
  await dialog.getByLabel('Offset X (mm)', { exact: true }).fill('1.5')
  await expect(warnings).toContainText(
    'Some content is 3.5 mm from the paper edge'
  )
  await dialog.getByLabel('Offset X (mm)', { exact: true }).fill('0')
  await expect(warnings).toBeHidden()
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export PDF', exact: true }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(
    /^CE-labels-\d{4}-\d{2}-\d{2}-\d{6}-2-products\.pdf$/
  )
  expect(await download.failure()).toBeNull()
  const pdf = (await readFile(await savedPath(extension, 0))).toString('latin1')
  // Each PDF is followed by its machine-readable summary.
  const labelSummary = JSON.parse(
    await readFile(await savedPath(extension, 1), 'utf8')
  )
  expect(labelSummary).toMatchObject({
    kind: 'labels',
    pages: 1,
    perPage: 70,
    totals: { products: 2, requested: 60, printed: 70 },
  })
  expect(pdf.startsWith('%PDF-1.4')).toBe(true)
  expect(pdf).toContain('/Count 1')
  expect(pdf).toContain('/MediaBox [0 0 595.276 841.89]')
  expect(pdf).toContain('/PrintScaling /None')
  expect(pdf.match(/\/Subtype \/Image/g)).toHaveLength(2)
  expect(pdf.match(/ Do Q/g)).toHaveLength(70)
  expect(pdf).toMatch(
    /\(CE labels - page 1 of 1 - CE\d+ x42 - CE\d+ x28 - print at 100% \\\(Actual size\\\)\) Tj/
  )
  // The calibration sheet uses the same offsets and downloads on its own.
  const calibrating = page.waitForEvent('download')
  await dialog
    .getByRole('button', { name: 'Calibration sheet', exact: true })
    .click()
  expect((await calibrating).suggestedFilename()).toMatch(
    /^CE-print-calibration-\d{4}-\d{2}-\d{2}-\d{6}\.pdf$/
  )
  const sheet = (await readFile(await savedPath(extension, 2))).toString(
    'latin1'
  )
  expect(sheet).toContain('/Count 1')
  expect(sheet).toContain('(CE print calibration) Tj')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

  // A recent job regenerates from current data with its quantities and caps.
  await page.locator('#orders-print-actions .copy-actions-trigger').click()
  await page.locator('#print-recent').click()
  const recent = page.getByRole('dialog', {
    name: 'Recent print jobs',
    exact: true,
  })
  await expect(recent.locator('.print-recent-list > li')).toHaveCount(1)
  await recent
    .getByRole('button', { name: /^Regenerate the print job of / })
    .click()
  const again = page.getByRole('dialog', { name: 'Print labels', exact: true })
  await expect(again.locator('.print-note')).toContainText(
    'Product data may have changed since'
  )
  await expect(again.getByLabel(/^Quantity for /).first()).toHaveValue('40')
  await expect(again.locator('.print-counts tbody td:last-child')).toHaveText([
    '42',
    '28',
  ])
  await again.getByRole('button', { name: 'Cancel', exact: true }).click()

  await page.locator('#orders-print-actions .copy-actions-trigger').click()
  await page.locator('#print-carton-marks').click()
  const marks = page.getByRole('dialog', {
    name: 'Print carton marks',
    exact: true,
  })
  await marks
    .getByLabel(/^Quantity for /)
    .first()
    .fill('2')
  await expect(marks.locator('.print-summary')).toHaveText(
    '2 carton marks per A4 · Pages: 2 · Marks: 3'
  )
  await expect(marks.locator('.print-warnings')).toContainText(
    'The last half page stays blank.'
  )
  const markDownload = page.waitForEvent('download')
  await marks.getByRole('button', { name: 'Export PDF', exact: true }).click()
  expect(await (await markDownload).failure()).toBeNull()
  const markPdf = (await readFile(await savedPath(extension, 3))).toString(
    'latin1'
  )
  expect(markPdf).toContain('/Count 2')
  expect(markPdf).toContain('(Carton 1 of 2) Tj')
  expect(markPdf).toContain('(Carton 2 of 2) Tj')
  expect(markPdf.match(/ Do Q/g)).toHaveLength(3)
  expect(extension.unexpectedRequests).toEqual([])
})

test('an export in progress freezes its inputs, and Cancel or fractional quantities never export', async ({
  extension,
}) => {
  const { page, rows } = await open(extension)
  await page.locator('#packing-month').fill('2026-10')
  await page.locator('#packing-month').blur()
  await assign(page, rows, [0])
  await page.locator('#orders-print-actions .copy-actions-trigger').click()
  await page.locator('#print-labels').click()
  const dialog = page.getByRole('dialog', { name: 'Print labels', exact: true })
  const quantity = dialog.getByLabel(/^Quantity for /).first()
  const exportButton = dialog.getByRole('button', {
    name: 'Export PDF',
    exact: true,
  })
  // A fractional quantity is refused rather than rounded down.
  await quantity.fill('2.5')
  await expect(dialog.locator('.print-summary')).toHaveText(
    'Enter whole numbers from 0 to 9999.'
  )
  await expect(quantity).toHaveAttribute('aria-invalid', 'true')
  await expect(exportButton).toBeDisabled()
  // A value the native field accepts but the dialog rejects is marked too.
  await quantity.fill('1e2')
  await expect(quantity).toHaveAttribute('aria-invalid', 'true')
  await expect(exportButton).toBeDisabled()
  await quantity.fill('3')
  await expect(quantity).not.toHaveAttribute('aria-invalid', /.*/)
  await expect(exportButton).toBeEnabled()
  // Hold the PDF image encoding so the export stays in progress.
  await page.evaluate(() => {
    const Real = CompressionStream
    const gate = new Promise((resolve) => (window.releaseEncoding = resolve))
    window.CompressionStream = class {
      constructor(format) {
        const held = new TransformStream({
          async transform(chunk, controller) {
            await gate
            controller.enqueue(chunk)
          },
        })
        this.writable = held.writable
        this.readable = held.readable.pipeThrough(new Real(format))
      }
    }
  })
  await page.evaluate(() => {
    window.exportSettled = new Promise((resolve) =>
      document.addEventListener(
        'print-export-settled',
        (event) => resolve(event.detail),
        { once: true }
      )
    )
  })
  await exportButton.click()
  await expect(dialog.locator('.print-left > .print-status')).toContainText(
    'Preparing 1 of 1'
  )
  await expect(dialog.locator('.print-left')).toHaveAttribute('inert', '')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.evaluate(() => window.releaseEncoding())
  // Wait until the abandoned export has really finished, then check nothing saved.
  expect(await page.evaluate(() => window.exportSettled)).toEqual({
    saved: false,
  })
  expect(
    await extension.inspector.evaluate(() => chrome.downloads.search({}))
  ).toHaveLength(0)
  await page.locator('#orders-print-actions .copy-actions-trigger').click()
  await page.locator('#print-recent').click()
  await expect(
    page.getByRole('dialog', { name: 'Recent print jobs', exact: true })
  ).toContainText('No recent print jobs yet.')
})

test('expanding older purchase months keeps keyboard focus on the toggle', async ({
  extension,
}) => {
  const base = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  // Nine synthetic orders in nine different purchase months.
  const orders = Array.from({ length: 9 }, (_, index) => {
    const record = structuredClone(base[index % base.length])
    const month = String(10 - index).padStart(2, '0')
    record.snapshot.orderId = `90000000000000010${index}`
    record.snapshot.sourceUrl = record.snapshot.sourceUrl.replace(
      /orderId=\d+/,
      `orderId=${record.snapshot.orderId}`
    )
    record.snapshot.purchasedAt = `2026-${month}-05T10:00:00+08:00`
    return record
  })
  const restored = await extension.inspector.evaluate(
    (records) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders: records,
          history: [],
          images: [],
        },
      }),
    orders
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#order-count')).toHaveText('9')
  const more = page.locator('#month-options .month-more')
  await expect(more).toHaveText('+2 months')
  await expect(
    page.locator('#month-options .month-choice:not(.month-more)')
  ).toHaveCount(7)
  await more.focus()
  await page.keyboard.press('Enter')
  await expect(
    page.locator('#month-options .month-choice:not(.month-more)')
  ).toHaveCount(9)
  await expect(more).toHaveText('Fewer months')
  await expect(more).toBeFocused()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Enter')
  await expect(more).toHaveText('+2 months')
  await expect(more).toBeFocused()
})
