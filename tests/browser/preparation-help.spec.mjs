import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { test, expect } from './extension-fixture.mjs'

let helpSource, libraryStyle
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `export { preparationHelp } from './preparation-help.js';
        export { productContextHelp } from './item-context-help.js';
        export { copyTextButton } from './ui.js';
        export { setLanguage } from './i18n.js';`,
      resolveDir: fileURLToPath(new URL('../../src/', import.meta.url)),
      sourcefile: 'preparation-help-fixture.js',
    },
    bundle: true,
    format: 'iife',
    globalName: 'PreparationHelp',
    write: false,
  })
  helpSource = result.outputFiles[0].text
  const css = await build({
    entryPoints: [
      fileURLToPath(new URL('../../src/library.css', import.meta.url)),
    ],
    bundle: true,
    write: false,
  })
  libraryStyle = css.outputFiles[0].text
})

test('copy helpers use short translated wording while accessible labels retain the item value', async ({
  extension,
}) => {
  const page = await helpFixture(extension)
  await page.evaluate(() => {
    const copy = PreparationHelp.copyTextButton('18', { label: 'Copy Pcs/box' })
    copy.id = 'compact-copy'
    document.querySelector('dialog').append(copy)
  })
  for (const [language, text] of [
    ['en', 'Click to copy'],
    ['es', 'Haz clic para copiar'],
    ['zh', '点击复制'],
  ]) {
    await page.mouse.move(1, 1)
    await page.evaluate(
      (language) => PreparationHelp.setLanguage(language, { persist: false }),
      language
    )
    await page.locator('#compact-copy').hover()
    await expect(page.getByRole('tooltip')).toHaveText(text)
    await expect(page.locator('#compact-copy')).toHaveAttribute(
      'aria-label',
      /18$/
    )
  }
  await page.close()
})

