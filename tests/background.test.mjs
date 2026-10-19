import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createImportController } from '../src/import-controller.js'
import { detailUrl, isListUrl } from '../src/order-list.js'
import { createImportReport, importJobView } from '../src/import-report.js'
import { financialDiagnostics } from '../src/import-diagnostics.js'
import { importProgress } from '../src/import-progress.js'
import { appearanceTokens } from '../src/appearance.js'

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
  const display = { colorScheme: 'dark', appearance: {} }
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
    async getWorkspaceDisplay() {
      return structuredClone(display)
    },
    async setWorkspaceColorScheme(colorScheme) {
      if (!['light', 'dark', 'system'].includes(colorScheme))
        throw new Error('The workspace color scheme is invalid.')
      display.colorScheme = colorScheme
    },
  }
  const chrome = {
    runtime: {
      id: 'synthetic',
      getURL: (path) => origin + path,
      getManifest: () => ({ version: '2.2.5' }),
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
        calls.push([
          'content',
          tabId,
          message.type,
          options?.frameId,
          message.data,
        ])
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
    importJobView,
    createImportReport,
    financialDiagnostics,
    importProgress,
    appearanceTokens,
    loadThumbnail: async () => '',
    URL,
    console,
  })
  const send = (message, who = own) =>
    new Promise((resolve) =>
      chrome.runtime.onMessage.listeners[0](message, who, resolve)
    )
  return {
    chrome,
    jobs,
    tabs,
    saved,
    calls,
    send,
    display,
    adapter: () => adapter,
  }
}
const settle = async () => {
  for (let i = 0; i < 20; i++)
    await new Promise((resolve) => setImmediate(resolve))
}

test('import appearance reads the authoritative palette, persists only mode, and broadcasts to supported pages', async () => {
  const env = setup()
  env.display.appearance = { lightTheme: '1688', darkTheme: 'terracotta' }
  env.tabs.set(8, { id: 8, url: url('10001') })
  env.tabs.set(9, { id: 9, url: 'https://example.test/' })
  const initial = await env.send({ type: 'WORKSPACE_APPEARANCE_GET' }, sender)
  assert.equal(initial.ok, true)
  assert.equal(initial.data.colorScheme, 'dark')
  assert.equal(initial.data.dark.surface, '#2d221e')
  assert.equal(initial.data.light.surface, '#fffcf8')
  assert.equal(env.calls.length, 0)
  assert.equal(
    (
      await env.send({
        type: 'WORKSPACE_APPEARANCE_CHANGED',
        colorScheme: 'light',
      })
    ).ok,
    true
  )
  assert.equal(env.display.colorScheme, 'light')
  const broadcasts = env.calls.filter(
    (call) => call[2] === 'WORKSPACE_APPEARANCE'
  )
  assert.deepEqual(
    broadcasts.map((call) => call[1]),
    [7, 8]
  )
  assert.ok(broadcasts.every((call) => call[4].colorScheme === 'light'))
  assert.ok(
    broadcasts.every((call) => call[3] === undefined),
    'Update all supported frames in each tab'
  )
  env.display.appearance.darkTheme = 'apricot'
  const next = await env.send(
    { type: 'WORKSPACE_APPEARANCE_GET' },
    {
      ...sender,
      url: url('10001'),
    }
  )
  assert.equal(next.data.dark.surface, '#2b251f')
  assert.equal(next.data.colorScheme, 'light')
  assert.equal(
    (
      await env.send(
        { type: 'WORKSPACE_APPEARANCE_CHANGED', colorScheme: 'dark' },
        sender
      )
    ).ok,
    false
  )
  assert.equal(
    (
      await env.send({
        type: 'WORKSPACE_APPEARANCE_CHANGED',
        colorScheme: 'invalid',
      })
    ).ok,
    false
  )
  assert.equal(
    (
      await env.send(
        { type: 'WORKSPACE_APPEARANCE_GET' },
        { ...sender, url: 'https://example.test/' }
      )
    ).ok,
    false
  )
  assert.equal(env.display.colorScheme, 'light')
})

