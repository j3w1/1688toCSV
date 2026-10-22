import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { revealCopyActions } from './copy-actions-helpers.mjs'

async function openLibrary(extension, { fallback = false } = {}) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-copy-actions'
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
  if (fallback)
    await page.addInitScript(() => {
      const supports = CSS.supports.bind(CSS)
      CSS.supports = (property, ...rest) =>
        property === 'position-area' ? false : supports(property, ...rest)
    })
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  return { page, record }
}

test('copy format helpers explain their output, translate and disappear after hover', async ({
  extension,
}) => {
  const { page } = await openLibrary(extension)
  await page.locator('#copy-excel-image').hover()
  await expect(page.getByRole('tooltip')).toHaveText(
    /Choose and arrange columns.*one table picture per batch/
  )
  await page.mouse.move(2, 2)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await revealCopyActions(page)
  await page.locator('#copy-values').hover()
  await expect(page.getByRole('tooltip')).toHaveText(
    /editable spreadsheet cells.*does not copy pictures/
  )
  await page.mouse.move(2, 2)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.locator('[data-language="es"]').click()
  await page.locator('#copy-excel-image').hover()
  await expect(page.getByRole('tooltip')).toHaveText(
    /Elige y ordena las columnas/
  )
  await page.mouse.move(2, 2)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.locator('#select-rows').hover()
  await expect(page.getByRole('tooltip')).toHaveText(/Filas filtradas: 3/)
  await page.mouse.move(2, 2)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.close()
})

for (const fallback of [false, true])
  test(`copy formats keep selection, headings and keyboard dismissal at narrow width (${fallback ? 'fallback' : 'native'} placement)`, async ({
    extension,
  }) => {
    const { page, record } = await openLibrary(extension, { fallback })
    await page.setViewportSize({ width: 390, height: 740 })
    const order = await page
      .locator('.sheet-pane')
      .evaluate((pane) =>
        [...pane.children]
          .filter((node) =>
            node.matches(
              '#product-selection-totals, #order-totals, .table-scroll'
            )
          )
          .map((node) => node.id || node.className)
      )
    expect(order).toEqual(['order-totals', 'table-scroll'])
    // Selection totals and copy actions live in the bottom action bar.
    await expect(
      page.locator('.action-bar #product-selection-totals')
    ).toHaveCount(1)
    await expect(page.locator('.action-bar #orders-copy-actions')).toHaveCount(
      1
    )
    const trigger = page.locator('#orders-copy-actions .copy-actions-trigger')
    const panel = page.locator('#orders-copy-actions .copy-actions-panel')
    await expect(page.locator('#copy-excel-image')).toBeVisible()
    await expect(page.locator('#copy-values')).toBeHidden()
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(panel).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(page.locator('#copy-values')).toBeFocused()
    const bounds = await panel.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(740)
    await expect(trigger).not.toHaveAttribute('aria-haspopup')
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(trigger).toBeFocused()
    await trigger.click()
    await expect(panel).toBeVisible()
    if (!fallback)
      await page.screenshot({
        path: test.info().outputPath('copy-menu-orders-narrow.png'),
      })
    // Anchored placement can cover the search field. Use the page margin,
    // waiting for the queued fallback positioning before clicking outside.
    await expect
      .poll(() =>
        panel.evaluate((panel) => {
          const target = document.elementFromPoint(2, 2)
          return Boolean(target) && !panel.contains(target)
        })
      )
      .toBe(true)
    await page.mouse.click(2, 2)
    await expect(panel).toBeHidden()
    await page
      .locator('#sheet-body tr[data-selection-key] .row-number')
      .first()
      .click()
    await extension.context.grantPermissions([
      'clipboard-read',
      'clipboard-write',
    ])
    await revealCopyActions(page)
    await page.locator('#include-headers').check()
    await page.locator('#copy-values').click()
    await expect(page.locator('#copy-values')).toHaveClass(/copied/)
    await expect(panel).toBeVisible()
    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text.split('\r\n')).toHaveLength(2)
    expect(text).toContain(record.snapshot.items[0].description.split('\n')[0])
    expect(text).not.toContain(
      record.snapshot.items[2].description.split('\n')[0]
    )
    await page.reload()
    await revealCopyActions(page)
    await expect(page.locator('#include-headers')).toBeChecked()
  })

