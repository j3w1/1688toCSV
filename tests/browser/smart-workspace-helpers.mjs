import { expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

/** Synthetic source facts enter through the real repository, never IDB writes. */
export async function seedSmartOrder(
  extension,
  {
    count = 2,
    quantity = '100',
    capacity = '45',
    physical = false,
    uneven = false,
    orderId = '100000000000000001',
    supplierId = 'synthetic-smart-cartons',
    assignCodes = true,
  } = {}
) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const snapshot = structuredClone(records[0].snapshot)
  snapshot.orderId = orderId
  snapshot.accountId = 'local'
  snapshot.sellerName = 'Synthetic smart cartons'
  snapshot.sellerMemberLogin = supplierId
  snapshot.purchasedAt = '2026-09-12T12:00:00+08:00'
  snapshot.observedAt = '2026-10-22T12:00:00.000Z'
  snapshot.sourceUrl = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${snapshot.orderId}`
  snapshot.items = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(snapshot.items[0]),
    entryId: String(2001 + index),
    title: `合成商品 ${index + 1}`,
    description: `Synthetic source ${index + 1}\n原始文本 ${index + 1}`,
    productNumber: `SYN-${index + 1}`,
    skuProperties: [],
    quantity: uneven ? '63' : quantity,
    price: '2.00',
    sourceDiscount: '0.00',
    allocatedDiscount: '0.00',
    discount: '0.00',
  }))
  const total = (
    BigInt(uneven ? '63' : quantity) *
    BigInt(count) *
    200n
  ).toString()
  const yuan = `${total.slice(0, -2) || '0'}.${total.slice(-2).padStart(2, '0')}`
  snapshot.totals = {
    goodsGross: yuan,
    shipping: '0.00',
    sourceDiscount: '0.00',
    orderAdjustment: '0.00',
    goodsNet: yuan,
    payable: yuan,
  }
  return extension.inspector.evaluate(
    async ({ snapshot, physical, uneven, assignCodes, capacity }) => {
      const repository = await window.testRepository,
        planner = window.testPlanner,
        ref = { accountId: 'local', orderId: snapshot.orderId }
      await repository.saveSnapshot(snapshot)
      if (!assignCodes) {
        if (physical)
          throw new Error(
            'Assign purchase codes before this physical output fixture.'
          )
        return ref
      }
      const review = await repository.reviewPurchaseCodes({
        orderRefs: [ref],
        entryRefs: snapshot.items.map(({ entryId }) => ({ ...ref, entryId })),
      })
      await repository.assignPurchaseCodes({
        plan: review.plan || review,
        expectedRevisions: review.expectedRevisions,
        intentId: crypto.randomUUID(),
      })
      let context = await repository.getOrderReconciliation(ref)
      const preparation = structuredClone(context.preparation)
      for (const [index, group] of preparation.groups.entries()) {
        group.spanishName = `SYNTHETIC ${index + 1}`
        group.category = '合成品'
      }
      await repository.savePreparations([preparation], {
        expectedRevisions: [preparation.revision],
      })
      context = await repository.getOrderReconciliation(ref)
      if (physical) {
        const values = Object.fromEntries(
          snapshot.items.map((item) => [item.entryId, String(capacity)])
        )
        await repository.updateOrderCapacities({
          ...ref,
          values,
          expectedValues: Object.fromEntries(
            snapshot.items.map((item) => [item.entryId, null])
          ),
          expectedObservedAt: snapshot.observedAt,
        })
        context = await repository.getOrderReconciliation(ref)
        let draft = planner.createReconciliationDraft(context)
        if (uneven) {
          const pieces = ['13', '12', '11', '9', '9', '9'],
            weights = ['16.75', '14.62', '10.40', '5.63', '5.18', '4.64'],
            dimensions = [
              ['60', '50', '40'],
              ['60', '50', '40'],
              ['50', '43', '36'],
              ['48', '37', '27'],
              ['48', '37', '27'],
              ['48', '37', '27'],
            ]
          draft.capacities = {}
          draft.cartons = pieces.map((quantity, index) => ({
            id: `synthetic-uneven-${index}`,
            accountId: ref.accountId,
            orderId: ref.orderId,
            count: 1,
            packingBasis: 'exact',
            labelOrigin: 'reported',
            cartonNumber: String(index + 1),
            contents: [
              {
                orderId: ref.orderId,
                entryId: snapshot.items[0].entryId,
                quantity,
              },
            ],
            unresolvedContents: [],
            len: dimensions[index][0],
            wid: dimensions[index][1],
            ht: dimensions[index][2],
            weight: weights[index],
            weightBasis: 'carton',
            draftKind: 'manual',
          }))
        } else
          for (const product of planner.reconcileOrder({ ...context, draft })
            .products)
            if (product.remainder && BigInt(product.remainder) > 0n)
              draft = planner.applyReconciliationCommand(
                draft,
                { type: 'separate', entryId: product.entryId },
                context
              )
        await repository.confirmOrderCartons({
          ...ref,
          draft,
          expectedRevisions: context.revisions,
          intentId: crypto.randomUUID(),
        })
      }
      return ref
    },
    { snapshot, physical, uneven, assignCodes, capacity }
  )
}

export async function openSmartLibrary(extension) {
  const page = await extension.context.newPage()
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(
    page.locator('#sheet-body tr[data-selection-key]').first()
  ).toBeVisible()
  return page
}

export async function createSmartContainer(extension, orderRefs) {
  return extension.inspector.evaluate(async (orderRefs) => {
    const repository = await window.testRepository,
      created = await repository.createContainer({
        name: 'Synthetic container October',
        period: '2026-10',
        intentId: crypto.randomUUID(),
      }),
      container = created.container || created
    await repository.includeContainerOrders({
      id: container.id,
      orderRefs,
      expectedRevision: container.revision,
      intentId: crypto.randomUUID(),
    })
    return container.id
  }, orderRefs)
}

export async function libraryBackup(extension) {
  const result = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(result.ok, result.error).toBe(true)
  return result.data
}

/** Real operator code review; no shipment month or hidden preparation screen. */
export async function assignSelectedPurchaseCodes(page) {
  await page.locator('#review-purchase-codes').click()
  const review = page.locator('dialog[data-action="purchase-code-review"]')
  await expect(review).toBeVisible()
  await review.locator('[data-action="assign-purchase-codes"]').click()
  await expect(review).toBeHidden()
  await expect(page.locator('#orders-view')).toBeVisible()
}

export async function editOrderProduct(page, row = 0, values = {}) {
  const target =
    typeof row === 'number'
      ? page.locator('#sheet-body tr[data-selection-key]').nth(row)
      : row.locator
        ? row
        : page.locator(
            `#sheet-body tr[data-selection-key=${JSON.stringify(JSON.stringify([row.accountId || 'local', row.orderId, row.entryId]))}]`
          )
  await target.locator('[data-action="edit-order-product"]').click()
  const editor = page.locator('dialog[data-action="edit-order-product"]')
  await expect(editor).toBeVisible()
  for (const [label, value] of Object.entries(values))
    await editor.getByRole('textbox', { name: label, exact: true }).fill(value)
  return editor
}

