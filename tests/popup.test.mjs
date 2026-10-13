import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseHTML } from 'linkedom'
import { mountPopup } from '../src/popup.js'

const html = await readFile(
  new URL('../src/popup.html', import.meta.url),
  'utf8'
)
function setup(overrides = {}) {
  const { document } = parseHTML(html)
  const api = {
    tabs: {
      async query() {
        return [
          {
            id: 4,
            url: 'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1234567890123456789',
          },
        ]
      },
      async sendMessage(_id, { action }) {
        return action === 'ping'
          ? { status: 'ready', rowCount: 2 }
          : { status: 'save-ready', filename: 'Fixture_6789.csv' }
      },
      ...overrides,
    },
    scripting: { async executeScript() {} },
  }
  return {
    document,
    api,
    button: document.getElementById('download-csv-order'),
  }
}
async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  assert.fail('Expected popup state did not arrive')
}
test('ready popup retains a large order ID without precision loss', async () => {
  const { document, api, button } = setup()
  await mountPopup(api, document)
  assert.equal(document.body.dataset.state, 'ready')
  assert.equal(button.disabled, false)
  assert.equal(
    document.getElementById('order-id').textContent,
    '1234567890123456789'
  )
  assert.equal(document.getElementById('row-count').textContent, '2')
})
test('unsupported pages and missing tabs never inject scripts or enable export', async () => {
  for (const tabs of [[], [{ id: 4, url: 'https://example.invalid/' }]]) {
    const { document, api, button } = setup({
      async query() {
        return tabs
      },
    })
    api.scripting.executeScript = () =>
      assert.fail('Must not inject on an unsupported page')
    await mountPopup(api, document)
    assert.equal(document.body.dataset.state, 'unsupported')
    assert.equal(button.disabled, true)
  }
})
test('missing content script is injected once, then readiness is checked without a fixed delay', async () => {
  let pings = 0
  let injections = 0
  const { document, api } = setup({
    async sendMessage() {
      if (++pings === 1) throw new Error('No receiver')
      return { status: 'ready', rowCount: 2 }
    },
  })
  api.scripting.executeScript = async ({ target, files }) => {
    injections++
    assert.equal(target.tabId, 4)
    assert.deepEqual(files, ['content.js'])
  }
  await mountPopup(api, document)
  assert.equal(injections, 1)
  assert.equal(document.body.dataset.state, 'ready')
})
test('waits for late order rows and provides retry when a page remains empty', async () => {
  let calls = 0
  const loaded = setup({
    async sendMessage() {
      return ++calls < 3
        ? { status: 'loading' }
        : { status: 'ready', rowCount: 2 }
    },
  })
  await mountPopup(loaded.api, loaded.document, { pollMs: 1, timeoutMs: 100 })
  assert.equal(loaded.document.body.dataset.state, 'ready')
  const empty = setup({
    async sendMessage() {
      return { status: 'loading' }
    },
  })
  await mountPopup(empty.api, empty.document, { pollMs: 1, timeoutMs: 5 })
  assert.equal(empty.document.body.dataset.state, 'error')
  assert.equal(empty.button.disabled, true)
  assert.equal(empty.document.getElementById('retry').hidden, false)
})
test('the primary button prepares the page save directly and prevents concurrent duplicate requests', async () => {
  const { document, api, button } = setup()
  let complete
  let requests = 0
  api.tabs.sendMessage = async (id, request) => {
    assert.equal(id, 4)
    if (request.action === 'ping') return { status: 'ready', rowCount: 2 }
    assert.equal(request.action, 'preparePageSave')
    requests++
    return new Promise((resolve) => {
      complete = () =>
        resolve({ status: 'save-ready', filename: 'Fixture_6789.csv' })
    })
  }
  await mountPopup(api, document)
  button.click()
  button.click()
  await waitFor(() => complete)
  assert.equal(requests, 1)
  assert.equal(document.body.dataset.state, 'exporting')
  complete()
  await waitFor(() => document.body.dataset.state === 'requested')
  assert.equal(button.disabled, false)
  assert.match(
    document.getElementById('feedback').textContent,
    /Save CSV.*order page/
  )
  assert.equal(document.getElementById('feedback').dataset.tone, 'notice')
})
test('extraction errors remain visible and do not trigger a download', async () => {
  const { document, api, button } = setup({
    async sendMessage(_id, { action }) {
      return action === 'ping'
        ? { status: 'ready', rowCount: 2 }
        : { error: 'Row 2: quantity is missing.' }
    },
  })
  await mountPopup(api, document)
  button.click()
  await waitFor(() => document.body.dataset.state === 'error')
  assert.match(document.getElementById('feedback').textContent, /quantity/)
  assert.equal(button.disabled, false)
})

test('a missing page-save acknowledgement is an error rather than an apparent success', async () => {
  const { document, api, button } = setup()
  api.tabs.sendMessage = async (_id, { action }) =>
    action === 'ping' ? { status: 'ready', rowCount: 2 } : undefined
  await mountPopup(api, document)
  button.click()
  await waitFor(() => document.body.dataset.state === 'error')
  assert.match(
    document.getElementById('feedback').textContent,
    /could not open/
  )
  assert.equal(button.disabled, false)
})

test('an export error can be cleared by checking the order again', async () => {
  const { document, api, button } = setup()
  api.tabs.sendMessage = async (_id, { action }) =>
    action === 'ping'
      ? { status: 'ready', rowCount: 2 }
      : { error: 'Row 2: discount summary is invalid.' }
  await mountPopup(api, document)
  button.click()
  await waitFor(() => document.body.dataset.state === 'error')
  assert.match(document.getElementById('feedback').textContent, /Row 2/)
  document.getElementById('retry').click()
  await waitFor(() => document.body.dataset.state === 'ready')
  assert.equal(document.getElementById('feedback').hidden, true)
})
