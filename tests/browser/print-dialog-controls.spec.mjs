import { test, expect } from './extension-fixture.mjs'
import {
  openPrintDialogFixture,
  showPrintDialog,
} from './print-dialog-fixture.mjs'

const values = (inputs) =>
  inputs.evaluateAll((nodes) => nodes.map((input) => input.value))

test('carton bulk controls update every count, round halves up and refuse invalid or overflowing doubles atomically', async ({
  extension,
}) => {
  const { page, dialog } = await openPrintDialogFixture(extension)
  const quantities = dialog.locator('.print-counts tbody input')
  const twice = dialog.getByRole('button', {
    name: 'Double all carton quantities',
    exact: true,
  })
  const half = dialog.getByRole('button', {
    name: 'Halve all carton quantities',
    exact: true,
  })
  await expect(twice).toHaveText('×2')
  await expect(half).toHaveText('÷2')
  await twice.click()
  expect(await values(quantities)).toEqual(['2', '6', '0'])
  await expect(twice).toBeFocused()
  await expect(dialog.locator('.print-summary')).toHaveText(
    '2 carton marks per A4 · Pages: 4 · Marks: 8'
  )
  await half.focus()
  await page.keyboard.press('Enter')
  expect(await values(quantities)).toEqual(['1', '3', '0'])
  await expect(half).toBeFocused()
  await quantities.first().fill('3')
  await quantities.nth(1).fill('5')
  await half.click()
  expect(await values(quantities)).toEqual(['2', '3', '0'])
  await expect(dialog.locator('.print-page-label')).toHaveText('Page 1 of 3')

  for (const invalid of ['2.5', '1e2', '-1', '10000']) {
    await quantities.nth(1).fill(invalid)
    await expect(quantities.nth(1)).toHaveAttribute('aria-invalid', 'true')
    await expect(twice).toBeDisabled()
    await expect(half).toBeDisabled()
    const before = await values(quantities)
    // The handler is guarded too: no partial mutation even if a caller
    // dispatches an event directly at a disabled control.
    await twice.dispatchEvent('click')
    await half.dispatchEvent('click')
    expect(await values(quantities)).toEqual(before)
    await expect(
      dialog.getByRole('button', { name: 'Export PDF', exact: true })
    ).toBeDisabled()
  }
  await quantities.first().fill('5000')
  await quantities.nth(1).fill('3')
  await expect(twice).toBeDisabled()
  await expect(half).toBeEnabled()
  await expect(dialog.locator('.print-quantity-reason')).toHaveText(
    'Doubling would exceed 9999. Lower the carton quantities first.'
  )
  await twice.dispatchEvent('click')
  expect(await values(quantities)).toEqual(['5000', '3', '0'])
  await half.click()
  expect(await values(quantities)).toEqual(['2500', '2', '0'])
  await expect(twice).toBeEnabled()
  await twice.click()
  expect(await values(quantities)).toEqual(['5000', '4', '0'])
  await quantities.first().fill('')
  await quantities.nth(1).fill('0')
  await half.click()
  expect(await values(quantities)).toEqual(['0', '0', '0'])
  await expect(
    dialog.getByRole('button', { name: 'Export PDF', exact: true })
  ).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('#launch')).toBeFocused()
  await page.close()
})

