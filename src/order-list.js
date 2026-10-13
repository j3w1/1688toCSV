// A read-only adapter for the rendered buyer list. No private website APIs.
export function queryOrderTree(root) {
  const roots = [root]
  const seen = new Set()
  for (let index = 0; index < roots.length; index++) {
    const scope = roots[index]
    if (seen.has(scope)) continue
    seen.add(scope)
    if (scope.shadowRoot) roots.push(scope.shadowRoot)
    for (const node of scope.querySelectorAll('*')) {
      if (node.shadowRoot) roots.push(node.shadowRoot)
    }
  }
  return {
    all: (selector) => [
      ...new Set(
        [...seen].flatMap((scope) => [...scope.querySelectorAll(selector)])
      ),
    ],
    one: (selector) => {
      for (const scope of seen) {
        const node = scope.querySelector(selector)
        if (node) return node
      }
      return null
    },
  }
}

export function detailUrl(value, expectedId) {
  try {
    const url = new URL(value)
    const orderId = url.searchParams.get('orderId')
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !/^[0-9]{5,40}$/.test(orderId || '') ||
      url.searchParams.getAll('orderId').length !== 1 ||
      (expectedId && orderId !== expectedId) ||
      !(
        (url.hostname === 'air.1688.com' &&
          url.pathname === '/app/ctf-page/trade-order-detail/index.html') ||
        (url.hostname === 'trade.1688.com' &&
          url.pathname === '/order/new_step_order_detail.htm')
      )
    )
      return null
    return `${url.origin}${url.pathname}?orderId=${orderId}`
  } catch {
    return null
  }
}

export function isListUrl(value) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ((url.hostname === 'air.1688.com' &&
        url.pathname ===
          '/app/ctf-page/trade-order-list/buyer-order-list.html') ||
        (url.hostname === 'work.1688.com' &&
          ['/', '/home/buyer.htm'].includes(url.pathname)))
    )
  } catch {
    return false
  }
}

const text = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim()
const checked = (node) =>
  Boolean(
    node &&
    node.hasAttribute('checked') &&
    node.getAttribute('checked') !== 'false'
  )

function integer(value, minimum, label) {
  if (!/^\d+$/.test(value || ''))
    throw new Error(`The order list ${label} is not readable.`)
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum)
    throw new Error(`The order list ${label} is invalid.`)
  return number
}

function filters(tree, url) {
  const search = tree.one('order-search')
  const controls = search ? queryOrderTree(search) : tree
  const tabs = tree.one('order-tabs')
  const tab = tabs
    ? queryOrderTree(tabs).one('q-tabs-item[active]:not([active="false"])')
    : null
  const date = controls.one('order-search-time')
  const query = new URL(url).searchParams
  for (const key of ['page', 'pageSize', 'spm']) query.delete(key)
  query.sort()
  return JSON.stringify({
    query: query.toString(),
    tab: tab?.getAttribute('key') || '',
    date: ['orderdate', 'startdate', 'enddate'].map(
      (key) => date?.getAttribute(key) || ''
    ),
    fields: controls
      .all('input, textarea, q-select')
      .map((node) => [
        node.getAttribute('data-tracker') ||
          node.getAttribute('placeholder') ||
          node.getAttribute('name') ||
          '',
        node.localName === 'q-select'
          ? node.getAttribute('value') || ''
          : node.value || '',
      ]),
  })
}

