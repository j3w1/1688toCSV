import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  assignSelectedPurchaseCodes,
  loadedSourceContainer,
  openContainerOutput,
  libraryBackup,
} from './smart-workspace-helpers.mjs'

async function setup(extension) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerName = 'Synthetic organizing store'
  record.snapshot.sellerMemberLogin = 'synthetic-organizing'
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = index < 2 ? '合成装饰品' : '合成玻璃罐'
    item.productNumber = index < 2 ? 'DECOR' : 'JAR'
    item.skuProperties = [
      { label: '颜色', value: index === 0 ? '红色' : '白色' },
    ]
    item.description = `${item.title}\n颜色：${item.skuProperties[0].value}`
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
  await rows.first().focus()
  await page.keyboard.press('Control+a')
  await assignSelectedPurchaseCodes(page)
  const id = await loadedSourceContainer(extension, [
      { accountId: 'local', orderId: record.snapshot.orderId },
    ]),
    view = await openContainerOutput(page, id)
  return { page, view, record, id }
}

test('Packing removes Organize and authored membership while explicit output selection leaves the whole container unchanged', async ({
  extension,
}) => {
  const { page, view, id } = await setup(extension),
    before = await libraryBackup(extension),
    manifest = await extension.inspector.evaluate(
      async (id) => (await window.testRepository).getContainerManifest({ id }),
      id
    )
  await expect(
    view.locator(
      '.reorder-handle,.packing-remove-button,.variant-actions,.preparation-group,[data-action="organize-packing"],input[data-grid-column]'
    )
  ).toHaveCount(0)
  const rows = view.locator('tr[data-container-row]')
  await expect(rows).toHaveCount(3)
  await rows.first().getByRole('checkbox').check()
  await view.locator('[data-view="loading"]').click()
  await view.locator('[data-view="packing-list"]').click()
  await expect(rows.first().getByRole('checkbox')).toBeChecked()
  const after = await libraryBackup(extension),
    current = await extension.inspector.evaluate(
      async (id) => (await window.testRepository).getContainerManifest({ id }),
      id
    )
  expect(current).toEqual(manifest)
  expect(after.preparations).toEqual(before.preparations)
  expect(after.issuedCodes).toEqual(before.issuedCodes)
  expect(after.orders).toEqual(before.orders)
})

test('Loading uses physical selection and compound Undo/Redo without rearranging product codes or source evidence', async ({
  extension,
}) => {
  const { page, view, id } = await setup(extension),
    before = await libraryBackup(extension)
  await view.locator('[data-view="loading"]').click()
  await view.locator('[data-action="expand-container-order"]').first().click()
  const row = view.locator('tr[data-container-row]').first(),
    unitId = await row.getAttribute('data-container-row')
  await row
    .locator('[data-action="set-carton-loading"][data-state="left-behind"]')
    .click()
  const state = () =>
    extension.inspector.evaluate(
      async ({ id, unitId }) =>
        (
          await (await window.testRepository).getContainerView({ id })
        ).cartons.find((unit) => unit.id === unitId).state,
      { id, unitId }
    )
  await expect.poll(state).toBe('left-behind')
  await view.locator('[data-action="undo-container-loading"]').click()
  await expect.poll(state).toBe('loaded')
  await view.locator('[data-action="redo-container-loading"]').click()
  await expect.poll(state).toBe('left-behind')
  const after = await libraryBackup(extension)
  expect(after.preparations).toEqual(before.preparations)
  expect(after.issuedCodes).toEqual(before.issuedCodes)
  expect(after.orders).toEqual(before.orders)
})

test('copy controls retain exact inset square photo geometry in Orders and read-only Packing details', async ({
  extension,
}) => {
  const { page, view } = await setup(extension)
  await view.locator('tr[data-container-row]').first().click()
  const details = page.getByRole('dialog', {
    name: 'Original product details',
    exact: true,
  })
  await expect(details).toBeVisible()
  await expect(details.locator('[data-action="edit-in-orders"]')).toBeVisible()
  await expect(
    details.getByRole('button', { name: 'Operations', exact: true })
  ).toHaveCount(0)
  await details.getByRole('button', { name: 'Close product details' }).click()
  const tile = view
      .locator('.container-product-photo .photo-copy-tile')
      .first(),
    source = tile.locator('.photo-copy-source'),
    image = source.locator('img')
  await expect(image).toBeVisible()
  await tile.hover()
  const frame = await source.boundingBox(),
    picture = await image.boundingBox(),
    copy = await tile.locator('.photo-copy-button').boundingBox()
  expect(Math.abs(frame.width - frame.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(picture.width - picture.height)).toBeLessThanOrEqual(1)
  expect(frame.width - picture.width).toBeLessThanOrEqual(2)
  expect(copy.y - frame.y).toBeCloseTo(2, 0)
  expect(frame.x + frame.width - copy.x - copy.width).toBeCloseTo(2, 0)
  await page.locator('#view-orders').click()
  const orderTile = page.locator('#sheet-body .photo-copy-tile').first()
  await expect(orderTile.locator('img')).toBeVisible()
  const sourceFrame = await orderTile
      .locator('.photo-copy-source')
      .boundingBox(),
    original = await orderTile.locator('img').boundingBox()
  expect(Math.abs(sourceFrame.width - sourceFrame.height)).toBeLessThanOrEqual(
    1
  )
  expect(Math.abs(original.width - original.height)).toBeLessThanOrEqual(1)
})
