import { filenameFor, toCsv } from './csv.js'

export function waitForDownload(downloads, id, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      downloads.onChanged.removeListener(onChanged)
      error ? reject(error) : resolve()
    }
    const check = (state, error) => {
      if (state === 'complete') finish()
      else if (state === 'interrupted')
        finish(
          new Error(
            error === 'USER_CANCELED'
              ? 'The browser canceled the download. No save was confirmed.'
              : `Download interrupted${error ? `: ${error}` : ''}. Try again.`
          )
        )
    }
    const onChanged = (change) => {
      if (change.id === id) check(change.state?.current, change.error?.current)
    }
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            'Download is still pending. Check your browser downloads before retrying.'
          )
        ),
      timeoutMs
    )
    downloads.onChanged.addListener(onChanged)
    // Covers a small download that completed before the listener was attached.
    downloads.search({ id }).then(([item]) => {
      if (!item) finish(new Error('The browser could not find this download.'))
      else check(item.state, item.error)
    }, finish)
  })
}

export function prepareCsv(order) {
  return { filename: filenameFor(order), csv: toCsv(order.dataRows) }
}

export async function downloadOrder(downloads, file) {
  const { filename, csv } = file
  const url = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
  let id
  try {
    id = await downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: false,
    })
  } catch (cause) {
    // Start-error strings are browser-specific; do not infer a user action from them.
    throw new Error(
      'The browser could not start the download. Check your downloads before trying Save CSV another way.',
      { cause }
    )
  }
  await waitForDownload(downloads, id)
  // Chrome may add a suffix when the same order has already been exported.
  const [saved] = await downloads.search({ id })
  return saved?.filename?.split(/[/\\]/).at(-1) || filename
}
