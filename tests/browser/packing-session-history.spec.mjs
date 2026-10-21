import { test, expect, holdPreparationWrites } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function backup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}

async function setup(
  extension,
  count = 1,
  {
    openFirstOnly = false,
    packingPositions = [],
    withPreviousPacking = false,
    sameSeller = false,
  } = {}
) {
  const [source] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const records = Array.from({ length: count }, (_, index) => {
    const record = structuredClone(source)
    record.snapshot.orderId = String(7300000000000000000n + BigInt(index))
    record.snapshot.sourceUrl = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${record.snapshot.orderId}`
    record.snapshot.sellerName = `Synthetic history ${index ? 'a' : 'z'} store`
    record.snapshot.sellerMemberLogin = `synthetic-history-${index ? 'a' : 'z'}`
    if (sameSeller) {
      record.snapshot.sellerName = 'Synthetic history shared store'
      record.snapshot.sellerMemberLogin = 'synthetic-history-shared'
    }
    for (const [row, item] of record.snapshot.items.entries()) {
      item.title = row < 2 ? '合成玻璃罐' : '合成收纳盒'
      item.productNumber = row < 2 ? 'HISTORY-JAR' : 'HISTORY-BOX'
      item.skuProperties = [{ label: '颜色', value: row ? '白色' : '红色' }]
      item.description = `${item.title}\n颜色：${item.skuProperties[0].value}`
    }
    return record
  })
  const fixture = await extension.context.newPage()
  await fixture.goto(`${extension.origin}/unsupported`)
  const seeded = await fixture.evaluate(
    async ({
      records,
      origin,
      openFirstOnly,
      packingPositions,
      withPreviousPacking,
    }) => {
      const { openDatabase } = await import(`${origin}/src/database.js`)
      const { createPreparation, packingCheckpoint } = await import(
        `${origin}/src/packing-model.js`
      )
      const db = await openDatabase()
      await db.restoreBackup({
        format: '1688-order-library',
        version: 1,
        exportedAt: new Date().toISOString(),
        orders: records,
        history: [],
        images: [],
      })
      const assigned = await db.savePreparations(
        records.map(({ snapshot }, index) => {
          const draft = createPreparation(snapshot, '2026-10')
          if (openFirstOnly && index === 0) draft.packingPosition = 0
          if (Number.isInteger(packingPositions[index]))
            draft.packingPosition = packingPositions[index]
          for (const group of draft.groups) {
            group.category = '玻璃'
            group.spanishName = 'FRASCO'
          }
          return draft
        })
      )
      if (withPreviousPacking)
        await db.savePreparations(
          assigned.map((draft) => ({
            ...draft,
            previousPacking: packingCheckpoint(draft, {
              includeDefaults: true,
            }),
          }))
        )
      return db.exportBackup()
    },
    {
      records,
      origin: extension.origin,
      openFirstOnly,
      packingPositions,
      withPreviousPacking,
    }
  )
  await fixture.close()
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    seeded
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-16T04:00:00Z'))
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    count * 3
  )
  if (openFirstOnly) {
    const rows = page.locator(
      `#sheet-body tr[data-selection-key^="${records[0].snapshot.orderId}/"]`
    )
    await expect(rows).toHaveCount(3)
    for (const row of await rows.all()) {
      await row.focus()
      await row.press('Control+Space')
    }
  }
  await page.locator('#prepare-orders').click()
  const view = page.locator('#packing-view')
  await expect(view).toBeVisible()
  await expect(view.locator('.preparation-group')).toHaveCount(
    (openFirstOnly ? 1 : count) * 2
  )
  return { page, view, baseline: seeded, original: await backup(extension) }
}

async function saved(view) {
  await expect(view.locator('#preparation-content')).not.toHaveAttribute(
    'disabled'
  )
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
}

async function travel(view, direction) {
  await view.getByRole('button', { name: direction, exact: true }).click()
  await saved(view)
}

const groups = (data) => data.preparations.map((draft) => draft.groups)

