import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  createPreparation,
  allocatePreparation,
} from '../../src/packing-model.js'
import { readFile, writeFile } from 'node:fs/promises'
import XLSX from 'xlsx'
import {
  openOrderReconciliation,
  realOrderContext,
  createContainerThroughUI,
  sealContainerThroughUI,
  assignSelectedPurchaseCodes,
} from './smart-workspace-helpers.mjs'

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
const refFor = (record) => ({
  accountId: record.accountId || record.snapshot.accountId || 'local',
  orderId: record.snapshot.orderId,
})
async function physicalFixture(extension, record, specifications) {
  return extension.inspector.evaluate(
    async ({ ref, specifications }) => {
      const repository = await window.testRepository,
        context = await repository.getOrderReconciliation(ref),
        draft = window.testPlanner.createReconciliationDraft(context),
        groups = context.preparation.groups
      draft.cartons = specifications.map((entry, index) => ({
        id: `synthetic-physical-${index}`,
        ...ref,
        count: 1,
        packingBasis: 'exact',
        labelOrigin: 'reported',
        cartonNumber: String(index + 1),
        len: '',
        wid: '',
        ht: '',
        weight: '',
        weightBasis: 'carton',
        suppliedCbm: '',
        volumeBasis: 'carton',
        received: null,
        loaded: null,
        draftKind: 'manual',
        provenance: {
          kind: 'manual-confirmed',
          source: 'Synthetic physical fixture',
        },
        ...entry,
        contents: entry.contents.map(({ item, quantity }) => ({
          orderId: ref.orderId,
          entryId: context.record.snapshot.items[item].entryId,
          quantity,
        })),
        groups: [
          ...new Set(
            entry.contents.map(
              ({ item }) =>
                groups.find((group) =>
                  group.variants.some((variant) =>
                    variant.entryIds.includes(
                      context.record.snapshot.items[item].entryId
                    )
                  )
                ).id
            )
          ),
        ].map((groupId) => ({ orderId: ref.orderId, groupId })),
        mark: {
          orderId: ref.orderId,
          groupId: groups[entry.markIndex || 0].id,
        },
      }))
      await repository.confirmOrderCartons({
        ...ref,
        draft,
        expectedRevisions: context.revisions,
        intentId: crypto.randomUUID(),
      })
      return repository.getOrderReconciliation(ref)
    },
    { ref: refFor(record), specifications }
  )
}
const aggregate = () => ({
  count: 6,
  packingBasis: 'aggregate',
  cartonNumber: 'C001',
  len: '40',
  wid: '30',
  ht: '25',
  weight: '9.5367',
  contents: [
    { item: 0, quantity: '3' },
    { item: 1, quantity: '30' },
    { item: 2, quantity: '30' },
  ],
})
const row = (grid, id = 'synthetic-physical-0') =>
  grid.locator(`tr[data-grid-key="${id}"]`)
async function stage(grid, column, value, id) {
  const input = row(grid, id).locator(`[data-grid-column="${column}"]`)
  await input.fill(value)
  await input.blur()
}

test('confirmed six-carton aggregate retains S/M/L source totals, truthful unknown per-box contents and once-only physical export totals', async ({
  extension,
}) => {
  const { page, record } = await seed(extension),
    ref = refFor(record),
    context = await physicalFixture(extension, record, [aggregate()]),
    batch = context.batches[0]
  let grid = await openOrderReconciliation(page, ref)
  await expect(grid.locator('[data-column="pattern"]').first()).toContainText(
    'per-carton contents unknown'
  )
  await expect(grid.locator('[data-column="code"] .ce-code')).toHaveText([
    'CE26101001S',
    'CE26101001M',
    'CE26101001L',
  ])
  await grid.locator('[data-action="reconciliation-cartons"]').click()
  await expect(row(grid).locator('[data-column="count"]')).toContainText('6')
  await expect(grid.locator('.reconciliation-summary')).toContainText('57.2202')
  await expect(grid.locator('.reconciliation-summary')).toContainText('0.18')
  expect(batch.contents).toEqual(
    record.snapshot.items.map((item) => ({
      orderId: ref.orderId,
      entryId: item.entryId,
      quantity: item.quantity,
    }))
  )
  expect(batch).not.toHaveProperty('unitsPerCarton')
  const id = await createContainerThroughUI(
    page,
    [ref],
    'Synthetic six-carton aggregate'
  )
  await sealContainerThroughUI(page)
  const manifest = await extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerManifest({ id }),
    id
  )
  expect(manifest.cartons).toHaveLength(6)
  expect(new Set(manifest.cartons.map((carton) => carton.id)).size).toBe(6)
  expect(
    manifest.cartons.every(
      (carton) => carton.contents === null || !carton.contents?.length
    )
  ).toBe(true)
  expect(manifest.products.map((product) => product.quantity).sort()).toEqual([
    '3',
    '30',
    '30',
  ])
  expect(JSON.stringify(manifest.totals)).toContain('57.2202')
  expect(JSON.stringify(manifest.totals)).toContain('0.18')
  await page
    .locator('#packing-view [data-action="export-packing-list"]')
    .click()
  const exporting = page.locator('.packing-export-dialog'),
    downloading = page.waitForEvent('download')
  await exporting.locator('[data-action="download-packing-list"]').click()
  const download = await downloading,
    bytes = await readFile(await download.path()),
    workbook = XLSX.read(bytes, { type: 'buffer' }),
    products = workbook.Sheets['Packing list'],
    cartons = workbook.Sheets.Cartons,
    productRows = XLSX.utils.sheet_to_json(products, { header: 1 }),
    cartonRows = XLSX.utils.sheet_to_json(cartons, { header: 1 })
  await writeFile(
    test.info().outputPath('shared-cartons-synthetic.xlsx'),
    bytes
  )
  expect(workbook.SheetNames).toEqual(['Packing list', 'Cartons', 'Se quedó'])
  for (const code of ['CE26101001S', 'CE26101001M', 'CE26101001L'])
    expect(productRows.flat()).toContain(code)
  expect(cartonRows.flat().join(' ')).toContain('C001')
  const header = productRows.find(
      (row) => row.includes('Code') && row.includes('Cartons')
    ),
    codes = productRows.filter((row) =>
      /^CE26101001[SML]$/.test(row[header.indexOf('Code')])
    )
  expect(codes).toHaveLength(3)
  for (const column of [
    header.indexOf('Cartons'),
    header.indexOf('Carton mark'),
  ]) {
    expect(column).toBeGreaterThanOrEqual(0)
    for (const value of codes) {
      expect(String(value[column])).toContain('C001')
      expect(
        products[
          XLSX.utils.encode_cell({ r: productRows.indexOf(value), c: column })
        ]?.l?.Target
      ).toContain('Cartons')
    }
  }
  expect(
    Object.values(cartons).some(
      (cell) => typeof cell?.f === 'string' && cell.f.includes('1000000')
    )
  ).toBe(true)
  expect((await backup(extension)).orders[0].snapshot).toEqual(record.snapshot)
})

