import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function workspace(extension) {
  const records = (
    await extension.inspector.evaluate(
      `(${createDemoRecords.toString()})(document)`
    )
  ).slice(0, 2)
  for (const [orderIndex, record] of records.entries()) {
    const source = record.snapshot.items[0]
    record.snapshot.items = Array.from(
      { length: orderIndex ? 2 : 105 },
      (_, index) => ({
        ...source,
        entryId: String(
          9100000000000000000n + BigInt(orderIndex * 1000 + index)
        ),
        description: `${orderIndex ? 'Other' : 'Included'} synthetic ${index + 1}`,
        price: orderIndex ? '10.00' : '0.335',
        quantity: orderIndex ? '2' : '3',
        sourceDiscount: orderIndex ? '0.00' : '0.01',
        allocatedDiscount: orderIndex ? '0.00' : '0.02',
        discount: orderIndex ? '0.00' : '0.03',
      })
    )
    record.snapshot.totals = {
      goodsGross: orderIndex ? '40.00' : '106.05',
      shipping: orderIndex ? '3.00' : '5.00',
      sourceDiscount: orderIndex ? '0.00' : '1.05',
      orderAdjustment: orderIndex ? '0.00' : '2.10',
      orderDiscount: orderIndex ? '5.00' : '0.00',
      goodsNet: orderIndex ? '35.00' : '102.90',
      payable: orderIndex ? '38.00' : '107.90',
    }
    record.changedEntryIds = []
  }
  const result = await extension.inspector.evaluate(
    async (orders) =>
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
  expect(result.ok, result.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#selection-summary')).toContainText('107 rows')
  return page
}

function metric(page, key) {
  return page.locator(
    `#product-selection-totals [data-selection-total="${key}"] dd`
  )
}

test(
  'selected product amounts update across pages, filtering, and selection clearing without prorating order totals',
  { tag: '@smoke' },
  async ({ extension }) => {
    const page = await workspace(extension)
    const rows = page.locator('#sheet-body tr[data-selection-key]')
    await expect(metric(page, 'rows')).toHaveText('0')
    await expect(metric(page, 'quantity')).toHaveText('0')
    await expect(metric(page, 'gross')).toHaveText('¥ 0.00')
    await expect(metric(page, 'after-discounts')).toHaveText('¥ 0.00')
    await expect(page.locator('.selection-totals-context')).toContainText(
      '107 rows · Quantity 319'
    )
    await rows.first().focus()
    await page.keyboard.press('Control+a')
    await expect(metric(page, 'rows')).toHaveText('107')
    await expect(metric(page, 'quantity')).toHaveText('319')
    await expect(metric(page, 'gross')).toHaveText('¥ 146.05')
    await expect(metric(page, 'after-discounts')).toHaveText('¥ 142.90')
    await page.locator('#next-page').click()
    await expect(page.locator('#page-label')).toHaveText('2 / 2')
    await expect(metric(page, 'rows')).toHaveText('107')
    await expect(metric(page, 'after-discounts')).toHaveText('¥ 142.90')
    await page.locator('#search').fill('Other synthetic')
    await expect(page.locator('#selection-summary')).toContainText('2 rows')
    await expect(metric(page, 'rows')).toHaveText('0')
    await expect(page.locator('.selection-totals-context')).toContainText(
      '2 rows · Quantity 4'
    )
    await rows.first().focus()
    await page.keyboard.press('Control+a')
    await expect(metric(page, 'gross')).toHaveText('¥ 40.00')
    await expect(metric(page, 'after-discounts')).toHaveText('¥ 40.00')
    await expect(page.locator('#order-totals .totals-payable dd')).toHaveText(
      '¥ 38.00'
    )
    await page.locator('#search').fill('Other synthetic 1')
    await expect(rows).toHaveCount(1)
    await expect(metric(page, 'rows')).toHaveText('0')
    await expect(page.locator('.selection-totals-context')).toContainText(
      '1 rows · Quantity 2'
    )
    await expect(page.locator('.selection-totals-context')).toContainText(
      'Complete matching orders: Quantity 4'
    )
    await rows.first().focus()
    await page.keyboard.press('Space')
    await expect(metric(page, 'rows')).toHaveText('1')
    await expect(metric(page, 'gross')).toHaveText('¥ 20.00')
    await page.keyboard.press('Escape')
    await expect(metric(page, 'rows')).toHaveText('0')
    await expect(metric(page, 'gross')).toHaveText('¥ 0.00')
    await page.locator('#select-rows').click()
    await expect(metric(page, 'rows')).toHaveText('1')
    await page.locator('#clear-rows').click()
    await expect(metric(page, 'quantity')).toHaveText('0')
  }
)

test('selection summary translates live, keeps numbers exact and wraps at narrow widths', async ({
  extension,
}) => {
  const page = await workspace(extension)
  await page.locator('#select-rows').click()
  const summary = page.locator('#product-selection-totals')
  for (const [language, rowsLabel, amountLabel] of [
    ['zh', '所选行数', '行优惠后金额'],
    ['es', 'Filas seleccionadas', 'Tras descuentos por fila'],
  ]) {
    await page.locator(`#language-toggle [data-language=${language}]`).click()
    await expect(summary).toContainText(rowsLabel)
    await expect(summary).toContainText(amountLabel)
    await expect(metric(page, 'rows')).toHaveText('107')
    await expect(metric(page, 'quantity')).toHaveText('319')
  }
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await summary.evaluate(
      (element) => element.scrollWidth <= element.clientWidth
    )
  ).toBe(true)
  await page.locator('#language-toggle [data-language=en]').click()
  await expect(metric(page, 'after-discounts')).toHaveText('¥ 142.90')
})
