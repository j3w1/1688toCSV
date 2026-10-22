import { test, expect } from './extension-fixture.mjs'
import { createStoreOrder } from '../../src/store-order.js'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { clickGroupingAction } from './copy-actions-helpers.mjs'

async function spreadsheetPacking(extension, kind) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const descriptions = [
    'TEST-A · 大盘 · 11"',
    'TEST-B · 8.5"',
    `TEST-C · ${'SyntheticDescription'.repeat(12)} · 6.5"`,
  ]
  const now = '2026-10-21T12:00:00.000Z'
  const built = await createStoreOrder(
    {
      filename: kind === 'market' ? '4321.xlsx' : 'Synthetic factory.xlsx',
      sheetName: 'Orders',
      purchaseDate: '2026-10-01',
      total: '30.00',
      store: {
        key: kind === 'market' ? 'market:4321' : 'factory:synthetic factory',
        kind,
        name: 'Synthetic spreadsheet store',
        ...(kind === 'market' ? { number: '4321' } : {}),
      },
      rows: descriptions.map((description, index) => ({
        row: index + 3,
        group: '1',
        // Also cover older records without an explicit title.
        ...(index < 2 ? { title: description } : {}),
        description,
        productNumber: `TEST-${'ABC'[index]}`,
        variants: [{ variant: 'ABC'[index] }],
        boxes: '1',
        perbox: '10',
        quantity: '10',
        price: '1.00',
        amount: '10.00',
        photos: [record.snapshot.items[0].thumbnail],
      })),
    },
    { now, orderId: '9876543210' }
  )
  record.snapshot = built.snapshot
  record.changedAt = now
  record.lastCheckedAt = now
  record.changedEntryIds = []
  record.removedEntryIds = []
  record.unitsPerCarton = built.unitsPerCarton
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    {
      format: '1688-order-library',
      version: 3,
      exportedAt: now,
      orders: [record],
      history: [],
      images: built.images,
      preparations: [],
      allocations: [],
      issuedCodes: [],
    }
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date(now))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const products = page.locator('#sheet-body tr[data-selection-key]')
  await expect(products).toHaveCount(3)
  await products.first().focus()
  await page.keyboard.press('Control+a')
  await page.locator('#prepare-orders').click()
  const packing = page.locator('#packing-view')
  const review = page.getByRole('dialog', { name: 'Assign product codes?' })
  await expect
    .poll(async () => (await packing.isVisible()) || (await review.isVisible()))
    .toBe(true)
  if (await review.isVisible())
    await review
      .getByRole('button', { name: 'Assign codes and prepare' })
      .click()
  await expect(packing).toBeVisible()
  await packing.getByLabel('Spanish short name', { exact: true }).fill('PLATES')
  await packing.getByLabel('Chinese category', { exact: true }).fill('陶瓷')
  await packing.getByLabel('Chinese category', { exact: true }).blur()
  await expect(packing.getByAltText('Carton mark preview')).toBeVisible({
    timeout: 20_000,
  })
  await expect(packing.getByAltText('Barcode preview')).toHaveCount(3, {
    timeout: 20_000,
  })
  for (const button of await packing
    .getByRole('button', { name: 'Edit barcode', exact: true })
    .all()) {
    // Only previews within the packing scroller are rendered.
    await button.scrollIntoViewIfNeeded()
    const preview = button.getByAltText('Barcode preview')
    await expect(preview).toBeVisible({ timeout: 20_000 })
    await expect
      .poll(() => preview.evaluate((image) => image.naturalWidth))
      .toBeGreaterThan(0)
  }
  return { page, packing, descriptions, snapshot: built.snapshot }
}

