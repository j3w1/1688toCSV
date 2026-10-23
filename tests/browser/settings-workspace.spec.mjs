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
  // Category belongs to the saved naming rule; compact rows show its name.
  const preferences = await extension.inspector.evaluate(async () =>
    (await window.testRepository).getPackingPreferences()
  )
  expect(
    preferences.vocabulary.find(
      (rule) => rule.match === 'Synthetic unique naming title'
    )
  ).toMatchObject({ spanishName: 'NOMBRE INMEDIATO', category: '测试品' })
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
    dialog.getByRole('tab', { name: 'Appearance', exact: true })
  ).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByRole('tab').first()).toHaveAccessibleName(
    'Appearance'
  )
  return { page, dialog }
}

test('Settings keeps the same frame, navigation and save position across every section', async ({
  extension,
}) => {
  const { page, dialog } = await openSettings(extension)
  const tabs = dialog.getByRole('tab')
  await expect(tabs).toHaveCount(8)
  await expect(
    dialog.getByRole('tab', { name: 'Tags', exact: true })
  ).toBeVisible()
  const footer = dialog.locator('.settings-footer')
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 650 },
    { width: 1280, height: 420 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 740, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await tabs.first().click()
    const frame = await dialog.boundingBox()
    const navigation = await dialog.locator('.settings-tabs').boundingBox()
    const actions = await footer.boundingBox()
    expect(frame.y).toBeGreaterThanOrEqual(0)
    expect(frame.y + frame.height).toBeLessThanOrEqual(viewport.height)
    for (let index = 0; index < (await tabs.count()); index++) {
      await tabs.nth(index).click()
      await expect(tabs.nth(index)).toHaveAttribute('aria-selected', 'true')
      const panel = dialog.locator('.settings-panel:not([hidden])')
      await expect(panel).toHaveCount(1)
      const checkFrame = async () => {
        for (const [locator, baseline] of [
          [dialog, frame],
          [dialog.locator('.settings-tabs'), navigation],
          [footer, actions],
        ]) {
          const current = await locator.boundingBox()
          for (const key of ['x', 'y', 'width', 'height'])
            expect(
              Math.abs(current[key] - baseline[key]),
              `${viewport.width}×${viewport.height}, section ${index}, ${key}`
            ).toBeLessThanOrEqual(1)
        }
      }
      await checkFrame()
      const bounds = await panel.boundingBox()
      expect(bounds.height).toBeGreaterThan(40)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(actions.y + 1)
      // Long sections scroll within the fixed frame, without moving actions.
      await panel.evaluate((node) => node.scrollTo(0, node.scrollHeight))
      await checkFrame()
      expect(
        await dialog.evaluate(
          (node) => node.scrollHeight <= node.clientHeight + 1
        )
      ).toBe(true)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      await expect(
        dialog.getByRole('button', { name: 'Save settings', exact: true })
      ).toBeInViewport()
      await expect(
        dialog.getByRole('button', { name: 'Close settings', exact: true })
      ).toBeInViewport()
    }
  }
})

test('Settings sections support the keyboard, preserve edits across searches, and persist naming rules without pagers', async ({
  extension,
}) => {
  const { page, dialog } = await openSettings(extension)
  await page.setViewportSize({ width: 390, height: 844 })
  await dialog.getByRole('tab', { name: 'Labels', exact: true }).click()
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
  const rows = names.locator(
    '.vocabulary-table tbody tr:not(.virtual-table-spacer)'
  )
  expect(await rows.count()).toBeGreaterThan(12)
  expect(await rows.count()).toBeLessThanOrEqual(100)
  const firstMatch = await rows
    .first()
    .getByLabel('Title includes', { exact: true })
    .inputValue()
  await rows
    .first()
    .getByLabel('Spanish name', { exact: true })
    .fill('NOMBRE DE PRUEBA')
  await expect(
    names.getByRole('button', { name: 'Next rules', exact: true })
  ).toHaveCount(0)
  await expect(
    rows.first().getByLabel('Spanish name', { exact: true })
  ).toHaveValue('NOMBRE DE PRUEBA')
  const search = names.getByRole('combobox', {
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
  await dialog.getByRole('tab', { name: 'Labels', exact: true }).click()
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
  await dialog.getByRole('tab', { name: 'Labels', exact: true }).click()
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
