import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  assignSelectedPurchaseCodes,
  editOrderProduct,
  closeOrderProduct,
  libraryBackup,
} from './smart-workspace-helpers.mjs'

async function openSizes(extension, sizes, colors = ['透明', '透明']) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-size-supplier'
  record.snapshot.items.forEach((item, index) => {
    item.title = index < 2 ? '合成玻璃花瓶' : '合成收纳盒'
    item.productNumber = index < 2 ? 'SYNTHETIC-VASE' : 'SYNTHETIC-BOX'
    item.skuProperties = [
      { label: '颜色', value: colors[index] || '透明' },
      ...(index < 2 ? [{ label: '规格', value: sizes[index] }] : []),
    ]
    item.description = [
      item.title,
      ...item.skuProperties.map(({ label, value }) => `${label}：${value}`),
      `货号：${item.productNumber}`,
    ].join('\n')
  })
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
  await page.clock.setFixedTime(new Date('2026-10-16T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(3)
  await rows.first().focus()
  await page.keyboard.press('Control+a')
  await assignSelectedPurchaseCodes(page)
  const editor = await editOrderProduct(page, 0)
  return { page, view: editor, group: editor, record }
}
const backup = libraryBackup
const editorFor = (page) =>
  page.locator('dialog[data-action="edit-order-product"]')
async function mode(page, value, { review = false, cancel = false } = {}) {
  const editor = editorFor(page)
  await editor.locator(`[data-size-mode="${value}"]`).click()
  const modal = page.getByRole('dialog', {
    name: 'Change size handling?',
    exact: true,
  })
  if (review) {
    await expect(modal).toBeVisible()
    if (cancel)
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
    else
      await modal
        .getByRole('button', { name: 'Apply size handling', exact: true })
        .click()
  } else await expect(modal).toHaveCount(0)
  if (!cancel)
    await expect(
      editorFor(page).locator(`[data-size-mode="${value}"]`)
    ).toHaveAttribute('aria-pressed', 'true')
}

test('same-size seller styles change recognition mode without a code warning or repeated assignment', async ({
  extension,
}) => {
  const { page } = await openSizes(extension, [
      '#款式二 高33X底径10.5cm',
      '#款式一 高33X底径10.5cm',
    ]),
    result = await backup(extension),
    variants = result.preparations[0].groups[0].variants
  expect(variants.map((variant) => variant.variantSuffix)).toEqual(['A', 'B'])
  expect(variants.map((variant) => variant.sizeSuffix)).toEqual(['', ''])
  expect(variants.every((variant) => !variant.needsSizeMapping)).toBe(true)
  await expect(
    editorFor(page).getByRole('button', {
      name: 'Review size suggestions',
      exact: true,
    })
  ).toHaveCount(0)
  for (const value of ['none', 'automatic']) {
    await mode(page, value)
    const saved = await backup(extension),
      changed = saved.preparations[0].groups[0]
    expect(changed.sizeMode || 'automatic').toBe(value)
    expect(changed.variants).toEqual(variants)
    expect(saved.preparations[0].groups[1]).toEqual(
      result.preparations[0].groups[1]
    )
    expect(saved.orders).toEqual(result.orders)
    expect(saved.issuedCodes).toEqual(result.issuedCodes)
  }
})

test('unresolved size flags save quietly and recognition preference survives reopening', async ({
  extension,
}) => {
  const { page } = await openSizes(
      extension,
      ['待确认尺寸甲', '待确认尺寸乙'],
      ['金色', '银色']
    ),
    before = await backup(extension)
  expect(
    before.preparations[0].groups[0].variants.every(
      (variant) => variant.needsSizeMapping
    )
  ).toBe(true)
  await mode(page, 'none')
  const saved = await backup(extension),
    changed = saved.preparations[0].groups[0]
  expect(changed.sizeMode).toBe('none')
  expect(changed.variants.map((variant) => variant.variantSuffix)).toEqual([
    'A',
    'B',
  ])
  expect(
    changed.variants.every(
      (variant) => !variant.sizeSuffix && !variant.needsSizeMapping
    )
  ).toBe(true)
  expect(saved.preparations[0].groups[1]).toEqual(
    before.preparations[0].groups[1]
  )
  expect(saved.orders).toEqual(before.orders)
  await closeOrderProduct(editorFor(page))
  await page.reload()
  await editOrderProduct(page, 0)
  await expect(
    editorFor(page).locator('[data-size-mode="none"]')
  ).toHaveAttribute('aria-pressed', 'true')
  await mode(page, 'automatic')
  const restored = await backup(extension)
  expect(
    restored.preparations[0].groups[0].variants.every(
      (variant) => variant.needsSizeMapping
    )
  ).toBe(true)
  expect(restored.orders).toEqual(before.orders)
  await expect(
    page
      .locator('#sheet-body tr[data-selection-key]')
      .first()
      .getByRole('button', { name: 'Barcode', exact: true })
  ).toHaveCount(0)
})

test('size handling reviews only changed full barcodes and cancellation preserves saved codes and ownership', async ({
  extension,
}) => {
  const { page } = await openSizes(
    extension,
    ['10cm', '20cm'],
    ['金色', '银色']
  )
  await editorFor(page).locator('[data-authoring-field="size-ending"]').fill('')
  await editorFor(page).locator('[data-authoring-field="size-ending"]').blur()
  await expect
    .poll(
      async () =>
        (await backup(extension)).preparations[0].groups[0].variants[0]
          .sizeSuffix
    )
    .toBe('')
  const before = await backup(extension),
    original = before.preparations[0].groups[0],
    code = (variant) =>
      `${original.baseCode}${variant.variantSuffix}${variant.sizeSuffix}`
  await editorFor(page).locator('[data-size-mode="none"]').click()
  const review = page.getByRole('dialog', {
      name: 'Change size handling?',
      exact: true,
    }),
    cards = review.locator('.packing-review-item')
  await expect(cards).toHaveCount(1)
  await expect(cards.locator('.packing-value-row code')).toHaveText([
    code(original.variants[1]),
    `${original.baseCode}${original.variants[1].variantSuffix}`,
  ])
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  await mode(page, 'none', { review: true })
  const saved = await backup(extension),
    changed = saved.preparations[0].groups[0]
  expect(changed.variants[0]).toEqual(original.variants[0])
  expect(changed.variants[1]).toEqual({
    ...original.variants[1],
    sizeSuffix: '',
    needsSizeMapping: false,
  })
  expect(saved.preparations[0].groups[1]).toEqual(
    before.preparations[0].groups[1]
  )
  expect(saved.orders).toEqual(before.orders)
  expect(
    saved.issuedCodes.some(
      (issued) => issued.code === code(original.variants[1])
    )
  ).toBe(false)
  expect(
    saved.issuedCodes.some(
      (issued) =>
        issued.code ===
          `${original.baseCode}${original.variants[1].variantSuffix}` &&
        issued.variantId === original.variants[1].id
    )
  ).toBe(true)
  await editorFor(page).locator('[data-size-mode="automatic"]').click()
  await expect(cards).toHaveCount(2)
  await expect(cards.nth(0).locator('.packing-value-row code')).toHaveText([
    `${original.baseCode}${original.variants[0].variantSuffix}`,
    `${original.baseCode}${original.variants[0].variantSuffix}S`,
  ])
  await expect(cards.nth(1).locator('.packing-value-row code')).toHaveText([
    `${original.baseCode}${original.variants[1].variantSuffix}`,
    code(original.variants[1]),
  ])
  await review
    .getByRole('button', { name: 'Apply size handling', exact: true })
    .click()
  await expect
    .poll(async () =>
      (await backup(extension)).preparations[0].groups[0].variants.map(
        (variant) => variant.sizeSuffix
      )
    )
    .toEqual(['S', 'L'])
  expect((await backup(extension)).orders).toEqual(before.orders)
})

for (const surface of ['inline', 'label editor'])
  test(`manual size ending restores automatic mode from Orders ${surface}`, async ({
    extension,
  }) => {
    const { page } = await openSizes(
      extension,
      ['待确认尺寸甲', '待确认尺寸乙'],
      ['金色', '银色']
    )
    await mode(page, 'none')
    const before = await backup(extension)
    if (surface === 'inline') {
      await editorFor(page)
        .locator('[data-authoring-field="size-ending"]')
        .fill('XS')
      await closeOrderProduct(editorFor(page))
    } else {
      await closeOrderProduct(editorFor(page))
      await page
        .locator('#sheet-body tr[data-selection-key]')
        .first()
        .getByRole('button', { name: 'Barcode', exact: true })
        .click()
      const label = page.getByRole('dialog', {
          name: 'Label editor',
          exact: true,
        }),
        input = label.getByRole('textbox', { name: 'Size code', exact: true })
      await input.fill('XS')
      await input.press('Enter')
      await expect
        .poll(
          async () =>
            (await backup(extension)).preparations[0].groups[0].variants[0]
              .sizeSuffix
        )
        .toBe('XS')
      await label
        .getByRole('button', { name: 'Close label editor', exact: true })
        .click()
    }
    const after = await backup(extension),
      changed = after.preparations[0].groups[0]
    expect(changed.sizeMode).toBeUndefined()
    expect(changed.variants[0].sizeSuffix).toBe('XS')
    expect(changed.variants[0].needsSizeMapping).toBe(false)
    expect(changed.variants[1]).toEqual(
      before.preparations[0].groups[0].variants[1]
    )
    expect(after.preparations[0].groups[1]).toEqual(
      before.preparations[0].groups[1]
    )
    expect(after.orders).toEqual(before.orders)
    await page.reload()
    await editOrderProduct(page, 0)
    await expect(
      editorFor(page).locator('[data-size-mode="automatic"]')
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      editorFor(page).locator('[data-authoring-field="size-ending"]')
    ).toHaveValue('XS')
  })

test('embedded height and diameter use all axes before price and survive reopening', async ({
  extension,
}) => {
  const { page } = await openSizes(extension, [
      '#款式四高28.5X直径13cm',
      '#款式五高22X直径10.5cm',
    ]),
    before = await backup(extension)
  expect(
    before.preparations[0].groups[0].variants.map(
      (variant) => variant.sizeSuffix
    )
  ).toEqual(['L', 'S'])
  expect(
    before.preparations[0].groups[0].variants.map(
      (variant) => variant.needsSizeMapping
    )
  ).toEqual([false, false])
  await expect(
    editorFor(page).getByRole('button', {
      name: 'Review size suggestions',
      exact: true,
    })
  ).toHaveCount(0)
  await closeOrderProduct(editorFor(page))
  await page.reload()
  for (const [index, size] of ['L', 'S'].entries()) {
    const editor = await editOrderProduct(page, index)
    await expect(
      editor.locator('[data-authoring-field="size-ending"]')
    ).toHaveValue(size)
    await closeOrderProduct(editor)
  }
  expect((await backup(extension)).orders).toEqual(before.orders)
})

test('price-only size suggestions require visual confirmation with exact original photos and source money retained', async ({
  extension,
}) => {
  const { page } = await openSizes(extension, ['待确认尺寸甲', '待确认尺寸乙']),
    before = await backup(extension)
  expect(
    before.preparations[0].groups[0].variants.map(
      (variant) => variant.sizeSuffix
    )
  ).toEqual(['', ''])
  const open = editorFor(page).getByRole('button', {
      name: 'Review size suggestions',
      exact: true,
    }),
    review = page.getByRole('dialog', {
      name: 'Review size suggestions',
      exact: true,
    })
  await open.click()
  await expect(review).toContainText('Price is only a clue.')
  await expect(review).toContainText('¥12.50')
  await expect(review).toContainText('¥18.90')
  await expect(review.locator('.preparation-photo')).toHaveCount(2)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  await open.click()
  await review
    .getByRole('button', { name: 'Apply these size codes', exact: true })
    .click()
  await expect(review).toBeHidden()
  // Closing the review starts an asynchronous save; wait for its exact result.
  await expect
    .poll(async () =>
      (await backup(extension)).preparations[0].groups[0].variants.map(
        (variant) => variant.sizeSuffix
      )
    )
    .toEqual(['S', 'L'])
  await closeOrderProduct(editorFor(page))
  await page.reload()
  expect(
    (await backup(extension)).preparations[0].groups[0].variants.map(
      (variant) => variant.sizeSuffix
    )
  ).toEqual(['S', 'L'])
  expect((await backup(extension)).orders).toEqual(before.orders)
})

test('orphan historical reservations cannot block reviewed size suggestions or change the current owner', async ({
  extension,
}) => {
  const { page } = await openSizes(extension, ['待确认尺寸甲', '待确认尺寸乙'])
  await editorFor(page)
    .locator('[data-authoring-field="spanish-name"]')
    .fill('NOMBRE CONSERVADO')
  await closeOrderProduct(editorFor(page))
  const before = await backup(extension),
    preparation = before.preparations[0],
    original = preparation.groups[0],
    oldCode = `${original.baseCode}${original.variants[0].variantSuffix}S`,
    reservation = {
      accountId: preparation.accountId,
      orderId: preparation.orderId,
      sellerId: preparation.sellerId,
      month: preparation.month,
      groupId: original.id,
      variantId: original.variants[1].id,
      kind: 'barcode',
      code: oldCode,
    }
  const restored = await extension.inspector.evaluate(
    (data) =>
      chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup: data }),
    { ...before, version: 2, issuedCodes: [...before.issuedCodes, reservation] }
  )
  expect(restored.ok, restored.error).toBe(true)
  expect(
    (await backup(extension)).issuedCodes.some((code) => code.code === oldCode)
  ).toBe(false)
  await page.reload()
  await editOrderProduct(page, 0)
  await editorFor(page)
    .getByRole('button', { name: 'Review size suggestions', exact: true })
    .click()
  const review = page.getByRole('dialog', {
    name: 'Review size suggestions',
    exact: true,
  })
  await expect(review.locator('.packing-value-row')).toHaveCount(2)
  await review
    .getByRole('button', { name: 'Apply these size codes', exact: true })
    .click()
  await expect(
    page.getByRole('dialog', { name: 'Resolve code conflict', exact: true })
  ).toHaveCount(0)
  await expect
    .poll(
      async () =>
        (await backup(extension)).issuedCodes.find(
          (code) => code.code === oldCode
        )?.variantId
    )
    .toBe(original.variants[0].id)
  const after = await backup(extension),
    updated = after.preparations[0].groups[0]
  expect(updated.baseCode).toBe(original.baseCode)
  expect(updated.variants[0].spanishName).toBe('NOMBRE CONSERVADO')
  expect(updated.variants[0].id).toBe(original.variants[0].id)
  expect(updated.variants[0].variantSuffix).toBe(
    original.variants[0].variantSuffix
  )
  expect(updated.variants[1].variantSuffix).toBe(
    original.variants[1].variantSuffix
  )
  expect(after.preparations[0].groups[1]).toEqual(preparation.groups[1])
  expect(
    after.issuedCodes.find((code) => code.code === oldCode)?.variantId
  ).toBe(original.variants[0].id)
  expect(after.orders).toEqual(before.orders)
  expect(extension.unexpectedRequests).toEqual([])
})
