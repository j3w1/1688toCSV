import { test, expect } from './extension-fixture.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  createPreparation,
  allocatePreparation,
} from '../../src/packing-model.js'
import { validateCartonBatch } from '../../src/carton-batches.js'
import { repeatProductStoreIdentity } from '../../src/repeat-products.js'
import {
  openOrderReconciliation,
  assignSelectedPurchaseCodes,
  editOrderProduct,
  closeOrderProduct,
  createContainerThroughUI,
  sealContainerThroughUI,
  clearOrderProductSelection,
  realOrderContext,
} from './smart-workspace-helpers.mjs'

async function backup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}

async function seed(
  extension,
  { twoGroups = false, markOnlyOwner = false } = {}
) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const order = record.snapshot
  order.sellerName = 'Synthetic carton reconciliation supplier'
  order.sellerMemberLogin = 'synthetic-carton-reconciliation'
  order.purchasedAt = '2026-10-12T10:15:00+08:00'
  for (const [index, item] of order.items.entries()) {
    const separate = twoGroups && index === 2
    item.title = separate ? '合成收纳盒' : '合成毛绒玩具'
    item.description = `${item.title}\n尺寸：${['S', 'M', 'L'][index]}`
    item.productNumber = separate ? 'SYNTHETIC-BOX' : 'SYNTHETIC-PLUSH'
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
  const preparation = createPreparation(order, '2026-10')
  expect(preparation.groups).toHaveLength(twoGroups ? 2 : 1)
  for (const [index, group] of preparation.groups.entries()) {
    group.baseCode = index ? 'CE26101002' : 'CE26101001'
    group.spanishName = index ? 'CAJA' : 'PELUCHE'
    group.category = index ? '收纳盒' : '毛绒玩具'
    for (const variant of group.variants) {
      const sourceIndex = order.items.findIndex((item) =>
        variant.entryIds.includes(item.entryId)
      )
      variant.variantSuffix = ''
      variant.sizeSuffix = ['S', 'M', 'L'][sourceIndex]
      variant.needsSizeMapping = false
    }
  }
  const allocation = allocatePreparation(
    { ...preparation, revision: 1 },
    [],
    [],
    { snapshot: order }
  )
  const owner = allocation.preparation.groups.at(-1)
  const contentsOwner = markOnlyOwner
      ? allocation.preparation.groups[0]
      : owner,
    packedIds = new Set(
      contentsOwner.variants.flatMap((variant) => variant.entryIds)
    )
  const batch = validateCartonBatch({
    id: 'synthetic-reviewed-cartons',
    accountId: order.accountId,
    storeId: repeatProductStoreIdentity(order),
    month: '2026-10',
    groups: [{ orderId: order.orderId, groupId: contentsOwner.id }],
    ...(!twoGroups || markOnlyOwner
      ? { mark: { orderId: order.orderId, groupId: owner.id } }
      : {}),
    contents: order.items
      .filter((item) => packedIds.has(item.entryId))
      .map((item) => ({
        orderId: order.orderId,
        entryId: item.entryId,
        quantity: item.quantity,
      })),
    count: 6,
    len: '40.125',
    wid: '30',
    ht: '25',
    weightBasis: 'batch',
    weight: '57.2202',
    received: 6,
    loaded: 2,
    revision: 1,
    updatedAt: '2026-10-15T00:00:00.000Z',
  })
  const restored = await extension.inspector.evaluate(
    ({ record, allocation, batch }) =>
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
          cartonBatches: [batch],
          history: [],
          images: [],
        },
      }),
    { record, allocation, batch }
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  const ref = {
      accountId: record.accountId || record.snapshot.accountId || 'local',
      orderId: order.orderId,
    },
    view = await openOrderReconciliation(page, ref, 'cartons'),
    before = await backup(extension)
  expect(before.cartonBatches).toHaveLength(1)
  return { page, view, record, before, ref }
}

function evidence(batch) {
  const { revision: _revision, updatedAt: _updatedAt, ...result } = batch
  return result
}

