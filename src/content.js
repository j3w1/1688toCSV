import { extractOrder, orderReadiness } from './extract.js'

const listenerKey = Symbol.for('1688tocsv.messageListener')
const runtime = chrome.runtime
// Reloading/injecting on an existing page must not register duplicate listeners.
if (globalThis[listenerKey])
  runtime.onMessage.removeListener(globalThis[listenerKey])

function handleMessage(request, _sender, respond) {
  if (request?.action === 'ping') {
    respond(orderReadiness(document))
  } else if (request?.action === 'extractData') {
    try {
      respond({ data: extractOrder(document, location.href) })
    } catch (error) {
      respond({ error: error.message })
    }
  }
  return false
}
globalThis[listenerKey] = handleMessage
runtime.onMessage.addListener(handleMessage)
