import { isSupportedOrderUrl, orderIdFromUrl } from './page.js'

export function mountPopup(
  api,
  document,
  { pollMs = 300, timeoutMs = 15000 } = {}
) {
  const byId = (id) => document.getElementById(id)
  const button = byId('download-csv-order')
  const retry = byId('retry')
  const status = byId('status-text')
  const feedback = byId('feedback')
  let tabId
  let ready = false
  let busy = false
  let stopped = false
  document.defaultView.addEventListener(
    'pagehide',
    () => {
      stopped = true
    },
    { once: true }
  )

  function state(name, message) {
    document.body.dataset.state = name
    status.textContent = message
    button.disabled = !ready || busy
    button.querySelector('span').textContent = busy
      ? 'Preparing CSV…'
      : 'Download CSV'
    button.setAttribute('aria-busy', String(busy))
    retry.hidden = name !== 'error'
  }
  function message(value, tone = 'success') {
    feedback.textContent = value
    feedback.hidden = !value
    feedback.dataset.tone = tone
  }
  async function checkPage() {
    ready = false
    message('')
    state('loading', 'Checking order…')
    byId('row-count').textContent = '—'
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true })
      const orderId = orderIdFromUrl(tab?.url)
      byId('order-id').textContent = orderId || 'Open an order to begin'
      if (!tab || !isSupportedOrderUrl(tab.url)) {
        state('unsupported', 'Open an order detail page')
        return
      }
      tabId = tab.id
      let response
      try {
        response = await api.tabs.sendMessage(tabId, { action: 'ping' })
      } catch {
        await api.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        })
      }
      const started = Date.now()
      while (!stopped) {
        response ||= await api.tabs.sendMessage(tabId, { action: 'ping' })
        if (response?.status === 'ready') {
          ready = true
          byId('row-count').textContent = String(response.rowCount)
          state('ready', 'Ready to export')
          return
        }
        if (Date.now() - started >= timeoutMs)
          throw new Error(
            'The order is still loading. Refresh the page, then check again.'
          )
        state('loading', 'Waiting for order details…')
        await new Promise((resolve) => setTimeout(resolve, pollMs))
        response = undefined
      }
    } catch (error) {
      state('error', 'Could not read this order')
      message(error.message || 'Refresh the order page and try again.', 'error')
    }
  }
  button.addEventListener('click', async () => {
    if (!ready || busy) return
    busy = true
    message('')
    state('exporting', 'Creating your CSV…')
    try {
      const response = await api.tabs.sendMessage(tabId, {
        action: 'preparePageSave',
      })
      if (response?.error) throw new Error(response.error)
      if (response?.status !== 'save-ready')
        throw new Error(
          'The save panel could not open. Refresh the order page and try again.'
        )
      busy = false
      state('requested', 'Save on the order page')
      message(
        'Click Save CSV in the panel on your order page. Close this popup if it covers the panel.',
        'notice'
      )
    } catch (error) {
      busy = false
      state('error', 'Export needs attention')
      message(error.message || 'Export failed. Please try again.', 'error')
    }
  })
  retry.addEventListener('click', checkPage)
  return checkPage()
}
