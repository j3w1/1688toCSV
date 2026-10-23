import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  assignSelectedPurchaseCodes,
  editOrderProduct,
  closeOrderProduct,
  libraryBackup,
} from './smart-workspace-helpers.mjs'

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
  await assignSelectedPurchaseCodes(page)
  return { page, view: page.locator('#orders-view'), record }
}

async function editMaterial(page, index, value) {
  const editor = await editOrderProduct(page, index, { Material: value })
  await closeOrderProduct(editor)
}

test('Orders materials retain automatic source suggestions and deliberate edits including a manual clear', async ({
  extension,
}) => {
  const { page, record } = await openPacking(extension),
    source = structuredClone(record.snapshot)
  for (const [index, material] of [
    'Glass',
    'Stainless steel',
    'Plastic',
  ].entries()) {
    const editor = await editOrderProduct(page, index)
    await expect(
      editor.getByRole('textbox', { name: 'Material', exact: true })
    ).toHaveValue(material)
    await closeOrderProduct(editor)
  }
  await editMaterial(page, 0, 'Custom ceramic')
  for (const index of [0, 1]) await editMaterial(page, index, 'Cotton')
  await expect
    .poll(async () =>
      (await libraryBackup(extension)).preparations[0].groups
        .flatMap((group) => group.variants)
        .map((variant) => variant.material)
    )
    .toEqual(['Cotton', 'Cotton', '塑料'])
  const initialMaterials = (
    await libraryBackup(extension)
  ).preparations[0].groups
    .flatMap((group) => group.variants)
    .map(({ material, materialSource }) => ({ material, materialSource }))
  expect(initialMaterials).toEqual([
    { material: 'Cotton', materialSource: 'manual' },
    { material: 'Cotton', materialSource: 'manual' },
    { material: '塑料', materialSource: 'suggested' },
  ])
  const suggestedDisplay = page
    .locator('#sheet-body tr[data-selection-key]')
    .nth(2)
    .locator('[data-attribute="material"] dd')
  await expect(suggestedDisplay).toHaveText('Plastic')
  await page.locator('#language-toggle [data-language="es"]').click()
  await expect(suggestedDisplay).toHaveText('Plástico')
  await page.locator('#language-toggle [data-language="en"]').click()
  await expect(suggestedDisplay).toHaveText('Plastic')
  for (const index of [0, 1, 2]) await editMaterial(page, index, 'Aluminum')
  await editMaterial(page, 0, '')
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
  await expect(
    productRows.nth(1).locator('[data-attribute="material"] dd')
  ).toHaveText('Aluminium')
  let editor = await editOrderProduct(page, 0)
  await expect(
    editor.getByRole('textbox', { name: 'Material', exact: true })
  ).toHaveValue('')
  await closeOrderProduct(editor)
  editor = await editOrderProduct(page, 1)
  await expect(
    editor.getByRole('textbox', { name: 'Material', exact: true })
  ).toHaveValue('Aluminum')
  await closeOrderProduct(editor)
  const result = await libraryBackup(extension),
    variants = result.preparations[0].groups.flatMap((group) => group.variants)
  expect(variants[0].materialSource).toBe('manual')
  expect(variants[0].material).toBe('')
  expect(variants[1].materialSource).toBe('manual')
  expect(variants[1].material).toBe('Aluminum')
  expect(result.orders[0].snapshot).toEqual(source)
})

test('Orders click and Enter inspect source details while explicit selection and contextual edits remain independent', async ({
  extension,
}) => {
  const { page } = await openPacking(extension),
    rows = page.locator('#sheet-body tr[data-selection-key]'),
    row = rows.first()
  await expect(rows.locator('input[type="checkbox"]:checked')).toHaveCount(3)
  const details = page.getByRole('dialog', {
    name: 'Original product details',
    exact: true,
  })
  await row.click({ position: { x: 40, y: 10 } })
  await expect(details).toBeVisible()
  await details.getByRole('button', { name: 'Close product details' }).click()
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(details).toBeVisible()
  await details.getByRole('button', { name: 'Close product details' }).click()
  const editor = await editOrderProduct(page, 0)
  await editor
    .getByRole('textbox', { name: 'Material', exact: true })
    .dblclick()
  await expect(details).toHaveCount(0)
  await closeOrderProduct(editor)
  await expect(rows.locator('input[type="checkbox"]:checked')).toHaveCount(3)
})

test('Orders code segments retain independent accessible names and do not overlap on narrow screens', async ({
  extension,
}) => {
  const { page, record } = await openPacking(extension),
    editor = await editOrderProduct(page, 0),
    variant = editor.getByRole('textbox', {
      name: 'Variant ending',
      exact: true,
    }),
    size = editor.getByRole('textbox', { name: 'Size ending', exact: true })
  await variant.fill('ABCDEFGH')
  await size.fill('XXXXL')
  await page.setViewportSize({ width: 800, height: 900 })
  const boxes = await editor
    .locator('.product-authoring-fields > label')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
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
  await expect(variant).toHaveAccessibleName('Variant ending')
  await expect(size).toHaveAccessibleName('Size ending')
  await closeOrderProduct(editor)
  expect((await libraryBackup(extension)).orders[0].snapshot).toEqual(
    record.snapshot
  )
})
