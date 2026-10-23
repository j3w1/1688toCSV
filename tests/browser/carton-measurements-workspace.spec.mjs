import { test, expect } from './extension-fixture.mjs'
import {
  openOrderReconciliation,
  realOrderContext,
  createContainerThroughUI,
} from './smart-workspace-helpers.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  createPreparation,
  allocatePreparation,
} from '../../src/packing-model.js'
import { validateCartonBatch } from '../../src/carton-batches.js'
import { repeatProductStoreIdentity } from '../../src/repeat-products.js'

async function seed(extension, { physical = false } = {}) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-measurements'
  record.cartonDetails = {
    [record.snapshot.items[0].entryId]: {
      kg: '20.5',
      cbm: '0.21',
      len: '70',
      wid: '50',
      ht: '30',
    },
  }
  record.cartonDetailsUpdatedAt = record.snapshot.observedAt
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = '玻璃花瓶'
    item.productNumber = 'SYNTHETIC-VASE'
    item.skuProperties = [
      { label: '颜色', value: ['红色', '白色', '黑色'][index] },
    ]
  }
  const preparation = createPreparation(record.snapshot, '2026-10')
  for (const group of preparation.groups) {
    group.spanishName = 'FLORERO'
    group.category = '玻璃'
  }
  const allocation = physical
      ? allocatePreparation({ ...preparation, revision: 1 }, [], [], {
          snapshot: record.snapshot,
        })
      : { allocations: [], issuedCodes: [] },
    first = record.snapshot.items[0],
    owner =
      physical &&
      allocation.preparation.groups.find((group) =>
        group.variants.some((variant) =>
          variant.entryIds.includes(first.entryId)
        )
      ),
    batches = physical
      ? [
          validateCartonBatch({
            id: 'synthetic-measurement-cartons',
            accountId: record.snapshot.accountId,
            storeId: repeatProductStoreIdentity(record.snapshot),
            month: '2026-10',
            groups: [{ orderId: record.snapshot.orderId, groupId: owner.id }],
            mark: { orderId: record.snapshot.orderId, groupId: owner.id },
            contents: [
              {
                orderId: record.snapshot.orderId,
                entryId: first.entryId,
                quantity: first.quantity,
              },
            ],
            count: 4,
            received: null,
            loaded: null,
            len: '70',
            wid: '50',
            ht: '30',
            weightBasis: 'carton',
            weight: '20.5',
            suppliedCbm: '0.21',
            revision: 1,
            updatedAt: record.snapshot.observedAt,
          }),
        ]
      : []
  const result = await extension.inspector.evaluate(
    ({ record, allocation, batches, physical }) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 4,
          exportedAt: new Date().toISOString(),
          orders: [record],
          history: [],
          images: [],
          preparations: physical ? [allocation.preparation] : [],
          allocations: allocation.allocations,
          issuedCodes: allocation.issuedCodes,
          cartonBatches: batches,
        },
      }),
    { record, allocation, batches, physical }
  )
  expect(result.ok, result.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(3)
  return { page, rows, record }
}
async function backup(extension) {
  const result = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(result.ok, result.error).toBe(true)
  return result.data
}
const refFor = (record) => ({
  accountId: record.accountId || record.snapshot.accountId || 'local',
  orderId: record.snapshot.orderId,
})
const physicalRow = (grid) =>
  grid.locator('tr[data-grid-key="synthetic-measurement-cartons"]')
const cell = (grid, column) =>
  physicalRow(grid).locator(`[data-grid-column="${column}"]`)
async function stage(grid, column, value) {
  await cell(grid, column).fill(value)
  await cell(grid, column).blur()
}
async function confirm(grid, extension, ref, check) {
  await grid.locator('[data-action="confirm-order-cartons"]').click()
  await expect
    .poll(async () =>
      check(
        (await realOrderContext(extension, ref)).batches.find(
          (batch) => batch.id === 'synthetic-measurement-cartons'
        )
      )
    )
    .toBe(true)
}

