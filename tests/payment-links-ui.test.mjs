import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { mountPaymentLinks } from '../src/payment-links-ui.js'
import { paymentSourceEvidence } from '../src/payment-links.js'

function fixture(t, { sameOrder = false } = {}) {
  const { document, window } = parseHTML(
    '<html><body><main></main></body></html>'
  )
  for (const [key, value] of Object.entries({
    document,
    MutationObserver: window.MutationObserver,
    HTMLDialogElement: window.HTMLElement,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() =>
      previous
        ? Object.defineProperty(globalThis, key, previous)
        : delete globalThis[key]
    )
  }
  const select = window.HTMLSelectElement.prototype
  const previousSelect = Object.getOwnPropertyDescriptor(select, 'value')
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() {
      return (
        [...this.options].find((option) => option.selected)?.value ??
        this.options[0]?.value ??
        ''
      )
    },
    set(value) {
      for (const option of this.options)
        option.selected = option.value === value
    },
  })
  t.after(() => Object.defineProperty(select, 'value', previousSelect))
  for (const [name, method] of Object.entries({
    showModal() {
      this.open = true
    },
    close() {
      this.open = false
      this.dispatchEvent(new window.Event('close'))
    },
  })) {
    const previous = Object.getOwnPropertyDescriptor(
      window.HTMLElement.prototype,
      name
    )
    Object.defineProperty(window.HTMLElement.prototype, name, {
      configurable: true,
      value: method,
    })
    t.after(() =>
      previous
        ? Object.defineProperty(window.HTMLElement.prototype, name, previous)
        : delete window.HTMLElement.prototype[name]
    )
  }
  const product = (entryId, title, price) => ({
    entryId,
    title,
    price,
    quantity: '1',
    discount: '0.00',
    thumbnail: 'data:image/png;base64,AQID',
  })
  const record = {
    snapshot: {
      accountId: 'local',
      orderId: 'goods',
      observedAt: '2026-10-01T12:00:00.000Z',
      totals: { payable: sameOrder ? '12.00' : '10.00', shipping: '0.00' },
      items: [
        product('1', 'Synthetic cup', '10.00'),
        ...(sameOrder ? [product('2', 'Synthetic labels', '2.00')] : []),
      ],
    },
  }
  const source = {
    snapshot: {
      accountId: 'local',
      orderId: 'source',
      sellerName: 'Synthetic payment',
      observedAt: '2026-10-01T12:00:00.000Z',
      totals: { payable: '12.34', shipping: '2.34' },
      items: [product('1', 'Recorded service', '10.00')],
    },
  }
  return {
    document,
    window,
    record,
    source,
    host: document.querySelector('main'),
  }
}

test('linked-payment editor stays compact until opened and defaults to full source payable with exact preview', async (t) => {
  const { document, window, host, record, source } = fixture(t)
  const saves = [],
    original = structuredClone([record, source])
  const editor = mountPaymentLinks(host, {
    record,
    records: [record, source],
    onSave: async (links, options) => saves.push({ links, options }),
  })
  assert.match(host.textContent, /Linked payments/)
  assert.equal(document.querySelector('dialog'), null)
  const dialog = editor.open()
  assert.equal(dialog.tagName, 'DIALOG')
  assert.equal(dialog.getAttribute('closedby'), 'any')
  assert.equal(editor.dirty(), false)
  dialog.querySelector('fieldset > button').click()
  const sourceSelect = dialog.querySelector('[name="payment-source-order"]')
  sourceSelect.value = 'source'
  sourceSelect.dispatchEvent(new window.Event('change'))
  const reason = dialog.querySelector('[name="payment-reason"]')
  reason.value = 'Recorded label service'
  reason.dispatchEvent(new window.Event('input'))
  assert.equal(dialog.querySelector('[name="payment-amount"]').value, '12.34')
  assert.match(
    dialog.querySelector('.payment-link-evidence').textContent,
    /source shipping ¥2.34/
  )
  assert.match(
    dialog.querySelector('.payment-links-preview').textContent,
    /¥10.00→¥22.34/
  )
  assert.equal(dialog.querySelectorAll('.payment-link-product img').length, 1)
  assert.equal(saves.length, 0)
  await assert.rejects(editor.flush(), /Confirm the payment review/)
  const confirmation = dialog.querySelector('.payment-links-confirmation input')
  confirmation.checked = true
  confirmation.dispatchEvent(new window.Event('change'))
  await editor.flush()
  assert.equal(saves.length, 1)
  assert.equal(saves[0].links[0].amount, '12.34')
  assert.deepEqual(saves[0].links[0].targetEntryIds, ['1'])
  assert.equal(
    saves[0].options.expectedSourceClocks.source.observedAt,
    source.snapshot.observedAt
  )
  assert.equal(saves[0].options.expectedSourceClocks.goods, undefined)
  assert.equal(document.querySelector('dialog'), null)
  assert.deepEqual([record, source], original)
})

