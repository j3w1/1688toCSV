import test from 'node:test'
import assert from 'node:assert/strict'
import { utils, write } from 'xlsx'
import { readStoreWorkbook } from '../src/store-workbook-reader.js'
import {
  parsePackingReportCells,
  adaptPackingReportWorkbook,
} from '../src/packing-report-cells.js'
import {
  analyzePackingReport,
  validatePackingReportReview,
} from '../src/packing-report-model.js'
import { planPackingReportUpdate } from '../src/packing-report-matches.js'

const context = {
  accountId: 'local',
  orderId: '1688-order',
  sourceRevision: 2,
  preparationRevision: null,
  products: ['S', 'M', 'L'].map((entryId, index) => ({
    entryId,
    groupId: 'G',
    purchased: ['3', '30', '30'][index],
    ceCodes: ['CE26090101'],
    supplierCodes: ['旧码'],
    name: entryId,
    photoRefs: [],
  })),
}
const raw = {
  sourceId: 'source',
  rawAssetRef: 'local-report:source',
  rawDigest: 'synthetic',
}
const sourceOf = (text) => parsePackingReportCells({ text, ...raw }).source
function reviewed(source, overrides = {}, ctx = context) {
  const decisions = {}
  let analysis
  for (let step = 0; step < 5; step++) {
    analysis = analyzePackingReport({ source, context: ctx, decisions })
    for (const request of analysis.decisionRequests.filter(
      (item) => item.severity === 'decision'
    )) {
      const value =
        overrides[request.code] ??
        {
          measurementUnit: 'cm',
          measurementBasis: 'per-carton',
          cartonRange: { labels: request.params.proposed },
          alignedLists: true,
          repeatedLabel: 'separate',
        }[request.code]
      if (value !== undefined)
        decisions[request.id] = { scope: request.scope, value }
    }
  }
  return {
    analysis: analyzePackingReport({ source, context: ctx, decisions }),
    decisions,
    review: validatePackingReportReview({ analysis, decisions, context: ctx }),
  }
}
const sixRows = [
  ['001', '旧码', '13', '60×50×40', '16.75'],
  ['002', '旧码', '12', '60×50×40', '14.62'],
  ['003', '旧码', '11', '50×43×36', '10.40'],
  ['004', '旧码', '9', '48×37×27', '5.63'],
  ['005', '旧码', '9', '48×37×27', '5.18'],
  ['006', '旧码', '9', '48×37×27', '4.64'],
]
const headings = ['箱号', '货号', '装箱数 每箱', '体积 每箱', '重量 (KG) 每箱']

test('AC6 six exact uneven cartons retain group-unknown variants, exact cm totals and six boundary IDs in TSV and XLSX', async () => {
  const book = utils.book_new()
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([headings, ...sixRows]),
    'Cartons'
  )
  const workbook = await readStoreWorkbook(
    write(book, { type: 'array', bookType: 'xlsx' }),
    { filename: 'fixture.xlsx', reportEvidence: true }
  )
  for (const source of [
    sourceOf([headings, ...sixRows].map((row) => row.join('\t')).join('\n')),
    adaptPackingReportWorkbook({ workbook, ...raw }),
  ]) {
    const { analysis, review } = reviewed(source)
    assert.equal(review.valid, true, JSON.stringify(review.issues))
    assert.deepEqual(
      analysis.candidates.map(
        (candidate) => candidate.contentClaims[0].quantity
      ),
      ['13', '12', '11', '9', '9', '9']
    )
    assert.deepEqual(
      analysis.candidates.map(
        (candidate) =>
          candidate.measurementFacts.find((fact) => fact.field === 'weight')
            .value
      ),
      ['16.75', '14.62', '10.4', '5.63', '5.18', '4.64']
    )
    assert.equal(analysis.coverage.count, 6)
    assert.equal(analysis.coverage.pieces, '63')
    assert.equal(analysis.coverage.unresolvedPieces, '63')
    assert.equal(analysis.coverage.weight.known, '57.22')
    assert.equal(analysis.coverage.volume.known, '0.461256')
    assert.equal(analysis.coverage.completeSetCoverage, null)
    assert(
      analysis.candidates.every(
        (candidate) => candidate.contentClaims[0].kind === 'group'
      )
    )
    const plan = planPackingReportUpdate({
      interpretedReport: review.interpretedReport,
      newIdentityPool: ['a', 'b', 'c', 'd', 'e', 'f'],
    })
    assert.equal(plan.status, 'ready', JSON.stringify(plan))
    assert.deepEqual(
      plan.commitPayload.cartonBatches.map((batch) => batch.id),
      ['a', 'b', 'c', 'd', 'e', 'f']
    )
    assert(
      plan.commitPayload.cartonBatches.every(
        (batch) =>
          batch.contents.length === 0 &&
          batch.unresolvedContents[0].entryIds.join() === 'L,M,S'
      )
    )
    assert.equal(plan.commitPayload.cartonBatches[0].len, '60')
    assert.equal(
      source.sheets[0].cells.find((cell) => cell.address === 'E4').raw,
      '10.40'
    )
  }
})

