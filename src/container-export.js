import {
  planPackingWorkbook,
  createPreparedPackingWorkbook,
  PACKING_PRODUCT_COLUMNS,
  PACKING_PRODUCT_DEFAULT_COLUMNS,
  PACKING_CARTON_COLUMNS,
  PACKING_CARTON_DEFAULT_COLUMNS,
} from './packing-workbook.js'
import {
  SUMMARY_FORMAT,
  fileSlug,
  exportStamp,
  summaryFileName,
} from './export-summary.js'
import { excelImagePalette } from './excel-image-style.js'
import { columnName } from './xlsx-writer.js'
import { exactDecimal, exactWhole, addExact } from './carton-arithmetic.js'
import { productFeatures } from './product-features.js'

const clone = (value) => structuredClone(value)
const absent = (value) => value === undefined || value === null || value === ''
const textCell = (value, style = 4) => ({
  type: 'text',
  value: String(value ?? ''),
  style,
})
const numberCell = (value, style = 5) => ({
  type: 'number',
  value: absent(value) ? '' : exactDecimal(value),
  style,
})
const excelNumeric = (value) =>
  !absent(value) &&
  String(value).replace(/[-.]/g, '').replace(/^0+/, '').length <= 15
const identity = (value) =>
  JSON.stringify([
    value.accountId || 'local',
    String(value.orderId),
    String(value.entryId),
  ])
const strings = {
  en: {
    sheets: ['Packing list', 'Cartons', 'Se quedó'],
    draft: 'DRAFT — unsealed / unverified',
    revision: 'Revision',
    container: 'Container',
    order: 'Order',
    evidence: 'Source batch evidence',
    suppliedVolume: 'Supplied volume',
    warning: 'Warning',
    note: 'Complete loaded scope of this container revision. Source purchase rows remain separate; physical cartons and measurements count once on Cartons.',
    cartonNote:
      'Only loaded physical identities. Unknown per-carton contents or combined measurements remain unknown; combined known subtotals are shown separately.',
    leftNote:
      'Frozen remainder of included purchases at this revision. Known left-behind cartons and goods awaiting packing data are separate; untouched purchases are excluded.',
    empty: 'No loaded products',
    noCartons: 'No loaded cartons',
    noLeft: 'No remaining products',
    unknown: 'Unknown',
    internal: 'Internal',
    totals: 'Totals',
    known: 'Known subtotal',
    missing: 'Cartons outside measurement coverage',
    combined: 'Combined batch evidence',
    leftCartons: 'Known left-behind cartons',
    unprepared: 'Awaiting packing data',
    perCarton: 'Per carton',
    batch: 'Combined batch',
    allocation: 'Allocated',
    shared: 'Shared',
    uniform: 'Uniform',
    uneven: 'Uneven',
    aggregate: 'Aggregate',
    inShared: 'in shared',
    totalPieces: 'total pieces',
    quantity: 'Quantity',
    weight: 'kg',
    volume: 'm³',
    freight: 'Allocated freight 元',
    authoredSupplier: 'Operator-confirmed supplier identity',
  },
  es: {
    sheets: ['Lista de empaque', 'Cajas', 'Se quedó'],
    draft: 'BORRADOR — sin sellar / sin verificar',
    revision: 'Revisión',
    container: 'Contenedor',
    order: 'Pedido',
    evidence: 'Datos originales del lote',
    suppliedVolume: 'Volumen declarado',
    warning: 'Advertencia',
    note: 'Alcance cargado completo de esta revisión. Cada compra mantiene sus filas; cajas y medidas físicas se cuentan una sola vez en Cajas.',
    cartonNote:
      'Solo identidades físicas cargadas. Los contenidos por caja y las medidas combinadas desconocidos siguen desconocidos; se muestran subtotales conocidos por separado.',
    leftNote:
      'Remanente congelado de las compras incluidas en esta revisión. Las cajas dejadas y los productos pendientes de embalaje se distinguen; no incluye compras ajenas.',
    empty: 'Sin productos cargados',
    noCartons: 'Sin cajas cargadas',
    noLeft: 'Sin productos restantes',
    unknown: 'Desconocido',
    internal: 'Interna',
    totals: 'Totales',
    known: 'Subtotal conocido',
    missing: 'Cajas sin cobertura de medidas',
    combined: 'Datos combinados del lote',
    leftCartons: 'Cajas conocidas que se quedaron',
    unprepared: 'Pendiente de datos de embalaje',
    perCarton: 'Por caja',
    batch: 'Lote combinado',
    allocation: 'Asignado',
    shared: 'Compartida',
    uniform: 'Uniforme',
    uneven: 'Desigual',
    aggregate: 'Lote',
    inShared: 'en compartida',
    totalPieces: 'piezas totales',
    quantity: 'Cantidad',
    weight: 'kg',
    volume: 'm³',
    freight: 'Envío asignado 元',
    authoredSupplier: 'Identidad del proveedor confirmada por el operador',
  },
  zh: {
    sheets: ['装箱单', '纸箱', '未装柜'],
    draft: '草稿 — 未封存 / 未验证',
    revision: '修订',
    container: '货柜',
    order: '订单',
    evidence: '原始批次资料',
    suppliedVolume: '申报体积',
    warning: '提示',
    note: '本货柜修订的全部已装货物。采购明细分开列示；实物纸箱及测量合计仅在纸箱表计算一次。',
    cartonNote:
      '仅列已装实物编号。未知单箱内装及合并测量不作推算；已知合并小计另行列出。',
    leftNote:
      '本修订所包含采购的封存剩余记录。已知未装纸箱与待提供装箱资料的货物分开列示；不含无关采购。',
    empty: '无已装商品',
    noCartons: '无已装纸箱',
    noLeft: '无剩余商品',
    unknown: '未知',
    internal: '内部编号',
    totals: '合计',
    known: '已知小计',
    missing: '测量未覆盖箱数',
    combined: '批次合并资料',
    leftCartons: '已知未装纸箱',
    unprepared: '待提供装箱资料',
    perCarton: '每箱',
    batch: '合并批次',
    allocation: '分摊',
    shared: '共箱',
    uniform: '均匀',
    uneven: '不同',
    aggregate: '整批',
    inShared: '共箱内',
    totalPieces: '总件数',
    quantity: '数量',
    weight: 'kg',
    volume: 'm³',
    freight: '分摊运费 元',
    authoredSupplier: '操作员确认的供应商身份',
  },
}

