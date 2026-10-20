import {
  centsToMoney,
  lineGrossCents,
  moneyToCents,
  normalizePrice,
} from './money.js'

export const STORE_IMPORT_MARKERS = Object.freeze([
  'pic',
  'desc',
  'boxes',
  'perbox',
  'qty',
  'price',
  'amount',
  'group',
  'var',
  'kg',
  'cbm',
  'cbmx',
  'cbmy',
  'cbmz',
  'total',
])
const markerSet = new Set(STORE_IMPORT_MARKERS)
const clean = (value) => String(value ?? '').trim()
const normalizedMarker = (value) => clean(value).toLowerCase()

/** Strip only familiar duplicate-download suffixes; a numeric stem identifies a market store. */
export function parseStoreFilename(filename) {
  let stem = clean(filename)
    .split(/[\\/]/)
    .pop()
    .replace(/\.(?:xlsx|xls)$/i, '')
    .trim()
  for (let previous; previous !== stem; ) {
    previous = stem
    stem = stem
      .replace(/\s*\((?:\d+|copy|副本)\)$/i, '')
      .replace(/\s*[-–]\s*copy$/i, '')
      .trim()
  }
  const number = /^\d+$/.test(stem) ? stem : ''
  return {
    key: number ? `market:${number}` : `factory:${stem.toLocaleLowerCase()}`,
    name: stem,
    number,
    kind: number ? 'market' : 'factory',
  }
}

/** Accept one decimal surrounded by units, never a dimension triple or an arithmetic expression. */
export function parseStoreNumber(
  value,
  { integer = false, positive = false } = {}
) {
  if (
    typeof value === 'boolean' ||
    value === null ||
    value === undefined ||
    value === ''
  )
    throw new Error('Enter a number.')
  // Excel stores 15 significant decimal digits. Cached arithmetic can otherwise
  // expose a binary floating-point tail such as 59.99999999999999.
  let source =
    typeof value === 'number'
      ? String(Number.isInteger(value) ? value : Number(value.toPrecision(15)))
      : clean(value).replace(/，/g, ',').replace(/−/g, '-')
  if (!source || /[×*\/=%]/.test(source))
    throw new Error('Enter one number, not a calculation or dimensions.')
  // A comma must be a thousands separator, not a silently changed decimal mark.
  source = source.replace(/\d[\d,]*(?:\.\d+)?/g, (match) => {
    if (match.includes(',') && !/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(match))
      throw new Error('Use a decimal point and valid thousands separators.')
    return match.replace(/,/g, '')
  })
  const matches = [...source.matchAll(/[+\-]?(?:\d+(?:\.\d*)?|\.\d+)/g)]
  const match = matches[0]
  if (
    matches.length !== 1 ||
    !/^[\p{L}\p{Sc}\s³².]*$/u.test(
      source.slice(0, match.index) + source.slice(match.index + match[0].length)
    )
  )
    throw new Error(
      'Enter one unambiguous number; optional units may follow it.'
    )
  const result = Number(match[0])
  if (!Number.isFinite(result) || result < 0 || (positive && result <= 0))
    throw new Error(
      positive ? 'Enter a positive number.' : 'Enter a nonnegative number.'
    )
  if (integer && !Number.isSafeInteger(result))
    throw new Error('Enter a positive whole number within the supported range.')
  if (integer) return String(result)
  const canonical = match[0]
    .replace(/^\+/, '')
    .replace(/^\./, '0.')
    .replace(/\.$/, '')
  const [whole, fraction = ''] = canonical.split('.')
  return `${BigInt(whole)}${fraction.replace(/0+$/, '') ? `.${fraction.replace(/0+$/, '')}` : ''}`
}

function address(row, col) {
  let result = ''
  for (let index = col; index > 0; index = Math.floor((index - 1) / 26))
    result = String.fromCharCode(65 + ((index - 1) % 26)) + result
  return result + row
}

