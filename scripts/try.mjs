// Fast local try-out loop: build, stage the complete dist into the installed
// unpacked extension, reload it through CE Dev Browser and confirm that the
// library survived. Machine-specific settings live outside the repository in
// ~/.config/1688topl/try.json (see AGENTS.md); nothing here reads order data
// beyond per-store record counts and import job states.
import { spawn, spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import {
  checkIdentity,
  readIdentity,
  recoverStaging,
  stagingPaths,
  swapIn,
} from './try-staging.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = new Set(process.argv.slice(2))
const usage = `Usage: npm run try -- [--quick] [--smoke] [--dry-run] [--rollback]
  (default)   unit tests, build, stage into the installed extension, reload, verify
  --quick     skip unit tests
  --smoke     also run npm run test:smoke before staging
  --dry-run   checks and build only; no staging or reload
  --rollback  put the previously staged build back and reload it`
if (args.has('--help')) {
  console.log(usage)
  process.exit(0)
}
const started = Date.now()
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`
const step = (text) => console.log(`[${elapsed()}] ${text}`)
const fail = (text, code = 1) => {
  console.error(`\ntry: ${text}`)
  process.exit(code)
}

const configRoot =
  process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config')
const configPaths = ['1688topl', '1688tocsv'].map((name) =>
  path.join(configRoot, name, 'try.json')
)
let config, configPath
for (const candidatePath of configPaths) {
  try {
    config = JSON.parse(await readFile(candidatePath, 'utf8'))
    configPath = candidatePath
    break
  } catch (error) {
    if (error.code !== 'ENOENT')
      fail(`could not read ${candidatePath}: ${error.message}`)
  }
}
if (!config)
  fail(
    `missing ${configPaths.join(' or ')}; see AGENTS.md "Fast local loop" for its fields.`
  )
const { installDir, extensionId, browserMcp, stagingDir } = config
if (
  !path.isAbsolute(installDir || '') ||
  !/^[a-p]{32}$/.test(extensionId || '') ||
  !Array.isArray(browserMcp) ||
  !path.isAbsolute(stagingDir || '')
)
  fail(
    `${configPath} needs absolute installDir and stagingDir, extensionId and browserMcp.`
  )
if (path.basename(installDir) !== 'dist' || installDir.startsWith(root))
  fail('installDir must be a dist folder outside this worktree.')

function run(command, commandArgs, label) {
  step(label)
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.status !== 0) fail(`${label} failed.`)
}

// Minimal MCP stdio client for the same CE Dev Browser server agents use.
function browser() {
  const child = spawn(browserMcp[0], browserMcp.slice(1), {
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  let buffer = ''
  let next = 0
  const waiting = new Map()
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    for (let end; (end = buffer.indexOf('\n')) >= 0; ) {
      const line = buffer.slice(0, end).trim()
      buffer = buffer.slice(end + 1)
      if (!line) continue
      const message = JSON.parse(line)
      waiting.get(message.id)?.(message)
      waiting.delete(message.id)
    }
  })
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = ++next
      waiting.set(id, resolve)
      child.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
      )
    })
  return {
    async start() {
      await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: '1688topl-try', version: '1' },
      })
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }) + '\n'
      )
    },
    async call(name, input, { tolerate } = {}) {
      const message = await request('tools/call', { name, arguments: input })
      const text = (message.result?.content || [])
        .map((item) => item.text || '')
        .join('\n')
      if (tolerate && new RegExp(`"refused": "(${tolerate})"`).test(text))
        return null
      if (message.error || message.result?.isError || /"refused"/.test(text)) {
        // Print CE's own refusal code and message only, never page or extension payloads.
        let refusal = {}
        try {
          refusal = JSON.parse(text)
        } catch {}
        fail(
          refusal.refused
            ? `CE Dev Browser ${name} refused (${refusal.refused}): ${String(refusal.message || '').slice(0, 200)}`
            : `CE Dev Browser ${name} returned an unexpected response.`,
          2
        )
      }
      return text
    },
    stop: () => child.kill(),
  }
}
const resultJson = (text) => {
  const match = /### Result\n([\s\S]*?)(\n###|$)/.exec(text)
  return JSON.parse(match ? match[1] : text)
}

// Read-only: open the database without a version (an upgrade aborts), count
// every store and list import job states.
const readLibrary = `async () => {
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open('1688-order-library')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
    open.onupgradeneeded = () => { open.transaction.abort(); reject(new Error('library database missing')) }
  })
  const names = [...db.objectStoreNames]
  const tx = db.transaction(names, 'readonly')
  const ask = (q) => new Promise((resolve, reject) => { q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error) })
  const counts = {}
  for (const name of names) counts[name] = await ask(tx.objectStore(name).count())
  const jobs = names.includes('jobs') ? (await ask(tx.objectStore('jobs').getAll())).map((job) => job.state) : []
  db.close()
  let build = null
  try { build = await (await fetch('/build-info.json', { cache: 'no-store' })).json() } catch {}
  return { counts, jobs, build }
}`

async function inspect(client, label) {
  const marker = `try-${Date.now()}`
  await client.call('browser_tabs', {
    action: 'new',
    url: `chrome-extension://${extensionId}/manifest.json?${marker}`,
  })
  await client.call('browser_snapshot', { depth: 1 })
  const library = resultJson(
    await client.call('browser_evaluate', { function: readLibrary })
  )
  const tabs = await client.call('browser_tabs', { action: 'list' })
  const own = new RegExp(`^- (\\d+): .*\\?${marker}\\)`, 'm').exec(tabs)
  if (own)
    await client.call('browser_tabs', {
      action: 'close',
      index: Number(own[1]),
    })
  const ownerTabs = tabs
    .split('\n')
    .filter(
      (line) =>
        line.includes(`chrome-extension://${extensionId}/`) &&
        !line.includes(marker)
    ).length
  step(
    `${label}: ${Object.entries(library.counts)
      .map(([key, value]) => `${key} ${value}`)
      .join(', ')}`
  )
  return { ...library, ownerTabs }
}