function expectSource(after, before) {
  expect(after.orders.map((record) => record.snapshot)).toEqual(
    before.orders.map((record) => record.snapshot)
  )
  expect(after.orders.map((record) => record.productPhotos)).toEqual(
    before.orders.map((record) => record.productPhotos)
  )
}
async function reviewLegacy(page, view) {
  await view.locator('[data-action="order-carton-history"]').click()
  await view.locator('[data-history-key]').first().click()
  await page.locator('[data-action="review-legacy-carton"]').click()
  const review = page.locator('[data-action="legacy-carton-review"]')
  await review.locator('select').first().selectOption('not-shipped')
  await review
    .locator('textarea')
    .fill(
      'Synthetic physical evidence reviewed; these goods have never shipped'
    )
  await review.getByRole('checkbox').first().check()
  await review.locator('[data-action="resolve-legacy-carton"]').click()
  await expect(review).toContainText('Legacy evidence review saved')
  await review.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(review).toBeHidden()
}
async function group(page, operation, indices) {
  await page.locator('[data-action="orders-products"]').click()
  await clearOrderProductSelection(page)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  for (const index of indices)
    await rows.nth(index).getByRole('checkbox').check()
  await page.locator('#group-order-products').click()
  const tools = page.locator('.orders-grouping-dialog')
  await tools.getByRole('button', { name: operation, exact: true }).click()
  const review = page.getByRole('dialog', {
    name: 'Review product grouping',
    exact: true,
  })
  await expect(review).toBeVisible()
  return { review, tools }
}

async function keptAlias(extension) {
  const fixture = await seed(extension, { twoGroups: true }),
    { page, view, ref, before } = fixture
  await reviewLegacy(page, view)
  const { review, tools } = await group(page, 'Merge products', [0, 1, 2]),
    decision = review.locator('[data-action="physical-mark-decision"]')
  await expect(decision).toContainText(
    before.preparations[0].groups[1].baseCode
  )
  await expect(review.locator('[data-action="review-proceed"]')).toBeDisabled()
  await decision.locator('[data-choice="keep-recorded-mark"]').check()
  await decision
    .locator('[data-action="physical-mark-reason"]')
    .fill('The original physical mark is still on these actual cartons')
  await review.locator('[data-action="review-proceed"]').click()
  await expect(tools).toBeHidden()
  const current = await backup(extension),
    batch = current.cartonBatches[0]
  expect(current.preparations[0].groups).toHaveLength(1)
  expect(batch.physicalMark).toMatchObject({
    code: before.preparations[0].groups[1].baseCode,
    productCode: before.preparations[0].groups[0].baseCode,
    resolution: { choice: 'keep-recorded-mark' },
  })
  const grid = await openOrderReconciliation(page, ref, 'cartons'),
    row = grid.locator(`tr[data-grid-key="${batch.id}"]`)
  await expect(row.locator('[data-column="physicalMarkCode"]')).toContainText(
    batch.physicalMark.code
  )
  await expect(row.locator('[data-column="currentProductCode"]')).toContainText(
    batch.physicalMark.productCode
  )
  await row.locator('[data-action="review-carton-physical-mark"]').click()
  const markReview = page.locator('[data-action="review-physical-mark"]')
  await expect(markReview).toBeVisible()
  expectSource(current, before)
  return { ...fixture, batch, current, grid, markReview }
}
async function downloads(extension) {
  return extension.inspector.evaluate(() => chrome.downloads.search({}))
}

