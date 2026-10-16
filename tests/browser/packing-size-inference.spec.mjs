import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

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
  await page.locator('#prepare-orders').click()
  await page
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const view = page.locator('#packing-view')
  await expect(view.locator('.preparation-group')).toHaveCount(2)
  return {
    page,
    view,
    group: view.locator('.preparation-group').first(),
    record,
  }
}

test('same-size seller styles change recognition mode without a code warning or a repeated save', async ({
  extension,
}) => {
  const { page, view, group } = await openSizes(extension, [
    '#款式二 高33X底径10.5cm',
    '#款式一 高33X底径10.5cm',
  ])
  const result = await backup(extension)
  const variants = result.preparations[0].groups[0].variants
  expect(variants.map((variant) => variant.variantSuffix)).toEqual(['A', 'B'])
  expect(variants.map((variant) => variant.sizeSuffix)).toEqual(['', ''])
  expect(variants.every((variant) => !variant.needsSizeMapping)).toBe(true)
  await expect(group.getByAltText('Barcode preview')).toHaveCount(2)
  await expect(
    group.getByRole('button', { name: 'Review size suggestions', exact: true })
  ).toHaveCount(0)
  const mode = group.getByLabel('Size handling', { exact: true })
  const review = page.getByRole('dialog', {
    name: 'Change size handling?',
    exact: true,
  })
  for (const value of ['none', 'automatic']) {
    await mode.selectOption(value)
    await expect(mode).toHaveValue(value)
    await expect(review).toHaveCount(0)
    const saved = await backup(extension)
    const changed = saved.preparations[0].groups[0]
    expect(changed.sizeMode || 'automatic').toBe(value)
    expect(changed.variants).toEqual(variants)
    expect(saved.preparations[0].groups[1]).toEqual(
      result.preparations[0].groups[1]
    )
    expect(saved.orders).toEqual(result.orders)
    await mode.dispatchEvent('change')
    await expect(view.locator('#preparation-content')).toHaveJSProperty(
      'disabled',
      false
    )
    await expect(review).toHaveCount(0)
    expect((await backup(extension)).preparations).toEqual(saved.preparations)
  }
})

test('unresolved size flags save quietly and the recognition preference survives reopening', async ({
  extension,
}) => {
  const { page, group } = await openSizes(
    extension,
    // Explicit size wording stays unresolved; generic specifications are styles.
    ['待确认尺寸甲', '待确认尺寸乙'],
    ['金色', '银色']
  )
  const before = await backup(extension)
  expect(
    before.preparations[0].groups[0].variants.every(
      (variant) => variant.needsSizeMapping
    )
  ).toBe(true)
  const mode = group.getByLabel('Size handling', { exact: true })
  await mode.selectOption('none')
  const review = page.getByRole('dialog', {
    name: 'Change size handling?',
    exact: true,
  })
  await expect(mode).toHaveValue('none')
  await expect(review).toHaveCount(0)
  const saved = await backup(extension)
  const changed = saved.preparations[0].groups[0]
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
  await expect(group.getByAltText('Barcode preview').first()).toBeVisible()
  await page.reload()
  await page.locator('#prepare-orders').click()
  await expect(mode).toHaveValue('none')
  await mode.selectOption('automatic')
  await expect(mode).toHaveValue('automatic')
  await expect(review).toHaveCount(0)
  const restored = await backup(extension)
  expect(
    restored.preparations[0].groups[0].variants.every(
      (variant) => variant.needsSizeMapping
    )
  ).toBe(true)
  await expect(group.getByAltText('Barcode preview').first()).toBeHidden()
  expect(restored.orders).toEqual(before.orders)
})

