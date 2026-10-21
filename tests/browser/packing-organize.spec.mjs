import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

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
  await expect(view.locator('.preparation-group')).toHaveCount(2)
  return { page, view }
}

test('Organize unmounts normal product tables, keeps export selection and restores compact packing', async ({
  extension,
}) => {
  const { page, view } = await setup(extension)
  const selection = await view.locator('.preparation-copy-scope').innerText()
  const before = await view
    .locator('.group-code-editor')
    .evaluateAll((nodes) => nodes.map((node) => node.value))
  await expect(
    view.locator('.reorder-handle, .packing-remove-button, .variant-actions')
  ).toHaveCount(0)
  await expect(
    view.locator('.variants tbody tr').first().locator(':scope > td')
  ).toHaveCount(4)
  await view.getByRole('button', { name: 'Organize', exact: true }).click()
  await expect(view.locator('.packing-organize-group')).toHaveCount(2)
  await expect(
    view.locator(
      '.variants, .variant-scroll, .group-code-editor, .variant-carton-columns'
    )
  ).toHaveCount(0)
  await expect(
    view.getByRole('button', { name: 'Export packing list', exact: true })
  ).toHaveCount(0)
  await expect(
    view.getByRole('button', { name: 'Remove from packing', exact: true })
  ).toBeDisabled()
  await view.getByRole('button', { name: 'Select all', exact: true }).click()
  await expect(view.locator('.packing-organize-count')).toHaveText(
    '2 selected · 2 groups'
  )
  await view.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(view.locator('.preparation-group')).toHaveCount(2)
  await expect(view.locator('.preparation-copy-scope')).toHaveText(selection)
  expect(
    await view
      .locator('.group-code-editor')
      .evaluateAll((nodes) => nodes.map((node) => node.value))
  ).toEqual(before)
  await view.getByRole('button', { name: 'Organize', exact: true }).click()
  await expect(view.locator('.packing-organize-count')).toHaveText(
    '2 selected · 2 groups'
  )
  await page.keyboard.press('Escape')
  await expect(view.locator('.preparation-group')).toHaveCount(2)
})

test('group and product movement persists, visual group choice remains scoped and Undo restores the batch', async ({
  extension,
}) => {
  const { page, view } = await setup(extension)
  const before = await view
    .locator('.group-code-editor')
    .evaluateAll((nodes) => nodes.map((node) => node.value))
  await view.getByRole('button', { name: 'Organize', exact: true }).click()
  const cards = view.locator('.packing-organize-group')
  await cards.first().locator('input[type="checkbox"]').check()
  await view.getByRole('button', { name: 'Move down', exact: true }).click()
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  await expect(cards.first().locator('.ce-code')).toHaveText(before[1])
  await view.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(cards.first().locator('.ce-code')).toHaveText(before[0])
  await cards
    .first()
    .getByRole('button', { name: 'Products', exact: true })
    .click()
  await expect(view.locator('.packing-organize-product')).toHaveCount(2)
  await expect(view.locator('select, .variants')).toHaveCount(0)
  const codes = await view
    .locator('.packing-organize-product .ce-code')
    .allTextContents()
  await view
    .locator('.packing-organize-product .reorder-handle')
    .first()
    .press('ArrowDown')
  await expect(
    view.locator('.packing-organize-product .ce-code').first()
  ).toHaveText(codes[1])
  await view.getByRole('button', { name: 'Choose group', exact: true }).click()
  const chooser = view.locator('.packing-organize-picker:popover-open')
  await expect(
    chooser.getByRole('searchbox', { name: 'Find group or store' })
  ).toBeVisible()
  await chooser.getByRole('searchbox').fill(before[1])
  await expect(chooser.locator('.packing-organize-group-choice')).toHaveCount(1)
  await chooser.locator('.packing-organize-group-choice').click()
  await expect(view.locator('.packing-organize-product')).toHaveCount(1)
  await view.getByRole('button', { name: 'Done', exact: true }).click()
  await page.reload()
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  await expect(view).toBeVisible()
  await expect(
    view.locator('.variants').first().locator('tr[data-variant-id]').first()
  ).toContainText(codes[1])
})

test('copy controls stay inset at the visible square photo corner in Orders and packing', async ({
  extension,
}) => {
  const { view } = await setup(extension)
  const tile = view.locator('.variant-photos > .photo-copy-tile').first()
  const source = tile.locator('.photo-copy-source')
  const image = source.locator('img')
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
})
