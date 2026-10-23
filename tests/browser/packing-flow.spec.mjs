import { revealCopyActions } from './copy-actions-helpers.mjs'
import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { UI_MESSAGES } from '../../src/ui-messages.js'
import { preparationColumns } from '../../src/preparation-clipboard.js'
import {
  assignSelectedPurchaseCodes,
  editOrderProduct,
  closeOrderProduct,
  libraryBackup as backup,
  createContainerThroughUI,
  sealContainerThroughUI,
} from './smart-workspace-helpers.mjs'

async function seedOrders(extension, count = 1) {
  const records = (
    await extension.inspector.evaluate(
      `(${createDemoRecords.toString()})(document)`
    )
  ).slice(0, count)
  for (const [orderIndex, record] of records.entries()) {
    const order = record.snapshot
    order.orderId = [
      '5127523670009019539',
      '5127523670009019540',
      '5127523670009019541',
    ][orderIndex]
    order.sourceUrl = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${order.orderId}`
    order.purchasedAt = [
      '2026-10-12T10:15:00+08:00',
      '2026-09-18T10:15:00+08:00',
      '2026-11-01T10:15:00+08:00',
    ][orderIndex]
    order.sellerName = `Synthetic packing store ${orderIndex + 1}`
    order.sellerMemberLogin = `synthetic-packing-store-${orderIndex + 1}`
    for (const [index, item] of order.items.entries()) {
      item.title = index < 2 ? '合成玻璃罐' : '合成收纳盒'
      item.productNumber = index < 2 ? 'TEST-JAR' : 'TEST-BOX'
      item.skuProperties = [
        { label: '颜色', value: '透明', raw: '颜色：透明' },
        ...(index < 2
          ? [
              {
                label: '尺寸',
                value: index === 0 ? '300ml' : '500ml',
                raw: index === 0 ? '尺寸：300ml' : '尺寸：500ml',
              },
            ]
          : []),
      ]
      item.description = [
        item.title,
        ...item.skuProperties.map((property) => property.raw),
        `货号：${item.productNumber}`,
      ].join('\n')
    }
  }
  const restored = await extension.inspector.evaluate(
    (orders) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders,
          history: [],
          images: [],
        },
      }),
    records
  )
  expect(restored.ok, restored.error).toBe(true)
  return records
}

async function openLibrary(extension, count = 1) {
  const records = await seedOrders(extension, count)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const expectedKeys = records.flatMap((record) =>
    record.snapshot.items.map((item) =>
      JSON.stringify([
        record.accountId || record.snapshot.accountId || 'local',
        record.snapshot.orderId,
        item.entryId,
      ])
    )
  )
  const sourceRows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(sourceRows).toHaveCount(expectedKeys.length)
  expect(
    await sourceRows.evaluateAll((nodes) =>
      nodes.map((node) => node.dataset.selectionKey).sort()
    )
  ).toEqual(expectedKeys.sort())
  return { page, records, view: page.locator('#packing-view') }
}

async function selectAllProducts(page) {
  await page.locator('#sheet-body tr[data-selection-key]').first().focus()
  await page.keyboard.press('Control+a')
}

async function assignSelection(page) {
  await assignSelectedPurchaseCodes(page)
  return page.locator('#orders-view')
}

test('copy column choices and Headers survive copying, reopening and a page reload', async ({
  extension,
}) => {
  const { page } = await openLibrary(extension)
  await selectAllProducts(page)
  const view = await assignSelection(page)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await revealCopyActions(page)
  await view
    .getByRole('button', { name: 'Copy preparation columns', exact: true })
    .click()
  const columns = page.locator('.preparation-column-dialog')
  await expect(columns).toHaveRole('dialog')
  await expect(columns).toHaveAccessibleName(
    /^Copy (?:selected|container|\d+) product rows$/
  )
  const chosen = ['Product code', 'Barcode', 'Quantity']
  const excluded = [
    'Description',
    'Spanish description',
    'Size',
    'Size code',
    'Price',
    'Discount',
  ]
  for (const name of excluded)
    await columns.getByRole('checkbox', { name, exact: true }).uncheck()
  await columns.getByRole('checkbox', { name: 'Headers', exact: true }).check()
  await columns
    .getByRole('button', { name: 'Copy chosen columns', exact: true })
    .click()
  await expect(
    columns.getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  const rows = text.split('\r\n').map((row) => row.split('\t'))
  expect(rows).toHaveLength(4)
  expect(rows[0]).toEqual(chosen)
  expect(rows.every((row) => row.length === 3)).toBe(true)
  expect(rows[1][0]).toMatch(/^CE2610\d{4}$/)
  expect(rows[2][0]).toBe('')
  expect(rows[1][2]).toBe('40')
  async function retainedChoices() {
    for (const name of chosen)
      await expect(
        columns.getByRole('checkbox', { name, exact: true })
      ).toBeChecked()
    for (const name of excluded)
      await expect(
        columns.getByRole('checkbox', { name, exact: true })
      ).not.toBeChecked()
    await expect(
      columns.getByRole('checkbox', { name: 'Headers', exact: true })
    ).toBeChecked()
  }
  await retainedChoices()
  await columns.getByRole('button', { name: 'Close', exact: true }).click()
  await revealCopyActions(page)
  await view
    .getByRole('button', { name: 'Copy preparation columns', exact: true })
    .click()
  await retainedChoices()
  await columns.getByRole('button', { name: 'Close', exact: true }).click()
  await view.page().locator('#view-orders').click()
  await revealCopyActions(page)
  await expect(
    page.getByRole('checkbox', { name: 'Headers', exact: true })
  ).toBeChecked()
  await page.reload()
  await revealCopyActions(page)
  await expect(
    page.getByRole('checkbox', { name: 'Headers', exact: true })
  ).toBeChecked()
  await revealCopyActions(page)
  await page
    .getByRole('button', { name: 'Copy preparation columns', exact: true })
    .click()
  await retainedChoices()
  await columns
    .getByRole('button', { name: 'Copy chosen columns', exact: true })
    .click()
  await expect(
    columns.getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text)
  await expect(
    page.getByRole('dialog', { name: 'Confirm operation', exact: true })
  ).not.toBeVisible()
  expect(extension.unexpectedRequests).toEqual([])
})

test('chosen size columns preserve source dimensions and separate saved barcode endings in Products and packing', async ({
  extension,
}) => {
  const { page } = await openLibrary(extension)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  // Existing preferences must not silently include newly introduced columns.
  await page.evaluate(() =>
    localStorage.setItem(
      '1688-packing-copy-columns',
      JSON.stringify(['quantity'])
    )
  )
  await revealCopyActions(page)
  await page
    .getByRole('button', { name: 'Copy preparation columns', exact: true })
    .click()
  const columns = page.locator('.preparation-column-dialog')
  await expect(columns).toHaveRole('dialog')
  await expect(columns).toHaveAccessibleName(
    /^Copy (?:selected|container|\d+) product rows$/
  )
  for (const name of ['Size', 'Size code']) {
    await expect(
      columns.getByRole('checkbox', { name, exact: true })
    ).not.toBeChecked()
    await columns.getByRole('checkbox', { name, exact: true }).check()
  }
  await columns
    .getByRole('checkbox', { name: 'Quantity', exact: true })
    .uncheck()
  await columns.getByRole('checkbox', { name: 'Headers', exact: true }).check()
  await columns
    .getByRole('button', { name: 'Copy chosen columns', exact: true })
    .click()
  await expect(
    columns.getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Size\tSize code\r\n300ml\t\r\n500ml\t\r\n\t'
  )
  await columns.getByRole('button', { name: 'Close', exact: true }).click()
  // A role locator excludes a closed dialog before its queued cleanup runs.
  // Wait for the DOM node, including its Packing month checkbox, to be removed.
  await expect(page.locator('.preparation-column-dialog')).toHaveCount(0)
  await selectAllProducts(page)
  const view = await assignSelection(page)
  await closeOrderProduct(
    await editOrderProduct(page, 0, { 'Size ending': 'XS' })
  )
  await revealCopyActions(page)
  await view
    .getByRole('button', { name: 'Copy preparation columns', exact: true })
    .click()
  for (const name of ['Size', 'Size code', 'Headers'])
    await expect(
      columns.getByRole('checkbox', { name, exact: true })
    ).toBeChecked()
  await expect(
    columns.getByRole('checkbox', { name: 'Quantity', exact: true })
  ).not.toBeChecked()
  await columns
    .getByRole('button', { name: 'Copy chosen columns', exact: true })
    .click()
  await expect(
    columns.getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible()
  const expected = 'Size\tSize code\r\n300ml\tXS\r\n500ml\tL\r\n\t'
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    expected
  )
  await columns.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('.preparation-column-dialog')).toHaveCount(0)
  await view.page().locator('#view-orders').click()
  await page.reload()
  await revealCopyActions(page)
  await page
    .getByRole('button', { name: 'Copy preparation columns', exact: true })
    .click()
  for (const name of ['Size', 'Size code', 'Headers'])
    await expect(
      columns.getByRole('checkbox', { name, exact: true })
    ).toBeChecked()
  await columns
    .getByRole('button', { name: 'Copy chosen columns', exact: true })
    .click()
  await expect(
    columns.getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    expected
  )
  expect(extension.unexpectedRequests).toEqual([])
})

test('chosen columns search, keyboard selection and paste order persist with translated headers', async ({
  extension,
}) => {
  const { page, records } = await openLibrary(extension)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await revealCopyActions(page)
  await page.locator('#copy-preparation').click()
  const columns = page.locator('.preparation-column-dialog')
  await expect(columns).toHaveRole('dialog')
  await expect(columns).toHaveAccessibleName(
    /^Copy (?:selected|container|\d+) product rows$/
  )
  const search = columns.getByRole('combobox', { name: 'Search columns' })
  const copy = columns.getByRole('button', {
    name: 'Copy chosen columns',
    exact: true,
  })
  await columns
    .getByRole('button', { name: 'Clear columns', exact: true })
    .click()
  await expect(copy).toBeDisabled()
  await search.fill('qunatity')
  await expect(
    columns.getByRole('checkbox', { name: 'Quantity', exact: true })
  ).toBeVisible()
  await expect(search).toHaveAttribute('aria-expanded', 'true')
  await search.press('ArrowDown')
  await search.press('Enter')
  await expect(search).toHaveValue('Quantity')
  for (const [query, label] of [
    ['color', 'Original color'],
    ['order', 'Order number'],
    ['tags', 'Product tags'],
    ['quantity', 'Quantity'],
  ]) {
    await search.fill(query)
    const checkbox = columns.getByRole('checkbox', { name: label, exact: true })
    await checkbox.focus()
    await page.keyboard.press('Space')
    await expect(checkbox).toBeChecked()
  }
  await search.fill('')
  await columns
    .getByRole('button', { name: 'Move Quantity left', exact: true })
    .click()
  const order = ['sourceColor', 'orderId', 'quantity', 'productTags']
  await expect(columns.locator('.preparation-selected-columns li')).toHaveCount(
    4
  )
  expect(
    await columns
      .locator('.preparation-selected-columns li')
      .evaluateAll((rows) => rows.map((row) => row.dataset.column))
  ).toEqual(order)
  await columns.getByRole('checkbox', { name: 'Headers', exact: true }).check()
  const headings = [
    'Original color',
    'Order number',
    'Quantity',
    'Product tags',
  ]
  const source = records[0]
  const values = source.snapshot.items.map((item) =>
    [
      '透明',
      source.snapshot.orderId,
      item.quantity,
      (source.productTags?.[item.entryId] || []).join(' · '),
    ].join('\t')
  )
  await copy.click()
  await expect(
    columns.getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    [headings.join('\t'), ...values].join('\r\n')
  )
  await columns.getByRole('button', { name: 'Close', exact: true }).click()
  await page.reload()
  for (const language of ['es', 'zh']) {
    const translated = (key) => UI_MESSAGES[key]?.[language] || key
    await page.locator(`#language-toggle [data-language=${language}]`).click()
    await revealCopyActions(page)
    await page.locator('#copy-preparation').click()
    expect(
      await columns
        .locator('.preparation-selected-columns li')
        .evaluateAll((rows) => rows.map((row) => row.dataset.column))
    ).toEqual(order)
    await columns
      .getByRole('button', {
        name: translated('Copy chosen columns'),
        exact: true,
      })
      .click()
    await expect(
      columns.getByRole('button', { name: translated('Copied'), exact: true })
    ).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      [headings.map(translated).join('\t'), ...values].join('\r\n')
    )
    await page.keyboard.press('Escape')
    await expect(columns).toHaveCount(0)
  }
  await page.locator('#language-toggle [data-language=en]').click()
  await revealCopyActions(page)
  await page.locator('#copy-preparation').click()
  await columns
    .getByRole('button', { name: 'Restore default columns', exact: true })
    .click()
  await expect(
    columns.locator('.preparation-column-groups input:checked')
  ).toHaveCount(7)
  await columns
    .getByRole('button', { name: 'Select all columns', exact: true })
    .click()
  await expect(
    columns.locator('.preparation-column-groups input:checked')
  ).toHaveCount(preparationColumns.length)
  await expect(
    columns.getByRole('checkbox', { name: 'Pcs/box', exact: true })
  ).toBeChecked()
  expect(extension.unexpectedRequests).toEqual([])
})

