import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  createPreparation,
  allocatePreparation,
} from '../../src/packing-model.js'
import { readFile, writeFile } from 'node:fs/promises'
import XLSX from 'xlsx'

async function seed(
  extension,
  { prepared = true, defaults, crossCode = false } = {}
) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const order = record.snapshot
  order.sellerName = 'Synthetic shared-carton supplier'
  order.sellerMemberLogin = 'synthetic-carton-batch-ui'
  order.purchasedAt = '2026-10-12T10:15:00+08:00'
  for (const [index, item] of order.items.entries()) {
    item.title = '合成毛绒玩具'
    item.description = `合成毛绒玩具\n尺寸：${['S', 'M', 'L'][index]}`
    item.productNumber = 'SYNTHETIC-PLUSH'
    item.skuProperties = [{ label: '尺寸', value: ['S', 'M', 'L'][index] }]
    item.quantity = String([3, 30, 30][index])
    item.price = '1.00'
    item.sourceDiscount = item.allocatedDiscount = item.discount = '0.00'
  }
  Object.assign(order.totals, {
    goodsGross: '63.00',
    sourceDiscount: '0.00',
    goodsNet: '63.00',
    payable: '63.00',
  })
  if (defaults) {
    record.cartonDetails = { [order.items[0].entryId]: defaults }
    record.cartonDetailsUpdatedAt = order.observedAt
  }
  const preparation = createPreparation(order, '2026-10')
  preparation.groups[0].baseCode = 'CE26101001'
  preparation.groups[0].spanishName = 'PELUCHE'
  preparation.groups[0].category = '毛绒玩具'
  for (const [index, variant] of preparation.groups[0].variants.entries()) {
    variant.variantSuffix = ''
    variant.sizeSuffix = ['S', 'M', 'L'][index]
    variant.needsSizeMapping = false
  }
  if (crossCode) {
    const original = preparation.groups[0],
      variant = original.variants.pop()
    preparation.groups.push({
      ...structuredClone(original),
      id: crypto.randomUUID(),
      baseCode: 'CE26101002',
      variants: [variant],
    })
  }
  const allocation = prepared
    ? allocatePreparation({ ...preparation, revision: 1 }, [], [], {
        snapshot: order,
      })
    : { preparations: [], allocations: [], issuedCodes: [] }
  const restored = await extension.inspector.evaluate(
    ({ record, allocation, prepared }) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 4,
          exportedAt: new Date().toISOString(),
          orders: [record],
          preparations: prepared ? [allocation.preparation] : [],
          allocations: allocation.allocations,
          issuedCodes: allocation.issuedCodes,
          cartonBatches: [],
          history: [],
          images: [],
        },
      }),
    { record, allocation, prepared }
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(3)
  return { page, rows, record }
}
async function backup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}
async function openPacking(page, groups = 1) {
  await page.locator('#view-packing').click()
  const packing = page.locator('#packing-view')
  await expect(packing).toBeVisible()
  await expect(packing.locator('.packing-group-cartons-edit')).toHaveCount(
    groups
  )
  return packing
}
async function openBatches(packing, page) {
  await packing.locator('.packing-group-cartons-edit').click()
  const dialog = page.getByRole('dialog', {
    name: 'Carton batches',
    exact: true,
  })
  await expect(dialog).toBeVisible()
  return dialog
}
const value = (dialog, key) => dialog.locator(`input[name="${key}"]`)
async function pasteDimensions(input, text) {
  await input.evaluate((input, text) => {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    input.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    )
  }, text)
}