function variantTokens(value) {
  const source = clean(value)
    .toLowerCase()
    .replace(/[\s,;/]+/g, '')
  if (!source) return []
  const combinedSize = source.match(/^([a-h]+)(xs|s|m|l|xl|xxl)$/)
  if (combinedSize && new Set(combinedSize[1]).size === combinedSize[1].length)
    return [...combinedSize[1]].map((variant) => ({
      variant: variant.toUpperCase(),
      size: combinedSize[2].toUpperCase(),
    }))
  if (/^(?:xs|s|m|l|xl|xxl|xxxl)$/.test(source))
    return [{ variant: '', size: source.toUpperCase() }]
  if (
    /^[a-z]+$/.test(source) &&
    source.length <= 12 &&
    new Set(source).size === source.length
  )
    return [...source].map((variant) => ({
      variant: variant.toUpperCase(),
      size: '',
    }))
  if (/^[a-z]?(?:xs|s|m|l|xl|xxl)$/.test(source) && source.length > 1) {
    const match = source.match(/^([a-z])(.*)$/)
    return [{ variant: match[1].toUpperCase(), size: match[2].toUpperCase() }]
  }
  throw new Error(
    'Use a variant letter, size, combined letters (abcd), or letters with a size (abs).'
  )
}

function covered(image, row, col) {
  if (!image.from) return false
  const to = image.to || image.from
  const endRow =
    to.row - (to.row > image.from.row && to.rowOffset === 0 ? 1 : 0)
  const endCol =
    to.col - (to.col > image.from.col && to.colOffset === 0 ? 1 : 0)
  return (
    row >= image.from.row &&
    row <= endRow &&
    col >= image.from.col &&
    col <= endCol
  )
}

