import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { writeFile } from 'node:fs/promises'

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
  await page.getByLabel('Packing month', { exact: true }).fill('2026-10')
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

async function skip(row, { keyboard = false } = {}) {
  const action = row.getByRole('button', { name: 'Skip packing', exact: true })
  if (keyboard) {
    await action.focus()
    await action.press('Enter')
  } else {
    await row.hover()
    await expect(action).toHaveCSS('pointer-events', 'auto')
    await action.click()
  }
  await expect(
    row.getByRole('button', {
      name: 'Skipped — include in packing',
      exact: true,
    })
  ).toBeVisible()
  await expect(
    row.getByRole('button', { name: 'Prepare', exact: true })
  ).toHaveCount(0)
}

async function acceptAssignment(page) {
  const review = page.getByRole('dialog', {
    name: 'Assign product codes?',
    exact: true,
  })
  await expect(review).toBeVisible()
  await review
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  await expect(page.locator('#packing-view')).toBeVisible()
  await expect(page.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
}

function expectAssignmentsUnchanged(after, before) {
  for (const field of ['preparations', 'allocations', 'issuedCodes'])
    expect(after[field]).toEqual(before[field])
  expect(after.orders.map((record) => record.snapshot)).toEqual(
    before.orders.map((record) => record.snapshot)
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
        Array.isArray(args[0]?.packingExcludedEntryIds)
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

test('Assign only saves the reviewed eligible codes and helpers while preserving Orders selection and filter', async ({
  extension,
}) => {
  const { page, rows, record, view } = await openOrders(extension)
  const initialRow = await rows.first().elementHandle()
  await page.locator('#search').fill('eligibility')
  await expect
    .poll(() => initialRow.evaluate((node) => node.isConnected))
    .toBe(false)
  await expect(rows).toHaveCount(3)
  await rows.first().focus()
  await page.keyboard.press('Control+a')
  await skip(rows.nth(2))
  const chosen = await selection(rows)
  expect(chosen).toHaveLength(3)
  const before = await backup(extension)
  const review = page.getByRole('dialog', {
    name: 'Assign product codes?',
    exact: true,
  })
  await page.locator('#prepare-orders').click()
  await expect(
    review.getByRole('button', { name: 'Assign only', exact: true })
  ).toBeVisible()
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  expectAssignmentsUnchanged(await backup(extension), before)
  await expect(view).toBeHidden()
  expect(await selection(rows)).toEqual(chosen)
  await page.locator('#prepare-orders').click()
  await expect(review.locator('.packing-review-item')).toHaveCount(2)
  const proposed = await review
    .locator('.packing-review-item')
    .evaluateAll((items) =>
      items.map((item) =>
        Object.fromEntries(
          [...item.querySelectorAll('.packing-value-row')].map((row) => [
            row.querySelector('.packing-value-label').textContent,
            row.querySelector('.packing-value-after .packing-value-content')
              .textContent,
          ])
        )
      )
    )
  expect(
    proposed.some(
      (item) =>
        item['Spanish short name'] && item['Chinese category'] && item.Material
    )
  ).toBe(true)
  await review.getByRole('button', { name: 'Assign only', exact: true }).click()
  await expect(review).toHaveCount(0)
  await expect(view).toBeHidden()
  await expect(page.locator('#orders-view')).toBeVisible()
  await expect(page.locator('#search')).toHaveValue('eligibility')
  expect(await selection(rows)).toEqual(chosen)
  await expect
    .poll(async () => (await backup(extension)).preparations.length)
    .toBe(1)
  const assigned = await backup(extension)
  expect(entryIds(assigned).sort()).toEqual(
    record.snapshot.items
      .slice(0, 2)
      .map((item) => item.entryId)
      .sort()
  )
  for (const group of assigned.preparations[0].groups) {
    const proposal = proposed.find(
      (item) => item['Product code'] === group.baseCode
    )
    expect(proposal).toBeDefined()
    if (group.spanishName)
      expect(group.spanishName).toBe(proposal['Spanish short name'])
    if (group.category)
      expect(group.category).toBe(proposal['Chinese category'])
    for (const variant of group.variants)
      if (variant.material) expect(variant.material).toBe(proposal.Material)
  }
  expect(assigned.orders[0].snapshot).toEqual(record.snapshot)
  await expect(
    rows.nth(2).getByRole('button', {
      name: 'Skipped — include in packing',
      exact: true,
    })
  ).toBeVisible()
  await page.locator('#prepare-orders').click()
  await expect(view).toBeVisible()
  await expect(view.locator('.variants tbody tr')).toHaveCount(2)
  await expect(review).toHaveCount(0)
  const reopened = await backup(extension)
  expect(reopened.issuedCodes).toEqual(assigned.issuedCodes)
  expect(entryIds(reopened)).toEqual(entryIds(assigned))
})

test('Assign only is unavailable when a seller still needs identification', async ({
  extension,
}) => {
  const missing = await openOrders(extension, { missingSeller: true })
  await missing.rows.first().focus()
  await missing.page.keyboard.press('Control+a')
  const before = await backup(extension)
  await missing.page.locator('#prepare-orders').click()
  const missingReview = missing.page.getByRole('dialog', {
    name: 'Assign product codes?',
    exact: true,
  })
  await expect(missingReview).toBeVisible()
  await expect(
    missingReview.getByRole('button', { name: 'Assign only', exact: true })
  ).toHaveCount(0)
  await expect(missingReview).toContainText(
    'Seller login required before assigning codes'
  )
  await missingReview
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  expectAssignmentsUnchanged(await backup(extension), before)
})

test('Assign only is unavailable when existing product codes move to another month', async ({
  extension,
}) => {
  const existing = await openOrders(extension, { prepared: true })
  await existing.rows.first().focus()
  await existing.page.keyboard.press('Control+a')
  await existing.page
    .getByLabel('Packing month', { exact: true })
    .fill('2026-11')
  const assigned = await backup(extension)
  await existing.page.locator('#prepare-orders').click()
  const move = existing.page.getByRole('dialog', {
    name: 'Move selected products to this packing month?',
    exact: true,
  })
  await expect(move).toBeVisible()
  await expect(
    move.getByRole('button', { name: 'Assign only', exact: true })
  ).toHaveCount(0)
  await move.getByRole('button', { name: 'Cancel', exact: true }).click()
  expectAssignmentsUnchanged(await backup(extension), assigned)
})

test('preparation stays unavailable until a delayed skip commits and then immediately excludes that product', async ({
  extension,
}) => {
  const { page, rows, record, view } = await openOrders(extension)
  await rows.first().focus()
  await page.keyboard.press('Control+a')
  const fee = rows.nth(2)
  const action = fee.getByRole('button', { name: 'Skip packing', exact: true })
  await controlExclusionWrites(page, 'hold')
  try {
    await action.focus()
    await action.click()
    await expect
      .poll(() => page.evaluate(() => window.exclusionWriteStarted))
      .toBe(true)
    await expect(action).toHaveAttribute('aria-busy', 'true')
    await expect(page.locator('#prepare-orders')).toBeDisabled()
    await expect(
      rows.getByRole('button', { name: 'Prepare', exact: true })
    ).toHaveCount(3)
    for (const prepare of await rows
      .getByRole('button', { name: 'Prepare', exact: true })
      .all())
      await expect(prepare).toBeDisabled()
    await expect(view).toBeHidden()
    await expect(
      fee.getByRole('button', {
        name: 'Skipped — include in packing',
        exact: true,
      })
    ).toHaveCount(0)
  } finally {
    await page.evaluate(() => {
      window.exclusionWriteMode = ''
    })
  }
  await expect(
    fee.getByRole('button', {
      name: 'Skipped — include in packing',
      exact: true,
    })
  ).toBeVisible()
  await expect(page.locator('#prepare-orders')).toBeEnabled()
  await page.locator('#prepare-orders').click()
  await acceptAssignment(page)
  expect(entryIds(await backup(extension)).sort()).toEqual(
    record.snapshot.items
      .slice(0, 2)
      .map((item) => item.entryId)
      .sort()
  )
})

test('a failed skip keeps its product eligible and the same action can retry successfully', async ({
  extension,
}) => {
  const { page, rows, record } = await openOrders(extension)
  await rows.first().focus()
  await page.keyboard.press('Control+a')
  const chosen = await selection(rows)
  const before = await backup(extension)
  const fee = rows.nth(2)
  const action = fee.getByRole('button', { name: 'Skip packing', exact: true })
  await controlExclusionWrites(page, 'fail')
  await action.focus()
  await action.click()
  await expect
    .poll(() => page.evaluate(() => window.exclusionWriteStarted))
    .toBe(true)
  await expect(
    page.getByText('Synthetic packing eligibility storage unavailable', {
      exact: false,
    })
  ).toBeVisible()
  await expect(action).toBeEnabled()
  await expect(
    fee.getByRole('button', { name: 'Prepare', exact: true })
  ).toBeEnabled()
  await expect(
    fee.getByRole('button', {
      name: 'Skipped — include in packing',
      exact: true,
    })
  ).toHaveCount(0)
  await expect(page.locator('#prepare-orders')).toBeEnabled()
  expect(await selection(rows)).toEqual(chosen)
  const failed = await backup(extension)
  expect(failed.orders[0].packingExcludedEntryIds || []).toEqual([])
  expectAssignmentsUnchanged(failed, before)
  await page.evaluate(() => {
    window.exclusionWriteMode = ''
  })
  await action.click()
  await expect(
    fee.getByRole('button', {
      name: 'Skipped — include in packing',
      exact: true,
    })
  ).toBeVisible()
  expect((await backup(extension)).orders[0].packingExcludedEntryIds).toEqual([
    record.snapshot.items[2].entryId,
  ])
  expect(await selection(rows)).toEqual(chosen)
})

test('an older library read cannot unlock preparation before the committed exclusion is refreshed', async ({
  extension,
}) => {
  const { page, rows, record } = await openOrders(extension)
  await rows.first().focus()
  await page.keyboard.press('Control+a')
  await page.evaluate(() => {
    window.holdEligibilityReads = true
    window.heldEligibilityReads = []
    const getAll = IDBIndex.prototype.getAll
    const setSuccess = Object.getOwnPropertyDescriptor(
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
  const action = rows
    .nth(2)
    .getByRole('button', { name: 'Skip packing', exact: true })
  await action.focus()
  await action.click()
  await expect
    .poll(
      async () => (await backup(extension)).orders[0].packingExcludedEntryIds
    )
    .toEqual([record.snapshot.items[2].entryId])
  await expect(page.locator('#prepare-orders')).toBeDisabled()
  await page.evaluate(() => window.heldEligibilityReads[0]())
  await expect
    .poll(() => page.evaluate(() => window.heldEligibilityReads.length))
    .toBe(2)
  await expect(page.locator('#prepare-orders')).toBeDisabled()
  await page.evaluate(() => {
    window.holdEligibilityReads = false
    window.heldEligibilityReads[1]()
  })
  await expect(
    rows.nth(2).getByRole('button', {
      name: 'Skipped — include in packing',
      exact: true,
    })
  ).toBeVisible()
  await expect(page.locator('#prepare-orders')).toBeEnabled()
  await page.locator('#prepare-orders').click()
  await acceptAssignment(page)
  expect(entryIds(await backup(extension)).sort()).toEqual(
    record.snapshot.items
      .slice(0, 2)
      .map((item) => item.entryId)
      .sort()
  )
})

test('a refresh failure after a committed skip keeps that flag applied and offers a refresh retry', async ({
  extension,
}) => {
  const { page, rows, record } = await openOrders(extension)
  await rows.first().focus()
  await page.keyboard.press('Control+a')
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
  await skip(rows.nth(2))
  const notice = page
    .locator('.error-notice')
    .filter({ hasText: 'Packing selection saved' })
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Synthetic eligibility query unavailable')
  expect((await backup(extension)).orders[0].packingExcludedEntryIds).toEqual([
    record.snapshot.items[2].entryId,
  ])
  await expect(page.locator('#prepare-orders')).toBeEnabled()
  await expect(page.locator('#packing-scope')).toContainText('2 eligible')
  await page.evaluate(() => {
    window.failEligibilityQuery = false
  })
  await notice.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(
    rows.nth(2).getByRole('button', {
      name: 'Skipped — include in packing',
      exact: true,
    })
  ).toBeVisible()
  await page.locator('#prepare-orders').click()
  await acceptAssignment(page)
  expect(entryIds(await backup(extension)).sort()).toEqual(
    record.snapshot.items
      .slice(0, 2)
      .map((item) => item.entryId)
      .sort()
  )
})

test('mixed selection skips a fee without generating codes and including it again restores single-product preparation', async ({
  extension,
}) => {
  const { page, rows, record, view } = await openOrders(extension)
  const fee = rows.nth(2)
  const feeId = record.snapshot.items[2].entryId
  await rows.first().focus()
  await page.keyboard.press('Control+a')
  const chosen = await selection(rows)
  expect(chosen).toHaveLength(3)
  const before = await backup(extension)
  await skip(fee, { keyboard: true })
  expect(await selection(rows)).toEqual(chosen)
  const skipped = await backup(extension)
  expect(skipped.orders[0].packingExcludedEntryIds).toEqual([feeId])
  expectAssignmentsUnchanged(skipped, before)
  await expect(page.locator('#packing-scope')).toContainText('2 eligible')
  await expect(page.locator('#packing-scope')).toContainText('1 skipped')
  for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    if (
      (await page
        .locator('meta[name="color-scheme"]')
        .getAttribute('content')) !== theme
    )
      await page.locator('#theme-toggle').click()
    await rows.first().locator('.row-preparation').hover()
    await page.locator('.table-scroll').screenshot({
      path: test.info().outputPath(`packing-exclusion-${theme}.png`),
    })
    await rows
      .first()
      .getByRole('button', { name: 'Skip packing', exact: true })
      .hover()
    await page.locator('.table-scroll').screenshot({
      path: test.info().outputPath(`packing-exclusion-skip-hover-${theme}.png`),
    })
  }
  await page.setViewportSize({ width: 520, height: 900 })
  await rows.first().hover()
  await page.locator('.table-scroll').screenshot({
    path: test.info().outputPath('packing-exclusion-narrow.png'),
  })
  const controlSizes = () =>
    page.evaluate(() =>
      Object.fromEntries(
        ['packing-skip-button', 'packing-include-button'].map((name) => {
          const button = document.querySelector(`.${name}`)
          const { width, height } = button.getBoundingClientRect()
          return [
            name,
            { width, height, fontSize: getComputedStyle(button).fontSize },
          ]
        })
      )
    )
  const mouseSizes = await controlSizes()
  const touch = await extension.context.newCDPSession(page)
  try {
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    await expect
      .poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches))
      .toBe(true)
    await page.mouse.move(0, 0)
    await expect(
      rows.first().getByRole('button', { name: 'Skip packing', exact: true })
    ).toHaveCSS('opacity', '1')
    await expect(
      fee.getByRole('button', {
        name: 'Skipped — include in packing',
        exact: true,
      })
    ).toBeVisible()
    await page.locator('.table-scroll').screenshot({
      path: test.info().outputPath('packing-exclusion-coarse.png'),
    })
    const measurements = JSON.stringify({
      mouse: mouseSizes,
      coarse: await controlSizes(),
    })
    await test.info().attach('compact-packing-controls', {
      body: measurements,
      contentType: 'application/json',
    })
    await writeFile(
      test.info().outputPath('packing-control-sizes.json'),
      measurements
    )
  } finally {
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await touch.detach()
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.locator('#prepare-orders').click()
  const review = page.getByRole('dialog', {
    name: 'Assign product codes?',
    exact: true,
  })
  await expect(review).toContainText('2 selected product rows')
  await expect(review).not.toContainText('补运费 货品差价')
  await acceptAssignment(page)
  await expect(view.locator('.variants tbody tr')).toHaveCount(2)
  const assigned = await backup(extension)
  expect(entryIds(assigned).sort()).toEqual(
    record.snapshot.items
      .slice(0, 2)
      .map((item) => item.entryId)
      .sort()
  )
  expect(entryIds(assigned)).not.toContain(feeId)
  expect(assigned.orders[0].snapshot).toEqual(record.snapshot)
  await view.page().locator('#view-orders').click()
  await page.reload()
  await expect(
    fee.getByRole('button', {
      name: 'Skipped — include in packing',
      exact: true,
    })
  ).toBeVisible()
  expect((await backup(extension)).orders[0].packingExcludedEntryIds).toEqual([
    feeId,
  ])
  await fee.focus()
  await page.keyboard.press('Space')
  const selectedBeforeInclude = await selection(rows)
  await fee
    .getByRole('button', { name: 'Skipped — include in packing', exact: true })
    .click()
  expect(await selection(rows)).toEqual(selectedBeforeInclude)
  await expect(
    fee.getByRole('button', { name: 'Prepare', exact: true })
  ).toBeVisible()
  expect(
    (await backup(extension)).orders[0].packingExcludedEntryIds || []
  ).toEqual([])
  await fee.getByRole('button', { name: 'Prepare', exact: true }).click()
  await expect(review).toContainText('1 selected product rows')
  await expect(review).toContainText('补运费 货品差价')
  await acceptAssignment(page)
  expect(entryIds(await backup(extension)).sort()).toEqual(
    record.snapshot.items.map((item) => item.entryId).sort()
  )
  expect(extension.unexpectedRequests).toEqual([])
})

test('skipped-only selection never falls back to saved packing and unselected reopening excludes skipped rows', async ({
  extension,
}) => {
  const { page, rows, record, view } = await openOrders(extension, {
    prepared: true,
  })
  const before = await backup(extension)
  const fee = rows.nth(2)
  await skip(fee)
  expectAssignmentsUnchanged(await backup(extension), before)
  await fee.focus()
  await page.keyboard.press('Space')
  expect(await selection(rows)).toEqual([
    `${record.snapshot.orderId}/${record.snapshot.items[2].entryId}`,
  ])
  await expect(page.locator('#prepare-orders')).toBeDisabled()
  await expect(page.locator('#packing-scope')).toContainText('0 eligible')
  await expect(page.locator('#packing-scope')).toContainText('1 skipped')
  await expect(view).toBeHidden()
  await fee.focus()
  await page.keyboard.press('Control+d')
  expect(await selection(rows)).toEqual([])
  await expect(page.locator('#prepare-orders')).toBeEnabled()
  await page.locator('#prepare-orders').click()
  await expect(view).toBeVisible()
  await expect(view.locator('.variants tbody tr')).toHaveCount(2)
  await expect(view).not.toContainText('补运费 货品差价')
  await expect(
    page.getByRole('dialog', { name: 'Assign product codes?', exact: true })
  ).toHaveCount(0)
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  const reopened = await backup(extension)
  const assignedCodes = (data) =>
    data.issuedCodes.map(({ kind, code, groupId, variantId }) => ({
      kind,
      code,
      groupId,
      variantId,
    }))
  // Reopening may refresh names/material suggestions and the saved revision,
  // but excluded products retain their existing source membership and codes.
  expect(entryIds(reopened)).toEqual(entryIds(before))
  expect(assignedCodes(reopened)).toEqual(assignedCodes(before))
  expect(reopened.orders[0].snapshot).toEqual(record.snapshot)
  await view.page().locator('#view-orders').click()
  await skip(rows.nth(0))
  await skip(rows.nth(1))
  expectAssignmentsUnchanged(await backup(extension), reopened)
  await expect(page.locator('#prepare-orders')).toBeDisabled()
  await expect(page.locator('#packing-scope')).toContainText('3 skipped')
  await page.reload()
  await expect(
    rows.getByRole('button', {
      name: 'Skipped — include in packing',
      exact: true,
    })
  ).toHaveCount(3)
  await expect(page.locator('#prepare-orders')).toBeDisabled()
  await expect(view).toBeHidden()
  expectAssignmentsUnchanged(await backup(extension), reopened)
  expect(extension.unexpectedRequests).toEqual([])
})
