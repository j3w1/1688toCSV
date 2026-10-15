import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

test('saving a naming rule updates unprepared products and searches immediately', async ({
  extension,
}) => {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  for (const item of records[0].snapshot.items)
    item.title = 'Synthetic unique naming title'
  const restored = await extension.inspector.evaluate(
    (orders) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders,
          history: [],
          images: [],
        },
      }),
    [records[0]]
  )
  expect(restored.ok, restored.error).toBe(true)
  const { page, dialog } = await openSettings(extension)
  await dialog.getByRole('tab', { name: 'Product names', exact: true }).click()
  const names = dialog.getByRole('tabpanel', {
    name: 'Product names',
    exact: true,
  })
  await names.getByRole('button', { name: 'Add rule', exact: true }).click()
  const row = names.locator('.vocabulary-table tbody tr').first()
  await row
    .getByLabel('Title includes', { exact: true })
    .fill('Synthetic unique naming title')
  await row.getByLabel('Spanish name', { exact: true }).fill('NOMBRE INMEDIATO')
  await row.getByLabel('Chinese category', { exact: true }).fill('测试品')
  await dialog
    .getByRole('button', { name: 'Save settings', exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
  await expect(
    page.locator('#sheet-body .row-preparation').first()
  ).toContainText('NOMBRE INMEDIATO')
  await expect(
    page.locator('#sheet-body .row-preparation').first()
  ).toContainText('测试品')
  await page.locator('#search').fill('NOMBRE INMEDIATO')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
})

async function openSettings(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await expect(
    dialog.getByRole('tab', { name: 'Labels', exact: true })
  ).toHaveAttribute('aria-selected', 'true')
  return { page, dialog }
}

test('Settings sections support the keyboard, preserve edits across searches and pages, and persist naming rules', async ({
  extension,
}) => {
  const { page, dialog } = await openSettings(extension)
  await dialog.getByLabel('Website', { exact: true }).fill('labels.example')
  await dialog.getByRole('tab', { name: 'Labels', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  const namesTab = dialog.getByRole('tab', {
    name: 'Product names',
    exact: true,
  })
  await expect(namesTab).toBeFocused()
  await expect(namesTab).toHaveAttribute('aria-selected', 'true')
  const names = dialog.getByRole('tabpanel', {
    name: 'Product names',
    exact: true,
  })
  const rows = names.locator('.vocabulary-table tbody tr')
  await expect(rows).toHaveCount(12)
  const firstMatch = await rows
    .first()
    .getByLabel('Title includes', { exact: true })
    .inputValue()
  await rows
    .first()
    .getByLabel('Spanish name', { exact: true })
    .fill('NOMBRE DE PRUEBA')
  await names.getByRole('button', { name: 'Next rules', exact: true }).click()
  await expect(
    names.locator('.vocabulary-navigation [role=status]')
  ).toContainText('13–24 of')
  await names
    .getByRole('button', { name: 'Previous rules', exact: true })
    .click()
  await expect(
    rows.first().getByLabel('Spanish name', { exact: true })
  ).toHaveValue('NOMBRE DE PRUEBA')
  const search = names.getByRole('searchbox', {
    name: 'Search naming rules',
    exact: true,
  })
  await search.fill('NOMBRE DE PRUEBA')
  await expect(rows).toHaveCount(1)
  await expect(
    rows.first().getByLabel('Title includes', { exact: true })
  ).toHaveValue(firstMatch)
  await search.fill('nonexistent-naming-rule')
  await expect(rows).toHaveText('No matching rules.')
  await names.getByRole('button', { name: 'Add rule', exact: true }).click()
  await expect(search).toHaveValue('')
  await rows
    .first()
    .getByLabel('Title includes', { exact: true })
    .fill('SyntheticRuleOnly')
  await rows
    .first()
    .getByLabel('Spanish name', { exact: true })
    .fill('PRODUCTO DE PRUEBA')
  await rows
    .first()
    .getByLabel('Chinese category', { exact: true })
    .fill('测试')
  await dialog.getByRole('tab', { name: 'Labels', exact: true }).click()
  await expect(dialog.getByLabel('Website', { exact: true })).toHaveValue(
    'labels.example'
  )
  await dialog
    .getByRole('button', { name: 'Save settings', exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(dialog.getByLabel('Website', { exact: true })).toHaveValue(
    'labels.example'
  )
  await dialog.getByRole('tab', { name: 'Product names', exact: true }).click()
  await search.fill('SyntheticRuleOnly')
  await expect(rows).toHaveCount(1)
  await expect(
    rows.first().getByLabel('Chinese category', { exact: true })
  ).toHaveValue('测试')
  await rows
    .first()
    .getByRole('button', { name: 'Remove naming rule', exact: true })
    .click()
  await expect(rows).toHaveText('No matching rules.')
  await dialog
    .getByRole('button', { name: 'Save settings', exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await dialog.getByRole('tab', { name: 'Product names', exact: true }).click()
  await search.fill('SyntheticRuleOnly')
  await expect(rows).toHaveText('No matching rules.')
})

test('invalid label dimensions stay editable and do not replace saved settings', async ({
  extension,
}) => {
  const { page, dialog } = await openSettings(extension)
  const width = dialog.getByLabel('Barcode width (mm)', { exact: true })
  await width.fill('1')
  await dialog
    .getByRole('button', { name: 'Save settings', exact: true })
    .click()
  await expect(dialog.getByRole('alert')).toContainText(
    'Label width must be between'
  )
  await expect(dialog).toBeVisible()
  await dialog
    .getByRole('button', { name: 'Close settings', exact: true })
    .click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(width).toHaveValue('40')
  const scale = dialog.getByRole('slider', {
    name: 'Barcode text scale (0.75–1.25)',
    exact: true,
  })
  await scale.focus()
  await scale.press('ArrowRight')
  await expect(dialog.locator('.settings-scale output').first()).toHaveText(
    '105%'
  )
  await dialog.getByRole('tab', { name: 'Data', exact: true }).click()
  await expect(
    dialog.getByRole('button', { name: 'Back up', exact: true })
  ).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Refresh all orders', exact: true })
  ).toBeVisible()
})

test('Settings stays within a narrow screen and keeps the naming table in its own bounded scroller', async ({
  extension,
}) => {
  const { page, dialog } = await openSettings(extension)
  await page.setViewportSize({ width: 390, height: 844 })
  const bounds = await dialog.boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
  ).toBe(true)
  await dialog.getByRole('tab', { name: 'Product names', exact: true }).click()
  const names = dialog.getByRole('tabpanel', {
    name: 'Product names',
    exact: true,
  })
  await expect(names.locator('.vocabulary-table tbody tr')).toHaveCount(12)
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
  ).toBe(true)
  expect(
    (await names.locator('.vocabulary-scroll').boundingBox()).height
  ).toBeLessThanOrEqual(420)
  await names
    .getByRole('searchbox', { name: 'Search naming rules', exact: true })
    .fill('香薰')
  await expect(
    names
      .locator('.vocabulary-table tbody tr')
      .first()
      .getByLabel('Chinese category', { exact: true })
  ).toHaveValue('香薰')
})
