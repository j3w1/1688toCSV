import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { openRepeatProductDialog } from '../src/repeat-products-ui.js'
import {
  planSharedProductLink,
  repeatProductCandidates,
} from '../src/repeat-products.js'
import { repeatSubsetFixture } from './fixtures/repeat-subset-fixture.mjs'

test('repeat candidate cards expose the matched S barcode, photo, size and quantity and only save after review', async (t) => {
  const { document, window } = parseHTML('<html><body></body></html>')
  for (const [key, value] of Object.entries({
    document,
    HTMLDialogElement: window.HTMLElement,
    MutationObserver: window.MutationObserver,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() =>
      previous
        ? Object.defineProperty(globalThis, key, previous)
        : delete globalThis[key]
    )
  }
  const create = document.createElement.bind(document)
  document.createElement = (tag, ...args) => {
    const node = create(tag, ...args)
    if (tag === 'dialog') {
      node.showModal = () => {
        node.open = true
      }
      node.close = () => {
        node.open = false
        node.dispatchEvent(new window.Event('close'))
      }
    }
    return node
  }
  const data = repeatSubsetFixture()
  let saves = 0
  const photos = []
  const forgotten = []
  const done = openRepeatProductDialog({
    source: data.ref(1),
    repository: {
      getRepeatProductCandidates: async (source) =>
        repeatProductCandidates({ source, ...data }),
      previewRepeatProductLink: async ({ source, target }) =>
        planSharedProductLink({ source, target, ...data }),
      linkRepeatProduct: async (plan) => {
        saves++
        return plan.preparations
      },
    },
    media: {
      photo(item, options = {}) {
        photos.push(options)
        const image = document.createElement('img')
        image.src = item.thumbnail
        return image
      },
      forget: (host) => forgotten.push(host),
    },
  })
  await new Promise((resolve) => setImmediate(resolve))
  const dialog = document.querySelector('dialog')
  const card = dialog.querySelector('.repeat-product-candidate')
  assert.equal(dialog.querySelector('select, [role="combobox"]'), null)
  assert.equal(card.querySelector('code').textContent, 'CE26101001S')
  assert.equal(
    card.querySelector('[data-code-part="product"]').textContent,
    '1001'
  )
  assert.match(card.textContent, /55cm/)
  assert.match(card.textContent, /Quantity 3/)
  assert.equal(card.querySelectorAll('img').length, 1)
  assert.equal(photos[0].interactive, false)
  const search = dialog.querySelector('[type="search"]')
  search.value = 'CE26101001M'
  search.dispatchEvent(new window.Event('input'))
  assert.equal(card.hidden, true)
  assert.match(
    dialog.querySelector('.repeat-product-empty').textContent,
    /No original products match/
  )
  search.value = '55cm'
  search.dispatchEvent(new window.Event('input'))
  assert.equal(card.hidden, false)
  const choice = card.querySelector('input')
  choice.checked = true
  choice.dispatchEvent(new window.Event('change'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(dialog.querySelectorAll('.repeat-product-source').length, 4)
  assert.equal(saves, 0)
  const confirmation = dialog.querySelector('.repeat-product-confirm input')
  const apply = dialog.querySelector('button.primary')
  assert.equal(apply.disabled, true)
  confirmation.checked = true
  confirmation.dispatchEvent(new window.Event('change'))
  apply.click()
  assert.equal(await done, true)
  assert.equal(saves, 1)
  assert.ok(
    forgotten.some((host) => host.classList.contains('repeat-product-choice'))
  )
})
