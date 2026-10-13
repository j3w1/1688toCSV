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
