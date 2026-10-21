import { chromium, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { startPreview } from './preview.mjs'

const preview = await startPreview()
const browser = await chromium.launch({ channel: 'chromium' })
try {
  await mkdir('screenshots', { recursive: true })
  await mkdir('work', { recursive: true })
  const page = await browser.newPage({
    viewport: { width: 1280, height: 960 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  })
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${preview.url}/library.html`)
  await page.locator('#sheet-body tr[data-selection-key]').nth(7).waitFor()
  await page.locator('#packing-month').fill('2026-10')
  await page.locator('#packing-month').blur()
  await page.screenshot({ path: 'screenshots/order-library-dark.png' })
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await page.screenshot({ path: 'screenshots/order-library.png' })
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await page
    .getByRole('button', { name: 'Import spreadsheet', exact: true })
    .click()
  const spreadsheetImport = page.getByRole('dialog', {
    name: 'Import store spreadsheet',
    exact: true,
  })
  await spreadsheetImport
    .getByRole('tab', { name: 'Markers', exact: true })
    .click()
  await spreadsheetImport.screenshot({
    path: 'screenshots/store-spreadsheet-import.png',
  })
  await spreadsheetImport
    .getByRole('button', { name: 'Close import', exact: true })
    .click()
  const product = page.locator('#sheet-body tr[data-selection-key]').nth(1)
  await product.focus()
  await product.press('Enter')
  const details = page.locator('.product-details-dialog')
  await details.locator('img').evaluate((image) => image.decode())
  await details.locator('h2').click()
  await page.mouse.move(0, 0)
  await page
    .locator('.preparation-help-popover:visible')
    .waitFor({ state: 'hidden' })
  await details.screenshot({ path: 'screenshots/product-details.png' })
  await details
    .getByRole('button', { name: 'Close product details', exact: true })
    .click()
  for (const toggle of await page
    .locator('.month-toggle[aria-expanded=false]')
    .all())
    await toggle.click()
  await page.locator('#order-list .order-card-meta').first().dblclick()
  const orderDetails = page.locator('#order-details')
  await orderDetails
    .getByRole('combobox', { name: 'Tags', exact: true })
    .fill('December packing')
  await orderDetails
    .getByRole('combobox', { name: 'Tags', exact: true })
    .press('Enter')
  await orderDetails
    .locator('#order-notes')
    .fill('Synthetic example: confirm carton dimensions before dispatch.')
  await orderDetails
    .locator('.annotation-state')
    .filter({ hasText: /^Saved$/ })
    .waitFor()
  await page.mouse.move(0, 0)
  await orderDetails.screenshot({ path: 'screenshots/order-details.png' })
  await orderDetails
    .getByRole('button', { name: 'Close order details', exact: true })
    .click()
  await page.locator('.orders-pane').screenshot({
    path: 'work/order-cards-dark.png',
  })
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await page.locator('.orders-pane').screenshot({
    path: 'work/order-cards-light.png',
  })
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await page
    .getByRole('button', { name: 'Copy Excel image', exact: true })
    .click()
  const imageColumns = page.getByRole('dialog', {
    name: 'Copy Excel image',
    exact: true,
  })
  await imageColumns
    .getByRole('button', { name: 'Copy current batch', exact: true })
    .waitFor()
  await imageColumns
    .locator('.copy-preview img')
    .evaluate((image) => image.decode())
  const columnSummary = imageColumns.getByText('Excel image columns', {
    exact: true,
  })
  if (!(await columnSummary.evaluate((node) => node.parentElement.open)))
    await columnSummary.click()
  await imageColumns.screenshot({ path: 'screenshots/excel-image-columns.png' })
  await imageColumns.getByText('Image details', { exact: true }).click()
  for (const name of ['Order tags', 'Purchase date', 'Order status']) {
    await imageColumns.getByRole('checkbox', { name, exact: true }).check()
    await expect(imageColumns.locator('.image-copy-submit')).toBeEnabled()
  }
  await imageColumns
    .locator('.copy-preview img')
    .evaluate((image) => image.decode())
  await imageColumns.screenshot({ path: 'work/excel-image-style.png' })
  await imageColumns.getByRole('button', { name: 'Done', exact: true }).click()
  await page.locator('#select-rows').click()
  await page.locator('#prepare-orders').click()
  await page
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const group = page.locator('.preparation-group').first()
  await page
    .locator('.preparation-save-status')
    .filter({ hasText: 'Saved automatically' })
    .waitFor()
  await group.getByAltText('Carton mark preview').waitFor()
  await group.getByAltText('Barcode preview').first().waitFor()
  const packingPreviews = page.locator(
    '#packing-view .preparation-label-preview img:not([hidden])'
  )
  await expect(packingPreviews).toHaveCount(6)
  await packingPreviews.evaluateAll((images) =>
    Promise.all(images.map((image) => image.decode()))
  )
  await page.locator('#packing-view h1').click()
  await page.mouse.move(0, 0)
  await page
    .locator('.preparation-help-popover:visible')
    .waitFor({ state: 'hidden' })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'screenshots/preparation.png' })
  await page.getByRole('button', { name: 'Organize', exact: true }).click()
  await expect(page.locator('.packing-organize-group').first()).toBeVisible()
  await expect(page.locator('#packing-view .variants')).toHaveCount(0)
  await page
    .locator('#packing-view img')
    .evaluateAll((images) => Promise.all(images.map((image) => image.decode())))
  await page.mouse.move(0, 0)
  await page.screenshot({ path: 'screenshots/packing-organize.png' })
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page
    .getByRole('button', { name: 'More copy formats', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Copy carton marks', exact: true })
    .click()
  const labelBatches = page.locator('.image-copy-dialog')
  await labelBatches.locator('.copy-preview img').first().waitFor()
  await labelBatches
    .locator('.copy-preview img')
    .evaluateAll((images) => Promise.all(images.map((image) => image.decode())))
  await labelBatches.screenshot({ path: 'screenshots/copy-label-batches.png' })
  await labelBatches.getByRole('button', { name: 'Done', exact: true }).click()
  await group
    .getByRole('button', { name: 'Edit barcode', exact: true })
    .first()
    .click()
  await page.getByAltText('Printable label preview').waitFor()
  await page
    .getByAltText('Printable label preview')
    .evaluate((image) => image.decode())
  await page
    .locator('#label-dialog')
    .screenshot({ path: 'screenshots/label-editor.png' })
  await page
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  await group
    .getByRole('button', { name: 'Edit carton mark', exact: true })
    .click()
  await page
    .getByAltText('Printable label preview')
    .evaluate((image) => image.decode())
  await page
    .locator('#label-dialog')
    .screenshot({ path: 'work/carton-label-editor.png' })
  await page
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  await page.getByRole('button', { name: 'Orders', exact: true }).click()
  await page.screenshot({ path: 'work/prepared-products-dark.png' })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('tab', { name: 'Labels', exact: true }).click()
  await page.locator('#settings-dialog h2').click()
  await page.mouse.move(0, 0)
  await page
    .locator('.preparation-help-popover:visible')
    .waitFor({ state: 'hidden' })
  await page
    .locator('#settings-dialog')
    .screenshot({ path: 'screenshots/settings.png' })
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click()
  for (const mode of ['Light', 'Dark'])
    await page
      .getByLabel(`${mode} palette`, { exact: true })
      .selectOption('classic-brown')
  await page.mouse.move(0, 0)
  await page
    .locator('#settings-dialog')
    .screenshot({ path: 'screenshots/appearance-settings.png' })
  await page.keyboard.press('Escape')
  await page.locator('#sheet-title').click()
  await page.mouse.move(0, 0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'work/workspace-narrow-dark.png' })
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await page.screenshot({ path: 'work/workspace-narrow-light.png' })
  await page.setViewportSize({ width: 1280, height: 960 })
  await page.goto(`${preview.url}/?state=import`)
  await page.locator('.import-latest').waitFor()
  await page
    .locator('aside[aria-label="1688toCSV"]')
    .screenshot({ path: 'screenshots/import-progress.png' })

  // Additional UX evidence uses only this disposable synthetic preview, after
  // all standard screenshots. Restrict one order to one product for its picker.
  await page.goto(`${preview.url}/library.html`)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await rows.nth(7).waitFor()
  const keys = await rows.evaluateAll((nodes) =>
    nodes.map((node) => node.dataset.selectionKey)
  )
  const orderIds = [...new Set(keys.map((key) => key.split('/')[0]))]
  const chosen = [
    keys.find((key) => key.startsWith(`${orderIds[0]}/`)),
    ...keys.filter((key) => !key.startsWith(`${orderIds[0]}/`)),
  ]
  for (const key of chosen) {
    const row = page.locator(`#sheet-body tr[data-selection-key="${key}"]`)
    await row.focus()
    await row.press('Control+Space')
  }
  await page.locator('#packing-month').fill('2026-10')
  await page.locator('#prepare-orders').click()
  const packing = page.locator('#packing-view')
  const assignment = page.getByRole('dialog', {
    name: /^(Assign product codes\?|Move selected products to this packing month\?)$/,
  })
  await expect
    .poll(
      async () => (await packing.isVisible()) || (await assignment.isVisible())
    )
    .toBe(true)
  if (await assignment.isVisible())
    await assignment
      .getByRole('button', {
        name: /^(Assign codes|Change codes) and prepare$/,
      })
      .click()
  await expect(packing).toBeVisible()
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  const picker = packing.locator('select[name="packing-order"]')
  for (const [width, label] of [
    [1280, 'desktop'],
    [390, 'narrow'],
  ]) {
    await page.setViewportSize({ width, height: 960 })
    await picker.selectOption('')
    await picker.click()
    await expect
      .poll(() =>
        picker
          .locator('option img')
          .evaluateAll(
            (images) =>
              images.length > 0 &&
              images.every((image) => image.complete && image.naturalWidth > 0)
          )
      )
      .toBe(true)
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `work/packing-selector-${label}-open.png` })
    await page.keyboard.press('Escape')
    await expect(packing).toBeVisible()
    for (const [orderId, kind] of [
      [orderIds[0], 'single'],
      [orderIds[1], 'multiple'],
      ['', 'six-photo-overview'],
    ]) {
      await picker.selectOption(orderId)
      await expect
        .poll(() =>
          picker
            .locator('selectedcontent img')
            .evaluateAll(
              (images) =>
                images.length > 0 &&
                images.every(
                  (image) => image.complete && image.naturalWidth > 0
                )
            )
        )
        .toBe(true)
      await page.mouse.move(0, 0)
      if (!orderId)
        await expect(picker.locator('selectedcontent img')).toHaveCount(6)
      await page.screenshot({
        path: `work/packing-selector-${label}-${kind}.png`,
      })
    }
  }

  // Give the multi-photo synthetic order a two-variant group, so a selected
  // whole group can be compared with one selected row and its unselected sibling.
  await page.setViewportSize({ width: 1280, height: 960 })
  await picker.selectOption(orderIds[1])
  const groups = packing.locator('.preparation-group')
  await expect(groups).toHaveCount(3)
  await packing
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  await groups.nth(1).locator('.group-select').click()
  await groups.nth(2).locator('.group-select').click()
  await packing
    .getByRole('button', { name: 'Grouping tools', exact: true })
    .click()
  await packing
    .getByRole('button', { name: 'Merge products', exact: true })
    .click()
  await page
    .getByRole('dialog', {
      name: 'Merge selected product groups?',
      exact: true,
    })
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(groups).toHaveCount(2)
  await packing
    .locator('.preparation-save-status')
    .filter({ hasText: 'Saved automatically' })
    .waitFor()
  await packing
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  await groups.first().locator('.group-select').click()
  const partialRows = groups.nth(1).locator('.variants tbody tr')
  await expect(partialRows).toHaveCount(2)
  await partialRows.first().focus()
  await partialRows.first().press('Control+Space')
  await expect(groups.first().locator('.group-select')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(partialRows.first()).toHaveAttribute('aria-selected', 'true')
  await expect(partialRows.nth(1)).toHaveAttribute('aria-selected', 'false')
  await packing.locator('h1').click()
  await page.mouse.move(0, 0)
  await expect(
    packing.locator('.preparation-label-preview img:not([hidden])')
  ).toHaveCount(5, { timeout: 20_000 })
  await packing
    .locator('.preparation-label-preview img:not([hidden])')
    .evaluateAll((images) => Promise.all(images.map((image) => image.decode())))
  await page
    .locator('.preparation-help-popover:visible')
    .waitFor({ state: 'hidden' })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: 'work/packing-selection-dark.png',
    fullPage: true,
  })
  await partialRows.first().hover()
  await page.screenshot({
    path: 'work/packing-actions-dark.png',
    fullPage: true,
  })
  await page.mouse.move(0, 0)
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await page.screenshot({
    path: 'work/packing-selection-light.png',
    fullPage: true,
  })
  console.log('README screenshots refreshed from synthetic preview data')
} finally {
  await browser.close()
  await preview.close()
}
