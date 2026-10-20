import { test, expect } from './extension-fixture.mjs'
import {
  openPrintDialogFixture,
  showPrintDialog,
} from './print-dialog-fixture.mjs'

const values = (inputs) =>
  inputs.evaluateAll((nodes) => nodes.map((input) => input.value))

for (const kind of ['labels', 'marks']) {
  const step = kind === 'marks' ? 1 : 5
  test(`${kind} +${step} stays inside each quantity field and increments only its row safely`, async ({
    extension,
  }) => {
    const { page, dialog } = await openPrintDialogFixture(extension, { kind })
    await expect(dialog.locator('.ce-code-part')).toHaveCount(0)
    const quantities = dialog.getByLabel(/^Quantity for /)
    const buttons = dialog.locator('[data-action="increment-print-quantity"]')
    await expect(buttons).toHaveCount(3)
    const first = buttons.first()
    await expect(first).toHaveAccessibleName(
      `Add ${step} to requested quantity for CE26100101`
    )
    await first.hover()
    await expect(dialog.getByRole('tooltip')).toContainText(
      'The preview updates immediately; the maximum is 9999.'
    )
    await first.click()
    await first.click()
    expect(await values(quantities)).toEqual([String(1 + 2 * step), '3', '0'])
    await expect(dialog.locator('.print-quantity-preview')).toHaveText(
      `Total requested: ${4 + 2 * step} → ${8 + 4 * step}`
    )
    await expect(first).toBeFocused()
    await page.keyboard.press('Enter')
    expect(await values(quantities)).toEqual([String(1 + 3 * step), '3', '0'])
    await quantities.first().fill('23')
    await quantities.first().press('ArrowUp')
    await first.click()
    expect(await values(quantities)).toEqual([String(24 + step), '3', '0'])
    await quantities.nth(2).fill('')
    await buttons.nth(2).click()
    expect(await values(quantities)).toEqual([
      String(24 + step),
      '3',
      String(step),
    ])
    for (const invalid of ['2.5', '1e2', '-1', '10000']) {
      await quantities.nth(1).fill(invalid)
      await expect(buttons.nth(1)).toBeDisabled()
      const before = await values(quantities)
      await buttons.nth(1).dispatchEvent('click')
      expect(await values(quantities)).toEqual(before)
    }
    await quantities.nth(1).fill('3')
    await quantities.first().fill(String(9999 - step))
    await expect(first).toBeEnabled()
    await first.click()
    await expect(quantities.first()).toHaveValue('9999')
    await expect(first).toBeDisabled()
    await first.dispatchEvent('click')
    await expect(quantities.first()).toHaveValue('9999')
    await quantities.first().fill(String(10000 - step))
    await expect(first).toBeDisabled()
    await quantities.first().fill('9')
    const inputBox = await quantities.first().boundingBox()
    const buttonBox = await first.boundingBox()
    expect(inputBox.width).toBe(72)
    expect(inputBox.height).toBe(28)
    expect(buttonBox.x).toBeGreaterThanOrEqual(inputBox.x)
    expect(buttonBox.y).toBeGreaterThanOrEqual(inputBox.y)
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(
      inputBox.x + inputBox.width
    )
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(
      inputBox.y + inputBox.height
    )
    await page.evaluate(() => Print.setLanguage('es', { persist: false }))
    await expect(first).toHaveAccessibleName(
      `Sumar ${step} a la cantidad solicitada de CE26100101`
    )
    await first.click()
    await expect(quantities.first()).toHaveCount(0) // the English accessible name has translated
    await expect(
      dialog.locator('.print-quantity-input input').first()
    ).toHaveValue(String(9 + step))
    await dialog.locator('[data-action="close-print-dialog"]').click()
    await page.close()
  })

  test(`${kind} adjusts all requested quantities with a preview, custom factors and atomic validation`, async ({
    extension,
  }) => {
    const { page, dialog } = await openPrintDialogFixture(extension, { kind })
    const quantities = dialog.getByLabel(/^Quantity for /)
    const operation = dialog.getByLabel('Operation', { exact: true })
    const factor = dialog.getByLabel('Factor', { exact: true })
    const apply = dialog.getByRole('button', {
      name: 'Apply to all',
      exact: true,
    })
    const preview = dialog.locator('.print-quantity-preview')
    const reason = dialog.locator('.print-quantity-reason')
    const exportButton = dialog.getByRole('button', {
      name: 'Export PDF',
      exact: true,
    })
    let cap
    if (kind === 'labels') {
      await dialog.locator('.print-advanced > summary').click()
      await dialog
        .getByLabel('Limit extra copies per product', { exact: true })
        .check()
      cap = dialog.getByLabel('Max extra for CE26100101', { exact: true })
      await cap.fill('4')
    }
    await expect(preview).toHaveText('Total requested: 4 → 8')
    await factor.fill('3')
    await expect(preview).toHaveText('Total requested: 4 → 12')
    expect(await values(quantities)).toEqual(['1', '3', '0'])
    // Enter in Factor applies exactly once and leaves the editor focused.
    await factor.press('Enter')
    await expect(factor).toBeFocused()
    expect(await values(quantities)).toEqual(['3', '9', '0'])
    await expect(reason).toHaveText(
      'Applied ×3 to all requested quantities: 4 → 12.'
    )
    await operation.selectOption('divide')
    await factor.fill('2')
    await expect(preview).toHaveText('Total requested: 12 → 7')
    await apply.click()
    expect(await values(quantities)).toEqual(['2', '5', '0'])
    await expect(reason).toContainText('Non-whole results were rounded up.')
    await factor.fill('3')
    await apply.click()
    expect(await values(quantities)).toEqual(['1', '2', '0'])
    if (cap) await expect(cap).toHaveValue('4')
    await factor.fill('1')
    await expect(apply).toBeDisabled()
    await expect(reason).toHaveText('No quantities would change.')

    await quantities.first().fill('5000')
    await quantities.nth(1).fill('3')
    await operation.selectOption('multiply')
    await factor.fill('2')
    await expect(reason).toContainText('CE26100101 would become 10000')
    await apply.click()
    await expect(factor).toBeFocused()
    expect(await values(quantities)).toEqual(['5000', '3', '0'])
    // An unapplied calculator error does not invalidate current print quantities.
    await expect(exportButton).toBeEnabled()
    await operation.selectOption('divide')
    await apply.click()
    expect(await values(quantities)).toEqual(['2500', '2', '0'])
    for (const invalid of ['2.5', '1e2', '-1', '10000']) {
      await quantities.nth(1).fill(invalid)
      await expect(quantities.nth(1)).toHaveAttribute('aria-invalid', 'true')
      const before = await values(quantities)
      await apply.click()
      expect(await values(quantities)).toEqual(before)
      await expect(quantities.nth(1)).toBeFocused()
      await expect(reason).toContainText(
        'CE26100102: enter a requested quantity'
      )
      await expect(exportButton).toBeDisabled()
    }
    await quantities.nth(1).fill('2')
    for (const invalid of ['', '0', '2.5', '1e2', '-1', '10000']) {
      await factor.fill(invalid)
      await apply.click()
      await expect(factor).toBeFocused()
      await expect(factor).toHaveAttribute('aria-invalid', 'true')
      await expect(reason).toHaveText('Enter a whole factor from 1 to 9999.')
      expect(await values(quantities)).toEqual(['2500', '2', '0'])
    }
    await factor.fill('2')
    await expect(factor).not.toHaveAttribute('aria-invalid')
    await quantities.first().fill('')
    await quantities.nth(1).fill('0')
    await expect(apply).toBeDisabled()
    await expect(exportButton).toBeDisabled()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('#launch')).toBeFocused()
    await page.close()
  })
}

