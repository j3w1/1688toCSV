import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { test, expect } from './extension-fixture.mjs'
import {
  seedSmartOrder,
  openSmartLibrary,
  libraryBackup,
  revealOrderCard,
} from './smart-workspace-helpers.mjs'

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
  for (const name of ['library', 'packing', 'code-design', 'shell']) {
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

test('change reviews show every product continuously and return the chosen decision', async ({
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
          title: 'Review source changes',
          explanation: 'Review the product codes in this order.',
          changes: Array.from({ length: 15 }, (_, index) => ({
            name: `Synthetic product ${index + 1}`,
            order: 'Synthetic review store',
            before: 'Not prepared',
            after: `CE261001${String(index + 1).padStart(2, '0')}`,
            detail:
              'Synthetic description with enough detail to review each product before assigning its code.',
          })),
          proceed: 'Use reviewed changes',
          alternate: {
            label: 'Keep saved version',
            value: 'saved',
            help: 'Review the product codes in this order.',
          },
        })
      }
    }, language)
    await page.locator('#launch').click()
    const dialog = page.locator('.packing-change-dialog')
    const actions = dialog.locator('.scroll-dialog-actions')
    await expect(actions.getByRole('button')).toHaveCount(3)
    await expect(dialog.locator('.packing-review-item')).toHaveCount(15)
    await expect(
      dialog.locator('.scroll-dialog-content .dialog-actions')
    ).toHaveCount(0)
    await dialog
      .getByText('Synthetic product 15', { exact: true })
      .scrollIntoViewIfNeeded()
    await expect(
      dialog.getByText('Synthetic product 15', { exact: true })
    ).toBeVisible()
    await actions.getByRole('button').nth(1).hover()
    await expect(dialog.getByRole('tooltip')).toBeVisible()
    await page.mouse.move(2, 2)
    await expect(dialog.getByRole('tooltip')).toHaveCount(0)
    await actions.getByRole('button').nth(1).click()
    expect(await page.evaluate(async () => await window.reviewPromise)).toBe(
      'saved'
    )
    await expect(dialog).toHaveCount(0)
  }
  await page.close()
})

async function actualCodeReview(extension, count, options = {}) {
  await seedSmartOrder(extension, { count, assignCodes: false, ...options })
  const page = await openSmartLibrary(extension)
  await page.locator('#select-rows').click()
  const before = await libraryBackup(extension)
  await page.locator('#review-purchase-codes').click()
  const review = page.locator('dialog[data-action="purchase-code-review"]')
  await expect(review).toBeVisible()
  return { page, review, before }
}

test('three source products expose exact full purchase codes and original photos in one real Orders review', async ({
  extension,
}, testInfo) => {
  const { page, review, before } = await actualCodeReview(extension, 3)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(review.locator('article')).toHaveCount(3)
  const codes = await review.locator('.purchase-code').allTextContents()
  expect(codes).toHaveLength(3)
  expect(codes.every((code) => /^CE2609\d{4}[A-Z0-9]*$/.test(code))).toBe(true)
  for (const code of await review.locator('.purchase-code').all()) {
    await expect(code).toBeInViewport()
    await expect(code.locator('[data-code-part="product"]')).toHaveCount(1)
    await expect(code).toHaveCSS('font-size', '16px')
  }
  const photo = await review
      .locator('.preparation-photo')
      .first()
      .boundingBox(),
    bounds = await review.boundingBox()
  expect(photo.width).toBe(96)
  expect(photo.height).toBe(96)
  expect(bounds.width).toBeGreaterThan(700)
  expect(bounds.width).toBeLessThan(1000)
  expect(bounds.height).toBeLessThan(1000)
  expect((await libraryBackup(extension)).orders).toEqual(before.orders)
  expect((await libraryBackup(extension)).preparations).toEqual(
    before.preparations
  )
  await review.screenshot({
    path: testInfo.outputPath('purchase-code-review-three.png'),
  })
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await libraryBackup(extension)).issuedCodes).toEqual(
    before.issuedCodes
  )
})

test('small and moderate real purchase reviews keep every full code readable before one assignment', async ({
  extension,
}) => {
  for (const count of [3, 8]) {
    const ref = await seedSmartOrder(extension, {
        count,
        assignCodes: false,
        orderId: String(800000000000000000n + BigInt(count)),
        supplierId: `synthetic-review-${count}`,
      }),
      page = await openSmartLibrary(extension)
    const card = await revealOrderCard(page, ref)
    await card.getByRole('checkbox').check()
    await page.locator('#select-rows').click()
    await page.locator('#review-purchase-codes').click()
    const review = page.locator('[data-action="purchase-code-review"]')
    await expect(review.locator('article')).toHaveCount(count)
    await expect(review.locator('.purchase-code')).toHaveCount(count)
    const before = await libraryBackup(extension)
    for (const code of await review.locator('.purchase-code').all()) {
      await code.scrollIntoViewIfNeeded()
      await expect(code).toBeVisible()
    }
    await review.locator('[data-action="assign-purchase-codes"]').click()
    await expect(review).toBeHidden()
    const saved = await libraryBackup(extension)
    expect(
      saved.preparations
        .find((prep) => prep.orderId === ref.orderId)
        .groups.flatMap((group) =>
          group.variants.flatMap((variant) => variant.entryIds)
        )
    ).toHaveLength(count)
    expect(saved.orders).toEqual(before.orders)
    await page.close()
  }
})

test('large real purchase review virtualizes source keys and keeps all150 exact assignments across viewport resizing', async ({
  extension,
}, testInfo) => {
  const refs = []
  for (let index = 0; index < 2; index++)
    refs.push(
      await seedSmartOrder(extension, {
        count: 75,
        assignCodes: false,
        orderId: String(810000000000000000n + BigInt(index)),
        supplierId: `synthetic-review-large-${index}`,
      })
    )
  const page = await openSmartLibrary(extension)
  await page.locator('#select-rows').click()
  await page.locator('#review-purchase-codes').click()
  const review = page.locator('[data-action="purchase-code-review"]'),
    scroller = review.locator('.purchase-code-review-items')
  await expect(scroller).toHaveAttribute('data-row-count', '150')
  const before = await libraryBackup(extension)
  for (const width of [1280, 720, 390]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await review.locator('article').count()).toBeLessThanOrEqual(100)
    await scroller.evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    await expect(
      review.locator('article').last().locator('.purchase-code')
    ).toBeVisible()
    const box = await review.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
    await review.screenshot({
      path: testInfo.outputPath(`virtual-purchase-review-${width}.png`),
    })
  }
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await libraryBackup(extension)).preparations).toEqual(
    before.preparations
  )
  expect((await libraryBackup(extension)).orders).toEqual(before.orders)
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