test('order details copies the complete order number with visible success feedback', async ({
  extension,
}) => {
  const { page, records } = await openLibrary(extension)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page
    .locator(
      `.order-card[data-order-id="${records[0].snapshot.orderId}"] .order-details-trigger`
    )
    .click()
  const details = page.locator('#order-details')
  await expect(details).toBeVisible()
  const copy = details.locator('.order-detail-identity button')
  await expect(copy).toHaveAccessibleName(
    `Copy order number: ${records[0].snapshot.orderId}`
  )
  await copy.click()
  await expect(copy.locator('.copy-text-feedback')).toHaveText('Copied')
  await expect(copy.locator('.copy-text-feedback')).toBeVisible()
  await expect(copy).toHaveAccessibleName(
    `Copy order number: ${records[0].snapshot.orderId}`
  )
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    records[0].snapshot.orderId
  )
  await expect(copy).toContainText(records[0].snapshot.orderId)
  expect(extension.unexpectedRequests).toEqual([])
})

test('Ctrl+A reviews all selected purchase months, Cancel reserves nothing and assignment uses each original month', async ({
  extension,
}) => {
  const { page, records } = await openLibrary(extension, 3)
  await selectAllProducts(page)
  const sourceCount = records.reduce(
    (count, record) => count + record.snapshot.items.length,
    0
  )
  await expect(page.locator('#selection-summary')).toContainText(
    `${sourceCount} selected`
  )
  const before = await backup(extension)
  await page.locator('#review-purchase-codes').click()
  const review = page.locator('dialog[data-action="purchase-code-review"]')
  await expect(review).toContainText('original purchase month')
  for (const [index, period] of ['2610', '2609', '2611'].entries())
    await expect(
      review
        .locator(
          `[data-order-id="${records[index].snapshot.orderId}"] .purchase-code`
        )
        .first()
    ).toHaveText(new RegExp(`^CE${period}\\d{4}`))
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  const cancelled = await backup(extension)
  expect(cancelled.preparations).toEqual(before.preparations)
  expect(cancelled.issuedCodes).toEqual(before.issuedCodes)
  await assignSelectedPurchaseCodes(page)
  const assigned = await backup(extension)
  for (const [index, period] of ['2610', '2609', '2611'].entries()) {
    const preparation = assigned.preparations.find(
      (prep) => prep.orderId === records[index].snapshot.orderId
    )
    expect(
      preparation.groups.every((group) =>
        group.baseCode.startsWith(`CE${period}`)
      )
    ).toBe(true)
  }
  expect(assigned.orders).toEqual(before.orders)
  await expect(
    page.locator('[data-action="prepare-packing-list"],#packing-month')
  ).toHaveCount(0)
})

