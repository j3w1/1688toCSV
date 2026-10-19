import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { readFile } from 'node:fs/promises'

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
    const groups = view.locator('.preparation-group')
    const first = groups.first()
    const savedGroup = before.preparations[0].groups[0]
    const occupied = before.preparations[0].groups[1].baseCode
    await first.getByLabel('Product code', { exact: true }).fill(occupied)
    await expect(
      first.getByLabel('Product code', { exact: true })
    ).toHaveAttribute('aria-invalid', 'true')
    await first
      .locator('.product-summary')
      .getByRole('button', { name: 'Resolve code', exact: true })
      .click()
    const dialog = page.getByRole('dialog', {
      name: 'Resolve code conflict',
      exact: true,
    })
    const impact = dialog.locator('.conflict-code-impact')
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
      dialog.locator('.conflict-owner-card .conflict-occupied-code')
    ).toHaveText(occupied)
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
    await dialog.getByLabel('Product code', { exact: true }).fill('CE26100199')
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
    expect(beforeColor).not.toBe(afterColor)
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
    await dialog
      .getByRole('button', { name: 'Continue editing', exact: true })
      .click()
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
  await expect(rows).toHaveCount(3 * orderCount)
  await rows.first().focus()
  await page.keyboard.press('Control+a')
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  const view = page.locator('#packing-view')
  const review = page.getByRole('dialog', { name: /^Assign product codes\?$/ })
  await expect
    .poll(async () => (await view.isVisible()) || (await review.isVisible()))
    .toBe(true)
  if (await review.isVisible())
    await review
      .getByRole('button', { name: 'Assign codes and prepare', exact: true })
      .click()
  await expect(view.locator('.preparation-group')).toHaveCount(
    Math.min(20, 2 * orderCount)
  )
  return { page, view, record: records[0], records }
}

async function backup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}

test(
  'a product can reuse its first code after a saved code change and a workspace reload',
  { tag: '@smoke' },
  async ({ extension }) => {
    const { page, view } = await openPacking(extension)
    const initial = await backup(extension)
    const first = initial.preparations[0].groups[0]
    const group = view.locator(`[data-group-id="${first.id}"]`)
    const code = group.getByLabel('Product code', { exact: true })
    const variantIds = first.variants.map((variant) => variant.id)
    const alternate = 'CE26100109'
    // 0102 already belongs to the second fixture product; use a free code so
    // this exercises same-product reuse, rather than stealing another's code.
    for (const value of [alternate, first.baseCode]) {
      await code.fill(value)
      await expect
        .poll(
          async () =>
            (await backup(extension)).preparations[0].groups[0].baseCode
        )
        .toBe(value)
      await expect(code).not.toHaveAttribute('aria-invalid', 'true')
      await expect(view.locator('.preparation-save-status')).toHaveText(
        'Saved automatically'
      )
    }
    await page.reload()
    await page
      .getByRole('button', { name: 'Prepare packing list', exact: true })
      .click()
    await expect(group).toBeVisible()
    for (const value of [alternate, first.baseCode]) {
      await code.fill(value)
      await expect
        .poll(
          async () =>
            (await backup(extension)).preparations[0].groups[0].baseCode
        )
        .toBe(value)
      await expect(code).not.toHaveAttribute('aria-invalid', 'true')
      await expect(view.locator('.preparation-save-status')).toHaveText(
        'Saved automatically'
      )
    }
    const final = await backup(extension)
    expect(final.preparations[0].groups[0].id).toBe(first.id)
    expect(
      final.preparations[0].groups[0].variants.map((variant) => variant.id)
    ).toEqual(variantIds)
    expect(final.issuedCodes).toEqual(
      expect.arrayContaining(initial.issuedCodes)
    )
    expect(final.orders).toEqual(initial.orders)
    for (const base of [first.baseCode]) {
      for (const variant of first.variants) {
        expect(final.issuedCodes).toContainEqual(
          expect.objectContaining({
            kind: 'barcode',
            code: `${base}${variant.variantSuffix}${variant.sizeSuffix}`,
            groupId: first.id,
            variantId: variant.id,
          })
        )
      }
    }
    expect(
      final.issuedCodes.some((code) => code.code.startsWith(alternate))
    ).toBe(false)
  }
)

