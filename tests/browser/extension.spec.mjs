import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from './extension-fixture.mjs'

const controlFor = (extension) =>
  extension.orderPage.getByRole('complementary', { name: '1688toCSV' })
const linkFor = (extension) =>
  controlFor(extension).getByRole('link', { name: 'Download CSV', exact: true })

async function saveDirectly(extension, { keyboard = false } = {}) {
  const link = linkFor(extension)
  await expect(link).toBeVisible()
  const pending = extension.orderPage.waitForEvent('download')
  if (keyboard) {
    await link.focus()
    await link.press('Enter')
  } else {
    await link.click()
  }
  const download = await pending
  expect(download.suggestedFilename()).toBe('示例工厂_6789.csv')
  expect(await download.failure()).toBeNull()
  await expect(controlFor(extension).getByRole('status')).toContainText(
    'Save requested: 示例工厂_6789.csv'
  )
}

async function savedFiles(extension) {
  // The extension does not need downloads permission. Only its disposable test
  // copy has it so tests can inspect Chromium's completed files.
  if (extension.inspector.isClosed()) {
    extension.inspector = await extension.context.newPage()
    await extension.inspector.goto(
      `${extension.extensionBaseUrl}/inspector.html`
    )
  }
  return extension.inspector.evaluate(() => chrome.downloads.search({}))
}

async function expectRevoked(page, url) {
  expect(
    await page.evaluate(async (value) => {
      try {
        await fetch(value)
        return false
      } catch {
        return true
      }
    }, url)
  ).toBe(true)
}

test('one direct page click downloads current CSV bytes without opening a popup or dialog', async ({
  extension,
}) => {
  await expect(controlFor(extension)).toHaveCount(1)
  await expect(linkFor(extension)).toHaveAttribute('href', '#')
  expect(await savedFiles(extension)).toEqual([])
  await saveDirectly(extension)
  const downloads = await savedFiles(extension)
  expect(downloads).toHaveLength(1)
  expect(downloads[0].state).toBe('complete')
  expect(path.basename(downloads[0].filename)).toBe('示例工厂_6789.csv')
  expect(path.resolve(path.dirname(downloads[0].filename))).toBe(
    path.resolve(extension.downloadPath)
  )
  const bytes = await readFile(downloads[0].filename)
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const csv = bytes.toString('utf8')
  expect(csv).toMatch(
    /^\uFEFFThumbnail,Description,Price,Quantity,Discount\r\n/
  )
  expect(csv).toContain('测试香薰蜡烛\n颜色：暖白\n货号：DEMO-001')
  expect(csv).toContain('桌面收纳盒\n款式：小号\n货号：DEMO-002')
  expect(csv.trimEnd().split('\r\n')).toHaveLength(3)
  expect(csv).toMatch(/,12\.50,4,2\.10\r\n/)
  expect(csv).toMatch(/,8\.00,2,0\.30(?:\r\n)?$/)

  const previousUrl = await linkFor(extension).getAttribute('href')
  await saveDirectly(extension)
  const repeatedDownloads = await savedFiles(extension)
  expect(repeatedDownloads).toHaveLength(2)
  const repeated = repeatedDownloads.find((item) => item.id !== downloads[0].id)
  expect(repeated.state).toBe('complete')
  expect(repeated.filename).not.toBe(downloads[0].filename)
  expect(await readFile(repeated.filename)).toEqual(bytes)
  await expectRevoked(extension.orderPage, previousUrl)
  await expect(
    extension.orderPage.getByRole('dialog', { includeHidden: true })
  ).toHaveCount(0)
  expect(extension.unexpectedRequests).toEqual([])
})

test('keyboard Enter downloads directly without an extension UI page', async ({
  extension,
}) => {
  await extension.inspector.close()
  await saveDirectly(extension, { keyboard: true })
  const [saved] = await savedFiles(extension)
  expect(saved.state).toBe('complete')
  expect(path.basename(saved.filename)).toBe('示例工厂_6789.csv')
  expect(await readFile(saved.filename, 'utf8')).toMatch(/,12\.50,4,2\.10\r\n/)
  expect(extension.unexpectedRequests).toEqual([])
})

test('reinjection replaces the page control and revokes its previous Blob URL', async ({
  extension,
}) => {
  await saveDirectly(extension)
  const previousUrl = await linkFor(extension).getAttribute('href')
  const previousHost = await controlFor(extension).evaluateHandle(
    (control) => control.getRootNode().host
  )
  await extension.inspector.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    })
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    })
  }, extension.tabId)
  expect(await previousHost.evaluate((host) => host.isConnected)).toBe(false)
  await expect(controlFor(extension)).toHaveCount(1)
  await expect(linkFor(extension)).toHaveAttribute('href', '#')
  await expectRevoked(extension.orderPage, previousUrl)
  expect(await savedFiles(extension)).toHaveLength(1)
  await saveDirectly(extension)
  expect(await savedFiles(extension)).toHaveLength(2)
  expect(extension.unexpectedRequests).toEqual([])
})

