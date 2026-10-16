import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function workspace(
  extension,
  count = 3,
  configureOrders = (record) => [record]
) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const record = records[0],
    source = record.snapshot.items
  record.snapshot.sellerName = 'Synthetic photo supplier'
  record.snapshot.sellerMemberLogin = 'synthetic-photos'
  record.snapshot.sellerShopOrigin = 'https://synthetic-photos.1688.com'
  record.snapshot.items = Array.from({ length: count }, (_, index) => ({
    ...source[index % source.length],
    entryId: String(9100000000000000000n + BigInt(index)),
    title: `合成图片商品 ${index + 1}`,
    productNumber: `GALLERY-${index + 1}`,
    description: `${count > 3 && index === count - 1 ? 'Excluded' : 'Gallery included'} ${String(index + 1).padStart(3, '0')}`,
    thumbnail:
      count > 3 && index === 100 ? '' : source[index % source.length].thumbnail,
    price: '1.00',
    quantity: '1',
    sourceDiscount: '0.00',
    allocatedDiscount: '0.00',
    discount: '0.00',
  }))
  record.snapshot.totals = {
    goodsGross: `${count}.00`,
    shipping: '0.00',
    sourceDiscount: '0.00',
    orderAdjustment: '0.00',
    goodsNet: `${count}.00`,
    payable: `${count}.00`,
  }
  record.changedEntryIds = []
  const orders = configureOrders(record)
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
    orders
  )
  expect(result.ok, result.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    Math.min(
      orders.reduce((total, order) => total + order.snapshot.items.length, 0),
      100
    )
  )
  return { page, record, records: orders }
}

test('photo navigation follows filtered table order across pages, skips missing photos and leaves selection intact', async ({
  extension,
}) => {
  const { page, record } = await workspace(extension, 106)
  await page.locator('#search').fill('Gallery included')
  await expect(page.locator('#selection-summary')).toContainText('105 rows')
  await expect(page.locator('#page-label')).toHaveText('1 / 2')
  const row = page.locator('#sheet-body tr[data-selection-key]').last()
  await row.focus()
  await row.press('Space')
  await row.getByRole('button', { name: /^Zoom product photo/ }).click()
  const viewer = page.getByRole('dialog', {
    name: 'Product photo',
    exact: true,
  })
  await expect(viewer.locator('.photo-gallery-count')).toHaveText('100 / 104')
  await expect(viewer.locator('.photo-viewport img')).toHaveAttribute(
    'alt',
    record.snapshot.items[99].title
  )
  await viewer.getByRole('button', { name: 'Next photo', exact: true }).click()
  await expect(viewer.locator('.photo-gallery-count')).toHaveText('101 / 104')
  await expect(viewer.locator('.photo-viewport img')).toHaveAttribute(
    'alt',
    record.snapshot.items[101].title
  )
  await viewer
    .getByRole('button', { name: 'Previous photo', exact: true })
    .click()
  await expect(viewer.locator('.photo-viewport img')).toHaveAttribute(
    'alt',
    record.snapshot.items[99].title
  )
  await viewer.locator('.photo-viewport').focus()
  await page.keyboard.press('PageDown')
  await expect(viewer.locator('.photo-gallery-count')).toHaveText('101 / 104')
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#page-label')).toHaveText('1 / 2')
  await page.locator('#search').fill('Gallery included 105')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    1
  )
  await page.locator('#sheet-body .product-photo-button').click()
  await expect(viewer.locator('.photo-gallery-count')).toHaveText('1 / 1')
  await expect(
    viewer.getByRole('button', { name: 'Previous photo', exact: true })
  ).toBeDisabled()
  await expect(
    viewer.getByRole('button', { name: 'Next photo', exact: true })
  ).toBeDisabled()
})

test('a delayed previous photo cannot replace the newly selected photo', async ({
  extension,
}) => {
  const { page, record } = await workspace(extension)
  await expect(
    page.locator('#sheet-body .product-photo-button img').first()
  ).toHaveAttribute('src', /^data:/)
  await page.evaluate((url) => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime)
    chrome.runtime.sendMessage = async (...args) => {
      const result = await send(...args)
      if (args[0]?.type === 'IMAGE_GET' && args[0].url === url)
        await new Promise((resolve) => {
          window.releaseGalleryPhoto = resolve
        })
      return result
    }
  }, record.snapshot.items[0].thumbnail)
  await page.locator('#sheet-body .product-photo-button').first().click()
  const viewer = page.getByRole('dialog', {
    name: 'Product photo',
    exact: true,
  })
  await expect
    .poll(() => page.evaluate(() => typeof window.releaseGalleryPhoto))
    .toBe('function')
  await viewer.getByRole('button', { name: 'Next photo', exact: true }).click()
  const image = viewer.locator('.photo-viewport img')
  await expect(image).toBeVisible()
  await expect(image).toHaveAttribute('src', record.snapshot.items[1].thumbnail)
  await page.evaluate(async () => {
    window.releaseGalleryPhoto()
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    )
  })
  await expect(image).toHaveAttribute('src', record.snapshot.items[1].thumbnail)
  await expect(viewer.locator('.photo-viewer-caption')).toHaveText(
    record.snapshot.items[1].title
  )
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(viewer.locator('.photo-zoom-value')).toHaveText('150%')
  await viewer.getByRole('button', { name: 'Next photo', exact: true }).click()
  await expect(image).toHaveAttribute('src', record.snapshot.items[2].thumbnail)
  await expect(viewer.locator('.photo-zoom-value')).toHaveText('100%')
})

