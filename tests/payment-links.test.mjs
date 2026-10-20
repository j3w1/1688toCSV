import test from 'node:test'
import assert from 'node:assert/strict'
import {
  eligiblePaymentItems,
  mergePaymentLinks,
  paymentCostAdjustments,
  paymentLinkReviews,
  paymentLinksTotal,
  paymentSourceDependencies,
  paymentSourceEvidence,
  validatePaymentGraph,
  validatePaymentLinks,
} from '../src/payment-links.js'
import {
  preparationOrderFields,
  preparationTable,
} from '../src/preparation-clipboard.js'
import { PAYMENT_LINK_MESSAGES } from '../src/ui-messages-payment-links.js'

const clock = '2026-10-01T12:00:00.000Z'
const row = (entryId, price, quantity = '1', discount = '0.00') => ({
  entryId,
  price,
  quantity,
  discount,
})
function order(
  orderId,
  items = [row('1', '10.00')],
  payable = '10.00',
  rest = {}
) {
  return {
    snapshot: {
      accountId: 'local',
      orderId,
      observedAt: clock,
      items,
      totals: { payable, shipping: '0.00' },
    },
    ...rest,
  }
}
function link(source, rest = {}) {
  return {
    id: 'payment-1',
    sourceOrderId: source.snapshot.orderId,
    amount: source.snapshot.totals.payable,
    reason: 'Recorded label service',
    reviewedAt: clock,
    sourceEvidence: paymentSourceEvidence(source, rest.sourceEntryId),
    ...rest,
  }
}

test('whole payment cost includes source shipping exactly once while payable evidence stays unchanged', () => {
  const source = order('pay', [row('1', '10.00')], '12.34')
  source.snapshot.totals.shipping = '2.34'
  const goods = order(
    'goods',
    [row('1', '10.00', '2'), row('2', '10.00')],
    '30.00'
  )
  goods.paymentLinks = [link(source, { targetEntryIds: ['1', '2'] })]
  const original = structuredClone([goods, source])
  const costs = paymentCostAdjustments(goods, [goods, source])
  assert.equal(costs.get('1').linkedPaymentCharge, '8.23')
  assert.equal(costs.get('2').linkedPaymentCharge, '4.11')
  assert.equal(costs.get('1').effectiveAmount, '28.23')
  assert.equal(costs.get('1').additionalCharge, '0.00')
  assert.equal(paymentLinksTotal(goods), '12.34')
  assert.deepEqual([goods, source], original)
  assert.equal(
    paymentCostAdjustments(source, [goods, source]).get('1').effectiveAmount,
    '0.00'
  )
  const exported = preparationOrderFields({ entryId: '1' }, goods, {
    records: [goods, source],
    costs,
  })
  assert.equal(exported.orderPayable, '30.00')
  assert.equal(exported.orderShipping, '0.00')
  assert.equal(exported.linkedPaymentCharge, '8.23')
  assert.equal(exported.linkedPaymentReasons, 'Recorded label service')
})

test('same-order skipped fee transfers its existing net amount to eligible goods with no duplicated attribution', () => {
  const goods = order(
    'goods',
    [row('1', '1.00'), row('2', '2.00'), row('fee', '10.00', '1', '1.00')],
    '12.00',
    { packingExcludedEntryIds: ['fee'] }
  )
  goods.paymentLinks = [
    link(goods, {
      sourceEntryId: 'fee',
      amount: '9.00',
      targetEntryIds: ['1', '2'],
    }),
  ]
  const before = structuredClone(goods)
  const costs = paymentCostAdjustments(goods, [goods])
  assert.equal(costs.get('1').effectiveAmount, '4.00')
  assert.equal(costs.get('2').effectiveAmount, '8.00')
  assert.equal(costs.get('fee').effectiveAmount, '0.00')
  assert.equal(costs.get('fee').linkedPaymentRemoval, '9.00')
  assert.equal(costs.get('fee').linkedPaymentCharge, '0.00')
  assert.equal(costs.get('1').effectiveUnitPrice, '4.00')
  assert.deepEqual(goods, before)
})

test('cent allocation is stable for free goods, explicit subsets and decimal quantities', () => {
  const source = order('pay', [row('1', '0.01')], '0.01')
  const goods = order(
    'goods',
    [row('1', '0.00', '1.5'), row('2', '0.00', '1.5'), row('3', '0.00', '9')],
    '0.00'
  )
  goods.paymentLinks = [link(source, { targetEntryIds: ['1', '2'] })]
  const costs = paymentCostAdjustments(goods, [goods, source])
  assert.equal(costs.get('1').linkedPaymentCharge, '0.01')
  assert.equal(costs.get('2').linkedPaymentCharge, '0.00')
  assert.equal(costs.get('3').linkedPaymentCharge, '0.00')
})

