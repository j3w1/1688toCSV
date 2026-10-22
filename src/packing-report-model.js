import {
  canonical,
  keyFor,
  issue,
  decimal,
  sum,
  multiply,
  difference,
  multiset,
  cellRef,
  clone,
  limitsFor,
} from './packing-report-utils.js'

const BASES = ['per-carton', 'combined-set', 'unknown']
function uniqueIssues(values) {
  const result = new Map()
  for (const value of values) {
    if (!result.has(value.id)) result.set(value.id, clone(value))
    else {
      const prior = result.get(value.id),
        refs = new Map(
          [...prior.sourceRefs, ...value.sourceRefs].map((ref) => [
            canonical(ref),
            ref,
          ])
        )
      prior.sourceRefs = [...refs.values()]
    }
  }
  return [...result.values()]
}
const ROLES = [
  'label',
  'code',
  'quantity',
  'count',
  'dimensions',
  'weight',
  'volume',
  'section',
  'ignore',
]
const present = (cell) =>
  cell && cell.raw !== null && String(cell.raw).trim() !== ''
const textOf = (cell) => String(cell?.display ?? cell?.raw ?? '').trim()
const knownBasis = (text) =>
  /每箱|per\s*(?:carton|box)|\/\s*(?:ctn|carton|box)/i.test(text)
    ? 'per-carton'
    : /总|合计|total|combined/i.test(text)
      ? 'combined-set'
      : null
