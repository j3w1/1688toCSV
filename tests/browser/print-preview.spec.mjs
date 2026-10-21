import { readFile } from 'node:fs/promises'
import { test, expect } from './extension-fixture.mjs'
import { openPrintDialogFixture } from './print-dialog-fixture.mjs'

async function exportedPdf(extension, page, dialog) {
  await page.evaluate(() => {
    window.printSettled = new Promise((resolve) =>
      document.addEventListener(
        'print-export-settled',
        (event) => resolve(event.detail),
        { once: true }
      )
    )
  })
  const download = page.waitForEvent('download', (file) =>
    file.suggestedFilename().endsWith('.pdf')
  )
  download.catch(() => {})
  const button = dialog.getByRole('button', { name: 'Export PDF', exact: true })
  await button.click()
  expect(
    await page.evaluate(() => window.printSettled),
    await dialog.locator('.print-left > .print-status').textContent()
  ).toEqual({ saved: true })
  const file = await download
  expect(await file.failure()).toBeNull()
  // The shared temporary profile uses ordinary Chromium downloads, preserving
  // suggested filenames rather than Playwright's GUID paths on Windows.
  let saved
  await expect
    .poll(async () => {
      const files = await extension.inspector.evaluate(() =>
        chrome.downloads.search({})
      )
      saved = files.find(
        (entry) => entry.url === file.url() && entry.state === 'complete'
      )
      return Boolean(saved)
    })
    .toBe(true)
  const bytes = await readFile(saved.filename)
  await expect(button).toBeEnabled()
  return bytes
}

for (const kind of ['labels', 'marks']) {
  test(`${kind} PDF preview zooms around the pointer, pans, fits and leaves exported pages unchanged`, async ({
    extension,
  }) => {
    test.setTimeout(60_000)
    const { page, dialog } = await openPrintDialogFixture(extension, { kind })
    const viewport = dialog.locator('.print-preview-viewport')
    const pan = dialog.locator('[data-action="print-preview"]')
    const canvas = pan.locator('canvas')
    await expect(canvas).toHaveAttribute('data-ops', /[1-9]\d*/)
    await expect(pan).toHaveAttribute('aria-pressed', 'false')
    const original = await canvas.evaluate((node) => ({
      width: node.width,
      height: node.height,
      pixels: node.toDataURL(),
    }))
    const fit = await canvas.boundingBox()
    const box = await viewport.boundingBox()
    expect(fit.width).toBeLessThanOrEqual(box.width)
    expect(fit.height).toBeLessThanOrEqual(box.height)
    const before = await exportedPdf(extension, page, dialog)
    // Navigation changes display size alone: no new drawings or downloads.
    const downloads = []
    page.on('download', (download) => downloads.push(download))
    await pan.focus()
    await page.keyboard.press('+')
    await expect(pan).toHaveAttribute('aria-pressed', 'true')
    for (let index = 0; index < 3; index++)
      await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click()
    expect((await canvas.boundingBox()).width).toBeGreaterThan(box.width)
    const point = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.55 }
    const sourcePoint = () =>
      canvas.evaluate((node, point) => {
        const bounds = node.getBoundingClientRect()
        return {
          x: (point.x - bounds.left) / bounds.width,
          y: (point.y - bounds.top) / bounds.height,
        }
      }, point)
    const anchor = await sourcePoint()
    await page.mouse.move(point.x, point.y)
    await page.mouse.wheel(0, -180)
    await expect
      .poll(async () => (await canvas.boundingBox()).width)
      .toBeGreaterThan(fit.width * 3)
    const afterAnchor = await sourcePoint()
    expect(Math.abs(afterAnchor.x - anchor.x)).toBeLessThan(0.003)
    expect(Math.abs(afterAnchor.y - anchor.y)).toBeLessThan(0.003)
    const beforePan = await viewport.evaluate((node) => ({
      x: node.scrollLeft,
      y: node.scrollTop,
    }))
    await page.mouse.down()
    await page.mouse.move(point.x - 50, point.y - 45, { steps: 5 })
    await page.mouse.up()
    const afterPan = await viewport.evaluate((node) => ({
      x: node.scrollLeft,
      y: node.scrollTop,
    }))
    expect(afterPan.x).toBeGreaterThan(beforePan.x)
    expect(afterPan.y).toBeGreaterThan(beforePan.y)
    await expect(pan).toHaveAttribute('aria-pressed', 'true')
    expect(
      await canvas.evaluate((node) => ({
        width: node.width,
        height: node.height,
        pixels: node.toDataURL(),
      }))
    ).toEqual(original)
    expect(downloads).toHaveLength(0)
    const after = await exportedPdf(extension, page, dialog)
    // Complete PDF bytes match, including artwork, captions, page count and A4 size.
    expect(after).toEqual(before)
    expect(after.toString('latin1')).toContain('/MediaBox [0 0 595.276 841.89]')
    if (kind === 'marks') {
      const placements = [
        ...after
          .toString('latin1')
          .matchAll(
            /q ([-\d.]+) 0 0 ([-\d.]+) [-\d.]+ [-\d.]+ cm \/Im\d+ Do Q/g
          ),
      ]
      expect(placements).toHaveLength(4)
      for (const [, width, height] of placements) {
        expect(Number(width) / (72 / 25.4)).toBeGreaterThan(185)
        expect(Number(height) / (72 / 25.4)).toBeGreaterThan(130)
        expect(Number(width) / Number(height)).toBeCloseTo(148.5 / 105, 3)
      }
      const scale = await dialog.locator('.copy-preview-scale').textContent()
      await dialog
        .getByRole('button', { name: 'Next page', exact: true })
        .click()
      await expect(pan).toHaveAccessibleName('Page 2 preview')
      await expect(dialog.locator('.copy-preview-scale')).toHaveText(scale)
    }
    await pan.focus()
    await page.keyboard.press('ArrowDown')
    expect(await viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(
      afterPan.y
    )
    await page.keyboard.press('0')
    await expect(pan).toHaveAttribute('aria-pressed', 'false')
    await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await dialog.getByRole('button', { name: 'Zoom out', exact: true }).click()
    await expect(pan).toHaveAttribute('aria-pressed', 'false')
    await pan.click()
    await expect(pan).toHaveAttribute('aria-pressed', 'true')
    await dialog.getByRole('button', { name: 'Fit page', exact: true }).click()
    await expect(pan).toHaveAttribute('aria-pressed', 'false')
    await page.setViewportSize({ width: 390, height: 800 })
    await expect
      .poll(async () => (await canvas.boundingBox()).width)
      .toBeLessThanOrEqual((await viewport.boundingBox()).width)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    await page.evaluate(() =>
      Print.setLanguage('es', {
        scope: document.querySelector('.print-dialog'),
      })
    )
    await expect(
      dialog.getByRole('button', { name: 'Ajustar página', exact: true })
    ).toBeVisible()
    await dialog.locator('[data-action="close-print-dialog"]').click()
    await expect(page.locator('#launch')).toBeFocused()
    await page.close()
  })
}
