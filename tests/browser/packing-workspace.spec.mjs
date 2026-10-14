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

async function waitForAutosave(dialog) {
  await expect(dialog.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
}

async function pauseAutosave(page) {
  const now = new Date()
  // Installation starts a running clock. Leave headroom before the pause target
  // so time spent between these two protocol calls cannot put it in the past.
  await page.clock.install({ time: new Date(now.getTime() - 60_000) })
  await page.clock.pauseAt(now)
}

async function prepare(page) {
  await page.getByLabel('Packing month', { exact: true }).fill('2026-10')
  await page
    .getByRole('button', { name: 'Prepare labels', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Preparation', exact: true })
  await expect(dialog.locator('.preparation-group')).toHaveCount(2)
  await expect(
    dialog.locator('.preparation-group').first().locator('.variants tbody tr')
  ).toHaveCount(2)
  await waitForAutosave(dialog)
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
  await expect(variant.locator('.variant-code-options')).toBeVisible()
  await variant.getByRole('textbox', { name: /^Variant code / }).fill('b')
  await variant.getByRole('textbox', { name: /^Size code / }).fill('xs')
  await waitForAutosave(dialog)
  await expect(
    group.getByLabel('Spanish short name', { exact: true })
  ).toHaveValue(/frasco transparente/i)
  await expect(
    group.getByLabel('Chinese category', { exact: true })
  ).toHaveValue('玻璃制品')
  await expect(variant.locator('.variant-code-options')).toBeVisible()
  await expect(
    variant.getByRole('textbox', { name: /^Variant code / })
  ).toHaveValue(/b/i)
  await expect(
    variant.getByRole('textbox', { name: /^Size code / })
  ).toHaveValue(/xs/i)
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
  await expect(variant.locator('.variant-code-options')).toBeVisible()
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

test('Copy Excel image freezes selected rows and includes Chinese headings, photos and prepared values', async ({
  extension,
}, testInfo) => {
  const { page, record } = await openWorkspace(extension)
  const dialog = await prepare(page)
  const group = dialog.locator('.preparation-group').first()
  const base = await group
    .getByLabel('Product code', { exact: true })
    .inputValue()
  await group
    .getByLabel('Spanish short name', { exact: true })
    .fill('FRASCO DE PRUEBA')
  await group.getByLabel('Chinese category', { exact: true }).fill('玻璃制品')
  await waitForAutosave(dialog)
  await dialog
    .getByRole('button', { name: 'Close preparation', exact: true })
    .click()
  const original = await packingBackup(extension)
  const rows = page.locator('#sheet-body tr')
  await rows.nth(0).locator('.product-title').click()
  await rows
    .nth(1)
    .locator('.product-title')
    .click({ modifiers: ['Shift'] })
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.evaluate(async () => {
    await navigator.clipboard.writeText('clipboard-before-image')
    globalThis.tableImageDrawing = { text: [], images: 0 }
    const fillText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      globalThis.tableImageDrawing.text.push(String(text))
      return fillText.call(this, text, ...args)
    }
    const drawImage = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      globalThis.tableImageDrawing.images++
      return drawImage.apply(this, args)
    }
  })
  const copy = page.locator('#copy-excel-image')
  await copy.click()
  const confirmation = page.getByRole('dialog', {
    name: 'Confirm operation',
    exact: true,
  })
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await expect(copy).toHaveText('Copy Excel image')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'clipboard-before-image'
  )
  expect(await page.evaluate(() => tableImageDrawing)).toEqual({
    text: [],
    images: 0,
  })

  await copy.click()
  // An asynchronous filter update after confirmation opens must not change its scope.
  await page.evaluate(() => {
    const search = document.getElementById('search')
    search.value = 'TEST-BOX'
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await confirmation
    .getByRole('button', { name: 'Copy 2 product rows', exact: true })
    .click()
  await expect(copy).toHaveText('Copied')
  await expect(copy).toHaveClass(/copied/)
  await expect(page.locator('#feedback')).toBeEmpty()
  const drawing = await page.evaluate(() => tableImageDrawing)
  expect(drawing.text.slice(0, 10)).toEqual([
    '序号',
    '图片',
    '产品描述',
    '产品编码',
    '条码编号',
    '西班牙语品名',
    '中文品类',
    '单价（元）',
    '数量',
    '优惠（元）',
  ])
  expect(drawing.text.filter((value) => value === base)).toHaveLength(1)
  expect(drawing.text).toContain(`${base}S`)
  expect(drawing.text).toContain(`${base}L`)
  expect(drawing.text).toContain('FRASCO DE PRUEBA')
  expect(drawing.text).toContain('玻璃制品')
  expect(drawing.text.join('')).toContain('300ml')
  expect(drawing.text.join('')).toContain('500ml')
  expect(drawing.text.join('')).not.toContain('TEST-BOX')
  for (const item of record.snapshot.items.slice(0, 2))
    for (const field of ['price', 'quantity', 'discount'])
      expect(drawing.text).toContain(item[field])
  expect(drawing.images).toBeGreaterThanOrEqual(2)
  const image = await page.evaluate(async () => {
    const clipboard = await navigator.clipboard.read()
    const blob = await clipboard[0].getType('image/png')
    const bitmap = await createImageBitmap(blob)
    const dimensions = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return {
      ...dimensions,
      bytes: [...new Uint8Array(await blob.arrayBuffer())],
    }
  })
  expect(image.width).toBeGreaterThan(1500)
  expect(image.height).toBeGreaterThan(200)
  expect(image.width * image.height).toBeLessThanOrEqual(16_000_000)
  await testInfo.attach('Selected rows with Chinese headings', {
    body: Buffer.from(image.bytes),
    contentType: 'image/png',
  })
  expect((await packingBackup(extension)).preparations).toEqual(
    original.preparations
  )
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
  await waitForAutosave(dialog)
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
    .getByRole('button', { name: 'Edit preparation', exact: true })
    .click()
  await expect(dialog.locator('.preparation-heading')).toContainText(
    'Packing January 2027'
  )
  await expect(
    dialog
      .locator('.preparation-group')
      .first()
      .getByLabel('Product code', { exact: true })
  ).toHaveValue(/^CE2701\d{4}$/)
  await dialog
    .getByRole('button', { name: 'Close preparation', exact: true })
    .click()
  await expect(month).toHaveValue('2027-02')

  await month.fill('2027-03')
  await page
    .getByRole('button', { name: 'Edit preparation', exact: true })
    .click()
  await expect(dialog.locator('.preparation-heading')).toContainText(
    'Packing January 2027'
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
    'Packing January 2027'
  )
  await expect(
    dialog
      .locator('.preparation-group')
      .first()
      .getByLabel('Product code', { exact: true })
  ).toHaveValue(/^CE2701\d{4}$/)
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
  const dialog = await prepare(page)
  const group = dialog.locator('.preparation-group').first()
  const photoButton = group.getByRole('button', {
    name: `Zoom product photo ${record.snapshot.items[0].entryId}`,
    exact: true,
  })
  await photoButton.scrollIntoViewIfNeeded()
  await expect(photoButton.getByAltText('Product photo')).toBeVisible()
  const thumbnail = await photoButton.locator('img').getAttribute('src')
  expect(thumbnail).toMatch(/^blob:/)
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
  const code = group.getByLabel('Product code', { exact: true })
  await expect(code).toHaveValue(/^CE2610\d{4}$/)
  const baseCode = await code.inputValue()

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
  async function closeEditor() {
    // The native close event is queued. Wait for its preparation rebuild before
    // resolving a preview to scroll; scrolling does not retry a detached target.
    const previous = await mark.elementHandle()
    try {
      await label
        .getByRole('button', { name: 'Close label editor', exact: true })
        .click()
      await expect
        .poll(() => previous.evaluate((node) => node.isConnected))
        .toBe(false)
    } finally {
      await previous.dispose()
    }
  }
  await expect(label.getByLabel('Barcode code', { exact: true })).toHaveText(
    `${baseCode}S`
  )
  await expect(
    label.getByRole('button', { name: 'Copy label', exact: true })
  ).toBeEnabled({ timeout: 20_000 })
  await closeEditor()
  await mark.click()
  await expect(label.getByLabel('Base CE code', { exact: true })).toHaveValue(
    baseCode
  )
  await expect(
    label.getByLabel('Chinese category', { exact: true })
  ).toHaveValue('玻璃')
  await closeEditor()
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
  expect(
    await page.evaluate(
      (url) => window.revokedPreparationImages.includes(url),
      thumbnail
    )
  ).toBe(true)
  expect(extension.unexpectedRequests).toEqual([])
})

test('preparation has no collapsibles and keeps categories, names, grouping and codes visible', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  const dialog = await prepare(page)
  const original = await packingBackup(extension)
  const groups = dialog.locator('.preparation-group')
  const first = groups.first()
  const variant = first.locator('.variants tbody tr').first()
  // Preview completion changes row height. Finish that layout work before
  // positioning the pointer over a grouping action for its delayed hover hint.
  await expect(first.getByAltText('Carton mark preview')).toBeVisible({
    timeout: 20_000,
  })
  await expect(first.getByAltText('Barcode preview')).toHaveCount(2, {
    timeout: 20_000,
  })
  for (const preview of await first.getByAltText('Barcode preview').all())
    await expect(preview).toBeVisible()
  await expect(dialog.locator('details, summary')).toHaveCount(0)
  for (const section of [
    dialog.locator('.order-tools'),
    first.locator('.group-tools'),
    first.locator('.original-product-name'),
  ])
    await expect(section).toBeVisible()
  await expect(first.locator('.original-product-name')).toContainText(
    '合成玻璃罐'
  )
  await expect(
    first.getByLabel('Chinese category', { exact: true })
  ).toBeVisible()
  await expect(
    dialog.getByLabel('Chinese category for this order', { exact: true })
  ).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Merge products', exact: true })
  ).toBeVisible()
  await expect(
    first.getByRole('button', { name: 'Share one barcode', exact: true })
  ).toBeVisible()
  await expect(dialog.getByRole('button', { name: /^Help:/ })).toHaveCount(0)
  await expect(
    variant.getByLabel('Size on order', { exact: true })
  ).toHaveCount(0)
  await expect(variant.locator('.source-size')).toHaveText('Order size: 300ml')
  await expect(
    variant.getByLabel('Product variant', { exact: true })
  ).toHaveValue('颜色: 透明')
  await expect(variant.locator('.variant-code-options')).toBeVisible()
  await expect(
    variant.getByRole('group', { name: 'Code options' })
  ).toBeVisible()
  await expect(variant.locator('.variant-code-options summary')).toHaveCount(0)
  await expect(
    variant.getByRole('textbox', { name: /^Size code / })
  ).toHaveValue('S')
  const codeHelp = variant.getByRole('textbox', { name: /^Size code / })
  await codeHelp.focus()
  const codePanel = dialog.getByRole('tooltip')
  await expect(codePanel).toBeVisible()
  await expect(codePanel).toHaveText(
    'Identifies the size: S, M, L. Leave blank when not needed.'
  )
  await page.keyboard.press('Escape')
  await expect(codePanel).not.toBeVisible()
  await expect(dialog).toBeVisible()

  const splitHelp = first.getByRole('button', {
    name: 'Give rows separate barcodes',
    exact: true,
  })
  await splitHelp.hover()
  const splitPanel = dialog.getByRole('tooltip')
  await expect(splitPanel).toContainText('barcode')
  await expect(splitPanel.getByRole('button')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(splitPanel).not.toBeVisible()
  await expect(first.locator('.variants tbody tr')).toHaveCount(2)

  await pauseAutosave(page)
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
  await expect(dialog.locator('.order-tools')).toBeVisible()
  await dialog.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(
    groups.nth(0).getByLabel('Chinese category', { exact: true })
  ).toHaveValue('玻璃')
  await expect(
    groups.nth(1).getByLabel('Chinese category', { exact: true })
  ).toHaveValue('日用品')
  const backup = await packingBackup(extension)
  expect(backup.preparations).toEqual(original.preparations)
  expect(backup.issuedCodes).toEqual(original.issuedCodes)
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

test('compact preparation fits two product groups without hiding fields or clipping narrow layouts', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await page.setViewportSize({ width: 1280, height: 960 })
  const dialog = await prepare(page)
  const groups = dialog.locator('.preparation-group')
  const first = groups.first()
  // Wait for real raster readiness, as in the media test; autosave is independent
  // of Windows' asynchronous canvas encoding and the bounded preview queue.
  await expect(first.getByAltText('Carton mark preview')).toBeVisible({
    timeout: 20_000,
  })
  await expect(first.getByAltText('Barcode preview').first()).toBeVisible({
    timeout: 20_000,
  })
  await dialog.evaluate((node) => {
    node.scrollTop = 0
  })
  const bounds = await dialog.boundingBox()
  const firstBounds = await first.boundingBox()
  const lastBounds = await groups.last().boundingBox()
  expect(firstBounds.y - bounds.y).toBeLessThanOrEqual(190)
  expect(lastBounds.height).toBeLessThanOrEqual(330)
  expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(
    bounds.y + bounds.height
  )
  const summary = await first.locator('.product-summary').boundingBox()
  const mark = await first.locator('.carton-preview').boundingBox()
  expect(summary.x + summary.width).toBeLessThanOrEqual(mark.x)
  expect(Math.abs(summary.y - mark.y)).toBeLessThanOrEqual(2)
  for (const group of await groups.all()) {
    await expect(
      group.getByLabel('Chinese category', { exact: true })
    ).toBeVisible()
    await expect(group.locator('.original-product-name')).toBeVisible()
    await expect(group.locator('.group-tools')).toBeVisible()
    await expect(
      group.getByText('Single variant', { exact: true })
    ).toHaveCount(0)
    const note = group.getByLabel('Product variant', { exact: true }).first()
    await expect(note).toBeVisible()
    // The table heading names this column once; each field retains its accessible name.
    expect(
      (await group.locator('.variant-note > span').first().boundingBox()).width
    ).toBeLessThanOrEqual(1)
  }
  for (const width of [1024, 700, 390]) {
    await page.setViewportSize({ width, height: 960 })
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    ).toBe(true)
    const fields = first.locator('.group-fields')
    expect(
      await fields.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    ).toBe(true)
    await expect(
      first.getByRole('group', { name: 'Code options' }).first()
    ).toBeVisible()
  }
  expect(extension.unexpectedRequests).toEqual([])
})

test('an unfinished barcode uses a compact, fully readable message without clipping', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  const dialog = await prepare(page)
  const group = dialog.locator('.preparation-group').first()
  await group.getByLabel('Spanish short name', { exact: true }).fill('')
  const preview = group
    .getByRole('button', { name: 'Edit barcode', exact: true })
    .first()
  await preview.scrollIntoViewIfNeeded()
  await expect(preview.locator('span')).toContainText('Spanish')
  await expect(preview.locator('img')).toBeHidden()
  const state = await preview.evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    readable:
      node.scrollWidth <= node.clientWidth + 1 &&
      node.scrollHeight <= node.clientHeight + 1,
  }))
  expect(state.height).toBeLessThanOrEqual(100)
  expect(state.readable).toBe(true)
  await expect(dialog.locator('details')).toHaveCount(0)
})

