import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readTrialConfiguration,
  trialArguments,
  within,
} from '../scripts/try-config.mjs'
import { createTrialBrowser } from '../scripts/try-browser.mjs'

const source = fileURLToPath(new URL('../', import.meta.url))
async function fixture(
  t,
  { mode = 'normal', installedKey = 'synthetic-public-key' } = {}
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-local-trial-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = path.join(directory, 'project')
  await mkdir(path.join(root, 'scripts'), { recursive: true })
  for (const name of [
    'try.mjs',
    'try-config.mjs',
    'try-browser.mjs',
    'try-staging.mjs',
  ])
    await cp(
      path.join(source, 'scripts', name),
      path.join(root, 'scripts', name)
    )
  const manifest = {
    name: 'Synthetic Widgets',
    version: '2.0.0',
    key: 'synthetic-public-key',
    permissions: [],
  }
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'synthetic-widgets',
      type: 'module',
      localTrial: {
        databaseName: 'synthetic-library',
        buildDir: 'packed',
        legacyConfigNames: ['synthetic-old'],
      },
      scripts: {
        test: 'node step.mjs test',
        'build:dev': 'node step.mjs build',
      },
    })
  )
  await writeFile(
    path.join(root, 'step.mjs'),
    `import {appendFile,mkdir,copyFile} from 'node:fs/promises';
    const step=process.argv[2];await appendFile('steps.log',step+'\\n');
    if(step==='build'){await mkdir('packed',{recursive:true});await copyFile('manifest.json','packed/manifest.json')}`
  )
  const installDir = path.join(directory, 'registered-release')
  await mkdir(installDir)
  await writeFile(
    path.join(installDir, 'manifest.json'),
    JSON.stringify({ ...manifest, version: '1.0.0', key: installedKey })
  )
  const configPath = path.join(directory, 'target.json')
  const config = {
    installDir,
    stagingDir: path.join(directory, 'stage'),
    extensionId: 'a'.repeat(32),
    log: path.join(directory, 'browser.log'),
    browserMcp: [
      process.execPath,
      path.join(source, 'tests/fixtures/trial-browser.mjs'),
      configPath,
      mode,
    ],
  }
  await writeFile(configPath, JSON.stringify(config))
  const configRoot = path.join(directory, 'config')
  const env = { ...process.env, XDG_CONFIG_HOME: configRoot }
  delete env.LOCAL_TRIAL_CONFIG
  const run = (...args) =>
    spawnSync(process.execPath, ['scripts/try.mjs', ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 15_000,
    })
  return {
    directory,
    root,
    installDir,
    config,
    configPath,
    configRoot,
    env,
    run,
  }
}
const summary = (result) =>
  JSON.parse(result.stdout.trim().split('\n').at(-1)).localTrial
const installed = async (f) =>
  JSON.parse(await readFile(path.join(f.installDir, 'manifest.json'), 'utf8'))
const browserLog = async (f) =>
  (await readFile(f.config.log, 'utf8')).trim().split('\n').map(JSON.parse)

test('missing local target still tests and builds, reports loaded false and succeeds for another repository', async (t) => {
  const f = await fixture(t)
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /no local trial target: nothing loaded/)
  assert.deepEqual(summary(result), {
    loaded: false,
    staged: false,
    verified: false,
    reason: 'no-local-trial-target',
  })
  assert.equal(
    await readFile(path.join(f.root, 'steps.log'), 'utf8'),
    'test\nbuild\n'
  )
  assert.equal((await installed(f)).version, '1.0.0')
  await assert.rejects(readFile(f.config.log), { code: 'ENOENT' })
})

test('dry-run builds without reading even an invalid explicit target', async (t) => {
  const f = await fixture(t)
  await writeFile(f.configPath, '{invalid')
  const result = f.run('--dry-run', '--config', f.configPath)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(summary(result).reason, 'dry-run')
  assert.equal(
    await readFile(path.join(f.root, 'steps.log'), 'utf8'),
    'test\nbuild\n'
  )
  await assert.rejects(readFile(f.config.log), { code: 'ENOENT' })
})

test('explicit config wins over environment and defaults, legacy fallback is identified', async (t) => {
  const f = await fixture(t)
  const preferred = path.join(f.configRoot, 'synthetic-widgets', 'try.json')
  const legacy = path.join(f.configRoot, 'synthetic-old', 'try.json')
  await mkdir(path.dirname(legacy), { recursive: true })
  await writeFile(legacy, JSON.stringify({ marker: 'legacy' }))
  let result = await readTrialConfiguration(f.root, { env: f.env })
  assert.equal(result.config.marker, 'legacy')
  assert.equal(result.legacy, true)
  await mkdir(path.dirname(preferred), { recursive: true })
  await writeFile(preferred, JSON.stringify({ marker: 'preferred' }))
  result = await readTrialConfiguration(f.root, { env: f.env })
  assert.equal(result.config.marker, 'preferred')
  assert.equal(result.legacy, false)
  const env = { ...f.env, LOCAL_TRIAL_CONFIG: legacy }
  assert.equal(
    (await readTrialConfiguration(f.root, { env })).config.marker,
    'legacy'
  )
  assert.equal(
    (await readTrialConfiguration(f.root, { env, configPath: preferred }))
      .config.marker,
    'preferred'
  )
  assert.equal(
    (
      await readTrialConfiguration(f.root, {
        env,
        configPath: path.join(f.directory, 'missing.json'),
      })
    ).config,
    null
  )
})

