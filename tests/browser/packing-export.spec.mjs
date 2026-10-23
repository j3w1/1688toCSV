import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import XLSX from 'xlsx'
import {
  assignSelectedPurchaseCodes,
  loadedSourceContainer,
  editOrderProduct,
  closeOrderProduct,
} from './smart-workspace-helpers.mjs'

test('container export preserves advanced columns/order/layout and exact theme/media while selection cannot narrow the complete revision', async ({
  extension,
}) => {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-frozen-export-supplier'
  record.additionalCharges = [
    { id: 'synthetic-handling', reason: 'Internal handling', amount: '12.00' },
  ]
  record.additionalChargesUpdatedAt = new Date().toISOString()
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
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const appearance = page.getByRole('dialog', { name: 'Settings', exact: true })
  for (const mode of ['Light', 'Dark'])
    await appearance
      .getByLabel(`${mode} palette`, { exact: true })
      .selectOption('classic-brown')
  await appearance
    .getByRole('button', { name: 'Save settings', exact: true })
    .click()
  await expect(appearance).not.toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--excel-accent')
          .trim()
      )
    )
    .toBe('#5c3700')
  await page.locator('#select-rows').click()
  await assignSelectedPurchaseCodes(page)
  for (let index = 0; index < 3; index++) {
    const editor = await editOrderProduct(page, index, {
      'Spanish name': `SYNTHETIC ${index + 1}`,
      'Chinese category': '合成品',
    })
    await closeOrderProduct(editor)
  }
  const containerId = await loadedSourceContainer(extension, [
    {
      accountId: record.accountId || record.snapshot.accountId || 'local',
      orderId: record.snapshot.orderId,
    },
  ])
  await page.goto(
    `${extension.extensionBaseUrl}/library.html#workspace=packing&containerId=${containerId}&view=packing-list`
  )
  const view = page.locator('#packing-view')
  await expect(view).toBeVisible()
  await view
    .locator('tr[data-container-row] input[type="checkbox"]')
    .first()
    .check()
  await view.locator('[data-action="export-packing-list"]').click()
  const dialog = page.locator('.packing-export-dialog')
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole('checkbox', {
      name: 'Include detailed automation JSON',
      exact: true,
    })
  ).not.toBeChecked()
  await expect(dialog).toContainText('regardless of Excel columns')
  await expect(
    dialog.locator('.packing-export-preview .packing-export-headings th')
  ).toHaveCount(13)
  await expect(dialog.locator('input[value="cartonMark"]')).toBeChecked()
  await expect(dialog.locator('input[value="store"]')).toHaveCount(0)
  await expect(dialog.locator('input[value="orderQuantity"]')).toHaveCount(0)
  await expect(dialog.locator('.packing-export-preview thead tr')).toHaveCount(
    1
  )
  await expect(dialog.locator('.packing-export-preview table')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)'
  )
  for (const [size, pixels] of [
    ['compact', 64],
    ['standard', 120],
    ['large', 160],
  ]) {
    await dialog
      .locator(`[data-option="photoSize"][data-value="${size}"]`)
      .click()
    const cells = dialog.locator(
      '.packing-export-preview td[data-column="photo"]'
    )
    await expect(cells).toHaveCount(3)
    await expect
      .poll(() =>
        cells
          .locator('img')
          .evaluateAll((images) =>
            images.every((image) => image.complete && image.naturalWidth > 0)
          )
      )
      .toBe(true)
    for (const cell of await cells.all()) {
      const photo = await cell.locator('img').boundingBox()
      const bounds = await cell.boundingBox()
      expect(Math.abs(bounds.width - bounds.height)).toBeLessThanOrEqual(1)
      expect(Math.abs(bounds.width - pixels)).toBeLessThanOrEqual(1)
      expect(Math.abs(photo.width - bounds.width)).toBeLessThanOrEqual(1)
      expect(Math.abs(photo.height - bounds.height)).toBeLessThanOrEqual(1)
      expect(Math.abs(photo.x - bounds.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(photo.y - bounds.y)).toBeLessThanOrEqual(1)
    }
  }
  await dialog
    .locator('[data-option="photoSize"][data-value="standard"]')
    .click()
  await dialog.screenshot({ path: 'work/packing-export-redesign.png' })
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
    'cartonReferences',
    'effectiveAmount',
  ])
    await dialog.locator(`input[value="${key}"]`).check()
  const quantityLeft = dialog.locator(
    '[data-column="quantity"] [data-offset="-1"]'
  )
  await quantityLeft.click()
  await quantityLeft.click()
  await expect(
    dialog
      .locator('.packing-export-preview .packing-export-headings th')
      .first()
  ).toHaveText('Qty')
  await dialog.getByRole('radio', { name: 'Cartons', exact: true }).check()
  await expect(
    dialog.locator('.packing-export-preview .packing-export-headings th')
  ).toHaveCount(16)
  await dialog
    .getByRole('button', { name: 'Clear columns', exact: true })
    .click()
  for (const key of ['batch', 'count', 'loaded', 'totalVolume'])
    await dialog.locator(`input[value="${key}"]`).check()
  await expect(
    dialog.locator('.packing-export-preview .packing-export-headings th')
  ).toHaveCount(4)
  await dialog.getByRole('radio', { name: 'Packing list', exact: true }).check()
  await expect(dialog.locator('[data-option="scope"]')).toHaveCount(0)
  await dialog
    .locator('[data-option="photoSize"][data-value="compact"]')
    .click()
  await dialog.getByLabel('Totals row', { exact: true }).uncheck()
  await dialog.getByLabel('Freeze headers', { exact: true }).uncheck()
  await dialog.getByLabel('Column filters', { exact: true }).uncheck()
  await expect(
    dialog.locator('.packing-export-footer [role="status"]')
  ).toHaveText('Products: 3 · Columns: 5')
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
  await expect(
    dialog.locator('.packing-export-preview .packing-export-headings th')
  ).toHaveCount(5)
  await expect(
    dialog
      .locator('.packing-export-preview .packing-export-headings th')
      .first()
  ).toHaveText('Qty')
  await expect(dialog.locator('[data-option="scope"]')).toHaveCount(0)
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
  await dialog.locator('[data-language="zh"]').click()
  await expect(dialog.locator('.packing-export-headings th').nth(1)).toHaveText(
    '标签货号'
  )
  expect(await page.evaluate(() => document.documentElement.lang)).toBe(
    workspaceLanguage
  )
  await dialog.locator('[data-language="en"]').click()
  const theme = await page.evaluate(() => ({
    accent: getComputedStyle(document.documentElement)
      .getPropertyValue('--excel-accent')
      .trim()
      .slice(1)
      .toUpperCase(),
    body: 'FFFFFF',
  }))
  await dialog
    .getByRole('checkbox', {
      name: 'Include detailed automation JSON',
      exact: true,
    })
    .check()
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
  expect(workbook.SheetNames).toEqual(['Packing list', 'Cartons', 'Se quedó'])
  const productRows = XLSX.utils.sheet_to_json(sheet, { header: 1 }),
    headerIndex = productRows.findIndex(
      (row) => row.includes('Qty') && row.includes('Code')
    )
  expect(headerIndex).toBeGreaterThanOrEqual(0)
  expect(productRows[headerIndex]).toEqual([
    'Qty',
    'Code',
    'Details',
    'Cartons',
    'Subtotal 元',
  ])
  const archive = XLSX.CFB.read(bytes, { type: 'buffer' })
  const xml = (name) =>
    Buffer.from(
      archive.FileIndex[
        archive.FullPaths.findIndex((path) => path.endsWith(name))
      ].content
    ).toString('utf8')
  expect(xml('/xl/styles.xml')).toContain(theme.accent)
  expect(theme.accent).toBe('5C3700')
  expect(xml('/xl/styles.xml')).toContain('EFEBE6')
  expect(xml('/xl/styles.xml')).toContain('DED7CC')
  expect(xml('/xl/styles.xml')).toContain(theme.body)
  const descriptionIndex = productRows.findIndex(
    (row) =>
      row[2] === record.snapshot.items[0].description &&
      String(row[0]) === record.snapshot.items[0].quantity
  )
  expect(descriptionIndex).toBeGreaterThan(headerIndex)
  expect(productRows[descriptionIndex - 1][0]).toContain(
    record.snapshot.orderId
  )
  const descriptionStyle = Number(
    xml('/xl/worksheets/sheet1.xml').match(
      new RegExp(`<c r="C${descriptionIndex + 1}" s="(\\d+)"`)
    )[1]
  )
  const cellStyles = xml('/xl/styles.xml')
    .match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1]
    .match(/<xf\b[^>]*>/g)
  const fontId = Number(cellStyles[descriptionStyle].match(/fontId="(\d+)"/)[1])
  const fonts = [...xml('/xl/styles.xml').matchAll(/<font>([\s\S]*?)<\/font>/g)]
  expect(fonts[fontId][1]).toContain('<sz val="10"')
  const headerStyle = Number(
    xml('/xl/worksheets/sheet1.xml').match(
      new RegExp(`<c r="A${headerIndex + 1}" s="(\\d+)"`)
    )[1]
  )
  const headerFont = Number(cellStyles[headerStyle].match(/fontId="(\d+)"/)[1])
  const headerFill = Number(cellStyles[headerStyle].match(/fillId="(\d+)"/)[1])
  const fills = [...xml('/xl/styles.xml').matchAll(/<fill>([\s\S]*?)<\/fill>/g)]
  expect(fonts[headerFont][1]).toContain('FFFFFFFF')
  expect(fills[headerFill][1]).toContain('FF5C3700')
  expect(xml('/xl/worksheets/sheet1.xml')).not.toContain('<pane ')
  expect(xml('/xl/worksheets/sheet1.xml')).not.toContain('<autoFilter ')
  expect(xml('/xl/worksheets/sheet1.xml')).not.toContain('#REF!')
  const summary = JSON.parse(await readFile(summaryFile.filename, 'utf8'))
  expect(summary.products).toHaveLength(3)
  expect(summary.scope).toBe('container-revision')
  expect(summary.containerId).toBe(containerId)
  expect(summary.revisionId).toBeNull()
  expect(summary.draft).toBe(true)
  expect(Number.isSafeInteger(summary.revision)).toBe(true)
  expect(summary.revision).toBeGreaterThan(0)
  const actualDraft = await extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerView({ id }),
    containerId
  )
  expect(summary.revision).toBe(actualDraft.container.revision)
  expect(summary.sealedAt).toBeNull()
  expect(summary.products[0]).toHaveProperty('sourceUnitPrice')
  expect(
    summary.products.flatMap((row) => row.additionalChargeReasons || [])
  ).toContain('Internal handling')
  await page.reload()
  await page.locator('#view-packing').click()
  await page.locator('[data-action="export-packing-list"]').click()
  await expect(
    dialog.getByRole('checkbox', {
      name: 'Include detailed automation JSON',
      exact: true,
    })
  ).not.toBeChecked()
  await expect(
    dialog.locator('.packing-export-preview .packing-export-headings th')
  ).toHaveCount(5)
  await dialog
    .getByRole('button', { name: 'Restore default columns', exact: true })
    .click()
  await expect(
    dialog.locator('.packing-export-preview .packing-export-headings th')
  ).toHaveCount(13)
  await dialog.getByRole('radio', { name: 'Cartons', exact: true }).check()
  await expect(
    dialog.locator('.packing-export-preview .packing-export-headings th')
  ).toHaveCount(4)
  await dialog
    .getByRole('button', { name: 'Restore default columns', exact: true })
    .click()
  await expect(
    dialog.locator('.packing-export-preview .packing-export-headings th')
  ).toHaveCount(16)
  await dialog.getByRole('radio', { name: 'Packing list', exact: true }).check()
  await expect(dialog.locator('[data-option="scope"]')).toHaveCount(0)
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
  // A narrow Excel export does not silently write the detailed companion file.
  await dialog
    .getByRole('checkbox', {
      name: 'Include detailed automation JSON',
      exact: true,
    })
    .uncheck()
  await dialog
    .getByRole('button', { name: 'Clear columns', exact: true })
    .click()
  await dialog.locator('input[value="spanishName"]').check()
  await dialog.locator('input[value="quantity"]').check()
  await download.click()
  await expect(dialog).toHaveCount(0)
  await expect
    .poll(async () => {
      files = await extension.inspector.evaluate(() =>
        chrome.downloads.search({})
      )
      return files.filter((file) => file.state === 'complete').length
    })
    .toBe(3)
  expect(files.filter((file) => file.filename.endsWith('.json'))).toHaveLength(
    1
  )
  const narrowFile = files
    .filter((file) => file.filename.endsWith('.xlsx'))
    .sort((a, b) => b.id - a.id)[0]
  const narrowBook = XLSX.read(await readFile(narrowFile.filename), {
    type: 'buffer',
  })
  expect(
    XLSX.utils
      .sheet_to_json(narrowBook.Sheets['Packing list'], { header: 1 })
      .find((row) => row.includes('Product') && row.includes('Qty'))
  ).toEqual(['Product', 'Qty'])
  await page.close()
})