async function downloadPacking(extension, page, view) {
  const downloaded = page.waitForEvent('download')
  const trigger = view.getByRole('button', {
    name: 'More copy formats',
    exact: true,
  })
  if ((await trigger.getAttribute('aria-expanded')) !== 'true')
    await trigger.click()
  await view
    .getByRole('button', { name: 'Back up packing', exact: true })
    .click()
  const file = await downloaded
  expect(await file.failure()).toBeNull()
  const downloads = await extension.inspector.evaluate(() =>
    chrome.downloads.search({})
  )
  expect(downloads).toHaveLength(1)
  expect(downloads[0].state).toBe('complete')
  return readFile(downloads[0].filename)
}

test(
  'packing backup includes the whole remaining session without selection and restores from Orders without recoding',
  { tag: '@smoke' },
  async ({ extension }) => {
    const { page, view, record } = await openPacking(extension)
    await expect(
      view.getByLabel('Packing backup file', { exact: true })
    ).toHaveCount(0)
    const remove = view
      .locator('.preparation-group')
      .last()
      .getByRole('button', { name: 'Remove group', exact: true })
    await remove.focus()
    await remove.click()
    const removal = page.getByRole('dialog', {
      name: 'Remove from packing?',
      exact: true,
    })
    await removal
      .getByRole('button', { name: 'Remove from packing', exact: true })
      .click()
    await expect(removal).toBeHidden()
    await expect(view.locator('.variants tbody tr')).toHaveCount(2)
    const clear = view.getByRole('button', {
      name: 'Clear selection',
      exact: true,
    })
    if (await clear.isEnabled()) await clear.click()
    await expect(clear).toBeDisabled()
    await expect(
      view.locator('.variants tbody tr[aria-selected="true"]')
    ).toHaveCount(0)
    const save = view.getByRole('button', {
      name: 'Back up packing',
      exact: true,
      includeHidden: true,
    })
    await expect(save).toBeEnabled()
    const before = await backup(extension)
    const content = await downloadPacking(extension, page, view)
    const saved = JSON.parse(content)
    expect(saved.packingScope.mode).toBe('selection')
    expect(saved.packingScope.orders[0].entryIds).toEqual(
      record.snapshot.items.slice(0, 2).map((item) => item.entryId)
    )
    expect(saved.preparations[0].groups).toHaveLength(1)
    expect(saved.preparations[0].groups[0].variants).toHaveLength(2)
    expect(saved.orders[0].snapshot.items).toHaveLength(3)
    await page.keyboard.press('Escape')
    await view.getByRole('button', { name: 'Orders', exact: true }).click()
    await expect(page.locator('#restore-packing')).toBeVisible()
    await expect(
      page.locator('#orders-copy-actions #restore-packing')
    ).toHaveCount(0)
    await page
      .getByLabel('Packing backup file', { exact: true })
      .setInputFiles({
        name: 'packing.json',
        mimeType: 'application/json',
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
    await expect(view.locator('.preparation-group')).toHaveCount(1)
    await expect(view.locator('.variants tbody tr')).toHaveCount(2)
    const after = await backup(extension)
    expect(after.preparations).toEqual(before.preparations)
    expect(after.issuedCodes).toEqual(before.issuedCodes)
    expect(after.orders).toEqual(before.orders)
  }
)

test('packing backup includes orders on other pages and outside the display filter', async ({
  extension,
}) => {
  const { page, view, records } = await openPacking(extension, {
    orderCount: 11,
  })
  await view.getByRole('button', { name: 'Next groups', exact: true }).click()
  await expect(view.locator('.preparation-group')).toHaveCount(2)
  await expect(view.locator('.packing-pages')).toContainText(
    '2 / 2 · 22 groups'
  )
  await view
    .getByLabel('Show packing orders', { exact: true })
    .selectOption({ index: 1 })
  await expect(view.locator('.preparation-group')).toHaveCount(2)
  await view
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  const content = await downloadPacking(extension, page, view)
  const saved = JSON.parse(content)
  expect(saved.packingScope.orders).toHaveLength(11)
  expect(saved.preparations).toHaveLength(11)
  expect(saved.preparations.flatMap((draft) => draft.groups)).toHaveLength(22)
  expect(
    saved.packingScope.orders.reduce(
      (sum, order) => sum + order.entryIds.length,
      0
    )
  ).toBe(33)
  expect(
    saved.packingScope.orders.map((order) => order.orderId).sort()
  ).toEqual(records.map((record) => record.snapshot.orderId).sort())
  for (const record of records)
    expect(
      saved.packingScope.orders.find(
        (order) => order.orderId === record.snapshot.orderId
      ).entryIds
    ).toEqual(record.snapshot.items.map((item) => item.entryId))
})

test('Orders packing restore rejects a full-library file without changing saved data', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  await view.getByRole('button', { name: 'Orders', exact: true }).click()
  const before = await backup(extension)
  await page.getByLabel('Packing backup file', { exact: true }).setInputFiles({
    name: 'full-library.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(before)),
  })
  await expect(page.locator('.error-notice')).toContainText(
    'Choose a file created by Back up packing'
  )
  await expect(
    page.getByRole('dialog', { name: 'Restore packing backup?', exact: true })
  ).toHaveCount(0)
  await expect(view).toBeHidden()
  const after = await backup(extension)
  expect(after.preparations).toEqual(before.preparations)
  expect(after.issuedCodes).toEqual(before.issuedCodes)
  expect(after.orders).toEqual(before.orders)
})

test('a product code conflict is visible while typing and can be resolved without losing the draft', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const groups = view.locator('.preparation-group')
  const first = groups.first().getByLabel('Product code', { exact: true })
  const other = await groups
    .nth(1)
    .getByLabel('Product code', { exact: true })
    .inputValue()
  const before = await backup(extension)
  await first.fill(other)
  await expect(first).toBeFocused()
  await expect(first).toHaveAttribute('aria-invalid', 'true')
  await expect(
    groups.first().locator('.product-summary > .code-field-error:not([hidden])')
  ).toContainText(/reserved|conflict/i)
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  await groups
    .first()
    .locator('.product-summary')
    .getByRole('button', { name: 'Resolve code', exact: true })
    .click()
  const resolver = page.getByRole('dialog', {
    name: 'Resolve code conflict',
    exact: true,
  })
  await expect(resolver.locator('.preparation-photo')).toHaveCount(2)
  await resolver
    .getByRole('button', { name: 'Use next available code', exact: true })
    .click()
  await expect(resolver).toBeVisible()
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  await expect(resolver.locator('.packing-value-row')).toHaveCount(3)
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver).toBeHidden()
  await expect(first).not.toHaveValue(other)
  await expect(first).not.toHaveAttribute('aria-invalid', 'true')
  const after = await backup(extension)
  expect(after.orders).toEqual(before.orders)
  const changed = after.preparations[0].groups[0]
  expect(
    after.issuedCodes
      .filter((code) => code.groupId === changed.id)
      .map((code) => code.code)
  ).toEqual([
    changed.baseCode,
    ...changed.variants.map(
      (variant) => changed.baseCode + variant.variantSuffix + variant.sizeSuffix
    ),
  ])
  expect(
    after.issuedCodes.filter((code) => code.groupId !== changed.id)
  ).toEqual(before.issuedCodes.filter((code) => code.groupId !== changed.id))
})