test('category typing and code roundtrips remain undoable after every autosave', async ({
  extension,
}) => {
  const { view, original } = await setup(extension)
  const group = view.locator('.preparation-group').first()
  const category = group.getByLabel('Chinese category', { exact: true })
  const base = group.getByLabel('Product code', { exact: true })
  const originalCode = original.preparations[0].groups[0].baseCode
  const originalCategory = original.preparations[0].groups[0].category
  await category.fill('陶瓷')
  await saved(view)
  await expect(
    view.getByRole('button', { name: 'Undo', exact: true })
  ).toBeEnabled()
  await base.fill('CE26109901')
  await saved(view)
  await base.fill(originalCode)
  await saved(view)
  await travel(view, 'Undo')
  await expect(base).toHaveValue('CE26109901')
  await expect(category).toHaveValue('陶瓷')
  await travel(view, 'Undo')
  await expect(base).toHaveValue(originalCode)
  await travel(view, 'Undo')
  await expect(category).toHaveValue(originalCategory)
  await expect(
    view.getByRole('button', { name: 'Undo', exact: true })
  ).toBeDisabled()
  await travel(view, 'Redo')
  await expect(category).toHaveValue('陶瓷')
  await travel(view, 'Redo')
  await expect(base).toHaveValue('CE26109901')
  await travel(view, 'Redo')
  await expect(base).toHaveValue(originalCode)
  const final = await backup(extension)
  expect(final.preparations[0].groups[0].id).toBe(
    original.preparations[0].groups[0].id
  )
  expect(
    final.preparations[0].groups[0].variants.map((variant) => variant.id)
  ).toEqual(
    original.preparations[0].groups[0].variants.map((variant) => variant.id)
  )
  expect(final.orders).toEqual(original.orders)
  expect(final.issuedCodes.map(({ code }) => code).sort()).toEqual(
    original.issuedCodes.map(({ code }) => code).sort()
  )
  expect(final.issuedCodes.some((entry) => entry.code === 'CE26109901')).toBe(
    false
  )
})

test('saved removal restores the same products and codes and can be redone', async ({
  extension,
}) => {
  const { page, view, original } = await setup(extension)
  const group = view.locator('.preparation-group').first()
  const action = group.getByRole('button', {
    name: 'Remove group',
    exact: true,
  })
  await action.focus()
  await action.click()
  const review = page.getByRole('dialog', {
    name: 'Remove from packing?',
    exact: true,
  })
  await review
    .getByRole('button', { name: 'Remove from packing', exact: true })
    .click()
  await saved(view)
  await expect(view.locator('.preparation-group')).toHaveCount(1)
  const removed = await backup(extension)
  await travel(view, 'Undo')
  await expect(view.locator('.preparation-group')).toHaveCount(2)
  expect(groups(await backup(extension))).toEqual(groups(original))
  await travel(view, 'Redo')
  await expect(view.locator('.preparation-group')).toHaveCount(1)
  const final = await backup(extension)
  expect(groups(final)).toEqual(groups(removed))
  expect(final.issuedCodes).toEqual(original.issuedCodes)
  expect(final.orders).toEqual(original.orders)
})

test('size handling and reset remain reversible after their confirmed saves', async ({
  extension,
}) => {
  const { page, view, original } = await setup(extension)
  const group = view.locator('.preparation-group').first()
  const mode = group.getByLabel('Size handling', { exact: true })
  const base = group.getByLabel('Product code', { exact: true })
  await mode.selectOption('none')
  await saved(view)
  await travel(view, 'Undo')
  await expect(mode).toHaveValue('automatic')
  await travel(view, 'Redo')
  await expect(mode).toHaveValue('none')
  await base.fill('CE26109901')
  await saved(view)
  const beforeReset = await backup(extension)
  await view
    .getByRole('button', { name: 'Reset order and codes', exact: true })
    .click()
  const review = page.getByRole('dialog', {
    name: 'Reset order and codes?',
    exact: true,
  })
  await review
    .getByRole('button', { name: 'Reset order and codes', exact: true })
    .click()
  await saved(view)
  await expect(base).toHaveValue(original.preparations[0].groups[0].baseCode)
  await expect(mode).toHaveValue('automatic')
  const reset = await backup(extension)
  await travel(view, 'Undo')
  expect(groups(await backup(extension))).toEqual(groups(beforeReset))
  await travel(view, 'Redo')
  const final = await backup(extension)
  expect(groups(final)).toEqual(groups(reset))
  expect(final.issuedCodes.map(({ code }) => code).sort()).toEqual(
    reset.issuedCodes.map(({ code }) => code).sort()
  )
  expect(final.orders).toEqual(original.orders)
})

