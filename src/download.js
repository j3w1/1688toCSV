import { filenameFor, toCsv } from './csv.js'

export function waitForDownload(downloads, id, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer)
      downloads.onChanged.removeListener(onChanged)
      error ? reject(error) : resolve()
    }
    const check = (state, error) => {
      if (state === 'complete') finish()
      else if (state === 'interrupted')
        finish(
          new Error(
            `Download interrupted${error ? `: ${error}` : ''}. Try again.`
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

export async function downloadOrder(downloads, order) {
  const filename = filenameFor(order)
  const url = `data:text/csv;charset=utf-8,${encodeURIComponent(toCsv(order.dataRows))}`
  const id = await downloads.download({
    url,
    filename,
    conflictAction: 'uniquify',
    saveAs: false,
  })
  await waitForDownload(downloads, id)
  // Chrome may add a suffix when the same order has already been exported.
  const [saved] = await downloads.search({ id })
  return saved?.filename?.split(/[/\\]/).at(-1) || filename
}
