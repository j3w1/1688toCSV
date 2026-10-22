import { CFB, utils, write } from 'xlsx'
import { crc32, deflateSync } from 'node:zlib'
import { mkdir } from 'node:fs/promises'
import { test, expect } from './extension-fixture.mjs'
import {
  assignSelectedPurchaseCodes,
  editOrderProduct,
  closeOrderProduct,
  openOrderReconciliation,
  createContainerThroughUI,
  sealContainerThroughUI,
} from './smart-workspace-helpers.mjs'
import { STORE_IMPORT_MARKERS } from '../../src/store-workbook-model.js'

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
  rows,
  photoSpans = [{ from: 1, to: 2 }],
} = {}) {
  const workbook = utils.book_new()
  utils.book_append_sheet(
    workbook,
    utils.aoa_to_sheet(
      rows ?? [
        ['pic', 'desc', 'boxes', 'perbox', 'price', 'amount', 'group', 'var'],
        ['', 'Synthetic import cup', 2, 10, 3, amount, 1, variants],
        [],
        ['total', total, 'total'],
      ]
    ),
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
    `<xdr:wsDr>${photoSpans.map(({ from, to }) => `<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:row>${from}</xdr:row></xdr:from><xdr:to><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${to}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><a:blip r:embed="photo1"/></xdr:pic></xdr:twoCellAnchor>`).join('')}</xdr:wsDr>`
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

function reviewWorkbook({
  groups = 8,
  badAmount = false,
  combined = false,
} = {}) {
  const rows = [
      ['pic', 'desc', 'boxes', 'perbox', 'price', 'amount', 'group', 'var'],
    ],
    photoSpans = []
  const names = [
    'Ceramic mugs · ivory',
    'Woven baskets · natural',
    'Glass vases · blue',
    'Cotton towels · white',
    'Bamboo trays · honey',
    'Desk lamps · brass',
    'Storage jars · clear',
    'Linen cushions · sage',
  ]
  let total = 0
  for (let group = 0; group < groups; group++) {
    const from = rows.length
    for (let variant = 0; variant < 2; variant++) {
      const boxes = variant + 1,
        perbox = 10 + group,
        price = 3 + group * 0.5,
        amount = boxes * perbox * price
      total += amount
      rows.push([
        '',
        names[group % names.length],
        boxes,
        perbox,
        price,
        amount + (badAmount && group === 0 && variant === 0 ? 1 : 0),
        group + 1,
        '',
      ])
    }
    photoSpans.push({ from, to: rows.length })
  }
  if (combined) {
    const from = rows.length
    rows.push([
      '',
      'Assorted ceramic dishes · A / B',
      1,
      20,
      4,
      80,
      'assorted',
      'ab',
    ])
    photoSpans.push({ from, to: rows.length })
    total += 80
  }
  rows.push([], ['total', total, 'total'])
  return workbookFile({ rows, photoSpans })
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

test('complete China purchase imports1350 pieces and15 physical cartons once, then whole-order loading seals without quantity reentry', async ({
  extension,
}) => {
  const { page, dialog, file } = await openImport(extension),
    quantities = [100, 150, 500, 500, 100],
    capacities = [50, 75, 100, 100, 100]
  await file.setInputFiles(
    workbookFile({
      rows: [
        ['pic', 'desc', 'boxes', 'perbox', 'price', 'amount', 'group', 'var'],
        ...quantities.map((quantity, index) => [
          '',
          `Synthetic China goods ${index + 1}`,
          quantity / capacities[index],
          capacities[index],
          1,
          quantity,
          String(index + 1),
          '',
        ]),
        ['total', 1350, 'total'],
      ],
      photoSpans: [{ from: 1, to: 6 }],
    })
  )
  await expect(dialog.locator('.store-import-product')).toHaveCount(5)
  await dialog.locator('input[name="allReviews"]').check()
  await dialog.getByLabel('Purchase date', { exact: true }).fill('2026-09-12')
  await dialog.locator('input[name="photosReviewed"]').check()
  await dialog
    .getByRole('button', { name: 'Import order', exact: true })
    .click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    5
  )
  const original = await backup(extension),
    record = original.orders[0],
    ref = {
      accountId: record.accountId || 'local',
      orderId: record.snapshot.orderId,
    }
  expect(record.snapshot.items.map((item) => item.quantity)).toEqual(
    quantities.map(String)
  )
  expect(record.snapshot.items.every((item) => item.price === '1.00')).toBe(
    true
  )
  expect(record.snapshot.totals.payable).toBe('1350.00')
  const context = await extension.inspector.evaluate(
    async (ref) => (await window.testRepository).getOrderReconciliation(ref),
    ref
  )
  expect(context.batches.reduce((sum, batch) => sum + batch.count, 0)).toBe(15)
  expect(
    context.batches
      .flatMap((batch) => batch.contents)
      .reduce((sum, part) => sum + BigInt(part.quantity), 0n)
      .toString()
  ).toBe('1350')
  await page.getByRole('button', { name: 'Show all', exact: true }).click()
  await page.locator('#select-rows').click()
  await assignSelectedPurchaseCodes(page)
  const prepared = await backup(extension)
  expect(
    prepared.preparations[0].groups.every((group) =>
      group.baseCode.startsWith('CE2609')
    )
  ).toBe(true)
  const id = await createContainerThroughUI(
    page,
    [ref],
    'Synthetic November China container'
  )
  await expect(
    page.locator(
      '#packing-view [data-grid-column="capacity"],#packing-view .preparation-group'
    )
  ).toHaveCount(0)
  await sealContainerThroughUI(page)
  const manifest = await extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerManifest({ id }),
    id
  )
  expect(manifest.draft).toBe(false)
  expect(manifest.cartons).toHaveLength(15)
  expect(
    manifest.products
      .reduce((sum, product) => sum + BigInt(product.quantity), 0n)
      .toString()
  ).toBe('1350')
  expect(
    manifest.leftBehind.products
      .reduce((sum, product) => sum + BigInt(product.quantity), 0n)
      .toString()
  ).toBe('0')
  expect((await backup(extension)).orders[0].snapshot).toEqual(record.snapshot)
  expect(extension.unexpectedRequests).toEqual([])
})

test('marked description cells without measurement headers reach automatic size recognition after a real workbook import', async ({
  extension,
}) => {
  const { page, dialog, file } = await openImport(extension)
  const groups = [
    ['25cm', '20.5cm', '18cm'],
    ['10.5"', '8"', '7.5"', '6"'],
    ['25cm', '14*6'],
  ]
  const products = groups.flatMap((sizes, group) =>
    sizes.map((size, index) => [
      '',
      `SYN-${group + 1}-${index + 1}`,
      '黑色陶瓷盘',
      size,
      1,
      10,
      1,
      10,
      group + 1,
    ])
  )
  await file.setInputFiles(
    workbookFile({
      rows: [
        [
          'pic',
          'desc',
          'desc',
          'desc',
          'boxes',
          'perbox',
          'price',
          'amount',
          'group',
        ],
        ['图片', '货号', '品名', '', '箱数', '装箱量', '单价', '金额', '组'],
        ...products,
        ['total', products.length * 10, 'total'],
      ],
      photoSpans: products.map((_, index) => ({
        from: index + 2,
        to: index + 3,
      })),
    })
  )
  await expect(dialog.locator('.store-import-product')).toHaveCount(
    products.length
  )
  await expect(dialog.locator('.store-import-issue.is-error')).toHaveCount(0)
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
  const imported = (await backup(extension)).orders[0].snapshot
  expect(imported.items[0].productNumber).toBe('SYN-1-1')
  expect(imported.items[0].description).toBe('SYN-1-1 · 黑色陶瓷盘 · 25cm')
  await page.locator('#select-rows').click()
  await assignSelectedPurchaseCodes(page)
  await expect(page.locator('#orders-view')).toBeVisible()
  const saved = await backup(extension)
  const prepared = saved.preparations[0].groups
  expect(prepared[0].variants.map((variant) => variant.size)).toEqual(groups[0])
  expect(prepared[0].variants.map((variant) => variant.sizeSuffix)).toEqual([
    'L',
    'M',
    'S',
  ])
  expect(prepared[1].variants.map((variant) => variant.sizeSuffix)).toEqual([
    'XL',
    'L',
    'M',
    'S',
  ])
  expect(prepared[2].variants.map((variant) => variant.size)).toEqual(groups[2])
  expect(
    prepared[2].variants.every((variant) => variant.needsSizeMapping)
  ).toBe(true)
  expect(saved.orders[0].snapshot).toEqual(imported)
})

test('import sidebar keeps compact marker cards and setup guidance beside an independently scrolling review', async ({
  extension,
}) => {
  const { page, file } = await openImport(extension)
  const dialog = page.locator('.store-import-dialog')
  await page.setViewportSize({ width: 1280, height: 960 })
  const sidebar = dialog.locator('.store-import-sidebar'),
    body = dialog.locator('.store-import-body')
  await expect(sidebar).toBeVisible()
  await expect(sidebar).toHaveAccessibleName('Workbook guide')
  await expect(dialog.locator('details, summary, table')).toHaveCount(0)
  await expect(sidebar.getByRole('tab')).toHaveCount(3)
  await expect(
    sidebar.getByRole('tab', { name: 'Markers', exact: true })
  ).toHaveAttribute('aria-selected', 'true')
  expect(
    (
      await sidebar
        .locator('.store-import-marker-list .store-import-token')
        .allTextContents()
    ).sort()
  ).toEqual([...STORE_IMPORT_MARKERS].sort())
  const frame = await sidebar.boundingBox(),
    main = await body.boundingBox()
  expect(frame.x).toBeGreaterThanOrEqual(main.x + main.width - 1)
  expect(frame.width).toBe(282)
  await expect(
    dialog.locator('.store-import-date-field .store-import-template')
  ).toHaveAttribute('download', 'store-order-template.xlsx')
  const checkTemplatePosition = async () => {
    const date = await dialog
        .getByLabel('Purchase date', { exact: true })
        .boundingBox(),
      download = await dialog
        .getByRole('link', { name: 'Download template', exact: true })
        .boundingBox()
    expect(download.x).toBeGreaterThan(date.x + date.width)
    expect(download.y + download.height / 2).toBeCloseTo(
      date.y + date.height / 2,
      0
    )
    expect(download.width).toBe(32)
    expect(download.height).toBe(32)
    const name = await dialog
      .getByLabel('Store or factory name', { exact: true })
      .boundingBox()
    expect(date.y).toBeCloseTo(name.y, 0)
    expect(date.height).toBe(32)
    expect(name.height).toBe(32)
  }
  await checkTemplatePosition()
  await sidebar.getByRole('tab', { name: 'Setup', exact: true }).click()
  for (const row of await sidebar
    .locator('.store-import-filenames > div')
    .all()) {
    const title = await row.locator('dt').boundingBox(),
      examples = await row.locator('dd').boundingBox()
    expect(examples.y).toBeGreaterThanOrEqual(title.y + title.height)
    expect(examples.x).toBeCloseTo(title.x, 1)
  }
  await file.setInputFiles(reviewWorkbook())
  await expect(dialog.locator('.store-import-product')).toHaveCount(16)
  await dialog
    .getByLabel('Store or factory name', { exact: true })
    .fill('Draft store')
  await dialog.getByLabel('Purchase date', { exact: true }).fill('2026-10-20')
  await dialog.locator('input[name="allReviews"]').check()
  await body.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  expect((await sidebar.boundingBox()).y).toBe(frame.y)
  await sidebar.getByRole('tab', { name: 'Markers', exact: true }).click()
  await dialog.locator('.popup-language-toggle [data-language="es"]').click()
  await expect(
    sidebar.getByRole('tab', { name: 'Marcadores', exact: true })
  ).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.locator('input[name="storeName"]')).toHaveValue(
    'Draft store'
  )
  await expect(dialog.locator('input[name="purchaseDate"]')).toHaveValue(
    '2026-10-20'
  )
  await expect(
    dialog.locator('.store-import-review-check input:checked')
  ).toHaveCount(8)
  await dialog.locator('.popup-language-toggle [data-language="en"]').click()
  await body.evaluate((node) => {
    node.scrollTop = 0
  })
  await mkdir(new URL('../../work/', import.meta.url), { recursive: true })
  await dialog.screenshot({ path: 'work/store-import-sidebar-wide.png' })
  await page.setViewportSize({ width: 390, height: 700 })
  await checkTemplatePosition()
  const narrow = await sidebar.boundingBox(),
    content = await body.boundingBox()
  expect(narrow.y).toBeGreaterThanOrEqual(content.y + content.height - 1)
  for (const tab of await sidebar.getByRole('tab').all()) {
    await tab.click()
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    ).toBe(true)
    expect(
      await sidebar
        .locator('.store-import-guide-panel:not([hidden])')
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    ).toBe(true)
  }
  await sidebar.getByRole('tab', { name: 'Setup', exact: true }).click()
  await sidebar.scrollIntoViewIfNeeded()
  await dialog.screenshot({ path: 'work/store-import-sidebar-narrow.png' })
  await expect(dialog.locator('input[name="photosReviewed"]')).not.toBeChecked()
  await page.close()
})