test('a removed mark-only owner is resolved by an explicit actual owner choice in the same grouping review', async ({
  extension,
}) => {
  const { page, view, before, ref } = await seed(extension, {
    twoGroups: true,
    markOnlyOwner: true,
  })
  await reviewLegacy(page, view)
  const reviewed = await backup(extension),
    { review, tools } = await group(page, 'Merge products', [0, 1, 2]),
    owner = review.locator('[data-action="choose-physical-mark-owner"]'),
    decision = review.locator('[data-action="physical-mark-decision"]'),
    apply = review.locator('[data-action="review-proceed"]')
  await expect(owner).toHaveCount(1)
  await expect(owner).toHaveValue('')
  await expect(decision).toContainText(
    before.preparations[0].groups[1].baseCode
  )
  await decision.locator('[data-choice="keep-recorded-mark"]').check()
  await decision
    .locator('[data-action="physical-mark-reason"]')
    .fill(
      'Explicit owner review preserves the physical mark with no contributed pieces'
    )
  await expect(apply).toBeDisabled()
  const target = {
    orderId: ref.orderId,
    groupId: before.preparations[0].groups[0].id,
  }
  await owner.selectOption(JSON.stringify(target))
  await expect(apply).toBeEnabled()
  expect((await backup(extension)).cartonBatches).toEqual(
    reviewed.cartonBatches
  )
  await apply.click()
  await expect(tools).toBeHidden()
  const after = await backup(extension),
    batch = after.cartonBatches[0]
  expect(batch.mark).toEqual(target)
  expect(batch.physicalMark).toMatchObject({
    code: before.preparations[0].groups[1].baseCode,
    originalMark: before.cartonBatches[0].mark,
    productCode: before.preparations[0].groups[0].baseCode,
    resolution: {
      choice: 'keep-recorded-mark',
      physicalRelabelConfirmed: false,
    },
  })
  expect(batch.contents).toEqual(before.cartonBatches[0].contents)
  expect(batch).toMatchObject({
    count: 6,
    weight: '57.2202',
    len: '40.125',
    wid: '30',
    ht: '25',
  })
  expectSource(after, before)
  const id = await createContainerThroughUI(
    page,
    [ref],
    'Synthetic explicit physical mark owner'
  )
  await sealContainerThroughUI(page)
  const manifest = await extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerManifest({ id }),
    id
  )
  expect(manifest.cartons).toHaveLength(6)
  expect(manifest.products.map((row) => row.quantity).sort()).toEqual([
    '3',
    '30',
  ])
  expectSource(await backup(extension), before)
})
async function exportAliasMark(
  extension,
  page,
  markReview,
  role,
  batch,
  testInfo
) {
  const previous = new Set((await downloads(extension)).map((file) => file.id))
  await markReview
    .locator(
      `[data-action="print-order-carton-mark"][data-mark-role="${role}"]`
    )
    .click()
  const print = page.locator('.print-dialog')
  await expect(print).toBeVisible()
  await expect(print.getByLabel(/^Quantity for /)).toHaveCount(1)
  await expect(print.getByLabel(/^Quantity for /)).toHaveValue('6')
  await print.locator('[data-action="export-pdf"]').click()
  let pdf, summaryFile
  await expect
    .poll(async () => {
      const files = (await downloads(extension)).filter(
        (file) => !previous.has(file.id) && file.state === 'complete'
      )
      pdf = files.find((file) => file.filename.endsWith('.pdf'))
      summaryFile = files.find(
        (file) =>
          pdf && file.filename === pdf.filename.replace(/\.pdf$/, '.json')
      )
      return Boolean(pdf && summaryFile)
    })
    .toBe(true)
  const bytes = await readFile(pdf.filename),
    summary = JSON.parse(await readFile(summaryFile.filename, 'utf8')),
    code =
      role === 'recorded'
        ? batch.physicalMark.code
        : batch.physicalMark.productCode
  expect(bytes.subarray(0, 8).toString('ascii')).toBe('%PDF-1.4')
  expect(bytes.toString('latin1')).toContain('/MediaBox [0 0 595.276 841.89]')
  expect(bytes.toString('latin1')).toContain('/PrintScaling /None')
  expect(bytes.toString('latin1')).toContain('/Count 3')
  expect(bytes.toString('latin1').match(/ Do Q/g)).toHaveLength(6)
  expect(bytes.toString('latin1')).toContain(code)
  expect(summary).toMatchObject({
    kind: 'carton-marks',
    pages: 3,
    perPage: 2,
    totals: { requested: 6, printed: 6 },
  })
  expect(summary.products).toHaveLength(1)
  expect(summary.products[0].code).toBe(code)
  expect(summary.physicalMarks).toHaveLength(6)
  expect(
    summary.physicalMarks.map((mark) => mark.index).sort((a, b) => a - b)
  ).toEqual([0, 1, 2, 3, 4, 5])
  for (const mark of summary.physicalMarks) {
    expect(mark).toMatchObject({
      scope: 'order-carton-mark',
      accountId: 'local',
      orderId: batch.orderId,
      batchId: batch.id,
      markRole: role,
      code,
      currentProductCode: batch.physicalMark.productCode,
      batchRevision: batch.revision,
    })
    expect(mark.sourceGuard).toMatch(/^[a-f0-9]{64}$/)
  }
  await writeFile(
    testInfo.outputPath(`${role}-carton-mark-synthetic.pdf`),
    bytes
  )
  await writeFile(
    testInfo.outputPath(`${role}-carton-mark-synthetic.json`),
    JSON.stringify(summary, null, 2)
  )
  await print.locator('[data-action="close-print-dialog"]').click()
  await expect(markReview).toBeVisible()
  return summary
}

