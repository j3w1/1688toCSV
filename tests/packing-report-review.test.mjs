import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePackingReportCells } from '../src/packing-report-cells.js'
import {
  analyzePackingReport,
  validatePackingReportReview,
} from '../src/packing-report-model.js'
import {
  runPackingReportAsync,
  createPackingReportClient,
} from '../src/packing-report-client.js'
import { readStoreWorkbookAsync } from '../src/store-workbook-client.js'

const context = {
  accountId: 'local',
  orderId: '1688',
  sourceRevision: 2,
  preparationRevision: 3,
  products: [
    {
      entryId: 'A',
      groupId: 'G',
      purchased: '100',
      ceCodes: ['C'],
      supplierCodes: [],
    },
  ],
}
const sourceOf = (text) =>
  parsePackingReportCells({
    text,
    sourceId: 'source',
    rawAssetRef: 'local-report:x',
    rawDigest: 'synthetic',
  }).source
const source = sourceOf(
  'Carton no\tArticle\tPieces per carton\tWeight per carton kg\n001\tC\t10\t0\n002\tC\t20\t6'
)

test('one bad selected row blocks the entire report; stale order/preparation revisions preserve the draft', () => {
  const invalid = structuredClone(source)
  invalid.sheets[0].cells.find((cell) => cell.address === 'C3').raw =
    '=not-a-number'
  const before = structuredClone(invalid)
  const analysis = analyzePackingReport({ source: invalid, context })
  const review = validatePackingReportReview({ analysis, context })
  assert.equal(review.valid, false)
  assert.equal(review.interpretedReport, undefined)
  assert.deepEqual(invalid, before)
  const valid = analyzePackingReport({ source, context })
  for (const changed of [
    { ...context, sourceRevision: 3 },
    { ...context, preparationRevision: 4 },
    { ...context, orderId: 'wrong' },
  ]) {
    const review = validatePackingReportReview({
      analysis: valid,
      context: changed,
    })
    assert.equal(review.valid, false)
    assert(review.issues.some((issue) => issue.code === 'staleContext'))
  }
  assert.equal(
    validatePackingReportReview({
      analysis: valid,
      context,
      expectedContextRevisions: { sourceRevision: 999 },
    }).valid,
    false
  )
})

test('numeric formulas require usable numeric caches; unused formula evidence never executes or affects facts', () => {
  for (const [raw, type, error, valid] of [
    [10, 'n', undefined, true],
    [null, 'n', undefined, false],
    ['10', 's', undefined, false],
    [false, 'b', undefined, false],
    [7, 'e', '#DIV/0!', false],
  ]) {
    const fixture = structuredClone(source),
      cell = fixture.sheets[0].cells.find((cell) => cell.address === 'C2')
    Object.assign(cell, {
      raw,
      type,
      formula: "'[https://external.invalid/book.xlsx]A'!A1",
      error,
    })
    const analysis = analyzePackingReport({ source: fixture, context })
    const review = validatePackingReportReview({ analysis, context })
    assert.equal(review.valid, valid)
    if (valid)
      assert.equal(
        review.interpretedReport.source.sheets[0].cells.find(
          (cell) => cell.address === 'C2'
        ).formula,
        cell.formula
      )
    else assert(review.issues.some((issue) => issue.code === 'formulaCache'))
  }
  const fixture = structuredClone(source)
  fixture.sheets[0].cells.push({
    sheet: 'Clipboard',
    row: 2,
    col: 8,
    address: 'H2',
    raw: null,
    type: 'n',
    formula: 'REMOTE()',
  })
  const analysis = analyzePackingReport({ source: fixture, context })
  assert.equal(validatePackingReportReview({ analysis, context }).valid, true)
})

test('text, formatted numeric and literal formula-like IDs preserve zeros and do not match numeric aliases', () => {
  const fixture = structuredClone(source)
  Object.assign(
    fixture.sheets[0].cells.find((cell) => cell.address === 'A2'),
    { raw: 1, type: 'n', display: '001', numberFormat: '000' }
  )
  fixture.sheets[0].cells.find((cell) => cell.address === 'A3').raw = '1'
  const analysis = analyzePackingReport({ source: fixture, context })
  assert.deepEqual(
    analysis.candidates.map((candidate) => candidate.supplierLabel),
    ['001', '1']
  )
  for (const label of [
    '000000000000000000000001',
    '=literal',
    '+literal',
    '@literal',
    '<script>bad</script>',
  ]) {
    const analysis = analyzePackingReport({
      source: sourceOf(
        `Carton no\tArticle\tPieces per carton\n${label}\tC\t10`
      ),
      context,
    })
    assert.equal(analysis.candidates[0].supplierLabel, label)
    assert.equal(validatePackingReportReview({ analysis, context }).valid, true)
  }
  const lossy = structuredClone(source)
  Object.assign(
    lossy.sheets[0].cells.find((cell) => cell.address === 'A2'),
    { raw: 1234567890123456, type: 'n' }
  )
  const uncertain = analyzePackingReport({ source: lossy, context })
  assert(
    uncertain.decisionRequests.some(
      (request) => request.code === 'lossyIdentifier'
    )
  )
  assert.equal(
    validatePackingReportReview({ analysis: uncertain, context }).valid,
    false
  )
})

