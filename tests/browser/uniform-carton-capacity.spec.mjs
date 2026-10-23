import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  createPreparation,
  allocatePreparation,
} from '../../src/packing-model.js'
import { validateCartonBatch } from '../../src/carton-batches.js'
import { repeatProductStoreIdentity } from '../../src/repeat-products.js'
import {
  openOrderReconciliation,
  productGridRow,
  realOrderContext,
} from './smart-workspace-helpers.mjs'

async function backup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}

async function seed(
  extension,
  {
    quantity = 150,
    capacity,
    aggregateCount,
    unevenShared = false,
    unpackedCopy = false,
  } = {}
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
  // A second, unallocated purchase exercises nominal 155/10 arithmetic while
  // the original aggregate remains immutable physical evidence.
  const target = structuredClone(record)
  if (unpackedCopy) {
    target.snapshot.orderId = '900000000000000099'
    target.snapshot.sourceUrl = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${target.snapshot.orderId}`
  }
  const restored = await extension.inspector.evaluate(
    ({ records, allocation, batches }) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 4,
          exportedAt: new Date().toISOString(),
          orders: records,
          preparations: [allocation.preparation],
          allocations: allocation.allocations,
          issuedCodes: allocation.issuedCodes,
          cartonBatches: batches,
          history: [],
          images: [],
        },
      }),
    { records: unpackedCopy ? [record, target] : [record], allocation, batches }
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(sourceRows(page)).toHaveCount(
    order.items.length * (unpackedCopy ? 2 : 1)
  )
  const selected = unpackedCopy ? target : record,
    ref = { accountId: order.accountId, orderId: selected.snapshot.orderId },
    before = await backup(extension),
    grid = await openOrderReconciliation(page, ref)
  return { page, record: selected, ref, grid, before }
}

const sourceRows = (page) => page.locator('#sheet-body tr[data-selection-key]')
const capacityInput = (row) => row.locator('[data-grid-column="capacity"]')
const preparationData = (preparations) =>
  preparations.map(({ revision, updatedAt, ...data }) => data)
const firstRow = (grid, record) =>
  productGridRow(grid, {
    accountId: record.snapshot.accountId,
    orderId: record.snapshot.orderId,
    entryId: record.snapshot.items[0].entryId,
  })
const savedOrder = (data, record) =>
  data.orders.find(
    (entry) => entry.snapshot.orderId === record.snapshot.orderId
  )

async function savedCapacity(extension, record, value) {
  await expect
    .poll(
      async () =>
        savedOrder(await backup(extension), record).unitsPerCarton?.[
          record.snapshot.items[0].entryId
        ]
    )
    .toBe(value)
}
async function visibleSummary(row, count, loose) {
  const summary = row.locator('[data-column="proposedCount"]')
  await expect(summary).toHaveText(String(count))
  await expect(
    row.locator('[data-column="unassigned"] > button').first()
  ).toHaveText(String(loose))
  await expect(summary).toBeVisible()
  await expect
    .poll(async () => (await summary.boundingBox())?.width ?? 0)
    .toBeGreaterThan(30)
  await expect
    .poll(async () => (await summary.boundingBox())?.height ?? 0)
    .toBeGreaterThan(10)
}
async function openProducts(page, ref) {
  const grid = await openOrderReconciliation(page, ref)
  await grid.locator('[data-action="reconciliation-products"]').click()
  return grid
}
async function physicalRows(page, ref) {
  const grid = await openOrderReconciliation(page, ref, 'cartons')
  return grid.locator('tbody tr[data-grid-key]')
}

test('150 pieces at 10 per box immediately show 15 calculated cartons and retain the editable capacity across views and reload', async ({
  extension,
}, testInfo) => {
  const { page, record, ref, grid, before } = await seed(extension)
  const source = firstRow(grid, record)
  await expect(capacityInput(source)).toHaveValue('')
  await capacityInput(source).fill('10')
  await capacityInput(source).press('Tab')
  await visibleSummary(source, 15, 0)
  await savedCapacity(extension, record, 10)
  await page.screenshot({ path: testInfo.outputPath('capacity-150-at-10.png') })
  for (const language of ['es', 'en']) {
    await page.locator(`[data-language="${language}"]`).click()
    await visibleSummary(source, 15, 0)
  }
  // Packing consumes confirmed physical cartons; capacity-only proposals stay
  // in Orders and never silently become physical inventory.
  await page.locator('#view-packing').click()
  await expect(
    page.locator('#packing-view [data-grid-column="capacity"]')
  ).toHaveCount(0)
  await page.locator('#view-orders').click()
  await openProducts(page, ref)
  await expect(capacityInput(source)).toHaveValue('10')
  await expect(capacityInput(source)).toBeEditable()
  await page.reload()
  await expect(capacityInput(source)).toHaveValue('10')
  await visibleSummary(source, 15, 0)
  const saved = await backup(extension)
  expect(
    savedOrder(saved, record).unitsPerCarton[record.snapshot.items[0].entryId]
  ).toBe(10)
  expect(savedOrder(saved, record).snapshot).toEqual(
    savedOrder(before, record).snapshot
  )
  expect(saved.cartonBatches).toEqual([])
})

test('an existing aggregate carton record keeps the saved capacity editable without changing its physical totals or confirmations', async ({
  extension,
}) => {
  const { page, record, ref, grid, before } = await seed(extension, {
    capacity: 10,
    aggregateCount: 15,
  })
  const source = firstRow(grid, record)
  await expect(capacityInput(source)).toHaveValue('10')
  await expect(capacityInput(source)).toBeEditable()
  // All 150 pieces already belong to the saved aggregate: nominal capacity
  // must not propose duplicate physical cartons or invent per-box contents.
  await visibleSummary(source, 0, 0)
  await expect(source.locator('[data-column="pattern"]')).toContainText(
    '150 pieces in 15 cartons; per-carton contents unknown'
  )
  await capacityInput(source).fill('15')
  await capacityInput(source).press('Tab')
  await savedCapacity(extension, record, 15)
  await visibleSummary(source, 0, 0)
  const cartons = await physicalRows(page, ref)
  await expect(cartons).toHaveCount(1)
  await expect(cartons.locator('[data-column="count"]')).toHaveText('15')
  await expect(cartons.locator('[data-column="contents"]')).toContainText(
    `${record.snapshot.items[0].entryId}: 150`
  )
  await openProducts(page, ref)
  await expect(capacityInput(source)).toHaveValue('15')
  await page.reload()
  await expect(capacityInput(source)).toHaveValue('15')
  const saved = await backup(extension)
  expect(
    savedOrder(saved, record).unitsPerCarton[record.snapshot.items[0].entryId]
  ).toBe(15)
  expect(saved.cartonBatches).toEqual(before.cartonBatches)
  expect(preparationData(saved.preparations)).toEqual(
    preparationData(before.preparations)
  )
  expect(savedOrder(saved, record).snapshot).toEqual(
    savedOrder(before, record).snapshot
  )
})

test('uneven and shared exact cartons preserve their context and contents while each product capacity remains editable', async ({
  extension,
}) => {
  const { page, record, ref, grid, before } = await seed(extension, {
    unevenShared: true,
  })
  const products = grid.locator('tbody tr[data-grid-key]')
  await expect(products).toHaveCount(2)
  for (const row of await products.all())
    await expect(capacityInput(row)).toBeEditable()
  const source = firstRow(grid, record)
  await capacityInput(source).fill('10')
  await capacityInput(source).press('Tab')
  await savedCapacity(extension, record, 10)
  await visibleSummary(source, 0, 0)
  await expect(source.locator('[data-column="pattern"]')).toContainText(
    '9 of this product · 14 total in shared 6'
  )
  const cartons = await physicalRows(page, ref)
  await expect(cartons).toHaveCount(6)
  await expect(cartons.first().locator('[data-column="label"]')).toHaveText('1')
  await expect(cartons.first().locator('[data-column="contents"]')).toHaveText(
    `${record.snapshot.items[0].entryId}: 13`
  )
  await expect(cartons.last().locator('[data-column="label"]')).toHaveText('6')
  await expect(cartons.last().locator('[data-column="contents"]')).toHaveText(
    `${record.snapshot.items[0].entryId}: 9 · ${record.snapshot.items[1].entryId}: 5`
  )
  await openProducts(page, ref)
  await expect(capacityInput(source)).toHaveValue('10')
  await expect(source.locator('[data-column="pattern"]')).toContainText(
    '14 total in shared 6'
  )
  const saved = await backup(extension)
  expect(
    savedOrder(saved, record).unitsPerCarton[record.snapshot.items[0].entryId]
  ).toBe(10)
  expect(saved.cartonBatches).toEqual(before.cartonBatches)
  expect(preparationData(saved.preparations)).toEqual(
    preparationData(before.preparations)
  )
  expect(saved.orders.map((record) => record.snapshot)).toEqual(
    before.orders.map((record) => record.snapshot)
  )
})

test('a failed capacity autosave retains the 155/10 draft and its loose units until retry without inventing or editing cartons', async ({
  extension,
}) => {
  const { page, record, ref, grid, before } = await seed(extension, {
    quantity: 155,
    capacity: 5,
    aggregateCount: 15,
    unpackedCopy: true,
  })
  const source = firstRow(grid, record)
  await page.evaluate(
    ({ orderId, entryId }) => {
      window.failCapacityWrite = true
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args) {
        if (
          window.failCapacityWrite &&
          this.name === 'orders' &&
          args[0]?.snapshot?.orderId === orderId &&
          args[0]?.unitsPerCarton?.[entryId] === 10
        )
          throw new DOMException(
            'Synthetic carton capacity storage unavailable',
            'QuotaExceededError'
          )
        return put.apply(this, args)
      }
    },
    { orderId: ref.orderId, entryId: record.snapshot.items[0].entryId }
  )
  await capacityInput(source).fill('10')
  await capacityInput(source).press('Tab')
  await expect(
    page
      .getByText('Synthetic carton capacity storage unavailable', {
        exact: true,
      })
      .first()
  ).toBeVisible()
  await visibleSummary(source, 15, 5)
  await expect(capacityInput(source)).toHaveValue('10')
  await expect(capacityInput(source)).toBeEditable()
  const failed = await backup(extension)
  expect(
    savedOrder(failed, record).unitsPerCarton[record.snapshot.items[0].entryId]
  ).toBe(5)
  expect(failed.cartonBatches).toEqual(before.cartonBatches)
  await page.evaluate(() => {
    window.failCapacityWrite = false
  })
  await capacityInput(source).focus()
  await capacityInput(source).press('Tab')
  await savedCapacity(extension, record, 10)
  await visibleSummary(source, 15, 5)
  // Raw invalid input remains visible and cannot overwrite the saved capacity.
  await capacityInput(source).fill('0')
  await capacityInput(source).press('Tab')
  await expect(capacityInput(source)).toHaveAttribute('aria-invalid', 'true')
  await savedCapacity(extension, record, 10)
  await capacityInput(source).fill('10')
  await capacityInput(source).press('Tab')
  // The saved value was already10 before the invalid edit: also wait for the
  // actual raw-cell acknowledgement before testing native reload recovery.
  await expect
    .poll(
      async () =>
        (await realOrderContext(extension, ref)).draft?.value?.rawCells?.[
          JSON.stringify([
            JSON.stringify([
              ref.accountId,
              ref.orderId,
              record.snapshot.items[0].entryId,
            ]),
            'capacity',
          ])
        ]
    )
    .toBeUndefined()
  await page.reload()
  await expect(capacityInput(source)).toHaveValue('10')
  await visibleSummary(source, 15, 5)
  const saved = await backup(extension)
  expect(
    savedOrder(saved, record).unitsPerCarton[record.snapshot.items[0].entryId]
  ).toBe(10)
  expect(saved.cartonBatches).toEqual(before.cartonBatches)
  expect(saved.cartonBatches).toHaveLength(1)
  expect(saved.orders.map((record) => record.snapshot)).toEqual(
    before.orders.map((record) => record.snapshot)
  )
  expect((await realOrderContext(extension, ref)).batches).toEqual([])
})
