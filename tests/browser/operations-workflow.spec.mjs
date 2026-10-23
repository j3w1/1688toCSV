import { test, expect } from './extension-fixture.mjs'
import { chromium } from '@playwright/test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  allocatePreparation,
  createPreparation,
} from '../../src/packing-model.js'

function snapshot(
  orderId = '1001',
  sellerMemberLogin = 'synthetic-operations',
  accountId = 'local'
) {
  return {
    schemaVersion: 1,
    accountId,
    orderId,
    sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
    sellerName: 'Synthetic operations store',
    sellerMemberLogin,
    status: 'Completed',
    purchasedAt: '2026-10-01T12:00:00+08:00',
    observedAt: '2026-10-01T12:00:00.000Z',
    items: ['Cup', 'Plate'].map((title, index) => ({
      entryId: String(index + 1),
      title,
      description: `Synthetic ${title}`,
      thumbnail: `https://cbu01.alicdn.com/synthetic-operations-${index}.png`,
      price: '10.00',
      quantity: '1',
      sourceDiscount: '0.00',
      allocatedDiscount: '0.00',
      discount: '0.00',
    })),
    totals: {
      goodsGross: '20.00',
      shipping: '0.00',
      sourceDiscount: '0.00',
      orderAdjustment: '0.00',
      goodsNet: '20.00',
      payable: '20.00',
    },
  }
}

async function openRepository(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async () => {
    window.operationsDatabase = await import('/src/database.js')
    window.operationsModel = await import('/src/operations-workflow.js')
    window.packingModel = await import('/src/packing-model.js')
    window.packingBackup = await import('/src/packing-backup.js')
    window.operationsDatabaseName = `synthetic-operations-${crypto.randomUUID()}`
    window.library = await operationsDatabase.openDatabase({
      name: operationsDatabaseName,
    })
  })
  return page
}

test('operational metadata shares by store identity, inherits on new imports and survives refresh/reopen', async ({
  extension,
}) => {
  const page = await openRepository(extension),
    sources = [
      snapshot(),
      snapshot('1002'),
      snapshot('1003', 'other'),
      snapshot('1004', ''),
      snapshot('1005', ''),
      snapshot('1006', 'synthetic-operations', 'elsewhere'),
    ]
  const result = await page.evaluate(async (sources) => {
    for (const source of sources) await library.saveSnapshot(source)
    await library.setStoreWorkflow('1001', {
      labelPrinting: 'send',
      labelApplication: 'free',
      shippingRefundPromise: true,
    })
    await library.setOrderWorkflow('1001', {
      delay: { status: 'delayed', originalPromise: 'unas semanas' },
      warehouse: { status: 'received', receivedOn: '2026-10-01' },
      missingLabels: { active: true },
      refund: {
        actualPaid: '5.00',
        actualFreight: '2.00',
        promisedAmount: '3.00',
        receivedAmount: '1.00',
      },
    })
    const authored = await library.setProductWorkflow('1001', '1', {
      delay: { status: 'none' },
      missingLabels: { active: false },
      features: { lighting: true, rotation: true },
    })
    const addedSource = {
      ...sources[0],
      orderId: '1007',
      sourceUrl: sources[0].sourceUrl.replace('1001', '1007'),
    }
    const added = await library.saveSnapshot(addedSource)
    const refresh = await library.saveSnapshot({
      ...sources[0],
      observedAt: '2026-10-02T12:00:00.000Z',
      status: 'Awaiting delivery',
    })
    await library.setStoreWorkflow('1004', { labelApplication: 'paid' })
    const isolated = await library.getOrder('1006', { accountId: 'elsewhere' })
    library.close()
    window.library = await operationsDatabase.openDatabase({
      name: operationsDatabaseName,
    })
    const reopened = await library.getOrder('1001')
    return {
      authored,
      added,
      refresh,
      reopened,
      isolated,
      all: await library.listOrders(),
      resolved: operationsModel.resolveOperations(reopened, '1'),
    }
  }, sources)
  expect(result.authored.snapshot).toEqual(sources[0])
  expect(result.authored.revision).toBe(1)
  expect(result.refresh.order.orderWorkflow).toEqual(
    result.authored.orderWorkflow
  )
  expect(result.refresh.order.productWorkflow).toEqual(
    result.authored.productWorkflow
  )
  expect(result.added.order.storeWorkflow).toEqual(
    result.authored.storeWorkflow
  )
  expect(result.reopened).toEqual(result.refresh.order)
  expect(result.resolved.effective.delay.status).toBe('none')
  expect(result.resolved.effective.missingLabels.active).toBe(false)
  expect(result.resolved.effective.warehouse.status).toBe('received')
  expect(result.isolated.storeWorkflow).toBeUndefined()
  for (const id of ['1003', '1005'])
    expect(
      result.all.find((record) => record.snapshot.orderId === id).storeWorkflow
    ).toBeUndefined()
})

