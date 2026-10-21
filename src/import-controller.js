import { detailUrl } from './order-list.js'
import { financialDiagnostics } from './import-diagnostics.js'

const active = (job) => job.state === 'running'
const errorText = (error) =>
  String(error?.message || error || 'The import could not continue.').slice(
    0,
    500
  )

function summarize(job) {
  job.completed = job.orders.filter((order) => order.state === 'done').length
  job.failed = job.orders.filter((order) => order.state === 'failed').length
  job.discovered = job.orders.length
  job.remaining = Math.max(
    0,
    Math.max(job.total || 0, job.discovered) - job.completed
  )
  return job
}

export function createImportController({
  repository,
  browser,
  now = () => Date.now(),
  makeId = () => crypto.randomUUID(),
}) {
  async function write(job) {
    job.updatedAt = new Date(now()).toISOString()
    await repository.putJob(summarize(job))
    await browser.progress()
    return job
  }

  async function ensureIdle() {
    if ((await repository.listJobs()).some(active))
      throw new Error('Pause the current import before starting another one.')
  }

  function baseJob(kind) {
    return {
      id: makeId(),
      accountId: 'local',
      kind,
      state: 'running',
      phase: 'details',
      createdAt: new Date(now()).toISOString(),
      updatedAt: new Date(now()).toISOString(),
      orders: [],
      page: 0,
      total: 0,
      error: '',
      workerTabId: null,
    }
  }

  function queued(order) {
    const sourceUrl = detailUrl(order.sourceUrl, order.orderId)
    if (!sourceUrl) throw new Error('An order has an unsupported detail URL.')
    return {
      orderId: order.orderId,
      sourceUrl,
      ...(order.purchasedAt ? { purchasedAt: order.purchasedAt } : {}),
      expectedRows: order.expectedRows,
      state: 'pending',
      error: '',
    }
  }

  async function releaseWorker(job) {
    const tabId = job.workerTabId
    job.workerTabId = null
    job.currentOrderId = null
    job.detailStartedAt = null
    job.detailAttempts = 0
    job.detailNavigationPending = false
    job.detailStage = null
    job.currentRows = null
    job.detailError = ''
    // Checkpoint before closing, so the tab-removal event is not mistaken for a user interruption.
    await write(job)
    await browser.closeDetailTab(tabId, job.id)
  }

  async function pause(jobId, reason = 'Paused by you.', { attention } = {}) {
    const job = await repository.getJob(jobId)
    if (!job) throw new Error('That import no longer exists.')
    if (!active(job)) return job
    job.state = 'paused'
    job.error = reason
    // A sign-in or verification step is shown once in the workspace with a
    // button to open the tab; the importer never switches tabs by itself.
    job.attention =
      attention &&
      (Number.isInteger(job.workerTabId) || attention === 'visible-reader')
        ? {
            kind: attention,
            tabId: Number.isInteger(job.workerTabId) ? job.workerTabId : null,
            orderId: job.currentOrderId ?? null,
            at: new Date(now()).toISOString(),
          }
        : null
    await releaseWorker(job)
    return job
  }

  async function start({ scope, orderIds, source, expectedScope }) {
    await ensureIdle()
    if (!['all', 'selected'].includes(scope))
      throw new Error('Choose all filtered orders or selected orders.')
    if (
      !source ||
      !Number.isInteger(source.tabId) ||
      !Number.isInteger(source.frameId)
    )
      throw new Error('Start import from the order-list page.')
    const list = await browser.readList(source)
    if (
      expectedScope &&
      (list.filterKey !== expectedScope.filterKey ||
        list.total !== expectedScope.total ||
        list.pageSize !== expectedScope.pageSize)
    )
      throw new Error(
        'The order-list filters or count changed. Review the import again before continuing.'
      )
    const job = baseJob('import')
    Object.assign(job, {
      source,
      scope,
      filterKey: list.filterKey,
      total: list.total,
      pageSize: list.pageSize,
      sourcePage: list.page,
    })
    if (scope === 'all') {
      job.phase = 'scan'
      job.nextPage = 1
    } else {
      const ids =
        orderIds ||
        list.orders
          .filter((order) => order.selected)
          .map((order) => order.orderId)
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.some((id) => typeof id !== 'string')
      )
        throw new Error('Select at least one order on this page.')
      const requested = new Set(ids)
      const orders = list.orders.filter((order) => requested.has(order.orderId))
      if (orders.length !== requested.size)
        throw new Error(
          'Selected orders changed. Select them again on the current page.'
        )
      job.orders = orders.map(queued)
      job.total = job.orders.length
    }
    await write(job)
    await browser.schedule()
    return job
  }

  async function refresh(orderIds) {
    await ensureIdle()
    const records = await repository.listOrders()
    if (
      orderIds !== undefined &&
      (!Array.isArray(orderIds) ||
        orderIds.some((id) => typeof id !== 'string'))
    )
      throw new Error('Invalid order selection.')
    const ids =
      orderIds === undefined
        ? new Set(records.map((record) => record.snapshot.orderId))
        : new Set(orderIds)
    const orders = records.filter((record) => ids.has(record.snapshot.orderId))
    if (!orders.length || orders.length !== ids.size)
      throw new Error('Choose saved orders to refresh.')
    if (orders.some((record) => record.snapshot.source === 'other'))
      throw new Error('Orders from other sources cannot be refreshed from 1688')
    const job = baseJob('refresh')
    // A refreshed order may have gained or lost lines; old row counts are not completeness evidence.
    job.orders = orders.map((record) => queued(record.snapshot))
    job.total = job.orders.length
    await write(job)
    await browser.schedule()
    return job
  }

  async function resume(jobId) {
    await ensureIdle()
    const job = await repository.getJob(jobId)
    if (!job) throw new Error('That import no longer exists.')
    if (!['paused', 'completed-with-errors'].includes(job.state))
      throw new Error('This import has nothing to resume.')
    if (job.phase === 'scan') {
      const list = await browser.readList(job.source)
      assertList(job, list)
      if (![job.page, job.nextPage, job.sourcePage].includes(list.page))
        throw new Error(
          'Return the order list to the page where import paused before resuming.'
        )
    }
    const missingRows = job.orders.filter(
      (order) => order.state === 'done' && !Number.isInteger(order.savedRows)
    )
    if (missingRows.length) {
      const savedRows = new Map(
        (await repository.listOrders())
          .filter((record) => Array.isArray(record.snapshot?.items))
          .map((record) => [
            record.snapshot.orderId,
            record.snapshot.items.length,
          ])
      )
      for (const order of missingRows)
        if (savedRows.has(order.orderId))
          order.savedRows = savedRows.get(order.orderId)
    }
    for (const order of job.orders)
      if (order.state === 'failed')
        Object.assign(order, { state: 'pending', error: '' })
    job.state = 'running'
    delete job.dismissedAt
    job.error = ''
    job.attention = null
    await write(job)
    await browser.schedule()
    return job
  }

  async function dismiss(jobId) {
    const job = await repository.getJob(jobId)
    if (!job) throw new Error('That import no longer exists.')
    if (active(job)) throw new Error('Pause the import before dismissing it.')
    job.dismissedAt = new Date(now()).toISOString()
    await write(job)
    return job
  }

  function assertList(job, list) {
    if (list.filterKey !== job.filterKey)
      throw new Error(
        'The order-list filters changed. Restore the original filters to resume, or start a new import.'
      )
    if (list.total !== job.total || list.pageSize !== job.pageSize)
      throw new Error(
        'The filtered order list changed. Start a new import to scan it consistently.'
      )
  }

  async function scan(job) {
    let list = await browser.readList(job.source)
    assertList(job, list)
    if (list.page !== job.nextPage) {
      if (![job.page, job.sourcePage].includes(list.page))
        throw new Error(
          'The order-list page changed unexpectedly. Import paused.'
        )
      job.pendingPage = job.nextPage
      await write(job) // The target survives worker termination and a full-page navigation.
      list = await browser.changePage(job.source, job.nextPage)
      assertList(job, list)
    }
    if (list.page !== job.nextPage)
      throw new Error('The order list did not reach the requested page.')
    const pageIds = list.orders.map((order) => order.orderId).join(',')
    if (job.previousPageIds === pageIds && job.page !== list.page)
      throw new Error('Pagination returned the same orders. Import paused.')
    const known = new Set(job.orders.map((order) => order.orderId))
    for (const order of list.orders)
      if (!known.has(order.orderId)) {
        job.orders.push(queued(order))
        known.add(order.orderId)
      }
    job.page = list.page
    job.sourcePage = list.page
    job.pendingPage = null
    job.previousPageIds = pageIds
    job.nextPage = list.page + 1
    if (list.page >= Math.max(1, Math.ceil(list.total / list.pageSize))) {
      if (job.orders.length !== job.total)
        throw new Error(
          'Orders shifted between pages. Start a new import to avoid missing orders.'
        )
      job.phase = 'details'
    }
    await write(job)
    return 'continue'
  }

  /** The sign-in error when the reader tab has left this order's page, else null. */
  async function leftOrderPage(job, order) {
    let tab
    try {
      tab = await browser.getDetailTab(job.workerTabId, job.id)
    } catch (error) {
      return error?.attention ? error : null
    }
    if (
      tab?.url &&
      tab.status === 'complete' &&
      !detailUrl(tab.url, order.orderId)
    )
      return Object.assign(
        new Error(
          'The import tab left the order page. Complete sign-in or verification, then resume.'
        ),
        { attention: 'sign-in' }
      )
    return null
  }

  async function details(job) {
    const order = job.orders.find((item) => item.state === 'pending')
    if (!order) {
      job.state = job.orders.some((item) => item.state === 'failed')
        ? 'completed-with-errors'
        : 'completed'
      await releaseWorker(job)
      return 'finished'
    }
    if (!Number.isInteger(job.workerTabId)) {
      job.currentOrderId = order.orderId
      job.detailStartedAt = now()
      job.detailAttempts = 0
      job.detailStage = 'loading'
      job.currentRows = null
      job.detailError = ''
      await write(job)
      const reader = await browser.openDetailTab(order.sourceUrl, job.id, {
        allowVisible: job.allowVisibleReader === true,
      })
      job.workerTabId = typeof reader === 'object' ? reader.id : reader
      job.visibleReader = typeof reader === 'object' && reader.visible === true
      await write(job)
      return 'wait'
    }
    const tab = await browser.getDetailTab(job.workerTabId, job.id)
    if (!tab) throw new Error('The import tab was closed. Resume to reopen it.')
    if (
      !job.detailNavigationPending &&
      job.currentOrderId &&
      tab.status === 'complete' &&
      !detailUrl(tab.pendingUrl || tab.url, job.currentOrderId)
    )
      throw Object.assign(
        new Error(
          'The import tab left the order page. Complete sign-in or verification, then resume.'
        ),
        { attention: 'sign-in' }
      )
    if (job.currentOrderId !== order.orderId) {
      job.currentOrderId = order.orderId
      job.detailStartedAt = now()
      job.detailAttempts = 0
      job.detailNavigationPending = true
      job.detailStage = 'loading'
      job.currentRows = null
      job.detailError = ''
      await write(job)
    }
    if (job.detailNavigationPending) {
      // Repeating navigation after a worker interruption is safe: the adapter
      // checks the target URL before navigating the single owned tab again.
      if (job.detailStage !== 'loading') {
        job.detailStage = 'loading'
        await write(job)
      }
      await browser.navigateDetailTab(job.workerTabId, order.sourceUrl, job.id)
      job.detailNavigationPending = false
      await write(job)
      return 'wait'
    }
    if (tab.status !== 'complete') {
      if (now() - job.detailStartedAt > 90000)
        throw new Error(
          'The order page did not finish loading. Check your connection or sign-in, then resume.'
        )
      return 'wait'
    }
    if (tab.url && !detailUrl(tab.url, order.orderId))
      throw Object.assign(
        new Error(
          'The import tab left the order page. Complete sign-in or verification, then resume.'
        ),
        { attention: 'sign-in' }
      )
    job.detailAttempts += 1
    job.detailStage = 'reading'
    await write(job)
    let snapshot,
      saved = false
    try {
      snapshot = await browser.readDetail(job.workerTabId, order.orderId)
      if (
        snapshot.orderId !== order.orderId ||
        !detailUrl(snapshot.sourceUrl, order.orderId)
      )
        throw new Error('The detail page returned a different order.')
      if (order.expectedRows && snapshot.items.length !== order.expectedRows)
        throw new Error(
          `Expected ${order.expectedRows} product rows but read ${snapshot.items.length}. No saved data was replaced.`
        )
      job.currentRows = snapshot.items.length
      job.detailStage = 'saving'
      await write(job)
      await repository.saveSnapshot({
        ...snapshot,
        ...(order.purchasedAt ? { purchasedAt: order.purchasedAt } : {}),
      })
      saved = true
      order.state = 'done'
      order.error = ''
      order.savedRows = snapshot.items.length
      job.detailError = ''
      job.latestResult = {
        orderId: order.orderId,
        outcome: 'saved',
        rows: order.savedRows,
        sellerName: String(snapshot.sellerName || '').slice(0, 160),
        payable: String(snapshot.totals?.payable || ''),
        at: new Date(now()).toISOString(),
      }
    } catch (error) {
      // A sign-in or verification redirect during the read is not an order
      // failure: pause with the notice instead (issue 10 R7).
      if (!saved) {
        const left = await leftOrderPage(job, order)
        if (left) throw left
      }
      if (
        error?.retryable &&
        job.detailAttempts < 3 &&
        now() - job.detailStartedAt < 90000
      ) {
        job.detailStage = 'retrying'
        job.detailError = errorText(error)
        await write(job)
        return 'wait'
      }
      order.state = 'failed'
      order.error = errorText(error)
      order.lastFailure = {
        at: new Date(now()).toISOString(),
        message: order.error,
        diagnostics: financialDiagnostics(error?.diagnostics),
      }
      job.latestResult = {
        orderId: order.orderId,
        outcome: 'failed',
        error: order.error,
        at: new Date(now()).toISOString(),
      }
    }
    job.detailStage = 'next'
    await write(job)
    if (saved) await browser.changed()
    return 'continue'
  }

  async function tick() {
    const job = (await repository.listJobs()).find(active)
    if (!job) {
      await browser.unschedule()
      return 'finished'
    }
    try {
      return job.phase === 'scan' ? await scan(job) : await details(job)
    } catch (error) {
      await pause(job.id, errorText(error), { attention: error?.attention })
      return 'finished'
    }
  }

  async function startup() {
    for (const job of await repository.listJobs())
      if (active(job))
        await pause(job.id, 'Browser restarted. Resume when you are ready.')
    await browser.unschedule()
  }

  async function removedTab(tabId) {
    for (const job of await repository.listJobs()) {
      if (!active(job)) continue
      if (
        (job.phase === 'scan' && job.source?.tabId === tabId) ||
        job.workerTabId === tabId
      ) {
        await pause(
          job.id,
          job.source?.tabId === tabId
            ? 'The order-list tab was closed.'
            : 'The import tab was closed. Resume to reopen it.'
        )
      }
    }
  }

  /** The owner allowed a visible reader for this import; continue it. */
  async function allowVisibleReader(jobId) {
    const job = await repository.getJob(jobId)
    if (!job) throw new Error('That import no longer exists.')
    job.allowVisibleReader = true
    await write(job)
    return resume(jobId)
  }

  return {
    start,
    refresh,
    pause,
    resume,
    dismiss,
    tick,
    startup,
    removedTab,
    allowVisibleReader,
  }
}