function columnsFor(available, requested, defaults) {
  const keys = requested ?? defaults
  if (
    !Array.isArray(keys) ||
    !keys.length ||
    keys.some((key) => !available.some((column) => column.key === key))
  )
    throw new Error('Choose at least one supported container export column')
  return [...new Set(keys)].map((key) => {
    const column = available.find((value) => value.key === key)
    return {
      ...column,
      pixelWidth: Math.floor(((256 * column.width + 18) / 256) * 7),
    }
  })
}
function fullRow(sheet, kind, value, style = 2, height = 36) {
  const row = {
    number: sheet.rows.length + 1,
    kind,
    height,
    cells: [textCell(value, style)],
  }
  sheet.rows.push(row)
  if (sheet.columns.length > 1)
    sheet.merges.push(`A${row.number}:${sheet.lastColumn}${row.number}`)
  sheet.lastRow = row.number
  return row
}
function blankSheet(name, columns, options, title, note) {
  const sheet = {
    name,
    language: options.language,
    columns,
    palette: excelImagePalette(options.style),
    rows: [],
    merges: [],
    products: [],
    lastColumn: columnName(columns.length - 1),
    lastRow: 5,
    lastProductRow: 5,
    photoPixels:
      { compact: 64, standard: 120, large: 160 }[options.photoSize] ?? 120,
    freezeHeaders: options.freezeHeaders !== false,
    filters: options.filters !== false,
    createdAt: options.createdAt,
    imageColumns: {},
  }
  fullRow(sheet, 'title', title, 1, 32)
  fullRow(sheet, 'metadata', options.metadata, 2, 26)
  fullRow(sheet, 'note', note, 2, 48)
  sheet.rows.push({ number: 4, kind: 'spacer', height: 6, cells: [] })
  sheet.rows.push({
    number: 5,
    kind: 'header',
    height: 39,
    cells: columns.map((column) =>
      textCell(column.labels[options.language], 3)
    ),
  })
  return sheet
}
function replaceCell(sheet, row, key, cell) {
  const index = sheet.columns.findIndex((column) => column.key === key)
  if (index >= 0) row.cells[index] = cell
}
function sumKnown(rows, key) {
  return rows.some((row) => absent(row[key]))
    ? null
    : addExact(...rows.map((row) => exactDecimal(row[key])))
}

