import {
  copyCurrentImageBatch,
  revealCopyActions,
} from './copy-actions-helpers.mjs'
import { test, expect, holdPreparationWrites } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { readFile } from 'node:fs/promises'
import {
  assignSelectedPurchaseCodes,
  editOrderProduct,
  closeOrderProduct,
  libraryBackup as packingBackup,
  seedSmartOrder,
  openSmartLibrary,
  openOrderReconciliation,
  productGridRow,
  realOrderContext,
  createContainerThroughUI,
  sealContainerThroughUI,
  shareOrderBarcode,
} from './smart-workspace-helpers.mjs'

async function seedStructuredOrder(
  extension,
  orderId,
  { singleProduct = false, manyPhotos = false, tags = [] } = {}
) {
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
  record.tags = tags
  if (singleProduct) record.snapshot.items = record.snapshot.items.slice(0, 1)
  else if (manyPhotos) {
    const originals = records.flatMap((entry) => entry.snapshot.items)
    const gallery = [...originals.slice(1), originals[0]]
    record.snapshot.items = [
      {
        ...structuredClone(gallery[0]),
        entryId: `${orderId}90`,
        thumbnail: '',
      },
      gallery[0],
      { ...structuredClone(gallery[0]), entryId: `${orderId}91` },
      ...gallery.slice(1),
    ]
  }
  if (singleProduct || manyPhotos) {
    const gross = record.snapshot.items.reduce(
      (sum, item) =>
        sum + Math.round(Number(item.price) * 100) * Number(item.quantity),
      0
    )
    const discount = record.snapshot.items.reduce(
      (sum, item) => sum + Math.round(Number(item.sourceDiscount) * 100),
      0
    )
    record.snapshot.totals = {
      goodsGross: (gross / 100).toFixed(2),
      shipping: '0.00',
      sourceDiscount: (discount / 100).toFixed(2),
      orderAdjustment: '0.00',
      goodsNet: ((gross - discount) / 100).toFixed(2),
      payable: ((gross - discount) / 100).toFixed(2),
    }
  }
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

async function openWorkspace(extension) {
  const record = await seedStructuredOrder(extension)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  return { page, record }
}
async function assignAll(page) {
  await page.locator('#select-rows').click()
  await assignSelectedPurchaseCodes(page)
}
const editor = (page) =>
  page.locator('dialog[data-action="edit-order-product"]')
const rows = (page) => page.locator('#sheet-body tr[data-selection-key]')
function sourceRowCodes(preparation, items) {
  return items.map(({ entryId }) => {
    const group = preparation.groups.find((group) =>
      group.variants.some((variant) => variant.entryIds.includes(entryId))
    )
    const variant = group.variants.find((variant) =>
      variant.entryIds.includes(entryId)
    )
    return `${group.baseCode}${variant.variantSuffix}${variant.sizeSuffix}`
  })
}

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

test('label editor saves repeated text edits and copies barcode and carton images at print resolution', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  await page.evaluate(() => {
    window.revokedLabelUrls = []
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (url) => {
      window.revokedLabelUrls.push(url)
      return revoke(url)
    }
  })
  await assignAll(page)
  const baseCode = (await packingBackup(extension)).preparations[0].groups[0]
    .baseCode
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])

  const firstRow = page.locator('#sheet-body tr[data-selection-key]').first()
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
  await expect(code.locator('[data-code-part="product"]')).toHaveText(
    baseCode.slice(6, 10)
  )
  await expect(variantCode).toHaveValue('')
  await expect(sizeCode).toHaveValue('S')
  await expect(spanish).toHaveValue('FRASCO')
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
  const livePreviewUrl = await label
    .getByAltText('Printable label preview')
    .getAttribute('src')
  expect(livePreviewUrl).toMatch(/^blob:/)
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  await expect
    .poll(() =>
      page.evaluate(
        (url) => window.revokedLabelUrls.includes(url),
        livePreviewUrl
      )
    )
    .toBe(true)

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
  await expect(page.locator('.row-code-copy')).toHaveText(
    sourceRowCodes(
      (await packingBackup(extension)).preparations[0],
      record.snapshot.items
    )
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

test('Copy Excel image freezes selected rows with current-language headings, supplier fields and prepared values', async ({
  extension,
}, testInfo) => {
  const { page, record } = await openWorkspace(extension, { previews: false })
  await assignAll(page)
  const base = (await packingBackup(extension)).preparations[0].groups[0]
    .baseCode
  for (const index of [0, 1])
    await closeOrderProduct(
      await editOrderProduct(page, index, {
        'Spanish name': 'FRASCO DE PRUEBA',
        'Chinese category': '玻璃制品',
      })
    )
  const original = await packingBackup(extension)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await page.locator('#clear-rows').click()
  await rows.nth(0).getByRole('checkbox').check()
  await rows.nth(1).getByRole('checkbox').check()
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.evaluate(async () => {
    await navigator.clipboard.writeText('clipboard-before-image')
    globalThis.tableImageDrawing = { text: [], runs: [], badges: [], images: 0 }
    const fillText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (this.canvas.width > 2000) {
        const bounds = this.measureText(text)
        globalThis.tableImageDrawing.text.push(String(text))
        globalThis.tableImageDrawing.runs.push({
          text: String(text),
          x: args[0],
          y: args[1],
          font: this.font,
          color: this.fillStyle,
          width: bounds.width,
          ascent: bounds.actualBoundingBoxAscent,
          descent: bounds.actualBoundingBoxDescent,
        })
      }
      return fillText.call(this, text, ...args)
    }
    const roundRect = CanvasRenderingContext2D.prototype.roundRect
    CanvasRenderingContext2D.prototype.roundRect = function (
      x,
      y,
      width,
      height,
      radius
    ) {
      if (this.canvas.width > 2000)
        globalThis.tableImageDrawing.badges.push({
          x,
          y,
          width,
          height,
          radius,
          color: this.fillStyle,
        })
      return roundRect.call(this, x, y, width, height, radius)
    }
    const drawImage = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.width > 2000) globalThis.tableImageDrawing.images++
      return drawImage.apply(this, args)
    }
    // Keep the actual canvas encoder pending while the visible filter changes.
    // The eventual PNG still passes through the real encoder and clipboard.
    const encode = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      if (this.width > 2000)
        window.finishTableImage = () => encode.apply(this, args)
      else return encode.apply(this, args)
    }
  })
  const copy = page.locator('#copy-excel-image')
  await copy.click()
  const confirmation = page.getByRole('dialog', {
    name: 'Confirm operation',
    exact: true,
  })
  await expect(confirmation).not.toBeVisible()
  await expect
    .poll(() => page.evaluate(() => Boolean(window.finishTableImage)))
    .toBe(true)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'clipboard-before-image'
  )
  // A later filter update must not change the frozen selected rows.
  await page.evaluate(() => {
    const search = document.getElementById('search')
    search.value = 'TEST-BOX'
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.evaluate(() => window.finishTableImage())
  await copyCurrentImageBatch(page)
  await expect(copy).toHaveText('Copied')
  await expect(copy).toHaveClass(/copied/)
  await expect(page.locator('#feedback')).toBeEmpty()
  const drawing = await page.evaluate(() => tableImageDrawing)
  const headings = drawing.text.slice(0, drawing.text.indexOf('1')).join(' ')
  expect(headings).toBe(
    'No. Photo Product description Carton mark Barcode code Category & material Price (元) Quantity Carton dimensions Weight (kg) Carton no.'
  )
  // Codes, including their endings, draw as one centered badge per variant.
  // The merged carton artwork has no redundant text caption beneath it.
  expect(drawing.text).not.toContain(base)
  const codeRuns = drawing.runs.filter((run) => /^CE\d/.test(run.text)),
    badges = drawing.badges.filter((badge) =>
      /^#(?:000|000000)$/i.test(badge.color)
    )
  expect(codeRuns.map((run) => run.text)).toEqual([`${base}S`, `${base}L`])
  expect(badges).toHaveLength(2)
  for (const [index, run] of codeRuns.entries()) {
    const badge = badges[index]
    expect(run.font).toMatch(/^(?:700|bold) (?:1[2-7])px /)
    expect(run.color).toMatch(/^#(?:fff|ffffff)$/i)
    expect(badge.radius).toBeGreaterThan(0)
    expect(run.x).toBeGreaterThan(badge.x)
    expect(run.x + run.width).toBeLessThan(badge.x + badge.width)
    expect(run.y - run.ascent).toBeGreaterThan(badge.y)
    expect(run.y + run.descent).toBeLessThan(badge.y + badge.height)
    expect(run.x + run.width / 2).toBeCloseTo(badge.x + badge.width / 2, 5)
    expect(run.y + (run.descent - run.ascent) / 2).toBeCloseTo(
      badge.y + badge.height / 2,
      5
    )
  }
  expect(codeRuns[0].y).toBeLessThan(codeRuns[1].y)
  expect(drawing.text).not.toContain('西班牙语品名')
  expect(drawing.text).not.toContain('优惠（元）')
  expect(drawing.text).not.toContain('FRASCO DE PRUEBA')
  expect(drawing.text).toContain('玻璃制品')
  expect(drawing.text.join('')).toContain('300 ml')
  expect(drawing.text.join('')).toContain('500 ml')
  expect(
    drawing.runs.some(
      (run) => run.text === 'Glass' && /^(?:700|bold) /.test(run.font)
    )
  ).toBe(true)
  expect(drawing.text.join('')).not.toContain('TEST-BOX')
  for (const item of record.snapshot.items.slice(0, 2)) {
    expect(drawing.text).toContain(`${item.price} 元`)
    expect(drawing.text).toContain(item.quantity)
    expect(drawing.runs.find((run) => run.text === item.quantity).font).toMatch(
      /^(?:700|bold) /
    )
  }
  // Two product photos plus one actual carton mark shared by both variants.
  expect(drawing.images).toBe(3)
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
  await testInfo.attach(
    'Selected rows with English headings and supplier fields',
    {
      body: Buffer.from(image.bytes),
      contentType: 'image/png',
    }
  )
  expect((await packingBackup(extension)).preparations).toEqual(
    original.preparations
  )
  expect(extension.unexpectedRequests).toEqual([])
})

test('full assigned variant codes reach source rows, clipboard and every original-photo entry point without data writes', async ({
  extension,
}) => {
  test.setTimeout(60000)
  const { page, record } = await openWorkspace(extension)
  const viewer = page.getByRole('dialog', {
    name: 'Product photo',
    exact: true,
  })
  await rows(page).first().locator('.product-photo-button').click()
  await expect(viewer.locator('.photo-viewer-code')).toHaveCount(0)
  await viewer
    .getByRole('button', { name: 'Close product photo', exact: true })
    .click()
  await assignAll(page)
  for (const [index, values] of [
    { 'Variant ending': 'A', 'Size ending': '' },
    { 'Variant ending': '', 'Size ending': 'L' },
  ].entries())
    await closeOrderProduct(await editOrderProduct(page, index, values))
  const before = await packingBackup(extension),
    [group, other] = before.preparations[0].groups,
    base = group.baseCode
  await expect(page.locator('.row-code-copy')).toHaveText([
    `${base}A`,
    `${base}L`,
    other.baseCode,
  ])
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.locator('.row-code-copy').first().click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(`${base}A`)
  const expectCode = async (expected) => {
    const code = viewer.locator('.photo-viewer-code')
    await expect(code).toHaveText(expected)
    await expect(code).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    await expect(code).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect(code).toHaveCSS('font-weight', '700')
    await expect(code).toHaveCSS('font-size', '22px')
    await expect(code.locator('[data-code-part="product"]')).toHaveText(
      base.slice(6, 10)
    )
    await expect(code.locator('[data-code-part="prefix-period"]')).toHaveText(
      'CE2610'
    )
    await expect(viewer.locator('.photo-viewer-product-context')).toContainText(
      record.snapshot.sellerName
    )
  }
  await rows(page).first().locator('.product-photo-button').click()
  await expectCode(`${base}A`)
  await viewer.getByRole('button', { name: 'Edit photo', exact: true }).click()
  await expectCode(`${base}A`)
  await viewer.getByRole('button', { name: 'Cancel', exact: true }).click()
  await viewer.getByRole('button', { name: 'Next photo', exact: true }).click()
  await expectCode(`${base}L`)
  await viewer
    .getByRole('button', { name: 'Close product photo', exact: true })
    .click()
  await rows(page).first().focus()
  await page.keyboard.press('Enter')
  const details = page.getByRole('dialog', {
    name: 'Original product details',
    exact: true,
  })
  await details
    .getByRole('button', { name: 'Open product photo', exact: true })
    .click()
  await expectCode(`${base}A`)
  await viewer
    .getByRole('button', { name: 'Close product photo', exact: true })
    .click()
  await details
    .getByRole('button', { name: 'Close product details', exact: true })
    .click()
  expect((await packingBackup(extension)).preparations).toEqual(
    before.preparations
  )
  await closeOrderProduct(
    await editOrderProduct(page, 0, { 'Size ending': 'L' })
  )
  await page.reload()
  await expect(page.locator('.row-code-copy')).toHaveText([
    `${base}AL`,
    `${base}L`,
    other.baseCode,
  ])
  expect((await packingBackup(extension)).orders[0].snapshot).toEqual(
    record.snapshot
  )
})

test('editable empty endings and distinct saved product summaries survive EN/ES/Chinese and narrow layouts', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await assignAll(page)
  const firstName = 'FRASCOS DE VIDRIO PARA ALMACENAMIENTO'
  for (const index of [0, 1])
    await closeOrderProduct(
      await editOrderProduct(page, index, { 'Spanish name': firstName })
    )
  await closeOrderProduct(
    await editOrderProduct(page, 2, { 'Spanish name': 'CAJAS' })
  )
  const view = await editOrderProduct(page, 0),
    ending = view.getByRole('textbox', { name: 'Variant ending', exact: true })
  await ending.fill('A')
  await expect(ending).toBeFocused()
  await ending.fill('')
  await expect(ending).toBeFocused()
  await closeOrderProduct(view)
  const summary = page.locator('.order-card .order-name-summary')
  await expect(summary.locator('.order-name-label')).toHaveText(firstName)
  await expect(summary.locator('.order-name-count')).toHaveText('+1')
  const layout = await summary.evaluate((node) => {
    const card = node.closest('.order-card'),
      name = node.getBoundingClientRect(),
      count = card.querySelector('.order-products').getBoundingClientRect(),
      heading = card
        .querySelector('.order-card-identity')
        .getBoundingClientRect(),
      reference = card
        .querySelector('.order-card-reference')
        .getBoundingClientRect(),
      meta = card.querySelector('.order-card-meta').getBoundingClientRect()
    return {
      parent: node.parentElement.className,
      right: count.left >= name.right,
      aligned: Math.abs(
        count.top + count.height / 2 - name.top - name.height / 2
      ),
      below: name.top >= heading.bottom,
      gap: reference.top - heading.bottom,
      badge: meta.top - reference.bottom,
    }
  })
  expect(layout).toMatchObject({
    parent: 'order-card-products',
    right: true,
    below: true,
  })
  expect(layout.aligned).toBeLessThanOrEqual(1)
  expect(layout.gap).toBeLessThanOrEqual(1)
  expect(layout.badge).toBeGreaterThanOrEqual(7)
  await summary.hover()
  await expect(page.getByRole('tooltip')).toContainText(`${firstName} · CAJAS`)
  await page.mouse.move(0, 0)
  await summary.focus()
  await expect(page.getByRole('tooltip')).toContainText(`${firstName} · CAJAS`)
  await page.locator('#language-toggle [data-language="es"]').click()
  await expect(summary.locator('.order-name-label')).toHaveText(firstName)
  await page.locator('#language-toggle [data-language="zh"]').click()
  await expect(summary).toHaveCount(0)
  await page.locator('#language-toggle [data-language="en"]').click()
  await page.setViewportSize({ width: 760, height: 900 })
  await expect(summary.locator('.order-name-count')).toBeVisible()
})

