import { test, expect } from './extension-fixture.mjs'
import { repeatSubsetFixture } from '../fixtures/repeat-subset-fixture.mjs'

function sources() {
  return ['3', '27'].map((quantity, index) => {
    const price = index ? '10.00' : '12.00'
    const gross = (Number(quantity) * Number(price)).toFixed(2)
    const orderId = String(8701 + index)
    return {
      schemaVersion: 1,
      accountId: 'local',
      orderId,
      sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
      sellerName: 'Synthetic repeat supplier',
      sellerMemberLogin: 'synthetic-repeat-supplier',
      status: 'Completed',
      observedAt: '2026-10-01T00:00:00.000Z',
      items: [
        {
          entryId: '1',
          title: 'Cup',
          description: 'Red cup',
          thumbnail: '',
          skuProperties: [
            { label: '颜色', value: '红色' },
            { label: '尺寸', value: 'S' },
          ],
          quantity,
          price,
          sourceDiscount: '0.00',
          allocatedDiscount: '0.00',
          discount: '0.00',
        },
      ],
      totals: {
        goodsGross: gross,
        shipping: '0.00',
        sourceDiscount: '0.00',
        orderAdjustment: '0.00',
        goodsNet: gross,
        payable: gross,
      },
    }
  })
}

async function setup(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async (snapshots) => {
    const { openDatabase } = await import('/src/database.js')
    const { createPreparation } = await import('/src/packing-model.js')
    window.testDatabaseName = `synthetic-repeats-${crypto.randomUUID()}`
    window.openRepeatDatabase = openDatabase
    window.repeatLibrary = await openDatabase({ name: window.testDatabaseName })
    for (const snapshot of snapshots) await repeatLibrary.saveSnapshot(snapshot)
    window.repeatPreparations = await repeatLibrary.savePreparations(
      snapshots.map((snapshot) => {
        const preparation = createPreparation(snapshot, '2026-10')
        preparation.groups[0].spanishName = 'TAZA'
        preparation.groups[0].category = '杯子'
        return preparation
      })
    )
    window.repeatRef = (index) => ({
      accountId: 'local',
      orderId: repeatPreparations[index].orderId,
      groupId: repeatPreparations[index].groups[0].id,
    })
  }, sources())
  return page
}

test('a carton marked by one linked purchase prints once when all selected contents belong to its same-code counterpart', async ({
  extension,
}) => {
  const storagePage = await setup(extension)
  const backup = await storagePage.evaluate(async () => {
    const plan = await repeatLibrary.previewRepeatProductLink({
      source: repeatRef(1),
      target: repeatRef(0),
    })
    await repeatLibrary.linkRepeatProduct(plan)
    await repeatLibrary.saveCartonBatch(
      {
        id: 'synthetic-zero-piece-mark-owner',
        accountId: 'local',
        month: '2026-10',
        storeId: '["1688","synthetic-repeat-supplier"]',
        mark: { orderId: repeatRef(0).orderId, groupId: repeatRef(0).groupId },
        groups: [
          { orderId: repeatRef(1).orderId, groupId: repeatRef(1).groupId },
        ],
        contents: [
          { orderId: repeatRef(1).orderId, entryId: '1', quantity: '27' },
        ],
        cartonNumber: '1',
        count: 1,
        len: '40',
        wid: '30',
        ht: '25',
        weightBasis: 'carton',
        weight: '9.5',
        received: 1,
        loaded: 0,
      },
      { expectedRevision: 0 }
    )
    return repeatLibrary.exportBackup()
  })
  for (const record of backup.orders)
    record.snapshot.purchasedAt = '2026-10-15T12:00:00+08:00'
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    backup
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    2
  )
  await page.locator('#sheet-body tr[data-selection-key="8702/1"]').click()
  await page.locator('#orders-print-actions .copy-actions-trigger').click()
  await page.locator('#print-carton-marks').click()
  const dialog = page.getByRole('dialog', {
    name: 'Print carton marks',
    exact: true,
  })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel(/^Quantity for /)).toHaveCount(1)
  await expect(dialog.getByLabel(/^Quantity for /)).toHaveValue('1')
  const code = backup.preparations.find((prep) => prep.orderId === '8701')
    .groups[0].baseCode
  await expect(dialog.getByLabel(/^Quantity for /)).toHaveAccessibleName(
    `Quantity for ${code}`
  )
})

