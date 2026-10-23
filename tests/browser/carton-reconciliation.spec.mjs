import { test, expect } from './extension-fixture.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  createPreparation,
  allocatePreparation,
} from '../../src/packing-model.js'
import { validateCartonBatch } from '../../src/carton-batches.js'
import { repeatProductStoreIdentity } from '../../src/repeat-products.js'
import { planCartonBatchChanges } from '../../src/carton-batch-changes.js'
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

test('a removed mark-only owner is resolved by an explicit actual owner choice in one Orders mark review', async ({
  extension,
}, testInfo) => {
  const { page, view, before, ref } = await seed(extension, {
    twoGroups: true,
    markOnlyOwner: true,
  })
  await reviewLegacy(page, view)
  // This restored/retired-owner state differs from Merge: a merge has an
  // explicitly surviving logical owner and must not pretend it is missing.
  const retired = before.preparations[0].groups[1],
    state = await extension.inspector.evaluate(
      async ({ ref, entryId, quantity }) => {
        const repository = await window.testRepository
        await repository.setInventoryDispositions({
          ...ref,
          entries: {
            [entryId]: {
              kind: 'canceled',
              quantity,
              reason:
                'Only the product with no pieces in these cartons retired',
            },
          },
          expectedValues: { [entryId]: null },
        })
        return repository.getOperationalState({})
      },
      {
        ref,
        entryId: retired.variants[0].entryIds[0],
        quantity: before.orders[0].snapshot.items[2].quantity,
      }
    ),
    next = structuredClone(state.preparations)
  next[0].groups = next[0].groups.filter((group) => group.id !== retired.id)
  const plan = planCartonBatchChanges({
    batches: state.batches,
    records: state.records,
    beforePreparations: state.preparations,
    afterPreparations: next,
  })
  expect(plan.reviews[0].currentProductCode).toBe('')
  expect(plan.reviews[0].resolutionRequired).toBe(true)
  await extension.inspector.evaluate(
    async ({ state, next, plan }) => {
      return (await window.testRepository).savePreparations(next, {
        expectedRevisions: state.preparations.map((prep) => prep.revision),
        expectedSnapshots: state.records.map((record) => ({
          accountId: record.snapshot.accountId,
          orderId: record.snapshot.orderId,
          observedAt: record.snapshot.observedAt,
        })),
        cartonBatchChanges: plan.changes,
        allowCartonReview: true,
      })
    },
    { state, next, plan }
  )
  const reviewed = await backup(extension),
    pending = await realOrderContext(extension, ref)
  expect(pending.batches[0].currentProductCode).toBe('')
  expect(pending.batches[0].physicalMarkResolutionRequired).toBe(true)
  const grid = await openOrderReconciliation(page, ref, 'cartons')
  await grid
    .locator('[data-action="review-carton-physical-mark"]')
    .first()
    .click()
  const review = page.locator('[data-action="review-physical-mark"]'),
    owner = review.locator('[data-action="choose-physical-mark-owner"]'),
    decision = review.locator('[data-action="physical-mark-decision"]'),
    apply = review.locator('[data-action="save-physical-mark-decision"]')
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
  const printed = await exportAliasMark(
    extension,
    page,
    review,
    'current-product',
    pending.batches[0],
    testInfo,
    {
      recorded: retired.baseCode,
      current: before.preparations[0].groups[0].baseCode,
    }
  )
  expect(
    printed.physicalMarks.every((ref) => ref.productGroupId === target.groupId)
  ).toBe(true)
  expect((await backup(extension)).cartonBatches).toEqual(
    reviewed.cartonBatches
  )
  await apply.click()
  await expect(review).toBeHidden()
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
  testInfo,
  expectedCodes = {
    recorded: batch.physicalMark.code,
    current: batch.physicalMark.productCode,
  }
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
    code = role === 'recorded' ? expectedCodes.recorded : expectedCodes.current
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
      currentProductCode: expectedCodes.current,
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

test('returned cartons retain original evidence but require a fresh label after their released mark ships on another purchase', async ({
  extension,
}, testInfo) => {
  test.setTimeout(60000)
  const { page, ref, before, batch, markReview } = await keptAlias(extension),
    original = before.orders[0],
    originalPhoto = await markReview
      .locator('.physical-mark-source-photo')
      .getAttribute('src'),
    oldCode = batch.physicalMark.code,
    foreignRecord = structuredClone(original),
    foreignRef = { accountId: ref.accountId, orderId: '900000000000000010' }
  // Save a real original-mark job before its retirement. Regeneration must
  // later reach the typed repository fence, rather than rebuild a live label.
  await exportAliasMark(
    extension,
    page,
    markReview,
    'recorded',
    batch,
    testInfo
  )
  await markReview.getByRole('button', { name: 'Close', exact: true }).click()
  foreignRecord.accountId = foreignRef.accountId
  foreignRecord.orderId = foreignRef.orderId
  Object.assign(foreignRecord.snapshot, {
    ...foreignRef,
    sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${foreignRef.orderId}`,
    items: [structuredClone(original.snapshot.items[2])],
    totals: {
      goodsGross: '30.00',
      shipping: '0.00',
      sourceDiscount: '0.00',
      orderAdjustment: '0.00',
      goodsNet: '30.00',
      payable: '30.00',
    },
  })
  function prepared(snapshot) {
    const value = createPreparation(snapshot, '2026-10')
    for (const group of value.groups) {
      group.spanishName = 'SYNTHETIC RECOVERY'
      group.category = '合成品'
      for (const variant of group.variants) {
        const previous = before.preparations[0].groups
          .flatMap((group) => group.variants)
          .find((other) =>
            other.entryIds.some((entryId) => variant.entryIds.includes(entryId))
          )
        variant.variantSuffix = previous.variantSuffix
        variant.sizeSuffix = previous.sizeSuffix
        variant.needsSizeMapping = false
      }
    }
    return value
  }
  const foreign = prepared(foreignRecord.snapshot),
    fresh = prepared(original.snapshot)
  foreign.groups[0].baseCode = oldCode
  const removed = await extension.inspector.evaluate(
    async ({ ref, foreignRecord, foreign, images }) => {
      const repository = await window.testRepository,
        context = await repository.getOrderReconciliation(ref)
      await repository.removeCartonBatch(context.batches[0])
      await repository.removeOrders([ref.orderId])
      const removed = await repository.exportBackup({})
      await repository.restoreBackup({
        format: '1688-order-library',
        version: 1,
        exportedAt: '2026-10-23T06:00:00.000Z',
        orders: [foreignRecord],
        history: [],
        images,
      })
      const [saved] = await repository.savePreparations([foreign], {
          expectedRevisions: [0],
        }),
        foreignRef = { accountId: saved.accountId, orderId: saved.orderId },
        rc = await repository.getOrderReconciliation(foreignRef),
        target = { orderId: saved.orderId, groupId: saved.groups[0].id }
      await repository.saveOrderCartonFacts({
        ...foreignRef,
        expectedRevisions: rc.revisions,
        changes: [
          {
            after: {
              id: 'foreign-synthetic-sealed-carton',
              ...foreignRef,
              month: '2026-10',
              packingBasis: 'exact',
              count: 1,
              revision: 0,
              groups: [target],
              mark: target,
              contents: [
                {
                  orderId: saved.orderId,
                  entryId: foreignRecord.snapshot.items[0].entryId,
                  quantity: '30',
                },
              ],
              unresolvedContents: [],
              len: '50',
              wid: '40',
              ht: '30',
              weight: '8.2504',
              weightBasis: 'carton',
              received: 1,
            },
            expectedRevision: 0,
          },
        ],
      })
      return removed
    },
    { ref, foreignRecord, foreign, images: before.images }
  )
  expect(removed.orders).toHaveLength(0)
  expect(removed.cartonBatches[0].deletedAt).toBeTruthy()
  expect(removed.issuedCodes.some((value) => value.code === oldCode)).toBe(
    false
  )
  await page.reload()
  const foreignId = await createContainerThroughUI(
    page,
    [foreignRef],
    'Synthetic shipment owning the released mark'
  )
  await sealContainerThroughUI(page)
  const foreignSealed = await backup(extension),
    foreignManifest = await extension.inspector.evaluate(
      async (id) => (await window.testRepository).getContainerManifest({ id }),
      foreignId
    )
  expect(foreignManifest.cartons[0].markCode).toBe(oldCode)
  const recovery = await extension.inspector.evaluate(
    async ({ ref, original, images, fresh, batchId }) => {
      const repository = await window.testRepository
      await repository.restoreBackup({
        format: '1688-order-library',
        version: 1,
        exportedAt: '2026-10-23T06:05:00.000Z',
        orders: [original],
        history: [],
        images,
      })
      await repository.savePreparations([fresh], { expectedRevisions: [0] })
      const state = await repository.getOperationalState({}),
        tombstone = state.batches.find((value) => value.id === batchId),
        target = tombstone.physicalMarkOwnerChoices.find(
          (choice) => choice.groups.length === 1
        )
      if (!target) throw new Error('Missing actual current owner choice')
      const after = { ...tombstone, mark: target.mark, groups: target.groups }
      delete after.deletedAt
      const context = await repository.getOrderReconciliation(ref)
      await repository.saveOrderCartonFacts({
        ...ref,
        expectedRevisions: context.revisions,
        changes: [
          { after, restore: true, expectedRevision: tombstone.revision },
        ],
      })
      return {
        tombstone,
        target,
        context: await repository.getOrderReconciliation(ref),
      }
    },
    { ref, original, images: before.images, fresh, batchId: batch.id }
  )
  expect(recovery.tombstone.deletedAt).toBeTruthy()
  expect(recovery.tombstone.physicalMarkRelabelOnly).toBe(true)
  const active = recovery.context.batches.find((value) => value.id === batch.id)
  expect(active.physicalMarkRelabelOnly).toBe(true)
  expect(active.physicalMarkResolutionChoices).toEqual(['relabel-reprint'])
  expect(active.physicalMarkCode).toBe(oldCode)
  expect(active.physicalMarkSupersessions[0].conflicts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        orderId: foreignRef.orderId,
        containerId: foreignId,
        revisionId: foreignManifest.revisionId,
        kind: 'code-consumption',
      }),
    ])
  )
  for (const group of recovery.context.preparation.groups) {
    expect(group.baseCode).toBeTruthy()
    expect(group.baseCode).not.toBe(oldCode)
  }
  for (const key of [
    'id',
    'contents',
    'count',
    'received',
    'loaded',
    'len',
    'wid',
    'ht',
    'weight',
    'weightBasis',
    'unitContents',
    'sourceFacts',
  ])
    expect(active[key], key).toEqual(batch[key])
  expect(active.physicalMark.originalArtwork).toEqual(
    batch.physicalMark.originalArtwork
  )
  await page.reload()
  await page.locator('#view-orders').click()
  await page.locator('[data-action="orders-products"]').click()
  await page
    .locator('#orders-print-actions [data-action="open-print-menu"]')
    .click()
  await page.locator('#print-recent').click()
  const recent = page.locator('.print-recent-dialog'),
    filesBeforeRefusal = await downloads(extension),
    jobsBeforeRefusal = await page.evaluate(() =>
      localStorage.getItem('1688-print-recent')
    )
  await recent
    .getByRole('button', { name: /^Regenerate the print job of / })
    .first()
    .click()
  await expect(recent).toContainText(`belongs to shipment ${foreignId}`)
  await expect(recent).toContainText(foreignManifest.revisionId)
  await expect(page.locator('.print-dialog')).toHaveCount(0)
  expect((await downloads(extension)).map((file) => file.id)).toEqual(
    filesBeforeRefusal.map((file) => file.id)
  )
  expect(
    await page.evaluate(() => localStorage.getItem('1688-print-recent'))
  ).toBe(jobsBeforeRefusal)
  await recent.getByRole('button', { name: 'Close', exact: true }).click()
  const grid = await openOrderReconciliation(page, ref, 'cartons')
  await grid
    .locator(
      `tr[data-grid-key="${batch.id}"] [data-action="review-carton-physical-mark"]`
    )
    .click()
  const review = page.locator('[data-action="review-physical-mark"]')
  await expect(
    review.locator('[data-choice="keep-recorded-mark"]')
  ).toBeDisabled()
  await expect(review.locator('[data-mark-role="recorded"]')).toBeDisabled()
  await expect(review.locator('[data-mark-supersession]')).toContainText(
    foreignId
  )
  await expect(review.locator('[data-mark-supersession]')).toContainText(
    foreignManifest.revisionId
  )
  await expect(review.locator('.physical-mark-source-photo')).toHaveAttribute(
    'src',
    originalPhoto
  )
  const prePrint = await backup(extension)
  await exportAliasMark(
    extension,
    page,
    review,
    'current-product',
    active,
    testInfo,
    {
      recorded: oldCode,
      current: active.currentProductCode,
    }
  )
  const postPrint = await backup(extension)
  for (const key of [
    'orders',
    'preparations',
    'cartonBatches',
    'containers',
    'shipmentLocks',
    'images',
  ])
    expect(postPrint[key], key).toEqual(prePrint[key])
  await review.locator('[data-choice="relabel-reprint"]').check()
  await review
    .locator('[data-action="physical-mark-reason"]')
    .fill(
      'Fresh current marks printed and applied to the same returned cartons'
    )
  await expect(
    review.locator('[data-action="save-physical-mark-decision"]')
  ).toBeDisabled()
  await review.locator('[data-action="confirm-physical-relabel"]').check()
  await review.locator('[data-action="save-physical-mark-decision"]').click()
  await expect(review).toBeHidden()
  const resolved = await realOrderContext(extension, ref),
    relabeled = resolved.batches.find((value) => value.id === batch.id)
  expect(relabeled.physicalMarkRelabelOnly).toBe(false)
  expect(relabeled.physicalMark).toMatchObject({
    originalCode: oldCode,
    code: active.currentProductCode,
    resolution: { choice: 'relabel-reprint', physicalRelabelConfirmed: true },
  })
  expect(relabeled.contents).toEqual(batch.contents)
  expect(relabeled.physicalMark.originalArtwork).toEqual(
    batch.physicalMark.originalArtwork
  )
  const returnedId = await createContainerThroughUI(
    page,
    [ref],
    'Synthetic returned cartons after physical relabel'
  )
  await sealContainerThroughUI(page)
  const returnedManifest = await extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerManifest({ id }),
    returnedId
  )
  expect(returnedManifest.cartons).toHaveLength(6)
  expect(
    returnedManifest.cartons.every(
      (carton) => carton.markCode === active.currentProductCode
    )
  ).toBe(true)
  // The actual sealed owner still prints its frozen old-code artwork. Only
  // the returning goods are fenced; this is a real historical PDF download.
  const packing = page.locator('#packing-view')
  await packing
    .locator('[data-action="choose-container"]')
    .selectOption(foreignId)
  await expect(packing.locator('.container-heading')).toContainText(
    'Synthetic shipment owning the released mark'
  )
  await packing
    .locator('[data-action="container-view"][data-view="packing-list"]')
    .click()
  await packing.locator('[data-action="open-print-menu"]').click()
  await packing.locator('[data-action="print-carton-marks"]').click()
  const historicalPrint = page.getByRole('dialog', {
      name: 'Print carton marks',
      exact: true,
    }),
    priorHistoricalFiles = new Set(
      (await downloads(extension)).map((file) => file.id)
    )
  await expect(historicalPrint.getByLabel(/^Quantity for /)).toHaveCount(1)
  await expect(historicalPrint.getByLabel(/^Quantity for /)).toHaveValue('1')
  await historicalPrint.locator('[data-action="export-pdf"]').click()
  let historicalPdf, historicalJson
  await expect
    .poll(async () => {
      const files = (await downloads(extension)).filter(
        (file) =>
          !priorHistoricalFiles.has(file.id) && file.state === 'complete'
      )
      historicalPdf = files.find((file) => file.filename.endsWith('.pdf'))
      historicalJson = files.find(
        (file) =>
          historicalPdf &&
          file.filename === historicalPdf.filename.replace(/\.pdf$/, '.json')
      )
      return Boolean(historicalPdf && historicalJson)
    })
    .toBe(true)
  const historicalBytes = await readFile(historicalPdf.filename),
    historicalSummary = JSON.parse(
      await readFile(historicalJson.filename, 'utf8')
    )
  expect(historicalBytes.subarray(0, 8).toString('ascii')).toBe('%PDF-1.4')
  expect(historicalBytes.toString('latin1')).toContain(
    '/MediaBox [0 0 595.276 841.89]'
  )
  expect(historicalBytes.toString('latin1')).toContain('/PrintScaling /None')
  expect(historicalBytes.toString('latin1')).toContain('/Count 1')
  expect(historicalBytes.toString('latin1').match(/ Do Q/g)).toHaveLength(1)
  expect(historicalBytes.toString('latin1')).toContain(oldCode)
  expect(historicalBytes.toString('latin1')).not.toContain('DRAFT - UNSEALED')
  expect(historicalSummary).toMatchObject({
    kind: 'carton-marks',
    containerId: foreignId,
    revisionId: foreignManifest.revisionId,
    draft: false,
    totals: { requested: 1, printed: 1 },
  })
  expect(historicalSummary.products).toHaveLength(1)
  expect(historicalSummary.products[0].code).toBe(oldCode)
  await writeFile(
    testInfo.outputPath('owning-shipment-historical-synthetic.pdf'),
    historicalBytes
  )
  await writeFile(
    testInfo.outputPath('owning-shipment-historical-synthetic.json'),
    JSON.stringify(historicalSummary, null, 2)
  )
  await historicalPrint.locator('[data-action="close-print-dialog"]').click()
  const final = await backup(extension)
  expect(
    final.orders.find((record) => record.snapshot.orderId === ref.orderId)
      .snapshot
  ).toEqual(original.snapshot)
  expect(
    final.orders.find((record) => record.snapshot.orderId === ref.orderId)
      .productPhotos
  ).toEqual(original.productPhotos)
  for (const image of before.images)
    expect(final.images.find((current) => current.url === image.url)).toEqual(
      image
    )
  for (const key of ['containers', 'shipmentLocks']) {
    const owned = (values) =>
      values.filter((value) =>
        key === 'containers'
          ? value.id === foreignId
          : value.orderId === foreignRef.orderId
      )
    expect(JSON.stringify(owned(final[key]))).toBe(
      JSON.stringify(owned(foreignSealed[key]))
    )
  }
  expect(
    final.orders.find(
      (record) => record.snapshot.orderId === foreignRef.orderId
    )
  ).toEqual(
    foreignSealed.orders.find(
      (record) => record.snapshot.orderId === foreignRef.orderId
    )
  )
  expect(
    final.issuedCodes.filter(
      (code) => code.code === oldCode && code.kind === 'base'
    )
  ).toEqual([expect.objectContaining({ orderId: foreignRef.orderId })])
  expect(
    await extension.inspector.evaluate(
      async (id) => (await window.testRepository).getContainerManifest({ id }),
      foreignId
    )
  ).toEqual(foreignManifest)
})

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
}, testInfo) => {
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
  const physicalBeforePrint = await backup(extension),
    printed = await exportAliasMark(
      extension,
      page,
      review,
      'current-product',
      physicalBeforePrint.cartonBatches[0],
      testInfo,
      {
        recorded: before.preparations[0].groups[1].baseCode,
        current: before.preparations[0].groups[0].baseCode,
      }
    )
  expect(
    printed.physicalMarks.every(
      (ref) => ref.productGroupId === before.preparations[0].groups[0].id
    )
  ).toBe(true)
  expect((await backup(extension)).cartonBatches).toEqual(
    physicalBeforePrint.cartonBatches
  )
  await expect(
    mark.locator('[data-action="physical-mark-reason"]')
  ).toHaveValue(
    'The actual original printed mark remains on these same six cartons'
  )
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
