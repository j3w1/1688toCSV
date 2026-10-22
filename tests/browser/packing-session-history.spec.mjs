import { test, expect, holdPreparationWrites } from './extension-fixture.mjs'
import {
  seedSmartOrder,
  openSmartLibrary,
  libraryBackup,
  editOrderProduct,
  closeOrderProduct,
  shareOrderBarcode,
  createContainerThroughUI,
  sealContainerThroughUI,
  openOrderReconciliation,
  realOrderContext,
} from './smart-workspace-helpers.mjs'

async function setup(extension, { count = 1, physical = false } = {}) {
  const refs = []
  for (let index = 0; index < count; index++)
    refs.push(
      await seedSmartOrder(extension, {
        orderId: `73000000000000000${index}`,
        physical,
      })
    )
  const page = await openSmartLibrary(extension)
  return { page, refs, before: await libraryBackup(extension) }
}
const groups = (data) => data.preparations.map((prep) => prep.groups)
const editor = (page) =>
  page.locator('dialog[data-action="edit-order-product"]')
async function travel(page, direction) {
  await editor(page)
    .getByRole('button', { name: direction, exact: true })
    .click()
  await expect(editor(page)).toBeVisible()
}
const context = (extension, id, revisionId) =>
  extension.inspector.evaluate(
    async ({ id, revisionId }) =>
      (await window.testRepository).getContainerManifest({ id, revisionId }),
    { id, revisionId }
  )
const viewState = (extension, id) =>
  extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerView({ id }),
    id
  )

test('Orders category typing and code roundtrips remain undoable after every autosave', async ({
  extension,
}) => {
  const { page, before } = await setup(extension)
  await editOrderProduct(page, 0, { 'Chinese category': '陶瓷' })
  await expect
    .poll(
      async () =>
        (await libraryBackup(extension)).preparations[0].groups[0].category
    )
    .toBe('陶瓷')
  await editor(page)
    .getByRole('textbox', { name: 'Product code', exact: true })
    .fill('CE26099999')
  await expect
    .poll(
      async () =>
        (await libraryBackup(extension)).preparations[0].groups[0].baseCode
    )
    .toBe('CE26099999')
  await editor(page)
    .getByRole('textbox', { name: 'Product code', exact: true })
    .press('Tab')
  await editor(page)
    .getByRole('textbox', { name: 'Product code', exact: true })
    .fill(before.preparations[0].groups[0].baseCode)
  await expect
    .poll(
      async () =>
        (await libraryBackup(extension)).preparations[0].groups[0].baseCode
    )
    .toBe(before.preparations[0].groups[0].baseCode)
  await editor(page)
    .getByRole('textbox', { name: 'Product code', exact: true })
    .press('Tab')
  await travel(page, 'Undo')
  await expect(
    editor(page).getByRole('textbox', { name: 'Product code', exact: true })
  ).toHaveValue('CE26099999')
  await travel(page, 'Undo')
  await expect(
    editor(page).getByRole('textbox', { name: 'Product code', exact: true })
  ).toHaveValue(before.preparations[0].groups[0].baseCode)
  await travel(page, 'Undo')
  expect(groups(await libraryBackup(extension))).toEqual(groups(before))
  for (let index = 0; index < 3; index++) await travel(page, 'Redo')
  expect(
    (await libraryBackup(extension)).preparations[0].groups[0].category
  ).toBe('陶瓷')
  expect((await libraryBackup(extension)).orders).toEqual(before.orders)
})

test('confirmed size handling and saved suffix edits undo and redo without changing unrelated source rows', async ({
  extension,
}) => {
  const { page, before } = await setup(extension)
  await editOrderProduct(page, 0, { 'Size ending': 'XL' })
  await closeOrderProduct(editor(page))
  await editOrderProduct(page, 0)
  await editor(page)
    .getByRole('button', { name: 'No size difference', exact: true })
    .click()
  const review = page.getByRole('dialog', {
    name: 'Change size handling?',
    exact: true,
  })
  await expect(review).toBeVisible()
  await review
    .getByRole('button', { name: 'Apply size handling', exact: true })
    .click()
  await expect(
    editor(page).getByRole('textbox', { name: 'Size ending', exact: true })
  ).toHaveValue('')
  const cleared = await libraryBackup(extension)
  await travel(page, 'Undo')
  await expect(
    editor(page).getByRole('textbox', { name: 'Size ending', exact: true })
  ).toHaveValue('XL')
  await travel(page, 'Redo')
  expect(groups(await libraryBackup(extension))).toEqual(groups(cleared))
  expect((await libraryBackup(extension)).orders).toEqual(before.orders)
})

