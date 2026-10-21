import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateOtherOrder,
  parseOtherOrderFile,
  otherOrderSnapshot,
  otherOrderDuplicateKey,
  orderSource,
  OTHER_ORDER_FILE_LIMIT,
} from '../src/other-orders.js'
import { validateBackup } from '../src/database.js'
import { createPreparation } from '../src/packing-model.js'
import {
  preparationGrid,
  preparationOrderFields,
} from '../src/preparation-clipboard.js'
import { packingSummary, printSummary } from '../src/export-summary.js'

const input = () => ({
  format: '1688-order-entry',
  version: 1,
  supplier: 'Synthetic supplier',
  reference: 'EXT-DEMO-1',
  date: '2026-10-15',
  products: [
    {
      description: 'Glass vase',
      specs: 'Clear',
      quantity: '4',
      unitPrice: '0.125',
    },
    {
      description: 'Storage basket',
      specs: 'Large',
      quantity: '2',
      unitPrice: '12.505',
    },
  ],
})
const snapshot = () =>
  otherOrderSnapshot(input(), {
    id: '990000000000000000000000000000000000001',
    now: '2026-10-20T00:00:00.000Z',
  })
const backup = (order = snapshot()) => ({
  format: '1688-order-library',
  version: 1,
  exportedAt: '2026-10-20T00:00:00.000Z',
  orders: [
    {
      snapshot: order,
      revision: 1,
      changedAt: order.observedAt,
      lastCheckedAt: order.observedAt,
      notes: '',
      tags: [],
      changedEntryIds: [],
      removedEntryIds: [],
    },
  ],
  history: [],
  images: [],
})

test('manual/file normalization is shared, exact and does not mutate the input', () => {
  const source = input(),
    original = structuredClone(source)
  assert.deepEqual(
    parseOtherOrderFile(JSON.stringify(source)),
    validateOtherOrder(source)
  )
  assert.deepEqual(source, original)
  const result = snapshot()
  assert.equal(result.source, 'other')
  assert.equal(result.reference, source.reference)
  assert.equal(result.sourceUrl, '')
  assert.equal(result.sellerMemberLogin, undefined)
  assert.equal(result.totals.goodsGross, '25.51')
  assert.equal(result.totals.payable, '25.51')
  assert.equal(result.purchasedAt, '2026-10-15T00:00:00+08:00')
  assert.equal(result.items[0].price, '0.125')
  assert.match(result.items[0].description, /Glass vase\nClear/)
  assert.equal(
    createPreparation(result, '2026-10').sellerId,
    'Synthetic supplier'
  )
})

test('complete input validation reports the bad field without creating a snapshot', () => {
  const cases = [
    ['supplier', (v) => (v.supplier = '')],
    ['reference', (v) => (v.reference = 'two\nlines')],
    ['date', (v) => (v.date = '2026-02-29')],
    ['date', (v) => (v.date = '2026-13-01')],
    ['products', (v) => (v.products = [])],
    ['products', (v) => (v.products = Array(201).fill(v.products[0]))],
    ['products.1.quantity', (v) => (v.products[1].quantity = '0')],
    ['products.1.quantity', (v) => (v.products[1].quantity = '2.5')],
    ['products.1.quantity', (v) => (v.products[1].quantity = 2)],
    ['products.1.unitPrice', (v) => (v.products[1].unitPrice = '1e3')],
    ['products.1.unitPrice', (v) => (v.products[1].unitPrice = '-1')],
    ['products.1.unitPrice', (v) => (v.products[1].unitPrice = '0.1234567')],
    [
      'products.1.photo',
      (v) => (v.products[1].photo = 'https://example.test/private.png'),
    ],
    [
      'products.1.photo',
      (v) => (v.products[1].photo = 'data:image/png;base64,YmFk'),
    ],
    ['order.extra', (v) => (v.extra = 'unexpected')],
  ]
  for (const [field, edit] of cases) {
    const value = input()
    edit(value)
    assert.throws(
      () => otherOrderSnapshot(value),
      (error) => error.field === field,
      field
    )
  }
  assert.throws(() => parseOtherOrderFile('{bad'), /valid JSON/)
  assert.throws(
    () => parseOtherOrderFile(' '.repeat(OTHER_ORDER_FILE_LIMIT + 1)),
    /8 MB/
  )
  const leap = input()
  leap.date = '2024-02-29'
  assert.equal(validateOtherOrder(leap).date, leap.date)
  const zero = input()
  zero.products[0].unitPrice = '0'
  assert.equal(validateOtherOrder(zero).products[0].unitPrice, '0.00')
})