test('configured target loads a differently named extension/folder, keeps rollback and checks every store', async (t) => {
  const f = await fixture(t)
  const result = f.run('--config', f.configPath)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(summary(result), {
    loaded: true,
    staged: true,
    verified: true,
  })
  assert.equal((await installed(f)).version, '2.0.0')
  const previous = JSON.parse(
    await readFile(
      path.join(f.config.stagingDir, 'previous/manifest.json'),
      'utf8'
    )
  )
  assert.equal(previous.version, '1.0.0')
  const calls = await browserLog(f)
  assert.equal(calls[0].name, 'browser_guide')
  assert.equal(
    calls.filter(({ name }) => name === 'browser_evaluate').length,
    2
  )
  assert.equal(calls.at(-1).name, 'browser_lease')
  assert.equal(calls.at(-1).args.action, 'release')
  const rollback = f.run('--rollback', '--config', f.configPath)
  assert.equal(rollback.status, 0, rollback.stderr)
  assert.equal((await installed(f)).version, '1.0.0')
  assert.equal(summary(rollback).verified, true)
})

for (const [mode, message] of [
  ['wrong-id', /not registered/],
  ['disabled', /already be enabled/],
  ['running', /import is running/],
  ['missing-db', /library_missing/],
])
  test(`${mode} refuses before swapping a configured target`, async (t) => {
    const f = await fixture(t, { mode })
    const result = f.run('--quick', '--config', f.configPath)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, message)
    assert.equal(summary(result).staged, false)
    assert.equal((await installed(f)).version, '1.0.0')
    assert.equal(
      (await browserLog(f)).some(({ args }) => args.action === 'reload'),
      false
    )
  })

test('a changed manifest key is refused before swapping and does not inspect a library', async (t) => {
  const f = await fixture(t, { installedKey: 'different-synthetic-public-key' })
  const result = f.run('--quick', '--config', f.configPath)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /manifest key differs/)
  assert.equal(summary(result).staged, false)
  assert.equal(
    (await browserLog(f)).some(({ name }) => name === 'browser_evaluate'),
    false
  )
})

test('changed counts stop after reload with rollback retained, without claiming verification', async (t) => {
  const f = await fixture(t, { mode: 'changed-counts' })
  const result = f.run('--quick', '--config', f.configPath)
  assert.equal(result.status, 4, result.stderr)
  assert.match(result.stderr, /counts changed.*orders/)
  assert.deepEqual(summary(result), {
    loaded: true,
    staged: true,
    verified: false,
    reason: 'failed',
  })
  assert.equal(
    JSON.parse(
      await readFile(
        path.join(f.config.stagingDir, 'previous/manifest.json'),
        'utf8'
      )
    ).version,
    '1.0.0'
  )
})

test('reload denial is reported without rerouting or claiming a known loaded build', async (t) => {
  const f = await fixture(t, { mode: 'denied' })
  const result = f.run('--quick', '--config', f.configPath)
  assert.equal(result.status, 2, result.stderr)
  assert.match(result.stderr, /policy_denied/)
  assert.deepEqual(summary(result), {
    loaded: null,
    staged: true,
    verified: false,
    reason: 'failed',
  })
  assert.equal(
    (await browserLog(f)).filter(({ args }) => args.action === 'reload').length,
    1
  )
})

test('same-version reload with a different running build stamp cannot pass verification', async (t) => {
  const f = await fixture(t, { mode: 'stale-build' })
  const result = f.run('--quick', '--config', f.configPath)
  assert.equal(result.status, 3, result.stderr)
  assert.match(result.stderr, /running build stamp does not match/)
  assert.equal(summary(result).loaded, true)
  assert.equal(summary(result).verified, false)
})

test('a dead MCP command rejects rather than hanging its pending initialization', async (t) => {
  const f = await fixture(t, { mode: 'exit' })
  const client = createTrialBrowser(f.config.browserMcp)
  t.after(() => client.stop())
  await assert.rejects(client.start('synthetic'), /exited/)
})

test('path boundaries distinguish siblings and options reject accidental loading typos', () => {
  assert.equal(
    within(
      path.resolve('/synthetic/project'),
      path.resolve('/synthetic/project-sibling')
    ),
    false
  )
  assert.equal(
    within(
      path.resolve('/synthetic/project'),
      path.resolve('/synthetic/project/build')
    ),
    true
  )
  assert.throws(() => trialArguments(['--quik']), /Unknown option/)
  assert.throws(() => trialArguments(['--config']), /needs a file/)
  assert.throws(() => trialArguments(['--rollback', '--dry-run']), /either/)
})