// Deliberate disclosure: detailed JSON contains frozen costs/reasons independently
// of workbook column selection. It excludes contacts, raw records and image bytes.
const productFields = [
  'accountId',
  'orderId',
  'entryId',
  'groupId',
  'variantId',
  'source',
  'sourceType',
  'orderReference',
  'sellerName',
  'storeNumber',
  'barcode',
  'baseCode',
  'spanishName',
  'description',
  'productNumber',
  'sourceSize',
  'variantSuffix',
  'sizeSuffix',
  'needsSizeMapping',
  'packingMonth',
  'sourceQuantity',
  'title',
  'category',
  'chineseCategory',
  'material',
  'size',
  'reason',
  'purchased',
  'eligible',
  'quantity',
  'loadedQuantity',
  'remainingQuantity',
  'purchasedQuantity',
  'availableBeforeQuantity',
  'sourceUnitPrice',
  'sourcePrice',
  'effectiveUnitPrice',
  'price',
  'sourceDiscount',
  'allocatedDiscount',
  'discount',
  'sourceAmount',
  'sourceGrossAmount',
  'effectiveAmount',
  'additionalCharge',
  'featureCharge',
  'linkedPaymentCharge',
  'freightAllocated',
  'freight',
  'freightAmount',
  'allocatedFreight',
  'additionalChargeReasons',
  'linkedPaymentReasons',
  'productFeatures',
  'productFeatureCosts',
  'freightReason',
  'freightAllocationBasis',
  'allocationBasis',
  'costAllocationBasis',
  'cartonReferences',
  'cartonIds',
  'pattern',
  'additiveCartonCount',
  'containingCartonCount',
  'allocatedWeight',
  'allocatedVolume',
  'measurementAllocationBasis',
  'packingState',
]
const contentFields = [
  'accountId',
  'orderId',
  'entryId',
  'groupId',
  'quantity',
  'barcode',
  'code',
  'supplierCode',
  'entryIds',
]
const physicalFields = [
  'id',
  'cartonId',
  'batchId',
  'accountId',
  'orderId',
  'index',
  'entitlementIndex',
  'reference',
  'cartonNumber',
  'supplierLabel',
  'labelOrigin',
  'count',
  'packingBasis',
  'mark',
  'markCode',
  'baseCode',
  'category',
  'chineseCategory',
  'known',
  'state',
  'len',
  'wid',
  'ht',
  'weight',
  'weightBasis',
  'volume',
  'suppliedCbm',
  'volumeBasis',
  'totalWeight',
  'totalVolume',
  'dimensionVolume',
  'measurementCoverage',
  'revision',
  'reportRef',
  'needsReview',
]
function pick(source, fields) {
  return Object.fromEntries(
    fields
      .filter((field) => source[field] !== undefined)
      .map((field) => [field, clone(source[field])])
  )
}
function publicProduct(source) {
  return {
    ...pick(source, productFields),
    ...publicSupplierIdentity(source),
    ...publicCostEvidence(source),
    ...(source.group?.id && !source.groupId
      ? { groupId: source.group.id }
      : {}),
    ...(source.variant?.id && !source.variantId
      ? { variantId: source.variant.id }
      : {}),
  }
}
function publicCostEvidence(source) {
  const record = source.record
  const charges =
    record?.additionalCharges ?? source.valuation?.additionalReasons ?? []
  const features = productFeatures(
    record?.productWorkflow?.[source.entryId]?.features
  )
  const payments = (record?.paymentLinks ?? []).filter(
    (link) =>
      !link.targetEntryIds || link.targetEntryIds.includes(source.entryId)
  )
  if (
    !charges.length &&
    !features.length &&
    !payments.length &&
    !source.valuation
  )
    return {}
  const allocation = source.valuation
  const budgetFields = [
    'sourceGrossAmount',
    'sourceAmount',
    'sourceDiscount',
    'allocatedDiscount',
    'additionalCharge',
    'featureCharge',
    'linkedPaymentCharge',
    'freightAllocated',
  ]
  return {
    costEvidence: {
      scope: 'frozen-source-evidence',
      allocated: pick(source, budgetFields),
      additionalCharges: charges.map((charge) => ({
        scope: 'source-order',
        ...pick(charge, ['id', 'amount', 'reason']),
      })),
      productFeatures: features.map((feature) => ({
        scope: 'source-unit',
        ...pick(feature, ['key', 'name', 'unitCost', 'included']),
      })),
      linkedPayments: payments.map((link) => ({
        scope: 'source-payment',
        ...pick(link, [
          'id',
          'sourceOrderId',
          'sourceEntryId',
          'amount',
          'reason',
          'targetEntryIds',
          'reviewedAt',
        ]),
        ...(link.sourceEvidence
          ? {
              sourceEvidence: pick(link.sourceEvidence, [
                'amount',
                'payable',
                'shipping',
                'observedAt',
              ]),
            }
          : {}),
      })),
      ...(allocation
        ? {
            allocation: {
              basis:
                source.freightAllocationBasis ??
                source.costAllocationBasis ??
                null,
              ...pick(allocation, [
                'sourceQuantity',
                'quantity',
                'from',
                'sourceNet',
              ]),
              ...(Array.isArray(allocation.intervals)
                ? {
                    intervals: allocation.intervals.map((part) =>
                      pick(part, ['from', 'quantity'])
                    ),
                  }
                : {}),
              ...(allocation.budgets
                ? {
                    budgets: Object.fromEntries(
                      budgetFields
                        .filter((field) => allocation.budgets[field])
                        .map((field) => [
                          field,
                          pick(allocation.budgets[field], [
                            'source',
                            'alreadyAllocated',
                            'remaining',
                            'remainingQuantity',
                          ]),
                        ])
                    ),
                  }
                : {}),
            },
          }
        : {}),
    },
  }
}
function publicSupplierIdentity(source) {
  const identity = source.supplierIdentity
  return identity && typeof identity === 'object' && !Array.isArray(identity)
    ? {
        supplierIdentity: pick(identity, [
          'sellerId',
          'storeId',
          'provenance',
          'conflict',
          'sourceSellerId',
          'resolvedSellerId',
        ]),
      }
    : {}
}
function publicCarton(source) {
  return {
    ...pick(source, physicalFields),
    ...(source.mark ? { mark: pick(source.mark, ['orderId', 'groupId']) } : {}),
    contents:
      source.contents === null
        ? null
        : (source.contents ?? []).map((part) => pick(part, contentFields)),
    ...(source.unresolvedContents
      ? {
          unresolvedContents: source.unresolvedContents.map((part) =>
            pick(part, contentFields)
          ),
        }
      : {}),
  }
}

