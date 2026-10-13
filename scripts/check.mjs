import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

async function check(folder) {
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const filename = path.join(folder, item.name)
    if (item.isDirectory()) await check(filename)
    else if (/\.m?js$/.test(item.name)) {
      const result = spawnSync(process.execPath, ['--check', filename], {
        stdio: 'inherit',
      })
      if (result.status !== 0) process.exit(result.status || 1)
    }
  }
}
for (const folder of ['src', 'scripts', 'tests', 'preview']) await check(folder)
console.log('JavaScript syntax checks passed')