test('repeat-product dialog previews both purchases, cancellation writes nothing and applying keeps both selected rows', async ({
  extension,
}) => {
  const storagePage = await setup(extension)
  const backup = await storagePage.evaluate(() => repeatLibrary.exportBackup())
  backup.orders.forEach((record) => {
    record.snapshot.purchasedAt = '2026-10-15T12:00:00+08:00'
    record.unitsPerCarton = { 1: 3 }
    record.unitsPerCartonUpdatedAt = '2026-10-15T12:00:00.000Z'
    record.productWorkflow = {
      1: { features: { lighting: true, rotation: true } },
    }
    record.productWorkflowUpdatedAt = '2026-10-15T12:00:00.000Z'
  })
  const seeded = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    backup
  )
  expect(seeded.ok, seeded.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(2)
  const source = page.locator('#sheet-body tr[data-selection-key="8702/1"]')
  await source.click()
  const original = page.locator('#sheet-body tr[data-selection-key="8701/1"]')
  await original.click({ modifiers: ['Control'] })
  await source
    .getByRole('button', { name: 'Link repeat purchase', exact: true })
    .click()
  let dialog = page.getByRole('dialog', {
    name: 'Link repeat purchase',
    exact: true,
  })
  await dialog.locator('.repeat-product-candidate input').first().check()
  await expect(dialog.locator('.repeat-product-source')).toHaveCount(2)
  await expect(dialog.locator('.repeat-product-features')).toHaveText([
    'Lighting · Rotation',
    'Lighting · Rotation',
  ])
  await expect(
    dialog.getByText('Combined label quantity: 30', { exact: true })
  ).toHaveCount(2)
  await expect(
    dialog.getByRole('button', { name: 'Use the original codes', exact: true })
  ).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  const cancelled = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(cancelled.data.preparations).toEqual(backup.preparations)
  expect(cancelled.data.issuedCodes).toEqual(backup.issuedCodes)
  await source
    .getByRole('button', { name: 'Link repeat purchase', exact: true })
    .click()
  dialog = page.getByRole('dialog', {
    name: 'Link repeat purchase',
    exact: true,
  })
  await dialog.locator('.repeat-product-candidate input').first().check()
  await expect(dialog.locator('.repeat-product-source')).toHaveCount(2)
  await dialog
    .getByRole('checkbox', {
      name: 'I checked the variants, sizes and features.',
    })
    .check()
  await dialog
    .getByRole('button', { name: 'Use the original codes', exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
  await expect(rows).toHaveCount(2)
  await expect(
    rows.locator('[aria-label="Linked repeat purchase"]')
  ).toHaveCount(2)
  await expect(
    page.locator('#sheet-body tr[aria-selected="true"]')
  ).toHaveCount(2)
  expect(await source.locator('.row-code-copy').innerText()).toBe(
    await original.locator('.row-code-copy').innerText()
  )
  await page.locator('#orders-print-actions .copy-actions-trigger').click()
  await page.locator('#print-labels').click()
  const labels = page.getByRole('dialog', { name: 'Print labels', exact: true })
  await expect(labels.getByLabel(/^Quantity for /)).toHaveCount(1)
  await expect(labels.getByLabel(/^Quantity for /)).toHaveValue('30')
  await labels.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('#orders-print-actions .copy-actions-trigger').click()
  await page.locator('#print-carton-marks').click()
  const marks = page.getByRole('dialog', {
    name: 'Print carton marks',
    exact: true,
  })
  await expect(marks.getByLabel(/^Quantity for /)).toHaveCount(1)
  await expect(marks.getByLabel(/^Quantity for /)).toHaveValue('10')
  await expect(marks.locator('.print-known')).toContainText('10')
  await marks.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('reviewed repeated purchases save atomically with one shared owner and separate source finances, then restore a clipped identity', async ({
  extension,
}) => {
  const page = await setup(extension)
  const result = await page.evaluate(async () => {
    const before = await repeatLibrary.exportBackup()
    const plan = await repeatLibrary.previewRepeatProductLink({
      source: repeatRef(1),
      target: repeatRef(0),
    })
    const afterPreview = await repeatLibrary.exportBackup()
    const linked = await repeatLibrary.linkRepeatProduct(plan)
    const backup = await repeatLibrary.exportBackup()
    const { createPackingBackup } = await import('/src/packing-backup.js')
    const partial = createPackingBackup(backup, {
      months: ['2026-10'],
      orders: [{ accountId: 'local', orderId: '8702', entryIds: ['1'] }],
    })
    const fresh = await openRepeatDatabase({
      name: `synthetic-repeat-restored-${crypto.randomUUID()}`,
    })
    await fresh.restoreBackup(partial)
    const restored = await fresh.exportBackup()
    const current = linked.find((preparation) => preparation.orderId === '8702')
    const changed = structuredClone(current)
    changed.groups[0].baseCode = 'CE26100199'
    let editError
    try {
      await repeatLibrary.savePreparation(changed)
    } catch (error) {
      editError = error.message
    }
    return {
      beforePreview:
        JSON.stringify(before.preparations) ===
          JSON.stringify(afterPreview.preparations) &&
        JSON.stringify(before.issuedCodes) ===
          JSON.stringify(afterPreview.issuedCodes),
      codes: linked.map((preparation) => preparation.groups[0].baseCode),
      sharedOwners: backup.issuedCodes.map((entry) => ({
        code: entry.code,
        members: entry.members.map((member) => member.orderId),
      })),
      quantities: backup.orders.map(
        (record) => record.snapshot.items[0].quantity
      ),
      costs: backup.orders.map((record) => record.snapshot.totals.payable),
      changes: plan.changes.map(
        ({ quantity, combinedQuantity, before, after }) => ({
          quantity,
          combinedQuantity,
          before,
          after,
        })
      ),
      originalCode: before.preparations.find(
        (preparation) => preparation.orderId === '8701'
      ).groups[0].baseCode,
      restored: {
        orders: restored.orders.length,
        preparations: restored.preparations.length,
        owners: restored.issuedCodes.map((entry) => entry.members.length),
        sharedProductId: restored.preparations[0].groups[0].sharedProductId,
      },
      editError,
    }
  })
  expect(result.beforePreview).toBe(true)
  expect(result.codes).toEqual([result.originalCode, result.originalCode])
  expect(result.sharedOwners).toHaveLength(2)
  for (const owner of result.sharedOwners)
    expect(owner.members.sort()).toEqual(['8701', '8702'])
  expect(result.quantities.sort()).toEqual(['27', '3'])
  expect(result.costs.sort()).toEqual(['270.00', '36.00'])
  expect(
    result.changes.every((change) => change.combinedQuantity === '30')
  ).toBe(true)
  expect(result.restored).toMatchObject({
    orders: 1,
    preparations: 1,
    owners: [1, 1],
  })
  expect(result.restored.sharedProductId).toBeTruthy()
  expect(result.editError).toContain('Unlink this repeat purchase')
})

test('repeat link rejects stale preparation revisions and refreshed source evidence without a partial write', async ({
  extension,
}) => {
  const page = await setup(extension)
  const result = await page.evaluate(async () => {
    const stale = await repeatLibrary.previewRepeatProductLink({
      source: repeatRef(1),
      target: repeatRef(0),
    })
    const concurrent = await openRepeatDatabase({ name: testDatabaseName })
    const next = structuredClone(repeatPreparations[1])
    next.groups[0].category = 'Changed elsewhere'
    await concurrent.savePreparation(next)
    const beforeStale = await repeatLibrary.exportBackup()
    let staleError
    try {
      await repeatLibrary.linkRepeatProduct(stale)
    } catch (error) {
      staleError = error.message
    }
    const afterStale = await repeatLibrary.exportBackup()
    const fresh = await repeatLibrary.previewRepeatProductLink({
      source: repeatRef(1),
      target: repeatRef(0),
    })
    const source = structuredClone(
      (await repeatLibrary.getOrder('8702')).snapshot
    )
    source.observedAt = '2026-10-02T00:00:00.000Z'
    source.items[0].description = 'Changed source description'
    await concurrent.saveSnapshot(source)
    const beforeSource = await repeatLibrary.exportBackup()
    let sourceError
    try {
      await repeatLibrary.linkRepeatProduct(fresh)
    } catch (error) {
      sourceError = error.message
    }
    const afterSource = await repeatLibrary.exportBackup()
    return {
      staleError,
      sourceError,
      unchangedStale:
        JSON.stringify(beforeStale.preparations) ===
          JSON.stringify(afterStale.preparations) &&
        JSON.stringify(beforeStale.issuedCodes) ===
          JSON.stringify(afterStale.issuedCodes),
      unchangedSource:
        JSON.stringify(beforeSource.preparations) ===
          JSON.stringify(afterSource.preparations) &&
        JSON.stringify(beforeSource.issuedCodes) ===
          JSON.stringify(afterSource.issuedCodes),
    }
  })
  expect(result.staleError).toContain('Preparation changed in another tab')
  expect(result.sourceError).toContain('source order changed')
  expect(result.unchangedStale).toBe(true)
  expect(result.unchangedSource).toBe(true)
})

test('repeat feature review detects concurrent changes and linked feature edits require unlinking', async ({
  extension,
}) => {
  const page = await setup(extension)
  const result = await page.evaluate(async () => {
    const plan = await repeatLibrary.previewRepeatProductLink({
      source: repeatRef(1),
      target: repeatRef(0),
    })
    await repeatLibrary.setProductWorkflow('8702', '1', {
      features: { lighting: true },
    })
    let staleFeatureError
    try {
      await repeatLibrary.linkRepeatProduct(plan)
    } catch (error) {
      staleFeatureError = error.message
    }
    const unlinked = await repeatLibrary.exportBackup()
    await repeatLibrary.setProductWorkflow('8701', '1', {
      features: { lighting: true },
    })
    const fresh = await repeatLibrary.previewRepeatProductLink({
      source: repeatRef(1),
      target: repeatRef(0),
    })
    await repeatLibrary.linkRepeatProduct(fresh)
    const before = await repeatLibrary.exportBackup()
    let featureEditError
    try {
      await repeatLibrary.setProductWorkflow('8702', '1', {
        features: { lighting: true, rotation: true },
      })
    } catch (error) {
      featureEditError = error.message
    }
    const after = await repeatLibrary.exportBackup()
    await repeatLibrary.setProductWorkflow('8702', '1', {
      features: { lighting: true },
      missingLabels: { active: true },
    })
    const statusEdit = await repeatLibrary.getOrder('8702')
    return {
      staleFeatureError,
      featureEditError,
      noPartialLink: unlinked.preparations.every(
        (preparation) => !preparation.groups[0].sharedProductId
      ),
      featureUnchanged:
        JSON.stringify(before.orders) === JSON.stringify(after.orders),
      statusAllowed: statusEdit.productWorkflow['1'].missingLabels.active,
    }
  })
  expect(result.staleFeatureError).toContain('The source order changed')
  expect(result.noPartialLink).toBe(true)
  expect(result.featureEditError).toContain('Unlink this repeat purchase')
  expect(result.featureUnchanged).toBe(true)
  expect(result.statusAllowed).toBe(true)
})

test('unlinking uses a free code and removing the primary purchase preserves surviving shared ownership', async ({
  extension,
}) => {
  const page = await setup(extension)
  const result = await page.evaluate(async () => {
    const link = await repeatLibrary.previewRepeatProductLink({
      source: repeatRef(1),
      target: repeatRef(0),
    })
    await repeatLibrary.linkRepeatProduct(link)
    const before = await repeatLibrary.exportBackup()
    const unlink = await repeatLibrary.previewRepeatProductUnlink({
      source: repeatRef(1),
    })
    const previewUnchanged = await repeatLibrary.exportBackup()
    const detached = await repeatLibrary.unlinkRepeatProduct(unlink)
    const after = await repeatLibrary.exportBackup()
    const surviving = after.preparations.find(
      (preparation) => preparation.orderId === '8701'
    )
    const detachedCode = detached[0].groups[0].baseCode
    const relink = await repeatLibrary.previewRepeatProductLink({
      source: repeatRef(1),
      target: repeatRef(0),
    })
    await repeatLibrary.linkRepeatProduct(relink)
    await repeatLibrary.removeOrders(['8701'])
    const remaining = await repeatLibrary.exportBackup()
    const ownership = await repeatLibrary.queryCodeOwnership(
      remaining.preparations[0].groups[0].baseCode
    )
    return {
      noPreviewWrites:
        JSON.stringify(before.preparations) ===
        JSON.stringify(previewUnchanged.preparations),
      originalCode: before.preparations[0].groups[0].baseCode,
      detachedCode,
      survivingCode: surviving.groups[0].baseCode,
      sharedOwnersAfterUnlink: after.issuedCodes
        .filter((entry) => entry.sharedProductId)
        .map((entry) => entry.members.length),
      remainingOrders: remaining.orders.map(
        (record) => record.snapshot.orderId
      ),
      remainingOwners: remaining.issuedCodes.map((entry) => ({
        orderId: entry.orderId,
        members: entry.members.map((member) => member.orderId),
      })),
      ownershipOrders: ownership.owners.map(
        (owner) => owner.orderId || owner.reservation?.orderId
      ),
    }
  })
  expect(result.noPreviewWrites).toBe(true)
  expect(result.detachedCode).not.toBe(result.originalCode)
  expect(result.survivingCode).toBe(result.originalCode)
  expect(result.sharedOwnersAfterUnlink).toEqual([1, 1])
  expect(result.remainingOrders).toEqual(['8702'])
  expect(
    result.remainingOwners.every(
      (owner) => owner.orderId === '8702' && owner.members.join() === '8702'
    )
  ).toBe(true)
  expect(result.ownershipOrders).toContain('8702')
})

test('a single-size repeat selects the original S card, stores canonical subset reservations and unlinks without changing M/L', async ({
  extension,
}) => {
  test.setTimeout(60000)
  const data = repeatSubsetFixture()
  const backup = {
    format: '1688-order-library',
    version: 3,
    exportedAt: '2026-10-21T00:00:00.000Z',
    orders: data.records,
    preparations: data.preparations,
    allocations: data.allocations,
    issuedCodes: data.issuedCodes,
    history: [],
    images: [],
  }
  const seeded = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    backup
  )
  expect(seeded.ok, seeded.error).toBe(true)
  const page = await extension.context.newPage()
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('.month-toggle')).toHaveCount(1)
  for (const toggle of await page
    .locator('.month-toggle[aria-expanded=false]')
    .all())
    await toggle.click()
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(4)
  const source = page.locator('#sheet-body tr[data-selection-key="8805/1"]')
  await expect(source.locator('.row-code-copy')).toHaveText('CE26101005')
  await source
    .getByRole('button', { name: 'Link repeat purchase', exact: true })
    .click()
  const dialog = page.getByRole('dialog', {
    name: 'Link repeat purchase',
    exact: true,
  })
  await expect(dialog.locator('select, [role="combobox"]')).toHaveCount(0)
  const candidate = dialog.locator('.repeat-product-candidate')
  await expect(candidate).toHaveCount(1)
  await expect(candidate.locator('code')).toHaveText('CE26101001S')
  await expect(candidate.locator('[data-code-part="product"]')).toHaveText(
    '1001'
  )
  await expect(candidate).toContainText('55cm')
  await expect(candidate).toContainText('Quantity 3')
  await expect(candidate.locator('img')).toHaveCount(1)
  await page.setViewportSize({ width: 375, height: 900 })
  const geometry = await dialog.evaluate((node) => ({
    width: node.clientWidth,
    content: node.scrollWidth,
  }))
  expect(geometry.content).toBeLessThanOrEqual(geometry.width)
  const search = dialog.getByLabel('Search original products', { exact: true })
  await search.fill('CE26101001M')
  await expect(candidate).toBeHidden()
  await expect(dialog.locator('.repeat-product-empty')).toContainText(
    'No original products match this search'
  )
  await search.fill('55cm')
  await expect(candidate).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 960 })
  await candidate.locator('input').check()
  await expect(dialog.locator('.repeat-product-source')).toHaveCount(4)
  await dialog
    .getByRole('checkbox', {
      name: 'I checked the variants, sizes and features.',
      exact: true,
    })
    .check()
  await dialog
    .getByRole('button', { name: 'Use the original codes', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  await expect(source.locator('.row-code-copy')).toHaveText('CE26101001S')
  for (const [entryId, code] of [
    ['1', 'CE26101001S'],
    ['2', 'CE26101001M'],
    ['3', 'CE26101001L'],
  ]) {
    await expect(
      page.locator(
        `#sheet-body tr[data-selection-key="8801/${entryId}"] .row-code-copy`
      )
    ).toHaveText(code)
  }
  const linked = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(linked.ok, linked.error).toBe(true)
  const owners = Object.fromEntries(
    linked.data.issuedCodes
      .filter((entry) => entry.kind === 'barcode')
      .map((entry) => [entry.code, entry.members.length])
  )
  expect(owners).toEqual({ CE26101001S: 2, CE26101001M: 1, CE26101001L: 1 })
  for (const record of data.records)
    expect(
      linked.data.orders.find(
        (value) => value.snapshot.orderId === record.snapshot.orderId
      ).snapshot
    ).toEqual(record.snapshot)
  await source
    .getByRole('button', { name: 'Linked repeat purchase', exact: true })
    .click()
  const unlink = page.getByRole('dialog', {
    name: 'Unlink repeat purchase',
    exact: true,
  })
  await expect(unlink.locator('.repeat-product-source')).toHaveCount(1)
  await unlink
    .getByRole('checkbox', {
      name: 'I checked the variants, sizes and features.',
      exact: true,
    })
    .check()
  await unlink
    .getByRole('button', { name: 'Unlink and assign code', exact: true })
    .click()
  await expect(unlink).toHaveCount(0)
  await expect(source.locator('.row-code-copy')).not.toHaveText('CE26101001S')
  const detached = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(detached.ok, detached.error).toBe(true)
  const original = detached.data.preparations.find(
    (draft) => draft.orderId === '8801'
  ).groups[0]
  expect(original.baseCode).toBe('CE26101001')
  expect(original.variants.map((variant) => variant.sizeSuffix)).toEqual([
    'S',
    'M',
    'L',
  ])
  expect(
    detached.data.issuedCodes
      .filter((entry) => entry.sharedProductId)
      .every((entry) => entry.members.length === 1)
  ).toBe(true)
  for (const record of data.records)
    expect(
      detached.data.orders.find(
        (value) => value.snapshot.orderId === record.snapshot.orderId
      ).snapshot
    ).toEqual(record.snapshot)
  await page.close()
})
