import { readFile } from 'node:fs/promises'
import { test, expect } from './extension-fixture.mjs'
import { readStoreWorkbook } from '../../src/store-workbook-reader.js'

test('import popup downloads the real editable template and accepts it for review without importing blank rows', async ({
  extension,
}) => {
  const page = await extension.context.newPage()
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await page
    .getByRole('button', { name: 'Import spreadsheet', exact: true })
    .click()
  const dialog = page.locator('.store-import-dialog')
  const link = dialog.locator('.store-import-template')
  for (const [language, label] of [
    ['es', 'Descargar plantilla'],
    ['zh', '下载模板'],
    ['en', 'Download template'],
  ]) {
    await dialog
      .locator(`.popup-language-toggle [data-language="${language}"]`)
      .click()
    await expect(link).toHaveText(label)
  }
  const pending = page.waitForEvent('download')
  await link.click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('store-order-template.xlsx')
  let savedDownload
  await expect
    .poll(async () => {
      const entries = await extension.inspector.evaluate(() =>
        chrome.downloads.search({})
      )
      savedDownload = entries.find(
        (entry) => entry.url === download.url() && entry.state === 'complete'
      )
      return Boolean(savedDownload)
    })
    .toBe(true)
  const bytes = await readFile(savedDownload.filename)
  expect(bytes.subarray(0, 2).toString()).toBe('PK')
  const workbook = await readStoreWorkbook(bytes, {
    filename: download.suggestedFilename(),
  })
  expect(workbook.sheets.map((sheet) => sheet.name)).toEqual([
    'Orders',
    'Guide',
  ])
  expect(
    workbook.sheets[0].rows
      .find((row) => row.row === 5)
      .cells.map((cell) => cell.value)
  ).toContain('perbox')
  await dialog.locator('input[type="file"]').setInputFiles({
    name: '7953.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: bytes,
  })
  await expect(dialog.locator('select[name="sheet"]')).toHaveValue('Orders')
  await expect(dialog.locator('.store-import-product')).toHaveCount(0)
  await dialog
    .getByRole('button', { name: 'Import order', exact: true })
    .click()
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.store-import-status')).toHaveClass(/is-error/)
  const backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(backup.ok).toBe(true)
  expect(backup.data.orders).toHaveLength(0)
})
