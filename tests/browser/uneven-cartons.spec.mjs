import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  createPreparation,
  allocatePreparation,
} from '../../src/packing-model.js'
import { validateCartonBatch } from '../../src/carton-batches.js'
import { repeatProductStoreIdentity } from '../../src/repeat-products.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import XLSX from 'xlsx'
import {
  openOrderReconciliation,
  productGridRow,
  createSmartContainer,
  openContainerOutput,
  libraryBackup,
} from './smart-workspace-helpers.mjs'
import { revealCopyActions } from './copy-actions-helpers.mjs'

const cartons = [
  { quantity: '13', len: '60', wid: '50', ht: '40', weight: '16.75' },
  { quantity: '12', len: '60', wid: '50', ht: '40', weight: '14.62' },
  { quantity: '11', len: '50', wid: '43', ht: '36', weight: '10.40' },
  { quantity: '9', len: '48', wid: '37', ht: '27', weight: '5.63' },
  { quantity: '9', len: '48', wid: '37', ht: '27', weight: '5.18' },
  { quantity: '9', len: '48', wid: '37', ht: '27', weight: '4.64' },
]

async function seed(extension) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const snapshot = record.snapshot,
    item = snapshot.items[0]
  snapshot.items = [item]
  snapshot.sellerName = 'Synthetic uneven carton supplier'
  snapshot.sellerMemberLogin = 'synthetic-uneven'
  snapshot.purchasedAt = '2026-10-12T10:15:00+08:00'
  item.title = '合成摆件'
  item.description = 'Synthetic decorative figure'
  item.productNumber = 'SYNTHETIC-UNEVEN'
  item.skuProperties = []
  item.quantity = '63'
  item.price = '1.00'
  item.sourceDiscount = item.allocatedDiscount = item.discount = '0.00'
  snapshot.totals = {
    goodsGross: '63.00',
    shipping: '0.00',
    sourceDiscount: '0.00',
    orderAdjustment: '0.00',
    goodsNet: '63.00',
    payable: '63.00',
  }
  record.notes = ''
  record.tags = []
  record.changedEntryIds = []
  record.removedEntryIds = []
  const preparation = createPreparation(snapshot, '2026-10')
  expect(preparation.groups).toHaveLength(1)
  const [group] = preparation.groups
  expect(group.variants).toHaveLength(1)
  group.baseCode = 'CE26101001'
  group.spanishName = 'FIGURA'
  group.category = '摆件'
  group.sizeMode = 'none'
  Object.assign(group.variants[0], {
    variant: '',
    size: '',
    variantSuffix: '',
    sizeSuffix: '',
    needsSizeMapping: false,
  })
  const allocation = allocatePreparation(
      { ...preparation, revision: 1 },
      [],
      [],
      { snapshot }
    ),
    mark = { orderId: snapshot.orderId, groupId: group.id },
    batches = cartons.map(({ quantity, ...measurements }, index) =>
      validateCartonBatch({
        id: `synthetic-uneven-${index + 1}`,
        accountId: snapshot.accountId,
        storeId: repeatProductStoreIdentity(snapshot),
        month: '2026-10',
        groups: [mark],
        mark,
        cartonNumber: String(index + 1),
        contents: [
          { orderId: snapshot.orderId, entryId: item.entryId, quantity },
        ],
        count: 1,
        ...measurements,
        weightBasis: 'carton',
        received: 1,
        loaded: 0,
        revision: 1,
        updatedAt: '2026-10-15T00:00:00.000Z',
      })
    )
  const restored = await extension.inspector.evaluate(
    ({ record, allocation, batches }) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 4,
          exportedAt: new Date().toISOString(),
          orders: [record],
          preparations: [allocation.preparation],
          allocations: allocation.allocations,
          issuedCodes: allocation.issuedCodes,
          cartonBatches: batches,
          history: [],
          images: [],
        },
      }),
    { record, allocation, batches }
  )
  expect(restored.ok, restored.error).toBe(true)
  return { record, batches }
}

function table(sheet, headerLabel) {
  const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: '',
    }),
    header = rows.find((row) => row.includes(headerLabel)),
    column = (label) => {
      const index = header.indexOf(label)
      expect(index, `Missing ${label} column`).toBeGreaterThanOrEqual(0)
      return index
    },
    cell = (row, label) =>
      sheet[XLSX.utils.encode_cell({ r: rows.indexOf(row), c: column(label) })]
  expect(header, `Missing ${headerLabel} header`).toBeTruthy()
  return { rows, column, cell }
}