test('splitting one selected source row reviews only that membership and retains unselected codes, quantities and prices', async ({
  extension,
}) => {
  const { page, records } = await openLibrary(extension)
  await selectAllProducts(page)
  await assignSelectedPurchaseCodes(page)
  const before = await backup(extension),
    [oldJar, oldBox] = before.preparations[0].groups
  await page.locator('#clear-rows').click()
  await page
    .locator('#sheet-body tr[data-selection-key]')
    .first()
    .getByRole('checkbox')
    .check()
  const split = async () => {
    await page.locator('#group-order-products').click()
    await page
      .locator('.orders-grouping-dialog')
      .getByRole('button', { name: 'Move to new product', exact: true })
      .click()
  }
  await split()
  const review = page.getByRole('dialog', {
    name: 'Review product grouping',
    exact: true,
  })
  await expect(review).toContainText(oldJar.baseCode)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  expect((await backup(extension)).issuedCodes).toEqual(before.issuedCodes)
  await page
    .locator('.orders-grouping-dialog')
    .getByRole('button', { name: 'Move to new product', exact: true })
    .click()
  await review
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(review).toBeHidden()
  await expect(page.locator('.orders-grouping-dialog')).toBeHidden()
  const after = await backup(extension)
  const groupFor = (entryId) =>
    after.preparations[0].groups.find((group) =>
      group.variants.some((variant) => variant.entryIds.includes(entryId))
    )
  expect(groupFor(records[0].snapshot.items[0].entryId).baseCode).not.toBe(
    oldJar.baseCode
  )
  expect(groupFor(records[0].snapshot.items[1].entryId).baseCode).toBe(
    oldJar.baseCode
  )
  expect(groupFor(records[0].snapshot.items[2].entryId).baseCode).toBe(
    oldBox.baseCode
  )
  expect(after.orders).toEqual(before.orders)
  const owners = (data) =>
    data.issuedCodes
      .filter((code) => code.code === oldJar.baseCode)
      .map(({ ownerSnapshot, ...owner }) => owner)
  expect(owners(after)).toEqual(owners(before))
})

