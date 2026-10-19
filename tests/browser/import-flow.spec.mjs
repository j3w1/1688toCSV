import { test, expect } from './extension-fixture.mjs'
import { revealCopyActions } from './copy-actions-helpers.mjs'
import { buildOrderFixture } from '../fixtures/order-fixture.mjs'
import { readFile } from 'node:fs/promises'

test.use({ importFlow: true })

const origin = 'https://air.1688.test'
const listUrl = `${origin}/app/ctf-page/trade-order-list/buyer-order-list.html`
const detailUrl = (id) =>
  `${origin}/app/ctf-page/trade-order-detail/index.html?orderId=${id}`
const ids = ['9990000000000000001', '9990000000000000002']

// All pages are synthetic and fulfilled in-process; no requests reach 1688.
function completeOrder(
  document,
  orderId,
  {
    summary = '2.40',
    customization = false,
    redPacket = false,
    shopDiscount = false,
    promotionDiscount = false,
    includedCustomization = false,
    freeShippingBadge = false,
    foreignFee = false,
    includedDiscounts = false,
    unsignedAdjustment = false,
    missingSeller = false,
    unsupported = false,
  } = {}
) {
  const built = buildOrderFixture(
    document,
    missingSeller ? { sellerName: null } : {}
  )
  if (freeShippingBadge) {
    for (const cell of built.cells) {
      const badge = document.createElement('span')
      badge.className = 'order-table-discount-item-price'
      badge.textContent = ' 包邮 '
      cell.discount.root.append(badge)
    }
  }
  const app = built.appRoot.shadowRoot
  const field = document.createElement('div')
  field.className = 'order-info-receipt-content-item'
  field.innerHTML = `<span class="field-name">订单号：</span><span>${orderId}</span>`
  built.orderInfo.shadowRoot.append(field)
  const status = document.createElement('div')
  status.className = 'step-detail-header'
  status.innerHTML = '<span class="stress">交易已成功</span>'
  app.append(status)
  built.cells.forEach((cell, index) => {
    const anchor = cell.goods.root
      .querySelector('goods-content')
      .shadowRoot.querySelector('a')
    anchor.href = `https://trade.1688.test/order/offer_snapshot.htm?order_entry_id=${orderId}${index}`
  })
  const totals = document.createElement('order-total-price')
  const payable = (
    (6800 +
      (unsignedAdjustment ? 190 : 0) +
      (customization ? 1250 : 0) -
      (redPacket ? 125 : 0) -
      (shopDiscount || promotionDiscount ? 160 : 0)) /
    100
  )
    .toFixed(2)
    .split('.')
  totals.attachShadow({ mode: 'open' }).innerHTML = `
    <div class="detail-price">
      <dl><dt>原价总计</dt><dd>¥${includedCustomization ? '78.50' : includedDiscounts ? '86.00' : '66.00'}</dd></dl>
      <dl><dt>运费</dt><dd>¥4.40</dd></dl>
      <dl><dt>商品优惠</dt><dd>减 ¥${includedDiscounts ? '1.00' : '2.40'}</dd></dl>
      ${includedDiscounts ? '<dl><dt>批发优惠</dt><dd>减 ¥20.00</dd></dl><dl><dt>商品改价</dt><dd>减 ¥1.40</dd></dl>' : ''}
      ${unsignedAdjustment ? '<dl><dt>商品改价</dt><dd>¥1.90</dd></dl>' : ''}
      ${customization ? '<dl><dt>定制服务</dt><dd>¥12.50</dd></dl>' : ''}
      ${redPacket ? '<dl><dt>红包</dt><dd>减 ¥1.25</dd></dl>' : ''}
      ${shopDiscount ? '<dl><dt>店铺优惠</dt><dd>减 ¥1.60</dd></dl>' : ''}
      ${promotionDiscount ? '<dl><dt>活动优惠</dt><dd>减 ¥1.60</dd></dl>' : ''}
      ${foreignFee ? '<dl><dt>外币支付手续费</dt><dd>（≈）</dd></dl>' : ''}
      ${unsupported ? '<dl><dt>未知费用</dt><dd>¥1.11</dd></dl>' : ''}
    </div><div class="total-discount">2.40</div>
    <div class="total-sum-pay"><!--?lit$8321$--><span class="sum-pay-label">实付款</span><!--amount:start--><span class="fd-cny">¥</span><!--?lit$8321$-->${payable[0]}.<span class="sub-ammount">${payable[1]}</span><!--amount:end--></div>`
  app.append(totals)
  totals.shadowRoot.querySelector('.total-discount').textContent = summary
}

