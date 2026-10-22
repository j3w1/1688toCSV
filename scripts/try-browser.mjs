import { spawn } from 'node:child_process'

export function resultJson(text) {
  const match = /### Result\n([\s\S]*?)(\n###|$)/.exec(text)
  try {
    return JSON.parse(match ? match[1] : text)
  } catch {
    throw new Error('Browser returned an invalid structured response.')
  }
}

// Machine-provided MCP command; no installed browser, server path or ID assumed.
export function createTrialBrowser(command) {
  const child = spawn(command[0], command.slice(1), {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let buffer = '',
    next = 0,
    ended = false
  const waiting = new Map()
  function rejectAll(error) {
    for (const entry of waiting.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    waiting.clear()
  }
  child.on('error', () => {
    ended = true
    rejectAll(new Error('Could not start the configured browser MCP command.'))
  })
  child.on('exit', () => {
    ended = true
    rejectAll(
      new Error('Browser MCP command exited before completing its request.')
    )
  })
  // Never relay a server's stderr/page payload into verification logs.
  child.stderr.resume()
  child.stdin.on('error', () =>
    rejectAll(new Error('Browser MCP input closed.'))
  )
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    if (buffer.length > 8 * 1024 * 1024) {
      rejectAll(new Error('Browser MCP response exceeds the supported limit.'))
      child.kill()
      return
    }
    for (let end; (end = buffer.indexOf('\n')) >= 0; ) {
      const line = buffer.slice(0, end).trim()
      buffer = buffer.slice(end + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        rejectAll(
          new Error('Browser MCP command returned invalid protocol data.')
        )
        child.kill()
        return
      }
      const entry = waiting.get(message.id)
      if (!entry) continue
      clearTimeout(entry.timer)
      waiting.delete(message.id)
      entry.resolve(message)
    }
  })
  function request(method, params) {
    if (ended)
      return Promise.reject(
        new Error('Browser MCP command is no longer connected.')
      )
    return new Promise((resolve, reject) => {
      const id = ++next
      const timer = setTimeout(() => {
        waiting.delete(id)
        reject(new Error(`Browser MCP ${method} timed out.`))
      }, 70_000)
      waiting.set(id, { resolve, reject, timer })
      child.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
      )
    })
  }
  return {
    async start(name) {
      const response = await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: `${name}-try`, version: '1' },
      })
      if (response.error)
        throw new Error('Browser MCP initialization was refused.')
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }) + '\n'
      )
    },
    async call(name, input, { tolerate } = {}) {
      const message = await request('tools/call', { name, arguments: input })
      const text =
        (message.result?.content || [])
          .map((item) => item.text || '')
          .join('\n') ||
        (message.result?.structuredContent
          ? JSON.stringify(message.result.structuredContent)
          : '')
      if (tolerate && new RegExp(`"refused":\\s*"(${tolerate})"`).test(text))
        return null
      if (message.error || message.result?.isError || /"refused"/.test(text)) {
        let refusal = {}
        try {
          refusal = resultJson(text)
        } catch {}
        const error = new Error(
          refusal.refused
            ? `Browser ${name} refused (${refusal.refused}): ${String(refusal.message || '').slice(0, 200)}`
            : `Browser ${name} returned an unexpected response.`
        )
        error.exitCode = 2
        throw error
      }
      return text
    },
    stop() {
      child.kill()
      rejectAll(new Error('Browser MCP command stopped.'))
    },
  }
}

// Read-only, existing database only. A missing database's creation is aborted.
export function libraryInspector(databaseName) {
  return `async () => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open(${JSON.stringify(databaseName)})
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
      open.onupgradeneeded = () => { open.transaction.abort(); reject(new Error('library database missing; first installation is a separate step')) }
    })
    const names = [...db.objectStoreNames]
    const tx = db.transaction(names, 'readonly')
    const ask = (q) => new Promise((resolve, reject) => { q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error) })
    const counts = Object.create(null)
    for (const name of names) counts[name] = await ask(tx.objectStore(name).count())
    const jobs = names.includes('jobs') ? (await ask(tx.objectStore('jobs').getAll())).map((job) => job.state) : []
    db.close()
    let build = null
    try { build = await (await fetch('/build-info.json', { cache: 'no-store' })).json() } catch {}
    return { counts, jobs, build }
  }`
}
