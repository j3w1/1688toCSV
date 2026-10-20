import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { mountMaterialVocabulary } from '../src/material-vocabulary-settings.js'
import { setLanguage } from '../src/i18n.js'
import {
  MATERIAL_VOCABULARY,
  configureMaterialVocabulary,
  validateMaterialVocabulary,
  suggestMaterial,
  translateMaterial,
} from '../src/material-vocabulary.js'
import {
  createPreparation,
  refreshPreparationMaterials,
  setVariantMaterial,
  variantMaterial,
  validatePackingPreferences,
} from '../src/packing-model.js'
import { validateBackup } from '../src/database.js'

const rule = (index) => ({
  id: `material-${index}`,
  aliases: [`seller-${index}`],
  en: `Material ${index}`,
  zh: `材质${index}`,
  es: `Material español ${index}`,
  parent: '',
})

function setup(t, materialVocabulary) {
  const { document, window } = parseHTML(
    '<html><body><section></section></body></html>'
  )
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  // LinkeDOM has no popover state; the Chrome-only suggestion list stays closed.
  const originalMatches = window.HTMLElement.prototype.matches
  window.HTMLElement.prototype.matches = function (selector) {
    return selector === ':popover-open'
      ? false
      : originalMatches.call(this, selector)
  }
  t.after(() => {
    window.HTMLElement.prototype.matches = originalMatches
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else delete globalThis.document
  })
  const value = materialVocabulary === undefined ? {} : { materialVocabulary },
    host = document.querySelector('section'),
    editor = mountMaterialVocabulary(host, value)
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

test('material rules normalize detached local aliases and translated names', () => {
  const input = [rule(0)]
  input[0].aliases = ['  TEST material  ', 'ＴＥＳＴ material']
  input[0].en = '  Material 0  '
  const result = validateMaterialVocabulary(input)
  assert.deepEqual(result[0].aliases, ['TEST material'])
  assert.equal(result[0].en, 'Material 0')
  assert.equal(input[0].en, '  Material 0  ')
  result[0].aliases.push('another')
  assert.equal(input[0].aliases.length, 2)
  assert.deepEqual(
    validateMaterialVocabulary(MATERIAL_VOCABULARY),
    structuredClone(MATERIAL_VOCABULARY)
  )
})

test('material edits control aliases and all three displays while preserving source text', () => {
  const rules = structuredClone(MATERIAL_VOCABULARY),
    glass = rules.find((entry) => entry.id === 'glass')
  glass.aliases.push('晶透新材质')
  Object.assign(glass, {
    en: 'Clear glass',
    zh: '通透玻璃',
    es: 'Vidrio claro',
  })
  const item = { title: '晶透新材质花瓶' },
    before = structuredClone(item)
  configureMaterialVocabulary(rules)
  try {
    assert.equal(suggestMaterial(item), '通透玻璃')
    for (const language of ['en', 'zh', 'es'])
      assert.equal(translateMaterial('晶透新材质', language), glass[language])
    assert.equal(translateMaterial('Made by hand', 'es'), 'Made by hand')
    assert.deepEqual(item, before)
    assert.equal(MATERIAL_VOCABULARY[0].en, 'Glass')
    glass.aliases.push('after configuration')
    assert.equal(suggestMaterial({ title: 'after configuration' }), '')
  } finally {
    configureMaterialVocabulary()
  }
})

test('material rules follow saved preference and full-library backup validation', () => {
  const input = rule(0)
  input.aliases.push('  seller-alternative  ')
  const preferences = validatePackingPreferences({
    materialVocabulary: [input],
  })
  assert.equal(
    preferences.materialVocabulary[0].aliases[1],
    'seller-alternative'
  )
  const exportedAt = '2026-10-20T00:00:00.000Z',
    backup = {
      format: '1688-order-library',
      version: 2,
      exportedAt,
      orders: [],
      history: [],
      preparations: [],
      allocations: [],
      issuedCodes: [],
      packingPreferences: { value: preferences, updatedAt: exportedAt },
    }
  const restored = validateBackup(JSON.parse(JSON.stringify(backup)))
  assert.deepEqual(
    restored.packingPreferences.value.materialVocabulary,
    preferences.materialVocabulary
  )
  backup.packingPreferences.value.materialVocabulary[0].aliases = []
  assert.throws(() => validateBackup(backup), /seller material names/)
  assert.equal(validatePackingPreferences().materialVocabulary, undefined)
})

test('deleting rules disables their recognition and translations without stale indexes', () => {
  configureMaterialVocabulary([])
  try {
    assert.equal(suggestMaterial({ title: '玻璃瓶' }), '')
    assert.equal(translateMaterial('玻璃', 'es'), '玻璃')
  } finally {
    configureMaterialVocabulary()
  }
  assert.equal(suggestMaterial({ title: '玻璃瓶' }), '玻璃')
})

test('material rules reject duplicate aliases and display names, invalid fields and excessive rules', () => {
  const duplicate = [rule(0), rule(1)]
  duplicate[1].aliases.push('ＳＥＬＬＥＲ-0')
  assert.throws(
    () => validateMaterialVocabulary(duplicate),
    (error) => error.ruleIndex === 1 && error.ruleField === 'aliases'
  )
  duplicate[1].aliases = ['seller-1']
  duplicate[1].en = 'MATERIAL 0'
  assert.throws(
    () => validateMaterialVocabulary(duplicate),
    (error) => error.ruleIndex === 1 && error.ruleField === 'en'
  )
  for (const [field, value] of [
    ['aliases', []],
    ['aliases', ['']],
    ['aliases', [{}]],
    ['es', ''],
    ['zh', 'x'.repeat(81)],
    ['id', 'invalid id'],
    ['parent', 'material-0'],
  ]) {
    const invalid = rule(0)
    invalid[field] = value
    assert.throws(
      () => validateMaterialVocabulary([invalid]),
      /Material rule 1:/
    )
  }
  assert.throws(() => validateMaterialVocabulary(Array(501).fill({})), /500/)
  assert.throws(() => validateMaterialVocabulary({}), /list/)
  assert.deepEqual(validateMaterialVocabulary([]), [])
})

test('changing recognition rules refreshes suggestions and keeps authored materials and empty values', () => {
  const snapshot = {
    accountId: 'local',
    orderId: '1001',
    items: Array.from({ length: 3 }, (_, index) => ({
      entryId: String(index + 1),
      title: '玻璃花瓶',
      skuProperties: [
        { label: '材质', value: '玻璃' },
        { label: '颜色', value: ['红色', '白色', '黑色'][index] },
      ],
    })),
  }
  const preparation = refreshPreparationMaterials(
      createPreparation(snapshot, '2026-10'),
      snapshot
    ),
    variants = preparation.groups[0].variants
  setVariantMaterial(variants[0], 'Handmade crystal')
  setVariantMaterial(variants[1], '')
  const rules = structuredClone(MATERIAL_VOCABULARY)
  rules.find((entry) => entry.id === 'glass').zh = '通透玻璃'
  configureMaterialVocabulary(rules)
  try {
    const refreshed = refreshPreparationMaterials(preparation, snapshot)
    assert.deepEqual(
      refreshed.groups[0].variants.map((variant) => variantMaterial(variant)),
      [
        { value: 'Handmade crystal', source: 'manual' },
        { value: '', source: 'manual' },
        { value: '通透玻璃', source: 'suggested' },
      ]
    )
    assert.equal(variantMaterial(variants[2]).value, '玻璃')
  } finally {
    configureMaterialVocabulary()
  }
})

test('material settings show a detached defaults draft bounded to eight rules', (t) => {
  const { value, rows, button, host } = setup(t)
  assert.equal(rows().length, 8)
  assert.notEqual(value.materialVocabulary, MATERIAL_VOCABULARY)
  assert.notEqual(
    value.materialVocabulary[0].aliases,
    MATERIAL_VOCABULARY[0].aliases
  )
  assert.equal(button('Previous material rules').disabled, true)
  button('Next material rules').click()
  assert.equal(rows().length, 8)
  assert.equal(
    host.querySelector('.vocabulary-navigation [role=status]').textContent,
    '9–16 of 84 rules'
  )
  assert.equal(
    host.querySelector('.vocabulary-scroll').getAttribute('role'),
    'region'
  )
})

test('material settings edits survive paging and translated search without saving', (t) => {
  const { value, rows, button, fill, search, editor } = setup(t)
  const first = rows()[0]
  fill(first.querySelector('[name=aliases]'), '晶透新材质|glass')
  fill(first.querySelector('[name=en]'), 'Clear glass')
  fill(first.querySelector('[name=es]'), 'Vidrio claro')
  button('Next material rules').click()
  button('Previous material rules').click()
  assert.equal(rows()[0].querySelector('[name=en]').value, 'Clear glass')
  fill(search, 'Vidrio claro')
  assert.equal(rows().length, 1)
  assert.equal(
    rows()[0].querySelector('[name=aliases]').value,
    '晶透新材质|glass'
  )
  assert.equal(value.materialVocabulary[0].es, 'Vidrio claro')
  assert.equal(editor.validate()[0].en, 'Clear glass')
})

test('adding clears search and removing returns to the prior material draft', (t) => {
  const rules = [rule(0)],
    { value, rows, button, fill, search, editor } = setup(t, rules)
  fill(search, 'no such material')
  assert.equal(rows()[0].textContent, 'No matching material rules.')
  button('Add material rule').click()
  assert.equal(search.value, '')
  for (const [field, text] of Object.entries({
    aliases: 'new seller',
    en: 'New',
    zh: '新材质',
    es: 'Nuevo',
  }))
    fill(rows()[0].querySelector(`[name=${field}]`), text)
  assert.equal(editor.validate().length, 2)
  assert.equal(rules.length, 1)
  fill(search, 'new seller')
  button('Remove material rule').click()
  assert.equal(rows()[0].textContent, 'No matching material rules.')
  assert.deepEqual(value.materialVocabulary, rules)
})

test('invalid material aliases on another page are revealed and stay editable', (t) => {
  const rules = Array.from({ length: 10 }, (_, index) => rule(index))
  rules[9].aliases = ['seller-0']
  const { editor, rows, host, fill, search } = setup(t, rules)
  fill(search, 'seller-3')
  assert.throws(() => editor.validate(), /appears in more than one rule/)
  assert.equal(search.value, '')
  assert.equal(
    host.querySelector('.vocabulary-navigation [role=status]').textContent,
    '9–10 of 10 rules'
  )
  assert.equal(
    rows()[1].querySelector('[name=aliases]').getAttribute('aria-invalid'),
    'true'
  )
  assert.match(
    host.querySelector('.appearance-validation').textContent,
    /seller-0/
  )
  fill(rows()[1].querySelector('[name=aliases]'), 'seller-9')
  assert.equal(
    rows()[1].querySelector('[name=aliases]').hasAttribute('aria-invalid'),
    false
  )
  assert.equal(editor.validate().length, 10)
})

test('material row validation waits until focus leaves and clears while correcting', (t) => {
  const { rows, fill, host, window, editor } = setup(t, [rule(0)])
  const row = rows()[0],
    input = row.querySelector('[name=es]'),
    errors = host.querySelector('.appearance-validation')
  fill(input, '')
  assert.equal(errors.hidden, true)
  row.dispatchEvent(new window.Event('focusout', { bubbles: true }))
  assert.equal(errors.hidden, false)
  assert.equal(input.getAttribute('aria-invalid'), 'true')
  assert.equal(input.getAttribute('aria-describedby'), errors.id)
  fill(input, 'Material corregido')
  assert.equal(errors.hidden, true)
  assert.equal(input.hasAttribute('aria-invalid'), false)
  assert.equal(editor.validate()[0].es, 'Material corregido')
})

test('material settings translate controls and errors without replacing unsaved inputs', (t) => {
  const { rows, fill, host, editor } = setup(t, [rule(0), rule(1)])
  const input = rows()[0].querySelector('[name=en]')
  fill(input, 'Unsaved display name')
  try {
    setLanguage('es', { persist: false })
    assert.equal(host.querySelector('h3').textContent, 'Materiales')
    assert.equal(rows()[0].querySelector('[name=en]'), input)
    assert.equal(input.value, 'Unsaved display name')
    fill(rows()[1].querySelector('[name=aliases]'), 'seller-0')
    assert.throws(() => editor.validate(), /appears in more than one rule/)
    assert.equal(
      host.querySelector('.appearance-validation').textContent,
      'Regla de material 2: El nombre de material «seller-0» aparece en más de una regla.'
    )
    setLanguage('zh', { persist: false })
    assert.equal(host.querySelector('h3').textContent, '材质')
    assert.equal(
      rows()[0].querySelector('[name=en]').value,
      'Unsaved display name'
    )
    assert.equal(
      host.querySelector('.appearance-validation').textContent,
      '材质规则 2：材质名称“seller-0”出现在多条规则中。'
    )
  } finally {
    setLanguage('en', { persist: false })
  }
})

test('material rule limit disables Add without increasing the draft', (t) => {
  const { value, button, rows } = setup(
    t,
    Array.from({ length: 500 }, (_, index) => rule(index))
  )
  assert.equal(button('Add material rule').disabled, true)
  button('Add material rule').click()
  assert.equal(value.materialVocabulary.length, 500)
  assert.equal(rows().length, 8)
})
