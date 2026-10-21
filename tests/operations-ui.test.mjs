import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import {
  mountOperationsStrip,
  openOperationsDialog,
  openOperationsMigration,
} from '../src/operations-ui.js'
import { OPERATIONS_MESSAGES } from '../src/ui-messages-operations.js'
import { setLanguage } from '../src/i18n.js'

const tick = () => new Promise((resolve) => setImmediate(resolve))

function fixture(t) {
  const { document, window } = parseHTML(
    '<html><body><main></main></body></html>'
  )
  class Dialog {}
  Dialog.prototype.closedBy = 'any'
  const create = document.createElement.bind(document)
  document.createElement = (tag, ...args) => {
    const element = create(tag, ...args)
    if (tag === 'dialog') {
      element.showModal = () => {
        element.open = true
      }
      element.close = () => {
        element.open = false
        element.dispatchEvent(new window.Event('close'))
      }
    }
    return element
  }
  const selectPrototype = Object.getPrototypeOf(create('select')),
    descriptor = Object.getOwnPropertyDescriptor(selectPrototype, 'value')
  Object.defineProperty(selectPrototype, 'value', {
    ...descriptor,
    set(value) {
      for (const option of this.querySelectorAll('option'))
        option.removeAttribute('selected')
      const selected = [...this.querySelectorAll('option')].find(
        (option) => option.value === value
      )
      selected?.setAttribute('selected', '')
    },
  })
  t.after(() => Object.defineProperty(selectPrototype, 'value', descriptor))
  for (const [key, value] of Object.entries({
    document,
    window,
    HTMLDialogElement: Dialog,
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
  t.after(() => setLanguage('en', { persist: false }))
  const record = {
    snapshot: {
      accountId: 'local',
      orderId: '1001',
      sellerName: 'Synthetic store',
      sellerMemberLogin: 'synthetic-store',
      items: [
        {
          entryId: '1',
          description: 'Synthetic cup',
          quantity: '10',
          price: '1.00',
        },
      ],
      totals: { payable: '10.00' },
    },
    tags: [],
    notes: 'Keep this note',
  }
  const change = (input, value, type = 'input') => {
    if (input.type === 'checkbox') input.checked = value
    else input.value = value
    input.dispatchEvent(new window.Event(type, { bubbles: true }))
  }
  const submit = (dialog) =>
    dialog
      .querySelector('form')
      .dispatchEvent(new window.Event('submit', { cancelable: true }))
  return {
    document,
    window,
    record,
    host: document.querySelector('main'),
    change,
    submit,
  }
}

test('empty workflow has one compact accessible affordance and stops row-selection clicks', (t) => {
  const { host, record } = fixture(t)
  let selections = 0,
    edits = 0
  host.addEventListener('click', () => selections++)
  mountOperationsStrip(host, {
    record,
    onEdit: ({ record: current }) => {
      assert.equal(current, record)
      edits++
    },
  })
  const button = host.querySelector('button')
  assert.equal(host.querySelectorAll('button').length, 1)
  assert.match(button.getAttribute('aria-label'), /Edit operations/)
  assert.equal(button.querySelector('svg').getAttribute('aria-hidden'), 'true')
  button.click()
  assert.equal(edits, 1)
  assert.equal(selections, 0)
  assert.equal(host.querySelector('table, details'), null)
})

test('feature editor supports custom per-piece costs, payment treatment, removal and translations', async (t) => {
  const { document, record, change, submit } = fixture(t),
    calls = []
  record.productWorkflow = {
    1: { features: { lighting: true, rotation: true } },
  }
  const done = openOperationsDialog({
    record,
    entryId: '1',
    repository: {
      setOperationsWorkflow: async (...args) => {
        calls.push(args)
        return record
      },
    },
  })
  await tick()
  const dialog = document.querySelector('dialog')
  assert.equal(dialog.querySelectorAll('.operations-feature-row').length, 2)
  dialog.querySelector('.operations-feature-add').click()
  const custom = [...dialog.querySelectorAll('.operations-feature-row')].at(-1)
  change(custom.querySelector('[data-feature-field="name"]'), 'Sound sensor')
  change(custom.querySelector('[data-feature-field="cost"]'), '1,25')
  assert.match(
    dialog.querySelector('.operations-feature-total').textContent,
    /1.25/
  )
  change(custom.querySelector('select'), 'included', 'change')
  assert.match(
    dialog.querySelector('.operations-feature-total').textContent,
    /0.00/
  )
  change(custom.querySelector('select'), 'extra', 'change')
  dialog.querySelector('.operations-feature-remove').click()
  setLanguage('es', { persist: false })
  assert.match(
    dialog.querySelector('.operations-feature-add').textContent,
    /Añadir característica/
  )
  assert.match(
    dialog.querySelector('.operations-feature-total').textContent,
    /1.25 por pieza/
  )
  submit(dialog)
  assert.equal(await done, record)
  const features = calls[0][1].product.value.features
  assert.equal(features.lighting, undefined)
  assert.equal(features.rotation, true)
  assert.deepEqual(
    Object.values(features).find((item) => item.name === 'Sound sensor'),
    {
      name: 'Sound sensor',
      unitCost: '1.25',
      included: false,
    }
  )
})

test('duplicate feature names keep the draft open without writing money or workflow data', async (t) => {
  const { document, record, change, submit } = fixture(t),
    calls = []
  record.productWorkflow = { 1: { features: { lighting: true } } }
  const done = openOperationsDialog({
    record,
    entryId: '1',
    repository: {
      setOperationsWorkflow: async (...args) => {
        calls.push(args)
        return record
      },
    },
  })
  await tick()
  const dialog = document.querySelector('dialog')
  dialog.querySelector('.operations-feature-add').click()
  const custom = [...dialog.querySelectorAll('.operations-feature-row')].at(-1)
  change(custom.querySelector('[data-feature-field="name"]'), 'LIGHTING')
  change(custom.querySelector('[data-feature-field="cost"]'), '2')
  submit(dialog)
  await tick()
  assert.equal(calls.length, 0)
  assert.match(dialog.querySelector('[role="alert"]').textContent, /unique/)
  assert.equal(custom.querySelector('[data-feature-field="cost"]').value, '2')
  dialog.close()
  assert.equal(await done, null)
})

test('workflow dialog edits structured fields, keeps a failed draft and retries atomically', async (t) => {
  const { document, record, change, submit } = fixture(t),
    calls = []
  let fail = true
  const repository = {
      getOperationsWorkflow: async () => structuredClone(record),
      setOperationsWorkflow: async (...args) => {
        calls.push(structuredClone(args))
        if (fail) throw new Error('Could not save workflow. Try again.')
        return { ...record, orderWorkflow: args[1].order }
      },
    },
    done = openOperationsDialog({ record, repository })
  await tick()
  const dialog = document.querySelector('dialog'),
    label = dialog.querySelector('[name="labelsSent"]')
  change(label, true, 'change')
  assert.equal(calls.length, 0)
  submit(dialog)
  await tick()
  assert.equal(calls.length, 1)
  assert.equal(dialog.isConnected, true)
  assert.equal(label.checked, true)
  assert.match(
    dialog.querySelector('[role="alert"]').textContent,
    /Could not save/
  )
  assert.equal(calls[0][1].order.instructions.labelsSent, true)
  assert.equal(calls[0][2].expectedOrderClock, '')
  assert.equal(calls[0][1].store, undefined)
  fail = false
  submit(dialog)
  const saved = await done
  assert.equal(saved.orderWorkflow.instructions.labelsSent, true)
  assert.equal(document.querySelector('dialog'), null)
  assert.equal(record.orderWorkflow, undefined)
})

test('product explicit no-delay override is reviewable without losing the original default wording', async (t) => {
  const { document, record, change, submit } = fixture(t)
  record.orderWorkflow = {
    delay: { status: 'delayed', originalPromise: 'En unas semanas' },
  }
  const calls = [],
    done = openOperationsDialog({
      record,
      entryId: '1',
      repository: {
        setOperationsWorkflow: async (...args) => {
          calls.push(args)
          return { ...record, productWorkflow: { 1: args[1].product.value } }
        },
      },
    })
  await tick()
  const dialog = document.querySelector('dialog'),
    product = dialog.querySelector('[data-scope="product"]')
  assert.equal(product.getAttribute('aria-pressed'), 'true')
  const active = [...dialog.querySelectorAll('.operations-panel')].find(
    (panel) => !panel.hidden
  )
  assert.match(active.textContent, /En unas semanas/)
  change(active.querySelector('[name="delay-state"]'), 'none', 'change')
  submit(dialog)
  const saved = await done
  assert.equal(saved.productWorkflow['1'].delay.status, 'none')
  assert.equal(saved.orderWorkflow.delay.originalPromise, 'En unas semanas')
  assert.equal(calls[0][1].order, undefined)
})

test('pending workflow saves lock cancellation and duplicate submit while preserving cancel afterward', async (t) => {
  const { document, window, record, change, submit } = fixture(t)
  let finish,
    calls = 0
  const done = openOperationsDialog({
    record,
    repository: {
      setOperationsWorkflow: async () => {
        calls++
        return new Promise((resolve) => {
          finish = resolve
        })
      },
    },
  })
  await tick()
  const dialog = document.querySelector('dialog')
  change(dialog.querySelector('[name="labelsSent"]'), true, 'change')
  submit(dialog)
  await tick()
  assert.equal(dialog.getAttribute('aria-busy'), 'true')
  const event = new window.Event('cancel', { cancelable: true })
  assert.equal(dialog.dispatchEvent(event), false)
  submit(dialog)
  dialog.querySelector('.operations-actions button').click()
  assert.equal(dialog.isConnected, true)
  assert.equal(calls, 1)
  finish({ ...record, orderWorkflow: { instructions: { labelsSent: true } } })
  assert.ok(await done)
})

test('language changes retain unsaved fields and translate operation labels in place', async (t) => {
  const { document, host, record, change } = fixture(t)
  mountOperationsStrip(host, { record })
  const done = openOperationsDialog({ record, repository: {} })
  await tick()
  const dialog = document.querySelector('dialog'),
    note = dialog.querySelector('[name="store-notes"]')
  change(note, 'Seller wording stays intact')
  setLanguage('es', { persist: false })
  assert.equal(note.value, 'Seller wording stays intact')
  assert.equal(
    dialog.querySelector('h2').textContent,
    OPERATIONS_MESSAGES['Operations workflow'].es
  )
  assert.equal(
    host.querySelector('button').getAttribute('aria-label'),
    OPERATIONS_MESSAGES['Edit operations workflow'].es
  )
  setLanguage('zh', { persist: false })
  assert.equal(note.value, 'Seller wording stays intact')
  assert.equal(
    dialog.querySelector('h2').textContent,
    OPERATIONS_MESSAGES['Operations workflow'].zh
  )
  dialog.querySelector('.operations-actions button').click()
  assert.equal(await done, null)
})

test('migration requires visual selection and confirmation and retains drafts after errors', async (t) => {
  const { document, record, change, submit } = fixture(t),
    calls = []
  record.tags = ['Retraso: dos semanas', 'Pago de referencia']
  const done = openOperationsMigration({
      records: [record],
      repository: {
        applyOperationsMigration: async (...args) => {
          calls.push(args)
          return { migrated: args[0].items.length }
        },
      },
    }),
    dialog = document.querySelector('dialog')
  assert.equal(dialog.querySelectorAll('.operations-migration-item').length, 1)
  assert.match(dialog.textContent, /Retraso: dos semanas/)
  assert.match(dialog.textContent, /no date is invented/)
  submit(dialog)
  await tick()
  assert.equal(calls.length, 0)
  assert.match(
    dialog.querySelector('[role="alert"]').textContent,
    /Choose at least one/
  )
  change(
    dialog.querySelector('.operations-migration-item input'),
    true,
    'change'
  )
  submit(dialog)
  await tick()
  assert.equal(calls.length, 0)
  change(dialog.querySelector('[name="confirm-conversions"]'), true, 'change')
  submit(dialog)
  assert.deepEqual(await done, { migrated: 1 })
  assert.equal(calls[0][1].confirmed, true)
  assert.equal(
    calls[0][0].items[0].patch.delay.originalPromise,
    'Retraso: dos semanas'
  )
  assert.equal(record.tags.length, 2)
})

test('all operations messages include both translations and retain interpolation parameters', () => {
  for (const [source, values] of Object.entries(OPERATIONS_MESSAGES))
    for (const language of ['es', 'zh']) {
      assert.equal(typeof values[language], 'string', `${source} ${language}`)
      assert.ok(values[language].length)
      assert.deepEqual(
        [...source.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort(),
        [...values[language].matchAll(/\{(\w+)\}/g)]
          .map((match) => match[1])
          .sort(),
        `${source} ${language}`
      )
    }
})