test('source-row grouping is one Undo step and code owners follow only current assignments', async ({
  extension,
}) => {
  const { page, before } = await setup(extension)
  await shareOrderBarcode(page)
  const grouped = await libraryBackup(extension)
  expect(grouped.preparations[0].groups[0].variants[0].entryIds).toEqual([
    'entry-0',
    'entry-1',
  ])
  await editOrderProduct(page, 0)
  await travel(page, 'Undo')
  expect(groups(await libraryBackup(extension))).toEqual(groups(before))
  await travel(page, 'Redo')
  const redone = await libraryBackup(extension)
  expect(groups(redone)).toEqual(groups(grouped))
  const owners = (data) =>
    data.issuedCodes
      .map(({ ownerSnapshot, ...owner }) => owner)
      .sort((a, b) => a.code.localeCompare(b.code))
  expect(owners(redone)).toEqual(owners(grouped))
  expect(redone.orders).toEqual(before.orders)
})

test('history follows edits across Orders while an unselected purchase retains its exact saved revision', async ({
  extension,
}) => {
  const { page, refs, before } = await setup(extension, { count: 3 })
  for (const [index, name] of ['FIRST SAVED', 'SECOND SAVED'].entries()) {
    const view = await editOrderProduct(
      page,
      { ...refs[index], entryId: 'entry-0' },
      { 'Spanish name': name }
    )
    await closeOrderProduct(view)
  }
  const after = await libraryBackup(extension)
  expect(
    after.preparations.find((prep) => prep.orderId === refs[2].orderId)
  ).toEqual(
    before.preparations.find((prep) => prep.orderId === refs[2].orderId)
  )
  await editOrderProduct(page, { ...refs[0], entryId: 'entry-0' })
  await travel(page, 'Undo')
  expect(
    (await libraryBackup(extension)).preparations.find(
      (prep) => prep.orderId === refs[1].orderId
    ).groups
  ).toEqual(
    before.preparations.find((prep) => prep.orderId === refs[1].orderId).groups
  )
  await travel(page, 'Undo')
  expect(groups(await libraryBackup(extension))).toEqual(groups(before))
  await travel(page, 'Redo')
  await travel(page, 'Redo')
  expect(groups(await libraryBackup(extension))).toEqual(groups(after))
})

test('an earlier pending save cannot erase newer typing or its compound history', async ({
  extension,
}) => {
  const { page } = await setup(extension)
  const view = await editOrderProduct(page, 0),
    field = view.getByRole('textbox', { name: 'Spanish name', exact: true })
  await holdPreparationWrites(page)
  try {
    await field.fill('EARLIER')
    await expect
      .poll(() => page.evaluate(() => window.preparationSaveStarted))
      .toBe(true)
    await field.fill('NEWER PENDING')
    await expect(field).toBeFocused()
    await page.evaluate(() => {
      window.holdPreparationSave = false
    })
    await expect
      .poll(
        async () =>
          (await libraryBackup(extension)).preparations[0].groups[0].variants[0]
            .spanishName
      )
      .toBe('NEWER PENDING')
    await expect(field).toHaveValue('NEWER PENDING')
  } finally {
    await page.evaluate(() => {
      window.holdPreparationSave = false
    })
  }
  await travel(page, 'Undo')
  await travel(page, 'Redo')
  await expect(
    editor(page).getByRole('textbox', { name: 'Spanish name', exact: true })
  ).toHaveValue('NEWER PENDING')
})

test('Undo after a different tab edits the owner rejects without overwriting its revision', async ({
  extension,
}) => {
  const { page, refs } = await setup(extension)
  const local = await editOrderProduct(page, 0, { 'Chinese category': '陶瓷' })
  await expect
    .poll(
      async () =>
        (await libraryBackup(extension)).preparations[0].groups[0].category
    )
    .toBe('陶瓷')
  const other = await extension.context.newPage()
  await other.goto(`${extension.extensionBaseUrl}/library.html`)
  await closeOrderProduct(
    await editOrderProduct(
      other,
      { ...refs[0], entryId: 'entry-0' },
      { 'Chinese category': '外部保存' }
    )
  )
  const newer = await libraryBackup(extension)
  await local.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(local.getByRole('status')).toContainText(
    /changed|another tab|revision/i
  )
  expect((await libraryBackup(extension)).preparations).toEqual(
    newer.preparations
  )
})

