import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Execute the actual required job's gate so a workflow edit cannot silently
// accept a failed, cancelled or skipped browser matrix on the code route.
const workflow = readFileSync(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8'
)
const gate = workflow.match(
  /node --input-type=module <<'NODE'\n([\s\S]*?)\n\s+NODE/
)?.[1]
assert.ok(gate, 'The required job must expose its executable pass rule')

function runGate(overrides = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', gate], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CLASSIFY_RESULT: 'success',
      DOCS_EXPECTED: 'true',
      CODE_EXPECTED: 'true',
      BROWSER_EXPECTED: 'true',
      DOCS_RESULT: 'success',
      CODE_RESULT: 'success',
      BROWSER_RESULT: 'success',
      ...overrides,
    },
  })
}

test('required accepts successful mixed, documentation-only and code-only routes', () => {
  for (const route of [
    {},
    {
      CODE_EXPECTED: 'false',
      BROWSER_EXPECTED: 'false',
      CODE_RESULT: 'skipped',
      BROWSER_RESULT: 'skipped',
    },
    { DOCS_EXPECTED: 'false', DOCS_RESULT: 'skipped' },
  ]) {
    const result = runGate(route)
    assert.equal(result.status, 0, result.stderr)
  }
})

test('required rejects unavailable routes and every unsuccessful routed check', () => {
  for (const result of ['failure', 'cancelled', 'skipped']) {
    for (const check of ['CLASSIFY', 'DOCS', 'CODE', 'BROWSER']) {
      const outcome = runGate({ [`${check}_RESULT`]: result })
      assert.notEqual(outcome.status, 0, `${check} ${result} was accepted`)
    }
  }
  for (const route of [
    { DOCS_EXPECTED: '', CODE_EXPECTED: '', BROWSER_EXPECTED: '' },
    {
      DOCS_EXPECTED: 'false',
      CODE_EXPECTED: 'false',
      BROWSER_EXPECTED: 'false',
    },
    { BROWSER_EXPECTED: '' },
    { CODE_EXPECTED: 'false', CODE_RESULT: 'success' },
    { DOCS_EXPECTED: 'false', DOCS_RESULT: 'success' },
  ])
    assert.notEqual(runGate(route).status, 0, JSON.stringify(route))
})
