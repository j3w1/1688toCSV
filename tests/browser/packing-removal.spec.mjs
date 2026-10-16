import { test, expect, holdPreparationWrites } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function backup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}

async function openPacking(page, groupCount = 2) {
  await page.getByLabel('Packing month', { exact: true }).fill('2026-10')
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  const view = page.locator('#packing-view')
  const review = page.getByRole('dialog', {
    name: 'Assign product codes?',
    exact: true,
  })
  await expect
    .poll(async () => (await view.isVisible()) || (await review.isVisible()))
    .toBe(true)
  if (await review.isVisible())
    await review
      .getByRole('button', { name: 'Assign codes and prepare', exact: true })
      .click()
  await expect(view).toBeVisible()
  await expect(view.locator('.preparation-group')).toHaveCount(groupCount)
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  return view
}

async function seedPacking(extension) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerName = 'Synthetic removal store'
  record.snapshot.sellerMemberLogin = 'synthetic-removal'
  record.snapshot.sellerShopOrigin = 'https://synthetic-removal.1688.com'
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = index < 2 ? '合成玻璃罐' : '合成收纳盒'
    item.productNumber = index < 2 ? 'TEST-JAR' : 'TEST-BOX'
    item.skuProperties = [
      { label: '颜色', value: index === 0 ? '红色' : '白色' },
    ]
    item.description = `${item.title}\n颜色：${item.skuProperties[0].value}`
  }
  const response = await extension.inspector.evaluate(
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
  expect(response.ok, response.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(3)
  await rows.first().focus()
  await page.keyboard.press('Control+a')
  return { page, view: await openPacking(page), record }
}

function memberships(preparation) {
  return preparation.groups.flatMap((group) =>
    group.variants.flatMap((variant) => variant.entryIds)
  )
}

test('group selection adds and removes independently without modifiers or interfering with editors', async ({
  extension,
}) => {
  const { page, view } = await seedPacking(extension)
  await view
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  const groups = view.locator('.preparation-group')
  const first = groups.first().locator('.group-select')
  const second = groups.nth(1).locator('.group-select')
  const backupButton = view.getByRole('button', {
    name: 'Back up packing',
    exact: true,
  })
  await expect(backupButton).toBeDisabled()
  await first.click()
  await second.click()
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await expect(second).toHaveAttribute('aria-pressed', 'true')
  await expect(view.locator('.preparation-copy-scope')).toHaveText(
    '3 selected products · 1 orders'
  )
  await expect(backupButton).toBeEnabled()
  await groups.first().getByLabel('Product code', { exact: true }).click()
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await expect(second).toHaveAttribute('aria-pressed', 'true')
  await first.click()
  await expect(first).toHaveAttribute('aria-pressed', 'false')
  await expect(second).toHaveAttribute('aria-pressed', 'true')
  await expect(view.locator('.preparation-copy-scope')).toHaveText(
    '1 selected products · 1 orders'
  )
  await second.click()
  await expect(backupButton).toBeDisabled()
  await first.focus()
  await page.keyboard.press('Control+a')
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await expect(second).toHaveAttribute('aria-pressed', 'true')
})

test('product and group removal confirm exact affected photos and persist without changing source rows or reservations', async ({
  extension,
}) => {
  const { page, view } = await seedPacking(extension)
  const before = await backup(extension)
  const initial = before.preparations[0]
  const [jar, box] = initial.groups
  const removedIds = jar.variants[0].entryIds
  const jarCard = view.locator(`[data-group-id="${jar.id}"]`)
  const remove = jarCard
    .getByRole('button', { name: 'Remove product', exact: true })
    .first()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await remove.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= window.innerWidth
    })
  ).toBe(true)
  await remove.click()
  const review = page.getByRole('dialog', {
    name: 'Remove from packing?',
    exact: true,
  })
  await expect(review.locator('.packing-review-item')).toHaveCount(
    removedIds.length
  )
  await expect(review.locator('.preparation-photo')).toHaveCount(
    removedIds.length
  )
  await expect(review).toContainText(
    'original order data and issued codes are kept'
  )
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  await remove.click()
  await review
    .getByRole('button', { name: 'Remove from packing', exact: true })
    .click()
  const remaining = memberships(initial).filter(
    (id) => !removedIds.includes(id)
  )
  await expect
    .poll(async () => memberships((await backup(extension)).preparations[0]))
    .toEqual(remaining)
  await expect(jarCard.locator('.variants tbody tr')).toHaveCount(1)
  const afterProduct = await backup(extension)
  expect(afterProduct.orders).toEqual(before.orders)
  expect(afterProduct.issuedCodes).toEqual(before.issuedCodes)
  expect(afterProduct.allocations).toEqual(before.allocations)
  await page.reload()
  await openPacking(page)
  await expect(jarCard.locator('.variants tbody tr')).toHaveCount(1)
  await jarCard
    .getByRole('button', { name: 'Remove group', exact: true })
    .click()
  await expect(review.locator('.packing-review-item')).toHaveCount(1)
  await review
    .getByRole('button', { name: 'Remove from packing', exact: true })
    .click()
  await expect(view.locator('.preparation-group')).toHaveCount(1)
  const afterGroup = await backup(extension)
  expect(afterGroup.preparations[0].groups.map((group) => group.id)).toEqual([
    box.id,
  ])
  expect(
    afterGroup.preparations[0].defaultPacking.groups.map((group) => group.id)
  ).toEqual([box.id])
  expect(afterGroup.orders).toEqual(before.orders)
  expect(afterGroup.issuedCodes).toEqual(before.issuedCodes)
  await page.reload()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await openPacking(page, 1)
  await expect(
    view.getByRole('button', { name: 'Reset order and codes', exact: true })
  ).toBeDisabled()
  expect(memberships((await backup(extension)).preparations[0])).toEqual(
    memberships({ groups: [box] })
  )
})

