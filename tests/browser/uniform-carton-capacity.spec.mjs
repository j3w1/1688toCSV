import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  createPreparation,
  allocatePreparation,
} from '../../src/packing-model.js'
import { validateCartonBatch } from '../../src/carton-batches.js'
import { repeatProductStoreIdentity } from '../../src/repeat-products.js'

async function backup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}

async function seed(
  extension,
  { quantity = 150, capacity, aggregateCount, unevenShared = false } = {}
) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const order = record.snapshot
  order.sellerName = 'Synthetic carton capacity supplier'
  order.sellerMemberLogin = 'synthetic-uniform-capacity'
  order.items = order.items.slice(0, unevenShared ? 2 : 1)
  for (const [index, item] of order.items.entries()) {
    item.title = '合成收纳盒'
    item.productNumber = 'SYNTHETIC-CAPACITY'
    item.skuProperties = [{ label: '颜色', value: index ? '蓝色' : '白色' }]
    item.description = `${item.title}\n颜色：${item.skuProperties[0].value}`
    item.quantity = String(unevenShared ? (index ? 5 : 63) : quantity)
    item.price = '1.00'
    item.sourceDiscount = item.allocatedDiscount = item.discount = '0.00'
  }
  const amount = order.items.reduce(
    (sum, item) => sum + Number(item.quantity),
    0
  )
  order.totals = {
    goodsGross: `${amount}.00`,
    shipping: '0.00',
    sourceDiscount: '0.00',
    orderAdjustment: '0.00',
    goodsNet: `${amount}.00`,
    payable: `${amount}.00`,
  }
  if (capacity !== undefined) {
    record.unitsPerCarton = { [order.items[0].entryId]: capacity }
    record.unitsPerCartonUpdatedAt = order.observedAt
  }
  const preparation = createPreparation(order, '2026-10')
  expect(preparation.groups).toHaveLength(1)
  const [group] = preparation.groups
  group.baseCode = 'CE26101001'
  group.spanishName = 'CAJA'
  group.category = '收纳盒'
  group.sizeMode = 'none'
  for (const [index, variant] of group.variants.entries())
    Object.assign(variant, {
      variantSuffix: unevenShared ? ['A', 'B'][index] : '',
      sizeSuffix: '',
      needsSizeMapping: false,
    })
  const allocation = allocatePreparation(
    { ...preparation, revision: 1 },
    [],
    [],
    { snapshot: order }
  )
  const mark = { orderId: order.orderId, groupId: group.id }
  const makeBatch = (fields) =>
    validateCartonBatch({
      id: 'synthetic-capacity-aggregate',
      accountId: order.accountId,
      storeId: repeatProductStoreIdentity(order),
      month: '2026-10',
      groups: [mark],
      mark,
      len: '40.125',
      wid: '30',
      ht: '25',
      weight: '6.75',
      weightBasis: 'carton',
      received: 11,
      loaded: 8,
      revision: 1,
      updatedAt: '2026-10-15T00:00:00.000Z',
      ...fields,
    })
  let batches = []
  if (aggregateCount !== undefined)
    batches = [
      makeBatch({
        count: aggregateCount,
        contents: [
          {
            orderId: order.orderId,
            entryId: order.items[0].entryId,
            quantity: String(quantity),
          },
        ],
      }),
    ]
  if (unevenShared)
    batches = [13, 12, 11, 9, 9, 9].map((pieces, index) =>
      makeBatch({
        id: `synthetic-capacity-exact-${index + 1}`,
        cartonNumber: String(index + 1),
        count: 1,
        received: 1,
        loaded: index < 2 ? 1 : 0,
        weight: ['16.75', '14.62', '10.40', '5.63', '5.18', '4.64'][index],
        contents: [
          {
            orderId: order.orderId,
            entryId: order.items[0].entryId,
            quantity: String(pieces),
          },
          ...(index === 5
            ? [
                {
                  orderId: order.orderId,
                  entryId: order.items[1].entryId,
                  quantity: '5',
                },
              ]
            : []),
        ],
      })
    )
  const restored = await extension.inspector.evaluate(
    ({ record, allocation, batches }) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 4,
          exportedAt: new Date().toISOString(),
          orders: [record],
          preparations: [allocation.preparation],
          allocations: allocation.allocations,
          issuedCodes: allocation.issuedCodes,
          cartonBatches: batches,
          history: [],
          images: [],
        },
      }),
    { record, allocation, batches }
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(sourceRows(page)).toHaveCount(order.items.length)
  // Opening preparation refreshes suggested materials and stores its initial
  // default layout. Complete that normal setup before testing that capacity
  // edits leave all preparation and physical-carton data unchanged.
  await page.locator('#view-packing').click()
  await expect(packingRows(page)).toHaveCount(order.items.length)
  await page.locator('#view-orders').click()
  return { page, record, before: await backup(extension) }
}