export async function closeOrderProduct(editor) {
  await editor.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(editor).toBeHidden()
}

export async function openOrderReconciliation(page, ref, kind = 'products') {
  const identity = JSON.stringify([ref.accountId || 'local', ref.orderId])
  const card = page.locator(
      `.order-card[data-order-key=${JSON.stringify(identity)}]`
    ),
    collapsed = page.locator(
      '#order-list .month-toggle[aria-expanded="false"]'
    ),
    count = await collapsed.count()
  // Sidebar purchase groups can start collapsed even while their Products are
  // visible. Expanding leaves filters and explicit source selection intact.
  for (let index = 0; index < count && !(await card.count()); index++)
    await collapsed.first().click()
  await card.locator('[data-action="open-order-cartons"]').click()
  const grid = page.locator('#orders-cartons-view')
  await expect(
    grid.locator('[data-action="confirm-order-cartons"]')
  ).toBeVisible()
  if (kind === 'cartons')
    await grid.locator('[data-action="reconciliation-cartons"]').click()
  return grid
}

export const productGridRow = (grid, ref) =>
  grid.locator(
    `[data-grid-key=${JSON.stringify(JSON.stringify([ref.accountId || 'local', ref.orderId, ref.entryId]))}]`
  )

export async function realOrderContext(extension, ref) {
  return extension.inspector.evaluate(
    async (ref) => (await window.testRepository).getOrderReconciliation(ref),
    ref
  )
}

