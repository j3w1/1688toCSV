import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { codeParts, setCodeText } from '../src/code-display.js'

test('human code aid keeps CE and date together and identifies the product without changing characters', () => {
  assert.deepEqual(codeParts('CE26103102'), ['CE2610', '3102'])
  assert.deepEqual(codeParts('CE26103102ALS300'), ['CE2610', '3102', 'ALS300'])
  for (const value of ['', '3102', 'CE2610310', 'CE 2610 3102', '<script>'])
    assert.equal(codeParts(value), null)
  const { document } = parseHTML('<html><body></body></html>')
  const badge = document.createElement('code')
  setCodeText(badge, 'CE26103102ALS300')
  assert.equal(badge.textContent, 'CE26103102ALS300')
  assert.equal(badge.querySelectorAll('.ce-code-part').length, 3)
  assert.equal(
    badge.querySelector('[data-code-part="product"]').textContent,
    '3102'
  )
  setCodeText(badge, '<script>')
  assert.equal(badge.textContent, '<script>')
  assert.equal(badge.querySelector('script'), null)
  assert.equal(badge.querySelectorAll('.ce-code-part').length, 0)
})
