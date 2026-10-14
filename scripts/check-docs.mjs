import { existsSync, readFileSync, readdirSync } from 'node:fs'
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const scripts = packageJson.scripts ?? {}
const excluded = new Set([
  '.git',
  'node_modules',
  'dist',
  'work',
  'test-results',
  'playwright-report',
])
const problems = []

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory())
      return excluded.has(entry.name) ? [] : markdownFiles(path)
    return entry.isFile() && extname(entry.name).toLowerCase() === '.md'
      ? [path]
      : []
  })
}

function validateTarget(document, rawTarget) {
  const target = rawTarget.replace(/^<|>$/g, '')
  if (
    !target ||
    target.startsWith('#') ||
    /^[a-z][a-z\d+.-]*:/i.test(target) ||
    target.startsWith('//')
  )
    return
  let path
  try {
    path = decodeURIComponent(target.split(/[?#]/, 1)[0]).replace(
      /\\([() ])/g,
      '$1'
    )
  } catch {
    problems.push(
      `${relative(root, document)}: invalid link encoding: ${target}`
    )
    return
  }
  const absolute = resolve(dirname(document), path)
  const fromRoot = relative(root, absolute)
  if (
    isAbsolute(path) ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    problems.push(
      `${relative(root, document)}: local link must stay inside the repository: ${target}`
    )
  } else if (!existsSync(absolute)) {
    problems.push(
      `${relative(root, document)}: missing local link target: ${target}`
    )
  }
}

const documents = markdownFiles(root)
for (const document of documents) {
  const text = readFileSync(document, 'utf8')
  const rendered = text.replace(
    /^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm,
    ''
  )
  for (const match of rendered.matchAll(
    /!?\[(?:\\.|[^\]\\])*\]\(\s*(<[^>]*>|(?:\\.|[^\s)])+)(?:\s+["'][^"']*["'])?\s*\)/g
  )) {
    validateTarget(document, match[1])
  }
  for (const match of rendered.matchAll(
    /^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/gm
  )) {
    validateTarget(document, match[1])
  }
  // GitHub-compatible HTML lets screenshots specify a readable display width.
  // Validate both their image source and optional full-size link target.
  for (const tag of rendered.matchAll(/<(img|a)\b[^>]*>/gi)) {
    const attribute = tag[1].toLowerCase() === 'img' ? 'src' : 'href'
    const target = tag[0].match(
      new RegExp(
        `\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\x60]+))`,
        'i'
      )
    )
    if (target) validateTarget(document, target[1] ?? target[2] ?? target[3])
  }
  for (const match of text.matchAll(/\bnpm\s+run\s+([\w:.-]+)/g)) {
    if (!Object.hasOwn(scripts, match[1]))
      problems.push(
        `${relative(root, document)}: unknown package script: ${match[1]}`
      )
  }
  for (const match of text.matchAll(/\bnpm\s+(test|start|stop|restart)\b/g)) {
    if (!Object.hasOwn(scripts, match[1]))
      problems.push(
        `${relative(root, document)}: unknown package script: ${match[1]}`
      )
  }
}

for (const [name, command] of Object.entries(scripts)) {
  if (
    /(?:^|:)watch(?:$|:)/i.test(name) ||
    /(?:^|\s)--watch(?:\s|=|$)/.test(command)
  ) {
    problems.push(
      `package.json: ${name} enables watch mode; builds must be explicit`
    )
  }
}

for (const filename of ['order-library.png', 'order-library-dark.png']) {
  const path = join(root, 'screenshots', filename)
  if (!existsSync(path)) {
    problems.push(`Missing required screenshot: screenshots/${filename}`)
    continue
  }
  const bytes = readFileSync(path)
  if (
    bytes.length < 24 ||
    !bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.readUInt32BE(16) === 0 ||
    bytes.readUInt32BE(20) === 0
  ) {
    problems.push(`Invalid PNG screenshot: screenshots/${filename}`)
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exitCode = 1
} else {
  console.log(
    `Documentation checks passed (${documents.length} Markdown files, 2 required screenshots).`
  )
}
