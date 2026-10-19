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

test('change reviews paginate every product and return the chosen decision', async ({
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
    await expect(actions.getByRole('button')).toHaveCount(3)
    await expect(dialog.locator('.packing-review-item')).toHaveCount(12)
    // Every product remains reviewable before choosing the alternate action.
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
    await page.mouse.move(2, 2)
    await expect(dialog.getByRole('tooltip')).toHaveCount(0)
    await actions.getByRole('button').nth(1).click()
    expect(await page.evaluate(async () => await window.reviewPromise)).toBe(
      'assign-only'
    )
    await expect(dialog).toHaveCount(0)
  }
  await page.close()
})

test('scope confirmation cancels without accepting and restores keyboard focus', async ({
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
  await page.keyboard.press('Escape')
  expect(await page.evaluate(async () => await window.reviewPromise)).toBe(
    false
  )
  await expect(page.locator('#launch')).toBeFocused()
  await page.close()
})
