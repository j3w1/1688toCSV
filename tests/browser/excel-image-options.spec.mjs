import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

test('image columns reorder, persist across copying and reload, and use the selected language in both views', async ({
  extension,
}) => {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-image-columns'
  record.snapshot.sellerShopOrigin = 'https://synthetic-image-columns.1688.com'
  for (const item of record.snapshot.items) item.title = '合成玻璃花瓶'
  const result = await extension.inspector.evaluate(
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
  expect(result.ok, result.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await page
    .getByRole('button', { name: 'Excel image columns', exact: true })
    .click()
  let dialog = page.getByRole('dialog', {
    name: 'Excel image columns',
    exact: true,
  })
  await expect(
    dialog.locator('.excel-column-toggle[aria-pressed="true"]')
  ).toHaveCount(11)
  const selected = ['quantity', 'price', 'supplierWeight']
  for (const key of [
    'number',
    'thumbnail',
    'description',
    'baseCode',
    'barcode',
    'chineseCategory',
    'supplierDimensions',
    'supplierCarton',
  ]) {
    await dialog.locator(`[data-column="${key}"] .excel-column-toggle`).click()
  }
  await dialog
    .locator('[data-column="quantity"] .excel-column-grip')
    .dragTo(dialog.locator('.excel-column-item').first())
  await expect(dialog.locator('.excel-column-item').first()).toHaveAttribute(
    'data-column',
    'quantity'
  )
  await dialog
    .getByRole('button', { name: 'Move Unit price (CNY) left', exact: true })
    .click()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  const preference = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('1688-excel-image-columns'))
  )
  expect(preference.selected.toSorted()).toEqual(selected.toSorted())
  expect(preference.order[0]).toBe('quantity')
  await page.reload()
  await page.locator('#language-toggle [data-language="es"]').click()
  await page
    .getByRole('button', { name: 'Columnas de imagen Excel', exact: true })
    .click()
  dialog = page.getByRole('dialog', {
    name: 'Columnas de imagen Excel',
    exact: true,
  })
  await expect(dialog.locator('.excel-column-item').first()).toHaveAttribute(
    'data-column',
    'quantity'
  )
  await expect(
    dialog.locator('.excel-column-toggle[aria-pressed="true"]')
  ).toHaveCount(3)
  await expect(dialog.locator('[data-column="supplierWeight"]')).toContainText(
    'Peso (kg)'
  )
  await dialog.locator('.excel-options-heading button').click()
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.evaluate(() => {
    window.imageColumnText = []
    const fill = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.imageColumnText.push(String(text))
      return fill.call(this, text, ...args)
    }
  })
  await page.locator('#copy-excel-image').click()
  await expect(page.locator('#copy-excel-image')).toHaveClass(/copied/)
  const rendered = await page.evaluate(() => imageColumnText.join(' '))
  expect(rendered).toContain('Cantidad')
  expect(rendered).toContain('Precio unitario (CNY)')
  expect(rendered).toContain('Peso (kg)')
  expect(rendered).not.toContain('Carton')
  expect(rendered).not.toContain('Product description')
  for (const item of record.snapshot.items)
    expect(rendered).toContain(`¥ ${item.price}`)
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('1688-excel-image-columns'))
    )
  ).toEqual(preference)
  await page.locator('#language-toggle [data-language="en"]').click()
  const first = page.locator('#sheet-body tr[data-selection-key]').first()
  await first.focus()
  await first.press('Control+a')
  await page.locator('#prepare-orders').click()
  const packing = page.locator('#packing-view')
  await expect(packing).toBeVisible()
  // One new group opens directly; only broader code changes need review.
  await expect(packing.locator('.preparation-group')).toHaveCount(1)
  await expect(packing.locator('.variants tbody tr')).toHaveCount(3)
  await packing
    .getByRole('button', { name: 'Excel image columns', exact: true })
    .click()
  dialog = page.getByRole('dialog', {
    name: 'Excel image columns',
    exact: true,
  })
  await expect(
    dialog.locator('.excel-column-toggle[aria-pressed="true"]')
  ).toHaveCount(3)
  await expect(dialog.locator('.excel-column-item').first()).toHaveAttribute(
    'data-column',
    'quantity'
  )
  await page.setViewportSize({ width: 390, height: 780 })
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)
  ).toBe(true)
})
