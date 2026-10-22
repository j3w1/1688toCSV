import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

// Controller helpers have either (title, name, run) or
// (parent, title, name, run). Read their real parameter position and balanced
// calls so nested labels/callbacks cannot redirect the documented action.
function helperActions(source, helper = 'action') {
  const declaration = new RegExp(
    `(?:function\\s+${helper}\\s*|(?:const|let)\\s+${helper}\\s*=\\s*(?:async\\s*)?)\\(([^)]*)\\)`
  ).exec(source)
  if (!declaration) return []
  const parameters = declaration[1].split(',').map((part) => part.trim())
  const position = parameters.findIndex((name) =>
    ['name', 'actionName', 'action'].includes(name)
  )
  if (position < 0) return []
  // A similarly named icon helper may take an icon `name`. Only follow a
  // parameter that the controller actually assigns as a stable action.
  if (
    !new RegExp(`dataset\\.action\\s*=\\s*${parameters[position]}\\b`).test(
      source
    )
  )
    return []
  const names = []
  for (const match of source.matchAll(new RegExp(`\\b${helper}\\s*\\(`, 'g'))) {
    let start = match.index + match[0].length,
      depth = 1,
      quote = '',
      escaped = false
    const args = []
    for (let index = start; index < source.length; index++) {
      const char = source[index]
      if (quote) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === quote) quote = ''
        continue
      }
      if (char === "'" || char === '"' || char === '`') {
        quote = char
        continue
      }
      if ('([{'.includes(char)) depth++
      else if (')]}'.includes(char)) depth--
      if ((char === ',' && depth === 1) || depth === 0) {
        args.push(source.slice(start, index).trim())
        start = index + 1
      }
      if (!depth) break
    }
    const literal = /^(['"])([a-z-]+)\1$/.exec(args[position] || '')
    if (literal) names.push(literal[2])
  }
  return names
}

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
            'export-finished',
            'idle',
          ].includes(name)
      )
  )
  const directory = new URL('../src/', import.meta.url)
  let source = ''
  const controllerActions = []
  for (const file of await readdir(directory))
    if (/\.(js|html)$/.test(file)) {
      const text = await readFile(new URL(file, directory), 'utf8')
      source += text
      controllerActions.push(...helperActions(text))
      controllerActions.push(...helperActions(text, 'reviewDialog'))
      controllerActions.push(...helperActions(text, 'button'))
    }
  const inSource = new Set([
    ...controllerActions,
    ...[...source.matchAll(/data-action="([a-z-]+)"/g)].map(
      (match) => match[1]
    ),
    ...[...source.matchAll(/dataset\.action\s*=\s*'([a-z-]+)'/g)].map(
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
    ...controllerActions,
    ...[
      ...source.matchAll(/data-action="([a-z-]+)"/g),
      ...source.matchAll(/dataset\.action\s*=\s*'([a-z-]+)'/g),
    ].map((match) => match[1]),
  ])
    assert.ok(documented.has(name), `in source but not documented: ${name}`)
})
