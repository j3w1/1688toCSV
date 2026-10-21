import { mkdir } from 'node:fs/promises'
import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { createStoreOrder } from '../../src/store-order.js'

async function seedStores(extension) {
  const native = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  native.forEach((record, index) => {
    record.snapshot.sellerMemberLogin =
      index < 2 ? 'known-native-store' : 'other-native-store'
    if (index < 2) {
      record.snapshot.sellerName = 'Synthetic 1688 seller'
      record.storeWechat = 'Native_Wechat_88'
      record.storeWechatUpdatedAt = '2026-10-21T00:00:00.000Z'
    }
  })
  native[0].additionalCharges = [
    { id: 'native-unload', reason: 'Unloading', amount: '20.00' },
  ]
  native[0].additionalChargesUpdatedAt = '2026-10-21T00:00:00.000Z'
  const sheets = []
  const assets = new Map()
  for (const [index, factory] of [false, false, true].entries()) {
    const input = {
      filename: factory
        ? 'Synthetic Factory.xlsx'
        : `4321${index ? ' (2)' : ''}.xlsx`,
      sheetName: 'Order',
      purchaseDate: `2026-10-${19 + index}`,
      total: '60.00',
      store: factory
        ? {
            key: 'factory:Synthetic Factory',
            kind: 'factory',
            number: '',
            name: 'Synthetic Factory',
          }
        : { key: 'market:4321', kind: 'market', number: '4321', name: '4321' },
      rows: [
        {
          row: 2,
          group: '1',
          title: 'Synthetic ceramic cup',
          description: 'Synthetic ceramic cup · ivory',
          boxes: 2,
          perbox: 10,
          quantity: 20,
          price: '3.00',
          amount: '60.00',
          photos: [native[0].snapshot.items[0].thumbnail],
        },
      ],
    }
    const result = await createStoreOrder(input, {
      now: '2026-10-21T00:00:00.000Z',
      orderId: `991234567890123456789${index}`,
    })
    sheets.push({
      snapshot: result.snapshot,
      revision: 1,
      changedAt: result.snapshot.observedAt,
      lastCheckedAt: result.snapshot.observedAt,
      tags: [],
      notes: '',
      changedEntryIds: [],
      removedEntryIds: [],
      unitsPerCarton: result.unitsPerCarton,
    })
    for (const asset of result.images) assets.set(asset.url, asset)
  }
  const orders = [...sheets, ...native]
  const saved = await extension.inspector.evaluate(
    async (backup) =>
      chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    {
      format: '1688-order-library',
      version: 1,
      exportedAt: '2026-10-21T00:00:00.000Z',
      orders,
      history: [],
      images: [...assets.values()],
    }
  )
  expect(saved.ok, saved.error).toBe(true)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-21T04:00:00Z'))
  await page.setViewportSize({ width: 1280, height: 960 })
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('.month-toggle')).toHaveCount(2)
  for (const toggle of await page
    .locator('.month-toggle[aria-expanded=false]')
    .all())
    await toggle.click()
  await expect(page.locator('.order-card')).toHaveCount(6)
  return { page, sheets, native }
}

