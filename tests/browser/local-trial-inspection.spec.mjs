import { test, expect } from './extension-fixture.mjs'
import { libraryInspector } from '../../scripts/try-browser.mjs'

test('local trial inspection never creates a missing database and counts every existing store without reading out orders', async ({
  extension,
}) => {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  const name = `synthetic-trial-${crypto.randomUUID()}`
  await expect(page.evaluate(`(${libraryInspector(name)})()`)).rejects.toThrow(
    /library database missing/
  )
  expect(
    await page.evaluate(
      async (name) =>
        (await indexedDB.databases()).some((db) => db.name === name),
      name
    )
  ).toBe(false)
  await page.evaluate(async (name) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 3)
      request.onupgradeneeded = () => {
        for (const store of ['orders', 'images', 'jobs', 'futureStore'])
          request.result.createObjectStore(store, { keyPath: 'id' })
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    const tx = db.transaction([...db.objectStoreNames], 'readwrite')
    tx.objectStore('orders').add({
      id: 'one',
      description: 'Synthetic content stays private to storage',
    })
    tx.objectStore('images').add({ id: 'one', original: 'synthetic' })
    tx.objectStore('jobs').add({ id: 'one', state: 'paused' })
    tx.objectStore('futureStore').add({ id: 'one' })
    tx.objectStore('futureStore').add({ id: 'two' })
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onabort = () => reject(tx.error)
    })
    db.close()
  }, name)
  const result = await page.evaluate(`(${libraryInspector(name)})()`)
  expect(result).toEqual({
    counts: { orders: 1, images: 1, jobs: 1, futureStore: 2 },
    jobs: ['paused'],
    build: null,
  })
  const retained = await page.evaluate(async (name) => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open(name)
      request.onsuccess = () => resolve(request.result)
    })
    const value = await new Promise((resolve) => {
      const request = db.transaction('orders').objectStore('orders').get('one')
      request.onsuccess = () => resolve(request.result)
    })
    db.close()
    return { version: db.version, value }
  }, name)
  expect(retained).toEqual({
    version: 3,
    value: {
      id: 'one',
      description: 'Synthetic content stays private to storage',
    },
  })
})
