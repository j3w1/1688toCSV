import { readStoreWorkbook } from './store-workbook-reader.js'
import {
  parsePackingReportCells,
  adaptPackingReportWorkbook,
} from './packing-report-cells.js'
import {
  analyzePackingReport,
  validatePackingReportReview,
} from './packing-report-model.js'
import { planPackingReportUpdate } from './packing-report-matches.js'

// A disposable worker is the cancellation boundary, including synchronous decoder phases.
self.addEventListener('message', async ({ data }) => {
  const { operation, input, generation } = data
  try {
    let result
    if (operation === 'parse') result = parsePackingReportCells(input)
    else if (operation === 'workbook') {
      const workbook = await readStoreWorkbook(input.buffer, {
        filename: input.filename,
        reportEvidence: true,
        limits: input.limits,
      })
      result = adaptPackingReportWorkbook({ ...input, workbook })
    } else if (operation === 'analyze') result = analyzePackingReport(input)
    else if (operation === 'validate')
      result = validatePackingReportReview(input)
    else if (operation === 'plan') result = planPackingReportUpdate(input)
    else throw new Error('Unsupported packing report operation')
    self.postMessage({ generation, result })
  } catch (error) {
    self.postMessage({
      generation,
      error: error.message || 'Packing report could not be read.',
    })
  }
})
