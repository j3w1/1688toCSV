import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function prepare(extension) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
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
  await page.locator('#select-rows').click()
  await page.locator('#prepare-orders').click()
  await page
    .getByRole('dialog', { name: 'Assign product codes?' })
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  await expect(page.locator('#packing-view')).toBeVisible()
  return { page, record }
}
const readout = (page, entryId) =>
  page.locator(
    `.variant-numeric-row[data-entry-id="${entryId}"] .carton-capacity-readout`
  )

test('the empty capacity action saves pending packing edits and focuses its exact Orders source field', async ({
  extension,
}) => {
  const { page, record } = await prepare(extension),
    item = record.snapshot.items[2],
    packing = page.locator('#packing-view'),
    name = packing
      .locator('.group-fields input[data-packing-field="name"]')
      .first()
  await name.fill('PENDING CAPACITY NAVIGATION')
  await readout(page, item.entryId)
    .getByRole('button', { name: 'Edit Pcs/box in Orders', exact: true })
    .click()
  await expect(page.locator('#orders-view')).toBeVisible()
  const row = page.locator(
      `#sheet-body tr[data-selection-key="${record.snapshot.orderId}/${item.entryId}"]`
    ),
    capacity = row.locator('.pack-size-cell input[type="number"]')
  await expect(capacity).toBeFocused()
  await expect(capacity).toHaveValue('')
  await expect(row.locator('.carton-capacity-unit')).toBeHidden()
  await expect(capacity).toHaveCSS('text-align', 'end')
  await expect(
    page.locator('#sheet-body tr[aria-selected="true"]')
  ).toHaveCount(3)
  const emptyHeight = (await row.boundingBox()).height
  await capacity.fill('12')
  await capacity.press('Enter')
  await expect(row.locator('.carton-capacity-status')).toHaveText('Saved')
  await expect(row.locator('.carton-capacity-unit')).toBeVisible()
  for (const [language, unit] of [
    ['es', '/ctn'],
    ['zh', '/箱'],
    ['en', '/box'],
  ]) {
    await page.locator(`#language-toggle [data-language=${language}]`).click()
    await expect(row.locator('.carton-capacity-unit')).toHaveText(unit)
    await expect(capacity).toHaveValue('12')
  }
  expect((await row.boundingBox()).height).toBeLessThanOrEqual(emptyHeight + 1)
  await page.locator('#view-packing').click()
  await expect(packing).toBeVisible()
  await expect(
    packing.getByRole('spinbutton', { name: 'Pcs/box', exact: true })
  ).toHaveCount(0)
  await expect(readout(page, item.entryId)).toContainText('12')
  await expect(
    readout(page, item.entryId).locator('.carton-capacity-unit')
  ).toHaveText('/box')
  await expect(packing.locator('.variant-numeric-row').first()).toHaveCSS(
    'text-align',
    'end'
  )
  await expect(name).toHaveValue('PENDING CAPACITY NAVIGATION')
  const backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(backup.data.orders[0].snapshot).toEqual(record.snapshot)
  expect(backup.data.orders[0].unitsPerCarton).toEqual({ [item.entryId]: 12 })
})

test('a filtered-out source uses its existing Orders controller without changing filters or selection', async ({
  extension,
}, testInfo) => {
  const { page, record } = await prepare(extension),
    item = record.snapshot.items[2]
  await page.locator('#view-orders').click()
  await page
    .locator('#search')
    .fill(record.snapshot.items[0].description.split('\n')[0])
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    1
  )
  const search = await page.locator('#search').inputValue()
  const selected = page.locator('#sheet-body tr[data-selection-key]').first()
  await selected.focus()
  await selected.press('Space')
  await expect(selected).toHaveAttribute('aria-selected', 'true')
  await page.locator('#view-packing').click()
  await readout(page, item.entryId)
    .getByRole('button', { name: 'Edit Pcs/box in Orders', exact: true })
    .click()
  const dialog = page.getByRole('dialog', {
      name: 'Edit Pcs/box in Orders',
      exact: true,
    }),
    capacity = dialog.getByRole('spinbutton', { name: 'Pcs/box', exact: true })
  await expect(dialog).toBeVisible()
  await expect(page.locator('#orders-view')).toBeVisible()
  await expect(capacity).toBeFocused()
  await expect(dialog).toContainText(item.description)
  await expect(dialog.locator('.ce-code')).toBeVisible()
  await expect(page.locator('#search')).toHaveValue(search)
  await capacity.fill('0')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(capacity).toBeFocused()
  await expect(dialog.locator('.carton-capacity-error')).toContainText(
    'positive whole number'
  )
  await capacity.fill('8')
  await page.screenshot({
    path: testInfo.outputPath('capacity-source-editor.png'),
  })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('#search')).toHaveValue(search)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    1
  )
  await expect(
    page.locator('#sheet-body tr[aria-selected="true"]')
  ).toHaveCount(1)
  await page.locator('#view-packing').click()
  await expect(readout(page, item.entryId)).toContainText('8')
})