test('store cards keep IDs in details, show minimal charges and copy WeChat without changing selection', async ({
  extension,
}) => {
  const { page, sheets, native } = await seedStores(extension)
  const cards = page.locator('.order-card')
  for (const record of [...sheets, ...native]) {
    const target = page.locator(
      `.order-card[data-order-id="${record.snapshot.orderId}"]`
    )
    await expect(target).not.toContainText(record.snapshot.orderId)
    await expect(target.locator('.order-reference')).toHaveCount(0)
  }
  const numeric = page.locator(
    `.order-card[data-order-id="${sheets[0].snapshot.orderId}"]`
  )
  await expect(numeric.locator('.store-number')).toHaveCount(0)
  const nativeCard = page.locator(
    `.order-card[data-order-id="${native[0].snapshot.orderId}"]`
  )
  await expect(nativeCard.locator('.order-card-charges')).toHaveText('+¥20.00')
  await expect(cards.locator('.order-card-charges')).toHaveCount(1)
  const copy = nativeCard.locator('.store-wechat-copy')
  await expect(copy).toHaveAccessibleName('Copy WeChat ID')
  await expect(copy.locator('.ui-icon')).toHaveAttribute('aria-hidden', 'true')
  await expect(copy.locator('.ui-icon')).toHaveCSS('width', '13px')
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 960 })
    const withCopy = await nativeCard.evaluate((card) => ({
      title: card.querySelector('.order-card-identity').getBoundingClientRect()
        .height,
      card: card.getBoundingClientRect().height,
      copy: card.querySelector('.store-wechat-copy').getBoundingClientRect()
        .height,
      seller: card
        .querySelector('.order-details-trigger')
        .getBoundingClientRect().height,
    }))
    expect(withCopy.copy).toBe(16)
    expect(withCopy.copy).toBeLessThanOrEqual(withCopy.seller)
    await copy.evaluate((button) => {
      button.style.display = 'none'
    })
    const withoutCopy = await nativeCard.evaluate((card) => ({
      title: card.querySelector('.order-card-identity').getBoundingClientRect()
        .height,
      card: card.getBoundingClientRect().height,
    }))
    expect(withCopy.title).toBe(withoutCopy.title)
    expect(withCopy.card).toBe(withoutCopy.card)
    await copy.evaluate((button) => button.style.removeProperty('display'))
  }
  await page.setViewportSize({ width: 1280, height: 960 })
  await copy.click()
  await expect(copy).toHaveClass(/copied/)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Native_Wechat_88'
  )
  await expect(page.locator('.order-card[aria-selected=true]')).toHaveCount(0)
  await nativeCard.locator('.order-card-charges').click()
  const details = page.locator('#order-details')
  await expect(details).toBeVisible()
  await expect(details.locator('#order-details-heading')).toContainText(
    native[0].snapshot.orderId
  )
  await expect(details.locator('section.order-charges')).toBeVisible()
  await expect(details.locator('.order-charges summary')).toHaveCount(0)
  await expect(details.locator('input[name="store-name"]')).toHaveCount(0)
  await expect(details.getByLabel('WeChat ID', { exact: true })).toHaveValue(
    'Native_Wechat_88'
  )
  await expect(details.locator('.store-wechat-copy')).toHaveCSS('width', '24px')
  await expect(details.locator('.store-wechat-copy .ui-icon')).toHaveCSS(
    'width',
    '18px'
  )
  await details
    .getByRole('button', { name: 'Close order details', exact: true })
    .click()
  await mkdir(new URL('../../work/', import.meta.url), { recursive: true })
  await page.screenshot({ path: 'work/store-cards.png' })
  await page.close()
})

test('order-card headings keep compact centered status controls beside the store name', async ({
  extension,
}) => {
  const { page, native } = await seedStores(extension)
  const card = page.locator(
    `.order-card[data-order-id="${native[0].snapshot.orderId}"]`
  )
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 960 })
    const layout = await card.evaluate((card) => {
      const box = (selector) =>
        card.querySelector(selector).getBoundingClientRect()
      const frame = card.getBoundingClientRect()
      const title = box('.order-card-identity')
      const seller = box('.order-seller')
      const actions = box('.order-card-actions')
      return {
        topGap: title.top - frame.top,
        iconGap: actions.left - seller.right,
        controls: [...card.querySelectorAll('.order-card-actions button')].map(
          (button) => {
            const bounds = button.getBoundingClientRect()
            const glyph = button.querySelector('svg').getBoundingClientRect()
            return {
              height: bounds.height,
              centerOffset:
                bounds.top + bounds.height / 2 - (title.top + title.height / 2),
              glyphOffset:
                glyph.top + glyph.height / 2 - (bounds.top + bounds.height / 2),
            }
          }
        ),
        overflows: card.scrollWidth > card.clientWidth,
      }
    })
    expect(layout.topGap).toBeLessThanOrEqual(8)
    expect(layout.iconGap).toBeGreaterThanOrEqual(0)
    expect(layout.iconGap).toBeLessThanOrEqual(7)
    expect(layout.overflows).toBe(false)
    for (const control of layout.controls) {
      expect(control.height).toBeLessThanOrEqual(18)
      expect(Math.abs(control.centerOffset)).toBeLessThanOrEqual(1)
      expect(Math.abs(control.glyphOffset)).toBeLessThanOrEqual(1)
    }
    await expect(card.locator('.operations-state svg path')).toHaveAttribute(
      'fill',
      'currentColor'
    )
    await expect(card.locator('.operations-state svg path')).toHaveAttribute(
      'stroke',
      'none'
    )
  }
  await page.close()
})

