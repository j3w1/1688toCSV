import { exportPdf } from './export-completion-helpers.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import * as XLSX from 'xlsx'
import { planContainerWorkbook } from '../../src/container-export.js'
import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  createContainerThroughUI,
  sealContainerThroughUI,
} from './smart-workspace-helpers.mjs'

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
  await extension.inspector.evaluate(async () => {
    window.agentChangeMetadata = Object.create(null)
    const stop = (await window.testRepository).subscribe((change) => {
      const key = JSON.stringify(change.stores)
      window.agentChangeMetadata[key] =
        (window.agentChangeMetadata[key] || 0) + 1
    })
    addEventListener('pagehide', stop, { once: true })
  })
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

test('an agent authors Orders, confirms one physical arrangement, seals a named container and exports/prints through stable actions', async ({
  extension,
}, testInfo) => {
  const page = await open(extension)
  await expect(status(page)).toHaveAttribute('data-status', 'idle')
  // Older months start collapsed; the current month's two orders are listed.
  await expect(page.locator('[data-action="choose-order"]')).toHaveCount(2)
  const before = await extension.inspector.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
    ),
    orderId = '900000000000000003',
    ref = { accountId: 'local', orderId }
  const card = page.locator(
    `[data-action="choose-order"][data-order-id="${orderId}"]`
  )
  try {
    await card.locator('input[type="checkbox"]').check({ timeout: 5000 })
  } catch (error) {
    await testInfo.attach('committed-change-metadata.json', {
      body: JSON.stringify(
        await extension.inspector.evaluate(() => window.agentChangeMetadata),
        null,
        2
      ),
      contentType: 'application/json',
    })
    throw error
  }
  await expect(card).toHaveAttribute('aria-selected', 'true')
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(3)
  await action(page, 'select-all-rows').click()
  await expect(
    page.locator('#sheet-body tr[aria-selected="true"]')
  ).toHaveCount(3)
  await action(page, 'review-purchase-codes').click()
  const codes = page.locator('[data-action="purchase-code-review"]')
  await expect(
    codes.locator('[data-action="assign-purchase-codes"]')
  ).toBeEnabled()
  await codes.locator('[data-action="assign-purchase-codes"]').click()
  await expect(codes).toBeHidden()
  for (let index = 0; index < 3; index++) {
    await rows.nth(index).locator('[data-action="edit-order-product"]').click()
    const editor = page.locator('dialog[data-action="edit-order-product"]')
    await editor
      .locator('[data-authoring-field="spanish-name"]')
      .fill(`PRODUCTO ${index + 1}`)
    await editor
      .locator('[data-authoring-field="chinese-category"]')
      .fill('测试')
    await editor.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(editor).toBeHidden()
  }
  await card.locator('[data-action="open-order-cartons"]').click()
  const grid = page.locator('#orders-cartons-view'),
    capacities = grid.locator('[data-grid-column="capacity"]')
  await capacities.first().fill('1.5')
  await capacities.first().blur()
  await expect(capacities.first()).toHaveAttribute('aria-invalid', 'true')
  await capacities.first().fill('10')
  await capacities.first().blur()
  await expect(capacities.first()).not.toHaveAttribute('aria-invalid')
  await action(page, 'select-grid-rows').click()
  await grid
    .getByRole('textbox', {
      name: 'Paste carton or capacity cells',
      exact: true,
    })
    .fill('10\n24\n80')
  await action(page, 'preview-carton-paste').click()
  await page
    .locator('.grid-paste-preview [data-action="apply-carton-paste"]')
    .click()
  await expect(page.locator('.grid-paste-preview')).toBeHidden()
  await action(page, 'reconciliation-cartons').click()
  await expect(grid.locator('tr[data-grid-key]')).toHaveCount(3)
  for (const [column, value] of [
    ['dimensions', '50×50×50'],
    ['weight', '9.5'],
  ]) {
    const first = grid.locator(`[data-grid-column="${column}"]`).first()
    await first.fill(value)
    await first.blur()
    await action(page, 'select-grid-rows').click()
    await first.focus()
    await action(page, 'fill-grid-range').click()
    await page
      .locator('.grid-paste-preview [data-action="apply-carton-paste"]')
      .click()
    await expect(page.locator('.grid-paste-preview')).toBeHidden()
  }
  await action(page, 'confirm-order-cartons').click()
  await expect
    .poll(async () =>
      (
        await extension.inspector.evaluate(
          async (ref) =>
            (await window.testRepository).getOrderReconciliation(ref),
          ref
        )
      ).batches.reduce((n, batch) => n + batch.count, 0)
    )
    .toBe(6)
  const confirmedPhysicalIds = await extension.inspector.evaluate(
    async (ref) =>
      (await (await window.testRepository).getOrderReconciliation(ref)).batches
        .filter((batch) => !batch.deletedAt)
        .map((batch) => batch.id)
        .sort(),
    ref
  )
  const containerId = await createContainerThroughUI(
    page,
    [ref],
    'Synthetic agent November'
  )
  await sealContainerThroughUI(page)
  const view = page.locator('#packing-view')
  for (const name of [
    'clear-selection',
    'open-print-menu',
    'export-packing-list',
  ])
    await expect(action(page, name)).toHaveCount(1)
  await expect(
    view.locator(
      '[data-action="open-grouping-menu"],[data-action="organize-packing"],[data-grid-column="capacity"]'
    )
  ).toHaveCount(0)
  // Export the whole packing list: .xlsx plus its JSON summary.
  await action(page, 'export-packing-list').click()
  await page
    .getByLabel('Include detailed automation JSON', { exact: true })
    .check()
  const workbookDownload = page.waitForEvent('download', (download) =>
    download.suggestedFilename().endsWith('.xlsx')
  )
  await page.locator('[data-action="download-packing-list"]').click()
  await workbookDownload
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
  if (raster.black <= 500) {
    const evidence = await extension.inspector.evaluate(
        async ({ id, ref }) => {
          const repository = await window.testRepository,
            manifest = await repository.getContainerManifest({ id }),
            source = await repository.getOrderReconciliation(ref)
          return {
            manifest,
            source: {
              items: source.record.snapshot.items,
              productPhotos: source.record.productPhotos,
            },
          }
        },
        { id: containerId, ref }
      ),
      plan = planContainerWorkbook(evidence.manifest),
      snapshot = (row) => ({
        entryId: row.entryId,
        barcode: row.barcode,
        photoEdits: row.photoEdits,
        thumbnail: row.thumbnail?.slice(0, 80),
        photos: row.photos?.map((photo) => photo.slice(0, 80)),
      })
    await testInfo.attach('frozen-image-diagnostics.json', {
      body: JSON.stringify(
        {
          raster,
          firstWorkbookPhotoSource: snapshot(
            plan.products[0].markSource || plan.products[0].source
          ),
          source: {
            ...evidence.source,
            items: evidence.source.items.map(snapshot),
          },
          products: evidence.manifest.products.map(snapshot),
          plan: plan.products.map((product) => ({
            row: product.row,
            source: snapshot(product.source),
            markSource: product.markSource
              ? snapshot(product.markSource)
              : null,
          })),
          photoNames: archive.FullPaths.filter((path) => path.endsWith('.jpg')),
        },
        null,
        2
      ),
      contentType: 'application/json',
    })
  }
  expect(raster.black).toBeGreaterThan(500)
  expect(raster.dimensions).toEqual([240, 240])
  const summary = JSON.parse(await readFile(summaryFile.filename, 'utf8'))
  expect(summary).toMatchObject({
    format: '1688-export-summary',
    kind: 'packing-list',
    version: 3,
    scope: 'container-revision',
    containerId,
  })
  expect(summary.files).toEqual([
    basename(xlsx.filename),
    basename(summaryFile.filename),
  ])
  expect(summary.container.name).toBe('Synthetic agent November')
  expect(summary.container.period || '').toBe('')
  for (const product of summary.products) {
    expect(product.packingMonth).toBe('2026-10')
    expect(product.barcode).toMatch(/^CE2610/)
  }
  expect(summary.products).toHaveLength(3)
  expect(summary.cartonBatches).toHaveLength(3)
  expect(summary.cartonBatches.map((batch) => batch.id).sort()).toEqual(
    confirmedPhysicalIds
  )
  expect(summary.cartonBatches.reduce((n, batch) => n + batch.count, 0)).toBe(6)
  for (const batch of summary.cartonBatches)
    expect(batch).toMatchObject({
      accountId: 'local',
      orderId,
      weightBasis: 'carton',
      weight: '9.5',
      len: '50',
      wid: '50',
      ht: '50',
    })
  for (const batch of summary.cartonBatches) {
    expect(batch.contents.every((part) => part.orderId === orderId)).toBe(true)
    expect(batch).not.toHaveProperty('month')
  }
  expect(summary.cartons).toHaveLength(6)
  expect(summary.cartons.every((carton) => carton.state === 'loaded')).toBe(
    true
  )
  expect(JSON.stringify(summary.totals)).toContain('57')
  expect(JSON.stringify(summary.totals)).toContain('0.75')
  expect(summary.revisionId).toBeTruthy()
  expect(basename(xlsx.filename)).toContain(containerId)
  for (const product of summary.products)
    for (const field of [
      'receivedBoxes',
      'loadedBoxes',
      'cartonWeight',
      'cartonVolume',
    ])
      expect(product).not.toHaveProperty(field)
  const exportedWorkbook = XLSX.read(workbook, { type: 'buffer' }),
    table = XLSX.utils.sheet_to_json(exportedWorkbook.Sheets['Packing list'], {
      header: 1,
      defval: '',
    }),
    cartonTable = XLSX.utils.sheet_to_json(exportedWorkbook.Sheets.Cartons, {
      header: 1,
      defval: '',
    })
  expect(exportedWorkbook.SheetNames).toEqual([
    'Packing list',
    'Cartons',
    'Se quedó',
  ])
  const headings = table.find(
    (row) => row.includes('Code') && row.includes('Cartons')
  )
  expect(headings).not.toContain('Loaded boxes')
  expect(headings.join(' ')).not.toMatch(/Payments|Deposits|Balance/)
  const exported = table.find(
    (row) => row[headings.indexOf('Code')] === summary.products[0].barcode
  )
  expect(headings).not.toContain('Store')
  expect(headings[headings.indexOf('Code') + 1]).toBe('Carton mark')
  expect(String(exported[headings.indexOf('Cartons')])).not.toBe('')
  for (const product of summary.products)
    expect(product.sourceUnitPrice).toBeTruthy()
  expect(
    await view
      .locator('.smart-grid-scroll')
      .evaluate((node) => node.clientWidth)
  ).toBeGreaterThan(0)
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  ).toBeLessThanOrEqual(1)
  await page.screenshot({ path: 'work/packing-export-workspace.png' })
  expect(summary.orders).toHaveLength(1)
  expect(summary.orders[0].orderId).toBe(orderId)
  const after = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(after.data.orders.map((record) => record.snapshot)).toEqual(
    before.data.orders.map((record) => record.snapshot)
  )
  expect(after.data.orders.map((record) => record.productPhotos)).toEqual(
    before.data.orders.map((record) => record.productPhotos)
  )
  await expect(status(page)).toHaveAttribute('data-status', 'export-finished')
  await expect(status(page)).toContainText(summary.files[0])

  // Print labels and carton marks, each with a summary.
  await action(page, 'select-all-rows').click()
  await action(page, 'open-print-menu').click()
  await action(page, 'print-labels').click()
  await page.locator('.print-dialog').waitFor()
  await expect(page.locator('[data-action="print-calibration"]')).toBeVisible()
  expect(
    await exportPdf(page, page.locator('[data-action="export-pdf"]'))
  ).toEqual({ saved: true })
  files = await downloads(extension, 4)
  const labelPdf = files.find((file) =>
    /CE-labels-.*\.pdf$/.test(file.filename)
  )
  const labelSummary = JSON.parse(
    await readFile(labelPdf.filename.replace(/\.pdf$/, '.json'), 'utf8')
  )
  await writeFile(
    testInfo.outputPath('sealed-labels-synthetic.pdf'),
    await readFile(labelPdf.filename)
  )
  await writeFile(
    testInfo.outputPath('sealed-labels-synthetic.json'),
    JSON.stringify(labelSummary, null, 2)
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
  expect(
    await exportPdf(page, page.locator('[data-action="export-pdf"]'))
  ).toEqual({ saved: true })
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
  expect(
    await exportPdf(page, page.locator('[data-action="export-pdf"]'))
  ).toEqual({ saved: true })
  files = await downloads(extension, 8)
  const markPdf = files.find((file) =>
    /CE-carton-marks-.*\.pdf$/.test(file.filename)
  )
  const markSummary = JSON.parse(
    await readFile(markPdf.filename.replace(/\.pdf$/, '.json'), 'utf8')
  )
  await writeFile(
    testInfo.outputPath('sealed-marks-synthetic.pdf'),
    await readFile(markPdf.filename)
  )
  await writeFile(
    testInfo.outputPath('sealed-marks-synthetic.json'),
    JSON.stringify(markSummary, null, 2)
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
    'restore-packing',
  ])
    await expect(page.locator(`[data-action="${name}"]`).first()).toBeAttached()
  for (const name of [
    'packing-month',
    'prepare-packing-list',
    'organize-packing',
  ])
    await expect(page.locator(`[data-action="${name}"]`)).toHaveCount(0)
  await action(page, 'view-orders').click()
  await expect(page.locator('#orders-view')).toBeVisible()
  expect(extension.unexpectedRequests).toEqual([])
})
