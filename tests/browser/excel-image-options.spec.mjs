import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

for (const mode of ['light', 'dark'])
  test(`Products and Packing export light badge colors in ${mode} workspace and copy the exact preview PNG`, async ({
    extension,
  }) => {
    const colors = {
      light: {
        order: ['#f4e2cc', '#4a2610'],
        product: ['#d6f0da', '#16451d'],
        dates: ['#efe0c4', '#3a2710'],
        completed: ['#dceac0', '#31441a'],
      },
      dark: {
        order: ['#442412', '#ffd9b2'],
        product: ['#143b24', '#b4f3c1'],
        dates: ['#40301c', '#f5d8ad'],
        completed: ['#243516', '#d8edb8'],
      },
    }
    const tag = (scope) => ({
      name: 'Shared',
      colors: { light: colors.light[scope][0], dark: colors.dark[scope][0] },
      textColors: {
        light: colors.light[scope][1],
        dark: colors.dark[scope][1],
      },
    })
    const [record] = await extension.inspector.evaluate(
      `(${createDemoRecords.toString()})(document)`
    )
    record.snapshot.sellerMemberLogin = 'synthetic-colored-image'
    record.snapshot.status = '交易成功'
    record.snapshot.purchasedAt = '2026-10-15T12:00:00+08:00'
    record.tags = ['Shared']
    record.productTags = { [record.snapshot.items[0].entryId]: ['Shared'] }
    for (const item of record.snapshot.items) item.title = '合成玻璃花瓶'
    const restored = await extension.inspector.evaluate(
      ({ record, value }) =>
        chrome.runtime.sendMessage({
          type: 'BACKUP_RESTORE',
          backup: {
            format: '1688-order-library',
            version: 2,
            exportedAt: new Date().toISOString(),
            orders: [record],
            history: [],
            images: [],
            preparations: [],
            allocations: [],
            issuedCodes: [],
            packingPreferences: { value, updatedAt: new Date().toISOString() },
          },
        }),
      {
        record,
        value: {
          orderTags: [tag('order')],
          productTags: [tag('product')],
          appearance: {
            paletteRevision: 1,
            labelColors: Object.fromEntries(
              ['dates', 'completed'].map((key) => [
                key,
                { light: colors.light[key][0], dark: colors.dark[key][0] },
              ])
            ),
            labelTextColors: Object.fromEntries(
              ['dates', 'completed'].map((key) => [
                key,
                { light: colors.light[key][1], dark: colors.dark[key][1] },
              ])
            ),
          },
        },
      }
    )
    expect(restored.ok, restored.error).toBe(true)
    await extension.context.grantPermissions([
      'clipboard-read',
      'clipboard-write',
    ])
    const page = await extension.context.newPage()
    await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
    await page.addInitScript((mode) => {
      localStorage.setItem('1688-library-purchase-months', '[]')
      localStorage.setItem('1688-library-color-scheme', mode)
      localStorage.setItem(
        '1688-excel-image-columns',
        JSON.stringify({
          selected: ['description', 'quantity'],
          details: {
            date: true,
            status: true,
            orderTags: true,
            productTags: true,
          },
        })
      )
      window.badgeText = []
      window.badgeWrites = []
      window.badgeDigest = async (blob) =>
        [
          ...new Uint8Array(
            await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
          ),
        ].join(',')
      const fillText = CanvasRenderingContext2D.prototype.fillText
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        window.badgeText.push({ text: String(text), color: this.fillStyle })
        return fillText.call(this, text, ...args)
      }
      const write = navigator.clipboard.write.bind(navigator.clipboard)
      navigator.clipboard.write = async (items) => {
        window.badgeWrites.push(
          await window.badgeDigest(await items[0].getType('image/png'))
        )
        await write(items)
      }
    }, mode)
    await page.goto(`${extension.extensionBaseUrl}/library.html`)
    await expect(
      page.locator('#sheet-body tr[data-selection-key]')
    ).toHaveCount(3)
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
      'content',
      mode
    )
    const dialog = page.getByRole('dialog', {
      name: 'Copy Excel image',
      exact: true,
    })
    const assertPreviewAndCopy = async () => {
      await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
      const text = await page.evaluate(() => window.badgeText)
      expect(
        [
          ...new Set(
            text
              .filter(({ text }) => text === 'Shared')
              .map(({ color }) => color)
          ),
        ].sort()
      ).toEqual([colors.light.order[1], colors.light.product[1]].sort())
      for (const [label, key] of [
        ['15 Oct 2026', 'dates'],
        ['Completed', 'completed'],
      ])
        expect(
          text.some(
            (draw) => draw.text === label && draw.color === colors.light[key][1]
          )
        ).toBe(true)
      const preview = await dialog.locator('.copy-preview img').evaluate(
        async (image, backgrounds) => {
          const blob = await (await fetch(image.src)).blob()
          const bitmap = await createImageBitmap(blob)
          const canvas = document.createElement('canvas')
          canvas.width = bitmap.width
          canvas.height = bitmap.height
          const context = canvas.getContext('2d')
          context.drawImage(bitmap, 0, 0)
          const { data } = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
          )
          const pixels = Object.fromEntries(
            backgrounds.map((color) => [color, 0])
          )
          const channels = backgrounds.map((color) => [
            color,
            color
              .slice(1)
              .match(/../g)
              .map((part) => parseInt(part, 16)),
          ])
          for (let offset = 0; offset < data.length; offset += 4)
            for (const [color, [red, green, blue]] of channels)
              if (
                data[offset] === red &&
                data[offset + 1] === green &&
                data[offset + 2] === blue &&
                data[offset + 3] === 255
              )
                pixels[color]++
          bitmap.close()
          canvas.width = canvas.height = 0
          return { hash: await window.badgeDigest(blob), pixels }
        },
        Object.values(colors.light).map(([background]) => background)
      )
      for (const [color, pixels] of Object.entries(preview.pixels))
        expect(pixels, `Rendered ${mode} background ${color}`).toBeGreaterThan(
          100
        )
      await dialog.locator('.image-copy-submit').click()
      await expect(dialog.locator('[data-batch-index="0"]')).toHaveClass(
        /is-copied/
      )
      expect(await page.evaluate(() => window.badgeWrites.at(-1))).toBe(
        preview.hash
      )
      const clipboardTypes = await page.evaluate(
        async () => (await navigator.clipboard.read())[0].types
      )
      expect(clipboardTypes).toContain('image/png')
    }
    await page.locator('#copy-excel-image').click()
    await assertPreviewAndCopy()
    // Changing the workspace mode while this session is open must not recolor
    // the captured badges when a detail change regenerates its image.
    await page.locator('meta[name="color-scheme"]').evaluate((meta, mode) => {
      meta.content = mode === 'light' ? 'dark' : 'light'
      window.badgeText = []
    }, mode)
    await dialog.locator('.excel-style-details > summary').click()
    await dialog
      .getByRole('checkbox', { name: 'Order number', exact: true })
      .uncheck()
    await assertPreviewAndCopy()
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await page.locator('meta[name="color-scheme"]').evaluate((meta, mode) => {
      meta.content = mode
    }, mode)
    const first = page.locator('#sheet-body tr[data-selection-key]').first()
    await first.focus()
    await first.press('Control+a')
    await page.locator('#prepare-orders').click()
    await page
      .getByRole('button', { name: 'Assign codes and prepare', exact: true })
      .click()
    const packing = page.locator('#packing-view')
    await expect(packing.locator('.variants tbody tr')).toHaveCount(3)
    await page.evaluate(() => {
      window.badgeText = []
    })
    await packing
      .getByRole('button', { name: 'Copy Excel image', exact: true })
      .click()
    await assertPreviewAndCopy()
    expect(extension.unexpectedRequests).toEqual([])
  })

