import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { preparationHelp } from '../src/preparation-help.js'

function setup(t) {
  const { document, window } = parseHTML(
    '<html><body><button id="group">Group 1</button><input aria-describedby="existing" /><p id="existing">Existing description.</p></body></html>'
  )
  const previousObserver = Object.getOwnPropertyDescriptor(
    globalThis,
    'MutationObserver'
  )
  Object.defineProperty(globalThis, 'MutationObserver', {
    value: window.MutationObserver,
    configurable: true,
  })
  const rect = {
    left: 20,
    right: 180,
    top: 20,
    bottom: 60,
    width: 160,
    height: 40,
  }
  window.HTMLElement.prototype.getClientRects = () => [rect]
  window.HTMLElement.prototype.getBoundingClientRect = () => rect
  Object.defineProperty(document.documentElement, 'clientWidth', { value: 800 })
  Object.defineProperty(document.documentElement, 'clientHeight', {
    value: 600,
  })
  Object.defineProperty(document, 'activeElement', {
    value: document.body,
    configurable: true,
    writable: true,
  })
  // LinkeDOM has no layout hit-testing; model the actual pointer target.
  let pointerHit = document.body
  document.elementFromPoint = () => pointerHit
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const event = (target, type, properties = {}) => {
    if (type === 'pointerover') pointerHit = target
    if (type === 'pointerout')
      pointerHit = properties.relatedTarget || document.body
    const event = new window.Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, { clientX: 40, clientY: 40 }, properties)
    target.dispatchEvent(event)
    return event
  }
  const focus = (target) => {
    const previous = document.activeElement
    document.activeElement = target
    event(previous, 'focusout', { relatedTarget: target })
    event(target, 'focusin', { relatedTarget: previous })
  }
  const button = document.querySelector('button'),
    input = document.querySelector('input')
  preparationHelp(button, 'Select this group.')
  preparationHelp(input, 'Edit this code.')
  t.after(() => {
    event(document, 'pointerdown')
    if (previousObserver)
      Object.defineProperty(globalThis, 'MutationObserver', previousObserver)
    else delete globalThis.MutationObserver
  })
  const hint = () => document.querySelector('[role=tooltip]')
  const hover = (target) => {
    event(target, 'pointerover', {
      pointerType: 'mouse',
      relatedTarget: document.body,
    })
    t.mock.timers.tick(500)
  }
  const leave = (target, relatedTarget = document.body) =>
    event(target, 'pointerout', { relatedTarget })
  return { document, button, input, event, focus, hint, hover, leave }
}

test('pointer exit removes a helper immediately and cancels a queued reveal', (t) => {
  const { button, event, hint, hover, leave } = setup(t)
  hover(button)
  assert.equal(hint()?.textContent, 'Select this group.')
  leave(button)
  assert.equal(hint(), null)
  event(button, 'pointerover', { pointerType: 'mouse' })
  t.mock.timers.tick(200)
  leave(button)
  t.mock.timers.tick(1000)
  assert.equal(hint(), null)
})

test('click focus and click-driven replacement cannot pin a helper', (t) => {
  const { document, button, event, focus, hint, hover, leave } = setup(t)
  hover(button)
  event(button, 'pointerdown')
  focus(button)
  assert.equal(hint(), null)
  leave(button)
  hover(button)
  assert.ok(hint())
  leave(button)
  assert.equal(hint(), null)
  const replacement = document.createElement('button')
  replacement.textContent = 'Group 1'
  button.replaceWith(replacement)
  preparationHelp(replacement, 'Replacement helper.')
  focus(replacement)
  assert.equal(hint(), null)
  hover(replacement)
  assert.equal(hint()?.textContent, 'Replacement helper.')
  leave(replacement)
  assert.equal(hint(), null)
  assert.equal(document.activeElement, replacement)
})

for (const modal of [false, true]) {
  test(`keyboard help preserves focus and ${modal ? 'handles modal Escape first' : 'passes Escape to the workspace'}`, (t) => {
    const { document, input, event, focus, hint, leave } = setup(t)
    if (modal) {
      const dialog = document.createElement('dialog')
      dialog.setAttribute('open', '')
      document.body.append(dialog)
      dialog.append(input)
    }
    event(document, 'keydown', { key: 'Tab' })
    focus(input)
    assert.equal(hint()?.textContent, 'Edit this code.')
    assert.match(input.getAttribute('aria-describedby'), /^existing help-/)
    leave(input)
    assert.ok(
      hint(),
      'Keyboard focus owns this hint independently of pointer hover'
    )
    const escape = event(input, 'keydown', { key: 'Escape' })
    assert.equal(escape.defaultPrevented, modal)
    assert.equal(hint(), null)
    assert.equal(input.getAttribute('aria-describedby'), 'existing')
    assert.equal(document.activeElement, input)
  })
}

test('a later pointer click invalidates old keyboard focus as a pinning source', (t) => {
  const { document, input, event, focus, hint, hover, leave } = setup(t)
  event(document, 'keydown', { key: 'Tab' })
  focus(input)
  assert.ok(hint())
  event(document.body, 'pointerdown')
  assert.equal(hint(), null)
  hover(input)
  assert.ok(hint())
  event(input, 'keydown', { key: 'a' })
  leave(input)
  assert.equal(
    hint(),
    null,
    'Typing without a new keyboard focus cannot pin a pointer hint'
  )
})

test('noninteractive tooltip content does not retain hover after leaving its trigger', (t) => {
  const { button, hint, hover, leave } = setup(t)
  hover(button)
  const panel = hint()
  leave(button, panel)
  assert.equal(hint(), null)
})

test('a control covered before the hover delay cannot show its tooltip', (t) => {
  const { document, button, event, hint } = setup(t)
  event(button, 'pointerover', { pointerType: 'mouse' })
  document.elementFromPoint = () => document.body
  t.mock.timers.tick(500)
  assert.equal(hint(), null)
})