test('a nonmatching page does not receive the download control', async ({
  extension,
}) => {
  const unsupported = await extension.context.newPage()
  await unsupported.goto(`${extension.origin}/unsupported`)
  await expect(
    unsupported.getByRole('complementary', { name: '1688toCSV' })
  ).toHaveCount(0)
  expect(await savedFiles(extension)).toEqual([])
  expect(extension.unexpectedRequests).toEqual([])
})

test('an empty order reports an error and recovers when SPA rows load', async ({
  extension,
}) => {
  await extension.setOrder({ rows: [] })
  await linkFor(extension).click()
  await expect(controlFor(extension).getByRole('status')).toContainText(
    'No product rows'
  )
  expect(await savedFiles(extension)).toEqual([])
  await extension.setOrder()
  await saveDirectly(extension)
  expect(await savedFiles(extension)).toHaveLength(1)
  expect(extension.unexpectedRequests).toEqual([])
})

test('the page control fits a 320px viewport without horizontal overflow', async ({
  extension,
}) => {
  await extension.orderPage.setViewportSize({ width: 320, height: 640 })
  await extension.setOrder({ rows: [] })
  await linkFor(extension).click()
  await expect(controlFor(extension).getByRole('status')).toContainText(
    'No product rows'
  )
  const bounds = await controlFor(extension).boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320)
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(640)
  expect(
    await controlFor(extension).evaluate(
      (control) => control.scrollWidth <= control.clientWidth
    )
  ).toBe(true)
  expect(
    await extension.orderPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  expect(await savedFiles(extension)).toEqual([])
  expect(extension.unexpectedRequests).toEqual([])
})

test('malformed product data reports its row in the page control and creates no file', async ({
  extension,
}) => {
  await extension.setOrder({
    rows: [
      { title: 'Valid synthetic item', price: '1.50', quantity: '2' },
      { title: 'Incomplete synthetic item', price: '2.50', quantity: '' },
    ],
  })
  await linkFor(extension).click()
  await expect(controlFor(extension).getByRole('status')).toContainText('Row 2')
  await expect(linkFor(extension)).toHaveAttribute('href', '#')
  expect(await savedFiles(extension)).toEqual([])
  expect(extension.unexpectedRequests).toEqual([])
})

test('a click reads the current SPA order and preserves its displayed product discounts', async ({
  extension,
}) => {
  await expect(controlFor(extension)).toBeVisible()
  await extension.setOrder({
    rows: [
      {
        title: 'Synthetic current item A',
        price: '3.00',
        discountedPrice: '2.84',
        quantity: '300',
        discountSummary: ['优惠', '共', '47.20', '元'],
        discounts: ['省40.00元', '减7.20元'],
      },
      {
        title: 'Synthetic current item B',
        price: '3.90',
        discountedPrice: '3.89',
        quantity: '20',
        discountSummary: '优惠共0.20元',
      },
    ],
  })
  await saveDirectly(extension)
  const [saved] = await savedFiles(extension)
  expect(saved.state).toBe('complete')
  const csv = await readFile(saved.filename, 'utf8')
  expect(csv).toContain('Synthetic current item A')
  expect(csv).not.toContain('测试香薰蜡烛')
  expect(csv).toMatch(/,3\.00,300,47\.20\r\n/)
  expect(csv).toMatch(/,3\.90,20,0\.20\r\n/)
  expect(extension.unexpectedRequests).toEqual([])
})

test('a changed malformed order cannot reuse an earlier successful export', async ({
  extension,
}) => {
  await saveDirectly(extension)
  const previousUrl = await linkFor(extension).getAttribute('href')
  await extension.setOrder({
    rows: [
      {
        title: 'Changed synthetic item',
        price: '3.00',
        quantity: '300',
        discountSummary: '优惠共未知元',
      },
    ],
  })
  await linkFor(extension).click()
  await expect(controlFor(extension).getByRole('status')).toContainText('Row 1')
  await expect(linkFor(extension)).toHaveAttribute('href', '#')
  expect(await savedFiles(extension)).toHaveLength(1)
  await expectRevoked(extension.orderPage, previousUrl)
  expect(extension.unexpectedRequests).toEqual([])
})

test('pagehide revokes the file while preserving a reusable control for back-forward cache', async ({
  extension,
}) => {
  await saveDirectly(extension)
  const previousUrl = await linkFor(extension).getAttribute('href')
  await extension.orderPage.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent('pagehide', { persisted: true })
    )
  )
  await expect(controlFor(extension)).toHaveCount(1)
  await expect(linkFor(extension)).toHaveAttribute('href', '#')
  await expectRevoked(extension.orderPage, previousUrl)
  await saveDirectly(extension)
  const secondUrl = await linkFor(extension).getAttribute('href')
  const destination = new URL(extension.orderPage.url())
  destination.searchParams.set('navigation', 'next')
  await extension.orderPage.goto(destination.href)
  await expect(controlFor(extension)).toHaveCount(1)
  await expect(linkFor(extension)).toHaveAttribute('href', '#')
  await expectRevoked(extension.orderPage, secondUrl)
  expect(await savedFiles(extension)).toHaveLength(2)
  expect(extension.unexpectedRequests).toEqual([])
})
