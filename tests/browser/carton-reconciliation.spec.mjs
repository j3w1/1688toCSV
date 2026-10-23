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
  assignSelectedPurchaseCodes,
  editOrderProduct,
  closeOrderProduct,
  createContainerThroughUI,
  sealContainerThroughUI,
} from './smart-workspace-helpers.mjs'

async function backup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}

async function seed(extension, { twoGroups = false } = {}) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const order = record.snapshot
  order.sellerName = 'Synthetic carton reconciliation supplier'
  order.sellerMemberLogin = 'synthetic-carton-reconciliation'
  order.purchasedAt = '2026-10-12T10:15:00+08:00'
  for (const [index, item] of order.items.entries()) {
    const separate = twoGroups && index === 2
    item.title = separate ? '合成收纳盒' : '合成毛绒玩具'
    item.description = `${item.title}\n尺寸：${['S', 'M', 'L'][index]}`
    item.productNumber = separate ? 'SYNTHETIC-BOX' : 'SYNTHETIC-PLUSH'
    item.skuProperties = [{ label: '尺寸', value: ['S', 'M', 'L'][index] }]
    item.quantity = String([3, 30, 30][index])
    item.price = '1.00'
    item.sourceDiscount = item.allocatedDiscount = item.discount = '0.00'
  }
  Object.assign(order.totals, {
    goodsGross: '63.00',
    sourceDiscount: '0.00',
    goodsNet: '63.00',
    payable: '63.00',
  })
  const preparation = createPreparation(order, '2026-10')
  expect(preparation.groups).toHaveLength(twoGroups ? 2 : 1)
  for (const [index, group] of preparation.groups.entries()) {
    group.baseCode = index ? 'CE26101002' : 'CE26101001'
    group.spanishName = index ? 'CAJA' : 'PELUCHE'
    group.category = index ? '收纳盒' : '毛绒玩具'
    for (const variant of group.variants) {
      const sourceIndex = order.items.findIndex((item) =>
        variant.entryIds.includes(item.entryId)
      )
      variant.variantSuffix = ''
      variant.sizeSuffix = ['S', 'M', 'L'][sourceIndex]
      variant.needsSizeMapping = false
    }
  }
  const allocation = allocatePreparation(
    { ...preparation, revision: 1 },
    [],
    [],
    { snapshot: order }
  )
  const owner = allocation.preparation.groups.at(-1)
  const packedIds = new Set(
    owner.variants.flatMap((variant) => variant.entryIds)
  )
  const batch = validateCartonBatch({
    id: 'synthetic-reviewed-cartons',
    accountId: order.accountId,
    storeId: repeatProductStoreIdentity(order),
    month: '2026-10',
    groups: [{ orderId: order.orderId, groupId: owner.id }],
    ...(!twoGroups
      ? { mark: { orderId: order.orderId, groupId: owner.id } }
      : {}),
    contents: order.items
      .filter((item) => packedIds.has(item.entryId))
      .map((item) => ({
        orderId: order.orderId,
        entryId: item.entryId,
        quantity: item.quantity,
      })),
    count: 6,
    len: '40.125',
    wid: '30',
    ht: '25',
    weightBasis: 'batch',
    weight: '57.2202',
    received: 6,
    loaded: 2,
    revision: 1,
    updatedAt: '2026-10-15T00:00:00.000Z',
  })
  const restored = await extension.inspector.evaluate(
    ({ record, allocation, batch }) =>
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
          cartonBatches: [batch],
          history: [],
          images: [],
        },
      }),
    { record, allocation, batch }
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  const ref = {
      accountId: record.accountId || record.snapshot.accountId || 'local',
      orderId: order.orderId,
    },
    view = await openOrderReconciliation(page, ref, 'cartons'),
    before = await backup(extension)
  expect(before.cartonBatches).toHaveLength(1)
  return { page, view, record, before, ref }
}

function evidence(batch) {
  const { revision: _revision, updatedAt: _updatedAt, ...result } = batch
  return result
}

function expectSource(after, before) {
  expect(after.orders.map((record) => record.snapshot)).toEqual(
    before.orders.map((record) => record.snapshot)
  )
  expect(after.orders.map((record) => record.productPhotos)).toEqual(
    before.orders.map((record) => record.productPhotos)
  )
}
async function reviewLegacy(page, view) {
  await view.locator('[data-action="order-carton-history"]').click()
  await view.locator('[data-history-key]').first().click()
  await page.locator('[data-action="review-legacy-carton"]').click()
  const review = page.locator('[data-action="legacy-carton-review"]')
  await review.locator('select').first().selectOption('not-shipped')
  await review
    .locator('textarea')
    .fill(
      'Synthetic physical evidence reviewed; these goods have never shipped'
    )
  await review.getByRole('checkbox').first().check()
  await review.locator('[data-action="resolve-legacy-carton"]').click()
  await expect(review).toContainText('Legacy evidence review saved')
  await review.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(review).toBeHidden()
}
async function group(page, operation, indices) {
  await page.locator('[data-action="orders-products"]').click()
  await page.locator('#clear-rows').click()
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  for (const index of indices)
    await rows.nth(index).getByRole('checkbox').check()
  await page.locator('#group-order-products').click()
  const tools = page.locator('.orders-grouping-dialog')
  await tools.getByRole('button', { name: operation, exact: true }).click()
  const review = page.getByRole('dialog', {
    name: 'Review product grouping',
    exact: true,
  })
  await expect(review).toBeVisible()
  return { review, tools }
}

