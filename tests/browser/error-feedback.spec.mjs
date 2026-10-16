import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function openPacking(extension, theme = 'dark') {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-errors'
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = index < 2 ? '合成玻璃罐' : '合成收纳盒'
    item.productNumber = index < 2 ? 'TEST-JAR' : 'TEST-BOX'
  }
  const restored = await extension.inspector.evaluate(
    (record) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders: [record],
          history: [],
          images: [],
        },
      }),
    record
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  if (
    (await page
      .locator('meta[name="color-scheme"]')
      .getAttribute('content')) !== theme
  )
    await page.locator('#theme-toggle').click()
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(3)
  await rows.first().focus()
  await page.keyboard.press('Control+a')
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  const review = page.getByRole('dialog', {
    name: 'Assign product codes?',
    exact: true,
  })
  await expect(review).toBeVisible()
  await review
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const view = page.locator('#packing-view')
  await expect(view.locator('.preparation-group')).toHaveCount(2)
  return { page, view }
}

async function preparations(extension) {
  const backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(backup.ok, backup.error).toBe(true)
  return backup.data.preparations
}

async function noticeContrast(notice) {
  return notice.evaluate((element) => {
    const luminance = (css) => {
      const rgb = css
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number)
        .map((value) => {
          const channel = value / 255
          return channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4
        })
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
    }
    const background = luminance(getComputedStyle(element).backgroundColor)
    return [
      '.error-notice-title',
      '.error-notice-message',
      '.error-notice-detail',
    ].map((selector) => {
      const foreground = luminance(
        getComputedStyle(element.querySelector(selector)).color
      )
      return (
        (Math.max(background, foreground) + 0.05) /
        (Math.min(background, foreground) + 0.05)
      )
    })
  })
}

for (const theme of ['light', 'dark']) {
  test(`${theme} code errors remain readable, dismiss without losing edits and clear after correction`, async ({
    extension,
  }) => {
    const { page, view } = await openPacking(extension, theme)
    const groups = view.locator('.preparation-group')
    const code = groups.first().getByLabel('Product code', { exact: true })
    const original = await code.inputValue()
    const conflicting = await groups
      .nth(1)
      .getByLabel('Product code', { exact: true })
      .inputValue()
    const before = await preparations(extension)
    await code.fill(conflicting)
    const notice = view.locator('.error-notice')
    await expect(notice).toBeVisible()
    await expect(notice.getByRole('alert')).toContainText(
      /already|reserved|conflict/i
    )
    await expect(notice).toContainText('Your edits are still here.')
    await expect(code).toBeFocused()
    await expect(code).toHaveAttribute('aria-invalid', 'true')
    const descriptionId = await code.getAttribute('aria-errormessage')
    await expect(page.locator(`[id="${descriptionId}"]`)).toContainText(
      conflicting
    )
    for (const ratio of await noticeContrast(notice))
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    await expect(view.locator('.preparation-save-status')).toContainText(
      'Not saved'
    )
    expect(await preparations(extension)).toEqual(before)
    await notice
      .getByRole('button', { name: 'Dismiss error', exact: true })
      .click()
    await expect(notice).toHaveCount(0)
    await expect(code).toHaveValue(conflicting)
    await expect(code).toHaveAttribute('aria-invalid', 'true')
    await code.fill(original)
    await expect(code).not.toHaveAttribute('aria-invalid', 'true')
    await expect(view.locator('.preparation-save-status')).toHaveText(
      'Saved automatically'
    )
    await expect(notice).toHaveCount(0)
    await view.getByRole('button', { name: 'Orders', exact: true }).click()
    await expect(view).toBeHidden()
    await expect(page.locator('.error-notice')).toHaveCount(0)
  })
}

test('the error popup opens the existing visual code resolver and clears after saving', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const groups = view.locator('.preparation-group')
  const code = groups.first().getByLabel('Product code', { exact: true })
  const conflicting = await groups
    .nth(1)
    .getByLabel('Product code', { exact: true })
    .inputValue()
  await code.fill(conflicting)
  await view
    .locator('.error-notice')
    .getByRole('button', { name: 'Resolve code', exact: true })
    .click()
  const resolver = page.getByRole('dialog', {
    name: 'Resolve code conflict',
    exact: true,
  })
  await expect(resolver).toBeVisible()
  await expect(resolver.locator('.preparation-photo')).toHaveCount(2)
  await resolver
    .getByRole('button', { name: 'Use next available code', exact: true })
    .click()
  await expect(resolver).toBeHidden()
  await expect(code).not.toHaveValue(conflicting)
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  await expect(page.locator('.error-notice')).toHaveCount(0)
})

test('operation errors are nonmodal and dismiss before leaving the current view', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  await view.getByRole('button', { name: 'Orders', exact: true }).click()
  await page.getByLabel('Packing month', { exact: true }).fill('')
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  await expect(page.locator('.error-notice')).toContainText(
    'Choose a packing month'
  )
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.locator('#feedback')).toBeEmpty()
  await page.keyboard.press('Escape')
  await expect(page.locator('.error-notice')).toHaveCount(0)
  await expect(page.locator('#orders-view')).toBeVisible()
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  await expect(page.locator('.error-notice')).toContainText(
    'Choose a packing month'
  )
})

test('Escape dismisses an open copy menu before the underlying error notice', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const code = view
    .locator('.preparation-group')
    .first()
    .getByLabel('Product code', { exact: true })
  await code.fill('INVALID')
  const notice = view.locator('.error-notice')
  await expect(notice).toBeVisible()
  await view
    .getByRole('button', { name: 'More copy formats', exact: true })
    .click()
  const panel = view.locator('.copy-actions-panel')
  await expect(panel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(notice).toBeVisible()
  await expect(view).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(notice).toHaveCount(0)
  await expect(code).toHaveValue('INVALID')
  await expect(view).toBeVisible()
})