test('full/scoped restores preserve newer workflow clears and unrelated product edits', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    await library.setStoreWorkflow(source.orderId, {
      labelPrinting: 'supplier',
    })
    await library.setOrderWorkflow(source.orderId, {
      delay: {
        status: 'delayed',
        originalPromise: 'aproximadamente dos semanas',
      },
    })
    await library.setProductWorkflow(source.orderId, '1', {
      features: { lighting: true },
    })
    await library.setProductWorkflow(source.orderId, '2', {
      features: { rotation: true },
    })
    await library.savePreparation(
      packingModel.createPreparation(source, '2026-10')
    )
    const full = await library.exportBackup(),
      scoped = packingBackup.createPackingBackup(full, {
        months: ['2026-10'],
        orders: [
          { orderId: source.orderId, accountId: 'local', entryIds: ['1'] },
        ],
      }),
      target = await operationsDatabase.openDatabase({
        name: `${operationsDatabaseName}-target`,
      })
    await target.restoreBackup(full)
    await target.setStoreWorkflow(source.orderId, {})
    await target.setOrderWorkflow(source.orderId, {})
    await target.setProductWorkflow(source.orderId, '1', {})
    const newer = await target.setProductWorkflow(source.orderId, '2', {
      features: { rotation: false, lighting: false },
    })
    await target.restoreBackup(scoped)
    await target.restoreBackup(full)
    const kept = await target.getOrder(source.orderId),
      fresh = await operationsDatabase.openDatabase({
        name: `${operationsDatabaseName}-fresh`,
      })
    await fresh.restoreBackup(scoped)
    const scopedOnly = await fresh.getOrder(source.orderId)
    target.close()
    fresh.close()
    return { full, scoped, newer, kept, scopedOnly }
  }, snapshot())
  expect(result.kept.storeWorkflow).toBeUndefined()
  expect(result.kept.orderWorkflow).toBeUndefined()
  expect(result.kept.productWorkflow['1']).toBeUndefined()
  expect(result.kept.productWorkflow['2'].features).toEqual({
    lighting: false,
    rotation: false,
  })
  expect(result.kept.productWorkflowPartialClocks).toEqual(
    result.newer.productWorkflowPartialClocks
  )
  expect(Object.keys(result.scoped.orders[0].productWorkflow)).toEqual(['1'])
  expect(
    Object.keys(result.scoped.orders[0].productWorkflowPartialClocks)
  ).toEqual(['1'])
  expect(result.scopedOnly.productWorkflow['1'].features.lighting).toBe(true)
  expect(result.scopedOnly.productWorkflow['2']).toBeUndefined()
  expect(result.scopedOnly.storeWorkflow.labelPrinting).toBe('supplier')
  expect(result.scopedOnly.orderWorkflow.delay.originalPromise).toBe(
    'aproximadamente dos semanas'
  )
})

