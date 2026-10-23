import { test, expect } from './extension-fixture.mjs'
import {
  seedSmartOrder,
  openSmartLibrary,
  createContainerThroughUI,
  libraryBackup,
  editOrderProduct,
  closeOrderProduct,
  revealOrderCard,
} from './smart-workspace-helpers.mjs'
import { revealCopyActions } from './copy-actions-helpers.mjs'

async function setup(extension) {
  const refs = []
  for (const [index, supplierId] of [
    'synthetic-z',
    'synthetic-a',
    'synthetic-z',
  ].entries())
    refs.push(
      await seedSmartOrder(extension, {
        orderId: `72000000000000000${index}`,
        supplierId,
        count: 3,
        physical: true,
      })
    )
  const page = await openSmartLibrary(extension)
  const id = await createContainerThroughUI(page, refs)
  const view = page.locator('#packing-view')
  await view.locator('[data-action="mark-all-loaded"]').click()
  await expect(view.locator('#container-content')).toHaveAttribute(
    'aria-busy',
    'false'
  )
  await view.locator('[data-view="packing-list"]').click()
  await expect(view.locator('tr[data-container-row]')).toHaveCount(9)
  return { page, view, refs, id }
}
async function setupOrderAuthoring(extension) {
  const ref = await seedSmartOrder(extension, {
    orderId: '720000000000000009',
    count: 3,
  })
  const page = await openSmartLibrary(extension)
  return { page, refs: [ref] }
}
const manifest = (extension, id) =>
  extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerManifest({ id }),
    id
  )

test('stable container ordering survives reload and copy without rewriting codes or authored arrangements', async ({
  extension,
}) => {
  const { page, view, id } = await setup(extension)
  const before = await libraryBackup(extension),
    frozen = await manifest(extension, id)
  expect(frozen.draft).toBe(true)
  const rows = view.locator('tr[data-container-row]'),
    ids = () =>
      rows.evaluateAll((nodes) =>
        nodes.map((node) => node.dataset.containerRow)
      )
  const order = await ids()
  await expect(
    view.locator(
      '.reorder-handle,.packing-arrange,[data-action="organize-packing"]'
    )
  ).toHaveCount(0)
  await page.reload()
  await expect(rows).toHaveCount(9)
  expect(await ids()).toEqual(order)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.bringToFront()
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true)
  for (const row of await rows.all()) await row.getByRole('checkbox').check()
  await revealCopyActions(page)
  await view.locator('[data-action="copy-values"]').click()
  try {
    await expect(view.locator('[data-action="copy-values"]')).toContainText(
      'Copied'
    )
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      focused: document.hasFocus(),
      errors: [...document.querySelectorAll('.error-notice')].map(
        (node) => node.textContent
      ),
      statuses: [
        ...document.querySelectorAll('#container-content [role="status"]'),
      ].map((node) => node.textContent),
    }))
    console.log('Packing copy failure diagnostic:', JSON.stringify(diagnostic))
    throw error
  }
  const values = (await page.evaluate(() => navigator.clipboard.readText()))
    .split('\r\n')
    .map((row) => row.split('\t'))
  expect(values).toHaveLength(9)
  for (const [index, product] of frozen.products.entries()) {
    expect(values[index]).toEqual([
      '',
      product.description.replace(/[\t\r\n]+/g, ' · '),
      product.price,
      product.quantity,
      product.discount,
    ])
    expect(values[index].slice(2)).toEqual(['2.00', '100', '0.00'])
  }
  await revealCopyActions(page)
  const groupCopy = view.locator('[data-action="copy-group-codes"]')
  await expect(groupCopy).toHaveAccessibleName('Copy group codes')
  await groupCopy.click()
  await expect(groupCopy).toContainText('Copied')
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).split('\r\n')
  ).toEqual([...new Set(frozen.products.map((product) => product.baseCode))])
  await revealCopyActions(page)
  await view.getByRole('button', { name: 'Copy columns', exact: true }).click()
  const picker = page.locator('.preparation-column-dialog')
  await picker
    .getByRole('button', { name: 'Clear columns', exact: true })
    .click()
  for (const name of ['Barcode', 'Quantity'])
    await picker.getByRole('checkbox', { name, exact: true }).check()
  await picker.getByRole('checkbox', { name: 'Headers', exact: true }).uncheck()
  await picker
    .getByRole('button', { name: 'Copy chosen columns', exact: true })
    .click()
  await expect(
    picker.getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible()
  const copied = (await page.evaluate(() => navigator.clipboard.readText()))
    .split('\r\n')
    .map((row) => row.split('\t'))
  expect(copied).toEqual(
    frozen.products.map((product) => [
      product.barcode,
      product.loadedQuantity || product.quantity,
    ])
  )
  expect(await manifest(extension, id)).toEqual(frozen)
  const after = await libraryBackup(extension)
  expect(after.preparations).toEqual(before.preparations)
  expect(after.issuedCodes).toEqual(before.issuedCodes)
  expect(after.orders).toEqual(before.orders)
})

