import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

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

async function openWorkspace(extension, { tags = false } = {}) {
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
  const restored = await extension.inspector.evaluate(
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
    record
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

test('order and product status controls stay compact, save exceptions and preserve selection', async ({
  extension,
}) => {
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
  expect(
    await card.evaluate((node) => node.classList.contains('is-selected'))
  ).toBe(beforeSelection)
  await dialog
    .getByLabel('Delay state', { exact: true })
    .filter({ visible: true })
    .selectOption('delayed')
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
    .getByLabel('Delay state', { exact: true })
    .filter({ visible: true })
    .selectOption('none')
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
      .getByLabel('Cost treatment', { exact: true })
      .selectOption(treatment)
  }
  await expect(dialog.locator('.operations-feature-row')).toHaveCount(3)
  await expect(dialog.locator('.operations-feature-total')).toContainText(
    '1.70'
  )
  const controls = await dialog
    .locator('.operations-feature-row')
    .first()
    .evaluate((row) =>
      [...row.querySelectorAll('input, select, button')].map((node) => {
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
