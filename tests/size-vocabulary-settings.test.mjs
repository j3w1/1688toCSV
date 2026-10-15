import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { mountSizeVocabulary } from '../src/size-vocabulary-settings.js'
import { DEFAULT_SIZE_VOCABULARY } from '../src/size-vocabulary.js'

function setup(t, sizeVocabulary) {
  const { document, window } = parseHTML(
    '<html><body><section></section></body></html>'
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
  const value = sizeVocabulary === undefined ? {} : { sizeVocabulary }
  const host = document.querySelector('section')
  const editor = mountSizeVocabulary(host, value)
  const button = (label) =>
    [...host.querySelectorAll('button')].find(
      (node) => (node.getAttribute('aria-label') || node.textContent) === label
    )
  const rows = () => [...host.querySelectorAll('tbody tr')]
  const fill = (input, text) => {
    input.value = text
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  }
  return {
    document,
    window,
    host,
    value,
    editor,
    button,
    rows,
    fill,
    search: host.querySelector('input[type=search]'),
  }
}

test('size settings page a detached defaults draft, bounded to 12 rules', (t) => {
  const { value, rows, button, host } = setup(t)
  assert.equal(rows().length, 12)
  assert.notEqual(value.sizeVocabulary, DEFAULT_SIZE_VOCABULARY)
  assert.notEqual(value.sizeVocabulary[0], DEFAULT_SIZE_VOCABULARY[0])
  assert.equal(button('Previous size rules').disabled, true)
  button('Next size rules').click()
  assert.equal(rows().length, 8)
  assert.equal(
    host.querySelector('[role=status]').textContent,
    '13–20 of 20 rules'
  )
  assert.equal(button('Next size rules').disabled, true)
})

test('size draft edits survive paging and search without a save action', (t) => {
  const { value, rows, button, fill, search, editor, window } = setup(t)
  const first = rows()[0]
  fill(first.querySelector('[name=match]'), 'mini|小型')
  fill(first.querySelector('[name=suffix]'), 'xxs')
  first.dispatchEvent(new window.Event('focusout', { bubbles: true }))
  assert.deepEqual(value.sizeVocabulary[0], {
    match: 'mini|小型',
    suffix: 'XXS',
  })
  button('Next size rules').click()
  button('Previous size rules').click()
  assert.equal(rows()[0].querySelector('[name=match]').value, 'mini|小型')
  fill(search, '小型')
  assert.equal(rows().length, 1)
  assert.equal(rows()[0].querySelector('[name=suffix]').value, 'XXS')
  assert.equal(editor.validate()[0].suffix, 'XXS')
})

test('adding clears a search and removing preserves the same draft array', (t) => {
  const rules = [{ match: '小号', suffix: 'S' }]
  const { rows, button, fill, search, value, editor } = setup(t, rules)
  fill(search, 'not-present')
  assert.equal(rows()[0].textContent, 'No matching size rules.')
  button('Add size rule').click()
  assert.equal(search.value, '')
  fill(rows()[0].querySelector('[name=match]'), 'big+wide|加宽')
  fill(rows()[0].querySelector('[name=suffix]'), 'WIDE')
  assert.equal(value.sizeVocabulary, rules)
  assert.equal(editor.validate().length, 2)
  fill(search, 'big+wide')
  assert.equal(rows().length, 1)
  button('Remove size rule').click()
  assert.equal(rows()[0].textContent, 'No matching size rules.')
  assert.deepEqual(rules, [{ match: '小号', suffix: 'S' }])
})

test('validation reveals duplicate aliases on another page without losing edits', (t) => {
  const rules = Array.from({ length: 14 }, (_, index) => ({
    match: `Size ${index}`,
    suffix: `S${index}`,
  }))
  rules[13].match = 'SIZE 0'
  const { editor, rows, host, fill, search, value } = setup(t, rules)
  fill(search, 'Size 3')
  assert.throws(() => editor.validate(), /appears in more than one rule/)
  assert.equal(search.value, '')
  assert.equal(
    host.querySelector('[role=status]').textContent,
    '13–14 of 14 rules'
  )
  assert.equal(
    rows()[1].querySelector('[name=match]').getAttribute('aria-invalid'),
    'true'
  )
  assert.match(rows()[1].querySelector('[role=alert]').textContent, /SIZE 0/)
  fill(rows()[1].querySelector('[name=match]'), 'Size 13')
  assert.equal(
    rows()[1].querySelector('[name=match]').hasAttribute('aria-invalid'),
    false
  )
  assert.equal(value.sizeVocabulary[13].match, 'Size 13')
  assert.equal(editor.validate().length, 14)
})

test('empty aliases and invalid suffixes stay editable until corrected', (t) => {
  const { rows, fill, editor, window, value } = setup(t, [
    { match: 'small|', suffix: 'S' },
  ])
  let row = rows()[0]
  row.dispatchEvent(new window.Event('focusout', { bubbles: true }))
  assert.match(
    row.querySelector('[role=alert]').textContent,
    /empty or invalid size name/
  )
  assert.throws(() => editor.validate(), /empty or invalid size name/)
  row = rows()[0]
  fill(row.querySelector('[name=match]'), 'small')
  fill(row.querySelector('[name=suffix]'), 'S-M')
  row.dispatchEvent(new window.Event('focusout', { bubbles: true }))
  assert.match(
    row.querySelector('[role=alert]').textContent,
    /1–12 letters or numbers/
  )
  assert.equal(value.sizeVocabulary[0].suffix, 'S-M')
  fill(row.querySelector('[name=suffix]'), 'sm')
  assert.deepEqual(editor.validate(), [{ match: 'small', suffix: 'SM' }])
})

test('size rule limit cannot be exceeded from Add', (t) => {
  const rules = Array.from({ length: 500 }, (_, index) => ({
    match: `Size ${index}`,
    suffix: `S${index}`,
  }))
  const { button, rows } = setup(t, rules)
  assert.equal(button('Add size rule').disabled, true)
  button('Add size rule').click()
  assert.equal(rules.length, 500)
  assert.equal(rows().length, 12)
})
