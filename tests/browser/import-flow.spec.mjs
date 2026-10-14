import { test, expect } from './extension-fixture.mjs'
import { buildOrderFixture } from '../fixtures/order-fixture.mjs'

test.use({ importFlow: true })

const origin = 'https://air.1688.test'
const listUrl = `${origin}/app/ctf-page/trade-order-list/buyer-order-list.html`
const detailUrl = (id) =>
  `${origin}/app/ctf-page/trade-order-detail/index.html?orderId=${id}`
const ids = ['9990000000000000001', '9990000000000000002']

// All pages are synthetic and fulfilled in-process; no requests reach 1688.
function completeOrder(document, orderId, summary = '2.40') {
  const built = buildOrderFixture(document)
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
  totals.attachShadow({ mode: 'open' }).innerHTML = `
    <div class="detail-price">
      <dl><dt>原价总计</dt><dd>¥66.00</dd></dl>
      <dl><dt>运费</dt><dd>¥4.40</dd></dl>
      <dl><dt>商品优惠</dt><dd>减 ¥2.40</dd></dl>
    </div><div class="total-discount">2.40</div>
    <div class="total-sum-pay"><!--?lit$8321$--><span class="sum-pay-label">实付款</span><!--amount:start--><span class="fd-cny">¥</span><!--?lit$8321$-->68.<span class="sub-ammount">00</span><!--amount:end--></div>`
  app.append(totals)
  totals.shadowRoot.querySelector('.total-discount').textContent = summary
}

async function setup(extension, { delay = 0, summary = '2.40' } = {}) {
  const visited = []
  await extension.context.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    let body
    if (url.pathname.includes('trade-order-list')) {
      body = `<order-app><q-pagination data-tracker="pagination-order-list" current="1" pagesize="10" total="2"></q-pagination>${ids
        .map(
          (id) => `
        <order-item data-tracker-args="orderId=${id}">
          <a class="order-detail-action" href="${detailUrl(id)}">Detail</a>
          <q-checkbox data-tracker="checkbox-order-item" checked></q-checkbox>
          <div class="order-item-entry"></div><div class="order-item-entry"></div>
        </order-item>`
        )
        .join('')}</order-app>`
    } else {
      const id = url.searchParams.get('orderId')
      visited.push(id)
      body = `<script>
        ${buildOrderFixture.toString()}
        ${completeOrder.toString()}
        setTimeout(() => completeOrder(document, ${JSON.stringify(id)}, ${JSON.stringify(summary)}), ${typeof delay === 'object' ? delay[id] || 0 : delay});
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
  await library.goto(`${extension.extensionBaseUrl}/library.html`)
  return { list, library, visited }
}

async function assertImported(extension, library) {
  await expect(library.locator('#order-count')).toHaveText('2', {
    timeout: 65_000,
  })
  await expect(library.locator('#sheet-body tr')).toHaveCount(4)
  await expect(library.locator('#jobs')).toContainText('completed')
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

test('selected import reaches persistent spreadsheet and clipboard through real extension messaging', async ({
  extension,
}) => {
  test.setTimeout(80_000)
  const { list, library, visited } = await setup(extension)
  await list
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  await assertImported(extension, library)
  expect(visited).toEqual(ids)
  await library.reload()
  await expect(library.locator('#order-count')).toHaveText('2')
  await list.getByRole('button', { name: 'Spreadsheet ↗', exact: true }).click()
  await list
    .getByRole('button', { name: 'Open spreadsheet here', exact: true })
    .click()
  await expect(list).toHaveURL(`${extension.extensionBaseUrl}/library.html`)
  await expect(list.locator('#order-count')).toHaveText('2')
  await expect(list.locator('#sheet-body tr')).toHaveCount(4)
  // Refresh all remains explicit even with one selected order and a text filter.
  await list
    .getByRole('checkbox', { name: `Select order ${ids[0]}`, exact: true })
    .check()
  await list.getByRole('searchbox').fill('no matching synthetic product')
  await expect(list.locator('#sheet-body tr')).toHaveCount(0)
  await list.getByRole('button', { name: 'Refresh all', exact: true }).click()
  await expect.poll(() => visited.length, { timeout: 40_000 }).toBe(4)
  await expect(list.locator('#refresh-all')).toBeEnabled({ timeout: 20_000 })
  expect(visited.slice(2).sort()).toEqual([...ids].sort())
  await list.getByRole('searchbox').clear()
  await list.getByRole('button', { name: 'Show all', exact: true }).click()
  await expect(list.locator('#sheet-body tr')).toHaveCount(4)
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
  await assertImported(extension, library)
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
  await expect(library.locator('#jobs')).toContainText(
    'Discount total is missing or invalid.'
  )
  await library
    .getByRole('button', { name: 'Resume / retry', exact: true })
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
  await assertImported(extension, library)
})
