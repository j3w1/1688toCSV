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
  const { batches } = await seed(extension),
    page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const sourceRow = page.locator('#sheet-body tr[data-selection-key]')
  await expect(sourceRow).toHaveCount(1)
  await expect(
    sourceRow.getByRole('button', { name: 'Pcs/box', exact: true })
  ).toHaveText('Varies')
  await page.locator('#view-packing').click()
  const packing = page.locator('#packing-view')
  await expect(packing).toBeVisible()
  await expect(packing.locator('.preparation-group')).toHaveCount(1)
  await expect(packing.locator('.variants tbody tr')).toHaveCount(1)
  await expect(
    packing.getByRole('button', { name: 'Pcs/box', exact: true })
  ).toHaveText('Varies')
  await expect(packing.locator('.packing-carton-chip')).toHaveCount(6)
  await expect(packing.locator('.packing-group-cartons')).toContainText(
    '6 batches · 6 cartons'
  )
  for (const [index, carton] of cartons.entries())
    await expect(
      packing.locator('.packing-carton-chip').nth(index)
    ).toContainText(`#${index + 1} · ${carton.quantity}`)
  await packing.locator('.packing-group-cartons-edit').click()
  const editor = page.getByRole('dialog', {
    name: 'Carton batches',
    exact: true,
  })
  await expect(editor).toBeVisible()
  await expect(editor.locator('.carton-batch-card')).toHaveCount(6)
  await editor.locator(`[data-batch-id="${batches[0].id}"]`).click()
  for (const [name, expected] of Object.entries({
    cartonNumber: '1',
    len: '60',
    wid: '50',
    ht: '40',
    weight: '16.75',
    count: '1',
    received: '1',
    loaded: '0',
  }))
    await expect(editor.locator(`input[name="${name}"]`)).toHaveValue(expected)
  await expect(editor.locator('.carton-batch-quantity input')).toHaveValue('13')
  await expect(editor.locator('.carton-batch-summary')).toContainText('0.12 m³')
  await expect(editor.locator('.carton-batch-summary')).toContainText(
    '16.75 kg'
  )
  await expect(
    editor.getByRole('img', { name: 'Carton mark CE26101001', exact: true })
  ).toBeVisible()
  await expect
    .poll(() =>
      editor
        .locator('img')
        .evaluateAll((images) =>
          images.every((image) => image.complete && image.naturalWidth > 0)
        )
    )
    .toBe(true)
  await mkdir('work', { recursive: true })
  await page.screenshot({ path: 'work/uneven-cartons-editor.png' })
  await editor.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(editor).toHaveCount(0)

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
  expect(workbook.SheetNames).toEqual(['Products', 'Cartons'])
  const products = table(workbook.Sheets.Products, 'Code'),
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
  expect(productRows[0][products.column('Pcs/box')]).toBe('Varies')
  expect(productRows[0][products.column('Cartons')]).toBe(
    '6 cartons · #1, #2, #3, #4, #5, #6'
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
      Received: 1,
      Loaded: 0,
      'L · cm': Number(expected.len),
      'W · cm': Number(expected.wid),
      'H · cm': Number(expected.ht),
      'Weight kg': Number(expected.weight),
      'Total kg': Number(expected.weight),
      'Loaded kg': 0,
      'Loaded m³': 0,
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
  }
  expect(physical.cell(total, 'Cartons').v).toBe(6)
  expect(physical.cell(total, 'Received').v).toBe(6)
  expect(physical.cell(total, 'Loaded').v).toBe(0)
  expect(physical.cell(total, 'Total kg').v).toBeCloseTo(57.22, 10)
  expect(physical.cell(total, 'Total m³').v).toBeCloseTo(0.461256, 12)
  for (const header of ['Loaded', 'Loaded kg', 'Loaded m³']) {
    const cell = physical.cell(total, header)
    expect(cell.t).toBe('n')
    expect(cell.v).toBe(0)
    expect(cell.v).not.toBe('')
  }
  for (const sheet of Object.values(workbook.Sheets))
    expect(Object.values(sheet).filter((cell) => cell?.t === 'e')).toEqual([])
  expect(extension.unexpectedRequests).toEqual([])
})