test('three explicit size/list rows expand into six distinct uneven cartons; aggregate rows stay combined', () => {
  const text =
    'Carton no\tArticle\tCarton count\tPieces per carton\tDimensions per carton cm\tWeight per carton kg\n001–002\t旧码\t2\t13;12\t60×50×40\t16.75;14.62\n003\t旧码\t1\t11\t50×43×36\t10.40\n004–006\t旧码\t3\t9;9;9\t48×37×27\t5.63;5.18;4.64'
  const { analysis, review } = reviewed(sourceOf(text))
  assert.equal(review.valid, true, JSON.stringify(review.issues))
  assert.equal(analysis.candidates.length, 6)
  assert.deepEqual(
    analysis.candidates.map((candidate) => candidate.supplierLabel),
    ['001', '002', '003', '004', '005', '006']
  )
  assert.equal(analysis.coverage.weight.known, '57.22')
  assert.equal(analysis.coverage.volume.known, '0.461256')
  const aggregate = reviewed(
    sourceOf(
      'Carton no\tArticle\tCarton count\tTotal pieces\tTotal weight kg\tTotal volume cbm\n001–006\t旧码\t6\t63\t57.22\t0.461256'
    )
  )
  assert.equal(
    aggregate.review.valid,
    true,
    JSON.stringify(aggregate.review.issues)
  )
  assert.equal(aggregate.analysis.candidates.length, 1)
  assert.equal(aggregate.analysis.candidates[0].packingBasis, 'aggregate')
  assert.equal(aggregate.analysis.coverage.weight.known, '57.22')
  assert.equal(aggregate.analysis.coverage.volume.known, '0.461256')
  assert.equal(
    aggregate.analysis.candidates[0].measurementFacts[0].basis,
    'combined-set'
  )
})

test('Chinese headings need no China markers, tuple volume and explicit unknown basis remain distinguishable', () => {
  const source = sourceOf(
    '箱号\t货号\t装箱数\t体积\t重量 (KG)\n001\t旧码\t13\t60×50×40\t0'
  )
  const initial = analyzePackingReport({ source, context })
  assert(
    initial.decisionRequests.some(
      (request) => request.code === 'measurementUnit'
    )
  )
  assert(
    initial.decisionRequests.some(
      (request) => request.code === 'measurementBasis'
    )
  )
  const { analysis, review } = reviewed(source, { measurementBasis: 'unknown' })
  assert.equal(review.valid, true, JSON.stringify(review.issues))
  assert.equal(analysis.coverage.weight.known, '0')
  assert.equal(analysis.coverage.volume.known, '0.12')
  assert.equal(
    analysis.candidates[0].measurementFacts.find(
      (fact) => fact.field === 'weight'
    ).basis,
    'unknown'
  )
})

