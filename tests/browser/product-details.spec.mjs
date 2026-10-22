import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  assignSelectedPurchaseCodes,
  editOrderProduct,
  closeOrderProduct,
} from './smart-workspace-helpers.mjs'

async function workspace(
  extension,
  { longDescription = false, cartonDetails } = {}
) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerName = '合成商品资料店'
  record.snapshot.sellerMemberLogin = 'synthetic-product-details'
  record.snapshot.sellerShopOrigin =
    'https://synthetic-product-details.1688.com'
  const [structured, legacy, minimal] = record.snapshot.items
  if (cartonDetails)
    record.cartonDetails = { [structured.entryId]: cartonDetails }
  structured.title = '合成规格测试玻璃花瓶'
  structured.productNumber = 'ABC-42'
  structured.skuProperties = [
    { label: '规格', value: '14*65CM', raw: '规格14*65CM' },
    { label: '颜色', value: '灰色', raw: '颜色：灰色' },
    { label: '货号', value: 'ABC-42', raw: '货号：ABC-42' },
    { label: '包装说明', value: '一件一袋', raw: '包装说明：一件一袋' },
  ]
  structured.description = `${structured.title}\n规格14*65CM\n颜色：灰色\n货号：ABC-42\n\n包装说明：一件一袋  `
  if (longDescription)
    structured.description += Array.from(
      { length: 45 },
      (_, index) =>
        `\n原始商品说明 ${index + 1}：合成商品包装、材质与使用说明。`
    ).join('')
  legacy.description =
    '原始短款玻璃瓶\n规格：8×12cm\n颜色：白色\n货号：LEGACY-8'
  minimal.description = '仅有原始商品说明，没有规格或颜色字段。'
  minimal.thumbnail = ''
  const restored = await extension.inspector.evaluate(
    async (record) =>
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
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.evaluate(() => {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard)
    navigator.clipboard.writeText = async (value) => {
      await write(value)
      window.productDetailsCopiedText = value
    }
  })
  return { page, record }
}

function field(root, label, selector = '.product-attributes') {
  return root
    .locator(`${selector} dt`)
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('..')
}

async function expectCopied(page, button, value) {
  await test.step('Finish the clipboard write before reading it back', async () => {
    await page.bringToFront()
    await button.click()
    await expect
      .poll(() => page.evaluate(() => window.productDetailsCopiedText))
      .toBe(value)
  })
  // Windows stores native clipboard line endings as CRLF. The exact source
  // argument is asserted above; retain all other whitespace in the readback.
  await test.step('Verify the completed native clipboard text', async () => {
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await navigator.clipboard.readText()).replace(/\r\n/g, '\n')
        )
      )
      .toBe(value.replace(/\r\n/g, '\n'))
  })
}

async function backup(extension) {
  const result = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(result.ok, result.error).toBe(true)
  return result.data
}

test('table attributes translate, copy dimension numbers without their unit and leave row selection independent', async ({
  extension,
}) => {
  const { page, record } = await workspace(extension)
  const before = await backup(extension)
  const row = page.locator('#sheet-body tr[data-selection-key]').first()
  await expect(row.locator('.product-title')).toHaveText(
    record.snapshot.items[0].title
  )
  const specifications = field(row, 'Specifications')
  await expect(specifications.locator('.attribute-unit')).toHaveText('CM')
  await expectCopied(page, specifications.getByRole('button'), '14*65')
  await expect(row).toHaveAttribute('aria-selected', 'false')
  await expect(page.locator('.product-details-dialog')).toHaveCount(0)
  await row.focus()
  await row.press('Space')
  await specifications.getByRole('button').dblclick()
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.product-details-dialog')).toHaveCount(0)
  await expect(row.locator('.product-color-hint')).toHaveText('Gray')
  await expect(row.locator('.product-color-hint i')).toHaveCount(1)
  await page.locator('#language-toggle [data-language=es]').click()
  await expect(field(row, 'Código').getByRole('button')).toHaveText('ABC-42')
  await expect(row.locator('.product-color-hint')).toHaveText('Gris')
  await expect(row.locator('.product-title')).toHaveText(
    record.snapshot.items[0].title
  )
  await page.locator('#language-toggle [data-language=zh]').click()
  await expect(field(row, '规格').locator('.attribute-unit')).toHaveText('CM')
  await expect(row.locator('.product-color-hint')).toHaveText('灰色')
  expect((await backup(extension)).orders).toEqual(before.orders)
})

