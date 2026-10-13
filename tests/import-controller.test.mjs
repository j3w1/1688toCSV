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