test('Orders code and grouping controls retain explicit selection and contextual accessible help', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await assignAll(page)
  await page.locator('#clear-rows').click()
  await rows(page).first().getByRole('checkbox').check()
  const view = await editOrderProduct(page, 0)
  for (const name of ['Product code', 'Variant ending', 'Size ending']) {
    const input = view.getByRole('textbox', { name, exact: true })
    await expect(input).toBeEditable()
    await input.focus()
    await expect(input).toHaveAccessibleName(name)
  }
  await closeOrderProduct(view)
  await expect(
    rows(page).locator('input[type="checkbox"]:checked')
  ).toHaveCount(1)
  await page.locator('#group-order-products').click()
  const tools = page.locator('.orders-grouping-dialog')
  await expect(
    tools.getByRole('button', { name: 'Move to new product', exact: true })
  ).toBeEnabled()
  await expect(
    page.locator('#packing-view .packing-grouping-panel')
  ).toHaveCount(0)
  await tools.getByRole('button', { name: 'Close', exact: true }).click()
})

test('container inclusion shows full source identities and whole orders without converting product checkboxes into membership', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  await assignAll(page)
  await page.locator('#clear-rows').click()
  await rows(page).first().getByRole('checkbox').check()
  const before = await packingBackup(extension)
  const id = await createContainerThroughUI(page, [
    { accountId: 'local', orderId: record.snapshot.orderId },
  ])
  const included = await extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerView({ id }),
    id
  )
  expect(included.orders.map((order) => order.orderId)).toEqual([
    record.snapshot.orderId,
  ])
  await expect(page.locator('.container-order')).toContainText(
    record.snapshot.orderId
  )
  await expect(page.locator('.container-order')).toContainText(
    record.snapshot.sellerName
  )
  expect((await packingBackup(extension)).orders).toEqual(before.orders)
  expect((await packingBackup(extension)).preparations).toEqual(
    before.preparations
  )
})

