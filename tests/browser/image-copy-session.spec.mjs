import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { revealCopyActions } from './copy-actions-helpers.mjs'

async function workspace(extension, count) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-batch-supplier'
  record.changedEntryIds = []
  record.snapshot.items = Array.from({ length: count }, (_, index) => ({
    ...record.snapshot.items[index % 3],
    entryId: String(9100000000000000000n + BigInt(index)),
    title: `合成玻璃花瓶${index + 1}`,
    productNumber: `BATCH-VASE-${index + 1}`,
    description: `合成玻璃花瓶${index + 1}\n货号：BATCH-VASE-${index + 1}`,
    skuProperties: [],
  }))
  const gross = record.snapshot.items.reduce(
    (sum, item) =>
      sum + Math.round(Number(item.price) * 100) * Number(item.quantity),
    0
  )
  const discount = record.snapshot.items.reduce(
    (sum, item) => sum + Math.round(Number(item.discount) * 100),
    0
  )
  Object.assign(record.snapshot.totals, {
    goodsGross: (gross / 100).toFixed(2),
    sourceDiscount: (discount / 100).toFixed(2),
    goodsNet: ((gross - discount) / 100).toFixed(2),
    payable: ((gross - discount) / 100).toFixed(2),
  })
  const result = await extension.inspector.evaluate(
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
    record
  )
  expect(result.ok, result.error).toBe(true)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    count
  )
  return { page, record }
}

test('product photos copy every batch in one dialog, preserve full images and never write just by navigating', async ({
  extension,
}) => {
  const { page, record } = await workspace(extension, 23)
  await page.evaluate(() =>
    navigator.clipboard.writeText('untouched-until-copy')
  )
  await revealCopyActions(page)
  await page.locator('#copy-images').click()
  const dialog = page.locator('.image-copy-dialog')
  await dialog.evaluate((node) => {
    node.dataset.sessionProbe = 'same-dialog'
  })
  await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
  await expect(dialog.locator('.copy-preview img')).toHaveCount(20)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'untouched-until-copy'
  )
  const copied = []
  for (const [index, size] of [
    [0, 20],
    [1, 3],
  ]) {
    await expect(dialog.locator('.copy-preview img')).toHaveCount(size)
    const previews = await dialog
      .locator('.copy-preview img')
      .evaluateAll((images) => images.map((image) => image.src))
    await dialog.locator('.image-copy-submit').click()
    await expect(dialog.locator(`[data-batch-index="${index}"]`)).toHaveClass(
      /is-copied/
    )
    const rows = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read()
      const html = await (await item.getType('text/html')).text()
      return [
        ...new DOMParser()
          .parseFromString(html, 'text/html')
          .querySelectorAll('img'),
      ].map((image) => image.src)
    })
    expect(rows).toEqual(previews)
    copied.push(...rows)
    if (!index) {
      await dialog
        .getByRole('button', { name: 'Next batch', exact: true })
        .click()
      await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
      await expect(dialog).toHaveAttribute('data-session-probe', 'same-dialog')
    }
  }
  expect(copied).toHaveLength(record.snapshot.items.length)
  await expect(dialog.locator('.image-copy-progress')).toContainText(
    'Copied 2 of 2'
  )
  await dialog
    .getByRole('button', { name: 'Previous batch', exact: true })
    .click()
  await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
  await expect(dialog.locator('[data-batch-index="0"]')).toHaveClass(
    /is-copied/
  )
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('#orders-view')).toBeVisible()
})

