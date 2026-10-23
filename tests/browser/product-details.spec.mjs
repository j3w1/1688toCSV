import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  assignSelectedPurchaseCodes,
  editOrderProduct,
  closeOrderProduct,
  openOrderReconciliation,
  realOrderContext,
} from './smart-workspace-helpers.mjs'

async function workspace(
  extension,
  { longDescription = false, cartonDetails } = {}
) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerName = '合成商品资料店'
  record.snapshot.sellerMemberLogin = 'synthetic-product-details'
  record.snapshot.sellerShopOrigin =
    'https://synthetic-product-details.1688.com'
  const [structured, legacy, minimal] = record.snapshot.items
  if (cartonDetails)
    record.cartonDetails = { [structured.entryId]: cartonDetails }
  structured.title = '合成规格测试玻璃花瓶'
  structured.productNumber = 'ABC-42'
  structured.skuProperties = [
    { label: '规格', value: '14*65CM', raw: '规格14*65CM' },
    { label: '颜色', value: '灰色', raw: '颜色：灰色' },
    { label: '货号', value: 'ABC-42', raw: '货号：ABC-42' },
    { label: '包装说明', value: '一件一袋', raw: '包装说明：一件一袋' },
  ]
  structured.description = `${structured.title}\n规格14*65CM\n颜色：灰色\n货号：ABC-42\n\n包装说明：一件一袋  `
  if (longDescription)
    structured.description += Array.from(
      { length: 45 },
      (_, index) =>
        `\n原始商品说明 ${index + 1}：合成商品包装、材质与使用说明。`
    ).join('')
  legacy.description =
    '原始短款玻璃瓶\n规格：8×12cm\n颜色：白色\n货号：LEGACY-8'
  minimal.description = '仅有原始商品说明，没有规格或颜色字段。'
  minimal.thumbnail = ''
  const restored = await extension.inspector.evaluate(
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
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.evaluate(() => {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard)
    navigator.clipboard.writeText = async (value) => {
      await write(value)
      window.productDetailsCopiedText = value
    }
  })
  return { page, record }
}

function field(root, label, selector = '.product-attributes') {
  return root
    .locator(`${selector} dt`)
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('..')
}

async function expectCopied(page, button, value) {
  await test.step('Finish the clipboard write before reading it back', async () => {
    await page.bringToFront()
    await button.click()
    await expect
      .poll(() => page.evaluate(() => window.productDetailsCopiedText))
      .toBe(value)
  })
  // Windows stores native clipboard line endings as CRLF. The exact source
  // argument is asserted above; retain all other whitespace in the readback.
  await test.step('Verify the completed native clipboard text', async () => {
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await navigator.clipboard.readText()).replace(/\r\n/g, '\n')
        )
      )
      .toBe(value.replace(/\r\n/g, '\n'))
  })
}

async function backup(extension) {
  const result = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(result.ok, result.error).toBe(true)
  return result.data
}

test('table attributes translate, copy dimension numbers without their unit and leave row selection independent', async ({
  extension,
}) => {
  const { page, record } = await workspace(extension)
  const before = await backup(extension)
  const row = page.locator('#sheet-body tr[data-selection-key]').first()
  await expect(row.locator('.product-title')).toHaveText(
    record.snapshot.items[0].title
  )
  const specifications = field(row, 'Specifications')
  await expect(specifications.locator('.attribute-unit')).toHaveText('CM')
  await expectCopied(page, specifications.getByRole('button'), '14*65')
  await expect(row).toHaveAttribute('aria-selected', 'false')
  await expect(page.locator('.product-details-dialog')).toHaveCount(0)
  await row.focus()
  await row.press('Space')
  await specifications.getByRole('button').dblclick()
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.product-details-dialog')).toHaveCount(0)
  await expect(row.locator('.product-color-hint')).toHaveText('Gray')
  await expect(row.locator('.product-color-hint i')).toHaveCount(1)
  await page.locator('#language-toggle [data-language=es]').click()
  await expect(field(row, 'Código').getByRole('button')).toHaveText('ABC-42')
  await expect(row.locator('.product-color-hint')).toHaveText('Gris')
  await expect(row.locator('.product-title')).toHaveText(
    record.snapshot.items[0].title
  )
  await page.locator('#language-toggle [data-language=zh]').click()
  await expect(field(row, '规格').locator('.attribute-unit')).toHaveText('CM')
  await expect(row.locator('.product-color-hint')).toHaveText('灰色')
  expect((await backup(extension)).orders).toEqual(before.orders)
})

