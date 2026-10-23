import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { assignSelectedPurchaseCodes } from './smart-workspace-helpers.mjs'

async function openLibrary(extension, fallback = false) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const record = records[0]
  record.snapshot.sellerMemberLogin = 'synthetic-dialog-dismiss'
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = '合成玻璃罐'
    item.productNumber = `SYNTHETIC-${index}`
    item.skuProperties = []
    item.description = item.title
  }
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
    [record]
  )
  expect(result.ok, result.error).toBe(true)
  const page = await extension.context.newPage()
  if (fallback)
    await page.addInitScript(() => {
      delete HTMLDialogElement.prototype.closedBy
      delete HTMLDialogElement.prototype.requestClose
    })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  return page
}
async function backdrop(page, dialog) {
  const box = await dialog.boundingBox()
  const x = box.x > 10 ? box.x - 5 : box.x + box.width + 5
  await page.mouse.click(x, Math.max(2, box.y + 10))
}

for (const fallback of [false, true]) {
  test(`dialogs dismiss only on backdrop clicks (${fallback ? 'Chrome 120 fallback' : 'native'})`, async ({
    extension,
  }) => {
    const page = await openLibrary(extension, fallback)
    const dialog = page.locator('#order-details')
    await dialog.evaluate((node) => {
      node.innerHTML = '<h2>Dialog test</h2><p>Selection stays inside.</p>'
      node.showModal()
    })
    // Emulate old Chrome: current Chromium still recognizes the native attribute
    // even after its API accessor has been removed for the fallback test.
    if (fallback)
      await dialog.evaluate((node) =>
        node.setAttribute('closedby', 'closerequest')
      )
    await dialog.locator('p').click()
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    await page.mouse.click(box.x + 2, box.y + 2)
    await expect(dialog).toBeVisible()
    await page.mouse.move(box.x + 30, box.y + 30)
    await page.mouse.down()
    await page.mouse.move(box.x - 5, box.y + 30)
    await page.mouse.up()
    await expect(dialog).toBeVisible()
    await backdrop(page, dialog)
    await expect(dialog).not.toBeVisible()
    await dialog.evaluate((node) => node.showModal())
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  })
}

test('ordinary copying starts directly without a confirmation overlay', async ({
  extension,
}) => {
  const page = await openLibrary(extension)
  await page.evaluate(() => {
    window.clipboardWrites = 0
    navigator.clipboard.write = async () => {
      window.clipboardWrites++
    }
    navigator.clipboard.writeText = async () => {
      window.clipboardWrites++
    }
  })
  await page
    .getByRole('button', { name: 'More copy formats', exact: true })
    .click()
  await page.getByRole('button', { name: 'Copy values', exact: true }).click()
  const dialog = page.getByRole('dialog', {
    name: 'Confirm operation',
    exact: true,
  })
  await expect(dialog).not.toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Copy values', exact: true })
  ).toBeEnabled()
  await expect.poll(() => page.evaluate(() => window.clipboardWrites)).toBe(1)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
})

test('label backdrop saves a valid blurred edit, preserves Escape restore, and keeps invalid edits open', async ({
  extension,
}) => {
  const page = await openLibrary(extension)
  await page.locator('#select-rows').click()
  await assignSelectedPurchaseCodes(page)
  await expect(page.locator('#sheet-body .row-code-copy').first()).toHaveText(
    /^CE2610\d{4}/
  )
  const open = page
    .locator('#sheet-body tr[data-selection-key]')
    .first()
    .getByRole('button', { name: 'Barcode', exact: true })
  await open.click()
  const label = page.getByRole('dialog', { name: 'Label editor', exact: true })
  const spanish = label.getByRole('textbox', {
    name: 'Spanish product name',
    exact: true,
  })
  await expect(
    label.getByRole('button', { name: 'Copy label', exact: true })
  ).toBeEnabled({ timeout: 20000 })
  await page.setViewportSize({ width: 720, height: 430 })
  const labelActions = label.locator('.detail-dialog-heading')
  const labelBody = label.locator('#label-content')
  const actionBounds = await labelActions.boundingBox()
  expect(
    await labelBody.evaluate((node) => node.scrollHeight > node.clientHeight)
  ).toBe(true)
  await labelBody.evaluate((node) => node.scrollTo(0, node.scrollHeight))
  expect(await labelActions.boundingBox()).toEqual(actionBounds)
  await expect(
    labelActions.getByRole('button', { name: 'Copy label', exact: true })
  ).toBeInViewport()
  await expect(
    labelActions.getByRole('button', {
      name: 'Close label editor',
      exact: true,
    })
  ).toBeInViewport()
  await page.setViewportSize({ width: 1280, height: 900 })
  await spanish.fill('frasco transparente')
  await backdrop(page, label)
  await expect(label).not.toBeVisible({ timeout: 20000 })
  await open.click()
  await expect(spanish).toHaveValue('FRASCO TRANSPARENTE')
  await spanish.fill('discarded edit')
  await spanish.press('Escape')
  await expect(spanish).toHaveValue('FRASCO TRANSPARENTE')
  await expect(label).toBeVisible()
  await spanish.fill('frasco guardado al cerrar')
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  await expect(label).not.toBeVisible({ timeout: 20000 })
  await open.click()
  await expect(spanish).toHaveValue('FRASCO GUARDADO AL CERRAR')
  const code = label.getByRole('textbox', { name: 'Variant code', exact: true })
  await code.fill('INVALID!')
  await backdrop(page, label)
  await expect(label.locator('.error-notice-message')).toContainText(
    'Variant code uses letters only',
    { timeout: 20000 }
  )
  await expect(label).toBeVisible()
  await code.press('Escape')
  await backdrop(page, label)
  await expect(label).not.toBeVisible({ timeout: 20000 })
})
