import { openDatabase } from './database.js'
import { createImportController } from './import-controller.js'
import { detailUrl, isListUrl } from './order-list.js'
import { loadThumbnail } from './images.js'
import { financialDiagnostics } from './import-diagnostics.js'
import { createImportReport, importJobView } from './import-report.js'

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

async function broadcast(type) {
  try {
    await chrome.runtime.sendMessage({ type })
  } catch {
    /* The library may be closed. */
  }
}
const changed = () => broadcast('LIBRARY_CHANGED')
const progress = () => broadcast('IMPORT_PROGRESS')
const marker = (id) => `#1688tocsv-import=${encodeURIComponent(id)}`
const blankUrl = (url) => !url || url === 'about:blank'
const detailTabUrl = (tab) =>
  detailUrl(tab.pendingUrl) ? tab.pendingUrl : tab.url
function owns(tab, id) {
  try {
    // A blank pending URL can be a browser loading placeholder. A concrete
    // unrelated destination means the user or sign-in flow owns the tab now.
    if (!blankUrl(tab.pendingUrl) && !detailUrl(tab.pendingUrl)) return false
    const url = detailTabUrl(tab)
    return Boolean(detailUrl(url)) && new URL(url).hash === marker(id)
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
    throw Object.assign(
      new Error(response?.error || 'The order page did not respond.'),
      {
        retryable: response?.retryable === true,
        diagnostics: financialDiagnostics(response?.diagnostics),
      }
    )
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
      if (detailUrl(detailTabUrl(existing)) !== detailUrl(url))
        await chrome.tabs.update(existing.id, { url: `${url}${marker(id)}` })
      return existing.id
    }
    const tab = await chrome.tabs.create({
      url: `${url}${marker(id)}`,
      active: true,
    })
    return tab.id
  },
  async navigateDetailTab(tabId, url, id) {
    const tab = await this.getDetailTab(tabId, id)
    if (!tab)
      throw new Error(
        'The import tab was closed or changed. Resume to reopen it.'
      )
    if (detailUrl(detailTabUrl(tab)) !== detailUrl(url))
      await chrome.tabs.update(tabId, { url: `${url}${marker(id)}` })
  },
  async getDetailTab(tabId, id) {
    let tab
    try {
      tab = await chrome.tabs.get(tabId)
    } catch (error) {
      // Browser API failures do not prove that the tab was closed.
      let tabs
      try {
        tabs = await chrome.tabs.query({})
      } catch {
        throw error
      }
      if (!tabs.some((candidate) => candidate.id === tabId)) return null
      throw error
    }
    if (!id) return tab
    if (owns(tab, id))
      return {
        ...tab,
        pendingUrl: detailUrl(tab.pendingUrl) ? tab.pendingUrl : undefined,
      }
    if (blankUrl(tab.url) && blankUrl(tab.pendingUrl)) {
      if (tab.status === 'loading') return tab
      throw new Error(
        'The browser did not provide the import tab URL. Refresh the order page, then resume.'
      )
    }
    throw new Error(
      'The import tab left its marked order page. Complete sign-in or verification, then resume.'
    )
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
  progress,
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
        usingRepository((repository, controller) => controller.tick())
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
  return chrome.tabs.create({ url, active: true })
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
function sameSource(job, sender) {
  return (
    job.source?.tabId === sender.tab?.id &&
    (job.source?.frameId ?? 0) === (sender.frameId ?? 0)
  )
}
function jobStatus(job) {
  const { id, state, phase, kind, scope, page, total, updatedAt } = job
  const completed = job.orders.filter((order) => order.state === 'done').length
  return {
    id,
    state,
    phase,
    kind,
    scope,
    page,
    total,
    updatedAt,
    error:
      job.error ||
      (state !== 'running' &&
        job.orders.find((order) => order.state === 'failed')?.error) ||
      '',
    completed,
    remaining: Math.max(0, Math.max(total || 0, job.orders.length) - completed),
    failed: job.orders.filter((order) => order.state === 'failed').length,
    discovered: job.orders.length,
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
    case 'OPEN_LIBRARY_HERE': {
      requireContent(sender, isListUrl(sender.url) ? 'list' : 'detail')
      const tabId = sender.tab.id
      if (
        (await repository.listJobs()).some(
          (job) =>
            job.state === 'running' &&
            (job.source?.tabId === tabId || job.workerTabId === tabId)
        )
      )
        throw new Error(
          'Pause or finish this import before opening the spreadsheet in this tab.'
        )
      return chrome.tabs.update(tabId, {
        url: chrome.runtime.getURL('library.html'),
        active: true,
      })
    }
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
        expectedScope: message.expectedScope,
        source: { tabId: sender.tab.id, frameId: sender.frameId ?? 0 },
      })
    case 'IMPORT_STATUS':
      requireContent(sender, 'list')
      return {
        jobs: (await repository.listJobs())
          .filter((job) => !job.dismissedAt && sameSource(job, sender))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map(jobStatus),
      }
    case 'IMPORT_REPORT': {
      requireContent(sender, 'list')
      const job =
        typeof message.jobId === 'string'
          ? await repository.getJob(message.jobId)
          : undefined
      if (!job)
        throw new Error(
          'This import is no longer available. Refresh the order list.'
        )
      if (!sameSource(job, sender))
        throw new Error('This import belongs to another order-list tab.')
      return createImportReport(job, chrome.runtime.getManifest().version)
    }
    case 'IMPORT_PAUSE':
    case 'IMPORT_RESUME': {
      if (!isExtensionPage(sender)) {
        requireContent(sender, 'list')
        const job = await repository.getJob(message.jobId)
        if (!job || !sameSource(job, sender))
          throw new Error('This import belongs to another order-list tab.')
      }
      return message.type === 'IMPORT_PAUSE'
        ? controller.pause(message.jobId)
        : controller.resume(message.jobId)
    }
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
        jobs: (await repository.listJobs()).map(importJobView),
      }
    case 'JOBS_QUERY':
      return { jobs: (await repository.listJobs()).map(importJobView) }
    case 'LIBRARY_HISTORY':
      return repository.getHistory(message.orderId)
    case 'IMAGE_GET':
      return loadThumbnail(message.url, repository)
    case 'BACKUP_EXPORT':
      return repository.exportBackup()
    case 'REFRESH_ORDERS':
      return controller.refresh(message.orderIds)
    case 'IMPORT_DISMISS':
      return controller.dismiss(message.jobId)
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
  if (['LIBRARY_CHANGED', 'IMPORT_PROGRESS'].includes(message?.type)) return
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
        'IMPORT_STATUS',
        'IMPORT_REPORT',
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
    usingRepository((repository, controller) => controller.removedTab(tabId))
  ).catch((error) => console.error(error.message))
})
function startup() {
  void serial(() =>
    usingRepository((repository, controller) => controller.startup())
  ).catch((error) => console.error(error.message))
}
chrome.runtime.onStartup.addListener(startup)
chrome.runtime.onInstalled.addListener(startup)
