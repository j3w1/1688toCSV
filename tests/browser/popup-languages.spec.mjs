import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { test, expect } from './extension-fixture.mjs'
import { openPrintDialogFixture } from './print-dialog-fixture.mjs'

async function expectCompactLanguageChoices(group) {
  const sizes = await group.locator('button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const bounds = button.getBoundingClientRect()
      const text = document.createRange()
      text.selectNodeContents(button)
      return {
        width: bounds.width,
        height: bounds.height,
        lines: text.getClientRects().length,
        textWidth: text.getBoundingClientRect().width,
      }
    })
  )
  expect(sizes).toHaveLength(3)
  for (const size of sizes) {
    expect(size.width).toBe(32)
    expect(size.height).toBe(26)
    expect(size.lines).toBe(1)
    expect(size.textWidth).toBeLessThanOrEqual(size.width)
  }
}

async function downloadedBytes(extension, download) {
  let entry
  await expect
    .poll(async () => {
      const files = await extension.inspector.evaluate(() =>
        chrome.downloads.search({})
      )
      entry = files.find(
        (file) => file.url === download.url() && file.state === 'complete'
      )
      return Boolean(entry)
    })
    .toBe(true)
  return readFile(entry.filename)
}

for (const kind of ['labels', 'marks']) {
  test(`${kind} language toggle preserves drafts, redraws captions and exports Spanish and Chinese PDFs`, async ({
    extension,
  }) => {
    const code = kind === 'marks' ? 'CE26103102' : 'CE26103102A'
    const { page, dialog } = await openPrintDialogFixture(extension, {
      kind,
      items: [
        {
          key: code,
          code,
          name: 'NOMBRE GUARDADO',
          quantity: 1,
          model: {
            kind: kind === 'marks' ? 'mark' : 'barcode',
            code,
            spanishName: 'NOMBRE GUARDADO',
            category: '保存类别',
          },
        },
      ],
    })
    const quantities = dialog.locator('.print-quantity-input input')
    await quantities.first().fill('3')
    const margin = dialog.getByLabel(
      kind === 'marks' ? 'Safe margin (mm)' : 'Margin (mm)',
      { exact: true }
    )
    await margin.fill('6')
    await page.evaluate(() => {
      window.languageCaptionCalls = []
      window.languageArtworkCalls = []
      const fill = CanvasRenderingContext2D.prototype.fillText
      CanvasRenderingContext2D.prototype.fillText = function (value, ...args) {
        window.languageCaptionCalls.push(String(value))
        window.languageArtworkCalls.push({
          value: String(value),
          width: this.canvas.width,
        })
        return fill.call(this, value, ...args)
      }
    })
    const languages = dialog.locator('.popup-language-toggle')
    await expectCompactLanguageChoices(languages)
    for (const [language, expected] of [
      ['es', kind === 'marks' ? 'Caja 1 de 3' : 'Etiquetas CE'],
      ['zh', kind === 'marks' ? '第 1/3 箱' : 'CE 标签'],
    ]) {
      await languages.locator(`[data-language="${language}"]`).click()
      await expect(
        languages.locator(`[data-language="${language}"]`)
      ).toHaveAttribute('aria-pressed', 'true')
      await expect(quantities.first()).toHaveValue('3')
      await expect(
        dialog.locator('.print-settings input[type="number"]').first()
      ).toHaveValue('6')
      await expect(dialog.locator('.print-preview')).toHaveAttribute(
        'data-preview-state',
        'ready'
      )
      await expect
        .poll(() =>
          page.evaluate(
            (expected) =>
              window.languageCaptionCalls.some((value) =>
                value.includes(expected)
              ),
            expected
          )
        )
        .toBe(true)
      const fields =
        language === 'es'
          ? ['Cantidad:', 'Peso:', 'Volumen:']
          : ['数量：', '重量：', '体积：']
      if (kind === 'marks')
        await expect
          .poll(() =>
            page.evaluate(
              (fields) =>
                fields.every((field) =>
                  window.languageArtworkCalls.some(
                    (call) => call.value === field && call.width < 2000
                  )
                ),
              fields
            )
          )
          .toBe(true)
      const downloads = []
      const listener = (download) => downloads.push(download)
      page.on('download', listener)
      await dialog.locator('[data-action="export-pdf"]').click()
      await expect.poll(() => downloads.length).toBe(2)
      await expect(dialog.locator('[data-action="export-pdf"]')).toBeEnabled()
      page.off('download', listener)
      const pdf = downloads.find((item) =>
        item.suggestedFilename().endsWith('.pdf')
      )
      const summary = downloads.find((item) =>
        item.suggestedFilename().endsWith('.json')
      )
      const bytes = await downloadedBytes(extension, pdf)
      const artifacts = new URL('../../work/pdf-languages/', import.meta.url)
      await mkdir(artifacts, { recursive: true })
      await writeFile(new URL(`${kind}-${language}.pdf`, artifacts), bytes)
      const text = bytes.toString('latin1')
      expect(text).toContain('%PDF-1.4')
      // Artwork plus Unicode caption rasters: glyphs no longer disappear in Helvetica.
      expect([...text.matchAll(/\/Subtype \/Image/g)].length).toBeGreaterThan(1)
      if (language === 'zh') expect(text).toContain('/Title <feff')
      const json = JSON.parse(
        (await downloadedBytes(extension, summary)).toString('utf8')
      )
      expect(json.language).toBe(language)
      expect(json.products[0].code).toBe(code)
      expect(json.products[0].name).toBe('NOMBRE GUARDADO')
      if (kind === 'marks')
        expect(
          await page.evaluate(
            (fields) =>
              fields.every((field) =>
                window.languageArtworkCalls.some(
                  (call) => call.value === field && call.width > 2000
                )
              ),
            fields
          )
        ).toBe(true)
      expect(
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('1688-print-recent'))[0].language
        )
      ).toBe(language)
    }
    const preview = dialog.locator('.print-preview')
    const chinese = await preview.evaluate((canvas) => canvas.toDataURL())
    await page.evaluate(() => {
      Print.setLanguage('es', { persist: false })
      Print.setLanguage('zh', { persist: false })
    })
    await expect(preview).toHaveAttribute('data-preview-state', 'ready')
    expect(await preview.evaluate((canvas) => canvas.toDataURL())).toBe(chinese)
    await dialog.locator('[data-action="close-print-dialog"]').click()
    await page.close()
  })
}

