import test from 'node:test'
import assert from 'node:assert/strict'
import { createImportController } from '../src/import-controller.js'
import { createImportReport } from '../src/import-report.js'

const url = (id) =>
  `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${id}`
const row = (id, extra = {}) => ({
  orderId: id,
  sourceUrl: url(id),
  expectedRows: 2,
  ...extra,
})
const snapshot = (id) => ({ orderId: id, sourceUrl: url(id), items: [{}, {}] })
function setup(pages = [[row('10001'), row('10002')]], pageSize = 2) {
  const jobs = new Map(),
    saved = new Map(),
    calls = []
  let page = 1,
    filters = 'original',
    clock = 1000,
    id = 0,
    tab = null
  const repository = {
    async getJob(id) {
      return structuredClone(jobs.get(id))
    },
    async putJob(job) {
      jobs.set(job.id, structuredClone(job))
    },
    async listJobs() {
      return structuredClone([...jobs.values()])
    },
    async listOrders() {
      return [...saved.values()].map((snapshot) => ({ snapshot }))
    },
    async saveSnapshot(value) {
      saved.set(value.orderId, value)
    },
  }
  function list() {
    return {
      page,
      pageSize,
      total: pages.flat().length,
      filterKey: filters,
      orders: pages[page - 1],
    }
  }
  const browser = {
    async readList() {
      return list()
    },
    async changePage(source, next) {
      calls.push(['page', next])
      page = next
      return list()
    },
    async openDetailTab(sourceUrl, jobId) {
      calls.push(['open', sourceUrl, jobId])
      tab = { id: 42, url: sourceUrl, status: 'complete' }
      return 42
    },
    async getDetailTab() {
      return tab
    },
    async navigateDetailTab(tabId, sourceUrl, jobId) {
      assert.equal(tabId, 42)
      calls.push(['navigate', sourceUrl, jobId])
      tab = { ...tab, url: sourceUrl, status: 'complete' }
    },
    async closeDetailTab(tabId, jobId) {
      calls.push(['close', tabId, jobId])
      tab = null
    },
    async readDetail(tabId, orderId) {
      return snapshot(orderId)
    },
    async schedule() {
      calls.push(['schedule'])
    },
    async unschedule() {
      calls.push(['unschedule'])
    },
    async changed() {
      calls.push(['changed'])
    },
    async progress() {
      calls.push(['progress'])
    },
  }
  const controller = createImportController({
    repository,
    browser,
    now: () => clock,
    makeId: () => `job-${++id}`,
  })
  return {
    controller,
    repository,
    browser,
    jobs,
    saved,
    calls,
    setFilter: (value) => {
      filters = value
    },
    setPage: (value) => {
      page = value
    },
    advance: (value) => {
      clock += value
    },
    setTab: (value) => {
      tab = value
    },
  }
}
const source = { tabId: 5, frameId: 2 }

