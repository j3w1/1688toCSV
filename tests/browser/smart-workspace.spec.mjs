import { test, expect } from './extension-fixture.mjs'
import {
  seedSmartOrder,
  openSmartLibrary,
  createSmartContainer,
  openOrderReconciliation,
  productGridRow,
  realOrderContext,
  createContainerThroughUI,
  sealContainerThroughUI,
} from './smart-workspace-helpers.mjs'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'

test('operator enters Pcs/box once, reviews the prefilled remainder once and loads/seals the confirmed order', async ({
  extension,
}) => {
  const ref = await seedSmartOrder(extension, { count: 1, quantity: '100' }),
    before = await realOrderContext(extension, ref),
    page = await openSmartLibrary(extension),
    grid = await openOrderReconciliation(page, ref),
    row = productGridRow(grid, { ...ref, entryId: 'entry-0' }),
    capacity = row.locator('[data-grid-column="capacity"]')
  await capacity.fill('45')
  await capacity.blur()
  await expect
    .poll(async () =>
      String(
        (await realOrderContext(extension, ref)).record.unitsPerCarton[
          'entry-0'
        ]
      )
    )
    .toBe('45')
  await expect(row.locator('[data-column="proposedCount"]')).toContainText('2')
  await expect(row.locator('[data-column="unassigned"]')).toContainText('10')
  const separate = row.locator('[data-action="separate-order-remainder"]')
  await expect(separate).toHaveText('Separate box for these 10')
  expect((await realOrderContext(extension, ref)).batches).toHaveLength(0)
  await separate.click()
  await expect(row.locator('[data-column="unassigned"]')).toContainText('0')
  await grid.locator('[data-action="undo-order-cartons"]').click()
  await expect(row.locator('[data-column="unassigned"]')).toContainText('10')
  await grid.locator('[data-action="redo-order-cartons"]').click()
  await expect(row.locator('[data-column="unassigned"]')).toContainText('0')
  await grid.locator('[data-action="confirm-order-cartons"]').click()
  await expect
    .poll(async () =>
      (await realOrderContext(extension, ref)).batches.reduce(
        (n, batch) => n + (batch.deletedAt ? 0 : batch.count),
        0
      )
    )
    .toBe(3)
  const confirmed = await realOrderContext(extension, ref)
  expect(
    confirmed.batches
      .flatMap((batch) => batch.contents)
      .reduce((n, part) => n + BigInt(part.quantity), 0n)
  ).toBe(100n)
  const id = await createContainerThroughUI(
    page,
    [ref],
    'Synthetic remainder November'
  )
  await expect(
    page.locator('#packing-view [data-grid-column="capacity"]')
  ).toHaveCount(0)
  await sealContainerThroughUI(page)
  const manifest = await extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerManifest({ id }),
    id
  )
  expect(manifest.draft).toBe(false)
  expect(manifest.cartons).toHaveLength(3)
  expect(manifest.products.map((row) => row.quantity)).toEqual(['100'])
  const after = await realOrderContext(extension, ref)
  expect(after.record.snapshot).toEqual(before.record.snapshot)
  expect(after.record.productPhotos).toEqual(before.record.productPhotos)
  expect(after.preparation.groups.map((group) => group.baseCode)).toEqual(
    before.preparation.groups.map((group) => group.baseCode)
  )
  expect(extension.unexpectedRequests).toEqual([])
})

