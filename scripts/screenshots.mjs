import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { startPreview } from './preview.mjs'

const preview = await startPreview()
const browser = await chromium.launch({ channel: 'chromium' })
try {
  await mkdir('screenshots', { recursive: true })
  const page = await browser.newPage({
    viewport: { width: 380, height: 650 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  })
  await page.goto(preview.url)
  await page
    .getByRole('complementary', { name: '1688toCSV' })
    .screenshot({ path: 'screenshots/1688toCSV-download.png' })
  await page.setViewportSize({ width: 960, height: 420 })
  await page.goto(`${preview.url}/export.html`)
  await page.locator('tbody tr').nth(1).waitFor()
  await page.screenshot({ path: 'screenshots/csv-file-screenshot.png' })
  await page.setViewportSize({ width: 1440, height: 1060 })
  await page.goto(`${preview.url}/library.html`)
  await page.locator('#sheet-body tr').nth(7).waitFor()
  await page.screenshot({ path: 'screenshots/order-library.png' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: 'screenshots/order-library-dark.png' })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'screenshots/order-library-narrow.png' })
  console.log('README screenshots refreshed from synthetic preview data')
} finally {
  await browser.close()
  await preview.close()
}