async function setup(
  extension,
  {
    delay = 0,
    summary = '2.40',
    customization = false,
    redPacket = false,
    shopDiscount = false,
    promotionDiscount = false,
    includedCustomization = false,
    freeShippingBadge = false,
    foreignFee = false,
    includedDiscounts = false,
    unsignedAdjustment = false,
    missingSeller = false,
    unsupportedIds = [],
    purchaseTimes = {},
    beforeDetail,
  } = {}
) {
  const visited = []
  await extension.context.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    let body
    if (url.pathname.includes('trade-order-list')) {
      body = `<order-app><q-pagination data-tracker="pagination-order-list" current="1" pagesize="10" total="2"></q-pagination>${ids
        .map(
          (id) => `
        <order-item data-tracker-args="orderId=${id}">
          ${purchaseTimes[id] ? `<span class="order-time">${purchaseTimes[id]}</span>` : ''}
          <a class="order-detail-action" href="${detailUrl(id)}">Detail</a>
          <q-checkbox data-tracker="checkbox-order-item" checked></q-checkbox>
          <div class="order-item-entry"></div><div class="order-item-entry"></div>
        </order-item>`
        )
        .join('')}</order-app>`
    } else {
      const id = url.searchParams.get('orderId')
      visited.push(id)
      await beforeDetail?.(id)
      body = `<script>
        ${buildOrderFixture.toString()}
        ${completeOrder.toString()}
        setTimeout(() => completeOrder(document, ${JSON.stringify(id)}, ${JSON.stringify({ summary, customization, redPacket, shopDiscount, promotionDiscount, includedCustomization, freeShippingBadge, foreignFee, includedDiscounts, unsignedAdjustment, missingSeller, unsupported: unsupportedIds.includes(id) })}), ${typeof delay === 'object' ? delay[id] || 0 : delay});
      </script>`
    }
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><title>Synthetic import</title><body>${body}</body></html>`,
    })
  })
  const list = await extension.context.newPage()
  await list.goto(listUrl)
  const library = await extension.context.newPage()
  await library.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await library.goto(`${extension.extensionBaseUrl}/library.html`)
  return { list, library, visited }
}

async function expandOrderMonths(library) {
  // Undated and historical imports start collapsed; open them before details.
  for (const month of await library
    .locator('.month-toggle[aria-expanded=false]')
    .all())
    await month.click()
}

test('each imported order appears immediately in purchase order without resetting filters or selection', async ({
  extension,
}) => {
  const secondDetail = Promise.withResolvers()
  const { list, library } = await setup(extension, {
    purchaseTimes: {
      [ids[0]]: '2026-10-17 08:30:00',
      [ids[1]]: '2026-10-17 14:15:00',
    },
    beforeDetail: (id) => (id === ids[1] ? secondDetail.promise : undefined),
  })
  try {
    await list
      .getByRole('button', { name: 'Import selected', exact: true })
      .click()
    await list
      .getByRole('button', { name: 'Import 2 selected orders', exact: true })
      .click()
    const rows = library.locator('#sheet-body tr[data-selection-key]')
    await expect(rows).toHaveCount(2, { timeout: 65000 })
    await expect(library.locator('.order-card')).toHaveCount(1)
    await library.locator('#select-rows').click()
    await library.getByLabel('Packing month', { exact: true }).fill('2026-10')
    await library.locator('#prepare-orders').click()
    await library
      .getByRole('button', { name: 'Assign codes and prepare', exact: true })
      .click()
    const packing = library.locator('#packing-view')
    await expect(packing.locator('.preparation-save-status')).toHaveText(
      'Saved automatically'
    )
    await packing.page().locator('#view-orders').click()
    // Preserve a real filter and an existing selection while the second order
    // commits. No page reload or import completion is needed to render it.
    const status = await library
      .locator('#status-filter option')
      .nth(1)
      .getAttribute('value')
    await library.locator('#status-filter').selectOption(status)
    await rows.first().focus()
    await library.keyboard.press('Space')
    const selected = await library
      .locator('#sheet-body tr[aria-selected=true]')
      .getAttribute('data-selection-key')
    secondDetail.resolve()
    await expect(rows).toHaveCount(4, { timeout: 65000 })
    await expect(library.locator('#status-filter')).toHaveValue(status)
    await expect(
      library.locator(`#sheet-body tr[data-selection-key="${selected}"]`)
    ).toHaveAttribute('aria-selected', 'true')
    const orderKeys = await library
      .locator('.order-card')
      .evaluateAll((cards) => cards.map((card) => card.dataset.selectionKey))
    expect(orderKeys).toEqual([ids[1], ids[0]])
    expect(
      await rows.evaluateAll((elements) =>
        elements.map((row) => row.dataset.selectionKey.split('/')[0])
      )
    ).toEqual([ids[1], ids[1], ids[0], ids[0]])
    expect(extension.unexpectedRequests).toEqual([])
  } finally {
    secondDetail.resolve()
  }
})