test('store profile aligns compact saves, shares WeChat, preserves other drafts and translates new controls live', async ({
  extension,
}) => {
  const { page, sheets } = await seedStores(extension)
  const cardFor = (index) =>
    page.locator(
      `.order-card[data-order-id="${sheets[index].snapshot.orderId}"]`
    )
  await cardFor(0).locator('.order-details-trigger').click()
  const details = page.locator('#order-details'),
    contact = details.getByLabel('WeChat ID', { exact: true }),
    name = details.getByLabel('Store name', { exact: true })
  await expect(details.locator('.order-charges-empty')).toBeVisible()
  const input = await name.boundingBox(),
    save = await details
      .getByRole('button', { name: 'Save store name', exact: true })
      .boundingBox()
  expect(Math.abs(input.y - save.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(input.height - save.height)).toBeLessThanOrEqual(1)
  await name.fill('Synthetic market goods')
  await contact.fill('  Market_Contact_微信  ')
  await details
    .getByRole('button', { name: 'Save WeChat ID', exact: true })
    .click()
  await expect(details.locator('.store-profile-status')).toHaveText('Saved')
  await expect(name).toHaveValue('Synthetic market goods')
  await expect(contact).toHaveValue('Market_Contact_微信')
  await expect(cardFor(0).locator('.store-wechat-copy')).toHaveCount(1)
  await expect(cardFor(1).locator('.store-wechat-copy')).toHaveCount(1)
  await details
    .getByRole('button', { name: 'Save store name', exact: true })
    .click()
  await expect(details.locator('.store-profile-status')).toHaveText('Saved')
  await expect(details.locator('#order-details-heading')).toContainText(
    'Synthetic market goods'
  )
  await expect(cardFor(1).locator('.order-details-trigger')).toHaveText(
    'Synthetic market goods'
  )
  await details.getByRole('button', { name: 'Add charge', exact: true }).click()
  await details.getByLabel('Reason', { exact: true }).fill('Delivery unloading')
  await details.getByLabel('Amount · CNY', { exact: true }).fill('12.00')
  await details
    .getByRole('button', { name: 'Save charges', exact: true })
    .click()
  await expect(details.locator('.order-charges-status')).toHaveText('Saved')
  await expect(cardFor(0).locator('.order-card-charges')).toHaveText('+¥12.00')
  await expect(details.locator('.order-charges-total')).toContainText(
    '¥60.00→¥72.00'
  )
  const bar = await details.locator('.store-orders-bar').boundingBox(),
    charges = await details.locator('.order-charges-heading').boundingBox()
  expect(charges.y - (bar.y + bar.height)).toBeGreaterThanOrEqual(12)
  await page.screenshot({ path: 'work/store-details.png' })
  await contact.fill('Uncommitted draft')
  for (const [language, status, label, save] of [
    ['es', 'Importado', 'ID de WeChat', 'Guardar ID de WeChat'],
    ['zh', '已导入', '微信号', '保存微信号'],
  ]) {
    await page
      .locator(`#language-toggle [data-language="${language}"]`)
      .evaluate((button) => button.click())
    await expect(cardFor(0).locator('.order-status')).toHaveText(status)
    await expect(cardFor(0).locator('.order-status')).toHaveAttribute(
      'title',
      status
    )
    await expect(details.getByLabel(label, { exact: true })).toHaveValue(
      'Uncommitted draft'
    )
    await expect(
      details.getByRole('button', { name: save, exact: true })
    ).toBeVisible()
    await expect(details.locator('.order-charges-heading')).not.toContainText(
      'Additional charges'
    )
  }
  await page
    .locator('#language-toggle [data-language="en"]')
    .evaluate((button) => button.click())
  await contact.fill('')
  await details
    .getByRole('button', { name: 'Save WeChat ID', exact: true })
    .click()
  await expect(details.locator('.store-profile-status')).toHaveText('Saved')
  await expect(cardFor(0).locator('.store-wechat-copy')).toHaveCount(0)
  await expect(cardFor(1).locator('.store-wechat-copy')).toHaveCount(0)
  await details
    .getByRole('button', { name: 'Close order details', exact: true })
    .click()
  await cardFor(2).locator('.order-details-trigger').click()
  await expect(details.getByLabel('Store name', { exact: true })).toHaveValue(
    'Synthetic Factory'
  )
  await expect(details.getByLabel('WeChat ID', { exact: true })).toHaveValue('')
  await page.close()
})
