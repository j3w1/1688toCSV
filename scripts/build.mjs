import { build } from 'esbuild'
import { mkdir, readFile, writeFile, cp, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'dist')
// This is the sole generated directory; never clean a caller-provided path.
if (
  path.dirname(output) !== path.resolve(root) ||
  path.basename(output) !== 'dist'
)
  throw new Error('Invalid build path')
await mkdir(output, { recursive: true })
for (const entry of await readdir(output))
  await rm(path.join(output, entry), { recursive: true, force: true })
const manifest = JSON.parse(
  await readFile(path.join(root, 'manifest.json'), 'utf8')
)
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
if (manifest.version !== pkg.version)
  throw new Error('Manifest and package versions differ')
await build({
  absWorkingDir: root,
  entryPoints: {
    content: 'src/content.js',
    'list-content': 'src/list-content.js',
    background: 'src/background.js',
    library: 'src/library.js',
    'store-workbook-worker': 'src/store-workbook-worker.js',
  },
  outdir: output,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: !process.argv.includes('--development'),
  sourcemap: false,
})
await cp(path.join(root, 'icons'), path.join(output, 'icons'), {
  recursive: true,
})
await cp(path.join(root, 'src/assets'), path.join(output, 'assets'), {
  recursive: true,
})
for (const resource of [
  'library.html',
  'library.css',
  'store-import.css',
  'order-charges.css',
  'operations.css',
  'payment-links.css',
  'repeat-products.css',
  'photo-viewer.css',
  'copy-actions.css',
  'code-design.css',
  'error-notice.css',
  'image-copy-dialog.css',
  'appearance-settings.css',
  'packing.css',
  'packing-review.css',
  'label-editor.css',
  'shell.css',
  'theme.js',
])
  await cp(path.join(root, 'src', resource), path.join(output, resource))
await writeFile(
  path.join(output, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
)
const resources = [
  'store-workbook-worker.js',
  'store-import.css',
  'order-charges.css',
  'operations.css',
  'payment-links.css',
  'repeat-products.css',
  ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap((script) => script.js),
  manifest.background.service_worker,
  'library.html',
  'library.css',
  'photo-viewer.css',
  'copy-actions.css',
  'code-design.css',
  'error-notice.css',
  'image-copy-dialog.css',
  'appearance-settings.css',
  'library.js',
  'theme.js',
  'packing.css',
  'packing-review.css',
  'label-editor.css',
  'shell.css',
  'assets/casa-elida.png',
]
for (const resource of resources) await readFile(path.join(output, resource))
console.log(
  `Built complete extension ${pkg.version} → dist (${resources.length} manifest resources verified)`
)