for (const kind of ['labels', 'marks']) {
  test(`${kind} counts stay compact without desktop horizontal scrolling and preset fields align responsively`, async ({
    extension,
  }) => {
    const { page, dialog } = await openPrintDialogFixture(extension, { kind })
    if (kind === 'labels') {
      await expect(dialog.locator('.print-quantity-actions')).toHaveCount(0)
      await dialog.locator('.print-advanced > summary').click()
      await dialog
        .getByLabel('Limit extra copies per product', { exact: true })
        .check()
    }
    const quantity = dialog.locator('.print-counts tbody input').first()
    const preset = dialog.getByLabel('A4 preset', { exact: true })
    const name = dialog.getByLabel('Preset name', { exact: true })
    await expect(name.locator('..').locator('span')).toHaveText('Preset name')
    await expect(quantity).toHaveCSS('width', '72px')
    await expect(quantity).toHaveCSS('min-height', '28px')
    await expect(dialog.locator('.print-counts')).toHaveCSS('font-size', '12px')
    await name.fill('Synthetic printer preset with a long descriptive name')
    const entered = await name.inputValue()
    for (const width of [1280, 1024, 600, 390, 320]) {
      await page.setViewportSize({ width, height: 800 })
      await expect(dialog).toBeVisible()
      await expect(name).toHaveValue(entered)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      expect(
        await dialog
          .locator('.scroll-dialog-content')
          .evaluate((node) => node.scrollWidth <= node.clientWidth)
      ).toBe(true)
      if (width >= 1024) {
        expect(
          await dialog
            .locator('.print-table-scroll')
            .evaluate((node) => node.scrollWidth <= node.clientWidth)
        ).toBe(true)
        const selectBox = await preset.boundingBox()
        const nameBox = await name.boundingBox()
        expect(Math.abs(selectBox.y - nameBox.y)).toBeLessThanOrEqual(1)
        expect(Math.abs(selectBox.height - nameBox.height)).toBeLessThanOrEqual(
          1
        )
      }
    }
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.close()
  })
}

test('print helpers explain visual changes on hover and keyboard focus and translate without replacing fields', async ({
  extension,
}) => {
  const opened = await openPrintDialogFixture(extension, { kind: 'labels' })
  const page = opened.page
  let dialog = opened.dialog
  const advanced = dialog.locator('.print-advanced > summary')
  await advanced.hover()
  await expect(dialog.getByRole('tooltip')).toContainText(
    'Set how spare label places are filled'
  )
  await advanced.click()
  await page.mouse.move(2, 2)
  await page.keyboard.press('Tab')
  const gap = dialog.getByLabel('Horizontal gap (mm)', { exact: true })
  await gap.focus()
  await expect(dialog.getByRole('tooltip')).toContainText(
    'Larger gaps can fit fewer labels per page.'
  )
  await expect(gap).toHaveAccessibleDescription(
    /Add horizontal space between labels/
  )
  await gap.fill('0.5')
  // Editing intentionally dismisses help. Returning by keyboard opens it again.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('tooltip')).toContainText(
    'Larger gaps can fit fewer labels per page.'
  )
  const originalGap = await gap.elementHandle()
  await page.evaluate(() => Print.setLanguage('es', { persist: false }))
  expect(
    await originalGap.evaluate((node) => ({
      connected: node.isConnected,
      focused: node === document.activeElement,
      value: node.value,
    }))
  ).toEqual({ connected: true, focused: true, value: '0.5' })
  await expect(dialog.getByRole('tooltip')).toContainText(
    'Añade separación horizontal entre etiquetas.'
  )
  await page.keyboard.press('Escape')
  await expect(dialog.getByRole('tooltip')).toHaveCount(0)
  await expect(dialog).toHaveJSProperty('open', true)
  await dialog.locator('[data-action="close-print-dialog"]').click()

  for (const [language, scope, halveLabel, help] of [
    [
      'es',
      'Todas las cantidades de cajas',
      'Reducir a la mitad todas las cantidades de cajas',
      'redondeando las impares hacia arriba',
    ],
    ['zh', '所有箱唛数量', '所有箱唛数量减半', '奇数向上取整'],
  ]) {
    dialog = await showPrintDialog(page, { language })
    await expect(dialog.locator('.print-quantity-toolbar > span')).toHaveText(
      scope
    )
    const halve = dialog.getByRole('button', { name: halveLabel, exact: true })
    await halve.hover()
    await expect(dialog.getByRole('tooltip')).toContainText(help)
    await halve.click()
    expect(await values(dialog.locator('.print-counts tbody input'))).toEqual([
      '1',
      '2',
      '0',
    ])
    await dialog.locator('[data-action="close-print-dialog"]').click()
  }
  await page.close()
})