test('1688 list and detail controls follow saved workspace palettes and mode without an open workspace', async ({
  extension,
}) => {
  const { list, library } = await setup(extension)
  const detail = await extension.context.newPage()
  await detail.goto(detailUrl(ids[0]))
  await list.emulateMedia({ colorScheme: 'light' })
  await detail.emulateMedia({ colorScheme: 'light' })
  const listPanel = list.getByRole('complementary', {
    name: '1688 order library',
    exact: true,
  })
  const detailPanel = detail.getByRole('complementary', {
    name: '1688toCSV',
    exact: true,
  })
  for (const panel of [listPanel, detailPanel])
    await expect(panel).toHaveCSS('background-color', 'rgb(36, 33, 29)')
  await library.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = library.getByRole('dialog', {
    name: 'Settings',
    exact: true,
  })
  await settings.getByRole('tab', { name: 'Appearance', exact: true }).click()
  await settings
    .getByLabel('Light palette', { exact: true })
    .selectOption('1688')
  await settings
    .getByLabel('Dark palette', { exact: true })
    .selectOption('terracotta')
  await settings
    .getByRole('button', { name: 'Save settings', exact: true })
    .click()
  await expect(settings).not.toBeVisible()
  for (const panel of [listPanel, detailPanel]) {
    await expect(panel).toHaveCSS('background-color', 'rgb(45, 34, 30)')
    await expect(panel).toHaveCSS('color', 'rgb(243, 238, 229)')
    await expect(panel).toHaveCSS('color-scheme', 'dark')
  }
  await library.getByRole('button', { name: 'Switch to light theme' }).click()
  await list.emulateMedia({ colorScheme: 'dark' })
  await detail.emulateMedia({ colorScheme: 'dark' })
  for (const panel of [listPanel, detailPanel]) {
    await expect(panel).toHaveCSS('background-color', 'rgb(255, 252, 248)')
    await expect(panel).toHaveCSS('color', 'rgb(44, 39, 35)')
    await expect(panel).toHaveCSS('color-scheme', 'light')
  }
  await expect(
    listPanel.getByRole('button', { name: 'Import selected', exact: true })
  ).toHaveCSS('background-color', 'rgb(183, 71, 13)')
  await expect(
    detailPanel.getByRole('link', { name: 'Download CSV', exact: true })
  ).toHaveCSS('background-color', 'rgb(183, 71, 13)')
  await library.close()
  await list.reload()
  await detail.reload()
  for (const panel of [listPanel, detailPanel]) {
    await expect(panel).toHaveCSS('background-color', 'rgb(255, 252, 248)')
    await expect(panel).toHaveCSS('color-scheme', 'light')
  }
  const saved = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'WORKSPACE_APPEARANCE_GET' })
  )
  expect(saved.ok, saved.error).toBe(true)
  expect(saved.data.colorScheme).toBe('light')
  expect(saved.data.dark.surface).toBe('#2d221e')
  expect(extension.unexpectedRequests).toEqual([])
})

async function assertImported(extension, library) {
  await expect(library.locator('#order-count')).toHaveText('2', {
    timeout: 65_000,
  })
  await expect(
    library.locator('#sheet-body tr[data-selection-key]')
  ).toHaveCount(4)
  await expandOrderMonths(library)
  await library.getByRole('button', { name: /^Activity/ }).click()
  await expect(library.locator('#jobs')).toContainText('completed')
  await library
    .getByRole('button', { name: 'Close activity', exact: true })
    .click()
  await revealCopyActions(library)
  await expect(
    library.getByRole('checkbox', { name: 'Headers', exact: true })
  ).not.toBeChecked()
  await library.getByRole('checkbox', { name: 'Headers', exact: true }).check()
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await library
    .getByRole('button', { name: 'Copy values', exact: true })
    .click()
  await expect(library.locator('#copy-values')).toHaveText('Copied')
  const copied = await library.evaluate(() => navigator.clipboard.readText())
  expect(copied.split('\r\n')).toHaveLength(5)
  expect(copied).toContain('2.10')
  expect(copied).toContain('0.30')
  expect(extension.unexpectedRequests).toEqual([])
}

