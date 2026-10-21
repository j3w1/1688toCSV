import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { parseHTML } from 'linkedom'
import { UI_MESSAGES } from '../src/ui-messages.js'
import { preparationColumns } from '../src/preparation-clipboard.js'
import {
  excelImageColumns,
  planExcelImage,
  renderExcelImage,
} from '../src/excel-image.js'
import { EXCEL_IMAGE_SCHEMES } from '../src/excel-image-style.js'
import { createExcelImageOptions } from '../src/excel-image-options.js'
import { openImageCopyDialog } from '../src/image-copy-dialog.js'
import { showErrorNotice, clearErrorNotice } from '../src/error-notice.js'
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
  createLanguageScope,
  inheritLanguageScope,
  LANGUAGE_PREFERENCE,
} from '../src/i18n.js'

test('popup scopes translate owned bindings, new content and nested messages without changing workspace state or sibling popups', async (context) => {
  const { document, window } = parseHTML(
    '<html><body><p data-i18n="Photo"></p><dialog id="first"><h2 data-i18n="Photo"></h2><input value="Seller text"></dialog><dialog id="second"><h2 data-i18n="Photo"></h2></dialog></body></html>'
  )
  const stored = new Map([[LANGUAGE_PREFERENCE, 'en']])
  for (const [key, value] of Object.entries({
    document,
    MutationObserver: window.MutationObserver,
    localStorage: {
      getItem: (key) => stored.get(key),
      setItem: (key, value) => stored.set(key, value),
    },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, configurable: true })
    context.after(() =>
      previous
        ? Object.defineProperty(globalThis, key, previous)
        : delete globalThis[key]
    )
  }
  setLanguage('en', { persist: false })
  const first = document.querySelector('#first'),
    second = document.querySelector('#second'),
    input = first.querySelector('input')
  localize(document)
  createLanguageScope(first)
  createLanguageScope(second, 'zh')
  let calls = 0,
    popupCalls = 0
  const stop = onLanguageChange(() => calls++)
  const stopPopup = onLanguageChange(() => popupCalls++, first)
  context.after(() => {
    stop()
    stopPopup()
    setLanguage('en', { persist: false })
  })
  const detail = document.createElement('p')
  first.append(detail)
  bindText(detail, message('Order {0}', { 0: () => message('Photo') }))
  setLanguage('es', { scope: first })
  assert.equal(first.querySelector('h2').textContent, 'Foto')
  assert.equal(detail.textContent, 'Pedido Foto')
  assert.equal(second.querySelector('h2').textContent, '图片')
  assert.equal(document.querySelector('body > p').textContent, 'Photo')
  assert.equal(getLanguage(), 'en')
  assert.equal(getLocale(first), 'es-PE')
  assert.equal(document.documentElement.lang, 'en')
  assert.equal(stored.get(LANGUAGE_PREFERENCE), 'en')
  assert.equal(calls, 0)
  assert.equal(popupCalls, 1)
  assert.equal(input.value, 'Seller text')
  const added = document.createElement('p')
  bindText(added, () => `${t('Photo')} · ${getLocale()}`)
  first.append(added)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(added.textContent, 'Foto · es-PE')
  const nested = document.createElement('dialog')
  inheritLanguageScope(nested, input)
  const caption = document.createElement('p')
  bindText(caption, 'Photo')
  nested.append(caption)
  document.body.append(nested)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(caption.textContent, 'Foto')
  setLanguage('zh', { scope: first })
  assert.equal(caption.textContent, 'Foto')
  setLanguage('es', { persist: false })
  assert.equal(first.querySelector('h2').textContent, '图片')
  assert.equal(second.querySelector('h2').textContent, '图片')
  assert.equal(caption.textContent, 'Foto')
  assert.equal(document.querySelector('body > p').textContent, 'Foto')
  assert.equal(t(message('Photo'), {}, 'en'), 'Photo')
  assert.equal(getLanguage(), 'es')
  for (const root of [first, second, nested])
    root.dispatchEvent(new window.Event('close'))
})

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
    for (const language of ['es', 'zh'])
      assert.ok(translations[language]?.trim(), `${language}: ${key}`)
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

