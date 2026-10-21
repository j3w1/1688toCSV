import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import {
  mountCartonCapacity,
  cartonCapacityReadout,
  openCartonCapacityEditor,
} from '../src/carton-packing-ui.js'
import { createLanguageScope, getLanguage, setLanguage } from '../src/i18n.js'

const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture(t) {
  const { document, window } = parseHTML('<html><body></body></html>'),
    create = document.createElement.bind(document)
  class Dialog {}
  Dialog.prototype.closedBy = 'any'
  document.createElement = (tag, ...args) => {
    const element = create(tag, ...args)
    if (tag === 'dialog') {
      element.showModal = () => {
        element.open = true
      }
      element.close = () => {
        element.open = false
        element.dispatchEvent(new window.Event('close'))
      }
    }
    return element
  }
  for (const [key, value] of Object.entries({
    document,
    window,
    HTMLDialogElement: Dialog,
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
  return { document, window }
}

test('an unknown capacity has a keyboard button targeting only its source product and locks duplicate navigation', async (t) => {
  const { document } = fixture(t),
    item = { entryId: '2', quantity: '48' },
    calls = []
  let finish
  const row = cartonCapacityReadout(item, undefined, {
    onEdit: (source) => {
      calls.push(source)
      return new Promise((resolve) => {
        finish = resolve
      })
    },
  })
  document.body.append(row)
  const edit = row.querySelector('button')
  assert.equal(edit.textContent, '—')
  assert.equal(edit.getAttribute('aria-label'), 'Edit Pcs/box in Orders')
  assert.equal(row.querySelector('input'), null)
  edit.click()
  edit.click()
  assert.equal(edit.disabled, true)
  assert.deepEqual(calls, [item])
  finish()
  await tick()
  assert.equal(edit.disabled, false)
})

test('known capacity preserves copying and exposes a separate compact edit action; missing source explains unavailability', (t) => {
  fixture(t)
  const known = cartonCapacityReadout({ quantity: '40' }, 10, { onEdit() {} }),
    absent = cartonCapacityReadout({ quantity: '40' }, undefined)
  assert.equal(known.querySelectorAll('button').length, 2)
  assert.equal(
    known.querySelector('button').getAttribute('aria-label'),
    'Copy Pcs/box: 10'
  )
  assert.equal(
    known.querySelector('.carton-capacity-edit').getAttribute('aria-label'),
    'Edit Pcs/box in Orders'
  )
  assert.equal(absent.querySelector('button'), null)
  assert.equal(absent.getAttribute('role'), 'group')
  assert.equal(absent.getAttribute('tabindex'), '0')
})

test('capacity suffix follows the local language while numeric editing and saves stay exact', async (t) => {
  const { document, window } = fixture(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const host = document.createElement('main'),
    saves = []
  document.body.append(host)
  const editor = mountCartonCapacity(host, {
    quantity: '72',
    value: 18,
    onSave: async (value) => saves.push(value),
  })
  const unit = host.querySelector('.carton-capacity-unit')
  assert.equal(editor.input.type, 'number')
  assert.equal(editor.input.value, '18')
  assert.equal(unit.hidden, false)
  assert.equal(unit.getAttribute('aria-hidden'), 'true')
  createLanguageScope(host, 'es')
  assert.equal(unit.textContent, '/ctn')
  assert.equal(getLanguage(), 'en')
  setLanguage('zh', { scope: host })
  assert.equal(unit.textContent, '/箱')
  setLanguage('en', { scope: host })
  assert.equal(unit.textContent, '/box')
  for (const invalid of [
    '',
    '0',
    '-1',
    '1.5',
    'bad',
    '1e2',
    '9007199254740993',
  ]) {
    editor.input.value = invalid
    editor.input.dispatchEvent(new window.Event('input'))
    assert.equal(unit.hidden, true, invalid)
    assert.deepEqual(saves, [])
  }
  editor.input.value = '24'
  editor.input.dispatchEvent(new window.Event('input'))
  assert.equal(unit.hidden, false)
  await editor.flush()
  assert.deepEqual(saves, [24])
  assert.equal(editor.input.value, '24')
  editor.update({ quantity: '72', value: null })
  assert.equal(unit.hidden, true)
  assert.equal(editor.input.value, '')
})

test('capacity readouts localize their suffix but copy only the number; invalid values stay unknown', async (t) => {
  const { document } = fixture(t),
    copied = []
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async (value) => copied.push(value) } },
  })
  t.after(() =>
    previous
      ? Object.defineProperty(globalThis, 'navigator', previous)
      : delete globalThis.navigator
  )
  const row = cartonCapacityReadout({ quantity: '72' }, 18)
  document.body.append(row)
  const suffix = row.querySelector('.carton-capacity-unit')
  for (const [language, unit] of [
    ['en', '/box'],
    ['es', '/ctn'],
    ['zh', '/箱'],
  ]) {
    setLanguage(language, { persist: false })
    assert.equal(suffix.textContent, unit)
    row.querySelector('button').click()
    await tick()
  }
  assert.deepEqual(copied, ['18', '18', '18'])
  for (const capacity of [null, '', 0, -1, 1.5, 'bad']) {
    const unknown = cartonCapacityReadout({ quantity: '72' }, capacity)
    assert.equal(unknown.querySelector('.carton-capacity-unit'), null)
    assert.equal(unknown.querySelector('button'), null)
  }
})

test('source editor reuses its Orders controller, waits for its save and retains invalid drafts on close', async (t) => {
  const { document, window } = fixture(t),
    control = document.createElement('div'),
    input = document.createElement('input')
  control.append(input)
  let fail = true,
    focused = 0,
    finish
  input.focus = () => {
    focused++
  }
  const editor = openCartonCapacityEditor({
    item: {
      entryId: '2',
      sellerName: 'Synthetic store',
      description: 'Synthetic cup',
    },
    controller: {
      control,
      input,
      flush: async () => {
        if (fail) throw new Error('Pcs/box must be a positive whole number')
        await new Promise((resolve) => {
          finish = resolve
        })
      },
    },
  })
  assert.equal(editor.dialog.querySelector('input'), input)
  input.value = '0'
  assert.equal(await editor.close(), false)
  assert.equal(editor.dialog.isConnected, true)
  assert.match(
    editor.dialog.querySelector('[role="status"]').textContent,
    /positive whole number/
  )
  assert.equal(input.value, '0')
  assert.ok(focused >= 2)
  fail = false
  input.value = '12'
  const done = editor.close()
  assert.equal(editor.dialog.querySelector('fieldset').disabled, true)
  const cancel = new window.Event('cancel', { cancelable: true })
  assert.equal(editor.dialog.dispatchEvent(cancel), false)
  finish()
  assert.equal(await done, true)
  assert.equal(document.querySelector('dialog'), null)
})
