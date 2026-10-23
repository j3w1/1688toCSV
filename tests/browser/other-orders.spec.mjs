import { readFile } from 'node:fs/promises'
import { test, expect } from './extension-fixture.mjs'
import {
  assignSelectedPurchaseCodes,
  editOrderProduct,
  closeOrderProduct,
} from './smart-workspace-helpers.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { otherOrderSnapshot } from '../../src/other-orders.js'
import { readBackupFile } from '../../src/backup-file.js'

const documentFor = (reference = 'EXT-SYNTHETIC-1') => ({
  format: '1688-order-entry',
  version: 1,
  supplier: 'Synthetic supplier',
  reference,
  date: '2026-10-15',
  products: [
    {
      description: '玻璃花瓶',
      specs: '透明',
      quantity: '4',
      unitPrice: '12.505',
    },
  ],
})
const action = (page, name) => page.locator(`[data-action="${name}"]:visible`)
async function open(extension) {
  const page = await extension.context.newPage()
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#order-count')).toHaveText('0')
  return page
}
async function orders(extension) {
  return extension.inspector.evaluate(
    async () =>
      (await chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })).data
  )
}
async function json(page, value) {
  await action(page, 'add-other-order').click()
  await page.locator('[data-action="other-order-file"]').setInputFiles({
    name: 'synthetic-order.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  })
  await expect(action(page, 'other-order-reference')).toHaveValue(
    value.reference
  )
  await action(page, 'other-order-save').click()
}
async function downloaded(extension, count) {
  await expect
    .poll(
      async () =>
        (
          await extension.inspector.evaluate(() => chrome.downloads.search({}))
        ).filter((file) => file.state === 'complete').length
    )
    .toBe(count)
  return extension.inspector.evaluate(() =>
    chrome.downloads.search({ orderBy: ['startTime'] })
  )
}

test('manual other-source order follows packing, labels, carton marks and full/scoped backup', async ({
  extension,
}) => {
  const page = await open(extension)
  const legacy = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const seeded = await extension.inspector.evaluate(
    (orders) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders: [orders[0]],
          history: [],
          images: [],
        },
      }),
    legacy
  )
  expect(seeded.ok, seeded.error).toBe(true)
  await expect(page.locator('#order-count')).toHaveText('1')
  await action(page, 'add-other-order').click()
  await action(page, 'other-order-supplier').fill('Synthetic supplier')
  await action(page, 'other-order-reference').fill('EXT-MANUAL-1')
  await action(page, 'other-order-date').fill('2026-10-15')
  await action(page, 'other-order-description').fill('玻璃花瓶')
  await action(page, 'other-order-specs').fill('透明')
  await action(page, 'other-order-quantity').fill('4')
  await action(page, 'other-order-unit-price').fill('12.505')
  const photo = await extension.inspector.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 8
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ff9900'
    ctx.fillRect(0, 0, 8, 8)
    return canvas.toDataURL('image/png')
  })
  await action(page, 'other-order-photo').setInputFiles({
    name: 'synthetic.png',
    mimeType: 'image/png',
    buffer: Buffer.from(photo.split(',')[1], 'base64'),
  })
  await expect(page.locator('.other-order-product img')).toBeVisible()
  await action(page, 'other-order-save').click()
  await expect(page.locator('.other-order-dialog')).toHaveCount(0)
  await expect(page.locator('#order-count')).toHaveText('2')
  await expect(page.locator('#order-list [data-source="other"]')).toHaveText(
    'Other source'
  )
  await expect(page.locator('#order-list')).toContainText('EXT-MANUAL-1')
  await expect(
    page
      .locator('#order-list [data-action="choose-order"]')
      .filter({ has: page.locator('[data-source="other"]') })
      .locator('.order-source-link')
  ).toHaveCount(0)
  await expect(page.locator('#refresh-all')).toBeEnabled()
  const original = await orders(extension)
  const entered = original.orders.find(
    (record) => record.snapshot.source === 'other'
  )
  expect(entered.snapshot).toMatchObject({
    source: 'other',
    reference: 'EXT-MANUAL-1',
    sourceUrl: '',
    totals: { payable: '50.02' },
  })
  expect(entered.snapshot.sellerMemberLogin).toBeUndefined()
  expect(
    original.orders.find(
      (record) => record.snapshot.orderId === legacy[0].snapshot.orderId
    ).snapshot
  ).toEqual(legacy[0].snapshot)
  // A manually entered supplier name is display text, not a source account.
  // Supply explicit authored identity without rewriting the original snapshot.
  await page
    .locator('#sheet-body [data-action="review-purchase-evidence"]')
    .first()
    .click()
  const evidence = page.locator(
    'dialog[data-action="review-purchase-evidence"]'
  )
  await evidence
    .getByLabel('Authored supplier identity', { exact: true })
    .fill('synthetic-manual-supplier')
  await evidence.locator('[data-action="resolve-purchase-supplier"]').click()
  await expect(evidence).toBeHidden()
  await page.locator('#select-rows').click()
  await assignSelectedPurchaseCodes(page)
  await expect(page.locator('#orders-view')).toBeVisible()
  await expect(page.locator('#sheet-body')).toContainText('EXT-MANUAL-1')
  await expect(page.locator('#sheet-body .order-source-link')).toHaveCount(0)
  const editor = await editOrderProduct(page, 0, {
    'Spanish name': 'FLORERO SINTETICO',
    'Chinese category': '花瓶',
  })
  await closeOrderProduct(editor)
  // Code assignment keeps this order's one product selected. Select-all is
  // deliberately disabled when the complete visible scope is already chosen.
  const product = page.locator('#sheet-body tr[data-selection-key]')
  await expect(product).toHaveCount(1)
  await product.getByRole('checkbox').check()
  await expect(product).toHaveAttribute('aria-selected', 'true')
  await action(page, 'open-print-menu').click()
  await action(page, 'print-labels').click()
  await action(page, 'export-pdf').click()
  let files = await downloaded(extension, 2)
  expect((await readFile(files[0].filename)).subarray(0, 5).toString()).toBe(
    '%PDF-'
  )
  const summary = JSON.parse(await readFile(files[1].filename, 'utf8'))
  expect(summary.orders[0]).toMatchObject({
    source: 'other',
    reference: 'EXT-MANUAL-1',
  })
  await action(page, 'close-print-dialog').click()
  await action(page, 'open-print-menu').click()
  await action(page, 'print-carton-marks').click()
  await action(page, 'export-pdf').click()
  files = await downloaded(extension, 4)
  expect(files[2].filename).toContain('CE-carton-marks-')
  expect((await readFile(files[2].filename)).subarray(0, 5).toString()).toBe(
    '%PDF-'
  )
  await action(page, 'close-print-dialog').click()
  const complete = await orders(extension)
  expect(complete.preparations).toHaveLength(1)
  const authored = complete.orders.find(
    (record) => record.snapshot.orderId === entered.snapshot.orderId
  )
  expect(authored.snapshot).toEqual(entered.snapshot)
  expect(authored.supplierIdentityResolution).toMatchObject({
    sellerId: 'synthetic-manual-supplier',
    provenance: 'manual-confirmed',
  })
  await action(page, 'backup-packing').click()
  const backupFiles = await downloaded(extension, 5)
  const scoped = await readBackupFile(
    new Blob([await readFile(backupFiles[4].filename)])
  )
  expect(scoped.packingScope).toBeTruthy()
  expect(scoped.orders[0].snapshot).toMatchObject({
    source: 'other',
    reference: 'EXT-MANUAL-1',
  })
  const scopedRestore = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    scoped
  )
  expect(scopedRestore.ok, scopedRestore.error).toBe(true)
  const restore = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    complete
  )
  expect(restore.ok, restore.error).toBe(true)
  expect((await orders(extension)).orders[0].snapshot).toEqual(
    complete.orders[0].snapshot
  )
  expect(extension.unexpectedRequests).toEqual([])
})