test('removing the final group filters the order picker and undo restores that order and its scoped rows', async ({
  extension,
}) => {
  const { page, view, original, baseline } = await setup(extension, 2)
  const firstId = original.preparations[0].orderId
  const secondId = original.preparations[1].orderId
  const picker = view.getByLabel('Show packing orders', { exact: true })
  await picker.selectOption(firstId)
  for (let groups = 2; groups > 0; groups--) {
    const remove = view
      .getByRole('button', { name: 'Remove group', exact: true })
      .first()
    await remove.focus()
    await remove.click()
    const review = page.getByRole('dialog', {
      name: 'Remove from packing?',
      exact: true,
    })
    await review
      .getByRole('button', { name: 'Remove from packing', exact: true })
      .click()
    await saved(view)
  }
  await expect(picker.locator(`option[value="${firstId}"]`)).toHaveCount(0)
  await expect(picker).toHaveValue(secondId)
  await expect(view.locator('.packing-title')).toContainText(
    '1 orders · 3 products'
  )
  await expect(view.locator('.packing-order-section')).toHaveCount(1)
  await travel(view, 'Undo')
  await expect(picker.locator(`option[value="${firstId}"]`)).toHaveCount(1)
  await expect(picker).toHaveValue(firstId)
  await expect(view.locator('.preparation-group')).toHaveCount(1)
  await travel(view, 'Redo')
  await expect(picker.locator(`option[value="${firstId}"]`)).toHaveCount(0)
  await expect(picker).toHaveValue(secondId)
  const after = await backup(extension)
  expect(
    after.preparations.find((draft) => draft.orderId === firstId).groups
  ).toEqual(
    baseline.preparations.find((draft) => draft.orderId === firstId).groups
  )
  expect(
    after.preparations.find((draft) => draft.orderId === secondId).groups
  ).toEqual(
    original.preparations.find((draft) => draft.orderId === secondId).groups
  )
})

test('removal reviews and discards saved session edits while retaining kept siblings and undo restores the complete edit', async ({
  extension,
}) => {
  const { page, view, original, baseline } = await setup(extension)
  const groupId = original.preparations[0].groups[0].id
  const group = view.locator(`[data-group-id="${groupId}"]`)
  await group.getByLabel('Product code', { exact: true }).fill('CE26109901')
  await saved(view)
  await group.getByLabel('Chinese category', { exact: true }).fill('陶瓷')
  await saved(view)
  await group
    .locator('tr[data-variant-id]')
    .nth(1)
    .getByLabel('Material', { exact: true })
    .fill('Cotton')
  await saved(view)
  const edited = await backup(extension)
  const remove = group
    .getByRole('button', { name: 'Remove product', exact: true })
    .first()
  await remove.focus()
  await remove.click()
  const review = page.getByRole('dialog', {
    name: 'Remove from packing?',
    exact: true,
  })
  await expect(review.locator('.packing-review-item')).toHaveCount(2)
  await expect(review).toContainText('CE26109901')
  await expect(review).toContainText(
    original.preparations[0].groups[0].baseCode
  )
  await expect(review).toContainText('This product stays in packing')
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(groups(await backup(extension))).toEqual(groups(edited))
  await remove.focus()
  await remove.click()
  await review
    .getByRole('button', { name: 'Remove from packing', exact: true })
    .click()
  await saved(view)
  await expect(group.locator('tr[data-variant-id]')).toHaveCount(1)
  const removed = await backup(extension)
  const savedGroup = removed.preparations[0].groups.find(
    (entry) => entry.id === groupId
  )
  expect(savedGroup.baseCode).toBe(original.preparations[0].groups[0].baseCode)
  expect(savedGroup.category).toBe(original.preparations[0].groups[0].category)
  expect(savedGroup.variants[1].material).toBe('Cotton')
  expect(savedGroup.variants[0]).toEqual(
    baseline.preparations[0].groups[0].variants[0]
  )
  await travel(view, 'Undo')
  await expect(group.locator('tr[data-variant-id]')).toHaveCount(2)
  expect(groups(await backup(extension))).toEqual(groups(edited))
  await travel(view, 'Redo')
  await expect(group.locator('tr[data-variant-id]')).toHaveCount(1)
  expect(groups(await backup(extension))).toEqual(groups(removed))
})

