// Windows-only acceptance through real browser and Windows clipboard APIs.
// Each native probe owns a new unsaved workbook; no existing workbook is opened.
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { startPreview } from './preview.mjs'

if (process.platform !== 'win32')
  throw new Error('This check needs Windows desktop Excel.')
const execFileAsync = promisify(execFile)
async function probe(request) {
  // Keep the fixture server and browser protocol responsive while Excel pastes.
  const operation = execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-STA',
      '-File',
      fileURLToPath(new URL('./excel-clipboard-probe.ps1', import.meta.url)),
      '-RequestBase64',
      Buffer.from(JSON.stringify(request), 'utf8').toString('base64'),
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 120_000 }
  )
  operation.child.stderr.on('data', (phase) => process.stderr.write(phase))
  let result
  try {
    result = await operation
  } catch (error) {
    throw new Error(
      `Excel check failed (${request.name}): ${error.killed ? 'timed out' : error.stderr || error.message}`
    )
  }
  const evidence = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim())
  console.log(
    `Windows Excel clipboard check passed: ${JSON.stringify(evidence)}`
  )
  return evidence
}

const textCell = (address, value) => ({ address, value, kind: 'text' })
const numberCell = (address, value) => ({
  address,
  value: Number(value),
  kind: 'number',
})
const compactDescription = (value) => value.replace(/[\t\r\n]+/g, ' · ')