test('Escape closes Packing menus and the Orders accelerator preserves independent native text selection', async ({
  extension,
}) => {
  const { page, view, refs } = await setup(extension)
  await revealCopyActions(page)
  await expect(view.locator('.copy-actions-panel:visible')).toHaveCount(1)
  await view.locator('[data-action="open-copy-menu"]').focus()
  await page.keyboard.press('Escape')
  await expect(view.locator('.copy-actions-panel:visible')).toHaveCount(0)
  await expect(view).toBeVisible()
  await page.locator('#theme-toggle').focus()
  await page.keyboard.press('Alt+Shift+o')
  await expect(page.locator('#orders-view')).toBeVisible()
  await revealOrderCard(page, refs[0])
  const orders = page.locator('#order-list [data-selection-key]')
  await orders.first().focus()
  await page.keyboard.press('Control+a')
  await expect(page.locator('#order-list [aria-selected="true"]')).toHaveCount(
    3
  )
  await page.keyboard.press('Control+d')
  await expect(page.locator('#order-list [aria-selected="true"]')).toHaveCount(
    0
  )
  const products = page.locator('#sheet-body tr[data-selection-key]')
  await products.first().focus()
  await page.keyboard.press('Control+a')
  await expect(products.locator('input[type="checkbox"]:checked')).toHaveCount(
    9
  )
  await page.locator('#theme-toggle').focus()
  await page.keyboard.press('Control+d')
  await expect(products.locator('input[type="checkbox"]:checked')).toHaveCount(
    0
  )
  const editor = await editOrderProduct(page, 0, {
    'Spanish name': 'FLORERO EDITADO',
  })
  const input = editor.getByRole('textbox', {
    name: 'Spanish name',
    exact: true,
  })
  await input.press('Control+a')
  expect(
    await input.evaluate((node) => node.selectionEnd - node.selectionStart)
  ).toBe(15)
  await closeOrderProduct(editor)
  await page.locator('#view-packing').click()
  await expect(view).toBeVisible()
})

test('source links open the exact purchase and preserve independent product selection', async ({
  extension,
}) => {
  const { page, refs } = await setup(extension)
  await page.locator('#view-orders').click()
  const card = await revealOrderCard(page, refs[0])
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await rows.first().getByRole('checkbox').check()
  const selected = await rows
    .locator('input[type="checkbox"]')
    .evaluateAll((nodes) => nodes.map((node) => node.checked))
  await expect(page.locator('#sheet-body .order-source-link')).toHaveCount(3)
  const link = page.locator(
    `#sheet-body .order-source-link[href$="orderId=${refs[0].orderId}"]`
  )
  await expect(link).toHaveAttribute(
    'href',
    new RegExp(`orderId=${refs[0].orderId}$`)
  )
  await extension.context.route('https://air.1688.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>Synthetic exact source</title>',
    })
  )
  const pending = page.waitForEvent('popup')
  await link.click()
  const popup = await pending
  await popup.waitForLoadState()
  expect(popup.url()).toContain(`orderId=${refs[0].orderId}`)
  await popup.close()
  expect(
    await rows
      .locator('input[type="checkbox"]')
      .evaluateAll((nodes) => nodes.map((node) => node.checked))
  ).toEqual(selected)
  await expect(page.locator('#order-list .order-source-link')).toHaveCount(0)
  await card.locator('.order-details-trigger').click()
  await expect(
    page.locator('#order-details .order-source-link')
  ).toHaveAttribute('href', new RegExp(`orderId=${refs[0].orderId}$`))
})

