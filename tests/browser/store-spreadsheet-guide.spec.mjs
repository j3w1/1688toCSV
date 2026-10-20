import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { STORE_IMPORT_MARKERS } from '../../src/store-workbook-model.js'

async function openGuide(extension) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const restored = await extension.inspector.evaluate(
    (record) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders: [record],
          history: [],
          images: [],
        },
      }),
    record
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('tab', { name: 'Data', exact: true }).click()
  const launch = settings.getByRole('button', {
    name: 'Store spreadsheet guide',
    exact: true,
  })
  await launch.click()
  const guide = page.getByRole('dialog', { name: 'Store spreadsheet guide' })
  await expect(guide).toBeVisible()
  return { page, settings, launch, guide }
}

test('store spreadsheet format guide supports keyboard sections and exact marker copying without library changes', async ({
  extension,
}) => {
  const { page, settings, launch, guide } = await openGuide(extension)
  const snapshot = async () =>
    extension.inspector.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
      const { exportedAt: _time, ...data } = result.data
      return data
    })
  const before = await snapshot()
  await expect(guide).toContainText('review its rows, photos and totals')
  await expect(guide.locator('input[type=file]')).toHaveCount(0)
  const start = guide.getByRole('tab', { name: 'Start here', exact: true })
  const markers = guide.getByRole('tab', {
    name: 'Import markers',
    exact: true,
  })
  await expect(start).toBeFocused()
  await start.press('ArrowRight')
  await expect(markers).toBeFocused()
  await expect(markers).toHaveAttribute('aria-selected', 'true')
  expect(
    (
      await guide
        .locator('.store-import-marker-table .store-import-token')
        .allTextContents()
    ).sort()
  ).toEqual([...STORE_IMPORT_MARKERS].sort())
  await expect(
    guide.getByRole('tabpanel', { name: 'Start here', exact: true })
  ).toBeHidden()
  const marker = guide.getByRole('button', {
    name: 'Copy import marker: pic',
    exact: true,
  })
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (value) => {
      window.guideCopied = value
    }
  })
  await marker.click()
  await expect.poll(() => page.evaluate(() => window.guideCopied)).toBe('pic')
  await expect(marker.getByRole('status')).toHaveText('Copied')
  expect(
    await marker.evaluate((node) => getComputedStyle(node).fontFamily)
  ).toContain('monospace')
  await markers.focus()
  await markers.press('End')
  const review = guide.getByRole('tab', { name: 'Review rules', exact: true })
  await expect(review).toBeFocused()
  await expect(
    guide.getByRole('tabpanel', { name: 'Review rules' })
  ).toContainText('never duplicate the totals or assume equal quantities')
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 568 },
  ]) {
    await page.setViewportSize(viewport)
    const frame = await guide.boundingBox()
    for (const tab of await guide.getByRole('tab').all()) {
      await tab.click()
      const current = await guide.boundingBox()
      expect(current.width).toBeCloseTo(frame.width, 1)
      expect(current.height).toBeCloseTo(frame.height, 1)
      expect(current.y).toBeGreaterThanOrEqual(0)
      expect(current.y + current.height).toBeLessThanOrEqual(viewport.height)
      expect(
        await guide.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
      ).toBe(true)
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await markers.click()
  await expect(marker.getByRole('status')).toBeHidden()
  await guide.screenshot({ path: 'work/store-spreadsheet-guide-wide.png' })
  await page.setViewportSize({ width: 390, height: 700 })
  await guide.screenshot({ path: 'work/store-spreadsheet-guide-narrow.png' })
  await page.keyboard.press('Escape')
  await expect(guide).toHaveCount(0)
  await expect(launch).toBeFocused()
  await settings.getByRole('button', { name: 'Close settings' }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await settings.getByRole('tab', { name: 'Data', exact: true }).click()
  await expect(launch).toHaveCount(1)
  await launch.click()
  await guide.getByRole('button', { name: 'Close spreadsheet guide' }).click()
  expect(await snapshot()).toEqual(before)
})

test('store spreadsheet guide translates its interface while preserving copyable marker values and filenames', async ({
  extension,
}) => {
  const { page, settings, launch, guide } = await openGuide(extension)
  await page.keyboard.press('Escape')
  await settings.getByRole('button', { name: 'Close settings' }).click()
  for (const language of [
    {
      code: 'es',
      settings: 'Ajustes',
      data: 'Datos',
      guide: 'Guía de Excel de tiendas',
      markers: 'Marcadores de importación',
      copy: 'Copiar marcador de importación: perbox',
    },
    {
      code: 'zh',
      settings: '设置',
      data: '数据',
      guide: '门店表格格式指南',
      markers: '导入标记',
      copy: '复制导入标记：perbox',
    },
  ]) {
    await page.locator(`[data-language="${language.code}"]`).click()
    await page
      .getByRole('button', { name: language.settings, exact: true })
      .click()
    const currentSettings = page.getByRole('dialog', {
      name: language.settings,
      exact: true,
    })
    await currentSettings
      .getByRole('tab', { name: language.data, exact: true })
      .click()
    await currentSettings
      .getByRole('button', { name: language.guide, exact: true })
      .click()
    const currentGuide = page.getByRole('dialog', {
      name: language.guide,
      exact: true,
    })
    await expect(
      currentGuide.getByRole('button', {
        name: /12345 \(5\) \(Copy\)\.xlsx/,
      })
    ).toHaveText('12345 (5) (Copy).xlsx')
    await currentGuide
      .getByRole('tab', { name: language.markers, exact: true })
      .click()
    await expect(
      currentGuide.getByRole('button', { name: language.copy, exact: true })
    ).toHaveText('perbox')
    await expect(currentGuide).not.toContainText('Meaning and requirement')
    await page.keyboard.press('Escape')
    await expect(currentGuide).toHaveCount(0)
    await expect(currentSettings).toBeVisible()
    // Restored keyboard focus can show its helper, which owns the next Escape.
    // Close the parent explicitly; this test verifies guide dismissal/translation.
    await currentSettings.locator('.dialog-close').click()
    await expect(currentSettings).not.toBeVisible()
  }
  await expect(launch).toHaveCount(0)
  await expect(guide).toHaveCount(0)
})