test('alias choices are exact-scope/order-local, may stay unresolved and never rename issued codes', () => {
  const fixture = sourceOf(
    'Carton no\tArticle\tPieces per carton\n001\tOLD\t10'
  )
  const analysis = analyzePackingReport({ source: fixture, context }),
    request = analysis.decisionRequests.find(
      (request) => request.code === 'codeAlias'
    )
  assert(request.optional)
  const unresolved = validatePackingReportReview({ analysis, context })
  assert.equal(unresolved.valid, true)
  assert.equal(
    unresolved.interpretedReport.candidates[0].contentClaims[0].kind,
    'unknown'
  )
  for (const value of [
    { entryIds: ['foreign'] },
    { entryIds: ['A'], orderId: 'linked-order' },
    { entryIds: ['A'], accountId: 'other' },
  ]) {
    const decisions = { [request.id]: { scope: request.scope, value } }
    assert.equal(
      validatePackingReportReview({ analysis, decisions, context }).valid,
      false
    )
  }
  const decisions = {
    [request.id]: {
      scope: request.scope,
      value: { entryIds: ['A'], orderId: '1688' },
    },
  }
  const review = validatePackingReportReview({ analysis, decisions, context })
  assert.equal(review.valid, true)
  assert.equal(
    review.interpretedReport.candidates[0].contentClaims[0].entryIds[0],
    'A'
  )
  assert.deepEqual(context.products[0].ceCodes, ['C'])
  fixture.sheets[0].cells.find((cell) => cell.address === 'B2').raw =
    'DIFFERENT'
  assert.equal(
    analyzePackingReport({ source: fixture, context, decisions }).candidates[0]
      .contentClaims[0].kind,
    'unknown'
  )
})

test('sheets/table/columns are explicit when ambiguous; repeated headers/notes/totals remain source evidence', () => {
  const many = structuredClone(source)
  many.sheets.push({ ...structuredClone(source.sheets[0]), name: 'Another' })
  const ambiguous = analyzePackingReport({ source: many, context })
  assert(
    ambiguous.decisionRequests.some((request) => request.code === 'selectSheet')
  )
  assert.equal(
    validatePackingReportReview({ analysis: ambiguous, context }).valid,
    false
  )
  const chosen = analyzePackingReport({
    source: many,
    context,
    selection: { sheetName: 'Clipboard' },
  })
  assert.equal(
    validatePackingReportReview({ analysis: chosen, context }).valid,
    true
  )
  const fixture = sourceOf(
    'Carton no\tArticle\tTotal pieces\tCarton count\n001\tC\t10\t4\nCarton no\tArticle\tTotal pieces\tCarton count\n002\tC\t20\t4\nTotal\t\t30\t7\nNotes only'
  )
  const analysis = analyzePackingReport({ source: fixture, context })
  assert.equal(analysis.coverage.count, 8)
  assert.equal(analysis.declaredTotals.count, '7')
  assert(
    analysis.issues.some(
      (issue) =>
        issue.code === 'countDiscrepancy' && issue.params.difference === '-1'
    )
  )
  assert(analysis.issues.some((issue) => issue.code === 'repeatedHeader'))
  assert(analysis.issues.some((issue) => issue.code === 'ignoredNote'))
  assert.equal(analysis.input.source.rawText, fixture.rawText)
})

class FakeWorker {
  static instances = []
  constructor(url) {
    this.url = url
    this.listeners = {}
    this.terminated = false
    FakeWorker.instances.push(this)
  }
  addEventListener(type, callback) {
    this.listeners[type] = callback
  }
  postMessage(data, transfers) {
    this.sent = structuredClone(data, { transfer: transfers })
    this.transfers = transfers
  }
  emit(type, data) {
    this.listeners[type]?.({ data })
  }
  terminate() {
    this.terminated = true
  }
}

