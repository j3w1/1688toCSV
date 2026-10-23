// Checks/build always work. Loading is opt-in through machine configuration.
import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkIdentity,
  readIdentity,
  recoverStaging,
  stagingPaths,
  swapIn,
} from './try-staging.mjs'
import {
  canonicalDirectory,
  readTrialConfiguration,
  trialArguments,
  validateTrialConfiguration,
  within,
} from './try-config.mjs'
import {
  createTrialBrowser,
  libraryInspector,
  resultJson,
} from './try-browser.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const usage = `Usage: npm run try -- [--quick] [--smoke] [--dry-run] [--rollback] [--config FILE]
  (default)   unit tests and build; load only a configured local trial target
  --quick     skip unit tests
  --smoke     also run the packaged browser smoke subset
  --dry-run   checks and build only; configuration/browser are not accessed
  --rollback  restore the configured target's previously staged build
  --config    machine-local target file (or LOCAL_TRIAL_CONFIG)
No target: checks/build still run, nothing is loaded, exit 0.`
const started = Date.now()
const step = (text) =>
  console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${text}`)
const summary = { loaded: false, staged: false, verified: false }
function fail(message, exitCode = 1) {
  throw Object.assign(new Error(message), { exitCode })
}
function runScript(name, pkg) {
  if (!pkg.scripts?.[name]) fail(`package.json has no ${name} script.`)
  step(name)
  const npmCli = process.env.npm_execpath
  const result = npmCli
    ? spawnSync(process.execPath, [npmCli, 'run', '--silent', name], {
        cwd: root,
        stdio: 'inherit',
      })
    : spawnSync(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['run', '--silent', name],
        { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }
      )
  if (result.error || result.status !== 0) fail(`${name} failed.`)
}
function git(args) {
  return (
    spawnSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).stdout?.trim() || ''
  )
}