const sourceRows = (page) => page.locator('#sheet-body tr[data-selection-key]')
const packingRows = (page) => page.locator('#packing-view .variants tbody tr')
const capacityInput = (row) =>
  row.getByRole('spinbutton', { name: 'Pcs/box', exact: true })
// Reopening preparation saves its revision even when its authored data is
// unchanged. Compare every preparation field except that save clock.
const preparationData = (preparations) =>
  preparations.map(({ revision, updatedAt, ...data }) => data)

async function visibleSummary(row, text) {
  const summary = row.locator('.carton-capacity-summary')
  await expect(summary).toHaveText(text)
  await expect(summary).toBeVisible()
  // A screen-reader-only summary also passes toBeVisible; the calculation must
  // actually be readable beside the capacity rather than merely announced.
  await expect
    .poll(async () => (await summary.boundingBox())?.width ?? 0)
    .toBeGreaterThan(30)
  await expect
    .poll(async () => (await summary.boundingBox())?.height ?? 0)
    .toBeGreaterThan(10)
}

test('150 pieces at 10 per box immediately show 15 calculated cartons and retain the editable capacity across views and reload', async ({
  extension,
}, testInfo) => {
  const { page, record, before } = await seed(extension)
  const source = sourceRows(page).first()
  await expect(capacityInput(source)).toHaveValue('')
  await capacityInput(source).fill('10')
  await visibleSummary(source, '15 calculated cartons')
  await expect(source.locator('.carton-capacity-status')).toHaveText('Saved')
  await page.locator('#view-packing').click()
  const packed = packingRows(page).first()
  await expect(capacityInput(packed)).toHaveValue('10')
  await expect(capacityInput(packed)).toBeEditable()
  await visibleSummary(packed, '15 calculated cartons')
  await expect(page.locator('.packing-group-cartons-summary')).toContainText(
    '15 calculated cartons'
  )
  const groupId = await page
    .locator('.preparation-group')
    .getAttribute('data-group-id')
  await expect(
    page.locator(`#packing-view [data-group-id="${groupId}"]`)
  ).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('capacity-150-at-10.png') })
  await page.locator('[data-language="es"]').click()
  await visibleSummary(packed, '15 cajas calculadas')
  await expect(page.locator('.packing-group-cartons-summary')).toContainText(
    '15 cajas calculadas'
  )
  await page.locator('[data-language="en"]').click()
  await expect(page.locator('.packing-carton-chip')).toHaveCount(0)
  await page.locator('#view-orders').click()
  await expect(capacityInput(source)).toHaveValue('10')
  await page.reload()
  await expect(capacityInput(source)).toHaveValue('10')
  await visibleSummary(source, '15 calculated cartons')
  const saved = await backup(extension)
  expect(saved.orders[0].unitsPerCarton[record.snapshot.items[0].entryId]).toBe(
    10
  )
  expect(saved.orders[0].snapshot).toEqual(before.orders[0].snapshot)
  expect(saved.cartonBatches).toEqual([])
})

test('an existing aggregate carton record keeps the saved capacity editable without changing its physical totals or confirmations', async ({
  extension,
}) => {
  const { page, record, before } = await seed(extension, {
    capacity: 10,
    aggregateCount: 15,
  })
  const source = sourceRows(page).first()
  await expect(capacityInput(source)).toHaveValue('10')
  await visibleSummary(source, '15 calculated cartons')
  await page.locator('#view-packing').click()
  const packed = packingRows(page).first()
  await expect(capacityInput(packed)).toHaveValue('10')
  await visibleSummary(packed, '15 calculated cartons')
  await expect(page.locator('.packing-group-cartons-summary')).toContainText(
    '15 calculated cartons · 15 recorded cartons'
  )
  await capacityInput(packed).fill('15')
  await visibleSummary(packed, '10 calculated cartons')
  await expect(packed.locator('.carton-capacity-status')).toHaveText('Saved')
  await expect(page.locator('.packing-group-cartons-summary')).toContainText(
    '10 calculated cartons · 15 recorded cartons'
  )
  await expect(
    packed.locator('.carton-recorded-context').getByRole('button', {
      name: 'Recorded cartons',
      exact: true,
    })
  ).toContainText('15')
  await expect(page.locator('.packing-carton-chip')).toContainText(
    '15 Cartons · 150 Pieces'
  )
  await page.locator('#view-orders').click()
  await expect(capacityInput(source)).toHaveValue('15')
  await page.reload()
  await expect(capacityInput(source)).toHaveValue('15')
  const saved = await backup(extension)
  expect(saved.orders[0].unitsPerCarton[record.snapshot.items[0].entryId]).toBe(
    15
  )
  expect(saved.cartonBatches).toEqual(before.cartonBatches)
  expect(preparationData(saved.preparations)).toEqual(
    preparationData(before.preparations)
  )
  expect(saved.orders[0].snapshot).toEqual(before.orders[0].snapshot)
})

