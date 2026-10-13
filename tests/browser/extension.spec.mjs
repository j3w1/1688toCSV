import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from './extension-fixture.mjs'

test('unmodified production popup bundle loads under extension CSP and classifies its current tab', async ({
  extension,
}) => {
  const errors = []
  extension.popup.on('pageerror', (error) => errors.push(error.message))
  await extension.popup.goto(
    `${extension.extensionBaseUrl}/production-popup.html`
  )
  await expect(extension.popup.locator('body')).toHaveAttribute(
    'data-state',
    'unsupported'
  )
  await expect(
    extension.popup.getByRole('button', { name: /Download CSV/ })
  ).toBeDisabled()
  expect(
    await extension.popup.evaluate(
      () => document.styleSheets[0]?.cssRules.length
    )
  ).toBeGreaterThan(0)
  expect(errors).toEqual([])
  expect(extension.unexpectedRequests).toEqual([])
})

test('real extension messaging exports a completed CSV download from nested synthetic order DOM', async ({
  extension,
}) => {
  const popup = await extension.openPopup()
  await expect(popup.locator('body')).toHaveAttribute('data-state', 'ready')
  await expect(popup.locator('#row-count')).toHaveText('2')
  await popup.getByRole('button', { name: /Download CSV/ }).click()
  await expect(popup.locator('body')).toHaveAttribute('data-state', 'success')
  const downloads = await popup.evaluate(() => chrome.downloads.search({}))
  expect(downloads).toHaveLength(1)
  expect(downloads[0].state).toBe('complete')
  expect(path.basename(downloads[0].filename)).toBe('示例工厂_6789.csv')
  expect(path.resolve(path.dirname(downloads[0].filename))).toBe(
    path.resolve(extension.downloadPath)
  )
  const bytes = await readFile(downloads[0].filename)
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const text = bytes.toString('utf8')
  expect(text).toMatch(
    /^\uFEFFThumbnail,Description,Price,Quantity,Discount\r\n/
  )
  expect(text).toContain('测试香薰蜡烛\n颜色：暖白\n货号：DEMO-001')
  expect(text).toContain('桌面收纳盒\n款式：小号\n货号：DEMO-002')
  // Fixture descriptions use LF within quoted fields; CRLF marks CSV records.
  expect(text.trimEnd().split('\r\n')).toHaveLength(3)
  expect(text).toMatch(/,12\.50,4,2\.10\r\n/)
  expect(text).toMatch(/,8\.00,2,0\.30(?:\r\n)?$/)
  await popup.getByRole('button', { name: /Download CSV/ }).click()
  await expect(popup.locator('body')).toHaveAttribute('data-state', 'success')
  const repeatedDownloads = await popup.evaluate(() =>
    chrome.downloads.search({})
  )
  expect(repeatedDownloads).toHaveLength(2)
  const repeated = repeatedDownloads.find((item) => item.id !== downloads[0].id)
  expect(repeated.state).toBe('complete')
  expect(repeated.filename).not.toBe(downloads[0].filename)
  expect(await readFile(repeated.filename)).toEqual(bytes)
  await expect(popup.locator('#feedback')).toHaveText(
    path.basename(repeated.filename)
  )
  expect(extension.unexpectedRequests).toEqual([])
})

test('reinjecting the production content bundle replaces its old listener and keeps messaging usable', async ({
  extension,
}) => {
  const popup = await extension.openPopup()
  await expect(popup.locator('body')).toHaveAttribute('data-state', 'ready')
  await popup.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        globalThis.__previous1688Listener =
          globalThis[Symbol.for('1688tocsv.messageListener')]
      },
    })
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    })
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    })
  }, extension.tabId)
  const result = await popup.evaluate(async (tabId) => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        replaced:
          globalThis.__previous1688Listener !==
          globalThis[Symbol.for('1688tocsv.messageListener')],
        oldRegistered: chrome.runtime.onMessage.hasListener(
          globalThis.__previous1688Listener
        ),
        currentRegistered: chrome.runtime.onMessage.hasListener(
          globalThis[Symbol.for('1688tocsv.messageListener')]
        ),
      }),
    })
    return {
      ...result,
      ping: await chrome.tabs.sendMessage(tabId, { action: 'ping' }),
    }
  }, extension.tabId)
  expect(result).toEqual({
    replaced: true,
    oldRegistered: false,
    currentRegistered: true,
    ping: { status: 'ready', rowCount: 2 },
  })
  await popup.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        chrome.runtime.onMessage.removeListener(
          globalThis[Symbol.for('1688tocsv.messageListener')]
        ),
    })
  }, extension.tabId)
  await extension.openPopup()
  await expect(popup.locator('body')).toHaveAttribute('data-state', 'ready')
  expect(extension.unexpectedRequests).toEqual([])
})

