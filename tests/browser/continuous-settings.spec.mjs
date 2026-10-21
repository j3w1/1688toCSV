import { test, expect } from './extension-fixture.mjs'
import { validatePackingPreferences } from '../../src/packing-model.js'

async function open(extension) {
  const preferences = validatePackingPreferences({
    settings: { vocabularyInitialized: true },
    vocabulary: Array.from({ length: 500 }, (_, index) => ({
      match: `Seller product ${index}`,
      spanishName: `PRODUCTO ${index}`,
      category: `产品${index}`,
    })),
    sizeVocabulary: Array.from({ length: 500 }, (_, index) => ({
      match: `Size ${index}`,
      suffix: `S${index}`,
    })),
    colorVocabulary: Array.from({ length: 500 }, (_, index) => ({
      id: `color-${index}`,
      aliases: [`seller color ${index}`],
      labels: {
        en: `Color ${index}`,
        es: `Color español ${index}`,
        zh: `颜色${index}`,
      },
      swatch: '#336699',
      kind: 'color',
    })),
    materialVocabulary: Array.from({ length: 500 }, (_, index) => ({
      id: `material-${index}`,
      aliases: [`seller material ${index}`],
      en: `Material ${index}`,
      es: `Material español ${index}`,
      zh: `材质${index}`,
      parent: '',
    })),
  })
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    {
      format: '1688-order-library',
      version: 3,
      exportedAt: '2026-10-21T08:00:00.000Z',
      orders: [],
      history: [],
      images: [],
      preparations: [],
      allocations: [],
      issuedCodes: [],
      packingPreferences: {
        value: preferences,
        updatedAt: '2026-10-21T08:00:00.000Z',
      },
    }
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  return {
    page,
    dialog: page.getByRole('dialog', { name: 'Settings', exact: true }),
  }
}
const sections = [
  {
    tab: 'Product names',
    field: 'Spanish name',
    search: 'Search naming rules',
    saved: 'DRAFT NAMES',
  },
  {
    tab: 'Size codes',
    field: 'Size names',
    search: 'Search size rules',
    saved: 'Draft sizes',
  },
  {
    tab: 'Product colors',
    field: 'English',
    search: 'Search color rules',
    saved: 'Draft colors',
  },
  {
    tab: 'Materials',
    field: 'English',
    search: 'Search material rules',
    saved: 'Draft materials',
  },
]
test('all Settings vocabularies continuously scroll bounded rows, retain active drafts and persist the full draft', async ({
  extension,
}) => {
  const { page, dialog } = await open(extension)
  for (const section of sections) {
    await dialog.getByRole('tab', { name: section.tab, exact: true }).click()
    const panel = dialog.getByRole('tabpanel', {
        name: section.tab,
        exact: true,
      }),
      rows = panel.locator('tbody tr[data-virtual-key]'),
      scroll = panel.locator('.vocabulary-scroll')
    await expect(rows).toHaveCount(100)
    await expect(panel.locator('.vocabulary-status')).toContainText('500')
    await expect(
      panel.getByRole('button', { name: /^(Previous|Next)/ })
    ).toHaveCount(0)
    const first = rows
      .first()
      .getByRole('textbox', { name: section.field, exact: true })
    await first.fill(section.saved)
    await scroll.evaluate((node) => (node.scrollTop = node.scrollHeight))
    await expect
      .poll(() => rows.last().locator('input').first().inputValue())
      .toContain('499')
    await expect(first).toBeFocused()
    await expect(first).toHaveValue(section.saved)
    expect(await rows.count()).toBeLessThanOrEqual(101)
    const search = panel.getByRole('combobox', {
      name: section.search,
      exact: true,
    })
    await search.focus()
    await expect(rows).toHaveCount(100)
    await scroll.evaluate((node) => (node.scrollTop = 0))
    await expect(
      rows.first().getByRole('textbox', { name: section.field, exact: true })
    ).toHaveValue(section.saved)
    await search.fill(section.saved)
    await expect(rows).toHaveCount(1)
    await search.fill('')
    await expect(rows).toHaveCount(100)
  }
  await dialog
    .getByRole('button', { name: 'Save settings', exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  for (const section of sections) {
    await dialog.getByRole('tab', { name: section.tab, exact: true }).click()
    const panel = dialog.getByRole('tabpanel', {
      name: section.tab,
      exact: true,
    })
    await panel
      .getByRole('combobox', { name: section.search, exact: true })
      .fill(section.saved)
    await expect(panel.locator('tbody tr[data-virtual-key]')).toHaveCount(1)
    await expect(
      panel
        .locator('tbody')
        .getByRole('textbox', { name: section.field, exact: true })
    ).toHaveValue(section.saved)
  }
})
test('Save reveals an invalid offscreen size rule after leaving its tab', async ({
  extension,
}) => {
  const { dialog } = await open(extension)
  await dialog.getByRole('tab', { name: 'Size codes', exact: true }).click()
  const panel = dialog.getByRole('tabpanel', {
    name: 'Size codes',
    exact: true,
  })
  await panel
    .getByRole('combobox', { name: 'Search size rules', exact: true })
    .fill('Size 499')
  await panel.getByLabel('Size code', { exact: true }).fill('S-M')
  await dialog.getByRole('tab', { name: 'Labels', exact: true }).click()
  await dialog
    .getByRole('button', { name: 'Save settings', exact: true })
    .click()
  await expect(
    dialog.getByRole('tab', { name: 'Size codes', exact: true })
  ).toHaveAttribute('aria-selected', 'true')
  const invalid = panel.locator('[aria-invalid=true]').first()
  await expect(invalid).toBeFocused()
  await expect(invalid).toBeInViewport()
  await expect(
    panel
      .locator('tbody tr:has([aria-invalid=true])')
      .getByRole('textbox', { name: 'Size names', exact: true })
  ).toHaveValue('Size 499')
  expect(
    await panel.locator('tbody tr[data-virtual-key]').count()
  ).toBeLessThanOrEqual(100)
  await dialog
    .getByRole('button', { name: 'Dismiss error', exact: true })
    .click()
  await panel
    .locator('tbody tr:has([aria-invalid=true])')
    .getByLabel('Size code', { exact: true })
    .fill('S499')
  await dialog
    .getByRole('button', { name: 'Save settings', exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
})
