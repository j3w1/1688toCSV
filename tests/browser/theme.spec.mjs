import { test, expect } from './extension-fixture.mjs'

const key = '1688-library-color-scheme'
async function openLibrary(extension, scheme = 'light') {
  const page = await extension.context.newPage()
  await page.emulateMedia({ colorScheme: scheme })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  return page
}
async function choose(page, preference) {
  await page.locator('.settings').evaluate((element) => {
    element.open = true
  })
  await page.getByLabel('Appearance', { exact: true }).selectOption(preference)
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

test('system theme responds to device changes and includes native controls and dialogs', async ({
  extension,
}) => {
  const page = await openLibrary(extension, 'dark')
  await expectDark(page)
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light dark')
  await page.locator('#order-details').evaluate((dialog) => dialog.showModal())
  await expect(page.locator('#order-details')).toHaveCSS(
    'background-color',
    'rgb(32, 40, 35)'
  )
  await page.locator('#order-details').evaluate((dialog) => dialog.close())
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(246, 247, 245)'
  )
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key)
  ).toBeNull()
})

test('explicit themes persist, synchronize tabs and return to system without losing overrides on OS changes', async ({
  extension,
}) => {
  const page = await openLibrary(extension)
  const second = await openLibrary(extension)
  await choose(page, 'dark')
  await expectDark(page)
  await expectDark(second)
  await expect(second.locator('#theme-preference')).toHaveValue('dark')
  await page.reload()
  await expectDark(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.emulateMedia({ colorScheme: 'light' })
  await expectDark(page)
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    'dark'
  )
  await page.emulateMedia({ colorScheme: 'dark' })
  await choose(page, 'light')
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(246, 247, 245)'
  )
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
  await choose(page, 'system')
  await expectDark(page)
  await expect(second.locator('#theme-preference')).toHaveValue('system')
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key)
  ).toBeNull()
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
  await page.getByText('Settings', { exact: true }).click()
  await page.getByLabel('Appearance', { exact: true }).selectOption('dark')
  await expectDark(page)
  const bounds = await page.locator('.settings-panel').boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  expect(errors).toEqual([])
})