test('operator pastes six uneven 1688 cartons, confirms one scoped review and loads/seals the exact report', async ({
  extension,
}) => {
  const ref = await seedSmartOrder(extension, { count: 1, quantity: '63' }),
    before = await realOrderContext(extension, ref),
    group = before.preparation.groups[0],
    variant = group.variants[0],
    code = group.baseCode + variant.variantSuffix + variant.sizeSuffix,
    page = await openSmartLibrary(extension),
    grid = await openOrderReconciliation(page, ref),
    quantities = ['13', '12', '11', '9', '9', '9'],
    weights = ['16.75', '14.62', '10.40', '5.63', '5.18', '4.64'],
    dimensions = [
      '60×50×40',
      '60×50×40',
      '50×43×36',
      '48×37×27',
      '48×37×27',
      '48×37×27',
    ],
    source = [
      '箱号\t货号\t装箱数 每箱\t体积 每箱\t重量 (KG) 每箱',
      ...quantities.map(
        (quantity, i) =>
          `${String(i + 1).padStart(3, '0')}\t${code}\t${quantity}\t${dimensions[i]}\t${weights[i]}`
      ),
    ].join('\n')
  await grid.locator('[data-action="paste-import-carton-list"]').click()
  const review = page.locator('dialog[data-action="packing-report-intake"]')
  await review.locator('textarea').fill(source)
  await review.locator('[data-action="review-carton-report"]').click()
  const unit = review
    .locator('section')
    .filter({ hasText: 'Confirm measurement unit' })
    .getByRole('combobox')
  await expect(unit).toBeVisible()
  await unit.selectOption('cm')
  await review.locator('[data-action="update-carton-report-review"]').click()
  await expect(
    review.locator('[data-action="commit-carton-report"]')
  ).toBeEnabled()
  await expect(review.locator('.smart-grid-scroll tbody tr')).toHaveCount(6)
  await expect(review.locator('input[data-entry-id]')).toHaveCount(0)
  await review.locator('[data-action="commit-carton-report"]').click()
  await expect(review).toBeHidden()
  const recorded = await realOrderContext(extension, ref),
    batches = recorded.batches.filter((batch) => !batch.deletedAt),
    ids = batches.map((batch) => batch.id).sort()
  expect(batches).toHaveLength(6)
  expect(batches.map((batch) => batch.contents[0].quantity).sort()).toEqual(
    [...quantities].sort()
  )
  expect(batches.map((batch) => batch.cartonNumber).sort()).toEqual([
    '001',
    '002',
    '003',
    '004',
    '005',
    '006',
  ])
  expect(
    batches.map((batch) => `${batch.len}×${batch.wid}×${batch.ht}`).sort()
  ).toEqual([...dimensions].sort())
  const id = await createContainerThroughUI(
    page,
    [ref],
    'Synthetic uneven November'
  )
  await sealContainerThroughUI(page)
  const result = await extension.inspector.evaluate(
    async ({ id, ref }) => {
      const repository = await window.testRepository,
        manifest = await repository.getContainerManifest({ id }),
        report = (await repository.getOrderReconciliation(ref)).reports[0]
      return {
        manifest,
        report,
        raw: await repository.getPackingReportSource({
          rawAssetRef: report.source.rawAssetRef,
        }),
      }
    },
    { id, ref }
  )
  expect(result.manifest.draft).toBe(false)
  expect(result.manifest.products.map((row) => row.quantity)).toEqual(['63'])
  expect(result.manifest.cartons).toHaveLength(6)
  expect(JSON.stringify(result.manifest.totals)).toContain('57.22')
  expect(JSON.stringify(result.manifest.totals)).toContain('0.461256')
  expect(result.raw.text).toBe(source)
  const after = await realOrderContext(extension, ref)
  expect(
    after.batches
      .filter((batch) => !batch.deletedAt)
      .map((batch) => batch.id)
      .sort()
  ).toEqual(ids)
  expect(after.record.snapshot).toEqual(before.record.snapshot)
  expect(after.record.productPhotos).toEqual(before.record.productPhotos)
  expect(extension.unexpectedRequests).toEqual([])
})

test('single click inspects, explicit checkbox selects and obsolete Prepare/Organize routes are absent', async ({
  extension,
}) => {
  await seedSmartOrder(extension)
  const page = await openSmartLibrary(extension),
    row = page.locator('#sheet-body tr[data-selection-key]').first()
  await row.locator('.description-cell').click({ position: { x: 4, y: 4 } })
  await expect(page.locator('.product-details-dialog')).toBeVisible()
  await expect(row.locator('input[type="checkbox"]')).not.toBeChecked()
  await page
    .getByRole('button', { name: 'Close product details', exact: true })
    .click()
  await row.locator('input[type="checkbox"]').check()
  await expect(page.locator('.product-details-dialog')).toHaveCount(0)
  await expect(row).toHaveAttribute('aria-selected', 'true')
  for (const action of [
    'prepare-packing-list',
    'packing-month',
    'organize-packing',
    'organize-done',
    'review-proceed',
    'review-assign-only',
  ])
    await expect(page.locator(`[data-action="${action}"]`)).toHaveCount(0)
  await expect(page.locator('[data-action="orders-products"]')).toBeVisible()
  await expect(page.locator('[data-action="orders-cartons"]')).toBeVisible()
  await expect(page.locator('[data-action="orders-backlog"]')).toBeVisible()
})