test('Excel image language toggle regenerates the image without changing selected columns or drafts', async ({
  extension,
}) => {
  const { page, dialog: print } = await openPrintDialogFixture(extension)
  await print.locator('[data-action="close-print-dialog"]').click()
  await page.evaluate(() => {
    Print.setLanguage('en', { persist: false })
    window.excelLanguageCalls = []
    const fill = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (value, ...args) {
      window.excelLanguageCalls.push(String(value))
      return fill.call(this, value, ...args)
    }
    document.querySelector('#launch').onclick = () =>
      Print.copyExcelImage(
        [
          {
            orderId: '12345',
            entryId: '6789',
            title: '原始商品名称',
            quantity: '10',
            price: '2.50',
            description: '原始描述',
            thumbnail: 'synthetic',
          },
        ],
        {
          loadImage: async () => {
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 16
            const context = canvas.getContext('2d')
            context.fillStyle = '#f00'
            context.fillRect(0, 0, 16, 16)
            return canvas.toDataURL('image/png')
          },
        }
      )
  })
  await page.locator('#launch').click()
  const dialog = page.locator('.image-copy-dialog')
  await expect(dialog.locator('.copy-preview img')).toHaveCount(1)
  await expectCompactLanguageChoices(dialog.locator('.popup-language-toggle'))
  const selected = await dialog
    .locator('.excel-column-toggle[aria-pressed="true"]')
    .count()
  const preference = await page.evaluate(() =>
    localStorage.getItem('1688-excel-image-columns')
  )
  for (const [language, label] of [
    ['es', 'Cantidad'],
    ['zh', '数量'],
    ['en', 'Quantity'],
  ]) {
    await page.evaluate(() => {
      window.excelLanguageCalls = []
    })
    await dialog
      .locator(`.popup-language-toggle [data-language="${language}"]`)
      .click()
    await expect(dialog.locator('.copy-preview img')).toHaveCount(1)
    await expect
      .poll(() =>
        page.evaluate(
          (label) => window.excelLanguageCalls.includes(label),
          label
        )
      )
      .toBe(true)
    await expect(
      dialog.locator('.excel-column-toggle[aria-pressed="true"]')
    ).toHaveCount(selected)
    expect(
      await page.evaluate(() =>
        localStorage.getItem('1688-excel-image-columns')
      )
    ).toBe(preference)
  }
  await dialog.locator('.image-copy-heading [data-icon="close"]').click()
  await page.close()
})