test('confirmed migration rolls back all orders on a storage failure and keeps unrelated notes/payment tags', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(
    async (sources) => {
      for (const source of sources) await library.saveSnapshot(source)
      await library.setNotes('1001', {
        notes: 'Original annotation stays',
        tags: [
          'Imprime etiquetas',
          'Retraso: unas semanas',
          'Pago complementario: pedido de referencia',
        ],
      })
      await library.setProductTags('1001', '1', ['Con luz', 'Rotación', 'Azul'])
      const before = await library.exportBackup(),
        review = operationsModel.reviewOperationsMigration(before.orders),
        put = IDBObjectStore.prototype.put
      let failure
      IDBObjectStore.prototype.put = function (...args) {
        if (
          this.name === 'orders' &&
          args[0]?.snapshot.orderId === '1002' &&
          args[0]?.storeWorkflow
        )
          throw new DOMException(
            'Synthetic operations write failure',
            'QuotaExceededError'
          )
        return put.apply(this, args)
      }
      try {
        await library.applyOperationsMigration(review, { confirmed: true })
      } catch (error) {
        failure = error.message
      } finally {
        IDBObjectStore.prototype.put = put
      }
      const afterFailure = await library.exportBackup(),
        applied = await library.applyOperationsMigration(review, {
          confirmed: true,
        }),
        after = await library.exportBackup()
      return { before, afterFailure, failure, applied, after }
    },
    [snapshot(), snapshot('1002')]
  )
  expect(result.failure).toContain('Synthetic operations write failure')
  expect(result.afterFailure.orders).toEqual(result.before.orders)
  expect(result.applied.migrated).toBe(4)
  const first = result.after.orders.find(
      (record) => record.snapshot.orderId === '1001'
    ),
    sibling = result.after.orders.find(
      (record) => record.snapshot.orderId === '1002'
    )
  expect(first.tags).toEqual(['Pago complementario: pedido de referencia'])
  expect(first.notes).toBe('Original annotation stays')
  expect(first.productTags['1']).toEqual(['Azul'])
  expect(first.productWorkflow['1'].features).toEqual({
    lighting: true,
    rotation: true,
  })
  expect(first.orderWorkflow.delay.originalPromise).toBe(
    'Retraso: unas semanas'
  )
  expect(first.orderWorkflow.delay.confirmedStart).toBeUndefined()
  expect(sibling.storeWorkflow.labelPrinting).toBe('supplier')
  expect(result.after.orders.map((record) => record.snapshot)).toEqual(
    result.before.orders.map((record) => record.snapshot)
  )
})

test('stale combined edits and tied conflicting backups fail atomically', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(async (source) => {
    await library.saveSnapshot(source)
    const saved = await library.setProductWorkflow(source.orderId, '1', {
        features: { lighting: true },
      }),
      before = await library.exportBackup(),
      errors = []
    try {
      await library.setOperationsWorkflow(
        source.orderId,
        {
          store: { labelPrinting: 'send' },
          order: { warehouse: { status: 'received' } },
          product: { entryId: '1', value: {} },
        },
        {
          expectedStoreClock: '',
          expectedOrderClock: '',
          expectedProductClock: '',
        }
      )
    } catch (error) {
      errors.push(error.message)
    }
    await library.setOrderWorkflow(source.orderId, {
      warehouse: { status: 'received' },
    })
    const authored = await library.exportBackup(),
      conflicting = structuredClone(authored)
    conflicting.orders[0].orderWorkflow.warehouse.status = 'partial'
    try {
      await library.restoreBackup(conflicting)
    } catch (error) {
      errors.push(error.message)
    }
    return {
      saved,
      before,
      authored,
      after: await library.exportBackup(),
      errors,
    }
  }, snapshot())
  expect(result.errors).toEqual([
    'Workflow changed in another tab. Reopen it before saving.',
    'Backup conflict: workflows have the same timestamp',
  ])
  expect(result.after.orders).toEqual(result.authored.orders)
  expect(result.after.orders[0].storeWorkflow).toBeUndefined()
  expect(result.after.orders[0].productWorkflow).toEqual(
    result.saved.productWorkflow
  )
})

async function openWorkspace(
  extension,
  { tags = false, prepared = false } = {}
) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  if (tags) {
    record.tags = ['Retraso: algunas semanas', 'Pago de otro pedido']
    record.productTags = {
      [record.snapshot.items[0].entryId]: ['Con luz', 'Descriptivo'],
    }
    record.productTagsUpdatedAt = '2026-10-01T12:00:00.000Z'
  }
  let preparation = {}
  if (prepared) {
    record.snapshot.sellerMemberLogin = 'synthetic-action-placement'
    const draft = createPreparation(record.snapshot, '2026-10')
    for (const [index, group] of draft.groups.entries()) {
      group.category = '合成'
      group.spanishName = ['TAZA', 'CESTA DE ALMACENAMIENTO CON TAPA', 'CAJA'][
        index
      ]
    }
    const allocated = allocatePreparation(draft, [], [], {
      snapshot: record.snapshot,
    })
    preparation = {
      preparations: [{ ...allocated.preparation, revision: 1 }],
      allocations: allocated.allocations,
      issuedCodes: allocated.issuedCodes,
    }
  }
  const restored = await extension.inspector.evaluate(
    ({ record, preparation }) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: preparation.preparations ? 3 : 1,
          exportedAt: new Date().toISOString(),
          orders: [record],
          history: [],
          images: [],
          ...preparation,
        },
      }),
    { record, preparation }
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  return { page, record }
}

