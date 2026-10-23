import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  assignSelectedPurchaseCodes,
  editOrderProduct,
} from './smart-workspace-helpers.mjs'

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
  await expect(page.locator('#review-purchase-codes')).toHaveText(
    'Revisar códigos del mes de compra'
  )
  await expect(page.locator('.product-color-hint').first()).toHaveText('Gris')
  await expect(page.locator('.order-section-store .order-seller')).toHaveText(
    'Photo'
  )
  await expect(page.locator('.product-title').first()).toHaveText('合成玻璃罐')
  await page.locator('.product-title').first().click()
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
  await expect(page.locator('#review-purchase-codes')).toHaveText(
    'Revisar códigos del mes de compra'
  )
  await page.locator('#language-toggle [data-language=zh]').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.locator('#review-purchase-codes')).toHaveText(
    '核对采购月份编码'
  )
  await expect(page.locator('.product-color-hint').first()).toHaveText('灰色')
  await expect(page.locator('.order-section-store .order-seller')).toHaveText(
    'Photo'
  )
})

for (const language of ['en', 'es', 'zh']) {
  test(`explicit product selection stays in place while click inspects originals in ${language}`, async ({
    extension,
  }) => {
    const { page } = await openWorkspace(extension)
    await page.locator(`#language-toggle [data-language=${language}]`).click()
    const row = page.locator('#sheet-body tr[data-selection-key]').first()
    const title = row.locator('.product-title')
    let layoutSample = 0
    const layout = async () => {
      const sample = await page
        .locator('.sheet-toolbar')
        .evaluate((toolbar) => {
          const measure = (selector) => {
            const node = document.querySelector(selector)
            if (!node) return null
            const rect = node.getBoundingClientRect(),
              style = getComputedStyle(node)
            return {
              top: rect.top,
              height: rect.height,
              scrollTop: node.scrollTop,
              scrollHeight: node.scrollHeight,
              clientHeight: node.clientHeight,
              gridRows: style.gridTemplateRows,
            }
          }
          return {
            geometry: {
              height: toolbar.getBoundingClientRect().height,
              tableTop:
                document.querySelector('.table-scroll').getBoundingClientRect()
                  .top + window.scrollY,
              paneHeight: document
                .querySelector('.sheet-pane')
                .getBoundingClientRect().height,
              actionBarHeight: document
                .querySelector('.action-bar')
                .getBoundingClientRect().height,
            },
            width: innerWidth,
            scrollY,
            focused: document.activeElement?.outerHTML.slice(0, 500),
            panes: Object.fromEntries(
              [
                '#orders-view',
                '.orders-pane',
                '.sheet-pane',
                '.table-scroll',
                '.action-bar',
                '.product-selection-totals',
              ].map((selector) => [selector, measure(selector)])
            ),
          }
        })
      await test.info().attach(`selection-layout-${layoutSample++}`, {
        body: Buffer.from(JSON.stringify(sample, null, 2)),
        contentType: 'application/json',
      })
      return sample.geometry
    }
    for (const { width, height = 900, font, initialRows } of [
      { width: 390, height: 844, initialRows: true },
      ...[1440, 1280, 1000, 390, 375, 360].map((width) => ({ width })),
      // Different font metrics exposed an extra summary line on hosted Linux.
      { width: 375, font: 'Georgia, serif' },
    ]) {
      await page.setViewportSize({ width, height })
      if (initialRows) {
        const frame = await page.evaluate(() => {
          const pane = document.querySelector('.sheet-pane'),
            scroll = document.querySelector('.table-scroll')
          pane.scrollTop = scroll.scrollTop = 0
          const p = pane.getBoundingClientRect(),
            s = scroll.getBoundingClientRect(),
            r = document
              .querySelector('#sheet-body tr[data-selection-key]')
              .getBoundingClientRect(),
            header = scroll.querySelector('thead').getBoundingClientRect()
          return {
            visibleRow: Math.max(
              0,
              Math.min(r.bottom, p.bottom, s.bottom, innerHeight) -
                Math.max(r.top, p.top, s.top + header.height)
            ),
            paneHeight: p.height,
            actionBarHeight: document
              .querySelector('.action-bar')
              .getBoundingClientRect().height,
          }
        })
        await test.info().attach('initial-phone-source-visibility', {
          body: Buffer.from(JSON.stringify(frame, null, 2)),
          contentType: 'application/json',
        })
        expect(frame.visibleRow).toBeGreaterThanOrEqual(48)
        for (const selector of [
          '#review-purchase-codes',
          '#include-orders',
          '#backup-packing',
        ]) {
          const action = page.locator(selector)
          await action.focus()
          const box = await action.boundingBox()
          expect(box.x).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width).toBeLessThanOrEqual(width)
          expect(box.y).toBeGreaterThanOrEqual(0)
          expect(box.y + box.height).toBeLessThanOrEqual(height)
          await expect(action).toBeFocused()
        }
      }
      if (font)
        await page.addStyleTag({ content: `body { font-family: ${font}; }` })
      await row.focus()
      await page.keyboard.press('ControlOrMeta+d')
      const checkbox = row.getByRole('checkbox')
      await checkbox.scrollIntoViewIfNeeded()
      await checkbox.focus()
      const before = await layout()
      await checkbox.check()
      await expect(row).toHaveAttribute('aria-selected', 'true')
      expect(await layout(), `selection at ${width}px`).toEqual(before)
      await title.click()
      const inspect = page.locator('.product-details-dialog')
      await expect(inspect).toBeVisible()
      await expect(row).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Escape')
      await checkbox.scrollIntoViewIfNeeded()
      await checkbox.focus()
      const beforeClear = await layout()
      await checkbox.uncheck()
      await expect(row).toHaveAttribute('aria-selected', 'false')
      expect(await layout(), `deselection at ${width}px`).toEqual(beforeClear)
      await row.focus()
      // Native focus can scroll the phone's independent pane. Compare the
      // selection operation after that focus step, retaining exact geometry.
      const keyboardBefore = await layout()
      await page.keyboard.press('ControlOrMeta+a')
      await expect(
        page.locator('#sheet-body tr[aria-selected="true"]')
      ).toHaveCount(3)
      expect(await layout(), `select all at ${width}px`).toEqual(keyboardBefore)
      await page.keyboard.press('ControlOrMeta+d')
      expect(await layout(), `clear all at ${width}px`).toEqual(keyboardBefore)
      await title.click()
      const original = page.locator('.product-details-dialog')
      await expect(original).toBeVisible()
      await expect(
        original.locator('.product-original-description pre')
      ).toHaveText('合成玻璃罐\n颜色：灰色')
      await page.keyboard.press('Escape')
      await expect(original).toHaveCount(0)
    }
  })
}

