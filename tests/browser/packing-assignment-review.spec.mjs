import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function backup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}

async function openOrders(
  extension,
  { missingSeller = false, oneGroup = false } = {}
) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.purchasedAt = '2026-10-12T10:15:00+08:00'
  record.snapshot.sellerName = missingSeller
    ? 'Seller unavailable'
    : 'Synthetic assignment store'
  record.snapshot.sellerMemberLogin = missingSeller
    ? ''
    : 'synthetic-assignment-store'
  if (missingSeller) record.snapshot.sellerUnavailable = true
  else delete record.snapshot.sellerUnavailable
  for (const [index, item] of record.snapshot.items.entries()) {
    const jar = oneGroup || index < 2,
      size = oneGroup
        ? `${300 + index * 200}ml`
        : index === 0
          ? '300ml'
          : '500ml'
    item.title = jar ? '合成玻璃罐' : '合成收纳盒'
    item.productNumber = jar ? 'SYNTHETIC-JAR' : 'SYNTHETIC-BOX'
    item.skuProperties = [
      { label: '颜色', value: '透明' },
      { label: '尺寸', value: size },
    ]
    item.description = `${item.title}\n颜色：透明\n尺寸：${size}`
  }
  const restored = await extension.inspector.evaluate(
    (record) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders: [record],
          history: [],
          images: [],
        },
      }),
    record
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(3)
  return { page, rows, record, view: page.locator('#orders-view') }
}

async function reviewSelection(page) {
  await page.locator('#review-purchase-codes').click()
  const review = page.locator('dialog[data-action="purchase-code-review"]')
  await expect(review).toBeVisible()
  await expect(page.locator('#packing-view')).toBeHidden()
  return review
}

function expectPackingUnchanged(actual, before) {
  for (const key of ['preparations', 'allocations', 'issuedCodes', 'orders'])
    expect(actual[key]).toEqual(before[key])
}

test('one group reviews every full source code without reserving it and one assignment saves exactly that plan', async ({
  extension,
}, testInfo) => {
  const { page, record, view } = await openOrders(extension, { oneGroup: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.locator('#select-rows').click()
  const before = await backup(extension),
    review = await reviewSelection(page),
    codes = await review.locator('article .purchase-code').allTextContents()
  expect(codes).toHaveLength(3)
  expect(new Set(codes).size).toBe(3)
  expect(codes.every((code) => /^CE2610\d{4}[A-Z0-9]*$/.test(code))).toBe(true)
  await expect(review.locator('article')).toHaveCount(3)
  for (const code of await review.locator('article .purchase-code').all())
    await expect(code).toBeInViewport()
  expectPackingUnchanged(await backup(extension), before)
  await review.screenshot({
    path: testInfo.outputPath('purchase-code-review-three-variants.png'),
  })
  await review.locator('[data-action="assign-purchase-codes"]').click()
  await expect(review).toBeHidden()
  await expect(view).toBeVisible()
  const after = await backup(extension),
    group = after.preparations[0].groups[0]
  expect(after.orders).toEqual(before.orders)
  expect(after.preparations).toHaveLength(1)
  expect(after.preparations[0].groups).toHaveLength(1)
  expect(
    group.variants.map(
      (variant) =>
        `${group.baseCode}${variant.variantSuffix}${variant.sizeSuffix}`
    )
  ).toEqual(codes)
  expect(group.variants.flatMap((variant) => variant.entryIds).sort()).toEqual(
    record.snapshot.items.map((item) => item.entryId).sort()
  )
})

test('single-product code review cancel reserves nothing and assignment never opens Packing or creates cartons', async ({
  extension,
}) => {
  const { page, rows, record, view } = await openOrders(extension)
  await rows.first().getByRole('checkbox').check()
  const before = await backup(extension),
    review = await reviewSelection(page),
    proposed = await review.locator('article .purchase-code').textContent()
  expect(proposed).toMatch(/^CE2610\d{4}[A-Z0-9]*$/)
  await expect(review.locator('article')).toHaveCount(1)
  await expect(review.locator('.preparation-photo')).toHaveCount(1)
  expectPackingUnchanged(await backup(extension), before)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expectPackingUnchanged(await backup(extension), before)
  await reviewSelection(page)
  await expect(review.locator('article .purchase-code')).toHaveText(proposed)
  await review.locator('[data-action="assign-purchase-codes"]').click()
  await expect(review).toBeHidden()
  await expect(view).toBeVisible()
  const saved = await backup(extension),
    group = saved.preparations[0].groups[0],
    variant = group.variants[0]
  expect(
    saved.preparations[0].groups.flatMap((group) =>
      group.variants.flatMap((variant) => variant.entryIds)
    )
  ).toEqual([record.snapshot.items[0].entryId])
  expect(group.baseCode + variant.variantSuffix + variant.sizeSuffix).toBe(
    proposed
  )
  expect(saved.orders).toEqual(before.orders)
  expect(saved.cartonBatches).toEqual([])
  await reviewSelection(page)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await backup(extension)).issuedCodes).toEqual(saved.issuedCodes)
})

