import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import {
  openOrderReconciliation,
  realOrderContext,
} from './smart-workspace-helpers.mjs'

async function seed(extension, count = 500) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const original = record.snapshot.items[0]
  record.snapshot.items = Array.from({ length: count }, (_, index) => ({
    ...original,
    entryId: String(800000 + index),
    title: `Continuous product ${index + 1}`,
    description: `Continuous product ${index + 1}\n${'Long supplier specifications '.repeat(index % 7)}`,
    quantity: '1',
    price: '10.00',
    sourceDiscount: '0.00',
    allocatedDiscount: '0.00',
    discount: '0.00',
  }))
  record.changedEntryIds = []
  record.snapshot.totals = {
    goodsGross: `${count * 10}.00`,
    goodsNet: `${count * 10}.00`,
    payable: `${count * 10}.00`,
    shipping: '0.00',
    sourceDiscount: '0.00',
    orderAdjustment: '0.00',
  }
  const result = await extension.inspector.evaluate(
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
  expect(result.ok, result.error).toBe(true)
  const page = await extension.context.newPage()
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    100
  )
  return { page, record }
}

test('continuous physical rows retain active decimal drafts across the whole list and save after recycling', async ({
  extension,
}, testInfo) => {
  // This case seeds 500 physical records and captures their virtual editor.
  test.setTimeout(60_000)
  const { page, record } = await seed(extension),
    ref = {
      accountId: record.snapshot.accountId || 'local',
      orderId: record.snapshot.orderId,
    }
  // Declared synthetic physical evidence: one exact carton for each source unit.
  // Product measurement columns are read-only; physical weights belong here.
  const original = await extension.inspector.evaluate(async (ref) => {
    const repository = await window.testRepository,
      context = await repository.getOrderReconciliation(ref),
      draft = window.testPlanner.createReconciliationDraft(context)
    draft.cartons = context.record.snapshot.items.map((item, index) => ({
      ...ref,
      id: `continuous-carton-${index + 1}`,
      cartonNumber: String(index + 1),
      count: 1,
      packingBasis: 'exact',
      labelOrigin: 'reported',
      contents: [
        { orderId: ref.orderId, entryId: item.entryId, quantity: '1' },
      ],
      unresolvedContents: [],
      weight: '',
      weightBasis: 'carton',
      draftKind: 'manual',
    }))
    await repository.confirmOrderCartons({
      ...ref,
      draft,
      expectedRevisions: context.revisions,
    })
    return repository.getOrderReconciliation(ref)
  }, ref)
  expect(original.batches).toHaveLength(500)
  expect(original.record.snapshot).toEqual(record.snapshot)
  const grid = await openOrderReconciliation(page, ref, 'cartons'),
    firstBatch = original.batches[0],
    lastBatch = original.batches.at(-1),
    first = grid.locator(`tr[data-grid-key=${JSON.stringify(firstBatch.id)}]`),
    weight = first.locator('[data-grid-column="weight"]'),
    scroller = grid.locator('.smart-grid-scroll')
  await expect(grid.locator('tr[data-grid-key]')).toHaveCount(100)
  await weight.fill('12..')
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  const last = grid.locator(`tr[data-grid-key=${JSON.stringify(lastBatch.id)}]`)
  await expect(last).toBeAttached()
  await expect(last).toHaveAttribute('aria-rowindex', '501')
  await expect(last.locator('.carton-reference-text')).toHaveText(
    lastBatch.cartonNumber
  )
  await expect(weight).toBeFocused()
  await expect(weight).toHaveValue('12..')
  expect(await grid.locator('tr[data-grid-key]').count()).toBeLessThanOrEqual(
    101
  )
  const rawKey = JSON.stringify([firstBatch.id, 'weight'])
  await expect
    .poll(
      async () =>
        (await realOrderContext(extension, ref)).draft?.value?.rawCells?.[
          rawKey
        ]
    )
    .toBe('12..')
  const invalid = await realOrderContext(extension, ref)
  expect(invalid.batches).toEqual(original.batches)
  expect(invalid.record.snapshot).toEqual(original.record.snapshot)
  await weight.fill('12.5')
  await testInfo.attach('valid-input-focus.json', {
    body: JSON.stringify(
      await first.evaluateAll((rows) => ({
        rowCount: rows.length,
        focused: document.activeElement?.outerHTML,
        cell: rows[0]?.querySelector('[data-grid-column="weight"]')?.outerHTML,
        scrollTop: document.querySelector(
          '#orders-cartons-view .smart-grid-scroll'
        )?.scrollTop,
        visibleKeys: [
          ...document.querySelectorAll(
            '#orders-cartons-view tr[data-grid-key]'
          ),
        ].map((row) => row.dataset.gridKey),
      }))
    ),
    contentType: 'application/json',
  })
  await expect(weight).toBeFocused()
  await weight.blur()
  await grid.locator('[data-action="confirm-order-cartons"]').click()
  await expect
    .poll(
      async () =>
        (await realOrderContext(extension, ref)).batches.find(
          (batch) => batch.id === firstBatch.id
        )?.weight
    )
    .toBe('12.5')
  const saved = await realOrderContext(extension, ref)
  expect(saved.batches.filter((batch) => batch.id !== firstBatch.id)).toEqual(
    original.batches.filter((batch) => batch.id !== firstBatch.id)
  )
  expect(saved.record.snapshot).toEqual(original.record.snapshot)
  expect(saved.record.cartonDetails).toEqual(original.record.cartonDetails)
  await scroller.evaluate((element) => {
    element.scrollTop = 0
  })
  await expect(weight).toHaveValue('12.5')
  await expect(grid.locator('tr[data-grid-key]')).toHaveCount(100)
  await page.reload()
  const reloaded = await openOrderReconciliation(page, ref, 'cartons')
  await expect(
    reloaded.locator(
      `tr[data-grid-key=${JSON.stringify(firstBatch.id)}] [data-grid-column="weight"]`
    )
  ).toHaveValue('12.5')
  await expect(reloaded.locator('tr[data-grid-key]')).toHaveCount(100)
  expect((await realOrderContext(extension, ref)).record.snapshot).toEqual(
    original.record.snapshot
  )
})