test('one embedded photo imports into every covered product group with one original asset and a shared-photo review', async ({
  extension,
}) => {
  const { page, file } = await openImport(extension)
  const dialog = page.locator('.store-import-dialog')
  await file.setInputFiles(
    workbookFile({
      rows: [
        ['pic', 'desc', 'boxes', 'perbox', 'price', 'amount', 'group', 'var'],
        ['', 'Shared photo plate', 1, 10, 3, 30, 1, ''],
        ['', 'Skipped source row', 1, 10, 3, 30, '', ''],
        ['', 'Shared photo bowl', 2, 10, 4, 80, 2, ''],
        ['', 'Shared photo cup', 1, 10, 2, 20, 3, ''],
        ['total', 130, 'total'],
      ],
      photoSpans: [{ from: 1, to: 5 }],
    })
  )
  await expect(dialog.locator('.store-import-product')).toHaveCount(3)
  await expect(dialog.locator('.store-import-product img')).toHaveCount(3)
  await expect(dialog.locator('.store-import-issue.is-error')).toHaveCount(0)
  const shared = dialog.locator('[data-issue-code="photo-shared"]')
  const workspace = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    preference: localStorage.getItem('1688-workspace-language'),
  }))
  await expect(shared).toHaveCount(1)
  await expect(shared).toContainText('Shared product photo')
  await expect(shared).toContainText('Group 1')
  await expect(shared).toContainText('Group 2')
  await expect(shared).toContainText('Group 3')
  await expect(shared).toContainText('Rows 2, 4, 5')
  for (const [language, title] of [
    ['es', 'Foto compartida de productos'],
    ['zh', '商品共用照片'],
    ['en', 'Shared product photo'],
  ]) {
    await dialog
      .locator(`.popup-language-toggle [data-language="${language}"]`)
      .click()
    await expect(shared).toContainText(title)
    expect(
      await page.evaluate(() => ({
        lang: document.documentElement.lang,
        preference: localStorage.getItem('1688-workspace-language'),
      }))
    ).toEqual(workspace)
    await expect(page.locator('#import-store-sheet')).toHaveText(
      'Import spreadsheet'
    )
    if (language === 'es') {
      await dialog.locator('.store-import-photos button').first().click()
      const photo = page.locator('.product-photo-dialog')
      await expect(photo).toHaveAttribute('lang', 'es')
      await expect(photo.locator('h2')).not.toHaveText('Product photo')
      await photo.locator('.dialog-close').click()
      await expect(dialog).toHaveAttribute('lang', 'es')
    }
  }
  await dialog.getByLabel('Purchase date', { exact: true }).fill('2026-10-20')
  await dialog.locator('input[name="photosReviewed"]').check()
  await dialog
    .getByRole('button', { name: 'Import order', exact: true })
    .click()
  await expect(dialog).toBeVisible()
  expect((await backup(extension)).orders).toHaveLength(0)
  await dialog.locator('input[name="allReviews"]').check()
  await dialog
    .getByRole('button', { name: 'Import order', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  const saved = await backup(extension)
  expect(saved.orders).toHaveLength(1)
  const items = saved.orders[0].snapshot.items
  expect(items.map((item) => item.sourceGroup)).toEqual(['1', '2', '3'])
  expect(items.map((item) => item.sourceRow)).toEqual([2, 4, 5])
  expect(new Set(items.flatMap((item) => item.photos)).size).toBe(1)
  expect(saved.images).toHaveLength(1)
  expect(saved.orders[0].snapshot.totals.payable).toBe('130.00')
  await page.close()
})

