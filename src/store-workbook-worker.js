import { readStoreWorkbook } from './store-workbook-reader.js'

// Parsing and embedded-image extraction stay off the workspace's main thread.
self.addEventListener('message', async ({ data }) => {
  try {
    const workbook = await readStoreWorkbook(data.buffer, {
      filename: data.filename,
      reportEvidence: data.reportEvidence === true,
      limits: data.limits,
    })
    self.postMessage({ workbook })
  } catch (error) {
    self.postMessage({
      error: error.message || 'Spreadsheet could not be read.',
    })
  }
})