async function registered(client) {
  const list = JSON.parse(
    await client.call('browser_extension', { action: 'list' })
  )
  const entry = list.registered?.find((item) => item.id === extensionId)
  if (!entry || path.resolve(entry.path) !== path.resolve(installDir))
    fail(
      `extension ${extensionId} is not registered from ${installDir}; refusing to load anything new.`
    )
  const loaded = list.extensions?.find((item) => item.id === extensionId)
  return { loaded, errors: list.errors || {} }
}

await mkdir(stagingDir, { recursive: true })
if ((await stat(stagingDir)).dev !== (await stat(path.dirname(installDir))).dev)
  fail(
    'stagingDir must be on the same filesystem as installDir for an atomic swap.'
  )
// Finish or undo an interrupted run before reading the installed build.
try {
  const recovered = await recoverStaging({ installDir, stagingDir })
  if (recovered !== 'none')
    step(
      recovered === 'restored'
        ? 'Recovered an interrupted run: the previous install is back in place.'
        : 'Recovered an interrupted run: the new install stays, rollback updated.'
    )
} catch (error) {
  fail(error.message)
}
let installed
try {
  installed = await readIdentity(installDir)
} catch {
  fail(`${installDir} has no readable manifest.json.`)
}
if (!['1688toPL', '1688toCSV'].includes(installed.name))
  fail(`${installDir} does not hold the 1688toPL extension.`)
const { previous } = stagingPaths(stagingDir)
const verifyCandidate = async (directory) => {
  try {
    checkIdentity(await readIdentity(directory), installed)
  } catch (error) {
    fail(error.message)
  }
}

