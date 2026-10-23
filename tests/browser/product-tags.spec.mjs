import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  assignSelectedPurchaseCodes,
  shareOrderBarcode,
} from './smart-workspace-helpers.mjs'

async function openWorkspace(extension, { sharedProduct = false } = {}) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-product-tags'
  if (sharedProduct) {
    record.snapshot.sellerMemberLogin = 'synthetic-product-tags'
    record.snapshot.sellerShopOrigin = 'https://synthetic-product-tags.1688.com'
    for (const [index, item] of record.snapshot.items.slice(0, 2).entries()) {
      item.title = '合成玻璃罐'
      item.productNumber = 'TAG-GLASS'
      item.skuProperties = [{ label: '颜色', value: ['透明', '灰色'][index] }]
      item.description = `${item.title}\n颜色：${item.skuProperties[0].value}\n货号：TAG-GLASS`
    }
  }
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
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  return { page, record }
}

const productDetails = (page) =>
  page.getByRole('dialog', {
    name: 'Original product details',
    exact: true,
  })

async function failTagWrites(page) {
  await page.evaluate(() => {
    window.failProductTagWrite = true
    window.failedProductTagWrites = 0
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (
        window.failProductTagWrite &&
        this.name === 'orders' &&
        args[0]?.productTags
      ) {
        window.failedProductTagWrites++
        throw new DOMException(
          'Synthetic product tag storage unavailable',
          'QuotaExceededError'
        )
      }
      return put.apply(this, args)
    }
  })
}

async function holdTagWrites(page) {
  await page.evaluate(() => {
    window.holdProductTagSave = true
    window.productTagSaveStarted = false
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const result = put.apply(this, args)
      if (
        this.name === 'orders' &&
        args[0]?.productTags &&
        window.holdProductTagSave
      ) {
        window.productTagSaveStarted = true
        const keepAlive = () => {
          if (!window.holdProductTagSave) return
          const request = this.get([
            args[0].snapshot.accountId,
            args[0].snapshot.orderId,
          ])
          request.onsuccess = keepAlive
        }
        keepAlive()
      }
      return result
    }
  })
}

async function openSharedProductDetails(extension) {
  const { page, record } = await openWorkspace(extension, {
    sharedProduct: true,
  })
  const products = page.locator('#sheet-body tr[data-selection-key]')
  await products.nth(0).getByRole('checkbox').check()
  await products.nth(1).getByRole('checkbox').check()
  await assignSelectedPurchaseCodes(page)
  await shareOrderBarcode(page)
  const view = page.locator('#orders-view')
  await products.nth(0).focus()
  await products.nth(0).press('Enter')
  return { page, record, products, view, details: productDetails(page) }
}