test('explicit interface messages and declared copy fields have Spanish and Chinese mappings', () => {
  const keys = new Set(
    preparationColumns.flatMap(([, title, group]) => [title, group])
  )
  for (const { label } of EXCEL_IMAGE_SCHEMES) keys.add(label)
  const sourceDirectory = new URL('../src/', import.meta.url)
  for (const file of readdirSync(sourceDirectory)) {
    if (!/\.(js|html)$/.test(file) || file.startsWith('ui-messages')) continue
    const source = readFileSync(new URL(file, sourceDirectory), 'utf8')
    // Inspect only explicit translation calls and opted-in markup, never seller
    // strings, input values, errors from external services or arbitrary literals.
    for (const match of source.matchAll(
      /\b(?:t|message|uiMessage|m)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g
    ))
      keys.add(match[2].replace(/\\(['"\\])/g, '$1'))
    for (const match of source.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g))
      keys.add(match[1])
  }
  for (const key of keys) {
    if (!/\p{L}/u.test(key.replace(/\{\w+\}/g, ''))) continue
    for (const language of ['es', 'zh'])
      assert.ok(UI_MESSAGES[key]?.[language]?.trim(), `${language}: ${key}`)
  }
  for (const column of excelImageColumns)
    for (const language of ['es', 'zh'])
      assert.ok(
        column.labels?.[language]?.trim() ||
          UI_MESSAGES[column.label]?.[language]?.trim(),
        `${language}: Excel image ${column.key}`
      )
})

test('Excel image owned static errors have Spanish and Chinese mappings', () => {
  const keys = new Set()
  for (const file of [
    'excel-image.js',
    'excel-image-copy.js',
    'excel-image-options.js',
    'image-copy-dialog.js',
  ]) {
    const source = readFileSync(
      new URL(`../src/${file}`, import.meta.url),
      'utf8'
    )
    // These modules surface their own Error messages in the image-copy popup.
    // Exclude external failures, cancellation signals and arbitrary source data.
    for (const match of source.matchAll(
      /\bnew Error\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g
    ))
      keys.add(match[2].replace(/\\(['"\\])/g, '$1'))
  }
  assert.ok(keys.has('Choose at least one Excel image column.'))
  for (const key of keys)
    for (const language of ['es', 'zh'])
      assert.ok(UI_MESSAGES[key]?.[language]?.trim(), `${language}: ${key}`)
})

test('Excel image planning translates the actual empty-column error', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: {},
      createElement(tag) {
        assert.equal(tag, 'canvas')
        return { getContext: () => ({}) }
      },
    },
  })
  try {
    for (const [language, expected] of [
      ['es', 'Selecciona al menos una columna para copiar.'],
      ['zh', '请至少选择一列进行复制。'],
    ]) {
      setLanguage(language, { persist: false })
      assert.throws(
        () => planExcelImage([{ title: 'Source product' }], { columns: [] }),
        (error) => {
          assert.equal(error.message, 'Choose at least one Excel image column.')
          assert.equal(t(error.message), expected)
          return true
        }
      )
    }
  } finally {
    setLanguage('en', { persist: false })
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else delete globalThis.document
  }
})

test('Excel image notices translate nested photo and carton failures without changing product identities', async (context) => {
  const { document, window } = parseHTML('<html><body></body></html>')
  for (const [key, value] of Object.entries({
    document,
    MutationObserver: window.MutationObserver,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, configurable: true })
    context.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous)
      else delete globalThis[key]
    })
  }
  const createElement = document.createElement.bind(document)
  context.mock.method(document, 'createElement', (tag, ...args) => {
    const node = createElement(tag, ...args)
    if (tag === 'canvas')
      node.getContext = () => ({
        measureText: (text) => ({ width: String(text).length * 8 }),
        scale() {},
        fillRect() {},
        fillText() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
      })
    return node
  })
  const row = {
    title: 'Photo',
    thumbnail: 'synthetic-photo',
    baseCode: 'CE26100001',
    barcode: 'CE26100001AS',
    spanishName: 'No photo data was returned.',
    chineseCategory: '玻璃',
  }
  const original = structuredClone(row)
  try {
    for (const [language, photoError, markError] of [
      [
        'es',
        'No se pudo cargar la foto de la fila de producto 1. Actualiza la foto e inténtalo de nuevo. No se recibieron datos de la foto.',
        'No se pudo crear la marca de caja de la fila 1. Revisa su código y categoría en chino e inténtalo de nuevo. No se recibió ninguna imagen de la marca de caja.',
      ],
      [
        'zh',
        '无法加载第 1 行商品的图片。请刷新图片后重试。未返回图片数据。',
        '无法生成商品第 1 行的唛头。请检查货号和中文品类后重试。未返回唛头图片。',
      ],
    ]) {
      setLanguage(language, { persist: false })
      for (const [column, expected] of [
        ['thumbnail', photoError],
        ['baseCode', markError],
      ]) {
        const [plan] = planExcelImage([row], { columns: [column], language })
        await assert.rejects(
          renderExcelImage(plan, {
            loadImage: async () => '',
            renderCartonMark: async () => null,
          }),
          (error) => {
            const source = error.packingIssue.row
            assert.equal(source.number, '1')
            assert.equal(source.baseCode, original.baseCode)
            assert.equal(source.barcode, original.barcode)
            assert.equal(source.spanishName, original.spanishName)
            showErrorNotice(error, {
              scope: document.body,
              context: { code: source.barcode, variant: source.title },
            })
            assert.equal(
              document.querySelector('.error-notice-message').textContent,
              expected
            )
            assert.equal(
              document.querySelector('code').textContent,
              row.barcode
            )
            assert.ok(
              document
                .querySelector('.error-notice-product')
                .textContent.endsWith(row.title)
            )
            clearErrorNotice({ scope: document.body })
            return true
          }
        )
        assert.deepEqual(row, original)
      }
    }
  } finally {
    clearErrorNotice({ scope: document.body })
    setLanguage('en', { persist: false })
  }
})

