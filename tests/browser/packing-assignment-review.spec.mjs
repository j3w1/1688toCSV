import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function backup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}

async function openOrders(extension, { missingSeller = false } = {}) {
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
    item.title = index < 2 ? '合成玻璃罐' : '合成收纳盒'
    item.productNumber = index < 2 ? 'SYNTHETIC-JAR' : 'SYNTHETIC-BOX'
    item.skuProperties = [
      { label: '颜色', value: '透明' },
      { label: '尺寸', value: index === 0 ? '300ml' : '500ml' },
    ]
    item.description = `${item.title}\n颜色：透明\n尺寸：${index === 0 ? '300ml' : '500ml'}`
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
  await page.getByLabel('Packing month', { exact: true }).fill('2026-10')
  return { page, rows, record, view: page.locator('#packing-view') }
}

async function reviewSelection(page) {
  await page.locator('#prepare-orders').click()
  const review = page.getByRole('dialog', {
    name: 'Assign product codes?',
    exact: true,
  })
  await expect(review).toBeVisible()
  await expect(page.locator('#packing-view')).toBeHidden()
  return review
}

function expectPackingUnchanged(actual, before) {
  for (const key of ['preparations', 'allocations', 'issuedCodes', 'orders'])
    expect(actual[key]).toEqual(before[key])
}

test('one new product reviews its proposed code and helpers before saving; cancel reserves nothing and an assigned reopen needs no review', async ({
  extension,
}) => {
  const { page, rows, record, view } = await openOrders(extension)
  await rows.first().focus()
  await page.keyboard.press('Space')
  const before = await backup(extension)
  const review = await reviewSelection(page)
  await expect(review).toContainText('1 selected product rows from 1 orders')
  await expect(review.locator('.packing-review-item')).toHaveCount(1)
  await expect(review.locator('.preparation-photo')).toHaveCount(1)
  await expect(review).toContainText('Packing month: October 2026')
  for (const value of [
    'Spanish:',
    'Chinese:',
    'Size codes:',
    'Colors:',
    'Materials: Glass',
  ])
    await expect(review).toContainText(value)
  const proposed = await review
    .locator(
      '.packing-value-row:first-child .packing-value-after .packing-value-content'
    )
    .textContent()
  expect(proposed).toMatch(/^CE2610\d{4}$/)
  expectPackingUnchanged(await backup(extension), before)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(view).toBeHidden()
  expectPackingUnchanged(await backup(extension), before)
  await reviewSelection(page)
  await expect(
    review.locator(
      '.packing-value-row:first-child .packing-value-after .packing-value-content'
    )
  ).toHaveText(proposed)
  await review
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  await expect(view).toBeVisible()
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  const saved = await backup(extension)
  expect(
    saved.preparations[0].groups.flatMap((group) =>
      group.variants.flatMap((variant) => variant.entryIds)
    )
  ).toEqual([record.snapshot.items[0].entryId])
  expect(saved.preparations[0].groups[0].baseCode).toBe(proposed)
  expect(saved.orders).toEqual(before.orders)
  await view.page().locator('#view-orders').click()
  await page.locator('#prepare-orders').click()
  await expect(view).toBeVisible()
  await expect(review).toHaveCount(0)
  expect((await backup(extension)).issuedCodes).toEqual(saved.issuedCodes)
})

test('adding another source row of an existing product reviews only the unassigned selection and preserves its existing code', async ({
  extension,
}) => {
  const { page, rows, record, view } = await openOrders(extension)
  await rows.first().focus()
  await page.keyboard.press('Space')
  const review = await reviewSelection(page)
  await review
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  await expect(view).toBeVisible()
  await view.page().locator('#view-orders').click()
  const before = await backup(extension)
  const original = before.preparations[0].groups[0]
  await rows.nth(1).focus()
  await page.keyboard.press('Control+Space')
  await reviewSelection(page)
  await expect(review).toContainText('1 selected product rows from 1 orders')
  await expect(review.locator('.packing-review-item')).toHaveCount(1)
  await expect(review).toContainText('1 product rows · 1 variants')
  const nextCode = await review
    .locator(
      '.packing-value-row:first-child .packing-value-after .packing-value-content'
    )
    .textContent()
  expect(nextCode).not.toBe(original.baseCode)
  expectPackingUnchanged(await backup(extension), before)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expectPackingUnchanged(await backup(extension), before)
  await reviewSelection(page)
  await review
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  await expect(view).toBeVisible()
  const after = await backup(extension)
  expect(
    after.preparations[0].groups.find((group) => group.id === original.id)
      .baseCode
  ).toBe(original.baseCode)
  const added = after.preparations[0].groups.find((group) =>
    group.variants.some((variant) =>
      variant.entryIds.includes(record.snapshot.items[1].entryId)
    )
  )
  expect(added.baseCode).toBe(nextCode)
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

test('seller-missing additions still require review and cancel neither opens packing nor reserves codes', async ({
  extension,
}) => {
  const { page, rows, view } = await openOrders(extension, {
    missingSeller: true,
  })
  await rows.first().focus()
  await page.keyboard.press('Space')
  const before = await backup(extension)
  const review = await reviewSelection(page)
  await expect(review.locator('.packing-review-item')).toHaveCount(1)
  await expect(review).toContainText('1 selected product rows from 1 orders')
  await expect(
    review.locator(
      '.packing-value-row:first-child .packing-value-after .packing-value-content'
    )
  ).toHaveText('Seller login required before assigning codes')
  expectPackingUnchanged(await backup(extension), before)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(view).toBeHidden()
  expectPackingUnchanged(await backup(extension), before)
  await reviewSelection(page)
  await review
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  await expect(view).toBeVisible()
  await expect(
    view.getByLabel('Seller member login (required)', { exact: true })
  ).toHaveValue('')
  await expect(view.getByLabel('Product code', { exact: true })).toHaveValue('')
  expectPackingUnchanged(await backup(extension), before)
})
