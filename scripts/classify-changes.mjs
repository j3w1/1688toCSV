import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const rootDocuments = new Set([
  'README.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'LICENSE',
  'LICENSE.md',
])
const documentationAsset = /\.(?:md|png|jpe?g|gif|webp|svg)$/i

export function isDocumentationPath(path) {
  return (
    rootDocuments.has(path) ||
    ((path.startsWith('docs/') || path.startsWith('screenshots/')) &&
      documentationAsset.test(path))
  )
}

export function classifyPaths(paths) {
  const uniquePaths = [...new Set(paths)]
  const docs = uniquePaths.some(isDocumentationPath)
  // An empty or unknown change set must never skip code verification.
  const code =
    uniquePaths.length === 0 ||
    uniquePaths.some((path) => !isDocumentationPath(path))
  return {
    category: docs && code ? 'mixed' : docs ? 'docs' : 'code',
    docs,
    code,
    count: uniquePaths.length,
  }
}

export function parseNameStatus(output) {
  const fields = output.split('\0')
  if (fields.at(-1) === '') fields.pop()
  const paths = []
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++]
    if (!/^[ACDMRTUXB]\d*$/.test(status))
      throw new Error('Unexpected git change status')
    const pathCount = /^[RC]/.test(status) ? 2 : 1
    for (let count = 0; count < pathCount; count++) {
      const path = fields[index++]
      if (!path) throw new Error('Incomplete git changed-file list')
      paths.push(path)
    }
  }
  return paths
}

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function commitSha(value) {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{40,64}$/i.test(value) ||
    /^0+$/.test(value)
  ) {
    throw new Error('Missing or invalid commit SHA')
  }
  return value
}

export function changedPathsForEvent(cwd, eventName, event) {
  if (eventName === 'pull_request') {
    const base = commitSha(event.pull_request?.base?.sha)
    const head = commitSha(event.pull_request?.head?.sha)
    // Compare the PR's contribution, excluding unrelated changes on its base branch.
    const mergeBase = git(cwd, 'merge-base', base, head).trim()
    return parseNameStatus(
      git(
        cwd,
        'diff',
        '--name-status',
        '-z',
        '--find-renames',
        mergeBase,
        head,
        '--'
      )
    )
  }
  if (eventName === 'push') {
    const head = commitSha(event.after)
    if (typeof event.before === 'string' && /^0{40,64}$/.test(event.before)) {
      // A new branch has no before commit: inspect its complete tracked tree.
      return git(cwd, 'ls-tree', '-r', '--name-only', '-z', head)
        .split('\0')
        .filter(Boolean)
    }
    const base = commitSha(event.before)
    return parseNameStatus(
      git(
        cwd,
        'diff',
        '--name-status',
        '-z',
        '--find-renames',
        base,
        head,
        '--'
      )
    )
  }
  throw new Error('Event requires full verification')
}

export function classifyEvent(cwd, eventName, event) {
  if (eventName === 'workflow_dispatch') {
    return {
      category: 'mixed',
      docs: true,
      code: true,
      count: 0,
      reason: 'Manual full verification',
    }
  }
  try {
    return {
      ...classifyPaths(changedPathsForEvent(cwd, eventName, event)),
      reason: 'Complete git changed-file list',
    }
  } catch {
    // Missing history, unsupported events, or malformed input must run all checks.
    return {
      category: 'mixed',
      docs: true,
      code: true,
      count: 0,
      reason: 'Change set unavailable; full verification required',
    }
  }
}

function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const result = classifyEvent(
    process.cwd(),
    process.env.GITHUB_EVENT_NAME,
    event
  )
  const outputs = `category=${result.category}\ndocs=${result.docs}\ncode=${result.code}\n`
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, outputs)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Change routing\n\nCategory: **${result.category}** (${result.count} changed paths).\n\n` +
        `${result.reason}. Documentation checks: ${result.docs}. Code and browser checks: ${result.code}.\n`
    )
  }
  console.log(JSON.stringify(result))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main()
