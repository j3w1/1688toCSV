import {
  revealCopyActions,
  copyCurrentImageBatch,
} from './copy-actions-helpers.mjs'
import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { UI_MESSAGES } from '../../src/ui-messages.js'
import { readFile } from 'node:fs/promises'

const codeOwners = (codes) =>
  codes
    .map(({ ownerSnapshot, ...owner }) => owner)
    .sort((a, b) =>
      `${a.kind}/${a.code}/${a.groupId}/${a.variantId || ''}`.localeCompare(
        `${b.kind}/${b.code}/${b.groupId}/${b.variantId || ''}`
      )
    )

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
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  return { page, records, view: page.locator('#packing-view') }
}

async function selectAllProducts(page) {
  await page.locator('#sheet-body tr[data-selection-key]').first().focus()
  await page.keyboard.press('Control+a')
}

async function backup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}

async function prepareSelected(page, month = '2026-10') {
  await page
    .locator('#orders-view')
    .getByLabel('Packing month', { exact: true })
    .fill(month)
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  const review = page.getByRole('dialog', {
    name: 'Assign product codes?',
    exact: true,
  })
  await expect(review).toBeVisible()
  await review
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const view = page.locator('#packing-view')
  await expect(view).toBeVisible()
  await expect(page.locator('#orders-view')).toBeHidden()
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  return view
}

test('copy column choices and Headers survive copying, reopening and a page reload', async ({
  extension,
}) => {
  const { page } = await openLibrary(extension)
  await selectAllProducts(page)
  const view = await prepareSelected(page)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await revealCopyActions(page)
  await view.getByRole('button', { name: 'Copy columns', exact: true }).click()
  const columns = page.getByRole('dialog', {
    name: 'Copy preparation columns',
    exact: true,
  })
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
  await view.getByRole('button', { name: 'Copy columns', exact: true }).click()
  await retainedChoices()
  await columns.getByRole('button', { name: 'Close', exact: true }).click()
  await view.getByRole('button', { name: 'Orders', exact: true }).click()
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
  const columns = page.getByRole('dialog', {
    name: 'Copy preparation columns',
    exact: true,
  })
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
  const view = await prepareSelected(page)
  await view
    .locator('tr[data-variant-id]')
    .first()
    .getByRole('textbox', { name: /^Size code / })
    .fill('XS')
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  await revealCopyActions(page)
  await view.getByRole('button', { name: 'Copy columns', exact: true }).click()
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
  await view.getByRole('button', { name: 'Orders', exact: true }).click()
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
  ).toHaveCount(45)
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
    .getByRole('option', {
      name: `Order ${records[0].snapshot.orderId}`,
      exact: true,
    })
    .locator('.order-card-meta')
    .dblclick()
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

test('Ctrl+A prepares every selected product across purchase months; preview Cancel writes nothing', async ({
  extension,
}) => {
  const { page, records, view } = await openLibrary(extension, 3)
  await expect(page.locator('#month-filter-label')).toHaveText('October 2026')
  await expect(page.getByLabel('Packing month', { exact: true })).toHaveValue(
    '2026-10'
  )
  await expect(
    page.getByRole('button', { name: 'Prepare packing list', exact: true })
  ).toBeDisabled()
  await page.locator('#month-filter-label').click()
  await page.locator('#month-options [data-month="2026-09"]').click()
  await page.locator('#month-filter-label').click()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    6
  )
  await page
    .getByRole('option', {
      name: `Order ${records[0].snapshot.orderId}`,
      exact: true,
    })
    .locator('.order-card-meta')
    .click()
  await page
    .getByRole('option', {
      name: `Order ${records[1].snapshot.orderId}`,
      exact: true,
    })
    .locator('.order-card-meta')
    .click({ modifiers: ['Control'] })
  await selectAllProducts(page)
  await expect(page.locator('#selection-summary')).toContainText('6 selected')
  await page.getByLabel('Packing month', { exact: true }).fill('2026-12')
  await expect(page.locator('#packing-scope')).toHaveText(
    '6 selected products · 2 orders → December 2026'
  )
  const before = await backup(extension)
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  const review = page.getByRole('dialog', {
    name: 'Assign product codes?',
    exact: true,
  })
  await expect(review).toContainText('6 selected product rows from 2 orders')
  await expect(review.locator('.packing-review-item')).toHaveCount(4)
  const previewCodes = await review
    .locator(
      '.packing-value-row:first-child .packing-value-after .packing-value-content'
    )
    .allTextContents()
  expect(previewCodes).toHaveLength(4)
  expect(previewCodes.every((code) => /^CE2612\d{4}$/.test(code))).toBe(true)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(view).toBeHidden()
  const cancelled = await backup(extension)
  for (const key of ['preparations', 'allocations', 'issuedCodes', 'orders'])
    expect(cancelled[key]).toEqual(before[key])
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  await expect(
    review.locator(
      '.packing-value-row:first-child .packing-value-after .packing-value-content'
    )
  ).toHaveText(previewCodes)
  await review
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  await expect(view).toBeVisible()
  await expect(view.locator('.packing-order-section')).toHaveCount(2)
  await expect(view.locator('.variants tbody tr')).toHaveCount(6)
  const saved = await backup(extension)
  expect(saved.preparations.map((prep) => prep.orderId).sort()).toEqual(
    records
      .slice(0, 2)
      .map((record) => record.snapshot.orderId)
      .sort()
  )
  expect(
    saved.preparations
      .flatMap((prep) => prep.groups.map((group) => group.baseCode))
      .sort()
  ).toEqual([...previewCodes].sort())
  expect(saved.orders).toEqual(before.orders)
  await expect(
    view.getByRole('button', { name: 'Open selected order', exact: true })
  ).toBeDisabled()
  await view
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  for (const name of [
    'Copy columns',
    'Copy group codes',
    'Copy Excel image',
    'Copy barcode images',
    'Copy carton marks',
  ])
    await expect(
      view.getByRole('button', { name, exact: true, includeHidden: true })
    ).toBeDisabled()
  await view.locator('.group-select').first().focus()
  await page.keyboard.press('Control+a')
  await expect(view.locator('.preparation-copy-scope')).toHaveText(
    '6 selected products · 2 orders'
  )
  await expect(view.locator('.group-select[aria-pressed="true"]')).toHaveCount(
    4
  )
  await expect(
    view.getByRole('button', {
      name: 'Copy columns',
      exact: true,
      includeHidden: true,
    })
  ).toBeEnabled()
  await view.getByRole('button', { name: 'Orders', exact: true }).click()
  await page.reload()
  await expect(page.locator('#month-filter-label')).toHaveText(
    '2 purchase months'
  )
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    6
  )
  await expect(page.getByLabel('Packing month', { exact: true })).toHaveValue(
    '2026-10'
  )
  expect(extension.unexpectedRequests).toEqual([])
})