test('reviewing legacy loading retains authored physical evidence and a November container does not change October codes', async ({
  extension,
}) => {
  const { page, view, before, ref } = await seed(extension)
  await reviewLegacy(page, view)
  const reviewed = await backup(extension),
    batch = reviewed.cartonBatches[0]
  expect(batch).toMatchObject({
    id: before.cartonBatches[0].id,
    loaded: 2,
    count: 6,
    weight: '57.2202',
    weightBasis: 'batch',
    len: '40.125',
    wid: '30',
    ht: '25',
  })
  expect(batch.contents).toEqual(before.cartonBatches[0].contents)
  expect(batch.legacyResolution).toMatchObject({ resolution: 'not-shipped' })
  const id = await createContainerThroughUI(
    page,
    [ref],
    'Synthetic November legacy review'
  )
  await sealContainerThroughUI(page)
  const manifest = await extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerManifest({ id }),
    id
  )
  expect(manifest.cartons).toHaveLength(6)
  expect(manifest.products.map((row) => row.quantity).sort()).toEqual([
    '3',
    '30',
    '30',
  ])
  expect(JSON.stringify(manifest.totals)).toContain('57.2202')
  const after = await backup(extension)
  expect(after.preparations).toEqual(before.preparations)
  expect(after.cartonBatches[0].month).toBe('2026-10')
  expect(after.cartonBatches[0].contents).toEqual(
    before.cartonBatches[0].contents
  )
  expectSource(after, before)
})

test('Orders merge reviews source ownership without losing a physical mark/count/measurements and compound Undo restores original groups', async ({
  extension,
}) => {
  const { page, view, before } = await seed(extension, { twoGroups: true })
  await reviewLegacy(page, view)
  const { review } = await group(page, 'Merge products', [0, 1, 2])
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  await review
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(review).toBeHidden()
  await expect
    .poll(async () => (await backup(extension)).preparations[0].groups.length)
    .toBe(1)
  const after = await backup(extension),
    batch = after.cartonBatches[0]
  expect(batch).toMatchObject({
    id: before.cartonBatches[0].id,
    count: 6,
    weight: '57.2202',
    len: '40.125',
    wid: '30',
    ht: '25',
    received: 6,
    loaded: 2,
  })
  expect(batch.contents).toEqual(before.cartonBatches[0].contents)
  expectSource(after, before)
  await page.keyboard.press('Control+z')
  await expect
    .poll(async () => (await backup(extension)).preparations[0].groups.length)
    .toBe(2)
  expect((await backup(extension)).preparations[0].groups).toEqual(
    before.preparations[0].groups
  )
  expect((await backup(extension)).cartonBatches[0]).toMatchObject({
    id: batch.id,
    count: 6,
    weight: '57.2202',
    contents: before.cartonBatches[0].contents,
  })
})

test('splitting same-order source variants preserves one physical identity and mark while reviewing the new code owner', async ({
  extension,
}) => {
  const { page, view, before, ref } = await seed(extension)
  await reviewLegacy(page, view)
  const middle = before.preparations[0].groups[0].variants[1],
    { review } = await group(page, 'Move to new product', [1])
  await review
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(review).toBeHidden()
  const after = await backup(extension),
    destination = after.preparations[0].groups.find((group) =>
      group.variants.some((variant) =>
        variant.entryIds.includes(middle.entryIds[0])
      )
    )
  expect(destination.id).not.toBe(before.preparations[0].groups[0].id)
  expect(destination.baseCode).not.toBe(
    before.preparations[0].groups[0].baseCode
  )
  const batch = after.cartonBatches[0]
  expect(after.cartonBatches).toHaveLength(1)
  expect(batch).toMatchObject({
    id: before.cartonBatches[0].id,
    mark: before.cartonBatches[0].mark,
    contents: before.cartonBatches[0].contents,
    count: 6,
    weight: '57.2202',
  })
  expect(new Set(batch.groups.map((group) => group.orderId))).toEqual(
    new Set([ref.orderId])
  )
  expectSource(after, before)
  await page.keyboard.press('Control+z')
  await expect
    .poll(async () => (await backup(extension)).preparations[0].groups.length)
    .toBe(1)
  expect((await backup(extension)).preparations[0].groups).toEqual(
    before.preparations[0].groups
  )
  expect((await backup(extension)).cartonBatches[0]).toMatchObject({
    id: batch.id,
    contents: batch.contents,
    count: 6,
    weight: '57.2202',
  })
})

test('Packing offers whole-order removal only and source suffix edits, physical contents and purchase records survive draft removal/reinclusion', async ({
  extension,
}) => {
  const { page, view, before, ref } = await seed(extension)
  await reviewLegacy(page, view)
  await page.locator('[data-action="orders-products"]').click()
  const editor = await editOrderProduct(page, 1, { 'Variant ending': 'A' })
  await closeOrderProduct(editor)
  const authored = await backup(extension),
    middle = authored.preparations[0].groups[0].variants[1]
  expect(middle.variantSuffix).toBe('A')
  await createContainerThroughUI(
    page,
    [ref],
    'Synthetic draft source preservation'
  )
  await expect(
    page.locator(
      '#packing-view [data-action="organize-packing"],#packing-view [data-action="remove-product"],#packing-view input[data-code-part]'
    )
  ).toHaveCount(0)
  await page.locator('[data-action="remove-container-order"]').click()
  await expect(page.locator('.container-order')).toHaveCount(0)
  const after = await backup(extension)
  expect(after.preparations).toEqual(authored.preparations)
  expect(after.cartonBatches).toEqual(authored.cartonBatches)
  expectSource(after, before)
  const backlog = await extension.inspector.evaluate(async () =>
    (await window.testRepository).getBacklog({})
  )
  expect(backlog.orders.some((order) => order.orderId === ref.orderId)).toBe(
    true
  )
})