test('original product details copy exact source values and description and link to the photo and source order', async ({
  extension,
}) => {
  const { page, record } = await workspace(extension, { longDescription: true })
  const row = page.locator('#sheet-body tr[data-selection-key]').first()
  await row.locator('.product-title').dblclick()
  const details = page.getByRole('dialog', {
    name: 'Original product details',
    exact: true,
  })
  await expect(details).toBeVisible()
  await expect(details.locator('.product-details-identity')).not.toContainText(
    record.snapshot.orderId
  )
  const selected = await row.getAttribute('aria-selected')
  await expectCopied(
    page,
    field(details, '规格', '.product-original-fields').getByRole('button'),
    '14*65CM'
  )
  await expectCopied(
    page,
    details.getByRole('button', { name: 'Copy description', exact: true }),
    record.snapshot.items[0].description
  )
  await expect(details.locator('.product-original-description pre')).toHaveText(
    record.snapshot.items[0].description
  )
  await expectCopied(
    page,
    details.getByRole('button', { name: /^Copy original title:/ }),
    record.snapshot.items[0].title
  )
  await expectCopied(
    page,
    details.getByRole('button', { name: /^Copy store name:/ }),
    record.snapshot.sellerName
  )
  await expectCopied(
    page,
    details.getByRole('button', { name: /^Copy order number:/ }),
    record.snapshot.orderId
  )
  await expect(
    field(details, '颜色', '.product-original-fields').getByRole('button')
  ).toHaveText('灰色')
  await expect(row).toHaveAttribute('aria-selected', selected)
  const photoBounds = await details
    .locator('.product-photo-button')
    .evaluate((button) => {
      const outer = button.getBoundingClientRect()
      const inner = button.querySelector('img').getBoundingClientRect()
      return {
        contained:
          inner.left >= outer.left &&
          inner.top >= outer.top &&
          inner.right <= outer.right &&
          inner.bottom <= outer.bottom,
      }
    })
  expect(photoBounds.contained).toBe(true)
  await details
    .getByRole('button', { name: 'Open product photo', exact: true })
    .click()
  const photo = page.getByRole('dialog', { name: 'Product photo', exact: true })
  await expect(photo.locator('.photo-viewport img')).toHaveAttribute(
    'src',
    record.snapshot.items[0].thumbnail
  )
  await page.keyboard.press('Escape')
  await expect(photo).toHaveCount(0)
  await expect(details).toBeVisible()
  await expect(
    details.getByRole('button', { name: 'Open product photo', exact: true })
  ).toBeFocused()
  await details
    .getByRole('button', { name: 'Order details', exact: true })
    .click()
  await expect(details).toHaveCount(0)
  await expect(page.locator('#order-details')).toBeVisible()
  await expect(
    page.locator('#order-details-heading .order-reference')
  ).toHaveText(record.snapshot.orderId)
  await expect(row).toHaveAttribute('aria-selected', selected)
})

