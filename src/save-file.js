// Offline downloads through a Blob URL and a temporary anchor: no downloads
// permission and no external service. Browsers save to their download folder.

const SAVED_NAMES_KEY = '1688-saved-file-names'

/**
 * The name to save under: the predictable name the first time, then -2, -3…
 * so a repeated export never collides (browsers would otherwise rename it
 * silently and summaries would point at the earlier file).
 */
export function uniqueFileName(filename, storage = safeStorage()) {
  let used = []
  try {
    used = JSON.parse(storage?.getItem(SAVED_NAMES_KEY) || '[]')
    if (!Array.isArray(used)) used = []
  } catch {}
  const dot = filename.lastIndexOf('.')
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  const extension = dot > 0 ? filename.slice(dot) : ''
  let name = filename
  for (let copy = 2; used.includes(name); copy++)
    name = `${stem}-${copy}${extension}`
  try {
    storage?.setItem(
      SAVED_NAMES_KEY,
      JSON.stringify([...used, name].slice(-1000))
    )
  } catch {}
  return name
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** Save `blob` as `filename`; returns the name used. */
export function saveFile(blob, filename, doc = document) {
  const url = URL.createObjectURL(blob)
  const anchor = doc.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.hidden = true
  doc.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  return filename
}

/** Tell the workspace an export finished, for its readable status line. */
export function announceExport(files, doc = document) {
  doc.dispatchEvent(
    new CustomEvent('workspace-export', {
      detail: { files: [...files], at: new Date().toISOString() },
    })
  )
}
