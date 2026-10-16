import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function openWorkspace(extension, { twoOrders = false } = {}) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const record = records[0]
  // A source value that is also a translated UI key must remain unchanged.
  record.snapshot.sellerName = 'Photo'
  record.snapshot.sellerMemberLogin = 'synthetic-language-shop'
  record.snapshot.sellerShopOrigin = 'https://synthetic-language-shop.1688.com'
  record.snapshot.status = '待收货'
  records[1].snapshot.status = '卖家已发货，等待买家确认收货'
  for (const item of record.snapshot.items) {
    item.title = '合成玻璃罐'
    item.productNumber = 'TEST-LANGUAGE-JAR'
    item.skuProperties = [{ label: '颜色', value: '灰色', raw: '颜色：灰色' }]
    item.description = '合成玻璃罐\n颜色：灰色'
  }
  const restored = await extension.inspector.evaluate(
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
    twoOrders ? records.slice(0, 2) : [record]
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    twoOrders ? 6 : 3
  )
  return { page, record }
}

test('language toggle translates interface and color hints, persists, and preserves source data', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(
    page.locator('#language-toggle [data-language=en]')
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.product-color-hint').first()).toHaveText('Gray')
  await page.locator('#language-toggle [data-language=es]').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.locator('#prepare-orders')).toHaveText(
    'Preparar lista de empaque'
  )
  await expect(page.locator('.product-color-hint').first()).toHaveText('Gris')
  await expect(page.locator('.order-section-store .order-seller')).toHaveText(
    'Photo'
  )
  await expect(page.locator('.product-title').first()).toHaveText('合成玻璃罐')
  await page.locator('.product-title').first().dblclick()
  const original = page.locator('.product-details-dialog')
  await expect(original).toBeVisible()
  await expect(
    original.locator('.product-original-description pre')
  ).toHaveText('合成玻璃罐\n颜色：灰色')
  await page.keyboard.press('Escape')
  await expect(original).toHaveCount(0)
  await page.reload()
  await expect(
    page.locator('#language-toggle [data-language=es]')
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#prepare-orders')).toHaveText(
    'Preparar lista de empaque'
  )
  await page.locator('#language-toggle [data-language=zh]').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.locator('#prepare-orders')).toHaveText('准备装箱清单')
  await expect(page.locator('.product-color-hint').first()).toHaveText('灰色')
  await expect(page.locator('.order-section-store .order-seller')).toHaveText(
    'Photo'
  )
})

test('source identities copy directly without changing selection, layout, or opening details', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await rows.first().focus()
  await page.keyboard.press('Space')
  const before = await rows.first().boundingBox()
  const header = page.locator('.order-section-band')
  const number = header.locator('.order-section-number')
  await number.click()
  await expect(number.locator('.copy-text-feedback')).toHaveText('Copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    record.snapshot.orderId
  )
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true')
  const after = await rows.first().boundingBox()
  expect(after.height).toBeCloseTo(before.height, 1)
  const shop = header.locator('.order-seller')
  await shop.click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Photo'
  )
  await expect(shop.locator('.copy-text-feedback')).toHaveText('Copied')
  const card = page.locator('.order-card').first()
  await expect(card).toHaveAttribute('aria-selected', 'false')
  await card.locator('.order-seller').click()
  await expect(card).toHaveAttribute('aria-selected', 'false')
  await card.locator('.order-reference').dblclick()
  await expect(page.locator('#order-details')).not.toBeVisible()
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true')
  await expect(shop.locator('.copy-text-feedback')).toBeHidden()
  await card.locator('.order-reference').focus()
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    record.snapshot.orderId
  )
  await expect(card).toHaveAttribute('aria-selected', 'false')
})

