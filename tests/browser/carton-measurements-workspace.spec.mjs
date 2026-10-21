import { test, expect } from './extension-fixture.mjs'
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
const kg = (row) =>
  row.getByRole('textbox', { name: 'Weight (kg/box)', exact: true })
async function commit(input, value) {
  await input.fill(value)
  await input.press('Enter')
  await expect(input.locator('..')).toHaveAttribute('data-state', 'saved')
}
async function prepare(page) {
  await page.locator('#select-rows').click()
  await page.locator('#prepare-orders').click()
  const packing = page.locator('#packing-view')
  const review = page.getByRole('dialog', {
    name: 'Assign product codes?',
    exact: true,
  })
  await expect
    .poll(async () => (await packing.isVisible()) || (await review.isVisible()))
    .toBe(true)
  if (await review.isVisible())
    await review
      .getByRole('button', { name: 'Assign codes and prepare', exact: true })
      .click()
  await expect(packing).toBeVisible()
  return packing
}
async function openBatch(page, packing) {
  await packing.locator('.packing-group-cartons-edit').first().click()
  const dialog = page.getByRole('dialog', {
    name: 'Carton batches',
    exact: true,
  })
  await expect(dialog).toBeVisible()
  return dialog
}
const batchValue = (dialog, key) => dialog.locator(`input[name="${key}"]`)
async function saveBatch(dialog, key, value) {
  await batchValue(dialog, key).fill(value)
  await dialog
    .getByRole('button', { name: 'Save carton details', exact: true })
    .click()
  await expect(dialog.locator('.carton-batch-status')).toHaveText('Saved')
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

test('Orders keeps compact kg editing while CBM opens XYZ and never replaces dimensions with a volume field', async ({
  extension,
}) => {
  const { page, rows, record } = await seed(extension),
    first = rows.first()
  await expect(kg(first)).toHaveValue('20.5')
  await expect(
    first.getByRole('textbox', { name: 'Volume (m³/box)', exact: true })
  ).toHaveCount(0)
  await expect(
    first.getByRole('button', { name: 'Edit carton dimensions', exact: true })
  ).toHaveText('0.105 m³')
  const bounds = await kg(first).boundingBox()
  expect(bounds.height).toBe(23)
  expect(bounds.width).toBeLessThanOrEqual(70)
  await commit(kg(first), '025,2500')
  let saved = await backup(extension)
  expect(
    saved.orders[0].cartonDetails[record.snapshot.items[0].entryId]
  ).toEqual({ kg: '25.25', cbm: '0.21', len: '70', wid: '50', ht: '30' })
  await first
    .getByRole('button', { name: 'Edit carton dimensions', exact: true })
    .click()
  const details = page.getByRole('dialog', {
      name: 'Original product details',
      exact: true,
    }),
    panel = details.locator('.product-carton-details')
  await expect(panel.locator('input[name="cbm"]')).toHaveCount(0)
  await panel.locator('input[name="len"]').fill('80,125')
  await panel
    .getByRole('button', { name: 'Save carton details', exact: true })
    .click()
  await expect(panel.locator('.product-carton-status')).toHaveText('Saved')
  await expect(panel.locator('.product-carton-volume-value')).toHaveText(
    '0.1201875'
  )
  await details
    .getByRole('button', { name: 'Close product details', exact: true })
    .click()
  await expect(details).toHaveCount(0)
  saved = await backup(extension)
  expect(
    saved.orders[0].cartonDetails[record.snapshot.items[0].entryId]
  ).toEqual({ kg: '25.25', cbm: '0.21', len: '80.125', wid: '50', ht: '30' })
  await kg(first).fill('-')
  await kg(first).blur()
  await expect(kg(first)).toHaveAttribute('aria-invalid', 'true')
  expect(
    (await backup(extension)).orders[0].cartonDetails[
      record.snapshot.items[0].entryId
    ].kg
  ).toBe('25.25')
  await commit(kg(first), '0')
  await page.reload()
  await expect(kg(rows.first())).toHaveValue('0')
  await expect(
    rows
      .first()
      .getByRole('button', { name: 'Edit carton dimensions', exact: true })
  ).toHaveText('0.1201875 m³')
  await commit(kg(rows.first()), '')
  await page.reload()
  await expect(kg(rows.first())).toHaveValue('')
  await expect(rows.first().locator('.carton-measurement-unit')).toBeHidden()
})

test('prepared measurement changes travel through batch history without losing exact dimensions or supplier volume', async ({
  extension,
}) => {
  const { page } = await seed(extension, { physical: true }),
    packing = await prepare(page)
  let dialog = await openBatch(page, packing)
  await expect(batchValue(dialog, 'weight')).toHaveValue('20.5')
  await expect(dialog.locator('.product-carton-supplied')).toContainText(
    '0.21 m³'
  )
  await saveBatch(dialog, 'weight', '30,750000000000000001')
  let saved = await backup(extension)
  expect(saved.cartonBatches[0].weight).toBe('30.750000000000000001')
  dialog = await openBatch(page, packing)
  await saveBatch(dialog, 'ht', '40')
  saved = await backup(extension)
  expect(saved.cartonBatches[0]).toMatchObject({
    weight: '30.750000000000000001',
    len: '70',
    wid: '50',
    ht: '40',
    suppliedCbm: '0.21',
  })
  await packing.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect
    .poll(async () => (await backup(extension)).cartonBatches[0].ht)
    .toBe('30')
  expect((await backup(extension)).cartonBatches[0].weight).toBe(
    '30.750000000000000001'
  )
  await packing.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect
    .poll(async () => (await backup(extension)).cartonBatches[0].ht)
    .toBe('40')
  const first = packing.locator('tr[data-variant-id]').first()
  await expect(first.locator('.variant-code-design')).toHaveCSS(
    '--ce-code-size',
    '16px'
  )
  await expect(packing.locator('.packing-group-cartons')).toHaveCount(1)
  await expect(packing.locator('.packing-carton-chip')).toHaveCount(1)
  await expect(packing.locator('.packing-carton-chip')).toContainText(
    '70 × 50 × 40 cm'
  )
  dialog = await openBatch(page, packing)
  await expect(dialog.locator('.carton-batch-summary')).toContainText('0.14 m³')
  await expect(dialog.locator('.product-carton-supplied')).toContainText(
    '0.21 m³'
  )
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(first.locator('.variant-numeric-header')).toHaveText(
    'QuantityPcs/box'
  )
  await expect(
    first.getByRole('textbox', { name: 'Volume (m³/box)', exact: true })
  ).toHaveCount(0)
})

test('prepared tables keep carton data once per group and compact product quantity/capacity at every viewport width', async ({
  extension,
}) => {
  const { page } = await seed(extension, { physical: true }),
    packing = await prepare(page),
    rows = packing.locator('tr[data-variant-id]')
  await expect(packing.locator('.packing-group-cartons')).toHaveCount(1)
  await expect(packing.locator('.packing-carton-chip')).toHaveCount(1)
  await expect(packing.locator('.packing-carton-chip')).toContainText(
    '70 × 50 × 30 cm'
  )
  await expect(rows.first().locator('.variant-numeric-header')).toHaveText(
    'QuantityPcs/box'
  )
  for (const width of [1440, 1000, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const [row, capacity] of [
      [
        rows.first(),
        rows.first().getByRole('button', { name: 'Pcs/box', exact: true }),
      ],
      [rows.nth(1), rows.nth(1).locator('.carton-capacity-readout')],
    ]) {
      await expect(
        row.getByRole('textbox', { name: 'Volume (m³/box)', exact: true })
      ).toHaveCount(0)
      await expect(row.locator('.carton-measurement')).toHaveCount(0)
      const columns = await row.locator('.variant-carton-columns').boundingBox()
      for (const readout of [row.locator('.variant-quantity'), capacity]) {
        await expect(readout).toBeVisible()
        const bounds = await readout.boundingBox()
        expect(bounds.height).toBeLessThanOrEqual(32)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(
          columns.x + columns.width + 1
        )
      }
    }
    await expect(packing.locator('.packing-group-cartons-edit')).toBeVisible()
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(1)
  }
})

test('an invalid Orders measurement survives broadcasts and cannot overwrite another tab’s newer value', async ({
  extension,
}) => {
  const { page, rows, record } = await seed(extension),
    draft = kg(rows.first())
  await draft.fill('-')
  const other = await extension.context.newPage()
  await other.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await other.goto(`${extension.extensionBaseUrl}/library.html`)
  await commit(
    kg(other.locator('#sheet-body tr[data-selection-key]').first()),
    '6'
  )
  await commit(
    kg(other.locator('#sheet-body tr[data-selection-key]').nth(1)),
    '7'
  )
  await expect(kg(rows.nth(1))).toHaveValue('7')
  await expect(draft).toHaveValue('-')
  await draft.fill('5')
  await draft.press('Enter')
  await expect(draft.locator('..')).toHaveAttribute('data-state', 'error')
  await expect(draft.locator('..')).toContainText('changed in another tab')
  expect(
    (await backup(extension)).orders[0].cartonDetails[
      record.snapshot.items[0].entryId
    ].kg
  ).toBe('6')
})

test('a batch editor retains its stale draft and rejects overwriting a newer physical measurement from another tab', async ({
  extension,
}) => {
  const { page } = await seed(extension, { physical: true }),
    packing = await prepare(page),
    dialog = await openBatch(page, packing)
  await batchValue(dialog, 'weight').fill('-')
  const other = await extension.context.newPage()
  await other.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await other.goto(`${extension.extensionBaseUrl}/library.html`)
  await other.locator('#view-packing').click()
  const otherPacking = other.locator('#packing-view'),
    otherDialog = await openBatch(other, otherPacking)
  await saveBatch(otherDialog, 'weight', '6')
  await expect(batchValue(dialog, 'weight')).toHaveValue('-')
  await batchValue(dialog, 'weight').fill('5')
  await dialog
    .getByRole('button', { name: 'Save carton details', exact: true })
    .click()
  await expect(dialog.locator('.carton-batch-status')).toContainText(
    'changed in another tab'
  )
  await expect(batchValue(dialog, 'weight')).toHaveValue('5')
  expect((await backup(extension)).cartonBatches[0].weight).toBe('6')
})
