import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { packingValueComparison } from '../src/packing-review.js'
import { message, setLanguage } from '../src/i18n.js'

test('packing comparisons identify changed codes and empty restored fields without hiding original values', () => {
  const originalDocument = globalThis.document
  globalThis.document = parseHTML('<html><body></body></html>').document
  try {
    setLanguage('es', { persist: false })
    const comparison = packingValueComparison([
      {
        label: message('Product code'),
        before: 'CE26103101',
        after: 'CE26103104',
        kind: 'code',
      },
      { label: message('Material'), before: '玻璃', after: '' },
      { label: message('Chinese category'), before: '蜡烛', after: '蜡烛' },
    ])
    const rows = [...comparison.querySelectorAll('.packing-value-row')]
    assert.deepEqual(
      rows.map((row) => row.dataset.changed),
      ['true', 'true', 'false']
    )
    assert.equal(
      rows[0].querySelector('.packing-value-before code').textContent,
      'CE26103101'
    )
    assert.equal(
      rows[0].querySelector('.packing-value-after code').textContent,
      'CE26103104'
    )
    assert.equal(
      rows[1].querySelector('.packing-value-after .packing-value-text')
        .textContent,
      'Ninguno'
    )
    assert.equal(
      rows[1].querySelector('.packing-value-before .packing-value-text')
        .textContent,
      '玻璃'
    )
    assert.equal(
      rows[2].querySelector('.packing-value-after .packing-value-text')
        .textContent,
      '蜡烛'
    )
    assert.equal(
      comparison.querySelector('.packing-value-before-heading').textContent,
      'Antes'
    )
    assert.equal(comparison.querySelectorAll('thead').length, 1)
    assert.equal(comparison.querySelectorAll('th[scope="row"]').length, 3)
    assert.equal(rows[0].querySelector('.packing-value-arrow').textContent, '→')
    assert.equal(rows[2].querySelector('.packing-value-arrow').textContent, '=')
    assert.equal(
      rows[0].querySelectorAll('[data-code-part="product"]').length,
      2
    )
    const changesOnly = packingValueComparison(
      [
        {
          label: 'Product code',
          before: 'CE26103101',
          after: 'CE26103102',
          kind: 'code',
        },
        { label: 'Material', before: '玻璃', after: '玻璃' },
      ],
      { hideUnchanged: true }
    )
    assert.equal(changesOnly.querySelectorAll('.packing-value-row').length, 1)
    assert.equal(
      changesOnly.querySelector('.packing-value-unchanged').textContent,
      '1 sin cambios'
    )
  } finally {
    setLanguage('en', { persist: false })
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
})
