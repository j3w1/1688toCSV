import { chromium } from '@playwright/test'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { once } from 'node:events'

/** Native IndexedDB on a disposable localhost origin, never an owner extension/profile. */
export async function databaseBrowser() {
  const bundle = await build({
    stdin: {
      contents:
        "import {openDatabase,validateBackup} from './src/database.js'; import * as fixture from './tests/fixtures/container-fixture.mjs'; import * as reports from './src/packing-report-model.js'; import * as cells from './src/packing-report-cells.js'; import * as matches from './src/packing-report-matches.js'; import * as archive from './src/backup-file.js'; import * as cartons from './src/carton-batches.js'; import * as payments from './src/payment-links.js'; window.modules={openDatabase,validateBackup,fixture,reports,cells,matches,archive,cartons,payments};",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'chrome120',
  })
  const script = bundle.outputFiles[0].text
  const server = createServer((request, response) => {
    response.writeHead(200, {
      'Content-Type':
        request.url === '/test.js' ? 'text/javascript' : 'text/html',
    })
    response.end(
      request.url === '/test.js'
        ? script
        : '<!doctype html><script src="/test.js"></script>'
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    const origin = `http://127.0.0.1:${server.address().port}`
    const page = await context.newPage()
    await page.goto(origin)
    await page.waitForFunction(() => !!window.modules)
    return {
      page,
      async newPage() {
        const tab = await context.newPage()
        await tab.goto(origin)
        await tab.waitForFunction(() => !!window.modules)
        return tab
      },
      async close() {
        await browser.close()
        await new Promise((resolve) => server.close(resolve))
      },
    }
  } catch (error) {
    await browser?.close()
    server.close()
    throw error
  }
}