test('group carton editor saves S/M/L in one six-carton batch and exports each physical total once', async ({
  extension,
}) => {
  const { page, rows, record } = await seed(extension),
    packing = await openPacking(page),
    dialog = await openBatches(packing, page)
  await expect(dialog.locator('.carton-batch-group-code')).toHaveText(
    'CE26101001'
  )
  await expect(
    dialog.locator('.carton-batch-group-code [data-code-part="product"]')
  ).toHaveText('1001')
  await expect(dialog.locator('.carton-batch-product .ce-code')).toHaveText([
    'CE26101001S',
    'CE26101001M',
    'CE26101001L',
  ])
  await expect(
    dialog.locator('.carton-batch-product .ce-code [data-code-part="product"]')
  ).toHaveCount(3)
  await expect(
    dialog.locator('input[name="cbm"], input[name="suppliedCbm"]')
  ).toHaveCount(0)
  await expect(
    dialog.locator('.carton-batch-product[data-selected="true"]')
  ).toHaveCount(3)
  await dialog.getByRole('button', { name: 'Batch', exact: true }).click()
  await value(dialog, 'count').fill('6')
  await value(dialog, 'weight').fill('9,5367')
  await pasteDimensions(value(dialog, 'len'), '40 × 30 × 25')
  await expect(value(dialog, 'wid')).toHaveValue('30')
  expect((await backup(extension)).cartonBatches).toHaveLength(0)
  await dialog
    .getByRole('button', { name: 'Apply carton contents', exact: true })
    .click()
  await expect(dialog.locator('.carton-batch-status')).toHaveText('Saved')
  const saved = await backup(extension),
    batch = saved.cartonBatches[0]
  expect(saved.cartonBatches).toHaveLength(1)
  expect(batch).toMatchObject({
    count: 6,
    len: '40',
    wid: '30',
    ht: '25',
    weight: '9.5367',
    month: '2026-10',
  })
  expect(batch.contents).toEqual(
    record.snapshot.items.map((item) => ({
      orderId: record.snapshot.orderId,
      entryId: item.entryId,
      quantity: item.quantity,
    }))
  )
  expect(batch).not.toHaveProperty('unitsPerCarton')
  expect(await dialog.locator('.carton-batch-summary').textContent()).toContain(
    '0.18 m³'
  )
  expect(await dialog.locator('.carton-batch-summary').textContent()).toContain(
    '57.2202 kg'
  )
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(packing.locator('.packing-group-cartons')).toContainText(
    '6 recorded cartons'
  )
  await expect(
    packing.locator('.variant-measurement-cell input[name="cbm"]')
  ).toHaveCount(0)

  await packing.locator('[data-action="export-packing-list"]').click()
  const exportDialog = page.locator('.packing-export-dialog')
  await expect(exportDialog).toBeVisible()
  await exportDialog.locator('[data-action="download-packing-list"]').click()
  let files
  await expect
    .poll(async () => {
      files = await extension.inspector.evaluate(() =>
        chrome.downloads.search({})
      )
      return files.filter(
        (file) => file.filename.endsWith('.xlsx') && file.state === 'complete'
      ).length
    })
    .toBe(1)
  const bytes = await readFile(
      files.find((file) => file.filename.endsWith('.xlsx')).filename
    ),
    workbook = XLSX.read(bytes, { type: 'buffer' }),
    products = workbook.Sheets.Products,
    cartons = workbook.Sheets.Cartons,
    productRows = XLSX.utils.sheet_to_json(products, { header: 1 }),
    cartonRows = XLSX.utils.sheet_to_json(cartons, { header: 1 })
  await writeFile('work/shared-cartons-synthetic.xlsx', bytes)
  expect(workbook.SheetNames).toEqual(['Products', 'Cartons'])
  for (const code of ['CE26101001S', 'CE26101001M', 'CE26101001L'])
    expect(productRows.flat()).toContain(code)
  const productHeader = productRows.find(
      (row) => row.includes('Cartons') && row.includes('Code')
    ),
    refColumn = productHeader.indexOf('Cartons'),
    markedProducts = productRows.filter((row) =>
      /^CE26101001[SML]$/.test(row[productHeader.indexOf('Code')])
    )
  expect(markedProducts).toHaveLength(3)
  expect(markedProducts.map((row) => row[refColumn])).toEqual([
    'Shared · Batch · 6 cartons · C001',
    'Shared · Batch · 6 cartons · C001',
    'Shared · Batch · 6 cartons · C001',
  ])
  const physicalRows = cartonRows.filter((row) => row[0] === 'C001')
  expect(physicalRows).toHaveLength(1)
  expect(physicalRows[0].join(' ')).toContain('CE26101001S × 3')
  expect(physicalRows[0].join(' ')).toContain('CE26101001M × 30')
  expect(physicalRows[0].join(' ')).toContain('CE26101001L × 30')
  for (const column of [refColumn, productHeader.indexOf('Carton mark')]) {
    expect(column).toBeGreaterThanOrEqual(0)
    expect(
      markedProducts.map((row) => {
        const rowNumber = productRows.indexOf(row)
        return products[XLSX.utils.encode_cell({ r: rowNumber, c: column })]?.l
          ?.Target
      })
    ).toEqual(Array(3).fill(expect.stringContaining('Cartons')))
  }
  expect(
    Object.values(cartons).some(
      (cell) => typeof cell?.f === 'string' && cell.f.includes('1000000')
    )
  ).toBe(true)
  await page.locator('#view-orders').click()
  await rows.first().locator('.product-title').dblclick()
  const details = page.getByRole('dialog', {
    name: 'Original product details',
    exact: true,
  })
  await expect(details.locator('.product-carton-batch-context')).toContainText(
    'CE26101001'
  )
  await details
    .getByRole('button', { name: 'Edit cartons', exact: true })
    .click()
  await expect(
    page.getByRole('dialog', { name: 'Carton batches', exact: true })
  ).toBeVisible()
})

