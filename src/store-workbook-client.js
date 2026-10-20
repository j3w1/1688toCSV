/** One disposable worker per file. No workbook bytes leave the browser. */
export async function readStoreWorkbookAsync(
  buffer,
  { filename, signal } = {}
) {
  const worker = new Worker('store-workbook-worker.js')
  try {
    return await new Promise((resolve, reject) => {
      const cancel = () =>
        reject(new DOMException('Import cancelled', 'AbortError'))
      if (signal?.aborted) return cancel()
      signal?.addEventListener('abort', cancel, { once: true })
      const finish = (action, result) => {
        signal?.removeEventListener('abort', cancel)
        action(result)
      }
      worker.addEventListener(
        'message',
        ({ data }) => {
          if (data.error) finish(reject, new Error(data.error))
          else finish(resolve, data.workbook)
        },
        { once: true }
      )
      worker.addEventListener(
        'error',
        () => finish(reject, new Error('Spreadsheet could not be read.')),
        { once: true }
      )
      worker.postMessage({ buffer, filename }, [buffer])
    })
  } finally {
    worker.terminate()
  }
}
