import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { test, expect } from './extension-fixture.mjs'

let helpSource
test.beforeAll(async () => {
  const result = await build({
    entryPoints: [
      fileURLToPath(new URL('../../src/preparation-help.js', import.meta.url)),
    ],
    bundle: true,
    format: 'iife',
    globalName: 'PreparationHelp',
    write: false,
  })
  helpSource = result.outputFiles[0].text
})

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
  await page.addScriptTag({ content: helpSource })
  await page.evaluate(() => {
    window.preparationHelp = PreparationHelp.preparationHelp
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

test('field hints leave immediately with the pointer and preserve keyboard descriptions and Escape', async ({
  extension,
}) => {
  const page = await helpFixture(extension)
  await expect(page.getByRole('button')).toHaveCount(1)
  await page.locator('#field').hover()
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toHaveText(/Letters added to the product code/)
  const afterLeave = await page.locator('#field').evaluate((field) => {
    field.dispatchEvent(
      new PointerEvent('pointerout', {
        bubbles: true,
        relatedTarget: field.closest('dialog'),
      })
    )
    return document.querySelectorAll('[role=tooltip]').length
  })
  expect(afterLeave).toBe(0)
  await page.locator('#field input').focus()
  await expect(tooltip).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tooltip).toHaveCount(0)
  await expect(page.locator('dialog')).toHaveJSProperty('open', true)
  await page.locator('#action').focus()
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

for (const fallback of [false, true]) {
  test(`${fallback ? 'fallback' : 'native'} helper cannot be pinned by clicking or refocusing a replaced group`, async ({
    extension,
  }) => {
    const page = await helpFixture(extension, { fallback })
    await page.locator('#action').click()
    await page.locator('#action').evaluate((button) => {
      const replacement = button.cloneNode(true)
      button.replaceWith(replacement)
      preparationHelp(replacement, 'Use one barcode for the selected variants.')
      replacement.focus()
    })
    await page.mouse.move(5, 5)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await page.locator('#action').hover()
    await expect(page.getByRole('tooltip')).toBeVisible()
    await page.mouse.move(5, 5)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await expect(page.locator('#action')).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('textbox')).toBeFocused()
    await expect(page.getByRole('tooltip')).toHaveText(/Letters added/)
    await page.close()
  })
}

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

for (const fallback of [false, true]) {
  test(`a ${fallback ? 'fallback' : 'native'} hint cannot consume Escape or reopen beneath another modal`, async ({
    extension,
  }) => {
    const page = await helpFixture(extension, { fallback })
    await page.locator('#field input').focus()
    await expect(page.getByRole('tooltip')).toBeVisible()
    const remaining = await page.evaluate(() => {
      const nested = document.createElement('dialog')
      nested.id = 'photo'
      nested.innerHTML = '<button>Fit</button>'
      document.body.append(nested)
      nested.showModal()
      nested.querySelector('button').focus()
      return document.querySelectorAll('.preparation-help-popover').length
    })
    // Check in the opening task, before the old hint's delayed close can hide the race.
    expect(remaining).toBe(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('#photo')).toHaveJSProperty('open', false)
    await expect(page.locator('dialog').first()).toHaveJSProperty('open', true)

    await page.locator('#field input').focus()
    await expect(page.getByRole('tooltip')).toBeVisible()
    await page.evaluate(() => {
      const nested = document.createElement('dialog')
      nested.id = 'label'
      nested.innerHTML = '<input aria-label="Size code" value="L" />'
      const input = nested.querySelector('input')
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        input.value = 'S'
      })
      document.body.append(nested)
      nested.showModal()
      input.focus()
    })
    await page.keyboard.press('Escape')
    await expect(page.getByLabel('Size code', { exact: true })).toHaveValue('S')
    await expect(page.locator('#label')).toHaveJSProperty('open', true)
    await page.locator('#label').evaluate((dialog) => dialog.close())

    await page.locator('#action').focus()
    await page.keyboard.press('Escape')
    // A queued hover must also respect the modal that gained focus before it fires.
    await page.evaluate(() => {
      document
        .querySelector('#field')
        .dispatchEvent(new PointerEvent('pointerenter'))
      document.querySelector('#photo').showModal()
    })
    await page.waitForTimeout(450)
    await expect(page.locator('.preparation-help-popover')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('#photo')).toHaveJSProperty('open', false)
    await page.close()
  })
}