test('units mm/cm/m and g/kg convert exactly; conflicting row/header units require scoped interpretation', () => {
  for (const [dimensions, weight, volume] of [
    ['600×500×400 mm', '16750 g', '0.12'],
    ['60×50×40 cm', '16.75 kg', '0.12'],
    ['0.6×0.5×0.4 m', '16.75 kg', '0.12'],
  ]) {
    const { review, analysis } = reviewed(
      sourceOf(
        `Carton no\tArticle\tPieces per carton\tDimensions per carton\tWeight per carton\n001\t旧码\t13\t${dimensions}\t${weight}`
      )
    )
    assert.equal(review.valid, true, JSON.stringify(review.issues))
    assert.equal(analysis.coverage.weight.known, '16.75')
    assert.equal(analysis.coverage.volume.known, volume)
  }
  const source = sourceOf(
    'Carton no\tArticle\tPieces per carton\tDimensions per carton cm\n001\t旧码\t13\t600×500×400 mm'
  )
  const analysis = analyzePackingReport({ source, context })
  assert(
    analysis.decisionRequests.some((request) => request.code === 'unitConflict')
  )
  assert.equal(validatePackingReportReview({ analysis, context }).valid, false)
})

test('ambiguous locales never inherit China commas, decimals remain exact and expressions reject', () => {
  const ctx = {
    ...context,
    products: [{ ...context.products[0], purchased: '2000', ceCodes: ['C'] }],
  }
  for (const [value, locale, expected, valid] of [
    ['1,234', 'decimal-dot', '1234', true],
    ['1,234', 'decimal-comma', null, false],
    ['1,5', 'decimal-dot', null, false],
  ]) {
    const source = sourceOf(
      `Carton no\tArticle\tPieces per carton\n001\tC\t${value}`
    )
    assert(
      analyzePackingReport({ source, context: ctx }).decisionRequests.some(
        (item) => item.code === 'numericLocale'
      )
    )
    const result = reviewed(source, { numericLocale: locale }, ctx)
    assert.equal(result.review.valid, valid)
    if (valid) assert.equal(result.analysis.coverage.pieces, expected)
  }
  const weight = reviewed(
    sourceOf(
      'Carton no\tArticle\tPieces per carton\tWeight per carton kg\n001\t旧码\t13\t1,5'
    ),
    { numericLocale: 'decimal-comma' }
  )
  assert.equal(weight.analysis.coverage.weight.known, '1.5')
  for (const value of ['=13+0', '+13', '@SUM(13)', '6/2', '13*1', '-1', 'NaN'])
    assert.equal(
      reviewed(
        sourceOf(`Carton no\tArticle\tPieces per carton\n001\t旧码\t${value}`)
      ).review.valid,
      false
    )
})

test('known group coverage cannot overreserve candidate variants and a quantity difference never changes purchase', () => {
  const ctx = {
    ...context,
    products: [
      {
        ...context.products[0],
        ceCodes: ['S'],
        supplierCodes: ['G'],
        purchased: '3',
      },
      {
        ...context.products[1],
        supplierCodes: ['G'],
        ceCodes: ['M'],
        purchased: '30',
      },
    ],
  }
  const result = reviewed(
    sourceOf('Carton no\tArticle\tTotal pieces\n1\tS\t3\n2\tG\t31'),
    {},
    ctx
  )
  assert.equal(result.review.valid, true)
  assert.equal(result.analysis.coverage.feasible, false)
  assert.equal(result.analysis.coverage.difference, '-1')
  assert(result.review.unresolved.some((item) => item.code === 'overcoverage'))
  assert.deepEqual(
    ctx.products.map((product) => product.purchased),
    ['3', '30']
  )
  const purchase100 = {
    ...context,
    products: [
      {
        ...context.products[0],
        purchased: '100',
        ceCodes: ['A'],
        supplierCodes: [],
      },
    ],
  }
  for (const [quantity, difference] of [
    ['90', '10'],
    ['110', '-10'],
  ]) {
    const result = reviewed(
      sourceOf(`Carton no\tArticle\tTotal pieces\n1\tA\t${quantity}`),
      {},
      purchase100
    )
    assert.equal(result.analysis.coverage.difference, difference)
    assert.equal(purchase100.products[0].purchased, '100')
  }
})

