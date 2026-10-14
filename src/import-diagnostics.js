import { deepQuery } from './dom.js'
import { extractOrder } from './extract.js'
import { centsToMoney, lineGrossCents, moneyToCents } from './money.js'

const short = (value, limit = 160) => {
  const text = String(value ?? '')
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0)

/** Bound persisted diagnostics to financial fields, never page HTML or session data. */
export function financialDiagnostics(input) {
  if (!input || typeof input !== 'object' || input.version !== 1)
    return undefined
  const fields = Array.isArray(input.fields) ? input.fields : []
  const samples = Array.isArray(input.products?.sample)
    ? input.products.sample
    : []
  return {
    version: 1,
    extensionVersion: short(input.extensionVersion, 32),
    capturedAt: short(input.capturedAt, 32),
    totalSections: count(input.totalSections),
    fields: fields.slice(0, 30).map((field) => ({
      label: short(field?.label),
      value: short(field?.value),
    })),
    omittedFields: count(input.omittedFields) + Math.max(0, fields.length - 30),
    payable: short(input.payable),
    discountSummary: short(input.discountSummary),
    products: {
      count: count(input.products?.count),
      gross: short(input.products?.gross, 64),
      discount: short(input.products?.discount, 64),
      sample: samples.slice(0, 25).map((item) => ({
        row: count(item?.row),
        price: short(item?.price, 32),
        quantity: short(item?.quantity, 32),
        discount: short(item?.discount, 32),
      })),
      omittedRows:
        count(input.products?.omittedRows) + Math.max(0, samples.length - 25),
      error: short(input.products?.error),
    },
  }
}

export function collectFinancialDiagnostics(document, url, extensionVersion) {
  const input = {
    version: 1,
    extensionVersion,
    capturedAt: new Date().toISOString(),
    products: {},
  }
  try {
    const hosts = deepQuery(document).all('order-total-price')
    input.totalSections = hosts.length
    const root = hosts[0]?.shadowRoot
    if (root) {
      const query = deepQuery(root)
      input.fields = query.all('.detail-price dl').map((field) => ({
        label: field.querySelector('dt')?.textContent?.trim(),
        value: field.querySelector('dd')?.textContent?.trim(),
      }))
      input.payable = query.one('.total-sum-pay')?.textContent?.trim()
      input.discountSummary = query.one('.total-discount')?.textContent?.trim()
    }
    try {
      const { dataRows } = extractOrder(document, url)
      input.products = {
        count: dataRows.length,
        gross: centsToMoney(
          dataRows.reduce(
            (sum, row) => sum + lineGrossCents(row.price, row.quantity),
            0n
          )
        ),
        discount: centsToMoney(
          dataRows.reduce((sum, row) => sum + moneyToCents(row.discount), 0n)
        ),
        sample: dataRows.slice(0, 25).map((row, index) => ({
          row: index + 1,
          price: row.price,
          quantity: row.quantity,
          discount: row.discount,
        })),
        omittedRows: Math.max(0, dataRows.length - 25),
      }
    } catch (error) {
      input.products.error = error.message
    }
  } catch (error) {
    input.products.error = error.message
  }
  return financialDiagnostics(input)
}
