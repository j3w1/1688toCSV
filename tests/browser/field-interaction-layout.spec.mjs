import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { applyCodeDesign } from '../../src/code-design.js'
import { test, expect } from './extension-fixture.mjs'

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

test('code inputs preserve their value after selecting text beyond the field', async ({
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
      }))
      expect(selected.end).toBeGreaterThan(selected.start)
      await page.getByRole('button', { name: 'Leave field' }).click()
      await expect(input).toHaveValue(original)
    }
  }
  await page.close()
})
