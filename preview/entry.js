import { mountPopup } from '../src/popup.js'
import { prepareCsv } from '../src/csv.js'
import { openSavePanel } from '../src/save-panel.js'

// Explicit UI preview adapter. Never bundled into the installed extension.
const scenario = new URL(location.href).searchParams.get('state') || 'ready'
document.querySelector('.brand > span:last-child').textContent = 'DEMO PREVIEW'
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
      if (action === 'preparePageSave' && scenario !== 'error') {
        const file = prepareCsv(order)
        openSavePanel(document, file)
        return { status: 'save-ready', filename: file.filename }
      }
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
      return undefined
    },
  },
  scripting: { async executeScript() {} },
}
mountPopup(api, document, { timeoutMs: 3000 })
