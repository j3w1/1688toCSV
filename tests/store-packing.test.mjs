import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allocatePreparation,
  barcodeValue,
  createPreparation,
  validatePreparation,
} from '../src/packing-model.js'
import { createStoreOrder } from '../src/store-order.js'

function source(items) {
  return {
    accountId: 'local',
    orderId: '12345',
    sourceType: 'spreadsheet',
    sellerName: 'Synthetic market',
    sellerMemberLogin: 'store:market:1234',
    items: items.map((item, index) => ({
      entryId: String(index + 1),
      title: 'Synthetic cup',
      description: 'Synthetic cup',
      sourceGroup: '1',
      ...item,
    })),
  }
}

test('spreadsheet groups follow explicit markers independently of repeated or differing names', () => {
  const snapshot = source([
    { sourceGroup: '1', title: 'Same title' },
    { sourceGroup: '2', title: 'Same title' },
    { sourceGroup: '1', title: 'Different title' },
  ])
  const original = structuredClone(snapshot)
  const draft = createPreparation(snapshot, '2026-10', [])
  assert.equal(draft.groups.length, 2)
  assert.deepEqual(
    draft.groups[0].variants.flatMap((variant) => variant.entryIds),
    ['1', '3']
  )
  assert.deepEqual(
    draft.groups[1].variants.flatMap((variant) => variant.entryIds),
    ['2']
  )
  assert.equal(draft.groups[0].variants.length, 1)
  assert.deepEqual(snapshot, original)
  const allocated = allocatePreparation(draft, [], [])
  assert.deepEqual(
    allocated.preparation.groups.map((group) =>
      barcodeValue(group, group.variants[0])
    ),
    ['CE26100101', 'CE26100102']
  )
})

test('old source marker codes remain group identities and never become assigned codes', () => {
  const draft = createPreparation(
    source([{ sourceGroup: 'CE25102401' }, { sourceGroup: 'CE25102402' }]),
    '2026-10',
    []
  )
  assert.deepEqual(
    draft.groups.map((group) => group.baseCode),
    ['', '']
  )
  const allocated = allocatePreparation(draft, [], [])
  assert.deepEqual(
    allocated.preparation.groups.map((group) => group.baseCode),
    ['CE26100101', 'CE26100102']
  )
})

test('declared A/B variants and S/M/L sizes retain their explicit barcode endings', () => {
  const items = ['A', 'B'].flatMap((sourceVariant) =>
    ['S', 'M', 'L'].map((sourceSize) => ({
      sourceVariant,
      sourceSize,
      skuProperties: [
        { label: 'Variant', value: sourceVariant },
        { label: 'Size', value: sourceSize },
      ],
    }))
  )
  const draft = createPreparation(source(items), '2026-10', [])
  assert.equal(draft.groups.length, 1)
  assert.deepEqual(
    draft.groups[0].variants.map((variant) => [
      variant.variantSuffix,
      variant.sizeSuffix,
      variant.needsSizeMapping,
    ]),
    [
      ['A', 'S', false],
      ['A', 'M', false],
      ['A', 'L', false],
      ['B', 'S', false],
      ['B', 'M', false],
      ['B', 'L', false],
    ]
  )
  const allocated = allocatePreparation(draft, [], [])
  assert.deepEqual(
    allocated.preparation.groups[0].variants.map((variant) =>
      barcodeValue(allocated.preparation.groups[0], variant)
    ),
    [
      'CE26100101AS',
      'CE26100101AM',
      'CE26100101AL',
      'CE26100101BS',
      'CE26100101BM',
      'CE26100101BL',
    ]
  )
  assert.doesNotThrow(() => validatePreparation(allocated.preparation))
})

test('sized assortment import produces one authoritative group with six distinct codes', async () => {
  const built = await createStoreOrder(
    {
      filename: '1234.xlsx',
      sheetName: 'Products',
      purchaseDate: '2026-10-01',
      store: {
        key: 'market:1234',
        name: 'Synthetic market',
        number: '1234',
        kind: 'market',
      },
      total: '60.00',
      rows: ['S', 'M', 'L'].map((size, index) => ({
        row: index + 3,
        group: '1',
        title: `Cup ${size}`,
        description: `Cup size ${size}`,
        boxes: 1,
        perbox: 10,
        quantity: 10,
        price: '2.00',
        amount: '20.00',
        photos: ['data:image/png;base64,AQID'],
        variants: [
          { variant: 'A', size },
          { variant: 'B', size },
        ],
        variantAllocations: [
          { variant: 'A', size, quantity: 5 },
          { variant: 'B', size, quantity: 5 },
        ],
      })),
    },
    { now: '2026-10-21T12:00:00Z', orderId: '12345' }
  )
  assert.equal(built.snapshot.items.length, 6)
  assert.equal(built.snapshot.totals.payable, '60.00')
  assert.equal(built.snapshot.items.filter((item) => item.carton).length, 3)
  const allocated = allocatePreparation(
    createPreparation(built.snapshot, '2026-10', []),
    [],
    []
  )
  assert.equal(allocated.preparation.groups.length, 1)
  assert.deepEqual(
    allocated.preparation.groups[0].variants.map((variant) =>
      barcodeValue(allocated.preparation.groups[0], variant)
    ),
    [
      'CE26100101AS',
      'CE26100101BS',
      'CE26100101AM',
      'CE26100101BM',
      'CE26100101AL',
      'CE26100101BL',
    ]
  )
})