test('original product details copy exact source values and description and link to the photo and source order', async ({
  extension,
}) => {
  const { page, record } = await workspace(extension, { longDescription: true })
  const row = page.locator('#sheet-body tr[data-selection-key]').first()
  await row.locator('.product-title').dblclick()
  const details = page.getByRole('dialog', {
    name: 'Original product details',
    exact: true,
  })
  await expect(details).toBeVisible()
  await expect(details.locator('.product-details-identity')).not.toContainText(
    record.snapshot.orderId
  )
  const selected = await row.getAttribute('aria-selected')
  await expectCopied(
    page,
    field(details, '规格', '.product-original-fields').getByRole('button'),
    '14*65CM'
  )
  await expectCopied(
    page,
    details.getByRole('button', { name: 'Copy description', exact: true }),
    record.snapshot.items[0].description
  )
  await expect(details.locator('.product-original-description pre')).toHaveText(
    record.snapshot.items[0].description
  )
  await expectCopied(
    page,
    details.getByRole('button', { name: /^Copy original title:/ }),
    record.snapshot.items[0].title
  )
  await expectCopied(
    page,
    details.getByRole('button', { name: /^Copy store name:/ }),
    record.snapshot.sellerName
  )
  await expectCopied(
    page,
    details.getByRole('button', { name: /^Copy order number:/ }),
    record.snapshot.orderId
  )
  await expect(
    field(details, '颜色', '.product-original-fields').getByRole('button')
  ).toHaveText('灰色')
  await expect(row).toHaveAttribute('aria-selected', selected)
  const photoBounds = await details
    .locator('.product-photo-button')
    .evaluate((button) => {
      const outer = button.getBoundingClientRect()
      const inner = button.querySelector('img').getBoundingClientRect()
      return {
        contained:
          inner.left >= outer.left &&
          inner.top >= outer.top &&
          inner.right <= outer.right &&
          inner.bottom <= outer.bottom,
      }
    })
  expect(photoBounds.contained).toBe(true)
  await details
    .getByRole('button', { name: 'Open product photo', exact: true })
    .click()
  const photo = page.getByRole('dialog', { name: 'Product photo', exact: true })
  await expect(photo.locator('.photo-viewport img')).toHaveAttribute(
    'src',
    record.snapshot.items[0].thumbnail
  )
  await page.keyboard.press('Escape')
  await expect(photo).toHaveCount(0)
  await expect(details).toBeVisible()
  await expect(
    details.getByRole('button', { name: 'Open product photo', exact: true })
  ).toBeFocused()
  await details
    .getByRole('button', { name: 'Order details', exact: true })
    .click()
  await expect(details).toHaveCount(0)
  await expect(page.locator('#order-details')).toBeVisible()
  await expect(
    page.locator('#order-details-heading .order-reference')
  ).toHaveText(record.snapshot.orderId)
  await expect(row).toHaveAttribute('aria-selected', selected)
})

