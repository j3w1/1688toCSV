import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  libraryBackup,
  assignSelectedPurchaseCodes,
} from './smart-workspace-helpers.mjs'

async function backup(extension) {
  const result = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(result.ok, result.error).toBe(true)
  return result.data
}

async function openOrders(
  extension,
  { prepared = false, missingSeller = false } = {}
) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.purchasedAt = '2026-10-12T10:15:00+08:00'
  record.snapshot.sellerName = 'Synthetic packing eligibility store'
  record.snapshot.sellerMemberLogin = 'synthetic-packing-eligibility-store'
  if (missingSeller) {
    record.snapshot.sellerName = 'Seller unavailable'
    record.snapshot.sellerMemberLogin = ''
    record.snapshot.sellerUnavailable = true
  }
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = ['合成玻璃罐', '合成收纳盒', '补运费 货品差价'][index]
    item.productNumber = `SYNTHETIC-ELIGIBILITY-${index + 1}`
    item.skuProperties = [{ label: '颜色', value: '透明' }]
    item.description = `${item.title}\n颜色：透明`
  }
  let initial = {
    format: '1688-order-library',
    version: 1,
    exportedAt: new Date().toISOString(),
    orders: [record],
    history: [],
    images: [],
  }
  if (prepared) {
    const fixture = await extension.context.newPage()
    await fixture.goto(`${extension.origin}/unsupported`)
    initial = await fixture.evaluate(
      async ({ initial, origin }) => {
        const { openDatabase } = await import(`${origin}/src/database.js`)
        const { createPreparation } = await import(
          `${origin}/src/packing-model.js`
        )
        const db = await openDatabase()
        await db.restoreBackup(initial)
        const draft = createPreparation(initial.orders[0].snapshot, '2026-10')
        for (const group of draft.groups) {
          group.category = '玻璃'
          group.spanishName = 'ARTÍCULO'
        }
        await db.savePreparation(draft)
        return db.exportBackup()
      },
      { initial, origin: extension.origin }
    )
    await fixture.close()
  }
  const restored = await extension.inspector.evaluate(
    (value) =>
      chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup: value }),
    initial
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-17T04:00:00Z'))
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(3)
  return { page, rows, record, view: page.locator('#packing-view') }
}

const entryIds = (data) =>
  data.preparations.flatMap((draft) =>
    draft.groups.flatMap((group) =>
      group.variants.flatMap((variant) => variant.entryIds)
    )
  )

function selection(rows) {
  return rows.evaluateAll((nodes) =>
    nodes
      .filter((node) => node.getAttribute('aria-selected') === 'true')
      .map((node) => node.dataset.selectionKey)
  )
}

async function controlExclusionWrites(page, mode) {
  await page.evaluate((mode) => {
    window.exclusionWriteMode = mode
    window.exclusionWriteStarted = false
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const exclusion =
        this.name === 'orders' &&
        (Object.hasOwn(args[0] || {}, 'inventoryDispositions') ||
          Object.hasOwn(args[0] || {}, 'inventoryDispositionClears'))
      if (exclusion && window.exclusionWriteMode === 'fail') {
        window.exclusionWriteStarted = true
        throw new DOMException(
          'Synthetic packing eligibility storage unavailable',
          'QuotaExceededError'
        )
      }
      const result = put.apply(this, args)
      if (exclusion && window.exclusionWriteMode === 'hold') {
        window.exclusionWriteStarted = true
        const keepAlive = () => {
          if (window.exclusionWriteMode !== 'hold') return
          const request = this.get([
            args[0].snapshot.accountId,
            args[0].snapshot.orderId,
          ])
          request.onsuccess = keepAlive
        }
        keepAlive()
      }
      return result
    }
  }, mode)
}