test('JSON entry, invalid/duplicate refusal and concurrent creates preserve the complete library', async ({
  extension,
}) => {
  const page = await open(extension),
    payload = documentFor()
  payload.products[0].photo = await extension.inspector.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 8
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ff9900'
    ctx.fillRect(0, 0, 8, 8)
    return canvas.toDataURL('image/png')
  })
  await action(page, 'add-other-order').click()
  await action(page, 'other-order-supplier').fill('Draft stays')
  const bad = structuredClone(payload)
  bad.products.push({ ...bad.products[0], quantity: '0' })
  await page.locator('[data-action="other-order-file"]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bad)),
  })
  await expect(page.locator('.other-order-error')).toHaveAttribute(
    'data-field',
    'products.1.quantity'
  )
  await expect(page.locator('.other-order-error')).toContainText('Product 2')
  await expect(action(page, 'other-order-supplier')).toHaveValue('Draft stays')
  expect((await orders(extension)).orders).toEqual([])
  await action(page, 'other-order-cancel').click()
  await json(page, payload)
  await expect(page.locator('#order-count')).toHaveText('1')
  const before = await orders(extension)
  await json(page, { ...payload, supplier: 'SYNTHETIC SUPPLIER' })
  await expect(page.locator('.other-order-error')).toContainText(
    'already exists'
  )
  const after = await orders(extension)
  for (const key of [
    'orders',
    'history',
    'images',
    'preparations',
    'allocations',
    'issuedCodes',
  ])
    expect(after[key]).toEqual(before[key])
  await action(page, 'other-order-cancel').click()
  const concurrent = await extension.inspector.evaluate(
    async (payload) =>
      Promise.all(
        [1, 2].map(() =>
          chrome.runtime.sendMessage({
            type: 'OTHER_ORDER_CREATE',
            order: payload,
          })
        )
      ),
    documentFor('EXT-CONCURRENT')
  )
  expect(concurrent.filter((result) => result.ok)).toHaveLength(1)
  expect(concurrent.filter((result) => !result.ok)[0].error).toContain(
    'already exists'
  )
  const stored = await orders(extension)
  expect(stored.orders).toHaveLength(2)
  const refresh = await extension.inspector.evaluate(
    (orderId) =>
      chrome.runtime.sendMessage({
        type: 'REFRESH_ORDERS',
        orderIds: [orderId],
      }),
    stored.orders[0].snapshot.orderId
  )
  expect(refresh.ok).toBe(false)
  expect(refresh.error).toContain('cannot be refreshed')
  const query = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'LIBRARY_QUERY' })
  )
  expect(query.data.jobs).toEqual([])
  const removed = await extension.inspector.evaluate(
    (orderIds) =>
      chrome.runtime.sendMessage({ type: 'LIBRARY_REMOVE', orderIds }),
    stored.orders.map((record) => record.snapshot.orderId)
  )
  expect(removed.ok, removed.error).toBe(true)
  expect((await orders(extension)).orders).toEqual([])
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    stored
  )
  expect(restored.ok, restored.error).toBe(true)
  expect(
    (await orders(extension)).orders.map((record) => record.snapshot)
  ).toEqual(stored.orders.map((record) => record.snapshot))
  expect(extension.unexpectedRequests).toEqual([])
})