test('carton editor lists all affected variants and resolves a conflicting code before blur', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const groups = view.locator('.preparation-group')
  const other = await groups
    .nth(1)
    .getByLabel('Product code', { exact: true })
    .inputValue()
  await groups.first().locator('.carton-preview button').click()
  const label = page.locator('#label-dialog')
  await expect(label.locator('.label-affected-item')).toHaveCount(2)
  await expect(label.locator('.label-affected-products')).toContainText(
    /share|same/i
  )
  const input = label.getByLabel('Base CE code', { exact: true })
  await input.fill(other)
  await expect(input).toBeFocused()
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(
    label.getByRole('button', { name: 'Copy label', exact: true })
  ).toBeDisabled()
  await label.getByRole('button', { name: 'Resolve code', exact: true }).click()
  const resolver = page.getByRole('dialog', {
    name: 'Resolve code conflict',
    exact: true,
  })
  await resolver
    .getByRole('button', { name: 'Use next available code', exact: true })
    .click()
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver).toBeHidden()
  await expect(input).not.toHaveValue(other)
  await expect(
    label.getByRole('button', { name: 'Copy label', exact: true })
  ).toBeEnabled()
})

test('an unresolved size elsewhere does not block resolving a newly mapped variant barcode collision', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const seeded = await backup(extension)
  const preparation = seeded.preparations[0]
  // A valid saved draft may await size mapping. Keep its previously issued
  // codes reserved, just as a user clearing an uncertain mapping would.
  preparation.groups[0].variants[0].needsSizeMapping = true
  preparation.groups[1].variants[0].needsSizeMapping = true
  preparation.updatedAt = '2090-10-15T04:00:00.000Z'
  const restored = await extension.inspector.evaluate(
    (data) =>
      chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup: data }),
    seeded
  )
  expect(restored.ok, restored.error).toBe(true)
  await page.reload()
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  await expect(view).toBeVisible()
  const before = await backup(extension)
  const [group, unrelated] = before.preparations[0].groups
  const [edited, owner] = group.variants
  const row = view
    .locator(`[data-group-id="${group.id}"] .variants tbody tr`)
    .first()
  const variantCode = row.getByLabel(`Variant code ${edited.id}`, {
    exact: true,
  })
  const sizeCode = row.getByLabel(`Size code ${edited.id}`, { exact: true })
  await variantCode.fill(owner.variantSuffix)
  await sizeCode.fill('S')
  await sizeCode.fill(owner.sizeSuffix)
  await expect(sizeCode).toHaveAttribute('aria-invalid', 'true')
  await row.getByRole('button', { name: 'Resolve code', exact: true }).click()
  const resolver = page.getByRole('dialog', {
    name: 'Resolve code conflict',
    exact: true,
  })
  await expect(resolver).toBeVisible()
  await resolver
    .getByRole('button', {
      name: 'Use next available variant code',
      exact: true,
    })
    .click()
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver).toBeHidden()
  const after = await backup(extension)
  const changed = after.preparations[0].groups[0].variants[0]
  expect(changed.id).toBe(edited.id)
  expect(changed.needsSizeMapping).toBe(false)
  expect(changed.variantSuffix).not.toBe(owner.variantSuffix)
  expect(after.preparations[0].groups[0].baseCode).toBe(group.baseCode)
  expect(after.preparations[0].groups[0].variants[1]).toEqual(owner)
  expect(after.preparations[0].groups[1]).toEqual(unrelated)
  expect(after.orders).toEqual(before.orders)
  expect(
    after.issuedCodes.some(
      (issued) =>
        issued.kind === 'barcode' &&
        issued.variantId === edited.id &&
        issued.code ===
          group.baseCode + changed.variantSuffix + changed.sizeSuffix
    )
  ).toBe(true)
  expect(
    after.issuedCodes.some(
      (issued) =>
        issued.kind === 'barcode' &&
        issued.variantId === owner.id &&
        issued.code === group.baseCode + owner.variantSuffix + owner.sizeSuffix
    )
  ).toBe(true)
})