test('removal resolves a restored-code collision against its candidate and records one undoable action', async ({
  extension,
}) => {
  const { page, view, original } = await setup(extension)
  const [originalA, originalB] = original.preparations[0].groups
  const groupA = view.locator(`[data-group-id="${originalA.id}"]`)
  const groupB = view.locator(`[data-group-id="${originalB.id}"]`)
  await groupA.getByLabel('Product code', { exact: true }).fill('CE26100105')
  await saved(view)
  await groupA.getByLabel('Chinese category', { exact: true }).fill('陶瓷')
  await saved(view)
  const beforeReuse = await backup(extension)
  await groupB
    .getByLabel('Product code', { exact: true })
    .fill(originalA.baseCode)
  await saved(view)
  const beforeRemoval = await backup(extension)
  const remove = groupA.getByRole('button', {
    name: 'Remove group',
    exact: true,
  })
  const review = page.getByRole('dialog', {
    name: 'Remove from packing?',
    exact: true,
  })
  const conflict = page.getByRole('dialog', {
    name: 'Resolve code conflict',
    exact: true,
  })
  async function requestRemoval() {
    await remove.focus()
    await remove.click()
    await review
      .getByRole('button', { name: 'Remove from packing', exact: true })
      .click()
    await expect(conflict).toBeVisible()
  }
  await requestRemoval()
  await expect(
    conflict.getByRole('button', { name: 'Keep saved version', exact: true })
  ).toHaveCount(0)
  await expect(
    conflict
      .locator('.conflict-owner-card')
      .getByLabel('Product code', { exact: true })
  ).toHaveValue(originalA.baseCode)
  const correction = conflict
    .locator('.conflict-edit-card')
    .getByLabel('Product code', { exact: true })
  await expect(correction).toHaveValue(originalA.baseCode)
  await expect(conflict).toContainText(
    'Removing these products would restore a code now assigned elsewhere'
  )
  expect((await backup(extension)).preparations).toEqual(
    beforeRemoval.preparations
  )
  await conflict
    .getByRole('button', { name: 'Cancel removal', exact: true })
    .click()
  await expect(conflict).toBeHidden()
  await expect(groupA).toHaveCount(1)
  expect((await backup(extension)).preparations).toEqual(
    beforeRemoval.preparations
  )
  await requestRemoval()
  await correction.fill('CE26100106')
  await conflict
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(conflict).toBeHidden()
  await saved(view)
  await expect(groupA).toHaveCount(0)
  await expect(view.locator('.packing-title')).toContainText(
    '1 orders · 1 products'
  )
  const removed = await backup(extension)
  const restoredA = removed.preparations[0].groups.find(
    (group) => group.id === originalA.id
  )
  expect(restoredA.baseCode).toBe('CE26100106')
  expect(restoredA.category).toBe(originalA.category)
  expect(
    removed.preparations[0].groups.find((group) => group.id === originalB.id)
  ).toEqual(
    beforeRemoval.preparations[0].groups.find(
      (group) => group.id === originalB.id
    )
  )
  await travel(view, 'Undo')
  await expect(groupA).toHaveCount(1)
  expect(groups(await backup(extension))).toEqual(groups(beforeRemoval))
  await travel(view, 'Redo')
  await expect(groupA).toHaveCount(0)
  expect(groups(await backup(extension))).toEqual(groups(removed))
  await travel(view, 'Undo')
  await travel(view, 'Undo')
  expect(groups(await backup(extension))).toEqual(groups(beforeReuse))
  expect((await backup(extension)).orders).toEqual(original.orders)
})

