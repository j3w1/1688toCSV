import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  assignSelectedPurchaseCodes,
  editOrderProduct,
} from './smart-workspace-helpers.mjs'

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

test('photo navigation follows the full filtered table through continuous scrolling, skips missing photos and leaves selection intact', async ({
  extension,
}) => {
  const { page, record } = await workspace(extension, 106)
  await page.locator('#search').fill('Gallery included')
  await expect(page.locator('#selection-summary')).toContainText('105 rows')
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(100)
  // Focus scrolls this row into view and may recycle the surrounding window.
  // Keep the identity captured before focus rather than following last().
  const rowKey = await rows.last().getAttribute('data-selection-key')
  const row = page.locator(`#sheet-body tr[data-selection-key="${rowKey}"]`)
  await row.focus()
  await row.getByRole('checkbox').check()
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
  await page.keyboard.press('ArrowLeft')
  await expect(viewer.locator('.photo-gallery-count')).toHaveText('100 / 104')
  await expect(viewer.locator('.photo-viewport img')).toHaveAttribute(
    'alt',
    record.snapshot.items[99].title
  )
  await page.keyboard.press('ArrowRight')
  await expect(viewer.locator('.photo-gallery-count')).toHaveText('101 / 104')
  await page.keyboard.press('PageUp')
  await expect(viewer.locator('.photo-gallery-count')).toHaveText('100 / 104')
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await expect(row.locator('.row-number')).toHaveText('100')
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
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowRight')
  await expect(viewer.locator('.photo-gallery-count')).toHaveText('1 / 1')
})

test('photo arrow shortcuts work from viewer controls, ignore modified and editing keys, and preserve source detail scope', async ({
  extension,
}) => {
  const { page, record } = await workspace(extension)
  await page
    .locator('#sheet-body tr[data-selection-key]')
    .first()
    .press('Enter')
  const details = page.getByRole('dialog', {
    name: 'Original product details',
    exact: true,
  })
  await details
    .getByRole('button', { name: 'Open product photo', exact: true })
    .click()
  const viewer = page.locator('.product-photo-dialog'),
    image = viewer.locator('.photo-viewport img'),
    value = viewer.locator('.photo-zoom-value'),
    counter = viewer.locator('.photo-gallery-count')
  await expect(image).toBeVisible()
  await expect(counter).toHaveText('1 / 3')
  await expect(
    viewer.getByRole('button', { name: 'Close product photo' })
  ).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(counter).toHaveText('2 / 3')
  await expect(image).toHaveAttribute('alt', record.snapshot.items[1].title)
  await expect(value).toHaveText('100%')
  await page.keyboard.press('ArrowUp')
  await expect(value).toHaveText('150%')
  await page.keyboard.press('ArrowDown')
  await expect(value).toHaveText('100%')
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    // Dispatch browser events without activating operating-system shortcuts.
    await viewer.dispatchEvent('keydown', {
      key: 'ArrowRight',
      [modifier]: true,
    })
    await viewer.dispatchEvent('keydown', {
      key: 'ArrowUp',
      [modifier]: true,
    })
  }
  await expect(counter).toHaveText('2 / 3')
  await expect(value).toHaveText('100%')
  for (const tag of ['input', 'textarea', 'select', 'div']) {
    await viewer.evaluate((dialog, tag) => {
      const editor = document.createElement(tag)
      editor.dataset.testEditor = 'true'
      if (tag === 'div') editor.contentEditable = 'true'
      dialog.querySelector('.photo-viewer-frame').append(editor)
      editor.focus()
    }, tag)
    const editor = viewer.locator('[data-test-editor]')
    for (const key of ['ArrowRight', 'ArrowUp', 'PageDown', '+', '0'])
      await editor.dispatchEvent('keydown', { key })
    await expect(counter).toHaveText('2 / 3')
    await expect(value).toHaveText('100%')
    await editor.evaluate((element) => element.remove())
  }
  await viewer.locator('.photo-viewport').focus()
  await page.keyboard.press('ArrowLeft')
  await expect(counter).toHaveText('1 / 3')
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await expect(details).toBeVisible()
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

test('Orders authoring gallery includes only its explicit product selection and navigation uses the selected UI language', async ({
  extension,
}) => {
  const { page, record } = await workspace(extension)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await rows.first().getByRole('checkbox').check()
  await rows.nth(2).getByRole('checkbox').check()
  await assignSelectedPurchaseCodes(page)
  await page.locator('#language-toggle [data-language=es]').click()
  const packing = await editOrderProduct(page, 0)
  await packing.locator('.preparation-photo').first().click()
  const viewer = page.locator('.product-photo-dialog')
  await expect(viewer.locator('.photo-gallery-count')).toHaveText('1 / 2')
  await page.keyboard.press('ArrowRight')
  await expect(viewer.locator('.photo-viewport img')).toHaveAttribute(
    'alt',
    record.snapshot.items[2].title
  )
  await expect(viewer.locator('.photo-gallery-count')).toHaveText('2 / 2')
  await expect(
    viewer.getByRole('button', { name: 'Foto siguiente', exact: true })
  ).toBeDisabled()
  await expect(viewer.locator('.photo-viewer-status')).toContainText(
    '← / → fotos · ↑ / ↓ o + / −'
  )
  await page.keyboard.press('ArrowUp')
  await expect(viewer.locator('.photo-zoom-value')).toHaveText('150%')
  await page.keyboard.press('ArrowDown')
  await expect(viewer.locator('.photo-zoom-value')).toHaveText('100%')
  await page.keyboard.press('ArrowLeft')
  await expect(viewer.locator('.photo-gallery-count')).toHaveText('1 / 2')
  await page.keyboard.press('Escape')
  await expect(packing).toBeVisible()
})

test('Orders authoring photo identity stays with the clicked order when entry IDs repeat across orders', async ({
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
    tableOrder = records.find(
      (record) => JSON.parse(tableKey)[1] === record.snapshot.orderId
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
  await assignSelectedPurchaseCodes(page)
  const orderIds = await rows.evaluateAll((elements) => [
    ...new Set(
      elements.map((element) => JSON.parse(element.dataset.selectionKey)[1])
    ),
  ])
  const firstOrder = records.find(
      (record) => record.snapshot.orderId === orderIds[0]
    ),
    clickedOrder = records.find(
      (record) => record.snapshot.orderId === orderIds[1]
    ),
    selectedBefore = await page
      .locator('#sheet-body tr[aria-selected=true]')
      .count(),
    editor = await editOrderProduct(page, 2)
  await editor.locator('.preparation-photo').first().click()
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
  expect(await page.locator('#sheet-body tr[aria-selected=true]').count()).toBe(
    selectedBefore
  )
})