test('conflicting barcode previews disappear immediately and a delayed render cannot restore them', async ({
  extension,
}) => {
  test.setTimeout(60_000)
  const { page, view } = await openPacking(extension)
  await page.setViewportSize({ width: 1600, height: 1800 })
  const groups = view.locator('.preparation-group')
  for (let index = 0; index < 2; index++) {
    await groups
      .nth(index)
      .getByLabel('Spanish short name', { exact: true })
      .fill(index ? 'CAJA' : 'TARRO')
    await groups
      .nth(index)
      .getByLabel('Chinese category', { exact: true })
      .fill(index ? '收纳盒' : '玻璃罐')
  }
  const [first, second] = await groups
    .first()
    .locator('.variants tbody tr')
    .all()
  const firstVariant = first.locator('.code-part-variantSuffix input')
  const secondVariant = second.locator('.code-part-variantSuffix input')
  const firstSize = first.locator('.code-part-sizeSuffix input')
  const secondSize = second.locator('.code-part-sizeSuffix input')
  const firstPreview = first.getByRole('button', {
    name: 'Edit barcode',
    exact: true,
  })
  const secondPreview = second.getByRole('button', {
    name: 'Edit barcode',
    exact: true,
  })
  const carton = groups.first().getByAltText('Carton mark preview', {
    exact: true,
  })
  const unrelated = groups.nth(1).getByAltText('Barcode preview', {
    exact: true,
  })
  await firstVariant.fill('A')
  await firstSize.fill('A')
  await secondVariant.fill('B')
  await secondSize.fill('B')
  // Settle the serialized initial renders before testing immediate invalidation.
  // Native PNG encoding can take several seconds in the background browser.
  for (const preview of [firstPreview, secondPreview])
    await expect(preview).toHaveAttribute('data-preview-state', 'ready', {
      timeout: 20_000,
    })
  await expect(carton).toBeVisible()
  await expect(unrelated).toBeVisible()
  const cartonUrl = await carton.getAttribute('src')
  const unrelatedUrl = await unrelated.getAttribute('src')

  // Clearing the variant letters is still valid while size endings differ.
  await firstVariant.fill('')
  await secondVariant.fill('')
  for (const preview of [firstPreview, secondPreview])
    await expect(preview).toHaveAttribute('data-preview-state', 'ready')
  await firstSize.fill('')
  await expect(firstPreview).toHaveAttribute('data-preview-state', 'ready')

  // Hold a real reduced barcode PNG in flight, then make its model invalid.
  await page.evaluate(() => {
    const encode = HTMLCanvasElement.prototype.toBlob
    let hold = true
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      if (hold && this.width === 360 && this.height === 180) {
        hold = false
        window.finishBarcodePreview = () =>
          new Promise((resolve) => {
            encode.call(
              this,
              (blob) => {
                callback(blob)
                resolve()
              },
              ...args
            )
          })
        return
      }
      return encode.call(this, callback, ...args)
    }
  })
  await secondSize.fill('C')
  await expect
    .poll(() => page.evaluate(() => Boolean(window.finishBarcodePreview)))
    .toBe(true)
  await secondSize.fill('')
  for (const preview of [firstPreview, secondPreview]) {
    await expect(preview).toHaveAttribute('data-preview-state', 'invalid')
    await expect(preview.locator('img')).toBeHidden()
    await expect(preview.locator('img')).not.toHaveAttribute('src')
    await expect(preview).toContainText('Code conflict')
  }
  await expect(firstSize).toHaveAttribute('aria-invalid', 'true')
  await expect(secondSize).toHaveAttribute('aria-invalid', 'true')
  await expect(carton).toHaveAttribute('src', cartonUrl)
  await expect(unrelated).toHaveAttribute('src', unrelatedUrl)
  await page.evaluate(async () => {
    await window.finishBarcodePreview()
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
  for (const preview of [firstPreview, secondPreview]) {
    await expect(preview).toHaveAttribute('data-preview-state', 'invalid')
    await expect(preview.locator('img')).not.toHaveAttribute('src')
  }

  // The invalid image itself opens the existing conflict recovery flow.
  await secondPreview.click()
  const resolver = page.getByRole('dialog', {
    name: 'Resolve code conflict',
    exact: true,
  })
  await expect(resolver).toBeVisible()
  await resolver
    .getByRole('button', {
      name: 'Use next available variant code',
      exact: true,
    })
    .click()
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver).toBeHidden()
  for (const preview of [firstPreview, secondPreview])
    // Recovery re-encodes the real PNGs through the same serialized queue.
    await expect(preview).toHaveAttribute('data-preview-state', 'ready', {
      timeout: 20_000,
    })
  await expect(firstSize).not.toHaveAttribute('aria-invalid', 'true')
  await expect(secondSize).not.toHaveAttribute('aria-invalid', 'true')
  const saved = (await backup(extension)).preparations[0].groups[0]
  const codes = saved.variants.map(
    (variant) => saved.baseCode + variant.variantSuffix + variant.sizeSuffix
  )
  expect(new Set(codes).size).toBe(2)
})