test('an owning product revealed from a conflict retains its saved baseline when later removed', async ({
  extension,
}) => {
  const { page, view, original } = await setup(extension, 2, {
    openFirstOnly: true,
    sameSeller: true,
  })
  const owner = original.preparations.find(
    (draft) => draft.orderId === '7300000000000000001'
  )
  const owningGroup = owner.groups[0]
  await view
    .getByLabel('Product code', { exact: true })
    .first()
    .fill(owningGroup.baseCode)
  await expect(view.locator('.preparation-save-status')).toContainText(
    'Code conflict'
  )
  await view.getByRole('button', { name: 'Resolve', exact: true }).click()
  const conflict = page.getByRole('dialog', {
    name: 'Resolve code conflict',
    exact: true,
  })
  await conflict
    .getByRole('button', { name: 'Show owning product', exact: true })
    .click()
  await expect(conflict).toBeHidden()
  const group = view.locator(`[data-group-id="${owningGroup.id}"]`)
  await expect(group).toBeVisible()
  // Resolve the original pending edit without reopening the preparation session.
  await view
    .locator('.preparation-actions')
    .getByRole('button', { name: 'Reload saved version', exact: true })
    .click()
  await saved(view)
  await group.getByLabel('Chinese category', { exact: true }).fill('陶瓷')
  await saved(view)
  const remove = group.getByRole('button', {
    name: 'Remove group',
    exact: true,
  })
  await remove.focus()
  await remove.click()
  const review = page.getByRole('dialog', {
    name: 'Remove from packing?',
    exact: true,
  })
  await expect(review).toContainText(
    'Saved values from before this preparation session will be restored.'
  )
  await review
    .getByRole('button', { name: 'Remove from packing', exact: true })
    .click()
  await saved(view)
  await expect(group).toHaveCount(0)
  const final = await backup(extension)
  expect(
    final.preparations.find((draft) => draft.orderId === owner.orderId).groups
  ).toEqual(owner.groups)
  expect(final.orders).toEqual(original.orders)
})

for (const action of ['Reset order and codes', 'Restore previous packing'])
  test(`${action} and its undo preserve products excluded from this session`, async ({
    extension,
  }) => {
    const { page, view, original } = await setup(extension, 1, {
      withPreviousPacking: true,
    })
    const originalGroup = original.preparations[0].groups[0]
    const group = view.locator(`[data-group-id="${originalGroup.id}"]`)
    const keptVariant = originalGroup.variants[1]
    const removedVariant = originalGroup.variants[0]
    const removedRow = group.locator(`[data-variant-id="${removedVariant.id}"]`)
    const remove = removedRow.getByRole('button', {
      name: 'Remove product',
      exact: true,
    })
    await remove.focus()
    await remove.click()
    await page
      .getByRole('dialog', { name: 'Remove from packing?', exact: true })
      .getByRole('button', { name: 'Remove from packing', exact: true })
      .click()
    await saved(view)
    await expect(removedRow).toHaveCount(0)
    await expect(group.locator('tr[data-variant-id]')).toHaveCount(1)
    const base = group.getByLabel('Product code', { exact: true })
    await base.fill('CE26109901')
    await saved(view)
    const edited = await backup(extension)
    await view.getByRole('button', { name: action, exact: true }).click()
    await page
      .getByRole('dialog', { name: `${action}?`, exact: true })
      .getByRole('button', { name: action, exact: true })
      .click()
    await saved(view)
    await expect(base).toHaveValue(originalGroup.baseCode)
    await expect(removedRow).toHaveCount(0)
    await expect(
      group.locator(`[data-variant-id="${keptVariant.id}"]`)
    ).toHaveCount(1)
    await expect(view.locator('.packing-title')).toContainText(
      '1 orders · 2 products'
    )
    const restored = await backup(extension)
    await travel(view, 'Undo')
    await expect(base).toHaveValue('CE26109901')
    await expect(removedRow).toHaveCount(0)
    expect(groups(await backup(extension))).toEqual(groups(edited))
    await travel(view, 'Redo')
    await expect(base).toHaveValue(originalGroup.baseCode)
    await expect(removedRow).toHaveCount(0)
    expect(groups(await backup(extension))).toEqual(groups(restored))
    // Undo all three operations: restore, text edit, and the original removal.
    await travel(view, 'Undo')
    await travel(view, 'Undo')
    await expect(removedRow).toHaveCount(0)
    await travel(view, 'Undo')
    await expect(removedRow).toHaveCount(1)
    await expect(view.locator('.packing-title')).toContainText(
      '1 orders · 3 products'
    )
  })

test('multi-order grouping is one undo step with stable reservation owners', async ({
  extension,
}) => {
  const { page, view, original } = await setup(extension, 2)
  await view
    .getByRole('button', { name: 'Grouping tools', exact: true })
    .click()
  await view
    .getByRole('button', { name: 'Share one barcode', exact: true })
    .click()
  const review = page.getByRole('dialog', {
    name: 'Share one barcode?',
    exact: true,
  })
  await review
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await saved(view)
  const grouped = await backup(extension)
  expect(
    grouped.preparations.map((draft) => draft.groups[0].variants.length)
  ).toEqual([1, 1])
  await travel(view, 'Undo')
  expect(groups(await backup(extension))).toEqual(groups(original))
  await expect(
    view.getByRole('button', { name: 'Undo', exact: true })
  ).toBeDisabled()
  await travel(view, 'Redo')
  const final = await backup(extension)
  expect(groups(final)).toEqual(groups(grouped))
  expect(final.issuedCodes).toEqual(grouped.issuedCodes)
  expect(final.orders).toEqual(original.orders)
})