test('workflow ellipses keep a reserved trailing column across variable names, cards and packing rows', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension, { prepared: true })
  for (const width of [1280, 820, 375]) {
    await page.setViewportSize({ width, height: 960 })
    const rows = await page
      .locator('#sheet-body .row-preparation')
      .evaluateAll((bars) =>
        bars.map((bar) => {
          const bounds = bar.getBoundingClientRect()
          const content = bar
            .querySelector('.operations-row-content')
            .getBoundingClientRect()
          const action = bar
            .querySelector('.operations-overflow')
            .getBoundingClientRect()
          return {
            right: action.right,
            endGap: bounds.right - action.right,
            gap: action.left - content.right,
            height: action.height,
            width: action.width,
            contentOverflows:
              bar.querySelector('.operations-row-content').scrollWidth >
              bar.querySelector('.operations-row-content').clientWidth,
          }
        })
      )
    expect(rows).toHaveLength(3)
    expect(
      Math.max(...rows.map((row) => row.right)) -
        Math.min(...rows.map((row) => row.right))
    ).toBeLessThanOrEqual(1)
    for (const row of rows) {
      expect(row.endGap).toBeLessThanOrEqual(1)
      expect(row.gap).toBeGreaterThanOrEqual(7)
      expect(row.height).toBe(24)
      expect(row.width).toBe(24)
      expect(row.contentOverflows).toBe(false)
    }
    const card = page.locator('.order-card').first()
    const ends = []
    for (const title of ['A', 'Synthetic store with a longer display name']) {
      await card.locator('.order-seller').evaluate((node, title) => {
        node.textContent = title
      }, title)
      const bounds = await card.locator('.operations-overflow').boundingBox()
      ends.push(bounds.x + bounds.width)
    }
    expect(Math.abs(ends[0] - ends[1])).toBeLessThanOrEqual(1)
    const first = page.locator('#sheet-body .operations-overflow').first()
    await first.focus()
    await expect(first).toBeFocused()
    await expect(first).toHaveAttribute('aria-haspopup', 'dialog')
  }
  await page.setViewportSize({ width: 1280, height: 960 })
  await page.locator('#sheet-body .operations-overflow').first().click()
  const operations = page.getByRole('dialog', {
    name: 'Operations workflow',
    exact: true,
  })
  await expect(operations).toBeVisible()
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 960 })
    const bounds = await operations.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    expect(
      await operations.evaluate((node) => node.scrollWidth <= node.clientWidth)
    ).toBe(true)
  }
  await operations.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('#view-packing').click()
  await expect(
    page.locator(
      '#packing-view .operations-overflow,#packing-view [data-operation]'
    )
  ).toHaveCount(0)
  await page.screenshot({
    path: test.info().outputPath('readonly-packing-no-supplier-editor.png'),
  })
  await page.close()
})