test('keyboard reaches every product and shift selection crosses recycled rows with full totals', async ({
  extension,
}) => {
  const { page, record } = await seed(extension)
  const first = page.locator('#sheet-body tr[data-selection-key]').first()
  await first.focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Control+End')
  const last = page.locator(
    `#sheet-body [data-selection-key=${JSON.stringify(JSON.stringify([record.snapshot.accountId, record.snapshot.orderId, '800499']))}]`
  )
  await expect(last).toBeFocused()
  await expect(last).toBeInViewport()
  await last.getByRole('checkbox').click({ modifiers: ['Shift'] })
  await expect(page.locator('#selection-summary')).toContainText('500 selected')
  await last.focus()
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Control+d')
  await first.getByRole('checkbox').check()
  await expect(page.locator('#selection-summary')).toContainText('1 selected')
  await first.focus()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Control+d')
  await last.getByRole('checkbox').check()
  await last.focus()
  await page.keyboard.press('Control+Home')
  await first.getByRole('checkbox').click({ modifiers: ['Shift'] })
  await expect(page.locator('#selection-summary')).toContainText('500 selected')
  await expect(
    page.locator('#product-selection-totals [data-selection-total="gross"] dd')
  ).toHaveText('¥ 5,000.00')
  expect(
    await page.locator('#sheet-body tr[data-selection-key]').count()
  ).toBeLessThanOrEqual(101)
  await page.locator('#search').fill('Continuous product 500')
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    1
  )
  await expect(page.locator('#sheet-body .row-number')).toHaveText('1')
  await expect(page.locator('.virtual-table-spacer')).toHaveCount(0)
})

test('resizing a long table keeps the current product and its scroll position', async ({
  extension,
}) => {
  const { page } = await seed(extension)
  await page.setViewportSize({ width: 1400, height: 900 })
  const scroller = page.locator('.table-scroll')
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2
  })
  await expect(
    page
      .locator('#sheet-body tr[data-selection-key]')
      .first()
      .locator('.row-number')
  ).not.toHaveText('1')
  const anchor = await scroller.evaluate((element) => {
    const top =
      element.getBoundingClientRect().top +
      element.querySelector('thead').getBoundingClientRect().height
    const row = [...element.querySelectorAll('[data-selection-key]')].find(
      (node) => node.getBoundingClientRect().bottom > top
    )
    return {
      key: row.dataset.selectionKey,
      top: row.getBoundingClientRect().top - top,
    }
  })
  await page.setViewportSize({ width: 900, height: 900 })
  const row = page.locator(
    `#sheet-body [data-selection-key=${JSON.stringify(anchor.key)}]`
  )
  await expect(row).toBeAttached()
  await expect
    .poll(async () => {
      const viewport = await scroller.boundingBox()
      const header = await scroller.locator('thead').boundingBox()
      return Math.abs(
        (await row.boundingBox()).y - viewport.y - header.height - anchor.top
      )
    })
    .toBeLessThanOrEqual(3)
  expect(
    await page.locator('#sheet-body tr[data-selection-key]').count()
  ).toBeLessThanOrEqual(101)
})
