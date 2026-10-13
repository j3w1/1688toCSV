const pages = new Map([
  ['air.1688.com', '/app/ctf-page/trade-order-detail/index.html'],
  ['trade.1688.com', '/order/new_step_order_detail.htm'],
])

export function isSupportedOrderUrl(value) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      pages.get(url.hostname) === url.pathname &&
      !url.port &&
      /^\d+$/.test(url.searchParams.get('orderId') || '')
    )
  } catch {
    return false
  }
}

export function orderIdFromUrl(value) {
  try {
    return new URL(value).searchParams.get('orderId') || ''
  } catch {
    return ''
  }
}