test('reverting to a saved barcode before rerender does not leave its preview checking forever', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  await page.setViewportSize({ width: 1600, height: 1200 })
  const group = view.locator('.preparation-group').first()
  await group.getByLabel('Spanish short name', { exact: true }).fill('TARRO')
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  const preview = group
    .getByRole('button', { name: 'Edit barcode', exact: true })
    .first()
  await expect(preview).toHaveAttribute('data-preview-state', 'ready')
  const before = await backup(extension)
  // Keep the edit, revert and selection rerender in one task so the old input
  // is disconnected before its 180ms ownership check is allowed to start.
  await view
    .getByRole('button', { name: 'Clear selection', exact: true })
    .evaluate((clear) => {
      const input = document.querySelector(
        '#preparation-content .variants tbody tr .code-part-variantSuffix input'
      )
      const saved = input.value
      input.value = `${saved}Z`
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.value = saved
      input.dispatchEvent(new Event('input', { bubbles: true }))
      clear.click()
    })
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  await expect(preview).toHaveAttribute('data-preview-state', 'ready')
  await expect(preview.getByAltText('Barcode preview')).toBeVisible()
  const after = await backup(extension)
  expect(after.preparations).toEqual(before.preparations)
  expect(after.issuedCodes).toEqual(before.issuedCodes)
  expect(after.orders).toEqual(before.orders)
})