export async function shareOrderBarcode(page, indices = [0, 1]) {
  await page.locator('#clear-rows').click()
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  for (const index of indices)
    await rows.nth(index).getByRole('checkbox').check()
  await page.locator('#group-order-products').click()
  const tools = page.locator('.orders-grouping-dialog')
  await tools
    .getByRole('button', { name: 'Share one barcode', exact: true })
    .click()
  const review = page.getByRole('dialog', {
    name: 'Review product grouping',
    exact: true,
  })
  await expect(review).toBeVisible()
  await review
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(review).toBeHidden()
  await expect(tools).toBeHidden()
}

/** Operator flow: no model writes are used to create or include the container. */
export async function createContainerThroughUI(
  page,
  refs,
  name = 'Synthetic October container'
) {
  await page.locator('#view-packing').click()
  const workspace = page.locator('#packing-view')
  await workspace.locator('[data-action="create-container"]').click()
  const prompt = page.locator('dialog[open]').last()
  await prompt
    .getByRole('textbox', { name: 'Container name', exact: true })
    .fill(name)
  await prompt
    .getByRole('button', { name: 'Create container', exact: true })
    .click()
  await expect(prompt).toBeHidden()
  const selector = workspace.locator('[data-action="choose-container"]')
  await expect(selector).not.toHaveValue('')
  const id = await selector.inputValue()
  await workspace.locator('[data-action="include-container-orders"]').click()
  const include = page.locator('.container-inclusion-dialog')
  for (const ref of refs)
    await include
      .locator(
        `.container-inclusion-order[data-order-id=${JSON.stringify(ref.orderId)}][data-account-id=${JSON.stringify(ref.accountId || 'local')}]`
      )
      .getByRole('checkbox')
      .check()
  await include.locator('[data-action="confirm-container-orders"]').click()
  await expect(include).toBeHidden()
  return id
}

export async function sealContainerThroughUI(page, { markAll = true } = {}) {
  const workspace = page.locator('#packing-view')
  if (markAll)
    await workspace.locator('[data-action="mark-all-loaded"]').click()
  await workspace.locator('[data-action="review-container-seal"]').click()
  const review = page.locator('.container-review-dialog')
  await expect(review).toBeVisible()
  await expect(review.locator('[data-action="seal-container"]')).toBeEnabled()
  await review.locator('[data-action="seal-container"]').click()
  await expect(review).toBeHidden()
  await expect(
    workspace.locator('[data-action="amend-container"]')
  ).toBeEnabled()
}

/** Synthetic output fixture uses only the production planner/repository. */
export async function loadedSourceContainer(extension, refs) {
  return extension.inspector.evaluate(async (refs) => {
    const repository = await window.testRepository
    for (const ref of refs) {
      let context = await repository.getOrderReconciliation(ref)
      const values = Object.fromEntries(
        context.record.snapshot.items.map((item) => [
          item.entryId,
          item.quantity,
        ])
      )
      await repository.updateOrderCapacities({
        ...ref,
        values,
        expectedValues: Object.fromEntries(
          Object.keys(values).map((id) => [
            id,
            context.record.unitsPerCarton?.[id] ?? null,
          ])
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
    }
    const created = await repository.createContainer({
        name: 'Synthetic complete output',
        intentId: crypto.randomUUID(),
      }),
      container = created.container || created
    await repository.includeContainerOrders({
      id: container.id,
      orderRefs: refs,
      expectedRevision: container.revision,
      intentId: crypto.randomUUID(),
    })
    const view = await repository.getContainerView({ id: container.id })
    await repository.markContainerLoaded({
      id: container.id,
      orderRefs: refs,
      expectedRevision: view.container.revision,
      intentId: crypto.randomUUID(),
    })
    return container.id
  }, refs)
}

export async function openContainerOutput(page, id) {
  const url = new URL(page.url())
  url.hash = new URLSearchParams({
    workspace: 'packing',
    containerId: id,
    view: 'packing-list',
  }).toString()
  await page.goto(url.href)
  const view = page.locator('#packing-view')
  await expect(view.locator('[data-action="choose-container"]')).toHaveValue(id)
  await expect(view.locator('[data-view="packing-list"]')).toHaveAttribute(
    'aria-current',
    'page'
  )
  return view
}