for (const relabel of [false, true]) {
  test(`Orders prints both actual mark roles after retiring a group, ${relabel ? 'confirms fresh relabeling' : 'keeps the recorded mark'} and seals the same physical cartons`, async ({
    extension,
  }, testInfo) => {
    const { page, ref, before, batch, current, markReview } =
        await keptAlias(extension),
      preparation = structuredClone(current.preparations)
    const recorded = await exportAliasMark(
        extension,
        page,
        markReview,
        'recorded',
        batch,
        testInfo
      ),
      proposed = await exportAliasMark(
        extension,
        page,
        markReview,
        'current-product',
        batch,
        testInfo
      )
    expect(recorded.products[0].code).not.toBe(proposed.products[0].code)
    let after = await backup(extension)
    expect(after.preparations).toEqual(preparation)
    expect(after.cartonBatches).toEqual(current.cartonBatches)
    expectSource(after, before)
    if (relabel) {
      await markReview.locator('[data-choice="relabel-reprint"]').check()
      await markReview
        .locator('[data-action="physical-mark-reason"]')
        .fill(
          'New marks were printed and physically applied to these same cartons'
        )
      await expect(
        markReview.locator('[data-action="save-physical-mark-decision"]')
      ).toBeDisabled()
      await markReview
        .locator('[data-action="confirm-physical-relabel"]')
        .check()
      await markReview
        .locator('[data-action="save-physical-mark-decision"]')
        .click()
      await expect(markReview).toBeHidden()
    } else
      await markReview
        .getByRole('button', { name: 'Close', exact: true })
        .click()
    after = await backup(extension)
    const saved = after.cartonBatches.find((value) => value.id === batch.id)
    expect(saved.physicalMark).toMatchObject({
      originalCode: batch.physicalMark.originalCode,
      code: relabel ? batch.physicalMark.productCode : batch.physicalMark.code,
      productCode: batch.physicalMark.productCode,
      resolution: {
        choice: relabel ? 'relabel-reprint' : 'keep-recorded-mark',
        physicalRelabelConfirmed: relabel,
      },
    })
    expect(saved.contents).toEqual(batch.contents)
    expect(saved).toMatchObject({
      count: 6,
      weight: '57.2202',
      weightBasis: 'batch',
      len: '40.125',
      wid: '30',
      ht: '25',
    })
    expect(saved.unitContents).toEqual(batch.unitContents)
    expect(after.preparations).toEqual(preparation)
    expectSource(after, before)
    const id = await createContainerThroughUI(
      page,
      [ref],
      `Synthetic physical mark ${relabel ? 'relabel' : 'keep'}`
    )
    await sealContainerThroughUI(page)
    const manifest = await extension.inspector.evaluate(
      async (id) => (await window.testRepository).getContainerManifest({ id }),
      id
    )
    expect(manifest.cartons).toHaveLength(6)
    for (const carton of manifest.cartons) {
      expect(carton.markCode).toBe(saved.physicalMark.code)
      expect(carton.currentProductCode).toBe(saved.physicalMark.productCode)
    }
    expect(
      manifest.products.reduce((sum, row) => sum + BigInt(row.quantity), 0n)
    ).toBe(30n)
    expectSource(await backup(extension), before)
  })
}