test('moving one selected source row previews its split and leaves all unselected codes unchanged', async ({
  extension,
}) => {
  const { page, records } = await openLibrary(extension)
  await selectAllProducts(page)
  const view = await prepareSelected(page)
  const original = await backup(extension)
  const [oldJar, oldBox] = original.preparations[0].groups
  await view.getByRole('button', { name: 'Orders', exact: true }).click()
  await page
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  await page
    .locator('#sheet-body tr[data-selection-key]')
    .first()
    .locator('.product-title')
    .click()
  await page.getByLabel('Packing month', { exact: true }).fill('2026-11')
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  const review = page.getByRole('dialog', {
    name: 'Move selected products to this packing month?',
    exact: true,
  })
  await expect(review).toContainText('1 partial groups will be split')
  await expect(review.locator('.packing-review-item')).toHaveCount(1)
  await expect(review.locator('.packing-value-row code').first()).toHaveText(
    oldJar.baseCode
  )
  const newCode = await review
    .locator('.packing-value-row:first-child .packing-value-after code')
    .first()
    .textContent()
  expect(newCode).toMatch(/^CE2611\d{4}$/)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  const cancelled = await backup(extension)
  expect(cancelled.preparations).toEqual(original.preparations)
  expect(cancelled.issuedCodes).toEqual(original.issuedCodes)
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  await review
    .getByRole('button', { name: 'Change codes and prepare', exact: true })
    .click()
  await expect(view.locator('.preparation-group')).toHaveCount(1)
  await expect(view.locator('.variants tbody tr')).toHaveCount(1)
  const moved = await backup(extension)
  const groupFor = (entryId) =>
    moved.preparations[0].groups.find((group) =>
      group.variants.some((variant) => variant.entryIds.includes(entryId))
    )
  expect(groupFor(records[0].snapshot.items[0].entryId).baseCode).toBe(newCode)
  expect(groupFor(records[0].snapshot.items[1].entryId).baseCode).toBe(
    oldJar.baseCode
  )
  expect(groupFor(records[0].snapshot.items[2].entryId).baseCode).toBe(
    oldBox.baseCode
  )
  expect(moved.orders).toEqual(original.orders)
  expect(
    codeOwners(
      moved.issuedCodes.filter((code) => code.code === oldJar.baseCode)
    )
  ).toEqual(
    codeOwners(
      original.issuedCodes.filter((code) => code.code === oldJar.baseCode)
    )
  )
  await view.getByRole('button', { name: 'Orders', exact: true }).click()
  await page
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  await page.getByLabel('Packing month', { exact: true }).fill('2026-10')
  await expect(page.locator('#packing-scope')).toHaveText(
    'Reopen 2 products already in October 2026'
  )
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  await expect(view.locator('.variants tbody tr')).toHaveCount(2)
  await expect(view.getByLabel('Product code', { exact: true })).toHaveCount(2)
  await expect(
    view.getByLabel('Product code', { exact: true }).nth(0)
  ).toHaveValue(oldJar.baseCode)
  await expect(
    view.getByLabel('Product code', { exact: true }).nth(1)
  ).toHaveValue(oldBox.baseCode)
  expect(extension.unexpectedRequests).toEqual([])
})