test('order and product status controls stay compact, save exceptions and preserve selection', async ({
  extension,
}, testInfo) => {
  const { page, record } = await openWorkspace(extension),
    card = page.locator('.order-card').first(),
    beforeSelection = await card.evaluate((node) =>
      node.classList.contains('is-selected')
    )
  await card.locator('.operations-strip button').first().click()
  const dialog = page.getByRole('dialog', {
    name: 'Operations workflow',
    exact: true,
  })
  await expect(dialog).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('workflow-order.png') })
  await dialog.getByRole('button', { name: 'Store', exact: true }).click()
  await expect(dialog.locator('select')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('workflow-store.png') })
  await dialog.getByRole('button', { name: 'Order', exact: true }).click()
  expect(
    await card.evaluate((node) => node.classList.contains('is-selected'))
  ).toBe(beforeSelection)
  await dialog
    .getByRole('group', { name: 'Delay state', exact: true })
    .filter({ visible: true })
    .getByRole('radio', { name: 'Delayed', exact: true })
    .locator('..')
    .click()
  await dialog
    .getByLabel('Original seller promise', { exact: true })
    .filter({ visible: true })
    .fill('aproximadamente varias semanas')
  await dialog
    .getByRole('button', { name: 'Save workflow', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  await expect(card.locator('[data-operation="delay"]')).toHaveAttribute(
    'aria-label',
    /aproximadamente varias semanas/
  )
  const row = page.locator('#sheet-body tr[data-selection-key]').first()
  await row.focus()
  await page.keyboard.press('Space')
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await row.locator('.operations-strip button').first().click()
  await expect(dialog).toBeVisible()
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await dialog
    .getByRole('group', { name: 'Delay state', exact: true })
    .filter({ visible: true })
    .getByRole('radio', { name: 'No delay', exact: true })
    .locator('..')
    .click()
  await dialog.getByRole('button', { name: 'Add feature', exact: true }).click()
  await dialog.getByLabel('Feature name', { exact: true }).fill('Sound sensor')
  await dialog.getByLabel('Cost / piece (¥)', { exact: true }).fill('1.25')
  await expect(dialog.locator('.operations-feature-total')).toContainText(
    '1.25'
  )
  await dialog
    .getByRole('button', { name: 'Save workflow', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  await expect(
    row.getByRole('button', { name: /Product feature: Sound sensor/ })
  ).toHaveCount(1)
  await expect(row.locator('[data-operation="delay"]')).toHaveCount(0)
  const dimensions = await row.locator('.operations-icon').first().boundingBox()
  expect(dimensions.width).toBe(14)
  expect(dimensions.height).toBe(14)
  const backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(backup.ok, backup.error).toBe(true)
  const saved = backup.data.orders.find(
    (entry) => entry.snapshot.orderId === record.snapshot.orderId
  )
  expect(saved.snapshot).toEqual(record.snapshot)
  expect(
    Object.values(
      saved.productWorkflow[record.snapshot.items[0].entryId].features
    )
  ).toEqual([{ name: 'Sound sensor', unitCost: '1.25', included: false }])
  await expect(row.locator('.additional-cost-price')).toBeVisible()
  expect(saved.orderWorkflow.delay.confirmedStart).toBeUndefined()
  expect(
    saved.productWorkflow[record.snapshot.items[0].entryId].delay.status
  ).toBe('none')
})

test('three custom feature costs persist without changing source evidence and fit narrow dialogs', async ({
  extension,
}, testInfo) => {
  const { page, record } = await openWorkspace(extension)
  await page.setViewportSize({ width: 1280, height: 900 })
  const row = page.locator('#sheet-body tr[data-selection-key]').first()
  await row.locator('.operations-strip button').first().click()
  const dialog = page.getByRole('dialog', {
    name: 'Operations workflow',
    exact: true,
  })
  for (const [name, cost, treatment] of [
    ['Lighting', '1.20', 'extra'],
    ['Rotation', '0.80', 'included'],
    ['Sound sensor', '0.50', 'extra'],
  ]) {
    await dialog
      .getByRole('button', { name: 'Add feature', exact: true })
      .click()
    const feature = dialog.locator('.operations-feature-row').last()
    await feature.getByLabel('Feature name', { exact: true }).fill(name)
    await feature.getByLabel('Cost / piece (¥)', { exact: true }).fill(cost)
    await feature
      .getByRole('radio', {
        name: treatment === 'included' ? 'Already recorded' : 'Additional cost',
        exact: true,
      })
      .locator('..')
      .click()
  }
  await expect(dialog.locator('.operations-feature-row')).toHaveCount(3)
  await expect(dialog.locator('.operations-feature-total')).toContainText(
    '1.70'
  )
  const controls = await dialog
    .locator('.operations-feature-row')
    .first()
    .evaluate((row) =>
      [
        ...row.querySelectorAll(
          'input:not([type="radio"]), .operations-option span, button'
        ),
      ].map((node) => {
        const bounds = node.getBoundingClientRect()
        return { height: bounds.height, center: bounds.y + bounds.height / 2 }
      })
    )
  for (const control of controls) {
    expect(control.height).toBeLessThanOrEqual(28)
    expect(Math.abs(control.center - controls[0].center)).toBeLessThanOrEqual(1)
  }
  await page.screenshot({ path: testInfo.outputPath('features-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => dialog.evaluate((node) => node.scrollWidth <= node.clientWidth))
    .toBe(true)
  await expect(
    dialog.getByRole('button', { name: 'Save workflow', exact: true })
  ).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('features-narrow.png') })
  await dialog
    .getByRole('button', { name: 'Save workflow', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  await page.reload()
  const updatedRow = page.locator('#sheet-body tr[data-selection-key]').first()
  await expect(updatedRow.locator('.additional-cost-price')).toBeVisible()
  await updatedRow.locator('.operations-strip button').first().click()
  await expect(dialog.locator('.operations-feature-row')).toHaveCount(3)
  await expect(dialog.locator('.operations-feature-total')).toContainText(
    '1.70'
  )
  const backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(backup.ok, backup.error).toBe(true)
  const saved = backup.data.orders.find(
    (item) => item.snapshot.orderId === record.snapshot.orderId
  )
  expect(saved.snapshot).toEqual(record.snapshot)
  expect(
    Object.values(
      saved.productWorkflow[record.snapshot.items[0].entryId].features
    )
  ).toEqual([
    { name: 'Lighting', unitCost: '1.20', included: false },
    { name: 'Rotation', unitCost: '0.80', included: true },
    { name: 'Sound sensor', unitCost: '0.50', included: false },
  ])
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('Settings migration shows reviewed conversions and keeps unresolved tags', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension, { tags: true })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('tab', { name: 'Tags', exact: true }).click()
  await settings
    .getByRole('button', { name: 'Review operational tags', exact: true })
    .click()
  const review = page.getByRole('dialog', {
    name: 'Review operational tags',
    exact: true,
  })
  await expect(review.locator('.operations-migration-item')).toHaveCount(2)
  await expect(review).toContainText('no date is invented')
  for (const checkbox of await review
    .locator('.operations-migration-item input[type="checkbox"]')
    .all())
    await checkbox.check()
  await review
    .getByLabel('I reviewed the selected conversions', { exact: true })
    .check()
  await review
    .getByRole('button', { name: 'Apply selected conversions', exact: true })
    .click()
  await expect(review).toHaveCount(0)
  const backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(backup.ok, backup.error).toBe(true)
  expect(backup.data.orders[0].tags).toEqual(['Pago de otro pedido'])
  expect(Object.values(backup.data.orders[0].productTags)[0]).toEqual([
    'Descriptivo',
  ])
})

test('workflow scope tabs, status pills, quick dates and source amounts keep compact popup-only sizes', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension),
    before = await extension.inspector.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
    )
  for (const language of ['en', 'es', 'zh']) {
    await page.locator(`#language-toggle [data-language=${language}]`).click()
    await page.locator('.order-card .operations-strip button').first().click()
    const dialog = page.locator('.operations-dialog'),
      panel = dialog.locator('.operations-panel:visible'),
      delay = panel.locator('[data-field="delay-state"]')
    await delay.locator('input[value="delayed"]').locator('..').click()
    await panel
      .locator('[data-field="warehouse-state"] input[value="partial"]')
      .locator('..')
      .click()
    await panel
      .locator('[data-field="missing-labels"] input[value="false"]')
      .locator('..')
      .click()
    await expect(delay.locator('input[value="delayed"]')).toBeChecked()
    await expect(
      delay.locator('input:checked + span .operations-choice-marker')
    ).toBeVisible()
    await page.keyboard.press('Tab')
    await delay.locator('input[value="delayed"]').focus()
    expect(
      await delay
        .locator('input:checked + span')
        .evaluate((node) => getComputedStyle(node).outlineWidth)
    ).toBe('2px')
    await page.keyboard.press('ArrowLeft')
    await expect(delay.locator('input[value="none"]')).toBeChecked()
    await page.keyboard.press('ArrowRight')
    await expect(delay.locator('input[value="delayed"]')).toBeChecked()
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 960 })
      const sizes = await dialog.evaluate((dialog) => {
        const boxes = (selector) =>
          [...dialog.querySelectorAll(selector)]
            .map((node) => node.getBoundingClientRect())
            .filter(({ height }) => height > 0)
            .map(({ height }) => height)
        return {
          input: {
            coarse: matchMedia('(pointer: coarse)').matches,
            hover: matchMedia('(any-hover: hover)').matches,
          },
          tabs: boxes('.operations-tabs button'),
          choices: boxes('.operations-option > span'),
          dates: boxes('.operations-date-shortcuts button'),
          sources: boxes('.operations-source-actions button'),
          footer: boxes('.operations-actions button'),
          overflow: dialog.scrollWidth > dialog.clientWidth,
          sourceBackgrounds: [
            ...dialog.querySelectorAll(
              '.operations-panel:not([hidden]) .operations-source-actions button'
            ),
          ].map((node) => getComputedStyle(node).backgroundColor),
        }
      })
      expect(sizes.input.coarse).toBe(false)
      expect(sizes.overflow).toBe(false)
      for (const height of [...sizes.tabs, ...sizes.choices]) {
        expect(height).toBeGreaterThanOrEqual(24)
        expect(height).toBeLessThanOrEqual(30)
      }
      expect(sizes.dates.length).toBeGreaterThan(0)
      expect(sizes.sources).toHaveLength(2)
      for (const height of [...sizes.dates, ...sizes.sources]) {
        expect(height).toBeGreaterThanOrEqual(22)
        expect(height).toBeLessThanOrEqual(26)
      }
      for (const height of sizes.footer) expect(height).toBeLessThanOrEqual(32)
      expect(sizes.sourceBackgrounds).toEqual([
        'rgba(0, 0, 0, 0)',
        'rgba(0, 0, 0, 0)',
      ])
      if (language === 'en') {
        await panel.locator('[name="labels-dispatched-on"]').focus()
        await page.mouse.move(1, 1)
        await dialog.locator('.operations-body').evaluate((body) => {
          body.scrollTop = 0
        })
        await dialog.screenshot({
          path: `work/operations-controls-${width === 1280 ? 'wide' : 'narrow'}.png`,
        })
      }
    }
    if (language === 'en') {
      const date = panel.locator('[name="labels-dispatched-on"]'),
        actions = date.locator('..').locator('.operations-date-shortcuts')
      await actions.getByRole('button', { name: 'Today', exact: true }).click()
      const today = await date.inputValue()
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      await actions
        .getByRole('button', { name: 'Yesterday', exact: true })
        .click()
      expect(await date.inputValue()).not.toBe(today)
      await actions.getByRole('button', { name: 'Clear', exact: true }).click()
      await expect(date).toHaveValue('')
      await panel
        .locator('[name="refund-actualPaid"]')
        .locator('..')
        .locator('.operations-source-actions button')
        .click()
      await expect(panel.locator('[name="refund-actualPaid"]')).toHaveValue(
        record.snapshot.totals.payable
      )
    }
    await dialog
      .locator('.operations-actions > button[type="button"]')
      .last()
      .click()
    await expect(dialog).toHaveCount(0)
  }
  const after = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(after.data.orders).toEqual(before.data.orders)
})