test('purchase-month code and source financial/media records stay distinct from a later container', async ({
  extension,
}) => {
  const ref = await seedSmartOrder(extension, { physical: true })
  const before = await extension.inspector.evaluate(async (ref) => {
    const repository = await window.testRepository
    return {
      order: await repository.getOrder(ref.orderId, {
        accountId: ref.accountId,
      }),
      preparation: (await repository.getOrderReconciliation(ref)).preparation,
    }
  }, ref)
  expect(
    before.preparation.groups.every((group) =>
      group.baseCode.startsWith('CE2609')
    )
  ).toBe(true)
  await createSmartContainer(extension, [ref])
  const after = await extension.inspector.evaluate(
    async (ref) =>
      (await window.testRepository).getOrder(ref.orderId, {
        accountId: ref.accountId,
      }),
    ref
  )
  expect(after.snapshot).toEqual(before.order.snapshot)
  expect(after.productPhotos).toEqual(before.order.productPhotos)
  expect(
    after.snapshot.items.map((row) => [
      row.quantity,
      row.price,
      row.discount,
      row.thumbnail,
    ])
  ).toEqual(
    before.order.snapshot.items.map((row) => [
      row.quantity,
      row.price,
      row.discount,
      row.thumbnail,
    ])
  )
})

test('140-row paste retains invalid cells across reload without physical writes and remains virtual', async ({
  extension,
}) => {
  const ref = await seedSmartOrder(extension, { count: 140 }),
    page = await openSmartLibrary(extension)
  await page.locator('[data-action="open-order-cartons"]').first().click()
  await page.locator('[data-action="select-grid-rows"]').click()
  const raw = Array.from({ length: 140 }, (_, index) =>
    index === 100 ? 'invalid' : String(index + 1)
  ).join('\n')
  await page
    .getByRole('textbox', {
      name: 'Paste carton or capacity cells',
      exact: true,
    })
    .fill(raw)
  await page.locator('[data-action="preview-carton-paste"]').click()
  await expect(page.locator('.grid-paste-preview')).toContainText('invalid')
  await page
    .getByRole('button', { name: 'Keep invalid draft', exact: true })
    .click()
  await expect
    .poll(() =>
      extension.inspector.evaluate(async (ref) => {
        const state = await (
          await window.testRepository
        ).getOrderReconciliation(ref)
        return state.draft?.value?.alignment?.text
      }, ref)
    )
    .toBe(raw)
  const state = await extension.inspector.evaluate(
    async (ref) => (await window.testRepository).getOrderReconciliation(ref),
    ref
  )
  expect(state.batches.filter((batch) => !batch.deletedAt)).toHaveLength(0)
  expect(Object.keys(state.record.unitsPerCarton || {})).toHaveLength(0)
  expect(
    await page.locator('.smart-grid-scroll tr[data-grid-key]').count()
  ).toBeLessThanOrEqual(101)
  await page.reload()
  await page.locator('[data-action="open-order-cartons"]').first().click()
  await expect(
    page.getByRole('textbox', {
      name: 'Paste carton or capacity cells',
      exact: true,
    })
  ).toHaveValue(raw)
})

test('one paste/Undo/Redo changes all capacities atomically without confirming physical cartons', async ({
  extension,
}) => {
  const ref = await seedSmartOrder(extension, { count: 3 }),
    page = await openSmartLibrary(extension)
  await page.locator('[data-action="open-order-cartons"]').first().click()
  await page.locator('[data-action="select-grid-rows"]').click()
  await page
    .getByRole('textbox', {
      name: 'Paste carton or capacity cells',
      exact: true,
    })
    .fill('45\n30\n10')
  await page.locator('[data-action="preview-carton-paste"]').click()
  await page
    .getByRole('button', { name: 'Use this alignment', exact: true })
    .click()
  const capacities = () =>
    extension.inspector.evaluate(async (ref) => {
      const state = await (
        await window.testRepository
      ).getOrderReconciliation(ref)
      return Object.values(state.record.unitsPerCarton || {}).map(String)
    }, ref)
  await expect.poll(capacities).toEqual(['45', '30', '10'])
  await page.locator('[data-action="undo-order-cartons"]').click()
  await expect.poll(capacities).toEqual([])
  await page.locator('[data-action="redo-order-cartons"]').click()
  await expect.poll(capacities).toEqual(['45', '30', '10'])
  const state = await extension.inspector.evaluate(
    async (ref) => (await window.testRepository).getOrderReconciliation(ref),
    ref
  )
  expect(state.batches.filter((batch) => !batch.deletedAt)).toHaveLength(0)
})

