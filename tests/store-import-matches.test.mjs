import test from 'node:test'
import assert from 'node:assert/strict'
import { createStoreOrder } from '../src/store-order.js'
import { findMatchingStoreImports } from '../src/store-import-matches.js'

const fixture = () => ({
  filename: '4321.xlsx',
  sheetName: 'Products',
  purchaseDate: '2026-10-20',
  store: {
    key: 'market:4321',
    name: 'Synthetic store',
    number: '4321',
    kind: 'market',
  },
  total: '60.00',
  rows: [
    {
      row: 2,
      group: '1',
      description: 'Synthetic cup',
      boxes: 2,
      perbox: 10,
      quantity: 20,
      price: '3.00',
      amount: '60.00',
      photos: ['data:image/png;base64,AQID'],
      variants: [],
    },
  ],
})

test('content warnings recognize older imports and renamed copies without treating a new date as new content', async () => {
  const input = fixture()
  const { snapshot } = await createStoreOrder(input, { orderId: '90001' })
  const record = { snapshot }
  const candidate = {
    ...input,
    filename: '4321 (2).xlsx',
    purchaseDate: '2026-11-01',
  }
  candidate.rows[0].price = '3'
  assert.deepEqual(await findMatchingStoreImports(candidate, [record]), [
    record,
  ])
  assert.equal(snapshot.spreadsheet.fingerprint, undefined)
  assert.equal(snapshot.spreadsheet.filename, '4321.xlsx')
})

test('different store, sheet, quantities, price, description, original photo or variant does not match', async () => {
  const { snapshot } = await createStoreOrder(fixture(), { orderId: '90001' })
  for (const change of [
    (input) => {
      input.store.key = 'market:9876'
    },
    (input) => {
      input.sheetName = 'Other'
    },
    (input) => {
      input.rows[0].quantity = 30
    },
    (input) => {
      input.rows[0].price = '4'
    },
    (input) => {
      input.rows[0].description = 'Different cup'
    },
    (input) => {
      input.rows[0].photos = ['data:image/png;base64,BAUG']
    },
    (input) => {
      input.rows[0].variants = [{ variant: 'A', size: 'S' }]
    },
  ]) {
    const input = fixture()
    change(input)
    assert.deepEqual(await findMatchingStoreImports(input, [{ snapshot }]), [])
  }
})

test('a combined-variant workbook matches independent source allocations and leaves them intact', async () => {
  const input = fixture()
  input.rows[0].variants = [
    { variant: 'A', size: 'S' },
    { variant: 'B', size: 'S' },
  ]
  input.rows[0].variantAllocations = [
    { variant: 'A', size: 'S', quantity: 7 },
    { variant: 'B', size: 'S', quantity: 13 },
  ]
  const { snapshot } = await createStoreOrder(input, { orderId: '90001' })
  const record = { snapshot }
  const before = structuredClone(record)
  delete input.rows[0].variantAllocations
  assert.deepEqual(await findMatchingStoreImports(input, [record]), [record])
  assert.deepEqual(record, before)
})
