import test from 'node:test'
import assert from 'node:assert/strict'
import { waitForDownload, downloadOrder, prepareCsv } from '../src/download.js'

function downloadApi(items = [{ state: 'in_progress' }]) {
  const listeners = new Set()
  return {
    listeners,
    onChanged: {
      addListener: (callback) => listeners.add(callback),
      removeListener: (callback) => listeners.delete(callback),
    },
    async search() {
      return items
    },
    emit(event) {
      for (const callback of [...listeners]) callback(event)
    },
  }
}
test('waits for the requested download and releases its listener', async () => {
  const api = downloadApi()
  let resolved = false
  const promise = waitForDownload(api, 9).then(() => {
    resolved = true
  })
  api.emit({ id: 8, state: { current: 'complete' } })
  await Promise.resolve()
  assert.equal(resolved, false)
  api.emit({ id: 9, state: { current: 'complete' } })
  await promise
  assert.equal(api.listeners.size, 0)
})
test('detects completion that happened before listener registration', async () => {
  const api = downloadApi([{ state: 'complete' }])
  await waitForDownload(api, 9)
  assert.equal(api.listeners.size, 0)
})
test('reports browser interruptions and cleans up', async () => {
  const api = downloadApi()
  const promise = waitForDownload(api, 9)
  api.emit({
    id: 9,
    state: { current: 'interrupted' },
    error: { current: 'FILE_ACCESS_DENIED' },
  })
  await assert.rejects(promise, /FILE_ACCESS_DENIED/)
  assert.equal(api.listeners.size, 0)
})
test('pending and missing downloads do not claim success', async () => {
  const api = downloadApi()
  await assert.rejects(waitForDownload(api, 9, 10), /pending/)
  assert.equal(api.listeners.size, 0)
  await assert.rejects(
    waitForDownload(downloadApi([]), 9),
    /find this download/
  )
})
test('exports UTF-8 data and uses conflict-safe browser downloads', async () => {
  const api = downloadApi([{ state: 'complete' }])
  let request
  api.download = async (options) => {
    request = options
    return 9
  }
  const name = await downloadOrder(
    api,
    prepareCsv({
      sellerName: '示例',
      orderSuffix: '1234',
      dataRows: [
        { description: '测试', price: '3', quantity: '2', discount: '0' },
      ],
    })
  )
  assert.equal(name, '示例_1234.csv')
  assert.equal(request.conflictAction, 'uniquify')
  assert.equal(request.saveAs, false)
  assert.match(
    decodeURIComponent(request.url.split(',')[1]),
    /^\uFEFFThumbnail,Description,Price,Quantity,Discount\r\n/
  )
  assert.equal(api.listeners.size, 0)
})

test('reports the actual filename after Chrome resolves a duplicate', async () => {
  const api = downloadApi([
    { state: 'complete', filename: 'C:\\Downloads\\示例_1234 (1).csv' },
  ])
  api.download = async () => 9
  const filename = await downloadOrder(
    api,
    prepareCsv({
      sellerName: '示例',
      orderSuffix: '1234',
      dataRows: [
        { description: 'Test', price: '1', quantity: '1', discount: '0' },
      ],
    })
  )
  assert.equal(filename, '示例_1234 (1).csv')
})

test('a rejected start reports the browser handoff failure without blaming the user or retrying', async () => {
  const api = downloadApi()
  let attempts = 0
  const cause = new Error('USER_CANCELED')
  api.download = async () => {
    attempts++
    throw cause
  }
  await assert.rejects(
    downloadOrder(api, { filename: 'test.csv', csv: 'test' }),
    (error) => {
      assert.match(error.message, /could not start/)
      assert.equal(error.cause, cause)
      return true
    }
  )
  assert.equal(attempts, 1)
  assert.equal(api.listeners.size, 0)
})

test('structured cancellation is distinct from an opaque start error', async () => {
  const api = downloadApi([{ state: 'interrupted', error: 'USER_CANCELED' }])
  await assert.rejects(
    waitForDownload(api, 9),
    /browser canceled.*No save was confirmed/
  )
  assert.equal(api.listeners.size, 0)
})
