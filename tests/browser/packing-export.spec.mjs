import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import XLSX from 'xlsx'

test('packing export previews persistent columns, order, scope and layout before downloading a themed editable workbook', async ({
  extension,
}) => {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
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
  const page = await extension.context.newPage()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await page.locator('#select-rows').click()
  await page.locator('#prepare-orders').click()
  await page.locator('[data-action="review-proceed"]').click()
  const view = page.locator('#packing-view')
  await expect(view).toBeVisible()
  await view
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  await view.locator('.group-select').first().click()
  await view.locator('[data-action="export-packing-list"]').click()
  const dialog = page.locator('.packing-export-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.packing-export-preview th')).toHaveCount(31)
  expect(
    await extension.inspector.evaluate(() => chrome.downloads.search({}))
  ).toHaveLength(0)
  await dialog
    .getByRole('button', { name: 'Clear columns', exact: true })
    .click()
  const download = dialog.locator('[data-action="download-packing-list"]')
  await expect(download).toBeDisabled()
  for (const key of [
    'barcode',
    'description',
    'quantity',
    'cartonWeight',
    'cartonVolume',
  ])
    await dialog.locator(`input[value="${key}"]`).check()
  const quantityLeft = dialog.locator(
    '[data-column="quantity"] [data-offset="-1"]'
  )
  await quantityLeft.click()
  await quantityLeft.click()
  await expect(dialog.locator('.packing-export-preview th').first()).toHaveText(
    'Total quantity'
  )
  await dialog.locator('[data-option="scope"][data-value="selected"]').click()
  await dialog
    .locator('[data-option="photoSize"][data-value="compact"]')
    .click()
  await dialog.getByLabel('Totals row', { exact: true }).uncheck()
  await dialog.getByLabel('Freeze headers', { exact: true }).uncheck()
  await dialog.getByLabel('Column filters', { exact: true }).uncheck()
  await expect(
    dialog.locator('.packing-export-footer [role="status"]')
  ).toHaveText('Products: 1 · Columns: 5')
  await mkdir('work', { recursive: true })
  await dialog.screenshot({ path: 'work/packing-export-popup-wide.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  const box = await dialog.boundingBox()
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  await dialog.screenshot({ path: 'work/packing-export-popup-narrow.png' })
  await expect(download).toBeInViewport()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await dialog.screenshot({ path: 'work/packing-export-popup-narrow.png' })
  await dialog
    .getByRole('button', { name: 'Close export', exact: true })
    .click()
  await view.locator('[data-action="export-packing-list"]').click()
  await expect(dialog.locator('.packing-export-preview th')).toHaveCount(5)
  await expect(dialog.locator('.packing-export-preview th').first()).toHaveText(
    'Total quantity'
  )
  await expect(
    dialog.locator('[data-option="scope"][data-value="selected"]')
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    dialog.locator('[data-option="photoSize"][data-value="compact"]')
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    dialog.getByLabel('Totals row', { exact: true })
  ).not.toBeChecked()
  const workspaceLanguage = await page.evaluate(
    () => document.documentElement.lang
  )
  await dialog.locator('[data-language="es"]').click()
  await expect(dialog).toHaveAttribute('lang', 'es')
  expect(await page.evaluate(() => document.documentElement.lang)).toBe(
    workspaceLanguage
  )
  await dialog.locator('[data-language="en"]').click()
  const theme = await page.evaluate(() => ({
    accent: getComputedStyle(document.documentElement)
      .getPropertyValue('--accent')
      .trim()
      .slice(1)
      .toUpperCase(),
    body: getComputedStyle(document.documentElement)
      .getPropertyValue('--surface')
      .trim()
      .slice(1)
      .toUpperCase(),
  }))
  await download.click()
  await expect(dialog).toHaveCount(0)
  let files
  await expect
    .poll(async () => {
      files = await extension.inspector.evaluate(() =>
        chrome.downloads.search({})
      )
      return files.filter((file) => file.state === 'complete').length
    })
    .toBe(2)
  const file = files.find((file) => file.filename.endsWith('.xlsx')),
    summaryFile = files.find((file) => file.filename.endsWith('.json'))
  const bytes = await readFile(file.filename)
  await writeFile('work/packing-export-selected-synthetic.xlsx', bytes)
  const workbook = XLSX.read(bytes, { type: 'buffer' }),
    sheet = workbook.Sheets[workbook.SheetNames[0]]
  expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })[4]).toEqual([
    'Total quantity',
    'Barcode',
    'Original description',
    'Weight kg/box',
    'Volume m³/box',
  ])
  const archive = XLSX.CFB.read(bytes, { type: 'buffer' })
  const xml = (name) =>
    Buffer.from(
      archive.FileIndex[
        archive.FullPaths.findIndex((path) => path.endsWith(name))
      ].content
    ).toString('utf8')
  expect(xml('/xl/styles.xml')).toContain(theme.accent)
  expect(xml('/xl/styles.xml')).toContain(theme.body)
  expect(xml('/xl/worksheets/sheet1.xml')).not.toContain('<pane ')
  expect(xml('/xl/worksheets/sheet1.xml')).not.toContain('<autoFilter ')
  expect(xml('/xl/worksheets/sheet1.xml')).not.toContain('#REF!')
  const summary = JSON.parse(await readFile(summaryFile.filename, 'utf8'))
  expect(summary.products).toHaveLength(1)
  await page.reload()
  await page.locator('#view-packing').click()
  await page.locator('[data-action="export-packing-list"]').click()
  await expect(dialog.locator('.packing-export-preview th')).toHaveCount(5)
  await dialog
    .getByRole('button', { name: 'Restore default columns', exact: true })
    .click()
  await expect(dialog.locator('.packing-export-preview th')).toHaveCount(31)
  await expect(
    dialog.locator('[data-option="scope"][data-value="selected"]')
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    dialog.locator('[data-option="photoSize"][data-value="compact"]')
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    dialog.getByLabel('Totals row', { exact: true })
  ).not.toBeChecked()
  await expect(
    dialog.getByLabel('Freeze headers', { exact: true })
  ).not.toBeChecked()
  await expect(
    dialog.getByLabel('Column filters', { exact: true })
  ).not.toBeChecked()
  await dialog
    .getByRole('button', { name: 'Close export', exact: true })
    .click()
  await page.close()
})
