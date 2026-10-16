import {
  copyCurrentImageBatch,
  revealCopyActions,
  revealGroupingActions,
  clickGroupingAction,
} from './copy-actions-helpers.mjs'
import { test, expect, holdPreparationWrites } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { readFile } from 'node:fs/promises'

async function newWorkspacePage(extension) {
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  return page
}

async function seedStructuredOrder(
  extension,
  orderId,
  { singleProduct = false, manyPhotos = false, tags = [] } = {}
) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const record = records[0]
  if (orderId) {
    record.snapshot.orderId = orderId
    record.snapshot.sourceUrl = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`
  }
  record.snapshot.sellerName = 'Synthetic preparation supplier'
  record.snapshot.sellerMemberLogin = 'synthetic-packing-shop'
  record.snapshot.sellerShopOrigin = 'https://synthetic-packing-shop.1688.com'
  record.tags = tags
  if (singleProduct) record.snapshot.items = record.snapshot.items.slice(0, 1)
  else if (manyPhotos) {
    const originals = records.flatMap((entry) => entry.snapshot.items)
    const gallery = [...originals.slice(1), originals[0]]
    record.snapshot.items = [
      {
        ...structuredClone(gallery[0]),
        entryId: `${orderId}90`,
        thumbnail: '',
      },
      gallery[0],
      { ...structuredClone(gallery[0]), entryId: `${orderId}91` },
      ...gallery.slice(1),
    ]
  }
  if (singleProduct || manyPhotos) {
    const gross = record.snapshot.items.reduce(
      (sum, item) =>
        sum + Math.round(Number(item.price) * 100) * Number(item.quantity),
      0
    )
    const discount = record.snapshot.items.reduce(
      (sum, item) => sum + Math.round(Number(item.sourceDiscount) * 100),
      0
    )
    record.snapshot.totals = {
      goodsGross: (gross / 100).toFixed(2),
      shipping: '0.00',
      sourceDiscount: (discount / 100).toFixed(2),
      orderAdjustment: '0.00',
      goodsNet: ((gross - discount) / 100).toFixed(2),
      payable: ((gross - discount) / 100).toFixed(2),
    }
  }
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = index < 2 ? '合成玻璃罐' : '合成收纳盒'
    item.productNumber = index < 2 ? 'TEST-JAR' : 'TEST-BOX'
    item.skuProperties = [
      {
        label: '颜色',
        value: index < 2 ? '透明' : '灰色',
        raw: index < 2 ? '颜色：透明' : '颜色：灰色',
      },
      ...(index < 2
        ? [
            {
              label: '尺寸',
              value: index === 0 ? '300ml' : '500ml',
              raw: index === 0 ? '尺寸：300ml' : '尺寸：500ml',
            },
          ]
        : []),
    ]
    item.description = [
      item.title,
      ...item.skuProperties.map((property) => property.raw),
      `货号：${item.productNumber}`,
    ].join('\n')
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
  return record
}

async function openWorkspace(extension, { previews = true } = {}) {
  const record = await seedStructuredOrder(extension)
  const page = await newWorkspacePage(extension)
  if (!previews)
    await page.addInitScript(() => {
      // Isolate batch-output assertions from automatic photos and label previews.
      // The real preview observer is exercised by the media test below.
      const observe = IntersectionObserver.prototype.observe
      IntersectionObserver.prototype.observe = function (target) {
        // Tiles register before they are attached to the packing view.
        if (!target.matches('.preparation-photo, .preparation-label-preview'))
          observe.call(this, target)
      }
    })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await expect(
    page.getByRole('checkbox', {
      name: 'Headers',
      exact: true,
      includeHidden: true,
    })
  ).not.toBeChecked()
  return { page, record }
}

async function waitForAutosave(dialog) {
  await expect(dialog.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
}

test('Casa Elida codes stay readable and order names summarize distinct saved products in English and Spanish', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  const view = await prepare(page)
  const groups = view.locator('.preparation-group')
  const firstName = 'FRASCOS DE VIDRIO PARA ALMACENAMIENTO'
  await groups
    .nth(0)
    .getByLabel('Spanish short name', { exact: true })
    .fill(firstName)
  await groups
    .nth(1)
    .getByLabel('Spanish short name', { exact: true })
    .fill('CAJAS')
  await waitForAutosave(view)
  const codes = view.locator(
    '.group-code-editor, .variant-code-base, .variant-code-band input'
  )
  for (const node of await codes.all()) {
    await expect(node).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect(node).toHaveCSS(
      'font-family',
      'Arial, "Microsoft YaHei", sans-serif'
    )
    await expect(node).toHaveCSS('font-size', '20px')
    expect(
      Number(
        await node.evaluate((element) => getComputedStyle(element).fontWeight)
      )
    ).toBeGreaterThanOrEqual(700)
  }
  const design = groups.first().locator('.variant-code-design').first()
  const emptySuffix = design.locator('input[data-packing-field="variant"]')
  await expect(emptySuffix).toHaveValue('')
  await expect(
    design.locator('.variant-code-band input[data-packing-field="variant"]')
  ).toHaveCount(0)
  await emptySuffix.fill('A')
  await expect(emptySuffix).toBeFocused()
  await expect(
    design.locator('.variant-code-band input[data-packing-field="variant"]')
  ).toHaveValue('A')
  await emptySuffix.fill('')
  await expect(emptySuffix).toBeFocused()
  await expect(
    design.locator('.variant-code-band input[data-packing-field="variant"]')
  ).toHaveCount(0)
  await waitForAutosave(view)
  await view.getByRole('button', { name: 'Orders', exact: true }).click()
  const summary = page.locator('.order-card .order-name-summary')
  await expect(summary.locator('.order-name-label')).toHaveText(firstName)
  // The first name is shared by two variants, but counts as one product name.
  await expect(summary.locator('.order-name-count')).toHaveText('+1')
  await summary.hover()
  await expect(page.getByRole('tooltip')).toContainText(`${firstName} · CAJAS`)
  await page.mouse.move(0, 0)
  await page.keyboard.press('Tab')
  await summary.focus()
  await expect(page.getByRole('tooltip')).toContainText(`${firstName} · CAJAS`)
  for (const mode of ['dark', 'light']) {
    if (
      (await page
        .locator('meta[name="color-scheme"]')
        .getAttribute('content')) !== mode
    )
      await page.locator('#theme-toggle').click()
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
      'content',
      mode
    )
    const code = page.locator('.row-code-copy').first()
    await expect(code).toHaveCSS(
      'font-family',
      'Arial, "Microsoft YaHei", sans-serif'
    )
    await expect(code).toHaveCSS('font-size', '12px')
    await expect(code).toHaveCSS('padding-left', '4.2px')
    await expect(code).toHaveCSS('padding-top', '3.6px')
    await expect(code).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    await code.hover()
    await expect(code).toHaveCSS('color', 'rgb(255, 255, 255)')
  }
  await page.locator('[data-language="es"]').click()
  await expect(summary.locator('.order-name-label')).toHaveText(firstName)
  await page.locator('[data-language="zh"]').click()
  await expect(summary).toHaveCount(0)
  await page.locator('[data-language="en"]').click()
  await page.setViewportSize({ width: 760, height: 900 })
  await expect(summary.locator('.order-name-count')).toBeVisible()
  const bounds = await summary.evaluate((element) => {
    const parent = element.closest('.order-card').getBoundingClientRect()
    const own = element.getBoundingClientRect()
    return { right: own.right, parentRight: parent.right }
  })
  expect(bounds.right).toBeLessThanOrEqual(bounds.parentRight)
})

async function selectVariantRow(row, key = 'Space') {
  await row.focus()
  await row.press(key)
}

for (const unresolvedSizes of [false, true])
  test(`main product code returns to its own reservation through autosave and reopened carton editors${unresolvedSizes ? ' with unresolved sizes' : ''}`, async ({
    extension,
  }) => {
    const { page, record } = await openWorkspace(extension)
    if (unresolvedSizes) {
      record.snapshot.observedAt = '2026-10-16T12:00:00.000Z'
      record.lastCheckedAt = record.snapshot.observedAt
      record.changedAt = record.snapshot.observedAt
      for (const [index, item] of record.snapshot.items.slice(0, 2).entries()) {
        const size = index ? '15*10CM' : '10*20CM'
        item.skuProperties = [
          { label: '颜色', value: '透明', raw: '颜色：透明' },
          { label: '尺寸', value: size, raw: `尺寸：${size}` },
        ]
        item.description = [
          item.title,
          ...item.skuProperties.map((property) => property.raw),
          `货号：${item.productNumber}`,
        ].join('\n')
      }
      const restored = await extension.inspector.evaluate(
        (order) =>
          chrome.runtime.sendMessage({
            type: 'BACKUP_RESTORE',
            backup: {
              format: '1688-order-library',
              version: 1,
              exportedAt: new Date().toISOString(),
              orders: [order],
              history: [],
              images: [],
            },
          }),
        record
      )
      expect(restored.ok, restored.error).toBe(true)
      await page.reload()
    }
    const view = await prepare(page)
    const group = view.locator('.preparation-group').first()
    const field = group.getByLabel('Product code', { exact: true })
    const original = await packingBackup(extension)
    const originalGroup = original.preparations[0].groups[0]
    const base = originalGroup.baseCode
    expect(
      originalGroup.variants.every(
        (variant) => variant.needsSizeMapping === unresolvedSizes
      )
    ).toBe(true)
    const currentGroup = async () =>
      (await packingBackup(extension)).preparations[0].groups[0]
    for (const code of ['CE26100107', base]) {
      await field.fill(code)
      await field.press('Tab')
      await expect.poll(async () => (await currentGroup()).baseCode).toBe(code)
      await waitForAutosave(view)
      await expect(group.locator('.code-field-error:visible')).toHaveCount(0)
    }
    expect(await currentGroup()).toEqual(originalGroup)

    // Return to the original main code while the previous real save is pending.
    await holdPreparationWrites(page)
    await field.fill('CE26100108')
    await expect
      .poll(() => page.evaluate(() => window.preparationSaveStarted))
      .toBe(true)
    try {
      await field.fill(base)
    } finally {
      await page.evaluate(() => {
        window.holdPreparationSave = false
      })
    }
    await expect.poll(async () => (await currentGroup()).baseCode).toBe(base)
    await waitForAutosave(view)
    expect(await currentGroup()).toEqual(originalGroup)

    const label = page.getByRole('dialog', {
      name: 'Label editor',
      exact: true,
    })
    const codeField = label.getByRole('textbox', {
      name: 'Base CE code',
      exact: true,
    })
    // Closing/reopening tests that the editor uses the latest saved revision.
    for (const code of ['CE26100109', base]) {
      await group
        .getByRole('button', { name: 'Edit carton mark', exact: true })
        .click()
      await expect(label).toBeVisible()
      await codeField.fill(code)
      await codeField.press('Enter')
      await expect.poll(async () => (await currentGroup()).baseCode).toBe(code)
      await expect(
        label.getByRole('button', { name: 'Copy label', exact: true })
      ).toBeEnabled({ timeout: 20_000 })
      await label
        .getByRole('button', { name: 'Close label editor', exact: true })
        .click()
      await expect(label).toBeHidden()
      await expect(field).toHaveValue(code)
    }
    await page.reload()
    await page
      .getByRole('button', { name: 'Prepare packing list', exact: true })
      .click()
    await expect(view).toBeVisible()
    await expect(field).toHaveValue(base)
    await waitForAutosave(view)
    expect(await currentGroup()).toEqual(originalGroup)
    const after = await packingBackup(extension)
    expect(after.orders[0].snapshot).toEqual(record.snapshot)
    await expect(
      page.getByRole('dialog', { name: 'Resolve code conflict', exact: true })
    ).toHaveCount(0)
    expect(extension.unexpectedRequests).toEqual([])
  })

test('product codes lead group headers; nested hints, hit targets and code baselines stay independent', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  const dialog = await prepare(page),
    group = dialog.locator('.preparation-group').first()
  const title = group.locator('h3'),
    code = title.getByLabel('Product code', { exact: true }),
    select = title.locator('.group-select')
  await expect(code).toHaveValue(/^CE2610\d{4}$/)
  await expect(group.getByLabel('Product code', { exact: true })).toHaveCount(1)
  await expect(select).toHaveRole('button')
  await expect(select).toHaveText('')
  await expect(select).toHaveAccessibleName('Select group 1: 合成玻璃罐')
  const check = await select.boundingBox()
  expect(check.width).toBeGreaterThanOrEqual(24)
  expect(check.width).toBeLessThanOrEqual(32)
  expect(check.height).toBeGreaterThanOrEqual(24)
  expect(check.height).toBeLessThanOrEqual(36)
  await select.focus()
  await page.keyboard.press('Tab')
  await expect(code).toBeFocused()
  await expect(page.getByRole('tooltip')).toHaveText(
    'Product code shared by all variants. Printed on its carton mark.'
  )
  await dialog.locator('h1').click()
  await page.mouse.move(0, 0)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await expect(select).toHaveAttribute('aria-pressed', 'false')
  await select.click()
  await expect(group).toHaveClass(/is-selected/)
  await select.click()
  await expect(group).not.toHaveClass(/is-selected/)
  // The clear corner of the header is a selection target, independent of its
  // code editor and drag grip. A second click removes the selection.
  await title.click({ position: { x: 2, y: 2 } })
  await expect(group).toHaveClass(/is-selected/)
  await title.click({ position: { x: 2, y: 2 } })
  await expect(group).not.toHaveClass(/is-selected/)
  await group
    .getByRole('group', { name: 'Group actions', exact: true })
    .getByRole('button', { name: /^Move group 1;/ })
    .click()
  await expect(select).toHaveAttribute('aria-pressed', 'false')
  await code.click()
  await expect(select).toHaveAttribute('aria-pressed', 'false')
  const parts = group.locator('.variant-code-design').first()
  // Cap-trimmed text and native input line boxes have different heights.
  // Their centers and glyph styling must match inside the shared code design.
  const boxes = await parts
    .locator('.variant-code-base, input')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return {
          center: rect.top + rect.height / 2,
          typography: [style.fontFamily, style.fontSize, style.fontWeight],
        }
      })
    )
  expect(
    Math.max(...boxes.map((box) => box.center)) -
      Math.min(...boxes.map((box) => box.center))
  ).toBeLessThanOrEqual(1)
  for (const box of boxes) expect(box.typography).toEqual(boxes[0].typography)
})

test('packing order choices show seller, Spanish names and photos while retaining full IDs for navigation', async ({
  extension,
}) => {
  const first = await seedStructuredOrder(extension, '1234567890123456789')
  const second = await seedStructuredOrder(extension, '2234567890123456789')
  // Fulfil these two synthetic navigation targets locally: no live site requests.
  await extension.context.route('https://air.1688.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>Synthetic selected order</title>',
    })
  )
  const page = await newWorkspacePage(extension)
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    6
  )
  const dialog = await prepare(page, { groupCount: 4 }),
    select = dialog.getByLabel('Show packing orders', { exact: true })
  const preparations = (await packingBackup(extension)).preparations
  const richPicker = await page.evaluate(() =>
    CSS.supports('appearance', 'base-select')
  )
  const allOrders = select.locator('option[value=""]')
  await expect(allOrders).toContainText('6 products · 4 groups')
  if (richPicker) {
    await expect(
      allOrders.locator('.packing-order-photos img')
    ).not.toHaveCount(0)
    await expect(select.locator('selectedcontent')).toContainText(
      '6 products · 4 groups'
    )
    const bounds = await select.boundingBox()
    expect(bounds.width).toBeLessThanOrEqual(680)
    expect(bounds.height).toBeLessThanOrEqual(90)
  }
  for (const record of [first, second]) {
    const option = select.locator(`option[value="${record.snapshot.orderId}"]`)
    await expect(option).toContainText(record.snapshot.sellerName)
    await expect(option).not.toContainText(record.snapshot.orderId)
    await expect(option).toContainText('3 products · 2 groups')
    for (const group of preparations.find(
      (prep) => prep.orderId === record.snapshot.orderId
    ).groups)
      await expect(option).toContainText(group.spanishName)
    if (richPicker) {
      const expectedPhotos = new Set(
        record.snapshot.items.map((item) => item.thumbnail).filter(Boolean)
      ).size
      await expect(option.locator('.packing-order-photos img')).toHaveCount(
        Math.min(6, expectedPhotos)
      )
      await expect(option.locator('button')).toHaveCount(0)
    }
  }
  const open = dialog.getByRole('button', {
    name: 'Open selected order',
    exact: true,
  })
  await expect(open).toBeDisabled()
  await select.selectOption(first.snapshot.orderId)
  await expect(select).toHaveValue(first.snapshot.orderId)
  if (richPicker)
    await expect(select.locator('selectedcontent')).toContainText(
      '3 products · 2 groups'
    )
  if (richPicker)
    await expect
      .poll(() =>
        select
          .locator('selectedcontent img')
          .evaluateAll((images) =>
            images.every((image) => image.naturalWidth > 0)
          )
      )
      .toBe(true)
  const opened = extension.context.waitForEvent('page')
  await open.dblclick()
  const target = await opened
  await expect(target).toHaveURL(first.snapshot.sourceUrl)
  await page.bringToFront()
  await select.selectOption(second.snapshot.orderId)
  await open.click()
  await expect(target).toHaveURL(second.snapshot.sourceUrl)
  expect(
    extension.context
      .pages()
      .filter((entry) => entry.url().startsWith('https://air.1688.com/'))
  ).toHaveLength(1)
  await select.selectOption('')
  await expect(open).toBeDisabled()
  await page.locator('#language-toggle [data-language=es]').click()
  const spanishSelect = dialog.getByLabel('Mostrar pedidos del empaque', {
    exact: true,
  })
  await expect(spanishSelect.locator('option[value=""]')).toContainText(
    '6 productos · 4 grupos'
  )
  await page.setViewportSize({ width: 680, height: 800 })
  const narrow = await spanishSelect.boundingBox()
  expect(narrow.x).toBeGreaterThanOrEqual(0)
  expect(narrow.x + narrow.width).toBeLessThanOrEqual(680)
})

test('packing order selector aligns single and multiple photos with colored metadata in every language', async ({
  extension,
}) => {
  const single = await seedStructuredOrder(extension, '1234567890123456789', {
    singleProduct: true,
    tags: ['Fragile'],
  })
  const multiple = await seedStructuredOrder(extension, '2234567890123456789', {
    manyPhotos: true,
  })
  const seeded = await packingBackup(extension)
  seeded.packingPreferences = {
    value: {
      ...seeded.packingPreferences?.value,
      orderTags: [
        {
          name: 'Fragile',
          colors: { light: '#f4dbc1', dark: '#47351f' },
        },
      ],
      appearance: {
        ...seeded.packingPreferences?.value.appearance,
        labelColors: {
          dates: { light: '#e8c7a3', dark: '#e8c7a3' },
          'awaiting-shipment': { light: '#e5d2ba', dark: '#e5d2ba' },
        },
      },
    },
    updatedAt: new Date().toISOString(),
  }
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    seeded
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await newWorkspacePage(extension)
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    11
  )
  await page.getByLabel('Packing month', { exact: true }).fill('2026-10')
  await selectAllProducts(page)
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  const view = await acceptPreparationPreview(page)
  await expect(view.locator('.preparation-group')).toHaveCount(3)
  await waitForAutosave(view)
  const orders = view.locator('.packing-order-section')
  await expect(orders).toHaveCount(2)
  await expect(orders.first()).toHaveCSS('border-top-width', '0px')
  await expect(orders.nth(1)).toHaveCSS('border-top-width', '1px')
  const select = view.locator('select[name="packing-order"]')
  await expect(select).toHaveAccessibleName('Show packing orders')
  const singleOption = select.locator(
    `option[value="${single.snapshot.orderId}"]`
  )
  const multipleOption = select.locator(
    `option[value="${multiple.snapshot.orderId}"]`
  )
  await expect(singleOption).toContainText('1 product · 1 group')
  await expect(multipleOption).toContainText('10 products · 2 groups')
  const richPicker = await page.evaluate(() =>
    CSS.supports('appearance', 'base-select')
  )
  if (richPicker) {
    await expect(singleOption.locator('.packing-order-photos img')).toHaveCount(
      1
    )
    await expect(
      multipleOption.locator('.packing-order-photos img')
    ).toHaveCount(6)
    const photoPixels = async (container) => {
      const images = container.locator('.packing-order-photos img')
      await expect
        .poll(() =>
          images.evaluateAll(
            (nodes) =>
              nodes.length > 0 &&
              nodes.every((image) => image.complete && image.naturalWidth > 0)
          )
        )
        .toBe(true)
      return images.evaluateAll((nodes) =>
        nodes.map((image) => {
          const canvas = document.createElement('canvas')
          canvas.width = image.naturalWidth
          canvas.height = image.naturalHeight
          canvas.getContext('2d').drawImage(image, 0, 0)
          return canvas.toDataURL()
        })
      )
    }
    const singlePixels = await photoPixels(singleOption)
    const multiplePixels = await photoPixels(multipleOption)
    // The fixture starts with a missing photo and a duplicate, and contains
    // eight distinct pictures. All six displayed tiles must be real and unique.
    expect(new Set(multiplePixels).size).toBe(6)
    const allPixels = await photoPixels(select.locator('option[value=""]'))
    expect(allPixels).toHaveLength(6)
    expect(allPixels.slice(0, 2)).toEqual(
      expect.arrayContaining([singlePixels[0], multiplePixels[0]])
    )
    for (const option of [singleOption, multipleOption]) {
      await expect(option.locator('.purchase-date')).toHaveAttribute(
        'data-ui-label',
        'dates'
      )
      await expect(option.locator('.order-status')).toHaveAttribute(
        'data-ui-label',
        'awaiting-shipment'
      )
      await expect(option.locator('.purchase-date')).toHaveCSS(
        'background-color',
        'rgb(232, 199, 163)'
      )
      await expect(option.locator('.order-status')).toHaveCSS(
        'background-color',
        'rgb(229, 210, 186)'
      )
    }
    const tag = singleOption.locator('.order-tag-badge')
    await expect(tag).toHaveText('Fragile')
    await expect(tag).toHaveCSS('--tag-light', '#f4dbc1')
    await expect(tag).toHaveCSS('--tag-dark', '#47351f')
    const assertAlignedPhotos = async () => {
      await select.click()
      const geometry = await select.locator('option').evaluateAll((options) =>
        options.map((option) => {
          const photos = option.querySelector('.packing-order-photos')
          const area = photos.getBoundingClientRect()
          const image = photos
            .querySelector('.preparation-photo')
            .getBoundingClientRect()
          return {
            width: area.width,
            height: area.height,
            captionX: option
              .querySelector('.packing-order-caption')
              .getBoundingClientRect().x,
            count: photos.children.length,
            centerOffset:
              (image.left + image.right - area.left - area.right) / 2,
            verticalOffset:
              (image.top + image.bottom - area.top - area.bottom) / 2,
            tiles: [...photos.children].map((tile) => {
              const bounds = tile.getBoundingClientRect()
              return {
                width: bounds.width,
                height: bounds.height,
                x: bounds.x - area.x,
                y: bounds.y - area.y,
              }
            }),
          }
        })
      )
      expect(
        geometry.every((entry) => entry.width === 116 && entry.height === 76)
      ).toBe(true)
      expect(
        Math.max(...geometry.map((entry) => entry.captionX)) -
          Math.min(...geometry.map((entry) => entry.captionX))
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(geometry.find((entry) => entry.count === 1).centerOffset)
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(geometry.find((entry) => entry.count === 1).verticalOffset)
      ).toBeLessThanOrEqual(1)
      for (const mosaic of geometry.filter((entry) => entry.count === 6)) {
        expect(
          mosaic.tiles.every((tile) => tile.width === 36 && tile.height === 36)
        ).toBe(true)
        expect(mosaic.tiles.map(({ x }) => x)).toEqual([0, 40, 80, 0, 40, 80])
        expect(mosaic.tiles.map(({ y }) => y)).toEqual([0, 0, 0, 40, 40, 40])
      }
      await page.keyboard.press('Escape')
      await expect(view).toBeVisible()
    }
    await assertAlignedPhotos()
    await select.selectOption(single.snapshot.orderId)
    const selected = select.locator('selectedcontent')
    await expect(selected.locator('.purchase-date')).toBeVisible()
    await expect(selected.locator('.order-status')).toBeVisible()
    await expect(selected.locator('.order-tag-badge')).toBeVisible()
    await expect(selected.locator('.order-tag-badge')).toHaveCSS(
      '--tag-dark',
      '#47351f'
    )
    await page.setViewportSize({ width: 390, height: 800 })
    await assertAlignedPhotos()
    await select.selectOption(multiple.snapshot.orderId)
    await expect(selected.locator('.packing-order-photos img')).toHaveCount(6)
    expect(await photoPixels(selected)).toEqual(multiplePixels)
    expect(
      await selected.evaluate(
        (node) => node.scrollWidth <= node.clientWidth + 1
      )
    ).toBe(true)
    const bounds = await select.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
  }
  await page.locator('#language-toggle [data-language=es]').click()
  await expect(singleOption).toContainText('1 producto · 1 grupo')
  await page.locator('#language-toggle [data-language=zh]').click()
  await expect(singleOption).toContainText('1 件商品 · 1 组')
  if (richPicker) {
    await expect(singleOption.locator('.order-status')).toHaveText('待发货')
    await expect(singleOption.locator('.order-tag-badge')).toHaveText('Fragile')
  }
})

test('row Prepare reviews only that product and copies its latest saved values without a copy warning', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension, { previews: false })
  await seedStructuredOrder(extension, '2234567890123456789')
  await page.reload()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    6
  )
  await page
    .locator('#sheet-body tr[data-selection-key]')
    .first()
    .getByRole('button', { name: 'Prepare', exact: true })
    .click()
  const review = page.getByRole('dialog', {
    name: 'Assign product codes?',
    exact: true,
  })
  await expect(review).toBeVisible()
  await expect(review.locator('.packing-review-item')).toHaveCount(1)
  await expect(review).toContainText('1 selected product rows from 1 orders')
  const dialog = await acceptPreparationPreview(page)
  await waitForAutosave(dialog)
  await expect(
    dialog.getByLabel('Show packing orders', { exact: true }).locator('option')
  ).toHaveCount(2)
  const rows = dialog
    .locator('.preparation-group')
    .first()
    .locator('.variants tbody tr')
  await expect(rows).toHaveCount(1)
  await expect(dialog.locator('.preparation-copy-scope')).toHaveText(
    '1 selected products · 1 orders'
  )
  await observeLabelOutput(page, extension)
  await revealCopyActions(page)
  await dialog
    .getByRole('button', { name: 'Copy barcode images', exact: true })
    .click()
  const images = page.getByRole('dialog', {
    name: 'Prepare label images',
    exact: true,
  })
  await expect(images.locator('.copy-preview img')).toHaveCount(1)
  await expect(
    images.getByRole('button', { name: 'Copy current batch', exact: true })
  ).toBeEnabled()
  await expect(
    page.getByRole('dialog', { name: 'Confirm operation', exact: true })
  ).not.toBeVisible()
  await images.getByRole('button', { name: 'Done', exact: true }).click()
  expect((await page.evaluate(() => window.labelOutputProbe)).writes).toBe(0)
  expect((await packingBackup(extension)).preparations).toHaveLength(1)
  await rows
    .first()
    .getByLabel('Product variant', { exact: true })
    .fill('Edited selected variant')
  await dialog
    .getByRole('button', { name: 'Copy Excel image', exact: true })
    .click()
  await copyCurrentImageBatch(page)
  await expect(
    dialog.getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('dialog', { name: 'Confirm operation', exact: true })
  ).not.toBeVisible()
  const saved = await packingBackup(extension)
  expect(saved.preparations).toHaveLength(1)
  expect(saved.preparations[0].groups[0].variants[0].variant).toBe(
    'Edited selected variant'
  )
  expect(
    saved.preparations[0].groups.flatMap((group) =>
      group.variants.flatMap((variant) => variant.entryIds)
    )
  ).toHaveLength(1)
  expect((await page.evaluate(() => window.labelOutputProbe)).writes).toBe(1)
})

async function pauseAutosave(page) {
  const now = new Date()
  // Installation starts a running clock. Leave headroom before the pause target
  // so time spent between these two protocol calls cannot put it in the past.
  await page.clock.install({ time: new Date(now.getTime() - 60_000) })
  await page.clock.pauseAt(now)
}

async function acceptPreparationPreview(page) {
  const view = page.locator('#packing-view')
  const review = page.getByRole('dialog', {
    name: /^(Assign product codes\?|Move selected products to this packing month\?)$/,
  })
  await expect
    .poll(async () => (await view.isVisible()) || (await review.isVisible()))
    .toBe(true)
  if (await review.isVisible())
    await review
      .getByRole('button', {
        name: /^(Assign codes|Change codes) and prepare$/,
      })
      .click()
  await expect(view).toBeVisible()
  await expect(page.locator('#orders-view')).toBeHidden()
  return view
}

async function selectAllProducts(page) {
  await page.locator('#sheet-body tr[data-selection-key]').first().focus()
  await page.keyboard.press('Control+a')
}

async function prepare(
  page,
  { groupCount = 2, clearSelection = true, selectRows = true } = {}
) {
  await page.getByLabel('Packing month', { exact: true }).fill('2026-10')
  if (selectRows) await selectAllProducts(page)
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  const dialog = await acceptPreparationPreview(page)
  await expect(dialog.locator('.preparation-group')).toHaveCount(groupCount)
  await expect(
    dialog.locator('.preparation-group').first().locator('.variants tbody tr')
  ).toHaveCount(2)
  await waitForAutosave(dialog)
  if (clearSelection)
    await dialog
      .getByRole('button', { name: 'Clear selection', exact: true })
      .click()
  await expect(
    dialog
      .locator('.preparation-group')
      .first()
      .getByLabel('Product code', { exact: true })
  ).toHaveValue(/^CE2610\d{4}$/)
  return dialog
}

test('one sticky selection toolbar batches grouping safely across orders and stays reachable on narrow screens', async ({
  extension,
}) => {
  const originals = [
    await seedStructuredOrder(extension, '1234567890123456789'),
    await seedStructuredOrder(extension, '2234567890123456789'),
  ]
  const page = await newWorkspacePage(extension)
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const view = await prepare(page, { groupCount: 4 })
  const toolbar = view.getByRole('group', {
    name: 'Selection tools',
    exact: true,
  })
  await expect(toolbar).toHaveCount(1)
  await expect(view.locator('.group-tools')).toHaveCount(0)
  await expect(
    toolbar.getByRole('button', { name: 'Grouping tools', exact: true })
  ).toBeDisabled()
  await expect(
    toolbar.getByRole('button', { name: 'Copy Excel image', exact: true })
  ).toBeDisabled()
  await toolbar.getByRole('button', { name: 'Select all', exact: true }).click()
  const panel = await revealGroupingActions(page)
  const merge = panel.getByRole('button', {
    name: 'Merge products',
    exact: true,
  })
  await expect(merge).toBeDisabled()
  await merge.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(merge).toBeFocused()
  await expect(page.getByRole('tooltip')).toContainText('one order at a time')
  await clickGroupingAction(page, 'Share one barcode')
  const review = page.getByRole('dialog', {
    name: 'Share one barcode?',
    exact: true,
  })
  await expect(review).toContainText(
    'Different groups and orders remain separate'
  )
  await expect(view.locator('#preparation-content')).toHaveJSProperty(
    'disabled',
    true
  )
  await review
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  // Grouping is an explicit transaction; an earlier autosave status can still
  // say "Saved automatically" until it finishes. The operation lock covers
  // persistence and the rebuilt selection, so wait for that completion.
  await expect(view.locator('#preparation-content')).toHaveJSProperty(
    'disabled',
    false
  )
  let saved = await packingBackup(extension)
  expect(saved.preparations).toHaveLength(2)
  for (const prep of saved.preparations) {
    expect(prep.groups).toHaveLength(2)
    expect(prep.groups[0].variants).toHaveLength(1)
    expect(prep.groups[0].variants[0].entryIds).toHaveLength(2)
  }
  await clickGroupingAction(page, 'Give rows separate barcodes')
  await expect(view.locator('#preparation-content')).toHaveJSProperty(
    'disabled',
    true
  )
  await page
    .locator('.packing-review')
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(view.locator('#preparation-content')).toHaveJSProperty(
    'disabled',
    false
  )
  saved = await packingBackup(extension)
  for (const prep of saved.preparations)
    expect(prep.groups[0].variants).toHaveLength(2)
  for (const record of originals)
    expect(
      saved.orders.find(
        (entry) => entry.snapshot.orderId === record.snapshot.orderId
      ).snapshot
    ).toEqual(record.snapshot)
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 720 })
    const last = view.locator('.preparation-group').last()
    await last.evaluate((node) => node.scrollIntoView({ block: 'end' }))
    await expect(toolbar).toBeInViewport({ ratio: 1 })
    const bounds = await toolbar.boundingBox()
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeLessThanOrEqual(10)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    const field = last.getByLabel('Spanish short name', { exact: true })
    await field.evaluate((node) => node.scrollIntoView({ block: 'center' }))
    await field.focus()
    const fieldBox = await field.boundingBox()
    const toolbarBox = await toolbar.boundingBox()
    expect(fieldBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height)
    const mark = last.locator('.carton-preview')
    expect((await mark.boundingBox()).width).toBeLessThanOrEqual(100)
    await expect(mark.locator('strong')).toHaveCount(0)
  }
  expect(extension.unexpectedRequests).toEqual([])
})

test('structured products prepare, preserve edits and copy exact headerless source and preparation rows', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  await selectAllProducts(page)
  await page.getByLabel('Packing month', { exact: true }).fill('')
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  await expect(page.locator('.error-notice-message')).toContainText(
    'Choose a packing month'
  )
  const dialog = await prepare(page)
  const group = dialog.locator('.preparation-group').first()
  const baseCode = await group
    .getByLabel('Product code', { exact: true })
    .inputValue()
  const otherCode = await dialog
    .locator('.preparation-group')
    .nth(1)
    .getByLabel('Product code', { exact: true })
    .inputValue()
  expect(otherCode).not.toBe(baseCode)
  await group
    .getByLabel('Spanish short name', { exact: true })
    .fill('frasco transparente')
  await group.getByLabel('Chinese category', { exact: true }).fill('玻璃制品')
  const variant = group.locator('.variants tbody tr').first()
  await expect(variant.locator('.variant-code-options')).toBeVisible()
  await variant.getByRole('textbox', { name: /^Variant code / }).fill('b')
  await variant.getByRole('textbox', { name: /^Size code / }).fill('xs')
  await waitForAutosave(dialog)
  await expect(
    group.getByLabel('Spanish short name', { exact: true })
  ).toHaveValue(/frasco transparente/i)
  await expect(
    group.getByLabel('Chinese category', { exact: true })
  ).toHaveValue('玻璃制品')
  await expect(variant.locator('.variant-code-options')).toBeVisible()
  await expect(
    variant.getByRole('textbox', { name: /^Variant code / })
  ).toHaveValue(/b/i)
  await expect(
    variant.getByRole('textbox', { name: /^Size code / })
  ).toHaveValue(/xs/i)
  await dialog.getByRole('button', { name: 'Orders', exact: true }).click()
  await expect(page.locator('.row-code-copy')).toHaveText([
    baseCode,
    baseCode,
    otherCode,
  ])

  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await revealCopyActions(page)
  await page.getByRole('button', { name: 'Copy values', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Confirm operation', exact: true })
  ).not.toBeVisible()
  await expect(page.locator('#copy-values')).toHaveText('Copied')
  const values = await page.evaluate(() => navigator.clipboard.readText())
  const valueRows = values.split('\r\n').map((row) => row.split('\t'))
  expect(valueRows).toHaveLength(3)
  for (const [index, row] of valueRows.entries()) {
    expect(row).toHaveLength(5)
    expect(row[0]).toBe('')
    expect(row[1]).toContain(record.snapshot.items[index].title)
    expect(row.slice(2)).toEqual(
      ['price', 'quantity', 'discount'].map(
        (key) => record.snapshot.items[index][key]
      )
    )
  }
  expect(values).not.toContain('Photo')

  await revealCopyActions(page)
  await page
    .getByRole('button', { name: 'Copy preparation columns', exact: true })
    .click()
  const columns = page.getByRole('dialog', {
    name: 'Copy preparation columns',
    exact: true,
  })
  await columns
    .getByRole('button', { name: 'Copy chosen columns', exact: true })
    .click()
  await expect(
    columns.getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible()
  const prepared = (await page.evaluate(() => navigator.clipboard.readText()))
    .split('\r\n')
    .map((row) => row.split('\t'))
  expect(prepared).toHaveLength(3)
  expect(prepared.every((row) => row.length === 7)).toBe(true)
  expect(prepared.map((row) => row[0])).toEqual([baseCode, '', otherCode])
  expect(prepared[0][1]).toBe(`${baseCode}BXS`)
  expect(prepared[0][3]).toBe('FRASCO TRANSPARENTE')
  await columns.getByRole('button', { name: 'Close', exact: true }).click()

  await page.reload()
  await expect(page.locator('.row-code-copy')).toHaveText([
    baseCode,
    baseCode,
    otherCode,
  ])
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  await expect(
    group.getByLabel('Spanish short name', { exact: true })
  ).toHaveValue('FRASCO TRANSPARENTE')
  await expect(
    group.getByLabel('Chinese category', { exact: true })
  ).toHaveValue('玻璃制品')
  await expect(variant.locator('.variant-code-options')).toBeVisible()
  await expect(
    variant.getByRole('textbox', { name: /^Variant code / })
  ).toHaveValue('B')
  await expect(
    variant.getByRole('textbox', { name: /^Size code / })
  ).toHaveValue('XS')
  const library = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'LIBRARY_QUERY' })
  )
  expect(library.ok, library.error).toBe(true)
  expect(library.data.orders[0].snapshot).toEqual(record.snapshot)
  expect(extension.unexpectedRequests).toEqual([])
})

test('Excel image requires the selected carton category in both views and preserves the clipboard', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension, { previews: false })
  const view = await prepare(page)
  const group = view.locator('.preparation-group').first()
  const code = await group
    .getByLabel('Product code', { exact: true })
    .inputValue()
  await group.getByLabel('Chinese category', { exact: true }).fill('')
  await waitForAutosave(view)
  await group.locator('.group-select').click()
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.evaluate(() =>
    navigator.clipboard.writeText('keep-unfinished-category')
  )
  await view
    .getByRole('button', { name: 'Copy Excel image', exact: true })
    .click()
  const images = page.locator('.image-copy-dialog')
  await expect(images.getByRole('alert')).toContainText(
    `(${code}) needs a Chinese category`
  )
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'keep-unfinished-category'
  )
  await images.getByRole('button', { name: 'Done', exact: true }).click()
  await view.getByRole('button', { name: 'Orders', exact: true }).click()
  await page.locator('#copy-excel-image').click()
  await expect(images.getByRole('alert')).toContainText(
    `(${code}) needs a Chinese category`
  )
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'keep-unfinished-category'
  )
  expect(extension.unexpectedRequests).toEqual([])
})

test('Copy Excel image freezes selected rows with current-language headings, supplier fields and prepared values', async ({
  extension,
}, testInfo) => {
  const { page, record } = await openWorkspace(extension, { previews: false })
  const dialog = await prepare(page)
  const group = dialog.locator('.preparation-group').first()
  const base = await group
    .getByLabel('Product code', { exact: true })
    .inputValue()
  await group
    .getByLabel('Spanish short name', { exact: true })
    .fill('FRASCO DE PRUEBA')
  await group.getByLabel('Chinese category', { exact: true }).fill('玻璃制品')
  await waitForAutosave(dialog)
  await dialog.getByRole('button', { name: 'Orders', exact: true }).click()
  const original = await packingBackup(extension)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await rows.nth(0).locator('.product-title').click()
  await rows
    .nth(1)
    .locator('.product-title')
    .click({ modifiers: ['Shift'] })
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.evaluate(async () => {
    await navigator.clipboard.writeText('clipboard-before-image')
    globalThis.tableImageDrawing = { text: [], runs: [], images: 0 }
    const fillText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (this.canvas.width > 2000) {
        globalThis.tableImageDrawing.text.push(String(text))
        globalThis.tableImageDrawing.runs.push({
          text: String(text),
          x: args[0],
          y: args[1],
          font: this.font,
        })
      }
      return fillText.call(this, text, ...args)
    }
    const drawImage = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.width > 2000) globalThis.tableImageDrawing.images++
      return drawImage.apply(this, args)
    }
    // Keep the actual canvas encoder pending while the visible filter changes.
    // The eventual PNG still passes through the real encoder and clipboard.
    const encode = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      if (this.width > 2000)
        window.finishTableImage = () => encode.apply(this, args)
      else return encode.apply(this, args)
    }
  })
  const copy = page.locator('#copy-excel-image')
  await copy.click()
  const confirmation = page.getByRole('dialog', {
    name: 'Confirm operation',
    exact: true,
  })
  await expect(confirmation).not.toBeVisible()
  await expect
    .poll(() => page.evaluate(() => Boolean(window.finishTableImage)))
    .toBe(true)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'clipboard-before-image'
  )
  // A later filter update must not change the frozen selected rows.
  await page.evaluate(() => {
    const search = document.getElementById('search')
    search.value = 'TEST-BOX'
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.evaluate(() => window.finishTableImage())
  await copyCurrentImageBatch(page)
  await expect(copy).toHaveText('Copied')
  await expect(copy).toHaveClass(/copied/)
  await expect(page.locator('#feedback')).toBeEmpty()
  const drawing = await page.evaluate(() => tableImageDrawing)
  const headings = drawing.text.slice(0, drawing.text.indexOf('1')).join(' ')
  expect(headings).toBe(
    'No. Photo Product description Carton mark Barcode code Category & material Unit price (CNY) Quantity Carton dimensions Weight (kg) Carton no.'
  )
  // Only the barcode column draws text for the base. The merged carton image
  // already contains its code and has no redundant text caption underneath.
  expect(drawing.text.filter((value) => value === base)).toHaveLength(2)
  for (const suffix of ['S', 'L']) {
    const suffixRun = drawing.runs.find((run) => run.text === suffix)
    expect(suffixRun.font).toMatch(/^(?:700|bold) /)
    expect(
      drawing.runs.some(
        (run) =>
          run.text === base && run.y === suffixRun.y && run.x < suffixRun.x
      )
    ).toBe(true)
  }
  expect(drawing.text).not.toContain('西班牙语品名')
  expect(drawing.text).not.toContain('优惠（元）')
  expect(drawing.text).not.toContain('FRASCO DE PRUEBA')
  expect(drawing.text).toContain('玻璃制品')
  expect(drawing.text.join('')).toContain('300 ml')
  expect(drawing.text.join('')).toContain('500 ml')
  expect(
    drawing.runs.some(
      (run) => run.text === 'Glass' && /^(?:700|bold) /.test(run.font)
    )
  ).toBe(true)
  expect(drawing.text.join('')).not.toContain('TEST-BOX')
  for (const item of record.snapshot.items.slice(0, 2)) {
    expect(drawing.text).toContain(`¥ ${item.price}`)
    expect(drawing.text).toContain(item.quantity)
    expect(drawing.runs.find((run) => run.text === item.quantity).font).toMatch(
      /^(?:700|bold) /
    )
  }
  // Two product photos plus one actual carton mark shared by both variants.
  expect(drawing.images).toBe(3)
  const image = await page.evaluate(async () => {
    const clipboard = await navigator.clipboard.read()
    const blob = await clipboard[0].getType('image/png')
    const bitmap = await createImageBitmap(blob)
    const dimensions = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return {
      ...dimensions,
      bytes: [...new Uint8Array(await blob.arrayBuffer())],
    }
  })
  expect(image.width).toBeGreaterThan(1500)
  expect(image.height).toBeGreaterThan(200)
  expect(image.width * image.height).toBeLessThanOrEqual(16_000_000)
  await testInfo.attach(
    'Selected rows with English headings and supplier fields',
    {
      body: Buffer.from(image.bytes),
      contentType: 'image/png',
    }
  )
  expect((await packingBackup(extension)).preparations).toEqual(
    original.preparations
  )
  expect(extension.unexpectedRequests).toEqual([])
})

test('packing month defaults to the local current month, independently of persistent purchase filters', async ({
  extension,
}) => {
  await seedStructuredOrder(extension)
  const page = await extension.context.newPage()
  const browser = await extension.context.newCDPSession(page)
  await browser.send('Emulation.setTimezoneOverride', {
    timezoneId: 'Asia/Shanghai',
  })
  await page.clock.setFixedTime(new Date('2026-12-31T16:30:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const month = page.getByLabel('Packing month', { exact: true })
  await expect(month).toHaveValue('2027-01')
  await expect(page.locator('#month-filter-label')).toHaveText('January 2027')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    0
  )
  await page.locator('#month-filter-label').click()
  await page.locator('#month-options [data-month="2027-01"]').click()
  await page.locator('#month-options [data-month="2026-10"]').click()
  await page.locator('#month-filter-label').click()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await selectAllProducts(page)
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  const view = await acceptPreparationPreview(page)
  await waitForAutosave(view)
  await expect(view.locator('.packing-title')).toContainText('January 2027')
  await expect(
    view
      .locator('.preparation-group')
      .first()
      .getByLabel('Product code', { exact: true })
  ).toHaveValue(/^CE2701\d{4}$/)
  const saved = await packingBackup(extension)
  await view.getByRole('button', { name: 'Orders', exact: true }).click()

  await month.fill('2027-02')
  await page
    .getByLabel('Search products and orders', { exact: true })
    .fill('TEST-JAR')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    2
  )
  await expect(month).toHaveValue('2027-02')
  await page.getByLabel('Search products and orders', { exact: true }).fill('')
  await expect(
    page.getByRole('button', { name: 'Clear selection', exact: true })
  ).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Prepare packing list', exact: true })
  ).toBeDisabled()
  expect((await packingBackup(extension)).preparations).toEqual(
    saved.preparations
  )

  await page.reload()
  await expect(month).toHaveValue('2027-01')
  await expect(page.locator('#month-filter-label')).toHaveText('October 2026')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await expect(page.locator('#packing-scope')).toContainText(
    'Reopen 3 products already in January 2027'
  )
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  await expect(view).toBeVisible()
  await expect(view.locator('.packing-title')).toContainText('January 2027')
  await expect(
    view
      .locator('.preparation-group')
      .first()
      .getByLabel('Product code', { exact: true })
  ).toHaveValue(saved.preparations[0].groups[0].baseCode)
  await browser.detach()
})

async function copiedLabel(page, dialog) {
  await dialog.getByRole('button', { name: 'Copy label', exact: true }).click()
  await expect(dialog.locator('.label-editor-status')).toHaveText('Copied')
  return page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0]
    const png = await item.getType('image/png')
    const bitmap = await createImageBitmap(png)
    const html = new DOMParser().parseFromString(
      await (await item.getType('text/html')).text(),
      'text/html'
    )
    const embedded = html.querySelector('img')
    const result = {
      types: item.types,
      bytes: png.size,
      width: bitmap.width,
      height: bitmap.height,
      imageCount: html.querySelectorAll('img').length,
      imageSource: embedded?.getAttribute('src').startsWith('data:image/png;'),
      printWidth: embedded?.style.width,
      printHeight: embedded?.style.height,
    }
    bitmap.close()
    return result
  })
}

test('preparation shows product photos, zooms originals and opens saved labels from visible previews', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  await page.evaluate(() => {
    window.revokedPreparationImages = []
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (url) => {
      window.revokedPreparationImages.push(url)
      revoke(url)
    }
  })
  const dialog = await prepare(page)
  const group = dialog.locator('.preparation-group').first()
  const photoButton = group.getByRole('button', {
    name: `Zoom product photo ${record.snapshot.items[0].entryId}`,
    exact: true,
  })
  await photoButton.scrollIntoViewIfNeeded()
  await expect(photoButton.getByAltText('Product photo')).toBeVisible()
  const thumbnail = await photoButton.locator('img').getAttribute('src')
  expect(thumbnail).toMatch(/^blob:/)
  const copyPhoto = photoButton.locator('..').locator('.photo-copy-button')
  const pointerSession = await extension.context.newCDPSession(page)
  for (const touch of [false, true]) {
    await pointerSession.send('Emulation.setTouchEmulationEnabled', {
      enabled: touch,
    })
    const box = await copyPhoto.boundingBox()
    expect(box.width).toBe(24)
    expect(box.height).toBe(24)
    await expect(copyPhoto.locator('.ui-icon')).toHaveCSS('inline-size', '13px')
  }
  await pointerSession.send('Emulation.setTouchEmulationEnabled', {
    enabled: false,
  })
  await pointerSession.detach()
  const selectionBefore = await dialog
    .locator('.variants tbody tr')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-selected')))
  await page.mouse.move(0, 0)
  await expect(copyPhoto).toHaveCSS('opacity', '0')
  await photoButton.hover()
  await expect(copyPhoto).toHaveCSS('opacity', '0.94')
  await photoButton.press('Tab')
  await expect(copyPhoto).toBeFocused()
  await page.mouse.move(0, 0)
  await expect(copyPhoto).toHaveCSS('opacity', '0.94')
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await copyPhoto.click()
  await expect(copyPhoto).toHaveAccessibleName('Copy image: Copied')
  expect(
    await dialog
      .locator('.variants tbody tr')
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('aria-selected'))
      )
  ).toEqual(selectionBefore)
  await expect(
    page.getByRole('dialog', { name: 'Original product details', exact: true })
  ).not.toBeVisible()
  await expect(
    page.getByRole('dialog', { name: 'Product photo', exact: true })
  ).not.toBeVisible()
  expect(
    await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read()
      const image = await createImageBitmap(await item.getType('image/png'))
      const size = [image.width, image.height]
      image.close()
      return size
    })
  ).toEqual([96, 96])
  await photoButton.click()
  const photo = page.getByRole('dialog', { name: 'Product photo', exact: true })
  const original = photo.locator('.photo-viewport img')
  await expect(original).toHaveAttribute(
    'src',
    record.snapshot.items[0].thumbnail
  )
  await expect(original).toHaveJSProperty('naturalWidth', 96)
  await expect(photo.locator('.photo-zoom-actions')).toContainText('100%')
  await expect(
    photo.getByRole('button', { name: 'Zoom out', exact: true })
  ).toBeDisabled()
  const originalWidth = await original.evaluate(
    (image) => image.getBoundingClientRect().width
  )
  await photo.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(photo.locator('.photo-zoom-actions')).toContainText('150%')
  expect(
    await original.evaluate((image) => image.getBoundingClientRect().width)
  ).toBeCloseTo(originalWidth * 1.5)
  await photo.getByRole('button', { name: 'Fit', exact: true }).click()
  await expect(photo.locator('.photo-zoom-actions')).toContainText('100%')
  await page.keyboard.press('Escape')
  await expect(photo).not.toBeVisible()
  await expect(dialog).toBeVisible()

  await photoButton.click()
  await expect(photo).toBeVisible()
  const box = await photo.boundingBox()
  await page.mouse.click(Math.max(2, box.x - 5), Math.max(2, box.y + 10))
  await expect(photo).not.toBeVisible()
  await expect(dialog).toBeVisible()
  const code = group.getByLabel('Product code', { exact: true })
  await expect(code).toHaveValue(/^CE2610\d{4}$/)
  const baseCode = await code.inputValue()

  const barcode = group
    .locator('.variants tbody tr')
    .first()
    .getByRole('button', { name: 'Edit barcode', exact: true })
  const mark = group.getByRole('button', {
    name: 'Edit carton mark',
    exact: true,
  })
  for (const [button, alt] of [
    [mark, 'Carton mark preview'],
    [barcode, 'Barcode preview'],
  ]) {
    await button.scrollIntoViewIfNeeded()
    const image = button.getByAltText(alt)
    await expect(image).toBeVisible({ timeout: 20_000 })
    await expect
      .poll(() => image.evaluate((item) => item.naturalWidth))
      .toBeGreaterThan(0)
    expect(
      await image.evaluate((item) => item.naturalWidth)
    ).toBeLessThanOrEqual(360)
  }
  // A category edit changes only that group's mark, not unrelated label images.
  await page.setViewportSize({ width: 1280, height: 1800 })
  await dialog.evaluate((node) => {
    node.scrollTop = 0
  })
  const markImage = mark.getByAltText('Carton mark preview')
  const barcodeImage = barcode.getByAltText('Barcode preview')
  const otherMark = dialog
    .locator('.preparation-group')
    .nth(1)
    .getByAltText('Carton mark preview')
  for (const image of [markImage, barcodeImage, otherMark])
    await expect(image).toBeVisible()
  const [oldMark, oldBarcode, oldOther] = await Promise.all(
    [markImage, barcodeImage, otherMark].map((image) =>
      image.getAttribute('src')
    )
  )
  const categoryField = group.getByLabel('Chinese category', { exact: true })
  await categoryField.fill('玻璃制品')
  await expect(markImage).toBeVisible()
  await expect(markImage).not.toHaveAttribute('src', oldMark)
  await expect(barcodeImage).toHaveAttribute('src', oldBarcode)
  await expect(otherMark).toHaveAttribute('src', oldOther)
  await categoryField.fill('玻璃')
  await barcode.click()
  const label = page.getByRole('dialog', { name: 'Label editor', exact: true })
  async function closeEditor() {
    // The native close event is queued. Wait for its preparation rebuild before
    // resolving a preview to scroll; scrolling does not retry a detached target.
    const previous = await mark.elementHandle()
    try {
      await label
        .getByRole('button', { name: 'Close label editor', exact: true })
        .click()
      await expect
        .poll(() => previous.evaluate((node) => node.isConnected))
        .toBe(false)
    } finally {
      await previous.dispose()
    }
  }
  await expect(label.getByLabel('Barcode code', { exact: true })).toHaveText(
    `${baseCode}S`
  )
  await expect(
    label.getByRole('button', { name: 'Copy label', exact: true })
  ).toBeEnabled({ timeout: 20_000 })
  await closeEditor()
  await mark.click()
  await expect(label.getByLabel('Base CE code', { exact: true })).toHaveValue(
    baseCode
  )
  await expect(
    label.getByLabel('Chinese category', { exact: true })
  ).toHaveValue('玻璃')
  await closeEditor()
  await mark.scrollIntoViewIfNeeded()
  await expect(mark.getByAltText('Carton mark preview')).toBeVisible({
    timeout: 20_000,
  })
  const liveUrls = await dialog
    .locator('img[src^="blob:"]')
    .evaluateAll((images) => images.map((image) => image.src))
  expect(liveUrls.length).toBeGreaterThan(0)
  await dialog.getByRole('button', { name: 'Orders', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(
        (urls) =>
          urls.every((url) => window.revokedPreparationImages.includes(url)),
        liveUrls
      )
    )
    .toBe(true)
  expect(
    await page.evaluate(
      (url) => window.revokedPreparationImages.includes(url),
      thumbnail
    )
  ).toBe(true)
  expect(extension.unexpectedRequests).toEqual([])
})

test('preparation keeps categories and codes visible with one contextual grouping menu', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  const dialog = await prepare(page)
  const original = await packingBackup(extension)
  const groups = dialog.locator('.preparation-group')
  const first = groups.first()
  const variant = first.locator('.variants tbody tr').first()
  // Preview completion changes row height. Finish that layout work before
  // positioning the pointer over a grouping action for its delayed hover hint.
  await expect(first.getByAltText('Carton mark preview')).toBeVisible({
    timeout: 20_000,
  })
  await expect(first.getByAltText('Barcode preview')).toHaveCount(2, {
    timeout: 20_000,
  })
  for (const preview of await first.getByAltText('Barcode preview').all())
    await expect(preview).toBeVisible()
  await expect(dialog.locator('details, summary')).toHaveCount(0)
  for (const section of [
    dialog.locator('.order-tools'),
    dialog.locator('.packing-selection-toolbar'),
    first.locator('.original-product-name'),
  ])
    await expect(section).toBeVisible()
  await expect(first.locator('.original-product-name')).toContainText(
    '合成玻璃罐'
  )
  await expect(
    first.getByLabel('Chinese category', { exact: true })
  ).toBeVisible()
  await expect(
    dialog.getByLabel('Chinese category for order', { exact: true })
  ).toBeVisible()
  await expect(dialog.locator('.group-tools')).toHaveCount(0)
  await first.locator('.group-select').click()
  await revealGroupingActions(page)
  await expect(
    dialog.getByRole('button', { name: 'Merge products', exact: true })
  ).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Share one barcode', exact: true })
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog.getByRole('button', { name: /^Help:/ })).toHaveCount(0)
  await expect(
    variant.getByLabel('Size on order', { exact: true })
  ).toHaveCount(0)
  await expect(variant.locator('.source-size')).toHaveText('Order size: 300ml')
  await expect(
    variant.getByLabel('Product variant', { exact: true })
  ).toHaveValue('颜色: 透明')
  await expect(variant.locator('.variant-code-options')).toBeVisible()
  await expect(
    variant.getByRole('group', { name: 'Code options' })
  ).toBeVisible()
  await expect(variant.locator('.variant-code-options summary')).toHaveCount(0)
  await expect(
    variant.getByRole('textbox', { name: /^Size code / })
  ).toHaveValue('S')
  const codeHelp = variant.getByRole('textbox', { name: /^Size code / })
  const variantCode = variant.getByRole('textbox', { name: /^Variant code / })
  // The filled size is in the code band; its empty variant field follows it.
  await expect(variantCode).toHaveValue('')
  await variantCode.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(codeHelp).toBeFocused()
  const codePanel = page.getByRole('tooltip')
  await expect(codePanel).toBeVisible()
  await expect(codePanel).toHaveText(
    'Identifies the size: S, M, L. Leave blank when not needed.'
  )
  await page.keyboard.press('Tab')
  await expect(variantCode).toBeFocused()
  await dialog.locator('h1').click()
  await page.mouse.move(0, 0)
  await expect(codePanel).not.toBeVisible()
  await expect(dialog).toBeVisible()

  await revealGroupingActions(page)
  const splitHelp = dialog.getByRole('button', {
    name: 'Give rows separate barcodes',
    exact: true,
  })
  await splitHelp.hover()
  const splitPanel = page.getByRole('tooltip')
  await expect(splitHelp).toHaveAttribute('aria-disabled', 'true')
  await expect(splitPanel).toContainText('multiple source rows')
  await expect(splitPanel.getByRole('button')).toHaveCount(0)
  await page.mouse.move(0, 0)
  await expect(splitPanel).not.toBeVisible()
  await page.keyboard.press('Escape')
  await expect(first.locator('.variants tbody tr')).toHaveCount(2)

  await pauseAutosave(page)
  await dialog
    .getByLabel('Chinese category for order', { exact: true })
    .fill('陶瓷')
  await dialog
    .getByRole('button', { name: 'Apply to order', exact: true })
    .click()
  await expect(
    groups.nth(0).getByLabel('Chinese category', { exact: true })
  ).toHaveValue('陶瓷')
  await expect(
    groups.nth(1).getByLabel('Chinese category', { exact: true })
  ).toHaveValue('陶瓷')
  await expect(dialog.locator('.order-tools')).toBeVisible()
  await dialog.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(
    groups.nth(0).getByLabel('Chinese category', { exact: true })
  ).toHaveValue(original.preparations[0].groups[0].category)
  await expect(
    groups.nth(1).getByLabel('Chinese category', { exact: true })
  ).toHaveValue(original.preparations[0].groups[1].category)
  const backup = await packingBackup(extension)
  expect(backup.preparations).toEqual(original.preparations)
  expect(backup.issuedCodes).toEqual(original.issuedCodes)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
  ).toBe(true)
  expect(
    await first
      .getByLabel('Spanish short name', { exact: true })
      .evaluate((node) => node.getBoundingClientRect().width)
  ).toBeGreaterThanOrEqual(120)
  expect(
    await first
      .getByLabel('Spanish short name', { exact: true })
      .evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
  ).toBe(true)
  expect(extension.unexpectedRequests).toEqual([])
})

test('compact preparation fits two product groups without hiding fields or clipping narrow layouts', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  await page.setViewportSize({ width: 1280, height: 960 })
  const dialog = await prepare(page)
  const groups = dialog.locator('.preparation-group')
  const first = groups.first()
  // Wait for real raster readiness, as in the media test; autosave is independent
  // of Windows' asynchronous canvas encoding and the bounded preview queue.
  await expect(first.getByAltText('Carton mark preview')).toBeVisible({
    timeout: 20_000,
  })
  await expect(first.getByAltText('Barcode preview').first()).toBeVisible({
    timeout: 20_000,
  })
  await dialog.evaluate((node) => {
    node.scrollTop = 0
  })
  const bounds = await dialog.boundingBox()
  const orderBounds = await dialog
    .locator('.packing-order-section')
    .first()
    .boundingBox()
  const firstBounds = await first.boundingBox()
  const lastBounds = await groups.last().boundingBox()
  // Full-page navigation sits above the order. Its own identity and tools must
  // still leave a compact lead-in to the product groups.
  expect(firstBounds.y - orderBounds.y).toBeLessThanOrEqual(140)
  expect(lastBounds.height).toBeLessThanOrEqual(330)
  expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(
    bounds.y + bounds.height
  )
  const summary = await first.locator('.product-summary').boundingBox()
  const mark = await first.locator('.carton-preview').boundingBox()
  expect(summary.x + summary.width).toBeLessThanOrEqual(mark.x)
  expect(Math.abs(summary.y - mark.y)).toBeLessThanOrEqual(2)
  for (const group of await groups.all()) {
    await expect(
      group.getByLabel('Chinese category', { exact: true })
    ).toBeVisible()
    await expect(group.locator('.original-product-name')).toBeVisible()
    await expect(group.locator('.group-tools')).toHaveCount(0)
    await expect(
      group.getByText('Single variant', { exact: true })
    ).toHaveCount(0)
    const note = group.getByLabel('Product variant', { exact: true }).first()
    await expect(note).toBeVisible()
    // The table heading names this column once; each field retains its accessible name.
    expect(
      (await group.locator('.variant-note > span').first().boundingBox()).width
    ).toBeLessThanOrEqual(1)
  }
  for (const width of [1024, 700, 390]) {
    await page.setViewportSize({ width, height: 960 })
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    ).toBe(true)
    const fields = first.locator('.group-fields')
    expect(
      await fields.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    ).toBe(true)
    await expect(
      first.getByRole('group', { name: 'Code options' }).first()
    ).toBeVisible()
  }
  expect(extension.unexpectedRequests).toEqual([])
})

test('an unfinished barcode uses a compact, fully readable message without clipping', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  const dialog = await prepare(page)
  const group = dialog.locator('.preparation-group').first()
  await group.getByLabel('Spanish short name', { exact: true }).fill('')
  const preview = group
    .getByRole('button', { name: 'Edit barcode', exact: true })
    .first()
  await preview.scrollIntoViewIfNeeded()
  await expect(preview.locator('.label-placeholder')).toBeVisible()
  await expect(preview).toHaveAttribute(
    'title',
    'Name this product to preview its barcode'
  )
  await expect(preview.locator('img')).toBeHidden()
  const state = await preview.evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    readable:
      node.scrollWidth <= node.clientWidth + 1 &&
      node.scrollHeight <= node.clientHeight + 1,
  }))
  expect(state.height).toBeLessThanOrEqual(100)
  expect(state.readable).toBe(true)
  await expect(dialog.locator('details')).toHaveCount(0)
})

test('preparation selects groups and variant rows by range without changing edits or intercepting controls', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  const dialog = await prepare(page)
  const original = await packingBackup(extension)
  const groups = dialog.locator('.preparation-group')
  const first = groups.first()
  const rows = first.locator('.variants tbody tr')
  const secondRow = groups.nth(1).locator('.variants tbody tr')
  await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(0)
  await expect(first.getByRole('grid')).toHaveAttribute(
    'aria-multiselectable',
    'true'
  )

  await groups.nth(0).locator('.group-select').click()
  await groups
    .nth(1)
    .locator('.group-select')
    .click({ modifiers: ['Shift'] })
  await expect(
    groups.locator('.group-select[aria-pressed="true"]')
  ).toHaveCount(2)
  await selectVariantRow(rows.nth(0))
  await selectVariantRow(rows.nth(1), 'Shift+Space')
  await expect(
    first.locator('.variants tbody tr[aria-selected="true"]')
  ).toHaveCount(2)

  // A row selection replaces its own whole-group selection, without clearing
  // selected rows in another group.
  await selectVariantRow(secondRow)
  await expect(secondRow).toHaveAttribute('aria-selected', 'true')
  await expect(
    first.locator('.variants tbody tr[aria-selected="true"]')
  ).toHaveCount(2)
  await expect(
    groups.locator('.group-select[aria-pressed="true"]')
  ).toHaveCount(0)
  await expect(first).not.toHaveClass(/is-selected/)
  await expect(groups.nth(1)).not.toHaveClass(/is-selected/)
  await selectVariantRow(rows.nth(1), 'Control+Space')
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'false')
  for (const theme of ['light', 'dark']) {
    await page.locator('meta[name="color-scheme"]').evaluate((node, value) => {
      node.content = value
    }, theme)
    const selectedFill = await rows
      .nth(0)
      .evaluate((node) => getComputedStyle(node).backgroundColor)
    const siblingFill = await rows
      .nth(1)
      .evaluate((node) => getComputedStyle(node).backgroundColor)
    const groupFill = await first.evaluate(
      (node) => getComputedStyle(node).backgroundColor
    )
    expect(selectedFill).not.toBe(siblingFill)
    expect(selectedFill).not.toBe(groupFill)
    expect(
      await rows
        .nth(0)
        .locator('.variant-note-row')
        .evaluate((node) => getComputedStyle(node, '::before').display)
    ).toBe('block')
    expect(
      await rows
        .nth(1)
        .locator('.variant-note-row')
        .evaluate((node) => getComputedStyle(node, '::before').display)
    ).toBe('none')
    await expect(rows.nth(0)).toHaveCSS('box-shadow', 'none')
    await expect(first).toHaveCSS('box-shadow', 'none')
  }

  // Inputs, drag grips, photos and preview buttons never select their row/card.
  await rows
    .nth(1)
    .getByRole('button', { name: /^Move product 2;/ })
    .click()
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'false')
  await rows.nth(1).getByLabel('Product variant', { exact: true }).click()
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'false')
  await rows.nth(1).locator('.preparation-photo').first().click()
  const viewer = page.getByRole('dialog', {
    name: 'Product photo',
    exact: true,
  })
  await expect(viewer).toBeVisible()
  await viewer
    .getByRole('button', { name: 'Close product photo', exact: true })
    .click()
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'false')
  await rows
    .nth(1)
    .getByRole('button', { name: 'Edit barcode', exact: true })
    .click()
  const label = page.getByRole('dialog', { name: 'Label editor', exact: true })
  await expect(label).toBeVisible()
  const groupBeforeLabelClose = await first.elementHandle()
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  // The queued dialog close event rebuilds the form. Wait for that rebuild
  // before checking selection or sending keys to rows that it will replace.
  await page.waitForFunction(
    (group) => !group.isConnected,
    groupBeforeLabelClose
  )
  await groupBeforeLabelClose.dispose()
  // Returning from the editor keeps its selection.
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'false')
  await expect(secondRow).toHaveAttribute('aria-selected', 'true')
  await expect(
    groups.locator('.group-select[aria-pressed="true"]')
  ).toHaveCount(0)

  // Row keyboard range selection uses the same state as pointer selection.
  await selectVariantRow(rows.nth(0))
  await page.keyboard.press('Shift+ArrowDown')
  await expect(rows.nth(1)).toBeFocused()
  await expect(
    first.locator('.variants tbody tr[aria-selected="true"]')
  ).toHaveCount(2)
  await selectVariantRow(rows.nth(0))
  await expect(
    first.locator('.variants tbody tr[aria-selected="true"]')
  ).toHaveCount(0)
  await expect(secondRow).toHaveAttribute('aria-selected', 'true')

  // A noninteractive area selects the whole group without storing UI state
  // as preparation edits.
  await first.locator('.original-product-name').click()
  await expect(first.locator('.group-select')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(first).toHaveClass(/is-selected/)
  await first.locator('.product-summary > h3').hover()
  await expect(first.locator('.product-summary > h3')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  )
  for (const theme of ['light', 'dark']) {
    await page.locator('meta[name="color-scheme"]').evaluate((node, value) => {
      node.content = value
    }, theme)
    const rowFill = await rows
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundColor)
    expect(rowFill).not.toBe('rgba(0, 0, 0, 0)')
    await expect(first.locator('.product-overview')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)'
    )
    await expect(first.locator('.group-select')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)'
    )
    for (const row of await rows.all()) {
      await expect(row).toHaveCSS('background-color', rowFill)
      expect(
        await row
          .locator('.variant-note-row')
          .evaluate((node) => getComputedStyle(node, '::before').display)
      ).toBe('none')
      await expect(row).toHaveCSS('box-shadow', 'none')
    }
    await expect(first).toHaveCSS('box-shadow', 'none')
    await expect(first).toHaveCSS('border-left-width', '0px')
  }
  // Clicking the already-selected group clears it and its highlight.
  await first.locator('.original-product-name').click()
  await expect(first.locator('.group-select')).toHaveAttribute(
    'aria-pressed',
    'false'
  )
  await expect(first).not.toHaveClass(/is-selected/)
  await expect(secondRow).toHaveAttribute('aria-selected', 'true')
  await expect(groups.nth(1).locator('.group-select')).toHaveAttribute(
    'aria-pressed',
    'false'
  )
  await expect(
    dialog.getByRole('button', { name: 'Undo', exact: true })
  ).toBeDisabled()
  await expect(dialog.locator('.preparation-save-status')).toHaveText(
    'Saved automatically'
  )
  const afterSelection = await packingBackup(extension)
  expect(afterSelection.preparations).toEqual(original.preparations)
  expect(afterSelection.issuedCodes).toEqual(original.issuedCodes)
  expect(afterSelection.orders).toEqual(original.orders)
})

test('undo and redo retain typing and confirmed regrouping after autosave', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  const view = await prepare(page)
  const original = await packingBackup(extension)
  await pauseAutosave(page)
  const first = view.locator('.preparation-group').first()
  const name = first.getByLabel('Spanish short name', { exact: true })
  const undo = view.getByRole('button', { name: 'Undo', exact: true })
  const redo = view.getByRole('button', { name: 'Redo', exact: true })
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()
  await name.fill('')
  await name.pressSequentially('frasco editado')
  await undo.click()
  await expect(name).toHaveValue(original.preparations[0].groups[0].spanishName)
  await expect(undo).toBeDisabled()
  await redo.click()
  await expect(name).toHaveValue('FRASCO EDITADO')
  expect((await packingBackup(extension)).preparations).toEqual(
    original.preparations
  )
  await page.clock.runFor(801)
  await waitForAutosave(view)
  await expect(undo).toBeEnabled()
  await expect(redo).toBeDisabled()

  await selectVariantRow(first.locator('.variants tbody tr').nth(0))
  await selectVariantRow(
    first.locator('.variants tbody tr').nth(1),
    'Control+Space'
  )
  await clickGroupingAction(page, 'Share one barcode')
  const review = page.getByRole('dialog', {
    name: 'Share one barcode?',
    exact: true,
  })
  await expect(review).toBeVisible()
  await expect(first.locator('.variants tbody tr')).toHaveCount(2)
  const beforeMerge = await packingBackup(extension)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await packingBackup(extension)).preparations).toEqual(
    beforeMerge.preparations
  )
  expect((await packingBackup(extension)).issuedCodes).toEqual(
    beforeMerge.issuedCodes
  )
  await clickGroupingAction(page, 'Share one barcode')
  await review
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(first.locator('.variants tbody tr')).toHaveCount(1)
  const saved = await savePreparationAndRead(extension, view)
  await expect(undo).toBeEnabled()
  await expect(redo).toBeDisabled()
  expect(saved.preparations[0].groups[0].spanishName).toBe('FRASCO EDITADO')
  expect(saved.preparations[0].groups[0].variants[0].entryIds).toEqual(
    record.snapshot.items.slice(0, 2).map((item) => item.entryId)
  )
  expect(saved.preparations[0].groups[0].baseCode).toBe(
    original.preparations[0].groups[0].baseCode
  )
  expect(saved.orders[0].snapshot).toEqual(record.snapshot)
  const base = first.getByLabel('Product code', { exact: true })
  await base.fill('INVALID')
  await page.clock.runFor(801)
  await expect(view.locator('.preparation-save-status')).toContainText(
    'Not saved'
  )
  await expect(base).toHaveValue('INVALID')
  await expect(undo).toBeEnabled()
  expect((await packingBackup(extension)).preparations).toEqual(
    saved.preparations
  )
  await undo.click()
  await expect(base).toHaveValue(saved.preparations[0].groups[0].baseCode)
  expect(extension.unexpectedRequests).toEqual([])
})

test('undo follows pending edits across selected orders without preparing an unselected order', async ({
  extension,
}) => {
  await seedStructuredOrder(extension)
  await seedStructuredOrder(extension, '900000000000000004')
  await seedStructuredOrder(extension, '900000000000000005')
  const page = await newWorkspacePage(extension)
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(9)
  await rows.first().locator('.product-title').click()
  await rows
    .nth(5)
    .locator('.product-title')
    .click({ modifiers: ['Shift'] })
  const view = await prepare(page, { groupCount: 4, selectRows: false })
  const original = await packingBackup(extension)
  expect(original.preparations).toHaveLength(2)
  await expect(view.locator('.packing-order-section')).toHaveCount(2)
  await pauseAutosave(page)
  const sections = view.locator('.packing-order-section')
  const firstName = sections
    .nth(0)
    .getByLabel('Spanish short name', { exact: true })
    .first()
  const secondName = sections
    .nth(1)
    .getByLabel('Spanish short name', { exact: true })
    .first()
  const firstId = await sections.nth(0).getAttribute('data-packing-order')
  const secondId = await sections.nth(1).getAttribute('data-packing-order')
  const oldName = (id) =>
    original.preparations.find((prep) => prep.orderId === id).groups[0]
      .spanishName
  const undo = view.getByRole('button', { name: 'Undo', exact: true })
  const redo = view.getByRole('button', { name: 'Redo', exact: true })
  await firstName.fill('PRIMER BORRADOR')
  await secondName.fill('SEGUNDO BORRADOR')
  await undo.click()
  await expect(secondName).toHaveValue(oldName(secondId))
  await expect(firstName).toHaveValue('PRIMER BORRADOR')
  await undo.click()
  await expect(firstName).toHaveValue(oldName(firstId))
  await expect(undo).toBeDisabled()
  await redo.click()
  await expect(firstName).toHaveValue('PRIMER BORRADOR')
  await redo.click()
  await expect(secondName).toHaveValue('SEGUNDO BORRADOR')
  const unsaved = await packingBackup(extension)
  expect(unsaved.preparations).toEqual(original.preparations)
  expect(unsaved.issuedCodes).toEqual(original.issuedCodes)
  await page.clock.runFor(801)
  await waitForAutosave(view)
  await expect(undo).toBeEnabled()
  await expect(redo).toBeDisabled()
  const saved = await packingBackup(extension)
  expect(saved.preparations).toHaveLength(2)
  expect(
    saved.preparations.map((prep) => prep.groups[0].spanishName).sort()
  ).toEqual(['PRIMER BORRADOR', 'SEGUNDO BORRADOR'])
  expect(
    new Set(
      saved.preparations.flatMap((prep) =>
        prep.groups.map((group) => group.baseCode)
      )
    ).size
  ).toBe(4)
  expect(saved.orders).toEqual(original.orders)
  expect(extension.unexpectedRequests).toEqual([])
})

test('autosave preserves focus and newer typing while an earlier database write completes', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  const dialog = await prepare(page)
  const original = await packingBackup(extension)
  const name = dialog
    .locator('.preparation-group')
    .first()
    .getByLabel('Spanish short name', { exact: true })
  const undo = dialog.getByRole('button', { name: 'Undo', exact: true })
  const redo = dialog.getByRole('button', { name: 'Redo', exact: true })
  const order = dialog.getByLabel('Show packing orders', { exact: true })
  await holdPreparationWrites(page)
  await name.fill('GUARDADO SEGURO')
  const originalInput = await name.elementHandle()
  await expect
    .poll(() => page.evaluate(() => window.preparationSaveStarted))
    .toBe(true)
  await expect(dialog.locator('.preparation-save-status')).toHaveText('Saving…')
  await expect(name).toBeEnabled()
  await expect(name).toBeFocused()
  await page.keyboard.type(' ACTUALIZADO')
  await expect(name).toHaveValue('GUARDADO SEGURO ACTUALIZADO')
  await page.evaluate(() => {
    window.holdPreparationSave = false
  })
  await waitForAutosave(dialog)
  await expect(name).toBeEnabled()
  await expect(order).toBeEnabled()
  await expect(undo).toBeEnabled()
  await expect(redo).toBeDisabled()
  await expect(name).toHaveValue('GUARDADO SEGURO ACTUALIZADO')
  await expect(name).toBeFocused()
  expect(await originalInput.evaluate((input) => input.isConnected)).toBe(true)
  await originalInput.dispose()
  const saved = await packingBackup(extension)
  expect(saved.preparations[0].revision).toBe(
    original.preparations[0].revision + 2
  )
  expect(saved.preparations[0].groups[0].spanishName).toBe(
    'GUARDADO SEGURO ACTUALIZADO'
  )
  expect(saved.issuedCodes).toEqual(original.issuedCodes)
  expect(saved.orders).toEqual(original.orders)
  expect(extension.unexpectedRequests).toEqual([])
})

for (const action of ['Copy Excel image', 'Copy group codes', 'Copy columns']) {
  test(`${action} freezes its click selection while awaiting autosave and exports the latest saved values`, async ({
    extension,
  }) => {
    const { page, record } = await openWorkspace(extension, { previews: false })
    const view = await prepare(page)
    const groups = view.locator('.preparation-group')
    const first = groups.first()
    const name = first.getByLabel('Spanish short name', { exact: true })
    const original = await packingBackup(extension)
    const originalCode = original.preparations[0].groups[0].baseCode
    const otherCode = original.preparations[0].groups[1].baseCode
    const latestCode = 'CE26109901'
    await extension.context.grantPermissions([
      'clipboard-read',
      'clipboard-write',
    ])
    await page.bringToFront()
    await page.evaluate(async () => {
      await navigator.clipboard.writeText('pending-packing-export')
      window.frozenPackingText = []
      const fillText = CanvasRenderingContext2D.prototype.fillText
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        if (this.canvas.width > 2000)
          window.frozenPackingText.push(String(text))
        return fillText.call(this, text, ...args)
      }
    })
    await first.locator('.group-select').click()
    await expect(view.locator('.preparation-copy-scope')).toHaveText(
      '2 selected products · 1 orders'
    )
    await holdPreparationWrites(page)
    await name.fill('PRIMER GUARDADO')
    await expect
      .poll(() => page.evaluate(() => window.preparationSaveStarted))
      .toBe(true)
    try {
      await revealCopyActions(page)
      await view.getByRole('button', { name: action, exact: true }).click()
      await expect(view.locator('.preparation-save-status')).toHaveText(
        'Saving…'
      )
      // Selection is allowed to change while the real database is still saving.
      // The export belongs to the two jars chosen when its button was clicked.
      await first.locator('.group-select').click()
      await groups.nth(1).locator('.group-select').click()
      await expect(view.locator('.preparation-copy-scope')).toHaveText(
        '1 selected products · 1 orders'
      )
      await name.fill('FRASCO ACTUALIZADO')
      await first.getByLabel('Product code', { exact: true }).fill(latestCode)
      await first
        .getByLabel('Chinese category', { exact: true })
        .fill('新玻璃制品')
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        'pending-packing-export'
      )
      await expect(page.getByRole('dialog')).toHaveCount(0)
    } finally {
      await page.evaluate(() => {
        window.holdPreparationSave = false
      })
    }
    await waitForAutosave(view)
    if (action === 'Copy columns') {
      const columns = page.getByRole('dialog', {
        name: 'Copy preparation columns',
        exact: true,
      })
      await expect(columns.getByRole('heading', { level: 2 })).toHaveText(
        'Copy 2 product rows'
      )
      await columns
        .getByRole('button', { name: 'Copy chosen columns', exact: true })
        .click()
      await expect(
        columns.getByRole('button', { name: 'Copied', exact: true })
      ).toBeVisible()
      const text = await page.evaluate(() => navigator.clipboard.readText())
      const rows = text.split('\r\n').map((row) => row.split('\t'))
      expect(rows).toHaveLength(2)
      expect(rows.map((row) => row[0])).toEqual([latestCode, ''])
      expect(rows.map((row) => row[1])).toEqual([
        `${latestCode}S`,
        `${latestCode}L`,
      ])
      for (const [index, row] of rows.entries()) {
        expect(row[3]).toBe('FRASCO ACTUALIZADO')
        expect(row.slice(4)).toEqual(
          ['price', 'quantity', 'discount'].map(
            (key) => record.snapshot.items[index][key]
          )
        )
      }
      expect(text).not.toContain(otherCode)
      expect(text).not.toContain(originalCode)
    } else if (action === 'Copy group codes') {
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(latestCode)
    } else {
      await copyCurrentImageBatch(page)
      await expect(
        view.getByRole('button', { name: 'Copied', exact: true })
      ).toBeVisible()
      const text = await page.evaluate(() => window.frozenPackingText)
      // The carton artwork and barcode base contain the code; the redundant
      // caption beneath the carton image is deliberately absent.
      expect(text.filter((value) => value === latestCode)).toHaveLength(2)
      expect(text).not.toContain(originalCode)
      expect(text).not.toContain(otherCode)
      expect(text).toContain('新玻璃制品')
      expect(text.join('')).toContain('300 ml')
      expect(text.join('')).toContain('500 ml')
      expect(text.join('')).not.toContain('TEST-BOX')
      for (const item of record.snapshot.items.slice(0, 2)) {
        expect(text).toContain(`¥ ${item.price}`)
        expect(text).toContain(item.quantity)
      }
      const image = await page.evaluate(async () => {
        const entries = await navigator.clipboard.read()
        const blob = await entries[0].getType('image/png')
        const bitmap = await createImageBitmap(blob)
        const result = { width: bitmap.width, height: bitmap.height }
        bitmap.close()
        return result
      })
      expect(image.width).toBeGreaterThan(1500)
      expect(image.height).toBeGreaterThan(200)
    }
    const saved = await packingBackup(extension)
    const savedGroup = saved.preparations[0].groups[0]
    expect(savedGroup.baseCode).toBe(latestCode)
    expect(savedGroup.spanishName).toBe('FRASCO ACTUALIZADO')
    expect(savedGroup.category).toBe('新玻璃制品')
    expect(saved.orders).toEqual(original.orders)
    for (const reservation of original.issuedCodes)
      expect(saved.issuedCodes).toContainEqual(reservation)
    expect(extension.unexpectedRequests).toEqual([])
  })
}

test('changing the displayed packing order during a pending column copy retains the original order and rows', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension, { previews: false })
  const other = await seedStructuredOrder(extension, '900000000000000004')
  await page.reload()
  const view = await prepare(page, { groupCount: 4 })
  const filter = view.getByLabel('Show packing orders', { exact: true })
  await filter.selectOption(record.snapshot.orderId)
  const group = view.locator('.preparation-group').first()
  const name = group.getByLabel('Spanish short name', { exact: true })
  const code = await group
    .getByLabel('Product code', { exact: true })
    .inputValue()
  await group.locator('.group-select').click()
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await holdPreparationWrites(page)
  await name.fill('PRIMER NOMBRE')
  await expect
    .poll(() => page.evaluate(() => window.preparationSaveStarted))
    .toBe(true)
  try {
    await revealCopyActions(page)
    await view
      .getByRole('button', { name: 'Copy columns', exact: true })
      .click()
    await name.fill('FRASCO FILTRADO')
    await filter.selectOption(other.snapshot.orderId)
    await view.getByRole('button', { name: 'Select all', exact: true }).click()
    await expect(view.locator('.preparation-copy-scope')).toHaveText(
      '3 selected products · 1 orders'
    )
    await expect(
      page.getByRole('dialog', {
        name: 'Copy preparation columns',
        exact: true,
      })
    ).not.toBeVisible()
  } finally {
    await page.evaluate(() => {
      window.holdPreparationSave = false
    })
  }
  const columns = page.getByRole('dialog', {
    name: 'Copy preparation columns',
    exact: true,
  })
  await expect(columns.getByRole('heading', { level: 2 })).toHaveText(
    'Copy 2 product rows'
  )
  await columns
    .getByRole('button', { name: 'Copy chosen columns', exact: true })
    .click()
  await expect(
    columns.getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible()
  const rows = (await page.evaluate(() => navigator.clipboard.readText()))
    .split('\r\n')
    .map((row) => row.split('\t'))
  expect(rows).toHaveLength(2)
  expect(rows.map((row) => row[0])).toEqual([code, ''])
  expect(rows.map((row) => row[1])).toEqual([`${code}S`, `${code}L`])
  expect(rows.map((row) => row[3])).toEqual([
    'FRASCO FILTRADO',
    'FRASCO FILTRADO',
  ])
  const saved = await packingBackup(extension)
  expect(
    saved.preparations.find((prep) => prep.orderId === record.snapshot.orderId)
      .groups[0].spanishName
  ).toBe('FRASCO FILTRADO')
  expect(extension.unexpectedRequests).toEqual([])
})

test('bulk barcode output retains its click selection when Ctrl+A expands rows during an active save', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension, { previews: false })
  const view = await prepare(page)
  const first = view.locator('.preparation-group').first()
  const name = first.getByLabel('Spanish short name', { exact: true })
  const original = await packingBackup(extension)
  await first.locator('.group-select').click()
  await observeLabelOutput(page, extension)
  await page.evaluate(() => {
    window.frozenBarcodeText = []
    const fillText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.frozenBarcodeText.push(String(text))
      return fillText.call(this, text, ...args)
    }
  })
  await holdPreparationWrites(page)
  await name.fill('PRIMER NOMBRE')
  await expect
    .poll(() => page.evaluate(() => window.preparationSaveStarted))
    .toBe(true)
  try {
    // This newer edit is queued behind the held write, so the labels must wait
    // for both actual saves before reading their content.
    await name.fill('FRASCO NUEVO')
    await revealCopyActions(page)
    await view
      .getByRole('button', { name: 'Copy barcode images', exact: true })
      .click()
    await expect(name).toBeDisabled()
    await expect(
      view.getByLabel('Show packing orders', { exact: true })
    ).toBeDisabled()
    // Rows remain keyboard targets even though form controls are disabled.
    const row = first.locator('.variants tbody tr').first()
    await row.focus()
    await expect(row).toBeFocused()
    await page.keyboard.press('Control+a')
    await expect(view.locator('.preparation-copy-scope')).toHaveText(
      '3 selected products · 1 orders'
    )
    await expect(
      page.getByRole('dialog', { name: 'Prepare label images', exact: true })
    ).not.toBeVisible()
    expect(await page.evaluate(() => window.labelOutputProbe)).toEqual({
      renders: 0,
      writes: 0,
    })
  } finally {
    await page.evaluate(() => {
      window.holdPreparationSave = false
    })
  }
  const images = page.getByRole('dialog', {
    name: 'Prepare label images',
    exact: true,
  })
  await expect(images.locator('.copy-preview img')).toHaveCount(2)
  await expect(
    images.getByRole('button', { name: 'Copy current batch', exact: true })
  ).toBeEnabled()
  const text = await page.evaluate(() => window.frozenBarcodeText)
  expect(text.filter((value) => value === 'FRASCO NUEVO')).toHaveLength(2)
  expect(text).not.toContain('PRIMER NOMBRE')
  expect(text).not.toContain(original.preparations[0].groups[1].baseCode)
  expect(await page.evaluate(() => window.labelOutputProbe)).toEqual({
    renders: 2,
    writes: 0,
  })
  await images.getByRole('button', { name: 'Done', exact: true }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Synthetic label cancellation sentinel'
  )
  const saved = await packingBackup(extension)
  expect(saved.preparations[0].groups[0].spanishName).toBe('FRASCO NUEVO')
  expect(saved.orders).toEqual(original.orders)
  expect(saved.issuedCodes).toEqual(original.issuedCodes)
  expect(extension.unexpectedRequests).toEqual([])
})

test('Orders navigation preserves invalid edits and saves valid edits before changing the view', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  const view = await prepare(page)
  const original = await packingBackup(extension)
  await pauseAutosave(page)
  const first = view.locator('.preparation-group').first()
  const code = first.getByLabel('Product code', { exact: true })
  const name = first.getByLabel('Spanish short name', { exact: true })
  await name.fill('NOMBRE CONSERVADO')
  await code.fill('INVALID')
  await view
    .getByRole('heading', { name: 'Prepare packing list', exact: true })
    .click()
  await page.keyboard.press('Escape')
  await expect(view).toBeVisible()
  await expect(
    page.getByRole('dialog', { name: 'Prepare packing list', exact: true })
  ).toHaveCount(0)
  await view.getByRole('button', { name: 'Orders', exact: true }).click()
  await expect(view).toBeVisible()
  await expect(view.locator('.preparation-save-status')).toContainText(
    'Not saved'
  )
  await expect(name).toHaveValue('NOMBRE CONSERVADO')
  await expect(code).toHaveValue('INVALID')
  expect((await packingBackup(extension)).preparations).toEqual(
    original.preparations
  )
  await code.fill(original.preparations[0].groups[0].baseCode)
  await view.getByRole('button', { name: 'Orders', exact: true }).click()
  await expect(view).toBeHidden()
  await expect(page.locator('#orders-view')).toBeVisible()
  const saved = await packingBackup(extension)
  expect(saved.preparations[0].groups[0].spanishName).toBe('NOMBRE CONSERVADO')
  expect(saved.issuedCodes).toEqual(original.issuedCodes)
  expect(saved.orders).toEqual(original.orders)
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  await expect(name).toHaveValue('NOMBRE CONSERVADO')
  expect(extension.unexpectedRequests).toEqual([])
})

test('a conflicting autosave keeps its draft and reloads the saved version without a second confirmation', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension)
  const dialog = await prepare(page)
  const original = await packingBackup(extension)
  await pauseAutosave(page)
  const name = dialog
    .locator('.preparation-group')
    .first()
    .getByLabel('Spanish short name', { exact: true })
  await name.fill('BORRADOR LOCAL')
  const otherPage = await newWorkspacePage(extension)
  await otherPage.goto(`${extension.extensionBaseUrl}/library.html`)
  await otherPage
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  const otherDialog = otherPage.locator('#packing-view')
  await otherDialog
    .locator('.preparation-group')
    .first()
    .getByLabel('Spanish short name', { exact: true })
    .fill('GUARDADO EN OTRA PESTANA')
  // The context clock also applies to new tabs. Closing flushes the second
  // tab's real write while the first tab retains its pending local draft.
  await otherDialog.getByRole('button', { name: 'Orders', exact: true }).click()
  await expect(otherDialog).not.toBeVisible()
  await page.clock.runFor(801)
  await expect(dialog.locator('.preparation-save-status')).toContainText(
    'Not saved'
  )
  await expect(name).toHaveValue('BORRADOR LOCAL')
  await dialog
    .locator('.preparation-actions')
    .getByRole('button', { name: 'Reload saved version', exact: true })
    .click()
  const confirmation = page.getByRole('dialog', {
    name: 'Confirm operation',
    exact: true,
  })
  await expect(confirmation).not.toBeVisible()
  await expect(name).toHaveValue('GUARDADO EN OTRA PESTANA')
  await waitForAutosave(dialog)
  await expect(
    dialog.getByRole('button', { name: 'Undo', exact: true })
  ).toBeDisabled()
  await name.fill('CONTINUAR EDITANDO')
  await page.clock.runFor(801)
  await waitForAutosave(dialog)
  const saved = await packingBackup(extension)
  expect(saved.preparations[0].groups[0].spanishName).toBe('CONTINUAR EDITANDO')
  expect(saved.issuedCodes).toEqual(original.issuedCodes)
  expect(saved.orders).toEqual(original.orders)
  expect(extension.unexpectedRequests).toEqual([])
})

test('one invalid order does not prevent another selected order from saving automatically', async ({
  extension,
}) => {
  await seedStructuredOrder(extension)
  await seedStructuredOrder(extension, '900000000000000004')
  const page = await newWorkspacePage(extension)
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    6
  )
  const view = await prepare(page, { groupCount: 4 })
  const original = await packingBackup(extension)
  await pauseAutosave(page)
  const sections = view.locator('.packing-order-section')
  const invalidId = await sections.nth(0).getAttribute('data-packing-order')
  const validId = await sections.nth(1).getAttribute('data-packing-order')
  const first = sections.nth(0).locator('.preparation-group').first()
  await first.getByLabel('Product code', { exact: true }).fill('INVALID')
  await sections
    .nth(1)
    .getByLabel('Spanish short name', { exact: true })
    .first()
    .fill('PEDIDO VALIDO')
  await page.clock.runFor(801)
  await expect
    .poll(
      async () =>
        (await packingBackup(extension)).preparations.find(
          (prep) => prep.orderId === validId
        ).groups[0].spanishName
    )
    .toBe('PEDIDO VALIDO')
  await expect(view.locator('.preparation-save-status')).toContainText(
    'Not saved'
  )
  const saved = await packingBackup(extension)
  expect(saved.preparations).toHaveLength(2)
  expect(saved.preparations.find((prep) => prep.orderId === invalidId)).toEqual(
    original.preparations.find((prep) => prep.orderId === invalidId)
  )
  await expect(first.getByLabel('Product code', { exact: true })).toHaveValue(
    'INVALID'
  )
  expect(saved.orders).toEqual(original.orders)
  expect(extension.unexpectedRequests).toEqual([])
})

test('label editor saves repeated text edits and copies barcode and carton images at print resolution', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  const preparation = await prepare(page)
  const baseCode = await preparation
    .locator('.preparation-group')
    .first()
    .getByLabel('Product code', { exact: true })
    .inputValue()
  await preparation.getByRole('button', { name: 'Orders', exact: true }).click()
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])

  const firstRow = page.locator('#sheet-body tr[data-selection-key]').first()
  await firstRow.getByRole('button', { name: 'Barcode', exact: true }).click()
  const label = page.getByRole('dialog', { name: 'Label editor', exact: true })
  const code = label.getByLabel('Barcode code', { exact: true })
  const variantCode = label.getByRole('textbox', {
    name: 'Variant code',
    exact: true,
  })
  const sizeCode = label.getByRole('textbox', {
    name: 'Size code',
    exact: true,
  })
  const spanish = label.getByRole('textbox', {
    name: 'Spanish product name',
    exact: true,
  })
  const copy = label.getByRole('button', { name: 'Copy label', exact: true })
  await expect(
    label.getByRole('heading', { name: 'Barcode label' })
  ).toBeVisible()
  await expect(code).toHaveText(`${baseCode}S`)
  await expect(variantCode).toHaveValue('')
  await expect(sizeCode).toHaveValue('S')
  await expect(spanish).toHaveValue('FRASCO')
  await expect(label.getByAltText('Printable label preview')).toBeVisible()
  await expect(copy).toBeEnabled({ timeout: 20_000 })

  await spanish.fill('frasco transparente')
  await spanish.press('Enter')
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  await expect(spanish).toHaveValue('FRASCO TRANSPARENTE')
  await variantCode.fill('a')
  await variantCode.press('Enter')
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  await expect(code).toHaveText(`${baseCode}AS`)
  await expect(variantCode).toHaveValue('A')
  await spanish.fill('discarded edit')
  await spanish.press('Escape')
  await expect(spanish).toHaveValue('FRASCO TRANSPARENTE')
  await expect(label).toBeVisible()
  await expect(copy).toBeEnabled({ timeout: 20_000 })

  const barcode = await copiedLabel(page, label)
  expect(barcode.types).toEqual(
    expect.arrayContaining(['image/png', 'text/html'])
  )
  expect(barcode.bytes).toBeGreaterThan(100)
  expect(barcode).toMatchObject({
    width: 472,
    height: 236,
    imageCount: 1,
    imageSource: true,
    printWidth: '40mm',
    printHeight: '20mm',
  })
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()

  await page.reload()
  await firstRow.getByRole('button', { name: 'Barcode', exact: true }).click()
  await expect(code).toHaveText(`${baseCode}AS`)
  await expect(spanish).toHaveValue('FRASCO TRANSPARENTE')
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()

  await firstRow
    .getByRole('button', { name: 'Carton mark', exact: true })
    .click()
  const markCode = label.getByRole('textbox', {
    name: 'Base CE code',
    exact: true,
  })
  const category = label.getByRole('textbox', {
    name: 'Chinese category',
    exact: true,
  })
  await expect(
    label.getByRole('heading', { name: 'Carton mark' })
  ).toBeVisible()
  await expect(markCode).toHaveValue(baseCode)
  await category.fill('玻璃制品')
  await category.press('Enter')
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  const updatedBaseCode = 'CE26109998'
  await markCode.fill(updatedBaseCode)
  await markCode.press('Enter')
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  await expect(markCode).toHaveValue(updatedBaseCode)

  const mark = await copiedLabel(page, label)
  expect(mark.types).toEqual(expect.arrayContaining(['image/png', 'text/html']))
  expect(mark.bytes).toBeGreaterThan(100)
  expect(mark).toMatchObject({
    width: 1754,
    height: 1240,
    imageCount: 1,
    imageSource: true,
    printWidth: '148.5mm',
    printHeight: '105mm',
  })
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  await page.reload()
  await expect(page.locator('.row-code-copy').nth(0)).toHaveText(
    updatedBaseCode
  )
  await expect(page.locator('.row-code-copy').nth(1)).toHaveText(
    updatedBaseCode
  )
  await firstRow
    .getByRole('button', { name: 'Carton mark', exact: true })
    .click()
  await expect(markCode).toHaveValue(updatedBaseCode)
  await expect(category).toHaveValue('玻璃制品')
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  await firstRow.getByRole('button', { name: 'Barcode', exact: true }).click()
  await expect(code).toHaveText(`${updatedBaseCode}AS`)
  await expect(spanish).toHaveValue('FRASCO TRANSPARENTE')
  const library = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'LIBRARY_QUERY' })
  )
  expect(library.ok, library.error).toBe(true)
  expect(library.data.orders[0].snapshot).toEqual(record.snapshot)
  expect(extension.unexpectedRequests).toEqual([])
})

async function packingBackup(extension) {
  const response = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(response.ok, response.error).toBe(true)
  return response.data
}

test('barcode image segments persist separately, reject collisions and leave source rows unchanged', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  const preparation = await prepare(page)
  const group = preparation.locator('.preparation-group').first()
  const baseCode = await group
    .getByLabel('Product code', { exact: true })
    .inputValue()
  const firstVariant = group.locator('.variants tbody tr').first()
  await firstVariant
    .getByRole('button', { name: 'Edit barcode', exact: true })
    .click()
  const label = page.getByRole('dialog', { name: 'Label editor', exact: true })
  const variant = label.getByRole('textbox', {
    name: 'Variant code',
    exact: true,
  })
  const size = label.getByRole('textbox', { name: 'Size code', exact: true })
  const copy = label.getByRole('button', { name: 'Copy label', exact: true })
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  const original = await packingBackup(extension)
  // Both fields live on the barcode image, and the shared base is not editable here.
  await expect(
    label
      .locator('.label-editor-preview')
      .getByLabel('Variant code', { exact: true })
  ).toBeVisible()
  await expect(
    label
      .locator('.label-editor-preview')
      .getByLabel('Size code', { exact: true })
  ).toBeVisible()
  await expect(
    label.getByRole('textbox', { name: 'Barcode code', exact: true })
  ).toHaveCount(0)
  await expect(label.locator('.label-code-base')).toHaveText(baseCode)
  await size.fill('L')
  await size.press('Enter')
  await expect(label.locator('.error-notice-message')).toContainText(
    /duplicate|already|conflict|unique/i
  )
  await expect(copy).toBeDisabled()
  expect((await packingBackup(extension)).preparations).toEqual(
    original.preparations
  )
  await size.press('Escape')
  await expect(size).toHaveValue('S')
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  await variant.fill('aa')
  await variant.press('Enter')
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  await size.fill('xs')
  await size.press('Enter')
  await expect(copy).toBeEnabled({ timeout: 20_000 })
  await expect(label.getByLabel('Barcode code', { exact: true })).toHaveText(
    `${baseCode}AAXS`
  )
  const saved = await packingBackup(extension)
  expect(saved.preparations[0].groups[0].variants[0]).toMatchObject({
    variantSuffix: 'AA',
    sizeSuffix: 'XS',
    needsSizeMapping: false,
  })
  expect(saved.orders[0].snapshot).toEqual(record.snapshot)
  await label
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  await expect(
    firstVariant.getByRole('textbox', { name: /^Variant code / })
  ).toHaveValue('AA')
  await expect(
    firstVariant.getByRole('textbox', { name: /^Size code / })
  ).toHaveValue('XS')
  await firstVariant
    .getByRole('button', { name: 'Edit barcode', exact: true })
    .click()
  await expect(variant).toHaveValue('AA')
  await expect(size).toHaveValue('XS')
  await expect(label.getByLabel('Barcode code', { exact: true })).toHaveText(
    `${baseCode}AAXS`
  )
  expect(extension.unexpectedRequests).toEqual([])
})

async function savePreparationAndRead(extension, dialog) {
  await waitForAutosave(dialog)
  return packingBackup(extension)
}

test('combining, separating, splitting and merging preserve source rows and saved code ownership', async ({
  extension,
}) => {
  const { page, record } = await openWorkspace(extension)
  const dialog = await prepare(page)
  const form = dialog.locator('#preparation-content')
  const groups = dialog.locator('.preparation-group')
  const first = groups.first()
  const original = (await packingBackup(extension)).preparations[0]
  const originalGroup = original.groups[0]
  const originalCode = originalGroup.baseCode
  const sharedBarcode = `${originalCode}${originalGroup.variants[0].variantSuffix}${originalGroup.variants[0].sizeSuffix}`
  const sourceIds = record.snapshot.items.map((item) => item.entryId)
  await selectVariantRow(first.locator('.variants tbody tr').nth(0))
  await selectVariantRow(
    first.locator('.variants tbody tr').nth(1),
    'Control+Space'
  )
  await clickGroupingAction(page, 'Share one barcode')
  await page
    .locator('.packing-review')
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(page.locator('.packing-review')).toBeHidden()
  await expect(form).toBeEnabled()
  await expect(first.locator('.variants tbody tr')).toHaveCount(1)
  await expect(first).toContainText('2 source rows')
  let backup = await savePreparationAndRead(extension, dialog)
  expect(backup.preparations[0].groups[0].variants).toHaveLength(1)
  expect(backup.preparations[0].groups[0].variants[0].entryIds).toEqual(
    sourceIds.slice(0, 2)
  )
  expect(backup.orders[0].snapshot).toEqual(record.snapshot)
  await dialog.getByRole('button', { name: 'Orders', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('#orders-view')).toBeVisible()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  for (const index of [0, 1]) {
    await page
      .locator('#sheet-body tr[data-selection-key]')
      .nth(index)
      .getByRole('button', { name: 'Barcode', exact: true })
      .click()
    const label = page.getByRole('dialog', {
      name: 'Label editor',
      exact: true,
    })
    await expect(label.getByLabel('Barcode code', { exact: true })).toHaveText(
      sharedBarcode
    )
    await label
      .getByRole('button', { name: 'Close label editor', exact: true })
      .click()
    await expect(label).toBeHidden()
  }

  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  // Reopening saves/reloads before replacing the previous hidden packing DOM.
  await expect(dialog).toBeVisible()
  await expect(page.locator('#orders-view')).toBeHidden()
  await expect(form).toBeEnabled()
  await waitForAutosave(dialog)
  await selectVariantRow(first.locator('.variants tbody tr').first())
  await expect(first.locator('.variants tbody tr')).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await clickGroupingAction(page, 'Give rows separate barcodes')
  await page
    .locator('.packing-review')
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(page.locator('.packing-review')).toBeHidden()
  await expect(form).toBeEnabled()
  await expect(first.locator('.variants tbody tr')).toHaveCount(2)
  await expect(first).not.toContainText('2 source rows')
  backup = await savePreparationAndRead(extension, dialog)
  const separated = backup.preparations[0].groups[0]
  expect(separated.variants.map((variant) => variant.entryIds)).toEqual(
    sourceIds.slice(0, 2).map((id) => [id])
  )
  expect(
    new Set(
      separated.variants.map(
        (variant) => `${variant.variantSuffix}${variant.sizeSuffix}`
      )
    ).size
  ).toBe(2)
  expect(separated.baseCode).toBe(originalCode)
  expect(backup.orders[0].snapshot).toEqual(record.snapshot)

  // Combining retires the second barcode. A later separation must allocate a
  // new suffix instead of reassigning that code to a newly created variant.
  const retiredVariant = separated.variants[1]
  const retiredBarcode = `${originalCode}${retiredVariant.variantSuffix}${retiredVariant.sizeSuffix}`
  // Confirmed grouping starts a fresh row selection. Select both source rows.
  await dialog
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  await selectVariantRow(first.locator('.variants tbody tr').nth(0))
  await selectVariantRow(
    first.locator('.variants tbody tr').nth(1),
    'Control+Space'
  )
  await clickGroupingAction(page, 'Share one barcode')
  await page
    .locator('.packing-review')
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(page.locator('.packing-review')).toBeHidden()
  await expect(form).toBeEnabled()
  await expect(first.locator('.variants tbody tr')).toHaveCount(1)
  backup = await savePreparationAndRead(extension, dialog)
  expect(backup.preparations[0].groups[0].variants[0].entryIds).toEqual(
    sourceIds.slice(0, 2)
  )
  await selectVariantRow(first.locator('.variants tbody tr').first())
  await expect(first.locator('.variants tbody tr')).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await clickGroupingAction(page, 'Give rows separate barcodes')
  await page
    .locator('.packing-review')
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(page.locator('.packing-review')).toBeHidden()
  await expect(form).toBeEnabled()
  await expect(first.locator('.variants tbody tr')).toHaveCount(2)
  backup = await savePreparationAndRead(extension, dialog)
  const separatedAgain = backup.preparations[0].groups[0].variants[1]
  expect(separatedAgain.id).not.toBe(retiredVariant.id)
  expect(separatedAgain.entryIds).toEqual([sourceIds[1]])
  expect(separatedAgain.variantSuffix).toBe('B')
  expect(
    `${originalCode}${separatedAgain.variantSuffix}${separatedAgain.sizeSuffix}`
  ).not.toBe(retiredBarcode)
  expect(
    backup.issuedCodes.some(
      (issued) =>
        issued.code === retiredBarcode && issued.variantId === retiredVariant.id
    )
  ).toBe(true)
  expect(backup.orders[0].snapshot).toEqual(record.snapshot)

  await selectVariantRow(first.locator('.variants tbody tr').nth(1))
  await clickGroupingAction(page, 'Move to new product')
  await page
    .locator('.packing-review')
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(page.locator('.packing-review')).toBeHidden()
  await expect(form).toBeEnabled()
  await expect(groups).toHaveCount(3)
  backup = await savePreparationAndRead(extension, dialog)
  const splitCode = backup.preparations[0].groups[2].baseCode
  expect(splitCode).toMatch(/^CE2610\d{4}$/)
  expect(splitCode).not.toBe(originalCode)
  expect(backup.preparations[0].groups[2].variants[0].entryIds).toEqual([
    sourceIds[1],
  ])
  expect(backup.orders[0].snapshot).toEqual(record.snapshot)

  await dialog
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  await groups.nth(0).locator('.group-select').click()
  await groups
    .nth(2)
    .locator('.group-select')
    .click({ modifiers: ['Control'] })
  await clickGroupingAction(page, 'Merge products')
  await page
    .locator('.packing-review')
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(page.locator('.packing-review')).toBeHidden()
  await expect(form).toBeEnabled()
  await expect(groups).toHaveCount(2)
  await expect(first.locator('.variants tbody tr')).toHaveCount(2)
  backup = await savePreparationAndRead(extension, dialog)
  const final = backup.preparations[0]
  expect(final.groups[0].baseCode).toBe(originalCode)
  expect(
    final.groups[0].variants.flatMap((variant) => variant.entryIds).sort()
  ).toEqual(sourceIds.slice(0, 2).sort())
  expect(final.groups[1].variants[0].entryIds).toEqual([sourceIds[2]])
  expect(
    backup.issuedCodes.some(
      (issued) => issued.kind === 'base' && issued.code === splitCode
    )
  ).toBe(true)
  expect(backup.orders[0].snapshot).toEqual(record.snapshot)
  await dialog.getByRole('button', { name: 'Orders', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('#orders-view')).toBeVisible()
  await page.reload()
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await expect(page.locator('.row-code-copy')).toHaveText([
    originalCode,
    originalCode,
    original.groups[1].baseCode,
  ])
  expect(extension.unexpectedRequests).toEqual([])
})

test('merging product groups across pages returns to a populated page without losing source rows or reserved codes', async ({
  extension,
}) => {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-paged-preparation'
  const template = record.snapshot.items[0]
  record.snapshot.items = Array.from({ length: 21 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0')
    return {
      ...template,
      entryId: `9700000000000000${number}`,
      title: `Synthetic product ${number}`,
      productNumber: `PAGED-${number}`,
      description: `Synthetic product ${number}\n货号：PAGED-${number}`,
      price: '1.00',
      quantity: '1',
      sourceDiscount: '0.00',
      allocatedDiscount: '0.00',
      discount: '0.00',
    }
  })
  record.snapshot.totals = {
    goodsGross: '21.00',
    shipping: '0.00',
    sourceDiscount: '0.00',
    orderAdjustment: '0.00',
    goodsNet: '21.00',
    payable: '21.00',
  }
  record.changedEntryIds = []
  const restored = await extension.inspector.evaluate(
    (order) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders: [order],
          history: [],
          images: [],
        },
      }),
    record
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await newWorkspacePage(extension)
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await page.getByLabel('Packing month', { exact: true }).fill('2026-10')
  await selectAllProducts(page)
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  const dialog = await acceptPreparationPreview(page)
  await dialog
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  const groups = dialog.locator('.preparation-group')
  await expect(groups).toHaveCount(20)
  await waitForAutosave(dialog)
  const before = await packingBackup(extension)
  const first = before.preparations[0].groups[0]
  const last = before.preparations[0].groups[20]
  await groups.first().locator('.group-select').click()
  await dialog.getByRole('button', { name: 'Next groups', exact: true }).click()
  await expect(groups).toHaveCount(1)
  await groups
    .first()
    .locator('.group-select')
    .click({ modifiers: ['Control'] })
  await clickGroupingAction(page, 'Merge products')
  await page
    .locator('.packing-review')
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click()
  await expect(groups).toHaveCount(20)
  await expect(
    dialog.getByRole('button', { name: 'Previous groups', exact: true })
  ).toHaveCount(0)
  await expect(
    dialog.getByRole('button', { name: 'Next groups', exact: true })
  ).toHaveCount(0)
  await expect(groups.first().locator('.group-select')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(groups.first().locator('.variants tbody tr')).toHaveCount(2)
  const after = await savePreparationAndRead(extension, dialog)
  expect(after.preparations[0].groups).toHaveLength(20)
  expect(after.preparations[0].groups[0].id).toBe(first.id)
  expect(after.preparations[0].groups[0].baseCode).toBe(first.baseCode)
  expect(
    after.preparations[0].groups
      .flatMap((group) => group.variants.flatMap((variant) => variant.entryIds))
      .sort()
  ).toEqual(record.snapshot.items.map((item) => item.entryId).sort())
  expect(after.orders[0].snapshot).toEqual(record.snapshot)
  expect(
    after.issuedCodes.some(
      (issued) => issued.kind === 'base' && issued.code === last.baseCode
    )
  ).toBe(true)
  await dialog
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click()
  await groups.nth(1).locator('.group-select').click()
  await expect(groups.locator('.group-select[aria-pressed=true]')).toHaveCount(
    1
  )
  await expect(groups.first().locator('.group-select')).toHaveAttribute(
    'aria-pressed',
    'false'
  )
  expect(extension.unexpectedRequests).toEqual([])
})

async function observeLabelOutput(page, extension) {
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.bringToFront()
  await page.evaluate(async () => {
    await navigator.clipboard.writeText('Synthetic label cancellation sentinel')
    window.labelOutputProbe = { renders: 0, writes: 0 }
    const encode = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      window.labelOutputProbe.renders++
      return encode.apply(this, args)
    }
    const write = navigator.clipboard.write.bind(navigator.clipboard)
    navigator.clipboard.write = (...args) => {
      window.labelOutputProbe.writes++
      return write(...args)
    }
  })
}

test('invalid preparation blocks batch labels and a corrected pending edit saves before rendering', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension, { previews: false })
  const view = await prepare(page, { clearSelection: false })
  const original = await packingBackup(extension)
  await observeLabelOutput(page, extension)
  await view
    .locator('.preparation-group')
    .first()
    .getByLabel('Spanish short name', { exact: true })
    .fill('nombre pendiente')
  const base = view
    .locator('.preparation-group')
    .first()
    .getByLabel('Product code', { exact: true })
  await base.fill('INVALID')
  for (const name of ['Copy barcode images', 'Copy carton marks']) {
    await revealCopyActions(page)
    await view.getByRole('button', { name, exact: true }).click()
    await expect(view.getByRole('alert')).toContainText('Base code')
    await expect(view.locator('.preparation-save-status')).toContainText(
      'Not saved'
    )
    await expect(
      page.getByRole('dialog', { name: 'Confirm operation', exact: true })
    ).not.toBeVisible()
    await expect(
      page.getByRole('dialog', { name: 'Prepare label images', exact: true })
    ).not.toBeVisible()
  }
  expect((await packingBackup(extension)).preparations).toEqual(
    original.preparations
  )
  expect(await page.evaluate(() => window.labelOutputProbe)).toEqual({
    renders: 0,
    writes: 0,
  })
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Synthetic label cancellation sentinel'
  )

  await base.fill(original.preparations[0].groups[0].baseCode)
  await revealCopyActions(page)
  await view
    .getByRole('button', { name: 'Copy barcode images', exact: true })
    .click()
  const images = page.getByRole('dialog', {
    name: 'Prepare label images',
    exact: true,
  })
  await expect(images.locator('.copy-preview img')).toHaveCount(3)
  await expect(
    images.getByRole('button', { name: 'Copy current batch', exact: true })
  ).toBeEnabled()
  await expect(
    page.getByRole('dialog', { name: 'Confirm operation', exact: true })
  ).not.toBeVisible()
  const saved = await packingBackup(extension)
  expect(saved.preparations[0].groups[0].spanishName).toBe('NOMBRE PENDIENTE')
  await images.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(images).not.toBeVisible()
  expect((await page.evaluate(() => window.labelOutputProbe)).writes).toBe(0)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Synthetic label cancellation sentinel'
  )
  expect(extension.unexpectedRequests).toEqual([])
})

test('selected rows limit barcode and carton output and cancel leaves the clipboard unchanged', async ({
  extension,
}) => {
  const { page } = await openWorkspace(extension, { previews: false })
  const view = await prepare(page)
  await view.getByRole('button', { name: 'Orders', exact: true }).click()
  await page
    .locator('#sheet-body tr[data-selection-key]')
    .nth(0)
    .locator('td')
    .first()
    .click()
  await page
    .locator('#sheet-body tr[data-selection-key]')
    .nth(1)
    .locator('td')
    .first()
    .click({ modifiers: ['Shift'] })
  await expect(page.locator('#selection-summary')).toContainText('2 selected')
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  await expect(view.locator('.preparation-group')).toHaveCount(1)
  await expect(view.locator('.preparation-copy-scope')).toHaveText(
    '2 selected products · 1 orders'
  )
  await observeLabelOutput(page, extension)
  const images = page.getByRole('dialog', {
    name: 'Prepare label images',
    exact: true,
  })
  for (const [action, count] of [
    ['Copy barcode images', 2],
    ['Copy carton marks', 1],
  ]) {
    await revealCopyActions(page)
    await view.getByRole('button', { name: action, exact: true }).click()
    await expect(images.locator('.copy-preview img')).toHaveCount(count)
    await expect(
      images.getByRole('button', { name: 'Copy current batch', exact: true })
    ).toBeEnabled()
    await expect(
      page.getByRole('dialog', { name: 'Confirm operation', exact: true })
    ).not.toBeVisible()
    await images.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(images).not.toBeVisible()
    expect((await page.evaluate(() => window.labelOutputProbe)).writes).toBe(0)
  }
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Synthetic label cancellation sentinel'
  )
  expect(extension.unexpectedRequests).toEqual([])
})
