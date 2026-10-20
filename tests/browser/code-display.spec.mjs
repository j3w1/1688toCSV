import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
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
    transform: 'matrix(1, 0, 0, 0.5, 0, 0)',
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
  ).toMatch(/ 0\.5px$/)
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

test('Excel barcode-column PNGs carry a lower white product-only hairline in every language and scheme', async ({
  extension,
}) => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  const script = await build({
    stdin: {
      contents: `export { planExcelImage, renderExcelImage } from './src/excel-image.js';`,
      resolveDir: root,
    },
    bundle: true,
    format: 'iife',
    globalName: 'CodeImage',
    write: false,
  })
  await page.addScriptTag({ content: script.outputFiles[0].text })
  const result = await page.evaluate(async () => {
    const results = []
    let screenshot
    for (const language of ['en', 'es', 'zh'])
      for (const scheme of ['neutral', 'warm', 'sage', 'ink', 'custom']) {
        const rows = ['A', 'BL', 'XYZ'.repeat(15)].map((ending, index) => ({
          orderId: 'synthetic-order',
          groupId: 'synthetic-group',
          title: 'Synthetic storage box',
          description: 'Synthetic storage box',
          baseCode: 'CE26103102',
          barcode: `CE26103102${ending}`,
          chineseCategory: '收纳',
          price: '5.00',
          quantity: String(index + 1),
        }))
        const [plan] = CodeImage.planExcelImage(rows, {
          columns: ['description', 'barcode', 'quantity'],
          language,
          style: { scheme },
          showOrderDetails: false,
        })
        const lines = []
        const prototype = CanvasRenderingContext2D.prototype
        const original = prototype.fillRect
        prototype.fillRect = function (x, y, width, height) {
          if (height === 0.5)
            lines.push({ x, y, width, height, color: this.fillStyle })
          return original.call(this, x, y, width, height)
        }
        let rendered
        try {
          rendered = await CodeImage.renderExcelImage(plan)
        } finally {
          prototype.fillRect = original
        }
        const bitmap = await createImageBitmap(rendered.blob)
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d')
        context.drawImage(bitmap, 0, 0)
        bitmap.close()
        const samples = lines.map((line) => {
          const x = Math.floor((line.x + line.width / 2) * 2)
          const near = Math.floor(line.y * 2)
          let brightest = { value: -1, y: near }
          for (let y = near - 1; y <= near + 2; y++) {
            const value = context.getImageData(x, y, 1, 1).data[0]
            if (value > brightest.value) brightest = { value, y }
          }
          return {
            bright: brightest.value,
            before: [
              ...context.getImageData(
                Math.floor(line.x * 2) - 2,
                brightest.y,
                1,
                1
              ).data,
            ],
            after: [
              ...context.getImageData(
                Math.ceil((line.x + line.width) * 2) + 1,
                brightest.y,
                1,
                1
              ).data,
            ],
          }
        })
        if (language === 'zh' && scheme === 'neutral')
          screenshot = await new Promise((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result.split(',')[1])
            reader.readAsDataURL(rendered.blob)
          })
        results.push({ language, scheme, lines, samples })
      }
    return { results, screenshot }
  })
  expect(result.results).toHaveLength(15)
  for (const example of result.results) {
    expect(example.lines, `${example.language}/${example.scheme}`).toHaveLength(
      3
    )
    for (const line of example.lines) {
      expect(line.color).toBe('#ffffff')
      expect(line.height).toBe(0.5)
    }
    for (const sample of example.samples) {
      expect(sample.bright).toBeGreaterThan(120)
      expect(sample.before.slice(0, 3).every((channel) => channel < 30)).toBe(
        true
      )
      expect(sample.after.slice(0, 3).every((channel) => channel < 30)).toBe(
        true
      )
    }
  }
  await mkdir(`${root}/work`, { recursive: true })
  await writeFile(
    `${root}/work/excel-code-underline.png`,
    Buffer.from(result.screenshot, 'base64')
  )
  await page.close()
})