async function evidence(page, row) {
  await row.locator('[data-action="review-purchase-evidence"]').click()
  const modal = page.locator('dialog[data-action="review-purchase-evidence"]')
  await expect(modal).toBeVisible()
  return modal
}
async function setDisposition(
  page,
  row,
  kind = 'fee',
  reason = 'Documented synthetic freight-only source row'
) {
  const modal = await evidence(page, row)
  await modal
    .getByLabel('Inventory disposition', { exact: true })
    .selectOption(kind)
  await modal.getByLabel('Evidence reason', { exact: true }).fill(reason)
  await modal.locator('[data-action="save-inventory-disposition"]').click()
  await expect(modal).toBeHidden()
}
const assignedIds = (data) =>
  data.preparations.flatMap((prep) =>
    prep.groups.flatMap((group) =>
      group.variants.flatMap((variant) => variant.entryIds)
    )
  )
function expectSource(after, before) {
  expect(after.orders.map((record) => record.snapshot)).toEqual(
    before.orders.map((record) => record.snapshot)
  )
  expect(after.orders.map((record) => record.productPhotos)).toEqual(
    before.orders.map((record) => record.productPhotos)
  )
}
async function expectCodeReview(page, count) {
  await page.locator('#review-purchase-codes').click()
  const review = page.locator('dialog[data-action="purchase-code-review"]')
  await expect(review.locator('.purchase-code-review-items')).toHaveAttribute(
    'data-row-count',
    String(count)
  )
  return review
}

test('documented fee disposition preserves source finances and selection while one purchase-code review assigns only eligible goods', async ({
  extension,
}) => {
  const { page, rows, record } = await openOrders(extension)
  await page.locator('#search').fill('eligibility')
  await page.locator('#select-rows').click()
  const chosen = await selection(rows),
    before = await backup(extension)
  await setDisposition(page, rows.nth(2))
  expect(await selection(rows)).toEqual(chosen)
  let review = await expectCodeReview(page, 2)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  expect((await backup(extension)).issuedCodes).toEqual(before.issuedCodes)
  review = await expectCodeReview(page, 2)
  const proposed = await review.locator('.purchase-code').allTextContents()
  await review.locator('[data-action="assign-purchase-codes"]').click()
  await expect(review).toBeHidden()
  const after = await backup(extension)
  expect(assignedIds(after).sort()).toEqual(
    record.snapshot.items
      .slice(0, 2)
      .map((item) => item.entryId)
      .sort()
  )
  expect(after.preparations[0].groups.map((group) => group.baseCode)).toEqual(
    proposed
  )
  expect(
    after.orders[0].inventoryDispositions[record.snapshot.items[2].entryId]
  ).toMatchObject({
    kind: 'fee',
    reason: 'Documented synthetic freight-only source row',
  })
  expectSource(after, before)
  await expect(page.locator('#search')).toHaveValue('eligibility')
  expect(await selection(rows)).toEqual(chosen)
  await expect(page.locator('#packing-view')).toBeHidden()
})

test('missing supplier identity blocks assignment until explicit authored evidence while original unavailable supplier text remains intact', async ({
  extension,
}) => {
  const { page, rows, record } = await openOrders(extension, {
      missingSeller: true,
    }),
    before = await backup(extension)
  await page.locator('#select-rows').click()
  await page.locator('#review-purchase-codes').click()
  const blockedReview = page.locator('[data-action="purchase-code-review"]')
  await expect(blockedReview).toContainText(
    'Resolve the original supplier identity'
  )
  await expect(
    blockedReview.locator('[data-action="assign-purchase-codes"]')
  ).toBeDisabled()
  expect((await backup(extension)).issuedCodes).toEqual(before.issuedCodes)
  await blockedReview
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  const modal = await evidence(page, rows.first())
  await modal
    .getByLabel('Authored supplier identity', { exact: true })
    .fill('synthetic-identified-supplier')
  await modal.locator('[data-action="resolve-purchase-supplier"]').click()
  await expect(modal).toBeHidden()
  await assignSelectedPurchaseCodes(page)
  const after = await backup(extension)
  expect(after.orders[0].supplierIdentityResolution).toMatchObject({
    sellerId: 'synthetic-identified-supplier',
    provenance: 'manual-confirmed',
  })
  expect(after.orders[0].snapshot).toEqual(record.snapshot)
  expect(after.preparations).toHaveLength(1)
})