test('unprepared product carton defaults paste and autosave through compact controls; close flushes the final edit', async ({
  extension,
}) => {
  const { page, rows, record } = await seed(extension, {
    prepared: false,
    defaults: { kg: '0', cbm: '0.2' },
  })
  await expect(
    rows.first().getByRole('textbox', { name: 'Volume (m³/box)', exact: true })
  ).toHaveCount(0)
  await rows
    .first()
    .getByRole('button', { name: 'Edit carton dimensions', exact: true })
    .click()
  const dialog = page.getByRole('dialog', {
      name: 'Original product details',
      exact: true,
    }),
    panel = dialog.locator('.product-carton-details')
  await expect(panel.locator('details, input[name="cbm"]')).toHaveCount(0)
  await expect(panel.locator('.product-carton-supplied')).toContainText(
    '0.2 m³'
  )
  await pasteDimensions(value(panel, 'len'), '40,5 × 30 × 25')
  await expect(panel.locator('.product-carton-volume-value')).toHaveText(
    '0.030375'
  )
  await expect(panel.locator('.product-carton-status')).toHaveText('Saved')
  await value(panel, 'kg').fill('1,23456789123456789')
  await dialog
    .getByRole('button', { name: 'Close product details', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  expect(
    (await backup(extension)).orders[0].cartonDetails[
      record.snapshot.items[0].entryId
    ]
  ).toEqual({
    kg: '1.23456789123456789',
    cbm: '0.2',
    len: '40.5',
    wid: '30',
    ht: '25',
  })
  await page.reload()
  await rows
    .first()
    .getByRole('button', { name: 'Edit carton dimensions', exact: true })
    .click()
  await expect(
    value(page.locator('.product-carton-details'), 'kg')
  ).toHaveValue('1.23456789123456789')
  const geometry = await panel.locator('.product-carton-geometry').boundingBox()
  for (const key of ['len', 'wid', 'ht']) {
    const bounds = await value(panel, key).boundingBox()
    expect(bounds.width).toBeGreaterThanOrEqual(50)
    expect(bounds.width).toBeLessThanOrEqual(80)
    expect(bounds.height).toBeGreaterThanOrEqual(30)
    expect(bounds.height).toBeLessThanOrEqual(34)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(
      geometry.y + geometry.height + 1
    )
  }
  expect(
    await panel
      .locator('form')
      .evaluate((node) => node.scrollWidth - node.clientWidth)
  ).toBeLessThanOrEqual(1)
})

test('batch editor flushes a final dimension edit on close and keeps compact geometry at wide and narrow widths', async ({
  extension,
}) => {
  const { page } = await seed(extension),
    packing = await openPacking(page)
  let dialog = await openBatches(packing, page)
  await dialog.getByRole('button', { name: 'Batch', exact: true }).click()
  await value(dialog, 'count').fill('6')
  await pasteDimensions(value(dialog, 'len'), '40 × 30 × 25')
  await dialog
    .getByRole('button', { name: 'Apply carton contents', exact: true })
    .click()
  await expect(dialog.locator('.carton-batch-status')).toHaveText('Saved')
  await value(dialog, 'ht').fill('26,125')
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect((await backup(extension)).cartonBatches[0].ht).toBe('26.125')
  dialog = await openBatches(packing, page)
  for (const width of [1440, 1000, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const bounds = await dialog.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    expect(
      await dialog.evaluate((node) => node.scrollWidth - node.clientWidth)
    ).toBeLessThanOrEqual(1)
    await expect(
      dialog.getByRole('button', { name: 'Done', exact: true })
    ).toBeInViewport()
    for (const key of ['len', 'wid', 'ht']) {
      const inputBounds = await value(dialog, key).boundingBox()
      expect(inputBounds.width).toBeLessThanOrEqual(80)
      expect(inputBounds.height).toBeLessThanOrEqual(34)
    }
  }
})

test('numbered cartons keep exact cross-code contents and an independent mark, while Another carton copies only dimensions and mark', async ({
  extension,
}) => {
  const { page, record } = await seed(extension, { crossCode: true }),
    packing = await openPacking(page, 2)
  await packing.locator('.packing-group-cartons-edit').first().click()
  const dialog = page.getByRole('dialog', {
      name: 'Carton batches',
      exact: true,
    }),
    [small, medium, large] = record.snapshot.items,
    product = (entryId) =>
      dialog.locator(`.carton-batch-product[data-entry-id="${entryId}"]`)
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Exact carton', exact: true })
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(value(dialog, 'cartonNumber')).toHaveValue('1')
  await expect(value(dialog, 'count')).toBeHidden()
  await expect(product(small.entryId).getByRole('checkbox')).toBeChecked()
  await expect(product(medium.entryId).getByRole('checkbox')).toBeChecked()
  await expect(product(large.entryId).getByRole('checkbox')).not.toBeChecked()
  await product(medium.entryId).getByRole('checkbox').uncheck()
  await product(small.entryId).locator('.carton-batch-quantity input').fill('2')
  await value(dialog, 'cartonNumber').fill('001')
  await value(dialog, 'weight').fill('9,53')
  await pasteDimensions(value(dialog, 'len'), '40 × 30 × 25')
  await dialog
    .getByRole('button', { name: 'Use carton mark CE26101002', exact: true })
    .click()
  await dialog
    .getByRole('button', { name: 'Apply carton contents', exact: true })
    .click()
  await expect(dialog.locator('.carton-batch-status')).toHaveText('Saved')
  let saved = await backup(extension)
  const first = saved.cartonBatches[0],
    secondGroup = saved.preparations[0].groups.find(
      (group) => group.baseCode === 'CE26101002'
    ),
    firstGroup = saved.preparations[0].groups.find(
      (group) => group.baseCode === 'CE26101001'
    )
  expect(first).toMatchObject({
    cartonNumber: '001',
    count: 1,
    weight: '9.53',
    len: '40',
    wid: '30',
    ht: '25',
  })
  expect(first.contents).toEqual([
    { orderId: record.snapshot.orderId, entryId: small.entryId, quantity: '2' },
  ])
  expect(first.groups).toEqual([
    { orderId: record.snapshot.orderId, groupId: firstGroup.id },
  ])
  expect(first.mark).toEqual({
    orderId: record.snapshot.orderId,
    groupId: secondGroup.id,
  })
  await dialog
    .getByRole('button', { name: 'Another carton', exact: true })
    .click()
  await expect(value(dialog, 'cartonNumber')).toHaveValue('2')
  for (const [key, text] of [
    ['len', '40'],
    ['wid', '30'],
    ['ht', '25'],
  ])
    await expect(value(dialog, key)).toHaveValue(text)
  for (const key of ['weight', 'received', 'loaded'])
    await expect(value(dialog, key)).toHaveValue('')
  await expect(
    dialog.locator('.carton-batch-product[data-selected="true"]')
  ).toHaveCount(0)
  await expect(
    dialog.getByRole('button', {
      name: 'Use carton mark CE26101002',
      exact: true,
    })
  ).toHaveAttribute('aria-pressed', 'true')
  await product(medium.entryId).getByRole('checkbox').check()
  await product(medium.entryId)
    .locator('.carton-batch-quantity input')
    .fill('3')
  await product(large.entryId).getByRole('checkbox').check()
  await product(large.entryId).locator('.carton-batch-quantity input').fill('8')
  await value(dialog, 'weight').fill('11.25')
  const tile = product(large.entryId).locator('.photo-copy-tile'),
    copy = tile.locator('.photo-copy-button')
  await page.mouse.move(1, 1)
  await expect(copy).toHaveCSS('opacity', '0')
  await tile.hover()
  await expect
    .poll(() => copy.evaluate((node) => Number(getComputedStyle(node).opacity)))
    .toBeGreaterThan(0)
  const frame = await tile.locator('.photo-copy-source').boundingBox(),
    copyBounds = await copy.boundingBox()
  expect(Math.abs(copyBounds.y - frame.y - 2)).toBeLessThanOrEqual(1)
  expect(
    Math.abs(frame.x + frame.width - copyBounds.x - copyBounds.width - 2)
  ).toBeLessThanOrEqual(1)
  expect(await copy.evaluate((node) => node.closest('label') === null)).toBe(
    true
  )
  await dialog
    .getByRole('button', { name: 'Apply carton contents', exact: true })
    .click()
  await expect(dialog.locator('.carton-batch-status')).toHaveText('Saved')
  saved = await backup(extension)
  expect(saved.cartonBatches).toHaveLength(2)
  const second = saved.cartonBatches.find((batch) => batch.cartonNumber === '2')
  expect(second).toMatchObject({
    count: 1,
    weight: '11.25',
    received: null,
    loaded: null,
  })
  expect(second.contents).toEqual([
    {
      orderId: record.snapshot.orderId,
      entryId: medium.entryId,
      quantity: '3',
    },
    { orderId: record.snapshot.orderId, entryId: large.entryId, quantity: '8' },
  ])
  expect(second.groups).toHaveLength(2)
  expect(second.mark).toEqual(first.mark)
  expect(
    await dialog.locator('.carton-batch-summary').textContent()
  ).not.toMatch(/average|Batch volume/i)
  await dialog
    .getByRole('button', { name: 'Another carton', exact: true })
    .click()
  await expect(value(dialog, 'cartonNumber')).toHaveValue('3')
  await product(small.entryId).getByRole('checkbox').check()
  await expect(
    product(small.entryId).locator('.carton-batch-quantity input')
  ).toHaveValue('1')
  await value(dialog, 'weight').fill('5.25')
  await dialog
    .getByRole('button', { name: 'Apply carton contents', exact: true })
    .click()
  await expect(dialog.locator('.carton-batch-status')).toHaveText('Saved')
  saved = await backup(extension)
  expect(saved.cartonBatches).toHaveLength(3)
  const sameProductCartons = saved.cartonBatches.filter((batch) =>
    batch.contents.some((entry) => entry.entryId === small.entryId)
  )
  expect(
    sameProductCartons.map((batch) => batch.contents[0].quantity).sort()
  ).toEqual(['1', '2'])
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const smallPacking = packing.locator(
    `.variant-numeric-row[data-entry-id="${small.entryId}"]`
  )
  await expect(
    smallPacking.getByRole('spinbutton', { name: 'Pcs/box', exact: true })
  ).toBeEditable()
  await expect(
    smallPacking.getByRole('button', { name: 'Recorded cartons', exact: true })
  ).toHaveText('Varies · 2 recorded cartons')
  await page.locator('#view-orders').click()
  const smallSource = page
    .locator(`#sheet-body tr[data-selection-key]`)
    .filter({
      has: page.locator(`.row-code-copy`, { hasText: 'CE26101001S' }),
    })
  await expect(
    smallSource.getByRole('spinbutton', { name: 'Pcs/box', exact: true })
  ).toBeEditable()
  await expect(
    smallSource.getByRole('button', { name: 'Recorded cartons', exact: true })
  ).toHaveText('Varies · 2 recorded cartons')
  await page.locator('#view-packing').click()
  await packing.getByRole('button', { name: 'Select all', exact: true }).click()
  await packing.locator('[data-action="open-print-menu"]').click()
  await packing.locator('[data-action="print-carton-marks"]').click()
  const print = page.getByRole('dialog', {
    name: 'Print carton marks',
    exact: true,
  })
  const quantities = print.getByLabel(/^Quantity for /)
  await expect(quantities).toHaveCount(1)
  await expect(quantities).toHaveAccessibleName('Quantity for CE26101002')
  await expect(quantities).toHaveValue('3')
})
