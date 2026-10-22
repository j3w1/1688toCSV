import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  editOrderProduct,
  closeOrderProduct,
  libraryBackup,
} from './smart-workspace-helpers.mjs'
import {
  createPreparation,
  allocatePreparation,
} from '../../src/packing-model.js'

test('one large Orders group keeps full logical selection and every source variant across virtual scrolling and invalid contextual code edits', async ({
  extension,
}) => {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const original = record.snapshot.items[0],
    count = 250
  record.changedEntryIds = []
  record.snapshot.sellerMemberLogin = 'continuous-variant-supplier'
  record.snapshot.items = Array.from({ length: count }, (_, index) => ({
    ...original,
    entryId: String(900000 + index),
    title: 'Synthetic continuous variants',
    description: `Synthetic continuous variants\nColor: Style ${index}`,
    productNumber: 'CONTINUOUS',
    skuProperties: [
      { label: '颜色', value: `Style ${index}`, raw: `颜色：Style ${index}` },
    ],
    quantity: '1',
    price: '10.00',
    sourceDiscount: '0.00',
    allocatedDiscount: '0.00',
    discount: '0.00',
  }))
  record.snapshot.totals = {
    goodsGross: '2500.00',
    goodsNet: '2500.00',
    payable: '2500.00',
    shipping: '0.00',
    sourceDiscount: '0.00',
    orderAdjustment: '0.00',
  }
  const draft = createPreparation(record.snapshot, '2026-10')
  expect(draft.groups).toHaveLength(1)
  expect(draft.groups[0].variants).toHaveLength(count)
  Object.assign(draft.groups[0], {
    spanishName: 'PRODUCTOS',
    category: '产品',
    naming: {
      spanishName: { source: 'manual', value: 'PRODUCTOS' },
      category: { source: 'manual', value: '产品' },
    },
  })
  const allocated = allocatePreparation(draft, [], [], {
    snapshot: record.snapshot,
  })
  const preparation = { ...allocated.preparation, revision: 1 }
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    {
      format: '1688-order-library',
      version: 4,
      exportedAt: '2026-10-21T08:00:00.000Z',
      orders: [record],
      history: [],
      images: [],
      preparations: [preparation],
      allocations: allocated.allocations,
      issuedCodes: allocated.issuedCodes,
      cartonBatches: [],
    }
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const rows = page.locator('#sheet-body tr[data-selection-key]'),
    scroll = page.locator('.table-scroll')
  await expect(rows).toHaveCount(100)
  await expect(page.locator('#sheet-body').locator('..')).toHaveAttribute(
    'aria-rowcount',
    '251'
  )
  const sourceKey = (item) =>
      JSON.stringify(['local', record.snapshot.orderId, item.entryId]),
    sourceRow = (item) =>
      page.locator(
        `#sheet-body tr[data-selection-key=${JSON.stringify(sourceKey(item))}]`
      ),
    first = sourceRow(record.snapshot.items[0]),
    last = sourceRow(record.snapshot.items.at(-1))
  await first.focus()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+End')
  await expect(last).toBeFocused()
  await expect(page.locator('#selection-summary')).toContainText('250 selected')
  expect(await rows.count()).toBeLessThanOrEqual(101)
  await page.keyboard.press('Control+Home')
  await expect(first).toBeFocused()
  const editor = await editOrderProduct(page, 0),
    ending = editor.locator('[data-authoring-field="variant-ending"]'),
    originalInput = await ending.elementHandle(),
    firstId = preparation.groups[0].variants[0].id
  await ending.fill('12..')
  await ending.blur()
  await expect(ending).toHaveAttribute('aria-invalid', 'true')
  const savedBefore = await libraryBackup(extension)
  expect(
    savedBefore.preparations[0].groups[0].variants.find(
      (variant) => variant.id === firstId
    ).variantSuffix
  ).toBe(preparation.groups[0].variants[0].variantSuffix)
  await ending.focus()
  await scroll.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await expect(last).toBeAttached()
  await expect(ending).toBeFocused()
  await expect(ending).toHaveValue('12..')
  expect(
    await ending.evaluate((node, original) => node === original, originalInput)
  ).toBe(true)
  expect(await rows.count()).toBeLessThanOrEqual(101)
  await ending.fill('ZZ')
  await closeOrderProduct(editor)
  await expect
    .poll(
      async () =>
        (
          await libraryBackup(extension)
        ).preparations[0].groups[0].variants.find(
          (variant) => variant.id === firstId
        ).variantSuffix
    )
    .toBe('ZZ')
  await scroll.evaluate((node) => {
    node.scrollTop = 0
  })
  await expect(first).toBeAttached()
  await expect(first.getByRole('checkbox')).toBeChecked()
  await expect(page.locator('#selection-summary')).toContainText('250 selected')
  const saved = await libraryBackup(extension)
  expect(saved.orders[0].snapshot).toEqual(record.snapshot)
  expect(saved.cartonBatches).toEqual([])
  expect(saved.preparations[0].groups[0].variants.slice(1)).toEqual(
    preparation.groups[0].variants.slice(1)
  )
})