test('manual external charges remain distinct from recorded-payment attribution', () => {
  const source = order('pay')
  const goods = order('goods', undefined, undefined, {
    additionalCharges: [
      { id: 'unload', reason: 'External unloading', amount: '2.00' },
    ],
  })
  goods.paymentLinks = [link(source, { targetEntryIds: ['1'] })]
  const costs = paymentCostAdjustments(goods, [goods, source])
  assert.equal(costs.get('1').additionalCharge, '2.00')
  assert.equal(costs.get('1').linkedPaymentCharge, '10.00')
  assert.equal(costs.get('1').effectiveAmount, '22.00')
  assert.equal(costs.get('1').effectiveUnitPrice, '22.00')
})

test('split whole payments remove the aggregate source share once before cent rounding', () => {
  const source = order('pay', [row('1', '0.01')], '0.02')
  source.snapshot.totals.shipping = '0.01'
  const first = order('first'),
    second = order('second')
  first.paymentLinks = [link(source, { amount: '0.01', targetEntryIds: ['1'] })]
  second.paymentLinks = [
    link(source, { id: 'payment-2', amount: '0.01', targetEntryIds: ['1'] }),
  ]
  const costs = paymentCostAdjustments(source, [source, first, second])
  assert.equal(costs.get('1').effectiveAmount, '0.00')
  assert.equal(costs.get('1').linkedPaymentRemoval, '0.01')
})

test('source evidence changes flag review and preserve the explicitly reviewed amount', () => {
  const source = order('pay'),
    goods = order('goods')
  goods.paymentLinks = [link(source, { targetEntryIds: ['1'] })]
  source.snapshot.totals.payable = '12.00'
  const reviews = validatePaymentGraph([goods, source]).reviews
  assert.equal(reviews.length, 1)
  assert.equal(
    paymentLinkReviews(goods, [goods, source])[0].current.amount,
    '12.00'
  )
  const cost = paymentCostAdjustments(goods, [goods, source]).get('1')
  assert.equal(cost.linkedPaymentCharge, '10.00')
  assert.equal(cost.needsReview, true)
  assert.equal(goods.paymentLinks[0].amount, '10.00')
})

test('a stale fee keeps its reviewed attribution and formats a negative source unit cost as a valid signed decimal', () => {
  const source = order('pay', [row('fee', '10.00')]),
    goods = order('goods')
  goods.paymentLinks = [
    link(source, { sourceEntryId: 'fee', targetEntryIds: ['1'] }),
  ]
  source.snapshot.items[0].price = '3.29'
  source.snapshot.totals.payable = '3.29'
  const records = [source, goods]
  const cost = paymentCostAdjustments(source, records).get('fee')
  const receivingCost = paymentCostAdjustments(goods, records).get('1')
  assert.equal(goods.paymentLinks[0].amount, '10.00')
  assert.equal(receivingCost.linkedPaymentCharge, '10.00')
  assert.equal(cost.linkedPaymentRemoval, '10.00')
  assert.equal(cost.effectiveAmount, '-6.71')
  assert.equal(cost.effectiveUnitPrice, '-6.71')
  assert.match(cost.effectiveUnitPrice, /^-?\d+\.\d+$/)
  assert.equal(cost.needsReview, true)
  assert.equal(receivingCost.needsReview, true)
})

test('shape validation rejects fractional cents, duplicate sources, missing evidence and empty reasons', () => {
  const source = order('pay'),
    valid = link(source)
  for (const invalid of [
    [{ ...valid, amount: '0' }],
    [{ ...valid, amount: '1.001' }],
    [{ ...valid, sourceEvidence: undefined }],
    [{ ...valid, reason: '' }],
    [{ ...valid, targetEntryIds: [] }],
    [{ ...valid, targetEntryIds: ['1', '1'] }],
    [{ ...valid, packingExclusions: null }],
    [valid, { ...valid, id: 'other' }],
    [valid, { ...valid, sourceOrderId: 'other' }],
  ])
    assert.throws(() => validatePaymentLinks(invalid))
  const parsed = validatePaymentLinks([
    { ...valid, amount: '1', reason: ' Why ' },
  ])[0]
  assert.equal(parsed.amount, '1.00')
  assert.equal(parsed.reason, 'Why')
})

test('graph rejects missing/cross-account references, whole self-links and ineligible receiving products', () => {
  const source = order('pay'),
    goods = order('goods')
  goods.paymentLinks = [link(source, { targetEntryIds: ['1'] })]
  assert.throws(() => validatePaymentGraph([goods]), /not found/)
  assert.throws(
    () =>
      validatePaymentGraph([
        goods,
        { ...source, snapshot: { ...source.snapshot, accountId: 'other' } },
      ]),
    /account/
  )
  assert.throws(
    () => validatePaymentGraph([{ ...goods, paymentLinks: [link(goods)] }]),
    /itself/
  )
  assert.throws(
    () =>
      validatePaymentGraph([
        { ...goods, packingExcludedEntryIds: ['1'] },
        source,
      ]),
    /eligible/
  )
  assert.throws(
    () =>
      validatePaymentGraph([
        {
          ...goods,
          snapshot: { ...goods.snapshot, items: [row('1', '0', '0')] },
        },
        source,
      ]),
    /eligible/
  )
})

