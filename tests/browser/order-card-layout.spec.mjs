import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

test('order cards keep counts beside full references and flow colored tags with metadata in every language', async ({
  extension,
}, testInfo) => {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  records[0].snapshot.sellerName = '合成家居用品有限公司'
  records[0].snapshot.status = '待收货'
  records[0].tags = ['pago extra', 'etiquetas', 'demora']
  records[1].snapshot.status = '待付款'
  records[1].tags = ['A longer synthetic order tag that remains fully readable']
  records[2].snapshot.items = records[2].snapshot.items.slice(0, 1)
  const single = records[2].snapshot.items[0]
  const gross = (Number(single.price) * Number(single.quantity)).toFixed(2)
  const net = (Number(gross) - Number(single.discount)).toFixed(2)
  Object.assign(records[2].snapshot.totals, {
    goodsGross: gross,
    goodsNet: net,
    payable: net,
    sourceDiscount: single.discount,
  })
  const response = await extension.inspector.evaluate(
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
  expect(response.ok, response.error).toBe(true)
  const page = await extension.context.newPage()
  await page.addInitScript(() => {
    localStorage.setItem('1688-library-purchase-months', '[]')
    localStorage.setItem('1688-library-color-scheme', 'dark')
  })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  // Loading the page does not wait for its saved orders to render. Wait for
  // both fixture months before expanding, and re-query after each remount.
  await expect(page.locator('.month-toggle')).toHaveCount(2)
  const collapsedMonths = page.locator('.month-toggle[aria-expanded=false]')
  while (await collapsedMonths.count()) await collapsedMonths.first().click()
  await expect(page.locator('.order-card')).toHaveCount(3)
  await page.locator('#packing-settings').click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('tab', { name: 'Appearance', exact: true }).click()
  for (const [label, value] of [
    ['pago extra background · Dark', '#ffcc88'],
    ['pago extra text · Dark', '#231100'],
    ['pago extra background · Light', '#301800'],
    ['pago extra text · Light', '#fff0dd'],
  ])
    await settings.getByLabel(label, { exact: true }).fill(value)
  await settings
    .getByRole('button', { name: 'Save settings', exact: true })
    .click()
  await expect(settings).not.toBeVisible()
  const cards = page.locator('.order-card')
  const first = cards.first()
  const tag = first
    .locator('.order-tag-badge')
    .filter({ hasText: 'pago extra' })
  for (const [mode, background, foreground] of [
    ['dark', 'rgb(255, 204, 136)', 'rgb(35, 17, 0)'],
    ['light', 'rgb(48, 24, 0)', 'rgb(255, 240, 221)'],
  ]) {
    if (mode === 'light') await page.locator('#theme-toggle').click()
    await expect(tag).toHaveCSS('background-color', background)
    await expect(tag).toHaveCSS('color', foreground)
    for (const [language, singular] of [
      ['en', '1 product'],
      ['es', '1 producto'],
      ['zh', '1 件商品'],
    ]) {
      await page.locator(`[data-language="${language}"]`).click()
      await expect(cards.last().locator('.order-products')).toHaveText(singular)
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 })
        const geometry = await cards.evaluateAll((nodes) =>
          nodes.map((card) => {
            const bounds = (selector) =>
              card.querySelector(selector).getBoundingClientRect()
            const reference = bounds('.order-card-reference')
            const count = bounds('.order-products')
            const id = bounds('.order-reference')
            const meta = bounds('.order-card-meta')
            const summary = bounds('.order-summary')
            const tags = [...card.querySelectorAll('.order-tag-badge')].map(
              (node) => node.getBoundingClientRect()
            )
            return {
              countBesideId:
                count.left >= id.right &&
                Math.abs(
                  count.top +
                    count.height / 2 -
                    (reference.top + reference.height / 2)
                ) <= 1,
              fullId: card.querySelector('.order-reference').textContent,
              noOverflow:
                card.scrollWidth <= card.clientWidth &&
                [
                  ...card.querySelectorAll(
                    '.order-reference, .order-products, .order-tag-badge, .order-seller'
                  ),
                ].every((node) => node.scrollWidth <= node.clientWidth + 1),
              bottomGap: summary.bottom - meta.bottom,
              tagsWithinMeta: tags.every(
                (box) => box.top >= meta.top && box.bottom <= meta.bottom + 1
              ),
              tagFontSize: tags.length
                ? parseFloat(
                    getComputedStyle(card.querySelector('.order-tag-badge'))
                      .fontSize
                  )
                : null,
              statusFontSize: parseFloat(
                getComputedStyle(card.querySelector('.order-status')).fontSize
              ),
              rowsGap: meta.top - reference.bottom,
            }
          })
        )
        for (const [index, item] of geometry.entries()) {
          expect(item.countBesideId).toBe(true)
          expect(item.fullId).toBe(records[index].snapshot.orderId)
          expect(item.noOverflow).toBe(true)
          expect(item.bottomGap).toBeLessThanOrEqual(1)
          expect(item.tagsWithinMeta).toBe(true)
          expect(item.rowsGap).toBeLessThanOrEqual(4)
          if (item.tagFontSize !== null)
            expect(item.tagFontSize - item.statusFontSize).toBe(1.5)
        }
        if (language === 'en')
          await page.locator('.orders-pane').screenshot({
            path: testInfo.outputPath(`orders-${mode}-${width}.png`),
          })
      }
    }
  }
  await first.locator('.order-products').click()
  await expect(first).toHaveAttribute('aria-selected', 'true')
  await tag.click()
  await expect(first).toHaveAttribute('aria-selected', 'false')
  await expect(first.locator('.order-source-link')).toHaveAttribute(
    'href',
    new RegExp(`orderId=${records[0].snapshot.orderId}$`)
  )
})
