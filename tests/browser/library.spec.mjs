import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { stat, writeFile } from 'node:fs/promises'

async function seed(extension) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const result = await extension.inspector.evaluate(
    async (orders) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders,
          history: [],
          images: [],
        },
      }),
    records
  )
  expect(result.ok, result.error).toBe(true)
  return records
}
async function openLibrary(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  return page
}
test('library restores complete orders and copies five columns with separate images', async ({
  extension,
}) => {
  await seed(extension)
  const page = await openLibrary(extension)
  await expect(page.locator('#sheet-body tr')).toHaveCount(8)
  await expect(page.locator('#order-count')).toHaveText('3')
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.getByRole('button', { name: 'Copy to Excel', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('8 product rows copied')
  const copied = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0]
    return {
      text: await (await item.getType('text/plain')).text(),
      html: await (await item.getType('text/html')).text(),
    }
  })
  expect(copied.text.split('\r\n')).toHaveLength(9)
  expect(
    copied.text.split('\r\n').every((line) => line.split('\t').length === 5)
  ).toBe(true)
  expect(copied.html.match(/<img /g)).toHaveLength(8)
  expect(copied.text).toContain('颜色：橄榄绿 · 尺码：均码')
  expect(extension.unexpectedRequests).toEqual([])
})
test('filters and explicit product selections determine copy scope', async ({
  extension,
}) => {
  await seed(extension)
  const page = await openLibrary(extension)
  await page.getByRole('searchbox').fill('candle')
  await expect(page.locator('#sheet-body tr')).toHaveCount(2)
  await page.locator('#sheet-body input[type=checkbox]').first().check()
  await page.getByRole('checkbox', { name: 'Headers', exact: true }).uncheck()
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.getByRole('button', { name: 'Copy values', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('1 product rows copied')
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).not.toContain('Thumbnail')
  expect(text.split('\t')).toHaveLength(5)
  expect(text).toContain('warm amber')
  await page.getByRole('searchbox').clear()
  await page
    .getByRole('checkbox', { name: 'Changed only', exact: true })
    .check()
  await expect(page.locator('#sheet-body tr')).toHaveCount(1)
})
test('notes are editable separately and survive a later source revision', async ({
  extension,
}) => {
  const records = await seed(extension)
  const page = await openLibrary(extension)
  await page.getByRole('button', { name: /Habitat Studio/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByLabel('Your notes').fill('Reserved for display')
  await page.getByLabel('Tags (comma separated)').fill('October, home')
  await page.getByRole('button', { name: 'Save notes', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Notes saved')
  const incoming = structuredClone(records[0])
  incoming.snapshot.observedAt = '2026-10-14T12:00:00.000Z'
  incoming.lastCheckedAt = incoming.changedAt = incoming.snapshot.observedAt
  incoming.snapshot.items[0].description = 'Revised synthetic product'
  const response = await extension.inspector.evaluate(
    async (record) =>
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
    incoming
  )
  expect(response.ok, response.error).toBe(true)
  await page.reload()
  await expect(page.locator('#sheet-body')).toContainText(
    'Revised synthetic product'
  )
  await page.getByRole('button', { name: /Habitat Studio/ }).click()
  await expect(page.getByLabel('Your notes')).toHaveValue(
    'Reserved for display'
  )
  await expect(page.getByLabel('Tags (comma separated)')).toHaveValue(
    'October, home'
  )
  await page.getByText('Previous versions', { exact: true }).click()
  await expect(page.locator('.history-entry')).toContainText('description:')
})
test('empty library gives a starting action and narrow widths contain table overflow', async ({
  extension,
}) => {
  const page = await openLibrary(extension)
  await expect(page.getByText('Your orders belong here.')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Copy to Excel', exact: true })
  ).toBeDisabled()
  await seed(extension)
  await page.reload()
  await page.setViewportSize({ width: 320, height: 700 })
  await expect(page.locator('#sheet-body tr')).toHaveCount(8)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  expect(
    await page
      .locator('.table-scroll')
      .evaluate((el) => el.scrollWidth > el.clientWidth)
  ).toBe(true)
})
test('copy images only produces one picture per selected row', async ({
  extension,
}) => {
  const records = await seed(extension)
  const page = await openLibrary(extension)
  await page
    .getByRole('checkbox', {
      name: `Select order ${records[0].snapshot.orderId}`,
      exact: true,
    })
    .check()
  await expect(page.locator('#sheet-body tr')).toHaveCount(3)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.getByRole('button', { name: 'Copy images', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(
    '3 separate pictures copied'
  )
  const html = await page.evaluate(
    async () =>
      await (
        await (await navigator.clipboard.read())[0].getType('text/html')
      ).text()
  )
  expect(html.match(/<img /g)).toHaveLength(3)
  expect(html).not.toContain('Description')
})

test('large image backups restore and export without runtime message limits', async ({
  extension,
}, testInfo) => {
  test.setTimeout(90_000)
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  // A valid synthetic PNG with trailing padding provides bounded image records
  // whose combined backup exceeds Chrome's 64 MiB runtime message ceiling.
  const raster = Buffer.concat([
    Buffer.from(records[0].snapshot.items[0].thumbnail.split(',')[1], 'base64'),
    Buffer.alloc(1_400_000),
  ])
  const dataUrl = `data:image/png;base64,${raster.toString('base64')}`
  const backup = {
    format: '1688-order-library',
    version: 1,
    exportedAt: new Date().toISOString(),
    orders: records,
    history: [],
    images: Array.from({ length: 37 }, (_, index) => ({
      url: `https://cbu01.alicdn.com/synthetic-backup-${index}.png`,
      dataUrl,
      storedAt: new Date().toISOString(),
    })),
  }
  const buffer = Buffer.from(JSON.stringify(backup))
  expect(buffer.byteLength).toBeGreaterThan(64 * 1024 * 1024)
  const page = await openLibrary(extension)
  const backupPath = testInfo.outputPath('large-synthetic-backup.json')
  await writeFile(backupPath, buffer)
  await page.locator('#backup-file').setInputFiles(backupPath)
  await expect(page.getByRole('status')).toContainText('Backup restored', {
    timeout: 30_000,
  })
  await expect(page.locator('#sheet-body tr')).toHaveCount(8)
  const saved = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Back up', exact: true }).click()
  const download = await saved
  expect(await download.failure()).toBeNull()
  const downloads = await extension.inspector.evaluate(() =>
    chrome.downloads.search({})
  )
  expect(downloads).toHaveLength(1)
  expect(downloads[0].state).toBe('complete')
  expect((await stat(downloads[0].filename)).size).toBeGreaterThan(
    64 * 1024 * 1024
  )
})