test('removing the last group keeps an empty saved packing while original products can be selected again', async ({
  extension,
}) => {
  const { page, view } = await seedPacking(extension)
  const original = await backup(extension)
  for (let count = 2; count > 0; count--) {
    await view
      .getByRole('button', { name: 'Remove group', exact: true })
      .first()
      .click()
    const review = page.getByRole('dialog', {
      name: 'Remove from packing?',
      exact: true,
    })
    await review
      .getByRole('button', { name: 'Remove from packing', exact: true })
      .click()
    await expect(view.locator('.preparation-group')).toHaveCount(count - 1)
  }
  await expect
    .poll(async () => (await backup(extension)).preparations[0].groups)
    .toEqual([])
  const removed = await backup(extension)
  expect(removed.preparations).toHaveLength(1)
  expect(removed.preparations[0].defaultPacking.groups).toEqual([])
  expect(removed.orders).toEqual(original.orders)
  expect(removed.issuedCodes).toEqual(original.issuedCodes)
  await page.reload()
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(3)
  const launch = page.getByRole('button', {
    name: 'Prepare packing list',
    exact: true,
  })
  await expect(launch).toBeDisabled()
  await rows.first().focus()
  await page.keyboard.press('Space')
  await openPacking(page, 1)
  const added = await backup(extension)
  expect(memberships(added.preparations[0])).toEqual([
    original.orders[0].snapshot.items[0].entryId,
  ])
  const originalCodes = original.preparations[0].groups.map(
    (group) => group.baseCode
  )
  expect(originalCodes).not.toContain(added.preparations[0].groups[0].baseCode)
  for (const issued of original.issuedCodes)
    expect(added.issuedCodes).toContainEqual(issued)
})

test('reset shows position and barcode changes and becomes unavailable after the saved defaults are restored', async ({
  extension,
}) => {
  const { page, view } = await seedPacking(extension)
  const reset = view.getByRole('button', {
    name: 'Reset order and codes',
    exact: true,
  })
  await expect(reset).toBeDisabled()
  const original = await backup(extension)
  const [jar, box] = original.preparations[0].groups
  const firstVariant = jar.variants[0]
  const originalBarcode = `${jar.baseCode}${firstVariant.variantSuffix}${firstVariant.sizeSuffix}`
  await view
    .locator(`[data-group-id="${jar.id}"]`)
    .getByLabel(`Variant code ${firstVariant.id}`, { exact: true })
    .fill('ZZ')
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  await view
    .getByRole('button', {
      name: 'Move group 1; use Up or Down arrows',
      exact: true,
    })
    .press('ArrowDown')
  await expect
    .poll(async () =>
      (await backup(extension)).preparations[0].groups.map((group) => group.id)
    )
    .toEqual([box.id, jar.id])
  await expect(reset).toBeEnabled()
  const changed = await backup(extension)
  await reset.click()
  const review = page.getByRole('dialog', {
    name: 'Reset order and codes?',
    exact: true,
  })
  await expect(review.locator('.packing-review-item')).toHaveCount(2)
  await expect(review).toContainText('Position 2 → 1')
  await expect(review).toContainText(
    `${jar.baseCode}ZZ${firstVariant.sizeSuffix} → ${originalBarcode}`
  )
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await backup(extension)).preparations).toEqual(changed.preparations)
  await holdPreparationWrites(page)
  await reset.click()
  await review
    .getByRole('button', { name: 'Reset order and codes', exact: true })
    .click()
  const fields = view.locator('#preparation-content')
  try {
    await expect
      .poll(() => page.evaluate(() => window.preparationSaveStarted))
      .toBe(true)
    await expect(fields).toHaveJSProperty('disabled', true)
    // Reset is still actionable in the old draft but temporarily inherits the
    // fieldset's disabled state while the real database transaction is held.
    await expect(reset).toHaveJSProperty('disabled', false)
    await expect(reset).toBeDisabled()
  } finally {
    await page.evaluate(() => (window.holdPreparationSave = false))
  }
  // Playwright's toBeEnabled() ignores FIELDSET. Read its native property so
  // a pending save cannot satisfy the final no-op/backup assertions below.
  await expect(fields).toHaveJSProperty('disabled', false)
  await expect(reset).toBeDisabled()
  const restored = await backup(extension)
  expect(restored.preparations[0].groups).toEqual(
    original.preparations[0].groups
  )
  for (const issued of changed.issuedCodes)
    expect(restored.issuedCodes).toContainEqual(issued)
  await page.reload()
  await openPacking(page)
  await expect(reset).toBeDisabled()
})