/** Pure validation: no database writes or worksheet changes occur during analysis. */
export function analyzeStoreSheet(workbook, sheetName) {
  const sheet = workbook.sheets.find(
    (candidate) => candidate.name === sheetName
  )
  if (!sheet) throw new Error('Choose a worksheet from this workbook.')
  const issues = []
  const issue = (severity, code, message, cells = [], row, params) =>
    issues.push({
      severity,
      code,
      message,
      cells,
      ...(row ? { row } : {}),
      ...(params ? { params } : {}),
    })
  const byRow = new Map(
    sheet.rows.map((row) => [
      row.row,
      new Map(row.cells.map((cell) => [cell.col, cell])),
    ])
  )
  const candidates = sheet.rows
    .map((row) => ({
      row: row.row,
      markers: row.cells.filter(
        (cell) =>
          markerSet.has(normalizedMarker(cell.value)) &&
          normalizedMarker(cell.value) !== 'total'
      ),
    }))
    .sort((a, b) => b.markers.length - a.markers.length)
  const markerRow = candidates[0]
  const columns = new Map()
  for (const cell of markerRow?.markers || []) {
    const marker = normalizedMarker(cell.value)
    if (!columns.has(marker)) columns.set(marker, [])
    columns.get(marker).push(cell.col)
  }
  for (const marker of ['pic', 'group', 'boxes', 'price'])
    if (!columns.has(marker))
      issue(
        'error',
        'missing-marker',
        'Add the required {marker} marker to the marker row.',
        [],
        undefined,
        { marker }
      )
  if (!columns.has('perbox') && !columns.has('qty'))
    issue(
      'error',
      'missing-quantity-marker',
      'Add perbox, qty, or both to the marker row.'
    )
  for (const [marker, cols] of columns)
    if (marker !== 'desc' && cols.length > 1)
      issue(
        'error',
        'duplicate-marker',
        'Use {marker} only once in the marker row.',
        cols.map((col) => address(markerRow.row, col)),
        undefined,
        { marker }
      )
  const allCells = sheet.rows.flatMap((row) =>
    row.cells.map((cell) => ({ ...cell, row: row.row }))
  )
  const totalMarkers = allCells.filter(
    (cell) => normalizedMarker(cell.value) === 'total'
  )
  const pairs = []
  const usedTotalMarkers = new Set()
  for (let first = 0; first < totalMarkers.length; first++)
    for (let second = first + 1; second < totalMarkers.length; second++) {
      const a = totalMarkers[first]
      const b = totalMarkers[second]
      if (a.row !== b.row && a.col !== b.col) continue
      const inside = allCells.filter(
        (cell) =>
          (clean(cell.value) || cell.formula || cell.error) &&
          (a.row === b.row
            ? cell.row === a.row &&
              cell.col > Math.min(a.col, b.col) &&
              cell.col < Math.max(a.col, b.col)
            : cell.col === a.col &&
              cell.row > Math.min(a.row, b.row) &&
              cell.row < Math.max(a.row, b.row))
      )
      if (inside.length !== 1) continue
      if (
        inside[0].error ||
        (inside[0].formula &&
          (inside[0].value === null || inside[0].value === undefined))
      ) {
        issue(
          'error',
          'formula-value',
          inside[0].error
            ? 'Correct this spreadsheet formula error before importing.'
            : 'Open and save this workbook in Excel so this formula has a calculated value.',
          [inside[0].address],
          inside[0].row
        )
        continue
      }
      try {
        const control = centsToMoney(
          moneyToCents(parseStoreNumber(inside[0].value))
        )
        pairs.push({
          value: control,
          cells: [a.address, inside[0].address, b.address],
        })
        usedTotalMarkers.add(a.address)
        usedTotalMarkers.add(b.address)
      } catch {
        issue(
          'error',
          'invalid-total',
          'The value between total markers must be a valid monetary amount.',
          [a.address, inside[0].address, b.address]
        )
      }
    }
  if (pairs.length !== 1)
    issue(
      'error',
      'total-control',
      'Surround exactly one whole-order amount with two total markers: total | amount | total.',
      totalMarkers.map((cell) => cell.address)
    )
  else if (usedTotalMarkers.size !== totalMarkers.length)
    issue(
      'error',
      'unpaired-total',
      'Remove or pair the extra total markers.',
      totalMarkers
        .filter((cell) => !usedTotalMarkers.has(cell.address))
        .map((cell) => cell.address)
    )
  const rows = []
  let skippedRows = 0
  const firstColumn = (marker) => columns.get(marker)?.[0]
  const valueAt = (row, marker) => row.get(firstColumn(marker))
  for (const [rowNumber, cells] of byRow) {
    if (!markerRow || rowNumber <= markerRow.row) continue
    if (
      [...cells.values()].some(
        (cell) => normalizedMarker(cell.value) === 'total'
      )
    )
      continue
    const numericHeaderCount = [
      'boxes',
      'perbox',
      'qty',
      'price',
      'amount',
      'kg',
      'cbm',
    ].filter((marker) => {
      const value = clean(valueAt(cells, marker)?.value)
      return /^(?:箱数|箱數|件数|装箱数|装箱量|数量|总数量|單價|单价|金额|总价|重量|体积|立方|ctns?|cartons?|boxes|pcs(?:\/(?:ctn|box))?|total units|qty|unit price(?:\s*\(CNY\))?|price|u\/p|(?:line )?amount(?:\s*\(CNY\))?|ttl\s*amt\.?|kg(?:\/box)?|g\.w\.?|cbm|m³\/box)$/i.test(
        value
      )
    }).length
    if (numericHeaderCount >= 2) continue
    const groupCell = valueAt(cells, 'group')
    if (!clean(groupCell?.value)) {
      skippedRows++
      continue
    }
    const row = {
      row: rowNumber,
      group: clean(groupCell.value),
      description: '',
      title: '',
      productNumber: '',
      skuProperties: [],
      variants: [],
      boxes: null,
      perbox: null,
      quantity: null,
      price: null,
      amount: null,
      kg: null,
      cbm: null,
      len: null,
      wid: null,
      ht: null,
      photos: [],
      cells: {},
    }
    for (const [marker, cols] of columns)
      row.cells[marker] =
        marker === 'desc'
          ? cols.map((col) => address(rowNumber, col))
          : address(rowNumber, cols[0])
    for (const cell of cells.values())
      if (
        (cell.error ||
          (cell.formula &&
            (cell.value === null || cell.value === undefined))) &&
        [...columns.values()].flat().includes(cell.col)
      )
        issue(
          'error',
          'formula-value',
          cell.error
            ? 'Correct this spreadsheet formula error before importing.'
            : 'Open and save this workbook in Excel so this formula has a calculated value.',
          [cell.address],
          rowNumber
        )
    for (const [marker, target, integer, positive] of [
      ['boxes', 'boxes', true, true],
      ['perbox', 'perbox', true, true],
      ['qty', 'quantity', true, true],
      ['price', 'price', false, false],
      ['amount', 'amount', false, false],
      ['kg', 'kg', false, false],
      ['cbm', 'cbm', false, false],
      ['cbmx', 'len', false, true],
      ['cbmy', 'wid', false, true],
      ['cbmz', 'ht', false, true],
    ]) {
      const cell = valueAt(cells, marker)
      const required = marker === 'boxes' || marker === 'price'
      if (!clean(cell?.value)) {
        if (required)
          issue(
            'error',
            'missing-value',
            'Enter {marker} for this included product row.',
            [address(rowNumber, firstColumn(marker) || 1)],
            rowNumber,
            { marker }
          )
        continue
      }
      try {
        const value = parseStoreNumber(cell.value, { integer, positive })
        row[target] =
          target === 'price'
            ? normalizePrice(value)
            : target === 'amount'
              ? centsToMoney(moneyToCents(value))
              : Number(value)
      } catch (error) {
        issue(
          'error',
          'invalid-number',
          error.message,
          [cell.address],
          rowNumber
        )
      }
    }
    if (row.quantity === null && row.boxes && row.perbox)
      row.quantity = row.boxes * row.perbox
    if (
      row.perbox === null &&
      row.quantity &&
      row.boxes &&
      Number.isInteger(row.quantity / row.boxes)
    )
      row.perbox = row.quantity / row.boxes
    if (!row.quantity || !row.perbox)
      issue(
        'error',
        'quantity-unresolved',
        'Supply an exact positive qty or perbox value; qty must divide evenly across boxes.',
        [row.cells.qty, row.cells.perbox, row.cells.boxes].filter(Boolean),
        rowNumber
      )
    if (
      row.boxes &&
      row.perbox &&
      row.quantity &&
      row.boxes * row.perbox !== row.quantity
    )
      issue(
        'error',
        'quantity-mismatch',
        '{boxes} boxes × {perbox} pcs/box = {expected} pieces, but qty is {quantity}. Correct the source values.',
        [row.cells.boxes, row.cells.perbox, row.cells.qty].filter(Boolean),
        rowNumber,
        {
          boxes: row.boxes,
          perbox: row.perbox,
          expected: row.boxes * row.perbox,
          quantity: row.quantity,
        }
      )
    if (row.quantity && !Number.isSafeInteger(row.quantity))
      issue(
        'error',
        'quantity-range',
        'The calculated quantity exceeds the supported whole-number range.',
        [row.cells.boxes, row.cells.perbox].filter(Boolean),
        rowNumber
      )
    if (
      Number.isSafeInteger(row.quantity) &&
      row.quantity > 0 &&
      row.price !== null
    ) {
      const expected = centsToMoney(
        lineGrossCents(row.price, String(row.quantity))
      )
      if (row.amount !== null && row.amount !== expected)
        issue(
          'error',
          'amount-mismatch',
          'Price {price} × quantity {quantity} = ¥{expected}, but amount is ¥{amount}. Correct the source values.',
          [
            row.cells.price,
            row.cells.qty || row.cells.perbox,
            row.cells.amount,
          ].filter(Boolean),
          rowNumber,
          {
            price: row.price,
            quantity: row.quantity,
            expected,
            amount: row.amount,
          }
        )
      row.calculatedAmount = expected
      row.amount ??= expected
    }
    const dimensions = [row.len, row.wid, row.ht]
    if (
      dimensions.some((value) => value !== null) &&
      dimensions.some((value) => value === null)
    )
      issue(
        'error',
        'incomplete-dimensions',
        'Enter all three carton dimensions: cbmx, cbmy and cbmz.',
        [row.cells.cbmx, row.cells.cbmy, row.cells.cbmz].filter(Boolean),
        rowNumber
      )
    row.sourceCbm = row.cbm
    if (dimensions.every((value) => value !== null))
      row.cbm = Number(((row.len * row.wid * row.ht) / 1_000_000).toFixed(9))
    const fragments = []
    for (const col of columns.get('desc') || []) {
      const value = clean(cells.get(col)?.value)
      if (!value) continue
      fragments.push(value)
      const headers = [...byRow]
        .filter(
          ([number]) =>
            number > markerRow.row &&
            number < rowNumber &&
            number <= markerRow.row + 6
        )
        .map(([, header]) => clean(header.get(col)?.value))
      if (
        !row.productNumber &&
        headers.some((header) =>
          /^(?:item\s*(?:no\.?|number)|货号|型号|model)$/i.test(header)
        )
      )
        row.productNumber = value
      const role = headers.find((header) =>
        /^(?:item\s*(?:no\.?|number)|货号|款号|型号|model|size|尺寸|尺码|容量|ml|color|colour|颜色|色号|material|材质|材料)$/i.test(
          header
        )
      )
      if (role) row.skuProperties.push({ label: role, value })
    }
    row.description = fragments.join(' · ')
    row.title = row.description || `Group ${row.group}`
    if (!row.description) row.description = row.title
    try {
      row.variants = variantTokens(valueAt(cells, 'var')?.value)
    } catch (error) {
      issue(
        'error',
        'invalid-variant',
        error.message,
        [row.cells.var],
        rowNumber
      )
    }
    if (row.variants.length > 1)
      issue(
        'review',
        'variant-allocation',
        'This row combines variants. Allocate its existing quantity across the variants; do not duplicate the row totals or cartons.',
        [row.cells.var, row.cells.qty || row.cells.perbox].filter(Boolean),
        rowNumber
      )
    rows.push(row)
  }
  if (!rows.length)
    issue(
      'error',
      'no-products',
      'No included product rows were found. Add group values to the product rows to import.'
    )
  const groups = new Map()
  for (const row of rows) {
    if (!groups.has(row.group)) groups.set(row.group, [])
    groups.get(row.group).push(row)
  }
  for (const groupRows of groups.values())
    if (
      groupRows.length > 1 &&
      groupRows.some((row) => row.variants.length > 1)
    ) {
      const keys = groupRows.flatMap((row) =>
        row.variants.map((item) => `${item.variant}:${item.size}`)
      )
      const sizedAssortments =
        groupRows.every(
          (row) =>
            row.variants.length && row.variants.every((item) => item.size)
        ) && new Set(keys).size === keys.length
      if (!sizedAssortments)
        issue(
          'error',
          'nested-variants',
          'A group with multiple source rows cannot contain combined variants without distinct sizes. Give each variant its own row, or use distinct sized assortments such as abs, abm and abl.',
          groupRows.map((row) => row.cells.var || row.cells.group)
        )
    }
  const picColumns = columns.get('pic') || []
  for (const image of sheet.images || []) {
    let affected = rows.filter((row) =>
      picColumns.some((col) => covered(image, row.row, col))
    )
    // A picture anchored to the top of a merged cell belongs to that explicitly merged range.
    for (const merge of sheet.merges || [])
      if (
        image.from &&
        image.from.row >= merge.from.row &&
        image.from.row <= merge.to.row &&
        picColumns.some(
          (col) =>
            col >= merge.from.col &&
            col <= merge.to.col &&
            image.from.col >= merge.from.col &&
            image.from.col <= merge.to.col
        )
      )
        affected.push(
          ...rows.filter(
            (row) => row.row >= merge.from.row && row.row <= merge.to.row
          )
        )
    affected = [...new Set(affected)]
    if (!affected.length) continue
    if (new Set(affected.map((row) => row.group)).size > 1) {
      issue(
        'error',
        'photo-cross-group',
        'One picture overlaps different groups. Anchor separate pictures to the correct product rows in Excel before importing.',
        affected.map((row) => row.cells.pic)
      )
      continue
    }
    if (!image.dataUrl || image.unresolved) {
      issue(
        'error',
        'photo-unresolved',
        'This picture is not embedded as a readable raster image. Paste the picture into its product row in Excel.',
        affected.map((row) => row.cells.pic)
      )
      continue
    }
    const shared = groups.get(affected[0].group) || affected
    if (shared.length > 1 && affected.length > 1)
      issue(
        'review',
        'photo-shared',
        'This picture spans several rows of one group. Confirm that the group shares this picture.',
        affected.map((row) => row.cells.pic)
      )
    for (const row of affected)
      if (!row.photos.includes(image.dataUrl)) row.photos.push(image.dataUrl)
  }
  for (const row of rows)
    if (!row.photos.length)
      issue(
        'error',
        'photo-missing',
        'Every included product row needs an embedded picture anchored to its pic cell or a merged pic cell within its group.',
        [row.cells.pic].filter(Boolean),
        row.row
      )
  const computedTotal = centsToMoney(
    rows.reduce(
      (sum, row) =>
        sum + (row.calculatedAmount ? moneyToCents(row.calculatedAmount) : 0n),
      0n
    )
  )
  const total = pairs.length === 1 ? pairs[0].value : null
  if (total !== null && computedTotal !== total)
    issue(
      'error',
      'total-mismatch',
      'The product rows total ¥{computedTotal}, but the whole-order total control is ¥{total}. Correct the source values before importing.',
      pairs[0].cells,
      undefined,
      { computedTotal, total }
    )
  return {
    filename: workbook.filename,
    sheetName,
    store: parseStoreFilename(workbook.filename),
    markerRow: markerRow?.row || null,
    rows,
    issues,
    total,
    computedTotal,
    skippedRows,
    groupCount: groups.size,
  }
}