test('a row edit saves only its source product and copies its latest values without preparation membership', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  await assignAll(page)
  const before = await packingBackup(extension)
  await closeOrderProduct(
    await editOrderProduct(page, 2, { 'Spanish name': 'CAJA EDITADA' })
  )
  const after = await packingBackup(extension)
  expect(after.preparations[0].groups[0]).toEqual(
    before.preparations[0].groups[0]
  )
  expect(after.preparations[0].groups[1].variants[0].spanishName).toBe(
    'CAJA EDITADA'
  )
  await page.locator('#clear-rows').click()
  await rows(page).nth(2).getByRole('checkbox').check()
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await revealCopyActions(page)
  await page.locator('#copy-preparation').click()
  const columns = page.locator('.preparation-column-dialog')
  await columns
    .getByRole('button', { name: 'Copy chosen columns', exact: true })
    .click()
  await expect(
    columns.getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible()
  const value = await page.evaluate(() => navigator.clipboard.readText())
  expect(value).toContain('CAJA EDITADA')
  expect(value.split('\r\n')).toHaveLength(1)
  expect((await packingBackup(extension)).orders[0].snapshot).toEqual(
    record.snapshot
  )
  await expect(
    page.getByRole('dialog', { name: 'Confirm operation', exact: true })
  ).toHaveCount(0)
})

test('one sticky Orders selection toolbar remains reachable and grouping never mixes physical purchase ownership', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await assignAll(page)
  await page.setViewportSize({ width: 390, height: 780 })
  await page.locator('#clear-rows').click()
  await rows(page).first().getByRole('checkbox').check()
  await rows(page).nth(1).getByRole('checkbox').check()
  await expect(page.locator('#selection-summary')).toContainText('2 selected')
  await expect(page.locator('#group-order-products')).toBeInViewport()
  const before = await packingBackup(extension)
  await shareOrderBarcode(page)
  const grouped = await packingBackup(extension)
  expect(grouped.preparations[0].groups[0].variants[0].entryIds).toHaveLength(2)
  expect(grouped.orders).toEqual(before.orders)
  await expect(page.locator('#review-purchase-codes')).toBeInViewport()
  await expect(
    page.locator('#prepare-orders,.packing-grouping-panel')
  ).toHaveCount(0)
})

test('exact source price, quantity and discount clipboard rows remain headerless and independent from authored preparation', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  await assignAll(page)
  await closeOrderProduct(
    await editOrderProduct(page, 0, {
      'Spanish name': 'frasco transparente',
      'Chinese category': '玻璃制品',
      'Variant ending': 'b',
      'Size ending': 'xs',
    })
  )
  const saved = await packingBackup(extension),
    [group, other] = saved.preparations[0].groups
  await expect(page.locator('.row-code-copy')).toHaveText(
    sourceRowCodes(saved.preparations[0], record.snapshot.items)
  )
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await revealCopyActions(page)
  await page.locator('#copy-values').click()
  await expect(page.locator('#copy-values')).toHaveText('Copied')
  const values = await page.evaluate(() => navigator.clipboard.readText()),
    source = values.split('\r\n').map((row) => row.split('\t'))
  expect(source).toHaveLength(3)
  for (const [index, row] of source.entries()) {
    expect(row).toHaveLength(5)
    expect(row[0]).toBe('')
    expect(row[1]).toContain(record.snapshot.items[index].title)
    expect(row.slice(2)).toEqual(
      ['price', 'quantity', 'discount'].map(
        (key) => record.snapshot.items[index][key]
      )
    )
  }
  expect(values).not.toContain('Photo')
  await revealCopyActions(page)
  await page.locator('#copy-preparation').click()
  const columns = page.locator('.preparation-column-dialog')
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
  expect(prepared.map((row) => row[0])).toEqual([
    group.baseCode,
    '',
    other.baseCode,
  ])
  expect(prepared[0][1]).toBe(`${group.baseCode}BXS`)
  expect(prepared[0][3]).toBe('FRASCO TRANSPARENTE')
  await columns.getByRole('button', { name: 'Close', exact: true }).click()
  await page.reload()
  const view = await editOrderProduct(page, 0)
  for (const [name, value] of Object.entries({
    'Spanish name': 'FRASCO TRANSPARENTE',
    'Chinese category': '玻璃制品',
    'Variant ending': 'B',
    'Size ending': 'XS',
  }))
    await expect(view.getByRole('textbox', { name, exact: true })).toHaveValue(
      value
    )
  expect((await packingBackup(extension)).orders[0].snapshot).toEqual(
    record.snapshot
  )
  expect(extension.unexpectedRequests).toEqual([])
})

