import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function seed(extension, count = 500) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const original = record.snapshot.items[0]
  record.snapshot.items = Array.from({ length: count }, (_, index) => ({
    ...original,
    entryId: String(800000 + index),
    title: `Continuous product ${index + 1}`,
    description: `Continuous product ${index + 1}\n${'Long supplier specifications '.repeat(index % 7)}`,
    quantity: '1',
    price: '10.00',
    sourceDiscount: '0.00',
    allocatedDiscount: '0.00',
    discount: '0.00',
  }))
  record.changedEntryIds = []
  record.snapshot.totals = {
    goodsGross: `${count * 10}.00`,
    goodsNet: `${count * 10}.00`,
    payable: `${count * 10}.00`,
    shipping: '0.00',
    sourceDiscount: '0.00',
    orderAdjustment: '0.00',
  }
  const result = await extension.inspector.evaluate(
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
  expect(result.ok, result.error).toBe(true)
  const page = await extension.context.newPage()
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    100
  )
  return { page, record }
}

test('continuous products retain active decimal drafts across the whole list and save after recycling', async ({
  extension,
}) => {
  const { page, record } = await seed(extension)
  const first = page.locator(
    `#sheet-body [data-selection-key="${record.snapshot.orderId}/800000"]`
  )
  const weight = first.getByRole('textbox', {
    name: 'Weight (kg/box)',
    exact: true,
  })
  await weight.fill('12..')
  await page.locator('.table-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(
    page
      .locator('#sheet-body tr[data-selection-key]')
      .last()
      .locator('.row-number')
  ).toHaveText('500')
  await expect(weight).toBeFocused()
  await expect(weight).toHaveValue('12..')
  expect(
    await page.locator('#sheet-body tr[data-selection-key]').count()
  ).toBeLessThanOrEqual(101)
  await weight.fill('12.5')
  await page.locator('#sheet-title').click()
  await expect
    .poll(async () => {
      const response = await extension.inspector.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
      )
      return response.data.orders[0].cartonDetails?.['800000']?.kg
    })
    .toBe('12.5')
  await page.locator('.table-scroll').evaluate((element) => {
    element.scrollTop = 0
  })
  await expect(weight).toHaveValue('12.5')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    100
  )
  await page.reload()
  await expect(weight).toHaveValue('12.5')
})

test('keyboard reaches every product and shift selection crosses recycled rows with full totals', async ({
  extension,
}) => {
  const { page } = await seed(extension)
  const first = page.locator('#sheet-body tr[data-selection-key]').first()
  await first.focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Control+End')
  const last = page.locator('#sheet-body [data-selection-key$="/800499"]')
  await expect(last).toBeFocused()
  await expect(last).toBeInViewport()
  await page.keyboard.press('Shift+End')
  await expect(page.locator('#selection-summary')).toContainText('500 selected')
  await page.keyboard.press('Shift+Home')
  await expect(page.locator('#selection-summary')).toContainText('1 selected')
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Shift+End')
  await expect(page.locator('#selection-summary')).toContainText('500 selected')
  await expect(
    page.locator('#product-selection-totals [data-selection-total="gross"] dd')
  ).toHaveText('¥ 5,000.00')
  expect(
    await page.locator('#sheet-body tr[data-selection-key]').count()
  ).toBeLessThanOrEqual(101)
  await page.locator('#search').fill('Continuous product 500')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    1
  )
  await expect(page.locator('#sheet-body .row-number')).toHaveText('1')
  await expect(page.locator('.virtual-table-spacer')).toHaveCount(0)
})

test('resizing a long table keeps the current product and its scroll position', async ({
  extension,
}) => {
  const { page } = await seed(extension)
  await page.setViewportSize({ width: 1400, height: 900 })
  const scroller = page.locator('.table-scroll')
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2
  })
  await expect(
    page
      .locator('#sheet-body tr[data-selection-key]')
      .first()
      .locator('.row-number')
  ).not.toHaveText('1')
  const anchor = await scroller.evaluate((element) => {
    const top =
      element.getBoundingClientRect().top +
      element.querySelector('thead').getBoundingClientRect().height
    const row = [...element.querySelectorAll('[data-selection-key]')].find(
      (node) => node.getBoundingClientRect().bottom > top
    )
    return {
      key: row.dataset.selectionKey,
      top: row.getBoundingClientRect().top - top,
    }
  })
  await page.setViewportSize({ width: 900, height: 900 })
  const row = page.locator(`#sheet-body [data-selection-key="${anchor.key}"]`)
  await expect(row).toBeAttached()
  await expect
    .poll(async () => {
      const viewport = await scroller.boundingBox()
      const header = await scroller.locator('thead').boundingBox()
      return Math.abs(
        (await row.boundingBox()).y - viewport.y - header.height - anchor.top
      )
    })
    .toBeLessThanOrEqual(3)
  expect(
    await page.locator('#sheet-body tr[data-selection-key]').count()
  ).toBeLessThanOrEqual(101)
})
