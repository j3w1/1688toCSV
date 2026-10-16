import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

test('store and order details toggle regenerates the raster and persists across both copy views', async ({
  extension,
}) => {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerName = 'Synthetic identity supplier'
  record.snapshot.sellerMemberLogin = 'synthetic-identity-toggle'
  record.snapshot.sellerShopOrigin =
    'https://synthetic-identity-toggle.1688.com'
  for (const item of record.snapshot.items) item.title = '合成玻璃花瓶'
  const result = await extension.inspector.evaluate(
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
  expect(result.ok, result.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.addInitScript(() => {
    window.excelIdentityText = []
    const fill = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.excelIdentityText.push(String(text))
      return fill.call(this, text, ...args)
    }
  })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  const dialog = page.getByRole('dialog', {
    name: 'Copy Excel image',
    exact: true,
  })
  const toggle = dialog.getByRole('checkbox', {
    name: 'Show store and order details',
    exact: true,
  })
  const ready = async () => {
    await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
    await expect(dialog.locator('.copy-preview img')).toHaveCount(1)
  }
  const assertIdentity = async (shown) => {
    const text = await page.evaluate(() => window.excelIdentityText.join(' '))
    for (const value of [record.snapshot.sellerName, record.snapshot.orderId])
      expect(text.includes(value), value).toBe(shown)
  }
  await page.locator('#copy-excel-image').click()
  await ready()
  await expect(toggle).toBeChecked()
  await assertIdentity(true)
  const initialPreview = await dialog
    .locator('.copy-preview img')
    .getAttribute('src')
  await page.evaluate(() => {
    window.excelIdentityText = []
  })
  await toggle.uncheck()
  await ready()
  await expect(dialog.locator('.copy-preview img')).not.toHaveAttribute(
    'src',
    initialPreview
  )
  await assertIdentity(false)
  await dialog
    .getByRole('button', { name: 'Default columns', exact: true })
    .click()
  await ready()
  await expect(toggle).not.toBeChecked()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('1688-excel-image-columns'))
          .showOrderDetails
    )
  ).toBe(false)
  await page.reload()
  await page.locator('#copy-excel-image').click()
  await ready()
  await expect(toggle).not.toBeChecked()
  await assertIdentity(false)
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  const first = page.locator('#sheet-body tr[data-selection-key]').first()
  await first.focus()
  await first.press('Control+a')
  await page.locator('#prepare-orders').click()
  const packing = page.locator('#packing-view')
  await expect(packing.locator('.variants tbody tr')).toHaveCount(3)
  await page.evaluate(() => {
    window.excelIdentityText = []
  })
  await packing
    .getByRole('button', { name: 'Copy Excel image', exact: true })
    .click()
  await ready()
  await expect(toggle).not.toBeChecked()
  await assertIdentity(false)
  const hiddenPreview = await dialog
    .locator('.copy-preview img')
    .getAttribute('src')
  await toggle.check()
  await ready()
  await expect(dialog.locator('.copy-preview img')).not.toHaveAttribute(
    'src',
    hiddenPreview
  )
  await assertIdentity(true)
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('1688-excel-image-columns'))
          .showOrderDetails
    )
  ).toBe(true)
  expect(extension.unexpectedRequests).toEqual([])
})

