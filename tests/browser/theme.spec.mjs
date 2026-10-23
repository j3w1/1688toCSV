import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { revealCopyActions } from './copy-actions-helpers.mjs'

const key = '1688-library-color-scheme'

test('workspace text and validation colors stay readable on every interactive surface in both themes', async ({
  extension,
}) => {
  const page = await openLibrary(extension, 'dark')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) =>
        (document.querySelector('meta[name="color-scheme"]').content = theme),
      theme
    )
    const contrast = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement)
      const color = (name) => styles.getPropertyValue(`--${name}`).trim()
      const luminance = (hex) => {
        const rgb = hex
          .slice(1)
          .match(/../g)
          .map((part) => parseInt(part, 16) / 255)
          .map((value) =>
            value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
          )
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
      }
      const ratio = (foreground, background) => {
        const first = luminance(color(foreground)),
          second = luminance(color(background))
        return (
          (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
        )
      }
      const pairs = []
      for (const foreground of [
        'text',
        'muted',
        'accent-text',
        'danger-text',
        'error',
        'variant-code',
        'size-code',
      ])
        for (const background of [
          'page',
          'surface',
          'field',
          'hover',
          'selected',
        ])
          pairs.push({
            foreground,
            background,
            ratio: ratio(foreground, background),
          })
      for (const background of ['success', 'warning', 'info', 'danger'])
        pairs.push({
          foreground: `${background}-text`,
          background,
          ratio: ratio(`${background}-text`, background),
        })
      pairs.push({
        foreground: 'on-accent',
        background: 'accent',
        ratio: ratio('on-accent', 'accent'),
      })
      return pairs
    })
    for (const pair of contrast)
      expect(
        pair.ratio,
        `${theme}: ${pair.foreground} on ${pair.background}`
      ).toBeGreaterThanOrEqual(4.5)
    // Explicit workspace theme wins even when the device preference is opposite.
    await page.evaluate(() => {
      const error = document.createElement('p')
      error.className = 'label-editor-error'
      error.textContent = 'Invalid code'
      document.body.append(error)
    })
    const error = page.locator('.label-editor-error').last()
    expect(await error.evaluate((node) => getComputedStyle(node).color)).toBe(
      theme === 'light' ? 'rgb(156, 53, 66)' : 'rgb(255, 182, 166)'
    )
    await error.evaluate((node) => node.remove())
  }
})
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

test('preference checkboxes keep generous labels and native keyboard focus alongside explicit row checkboxes', async ({
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
  await page.getByRole('button', { name: 'Show all', exact: true }).click()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    8
  )
  const productChecks = page.locator(
    '#sheet-body .row-number input[type=checkbox]'
  )
  await expect(productChecks).toHaveCount(8)
  await expect(page.locator('.order-card input[type=checkbox]')).toHaveCount(2)
  await productChecks.first().focus()
  await productChecks.first().press('Space')
  await expect(productChecks.first()).toBeChecked()
  await expect(
    page.locator('#sheet-body tr[aria-selected="true"]')
  ).toHaveCount(1)
  await productChecks.first().press('Space')
  await expect(productChecks.first()).not.toBeChecked()
  await revealCopyActions(page)
  const headers = page.getByLabel('Headers', { exact: true })
  const target = headers.locator('..')
  const bounds = await target.boundingBox()
  expect(bounds.width).toBeGreaterThanOrEqual(44)
  expect(bounds.height).toBeGreaterThanOrEqual(44)
  await expect(headers).toHaveCSS('width', '21px')
  await expect(headers).toHaveCSS('height', '21px')
  await expect(headers).toHaveCSS('appearance', 'auto')
  await target.click({ position: { x: 28, y: 20 } })
  await expect(headers).toBeChecked()
  await headers.focus()
  await headers.press('Space')
  await expect(headers).not.toBeChecked()
  await expect(headers).toHaveCSS('outline-style', 'solid')
  await expect(headers).toHaveCSS('outline-width', '3px')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await revealCopyActions(page)
  await expect(headers).toHaveCSS('accent-color', 'rgb(155, 91, 37)')
  await headers.focus()
  await headers.press('Space')
  await expect(headers).toBeChecked()
  await expect(headers).toHaveCSS('outline-color', 'rgb(149, 81, 29)')
  await headers.evaluate((input) => {
    input.disabled = true
  })
  await expect(headers).toBeDisabled()
  await expect(headers).toHaveCSS('cursor', 'not-allowed')
  await expect(headers).toHaveCSS('opacity', '0.5')
  expect(extension.unexpectedRequests).toEqual([])
})