test('touch-only workflow controls retain larger targets without changing compact desktop or trailing row controls', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension),
    session = await extension.context.newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  })
  expect(
    await page.evaluate(
      () => matchMedia('(pointer: coarse) and (any-hover: none)').matches
    )
  ).toBe(true)
  await page.locator('.order-card .operations-strip button').first().click()
  const dialog = page.locator('.operations-dialog')
  const heights = await dialog.evaluate((dialog) =>
    [
      ...dialog.querySelectorAll(
        '.operations-tabs button, .operations-option > span, .operations-date-shortcuts button, .operations-source-actions button, .operations-actions button'
      ),
    ]
      .map((node) => node.getBoundingClientRect().height)
      .filter((height) => height > 0)
  )
  expect(heights.length).toBeGreaterThan(10)
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(48)
  await dialog
    .locator('.operations-actions > button[type="button"]')
    .last()
    .click()
  const overflow = page.locator('.order-card .operations-overflow').first()
  const bounds = await overflow.boundingBox()
  expect(bounds.height).toBeLessThanOrEqual(26)
  await session.detach()
})

test('Orders supplier ellipses stay square and trailing with baseline and touch pointers', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension, { prepared: true })
  const packing = page.locator('#orders-view'),
    session = await extension.context.newCDPSession(page)
  await expect(packing).toBeVisible()
  for (const touchOnly of [false, true]) {
    if (touchOnly)
      await session.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 1,
      })
    const coarse = await page.evaluate(
      () => matchMedia('(pointer: coarse)').matches
    )
    if (touchOnly) expect(coarse).toBe(true)
    for (const width of [1280, 820, 375]) {
      await page.setViewportSize({ width, height: 960 })
      const controls = await packing
        .locator('.order-section-band .operations-overflow')
        .evaluateAll((buttons) =>
          buttons.map((button) => {
            const box = button.getBoundingClientRect(),
              title = button
                .closest('.order-section-band')
                .getBoundingClientRect(),
              style = getComputedStyle(button),
              bandStyle = getComputedStyle(
                button.closest('.order-section-band')
              )
            return {
              width: box.width,
              height: box.height,
              // The Orders band has an intentional inset; the action belongs
              // at its content edge, as in the previous header text track.
              endGap:
                title.right - parseFloat(bandStyle.paddingRight) - box.right,
              padding: style.paddingBlockStart,
              minHeight: style.minHeight,
            }
          })
        )
      expect(controls.length).toBeGreaterThan(0)
      for (const control of controls) {
        expect(control.width).toBe(coarse ? 26 : 24)
        expect(control.height).toBe(coarse ? 26 : 24)
        expect(control.endGap).toBeLessThanOrEqual(1)
      }
    }
  }
  await packing
    .locator('.order-section-band')
    .first()
    .screenshot({ path: 'work/packing-order-overflow-coarse.png' })
  await session.detach()
})