test('source identities copy directly and the card store name opens details without changing selection or layout', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await rows.first().getByRole('checkbox').check()
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
  const details = page.locator('#order-details')
  await expect(details).toBeVisible()
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true')
  await expect(card.locator('.order-reference')).toHaveCount(0)
  await details.locator('.order-reference').dblclick()
  await expect(details).toBeVisible()
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true')
  await expect(shop.locator('.copy-text-feedback')).toBeHidden()
  await details.locator('.order-reference').focus()
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    record.snapshot.orderId
  )
  await details.getByRole('button', { name: 'Close order details' }).click()
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
      // Badge hues can differ with editable palettes; emphasis stays equal.
      return [
        style.fontWeight,
        style.fontSize,
        style.padding,
        style.borderWidth,
      ]
    })
  )
  expect(revisionStyles[0]).toEqual(revisionStyles[1])
  await revisions.first().hover()
  await expect(page.getByRole('tooltip')).toContainText(
    'changed during a refresh'
  )
  await revisions.last().hover()
  await expect(page.getByRole('tooltip')).toContainText('Saved in this browser')
  const updated = rows.filter({ has: page.locator('.row-number') }).first()
  const saved = rows.last()
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.locator('#theme-toggle').click()
    await page.mouse.move(0, 0)
    expect(
      await updated.evaluate((node) => getComputedStyle(node).backgroundColor)
    ).toBe(
      await saved.evaluate((node) => getComputedStyle(node).backgroundColor)
    )
    await updated.getByRole('checkbox').click()
    await page.mouse.move(0, 0)
    await expect(updated).toHaveAttribute('aria-selected', 'true')
    await expect(updated.locator('.row-number')).toHaveCSS('box-shadow', 'none')
    expect(
      await updated
        .locator('.row-number')
        .evaluate((node) => getComputedStyle(node, '::after').visibility)
    ).toBe('visible')
    expect(
      await updated.evaluate((node) => getComputedStyle(node).backgroundColor)
    ).not.toBe(
      await saved.evaluate((node) => getComputedStyle(node).backgroundColor)
    )
    await updated.getByRole('checkbox').click()
    await expect(updated).toHaveAttribute('aria-selected', 'false')
  }
})

test('switching languages keeps Orders authoring mounted and preserves pending source names', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await page.locator('#select-rows').click()
  await assignSelectedPurchaseCodes(page)
  const view = await editOrderProduct(page, 0),
    now = new Date('2026-10-15T04:10:00Z')
  await page.clock.install({ time: new Date(now.getTime() - 60000) })
  await page.clock.pauseAt(now)
  const name = view.locator('[data-authoring-field="spanish-name"]')
  await name.fill('NOMBRE SIN GUARDAR')
  await name.evaluate((node) => {
    window.languageDraftNode = node
  })
  const code = await view
    .getByRole('textbox', { name: 'Product code', exact: true })
    .inputValue()
  await view.locator('[data-language="zh"]').click()
  await expect(name).toHaveValue('NOMBRE SIN GUARDAR')
  expect(await page.evaluate(() => window.languageDraftNode.isConnected)).toBe(
    true
  )
  await expect(
    view.getByRole('textbox', { name: '商品货号', exact: true })
  ).toHaveValue(code)
  await view.locator('[data-language="es"]').click()
  await expect(name).toHaveValue('NOMBRE SIN GUARDAR')
  await expect(view.locator('[data-language="es"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(
    view.getByRole('button', { name: 'Código de barras', exact: true })
  ).toBeVisible()
})

test('an open settings draft translates across tabs without losing unsaved fields', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await page.locator('#packing-settings').click()
  const settings = page.locator('#settings-dialog')
  await settings.getByRole('tab', { name: 'Labels', exact: true }).click()
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