test('worker generation/abort/error paths terminate; report transfer copies raw bytes before detaching', async () => {
  const previous = globalThis.Worker
  globalThis.Worker = FakeWorker
  try {
    const buffer = Uint8Array.from([1, 2, 3]).buffer
    const promise = runPackingReportAsync({
      operation: 'workbook',
      input: { buffer },
      generation: 4,
    })
    const worker = FakeWorker.instances.at(-1)
    assert.equal(buffer.byteLength, 3)
    assert.equal(worker.sent.input.buffer.byteLength, 3)
    worker.emit('message', { generation: 4, result: { source: 'okay' } })
    assert.deepEqual(await promise, {
      generation: 4,
      result: { source: 'okay' },
    })
    assert(worker.terminated)
    const controller = new AbortController()
    const aborted = runPackingReportAsync({
      operation: 'analyze',
      input: {},
      generation: 5,
      signal: controller.signal,
    })
    const abortedWorker = FakeWorker.instances.at(-1)
    controller.abort()
    await assert.rejects(aborted, { name: 'AbortError' })
    assert(abortedWorker.terminated)
    await assert.rejects(
      runPackingReportAsync({ signal: AbortSignal.abort() }),
      { name: 'AbortError' }
    )
    const stale = runPackingReportAsync({
      operation: 'analyze',
      input: {},
      generation: 6,
    })
    FakeWorker.instances
      .at(-1)
      .emit('message', { generation: 5, result: 'stale' })
    await assert.rejects(stale, { name: 'AbortError' })
    const failed = runPackingReportAsync({
      operation: 'analyze',
      input: {},
      generation: 7,
    })
    FakeWorker.instances.at(-1).emit('error')
    await assert.rejects(failed, /worker failed/)
  } finally {
    globalThis.Worker = previous
  }
})

test('latest-generation client cancels source/sheet/order replacements and cannot return older results', async () => {
  const previous = globalThis.Worker
  globalThis.Worker = FakeWorker
  try {
    const client = createPackingReportClient(),
      old = client.run({ operation: 'analyze', input: { order: 'A' } })
    const oldWorker = FakeWorker.instances.at(-1)
    const next = client.run({ operation: 'analyze', input: { order: 'B' } })
    const worker = FakeWorker.instances.at(-1)
    oldWorker.emit('message', { generation: 1, result: 'old' })
    worker.emit('message', { generation: 2, result: 'new' })
    await assert.rejects(old, { name: 'AbortError' })
    assert.deepEqual(await next, { generation: 2, result: 'new' })
    assert(oldWorker.terminated)
    const pending = client.run({ operation: 'parse', input: { text: 'draft' } })
    client.cancel()
    await assert.rejects(pending, { name: 'AbortError' })
  } finally {
    globalThis.Worker = previous
  }
})

test('shared workbook client opt-in preserves caller bytes/default message contract and terminates on cancellation', async () => {
  const previous = globalThis.Worker
  globalThis.Worker = FakeWorker
  try {
    const buffer = Uint8Array.from([1, 2, 3]).buffer
    const read = readStoreWorkbookAsync(buffer, {
      filename: 'x.xlsx',
      reportEvidence: true,
    })
    const worker = FakeWorker.instances.at(-1)
    assert.equal(buffer.byteLength, 3)
    assert.equal(worker.sent.reportEvidence, true)
    worker.emit('message', { workbook: { filename: 'x.xlsx' } })
    assert.equal((await read).filename, 'x.xlsx')
    assert(worker.terminated)
    const legacy = readStoreWorkbookAsync(Uint8Array.from([1]).buffer, {
      filename: 'legacy.xls',
    })
    const legacyWorker = FakeWorker.instances.at(-1)
    assert.deepEqual(Object.keys(legacyWorker.sent).sort(), [
      'buffer',
      'filename',
    ])
    legacyWorker.emit('message', { workbook: {} })
    await legacy
    const controller = new AbortController()
    const cancelled = readStoreWorkbookAsync(Uint8Array.from([1]).buffer, {
      signal: controller.signal,
    })
    const cancelledWorker = FakeWorker.instances.at(-1)
    controller.abort()
    await assert.rejects(cancelled, { name: 'AbortError' })
    assert(cancelledWorker.terminated)
  } finally {
    globalThis.Worker = previous
  }
})