test('repeated labels and overlapping ranges never merge without review, explicit content rows count once', () => {
  const source = sourceOf(
    'Carton no\tArticle\tPieces per carton\n1\t旧码\t9\n1\t旧码\t9'
  )
  const initial = analyzePackingReport({ source, context })
  assert(
    initial.decisionRequests.some((request) => request.code === 'repeatedLabel')
  )
  assert.equal(
    validatePackingReportReview({ analysis: initial, context }).valid,
    false
  )
  assert.equal(
    reviewed(source, { repeatedLabel: 'separate' }).analysis.coverage.count,
    2
  )
  assert.equal(
    reviewed(source, { repeatedLabel: 'contents' }).analysis.coverage.count,
    1
  )
  for (const label of ['1/6', '006–001', '001–003,5', '001–99999999']) {
    const analysis = analyzePackingReport({
      source: sourceOf(
        `Carton no\tArticle\tPieces per carton\n${label}\t旧码\t9`
      ),
      context,
    })
    assert(
      analysis.decisionRequests.some(
        (request) => request.code === 'cartonRange'
      ),
      label
    )
  }
  const overlap = reviewed(
    sourceOf(
      'Carton no\tArticle\tPieces per carton\n001–003\t旧码\t9\n003–004\t旧码\t9'
    )
  )
  assert(overlap.analysis.decisionRequests.every((request) => request.optional))
  assert(
    overlap.analysis.decisionRequests.some(
      (request) => request.code === 'completeSetCoverage'
    )
  )
  assert.equal(overlap.analysis.coverage.count, 5)
  assert(
    overlap.decisions[
      Object.keys(overlap.decisions).find((key) =>
        key.startsWith('repeatedLabel:')
      )
    ]
  )
})

test('unknown explicit measurement units remain unresolved evidence instead of inheriting a header unit', () => {
  const source = sourceOf(
    'Carton no\tArticle\tPieces per carton\tWeight per carton kg\n001\t旧码\t13\t12 lb'
  )
  const initial = analyzePackingReport({ source, context })
  assert(
    initial.decisionRequests.some((item) => item.code === 'unsupportedUnit')
  )
  const { analysis, review } = reviewed(source, {
    unsupportedUnit: 'retain-unknown',
  })
  assert.equal(review.valid, true, JSON.stringify(review.issues))
  assert.equal(analysis.coverage.weight.known, null)
  assert.equal(analysis.candidates[0].measurementFacts[0].unit, 'unknown')
  const plan = planPackingReportUpdate({
    interpretedReport: review.interpretedReport,
    newIdentityPool: ['unknown-unit'],
  })
  assert.equal(plan.status, 'ready', JSON.stringify(plan))
  assert.equal(plan.commitPayload.cartonBatches[0].weight, '')
  assert.equal(
    plan.commitPayload.report.source.sheets[0].cells.find(
      (cell) => cell.address === 'D2'
    ).raw,
    '12 lb'
  )
})

test('per-carton group quantity cannot certify uniform variants; volume discrepancy keeps supplied and calculated facts', () => {
  const source = sourceOf(
    'Carton no\tArticle\tCarton count\tPieces per carton\tDimensions per carton cm\tVolume per carton cbm\nSET\t旧码\t3\t9\t48×37×27\t0.05'
  )
  const { analysis, review } = reviewed(source)
  assert.equal(review.valid, true)
  assert.equal(analysis.candidates[0].packingBasis, 'aggregate')
  assert.equal(analysis.coverage.pieces, '27')
  assert.equal(analysis.coverage.volume.known, '0.143856')
  assert(analysis.issues.some((issue) => issue.code === 'volumeDiscrepancy'))
  const plan = planPackingReportUpdate({
    interpretedReport: review.interpretedReport,
    newIdentityPool: ['batch'],
  })
  assert.equal(plan.commitPayload.cartonBatches[0].suppliedCbm, '0.05')
  assert.equal(plan.commitPayload.cartonBatches[0].volumeBasis, 'carton')
  assert.equal(
    plan.commitPayload.cartonBatches[0].unresolvedContents[0].quantity,
    '27'
  )
})