test('a released code is reusable and an active conflict identifies its owner before applying a correction', async ({
  extension,
}) => {
  const { page } = await openLibrary(extension)
  await selectAllProducts(page)
  const view = await prepareSelected(page)
  const original = await backup(extension)
  const groups = view.locator('.preparation-group')
  const first = groups.nth(0).getByLabel('Product code', { exact: true })
  const second = groups.nth(1).getByLabel('Product code', { exact: true })
  const retiredCode = await second.inputValue()
  await second.fill('CE26109998')
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  await expect
    .poll(
      async () => (await backup(extension)).preparations[0].groups[1].baseCode
    )
    .toBe('CE26109998')
  await first.fill(retiredCode)
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  await expect(first).not.toHaveAttribute('aria-invalid', 'true')
  const reused = await backup(extension)
  expect(reused.preparations[0].groups[0].baseCode).toBe(retiredCode)
  await first.fill('CE26109998')
  await expect(view.locator('.preparation-save-status')).toContainText(
    'Code conflict'
  )
  await view.getByRole('button', { name: 'Resolve', exact: true }).click()
  const conflict = page.getByRole('dialog', {
    name: 'Resolve code conflict',
    exact: true,
  })
  await expect(conflict).toContainText('CE26109998')
  await expect(conflict).toContainText(
    'is currently assigned to another product'
  )
  await expect(conflict.getByAltText('Product photo')).toHaveCount(2)
  await expect(
    conflict.getByRole('button', { name: 'Show owning product', exact: true })
  ).toBeVisible()
  await conflict
    .getByRole('button', { name: 'Use next available code', exact: true })
    .click()
  await expect(conflict).toBeVisible()
  expect((await backup(extension)).preparations).toEqual(reused.preparations)
  await conflict
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(conflict).toBeHidden()
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  const resolved = await backup(extension)
  expect(resolved.preparations[0].groups[0].baseCode).not.toBe('CE26109998')
  expect(resolved.preparations[0].groups[1].baseCode).toBe('CE26109998')
  expect(
    resolved.issuedCodes.find(
      (code) =>
        code.kind === 'base' &&
        code.code === resolved.preparations[0].groups[0].baseCode
    )?.groupId
  ).toBe(original.preparations[0].groups[0].id)
  expect(resolved.orders).toEqual(original.orders)
  expect(extension.unexpectedRequests).toEqual([])
})

