import { deepQuery } from './dom.js'
import { discountText, extractOrder, findOrderTable } from './extract.js'
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
  const invalidDiscount = input.products?.invalidDiscount
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
      sample: samples.slice(0, 25).map((item) => {
        const sample = {
          row: count(item?.row),
          price: short(item?.price, 32),
          quantity: short(item?.quantity, 32),
          discount: short(item?.discount, 32),
        }
        for (const field of [
          'discountAmountTexts',
          'discountItemTexts',
          'discountSummaryTexts',
          'priceTexts',
        ]) {
          if (!Array.isArray(item?.[field])) continue
          const omitted = `omitted${field[0].toUpperCase()}${field.slice(1)}`
          sample[field] = item[field]
            .slice(0, 3)
            .map((value) => short(value, 64))
          sample[omitted] =
            count(item[omitted]) + Math.max(0, item[field].length - 3)
        }
        return sample
      }),
      omittedRows:
        count(input.products?.omittedRows) + Math.max(0, samples.length - 25),
      error: short(input.products?.error),
      ...(count(invalidDiscount?.row) > 0 &&
      typeof invalidDiscount?.value === 'string'
        ? {
            invalidDiscount: {
              row: invalidDiscount.row,
              value: short(invalidDiscount.value),
            },
          }
        : {}),
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
    const table = findOrderTable(document)
    const rows = table ? deepQuery(table).all('tr.table-row') : []
    input.products.sample = rows.slice(0, 25).map((row, index) => {
      const cells = deepQuery(row)
      const discountArea =
        row.querySelector(':scope > td:nth-child(4)') ||
        cells.one('order-table-discount')?.shadowRoot
      const pay = cells.one('order-table-pay')?.shadowRoot
      const price = pay && deepQuery(pay).one('.order-table-pay .pay')
      const discountQuery = discountArea && deepQuery(discountArea)
      const discountItems =
        discountQuery?.all('.order-table-discount-item') || []
      return {
        row: index + 1,
        discountAmountTexts:
          discountQuery
            ?.all('.order-table-discount-item-price')
            .map(discountText) || [],
        ...(discountItems.length
          ? { discountItemTexts: discountItems.map(discountText) }
          : {}),
        // Keep only the summary's monetary fragment, never the surrounding row.
        discountSummaryTexts:
          discountText(row).match(/优\s*惠\s*共[\s:：¥￥+\-−\d.,]*(?:元)?/g) ||
          [],
        priceTexts: [...(price?.querySelectorAll(':scope > div') || [])].map(
          (element) => element.textContent
        ),
      }
    })
    input.products.omittedRows = Math.max(0, rows.length - 25)
    try {
      const { dataRows } = extractOrder(document, url)
      input.products = {
        ...input.products,
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
          ...input.products.sample[index],
          price: row.price,
          quantity: row.quantity,
          discount: row.discount,
        })),
        omittedRows: Math.max(0, dataRows.length - 25),
      }
    } catch (error) {
      // An aborted extraction leaves count and aggregates unavailable.
      input.products.error = error.message
      input.products.invalidDiscount = error.invalidDiscount
    }
  } catch (error) {
    input.products.error = error.message
  }
  return financialDiagnostics(input)
}
