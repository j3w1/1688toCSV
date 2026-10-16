import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { copied, copyTextButton, resetCopyFeedback } from '../src/ui.js'
import { bindAttribute, bindText, setLanguage } from '../src/i18n.js'
import { decorateIcon } from '../src/icons.js'

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

test('compact copy actions announce their state and restore their translated accessible name', async (t) => {
  const { button } = setup(t)
  bindText(button, 'Columns')
  bindAttribute(button, 'aria-label', 'Copy columns')
  const pending = Promise.withResolvers()
  const result = copied(button, () => pending.promise)
  assert.equal(button.getAttribute('aria-label'), 'Copying…')
  pending.resolve()
  await result
  assert.equal(button.getAttribute('aria-label'), 'Copied')
  try {
    setLanguage('zh', { persist: false })
    assert.equal(button.getAttribute('aria-label'), '已复制')
    t.mock.timers.tick(3000)
    assert.equal(button.textContent, '列')
    assert.equal(button.getAttribute('aria-label'), '复制数据列')
  } finally {
    setLanguage('en', { persist: false })
  }
})

test('copy buttons show a check only after success and clear it when their content changes', async (t) => {
  const { button } = setup(t)
  decorateIcon(button, 'copy')
  const pending = Promise.withResolvers()
  const task = copied(button, () => pending.promise)
  assert.equal(button.dataset.icon, 'refresh')
  assert.equal(button.classList.contains('copied'), false)
  pending.resolve()
  assert.equal(await task, true)
  assert.equal(button.dataset.icon, 'check')
  resetCopyFeedback(button)
  assert.equal(button.textContent, 'Copy code')
  assert.equal(button.dataset.icon, 'copy')
  assert.equal(button.classList.contains('copied'), false)
  t.mock.timers.tick(5000)
  assert.equal(button.textContent, 'Copy code')
})

test('cancelled copy and scoped errors never show successful copy feedback', async (t) => {
  const { document, button } = setup(t)
  assert.equal(await copied(button, async () => false), false)
  assert.equal(button.textContent, 'Copy code')
  assert.equal(button.classList.contains('copied'), false)
  assert.equal(button.dataset.icon, undefined)
  let received
  const failure = new Error('Synthetic clipboard failure')
  assert.equal(
    await copied(
      button,
      async () => {
        throw failure
      },
      {
        onError(error) {
          received = error
        },
      }
    ),
    false
  )
  assert.equal(received, failure)
  assert.equal(button.textContent, 'Try again')
  assert.equal(button.classList.contains('copied'), false)
  assert.equal(document.querySelector('.copy-error'), null)
  resetCopyFeedback(button)
  assert.equal(button.textContent, 'Copy code')
})

test('icon copy feedback localizes its state and restores the original icon without a native tooltip', async (t) => {
  const { button } = setup(t)
  decorateIcon(button, 'copy', { iconOnly: true, label: 'Copy image' })
  button.removeAttribute('title')
  try {
    setLanguage('es', { persist: false })
    await copied(button, async () => {})
    assert.equal(button.textContent, '')
    assert.equal(button.dataset.icon, 'check')
    assert.match(button.getAttribute('aria-label'), /Copiado/)
    setLanguage('zh', { persist: false })
    assert.match(button.getAttribute('aria-label'), /已复制/)
    t.mock.timers.tick(3000)
    assert.equal(button.dataset.icon, 'copy')
    assert.equal(button.getAttribute('aria-label'), '复制图片')
    assert.equal(button.getAttribute('title'), null)
  } finally {
    setLanguage('en', { persist: false })
  }
})

test('copyable source values hide previous success during repeat writes and preserve their value', async (t) => {
  const { document } = setup(t)
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let pending = Promise.withResolvers()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: () => pending.promise } },
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous)
    else delete globalThis.navigator
  })
  const button = copyTextButton('5127523670009019539', {
    label: 'Copy order number',
  })
  document.body.append(button)
  const status = button.querySelector('.copy-text-feedback')
  button.click()
  assert.equal(status.hidden, true)
  pending.resolve()
  await pending.promise
  assert.equal(status.hidden, false)
  assert.equal(status.textContent, 'Copied')
  assert.ok(status.querySelector('.ui-icon'))
  pending = Promise.withResolvers()
  button.click()
  assert.equal(status.hidden, true)
  assert.equal(button.getAttribute('aria-busy'), 'true')
  pending.reject(new Error('Synthetic text copy failure'))
  await pending.promise.catch(() => {})
  assert.equal(status.textContent, 'Synthetic text copy failure')
  assert.equal(status.classList.contains('copy-text-error'), true)
  assert.equal(status.querySelector('.ui-icon'), null)
  assert.equal(button.firstChild.textContent, '5127523670009019539')
  t.mock.timers.tick(1800)
  assert.equal(status.hidden, true)
})