test('manual field errors keep the draft and dialog actions fit a narrow viewport', async ({
  extension,
}) => {
  const page = await open(extension)
  await page.setViewportSize({ width: 390, height: 844 })
  await action(page, 'add-other-order').click()
  await action(page, 'other-order-supplier').fill('Synthetic supplier')
  await action(page, 'other-order-reference').fill('EXT-INVALID')
  await action(page, 'other-order-description').fill('Synthetic vase')
  await action(page, 'other-order-quantity').fill('0')
  await action(page, 'other-order-unit-price').fill('2')
  await action(page, 'other-order-save').click()
  await expect(action(page, 'other-order-quantity')).toHaveAttribute(
    'aria-invalid',
    'true'
  )
  await expect(action(page, 'other-order-reference')).toHaveValue('EXT-INVALID')
  expect((await orders(extension)).orders).toEqual([])
  for (let i = 0; i < 3; i++)
    await action(page, 'other-order-add-product').click()
  await expect(action(page, 'other-order-save')).toBeInViewport()
  expect(
    await page
      .locator('.other-order-dialog')
      .evaluate((node) => node.scrollWidth <= node.clientWidth)
  ).toBe(true)
  await action(page, 'other-order-cancel').click()
})

test('backup reference uniqueness uses the final reconciled state and rolls back stale collisions', async ({
  extension,
}) => {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  const makeRecord = (reference, id, now) => {
    const snapshot = otherOrderSnapshot(documentFor(reference), { id, now })
    return {
      snapshot,
      revision: 1,
      changedAt: now,
      lastCheckedAt: now,
      notes: '',
      tags: [],
      changedEntryIds: [],
      removedEntryIds: [],
    }
  }
  const a = makeRecord(
    'REF-X',
    '99000000000000000001',
    '2026-10-20T02:00:00.000Z'
  )
  const stale = makeRecord(
    'REF-Z',
    a.snapshot.orderId,
    '2026-10-20T01:00:00.000Z'
  )
  const newer = makeRecord(
    'REF-Z',
    a.snapshot.orderId,
    '2026-10-20T03:00:00.000Z'
  )
  const c = makeRecord(
    'REF-X',
    '99000000000000000003',
    '2026-10-20T01:00:00.000Z'
  )
  const results = await page.evaluate(
    async ({ a, stale, newer, c }) => {
      const { openDatabase, validateBackup } = await import('/src/database.js')
      const backup = (orders) => ({
        format: '1688-order-library',
        version: 1,
        exportedAt: '2026-10-20T04:00:00.000Z',
        orders,
        history: [],
        images: [],
      })
      const results = []
      for (const [label, incoming] of [
        ['stale-collision', [stale, c]],
        ['newer-control', [newer, c]],
        [
          'stale-distinct-control',
          [stale, { ...c, snapshot: { ...c.snapshot, reference: 'REF-Y' } }],
        ],
      ]) {
        const db = await openDatabase({
          name: `synthetic-reference-${label}-${crypto.randomUUID()}`,
        })
        await db.restoreBackup(backup([a]))
        const before = await db.exportBackup()
        let error = null
        try {
          await db.restoreBackup(backup(incoming))
        } catch (failure) {
          error = failure.message
        }
        const after = await db.exportBackup()
        const unchanged = [
          'orders',
          'history',
          'images',
          'preparations',
          'allocations',
          'issuedCodes',
          'packingPreferences',
        ].every(
          (key) => JSON.stringify(before[key]) === JSON.stringify(after[key])
        )
        let backupError = null
        try {
          validateBackup(after)
        } catch (failure) {
          backupError = failure.message
        }
        results.push({
          label,
          error,
          unchanged,
          backupError,
          references: after.orders
            .map((record) => record.snapshot.reference)
            .sort(),
        })
        db.close()
      }
      return results
    },
    { a, stale, newer, c }
  )
  expect(results[0]).toMatchObject({
    label: 'stale-collision',
    error: expect.stringContaining('already exists'),
    unchanged: true,
    backupError: null,
    references: ['REF-X'],
  })
  expect(results[1]).toMatchObject({
    error: null,
    backupError: null,
    references: ['REF-X', 'REF-Z'],
  })
  expect(results[2]).toMatchObject({
    error: null,
    backupError: null,
    references: ['REF-X', 'REF-Y'],
  })
  expect(extension.unexpectedRequests).toEqual([])
})

