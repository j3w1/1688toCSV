import { test, expect } from './extension-fixture.mjs'
import { readFile } from 'node:fs/promises'
import { readBackupFile } from '../../src/backup-file.js'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  assignSelectedPurchaseCodes,
  editOrderProduct,
  closeOrderProduct,
  libraryBackup as backup,
  loadedSourceContainer,
  openContainerOutput,
} from './smart-workspace-helpers.mjs'

for (const theme of ['dark', 'light']) {
  test(`${theme} conflict comparisons stay in place while help opens and proposals show every barcode`, async ({
    extension,
  }) => {
    const { page, view } = await openPacking(extension)
    await page.setViewportSize({ width: 1400, height: 1000 })
    if (
      (await page
        .locator('meta[name="color-scheme"]')
        .getAttribute('content')) !== theme
    )
      await page.locator('#theme-toggle').click()
    const before = await backup(extension)
    const first = view
    const savedGroup = before.preparations[0].groups[0]
    const occupied = before.preparations[0].groups[1].baseCode
    await first.getByLabel('Product code', { exact: true }).fill(occupied)
    await expect(
      first.getByLabel('Product code', { exact: true })
    ).toHaveAttribute('aria-invalid', 'true')
    await first
      .getByRole('button', { name: 'Resolve code conflict', exact: true })
      .click()
    const dialog = page.getByRole('dialog', {
      name: 'Resolve code conflict',
      exact: true,
    })
    const impact = dialog.locator('.conflict-edit-card .conflict-code-impact')
    await expect(impact).toHaveCSS('grid-column', '1 / -1')
    await expect(impact.locator('.packing-value-row').first()).toHaveCSS(
      'display',
      'grid'
    )
    await expect(impact.locator('.packing-value-row')).toHaveCount(3)
    await expect(impact.locator('.packing-value-before code')).toHaveText([
      savedGroup.baseCode,
      ...savedGroup.variants.map(
        (variant) =>
          savedGroup.baseCode + variant.variantSuffix + variant.sizeSuffix
      ),
    ])
    await expect(
      dialog
        .locator('.conflict-owner-card')
        .getByLabel('Product code', { exact: true })
    ).toHaveValue(occupied)
    for (const table of await dialog.locator('.packing-value-table').all())
      expect(
        await table.evaluate((node) => node.scrollWidth - node.clientWidth)
      ).toBeLessThanOrEqual(1)
    const ownerPhoto = await dialog
      .locator('.conflict-owner-card .preparation-photo')
      .boundingBox()
    const ownerDetails = await dialog
      .locator('.conflict-owner-card .conflict-product-details')
      .boundingBox()
    expect(ownerPhoto.x + ownerPhoto.width).toBeLessThanOrEqual(ownerDetails.x)
    const buttons = dialog.locator(
      '.conflict-recovery-actions button, .conflict-apply-actions button'
    )
    const boxes = () =>
      buttons.evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect()
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          }
        })
      )
    const keep = dialog.getByRole('button', {
      name: 'Keep saved version',
      exact: true,
    })
    await keep.scrollIntoViewIfNeeded()
    const positions = await boxes()
    await keep.hover()
    await expect(dialog.getByRole('tooltip')).toBeVisible()
    expect(await boxes()).toEqual(positions)
    await page.mouse.move(4, 4)
    await expect(dialog.getByRole('tooltip')).toHaveCount(0)
    await dialog
      .locator('.conflict-edit-card')
      .getByLabel('Product code', { exact: true })
      .fill('CE26100199')
    await expect(impact.locator('.packing-value-after code')).toHaveText([
      'CE26100199',
      ...savedGroup.variants.map(
        (variant) => 'CE26100199' + variant.variantSuffix + variant.sizeSuffix
      ),
    ])
    const [beforeColor, afterColor] = await Promise.all([
      impact
        .locator('.packing-value-before code')
        .first()
        .evaluate((node) => getComputedStyle(node).backgroundColor),
      impact
        .locator('.packing-value-after code')
        .first()
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    ])
    expect(beforeColor).toBe('rgb(0, 0, 0)')
    expect(afterColor).toBe(beforeColor)
    const captions = await impact
      .locator('thead th.packing-value-caption:not([aria-hidden])')
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color))
    expect(captions[0]).not.toBe(captions[1])
    expect((await backup(extension)).preparations).toEqual(before.preparations)
    const contrasts = await impact
      .locator('.packing-value-row[data-changed="true"] code')
      .evaluateAll((codes) => {
        const light = (css) => {
          const rgb = css
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number)
            .map((v) => {
              const c = v / 255
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
            })
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
        }
        return codes.map((code) => {
          const style = getComputedStyle(code),
            a = light(style.color),
            b = light(style.backgroundColor)
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        })
      })
    for (const contrast of contrasts)
      expect(contrast).toBeGreaterThanOrEqual(4.5)
    await dialog.screenshot({
      path: test.info().outputPath(`conflict-resolution-${theme}.png`),
    })
    await page.setViewportSize({ width: 420, height: 780 })
    await expect
      .poll(() =>
        dialog.evaluate((node) => node.scrollWidth - node.clientWidth)
      )
      .toBeLessThanOrEqual(1)
    await dialog
      .getByRole('button', { name: 'Apply corrections', exact: true })
      .scrollIntoViewIfNeeded()
    await expect(
      dialog.getByRole('button', { name: 'Apply corrections', exact: true })
    ).toBeInViewport()
    await dialog.screenshot({
      path: test.info().outputPath(`conflict-resolution-${theme}-narrow.png`),
    })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await backup(extension)).preparations).toEqual(before.preparations)
  })
}

