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

test('labels and carton marks export print-ready A4 PDFs with the computed counts', async ({
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
  await quantities.first().fill('80')
  await quantities.nth(1).fill('30')
  // 110 labels need two pages; the 30 spare places are shared equally.
  await expect(dialog.locator('.print-summary')).toHaveText(
    '70 labels per A4 (5 × 14) · Pages: 2'
  )
  await expect(totals).toHaveText(['95', '45'])
  await dialog
    .getByLabel(/^Quantity for /)
    .first()
    .fill('40')
  await dialog
    .getByLabel(/^Quantity for /)
    .nth(1)
    .fill('20')
  await expect(dialog.locator('.print-summary')).toHaveText(
    '70 labels per A4 (5 × 14) · Pages: 1'
  )
  await expect(totals).toHaveText(['45', '25'])
  await dialog.getByLabel('Share by quantity', { exact: true }).check()
  await expect(totals).toHaveText(['47', '23'])
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export PDF', exact: true }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(
    /^CE-labels-\d{4}-\d{2}-\d{2}-2-products\.pdf$/
  )
  expect(await download.failure()).toBeNull()
  const pdf = (await readFile(await savedPath(extension, 0))).toString('latin1')
  expect(pdf.startsWith('%PDF-1.4')).toBe(true)
  expect(pdf).toContain('/Count 1')
  expect(pdf).toContain('/MediaBox [0 0 595.276 841.89]')
  expect(pdf.match(/\/Subtype \/Image/g)).toHaveLength(2)
  expect(pdf.match(/ Do Q/g)).toHaveLength(70)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

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
  const markDownload = page.waitForEvent('download')
  await marks.getByRole('button', { name: 'Export PDF', exact: true }).click()
  expect(await (await markDownload).failure()).toBeNull()
  const markPdf = (await readFile(await savedPath(extension, 1))).toString(
    'latin1'
  )
  expect(markPdf).toContain('/Count 2')
  expect(markPdf).toContain('(Carton 1 of 2) Tj')
  expect(markPdf).toContain('(Carton 2 of 2) Tj')
  expect(markPdf.match(/ Do Q/g)).toHaveLength(3)
  expect(extension.unexpectedRequests).toEqual([])
})