test('52 imported groups use one scrollable purchase-code review with bounded rows and preserve source descriptions', async ({
  extension,
}) => {
  const { page, dialog, file } = await openImport(extension)
  await page.setViewportSize({ width: 1280, height: 900 })
  const products = Array.from({ length: 52 }, (_, index) => [
    '',
    `SYN-${index + 1} · 碗 · 6"`,
    1,
    10,
    1,
    10,
    index + 1,
    '',
  ])
  await file.setInputFiles(
    workbookFile({
      rows: [
        ['pic', 'desc', 'boxes', 'perbox', 'price', 'amount', 'group', 'var'],
        ...products,
        ['total', 520, 'total'],
      ],
      photoSpans: [{ from: 1, to: 53 }],
    })
  )
  await expect(dialog.locator('.store-import-product')).toHaveCount(52)
  await dialog.locator('input[name="allReviews"]').check()
  await dialog.locator('input[name="purchaseDate"]').fill('2026-10-20')
  await dialog.locator('input[name="photosReviewed"]').check()
  await dialog
    .getByRole('button', { name: 'Import order', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  const source = (await backup(extension)).orders[0].snapshot
  await page.locator('#select-rows').click()
  await page.locator('#review-purchase-codes').click()
  const review = page.locator('dialog[data-action="purchase-code-review"]'),
    cards = review.locator('article')
  await expect(review.locator('[data-row-count]')).toHaveAttribute(
    'data-row-count',
    '52'
  )
  await expect(cards).toHaveCount(52)
  await expect(cards.first()).toContainText('SYN-1')
  await expect(
    review.getByRole('button', { name: /^(Previous|Next)$/ })
  ).toHaveCount(0)
  await expect(review.locator('.order-reference-pair')).toHaveCount(0)
  const fitted = async () => {
    const bounds = await review.boundingBox(),
      viewport = page.viewportSize()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
    await cards.last().scrollIntoViewIfNeeded()
    await expect(cards.last().locator('.purchase-code')).toBeVisible()
    await expect(
      review.locator('[data-action="assign-purchase-codes"]')
    ).toBeVisible()
  }
  await cards.first().scrollIntoViewIfNeeded()
  await cards.first().locator('.photo-copy-tile').hover()
  const corner = cards.first().locator('.photo-copy-button'),
    photoBounds = await cards
      .first()
      .locator('.photo-copy-source')
      .boundingBox(),
    cornerBounds = await corner.boundingBox()
  expect(cornerBounds.x + cornerBounds.width).toBeCloseTo(
    photoBounds.x + photoBounds.width - 2,
    0
  )
  expect(cornerBounds.y).toBeCloseTo(photoBounds.y + 2, 0)
  expect(cornerBounds.width).toBeLessThanOrEqual(16)
  for (const width of [1280, 720, 390]) {
    await page.setViewportSize({ width, height: 700 })
    await fitted()
    await review.screenshot({
      path: test.info().outputPath(`purchase-code-review-${width}.png`),
    })
  }
  await review.locator('[data-action="assign-purchase-codes"]').click()
  await expect(review).toBeHidden()
  await expect(page.locator('#orders-view')).toBeVisible()
  const prepared = await backup(extension)
  expect(prepared.preparations[0].groups).toHaveLength(52)
  expect(prepared.orders[0].snapshot).toEqual(source)
  await page.close()
})

test('import review cards show photos, source values and arithmetic comparisons in a compact grid; Check all preserves real validation', async ({
  extension,
}) => {
  const { page, file } = await openImport(extension)
  const dialog = page.locator('.store-import-dialog')
  await page.setViewportSize({ width: 1280, height: 960 })
  await file.setInputFiles(reviewWorkbook({ badAmount: true, combined: true }))
  const reviews = dialog.locator('[data-issue-code="photo-shared"]'),
    all = dialog.locator('input[name="allReviews"]'),
    checks = dialog.locator('.store-import-review-check input')
  await expect(reviews).toHaveCount(8)
  await expect(
    reviews.first().locator('.store-import-review-check')
  ).toHaveText('Review')
  await expect(reviews.locator('.store-import-issue-photos img')).toHaveCount(8)
  await expect(reviews.first()).toContainText('Group 1')
  await expect(reviews.first()).toContainText('Rows 2, 3')
  await expect(reviews.first()).toContainText('Ceramic mugs')
  const arithmetic = dialog.locator('[data-issue-code="amount-mismatch"]')
  await expect(
    arithmetic.locator('.store-import-issue-comparison')
  ).toContainText('¥31')
  await expect(
    arithmetic.locator('.store-import-issue-comparison')
  ).toContainText('¥30')
  await expect(arithmetic.locator('.store-import-cells')).toContainText('F2')
  await expect(arithmetic.locator('.store-import-cells')).toContainText('31')
  await expect(
    dialog.locator('.store-import-issue.is-error input')
  ).toHaveCount(0)
  await expect(
    dialog.locator('[data-issue-code="variant-allocation"] input')
  ).toHaveCount(0)
  await expect(dialog.locator('.store-import-checks-status')).toHaveText(
    '0/8 reviews checked · 1 blocking'
  )
  const columns = await dialog
    .locator('.store-import-issues')
    .evaluate(
      (list) => getComputedStyle(list).gridTemplateColumns.split(' ').length
    )
  expect(columns).toBe(3)
  const before = await reviews.first().boundingBox()
  expect(before.height).toBeLessThan(160)
  await checks.nth(0).check()
  await expect(
    reviews.first().locator('.store-import-review-check')
  ).toHaveText('Checked')
  await checks.nth(1).check()
  expect(await all.evaluate((input) => input.indeterminate)).toBe(true)
  await mkdir(new URL('../../work/', import.meta.url), { recursive: true })
  await page.screenshot({ path: 'work/store-import-review-grid.png' })
  await all.check()
  await expect(
    dialog.locator('.store-import-review-check input:checked')
  ).toHaveCount(8)
  await expect(dialog.locator('.store-import-checks-status')).toHaveText(
    '8/8 reviews checked · 1 blocking'
  )
  const after = await reviews.first().boundingBox()
  expect(after.height).toBe(before.height)
  expect(after.width).toBe(before.width)
  await dialog.locator('.popup-language-toggle [data-language="es"]').click()
  await expect(checks).toHaveCount(8)
  await expect(
    dialog.locator('.store-import-review-check input:checked')
  ).toHaveCount(8)
  await expect(dialog.locator('.store-import-checks-status')).toHaveText(
    '8/8 revisiones marcadas · 1 bloqueos'
  )
  await all.uncheck()
  await expect(
    dialog.locator('.store-import-review-check input:checked')
  ).toHaveCount(0)
  await dialog.locator('.popup-language-toggle [data-language="en"]').click()
  await all.check()
  await expect(dialog.locator('input[name="photosReviewed"]')).not.toBeChecked()
  expect(
    await dialog
      .locator('.store-import-allocation input')
      .evaluateAll((inputs) => inputs.map((input) => input.value))
  ).toEqual(['', ''])
  await dialog.locator('input[name="purchaseDate"]').fill('2026-10-20')
  await dialog.locator('input[name="photosReviewed"]').check()
  await dialog
    .getByRole('button', { name: 'Import order', exact: true })
    .click()
  expect((await backup(extension)).orders).toHaveLength(0)
  await expect(dialog).toBeVisible()
  await file.setInputFiles(reviewWorkbook({ combined: true }))
  await expect(dialog.locator('.store-import-issue.is-error')).toHaveCount(0)
  await expect(
    dialog.locator('.store-import-review-check input:checked')
  ).toHaveCount(0)
  await all.check()
  await dialog.locator('input[name="purchaseDate"]').fill('2026-10-20')
  await dialog.locator('input[name="photosReviewed"]').check()
  await dialog
    .getByRole('button', { name: 'Import order', exact: true })
    .click()
  expect((await backup(extension)).orders).toHaveLength(0)
  await expect(dialog.locator('.store-import-status')).toContainText(
    'enter a positive quantity for every variant'
  )
  await page.setViewportSize({ width: 560, height: 820 })
  expect(
    await dialog
      .locator('.store-import-issues')
      .evaluate(
        (list) => getComputedStyle(list).gridTemplateColumns.split(' ').length
      )
  ).toBe(1)
  await dialog
    .getByRole('button', { name: 'Close import', exact: true })
    .click()
  await page.close()
})

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
  await viewer.getByRole('button', { name: 'Edit photo', exact: true }).click()
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
  await expect(details.locator('section.order-charges')).toBeVisible()
  await expect(details.locator('.order-charges summary')).toHaveCount(0)
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

test('editing a repeated import photo in Orders updates its exact order and preserves both original galleries', async ({
  extension,
}) => {
  test.setTimeout(60000)
  const { page, dialog, file } = await openImport(extension)
  const importCopy = async (name, date) => {
    await file.setInputFiles(workbookFile({ name }))
    await expect(dialog.locator('.store-import-product')).toHaveCount(1)
    if (name.includes('(2)'))
      await expect(
        dialog.locator('[data-action="duplicate-import-warning"]')
      ).toContainText('match 1 imported order')
    else
      await expect(
        dialog.locator('[data-action="duplicate-import-warning"]')
      ).toBeHidden()
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
  await assignSelectedPurchaseCodes(page)
  await expect(page.locator('#orders-view')).toBeVisible()
  const secondRow = page.locator(
    `#sheet-body tr[data-selection-key=${JSON.stringify(JSON.stringify(['local', second.snapshot.orderId, second.snapshot.items[0].entryId]))}]`
  )
  await secondRow.getByRole('button', { name: /^Zoom product photo/ }).click()
  const viewer = page.getByRole('dialog', {
    name: 'Product photo',
    exact: true,
  })
  await expect(viewer.locator('.photo-viewport img')).toBeVisible()
  await viewer.getByRole('button', { name: 'Edit photo', exact: true }).click()
  await viewer.getByLabel('Canvas fit', { exact: true }).selectOption('cover')
  await viewer.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(viewer.locator('.photo-viewer-status')).toHaveText(
    'Photo saved. Original preserved.'
  )
  await viewer.getByRole('button', { name: 'Edit photo', exact: true }).click()
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
      `#sheet-body tr[data-selection-key=${JSON.stringify(JSON.stringify(['local', order.snapshot.orderId, item.entryId]))}]`
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
