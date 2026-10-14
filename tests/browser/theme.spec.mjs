import { test, expect } from './extension-fixture.mjs'

const key = '1688-library-color-scheme'
async function openLibrary(extension, scheme = 'light') {
  const page = await extension.context.newPage()
  await page.emulateMedia({ colorScheme: scheme })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  return page
}
async function expectDark(page) {
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(21, 27, 24)'
  )
  await expect(page.locator('.sheet-pane')).toHaveCSS(
    'background-color',
    'rgb(32, 40, 35)'
  )
  await expect(page.locator('#search')).toHaveCSS(
    'background-color',
    'rgb(25, 34, 28)'
  )
}

test('dark is the default and a stored system preference still follows the device', async ({
  extension,
}) => {
  const page = await openLibrary(extension, 'light')
  await expectDark(page)
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
    'content',
    'dark'
  )
  await page.locator('#order-details').evaluate((dialog) => dialog.showModal())
  await expect(page.locator('#order-details')).toHaveCSS(
    'background-color',
    'rgb(32, 40, 35)'
  )
  await page.locator('#order-details').evaluate((dialog) => dialog.close())
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.emulateMedia({ colorScheme: 'light' })
  await expectDark(page)
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key)
  ).toBeNull()
  await page.evaluate((key) => localStorage.setItem(key, 'system'), key)
  await page.reload()
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(246, 247, 245)'
  )
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light dark')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expectDark(page)
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    'system'
  )
})

test('explicit light and dark themes persist and synchronize without losing overrides on OS changes', async ({
  extension,
}) => {
  const page = await openLibrary(extension)
  const second = await openLibrary(extension)
  await expectDark(page)
  await expectDark(second)
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  for (const current of [page, second]) {
    await expect(current.locator('html')).toHaveCSS(
      'background-color',
      'rgb(246, 247, 245)'
    )
    await expect(current.locator('meta[name="color-scheme"]')).toHaveAttribute(
      'content',
      'light'
    )
  }
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expectDark(page)
  await expectDark(second)
  await expect(
    second.getByRole('button', { name: 'Switch to light theme' })
  ).toBeVisible()
  await page.reload()
  await expectDark(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.emulateMedia({ colorScheme: 'light' })
  await expectDark(page)
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    'dark'
  )
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(246, 247, 245)'
  )
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expectDark(page)
  await expect(second.locator('meta[name="color-scheme"]')).toHaveAttribute(
    'content',
    'dark'
  )
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    'dark'
  )
})

test('theme controls fit a narrow viewport and remain usable when preference storage is unavailable', async ({
  extension,
}) => {
  const page = await extension.context.newPage()
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.addInitScript(() => {
    for (const name of ['getItem', 'setItem', 'removeItem']) {
      Storage.prototype[name] = () => {
        throw new DOMException('Storage unavailable', 'SecurityError')
      }
    }
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expectDark(page)
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(246, 247, 245)'
  )
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expectDark(page)
  const bounds = await page.locator('#theme-toggle').boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  expect(errors).toEqual([])
})