test('graph prevents oversubscription across targets and mixing whole and row sources', () => {
  const source = order('pay'),
    goods = order('goods'),
    other = order('other')
  goods.paymentLinks = [link(source, { targetEntryIds: ['1'], amount: '6.00' })]
  other.paymentLinks = [
    link(source, { id: 'payment-2', targetEntryIds: ['1'], amount: '5.00' }),
  ]
  assert.throws(() => validatePaymentGraph([goods, other, source]), /exceed/)
  other.paymentLinks = [
    link(source, {
      id: 'payment-2',
      sourceEntryId: '1',
      targetEntryIds: ['1'],
      amount: '4.00',
    }),
  ]
  assert.throws(
    () => validatePaymentGraph([goods, other, source]),
    /whole payment or/
  )
  other.paymentLinks[0] = link(source, {
    id: 'payment-2',
    targetEntryIds: ['1'],
    amount: '4.00',
  })
  assert.deepEqual(validatePaymentGraph([goods, other, source]).reviews, [])
})

test('different fee sources still cannot create cyclic order references', () => {
  const first = order('first', [row('1', '10.00'), row('fee', '1.00')], '11.00')
  const second = order(
    'second',
    [row('1', '10.00'), row('fee', '1.00')],
    '11.00'
  )
  first.paymentLinks = [
    link(second, {
      sourceEntryId: 'fee',
      amount: '1.00',
      targetEntryIds: ['1'],
    }),
  ]
  second.paymentLinks = [
    link(first, {
      id: 'payment-2',
      sourceEntryId: 'fee',
      amount: '1.00',
      targetEntryIds: ['1'],
    }),
  ]
  assert.throws(() => validatePaymentGraph([first, second]), /cycle/)
})

test('source fee rows stay ineligible independently of a later skipped annotation change', () => {
  const goods = order('goods', [row('1', '10.00'), row('fee', '1.00')], '11.00')
  goods.paymentLinks = [
    link(goods, {
      sourceEntryId: 'fee',
      amount: '1.00',
      targetEntryIds: ['1'],
    }),
  ]
  assert.deepEqual(
    eligiblePaymentItems(goods, [goods]).map((item) => item.entryId),
    ['1']
  )
})

test('recursive dependencies include source evidence orders without adding selected goods', () => {
  const first = order('first', [row('1', '10.00'), row('fee', '1.00')], '11.00')
  const second = order(
    'second',
    [row('1', '10.00'), row('fee', '1.00')],
    '11.00'
  )
  const third = order('third')
  first.paymentLinks = [
    link(second, {
      sourceEntryId: 'fee',
      amount: '1.00',
      targetEntryIds: ['1'],
    }),
  ]
  second.paymentLinks = [
    link(third, { id: 'payment-2', targetEntryIds: ['1'] }),
  ]
  assert.deepEqual(
    paymentSourceDependencies([first, second, third], [first]).map(
      (record) => record.snapshot.orderId
    ),
    ['second', 'third']
  )
  assert.deepEqual(
    paymentSourceDependencies(
      [first, second, third],
      [{ accountId: 'local', orderId: 'first' }, second]
    ).map((record) => record.snapshot.orderId),
    ['third']
  )
  assert.throws(() => paymentSourceDependencies([first], [first]), /not found/)
})

test('newer link edits and clears survive restore; equal-clock conflicts are rejected', () => {
  const source = order('pay'),
    previous = { paymentLinks: [link(source)], paymentLinksUpdatedAt: clock }
  assert.equal(
    mergePaymentLinks(previous, {
      paymentLinks: [],
      paymentLinksUpdatedAt: '2026-09-30T12:00:00.000Z',
    }),
    previous
  )
  assert.throws(
    () =>
      mergePaymentLinks(previous, {
        paymentLinks: [],
        paymentLinksUpdatedAt: clock,
      }),
    /same timestamp/
  )
  assert.deepEqual(
    mergePaymentLinks(previous, {
      paymentLinks: [],
      paymentLinksUpdatedAt: '2026-10-02T12:00:00.000Z',
    }).paymentLinks,
    []
  )
})

test('exported product features are separate from authored tags and every new message has both translations', () => {
  const goods = order('goods', undefined, undefined, {
    productTags: { 1: ['Fragile'] },
    productWorkflow: { 1: { features: { lighting: true, rotation: true } } },
  })
  const values = preparationOrderFields({ entryId: '1' }, goods)
  assert.equal(values.productFeatures, 'Lighting · Rotation')
  assert.deepEqual(values.productTags, ['Fragile'])
  const output = preparationTable(
    [
      {
        ...values,
        linkedPaymentCharge: '0.01',
        linkedPaymentReasons: '=untrusted',
      },
    ],
    ['linkedPaymentCharge', 'linkedPaymentReasons', 'productFeatures']
  )
  assert.match(output.plain, /^0.01\t'=untrusted\tLighting · Rotation$/)
  for (const [key, translations] of Object.entries(PAYMENT_LINK_MESSAGES)) {
    assert.ok(translations.es?.trim(), `${key}: es`)
    assert.ok(translations.zh?.trim(), `${key}: zh`)
  }
})