test('removing an included order preserves its authored history and does not restore a retired code owner', async ({
  extension,
}) => {
  const { page, refs, before } = await setup(extension, {
    count: 2,
    physical: true,
  })
  await closeOrderProduct(
    await editOrderProduct(page, 0, {
      'Product code': 'CE26099999',
      'Spanish name': 'KEPT NAME',
    })
  )
  const authored = await libraryBackup(extension),
    id = await createContainerThroughUI(page, refs)
  await page
    .locator('.container-order')
    .filter({ hasText: refs[0].orderId })
    .locator('[data-action="remove-container-order"]')
    .click()
  await expect
    .poll(async () => (await viewState(extension, id)).orders.length)
    .toBe(1)
  const after = await libraryBackup(extension)
  expect(groups(after)).toEqual(groups(authored))
  expect(after.issuedCodes).toEqual(authored.issuedCodes)
  expect(after.orders).toEqual(before.orders)
  await page.locator('#view-orders').click()
  await editOrderProduct(page, 0)
  await travel(page, 'Undo')
  expect(
    (await libraryBackup(extension)).preparations[0].groups[0].variants[0]
      .spanishName
  ).not.toBe('KEPT NAME')
  expect(
    (await viewState(extension, id)).orders.map((order) => order.orderId)
  ).toEqual([refs[1].orderId])
})

test('mark-all-loaded is one complete-order Undo/Redo action even when another order is hidden', async ({
  extension,
}) => {
  const { page, refs, before } = await setup(extension, {
    count: 2,
    physical: true,
  })
  const id = await createContainerThroughUI(page, refs),
    view = page.locator('#packing-view')
  await view
    .getByRole('searchbox', { name: 'Filter container display', exact: true })
    .fill(refs[0].orderId)
  await view.locator('[data-action="mark-all-loaded"]').click()
  await expect
    .poll(async () =>
      (await viewState(extension, id)).cartons.every(
        (carton) => carton.state === 'loaded'
      )
    )
    .toBe(true)
  await view.locator('[data-action="undo-container-loading"]').click()
  await expect
    .poll(async () =>
      (await viewState(extension, id)).cartons.every(
        (carton) => carton.state === 'unconfirmed'
      )
    )
    .toBe(true)
  await view.locator('[data-action="redo-container-loading"]').click()
  await expect
    .poll(async () =>
      (await viewState(extension, id)).cartons.every(
        (carton) => carton.state === 'loaded'
      )
    )
    .toBe(true)
  expect((await libraryBackup(extension)).preparations).toEqual(
    before.preparations
  )
  expect((await libraryBackup(extension)).orders).toEqual(before.orders)
})

test('reconciliation paste is one history entry with no physical cartons until order confirmation', async ({
  extension,
}) => {
  const { page, refs, before } = await setup(extension)
  const grid = await openOrderReconciliation(page, refs[0])
  await grid.locator('[data-action="select-grid-rows"]').click()
  await grid
    .getByRole('textbox', {
      name: 'Paste carton or capacity cells',
      exact: true,
    })
    .fill('45\n30')
  await grid.locator('[data-action="preview-carton-paste"]').click()
  await page
    .getByRole('button', { name: 'Use this alignment', exact: true })
    .click()
  const capacities = async () =>
    Object.values(
      (await realOrderContext(extension, refs[0])).record.unitsPerCarton || {}
    ).map(String)
  await expect.poll(capacities).toEqual(['45', '30'])
  expect((await realOrderContext(extension, refs[0])).batches).toHaveLength(0)
  await grid.locator('[data-action="undo-order-cartons"]').click()
  await expect.poll(capacities).toEqual([])
  await grid.locator('[data-action="redo-order-cartons"]').click()
  await expect.poll(capacities).toEqual(['45', '30'])
  expect((await realOrderContext(extension, refs[0])).batches).toHaveLength(0)
  expect((await libraryBackup(extension)).orders[0].snapshot).toEqual(
    before.orders[0].snapshot
  )
})