test('an order draft pastes exact dimensions and preserves high precision, zero and supplied-volume evidence without editing legacy source defaults', async ({
  extension,
}) => {
  const { page, record } = await seed(extension, {
      defaults: { kg: '0', cbm: '0.2' },
    }),
    ref = refFor(record)
  await physicalFixture(extension, record, [
    { weight: '0', suppliedCbm: '0.2', contents: [{ item: 0, quantity: '3' }] },
  ])
  const before = await backup(extension)
  let grid = await openOrderReconciliation(page, ref, 'cartons')
  await expect(row(grid).locator('[data-grid-column="weight"]')).toHaveValue(
    '0'
  )
  await stage(grid, 'dimensions', '40,5 × 30 × 25')
  await stage(grid, 'weight', '1,23456789123456789')
  expect((await backup(extension)).cartonBatches).toEqual(before.cartonBatches)
  await page.reload()
  grid = await openOrderReconciliation(page, ref, 'cartons')
  await expect(row(grid).locator('[data-grid-column="weight"]')).toHaveValue(
    '1,23456789123456789'
  )
  await grid.locator('[data-action="confirm-order-cartons"]').click()
  await expect
    .poll(
      async () => (await realOrderContext(extension, ref)).batches[0].weight
    )
    .toBe('1.23456789123456789')
  const after = await backup(extension)
  expect(after.cartonBatches[0]).toMatchObject({
    len: '40.5',
    wid: '30',
    ht: '25',
    weight: '1.23456789123456789',
    suppliedCbm: '0.2',
  })
  expect(after.orders[0].cartonDetails).toEqual(before.orders[0].cartonDetails)
  expect(after.orders[0].snapshot).toEqual(record.snapshot)
  await expect(grid.locator('.reconciliation-summary')).toContainText(
    '0.030375'
  )
})

test('final dimension edits persist in the single order draft across close/reload and the contained grid stays usable at every width', async ({
  extension,
}) => {
  const { page, record } = await seed(extension),
    ref = refFor(record)
  await physicalFixture(extension, record, [{ ...aggregate(), weight: '' }])
  const before = await backup(extension)
  let grid = await openOrderReconciliation(page, ref, 'cartons')
  await row(grid).locator('[data-column="label"]').click()
  const detail = page.locator('[data-action="inspect-order-carton"]')
  await detail
    .getByLabel('Dimensions (cm)', { exact: true })
    .fill('40 × 30 × 26,125')
  await detail.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(detail).toBeHidden()
  expect((await backup(extension)).cartonBatches).toEqual(before.cartonBatches)
  await page.reload()
  grid = await openOrderReconciliation(page, ref, 'cartons')
  await expect(
    row(grid).locator('[data-grid-column="dimensions"]')
  ).toHaveValue('40 × 30 × 26,125')
  for (const width of [1440, 1000, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const bounds = await grid.locator('.smart-grid-scroll').boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth
      )
    ).toBeLessThanOrEqual(1)
    await expect(
      grid.locator('[data-action="confirm-order-cartons"]')
    ).toBeVisible()
  }
  await grid.locator('[data-action="confirm-order-cartons"]').click()
  await expect
    .poll(async () => (await realOrderContext(extension, ref)).batches[0].ht)
    .toBe('26.125')
  expect((await realOrderContext(extension, ref)).batches[0].weight).toBe('')
})

