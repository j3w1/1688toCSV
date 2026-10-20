import { CFB, read, utils } from 'xlsx'

const decoder = new TextDecoder()

function bytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value)
}

function joinBytes(parts) {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0)
  )
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function dataUrl(raw) {
  let type
  if (raw[0] === 0xff && raw[1] === 0xd8) type = 'image/jpeg'
  else if (raw[0] === 0x89 && raw[1] === 0x50) type = 'image/png'
  else if (raw[0] === 0x47 && raw[1] === 0x49) type = 'image/gif'
  else if (raw[0] === 0x42 && raw[1] === 0x4d) type = 'image/bmp'
  else if (decoder.decode(raw.subarray(0, 4)) === 'RIFF') type = 'image/webp'
  else return null
  let binary = ''
  for (let offset = 0; offset < raw.length; offset += 8192)
    binary += String.fromCharCode(...raw.subarray(offset, offset + 8192))
  return `data:${type};base64,${btoa(binary)}`
}

function xmlText(value = '') {
  return value.replace(
    /&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi,
    (_, code, named) => {
      if (code)
        return String.fromCodePoint(
          code[0].toLowerCase() === 'x'
            ? parseInt(code.slice(1), 16)
            : Number(code)
        )
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[
        named.toLowerCase()
      ]
    }
  )
}

function attrs(source) {
  const result = {}
  for (const match of source.matchAll(
    /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  ))
    result[match[1]] = xmlText(match[2] ?? match[3])
  return result
}

function elements(source, name) {
  const pattern = new RegExp(
    `<((?:[\\w.-]+:)?${name})(?=[\\s/>])([^>]*?)(?:/\\s*>|>([\\s\\S]*?)</\\1\\s*>)`,
    'g'
  )
  return [...source.matchAll(pattern)].map((match) => ({
    attrs: attrs(match[2]),
    body: match[3] || '',
  }))
}

function resolvePart(part, target) {
  const segments = target.startsWith('/') ? [] : part.split('/').slice(0, -1)
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.join('/')
}

