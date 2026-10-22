import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import {
  bindAttribute,
  bindText,
  message,
  setLanguage,
  t,
} from '../src/i18n.js'
import {
  actionHelp,
  installWorkspaceActionHelp,
} from '../src/workspace-action-help.js'
import { ACTION_HELP_RULES } from '../src/ui-messages-action-help.js'

test('action help covers copy formats, view controls and settings with translated instructions', () => {
  const { document } = parseHTML('<html><body></body></html>')
  const seen = new Set()
  for (const [actions, description, zh, es] of ACTION_HELP_RULES) {
    // Short action help is intentional; translations must still contain words.
    for (const text of [description, zh, es]) {
      assert.equal(text, text.trim())
      assert.match(text, /\p{L}/u)
    }
    for (const name of actions) {
      assert.ok(!seen.has(name), `Duplicate action: ${name}`)
      seen.add(name)
      const button = document.createElement('button')
      bindAttribute(button, 'aria-label', message(name))
      actionHelp(button)
      assert.ok(button.classList.contains('preparation-hint'), name)
    }
    for (const [language, expected] of [
      ['zh', zh],
      ['es', es],
    ]) {
      setLanguage(language, { persist: false })
      assert.equal(t(description), expected)
    }
  }
  setLanguage('en', { persist: false })
})

test('delegated help covers new controls after language changes without interpreting product data', () => {
  const { document, window } = parseHTML('<html><body></body></html>')
  installWorkspaceActionHelp(document)
  installWorkspaceActionHelp(document)
  setLanguage('es', { persist: false })
  const copy = document.createElement('button')
  bindText(copy, message('Copy current batch'))
  document.body.append(copy)
  copy.dispatchEvent(new window.Event('pointerover', { bubbles: true }))
  assert.ok(copy.classList.contains('preparation-hint'))
  const sourceProduct = document.createElement('button')
  sourceProduct.textContent = 'Copy current batch'
  document.body.append(sourceProduct)
  sourceProduct.dispatchEvent(
    new window.Event('pointerover', { bubbles: true })
  )
  assert.ok(!sourceProduct.classList.contains('preparation-hint'))
  setLanguage('en', { persist: false })
})

test('existing specialized help is preserved unless explicitly replacing a compact action label', () => {
  const { document } = parseHTML('<html><body></body></html>')
  const button = document.createElement('button')
  bindText(button, message('Copy values'))
  button.classList.add('preparation-hint')
  actionHelp(button)
  assert.equal(button.getAttribute('title'), null)
  // No helper was mounted merely from an existing class. Explicit replacement
  // creates the format-specific helper, the path used by the copy menu.
  button.classList.remove('preparation-hint')
  actionHelp(button, { replace: true })
  assert.ok(button.classList.contains('preparation-hint'))
})