test('released unconsumed codes are reusable and an active conflict identifies the saved owner before correction', async ({
  extension,
}) => {
  const { page } = await openLibrary(extension)
  await selectAllProducts(page)
  await assignSelectedPurchaseCodes(page)
  const original = await backup(extension),
    released = original.preparations[0].groups[1].baseCode
  await closeOrderProduct(
    await editOrderProduct(page, 2, { 'Product code': 'CE26109998' })
  )
  await closeOrderProduct(
    await editOrderProduct(page, 0, { 'Product code': released })
  )
  const reused = await backup(extension)
  expect(reused.preparations[0].groups[0].baseCode).toBe(released)
  const editor = await editOrderProduct(page, 0, {
    'Product code': 'CE26109998',
  })
  await expect(
    editor.getByRole('textbox', { name: 'Product code', exact: true })
  ).toHaveAttribute('aria-invalid', 'true')
  await editor
    .getByRole('button', { name: 'Resolve code conflict', exact: true })
    .click()
  const resolver = page.locator('.code-conflict-dialog')
  await expect(resolver.locator('.conflict-owner-card')).toContainText(
    original.preparations[0].orderId
  )
  await expect(
    resolver
      .locator('.conflict-owner-card')
      .getByRole('textbox', { name: 'Product code', exact: true })
  ).toHaveValue('CE26109998')
  await expect(resolver.locator('.preparation-photo')).toHaveCount(2)
  await resolver
    .getByRole('button', { name: 'Use next available code', exact: true })
    .click()
  expect((await backup(extension)).preparations).toEqual(reused.preparations)
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver).toBeHidden()
  const after = await backup(extension)
  expect(after.preparations[0].groups[0].baseCode).not.toBe('CE26109998')
  expect(after.preparations[0].groups[1].baseCode).toBe('CE26109998')
  expect(
    after.issuedCodes.find(
      (code) =>
        code.kind === 'base' &&
        code.code === after.preparations[0].groups[0].baseCode
    ).groupId
  ).toBe(original.preparations[0].groups[0].id)
  expect(after.orders).toEqual(original.orders)
})