test('saved arrangement undo and redo restore every affected order together', async ({
  extension,
}) => {
  const { page, view, original } = await setup(extension, 2, {
    packingPositions: [0, 1],
  })
  const orderIds = () =>
    view
      .locator('.packing-order-section')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.packingOrder))
  const savedOrderIds = (data) =>
    [...data.preparations]
      .sort((left, right) => left.packingPosition - right.packingPosition)
      .map((draft) => draft.orderId)
  const before = await orderIds()
  expect(before).toEqual(['7300000000000000000', '7300000000000000001'])
  await view
    .getByRole('button', { name: 'Arrange packing', exact: true })
    .click()
  await view
    .locator('.packing-arrange')
    .getByRole('button', { name: 'Store', exact: true })
    .click()
  await saved(view)
  const after = await orderIds()
  expect(after).toEqual([...before].reverse())
  expect(savedOrderIds(await backup(extension))).toEqual(after)
  await travel(view, 'Undo')
  await expect.poll(orderIds).toEqual(before)
  const undone = await backup(extension)
  expect(savedOrderIds(undone)).toEqual(before)
  await holdPreparationWrites(page)
  try {
    await view.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => window.preparationSaveStarted))
      .toBe(true)
    await expect(view.locator('#preparation-content')).toHaveAttribute(
      'disabled',
      ''
    )
    await expect(
      view.getByLabel('Product code', { exact: true }).first()
    ).toBeDisabled()
    await expect(view.locator('.preparation-save-status')).toHaveText('Saving…')
    expect(await orderIds()).toEqual(before)
  } finally {
    await page.evaluate(() => {
      window.holdPreparationSave = false
    })
  }
  await saved(view)
  await expect.poll(orderIds).toEqual(after)
  const final = await backup(extension)
  expect(savedOrderIds(final)).toEqual(after)
  for (const draft of final.preparations)
    expect(draft.revision).toBeGreaterThan(
      undone.preparations.find((entry) => entry.orderId === draft.orderId)
        .revision
    )
  expect(groups(final)).toEqual(groups(original))
  expect(final.issuedCodes).toEqual(original.issuedCodes)
  expect(final.orders).toEqual(original.orders)
})

test('a saved arrangement affecting only one hidden order remains undoable and redoable', async ({
  extension,
}) => {
  const { view, original } = await setup(extension, 2, { openFirstOnly: true })
  const visibleId = '7300000000000000000'
  const hiddenId = '7300000000000000001'
  const getOrder = (data, id) =>
    data.preparations.find((draft) => draft.orderId === id)
  expect(getOrder(original, visibleId).packingPosition).toBe(0)
  expect(getOrder(original, hiddenId).packingPosition).toBeUndefined()
  await expect(view.locator('.packing-order-section')).toHaveCount(1)
  await view
    .getByRole('button', { name: 'Arrange packing', exact: true })
    .click()
  await view
    .locator('.packing-arrange')
    .getByRole('button', { name: 'Store', exact: true })
    .click()
  await saved(view)
  const arranged = await backup(extension)
  expect(getOrder(arranged, visibleId)).toEqual(getOrder(original, visibleId))
  expect(getOrder(arranged, hiddenId).packingPosition).toBe(1)
  await travel(view, 'Undo')
  const undone = await backup(extension)
  expect(getOrder(undone, hiddenId).packingPosition).toBeUndefined()
  expect(getOrder(undone, hiddenId).revision).toBeGreaterThan(
    getOrder(arranged, hiddenId).revision
  )
  expect(getOrder(undone, visibleId)).toEqual(getOrder(original, visibleId))
  await expect(
    view.getByRole('button', { name: 'Undo', exact: true })
  ).toBeDisabled()
  await travel(view, 'Redo')
  const redone = await backup(extension)
  expect(getOrder(redone, hiddenId).packingPosition).toBe(1)
  expect(getOrder(redone, hiddenId).revision).toBeGreaterThan(
    getOrder(undone, hiddenId).revision
  )
  expect(getOrder(redone, visibleId)).toEqual(getOrder(original, visibleId))
  await expect(view.locator('.packing-order-section')).toHaveCount(1)
  await expect(view.locator('.packing-order-section')).toHaveAttribute(
    'data-packing-order',
    visibleId
  )
  expect(groups(redone)).toEqual(groups(original))
  expect(redone.issuedCodes).toEqual(original.issuedCodes)
  expect(redone.orders).toEqual(original.orders)
})

