import { readOrderList, goToListPage } from './order-list.js'

const key = Symbol.for('1688tocsv.listController')
globalThis[key]?.()
let disposed = false,
  host
async function send(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...data })
  if (!response?.ok)
    throw new Error(
      response?.error || 'Reload the extension and refresh this page.'
    )
  return response.data
}
function listener(message, sender, respond) {
  if (!['LIST_READ', 'LIST_PAGE'].includes(message.type)) return
  ;(async () => {
    try {
      const data =
        message.type === 'LIST_READ'
          ? readOrderList(document, location.href)
          : await goToListPage(document, message.page, { url: location.href })
      respond({ ok: true, data })
    } catch (error) {
      respond({ ok: false, error: error.message })
    }
  })()
  return true
}
chrome.runtime.onMessage.addListener(listener)
function mount() {
  if (host?.isConnected || disposed) return
  host = undefined
  try {
    readOrderList(document, location.href)
  } catch {
    return
  }
  host = document.createElement('div')
  const root = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `:host{all:initial;position:fixed;bottom:14px;right:14px;z-index:2147483647;display:block;max-width:calc(100vw - 28px)}aside{font:12px/1.5 system-ui,sans-serif;color:#344330;background:#fcfcf8;border:1px solid #d6dfcc;border-radius:12px;box-shadow:0 5px 25px #19351b24;padding:13px;max-width:460px;box-sizing:border-box}strong{font-size:11px;display:block;margin-bottom:8px}nav{display:flex;gap:6px;flex-wrap:wrap}button{font:inherit;border:1px solid #d6dfcc;border-radius:6px;background:white;color:#475b3c;padding:8px 10px;cursor:pointer}button:first-child{background:#dd4d23;color:white;border-color:#dd4d23}button:focus-visible{outline:3px solid #598bd0;outline-offset:2px}p{margin:8px 0 0;max-width:420px;overflow-wrap:anywhere;font-size:11px}p:empty{display:none}p.error{color:#a13f24}`
  const aside = document.createElement('aside')
  aside.setAttribute('aria-label', '1688 order library')
  const title = document.createElement('strong')
  title.textContent = '1688toCSV · Your order library'
  const nav = document.createElement('nav')
  const status = document.createElement('p')
  status.setAttribute('role', 'status')
  function button(label, task) {
    const b = document.createElement('button')
    b.textContent = label
    b.addEventListener('click', async () => {
      b.disabled = true
      try {
        status.className = ''
        status.textContent = (await task()) || ''
      } catch (error) {
        status.className = 'error'
        status.textContent = error.message
      } finally {
        b.disabled = false
      }
    })
    nav.append(b)
  }
  button('Import all matching', async () => {
    const list = readOrderList(document, location.href)
    await send('IMPORT_START', { scope: 'all' })
    await send('OPEN_LIBRARY')
    return `Collecting ${list.total} orders across all matching pages. Keep this list tab open; pause the import before changing filters.`
  })
  button('Import selected', async () => {
    const list = readOrderList(document, location.href)
    const ids = list.orders
      .filter((order) => order.selected)
      .map((order) => order.orderId)
    if (!ids.length)
      throw new Error(
        'Use the checkboxes beside orders on this page, then choose Import selected.'
      )
    await send('IMPORT_START', { scope: 'selected', orderIds: ids })
    await send('OPEN_LIBRARY')
    return `${ids.length} selected orders queued.`
  })
  button('Spreadsheet ↗', async () => {
    await send('OPEN_LIBRARY')
    return 'Spreadsheet opened.'
  })
  aside.append(title, nav, status)
  root.append(style, aside)
  document.body.append(host)
}
let timer
function scheduleMount(delay = 16) {
  if (timer || disposed) return
  timer = setTimeout(() => {
    timer = undefined
    mount()
    // Document observers cannot see a later render inside an existing shadow
    // root. Keep a low-frequency retry until the list is ready, even after login.
    if (!host?.isConnected) scheduleMount(2000)
  }, delay)
}
const observer = new MutationObserver(() => scheduleMount())
observer.observe(document.documentElement, { childList: true, subtree: true })
scheduleMount(0)
globalThis[key] = () => {
  disposed = true
  observer.disconnect()
  clearTimeout(timer)
  host?.remove()
  chrome.runtime.onMessage.removeListener(listener)
}
