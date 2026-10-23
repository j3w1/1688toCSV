import { test, expect } from './extension-fixture.mjs'
import {
  seedSmartOrder,
  openSmartLibrary,
  createContainerThroughUI,
  libraryBackup,
  editOrderProduct,
  closeOrderProduct,
  sealContainerThroughUI,
} from './smart-workspace-helpers.mjs'

async function setup(extension) {
  const refs = []
  for (const orderId of ['710000000000000001', '710000000000000002'])
    refs.push(await seedSmartOrder(extension, { orderId, physical: true }))
  const page = await openSmartLibrary(extension)
  const id = await createContainerThroughUI(page, refs)
  return { page, refs, id, view: page.locator('#packing-view') }
}
const current = (extension, id) =>
  extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerView({ id }),
    id
  )
const immutableGoods = ({
  orders,
  preparations,
  issuedCodes,
  cartonBatches,
}) => ({ orders, preparations, issuedCodes, cartonBatches })

test('pointer, keyboard and touch expose whole-order removal without product trash, drag or Organize controls', async ({
  extension,
}) => {
  const { page, view, id } = await setup(extension)
  const before = await libraryBackup(extension)
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(
      view.locator(
        '.reorder-handle,.packing-item-actions,.packing-remove-button,[data-action="organize-packing"],[data-action="remove-product"]'
      )
    ).toHaveCount(0)
    await expect(
      view.locator('[data-action="remove-container-order"]')
    ).toHaveCount(2)
    const remove = view
      .locator('[data-action="remove-container-order"]')
      .first()
    await remove.scrollIntoViewIfNeeded()
    const box = await remove.boundingBox()
    expect(box.width).toBeGreaterThanOrEqual(24)
    expect(box.height).toBeGreaterThanOrEqual(24)
  }
  await view.locator('[data-action="remove-container-order"]').first().focus()
  await page.keyboard.press('Enter')
  await expect
    .poll(async () => (await current(extension, id)).orders.length)
    .toBe(1)
  expect(immutableGoods(await libraryBackup(extension))).toEqual(
    immutableGoods(before)
  )
  const touch = await extension.context.newPage()
  await touch.setViewportSize({ width: 390, height: 844 })
  await touch.goto(page.url())
  const button = touch.locator('[data-action="remove-container-order"]')
  // The pointer-event path used by touch remains available without hovering.
  await button.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    isPrimary: true,
  })
  await button.click()
  await expect
    .poll(async () => (await current(extension, id)).orders.length)
    .toBe(0)
  expect(immutableGoods(await libraryBackup(extension))).toEqual(
    immutableGoods(before)
  )
})

test('physical/output checkboxes select independently and never change membership or source edits', async ({
  extension,
}) => {
  const { page, view, id } = await setup(extension)
  const before = await libraryBackup(extension)
  await view
    .locator('.container-order [data-action="expand-container-order"]')
    .first()
    .click()
  const rows = view.locator('tr[data-container-row]')
  await expect(rows).toHaveCount(6)
  await rows.nth(0).getByRole('checkbox').check()
  await rows.nth(1).getByRole('checkbox').check()
  await rows.nth(0).getByRole('checkbox').uncheck()
  await expect(rows.nth(1).getByRole('checkbox')).toBeChecked()
  await rows.nth(1).locator('td').nth(1).click()
  const details = page.locator('.container-carton-details')
  await expect(details).toBeVisible()
  await expect(details.locator('input,textarea,select')).toHaveCount(0)
  await details.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(rows.nth(1).getByRole('checkbox')).toBeChecked()
  expect((await current(extension, id)).orders).toHaveLength(2)
  expect(immutableGoods(await libraryBackup(extension))).toEqual(
    immutableGoods(before)
  )
})

test('removing a whole order releases its draft reservation while retaining authored names, source rows and code owners', async ({
  extension,
}) => {
  const { page, view, refs, id } = await setup(extension)
  await page.locator('#view-orders').click()
  const editor = await editOrderProduct(
    page,
    { ...refs[0], entryId: '2001' },
    { 'Spanish name': 'KEPT AUTHORING' }
  )
  await closeOrderProduct(editor)
  const before = await libraryBackup(extension)
  await page.locator('#view-packing').click()
  await view
    .locator('.container-order')
    .filter({ hasText: refs[0].orderId })
    .locator('[data-action="remove-container-order"]')
    .click()
  await expect
    .poll(async () =>
      (await current(extension, id)).orders.map((order) => order.orderId)
    )
    .toEqual([refs[1].orderId])
  expect(immutableGoods(await libraryBackup(extension))).toEqual(
    immutableGoods(before)
  )
  // Inclusion in a second real draft proves release; the kept sibling stays reserved.
  const second = await createContainerThroughUI(
    page,
    [refs[0]],
    'Released order destination'
  )
  expect(
    (await current(extension, second)).orders.map((order) => order.orderId)
  ).toEqual([refs[0].orderId])
  expect(
    (await current(extension, id)).orders.map((order) => order.orderId)
  ).toEqual([refs[1].orderId])
  expect(immutableGoods(await libraryBackup(extension))).toEqual(
    immutableGoods(before)
  )
})