test('size mode reviews only changed barcode values and cancellation preserves the saved setup', async ({
  extension,
}) => {
  const { page, group } = await openSizes(
    extension,
    ['10cm', '20cm'],
    ['金色', '银色']
  )
  const sizes = group.locator('input[data-packing-field="size"]')
  await sizes.first().fill('')
  await expect
    .poll(
      async () =>
        (await backup(extension)).preparations[0].groups[0].variants[0]
          .sizeSuffix
    )
    .toBe('')
  const before = await backup(extension)
  const original = before.preparations[0].groups[0]
  const code = (variant) =>
    `${original.baseCode}${variant.variantSuffix}${variant.sizeSuffix}`
  const mode = group.getByLabel('Size handling', { exact: true })
  const review = page.getByRole('dialog', {
    name: 'Change size handling?',
    exact: true,
  })
  await mode.selectOption('none')
  const cards = review.locator('.packing-review-item')
  await expect(cards).toHaveCount(1)
  await expect(cards.locator('.packing-review-codes code')).toHaveText([
    code(original.variants[1]),
    `${original.baseCode}${original.variants[1].variantSuffix}`,
  ])
  await expect(cards.locator('p')).toHaveCount(0)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('#preparation-content')).toHaveJSProperty(
    'disabled',
    false
  )
  await expect(mode).toHaveValue('automatic')
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  await mode.selectOption('none')
  await review
    .getByRole('button', { name: 'Apply size handling', exact: true })
    .click()
  await expect(mode).toHaveValue('none')
  const saved = await backup(extension)
  const changed = saved.preparations[0].groups[0]
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
  for (const issued of before.issuedCodes)
    expect(saved.issuedCodes).toContainEqual(issued)

  await mode.selectOption('automatic')
  await expect(cards).toHaveCount(2)
  await expect(cards.nth(0).locator('.packing-review-codes code')).toHaveText([
    `${original.baseCode}${original.variants[0].variantSuffix}`,
    `${original.baseCode}${original.variants[0].variantSuffix}S`,
  ])
  await expect(cards.nth(1).locator('.packing-review-codes code')).toHaveText([
    `${original.baseCode}${original.variants[1].variantSuffix}`,
    code(original.variants[1]),
  ])
  await review
    .getByRole('button', { name: 'Apply size handling', exact: true })
    .click()
  await expect(mode).toHaveValue('automatic')
  await expect(sizes.nth(0)).toHaveValue('S')
  await expect(sizes.nth(1)).toHaveValue('L')
  expect((await backup(extension)).orders).toEqual(before.orders)
})

async function backup(extension) {
  const result = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(result.ok, result.error).toBe(true)
  return result.data
}

for (const surface of ['inline', 'label editor'])
  test(`a manually authored size ending restores automatic mode from the ${surface}`, async ({
    extension,
  }) => {
    const { page, view, group } = await openSizes(
      extension,
      ['待确认尺寸甲', '待确认尺寸乙'],
      ['金色', '银色']
    )
    const mode = group.getByLabel('Size handling', { exact: true })
    await mode.selectOption('none')
    const review = page.getByRole('dialog', {
      name: 'Change size handling?',
      exact: true,
    })
    await expect(mode).toHaveValue('none')
    await expect(review).toHaveCount(0)
    const before = await backup(extension)
    const size = group.locator('input[data-packing-field="size"]').first()
    if (surface === 'inline') {
      await size.fill('XS')
      await expect(mode).toHaveValue('automatic')
      await expect(review).toBeHidden()
      await expect(view.locator('.preparation-save-status')).toHaveText(
        'Saved automatically'
      )
    } else {
      await group
        .getByRole('button', { name: 'Edit barcode', exact: true })
        .first()
        .click()
      const label = page.getByRole('dialog', {
        name: 'Label editor',
        exact: true,
      })
      const input = label.getByRole('textbox', {
        name: 'Size code',
        exact: true,
      })
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
    await expect(mode).toHaveValue('automatic')
    await expect(size).toHaveValue('XS')
    const after = await backup(extension)
    const changed = after.preparations[0].groups[0]
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
    await page.locator('#prepare-orders').click()
    await expect(mode).toHaveValue('automatic')
    await expect(size).toHaveValue('XS')
  })

test('embedded height and diameter assign size endings from all axes and survive reopening', async ({
  extension,
}) => {
  const { page, group } = await openSizes(extension, [
    '#款式四高28.5X直径13cm',
    '#款式五高22X直径10.5cm',
  ])
  const sizes = group.locator('input[data-packing-field="size"]')
  // The larger product is deliberately cheaper in the fixture: measurements win.
  await expect(sizes.nth(0)).toHaveValue('L')
  await expect(sizes.nth(1)).toHaveValue('S')
  await expect(
    group.getByRole('button', { name: 'Review size suggestions', exact: true })
  ).toHaveCount(0)
  const before = await backup(extension)
  expect(
    before.preparations[0].groups[0].variants.map(
      (variant) => variant.needsSizeMapping
    )
  ).toEqual([false, false])
  await page.reload()
  await page.locator('#prepare-orders').click()
  await expect(sizes.nth(0)).toHaveValue('L')
  await expect(sizes.nth(1)).toHaveValue('S')
  expect((await backup(extension)).orders).toEqual(before.orders)
})

test('price-only suggestions require visual confirmation and preserve source data', async ({
  extension,
}) => {
  const { page, group } = await openSizes(extension, [
    '待确认尺寸甲',
    '待确认尺寸乙',
  ])
  const sizes = group.locator('input[data-packing-field="size"]')
  await expect(sizes.nth(0)).toHaveValue('')
  await expect(sizes.nth(1)).toHaveValue('')
  const before = await backup(extension)
  const review = group.getByRole('button', {
    name: 'Review size suggestions',
    exact: true,
  })
  await review.click()
  const dialog = page.getByRole('dialog', {
    name: 'Review size suggestions',
    exact: true,
  })
  await expect(dialog).toContainText('Price is only a clue.')
  await expect(dialog).toContainText('¥12.50')
  await expect(dialog).toContainText('¥18.90')
  await expect(dialog.locator('.preparation-photo')).toHaveCount(2)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await backup(extension)).preparations).toEqual(before.preparations)
  await review.click()
  await dialog
    .getByRole('button', { name: 'Apply these size codes', exact: true })
    .click()
  await expect(dialog).toBeHidden()
  await expect(sizes.nth(0)).toHaveValue('S')
  await expect(sizes.nth(1)).toHaveValue('L')
  await page.reload()
  await page.locator('#prepare-orders').click()
  await expect(sizes.nth(0)).toHaveValue('S')
  await expect(sizes.nth(1)).toHaveValue('L')
  expect((await backup(extension)).orders).toEqual(before.orders)
})