function knownUnit(text, kind) {
  if (kind === 'weight')
    return /(?:(?:^|[^a-z])kg(?:$|[^a-z])|k\.g\.|公斤|千克)/i.test(text)
      ? 'kg'
      : /(?:(?:^|[^a-z])g(?:$|[^a-z])|克)/i.test(text)
        ? 'g'
        : null
  if (kind === 'dimensions')
    return /(?:^|[^a-z])mm(?:$|[^a-z])|毫米/i.test(text)
      ? 'mm'
      : /(?:^|[^a-z])cm(?:$|[^a-z])|厘米/i.test(text)
        ? 'cm'
        : /(?:^|[^a-z])m(?:$|[^a-z0-9³²])|米/i.test(text)
          ? 'm'
          : null
  return /m[³3]|cbm|立方米/i.test(text) ? 'm3' : null
}
function heading(value) {
  const text = value.toLowerCase().trim()
  if (/箱号|carton\s*(?:no\.?|number|#)|box\s*(?:no\.?|#)/i.test(text))
    return 'label'
  if (/货号|article|product\s*code|sku|^code$/i.test(text)) return 'code'
  if (/^箱数|carton\s*count|boxes|^count$/i.test(text)) return 'count'
  if (/装箱数|件数|数量|pieces|packing\s*quantity|qty|quantity|pcs/i.test(text))
    return 'quantity'
  if (/尺寸|dimension|^size/i.test(text)) return 'dimensions'
  if (/体积|volume|cbm|m[³3]/i.test(text)) return 'volume'
  if (/重量|weight|\bkg\b|k\.g\./i.test(text)) return 'weight'
  if (/section|分组|段落/i.test(text)) return 'section'
  return null
}
function orderKey(context = {}) {
  return { accountId: context.accountId, orderId: context.orderId }
}
function revisions(context = {}) {
  return {
    sourceRevision: context.sourceRevision,
    preparationRevision: context.preparationRevision ?? null,
  }
}
function validContext(context) {
  if (
    !context ||
    typeof context.orderId !== 'string' ||
    !context.orderId ||
    typeof context.accountId !== 'string' ||
    !context.accountId ||
    !Number.isSafeInteger(context.sourceRevision) ||
    context.sourceRevision < 0 ||
    !(
      context.preparationRevision == null ||
      (Number.isSafeInteger(context.preparationRevision) &&
        context.preparationRevision >= 0)
    ) ||
    !Array.isArray(context.products)
  )
    throw new Error('Select an existing 1688 order context')
  if (context.sourceType && context.sourceType !== '1688')
    throw new Error('Packing reports require a 1688 order')
  const ids = new Set()
  for (const product of context.products) {
    if (
      typeof product.entryId !== 'string' ||
      !product.entryId ||
      ids.has(product.entryId) ||
      typeof product.purchased !== 'string' ||
      !/^\d{1,30}$/.test(product.purchased) ||
      ['ceCodes', 'supplierCodes'].some(
        (key) =>
          product[key] !== undefined &&
          (!Array.isArray(product[key]) ||
            product[key].some((code) => typeof code !== 'string'))
      ) ||
      (product.orderId && product.orderId !== context.orderId) ||
      (product.accountId && product.accountId !== context.accountId)
    )
      throw new Error('Invalid order-local report dictionary')
    ids.add(product.entryId)
  }
}

/** Stable requests are bound to their exact premise; an acknowledgment is no interpretation. */
export function analyzePackingReport({
  source,
  context,
  selection,
  decisions = {},
  parserVersion = '1',
  limits,
} = {}) {
  const issues = [],
    decisionRequests = [],
    candidates = [],
    facts = [],
    declaredTotals = {},
    setCoverageClaims = [],
    bounds = limitsFor(limits)
  let validOrder = false
  const addIssue = (code, severity, scope, params, refs) => {
    const result = issue(code, severity, scope, params, refs)
    issues.push(result)
    return result
  }
  const choose = (code, scope, params, refs, accepts) => {
    const request = issue(code, 'decision', scope, params, refs)
    const answer = decisions[request.id]
    if (
      answer &&
      canonical(answer.scope) === canonical(scope) &&
      accepts(answer.value)
    )
      return answer.value
    issues.push(request)
    decisionRequests.push(request)
    return undefined
  }
  const result = () => ({
    analysisId: keyFor('analysis', [
      source?.sourceId,
      source?.rawDigest,
      orderKey(context || {}),
      selection,
      decisions,
      parserVersion,
    ]),
    sourceId: source?.sourceId,
    candidates,
    facts,
    issues: uniqueIssues(issues),
    coverage: {
      ...(validOrder ? coverageOf(candidates, context.products) : {}),
      completeSetCoverage: setCoverageClaims[0] || null,
    },
    declaredTotals,
    decisionRequests: uniqueIssues(decisionRequests),
    parserVersion,
    contextRevisions: context ? revisions(context) : null,
    // Reanalysis at validation prevents a saved acknowledgment or edited result from bypassing parsing.
    input: clone({ source, context, selection, parserVersion, limits }),
    decisions: clone(decisions),
  })
  try {
    validContext(context)
    validOrder = true
  } catch (error) {
    addIssue('invalidContext', 'error', {}, { reason: error.message })
    return result()
  }
  if (
    !Array.isArray(source?.sheets) ||
    !source.sheets.length ||
    !source.rawAssetRef ||
    !source.rawDigest ||
    source.sheets.some((sheet) => !Array.isArray(sheet.cells))
  ) {
    addIssue('invalidSource', 'error', {}, {})
    return result()
  }
  if (
    source.sheets.some(
      (sheet) =>
        new Set(sheet.cells.map((cell) => `${cell.row}:${cell.col}`)).size !==
          sheet.cells.length ||
        sheet.cells.some(
          (cell) =>
            !Number.isSafeInteger(cell.row) ||
            cell.row < 1 ||
            !Number.isSafeInteger(cell.col) ||
            cell.col < 1 ||
            ![null, 'string', 'number', 'boolean'].includes(
              cell.raw === null ? null : typeof cell.raw
            )
        )
    )
  ) {
    addIssue('invalidStructure', 'error', { sourceId: source.sourceId }, {})
    return result()
  }
  let sheet = source.sheets.find((item) => item.name === selection?.sheetName)
  if (!sheet) {
    if (source.sheets.length === 1 && !selection?.sheetName)
      sheet = source.sheets[0]
    else {
      const name = choose(
        'selectSheet',
        {
          sourceId: source.sourceId,
          sheets: source.sheets.map((item) => item.name),
        },
        {},
        [],
        (value) => source.sheets.some((item) => item.name === value)
      )
      sheet = source.sheets.find((item) => item.name === name)
      if (!sheet) return result()
    }
  }
  if (
    source.sheets.length > bounds.sheets ||
    source.sheets.reduce((n, item) => n + item.cells.length, 0) >
      bounds.cells ||
    sheet.cells.some(
      (cell) =>
        cell.col > bounds.columns ||
        cell.row > bounds.rows + 1 ||
        String(cell.raw ?? '').length > bounds.cellText
    )
  ) {
    addIssue('sourceLimit', 'error', { sourceId: source.sourceId }, {})
    return result()
  }
  const rowMap = new Map()
  for (const cell of sheet.cells) {
    if (!rowMap.has(cell.row)) rowMap.set(cell.row, [])
    rowMap.get(cell.row).push(cell)
  }
  const rows = [...rowMap.keys()].sort((a, b) => a - b)
  const cellsAt = (row) => rowMap.get(row).sort((a, b) => a.col - b.col)
  const likelyHeaders = rows.filter(
    (row) => cellsAt(row).filter((cell) => heading(textOf(cell))).length >= 2
  )
  let headerRow = selection?.headerRow
  if (headerRow === undefined || headerRow === null) {
    // Repeated identical headers are evidence; different plausible tables require selection.
    const distinct = [
      ...new Set(
        likelyHeaders.map((row) =>
          canonical(cellsAt(row).map((cell) => [cell.col, textOf(cell)]))
        )
      ),
    ]
    if (distinct.length === 1) headerRow = likelyHeaders[0]
    else
      headerRow = choose(
        'selectTable',
        {
          sourceId: source.sourceId,
          sheet: sheet.name,
          headers: likelyHeaders.map((row) => cellsAt(row)),
        },
        { headerRows: likelyHeaders },
        [],
        (value) => Number.isSafeInteger(value) && rows.includes(value)
      )
  }
  if (headerRow === undefined || (headerRow !== 0 && !rows.includes(headerRow)))
    return result()
  if (headerRow === 0 && !selection?.columns) {
    addIssue('headerlessMapping', 'error', {}, {})
    return result()
  }
  if (
    (selection &&
      ['fromRow', 'toRow'].some(
        (key) =>
          selection[key] !== undefined &&
          (!Number.isSafeInteger(selection[key]) ||
            selection[key] < 1 ||
            selection[key] > bounds.rows + 1)
      )) ||
    selection?.fromRow > selection?.toRow
  ) {
    addIssue('invalidRegion', 'error', {}, {})
    return result()
  }
  const headers =
      headerRow === 0
        ? Object.keys(selection.columns).map((col) => ({
            sheet: sheet.name,
            col: Number(col),
            row: 0,
            address: '',
            raw: `Column ${col}`,
          }))
        : cellsAt(headerRow),
    columns = []
  for (const header of headers) {
    if (!present(header)) continue
    const scope = {
      sheet: sheet.name,
      col: header.col,
      header: header.raw,
      display: header.display,
    }
    let role = selection?.columns?.[header.col] || heading(textOf(header))
    if (role && !ROLES.includes(role)) {
      addIssue('invalidColumn', 'error', scope, {})
      continue
    }
    if (!role)
      role = choose(
        'columnRole',
        scope,
        { roles: ROLES },
        [cellRef(header)],
        (value) => ROLES.includes(value)
      )
    if (role) columns.push({ header, role, scope })
  }
  for (const role of ROLES.filter((item) => item !== 'ignore')) {
    const duplicates = columns.filter((column) => column.role === role)
    if (duplicates.length > 1)
      addIssue(
        'duplicateColumn',
        'error',
        { role, columns: duplicates.map((column) => column.scope) },
        {}
      )
  }
  if (
    !columns.some((column) =>
      ['quantity', 'count', 'label', 'weight', 'volume', 'dimensions'].includes(
        column.role
      )
    )
  )
    addIssue('missingQuantity', 'error', { sheet: sheet.name, headerRow }, {})
  const numeric = (cell, whole, column) => {
    const refs = cell ? [cellRef(cell)] : []
    if ((cell?.formula && cell.raw == null) || cell?.error) {
      addIssue('formulaCache', 'error', cell, {}, refs)
      return null
    }
    if (!present(cell)) return null
    if (
      cell.error ||
      (cell.formula &&
        (typeof cell.raw !== 'number' || (cell.type && cell.type !== 'n')))
    ) {
      addIssue('formulaCache', 'error', cell, {}, refs)
      return null
    }
    let token
    if (typeof cell.raw === 'number') {
      if (
        !Number.isFinite(cell.raw) ||
        cell.raw < 0 ||
        (whole && !Number.isSafeInteger(cell.raw))
      ) {
        addIssue('invalidNumber', 'error', cell, {}, refs)
        return null
      }
      token = String(cell.raw)
      if (/e/i.test(token)) {
        // Expand the decoder's numeric cache, never its localized display.
        const [coefficient, exponent] = token.toLowerCase().split('e'),
          [a, b = ''] = coefficient.split('.')
        const digits = a + b,
          point = a.length + Number(exponent)
        token =
          point <= 0
            ? `0.${'0'.repeat(-point)}${digits}`
            : point >= digits.length
              ? digits + '0'.repeat(point - digits.length)
              : `${digits.slice(0, point)}.${digits.slice(point)}`
      }
    } else {
      const match = String(cell.raw)
        .trim()
        .match(/^(\d[\d.,]*|\.\d+)\s*([^\d.,]*)$/u)
      if (!match) {
        addIssue('invalidNumber', 'error', cell, {}, refs)
        return null
      }
      token = match[1]
      if (token.includes(',')) {
        const locale = choose(
          'numericLocale',
          { ...column.scope, role: column.role },
          { example: token, choices: ['decimal-dot', 'decimal-comma'] },
          refs,
          (value) => ['decimal-dot', 'decimal-comma'].includes(value)
        )
        if (!locale) return null
        if (locale === 'decimal-dot') {
          if (!/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(token)) {
            addIssue('invalidNumber', 'error', cell, {}, refs)
            return null
          }
          token = token.replaceAll(',', '')
        } else {
          if (
            !/^\d+(?:,\d+)?$/.test(token) &&
            !/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(token)
          ) {
            addIssue('invalidNumber', 'error', cell, {}, refs)
            return null
          }
          token = token.replaceAll('.', '').replace(',', '.')
        }
      }
    }
    try {
      const value = decimal(token.startsWith('.') ? `0${token}` : token)
      if (
        whole &&
        (!/^\d{1,30}$/.test(value) ||
          (column.role === 'count' && !Number.isSafeInteger(Number(value))))
      )
        throw new Error()
      return value
    } catch {
      addIssue('invalidNumber', 'error', cell, {}, refs)
      return null
    }
  }
  const basisFor = (cell, column, count) => {
    const cellBasis = knownBasis(String(cell.raw)),
      headerBasis = knownBasis(textOf(column.header))
    if (cellBasis && headerBasis && cellBasis !== headerBasis)
      return (
        choose(
          'basisConflict',
          { column: column.scope, cell },
          { choices: BASES },
          [cellRef(cell)],
          (value) => BASES.includes(value)
        ) || 'unknown'
      )
    return (
      cellBasis ||
      headerBasis ||
      choose(
        'measurementBasis',
        { ...column.scope, role: column.role },
        { choices: BASES, count },
        [cellRef(column.header)],
        (value) => BASES.includes(value)
      ) ||
      'unknown'
    )
  }
  const unitFor = (cell, column, kind) => {
    const cellUnit =
      typeof cell.raw === 'number' ? null : knownUnit(String(cell.raw), kind)
    const headerUnit = knownUnit(textOf(column.header), kind)
    const suffix =
      typeof cell.raw === 'string'
        ? cell.raw
            .trim()
            .match(/^[\d.,×x*\s]+(.*)$/iu)?.[1]
            ?.trim()
        : ''
    if (
      suffix &&
      !cellUnit &&
      !/^(?:total|combined|per\s*(?:carton|box)|每箱|总|合计)$/i.test(suffix)
    ) {
      const kept = choose(
        'unsupportedUnit',
        { column: column.scope, cell, kind },
        { unit: suffix, choices: ['retain-unknown'] },
        [cellRef(cell)],
        (value) => value === 'retain-unknown'
      )
      return kept ? 'unknown' : undefined
    }
    const units =
      kind === 'weight'
        ? ['g', 'kg']
        : kind === 'dimensions'
          ? ['mm', 'cm', 'm']
          : ['m3']
    if (cellUnit && headerUnit && cellUnit !== headerUnit)
      return choose(
        'unitConflict',
        { column: column.scope, cell, kind },
        { choices: units },
        [cellRef(cell)],
        (value) => units.includes(value)
      )
    return (
      cellUnit ||
      headerUnit ||
      choose(
        'measurementUnit',
        { ...column.scope, kind },
        { choices: units },
        [cellRef(column.header)],
        (value) => units.includes(value)
      )
    )
  }
  const identifier = (cell, column) => {
    if (cell?.error || (cell?.formula && cell.raw == null)) {
      addIssue('formulaCache', 'error', cell, {}, [cellRef(cell)])
      return null
    }
    if (!present(cell)) return null
    if (cell.error || (cell.formula && cell.raw == null)) {
      addIssue('formulaCache', 'error', cell, {}, [cellRef(cell)])
      return null
    }
    if (
      typeof cell.raw === 'number' &&
      (!Number.isSafeInteger(cell.raw) ||
        String(Math.trunc(cell.raw)).length > 15)
    )
      return (
        choose(
          'lossyIdentifier',
          { cell, column: column.scope },
          {},
          [cellRef(cell)],
          (value) => typeof value === 'string' && !!value.trim()
        ) || textOf(cell)
      )
    return textOf(cell)
  }
  const claimFor = (code, quantity, basis, refs) => {
    const matches = context.products.filter((product) =>
      [...(product.ceCodes || []), ...(product.supplierCodes || [])].includes(
        code
      )
    )
    let entries = matches,
      interpreted = false
    if (
      !matches.length ||
      (matches.length > 1 &&
        new Set(matches.map((product) => product.groupId)).size > 1)
    ) {
      const scope = {
        orderKey: orderKey(context),
        code,
        products: context.products.map(
          ({ entryId, groupId, ceCodes, supplierCodes }) => ({
            entryId,
            groupId,
            ceCodes,
            supplierCodes,
          })
        ),
      }
      const answer = decisions[keyFor('codeAlias', scope)]
      if (answer && canonical(answer.scope) === canonical(scope)) {
        const value = answer.value
        if (
          !value ||
          (value.orderId && value.orderId !== context.orderId) ||
          (value.accountId && value.accountId !== context.accountId) ||
          !Array.isArray(value.entryIds) ||
          !value.entryIds.length ||
          new Set(value.entryIds).size !== value.entryIds.length ||
          value.entryIds.some(
            (id) => !context.products.some((product) => product.entryId === id)
          ) ||
          new Set(
            context.products
              .filter((product) => value.entryIds.includes(product.entryId))
              .map((product) => product.groupId)
          ).size !== 1
        ) {
          addIssue('invalidAlias', 'error', scope, {}, refs)
          entries = []
        } else {
          entries = context.products.filter((product) =>
            value.entryIds.includes(product.entryId)
          )
          interpreted = true
        }
      } else if (code) {
        const request = issue('codeAlias', 'unresolved', scope, { code }, refs)
        issues.push(request)
        decisionRequests.push({ ...request, optional: true })
        entries = []
      }
    }
    const entryIds = entries.map((product) => product.entryId).sort()
    const groupId =
      entries.length &&
      entries.every((entry) => entry.groupId === entries[0].groupId)
        ? entries[0].groupId
        : null
    if (entryIds.length !== 1)
      addIssue(
        'unresolvedContents',
        'unresolved',
        { code, entryIds, groupId, quantity, basis, refs },
        {},
        refs
      )
    return {
      kind: entryIds.length === 1 ? 'entry' : groupId ? 'group' : 'unknown',
      entryIds,
      groupId: groupId || null,
      supplierCode: code,
      quantity,
      basis,
      sourceRefs: refs,
      provenance: interpreted ? 'operator-interpreted' : 'reported',
    }
  }
  let entitlementCount = 0
  for (const row of rows.filter(
    (row) =>
      row > headerRow &&
      row >= (selection?.fromRow || headerRow + 1) &&
      row <= (selection?.toRow || Infinity)
  )) {
    const rowCells = cellsAt(row),
      byRole = Object.fromEntries(
        columns.map((column) => [
          column.role,
          {
            cell: rowCells.find((cell) => cell.col === column.header.col),
            column,
          },
        ])
      )
    // A formula/error cell is selected evidence even when its display is blank.
    // Check mapped roles before optional defaults and note/total shortcuts.
    const invalidCaches = columns
      .filter((column) => column.role !== 'ignore')
      .map((column) => rowCells.find((cell) => cell.col === column.header.col))
      .filter((cell) => cell?.error || (cell?.formula && cell.raw == null))
    if (invalidCaches.length) {
      for (const cell of invalidCaches)
        addIssue('formulaCache', 'error', cell, {}, [cellRef(cell)])
      continue
    }
    if (!rowCells.some(present)) continue
    if (
      rowCells.filter(present).length === 1 &&
      /^(?:notes?\b|备注|说明)/i.test(textOf(rowCells.find(present)))
    ) {
      addIssue(
        'ignoredNote',
        'warning',
        { row, sheet: sheet.name },
        {},
        rowCells.map(cellRef)
      )
      continue
    }
    if (
      canonical(rowCells.map((cell) => [cell.col, textOf(cell)])) ===
      canonical(headers.map((cell) => [cell.col, textOf(cell)]))
    ) {
      addIssue(
        'repeatedHeader',
        'warning',
        { sheet: sheet.name, row },
        {},
        rowCells.map(cellRef)
      )
      continue
    }
    let listIndex = null
    const get = (role) => {
      const cell = byRole[role]?.cell
      if (
        listIndex !== null &&
        typeof cell?.raw === 'string' &&
        cell.raw.includes(';')
      )
        return {
          ...cell,
          raw: cell.raw.split(';')[listIndex].trim(),
          interpretedFrom: cell.raw,
        }
      return cell
    }
    const roleNumber = (role, whole) =>
      byRole[role] ? numeric(get(role), whole, byRole[role].column) : null
    const refs = rowCells.map(cellRef)
    const isTotal = rowCells.some((cell) =>
      /^(?:合计|总计|total)\s*[:：]?$/i.test(textOf(cell))
    )
    if (isTotal) {
      for (const role of ['count', 'quantity', 'weight', 'volume']) {
        if (
          !present(get(role)) ||
          /^(?:合计|总计|total)\s*[:：]?$/i.test(textOf(get(role)))
        )
          continue
        const value = roleNumber(role, role === 'count' || role === 'quantity')
        if (value !== null) {
          if (declaredTotals[role] !== undefined)
            addIssue('duplicateTotal', 'error', { role, row }, {}, refs)
          declaredTotals[role] = value
        }
      }
      continue
    }
    if (
      !present(get('quantity')) &&
      !present(get('label')) &&
      !['count', 'weight', 'volume', 'dimensions'].some((role) =>
        present(get(role))
      )
    ) {
      addIssue('ignoredNote', 'warning', { row, sheet: sheet.name }, {}, refs)
      continue
    }
    const label = byRole.label
      ? identifier(get('label'), byRole.label.column)
      : null
    const code = byRole.code
      ? identifier(get('code'), byRole.code.column)
      : null
    const scope = { sheet: sheet.name, row, evidence: rowCells }
    const baseCandidateKey = keyFor('candidate', scope)
    let count = present(get('count')) ? roleNumber('count', true) : '1'
    if (
      count !== null &&
      (BigInt(count) > BigInt(bounds.entitlements) || count === '0')
    ) {
      addIssue('invalidCount', 'error', scope, {}, refs)
      count = null
    }
    let labels = label ? [label] : []
    if (label && /\d\s*[–—\-/,，]\s*[^\d]*\d/.test(label)) {
      const range = label.match(/^([^\d]*)(\d+)\s*[-–—]\s*([^\d]*)(\d+)$/u)
      let proposed = null
      if (
        range &&
        (!range[3] || range[1] === range[3]) &&
        range[2].length === range[4].length &&
        BigInt(range[4]) >= BigInt(range[2]) &&
        BigInt(range[4]) - BigInt(range[2]) < BigInt(bounds.entitlements)
      )
        proposed = Array.from(
          { length: Number(BigInt(range[4]) - BigInt(range[2]) + 1n) },
          (_, index) =>
            `${range[1]}${String(BigInt(range[2]) + BigInt(index)).padStart(range[2].length, '0')}`
        )
      const answer = choose(
        'cartonRange',
        { label, cell: get('label') },
        { proposed },
        refs,
        (value) =>
          value &&
          Array.isArray(value.labels) &&
          value.labels.length > 0 &&
          value.labels.length <= bounds.entitlements &&
          new Set(value.labels).size === value.labels.length &&
          value.labels.every(
            (item) =>
              typeof item === 'string' && item.trim() && !/[\r\n]/.test(item)
          )
      )
      if (answer) {
        labels = answer.labels
        if (present(get('count')) && count !== String(labels.length))
          addIssue(
            'rangeCountMismatch',
            'error',
            scope,
            { count, labels },
            refs
          )
        count = String(labels.length)
      } else {
        labels = []
        count = count === '1' ? null : count
      }
    }
    if (count !== null) entitlementCount += Number(count)
    if (entitlementCount > bounds.entitlements) {
      addIssue('entitlementLimit', 'error', scope, {}, refs)
      break
    }
    const listCells = ['quantity', 'weight', 'volume', 'dimensions']
      .map(get)
      .filter((cell) => typeof cell?.raw === 'string' && cell.raw.includes(';'))
    let aligned = false
    if (listCells.length) {
      if (
        count === null ||
        listCells.some((cell) => cell.raw.split(';').length !== Number(count))
      )
        addIssue('unalignedLists', 'error', scope, {}, refs)
      else
        aligned =
          choose(
            'alignedLists',
            { evidence: rowCells, labels, count },
            { count },
            refs,
            (value) => value === true
          ) === true
      if (!aligned) continue
    }
    const setCount = count,
      setLabels = labels
    for (let member = 0; member < (aligned ? Number(setCount) : 1); member++) {
      listIndex = aligned ? member : null
      count = aligned ? '1' : setCount
      labels = aligned ? [setLabels[member]].filter(Boolean) : setLabels
      const candidateLabel = aligned ? labels[0] || null : label
      const candidateKey = aligned
        ? `${baseCandidateKey}:member:${member}`
        : baseCandidateKey
      const quantity = roleNumber('quantity', true)
      if (quantity === null && !present(get('quantity')))
        addIssue('unknownQuantity', 'unresolved', scope, {}, refs)
      const quantityBasis =
        byRole.quantity && present(get('quantity'))
          ? basisFor(get('quantity'), byRole.quantity.column, count)
          : 'unknown'
      const measurementFacts = []
      const fact = (
        field,
        value,
        unit,
        basis,
        cell,
        provenance = 'reported',
        derivedFrom
      ) => {
        const item = {
          factId: keyFor('fact', [candidateKey, field, cell]),
          field,
          value,
          unit,
          basis,
          sourceRefs: [cellRef(cell)],
          provenance: cell.formula ? 'reported-cached-formula' : provenance,
          ...(derivedFrom ? { derivedFrom } : {}),
        }
        measurementFacts.push(item)
        facts.push(item)
        return item
      }
      for (const role of ['dimensions', 'weight', 'volume']) {
        const cell = get(role)
        if ((cell?.formula && cell.raw == null) || cell?.error) {
          addIssue('formulaCache', 'error', cell, {}, [cellRef(cell)])
          continue
        }
        if (!present(cell)) continue
        const column = byRole[role].column
        if (cell.error || (cell.formula && typeof cell.raw !== 'number')) {
          addIssue('formulaCache', 'error', cell, {}, [cellRef(cell)])
          continue
        }
        const tuple = typeof cell.raw === 'string' && /[×x*]/i.test(cell.raw)
        if (role === 'dimensions' || tuple) {
          const match = String(cell.raw)
            .trim()
            .match(
              /^(\d+(?:[.,]\d+)?)\s*[×x*]\s*(\d+(?:[.,]\d+)?)\s*[×x*]\s*(\d+(?:[.,]\d+)?)\s*([^\d]*)$/iu
            )
          if (!match) {
            addIssue('invalidDimensions', 'error', cell, {}, [cellRef(cell)])
            continue
          }
          const unit = unitFor(cell, column, 'dimensions'),
            basis = basisFor(cell, column, count)
          const values = match
            .slice(1, 4)
            .map((raw) =>
              numeric({ ...cell, raw, formula: undefined }, false, column)
            )
          if (values.some((value) => value === null || value === '0')) {
            addIssue('invalidDimensions', 'error', cell, {}, [cellRef(cell)])
            continue
          }
          if (unit === 'unknown') {
            fact(
              'unresolvedDimensions',
              String(cell.raw),
              'unknown',
              basis,
              cell
            )
            continue
          }
          if (unit) {
            const dimensions = values.map((value) =>
              multiply([
                value,
                unit === 'mm' ? '0.1' : unit === 'm' ? '100' : '1',
              ])
            )
            const dimensionFact = fact(
              'dimensions',
              dimensions,
              'cm',
              basis,
              cell,
              'operator-interpreted'
            )
            fact(
              'calculatedVolume',
              multiply(dimensions, 6),
              'm3',
              basis,
              cell,
              'calculated',
              [dimensionFact.factId]
            )
          }
        } else {
          const value = numeric(cell, false, column),
            kind = role === 'weight' ? 'weight' : 'volume'
          const unit = unitFor(cell, column, kind),
            basis = basisFor(cell, column, count)
          if (value !== null && unit)
            fact(
              role,
              role === 'weight' && unit === 'g'
                ? multiply([value, '0.001'])
                : value,
              unit === 'unknown' ? 'unknown' : role === 'weight' ? 'kg' : 'm3',
              basis,
              cell
            )
        }
      }
      const dimensionsVolume = measurementFacts.find(
          (item) => item.field === 'calculatedVolume'
        ),
        suppliedVolume = measurementFacts.find(
          (item) => item.field === 'volume'
        )
      if (
        dimensionsVolume &&
        suppliedVolume &&
        dimensionsVolume.basis === suppliedVolume.basis &&
        dimensionsVolume.value !== suppliedVolume.value
      )
        addIssue(
          'volumeDiscrepancy',
          'warning',
          scope,
          {
            calculated: dimensionsVolume.value,
            supplied: suppliedVolume.value,
          },
          refs
        )
      const contentClaims = [claimFor(code, quantity, quantityBasis, refs)]
      // Even equal division does not establish uniformity. Only explicit per-carton claims do.
      candidates.push({
        candidateKey,
        supplierLabel: candidateLabel,
        labelOrigin: candidateLabel ? 'reported' : 'internal',
        sourceRefs: refs,
        sectionRef: textOf(get('section')) || null,
        count: count === null ? null : Number(count),
        entitlementRefs: Array.from(
          { length: count === null ? 0 : Number(count) },
          (_, index) => ({
            key: `${candidateKey}:${index}`,
            index,
            supplierLabel:
              labels.length === Number(count) ? labels[index] : null,
          })
        ),
        contentClaims,
        measurementFacts,
        packingBasis:
          count === '1'
            ? 'exact'
            : quantityBasis === 'per-carton' &&
                contentClaims.every((claim) => claim.kind === 'entry')
              ? 'uniform'
              : 'aggregate',
        ...(aligned
          ? {
              alignedSet: {
                sourceCandidateKey: baseCandidateKey,
                count: Number(setCount),
                index: member,
              },
            }
          : {}),
      })
    }
  }
  // Duplicate/overlapping numbers never merge from code+label equality.
  const numbered = new Map()
  for (const candidate of candidates)
    for (const label of new Set(
      [
        candidate.supplierLabel,
        ...candidate.entitlementRefs.map((item) => item.supplierLabel),
      ].filter(Boolean)
    )) {
      const key = canonical([candidate.sectionRef, label])
      if (!numbered.has(key)) numbered.set(key, [])
      numbered.get(key).push(candidate)
    }
  for (const [label, duplicates] of numbered) {
    if (duplicates.length < 2) continue
    const mode = choose(
      'repeatedLabel',
      {
        label,
        candidates: duplicates.map((item) => ({
          key: item.candidateKey,
          refs: item.sourceRefs,
        })),
      },
      { choices: ['separate', 'contents'] },
      duplicates.flatMap((item) => item.sourceRefs),
      (value) => ['separate', 'contents'].includes(value)
    )
    if (mode === 'contents') {
      const first = duplicates[0]
      const signature = (candidate) =>
        canonical(
          candidate.measurementFacts.map(({ field, value, unit, basis }) => ({
            field,
            value,
            unit,
            basis,
          }))
        )
      if (
        duplicates.some(
          (item) => item.count !== 1 || signature(item) !== signature(first)
        )
      ) {
        addIssue(
          'incompatibleContentRows',
          'error',
          { label },
          {},
          duplicates.flatMap((item) => item.sourceRefs)
        )
        continue
      }
      for (const other of duplicates.slice(1)) {
        first.contentClaims.push(...other.contentClaims)
        first.sourceRefs.push(...other.sourceRefs)
        candidates.splice(candidates.indexOf(other), 1)
      }
    }
  }
  const coverage = coverageOf(candidates, context.products)
  if (
    candidates.some((candidate) =>
      candidate.contentClaims.some(
        (claim) => claim.kind !== 'entry' || claim.quantity === null
      )
    )
  ) {
    const scope = {
      orderKey: orderKey(context),
      candidates: candidates.map((candidate) => ({
        candidateKey: candidate.candidateKey,
        facts: reportCandidateSemantic(candidate),
      })),
    }
    const request = issue(
      'completeSetCoverage',
      'unresolved',
      scope,
      {},
      candidates.flatMap((candidate) => candidate.sourceRefs)
    )
    decisionRequests.push({ ...request, optional: true })
    const answer = decisions[request.id]
    if (answer && canonical(answer.scope) === canonical(scope)) {
      const value = answer.value
      const items = value?.contents
      const valid =
        ['owner-confirmed', 'reported'].includes(value?.provenance) &&
        Array.isArray(items) &&
        items.length &&
        new Set(items.map((item) => item.entryId)).size === items.length &&
        items.every(
          (item) =>
            /^[1-9]\d{0,29}$/.test(item.quantity) &&
            context.products.some((product) => product.entryId === item.entryId)
        ) &&
        (value.provenance !== 'reported' ||
          (Array.isArray(value.sourceRefs) &&
            value.sourceRefs.length &&
            value.sourceRefs.every((ref) =>
              sheet.cells.some(
                (cell) => canonical(cellRef(cell)) === canonical(ref)
              )
            )))
      const allClaims = candidates.flatMap((candidate) =>
        candidate.contentClaims.map((claim) => ({
          ...claim,
          total: claimTotal(claim, candidate),
        }))
      )
      const supportedClaims = allClaims.filter((claim) => claim.total !== null)
      const claimedProducts = context.products.map((product) => ({
        ...product,
        purchased:
          (Array.isArray(items) ? items : []).find(
            (item) => item.entryId === product.entryId
          )?.quantity || '0',
      }))
      if (
        !valid ||
        (coverage.pieces !== null &&
          sum(items.map((item) => item.quantity)) !== coverage.pieces) ||
        items.some(
          (item) =>
            !allClaims.some(
              (claim) =>
                !claim.entryIds.length || claim.entryIds.includes(item.entryId)
            )
        ) ||
        !feasibleClaims(supportedClaims, claimedProducts) ||
        items.some(
          (item) =>
            BigInt(item.quantity) >
            BigInt(
              context.products.find(
                (product) => product.entryId === item.entryId
              ).purchased
            )
        )
      )
        addIssue(
          'invalidCompleteCoverage',
          'error',
          scope,
          {},
          request.sourceRefs
        )
      else
        setCoverageClaims.push({
          candidateKeys: candidates.map((candidate) => candidate.candidateKey),
          contents: clone(items),
          provenance: value.provenance,
          sourceRefs: clone(value.sourceRefs || []),
        })
    }
  }
  if (coverage.difference !== null && coverage.difference !== '0')
    addIssue(
      'purchaseDiscrepancy',
      'warning',
      { orderKey: orderKey(context) },
      { difference: coverage.difference }
    )
  if (coverage.feasible === null)
    addIssue('coverageLimit', 'error', { orderKey: orderKey(context) }, {})
  if (coverage.feasible === false)
    addIssue(
      'overcoverage',
      'unresolved',
      { orderKey: orderKey(context) },
      { coverage }
    )
  for (const role of ['quantity', 'weight', 'volume']) {
    const actual = role === 'quantity' ? coverage.pieces : coverage[role].known
    if (
      declaredTotals[role] !== undefined &&
      actual !== null &&
      declaredTotals[role] !== actual
    )
      addIssue(
        'declaredDiscrepancy',
        'warning',
        { orderKey: orderKey(context), role },
        {
          declared: declaredTotals[role],
          actual,
          difference: difference(declaredTotals[role], actual),
        }
      )
  }
  const actualCount = candidates.every((item) => item.count !== null)
    ? String(candidates.reduce((n, item) => n + item.count, 0))
    : null
  if (
    declaredTotals.count !== undefined &&
    actualCount !== null &&
    declaredTotals.count !== actualCount
  )
    addIssue(
      'countDiscrepancy',
      'warning',
      { orderKey: orderKey(context) },
      {
        declared: declaredTotals.count,
        actual: actualCount,
        difference: difference(declaredTotals.count, actualCount),
      }
    )
  return result()
}

function claimTotal(claim, candidate) {
  if (
    claim.quantity === null ||
    (claim.basis === 'unknown' && candidate.count !== 1) ||
    (claim.basis === 'per-carton' && candidate.count === null)
  )
    return null
  return claim.basis === 'per-carton'
    ? multiply([claim.quantity, String(candidate.count)])
    : claim.quantity
}

// Max-flow checks overlapping unknown groups without persisting its arbitrary allocation.
function feasibleClaims(claims, products) {
  if (claims.length * products.length > 1000000) return null
  const capacities = products.map((product) => BigInt(product.purchased))
  const n = 2 + claims.length + products.length,
    sink = n - 1
  const graph = Array.from({ length: n }, () => [])
  const edge = (a, b, capacity) => {
    const forward = { to: b, capacity, reverse: graph[b].length },
      reverse = { to: a, capacity: 0n, reverse: graph[a].length }
    graph[a].push(forward)
    graph[b].push(reverse)
  }
  let required = 0n
  claims.forEach((claim, index) => {
    const quantity = BigInt(claim.total)
    required += quantity
    edge(0, index + 1, quantity)
    products.forEach((product, p) => {
      if (!claim.entryIds.length || claim.entryIds.includes(product.entryId))
        edge(index + 1, 1 + claims.length + p, quantity)
    })
  })
  capacities.forEach((capacity, p) =>
    edge(1 + claims.length + p, sink, capacity)
  )
  let flow = 0n
  while (true) {
    const previous = Array(n).fill(null),
      queue = [0]
    previous[0] = [0, 0]
    for (let q = 0; q < queue.length && !previous[sink]; q++)
      graph[queue[q]].forEach((item, index) => {
        if (item.capacity > 0n && !previous[item.to]) {
          previous[item.to] = [queue[q], index]
          queue.push(item.to)
        }
      })
    if (!previous[sink]) break
    let amount = required
    for (let at = sink; at; at = previous[at][0]) {
      const [from, index] = previous[at]
      if (graph[from][index].capacity < amount)
        amount = graph[from][index].capacity
    }
    for (let at = sink; at; at = previous[at][0]) {
      const [from, index] = previous[at],
        item = graph[from][index]
      item.capacity -= amount
      graph[at][item.reverse].capacity += amount
    }
    flow += amount
  }
  return flow === required
}

function coverageOf(candidates, products) {
  const claims = candidates.flatMap((candidate) =>
    candidate.contentClaims.map((claim) => ({
      ...claim,
      total: claimTotal(claim, candidate),
    }))
  )
  const known = claims.filter((claim) => claim.total !== null)
  const purchased = sum(products.map((product) => product.purchased))
  const pieces = sum(known.map((claim) => claim.total))
  const measurement = (field) => {
    const values = [],
      missing = []
    for (const candidate of candidates) {
      const fact = candidate.measurementFacts.find(
        (fact) =>
          fact.field === field ||
          (field === 'volume' && fact.field === 'calculatedVolume')
      )
      if (
        !fact ||
        fact.unit !== (field === 'weight' ? 'kg' : 'm3') ||
        (fact.basis === 'unknown' && candidate.count !== 1) ||
        (fact.basis === 'per-carton' && candidate.count === null)
      ) {
        missing.push(candidate.candidateKey)
        continue
      }
      values.push(
        fact.basis === 'per-carton'
          ? multiply([fact.value, String(candidate.count)])
          : fact.value
      )
    }
    return { known: values.length ? sum(values) : null, missing }
  }
  return {
    count: candidates.every((candidate) => candidate.count !== null)
      ? candidates.reduce((n, candidate) => n + candidate.count, 0)
      : null,
    pieces: known.length && known.length === claims.length ? pieces : null,
    knownPieces: known.length ? pieces : null,
    purchased,
    difference:
      known.length === claims.length ? difference(purchased, pieces) : null,
    unresolvedPieces: sum(
      known
        .filter((claim) => claim.kind !== 'entry')
        .map((claim) => claim.total)
    ),
    unknownQuantityCandidates: claims.filter((claim) => claim.total === null)
      .length,
    feasible: feasibleClaims(known, products),
    weight: measurement('weight'),
    volume: measurement('volume'),
    // A feasible allocation/equality is not an established complete-set product claim.
    completeSetCoverage: null,
  }
}

export function reportCandidateSemantic(candidate, { mapping = true } = {}) {
  return {
    supplierLabel: candidate.supplierLabel,
    labelOrigin: candidate.labelOrigin,
    sectionRef: candidate.sectionRef,
    count: candidate.count,
    packingBasis: candidate.packingBasis,
    labels: candidate.entitlementRefs.map((item) => item.supplierLabel),
    contentClaims: candidate.contentClaims
      .map(({ kind, entryIds, groupId, supplierCode, quantity, basis }) => ({
        ...(mapping ? { kind, entryIds, groupId } : {}),
        supplierCode,
        quantity,
        basis,
      }))
      .sort((a, b) => canonical(a).localeCompare(canonical(b))),
    measurementFacts: candidate.measurementFacts
      .map(({ field, value, unit, basis }) => ({ field, value, unit, basis }))
      .sort((a, b) => canonical(a).localeCompare(canonical(b))),
  }
}

/** Validate the whole selection, allowing truthful unresolved facts but no partial import. */
export function validatePackingReportReview({
  analysis,
  decisions,
  context,
  previousReportRevision = null,
  expectedContextRevisions,
} = {}) {
  if (!analysis?.input)
    return {
      valid: false,
      unresolved: [],
      issues: [issue('invalidAnalysis', 'error', {}, {})],
    }
  const current = analyzePackingReport({
    ...analysis.input,
    context,
    decisions: decisions ?? analysis.decisions,
  })
  const issues = [...current.issues]
  if (
    canonical(orderKey(context)) !==
      canonical(orderKey(analysis.input.context)) ||
    canonical(revisions(context)) !== canonical(analysis.contextRevisions) ||
    (expectedContextRevisions &&
      ['sourceRevision', 'preparationRevision'].some(
        (key) =>
          key in expectedContextRevisions &&
          expectedContextRevisions[key] !== revisions(context)[key]
      ))
  )
    issues.push(
      issue(
        'staleContext',
        'error',
        { expected: analysis.contextRevisions, actual: revisions(context) },
        {}
      )
    )
  const unresolved = issues.filter((item) => item.severity === 'unresolved')
  const valid =
    current.candidates.length > 0 &&
    !issues.some((item) => ['error', 'decision'].includes(item.severity))
  if (!valid) return { valid, unresolved, issues }
  const candidates = clone(current.candidates)
  const semantics = multiset(
    candidates.map((candidate) =>
      reportCandidateSemantic(candidate, { mapping: false })
    )
  )
  const interpretation = multiset(
    candidates.map((candidate) => reportCandidateSemantic(candidate))
  )
  return {
    valid,
    unresolved,
    issues,
    interpretedReport: {
      schema: 'packing-report/v1',
      storeId: context.storeId || null,
      orderKey: orderKey(context),
      expectedContextRevisions: revisions(context),
      expectedRevisions: clone(
        expectedContextRevisions ??
          context.expectedRevisions ??
          revisions(context)
      ),
      previousReportRevision,
      source: clone(analysis.input.source),
      reviewContext: clone(context),
      parserVersion: current.parserVersion,
      decisions: clone(decisions ?? analysis.decisions),
      selection: clone(analysis.input.selection),
      candidates,
      facts: current.facts,
      unresolved: clone(unresolved),
      declaredTotals: current.declaredTotals,
      coverage: current.coverage,
      semanticFingerprint: canonical(semantics),
      interpretationFingerprint: canonical(interpretation),
    },
  }
}