test('legacy and missing SKU fields retain their source text, with keyboard dismissal and a narrow usable details dialog', async ({
  extension,
}) => {
  const { page, record } = await workspace(extension)
  const rows = page.locator('#sheet-body tr[data-selection-key]'),
    legacy = rows.nth(1),
    minimal = rows.nth(2)
  await expect(legacy.locator('.product-title')).toHaveText('原始短款玻璃瓶')
  await expect(
    field(legacy, 'Specifications').locator('.attribute-unit')
  ).toHaveText('cm')
  await expectCopied(
    page,
    field(legacy, 'Specifications').getByRole('button'),
    '8×12'
  )
  await expect(legacy.locator('.product-color-hint')).toHaveText('White')
  await legacy.focus()
  await legacy.press('Enter')
  const details = page.getByRole('dialog', {
    name: 'Original product details',
    exact: true,
  })
  await expect(details).toBeVisible()
  await expectCopied(
    page,
    field(details, '货号', '.product-original-fields').getByRole('button'),
    'LEGACY-8'
  )
  await page.setViewportSize({ width: 390, height: 844 })
  const layout = await details.evaluate((dialog) => {
    const bounds = dialog.getBoundingClientRect()
    return {
      left: bounds.left,
      right: bounds.right,
      width: innerWidth,
      scrollWidth: dialog.scrollWidth,
      clientWidth: dialog.clientWidth,
    }
  })
  expect(layout.left).toBeGreaterThanOrEqual(0)
  expect(layout.right).toBeLessThanOrEqual(layout.width)
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
  await page.keyboard.press('Escape')
  await expect(details).toHaveCount(0)
  await expect(legacy).toBeFocused()
  await expect(minimal.locator('.product-title')).toHaveText(
    record.snapshot.items[2].description
  )
  await expect(minimal.locator('.product-attributes')).toHaveCount(0)
  await minimal.focus()
  await minimal.press('Enter')
  await expect(details).toBeVisible()
  await expect(details.locator('.product-details-photo')).toHaveCount(0)
  await expect(details.locator('.product-original-description pre')).toHaveText(
    record.snapshot.items[2].description
  )
  await expect(details.locator('.product-original-fields dt')).toHaveText([
    '单价',
    '数量',
  ])
  const bounds = await details.boundingBox()
  await page.mouse.click(Math.max(1, bounds.x - 5), Math.max(1, bounds.y + 10))
  await expect(details).toHaveCount(0)
  await expect(minimal).toBeFocused()
})

test('translated product details never rewrite saved label names or original order snapshots', async ({
  extension,
}) => {
  const { page } = await workspace(extension)
  const row = page.locator('#sheet-body tr[data-selection-key]').first()
  await row.getByRole('checkbox').check()
  await assignSelectedPurchaseCodes(page)
  const editor = await editOrderProduct(page, 0, {
    'Spanish name': 'NOMBRE MANUAL',
    'Chinese category': '手工类别',
  })
  await closeOrderProduct(editor)
  const before = await backup(extension)
  expect(before.preparations[0].groups[0].variants[0].spanishName).toBe(
    'NOMBRE MANUAL'
  )
  expect(before.preparations[0].groups[0].category).toBe('手工类别')
  await page.locator('#language-toggle [data-language=es]').click()
  await page.locator('#language-toggle [data-language=zh]').click()
  await row.focus()
  await row.press('Enter')
  const details = page.locator('.product-details-dialog')
  await expect(details).toBeVisible()
  await expect(
    field(details, '规格', '.product-original-fields').getByRole('button')
  ).toHaveText('14*65CM')
  await details
    .getByRole('button', { name: '关闭商品详情', exact: true })
    .click()
  await expect(details).toHaveCount(0)
  const after = await backup(extension)
  expect(after.orders).toEqual(before.orders)
  expect(after.preparations).toEqual(before.preparations)
})