async function helpFixture(
  extension,
  { fallback = false, clock = false } = {}
) {
  const page = await extension.context.newPage()
  if (clock) await page.clock.install()
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
  test(`${fallback ? 'fallback' : 'native'} text helper never blocks an adjacent action in a compact dialog`, async ({
    extension,
  }) => {
    const page = await helpFixture(extension, { fallback })
    await page.setViewportSize({ width: 390, height: 600 })
    await page.addStyleTag({
      content:
        'dialog { width: 300px; padding: 20px; } #field { margin: 0 0 8px; } #existing { display: none; }',
    })
    await page.locator('#action').evaluate((button) => {
      button.addEventListener('click', () => {
        button.dataset.activated = 'true'
      })
    })
    await page.locator('#field input').focus()
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toBeVisible()
    const overlap = await page.locator('#action').evaluate((button) => {
      const action = button.getBoundingClientRect(),
        hint = document.querySelector('[role=tooltip]').getBoundingClientRect(),
        x = action.x + action.width / 2,
        y = action.y + action.height / 2
      return (
        x >= hint.left && x <= hint.right && y >= hint.top && y <= hint.bottom
      )
    })
    expect(overlap).toBe(true)
    await page.locator('#action').click({ timeout: 3000 })
    await expect(page.locator('#action')).toHaveAttribute(
      'data-activated',
      'true'
    )
    await expect(tooltip).toHaveCount(0)
    await page.close()
  })

  test(`${fallback ? 'fallback' : 'native'} workspace hint dismisses while Escape reaches the owning view`, async ({
    extension,
  }) => {
    const page = await helpFixture(extension, { fallback })
    await page.evaluate(() => {
      document.querySelector('dialog').close()
      const view = document.createElement('section')
      view.id = 'packing-view'
      view.append(document.querySelector('#field'))
      view.addEventListener(
        'keydown',
        (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          view.hidden = true
        },
        true
      )
      document.body.append(view)
    })
    await page.locator('#field input').focus()
    await expect(page.getByRole('tooltip')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await expect(page.locator('#packing-view')).toBeHidden()
    await expect(page.locator('dialog')).toHaveJSProperty('open', false)
    await page.close()
  })

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

for (const fallback of [false, true]) {
  for (const rich of [false, true]) {
    test(`${fallback ? 'fallback' : 'native'} ${rich ? 'rich context' : 'text helper'} follows movement inside a large row and flips at viewport edges`, async ({
      extension,
    }) => {
      const page = await helpFixture(extension, { fallback })
      await page.setViewportSize({ width: 1000, height: 720 })
      await page.addStyleTag({ content: libraryStyle })
      await page.evaluate((rich) => {
        document.querySelector('dialog').close()
        const row = document.createElement('div')
        row.id = 'large-hover-row'
        row.tabIndex = 0
        row.style.cssText = 'position:fixed;inset:20px;background:#ddd;'
        row.textContent = 'Synthetic large product row'
        row.dataset.selected = 'true'
        document.body.append(row)
        if (rich) {
          PreparationHelp.productContextHelp(row, {
            getProduct: () => ({
              entryId: 'synthetic-hover',
              description: 'Synthetic hover product',
              orderId: '1001',
              quantity: '10',
              price: '2.50',
              thumbnail: 'delayed-photo',
            }),
            getRecord: () => ({
              snapshot: { sellerName: 'Synthetic supplier' },
            }),
            loadImage: () =>
              new Promise((resolve) => {
                window.resolveHoverImage = resolve
              }),
          })
        } else
          preparationHelp(
            row,
            'A text helper follows the mouse across this row.'
          )
      }, rich)
      const tooltip = page.getByRole('tooltip')
      await page.mouse.move(80, 80)
      await expect(tooltip).toBeVisible()
      await expect(tooltip).toHaveCSS('pointer-events', 'none')
      const id = await tooltip.getAttribute('id')
      const first = await tooltip.boundingBox()
      expect(Math.abs(first.x - 92)).toBeLessThanOrEqual(1)
      expect(Math.abs(first.y - 92)).toBeLessThanOrEqual(1)
      await page.mouse.move(180, 140, { steps: 5 })
      await expect.poll(async () => (await tooltip.boundingBox()).x).toBe(192)
      const moved = await tooltip.boundingBox()
      expect(Math.abs(moved.y - 152)).toBeLessThanOrEqual(1)
      await expect(tooltip).toHaveAttribute('id', id)
      const point = { x: 972, y: 692 }
      await page.mouse.move(point.x, point.y, { steps: 5 })
      await expect
        .poll(async () => {
          const box = await tooltip.boundingBox()
          return Math.round(box.x + box.width)
        })
        .toBe(point.x - 12)
      const edge = await tooltip.boundingBox()
      expect(edge.x).toBeGreaterThanOrEqual(8)
      expect(edge.y).toBeGreaterThanOrEqual(8)
      expect(
        Math.abs(edge.y + edge.height - (point.y - 12))
      ).toBeLessThanOrEqual(1)
      expect(edge.x + edge.width).toBeLessThanOrEqual(992)
      expect(edge.y + edge.height).toBeLessThanOrEqual(712)
      if (rich) {
        await expect(tooltip.locator('img')).toHaveCount(1)
        await page.evaluate(() =>
          window.resolveHoverImage('data:image/png;base64,broken')
        )
        await expect(tooltip.locator('img')).toHaveCount(0)
        await expect
          .poll(async () =>
            Math.round(
              (await tooltip.boundingBox()).y +
                (await tooltip.boundingBox()).height
            )
          )
          .toBe(point.y - 12)
        const reflowed = await tooltip.boundingBox()
        expect(reflowed.y).toBeGreaterThan(edge.y)
      }
      await expect(page.locator('#large-hover-row')).toHaveAttribute(
        'data-selected',
        'true'
      )
      await page.mouse.move(5, 5)
      await expect(tooltip).toHaveCount(0)
      await page.locator('#large-hover-row').evaluate((row) => {
        row.style.cssText =
          'position:fixed;left:30px;top:60px;width:600px;height:120px;'
      })
      await page.keyboard.press('Tab')
      await page.locator('#large-hover-row').focus()
      await expect(tooltip).toBeVisible()
      const keyboard = await tooltip.boundingBox()
      expect(Math.abs(keyboard.x - 30)).toBeLessThanOrEqual(1)
      expect(Math.abs(keyboard.y - 188)).toBeLessThanOrEqual(1)
      await page.close()
    })
  }
}

test('moving onto a nested action suppresses its row helper and follows the action’s pointer instead', async ({
  extension,
}) => {
  const page = await helpFixture(extension)
  await page.evaluate(() => {
    document.querySelector('dialog').close()
    const row = document.createElement('div')
    row.id = 'hover-parent'
    row.style.cssText =
      'position:fixed;left:20px;top:20px;width:600px;height:300px;'
    const action = document.createElement('button')
    action.id = 'nested-action'
    action.style.cssText =
      'position:absolute;left:200px;top:50px;width:180px;height:50px;'
    action.textContent = 'Nested action'
    row.append(action)
    document.body.append(row)
    preparationHelp(row, 'Row helper')
    preparationHelp(action, 'Nested action helper')
  })
  await page.mouse.move(50, 50)
  await expect(page.getByRole('tooltip')).toHaveText('Row helper')
  await page.mouse.move(240, 85)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await expect(page.getByRole('tooltip')).toHaveText('Nested action helper')
  await page.mouse.move(280, 100)
  await expect
    .poll(async () => (await page.getByRole('tooltip').boundingBox()).x)
    .toBe(292)
  await page.mouse.move(5, 5)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
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

for (const fallback of [false, true]) {
  test(`a ${fallback ? 'fallback' : 'native'} hint cannot consume Escape or reopen beneath another modal`, async ({
    extension,
  }) => {
    const page = await helpFixture(extension, { fallback, clock: true })
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
    // Run the queued 500 ms hover callback while the other modal owns focus.
    await page.clock.fastForward(501)
    await expect(page.locator('.preparation-help-popover')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('#photo')).toHaveJSProperty('open', false)
    await page.close()
  })
}
