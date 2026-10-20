import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

test('capacities autosave before assignment, copy in preparation and require review for leftover carton marks', async ({
  extension,
}) => {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-carton-capacity'
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = ['玻璃花瓶', '陶瓷碗', '玻璃杯'][index]
    item.skuProperties = [
      { label: '颜色', value: '白色' },
      { label: '规格', value: '20cm' },
    ]
    item.description = `${item.title}\n颜色：白色\n规格：20cm`
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
  expect(
    await page.locator('.table-scroll thead th').allTextContents()
  ).toEqual([
    '#',
    'Photo',
    'Description & labels',
    'Price',
    'Discount',
    'Quantity',
    'Pcs/box',
  ])
  const capacity = (i) =>
    rows.nth(i).getByRole('spinbutton', { name: 'Pcs/box', exact: true })
  await expect(rows.nth(0).locator('.pack-size-cell input')).toBeVisible()
  await expect(rows.nth(0).locator('.description-cell input')).toHaveCount(0)
  await expect(rows.nth(0).locator('.carton-capacity-summary')).toBeHidden()
  const labelBounds = await rows
    .nth(0)
    .locator('.carton-capacity label')
    .boundingBox()
  expect(labelBounds.width).toBeLessThanOrEqual(1)
  expect(labelBounds.height).toBeLessThanOrEqual(1)
  const capacityBounds = await capacity(0).boundingBox()
  expect(capacityBounds.width).toBeLessThanOrEqual(70)
  expect(capacityBounds.height).toBeLessThanOrEqual(28)
  await capacity(0).fill('0')
  await page.waitForTimeout(550)
  await expect(capacity(0)).not.toHaveAttribute('aria-invalid')
  await capacity(0).blur()
  await expect(capacity(0)).toHaveAttribute('aria-invalid', 'true')
  await expect(rows.nth(0).locator('.carton-capacity-status')).toContainText(
    'positive whole number'
  )
  await capacity(0).fill('010')
  await capacity(0).press('Enter')
  await expect(rows.nth(0).locator('.carton-capacity-status')).toHaveText(
    'Saved'
  )
  // Native incomplete numbers expose an empty value but must never clear data.
  await capacity(0).fill('')
  await capacity(0).pressSequentially('-')
  await expect
    .poll(() => capacity(0).evaluate((input) => input.validity.badInput))
    .toBe(true)
  await expect(capacity(0)).not.toHaveAttribute('aria-invalid')
  await capacity(0).blur()
  await expect(rows.nth(0).locator('.carton-capacity-status')).toContainText(
    'positive whole number'
  )
  const duringInvalid = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(
    duringInvalid.data.orders[0].unitsPerCarton[
      record.snapshot.items[0].entryId
    ]
  ).toBe(10)
  // A filtered-out draft returns as the same editor, not a hidden stale blocker.
  await page.locator('#search').fill('陶瓷')
  await expect(rows).toHaveCount(1)
  await page.locator('#search').fill('')
  await expect(rows).toHaveCount(3)
  await expect
    .poll(() => capacity(0).evaluate((input) => input.validity.badInput))
    .toBe(true)
  await capacity(0).fill('10')
  await capacity(0).press('Enter')
  await expect(capacity(0)).not.toHaveAttribute('aria-invalid')
  await capacity(1).fill('10')
  await capacity(1).press('Enter')
  await expect(rows.nth(1).locator('.carton-capacity-summary')).toHaveText(
    '2 full cartons + 4 loose units · Review packing'
  )
  await expect(rows.nth(1).locator('.carton-capacity-status')).toHaveText(
    'Saved'
  )
  const backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(backup.data.preparations).toHaveLength(0)
  expect(backup.data.orders[0].unitsPerCarton).toEqual({
    [record.snapshot.items[0].entryId]: 10,
    [record.snapshot.items[1].entryId]: 10,
  })
  await page.reload()
  await expect(capacity(0)).toHaveValue('10')
  await expect(capacity(2)).toHaveValue('')
  await page.locator('.sheet-toolbar h2').click()
  await page.screenshot({ path: 'work/compact-products-pack-size.png' })
  await page.locator('#select-rows').click()
  await page.locator('#prepare-orders').click()
  await page
    .getByRole('dialog', { name: 'Assign product codes?' })
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const packing = page.locator('#packing-view')
  await expect(packing).toBeVisible()
  await expect(
    packing.getByRole('spinbutton', { name: 'Pcs/box', exact: true })
  ).toHaveCount(0)
  await expect(packing.locator('.carton-capacity-readout')).toHaveCount(3)
  await expect(
    packing.locator('.carton-capacity-readout').first()
  ).toContainText('4 full cartons')
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.capacityCopied = text
    }
  })
  const first = packing.locator('.variants tbody tr').first()
  await first
    .getByRole('button', { name: 'Copy Pcs/box: 10', exact: true })
    .click()
  await expect.poll(() => page.evaluate(() => window.capacityCopied)).toBe('10')
  await first
    .getByRole('button', { name: 'Copy value: White', exact: true })
    .click()
  await expect
    .poll(() => page.evaluate(() => window.capacityCopied))
    .toBe('White')
  await first
    .getByRole('button', { name: 'Copy size: 20cm', exact: true })
    .click()
  await expect
    .poll(() => page.evaluate(() => window.capacityCopied))
    .toBe('20cm')
  await first
    .getByRole('button', { name: 'Copy quantity: 40', exact: true })
    .click()
  await expect.poll(() => page.evaluate(() => window.capacityCopied)).toBe('40')
  await expect(
    first.getByRole('button', { name: 'Copy quantity: 40', exact: true })
  ).toContainText('Copied')
  await page.locator('[data-language="es"]').click()
  await first
    .getByRole('button', { name: 'Copiar valor: Blanco', exact: true })
    .click()
  await expect
    .poll(() => page.evaluate(() => window.capacityCopied))
    .toBe('Blanco')
  await page.locator('[data-language="en"]').click()
  await packing.locator('[data-action="open-print-menu"]').click()
  await packing.locator('[data-action="print-carton-marks"]').click()
  const print = page.getByRole('dialog', {
    name: 'Print carton marks',
    exact: true,
  })
  const quantities = print.getByLabel(/^Quantity for /)
  await expect(quantities.nth(0)).toHaveValue('4')
  await expect(quantities.nth(1)).toHaveValue('')
  await expect(quantities.nth(2)).toHaveValue('1')
  const confirm = print.getByRole('checkbox', {
    name: /^Carton count reviewed for /,
  })
  const exportButton = print.getByRole('button', {
    name: 'Export PDF',
    exact: true,
  })
  await expect(exportButton).toBeDisabled()
  await quantities.nth(1).fill('3')
  await expect(exportButton).toBeDisabled()
  await page.bringToFront()
  await confirm.check()
  await expect(exportButton).toBeEnabled()
  await quantities.nth(1).fill('2')
  await expect(confirm).not.toBeChecked()
  await expect(exportButton).toBeDisabled()
  await confirm.check()
  await expect(exportButton).toBeEnabled()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'work/carton-capacity-print-review.png' })
  await print.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.screenshot({ path: 'work/carton-capacity-preparation.png' })
  await page.keyboard.press('Escape')
  await expect(packing).toBeHidden()
  await page.screenshot({ path: 'work/carton-capacity-products.png' })
  await capacity(0).fill('')
  await capacity(0).press('Enter')
  await expect(rows.nth(0).locator('.carton-capacity-status')).toHaveText(
    'Saved'
  )
  await page.reload()
  await expect(capacity(0)).toHaveValue('')
})

