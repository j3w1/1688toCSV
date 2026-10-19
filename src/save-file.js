// Offline downloads through a Blob URL and a temporary anchor: no downloads
// permission and no external service. Browsers save to their download folder.

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