test('missing sellers import products but require identification before label preparation', async ({
  extension,
}) => {
  const { list, library } = await setup(extension, { missingSeller: true })
  await list
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  await list
    .getByRole('button', { name: 'Import 2 selected orders', exact: true })
    .click()
  await assertImported(extension, library)
  const { data } = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'LIBRARY_QUERY' })
  )
  expect(
    data.orders.every(
      ({ snapshot }) =>
        snapshot.sellerUnavailable && snapshot.items.length === 2
    )
  ).toBe(true)
  await library.locator('.order-card-meta').first().dblclick()
  await expect(library.locator('#order-details')).toContainText(
    'Products and totals are saved'
  )
  await library
    .getByRole('button', { name: 'Close order details', exact: true })
    .click()
  await library.getByRole('button', { name: 'Show all', exact: true }).click()
  await library.locator('.order-card-meta').first().click()
  await library.locator('#select-rows').click()
  await library.locator('#prepare-orders').click()
  await library
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const dialog = library.locator('#packing-view')
  const seller = dialog.getByLabel('Seller member login (required)', {
    exact: true,
  })
  await expect(seller).toHaveValue('')
  await dialog
    .getByLabel('Spanish short name', { exact: true })
    .first()
    .fill('PRODUCTO')
  await dialog.page().locator('#view-orders').click()
  await expect(seller).toBeFocused()
  await expect(dialog.locator('.error-notice-message')).toContainText(
    'Enter the seller member login'
  )
  await expect(
    dialog.getByLabel('Product code', { exact: true }).first()
  ).toHaveValue('')
  await dialog
    .getByRole('button', { name: 'Discard pending edits', exact: true })
    .click()
  await expect(
    library.getByRole('dialog', { name: 'Confirm operation', exact: true })
  ).not.toBeVisible()
  await dialog.page().locator('#view-orders').click()
  await expect(dialog).not.toBeVisible()
  await library.locator('#prepare-orders').click()
  await library
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  await seller.fill('identified-synthetic-shop')
  await expect(dialog.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  await expect(
    dialog.getByLabel('Product code', { exact: true }).first()
  ).toHaveValue(/^CE\d{8}$/)
  await expect(dialog.locator('.preparation-save-status')).not.toHaveClass(
    /packing-error/
  )
  await library.reload()
  await library.locator('#prepare-orders').click()
  await expect(seller).toHaveValue('identified-synthetic-shop')
  await dialog.page().locator('#view-orders').click()
  await library.getByRole('button', { name: 'Show all', exact: true }).click()
  await expandOrderMonths(library)
  await library.locator('.order-card-meta').nth(1).click()
  await library.locator('#select-rows').click()
  await library.locator('#prepare-orders').click()
  await library
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  await expect(seller).toHaveValue('')
  await expect(
    dialog.getByLabel('Product code', { exact: true }).first()
  ).toHaveValue('')
})

test('unsigned price increases import only after totals reconcile and remain valid in backup', async ({
  extension,
}) => {
  const { list, library } = await setup(extension, { unsignedAdjustment: true })
  await list
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  await list
    .getByRole('button', { name: 'Import 2 selected orders', exact: true })
    .click()
  await expect(library.locator('#order-count')).toHaveText('2', {
    timeout: 65000,
  })
  const { data } = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'LIBRARY_QUERY' })
  )
  for (const { snapshot } of data.orders) {
    expect(snapshot.totals).toMatchObject({
      sourceDiscount: '2.40',
      orderAdjustment: '-1.90',
      goodsNet: '65.50',
      payable: '69.90',
    })
    expect(snapshot.items.map((item) => item.allocatedDiscount)).toEqual([
      '-1.43',
      '-0.47',
    ])
  }
  const backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(backup.ok, backup.error).toBe(true)
  expect(extension.unexpectedRequests).toEqual([])
})

test('wholesale prices and embedded adjustments import without double deductions in Excel copying', async ({
  extension,
}) => {
  const { list, library } = await setup(extension, {
    includedDiscounts: true,
    summary: '21.00',
  })
  await list
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  await list
    .getByRole('button', { name: 'Import 2 selected orders', exact: true })
    .click()
  await assertImported(extension, library)
  const { data } = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'LIBRARY_QUERY' })
  )
  for (const { snapshot } of data.orders) {
    expect(snapshot.totals).toMatchObject({
      goodsGross: '86.00',
      priceIncludedDiscount: '20.00',
      sourceDiscount: '2.40',
      orderAdjustment: '1.40',
      rowIncludedAdjustment: '1.40',
      goodsNet: '63.60',
      payable: '68.00',
    })
    expect(snapshot.items.map((item) => item.allocatedDiscount)).toEqual([
      '0.00',
      '0.00',
    ])
    expect(snapshot.items.map((item) => item.discount)).toEqual([
      '2.10',
      '0.30',
    ])
  }
  await library.locator('.order-card-meta').first().dblclick()
  await expect(library.locator('#order-details')).toContainText(
    'Wholesale discount (already in prices)'
  )
  await expect(library.locator('#order-details')).toContainText(
    'Order adjustment (already in product discounts)'
  )
})

