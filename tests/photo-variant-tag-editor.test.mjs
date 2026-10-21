import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { mountPhotoVariantTagEditor } from '../src/photo-variant-tag-editor.js'
import { photoEditDraft, PHOTO_TAG_TEXT_LIMIT } from '../src/product-photo.js'

function fixture(t) {
  const { document, window } = parseHTML(
    '<html><body><main></main><section tabindex="0"></section><output></output></body></html>'
  )
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: document,
  })
  t.after(() =>
    previous
      ? Object.defineProperty(globalThis, 'document', previous)
      : delete globalThis.document
  )
  const context = { measureText: (value) => ({ width: value.length * 20 }) }
  for (const method of [
    'save',
    'restore',
    'clearRect',
    'beginPath',
    'moveTo',
    'lineTo',
    'stroke',
    'roundRect',
    'fill',
    'arc',
    'fillText',
  ])
    context[method] = () => {}
  t.mock.method(window.HTMLCanvasElement.prototype, 'getContext', () => context)
  const host = document.querySelector('main'),
    viewport = document.querySelector('section'),
    edit = photoEditDraft(),
    status = document.querySelector('output')
  const controller = mountPhotoVariantTagEditor({
    host,
    viewport,
    getImage: () => ({
      naturalWidth: 640,
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 640,
        height: 640,
      }),
    }),
    getEdit: () => edit,
    active: () => true,
    saving: () => false,
    status,
    signal: new AbortController().signal,
  })
  const input = host.querySelector('input[type="text"]')
  let invalidMessage = '',
    reports = 0
  input.setCustomValidity = (value) => {
    invalidMessage = value
  }
  input.reportValidity = () => {
    reports++
    return !invalidMessage
  }
  const emit = (target, type, properties = {}) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, properties)
    target.dispatchEvent(event)
  }
  const type = (value) => {
    input.value = value
    emit(input, 'input')
  }
  const place = () => {
    emit(host.querySelector('.photo-tag-entry button'), 'click')
    emit(viewport, 'pointerdown', {
      button: 0,
      isPrimary: true,
      clientX: 180,
      clientY: 240,
    })
  }
  controller.refresh()
  return {
    host,
    input,
    edit,
    controller,
    type,
    place,
    emit,
    reports: () => reports,
    error: () => invalidMessage,
  }
}

test('photo annotation editor places and renames free text without code formatting or markup interpretation', (t) => {
  const f = fixture(t)
  assert.equal(f.input.hasAttribute('pattern'), false)
  assert.equal(f.input.maxLength, PHOTO_TAG_TEXT_LIMIT)
  for (const text of [
    '20.5cm',
    '大盘 · 8.5"',
    'Black & white',
    '<b>Not markup</b>',
  ]) {
    f.type(text)
    assert.equal(f.input.value, text)
    f.place()
    assert.equal(f.edit.tags.at(-1).code, text)
    assert.equal(f.error(), '')
    assert.equal(f.controller.valid(), true)
  }
  assert.equal(f.host.querySelector('.photo-variant-tag-list b'), null)
  assert.equal(
    f.host.querySelector('.photo-variant-tag-list').lastElementChild
      .textContent,
    '<b>Not markup</b>'
  )
  f.type('renamed 大盘 20.5cm')
  f.emit(f.host.querySelector('.photo-tag-tools button'), 'click')
  assert.equal(f.edit.tags.at(-1).code, 'renamed 大盘 20.5cm')
  assert.equal(f.reports(), 0)
  assert.equal(f.edit.tagScale, 2)
  assert.equal(f.edit.pointerScale, 1)
})

test('quick photo tags keep composing variant endings and replace custom prose without changing saved text', (t) => {
  const f = fixture(t)
  f.type('20.5cm')
  f.place()
  const original = f.edit.tags[0].code
  const quick = (value) =>
    f.emit(
      [...f.host.querySelectorAll('.photo-tag-quick-button')].find(
        (button) => button.textContent === value
      ),
      'click'
    )
  quick('A')
  assert.equal(f.input.value, 'A')
  quick('XL')
  assert.equal(f.input.value, 'AXL')
  quick('B')
  assert.equal(f.input.value, 'BXL')
  assert.equal(f.edit.tags[0].code, original)
})

test('blank, oversized and control-character tag drafts cannot replace a saved annotation', (t) => {
  const f = fixture(t)
  f.type('20.5cm')
  f.place()
  for (const invalid of [
    '',
    '   ',
    'x'.repeat(PHOTO_TAG_TEXT_LIMIT + 1),
    'bad\u0000text',
  ]) {
    f.type(invalid)
    assert.equal(f.error(), '')
    assert.equal(f.controller.valid(), false)
    assert.match(f.error(), /1–64 characters/)
    f.emit(f.host.querySelector('.photo-tag-tools button'), 'click')
    assert.equal(f.edit.tags[0].code, '20.5cm')
  }
  f.type('valid again')
  assert.equal(f.error(), '')
  assert.equal(f.controller.valid(), true)
})