test('container selection has no arbitrary global exclusion or month reassignment path and rejected code rewrites preserve issued identities', async ({
  extension,
}) => {
  const { page } = await openOrders(extension, { prepared: true }),
    before = await backup(extension)
  await expect(
    page.locator(
      '#packing-month,[data-action="prepare-packing-list"],.packing-exclusion-toggle'
    )
  ).toHaveCount(0)
  const error = await extension.inspector.evaluate(async () => {
    const repository = await window.testRepository,
      prep = (await repository.listPreparations())[0]
    prep.month = '2026-12'
    for (const group of prep.groups) {
      group.month = '2026-12'
      group.baseCode = group.baseCode.replace('CE2610', 'CE2612')
    }
    try {
      await repository.savePreparations([prep], {
        expectedRevisions: [prep.revision],
      })
      return null
    } catch (error) {
      return error.message
    }
  })
  expect(error).toMatch(/purchase|month/i)
  const after = await backup(extension)
  expect(after.preparations).toEqual(before.preparations)
  expect(after.issuedCodes).toEqual(before.issuedCodes)
  expectSource(after, before)
})

test('a delayed disposition transaction locks its evidence controls until commit and cannot assign or lose source rows early', async ({
  extension,
}) => {
  const { page, rows, record } = await openOrders(extension)
  await page.locator('#select-rows').click()
  const chosen = await selection(rows),
    modal = await evidence(page, rows.nth(2)),
    save = modal.locator('[data-action="save-inventory-disposition"]')
  await modal
    .getByLabel('Inventory disposition', { exact: true })
    .selectOption('fee')
  await modal
    .getByLabel('Evidence reason', { exact: true })
    .fill('Reviewed freight-only transaction')
  await controlExclusionWrites(page, 'hold')
  try {
    await save.click()
    await expect
      .poll(() => page.evaluate(() => window.exclusionWriteStarted))
      .toBe(true)
    await expect(save).toBeDisabled()
    await expect(
      modal.getByLabel('Inventory disposition', { exact: true })
    ).toBeDisabled()
    await expect(
      modal.getByRole('button', { name: 'Close', exact: true })
    ).toBeDisabled()
    await expect(page.locator('#packing-view')).toBeHidden()
  } finally {
    await page.evaluate(() => {
      window.exclusionWriteMode = ''
    })
  }
  await expect(modal).toBeHidden()
  expect(await selection(rows)).toEqual(chosen)
  expect(
    (await backup(extension)).orders[0].inventoryDispositions[
      record.snapshot.items[2].entryId
    ].kind
  ).toBe('fee')
  const review = await expectCodeReview(page, 2)
  await review.locator('[data-action="assign-purchase-codes"]').click()
  await expect(review).toBeHidden()
  expect(assignedIds(await backup(extension))).not.toContain(
    record.snapshot.items[2].entryId
  )
})

test('failed disposition writes keep goods eligible, retain exact reason/kind and retry atomically without touching codes or source money/photos', async ({
  extension,
}) => {
  const { page, rows, record } = await openOrders(extension),
    before = await backup(extension),
    modal = await evidence(page, rows.nth(2)),
    save = modal.locator('[data-action="save-inventory-disposition"]')
  await modal
    .getByLabel('Inventory disposition', { exact: true })
    .selectOption('fee')
  await modal
    .getByLabel('Evidence reason', { exact: true })
    .fill('Retained exact fee reason')
  await controlExclusionWrites(page, 'fail')
  await save.click()
  await expect(modal.getByRole('status')).toContainText(
    'Synthetic packing eligibility storage unavailable'
  )
  await expect(save).toBeEnabled()
  await expect(
    modal.getByLabel('Evidence reason', { exact: true })
  ).toHaveValue('Retained exact fee reason')
  const failed = await backup(extension)
  expect(
    failed.orders[0].inventoryDispositions?.[
      record.snapshot.items[2].entryId
    ] ?? null
  ).toBe(null)
  expect(failed.issuedCodes).toEqual(before.issuedCodes)
  expectSource(failed, before)
  await page.evaluate(() => {
    window.exclusionWriteMode = ''
  })
  await save.click()
  await expect(modal).toBeHidden()
  expect(
    (await backup(extension)).orders[0].inventoryDispositions[
      record.snapshot.items[2].entryId
    ].reason
  ).toBe('Retained exact fee reason')
})

