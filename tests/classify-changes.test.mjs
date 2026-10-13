import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import {
  changedPathsForEvent,
  classifyEvent,
  classifyPaths,
  parseNameStatus,
} from '../scripts/classify-changes.mjs'

test('recognized documentation routes to lightweight checks', () => {
  assert.deepEqual(
    classifyPaths([
      'README.md',
      'CHROMEWEBSTORE.md',
      'docs/development.md',
      'screenshots/popup.png',
      'README.md',
    ]),
    { category: 'docs', docs: true, code: false, count: 4 }
  )
})

test('source, workflow, fixture, and unknown paths always require code checks', () => {
  for (const path of [
    'src/popup.js',
    '.github/workflows/ci.yml',
    'tests/fixtures/order.html',
    'docs/script.js',
    'mystery.md',
    'package-lock.json',
  ]) {
    assert.equal(classifyPaths([path]).category, 'code', path)
  }
  assert.deepEqual(classifyPaths([]), {
    category: 'code',
    docs: false,
    code: true,
    count: 0,
  })
})

test('mixed changes request both routes', () => {
  assert.deepEqual(classifyPaths(['README.md', 'src/popup.js']), {
    category: 'mixed',
    docs: true,
    code: true,
    count: 2,
  })
})

test('rename and delete parsing preserves old paths and spaces', () => {
  const paths = parseNameStatus(
    'R100\0src/export.js\0docs/export.md\0D\0old code.js\0M\0README.md\0'
  )
  assert.deepEqual(paths, [
    'src/export.js',
    'docs/export.md',
    'old code.js',
    'README.md',
  ])
  assert.equal(classifyPaths(paths).category, 'mixed')
  assert.throws(() => parseNameStatus('R100\0README.md\0'), /Incomplete/)
  assert.throws(() => parseNameStatus('unexpected\0README.md\0'), /Unexpected/)
})

test('manual runs and unavailable comparisons require all checks', () => {
  for (const [eventName, event] of [
    ['workflow_dispatch', {}],
    ['push', {}],
    ['pull_request', {}],
    ['unknown', {}],
  ]) {
    const route = classifyEvent('.', eventName, event)
    assert.equal(route.docs, true)
    assert.equal(route.code, true)
  }
})

test('git comparisons cover initial push, rename, deletion, and PR merge base', () => {
  const cwd = mkdtempSync(join(tmpdir(), '1688tocsv-routing-'))
  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'CI Test',
        GIT_AUTHOR_EMAIL: 'ci@example.invalid',
        GIT_COMMITTER_NAME: 'CI Test',
        GIT_COMMITTER_EMAIL: 'ci@example.invalid',
      },
    }).trim()
  const commit = (message) => {
    git('add', '-A')
    git('commit', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  try {
    git('init', '-b', 'main')
    writeFileSync(join(cwd, 'README.md'), '# Fixture\n')
    writeFileSync(join(cwd, 'export.js'), 'export const value = 1;\n')
    const initial = commit('initial')
    assert.deepEqual(
      changedPathsForEvent(cwd, 'push', {
        before: '0'.repeat(40),
        after: initial,
      }).sort(),
      ['README.md', 'export.js']
    )

    git('checkout', '-b', 'docs')
    writeFileSync(join(cwd, 'README.md'), '# Updated fixture\n')
    const docs = commit('docs')
    assert.equal(
      classifyEvent(cwd, 'push', { before: initial, after: docs }).category,
      'docs'
    )

    git('checkout', 'main')
    writeFileSync(join(cwd, 'other.js'), 'export const unrelated = true;\n')
    const base = commit('unrelated base update')
    const pr = { pull_request: { base: { sha: base }, head: { sha: docs } } }
    assert.deepEqual(changedPathsForEvent(cwd, 'pull_request', pr), [
      'README.md',
    ])

    git('checkout', 'docs')
    mkdirSync(join(cwd, 'docs'))
    renameSync(join(cwd, 'export.js'), join(cwd, 'docs', 'export.md'))
    const renamed = commit('rename code to docs')
    assert.equal(
      classifyEvent(cwd, 'push', { before: docs, after: renamed }).category,
      'mixed'
    )
    rmSync(join(cwd, 'docs', 'export.md'))
    const deleted = commit('delete docs')
    assert.deepEqual(
      changedPathsForEvent(cwd, 'push', { before: renamed, after: deleted }),
      ['docs/export.md']
    )
    assert.equal(
      classifyEvent(cwd, 'push', { before: 'f'.repeat(40), after: deleted })
        .code,
      true
    )
  } finally {
    assert.equal(
      dirname(resolve(cwd)),
      resolve(tmpdir()),
      'Only remove the temporary test repository'
    )
    rmSync(cwd, { recursive: true, force: true })
  }
})