test('legacy promotions, free-shipping badges and included customization import with unchanged product copies', async ({
  extension,
}) => {
  const { list, library } = await setup(extension, {
    promotionDiscount: true,
    customization: true,
    includedCustomization: true,
    freeShippingBadge: true,
    summary: '4.00',
  })
  await list
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  await list
    .getByRole('button', { name: 'Import 2 selected orders', exact: true })
    .click()
  await assertImported(extension, library)
  const { data } = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'LIBRARY_QUERY' })
  )
  for (const { snapshot } of data.orders) {
    expect(snapshot.totals).toMatchObject({
      goodsGross: '78.50',
      grossIncludedCustomization: '12.50',
      customizationService: '12.50',
      sourceDiscount: '2.40',
      orderDiscount: '1.60',
      goodsNet: '62.00',
      payable: '78.90',
    })
    expect(snapshot.items.map((item) => item.discount)).toEqual([
      '2.10',
      '0.30',
    ])
    expect(snapshot.items.map((item) => item.allocatedDiscount)).toEqual([
      '0.00',
      '0.00',
    ])
  }
  await library.locator('.order-card-meta').first().dblclick()
  await expect(library.locator('#order-details')).toContainText(
    'Original total (includes customization)'
  )
  await expect(library.locator('#order-details')).toContainText(
    'Order-only discount'
  )
})

test('order-only shop discounts and unspecified foreign fees import without changing copied product discounts', async ({
  extension,
}) => {
  const { list, library } = await setup(extension, {
    shopDiscount: true,
    foreignFee: true,
    redPacket: true,
    summary: '优惠共5.25元',
  })
  await list
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  await list
    .getByRole('button', { name: 'Import 2 selected orders', exact: true })
    .click()
  await assertImported(extension, library)
  const { data } = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'LIBRARY_QUERY' })
  )
  for (const { snapshot } of data.orders) {
    expect(snapshot.foreignCurrencyFeeUnspecified).toBe(true)
    expect(snapshot.totals.orderDiscount).toBe('1.60')
    expect(snapshot.totals.sourceDiscount).toBe('2.40')
    expect(snapshot.totals.redPacketDiscount).toBe('1.25')
    expect(snapshot.totals.goodsNet).toBe('62.00')
    expect(snapshot.totals.payable).toBe('65.15')
    expect(snapshot.items.map((item) => item.discount)).toEqual([
      '2.10',
      '0.30',
    ])
    expect(snapshot.items.map((item) => item.allocatedDiscount)).toEqual([
      '0.00',
      '0.00',
    ])
  }
  await library.locator('.order-card-meta').first().dblclick()
  await expect(library.locator('#order-details')).toContainText(
    'Order-only discount'
  )
  await expect(library.locator('#order-details')).toContainText('¥ −1.60')
  await expect(library.locator('#order-details')).toContainText(
    'Foreign-currency payment fee: amount not shown by the page.'
  )
})

test('red-packet payment reduction imports separately alongside customization and product discounts', async ({
  extension,
}) => {
  const { list, library } = await setup(extension, {
    customization: true,
    redPacket: true,
    summary: '优惠共3.65元',
  })
  await list
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  await list
    .getByRole('button', { name: 'Import 2 selected orders', exact: true })
    .click()
  await assertImported(extension, library)
  const { data } = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'LIBRARY_QUERY' })
  )
  for (const { snapshot } of data.orders) {
    expect(snapshot.totals.redPacketDiscount).toBe('1.25')
    expect(snapshot.totals.customizationService).toBe('12.50')
    expect(snapshot.totals.payable).toBe('79.25')
    expect(snapshot.totals.goodsNet).toBe('63.60')
    expect(snapshot.items.map((item) => item.discount)).toEqual([
      '2.10',
      '0.30',
    ])
  }
  await library.locator('.order-card-meta').first().dblclick()
  await expect(library.locator('#order-details')).toContainText(
    'Red-packet discount (payment only)'
  )
  await expect(library.locator('#order-details')).toContainText('¥ −1.25')
})