test('an older source read cannot finish a disposition refresh before the queued committed read is applied', async ({
  extension,
}) => {
  const { page, rows, record } = await openOrders(extension)
  await page.locator('#select-rows').click()
  const modal = await evidence(page, rows.nth(2)),
    save = modal.locator('[data-action="save-inventory-disposition"]')
  await modal
    .getByLabel('Inventory disposition', { exact: true })
    .selectOption('fee')
  await modal
    .getByLabel('Evidence reason', { exact: true })
    .fill('Scoped documented freight')
  await page.evaluate(() => {
    window.holdEligibilityReads = true
    window.heldEligibilityReads = []
    const getAll = IDBIndex.prototype.getAll,
      setSuccess = Object.getOwnPropertyDescriptor(
        IDBRequest.prototype,
        'onsuccess'
      ).set
    IDBIndex.prototype.getAll = function (...args) {
      const request = getAll.apply(this, args)
      if (
        this.objectStore.name === 'orders' &&
        this.name === 'account' &&
        window.holdEligibilityReads
      )
        Object.defineProperty(request, 'onsuccess', {
          configurable: true,
          set(handler) {
            setSuccess.call(request, (event) => {
              window.heldEligibilityReads.push(() =>
                handler.call(request, event)
              )
            })
          },
        })
      return request
    }
    window.dispatchEvent(new Event('focus'))
  })
  await expect
    .poll(() => page.evaluate(() => window.heldEligibilityReads.length))
    .toBe(1)
  await save.click()
  await expect
    .poll(
      async () =>
        (await backup(extension)).orders[0].inventoryDispositions?.[
          record.snapshot.items[2].entryId
        ]?.kind
    )
    .toBe('fee')
  await expect(save).toBeDisabled()
  await page.evaluate(() => window.heldEligibilityReads[0]())
  await expect
    .poll(() => page.evaluate(() => window.heldEligibilityReads.length))
    .toBe(2)
  await expect(save).toBeDisabled()
  await page.evaluate(() => {
    window.holdEligibilityReads = false
    window.heldEligibilityReads[1]()
  })
  await expect(modal).toBeHidden()
  const review = await expectCodeReview(page, 2)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('a refresh failure after committed evidence offers read-only Retry and does not repeat the successful disposition mutation', async ({
  extension,
}) => {
  const { page, rows, record } = await openOrders(extension),
    modal = await evidence(page, rows.nth(2))
  await modal
    .getByLabel('Inventory disposition', { exact: true })
    .selectOption('fee')
  await modal
    .getByLabel('Evidence reason', { exact: true })
    .fill('Committed before refresh failure')
  await page.evaluate(() => {
    window.failEligibilityQuery = true
    const getAll = IDBIndex.prototype.getAll
    IDBIndex.prototype.getAll = function (...args) {
      if (
        this.objectStore.name === 'orders' &&
        this.name === 'account' &&
        window.failEligibilityQuery
      )
        throw new DOMException(
          'Synthetic eligibility query unavailable',
          'UnknownError'
        )
      return getAll.apply(this, args)
    }
  })
  await modal.locator('[data-action="save-inventory-disposition"]').click()
  await expect(modal.getByRole('status')).toContainText(
    'Synthetic eligibility query unavailable'
  )
  const committed = await backup(extension)
  expect(
    committed.orders[0].inventoryDispositions[record.snapshot.items[2].entryId]
      .reason
  ).toBe('Committed before refresh failure')
  await expect(
    modal.locator('[data-action="save-inventory-disposition"]')
  ).toBeDisabled()
  await page.evaluate(() => {
    window.failEligibilityQuery = false
  })
  await modal.locator('[data-action="retry-evidence-refresh"]').click()
  await expect(modal).toBeHidden()
  expect((await backup(extension)).orders[0].inventoryDispositions).toEqual(
    committed.orders[0].inventoryDispositions
  )
  expect((await backup(extension)).orders[0].snapshot).toEqual(record.snapshot)
})

test('explicit fee clearing is keyboard/touch accessible, restores eligible goods and supersedes stale restored exclusion evidence', async ({
  extension,
}) => {
  const { page, rows, record } = await openOrders(extension)
  await page.locator('#select-rows').click()
  const chosen = await selection(rows),
    before = await backup(extension)
  await setDisposition(page, rows.nth(2))
  const older = await backup(extension)
  await page.reload()
  const modal = await evidence(page, rows.nth(2))
  await modal
    .getByLabel('Inventory disposition', { exact: true })
    .selectOption('goods')
  const touch = await extension.context.newCDPSession(page)
  try {
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    await expect
      .poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches))
      .toBe(true)
    const save = modal.locator('[data-action="save-inventory-disposition"]'),
      box = await save.boundingBox()
    expect(box.width).toBeGreaterThanOrEqual(40)
    expect(box.height).toBeGreaterThanOrEqual(40)
    for (const theme of ['dark', 'light']) {
      if (
        (await page
          .locator('meta[name="color-scheme"]')
          .getAttribute('content')) !== theme
      )
        await page.locator('#theme-toggle').evaluate((button) => button.click())
      await modal.screenshot({
        path: test.info().outputPath(`inventory-disposition-${theme}.png`),
      })
    }
    await save.focus()
    await save.press('Enter')
    await expect(modal).toBeHidden()
  } finally {
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await touch.detach()
  }
  const cleared = await backup(extension)
  expect(
    cleared.orders[0].inventoryDispositions?.[
      record.snapshot.items[2].entryId
    ] ?? null
  ).toBe(null)
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    older
  )
  expect(restored.ok, restored.error).toBe(true)
  const after = await backup(extension)
  expect(
    after.orders[0].inventoryDispositions?.[record.snapshot.items[2].entryId] ??
      null
  ).toBe(null)
  expectSource(after, before)
  expect(await selection(rows)).toEqual(chosen)
  const review = await expectCodeReview(page, 3)
  await review.locator('[data-action="assign-purchase-codes"]').click()
  await expect(review).toBeHidden()
  expect(assignedIds(await backup(extension)).sort()).toEqual(
    record.snapshot.items.map((item) => item.entryId).sort()
  )
})

