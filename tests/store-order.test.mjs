import test from 'node:test'
import assert from 'node:assert/strict'
import { createStoreOrder, validateCartonDetails } from '../src/store-order.js'
import { validateBackup } from '../src/database.js'
import { createPackingBackup } from '../src/packing-backup.js'
import { allocatePreparation, createPreparation } from '../src/packing-model.js'
import { loadThumbnail } from '../src/images.js'

const now = '2026-10-21T12:00:00.000Z'
const photo = 'data:image/png;base64,AQID'
const secondPhoto = 'data:image/png;base64,BAUG'
const fixture = () => ({
  filename: '4321 (2).xlsx',
  sheetName: 'Order',
  purchaseDate: '2026-10-01',
  store: {
    key: 'market:4321',
    name: 'Synthetic store',
    number: '4321',
    kind: 'market',
  },
  total: '100.00',
  rows: [
    {
      row: 5,
      group: '1',
      description: 'Synthetic cup',
      boxes: 2,
      perbox: 5,
      quantity: 10,
      price: '10.00',
      amount: '100.00',
      photos: [photo, secondPhoto],
      kg: '1.5',
      cbm: '0.006',
      len: 10,
      wid: 20,
      ht: 30,
    },
  ],
})
const record = (snapshot, annotations = {}) => ({
  snapshot,
  revision: 1,
  changedAt: now,
  lastCheckedAt: now,
  notes: '',
  tags: [],
  changedEntryIds: [],
  removedEntryIds: [],
  ...annotations,
})
const backup = (built) => ({
  format: '1688-order-library',
  version: 3,
  exportedAt: now,
  orders: [record(built.snapshot, { unitsPerCarton: built.unitsPerCarton })],
  history: [],
  images: built.images,
  preparations: [],
  allocations: [],
  issuedCodes: [],
})

test('store import retains numeric local identity, source metadata and original photo gallery', async () => {
  const input = fixture(),
    original = structuredClone(input)
  const built = await createStoreOrder(input, { now, orderId: '98765' })
  assert.deepEqual(input, original)
  assert.equal(built.snapshot.sourceType, 'spreadsheet')
  assert.equal(built.snapshot.sourceUrl, '')
  assert.equal(built.snapshot.items[0].sourceGroup, '1')
  assert.equal(built.snapshot.items[0].carton.boxes, '2')
  assert.equal(built.snapshot.items[0].photos.length, 2)
  assert.equal(built.images.length, 2)
  assert.match(built.images[0].url, /^local-image:[a-f0-9]{64}$/)
  assert.deepEqual(built.unitsPerCarton, { 1: 5 })
  assert.deepEqual(
    validateBackup(backup(built)).orders[0].snapshot,
    built.snapshot
  )
})

test('combined variants split units while cartons and row money remain single source evidence', async () => {
  const input = fixture()
  input.rows[0].variants = [
    { variant: 'a', size: 's' },
    { variant: 'b', size: 's' },
  ]
  input.rows[0].variantAllocations = [
    { variant: 'a', size: 's', quantity: '3' },
    { variant: 'b', size: 's', quantity: '7' },
  ]
  const built = await createStoreOrder(input, { now, orderId: '98765' })
  assert.equal(built.snapshot.items.length, 2)
  assert.equal(built.snapshot.items[0].sourceVariant, 'A')
  assert.equal(built.snapshot.items[0].sourceSize, 'S')
  assert.equal(built.snapshot.items[1].carton, undefined)
  assert.equal(built.snapshot.spreadsheet.rows[0].quantity, '10')
  assert.equal(built.snapshot.totals.goodsGross, '100.00')
  assert.equal(built.images.length, 2)
  assert.equal(validateBackup(backup(built)).orders[0].snapshot.items.length, 2)
})

test('invalid allocations, arithmetic, missing photos and unconfirmed dates never produce an order', async () => {
  for (const change of [
    (input) => {
      input.purchaseDate = '2026-02-30'
    },
    (input) => {
      input.purchaseDate = ''
    },
    (input) => {
      input.rows[0].photos = []
    },
    (input) => {
      input.rows[0].quantity = 11
    },
    (input) => {
      input.rows[0].amount = '99'
    },
    (input) => {
      input.total = '99'
    },
    (input) => {
      input.rows[0].variants = [{ variant: 'a' }, { variant: 'b' }]
    },
    (input) => {
      input.rows[0].variantAllocations = [{ variant: 'a', quantity: 9 }]
    },
  ]) {
    const input = fixture()
    change(input)
    await assert.rejects(createStoreOrder(input, { now, orderId: '98765' }))
  }
})

test('source carton dimensions require a complete trio and preserve reported CBM separately', async () => {
  assert.deepEqual(
    validateCartonDetails({ len: 70, wid: 50, ht: 30, cbm: 0.21, kg: '20.5' }),
    { len: '70', wid: '50', ht: '30', cbm: '0.21', kg: '20.5' }
  )
  assert.throws(
    () => validateCartonDetails({ len: 70, wid: 50 }),
    /length, width and height/
  )
  assert.throws(() => validateCartonDetails({ boxes: 2.5 }), /positive whole/)
  assert.throws(() => validateCartonDetails({ kg: -1 }), /nonnegative/)
})

