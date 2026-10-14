import test from 'node:test'
import assert from 'node:assert/strict'
import { createImportController } from '../src/import-controller.js'

const url = (id) =>
  `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${id}`
const row = (id, extra = {}) => ({
  orderId: id,
  sourceUrl: url(id),
  expectedRows: 2,
  ...extra,
})
const snapshot = (id) => ({ orderId: id, sourceUrl: url(id), items: [{}, {}] })
function setup(pages = [[row('10001'), row('10002')]]) {
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
      pageSize: 2,
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
  assert.deepEqual(s.calls.slice(callCount), [['changed']])
  await s.controller.resume(job.id)
  assert.equal(s.jobs.get(job.id).dismissedAt, undefined)
  assert.equal(s.jobs.get(job.id).state, 'running')
  await assert.rejects(s.controller.dismiss('missing'), /no longer exists/)
})