test('keyboard group moves and pointer product moves persist and export in the displayed order', async ({
  extension,
}) => {
  test.setTimeout(60000)
  const { page, records } = await openLibrary(extension, 2)
  await page.locator('#month-filter-label').click()
  await page.locator('#month-options [data-month="2026-09"]').click()
  await page.locator('#month-filter-label').click()
  await selectAllProducts(page)
  const view = await prepareSelected(page)
  const original = await backup(extension)
  const first = original.preparations.find(
    (entry) => entry.orderId === records[0].snapshot.orderId
  )
  const second = original.preparations.find(
    (entry) => entry.orderId === records[1].snapshot.orderId
  )
  const [jar, box] = first.groups
  const order = view.locator(`[data-packing-order="${first.orderId}"]`)
  await order
    .getByRole('button', { name: 'Move group 1; use Up or Down arrows' })
    .press('ArrowDown')
  await expect
    .poll(async () => {
      const saved = (await backup(extension)).preparations.find(
        (entry) => entry.orderId === first.orderId
      )
      return saved.groups.map((group) => group.id)
    })
    .toEqual([box.id, jar.id])
  await expect
    .poll(() =>
      order
        .getByLabel('Product code', { exact: true })
        .evaluateAll((inputs) => inputs.map((input) => input.value))
    )
    .toEqual([box.baseCode, jar.baseCode])
  const jarCard = order.locator(`[data-group-id="${jar.id}"]`)
  const rows = jarCard.locator('.variants tbody tr')
  const grip = rows.nth(1).getByRole('button', {
    name: 'Move product 2; use Up or Down arrows',
  })
  await grip.scrollIntoViewIfNeeded()
  const from = await grip.boundingBox()
  const to = await rows.first().boundingBox()
  expect(from).not.toBeNull()
  expect(to).not.toBeNull()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + 25, to.y + 12, { steps: 10 })
  await page.mouse.up()
  await expect
    .poll(async () => {
      const saved = (await backup(extension)).preparations.find(
        (entry) => entry.orderId === first.orderId
      )
      return saved.groups[1].variants.map((variant) => variant.id)
    })
    .toEqual(jar.variants.map((variant) => variant.id).reverse())
  await expect(view.locator('.preparation-copy-scope')).toHaveText(
    '6 selected products · 2 orders'
  )
  const reordered = await backup(extension)
  const current = reordered.preparations.find(
    (entry) => entry.orderId === first.orderId
  )
  expect(
    reordered.preparations.find((entry) => entry.orderId === second.orderId)
  ).toEqual(second)
  expect(codeOwners(reordered.issuedCodes)).toEqual(
    codeOwners(original.issuedCodes)
  )
  for (const group of current.groups) {
    const before = first.groups.find((entry) => entry.id === group.id)
    expect(group.baseCode).toBe(before.baseCode)
    for (const variant of group.variants) {
      const originalVariant = before.variants.find(
        (entry) => entry.id === variant.id
      )
      expect(variant.variantSuffix).toBe(originalVariant.variantSuffix)
      expect(variant.sizeSuffix).toBe(originalVariant.sizeSuffix)
    }
  }
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await view.getByRole('button', { name: 'Select all', exact: true }).click()
  await revealCopyActions(page)
  await view.getByRole('button', { name: 'Copy columns', exact: true }).click()
  const columns = page.getByRole('dialog', {
    name: 'Copy preparation columns',
    exact: true,
  })
  for (const name of [
    'Description',
    'Spanish description',
    'Size',
    'Size code',
    'Price',
    'Discount',
    'Quantity',
  ])
    await columns.getByRole('checkbox', { name, exact: true }).uncheck()
  await columns
    .getByRole('button', { name: 'Copy chosen columns', exact: true })
    .click()
  await expect(
    columns.getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  const expected = [current, second].flatMap((preparation) =>
    preparation.groups.flatMap((group) =>
      group.variants.map((variant, index) => [
        index === 0 ? group.baseCode : '',
        `${group.baseCode}${variant.variantSuffix}${variant.sizeSuffix}`,
      ])
    )
  )
  expect(text.split('\r\n').map((line) => line.split('\t'))).toEqual(expected)
  await columns.getByRole('button', { name: 'Close', exact: true }).click()
  await page.evaluate(() => {
    globalThis.packingImageRuns = []
    const fillText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (this.canvas.width > 2000)
        packingImageRuns.push({
          text: String(text),
          y: args[1],
          color: this.fillStyle,
        })
      return fillText.call(this, text, ...args)
    }
  })
  // The primary action changes its icon and label while confirming the copy.
  const image = view.locator(
    '.packing-copy-actions > button:not(.copy-actions-trigger)'
  )
  await expect(image).toHaveAccessibleName('Copy Excel image')
  await image.click()
  await copyCurrentImageBatch(page)
  await expect(image).toHaveText('Copied')
  await expect(image).toHaveAttribute('data-icon', 'check')
  const imageRuns = await page.evaluate(() => packingImageRuns)
  for (const code of [box.baseCode, jar.baseCode]) {
    const runs = imageRuns.filter((run) => run.text === code)
    expect(runs.length).toBeGreaterThan(0)
    expect(runs.every((run) => run.color === '#1d4ed8')).toBe(true)
  }
  expect(imageRuns.find((run) => run.text === box.baseCode).y).toBeLessThan(
    imageRuns.find((run) => run.text === jar.baseCode).y
  )
  for (const group of second.groups) {
    const runs = imageRuns.filter((run) => run.text === group.baseCode)
    expect(runs.length).toBeGreaterThan(0)
    expect(runs.every((run) => run.color !== '#1d4ed8')).toBe(true)
  }
  expect(
    await page.evaluate(async () => (await navigator.clipboard.read())[0].types)
  ).toContain('image/png')
  await view.getByRole('button', { name: 'Orders', exact: true }).click()
  await page.reload()
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  await expect
    .poll(() =>
      order
        .getByLabel('Product code', { exact: true })
        .evaluateAll((inputs) => inputs.map((input) => input.value))
    )
    .toEqual([box.baseCode, jar.baseCode])
  expect(
    await jarCard
      .locator('.variants tbody tr')
      .evaluateAll((elements) =>
        elements.map((element) => element.dataset.variantId)
      )
  ).toEqual(jar.variants.map((variant) => variant.id).reverse())
  expect(extension.unexpectedRequests).toEqual([])
})