test('legacy and missing SKU fields retain their source text, with keyboard dismissal and a narrow usable details dialog', async ({
  extension,
}) => {
  const { page, record } = await workspace(extension)
  const rows = page.locator('#sheet-body tr[data-selection-key]'),
    legacy = rows.nth(1),
    minimal = rows.nth(2)
  await expect(legacy.locator('.product-title')).toHaveText('原始短款玻璃瓶')
  await expect(
    field(legacy, 'Specifications').locator('.attribute-unit')
  ).toHaveText('cm')
  await expectCopied(
    page,
    field(legacy, 'Specifications').getByRole('button'),
    '8×12'
  )
  await expect(legacy.locator('.product-color-hint')).toHaveText('White')
  await legacy.focus()
  await legacy.press('Enter')
  const details = page.getByRole('dialog', {
    name: 'Original product details',
    exact: true,
  })
  await expect(details).toBeVisible()
  await expectCopied(
    page,
    field(details, '货号', '.product-original-fields').getByRole('button'),
    'LEGACY-8'
  )
  await page.setViewportSize({ width: 390, height: 844 })
  const layout = await details.evaluate((dialog) => {
    const bounds = dialog.getBoundingClientRect()
    return {
      left: bounds.left,
      right: bounds.right,
      width: innerWidth,
      scrollWidth: dialog.scrollWidth,
      clientWidth: dialog.clientWidth,
    }
  })
  expect(layout.left).toBeGreaterThanOrEqual(0)
  expect(layout.right).toBeLessThanOrEqual(layout.width)
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
  await page.keyboard.press('Escape')
  await expect(details).toHaveCount(0)
  await expect(legacy).toBeFocused()
  await expect(minimal.locator('.product-title')).toHaveText(
    record.snapshot.items[2].description
  )
  await expect(minimal.locator('.product-attributes')).toHaveCount(0)
  await minimal.focus()
  await minimal.press('Enter')
  await expect(details).toBeVisible()
  await expect(details.locator('.product-details-photo')).toHaveCount(0)
  await expect(details.locator('.product-original-description pre')).toHaveText(
    record.snapshot.items[2].description
  )
  await expect(details.locator('.product-original-fields dt')).toHaveText([
    '单价',
    '数量',
  ])
  const bounds = await details.boundingBox()
  await page.mouse.click(Math.max(1, bounds.x - 5), Math.max(1, bounds.y + 10))
  await expect(details).toHaveCount(0)
  await expect(minimal).toBeFocused()
})

test('translated product details never rewrite saved label names or original order snapshots', async ({
  extension,
}) => {
  const { page } = await workspace(extension)
  const row = page.locator('#sheet-body tr[data-selection-key]').first()
  await row.getByRole('checkbox').check()
  await assignSelectedPurchaseCodes(page)
  const editor = await editOrderProduct(page, 0, {
    'Spanish name': 'NOMBRE MANUAL',
    'Chinese category': '手工类别',
  })
  await closeOrderProduct(editor)
  const before = await backup(extension)
  expect(before.preparations[0].groups[0].variants[0].spanishName).toBe(
    'NOMBRE MANUAL'
  )
  expect(before.preparations[0].groups[0].category).toBe('手工类别')
  await page.locator('#language-toggle [data-language=es]').click()
  await page.locator('#language-toggle [data-language=zh]').click()
  await row.focus()
  await row.press('Enter')
  const details = page.locator('.product-details-dialog')
  await expect(details).toBeVisible()
  await expect(
    field(details, '规格', '.product-original-fields').getByRole('button')
  ).toHaveText('14*65CM')
  await details
    .getByRole('button', { name: '关闭商品详情', exact: true })
    .click()
  await expect(details).toHaveCount(0)
  const after = await backup(extension)
  expect(after.orders).toEqual(before.orders)
  expect(after.preparations).toEqual(before.preparations)
})

