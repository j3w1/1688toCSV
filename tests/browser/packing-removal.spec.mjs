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

async function removalAction(container, name) {
  const action = container.getByRole('button', { name, exact: true }).first()
  await action.focus()
  await expect(action).toBeVisible()
  return action
}

test('packing keeps direct drag and trash controls at the far left for pointer, keyboard and touch', async ({
  extension,
}) => {
  const { page, view } = await seedPacking(extension)
  const group = view.locator('.preparation-group').first()
  const row = group.locator('tr[data-variant-id]').first()
  await expect(group.locator('.variant-index')).toHaveCount(0)
  await expect(row.locator(':scope > td')).toHaveCount(4)
  await expect(row.locator(':scope > td').first()).toHaveClass(
    'variant-actions'
  )
  await expect(group.getByRole('columnheader')).toHaveText([
    'Product actions',
    'Photo',
    'Product variant',
    'Barcode',
  ])
  expect(
    (await group.locator('thead').boundingBox()).height
  ).toBeLessThanOrEqual(1)
  await expect(group).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(group).toHaveCSS('border-left-width', '0px')
  await expect(row.locator('td').first()).toHaveCSS(
    'border-bottom-width',
    '0px'
  )
  const actions = row.getByRole('group', {
    name: 'Product actions',
    exact: true,
  })
  const grip = actions.locator('.reorder-handle')
  const remove = actions.getByRole('button', {
    name: 'Remove product',
    exact: true,
  })
  const groupActions = group.locator(
    '.product-overview > .packing-item-actions'
  )
  const groupGrip = groupActions.locator('.reorder-handle')
  const removeGroup = groupActions.getByRole('button', {
    name: 'Remove group',
    exact: true,
  })
  await expect(groupActions).toHaveAccessibleName('Group actions')
  await expect(group.locator('.product-overview > :first-child')).toHaveClass(
    'packing-item-actions'
  )
  for (const controls of [actions, groupActions]) {
    await expect(controls.locator(':scope > button')).toHaveCount(2)
    await expect(controls.locator(':scope > button').first()).toHaveClass(
      /reorder-handle/
    )
    await expect(controls.locator(':scope > button').last()).toHaveClass(
      /packing-remove-button/
    )
    await expect(controls.locator('[popover], [popovertarget]')).toHaveCount(0)
  }
  await view.locator('h1').click()
  await page.mouse.move(0, 0)
  for (const control of [grip, remove, groupGrip, removeGroup])
    await expect(control).toHaveCSS('opacity', '0')
  await row.hover()
  await expect(grip).toHaveCSS('opacity', '1')
  await expect(remove).toHaveCSS('opacity', '1')
  const gripBox = await grip.boundingBox()
  const removeBox = await remove.boundingBox()
  expect(Math.abs(gripBox.y - removeBox.y)).toBeLessThanOrEqual(1)
  expect(gripBox.x + gripBox.width).toBeLessThanOrEqual(removeBox.x)
  expect(removeBox.x + removeBox.width - gripBox.x).toBeLessThanOrEqual(50)
  const actionsBox = await actions.boundingBox()
  const photoBox = await row.locator('.variant-photos').boundingBox()
  expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(photoBox.x)
  await group.locator('.product-overview').hover()
  await expect(groupGrip).toHaveCSS('opacity', '1')
  await expect(removeGroup).toHaveCSS('opacity', '1')
  const groupActionsBox = await groupActions.boundingBox()
  const summaryBox = await group.locator('.product-summary').boundingBox()
  expect(groupActionsBox.x + groupActionsBox.width).toBeLessThanOrEqual(
    summaryBox.x
  )
  const groupGripBox = await groupGrip.boundingBox()
  const groupRemoveBox = await removeGroup.boundingBox()
  expect(Math.abs(groupGripBox.y - groupRemoveBox.y)).toBeLessThanOrEqual(1)
  expect(groupGripBox.x + groupGripBox.width).toBeLessThanOrEqual(
    groupRemoveBox.x
  )
  await page.mouse.move(0, 0)
  await grip.focus()
  await expect(grip).toHaveCSS('opacity', '1')
  await expect(remove).toHaveCSS('opacity', '1')
  await expect(grip).toHaveAccessibleName(
    'Move product 1; use Up or Down arrows'
  )
  await removeGroup.focus()
  await expect(groupGrip).toHaveCSS('opacity', '1')
  await expect(removeGroup).toHaveCSS('opacity', '1')
  await page.setViewportSize({ width: 390, height: 844 })
  for (const control of [remove, removeGroup]) {
    await control.focus()
    const bounds = await control.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
  }
  await remove.focus()
  await remove.press('Enter')
  const review = page.getByRole('dialog', {
    name: 'Remove from packing?',
    exact: true,
  })
  await expect(review).toBeVisible()
  await expect(review.locator('.packing-review-item')).toHaveCount(2)
  await expect(
    review
      .locator('.packing-review-item')
      .filter({ hasText: 'Removed from packing' })
  ).toHaveCount(1)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(review).toBeHidden()
  await expect(group.locator('tr[data-variant-id]')).toHaveCount(2)
  await expect(view).toBeVisible()
  const session = await extension.context.newCDPSession(page)
  try {
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    await expect
      .poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches))
      .toBe(true)
    await view.locator('h1').click()
    await page.mouse.move(0, 0)
    for (const control of [grip, remove, groupGrip, removeGroup]) {
      await expect(control).toHaveCSS('opacity', '1')
      const bounds = await control.boundingBox()
      expect(bounds.width).toBeGreaterThanOrEqual(44)
      expect(bounds.height).toBeGreaterThanOrEqual(44)
    }
  } finally {
    await session.detach()
  }
})

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
    includeHidden: true,
  })
  await expect(backupButton).toBeEnabled()
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
  await expect(backupButton).toBeEnabled()
  await first.focus()
  await page.keyboard.press('Control+a')
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await expect(second).toHaveAttribute('aria-pressed', 'true')
})