test('fee-only label selection never falls back to saved goods and source code memberships survive documented global dispositions', async ({
  extension,
}) => {
  const { page, rows, record } = await openOrders(extension, {
      prepared: true,
    }),
    before = await backup(extension)
  await setDisposition(page, rows.nth(2))
  await page.locator('#clear-rows').click()
  await rows.nth(2).getByRole('checkbox').check()
  await expect(page.locator('#copy-barcodes')).toBeDisabled()
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  expect((await backup(extension)).issuedCodes).toEqual(before.issuedCodes)
  await setDisposition(
    page,
    rows.nth(0),
    'non-goods',
    'Documented synthetic non-goods service'
  )
  await setDisposition(
    page,
    rows.nth(1),
    'payment-only',
    'Documented synthetic payment-only source'
  )
  await page.reload()
  await expect(rows).toHaveCount(3)
  await page.locator('#select-rows').click()
  await expect(page.locator('#copy-barcodes')).toBeDisabled()
  const after = await backup(extension)
  expect(after.preparations).toEqual(before.preparations)
  expect(after.issuedCodes).toEqual(before.issuedCodes)
  expect(after.orders[0].snapshot).toEqual(record.snapshot)
  expectSource(after, before)
  expect(extension.unexpectedRequests).toEqual([])
})
