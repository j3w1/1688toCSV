import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

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
    'rgb(23, 21, 18)'
  )
  await expect(page.locator('.sheet-pane')).toHaveCSS(
    'background-color',
    'rgb(36, 33, 29)'
  )
  await expect(page.locator('#search')).toHaveCSS(
    'background-color',
    'rgb(29, 26, 22)'
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
    'rgb(36, 33, 29)'
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
    'rgb(246, 243, 238)'
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
      'rgb(246, 243, 238)'
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
    'rgb(246, 243, 238)'
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
    'rgb(246, 243, 238)'
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

test('both palettes keep readable text, semantic badges and primary controls', async ({
  extension,
}) => {
  const page = await openLibrary(extension)
  for (const scheme of ['dark', 'light']) {
    if (scheme === 'light')
      await page.getByRole('button', { name: 'Switch to light theme' }).click()
    const ratios = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      const luminance = (token) => {
        const hex = style.getPropertyValue(token).trim().slice(1)
        const channels = [0, 2, 4].map((offset) => {
          const channel =
            Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
          return channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4
        })
        return (
          channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
        )
      }
      const pairs = [
        ['--text', '--surface'],
        ['--muted', '--surface'],
        ['--accent-text', '--surface'],
        ['--on-accent', '--accent'],
        ['--success-text', '--success'],
        ['--warning-text', '--warning'],
        ['--info-text', '--info'],
        ['--danger-text', '--danger'],
      ]
      return pairs.map(([foreground, background]) => {
        const values = [luminance(foreground), luminance(background)].sort(
          (a, b) => a - b
        )
        return {
          foreground,
          background,
          ratio: (values[1] + 0.05) / (values[0] + 0.05),
        }
      })
    })
    for (const { foreground, background, ratio } of ratios)
      expect(
        ratio,
        `${scheme}: ${foreground} on ${background}`
      ).toBeGreaterThanOrEqual(4.5)
    await expect(page.locator('#copy-excel')).toHaveCSS(
      'background-color',
      scheme === 'dark' ? 'rgb(251, 139, 121)' : 'rgb(199, 67, 53)'
    )
    await expect(page.getByLabel('Headers', { exact: true })).toHaveCSS(
      'accent-color',
      scheme === 'dark' ? 'rgb(232, 173, 99)' : 'rgb(155, 91, 37)'
    )
  }
})

test('larger native checkboxes keep label targets, mixed selection and keyboard focus', async ({
  extension,
}) => {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const result = await extension.inspector.evaluate(
    async (orders) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders,
          history: [],
          images: [],
        },
      }),
    records
  )
  expect(result.ok, result.error).toBe(true)
  const page = await openLibrary(extension)
  await expect(page.locator('#sheet-body tr')).toHaveCount(8)
  const firstRow = page.locator('#sheet-body tr').first()
  const checkbox = firstRow.getByRole('checkbox')
  const target = firstRow.locator('label.selection-hit')
  for (const label of [
    target,
    page.locator('.order-card label.selection-hit').first(),
  ]) {
    const bounds = await label.boundingBox()
    expect(bounds.width).toBeGreaterThanOrEqual(44)
    expect(bounds.height).toBeGreaterThanOrEqual(44)
  }
  await expect(checkbox).toHaveCSS('width', '21px')
  await expect(checkbox).toHaveCSS('height', '21px')
  await expect(checkbox).toHaveCSS('appearance', 'auto')
  await target.click({ position: { x: 4, y: 4 } })
  await expect(checkbox).toBeChecked()
  await expect(page.locator('#select-rows')).toHaveJSProperty(
    'indeterminate',
    true
  )
  await expect(page.locator('#select-rows')).toHaveCSS('appearance', 'auto')
  await checkbox.focus()
  await checkbox.press('Space')
  await expect(checkbox).not.toBeChecked()
  await expect(checkbox).toHaveCSS('outline-style', 'solid')
  await expect(checkbox).toHaveCSS('outline-width', '3px')
  await expect(page.locator('#select-rows')).toHaveJSProperty(
    'indeterminate',
    false
  )

  const headers = page.getByLabel('Headers', { exact: true })
  await headers.locator('..').click({ position: { x: 28, y: 20 } })
  await expect(headers).toBeChecked()
  await headers.evaluate((input) => {
    input.disabled = true
  })
  await expect(headers).toBeDisabled()
  await expect(headers).toHaveCSS('cursor', 'not-allowed')
  await expect(headers).toHaveCSS('opacity', '0.5')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(checkbox).toHaveCSS('accent-color', 'rgb(155, 91, 37)')
  await checkbox.focus()
  await checkbox.press('Space')
  await expect(checkbox).toBeChecked()
  await expect(checkbox).toHaveCSS('outline-color', 'rgb(149, 81, 29)')
  expect(extension.unexpectedRequests).toEqual([])
})