test('new product removal returns it to unassigned and later sessions retain the baseline when excluding saved products', async ({
  extension,
}) => {
  const { page, view } = await seedPacking(extension)
  const before = await backup(extension)
  const initial = before.preparations[0]
  const [jar, box] = initial.groups
  const removedIds = jar.variants[0].entryIds
  const jarCard = view.locator(`[data-group-id="${jar.id}"]`)
  await page.setViewportSize({ width: 390, height: 844 })
  const remove = await removalAction(jarCard, 'Remove product')
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
  await expect(review.locator('.packing-review-item')).toHaveCount(2)
  await expect(
    review
      .locator('.packing-review-item')
      .filter({ hasText: 'Removed from packing' })
  ).toHaveCount(removedIds.length)
  await expect(review.locator('.preparation-photo')).toHaveCount(2)
  const keptSibling = review
    .locator('.packing-review-item')
    .filter({ hasText: 'This product stays in packing' })
  await expect(keptSibling).toHaveCount(1)
  await expect(keptSibling).toContainText('2 product rows · 2 variants')
  await expect(keptSibling).toContainText('1 product rows · 1 variants')
  await expect(review).toContainText('Original order data is kept')
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  await removalAction(jarCard, 'Remove product')
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
  expect(
    afterProduct.issuedCodes.some(
      (entry) => entry.variantId === jar.variants[0].id
    )
  ).toBe(false)
  expect(afterProduct.allocations).toEqual(before.allocations)
  await page.reload()
  await openPacking(page)
  await expect(jarCard.locator('.variants tbody tr')).toHaveCount(1)
  await (await removalAction(jarCard, 'Remove group')).click()
  await expect(review.locator('.packing-review-item')).toHaveCount(1)
  await review
    .getByRole('button', { name: 'Remove from packing', exact: true })
    .click()
  await expect(view.locator('.preparation-group')).toHaveCount(1)
  const afterGroup = await backup(extension)
  expect(afterGroup.preparations[0].groups.map((group) => group.id)).toEqual([
    jar.id,
    box.id,
  ])
  expect(
    afterGroup.preparations[0].defaultPacking.groups.map((group) => group.id)
  ).toEqual([jar.id, box.id])
  expect(afterGroup.orders).toEqual(before.orders)
  expect(afterGroup.issuedCodes).toEqual(afterProduct.issuedCodes)
  await page.reload()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await openPacking(page, 2)
  await expect(
    view.getByRole('button', { name: 'Reset order and codes', exact: true })
  ).toBeDisabled()
  expect(memberships((await backup(extension)).preparations[0])).toEqual(
    remaining
  )
})

test('removing the last group keeps an empty saved packing while original products can be selected again', async ({
  extension,
}) => {
  const { page, view } = await seedPacking(extension)
  const original = await backup(extension)
  for (let count = 2; count > 0; count--) {
    await (await removalAction(view, 'Remove group')).click()
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
  expect(removed.issuedCodes).toEqual([])
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
  expect(originalCodes).toContain(added.preparations[0].groups[0].baseCode)
  expect(
    added.issuedCodes.every(
      (entry) => entry.groupId === added.preparations[0].groups[0].id
    )
  ).toBe(true)
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
  const firstChange = review.locator('.packing-review-item').first()
  const position = firstChange
    .locator('.packing-value-row')
    .filter({ has: page.getByText('Position', { exact: true }) })
  await expect(
    position.locator('.packing-value-before .packing-value-content')
  ).toHaveText('2')
  await expect(
    position.locator('.packing-value-after .packing-value-content')
  ).toHaveText('1')
  const barcode = firstChange.locator('.packing-value-row').filter({
    has: page.getByText(`${jar.baseCode}ZZ${firstVariant.sizeSuffix}`, {
      exact: true,
    }),
  })
  await expect(barcode.locator('.packing-value-after .ce-code')).toHaveText(
    originalBarcode
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
  expect(restored.issuedCodes.map(({ code }) => code).sort()).toEqual(
    original.issuedCodes.map(({ code }) => code).sort()
  )
  await page.reload()
  await openPacking(page)
  await expect(reset).toBeDisabled()
})