test('composed packing codes share an ink baseline with editable suffixes and keep native selection stable', async ({
  extension,
}) => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const page = await extension.context.newPage()
  await page.setViewportSize({ width: 1000, height: 640 })
  await page.goto(`${extension.origin}/unsupported`)
  await page.setContent(
    '<main class="preparation-workspace"><section class="preparation-group"><table class="variants"><tbody></tbody></table></section></main><button id="leave">Leave field</button>'
  )
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
      contents: `export { applyCodeDesign } from './src/code-design.js'; export { setCodeText } from './src/code-display.js';`,
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
    const body = document.querySelector('tbody')
    for (const [variant, size] of [
      ['A', 'L'],
      ['B', 'M'],
      ['AX', 'S'],
      ['D', 'XL'],
    ]) {
      const row = document.createElement('tr')
      row.innerHTML =
        '<td><fieldset class="variant-code-options"><div class="variant-code-design"><div class="variant-code-band ce-code"><div class="code-base-part"><code class="variant-code-base"></code></div></div></div></fieldset></td>'
      CodeUI.setCodeText(row.querySelector('code'), 'CE26103102')
      const band = row.querySelector('.variant-code-band')
      for (const [name, value] of [
        ['Variant code', variant],
        ['Size code', size],
      ]) {
        const label = document.createElement('label')
        label.className = 'preparation-inline-field'
        const hidden = document.createElement('span')
        hidden.className = 'visually-hidden'
        hidden.textContent = name
        const input = document.createElement('input')
        input.value = value
        input.setAttribute('aria-label', name)
        label.append(hidden, input)
        band.append(label)
      }
      body.append(row)
    }
  })
  const bands = page.locator('.variant-code-band')
  await expect(bands).toHaveCount(4)
  for (const band of await bands.all()) {
    await expect(band).toHaveCSS('font-size', '16px')
    await expect(band).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    await expect(band).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect(band).toHaveCSS('font-weight', '700')
  }
  const bounds = await bands.evaluateAll((nodes) =>
    nodes.map((node) => {
      const band = node.getBoundingClientRect()
      const prefix = node
        .querySelector('[data-code-part="prefix-period"]')
        .getBoundingClientRect()
      return {
        band: { x: band.x, y: band.y, width: band.width, height: band.height },
        regions: [
          prefix,
          ...[...node.querySelectorAll('input')].map((input) =>
            input.getBoundingClientRect()
          ),
        ].map((rect) => ({ x: rect.x, width: rect.width })),
      }
    })
  )
  const screenshot = await page.screenshot()
  const ink = await page.evaluate(
    async ({ screenshot, bounds }) => {
      const image = new Image()
      image.src = `data:image/png;base64,${screenshot}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      return bounds.map(({ band, regions }) =>
        regions.map((region) => {
          const x = Math.ceil(region.x),
            y = Math.floor(band.y)
          const width = Math.max(1, Math.floor(region.x + region.width) - x)
          const height = Math.ceil(band.y + band.height) - y
          const pixels = context.getImageData(x, y, width, height).data
          const rows = []
          for (let row = 0; row < height; row++)
            for (let column = 0; column < width; column++) {
              const offset = (row * width + column) * 4
              if (
                pixels[offset] > 220 &&
                pixels[offset + 1] > 220 &&
                pixels[offset + 2] > 220
              ) {
                rows.push(row)
                break
              }
            }
          return { top: Math.min(...rows), bottom: Math.max(...rows) }
        })
      )
    },
    { screenshot: screenshot.toString('base64'), bounds }
  )
  for (const row of ink)
    for (const suffix of row.slice(1)) {
      expect(Number.isFinite(suffix.top)).toBe(true)
      expect(Math.abs(suffix.top - row[0].top)).toBeLessThanOrEqual(1)
      expect(Math.abs(suffix.bottom - row[0].bottom)).toBeLessThanOrEqual(1)
    }
  for (const input of await page.locator('.variant-code-band input').all()) {
    await input.focus()
    await input.evaluate((node) => {
      node.setSelectionRange(0, node.value.length)
      node.scrollTop = 100
    })
    expect(await input.evaluate((node) => node.scrollTop)).toBe(0)
    await expect(input).toHaveCSS('text-box-trim', 'none')
  }
  await page.locator('#leave').click()
  await mkdir(`${root}/work`, { recursive: true })
  await page
    .locator('.preparation-group')
    .screenshot({ path: `${root}/work/variant-code-alignment.png` })
  await page.close()
})