test('explicit complete-set product coverage is separate from unknown box variants; equality alone is insufficient', () => {
  const ctx = {
    ...context,
    products: [
      {
        entryId: 'S',
        groupId: 'G',
        purchased: '3',
        ceCodes: ['G'],
        supplierCodes: [],
      },
      {
        entryId: 'M',
        groupId: 'G',
        purchased: '30',
        ceCodes: ['G'],
        supplierCodes: [],
      },
      {
        entryId: 'L',
        groupId: 'G',
        purchased: '30',
        ceCodes: ['G'],
        supplierCodes: [],
      },
    ],
  }
  const source = sourceOf(
    'Carton no\tArticle\tTotal pieces\tCarton count\nSET\tG\t63\t6'
  )
  const analysis = analyzePackingReport({ source, context: ctx })
  assert.equal(analysis.coverage.completeSetCoverage, null)
  assert.equal(analysis.coverage.difference, '0')
  const request = analysis.decisionRequests.find(
    (item) => item.code === 'completeSetCoverage'
  )
  const value = {
    provenance: 'owner-confirmed',
    contents: [
      { entryId: 'S', quantity: '3' },
      { entryId: 'M', quantity: '30' },
      { entryId: 'L', quantity: '30' },
    ],
  }
  const review = validatePackingReportReview({
    analysis,
    context: ctx,
    decisions: { [request.id]: { scope: request.scope, value } },
  })
  assert.equal(review.valid, true, JSON.stringify(review.issues))
  assert.deepEqual(
    review.interpretedReport.coverage.completeSetCoverage.contents,
    value.contents
  )
  assert.equal(
    review.interpretedReport.candidates[0].contentClaims[0].kind,
    'group'
  )
  assert.equal(review.interpretedReport.candidates[0].count, 6)
  for (const invalid of [
    { ...value, provenance: 'reported' },
    { ...value, contents: [{ entryId: 'S', quantity: '63' }] },
    { ...value, contents: [{ entryId: 'foreign', quantity: '63' }] },
  ]) {
    const review = validatePackingReportReview({
      analysis,
      context: ctx,
      decisions: { [request.id]: { scope: request.scope, value: invalid } },
    })
    assert.equal(review.valid, false)
    assert(
      review.issues.some((item) => item.code === 'invalidCompleteCoverage')
    )
  }
})

test('headerless/stacked/duplicate columns and selected regions require explicit mapping rather than guessed omissions', () => {
  const raw = sourceOf('001\tC\t10\n002\tC\t20')
  assert(
    analyzePackingReport({ source: raw, context }).decisionRequests.some(
      (item) => item.code === 'selectTable'
    )
  )
  const analysis = analyzePackingReport({
    source: raw,
    context,
    selection: {
      headerRow: 0,
      columns: { 1: 'label', 2: 'code', 3: 'quantity' },
    },
  })
  const decisions = Object.fromEntries(
    analysis.decisionRequests
      .filter((item) => item.code === 'measurementBasis')
      .map((item) => [item.id, { scope: item.scope, value: 'per-carton' }])
  )
  const review = validatePackingReportReview({ analysis, decisions, context })
  assert.equal(review.valid, true, JSON.stringify(review.issues))
  assert.equal(review.interpretedReport.candidates.length, 2)
  const duplicate = sourceOf(
    'Carton no\tArticle\tPieces per carton\tPieces per carton\n1\tC\t10\t20'
  )
  const initial = analyzePackingReport({ source: duplicate, context })
  assert.equal(
    validatePackingReportReview({ analysis: initial, context }).valid,
    false
  )
  const mapped = analyzePackingReport({
    source: duplicate,
    context,
    selection: { columns: { 4: 'ignore' } },
  })
  assert.equal(
    validatePackingReportReview({ analysis: mapped, context }).valid,
    true
  )
  assert.equal(
    analyzePackingReport({
      source,
      context,
      selection: { fromRow: 4, toRow: 2 },
    }).issues.some((item) => item.code === 'invalidRegion'),
    true
  )
})