test('image columns reorder, persist across copying and reload, and use the selected language in both views', async ({
  extension,
}) => {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-image-columns'
  record.snapshot.sellerShopOrigin = 'https://synthetic-image-columns.1688.com'
  for (const item of record.snapshot.items) item.title = '合成玻璃花瓶'
  const result = await extension.inspector.evaluate(
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
  expect(result.ok, result.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await page
    .getByRole('button', { name: 'Copy Excel image', exact: true })
    .click()
  let dialog = page.getByRole('dialog', {
    name: 'Copy Excel image',
    exact: true,
  })
  await expect(
    page
      .locator('#orders-copy-actions')
      .getByRole('button', { name: 'Excel image columns', exact: true })
  ).toHaveCount(0)
  await expect(dialog.locator('.copy-preview img')).toHaveCount(1)
  await expect(
    dialog.locator('.excel-column-toggle[aria-pressed="true"]')
  ).toHaveCount(11)
  const selected = ['quantity', 'price', 'supplierWeight']
  for (const key of [
    'number',
    'thumbnail',
    'description',
    'baseCode',
    'barcode',
    'chineseCategory',
    'supplierDimensions',
    'supplierCarton',
  ]) {
    await dialog.locator(`[data-column="${key}"] .excel-column-toggle`).click()
  }
  await dialog
    .locator('[data-column="quantity"] .excel-column-grip')
    .dragTo(dialog.locator('[data-column="price"]'))
  const orderAfterDrag = await dialog
    .locator('.excel-column-item')
    .evaluateAll((rows) => rows.map((row) => row.dataset.column))
  expect(orderAfterDrag.indexOf('quantity')).toBeLessThan(
    orderAfterDrag.indexOf('price')
  )
  // Both drag endpoints are visible in the bounded list. Use the keyboard
  // controls to continue to the top without dragging toward an offscreen row.
  for (let index = orderAfterDrag.indexOf('quantity'); index > 0; index--)
    await dialog
      .getByRole('button', { name: 'Move Quantity left', exact: true })
      .click()
  await expect(dialog.locator('.excel-column-item').first()).toHaveAttribute(
    'data-column',
    'quantity'
  )
  await dialog
    .getByRole('button', { name: 'Move Unit price (CNY) left', exact: true })
    .click()
  await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
  await expect(dialog.locator('.copy-preview img')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  const preference = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('1688-excel-image-columns'))
  )
  expect(preference.selected.toSorted()).toEqual(selected.toSorted())
  expect(preference.order[0]).toBe('quantity')
  await page.reload()
  await page.locator('#language-toggle [data-language="es"]').click()
  await page.locator('#copy-excel-image').click()
  dialog = page.locator('.image-copy-dialog')
  await expect(dialog.locator('.excel-column-item').first()).toHaveAttribute(
    'data-column',
    'quantity'
  )
  await expect(
    dialog.locator('.excel-column-toggle[aria-pressed="true"]')
  ).toHaveCount(3)
  await expect(dialog.locator('[data-column="supplierWeight"]')).toContainText(
    'Peso (kg)'
  )
  const description = dialog.locator('[data-column="description"]')
  await expect(description).toContainText('Descripción del producto')
  for (const width of [1280, 701, 390, 320]) {
    await page.setViewportSize({ width, height: 800 })
    const layout = await dialog
      .locator('.excel-column-item')
      .evaluateAll((rows) =>
        rows.map((row) => {
          const box = (selector) =>
            row.querySelector(selector).getBoundingClientRect()
          const grip = box('.excel-column-grip'),
            toggle = box('.excel-column-toggle'),
            check = box('.excel-column-check'),
            label = box('.excel-column-toggle > span:not(.excel-column-check)'),
            moves = box('.excel-column-moves')
          return {
            column: row.dataset.column,
            beside:
              check.right <= label.left && Math.abs(check.top - label.top) < 1,
            stableTracks:
              grip.right <= toggle.left && toggle.right <= moves.left,
            fits:
              row.scrollWidth <= row.clientWidth && label.right <= toggle.right,
            arrows: [...row.querySelectorAll('.excel-column-moves button')].map(
              (button) => button.getBoundingClientRect().width
            ),
          }
        })
      )
    for (const row of layout) {
      expect(
        row.beside,
        `${width}px ${row.column}: check remains beside the label`
      ).toBe(true)
      expect(
        row.stableTracks,
        `${width}px ${row.column}: reorder controls stay separate`
      ).toBe(true)
      expect(
        row.fits,
        `${width}px ${row.column}: label remains inside its row`
      ).toBe(true)
      expect(row.arrows).toEqual([26, 26])
    }
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)
    ).toBe(true)
  }
  await description.locator('[data-direction="-1"]').click()
  await description.locator('[data-direction="1"]').click()
  await description.locator('.excel-column-toggle').click()
  await description.locator('.excel-column-toggle').click()
  for (const key of preference.selected)
    await dialog.locator(`[data-column="${key}"] .excel-column-toggle`).click()
  await expect(dialog.locator('.image-copy-progress')).toHaveText(
    'No se pudo preparar la vista previa.'
  )
  await expect(dialog.locator('.image-copy-status')).toBeHidden()
  await expect(dialog.locator('.image-copy-submit')).toBeDisabled()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.locator('.copy-preview > button')).toBeVisible()
  await dialog.locator('.copy-preview > button').click()
  await expect(dialog.locator('.image-copy-progress')).toHaveText(
    'No se pudo preparar la vista previa.'
  )
  await expect(dialog.locator('.image-copy-status')).toBeHidden()
  for (const key of preference.selected)
    await dialog.locator(`[data-column="${key}"] .excel-column-toggle`).click()
  await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
  await expect(dialog.locator('.image-copy-status')).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('1688-excel-image-columns'))
    )
  ).toEqual(preference)
  await page.setViewportSize({ width: 1280, height: 800 })
  await dialog.locator('.image-copy-heading > button').click()
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.evaluate(() => {
    window.imageColumnText = []
    const fill = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.imageColumnText.push(String(text))
      return fill.call(this, text, ...args)
    }
  })
  await page.locator('#copy-excel-image').click()
  await expect(dialog.locator('.image-copy-submit')).toHaveAccessibleName(
    'Copiar lote actual'
  )
  await dialog.locator('.image-copy-submit').click()
  await expect(dialog.locator('[data-batch-index="0"]')).toHaveClass(
    /is-copied/
  )
  await expect(dialog).toBeVisible()
  await dialog.locator('.image-copy-actions > button').last().click()
  await expect(page.locator('#copy-excel-image')).toHaveClass(/copied/)
  const rendered = await page.evaluate(() => imageColumnText.join(' '))
  expect(rendered).toContain('Cantidad')
  expect(rendered).toContain('Precio unitario (CNY)')
  expect(rendered).toContain('Peso (kg)')
  expect(rendered).not.toContain('Carton')
  expect(rendered).not.toContain('Product description')
  for (const item of record.snapshot.items)
    expect(rendered).toContain(`¥ ${item.price}`)
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('1688-excel-image-columns'))
    )
  ).toEqual(preference)
  await page.locator('#language-toggle [data-language="en"]').click()
  const first = page.locator('#sheet-body tr[data-selection-key]').first()
  await first.focus()
  await first.press('Control+a')
  await page.locator('#prepare-orders').click()
  const packing = page.locator('#packing-view')
  await expect(packing).toBeVisible()
  // One new group opens directly; only broader code changes need review.
  await expect(packing.locator('.preparation-group')).toHaveCount(1)
  await expect(packing.locator('.variants tbody tr')).toHaveCount(3)
  await packing
    .getByRole('button', { name: 'Copy Excel image', exact: true })
    .click()
  dialog = page.getByRole('dialog', {
    name: 'Copy Excel image',
    exact: true,
  })
  await expect(
    dialog.locator('.excel-column-toggle[aria-pressed="true"]')
  ).toHaveCount(3)
  await expect(dialog.locator('.excel-column-item').first()).toHaveAttribute(
    'data-column',
    'quantity'
  )
  await page.setViewportSize({ width: 390, height: 780 })
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)
  ).toBe(true)
})