test('whole-order inclusion ignores product selection and begins Unconfirmed without moving any purchase codes', async ({
  extension,
}) => {
  const { page, records } = await openLibrary(extension, 2)
  await selectAllProducts(page)
  await assignSelectedPurchaseCodes(page)
  const before = await backup(extension)
  await page.locator('#clear-rows').click()
  await page
    .locator('#sheet-body tr[data-selection-key]')
    .first()
    .getByRole('checkbox')
    .check()
  const refs = records.map((record) => ({
    accountId: 'local',
    orderId: record.snapshot.orderId,
  }))
  const id = await createContainerThroughUI(
    page,
    refs,
    'November shipment, original purchase codes'
  )
  const included = await extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerView({ id }),
    id
  )
  expect(included.orders.map((order) => order.orderId).sort()).toEqual(
    refs.map((ref) => ref.orderId).sort()
  )
  expect(
    included.cartons.every((carton) => carton.state === 'unconfirmed')
  ).toBe(true)
  const after = await backup(extension)
  expect(after.preparations).toEqual(before.preparations)
  expect(after.issuedCodes).toEqual(before.issuedCodes)
  expect(after.orders).toEqual(before.orders)
  await expect(
    page.locator(
      '#packing-view .group-code-editor,.reorder-handle,[data-action="organize-packing"]'
    )
  ).toHaveCount(0)
})