test('reader progress is compact, tab/frame/order scoped, read-only and available during a blocked read', async () => {
  const s = setup()
  const reader = {
    id: 'synthetic',
    tab: { id: 11 },
    frameId: 0,
    url: `${url('10001')}#1688tocsv-import=job`,
  }
  const job = {
    id: 'job',
    workerTabId: 11,
    currentOrderId: '10001',
    state: 'running',
    phase: 'details',
    total: 2,
    detailStage: 'reading',
    detailStartedAt: 1000,
    detailAttempts: 1,
    orders: [
      { orderId: '10001', state: 'pending' },
      { orderId: '10002', state: 'done', savedRows: 7 },
    ],
  }
  s.jobs.set('job', structuredClone(job))
  let release
  const held = new Promise((resolve) => {
    release = resolve
  })
  const original = s.chrome.tabs.create
  s.chrome.tabs.create = async (options) => {
    await held
    return original(options)
  }
  const mutation = s.send({ type: 'OPEN_LIBRARY' }) // Holds the serial lock.
  await settle()
  const reply = await s.send({ type: 'READER_STATUS' }, reader)
  assert.equal(reply.ok, true)
  assert.equal(reply.data.collectedRows, 7)
  assert.equal(reply.data.detailStage, 'reading')
  assert.equal(reply.data.orders, undefined)
  for (const wrong of [
    { ...reader, tab: { id: 12 } },
    { ...reader, frameId: 1 },
    { ...reader, url: url('10001') },
    { ...reader, url: `${url('10003')}#1688tocsv-import=job` },
    { ...reader, url: `${url('10001')}#1688tocsv-import=other` },
  ])
    assert.equal((await s.send({ type: 'READER_STATUS' }, wrong)).data, null)
  assert.equal((await s.send({ type: 'READER_STATUS' }, sender)).ok, false)
  assert.deepEqual(s.jobs.get('job'), job)
  assert.equal(
    s.calls.some(([type]) => ['content', 'schedule'].includes(type)),
    false
  )
  release()
  await mutation
})

test('progress responses omit failure evidence without erasing saved diagnostics', async () => {
  const s = setup()
  const lastFailure = {
    message: 'Unsupported total',
    diagnostics: { version: 1 },
  }
  s.jobs.set('bulk', {
    id: 'bulk',
    state: 'paused',
    orders: Array.from({ length: 667 }, (_, i) => ({
      orderId: String(10000 + i),
      state: 'failed',
      error: 'Unsupported total',
      lastFailure,
    })),
  })
  for (const type of ['JOBS_QUERY', 'LIBRARY_QUERY']) {
    const reply = await s.send({ type })
    assert.equal(reply.ok, true)
    assert.equal(reply.data.jobs[0].orders.length, 667)
    assert.equal(reply.data.jobs[0].orders[0].error, 'Unsupported total')
    assert.equal(reply.data.jobs[0].orders[0].lastFailure, undefined)
  }
  assert.deepEqual(s.jobs.get('bulk').orders[0].lastFailure, lastFailure)
})

test('the source list can export a durable import report without changing or advancing any job', async () => {
  for (const state of [
    'running',
    'paused',
    'completed-with-errors',
    'completed',
  ]) {
    const s = setup()
    const states =
      state === 'completed'
        ? ['done', 'done', 'done']
        : state === 'completed-with-errors'
          ? ['done', 'failed', 'done']
          : ['done', 'failed', 'pending']
    const diagnostics = {
      version: 1,
      fields: [{ label: '原价总计', value: '¥30.00' }],
      products: { count: 2, gross: '25.00', discount: '1.00' },
    }
    const job = {
      id: 'report-job',
      kind: 'import',
      scope: 'all',
      phase: 'details',
      state,
      source: { tabId: sender.tab.id, frameId: sender.frameId },
      total: 3,
      page: 1,
      pageSize: 10,
      createdAt: '2026-10-14T12:00:00.000Z',
      updatedAt: '2026-10-14T12:01:00.000Z',
      filterKey: 'excluded private filter',
      orders: states.map((orderState, i) => ({
        orderId: String(10001 + i),
        sourceUrl: url(String(10001 + i)),
        state: orderState,
        error:
          orderState === 'failed' ? 'Synthetic reconciliation failure' : '',
        ...(orderState === 'failed'
          ? {
              lastFailure: {
                at: '2026-10-14T12:01:00.000Z',
                message: 'Synthetic reconciliation failure',
                diagnostics,
              },
            }
          : {}),
      })),
    }
    s.jobs.set(job.id, structuredClone(job))
    const response = await s.send(
      { type: 'IMPORT_REPORT', jobId: job.id },
      sender
    )
    assert.equal(response.ok, true)
    assert.equal(response.data.format, '1688-import-report')
    assert.equal(response.data.extensionVersion, '2.2.5')
    assert.equal(response.data.job.state, state)
    assert.deepEqual(
      response.data.orders.map((order) => order.state),
      states
    )
    if (state !== 'completed')
      assert.deepEqual(
        response.data.orders[1].lastFailure.diagnostics,
        financialDiagnostics(diagnostics)
      )
    assert.equal(
      JSON.stringify(response.data).includes('excluded private filter'),
      false
    )
    await settle()
    assert.deepEqual(s.jobs.get(job.id), job)
    assert.deepEqual(s.calls, [])
    assert.equal(s.tabs.size, 1)
    assert.equal(s.saved.size, 0)
  }
})

