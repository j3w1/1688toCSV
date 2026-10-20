import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

test('material Settings rules survive reload and backup, update recognition, and preserve manual text and clears', async ({
  extension,
}) => {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const record = records[0]
  record.snapshot.sellerMemberLogin = 'synthetic-material-rules'
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = '合成杯具'
    item.skuProperties = [
      { label: '颜色', value: ['白色', '灰色', '黑色'][index] },
      { label: '材质', value: index < 2 ? '玻璃' : '晶透新材质' },
    ]
    item.description = [
      item.title,
      ...item.skuProperties.map(({ label, value }) => `${label}：${value}`),
    ].join('\n')
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
  const productRows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(productRows).toHaveCount(3)
  await expect(
    productRows.nth(2).locator('[data-attribute="material"] dd')
  ).toHaveText('晶透新材质')
  await page.locator('#select-rows').click()
  await page.locator('#prepare-orders').click()
  const assignment = page.getByRole('dialog', { name: 'Assign product codes?' })
  await expect(assignment).toBeVisible()
  await assignment
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const packing = page.locator('#packing-view'),
    materials = packing
      .locator('.variants')
      .getByRole('textbox', { name: 'Material', exact: true }),
    saved = packing.locator('.preparation-save-status')
  await expect(packing).toBeVisible()
  await expect(materials).toHaveCount(3)
  await expect(materials.nth(0)).toHaveValue('Glass')
  await expect(materials.nth(2)).toHaveValue('')
  await materials.nth(0).fill('Owner material wording')
  await expect(saved).toHaveText('Saved automatically')
  await materials.nth(1).fill('')
  await expect(saved).toHaveText('Saved automatically')
  await page.keyboard.press('Escape')
  await expect(packing).toBeHidden()

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true }),
    tab = dialog.getByRole('tab', { name: 'Materials', exact: true }),
    panel = dialog.getByRole('tabpanel', { name: 'Materials', exact: true })
  await tab.click()
  await expect(panel.locator('tbody tr')).toHaveCount(8)
  const search = panel.getByRole('combobox', { name: 'Search material rules' })
  await search.fill('Glass')
  const glass = panel.locator('[data-material-rule=glass]'),
    names = glass.getByLabel('Seller material names', { exact: true })
  await names.fill(`${await names.inputValue()}|晶透新材质`)
  await glass.getByLabel('English', { exact: true }).fill('Clear crystal')
  await glass.getByLabel('Chinese', { exact: true }).fill('晶透玻璃')
  await glass.getByLabel('Spanish', { exact: true }).fill('Cristal claro')
  await dialog.getByRole('tab', { name: 'Labels', exact: true }).click()
  await tab.click()
  await expect(glass.getByLabel('English', { exact: true })).toHaveValue(
    'Clear crystal'
  )
  await dialog
    .getByRole('button', { name: 'Save settings', exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await tab.click()
  await search.fill('晶透新材质')
  await expect(panel.locator('tbody tr')).toHaveCount(1)
  await expect(glass.getByLabel('Chinese', { exact: true })).toHaveValue(
    '晶透玻璃'
  )
  await expect(glass.getByLabel('Spanish', { exact: true })).toHaveValue(
    'Cristal claro'
  )
  await dialog
    .getByRole('button', { name: 'Close settings', exact: true })
    .click()
  await page.locator('#prepare-orders').click()
  await expect(packing).toBeVisible()
  await expect(saved).toHaveText('Saved automatically')
  await expect(materials.nth(0)).toHaveValue('Owner material wording')
  await expect(materials.nth(1)).toHaveValue('')
  await expect(materials.nth(2)).toHaveValue('Clear crystal')
  await page.locator('#language-toggle [data-language=es]').click()
  await expect(materials.nth(0)).toHaveValue('Owner material wording')
  await expect(
    packing
      .locator('.variants')
      .getByRole('textbox', { name: 'Material', exact: true })
      .nth(2)
  ).toHaveValue('Cristal claro')
  await page.locator('#language-toggle [data-language=en]').click()
  const backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(backup.ok, backup.error).toBe(true)
  const rule = backup.data.packingPreferences.value.materialVocabulary.find(
      (entry) => entry.id === 'glass'
    ),
    variants = backup.data.preparations[0].groups.flatMap(
      (group) => group.variants
    )
  expect(rule.aliases).toContain('晶透新材质')
  expect({ en: rule.en, zh: rule.zh, es: rule.es }).toEqual({
    en: 'Clear crystal',
    zh: '晶透玻璃',
    es: 'Cristal claro',
  })
  expect(
    variants.map(({ material, materialSource }) => ({
      material,
      materialSource,
    }))
  ).toEqual([
    { material: 'Owner material wording', materialSource: 'manual' },
    { material: '', materialSource: 'manual' },
    { material: '晶透玻璃', materialSource: 'suggested' },
  ])
  expect(
    backup.data.orders[0].snapshot.items.map((item) => item.description)
  ).toEqual(record.snapshot.items.map((item) => item.description))
})