test('unsupported totals promptly retain bounded financial evidence, continue other orders and survive successful retry in a report', async ({
  extension,
}) => {
  const unsupportedIds = [ids[0]]
  const { list, library, visited } = await setup(extension, { unsupportedIds })
  await list
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  await list
    .getByRole('button', { name: 'Import 2 selected orders', exact: true })
    .click()
  await library.getByRole('button', { name: /^Activity/ }).click()
  // A known unsupported label is terminal; it must not spend 45 seconds in hydration retries.
  await expect(library.locator('#jobs')).toContainText(
    'Finished · some orders need attention',
    { timeout: 12000 }
  )
  await expect(library.locator('#order-count')).toHaveText('1')
  const before = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
  )
  expect(before.data.jobs[0].orders[0].lastFailure).toBeUndefined()
  const failure = await extension.inspector.evaluate(
    (jobId) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('1688-order-library')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('jobs', 'readonly')
          const result = tx.objectStore('jobs').get(jobId)
          tx.oncomplete = () => {
            db.close()
            resolve(result.result.orders[0].lastFailure)
          }
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
        }
      }),
    before.data.jobs[0].id
  )
  expect(failure.message).toContain('未知费用')
  expect(failure.diagnostics.fields).toContainEqual({
    label: '未知费用',
    value: '¥1.11',
  })
  expect(failure.diagnostics.products.gross).toBe('66.00')
  expect(failure.diagnostics.products.discount).toBe('2.40')
  expect(failure.diagnostics.products.count).toBe(2)
  expect(failure.diagnostics.products.sample[0].discount).toBe('2.10')
  expect(failure.diagnostics.payable).toContain('68.00')
  expect(JSON.stringify(failure)).not.toMatch(/<html|sellerName|thumbnail|sku/)
  const listDownload = list.waitForEvent('download')
  await list
    .getByRole('button', { name: 'Save import report', exact: true })
    .click()
  expect(await (await listDownload).failure()).toBeNull()
  const listFiles = await extension.inspector.evaluate(() =>
    chrome.downloads.search({})
  )
  const listReport = JSON.parse(await readFile(listFiles[0].filename, 'utf8'))
  expect(listReport.counts).toMatchObject({
    discovered: 2,
    saved: 1,
    failed: 1,
  })
  expect(listReport.orders[0].lastFailure).toEqual(failure)
  expect(
    await extension.inspector.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
    )
  ).toEqual(before)
  expect(visited).toEqual(ids)
  unsupportedIds.length = 0
  await library
    .getByRole('button', { name: 'Resume / retry', exact: true })
    .click()
  await expect(library.locator('#order-count')).toHaveText('2', {
    timeout: 12000,
  })
  await expect
    .poll(
      async () =>
        (
          await extension.inspector.evaluate(() =>
            chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
          )
        ).data.jobs[0].state
    )
    .toBe('completed')
  expect(visited).toEqual([...ids, ids[0]])
  const downloaded = library.waitForEvent('download')
  await library
    .getByRole('button', { name: 'Save import report', exact: true })
    .click()
  expect(await (await downloaded).failure()).toBeNull()
  const downloads = await extension.inspector.evaluate(() =>
    chrome.downloads.search({})
  )
  const latest = downloads.reduce((a, b) => (a.id > b.id ? a : b))
  const report = JSON.parse(await readFile(latest.filename, 'utf8'))
  expect(report.counts.saved).toBe(2)
  expect(report.counts.failed).toBe(0)
  expect(report.orders[0].lastFailure).toEqual(failure)
  expect(extension.unexpectedRequests).toEqual([])
})

test('customization services survive complete import without changing copied product discounts', async ({
  extension,
}) => {
  test.setTimeout(80_000)
  const { list, library } = await setup(extension, { customization: true })
  await list
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  await list
    .getByRole('button', { name: 'Import 2 selected orders', exact: true })
    .click()
  await assertImported(extension, library)
  const result = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'LIBRARY_QUERY' })
  )
  expect(result.ok).toBe(true)
  for (const record of result.data.orders) {
    expect(record.snapshot.totals.customizationService).toBe('12.50')
    expect(record.snapshot.totals.payable).toBe('80.50')
    expect(record.snapshot.totals.goodsNet).toBe('63.60')
  }
  await library.locator('.order-card-meta').first().dblclick()
  await expect(library.locator('#order-details')).toContainText(
    'Customization service'
  )
  await expect(library.locator('#order-details')).toContainText('¥ 12.50')
})