for (const [field, value, action, message] of [
  ['Chinese category', '', 'Copy carton marks', /Chinese category/i],
  [
    'Variant ending',
    'A'.repeat(30),
    'Copy barcode images',
    /too long for the label width/i,
  ],
])
  test(`${action} identifies the failing source and returns to its Orders field`, async ({
    extension,
  }) => {
    const { page, refs } = await setupOrderAuthoring(extension)
    await page.locator('#view-orders').click()
    const ref = { ...refs[0], entryId: '2001' },
      editor = await editOrderProduct(page, ref, { [field]: value })
    await closeOrderProduct(editor)
    const clear = page.locator('#clear-rows')
    if (await clear.isEnabled()) await clear.click()
    await expect(
      page.locator(
        '#sheet-body tr[data-selection-key] input[type="checkbox"]:checked'
      )
    ).toHaveCount(0)
    const target = page.locator(
      `#sheet-body tr[data-selection-key=${JSON.stringify(JSON.stringify(['local', ref.orderId, ref.entryId]))}]`
    )
    await target.getByRole('checkbox').check()
    const before = await libraryBackup(extension)
    await revealCopyActions(page)
    await page.getByRole('button', { name: action, exact: true }).click()
    const notice = page.locator('.error-notice:visible').last()
    await expect(notice).toContainText(message)
    await expect(notice).toContainText(ref.orderId)
    await expect(notice.locator('img')).toHaveCount(1)
    await notice
      .getByRole('button', {
        name: /Edit in Orders|Show affected field|Add Chinese category/,
      })
      .click()
    const corrected = page.locator('dialog[data-action="edit-order-product"]')
    await expect(
      corrected.getByRole('textbox', { name: field, exact: true })
    ).toBeFocused()
    expect((await libraryBackup(extension)).preparations).toEqual(
      before.preparations
    )
  })

test('filtering a selected subset leaves hidden order revisions, manifest membership and stable row slots unchanged', async ({
  extension,
}) => {
  const { page, view, id, refs } = await setup(extension)
  const before = await libraryBackup(extension),
    frozen = await manifest(extension, id)
  const order = await view
    .locator('tr[data-container-row]')
    .evaluateAll((rows) => rows.map((row) => row.dataset.containerRow))
  await view
    .locator('tr[data-container-row]')
    .first()
    .getByRole('checkbox')
    .check()
  const filter = view.getByRole('searchbox', {
    name: 'Filter container display',
    exact: true,
  })
  await filter.fill(refs[0].orderId)
  await expect(view.locator('tr[data-container-row]')).toHaveCount(3)
  await filter.fill('')
  await expect(view.locator('tr[data-container-row]')).toHaveCount(9)
  expect(
    await view
      .locator('tr[data-container-row]')
      .evaluateAll((rows) => rows.map((row) => row.dataset.containerRow))
  ).toEqual(order)
  await expect(
    view.locator('tr[data-container-row]').first().getByRole('checkbox')
  ).toBeChecked()
  expect(await manifest(extension, id)).toEqual(frozen)
  expect((await libraryBackup(extension)).preparations).toEqual(
    before.preparations
  )
  await page.reload()
  expect(await manifest(extension, id)).toEqual(frozen)
})