test('conflict popup restores only code edits and preserves other pending fields', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const original = await backup(extension)
  const groups = view.locator('.preparation-group')
  const first = groups.first()
  await first
    .getByLabel('Spanish short name', { exact: true })
    .fill('NOMBRE CONSERVADO')
  await first.getByLabel('Chinese category', { exact: true }).fill('保留分类')
  await first
    .getByLabel('Product code', { exact: true })
    .fill(original.preparations[0].groups[1].baseCode)
  await expect(
    first.getByLabel('Product code', { exact: true })
  ).toHaveAttribute('aria-invalid', 'true')
  await first
    .locator('.product-summary')
    .getByRole('button', { name: 'Resolve code', exact: true })
    .click()
  const resolver = page.getByRole('dialog', {
    name: 'Resolve code conflict',
    exact: true,
  })
  await expect(
    resolver.getByLabel('Product code', { exact: true })
  ).toBeVisible()
  await resolver
    .getByRole('button', { name: 'Undo code edits', exact: true })
    .click()
  await expect(resolver).toBeVisible()
  await expect(resolver.locator('.conflict-editor-status')).toContainText(
    'Review the changes'
  )
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver).toBeHidden()
  const after = await backup(extension)
  expect(after.preparations[0].groups[0].baseCode).toBe(
    original.preparations[0].groups[0].baseCode
  )
  expect(after.preparations[0].groups[0].spanishName).toBe('NOMBRE CONSERVADO')
  expect(after.preparations[0].groups[0].category).toBe('保留分类')
  expect(after.issuedCodes).toEqual(original.issuedCodes)
  expect(after.orders).toEqual(original.orders)
})