test('selected import reaches persistent spreadsheet and clipboard through real extension messaging', async ({
  extension,
}) => {
  test.setTimeout(80_000)
  const { list, library, visited } = await setup(extension)
  await list
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  await list
    .getByRole('button', { name: 'Import 2 selected orders', exact: true })
    .click()
  await assertImported(extension, library)
  expect(visited).toEqual(ids)
  await library.reload()
  await expect(library.locator('#order-count')).toHaveText('2')
  await list
    .getByRole('button', { name: 'Open Workspace', exact: true })
    .click()
  await list
    .getByRole('button', { name: 'Open Workspace here', exact: true })
    .click()
  await expect(list).toHaveURL(`${extension.extensionBaseUrl}/library.html`)
  await expect(list.locator('#order-count')).toHaveText('2')
  await expect(list.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    4
  )
  // Refresh all remains explicit even with one selected order and a text filter.
  await expandOrderMonths(list)
  await list
    .getByRole('option', { name: `Order ${ids[0]}`, exact: true })
    .locator('.order-card-meta')
    .click()
  await list
    .getByRole('combobox', { name: 'Search products and orders', exact: true })
    .fill('no matching synthetic product')
  await expect(list.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    0
  )
  await list.getByRole('button', { name: 'Settings', exact: true }).click()
  await list.getByRole('tab', { name: 'Data', exact: true }).click()
  await list
    .getByRole('button', { name: 'Refresh all orders', exact: true })
    .click()
  const refresh = list.getByRole('dialog', {
    name: 'Confirm operation',
    exact: true,
  })
  await expect(refresh).toContainText('2 orders')
  expect(visited).toHaveLength(2)
  await refresh
    .getByRole('button', { name: 'Refresh 2 orders', exact: true })
    .click()
  await expect.poll(() => visited.length, { timeout: 40_000 }).toBe(4)
  await expect(list.locator('#refresh-all')).toBeEnabled({ timeout: 20_000 })
  expect(visited.slice(2).sort()).toEqual([...ids].sort())
  await list
    .getByRole('button', { name: 'Close settings', exact: true })
    .click()
  await list
    .getByRole('combobox', { name: 'Search products and orders', exact: true })
    .clear()
  await list.getByRole('button', { name: 'Show all', exact: true }).click()
  await expect(list.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    4
  )
  expect(extension.unexpectedRequests).toEqual([])
})

test('delayed rendering and labelled discount summaries import complete products', async ({
  extension,
}) => {
  test.setTimeout(80_000)
  const { list, library } = await setup(extension, {
    delay: 1_000,
    summary: '优惠共 2.40 元',
  })
  await list
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  await list
    .getByRole('button', { name: 'Import 2 selected orders', exact: true })
    .click()
  await assertImported(extension, library)
})

