import { test, expect } from './extension-fixture.mjs'
import { openPrintDialogFixture } from './print-dialog-fixture.mjs'

const pixels = (canvas) => canvas.evaluate((node) => node.toDataURL())

for (const kind of ['labels', 'marks']) {
  test(`${kind} paper edits repaint immediately while the edited field stays focused`, async ({
    extension,
  }) => {
    const { page, dialog } = await openPrintDialogFixture(extension, { kind })
    const canvas = dialog.locator('.print-preview')
    await expect(canvas).toHaveAttribute('data-ops', /[1-9]\d*/)
    const margin = dialog.getByLabel(
      kind === 'marks' ? 'Safe margin (mm)' : 'Margin (mm)',
      { exact: true }
    )
    await margin.fill('5.5')
    await expect(margin).toBeFocused()
    await expect(
      dialog.locator('.print-safe-area rect').first()
    ).toHaveAttribute('x', '5.5')
    for (const [name, value] of [
      [kind === 'marks' ? 'Safe margin (mm)' : 'Margin (mm)', '20'],
      ['Offset X (mm)', '3'],
      ['Offset Y (mm)', '-2'],
    ]) {
      const before = await pixels(canvas)
      const input = dialog.getByLabel(name, { exact: true })
      await input.fill(value)
      await expect(input).toBeFocused()
      await expect.poll(() => pixels(canvas)).not.toBe(before)
    }
    const changes =
      kind === 'marks'
        ? [
            () =>
              dialog
                .getByLabel('Number cartons (Carton 1 of 3)', { exact: true })
                .uncheck(),
            () => dialog.getByLabel('Cut guide', { exact: true }).uncheck(),
            () =>
              dialog.getByLabel('Page summary line', { exact: true }).uncheck(),
          ]
        : [
            () => dialog.getByLabel('Cut guides', { exact: true }).uncheck(),
            () =>
              dialog.getByLabel('Page summary line', { exact: true }).uncheck(),
            () =>
              dialog
                .getByLabel('Mark where products change', { exact: true })
                .check(),
          ]
    for (const change of changes) {
      const before = await pixels(canvas)
      await change()
      await expect.poll(() => pixels(canvas)).not.toBe(before)
    }
    if (kind === 'labels') {
      await dialog.locator('.print-advanced > summary').click()
      for (const name of ['Horizontal gap (mm)', 'Vertical gap (mm)']) {
        const before = await pixels(canvas)
        await dialog.getByLabel(name, { exact: true }).fill('3')
        await expect.poll(() => pixels(canvas)).not.toBe(before)
      }
      const before = await pixels(canvas)
      await dialog
        .getByRole('radio', { name: 'Leave blank', exact: true })
        .check()
      await expect.poll(() => pixels(canvas)).not.toBe(before)
    } else {
      await dialog
        .getByLabel('Quantity for CE26100102', { exact: true })
        .fill('2')
      await dialog
        .getByRole('button', { name: 'Next page', exact: true })
        .click()
      await expect(canvas).toHaveAttribute('data-preview-state', 'ready')
      const before = await pixels(canvas)
      await dialog
        .getByLabel('Fill an odd last half with an extra copy', { exact: true })
        .check()
      await expect.poll(() => pixels(canvas)).not.toBe(before)
    }
    await dialog.getByLabel('A4 preset', { exact: true }).selectOption('a4-5')
    await expect(margin).toHaveValue('5')
    await expect(
      dialog.locator('.print-safe-area rect').first()
    ).toHaveAttribute('x', '5')
    await page.close()
  })

  test(`${kind} fitted preview has no horizontal overflow and restores fit after zoom or resize`, async ({
    extension,
  }) => {
    const { page, dialog } = await openPrintDialogFixture(extension, { kind })
    const viewport = dialog.locator('.print-preview-viewport')
    await expect(dialog.locator('.print-preview')).toHaveAttribute(
      'data-ops',
      /[1-9]\d*/
    )
    for (const [width, height] of [
      [1441, 1200],
      [1301, 1200],
      [1027, 1200],
      [600, 1200],
      [390, 900],
      [1440, 600],
    ]) {
      await page.setViewportSize({ width, height })
      await expect
        .poll(() =>
          viewport.evaluate((node) => node.scrollWidth - node.clientWidth)
        )
        .toBe(0)
      await expect(viewport).toHaveCSS('overflow-x', 'hidden')
      await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click()
      await expect(viewport).toHaveCSS('overflow-x', 'auto')
      await dialog
        .getByRole('button', { name: 'Fit page', exact: true })
        .click()
      await expect
        .poll(() =>
          viewport.evaluate((node) => node.scrollWidth - node.clientWidth)
        )
        .toBe(0)
    }
    await page.close()
  })
}

test('rapid print edits share pending artwork and display only the latest layout without blank flashes', async ({
  extension,
}) => {
  const { page, dialog } = await openPrintDialogFixture(extension, {
    kind: 'labels',
  })
  const canvas = dialog.locator('.print-preview')
  await expect(canvas).toHaveAttribute('data-preview-state', 'ready')
  const before = await pixels(canvas)
  await page.evaluate(() => {
    const decode = window.createImageBitmap.bind(window)
    const gate = new Promise((resolve) => {
      window.releasePrintDecode = resolve
    })
    window.printDecodes = 0
    window.createImageBitmap = async (...args) => {
      window.printDecodes++
      await gate
      return decode(...args)
    }
  })
  await dialog.getByLabel('Quantity for CE26100103', { exact: true }).fill('1')
  await expect.poll(() => page.evaluate(() => window.printDecodes)).toBe(1)
  for (const value of ['6', '12', '20'])
    await dialog.getByLabel('Margin (mm)', { exact: true }).fill(value)
  await expect(canvas).toHaveAttribute('aria-busy', 'true')
  expect(await pixels(canvas)).toBe(before)
  expect(await page.evaluate(() => window.printDecodes)).toBe(1)
  await page.evaluate(() => window.releasePrintDecode())
  await expect(canvas).toHaveAttribute('data-preview-state', 'ready')
  await expect.poll(() => pixels(canvas)).not.toBe(before)
  await expect(dialog.locator('.print-safe-area rect')).toHaveAttribute(
    'x',
    '20'
  )
  await expect(canvas).not.toHaveAttribute('aria-busy')
  await page.close()
})
