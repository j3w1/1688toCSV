import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function seedStructuredOrder(extension, orderId) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const record = records[0]
  if (orderId) {
    record.snapshot.orderId = orderId
    record.snapshot.sourceUrl = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`
  }
  record.snapshot.sellerName = 'Synthetic preparation supplier'
  record.snapshot.sellerMemberLogin = 'synthetic-packing-shop'
  record.snapshot.sellerShopOrigin = 'https://synthetic-packing-shop.1688.com'
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = index < 2 ? '合成玻璃罐' : '合成收纳盒'
    item.productNumber = index < 2 ? 'TEST-JAR' : 'TEST-BOX'
    item.skuProperties = [
      {
        label: '颜色',
        value: index < 2 ? '透明' : '灰色',
        raw: index < 2 ? '颜色：透明' : '颜色：灰色',
      },
      ...(index < 2
        ? [
            {
              label: '尺寸',
              value: index === 0 ? '300ml' : '500ml',
              raw: index === 0 ? '尺寸：300ml' : '尺寸：500ml',
            },
          ]
        : []),
    ]
    item.description = [
      item.title,
      ...item.skuProperties.map((property) => property.raw),
      `货号：${item.productNumber}`,
    ].join('\n')
  }
  const response = await extension.inspector.evaluate(
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
  expect(response.ok, response.error).toBe(true)
  return record
}

async function openWorkspace(extension, { previews = true } = {}) {
  const record = await seedStructuredOrder(extension)
  const page = await extension.context.newPage()
  if (!previews)
    await page.addInitScript(() => {
      // Isolate batch-output assertions from automatic photos and label previews.
      // The real preview observer is exercised by the media test below.
      const Observer = window.IntersectionObserver
      window.IntersectionObserver = class extends Observer {
        constructor(callback, options) {
          super(callback, options)
          this.preparationPreview = options?.root?.id === 'preparation-dialog'
        }
        observe(target) {
          if (!this.preparationPreview) super.observe(target)
        }
      }
    })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr')).toHaveCount(3)
  await expect(
    page.getByRole('checkbox', { name: 'Headers', exact: true })
  ).not.toBeChecked()
  return { page, record }
}

async function openDetails(details) {
  if (!(await details.evaluate((node) => node.open)))
    await details.locator(':scope > summary').click()
  await expect(details).toHaveJSProperty('open', true)
}

async function prepare(page, { save = true } = {}) {
  await page.getByLabel('Packing month', { exact: true }).fill('2026-10')
  await page
    .getByRole('button', { name: 'Prepare labels', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Preparation', exact: true })
  await expect(dialog.locator('.preparation-group')).toHaveCount(2)
  await expect(
    dialog.locator('.preparation-group').first().locator('.variants tbody tr')
  ).toHaveCount(2)
  await expect(
    dialog
      .locator('.preparation-group')
      .first()
      .getByLabel('Product code', { exact: true })
  ).toHaveValue('')
  if (!save) return dialog
  await dialog
    .getByRole('button', { name: 'Save preparation', exact: true })
    .click()
  await expect(
    dialog
      .locator('.preparation-group')
      .first()
      .getByLabel('Product code', { exact: true })
  ).toHaveValue(/^CE2610\d{4}$/)
  return dialog
}

test('structured products prepare, preserve edits and copy exact headerless source and preparation rows', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  await page.getByLabel('Packing month', { exact: true }).fill('')
  await page
    .getByRole('button', { name: 'Prepare labels', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText(
    'Choose the packing month'
  )
  const dialog = await prepare(page)
  const group = dialog.locator('.preparation-group').first()
  const baseCode = await group
    .getByLabel('Product code', { exact: true })
    .inputValue()
  const otherCode = await dialog
    .locator('.preparation-group')
    .nth(1)
    .getByLabel('Product code', { exact: true })
    .inputValue()
  expect(otherCode).not.toBe(baseCode)
  await group
    .getByLabel('Spanish short name', { exact: true })
    .fill('frasco transparente')
  await group.getByLabel('Chinese category', { exact: true }).fill('玻璃制品')
  const variant = group.locator('.variants tbody tr').first()
  await openDetails(variant.locator('.variant-code-options'))
  await variant.getByRole('textbox', { name: /^Variant code / }).fill('b')
  await variant.getByRole('textbox', { name: /^Size code / }).fill('xs')
  await dialog
    .getByRole('button', { name: 'Save preparation', exact: true })
    .click()
  await expect(
    group.getByLabel('Spanish short name', { exact: true })
  ).toHaveValue('FRASCO TRANSPARENTE')
  await expect(
    group.getByLabel('Chinese category', { exact: true })
  ).toHaveValue('玻璃制品')
  await openDetails(variant.locator('.variant-code-options'))
  await expect(
    variant.getByRole('textbox', { name: /^Variant code / })
  ).toHaveValue('B')
  await expect(
    variant.getByRole('textbox', { name: /^Size code / })
  ).toHaveValue('XS')
  await dialog
    .getByRole('button', { name: 'Close preparation', exact: true })
    .click()
  await expect(page.locator('.row-preparation code')).toHaveText([
    baseCode,
    baseCode,
    otherCode,
  ])

  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.getByRole('button', { name: 'Copy values', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Confirm operation', exact: true })
    .getByRole('button', { name: 'Copy 3 product rows', exact: true })
    .click()
  await expect(page.locator('#copy-values')).toHaveText('Copied')
  const values = await page.evaluate(() => navigator.clipboard.readText())
  const valueRows = values.split('\r\n').map((row) => row.split('\t'))
  expect(valueRows).toHaveLength(3)
  for (const [index, row] of valueRows.entries()) {
    expect(row).toHaveLength(5)
    expect(row[0]).toBe('')
    expect(row[1]).toContain(record.snapshot.items[index].title)
    expect(row.slice(2)).toEqual(
      ['price', 'quantity', 'discount'].map(
        (key) => record.snapshot.items[index][key]
      )
    )
  }
  expect(values).not.toContain('Thumbnail')

  await page
    .getByRole('button', { name: 'Copy preparation columns', exact: true })
    .click()
  const columns = page.getByRole('dialog', {
    name: 'Copy preparation columns',
    exact: true,
  })
  await columns
    .getByRole('button', { name: 'Copy chosen columns', exact: true })
    .click()
  await expect(
    columns.getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible()
  const prepared = (await page.evaluate(() => navigator.clipboard.readText()))
    .split('\r\n')
    .map((row) => row.split('\t'))
  expect(prepared).toHaveLength(3)
  expect(prepared.every((row) => row.length === 7)).toBe(true)
  expect(prepared.map((row) => row[0])).toEqual([baseCode, '', otherCode])
  expect(prepared[0][1]).toBe(`${baseCode}BXS`)
  expect(prepared[0][3]).toBe('FRASCO TRANSPARENTE')
  await columns.getByRole('button', { name: 'Close', exact: true }).click()

  await page.reload()
  await expect(page.locator('.row-preparation code')).toHaveText([
    baseCode,
    baseCode,
    otherCode,
  ])
  await page
    .getByRole('button', { name: 'Edit preparation', exact: true })
    .click()
  await expect(
    group.getByLabel('Spanish short name', { exact: true })
  ).toHaveValue('FRASCO TRANSPARENTE')
  await expect(
    group.getByLabel('Chinese category', { exact: true })
  ).toHaveValue('玻璃制品')
  await openDetails(variant.locator('.variant-code-options'))
  await expect(
    variant.getByRole('textbox', { name: /^Variant code / })
  ).toHaveValue('B')
  await expect(
    variant.getByRole('textbox', { name: /^Size code / })
  ).toHaveValue('XS')
  const library = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'LIBRARY_QUERY' })
  )
  expect(library.ok, library.error).toBe(true)
  expect(library.data.orders[0].snapshot).toEqual(record.snapshot)
  expect(extension.unexpectedRequests).toEqual([])
})

test('packing month starts in the local current month and preserves chosen and saved months', async ({
  extension,
}) => {
  await seedStructuredOrder(extension)
  const page = await extension.context.newPage()
  const browser = await extension.context.newCDPSession(page)
  await browser.send('Emulation.setTimezoneOverride', {
    timezoneId: 'Asia/Shanghai',
  })
  await page.clock.setFixedTime(new Date('2026-12-31T16:30:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const month = page.getByLabel('Packing month', { exact: true })
  await expect(month).toHaveValue('2027-01')
  await expect(page.locator('#sheet-body tr')).toHaveCount(3)
  await page
    .getByRole('button', { name: 'Prepare labels', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Preparation', exact: true })
  await expect(dialog.locator('.preparation-heading')).toContainText(
    'Packing January 2027'
  )
  await dialog
    .getByRole('button', { name: 'Close preparation', exact: true })
    .click()

  await month.fill('2027-02')
  await page
    .getByLabel('Search products and orders', { exact: true })
    .fill('TEST-JAR')
  await expect(page.locator('#sheet-body tr')).toHaveCount(2)
  await expect(month).toHaveValue('2027-02')
  await page.getByLabel('Search products and orders', { exact: true }).fill('')
  await expect(page.locator('#sheet-body tr')).toHaveCount(3)
  await page
    .getByRole('button', { name: 'Prepare labels', exact: true })
    .click()
  await expect(dialog.locator('.preparation-heading')).toContainText(
    'Packing February 2027'
  )
  await dialog
    .getByRole('button', { name: 'Save preparation', exact: true })
    .click()
  await expect(
    dialog
      .locator('.preparation-group')
      .first()
      .getByLabel('Product code', { exact: true })
  ).toHaveValue(/^CE2702\d{4}$/)
  await dialog
    .getByRole('button', { name: 'Close preparation', exact: true })
    .click()
  await expect(month).toHaveValue('2027-02')

  await month.fill('2027-03')
  await page
    .getByRole('button', { name: 'Edit preparation', exact: true })
    .click()
  await expect(dialog.locator('.preparation-heading')).toContainText(
    'Packing February 2027'
  )
  await dialog
    .getByRole('button', { name: 'Close preparation', exact: true })
    .click()
  await expect(month).toHaveValue('2027-03')
  await page.reload()
  await expect(month).toHaveValue('2027-01')
  await page
    .getByRole('button', { name: 'Edit preparation', exact: true })
    .click()
  await expect(dialog.locator('.preparation-heading')).toContainText(
    'Packing February 2027'
  )
  await expect(
    dialog
      .locator('.preparation-group')
      .first()
      .getByLabel('Product code', { exact: true })
  ).toHaveValue(/^CE2702\d{4}$/)
  await browser.detach()
})

async function copiedLabel(page, dialog) {
  await dialog.getByRole('button', { name: 'Copy label', exact: true }).click()
  await expect(dialog.locator('.label-editor-status')).toHaveText('Copied')
  return page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0]
    const png = await item.getType('image/png')
    const bitmap = await createImageBitmap(png)
    const html = new DOMParser().parseFromString(
      await (await item.getType('text/html')).text(),
      'text/html'
    )
    const embedded = html.querySelector('img')
    const result = {
      types: item.types,
      bytes: png.size,
      width: bitmap.width,
      height: bitmap.height,
      imageCount: html.querySelectorAll('img').length,
      imageSource: embedded?.getAttribute('src').startsWith('data:image/png;'),
      printWidth: embedded?.style.width,
      printHeight: embedded?.style.height,
    }
    bitmap.close()
    return result
  })
}

test('preparation shows product photos, zooms originals and opens saved labels from visible previews', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  await page.evaluate(() => {
    window.revokedPreparationImages = []
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (url) => {
      window.revokedPreparationImages.push(url)
      revoke(url)
    }
  })
  const dialog = await prepare(page, { save: false })
  const group = dialog.locator('.preparation-group').first()
  const photoButton = group.getByRole('button', {
    name: `Zoom product photo ${record.snapshot.items[0].entryId}`,
    exact: true,
  })
  await photoButton.scrollIntoViewIfNeeded()
  await expect(photoButton.getByAltText('Product photo')).toBeVisible()
  const thumbnail = await photoButton.locator('img').getAttribute('src')
  expect(thumbnail).toMatch(/^blob:/)
  await expect(
    group.getByRole('button', { name: 'Edit carton mark', exact: true })
  ).toContainText('Save preparation to assign a code')
  await photoButton.click()
  const photo = page.getByRole('dialog', { name: 'Product photo', exact: true })
  const original = photo.locator('.photo-viewport img')
  await expect(original).toHaveAttribute(
    'src',
    record.snapshot.items[0].thumbnail
  )
  await expect(original).toHaveJSProperty('naturalWidth', 96)
  await expect(photo.locator('.photo-zoom-actions')).toContainText('100%')
  await expect(
    photo.getByRole('button', { name: 'Zoom out', exact: true })
  ).toBeDisabled()
  const originalWidth = await original.evaluate(
    (image) => image.getBoundingClientRect().width
  )
  await photo.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(photo.locator('.photo-zoom-actions')).toContainText('150%')
  expect(
    await original.evaluate((image) => image.getBoundingClientRect().width)
  ).toBeCloseTo(originalWidth * 1.5)
  await photo.getByRole('button', { name: 'Fit', exact: true }).click()
  await expect(photo.locator('.photo-zoom-actions')).toContainText('100%')
  await page.keyboard.press('Escape')
  await expect(photo).not.toBeVisible()
  await expect(dialog).toBeVisible()

  await photoButton.click()
  await expect(photo).toBeVisible()
  const box = await photo.boundingBox()
  await page.mouse.click(Math.max(2, box.x - 5), Math.max(2, box.y + 10))
  await expect(photo).not.toBeVisible()
  await expect(dialog).toBeVisible()
  await dialog
    .getByRole('button', { name: 'Save preparation', exact: true })
    .click()
  const code = group.getByLabel('Product code', { exact: true })
  await expect(code).toHaveValue(/^CE2610\d{4}$/)
  const baseCode = await code.inputValue()
  expect(
    await page.evaluate(
      (url) => window.revokedPreparationImages.includes(url),
      thumbnail
    )
  ).toBe(true)

  const barcode = group
    .locator('.variants tbody tr')
    .first()
    .getByRole('button', { name: 'Edit barcode', exact: true })
  const mark = group.getByRole('button', {
    name: 'Edit carton mark',
    exact: true,
  })
  for (const [button, alt] of [
    [mark, 'Carton mark preview'],
    [barcode, 'Barcode preview'],
  ]) {
    await button.scrollIntoViewIfNeeded()
    const image = button.getByAltText(alt)
    await expect(image).toBeVisible({ timeout: 20_000 })
    await expect
      .poll(() => image.evaluate((item) => item.naturalWidth))
      .toBeGreaterThan(0)
    expect(
      await image.evaluate((item) => item.naturalWidth)
    ).toBeLessThanOrEqual(360)
  }
  // A category edit changes only that group's mark, not unrelated label images.
  await page.setViewportSize({ width: 1280, height: 1800 })
  await dialog.evaluate((node) => {
    node.scrollTop = 0
  })
  const markImage = mark.getByAltText('Carton mark preview')
  const barcodeImage = barcode.getByAltText('Barcode preview')
  const otherMark = dialog
    .locator('.preparation-group')
    .nth(1)
    .getByAltText('Carton mark preview')
  for (const image of [markImage, barcodeImage, otherMark])
    await expect(image).toBeVisible()
  const [oldMark, oldBarcode, oldOther] = await Promise.all(
    [markImage, barcodeImage, otherMark].map((image) =>
      image.getAttribute('src')
    )
  )
  const categoryField = group.getByLabel('Chinese category', { exact: true })
  await categoryField.fill('玻璃制品')
  await expect(markImage).toBeVisible()
  await expect(markImage).not.toHaveAttribute('src', oldMark)
  await expect(barcodeImage).toHaveAttribute('src', oldBarcode)
  await expect(otherMark).toHaveAttribute('src', oldOther)
  await categoryField.fill('玻璃')
  await barcode.click()
  const label = page.getByRole('dialog', { name: 'Label editor', exact: true })
  await expect(label.getByLabel('Barcode code', { exact: true })).toHaveValue(
    `${baseCode}S`
  )
  await expect(
    label.getByRole('button', { name: 'Copy label', exact: true })
  ).toBeEnabled({ timeout: 20_000 })
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  await mark.click()
  await expect(label.getByLabel('Base CE code', { exact: true })).toHaveValue(
    baseCode
  )
  await expect(
    label.getByLabel('Chinese category', { exact: true })
  ).toHaveValue('玻璃')
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  await mark.scrollIntoViewIfNeeded()
  await expect(mark.getByAltText('Carton mark preview')).toBeVisible({
    timeout: 20_000,
  })
  const liveUrls = await dialog
    .locator('img[src^="blob:"]')
    .evaluateAll((images) => images.map((image) => image.src))
  expect(liveUrls.length).toBeGreaterThan(0)
  await dialog
    .getByRole('button', { name: 'Close preparation', exact: true })
    .click()
  await expect
    .poll(() =>
      page.evaluate(
        (urls) =>
          urls.every((url) => window.revokedPreparationImages.includes(url)),
        liveUrls
      )
    )
    .toBe(true)
  expect(extension.unexpectedRequests).toEqual([])
})

test('advanced tools start collapsed and keyboard help explains sizes and grouping without changing data', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  const dialog = await prepare(page, { save: false })
  const groups = dialog.locator('.preparation-group')
  const first = groups.first()
  const variant = first.locator('.variants tbody tr').first()
  for (const details of [
    dialog.locator('.order-tools'),
    first.locator('.group-tools'),
    first.locator('.original-product-name'),
    variant.locator('.variant-code-options'),
  ])
    await expect(details).toHaveJSProperty('open', false)
  await expect(
    dialog.getByRole('button', { name: 'Merge products', exact: true })
  ).not.toBeVisible()
  await expect(
    first.getByRole('button', { name: 'Share one barcode', exact: true })
  ).not.toBeVisible()
  await expect(
    variant.getByLabel('Size on order', { exact: true })
  ).toHaveValue('300ml')
  await openDetails(variant.locator('.variant-code-options'))
  await expect(
    variant.getByRole('textbox', { name: /^Size code / })
  ).toHaveValue('S')
  const codeHelp = variant.getByRole('button', {
    name: 'Help: Variant and size codes',
    exact: true,
  })
  await codeHelp.focus()
  await codeHelp.press('Enter')
  const codePanel = codeHelp.locator('..').locator('.preparation-help-popover')
  await expect(codePanel).toBeVisible()
  await expect(codePanel).toContainText(
    'The option and size describe the product'
  )
  await expect(codePanel).toContainText('product code + A + S')
  await page.keyboard.press('Escape')
  await expect(codePanel).not.toBeVisible()
  await expect(dialog).toBeVisible()

  await openDetails(first.locator('.group-tools'))
  const splitHelp = first.getByRole('button', {
    name: 'Help: Give rows separate barcodes',
    exact: true,
  })
  await splitHelp.click()
  const splitPanel = splitHelp
    .locator('..')
    .locator('.preparation-help-popover')
  await expect(splitPanel).toContainText('several original order rows')
  await expect(splitPanel).toContainText(
    'product code and carton mark stay shared'
  )
  await splitPanel.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(splitPanel).not.toBeVisible()
  await expect(first.locator('.variants tbody tr')).toHaveCount(2)

  await openDetails(dialog.locator('.order-tools'))
  await dialog
    .getByLabel('Chinese category for this order', { exact: true })
    .fill('陶瓷')
  await dialog
    .getByRole('button', { name: 'Apply to this order', exact: true })
    .click()
  await expect(
    groups.nth(0).getByLabel('Chinese category', { exact: true })
  ).toHaveValue('陶瓷')
  await expect(
    groups.nth(1).getByLabel('Chinese category', { exact: true })
  ).toHaveValue('陶瓷')
  await expect(dialog.locator('.order-tools')).toHaveJSProperty('open', false)
  await dialog.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(
    groups.nth(0).getByLabel('Chinese category', { exact: true })
  ).toHaveValue('玻璃')
  await expect(
    groups.nth(1).getByLabel('Chinese category', { exact: true })
  ).toHaveValue('日用品')
  const backup = await packingBackup(extension)
  expect(backup.preparations).toEqual([])
  expect(backup.issuedCodes).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
  ).toBe(true)
  expect(
    await first
      .getByLabel('Spanish short name', { exact: true })
      .evaluate((node) => node.getBoundingClientRect().width)
  ).toBeGreaterThanOrEqual(180)
  expect(extension.unexpectedRequests).toEqual([])
})

test('undo and redo restore unsaved typing and grouping while save clears that order history', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  const dialog = await prepare(page)
  const original = await packingBackup(extension)
  const first = dialog.locator('.preparation-group').first()
  const name = first.getByLabel('Spanish short name', { exact: true })
  const undo = dialog.getByRole('button', { name: 'Undo', exact: true })
  const redo = dialog.getByRole('button', { name: 'Redo', exact: true })
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()
  await name.fill('')
  await name.pressSequentially('frasco editado')
  await undo.click()
  await expect(name).toHaveValue('FRASCO DE VIDRIO')
  await expect(undo).toBeDisabled()
  await redo.click()
  await expect(name).toHaveValue('FRASCO EDITADO')
  await first.locator('.variant-select').nth(0).check()
  await first.locator('.variant-select').nth(1).check()
  await openDetails(first.locator('.group-tools'))
  await first
    .getByRole('button', { name: 'Share one barcode', exact: true })
    .click()
  await expect(first.locator('.variants tbody tr')).toHaveCount(1)
  await expect(first).toContainText('2 source rows')
  await undo.click()
  await expect(first.locator('.variants tbody tr')).toHaveCount(2)
  await expect(name).toHaveValue('FRASCO EDITADO')
  await redo.click()
  await expect(first.locator('.variants tbody tr')).toHaveCount(1)
  const unsaved = await packingBackup(extension)
  expect(unsaved.preparations).toEqual(original.preparations)
  expect(unsaved.issuedCodes).toEqual(original.issuedCodes)
  expect(unsaved.allocations).toEqual(original.allocations)
  expect(unsaved.orders[0].snapshot).toEqual(record.snapshot)
  const saved = await savePreparationAndRead(extension, dialog)
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()
  expect(saved.preparations[0].groups[0].spanishName).toBe('FRASCO EDITADO')
  expect(saved.preparations[0].groups[0].variants[0].entryIds).toEqual(
    record.snapshot.items.slice(0, 2).map((item) => item.entryId)
  )
  expect(saved.preparations[0].groups[0].baseCode).toBe(
    original.preparations[0].groups[0].baseCode
  )
  expect(saved.orders[0].snapshot).toEqual(record.snapshot)
  const base = first.getByLabel('Product code', { exact: true })
  await base.fill('INVALID')
  await dialog
    .getByRole('button', { name: 'Save preparation', exact: true })
    .click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(base).toHaveValue('INVALID')
  await expect(undo).toBeEnabled()
  expect((await packingBackup(extension)).preparations).toEqual(
    saved.preparations
  )
  await undo.click()
  await expect(base).toHaveValue(saved.preparations[0].groups[0].baseCode)
  expect(extension.unexpectedRequests).toEqual([])
})

test('undo follows edits across order switches and saving one order keeps the other draft history', async ({
  extension,
}) => {
  await seedStructuredOrder(extension)
  await seedStructuredOrder(extension, '900000000000000004')
  const page = await extension.context.newPage()
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr')).toHaveCount(6)
  const dialog = await prepare(page, { save: false })
  const order = dialog.getByLabel('Preparation order', { exact: true })
  const name = dialog
    .locator('.preparation-group')
    .first()
    .getByLabel('Spanish short name', { exact: true })
  const undo = dialog.getByRole('button', { name: 'Undo', exact: true })
  const redo = dialog.getByRole('button', { name: 'Redo', exact: true })
  await expect(order.locator('option')).toHaveCount(2)
  await name.fill('PRIMER BORRADOR')
  await order.selectOption('1')
  await name.fill('SEGUNDO BORRADOR')
  await undo.click()
  await expect(order).toHaveValue('1')
  await expect(name).toHaveValue('FRASCO DE VIDRIO')
  await undo.click()
  await expect(order).toHaveValue('0')
  await expect(name).toHaveValue('FRASCO DE VIDRIO')
  await expect(undo).toBeDisabled()
  await redo.click()
  await expect(order).toHaveValue('0')
  await expect(name).toHaveValue('PRIMER BORRADOR')
  await redo.click()
  await expect(order).toHaveValue('1')
  await expect(name).toHaveValue('SEGUNDO BORRADOR')
  const unsaved = await packingBackup(extension)
  expect(unsaved.preparations).toEqual([])
  expect(unsaved.issuedCodes).toEqual([])
  await dialog
    .getByRole('button', { name: 'Save preparation', exact: true })
    .click()
  await expect(
    dialog
      .locator('.preparation-group')
      .first()
      .getByLabel('Product code', { exact: true })
  ).toHaveValue(/^CE2610\d{4}$/)
  await expect(undo).toBeEnabled()
  await expect(redo).toBeDisabled()
  await undo.click()
  await expect(order).toHaveValue('0')
  await expect(name).toHaveValue('FRASCO DE VIDRIO')
  await redo.click()
  await expect(name).toHaveValue('PRIMER BORRADOR')
  await dialog
    .getByRole('button', { name: 'Save preparation', exact: true })
    .click()
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()
  const saved = await packingBackup(extension)
  expect(saved.preparations).toHaveLength(2)
  expect(
    saved.preparations.map((prep) => prep.groups[0].spanishName).sort()
  ).toEqual(['PRIMER BORRADOR', 'SEGUNDO BORRADOR'])
  expect(
    new Set(
      saved.preparations.flatMap((prep) =>
        prep.groups.map((group) => group.baseCode)
      )
    ).size
  ).toBe(4)
  await order.selectOption('1')
  await expect(name).toHaveValue('SEGUNDO BORRADOR')
  expect(extension.unexpectedRequests).toEqual([])
})

test('pending preparation save disables editing and undo until its durable transaction completes', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  const dialog = await prepare(page)
  const original = await packingBackup(extension)
  const name = dialog
    .locator('.preparation-group')
    .first()
    .getByLabel('Spanish short name', { exact: true })
  const undo = dialog.getByRole('button', { name: 'Undo', exact: true })
  const redo = dialog.getByRole('button', { name: 'Redo', exact: true })
  const order = dialog.getByLabel('Preparation order', { exact: true })
  const save = dialog.getByRole('button', {
    name: 'Save preparation',
    exact: true,
  })
  await name.fill('GUARDADO SEGURO')
  await expect(undo).toBeEnabled()
  await page.evaluate(() => {
    // Keep the real write transaction pending, emulating a slow local database.
    // No repository method, saved data or UI handler is replaced.
    window.holdPreparationSave = true
    window.preparationSaveStarted = false
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const result = put.apply(this, args)
      if (
        this.name === 'preparations' &&
        this.transaction.mode === 'readwrite' &&
        window.holdPreparationSave
      ) {
        window.preparationSaveStarted = true
        const keepAlive = () => {
          if (!window.holdPreparationSave) return
          const request = this.get([args[0].accountId, args[0].orderId])
          request.onsuccess = keepAlive
        }
        keepAlive()
      }
      return result
    }
  })
  await save.click()
  await expect
    .poll(() => page.evaluate(() => window.preparationSaveStarted))
    .toBe(true)
  await expect(save).toBeDisabled()
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()
  await expect(name).toBeDisabled()
  await expect(order).toBeDisabled()
  await expect(dialog.locator('.variant-select').first()).toBeDisabled()
  await page.keyboard.type('SHOULD NOT EDIT')
  await expect(name).toHaveValue('GUARDADO SEGURO')
  await page.evaluate(() => {
    window.holdPreparationSave = false
  })
  await expect(save).toBeEnabled()
  await expect(name).toBeEnabled()
  await expect(order).toBeEnabled()
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()
  await expect(name).toHaveValue('GUARDADO SEGURO')
  const saved = await packingBackup(extension)
  expect(saved.preparations[0].revision).toBe(
    original.preparations[0].revision + 1
  )
  expect(saved.preparations[0].groups[0].spanishName).toBe('GUARDADO SEGURO')
  expect(saved.issuedCodes).toEqual(original.issuedCodes)
  expect(saved.orders).toEqual(original.orders)
  expect(extension.unexpectedRequests).toEqual([])
})

test('label editor saves repeated text edits and copies barcode and carton images at print resolution', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  const preparation = await prepare(page)
  const baseCode = await preparation
    .locator('.preparation-group')
    .first()
    .getByLabel('Product code', { exact: true })
    .inputValue()
  await preparation
    .getByRole('button', { name: 'Close preparation', exact: true })
    .click()
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])

  const firstRow = page.locator('#sheet-body tr').first()
  await firstRow.getByRole('button', { name: 'Barcode', exact: true }).click()
  const label = page.getByRole('dialog', { name: 'Label editor', exact: true })
  const code = label.getByRole('textbox', { name: 'Barcode code', exact: true })
  const spanish = label.getByRole('textbox', {
    name: 'Spanish product name',
    exact: true,
  })
  const copy = label.getByRole('button', { name: 'Copy label', exact: true })
  await expect(
    label.getByRole('heading', { name: 'Barcode label' })
  ).toBeVisible()
  await expect(code).toHaveValue(`${baseCode}S`)
  await expect(spanish).toHaveValue('FRASCO DE VIDRIO')
  await expect(label.getByAltText('Printable label preview')).toBeVisible()
  await expect(copy).toBeEnabled({ timeout: 20_000 })

  await spanish.fill('frasco transparente')
  await spanish.press('Enter')
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  await expect(spanish).toHaveValue('FRASCO TRANSPARENTE')
  await code.fill(`${baseCode}as`.toLowerCase())
  await code.press('Enter')
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  await expect(code).toHaveValue(`${baseCode}AS`)
  await spanish.fill('discarded edit')
  await spanish.press('Escape')
  await expect(spanish).toHaveValue('FRASCO TRANSPARENTE')
  await expect(label).toBeVisible()
  await expect(copy).toBeEnabled({ timeout: 20_000 })

  const barcode = await copiedLabel(page, label)
  expect(barcode.types).toEqual(
    expect.arrayContaining(['image/png', 'text/html'])
  )
  expect(barcode.bytes).toBeGreaterThan(100)
  expect(barcode).toMatchObject({
    width: 472,
    height: 236,
    imageCount: 1,
    imageSource: true,
    printWidth: '40mm',
    printHeight: '20mm',
  })
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()

  await page.reload()
  await firstRow.getByRole('button', { name: 'Barcode', exact: true }).click()
  await expect(code).toHaveValue(`${baseCode}AS`)
  await expect(spanish).toHaveValue('FRASCO TRANSPARENTE')
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()

  await firstRow
    .getByRole('button', { name: 'Carton mark', exact: true })
    .click()
  const markCode = label.getByRole('textbox', {
    name: 'Base CE code',
    exact: true,
  })
  const category = label.getByRole('textbox', {
    name: 'Chinese category',
    exact: true,
  })
  await expect(
    label.getByRole('heading', { name: 'Carton mark' })
  ).toBeVisible()
  await expect(markCode).toHaveValue(baseCode)
  await category.fill('玻璃制品')
  await category.press('Enter')
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  const updatedBaseCode = 'CE26109998'
  await markCode.fill(updatedBaseCode)
  await markCode.press('Enter')
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  await expect(markCode).toHaveValue(updatedBaseCode)

  const mark = await copiedLabel(page, label)
  expect(mark.types).toEqual(expect.arrayContaining(['image/png', 'text/html']))
  expect(mark.bytes).toBeGreaterThan(100)
  expect(mark).toMatchObject({
    width: 1754,
    height: 1240,
    imageCount: 1,
    imageSource: true,
    printWidth: '148.5mm',
    printHeight: '105mm',
  })
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  await page.reload()
  await expect(page.locator('.row-preparation code').nth(0)).toHaveText(
    updatedBaseCode
  )
  await expect(page.locator('.row-preparation code').nth(1)).toHaveText(
    updatedBaseCode
  )
  await firstRow
    .getByRole('button', { name: 'Carton mark', exact: true })
    .click()
  await expect(markCode).toHaveValue(updatedBaseCode)
  await expect(category).toHaveValue('玻璃制品')
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  await firstRow.getByRole('button', { name: 'Barcode', exact: true }).click()
  await expect(code).toHaveValue(`${updatedBaseCode}AS`)
  await expect(spanish).toHaveValue('FRASCO TRANSPARENTE')
  const library = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'LIBRARY_QUERY' })
  )
  expect(library.ok, library.error).toBe(true)
  expect(library.data.orders[0].snapshot).toEqual(record.snapshot)
  expect(extension.unexpectedRequests).toEqual([])
})

async function packingBackup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}

async function savePreparationAndRead(extension, dialog) {
  const revision = (await packingBackup(extension)).preparations[0].revision
  const previousButton = await dialog
    .getByRole('button', { name: 'Save preparation', exact: true })
    .elementHandle()
  await dialog
    .getByRole('button', { name: 'Save preparation', exact: true })
    .click()
  let backup
  await expect
    .poll(async () => {
      backup = await packingBackup(extension)
      return backup.preparations[0].revision
    })
    .toBe(revision + 1)
  await expect
    .poll(() => previousButton.evaluate((button) => button.isConnected))
    .toBe(false)
  await previousButton.dispose()
  return backup
}

test('combining, separating, splitting and merging preserve source rows and saved code ownership', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  const dialog = await prepare(page)
  const groups = dialog.locator('.preparation-group')
  const first = groups.first()
  const original = (await packingBackup(extension)).preparations[0]
  const originalGroup = original.groups[0]
  const originalCode = originalGroup.baseCode
  const sharedBarcode = `${originalCode}${originalGroup.variants[0].variantSuffix}${originalGroup.variants[0].sizeSuffix}`
  const sourceIds = record.snapshot.items.map((item) => item.entryId)
  await first.locator('.variant-select').nth(0).check()
  await first.locator('.variant-select').nth(1).check()
  await openDetails(first.locator('.group-tools'))
  await first
    .getByRole('button', { name: 'Share one barcode', exact: true })
    .click()
  await expect(first.locator('.variants tbody tr')).toHaveCount(1)
  await expect(first).toContainText('2 source rows')
  let backup = await savePreparationAndRead(extension, dialog)
  expect(backup.preparations[0].groups[0].variants).toHaveLength(1)
  expect(backup.preparations[0].groups[0].variants[0].entryIds).toEqual(
    sourceIds.slice(0, 2)
  )
  expect(backup.orders[0].snapshot).toEqual(record.snapshot)
  await dialog
    .getByRole('button', { name: 'Close preparation', exact: true })
    .click()
  await expect(page.locator('#sheet-body tr')).toHaveCount(3)
  for (const index of [0, 1]) {
    await page
      .locator('#sheet-body tr')
      .nth(index)
      .getByRole('button', { name: 'Barcode', exact: true })
      .click()
    const label = page.getByRole('dialog', {
      name: 'Label editor',
      exact: true,
    })
    await expect(
      label.getByRole('textbox', { name: 'Barcode code', exact: true })
    ).toHaveValue(sharedBarcode)
    await label
      .getByRole('button', { name: 'Close label editor', exact: true })
      .click()
  }

  await page
    .getByRole('button', { name: 'Edit preparation', exact: true })
    .click()
  await first.locator('.variant-select').check()
  await openDetails(first.locator('.group-tools'))
  await first
    .getByRole('button', { name: 'Give rows separate barcodes', exact: true })
    .click()
  await expect(first.locator('.variants tbody tr')).toHaveCount(2)
  await expect(first).not.toContainText('2 source rows')
  backup = await savePreparationAndRead(extension, dialog)
  const separated = backup.preparations[0].groups[0]
  expect(separated.variants.map((variant) => variant.entryIds)).toEqual(
    sourceIds.slice(0, 2).map((id) => [id])
  )
  expect(
    new Set(
      separated.variants.map(
        (variant) => `${variant.variantSuffix}${variant.sizeSuffix}`
      )
    ).size
  ).toBe(2)
  expect(separated.baseCode).toBe(originalCode)
  expect(backup.orders[0].snapshot).toEqual(record.snapshot)

  // Combining retires the second barcode. A later separation must allocate a
  // new suffix instead of reassigning that code to a newly created variant.
  const retiredVariant = separated.variants[1]
  const retiredBarcode = `${originalCode}${retiredVariant.variantSuffix}${retiredVariant.sizeSuffix}`
  await first.locator('.variant-select').nth(0).check()
  await first.locator('.variant-select').nth(1).check()
  await openDetails(first.locator('.group-tools'))
  await first
    .getByRole('button', { name: 'Share one barcode', exact: true })
    .click()
  await expect(first.locator('.variants tbody tr')).toHaveCount(1)
  backup = await savePreparationAndRead(extension, dialog)
  expect(backup.preparations[0].groups[0].variants[0].entryIds).toEqual(
    sourceIds.slice(0, 2)
  )
  await first.locator('.variant-select').check()
  await openDetails(first.locator('.group-tools'))
  await first
    .getByRole('button', { name: 'Give rows separate barcodes', exact: true })
    .click()
  await expect(first.locator('.variants tbody tr')).toHaveCount(2)
  backup = await savePreparationAndRead(extension, dialog)
  const separatedAgain = backup.preparations[0].groups[0].variants[1]
  expect(separatedAgain.id).not.toBe(retiredVariant.id)
  expect(separatedAgain.entryIds).toEqual([sourceIds[1]])
  expect(separatedAgain.variantSuffix).toBe('B')
  expect(
    `${originalCode}${separatedAgain.variantSuffix}${separatedAgain.sizeSuffix}`
  ).not.toBe(retiredBarcode)
  expect(
    backup.issuedCodes.some(
      (issued) =>
        issued.code === retiredBarcode && issued.variantId === retiredVariant.id
    )
  ).toBe(true)
  expect(backup.orders[0].snapshot).toEqual(record.snapshot)

  await first.locator('.variant-select').nth(1).check()
  await openDetails(first.locator('.group-tools'))
  await first
    .getByRole('button', { name: 'Move to new product', exact: true })
    .click()
  await expect(groups).toHaveCount(3)
  await expect(
    groups.nth(2).getByLabel('Product code', { exact: true })
  ).toHaveValue('')
  backup = await savePreparationAndRead(extension, dialog)
  const splitCode = backup.preparations[0].groups[2].baseCode
  expect(splitCode).toMatch(/^CE2610\d{4}$/)
  expect(splitCode).not.toBe(originalCode)
  expect(backup.preparations[0].groups[2].variants[0].entryIds).toEqual([
    sourceIds[1],
  ])
  expect(backup.orders[0].snapshot).toEqual(record.snapshot)

  await groups.nth(0).locator('.group-select').check()
  await groups.nth(2).locator('.group-select').check()
  await openDetails(dialog.locator('.order-tools'))
  await dialog
    .getByRole('button', { name: 'Merge products', exact: true })
    .click()
  await expect(groups).toHaveCount(2)
  await expect(first.locator('.variants tbody tr')).toHaveCount(2)
  backup = await savePreparationAndRead(extension, dialog)
  const final = backup.preparations[0]
  expect(final.groups[0].baseCode).toBe(originalCode)
  expect(
    final.groups[0].variants.flatMap((variant) => variant.entryIds).sort()
  ).toEqual(sourceIds.slice(0, 2).sort())
  expect(final.groups[1].variants[0].entryIds).toEqual([sourceIds[2]])
  expect(
    backup.issuedCodes.some(
      (issued) => issued.kind === 'base' && issued.code === splitCode
    )
  ).toBe(true)
  expect(backup.orders[0].snapshot).toEqual(record.snapshot)
  await dialog
    .getByRole('button', { name: 'Close preparation', exact: true })
    .click()
  await page.reload()
  await expect(page.locator('#sheet-body tr')).toHaveCount(3)
  await expect(page.locator('.row-preparation code')).toHaveText([
    originalCode,
    originalCode,
    original.groups[1].baseCode,
  ])
  expect(extension.unexpectedRequests).toEqual([])
})

async function observeLabelOutput(page, extension) {
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.bringToFront()
  await page.evaluate(async () => {
    await navigator.clipboard.writeText('Synthetic label cancellation sentinel')
    window.labelOutputProbe = { renders: 0, writes: 0 }
    const encode = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      window.labelOutputProbe.renders++
      return encode.apply(this, args)
    }
    const write = navigator.clipboard.write.bind(navigator.clipboard)
    navigator.clipboard.write = (...args) => {
      window.labelOutputProbe.writes++
      return write(...args)
    }
  })
}

test('dirty preparation blocks both bulk label actions before rendering or copying saved text', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension, { previews: false })
  const dialog = await prepare(page)
  const original = await packingBackup(extension)
  await observeLabelOutput(page, extension)
  await dialog
    .locator('.preparation-group')
    .first()
    .getByLabel('Spanish short name', { exact: true })
    .fill('nombre pendiente')
  for (const name of ['Copy barcode images', 'Copy carton marks']) {
    await dialog.getByRole('button', { name, exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(
      'Save each edited preparation before copying its label images.'
    )
    await expect(
      page.getByRole('dialog', { name: 'Confirm operation', exact: true })
    ).not.toBeVisible()
    await expect(
      page.getByRole('dialog', { name: 'Prepare label images', exact: true })
    ).not.toBeVisible()
  }
  expect((await packingBackup(extension)).preparations).toEqual(
    original.preparations
  )
  expect(await page.evaluate(() => window.labelOutputProbe)).toEqual({
    renders: 0,
    writes: 0,
  })
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Synthetic label cancellation sentinel'
  )

  const saved = await savePreparationAndRead(extension, dialog)
  expect(saved.preparations[0].groups[0].spanishName).toBe('NOMBRE PENDIENTE')
  await dialog
    .getByRole('button', { name: 'Copy barcode images', exact: true })
    .click()
  const confirmation = page.getByRole('dialog', {
    name: 'Confirm operation',
    exact: true,
  })
  await expect(
    confirmation.getByRole('button', {
      name: 'Copy 3 barcode labels',
      exact: true,
    })
  ).toBeVisible()
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await expect(confirmation).not.toBeVisible()
  expect(await page.evaluate(() => window.labelOutputProbe)).toEqual({
    renders: 0,
    writes: 0,
  })
  expect(extension.unexpectedRequests).toEqual([])
})

test('selected rows limit barcode and carton scope and cancellation leaves the clipboard unchanged', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension, { previews: false })
  const dialog = await prepare(page)
  await dialog
    .getByRole('button', { name: 'Close preparation', exact: true })
    .click()
  await page.locator('#sheet-body tr').nth(0).getByRole('checkbox').check()
  await page.locator('#sheet-body tr').nth(1).getByRole('checkbox').check()
  await expect(page.locator('#selection-summary')).toContainText('2 selected')
  await page
    .getByRole('button', { name: 'Edit preparation', exact: true })
    .click()
  await observeLabelOutput(page, extension)
  await dialog
    .getByRole('button', { name: 'Copy barcode images', exact: true })
    .click()
  const confirmation = page.getByRole('dialog', {
    name: 'Confirm operation',
    exact: true,
  })
  await expect(
    confirmation.getByRole('button', {
      name: 'Copy 2 barcode labels',
      exact: true,
    })
  ).toBeVisible()
  expect(await page.evaluate(() => window.labelOutputProbe)).toEqual({
    renders: 0,
    writes: 0,
  })
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await expect(confirmation).not.toBeVisible()
  await expect(
    page.getByRole('dialog', { name: 'Prepare label images', exact: true })
  ).not.toBeVisible()
  expect(await page.evaluate(() => window.labelOutputProbe)).toEqual({
    renders: 0,
    writes: 0,
  })

  // Both selected variants share one group; its carton mark must be generated once.
  await dialog
    .getByRole('button', { name: 'Copy carton marks', exact: true })
    .click()
  const images = page.getByRole('dialog', {
    name: 'Prepare label images',
    exact: true,
  })
  await expect(images).toContainText('1 images ready.')
  await expect(
    images.getByRole('button', { name: 'Copy prepared images', exact: true })
  ).toBeEnabled()
  await expect(confirmation).not.toBeVisible()
  await images.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(images).not.toBeVisible()
  expect((await page.evaluate(() => window.labelOutputProbe)).writes).toBe(0)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Synthetic label cancellation sentinel'
  )
  expect(extension.unexpectedRequests).toEqual([])
})