test('import reports reject another source tab or frame, unsupported callers and deleted jobs', async () => {
  const s = setup()
  const job = {
    id: 'owned',
    source: { tabId: sender.tab.id, frameId: sender.frameId },
    orders: [],
  }
  s.jobs.set(job.id, job)
  for (const other of [
    { ...sender, tab: { id: 8 } },
    { ...sender, frameId: 0 },
    { ...sender, url: 'https://example.com/' },
    { ...sender, id: 'another-extension' },
    own,
  ]) {
    const response = await s.send(
      { type: 'IMPORT_REPORT', jobId: job.id },
      other
    )
    assert.equal(response.ok, false)
  }
  s.jobs.delete(job.id)
  for (const jobId of ['owned', undefined]) {
    const response = await s.send({ type: 'IMPORT_REPORT', jobId }, sender)
    assert.equal(response.ok, false)
    assert.match(response.error, /no longer available/)
  }
  await settle()
  assert.deepEqual(s.calls, [])
  assert.equal(s.tabs.size, 1)
})

test('dismissal is library-only, refuses running jobs and preserves saved data', async () => {
  const s = setup()
  const job = {
    id: 'old-job',
    state: 'paused',
    source: { tabId: sender.tab.id, frameId: sender.frameId },
    orders: [],
    error: 'Old warning',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  s.jobs.set(job.id, job)
  s.saved.set('10001', { snapshot: { orderId: '10001' } })
  assert.equal(
    (await s.send({ type: 'IMPORT_DISMISS', jobId: job.id }, sender)).ok,
    false
  )
  assert.equal(
    (await s.send({ type: 'IMPORT_DISMISS', jobId: job.id })).ok,
    true
  )
  assert.ok(s.jobs.get(job.id).dismissedAt)
  assert.equal(s.jobs.get(job.id).state, 'paused')
  assert.equal(s.jobs.get(job.id).error, 'Old warning')
  const status = await s.send({ type: 'IMPORT_STATUS' }, sender)
  assert.equal(status.ok, true)
  assert.equal(status.data.jobs.length, 0)
  assert.equal(s.saved.size, 1)
  assert.equal(
    s.calls.some(([type]) => ['create', 'schedule', 'remove'].includes(type)),
    false
  )
  s.jobs.set('running', { id: 'running', state: 'running', orders: [] })
  assert.equal(
    (await s.send({ type: 'IMPORT_DISMISS', jobId: 'running' })).ok,
    false
  )
  assert.equal(s.jobs.get('running').dismissedAt, undefined)
})
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
  assert.equal(
    s.calls.filter((x) => x[0] === 'broadcast' && x[1] === 'LIBRARY_CHANGED')
      .length,
    0
  )
  assert.ok(
    s.calls.some((x) => x[0] === 'broadcast' && x[1] === 'IMPORT_PROGRESS')
  )
  const job = [...s.jobs.values()][0]
  s.tabs.get(job.workerTabId).status = 'complete'
  s.chrome.tabs.onUpdated.emit(job.workerTabId, { status: 'complete' })
  await settle()
  assert.equal(s.saved.size, 1)
  assert.equal(s.jobs.get(job.id).state, 'completed')
  assert.equal(
    s.calls.filter((x) => x[0] === 'broadcast' && x[1] === 'LIBRARY_CHANGED')
      .length,
    1
  )
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
  await assert.rejects(
    adapter.getDetailTab(56, 'job-known'),
    /left its marked order page/
  )
  await adapter.closeDetailTab(56, 'job-known')
  assert.equal(s.tabs.has(56), true)
})

test('tab lookup distinguishes missing IDs from browser API failures', async () => {
  const s = setup()
  await s.send({ type: 'JOBS_QUERY' })
  const adapter = s.adapter()
  assert.equal(await adapter.getDetailTab(55, 'job-known'), null)
  s.tabs.set(55, {
    id: 55,
    url: url('10001') + '#1688tocsv-import=job-known',
    status: 'complete',
  })
  const failure = new Error('The browser could not inspect this tab')
  s.chrome.tabs.get = async () => {
    throw failure
  }
  await assert.rejects(adapter.getDetailTab(55, 'job-known'), (error) => {
    assert.equal(error, failure)
    return true
  })
  s.chrome.tabs.query = async () => {
    throw new Error('The browser could not list tabs either')
  }
  await assert.rejects(adapter.getDetailTab(55, 'job-known'), (error) => {
    assert.equal(error, failure)
    return true
  })
  assert.equal(s.tabs.has(55), true)
  assert.equal(s.calls.filter(([type]) => type === 'remove').length, 0)
})

