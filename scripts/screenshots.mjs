import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { startPreview } from './preview.mjs'

const preview = await startPreview()
const browser = await chromium.launch({ channel: 'chromium' })
try {
  await mkdir('screenshots', { recursive: true })
  const page = await browser.newPage({
    viewport: { width: 1280, height: 960 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  })
  await page.goto(`${preview.url}/library.html`)
  await page.locator('#sheet-body tr').nth(7).waitFor()
  await page.locator('#packing-month').fill('2026-10')
  await page.locator('#packing-month').blur()
  await page.screenshot({ path: 'screenshots/order-library-dark.png' })
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await page.screenshot({ path: 'screenshots/order-library.png' })
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await page.locator('#prepare-orders').click()
  const group = page.locator('.preparation-group').first()
  await group
    .getByLabel('Spanish short name', { exact: true })
    .fill('VELA AROMATICA')
  await group.getByLabel('Chinese category', { exact: true }).fill('工艺品')
  await page
    .locator('.preparation-save-status')
    .filter({ hasText: 'Saved automatically' })
    .waitFor()
  await group.locator('h3').click()
  await group.getByAltText('Carton mark preview').waitFor()
  await group.getByAltText('Barcode preview').first().waitFor()
  await page.locator('#preparation-dialog h2').click()
  await page.mouse.move(0, 0)
  await page
    .locator('.preparation-help-popover:visible')
    .waitFor({ state: 'hidden' })
  await page.locator('#preparation-dialog').evaluate((dialog) => {
    dialog.scrollTop = 0
  })
  await page
    .locator('#preparation-dialog')
    .screenshot({ path: 'screenshots/preparation.png' })
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
  await page.goto(`${preview.url}/?state=import`)
  await page.locator('.import-latest').waitFor()
  await page
    .locator('aside[aria-label="1688toCSV"]')
    .screenshot({ path: 'screenshots/import-progress.png' })
  console.log('README screenshots refreshed from synthetic preview data')
} finally {
  await browser.close()
  await preview.close()
}
