import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  createPreparation,
  allocatePreparation,
} from '../../src/packing-model.js'
import { validateCartonBatch } from '../../src/carton-batches.js'
import { repeatProductStoreIdentity } from '../../src/repeat-products.js'
import { clickGroupingAction } from './copy-actions-helpers.mjs'
import {
  finishOrganizing,
  packingRemovalAction,
} from './packing-organize-helpers.mjs'

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
  await page.locator('#view-packing').click()
  const view = page.locator('#packing-view')
  await expect(view).toBeVisible()
  await expect(view.locator('.preparation-group')).toHaveCount(
    twoGroups ? 2 : 1
  )
  const before = await backup(extension)
  expect(before.cartonBatches).toHaveLength(1)
  expect(before.cartonBatches[0].needsReview).not.toBe(true)
  return { page, view, record, before }
}

function evidence(batch) {
  const { revision: _revision, updatedAt: _updatedAt, ...result } = batch
  return result
}

async function singleReview(page, name) {
  const review = page.getByRole('dialog', { name, exact: true })
  await expect(review).toBeVisible()
  await expect(page.locator('.packing-review:visible')).toHaveCount(1)
  return review
}

function cartonCard(review) {
  return review.locator('.packing-review-item').filter({
    has: review.page().locator('strong', { hasText: /^Carton batch(?: 1)?$/ }),
  })
}

async function applyReview(page, review, label = 'Apply changes') {
  await review.getByRole('button', { name: label, exact: true }).click()
  await expect(review).toHaveCount(0)
  await expect(page.locator('.packing-review:visible')).toHaveCount(0)
}

async function undo(view) {
  const action = view.getByRole('button', { name: 'Undo', exact: true })
  await expect(action).toBeEnabled()
  await action.click()
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
}

test('moving prepared products includes their authored cartons in the same review and preserves old-month confirmations', async ({
  extension,
}) => {
  const { page, view, before } = await seed(extension)
  await page.locator('#view-orders').click()
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await rows.first().focus()
  await page.keyboard.press('Control+a')
  await page.getByLabel('Packing month', { exact: true }).fill('2026-11')
  await page.locator('#prepare-orders').click()
  let review = await singleReview(
    page,
    'Move selected products to this packing month?'
  )
  await expect(cartonCard(review)).toHaveCount(1)
  await expect(cartonCard(review)).toContainText('2026-10')
  await expect(cartonCard(review)).toContainText('Review cartons')
  await expect(cartonCard(review)).toContainText(
    'Original carton contents, measurements and month confirmations are kept for review'
  )
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  const cancelled = await backup(extension)
  expect(cancelled.preparations).toEqual(before.preparations)
  expect(cancelled.cartonBatches).toEqual(before.cartonBatches)
  expect(cancelled.issuedCodes).toEqual(before.issuedCodes)

  await page.locator('#prepare-orders').click()
  review = await singleReview(
    page,
    'Move selected products to this packing month?'
  )
  await applyReview(page, review, 'Change codes and prepare')
  await expect(view).toBeVisible()
  await expect
    .poll(async () => (await backup(extension)).preparations[0].month)
    .toBe('2026-11')
  const after = await backup(extension)
  expect(after.preparations[0].groups[0].baseCode).toMatch(/^CE2611\d{4}$/)
  expect(after.cartonBatches).toHaveLength(1)
  expect(evidence(after.cartonBatches[0])).toEqual({
    ...evidence(before.cartonBatches[0]),
    needsReview: true,
  })
  expect(
    after.cartonBatches.filter((batch) => batch.month === '2026-11')
  ).toEqual([])
  expect(after.orders).toEqual(before.orders)
})

test('merging away a carton-mark group preserves its original physical evidence for review, and one Undo restores both', async ({
  extension,
}) => {
  const { page, view, before } = await seed(extension, { twoGroups: true })
  await view
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  for (const select of await view.locator('.group-select').all())
    await select.click()
  await clickGroupingAction(page, 'Merge products')
  const review = await singleReview(page, 'Merge selected product groups?')
  await expect(cartonCard(review)).toHaveCount(1)
  await expect(cartonCard(review)).toContainText('CE26101002')
  const markChange = cartonCard(review)
    .locator('.packing-value-row')
    .filter({ hasText: 'Carton mark' })
  await expect(markChange.locator('.packing-value-before code')).toHaveText(
    'CE26101002'
  )
  await expect(markChange.locator('.packing-value-after code')).toHaveText(
    'CE26101002'
  )
  await expect(cartonCard(review)).toContainText('Review cartons')
  expect((await backup(extension)).cartonBatches).toEqual(before.cartonBatches)
  await applyReview(page, review)
  await expect(view.locator('.preparation-group')).toHaveCount(1)
  const after = await backup(extension)
  expect(after.preparations[0].groups[0].variants).toHaveLength(3)
  expect(after.cartonBatches).toHaveLength(1)
  expect(evidence(after.cartonBatches[0])).toEqual({
    ...evidence(before.cartonBatches[0]),
    needsReview: true,
  })
  expect(after.orders).toEqual(before.orders)

  await undo(view)
  await expect(view.locator('.preparation-group')).toHaveCount(2)
  const restored = await backup(extension)
  expect(restored.preparations[0].groups).toEqual(before.preparations[0].groups)
  expect(restored.cartonBatches.map(evidence)).toEqual(
    before.cartonBatches.map(evidence)
  )
  await expect(
    view.getByRole('button', { name: 'Undo', exact: true })
  ).toBeDisabled()
  await expect(
    view.getByRole('button', { name: 'Redo', exact: true })
  ).toBeEnabled()
})