test('range count mismatches, unaligned lists, excessive expansions and crossed prefixes block full confirmation', () => {
  for (const [label, count, quantity] of [
    ['001–003', '2', '9'],
    ['001–003', '3', '9;8'],
    ['A001–B003', '3', '9'],
  ]) {
    const result = reviewed(
      sourceOf(
        `Carton no\tArticle\tCarton count\tPieces per carton\n${label}\t旧码\t${count}\t${quantity}`
      )
    )
    assert.equal(result.review.valid, false, `${label}/${count}/${quantity}`)
  }
  const bounded = analyzePackingReport({
    source: sourceOf(
      'Carton no\tArticle\tCarton count\tPieces per carton\nSET\t旧码\t3\t9'
    ),
    context,
    limits: { entitlements: 2 },
  })
  assert(bounded.issues.some((item) => item.code === 'invalidCount'))
  const source = sourceOf(
    'Carton no\tArticle\tPieces\tWeight kg\n1\tOLD\t9\t1\n2\tOLD\t9\t2'
  )
  const analysis = analyzePackingReport({ source, context })
  assert.equal(
    analysis.decisionRequests.filter((request) => request.code === 'codeAlias')
      .length,
    1
  )
  assert.equal(
    analysis.decisionRequests.filter(
      (request) => request.code === 'measurementBasis'
    ).length,
    2
  )
})

test('supported count/measurements with absent pieces save contentsUnknown and nullable candidate coverage without zero invention', () => {
  for (const text of [
    'Carton no\tArticle\tCarton count\tDimensions per carton cm\tTotal weight kg\nSET\t旧码\t6\t60×50×40\t57.22',
    'Carton no\tArticle\tCarton count\tTotal pieces\tTotal weight kg\nSET\t旧码\t6\t\t57.22',
  ]) {
    const { analysis, review } = reviewed(sourceOf(text))
    assert.equal(review.valid, true, JSON.stringify(review.issues))
    assert.equal(analysis.coverage.count, 6)
    assert.equal(analysis.coverage.pieces, null)
    assert.equal(analysis.coverage.difference, null)
    assert.equal(analysis.coverage.unknownQuantityCandidates, 1)
    assert.equal(analysis.coverage.weight.known, '57.22')
    const plan = planPackingReportUpdate({
      interpretedReport: review.interpretedReport,
      newIdentityPool: ['unknown-pieces'],
    })
    assert.equal(plan.status, 'ready', JSON.stringify(plan))
    assert.equal(plan.commitPayload.cartonBatches[0].contentsUnknown, true)
    assert.deepEqual(plan.commitPayload.cartonBatches[0].contents, [])
    assert.equal(
      plan.commitPayload.cartonBatches[0].unresolvedContents[0].quantity,
      null
    )
    assert.deepEqual(
      plan.commitPayload.cartonBatches[0].unresolvedContents[0].entryIds,
      ['L', 'M', 'S']
    )
  }
})

test('report heading aliases never substitute for the unchanged China purchase markers', async () => {
  const { analyzeStoreSheet } = await import('../src/store-workbook-model.js')
  const report = sourceOf(
    '箱号\t货号\t装箱数 每箱\t体积 每箱 cm\t重量 (KG) 每箱\n001\t旧码\t13\t60×50×40\t16.75'
  )
  const map = new Map()
  for (const cell of report.sheets[0].cells) {
    if (!map.has(cell.row)) map.set(cell.row, [])
    map
      .get(cell.row)
      .push({ col: cell.col, address: cell.address, value: cell.raw })
  }
  const china = analyzeStoreSheet(
    {
      filename: '1234.xlsx',
      sheets: [
        {
          name: 'Report',
          rows: [...map].map(([row, cells]) => ({ row, cells })),
          images: [],
          merges: [],
        },
      ],
    },
    'Report'
  )
  assert.deepEqual(
    china.issues
      .filter((issue) => issue.code === 'missing-marker')
      .map((issue) => issue.params.marker)
      .sort(),
    ['boxes', 'group', 'pic', 'price']
  )
  assert(china.issues.some((issue) => issue.code === 'missing-quantity-marker'))
  assert.equal(reviewed(report).review.valid, true)
})
