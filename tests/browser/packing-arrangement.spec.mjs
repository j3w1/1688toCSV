import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { revealCopyActions } from './copy-actions-helpers.mjs'

async function setup(
  extension,
  { missingCategory = false, needsSize = false } = {}
) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const records = ['z', 'a', 'z'].map((seller, index) => {
    const copy = structuredClone(record)
    copy.snapshot.orderId = String(7200000000000000000n + BigInt(index))
    copy.snapshot.sourceUrl = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${copy.snapshot.orderId}`
    copy.snapshot.sellerName = `Synthetic ${seller} store`
    copy.snapshot.sellerMemberLogin = `synthetic-${seller}`
    copy.snapshot.items.forEach((item, index) => {
      item.title = `玻璃花瓶${index}`
      item.productNumber = `VASE-${index}`
      item.skuProperties = []
      if (needsSize && index < 2) {
        item.title = '玻璃花瓶0'
        item.productNumber = 'VASE-0'
        item.skuProperties = [
          { label: '尺寸', value: index ? '另一种尺寸' : '未知尺寸' },
        ]
      }
    })
    return copy
  })
  const fixture = await extension.context.newPage()
  await fixture.goto(`${extension.origin}/unsupported`)
  const seeded = await fixture.evaluate(
    async ({ records, origin, missingCategory, needsSize }) => {
      const { openDatabase } = await import(`${origin}/src/database.js`)
      const { createPreparation } = await import(
        `${origin}/src/packing-model.js`
      )
      const db = await openDatabase()
      await db.restoreBackup({
        format: '1688-order-library',
        version: 1,
        exportedAt: new Date().toISOString(),
        orders: records,
        history: [],
        images: [],
      })
      const saved = await db.savePreparations(
        records.map(({ snapshot }) => {
          const prep = createPreparation(snapshot, '2026-10')
          prep.groups.forEach((group) => {
            group.category = '玻璃'
            group.spanishName = 'FLORERO'
          })
          return prep
        })
      )
      if (missingCategory) {
        saved[0].groups[0].category = ''
        saved[0].groups[0].naming = {
          category: { source: 'manual', value: '' },
          spanishName: { source: 'manual', value: 'FLORERO' },
        }
      }
      if (needsSize) {
        saved[0].groups[0].variants[0].needsSizeMapping = true
        saved[0].groups[0].variants[0].size = '未知尺寸'
      }
      saved[0].groups.reverse()
      await db.savePreparations(saved)
      return { saved, backup: await db.exportBackup() }
    },
    { records, origin: extension.origin, missingCategory, needsSize }
  )
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    seeded.backup
  )
  expect(restored.ok, restored.error).toBe(true)
  const response = seeded.saved
  await fixture.close()
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-16T04:00:00Z'))
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    9
  )
  await page.locator('#prepare-orders').click()
  await expect(page.locator('#packing-view')).toBeVisible()
  return { page, records, response, view: page.locator('#packing-view') }
}

test('arrangement persists, retains codes and exports the final manual order', async ({
  extension,
}) => {
  const { page, view, records, response } = await setup(extension)
  const arrange = async (name) => {
    await view
      .getByRole('button', { name: 'Arrange packing', exact: true })
      .click()
    await view
      .locator('.packing-arrange')
      .getByRole('button', { name, exact: true })
      .click()
    await expect(view.locator('.preparation-save-status')).toHaveText(
      'Saved automatically'
    )
  }
  const ids = () =>
    view
      .locator('[data-packing-order]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.packingOrder))
  await arrange('Store, then group code')
  expect(await ids()).toEqual([
    records[1].snapshot.orderId,
    records[0].snapshot.orderId,
    records[2].snapshot.orderId,
  ])
  const codes = response
    .flatMap((draft) => draft.groups.map((group) => group.baseCode))
    .sort()
  expect(
    (
      await view
        .locator('.group-code-editor')
        .evaluateAll((nodes) => nodes.map((node) => node.value))
    ).sort()
  ).toEqual(codes)
  await arrange('Group code')
  expect(await ids()).toEqual([
    records[0].snapshot.orderId,
    records[2].snapshot.orderId,
    records[1].snapshot.orderId,
  ])
  await view
    .locator('.packing-order-header > .reorder-handle')
    .first()
    .press('ArrowDown')
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  const finalOrder = await ids()
  await expect(
    view.getByRole('button', { name: 'Undo', exact: true })
  ).toBeEnabled()
  await page.reload()
  await page.locator('#prepare-orders').click()
  await expect(view).toBeVisible()
  expect(await ids()).toEqual(finalOrder)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await view.getByRole('button', { name: 'Select all', exact: true }).click()
  await revealCopyActions(page, view)
  await view
    .getByRole('button', { name: 'Copy group codes', exact: true })
    .click()
  const expected = await view
    .locator('.group-code-editor')
    .evaluateAll((nodes) => nodes.map((node) => node.value))
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).split('\r\n')
  ).toEqual(expected)
})

test('Escape works from header focus, shortcuts clear all packing and order/product selection without touching text edits', async ({
  extension,
}) => {
  const { page, view } = await setup(extension)
  await page.locator('#theme-toggle').focus()
  await page.keyboard.press('Escape')
  await expect(page.locator('#orders-view')).toBeVisible()
  const orders = page.locator('#order-list [data-selection-key]')
  await orders.first().focus()
  await page.keyboard.press('Control+a')
  await expect(page.locator('#order-list [aria-selected="true"]')).toHaveCount(
    3
  )
  await page.keyboard.press('Control+d')
  await expect(page.locator('#order-list [aria-selected="true"]')).toHaveCount(
    0
  )
  const products = page.locator('#sheet-body tr[data-selection-key]')
  await products.first().focus()
  await page.keyboard.press('Control+a')
  await expect(page.locator('#sheet-body [aria-selected="true"]')).toHaveCount(
    9
  )
  await page.locator('#theme-toggle').focus()
  await page.keyboard.press('Control+d')
  await expect(page.locator('#sheet-body [aria-selected="true"]')).toHaveCount(
    0
  )
  await page.locator('#prepare-orders').click()
  await view.getByRole('button', { name: 'Select all', exact: true }).focus()
  await page.keyboard.press('Control+a')
  await expect(view.locator('.preparation-copy-scope')).toContainText(
    '9 selected products'
  )
  await page.keyboard.press('Control+d')
  await expect(
    view.getByRole('button', { name: 'Copy Excel image', exact: true })
  ).toBeDisabled()
  const input = view.locator('.group-name-editor').first()
  await input.fill('FLORERO EDITADO')
  await input.press('Control+a')
  expect(
    await input.evaluate((node) => node.selectionEnd - node.selectionStart)
  ).toBe(15)
  await page.keyboard.press('Escape')
  await expect(view).toBeHidden()
})

test('small order links open their own order without changing selection', async ({
  extension,
}) => {
  const { page, view, records } = await setup(extension)
  const expectedId = records[0].snapshot.orderId
  await extension.context.route('https://air.1688.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>Synthetic order</title>',
    })
  )
  const link = view.locator(
    `[data-packing-order="${expectedId}"] .order-source-link`
  )
  const selectionBefore = await view
    .locator('.preparation-copy-scope')
    .textContent()
  await expect(link).toHaveAttribute(
    'href',
    new RegExp(`orderId=${expectedId}$`)
  )
  const popupPromise = page.waitForEvent('popup')
  await link.click()
  const popup = await popupPromise
  await popup.waitForLoadState()
  expect(popup.url()).toContain(`orderId=${expectedId}`)
  await popup.close()
  await expect(view).toBeVisible()
  await expect(view.locator('.preparation-copy-scope')).toHaveText(
    selectionBefore
  )
  await page.keyboard.press('Escape')
  await expect(page.locator('#order-list .order-source-link')).toHaveCount(3)
  await expect(page.locator('#sheet-body .order-source-link')).toHaveCount(3)
})

test('missing category and unresolved size identify the product and reveal its editable field', async ({
  extension,
}) => {
  const { page, view, records } = await setup(extension, {
    missingCategory: true,
    needsSize: true,
  })
  await view.getByRole('button', { name: 'Select all', exact: true }).click()
  await view
    .getByRole('button', { name: 'Copy Excel image', exact: true })
    .click()
  const notice = page.locator('.image-copy-dialog .error-notice')
  await expect(notice).toContainText(records[0].snapshot.orderId)
  await expect(notice.locator('img')).toHaveCount(1)
  await notice
    .getByRole('button', { name: 'Add Chinese category', exact: true })
    .click()
  const category = view.locator(
    '[data-packing-field="category"].resolution-highlight'
  )
  await expect(category).toBeFocused()
  await category.fill('玻璃')
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  await view.getByRole('button', { name: 'Select all', exact: true }).click()
  await revealCopyActions(page, view)
  await view
    .getByRole('button', { name: 'Copy barcode images', exact: true })
    .click()
  const sizeError = view.locator('.error-notice')
  await expect(sizeError).toContainText('未知尺寸')
  await sizeError
    .getByRole('button', { name: 'Map size code', exact: true })
    .click()
  const size = view.locator('[data-packing-field="size"].resolution-highlight')
  await expect(size).toBeFocused()
  await size.fill('M')
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
})

test('a batch barcode render failure identifies its saved variant and opens the suffix to fix', async ({
  extension,
}) => {
  const { page, view, records } = await setup(extension)
  const order = view.locator(
    `[data-packing-order="${records[0].snapshot.orderId}"]`
  )
  const suffix = order.locator('[data-packing-field="variant"]').first()
  await suffix.fill('A'.repeat(30))
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  await view.getByRole('button', { name: 'Select all', exact: true }).click()
  await revealCopyActions(page, view)
  await view
    .getByRole('button', { name: 'Copy barcode images', exact: true })
    .click()
  const notice = page.locator('.image-copy-dialog .error-notice')
  await expect(notice).toContainText('too long for the label width')
  await expect(notice).toContainText(records[0].snapshot.orderId)
  await expect(notice.locator('img')).toHaveCount(1)
  await notice
    .getByRole('button', { name: 'Show affected field', exact: true })
    .click()
  await expect(
    order.locator('[data-packing-field="variant"].resolution-highlight')
  ).toBeFocused()
})

test('arranging a selected subset preserves the hidden order slot and saved revision', async ({
  extension,
}) => {
  const { page, view, records } = await setup(extension)
  const arrange = async (name) => {
    await view
      .getByRole('button', { name: 'Arrange packing', exact: true })
      .click()
    await view
      .locator('.packing-arrange')
      .getByRole('button', { name, exact: true })
      .click()
    await expect(view.locator('.preparation-save-status')).toHaveText(
      'Saved automatically'
    )
  }
  await arrange('Group code')
  const saved = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  const hiddenBefore = saved.data.preparations.find(
    (prep) => prep.orderId === records[2].snapshot.orderId
  )
  await page.keyboard.press('Escape')
  for (const [index, record] of records.slice(0, 2).entries()) {
    await page
      .locator(`#order-list [data-selection-key="${record.snapshot.orderId}"]`)
      .focus()
    await page.keyboard.press(index ? 'Control+Space' : 'Space')
  }
  await page.locator('#select-rows').click()
  await page.locator('#prepare-orders').click()
  await expect(view.locator('[data-packing-order]')).toHaveCount(2)
  await arrange('Store')
  const after = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(
    after.data.preparations.find(
      (prep) => prep.orderId === hiddenBefore.orderId
    )
  ).toEqual(hiddenBefore)
  await page.reload()
  await page.locator('#prepare-orders').click()
  await expect(view.locator('[data-packing-order]')).toHaveCount(3)
  expect(
    await view
      .locator('[data-packing-order]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.packingOrder))
  ).toEqual(
    [records[1], records[2], records[0]].map(
      (record) => record.snapshot.orderId
    )
  )
})

