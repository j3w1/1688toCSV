import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { copied } from '../src/ui.js'

function setup(t) {
  const { document } = parseHTML(
    '<html><body><button>Copy code</button></body></html>'
  )
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else delete globalThis.document
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  return { document, button: document.querySelector('button') }
}

test('repeated copy preserves its original label and pending progress past the previous reset', async (t) => {
  const { button } = setup(t)
  await copied(button, async () => {})
  assert.equal(button.textContent, 'Copied')
  t.mock.timers.tick(1000)

  const pending = Promise.withResolvers()
  const retry = copied(button, () => pending.promise)
  assert.equal(button.textContent, 'Copying…')
  assert.equal(button.classList.contains('copied'), false)
  assert.equal(button.disabled, true)
  await copied(button, () => assert.fail('must not start overlapping copies'))
  t.mock.timers.tick(5000)
  assert.equal(button.textContent, 'Copying…')
  assert.equal(button.disabled, true)

  pending.resolve()
  await retry
  assert.equal(button.textContent, 'Copied')
  assert.equal(button.classList.contains('copied'), true)
  assert.equal(button.disabled, false)
  t.mock.timers.tick(2999)
  assert.equal(button.textContent, 'Copied')
  t.mock.timers.tick(1)
  assert.equal(button.textContent, 'Copy code')
  assert.equal(button.classList.contains('copied'), false)
})

test('failed repeated copy clears success styling and a retry clears its error', async (t) => {
  const { document, button } = setup(t)
  await copied(button, async () => {})
  await copied(button, async () => {
    throw new Error('Synthetic clipboard failure')
  })
  assert.equal(button.textContent, 'Try again')
  assert.equal(button.classList.contains('copied'), false)
  assert.equal(button.classList.contains('copy-failed'), true)
  assert.equal(button.disabled, false)
  assert.equal(
    document.querySelector('[role="alert"]').textContent,
    'Synthetic clipboard failure'
  )

  const pending = Promise.withResolvers()
  const retry = copied(button, () => pending.promise)
  assert.equal(document.querySelector('.copy-error'), null)
  assert.equal(button.classList.contains('copy-failed'), false)
  t.mock.timers.tick(5000)
  assert.equal(button.textContent, 'Copying…')
  pending.resolve()
  await retry
  assert.equal(button.textContent, 'Copied')
  assert.equal(button.classList.contains('copied'), true)
  t.mock.timers.tick(3000)
  assert.equal(button.textContent, 'Copy code')
  assert.equal(button.classList.contains('copied'), false)
  assert.equal(button.classList.contains('copy-failed'), false)
  assert.equal(document.querySelector('.copy-error'), null)
})