test('missing selected carton category blocks Excel images and leaves the real clipboard untouched', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await assignAll(page)
  await closeOrderProduct(
    await editOrderProduct(page, 0, { 'Chinese category': '' })
  )
  await page.locator('#clear-rows').click()
  await rows(page).first().getByRole('checkbox').check()
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.evaluate(() =>
    navigator.clipboard.writeText('keep-unfinished-category')
  )
  await page.locator('#copy-excel-image').click()
  const images = page.locator('.image-copy-dialog')
  await expect(images.getByRole('alert')).toContainText('Chinese category')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'keep-unfinished-category'
  )
  await images.getByRole('button', { name: 'Done', exact: true }).click()
})

test('purchase code dates ignore device timezone and retain independent persistent purchase filters', async ({
  extension,
}) => {
  await seedStructuredOrder(extension)
  const page = await extension.context.newPage(),
    cdp = await extension.context.newCDPSession(page)
  await cdp.send('Emulation.setTimezoneOverride', {
    timezoneId: 'Asia/Shanghai',
  })
  await page.clock.setFixedTime(new Date('2026-12-31T16:30:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#month-filter-label')).toHaveText('January 2027')
  await expect(rows(page)).toHaveCount(0)
  await page.locator('#month-options [data-month="2027-01"]').click()
  await page.locator('#month-options [data-month="2026-10"]').click()
  await expect(rows(page)).toHaveCount(3)
  await assignAll(page)
  const before = await packingBackup(extension)
  expect(
    before.preparations[0].groups.every((group) =>
      group.baseCode.startsWith('CE2610')
    )
  ).toBe(true)
  await page.locator('#search').fill('TEST-JAR')
  await expect(rows(page)).toHaveCount(2)
  await page.locator('#search').fill('')
  await page.reload()
  await expect(page.locator('#month-filter-label')).toHaveText('October 2026')
  await expect(rows(page)).toHaveCount(3)
  expect((await packingBackup(extension)).preparations).toEqual(
    before.preparations
  )
  await expect(
    page.locator('#packing-month,[data-action="packing-month"]')
  ).toHaveCount(0)
  await cdp.detach()
})

test('Orders photos copy original pixels without changing selection and zoom/fitting retains the source image', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  await assignAll(page)
  await page.locator('#clear-rows').click()
  await rows(page).nth(1).getByRole('checkbox').check()
  const before = await packingBackup(extension)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  const tile = rows(page).first().locator('.photo-copy-tile'),
    button = tile.locator('.photo-copy-button')
  await tile.hover()
  const frame = await tile.locator('.photo-copy-source').boundingBox(),
    copy = await button.boundingBox()
  expect(Math.abs(frame.width - frame.height)).toBeLessThanOrEqual(1)
  expect(copy.width).toBe(24)
  expect(copy.height).toBe(24)
  expect(copy.y - frame.y).toBeCloseTo(2, 0)
  expect(frame.x + frame.width - copy.x - copy.width).toBeCloseTo(2, 0)
  await button.click()
  await expect(button).toHaveClass(/copied/)
  expect(
    await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read(),
        image = await createImageBitmap(await item.getType('image/png'))
      const size = [image.width, image.height]
      image.close()
      return size
    })
  ).toEqual([96, 96])
  await expect(rows(page).nth(1).getByRole('checkbox')).toBeChecked()
  await expect(rows(page).first().getByRole('checkbox')).not.toBeChecked()
  await rows(page).first().locator('.product-photo-button').click()
  const photo = page.getByRole('dialog', {
      name: 'Product photo',
      exact: true,
    }),
    original = photo.locator('.photo-viewport img')
  await expect(original).toHaveAttribute(
    'src',
    record.snapshot.items[0].thumbnail
  )
  await expect(original).toHaveJSProperty('naturalWidth', 96)
  await expect(photo.locator('.photo-zoom-actions')).toContainText('100%')
  await expect(
    photo.getByRole('button', { name: 'Zoom out', exact: true })
  ).toBeDisabled()
  const width = await original.evaluate(
    (image) => image.getBoundingClientRect().width
  )
  await photo.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(photo.locator('.photo-zoom-actions')).toContainText('150%')
  expect(
    await original.evaluate((image) => image.getBoundingClientRect().width)
  ).toBeCloseTo(width * 1.5)
  await photo.getByRole('button', { name: 'Fit', exact: true }).click()
  await expect(photo.locator('.photo-zoom-actions')).toContainText('100%')
  await page.keyboard.press('Escape')
  await expect(photo).not.toBeVisible()
  expect((await packingBackup(extension)).preparations).toEqual(
    before.preparations
  )
  expect((await packingBackup(extension)).orders).toEqual(before.orders)
})

test('empty Spanish names block barcode generation until corrected while source text remains untouched', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  await assignAll(page)
  await closeOrderProduct(
    await editOrderProduct(page, 0, { 'Spanish name': '' })
  )
  await page.locator('#clear-rows').click()
  await rows(page).first().getByRole('checkbox').check()
  await revealCopyActions(page)
  await page
    .getByRole('button', { name: 'Copy barcode images', exact: true })
    .click()
  await expect(page.locator('.error-notice:visible')).toContainText(
    /Spanish name/i
  )
  await expect(page.locator('.image-copy-dialog')).toHaveCount(0)
  await closeOrderProduct(
    await editOrderProduct(page, 0, { 'Spanish name': 'CORRECTED NAME' })
  )
  await revealCopyActions(page)
  await page
    .getByRole('button', { name: 'Copy barcode images', exact: true })
    .click()
  await expect(
    page.locator('.image-copy-dialog .copy-preview img')
  ).toHaveCount(1)
  expect((await packingBackup(extension)).orders[0].snapshot).toEqual(
    record.snapshot
  )
})

test('range selection and nested code/text controls never alter unrelated source-row selection', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await assignAll(page)
  await page.locator('#clear-rows').click()
  await rows(page).first().getByRole('checkbox').check()
  await rows(page)
    .nth(2)
    .getByRole('checkbox')
    .click({ modifiers: ['Shift'] })
  await expect(
    rows(page).locator('input[type="checkbox"]:checked')
  ).toHaveCount(3)
  const before = await packingBackup(extension)
  const view = await editOrderProduct(page, 0)
  const code = view.getByRole('textbox', { name: 'Product code', exact: true })
  await code.dblclick()
  await code.press('Control+a')
  expect(
    await code.evaluate((node) => node.selectionEnd - node.selectionStart)
  ).toBe(10)
  await closeOrderProduct(view)
  await expect(
    rows(page).locator('input[type="checkbox"]:checked')
  ).toHaveCount(3)
  expect((await packingBackup(extension)).preparations).toEqual(
    before.preparations
  )
  await rows(page).nth(1).getByRole('checkbox').uncheck()
  await expect(
    rows(page).locator('input[type="checkbox"]:checked')
  ).toHaveCount(2)
})