test('unsupported pages keep export disabled without starting a download', async ({
  extension,
}) => {
  const popup = await extension.openPopup({ unsupported: true })
  await expect(popup.locator('body')).toHaveAttribute(
    'data-state',
    'unsupported'
  )
  await expect(
    popup.getByRole('button', { name: /Download CSV/ })
  ).toBeDisabled()
  expect(await popup.evaluate(() => chrome.downloads.search({}))).toEqual([])
  expect(extension.unexpectedRequests).toEqual([])
})

test('an empty order times out usefully and recovers when rows load and the user retries', async ({
  extension,
}) => {
  await extension.setOrder({ rows: [] })
  const popup = await extension.openPopup()
  await expect(popup.locator('body')).toHaveAttribute('data-state', 'error')
  await expect(popup.locator('#feedback')).toContainText('still loading')
  await expect(
    popup.getByRole('button', { name: /Download CSV/ })
  ).toBeDisabled()
  await extension.setOrder()
  await popup.getByRole('button', { name: 'Check page again' }).click()
  await expect(popup.locator('body')).toHaveAttribute('data-state', 'ready')
  expect(await popup.evaluate(() => chrome.downloads.search({}))).toEqual([])
  expect(extension.unexpectedRequests).toEqual([])
})

test('a malformed product fails the full export and creates no partial download', async ({
  extension,
}) => {
  await extension.setOrder({
    rows: [
      { title: 'Valid synthetic item', price: '1.50', quantity: '2' },
      { title: 'Incomplete synthetic item', price: '2.50', quantity: '' },
    ],
  })
  const popup = await extension.openPopup()
  await expect(popup.locator('body')).toHaveAttribute('data-state', 'ready')
  await popup.getByRole('button', { name: /Download CSV/ }).click()
  await expect(popup.locator('body')).toHaveAttribute('data-state', 'error')
  await expect(popup.locator('#feedback')).toContainText('Row 2')
  expect(await popup.evaluate(() => chrome.downloads.search({}))).toEqual([])
  expect(extension.unexpectedRequests).toEqual([])
})