test('adding an unassigned source row preserves existing codes and prices through preview cancel and assignment', async ({
  extension,
}) => {
  const { page, rows, record } = await openOrders(extension)
  await rows.first().getByRole('checkbox').check()
  let review = await reviewSelection(page)
  await review.locator('[data-action="assign-purchase-codes"]').click()
  await expect(review).toBeHidden()
  const before = await backup(extension),
    original = before.preparations[0].groups[0]
  await page.locator('#clear-rows').click()
  await rows.nth(1).getByRole('checkbox').check()
  review = await reviewSelection(page)
  await expect(review.locator('article')).toHaveCount(1)
  const nextCode = await review.locator('article .purchase-code').textContent()
  expectPackingUnchanged(await backup(extension), before)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expectPackingUnchanged(await backup(extension), before)
  review = await reviewSelection(page)
  await review.locator('[data-action="assign-purchase-codes"]').click()
  await expect(review).toBeHidden()
  const after = await backup(extension),
    retained = after.preparations[0].groups.find(
      (group) => group.id === original.id
    ),
    added = after.preparations[0].groups.find((group) =>
      group.variants.some((variant) =>
        variant.entryIds.includes(record.snapshot.items[1].entryId)
      )
    ),
    variant = added.variants.find((variant) =>
      variant.entryIds.includes(record.snapshot.items[1].entryId)
    )
  expect(retained.baseCode).toBe(original.baseCode)
  expect(added.baseCode + variant.variantSuffix + variant.sizeSuffix).toBe(
    nextCode
  )
  expect(
    after.preparations[0].groups
      .flatMap((group) => group.variants.flatMap((variant) => variant.entryIds))
      .sort()
  ).toEqual(
    record.snapshot.items
      .slice(0, 2)
      .map((item) => item.entryId)
      .sort()
  )
  expect(after.orders).toEqual(before.orders)
})

test('missing seller review cannot allocate placeholder codes and exposes explicit purchase evidence recovery', async ({
  extension,
}) => {
  const { page, rows, view } = await openOrders(extension, {
    missingSeller: true,
  })
  await rows.first().getByRole('checkbox').check()
  const before = await backup(extension),
    review = await reviewSelection(page)
  await expect(
    review.locator('[data-action="assign-purchase-codes"]')
  ).toBeDisabled()
  await expect(
    review.locator('[data-action="review-purchase-evidence"]')
  ).toBeVisible()
  expectPackingUnchanged(await backup(extension), before)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(view).toBeVisible()
  expectPackingUnchanged(await backup(extension), before)
  await reviewSelection(page)
  await review
    .locator('[data-action="review-purchase-evidence"]')
    .first()
    .click()
  await expect(
    page.locator('dialog[data-action="review-purchase-evidence"]')
  ).toBeVisible()
  expectPackingUnchanged(await backup(extension), before)
})
