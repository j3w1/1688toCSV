import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { createOrderFixture } from '../tests/fixtures/order-fixture.mjs'
import { extractOrder } from '../src/extract.js'

const root = fileURLToPath(new URL('../', import.meta.url))
export async function startPreview({ port = 0 } = {}) {
  const entry = await build({
    absWorkingDir: root,
    entryPoints: ['preview/entry.js'],
    bundle: true,
    write: false,
    format: 'esm',
  })
  const library = await build({
    absWorkingDir: root,
    entryPoints: ['preview/library-entry.js'],
    bundle: true,
    write: false,
    format: 'esm',
  })
  const assets = new Map([
    [
      '/icons/icon48.png',
      ['image/png', await readFile(path.join(root, 'icons/icon48.png'))],
    ],
    [
      '/theme.js',
      ['text/javascript', await readFile(path.join(root, 'src/theme.js'))],
    ],
    [
      '/library.html',
      [
        'text/html; charset=utf-8',
        (await readFile(path.join(root, 'src/library.html'), 'utf8')).replace(
          'src="library.js"',
          'src="library-preview.js"'
        ),
      ],
    ],
    [
      '/library-preview.js',
      ['text/javascript', library.outputFiles[0].contents],
    ],
    [
      '/library.css',
      ['text/css', await readFile(path.join(root, 'src/library.css'))],
    ],
    [
      '/',
      [
        'text/html; charset=utf-8',
        await readFile(path.join(root, 'preview/index.html')),
      ],
    ],
    ['/entry.js', ['text/javascript', entry.outputFiles[0].contents]],
    [
      '/export.html',
      [
        'text/html; charset=utf-8',
        await readFile(path.join(root, 'preview/export.html')),
      ],
    ],
    [
      '/export.js',
      ['text/javascript', await readFile(path.join(root, 'preview/export.js'))],
    ],
    [
      '/fixture-data.json',
      [
        'application/json; charset=utf-8',
        JSON.stringify(
          extractOrder(
            createOrderFixture(),
            'https://example.invalid/?orderId=1234567890123456789'
          )
        ),
      ],
    ],
  ])
  for (const css of [
    'packing.css',
    'label-editor.css',
    'photo-viewer.css',
    'copy-actions.css',
    'code-design.css',
    'error-notice.css',
    'image-copy-dialog.css',
    'appearance-settings.css',
    'packing-review.css',
    'shell.css',
  ])
    assets.set(`/${css}`, [
      'text/css',
      await readFile(path.join(root, 'src', css)),
    ])
  assets.set('/assets/casa-elida.png', [
    'image/png',
    await readFile(path.join(root, 'src/assets/casa-elida.png')),
  ])
  const server = createServer((request, response) => {
    const asset = assets.get(new URL(request.url, 'http://127.0.0.1').pathname)
    if (!asset || request.method !== 'GET') {
      response.writeHead(404)
      response.end()
      return
    }
    response.writeHead(200, {
      'Content-Type': asset[0],
      'Cache-Control': 'no-store',
    })
    response.end(asset[1])
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const url = `http://127.0.0.1:${server.address().port}`
  return {
    url,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const preview = await startPreview({ port: 4173 })
  console.log(
    `Synthetic order-page preview: ${preview.url}\nOrder library preview: ${preview.url}/library.html\nUse ?state=error for invalid-order feedback. No live orders.\nNo watch mode: restart preview after changes.`
  )
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
      await preview.close()
      process.exit()
    })
}