test('reset order and codes retains current names while previous packing restores the earlier month and names', async ({
  extension,
}) => {
  test.setTimeout(60000)
  const { page } = await openLibrary(extension)
  await selectAllProducts(page)
  const view = await prepareSelected(page)
  const form = view.locator('#preparation-content')
  const productCodes = () =>
    view
      .getByLabel('Product code', { exact: true })
      .evaluateAll((inputs) => inputs.map((input) => input.value))
  const name = view.getByLabel('Spanish short name', { exact: true }).first()
  await name.fill('NOMBRE ANTERIOR')
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  const original = await backup(extension)
  await view.getByRole('button', { name: 'Orders', exact: true }).click()
  await page.getByLabel('Packing month', { exact: true }).fill('2026-12')
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  const monthMove = page.getByRole('dialog', {
    name: 'Move selected products to this packing month?',
    exact: true,
  })
  await expect(monthMove).toBeVisible()
  const movedCodes = await monthMove
    .locator(
      '.packing-value-row:first-child .packing-value-after .packing-value-content'
    )
    .allTextContents()
  expect(movedCodes).toHaveLength(2)
  expect(movedCodes.every((code) => /^CE2612\d{4}$/.test(code))).toBe(true)
  await monthMove
    .getByRole('button', { name: 'Change codes and prepare', exact: true })
    .click()
  await expect(view).toBeVisible()
  await expect(page.locator('#orders-view')).toBeHidden()
  await expect(view.locator('.packing-title')).toContainText('December 2026')
  await expect.poll(productCodes).toEqual(movedCodes)
  const moved = await backup(extension)
  expect(moved.preparations[0].month).toBe('2026-12')
  const defaults = moved.preparations[0].defaultPacking
  expect(defaults.month).toBe('2026-12')
  await name.fill('NOMBRE RECIENTE')
  await view
    .getByLabel('Product code', { exact: true })
    .first()
    .fill('CE26129998')
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  await view
    .getByRole('button', { name: 'Move group 1; use Up or Down arrows' })
    .press('ArrowDown')
  await expect(form).toBeEnabled()
  await expect.poll(productCodes).toEqual([movedCodes[1], 'CE26129998'])
  await expect
    .poll(
      async () => (await backup(extension)).preparations[0].groups[1].baseCode
    )
    .toBe('CE26129998')
  const edited = await backup(extension)
  await view
    .getByRole('button', { name: 'Reset order and codes', exact: true })
    .click()
  const reset = page.getByRole('dialog', {
    name: 'Reset order and codes?',
    exact: true,
  })
  await expect(reset).toContainText('Current names are retained')
  await reset.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(reset).toBeHidden()
  await expect(form).toBeEnabled()
  expect((await backup(extension)).preparations).toEqual(edited.preparations)
  await view
    .getByRole('button', { name: 'Reset order and codes', exact: true })
    .click()
  await reset
    .getByRole('button', { name: 'Reset order and codes', exact: true })
    .click()
  await expect(reset).toBeHidden()
  // The review closes before its write starts; wait for the completed reset.
  await expect(form).toBeEnabled()
  await expect
    .poll(productCodes)
    .toEqual(defaults.groups.map((group) => group.baseCode))
  const resetData = await backup(extension)
  expect(
    resetData.preparations[0].groups.map((group) => [group.id, group.baseCode])
  ).toEqual(defaults.groups.map((group) => [group.id, group.baseCode]))
  expect(resetData.preparations[0].groups[0].spanishName).toBe(
    'NOMBRE RECIENTE'
  )
  expect(
    resetData.preparations[0].groups.some((group) => group.manualReordered)
  ).toBe(false)
  await view
    .getByRole('button', { name: 'Restore previous packing', exact: true })
    .click()
  const previous = page.getByRole('dialog', {
    name: 'Restore previous packing?',
    exact: true,
  })
  await expect(previous).toContainText('Later edits will be lost')
  await previous
    .getByRole('button', { name: 'Restore previous packing', exact: true })
    .click()
  await expect(previous).toBeHidden()
  await expect(form).toBeEnabled()
  await expect(view.locator('.packing-title')).toContainText('October 2026')
  await expect
    .poll(productCodes)
    .toEqual(original.preparations[0].groups.map((group) => group.baseCode))
  const restored = await backup(extension)
  expect(restored.preparations[0].month).toBe('2026-10')
  expect(restored.preparations[0].groups).toEqual(
    original.preparations[0].groups
  )
  expect(restored.orders).toEqual(original.orders)
  expect(codeOwners(restored.issuedCodes)).toEqual(
    codeOwners(original.issuedCodes)
  )
  expect(
    restored.issuedCodes.some((entry) => entry.code.startsWith('CE2612'))
  ).toBe(false)
  await revealCopyActions(page)
  const downloading = page.waitForEvent('download')
  await view
    .getByRole('button', { name: 'Back up packing', exact: true })
    .click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('1688-packing-2026-10.json')
  expect(await download.failure()).toBeNull()
  const files = await extension.inspector.evaluate(() =>
    chrome.downloads.search({})
  )
  expect(files).toHaveLength(1)
  expect(files[0].state).toBe('complete')
  const exported = JSON.parse(await readFile(files[0].filename, 'utf8'))
  expect(exported.packingScope.months).toEqual(['2026-10'])
  expect(exported.preparations).toEqual(restored.preparations)
  // Scoped backups carry current ownership only, without redundant owner
  // snapshots; the preparation/source rows already provide that information.
  expect(exported.issuedCodes).toEqual(
    restored.issuedCodes.map(({ ownerSnapshot, ...owner }) => owner)
  )
  expect(
    exported.issuedCodes.every(
      (owner) => !Object.hasOwn(owner, 'ownerSnapshot')
    )
  ).toBe(true)
  expect(extension.unexpectedRequests).toEqual([])
})