/** Reuse the existing product layout while retaining only already allocated money. */
function productWorksheet(rows, name, options, note, emptyLabel) {
  const columns = columnsFor(
    PACKING_PRODUCT_COLUMNS,
    options.columns,
    PACKING_PRODUCT_DEFAULT_COLUMNS
  )
  if (!rows.length) {
    const empty = blankSheet(name, columns, options, options.title, note)
    empty.filters = false
    fullRow(empty, 'empty', emptyLabel)
    return empty
  }
  const sources = rows.map((row) => {
    const source = clone(row)
    // These historical source/order fields must never become shipment values.
    for (const field of [
      'orderShipping',
      'orderAmount',
      'orderAdditionalCharges',
      'lineAmount',
      'lineNetAmount',
      'price',
    ])
      delete source[field]
    source.sourceUnitPrice =
      row.sourceUnitPrice ?? row.sourcePrice ?? row.price ?? null
    source.effectiveUnitPrice = row.effectiveUnitPrice ?? null
    source.effectiveAmount = row.effectiveAmount ?? null
    // planPackingWorkbook's compatibility fallback sees no original full amount.
    delete source.sourceAmount
    return source
  })
  const planned = planPackingWorkbook(sources, {
    ...options,
    columns: columns.map((column) => column.key),
    cartonBatches: [],
  })
  const sheet = planned.sheets[0]
  sheet.name = name
  sheet.rows[0].cells[0] = textCell(options.title, 1)
  sheet.rows[1].cells[0] = textCell(options.metadata, 2)
  sheet.rows[2].cells[0] = textCell(note, 2)
  sheet.rows[2].height = Math.max(sheet.rows[2].height, 48)
  const originals = new Map(rows.map((row) => [identity(row), row]))
  for (const product of sheet.products) {
    const row = sheet.rows[product.row - 1]
    const original = originals.get(identity(product.source))
    product.source = clone(original)
    for (const key of [
      'quantity',
      'sourceUnitPrice',
      'effectiveUnitPrice',
      'discount',
      'effectiveAmount',
    ]) {
      const value =
        key === 'sourceUnitPrice'
          ? (original.sourceUnitPrice ?? original.sourcePrice ?? original.price)
          : original[key]
      replaceCell(
        sheet,
        row,
        key,
        numberCell(value, key === 'quantity' ? 5 : 10)
      )
    }
    // Source nominal capacity is not evidence of this revision's actual packing.
    replaceCell(sheet, row, 'unitsPerCarton', textCell(''))
  }
  if (sheet.totalRow) {
    const total = sheet.rows[sheet.totalRow - 1]
    for (const key of ['quantity', 'discount', 'effectiveAmount'])
      replaceCell(
        sheet,
        total,
        key,
        numberCell(sumKnown(rows, key), key === 'quantity' ? 7 : 12)
      )
  }
  return sheet
}

function contextFor(manifest, options = {}) {
  if (
    !manifest?.container?.id ||
    !Array.isArray(manifest.products) ||
    !Array.isArray(manifest.cartons) ||
    !manifest.totals ||
    !manifest.leftBehind
  )
    throw new Error('Choose a frozen container revision manifest')
  const draft = manifest.draft === true || manifest.status !== 'sealed'
  if (!draft && !manifest.revisionId)
    throw new Error('A sealed container export requires its frozen revision ID')
  const seen = new Set(),
    products = new Set()
  for (const row of manifest.products) {
    if (
      !row.orderId ||
      row.entryId === undefined ||
      products.has(identity(row))
    )
      throw new Error(
        'Frozen manifest products require unique source identities'
      )
    products.add(identity(row))
    if (!absent(row.quantity)) exactWhole(row.quantity)
  }
  for (const carton of manifest.cartons) {
    const id = carton.cartonId ?? carton.id
    if (!id || seen.has(id))
      throw new Error('A physical carton occurs twice in this manifest')
    if (carton.count !== undefined && carton.count !== 1)
      throw new Error(
        'Manifest cartons must be distinct physical unit identities'
      )
    if (carton.state && carton.state !== 'loaded')
      throw new Error(
        'The loaded manifest contains a carton with another loading decision'
      )
    seen.add(id)
  }
  const language = strings[options.language] ? options.language : 'en',
    words = strings[language]
  const revision =
    manifest.revisionId ?? `draft-r${manifest.revision ?? 'unknown'}`
  const authoredSuppliers = [
    ...new Set(
      (manifest.orders ?? [])
        .filter(
          (order) => order.supplierIdentity?.provenance === 'manual-confirmed'
        )
        .map((order) => String(order.orderId))
    ),
  ]
  const metadata = `${words.container}: ${manifest.container.name || manifest.container.id} · ${manifest.container.id} · ${words.revision}: ${revision}${draft ? ` · ${words.draft}` : ''}${authoredSuppliers.length ? ` · ${words.authoredSupplier}: ${authoredSuppliers.join(', ')}` : ''}`
  return {
    ...options,
    language,
    words,
    draft,
    metadata,
    title: metadata,
    createdAt: String(options.createdAt ?? new Date().toISOString()),
  }
}

/** Filename identity follows the selected revision, including a prominent draft prefix. */
export function containerWorkbookFileName(manifest, now = new Date()) {
  const context = contextFor(manifest)
  const name = fileSlug(manifest.container.name, 40) || 'container'
  const id = fileSlug(manifest.container.id, 64) || 'container'
  const revision = fileSlug(
    manifest.revisionId ?? `draft-r${manifest.revision ?? 'unknown'}`,
    80
  )
  return `${context.draft ? 'DRAFT-' : ''}packing-list-${exportStamp(now)}-${name}-${id}-${revision}.xlsx`
}

