import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { mountProductVocabulary } from '../src/product-vocabulary-settings.js'
import { mountSizeVocabulary } from '../src/size-vocabulary-settings.js'
import { mountColorVocabulary } from '../src/color-vocabulary-settings.js'
import { mountMaterialVocabulary } from '../src/material-vocabulary-settings.js'
import { virtualTableDom } from './virtual-table-dom.mjs'

const editors = [
  {
    name: 'names',
    key: 'vocabulary',
    mount: mountProductVocabulary,
    field: '[aria-label="Title includes"]',
    rule: (index) => ({
      match: `Product ${index}`,
      spanishName: `PRODUCT ${index}`,
      category: `产品${index}`,
    }),
  },
  {
    name: 'sizes',
    key: 'sizeVocabulary',
    mount: mountSizeVocabulary,
    field: '[name=match]',
    rule: (index) => ({ match: `Size ${index}`, suffix: `S${index}` }),
  },
  {
    name: 'colors',
    key: 'colorVocabulary',
    mount: mountColorVocabulary,
    field: '[data-rule-field=en]',
    rule: (index) => ({
      id: `color-${index}`,
      aliases: [`seller-${index}`],
      labels: {
        en: `Color ${index}`,
        es: `Color español ${index}`,
        zh: `颜色${index}`,
      },
      swatch: '#336699',
      kind: 'color',
    }),
  },
  {
    name: 'materials',
    key: 'materialVocabulary',
    mount: mountMaterialVocabulary,
    field: '[name=en]',
    rule: (index) => ({
      id: `material-${index}`,
      aliases: [`seller-${index}`],
      en: `Material ${index}`,
      es: `Material español ${index}`,
      zh: `材质${index}`,
      parent: '',
    }),
  },
]
function setup(t, config, count = 500) {
  let editor
  t.after(() => editor?.destroy())
  const { document, window } = parseHTML(
    '<html><body><section></section></body></html>'
  )
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  t.after(() =>
    previous
      ? Object.defineProperty(globalThis, 'document', previous)
      : delete globalThis.document
  )
  const flush = virtualTableDom(t, window)
  const originalMatches = window.HTMLElement.prototype.matches
  window.HTMLElement.prototype.matches = function (selector) {
    return selector === ':popover-open'
      ? false
      : originalMatches.call(this, selector)
  }
  t.after(() => (window.HTMLElement.prototype.matches = originalMatches))
  const host = document.querySelector('section'),
    value = {
      [config.key]: Array.from({ length: count }, (_, index) =>
        config.rule(index)
      ),
    }
  editor = config.mount(host, value)
  const scroll = host.querySelector('.vocabulary-scroll'),
    search = host.querySelector('input[type=search]')
  const rows = () => [...host.querySelectorAll('tbody tr[data-virtual-key]')]
  const fill = (input, text) => {
    input.value = text
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  }
  const move = (top) => {
    scroll.scrollTop = top
    scroll.dispatchEvent(new window.Event('scroll'))
    flush()
  }
  return {
    document,
    window,
    host,
    value,
    editor,
    scroll,
    search,
    rows,
    fill,
    move,
    flush,
  }
}
for (const config of editors) {
  test(`${config.name} continuously scrolls a bounded row window and retains focused and recycled drafts`, (t) => {
    const { document, rows, fill, search, move, host, value, editor } = setup(
      t,
      config
    )
    assert.equal(rows().length, 100)
    assert.equal(host.querySelector('[aria-label^="Next "]'), null)
    const first = rows()[0].querySelector(config.field)
    first.focus()
    fill(first, 'Unsaved draft')
    move(1000000)
    assert.equal(document.activeElement, first)
    assert.equal(first.isConnected, true)
    assert.equal(first.value, 'Unsaved draft')
    assert.ok(rows().length <= 101)
    const last = rows().at(-1)
    assert.match(
      last.textContent +
        JSON.stringify(
          [...last.querySelectorAll('input')].map((input) => input.value)
        ),
      /499/
    )
    search.focus()
    document.body.focus()
    move(1000000)
    assert.equal(first.isConnected, false)
    move(0)
    assert.equal(rows()[0].querySelector(config.field).value, 'Unsaved draft')
    assert.equal(value[config.key].length, 500)
    if (editor.validate) assert.equal(editor.validate().length, 500)
    fill(search, 'no-such-rule')
    assert.equal(rows().length, 0)
    move(0)
    assert.equal(host.querySelectorAll('.vocabulary-empty').length, 1)
    assert.match(
      host.querySelector('.vocabulary-empty').textContent,
      /No matching/
    )
    fill(search, 'Unsaved draft')
    assert.equal(rows().length, 1)
    fill(search, '')
    assert.equal(rows().length, 100)
  })
}
test('Tab and Shift+Tab reveal adjacent offscreen rules without overriding text arrow keys', (t) => {
  const { document, window, rows, host } = setup(t, editors[1])
  let last = rows().at(-1),
    button = last.querySelector('button')
  button.focus()
  const tab = new window.Event('keydown', { bubbles: true, cancelable: true })
  Object.defineProperty(tab, 'key', { value: 'Tab' })
  button.dispatchEvent(tab)
  assert.equal(tab.defaultPrevented, true)
  assert.equal(document.activeElement.value, 'Size 100')
  const backwards = new window.Event('keydown', {
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperties(backwards, {
    key: { value: 'Tab' },
    shiftKey: { value: true },
  })
  document.activeElement.dispatchEvent(backwards)
  assert.equal(backwards.defaultPrevented, true)
  assert.equal(
    document.activeElement.closest('tr').querySelector('[name=match]').value,
    'Size 99'
  )
  const arrow = new window.Event('keydown', { bubbles: true, cancelable: true })
  Object.defineProperty(arrow, 'key', { value: 'ArrowDown' })
  host.querySelector('tbody input').dispatchEvent(arrow)
  assert.equal(arrow.defaultPrevented, false)
})

for (const config of editors.slice(1)) {
  test(`${config.name} reveals an offscreen validation error after its hidden section opens`, (t) => {
    const { editor, host, value, scroll, document } = setup(t, config, 250)
    const entry = value[config.key].at(-1)
    if (config.name === 'sizes') entry.suffix = 'S-M'
    else if (config.name === 'colors') entry.labels.en = ''
    else entry.es = ''
    let hidden = true,
      top = 0
    Object.defineProperty(scroll, 'scrollTop', {
      configurable: true,
      get: () => (hidden ? 0 : top),
      set: (value) => {
        if (!hidden) top = value
      },
    })
    Object.defineProperty(scroll, 'clientWidth', {
      configurable: true,
      get: () => (hidden ? 0 : 800),
    })
    Object.defineProperty(scroll, 'clientHeight', {
      configurable: true,
      get: () => (hidden ? 0 : 300),
    })
    assert.throws(() => editor.validate())
    assert.equal(host.querySelector('[aria-invalid=true]'), null)
    hidden = false
    const invalid = editor.revealError()
    assert.ok(invalid)
    invalid.focus()
    assert.equal(document.activeElement, invalid)
    assert.ok(
      [...invalid.closest('tr').querySelectorAll('input')].some((input) =>
        input.value.includes('249')
      )
    )
    assert.ok(host.querySelectorAll('tbody tr[data-virtual-key]').length <= 100)
  })
}
