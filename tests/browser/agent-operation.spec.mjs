import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import * as XLSX from 'xlsx'
import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

// An automation agent drives the workspace through stable data-action names
// only (docs/automation.md). Synthetic orders, temporary profile.
async function open(extension) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  for (const [index, record] of records.entries())
    record.snapshot.sellerMemberLogin = `synthetic-agent-store-${index}`
  // A saved composition may have no cached composed thumbnail, e.g. after restore.
  records.find(
    (record) => record.snapshot.orderId === '900000000000000003'
  ).snapshot.items[0].photoEdits = {
    0: {
      tagScale: 2.75,
      tags: [
        {
          id: 'synthetic-tag',
          code: 'AX',
          x: 0.5,
          y: 0.5,
          labelX: 0.8,
          labelY: 0.15,
        },
      ],
    },
  }
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
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#order-count')).toHaveText('3')
  return page
}

async function downloads(extension, count) {
  await expect
    .poll(
      async () =>
        (
          await extension.inspector.evaluate(() => chrome.downloads.search({}))
        ).filter((file) => file.state === 'complete').length
    )
    .toBe(count)
  return extension.inspector.evaluate(() =>
    chrome.downloads.search({ orderBy: ['startTime'] })
  )
}
const action = (page, name) => page.locator(`[data-action="${name}"]:visible`)
const status = (page) => page.locator('#workspace-status')