function frozenSource(row, manifest) {
  const order = (manifest.orders ?? []).find(
    (value) =>
      value.orderId === row.orderId &&
      (value.accountId || 'local') === (row.accountId || 'local')
  )
  return {
    ...clone(row),
    chineseCategory:
      row.chineseCategory ?? row.category ?? row.group?.category ?? '',
    record: clone(row.record ?? order?.record ?? null),
    preparation: clone(row.preparation ?? order?.preparation ?? null),
    preferences: clone(manifest.preferences ?? {}),
    containerId: manifest.container.id,
    revisionId: manifest.revisionId ?? null,
    draft: manifest.draft === true || manifest.status !== 'sealed',
  }
}
function referenceOf(carton, words) {
  const reference =
    carton.reference ??
    carton.cartonNumber ??
    carton.supplierLabel ??
    carton.cartonId ??
    carton.id
  return `${carton.labelOrigin === 'internal' ? `${words.internal} · ` : ''}${reference}`
}
function contentsText(carton, sourceById, words) {
  if (!Array.isArray(carton.contents)) return words.unknown
  const lines = carton.contents.map((part) => {
    const source = sourceById.get(
      identity({ ...part, accountId: carton.accountId })
    )
    return `${part.barcode ?? source?.barcode ?? source?.baseCode ?? part.entryId} × ${absent(part.quantity) ? words.unknown : exactWhole(part.quantity)} · ${source?.orderReference ?? part.orderId}`
  })
  for (const part of carton.unresolvedContents ?? [])
    lines.push(
      `${part.supplierCode ?? part.groupId ?? words.unknown} × ${absent(part.quantity) ? words.unknown : exactWhole(part.quantity)} · ${words.unknown}`
    )
  return lines.length ? lines.join('\n') : words.unknown
}
function coverageText(totals, words) {
  return ['weight', 'volume']
    .map((key) => {
      const coverage = totals[`${key}Coverage`]
      const value = totals[key]
      const subtotal = coverage?.knownSubtotal
      return `${words[key]}: ${absent(value) ? words.unknown : value}${coverage ? ` · ${words.known}: ${coverage.knownCount === 0 && coverage.totalCount !== 0 ? words.unknown : absent(subtotal) ? words.unknown : subtotal} · ${words.missing}: ${coverage.missingCount ?? words.unknown}` : ''}`
    })
    .join(' · ')
}
function markSource(carton, manifest) {
  const source = frozenSource(carton, manifest)
  const group = source.preparation?.groups?.find(
    (value) => value.id === carton.mark?.groupId
  )
  return {
    ...source,
    baseCode: carton.markCode ?? carton.baseCode ?? group?.baseCode ?? '',
    barcode: carton.markCode ?? carton.baseCode ?? group?.baseCode ?? '',
    chineseCategory:
      carton.chineseCategory ?? carton.category ?? group?.category ?? '',
    category:
      carton.category ?? carton.chineseCategory ?? group?.category ?? '',
    markCode: carton.markCode ?? carton.baseCode ?? group?.baseCode ?? '',
    group: clone(group ?? null),
    quantity: '1',
    known: 1,
    cartonId: carton.cartonId ?? carton.id,
    reference: carton.reference ?? carton.cartonId ?? carton.id,
  }
}
function attachReferences(sheet, cartons, physical, manifest, options) {
  const byId = new Map(
    cartons.map((carton) => [carton.cartonId ?? carton.id, carton])
  )
  const positions = new Map(
    physical.records.map((record) => [
      record.carton.cartonId ?? record.carton.id,
      record.row,
    ])
  )
  for (const product of sheet.products) {
    const source = product.source,
      row = sheet.rows[product.row - 1]
    const explicit = Array.isArray(source.cartonReferences)
      ? source.cartonReferences
      : null
    const references = explicit
      ? explicit
          .map((value) =>
            byId.get(
              typeof value === 'string' ? value : (value.cartonId ?? value.id)
            )
          )
          .filter(Boolean)
      : cartons.filter((carton) =>
          carton.contents?.some(
            (part) =>
              identity({ ...part, accountId: carton.accountId }) ===
              identity(source)
          )
        )
    const unknown = references.some(
      (carton) =>
        !Array.isArray(carton.contents) || carton.unresolvedContents?.length
    )
    const shared = references.some(
      (carton) => (carton.contents?.length ?? 0) > 1
    )
    const quantities = references.map(
      (carton) =>
        carton.contents?.find(
          (part) =>
            identity({ ...part, accountId: carton.accountId }) ===
            identity(source)
        )?.quantity
    )
    let capacity = textCell('')
    if (unknown) capacity = textCell(options.words.aggregate)
    else if (shared) capacity = textCell(options.words.shared)
    else if (
      quantities.length &&
      quantities.every((quantity) => !absent(quantity))
    )
      capacity = quantities.every(
        (quantity) => exactWhole(quantity) === exactWhole(quantities[0])
      )
        ? numberCell(quantities[0])
        : textCell(options.words.uneven)
    replaceCell(sheet, row, 'unitsPerCarton', capacity)
    const patterns = []
    const uniform = new Map()
    for (const carton of references) {
      const part = carton.contents?.find(
        (entry) =>
          identity({ ...entry, accountId: carton.accountId }) ===
          identity(source)
      )
      if (!part || absent(part.quantity)) {
        patterns.push(
          `${options.words.aggregate} · ${referenceOf(carton, options.words)}`
        )
        continue
      }
      if (carton.contents.length > 1) {
        const total = carton.contents.some((entry) => absent(entry.quantity))
          ? options.words.unknown
          : addExact(
              ...carton.contents.map((entry) => exactWhole(entry.quantity))
            )
        patterns.push(
          `${part.quantity} ${options.words.inShared} ${referenceOf(carton, options.words)} · ${total} ${options.words.totalPieces}`
        )
      } else
        uniform.set(
          exactWhole(part.quantity),
          (uniform.get(exactWhole(part.quantity)) ?? 0) + 1
        )
    }
    for (const [quantity, count] of uniform)
      patterns.unshift(`${count} × ${quantity}`)
    const names =
      source.cartonReferenceText ??
      references.map((carton) => referenceOf(carton, options.words)).join(', ')
    const value = [names, patterns.join(' + ')].filter(Boolean).join('\n')
    const target = references.length
      ? `'${physical.name}'!A${positions.get(references[0].cartonId ?? references[0].id)}`
      : null
    replaceCell(sheet, row, 'cartonReferences', {
      ...textCell(value),
      ...(target ? { hyperlink: target } : {}),
    })
    const codes = [
      ...new Set(references.map((carton) => carton.markCode).filter(Boolean)),
    ]
    const code =
      codes.length === 1
        ? codes[0]
        : references.length
          ? ''
          : (source.cartonMarkCode ?? source.baseCode ?? '')
    replaceCell(sheet, row, 'cartonMark', {
      ...textCell(
        code ||
          references
            .map(
              (carton) =>
                `${referenceOf(carton, options.words)} · ${carton.markCode ?? ''}`
            )
            .join('\n'),
        8
      ),
      ...(target ? { hyperlink: target } : {}),
    })
    product.hideMark = !code
    if (code) {
      const marked = references.find((carton) => carton.markCode === code)
      const frozen = marked ? markSource(marked, manifest) : source
      product.markSource = {
        ...source,
        baseCode: code,
        chineseCategory: frozen.chineseCategory ?? source.chineseCategory,
      }
    }
  }
}

