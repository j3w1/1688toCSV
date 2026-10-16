import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { readFile } from 'node:fs/promises'

async function openPacking(extension) {
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
  const response = await extension.inspector.evaluate(
    async (record) =>
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
  expect(response.ok, response.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(3)
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
  await expect(view.locator('.preparation-group')).toHaveCount(2)
  return { page, view, record }
}

async function backup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}

test('packing backup uses selected products and restore reopens only that scope without recoding', async ({
  extension,
}) => {
  const { page, view, record } = await openPacking(extension)
  await view
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  const save = view.getByRole('button', {
    name: 'Back up packing',
    exact: true,
    includeHidden: true,
  })
  await expect(save).toBeDisabled()
  const row = view.locator('.variants tbody tr').first()
  await row.focus()
  await row.press('Space')
  await expect(save).toBeEnabled()
  const before = await backup(extension)
  const downloaded = page.waitForEvent('download')
  await view
    .getByRole('button', { name: 'More copy formats', exact: true })
    .click()
  await save.click()
  const file = await downloaded
  expect(await file.failure()).toBeNull()
  const downloads = await extension.inspector.evaluate(() =>
    chrome.downloads.search({})
  )
  expect(downloads).toHaveLength(1)
  expect(downloads[0].state).toBe('complete')
  const content = await readFile(downloads[0].filename)
  const saved = JSON.parse(content)
  expect(saved.packingScope.mode).toBe('selection')
  expect(saved.packingScope.orders[0].entryIds).toEqual([
    record.snapshot.items[0].entryId,
  ])
  expect(saved.preparations[0].groups).toHaveLength(1)
  expect(saved.preparations[0].groups[0].variants).toHaveLength(1)
  expect(saved.orders[0].snapshot.items).toHaveLength(3)
  await view.getByLabel('Packing backup file', { exact: true }).setInputFiles({
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
  await expect(view.locator('.variants tbody tr')).toHaveCount(1)
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
  await expect(resolver).toBeHidden()
  await expect(first).not.toHaveValue(other)
  await expect(first).not.toHaveAttribute('aria-invalid', 'true')
  const after = await backup(extension)
  expect(after.orders).toEqual(before.orders)
  for (const issued of before.issuedCodes)
    expect(after.issuedCodes).toContainEqual(issued)
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
  for (const issued of before.issuedCodes)
    expect(after.issuedCodes).toContainEqual(issued)
})

test('conflicting barcode previews disappear immediately and a delayed render cannot restore them', async ({
  extension,
}) => {
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
  await expect(resolver).toBeHidden()
  for (const preview of [firstPreview, secondPreview])
    await expect(preview).toHaveAttribute('data-preview-state', 'ready')
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