test('uneven numbered cartons retain exact supplier measurements through the workspace and actual Excel download', async ({
  extension,
}) => {
  const { record, batches } = await seed(extension),
    page = await extension.context.newPage(),
    ref = {
      accountId: record.snapshot.accountId,
      orderId: record.snapshot.orderId,
    },
    before = await libraryBackup(extension)
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const sourceRow = page.locator('#sheet-body tr[data-selection-key]')
  await expect(sourceRow).toHaveCount(1)
  await sourceRow.getByRole('checkbox').check()
  await revealCopyActions(page)
  await page.locator('#copy-carton-marks').click()
  const artwork = page.locator('.image-copy-dialog')
  await expect(artwork.locator('figcaption .ce-code')).toHaveText([
    'CE26101001',
  ])
  await expect(artwork.locator('.copy-preview img')).toHaveCount(1)
  await expect
    .poll(() =>
      artwork
        .locator('.copy-preview img')
        .evaluateAll((images) =>
          images.every((image) => image.complete && image.naturalWidth > 0)
        )
    )
    .toBe(true)
  await artwork.getByRole('button', { name: 'Done', exact: true }).click()
  const grid = await openOrderReconciliation(page, ref),
    product = productGridRow(grid, {
      ...ref,
      entryId: record.snapshot.items[0].entryId,
    })
  await expect(product.locator('[data-grid-column="capacity"]')).toBeEditable()
  await expect(product.locator('.pattern-readout')).toHaveText(
    '1 × 13 + 1 × 12 + 1 × 11 + 1 × 9 + 1 × 9 + 1 × 9'
  )
  await grid.locator('[data-action="reconciliation-cartons"]').click()
  const physicalRows = grid.locator('tbody tr[data-grid-key]')
  await expect(physicalRows).toHaveCount(6)
  for (const [index, carton] of cartons.entries()) {
    const row = physicalRows.nth(index)
    await expect(row.locator('[data-column="label"]')).toHaveText(
      String(index + 1)
    )
    await expect(row.locator('[data-column="contents"]')).toHaveText(
      `${record.snapshot.items[0].entryId}: ${carton.quantity}`
    )
    await expect(row.locator('[data-grid-column="dimensions"]')).toHaveValue(
      `${carton.len}×${carton.wid}×${carton.ht}`
    )
    await expect(row.locator('[data-grid-column="weight"]')).toHaveValue(
      carton.weight
    )
    await expect(row.locator('[data-column="count"]')).toHaveText('1')
  }
  await physicalRows.first().focus()
  await physicalRows.first().press('Enter')
  const editor = page.locator('dialog[data-action="inspect-order-carton"]')
  await expect(editor).toBeVisible()
  await expect(
    editor.getByRole('textbox', { name: 'Dimensions (cm)', exact: true })
  ).toHaveValue('60×50×40')
  await expect(
    editor.getByRole('textbox', { name: 'Weight (kg)', exact: true })
  ).toHaveValue('16.75')
  await expect(editor).toContainText(`${record.snapshot.items[0].entryId}: 13`)
  await mkdir('work', { recursive: true })
  await page.screenshot({ path: 'work/uneven-cartons-editor.png' })
  await editor.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(editor).toHaveCount(0)
  // Receipts and the old source loading confirmation remain their own ledger.
  const sourceBeforeLoading = await libraryBackup(extension)
  expect(sourceBeforeLoading.orders).toEqual(before.orders)
  expect(sourceBeforeLoading.cartonBatches).toEqual(before.cartonBatches)
  expect(
    sourceBeforeLoading.cartonBatches.map(({ received, loaded }) => ({
      received,
      loaded,
    }))
  ).toEqual(cartons.map(() => ({ received: 1, loaded: 0 })))
  const containerId = await createSmartContainer(extension, [ref])
  await extension.inspector.evaluate(
    async ({ id, ref }) => {
      const repository = await window.testRepository,
        view = await repository.getContainerView({ id })
      await repository.markContainerLoaded({
        id,
        orderRefs: [ref],
        expectedRevision: view.container.revision,
        intentId: crypto.randomUUID(),
      })
    },
    { id: containerId, ref }
  )
  const packing = await openContainerOutput(page, containerId)
  await expect(packing.locator('[data-grid-column="capacity"]')).toHaveCount(0)

  await packing.locator('[data-action="export-packing-list"]').click()
  const exportDialog = page.locator('.packing-export-dialog')
  await expect(exportDialog).toBeVisible()
  await exportDialog.locator('button[data-language="en"]').click()
  await exportDialog.locator('[data-action="download-packing-list"]').click()
  let downloaded
  await expect
    .poll(async () => {
      const files = await extension.inspector.evaluate(() =>
        chrome.downloads.search({})
      )
      downloaded = files.filter(
        (file) => file.filename.endsWith('.xlsx') && file.state === 'complete'
      )
      return downloaded.length
    })
    .toBe(1)
  const bytes = await readFile(downloaded[0].filename)
  await writeFile('work/uneven-cartons-synthetic.xlsx', bytes)
  const workbook = XLSX.read(bytes, { type: 'buffer' })
  expect(workbook.SheetNames).toEqual(['Packing list', 'Cartons', 'Se quedó'])
  const products = table(workbook.Sheets['Packing list'], 'Code'),
    physical = table(workbook.Sheets.Cartons, 'Batch'),
    productRows = products.rows.filter(
      (row) => row[products.column('Code')] === 'CE26101001'
    ),
    cartonRows = physical.rows.filter((row) =>
      /^#[1-6]$/.test(row[physical.column('Batch')])
    ),
    total = physical.rows.find(
      (row) => row[physical.column('Batch')] === 'Totals'
    )
  expect(productRows).toHaveLength(1)
  expect(productRows[0][products.column('Qty')]).toBe(63)
  expect(productRows[0][products.column('Subtotal 元')]).toBe(63)
  expect(productRows[0][products.column('Pcs/box')]).toBe('Uneven')
  const references = productRows[0][products.column('Cartons')]
  for (let number = 1; number <= 6; number++)
    expect(references).toContain(`#${number}`)
  expect(references).toBe(
    '#1, #2, #3, #4, #5, #6\n3 × 9 + 1 × 11 + 1 × 12 + 1 × 13'
  )
  expect(cartonRows).toHaveLength(6)
  expect(cartonRows.map((row) => row[physical.column('Batch')])).toEqual([
    '#1',
    '#2',
    '#3',
    '#4',
    '#5',
    '#6',
  ])
  for (const [index, row] of cartonRows.entries()) {
    const expected = cartons[index]
    expect(row[physical.column('Contents')]).toContain(
      `CE26101001 × ${expected.quantity}`
    )
    for (const [header, number] of Object.entries({
      Cartons: 1,
      Loaded: 1,
      'L · cm': Number(expected.len),
      'W · cm': Number(expected.wid),
      'H · cm': Number(expected.ht),
      'Weight kg': Number(expected.weight),
      'Total kg': Number(expected.weight),
      'Loaded kg': Number(expected.weight),
    })) {
      const cell = physical.cell(row, header)
      expect(cell.t, `${row[0]} ${header} must remain numeric`).toBe('n')
      expect(cell.v).toBe(number)
    }
    expect(physical.cell(row, 'm³/box').v).toBeCloseTo(
      (Number(expected.len) * Number(expected.wid) * Number(expected.ht)) /
        1_000_000,
      12
    )
    expect(physical.cell(row, 'm³/box').f).toContain('/1000000')
    expect(physical.cell(row, 'Loaded m³').v).toBeCloseTo(
      (Number(expected.len) * Number(expected.wid) * Number(expected.ht)) /
        1_000_000,
      12
    )
    expect(row[physical.column('Received')]).toBe('')
  }
  expect(physical.cell(total, 'Cartons').v).toBe(6)
  expect(total[physical.column('Received')]).toBe('')
  expect(physical.cell(total, 'Loaded').v).toBe(6)
  expect(physical.cell(total, 'Total kg').v).toBeCloseTo(57.22, 10)
  expect(physical.cell(total, 'Total m³').v).toBeCloseTo(0.461256, 12)
  for (const [header, expected] of [
    ['Loaded', 6],
    ['Loaded kg', 57.22],
    ['Loaded m³', 0.461256],
  ]) {
    const cell = physical.cell(total, header)
    expect(cell.t).toBe('n')
    expect(cell.v).toBeCloseTo(expected, 12)
    expect(cell.v).not.toBe('')
  }
  const after = await libraryBackup(extension)
  expect(after.orders).toEqual(before.orders)
  expect(after.cartonBatches).toEqual(before.cartonBatches)
  expect(
    after.cartonBatches.map(({ received, loaded }) => ({ received, loaded }))
  ).toEqual(cartons.map(() => ({ received: 1, loaded: 0 })))
  expect(after.cartonBatches.map(({ id }) => id)).toEqual(
    batches.map(({ id }) => id)
  )
  const archive = XLSX.CFB.read(bytes, { type: 'buffer' })
  expect(
    archive.FullPaths.filter((path) =>
      /\/xl\/media\/.+\.(png|jpe?g)$/.test(path)
    ).length
  ).toBeGreaterThan(0)
  for (const sheet of Object.values(workbook.Sheets))
    expect(Object.values(sheet).filter((cell) => cell?.t === 'e')).toEqual([])
  expect(extension.unexpectedRequests).toEqual([])
})
