import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

const bootstrapControls = [
  '#packing-settings',
  '#all-orders',
  '#copy-values',
  '#copy-images',
  '#copy-excel',
  '#copy-excel-image',
  '#select-rows',
  '#clear-rows',
  '#refresh-orders',
  '#refresh-all',
  '#remove-orders',
  '#copy-preparation',
  '#copy-group-codes',
  '#review-purchase-codes',
  '#group-order-products',
  '#include-orders',
  '#backup-packing',
  '#view-orders',
  '#view-packing',
  '[data-action="orders-products"]',
  '[data-action="orders-cartons"]',
  '[data-action="orders-backlog"]',
  '#print-recent',
]

for (const populated of [true, false])
  test(`library bootstrap protects each data action until the real ${populated ? 'populated' : 'empty'} read completes`, async ({
    extension,
  }) => {
    const records = populated
      ? await extension.inspector.evaluate(
          `(${createDemoRecords.toString()})(document)`
        )
      : []
    if (populated) {
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
        records[0]
      )
      expect(restored.ok, restored.error).toBe(true)
    }
    const page = await extension.context.newPage()
    await page.addInitScript((selectors) => {
      localStorage.setItem('1688-library-purchase-months', '[]')
      window.bootstrapClicks = []
      window.bootstrapClipboardWrites = 0
      navigator.clipboard.write = navigator.clipboard.writeText = async () => {
        window.bootstrapClipboardWrites++
      }
      document.addEventListener(
        'click',
        (event) => {
          for (const selector of selectors)
            if (event.target.closest?.(selector))
              window.bootstrapClicks.push(selector)
        },
        true
      )
      // Delay delivery of the real readonly account result, not its contents
      // or transaction. This is the same read used by repository.listOrders.
      window.bootstrapReadHeld = false
      window.holdBootstrapReads = true
      const pending = []
      window.releaseBootstrapReads = () => {
        window.holdBootstrapReads = false
        for (const resume of pending.splice(0)) resume()
      }
      const getAll = IDBIndex.prototype.getAll
      const setSuccess = Object.getOwnPropertyDescriptor(
        IDBRequest.prototype,
        'onsuccess'
      ).set
      IDBIndex.prototype.getAll = function (...args) {
        const request = getAll.apply(this, args)
        if (
          this.objectStore.name === 'orders' &&
          this.name === 'account' &&
          this.objectStore.transaction.mode === 'readonly'
        )
          Object.defineProperty(request, 'onsuccess', {
            configurable: true,
            set(handler) {
              setSuccess.call(request, (event) => {
                if (!window.holdBootstrapReads)
                  return handler.call(request, event)
                window.bootstrapReadHeld = true
                pending.push(() => handler.call(request, event))
              })
            },
          })
        return request
      }
    }, bootstrapControls)
    await page.goto(`${extension.extensionBaseUrl}/library.html`)
    await expect
      .poll(() => page.evaluate(() => window.bootstrapReadHeld))
      .toBe(true)
    for (const selector of bootstrapControls)
      await test.step(`${selector} cannot dispatch before the read`, async () => {
        const control = page.locator(selector)
        await expect(control).toBeDisabled()
        // Native HTMLElement.click also honors disabled controls. Verify that
        // an eager automation action cannot run against the initial empty rows.
        await control.evaluate((button) => button.click())
      })
    expect(await page.evaluate(() => window.bootstrapClicks)).toEqual([])
    expect(await page.evaluate(() => window.bootstrapClipboardWrites)).toBe(0)
    expect(
      await extension.inspector.evaluate(() => chrome.downloads.search({}))
    ).toEqual([])
    await page.evaluate(() => window.releaseBootstrapReads())
    // Real click actionability waits for bootstrap; then use the normal route
    // rather than replacing repository reads or asserting an invented ready flag.
    await page.locator('#view-orders').click()
    await expect(page.locator('#order-count')).toHaveText(populated ? '1' : '0')
    await expect(
      page.locator('#sheet-body tr[data-selection-key]')
    ).toHaveCount(populated ? 3 : 0)
    for (const selector of ['#view-orders', '#view-packing', '#print-recent'])
      await expect(page.locator(selector)).toBeEnabled()
    for (const selector of [
      '#copy-values',
      '#copy-images',
      '#copy-excel',
      '#copy-excel-image',
      '#select-rows',
    ]) {
      if (populated) await expect(page.locator(selector)).toBeEnabled()
      else await expect(page.locator(selector)).toBeDisabled()
    }
    await expect(page.locator('#clear-rows')).toBeDisabled()
    if (populated) {
      await page.locator('#select-rows').click()
      await expect(
        page.locator('#sheet-body tr[aria-selected="true"]')
      ).toHaveCount(3)
      await page.locator('#clear-rows').click()
      await expect(
        page.locator('#sheet-body tr[aria-selected="true"]')
      ).toHaveCount(0)
    }
    await page.locator('#orders-print-actions .copy-actions-trigger').click()
    await page.locator('#print-recent').click()
    await expect(page.locator('.print-recent-dialog')).toBeVisible()
    expect(await page.evaluate(() => window.bootstrapClipboardWrites)).toBe(0)
    expect(extension.unexpectedRequests).toEqual([])
  })