test('a rejected API start can save from the order page after its extension popup closes', async ({
  extension,
}) => {
  const popup = await extension.openPopup()
  await expect(popup.locator('body')).toHaveAttribute('data-state', 'ready')
  await popup.evaluate(() => {
    chrome.downloads.download = async () => {
      throw new Error('USER_CANCELED')
    }
  })
  await popup.getByRole('button', { name: /Download CSV/ }).click()
  await expect(popup.locator('#feedback')).toContainText('could not start')
  expect(await popup.evaluate(() => chrome.downloads.search({}))).toEqual([])
  const alternate = popup.getByRole('button', { name: 'Save CSV another way' })
  await expect(alternate).toBeVisible()
  await alternate.click()
  await expect(popup.locator('body')).toHaveAttribute('data-state', 'requested')
  await expect(popup.locator('#feedback')).toContainText('Close this popup')
  const panel = extension.orderPage.getByRole('dialog', {
    name: 'Save order CSV',
  })
  await expect(panel).toBeVisible()
  const link = panel.getByRole('link', { name: 'Save CSV', exact: true })
  const firstUrl = await link.getAttribute('href')
  expect(firstUrl).toMatch(/^blob:http:\/\/127\.0\.0\.1:/)
  await expect(link).toHaveAttribute('download', '示例工厂_6789.csv')
  await alternate.click()
  await expect.poll(() => link.getAttribute('href')).not.toBe(firstUrl)
  await expect(panel).toHaveCount(1)
  expect(
    await extension.orderPage.evaluate(async (url) => {
      try {
        await fetch(url)
        return false
      } catch {
        return true
      }
    }, firstUrl)
  ).toBe(true)
  await popup.close()
  const downloadWait = extension.orderPage.waitForEvent('download')
  await link.click()
  const download = await downloadWait
  expect(download.suggestedFilename()).toBe('示例工厂_6789.csv')
  expect(await download.failure()).toBeNull()
  // With Chromium's default download behavior, its real filename is not the
  // Playwright-managed GUID artifact path. Query the completed browser item.
  const inspector = await extension.context.newPage()
  await inspector.goto(`${extension.extensionBaseUrl}/production-popup.html`)
  const [saved] = await inspector.evaluate(() => chrome.downloads.search({}))
  expect(saved.state).toBe('complete')
  expect(path.basename(saved.filename)).toBe('示例工厂_6789.csv')
  const bytes = await readFile(saved.filename)
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  expect(bytes.toString('utf8')).toMatch(/,12\.50,4,2\.10\r\n/)
  expect(bytes.toString('utf8')).toMatch(/,8\.00,2,0\.30\r\n/)
  await expect(panel.getByRole('status')).toContainText('Save requested')
  const url = await link.getAttribute('href')
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(panel).toHaveCount(0)
  expect(
    await extension.orderPage.evaluate(async (url) => {
      try {
        await fetch(url)
        return false
      } catch {
        return true
      }
    }, url)
  ).toBe(true)
  expect(extension.unexpectedRequests).toEqual([])
})

test('the saved CSV preserves row discount summaries instead of recomputing rounded unit prices', async ({
  extension,
}) => {
  await extension.setOrder({
    rows: [
      {
        title: 'Synthetic item A',
        price: '3.00',
        discountedPrice: '2.84',
        quantity: '300',
        discountSummary: ['优惠', '共', '47.20', '元'],
        discounts: ['省40.00元', '减7.20元'],
      },
      {
        title: 'Synthetic item B',
        price: '3.90',
        discountedPrice: '3.89',
        quantity: '20',
        discountSummary: '优惠共0.20元',
      },
    ],
  })
  const popup = await extension.openPopup()
  await expect(popup.locator('body')).toHaveAttribute('data-state', 'ready')
  await popup.getByRole('button', { name: /Download CSV/ }).click()
  await expect(popup.locator('body')).toHaveAttribute('data-state', 'success')
  const [download] = await popup.evaluate(() => chrome.downloads.search({}))
  expect(download.state).toBe('complete')
  const csv = await readFile(download.filename, 'utf8')
  expect(csv).toMatch(/,3\.00,300,47\.20\r\n/)
  expect(csv).toMatch(/,3\.90,20,0\.20\r\n/)
})

test('the page-save handoff revalidates the order and never opens a partial export', async ({
  extension,
}) => {
  const popup = await extension.openPopup()
  await expect(popup.locator('body')).toHaveAttribute('data-state', 'ready')
  await popup.evaluate(() => {
    chrome.downloads.download = async () => {
      throw new Error('USER_CANCELED')
    }
  })
  await popup.getByRole('button', { name: /Download CSV/ }).click()
  await expect(popup.locator('#save-csv')).toBeVisible()
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
  await popup.getByRole('button', { name: 'Save CSV another way' }).click()
  await expect(popup.locator('#status-text')).toHaveText(
    'Could not open the save panel'
  )
  await expect(popup.locator('#feedback')).toContainText('Row 1')
  await expect(
    extension.orderPage.getByRole('dialog', { name: 'Save order CSV' })
  ).toHaveCount(0)
  expect(await popup.evaluate(() => chrome.downloads.search({}))).toEqual([])
})