test('uneven and shared exact cartons preserve their context and contents while each product capacity remains editable', async ({
  extension,
}) => {
  const { page, record, before } = await seed(extension, {
    unevenShared: true,
  })
  await expect(
    sourceRows(page).getByRole('spinbutton', { name: 'Pcs/box' })
  ).toHaveCount(2)
  await page.locator('#view-packing').click()
  await expect(packingRows(page)).toHaveCount(2)
  const packed = packingRows(page).first()
  await expect(capacityInput(packed)).toBeEditable()
  await expect(
    packingRows(page).nth(1).getByRole('spinbutton', {
      name: 'Pcs/box',
      exact: true,
    })
  ).toBeEditable()
  await capacityInput(packed).fill('10')
  await visibleSummary(packed, '6 full cartons + 3 loose units')
  await expect(packed.locator('.carton-capacity-status')).toHaveText('Saved')
  await expect(packed.locator('.carton-recorded-context')).toContainText(
    'Shared'
  )
  await expect(page.locator('.packing-group-cartons-summary')).toContainText(
    '6 recorded cartons'
  )
  await expect(page.locator('.packing-carton-chip')).toHaveCount(6)
  await expect(page.locator('.packing-carton-chip').first()).toContainText(
    '#1 · 13 Pieces'
  )
  await expect(page.locator('.packing-carton-chip').last()).toContainText(
    '#6 · 14 Pieces'
  )
  await page.locator('#view-orders').click()
  await expect(capacityInput(sourceRows(page).first())).toHaveValue('10')
  await expect(
    sourceRows(page).first().locator('.carton-recorded-context')
  ).toContainText('Shared')
  const saved = await backup(extension)
  expect(saved.orders[0].unitsPerCarton[record.snapshot.items[0].entryId]).toBe(
    10
  )
  expect(saved.cartonBatches).toEqual(before.cartonBatches)
  expect(preparationData(saved.preparations)).toEqual(
    preparationData(before.preparations)
  )
})

test('a failed capacity autosave retains the 155/10 draft and its loose units until retry without inventing or editing cartons', async ({
  extension,
}) => {
  const { page, record, before } = await seed(extension, {
    quantity: 155,
    capacity: 5,
    aggregateCount: 15,
  })
  const source = sourceRows(page).first()
  await page.evaluate((entryId) => {
    window.failCapacityWrite = true
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (
        window.failCapacityWrite &&
        this.name === 'orders' &&
        args[0]?.unitsPerCarton?.[entryId] === 10
      )
        throw new DOMException(
          'Synthetic carton capacity storage unavailable',
          'QuotaExceededError'
        )
      return put.apply(this, args)
    }
  }, record.snapshot.items[0].entryId)
  await capacityInput(source).fill('10')
  await visibleSummary(source, '15 full cartons + 5 loose units')
  await expect(source.locator('.carton-capacity-status')).toContainText(
    'Synthetic carton capacity storage unavailable'
  )
  await expect(capacityInput(source)).toHaveValue('10')
  await expect(capacityInput(source)).toBeEditable()
  const failed = await backup(extension)
  expect(
    failed.orders[0].unitsPerCarton[record.snapshot.items[0].entryId]
  ).toBe(5)
  expect(failed.cartonBatches).toEqual(before.cartonBatches)
  await page.evaluate(() => {
    window.failCapacityWrite = false
  })
  await capacityInput(source).press('Enter')
  await expect(source.locator('.carton-capacity-status')).toHaveText('Saved')
  await page.locator('#view-packing').click()
  const packed = packingRows(page).first()
  await expect(capacityInput(packed)).toHaveValue('10')
  await visibleSummary(packed, '15 full cartons + 5 loose units')
  await expect(page.locator('.packing-group-cartons-summary')).toContainText(
    '15 recorded cartons'
  )
  await expect(page.locator('.packing-carton-chip')).toHaveCount(1)
  const saved = await backup(extension)
  expect(saved.orders[0].unitsPerCarton[record.snapshot.items[0].entryId]).toBe(
    10
  )
  expect(saved.cartonBatches).toEqual(before.cartonBatches)
  expect(saved.orders[0].snapshot).toEqual(before.orders[0].snapshot)
})
