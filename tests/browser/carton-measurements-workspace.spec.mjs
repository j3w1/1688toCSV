import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function seed(extension) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-measurements'
  record.cartonDetails = {
    [record.snapshot.items[0].entryId]: {
      kg: '20.5',
      cbm: '0.21',
      len: '70',
      wid: '50',
      ht: '30',
    },
  }
  record.cartonDetailsUpdatedAt = record.snapshot.observedAt
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = '玻璃花瓶'
    item.productNumber = 'SYNTHETIC-VASE'
    item.skuProperties = [
      { label: '颜色', value: ['红色', '白色', '黑色'][index] },
    ]
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
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const rows = page.locator('#sheet-body tr[data-selection-key]')
  await expect(rows).toHaveCount(3)
  return { page, rows, record }
}
async function backup(extension) {
  const result = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(result.ok, result.error).toBe(true)
  return result.data
}
const kg = (row) =>
  row.getByRole('textbox', { name: 'Weight (kg/box)', exact: true })
const cbm = (row) =>
  row.getByRole('textbox', { name: 'Volume (m³/box)', exact: true })
async function expectMinimalMeasurement(input, fontSize = '12px') {
  await expect(input).toHaveCSS('font-size', fontSize)
  await expect(input).toHaveCSS('height', '23px')
  await expect(input).toHaveCSS('min-height', '23px')
  await expect(input).toHaveCSS('margin', '0px')
  await expect(input).toHaveCSS('padding', '1px 3px')
  const box = await input.boundingBox()
  expect(box.height).toBe(23)
  expect(box.width).toBeLessThanOrEqual(70)
}
async function commit(input, value) {
  await input.fill(value)
  await input.press('Enter')
  await expect(input.locator('..')).toHaveAttribute('data-state', 'saved')
}
async function prepare(page) {
  await page.locator('#select-rows').click()
  await page.locator('#prepare-orders').click()
  await page
    .getByRole('dialog', { name: 'Assign product codes?' })
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const packing = page.locator('#packing-view')
  await expect(packing).toBeVisible()
  return packing
}

test('compact Orders measurement editors format decimals, preserve dimensions, clear explicitly and survive reload', async ({
  extension,
}) => {
  const { page, rows, record } = await seed(extension)
  await expect(kg(rows.first())).toHaveValue('20.5')
  await expect(
    kg(rows.first()).locator('..').locator('.carton-measurement-unit')
  ).toBeVisible()
  await expect(
    kg(rows.nth(1)).locator('..').locator('.carton-measurement-unit')
  ).toBeHidden()
  expect(
    await kg(rows.first()).evaluate((input) => getComputedStyle(input).fontSize)
  ).toBe(
    await rows
      .first()
      .locator('.quantity-cell')
      .evaluate((cell) => getComputedStyle(cell).fontSize)
  )
  await expect(cbm(rows.first())).toHaveValue('0.105')
  for (const input of [kg(rows.first()), cbm(rows.first())]) {
    await expectMinimalMeasurement(
      input,
      await rows
        .first()
        .locator('.quantity-cell')
        .evaluate((cell) => getComputedStyle(cell).fontSize)
    )
    await expect(input).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(input).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
  }
  // Generic dialog text fields add margins and padding; compact editors must
  // keep their own footprint even when a review popup contains one.
  await page.evaluate(() => {
    const modal = document.createElement('dialog')
    modal.dataset.testMeasurement = 'true'
    modal.append(document.querySelector('.carton-measurement').cloneNode(true))
    document.body.append(modal)
    modal.showModal()
  })
  await expectMinimalMeasurement(
    page.locator('[data-test-measurement] input'),
    await page
      .locator('[data-test-measurement]')
      .evaluate((el) => getComputedStyle(el).fontSize)
  )
  await page.evaluate(() => {
    const modal = document.querySelector('[data-test-measurement]')
    modal.close()
    modal.remove()
  })
  await commit(kg(rows.first()), '025,2500')
  await expect(kg(rows.first())).toHaveValue('25.25')
  let saved = await backup(extension)
  expect(
    saved.orders[0].cartonDetails[record.snapshot.items[0].entryId]
  ).toEqual({ kg: '25.25', cbm: '0.21', len: '70', wid: '50', ht: '30' })
  await commit(cbm(rows.first()), '0,1250')
  await expect(cbm(rows.first()).locator('..')).not.toHaveClass(/is-calculated/)
  saved = await backup(extension)
  expect(
    saved.orders[0].cartonDetails[record.snapshot.items[0].entryId]
  ).toEqual({ kg: '25.25', cbm: '0.125' })
  await kg(rows.first()).fill('-')
  await kg(rows.first()).blur()
  await expect(kg(rows.first())).toHaveAttribute('aria-invalid', 'true')
  expect(
    (await backup(extension)).orders[0].cartonDetails[
      record.snapshot.items[0].entryId
    ].kg
  ).toBe('25.25')
  await commit(kg(rows.first()), '0')
  await page.reload()
  await expect(kg(rows.first())).toHaveValue('0')
  await expect(
    kg(rows.first()).locator('..').locator('.carton-measurement-unit')
  ).toBeVisible()
  await expect(cbm(rows.first())).toHaveValue('0.125')
  await commit(kg(rows.first()), '')
  await page.reload()
  await expect(kg(rows.first())).toHaveValue('')
  await expect(
    kg(rows.first()).locator('..').locator('.carton-measurement-unit')
  ).toBeHidden()
  await expect(
    cbm(rows.first()).locator('..').locator('.carton-measurement-unit')
  ).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 1000 })
  expect(
    await page
      .locator('.table-scroll')
      .evaluate((el) => el.scrollWidth - el.clientWidth)
  ).toBeLessThanOrEqual(1)
})