test('Orders Undo/Redo retains both saved typing and confirmed regrouping', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await assignAll(page)
  const before = await packingBackup(extension)
  await closeOrderProduct(
    await editOrderProduct(page, 0, { 'Spanish name': 'NAME BEFORE GROUPING' })
  )
  await shareOrderBarcode(page)
  const grouped = await packingBackup(extension)
  await editOrderProduct(page, 0)
  const travel = async (name) => {
    await editor(page).getByRole('button', { name, exact: true }).click()
    await expect(editor(page)).toBeVisible()
  }
  await travel('Undo')
  expect(
    (await packingBackup(extension)).preparations[0].groups[0].variants
  ).toHaveLength(2)
  expect(
    (await packingBackup(extension)).preparations[0].groups[0].variants[0]
      .spanishName
  ).toBe('NAME BEFORE GROUPING')
  await travel('Undo')
  expect((await packingBackup(extension)).preparations[0].groups).toEqual(
    before.preparations[0].groups
  )
  await travel('Redo')
  await travel('Redo')
  expect((await packingBackup(extension)).preparations[0].groups).toEqual(
    grouped.preparations[0].groups
  )
})

test('pending database completion preserves focus and newer Orders typing before navigation', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await assignAll(page)
  const view = await editOrderProduct(page, 0),
    input = view.getByRole('textbox', { name: 'Spanish name', exact: true })
  await holdPreparationWrites(page)
  try {
    await input.fill('EARLIER SUBMISSION')
    await expect
      .poll(() => page.evaluate(() => window.preparationSaveStarted))
      .toBe(true)
    await input.fill('LATEST TYPING')
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('LATEST TYPING')
    await page.evaluate(() => {
      window.holdPreparationSave = false
    })
    await expect
      .poll(
        async () =>
          (await packingBackup(extension)).preparations[0].groups[0].variants[0]
            .spanishName
      )
      .toBe('LATEST TYPING')
    await expect(input).toBeFocused()
    await closeOrderProduct(view)
    await page.locator('#view-packing').click()
    await page.locator('#view-orders').click()
    await expect(rows(page)).toHaveCount(3)
    await expect(
      (await editOrderProduct(page, 0)).getByRole('textbox', {
        name: 'Spanish name',
        exact: true,
      })
    ).toHaveValue('LATEST TYPING')
  } finally {
    await page.evaluate(() => {
      window.holdPreparationSave = false
    })
  }
})

test('invalid Orders drafts survive close attempts and reload without overwriting saved product or source values', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await assignAll(page)
  const before = await packingBackup(extension),
    view = await editOrderProduct(page, 0, {
      'Spanish name': 'RECOVER RAW NAME',
      'Product code': 'INVALID',
    })
  await view.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(view).toBeVisible()
  await expect(
    view.getByRole('textbox', { name: 'Product code', exact: true })
  ).toHaveValue('INVALID')
  expect((await packingBackup(extension)).preparations).toEqual(
    before.preparations
  )
  await page.reload()
  const recovered = await editOrderProduct(page, 0)
  await expect(
    recovered.getByRole('textbox', { name: 'Product code', exact: true })
  ).toHaveValue('INVALID')
  await expect(
    recovered.getByRole('textbox', { name: 'Spanish name', exact: true })
  ).toHaveValue('RECOVER RAW NAME')
  expect((await packingBackup(extension)).preparations).toEqual(
    before.preparations
  )
  await recovered
    .getByRole('textbox', { name: 'Product code', exact: true })
    .fill(before.preparations[0].groups[0].baseCode)
  await closeOrderProduct(recovered)
  expect(
    (await packingBackup(extension)).preparations[0].groups[0].variants[0]
      .spanishName
  ).toBe('RECOVER RAW NAME')
  expect((await packingBackup(extension)).orders).toEqual(before.orders)
})

test('a conflicting saved revision retains its local draft and requires explicit recovered-value review', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  await assignAll(page)
  const view = await editOrderProduct(page, 0, {
    'Product code': 'INVALID',
    'Spanish name': 'LOCAL DRAFT',
  })
  await expect(
    view.getByRole('textbox', { name: 'Product code', exact: true })
  ).toHaveAttribute('aria-invalid', 'true')
  const other = await extension.context.newPage()
  await other.goto(`${extension.extensionBaseUrl}/library.html`)
  await closeOrderProduct(
    await editOrderProduct(other, 0, { 'Spanish name': 'NEWER SAVED' })
  )
  const newer = await packingBackup(extension)
  await view
    .getByRole('textbox', { name: 'Product code', exact: true })
    .fill(newer.preparations[0].groups[0].baseCode)
  await view.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(view).toBeVisible()
  await expect(view).toContainText(/newer|changed|revision/i)
  await expect(
    view.getByRole('textbox', { name: 'Spanish name', exact: true })
  ).toHaveValue('LOCAL DRAFT')
  expect((await packingBackup(extension)).preparations).toEqual(
    newer.preparations
  )
  await view
    .getByRole('button', {
      name: 'Review recovered product edits',
      exact: true,
    })
    .click()
  const review = page.getByRole('dialog', {
    name: 'Review recovered product edits',
    exact: true,
  })
  await expect(review).toContainText('NEWER SAVED')
  await expect(review).toContainText('LOCAL DRAFT')
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await packingBackup(extension)).orders[0].snapshot).toEqual(
    record.snapshot
  )
})

for (const [action, mode] of [
  ['Share one barcode', 'share'],
  ['Give rows separate barcodes', 'separate'],
  ['Move to new product', 'split'],
  ['Merge products', 'merge'],
])
  test(`${action} preserves exact source membership, quantities and current code ownership`, async ({
    extension,
  }) => {
    const { page, record } = await openWorkspace(extension)
    await assignAll(page)
    if (mode === 'separate') await shareOrderBarcode(page)
    const before = await packingBackup(extension)
    await page.locator('#clear-rows').click()
    for (const index of mode === 'split'
      ? [0]
      : mode === 'merge'
        ? [0, 2]
        : [0, 1])
      await rows(page).nth(index).getByRole('checkbox').check()
    await page.locator('#group-order-products').click()
    await page
      .locator('.orders-grouping-dialog')
      .getByRole('button', { name: action, exact: true })
      .click()
    const review = page.getByRole('dialog', {
      name: 'Review product grouping',
      exact: true,
    })
    await expect(review).toBeVisible()
    expect((await packingBackup(extension)).preparations).toEqual(
      before.preparations
    )
    await review
      .getByRole('button', { name: 'Apply changes', exact: true })
      .click()
    await expect(review).toBeHidden()
    const after = await packingBackup(extension),
      preparation = after.preparations[0]
    expect(
      preparation.groups
        .flatMap((group) =>
          group.variants.flatMap((variant) => variant.entryIds)
        )
        .sort()
    ).toEqual(record.snapshot.items.map((item) => item.entryId).sort())
    const bases = preparation.groups.map((group) => group.baseCode),
      barcodes = preparation.groups.flatMap((group) =>
        group.variants.map(
          (variant) =>
            group.baseCode + variant.variantSuffix + variant.sizeSuffix
        )
      )
    expect(new Set(bases).size).toBe(bases.length)
    expect(new Set(barcodes).size).toBe(barcodes.length)
    expect(
      after.issuedCodes
        .filter((owner) => owner.kind === 'base')
        .map((owner) => owner.code)
        .sort()
    ).toEqual([...bases].sort())
    expect(
      after.issuedCodes
        .filter((owner) => owner.kind === 'barcode')
        .map((owner) => owner.code)
        .sort()
    ).toEqual([...barcodes].sort())
    expect(after.orders).toEqual(before.orders)
    if (mode === 'share')
      expect(preparation.groups[0].variants[0].entryIds).toHaveLength(2)
    if (mode === 'separate')
      expect(preparation.groups[0].variants).toHaveLength(2)
    if (mode === 'split') expect(preparation.groups).toHaveLength(3)
    if (mode === 'merge') expect(preparation.groups).toHaveLength(1)
  })

