import { mountPageDownload } from '../src/page-download.js'
import { prepareCsv } from '../src/csv.js'

// Synthetic data only; this adapter never enters the installed extension.
const response = await fetch('/fixture-data.json')
const order = await response.json()
const scenario = new URL(location.href).searchParams.get('state')
mountPageDownload(document, () => {
  if (scenario === 'error')
    throw new Error(
      'Row 2: product details are incomplete. Refresh the order and try again.'
    )
  return prepareCsv(order)
})