test('order metadata appears once per section and identical delivery statuses use identical colors', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension, { twoOrders: true })
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(
    rows.locator(
      '.order-seller, .order-reference, .purchase-date, .order-status'
    )
  ).toHaveCount(0)
  await expect(page.locator('.order-section-band')).toHaveCount(2)
  await expect(page.locator('.order-section-band .purchase-date')).toHaveCount(
    2
  )
  await expect(page.locator('.order-section-band .order-status')).toHaveText([
    'Awaiting delivery',
    'Awaiting delivery',
  ])
  const colors = await page.locator('.order-status').evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node)
      return [style.color, style.backgroundColor]
    })
  )
  expect(new Set(colors.map(JSON.stringify)).size).toBe(1)
  const revisions = page.locator('.order-section-band .revision-badge')
  await expect(revisions).toHaveText(['Updated', 'Saved'])
  const revisionStyles = await revisions.evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node)
      return [style.color, style.backgroundColor, style.fontWeight]
    })
  )
  expect(revisionStyles[0]).toEqual(revisionStyles[1])
  await revisions.first().hover()
  await expect(page.getByRole('tooltip')).toContainText(
    'changed during a refresh'
  )
  await revisions.last().hover()
  await expect(page.getByRole('tooltip')).toContainText('Saved in this browser')
})

test('switching languages keeps packing edits mounted and preserves pending authored names', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await page.locator('#sheet-body tr[data-selection-key]').first().focus()
  await page.keyboard.press('Control+a')
  await page.locator('#prepare-orders').click()
  const view = page.locator('#packing-view')
  const review = page.getByRole('dialog', {
    name: /^(Assign product codes\?|Move selected products to this packing month\?)$/,
  })
  await expect
    .poll(async () => (await view.isVisible()) || (await review.isVisible()))
    .toBe(true)
  if (await review.isVisible())
    await review
      .getByRole('button', {
        name: /^(Assign codes|Change codes) and prepare$/,
      })
      .click()
  await expect(view).toBeVisible()
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  const now = new Date('2026-10-15T04:10:00Z')
  await page.clock.install({ time: new Date(now.getTime() - 60000) })
  await page.clock.pauseAt(now)
  const name = view.getByLabel('Spanish short name', { exact: true }).first()
  await name.fill('NOMBRE SIN GUARDAR')
  await name.evaluate((node) => {
    window.languageDraftNode = node
  })
  const code = await view
    .getByLabel('Product code', { exact: true })
    .first()
    .inputValue()
  await page.locator('#language-toggle [data-language=zh]').click()
  await expect(
    view.getByLabel('西班牙语短名称', { exact: true }).first()
  ).toHaveValue('NOMBRE SIN GUARDAR')
  expect(await page.evaluate(() => window.languageDraftNode.isConnected)).toBe(
    true
  )
  await expect(
    view.getByLabel('商品货号', { exact: true }).first()
  ).toHaveValue(code)
  await page.locator('#language-toggle [data-language=es]').click()
  await expect(
    view.getByLabel('Nombre corto en español', { exact: true }).first()
  ).toHaveValue('NOMBRE SIN GUARDAR')
  await expect(
    view.getByRole('button', { name: 'Copiar imagen de Excel', exact: true })
  ).toBeVisible()
})

test('an open settings draft translates across tabs without losing unsaved fields', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await page.locator('#packing-settings').click()
  const settings = page.locator('#settings-dialog')
  await settings.getByLabel('Website', { exact: true }).fill('unsaved.example')
  const other = await extension.context.newPage()
  await other.goto(`${extension.extensionBaseUrl}/library.html`)
  await other.locator('#language-toggle [data-language=es]').click()
  await expect(settings).toHaveAttribute('aria-label', 'Ajustes')
  await expect(settings.getByLabel('Sitio web', { exact: true })).toHaveValue(
    'unsaved.example'
  )
  await expect(
    settings.getByRole('button', { name: 'Guardar ajustes', exact: true })
  ).toBeVisible()
  await other.locator('#language-toggle [data-language=zh]').click()
  await expect(settings.getByLabel('网站', { exact: true })).toHaveValue(
    'unsaved.example'
  )
  await expect(
    settings.getByRole('tab', { name: '商品名称', exact: true })
  ).toBeVisible()
})