test('an arrangement revision conflict preserves the batch and reloads the identified order', async ({
  extension,
}) => {
  const { page, view } = await setup(extension)
  const editedId = await view
    .locator('[data-packing-order]')
    .first()
    .getAttribute('data-packing-order')
  // Simulate another writer arranging all orders atomically, without reopening
  // Prepare in this tab (which would replace the stale drafts being exercised).
  await extension.inspector.evaluate(async (orderId) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('1688-order-library')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('preparations', 'readwrite')
      const store = tx.objectStore('preparations')
      const request = store.getAll()
      request.onsuccess = () => {
        for (const [index, value] of request.result.entries()) {
          if (value.orderId === orderId)
            value.groups[0].spanishName = 'CAMBIO EXTERNO'
          value.packingPosition = index
          value.revision++
          value.updatedAt = new Date().toISOString()
          store.put(value)
        }
      }
      tx.oncomplete = resolve
      tx.onabort = () => reject(tx.error)
    })
    db.close()
    const channel = new BroadcastChannel('1688-preparation')
    channel.postMessage('changed')
    channel.close()
  }, editedId)
  const before = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  await page.bringToFront()
  await view
    .getByRole('button', { name: 'Arrange packing', exact: true })
    .click()
  await view
    .locator('.packing-arrange')
    .getByRole('button', { name: 'Store', exact: true })
    .click()
  const notice = view.locator('.error-notice')
  await expect(notice).toContainText('Preparation changed in another tab')
  const conflictedId = await notice
    .locator('.order-reference-pair .copyable-text')
    .textContent()
  expect(
    before.data.preparations.some((prep) => prep.orderId === conflictedId)
  ).toBe(true)
  const after = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(after.data.preparations).toEqual(before.data.preparations)
  await notice
    .getByRole('button', { name: 'Reload saved version', exact: true })
    .click()
  await expect(
    view
      .locator(`[data-packing-order="${editedId}"] .group-name-editor`)
      .first()
  ).toHaveValue('CAMBIO EXTERNO')
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  expect(
    await view
      .locator('[data-packing-order]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.packingOrder))
  ).toEqual(
    before.data.preparations
      .sort((a, b) => a.packingPosition - b.packingPosition)
      .map((prep) => prep.orderId)
  )
  await view
    .getByRole('button', { name: 'Arrange packing', exact: true })
    .click()
  await view
    .locator('.packing-arrange')
    .getByRole('button', { name: 'Store', exact: true })
    .click()
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  await expect(view.locator('.error-notice')).toHaveCount(0)
})
