import { CFB, utils, write } from 'xlsx'
import { crc32, deflateSync } from 'node:zlib'
import { test, expect } from './extension-fixture.mjs'

const png = (() => {
  const chunk = (name, content) => {
    const kind = Buffer.from(name),
      header = Buffer.alloc(4),
      crc = Buffer.alloc(4)
    header.writeUInt32BE(content.length)
    crc.writeUInt32BE(crc32(Buffer.concat([kind, content])))
    return Buffer.concat([header, kind, content, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(16, 0)
  header.writeUInt32BE(8, 4)
  header[8] = 8
  header[9] = 2
  const pixels = Buffer.concat(
    Array.from({ length: 8 }, () =>
      Buffer.concat([
        Buffer.from([0]),
        Buffer.from(Array.from({ length: 16 }, () => [30, 100, 180]).flat()),
      ])
    )
  )
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
})()

function workbookFile({
  variants = '',
  amount = 60,
  total = 60,
  name = '4321.xlsx',
} = {}) {
  const workbook = utils.book_new()
  utils.book_append_sheet(
    workbook,
    utils.aoa_to_sheet([
      ['pic', 'desc', 'boxes', 'perbox', 'price', 'amount', 'group', 'var'],
      ['', 'Synthetic import cup', 2, 10, 3, amount, 1, variants],
      [],
      ['total', total, 'total'],
    ]),
    'Products'
  )
  const archive = CFB.read(
    new Uint8Array(write(workbook, { type: 'array', bookType: 'xlsx' })),
    { type: 'array' }
  )
  const add = (path, value) =>
    CFB.utils.cfb_add(
      archive,
      path,
      typeof value === 'string' ? new TextEncoder().encode(value) : value
    )
  const part =
    archive.FileIndex[
      archive.FullPaths.indexOf('Root Entry/xl/worksheets/sheet1.xml')
    ]
  part.content = new TextEncoder().encode(
    new TextDecoder()
      .decode(part.content)
      .replace('</worksheet>', '<drawing r:id="photos"/></worksheet>')
  )
  part.size = part.content.length
  add(
    'xl/worksheets/_rels/sheet1.xml.rels',
    '<Relationships><Relationship Id="photos" Target="../drawings/drawing1.xml"/></Relationships>'
  )
  add(
    'xl/drawings/drawing1.xml',
    '<xdr:wsDr><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:row>1</xdr:row></xdr:from><xdr:to><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><a:blip r:embed="photo1"/></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>'
  )
  add(
    'xl/drawings/_rels/drawing1.xml.rels',
    '<Relationships><Relationship Id="photo1" Target="../media/photo.png"/></Relationships>'
  )
  add('xl/media/photo.png', png)
  return {
    name,
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(CFB.write(archive, { type: 'array', fileType: 'zip' })),
  }
}

async function openImport(extension) {
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-21T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await page
    .getByRole('button', { name: 'Import spreadsheet', exact: true })
    .click()
  const dialog = page.getByRole('dialog', {
    name: 'Import store spreadsheet',
    exact: true,
  })
  await expect(dialog).toBeVisible()
  return { page, dialog, file: dialog.getByLabel('Workbook', { exact: true }) }
}

async function backup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}

test('store import reads a real marked workbook in its worker, blocks bad totals/date, and refreshes Products immediately', async ({
  extension,
}) => {
  const { page, dialog, file } = await openImport(extension)
  await file.setInputFiles(workbookFile({ amount: 61 }))
  await expect(dialog.locator('.store-import-product')).toHaveCount(1)
  await expect(dialog.locator('.store-import-cells')).toContainText('F2')
  await dialog.getByLabel('Purchase date', { exact: true }).fill('2026-10-20')
  await dialog
    .getByRole('checkbox', {
      name: 'I checked the product photos, quantities and order total.',
    })
    .check()
  await dialog
    .getByRole('button', { name: 'Import order', exact: true })
    .click()
  expect((await backup(extension)).orders).toHaveLength(0)
  await expect(dialog).toBeVisible()
  await file.setInputFiles(workbookFile())
  await expect(dialog.locator('.store-import-issue.is-error')).toHaveCount(0)
  await dialog.getByLabel('Purchase date', { exact: true }).fill('')
  await dialog
    .getByRole('checkbox', {
      name: 'I checked the product photos, quantities and order total.',
    })
    .check()
  await dialog
    .getByRole('button', { name: 'Import order', exact: true })
    .click()
  await expect(dialog.locator('.store-import-status')).toHaveText(
    'Confirm the purchase date before importing.'
  )
  expect((await backup(extension)).orders).toHaveLength(0)
  await dialog.getByLabel('Purchase date', { exact: true }).fill('2026-10-20')
  await dialog
    .getByLabel('Store or factory name', { exact: true })
    .fill('Synthetic imported store')
  await dialog
    .getByRole('button', { name: 'Import order', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  await expect(
    page.locator(
      '#sheet-body .order-source-link, #order-list .order-source-link'
    )
  ).toHaveCount(0)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    1
  )
  await expect(page.locator('#sheet-body')).toContainText(
    'Synthetic import cup'
  )
  const result = await backup(extension)
  expect(result.orders).toHaveLength(1)
  expect(result.orders[0].snapshot.sourceType).toBe('spreadsheet')
  expect(result.orders[0].snapshot.sellerName).toBe('Synthetic imported store')
  expect(result.orders[0].snapshot.items[0].photos).toHaveLength(1)
  expect(result.images).toHaveLength(1)
})

test('combined variants require actual quantities and photo adjustments keep originals', async ({
  extension,
}) => {
  const { page, dialog, file } = await openImport(extension)
  await file.setInputFiles(workbookFile({ variants: 'abs' }))
  const quantities = dialog.locator('.store-import-allocation input')
  await expect(quantities).toHaveCount(2)
  await dialog.getByLabel('Purchase date', { exact: true }).fill('2026-10-20')
  await dialog
    .getByRole('checkbox', {
      name: 'I checked the product photos, quantities and order total.',
    })
    .check()
  await quantities.nth(0).fill('7')
  await quantities.nth(1).fill('12')
  await dialog
    .getByRole('button', { name: 'Import order', exact: true })
    .click()
  await expect(dialog.locator('.store-import-status')).toContainText(
    'the sum must be 20'
  )
  expect((await backup(extension)).orders).toHaveLength(0)
  await quantities.nth(1).fill('13')
  await dialog
    .getByRole('button', { name: 'View or adjust row 2, photo 1', exact: true })
    .click()
  const viewer = page.getByRole('dialog', {
    name: 'Product photo',
    exact: true,
  })
  await expect(viewer.locator('.photo-viewport img')).toBeVisible()
  await viewer
    .getByRole('button', { name: 'Adjust photo', exact: true })
    .click()
  await viewer.getByLabel('Canvas fit', { exact: true }).selectOption('cover')
  await viewer.getByRole('button', { name: 'Save photo', exact: true }).click()
  await viewer
    .getByRole('button', { name: 'Close product photo', exact: true })
    .click()
  await dialog
    .getByRole('button', { name: 'Import order', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    2
  )
  const result = await backup(extension)
  const items = result.orders[0].snapshot.items
  expect(items.map((item) => item.quantity)).toEqual(['7', '13'])
  expect(items[0].carton.boxes).toBe('2')
  expect(items[1].carton?.boxes).toBeUndefined()
  expect(items[0].photoEdits['0'].fit).toBe('cover')
  expect(result.images).toHaveLength(1)
  expect(result.images[0].dataUrl).toBe(
    `data:image/png;base64,${png.toString('base64')}`
  )
})

test('additional order charges preview increased prices and preserve source amounts', async ({
  extension,
}) => {
  const { page, dialog, file } = await openImport(extension)
  await file.setInputFiles(workbookFile())
  await expect(dialog.locator('.store-import-product')).toHaveCount(1)
  await dialog.getByLabel('Purchase date', { exact: true }).fill('2026-10-20')
  await dialog
    .getByRole('checkbox', {
      name: 'I checked the product photos, quantities and order total.',
    })
    .check()
  await dialog
    .getByRole('button', { name: 'Import order', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  await page.locator('.order-details-trigger').click()
  const details = page.locator('#order-details')
  await details.locator('.order-charges summary').click()
  await details.getByRole('button', { name: 'Add charge', exact: true }).click()
  await details.getByLabel('Reason', { exact: true }).fill('Unloading')
  await details.getByLabel('Amount · CNY', { exact: true }).fill('20.00')
  await expect(
    details.locator('.order-charge-product-cost').first()
  ).toContainText('¥3.00→¥4.00')
  await details
    .getByRole('button', { name: 'Save charges', exact: true })
    .click()
  await expect(details.locator('.order-charges-status')).toHaveText('Saved')
  await details
    .getByRole('button', { name: 'Close order details', exact: true })
    .click()
  await expect(page.locator('.price-cell')).toContainText('3.00→ 4.00')
  const saved = (await backup(extension)).orders[0]
  expect(saved.additionalCharges[0]).toMatchObject({
    reason: 'Unloading',
    amount: '20.00',
  })
  expect(saved.snapshot.items[0].price).toBe('3.00')
  expect(saved.snapshot.totals.payable).toBe('60.00')
})

test('editing a repeated import photo in preparation updates its exact order and preserves both original galleries', async ({
  extension,
}) => {
  test.setTimeout(60000)
  const { page, dialog, file } = await openImport(extension)
  const importCopy = async (name, date) => {
    await file.setInputFiles(workbookFile({ name }))
    await expect(dialog.locator('.store-import-product')).toHaveCount(1)
    await dialog.getByLabel('Purchase date', { exact: true }).fill(date)
    await dialog
      .getByRole('checkbox', {
        name: 'I checked the product photos, quantities and order total.',
      })
      .check()
    await dialog
      .getByRole('button', { name: 'Import order', exact: true })
      .click()
    await expect(dialog).toHaveCount(0)
  }
  await importCopy('4321.xlsx', '2026-10-19')
  await page
    .getByRole('button', { name: 'Import spreadsheet', exact: true })
    .click()
  await importCopy('4321 (2).xlsx', '2026-10-20')
  const before = await backup(extension)
  const first = before.orders.find(
    (order) => order.snapshot.spreadsheet.filename === '4321.xlsx'
  )
  const second = before.orders.find(
    (order) => order.snapshot.spreadsheet.filename === '4321 (2).xlsx'
  )
  expect(first.snapshot.orderId).not.toBe(second.snapshot.orderId)
  expect(first.snapshot.items[0].entryId).toBe(second.snapshot.items[0].entryId)
  expect(first.snapshot.items[0].thumbnail).toBe(
    second.snapshot.items[0].thumbnail
  )
  expect(first.snapshot.items[0].photos).toEqual(
    second.snapshot.items[0].photos
  )

  await page.locator('#select-rows').click()
  await page.locator('#prepare-orders').click()
  await expect(
    page
      .getByRole('dialog', { name: 'Assign product codes?', exact: true })
      .locator('.order-source-link')
  ).toHaveCount(0)
  await page
    .getByRole('dialog', { name: 'Assign product codes?', exact: true })
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const packing = page.locator('#packing-view')
  await expect(packing).toBeVisible()
  const secondOrder = packing.locator(
    `[data-packing-order="${second.snapshot.orderId}"]`
  )
  await secondOrder
    .locator('.variants tbody tr .preparation-photo')
    .first()
    .click()
  const viewer = page.getByRole('dialog', {
    name: 'Product photo',
    exact: true,
  })
  await expect(viewer.locator('.photo-viewport img')).toBeVisible()
  await viewer
    .getByRole('button', { name: 'Adjust photo', exact: true })
    .click()
  await viewer.getByLabel('Canvas fit', { exact: true }).selectOption('cover')
  await viewer.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(viewer.locator('.photo-viewer-status')).toHaveText(
    'Photo saved. Original preserved.'
  )
  await viewer
    .getByRole('button', { name: 'Adjust photo', exact: true })
    .click()
  await viewer.getByLabel('Image size', { exact: true }).press('ArrowRight')
  await viewer.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(viewer.locator('.photo-viewer-status')).toHaveText(
    'Photo saved. Original preserved.'
  )
  await viewer
    .getByRole('button', { name: 'Close product photo', exact: true })
    .click()
  const saved = await backup(extension)
  const firstSaved = saved.orders.find(
    (order) => order.snapshot.orderId === first.snapshot.orderId
  )
  const secondSaved = saved.orders.find(
    (order) => order.snapshot.orderId === second.snapshot.orderId
  )
  expect(firstSaved.snapshot.items[0]).toEqual(first.snapshot.items[0])
  expect(secondSaved.snapshot.items[0].photoEdits['0'].fit).toBe('cover')
  expect(secondSaved.snapshot.items[0].thumbnail).not.toBe(
    second.snapshot.items[0].thumbnail
  )
  expect(secondSaved.snapshot.items[0].photos).toEqual(
    second.snapshot.items[0].photos
  )
  expect(saved.images).toEqual(before.images)

  await page.locator('#view-orders').click()
  await page.reload()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    2
  )
  for (const order of [firstSaved, secondSaved]) {
    const item = order.snapshot.items[0]
    const product = page.locator(
      `#sheet-body tr[data-selection-key="${order.snapshot.orderId}/${item.entryId}"]`
    )
    await product
      .getByRole('button', { name: 'Zoom product photo 1', exact: true })
      .click()
    await expect(viewer.locator('.photo-viewport img')).toBeVisible()
    expect(
      await viewer.locator('.photo-viewport img').evaluate((image) => ({
        width: image.naturalWidth,
        height: image.naturalHeight,
      }))
    ).toEqual(
      item.photoEdits?.['0']
        ? { width: 640, height: 640 }
        : { width: 16, height: 8 }
    )
    await expect(viewer.locator('.photo-gallery-count')).toHaveText(/\/ 2$/)
    await viewer
      .getByRole('button', { name: 'Close product photo', exact: true })
      .click()
  }
})