test('image style and detail controls persist, update the same preview, and keep tags independent of order headings', async ({
  extension,
}) => {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-image-details'
  record.snapshot.status = '交易成功'
  record.tags = ['Shipment A']
  record.productTags = { [record.snapshot.items[0].entryId]: ['Fragile'] }
  for (const item of record.snapshot.items) item.title = '合成玻璃花瓶'
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
  await page.addInitScript(() => {
    localStorage.setItem('1688-library-purchase-months', '[]')
    if (!localStorage.getItem('1688-excel-image-columns'))
      localStorage.setItem(
        '1688-excel-image-columns',
        JSON.stringify({ style: { scheme: 'custom', accent: '#ffff00' } })
      )
    window.imageDetailText = []
    window.imageDetailColors = []
    const fillText = CanvasRenderingContext2D.prototype.fillText
    const fillRect = CanvasRenderingContext2D.prototype.fillRect
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.imageDetailText.push(String(text))
      return fillText.call(this, text, ...args)
    }
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      window.imageDetailColors.push(this.fillStyle)
      return fillRect.apply(this, args)
    }
  })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const appearance = page.getByRole('dialog', { name: 'Settings', exact: true })
  for (const mode of ['Light', 'Dark'])
    await appearance
      .getByLabel(`${mode} palette`, { exact: true })
      .selectOption('classic-brown')
  await appearance
    .getByRole('button', { name: 'Save settings', exact: true })
    .click()
  await expect(appearance).not.toBeVisible()
  await page.locator('#copy-excel-image').click()
  const dialog = page.locator('.image-copy-dialog')
  const ready = () => expect(dialog.locator('.image-copy-submit')).toBeEnabled()
  await ready()
  await dialog.locator('.excel-style-details > summary').click()
  for (const label of await dialog.locator('.excel-detail-toggle').all()) {
    expect((await label.boundingBox()).height).toBeLessThanOrEqual(30)
    await expect(label).toHaveCSS('margin-top', '0px')
  }
  await expect(
    dialog.getByRole('combobox', { name: 'Image color scheme' })
  ).toHaveCount(0)
  await expect(
    dialog.getByLabel('Custom image accent', { exact: true })
  ).toHaveCount(0)
  await expect(dialog).toContainText(
    'Excel exports use the current theme in light mode.'
  )
  await dialog
    .getByRole('checkbox', { name: 'Product tags', exact: true })
    .check()
  await dialog
    .getByRole('checkbox', { name: 'Order tags', exact: true })
    .check()
  await dialog
    .getByRole('checkbox', { name: 'Purchase date', exact: true })
    .check()
  await dialog
    .getByRole('checkbox', { name: 'Order status', exact: true })
    .check()
  await ready()
  const rendered = await page.evaluate(() => window.imageDetailText.join(' '))
  expect(rendered).toContain('Fragile')
  expect(rendered).toContain('Shipment A')
  expect(rendered).toContain('Completed')
  const before = await dialog.locator('.copy-preview img').getAttribute('src')
  await page.evaluate(() => {
    window.imageDetailText = []
  })
  await dialog
    .getByRole('checkbox', {
      name: 'Show store and order details',
      exact: true,
    })
    .uncheck()
  await ready()
  await expect(dialog.locator('.copy-preview img')).not.toHaveAttribute(
    'src',
    before
  )
  const hidden = await page.evaluate(() => window.imageDetailText.join(' '))
  expect(hidden).toContain('Fragile')
  for (const value of [
    'Shipment A',
    'Completed',
    record.snapshot.orderId,
    record.snapshot.sellerName,
  ])
    expect(hidden).not.toContain(value)
  await expect(
    dialog.getByRole('checkbox', { name: 'Order tags', exact: true })
  ).toBeDisabled()
  await expect(
    dialog.getByRole('checkbox', { name: 'Product tags', exact: true })
  ).toBeEnabled()
  for (const mode of ['light', 'dark']) {
    await page.locator('meta[name="color-scheme"]').evaluate((meta, mode) => {
      meta.content = mode
      window.imageDetailColors = []
    }, mode)
    await dialog
      .getByRole('checkbox', { name: 'Original product name', exact: true })
      .setChecked(mode === 'dark')
    await ready()
    const renderedColors = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return {
        fills: window.imageDetailColors,
        header: style.getPropertyValue('--excel-accent').trim(),
        body: '#ffffff',
      }
    })
    expect(renderedColors.fills).toContain(renderedColors.header)
    expect(renderedColors.header).toBe('#5c3700')
    expect(renderedColors.fills).toContain(renderedColors.body)
    expect(renderedColors.fills).not.toContain('#ffff00')
  }
  await dialog.screenshot({ path: 'work/classic-brown-excel-image.png' })
  await dialog.locator('.image-copy-heading [data-icon="close"]').click()
  await page.reload()
  await page.locator('#copy-excel-image').click()
  await ready()
  await dialog.locator('.excel-style-details > summary').click()
  await expect(
    dialog.getByLabel('Custom image accent', { exact: true })
  ).toHaveCount(0)
  await expect(
    dialog.getByRole('checkbox', { name: 'Product tags', exact: true })
  ).toBeChecked()
  await expect(
    dialog.getByRole('checkbox', {
      name: 'Show store and order details',
      exact: true,
    })
  ).not.toBeChecked()
  await dialog
    .locator('[data-column="description"] .excel-column-toggle')
    .click()
  await expect(
    dialog.getByRole('checkbox', { name: 'Product tags', exact: true })
  ).toBeDisabled()
  await dialog
    .getByRole('button', { name: 'Default columns', exact: true })
    .click()
  await expect(
    dialog.getByLabel('Custom image accent', { exact: true })
  ).toHaveCount(0)
  await expect(
    dialog.getByRole('checkbox', { name: 'Product tags', exact: true })
  ).toBeEnabled()
  await dialog.locator('[data-column="price"] .excel-column-toggle').click()
  await dialog
    .getByRole('button', { name: 'Reset image details', exact: true })
    .click()
  await ready()
  await expect(
    dialog.getByRole('checkbox', { name: 'Product tags', exact: true })
  ).not.toBeChecked()
  await expect(
    dialog.getByRole('checkbox', {
      name: 'Show store and order details',
      exact: true,
    })
  ).toBeChecked()
  await expect(
    dialog.locator('[data-column="price"] .excel-column-toggle')
  ).toHaveAttribute('aria-pressed', 'false')
  expect(extension.unexpectedRequests).toEqual([])
})

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
  await page
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
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
    .getByRole('button', { name: 'Move Price (元) left', exact: true })
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
  await expect(dialog.locator('.excel-detail-fields legend').nth(1)).toHaveText(
    'Descripción del producto'
  )
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
  await expect(dialog.getByRole('alert')).toContainText(
    'Selecciona al menos una columna para copiar.'
  )
  await expect(
    dialog.getByRole('button', { name: 'Reintentar', exact: true })
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Reintentar', exact: true }).click()
  await expect(dialog.locator('.image-copy-progress')).toHaveText(
    'No se pudo preparar la vista previa.'
  )
  await expect(dialog.locator('.image-copy-status')).toBeHidden()
  for (const key of preference.selected)
    await dialog.locator(`[data-column="${key}"] .excel-column-toggle`).click()
  // Copy enables only after the preview re-renders, which is slower on hosted runners.
  await expect(dialog.locator('.image-copy-submit')).toBeEnabled({
    timeout: 20_000,
  })
  await expect(dialog.locator('.image-copy-status')).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('1688-excel-image-columns'))
    )
  ).toEqual(preference)
  await page.setViewportSize({ width: 1280, height: 800 })
  await dialog.locator('.image-copy-heading [data-icon="close"]').click()
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
  await dialog.getByRole('button', { name: 'Listo', exact: true }).click()
  await expect(page.locator('#copy-excel-image')).toHaveClass(/copied/)
  const rendered = await page.evaluate(() => imageColumnText.join(' '))
  expect(rendered).toContain('Cantidad')
  expect(rendered).toContain('Precio (元)')
  expect(rendered).toContain('Peso (kg)')
  expect(rendered).not.toContain('Carton')
  expect(rendered).not.toContain('Product description')
  for (const item of record.snapshot.items)
    expect(rendered).toContain(`${item.price} 元`)
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
  await page
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const packing = page.locator('#packing-view')
  await expect(packing).toBeVisible()
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
