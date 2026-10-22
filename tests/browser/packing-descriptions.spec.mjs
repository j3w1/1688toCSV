import { test, expect } from './extension-fixture.mjs'
import { createStoreOrder } from '../../src/store-order.js'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  assignSelectedPurchaseCodes,
  editOrderProduct,
  closeOrderProduct,
  libraryBackup,
  shareOrderBarcode,
} from './smart-workspace-helpers.mjs'

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
  await assignSelectedPurchaseCodes(page)
  for (let index = 0; index < 3; index++) {
    const editor = await editOrderProduct(page, index, {
      'Spanish name': 'PLATES',
      'Chinese category': '陶瓷',
    })
    await closeOrderProduct(editor)
    await products
      .nth(index)
      .getByRole('button', { name: 'Barcode', exact: true })
      .click()
    const label = page.getByRole('dialog', {
        name: 'Label editor',
        exact: true,
      }),
      preview = label.getByAltText('Printable label preview')
    await expect(preview).toBeVisible({ timeout: 20000 })
    await expect
      .poll(() => preview.evaluate((image) => image.naturalWidth))
      .toBeGreaterThan(0)
    await label
      .getByRole('button', { name: 'Close label editor', exact: true })
      .click()
  }
  return {
    page,
    packing: page.locator('#orders-view'),
    descriptions,
    snapshot: built.snapshot,
  }
}

for (const kind of ['market', 'factory']) {
  test(`${kind} Orders retains every source description through translation and shared barcodes`, async ({
    extension,
  }, testInfo) => {
    const { page, packing, descriptions, snapshot } = await spreadsheetPacking(
        extension,
        kind
      ),
      rows = page.locator('#sheet-body tr[data-selection-key]')
    await expect(rows).toHaveCount(3)
    await expect(packing.locator('.original-product-name')).toHaveCount(0)
    for (const [index, description] of descriptions.entries()) {
      await expect(rows.nth(index).locator('.product-title')).toHaveText(
        description
      )
      await expect(rows.nth(index)).not.toContainText(
        descriptions[(index + 1) % descriptions.length]
      )
    }
    const editor = await editOrderProduct(page, 0, {
      'Product variant': 'Ivory finish\nHandle on left',
    })
    await closeOrderProduct(editor)
    for (const language of ['es', 'zh', 'en']) {
      await page.locator(`#language-toggle [data-language=${language}]`).click()
      await expect(rows.locator('.product-title')).toHaveText(descriptions)
    }
    const reopened = await editOrderProduct(page, 0)
    await expect(
      reopened.getByRole('textbox', { name: 'Product variant', exact: true })
    ).toHaveValue('Ivory finish\nHandle on left')
    await closeOrderProduct(reopened)
    for (const width of [1280, 760, 390]) {
      await page.setViewportSize({ width, height: 900 })
      for (const title of await rows.locator('.product-title').all()) {
        const geometry = await title.evaluate((node) => ({
          scroll: node.scrollWidth,
          client: node.clientWidth,
          clamp: getComputedStyle(node).webkitLineClamp,
        }))
        expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1)
        expect(geometry.clamp).toBe('none')
      }
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        )
      ).toBeLessThanOrEqual(1)
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await packing.screenshot({
      path: testInfo.outputPath(`${kind}-orders-descriptions.png`),
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
    await shareOrderBarcode(page)
    // Code sharing never collapses the separate source or financial rows.
    await expect(rows).toHaveCount(3)
    await expect(rows.locator('.product-title')).toHaveText(descriptions)
    const backup = await libraryBackup(extension)
    expect(backup.preparations[0].groups[0].variants[0].entryIds).toEqual(
      snapshot.items.slice(0, 2).map((item) => item.entryId)
    )
    expect(backup.orders[0].snapshot).toEqual(snapshot)
  })
}