test('barcode image segments reject collisions, persist independently and keep the shared base read-only', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  await assignAll(page)
  await rows(page)
    .first()
    .getByRole('button', { name: 'Barcode', exact: true })
    .click()
  const label = page.getByRole('dialog', { name: 'Label editor', exact: true }),
    size = label.getByRole('textbox', { name: 'Size code', exact: true }),
    variant = label.getByRole('textbox', { name: 'Variant code', exact: true }),
    copy = label.getByRole('button', { name: 'Copy label', exact: true })
  await expect(copy).toBeEnabled({ timeout: 20000 })
  const before = await packingBackup(extension),
    base = before.preparations[0].groups[0].baseCode
  await expect(label.locator('.label-code-base')).toHaveText(base)
  await expect(
    label.getByRole('textbox', { name: 'Barcode code', exact: true })
  ).toHaveCount(0)
  await expect(
    label
      .locator('.label-editor-preview')
      .getByLabel('Size code', { exact: true })
  ).toBeVisible()
  await size.fill('L')
  await size.press('Enter')
  await expect(label.locator('.error-notice-message')).toContainText(
    /duplicate|already|conflict|unique/i
  )
  await expect(copy).toBeDisabled()
  expect((await packingBackup(extension)).preparations).toEqual(
    before.preparations
  )
  await size.press('Escape')
  await expect(size).toHaveValue('S')
  await variant.fill('aa')
  await variant.press('Enter')
  await expect(copy).toBeEnabled({ timeout: 20000 })
  await size.fill('xs')
  await size.press('Enter')
  await expect(copy).toBeEnabled({ timeout: 20000 })
  await expect(label.getByLabel('Barcode code', { exact: true })).toHaveText(
    `${base}AAXS`
  )
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  const view = await editOrderProduct(page, 0)
  await expect(
    view.getByRole('textbox', { name: 'Variant ending', exact: true })
  ).toHaveValue('AA')
  await expect(
    view.getByRole('textbox', { name: 'Size ending', exact: true })
  ).toHaveValue('XS')
  expect((await packingBackup(extension)).orders[0].snapshot).toEqual(
    record.snapshot
  )
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

test('invalid authoring blocks label output before rendering and the corrected pending edit saves first', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await assignAll(page)
  const before = await packingBackup(extension)
  const view = await editOrderProduct(page, 0, {
    'Product code': 'INVALID',
    'Spanish name': 'NOMBRE PENDIENTE',
  })
  await observeLabelOutput(page, extension)
  await view.getByRole('button', { name: 'Barcode', exact: true }).click()
  await expect(view.getByRole('status')).toContainText(/code|CE/i)
  await expect(
    page.getByRole('dialog', { name: 'Label editor', exact: true })
  ).toHaveCount(0)
  expect((await packingBackup(extension)).preparations).toEqual(
    before.preparations
  )
  expect(await page.evaluate(() => window.labelOutputProbe)).toEqual({
    renders: 0,
    writes: 0,
  })
  await view
    .getByRole('textbox', { name: 'Product code', exact: true })
    .fill(before.preparations[0].groups[0].baseCode)
  await view.getByRole('button', { name: 'Barcode', exact: true }).click()
  const label = page.getByRole('dialog', { name: 'Label editor', exact: true })
  await expect(
    label.getByRole('textbox', { name: 'Spanish product name', exact: true })
  ).toHaveValue('NOMBRE PENDIENTE')
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  expect((await page.evaluate(() => window.labelOutputProbe)).writes).toBe(0)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Synthetic label cancellation sentinel'
  )
})

test('selected Orders rows limit barcode and carton previews while Cancel writes no clipboard data', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await assignAll(page)
  await page.locator('#clear-rows').click()
  for (const index of [0, 1])
    await rows(page).nth(index).getByRole('checkbox').check()
  await observeLabelOutput(page, extension)
  const before = await packingBackup(extension)
  for (const [name, count] of [
    ['Copy barcode images', 2],
    ['Copy carton marks', 1],
  ]) {
    await revealCopyActions(page)
    await page.getByRole('button', { name, exact: true }).click()
    const images = page.locator('.image-copy-dialog')
    await expect(images.locator('.copy-preview img')).toHaveCount(count)
    await expect(
      images.getByRole('button', { name: 'Copy current batch', exact: true })
    ).toBeEnabled()
    expect((await page.evaluate(() => window.labelOutputProbe)).writes).toBe(0)
    await images.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(images).not.toBeVisible()
  }
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Synthetic label cancellation sentinel'
  )
  expect((await packingBackup(extension)).preparations).toEqual(
    before.preparations
  )
})

test('label output freezes click selection before a pending render while later selection changes only future requests', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await assignAll(page)
  await page.locator('#clear-rows').click()
  await rows(page).first().getByRole('checkbox').check()
  const view = await editOrderProduct(page, 0, {
    'Spanish name': 'FROZEN PENDING',
  })
  await closeOrderProduct(view)
  await page.evaluate(() => {
    const encode = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      window.finishFrozenLabel = () => encode.apply(this, args)
    }
  })
  await revealCopyActions(page)
  await page
    .getByRole('button', { name: 'Copy barcode images', exact: true })
    .click()
  await expect
    .poll(() => page.evaluate(() => Boolean(window.finishFrozenLabel)))
    .toBe(true)
  await page.evaluate(() => document.querySelector('#select-rows').click())
  await page.evaluate(() => window.finishFrozenLabel())
  const images = page.locator('.image-copy-dialog')
  await expect(images.locator('.copy-preview img')).toHaveCount(1)
  await images.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(
    rows(page).locator('input[type="checkbox"]:checked')
  ).toHaveCount(3)
})

test('121 logical Orders products preserve selection and pending editor values outside the mounted window', async ({
  extension,
}) => {
  const ref = await seedSmartOrder(extension, { count: 121 }),
    page = await openSmartLibrary(extension)
  const before = await packingBackup(extension)
  await expect(rows(page)).toHaveCount(100)
  await rows(page).first().focus()
  await page.keyboard.press('Control+a')
  await expect(page.locator('#selection-summary')).toContainText('121 selected')
  const view = await editOrderProduct(page, 0, {
    'Spanish name': 'PENDING WINDOW EDIT',
  })
  await page.evaluate(() => {
    const scroll = document.querySelector('.table-scroll')
    scroll.scrollTop = scroll.scrollHeight
  })
  await expect(
    view.getByRole('textbox', { name: 'Spanish name', exact: true })
  ).toHaveValue('PENDING WINDOW EDIT')
  await expect(
    view.getByRole('textbox', { name: 'Spanish name', exact: true })
  ).toBeFocused()
  expect(await rows(page).count()).toBeLessThanOrEqual(101)
  await closeOrderProduct(view)
  await expect(page.locator('#selection-summary')).toContainText('121 selected')
  const after = await packingBackup(extension)
  expect(after.preparations[0].groups).toHaveLength(121)
  expect(
    after.preparations[0].groups
      .flatMap((group) => group.variants.flatMap((variant) => variant.entryIds))
      .sort()
  ).toEqual(before.orders[0].snapshot.items.map((item) => item.entryId).sort())
  expect(after.orders).toEqual(before.orders)
  const state = await realOrderContext(extension, ref)
  expect(state.batches).toHaveLength(0)
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 720 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight - innerHeight
      )
    ).toBeLessThanOrEqual(1)
    const box = await page.locator('.table-scroll').boundingBox()
    expect(box.height).toBeGreaterThan(40)
    expect(box.y + box.height).toBeLessThanOrEqual(720)
  }
  await expect(
    page.getByRole('button', { name: /Next groups|Previous groups/ })
  ).toHaveCount(0)
})

