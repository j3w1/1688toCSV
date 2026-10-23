import { mountListToolbar } from './list-toolbar.js'
import { readOrderList, goToListPage } from './order-list.js'

const key = Symbol.for('1688topl.listController')
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
let toolbar
function mount() {
  if (host?.isConnected || disposed) return
  toolbar?.dispose()
  host = undefined
  try {
    readOrderList(document, location.href)
  } catch {
    return
  }
  toolbar = mountListToolbar(document, {
    readList: () => readOrderList(document, location.href),
    send,
  })
  host = toolbar.host
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
  toolbar?.dispose()
  chrome.runtime.onMessage.removeListener(listener)
}
