import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createImportController } from '../src/import-controller.js'
import { detailUrl, isListUrl } from '../src/order-list.js'

const sourceCode = (
  await readFile(new URL('../src/background.js', import.meta.url), 'utf8')
).replace(/^import .*\r?\n/gm, '')
const origin = 'chrome-extension://synthetic/'
const listUrl =
  'https://air.1688.com/app/ctf-page/trade-order-list/buyer-order-list.html'
const url = (id) =>
  `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${id}`
const own = { id: 'synthetic', url: origin + 'inspector.html' }
const sender = { id: 'synthetic', url: listUrl, tab: { id: 7 }, frameId: 2 }
function event() {
  const listeners = []
  return {
    listeners,
    addListener: (listener) => listeners.push(listener),
    emit(...args) {
      for (const listener of listeners) listener(...args)
    },
  }
}
function setup({ orderIds = ['10001'] } = {}) {
  const jobs = new Map(),
    tabs = new Map([[7, { id: 7, url: listUrl, status: 'complete' }]]),
    saved = new Map(),
    calls = []
  let adapter,
    tabSequence = 10
  const repository = {
    close() {},
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
      return [...saved.values()]
    },
    async getOrder(id) {
      return saved.get(id)
    },
    async saveSnapshot(snapshot) {
      const value = { snapshot }
      saved.set(snapshot.orderId, value)
      return value
    },
    async setNotes(id, value) {
      calls.push(['notes', id, value])
      return value
    },
    async restoreBackup(value) {
      calls.push(['restore', value])
      return { imported: 0 }
    },
    async exportBackup() {
      return {}
    },
  }
  const chrome = {
    runtime: {
      id: 'synthetic',
      getURL: (path) => origin + path,
      onMessage: event(),
      onStartup: event(),
      onInstalled: event(),
      async sendMessage(message) {
        calls.push(['broadcast', message.type])
      },
    },
    action: { onClicked: event() },
    alarms: {
      onAlarm: event(),
      async create(name) {
        calls.push(['schedule', name])
      },
      async clear(name) {
        calls.push(['clear', name])
      },
    },
    tabs: {
      onUpdated: event(),
      onRemoved: event(),
      async query() {
        return [...tabs.values()]
      },
      async get(id) {
        if (!tabs.has(id)) throw new Error('No tab')
        return { ...tabs.get(id) }
      },
      async create(options) {
        if (options.active !== true)
          throw new Error('Owl extension-created tabs must be active.')
        const tab = { id: ++tabSequence, ...options, status: 'loading' }
        tabs.set(tab.id, tab)
        calls.push(['create', tab.id])
        return { ...tab }
      },
      async update(id, options) {
        calls.push(['update', id, { ...options }])
        Object.assign(tabs.get(id), options)
        if (options.url) tabs.get(id).status = 'loading'
        return { ...tabs.get(id) }
      },
      async remove(id) {
        assert.equal(typeof id, 'number')
        calls.push(['remove', id])
        tabs.delete(id)
      },
      async sendMessage(tabId, message, options) {
        calls.push(['content', tabId, message.type, options.frameId])
        if (message.type === 'LIST_READ')
          return {
            ok: true,
            data: {
              orders: orderIds.map((orderId) => ({
                orderId,
                sourceUrl: url(orderId),
                expectedRows: 1,
              })),
              page: 1,
              pageSize: 10,
              total: orderIds.length,
              filterKey: 'stable',
            },
          }
        return {
          ok: true,
          data: {
            accountId: 'local',
            orderId: message.orderId,
            sourceUrl: url(message.orderId),
            items: [{}],
          },
        }
      },
    },
  }
  vm.runInNewContext(sourceCode, {
    chrome,
    openDatabase: async () => repository,
    createImportController: (options) => {
      adapter = options.browser
      return createImportController(options)
    },
    detailUrl,
    isListUrl,
    loadThumbnail: async () => '',
    URL,
    console,
  })
  const send = (message, who = own) =>
    new Promise((resolve) =>
      chrome.runtime.onMessage.listeners[0](message, who, resolve)
    )
  return { chrome, jobs, tabs, saved, calls, send, adapter: () => adapter }
}
const settle = async () => {
  for (let i = 0; i < 20; i++)
    await new Promise((resolve) => setImmediate(resolve))
}
test('worker accepts own pages and validates content senders before mutations', async () => {
  const s = setup()
  assert.equal((await s.send({ type: 'BACKUP_RESTORE', backup: {} })).ok, true)
  assert.equal(
    (await s.send({ type: 'BACKUP_RESTORE', backup: {} }, sender)).ok,
    false
  )
  assert.equal(
    (
      await s.send(
        { type: 'IMPORT_START', scope: 'all' },
        { ...sender, url: 'https://evil.example/' }
      )
    ).ok,
    false
  )
  assert.equal(
    (
      await s.send(
        { type: 'SNAPSHOT_READY', snapshot: { orderId: '10002' } },
        { ...sender, url: url('10001') }
      )
    ).ok,
    false
  )
  assert.equal(s.calls.filter((x) => x[0] === 'restore').length, 1)
})
test('overlapping import messages serialize into one job and target the source frame', async () => {
  const s = setup()
  const replies = await Promise.all([
    s.send(
      { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
      sender
    ),
    s.send(
      { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
      sender
    ),
  ])
  assert.equal(replies.filter((x) => x.ok).length, 1)
  await settle()
  assert.equal(s.jobs.size, 1)
  assert.equal(s.calls.filter((x) => x[0] === 'create').length, 1)
  assert.equal(s.calls.find((x) => x[0] === 'content')[3], 2)
  const job = [...s.jobs.values()][0]
  s.tabs.get(job.workerTabId).status = 'complete'
  s.chrome.tabs.onUpdated.emit(job.workerTabId, { status: 'complete' })
  await settle()
  assert.equal(s.saved.size, 1)
  assert.equal(s.jobs.get(job.id).state, 'completed')
})
test('marker recovers a tab created before checkpoint and never closes navigated user tabs', async () => {
  const s = setup()
  await s.send({ type: 'JOBS_QUERY' })
  const adapter = s.adapter(),
    marker = '#1688tocsv-import=job-known'
  s.tabs.set(55, { id: 55, url: url('10001') + marker, status: 'complete' })
  assert.equal(await adapter.openDetailTab(url('10002'), 'job-known'), 55)
  assert.equal(s.tabs.get(55).url, url('10002') + marker)
  assert.equal(s.calls.filter((x) => x[0] === 'create').length, 0)
  await adapter.closeDetailTab(null, 'job-known')
  assert.equal(s.tabs.has(55), false)
  s.tabs.set(56, { id: 56, url: url('10001'), status: 'complete' })
  assert.equal(await adapter.getDetailTab(56, 'job-known'), null)
  await adapter.closeDetailTab(56, 'job-known')
  assert.equal(s.tabs.has(56), true)
})
test('startup leaves interrupted import paused and library updates broadcast', async () => {
  const s = setup()
  const result = await s.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
    sender
  )
  await settle()
  s.chrome.runtime.onStartup.emit()
  await settle()
  assert.equal(s.jobs.get(result.data.id).state, 'paused')
  assert.equal(s.jobs.get(result.data.id).workerTabId, null)
  assert.equal((await s.send({ type: 'LIBRARY_UPDATED' })).ok, true)
  assert.ok(
    s.calls.some((x) => x[0] === 'broadcast' && x[1] === 'LIBRARY_CHANGED')
  )
})

test('embedded browser creates explicit active tabs and reuses one detail tab across orders', async () => {
  const s = setup({ orderIds: ['10001', '10002', '10003'] })
  await assert.rejects(
    s.chrome.tabs.create({ url: url('10001'), active: false }),
    /must be active/
  )
  await assert.rejects(
    s.chrome.tabs.create({ url: url('10001') }),
    /must be active/
  )
  const library = await s.send({ type: 'OPEN_LIBRARY' })
  assert.equal(library.ok, true)
  assert.equal(library.data.active, true)
  assert.equal(
    (await s.send({ type: 'OPEN_LIBRARY' })).data.id,
    library.data.id
  )
  const result = await s.send(
    {
      type: 'IMPORT_START',
      scope: 'selected',
      orderIds: ['10001', '10002', '10003'],
    },
    sender
  )
  await settle()
  const workerTabId = s.jobs.get(result.data.id).workerTabId
  assert.equal(s.tabs.get(workerTabId).active, true)
  for (const orderId of ['10001', '10002', '10003']) {
    assert.equal(s.jobs.get(result.data.id).workerTabId, workerTabId)
    assert.equal(detailUrl(s.tabs.get(workerTabId).url), url(orderId))
    s.tabs.get(workerTabId).status = 'complete'
    s.chrome.tabs.onUpdated.emit(workerTabId, { status: 'complete' })
    await settle()
  }
  assert.equal(s.saved.size, 3)
  assert.equal(s.jobs.get(result.data.id).state, 'completed')
  assert.equal(s.calls.filter(([type]) => type === 'create').length, 2)
  assert.equal(
    s.calls.filter(([type, id]) => type === 'remove' && id === workerTabId)
      .length,
    1
  )
  const navigations = s.calls.filter(
    ([type, id]) => type === 'update' && id === workerTabId
  )
  assert.equal(navigations.length, 2)
  assert.ok(navigations.every(([, , options]) => !('active' in options)))
  assert.ok(s.tabs.has(library.data.id))
})

test('list progress and pause/resume are limited to the original source tab and frame', async () => {
  const s = setup()
  const created = await s.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
    sender
  )
  await settle()
  const jobId = created.data.id
  const status = await s.send({ type: 'IMPORT_STATUS' }, sender)
  assert.equal(status.data.jobs[0].id, jobId)
  assert.equal(status.data.jobs[0].discovered, 1)
  assert.equal('orders' in status.data.jobs[0], false)
  for (const other of [
    { ...sender, frameId: 0 },
    { ...sender, tab: { id: 8 } },
  ]) {
    assert.equal(
      (await s.send({ type: 'IMPORT_STATUS' }, other)).data.jobs.length,
      0
    )
    assert.equal(
      (await s.send({ type: 'IMPORT_PAUSE', jobId }, other)).ok,
      false
    )
  }
  assert.equal(
    (
      await s.send(
        { type: 'IMPORT_STATUS' },
        { ...sender, url: 'https://example.com/' }
      )
    ).ok,
    false
  )
  const paused = await s.send({ type: 'IMPORT_PAUSE', jobId }, sender)
  assert.equal(paused.ok, true)
  assert.equal(s.jobs.get(jobId).state, 'paused')
  assert.equal(
    (await s.send({ type: 'IMPORT_RESUME', jobId }, { ...sender, frameId: 0 }))
      .ok,
    false
  )
  assert.equal(
    (await s.send({ type: 'IMPORT_RESUME', jobId }, sender)).ok,
    true
  )
  await settle()
  assert.equal(s.jobs.get(jobId).state, 'running')
  await s.send({ type: 'IMPORT_PAUSE', jobId })
  const job = s.jobs.get(jobId)
  job.error = ''
  job.orders[0].state = 'failed'
  job.orders[0].error = 'Expected 40 product rows but read 3.'
  assert.match(
    (await s.send({ type: 'IMPORT_STATUS' }, sender)).data.jobs[0].error,
    /Expected 40/
  )
})