for (const kind of ['labels', 'marks']) {
  test(`${kind} counts stay compact without desktop horizontal scrolling and preset fields align responsively`, async ({
    extension,
  }) => {
    const { page, dialog } = await openPrintDialogFixture(extension, { kind })
    if (kind === 'labels') {
      await expect(dialog.locator('.print-quantity-actions')).toHaveCount(1)
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

  for (const [language, scope, applyLabel, help] of [
    ['es', 'Ajustar cantidades', 'Aplicar a todos', 'redondea hacia arriba'],
    ['zh', '调整数量', '应用于全部', '向上取整'],
  ]) {
    dialog = await showPrintDialog(page, { language })
    await expect(dialog.locator('.print-quantity-heading > strong')).toHaveText(
      scope
    )
    const apply = dialog.getByRole('button', { name: applyLabel, exact: true })
    await dialog
      .locator('.print-quantity-actions select')
      .selectOption('divide')
    await dialog.locator('.print-quantity-actions .print-field').first().hover()
    await expect(dialog.getByRole('tooltip')).toContainText(help)
    await apply.click()
    expect(await values(dialog.locator('.print-counts tbody input'))).toEqual([
      '1',
      '2',
      '0',
    ])
    await dialog.locator('[data-action="close-print-dialog"]').click()
  }
  await page.close()
})