test('packing copy formats remain selection-only and Escape dismisses them before leaving packing', async ({
  extension,
}) => {
  const { page, record } = await openLibrary(extension)
  const ordersPanel = page.locator('#orders-copy-actions .copy-actions-panel')
  await expect(ordersPanel.locator('.copy-format-heading')).toHaveText([
    'Products',
    'Packing',
    'Labels & codes',
    'Options',
  ])
  for (const id of ['copy-barcodes', 'copy-carton-marks'])
    await expect(page.locator(`#${id}`)).toBeDisabled()
  await page.locator('#select-rows').click()
  await page.locator('#prepare-orders').click()
  await page
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const view = page.locator('#packing-view')
  await expect(view).toBeVisible()
  await view
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  const trigger = view.getByRole('button', {
    name: 'More copy formats',
    exact: true,
  })
  const panel = view.getByRole('group', {
    name: 'Copy formats',
    exact: true,
    includeHidden: true,
  })
  await expect(panel.locator('.copy-format-heading')).toHaveText([
    'Products',
    'Packing',
    'Labels & codes',
    'Options',
    'Backup',
  ])
  await expect(trigger).toBeEnabled()
  await expect(panel).toBeHidden()
  for (const name of [
    'Copy values',
    'Copy images',
    'Copy to Excel',
    'Copy columns',
    'Copy group codes',
    'Copy barcode images',
    'Copy carton marks',
  ])
    await expect(
      panel.getByRole('button', { name, exact: true, includeHidden: true })
    ).toBeDisabled()
  await expect(
    panel.getByRole('button', {
      name: 'Back up packing',
      exact: true,
      includeHidden: true,
    })
  ).toBeEnabled()
  await revealCopyActions(page)
  await expect(panel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(view).toBeVisible()
  await view.locator('.group-select').first().click()
  await expect(trigger).toBeEnabled()
  await revealCopyActions(page)
  await expect(panel).toBeVisible()
  await page.screenshot({
    path: test.info().outputPath('copy-menu-preparation-wide.png'),
  })
  const exportPacking = view.locator(
    '.packing-selection-toolbar [data-action="export-packing-list"]'
  )
  await expect(exportPacking).toBeEnabled()
  await expect(
    panel.locator('[data-action="export-packing-list"]')
  ).toHaveCount(0)
  const exportBounds = await exportPacking.boundingBox()
  expect(exportBounds.height).toBeLessThanOrEqual(42)
  expect(exportBounds.y + exportBounds.height).toBeLessThanOrEqual(900)
  expect(
    await exportPacking.evaluate((button) => {
      const text = [...button.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
      )
      const range = document.createRange()
      range.selectNode(text)
      return range.getClientRects().length
    })
  ).toBe(1)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await panel.getByLabel('Headers', { exact: true }).check()
  const copyValues = panel
    .getByRole('group', { name: 'Products', exact: true })
    .getByRole('button')
    .first()
  await expect(copyValues).toHaveAccessibleName('Copy values')
  await copyValues.click()
  await expect(copyValues).toHaveClass(/copied/)
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain(record.snapshot.items[0].description.split('\n')[0])
  expect(copied).not.toContain(
    record.snapshot.items[2].description.split('\n')[0]
  )
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(view).toBeVisible()
  await revealCopyActions(page)
  await panel.getByRole('button', { name: 'Copy columns', exact: true }).click()
  const dialog = page.locator('.preparation-column-dialog')
  await expect(dialog).toBeVisible()
  const languageBefore = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    preference: localStorage.getItem('1688-workspace-language'),
  }))
  await dialog.locator('.popup-language-toggle [data-language="es"]').click()
  await expect(dialog).toHaveAttribute('lang', 'es')
  // Hold the native write so the previous English copy remains readable until
  // this action completes. Clicking alone does not await its async handler.
  await page.evaluate(() => {
    const write = navigator.clipboard.write.bind(navigator.clipboard)
    navigator.clipboard.write = async (...args) => {
      navigator.clipboard.write = write
      await new Promise((resolve) => {
        window.releaseColumnCopy = resolve
      })
      await write(...args)
    }
  })
  const copyColumns = dialog.locator('button.primary')
  await copyColumns.click()
  await expect(copyColumns).toHaveAttribute('aria-busy', 'true')
  await expect(copyColumns).not.toHaveClass(/copied/)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(copied)
  await page.evaluate(() => {
    window.releaseColumnCopy()
    delete window.releaseColumnCopy
  })
  await expect(copyColumns).toHaveClass(/copied/)
  const spanish = await page.evaluate(() => navigator.clipboard.readText())
  expect(spanish.split('\r\n')[0]).toContain('Cantidad')
  expect(
    await page.evaluate(() => ({
      lang: document.documentElement.lang,
      preference: localStorage.getItem('1688-workspace-language'),
    }))
  ).toEqual(languageBefore)
  await expect(page.locator('#import-store-sheet')).toHaveText(
    'Import spreadsheet'
  )
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(view).toBeVisible()
  await view
    .getByLabel('Show packing orders', { exact: true })
    .selectOption({ index: 1 })
  await expect(panel).toHaveCount(1)
  await view.getByRole('button', { name: 'Select all', exact: true }).click()
  await expect(trigger).toBeEnabled()
  await revealCopyActions(page)
  await expect(panel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(view).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(view).toBeHidden()
  for (const id of ['copy-barcodes', 'copy-carton-marks'])
    await expect(page.locator(`#${id}`)).toBeEnabled()
})