test('conflict popup edits remain local until applied and can return to a free previous code', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const original = await backup(extension)
  const groups = view.locator('.preparation-group')
  const first = groups.first()
  const base = original.preparations[0].groups[0].baseCode
  const other = original.preparations[0].groups[1].baseCode
  await first.getByLabel('Product code', { exact: true }).fill('CE26100109')
  await expect
    .poll(
      async () => (await backup(extension)).preparations[0].groups[0].baseCode
    )
    .toBe('CE26100109')
  const saved = await backup(extension)
  await first.getByLabel('Product code', { exact: true }).fill(other)
  await expect(
    first.getByLabel('Product code', { exact: true })
  ).toHaveAttribute('aria-invalid', 'true')
  await first
    .locator('.product-summary')
    .getByRole('button', { name: 'Resolve code', exact: true })
    .click()
  const resolver = page.getByRole('dialog', {
    name: 'Resolve code conflict',
    exact: true,
  })
  await resolver.getByLabel('Product code', { exact: true }).fill('CE26100108')
  expect((await backup(extension)).preparations).toEqual(saved.preparations)
  await resolver.getByLabel('Product code', { exact: true }).fill(other)
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver).toBeVisible()
  await expect(resolver.locator('.conflict-editor-status')).toContainText(
    /already reserved|another product/
  )
  await expect(
    resolver.getByLabel('Product code', { exact: true })
  ).toBeFocused()
  expect((await backup(extension)).preparations).toEqual(saved.preparations)
  await expect(
    resolver.getByLabel('Previously used by this product', { exact: true })
  ).toHaveCount(0)
  await resolver.getByLabel('Product code', { exact: true }).fill(base)
  await expect(
    resolver.getByLabel('Product code', { exact: true })
  ).toHaveValue(base)
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver).toBeHidden()
  const after = await backup(extension)
  expect(after.preparations[0].groups[0].baseCode).toBe(base)
  expect(after.issuedCodes.some((entry) => entry.code === 'CE26100109')).toBe(
    false
  )
  expect(after.issuedCodes.some((entry) => entry.code === base)).toBe(true)
  expect(after.orders).toEqual(original.orders)
})

test('variant conflicts can be corrected inside the resolver without changing the product base', async ({
  extension,
}) => {
  const { page, view } = await openPacking(extension)
  const original = await backup(extension)
  const group = original.preparations[0].groups[0]
  const row = view
    .locator('.preparation-group')
    .first()
    .locator('.variants tbody tr')
    .first()
  const [variant, owner] = group.variants
  await row
    .getByLabel(`Variant code ${variant.id}`, { exact: true })
    .fill(owner.variantSuffix)
  await expect(
    row.getByLabel(`Variant code ${variant.id}`, { exact: true })
  ).toHaveAttribute('aria-invalid', 'true')
  await row.getByRole('button', { name: 'Resolve code', exact: true }).click()
  const resolver = page.getByRole('dialog', {
    name: 'Resolve code conflict',
    exact: true,
  })
  await resolver
    .getByLabel('Variant code', { exact: true })
    .fill(variant.variantSuffix)
  await resolver
    .getByRole('button', { name: 'Apply corrections', exact: true })
    .click()
  await expect(resolver).toBeHidden()
  const after = await backup(extension)
  expect(after.preparations[0].groups[0]).toEqual(group)
  expect(after.issuedCodes).toEqual(original.issuedCodes)
})