test('product tags autosave, filter products and stay out of packing', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  const other = await extension.context.newPage()
  await other.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(other.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  const first = page.locator('#sheet-body tr[data-selection-key]').first()
  await expect(
    page.locator('.product-tag-edit, .product-row-tags')
  ).toHaveCount(0)
  await first.locator('.product-title').dblclick()
  const dialog = productDetails(page)
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await dialog
    .getByRole('combobox', { name: 'Product tags', exact: true })
    .fill('Fragile display')
  await dialog
    .getByRole('combobox', { name: 'Product tags', exact: true })
    .press('Enter')
  await expect(dialog.locator('.order-tag-selected')).toContainText(
    'Fragile display'
  )
  await dialog
    .getByRole('button', { name: 'Close product details', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  await expect(first.locator('.product-row-tags')).toContainText(
    'Fragile display'
  )
  await expect(first.locator('.product-row-tags button')).toHaveCount(0)
  await expect(
    other
      .locator('#sheet-body tr[data-selection-key]')
      .first()
      .locator('.product-row-tags')
  ).toContainText('Fragile display')
  await other.close()
  // Inspecting source details preserves the explicit checkbox selection.
  await expect(first).toHaveAttribute('aria-selected', 'false')
  await page.reload()
  await expect(first.locator('.product-row-tags')).toContainText(
    'Fragile display'
  )
  await page.locator('#search').fill('Fragile display')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    1
  )
  await first.getByRole('checkbox').check()
  await assignSelectedPurchaseCodes(page)
  await page.locator('#view-packing').click()
  await expect(page.locator('#packing-view')).toBeVisible()
  await expect(page.locator('#packing-view .product-row-tags')).toHaveCount(0)
  await expect(page.locator('#packing-view')).not.toContainText(
    'Fragile display'
  )
  expect(extension.unexpectedRequests).toEqual([])
})

test('typed product tag saves on close and removing its last assignment removes its catalog entry', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  const first = page.locator('#sheet-body tr[data-selection-key]').first()
  await first.locator('.product-title').dblclick()
  const dialog = productDetails(page)
  await dialog
    .getByRole('combobox', { name: 'Product tags', exact: true })
    .fill('One use')
  expect(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
  ).toBe(true)
  await dialog
    .getByRole('button', { name: 'Close product details', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  await expect(first.locator('.product-row-tags')).toContainText('One use')
  await first.locator('.product-title').dblclick()
  await dialog
    .getByRole('button', { name: 'Remove tag One use', exact: true })
    .click()
  await dialog
    .getByRole('button', { name: 'Close product details', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  const backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(backup.ok, backup.error).toBe(true)
  expect(
    (backup.data.packingPreferences.productTags || []).some(
      (tag) => tag.name === 'One use'
    )
  ).toBe(false)
  expect(backup.data.orders[0].productTags || {}).toEqual({})
  await expect(first.locator('.product-row-tags')).toHaveCount(0)
  expect(extension.unexpectedRequests).toEqual([])
})

test('failed product-tag autosave keeps the original-details popup and draft open until retry succeeds', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  const first = page.locator('#sheet-body tr[data-selection-key]').first()
  await first.focus()
  await first.press('Enter')
  const details = productDetails(page)
  await failTagWrites(page)
  await details
    .getByRole('combobox', { name: 'Product tags', exact: true })
    .fill('Retained draft')
  await details
    .getByRole('button', { name: 'Close product details', exact: true })
    .click()
  await expect(details.locator('.product-details-tags')).toHaveAttribute(
    'data-save-state',
    'error'
  )
  await expect(details).toBeVisible()
  await expect(details.locator('.order-tag-selected')).toContainText(
    'Retained draft'
  )
  await expect(details.locator('.annotation-state')).toContainText(
    'Synthetic product tag storage unavailable'
  )
  await expect(
    details.getByRole('button', { name: 'Retry save', exact: true })
  ).toBeFocused()
  await expect(
    details.getByRole('combobox', { name: 'Product tags', exact: true })
  ).toBeEditable()
  await expect(details.locator('.product-original-description pre')).toHaveText(
    record.snapshot.items[0].description
  )
  await page.keyboard.press('Escape')
  // Visibility is not a completion barrier: dismissal keeps the dialog open
  // while saving. Keep storage unavailable until that retry has failed too.
  await expect
    .poll(() => page.evaluate(() => window.failedProductTagWrites))
    .toBe(2)
  await expect(
    details.getByRole('button', { name: 'Retry save', exact: true })
  ).toBeFocused()
  await expect(details).toBeVisible()
  await details
    .getByRole('button', { name: 'Order details', exact: true })
    .click()
  await expect
    .poll(() => page.evaluate(() => window.failedProductTagWrites))
    .toBe(3)
  await expect(
    details.getByRole('button', { name: 'Retry save', exact: true })
  ).toBeFocused()
  await expect(details).toBeVisible()
  await expect(page.locator('#order-details')).not.toBeVisible()
  await page.evaluate(() => {
    window.failProductTagWrite = false
  })
  await details.getByRole('button', { name: 'Retry save', exact: true }).click()
  await expect(details.locator('.product-details-tags')).toHaveAttribute(
    'data-save-state',
    'saved'
  )
  await details
    .getByRole('button', { name: 'Close product details', exact: true })
    .click()
  await expect(details).toHaveCount(0)
  await expect(first.locator('.product-row-tags')).toHaveText('Retained draft')
  expect(extension.unexpectedRequests).toEqual([])
})

test('shared packing barcode edits tags per original product and saves typed tags before switching sources', async ({
  extension,
}) => {
  const { page, record, products, view, details } =
    await openSharedProductDetails(extension)
  const [firstSource, secondSource] = record.snapshot.items
  await expect(details).toHaveAttribute(
    'data-product-entry-id',
    firstSource.entryId
  )
  await details
    .getByRole('combobox', { name: 'Product tags', exact: true })
    .fill('First original')
  await failTagWrites(page)
  await details.getByRole('button', { name: /^Original product 2:/ }).click()
  await expect(details.locator('.product-details-tags')).toHaveAttribute(
    'data-save-state',
    'error'
  )
  await expect(details).toHaveAttribute(
    'data-product-entry-id',
    firstSource.entryId
  )
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await page.evaluate(() => {
    window.failProductTagWrite = false
  })
  await details.getByRole('button', { name: /^Original product 2:/ }).click()
  await expect(details).toHaveAttribute(
    'data-product-entry-id',
    secondSource.entryId
  )
  await expect(details.locator('.order-tag-selected')).not.toContainText(
    'First original'
  )
  await details
    .getByRole('combobox', { name: 'Product tags', exact: true })
    .fill('Second original')
  await details
    .getByRole('button', { name: 'Close product details', exact: true })
    .click()
  await expect(details).toHaveCount(0)
  await expect(view.locator('.row-preparation')).toHaveCount(3)
  for (const row of await view.locator('.row-preparation').all()) {
    await expect(row).not.toContainText('First original')
    await expect(row).not.toContainText('Second original')
  }
  const backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(backup.ok, backup.error).toBe(true)
  expect(backup.data.orders[0].productTags).toEqual({
    [firstSource.entryId]: ['First original'],
    [secondSource.entryId]: ['Second original'],
  })
  expect(backup.data.orders[0].snapshot.items).toEqual(record.snapshot.items)
  expect(backup.data.preparations[0].groups[0].variants[0].entryIds).toEqual([
    firstSource.entryId,
    secondSource.entryId,
  ])
  expect(JSON.stringify(backup.data.preparations)).not.toContain(
    'First original'
  )
  await view.page().locator('#view-orders').click()
  await expect(products.nth(0).locator('.product-row-tags')).toHaveText(
    'First original'
  )
  await expect(products.nth(1).locator('.product-row-tags')).toHaveText(
    'Second original'
  )
  await expect(products.nth(2).locator('.product-row-tags')).toHaveCount(0)
  expect(extension.unexpectedRequests).toEqual([])
})

for (const firstAction of ['source', 'order']) {
  test(`product details accept only the first ${firstAction} navigation and block edits while tags save`, async ({
    extension,
  }) => {
    const { page, record, details } = await openSharedProductDetails(extension)
    const input = details.locator('.product-details-tags input'),
      source = details.getByRole('button', { name: /^Original product 2:/ }),
      order = details.getByRole('button', {
        name: 'Order details',
        exact: true,
      })
    await holdTagWrites(page)
    await input.fill('Saved before navigation')
    await (firstAction === 'source' ? source : order).click()
    await expect
      .poll(() => page.evaluate(() => window.productTagSaveStarted))
      .toBe(true)
    await expect(details).toHaveAttribute(
      'data-product-entry-id',
      record.snapshot.items[0].entryId
    )
    // Pointer and keyboard input must not create a new unsaved draft while closing.
    const bounds = await input.boundingBox()
    await page.mouse.click(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2
    )
    await page.keyboard.insertText('Do not discard this')
    await expect(input).toHaveValue('')
    await source.click()
    await source.click()
    await order.click()
    await expect(page.locator('dialog[open]')).toHaveCount(1)
    expect(
      await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(event)
        return event.defaultPrevented
      })
    ).toBe(true)
    await page.evaluate(() => {
      window.holdProductTagSave = false
    })
    if (firstAction === 'source') {
      await expect(details).toHaveAttribute(
        'data-product-entry-id',
        record.snapshot.items[1].entryId
      )
      await expect(page.locator('#order-details')).not.toBeVisible()
      await expect(page.locator('dialog[open]')).toHaveCount(1)
      await input.fill('Second source draft')
      expect(
        await page.evaluate(() => {
          const event = new Event('beforeunload', { cancelable: true })
          window.dispatchEvent(event)
          return event.defaultPrevented
        })
      ).toBe(true)
      await details
        .getByRole('button', { name: 'Close product details', exact: true })
        .click()
      await expect(details).toHaveCount(0)
    } else {
      await expect(details).toHaveCount(0)
      await expect(page.locator('#order-details')).toBeVisible()
      await expect(page.locator('dialog[open]')).toHaveCount(1)
    }
    const backup = await extension.inspector.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
    )
    expect(backup.ok, backup.error).toBe(true)
    expect(backup.data.orders[0].productTags).toEqual({
      [record.snapshot.items[0].entryId]: ['Saved before navigation'],
      ...(firstAction === 'source'
        ? { [record.snapshot.items[1].entryId]: ['Second source draft'] }
        : {}),
    })
    expect(extension.unexpectedRequests).toEqual([])
  })
}
