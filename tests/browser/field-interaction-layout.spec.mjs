import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { applyCodeDesign } from '../../src/code-design.js'
import { test, expect } from './extension-fixture.mjs'

let helpSource
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `export { preparationHelp } from './src/preparation-help.js';
        export { pinDialogActions } from './src/ui.js';`,
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
    },
    bundle: true,
    format: 'iife',
    globalName: 'PreparationHelp',
    write: false,
  })
  helpSource = result.outputFiles[0].text
})

async function fixture(extension, html) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.setContent(html)
  for (const name of ['library', 'packing', 'code-design']) {
    const result = await build({
      entryPoints: [
        fileURLToPath(new URL(`../../src/${name}.css`, import.meta.url)),
      ],
      bundle: true,
      write: false,
    })
    await page.addStyleTag({
      content: result.outputFiles[0].text,
    })
  }
  const variables = {}
  applyCodeDesign({
    style: {
      setProperty: (name, value) => {
        variables[name] = value
      },
    },
  })
  await page.evaluate((variables) => {
    for (const [name, value] of Object.entries(variables))
      document.documentElement.style.setProperty(name, value)
    document.body.style.padding = '60px'
  }, variables)
  return page
}

for (const fallback of [false, true]) {
  test(`${fallback ? 'fallback' : 'native'} conflict help preserves the top action bar and button geometry`, async ({
    extension,
  }) => {
    const page = await fixture(
      extension,
      `<dialog class="packing-review code-conflict-dialog">
        <h2>Resolve code conflict</h2>
        <p>Choose a correction before applying changes.</p>
        <section class="packing-review-item"><strong>Product you are editing</strong></section>
        <div class="dialog-actions"><button>Apply corrections</button><button id="keep-saved">Keep saved version</button><button>Continue editing</button></div>
      </dialog>`
    )
    if (fallback)
      await page.evaluate(() => {
        delete HTMLElement.prototype.popover
      })
    await page.addScriptTag({ content: helpSource })
    await page.evaluate(() => {
      PreparationHelp.pinDialogActions(
        document.querySelector('dialog'),
        document.querySelector('.dialog-actions')
      )
      PreparationHelp.preparationHelp(
        document.querySelector('#keep-saved'),
        'Discard the unsaved draft and reload the latest saved packing values for this order.'
      )
      document.querySelector('dialog').showModal()
    })
    for (const width of [1200, 520]) {
      await page.setViewportSize({ width, height: 900 })
      await page.mouse.move(2, 2)
      const geometry = () =>
        page
          .locator('dialog, .dialog-actions, .dialog-actions button')
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getBoundingClientRect().toJSON())
          )
      const before = await geometry()
      await page.locator('#keep-saved').hover()
      await expect(page.getByRole('tooltip')).toBeVisible()
      expect(await geometry()).toEqual(before)
      await expect(
        page.getByRole('button', { name: 'Keep saved version' })
      ).toHaveAccessibleDescription(/Discard the unsaved draft/)
      await page.mouse.move(2, 2)
      await expect(page.getByRole('tooltip')).toHaveCount(0)
      expect(await geometry()).toEqual(before)
    }
    await page.close()
  })
}

test('single-line code inputs retain their full text after dragging a selection beyond their edges', async ({
  extension,
}) => {
  const page = await fixture(
    extension,
    `<main class="preparation-workspace">
      <section class="preparation-group"><input aria-label="Group code" class="group-code-editor ce-code" value="CE26103101"></section>
      <section class="conflict-code-editor"><input aria-label="Correction code" class="ce-code" value="CE26103103"></section>
      <section><input aria-label="Large code" class="ce-code" style="--ce-code-size:28px;field-sizing:content" value="CE26103105"></section>
      <button>Leave field</button>
    </main>`
  )
  for (const name of ['Group code', 'Correction code', 'Large code']) {
    const input = page.getByRole('textbox', { name })
    const initial = await input.boundingBox()
    const original = await input.inputValue()
    for (const vertical of [50, -50]) {
      await input.fill(original.replace(/.$/, '9'))
      await input.fill(original)
      const box = await input.boundingBox()
      await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + 20, box.y + vertical, { steps: 15 })
      await page.mouse.up()
      const selected = await input.evaluate((node) => ({
        start: node.selectionStart,
        end: node.selectionEnd,
        top: node.scrollTop,
        height: node.clientHeight,
        contentHeight: node.scrollHeight,
      }))
      expect(selected.end).toBeGreaterThan(selected.start)
      expect(selected.top).toBe(0)
      expect(selected.contentHeight).toBeLessThanOrEqual(selected.height + 1)
      await page.getByRole('button', { name: 'Leave field' }).click()
      await expect(input).toHaveValue(original)
      expect(await input.evaluate((node) => node.scrollTop)).toBe(0)
      expect(await input.boundingBox()).toEqual(initial)
    }
    // The fix must keep the approved black/white badge and contextual sizing.
    expect(
      await input.evaluate((node) => getComputedStyle(node).backgroundColor)
    ).toBe('rgb(0, 0, 0)')
    expect(await input.evaluate((node) => getComputedStyle(node).color)).toBe(
      'rgb(255, 255, 255)'
    )
  }
  await page.close()
})