for (const editedIndex of [0, 1]) {
  test(`duplicate barcode recovery keeps the base and changes the edited variant (${editedIndex + 1})`, async ({
    extension,
  }) => {
    const { page } = await openLibrary(extension)
    await selectAllProducts(page)
    const view = await prepareSelected(page)
    const original = await backup(extension)
    const originalGroup = original.preparations[0].groups[0]
    const unchangedIndex = 1 - editedIndex
    const collisionSize = originalGroup.variants[unchangedIndex].sizeSuffix
    const row = view
      .locator('.preparation-group')
      .first()
      .locator('.variants tbody tr')
      .nth(editedIndex)
    await row.getByRole('textbox', { name: /^Size code / }).fill(collisionSize)
    await expect(view.locator('.preparation-save-status')).toContainText(
      'Code conflict'
    )
    const beforeResolution = await backup(extension)
    expect(beforeResolution.preparations).toEqual(original.preparations)
    expect(beforeResolution.issuedCodes).toEqual(original.issuedCodes)
    await view.getByRole('button', { name: 'Resolve', exact: true }).click()
    const conflict = page.getByRole('dialog', {
      name: 'Resolve code conflict',
      exact: true,
    })
    await expect(conflict).toContainText(
      `${originalGroup.baseCode}${collisionSize}`
    )
    await conflict
      .getByRole('button', {
        name: 'Use next available variant code',
        exact: true,
      })
      .click()
    await expect(conflict).toBeVisible()
    expect((await backup(extension)).preparations).toEqual(
      original.preparations
    )
    await conflict
      .getByRole('button', { name: 'Apply corrections', exact: true })
      .click()
    await expect(conflict).toBeHidden()
    await expect(view.locator('.preparation-save-status')).toHaveText(
      'Saved automatically'
    )
    const resolved = await backup(extension)
    const group = resolved.preparations[0].groups[0]
    expect(group.baseCode).toBe(originalGroup.baseCode)
    expect(group.variants[unchangedIndex]).toEqual(
      originalGroup.variants[unchangedIndex]
    )
    expect(group.variants[editedIndex].id).toBe(
      originalGroup.variants[editedIndex].id
    )
    expect(group.variants[editedIndex].sizeSuffix).toBe(collisionSize)
    expect(group.variants[editedIndex].variantSuffix).toMatch(/^[A-Z]+$/)
    const barcode = `${group.baseCode}${group.variants[editedIndex].variantSuffix}${collisionSize}`
    expect(
      resolved.issuedCodes.some(
        (code) =>
          code.code === barcode &&
          code.variantId === group.variants[editedIndex].id
      )
    ).toBe(true)
    const oldBarcode = `${originalGroup.baseCode}${originalGroup.variants[editedIndex].variantSuffix}${originalGroup.variants[editedIndex].sizeSuffix}`
    expect(
      resolved.issuedCodes.some(
        (code) => code.kind === 'barcode' && code.code === oldBarcode
      )
    ).toBe(false)
    expect(resolved.orders).toEqual(original.orders)
    expect(extension.unexpectedRequests).toEqual([])
  })
}