async function main() {
  const { flags, configPath } = trialArguments(process.argv.slice(2))
  if (flags.has('--help')) {
    console.log(usage)
    return
  }
  const pkg = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8')
  )
  if (!flags.has('--rollback')) {
    if (!flags.has('--quick')) runScript('test', pkg)
    if (flags.has('--smoke')) runScript('test:smoke', pkg)
    runScript(pkg.scripts?.['build:dev'] ? 'build:dev' : 'build', pkg)
  }
  if (flags.has('--dry-run')) {
    summary.reason = 'dry-run'
    step('Dry run complete: nothing loaded.')
    return
  }
  const target = await readTrialConfiguration(root, { configPath })
  if (!target.config) {
    summary.reason = 'no-local-trial-target'
    step('no local trial target: nothing loaded')
    console.log(
      `Configure --config FILE, LOCAL_TRIAL_CONFIG, or ${target.paths[0]}; see docs/development.md.`
    )
    return
  }
  if (target.legacy)
    console.warn(
      `try: legacy config ${target.configPath} is deprecated; use ${target.paths[0]}.`
    )
  const config = validateTrialConfiguration(target.config)
  const { extensionId, browserMcp, databaseName } = config
  const sourceDir = path.resolve(root, config.buildDir || 'dist')
  if (
    !within(path.resolve(root), sourceDir) ||
    sourceDir === path.resolve(root)
  )
    fail('buildDir must be a generated folder inside this worktree.')
  const installPath = path.resolve(config.installDir),
    stagePath = path.resolve(config.stagingDir)
  if (
    within(path.resolve(root), installPath) ||
    within(path.resolve(root), stagePath) ||
    within(installPath, stagePath) ||
    within(stagePath, installPath)
  )
    fail(
      'installDir and stagingDir must be disjoint folders outside this worktree.'
    )
  const installDir = await canonicalDirectory(installPath),
    stagingDir = await canonicalDirectory(stagePath)
  const canonicalRoot = await canonicalDirectory(root)
  if (
    within(canonicalRoot, installDir) ||
    within(canonicalRoot, stagingDir) ||
    within(installDir, stagingDir) ||
    within(stagingDir, installDir)
  )
    fail(
      'Resolved installDir and stagingDir must be disjoint and outside this worktree.'
    )
  const canonicalSource = await canonicalDirectory(sourceDir)
  if (
    !within(canonicalRoot, canonicalSource) ||
    canonicalSource === canonicalRoot
  )
    fail('Resolved buildDir must remain inside this worktree.')
  await mkdir(stagingDir, { recursive: true })
  if (
    (await canonicalDirectory(stagePath)) !== stagingDir ||
    (await canonicalDirectory(installPath)) !== installDir
  )
    fail(
      'Trial target paths changed while preparing staging; inspect before retrying.'
    )
  if (
    (await stat(stagingDir)).dev !== (await stat(path.dirname(installDir))).dev
  )
    fail(
      'stagingDir must be on the same filesystem as installDir for an atomic swap.'
    )

  const compatibleNames = config.compatibleNames || [
    JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')).name,
  ]
  const client = createTrialBrowser(browserMcp)
  let leased = false
  async function registered() {
    const list = resultJson(
      await client.call('browser_extension', { action: 'list' })
    )
    const entry = list.registered?.find((item) => item.id === extensionId)
    if (!entry || (await canonicalDirectory(entry.path)) !== installDir)
      fail(
        `Extension ${extensionId} is not registered from the configured installDir; refusing to install a new identity.`,
        2
      )
    return {
      loaded: list.extensions?.find((item) => item.id === extensionId),
      errors: list.errors || {},
    }
  }
  async function inspect(label) {
    const marker = `try-${Date.now()}`
    await client.call('browser_tabs', {
      action: 'new',
      url: `chrome-extension://${extensionId}/manifest.json?${marker}`,
    })
    await client.call('browser_snapshot', { depth: 1 })
    const library = resultJson(
      await client.call('browser_evaluate', {
        function: libraryInspector(databaseName),
      })
    )
    if (
      !library.counts ||
      typeof library.counts !== 'object' ||
      Array.isArray(library.counts) ||
      !Object.keys(library.counts).length ||
      Object.values(library.counts).some(
        (n) => !Number.isSafeInteger(n) || n < 0
      ) ||
      !Array.isArray(library.jobs)
    )
      fail(
        'Browser did not prove existing library store counts and import states.',
        2
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
  let primaryError
  try {
    await client.start(pkg.name || 'extension')
    await client.call('browser_guide', {})
    for (let attempt = 0; ; attempt++) {
      const lease = await client.call(
        'browser_lease',
        {
          action: 'acquire',
          purpose: `${pkg.name || 'Extension'} local trial`,
          ttl_s: 120,
        },
        { tolerate: 'lease_held' }
      )
      if (lease !== null) {
        leased = true
        break
      }
      if (attempt === 4)
        fail('The browser stayed busy for five minutes; retry later.', 2)
      step('Waiting for the browser lease')
      await client.call('browser_wait', {
        events: ['lease', 'control'],
        timeout_s: 60,
      })
    }
    const initial = await registered()
    if (!initial.loaded?.enabled)
      fail(
        'The registered extension must already be enabled; first installation is a separate step.',
        2
      )
    const recovered = await recoverStaging({ installDir, stagingDir })
    if (recovered !== 'none')
      step(`Recovered interrupted staging (${recovered}).`)
    const installed = await readIdentity(installDir)
    const { previous } = stagingPaths(stagingDir)
    let candidate
    if (flags.has('--rollback')) {
      candidate = previous
      try {
        await stat(path.join(candidate, 'manifest.json'))
      } catch {
        fail('No previously staged build to restore.')
      }
    } else candidate = canonicalSource
    const built = await readIdentity(candidate)
    let expectedBuild = null
    if (flags.has('--rollback')) {
      try {
        expectedBuild = JSON.parse(
          await readFile(path.join(candidate, 'build-info.json'), 'utf8')
        )
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    checkIdentity(built, installed, { compatibleNames })
    const before = await inspect('Library before')
    if (before.jobs.includes('running'))
      fail('An import is running; finish or pause it before loading.', 2)
    if (!flags.has('--rollback')) {
      candidate = path.join(stagingDir, `build-${Date.now()}`)
      await cp(canonicalSource, candidate, { recursive: true })
      expectedBuild = {
        commit: git(['rev-parse', '--short', 'HEAD']) || 'unversioned',
        dirty: !!git(['status', '--porcelain']),
        builtAt: new Date().toISOString(),
        worktree: root,
      }
      await writeFile(
        path.join(candidate, 'build-info.json'),
        JSON.stringify(expectedBuild, null, 2) + '\n'
      )
    }
    if (
      JSON.stringify(built.manifest.permissions) !==
      JSON.stringify(installed.manifest.permissions)
    )
      console.warn(
        'try: permissions changed; the browser may require re-enabling the extension.'
      )
    step('Stage complete build')
    await swapIn({ installDir, stagingDir, candidate })
    summary.staged = true
    summary.loaded = null // A lost/refused reload response cannot prove what is running.
    step('Reload configured extension')
    await client.call('browser_extension', {
      action: 'reload',
      id: extensionId,
    })
    const { loaded, errors } = await registered()
    if (!loaded?.enabled) fail('The reloaded extension is not enabled.', 3)
    summary.loaded = true
    if (loaded.version !== built.manifest.version)
      fail(
        'The reloaded extension version does not match the staged candidate.',
        3
      )
    if (Object.keys(errors).length)
      fail(
        `Reload reports ${Object.keys(errors).length} error group(s); inspect browser extension logs.`,
        3
      )
    const after = await inspect('Library after')
    if (
      expectedBuild &&
      ['commit', 'dirty', 'builtAt', 'worktree'].some(
        (key) => after.build?.[key] !== expectedBuild[key]
      )
    )
      fail(
        'The running build stamp does not match the staged candidate; inspect the configured target.',
        3
      )
    const changed = Object.keys({ ...before.counts, ...after.counts }).filter(
      (key) => before.counts[key] !== after.counts[key]
    )
    if (changed.length)
      fail(
        `Library counts changed after reload: ${changed.join(', ')}. Do not retry; inspect first.`,
        4
      )
    if (before.ownerTabs)
      await client.call('browser_tabs', {
        action: 'new',
        url: `chrome-extension://${extensionId}/library.html`,
      })
    summary.verified = true
    step(`Done: ${extensionId} ${loaded.version}; library counts unchanged.`)
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    try {
      if (leased) await client.call('browser_lease', { action: 'release' })
    } catch (error) {
      if (!primaryError) throw error
      console.error(`try: lease release failed: ${error.message}`)
    } finally {
      client.stop()
    }
  }
}

try {
  await main()
} catch (error) {
  console.error(`try: ${error.message}`)
  summary.reason = 'failed'
  process.exitCode = error.exitCode || 1
} finally {
  console.log(JSON.stringify({ localTrial: summary }))
}
