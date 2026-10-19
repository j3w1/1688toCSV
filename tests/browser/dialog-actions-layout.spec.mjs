import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { test, expect } from './extension-fixture.mjs'

let source, styles
test.beforeAll(async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const script = await build({
    stdin: {
      contents: `export { reviewPackingChanges } from './src/packing-review.js';
        export { confirmScope } from './src/ui.js';
        export { applyCodeDesign } from './src/code-design.js';
        export { setLanguage } from './src/i18n.js';`,
      resolveDir: root,
    },
    bundle: true,
    format: 'iife',
    globalName: 'Review',
    write: false,
  })
  source = script.outputFiles[0].text
  styles = []
  for (const name of ['library', 'packing', 'code-design']) {
    const result = await build({
      entryPoints: [`${root}/src/${name}.css`],
      bundle: true,
      write: false,
    })
    styles.push(result.outputFiles[0].text)
  }
})

async function fixture(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.setContent(
    '<main style="height:3000px"><button id="launch">Review products</button></main>'
  )
  for (const content of styles) await page.addStyleTag({ content })
  await page.addScriptTag({ content: source })
  await page.evaluate(() => Review.applyCodeDesign(document.documentElement))
  return page
}

test('long change reviews keep every decision at the top while all products remain reachable', async ({
  extension,
}) => {
  const page = await fixture(extension)
  for (const [width, language] of [
    [1280, 'en'],
    [600, 'es'],
    [390, 'zh'],
  ]) {
    await page.setViewportSize({ width, height: 700 })
    await page.evaluate((language) => {
      Review.setLanguage(language, { persist: false })
      document.querySelector('#launch').onclick = () => {
        window.reviewResult = undefined
        window.reviewPromise = Review.reviewPackingChanges({
          title: 'Assign product codes?',
          explanation: 'Review the product codes in this order.',
          changes: Array.from({ length: 15 }, (_, index) => ({
            name: `Synthetic product ${index + 1}`,
            order: 'Synthetic review store',
            before: 'Not prepared',
            after: `CE261001${String(index + 1).padStart(2, '0')}`,
            detail:
              'Synthetic description with enough detail to review each product before assigning its code.',
          })),
          proceed: 'Assign codes and prepare',
          alternate: {
            label: 'Assign only',
            value: 'assign-only',
            help: 'Review the product codes in this order.',
          },
        })
      }
    }, language)
    await page.locator('#launch').click()
    const dialog = page.locator('.packing-change-dialog')
    const actions = dialog.locator('.scroll-dialog-actions')
    const content = dialog.locator('.scroll-dialog-content')
    await expect(actions.getByRole('button')).toHaveCount(3)
    const before = await actions.boundingBox()
    const body = await content.boundingBox()
    expect(before.y + before.height).toBeLessThanOrEqual(body.y)
    await dialog.screenshot({
      path: test.info().outputPath(`packing-review-actions-${width}.png`),
    })
    expect(
      await content.evaluate((node) => node.scrollHeight > node.clientHeight)
    ).toBe(true)
    await content.evaluate((node) => node.scrollTo(0, node.scrollHeight))
    await expect(
      dialog.getByText('Synthetic product 12', { exact: true })
    ).toBeInViewport()
    expect(await actions.boundingBox()).toEqual(before)
    for (const button of await actions.getByRole('button').all())
      await expect(button).toBeInViewport()
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    ).toBe(true)
    expect(await page.evaluate(() => document.scrollingElement.scrollTop)).toBe(
      0
    )
    // Pagination still exposes every remaining product, with the same action bar.
    await dialog
      .locator('.scroll-dialog-content .dialog-actions button')
      .last()
      .click()
    await expect(dialog.locator('.packing-review-item')).toHaveCount(3)
    await expect(
      dialog.getByText('Synthetic product 15', { exact: true })
    ).toBeVisible()
    await actions.getByRole('button').nth(1).hover()
    await expect(dialog.getByRole('tooltip')).toBeVisible()
    const after = await actions.boundingBox()
    await page.mouse.move(2, 2)
    await expect(dialog.getByRole('tooltip')).toHaveCount(0)
    expect(await actions.boundingBox()).toEqual(after)
    await actions.getByRole('button').nth(1).click()
    expect(await page.evaluate(async () => await window.reviewPromise)).toBe(
      'assign-only'
    )
    await expect(dialog).toHaveCount(0)
  }
  await page.close()
})

test('short scope confirmations retain their compact layout and safe cancellation', async ({
  extension,
}) => {
  const page = await fixture(extension)
  await page.evaluate(() => {
    document.querySelector('#launch').onclick = () => {
      window.reviewPromise = Review.confirmScope({
        action: 'Refresh',
        count: 1,
      })
    }
  })
  await page.locator('#launch').click()
  const dialog = page.locator('.scope-dialog')
  await expect(dialog).not.toHaveClass(/scroll-dialog/)
  const text = await dialog.locator('p').boundingBox()
  const actions = await dialog.locator('.dialog-actions').boundingBox()
  expect(actions.y).toBeGreaterThanOrEqual(text.y + text.height)
  await page.keyboard.press('Escape')
  expect(await page.evaluate(async () => await window.reviewPromise)).toBe(
    false
  )
  await expect(page.locator('#launch')).toBeFocused()
  await page.close()
})