let preview, browser, page
try {
  const fixture = await build({
    absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
    entryPoints: ['scripts/excel-fixture.js'],
    bundle: true,
    write: false,
    format: 'esm',
  })
  preview = await startPreview()
  browser = await chromium.launch({
    channel: 'chromium',
    headless: false,
    args: ['--window-position=-2400,-2400'],
  })
  const context = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  // Only the fixture data/transport is replaced; UI, renderer, database and
  // clipboard APIs are the production modules bundled from current sources.
  await context.route(`${preview.url}/library-preview.js`, async (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: Buffer.from(fixture.outputFiles[0].contents),
    })
  )
  page = await context.newPage()
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${preview.url}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    8
  )
  await page
    .getByRole('button', { name: 'More copy formats', exact: true })
    .click()
  await page.getByRole('checkbox', { name: 'Headers', exact: true }).check()
  await page.getByRole('button', { name: 'Copy to Excel', exact: true }).click()
  const sourceImages = page.locator('.image-copy-dialog')
  await sourceImages
    .getByRole('button', { name: 'Copy current batch', exact: true })
    .click()
  await expect(sourceImages.locator('.image-copy-progress')).toContainText(
    'Paste into Excel'
  )
  await expect(sourceImages).toBeVisible()
  await sourceImages.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.locator('#copy-excel')).toHaveText('Copied')
  const products = await page.evaluate(() =>
    excelAcceptance.records.flatMap((record) => record.snapshot.items)
  )
  await probe({
    name: 'Source products with pictures and headers',
    rows: 9,
    columns: 5,
    images: products.map((_, index) => ({ row: index + 2, column: 1 })),
    cells: [
      textCell('B1', 'Description'),
      ...products.flatMap((item, index) => [
        textCell(`B${index + 2}`, compactDescription(item.description)),
        numberCell(`C${index + 2}`, item.price),
        numberCell(`D${index + 2}`, item.quantity),
        numberCell(`E${index + 2}`, item.discount),
      ]),
    ],
  })

  await page.goto(`${preview.url}/library.html?labels=1`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await page
    .getByRole('button', { name: 'More copy formats', exact: true })
    .click()
  await page.getByRole('checkbox', { name: 'Headers', exact: true }).uncheck()
  await page.getByLabel('Packing month', { exact: true }).fill('2026-10')
  await page.locator('#select-rows').click()
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const preparation = page.locator('#packing-view')
  await expect(preparation.locator('.preparation-group')).toHaveCount(2)
  await expect(preparation.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  const baseField = preparation
    .locator('.preparation-group')
    .first()
    .getByLabel('Product code', { exact: true })
  await expect(baseField).toHaveValue(/^CE2610\d{4}$/)
  const otherBase = await preparation
    .locator('.preparation-group')
    .nth(1)
    .getByLabel('Product code', { exact: true })
    .inputValue()
  await preparation.getByRole('button', { name: 'Orders', exact: true }).click()

  const firstRow = page.locator('#sheet-body tr[data-selection-key]').first()
  const label = page.getByRole('dialog', { name: 'Label editor', exact: true })
  const copyLabel = label.getByRole('button', {
    name: 'Copy label',
    exact: true,
  })
  // Windows can defer PNG encoding for an offscreen headful window. Wait for
  // actual render readiness; a saved status alone does not mean an image is ready.
  const labelReady = () => expect(copyLabel).toBeEnabled({ timeout: 20_000 })
  await firstRow.getByRole('button', { name: 'Barcode', exact: true }).click()
  const name = label.getByRole('textbox', {
    name: 'Spanish product name',
    exact: true,
  })
  const barcodeCode = label.getByRole('textbox', {
    name: 'Variant code',
    exact: true,
  })
  await labelReady()
  await name.fill('frasco transparente')
  await name.press('Enter')
  await expect(name).toHaveValue('FRASCO TRANSPARENTE')
  await labelReady()
  await barcodeCode.fill('A')
  await barcodeCode.press('Enter')
  await labelReady()
  await name.fill('discarded text')
  await name.press('Escape')
  await expect(name).toHaveValue('FRASCO TRANSPARENTE')
  await labelReady()
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()

  // Editing the group base must affect both the mark and subsequent variant labels.
  await firstRow
    .getByRole('button', { name: 'Carton mark', exact: true })
    .click()
  const category = label.getByRole('textbox', {
    name: 'Chinese category',
    exact: true,
  })
  await category.fill('玻璃制品')
  await category.press('Enter')
  await labelReady()
  const updatedBase = 'CE26109998'
  const markCode = label.getByRole('textbox', {
    name: 'Base CE code',
    exact: true,
  })
  await markCode.fill(updatedBase)
  await markCode.press('Enter')
  await labelReady()
  // Match the complete authored model used by the preview. An omitted field
  // causes a separate canvas render whose font antialiasing can differ by a
  // pixel shade even when that field is not printed on this label kind.
  const markModel = {
    kind: 'mark',
    code: updatedBase,
    category: '玻璃制品',
    spanishName: 'FRASCO',
  }
  const mark = await page.evaluate(
    (model) => excelAcceptance.expectedLabel(model),
    markModel
  )
  assert.deepEqual([mark.width, mark.height], [1754, 1240])
  await copyLabel.click()
  await expect(label.locator('.label-editor-status')).toHaveText('Copied')
  await probe({
    name: 'Latest carton mark at 148.5 × 105 mm',
    images: [{ row: 1, column: 1, widthMm: 148.5, heightMm: 105 }],
    imageHashes: [mark.sha256],
    cells: [],
  })
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()

  await firstRow.getByRole('button', { name: 'Barcode', exact: true }).click()
  await expect(barcodeCode).toHaveValue('A')
  await expect(label.getByLabel('Barcode code', { exact: true })).toHaveText(
    `${updatedBase}AS`
  )
  await expect(name).toHaveValue('FRASCO TRANSPARENTE')
  await labelReady()
  const barcodeModel = {
    kind: 'barcode',
    code: `${updatedBase}AS`,
    spanishName: 'FRASCO TRANSPARENTE',
    category: '玻璃制品',
  }
  const barcode = await page.evaluate(
    (model) => excelAcceptance.expectedLabel(model),
    barcodeModel
  )
  assert.deepEqual([barcode.width, barcode.height], [472, 236])
  await copyLabel.click()
  await expect(label.locator('.label-editor-status')).toHaveText('Copied')
  await probe({
    name: 'Latest barcode and Spanish text at 40 × 20 mm',
    images: [{ row: 1, column: 1, widthMm: 40, heightMm: 20 }],
    imageHashes: [barcode.sha256],
    cells: [],
  })
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()

  await page
    .getByRole('button', { name: 'More copy formats', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Copy preparation columns', exact: true })
    .click()
  const columns = page.getByRole('dialog', {
    name: 'Copy preparation columns',
    exact: true,
  })
  await columns
    .getByRole('button', { name: 'Copy chosen columns', exact: true })
    .click()
  await expect(
    columns.getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible()
  const items = await page.evaluate(
    () => excelAcceptance.records[0].snapshot.items
  )
  await probe({
    name: 'Headerless latest preparation values with one base code per group',
    rows: 3,
    columns: 7,
    images: [],
    cells: [
      textCell('A1', updatedBase),
      textCell('A2', ''),
      textCell('A3', otherBase),
      textCell('B1', `${updatedBase}AS`),
      textCell('B2', `${updatedBase}L`),
      textCell('B3', otherBase),
      textCell('D1', 'FRASCO TRANSPARENTE'),
      textCell('D2', 'FRASCO'),
      textCell('D3', 'CAJA ORGANIZADORA'),
      ...items.flatMap((item, index) => [
        textCell(`C${index + 1}`, compactDescription(item.description)),
        numberCell(`E${index + 1}`, item.price),
        numberCell(`F${index + 1}`, item.quantity),
        numberCell(`G${index + 1}`, item.discount),
      ]),
    ],
  })
  await columns.getByRole('button', { name: 'Close', exact: true }).click()

  // Use the actual row-selection gestures and copy control. The expected pixels
  // come independently from fixture source rows plus their saved preparation.
  const selectedRows = page.locator('#sheet-body tr[data-selection-key]')
  await selectedRows.nth(0).locator('.row-number').click()
  await selectedRows
    .nth(1)
    .locator('.row-number')
    .click({ modifiers: ['Shift'] })
  await expect(page.locator('#selection-summary')).toContainText('2 selected')
  const tableImage = await page.evaluate(() =>
    excelAcceptance.expectedExcelImage([0, 1])
  )
  await page.locator('#copy-excel-image').click()
  const tableImages = page.locator('.image-copy-dialog')
  await tableImages
    .getByRole('button', { name: 'Copy current batch', exact: true })
    .click()
  await expect(tableImages.locator('.image-copy-progress')).toContainText(
    'Paste into Excel',
    { timeout: 20_000 }
  )
  await expect(tableImages).toBeVisible()
  await tableImages.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.locator('#copy-excel-image')).toHaveText('Copied', {
    timeout: 20_000,
  })
  const clipboardTypes = await page.evaluate(
    async () => (await navigator.clipboard.read())[0].types
  )
  assert.deepEqual(clipboardTypes, ['image/png'])
  await probe({
    name: 'Two selected prepared products as one exact table picture',
    format: 'PNG',
    png: tableImage,
    images: [{ row: 1, column: 1 }],
    cells: [textCell('K1', 'Disposable template: preserve this cell')],
  })
  console.log(
    'Windows Excel acceptance passed for product tables, current label images, physical sizes, prepared values and a selected-row table picture.'
  )
} catch (error) {
  if (page && !page.isClosed())
    console.error(
      'Synthetic acceptance UI:',
      await page
        .locator('#label-content, #feedback, .packing-error')
        .allTextContents()
    )
  throw error
} finally {
  try {
    if (browser) await browser.close()
  } finally {
    if (preview) await preview.close()
  }
}
