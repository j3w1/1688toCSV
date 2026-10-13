import { openDatabase } from './database.js'
import { createImportController } from './import-controller.js'
import { detailUrl, isListUrl } from './order-list.js'
import { loadThumbnail } from './images.js'

const alarmName = 'order-import'
// This lock only orders concurrent events in one worker lifetime. Every job
// checkpoint lives in IndexedDB and is re-read by the controller on every tick.
let tail = Promise.resolve()
function serial(task) {
  const previous = tail
  let release
  tail = new Promise((resolve) => {
    release = resolve
  })
  return (async () => {
    await previous
    try {
      return await task()
    } finally {
      release()
    }
  })()
}

async function changed() {
  try {
    await chrome.runtime.sendMessage({ type: 'LIBRARY_CHANGED' })
  } catch {
    /* The library may be closed. */
  }
}
const marker = (id) => `#1688tocsv-import=${encodeURIComponent(id)}`
function owns(tab, id) {
  try {
    return new URL(tab.pendingUrl || tab.url).hash === marker(id)
  } catch {
    return false
  }
}
async function content(tabId, message, frameId = 0) {
  let response
  try {
    response = await chrome.tabs.sendMessage(tabId, message, { frameId })
  } catch {
    throw Object.assign(
      new Error(
        'The order page is not ready. Refresh it or finish signing in, then resume.'
      ),
      { retryable: true }
    )
  }
  if (!response?.ok)
    throw new Error(response?.error || 'The order page did not respond.')
  return response.data
}
const browser = {
  async readList(source) {
    await chrome.tabs.get(source.tabId)
    return content(source.tabId, { type: 'LIST_READ' }, source.frameId)
  },
  async changePage(source, page) {
    return content(source.tabId, { type: 'LIST_PAGE', page }, source.frameId)
  },
  async openDetailTab(url, id) {
    // The marker is written atomically with tab creation. Reuse it if the
    // worker stopped between creating the tab and saving its numeric ID.
    const existing = (await chrome.tabs.query({})).find((tab) => owns(tab, id))
    if (existing) {
      if (detailUrl(existing.pendingUrl || existing.url) !== detailUrl(url))
        await chrome.tabs.update(existing.id, { url: `${url}${marker(id)}` })
      return existing.id
    }
    const tab = await chrome.tabs.create({
      url: `${url}${marker(id)}`,
      active: false,
    })
    return tab.id
  },
  async getDetailTab(tabId, id) {
    try {
      const tab = await chrome.tabs.get(tabId)
      return !id || owns(tab, id) ? tab : null
    } catch {
      return null
    }
  },
  async closeDetailTab(tabId, id) {
    const tab = Number.isInteger(tabId)
      ? await this.getDetailTab(tabId)
      : (await chrome.tabs.query({})).find((candidate) => owns(candidate, id))
    // A user-navigated or login tab is left open for the user to finish.
    if (tab && owns(tab, id)) await chrome.tabs.remove(tab.id)
  },
  async readDetail(tabId, orderId) {
    return content(tabId, { type: 'DETAIL_READ', orderId })
  },
  async schedule() {
    await chrome.alarms.create(alarmName, { periodInMinutes: 0.5 })
  },
  async unschedule() {
    await chrome.alarms.clear(alarmName)
  },
  changed,
}

async function usingRepository(task) {
  const repository = await openDatabase()
  try {
    return await task(
      repository,
      createImportController({ repository, browser })
    )
  } finally {
    repository.close()
  }
}
let pumping = false
let wakeAgain = false
async function pump() {
  if (pumping) {
    wakeAgain = true
    return
  }
  pumping = true
  try {
    do {
      wakeAgain = false
      const result = await serial(() =>
        usingRepository(async (repository, controller) => {
          const state = await controller.tick()
          await changed()
          return state
        })
      )
      if (result === 'continue') wakeAgain = true
    } while (wakeAgain)
  } catch (error) {
    // Keep the durable checkpoint and alarm; the next event retries storage or
    // browser failures without reporting the job as successfully completed.
    console.error('Import could not advance:', error.message)
  } finally {
    pumping = false
  }
}

