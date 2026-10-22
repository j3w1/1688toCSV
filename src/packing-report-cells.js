import {
  limitsFor,
  issue,
  columnAddress,
  clone,
} from './packing-report-utils.js'

function identity({ sourceId, rawAssetRef, rawDigest }) {
  for (const [name, value] of Object.entries({
    sourceId,
    rawAssetRef,
    rawDigest,
  }))
    if (typeof value !== 'string' || !value || value.length > 1024)
      throw new Error(`Report ${name} is required`)
  if (/^(?:https?:|data:)/i.test(rawAssetRef))
    throw new Error('Report assets must be local references')
  return { sourceId, rawAssetRef, rawDigest }
}

function assertCells(sheets, limits) {
  if (!sheets.length || sheets.length > limits.sheets)
    throw new Error('Report sheet limit exceeded')
  if (new Set(sheets.map((sheet) => sheet.name)).size !== sheets.length)
    throw new Error('Duplicate report sheet names')
  let count = 0
  for (const sheet of sheets) {
    const refs = new Set()
    for (const cell of sheet.cells) {
      if (
        !Number.isSafeInteger(cell.row) ||
        cell.row < 1 ||
        cell.row > limits.rows + 1 ||
        !Number.isSafeInteger(cell.col) ||
        cell.col < 1 ||
        cell.col > limits.columns
      )
        throw new Error('Report row/column limit exceeded')
      const ref = `${cell.row}:${cell.col}`
      if (refs.has(ref)) throw new Error('Duplicate report cell coordinate')
      refs.add(ref)
      for (const value of [
        cell.raw,
        cell.display,
        cell.numberFormat,
        cell.formula,
      ])
        if (String(value ?? '').length > limits.cellText)
          throw new Error('Report cell text limit exceeded')
      if (
        cell.raw !== null &&
        !['string', 'number', 'boolean'].includes(typeof cell.raw)
      )
        throw new Error('Unsupported report cell value')
      if (typeof cell.raw === 'number' && !Number.isFinite(cell.raw))
        throw new Error('Nonfinite report cell')
      if (++count > limits.cells)
        throw new Error('Report populated cell limit exceeded')
    }
  }
}

/** TSV only: quoted tabs/newlines, CRLF, blank rows and trailing cells survive. */
export function parsePackingReportCells({
  text,
  sourceId,
  rawAssetRef,
  rawDigest,
  limits,
} = {}) {
  try {
    const bounds = limitsFor(limits)
    const refs = identity({ sourceId, rawAssetRef, rawDigest })
    if (typeof text !== 'string') throw new Error('Report text is required')
    if (new TextEncoder().encode(text).byteLength > bounds.textBytes)
      throw new Error('Report text byte limit exceeded')
    const rows = [],
      cells = []
    let row = [],
      value = '',
      quoted = false,
      closed = false,
      started = false
    const field = () => {
      row.push(value)
      value = ''
      closed = false
      started = false
    }
    const line = () => {
      field()
      rows.push(row)
      row = []
    }
    for (let index = 0; index < text.length; index++) {
      const character = text[index]
      if (quoted) {
        if (character === '"') {
          if (text[index + 1] === '"') {
            value += '"'
            index++
          } else {
            quoted = false
            closed = true
          }
        } else value += character
      } else if (character === '\t') field()
      else if (character === '\r' || character === '\n') {
        if (character === '\r' && text[index + 1] === '\n') index++
        line()
      } else if (character === '"' && !started && !value) {
        quoted = true
        started = true
      } else {
        if (closed)
          throw new Error('Unexpected text after a quoted report cell')
        value += character
        started = true
      }
      if (value.length > bounds.cellText)
        throw new Error('Report cell text limit exceeded')
      if (rows.length > bounds.rows + 1 || row.length > bounds.columns)
        throw new Error('Report row/column limit exceeded')
    }
    if (quoted) throw new Error('Unclosed quoted report cell')
    // A terminal newline terminates a row; it does not invent another blank row.
    if (
      value ||
      row.length ||
      started ||
      closed ||
      !rows.length ||
      !/[\r\n]$/.test(text)
    )
      line()
    rows.forEach((values, r) =>
      values.forEach((raw, c) =>
        cells.push({
          sheet: 'Clipboard',
          row: r + 1,
          col: c + 1,
          address: `${columnAddress(c + 1)}${r + 1}`,
          raw,
          type: 's',
        })
      )
    )
    const sheets = [{ name: 'Clipboard', cells, merges: [], images: [] }]
    assertCells(sheets, bounds)
    return {
      source: {
        ...refs,
        kind: 'clipboard-tsv',
        rawText: text,
        sheets,
        fidelity: { formattedIdentifiers: false, formulaMetadata: false },
      },
      issues: [],
    }
  } catch (error) {
    return {
      source: null,
      issues: [
        issue(
          'invalidSource',
          'error',
          { sourceId },
          { reason: error.message }
        ),
      ],
    }
  }
}

/** Adapt decoder evidence without invoking the China marker analyzer. */
export function adaptPackingReportWorkbook({
  workbook,
  sourceId,
  rawAssetRef,
  rawDigest,
  limits,
} = {}) {
  const refs = identity({ sourceId, rawAssetRef, rawDigest })
  if (!workbook || !Array.isArray(workbook.sheets))
    throw new Error('Decoded report workbook required')
  const sheets = workbook.sheets.map((sheet) => ({
    name: sheet.name,
    cells: sheet.rows.flatMap((row) =>
      row.cells.map(({ value, ...cell }) => ({
        ...clone(cell),
        sheet: sheet.name,
        row: row.row,
        raw: value ?? null,
      }))
    ),
    merges: clone(sheet.merges || []),
    images: clone(sheet.images || []),
    ...(sheet.hiddenRows ? { hiddenRows: clone(sheet.hiddenRows) } : {}),
    ...(sheet.hiddenColumns
      ? { hiddenColumns: clone(sheet.hiddenColumns) }
      : {}),
  }))
  assertCells(sheets, limitsFor(limits))
  return {
    ...refs,
    kind: /\.xls$/i.test(workbook.filename) ? 'xls' : 'xlsx',
    filename: workbook.filename,
    sheets,
    fidelity: {
      formattedIdentifiers: !!workbook.reportEvidence,
      formulaMetadata: true,
    },
  }
}