test('a month move mixed with an unidentified seller stops before changing any codes', async ({
  extension,
}) => {
  const { page, records, view } = await openLibrary(extension, 2)
  await selectAllProducts(page)
  await prepareSelected(page)
  await view.getByRole('button', { name: 'Orders', exact: true }).click()
  const missing = structuredClone(records[1])
  missing.snapshot.sellerName = 'Seller unavailable'
  missing.snapshot.sellerMemberLogin = ''
  missing.snapshot.sellerUnavailable = true
  missing.snapshot.observedAt = '2026-10-14T12:00:00.000Z'
  missing.lastCheckedAt = missing.snapshot.observedAt
  const response = await extension.inspector.evaluate(
    (record) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders: [record],
          history: [],
          images: [],
        },
      }),
    missing
  )
  expect(response.ok, response.error).toBe(true)
  await page.reload()
  await page.locator('#month-filter-label').click()
  await page.locator('#month-options [data-month="2026-09"]').click()
  await page.locator('#month-filter-label').click()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    6
  )
  await selectAllProducts(page)
  await page.getByLabel('Packing month', { exact: true }).fill('2026-12')
  const before = await backup(extension)
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  await expect(page.locator('.error-notice-message')).toContainText(
    'Some selected orders have no identified seller.'
  )
  await expect(page.locator('.error-notice-message')).toContainText(
    'No codes have changed.'
  )
  await expect(view).toBeHidden()
  await expect(page.locator('.packing-review')).toHaveCount(0)
  const after = await backup(extension)
  for (const field of ['orders', 'preparations', 'allocations', 'issuedCodes'])
    expect(after[field]).toEqual(before[field])
  expect(extension.unexpectedRequests).toEqual([])
})
