const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  )
const safe = (value) =>
  /^[=+@-]/.test(String(value).trimStart()) ? `'${value}` : String(value)
const normalized = (value) => String(value ?? '').replace(/[\t\r\n]+/g, ' · ')
const line = (value, numeric = false) => {
  const text = numeric ? normalized(value) : safe(normalized(value))
  return text.includes('"') ? `"${text.replaceAll('"', '""')}"` : text
}
export const preparationColumns = [
  ['baseCode', 'Product code'],
  ['barcode', 'Barcode'],
  ['description', 'Description'],
  ['spanishName', 'Spanish description'],
  ['price', 'Price'],
  ['quantity', 'Quantity'],
  ['discount', 'Discount'],
]
export function preparationTable(rows, fields, headers = false) {
  const chosen = preparationColumns.filter(([key]) => fields.includes(key))
  if (!chosen.length || !rows.length)
    throw new Error('Choose columns and product rows to copy.')
  const seen = new Set()
  const values = rows.map((row) => {
    const key = `${row.orderId}/${row.groupId}`
    const first = !seen.has(key)
    seen.add(key)
    return chosen.map(([field]) =>
      field === 'baseCode' && !first ? '' : (row[field] ?? '')
    )
  })
  const plain = [
    ...(headers ? [chosen.map(([, title]) => title)] : []),
    ...values,
  ]
    .map((row) =>
      row
        .map((value, index) =>
          line(
            value,
            ['price', 'quantity', 'discount'].includes(chosen[index][0])
          )
        )
        .join('\t')
    )
    .join('\r\n')
  const head = headers
    ? `<tr>${chosen.map(([, title]) => `<th>${escape(title)}</th>`).join('')}</tr>`
    : ''
  const html = `<table>${head}${values.map((row) => `<tr>${row.map((value, i) => `<td${['price', 'quantity', 'discount'].includes(chosen[i][0]) ? '' : ' style="mso-number-format:\'\\@\'"'}>${escape(normalized(value))}</td>`).join('')}</tr>`).join('')}</table>`
  return { plain, html }
}
export async function writeTable({ plain, html }) {
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/plain': new Blob([plain], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    }),
  ])
}
export async function labelClipboard(results) {
  if (!results.length) throw new Error('No labels are ready to copy.')
  const images = await Promise.all(
    results.map(async (result) => ({
      ...result,
      data: await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(result.blob)
      }),
    }))
  )
  const html = `<table>${images.map((item) => `<tr style="height:${(item.heightMm * 72) / 25.4}pt"><td style="width:${(item.widthMm * 72) / 25.4}pt"><img src="${item.data}" width="${(item.widthMm * 96) / 25.4}" height="${(item.heightMm * 96) / 25.4}" style="width:${item.widthMm}mm;height:${item.heightMm}mm"></td></tr>`).join('')}</table>`
  const formats = { 'text/html': new Blob([html], { type: 'text/html' }) }
  if (results.length === 1) formats['image/png'] = results[0].blob
  await navigator.clipboard.write([new ClipboardItem(formats)])
}