async function openLibrary() {
  const url = chrome.runtime.getURL('library.html')
  const existing = (await chrome.tabs.query({})).find((tab) => tab.url === url)
  if (existing) return chrome.tabs.update(existing.id, { active: true })
  return chrome.tabs.create({ url })
}
function isExtensionPage(sender) {
  return (
    sender.id === chrome.runtime.id &&
    sender.url?.startsWith(chrome.runtime.getURL(''))
  )
}
function requireContent(sender, kind) {
  if (
    sender.id !== chrome.runtime.id ||
    !Number.isInteger(sender.tab?.id) ||
    !(kind === 'list' ? isListUrl(sender.url) : detailUrl(sender.url))
  ) {
    throw new Error('This action must start on a supported 1688 order page.')
  }
}
async function dispatch(message, sender, repository, controller) {
  if (!message || typeof message.type !== 'string')
    throw new Error('Unknown extension action.')
  switch (message.type) {
    case 'OPEN_LIBRARY':
      if (
        !isExtensionPage(sender) &&
        !isListUrl(sender.url) &&
        !detailUrl(sender.url)
      )
        throw new Error('Unsupported source page.')
      return openLibrary()
    case 'CONTENT_READY':
      requireContent(sender, 'detail')
      return true
    case 'SNAPSHOT_READY': {
      requireContent(sender, 'detail')
      if (
        !detailUrl(sender.url, message.snapshot?.orderId) ||
        message.snapshot?.accountId !== 'local'
      )
        throw new Error('The snapshot does not match this order page.')
      // Import snapshots are committed only after the queued completeness check.
      const jobs = await repository.listJobs()
      if (
        jobs.some(
          (job) => job.workerTabId === sender.tab.id && job.state === 'running'
        )
      )
        return { saved: false }
      if (
        message.save !== true &&
        !(await repository.getOrder(message.snapshot.orderId))
      )
        return { saved: false }
      const result = await repository.saveSnapshot(message.snapshot)
      await changed()
      return result
    }
    case 'IMPORT_START':
      requireContent(sender, 'list')
      return controller.start({
        scope: message.scope,
        orderIds: message.orderIds,
        source: { tabId: sender.tab.id, frameId: sender.frameId ?? 0 },
      })
  }
  if (!isExtensionPage(sender))
    throw new Error('Open the extension spreadsheet to use this action.')
  switch (message.type) {
    case 'LIBRARY_UPDATED':
      await changed()
      return true
    case 'LIBRARY_QUERY':
      return {
        orders: await repository.listOrders(),
        jobs: await repository.listJobs(),
      }
    case 'JOBS_QUERY':
      return { jobs: await repository.listJobs() }
    case 'LIBRARY_HISTORY':
      return repository.getHistory(message.orderId)
    case 'IMAGE_GET':
      return loadThumbnail(message.url, repository)
    case 'BACKUP_EXPORT':
      return repository.exportBackup()
    case 'IMPORT_PAUSE':
      return controller.pause(message.jobId)
    case 'IMPORT_RESUME':
      return controller.resume(message.jobId)
    case 'REFRESH_ORDERS':
      return controller.refresh(message.orderIds)
    case 'LIBRARY_NOTES': {
      const result = await repository.setNotes(message.orderId, {
        notes: message.notes,
        tags: message.tags,
      })
      await changed()
      return result
    }
    case 'LIBRARY_REMOVE':
    case 'BACKUP_RESTORE': {
      if ((await repository.listJobs()).some((job) => job.state === 'running'))
        throw new Error(
          'Pause the import before removing orders or restoring a backup.'
        )
      const result =
        message.type === 'LIBRARY_REMOVE'
          ? await repository.removeOrders(message.orderIds)
          : await repository.restoreBackup(message.backup)
      await changed()
      return result
    }
    default:
      throw new Error('Unknown extension action.')
  }
}

// Register listeners synchronously so events can wake a terminated worker.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'LIBRARY_CHANGED') return
  ;(async () => {
    try {
      const run = () =>
        usingRepository((repository, controller) =>
          dispatch(message, sender, repository, controller)
        )
      // Thumbnail downloads and read-only views must not hold the import lock.
      const data = [
        'IMAGE_GET',
        'LIBRARY_QUERY',
        'JOBS_QUERY',
        'LIBRARY_HISTORY',
        'BACKUP_EXPORT',
      ].includes(message.type)
        ? await run()
        : await serial(run)
      respond({ ok: true, data })
      if (
        [
          'IMPORT_START',
          'IMPORT_RESUME',
          'REFRESH_ORDERS',
          'CONTENT_READY',
          'IMPORT_PAUSE',
        ].includes(message.type)
      )
        void pump()
    } catch (error) {
      respond({ ok: false, error: error.message })
    }
  })()
  return true
})
chrome.action.onClicked.addListener(() => {
  void openLibrary().catch((error) => console.error(error.message))
})
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === alarmName) void pump()
})
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'complete') void pump()
})
chrome.tabs.onRemoved.addListener((tabId) => {
  void serial(() =>
    usingRepository(async (repository, controller) => {
      await controller.removedTab(tabId)
      await changed()
    })
  ).catch((error) => console.error(error.message))
})
function startup() {
  void serial(() =>
    usingRepository(async (repository, controller) => {
      await controller.startup()
      await changed()
    })
  ).catch((error) => console.error(error.message))
}
chrome.runtime.onStartup.addListener(startup)
chrome.runtime.onInstalled.addListener(startup)
