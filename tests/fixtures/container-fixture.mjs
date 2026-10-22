import { centsToMoney, lineGrossCents } from '../../src/money.js'
import {
  createPreparation,
  validatePackingPreferences,
} from '../../src/packing-model.js'

export const SYNTHETIC_PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2WZ4kAAAAASUVORK5CYII='
export function syntheticOrder(
  orderId = '1001',
  quantity = '100',
  overrides = {}
) {
  const amount = centsToMoney(lineGrossCents('10.00', quantity))
  const snapshot = {
    schemaVersion: 1,
    accountId: 'local',
    orderId,
    sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
    sellerName: 'Synthetic supplier',
    sellerMemberLogin: 'synthetic-factory',
    status: 'Completed',
    purchasedAt: '2026-09-04T12:00:00+08:00',
    observedAt: '2026-10-01T12:00:00.000Z',
    items: [
      {
        entryId: '2001',
        title: 'Synthetic cups',
        description: 'Synthetic cups',
        price: '10.00',
        quantity,
        thumbnail: SYNTHETIC_PHOTO,
        sourceDiscount: '0.00',
        allocatedDiscount: '0.00',
        discount: '0.00',
      },
    ],
    totals: {
      goodsGross: amount,
      goodsNet: amount,
      sourceDiscount: '0.00',
      shipping: '0.00',
      orderAdjustment: '0.00',
      payable: amount,
    },
  }
  return {
    snapshot: { ...snapshot, ...overrides },
    notes: '',
    tags: [],
    changedEntryIds: [],
  }
}
export function syntheticBatch(
  orderId = '1001',
  count = 10,
  quantity = '100',
  overrides = {}
) {
  return {
    id: `batch-${orderId}`,
    accountId: 'local',
    orderId,
    storeId: JSON.stringify(['1688', 'synthetic-factory']),
    month: '2026-09',
    groups: [],
    contents: [{ orderId, entryId: '2001', quantity }],
    count,
    packingBasis: count === 1 ? 'exact' : 'uniform',
    unresolvedContents: [],
    len: '',
    wid: '',
    ht: '',
    weight: '',
    weightBasis: 'carton',
    suppliedCbm: '',
    volumeBasis: 'carton',
    received: null,
    loaded: null,
    labelOrigin: 'internal',
    provenance: {
      kind: 'manual-confirmed',
      reason: 'Synthetic physical facts',
    },
    revision: 1,
    updatedAt: '2026-10-02T12:00:00.000Z',
    ...overrides,
  }
}