function archiveParts(container) {
  const result = new Map()
  container.FullPaths.forEach((path, index) => {
    result.set(
      path.replace(/^[^/]+\//, ''),
      bytes(container.FileIndex[index].content || [])
    )
  })
  return result
}

function relationships(parts, part) {
  const segments = part.split('/')
  const name = segments.pop()
  const path = [...segments, '_rels', `${name}.rels`].join('/')
  return new Map(
    elements(
      decoder.decode(parts.get(path) || new Uint8Array()),
      'Relationship'
    ).map(({ attrs: value }) => [value.Id, value])
  )
}

function xmlAnchor(body, edge) {
  const element = elements(body, edge)[0]
  if (!element) return null
  const number = (name) => Number(elements(element.body, name)[0]?.body || 0)
  return {
    row: number('row') + 1,
    col: number('col') + 1,
    rowOffset: number('rowOff'),
    colOffset: number('colOff'),
  }
}

function xlsxPictures(parts, sheets) {
  const workbook = decoder.decode(
    parts.get('xl/workbook.xml') || new Uint8Array()
  )
  const sheetRelationships = relationships(parts, 'xl/workbook.xml')
  for (const descriptor of elements(workbook, 'sheet')) {
    const sheet = sheets.find(
      (candidate) => candidate.name === descriptor.attrs.name
    )
    const relationship = sheetRelationships.get(descriptor.attrs['r:id'])
    if (!sheet || !relationship) continue
    const sheetPart = resolvePart('xl/workbook.xml', relationship.Target)
    const sheetXml = decoder.decode(parts.get(sheetPart) || new Uint8Array())
    const drawingRelationships = relationships(parts, sheetPart)
    for (const drawing of elements(sheetXml, 'drawing')) {
      const drawingRelationship = drawingRelationships.get(
        drawing.attrs['r:id']
      )
      if (!drawingRelationship || drawingRelationship.TargetMode === 'External')
        continue
      const drawingPart = resolvePart(sheetPart, drawingRelationship.Target)
      const drawingXml = decoder.decode(
        parts.get(drawingPart) || new Uint8Array()
      )
      const imageRelationships = relationships(parts, drawingPart)
      for (const anchor of [
        ...elements(drawingXml, 'twoCellAnchor'),
        ...elements(drawingXml, 'oneCellAnchor'),
        ...elements(drawingXml, 'absoluteAnchor'),
      ]) {
        for (const picture of elements(anchor.body, 'pic')) {
          const embed = elements(picture.body, 'blip')[0]?.attrs['r:embed']
          const imageRelationship = imageRelationships.get(embed)
          const imagePart =
            imageRelationship && imageRelationship.TargetMode !== 'External'
              ? resolvePart(drawingPart, imageRelationship.Target)
              : null
          const raw = imagePart && parts.get(imagePart)
          const image = raw && dataUrl(raw)
          const from = xmlAnchor(anchor.body, 'from')
          const to = xmlAnchor(anchor.body, 'to') || from
          sheet.images.push({
            id: `${drawingPart}:${sheet.images.length + 1}`,
            dataUrl: image || null,
            from,
            to,
            sourcePart: imagePart || null,
            unresolved: !image || !from,
          })
        }
      }
    }
  }
}

function records(raw) {
  const result = []
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  for (let offset = 0; offset + 4 <= raw.length; ) {
    const type = view.getUint16(offset, true)
    const size = view.getUint16(offset + 2, true)
    if (offset + 4 + size > raw.length) break
    result.push({
      type,
      offset,
      body: raw.subarray(offset + 4, offset + 4 + size),
    })
    offset += 4 + size
  }
  return result
}

function escher(raw, start = 0, end = raw.length, depth = 0) {
  if (depth > 20) return []
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const result = []
  for (let pos = start; pos + 8 <= end; ) {
    const options = view.getUint16(pos, true)
    const type = view.getUint16(pos + 2, true)
    const size = view.getUint32(pos + 4, true)
    const limit = Math.min(end, pos + 8 + size)
    result.push({
      type,
      options,
      body: raw.subarray(pos + 8, limit),
      children:
        (options & 15) === 15 ? escher(raw, pos + 8, limit, depth + 1) : [],
    })
    if (pos + 8 + size > end) break
    pos += 8 + size
  }
  return result
}

function descendants(items, type) {
  return items.flatMap((item) => [
    ...(item.type === type ? [item] : []),
    ...descendants(item.children, type),
  ])
}

function embeddedRaster(raw) {
  const signatures = [
    [0xff, 0xd8, 0xff],
    [0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10],
    [0x42, 0x4d],
  ]
  for (const signature of signatures)
    for (let index = 0; index <= raw.length - signature.length; index++)
      if (signature.every((value, offset) => raw[index + offset] === value))
        return dataUrl(raw.subarray(index))
  return null
}

function xlsPictures(parts, sheets) {
  const raw = parts.get('Workbook') || parts.get('Book')
  if (!raw) return
  const all = records(raw)
  const globalDrawings = []
  let collecting = false
  for (const record of all) {
    if (record.type === 0xeb) collecting = true
    else if (record.type !== 0x3c) collecting = false
    if (collecting) globalDrawings.push(record.body)
  }
  const images = descendants(escher(joinBytes(globalDrawings)), 0xf007).map(
    (record) => embeddedRaster(record.body)
  )
  const boundaries = all
    .filter((record) => record.type === 0x85 && record.body.length >= 4)
    .map((record) =>
      new DataView(
        record.body.buffer,
        record.body.byteOffset,
        record.body.length
      ).getUint32(0, true)
    )
  for (let index = 0; index < sheets.length; index++) {
    const start = boundaries[index]
    const end =
      boundaries.filter((offset) => offset > start).sort((a, b) => a - b)[0] ||
      raw.length
    const drawingChunks = []
    collecting = false
    for (const record of all.filter(
      (entry) => entry.offset >= start && entry.offset < end
    )) {
      if (record.type === 0xec) collecting = true
      else if (record.type !== 0x3c) collecting = false
      if (collecting) drawingChunks.push(record.body)
    }
    const shapes = descendants(escher(joinBytes(drawingChunks)), 0xf004)
    for (const shape of shapes) {
      let imageIndex = 0
      let from = null
      let to = null
      for (const child of shape.children) {
        const view = new DataView(
          child.body.buffer,
          child.body.byteOffset,
          child.body.length
        )
        if (child.type === 0xf00b)
          for (
            let prop = 0;
            prop < child.options >> 4 && prop * 6 + 6 <= child.body.length;
            prop++
          )
            if ((view.getUint16(prop * 6, true) & 0x3fff) === 260)
              imageIndex = view.getUint32(prop * 6 + 2, true)
        if (child.type === 0xf010 && child.body.length >= 18) {
          from = {
            col: view.getUint16(2, true) + 1,
            row: view.getUint16(6, true) + 1,
            colOffset: view.getUint16(4, true),
            rowOffset: view.getUint16(8, true),
          }
          to = {
            col: view.getUint16(10, true) + 1,
            row: view.getUint16(14, true) + 1,
            colOffset: view.getUint16(12, true),
            rowOffset: view.getUint16(16, true),
          }
        }
      }
      if (imageIndex)
        sheets[index].images.push({
          id: `biff:${index}:${sheets[index].images.length + 1}`,
          dataUrl: images[imageIndex - 1] || null,
          from,
          to,
          unresolved: !images[imageIndex - 1] || !from,
        })
    }
  }
}

/** Read cells and anchored raster pictures without executing workbook formulas or macros. */
export async function readStoreWorkbook(
  arrayBuffer,
  { filename = 'spreadsheet.xlsx' } = {}
) {
  const raw = bytes(arrayBuffer)
  if (raw.length > 100 * 1024 * 1024)
    throw new Error('The spreadsheet exceeds the 100 MB import limit.')
  if (
    !(
      (raw[0] === 0x50 && raw[1] === 0x4b) ||
      (raw[0] === 0xd0 && raw[1] === 0xcf)
    )
  )
    throw new Error('Choose an Excel .xlsx or .xls workbook.')
  const workbook = read(raw, {
    type: 'array',
    cellFormula: true,
    cellStyles: true,
    cellDates: false,
  })
  const sheets = workbook.SheetNames.map((name) => {
    const source = workbook.Sheets[name]
    const rowMap = new Map()
    for (const address of Object.keys(source).filter(
      (key) => !key.startsWith('!')
    )) {
      const cell = source[address]
      const location = utils.decode_cell(address)
      if (!rowMap.has(location.r + 1)) rowMap.set(location.r + 1, [])
      rowMap.get(location.r + 1).push({
        col: location.c + 1,
        address,
        value: cell.v ?? null,
        ...(cell.f ? { formula: cell.f } : {}),
        ...(cell.t === 'e' ? { error: cell.w || 'Formula error' } : {}),
      })
    }
    return {
      name,
      rows: [...rowMap]
        .sort(([a], [b]) => a - b)
        .map(([row, cells]) => ({
          row,
          cells: cells.sort((a, b) => a.col - b.col),
        })),
      images: [],
      merges: (source['!merges'] || []).map((range) => ({
        from: { row: range.s.r + 1, col: range.s.c + 1 },
        to: { row: range.e.r + 1, col: range.e.c + 1 },
      })),
    }
  })
  const parts = archiveParts(CFB.read(raw, { type: 'array' }))
  if (raw[0] === 0x50) xlsxPictures(parts, sheets)
  else xlsPictures(parts, sheets)
  return { filename, sheets }
}