function physicalWorksheet(manifest, options) {
  const columns = columnsFor(
    PACKING_CARTON_COLUMNS,
    options.cartonColumns,
    PACKING_CARTON_DEFAULT_COLUMNS
  )
  const sheet = blankSheet(
    options.words.sheets[1],
    columns,
    options,
    options.title,
    options.words.cartonNote
  )
  sheet.imageColumns = {
    mark: columns.findIndex((column) => column.key === 'cartonMark'),
  }
  if (sheet.imageColumns.mark < 0) sheet.imageColumns.mark = undefined
  sheet.records = []
  const sourceById = new Map(
    manifest.products.map((row) => [identity(row), row])
  )
  const styles = (key, total = false) =>
    /Volume$|^volume/.test(key)
      ? total
        ? 15
        : 14
      : /Weight$|^weight$/.test(key)
        ? total
          ? 13
          : 11
        : ['len', 'wid', 'ht'].includes(key)
          ? 16
          : total
            ? 7
            : 5
  for (const carton of manifest.cartons) {
    const content = contentsText(carton, sourceById, options.words)
    const values = {
      batch: textCell(referenceOf(carton, options.words)),
      cartonMark: textCell(carton.markCode ?? '', 8),
      contents: textCell(content),
      count: numberCell('1'),
      received: numberCell(null),
      loaded: numberCell('1'),
      len: numberCell(carton.len, 16),
      wid: numberCell(carton.wid, 16),
      ht: numberCell(carton.ht, 16),
      weightBasis: textCell(
        absent(carton.weight) ? options.words.unknown : options.words.perCarton
      ),
      weight: numberCell(carton.weight, 11),
      volumePerCarton: numberCell(carton.volume, 14),
      totalWeight: numberCell(carton.weight, 11),
      totalVolume: numberCell(carton.volume, 14),
      loadedWeight: numberCell(carton.weight, 11),
      loadedVolume: numberCell(carton.volume, 14),
    }
    const row = {
      number: sheet.rows.length + 1,
      kind: 'carton',
      height: Math.min(409, Math.max(83, content.split('\n').length * 15 + 16)),
      cells: columns.map((column) => values[column.key]),
    }
    const dimensionColumns = ['len', 'wid', 'ht'].map((key) =>
      columns.findIndex((column) => column.key === key)
    )
    if (
      dimensionColumns.every((index) => index >= 0) &&
      ['len', 'wid', 'ht'].every((key) => excelNumeric(carton[key])) &&
      excelNumeric(carton.volume)
    ) {
      const refs = dimensionColumns.map(
        (index) => `${columnName(index)}${row.number}`
      )
      const formula = `IF(AND(COUNT(${refs.join(',')})=3,${refs.map((ref) => `${ref}>0`).join(',')}),${refs.join('*')}/1000000,"")`
      for (const key of ['volumePerCarton', 'totalVolume', 'loadedVolume']) {
        const index = columns.findIndex((column) => column.key === key)
        if (index >= 0) row.cells[index].formula = formula
      }
    }
    sheet.rows.push(row)
    sheet.lastRow = row.number
    sheet.lastProductRow = row.number
    sheet.records.push({ carton: clone(carton), row: row.number })
    const source = markSource(carton, manifest)
    sheet.products.push({ source, row: row.number, hideMark: !source.baseCode })
  }
  if (!manifest.cartons.length) {
    sheet.filters = false
    fullRow(sheet, 'empty', options.words.noCartons)
  }
  if (options.includeTotals !== false) {
    const row = {
      number: sheet.rows.length + 1,
      kind: 'total',
      height: 32,
      cells: columns.map(() => textCell('', 7)),
    }
    for (const [key, value] of Object.entries({
      count: manifest.totals.cartons,
      loaded: manifest.totals.cartons,
      totalWeight: manifest.totals.weight,
      loadedWeight: manifest.totals.weight,
      totalVolume: manifest.totals.volume,
      loadedVolume: manifest.totals.volume,
    }))
      replaceCell(sheet, row, key, numberCell(value, styles(key, true)))
    if (
      manifest.cartons.length &&
      manifest.cartons.every((carton) => !absent(carton.volume))
    )
      for (const key of ['totalVolume', 'loadedVolume']) {
        const index = columns.findIndex((column) => column.key === key)
        if (
          index >= 0 &&
          excelNumeric(row.cells[index].value) &&
          sheet.records.every(
            (record) => sheet.rows[record.row - 1].cells[index]?.formula
          )
        ) {
          const first = sheet.records[0].row,
            last = sheet.records.at(-1).row
          row.cells[index].formula =
            `SUM(${columnName(index)}${first}:${columnName(index)}${last})`
        }
      }
    const label = columns.findIndex((column) =>
      ['batch', 'contents', 'cartonMark'].includes(column.key)
    )
    if (label >= 0) row.cells[label] = textCell(options.words.totals, 7)
    sheet.rows.push(row)
    sheet.lastRow = row.number
    sheet.totalRow = row.number
  }
  fullRow(sheet, 'coverage', coverageText(manifest.totals, options.words))
  const selected = new Set(manifest.cartons.map((carton) => carton.batchId))
  for (const batch of manifest.batches ?? [])
    if (
      selected.has(batch.id) &&
      ((batch.weightBasis === 'batch' && !absent(batch.weight)) ||
        !absent(batch.suppliedCbm))
    ) {
      const values = [
        `${options.words.evidence}: ${batch.id} · ${batch.count ?? options.words.unknown} ${options.words.sheets[1]}`,
      ]
      if (batch.weightBasis === 'batch' && !absent(batch.weight))
        values.push(`${options.words.combined}: ${batch.weight} kg`)
      if (!absent(batch.suppliedCbm))
        values.push(
          `${options.words.suppliedVolume}: ${batch.suppliedCbm} m³ · ${batch.volumeBasis === 'batch' ? options.words.batch : options.words.perCarton}`
        )
      fullRow(sheet, 'source-evidence', values.join(' · '))
    }
  for (const warning of manifest.warnings ?? []) {
    const value =
      typeof warning === 'string'
        ? warning
        : [
            warning.code,
            warning.message,
            warning.cartonId,
            warning.batchId,
            warning.orderId,
          ]
            .filter(Boolean)
            .join(' · ')
    fullRow(sheet, 'warning', `${options.words.warning}: ${value}`)
  }
  return sheet
}

