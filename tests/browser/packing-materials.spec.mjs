import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function openPacking(extension) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const record = records[0]
  record.snapshot.sellerMemberLogin = 'synthetic-materials'
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = index < 2 ? '合成杯具' : '合成收纳盘'
    item.skuProperties = [
      { label: '颜色', value: index === 0 ? '白色' : '灰色' },
      { label: '材质', value: ['玻璃', '不锈钢', '塑料'][index] },
    ]
    item.description = [
      item.title,
      ...item.skuProperties.map(({ label, value }) => `${label}：${value}`),
    ].join('\n')
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
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  const displayedMaterials = page.locator(
    '#sheet-body [data-attribute="material"] dd'
  )
  await expect(displayedMaterials).toHaveText([
    'Glass',
    'Stainless steel',
    'Plastic',
  ])
  await page.locator('#select-rows').click()
  await page.locator('#prepare-orders').click()
  const review = page.getByRole('dialog', { name: 'Assign product codes?' })
  await expect(review).toBeVisible()
  await expect(page.locator('.packing-progress')).toContainText(
    'Review changes to continue'
  )
  await expect(page.locator('.packing-progress')).toContainText('Materials 3')
  await expect(page.locator('.packing-progress progress')).not.toHaveAttribute(
    'value'
  )
  await review
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const view = page.locator('#packing-view')
  await expect(view).toBeVisible()
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  await expect(page.locator('.packing-progress')).toHaveCount(0)
  return { page, view, record }
}

async function saved(view) {
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
}

test('materials fill automatically, edit per product or apply by group/order, and persist including a manual clear', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  let materials = view
    .locator('.variants')
    .getByRole('textbox', { name: 'Material', exact: true })
  await expect(materials).toHaveCount(3)
  await expect(materials.nth(0)).toHaveValue('Glass')
  await expect(materials.nth(1)).toHaveValue('Stainless steel')
  await expect(materials.nth(2)).toHaveValue('Plastic')
  await expect(
    view.locator('.variant-photos .preparation-photo img').first()
  ).toHaveCSS('width', '74px')
  await materials.nth(0).fill('Custom ceramic')
  await saved(view)
  const firstGroup = view.locator('.preparation-group').first()
  await firstGroup
    .getByLabel('Material for group', { exact: true })
    .fill('Cotton')
  await firstGroup
    .getByRole('button', { name: 'Apply material to group', exact: true })
    .click()
  await saved(view)
  await expect(materials.nth(0)).toHaveValue('Cotton')
  await expect(materials.nth(1)).toHaveValue('Cotton')
  await expect(materials.nth(2)).toHaveValue('Plastic')
  await view.getByLabel('Material for order', { exact: true }).fill('Aluminum')
  await view
    .getByRole('button', { name: 'Apply material to order', exact: true })
    .click()
  await saved(view)
  await expect(materials.nth(2)).toHaveValue('Aluminium')
  await materials.nth(0).fill('')
  await saved(view)
  await page.keyboard.press('Escape')
  await expect(view).toBeHidden()
  const productRows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(
    productRows.first().locator('[data-attribute="material"]')
  ).toHaveCount(0)
  await expect(
    productRows.nth(1).locator('[data-attribute="material"] dd')
  ).toHaveText('Aluminium')
  await page.locator('[data-language="es"]').click()
  await expect(
    productRows.nth(1).locator('[data-attribute="material"] dd')
  ).toHaveText('Aluminio')
  await page.locator('[data-language="en"]').click()
  await page.reload()
  await page.locator('#prepare-orders').click()
  await expect(view).toBeVisible()
  await saved(view)
  materials = view
    .locator('.variants')
    .getByRole('textbox', { name: 'Material', exact: true })
  await expect(materials.nth(0)).toHaveValue('')
  await expect(materials.nth(1)).toHaveValue('Aluminium')
  const result = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(result.ok).toBe(true)
  const variants = result.data.preparations[0].groups.flatMap(
    (group) => group.variants
  )
  expect(variants[0].materialSource).toBe('manual')
  expect(variants[0].material).toBe('')
  expect(variants[1].materialSource).toBe('manual')
  expect(variants[1].material).toBe('Aluminum')
})

test('packing product details activate by double-click and Enter without changing selection or interfering with editors', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const row = view.locator('.variants tbody tr').first()
  const scope = view.locator('.preparation-copy-scope')
  await expect(scope).toHaveText('3 selected products · 1 orders')
  await row.locator('.variant-price dd').dblclick()
  const dialog = page.getByRole('dialog', {
    name: 'Original product details',
    exact: true,
  })
  await expect(dialog).toBeVisible()
  await expect(scope).toHaveText('3 selected products · 1 orders')
  await dialog.getByRole('button', { name: 'Close product details' }).click()
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await expect(scope).toHaveText('3 selected products · 1 orders')
  await dialog.getByRole('button', { name: 'Close product details' }).click()
  await row.getByRole('textbox', { name: 'Material', exact: true }).dblclick()
  await expect(dialog).toHaveCount(0)
  await expect(scope).toHaveText('3 selected products · 1 orders')
})

test('packing code segments use independent accessible helpers and stay apart when endings grow', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const row = view.locator('.variants tbody tr').first()
  await expect(row.locator('.code-part-label:visible')).toHaveCount(0)
  const variant = row.locator('.code-part-variantSuffix input')
  const size = row.locator('.code-part-sizeSuffix input')
  await variant.fill('ABCDEFGH')
  await size.fill('XXXXL')
  await page.setViewportSize({ width: 800, height: 900 })
  const boxes = await row.locator('.variant-code-design').evaluate((element) =>
    [...element.children].map((part) => {
      const rect = part.getBoundingClientRect()
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      }
    })
  )
  for (let a = 0; a < boxes.length; a++)
    for (let b = a + 1; b < boxes.length; b++)
      expect(
        boxes[a].right <= boxes[b].left ||
          boxes[b].right <= boxes[a].left ||
          boxes[a].bottom <= boxes[b].top ||
          boxes[b].bottom <= boxes[a].top
      ).toBe(true)
  await expect(variant).toHaveAccessibleName(/^Variant code /)
  await expect(size).toHaveAccessibleName(/^Size code /)
})
