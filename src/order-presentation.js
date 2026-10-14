const statuses = [
  [/^交易已?成功$/, 'Completed', 'success'],
  [/^交易关闭$/, 'Closed', 'muted'],
  [/^(等待买家付款|待付款)$/, 'Awaiting payment', 'warning'],
  [/^(买家已付款[，,]?等待卖家发货|待发货)$/, 'Awaiting shipment', 'info'],
  [/^(卖家已发货[，,]?等待买家确认收货|待收货)$/, 'Awaiting delivery', 'info'],
  [/^(退款中|退款处理中)$/, 'Refund in progress', 'warning'],
  [/^退款成功$/, 'Refunded', 'muted'],
]

// Display-only: preserve original statuses for storage, filtering and export.
export function presentOrderStatus(value = '') {
  const normalized = value.replace(/\s/g, '')
  const match = statuses.find(([pattern]) => pattern.test(normalized))
  return {
    label: match?.[1] || value || 'Status unavailable',
    tone: match?.[2] || 'muted',
  }
}
