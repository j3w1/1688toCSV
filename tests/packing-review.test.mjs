import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import {
  packingValueComparison,
  reviewPackingChanges,
} from '../src/packing-review.js'
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

test('variant descriptions stay raw context beside a barcode change rather than a replacement field', () => {
  const originalDocument = globalThis.document
  globalThis.document = parseHTML('<html><body></body></html>').document
  const description = '货号: SYN-CUP / 碗 · 6"'
  const values = [
    {
      label: message('Barcode'),
      context: description,
      before: message('Not prepared'),
      after: 'CE26101307AS',
      kind: 'code',
    },
    {
      label: message('Barcode'),
      context: 'Quantity',
      before: 'CE26101307BL',
      after: 'CE26101307BM',
      kind: 'code',
    },
  ]
  try {
    const comparison = packingValueComparison(values)
    const contexts = [...comparison.querySelectorAll('.packing-value-context')]
    assert.deepEqual(
      contexts.map((node) => node.textContent),
      [description, 'Quantity']
    )
    const rows = [...comparison.querySelectorAll('.packing-value-row')]
    assert.equal(
      rows[0].querySelector('th[scope="row"] > span').textContent,
      'Barcode'
    )
    assert.equal(
      rows[0].querySelector('.packing-value-before').textContent,
      'Not prepared'
    )
    assert.equal(
      rows[0].querySelector('.packing-value-after').textContent,
      'CE26101307AS'
    )
    assert.equal(
      comparison.querySelectorAll('[data-code-part="product"]').length,
      3
    )

    setLanguage('es', { persist: false })
    assert.equal(
      rows[0].querySelector('th[scope="row"] > span').textContent,
      'Código de barras'
    )
    assert.deepEqual(
      contexts.map((node) => node.textContent),
      [description, 'Quantity']
    )
    assert.equal(values[0].context, description)
    assert.equal(values[1].context, 'Quantity')
    assert.equal(values[0].after, 'CE26101307AS')
  } finally {
    setLanguage('en', { persist: false })
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
})

test('preparation overview includes all 52 cards and opens every complete change without a pager', async () => {
  const originalDocument = globalThis.document,
    originalDialog = globalThis.HTMLDialogElement
  const { document, HTMLElement } = parseHTML('<html><body></body></html>')
  globalThis.document = document
  globalThis.HTMLDialogElement = { prototype: { closedBy: 'any' } }
  const originalShowModal = HTMLElement.prototype.showModal
  const originalClose = HTMLElement.prototype.close
  HTMLElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLElement.prototype.close = function () {
    this.removeAttribute('open')
    this.onclose?.()
  }
  const changes = Array.from({ length: 52 }, (_, index) => {
    const after = `CE261013${String(index + 1).padStart(2, '0')}`
    return {
      name: `Synthetic cup ${index + 1} · 6"`,
      order: 'Synthetic store',
      orderId: '1234567890123456789',
      after,
      values: [
        {
          label: message('Product code'),
          before: message('Not prepared'),
          after,
          kind: 'code',
        },
        {
          label: message('Material'),
          before: '',
          after: '玻璃',
        },
      ],
      detail: message('1 product rows · 1 variants'),
    }
  })
  try {
    const result = reviewPackingChanges({
      title: message('Assign product codes?'),
      explanation: message('Review the product codes in this order.'),
      changes,
      overview: true,
    })
    const dialog = document.querySelector('.packing-review-overview')
    const cards = [...dialog.querySelectorAll('.packing-review-item')]
    assert.equal(cards.length, 52)
    assert.equal(
      dialog.querySelectorAll('.packing-review-overview-select').length,
      52
    )
    assert.equal(dialog.querySelectorAll('.packing-review-detail').length, 52)
    assert.equal(
      dialog.querySelectorAll('.packing-review-inline .packing-value-row')
        .length,
      104
    )
    assert.equal(
      dialog.querySelectorAll('.packing-review-detail .packing-value-row')
        .length,
      0
    )
    assert.equal(
      dialog.querySelectorAll('.packing-review-overview-summary').length,
      52
    )
    assert.equal(
      cards[0].querySelector('.packing-review-overview-summary').textContent,
      '+2Product code · Material'
    )
    assert.equal(dialog.querySelectorAll('.order-reference-pair').length, 0)
    assert.equal(
      dialog.querySelectorAll('.scroll-dialog-content > .dialog-actions')
        .length,
      0
    )
    assert.equal(
      dialog.querySelectorAll(
        '.packing-review-inline [data-code-part="product"], .packing-review-overview-select [data-code-part="product"]'
      ).length,
      104
    )

    for (const index of [0, 51]) {
      const select = cards[index].querySelector(
        '.packing-review-overview-select'
      )
      const detail = cards[index].querySelector('.packing-review-detail')
      assert.equal(detail.hidden, true)
      select.click()
      assert.equal(detail.hidden, false)
      assert.equal(select.getAttribute('aria-expanded'), 'true')
      assert.equal(
        detail.querySelector('strong').textContent,
        changes[index].name
      )
      assert.equal(
        detail.querySelector('.packing-value-after code').textContent,
        changes[index].after
      )
      assert.equal(detail.querySelectorAll('.packing-value-row').length, 2)
      detail.querySelector('.packing-review-detail-close').click()
      assert.equal(detail.hidden, true)
      assert.equal(select.getAttribute('aria-expanded'), 'false')
    }
    dialog.querySelector('[data-action="review-cancel"]').click()
    assert.equal(await result, false)
    assert.equal(document.querySelector('.packing-review-overview'), null)
    assert.equal(changes[51].name, 'Synthetic cup 52 · 6"')
    assert.equal(changes[51].values[1].after, '玻璃')
  } finally {
    if (originalShowModal === undefined) delete HTMLElement.prototype.showModal
    else HTMLElement.prototype.showModal = originalShowModal
    if (originalClose === undefined) delete HTMLElement.prototype.close
    else HTMLElement.prototype.close = originalClose
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
    if (originalDialog === undefined) delete globalThis.HTMLDialogElement
    else globalThis.HTMLDialogElement = originalDialog
  }
})

function reviewDocument() {
  const originalDocument = globalThis.document,
    originalDialog = globalThis.HTMLDialogElement
  const { document, HTMLElement } = parseHTML('<html><body></body></html>')
  globalThis.document = document
  globalThis.HTMLDialogElement = { prototype: { closedBy: 'any' } }
  const originalShowModal = HTMLElement.prototype.showModal,
    originalClose = HTMLElement.prototype.close
  HTMLElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLElement.prototype.close = function () {
    this.removeAttribute('open')
    this.onclose?.()
  }
  return {
    document,
    restore() {
      if (originalShowModal === undefined)
        delete HTMLElement.prototype.showModal
      else HTMLElement.prototype.showModal = originalShowModal
      if (originalClose === undefined) delete HTMLElement.prototype.close
      else HTMLElement.prototype.close = originalClose
      if (originalDocument === undefined) delete globalThis.document
      else globalThis.document = originalDocument
      if (originalDialog === undefined) delete globalThis.HTMLDialogElement
      else globalThis.HTMLDialogElement = originalDialog
    },
  }
}

test('review decision controls mount once before opening, gate the real Apply action and clean up on apply or cancel', async () => {
  const fixture = reviewDocument()
  try {
    for (const accepted of [true, false]) {
      let mounts = 0,
        cleanups = 0,
        control
      const pending = reviewPackingChanges({
        title: 'Review product grouping',
        explanation: 'Keep the recorded physical mark or confirm a relabel.',
        changes: [
          {
            name: 'Synthetic goods',
            before: 'CE26101002',
            after: 'CE26101001',
          },
        ],
        mountControls({ host, apply, modal }) {
          mounts++
          assert.equal(modal.hasAttribute('open'), false)
          assert.equal(apply.dataset.action, 'review-proceed')
          assert.equal(
            host.previousElementSibling.className,
            'packing-review-list'
          )
          control = fixture.document.createElement('input')
          control.type = 'checkbox'
          control.setAttribute('aria-label', 'Physical relabel confirmed')
          host.append(control)
          apply.disabled = true
          control.onchange = () => {
            apply.disabled = !control.checked
          }
          return () => {
            cleanups++
          }
        },
      })
      const modal = fixture.document.querySelector('.packing-change-dialog')
      const apply = modal.querySelector('[data-action="review-proceed"]')
      assert.equal(modal.hasAttribute('open'), true)
      apply.onclick()
      assert.equal(modal.hasAttribute('open'), true)
      assert.equal(cleanups, 0)
      setLanguage('es', { persist: false })
      assert.equal(mounts, 1)
      assert.equal(
        modal.querySelector('.packing-review-controls input'),
        control
      )
      if (accepted) {
        control.checked = true
        control.onchange()
        apply.click()
      } else modal.querySelector('[data-action="review-cancel"]').click()
      assert.equal(await pending, accepted)
      assert.equal(cleanups, 1)
      assert.equal(
        fixture.document.querySelector('.packing-change-dialog'),
        null
      )
      modal.close()
      assert.equal(cleanups, 1)
      setLanguage('en', { persist: false })
    }
  } finally {
    setLanguage('en', { persist: false })
    fixture.restore()
  }
})

test('review control mount failure removes the unfinished dialog and rejects without approval', async () => {
  const fixture = reviewDocument()
  try {
    await assert.rejects(
      reviewPackingChanges({
        title: 'Review product grouping',
        explanation: 'Synthetic failure',
        changes: [],
        mountControls() {
          throw new Error('Synthetic controls failed to mount')
        },
      }),
      /Synthetic controls failed to mount/
    )
    assert.equal(fixture.document.querySelector('.packing-change-dialog'), null)
  } finally {
    fixture.restore()
  }
})

test('updating a physical mark comparison preserves the mounted choice input and focused value', async () => {
  const fixture = reviewDocument()
  try {
    let setChanges, input, focused
    Object.defineProperty(fixture.document, 'activeElement', {
      configurable: true,
      get: () => focused,
    })
    const result = reviewPackingChanges({
      title: 'Review product grouping',
      explanation: 'Synthetic relabel review',
      changes: [
        { name: 'Physical mark', before: 'CE26101002', after: 'CE26101002' },
      ],
      mountControls(context) {
        setChanges = context.setChanges
        input = fixture.document.createElement('input')
        input.value = 'Keep the confirmed reason'
        input.focus = () => {
          focused = input
        }
        context.host.append(input)
      },
    })
    const modal = fixture.document.querySelector('.packing-change-dialog')
    input.focus()
    setChanges([
      { name: 'Physical mark', before: 'CE26101002', after: 'CE26101001' },
    ])
    assert.equal(
      modal.querySelector('.packing-value-before code').textContent,
      'CE26101002'
    )
    assert.equal(
      modal.querySelector('.packing-value-after code').textContent,
      'CE26101001'
    )
    assert.equal(modal.querySelector('.packing-review-controls input'), input)
    assert.equal(input.isConnected, true)
    assert.equal(input.value, 'Keep the confirmed reason')
    assert.equal(fixture.document.activeElement, input)
    modal.querySelector('[data-action="review-cancel"]').click()
    assert.equal(await result, false)
    assert.equal(setChanges([]), false)
  } finally {
    fixture.restore()
  }
})

test('one group exposes every proposed full variant code and helper inline in all three languages without changing its source', async () => {
  const fixture = reviewDocument()
  const source = '合成玻璃杯 · 原始供应商描述'
  const change = {
    name: 'Vaso',
    sourceDescription: source,
    order: 'Synthetic review store',
    after: 'CE26101301',
    values: [
      {
        label: message('Product code'),
        before: message('Not prepared'),
        after: 'CE26101301',
        kind: 'code',
      },
      ...['AS', 'BM', 'CL'].map((suffix, index) => ({
        label: message('Barcode'),
        context: `原始款式 ${index + 1}`,
        before: message('Not prepared'),
        after: `CE26101301${suffix}`,
        kind: 'code',
      })),
      { label: message('Material'), before: '', after: '玻璃' },
      { label: message('Spanish short name'), before: '', after: 'Vaso' },
      { label: message('Chinese category'), before: '', after: '玻璃杯' },
    ],
  }
  const before = JSON.stringify(change)
  try {
    for (const language of ['en', 'es', 'zh']) {
      setLanguage(language, { persist: false })
      const result = reviewPackingChanges({
        title: message('Assign product codes?'),
        explanation: message('Review the product codes in this order.'),
        changes: [change],
        overview: true,
        alternate: { label: message('Assign only'), value: 'assign-only' },
      })
      const dialog = fixture.document.querySelector('.packing-review-overview'),
        inline = dialog.querySelector('.packing-review-inline')
      assert.equal(dialog.dataset.reviewLayout, 'expanded')
      assert.equal(
        dialog.querySelector('.packing-review-overview-name').textContent,
        'Vaso'
      )
      assert.equal(inline.querySelectorAll('.packing-value-row').length, 7)
      assert.equal(
        inline.querySelector('.packing-review-source').textContent,
        source
      )
      assert.deepEqual(
        [...inline.querySelectorAll('.packing-value-after code')].map(
          (code) => code.textContent
        ),
        ['CE26101301', 'CE26101301AS', 'CE26101301BM', 'CE26101301CL']
      )
      assert.equal(
        inline.querySelectorAll(
          '.packing-value-after [data-code-part="product"]'
        ).length,
        4
      )
      assert.deepEqual(
        [...inline.querySelectorAll('.packing-value-context')].map(
          (node) => node.textContent
        ),
        ['原始款式 1', '原始款式 2', '原始款式 3']
      )
      assert.ok(
        [...inline.querySelectorAll('.packing-value-before')].every(
          (node) => !node.textContent.includes(source)
        )
      )
      const action = language === 'es' ? 'assign-only' : 'cancel'
      dialog.querySelector(`[data-action="review-${action}"]`).click()
      assert.equal(
        await result,
        action === 'assign-only' ? 'assign-only' : false
      )
      assert.equal(JSON.stringify(change), before)
    }
  } finally {
    setLanguage('en', { persist: false })
    fixture.restore()
  }
})

test('a shared change review renders its complete scope continuously without page controls', async () => {
  const fixture = reviewDocument()
  try {
    const changes = Array.from({ length: 27 }, (_, index) => ({
      name: `Synthetic product ${index + 1}`,
      before: `CE261013${String(index + 1).padStart(2, '0')}`,
      after: `CE261014${String(index + 1).padStart(2, '0')}`,
    }))
    const result = reviewPackingChanges({
      title: message('Restore previous packing?'),
      explanation: message('Review the product codes in this order.'),
      changes,
    })
    const dialog = fixture.document.querySelector('.packing-change-dialog')
    assert.equal(dialog.querySelectorAll('.packing-review-item').length, 27)
    assert.equal(dialog.querySelectorAll('.packing-value-row').length, 27)
    assert.equal(
      dialog.querySelector('.packing-review-item:last-child strong')
        .textContent,
      'Synthetic product 27'
    )
    assert.equal(
      dialog.querySelectorAll('.scroll-dialog-content button').length,
      0
    )
    dialog.querySelector('[data-action="review-proceed"]').click()
    assert.equal(await result, true)
  } finally {
    fixture.restore()
  }
})
