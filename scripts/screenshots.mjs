import { chromium, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { startPreview } from './preview.mjs'

// Production controllers/repository with synthetic purchases in a temporary
// browser only. A missing domain API fails loudly; no fallback preview model.
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
  await expect(
    page.locator('#sheet-body tr[data-selection-key]').nth(7)
  ).toBeVisible()
  await page.screenshot({ path: 'screenshots/order-library-dark.png' })
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await page.screenshot({ path: 'screenshots/order-library.png' })
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await page
    .getByRole('button', { name: 'Import spreadsheet', exact: true })
    .click()
  const importer = page.getByRole('dialog', {
    name: 'Import store spreadsheet',
    exact: true,
  })
  await importer.getByRole('tab', { name: 'Markers', exact: true }).click()
  await importer.screenshot({
    path: 'screenshots/store-spreadsheet-import.png',
  })
  await importer
    .getByRole('button', { name: 'Close import', exact: true })
    .click()
  const first = page.locator('#sheet-body tr[data-selection-key]').first()
  await first.locator('.description-cell').click({ position: { x: 5, y: 5 } })
  const details = page.locator('.product-details-dialog')
  await details.locator('img').evaluate((image) => image.decode())
  await details.screenshot({ path: 'screenshots/product-details.png' })
  await details
    .getByRole('button', { name: 'Close product details', exact: true })
    .click()
  await first.locator('[data-action="edit-order-product"]').click()
  const authoring = page.locator('.product-authoring-dialog')
  await authoring.getByRole('button', { name: 'Barcode', exact: true }).click()
  await page
    .getByAltText('Printable label preview')
    .evaluate((image) => image.decode())
  await page
    .locator('#label-dialog')
    .screenshot({ path: 'screenshots/label-editor.png' })
  await page
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  await page.locator('[data-action="open-order-cartons"]').first().click()
  await expect(page.locator('.reconciliation-summary')).toBeVisible()
  await page.screenshot({ path: 'screenshots/preparation.png' })
  await page.screenshot({ path: 'screenshots/order-cartons.png' })
  await page.locator('[data-action="view-packing"]').click()
  await page
    .locator('[data-action="choose-container"]')
    .selectOption({ label: 'Synthetic October 2026' })
  await expect(page.locator('.container-heading')).toContainText(
    'Synthetic October 2026'
  )
  await page.screenshot({ path: 'screenshots/container-loading.png' })
  await page.locator('[data-action="mark-all-loaded"]').click()
  await expect(page.locator('#container-content')).toHaveAttribute(
    'aria-busy',
    'false'
  )
  await page
    .locator('[data-action="container-view"][data-view="packing-list"]')
    .click()
  await page.locator('[data-action="export-packing-list"]').click()
  const exported = page.locator('.packing-export-dialog')
  await expect(
    exported.getByRole('checkbox', {
      name: 'Include detailed automation JSON',
      exact: true,
    })
  ).not.toBeChecked()
  await expect(
    exported.getByRole('radio', { name: 'Se quedó', exact: true })
  ).toBeVisible()
  await exported.screenshot({ path: 'screenshots/packing-export.png' })
  await exported
    .getByRole('button', { name: 'Close export', exact: true })
    .click()
  await page
    .locator('[data-action="container-view"][data-view="left-behind"]')
    .click()
  await page.screenshot({ path: 'screenshots/container-left-behind.png' })
  await page.locator('[data-action="view-orders"]').click()
  await page.locator('[data-action="orders-products"]').click()
  await page.locator('#packing-settings').click()
  await page.getByRole('tab', { name: 'Labels', exact: true }).click()
  await page
    .locator('#settings-dialog')
    .screenshot({ path: 'screenshots/settings.png' })
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click()
  await page
    .locator('#settings-dialog')
    .screenshot({ path: 'screenshots/appearance-settings.png' })
  await page
    .getByRole('button', { name: 'Close settings', exact: true })
    .click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'work/workspace-narrow-dark.png' })
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await page.screenshot({ path: 'work/workspace-narrow-light.png' })
  await page.setViewportSize({ width: 1280, height: 960 })
  await page.goto(`${preview.url}/?state=import`)
  await page.locator('.import-latest').waitFor()
  await page
    .locator('aside[aria-label="1688toPL"]')
    .screenshot({ path: 'screenshots/import-progress.png' })
} finally {
  await browser.close()
  await preview.close()
}