async function openPacking(extension, { orderCount = 1 } = {}) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerName = 'Synthetic feedback store'
  record.snapshot.sellerMemberLogin = 'synthetic-feedback'
  record.snapshot.sellerShopOrigin = 'https://synthetic-feedback.1688.com'
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = index < 2 ? '合成玻璃罐' : '合成收纳盒'
    item.productNumber = index < 2 ? 'TEST-JAR' : 'TEST-BOX'
    item.skuProperties = [
      {
        label: '颜色',
        value: index === 0 ? '红色' : '白色',
        raw: index === 0 ? '颜色：红色' : '颜色：白色',
      },
    ]
    item.description = `${item.title}\n${item.skuProperties[0].raw}`
  }
  const records = Array.from({ length: orderCount }, (_, index) => {
    const order = structuredClone(record)
    order.snapshot.orderId = String(7400000000000000000n + BigInt(index))
    order.snapshot.sourceUrl = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${order.snapshot.orderId}`
    return order
  })
  const response = await extension.inspector.evaluate(
    async (records) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders: records,
          history: [],
          images: [],
        },
      }),
    records
  )
  expect(response.ok, response.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(Math.min(100, 3 * orderCount))
  await rows.first().focus()
  await page.keyboard.press('Control+a')
  await assignSelectedPurchaseCodes(page)
  const view = await editOrderProduct(page, 0)
  return { page, view, record: records[0], records }
}

async function openCodeConflict(page, editor, value) {
  const code = editor.getByRole('textbox', {
    name: 'Product code',
    exact: true,
  })
  await code.fill(value)
  await expect(code).toHaveAttribute('aria-invalid', 'true')
  await editor
    .getByRole('button', { name: 'Resolve code conflict', exact: true })
    .click()
  const resolver = page.locator('.code-conflict-dialog')
  await expect(resolver).toBeVisible()
  return resolver
}
const codes = (data) =>
  data.preparations.map((prep) => [
    prep.orderId,
    prep.groups.map((group) => [
      group.baseCode,
      group.variants.map((variant) => [
        variant.variantSuffix,
        variant.sizeSuffix,
      ]),
    ]),
  ])
const byOrder = (data, id) =>
  data.preparations.find((prep) => prep.orderId === id)
async function travel(page, direction) {
  await page
    .locator('dialog[data-action="edit-order-product"]')
    .getByRole('button', { name: direction, exact: true })
    .click()
  await expect(
    page.locator('dialog[data-action="edit-order-product"]')
  ).toBeVisible()
}

test('either same-order owner can release its code atomically without changing source rows', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const before = await backup(extension),
    [target, owner] = before.preparations[0].groups
  const resolver = await openCodeConflict(page, view, owner.baseCode)
  await resolver
    .locator('.conflict-owner-card')
    .getByRole('textbox', { name: 'Product code', exact: true })
    .fill('CE26100199')
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver).toBeHidden()
  const after = await backup(extension)
  expect(
    after.preparations[0].groups.find((group) => group.id === target.id)
      .baseCode
  ).toBe(owner.baseCode)
  expect(
    after.preparations[0].groups.find((group) => group.id === owner.id).baseCode
  ).toBe('CE26100199')
  expect(after.orders).toEqual(before.orders)
})

test('cross-order swaps cancel locally, reject invalid corrections and apply/Undo/Redo both owners together', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension, { orderCount: 2 })
  const before = await backup(extension),
    [target, owner] = before.preparations
  let resolver = await openCodeConflict(page, view, owner.groups[0].baseCode)
  const ownerCode = () =>
    resolver
      .locator('.conflict-owner-card')
      .getByRole('textbox', { name: 'Product code', exact: true })
  await ownerCode().fill(target.groups[0].baseCode)
  await resolver.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  await view
    .getByRole('button', { name: 'Resolve code conflict', exact: true })
    .click()
  resolver = page.locator('.code-conflict-dialog')
  await ownerCode().fill('BROKEN')
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver).toBeVisible()
  await expect(resolver.getByRole('status')).toContainText(/code|CE/i)
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  await ownerCode().fill(target.groups[0].baseCode)
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver).toBeHidden()
  const swapped = await backup(extension)
  expect(byOrder(swapped, target.orderId).groups[0].baseCode).toBe(
    owner.groups[0].baseCode
  )
  expect(byOrder(swapped, owner.orderId).groups[0].baseCode).toBe(
    target.groups[0].baseCode
  )
  await travel(page, 'Undo')
  expect(codes(await backup(extension))).toEqual(codes(before))
  await travel(page, 'Redo')
  expect(codes(await backup(extension))).toEqual(codes(swapped))
  expect((await backup(extension)).orders).toEqual(before.orders)
})

test('a stale owner rejects the entire correction and preserves both the newer authoring and local conflict draft', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension, { orderCount: 2 })
  const before = await backup(extension),
    [target, owner] = before.preparations
  const resolver = await openCodeConflict(page, view, owner.groups[0].baseCode)
  await resolver
    .locator('.conflict-owner-card')
    .getByRole('textbox', { name: 'Product code', exact: true })
    .fill(target.groups[0].baseCode)
  const other = await extension.context.newPage()
  await other.goto(`${extension.extensionBaseUrl}/library.html`)
  const editor = await editOrderProduct(
    other,
    {
      accountId: owner.accountId,
      orderId: owner.orderId,
      entryId: owner.groups[0].variants[0].entryIds[0],
    },
    { 'Spanish name': 'NEWER NAME' }
  )
  await closeOrderProduct(editor)
  const newer = await backup(extension)
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver.getByRole('status')).toContainText(
    /changed|revision|another tab/i
  )
  await expect(
    resolver
      .locator('.conflict-owner-card')
      .getByRole('textbox', { name: 'Product code', exact: true })
  ).toHaveValue(target.groups[0].baseCode)
  expect((await backup(extension)).preparations).toEqual(newer.preparations)
})

for (const [field, invalid, expected] of [
  ['Variant ending', 'XL', /variant|size/i],
  ['Size ending', 'A', /size|variant/i],
])
  test(`${field} rejects swapped segment semantics while retaining the last valid codes`, async ({
    extension,
  }) => {
    const { view } = await openPacking(extension)
    const before = await backup(extension),
      input = view.getByRole('textbox', { name: field, exact: true })
    await input.fill(invalid)
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(view.getByRole('status')).toContainText(expected)
    expect(codes(await backup(extension))).toEqual(codes(before))
  })

test('typing a product conflict hides stale preview immediately, keeps other fields and reverts cleanly to a saved code', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const before = await backup(extension),
    original = before.preparations[0].groups[0].baseCode
  await view
    .getByRole('textbox', { name: 'Spanish name', exact: true })
    .fill('PENDING NAME')
  const resolver = await openCodeConflict(
    page,
    view,
    before.preparations[0].groups[1].baseCode
  )
  await expect(view.locator('.preparation-label-preview img')).toHaveCount(0)
  expect(codes(await backup(extension))).toEqual(codes(before))
  await resolver
    .locator('.conflict-edit-card')
    .getByRole('textbox', { name: 'Product code', exact: true })
    .fill(original)
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver).toBeHidden()
  const saved = await backup(extension)
  expect(codes(saved)).toEqual(codes(before))
  expect(saved.preparations[0].groups[0].variants[0].spanishName).toBe(
    'PENDING NAME'
  )
  expect(saved.orders).toEqual(before.orders)
  await expect(
    page.locator('.product-authoring-dialog [aria-invalid="true"]')
  ).toHaveCount(0)
})

test('same-product variant collisions can be corrected inside the resolver without changing the shared base', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const before = await backup(extension),
    group = before.preparations[0].groups[0],
    [target, owner] = group.variants
  await view
    .getByRole('textbox', { name: 'Size ending', exact: true })
    .fill(owner.sizeSuffix)
  const variant = view.getByRole('textbox', {
    name: 'Variant ending',
    exact: true,
  })
  await variant.fill(owner.variantSuffix)
  await expect(variant).toHaveAttribute('aria-invalid', 'true')
  await view
    .getByRole('button', { name: 'Resolve code conflict', exact: true })
    .click()
  const resolver = page.locator('.code-conflict-dialog')
  const targetCard = resolver.locator('.conflict-edit-card')
  await targetCard
    .getByRole('textbox', { name: 'Variant ending', exact: true })
    .nth(0)
    .fill('ZZ')
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver).toBeHidden()
  const saved = (await backup(extension)).preparations[0].groups[0]
  expect(saved.baseCode).toBe(group.baseCode)
  expect(
    saved.variants.find((variant) => variant.id === target.id).variantSuffix
  ).toBe('ZZ')
  expect(saved.variants.find((variant) => variant.id === owner.id)).toEqual(
    owner
  )
})

test('next available code proposal changes no persisted ownership until Apply', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const before = await backup(extension)
  const resolver = await openCodeConflict(
    page,
    view,
    before.preparations[0].groups[1].baseCode
  )
  await resolver
    .getByRole('button', { name: 'Use next available code', exact: true })
    .click()
  const proposed = await resolver
    .locator('.conflict-edit-card')
    .getByRole('textbox', { name: 'Product code', exact: true })
    .inputValue()
  expect(
    before.preparations[0].groups.map((group) => group.baseCode)
  ).not.toContain(proposed)
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver).toBeHidden()
  expect((await backup(extension)).preparations[0].groups[0].baseCode).toBe(
    proposed
  )
  expect((await backup(extension)).orders).toEqual(before.orders)
})

test('correcting a code retains raw pending fields and Cancel leaves the resolver proposal entirely local', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const before = await backup(extension)
  await view
    .getByRole('textbox', { name: 'Chinese category', exact: true })
    .fill('待保存类别')
  const resolver = await openCodeConflict(
    page,
    view,
    before.preparations[0].groups[1].baseCode
  )
  await resolver
    .locator('.conflict-edit-card')
    .getByRole('textbox', { name: 'Product code', exact: true })
    .fill('CE26100199')
  await resolver.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(
    view.getByRole('textbox', { name: 'Chinese category', exact: true })
  ).toHaveValue('待保存类别')
  await expect(
    view.getByRole('textbox', { name: 'Product code', exact: true })
  ).toHaveValue(before.preparations[0].groups[1].baseCode)
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  await view
    .getByRole('textbox', { name: 'Product code', exact: true })
    .fill(before.preparations[0].groups[0].baseCode)
  await closeOrderProduct(view)
  expect((await backup(extension)).preparations[0].groups[0].category).toBe(
    '待保存类别'
  )
})

test('packing backup includes hidden/offscreen Orders and restore rejects a full-library file without mutation', async ({
  extension,
}) => {
  const { page, view, records } = await openPacking(extension, {
    orderCount: 40,
  })
  await closeOrderProduct(view)
  const before = await backup(extension)
  await page.locator('#search').fill('no matching products')
  // Scoped backup is defined by saved preparations, never by display rows.
  const scoped = await extension.inspector.evaluate(async () => {
    const repository = await window.testRepository
    return repository.exportBackup({
      packingScope: {
        months: ['2026-10'],
        orders: (await repository.listPreparations()).map((prep) => ({
          accountId: prep.accountId,
          orderId: prep.orderId,
          entryIds: prep.groups.flatMap((group) =>
            group.variants.flatMap((variant) => variant.entryIds)
          ),
        })),
      },
    })
  })
  expect(scoped.preparations.map((prep) => prep.orderId).sort()).toEqual(
    records.map((record) => record.snapshot.orderId).sort()
  )
  expect(scoped.orders.map((record) => record.snapshot.orderId).sort()).toEqual(
    records.map((record) => record.snapshot.orderId).sort()
  )
  await page.locator('#restore-packing-file').setInputFiles({
    name: 'full-library.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(before)),
  })
  await expect(page.locator('.error-notice')).toContainText(
    /packing backup|packing archive/i
  )
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  expect((await backup(extension)).orders).toEqual(before.orders)
})

test('container output errors route authorship to Orders without introducing a second code editor', async ({
  extension,
}) => {
  const { page, view, record } = await openPacking(extension)
  await closeOrderProduct(view)
  const id = await loadedSourceContainer(extension, [
    { accountId: 'local', orderId: record.snapshot.orderId },
  ])
  const packing = await openContainerOutput(page, id)
  await expect(
    packing.locator('input[data-authoring-field],.product-authoring-fields')
  ).toHaveCount(0)
  await packing
    .locator('tr[data-container-row]')
    .first()
    .locator('td')
    .nth(3)
    .click()
  const details = page.locator('.product-details-dialog')
  await expect(details).toHaveAttribute('data-mode', 'read-only')
  await details.locator('[data-action="edit-in-orders"]').click()
  await expect(page.locator('.product-authoring-dialog')).toBeVisible()
  await closeOrderProduct(page.locator('.product-authoring-dialog'))
  await page.locator('[data-action="return-to-container"]').click()
  await expect(packing.locator('[data-action="choose-container"]')).toHaveValue(
    id
  )
})

test(
  'a product reuses its own released code after Orders reload without retaining alternate reservations',
  { tag: '@smoke' },
  async ({ extension }) => {
    const { page, view } = await openPacking(extension)
    const initial = await backup(extension),
      group = initial.preparations[0].groups[0],
      alternate = 'CE26100109'
    await closeOrderProduct(view)
    for (let round = 0; round < 2; round++) {
      for (const value of [alternate, group.baseCode]) {
        const product = await editOrderProduct(page, 0, {
          'Product code': value,
        })
        await closeOrderProduct(product)
        expect(
          (await backup(extension)).preparations[0].groups[0].baseCode
        ).toBe(value)
      }
      await page.reload()
    }
    const final = await backup(extension)
    expect(final.preparations[0].groups[0].id).toBe(group.id)
    expect(
      final.preparations[0].groups[0].variants.map((variant) => variant.id)
    ).toEqual(group.variants.map((variant) => variant.id))
    for (const variant of group.variants)
      expect(final.issuedCodes).toContainEqual(
        expect.objectContaining({
          kind: 'barcode',
          code: group.baseCode + variant.variantSuffix + variant.sizeSuffix,
          groupId: group.id,
          variantId: variant.id,
        })
      )
    expect(
      final.issuedCodes.some((owner) => owner.code.startsWith(alternate))
    ).toBe(false)
    expect(final.orders).toEqual(initial.orders)
  }
)

test(
  'scoped Orders backup downloads original complete source and restores selected products without recoding',
  { tag: '@smoke' },
  async ({ extension }) => {
    const { page, view, record } = await openPacking(extension)
    await closeOrderProduct(view)
    await page.locator('#clear-rows').click()
    for (const index of [0, 1])
      await page
        .locator('#sheet-body tr[data-selection-key]')
        .nth(index)
        .getByRole('checkbox')
        .check()
    const before = await backup(extension)
    const pending = page.waitForEvent('download')
    await page.locator('#backup-packing').click()
    const download = await pending
    expect(await download.failure()).toBeNull()
    const content = await readFile(await download.path()),
      saved = await readBackupFile(new Blob([content]))
    expect(saved.packingScope.mode).toBe('selection')
    expect(saved.packingScope.orders[0].entryIds).toEqual(
      record.snapshot.items.slice(0, 2).map((item) => item.entryId)
    )
    expect(saved.preparations[0].groups).toHaveLength(1)
    expect(saved.preparations[0].groups[0].variants).toHaveLength(2)
    expect(saved.orders[0].snapshot.items).toEqual(record.snapshot.items)
    await expect(page.locator('#restore-packing')).toBeVisible()
    await expect(
      page.locator('#orders-copy-actions #restore-packing')
    ).toHaveCount(0)
    await page.locator('#restore-packing-file').setInputFiles({
      name: 'packing.json.gz',
      mimeType: 'application/gzip',
      buffer: content,
    })
    const review = page.getByRole('dialog', {
      name: 'Restore packing backup?',
      exact: true,
    })
    await expect(review).toBeVisible()
    await review
      .getByRole('button', { name: 'Restore packing', exact: true })
      .click()
    await expect(review).toBeHidden()
    const after = await backup(extension)
    expect(after.preparations).toEqual(before.preparations)
    expect(after.issuedCodes).toEqual(before.issuedCodes)
    expect(after.orders).toEqual(before.orders)
  }
)
