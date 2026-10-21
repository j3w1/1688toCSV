import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { mountCartonDetails } from '../src/carton-details-ui.js'
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
  let valid = true
  document.createElement = (tag, ...args) => {
    const node = create(tag, ...args)
    if (tag === 'input')
      node.setCustomValidity = (text) => {
        node.validationMessage = text
      }
    if (tag === 'form') node.reportValidity = () => valid
    return node
  }
  const host = document.querySelector('main'),
    panel = mountCartonDetails(host, options),
    input = (key) => panel.querySelector(`input[name="${key}"]`),
    event = (target, name) =>
      target.dispatchEvent(
        new window.Event(name, { bubbles: true, cancelable: true })
      ),
    change = (key, value) => {
      input(key).value = value
      event(input(key), 'input')
    }
  return {
    panel,
    input,
    event,
    change,
    setValid(value) {
      valid = value
    },
  }
}

test('carton editor is always visible, uses native labeled unit controls and preserves exact zero and decimal drafts', async (t) => {
  const value = { boxes: '2', kg: '0', cbm: '0.000000000000000123456789' },
    before = structuredClone(value),
    writes = [],
    { panel, input, event } = fixture(t, {
      value,
      onSave: async (value) => writes.push(value),
    })
  assert.equal(panel.localName, 'section')
  assert.equal(panel.querySelector('details, summary'), null)
  for (const key of ['boxes', 'kg', 'cbm', 'len', 'wid', 'ht']) {
    const node = input(key)
    assert.equal(node.type, 'number')
    assert.ok(panel.querySelector(`label[for="${node.id}"]`))
    assert.equal(node.step, key === 'boxes' ? '1' : 'any')
  }
  assert.equal(input('boxes').min, '1')
  assert.equal(input('kg').value, '0')
  assert.equal(input('cbm').value, value.cbm)
  assert.equal(input('len').value, '')
  assert.equal(
    panel.querySelector('.product-carton-volume-value').textContent,
    value.cbm
  )
  assert.equal(panel.dataset.volumeSource, 'manual')
  assert.equal(writes.length, 0)
  event(panel.querySelector('form'), 'submit')
  await tick()
  assert.deepEqual(writes, [before])
  assert.deepEqual(value, before)
})

test('dimensions take priority without replacing manual volume and incomplete dimensions stay required', (t) => {
  const manual = '0.123456789123456789',
    { panel, input, change } = fixture(t, { value: { cbm: manual } }),
    output = panel.querySelector('.product-carton-volume-value')
  change('len', '58.5')
  assert.equal(output.textContent, manual)
  assert.match(
    panel.querySelector('.product-carton-note').textContent,
    /all three dimensions/
  )
  for (const key of ['len', 'wid', 'ht'])
    assert.equal(input(key).required, true)
  change('wid', '35.2')
  change('ht', '47')
  assert.equal(output.textContent, '0.0967824')
  assert.equal(panel.dataset.volumeSource, 'dimensions')
  assert.equal(input('cbm').value, manual)
  assert.match(
    panel.querySelector('.product-carton-volume-source').textContent,
    /Calculated from dimensions/
  )
  change('len', '0')
  assert.match(input('len').validationMessage, /greater than zero/)
  assert.equal(panel.dataset.volumeSource, 'manual')
  for (const key of ['len', 'wid', 'ht']) change(key, '')
  for (const key of ['len', 'wid', 'ht'])
    assert.equal(input(key).required, false)
  change('cbm', '0')
  assert.equal(output.textContent, '0')
  change('cbm', '')
  assert.equal(output.textContent, '—')
  assert.equal(panel.dataset.volumeSource, 'unknown')
})

test('carton stepper edits whole counts only and leaves invalid drafts and safe-integer boundaries intact', (t) => {
  const { panel, input, change } = fixture(t),
    decrease = panel.querySelector('[aria-label="Decrease cartons"]'),
    increase = panel.querySelector('[aria-label="Increase cartons"]')
  decrease.click()
  assert.equal(input('boxes').value, '')
  increase.click()
  assert.equal(input('boxes').value, '1')
  decrease.click()
  assert.equal(input('boxes').value, '1')
  increase.click()
  assert.equal(input('boxes').value, '2')
  change('boxes', '1.5')
  increase.click()
  assert.equal(input('boxes').value, '1.5')
  change('boxes', String(Number.MAX_SAFE_INTEGER))
  increase.click()
  assert.equal(input('boxes').value, String(Number.MAX_SAFE_INTEGER))
  assert.equal(panel.dataset.saveState, 'draft')
})

test('pending manual save blocks duplicate submissions and restores all controls and exact input after failure and retry', async (t) => {
  let resolve, reject
  const writes = [],
    busy = [],
    { panel, input, event } = fixture(t, {
      value: { kg: '0', cbm: '0.000000000000000123456789' },
      onBusyChange: (value) => busy.push(value),
      onSave: (value) => {
        writes.push(value)
        return new Promise((done, fail) => {
          resolve = done
          reject = fail
        })
      },
    }),
    form = panel.querySelector('form'),
    save = panel.querySelector('button[type="submit"]')
  event(form, 'submit')
  assert.equal(form.getAttribute('aria-busy'), 'true')
  assert.equal(save.disabled, true)
  for (const fieldset of panel.querySelectorAll('fieldset'))
    assert.equal(fieldset.disabled, true)
  event(form, 'submit')
  assert.equal(writes.length, 1)
  reject(new Error('Synthetic storage failure'))
  await tick()
  assert.equal(panel.dataset.saveState, 'error')
  assert.equal(input('kg').value, '0')
  assert.equal(input('cbm').value, '0.000000000000000123456789')
  assert.match(
    panel.querySelector('.product-carton-status').textContent,
    /Synthetic storage failure.*draft is still here/
  )
  assert.equal(save.disabled, false)
  for (const fieldset of panel.querySelectorAll('fieldset'))
    assert.equal(fieldset.disabled, false)
  event(form, 'submit')
  assert.equal(writes.length, 2)
  assert.deepEqual(writes[1], writes[0])
  resolve()
  await tick()
  assert.equal(panel.dataset.saveState, 'saved')
  assert.equal(form.getAttribute('aria-busy'), 'false')
  assert.deepEqual(busy, [true, false, true, false])
})

test('native validity prevents saves and localized validation and labels never replace the entered draft', async (t) => {
  let saves = 0
  const { panel, input, event, change, setValid } = fixture(t, {
    onSave: async () => saves++,
  })
  change('kg', '0.123456789123456789')
  change('len', '0')
  setValid(false)
  event(panel.querySelector('form'), 'submit')
  await tick()
  assert.equal(saves, 0)
  for (const [language, increase, error] of [
    [
      'es',
      'Aumentar cajas',
      'Las medidas de la caja deben ser mayores que cero.',
    ],
    ['zh', '增加箱数', '纸箱尺寸必须大于零。'],
    ['en', 'Increase cartons', 'Carton dimensions must be greater than zero.'],
  ]) {
    setLanguage(language, { persist: false })
    event(input('len'), 'invalid')
    assert.ok(panel.querySelector(`[aria-label="${increase}"]`))
    assert.equal(input('len').validationMessage, error)
    assert.equal(input('kg').value, '0.123456789123456789')
    assert.equal(input('len').value, '0')
  }
})
