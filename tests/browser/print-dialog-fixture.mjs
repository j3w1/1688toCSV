import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

let resourcesPromise
async function buildResources() {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const script = await build({
    stdin: {
      contents: `export { openPrintDialog } from './src/print-dialog.js';
        export { DEFAULT_LABEL_SETTINGS } from './src/labels.js';
        export { applyCodeDesign } from './src/code-design.js';
        export { setLanguage } from './src/i18n.js';`,
      resolveDir: root,
    },
    bundle: true,
    format: 'iife',
    globalName: 'Print',
    write: false,
  })
  const styles = []
  for (const name of ['library', 'packing', 'code-design', 'shell']) {
    const result = await build({
      entryPoints: [`${root}/src/${name}.css`],
      bundle: true,
      write: false,
    })
    styles.push(result.outputFiles[0].text)
  }
  return { source: script.outputFiles[0].text, styles }
}

/** Source modules and production styles on the existing synthetic localhost.
 * The fixture never opens the owner's installed extension or accesses its data.
 */
export async function openPrintDialogFixture(extension, options = {}) {
  resourcesPromise ??= buildResources()
  const { source, styles } = await resourcesPromise
  const page = await extension.context.newPage()
  await page.setViewportSize(options.viewport ?? { width: 1280, height: 800 })
  await page.goto(`${extension.origin}/unsupported`)
  await page.setContent(
    '<main><button id="launch">Open print dialog</button></main>'
  )
  for (const content of styles) await page.addStyleTag({ content })
  await page.addScriptTag({ content: source })
  await page.evaluate(() => {
    localStorage.clear()
    Print.applyCodeDesign(document.documentElement)
  })
  const dialog = await showPrintDialog(page, options)
  return { page, dialog }
}

/** Reopen the same synthetic dialog, optionally with caller-supplied print items. */
export async function showPrintDialog(
  page,
  { kind = 'marks', language = 'en', items, settings, logoUrl = '' } = {}
) {
  await page.evaluate(
    ({ kind, language, items, settings, logoUrl }) => {
      Print.setLanguage(language, { persist: false })
      document.querySelector('#launch').onclick = () =>
        Print.openPrintDialog({
          kind,
          settings: settings ?? structuredClone(Print.DEFAULT_LABEL_SETTINGS),
          logoUrl,
          items:
            items ??
            [1, 3, 0].map((quantity, index) => {
              const code = `CE2610010${index + 1}`
              return {
                key: code,
                code,
                name: 'PRODUCTO SINTÉTICO CON UNA DESCRIPCIÓN LARGA',
                detail:
                  'Synthetic product details that wrap within the product column.',
                quantity,
                model: {
                  kind: kind === 'marks' ? 'mark' : 'barcode',
                  code,
                  spanishName: 'PRODUCTO',
                  category: '测试',
                },
              }
            }),
        })
    },
    { kind, language, items, settings, logoUrl }
  )
  await page.locator('#launch').click()
  return page.locator('.print-dialog')
}
