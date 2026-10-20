import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  checkIdentity,
  readIdentity,
  recoverStaging,
  stagingPaths,
  swapIn,
} from '../scripts/try-staging.mjs'

async function build(directory, version, extra = {}) {
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, 'manifest.json'),
    JSON.stringify({ name: '1688toCSV', version, ...extra })
  )
}
const version = async (directory) =>
  JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
    .version
const missing = async (target) =>
  stat(target).then(
    () => false,
    () => true
  )

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'try-staging-'))
  const installDir = path.join(root, 'install', 'dist')
  const stagingDir = path.join(root, 'staging')
  await build(installDir, 'old')
  await mkdir(stagingDir)
  return { root, installDir, stagingDir }
}

test('a swap installs the candidate and keeps the replaced build for rollback', async (t) => {
  const { root, installDir, stagingDir } = await setup()
  t.after(() => rm(root, { recursive: true, force: true }))
  const candidate = path.join(stagingDir, 'build-1')
  await build(candidate, 'new')
  await swapIn({ installDir, stagingDir, candidate, label: 1 })
  assert.equal(await version(installDir), 'new')
  assert.equal(await version(stagingPaths(stagingDir).previous), 'old')
  assert.ok(await missing(stagingPaths(stagingDir).journal))
  // Rollback swaps the two folders back.
  await swapIn({
    installDir,
    stagingDir,
    candidate: stagingPaths(stagingDir).previous,
    label: 2,
  })
  assert.equal(await version(installDir), 'old')
  assert.equal(await version(stagingPaths(stagingDir).previous), 'new')
})

test('an interruption after moving the install out restores it before anything reads it', async (t) => {
  const { root, installDir, stagingDir } = await setup()
  t.after(() => rm(root, { recursive: true, force: true }))
  const candidate = path.join(stagingDir, 'build-1')
  const swap = path.join(stagingDir, 'swap-1')
  await build(candidate, 'new')
  await writeFile(
    stagingPaths(stagingDir).journal,
    JSON.stringify({ swap, candidate })
  )
  await rename(installDir, swap)
  assert.equal(await recoverStaging({ installDir, stagingDir }), 'restored')
  assert.equal(await version(installDir), 'old')
  assert.ok(await missing(candidate))
  assert.ok(await missing(stagingPaths(stagingDir).journal))
})

test('an interruption after installing the candidate completes the rollback copy', async (t) => {
  const { root, installDir, stagingDir } = await setup()
  t.after(() => rm(root, { recursive: true, force: true }))
  await build(stagingPaths(stagingDir).previous, 'older')
  const candidate = path.join(stagingDir, 'build-1')
  const swap = path.join(stagingDir, 'swap-1')
  await build(candidate, 'new')
  await writeFile(
    stagingPaths(stagingDir).journal,
    JSON.stringify({ swap, candidate })
  )
  await rename(installDir, swap)
  await rename(candidate, installDir)
  assert.equal(await recoverStaging({ installDir, stagingDir }), 'completed')
  assert.equal(await version(installDir), 'new')
  assert.equal(await version(stagingPaths(stagingDir).previous), 'old')
  assert.equal(await recoverStaging({ installDir, stagingDir }), 'none')
})

test('a missing install without a journal copy refuses instead of guessing', async (t) => {
  const { root, installDir, stagingDir } = await setup()
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(
    stagingPaths(stagingDir).journal,
    JSON.stringify({ swap: path.join(stagingDir, 'gone') })
  )
  await rm(installDir, { recursive: true })
  await assert.rejects(recoverStaging({ installDir, stagingDir }), /missing/)
})

test('identity checks refuse another extension or a changed key, also for rollback', async (t) => {
  const { root, installDir, stagingDir } = await setup()
  t.after(() => rm(root, { recursive: true, force: true }))
  const installed = await readIdentity(installDir)
  const keyed = path.join(stagingDir, 'previous')
  await build(keyed, 'stale', { key: 'ABC' })
  const other = path.join(stagingDir, 'other')
  await build(other, 'x')
  await writeFile(
    path.join(other, 'manifest.json'),
    JSON.stringify({ name: 'Other', version: 'x' })
  )
  assert.throws(
    () => checkIdentity(installedOf(other), installed),
    /not the 1688toCSV/
  )
  assert.throws(
    () => checkIdentity(installedOf(keyed), installed),
    /could change the extension id/
  )
  assert.doesNotThrow(() =>
    checkIdentity({ name: '1688toCSV', key: null }, installed)
  )
  function installedOf(directory) {
    return directory === other
      ? { name: 'Other', key: null }
      : { name: '1688toCSV', key: 'ABC' }
  }
  // readIdentity reports the key that a stale rollback copy would carry.
  assert.equal((await readIdentity(keyed)).key, 'ABC')
})
