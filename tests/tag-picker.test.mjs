import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { tagPickerChoices, mountTagPicker } from '../src/tag-picker.js'

test('tag choices rank matches, exclude selected names and preserve comma identities', () => {
  const definitions = [
    'Display upstairs',
    'Fragile display',
    'Display',
    'Display, upstairs',
    'Exhibición',
  ].map((name) => ({ name, colors: {} }))
  assert.deepEqual(
    tagPickerChoices('display', definitions, ['Display upstairs']).slice(0, 3),
    [
      { name: 'Display', create: false },
      { name: 'Display, upstairs', create: false },
      { name: 'Fragile display', create: false },
    ]
  )
  assert.equal(
    tagPickerChoices('exhibicion', definitions).some((choice) => choice.create),
    false
  )
  assert.deepEqual(tagPickerChoices('Display, upstairs', definitions), [
    { name: 'Display, upstairs', create: false },
  ])
  assert.deepEqual(tagPickerChoices('Brand new', definitions), [
    { name: 'Brand new', create: true },
  ])
})

test('tag picker commits pending names on close and keeps focus input intact during catalog updates', (t) => {
  const { document } = parseHTML('<html><body><main></main></body></html>')
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else delete globalThis.document
  })
  const changes = [],
    host = document.querySelector('main'),
    picker = mountTagPicker(host, {
      definitions: [{ name: 'Display, upstairs', colors: {} }],
      onChange: (tags) => changes.push(tags),
    })
  picker.input.value = 'Display, upstairs'
  assert.equal(picker.dirty(), true)
  picker.commitInput()
  assert.deepEqual(changes.at(-1), ['Display, upstairs'])
  assert.equal(picker.dirty(), false)
  const input = picker.input
  picker.setDefinitions([
    { name: 'Display, upstairs', colors: { light: '#123456' }, used: true },
  ])
  assert.equal(picker.input, input)
  assert.equal(input.parentNode, host.querySelector('.tag-picker-chips'))
  picker.input.value = 'New product tag'
  picker.commitInput()
  assert.deepEqual(changes.at(-1), ['Display, upstairs', 'New product tag'])
  picker.destroy()
  assert.equal(host.children.length, 0)
})