function applyProductTotals(sheet, rows, totals, options) {
  if (sheet.totalRow) {
    const total = sheet.rows[sheet.totalRow - 1]
    for (const key of ['quantity', 'discount', 'effectiveAmount'])
      replaceCell(
        sheet,
        total,
        key,
        numberCell(
          totals[key] ?? (key === 'discount' ? sumKnown(rows, key) : null),
          key === 'quantity' ? 7 : 12
        )
      )
  }
  const orders = [
    ...new Set(
      rows.map((row) => JSON.stringify([row.accountId || 'local', row.orderId]))
    ),
  ]
  for (const [index, band] of sheet.rows
    .filter((row) => row.kind === 'order')
    .entries()) {
    const members = rows.filter(
      (row) =>
        JSON.stringify([row.accountId || 'local', row.orderId]) ===
        orders[index]
    )
    const reference = members[0]?.orderReference ?? members[0]?.orderId
    if (reference) {
      band.cells[0].value += `\n${options.words.order}: ${reference}`
      band.height = Math.max(54, band.height)
    }
    const freight = sumKnown(members, 'freightAllocated')
    if (freight !== null) {
      band.cells[0].value += `\n${options.words.freight}: ${freight}`
      band.height = Math.max(54, band.height)
    }
  }
}

/** Full frozen membership only: display selection/filter/scope never changes output. */
export function planContainerWorkbook(manifest, options = {}) {
  const settings = contextFor(manifest, options),
    frozen = clone(manifest)
  const sources = frozen.products.map((row) => frozenSource(row, frozen))
  const physical = physicalWorksheet(frozen, settings)
  const products = productWorksheet(
    sources,
    settings.words.sheets[0],
    settings,
    settings.words.note,
    settings.words.empty
  )
  attachReferences(products, frozen.cartons, physical, frozen, settings)
  for (const record of physical.records) {
    const source = products.products.find((product) =>
      record.carton.contents?.some(
        (part) =>
          identity({ ...part, accountId: record.carton.accountId }) ===
          identity(product.source)
      )
    )
    const position = physical.columns.findIndex(
      (column) => column.key === 'contents'
    )
    if (source && position >= 0)
      physical.rows[record.row - 1].cells[position].hyperlink =
        `'${products.name}'!A${source.row}`
  }
  applyProductTotals(products, sources, frozen.totals, settings)
  const left = frozen.leftBehind
  const leftSources = (left.products ?? []).map((row) =>
    frozenSource(row, frozen)
  )
  const remaining = productWorksheet(
    leftSources,
    settings.words.sheets[2],
    settings,
    settings.words.leftNote,
    settings.words.noLeft
  )
  applyProductTotals(remaining, leftSources, left.totals ?? {}, settings)
  const allSources = new Map(
    [...sources, ...leftSources].map((row) => [identity(row), row])
  )
  fullRow(remaining, 'left-cartons', settings.words.leftCartons, 6, 26)
  const leftPhysical = { name: remaining.name, records: [] }
  for (const carton of left.cartons ?? []) {
    const row = fullRow(
      remaining,
      'left-carton',
      `${referenceOf(carton, settings.words)} · ${carton.markCode ?? ''}\n${contentsText(carton, allSources, settings.words)}`
    )
    leftPhysical.records.push({ carton, row: row.number })
  }
  attachReferences(
    remaining,
    left.cartons ?? [],
    leftPhysical,
    frozen,
    settings
  )
  fullRow(remaining, 'unprepared-heading', settings.words.unprepared, 6, 26)
  for (const row of left.unprepared ?? [])
    fullRow(
      remaining,
      'unprepared',
      `${row.barcode ?? row.baseCode ?? row.entryId ?? row.groupId ?? settings.words.unknown} · ${row.orderReference ?? row.orderId ?? ''} · ${settings.words.quantity}: ${absent(row.quantity) ? settings.words.unknown : row.quantity}`
    )
  fullRow(
    remaining,
    'coverage',
    coverageText(left.totals ?? {}, settings.words)
  )
  return {
    ...products,
    sheets: [products, physical, remaining],
    container: clone(frozen.container),
    revisionId: frozen.revisionId ?? null,
    revision: frozen.revision ?? null,
    draft: settings.draft,
    totals: clone(frozen.totals),
    leftBehind: clone(left),
    fileName: containerWorkbookFileName(frozen, new Date(settings.createdAt)),
    preferences: clone(frozen.preferences ?? {}),
    warnings: clone(frozen.warnings ?? []),
  }
}

