import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import {
  normalizeCartonMeasurement,
  formatCartonMeasurement,
} from '../src/carton-details.js'
import { mountCartonMeasurement } from '../src/carton-measurements-ui.js'
import { CARTON_MESSAGES } from '../src/ui-messages-cartons.js'

function fixture(t) {
  const { document, window } = parseHTML(
    '<html><body><main></main></body></html>'
  )
  for (const [key, value] of Object.entries({
    document,
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
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const host = document.querySelector('main')
  const event = (target, name, properties = {}) => {
    const emitted = new window.Event(name, {
      bubbles: true,
      cancelable: true,
    })
    Object.assign(emitted, properties)
    target.dispatchEvent(emitted)
    return emitted
  }
  return { host, event }
}

test('measurement decimals preserve precision, accept decimal commas and distinguish unknown from zero', () => {
  for (const field of ['kg', 'cbm']) {
    for (const [input, expected] of [
      [undefined, ''],
      [null, ''],
      ['', ''],
      ['  ', ''],
      [0, '0'],
      ['0.000', '0'],
      [' 020,5000 ', '20.5'],
      ['.25', '0.25'],
      [',001000', '0.001'],
      ['0.000000000000000123456789', '0.000000000000000123456789'],
      ['12345678901234567890.987654321', '12345678901234567890.987654321'],
    ])
      assert.equal(normalizeCartonMeasurement(input, field), expected)
    for (const input of [
      -1,
      true,
      [],
      {},
      Infinity,
      NaN,
      '-1',
      '+2',
      '1e2',
      '20kg',
      '1 200',
      '1,200.5',
      '1.200,5',
      '1,000,000',
      '1.000.000',
      '.',
      ',',
      '20.',
      '20,',
    ])
      assert.throws(
        () => normalizeCartonMeasurement(input, field),
        /nonnegative decimal/
      )
  }
  assert.throws(() => normalizeCartonMeasurement('2', 'boxes'), /Unknown/)
  assert.equal(formatCartonMeasurement('20.500', 'kg'), '20.5 kg')
  assert.equal(formatCartonMeasurement('0,1050', 'cbm'), '0.105 m³')
  assert.equal(formatCartonMeasurement(null, 'kg'), '—')
})

test('inline measurements show units only for entered values and canonical autosaves', async (t) => {
  const { host, event } = fixture(t),
    saves = [],
    editor = mountCartonMeasurement(host, {
      field: 'kg',
      value: '20.5',
      onSave: async (value) => saves.push(value),
    })
  assert.equal(editor.input.type, 'text')
  assert.equal(editor.input.inputMode, 'decimal')
  assert.equal(host.querySelector('label').textContent, 'Weight (kg/box)')
  const unit = host.querySelector('.carton-measurement-unit')
  assert.equal(unit.textContent, 'kg')
  assert.equal(unit.hidden, false)
  assert.equal(editor.dirty(), false)
  editor.input.value = '25,2500'
  event(editor.input, 'input')
  await editor.flush()
  assert.deepEqual(saves, ['25.25'])
  assert.equal(editor.input.value, '25.25')
  assert.equal(editor.dirty(), false)
  assert.equal(editor.control.dataset.state, 'saved')
  assert.equal(host.querySelector('[role="status"]').textContent, 'Saved')
  editor.input.value = '00025,2500'
  await editor.flush()
  assert.equal(editor.input.value, '25.25')
  assert.deepEqual(saves, ['25.25'])
  editor.input.value = ''
  await editor.flush()
  assert.deepEqual(saves, ['25.25', ''])
  assert.equal(unit.hidden, true)
  assert.equal(editor.update({ value: '0' }), true)
  assert.equal(editor.input.value, '0')
  assert.equal(unit.hidden, false)
})

test('invalid and bad-input measurement drafts cannot silently clear saved values', async (t) => {
  const { host, event } = fixture(t),
    saves = [],
    editor = mountCartonMeasurement(host, {
      field: 'cbm',
      value: '0.1',
      onSave: async (value) => saves.push(value),
    })
  editor.input.value = '0,'
  event(editor.input, 'input')
  t.mock.timers.tick(500)
  assert.equal(editor.input.hasAttribute('aria-invalid'), false)
  assert.equal(editor.update({ value: '0.2' }), false)
  assert.equal(editor.input.value, '0,')
  await assert.rejects(editor.flush(), /Volume must be/)
  assert.equal(editor.input.getAttribute('aria-invalid'), 'true')
  assert.equal(editor.control.dataset.state, 'error')
  assert.equal(editor.dirty(), true)
  assert.deepEqual(saves, [])
  editor.input.value = ''
  Object.defineProperty(editor.input, 'validity', {
    configurable: true,
    value: { badInput: true },
  })
  await assert.rejects(editor.flush(), /Volume must be/)
  assert.deepEqual(saves, [])
})

test('valid decimal edits autosave after a pause and Enter commits without submitting', async (t) => {
  const { host, event } = fixture(t),
    saves = [],
    editor = mountCartonMeasurement(host, {
      field: 'kg',
      onSave: async (value) => saves.push(value),
    })
  editor.input.value = '12,5'
  event(editor.input, 'input')
  t.mock.timers.tick(449)
  assert.deepEqual(saves, [])
  t.mock.timers.tick(1)
  assert.deepEqual(saves, ['12.5'])
  await editor.flush()
  editor.input.value = '15'
  event(editor.input, 'input')
  const enter = event(editor.input, 'keydown', { key: 'Enter' })
  assert.equal(enter.defaultPrevented, true)
  await editor.flush()
  assert.deepEqual(saves, ['12.5', '15'])
})

test('edits typed during persistence save in order and updates never overwrite the draft', async (t) => {
  const { host } = fixture(t),
    saves = []
  let finish
  const first = new Promise((resolve) => (finish = resolve))
  const editor = mountCartonMeasurement(host, {
    field: 'cbm',
    value: '0.1',
    onSave: async (value) => {
      saves.push(value)
      if (saves.length === 1) await first
    },
  })
  editor.input.value = '0.2'
  const flushing = editor.flush()
  assert.deepEqual(saves, ['0.2'])
  editor.input.value = '0,305'
  assert.equal(editor.update({ value: '9' }), false)
  assert.equal(editor.input.value, '0,305')
  finish()
  await flushing
  assert.deepEqual(saves, ['0.2', '0.305'])
  assert.equal(editor.input.value, '0.305')
  assert.equal(editor.dirty(), false)
})

test('failed synchronous and asynchronous saves retain drafts and can be retried', async (t) => {
  const { host } = fixture(t)
  for (const synchronous of [true, false]) {
    let shouldFail = true
    const editor = mountCartonMeasurement(host, {
      field: 'kg',
      value: '2',
      onSave: (value) => {
        assert.equal(value, '3.5')
        if (shouldFail) {
          if (synchronous) throw new Error('Synthetic save failure')
          return Promise.reject(new Error('Synthetic save failure'))
        }
      },
    })
    editor.input.value = '3,5'
    await assert.rejects(editor.flush(), /Synthetic save failure/)
    assert.equal(editor.dirty(), true)
    assert.equal(editor.input.value, '3,5')
    assert.equal(editor.update({ value: '2' }), false)
    assert.equal(editor.input.value, '3,5')
    shouldFail = false
    await editor.flush()
    assert.equal(editor.dirty(), false)
    assert.equal(editor.input.value, '3.5')
    assert.equal(editor.input.hasAttribute('aria-invalid'), false)
  }
})

test('measurement errors and helpers have Spanish and Chinese translations', () => {
  for (const [source, translations] of Object.entries(CARTON_MESSAGES)) {
    assert.ok(translations.es?.trim(), `${source}: Spanish`)
    assert.ok(translations.zh?.trim(), `${source}: Chinese`)
  }
})