test('sealed history keeps earlier authored names and prices while a correction uses a distinct revision', async ({
  extension,
}) => {
  const { page, records } = await openLibrary(extension)
  await selectAllProducts(page)
  await assignSelectedPurchaseCodes(page)
  await closeOrderProduct(
    await editOrderProduct(page, 0, {
      'Spanish name': 'ORIGINAL SHIPMENT NAME',
    })
  )
  const ref = { accountId: 'local', orderId: records[0].snapshot.orderId }
  await extension.inspector.evaluate(async (ref) => {
    const repository = await window.testRepository
    let context = await repository.getOrderReconciliation(ref)
    await repository.updateOrderCapacities({
      ...ref,
      values: Object.fromEntries(
        context.record.snapshot.items.map((item) => [
          item.entryId,
          item.quantity,
        ])
      ),
      expectedValues: Object.fromEntries(
        context.record.snapshot.items.map((item) => [item.entryId, null])
      ),
      expectedObservedAt: context.record.snapshot.observedAt,
    })
    context = await repository.getOrderReconciliation(ref)
    await repository.confirmOrderCartons({
      ...ref,
      draft: window.testPlanner.createReconciliationDraft(context),
      expectedRevisions: context.revisions,
      intentId: crypto.randomUUID(),
    })
  }, ref)
  const id = await createContainerThroughUI(page, [ref])
  await sealContainerThroughUI(page)
  const frozen = await extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerManifest({ id }),
    id
  )
  expect(
    frozen.products.some((row) => row.spanishName === 'ORIGINAL SHIPMENT NAME')
  ).toBe(true)
  // A direct ordinary edit must not rewrite consumed identity or historical values.
  const rejected = await extension.inspector.evaluate(async (ref) => {
    const repository = await window.testRepository,
      context = await repository.getOrderReconciliation(ref),
      draft = structuredClone(context.preparation)
    draft.groups[0].baseCode = 'CE26109998'
    try {
      await repository.savePreparations([draft], {
        expectedRevisions: [draft.revision],
      })
      return null
    } catch (error) {
      return error.message
    }
  }, ref)
  expect(rejected).toMatch(/amend|consum|seal|frozen/i)
  expect(
    await extension.inspector.evaluate(
      async ({ id, revisionId }) =>
        (await window.testRepository).getContainerManifest({ id, revisionId }),
      { id, revisionId: frozen.revisionId }
    )
  ).toEqual(frozen)
})