test('blank pending URL does not hide a loaded marked order URL', async () => {
  const s = setup()
  const result = await s.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
    sender
  )
  await settle()
  const tabId = s.jobs.get(result.data.id).workerTabId
  Object.assign(s.tabs.get(tabId), {
    pendingUrl: 'about:blank',
    status: 'complete',
  })
  s.chrome.tabs.onUpdated.emit(tabId, { status: 'complete' })
  await settle()
  assert.equal(s.saved.size, 1)
  assert.equal(s.jobs.get(result.data.id).state, 'completed')
  assert.equal(s.tabs.has(tabId), false)
  assert.equal(s.calls.filter(([type]) => type === 'create').length, 1)
})

test('an initially blank loading tab waits until its marked order arrives', async () => {
  const s = setup()
  const result = await s.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
    sender
  )
  await settle()
  const tabId = s.jobs.get(result.data.id).workerTabId
  const orderUrl = s.tabs.get(tabId).url
  Object.assign(s.tabs.get(tabId), {
    url: 'about:blank',
    pendingUrl: '',
    status: 'loading',
  })
  s.chrome.alarms.onAlarm.emit({ name: 'order-import' })
  await settle()
  assert.equal(s.jobs.get(result.data.id).state, 'running')
  assert.equal(s.jobs.get(result.data.id).workerTabId, tabId)
  assert.equal(s.saved.size, 0)
  assert.equal(s.calls.filter((call) => call[2] === 'DETAIL_READ').length, 0)
  assert.equal(s.tabs.has(tabId), true)
  Object.assign(s.tabs.get(tabId), { url: orderUrl, status: 'complete' })
  s.chrome.tabs.onUpdated.emit(tabId, { status: 'complete' })
  await settle()
  assert.equal(s.jobs.get(result.data.id).state, 'completed')
  assert.equal(s.saved.size, 1)
})

test('a completed tab without its URL reports unreadable metadata and stays open', async () => {
  const s = setup()
  const result = await s.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
    sender
  )
  await settle()
  const tabId = s.jobs.get(result.data.id).workerTabId
  Object.assign(s.tabs.get(tabId), { url: undefined, status: 'complete' })
  s.chrome.tabs.onUpdated.emit(tabId, { status: 'complete' })
  await settle()
  const job = s.jobs.get(result.data.id)
  assert.equal(job.state, 'paused')
  assert.match(job.error, /did not provide the import tab URL/)
  assert.equal(s.saved.size, 0)
  assert.equal(s.calls.filter((call) => call[2] === 'DETAIL_READ').length, 0)
  assert.equal(s.tabs.has(tabId), true)
})

test('a concrete unrelated pending navigation cannot be read or closed', async () => {
  for (const pendingUrl of ['https://example.com/', url('10002')]) {
    const s = setup()
    const result = await s.send(
      { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
      sender
    )
    await settle()
    const tabId = s.jobs.get(result.data.id).workerTabId
    Object.assign(s.tabs.get(tabId), { pendingUrl, status: 'loading' })
    s.chrome.alarms.onAlarm.emit({ name: 'order-import' })
    await settle()
    const job = s.jobs.get(result.data.id)
    assert.equal(job.state, 'paused')
    assert.match(job.error, /left its marked order page/)
    assert.equal(s.saved.size, 0)
    assert.equal(s.calls.filter((call) => call[2] === 'DETAIL_READ').length, 0)
    assert.equal(s.calls.filter(([type]) => type === 'remove').length, 0)
    assert.equal(s.tabs.has(tabId), true)
  }
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
    ([type, id, options]) =>
      type === 'update' && id === workerTabId && options.url
  )
  assert.equal(navigations.length, 2)
  assert.ok(navigations.every(([, , options]) => !('active' in options)))
  // This browser rejects background tabs, so the reader fell back to a visible tab.
  assert.equal(s.jobs.get(result.data.id).visibleReader, true)
  assert.ok(s.tabs.has(library.data.id))
})