test('Excel preview matches copied bytes, errors retry in place, columns refresh all batch progress and old image URLs are released', async ({
  extension,
}) => {
  const { page } = await workspace(extension, 60)
  await page.evaluate(() => {
    window.batchWrites = []
    window.rejectBatchWrite = true
    window.digest = async (blob) =>
      [
        ...new Uint8Array(
          await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
        ),
      ].join(',')
    const write = navigator.clipboard.write.bind(navigator.clipboard)
    navigator.clipboard.write = async (items) => {
      if (window.rejectBatchWrite)
        throw new Error('Synthetic retryable copy failure')
      window.batchWrites.push(
        await window.digest(await items[0].getType('image/png'))
      )
      await write(items)
    }
  })
  await page.locator('#copy-excel-image').click()
  const dialog = page.locator('.image-copy-dialog')
  const primary = dialog.locator('.image-copy-submit')
  await expect(primary).toBeEnabled()
  const preview = dialog.locator('.copy-preview')
  const zoom = dialog.locator('.copy-preview-zoom')
  await zoom.click()
  await expect(zoom).toHaveAttribute('aria-pressed', 'true')
  expect(
    await preview.evaluate((node) => node.scrollWidth > node.clientWidth)
  ).toBe(true)
  await zoom.click()
  await expect(zoom).toHaveAttribute('aria-pressed', 'false')
  expect(
    await preview.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
  ).toBe(true)
  const oldUrl = await dialog.locator('.copy-preview img').getAttribute('src')
  await primary.click()
  await expect(dialog.getByRole('alert')).toContainText(
    'Synthetic retryable copy failure'
  )
  await expect(dialog.locator('.is-copied')).toHaveCount(0)
  await page.evaluate(() => {
    window.rejectBatchWrite = false
  })
  for (let batch = 0; batch < 2; batch++) {
    const previewHash = await dialog
      .locator('.copy-preview img')
      .evaluate(async (image) =>
        window.digest(await (await fetch(image.src)).blob())
      )
    await primary.click()
    await expect(dialog.locator(`[data-batch-index="${batch}"]`)).toHaveClass(
      /is-copied/
    )
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    expect(await page.evaluate(() => window.batchWrites.at(-1))).toBe(
      previewHash
    )
    if (!batch) {
      await dialog
        .getByRole('button', { name: 'Next batch', exact: true })
        .click()
      await expect(primary).toBeEnabled()
      expect(
        await page.evaluate(async (url) => {
          try {
            await fetch(url)
            return false
          } catch {
            return true
          }
        }, oldUrl)
      ).toBe(true)
    }
  }
  const before = await page.evaluate(() => window.batchWrites.length)
  await dialog
    .locator('[data-column="supplierWeight"] .excel-column-toggle')
    .click()
  await expect(primary).toBeEnabled()
  await expect(dialog.locator('.is-copied')).toHaveCount(0)
  expect(await page.evaluate(() => window.batchWrites.length)).toBe(before)
  const lastUrl = await dialog.locator('.copy-preview img').getAttribute('src')
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  expect(
    await page.evaluate(async (url) => {
      try {
        await fetch(url)
        return false
      } catch {
        return true
      }
    }, lastUrl)
  ).toBe(true)
})

test('carton mark batches show all generated marks and copy in the same packing dialog', async ({
  extension,
}) => {
  const { page } = await workspace(extension, 6)
  await page.locator('#select-rows').click()
  await page.locator('#prepare-orders').click()
  await page
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const packing = page.locator('#packing-view')
  await expect(packing.locator('.preparation-group')).toHaveCount(6)
  await revealCopyActions(page)
  await packing
    .getByRole('button', { name: 'Copy carton marks', exact: true })
    .click()
  const dialog = page.locator('.image-copy-dialog')
  for (const [index, count] of [
    [0, 4],
    [1, 2],
  ]) {
    await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
    await expect(dialog.locator('.copy-preview img')).toHaveCount(count)
    await expect(dialog.locator('.copy-preview figcaption')).toHaveCount(count)
    await dialog.locator('.image-copy-submit').click()
    await expect(dialog.locator(`[data-batch-index="${index}"]`)).toHaveClass(
      /is-copied/
    )
    const copiedCount = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read()
      const html = await (await item.getType('text/html')).text()
      return new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelectorAll('img').length
    })
    expect(copiedCount).toBe(count)
    await expect(page.locator('dialog[open]')).toHaveCount(1)
    if (!index)
      await dialog
        .getByRole('button', { name: 'Next batch', exact: true })
        .click()
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(packing).toBeVisible()
})
