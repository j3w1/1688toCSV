import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import {
  readOrderList,
  detailUrl,
  queryOrderTree,
  goToListPage,
} from '../src/order-list.js'

const listUrl =
  'https://air.1688.com/app/ctf-page/trade-order-list/buyer-order-list.html?page=1&pageSize=2'
const orderUrl = (id) =>
  `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${id}`
function fixture() {
  const { document } = parseHTML(
    '<html><body><order-app></order-app></body></html>'
  )
  const root = document
    .querySelector('order-app')
    .attachShadow({ mode: 'open' })
  root.innerHTML =
    '<order-search><input name="search" value="lamp"></order-search><order-tabs></order-tabs><q-pagination data-tracker="pagination-order-list" current="1" pagesize="2" total="3"></q-pagination>'
  root.querySelector('order-tabs').attachShadow({ mode: 'open' }).innerHTML =
    '<q-tabs-item active key="all"></q-tabs-item>'
  const pager = root.querySelector('q-pagination')
  pager.attachShadow({ mode: 'open' }).innerHTML =
    '<button data-current="1">1</button><button data-current="2">2</button><button id="right">Next</button>'
  function rows(ids) {
    for (const n of root.querySelectorAll('order-item')) n.remove()
    for (const id of ids) {
      const host = document.createElement('order-item')
      host.setAttribute('data-tracker-args', `orderId=${id}`)
      root.append(host)
      host.attachShadow({ mode: 'open' }).innerHTML =
        `<a class="order-detail-action" href="${orderUrl(id)}">Detail</a><q-checkbox data-tracker="checkbox-order-item" checked></q-checkbox><div class="order-item-entry"></div><div class="order-item-entry"></div><span class="show-more-entries">共40种货品 还有38种 展开更多</span>`
    }
  }
  rows(['10001', '10002'])
  return { document, root, pager, rows }
}
test('reads nested shadow rows and advertised complete counts instead of truncated cards', () => {
  const s = fixture(),
    result = readOrderList(s.document, listUrl)
  assert.equal(result.orders.length, 2)
  assert.equal(result.orders[0].expectedRows, 40)
  assert.equal(result.orders[0].selected, true)
  assert.equal(result.orders[0].orderId, '10001')
  assert.equal(
    queryOrderTree(s.root.querySelector('order-item')).all('.order-item-entry')
      .length,
    2
  )
})
test('pagination and tracking URL parameters do not change filter identity', () => {
  const s = fixture()
  const before = readOrderList(s.document, listUrl).filterKey
  assert.equal(
    readOrderList(s.document, `${listUrl}&spm=ignored`).filterKey,
    before
  )
  s.root.querySelector('input').value = 'different'
  assert.notEqual(readOrderList(s.document, listUrl).filterKey, before)
})

test('list purchase timestamps are explicit, calendar-valid China dates', () => {
  const s = fixture()
  const root = s.root.querySelector('order-item').shadowRoot
  const date = s.document.createElement('span')
  date.className = 'order-time'
  date.textContent = '2026-02-28 23:59:58'
  root.append(date)
  assert.equal(
    readOrderList(s.document, listUrl).orders[0].purchasedAt,
    '2026-02-28T23:59:58+08:00'
  )
  date.textContent = '2026-02-30 23:59:58'
  assert.equal(
    readOrderList(s.document, listUrl).orders[0].purchasedAt,
    undefined
  )
  date.textContent = '2026-03-01 24:00:00'
  assert.equal(
    readOrderList(s.document, listUrl).orders[0].purchasedAt,
    undefined
  )
  date.remove()
  assert.equal(
    readOrderList(s.document, listUrl).orders[0].purchasedAt,
    undefined
  )
})
test('rejects mismatching identities, incomplete pages and duplicate order IDs', () => {
  const s = fixture()
  s.rows(['10001', '10001'])
  assert.throws(() => readOrderList(s.document, listUrl), /duplicate/)
  s.rows(['10001'])
  assert.throws(() => readOrderList(s.document, listUrl), /incomplete/)
  s.rows(['10001', '10002'])
  queryOrderTree(s.document).one('a').setAttribute('href', orderUrl('99999'))
  assert.throws(() => readOrderList(s.document, listUrl), /conflicting/)
})
test('detail URL validation rejects duplicate query IDs and unsupported origins', () => {
  assert.equal(
    detailUrl(orderUrl('10001') + '&spm=tracking'),
    'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=10001'
  )
  assert.equal(detailUrl(orderUrl('10001') + '&orderId=10002'), null)
  assert.equal(detailUrl(orderUrl('10001'), '10002'), null)
  assert.equal(detailUrl(orderUrl('10001').replace('https:', 'http:')), null)
  assert.equal(
    detailUrl(orderUrl('10001').replace('air.1688.com', 'evil.example')),
    null
  )
})
test('pagination waits for changed rows and keeps filter scope', async () => {
  const s = fixture()
  s.pager.shadowRoot
    .querySelector('[data-current="2"]')
    .addEventListener('click', () => {
      s.pager.setAttribute('current', '2')
      s.rows(['10003'])
    })
  const result = await goToListPage(s.document, 2, {
    url: listUrl,
    wait: async () => {},
  })
  assert.equal(result.page, 2)
  assert.equal(result.orders[0].orderId, '10003')
  await assert.rejects(
    goToListPage(s.document, 3, { url: listUrl }),
    /unavailable/
  )
})
