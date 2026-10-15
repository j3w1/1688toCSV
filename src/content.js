import { extractOrder } from './extract.js'
import { prepareCsv } from './csv.js'
import { mountPageDownload } from './page-download.js'
import { extractOrderSnapshot } from './order-snapshot.js'
import { collectFinancialDiagnostics } from './import-diagnostics.js'

const controllerKey = Symbol.for('1688tocsv.detailController')
globalThis[controllerKey]?.()
let disposed = false
let suspended = false
let progressTimer,
  progressQuery = false,
  missingProgress = 0
const importReader = location.hash.startsWith('#1688tocsv-import=')
async function send(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...data })
  if (!response?.ok)
    throw new Error(
      response?.error || 'Reload the extension and refresh this page.'
    )
  return response.data
}
// Hydration is bounded. Read the entire order again for every user action.
async function readReadyOrder() {
  const deadline = Date.now() + 15_000
  let error
  while (!disposed && Date.now() < deadline) {
    try {
      return extractOrderSnapshot(document, location.href)
    } catch (failure) {
      if (failure.retryable === false) throw failure
      error = failure
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  // The page may still be hydrating after this bounded read. Let the importer
  // retry within its existing attempt/time limit without saving partial data.
  throw Object.assign(error || new Error('The order page was closed.'), {
    retryable: !disposed,
  })
}
const panel = mountPageDownload(
  document,
  () => prepareCsv(extractOrder(document, location.href)),
  {
    saveOrder: async () => {
      const snapshot = extractOrderSnapshot(document, location.href)
      await send('SNAPSHOT_READY', { snapshot, save: true })
      return `${snapshot.items.length} products saved to your spreadsheet.`
    },
    openLibrary: async () => {
      await send('OPEN_LIBRARY')
      return 'Workspace opened.'
    },
    pauseImport: (jobId) => send('IMPORT_PAUSE', { jobId }),
    suspend: () => {
      suspended = true
      clearTimeout(progressTimer)
    },
    resume: () => {
      suspended = false
      missingProgress = 0
      void refreshProgress()
    },
    dispose: () => {
      disposed = true
      clearTimeout(progressTimer)
    },
  }
)
async function refreshProgress() {
  if (disposed || suspended || progressQuery || !importReader) return
  progressQuery = true
  clearTimeout(progressTimer)
  try {
    const job = await send('READER_STATUS')
    if (disposed || suspended) return
    missingProgress = job ? 0 : missingProgress + 1
    panel.updateProgress(job)
  } catch {
    // A disconnected extension must not leave a frozen progress claim on screen.
    panel.updateProgress(null)
    missingProgress += 1
  } finally {
    progressQuery = false
    if (!disposed && !suspended && missingProgress < 3)
      progressTimer = setTimeout(refreshProgress, 1500)
  }
}
void refreshProgress()
function listener(message, sender, respond) {
  if (message.type !== 'DETAIL_READ') return
  ;(async () => {
    try {
      const snapshot = await readReadyOrder()
      if (message.orderId && message.orderId !== snapshot.orderId)
        throw new Error('This page shows a different order.')
      respond({ ok: true, data: snapshot })
    } catch (error) {
      respond({
        ok: false,
        error: error.message,
        retryable: error.retryable === true,
        diagnostics: collectFinancialDiagnostics(
          document,
          location.href,
          chrome.runtime.getManifest().version
        ),
      })
    }
  })()
  return true
}
chrome.runtime.onMessage.addListener(listener)
globalThis[controllerKey] = () => {
  disposed = true
  clearTimeout(progressTimer)
  panel.dispose()
  chrome.runtime.onMessage.removeListener(listener)
}
// Merely opening an unsaved order does not add it. Existing orders refresh.
;(async () => {
  try {
    await send('CONTENT_READY')
    if (importReader) return // The queue owns collection and saving for this tab.
    const snapshot = await readReadyOrder()
    await send('SNAPSHOT_READY', { snapshot })
  } catch {
    /* Initial hydration is retried by explicit actions. */
  }
})()
