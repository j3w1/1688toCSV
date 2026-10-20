import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { mountOrderCharges } from '../src/order-charges-ui.js'
import { ORDER_CHARGE_MESSAGES } from '../src/ui-messages-order-charges.js'

function fixture(t) {
  const { document, window } = parseHTML(
    '<html><body><main></main></body></html>'
  )
  for (const [key, value] of Object.entries({
    document,
    MutationObserver: window.MutationObserver,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() =>
      previous
        ? Object.defineProperty(globalThis, key, previous)
        : delete globalThis[key]
    )
  }
  const record = {
    snapshot: {
      totals: { payable: '100.00' },
      items: [
        {
          entryId: '1',
          title: 'Synthetic cup',
          thumbnail: 'data:image/png;base64,AQID',
          price: '10.00',
          quantity: '3',
          discount: '0.00',
        },
        {
          entryId: '2',
          title: 'Synthetic plate',
          thumbnail: 'data:image/png;base64,AQID',
          price: '10.00',
          quantity: '7',
          discount: '0.00',
        },
      ],
    },
  }
  return { document, window, record, host: document.querySelector('main') }
}

test('order-charge editor previews every affected product and exact order total before saving', (t) => {
  const { host, record } = fixture(t)
  record.additionalCharges = [
    { id: 'delivery', reason: 'Unload delivery', amount: '5.00' },
  ]
  const before = structuredClone(record)
  mountOrderCharges(host, {
    record,
    onSave: async () => assert.fail('initial render must not save'),
  })
  assert.equal(host.querySelector('details').open, true)
  assert.equal(host.querySelectorAll('.order-charge-product').length, 2)
  assert.match(
    host.querySelector('.order-charges-total').textContent,
    /¥100.00→¥105.00/
  )
  assert.match(
    host.querySelector('.order-charge-product').textContent,
    /¥10.00→¥10.50/
  )
  assert.equal(host.querySelectorAll('.order-charge-product img').length, 2)
  assert.deepEqual(record, before)
})

test('draft charges update the preview immediately and save only on explicit submission', async (t) => {
  const { host, record, window } = fixture(t)
  const saves = []
  const editor = mountOrderCharges(host, {
    record,
    onSave: async (charges) => saves.push(structuredClone(charges)),
  })
  host.querySelector('.order-charges-toolbar button').click()
  const reason = host.querySelector('input[type="text"]'),
    amount = host.querySelector('input[type="number"]')
  reason.value = 'Printed labels'
  amount.value = '10'
  amount.dispatchEvent(new window.Event('input', { bubbles: true }))
  assert.equal(saves.length, 0)
  assert.match(
    host.querySelector('.order-charges-total').textContent,
    /¥100.00→¥110.00/
  )
  assert.equal(editor.dirty(), true)
  await editor.flush()
  assert.equal(saves.length, 1)
  assert.equal(saves[0][0].reason, 'Printed labels')
  assert.equal(saves[0][0].amount, '10.00')
  assert.equal(editor.dirty(), false)
  assert.match(host.querySelector('[role="status"]').textContent, /Saved/)
})

test('removing charges is a reviewable draft and failed or invalid saves preserve source prices', async (t) => {
  const { host, record, window } = fixture(t)
  record.additionalCharges = [
    { id: 'unload', reason: 'Unload', amount: '5.00' },
  ]
  let saveCount = 0
  const editor = mountOrderCharges(host, {
    record,
    onSave: async () => {
      saveCount++
      throw new Error('Synthetic save failure')
    },
  })
  const amount = host.querySelector('input[type="number"]')
  amount.value = '-1'
  amount.dispatchEvent(new window.Event('input', { bubbles: true }))
  await assert.rejects(editor.flush(), /positive amount/)
  assert.equal(saveCount, 0)
  assert.equal(amount.getAttribute('aria-invalid'), 'true')
  amount.value = '8'
  await assert.rejects(editor.flush(), /Synthetic save failure/)
  assert.equal(editor.dirty(), true)
  host.querySelector('.order-charges-inputs .icon-button').click()
  assert.match(
    host.querySelector('.order-charges-total').textContent,
    /¥100.00→¥100.00/
  )
  assert.equal(record.snapshot.items[0].price, '10.00')
  assert.equal(record.additionalCharges[0].amount, '5.00')
})

test('additional-charge UI sentences include Spanish and Chinese translations', () => {
  for (const [source, translations] of Object.entries(ORDER_CHARGE_MESSAGES)) {
    assert.ok(translations.es?.trim(), `${source}: Spanish`)
    assert.ok(translations.zh?.trim(), `${source}: Chinese`)
  }
})
