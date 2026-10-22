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
      'assign-only'
    )
    await expect(dialog).toHaveCount(0)
  }
  await page.close()
})

async function launchAssignment(
  page,
  count,
  { variants = 0, helpers = false } = {}
) {
  await page.evaluate(
    ({ count, variants, helpers }) => {
      document.querySelector('#launch').onclick = () => {
        window.reviewPromise = Review.reviewPackingChanges({
          title: 'Assign product codes?',
          explanation: 'Review the product codes in this order.',
          overview: true,
          proceed: 'Assign codes and prepare',
          media: {
            photo() {
              const photo = document.createElement('button')
              photo.className = 'preparation-photo'
              const image = document.createElement('img')
              image.src =
                'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="tan"/></svg>'
              photo.append(image)
              return photo
            },
            forget() {},
          },
          changes: Array.from({ length: count }, (_, index) => {
            const code = `CE2610${String(index + 1).padStart(4, '0')}`
            return {
              name: `Synthetic cup ${index + 1}`,
              sourceDescription: `原始供应商玻璃杯 ${index + 1} · 6"`,
              order: 'Synthetic review store',
              photo: {},
              after: code,
              values: [
                {
                  label: 'Product code',
                  before: 'Not prepared',
                  after: code,
                  kind: 'code',
                },
                ...Array.from({ length: variants }, (_, variant) => ({
                  label: 'Barcode',
                  context: `原始款式 ${variant + 1}`,
                  before: 'Not prepared',
                  after: `${code}${String.fromCharCode(65 + variant)}S`,
                  kind: 'code',
                })),
                ...(helpers
                  ? [
                      {
                        label: 'Spanish short name',
                        before: '',
                        after: 'Vaso',
                      },
                      {
                        label: 'Chinese category',
                        before: '',
                        after: '玻璃杯',
                      },
                      { label: 'Material', before: '', after: '玻璃' },
                    ]
                  : []),
              ],
            }
          }),
        })
      }
    },
    { count, variants, helpers }
  )
  await page.locator('#launch').click()
  return page.locator('.packing-review-overview')
}

async function expectOverviewFits(review) {
  expect(
    await review.evaluate((dialog) => {
      const content = dialog.querySelector('.scroll-dialog-content'),
        host = dialog.querySelector('.packing-review-overview-fit'),
        cards = [...dialog.querySelectorAll('.packing-review-overview-item')],
        bounds = host.getBoundingClientRect()
      return (
        content.scrollHeight <= content.clientHeight + 1 &&
        content.scrollWidth <= content.clientWidth + 1 &&
        cards.every((card) => {
          const rect = card.getBoundingClientRect()
          return (
            rect.top >= bounds.top - 1 &&
            rect.bottom <= bounds.bottom + 1 &&
            rect.left >= bounds.left - 1 &&
            rect.right <= bounds.right + 1
          )
        })
      )
    })
  ).toBe(true)
  await expect(
    review.locator('.scroll-dialog-content .dialog-actions')
  ).toHaveCount(0)
}

test('single three-variant assignment exposes full changes and sizes the dialog to its content', async ({
  extension,
}) => {
  const page = await fixture(extension)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const review = await launchAssignment(page, 1, { variants: 3, helpers: true })
  await expect(review).toHaveAttribute('data-review-layout', 'expanded')
  const inline = review.locator('.packing-review-inline')
  await expect(inline.locator('.packing-value-row')).toHaveCount(7)
  await expect(inline.locator('.packing-value-after code')).toHaveText([
    'CE26100001',
    'CE26100001AS',
    'CE26100001BS',
    'CE26100001CS',
  ])
  for (const code of await inline.locator('.packing-value-after code').all()) {
    await expect(code).toBeInViewport()
    await expect(code.locator('[data-code-part="product"]')).toHaveCount(1)
    await expect(code).toHaveCSS('font-size', '16px')
  }
  await expect(inline.locator('.packing-review-source')).toHaveText(
    '原始供应商玻璃杯 1 · 6"'
  )
  await expect(review.locator('.packing-review-overview-summary')).toBeHidden()
  const bounds = await review.boundingBox(),
    photo = await review.locator('.preparation-photo').boundingBox()
  expect(bounds.width).toBeGreaterThan(700)
  expect(bounds.width).toBeLessThan(1000)
  expect(bounds.height).toBeLessThan(800)
  expect(photo.width).toBe(96)
  expect(photo.height).toBe(96)
  await expectOverviewFits(review)
  await review.screenshot({ path: 'work/adaptive-assignment-single.png' })
  await review.locator('[data-action="review-cancel"]').click()
  expect(await page.evaluate(async () => await window.reviewPromise)).toBe(
    false
  )
  await expect(page.locator('#launch')).toBeFocused()
  await page.close()
})

test('small and moderate assignment batches use readable inline details when they fit', async ({
  extension,
}) => {
  const page = await fixture(extension)
  await page.setViewportSize({ width: 1800, height: 1000 })
  for (const count of [3, 8]) {
    const review = await launchAssignment(page, count, { helpers: true })
    await expect(review).not.toHaveAttribute('data-review-layout', 'compact')
    if (count === 8)
      await expect(review).toHaveAttribute(
        'data-review-layout',
        'detailed-grid'
      )
    await expect(review.locator('.packing-review-inline:visible')).toHaveCount(
      count
    )
    await expect(
      review.locator('.packing-review-inline .packing-value-row')
    ).toHaveCount(count * 4)
    for (const row of await review
      .locator('.packing-review-inline .packing-value-row')
      .all())
      await expect(row).toBeInViewport()
    await expectOverviewFits(review)
    await review.screenshot({
      path: `work/adaptive-assignment-${count}-groups.png`,
    })
    await review.locator('[data-action="review-proceed"]').click()
    expect(await page.evaluate(async () => await window.reviewPromise)).toBe(
      true
    )
  }
  await page.close()
})

test('large assignment batches keep every card fitted and expose complete changes on activation', async ({
  extension,
}) => {
  const page = await fixture(extension)
  await page.setViewportSize({ width: 1280, height: 900 })
  const review = await launchAssignment(page, 52, {
    variants: 3,
    helpers: true,
  })
  for (const width of [1280, 720, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(review).toHaveAttribute('data-review-layout', 'compact')
    await expect
      .poll(async () =>
        review.evaluate((dialog) => {
          const host = dialog
              .querySelector('.packing-review-overview-fit')
              .getBoundingClientRect(),
            card = dialog
              .querySelector('.packing-review-overview-item:last-child')
              .getBoundingClientRect()
          return card.bottom <= host.bottom + 1
        })
      )
      .toBe(true)
    await expectOverviewFits(review)
    if (width === 1280 || width === 390)
      await review.screenshot({
        path: `work/adaptive-assignment-52-groups${width === 390 ? '-narrow' : ''}.png`,
      })
  }
  const select = review.locator('.packing-review-overview-select').last()
  await select.focus()
  await select.press('Enter')
  const detail = review.locator('.packing-review-detail:popover-open')
  await expect(detail).toBeVisible()
  await expect(detail.locator('.packing-value-row')).toHaveCount(7)
  await expect(detail.locator('.packing-value-after code')).toHaveText([
    'CE26100052',
    'CE26100052AS',
    'CE26100052BS',
    'CE26100052CS',
  ])
  await detail.locator('.packing-review-detail-close').press('Escape')
  await expect(detail).toHaveCount(0)
  await expect(select).toBeFocused()
  await review.locator('[data-action="review-cancel"]').click()
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