test('a shared carton code sums exact capacities per product and never guesses when one capacity is missing', async ({
  extension,
}) => {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-shared-carton'
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = '玻璃花瓶'
    item.skuProperties = [
      { label: '颜色', value: ['白色', '红色', '黑色'][index] },
    ]
    item.description = `${item.title}\n颜色：${item.skuProperties[0].value}`
  }
  record.unitsPerCarton = Object.fromEntries(
    record.snapshot.items.map((item, i) => [item.entryId, [10, 12, 20][i]])
  )
  record.unitsPerCartonUpdatedAt = record.snapshot.observedAt
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
  await page.locator('#select-rows').click()
  await page.locator('#prepare-orders').click()
  await page
    .getByRole('dialog', { name: 'Assign product codes?' })
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const packing = page.locator('#packing-view')
  await expect(packing.locator('.preparation-group')).toHaveCount(1)
  const openPrint = async () => {
    await packing.locator('[data-action="open-print-menu"]').click()
    await packing.locator('[data-action="print-carton-marks"]').click()
    return page.getByRole('dialog', { name: 'Print carton marks', exact: true })
  }
  let print = await openPrint()
  await expect(print.getByLabel(/^Quantity for /)).toHaveValue('10')
  await expect(
    print.getByRole('checkbox', { name: /^Carton count reviewed for / })
  ).toHaveCount(0)
  await print.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.keyboard.press('Escape')
  const row = page.locator('#sheet-body tr[data-selection-key]').nth(2)
  await row.getByRole('spinbutton', { name: 'Pcs/box', exact: true }).fill('')
  await row
    .getByRole('spinbutton', { name: 'Pcs/box', exact: true })
    .press('Enter')
  await expect(row.locator('.carton-capacity-status')).toHaveText('Saved')
  await page.locator('#prepare-orders').click()
  await expect(packing).toBeVisible()
  print = await openPrint()
  await expect(print.getByLabel(/^Quantity for /)).toHaveValue('')
  await expect(print.locator('.print-carton-breakdown')).toHaveCount(3)
  await expect(print.locator('.print-carton-breakdown').last()).toContainText(
    'unknown'
  )
  await expect(
    print.getByRole('button', { name: 'Export PDF', exact: true })
  ).toBeDisabled()
})