test('a stale loading revision rejects without rewriting another tab and live refresh retains its actual saved decisions', async ({
  extension,
}) => {
  const { page, view, id } = await setup(extension)
  const before = await libraryBackup(extension)
  await view.locator('[data-view="loading"]').click()
  await view
    .locator('.container-order [data-action="expand-container-order"]')
    .first()
    .click()
  const row = view.locator('tr[data-container-row]').first(),
    unitId = await row.getAttribute('data-container-row')
  const staleRevision = await extension.inspector.evaluate(
    async ({ id, unitId }) => {
      const repository = await window.testRepository,
        view = await repository.getContainerView({ id })
      await repository.setContainerLoading({
        id,
        decisions: [{ cartonId: unitId, state: 'left-behind' }],
        expectedRevision: view.container.revision,
        intentId: crypto.randomUUID(),
      })
      return view.container.revision
    },
    { id, unitId }
  )
  const newer = await manifest(extension, id)
  // Advisory cross-tab refresh may already replace the displayed revision.
  // Submit the captured stale intent explicitly, without disabling that refresh.
  const rejection = await extension.inspector.evaluate(
    async ({ id, unitId, staleRevision }) => {
      const repository = await window.testRepository
      try {
        await repository.setContainerLoading({
          id,
          decisions: [{ cartonId: unitId, state: 'unconfirmed' }],
          expectedRevision: staleRevision,
          intentId: crypto.randomUUID(),
        })
        return null
      } catch (error) {
        return error.message
      }
    },
    { id, unitId, staleRevision }
  )
  expect(rejection).toMatch(/changed|stale|revision/i)
  expect(await manifest(extension, id)).toEqual(newer)
  const savedRow = view.locator(
    `tr[data-container-row=${JSON.stringify(unitId)}]`
  )
  await expect(savedRow).toContainText('Left behind')
  const after = await libraryBackup(extension)
  expect(after.orders).toEqual(before.orders)
  expect(after.preparations).toEqual(before.preparations)
  expect(after.issuedCodes).toEqual(before.issuedCodes)
  await page.reload()
  await view
    .locator('.container-order [data-action="expand-container-order"]')
    .first()
    .click()
  await expect(savedRow).toContainText('Left behind')
  expect(await manifest(extension, id)).toEqual(newer)
  await expect(
    view.locator('.reorder-handle,[data-action="organize-packing"]')
  ).toHaveCount(0)
})

test('an unresolved size output error names the product and focuses its Orders size field without changing saved evidence', async ({
  extension,
}) => {
  const { page, refs } = await setupOrderAuthoring(extension)
  await extension.inspector.evaluate(async (ref) => {
    const repository = await window.testRepository,
      context = await repository.getOrderReconciliation(ref),
      preparation = structuredClone(context.preparation)
    preparation.groups[0].variants[0].size = '未知尺寸'
    preparation.groups[0].variants[0].needsSizeMapping = true
    await repository.savePreparations([preparation], {
      expectedRevisions: [preparation.revision],
    })
  }, refs[0])
  await page.locator('#view-orders').click()
  await page.reload()
  const clear = page.locator('#clear-rows')
  if (await clear.isEnabled()) await clear.click()
  await expect(
    page.locator(
      '#sheet-body tr[data-selection-key] input[type="checkbox"]:checked'
    )
  ).toHaveCount(0)
  await page
    .locator(
      `#sheet-body tr[data-selection-key=${JSON.stringify(JSON.stringify(['local', refs[0].orderId, '2001']))}]`
    )
    .getByRole('checkbox')
    .check()
  const before = await libraryBackup(extension)
  await revealCopyActions(page)
  await page
    .getByRole('button', { name: 'Copy barcode images', exact: true })
    .click()
  const notice = page.locator('.error-notice:visible').last()
  await expect(notice).toContainText(/size/i)
  await expect(notice).toContainText(refs[0].orderId)
  await expect(notice.locator('img')).toHaveCount(1)
  await notice
    .getByRole('button', {
      name: /Edit in Orders|Map size code|Show affected field/,
    })
    .click()
  await expect(
    page
      .locator('.product-authoring-dialog')
      .getByRole('textbox', { name: 'Size ending', exact: true })
  ).toBeFocused()
  expect((await libraryBackup(extension)).preparations).toEqual(
    before.preparations
  )
})