function deferred() {
  let resolve
  const promise = new Promise((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

test('detail progress checkpoints distinguish blocked reads and saves from completed work', async () => {
  const s = setup()
  const reading = deferred(),
    readResult = deferred(),
    saving = deferred(),
    saveResult = deferred()
  s.browser.readDetail = async () => {
    reading.resolve()
    return readResult.promise
  }
  const saveSnapshot = s.repository.saveSnapshot
  s.repository.saveSnapshot = async (value) => {
    saving.resolve()
    await saveResult.promise
    await saveSnapshot(value)
  }
  const job = await s.controller.start({
    scope: 'selected',
    source,
    orderIds: ['10001', '10002'],
  })
  await s.controller.tick()
  assert.equal(s.jobs.get(job.id).detailStage, 'loading')
  const tick = s.controller.tick()
  await reading.promise
  const readingJob = s.jobs.get(job.id)
  assert.equal(readingJob.detailStage, 'reading')
  assert.equal(readingJob.currentOrderId, '10001')
  assert.equal(readingJob.currentRows, null)
  assert.equal(readingJob.completed, 0)
  assert.equal(readingJob.latestResult, undefined)

  s.advance(1000)
  readResult.resolve({
    ...snapshot('10001'),
    sellerName: 'Synthetic seller',
    totals: { payable: '12.34' },
  })
  await saving.promise
  const savingJob = s.jobs.get(job.id)
  assert.equal(savingJob.detailStage, 'saving')
  assert.equal(savingJob.currentRows, 2)
  assert.equal(savingJob.completed, 0)
  assert.equal(savingJob.orders[0].savedRows, undefined)
  assert.equal(savingJob.latestResult, undefined)
  assert.equal(s.saved.size, 0)
  assert.equal(s.calls.filter(([type]) => type === 'changed').length, 0)

  saveResult.resolve()
  await tick
  const completed = s.jobs.get(job.id)
  assert.equal(completed.detailStage, 'next')
  assert.equal(completed.completed, 1)
  assert.equal(completed.orders[0].savedRows, 2)
  assert.deepEqual(completed.latestResult, {
    orderId: '10001',
    outcome: 'saved',
    rows: 2,
    sellerName: 'Synthetic seller',
    payable: '12.34',
    at: '1970-01-01T00:00:02.000Z',
  })
  await s.controller.tick()
  assert.equal(s.jobs.get(job.id).detailStage, 'loading')
  assert.equal(s.jobs.get(job.id).currentOrderId, '10002')
  assert.equal(s.jobs.get(job.id).currentRows, null)
  assert.deepEqual(s.jobs.get(job.id).latestResult, completed.latestResult)
})

test('retry checkpoints retain bounded reasons without counting attempts as collected orders', async () => {
  const s = setup([[row('10001')]])
  const reason = 'The order is still loading. '.repeat(40)
  s.browser.readDetail = async () => {
    throw Object.assign(new Error(reason), { retryable: true })
  }
  const job = await s.controller.start({
    scope: 'selected',
    source,
    orderIds: ['10001'],
  })
  await s.controller.tick()
  for (let attempt = 1; attempt <= 2; attempt++) {
    assert.equal(await s.controller.tick(), 'wait')
    const retrying = s.jobs.get(job.id)
    assert.equal(retrying.detailStage, 'retrying')
    assert.equal(retrying.detailAttempts, attempt)
    assert.equal(retrying.detailError, reason.slice(0, 500))
    assert.equal(retrying.completed, 0)
    assert.equal(retrying.failed, 0)
    assert.equal(retrying.latestResult, undefined)
    assert.equal(retrying.orders[0].savedRows, undefined)
  }
  assert.equal(await s.controller.tick(), 'continue')
  const failed = s.jobs.get(job.id)
  assert.equal(failed.detailStage, 'next')
  assert.equal(failed.detailAttempts, 3)
  assert.equal(failed.completed, 0)
  assert.equal(failed.failed, 1)
  assert.deepEqual(failed.latestResult, {
    orderId: '10001',
    outcome: 'failed',
    error: reason.slice(0, 500),
    at: '1970-01-01T00:00:01.000Z',
  })
  assert.equal(s.saved.size, 0)
})

test('successful retry clears its error and counts saved rows once', async () => {
  const s = setup([[row('10001')]])
  s.browser.readDetail = async () => {
    throw Object.assign(new Error('Waiting for product rows'), {
      retryable: true,
    })
  }
  const job = await s.controller.start({
    scope: 'selected',
    source,
    orderIds: ['10001'],
  })
  await s.controller.tick()
  await s.controller.tick()
  s.browser.readDetail = async () => ({
    ...snapshot('10001'),
    sellerName: 'x'.repeat(300),
  })
  await s.controller.tick()
  const saved = s.jobs.get(job.id)
  assert.equal(saved.detailError, '')
  assert.equal(saved.orders[0].savedRows, 2)
  assert.equal(saved.latestResult.rows, 2)
  assert.equal(saved.latestResult.sellerName.length, 160)
  assert.equal(saved.completed, 1)
  assert.equal(saved.failed, 0)
  assert.equal(s.calls.filter(([type]) => type === 'changed').length, 1)
})

test('legacy saved-row totals are backfilled only on resume without replacing snapshots or known counts', async () => {
  const s = setup([[row('10001'), row('10002'), row('10003'), row('10004')]])
  let listCalls = 0
  const listOrders = s.repository.listOrders
  s.repository.listOrders = async () => {
    listCalls++
    return listOrders()
  }
  const job = await s.controller.start({
    scope: 'selected',
    source,
    orderIds: ['10001', '10002', '10003', '10004'],
  })
  await s.controller.tick()
  await s.controller.tick()
  await s.controller.pause(job.id)
  assert.equal(listCalls, 0)
  const legacy = s.jobs.get(job.id)
  delete legacy.orders[0].savedRows
  legacy.orders[1].state = 'done'
  legacy.orders[2].state = 'done'
  legacy.orders[2].savedRows = 7
  const original = s.saved.get('10001')
  s.saved.set('10003', snapshot('10003'))
  await s.controller.resume(job.id)
  assert.equal(listCalls, 1)
  const resumed = s.jobs.get(job.id)
  assert.equal(resumed.orders[0].savedRows, 2)
  assert.equal(resumed.orders[1].savedRows, undefined)
  assert.equal(resumed.orders[2].savedRows, 7)
  assert.equal(resumed.orders[3].savedRows, undefined)
  assert.equal(s.saved.get('10001'), original)
  assert.equal(s.saved.size, 2)
})

test('pause and restart clear current read progress while retaining the last result', async () => {
  for (const stop of ['pause', 'startup']) {
    const s = setup()
    const job = await s.controller.start({
      scope: 'selected',
      source,
      orderIds: ['10001', '10002'],
    })
    await s.controller.tick()
    await s.controller.tick()
    const latestResult = structuredClone(s.jobs.get(job.id).latestResult)
    await s.controller.tick()
    s.browser.readDetail = async () => {
      throw Object.assign(new Error('Rows are loading'), { retryable: true })
    }
    await s.controller.tick()
    assert.equal(s.jobs.get(job.id).detailStage, 'retrying')
    await s.controller[stop](job.id)
    const paused = s.jobs.get(job.id)
    assert.equal(paused.state, 'paused')
    assert.equal(paused.currentOrderId, null)
    assert.equal(paused.detailStage, null)
    assert.equal(paused.currentRows, null)
    assert.equal(paused.detailError, '')
    assert.equal(paused.detailStartedAt, null)
    assert.equal(paused.detailAttempts, 0)
    assert.deepEqual(paused.latestResult, latestResult)
    assert.equal(paused.orders[0].savedRows, 2)
  }
})

test('67-page import checkpoints every order, continues after failures, and retries only failures', async () => {
  const all = Array.from({ length: 667 }, (_, i) => row(String(10000 + i)))
  const pages = Array.from({ length: 67 }, (_, i) =>
    all.slice(i * 10, (i + 1) * 10)
  )
  const s = setup(pages, 10)
  const readIds = []
  const failures = new Set(['10002', '10333', '10666'])
  s.browser.readDetail = async (tabId, orderId) => {
    readIds.push(orderId)
    if (failures.has(orderId))
      throw new Error('Unsupported order total: synthetic charge.')
    return snapshot(orderId)
  }
  const job = await s.controller.start({ scope: 'all', source })
  for (let i = 0; i < 20; i++) await s.controller.tick()
  await s.controller.pause(job.id)
  assert.equal(s.jobs.get(job.id).discovered, 200)
  await s.controller.tick()
  assert.equal(s.jobs.get(job.id).discovered, 200)
  assert.equal(readIds.length, 0)
  const resumed = createImportController({
    repository: s.repository,
    browser: s.browser,
  })
  await resumed.resume(job.id)
  for (let i = 0; i < 47; i++) await resumed.tick()
  assert.equal(s.jobs.get(job.id).phase, 'details')
  assert.equal(s.jobs.get(job.id).discovered, 667)
  assert.equal(s.saved.size, 0)
  for (let i = 0; i < 1400 && s.jobs.get(job.id).state === 'running'; i++)
    await resumed.tick()
  const finished = s.jobs.get(job.id)
  assert.equal(finished.state, 'completed-with-errors')
  assert.equal(finished.completed, 664)
  assert.equal(finished.failed, 3)
  assert.equal(finished.remaining, 3)
  assert.equal(s.saved.size, 664)
  assert.equal(new Set(readIds).size, 667)
  assert.equal(s.calls.filter(([type]) => type === 'open').length, 1)
  const pageCalls = s.calls.filter(([type]) => type === 'page').length
  const successfulRecords = new Map(s.saved)
  failures.clear()
  readIds.length = 0
  await resumed.resume(job.id)
  for (let i = 0; i < 10 && s.jobs.get(job.id).state === 'running'; i++)
    await resumed.tick()
  assert.deepEqual(readIds, ['10002', '10333', '10666'])
  assert.equal(s.calls.filter(([type]) => type === 'page').length, pageCalls)
  assert.equal(s.jobs.get(job.id).state, 'completed')
  assert.equal(s.jobs.get(job.id).completed, 667)
  assert.equal(s.jobs.get(job.id).remaining, 0)
  assert.equal(s.saved.size, 667)
  for (const [id, value] of successfulRecords)
    assert.equal(s.saved.get(id), value)
})

test('all matching scans every page before reading complete sequential details', async () => {
  const s = setup([[row('10001'), row('10002')], [row('10003')]])
  s.setPage(2)
  const job = await s.controller.start({ scope: 'all', source })
  assert.equal(await s.controller.tick(), 'continue')
  assert.equal(await s.controller.tick(), 'continue')
  assert.deepEqual(
    s.calls.filter((x) => x[0] === 'page').map((x) => x[1]),
    [1, 2]
  )
  assert.equal(s.jobs.get(job.id).phase, 'details')
  assert.equal(s.saved.size, 0)
  for (let i = 0; i < 3; i++) {
    assert.equal(await s.controller.tick(), 'wait')
    assert.equal(await s.controller.tick(), 'continue')
  }
  assert.equal(await s.controller.tick(), 'finished')
  assert.equal(s.jobs.get(job.id).state, 'completed')
  assert.equal(s.jobs.get(job.id).completed, 3)
  assert.equal(s.saved.size, 3)
  assert.equal(s.calls.filter(([type]) => type === 'open').length, 1)
  assert.equal(s.calls.filter(([type]) => type === 'navigate').length, 2)
  assert.equal(s.calls.filter(([type]) => type === 'close').length, 1)
})

test('navigation checkpoints survive interruption without opening another tab', async () => {
  const s = setup()
  const job = await s.controller.start({
    scope: 'selected',
    source,
    orderIds: ['10001', '10002'],
  })
  await s.controller.tick()
  await s.controller.tick()
  const pending = s.jobs.get(job.id)
  Object.assign(pending, {
    currentOrderId: '10002',
    detailStartedAt: 1000,
    detailAttempts: 0,
    detailNavigationPending: true,
  })
  s.setTab({ id: 42, url: url('10002'), status: 'complete' })
  const resumed = createImportController({
    repository: s.repository,
    browser: s.browser,
  })
  await resumed.tick()
  await resumed.tick()
  await resumed.tick()
  assert.equal(s.jobs.get(job.id).state, 'completed')
  assert.equal(s.saved.size, 2)
  assert.equal(s.calls.filter(([type]) => type === 'open').length, 1)
})

test('paused jobs from version 2.0.0 resume without new navigation fields', async () => {
  const s = setup()
  const job = await s.controller.start({
    scope: 'selected',
    source,
    orderIds: ['10001'],
  })
  await s.controller.pause(job.id)
  const legacy = s.jobs.get(job.id)
  delete legacy.detailNavigationPending
  legacy.error = 'Owl extension-created tabs must be active.'
  await s.controller.resume(job.id)
  await s.controller.tick()
  await s.controller.tick()
  await s.controller.tick()
  assert.equal(s.jobs.get(job.id).state, 'completed')
  assert.equal(s.saved.size, 1)
})
test('selected imports validate IDs against the current page and prevent concurrent jobs', async () => {
  const s = setup()
  await assert.rejects(
    s.controller.start({ scope: 'selected', source, orderIds: ['99999'] }),
    /changed/
  )
  const job = await s.controller.start({
    scope: 'selected',
    source,
    orderIds: ['10002'],
  })
  assert.deepEqual(
    job.orders.map((x) => x.orderId),
    ['10002']
  )
  await assert.rejects(s.controller.start({ scope: 'all', source }), /Pause/)
})

test('bulk import rejects a scope changed after confirmation', async () => {
  const s = setup()
  const expectedScope = { filterKey: 'original', total: 2, pageSize: 2 }
  s.setFilter('different')
  await assert.rejects(
    s.controller.start({ scope: 'all', source, expectedScope }),
    /Review the import again/
  )
  assert.equal(s.jobs.size, 0)
  s.setFilter('original')
  await s.controller.start({ scope: 'all', source, expectedScope })
  assert.equal(s.jobs.size, 1)
})
test('filter drift pauses discovery without saving any order', async () => {
  const s = setup()
  const job = await s.controller.start({ scope: 'all', source })
  s.setFilter('different')
  await s.controller.tick()
  assert.equal(s.jobs.get(job.id).state, 'paused')
  assert.match(s.jobs.get(job.id).error, /filters changed/)
  assert.equal(s.saved.size, 0)
  await assert.rejects(s.controller.resume(job.id), /filters changed/)
  s.setFilter('original')
  await s.controller.resume(job.id)
  assert.equal(s.jobs.get(job.id).state, 'running')
})
test('duplicate shifted pages pause instead of quietly missing orders', async () => {
  const s = setup([[row('10001'), row('10002')], [row('10002')]])
  const job = await s.controller.start({ scope: 'all', source })
  await s.controller.tick()
  await s.controller.tick()
  assert.equal(s.jobs.get(job.id).state, 'paused')
  assert.match(s.jobs.get(job.id).error, /shifted/)
})
test('incomplete detail snapshots fail only their order and leave saved records untouched', async () => {
  const s = setup()
  const previous = snapshot('10001')
  s.saved.set('10001', previous)
  s.browser.readDetail = async () => ({ ...snapshot('10001'), items: [{}] })
  const job = await s.controller.start({
    scope: 'selected',
    source,
    orderIds: ['10001'],
  })
  await s.controller.tick()
  await s.controller.tick()
  await s.controller.tick()
  assert.equal(s.jobs.get(job.id).state, 'completed-with-errors')
  assert.match(s.jobs.get(job.id).orders[0].error, /Expected 2/)
  assert.equal(s.saved.get('10001'), previous)
  s.browser.readDetail = async () => snapshot('10001')
  await s.controller.resume(job.id)
  await s.controller.tick()
  await s.controller.tick()
  await s.controller.tick()
  assert.equal(s.jobs.get(job.id).state, 'completed')
})
test('database errors are failed saves, never counted as completed orders', async () => {
  const s = setup()
  s.repository.saveSnapshot = async () => {
    throw new Error('Disk is full')
  }
  const job = await s.controller.start({
    scope: 'selected',
    source,
    orderIds: ['10001'],
  })
  await s.controller.tick()
  await s.controller.tick()
  assert.equal(s.jobs.get(job.id).completed, 0)
  assert.equal(s.jobs.get(job.id).failed, 1)
  assert.match(s.jobs.get(job.id).orders[0].error, /Disk is full/)
})

test('last financial failure survives retry and successful save in the local import report', async () => {
  const s = setup()
  s.browser.readDetail = async () => {
    throw Object.assign(
      new Error('Unsupported order total: synthetic field.'),
      {
        diagnostics: {
          version: 1,
          extensionVersion: 'test',
          fields: [{ label: 'synthetic field', value: '减 ¥1.00' }],
          cookies: 'must not persist',
        },
      }
    )
  }
  const job = await s.controller.start({
    scope: 'selected',
    source,
    orderIds: ['10001'],
  })
  await s.controller.tick()
  await s.controller.tick()
  await s.controller.tick()
  const before = s.jobs.get(job.id).orders[0].lastFailure
  assert.equal(before.diagnostics.fields[0].value, '减 ¥1.00')
  assert.doesNotMatch(JSON.stringify(before), /must not persist|cookies/)
  await s.controller.resume(job.id)
  assert.deepEqual(s.jobs.get(job.id).orders[0].lastFailure, before)
  s.browser.readDetail = async (tabId, orderId) => snapshot(orderId)
  await s.controller.tick()
  await s.controller.tick()
  await s.controller.tick()
  const report = createImportReport(s.jobs.get(job.id), 'test')
  assert.equal(report.counts.failed, 0)
  assert.equal(report.orders[0].error, '')
  assert.equal(report.orders[0].state, 'done')
  assert.deepEqual(report.orders[0].lastFailure, before)
  assert.equal(s.saved.size, 1)
})
test('pending jobs survive controller recreation and browser restart pauses ownership', async () => {
  const s = setup()
  const job = await s.controller.start({
    scope: 'selected',
    source,
    orderIds: ['10001'],
  })
  await s.controller.tick()
  const resumed = createImportController({
    repository: s.repository,
    browser: s.browser,
  })
  await resumed.tick()
  assert.equal(s.saved.size, 1)
  await resumed.startup()
  assert.equal(s.jobs.get(job.id).state, 'paused')
  assert.equal(s.jobs.get(job.id).workerTabId, null)
  assert.equal(s.calls.at(-1)[0], 'unschedule')
})
test('closing source during scan and moving a detail tab to login pause safely', async () => {
  const s = setup()
  const job = await s.controller.start({ scope: 'all', source })
  await s.controller.removedTab(5)
  assert.equal(s.jobs.get(job.id).state, 'paused')
  await s.controller.resume(job.id)
  await s.controller.tick()
  await s.controller.tick()
  s.setTab({ url: 'https://login.1688.com/', status: 'complete' })
  await s.controller.tick()
  assert.equal(s.jobs.get(job.id).state, 'paused')
  assert.match(s.jobs.get(job.id).error, /sign-in/)
  // The workspace gets one notice pointing at the tab that needs the owner.
  assert.deepEqual(
    { ...s.jobs.get(job.id).attention, at: undefined },
    { kind: 'sign-in', tabId: 42, orderId: '10001', at: undefined }
  )
  // Resuming clears the notice and keeps the existing resume behaviour.
  s.setTab({ id: 42, url: url('10001'), status: 'complete' })
  await s.controller.resume(job.id)
  assert.equal(s.jobs.get(job.id).attention, null)
  assert.equal(s.jobs.get(job.id).state, 'running')
})

test('an ordinary pause or failure sets no sign-in notice', async () => {
  const s = setup()
  const job = await s.controller.start({ scope: 'all', source })
  await s.controller.tick()
  await s.controller.pause(job.id)
  assert.equal(s.jobs.get(job.id).attention, null)
})

test('a reader that the browser only allows visible is recorded for the workspace', async () => {
  const s = setup([[row('10001')]], 1)
  s.browser.openDetailTab = async (sourceUrl, jobId) => {
    s.calls.push(['open', sourceUrl, jobId])
    s.setTab({ id: 42, url: sourceUrl, status: 'complete' })
    return { id: 42, visible: true }
  }
  const job = await s.controller.start({ scope: 'all', source })
  await s.controller.tick()
  await s.controller.tick()
  assert.equal(s.jobs.get(job.id).workerTabId ?? 42, 42)
  assert.equal(s.jobs.get(job.id).visibleReader, true)
})
test('refresh does not use old row counts as proof of current completeness', async () => {
  const s = setup()
  s.saved.set('10001', snapshot('10001'))
  const job = await s.controller.refresh(['10001'])
  assert.equal(job.orders[0].expectedRows, undefined)
  s.browser.readDetail = async () => ({
    ...snapshot('10001'),
    items: [{}, {}, {}],
  })
  await s.controller.tick()
  await s.controller.tick()
  assert.equal(s.saved.get('10001').items.length, 3)
})

test('import carries the list purchase time and refresh preserves it', async () => {
  const purchasedAt = '2026-03-01T00:10:11+08:00'
  const s = setup([[row('10001', { purchasedAt })]])
  const job = await s.controller.start({
    scope: 'selected',
    source,
    orderIds: ['10001'],
  })
  s.browser.readDetail = async () => ({
    ...snapshot('10001'),
    purchasedAt: '2026-03-01T00:10:12+08:00',
  })
  await s.controller.tick()
  await s.controller.tick()
  await s.controller.tick()
  assert.equal(s.jobs.get(job.id).state, 'completed')
  assert.equal(s.saved.get('10001').purchasedAt, purchasedAt)
  const refresh = await s.controller.refresh()
  assert.equal(refresh.orders[0].purchasedAt, purchasedAt)
  await s.controller.tick()
  await s.controller.tick()
  assert.equal(s.saved.get('10001').purchasedAt, purchasedAt)
})

test('dismiss hides idle job history without removing saved orders or restarting work', async () => {
  const s = setup()
  s.saved.set('10001', snapshot('10001'))
  const job = await s.controller.start({
    scope: 'selected',
    source,
    orderIds: ['10001'],
  })
  await assert.rejects(s.controller.dismiss(job.id), /Pause the import/)
  assert.equal(s.jobs.get(job.id).dismissedAt, undefined)
  await s.controller.pause(job.id)
  const before = structuredClone(s.jobs.get(job.id))
  const callCount = s.calls.length
  s.advance(1000)
  const dismissed = await s.controller.dismiss(job.id)
  assert.equal(dismissed.dismissedAt, '1970-01-01T00:00:02.000Z')
  assert.equal(dismissed.state, 'paused')
  assert.deepEqual(dismissed.orders, before.orders)
  assert.equal(s.saved.size, 1)
  assert.deepEqual(s.calls.slice(callCount), [['progress']])
  await s.controller.resume(job.id)
  assert.equal(s.jobs.get(job.id).dismissedAt, undefined)
  assert.equal(s.jobs.get(job.id).state, 'running')
  await assert.rejects(s.controller.dismiss('missing'), /no longer exists/)
})

test('an empty explicit refresh selection never becomes refresh all', async () => {
  const s = setup()
  s.saved.set('10001', snapshot('10001'))
  await assert.rejects(s.controller.refresh([]), /Choose saved orders/)
  assert.equal(s.jobs.size, 0)
  assert.equal(s.calls.length, 0)
  const job = await s.controller.refresh()
  assert.deepEqual(
    job.orders.map((order) => order.orderId),
    ['10001']
  )
})

test('remaining counts include undiscovered bulk orders and exclude already saved orders', async () => {
  const s = setup([[row('10001'), row('10002')], [row('10003')]])
  const job = await s.controller.start({ scope: 'all', source })
  await s.controller.pause(job.id)
  assert.equal(s.jobs.get(job.id).scope, 'all')
  assert.equal(s.jobs.get(job.id).discovered, 0)
  assert.equal(s.jobs.get(job.id).remaining, 3)
  await s.controller.resume(job.id)
  await s.controller.tick()
  await s.controller.tick()
  await s.controller.tick()
  await s.controller.tick()
  await s.controller.pause(job.id)
  assert.equal(s.jobs.get(job.id).completed, 1)
  assert.equal(s.jobs.get(job.id).remaining, 2)
  await s.controller.resume(job.id)
  assert.equal(s.jobs.get(job.id).orders[0].state, 'done')
})

test('job progress does not report library changes before a successful save', async () => {
  const s = setup([[row('10001')]])
  const job = await s.controller.start({
    scope: 'selected',
    source,
    orderIds: ['10001'],
  })
  await s.controller.tick()
  assert.ok(s.calls.some(([type]) => type === 'progress'))
  assert.equal(s.calls.filter(([type]) => type === 'changed').length, 0)
  s.browser.readDetail = async () => {
    throw new Error('Invalid product total')
  }
  await s.controller.tick()
  await s.controller.tick()
  assert.equal(s.jobs.get(job.id).state, 'completed-with-errors')
  assert.equal(s.calls.filter(([type]) => type === 'changed').length, 0)
  s.browser.readDetail = async () => snapshot('10001')
  await s.controller.resume(job.id)
  await s.controller.tick()
  await s.controller.tick()
  await s.controller.tick()
  assert.equal(s.calls.filter(([type]) => type === 'changed').length, 1)
})

test('a sign-in redirect during the final read attempt pauses with the notice, not a failure', async () => {
  const s = setup([[row('10001')]], 1)
  const job = await s.controller.start({ scope: 'all', source })
  await s.controller.tick()
  await s.controller.tick()
  // The read fails because 1688 sent the reader to its sign-in page.
  s.browser.readDetail = async () => {
    s.setTab({ id: 42, url: 'https://login.1688.com/', status: 'complete' })
    throw Object.assign(new Error('The order page is not ready.'), {
      retryable: true,
    })
  }
  s.advance(100000)
  await s.controller.tick()
  const paused = s.jobs.get(job.id)
  assert.equal(paused.state, 'paused')
  assert.equal(paused.attention?.kind, 'sign-in')
  assert.equal(paused.orders[0].state, 'pending')
})

test('a sign-in redirect on the last allowed read attempt also pauses with the notice', async () => {
  const s = setup([[row('10001')]], 1)
  const job = await s.controller.start({ scope: 'all', source })
  await s.controller.tick()
  await s.controller.tick()
  let reads = 0
  s.browser.readDetail = async () => {
    reads++
    // The first two reads fail while the page hydrates; the third finds sign-in.
    if (reads === 3)
      s.setTab({ id: 42, url: 'https://login.1688.com/', status: 'complete' })
    throw Object.assign(new Error('The order page is not ready.'), {
      retryable: true,
    })
  }
  for (let attempt = 0; attempt < 3; attempt++) await s.controller.tick()
  const paused = s.jobs.get(job.id)
  assert.equal(reads, 3)
  assert.equal(paused.state, 'paused')
  assert.equal(paused.attention?.kind, 'sign-in')
  assert.equal(paused.orders[0].state, 'pending')
})
