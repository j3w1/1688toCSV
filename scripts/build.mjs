import { build } from 'esbuild'
import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  cp,
  readdir,
  rm,
} from 'node:fs/promises'
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
  entryPoints: { popup: 'src/popup-entry.js', content: 'src/content.js' },
  outdir: output,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: !process.argv.includes('--development'),
  sourcemap: false,
})
for (const file of ['popup.html', 'popup.css'])
  await copyFile(path.join(root, 'src', file), path.join(output, file))
await cp(path.join(root, 'icons'), path.join(output, 'icons'), {
  recursive: true,
})
await writeFile(
  path.join(output, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
)
const resources = [
  manifest.action.default_popup,
  ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap((script) => script.js),
]
for (const resource of resources) await readFile(path.join(output, resource))
const html = await readFile(path.join(output, 'popup.html'), 'utf8')
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g))
  await readFile(path.join(output, match[1]))
console.log(
  `Built complete extension ${pkg.version} → dist (${resources.length} manifest resources verified)`
)
