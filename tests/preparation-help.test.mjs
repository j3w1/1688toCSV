import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { preparationHelp } from '../src/preparation-help.js'
import {
  productContextHelp,
  orderContextHelp,
} from '../src/item-context-help.js'
import { setLanguage } from '../src/i18n.js'

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
  const frames = new Map()
  let frameId = 0
  for (const [name, value] of Object.entries({
    requestAnimationFrame(callback) {
      frames.set(++frameId, callback)
      return frameId
    },
    cancelAnimationFrame(id) {
      frames.delete(id)
    },
  })) {
    const previous = Object.getOwnPropertyDescriptor(window, name)
    Object.defineProperty(window, name, { configurable: true, value })
    t.after(() => {
      if (previous) Object.defineProperty(window, name, previous)
      else delete window[name]
    })
  }
  const frame = () => {
    const callbacks = [...frames.values()]
    frames.clear()
    for (const callback of callbacks) callback(0)
  }
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
  return {
    document,
    button,
    input,
    event,
    focus,
    hint,
    hover,
    leave,
    frame,
    frames,
  }
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

test('pointer help opens at the latest delayed position and coalesces moves into one frame', (t) => {
  const { button, event, hint, frame, frames, leave } = setup(t)
  event(button, 'pointerover', {
    pointerType: 'mouse',
    clientX: 30,
    clientY: 30,
  })
  event(button, 'pointermove', {
    pointerType: 'mouse',
    clientX: 120,
    clientY: 100,
  })
  assert.equal(frames.size, 0)
  t.mock.timers.tick(499)
  assert.equal(hint(), null)
  t.mock.timers.tick(1)
  assert.equal(hint().style.left, '132px')
  assert.equal(hint().style.top, '112px')
  event(button, 'pointermove', { clientX: 200, clientY: 180 })
  event(button, 'pointermove', { clientX: 240, clientY: 210 })
  assert.equal(frames.size, 1)
  assert.equal(hint().style.left, '132px')
  frame()
  assert.equal(hint().style.left, '252px')
  assert.equal(hint().style.top, '222px')
  event(button, 'pointermove', { clientX: 260, clientY: 220 })
  leave(button)
  assert.equal(frames.size, 0)
  assert.equal(hint(), null)
  event(button, 'pointermove', { clientX: 280, clientY: 230 })
  assert.equal(frames.size, 0)
})

test('pointer help flips within the viewport while keyboard help remains anchored to its target', (t) => {
  const { document, button, event, hint, frame, hover, leave, focus } = setup(t)
  hover(button)
  event(button, 'pointermove', { clientX: 795, clientY: 595 })
  frame()
  assert.equal(hint().style.left, '623px')
  assert.equal(hint().style.top, '543px')
  leave(button)
  event(document, 'keydown', { key: 'Tab' })
  focus(button)
  assert.equal(hint().style.left, '20px')
  assert.equal(hint().style.top, '68px')
  hover(button)
  frame()
  assert.equal(hint().style.left, '52px')
  leave(button)
  frame()
  assert.equal(hint().style.left, '20px')
  assert.equal(hint().style.top, '68px')
})

test('rich-content reflow shares the pointer frame and old lifecycle callbacks stay canceled after reopening', (t) => {
  const { button, event, hint, frame, frames, hover, leave } = setup(t)
  const lifecycles = []
  preparationHelp(button, 'Rich helper', {
    renderContent(content, lifecycle) {
      content.textContent = 'Rich helper'
      lifecycles.push(lifecycle)
    },
  })
  hover(button)
  event(button, 'pointermove', { clientX: 180, clientY: 140 })
  lifecycles[0].requestPosition()
  assert.equal(frames.size, 1)
  frame()
  assert.equal(hint().style.left, '192px')
  leave(button)
  lifecycles[0].requestPosition()
  assert.equal(frames.size, 0)
  hover(button)
  lifecycles[0].requestPosition()
  assert.equal(frames.size, 0)
  assert.equal(lifecycles[0].signal.aborted, true)
  leave(button)
})

test('item context is lazy, literal and refreshed without changing selection or adding controls', async (t) => {
  const { document, button, hint, hover, leave } = setup(t)
  const item = {
    entryId: '1',
    orderId: '00123',
    sellerName: 'Supplier',
    barcode: 'CE26103102ALS',
    description: '<script>source text</script>',
    quantity: '12',
    price: '1.25',
    discount: '0.00',
    thumbnail: 'test-photo',
  }
  const record = {
    notes: 'Saved supplier note',
    snapshot: { sellerName: 'Supplier' },
  }
  let read = 0,
    loaded = 0,
    resolvePhoto
  productContextHelp(button, {
    getProduct: () => {
      read++
      return item
    },
    getRecord: () => record,
    loadImage: () => {
      loaded++
      return new Promise((resolve) => {
        resolvePhoto = resolve
      })
    },
  })
  assert.equal(read, 0)
  assert.equal(loaded, 0)
  const controls = document.querySelectorAll('button,input').length
  button.setAttribute('aria-selected', 'true')
  hover(button)
  assert.equal(read, 1)
  assert.equal(loaded, 1)
  assert.equal(hint().querySelector('code').textContent, item.barcode)
  assert.equal(hint().querySelector('script'), null)
  assert.match(hint().textContent, /<script>source text<\/script>/)
  assert.match(hint().textContent, /15\.00 CNY/)
  assert.match(hint().textContent, /Saved supplier note/)
  assert.equal(document.querySelectorAll('button,input').length, controls)
  assert.equal(button.getAttribute('aria-selected'), 'true')
  const image = hint().querySelector('img')
  leave(button)
  resolvePhoto('data:image/png;base64,late')
  await Promise.resolve()
  assert.equal(hint(), null)
  assert.equal(image.getAttribute('src'), null)
  item.description = 'Updated source description'
  hover(button)
  assert.equal(read, 2)
  assert.match(hint().textContent, /Updated source description/)
  leave(button)
})

test('order context shows bounded products, source totals and notes with translated labels', (t) => {
  const { button, hint, hover, leave } = setup(t)
  const items = Array.from({ length: 5 }, (_, index) => ({
    entryId: String(index + 1),
    description: `Product ${index + 1}`,
    quantity: '2',
    price: '3.50',
  }))
  const record = {
    notes: 'Do not fold cartons',
    snapshot: {
      orderId: '001234',
      sellerName: 'Factory',
      status: '交易成功',
      items,
      totals: { shipping: '0.00', payable: '35.00' },
    },
  }
  orderContextHelp(button, { getRecord: () => record })
  setLanguage('es', { persist: false })
  try {
    hover(button)
    assert.equal(hint().querySelectorAll('.item-context-product').length, 3)
    assert.match(hint().textContent, /Factory/)
    assert.match(hint().textContent, /001234/)
    assert.match(hint().textContent, /Total del pedido/)
    assert.match(hint().textContent, /35\.00 CNY/)
    assert.match(hint().textContent, /0\.00 CNY/)
    assert.match(hint().textContent, /Do not fold cartons/)
    leave(button)
  } finally {
    setLanguage('en', { persist: false })
  }
})