test('Pcs/box-only order proposes 45+45 and prefills 10 once, confirms once and derives loaded quantities from physical exceptions', async ({
  extension,
}) => {
  const ref = await seedSmartOrder(extension, { count: 1, quantity: '100' }),
    page = await openSmartLibrary(extension),
    before = await packingBackup(extension)
  const grid = await openOrderReconciliation(page, ref),
    row = productGridRow(grid, { ...ref, entryId: '2001' })
  await row.locator('[data-grid-column="capacity"]').fill('45')
  await row.locator('[data-grid-column="capacity"]').press('Tab')
  await expect(row.locator('[data-column="proposedCount"]')).toHaveText('2')
  await expect(
    grid.locator('[data-action="separate-order-remainder"]')
  ).toContainText('10')
  expect((await realOrderContext(extension, ref)).batches).toHaveLength(0)
  await grid.locator('[data-action="separate-order-remainder"]').click()
  await expect(
    grid.locator('[data-action="separate-order-remainder"]')
  ).toHaveCount(0)
  await grid.locator('[data-action="undo-order-cartons"]').click()
  await expect(
    grid.locator('[data-action="separate-order-remainder"]')
  ).toContainText('10')
  await grid.locator('[data-action="redo-order-cartons"]').click()
  await grid.locator('[data-action="confirm-order-cartons"]').click()
  await expect
    .poll(async () =>
      (await realOrderContext(extension, ref)).batches
        .filter((batch) => !batch.deletedAt)
        .reduce((sum, batch) => sum + batch.count, 0)
    )
    .toBe(3)
  const state = await realOrderContext(extension, ref)
  expect(
    state.batches
      .filter((batch) => !batch.deletedAt)
      .flatMap((batch) => batch.contents)
      .reduce((sum, item) => sum + BigInt(item.quantity), 0n)
  ).toBe(100n)
  expect(
    state.batches
      .filter((batch) => !batch.deletedAt)
      .reduce((sum, batch) => sum + batch.count, 0)
  ).toBe(3)
  const id = await createContainerThroughUI(page, [ref]),
    packing = page.locator('#packing-view')
  let container = await extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerView({ id }),
    id
  )
  expect(
    container.cartons.every((carton) => carton.state === 'unconfirmed')
  ).toBe(true)
  await packing.locator('[data-action="mark-all-loaded"]').click()
  container = await extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerView({ id }),
    id
  )
  const remainder = container.cartons.find((carton) =>
    carton.contents?.some((item) => item.quantity === '10')
  )
  expect(remainder).toBeTruthy()
  await packing
    .locator('.container-order [data-action="expand-container-order"]')
    .click()
  await packing
    .locator(
      `tr[data-container-row=${JSON.stringify(remainder.cartonId || remainder.id)}] [data-action="set-carton-loading"][data-state="left-behind"]`
    )
    .click()
  await sealContainerThroughUI(page, { markAll: false })
  const manifest = await extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerManifest({ id }),
    id
  )
  expect(
    manifest.products.map((row) => row.loadedQuantity || row.quantity)
  ).toEqual(['90'])
  expect(
    manifest.leftBehind.products.map(
      (row) => row.quantity || row.remainingQuantity
    )
  ).toEqual(['10'])
  expect((await packingBackup(extension)).orders[0].snapshot).toEqual(
    before.orders[0].snapshot
  )
  await expect(
    packing.locator(
      'input[data-grid-column],.group-code-editor,.packing-remove-button'
    )
  ).toHaveCount(0)
})

for (const [action, id] of [
  ['Copy Excel image', 'copy-excel-image'],
  ['Copy group codes', 'copy-group-codes'],
  ['Copy preparation columns', 'copy-preparation'],
])
  test(`${action} captures source selection before awaiting a real save and uses the latest acknowledged values`, async ({
    extension,
  }) => {
    const { page, record } = await openWorkspace(extension)
    await assignAll(page)
    const before = await packingBackup(extension),
      originalCode = before.preparations[0].groups[0].baseCode,
      otherCode = before.preparations[0].groups[1].baseCode,
      latestCode = 'CE26109901'
    await page.locator('#clear-rows').click()
    for (const index of [0, 1])
      await rows(page).nth(index).getByRole('checkbox').check()
    await extension.context.grantPermissions([
      'clipboard-read',
      'clipboard-write',
    ])
    await page.evaluate(async () => {
      await navigator.clipboard.writeText('pending-orders-export')
      window.frozenOrdersRuns = []
      const text = CanvasRenderingContext2D.prototype.fillText
      CanvasRenderingContext2D.prototype.fillText = function (value, ...args) {
        if (this.canvas.width > 2000)
          window.frozenOrdersRuns.push({
            text: String(value),
            y: args[1],
            font: this.font,
            color: this.fillStyle,
          })
        return text.call(this, value, ...args)
      }
    })
    const view = await editOrderProduct(page, 0),
      name = view.getByRole('textbox', { name: 'Spanish name', exact: true })
    await holdPreparationWrites(page)
    try {
      await name.fill('FIRST SUBMISSION')
      await expect
        .poll(() => page.evaluate(() => window.preparationSaveStarted))
        .toBe(true)
      // Exercise the documented direct control while its async flush waits.
      // Programmatic selection events model another agent changing the display;
      // they never replace the repository, clipboard or output implementation.
      await page.evaluate((id) => document.getElementById(id).click(), id)
      await page.evaluate(() => {
        document.getElementById('clear-rows').click()
        document
          .querySelectorAll(
            '#sheet-body tr[data-selection-key] input[type=checkbox]'
          )[2]
          .click()
      })
      await name.fill('LATEST SOURCE NAME')
      await view
        .getByRole('textbox', { name: 'Product code', exact: true })
        .fill(latestCode)
      await view
        .getByRole('textbox', { name: 'Chinese category', exact: true })
        .fill('新玻璃制品')
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        'pending-orders-export'
      )
    } finally {
      await page.evaluate(() => {
        window.holdPreparationSave = false
      })
    }
    await expect
      .poll(
        async () =>
          (await packingBackup(extension)).preparations[0].groups[0].baseCode
      )
      .toBe(latestCode)
    if (id === 'copy-preparation') {
      const picker = page.locator('.preparation-column-dialog')
      await expect(
        picker.getByText('Copy 2 product rows', { exact: true })
      ).toBeVisible()
      await picker
        .getByRole('button', { name: 'Copy chosen columns', exact: true })
        .click()
      await expect(
        picker.getByRole('button', { name: 'Copied', exact: true })
      ).toBeVisible()
      const copied = (await page.evaluate(() => navigator.clipboard.readText()))
        .split('\r\n')
        .map((row) => row.split('\t'))
      expect(copied).toHaveLength(2)
      expect(copied.map((row) => row[0])).toEqual([latestCode, ''])
      expect(copied.map((row) => row[1])).toEqual([
        `${latestCode}S`,
        `${latestCode}L`,
      ])
      expect(copied[0][3]).toBe('LATEST SOURCE NAME')
      for (const [index, row] of copied.entries())
        expect(row.slice(4)).toEqual(
          ['price', 'quantity', 'discount'].map(
            (key) => record.snapshot.items[index][key]
          )
        )
    } else if (id === 'copy-group-codes') {
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(latestCode)
    } else {
      await copyCurrentImageBatch(page)
      const runs = await page.evaluate(() => window.frozenOrdersRuns),
        codes = runs.filter((run) => /^CE\d/.test(run.text)),
        text = runs.map((run) => run.text)
      expect(codes.map((run) => run.text)).toEqual([
        `${latestCode}S`,
        `${latestCode}L`,
      ])
      for (const run of codes) {
        expect(run.font).toMatch(/^(?:700|bold) (?:1[2-7])px /)
        expect(run.color).toMatch(/^#(?:fff|ffffff)$/i)
      }
      expect(codes[0].y).toBeLessThan(codes[1].y)
      expect(text.join('')).toContain('新玻璃制品')
      expect(text.join('')).not.toContain('TEST-BOX')
      for (const item of record.snapshot.items.slice(0, 2)) {
        expect(text).toContain(`${item.price} 元`)
        expect(text).toContain(item.quantity)
      }
      expect(text).not.toContain(originalCode)
      expect(text).not.toContain(otherCode)
    }
    const after = await packingBackup(extension)
    expect(after.preparations[0].groups[0].variants[0].spanishName).toBe(
      'LATEST SOURCE NAME'
    )
    expect(after.orders).toEqual(before.orders)
    expect(
      after.issuedCodes.some((owner) => owner.code.startsWith(originalCode))
    ).toBe(false)
    for (const owner of before.issuedCodes.filter(
      (owner) => !owner.code.startsWith(originalCode)
    ))
      expect(after.issuedCodes).toContainEqual(owner)
    expect(
      after.issuedCodes.filter((owner) => owner.code.startsWith(latestCode))
    ).toHaveLength(3)
  })