test('original product carton context stays read-only, compact and translated at wide and narrow widths, with one Orders reconciliation route', async ({
  extension,
}) => {
  const { page, record } = await workspace(extension),
    before = await backup(extension),
    ref = { accountId: 'local', orderId: record.snapshot.orderId }
  for (const [language, editLabel] of [
    ['en', 'Edit cartons'],
    ['es', 'Editar cajas'],
    ['zh', '编辑装箱'],
  ]) {
    await page.locator(`#language-toggle [data-language=${language}]`).click()
    await page
      .locator('#sheet-body tr[data-selection-key]')
      .first()
      .press('Enter')
    const details = page.locator('.product-details-dialog'),
      carton = details.locator('.product-carton-batch-context')
    await expect(carton).toBeVisible()
    await expect(
      carton.getByRole('button', { name: editLabel, exact: true })
    ).toBeVisible()
    await expect(details.locator('details, summary')).toHaveCount(0)
    await expect(carton.locator('input,select,textarea,form')).toHaveCount(0)
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => {
        document.querySelector('meta[name="color-scheme"]').content = theme
      }, theme)
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 960 })
        const layout = await details.evaluate((dialog) => {
          const panel = dialog.querySelector('.product-carton-batch-context'),
            box = panel.getBoundingClientRect(),
            body = dialog
              .querySelector('.product-details-body')
              .getBoundingClientRect(),
            photo = dialog
              .querySelector('.product-photo-button')
              .getBoundingClientRect()
          return {
            overflow:
              dialog.scrollWidth > dialog.clientWidth ||
              panel.scrollWidth > panel.clientWidth,
            fullWidth: Math.abs(box.width - body.width),
            photo: { width: photo.width, height: photo.height },
            box: { left: box.left, right: box.right },
            controls: [...panel.querySelectorAll('button')].map((node) => {
              const { left, right } = node.getBoundingClientRect()
              return { left, right }
            }),
          }
        })
        expect(layout.overflow).toBe(false)
        expect(layout.fullWidth).toBeLessThanOrEqual(1)
        expect(layout.photo.width).toBeLessThanOrEqual(96)
        expect(layout.photo.height).toBe(layout.photo.width)
        expect(layout.controls).toHaveLength(1)
        for (const control of layout.controls) {
          expect(control.left).toBeGreaterThanOrEqual(layout.box.left)
          expect(control.right).toBeLessThanOrEqual(layout.box.right)
        }
        if (language === 'en' && width === 1280 && theme === 'dark')
          await details.screenshot({
            path: 'work/carton-details-redesign-wide.png',
          })
        if (language === 'es' && width === 390 && theme === 'light')
          await details.screenshot({
            path: 'work/carton-details-redesign-narrow.png',
          })
      }
    }
    await details.locator('.product-details-heading > button').click()
    await expect(details).toHaveCount(0)
  }
  await page.locator('#language-toggle [data-language=en]').click()
  await page
    .locator('#sheet-body tr[data-selection-key]')
    .first()
    .press('Enter')
  const details = page.locator('.product-details-dialog')
  await details
    .getByRole('button', { name: 'Edit cartons', exact: true })
    .click()
  await expect(details).toHaveCount(0)
  const grid = await openOrderReconciliation(page, ref)
  await expect(
    grid.locator('[data-action="confirm-order-cartons"]')
  ).toBeVisible()
  expect((await backup(extension)).orders).toEqual(before.orders)
  expect((await backup(extension)).cartonBatches).toEqual(before.cartonBatches)
})