test('splitting shared contents across same-order groups reviews ownership while preserving one physical mark and batch', async ({
  extension,
}) => {
  const { page, view, before } = await seed(extension)
  const middle = before.preparations[0].groups[0].variants[1]
  await view
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  const row = view.locator(`tr[data-variant-id="${middle.id}"]`)
  await row.focus()
  await row.press('Space')
  await clickGroupingAction(page, 'Move to new product')
  const review = await singleReview(
    page,
    'Move variants to a new product group?'
  )
  await expect(cartonCard(review)).toHaveCount(1)
  await expect(cartonCard(review)).toContainText('Linked to the new group')
  await expect(cartonCard(review)).toContainText(
    'Carton contents, measurements and confirmations stay together under the new group'
  )
  await applyReview(page, review)
  await expect(view.locator('.preparation-group')).toHaveCount(2)
  const after = await backup(extension)
  const destination = after.preparations[0].groups.find((group) =>
    group.variants.some((variant) =>
      variant.entryIds.includes(middle.entryIds[0])
    )
  )
  expect(destination.id).not.toBe(before.preparations[0].groups[0].id)
  expect(destination.baseCode).not.toBe(
    before.preparations[0].groups[0].baseCode
  )
  expect(after.cartonBatches).toHaveLength(1)
  expect(evidence(after.cartonBatches[0])).toEqual({
    ...evidence(before.cartonBatches[0]),
    groups: [
      before.cartonBatches[0].groups[0],
      { orderId: before.preparations[0].orderId, groupId: destination.id },
    ],
  })
  expect(after.orders).toEqual(before.orders)

  await undo(view)
  await expect(view.locator('.preparation-group')).toHaveCount(1)
  const restored = await backup(extension)
  expect(restored.preparations[0].groups).toEqual(before.preparations[0].groups)
  expect(restored.cartonBatches.map(evidence)).toEqual(
    before.cartonBatches.map(evidence)
  )
  await expect(
    view.getByRole('button', { name: 'Undo', exact: true })
  ).toBeDisabled()
})

test('Organize removal reviews shared contents and preparation reversions together; one Undo restores both', async ({
  extension,
}) => {
  const { page, view, before } = await seed(extension)
  const middle = before.preparations[0].groups[0].variants[1]
  const row = view.locator(`tr[data-variant-id="${middle.id}"]`)
  const variantCode = row.getByLabel(`Variant code ${middle.id}`, {
    exact: true,
  })
  await variantCode.fill('A')
  await variantCode.press('Tab')
  await expect
    .poll(
      async () =>
        (await backup(extension)).preparations[0].groups[0].variants[1]
          .variantSuffix
    )
    .toBe('A')
  const beforeRemoval = await backup(extension)
  const remove = await packingRemovalAction(row, 'product')
  await remove.click()
  const review = await singleReview(page, 'Remove from packing?')
  await expect(cartonCard(review)).toHaveCount(1)
  await expect(review).toContainText('CE26101001AM')
  await expect(review).toContainText('CE26101001M')
  await expect(cartonCard(review)).toContainText(
    'Carton measurements and confirmations stay. Review the remaining contents before shipping.'
  )
  expect((await backup(extension)).cartonBatches).toEqual(
    beforeRemoval.cartonBatches
  )
  await applyReview(page, review, 'Remove from packing')
  await finishOrganizing(page)
  await expect(view.locator('.variants tbody tr')).toHaveCount(2)
  const after = await backup(extension)
  expect(after.preparations[0].groups[0].variants[1].variantSuffix).toBe('')
  expect(after.cartonBatches).toHaveLength(1)
  expect(evidence(after.cartonBatches[0])).toEqual({
    ...evidence(beforeRemoval.cartonBatches[0]),
    contents: beforeRemoval.cartonBatches[0].contents.filter(
      (item) => !middle.entryIds.includes(item.entryId)
    ),
    needsReview: true,
  })
  expect(after.orders).toEqual(before.orders)

  await undo(view)
  await expect(view.locator('.variants tbody tr')).toHaveCount(3)
  const restored = await backup(extension)
  expect(restored.preparations[0].groups).toEqual(
    beforeRemoval.preparations[0].groups
  )
  expect(restored.cartonBatches.map(evidence)).toEqual(
    beforeRemoval.cartonBatches.map(evidence)
  )
  await expect(variantCode).toHaveValue('A')
  await expect(
    view.getByRole('button', { name: 'Undo', exact: true })
  ).toBeEnabled()
  await expect(
    view.getByRole('button', { name: 'Redo', exact: true })
  ).toBeEnabled()
})