test('numbered cartons retain exact cross-code minority contents and independent marks; explicit dimension fill never copies weight/loading or contents', async ({
  extension,
}) => {
  const { page, record } = await seed(extension, { crossCode: true }),
    ref = refFor(record),
    context = await physicalFixture(extension, record, [
      {
        cartonNumber: '001',
        len: '40',
        wid: '30',
        ht: '25',
        weight: '9.53',
        contents: [{ item: 0, quantity: '2' }],
      },
      {
        cartonNumber: '2',
        markIndex: 1,
        weight: '11.25',
        contents: [
          { item: 1, quantity: '3' },
          { item: 2, quantity: '8' },
        ],
      },
      {
        cartonNumber: '3',
        markIndex: 1,
        weight: '5.25',
        contents: [{ item: 0, quantity: '1' }],
      },
    ]),
    before = await backup(extension)
  const sourceTile = page
      .locator('#sheet-body tr[data-selection-key]')
      .nth(2)
      .locator('.photo-copy-tile'),
    copy = sourceTile.locator('.photo-copy-button')
  await page.mouse.move(1, 1)
  await expect(copy).toHaveCSS('opacity', '0')
  await sourceTile.hover()
  await expect
    .poll(() => copy.evaluate((node) => Number(getComputedStyle(node).opacity)))
    .toBeGreaterThan(0)
  const frame = await sourceTile.locator('.photo-copy-source').boundingBox(),
    corner = await copy.boundingBox()
  expect(Math.abs(corner.y - frame.y - 2)).toBeLessThanOrEqual(1)
  expect(
    Math.abs(frame.x + frame.width - corner.x - corner.width - 2)
  ).toBeLessThanOrEqual(1)
  expect(await copy.evaluate((node) => node.closest('label') === null)).toBe(
    true
  )
  const grid = await openOrderReconciliation(page, ref, 'cartons')
  await row(grid).locator('[data-column="label"]').click()
  const details = page.locator('[data-action="inspect-order-carton"]')
  await details.locator('[data-carton-identity="reference"]').fill('0001')
  await details
    .locator('[data-carton-identity="mark"]')
    .selectOption(context.preparation.groups[1].id)
  await details.getByRole('button', { name: 'Close', exact: true }).click()
  expect((await backup(extension)).cartonBatches).toEqual(before.cartonBatches)
  await row(grid).locator('[data-grid-column="dimensions"]').focus()
  await grid.locator('[data-action="select-grid-rows"]').click()
  await grid.locator('[data-action="fill-grid-range"]').click()
  const alignment = page.locator('.grid-paste-preview')
  await expect(alignment).toContainText('dimensions')
  await expect(alignment).not.toContainText('weight')
  await alignment
    .getByRole('button', { name: 'Use this alignment', exact: true })
    .click()
  await grid.locator('[data-action="confirm-order-cartons"]').click()
  await expect
    .poll(
      async () =>
        (await realOrderContext(extension, ref)).batches.find(
          (batch) => batch.id === 'synthetic-physical-0'
        ).cartonNumber
    )
    .toBe('0001')
  const after = await backup(extension),
    batches = after.cartonBatches.sort((a, b) => a.id.localeCompare(b.id))
  expect(batches).toHaveLength(3)
  expect(batches.map((batch) => batch.weight)).toEqual([
    '9.53',
    '11.25',
    '5.25',
  ])
  expect(batches.map((batch) => batch.contents)).toEqual(
    before.cartonBatches
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((batch) => batch.contents)
  )
  expect(
    batches.every(
      (batch) => batch.len === '40' && batch.wid === '30' && batch.ht === '25'
    )
  ).toBe(true)
  expect(
    batches.every((batch) => batch.loaded === null && batch.received === null)
  ).toBe(true)
  expect(
    batches.every(
      (batch) => batch.mark.groupId === context.preparation.groups[1].id
    )
  ).toBe(true)
  expect(
    batches
      .filter((batch) =>
        batch.contents.some(
          (part) => part.entryId === record.snapshot.items[0].entryId
        )
      )
      .map((batch) => batch.contents[0].quantity)
      .sort()
  ).toEqual(['1', '2'])
  await createContainerThroughUI(page, [ref], 'Synthetic independent marks')
  await page.locator('[data-action="mark-all-loaded"]').click()
  await page.locator('#packing-view [data-action="open-print-menu"]').click()
  await page.locator('#packing-view [data-action="print-carton-marks"]').click()
  const print = page.getByRole('dialog', {
    name: 'Print carton marks',
    exact: true,
  })
  await expect(print.getByLabel(/^Quantity for /)).toHaveCount(1)
  await expect(print.getByLabel(/^Quantity for /)).toHaveAccessibleName(
    'Quantity for CE26101002'
  )
  await expect(print.getByLabel(/^Quantity for /)).toHaveValue('3')
  expect((await backup(extension)).orders[0].snapshot).toEqual(record.snapshot)
})
