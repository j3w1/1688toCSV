import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeStoreWechat,
  storeIdentity,
  mergeStoreWechat,
  validateBackup,
} from '../src/database.js'
import { selectPackingOrder } from '../src/packing-backup.js'

test('WeChat IDs trim surrounding whitespace without restricting seller text', () => {
  assert.equal(normalizeStoreWechat('  Seller_微信-123  '), 'Seller_微信-123')
  assert.equal(normalizeStoreWechat('  '), '')
  assert.equal(normalizeStoreWechat('x'.repeat(128)), 'x'.repeat(128))
  assert.throws(() => normalizeStoreWechat('x'.repeat(129)), /128 characters/)
  for (const value of [undefined, null, 1, true, [], {}])
    assert.throws(() => normalizeStoreWechat(value), /must be text/)
})

test('store identity namespaces source types and never groups names or unknown sellers', () => {
  assert.equal(
    storeIdentity({ sellerMemberLogin: '  merchant  ', sellerName: 'One' }),
    storeIdentity({ sellerMemberLogin: 'merchant', sellerName: 'Renamed' })
  )
  assert.notEqual(
    storeIdentity({ sellerMemberLogin: 'market:4321' }),
    storeIdentity({ sourceType: 'spreadsheet', store: { key: 'market:4321' } })
  )
  assert.notEqual(
    storeIdentity({ sourceType: 'spreadsheet', store: { key: 'market:4321' } }),
    storeIdentity({ sourceType: 'spreadsheet', store: { key: 'factory:4321' } })
  )
  for (const input of [
    {},
    { sellerName: 'Same display name' },
    { sellerMemberLogin: '   ', sellerName: 'Same display name' },
    { sourceType: 'spreadsheet', sellerMemberLogin: 'store:missing' },
  ])
    assert.equal(storeIdentity(input), null)
})

test('backup WeChat merging preserves newer edits and explicit clears independently of source data', () => {
  const earlier = {
    storeWechat: 'older',
    storeWechatUpdatedAt: '2026-10-01T12:00:00.000Z',
  }
  const later = {
    storeWechat: 'newer',
    storeWechatUpdatedAt: '2026-10-02T12:00:00.000Z',
  }
  assert.equal(mergeStoreWechat(later, earlier), later)
  assert.deepEqual(mergeStoreWechat(earlier, later, { notes: 'Keep notes' }), {
    notes: 'Keep notes',
    ...later,
  })
  const cleared = { storeWechatUpdatedAt: '2026-10-03T12:00:00.000Z' }
  assert.deepEqual(mergeStoreWechat(later, cleared), cleared)
  assert.equal(mergeStoreWechat(cleared, later), cleared)
  assert.equal(mergeStoreWechat(later, {}), later)
  assert.throws(
    () => mergeStoreWechat(later, { ...later, storeWechat: 'conflicting' }),
    /same timestamp/
  )
})

test('full and scoped order validation retain WeChat metadata and reject malformed contacts', () => {
  const observedAt = '2026-10-01T12:00:00.000Z'
  const record = {
    snapshot: {
      schemaVersion: 1,
      accountId: 'local',
      orderId: '1001',
      sourceUrl:
        'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1001',
      sellerName: 'Synthetic store',
      sellerMemberLogin: 'synthetic-store',
      observedAt,
      status: 'Completed',
      items: [
        {
          entryId: '1',
          thumbnail: 'https://cbu01.alicdn.com/synthetic.png',
          description: 'Synthetic cup',
          price: '10.00',
          quantity: '1',
          sourceDiscount: '0.00',
          allocatedDiscount: '0.00',
          discount: '0.00',
        },
      ],
      totals: {
        goodsGross: '10.00',
        shipping: '0.00',
        sourceDiscount: '0.00',
        orderAdjustment: '0.00',
        goodsNet: '10.00',
        payable: '10.00',
      },
    },
    revision: 1,
    changedAt: observedAt,
    lastCheckedAt: observedAt,
    notes: '',
    tags: [],
    changedEntryIds: [],
    removedEntryIds: [],
    storeWechat: '  Seller_123  ',
    storeWechatUpdatedAt: '2026-10-02T12:00:00.000Z',
  }
  const backup = {
    format: '1688-order-library',
    version: 3,
    exportedAt: '2026-10-03T12:00:00.000Z',
    orders: [record],
    history: [],
    images: [],
    preparations: [],
    allocations: [],
    issuedCodes: [],
  }
  const validated = validateBackup(backup).orders[0]
  assert.equal(validated.storeWechat, 'Seller_123')
  assert.equal(selectPackingOrder(validated, ['1']).storeWechat, 'Seller_123')
  assert.equal(
    selectPackingOrder(validated, ['1']).storeWechatUpdatedAt,
    record.storeWechatUpdatedAt
  )
  for (const value of [100, 'x'.repeat(129)]) {
    const bad = structuredClone(backup)
    bad.orders[0].storeWechat = value
    assert.throws(() => validateBackup(bad), /WeChat ID/)
  }
  const cleared = structuredClone(backup)
  cleared.orders[0].storeWechat = ''
  const empty = validateBackup(cleared).orders[0]
  assert.equal(Object.hasOwn(empty, 'storeWechat'), false)
  assert.equal(empty.storeWechatUpdatedAt, record.storeWechatUpdatedAt)
})