test('mixed valid and unidentified-supplier code review blocks every write and preserves source purchase months', async ({
  extension,
}) => {
  const records = await seedOrders(extension, 2)
  delete records[1].snapshot.sellerMemberLogin
  records[1].snapshot.sellerName = 'Seller unavailable'
  records[1].snapshot.sellerUnavailable = true
  records[1].snapshot.observedAt = '2099-01-01T00:00:00Z'
  const restored = await extension.inspector.evaluate(
    (orders) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders,
          history: [],
          images: [],
        },
      }),
    records
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await selectAllProducts(page)
  const before = await backup(extension)
  await page.locator('#review-purchase-codes').click()
  const review = page.locator('[data-action="purchase-code-review"]')
  await expect(review).toContainText(/supplier|seller/i)
  await expect(
    review.locator('[data-action="assign-purchase-codes"]')
  ).toBeDisabled()
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  expect((await backup(extension)).issuedCodes).toEqual(before.issuedCodes)
  expect((await backup(extension)).orders).toEqual(before.orders)
})

for (const editedIndex of [0, 1])
  test(`duplicate barcode recovery retains the base and changes only edited variant ${editedIndex + 1}`, async ({
    extension,
  }) => {
    const { page } = await openLibrary(extension)
    await selectAllProducts(page)
    await assignSelectedPurchaseCodes(page)
    const before = await backup(extension),
      group = before.preparations[0].groups[0],
      unchangedIndex = 1 - editedIndex,
      collisionSize = group.variants[unchangedIndex].sizeSuffix
    const editor = await editOrderProduct(page, editedIndex, {
      'Size ending': collisionSize,
    })
    await expect(
      editor.getByRole('textbox', { name: 'Size ending', exact: true })
    ).toHaveAttribute('aria-invalid', 'true')
    expect((await backup(extension)).preparations).toEqual(before.preparations)
    expect((await backup(extension)).issuedCodes).toEqual(before.issuedCodes)
    await editor
      .getByRole('button', { name: 'Resolve code conflict', exact: true })
      .click()
    const resolver = page.locator('.code-conflict-dialog')
    await expect(resolver).toContainText(`${group.baseCode}${collisionSize}`)
    await resolver
      .getByRole('button', {
        name: 'Use next available variant code',
        exact: true,
      })
      .click()
    expect((await backup(extension)).preparations).toEqual(before.preparations)
    await resolver
      .getByRole('button', { name: 'Apply corrections', exact: true })
      .click()
    await expect(resolver).toBeHidden()
    const after = await backup(extension),
      resolved = after.preparations[0].groups[0],
      edited = resolved.variants[editedIndex]
    expect(resolved.baseCode).toBe(group.baseCode)
    expect(resolved.variants[unchangedIndex]).toEqual(
      group.variants[unchangedIndex]
    )
    expect(edited.id).toBe(group.variants[editedIndex].id)
    expect(edited.sizeSuffix).toBe(collisionSize)
    expect(edited.variantSuffix).toMatch(/^[A-Z]+$/)
    expect(after.issuedCodes).toContainEqual(
      expect.objectContaining({
        kind: 'barcode',
        code: group.baseCode + edited.variantSuffix + edited.sizeSuffix,
        variantId: edited.id,
      })
    )
    const old = group.variants[editedIndex]
    expect(
      after.issuedCodes.some(
        (code) =>
          code.kind === 'barcode' &&
          code.code === group.baseCode + old.variantSuffix + old.sizeSuffix
      )
    ).toBe(false)
    expect(after.orders).toEqual(before.orders)
  })
