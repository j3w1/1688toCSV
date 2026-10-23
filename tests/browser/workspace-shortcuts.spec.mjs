import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  seedSmartOrder,
  openSmartLibrary,
  createSmartContainer,
} from './smart-workspace-helpers.mjs'

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

test('retired Ctrl+Enter cannot prepare or assign; explicit purchase-code review still cancels without allocation', async ({
  extension,
}) => {
  const { page } = await openLibrary(extension)
  await expect(page.locator('#prepare-orders')).toHaveCount(0)
  await page.keyboard.press('Control+Enter')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  const assignments = () =>
    extension.inspector.evaluate(async () =>
      (await window.testRepository).listPreparations()
    )
  expect(await assignments()).toEqual([])
  await page.locator('[data-action="review-purchase-codes"]').click()
  const review = page.locator('.purchase-code-review')
  await expect(review).toBeVisible()
  await page.keyboard.press('Control+Enter')
  await expect(review).toBeVisible()
  expect(await assignments()).toEqual([])
  await page.keyboard.press('Escape')
  await expect(review).toHaveCount(0)
  expect(await assignments()).toEqual([])
})

test('legacy skipped evidence cannot reopen Prepare or silently remove the purchase source through a shortcut', async ({
  extension,
}) => {
  const { page, rows } = await openLibrary(extension, { skipped: true })
  const before = await extension.inspector.evaluate(async () =>
    (await (await window.testRepository).listOrders()).map(
      (record) => record.snapshot
    )
  )
  await page.keyboard.press('Control+Enter')
  await page.locator('#packing-settings').focus()
  await page.keyboard.press('Control+Enter')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(rows.locator('.packing-exclusion-toggle')).toHaveCount(0)
  await expect(page.locator('#packing-view')).not.toBeVisible()
  const after = await extension.inspector.evaluate(async () =>
    (await (await window.testRepository).listOrders()).map(
      (record) => record.snapshot
    )
  )
  expect(after).toEqual(before)
})

test('native Space selects explicit checkboxes without opening details or reviving Ctrl+Enter preparation', async ({
  extension,
}) => {
  const { page, rows } = await openLibrary(extension)
  const checkbox = page.locator('#changes-only')
  await checkbox.focus()
  await page.keyboard.press('Space')
  await expect(checkbox).toBeChecked()
  await page.keyboard.press('Space')
  await expect(checkbox).not.toBeChecked()
  const selection = rows.first().locator('.row-number input[type="checkbox"]')
  await selection.focus()
  await page.keyboard.press('Space')
  await expect(selection).toBeChecked()
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Control+Enter')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(selection).toBeChecked()
  await page.keyboard.press('Space')
  await expect(selection).not.toBeChecked()
  await expect(rows.first()).toHaveAttribute('aria-selected', 'false')
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
    await page.locator('#packing-settings').hover()
    const help = page.getByRole('tooltip')
    await expect(help).toContainText(caption)
    await expect(help.locator('kbd')).toHaveText('Alt+Shift+S')
    await page.mouse.move(2, 2)
    await expect(help).toHaveCount(0)
  }
})

test('Packing shortcuts undo and redo loading, retire Arrange/Grouping and return to Orders without source mutations', async ({
  extension,
}) => {
  const ref = await seedSmartOrder(extension, { physical: true }),
    id = await createSmartContainer(extension, [ref]),
    page = await openSmartLibrary(extension)
  const before = await extension.inspector.evaluate(
    async (ref) =>
      (await window.testRepository).getOrder(ref.orderId, {
        accountId: ref.accountId,
      }),
    ref
  )
  await page.goto(
    `${extension.extensionBaseUrl}/library.html#workspace=packing&containerId=${id}&view=loading`
  )
  await page.locator('[data-action="mark-all-loaded"]').click()
  const undo = page.locator('[data-action="undo-container-loading"]')
  await expect(undo).toBeEnabled()
  await undo.focus()
  await page.keyboard.press('Control+z')
  const states = () =>
    extension.inspector.evaluate(
      async (id) =>
        (
          await (await window.testRepository).getContainerView({ id })
        ).cartons.map((carton) => carton.state),
      id
    )
  await expect
    .poll(async () => {
      const values = await states()
      return (
        values.length > 0 && values.every((state) => state === 'unconfirmed')
      )
    })
    .toBe(true)
  await expect(
    page.locator('[data-action="redo-container-loading"]')
  ).toBeEnabled()
  await page.keyboard.press('Control+Shift+z')
  await expect
    .poll(async () => {
      const values = await states()
      return values.length > 0 && values.every((state) => state === 'loaded')
    })
    .toBe(true)
  await page.keyboard.press('Alt+Shift+a')
  await page.keyboard.press('Alt+Shift+g')
  await expect(
    page.locator(
      '#packing-view [data-action="organize-packing"],#packing-view [data-action="open-grouping-menu"]'
    )
  ).toHaveCount(0)
  await expect(
    page.locator(
      '#packing-view .packing-organize-group,#packing-view .group-name-editor'
    )
  ).toHaveCount(0)
  await page.keyboard.press('Alt+Shift+o')
  await expect(page.locator('#orders-view')).toBeVisible()
  const after = await extension.inspector.evaluate(
    async (ref) =>
      (await window.testRepository).getOrder(ref.orderId, {
        accountId: ref.accountId,
      }),
    ref
  )
  expect(after.snapshot).toEqual(before.snapshot)
  expect(after.productPhotos).toEqual(before.productPhotos)
})