test('Orders stages exact physical dimensions and zero/unknown weight separately while retaining supplied volume and source annotations', async ({
  extension,
}) => {
  const { page, record } = await seed(extension, { physical: true }),
    ref = refFor(record),
    before = await backup(extension),
    grid = await openOrderReconciliation(page, ref, 'cartons')
  await expect(cell(grid, 'weight')).toHaveValue('20.5')
  await expect(cell(grid, 'dimensions')).toHaveValue('70×50×30')
  await expect(cell(grid, 'suppliedCbm')).toHaveValue('0.21')
  await stage(grid, 'weight', '025,2500')
  await stage(grid, 'dimensions', '80,125 × 50 × 30')
  const warning = grid.locator('[data-issue-code="volume-discrepancy"]')
  await expect(warning).toHaveAttribute('data-issue-severity', 'warning')
  await expect(warning).toContainText('Measured volume 0.48075 m³ is used')
  await expect(warning).toContainText(
    'supplied volume 0.84 m³ remains recorded'
  )
  await expect(warning).toContainText('0.21 m³ · Per carton · 4 cartons')
  expect((await backup(extension)).cartonBatches).toEqual(before.cartonBatches)
  await confirm(
    grid,
    extension,
    ref,
    (batch) => batch.weight === '25.25' && batch.len === '80.125'
  )
  let saved = await backup(extension),
    batch = saved.cartonBatches.find(
      (batch) => batch.id === 'synthetic-measurement-cartons'
    )
  expect(batch).toMatchObject({
    weight: '25.25',
    suppliedCbm: '0.21',
    len: '80.125',
    wid: '50',
    ht: '30',
    count: 4,
  })
  expect(((80.125 * 50 * 30) / 1000000).toString()).toBe('0.1201875')
  expect(saved.orders[0].cartonDetails).toEqual(before.orders[0].cartonDetails)
  expect(saved.orders[0].snapshot).toEqual(record.snapshot)
  await cell(grid, 'weight').fill('-')
  await cell(grid, 'weight').blur()
  await expect(cell(grid, 'weight')).toHaveAttribute('aria-invalid', 'true')
  expect(
    (await backup(extension)).cartonBatches.find(
      (entry) => entry.id === batch.id
    ).weight
  ).toBe('25.25')
  await stage(grid, 'weight', '0')
  await confirm(grid, extension, ref, (batch) => batch.weight === '0')
  await page.reload()
  const refreshed = await openOrderReconciliation(page, ref, 'cartons')
  await expect(cell(refreshed, 'weight')).toHaveValue('0')
  await stage(refreshed, 'weight', '')
  await confirm(refreshed, extension, ref, (batch) => batch.weight === '')
  await expect(cell(refreshed, 'weight')).toHaveValue('')
  expect((await backup(extension)).orders[0].cartonDetails).toEqual(
    before.orders[0].cartonDetails
  )
  await createContainerThroughUI(
    page,
    [ref],
    'Synthetic measured-volume review'
  )
  const packing = page.locator('#packing-view')
  await packing.locator('[data-action="mark-all-loaded"]').click()
  await packing.locator('[data-action="review-container-seal"]').click()
  const review = page.locator('.container-review-dialog'),
    sealWarning = review.locator('[data-issue-code="volume-discrepancy"]')
  await expect(sealWarning).toContainText('Measured volume 0.48075 m³ is used')
  await expect(sealWarning).toContainText(
    'supplied volume 0.84 m³ remains recorded'
  )
  await expect(sealWarning).toContainText('0.21 m³ · Per carton · 4 cartons')
  await expect(review.locator('[data-action="seal-container"]')).toBeEnabled()
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('physical measurement edits form one order draft with Undo/Redo before a single confirm and retain exact decimals/history', async ({
  extension,
}) => {
  const { page, record } = await seed(extension, { physical: true }),
    ref = refFor(record),
    before = await backup(extension),
    grid = await openOrderReconciliation(page, ref, 'cartons')
  await stage(grid, 'weight', '30,750000000000000001')
  await stage(grid, 'dimensions', '70 × 50 × 40')
  await grid.locator('[data-action="undo-order-cartons"]').click()
  await expect(cell(grid, 'dimensions')).toHaveValue('70×50×30')
  await expect(cell(grid, 'weight')).toHaveValue('30,750000000000000001')
  await grid.locator('[data-action="redo-order-cartons"]').click()
  await expect(cell(grid, 'dimensions')).toHaveValue('70 × 50 × 40')
  expect((await backup(extension)).cartonBatches).toEqual(before.cartonBatches)
  await confirm(grid, extension, ref, (batch) => batch.ht === '40')
  const after = await backup(extension),
    batch = after.cartonBatches[0]
  expect(batch).toMatchObject({
    id: before.cartonBatches[0].id,
    weight: '30.750000000000000001',
    len: '70',
    wid: '50',
    ht: '40',
    suppliedCbm: '0.21',
    count: 4,
  })
  expect(batch.contents).toEqual(before.cartonBatches[0].contents)
  expect(batch.cartonHistory).toContainEqual(
    expect.objectContaining({ weight: '20.5', ht: '30', suppliedCbm: '0.21' })
  )
  expect(after.orders).toEqual(before.orders)
  await expect(grid.locator('[data-column="count"] input')).toHaveCount(0)
  await expect(grid.locator('[data-column="weightBasis"]')).toContainText(
    'Per carton'
  )
})

test('one physical measurement row stays inside its own scroll surface at wide/narrow widths and product totals remain read-only', async ({
  extension,
}) => {
  const { page, record } = await seed(extension, { physical: true }),
    grid = await openOrderReconciliation(page, refFor(record), 'cartons')
  await expect(grid.locator('tr[data-grid-key]')).toHaveCount(1)
  for (const width of [1440, 1000, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(1)
    const scroll = await grid.locator('.smart-grid-scroll').boundingBox()
    expect(scroll.x).toBeGreaterThanOrEqual(0)
    expect(scroll.x + scroll.width).toBeLessThanOrEqual(width)
    await expect(cell(grid, 'weight')).toBeEditable()
    await expect(grid.locator('[data-column="count"] input')).toHaveCount(0)
    await expect(
      grid.locator('[data-action="confirm-order-cartons"]')
    ).toBeVisible()
  }
  await grid.locator('[data-action="reconciliation-products"]').click()
  await expect(
    grid.locator(
      '[data-column="purchased"] input,[data-column="available"] input,[data-column="unassigned"] input'
    )
  ).toHaveCount(0)
  await expect(grid.locator('input[data-grid-column="weight"]')).toHaveCount(0)
  await expect(grid.locator('[data-column="pattern"]').first()).toContainText(
    'per-carton contents unknown'
  )
  await expect(grid.locator('[data-column="code"] .ce-code').first()).toHaveCSS(
    '--ce-code-size',
    '16px'
  )
})

test('invalid physical input survives a broadcast/reload while another tab confirms a newer value; stale correction cannot overwrite it', async ({
  extension,
}) => {
  const { page, record } = await seed(extension, { physical: true }),
    ref = refFor(record),
    grid = await openOrderReconciliation(page, ref, 'cartons')
  await cell(grid, 'weight').fill('-')
  await expect
    .poll(async () =>
      JSON.stringify((await realOrderContext(extension, ref)).draft)
    )
    .toContain('-')
  const other = await extension.context.newPage()
  await other.goto(`${extension.extensionBaseUrl}/inspector.html`)
  await other.evaluate(async (ref) => {
    const repository = await window.testRepository,
      current = await repository.getOrderReconciliation(ref),
      batch = current.batches[0]
    await repository.saveOrderCartonFacts({
      ...ref,
      changes: [
        { after: { ...batch, weight: '6' }, expectedRevision: batch.revision },
      ],
      expectedRevisions: current.revisions,
      intentId: crypto.randomUUID(),
    })
  }, ref)
  await expect(cell(grid, 'weight')).toHaveValue('-')
  await stage(grid, 'weight', '5')
  await grid.locator('[data-action="confirm-order-cartons"]').click()
  await expect(page.locator('.error-notice')).toBeVisible()
  await expect(cell(grid, 'weight')).toHaveValue('5')
  expect((await realOrderContext(extension, ref)).batches[0].weight).toBe('6')
  expect((await realOrderContext(extension, ref)).record.snapshot).toEqual(
    record.snapshot
  )
  await page.reload()
  const recoveredGrid = await openOrderReconciliation(page, ref, 'cartons')
  await expect(cell(recoveredGrid, 'weight')).toHaveValue('6')
  await recoveredGrid
    .locator('[data-action="review-recovered-carton-draft"]')
    .click()
  const review = page.locator('.packing-change-dialog')
  await expect(review).toContainText('earlier order revision or amendment')
  await expect(review).toContainText('5')
  expect((await realOrderContext(extension, ref)).batches[0].weight).toBe('6')
  await review
    .getByRole('button', { name: 'Keep saved version', exact: true })
    .click()
  await expect(review).toBeHidden()
  await expect(cell(recoveredGrid, 'weight')).toHaveValue('6')
})

test('an exceptional unit uses a retained entitlement, leaves untouched combined facts unknown and rejects a newer physical revision', async ({
  extension,
}) => {
  const { page, record } = await seed(extension, { physical: true }),
    ref = refFor(record),
    grid = await openOrderReconciliation(page, ref, 'cartons')
  await physicalRow(grid).locator('[data-column="label"]').click()
  const details = page.locator('[data-action="inspect-order-carton"]')
  await details
    .locator('[data-action="choose-carton-entitlement"]')
    .selectOption('1')
  await expect(
    details.locator('.carton-unit-exception input[data-entry-id]').first()
  ).toHaveValue('')
  const weight = details.locator('[data-unit-measurement="weight"]')
  await weight.fill('7.125')
  await details.getByRole('button', { name: 'Close', exact: true }).click()
  expect((await backup(extension)).cartonBatches[0].weight).toBe('20.5')
  const current = await realOrderContext(extension, ref)
  expect(JSON.stringify(current.draft)).toContain('7.125')
  const other = await extension.context.newPage()
  await other.goto(`${extension.extensionBaseUrl}/inspector.html`)
  await other.evaluate(async (ref) => {
    const repository = await window.testRepository,
      current = await repository.getOrderReconciliation(ref),
      batch = current.batches[0]
    await repository.saveOrderCartonFacts({
      ...ref,
      changes: [
        { after: { ...batch, weight: '6' }, expectedRevision: batch.revision },
      ],
      expectedRevisions: current.revisions,
      intentId: crypto.randomUUID(),
    })
  }, ref)
  await grid.locator('[data-action="confirm-order-cartons"]').click()
  await expect(page.locator('.error-notice')).toBeVisible()
  expect((await backup(extension)).cartonBatches[0].weight).toBe('6')
  expect(
    JSON.stringify((await realOrderContext(extension, ref)).draft)
  ).toContain('7.125')
})
