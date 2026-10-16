import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { UI_MESSAGES } from '../src/ui-messages.js'
import {
  t,
  message,
  bindText,
  bindAttribute,
  localize,
  setLanguage,
  getLanguage,
  getLocale,
  onLanguageChange,
} from '../src/i18n.js'

test('three interface languages translate explicit messages and preserve inserted source values', () => {
  try {
    setLanguage('zh', { persist: false })
    assert.equal(t('Photo'), '图片')
    assert.equal(
      t('Order {0}', { 0: '5127523670009019539' }),
      '订单 5127523670009019539'
    )
    assert.equal(t('Unknown seller text'), 'Unknown seller text')
    setLanguage('es', { persist: false })
    assert.equal(t('Photo'), 'Foto')
    assert.equal(getLocale(), 'es-PE')
    assert.equal(setLanguage('fr'), false)
    assert.equal(getLanguage(), 'es')
  } finally {
    setLanguage('en', { persist: false })
  }
})

test('live translation changes only owned UI nodes without replacing controls or source data', () => {
  const { document } = parseHTML(
    '<html><body><label><span data-i18n="Photo">Photo</span><input value="VELAS"></label><p class="source">Photo</p><button></button></body></html>'
  )
  const input = document.querySelector('input'),
    button = document.querySelector('button')
  const eventCalls = []
  input.addEventListener('input', () => eventCalls.push('edited'))
  input.value = 'MI NOMBRE SIN GUARDAR'
  localize(document)
  bindText(button, message('Copy order number'))
  const svg = document.createElement('svg')
  button.prepend(svg)
  try {
    setLanguage('zh', { persist: false })
    assert.equal(document.querySelector('[data-i18n]').textContent, '图片')
    assert.equal(document.querySelector('.source').textContent, 'Photo')
    assert.equal(document.querySelector('input'), input)
    assert.equal(input.value, 'MI NOMBRE SIN GUARDAR')
    assert.equal(button.textContent, '复制订单号')
    assert.equal(button.firstChild, svg)
    input.dispatchEvent(new document.defaultView.Event('input'))
    assert.deepEqual(eventCalls, ['edited'])
    setLanguage('es', { persist: false })
    assert.equal(button.textContent, 'Copiar número de pedido')
    assert.equal(input.value, 'MI NOMBRE SIN GUARDAR')
  } finally {
    setLanguage('en', { persist: false })
  }
})

test('removed help titles and replaced source attributes are not resurrected by translation', () => {
  const { document } = parseHTML('<button></button><img>')
  const button = document.querySelector('button'),
    image = document.querySelector('img')
  bindAttribute(button, 'title', 'Photo')
  bindAttribute(image, 'alt', 'Photo')
  button.removeAttribute('title')
  image.alt = 'Seller original photo name'
  try {
    setLanguage('es', { persist: false })
    assert.equal(button.hasAttribute('title'), false)
    assert.equal(image.alt, 'Seller original photo name')
    assert.throws(
      () => bindText(document.createElement('input'), 'Photo'),
      /never its value/
    )
    assert.throws(() => bindAttribute(image, 'src', 'Photo'), /Unsupported/)
  } finally {
    setLanguage('en', { persist: false })
  }
})

test('translation catalogs retain interpolated data placeholders', () => {
  for (const [key, translations] of Object.entries(UI_MESSAGES)) {
    const source = new Set(key.match(/\{\w+\}/g) || [])
    for (const [language, value] of Object.entries(translations)) {
      assert.ok(value?.trim(), `${language}: ${key}`)
      for (const placeholder of value.match(/\{\w+\}/g) || [])
        assert.ok(
          source.has(placeholder),
          `Unknown ${placeholder} in ${language}: ${key}`
        )
    }
  }
})
