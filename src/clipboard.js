export const columns = [
  'Thumbnail',
  'Description',
  'Price',
  'Quantity',
  'Discount',
]
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]
  )
// One line per product keeps separate pictures aligned with standard Excel rows.
const description = (value) => String(value).replace(/[\t\r\n]+/g, ' · ')
const safeText = (value) =>
  /^[=+@-]/.test(value.trimStart()) ? `'${value}` : value
const tsv = (value) =>
  /["\t\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value

export function clipboardTable(
  items,
  { images = [], imagesOnly = false, headers = true } = {}
) {
  if (!items.length) throw new Error('Select at least one product to copy.')
  if (images.length && images.length !== items.length)
    throw new Error('Every selected product needs its own image.')
  const fields = imagesOnly ? ['Thumbnail'] : columns
  const plainRows = items.map((item) =>
    imagesOnly
      ? ['']
      : [
          '',
          safeText(description(item.description)),
          item.price,
          item.quantity,
          item.discount,
        ]
  )
  const plain = [...(headers ? [fields] : []), ...plainRows]
    .map((row) => row.map((value) => tsv(String(value))).join('\t'))
    .join('\r\n')
  let html = '<table style="border-collapse:collapse;white-space:nowrap">'
  if (headers)
    html += `<tr>${fields.map((field) => `<th>${field}</th>`).join('')}</tr>`
  items.forEach((item, index) => {
    const image = images[index]
    if (image && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image))
      throw new Error('Copy requires a prepared PNG thumbnail.')
    html += '<tr height="20" style="height:15pt;white-space:nowrap">'
    html += `<td width="20" style="width:15pt">${image ? `<img src="${image}" width="20" height="20" alt="">` : ''}</td>`
    if (!imagesOnly)
      html += `<td style="mso-number-format:'\\@';white-space:nowrap">${escape(description(item.description))}</td><td>${escape(item.price)}</td><td>${escape(item.quantity)}</td><td>${escape(item.discount)}</td>`
    html += '</tr>'
  })
  return { plain, html: html + '</table>' }
}

export async function pngThumbnail(dataUrl, { size = 64 } = {}) {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight)
  const width = image.naturalWidth * scale,
    height = image.naturalHeight * scale
  ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
  return canvas.toDataURL('image/png')
}

export async function copyTable(items, options) {
  const { plain, html } = clipboardTable(items, options)
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plain], { type: 'text/plain' }),
    }),
  ])
}

export async function copySingleImage(dataUrl) {
  const png = await pngThumbnail(dataUrl, { size: 256 })
  const bytes = Uint8Array.from(atob(png.split(',')[1]), (char) =>
    char.charCodeAt(0)
  )
  await navigator.clipboard.write([
    new ClipboardItem({
      'image/png': new Blob([bytes], { type: 'image/png' }),
    }),
  ])
}
