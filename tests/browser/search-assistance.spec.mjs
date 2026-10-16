import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function openWorkspace(extension) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  records[0].snapshot.items[0].skuProperties = [
    { label: '颜色', value: '红色' },
    { label: '材质', value: '玻璃' },
  ]
  records[0].snapshot.items[0].description += '\n颜色：红色\n材质：玻璃'
  const response = await extension.inspector.evaluate(
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
    records
  )
  expect(response.ok, response.error).toBe(true)
  const page = await extension.context.newPage()
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    8
  )
  return { page, records }
}

test('search suggestions support typo matching, keyboard choice, exact IDs and translated product attributes', async ({
  extension,
}) => {
  const { page, records } = await openWorkspace(extension)
  const orders = page.getByRole('combobox', {
    name: 'Search orders',
    exact: true,
  })
  await orders.fill('Habiatt')
  await expect(orders).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.order-card')).toHaveCount(1)
  const suggestion = page.getByRole('option', {
    name: records[0].snapshot.sellerName,
    exact: true,
  })
  await expect(suggestion).toBeVisible()
  await orders.press('ArrowDown')
  await expect(orders).toHaveAttribute(
    'aria-activedescendant',
    /search-suggestions-/
  )
  await orders.press('Enter')
  await expect(orders).toHaveValue(records[0].snapshot.sellerName)
  await expect(orders).toHaveAttribute('aria-expanded', 'false')
  await orders.fill('900000000000000009')
  await expect(page.locator('.order-card')).toHaveCount(0)
  await orders.fill(records[0].snapshot.orderId)
  await expect(page.locator('.order-card')).toHaveCount(1)
  await orders.press('Control+a')
  await orders.press('Backspace')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    8
  )
  await page.locator('#language-toggle [data-language=es]').click()
  const products = page.locator('#search')
  await products.fill('rooj')
  await expect(
    page.getByRole('option', { name: 'Rojo', exact: true })
  ).toBeVisible()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    1
  )
  await products.press('Escape')
  await expect(products).toHaveAttribute('aria-expanded', 'false')
  await expect(products).toHaveValue('rooj')
  await products.fill('vidro')
  await expect(
    page.getByRole('option', { name: 'Vidrio', exact: true })
  ).toBeVisible()
  await page.getByRole('option', { name: 'Vidrio', exact: true }).click()
  await expect(products).toHaveValue('Vidrio')
  await expect(products).toHaveAttribute('aria-expanded', 'false')
  await products.fill('vidro')
  await page.mouse.click(5, 5)
  await expect(products).toHaveAttribute('aria-expanded', 'false')
})

test('all vocabulary searches share suggestions and Escape dismisses them without closing Settings', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await page.locator('#packing-settings').click()
  const dialog = page.locator('#settings-dialog')
  await dialog.getByRole('tab', { name: 'Product names', exact: true }).click()
  const names = dialog.getByRole('combobox', {
    name: 'Search naming rules',
    exact: true,
  })
  await names.fill('vlea')
  await expect(
    page.getByRole('option', { name: 'VELA', exact: true })
  ).toBeVisible()
  await names.press('ArrowDown')
  await names.press('Enter')
  await expect(names).toHaveValue('VELA')
  await dialog.getByRole('tab', { name: 'Size codes', exact: true }).click()
  const sizes = dialog.getByRole('combobox', {
    name: 'Search size rules',
    exact: true,
  })
  await sizes.fill('特别小')
  await expect(
    page.getByRole('option', { name: '特别小号', exact: true })
  ).toBeVisible()
  await sizes.press('Escape')
  await expect(sizes).toHaveAttribute('aria-expanded', 'false')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: 'Product colors', exact: true }).click()
  const colors = dialog.getByRole('combobox', {
    name: 'Search color rules',
    exact: true,
  })
  await colors.fill('yelow')
  await expect(
    page.getByRole('option', { name: 'Yellow', exact: true })
  ).toBeVisible()
  await colors.press('Escape')
  await expect(dialog).toBeVisible()
  await dialog
    .getByRole('button', { name: 'Close settings', exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.search-suggestions')).toHaveCount(2)
})
