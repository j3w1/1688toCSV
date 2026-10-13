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
          : {
              data: {
                sellerName: 'Fixture',
                orderSuffix: '6789',
                dataRows: [
                  {
                    description: '示例',
                    price: '1.50',
                    quantity: '2',
                    discount: '0',
                  },
                ],
              },
            }
      },
      ...overrides,
    },
    scripting: { async executeScript() {} },
    downloads: {
      async download() {
        return 1
      },
      async search() {
        return [{ state: 'complete' }]
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
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
test('successful export waits for download completion and prevents duplicate clicks', async () => {
  const { document, api, button } = setup()
  let complete
  let completed = false
  let downloads = 0
  api.downloads.download = async () => {
    downloads++
    return 1
  }
  api.downloads.search = async () =>
    completed
      ? [{ state: 'complete' }]
      : new Promise((resolve) => {
          complete = () => {
            completed = true
            resolve([{ state: 'complete' }])
          }
        })
  await mountPopup(api, document)
  button.click()
  button.click()
  await waitFor(() => complete)
  assert.equal(downloads, 1)
  assert.equal(document.body.dataset.state, 'exporting')
  complete()
  await waitFor(() => document.body.dataset.state === 'success')
  assert.equal(button.disabled, false)
  assert.equal(
    document.getElementById('feedback').textContent,
    'Fixture_6789.csv'
  )
})
test('extraction errors remain visible and do not trigger a download', async () => {
  const { document, api, button } = setup({
    async sendMessage(_id, { action }) {
      return action === 'ping'
        ? { status: 'ready', rowCount: 2 }
        : { error: 'Row 2: quantity is missing.' }
    },
  })
  api.downloads.download = () => assert.fail('Invalid order must not download')
  await mountPopup(api, document)
  button.click()
  await waitFor(() => document.body.dataset.state === 'error')
  assert.match(document.getElementById('feedback').textContent, /quantity/)
  assert.equal(button.disabled, false)
  assert.equal(document.getElementById('save-csv').hidden, true)
})

test('a rejected download opens a page save panel only after a separate user click', async () => {
  const { document, api, button } = setup()
  let attempts = 0
  api.downloads.download = async () => {
    attempts++
    throw new Error('USER_CANCELED')
  }
  let panelRequests = 0
  const sendMessage = api.tabs.sendMessage
  api.tabs.sendMessage = async (tabId, request) => {
    if (request.action === 'preparePageSave') {
      panelRequests++
      return { status: 'save-ready', filename: 'Fixture_6789.csv' }
    }
    return sendMessage(tabId, request)
  }
  await mountPopup(api, document)
  button.click()
  await waitFor(() => document.body.dataset.state === 'error')
  const alternate = document.getElementById('save-csv')
  assert.equal(alternate.hidden, false)
  assert.match(
    document.getElementById('feedback').textContent,
    /could not start/
  )
  assert.equal(attempts, 1)
  assert.equal(panelRequests, 0)
  alternate.click()
  alternate.click()
  await waitFor(() => document.body.dataset.state === 'requested')
  assert.equal(document.body.dataset.state, 'requested')
  assert.match(
    document.getElementById('feedback').textContent,
    /Close this popup.*Save CSV.*order page/
  )
  assert.equal(document.getElementById('feedback').dataset.tone, 'notice')
  assert.equal(attempts, 1)
  assert.equal(panelRequests, 1)
  document.defaultView.dispatchEvent(new document.defaultView.Event('pagehide'))
  assert.equal(alternate.hidden, true)
})

test('rechecking the order hides the recovery control', async () => {
  const { document, api, button } = setup()
  api.downloads.download = async () => {
    throw new Error('USER_CANCELED')
  }
  await mountPopup(api, document)
  button.click()
  await waitFor(() => document.body.dataset.state === 'error')
  const alternate = document.getElementById('save-csv')
  document.getElementById('retry').click()
  await waitFor(() => document.body.dataset.state === 'ready')
  assert.equal(alternate.hidden, true)
})

test('page-save extraction errors remain visible and do not claim a save', async () => {
  const { document, api, button } = setup()
  api.downloads.download = async () => {
    throw new Error('USER_CANCELED')
  }
  const sendMessage = api.tabs.sendMessage
  api.tabs.sendMessage = async (id, request) =>
    request.action === 'preparePageSave'
      ? { error: 'Row 2: discount summary is invalid.' }
      : sendMessage(id, request)
  await mountPopup(api, document)
  button.click()
  await waitFor(() => document.body.dataset.state === 'error')
  document.getElementById('save-csv').click()
  await waitFor(
    () =>
      document.getElementById('status-text').textContent ===
      'Could not open the save panel'
  )
  assert.equal(document.body.dataset.state, 'error')
  assert.match(document.getElementById('feedback').textContent, /Row 2/)
  assert.equal(button.disabled, false)
})
