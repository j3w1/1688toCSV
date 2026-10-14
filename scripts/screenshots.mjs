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
  await page.screenshot({ path: 'screenshots/order-library.png' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: 'screenshots/order-library-dark.png' })
  console.log('README screenshots refreshed from synthetic preview data')
} finally {
  await browser.close()
  await preview.close()
}
