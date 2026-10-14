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

test('resuming an old bulk import requires a visible scope confirmation', async ({
  extension,
}) => {
  await seed(extension)
  await extension.inspector.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('1688-order-library')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('jobs', 'readwrite')
          tx.objectStore('jobs').put({
            id: 'legacy-bulk-test',
            state: 'paused',
            phase: 'details',
            kind: 'import',
            page: 67,
            total: 667,
            orders: [],
            error: 'Previous job paused',
            updatedAt: new Date().toISOString(),
          })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
        }
      })
  )
  const page = await openLibrary(extension)
  await page
    .getByRole('button', { name: 'Resume / retry', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Confirm bulk import' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('667 orders')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('#jobs')).toContainText('paused')
  expect(extension.unexpectedRequests).toEqual([])
})
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
  await expect(page.locator('#copy-excel')).toHaveText('Copied')
  await expect(page.locator('#copy-excel')).toHaveClass(/copied/)
  await expect(page.locator('#feedback')).toBeEmpty()
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
  await expect(page.locator('#copy-values')).toHaveText('Copied')
  await expect(page.locator('#feedback')).toBeEmpty()
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
  await expect(page.locator('#copy-images')).toHaveText('Copied')
  await expect(page.locator('#feedback')).toBeEmpty()
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

test('purchase dates group orders by month while separators stay out of copied values', async ({
  extension,
}) => {
  await seed(extension)
  const page = await openLibrary(extension)
  await expect(page.locator('.order-month')).toHaveText([
    'October 2026',
    'September 2026',
  ])
  await expect(page.locator('.purchase-date')).toHaveText([
    '12 Oct 2026',
    '8 Oct 2026',
    '25 Sept 2026',
  ])
  await expect(page.locator('#sheet-body tr').first()).toContainText(
    '12 Oct 2026'
  )
  await page.getByRole('button', { name: /Habitat Studio/ }).click()
  await expect(page.locator('#order-details')).toContainText(
    'Purchased 12 Oct 2026'
  )
  await page.getByRole('button', { name: 'Close order details' }).click()
  await expect(page.locator('tr.order-boundary')).toHaveCount(2)
  await page
    .getByLabel('Purchase month', { exact: true })
    .selectOption('2026-09')
  await expect(page.locator('.order-card')).toHaveCount(1)
  await expect(page.locator('#sheet-body tr')).toHaveCount(2)
  await expect(page.locator('tr.order-boundary')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show all', exact: true }).click()
  await expect(page.locator('#sheet-body tr')).toHaveCount(8)
  await page.getByRole('checkbox', { name: 'Headers', exact: true }).uncheck()
  await page.reload()
  await expect(
    page.getByRole('checkbox', { name: 'Headers', exact: true })
  ).not.toBeChecked()
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.locator('#copy-values').click()
  await expect(page.locator('#copy-values')).toHaveText('Copied')
  const copied = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0]
    return {
      text: await (await item.getType('text/plain')).text(),
      html: await (await item.getType('text/html')).text(),
    }
  })
  expect(copied.text.split('\r\n')).toHaveLength(8)
  expect(copied.text).not.toContain('Thumbnail')
  expect(copied.html.match(/<tr\b/g)).toHaveLength(8)
  expect(copied.html).not.toContain('order-boundary')
  expect(copied.html).not.toContain('October')
  await expect(page.locator('#feedback')).toBeEmpty()
})

test('old import messages can be dismissed persistently without losing orders or queues', async ({
  extension,
}) => {
  await seed(extension)
  await extension.inspector.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('1688-order-library')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('jobs', 'readwrite')
          for (const [id, updatedAt, error] of [
            ['z-old', '2026-10-01T00:00:00Z', 'Old stopped import'],
            ['a-new', '2026-10-14T00:00:00Z', 'Recent stopped import'],
          ]) {
            tx.objectStore('jobs').put({
              id,
              state: 'paused',
              phase: 'details',
              kind: 'import',
              updatedAt,
              orders: [],
              error,
            })
          }
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
        }
      })
  )
  const page = await openLibrary(extension)
  await expect(page.locator('.job').first()).toContainText(
    'Recent stopped import'
  )
  await page
    .getByRole('button', { name: 'Dismiss', exact: true })
    .first()
    .click()
  await expect(page.locator('.job')).toHaveCount(1)
  await page.getByRole('button', { name: 'Dismiss all', exact: true }).click()
  await expect(page.locator('.job')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.job')).toHaveCount(0)
  await expect(page.locator('#order-count')).toHaveText('3')
  await expect(page.locator('#sheet-body tr')).toHaveCount(8)
  await page
    .getByRole('button', { name: 'Show dismissed', exact: true })
    .click()
  await expect(page.locator('.job')).toHaveCount(2)
  await expect(
    page.getByRole('button', { name: 'Resume / retry', exact: true })
  ).toHaveCount(2)
  const result = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
  )
  expect(result.ok).toBe(true)
  expect(result.data.jobs).toHaveLength(2)
  expect(
    result.data.jobs.every((job) => job.state === 'paused' && job.dismissedAt)
  ).toBe(true)
  expect(extension.unexpectedRequests).toEqual([])
})

test('copy completion keeps controls disabled when the filter changes to no products', async ({
  extension,
}) => {
  await seed(extension)
  const page = await openLibrary(extension)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  await page.evaluate(() => {
    const write = navigator.clipboard.write.bind(navigator.clipboard)
    navigator.clipboard.write = async (items) => {
      await new Promise((resolve) => {
        window.finishSyntheticCopy = resolve
      })
      return write(items)
    }
  })
  await page.locator('#copy-values').click()
  await expect(page.locator('#copy-values')).toHaveAttribute(
    'aria-busy',
    'true'
  )
  await page.getByRole('searchbox').fill('no matching synthetic products')
  await expect(page.locator('#sheet-body tr')).toHaveCount(0)
  await page.evaluate(() => window.finishSyntheticCopy())
  await expect(page.locator('#copy-values')).toHaveText('Copied')
  for (const id of ['copy-values', 'copy-images', 'copy-excel'])
    await expect(page.locator(`#${id}`)).toBeDisabled()
  await expect(page.locator('#feedback')).toBeEmpty()
})