test('reader and Activity show durable collection progress while hydration waits without replacing focused actions', async ({
  extension,
}) => {
  test.setTimeout(80_000)
  const { list, library } = await setup(extension, {
    delay: { [ids[1]]: 25_000 },
  })
  await list
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  const readerCreated = extension.context.waitForEvent('page')
  await list
    .getByRole('button', { name: 'Import 2 selected orders', exact: true })
    .click()
  const reader = await readerCreated
  await reader.waitForURL(`${detailUrl(ids[1])}#*`)
  await reader.setViewportSize({ width: 260, height: 500 })
  const panel = reader.locator('aside[aria-label="1688toCSV"]')
  await library.getByRole('button', { name: /^Activity/ }).click()
  const activity = library.locator('#jobs .import-progress')
  const readerProgress = panel.locator('.import-progress')
  for (const progress of [activity, readerProgress]) {
    await expect(progress).toBeVisible()
    await expect(progress.locator('.import-meter')).toHaveText(
      '1 / 2 processed · 50%'
    )
    await expect(progress.locator('.import-counts')).toHaveText(
      '1 saved · 0 need attention · 1 pending'
    )
    await expect(progress.locator('.import-rows')).toHaveText(
      '2 product rows saved'
    )
    await expect(progress.locator('.import-current')).toContainText(
      '…00000002 · Reading products and checking totals · attempt 1/3'
    )
    await expect(progress.locator('.import-latest')).toContainText(
      'Last saved: …00000001 · 2 product rows · 示例工厂 · CNY 68.00'
    )
    const bar = progress.getByRole('progressbar', {
      name: 'Orders processed',
      exact: true,
    })
    await expect(bar).toHaveAttribute('value', '1')
    await expect(bar).toHaveAttribute('max', '2')
    await expect(bar).toHaveAttribute('aria-valuetext', '1 / 2 processed · 50%')
  }
  const readJob = async () =>
    (
      await extension.inspector.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
      )
    ).data.jobs[0]
  const checkpoint = await readJob()
  expect(checkpoint.completed).toBe(1)
  expect(checkpoint.orders.map(({ state }) => state)).toEqual([
    'done',
    'pending',
  ])
  expect(checkpoint.orders[0].savedRows).toBe(2)
  expect(checkpoint.latestResult).toMatchObject({
    orderId: ids[0],
    outcome: 'saved',
    rows: 2,
    sellerName: '示例工厂',
    payable: '68.00',
  })
  const pause = library
    .locator('#jobs')
    .getByRole('button', { name: 'Pause', exact: true })
  await pause.focus()
  const pauseNode = await pause.elementHandle()
  const initialElapsed = Number(
    (await activity.locator('.import-current').textContent()).match(
      / · (\d+)s on this order/
    )[1]
  )
  await expect
    .poll(
      async () =>
        Number(
          (await activity.locator('.import-current').textContent()).match(
            / · (\d+)s on this order/
          )?.[1]
        ),
      { timeout: 7_000, intervals: [500] }
    )
    .toBeGreaterThanOrEqual(initialElapsed + 3)
  await expect(pause).toBeFocused()
  expect(
    await pause.evaluate((node, previous) => node === previous, pauseNode)
  ).toBe(true)
  await pauseNode.dispose()
  expect(await readJob()).toEqual(checkpoint)
  for (const progress of [activity, readerProgress])
    await expect(progress.locator('.import-meter')).toHaveText(
      '1 / 2 processed · 50%'
    )
  const bounds = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }
  })
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.top).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(260)
  expect(bounds.bottom).toBeLessThanOrEqual(500)
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth)

  // The same order opened manually must not inherit another tab's import UI.
  const manual = await extension.context.newPage()
  await manual.goto(detailUrl(ids[1]))
  const manualPanel = manual.locator('aside[aria-label="1688toCSV"]')
  await expect(manualPanel).toBeVisible()
  await expect(manualPanel.locator('.import-progress')).not.toBeVisible()
  await expect(
    manualPanel.getByRole('button', { name: 'Pause import' })
  ).not.toBeVisible()
  await expect(library.locator('#order-count')).toHaveText('1')
  await manual.close()
  await library
    .getByRole('button', { name: 'Close activity', exact: true })
    .click()
  await assertImported(extension, library)
  await library.getByRole('button', { name: /^Activity/ }).click()
  await expect(library.locator('#jobs .import-meter')).toHaveText(
    '2 / 2 processed · 100%'
  )
  await expect(library.locator('#jobs .import-rows')).toHaveText(
    '4 product rows saved'
  )
})

test('library retry resumes a persisted failed queue and fills the spreadsheet', async ({
  extension,
}) => {
  test.setTimeout(80_000)
  const { library, visited } = await setup(extension, {
    summary: '查看优惠明细',
  })
  await extension.inspector.evaluate(
    async (orders) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('1688-order-library')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('jobs', 'readwrite')
          tx.objectStore('jobs').put({
            id: 'persisted-import',
            accountId: 'local',
            kind: 'import',
            state: 'completed-with-errors',
            phase: 'details',
            total: 2,
            orders,
            workerTabId: null,
            page: 0,
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            error: '',
          })
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    },
    ids.map((orderId) => ({
      orderId,
      sourceUrl: detailUrl(orderId),
      expectedRows: 2,
      state: 'failed',
      error: 'Discount total is missing or invalid.',
    }))
  )
  await library.reload()
  await library.getByRole('button', { name: /^Activity/ }).click()
  await expect(library.locator('#jobs')).toContainText(
    'Discount total is missing or invalid.'
  )
  await library
    .getByRole('button', { name: 'Resume / retry', exact: true })
    .click()
  await library
    .getByRole('dialog', { name: 'Confirm bulk import', exact: true })
    .getByRole('button', { name: 'Resume 2 orders', exact: true })
    .click()
  await library
    .getByRole('button', { name: 'Close activity', exact: true })
    .click()
  await assertImported(extension, library)
  expect(visited).toEqual(ids)
})

test('detail hydration beyond 15 seconds uses the bounded import retry', async ({
  extension,
}) => {
  test.setTimeout(80_000)
  const { list, library } = await setup(extension, {
    delay: { [ids[0]]: 17_000 },
  })
  await list
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  await list
    .getByRole('button', { name: 'Import 2 selected orders', exact: true })
    .click()
  await assertImported(extension, library)
})
