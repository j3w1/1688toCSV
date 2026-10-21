import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { photoCopyTile } from '../src/photo-copy.js'

function setup(t) {
  const previous = globalThis.document
  const { document } = parseHTML('<html><body></body></html>')
  globalThis.document = document
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  })
  return document
}

test('thumbnail copy stays a sibling corner action and cannot open the photo or select its row', async (t) => {
  const document = setup(t)
  const row = document.createElement('article'),
    photo = document.createElement('button'),
    image = document.createElement('img')
  image.src = 'data:image/png;base64,AQID'
  photo.append(image)
  let opened = 0,
    selected = 0,
    copies = 0
  photo.addEventListener('click', () => opened++)
  row.addEventListener('click', () => selected++)
  const finished = Promise.withResolvers()
  const tile = photoCopyTile(photo, async () => {
    copies++
    finished.resolve()
  })
  row.append(tile)
  document.body.append(row)
  const copy = tile.querySelector('.photo-copy-button')
  assert.equal(photo.classList.contains('photo-copy-source'), true)
  assert.equal(tile.firstElementChild, photo)
  assert.equal(copy.parentElement, tile)
  assert.equal(photo.contains(copy), false)
  assert.equal(copy.getAttribute('aria-label'), 'Copy image')
  assert.equal(copy.textContent, '')
  copy.click()
  await finished.promise
  await Promise.resolve()
  assert.equal(copies, 1)
  assert.equal(opened, 0)
  assert.equal(selected, 0)
  assert.equal(image.src, 'data:image/png;base64,AQID')
  assert.equal(photo.querySelector('img'), image)
})

test('thumbnail copy retains source controls and disables missing or explicitly unavailable photos', (t) => {
  const document = setup(t)
  for (const [task, options] of [
    [undefined, {}],
    [() => assert.fail('disabled photo must not copy'), { disabled: true }],
  ]) {
    const photo = document.createElement('button')
    photo.className = 'store-import-photo-button'
    photo.setAttribute('aria-label', 'View source photo')
    const tile = photoCopyTile(photo, task, options)
    const copy = tile.querySelector('.photo-copy-button')
    assert.equal(copy.disabled, true)
    assert.equal(photo.classList.contains('store-import-photo-button'), true)
    assert.equal(photo.getAttribute('aria-label'), 'View source photo')
    copy.click()
  }
})
