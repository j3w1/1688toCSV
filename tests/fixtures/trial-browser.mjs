// Synthetic MCP transport for local-trial tests. No browser or network access.
import { createInterface } from 'node:readline'
import { appendFile, readFile } from 'node:fs/promises'
import path from 'node:path'

const [configPath, mode = 'normal'] = process.argv.slice(2)
const config = JSON.parse(await readFile(configPath, 'utf8'))
let reloaded = false,
  inspection = '',
  guide = false
const reply = (id, value) =>
  process.stdout.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: typeof value === 'string' ? value : JSON.stringify(value),
          },
        ],
      },
    }) + '\n'
  )
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line)
  if (request.method === 'initialize') {
    if (mode === 'exit') process.exit(1)
    process.stdout.write(
      JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} }) + '\n'
    )
    continue
  }
  if (request.method !== 'tools/call') continue
  const { name, arguments: args } = request.params
  await appendFile(config.log, JSON.stringify({ name, args }) + '\n')
  if (name === 'browser_guide') {
    guide = true
    reply(request.id, 'Synthetic browser guide')
    continue
  }
  if (!guide) {
    reply(request.id, { refused: 'guide_required' })
    continue
  }
  if (name === 'browser_lease' || name === 'browser_snapshot') {
    reply(request.id, {})
    continue
  }
  if (name === 'browser_extension') {
    if (args.action === 'reload') {
      if (mode === 'denied') {
        reply(request.id, {
          refused: 'policy_denied',
          message: 'Synthetic reload denial',
        })
        continue
      }
      reloaded = true
      reply(request.id, {})
    } else {
      const manifest = JSON.parse(
        await readFile(path.join(config.installDir, 'manifest.json'), 'utf8')
      )
      reply(request.id, {
        registered: [
          {
            id: mode === 'wrong-id' ? 'b'.repeat(32) : config.extensionId,
            path: config.installDir,
          },
        ],
        extensions: [
          {
            id: config.extensionId,
            enabled: mode !== 'disabled',
            version: manifest.version,
          },
        ],
        errors: {},
      })
    }
    continue
  }
  if (name === 'browser_tabs') {
    if (args.action === 'new') inspection = args.url
    reply(
      request.id,
      args.action === 'list'
        ? `- 0: Trial (${inspection})\n${reloaded ? '' : `- 1: Workspace (chrome-extension://${config.extensionId}/library.html)`}`
        : {}
    )
    continue
  }
  if (name === 'browser_evaluate') {
    if (mode === 'missing-db') {
      reply(request.id, {
        refused: 'library_missing',
        message: 'Synthetic existing database missing',
      })
      continue
    }
    let build = null
    try {
      build = JSON.parse(
        await readFile(path.join(config.installDir, 'build-info.json'), 'utf8')
      )
    } catch {}
    if (reloaded && mode === 'stale-build')
      build = { ...build, commit: 'stale-synthetic-candidate' }
    reply(request.id, {
      counts: {
        orders: reloaded && mode === 'changed-counts' ? 3 : 2,
        images: 3,
        jobs: 0,
      },
      jobs: mode === 'running' ? ['running'] : [],
      build,
    })
    continue
  }
  reply(request.id, { refused: 'unsupported_tool' })
}
