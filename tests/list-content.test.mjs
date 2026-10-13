import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parseHTML } from 'linkedom'
import { readOrderList, goToListPage } from '../src/order-list.js'

test('list controls recover after delayed shadow hydration beyond fifteen seconds', async () => {
  const source = (
    await readFile(new URL('../src/list-content.js', import.meta.url), 'utf8')
  ).replace(/^import .*\r?\n/gm, '')
  const { document } = parseHTML(
    '<html><body><order-app></order-app></body></html>'
  )
  const root = document
    .querySelector('order-app')
    .attachShadow({ mode: 'open' })
  const tasks = new Map()
  let clock = 0,
    sequence = 0
  const context = vm.createContext({
    document,
    readOrderList,
    goToListPage,
    location: {
      href: 'https://air.1688.com/app/ctf-page/trade-order-list/buyer-order-list.html',
    },
    chrome: {
      runtime: { onMessage: { addListener() {}, removeListener() {} } },
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout(fn, delay) {
      const id = ++sequence
      tasks.set(id, { fn, at: clock + delay })
      return id
    },
    clearTimeout(id) {
      tasks.delete(id)
    },
  })
  function advance(until) {
    while (tasks.size) {
      const [id, task] = [...tasks].sort((a, b) => a[1].at - b[1].at)[0]
      if (task.at > until) break
      tasks.delete(id)
      clock = task.at
      task.fn()
    }
    clock = until
  }
  vm.runInContext(source, context)
  advance(20_000)
  assert.equal(document.body.children.length, 1)
  root.innerHTML =
    '<q-pagination data-tracker="pagination-order-list" current="1" pagesize="10" total="0"></q-pagination>'
  advance(22_000)
  const control = document.body.lastElementChild.shadowRoot
  assert.match(
    control.querySelector('aside').textContent,
    /Import all matching/
  )
  assert.equal(tasks.size, 0, 'Readiness retries stop after controls mount')
  vm.runInContext(
    'globalThis[Symbol.for("1688tocsv.listController")]()',
    context
  )
  assert.equal(document.body.children.length, 1)
})