for (const kind of ['market', 'factory']) {
  test(`${kind} packing products retain every row description through translation and shared barcodes`, async ({
    extension,
  }) => {
    const { page, packing, descriptions, snapshot } = await spreadsheetPacking(
      extension,
      kind
    )
    await expect(packing.locator('.preparation-group')).toHaveCount(1)
    await expect(packing.locator('.original-product-name')).toHaveCount(0)
    const rows = packing.locator('tr[data-variant-id]')
    await expect(rows).toHaveCount(3)
    for (const [index, description] of descriptions.entries()) {
      await expect(rows.nth(index).locator('.product-title')).toHaveText(
        description
      )
      await expect(rows.nth(index)).not.toContainText(
        descriptions[(index + 1) % descriptions.length]
      )
    }
    const layout = await rows.first().evaluate((row) => {
      const code = row
        .querySelector('.variant-code-band')
        .getBoundingClientRect()
      const title = row.querySelector('.product-title').getBoundingClientRect()
      const attributes = row
        .querySelector('.product-attributes')
        .getBoundingClientRect()
      const price = row.querySelector('.variant-price').getBoundingClientRect()
      return {
        descriptionGap: title.top - code.bottom,
        metadataAlignment: Math.abs(attributes.top - price.top),
        height: row.getBoundingClientRect().height,
        geometry: [
          ...row.querySelectorAll(
            'td, .variant-numeric-header, .variant-numeric-row, .carton-capacity-cell, .carton-capacity, .carton-capacity input, .carton-capacity-summary, .carton-recorded-context, .carton-batch-readout'
          ),
        ].map((node) => {
          const rect = node.getBoundingClientRect()
          const style = getComputedStyle(node)
          return {
            element: node.className || node.tagName,
            text: node.textContent,
            width: rect.width,
            height: rect.height,
            font: style.font,
            lineHeight: style.lineHeight,
            padding: style.padding,
            margin: style.margin,
          }
        }),
      }
    })
    expect(layout.descriptionGap).toBeGreaterThanOrEqual(0)
    expect(layout.descriptionGap).toBeLessThanOrEqual(6)
    expect(layout.metadataAlignment).toBeLessThanOrEqual(6)
    expect(layout.height, JSON.stringify(layout)).toBeLessThanOrEqual(100)
    const note = rows.first().locator('.variant-note textarea')
    await note.fill('Ivory finish\nHandle on left')
    await note.blur()
    for (const language of ['es', 'zh', 'en']) {
      await page.locator(`#language-toggle [data-language=${language}]`).click()
      await expect(packing.locator('.product-title')).toHaveText(descriptions)
      await expect(note).toHaveValue('Ivory finish\nHandle on left')
    }
    for (const width of [1280, 760, 390]) {
      await page.setViewportSize({ width, height: 900 })
      for (const title of await packing.locator('.product-title').all()) {
        const geometry = await title.evaluate((node) => ({
          scroll: node.scrollWidth,
          client: node.clientWidth,
          clamp: getComputedStyle(node).webkitLineClamp,
        }))
        expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1)
        expect(geometry.clamp).toBe('none')
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await packing.screenshot({
      path: test.info().outputPath(`${kind}-packing-descriptions.png`),
    })
    await rows.nth(1).focus()
    await rows.nth(1).press('Enter')
    const details = page.getByRole('dialog', {
      name: 'Original product details',
    })
    await expect(
      details.locator('.product-original-description pre')
    ).toHaveText(descriptions[1])
    await details.getByRole('button', { name: 'Close product details' }).click()
    await expect(details).toHaveCount(0)
    await packing
      .getByRole('button', { name: 'Clear selection', exact: true })
      .click()
    await rows.nth(0).focus()
    await page.keyboard.press('Space')
    await rows.nth(1).focus()
    await page.keyboard.press('Control+Space')
    await clickGroupingAction(page, 'Share one barcode')
    const merge = page.getByRole('dialog', { name: 'Share one barcode?' })
    await merge
      .getByRole('button', { name: 'Apply changes', exact: true })
      .click()
    await expect(rows).toHaveCount(2)
    await expect(rows.first().locator('.product-title')).toHaveText(
      descriptions.slice(0, 2)
    )
    const backup = await extension.inspector.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
    )
    expect(backup.ok, backup.error).toBe(true)
    expect(backup.data.orders[0].snapshot).toEqual(snapshot)
  })
}
