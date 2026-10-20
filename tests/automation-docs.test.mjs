import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

// Every action documented for automation agents exists in the source, and
// every stable data-action in the source is documented.
test('docs/automation.md and the source agree on data-action names', async () => {
  const docs = await readFile(
    new URL('../docs/automation.md', import.meta.url),
    'utf8'
  )
  const documented = new Set(
    [...docs.matchAll(/^\| `([a-z-]+)`\s+\|/gm)]
      .map((match) => match[1])
      .filter(
        (name) =>
          ![
            'data-action',
            'data-status',
            'importing',
            'needs-sign-in',
            'needs-visible-tab',
            'export-finished',
            'idle',
          ].includes(name)
      )
  )
  const directory = new URL('../src/', import.meta.url)
  let source = ''
  for (const file of await readdir(directory))
    if (/\.(js|html)$/.test(file))
      source += await readFile(new URL(file, directory), 'utf8')
  const inSource = new Set([
    ...[...source.matchAll(/data-action="([a-z-]+)"/g)].map(
      (match) => match[1]
    ),
    ...[...source.matchAll(/dataset\.action\s*=\s*'([a-z-]+)'/g)].map(
      (match) => match[1]
    ),
    // Dialog button helpers take the stable action as their second argument.
    ...[...source.matchAll(/\bbutton\(\s*'[^']*',\s*'([a-z-]+)'/g)].map(
      (match) => match[1]
    ),
    // Print menu buttons use their element id as the action.
    ...['print-labels', 'print-carton-marks'].filter((id) =>
      source.includes(`'${id}'`)
    ),
    // Review alternates are `review-${alternate.value}`.
    ...[...source.matchAll(/value: '([a-z-]+)'/g)].map(
      (match) => `review-${match[1]}`
    ),
    ...(source.includes(
      "kind === 'mark' ? 'print-carton-marks' : 'print-labels'"
    )
      ? ['print-labels', 'print-carton-marks']
      : []),
  ])
  for (const name of documented)
    assert.ok(inSource.has(name), `documented but missing in source: ${name}`)
  for (const name of [
    ...source.matchAll(/data-action="([a-z-]+)"/g),
    ...source.matchAll(/dataset\.action\s*=\s*'([a-z-]+)'/g),
    ...source.matchAll(/\bbutton\(\s*'[^']*',\s*'([a-z-]+)'/g),
  ].map((match) => match[1]))
    assert.ok(documented.has(name), `in source but not documented: ${name}`)
})