test('other-source backup fields survive validation and cannot forge 1688 provenance', () => {
  const source = backup(),
    restored = validateBackup(source)
  assert.deepEqual(restored.orders[0].snapshot, source.orders[0].snapshot)
  for (const edit of [
    (v) =>
      (v.sourceUrl =
        'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=' +
        v.orderId),
    (v) => (v.sellerMemberLogin = 'pretend-login'),
    (v) => (v.reference = ''),
    (v) => (v.source = 'unknown'),
  ]) {
    const value = backup()
    edit(value.orders[0].snapshot)
    assert.throws(() => validateBackup(value))
  }
  const duplicate = backup()
  duplicate.orders.push(structuredClone(duplicate.orders[0]))
  duplicate.orders[1].snapshot.orderId =
    '990000000000000000000000000000000000002'
  assert.throws(
    () => validateBackup(duplicate),
    /duplicate other-source supplier references/
  )
})

test('source display reads evidence and never assigns an origin to ambiguous legacy data', () => {
  assert.equal(orderSource(snapshot()), 'other')
  const legacy = {
    orderId: '123',
    sourceUrl:
      'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=123',
  }
  assert.equal(orderSource(legacy), '1688')
  const original = structuredClone(legacy)
  assert.equal(orderSource({ ...legacy, sourceUrl: '' }), '')
  assert.equal(
    orderSource({ ...legacy, sourceUrl: legacy.sourceUrl + '&orderId=456' }),
    ''
  )
  assert.equal(orderSource({ ...legacy, orderId: '456' }), '')
  assert.deepEqual(legacy, original)
  assert.equal(
    otherOrderDuplicateKey(snapshot()),
    otherOrderDuplicateKey({
      ...snapshot(),
      sellerName: '  SYNTHETIC SUPPLIER ',
      reference: 'ｅｘｔ-DEMO-1',
    })
  )
})

test('exports retain internal identity while displaying the other-source reference', () => {
  const order = snapshot(),
    record = backup(order).orders[0]
  const row = {
    ...order.items[0],
    orderId: order.orderId,
    groupId: 'g',
    ...preparationOrderFields({ entryId: '1' }, record),
  }
  assert.equal(preparationGrid([row], ['orderId']).values[0][0], 'EXT-DEMO-1')
  assert.equal(row.orderId, order.orderId)
  assert.deepEqual(
    packingSummary({ rows: [row], file: 'synthetic.xlsx' }).orders,
    [
      {
        orderId: order.orderId,
        seller: order.sellerName,
        source: 'other',
        reference: 'EXT-DEMO-1',
      },
    ]
  )
  assert.deepEqual(
    printSummary({
      kind: 'labels',
      items: [
        {
          code: 'CE26100101',
          name: 'VASE',
          requested: 4,
          extra: 0,
          total: 4,
          orders: [
            {
              orderId: order.orderId,
              seller: order.sellerName,
              source: 'other',
              reference: 'EXT-DEMO-1',
            },
          ],
        },
      ],
      file: 'synthetic.pdf',
      pages: 1,
      perPage: 70,
    }).orders,
    [
      {
        orderId: order.orderId,
        seller: order.sellerName,
        source: 'other',
        reference: 'EXT-DEMO-1',
      },
    ]
  )
})