test('a carton change during real mark PDF encoding rejects the captured output without download or recent-job writes', async ({
  extension,
}) => {
  const { page, ref, before, batch, markReview, current } =
    await keptAlias(extension)
  await markReview
    .locator(
      '[data-action="print-order-carton-mark"][data-mark-role="recorded"]'
    )
    .click()
  const print = page.locator('.print-dialog')
  await expect(print).toBeVisible()
  const files = await downloads(extension),
    recent = await page.evaluate(() =>
      localStorage.getItem('1688-print-recent')
    )
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob
    window.holdMarkEncoding = true
    window.markEncodingStarted = false
    const pending = []
    window.releaseMarkEncoding = () => {
      window.holdMarkEncoding = false
      for (const resume of pending.splice(0)) resume()
    }
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      if (window.holdMarkEncoding && Math.max(this.width, this.height) > 1500) {
        window.markEncodingStarted = true
        pending.push(() => original.apply(this, args))
        return
      }
      return original.apply(this, args)
    }
  })
  await print.locator('[data-action="export-pdf"]').click()
  await expect
    .poll(() => page.evaluate(() => window.markEncodingStarted))
    .toBe(true)
  const other = await extension.context.newPage()
  await other.goto(`${extension.extensionBaseUrl}/inspector.html`)
  await other.evaluate(
    async ({ ref, batchId }) => {
      const repository = await window.testRepository,
        context = await repository.getOrderReconciliation(ref),
        batch = context.batches.find((value) => value.id === batchId)
      await repository.saveOrderCartonFacts({
        ...ref,
        changes: [
          {
            after: { ...batch, weight: '57.2203' },
            expectedRevision: batch.revision,
          },
        ],
        expectedRevisions: context.revisions,
        intentId: crypto.randomUUID(),
      })
    },
    { ref, batchId: batch.id }
  )
  await other.close()
  await page.evaluate(() => window.releaseMarkEncoding())
  await expect(print).toBeVisible()
  await expect(print.locator('.print-status').first()).toContainText(
    'The captured carton mark changed'
  )
  await expect(print.locator('[data-action="export-pdf"]')).toBeEnabled()
  expect((await downloads(extension)).map((file) => file.id)).toEqual(
    files.map((file) => file.id)
  )
  expect(
    await page.evaluate(() => localStorage.getItem('1688-print-recent'))
  ).toBe(recent)
  const after = await backup(extension)
  expect(after.cartonBatches[0].weight).toBe('57.2203')
  expect(after.cartonBatches[0].contents).toEqual(batch.contents)
  expect(after.preparations).toEqual(current.preparations)
  const actual = await realOrderContext(extension, ref)
  expect(
    actual.batches.find((value) => value.id === batch.id).revision
  ).toBeGreaterThan(batch.revision)
  expectSource(after, before)
})

test('reviewing legacy loading retains authored physical evidence and a November container does not change October codes', async ({
  extension,
}) => {
  const { page, view, before, ref } = await seed(extension)
  await reviewLegacy(page, view)
  const reviewed = await backup(extension),
    batch = reviewed.cartonBatches[0]
  expect(batch).toMatchObject({
    id: before.cartonBatches[0].id,
    loaded: 2,
    count: 6,
    weight: '57.2202',
    weightBasis: 'batch',
    len: '40.125',
    wid: '30',
    ht: '25',
  })
  expect(batch.contents).toEqual(before.cartonBatches[0].contents)
  expect(batch.legacyResolution).toMatchObject({
    kind: 'not-shipped',
    attestNotShipped: true,
    reason:
      'Synthetic physical evidence reviewed; these goods have never shipped',
    reviewedAt: '2026-10-15T04:00:00.000Z',
  })
  const id = await createContainerThroughUI(
    page,
    [ref],
    'Synthetic November legacy review'
  )
  await sealContainerThroughUI(page)
  const manifest = await extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerManifest({ id }),
    id
  )
  expect(manifest.cartons).toHaveLength(6)
  expect(manifest.products.map((row) => row.quantity).sort()).toEqual([
    '3',
    '30',
    '30',
  ])
  expect(JSON.stringify(manifest.totals)).toContain('57.2202')
  const after = await backup(extension)
  expect(after.preparations).toEqual(before.preparations)
  expect(after.cartonBatches[0].month).toBe('2026-10')
  expect(after.cartonBatches[0].contents).toEqual(
    before.cartonBatches[0].contents
  )
  expectSource(after, before)
})