let candidate
if (args.has('--rollback')) {
  try {
    await stat(path.join(previous, 'manifest.json'))
  } catch {
    fail('no previously staged build to restore.')
  }
  await verifyCandidate(previous)
  candidate = previous
} else {
  if (!args.has('--quick'))
    run(process.execPath, ['--test', ...testFiles()], 'Unit tests')
  if (args.has('--smoke'))
    run('npm', ['run', '--silent', 'test:smoke'], 'Browser smoke tests')
  run(process.execPath, ['scripts/build.mjs', '--development'], 'Build')
  const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).stdout.trim()
  const dirty =
    spawnSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    }).stdout.trim() !== ''
  await verifyCandidate(path.join(root, 'dist'))
  const built = (await readIdentity(path.join(root, 'dist'))).manifest
  if (
    JSON.stringify(built.permissions) !==
    JSON.stringify(installed.manifest.permissions)
  )
    console.warn(
      'try: permissions changed; Chrome may ask to re-enable the extension.'
    )
  candidate = path.join(stagingDir, `build-${Date.now()}`)
  await cp(path.join(root, 'dist'), candidate, { recursive: true })
  await writeFile(
    path.join(candidate, 'build-info.json'),
    JSON.stringify(
      { commit, dirty, builtAt: new Date().toISOString(), worktree: root },
      null,
      2
    ) + '\n'
  )
}
if (args.has('--dry-run')) {
  if (candidate !== previous)
    await rm(candidate, { recursive: true, force: true })
  step('Dry run complete; nothing staged.')
  process.exit(0)
}

const client = browser()
await client.start()
try {
  // Wait up to five minutes for another agent's lease; never take over from the owner.
  for (let attempt = 0; ; attempt++) {
    const lease = await client.call(
      'browser_lease',
      {
        action: 'acquire',
        purpose: '1688toPL try: reload extension',
        ttl_s: 120,
      },
      { tolerate: 'lease_held' }
    )
    if (lease !== null) break
    if (attempt === 4)
      fail('the browser stayed busy for five minutes; try again later.', 2)
    step('Waiting for the browser lease')
    await client.call('browser_wait', {
      events: ['lease', 'control'],
      timeout_s: 60,
    })
  }
  await registered(client)
  const before = await inspect(client, 'Library before')
  if (before.jobs.includes('running'))
    fail('an import is running; let it finish or pause it, then try again.', 2)
  if (before.ownerTabs)
    console.warn(
      `try: ${before.ownerTabs} open workspace tab(s) close on reload; one workspace tab reopens afterwards.`
    )

  // Swap complete folders; the browser only reads installDir on reload.
  step('Stage complete build')
  await swapIn({ installDir, stagingDir, candidate })

  step('Reload through CE Dev Browser')
  await client.call('browser_extension', { action: 'reload', id: extensionId })
  const { loaded, errors } = await registered(client)
  if (!loaded?.enabled) fail('the reloaded extension is not enabled.', 3)
  if (Object.keys(errors).length)
    fail(
      `the reloaded extension reports ${Object.keys(errors).length} error group(s); read them with browser_extension logs.`,
      3
    )
  const after = await inspect(client, 'Library after')
  const changed = Object.keys({ ...before.counts, ...after.counts }).filter(
    (key) => before.counts[key] !== after.counts[key]
  )
  if (changed.length)
    fail(
      `library counts changed after reload: ${changed.join(', ')}. Do not retry; inspect first.`,
      4
    )
  const build = after.build
  // Chrome closes extension pages on reload; give the owner their workspace back.
  if (before.ownerTabs)
    await client.call('browser_tabs', {
      action: 'new',
      url: `chrome-extension://${extensionId}/library.html`,
    })
  step(
    `Done: ${extensionId} ${loaded.version} running ${build ? `${build.commit}${build.dirty ? '+dirty' : ''}` : 'a build without build-info'}; library unchanged.`
  )
} finally {
  await client.call(
    'browser_lease',
    { action: 'release' },
    { tolerate: '[a-z_]+' }
  )
  client.stop()
}

function testFiles() {
  const result = spawnSync('git', ['ls-files', 'tests/*.test.mjs'], {
    cwd: root,
    encoding: 'utf8',
  })
  return result.stdout.split('\n').filter(Boolean)
}
