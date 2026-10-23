import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  assignSelectedPurchaseCodes,
  editOrderProduct,
  closeOrderProduct,
  libraryBackup,
} from './smart-workspace-helpers.mjs'
import { revealCopyActions } from './copy-actions-helpers.mjs'

async function openPacking(extension, theme = 'dark') {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-errors'
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = index < 2 ? '合成玻璃罐' : '合成收纳盒'
    item.productNumber = index < 2 ? 'TEST-JAR' : 'TEST-BOX'
    item.skuProperties = [
      { label: '颜色', value: ['透明', '灰色', '原色'][index] },
    ]
    item.description = `${item.title}\n颜色：${item.skuProperties[0].value}\n货号：${item.productNumber}`
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
  await assignSelectedPurchaseCodes(page)
  const view = await editOrderProduct(page, 0)
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
    const code = view.getByLabel('Product code', { exact: true })
    const original = await code.inputValue()
    const before = await preparations(extension),
      conflicting = before[0].groups[1].baseCode
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
    await expect(
      view.locator('[role="status"]:not(.copy-text-feedback)').first()
    ).toContainText(/already|reserved|conflict/i)
    expect(await preparations(extension)).toEqual(before)
    await notice
      .getByRole('button', { name: 'Dismiss error', exact: true })
      .click()
    await expect(notice).toHaveCount(0)
    await expect(code).toHaveValue(conflicting)
    await expect(code).toHaveAttribute('aria-invalid', 'true')
    await code.fill(original)
    await expect(code).not.toHaveAttribute('aria-invalid', 'true')
    await expect(view.locator('[id^="orders-authoring-status-"]')).toHaveText(
      'Saved'
    )
    await expect(notice).toHaveCount(0)
    await closeOrderProduct(view)
    await expect(page.locator('.error-notice')).toHaveCount(0)
  })
}

test('the error popup opens the existing visual code resolver and clears after saving', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const code = view.getByLabel('Product code', { exact: true }),
    before = await preparations(extension),
    editedGroupId = before[0].groups[0].id,
    conflicting = before[0].groups[1].baseCode
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
  await expect(resolver).toBeVisible()
  const proposed = resolver.locator(
    '.conflict-edit-card input[data-code-part="baseCode"]'
  )
  await expect(proposed).not.toHaveValue(conflicting)
  const proposedCode = await proposed.inputValue()
  await expect(
    resolver.locator('.conflict-owner-card input[data-code-part="baseCode"]')
  ).toHaveValue(conflicting)
  expect(await preparations(extension)).toEqual(before)
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver).toBeHidden()
  await expect(code).not.toHaveValue(conflicting)
  await expect(
    page.locator(
      'dialog[data-action="edit-order-product"] [id^="orders-authoring-status-"]'
    )
  ).toHaveText('Saved')
  await expect(page.locator('.error-notice')).toHaveCount(0)
  const after = await preparations(extension)
  const saved = after.find((entry) => entry.orderId === before[0].orderId)
  expect(
    saved.groups.find((entry) => entry.id === editedGroupId).baseCode
  ).toBe(proposedCode)
  expect(
    saved.groups
      .filter((entry) => entry.id !== editedGroupId)
      .map((entry) => entry.baseCode)
  ).toEqual(
    before[0].groups
      .filter((entry) => entry.id !== editedGroupId)
      .map((entry) => entry.baseCode)
  )
})

test('operation errors remain nonmodal, allocate nothing and dismiss before leaving Orders', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  await closeOrderProduct(view)
  await page.locator('#clear-rows').click()
  const before = await libraryBackup(extension)
  await page.locator('#review-purchase-codes').click()
  await expect(page.locator('.error-notice')).toContainText(
    'Select product rows to review codes.'
  )
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.locator('#feedback')).toBeEmpty()
  await page.keyboard.press('Escape')
  await expect(page.locator('.error-notice')).toHaveCount(0)
  await expect(page.locator('#orders-view')).toBeVisible()
  await page.locator('#review-purchase-codes').click()
  await expect(page.locator('.error-notice')).toContainText(
    'Select product rows to review codes.'
  )
  expect((await libraryBackup(extension)).preparations).toEqual(
    before.preparations
  )
  expect((await libraryBackup(extension)).orders).toEqual(before.orders)
})

test('Escape dismisses an open source-copy menu before an underlying operation error without changing source data', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  await closeOrderProduct(view)
  await page.locator('#clear-rows').click()
  const before = await libraryBackup(extension)
  await page.locator('#review-purchase-codes').click()
  const notice = page.locator('#orders-view .error-notice')
  await expect(notice).toBeVisible()
  await revealCopyActions(page)
  const panel = page.locator('#orders-copy-actions .copy-actions-panel')
  await expect(panel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(notice).toBeVisible()
  await expect(page.locator('#orders-view')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(notice).toHaveCount(0)
  expect((await libraryBackup(extension)).orders).toEqual(before.orders)
  expect((await libraryBackup(extension)).issuedCodes).toEqual(
    before.issuedCodes
  )
})