test('packing measurements undo, redo and roll back on removal while preserving the table layout', async ({
  extension,
}) => {
  const { page, record } = await seed(extension)
  const packing = await prepare(page)
  const rows = packing.locator('tr[data-variant-id]')
  const first = rows.first()
  await expect(first.locator('.variant-numeric-header')).toHaveText(
    'QuantityPcs/boxkg/boxm³/box'
  )
  await expect(first.locator('.variant-code-design')).toHaveCSS(
    '--ce-code-size',
    '16px'
  )
  await expectMinimalMeasurement(kg(first))
  await expectMinimalMeasurement(cbm(first))
  await expect(first.locator('.carton-measurement-unit:visible')).toHaveCount(2)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.mouse.move(1, 1)
  await page.screenshot({ path: 'work/minimal-carton-measurements.png' })
  await commit(kg(first), '30.75')
  await commit(cbm(first), '0.15')
  await packing.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(cbm(rows.first())).toHaveValue('0.105')
  await expect(kg(rows.first())).toHaveValue('30.75')
  await packing.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(cbm(rows.first())).toHaveValue('0.15')
  await expect(
    packing.getByRole('spinbutton', { name: 'Pcs/box', exact: true })
  ).toHaveCount(0)
  const sourceId = record.snapshot.items[0].entryId
  await first
    .getByRole('button', { name: 'Remove product', exact: true })
    .focus()
  await first
    .getByRole('button', { name: 'Remove product', exact: true })
    .click()
  const review = page.getByRole('dialog', {
    name: 'Remove from packing?',
    exact: true,
  })
  await expect(review).toContainText('30.75 kg')
  await expect(review).toContainText('20.5 kg')
  await review
    .getByRole('button', { name: 'Remove from packing', exact: true })
    .click()
  let saved = await backup(extension)
  expect(saved.orders[0].cartonDetails[sourceId]).toEqual({
    kg: '20.5',
    cbm: '0.21',
    len: '70',
    wid: '50',
    ht: '30',
  })
  await packing.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(kg(rows.first())).toHaveValue('30.75')
  await expect(cbm(rows.first())).toHaveValue('0.15')
  await packing.getByRole('button', { name: 'Redo', exact: true }).click()
  saved = await backup(extension)
  expect(saved.orders[0].cartonDetails[sourceId].kg).toBe('20.5')
  for (const width of [1440, 1000, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(kg(rows.first())).toBeVisible()
    await expect(cbm(rows.first())).toBeVisible()
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(1)
    const bounds = await rows
      .first()
      .locator('.variant-carton-columns')
      .boundingBox()
    const input = await cbm(rows.first()).boundingBox()
    expect(input.x + input.width).toBeLessThanOrEqual(
      bounds.x + bounds.width + 1
    )
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'work/packing-carton-measurements.png' })
})