test('imports read orders in a background tab and never switch the visible tab', async () => {
  const s = setup({ orderIds: ['10001', '10002'] })
  const created = []
  s.chrome.tabs.create = async (options) => {
    created.push({ ...options })
    const tab = { id: 50 + created.length, ...options, status: 'loading' }
    s.tabs.set(tab.id, tab)
    s.calls.push(['create', tab.id])
    return { ...tab }
  }
  const result = await s.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001', '10002'] },
    sender
  )
  await settle()
  const job = () => s.jobs.get(result.data.id)
  const workerTabId = job().workerTabId
  assert.deepEqual(
    created.map((options) => options.active),
    [false]
  )
  assert.equal(job().visibleReader, false)
  assert.ok(
    s.calls.some(
      ([type, id, options]) =>
        type === 'update' &&
        id === workerTabId &&
        options.autoDiscardable === false
    )
  )
  for (const orderId of ['10001', '10002']) {
    assert.equal(detailUrl(s.tabs.get(workerTabId).url), url(orderId))
    s.tabs.get(workerTabId).status = 'complete'
    s.chrome.tabs.onUpdated.emit(workerTabId, { status: 'complete' })
    await settle()
  }
  assert.equal(s.saved.size, 2)
  assert.equal(job().state, 'completed')
  // No update ever activated a tab during the import.
  assert.ok(
    !s.calls.some(
      ([type, , options]) => type === 'update' && options?.active === true
    )
  )
})

test('spreadsheet fallback navigates only the requesting idle order tab without creating a tab', async () => {
  const s = setup()
  s.chrome.tabs.create = async () => {
    throw new Error(
      'Owl extension-created tab was blocked before presentation.'
    )
  }
  const blocked = await s.send({ type: 'OPEN_LIBRARY' }, sender)
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /blocked before presentation/)
  const result = await s.send({ type: 'OPEN_LIBRARY_HERE' }, sender)
  assert.equal(result.ok, true)
  assert.equal(s.tabs.get(7).url, origin + 'library.html')
  assert.equal(s.tabs.size, 1)
  assert.equal(s.calls.filter(([type]) => type === 'create').length, 0)
  assert.equal(
    (
      await s.send(
        { type: 'OPEN_LIBRARY_HERE' },
        { ...sender, url: 'https://example.com/' }
      )
    ).ok,
    false
  )
})

test('spreadsheet fallback cannot replace a tab used by a running import', async () => {
  for (const job of [
    { id: 'running', state: 'running', source: { tabId: 7 }, orders: [] },
    { id: 'running', state: 'running', workerTabId: 7, orders: [] },
  ]) {
    const s = setup()
    s.jobs.set(job.id, job)
    const result = await s.send({ type: 'OPEN_LIBRARY_HERE' }, sender)
    assert.equal(result.ok, false)
    assert.match(result.error, /Pause or finish/)
    assert.equal(s.tabs.get(7).url, listUrl)
  }
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
  assert.equal(status.data.jobs[0].scope, 'selected')
  assert.equal(status.data.jobs[0].remaining, 1)
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
  job.state = 'running'
  const continuing = (await s.send({ type: 'IMPORT_STATUS' }, sender)).data
    .jobs[0]
  assert.equal(continuing.error, '')
  assert.equal(continuing.failed, 1)
  assert.equal(job.orders[0].error, 'Expected 40 product rows but read 3.')
  job.error = 'A job-level problem'
  assert.equal(
    (await s.send({ type: 'IMPORT_STATUS' }, sender)).data.jobs[0].error,
    'A job-level problem'
  )
})

test('the workspace opens the tab that needs a sign-in only when asked', async () => {
  const s = setup()
  const focused = []
  s.chrome.windows = {
    update: async (id, options) => focused.push([id, options]),
  }
  s.tabs.set(60, {
    id: 60,
    url: 'https://login.1688.com/',
    status: 'complete',
    windowId: 3,
  })
  s.jobs.set('job-attention', {
    id: 'job-attention',
    state: 'paused',
    orders: [],
    attention: {
      kind: 'sign-in',
      tabId: 60,
      orderId: '10001',
      at: '2026-10-19T10:00:00.000Z',
    },
  })
  const opened = await s.send(
    { type: 'IMPORT_ATTENTION_OPEN', jobId: 'job-attention' },
    own
  )
  assert.equal(opened.ok, true, opened.error)
  assert.equal(s.tabs.get(60).active, true)
  assert.equal(
    JSON.stringify(focused),
    JSON.stringify([[3, { focused: true }]])
  )
  // Content pages cannot trigger it, and a closed tab explains itself.
  const refused = await s.send(
    { type: 'IMPORT_ATTENTION_OPEN', jobId: 'job-attention' },
    sender
  )
  assert.equal(refused.ok, false)
  s.tabs.delete(60)
  const closed = await s.send(
    { type: 'IMPORT_ATTENTION_OPEN', jobId: 'job-attention' },
    own
  )
  assert.equal(closed.ok, false)
  assert.match(closed.error, /tab was closed/)
})
