import { mountPopup } from '../src/popup.js'
import { toCsv } from '../src/csv.js'

// Explicit UI preview adapter. Never bundled into the installed extension.
const scenario = new URL(location.href).searchParams.get('state') || 'ready'
const order = {
  sellerName: '示例工厂',
  orderSuffix: '6789',
  dataRows: [
    {
      thumbnail: '',
      description: '测试香薰蜡烛\n颜色：暖白\n货号：DEMO-001',
      price: '12.50',
      quantity: '4',
      discount: '2.10',
    },
    {
      thumbnail: '',
      description: '桌面收纳盒\n款式：小号\n货号：DEMO-002',
      price: '8.00',
      quantity: '2',
      discount: '0.30',
    },
  ],
}
let attempts = 0
const api = {
  tabs: {
    async query() {
      return [
        {
          id: 1,
          url:
            scenario === 'unsupported'
              ? 'https://example.invalid/'
              : 'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1234567890123456789',
        },
      ]
    },
    async sendMessage(_id, { action }) {
      if (action === 'ping') {
        if (scenario === 'loading' && ++attempts < 20)
          return { status: 'loading' }
        if (scenario === 'timeout') return { status: 'loading' }
        return { status: 'ready', rowCount: 2 }
      }
      if (scenario === 'error')
        return {
          error:
            'Row 2: product details are incomplete. Refresh the order and try again.',
        }
      return { data: order }
    },
  },
  scripting: { async executeScript() {} },
  downloads: {
    async download({ filename }) {
      if (scenario === 'download-error')
        throw new Error('The browser could not save this file. Try again.')
      const link = document.createElement('a')
      const url = URL.createObjectURL(
        new Blob([toCsv(order.dataRows)], { type: 'text/csv;charset=utf-8' })
      )
      link.href = url
      link.download = filename
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return 1
    },
    onChanged: { addListener() {}, removeListener() {} },
    async search() {
      return [{ state: 'complete' }]
    },
  },
}
mountPopup(api, document, { timeoutMs: 3000 })
