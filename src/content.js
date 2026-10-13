import { extractOrder } from './extract.js'
import { prepareCsv } from './csv.js'
import { mountPageDownload } from './page-download.js'

mountPageDownload(document, () =>
  prepareCsv(extractOrder(document, location.href))
)