test('removing the final order preserves an empty named draft and reinclusion restores the same physical identities', async ({
  extension,
}) => {
  const { page, view, refs, id } = await setup(extension)
  const before = await current(extension, id),
    baseline = await libraryBackup(extension)
  for (let index = 0; index < refs.length; index++) {
    await view.locator('[data-action="remove-container-order"]').first().click()
    await expect(
      view.locator('[data-action="remove-container-order"]')
    ).toHaveCount(refs.length - index - 1)
  }
  const empty = await current(extension, id)
  expect(empty.container.id).toBe(id)
  expect(empty.orders).toEqual([])
  expect(empty.cartons).toEqual([])
  await page.reload()
  await expect(view.locator('[data-action="choose-container"]')).toHaveValue(id)
  await view.locator('[data-action="include-container-orders"]').click()
  const inclusion = page.locator('.container-inclusion-dialog')
  for (const ref of refs)
    await inclusion
      .locator(`[data-order-id="${ref.orderId}"]`)
      .getByRole('checkbox')
      .check()
  await inclusion.locator('[data-action="confirm-container-orders"]').click()
  await expect(inclusion).toBeHidden()
  const rejoined = await current(extension, id)
  expect(rejoined.cartons.map((carton) => carton.id).sort()).toEqual(
    before.cartons.map((carton) => carton.id).sort()
  )
  expect(
    rejoined.cartons.every((carton) => carton.state === 'unconfirmed')
  ).toBe(true)
  expect(immutableGoods(await libraryBackup(extension))).toEqual(
    immutableGoods(baseline)
  )
})

test('loading reset is reversible and sealed membership requires amendment instead of product removal', async ({
  extension,
}) => {
  const { page, view, id } = await setup(extension)
  const before = await libraryBackup(extension)
  await view.locator('[data-action="mark-all-loaded"]').click()
  await expect
    .poll(async () =>
      (await current(extension, id)).cartons.every(
        (carton) => carton.state === 'loaded'
      )
    )
    .toBe(true)
  await view.locator('[data-action="undo-container-loading"]').click()
  await expect
    .poll(async () =>
      (await current(extension, id)).cartons.every(
        (carton) => carton.state === 'unconfirmed'
      )
    )
    .toBe(true)
  await expect(
    view.locator('[data-action="undo-container-loading"]')
  ).toBeDisabled()
  await view.locator('[data-action="redo-container-loading"]').click()
  await sealContainerThroughUI(page, { markAll: false })
  await expect(
    view.locator('[data-action="remove-container-order"]')
  ).toHaveCount(0)
  await expect(view.locator('[data-action="mark-all-loaded"]')).toBeHidden()
  await expect(view.locator('[data-action="amend-container"]')).toBeEnabled()
  const sealed = await extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerManifest({ id }),
    id
  )
  const rejection = await extension.inspector.evaluate(async (id) => {
    const repository = await window.testRepository,
      view = await repository.getContainerView({ id }),
      cartonId = view.cartons[0]?.id
    if (typeof cartonId !== 'string' || !cartonId)
      throw new Error(
        'The synthetic sealed fixture needs a physical carton ID.'
      )
    try {
      await repository.setContainerLoading({
        id,
        decisions: [{ cartonId, state: 'unconfirmed' }],
        expectedRevision: view.container.revision,
        intentId: crypto.randomUUID(),
      })
      return null
    } catch (error) {
      return error.message
    }
  }, id)
  expect(rejection).toMatch(/sealed|amend|draft/i)
  expect(
    await extension.inspector.evaluate(
      async (id) => (await window.testRepository).getContainerManifest({ id }),
      id
    )
  ).toEqual(sealed)
  expect(immutableGoods(await libraryBackup(extension))).toEqual(
    immutableGoods(before)
  )
})