test('a reserved size suggestion recovers the reviewed variant without recoding its group', async ({
  extension,
}) => {
  const { page, view, group } = await openSizes(extension, [
    '待确认尺寸甲',
    '待确认尺寸乙',
  ])
  await group
    .getByLabel('Spanish short name', { exact: true })
    .fill('NOMBRE CONSERVADO')
  await expect(view.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  const before = await backup(extension)
  const preparation = before.preparations[0]
  const original = preparation.groups[0]
  const blockedCode = `${original.baseCode}${original.variants[0].variantSuffix}S`
  const reservation = {
    accountId: preparation.accountId,
    orderId: preparation.orderId,
    sellerId: preparation.sellerId,
    month: preparation.month,
    groupId: original.id,
    variantId: original.variants[1].id,
    kind: 'barcode',
    code: blockedCode,
  }
  // A prior barcode remains owned after its variant is edited or regrouped.
  const restored = await extension.inspector.evaluate(
    (data) =>
      chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup: data }),
    { ...before, issuedCodes: [...before.issuedCodes, reservation] }
  )
  expect(restored.ok, restored.error).toBe(true)
  const reserved = await backup(extension)
  const review = page.getByRole('dialog', {
    name: 'Review size suggestions',
    exact: true,
  })
  const conflict = page.getByRole('dialog', {
    name: 'Resolve code conflict',
    exact: true,
  })
  async function applySuggestions() {
    await group
      .getByRole('button', { name: 'Review size suggestions', exact: true })
      .click()
    await review
      .getByRole('button', { name: 'Apply these size codes', exact: true })
      .click()
    await expect(conflict).toBeVisible()
    await expect(conflict).toContainText(blockedCode)
    await expect(
      conflict.getByRole('button', {
        name: 'Use next available variant code',
        exact: true,
      })
    ).toBeVisible()
    await expect(
      conflict.getByRole('button', {
        name: 'Use next available code',
        exact: true,
      })
    ).toHaveCount(0)
  }
  await applySuggestions()
  const failed = await backup(extension)
  expect(failed.preparations).toEqual(reserved.preparations)
  expect(failed.issuedCodes).toEqual(reserved.issuedCodes)
  await conflict
    .getByRole('button', { name: 'Continue editing', exact: true })
    .click()
  const sizes = group.locator('input[data-packing-field="size"]')
  await expect(sizes.nth(0)).toHaveValue('')
  await expect(sizes.nth(1)).toHaveValue('')
  await applySuggestions()
  await conflict
    .getByRole('button', {
      name: 'Use next available variant code',
      exact: true,
    })
    .click()
  await expect(conflict).toBeHidden()
  await expect(sizes.nth(0)).toHaveValue('S')
  await expect(sizes.nth(1)).toHaveValue('L')
  const after = await backup(extension)
  const updated = after.preparations[0].groups[0]
  expect(updated.baseCode).toBe(original.baseCode)
  expect(updated.spanishName).toBe('NOMBRE CONSERVADO')
  expect(updated.variants[0].id).toBe(original.variants[0].id)
  expect(updated.variants[0].variantSuffix).not.toBe(
    original.variants[0].variantSuffix
  )
  expect(updated.variants[1].variantSuffix).toBe(
    original.variants[1].variantSuffix
  )
  expect(after.preparations[0].groups[1]).toEqual(preparation.groups[1])
  for (const issued of reserved.issuedCodes)
    expect(after.issuedCodes).toContainEqual(issued)
  expect(after.orders).toEqual(before.orders)
  expect(extension.unexpectedRequests).toEqual([])
})