test('preparation selects groups and variant rows by range without changing edits or intercepting controls', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  const dialog = await prepare(page)
  const original = await packingBackup(extension)
  const groups = dialog.locator('.preparation-group')
  const first = groups.first()
  const rows = first.locator('.variants tbody tr')
  const secondRow = groups.nth(1).locator('.variants tbody tr')
  await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(0)
  await expect(first.getByRole('grid')).toHaveAttribute(
    'aria-multiselectable',
    'true'
  )

  await groups.nth(0).locator('.group-select').click()
  await groups
    .nth(1)
    .locator('.group-select')
    .click({ modifiers: ['Shift'] })
  await expect(
    groups.locator('.group-select[aria-pressed="true"]')
  ).toHaveCount(2)
  await first.locator('.variant-index').nth(0).click()
  await first
    .locator('.variant-index')
    .nth(1)
    .click({ modifiers: ['Shift'] })
  await expect(
    first.locator('.variants tbody tr[aria-selected="true"]')
  ).toHaveCount(2)

  // Selection belongs to its group; selecting another group does not discard it.
  await secondRow.locator('.variant-index').click()
  await expect(secondRow).toHaveAttribute('aria-selected', 'true')
  await expect(
    first.locator('.variants tbody tr[aria-selected="true"]')
  ).toHaveCount(2)
  await expect(
    groups.locator('.group-select[aria-pressed="true"]')
  ).toHaveCount(2)
  await rows
    .nth(1)
    .locator('.variant-index')
    .click({ modifiers: ['Control'] })
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'false')

  // Native inputs, photos and preview buttons must never select their row/card.
  await rows.nth(1).getByLabel('Product variant', { exact: true }).click()
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'false')
  await rows.nth(1).locator('.preparation-photo').first().click()
  const viewer = page.getByRole('dialog', {
    name: 'Product photo',
    exact: true,
  })
  await expect(viewer).toBeVisible()
  await viewer
    .getByRole('button', { name: 'Close product photo', exact: true })
    .click()
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'false')
  await rows
    .nth(1)
    .getByRole('button', { name: 'Edit barcode', exact: true })
    .click()
  const label = page.getByRole('dialog', { name: 'Label editor', exact: true })
  await expect(label).toBeVisible()
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  // Returning from the editor rebuilds the form but keeps its selection.
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'false')
  await expect(secondRow).toHaveAttribute('aria-selected', 'true')
  await expect(
    groups.locator('.group-select[aria-pressed="true"]')
  ).toHaveCount(2)

  // Row keyboard range selection uses the same state as pointer selection.
  await rows.nth(0).locator('.variant-index').click()
  await page.keyboard.press('Shift+ArrowDown')
  await expect(rows.nth(1)).toBeFocused()
  await expect(
    first.locator('.variants tbody tr[aria-selected="true"]')
  ).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(
    first.locator('.variants tbody tr[aria-selected="true"]')
  ).toHaveCount(0)
  await expect(secondRow).toHaveAttribute('aria-selected', 'true')

  // A noninteractive area selects the whole group without storing UI state
  // as preparation edits.
  await first.locator('.original-product-name').click()
  await expect(first.locator('.group-select')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(groups.nth(1).locator('.group-select')).toHaveAttribute(
    'aria-pressed',
    'false'
  )
  await expect(
    dialog.getByRole('button', { name: 'Undo', exact: true })
  ).toBeDisabled()
  await expect(dialog.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  const afterSelection = await packingBackup(extension)
  expect(afterSelection.preparations).toEqual(original.preparations)
  expect(afterSelection.issuedCodes).toEqual(original.issuedCodes)
  expect(afterSelection.orders).toEqual(original.orders)
})