test('original product and carton panels stay compact, always visible and usable in all three languages and narrow layouts', async ({
  extension,
}) => {
  test.setTimeout(60_000)
  const { page } = await workspace(extension)
  const before = await backup(extension)
  for (const [language, heading, source] of [
    ['en', 'Carton details', 'Volume not set'],
    ['es', 'Datos de la caja', 'Volumen sin definir'],
    ['zh', '纸箱信息', '未填写体积'],
  ]) {
    await page.locator(`#language-toggle [data-language=${language}]`).click()
    await page
      .locator('#sheet-body tr[data-selection-key]')
      .first()
      .press('Enter')
    const details = page.locator('.product-details-dialog'),
      carton = details.locator('.product-carton-details')
    await expect(
      carton.getByRole('heading', { name: heading, exact: true })
    ).toBeVisible()
    await expect(details.locator('details, summary')).toHaveCount(0)
    await expect(carton.locator('input')).toHaveCount(5)
    await expect(carton.locator('input[name=cbm]')).toHaveCount(0)
    await expect(carton.locator('.product-carton-volume-source')).toHaveText(
      source
    )
    await carton.locator('input[name=boxes]').focus()
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => {
        document.querySelector('meta[name="color-scheme"]').content = theme
      }, theme)
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 960 })
        await page.mouse.move(1, 1)
        const layout = await details.evaluate((dialog) => {
          const panel = dialog.querySelector('.product-carton-details'),
            box = panel.getBoundingClientRect(),
            summary = dialog
              .querySelector('.product-details-body')
              .getBoundingClientRect(),
            photo = dialog
              .querySelector('.product-photo-button')
              .getBoundingClientRect(),
            dimensions = [
              ...panel.querySelectorAll(
                '.product-carton-dimension-fields input'
              ),
            ].map((input) => input.getBoundingClientRect()),
            save = panel.querySelector('[type=submit]').getBoundingClientRect()
          return {
            overflow:
              dialog.scrollWidth > dialog.clientWidth ||
              panel.scrollWidth > panel.clientWidth,
            fullWidth: Math.abs(box.width - summary.width),
            photo: { width: photo.width, height: photo.height },
            dimensions: dimensions.map(({ left, top, right }) => ({
              left,
              top,
              right,
            })),
            box: { left: box.left, right: box.right },
            save: { left: save.left, right: save.right },
            controls: [...panel.querySelectorAll('input, button')].map(
              (node) => {
                const rect = node.getBoundingClientRect()
                return { left: rect.left, right: rect.right }
              }
            ),
            inputBorders: [...panel.querySelectorAll('input')].map(
              (input) => getComputedStyle(input).borderTopWidth
            ),
          }
        })
        expect(layout.overflow).toBe(false)
        expect(layout.fullWidth).toBeLessThanOrEqual(1)
        expect(layout.photo.width).toBeLessThanOrEqual(96)
        expect(layout.photo.height).toBe(layout.photo.width)
        expect(layout.inputBorders).toEqual(Array(5).fill('0px'))
        expect(
          Math.max(...layout.dimensions.map(({ top }) => top)) -
            Math.min(...layout.dimensions.map(({ top }) => top))
        ).toBeLessThanOrEqual(1)
        for (const control of [...layout.controls, layout.save]) {
          expect(control.left).toBeGreaterThanOrEqual(layout.box.left)
          expect(control.right).toBeLessThanOrEqual(layout.box.right)
        }
        if (language === 'en' && width === 1280 && theme === 'dark')
          await details.screenshot({
            path: 'work/carton-details-redesign-wide.png',
          })
        if (language === 'es' && width === 390 && theme === 'light')
          await details.screenshot({
            path: 'work/carton-details-redesign-narrow.png',
          })
      }
    }
    await details.locator('.product-details-heading > button').click()
    await expect(details).toHaveCount(0)
  }
  expect((await backup(extension)).orders).toEqual(before.orders)
})