// Interface fixture, not a shipment calculator or a claim of database proof.
// Ten confirmed 10-piece boxes; this revision loads the first two and leaves eight.
export function syntheticManifest() {
  const record = syntheticOrder()
  const preparation = createPreparation(record.snapshot, '2026-09')
  const group = preparation.groups[0]
  group.baseCode = 'CE26090101'
  group.spanishName = 'VASOS SINTETICOS'
  group.category = '杯'
  const batch = syntheticBatch('1001', 10, '100', {
    groups: [{ orderId: '1001', groupId: group.id }],
    mark: { orderId: '1001', groupId: group.id },
    weight: '1.25',
    len: '50',
    wid: '50',
    ht: '50',
  })
  const cartons = Array.from({ length: 10 }, (_, index) => ({
    id: `unit:${batch.id}:${index + 1}`,
    cartonId: `unit:${batch.id}:${index + 1}`,
    batchId: batch.id,
    accountId: 'local',
    orderId: '1001',
    index,
    count: 1,
    state: index < 2 ? 'loaded' : 'left-behind',
    reference: `Internal ${index + 1}`,
    labelOrigin: 'internal',
    packingBasis: 'uniform',
    batchCount: 10,
    revision: 1,
    contents: [{ orderId: '1001', entryId: '2001', quantity: '10' }],
    unresolvedContents: [],
    weight: '1.25',
    volume: '0.125',
    len: '50',
    wid: '50',
    ht: '50',
    mark: batch.mark,
    markCode: group.baseCode,
    record,
    preparation,
  }))
  const coverage = (count, knownSubtotal) => ({
    knownCount: count,
    missingCount: 0,
    totalCount: count,
    complete: true,
    knownSubtotal,
  })
  const product = {
    accountId: 'local',
    orderId: '1001',
    entryId: '2001',
    sellerName: 'Synthetic supplier',
    sellerMemberLogin: 'synthetic-factory',
    orderReference: '1001',
    source: '1688',
    title: 'Synthetic cups',
    description: 'Synthetic cups',
    spanishName: group.spanishName,
    category: group.category,
    material: '',
    size: '',
    baseCode: group.baseCode,
    barcode: group.baseCode,
    packingMonth: '2026-09',
    thumbnail: SYNTHETIC_PHOTO,
    photos: [SYNTHETIC_PHOTO],
    quantity: '20',
    loadedQuantity: '20',
    purchasedQuantity: '100',
    availableBeforeQuantity: '100',
    remainingQuantity: '80',
    price: '10.00',
    sourcePrice: '10.00',
    sourceUnitPrice: '10.00',
    effectiveUnitPrice: '10.00',
    discount: '0.00',
    sourceDiscount: '0.00',
    allocatedDiscount: '0.00',
    sourceAmount: '200.00',
    effectiveAmount: '200.00',
    additionalCharge: '0.00',
    featureCharge: '0.00',
    linkedPaymentCharge: '0.00',
    freightAllocated: '0.00',
    cartons: '2',
    containingCartonCount: 2,
    additiveCartonCount: 2,
    cartonReferences: cartons.slice(0, 2).map((carton) => carton.id),
    cartonReferenceText: 'Internal 1, Internal 2',
    cartonMarkCode: group.baseCode,
    allocatedWeight: '2.5',
    allocatedVolume: '0.25',
    measurementAllocationBasis: 'allocated',
    record,
    preparation,
    group,
    variant: group.variants[0],
  }
  const leftProduct = {
    ...product,
    quantity: '80',
    loadedQuantity: '0',
    sourceAmount: '800.00',
    effectiveAmount: '800.00',
    cartons: '8',
    containingCartonCount: 8,
    additiveCartonCount: 8,
    cartonReferences: cartons.slice(2).map((carton) => carton.id),
    cartonReferenceText: 'Internal 3–10',
    allocatedWeight: '10',
    allocatedVolume: '1',
  }
  return {
    format: '1688-container-manifest',
    version: 1,
    container: {
      id: 'synthetic-container',
      accountId: 'local',
      name: 'Synthetic October',
      period: '2026-10',
      loadingDate: '2026-10-20',
    },
    revisionId: 'synthetic-container/r1',
    revision: 1,
    draft: false,
    status: 'sealed',
    sealedAt: '2026-10-20T12:00:00.000Z',
    orders: [
      {
        accountId: 'local',
        orderId: '1001',
        record,
        preparation,
        availableBeforeQuantity: '100',
        loadedQuantity: '20',
        remainingQuantity: '80',
        cartons,
        products: [product],
      },
    ],
    products: [product],
    cartons: cartons.slice(0, 2),
    batches: [batch],
    leftBehind: {
      products: [leftProduct],
      cartons: cartons.slice(2),
      unprepared: [],
      totals: {
        orders: 1,
        products: 1,
        quantity: '80',
        cartons: 8,
        weight: '10',
        volume: '1',
        weightCoverage: coverage(8, '10'),
        volumeCoverage: coverage(8, '1'),
      },
    },
    totals: {
      orders: 1,
      products: 1,
      quantity: '20',
      cartons: 2,
      weight: '2.5',
      volume: '0.25',
      sourceAmount: '200.00',
      merchandiseValue: '200.00',
      effectiveAmount: '200.00',
      additionalCharge: '0.00',
      featureCharge: '0.00',
      linkedPaymentCharge: '0.00',
      freightAllocated: '0.00',
      weightCoverage: coverage(2, '2.5'),
      volumeCoverage: coverage(2, '0.25'),
    },
    preferences: validatePackingPreferences({}),
    media: { imageRefs: [SYNTHETIC_PHOTO] },
    warnings: [],
  }
}
