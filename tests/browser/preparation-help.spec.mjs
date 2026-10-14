import { readFile } from 'node:fs/promises'
import { test, expect } from './extension-fixture.mjs'

async function helpFixture(extension, { fallback = false } = {}) {
  const page = await extension.context.newPage()
  // Match the secure context of extension pages without running library code.
  await page.goto(`${extension.origin}/unsupported`)
  await page.setContent(`
    <style>dialog { width: 440px; padding: 40px; } label { display: block; margin: 20px; } input { display: block; }</style>
    <dialog><label id="field">Variant code<input aria-describedby="existing" /></label><p id="existing">Existing description.</p><button id="action">Share one barcode</button></dialog>
  `)
  await page.addStyleTag({
    content: await readFile(
      new URL('../../src/packing.css', import.meta.url),
      'utf8'
    ),
  })
  if (fallback)
    await page.evaluate(() => {
      delete HTMLElement.prototype.popover
    })
  const source = await readFile(
    new URL('../../src/preparation-help.js', import.meta.url),
    'utf8'
  )
  await page.addScriptTag({
    content: source.replace(
      'export function preparationHelp',
      'window.preparationHelp = function preparationHelp'
    ),
  })
  await page.evaluate(() => {
    preparationHelp(
      document.querySelector('#field'),
      'Letters added to the product code, such as A for black.'
    )
    preparationHelp(
      document.querySelector('#action'),
      'Use one barcode for the selected variants.'
    )
    document.querySelector('dialog').showModal()
    document.querySelector('#action').focus()
  })
  await page.keyboard.press('Escape')
  return page
}

test('field hints open on hover, remain readable under the pointer, and dismiss without closing the dialog', async ({
  extension,
}) => {
  const page = await helpFixture(extension)
  await expect(page.getByRole('button')).toHaveCount(1)
  await page.locator('#field').hover()
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toHaveText(/Letters added to the product code/)
  await tooltip.hover()
  await expect(tooltip).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tooltip).toHaveCount(0)
  await expect(page.locator('dialog')).toHaveJSProperty('open', true)
  await page.locator('#field input').focus()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveAccessibleDescription(
    /Existing description.*Letters added/
  )
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox')).toHaveAttribute(
    'aria-describedby',
    'existing'
  )
  await expect(page.getByRole('textbox')).toBeFocused()
  await page.close()
})

test('hints replace each other and close when a field is removed or its dialog closes', async ({
  extension,
}) => {
  const page = await helpFixture(extension)
  await page.locator('#field input').focus()
  await expect(page.getByRole('tooltip')).toHaveCount(1)
  await page.locator('#action').hover()
  await expect(page.getByRole('tooltip')).toHaveText(
    'Use one barcode for the selected variants.'
  )
  await expect(page.getByRole('tooltip')).toHaveCount(1)
  await page.locator('#action').evaluate((node) => node.remove())
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.locator('#field').hover()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.locator('dialog').evaluate((node) => node.close())
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.close()
})

test('hover hints have a positioned fallback without Popover support', async ({
  extension,
}) => {
  const page = await helpFixture(extension, { fallback: true })
  await page.locator('#field input').focus()
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).not.toHaveAttribute('popover')
  const bounds = await tooltip.boundingBox()
  const viewport = page.viewportSize()
  expect(bounds.x).toBeGreaterThanOrEqual(8)
  expect(bounds.y).toBeGreaterThanOrEqual(8)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 7)
  await page.keyboard.press('Escape')
  await expect(tooltip).toHaveCount(0)
  await expect(page.locator('dialog')).toHaveJSProperty('open', true)
  await page.close()
})
