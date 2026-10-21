import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  allocatePreparation,
  createPreparation,
} from '../../src/packing-model.js'
import { revealCopyActions } from './copy-actions-helpers.mjs'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'

test('reviewed payment links preserve source totals, skip payment rows and export packing costs and features', async ({
  extension,
}) => {
  test.setTimeout(60000)
  const demos = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const records = demos.slice(0, 2).map((record, index) => ({
    ...record,
    tags: [],
    changedEntryIds: [],
    removedEntryIds: [],
    snapshot: {
      ...record.snapshot,
      orderId: String(7101 + index),
      sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${7101 + index}`,
      sellerName: index
        ? 'Synthetic service payment'
        : 'Synthetic original purchase',
      sellerMemberLogin: 'synthetic-linked-packing',
      purchasedAt: '2026-10-01T12:00:00+08:00',
      items: [
        {
          ...record.snapshot.items[0],
          entryId: '1',
          title: index ? 'Service fee' : 'Cup',
          description: index ? 'Service fee' : 'Cup',
          skuProperties: [],
          quantity: index ? '1' : '3',
          price: index ? '400.00' : '10.00',
          sourceDiscount: '0.00',
          allocatedDiscount: '0.00',
          discount: '0.00',
        },
      ],
      totals: {
        goodsGross: index ? '400.00' : '30.00',
        goodsNet: index ? '400.00' : '30.00',
        shipping: index ? '56.00' : '0.00',
        payable: index ? '456.00' : '30.00',
        sourceDiscount: '0.00',
        orderAdjustment: '0.00',
      },
    },
    ...(!index
      ? {
          productWorkflow: {
            1: { features: { lighting: true, rotation: true } },
          },
          productWorkflowUpdatedAt: '2026-10-02T00:00:00.000Z',
        }
      : {}),
  }))
  const draft = createPreparation(records[0].snapshot, '2026-10')
  draft.groups[0].spanishName = 'TAZA'
  draft.groups[0].category = '杯子'
  const allocation = allocatePreparation(draft, [], [], {
    snapshot: records[0].snapshot,
  })
  const sourceDraft = createPreparation(records[1].snapshot, '2026-10')
  sourceDraft.groups[0].spanishName = 'SERVICIO'
  sourceDraft.groups[0].category = '服务'
  const sourceAllocation = allocatePreparation(
    sourceDraft,
    allocation.allocations,
    allocation.issuedCodes,
    { snapshot: records[1].snapshot }
  )
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    {
      format: '1688-order-library',
      version: 3,
      exportedAt: '2026-10-03T00:00:00.000Z',
      orders: records,
      history: [],
      images: [],
      preparations: [
        { ...allocation.preparation, revision: 1 },
        { ...sourceAllocation.preparation, revision: 1 },
      ],
      allocations: sourceAllocation.allocations,
      issuedCodes: sourceAllocation.issuedCodes,
    }
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await page
    .locator('.order-card[data-order-id="7101"] .order-details-trigger')
    .click()
  const details = page.locator('#order-details')
  await details.getByRole('button', { name: 'Operations', exact: true }).click()
  const orderWorkflow = page.getByRole('dialog', {
    name: 'Operations workflow',
    exact: true,
  })
  const instructionSize = await orderWorkflow
    .locator('[name="labelsSent"]')
    .boundingBox()
  expect(instructionSize.width).toBe(14)
  expect(instructionSize.height).toBe(14)
  await orderWorkflow
    .getByLabel('Delay state', { exact: true })
    .filter({ visible: true })
    .selectOption('delayed')
  await orderWorkflow
    .getByLabel('Delay reason', { exact: true })
    .filter({ visible: true })
    .fill('Synthetic production review')
  await orderWorkflow.screenshot({
    path: 'work/operations-workflow-review.png',
  })
  await orderWorkflow
    .getByRole('button', { name: 'Save workflow', exact: true })
    .click()
  await expect(orderWorkflow).toHaveCount(0)
  await expect(details.locator('[data-operation="delay"]')).toHaveAttribute(
    'aria-label',
    /Synthetic production review/
  )
  await details
    .getByRole('button', { name: 'Linked payments', exact: true })
    .click()
  const review = page.getByRole('dialog', {
    name: 'Review linked payments',
    exact: true,
  })
  expect(
    await review.evaluate((dialog) => getComputedStyle(dialog).backgroundColor)
  ).not.toBe('rgba(0, 0, 0, 0)')
  const paymentHeading = review.locator('.payment-links-dialog-heading')
  const headingAlignment = await paymentHeading.evaluate((heading) => {
    const title = heading.querySelector('h2').getBoundingClientRect()
    const button = heading
      .querySelector('.payment-links-add')
      .getBoundingClientRect()
    return Math.abs(title.y + title.height / 2 - button.y - button.height / 2)
  })
  expect(headingAlignment).toBeLessThanOrEqual(1)
  await review
    .getByRole('button', { name: 'Link existing payment', exact: true })
    .click()
  await expect(
    review.locator('select[name="payment-source-order"]')
  ).toHaveCount(0)
  await expect(review.locator('[name="payment-source-order"]')).toHaveAttribute(
    'role',
    'combobox'
  )
  await expect(
    review.locator('.search-suggestions [role="option"]')
  ).toHaveCount(2)
  await review.locator('[name="payment-source-order"]').fill('7102')
  await review.getByRole('option', { name: /7102/ }).click()
  await expect(review.locator('[name="payment-amount"]')).toHaveValue('456.00')
  await review
    .locator('[name="payment-reason"]')
    .fill('Lighting and rotation service')
  await expect(review).toContainText('56.00')
  await review
    .getByLabel(
      'I reviewed the source payment, receiving goods, costs and packing exclusions.',
      { exact: true }
    )
    .check()
  await review.screenshot({ path: 'work/operations-payment-review.png' })
  await review
    .getByRole('button', { name: 'Save reviewed links', exact: true })
    .click()
  await expect(review).toHaveCount(0)
  await details
    .getByRole('button', { name: 'Close order details', exact: true })
    .click()
  const sourceLinkSize = await page
    .locator('.order-card[data-order-id="7102"] .operations-payment-source')
    .boundingBox()
  expect(sourceLinkSize.height).toBe(18)
  expect(sourceLinkSize.width).toBe(18)
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  expect(
    response.data.orders
      .map((entry) => entry.snapshot)
      .sort((a, b) => a.orderId.localeCompare(b.orderId))
  ).toEqual(records.map((entry) => entry.snapshot))
  expect(
    response.data.orders.find((entry) => entry.snapshot.orderId === '7102')
      .packingExcludedEntryIds
  ).toEqual(['1'])
  expect(
    response.data.orders.find((entry) => entry.snapshot.orderId === '7101')
      .paymentLinks[0].amount
  ).toBe('456.00')
  // Even a later annotation restore cannot turn a payment source into goods.
  const sourceAnnotation = response.data.orders.find(
    (entry) => entry.snapshot.orderId === '7102'
  )
  sourceAnnotation.packingExcludedEntryIds = []
  sourceAnnotation.packingExclusionsUpdatedAt = new Date(
    Date.now() + 60000
  ).toISOString()
  delete sourceAnnotation.packingExclusionsPartialClocks
  const changedAnnotation = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    response.data
  )
  expect(changedAnnotation.ok, changedAnnotation.error).toBe(true)
  await page.reload()
  await expect(
    page.locator('.order-card[data-order-id="7102"] .operations-payment-source')
  ).toBeVisible()
  await expect(
    page.locator(
      '#sheet-body tr[data-selection-key="7102/1"] .packing-exclusion-toggle'
    )
  ).toBeDisabled()
  await page.locator('#orders-print-actions .copy-actions-trigger').click()
  await page.locator('#print-labels').click()
  const labels = page.getByRole('dialog', { name: 'Print labels', exact: true })
  await expect(labels.getByLabel(/^Quantity for /)).toHaveCount(1)
  await expect(labels.getByLabel(/^Quantity for /)).toHaveValue('3')
  await labels.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('#packing-month').fill('2026-10')
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  const packing = page.locator('#packing-view')
  await expect(packing).toBeVisible()
  await expect(packing.locator('[data-packing-order="7102"]')).toHaveCount(0)
  await expect(
    packing.locator('.variant-heading [data-operation="lighting"]')
  ).toHaveCount(1)
  const workflowControl = packing.locator(
    '.variant-heading [data-operation="lighting"]'
  )
  await workflowControl.click()
  const workflow = page.getByRole('dialog', {
    name: 'Operations workflow',
    exact: true,
  })
  await expect(
    workflow.getByLabel('Feature name', { exact: true }).first()
  ).toHaveValue('Lighting')
  await expect(
    workflow.getByLabel('Cost treatment', { exact: true }).first()
  ).toHaveValue('included')
  await workflow.getByRole('button', { name: 'Cancel', exact: true }).click()
  const downloads = []
  page.on('download', (download) => downloads.push(download))
  await page
    .getByRole('button', { name: 'Export packing list', exact: true })
    .click()
  await expect.poll(() => downloads.length).toBe(2)
  let files
  await expect
    .poll(async () => {
      files = await extension.inspector.evaluate(() =>
        chrome.downloads.search({})
      )
      return files.filter((file) => file.state === 'complete').length
    })
    .toBe(2)
  const summaryDownload = files.find((file) => file.filename.endsWith('.json'))
  const summary = JSON.parse(await readFile(summaryDownload.filename, 'utf8'))
  expect(summary.totals).toEqual({ orders: 1, products: 1, quantity: 3 })
  expect(summary.products[0]).toMatchObject({
    sourceAmount: '30.00',
    effectiveAmount: '486.00',
    linkedPaymentCharge: '456.00',
    linkedPaymentReasons: 'Lighting and rotation service',
    productFeatures: 'Lighting · Rotation',
  })
  const workbook = XLSX.read(
    await readFile(
      files.find((file) => file.filename.endsWith('.xlsx')).filename
    ),
    { type: 'buffer' }
  )
  const table = XLSX.utils.sheet_to_json(
    workbook.Sheets[workbook.SheetNames[0]],
    { header: 1, defval: '' }
  )
  const product = table.find((row) => row[2] === summary.products[0].code)
  expect(product[16]).toBe(162)
  expect(product[17]).toBe(486)
  expect(summary.products[0].productFeatures).toBe('Lighting · Rotation')
  await page.screenshot({ path: 'work/operations-packing.png' })
  expect(extension.unexpectedRequests).toEqual([])
})