test('an agent prepares, exports and prints through stable data-action controls', async ({
  extension,
}, testInfo) => {
  const page = await open(extension)
  await expect(status(page)).toHaveAttribute('data-status', 'idle')
  // Older months start collapsed; the current month's two orders are listed.
  await expect(page.locator('[data-action="choose-order"]')).toHaveCount(2)
  // Choose one order, select its products and prepare them.
  await page.locator('#packing-month').fill('2026-10')
  await page.locator('#packing-month').blur()
  // Choose an order by focusing its card and pressing Space (the card's
  // links and copy buttons are separate controls).
  const card = page.locator(
    '[data-action="choose-order"][data-order-id="900000000000000003"]'
  )
  await card.focus()
  await card.press(' ')
  await expect(card).toHaveAttribute('aria-selected', 'true')
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(3)
  await action(page, 'select-all-rows').click()
  await expect(
    page.locator('#sheet-body tr[aria-selected="true"]')
  ).toHaveCount(3)
  await action(page, 'prepare-packing-list').click()
  await expect(page.locator('[data-action="review-cancel"]')).toBeVisible()
  await expect(page.locator('[data-action="review-assign-only"]')).toBeVisible()
  await page.locator('[data-action="review-proceed"]').click()
  await expect(page.locator('#packing-view')).toBeVisible()
  await expect(page.locator('#view-packing')).toHaveAttribute(
    'aria-current',
    'page'
  )
  // Labels need names and categories; synthetic products may lack them.
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

  for (const name of [
    'clear-selection',
    'open-grouping-menu',
    'open-print-menu',
  ])
    await expect(action(page, name)).toHaveCount(1)
  // Physical carton totals belong to the batch, not the product rows.
  await page.locator('.packing-group-cartons-edit').first().click()
  const cartonsDialog = page.getByRole('dialog', {
      name: 'Carton batches',
      exact: true,
    }),
    cartonCount = cartonsDialog.locator('input[name="count"]')
  await cartonsDialog
    .getByRole('button', { name: 'Batch', exact: true })
    .click()
  await cartonCount.fill('1.5')
  await cartonsDialog
    .getByRole('button', { name: 'Apply carton contents', exact: true })
    .click()
  await expect(cartonCount).toHaveAttribute('aria-invalid', 'true')
  await cartonCount.fill('6')
  await expect(cartonCount).not.toHaveAttribute('aria-invalid')
  await expect(
    cartonsDialog.locator('input[name="cbm"], input[name="suppliedCbm"]')
  ).toHaveCount(0)
  for (const key of ['len', 'wid', 'ht'])
    await cartonsDialog.locator(`input[name="${key}"]`).fill('50')
  await cartonsDialog.locator('input[name="weight"]').fill('9.5')
  await cartonsDialog
    .getByRole('button', { name: 'Apply carton contents', exact: true })
    .click()
  await expect(cartonsDialog.locator('.carton-batch-status')).toHaveText(
    'Saved'
  )
  await expect(cartonsDialog.locator('.carton-batch-summary')).toContainText(
    '0.125 m³'
  )
  await cartonsDialog.getByLabel('Received boxes', { exact: true }).fill('6')
  await cartonsDialog.getByLabel('Loaded boxes', { exact: true }).fill('0')
  // Closing flushes confirmations even while their quiet autosave timer is pending.
  await cartonsDialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(cartonsDialog).toHaveCount(0)
  // Export the whole packing list: .xlsx plus its JSON summary.
  await action(page, 'export-packing-list').click()
  await page
    .getByLabel('Include detailed automation JSON', { exact: true })
    .check()
  await page.locator('[data-action="download-packing-list"]').click()
  let files = await downloads(extension, 2)
  const xlsx = files.find((file) => file.filename.endsWith('.xlsx'))
  const summaryFile = files.find((file) => file.filename.endsWith('.json'))
  expect(xlsx.filename).toMatch(
    /packing-list-\d{4}-\d{2}-\d{2}-\d{6}-[^/]+\.xlsx$/
  )
  expect(summaryFile.filename).toBe(xlsx.filename.replace(/\.xlsx$/, '.json'))
  const workbook = await readFile(xlsx.filename)
  await writeFile(
    testInfo.outputPath('packing-workbook-synthetic.xlsx'),
    workbook
  )
  expect(workbook.subarray(0, 2).toString('latin1')).toBe('PK')
  expect(workbook.toString('latin1')).toContain('xl/worksheets/sheet1.xml')
  expect(workbook.toString('latin1')).toContain('xl/drawings/drawing1.xml')
  expect(workbook.toString('latin1')).toContain('xl/media/')
  const archive = XLSX.CFB.read(workbook, { type: 'buffer' })
  const drawing = Buffer.from(
    archive.FileIndex[
      archive.FullPaths.findIndex((path) =>
        path.endsWith('/xl/drawings/drawing1.xml')
      )
    ].content
  ).toString('utf8')
  expect(drawing).toContain('name="mark-')
  const photoIndex = archive.FullPaths.findIndex((path) =>
    path.endsWith('.jpg')
  )
  const raster = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })
    )
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let black = 0
    for (let index = 0; index < pixels.length; index += 4)
      if (
        pixels[index] < 40 &&
        pixels[index + 1] < 40 &&
        pixels[index + 2] < 40
      )
        black++
    const dimensions = [bitmap.width, bitmap.height]
    bitmap.close()
    return { black, dimensions }
  }, Array.from(archive.FileIndex[photoIndex].content))
  expect(raster.black).toBeGreaterThan(500)
  expect(raster.dimensions).toEqual([240, 240])
  const summary = JSON.parse(await readFile(summaryFile.filename, 'utf8'))
  expect(summary).toMatchObject({
    format: '1688-export-summary',
    kind: 'packing-list',
    totals: { orders: 1, products: 3 },
  })
  expect(summary.files).toEqual([
    basename(xlsx.filename),
    basename(summaryFile.filename),
  ])
  expect(summary.products[0]).toMatchObject({
    packingMonth: '2026-10',
  })
  expect(summary.cartonBatches).toHaveLength(1)
  expect(summary.cartonBatches[0]).toMatchObject({
    count: 6,
    received: 6,
    loaded: 0,
    weightBasis: 'carton',
    weight: '9.5',
    len: '50',
    wid: '50',
    ht: '50',
    volumePerCarton: '0.125',
    totalWeight: '57',
    totalVolume: '0.75',
    loadedWeight: '0',
    loadedVolume: '0',
    month: '2026-10',
    includedInTotals: true,
  })
  for (const product of summary.products)
    for (const field of [
      'receivedBoxes',
      'loadedBoxes',
      'cartonWeight',
      'cartonVolume',
    ])
      expect(product).not.toHaveProperty(field)
  const exportedWorkbook = XLSX.read(workbook, { type: 'buffer' }),
    table = XLSX.utils.sheet_to_json(exportedWorkbook.Sheets.Products, {
      header: 1,
      defval: '',
    }),
    cartonTable = XLSX.utils.sheet_to_json(exportedWorkbook.Sheets.Cartons, {
      header: 1,
      defval: '',
    })
  expect(exportedWorkbook.SheetNames).toEqual(['Products', 'Cartons'])
  expect(table[4]).not.toContain('Loaded boxes')
  expect(table[4].join(' ')).not.toMatch(/Payments|Deposits|Balance/)
  const headings = table[4]
  const exported = table.find(
    (row) => row[headings.indexOf('Code')] === summary.products[0].code
  )
  expect(headings).not.toContain('Store')
  expect(headings[headings.indexOf('Code') + 1]).toBe('Carton mark')
  expect(exported[headings.indexOf('Cartons')]).toContain('C001')
  const cartonHeadings = cartonTable[4],
    exportedCartons = cartonTable.find((row) => row[0] === 'C001')
  expect(exportedCartons[cartonHeadings.indexOf('Loaded')]).toBe(0)
  expect(exportedCartons[cartonHeadings.indexOf('Received')]).toBe(6)
  expect(exportedCartons[cartonHeadings.indexOf('Loaded kg')]).toBe(0)
  expect(exportedCartons[cartonHeadings.indexOf('Loaded m³')]).toBe(0)
  expect(
    await page
      .locator('.packing-order-sections')
      .evaluate((node) => node.scrollWidth - node.clientWidth)
  ).toBeLessThanOrEqual(1)
  await page.screenshot({ path: 'work/packing-export-workspace.png' })
  expect(summary.orders).toEqual([
    { orderId: '900000000000000003', seller: expect.any(String) },
  ])
  await expect(status(page)).toHaveAttribute('data-status', 'export-finished')
  await expect(status(page)).toContainText(summary.files[0])

  // Print labels and carton marks, each with a summary.
  await action(page, 'select-all-rows').click()
  await action(page, 'open-print-menu').click()
  await action(page, 'print-labels').click()
  await expect(page.locator('[data-action="print-calibration"]')).toBeVisible()
  await page.locator('[data-action="export-pdf"]').click()
  files = await downloads(extension, 4)
  const labelPdf = files.find((file) =>
    /CE-labels-.*\.pdf$/.test(file.filename)
  )
  const labelSummary = JSON.parse(
    await readFile(labelPdf.filename.replace(/\.pdf$/, '.json'), 'utf8')
  )
  expect(labelSummary).toMatchObject({ kind: 'labels', perPage: 70 })
  // Requested labels fill whole pages; spares are shared on the last page.
  expect(labelSummary.pages).toBe(Math.ceil(labelSummary.totals.requested / 70))
  expect(labelSummary.totals.printed).toBe(labelSummary.pages * 70)
  await expect(status(page)).toContainText(labelSummary.files[0])
  // The summary names the source orders of every product.
  expect(labelSummary.orders).toEqual([
    { orderId: '900000000000000003', seller: expect.any(String) },
  ])
  expect(
    labelSummary.products.every(
      (product) => product.orders.join() === '900000000000000003'
    )
  ).toBe(true)
  // Exporting again saves a new pair under the names the summary and status
  // announce; the browser never renames it behind their back.
  const base = (file) => basename(file.filename)
  await page.waitForTimeout(1100)
  await page.locator('[data-action="export-pdf"]').click()
  files = await downloads(extension, 6)
  const repeatSummaryFile = files
    .slice(4)
    .find((file) => file.filename.endsWith('.json'))
  const repeatSummary = JSON.parse(
    await readFile(repeatSummaryFile.filename, 'utf8')
  )
  expect(repeatSummary.files).toEqual(files.slice(4).map(base))
  expect(repeatSummary.files[0]).not.toBe(labelSummary.files[0])
  await expect(status(page)).toHaveAttribute(
    'data-files',
    JSON.stringify(repeatSummary.files)
  )
  // A failed attempt after a success reports that nothing was saved.
  await page.evaluate(() => {
    window.exportSettled = new Promise((resolve) =>
      document.addEventListener(
        'print-export-settled',
        (event) => resolve(event.detail),
        { once: true }
      )
    )
    window.RealCompressionStream = CompressionStream
    window.CompressionStream = class {
      constructor() {
        throw new Error('Synthetic encoder failure')
      }
    }
  })
  await page.locator('[data-action="export-pdf"]').click()
  expect(await page.evaluate(() => window.exportSettled)).toEqual({
    saved: false,
  })
  await page.evaluate(() => {
    window.CompressionStream = window.RealCompressionStream
  })
  await page.locator('[data-action="close-print-dialog"]').click()
  await action(page, 'open-print-menu').click()
  await action(page, 'print-carton-marks').click()
  await page.locator('[data-action="export-pdf"]').click()
  files = await downloads(extension, 8)
  const markPdf = files.find((file) =>
    /CE-carton-marks-.*\.pdf$/.test(file.filename)
  )
  const markSummary = JSON.parse(
    await readFile(markPdf.filename.replace(/\.pdf$/, '.json'), 'utf8')
  )
  expect(markSummary).toMatchObject({ kind: 'carton-marks', perPage: 2 })
  expect(markSummary.orders.map((entry) => entry.orderId)).toEqual([
    '900000000000000003',
  ])
  await page.locator('[data-action="close-print-dialog"]').click()
  // The other documented controls are present and need no hover or drag.
  for (const name of [
    'view-orders',
    'view-packing',
    'open-activity',
    'print-recent',
    'packing-month',
    'restore-packing',
  ])
    await expect(page.locator(`[data-action="${name}"]`).first()).toBeAttached()
  await action(page, 'view-orders').click()
  await expect(page.locator('#orders-view')).toBeVisible()
  expect(extension.unexpectedRequests).toEqual([])
})