test('marked source properties, supplied CBM and composition settings survive import and backup', async () => {
  const input = fixture()
  input.rows[0].sourceCbm = '0.009'
  input.rows[0].skuProperties = [
    { label: '尺寸', value: '10×20 cm', raw: 'SIZE: 10×20 cm' },
  ]
  input.rows[0].photoEdits = {
    0: { fit: 'contain', scale: 1, x: 0, y: 0, background: '#ffffff' },
  }
  const built = await createStoreOrder(input, { now, orderId: '98765' })
  const restored = validateBackup(backup(built)).orders[0].snapshot
  assert.equal(restored.spreadsheet.rows[0].sourceCbm, '0.009')
  assert.equal(restored.spreadsheet.total, '100.00')
  assert.deepEqual(restored.items[0].skuProperties, input.rows[0].skuProperties)
  assert.deepEqual(restored.items[0].photoEdits, input.rows[0].photoEdits)
})

test('local image references retrieve full originals without any network request', async (t) => {
  const built = await createStoreOrder(fixture(), { now, orderId: '98765' })
  t.mock.method(globalThis, 'fetch', () =>
    assert.fail('local photos must not use the network')
  )
  assert.equal(
    await loadThumbnail(built.images[0].url, {
      getImage: async () => built.images[0],
    }),
    photo
  )
  await assert.rejects(
    loadThumbnail(built.images[0].url, { getImage: async () => null }),
    /missing/
  )
})

test('full backup validates originals larger than the CDN thumbnail cache limit', async () => {
  const input = fixture()
  input.rows[0].photos = [`data:image/png;base64,${'AQID'.repeat(600000)}`]
  input.rows[0].thumbnail = photo
  const built = await createStoreOrder(input, { now, orderId: '98765' })
  assert.equal(
    validateBackup(backup(built)).images[0].dataUrl.length,
    input.rows[0].photos[0].length
  )
})

test('packing backup carries gallery originals and carton annotation clocks for selected products', async () => {
  const built = await createStoreOrder(fixture(), { now, orderId: '98765' })
  const input = backup(built)
  const allocated = allocatePreparation(
    createPreparation(built.snapshot, '2026-10'),
    [],
    [],
    { snapshot: built.snapshot }
  )
  input.preparations = [
    { ...allocated.preparation, revision: 1, updatedAt: now },
  ]
  input.allocations = allocated.allocations
  input.issuedCodes = allocated.issuedCodes
  input.orders[0].cartonDetails = { 1: { kg: '2.5' } }
  input.orders[0].cartonDetailsUpdatedAt = now
  const scoped = createPackingBackup(input, {
    months: ['2026-10'],
    orders: [{ orderId: '98765', entryIds: ['1'] }],
  })
  assert.equal(scoped.images.length, 2)
  assert.deepEqual(scoped.orders[0].cartonDetailsPartialClocks, { 1: now })
  assert.deepEqual(validateBackup(scoped).orders[0].cartonDetails, {
    1: { kg: '2.5' },
  })
})

test('backup rejects tampered source allocation, identity and cartons', async () => {
  const built = await createStoreOrder(fixture(), { now, orderId: '98765' })
  for (const change of [
    (input) => {
      input.orders[0].snapshot.items[0].sourceGroup = '2'
    },
    (input) => {
      input.orders[0].snapshot.items[0].carton.boxes = '3'
    },
    (input) => {
      input.orders[0].snapshot.sellerName = 'Different store'
    },
    (input) => {
      input.orders[0].snapshot.sourceUrl = 'https://trade.1688.com/'
    },
    (input) => {
      delete input.orders[0].snapshot.purchasedAt
    },
  ]) {
    const input = backup(built)
    change(input)
    assert.throws(() => validateBackup(input))
  }
})

test('full and scoped backups retain whole-order charges as monetary source dependencies', async () => {
  const built = await createStoreOrder(fixture(), { now, orderId: '98765' })
  const input = backup(built)
  input.orders[0].additionalCharges = [
    { id: 'unload', reason: 'Unload delivery', amount: '5.00' },
  ]
  input.orders[0].additionalChargesUpdatedAt = now
  const validated = validateBackup(input)
  assert.deepEqual(
    validated.orders[0].additionalCharges,
    input.orders[0].additionalCharges
  )
  const allocated = allocatePreparation(
    createPreparation(built.snapshot, '2026-10'),
    [],
    [],
    { snapshot: built.snapshot }
  )
  input.preparations = [
    { ...allocated.preparation, revision: 1, updatedAt: now },
  ]
  input.allocations = allocated.allocations
  input.issuedCodes = allocated.issuedCodes
  const scoped = createPackingBackup(input, {
    months: ['2026-10'],
    orders: [{ orderId: '98765', entryIds: ['1'] }],
  })
  assert.deepEqual(
    validateBackup(scoped).orders[0].additionalCharges,
    input.orders[0].additionalCharges
  )
  assert.equal(scoped.orders[0].snapshot.totals.payable, '100.00')
})
