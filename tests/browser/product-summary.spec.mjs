import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

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
  'selected product amounts update through scrolling, filtering, and selection clearing without prorating order totals',
  { tag: '@smoke' },
  async ({ extension }) => {
    const page = await workspace(extension)
    const rows = page.locator('#sheet-body tr[data-selection-key]')
    await expect(metric(page, 'rows')).toHaveText('0')
    await expect(metric(page, 'quantity')).toHaveText('0')
    await expect(metric(page, 'gross')).toHaveText('¥ 0.00')
    await expect(metric(page, 'after-discounts')).toHaveText('¥ 0.00')
    await expect(metric(page, 'filtered-rows')).toHaveText('107')
    await expect(metric(page, 'filtered-quantity')).toHaveText('319')
    await rows.first().focus()
    await page.keyboard.press('Control+a')
    await expect(metric(page, 'rows')).toHaveText('107')
    await expect(metric(page, 'quantity')).toHaveText('319')
    await expect(metric(page, 'gross')).toHaveText('¥ 146.05')
    await expect(metric(page, 'after-discounts')).toHaveText('¥ 142.90')
    await page.locator('.table-scroll').evaluate((scroller) => {
      scroller.scrollTop = scroller.scrollHeight
    })
    await expect(rows.last().locator('.row-number')).toHaveText('107')
    await expect(metric(page, 'rows')).toHaveText('107')
    await expect(metric(page, 'after-discounts')).toHaveText('¥ 142.90')
    await page.locator('#search').fill('Other synthetic')
    await expect(page.locator('#selection-summary')).toContainText('2 rows')
    await expect(metric(page, 'rows')).toHaveText('0')
    await expect(metric(page, 'filtered-rows')).toHaveText('2')
    await expect(metric(page, 'filtered-quantity')).toHaveText('4')
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
    await expect(metric(page, 'filtered-rows')).toHaveText('1')
    await expect(metric(page, 'filtered-quantity')).toHaveText('2')
    await expect(metric(page, 'matching-quantity')).toHaveText('4')
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

test('each calculation copies its exact plain number with success feedback and follows selection and filters', async ({
  extension,
}) => {
  const page = await workspace(extension)
  await page.evaluate(() => {
    window.summaryCopies = []
    navigator.clipboard.writeText = async (value) =>
      window.summaryCopies.push(value)
  })
  await page.locator('#select-rows').click()
  const root = fileURLToPath(new URL('../../', import.meta.url))
  await mkdir(`${root}/work`, { recursive: true })
  await page.mouse.move(0, 0)
  await page
    .locator('.action-bar')
    .screenshot({ path: `${root}/work/calculation-summary.png` })
  const values = [
    ['rows', '107'],
    ['quantity', '319'],
    ['gross', '146.05'],
    ['after-discounts', '142.90'],
    ['filtered-rows', '107'],
    ['filtered-quantity', '319'],
    ['matching-quantity', '319'],
  ]
  for (const [key, raw] of values) {
    const button = metric(page, key).getByRole('button')
    await button.click()
    await expect(button.getByRole('status')).toBeVisible()
    await expect(button.getByRole('status')).toContainText('Copied')
    expect(await page.evaluate(() => window.summaryCopies.at(-1))).toBe(raw)
  }
  expect(await page.evaluate(() => window.summaryCopies)).toEqual(
    values.map(([, value]) => value)
  )
  await expect(page.locator('#selection-summary')).toContainText('107 selected')
  await page.locator('#search').fill('Other synthetic 1')
  await expect(metric(page, 'rows')).toHaveText('0')
  await expect(metric(page, 'filtered-rows')).toHaveText('1')
  await expect(metric(page, 'filtered-quantity')).toHaveText('2')
  await expect(metric(page, 'matching-quantity')).toHaveText('4')
  await metric(page, 'matching-quantity').getByRole('button').click()
  expect(await page.evaluate(() => window.summaryCopies.at(-1))).toBe('4')
  await page.locator('#select-rows').click()
  await page.locator('#language-toggle [data-language=es]').click()
  await expect(metric(page, 'gross')).toHaveText('¥ 20.00')
  const gross = metric(page, 'gross').getByRole('button')
  await expect(gross).toHaveAccessibleName('Copiar Precio × cantidad: 20.00')
  await gross.click()
  await expect(gross.getByRole('status')).toContainText('Copiado')
  expect(await page.evaluate(() => window.summaryCopies.at(-1))).toBe('20.00')
  await page.locator('#clear-rows').click()
  await expect(metric(page, 'quantity')).toHaveText('0')
  await metric(page, 'quantity').getByRole('button').click()
  expect(await page.evaluate(() => window.summaryCopies.at(-1))).toBe('0')
})

test('calculation copying preserves integers beyond Number precision and exact cents without displayed separators', async ({
  extension,
}) => {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.items = [
    {
      ...record.snapshot.items[0],
      quantity: '9007199254740993',
      price: '1.00',
      sourceDiscount: '0.01',
      allocatedDiscount: '0.00',
      discount: '0.01',
    },
  ]
  record.snapshot.totals = {
    goodsGross: '9007199254740993.00',
    shipping: '0.00',
    sourceDiscount: '0.01',
    orderAdjustment: '0.00',
    goodsNet: '9007199254740992.99',
    payable: '9007199254740992.99',
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
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await page.evaluate(() => {
    window.summaryCopies = []
    navigator.clipboard.writeText = async (value) =>
      window.summaryCopies.push(value)
  })
  await page.locator('#select-rows').click()
  await expect(metric(page, 'quantity')).toHaveText('9,007,199,254,740,993')
  await expect(metric(page, 'gross')).toHaveText('¥ 9,007,199,254,740,993.00')
  await expect(metric(page, 'after-discounts')).toHaveText(
    '¥ 9,007,199,254,740,992.99'
  )
  for (const key of ['quantity', 'gross', 'after-discounts'])
    await metric(page, key).getByRole('button').click()
  expect(await page.evaluate(() => window.summaryCopies)).toEqual([
    '9007199254740993',
    '9007199254740993.00',
    '9007199254740992.99',
  ])
})
