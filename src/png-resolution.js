const signature = [137, 80, 78, 71, 13, 10, 26, 10]

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Canvas PNGs default to 96 dpi. Write the requested physical resolution. */
export async function pngWithDpi(blob, dpi) {
  if (!Number.isFinite(dpi) || dpi <= 0 || dpi > 1200)
    throw new Error('PNG resolution must be between 1 and 1200 dpi')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (!signature.every((byte, index) => bytes[index] === byte))
    throw new Error('The label renderer did not produce a PNG')
  const physical = new Uint8Array(21)
  const view = new DataView(physical.buffer)
  view.setUint32(0, 9)
  physical.set([112, 72, 89, 115], 4)
  const pixelsPerMetre = Math.round(dpi / 0.0254)
  view.setUint32(8, pixelsPerMetre)
  view.setUint32(12, pixelsPerMetre)
  physical[16] = 1
  view.setUint32(17, crc32(physical.subarray(4, 17)))
  const parts = [bytes.subarray(0, 8)]
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let position = 8
  let header = false
  let end = false
  while (position + 12 <= bytes.length) {
    const length = source.getUint32(position)
    const next = position + length + 12
    if (next > bytes.length) throw new Error('The label PNG is incomplete')
    const type = String.fromCharCode(
      ...bytes.subarray(position + 4, position + 8)
    )
    if (type !== 'pHYs') parts.push(bytes.subarray(position, next))
    if (type === 'IHDR') {
      if (header || length !== 13)
        throw new Error('The label PNG header is invalid')
      header = true
      parts.push(physical)
    }
    position = next
    if (type === 'IEND') {
      end = true
      break
    }
  }
  if (!header || !end || position !== bytes.length)
    throw new Error('The label PNG is incomplete')
  return new Blob(parts, { type: 'image/png' })
}