/** Raster preparation is injected; only frozen sources/preferences are supplied. */
export async function createContainerWorkbook(manifest, options = {}) {
  const plan = planContainerWorkbook(manifest, options)
  return createPreparedPackingWorkbook(plan, options)
}

/** Explicit detailed companion, never a backup and never an implicit UI opt-in. */
export function createContainerSummary(
  manifest,
  { file, exportedAt = new Date().toISOString() } = {}
) {
  const context = contextFor(manifest)
  if (typeof file !== 'string' || !file.trim())
    throw new Error('Supply the actual exported workbook filename')
  const left = manifest.leftBehind
  const records = new Map(
    (manifest.orders ?? []).map((order) => [
      JSON.stringify([order.accountId || 'local', order.orderId]),
      order.record,
    ])
  )
  const publicRow = (row) =>
    publicProduct({
      ...row,
      record:
        row.record ??
        records.get(JSON.stringify([row.accountId || 'local', row.orderId])),
    })
  return {
    format: SUMMARY_FORMAT,
    version: 3,
    kind: 'packing-list',
    scope: 'container-revision',
    exportedAt,
    files: [file, summaryFileName(file)],
    container: pick(manifest.container, [
      'id',
      'accountId',
      'name',
      'period',
      'loadingDate',
    ]),
    containerId: manifest.container.id,
    revisionId: manifest.revisionId ?? null,
    revision: manifest.revision ?? null,
    draft: context.draft,
    status: manifest.status,
    sealedAt: manifest.sealedAt ?? null,
    orders: (manifest.orders ?? []).map((order) => ({
      ...pick(order, [
        'accountId',
        'orderId',
        'orderReference',
        'availableBeforeQuantity',
        'loadedQuantity',
        'remainingQuantity',
      ]),
      ...publicSupplierIdentity(order),
    })),
    products: manifest.products.map(publicRow),
    cartons: manifest.cartons.map(publicCarton),
    cartonBatches: (manifest.batches ?? []).map(publicCarton),
    totals: clone(manifest.totals),
    leftBehind: {
      products: (left.products ?? []).map(publicRow),
      cartons: (left.cartons ?? []).map(publicCarton),
      unprepared: (left.unprepared ?? []).map(publicRow),
      totals: clone(left.totals ?? {}),
    },
    warnings: (manifest.warnings ?? []).map((warning) =>
      typeof warning === 'string'
        ? warning
        : pick(warning, [
            'code',
            'severity',
            'message',
            'orderId',
            'entryId',
            'cartonId',
            'batchId',
            'reportId',
            'revisionId',
            'count',
            'quantity',
            'difference',
          ])
    ),
  }
}

/** Print adapters retain source rows and physical IDs, never deduplicate by code. */
export function containerPrintRows(manifest, { kind = 'barcode' } = {}) {
  contextFor(manifest)
  if (kind === 'barcode')
    return manifest.products.map((row) => frozenSource(row, manifest))
  if (kind !== 'mark') throw new Error('Choose barcode or mark print rows')
  return manifest.cartons.map((carton) => markSource(carton, manifest))
}