test('undo after an external edit is rejected without overwriting the other tab', async ({
  extension,
}) => {
  const { page, view } = await setup(extension)
  const category = view
    .locator('.preparation-group')
    .first()
    .getByLabel('Chinese category', { exact: true })
  await category.fill('陶瓷')
  await saved(view)
  const local = await backup(extension)
  const external = structuredClone(local)
  external.preparations[0].groups[0].category = '外部保存'
  external.preparations[0].groups[0].naming.category = {
    source: 'manual',
    value: '外部保存',
  }
  external.preparations[0].updatedAt = '2099-01-01T00:00:00Z'
  const response = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    external
  )
  expect(response.ok, response.error).toBe(true)
  const acceptedExternal = await backup(extension)
  await view.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(view.locator('.preparation-save-status')).toContainText(
    'Not saved'
  )
  await expect(view).toContainText('Preparation changed in another tab')
  expect((await backup(extension)).preparations).toEqual(
    acceptedExternal.preparations
  )
  await view
    .locator('.error-notice')
    .getByRole('button', { name: 'Reload saved version', exact: true })
    .click()
  await expect(category).toHaveValue('外部保存')
  await expect(
    view.getByRole('button', { name: 'Undo', exact: true })
  ).toBeDisabled()
  await expect(page.locator('#packing-view')).toBeVisible()
})

test('removal can correct a different owning order and undo both the correction and scope together', async ({
  extension,
}) => {
  const { page, view, original } = await setup(extension, 2, {
    sameSeller: true,
  })
  const [targetOrder, ownerOrder] = original.preparations
  const target = targetOrder.groups[0],
    owner = ownerOrder.groups[0]
  const targetGroup = view.locator(
    `[data-packing-order="${targetOrder.orderId}"] [data-group-id="${target.id}"]`
  )
  const ownerGroup = view.locator(
    `[data-packing-order="${ownerOrder.orderId}"] [data-group-id="${owner.id}"]`
  )
  await targetGroup
    .getByLabel('Product code', { exact: true })
    .fill('CE26109999')
  await saved(view)
  await ownerGroup
    .getByLabel('Product code', { exact: true })
    .fill(target.baseCode)
  await saved(view)
  const beforeRemoval = await backup(extension)
  await targetGroup
    .getByRole('button', { name: 'Remove group', exact: true })
    .focus()
  await targetGroup
    .getByRole('button', { name: 'Remove group', exact: true })
    .click()
  await page
    .getByRole('dialog', { name: 'Remove from packing?', exact: true })
    .getByRole('button', { name: 'Remove from packing', exact: true })
    .click()
  const conflict = page.getByRole('dialog', {
    name: 'Resolve code conflict',
    exact: true,
  })
  await conflict
    .locator('.conflict-owner-card')
    .getByLabel('Product code', { exact: true })
    .fill(owner.baseCode)
  expect((await backup(extension)).preparations).toEqual(
    beforeRemoval.preparations
  )
  await conflict
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(conflict).toBeHidden()
  await expect(targetGroup).toHaveCount(0)
  const removed = await backup(extension)
  expect(
    removed.preparations
      .find((prep) => prep.orderId === targetOrder.orderId)
      .groups.find((group) => group.id === target.id).baseCode
  ).toBe(target.baseCode)
  expect(
    removed.preparations
      .find((prep) => prep.orderId === ownerOrder.orderId)
      .groups.find((group) => group.id === owner.id).baseCode
  ).toBe(owner.baseCode)
  await travel(view, 'Undo')
  await expect(targetGroup).toHaveCount(1)
  expect(groups(await backup(extension))).toEqual(groups(beforeRemoval))
  await travel(view, 'Redo')
  await expect(targetGroup).toHaveCount(0)
  expect(groups(await backup(extension))).toEqual(groups(removed))
})
