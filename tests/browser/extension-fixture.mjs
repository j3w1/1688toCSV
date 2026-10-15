import { test as base, chromium } from '@playwright/test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:http'
import {
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
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname
    if (
      [
        '/src/database.js',
        '/src/packing-model.js',
        '/src/product-vocabulary.js',
        '/src/order-date.js',
        '/src/clipboard.js',
        '/src/money.js',
        '/src/list-toolbar.js',
      ].includes(pathname)
    ) {
      response.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
      })
      response.end(await readFile(path.join(repository, pathname.slice(1))))
      return
    }
    if (!['/fixture.html', '/unsupported'].includes(pathname)) {
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

async function prepareExtension(directory, importFlow) {
  await cp(path.join(repository, 'dist'), directory, { recursive: true })
  const manifestPath = path.join(directory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  // Additional test-only inspection and reinjection permissions.
  manifest.permissions = [
    ...new Set([...(manifest.permissions ?? []), 'downloads', 'scripting']),
  ]
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
    matches: [
      script.js.includes('list-content.js')
        ? 'http://127.0.0.1/list.html*'
        : 'http://127.0.0.1/fixture.html*',
    ],
  }))
  if (importFlow) {
    // Run the production pipeline on reserved, synthetic .test origins only.
    // Static origin substitutions do not replace any browser APIs or logic.
    for (const name of [
      'background.js',
      'content.js',
      'list-content.js',
      'library.js',
    ]) {
      const file = path.join(directory, name)
      await writeFile(
        file,
        (await readFile(file, 'utf8')).replaceAll('1688.com', '1688.test')
      )
    }
    manifest.host_permissions = ['https://*.1688.test/*', localhostMatch]
    manifest.content_scripts[0].matches = [
      'https://air.1688.test/app/ctf-page/trade-order-detail/index.html*',
    ]
    manifest.content_scripts[1].matches = [
      'https://air.1688.test/app/ctf-page/trade-order-list/buyer-order-list.html*',
    ]
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  await writeFile(
    path.join(directory, 'inspector.html'),
    '<!doctype html><html lang="en"><title>Test inspector</title><body></body></html>'
  )
  return extensionId
}

export const test = base.extend({
  importFlow: [false, { option: true }],
  extension: async ({ importFlow }, use) => {
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
      const extensionId = await prepareExtension(extensionPath, importFlow)
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
        channel: process.env.EXTENSION_TEST_CHANNEL || 'chromium',
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
      const inspector = await context.newPage()
      await inspector.goto(`chrome-extension://${extensionId}/inspector.html`)
      const tabId = await inspector.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({})
        return tabs.find((tab) => tab.url === url)?.id
      }, fixtureUrl)
      if (!Number.isInteger(tabId))
        throw new Error('Synthetic fixture tab was not found')
      const downloads = await context.newCDPSession(inspector)
      // Chromium's ordinary download flow preserves chrome.downloads filename
      // suggestions. The disposable profile sets the target directory above.
      await downloads.send('Browser.setDownloadBehavior', {
        behavior: 'default',
        eventsEnabled: true,
      })
      await use({
        context,
        extensionBaseUrl: `chrome-extension://${extensionId}`,
        origin: local.origin,
        inspector,
        orderPage,
        tabId,
        downloadPath,
        unexpectedRequests,
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