test('Orders merge reviews source ownership without losing a physical mark/count/measurements and compound Undo restores original groups', async ({
  extension,
}) => {
  const { page, view, before } = await seed(extension, { twoGroups: true })
  await reviewLegacy(page, view)
  const { review, tools } = await group(page, 'Merge products', [0, 1, 2])
  const mark = review.locator('[data-action="physical-mark-decision"]')
  await expect(mark).toHaveCount(1)
  await expect(mark).toContainText(before.preparations[0].groups[1].baseCode)
  await expect(mark).toContainText(before.preparations[0].groups[0].baseCode)
  await expect(review.locator('[data-action="review-proceed"]')).toBeDisabled()
  await mark.locator('[data-choice="keep-recorded-mark"]').check()
  await mark
    .locator('[data-action="physical-mark-reason"]')
    .fill('The actual original printed mark remains on these same six cartons')
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  await review
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(review).toBeHidden()
  await expect(tools).toBeHidden()
  await expect
    .poll(async () => (await backup(extension)).preparations[0].groups.length)
    .toBe(1)
  const after = await backup(extension),
    batch = after.cartonBatches[0]
  expect(batch.physicalMark).toMatchObject({
    code: before.preparations[0].groups[1].baseCode,
    originalCode: before.preparations[0].groups[1].baseCode,
    productCode: before.preparations[0].groups[0].baseCode,
    resolution: {
      choice: 'keep-recorded-mark',
      reason:
        'The actual original printed mark remains on these same six cartons',
      physicalRelabelConfirmed: false,
      provenance: 'manual-confirmed',
    },
  })
  expect(batch).toMatchObject({
    id: before.cartonBatches[0].id,
    count: 6,
    weight: '57.2202',
    len: '40.125',
    wid: '30',
    ht: '25',
    received: 6,
    loaded: 2,
  })
  expect(batch.contents).toEqual(before.cartonBatches[0].contents)
  expectSource(after, before)
  await page.keyboard.press('Control+z')
  await expect
    .poll(async () => (await backup(extension)).preparations[0].groups.length)
    .toBe(2)
  expect((await backup(extension)).preparations[0].groups).toEqual(
    before.preparations[0].groups
  )
  expect((await backup(extension)).cartonBatches[0]).toMatchObject({
    id: batch.id,
    count: 6,
    weight: '57.2202',
    contents: before.cartonBatches[0].contents,
  })
})

test('splitting same-order source variants preserves one physical identity and mark while reviewing the new code owner', async ({
  extension,
}) => {
  const { page, view, before, ref } = await seed(extension)
  await reviewLegacy(page, view)
  const middle = before.preparations[0].groups[0].variants[1],
    { review, tools } = await group(page, 'Move to new product', [1])
  await review
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(review).toBeHidden()
  await expect(tools).toBeHidden()
  const after = await backup(extension),
    destination = after.preparations[0].groups.find((group) =>
      group.variants.some((variant) =>
        variant.entryIds.includes(middle.entryIds[0])
      )
    )
  expect(destination.id).not.toBe(before.preparations[0].groups[0].id)
  expect(destination.baseCode).not.toBe(
    before.preparations[0].groups[0].baseCode
  )
  const batch = after.cartonBatches[0]
  expect(after.cartonBatches).toHaveLength(1)
  expect(batch).toMatchObject({
    id: before.cartonBatches[0].id,
    mark: before.cartonBatches[0].mark,
    contents: before.cartonBatches[0].contents,
    count: 6,
    weight: '57.2202',
  })
  expect(new Set(batch.groups.map((group) => group.orderId))).toEqual(
    new Set([ref.orderId])
  )
  expectSource(after, before)
  await page.keyboard.press('Control+z')
  await expect
    .poll(async () => (await backup(extension)).preparations[0].groups.length)
    .toBe(1)
  expect((await backup(extension)).preparations[0].groups).toEqual(
    before.preparations[0].groups
  )
  expect((await backup(extension)).cartonBatches[0]).toMatchObject({
    id: batch.id,
    contents: batch.contents,
    count: 6,
    weight: '57.2202',
  })
})

test('Packing offers whole-order removal only and source suffix edits, physical contents and purchase records survive draft removal/reinclusion', async ({
  extension,
}) => {
  const { page, view, before, ref } = await seed(extension)
  await reviewLegacy(page, view)
  await page.locator('[data-action="orders-products"]').click()
  const editor = await editOrderProduct(page, 1, { 'Variant ending': 'A' })
  await closeOrderProduct(editor)
  const authored = await backup(extension),
    middle = authored.preparations[0].groups[0].variants[1]
  expect(middle.variantSuffix).toBe('A')
  await createContainerThroughUI(
    page,
    [ref],
    'Synthetic draft source preservation'
  )
  await expect(
    page.locator(
      '#packing-view [data-action="organize-packing"],#packing-view [data-action="remove-product"],#packing-view input[data-code-part]'
    )
  ).toHaveCount(0)
  await page.locator('[data-action="remove-container-order"]').click()
  await expect(page.locator('.container-order')).toHaveCount(0)
  const after = await backup(extension)
  expect(after.preparations).toEqual(authored.preparations)
  expect(after.cartonBatches).toEqual(authored.cartonBatches)
  expectSource(after, before)
  const backlog = await extension.inspector.evaluate(async () =>
    (await window.testRepository).getBacklog({})
  )
  expect(backlog.orders.some((order) => order.orderId === ref.orderId)).toBe(
    true
  )
})