test('capacity changes refresh an already open preparation and its next print count in another tab', async ({
  extension,
}) => {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-carton-tabs'
  record.snapshot.items[0].title = '玻璃花瓶'
  record.unitsPerCarton = { [record.snapshot.items[0].entryId]: 10 }
  record.unitsPerCartonUpdatedAt = record.snapshot.observedAt
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
  const viewer = await extension.context.newPage()
  await viewer.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await viewer.goto(`${extension.extensionBaseUrl}/library.html`)
  await viewer
    .locator('#sheet-body tr[data-selection-key]')
    .first()
    .locator('.price-cell')
    .click()
  await viewer.locator('#prepare-orders').click()
  await viewer
    .getByRole('dialog', { name: 'Assign product codes?' })
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const packing = viewer.locator('#packing-view')
  await expect(packing.locator('.carton-capacity-readout')).toContainText(
    '4 full cartons'
  )
  const editor = await extension.context.newPage()
  await editor.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await editor.goto(`${extension.extensionBaseUrl}/library.html`)
  const field = editor
    .locator('#sheet-body tr[data-selection-key]')
    .first()
    .getByRole('spinbutton', { name: 'Pcs/box', exact: true })
  await expect(field).toHaveValue('10')
  await field.fill('20')
  await field.press('Enter')
  await expect(editor.locator('.carton-capacity-status').first()).toHaveText(
    'Saved'
  )
  await expect(packing.locator('.carton-capacity-readout')).toContainText(
    '2 full cartons'
  )
  await viewer.bringToFront()
  await packing.locator('[data-action="open-print-menu"]').click()
  await packing.locator('[data-action="print-carton-marks"]').click()
  const print = viewer.getByRole('dialog', {
    name: 'Print carton marks',
    exact: true,
  })
  await expect(print.getByLabel(/^Quantity for /)).toHaveValue('2')
})
