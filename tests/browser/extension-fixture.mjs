import { test as base, chromium } from '@playwright/test'
import { build } from 'esbuild'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:http'
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildOrderFixture } from '../fixtures/order-fixture.mjs'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const syntheticOrderId = '1234567890123456789'

async function startFixtureServer() {
  const server = createServer((request, response) => {
    if (new URL(request.url, 'http://127.0.0.1').pathname !== '/fixture.html') {
      response.writeHead(404)
      response.end()
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(
      '<!doctype html><html lang="en"><title>Synthetic order fixture</title><body></body></html>'
    )
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  return { server, origin }
}

async function prepareExtension(directory) {
  await cp(path.join(repository, 'dist'), directory, { recursive: true })
  const manifestPath = path.join(directory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  // Test-only inspection of real completed files; production saves use page links.
  manifest.permissions = [...new Set([...manifest.permissions, 'downloads'])]
  // A new public key determines this disposable extension's ID without needing
  // a background worker. Neither the key nor localhost access reaches dist.
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 })
  const key = publicKey.export({ type: 'spki', format: 'der' })
  manifest.key = key.toString('base64')
  const extensionId = [
    ...createHash('sha256').update(key).digest('hex').slice(0, 32),
  ]
    .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
    .join('')
  const localhostMatch = 'http://127.0.0.1/*'
  manifest.host_permissions = [
    ...(manifest.host_permissions ?? []),
    localhostMatch,
  ]
  // There is intentionally no remote page match in the disposable fixture copy.
  manifest.content_scripts = manifest.content_scripts.map((script) => ({
    ...script,
    matches: [localhostMatch],
  }))
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  await copyFile(
    path.join(directory, 'popup.js'),
    path.join(directory, 'production-popup.js')
  )
  const productionHtml = (
    await readFile(path.join(directory, 'popup.html'), 'utf8')
  ).replace('src="popup.js"', 'src="production-popup.js"')
  await writeFile(path.join(directory, 'production-popup.html'), productionHtml)
  await build({
    entryPoints: [path.join(repository, 'tests/browser/popup-entry.js')],
    outfile: path.join(directory, 'popup.js'),
    bundle: true,
    format: 'iife',
    target: 'chrome120',
  })
  return extensionId
}

export const test = base.extend({
  extension: async ({}, use) => {
    const temporaryParent = await realpath(tmpdir())
    const temporaryRoot = await mkdtemp(
      path.join(temporaryParent, '1688tocsv-browser-')
    )
    const extensionPath = path.join(temporaryRoot, 'extension')
    const downloadPath = path.join(temporaryRoot, 'downloads')
    const profilePath = path.join(temporaryRoot, 'profile')
    let context
    let server
    try {
      const extensionId = await prepareExtension(extensionPath)
      await mkdir(downloadPath, { recursive: true })
      await mkdir(path.join(profilePath, 'Default'), { recursive: true })
      await writeFile(
        path.join(profilePath, 'Default', 'Preferences'),
        JSON.stringify({
          download: {
            default_directory: downloadPath,
            prompt_for_download: false,
          },
        })
      )
      const local = await startFixtureServer()
      server = local.server
      context = await chromium.launchPersistentContext(profilePath, {
        channel: 'chromium',
        headless: true,
        acceptDownloads: true,
        downloadsPath: downloadPath,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
          '--disable-background-networking',
          '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
        ],
      })
      const unexpectedRequests = []
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          if (url.origin !== local.origin) {
            unexpectedRequests.push(url.origin)
            await route.abort('blockedbyclient')
            return
          }
        }
        await route.continue()
      })
      const orderPage = await context.newPage()
      const fixtureUrl = `${local.origin}/fixture.html?orderId=${syntheticOrderId}`
      await orderPage.goto(fixtureUrl)
      async function setOrder(options = {}) {
        await orderPage.evaluate(
          `void (${buildOrderFixture.toString()})(document, ${JSON.stringify(options)})`
        )
      }
      await setOrder()
      const popup = await context.newPage()
      await popup.goto(
        `chrome-extension://${extensionId}/popup.html?unsupported=1`
      )
      const tabId = await popup.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({})
        return tabs.find((tab) => tab.url === url)?.id
      }, fixtureUrl)
      if (!Number.isInteger(tabId))
        throw new Error('Synthetic fixture tab was not found')
      const downloads = await context.newCDPSession(popup)
      // Chromium's ordinary download flow preserves chrome.downloads filename
      // suggestions. The disposable profile sets the target directory above.
      await downloads.send('Browser.setDownloadBehavior', {
        behavior: 'default',
        eventsEnabled: true,
      })
      async function openPopup({ unsupported = false } = {}) {
        const query = new URLSearchParams({ fixtureTab: String(tabId) })
        if (unsupported) query.set('unsupported', '1')
        await popup.goto(
          `chrome-extension://${extensionId}/popup.html?${query}`
        )
        return popup
      }
      await use({
        context,
        extensionBaseUrl: `chrome-extension://${extensionId}`,
        popup,
        orderPage,
        tabId,
        downloadPath,
        unexpectedRequests,
        openPopup,
        setOrder,
      })
    } finally {
      if (context) await context.close()
      if (server)
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        )
      const resolved = await realpath(temporaryRoot)
      if (
        path.dirname(resolved) !== temporaryParent ||
        !path.basename(resolved).startsWith('1688tocsv-browser-')
      ) {
        throw new Error(
          'Refusing to clean an unexpected browser test directory'
        )
      }
      await rm(resolved, { recursive: true, force: true, maxRetries: 3 })
    }
  },
})

export { expect } from '@playwright/test'