test('packing menu, pagination, recovery and copy feedback translate their owned labels', () => {
  const keys = [
    'Arrange',
    'Arrange packing',
    'Arrange displayed orders',
    'Store',
    'Group code',
    'Store, then group code',
    'Previous groups',
    'Next groups',
    'Previous variants',
    'Next variants',
    'Describe this variant',
    'Choose a file created by Back up packing. Use Settings → Data → Restore for a full-library backup.',
    'No active labels to copy.',
    'This order is no longer available.',
    'Select product rows to copy.',
    'Choose a logo smaller than 2 MB.',
    'Copied',
    'Copying…',
    'Try again',
    'Copy label',
    'Could not copy. Try again.',
    'Copy failed. Try again.',
    'Click to copy this value.',
    'Click to copy the order number.',
    'Click to copy the store name.',
    'Retry',
  ]
  try {
    for (const language of ['es', 'zh']) {
      setLanguage(language, { persist: false })
      for (const key of keys)
        assert.notEqual(t(key), key, `${language}: ${key}`)
    }
    setLanguage('es', { persist: false })
    assert.equal(t('Article number'), 'Código')
  } finally {
    setLanguage('en', { persist: false })
  }
})

test('Excel image popup translates description, completion and empty-column feedback without changing source data', async (context) => {
  const { document, window } = parseHTML(
    '<html><body><p class="source">Product description</p><input value="Done"></body></html>'
  )
  for (const [key, value] of Object.entries({
    document,
    matchMedia: () => ({ matches: true }),
    localStorage: {
      getItem: () => JSON.stringify({ selected: [] }),
      setItem() {},
    },
    HTMLDialogElement: { prototype: { closedBy: 'any' } },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, configurable: true })
    context.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous)
      else delete globalThis[key]
    })
  }
  const createElement = document.createElement.bind(document)
  context.mock.method(document, 'createElement', (tag, ...args) => {
    const node = createElement(tag, ...args)
    // Linkedom omits native select writes and modal-dialog methods.
    if (tag === 'select')
      Object.defineProperty(node, 'value', {
        set(value) {
          for (const option of node.options)
            option.selected = option.value === value
        },
      })
    if (tag === 'dialog') {
      node.showModal = () => node.setAttribute('open', '')
      node.close = () => {
        node.removeAttribute('open')
        node.dispatchEvent(new window.Event('close'))
      }
    }
    return node
  })
  const rows = [{ title: 'Product description', productNumber: '001-A' }]
  const original = structuredClone(rows)
  const completion = openImageCopyDialog({
    title: 'Copy Excel image',
    count: 1,
    plan: async () => [],
    prepare: () => assert.fail('translation check must not render images'),
    write: () => assert.fail('translation check must not copy'),
    createOptions: (onChange) => createExcelImageOptions(onChange, { rows }),
  })
  const popup = document.querySelector('dialog')
  try {
    for (const [language, description, done, empty] of [
      [
        'es',
        'Descripción del producto',
        'Listo',
        'Selecciona al menos una columna para copiar.',
      ],
      ['zh', '商品描述', '完成', '请至少选择一列进行复制。'],
      [
        'en',
        'Product description',
        'Done',
        'Select at least one column to copy.',
      ],
    ]) {
      setLanguage(language, { persist: false })
      assert.equal(popup.querySelectorAll('legend')[1].textContent, description)
      assert.equal(
        popup.querySelector('.image-copy-actions button:last-child')
          .textContent,
        done
      )
      assert.equal(
        popup.querySelector('.excel-column-status').textContent,
        empty
      )
      assert.equal(
        document.querySelector('.source').textContent,
        'Product description'
      )
      assert.equal(document.querySelector('input').value, 'Done')
      assert.deepEqual(rows, original)
    }
  } finally {
    popup.close()
    await completion
    setLanguage('en', { persist: false })
  }
})

test('same-product barcode conflicts translate their recovery advice and preserve the exact code', () => {
  const code = 'CE26100102AM'
  const source = `Code conflict: ${code} belongs to another variant of this product. Keep different variant or size endings.`
  try {
    setLanguage('zh', { persist: false })
    assert.equal(
      t(source),
      `货号冲突：${code} 属于此商品的另一个款式。请使用不同的款式或尺寸后缀。`
    )
    setLanguage('es', { persist: false })
    assert.equal(
      t(source),
      `Conflicto de código: ${code} pertenece a otra variante de este producto. Usa sufijos de variante o talla diferentes.`
    )
  } finally {
    setLanguage('en', { persist: false })
  }
})
