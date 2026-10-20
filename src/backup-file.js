import { yieldUI } from './ui.js'

const ARCHIVE_FORMAT = '1688-order-library-archive'
const imageData = /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/
const invalidArchive = () =>
  new Error('The backup image archive is incomplete or invalid.')

/** Keep the database backup schema intact while storing repeated image strings once. */
export async function packBackup(backup) {
  const assets = [],
    indexes = new Map()
  let deadline = performance.now() + 40,
    visited = 0
  async function visit(value, path) {
    if (++visited % 256 === 0 && performance.now() >= deadline) {
      await yieldUI()
      deadline = performance.now() + 40
    }
    if (typeof value === 'string' && imageData.test(value)) {
      let index = indexes.get(value)
      if (index === undefined) {
        index = assets.length
        indexes.set(value, index)
        assets.push({ dataUrl: value, paths: [] })
      }
      assets[index].paths.push(path)
      return null
    }
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) {
      const result = []
      for (let i = 0; i < value.length; i++)
        result.push(await visit(value[i], [...path, i]))
      return result
    }
    const result = Object.create(null)
    for (const [key, child] of Object.entries(value))
      result[key] = await visit(child, [...path, key])
    return result
  }
  const data = await visit(backup, [])
  return { format: ARCHIVE_FORMAT, version: 1, backup: data, assets }
}

/** Validate all reference locations before expanding any of the archived images. */
export async function unpackBackup(input) {
  if (input?.format !== ARCHIVE_FORMAT) return input
  if (
    input.version !== 1 ||
    !input.backup ||
    typeof input.backup !== 'object' ||
    !Array.isArray(input.assets)
  )
    throw invalidArchive()
  const assignments = [],
    seen = new Set()
  let deadline = performance.now() + 40
  for (const asset of input.assets) {
    if (
      !asset ||
      typeof asset.dataUrl !== 'string' ||
      !imageData.test(asset.dataUrl) ||
      !Array.isArray(asset.paths) ||
      !asset.paths.length
    )
      throw invalidArchive()
    for (const path of asset.paths) {
      if (!Array.isArray(path) || !path.length) throw invalidArchive()
      let target = input.backup
      for (let index = 0; index < path.length; index++) {
        const key = path[index]
        if (
          !target ||
          typeof target !== 'object' ||
          (Array.isArray(target)
            ? !Number.isSafeInteger(key) || key < 0
            : typeof key !== 'string') ||
          !Object.hasOwn(target, key)
        )
          throw invalidArchive()
        if (index === path.length - 1) {
          const signature = JSON.stringify(path)
          if (target[key] !== null || seen.has(signature))
            throw invalidArchive()
          seen.add(signature)
          assignments.push({ target, key, value: asset.dataUrl })
        } else target = target[key]
      }
    }
    if (performance.now() >= deadline) {
      await yieldUI()
      deadline = performance.now() + 40
    }
  }
  for (const { target, key, value } of assignments) target[key] = value
  return input.backup
}

/** Encode one asset at a time, without constructing the expanded backup as a JSON string. */
export async function createBackupBlob(backup) {
  const archive = await packBackup(backup)
  const pieces = [
    `{"format":${JSON.stringify(ARCHIVE_FORMAT)},"version":1,"backup":`,
    JSON.stringify(archive.backup),
    ',"assets":[',
  ]
  let deadline = performance.now() + 40
  for (const [index, asset] of archive.assets.entries()) {
    if (index) pieces.push(',')
    pieces.push(JSON.stringify(asset))
    if (performance.now() >= deadline) {
      await yieldUI()
      deadline = performance.now() + 40
    }
  }
  pieces.push(']}')
  const json = new Blob(pieces, { type: 'application/json' })
  const compressed = await new Response(
    json.stream().pipeThrough(new CompressionStream('gzip'))
  ).blob()
  return compressed.slice(0, compressed.size, 'application/gzip')
}

/** Sniff compression rather than trusting a renamed file; legacy raw JSON remains valid. */
export async function readBackupFile(file) {
  const header = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  let source = file.stream()
  if (header[0] === 0x1f && header[1] === 0x8b) {
    try {
      source = source.pipeThrough(new DecompressionStream('gzip'))
      return await unpackBackup(JSON.parse(await new Response(source).text()))
    } catch (error) {
      if (error.message === invalidArchive().message) throw error
      throw new Error('The compressed backup is damaged or incomplete.')
    }
  }
  return unpackBackup(JSON.parse(await file.text()))
}

export async function downloadBackup(backup, stem) {
  const blob = await createBackupBlob(backup)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${stem}.json.gz`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
