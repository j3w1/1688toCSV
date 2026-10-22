import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import {
  mountCartonDetails,
  cartonDimensionTuple,
} from '../src/carton-details-ui.js'
import { setLanguage } from '../src/i18n.js'

const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture(t, options = {}) {
  const { document, window } = parseHTML(
    '<html><body><main></main></body></html>'
  )
  for (const [key, value] of Object.entries({
    document,
    Event: window.Event,
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
  setLanguage('en', { persist: false })
  t.after(() => setLanguage('en', { persist: false }))
  const create = document.createElement.bind(document)
  document.createElement = (tag, ...args) => {
    const node = create(tag, ...args)
    if (tag === 'input')
      node.setCustomValidity = (text) => {
        node.validationMessage = text
      }
    if (tag === 'form')
      node.reportValidity = () =>
        ![...node.querySelectorAll('input')].some(
          (input) => input.validationMessage || (input.required && !input.value)
        )
    return node
  }
  const panel = mountCartonDetails(document.querySelector('main'), options),
    input = (key) => panel.querySelector(`input[name="${key}"]`),
    event = (target, type) =>
      target.dispatchEvent(
        new window.Event(type, { bubbles: true, cancelable: true })
      ),
    change = (key, value) => {
      input(key).value = value
      event(input(key), 'input')
    }
  t.after(() => panel.destroy())
  return { panel, input, event, change, window }
}

test('carton defaults have no manual CBM field and retain exact read-only supplier volume', async (t) => {
  const value = { boxes: '2', kg: '0', cbm: '0.000000000000000123456789' },
    writes = [],
    { panel, input, change } = fixture(t, {
      value,
      onSave: async (next) => writes.push(next),
    })
  assert.equal(panel.querySelector('details, summary, input[name="cbm"]'), null)
  assert.equal(
    panel.querySelector('svg.product-carton-cube').getAttribute('aria-hidden'),
    'true'
  )
  assert.match(
    panel.querySelector('.product-carton-supplied').textContent,
    /0.000000000000000123456789/
  )
  assert.equal(
    panel.querySelector('.product-carton-volume-value').textContent,
    value.cbm
  )
  assert.equal(panel.dataset.volumeSource, 'supplied')
  for (const key of ['boxes', 'kg', 'len', 'wid', 'ht']) {
    assert.equal(input(key).type, 'text')
    assert.ok(panel.querySelector(`label[for="${input(key).id}"]`))
  }
  assert.equal(writes.length, 0)
  change('kg', '1,23456789123456789')
  await panel.flush()
  assert.deepEqual(writes, [{ ...value, kg: '1.23456789123456789' }])
  assert.equal(value.kg, '0')
})

test('partial and invalid XYZ remain drafts, while complete dimensions calculate without rounding measurements', async (t) => {
  const writes = [],
    { panel, input, change } = fixture(t, {
      value: { cbm: '0.7' },
      onSave: async (value) => writes.push(value),
    })
  change('len', '0.01')
  assert.equal(
    panel.querySelector('.product-carton-volume-value').textContent,
    '0.7'
  )
  await assert.rejects(panel.flush(), /length, width and height/)
  assert.equal(writes.length, 0)
  assert.equal(input('len').value, '0.01')
  change('wid', '0,01')
  change('ht', '0.01')
  assert.equal(
    panel.querySelector('.product-carton-volume-value').textContent,
    '0.000000000001'
  )
  await panel.flush()
  assert.equal(writes[0].cbm, '0.7')
  assert.equal(writes[0].wid, '0.01')
  change('len', '0')
  await assert.rejects(panel.flush(), /greater than zero/)
  assert.equal(panel.dataset.volumeSource, 'supplied')
  for (const key of ['len', 'wid', 'ht']) change(key, '')
  await panel.flush()
  assert.deepEqual(writes.at(-1), { cbm: '0.7' })
})

test('explicit dimension tuple paste fills all XYZ and rejects ambiguous size strings', async (t) => {
  assert.deepEqual(cartonDimensionTuple('40 × 30,5 × 25 cm'), {
    len: '40',
    wid: '30.5',
    ht: '25',
  })
  for (const text of [
    '40×30',
    '40/30/25',
    'Size 40x30x25',
    '40x0x25',
    '40x30x25 inches',
  ])
    assert.equal(cartonDimensionTuple(text), null)
  const writes = [],
    { panel, input, window } = fixture(t, {
      onSave: async (value) => writes.push(value),
    }),
    paste = new window.Event('paste', { bubbles: true, cancelable: true })
  paste.clipboardData = { getData: () => '40×30×25' }
  input('len').dispatchEvent(paste)
  assert.equal(paste.defaultPrevented, true)
  assert.equal(input('ht').value, '25')
  assert.equal(
    panel.querySelector('.product-carton-volume-value').textContent,
    '0.03'
  )
  await panel.flush()
  assert.deepEqual(writes, [{ len: '40', wid: '30', ht: '25' }])
})

test('autosave keeps incomplete decimals quiet, retries storage errors and retains edits typed during an in-flight write', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const writes = [],
    busy = []
  let resolve, reject
  const { panel, input, change } = fixture(t, {
    value: { kg: '0' },
    onBusyChange: (value) => busy.push(value),
    onSave: (value) => {
      writes.push(value)
      return new Promise((done, fail) => {
        resolve = done
        reject = fail
      })
    },
  })
  change('kg', '1,')
  t.mock.timers.tick(500)
  await tick()
  assert.equal(writes.length, 0)
  assert.equal(input('kg').value, '1,')
  change('kg', '1,25')
  t.mock.timers.tick(500)
  assert.deepEqual(writes, [{ kg: '1.25' }])
  reject(new Error('Synthetic storage failure'))
  await tick()
  assert.equal(panel.dataset.saveState, 'error')
  assert.equal(input('kg').value, '1,25')
  const retry = panel.flush()
  change('kg', '2,5')
  resolve()
  await tick()
  assert.deepEqual(writes, [{ kg: '1.25' }, { kg: '1.25' }, { kg: '2.5' }])
  resolve()
  await retry
  assert.equal(panel.dataset.saveState, 'saved')
  assert.equal(panel.dirty(), false)
  assert.deepEqual(busy, [true, false, true, false, true, false])
})

test('carton count shortcuts preserve safe whole counts and never clear invalid drafts', (t) => {
  const { panel, input, change } = fixture(t),
    decrease = panel.querySelector('[aria-label="Decrease Cartons"]'),
    increase = panel.querySelector('[aria-label="Increase Cartons"]')
  decrease.click()
  assert.equal(input('boxes').value, '')
  increase.click()
  assert.equal(input('boxes').value, '1')
  decrease.click()
  assert.equal(input('boxes').value, '1')
  change('boxes', '1.5')
  increase.click()
  assert.equal(input('boxes').value, '1.5')
  change('boxes', String(Number.MAX_SAFE_INTEGER))
  increase.click()
  assert.equal(input('boxes').value, String(Number.MAX_SAFE_INTEGER))
})
