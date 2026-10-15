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
  await page.locator('#packing-view h1').click()
  await page.mouse.move(0, 0)
  await page
    .locator('.preparation-help-popover:visible')
    .waitFor({ state: 'hidden' })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'screenshots/preparation.png' })
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
  await page.getByRole('button', { name: 'Orders', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('#settings-dialog h2').click()
  await page.mouse.move(0, 0)
  await page
    .locator('.preparation-help-popover:visible')
    .waitFor({ state: 'hidden' })
  await page
    .locator('#settings-dialog')
    .screenshot({ path: 'screenshots/settings.png' })
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