test('blank and populated preparation measurements keep a quiet compact field on hover and focus', async ({
  extension,
}) => {
  const { page } = await seed(extension)
  const packing = await prepare(page)
  const rows = packing.locator('tr[data-variant-id]')
  for (const row of [rows.first(), rows.nth(1)]) {
    for (const input of [kg(row), cbm(row)]) {
      await page.mouse.move(1, 1)
      await expectMinimalMeasurement(input)
      const bounds = await input.boundingBox()
      const quantity = await row.locator('.variant-quantity').boundingBox()
      expect(
        Math.abs(
          bounds.y + bounds.height / 2 - (quantity.y + quantity.height / 2)
        )
      ).toBeLessThanOrEqual(2)
      const unit = input.locator('..').locator('.carton-measurement-unit')
      if ((await input.inputValue()) === '') {
        await expect(input).toHaveAttribute('placeholder', '—')
        await expect(unit).toBeHidden()
      } else await expect(unit).toBeVisible()
      await input.hover()
      await expectMinimalMeasurement(input)
      for (const side of ['top', 'right', 'left'])
        await expect(input).toHaveCSS(
          `border-${side}-color`,
          'rgba(0, 0, 0, 0)'
        )
      await input.focus()
      await expectMinimalMeasurement(input)
      await expect(input).toHaveCSS('outline-style', 'solid')
      await expect(input).toHaveCSS('outline-width', '2px')
      await input.blur()
    }
  }
})

test('a preserved dirty measurement cannot overwrite a same-field edit broadcast from another tab', async ({
  extension,
}) => {
  const { page, rows, record } = await seed(extension)
  const draft = kg(rows.first())
  await draft.fill('-')
  const other = await extension.context.newPage()
  await other.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await other.goto(`${extension.extensionBaseUrl}/library.html`)
  const otherRow = other.locator('#sheet-body tr[data-selection-key]').first()
  await commit(kg(otherRow), '6')
  // A clean sibling reflects the broadcast while the first editor keeps its draft.
  await commit(
    kg(other.locator('#sheet-body tr[data-selection-key]').nth(1)),
    '7'
  )
  await expect(kg(rows.nth(1))).toHaveValue('7')
  await expect(draft).toHaveValue('-')
  await draft.fill('5')
  await draft.press('Enter')
  await expect(draft.locator('..')).toHaveAttribute('data-state', 'error')
  await expect(draft.locator('..')).toContainText('changed in another tab')
  expect(
    (await backup(extension)).orders[0].cartonDetails[
      record.snapshot.items[0].entryId
    ].kg
  ).toBe('6')
})

test('removing a packing product refuses to discard a newer measurement edited in Orders', async ({
  extension,
}) => {
  const { page, record } = await seed(extension)
  const packing = await prepare(page)
  const first = packing.locator('tr[data-variant-id]').first()
  await commit(kg(first), '5')
  const other = await extension.context.newPage()
  await other.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await other.goto(`${extension.extensionBaseUrl}/library.html`)
  await commit(
    kg(other.locator('#sheet-body tr[data-selection-key]').first()),
    '6'
  )
  await expect(kg(first)).toHaveValue('6')
  await first
    .getByRole('button', { name: 'Remove product', exact: true })
    .focus()
  await first
    .getByRole('button', { name: 'Remove product', exact: true })
    .click()
  await expect(
    page.getByRole('dialog', { name: 'Remove from packing?', exact: true })
  ).toHaveCount(0)
  await expect(packing).toContainText('changed in another tab')
  const saved = await backup(extension)
  expect(
    saved.orders[0].cartonDetails[record.snapshot.items[0].entryId].kg
  ).toBe('6')
  expect(
    saved.preparations[0].groups.flatMap((group) =>
      group.variants.flatMap((variant) => variant.entryIds)
    )
  ).toContain(record.snapshot.items[0].entryId)
})