test('packing gallery includes only its launched products and navigation uses the selected UI language', async ({
  extension,
}) => {
  const { page, record } = await workspace(extension)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await rows.first().focus()
  await rows.first().press('Space')
  await rows.nth(2).focus()
  await rows.nth(2).press('Control+Space')
  await page.locator('#prepare-orders').click()
  const review = page.getByRole('dialog', {
    name: 'Assign product codes?',
    exact: true,
  })
  await expect(review).toBeVisible()
  await review
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const packing = page.locator('#packing-view')
  await expect(packing.locator('.preparation-group')).toHaveCount(2)
  await page.locator('#language-toggle [data-language=es]').click()
  await packing.locator('.variant-photos .preparation-photo').first().click()
  const viewer = page.locator('.product-photo-dialog')
  await expect(viewer.locator('.photo-gallery-count')).toHaveText('1 / 2')
  await viewer
    .getByRole('button', { name: 'Foto siguiente', exact: true })
    .click()
  await expect(viewer.locator('.photo-viewport img')).toHaveAttribute(
    'alt',
    record.snapshot.items[2].title
  )
  await expect(viewer.locator('.photo-gallery-count')).toHaveText('2 / 2')
  await expect(
    viewer.getByRole('button', { name: 'Foto siguiente', exact: true })
  ).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(packing).toBeVisible()
})

test('packing photo identity stays with the clicked order when entry IDs repeat across orders', async ({
  extension,
}) => {
  const { page, records } = await workspace(extension, 2, (record) => {
    const second = structuredClone(record)
    second.snapshot.orderId = String(BigInt(record.snapshot.orderId) + 1n)
    second.snapshot.sourceUrl = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${second.snapshot.orderId}`
    second.snapshot.sellerName = 'Second synthetic photo supplier'
    second.snapshot.sellerMemberLogin = 'synthetic-photos-second'
    second.snapshot.sellerShopOrigin =
      'https://synthetic-photos-second.1688.com'
    second.snapshot.items = second.snapshot.items.map((item, index) => ({
      ...item,
      title: `第二家合成图片商品 ${index + 1}`,
      thumbnail: record.snapshot.items[1 - index].thumbnail,
    }))
    return [record, second]
  })
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  const tableKey = await rows.nth(2).getAttribute('data-selection-key'),
    tableOrder = records.find((record) =>
      tableKey.startsWith(`${record.snapshot.orderId}/`)
    )
  await rows
    .nth(2)
    .getByRole('button', { name: /^Zoom product photo/ })
    .click()
  const viewer = page.locator('.product-photo-dialog'),
    image = viewer.locator('.photo-viewport img')
  await expect(viewer.locator('.photo-gallery-count')).toHaveText('3 / 4')
  await expect(image).toHaveAttribute('alt', tableOrder.snapshot.items[0].title)
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await rows.first().focus()
  await rows.first().press('Control+a')
  await page.locator('#prepare-orders').click()
  await page
    .getByRole('dialog', { name: 'Assign product codes?', exact: true })
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const sections = page.locator('.packing-order-section')
  await expect(sections).toHaveCount(2)
  const orderIds = await sections.evaluateAll((elements) =>
    elements.map((element) => element.dataset.packingOrder)
  )
  const firstOrder = records.find(
      (record) => record.snapshot.orderId === orderIds[0]
    ),
    clickedOrder = records.find(
      (record) => record.snapshot.orderId === orderIds[1]
    ),
    selectedBefore = await page
      .locator('#packing-view [aria-selected=true]')
      .count()
  await sections
    .nth(1)
    .locator('.variant-photos .preparation-photo')
    .first()
    .click()
  await expect(viewer.locator('.photo-gallery-count')).toHaveText('3 / 4')
  await expect(image).toHaveAttribute(
    'alt',
    clickedOrder.snapshot.items[0].title
  )
  await expect(image).toHaveAttribute(
    'src',
    clickedOrder.snapshot.items[0].thumbnail
  )
  await viewer
    .getByRole('button', { name: 'Previous photo', exact: true })
    .click()
  await expect(viewer.locator('.photo-gallery-count')).toHaveText('2 / 4')
  await expect(image).toHaveAttribute('alt', firstOrder.snapshot.items[1].title)
  await expect(image).toHaveAttribute(
    'src',
    firstOrder.snapshot.items[1].thumbnail
  )
  await viewer.getByRole('button', { name: 'Next photo', exact: true }).click()
  await expect(image).toHaveAttribute(
    'alt',
    clickedOrder.snapshot.items[0].title
  )
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  expect(await page.locator('#packing-view [aria-selected=true]').count()).toBe(
    selectedBefore
  )
})
