import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { test, expect } from './extension-fixture.mjs'

test('workspace uses white hairlines on product digits across readouts and native fields without altering codes or artwork', async ({
  extension,
}) => {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.setContent(
    '<main class="preparation-workspace"><section class="preparation-group"></section></main><button id="leave">Leave field</button>'
  )
  const root = fileURLToPath(new URL('../../', import.meta.url))
  for (const name of ['library', 'packing', 'code-design', 'shell']) {
    const css = await build({
      entryPoints: [`${root}/src/${name}.css`],
      bundle: true,
      write: false,
    })
    await page.addStyleTag({ content: css.outputFiles[0].text })
  }
  const script = await build({
    stdin: {
      contents: `export { element, copyTextButton } from './src/ui.js'; export { applyCodeDesign } from './src/code-design.js'; export { decorateCodeInput, refreshCodeInput } from './src/code-display.js'; export { showErrorNotice } from './src/error-notice.js';`,
      resolveDir: root,
    },
    bundle: true,
    format: 'iife',
    globalName: 'CodeUI',
    write: false,
  })
  await page.addScriptTag({ content: script.outputFiles[0].text })
  await page.evaluate(() => {
    CodeUI.applyCodeDesign(document.documentElement)
    const host = document.querySelector('.preparation-group')
    host.append(CodeUI.element('code', 'CE26103102', 'ce-code plain-badge'))
    host.append(CodeUI.element('code', 'CE26103102ALS', 'ce-code ending-badge'))
    host.append(CodeUI.element('output', 'CE26103102', 'ce-code output-badge'))
    const raw = document.createElement('code')
    raw.className = 'ce-code raw-reference'
    raw.textContent = 'CE26103102'
    host.append(raw)
    host.append(
      CodeUI.copyTextButton('CE26103102', {
        className: 'ce-code',
        label: 'Copy code',
      })
    )
    window.copies = []
    navigator.clipboard.writeText = async (value) => window.copies.push(value)
    const input = CodeUI.element(
      'input',
      undefined,
      'group-code-editor ce-code'
    )
    input.value = 'CE26103102'
    input.setAttribute('aria-label', 'Product code')
    host.append(input)
    CodeUI.decorateCodeInput(input)
  })
  const badge = page.locator('.plain-badge')
  await expect(badge.locator('.ce-code-part')).toHaveText(['CE2610', '3102'])
  await expect(page.locator('.ending-badge .ce-code-part')).toHaveText([
    'CE2610',
    '3102',
    'ALS',
  ])
  await expect(page.locator('.output-badge')).toHaveJSProperty(
    'value',
    'CE26103102'
  )
  expect(
    await badge.evaluate((node) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      const selection = getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      return selection.toString()
    })
  ).toBe('CE26103102')
  await expect(badge).toHaveCSS('background-color', 'rgb(0, 0, 0)')
  await expect(badge).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect(badge).toHaveCSS('font-weight', '700')
  const parts = await badge.locator('.ce-code-part').evaluateAll((nodes) =>
    nodes.map((node) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      return range.getBoundingClientRect().toJSON()
    })
  )
  expect(Math.abs(parts[1].x - parts[0].x - parts[0].width)).toBeLessThan(0.1)
  expect(
    await badge.locator('[data-code-part="product"]').evaluate((node) => {
      const line = getComputedStyle(node, '::after')
      return {
        color: line.backgroundColor,
        height: line.height,
        transform: line.transform,
      }
    })
  ).toEqual({
    color: 'rgb(255, 255, 255)',
    height: '1px',
    transform: 'matrix(1, 0, 0, 0.25, 0, 0)',
  })
  await expect(badge.locator('[data-code-part="prefix-period"]')).toHaveCSS(
    'text-decoration-line',
    'none'
  )
  await expect(page.locator('[data-code-part="ending"]')).toHaveCSS(
    'text-decoration-line',
    'none'
  )
  const preview = page.locator('.raw-reference')
  await expect(preview.locator('.ce-code-part')).toHaveCount(0)
  const [shown, plain] = await Promise.all([
    badge.boundingBox(),
    preview.boundingBox(),
  ])
  expect(shown.width).toBeCloseTo(plain.width, 1)
  expect(shown.height).toBeCloseTo(plain.height, 1)
  await page
    .getByRole('button', { name: 'Copy code: CE26103102', exact: true })
    .click()
  expect(await page.evaluate(() => window.copies)).toEqual(['CE26103102'])
  const input = page.getByRole('textbox', { name: 'Product code', exact: true })
  await expect(page.locator('.ce-code-reading')).toHaveCount(0)
  await expect(input).toHaveCSS(
    'background-image',
    'linear-gradient(rgb(255, 255, 255), rgb(255, 255, 255))'
  )
  expect(
    await input.evaluate((node) => getComputedStyle(node).backgroundSize)
  ).toMatch(/ 0\.25px$/)
  await expect(input).toHaveAttribute('aria-label', 'Product code')
  await input.focus()
  await expect(input).toHaveCSS('color', 'rgb(255, 255, 255)')
  await input.fill('CE26103109')
  await page.locator('#leave').click()
  await expect(input).toHaveValue('CE26103109')
  await input.fill('unfinished')
  await page.locator('#leave').click()
  await expect(input).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect(input).toHaveCSS('text-decoration-line', 'none')
  await expect(input).toHaveCSS('background-image', 'none')
  await input.evaluate((node) => {
    node.value = 'CE26103110'
    CodeUI.refreshCodeInput(node)
  })
  await expect(input).toHaveClass(/ce-code-input-readable/)
  await expect(input).toHaveValue('CE26103110')
  await page.evaluate(() => {
    const editor = document.createElement('section')
    editor.className = 'label-editor'
    document.body.append(editor)
    CodeUI.showErrorNotice('Review this code', {
      scope: editor,
      context: { code: 'CE26103102' },
    })
  })
  await expect(page.locator('.label-editor code')).toHaveText('CE26103102')
  await expect(
    page.locator('.label-editor [data-code-part="product"]')
  ).toHaveText('3102')
  await page.close()
})
