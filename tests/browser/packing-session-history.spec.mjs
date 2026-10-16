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
  { openFirstOnly = false, packingPositions = [] } = {}
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
    async ({ records, origin, openFirstOnly, packingPositions }) => {
      const { openDatabase } = await import(`${origin}/src/database.js`)
      const { createPreparation } = await import(
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
      await db.savePreparations(
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
      return db.exportBackup()
    },
    { records, origin: extension.origin, openFirstOnly, packingPositions }
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
  return { page, view, original: await backup(extension) }
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
  expect(final.issuedCodes).toEqual(
    expect.arrayContaining(original.issuedCodes)
  )
  expect(final.issuedCodes.some((entry) => entry.code === 'CE26109901')).toBe(
    true
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
  expect(final.issuedCodes).toEqual(beforeReset.issuedCodes)
  expect(final.orders).toEqual(original.orders)
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