test('container Loading is read-only for product authorship and Edit in Orders retains its return route', async ({
  extension,
}) => {
  const ref = await seedSmartOrder(extension, { physical: true }),
    id = await createSmartContainer(extension, [ref]),
    page = await openSmartLibrary(extension)
  await page.goto(
    `${extension.extensionBaseUrl}/library.html#workspace=packing&containerId=${id}&view=loading`
  )
  await expect(page.locator('.container-heading')).toContainText(
    'Synthetic container October'
  )
  for (const selector of [
    '.packing-exclusion-toggle',
    '.packing-organize-group',
    '.carton-capacity input',
    '.label-editor',
    '[data-action="edit-order-product"]',
  ])
    await expect(page.locator(`#packing-view ${selector}`)).toHaveCount(0)
  await page.locator('[data-action="mark-all-loaded"]').click()
  await expect(page.locator('#container-content')).toHaveAttribute(
    'aria-busy',
    'false'
  )
  await page
    .locator('[data-action="container-view"][data-view="packing-list"]')
    .click()
  await page
    .locator('#packing-view tr[data-container-row]')
    .first()
    .locator('td')
    .nth(2)
    .click()
  const details = page.locator('.product-details-dialog')
  await expect(details).toHaveAttribute('data-mode', 'read-only')
  await expect(details.locator('input,select,textarea')).toHaveCount(0)
  await details.locator('[data-action="edit-in-orders"]').click()
  await expect(page.locator('.product-authoring-dialog')).toBeVisible()
  await page
    .locator('.product-authoring-dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await page.locator('[data-action="return-to-container"]').click()
  await expect(page.locator('.container-heading')).toContainText(
    'Synthetic container October'
  )
  await expect(page.locator('[data-action="choose-container"]')).toHaveValue(id)
})

test('filtered selected display still exports the full three-sheet loaded revision and default-off detailed JSON', async ({
  extension,
}) => {
  const ref = await seedSmartOrder(extension, { physical: true }),
    id = await createSmartContainer(extension, [ref]),
    page = await openSmartLibrary(extension)
  await page.goto(
    `${extension.extensionBaseUrl}/library.html#workspace=packing&containerId=${id}&view=loading`
  )
  await page.locator('[data-action="mark-all-loaded"]').click()
  await expect(page.locator('#container-content')).toHaveAttribute(
    'aria-busy',
    'false'
  )
  await page
    .locator('[data-action="container-view"][data-view="packing-list"]')
    .click()
  await page
    .getByRole('searchbox', { name: 'Filter container display', exact: true })
    .fill('entry-0')
  await page
    .locator('#packing-view tr[data-container-row] input[type="checkbox"]')
    .first()
    .check()
  await page.locator('[data-action="export-packing-list"]').click()
  const dialog = page.locator('.packing-export-dialog')
  await expect(
    dialog.getByRole('checkbox', {
      name: 'Include detailed automation JSON',
      exact: true,
    })
  ).not.toBeChecked()
  await expect(
    dialog.getByRole('radio', { name: 'Se quedó', exact: true })
  ).toBeVisible()
  await expect(dialog.locator('[data-option="scope"]')).toHaveCount(0)
  const downloading = page.waitForEvent('download')
  await dialog.locator('[data-action="download-packing-list"]').click()
  const download = await downloading,
    bytes = await readFile(await download.path()),
    workbook = XLSX.read(bytes, { type: 'buffer' })
  expect(workbook.SheetNames).toEqual(['Packing list', 'Cartons', 'Se quedó'])
  const rows = XLSX.utils
    .sheet_to_json(workbook.Sheets['Packing list'], { header: 1, raw: false })
    .flat()
    .map(String)
    .join('\n')
  expect(rows).toContain('SYNTHETIC 1')
  expect(rows).toContain('SYNTHETIC 2')
  const files = JSON.parse(
    await page.locator('#workspace-status').getAttribute('data-files')
  )
  expect(files).toHaveLength(1)
  expect(files[0]).toBe(download.suggestedFilename())
})

test('six exact uneven physical cartons preserve known totals and stable IDs through Loading', async ({
  extension,
}) => {
  const ref = await seedSmartOrder(extension, {
      count: 1,
      physical: true,
      uneven: true,
    }),
    id = await createSmartContainer(extension, [ref])
  const result = await extension.inspector.evaluate(
    async ({ id, ref }) => {
      const repository = await window.testRepository,
        before = await repository.getOrderReconciliation(ref),
        view = await repository.getContainerView({ id })
      await repository.markContainerLoaded({
        id,
        orderRefs: [ref],
        expectedRevision: view.container.revision,
        intentId: crypto.randomUUID(),
      })
      return { before, manifest: await repository.getContainerManifest({ id }) }
    },
    { id, ref }
  )
  expect(
    result.before.batches
      .filter((batch) => !batch.deletedAt)
      .map((batch) => batch.contents[0].quantity)
      .sort()
  ).toEqual(['11', '12', '13', '9', '9', '9'])
  expect(result.manifest.cartons).toHaveLength(6)
  expect(new Set(result.manifest.cartons.map((carton) => carton.id)).size).toBe(
    6
  )
  const text = JSON.stringify(result.manifest.totals)
  expect(text).toContain('57.22')
  expect(text).toContain('0.461256')
  expect(result.manifest.products[0].quantity).toBe('63')
})