test('native hybrid input keeps Operations compact and Orders supplier ellipses square', async () => {
  const script = await build({
    stdin: {
      contents: `export { openOperationsDialog, mountOperationsStrip } from './operations-ui.js';`,
      resolveDir: fileURLToPath(new URL('../../src/', import.meta.url)),
    },
    bundle: true,
    format: 'iife',
    globalName: 'Operations',
    write: false,
  })
  const styles = await Promise.all(
    ['library', 'operations', 'packing', 'shell'].map(async (name) => {
      const result = await build({
        entryPoints: [
          fileURLToPath(new URL(`../../dist/${name}.css`, import.meta.url)),
        ],
        bundle: true,
        write: false,
      })
      return result.outputFiles[0].text
    })
  )
  const browser = await chromium.launch({
    channel: process.env.EXTENSION_TEST_CHANNEL || 'chromium',
    headless: true,
    args: [
      '--blink-settings=primaryPointerType=2,availablePointerTypes=6,primaryHoverType=1,availableHoverTypes=2',
    ],
  })
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 960 },
    })
    await page.route('https://operations-fixture.test/', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><head><meta name="color-scheme" content="dark"></head><body><section id="orders-view"><header class="order-section-band"><h2>Synthetic hybrid store</h2></header></section></body></html>',
      })
    )
    await page.goto('https://operations-fixture.test/')
    for (const content of styles) await page.addStyleTag({ content })
    await page.addScriptTag({ content: script.outputFiles[0].text })
    expect(
      await page.evaluate(() => ({
        coarse: matchMedia('(pointer: coarse)').matches,
        fine: matchMedia('(any-pointer: fine)').matches,
        hover: matchMedia('(any-hover: hover)').matches,
        touchOnly: matchMedia('(any-hover: none)').matches,
      }))
    ).toEqual({ coarse: true, fine: true, hover: true, touchOnly: false })
    await page.evaluate((snapshot) => {
      window.hybridRecord = { snapshot }
      Operations.mountOperationsStrip(document.querySelector('h2'), {
        record: window.hybridRecord,
        onEdit() {},
      })
    }, snapshot())
    const header = page.locator('.order-section-band .operations-overflow'),
      bounds = await header.boundingBox()
    expect(bounds.width).toBe(26)
    expect(bounds.height).toBe(26)
    await page.evaluate(() => {
      void Operations.openOperationsDialog({
        record: window.hybridRecord,
        repository: {},
      })
    })
    const dialog = page.locator('.operations-dialog')
    await expect(dialog).toBeVisible()
    const sizes = await dialog.evaluate((dialog) => {
      const heights = (selector) =>
        [...dialog.querySelectorAll(selector)]
          .map((node) => node.getBoundingClientRect().height)
          .filter((height) => height > 0)
      return {
        tabs: heights('.operations-tabs button'),
        choices: heights('.operations-option > span'),
        shortcuts: heights('.operations-shortcut'),
        footer: heights('.operations-actions button'),
      }
    })
    for (const height of [...sizes.tabs, ...sizes.choices])
      expect(height).toBeLessThanOrEqual(30)
    for (const height of sizes.shortcuts) expect(height).toBeLessThanOrEqual(26)
    for (const height of sizes.footer) expect(height).toBeLessThanOrEqual(32)
    await dialog.locator('input[name="labels-dispatched-on"]').focus()
    await dialog.screenshot({ path: 'work/operations-controls-hybrid.png' })
  } finally {
    await browser.close()
  }
})