test('undo and redo restore pending typing and grouping while autosave clears that order history', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  const dialog = await prepare(page)
  const original = await packingBackup(extension)
  await pauseAutosave(page)
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
  await first.locator('.variant-index').nth(0).click()
  await first
    .locator('.variant-index')
    .nth(1)
    .click({ modifiers: ['Control'] })
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
  await page.clock.runFor(801)
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
  await page.clock.runFor(801)
  await expect(dialog.locator('.preparation-save-status')).toContainText(
    'Not saved'
  )
  await expect(base).toHaveValue('INVALID')
  await expect(undo).toBeEnabled()
  expect((await packingBackup(extension)).preparations).toEqual(
    saved.preparations
  )
  await undo.click()
  await expect(base).toHaveValue(saved.preparations[0].groups[0].baseCode)
  expect(extension.unexpectedRequests).toEqual([])
})

test('undo follows pending edits across orders and autosave never prepares an unopened order', async ({
  extension,
}) => {
  await seedStructuredOrder(extension)
  await seedStructuredOrder(extension, '900000000000000004')
  await seedStructuredOrder(extension, '900000000000000005')
  const page = await extension.context.newPage()
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr')).toHaveCount(9)
  const dialog = await prepare(page)
  const original = await packingBackup(extension)
  expect(original.preparations).toHaveLength(1)
  await pauseAutosave(page)
  const order = dialog.getByLabel('Preparation order', { exact: true })
  const name = dialog
    .locator('.preparation-group')
    .first()
    .getByLabel('Spanish short name', { exact: true })
  const undo = dialog.getByRole('button', { name: 'Undo', exact: true })
  const redo = dialog.getByRole('button', { name: 'Redo', exact: true })
  await expect(order.locator('option')).toHaveCount(3)
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
  expect(unsaved.preparations).toEqual(original.preparations)
  expect(unsaved.issuedCodes).toEqual(original.issuedCodes)
  await page.clock.runFor(801)
  await waitForAutosave(dialog)
  await expect(
    dialog
      .locator('.preparation-group')
      .first()
      .getByLabel('Product code', { exact: true })
  ).toHaveValue(/^CE2610\d{4}$/)
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

test('autosave preserves focus and newer typing while an earlier database write completes', async ({
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
  await name.fill('GUARDADO SEGURO')
  const originalInput = await name.elementHandle()
  await expect
    .poll(() => page.evaluate(() => window.preparationSaveStarted))
    .toBe(true)
  await expect(dialog.locator('.preparation-save-status')).toHaveText('Saving…')
  await expect(name).toBeEnabled()
  await expect(name).toBeFocused()
  await page.keyboard.type(' ACTUALIZADO')
  await expect(name).toHaveValue('GUARDADO SEGURO ACTUALIZADO')
  await page.evaluate(() => {
    window.holdPreparationSave = false
  })
  await waitForAutosave(dialog)
  await expect(name).toBeEnabled()
  await expect(order).toBeEnabled()
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()
  await expect(name).toHaveValue('GUARDADO SEGURO ACTUALIZADO')
  await expect(name).toBeFocused()
  expect(await originalInput.evaluate((input) => input.isConnected)).toBe(true)
  await originalInput.dispose()
  const saved = await packingBackup(extension)
  expect(saved.preparations[0].revision).toBe(
    original.preparations[0].revision + 2
  )
  expect(saved.preparations[0].groups[0].spanishName).toBe(
    'GUARDADO SEGURO ACTUALIZADO'
  )
  expect(saved.issuedCodes).toEqual(original.issuedCodes)
  expect(saved.orders).toEqual(original.orders)
  expect(extension.unexpectedRequests).toEqual([])
})

for (const closeMethod of ['close button', 'dark background', 'Escape']) {
  test(`preparation ${closeMethod} preserves invalid edits and saves valid edits before closing`, async ({
    extension,
  }) => {
    const { page } = await openWorkspace(extension)
    const dialog = await prepare(page)
    const original = await packingBackup(extension)
    await pauseAutosave(page)
    const first = dialog.locator('.preparation-group').first()
    const code = first.getByLabel('Product code', { exact: true })
    const name = first.getByLabel('Spanish short name', { exact: true })
    async function close() {
      // Dismiss field help first so Escape exercises the dialog itself.
      await dialog
        .getByRole('heading', {
          name: 'Prepare products & labels',
          exact: true,
        })
        .click()
      await page.clock.runFor(151)
      if (closeMethod === 'close button')
        await dialog
          .getByRole('button', { name: 'Close preparation', exact: true })
          .click()
      else if (closeMethod === 'dark background') {
        const bounds = await dialog.boundingBox()
        await page.mouse.click(
          Math.max(2, bounds.x - 5),
          Math.max(2, bounds.y + 10)
        )
      } else await page.keyboard.press('Escape')
    }
    await name.fill('NOMBRE CONSERVADO')
    await code.fill('INVALID')
    await close()
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.preparation-save-status')).toContainText(
      'Not saved'
    )
    await expect(name).toHaveValue('NOMBRE CONSERVADO')
    await expect(code).toHaveValue('INVALID')
    expect((await packingBackup(extension)).preparations).toEqual(
      original.preparations
    )
    await code.fill(original.preparations[0].groups[0].baseCode)
    await close()
    await expect(dialog).not.toBeVisible()
    const saved = await packingBackup(extension)
    expect(saved.preparations[0].groups[0].spanishName).toBe(
      'NOMBRE CONSERVADO'
    )
    expect(saved.issuedCodes).toEqual(original.issuedCodes)
    expect(saved.orders).toEqual(original.orders)
    await page
      .getByRole('button', { name: 'Edit preparation', exact: true })
      .click()
    await expect(name).toHaveValue('NOMBRE CONSERVADO')
    expect(extension.unexpectedRequests).toEqual([])
  })
}

test('a conflicting autosave preserves the draft until saved-version recovery is confirmed', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  const dialog = await prepare(page)
  const original = await packingBackup(extension)
  await pauseAutosave(page)
  const name = dialog
    .locator('.preparation-group')
    .first()
    .getByLabel('Spanish short name', { exact: true })
  await name.fill('BORRADOR LOCAL')
  const otherPage = await extension.context.newPage()
  await otherPage.goto(`${extension.extensionBaseUrl}/library.html`)
  await otherPage
    .getByRole('button', { name: 'Edit preparation', exact: true })
    .click()
  const otherDialog = otherPage.getByRole('dialog', {
    name: 'Preparation',
    exact: true,
  })
  await otherDialog
    .locator('.preparation-group')
    .first()
    .getByLabel('Spanish short name', { exact: true })
    .fill('GUARDADO EN OTRA PESTANA')
  // The context clock also applies to new tabs. Closing flushes the second
  // tab's real write while the first tab retains its pending local draft.
  await otherDialog
    .getByRole('button', { name: 'Close preparation', exact: true })
    .click()
  await expect(otherDialog).not.toBeVisible()
  await page.clock.runFor(801)
  await expect(dialog.locator('.preparation-save-status')).toContainText(
    'Not saved'
  )
  await expect(name).toHaveValue('BORRADOR LOCAL')
  await dialog
    .getByRole('button', { name: 'Reload saved version', exact: true })
    .click()
  const confirmation = page.getByRole('dialog', {
    name: 'Confirm operation',
    exact: true,
  })
  await expect(confirmation).toContainText('unsaved')
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await expect(name).toHaveValue('BORRADOR LOCAL')
  await expect(dialog.locator('.preparation-save-status')).toContainText(
    'Not saved'
  )
  await dialog
    .getByRole('button', { name: 'Reload saved version', exact: true })
    .click()
  await confirmation
    .getByRole('button', { name: 'Reload 1 preparation', exact: true })
    .click()
  await expect(name).toHaveValue('GUARDADO EN OTRA PESTANA')
  await waitForAutosave(dialog)
  await expect(
    dialog.getByRole('button', { name: 'Undo', exact: true })
  ).toBeDisabled()
  await name.fill('CONTINUAR EDITANDO')
  await page.clock.runFor(801)
  await waitForAutosave(dialog)
  const saved = await packingBackup(extension)
  expect(saved.preparations[0].groups[0].spanishName).toBe('CONTINUAR EDITANDO')
  expect(saved.issuedCodes).toEqual(original.issuedCodes)
  expect(saved.orders).toEqual(original.orders)
  expect(extension.unexpectedRequests).toEqual([])
})

test('one invalid order does not prevent another edited order from saving automatically', async ({
  extension,
}) => {
  await seedStructuredOrder(extension)
  await seedStructuredOrder(extension, '900000000000000004')
  const page = await extension.context.newPage()
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr')).toHaveCount(6)
  const dialog = await prepare(page)
  const original = await packingBackup(extension)
  await pauseAutosave(page)
  const order = dialog.getByLabel('Preparation order', { exact: true })
  const first = dialog.locator('.preparation-group').first()
  await first.getByLabel('Product code', { exact: true }).fill('INVALID')
  await order.selectOption('1')
  await first
    .getByLabel('Spanish short name', { exact: true })
    .fill('PEDIDO VALIDO')
  await page.clock.runFor(801)
  await waitForAutosave(dialog)
  const saved = await packingBackup(extension)
  expect(saved.preparations).toHaveLength(2)
  expect(
    saved.preparations.find(
      (prep) => prep.orderId === original.preparations[0].orderId
    )
  ).toEqual(original.preparations[0])
  expect(
    saved.preparations.find(
      (prep) => prep.orderId !== original.preparations[0].orderId
    ).groups[0].spanishName
  ).toBe('PEDIDO VALIDO')
  await order.selectOption('0')
  await expect(first.getByLabel('Product code', { exact: true })).toHaveValue(
    'INVALID'
  )
  await page.clock.runFor(801)
  await expect(dialog.locator('.preparation-save-status')).toContainText(
    'Not saved'
  )
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
  const code = label.getByLabel('Barcode code', { exact: true })
  const variantCode = label.getByRole('textbox', {
    name: 'Variant code',
    exact: true,
  })
  const sizeCode = label.getByRole('textbox', {
    name: 'Size code',
    exact: true,
  })
  const spanish = label.getByRole('textbox', {
    name: 'Spanish product name',
    exact: true,
  })
  const copy = label.getByRole('button', { name: 'Copy label', exact: true })
  await expect(
    label.getByRole('heading', { name: 'Barcode label' })
  ).toBeVisible()
  await expect(code).toHaveText(`${baseCode}S`)
  await expect(variantCode).toHaveValue('')
  await expect(sizeCode).toHaveValue('S')
  await expect(spanish).toHaveValue('FRASCO DE VIDRIO')
  await expect(label.getByAltText('Printable label preview')).toBeVisible()
  await expect(copy).toBeEnabled({ timeout: 20_000 })

  await spanish.fill('frasco transparente')
  await spanish.press('Enter')
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  await expect(spanish).toHaveValue('FRASCO TRANSPARENTE')
  await variantCode.fill('a')
  await variantCode.press('Enter')
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  await expect(code).toHaveText(`${baseCode}AS`)
  await expect(variantCode).toHaveValue('A')
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
  await expect(code).toHaveText(`${baseCode}AS`)
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
  await expect(code).toHaveText(`${updatedBaseCode}AS`)
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

test('barcode image segments persist separately, reject collisions and leave source rows unchanged', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  const preparation = await prepare(page)
  const group = preparation.locator('.preparation-group').first()
  const baseCode = await group
    .getByLabel('Product code', { exact: true })
    .inputValue()
  const firstVariant = group.locator('.variants tbody tr').first()
  await firstVariant
    .getByRole('button', { name: 'Edit barcode', exact: true })
    .click()
  const label = page.getByRole('dialog', { name: 'Label editor', exact: true })
  const variant = label.getByRole('textbox', {
    name: 'Variant code',
    exact: true,
  })
  const size = label.getByRole('textbox', { name: 'Size code', exact: true })
  const copy = label.getByRole('button', { name: 'Copy label', exact: true })
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  const original = await packingBackup(extension)
  // Both fields live on the barcode image, and the shared base is not editable here.
  await expect(
    label
      .locator('.label-editor-preview')
      .getByLabel('Variant code', { exact: true })
  ).toBeVisible()
  await expect(
    label
      .locator('.label-editor-preview')
      .getByLabel('Size code', { exact: true })
  ).toBeVisible()
  await expect(
    label.getByRole('textbox', { name: 'Barcode code', exact: true })
  ).toHaveCount(0)
  await expect(label.locator('.label-code-base')).toHaveText(baseCode)
  await size.fill('L')
  await size.press('Enter')
  await expect(label.locator('.label-editor-status')).toContainText(
    /duplicate|already|conflict|unique/i
  )
  await expect(copy).toBeDisabled()
  expect((await packingBackup(extension)).preparations).toEqual(
    original.preparations
  )
  await size.press('Escape')
  await expect(size).toHaveValue('S')
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  await variant.fill('aa')
  await variant.press('Enter')
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  await size.fill('xs')
  await size.press('Enter')
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  await expect(label.getByLabel('Barcode code', { exact: true })).toHaveText(
    `${baseCode}AAXS`
  )
  const saved = await packingBackup(extension)
  expect(saved.preparations[0].groups[0].variants[0]).toMatchObject({
    variantSuffix: 'AA',
    sizeSuffix: 'XS',
    needsSizeMapping: false,
  })
  expect(saved.orders[0].snapshot).toEqual(record.snapshot)
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  await expect(
    firstVariant.getByRole('textbox', { name: /^Variant code / })
  ).toHaveValue('AA')
  await expect(
    firstVariant.getByRole('textbox', { name: /^Size code / })
  ).toHaveValue('XS')
  await firstVariant
    .getByRole('button', { name: 'Edit barcode', exact: true })
    .click()
  await expect(variant).toHaveValue('AA')
  await expect(size).toHaveValue('XS')
  await expect(label.getByLabel('Barcode code', { exact: true })).toHaveText(
    `${baseCode}AAXS`
  )
  expect(extension.unexpectedRequests).toEqual([])
})

async function savePreparationAndRead(extension, dialog) {
  await waitForAutosave(dialog)
  return packingBackup(extension)
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
  await first.locator('.variant-index').nth(0).click()
  await first
    .locator('.variant-index')
    .nth(1)
    .click({ modifiers: ['Control'] })
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
    await expect(label.getByLabel('Barcode code', { exact: true })).toHaveText(
      sharedBarcode
    )
    await label
      .getByRole('button', { name: 'Close label editor', exact: true })
      .click()
  }

  await page
    .getByRole('button', { name: 'Edit preparation', exact: true })
    .click()
  await first.locator('.variant-index').click()
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
  await first.locator('.variant-index').nth(0).click()
  await first
    .locator('.variant-index')
    .nth(1)
    .click({ modifiers: ['Control'] })
  await first
    .getByRole('button', { name: 'Share one barcode', exact: true })
    .click()
  await expect(first.locator('.variants tbody tr')).toHaveCount(1)
  backup = await savePreparationAndRead(extension, dialog)
  expect(backup.preparations[0].groups[0].variants[0].entryIds).toEqual(
    sourceIds.slice(0, 2)
  )
  await first.locator('.variant-index').click()
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

  await first.locator('.variant-index').nth(1).click()
  await first
    .getByRole('button', { name: 'Move to new product', exact: true })
    .click()
  await expect(groups).toHaveCount(3)
  backup = await savePreparationAndRead(extension, dialog)
  const splitCode = backup.preparations[0].groups[2].baseCode
  expect(splitCode).toMatch(/^CE2610\d{4}$/)
  expect(splitCode).not.toBe(originalCode)
  expect(backup.preparations[0].groups[2].variants[0].entryIds).toEqual([
    sourceIds[1],
  ])
  expect(backup.orders[0].snapshot).toEqual(record.snapshot)

  await groups.nth(0).locator('.group-select').click()
  await groups
    .nth(2)
    .locator('.group-select')
    .click({ modifiers: ['Control'] })
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

test('merging product groups across pages returns to a populated page without losing source rows or reserved codes', async ({
  extension,
}) => {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-paged-preparation'
  const template = record.snapshot.items[0]
  record.snapshot.items = Array.from({ length: 21 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0')
    return {
      ...template,
      entryId: `9700000000000000${number}`,
      title: `Synthetic product ${number}`,
      productNumber: `PAGED-${number}`,
      description: `Synthetic product ${number}\n货号：PAGED-${number}`,
      price: '1.00',
      quantity: '1',
      sourceDiscount: '0.00',
      allocatedDiscount: '0.00',
      discount: '0.00',
    }
  })
  record.snapshot.totals = {
    goodsGross: '21.00',
    shipping: '0.00',
    sourceDiscount: '0.00',
    orderAdjustment: '0.00',
    goodsNet: '21.00',
    payable: '21.00',
  }
  record.changedEntryIds = []
  const restored = await extension.inspector.evaluate(
    (order) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders: [order],
          history: [],
          images: [],
        },
      }),
    record
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await page.getByLabel('Packing month', { exact: true }).fill('2026-10')
  await page
    .getByRole('button', { name: 'Prepare labels', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Preparation', exact: true })
  const groups = dialog.locator('.preparation-group')
  await expect(groups).toHaveCount(20)
  await waitForAutosave(dialog)
  const before = await packingBackup(extension)
  const first = before.preparations[0].groups[0]
  const last = before.preparations[0].groups[20]
  await groups.first().locator('.group-select').click()
  await dialog.getByRole('button', { name: 'Next groups', exact: true }).click()
  await expect(groups).toHaveCount(1)
  await groups
    .first()
    .locator('.group-select')
    .click({ modifiers: ['Control'] })
  await dialog
    .getByRole('button', { name: 'Merge products', exact: true })
    .click()
  await expect(groups).toHaveCount(20)
  await expect(
    dialog.getByRole('button', { name: 'Previous groups', exact: true })
  ).toHaveCount(0)
  await expect(
    dialog.getByRole('button', { name: 'Next groups', exact: true })
  ).toHaveCount(0)
  await expect(groups.first().locator('.group-select')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(groups.first().locator('.variants tbody tr')).toHaveCount(2)
  const after = await savePreparationAndRead(extension, dialog)
  expect(after.preparations[0].groups).toHaveLength(20)
  expect(after.preparations[0].groups[0].id).toBe(first.id)
  expect(after.preparations[0].groups[0].baseCode).toBe(first.baseCode)
  expect(
    after.preparations[0].groups
      .flatMap((group) => group.variants.flatMap((variant) => variant.entryIds))
      .sort()
  ).toEqual(record.snapshot.items.map((item) => item.entryId).sort())
  expect(after.orders[0].snapshot).toEqual(record.snapshot)
  expect(
    after.issuedCodes.some(
      (issued) => issued.kind === 'base' && issued.code === last.baseCode
    )
  ).toBe(true)
  await groups.nth(1).locator('.group-select').click()
  await expect(groups.locator('.group-select[aria-pressed=true]')).toHaveCount(
    1
  )
  await expect(groups.first().locator('.group-select')).toHaveAttribute(
    'aria-pressed',
    'false'
  )
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

test('invalid preparation blocks batch labels and a corrected pending edit saves before confirmation', async ({
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
  const base = dialog
    .locator('.preparation-group')
    .first()
    .getByLabel('Product code', { exact: true })
  await base.fill('INVALID')
  for (const name of ['Copy barcode images', 'Copy carton marks']) {
    await dialog.getByRole('button', { name, exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Base code')
    await expect(dialog.locator('.preparation-save-status')).toContainText(
      'Not saved'
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

  await base.fill(original.preparations[0].groups[0].baseCode)
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
  const saved = await packingBackup(extension)
  expect(saved.preparations[0].groups[0].spanishName).toBe('NOMBRE PENDIENTE')
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
  await page.locator('#sheet-body tr').nth(0).locator('td').first().click()
  await page
    .locator('#sheet-body tr')
    .nth(1)
    .locator('td')
    .first()
    .click({ modifiers: ['Shift'] })
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
