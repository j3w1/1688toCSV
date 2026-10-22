import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function openLibrary(extension, { skipped = false } = {}) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.purchasedAt = '2026-10-12T10:15:00+08:00'
  record.snapshot.sellerName = 'Synthetic shortcut store'
  record.snapshot.sellerMemberLogin = 'synthetic-shortcuts'
  if (skipped)
    record.packingExcludedEntryIds = record.snapshot.items.map(
      (item) => item.entryId
    )
  const response = await extension.inspector.evaluate(
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
  expect(response.ok, response.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-17T04:00:00Z'))
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(3)
  await rows.first().focus()
  await page.keyboard.press('Control+a')
  return { page, rows }
}

test('Ctrl+Enter reviews the selected eligible products through the existing Prepare action', async ({
  extension,
}) => {
  const { page } = await openLibrary(extension)
  await expect(page.locator('#prepare-orders')).toHaveAttribute(
    'aria-keyshortcuts',
    'Control+Enter Meta+Enter'
  )
  await page.keyboard.press('Control+Enter')
  const review = page.getByRole('dialog', {
    name: 'Assign product codes?',
    exact: true,
  })
  await expect(review).toBeVisible()
  await expect(review.locator('.packing-review-item')).toHaveCount(3)
  // The same shortcut does not submit a confirmation or trigger a second action.
  await page.keyboard.press('Control+Enter')
  await expect(review).toBeVisible()
  await expect(page.locator('#packing-view')).not.toBeVisible()
  await page.keyboard.press('Escape')
  await expect(review).not.toBeVisible()
})

test('Ctrl+Enter respects skipped-only and disabled preparation scopes', async ({
  extension,
}) => {
  const { page, rows } = await openLibrary(extension, { skipped: true })
  await expect(page.locator('#prepare-orders')).toBeDisabled()
  await page.keyboard.press('Control+Enter')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.locator('#packing-view')).not.toBeVisible()
  await page.locator('#packing-settings').focus()
  await page.keyboard.press('Control+Enter')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await rows
    .first()
    .getByRole('button', { name: 'Skipped — include in packing', exact: true })
    .click()
  await expect(page.locator('#prepare-orders')).toBeEnabled()
  // A locked control must stay authoritative even if a keyboard event arrives.
  await page.locator('#prepare-orders').evaluate((button) => {
    button.disabled = true
  })
  await rows.first().focus()
  await page.keyboard.press('Control+Enter')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.locator('#packing-view')).not.toBeVisible()
})

test('Ctrl+Enter remains available from checkboxes without changing their native Space behavior', async ({
  extension,
}) => {
  const { page, rows } = await openLibrary(extension)
  const checkbox = page.locator('#changes-only')
  await checkbox.focus()
  await page.keyboard.press('Space')
  await expect(checkbox).toBeChecked()
  await page.keyboard.press('Space')
  await expect(checkbox).not.toBeChecked()
  // Changing the display filter clears row selection. Restore a real eligible
  // selection before testing the same Prepare shortcut from checkbox focus.
  await rows.first().focus()
  await page.keyboard.press('Control+a')
  await expect(page.locator('#prepare-orders')).toBeEnabled()
  await checkbox.focus()
  await expect(checkbox).toBeFocused()
  await page.keyboard.press('Control+Enter')
  await expect(
    page.getByRole('dialog', { name: 'Assign product codes?', exact: true })
  ).toBeVisible()
})

test('contextual shortcuts retain editor, dialog, browser and composition behavior with translated hover help', async ({
  extension,
}) => {
  const { page, rows } = await openLibrary(extension)
  await page.keyboard.press('Alt+Shift+f')
  await expect(page.locator('#search')).toBeFocused()
  await page.keyboard.press('Control+Enter')
  await page.keyboard.press('Alt+Shift+s')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await rows.first().focus()
  await page.keyboard.press('Alt+Shift+r')
  await expect(page.locator('#order-search')).toBeFocused()
  await rows.first().focus()
  await page.keyboard.press('Alt+Shift+c')
  const copy = page.locator('#orders-copy-actions .copy-actions-panel')
  await expect(copy).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(copy).not.toBeVisible()
  await page.keyboard.press('Alt+Shift+s')
  await expect(page.locator('#settings-dialog')).toBeVisible()
  await page.keyboard.press('Alt+Shift+t')
  await expect(page.locator('#activity-drawer')).not.toBeVisible()
  await page
    .getByRole('button', { name: 'Close settings', exact: true })
    .click()
  await expect(page.locator('#settings-dialog')).not.toBeVisible()
  await rows.first().focus()
  const handled = await rows.first().evaluate((row) => {
    return ['p', 's', 'f', 'r', 'c', 'v'].map((key) => {
      const event = new KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      row.dispatchEvent(event)
      return event.defaultPrevented
    })
  })
  expect(handled).toEqual([false, false, false, false, false, false])
  await rows.first().evaluate((row) => {
    for (const extra of [{ isComposing: true }, { repeat: true }])
      row.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
          ...extra,
        })
      )
  })
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  for (const [language, caption] of [
    ['es', 'Atajo fuera de los campos de texto'],
    ['zh', '非文本输入时的快捷键'],
    ['en', 'Shortcut outside text fields'],
  ]) {
    await page.locator(`#language-toggle [data-language="${language}"]`).click()
    await page.locator('#prepare-orders').hover()
    const help = page.getByRole('tooltip')
    await expect(help).toContainText(caption)
    await expect(help.locator('kbd')).toHaveText('Ctrl+Enter')
    await page.mouse.move(2, 2)
    await expect(help).toHaveCount(0)
  }
})

test('packing shortcuts call the existing undo, redo, arrange, grouping and return actions', async ({
  extension,
}) => {
  const { page } = await openLibrary(extension)
  await page.keyboard.press('Control+Enter')
  await page
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const packing = page.locator('#packing-view')
  await expect(packing).toBeVisible()
  const code = packing
    .getByRole('textbox', { name: 'Product code', exact: true })
    .first()
  await expect(code).toHaveValue(/^CE/)
  const before = await code.inputValue()
  const after = before.slice(0, -2) + '98'
  await code.fill(after)
  await code.press('Tab')
  await expect(packing.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  const undo = packing.getByRole('button', { name: 'Undo', exact: true })
  await expect(undo).toBeEnabled()
  await undo.focus()
  await page.keyboard.press('Control+z')
  await expect(code).toHaveValue(before)
  await expect(
    packing.getByRole('button', { name: 'Redo', exact: true })
  ).toBeEnabled()
  await page.keyboard.press('Control+Shift+z')
  await expect(code).toHaveValue(after)
  await packing.getByRole('button', { name: 'Organize', exact: true }).click()
  await page.keyboard.press('Alt+Shift+a')
  await expect(
    packing.getByRole('group', { name: 'Arrange packing', exact: true })
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await packing.getByRole('button', { name: 'Done', exact: true }).click()
  // Undo/redo restores authoring and leaves a fresh selection scope. Grouping
  // must still obey its normal requirement for selected products.
  await packing.getByRole('button', { name: 'Select all', exact: true }).click()
  await expect(
    packing.getByRole('button', { name: 'Grouping tools', exact: true })
  ).toBeEnabled()
  await page.keyboard.press('Alt+Shift+g')
  await expect(
    packing.getByRole('group', {
      name: 'Selected product grouping',
      exact: true,
    })
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Alt+Shift+o')
  await expect(packing).not.toBeVisible()
})