test('actual worker handler performs local parse/analyze/review/plan/workbook phases and reports errors with generation', async () => {
  const { utils, write } = await import('xlsx')
  const previous = globalThis.self,
    messages = []
  let handler
  globalThis.self = {
    addEventListener(type, callback) {
      assert.equal(type, 'message')
      handler = callback
    },
    postMessage(message) {
      messages.push(message)
    },
  }
  try {
    await import('../src/packing-report-worker.js')
    await handler({
      data: {
        operation: 'parse',
        generation: 11,
        input: {
          text: source.rawText,
          sourceId: 'worker',
          rawAssetRef: 'local-report:worker',
          rawDigest: 'worker-digest',
        },
      },
    })
    const parsed = messages.at(-1)
    assert.equal(parsed.generation, 11)
    assert.equal(parsed.result.source.rawText, source.rawText)
    await handler({
      data: {
        operation: 'analyze',
        generation: 12,
        input: { source: parsed.result.source, context },
      },
    })
    const analysis = messages.at(-1).result
    assert.equal(analysis.coverage.pieces, '30')
    await handler({
      data: {
        operation: 'validate',
        generation: 13,
        input: { analysis, context },
      },
    })
    const review = messages.at(-1).result
    assert.equal(review.valid, true)
    await handler({
      data: {
        operation: 'plan',
        generation: 14,
        input: {
          interpretedReport: review.interpretedReport,
          newIdentityPool: ['worker-a', 'worker-b'],
        },
      },
    })
    assert.equal(messages.at(-1).result.status, 'ready')
    const book = utils.book_new()
    utils.book_append_sheet(
      book,
      utils.aoa_to_sheet([
        ['Carton no', 'Article', 'Pieces per carton'],
        ['001', 'C', 10],
      ]),
      'Synthetic'
    )
    const buffer = write(book, { type: 'array', bookType: 'xlsx' })
    await handler({
      data: {
        operation: 'workbook',
        generation: 15,
        input: {
          buffer,
          filename: 'synthetic.xlsx',
          sourceId: 'workbook',
          rawAssetRef: 'local-report:workbook',
          rawDigest: 'bytes-digest',
        },
      },
    })
    assert.equal(messages.at(-1).generation, 15)
    assert.equal(messages.at(-1).result.fidelity.formattedIdentifiers, true)
    assert.equal(
      messages
        .at(-1)
        .result.sheets[0].cells.find((cell) => cell.address === 'A2').raw,
      '001'
    )
    await handler({
      data: { operation: 'remote-upload', generation: 16, input: {} },
    })
    assert.match(messages.at(-1).error, /Unsupported/)
    assert.equal(messages.at(-1).generation, 16)
  } finally {
    globalThis.self = previous
  }
})

test('malformed complete-set claims and invalid context/duplicate cells return blocking issues, preserving original source', () => {
  const ctx = {
    ...context,
    products: [
      { ...context.products[0], ceCodes: ['G'], purchased: '50' },
      {
        entryId: 'B',
        groupId: 'G',
        purchased: '50',
        ceCodes: ['G'],
        supplierCodes: [],
      },
    ],
  }
  const source = sourceOf(
    'Carton no\tArticle\tTotal pieces\tCarton count\nSET\tG\t100\t6'
  )
  const analysis = analyzePackingReport({ source, context: ctx })
  const request = analysis.decisionRequests.find(
    (item) => item.code === 'completeSetCoverage'
  )
  for (const value of [
    null,
    {},
    { provenance: 'owner-confirmed', contents: {} },
  ]) {
    const review = validatePackingReportReview({
      analysis,
      context: ctx,
      decisions: { [request.id]: { scope: request.scope, value } },
    })
    assert.equal(review.valid, false)
    assert(
      review.issues.some((item) => item.code === 'invalidCompleteCoverage')
    )
  }
  const invalid = analyzePackingReport({
    source,
    context: { ...ctx, products: [{ entryId: 'A', purchased: 'invalid' }] },
  })
  assert(invalid.issues.some((item) => item.code === 'invalidContext'))
  const duplicate = structuredClone(source)
  duplicate.sheets[0].cells.push(structuredClone(duplicate.sheets[0].cells[0]))
  assert(
    analyzePackingReport({ source: duplicate, context: ctx }).issues.some(
      (item) => item.code === 'invalidStructure'
    )
  )
})

test('an explicit owner whole-set claim may establish missing aggregate pieces without assigning individual boxes', () => {
  const source = sourceOf(
    'Carton no\tArticle\tCarton count\tTotal weight kg\nSET\tC\t6\t57.22'
  )
  const analysis = analyzePackingReport({ source, context })
  const request = analysis.decisionRequests.find(
    (item) => item.code === 'completeSetCoverage'
  )
  assert(request.optional)
  const decisions = {
    [request.id]: {
      scope: request.scope,
      value: {
        provenance: 'owner-confirmed',
        contents: [{ entryId: 'A', quantity: '100' }],
      },
    },
  }
  const review = validatePackingReportReview({ analysis, context, decisions })
  assert.equal(review.valid, true, JSON.stringify(review.issues))
  assert.equal(review.interpretedReport.coverage.pieces, null)
  assert.equal(
    review.interpretedReport.coverage.completeSetCoverage.contents[0].quantity,
    '100'
  )
  assert.equal(
    review.interpretedReport.candidates[0].contentClaims[0].quantity,
    null
  )
})