test('same-order fee removal is a reviewable draft and never includes the fee among receiving goods', async (t) => {
  const { document, host, record, window } = fixture(t, { sameOrder: true })
  record.packingExcludedEntryIds = ['2']
  record.paymentLinks = [
    {
      id: 'fee',
      sourceOrderId: 'goods',
      sourceEntryId: '2',
      amount: '2.00',
      reason: 'Existing labels',
      reviewedAt: '2026-10-01T12:00:00.000Z',
      sourceEvidence: paymentSourceEvidence(record, '2'),
      targetEntryIds: ['1'],
    },
  ]
  let saved
  const editor = mountPaymentLinks(host, {
    record,
    records: [record],
    onSave: async (links) => {
      saved = links
    },
  })
  const dialog = editor.open()
  assert.equal(dialog.querySelector('[name="payment-source-row"]').value, '2')
  assert.equal(dialog.querySelectorAll('.payment-link-targets input').length, 1)
  assert.equal(editor.dirty(), false)
  dialog.querySelector('.payment-link-card-actions button:last-child').click()
  assert.equal(editor.dirty(), true)
  assert.match(
    dialog.querySelector('.payment-links-preview').textContent,
    /¥12.00→¥10.00/
  )
  assert.match(
    dialog.querySelector('.payment-links-preview').textContent,
    /¥0.00→¥2.00/
  )
  assert.equal(saved, undefined)
  const confirmation = dialog.querySelector('.payment-links-confirmation input')
  confirmation.checked = true
  confirmation.dispatchEvent(new window.Event('change'))
  await editor.flush()
  assert.deepEqual(saved, [])
  assert.equal(record.paymentLinks.length, 1)
  assert.equal(document.querySelector('dialog'), null)
})

test('failed reviewed saves retain the draft and invalid money never reaches storage', async (t) => {
  const { host, record, source, window } = fixture(t)
  let calls = 0
  const editor = mountPaymentLinks(host, {
    record,
    records: [record, source],
    onSave: async () => {
      calls++
      throw new Error('Synthetic write failure')
    },
  })
  const dialog = editor.open()
  dialog.querySelector('fieldset > button').click()
  const sourceSelect = dialog.querySelector('[name="payment-source-order"]')
  sourceSelect.value = 'source'
  sourceSelect.dispatchEvent(new window.Event('change'))
  const reason = dialog.querySelector('[name="payment-reason"]')
  reason.value = 'Recorded fee'
  const amount = dialog.querySelector('[name="payment-amount"]')
  amount.value = '1.001'
  dialog.querySelector('.payment-links-confirmation input').checked = true
  await assert.rejects(editor.flush(), /exact cents/)
  assert.equal(calls, 0)
  amount.value = '1.00'
  await assert.rejects(editor.flush(), /Synthetic write failure/)
  assert.equal(calls, 1)
  assert.equal(editor.dirty(), true)
  assert.equal(dialog.open, true)
  assert.equal(record.paymentLinks, undefined)
})