test('one Orders physical draft validates complete XYZ, retains original supplied volume and retries an aborted whole confirmation without partial writes', async ({
  extension,
}) => {
  const manual = '0.123456789123456789',
    { page, record } = await workspace(extension, {
      cartonDetails: { cbm: manual },
    }),
    entryId = record.snapshot.items[0].entryId,
    ref = { accountId: 'local', orderId: record.snapshot.orderId },
    id = 'synthetic-details-physical-carton'
  await page.locator('#select-rows').click()
  await assignSelectedPurchaseCodes(page)
  // Explicit synthetic physical evidence, through the real public repository:
  // one known carton contains this complete source row, independent of old defaults.
  await extension.inspector.evaluate(
    async ({ ref, id, entryId, manual }) => {
      const repository = await window.testRepository,
        context = await repository.getOrderReconciliation(ref)
      await repository.saveOrderCartonFacts({
        ...ref,
        changes: [
          {
            after: {
              ...ref,
              id,
              count: 1,
              packingBasis: 'exact',
              labelOrigin: 'internal',
              contents: [
                {
                  orderId: ref.orderId,
                  entryId,
                  quantity: context.record.snapshot.items.find(
                    (item) => item.entryId === entryId
                  ).quantity,
                },
              ],
              groups: [],
              len: '',
              wid: '',
              ht: '',
              weight: '',
              weightBasis: 'carton',
              suppliedCbm: manual,
              volumeBasis: 'carton',
              received: null,
              loaded: null,
              provenance: {
                kind: 'manual-confirmed',
                source: 'Synthetic physical carton',
              },
            },
            expectedRevision: 0,
          },
        ],
        expectedRevisions: context.revisions,
        intentId: crypto.randomUUID(),
      })
    },
    { ref, id, entryId, manual }
  )
  const before = await backup(extension),
    grid = await openOrderReconciliation(page, ref, 'cartons'),
    row = grid.locator(`tr[data-grid-key="${id}"]`),
    dimensions = row.locator('[data-grid-column="dimensions"]'),
    weight = row.locator('[data-grid-column="weight"]'),
    confirm = grid.locator('[data-action="confirm-order-cartons"]')
  await expect(dimensions).toHaveValue('')
  await expect(weight).toHaveValue('')
  await expect(row.locator('[data-grid-column="suppliedCbm"]')).toHaveValue(
    manual
  )
  await dimensions.fill('58.5')
  await dimensions.blur()
  await expect(dimensions).toHaveAttribute('aria-invalid', 'true')
  await confirm.click()
  expect((await backup(extension)).cartonBatches).toEqual(before.cartonBatches)
  await dimensions.fill('58.5×35.2×0')
  await dimensions.blur()
  await expect(dimensions).toHaveAttribute('aria-invalid', 'true')
  expect((await backup(extension)).cartonBatches).toEqual(before.cartonBatches)
  await weight.fill('0')
  await weight.blur()
  await dimensions.fill('58.5×35.2×47')
  await dimensions.blur()
  await expect(dimensions).not.toHaveAttribute('aria-invalid', 'true')
  await expect(grid.locator('.reconciliation-summary')).toContainText(
    '0.0967824'
  )
  await page.evaluate((id) => {
    window.holdCartonSave = true
    window.failCartonSave = true
    window.cartonSaveStarted = false
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args)
      if (
        this.name === 'cartonBatches' &&
        args[0]?.id === id &&
        window.holdCartonSave
      ) {
        window.cartonSaveStarted = true
        const store = this,
          transaction = this.transaction
        const keepAlive = () => {
          if (!window.holdCartonSave) {
            if (window.failCartonSave) transaction.abort()
            return
          }
          store.get(id).onsuccess = keepAlive
        }
        keepAlive()
      }
      return request
    }
  }, id)
  await confirm.click()
  await expect
    .poll(() => page.evaluate(() => window.cartonSaveStarted))
    .toBe(true)
  await expect(confirm).toBeDisabled()
  await expect(dimensions).toBeEnabled()
  await expect(weight).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(grid).toBeVisible()
  await page.evaluate(() => {
    window.holdCartonSave = false
  })
  await expect(page.locator('.error-notice')).toBeVisible()
  await expect(confirm).toBeEnabled()
  await expect(dimensions).toHaveValue('58.5×35.2×47')
  await expect(weight).toHaveValue('0')
  expect((await backup(extension)).cartonBatches).toEqual(before.cartonBatches)
  expect((await backup(extension)).orders).toEqual(before.orders)
  expect(
    JSON.stringify((await realOrderContext(extension, ref)).draft)
  ).toContain('58.5×35.2×47')
  await page.evaluate(() => {
    window.failCartonSave = false
  })
  await confirm.click()
  await expect
    .poll(
      async () =>
        (await realOrderContext(extension, ref)).batches.find(
          (batch) => batch.id === id
        ).ht
    )
    .toBe('47')
  const saved = (await realOrderContext(extension, ref)).batches.find(
    (batch) => batch.id === id
  )
  expect(saved).toMatchObject({
    id,
    count: 1,
    len: '58.5',
    wid: '35.2',
    ht: '47',
    weight: '0',
    suppliedCbm: manual,
  })
  expect((await backup(extension)).orders).toEqual(before.orders)
  await dimensions.fill('')
  await dimensions.blur()
  await weight.fill('')
  await weight.blur()
  await expect(grid.locator('.reconciliation-summary')).toContainText(manual)
  await confirm.click()
  await expect
    .poll(
      async () =>
        (await realOrderContext(extension, ref)).batches.find(
          (batch) => batch.id === id
        ).weight
    )
    .toBe('')
  const cleared = (await realOrderContext(extension, ref)).batches.find(
    (batch) => batch.id === id
  )
  expect(cleared).toMatchObject({
    id,
    count: 1,
    len: '',
    wid: '',
    ht: '',
    weight: '',
    suppliedCbm: manual,
  })
  expect((await backup(extension)).orders[0].cartonDetails[entryId]).toEqual({
    cbm: manual,
  })
  expect((await backup(extension)).orders[0].snapshot).toEqual(record.snapshot)
})