export function readOrderList(document, url) {
  if (!isListUrl(url))
    throw new Error('Open a supported 1688 buyer order list.')
  const tree = queryOrderTree(document)
  const pager = tree.one('q-pagination[data-tracker="pagination-order-list"]')
  if (!pager)
    throw new Error(
      'The order list is not ready. Finish signing in and wait for the orders to load.'
    )
  const page = integer(pager.getAttribute('current'), 1, 'page')
  const pageSize = integer(pager.getAttribute('pagesize'), 1, 'page size')
  const total = integer(pager.getAttribute('total'), 0, 'total')
  if (page > Math.max(1, Math.ceil(total / pageSize)))
    throw new Error('The order list pagination is inconsistent.')
  const orders = tree.all('order-item').map((host) => {
    const item = queryOrderTree(host)
    const trackerId = new URLSearchParams(
      host.getAttribute('data-tracker-args') || ''
    ).get('orderId')
    const links = item
      .all('a.order-detail-action[href]')
      .map((node) => detailUrl(node.getAttribute('href')))
      .filter(Boolean)
    const urls = [...new Set(links)]
    if (urls.length !== 1 || !trackerId || !detailUrl(urls[0], trackerId)) {
      throw new Error(
        'An order has an unreadable or conflicting detail link. Wait for the list to finish loading.'
      )
    }
    const more = text(item.one('.show-more-entries'))
    const advertised = more.match(/共\s*(\d+)\s*种货品/)
    const visibleCount = item.all('.order-item-entry').length
    const expectedRows = advertised
      ? integer(advertised[1], 1, 'product count')
      : visibleCount
    if (!expectedRows || expectedRows < visibleCount || (more && !advertised)) {
      throw new Error('An order has an unreadable product count.')
    }
    return {
      orderId: trackerId,
      sourceUrl: urls[0],
      expectedRows,
      sellerName:
        text(item.one('.seller-info-company')) ||
        text(item.one('.seller-id-text')),
      status: text(item.one('.order-status')),
      selected: checked(
        item.one('q-checkbox[data-tracker="checkbox-order-item"]')
      ),
    }
  })
  if (new Set(orders.map((order) => order.orderId)).size !== orders.length) {
    throw new Error(
      'The order list contains duplicate order IDs. Wait for it to finish loading.'
    )
  }
  if (
    orders.length !==
    Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize))
  ) {
    throw new Error(
      'The order list is incomplete. Wait for all orders on this page to load.'
    )
  }
  return { orders, page, pageSize, total, filterKey: filters(tree, url) }
}

export async function goToListPage(document, requested, options = {}) {
  const url = options.url || document.location.href
  const before = readOrderList(document, url)
  const target = requested === 'next' ? before.page + 1 : requested
  if (
    !Number.isSafeInteger(target) ||
    target < 1 ||
    target > Math.max(1, Math.ceil(before.total / before.pageSize))
  ) {
    throw new Error('That order-list page is unavailable.')
  }
  if (target === before.page) return before
  const pager = queryOrderTree(document).one(
    'q-pagination[data-tracker="pagination-order-list"]'
  )
  const buttons = queryOrderTree(pager)
  const button =
    buttons.one(`button[data-current="${target}"]`) ||
    (target === before.page + 1 ? buttons.one('button#right') : null)
  if (!button || button.disabled || button.hasAttribute('disabled')) {
    throw new Error('The requested page has no enabled pagination button.')
  }
  button.click()
  const wait =
    options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const deadline = Date.now() + (options.timeoutMs ?? 15000)
  const previousIds = before.orders.map((order) => order.orderId).join(',')
  while (Date.now() < deadline) {
    await wait(250)
    let next
    try {
      next = readOrderList(document, document.location?.href || url)
    } catch {
      continue // Reactive components may be between two complete render states.
    }
    if (next.filterKey !== before.filterKey)
      throw new Error('Order-list filters changed. Import paused.')
    if (next.total !== before.total || next.pageSize !== before.pageSize)
      throw new Error(
        'The order list changed during pagination. Import paused.'
      )
    if (
      next.page === target &&
      next.orders.map((order) => order.orderId).join(',') !== previousIds
    )
      return next
    if (next.page !== before.page && next.page !== target)
      throw new Error(
        'The order-list page changed unexpectedly. Import paused.'
      )
  }
  throw new Error(
    'The order list did not finish changing pages. Import paused; retry when the list is ready.'
  )
}