test('carton details validate XYZ, retain read-only supplied volume and recover pending and failed writes', async ({
  extension,
}) => {
  const manual = '0.123456789123456789',
    { page, record } = await workspace(extension, {
      cartonDetails: { cbm: manual },
    }),
    entryId = record.snapshot.items[0].entryId,
    before = await backup(extension)
  await page
    .locator('#sheet-body tr[data-selection-key]')
    .first()
    .press('Enter')
  const details = page.locator('.product-details-dialog'),
    carton = details.locator('.product-carton-details'),
    input = (name) => carton.locator(`input[name=${name}]`),
    save = carton.getByRole('button', {
      name: 'Save carton details',
      exact: true,
    })
  for (const name of ['len', 'wid', 'ht'])
    await expect(input(name)).toHaveValue('')
  await expect(input('cbm')).toHaveCount(0)
  await expect(carton.locator('.product-carton-volume-value')).toHaveText(
    manual
  )
  await expect(carton.locator('.product-carton-volume-source')).toHaveText(
    'Supplied volume'
  )
  await expect(carton.locator('.product-carton-supplied')).toHaveText(
    `Supplied volume: ${manual} m³ · read-only`
  )
  await carton
    .getByRole('button', { name: 'Increase Cartons', exact: true })
    .click()
  await expect(input('boxes')).toHaveValue('1')
  await carton
    .getByRole('button', { name: 'Increase Cartons', exact: true })
    .click()
  await carton
    .getByRole('button', { name: 'Decrease Cartons', exact: true })
    .click()
  await expect(input('boxes')).toHaveValue('1')
  await input('kg').fill('0')
  await save.click()
  await expect(carton.locator('.product-carton-status')).toHaveText('Saved')
  let saved = await backup(extension)
  expect(saved.orders[0].cartonDetails[entryId]).toEqual({
    boxes: '1',
    kg: '0',
    cbm: manual,
  })
  await input('len').fill('58.5')
  await save.click()
  await expect(input('wid')).toBeFocused()
  expect(
    await input('wid').evaluate((input) => input.validity.valueMissing)
  ).toBe(true)
  expect((await backup(extension)).orders).toEqual(saved.orders)
  await input('wid').fill('35.2')
  await input('ht').fill('0')
  await save.click()
  await expect(input('ht')).toBeFocused()
  expect(await input('ht').evaluate((input) => input.validationMessage)).toBe(
    'Carton dimensions must be greater than zero'
  )
  await page.evaluate(() => {
    window.holdCartonSave = true
    window.failCartonSave = true
    window.cartonSaveStarted = false
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const result = put.apply(this, args)
      if (
        this.name === 'orders' &&
        args[0].cartonDetails &&
        window.holdCartonSave
      ) {
        window.cartonSaveStarted = true
        const store = this,
          transaction = this.transaction
        const keepAlive = () => {
          if (!window.holdCartonSave) {
            if (window.failCartonSave) transaction.abort()
            return
          }
          const request = store.get([
            args[0].snapshot.accountId,
            args[0].snapshot.orderId,
          ])
          request.onsuccess = keepAlive
        }
        keepAlive()
      }
      return result
    }
  })
  await input('ht').fill('47')
  await save.click()
  await expect
    .poll(() => page.evaluate(() => window.cartonSaveStarted))
    .toBe(true)
  await expect(save).toBeDisabled()
  await expect(details).toHaveAttribute('aria-busy', 'true')
  await expect(carton.locator('.product-carton-volume-value')).toHaveText(
    '0.0967824'
  )
  await expect(carton.locator('.product-carton-volume-source')).toHaveText(
    'Calculated from dimensions'
  )
  await expect(carton.locator('.product-carton-supplied')).toHaveText(
    `Supplied volume: ${manual} m³ · read-only`
  )
  for (const control of ['boxes', 'kg', 'len', 'wid', 'ht'])
    await expect(input(control)).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(details).toBeVisible()
  await page.evaluate(() => {
    window.holdCartonSave = false
  })
  await expect(carton.locator('.product-carton-status')).toContainText(
    'Your draft is still here.'
  )
  await expect(input('cbm')).toHaveCount(0)
  await expect(carton.locator('.product-carton-volume-value')).toHaveText(
    '0.0967824'
  )
  await expect(input('len')).toHaveValue('58.5')
  await expect(input('ht')).toHaveValue('47')
  await expect(save).toBeEnabled()
  expect((await backup(extension)).orders).toEqual(saved.orders)
  await save.click()
  await expect(carton.locator('.product-carton-status')).toHaveText('Saved')
  saved = await backup(extension)
  expect(saved.orders[0].cartonDetails[entryId]).toEqual({
    boxes: '1',
    kg: '0',
    cbm: manual,
    len: '58.5',
    wid: '35.2',
    ht: '47',
  })
  expect(saved.orders[0].snapshot).toEqual(before.orders[0].snapshot)
  for (const name of ['kg', 'len', 'wid', 'ht']) await input(name).fill('')
  await expect(carton.locator('.product-carton-volume-value')).toHaveText(
    manual
  )
  await expect(carton.locator('.product-carton-volume-source')).toHaveText(
    'Supplied volume'
  )
  await expect(carton.locator('.product-carton-status')).toHaveText('Saved')
  expect((await backup(extension)).orders[0].cartonDetails[entryId]).toEqual({
    boxes: '1',
    cbm: manual,
  })
})