test('corrupt inline photos are refused by file entry, the manual picker, storage and restore', async ({
  extension,
}) => {
  const page = await open(extension)
  const payload = documentFor('EXT-CORRUPT')
  payload.products[0].photo = 'data:image/png;base64,iVBORw0KGgo='
  await action(page, 'add-other-order').click()
  await action(page, 'other-order-supplier').fill('Draft retained')
  await page.locator('[data-action="other-order-file"]').setInputFiles({
    name: 'corrupt-photo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  })
  await expect(page.locator('.other-order-error')).toContainText('decodable')
  await expect(page.locator('.other-order-error')).toHaveAttribute(
    'data-field',
    'products.0.photo'
  )
  await expect(action(page, 'other-order-supplier')).toHaveValue(
    'Draft retained'
  )
  await action(page, 'other-order-photo').setInputFiles({
    name: 'corrupt.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgo=', 'base64'),
  })
  await expect(page.locator('.other-order-error')).toContainText('decodable')
  await expect(page.locator('.other-order-product img')).toBeHidden()
  const rejected = await extension.inspector.evaluate(
    (order) =>
      chrome.runtime.sendMessage({ type: 'OTHER_ORDER_CREATE', order }),
    payload
  )
  expect(rejected.ok).toBe(false)
  expect(rejected.error).toContain('products.0.photo')
  expect((await orders(extension)).orders).toEqual([])
  const created = await extension.inspector.evaluate(
    (order) =>
      chrome.runtime.sendMessage({ type: 'OTHER_ORDER_CREATE', order }),
    documentFor('EXT-KEEP')
  )
  expect(created.ok, created.error).toBe(true)
  const before = await orders(extension),
    corrupt = structuredClone(before)
  corrupt.orders[0].snapshot.items[0].thumbnail = payload.products[0].photo
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    corrupt
  )
  expect(restored.ok).toBe(false)
  expect(restored.error).toContain('decodable')
  const after = await orders(extension)
  expect(after.orders).toEqual(before.orders)
  expect(after.history).toEqual(before.history)
  expect(extension.unexpectedRequests).toEqual([])
})

test('validation errors translate field labels and reasons while retaining machine paths and source values', async ({
  extension,
}) => {
  const page = await open(extension)
  for (const [language, label, reason] of [
    ['es', 'Cantidad', 'entero positivo'],
    ['zh', '数量', '正整数'],
  ]) {
    await page.evaluate(
      (language) => localStorage.setItem('1688-workspace-language', language),
      language
    )
    await page.reload()
    await action(page, 'add-other-order').click()
    await action(page, 'other-order-supplier').fill('Synthetic supplier')
    await action(page, 'other-order-reference').fill('EXT-LANGUAGE')
    await action(page, 'other-order-description').fill('Source description')
    await action(page, 'other-order-quantity').fill('0')
    await action(page, 'other-order-unit-price').fill('2')
    await action(page, 'other-order-save').click()
    await expect(page.locator('.other-order-error')).toContainText(label)
    await expect(page.locator('.other-order-error')).toContainText(reason)
    await expect(page.locator('.other-order-error')).toHaveAttribute(
      'data-field',
      'products.0.quantity'
    )
    await expect(action(page, 'other-order-quantity')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    await expect(action(page, 'other-order-description')).toHaveValue(
      'Source description'
    )
    await action(page, 'other-order-cancel').click()
  }
  expect((await orders(extension)).orders).toEqual([])
})
