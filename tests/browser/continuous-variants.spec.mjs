import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  createPreparation,
  allocatePreparation,
} from '../../src/packing-model.js'

test('one large packing group scrolls every variant with bounded rows, full selection and retained invalid code drafts', async ({
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
  await page
    .getByRole('button', { name: 'Prepare packing list', exact: true })
    .click()
  const view = page.locator('.preparation-workspace'),
    card = view.locator('.preparation-group'),
    rows = view.locator('tr[data-variant-id]'),
    scroll = card.locator('.variant-scroll')
  await expect(rows).toHaveCount(100)
  await expect(
    view.getByRole('button', { name: /^(Previous|Next) variants$/ })
  ).toHaveCount(0)
  await expect(card.locator('.variants')).toHaveAttribute(
    'aria-rowcount',
    '251'
  )
  const firstId = preparation.groups[0].variants[0].id,
    lastId = preparation.groups[0].variants.at(-1).id
  const first = view.locator(`[data-variant-id="${firstId}"]`),
    last = view.locator(`[data-variant-id="${lastId}"]`)
  await first.focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Shift+End')
  await expect(last).toBeFocused()
  await expect(view.locator('.preparation-copy-scope')).toHaveText(
    '250 selected products · 1 orders'
  )
  expect(await rows.count()).toBeLessThanOrEqual(101)
  await page.keyboard.press('Control+Home')
  await expect(first).toBeFocused()
  await expect(
    first.getByRole('textbox', {
      name: 'Weight (kg/box)',
      exact: true,
    })
  ).toHaveCount(0)
  const ending = first.getByRole('textbox', {
    name: `Variant code ${firstId}`,
    exact: true,
  })
  await ending.fill('12..')
  await scroll.evaluate((node) => (node.scrollTop = node.scrollHeight))
  await expect(last).toBeAttached()
  await expect(ending).toBeFocused()
  await expect(ending).toHaveValue('12..')
  await expect(ending).toHaveAttribute('aria-invalid', 'true')
  expect(await rows.count()).toBeLessThanOrEqual(101)
  await ending.fill('ZZ')
  await view
    .getByRole('heading', { name: 'Prepare packing list', exact: true })
    .click()
  await expect
    .poll(async () => {
      const response = await extension.inspector.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
      )
      expect(response.ok, response.error).toBe(true)
      return response.data.preparations[0].groups[0].variants.find(
        (variant) => variant.id === firstId
      ).variantSuffix
    })
    .toBe('ZZ')
  await scroll.evaluate((node) => (node.scrollTop = 0))
  await expect(
    first.getByRole('textbox', { name: `Variant code ${firstId}`, exact: true })
  ).toHaveValue('ZZ')
  await expect(view.locator('.preparation-copy-scope')).toHaveText(
    '250 selected products · 1 orders'
  )
  const saved = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(saved.ok, saved.error).toBe(true)
  expect(saved.data.orders[0].snapshot).toEqual(record.snapshot)
  expect(saved.data.cartonBatches).toEqual([])
})