test('an invalid product draft cannot prevent a different purchase from saving its own valid edits', async ({
  extension,
}) => {
  const first = await seedStructuredOrder(extension, '900000000000000001'),
    second = await seedStructuredOrder(extension, '900000000000000002')
  const page = await openSmartLibrary(extension)
  await assignAll(page)
  const before = await packingBackup(extension)
  const invalid = await editOrderProduct(
    page,
    {
      accountId: 'local',
      orderId: first.snapshot.orderId,
      entryId: first.snapshot.items[0].entryId,
    },
    { 'Product code': 'INVALID' }
  )
  await expect(
    invalid.getByRole('textbox', { name: 'Product code', exact: true })
  ).toHaveAttribute('aria-invalid', 'true')
  const other = await extension.context.newPage()
  await other.goto(`${extension.extensionBaseUrl}/library.html`)
  await closeOrderProduct(
    await editOrderProduct(
      other,
      {
        accountId: 'local',
        orderId: second.snapshot.orderId,
        entryId: second.snapshot.items[0].entryId,
      },
      { 'Spanish name': 'OTHER ORDER SAVED' }
    )
  )
  const after = await packingBackup(extension)
  expect(
    after.preparations.find((prep) => prep.orderId === first.snapshot.orderId)
  ).toEqual(
    before.preparations.find((prep) => prep.orderId === first.snapshot.orderId)
  )
  expect(
    after.preparations.find((prep) => prep.orderId === second.snapshot.orderId)
      .groups[0].variants[0].spanishName
  ).toBe('OTHER ORDER SAVED')
  await expect(
    invalid.getByRole('textbox', { name: 'Product code', exact: true })
  ).toHaveValue('INVALID')
  expect(after.orders).toEqual(before.orders)
})

test('Orders retains distinct original photos, purchase counts, custom date/status colors and untranslated tags across languages', async ({
  extension,
}) => {
  const single = await seedStructuredOrder(extension, '1234567890123456789', {
    singleProduct: true,
    tags: ['Fragile'],
  })
  const multiple = await seedStructuredOrder(extension, '2234567890123456789', {
    manyPhotos: true,
  })
  const seeded = await packingBackup(extension)
  seeded.packingPreferences = {
    value: {
      ...seeded.packingPreferences?.value,
      orderTags: [
        { name: 'Fragile', colors: { light: '#f4dbc1', dark: '#47351f' } },
      ],
      appearance: {
        ...seeded.packingPreferences?.value?.appearance,
        labelColors: {
          dates: { light: '#e8c7a3', dark: '#e8c7a3' },
          'awaiting-shipment': { light: '#e5d2ba', dark: '#e5d2ba' },
        },
      },
    },
    updatedAt: new Date().toISOString(),
  }
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    seeded
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await openSmartLibrary(extension)
  await expect(rows(page)).toHaveCount(11)
  await assignAll(page)
  const before = await packingBackup(extension),
    card = page.locator(
      `.order-card[data-order-id="${single.snapshot.orderId}"]`
    )
  await expect(card.locator('.order-products')).toHaveText('1 product')
  await expect(
    page.locator(
      `.order-card[data-order-id="${multiple.snapshot.orderId}"] .order-products`
    )
  ).toHaveText('10 products')
  for (const [selector, color] of [
    ['.purchase-date', 'rgb(232, 199, 163)'],
    ['.order-status', 'rgb(229, 210, 186)'],
  ])
    await expect(card.locator(selector)).toHaveCSS('background-color', color)
  const tag = card.locator('.order-tag-badge')
  await expect(tag).toHaveText('Fragile')
  await expect(tag).toHaveCSS('--tag-light', '#f4dbc1')
  await expect(tag).toHaveCSS('--tag-dark', '#47351f')
  const pixels = []
  for (const row of await rows(page).all()) {
    const button = row.locator('.product-photo-button')
    if (await button.isDisabled()) continue
    await button.scrollIntoViewIfNeeded()
    const image = button.locator('img')
    await expect
      .poll(() =>
        image.evaluate((node) => node.complete && node.naturalWidth > 0)
      )
      .toBe(true)
    pixels.push(
      await image.evaluate((image) => {
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        canvas.getContext('2d').drawImage(image, 0, 0)
        return canvas.toDataURL()
      })
    )
  }
  expect(new Set(pixels).size).toBe(
    new Set(
      [...single.snapshot.items, ...multiple.snapshot.items]
        .map((item) => item.thumbnail)
        .filter(Boolean)
    ).size
  )
  expect(new Set(pixels).size).toBeGreaterThanOrEqual(8)
  for (const [language, count] of [
    ['es', '1 producto'],
    ['zh', '1 件商品'],
  ]) {
    await page.locator(`#language-toggle [data-language="${language}"]`).click()
    await expect(card.locator('.order-products')).toHaveText(count)
    await expect(tag).toHaveText('Fragile')
  }
  await page.setViewportSize({ width: 390, height: 800 })
  await expect(tag).toBeVisible()
  const bounds = await card.boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
  expect((await packingBackup(extension)).orders).toEqual(before.orders)
})