test('sealed manifest and Se quedó survive an amendment draft and cancel byte-for-byte', async ({
  extension,
}) => {
  const { page, refs } = await setup(extension, { physical: true })
  const id = await createContainerThroughUI(page, refs),
    view = page.locator('#packing-view')
  await sealContainerThroughUI(page)
  const sealed = await context(extension, id)
  await view.locator('[data-action="amend-container"]').click()
  const prompt = page.locator('dialog[open]').last()
  await prompt
    .getByRole('textbox', { name: 'Reason for amendment', exact: true })
    .fill('Synthetic correction review')
  await prompt
    .getByRole('button', { name: 'Begin amendment', exact: true })
    .click()
  await expect(
    view.locator('[data-action="cancel-container-amendment"]')
  ).toBeEnabled()
  expect(await context(extension, id, sealed.revisionId)).toEqual(sealed)
  await view.locator('[data-action="cancel-container-amendment"]').click()
  await expect(view.locator('[data-action="amend-container"]')).toBeEnabled()
  expect(await context(extension, id)).toEqual(sealed)
})

test('applying a loading amendment makes a new revision while prior money, media and left-behind evidence stay reproducible', async ({
  extension,
}) => {
  const { page, refs, before } = await setup(extension, { physical: true })
  const id = await createContainerThroughUI(page, refs),
    view = page.locator('#packing-view')
  await sealContainerThroughUI(page)
  const sealed = await context(extension, id)
  await view.locator('[data-action="amend-container"]').click()
  const prompt = page.locator('dialog[open]').last()
  await prompt
    .getByRole('textbox', { name: 'Reason for amendment', exact: true })
    .fill('One actual carton left behind')
  await prompt
    .getByRole('button', { name: 'Begin amendment', exact: true })
    .click()
  await view.locator('[data-view="loading"]').click()
  await view
    .locator('.container-order [data-action="expand-container-order"]')
    .first()
    .click()
  await view
    .locator('tr[data-container-row]')
    .first()
    .locator('[data-action="set-carton-loading"][data-state="left-behind"]')
    .click()
  await sealContainerThroughUI(page, { markAll: false })
  const amended = await context(extension, id)
  expect(amended.revisionId).not.toBe(sealed.revisionId)
  expect(amended.leftBehind).not.toEqual(sealed.leftBehind)
  expect(await context(extension, id, sealed.revisionId)).toEqual(sealed)
  expect(
    sealed.products.map((row) => [
      row.quantity,
      row.sourcePrice || row.price,
      row.discount,
      row.thumbnail,
    ])
  ).toEqual(
    (await context(extension, id, sealed.revisionId)).products.map((row) => [
      row.quantity,
      row.sourcePrice || row.price,
      row.discount,
      row.thumbnail,
    ])
  )
  expect((await libraryBackup(extension)).orders).toEqual(before.orders)
})

test('legacy suffixes survive valid Orders edits, Undo/Redo and whole-order exclusion', async ({
  extension,
}) => {
  const { page, refs } = await setup(extension)
  const legacy = await libraryBackup(extension)
  legacy.preparations[0].groups[0].variants[0].sizeSuffix = 'A'
  legacy.preparations[0].updatedAt = '2099-01-01T00:00:00Z'
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    legacy
  )
  expect(restored.ok, restored.error).toBe(true)
  await page.reload()
  await editOrderProduct(page, 0, { 'Size ending': 'L' })
  await expect
    .poll(
      async () =>
        (await libraryBackup(extension)).preparations[0].groups[0].variants[0]
          .sizeSuffix
    )
    .toBe('L')
  await travel(page, 'Undo')
  await expect(
    editor(page).getByRole('textbox', { name: 'Size ending', exact: true })
  ).toHaveValue('A')
  await travel(page, 'Redo')
  await expect(
    editor(page).getByRole('textbox', { name: 'Size ending', exact: true })
  ).toHaveValue('L')
  await closeOrderProduct(editor(page))
  const kept = await libraryBackup(extension),
    id = await createContainerThroughUI(page, refs)
  await page.locator('[data-action="remove-container-order"]').click()
  await expect
    .poll(async () => (await viewState(extension, id)).orders.length)
    .toBe(0)
  expect((await libraryBackup(extension)).preparations).toEqual(
    kept.preparations
  )
})
