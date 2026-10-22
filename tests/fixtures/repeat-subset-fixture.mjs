import {
  activePackingState,
  createPreparation,
  packingCheckpoint,
} from '../../src/packing-model.js'

/** Synthetic single-size reorder of one variant in an existing three-size product. */
export function repeatSubsetFixture() {
  const photo =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
  const records = [
    [
      ['55cm', '3'],
      ['70cm', '4'],
      ['90cm', '5'],
    ],
    [['55cm', '27']],
  ].map((sizes, index) => {
    const items = sizes.map(([size, quantity], row) => ({
      entryId: String(row + 1),
      title: 'Synthetic planter',
      description: `Synthetic planter · ${size}`,
      skuProperties: [{ label: '尺寸', value: size }],
      thumbnail: photo,
      quantity,
      price: index ? '10.00' : '12.00',
      sourceDiscount: '0.00',
      allocatedDiscount: '0.00',
      discount: '0.00',
    }))
    const gross = items
      .reduce(
        (sum, item) => sum + Number(item.quantity) * Number(item.price),
        0
      )
      .toFixed(2)
    return {
      snapshot: {
        schemaVersion: 1,
        accountId: 'local',
        orderId: index ? '8805' : '8801',
        sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${index ? '8805' : '8801'}`,
        sellerName: 'Synthetic repeat-size supplier',
        sellerMemberLogin: 'synthetic-repeat-size-store',
        observedAt: '2026-10-21T00:00:00.000Z',
        purchasedAt: '2026-10-20T12:00:00+08:00',
        status: 'Completed',
        items,
        totals: {
          goodsGross: gross,
          shipping: '0.00',
          sourceDiscount: '0.00',
          orderAdjustment: '0.00',
          goodsNet: gross,
          payable: gross,
        },
      },
      revision: 1,
      notes: '',
      tags: [],
      changedEntryIds: [],
      removedEntryIds: [],
      changedAt: '2026-10-21T00:00:00.000Z',
      lastCheckedAt: '2026-10-21T00:00:00.000Z',
    }
  })
  const preparations = records.map((record, index) => {
    const draft = createPreparation(record.snapshot, '2026-10')
    const group = draft.groups[0]
    group.baseCode = index ? 'CE26101005' : 'CE26101001'
    group.spanishName = 'MACETA'
    group.category = '花盆'
    for (const variant of group.variants) {
      const item = record.snapshot.items.find((item) =>
        variant.entryIds.includes(item.entryId)
      )
      variant.size = item.skuProperties[0].value
      variant.needsSizeMapping = false
      variant.variantSuffix = ''
      variant.sizeSuffix = index
        ? ''
        : { '55cm': 'S', '70cm': 'M', '90cm': 'L' }[variant.size]
    }
    draft.revision = 1
    draft.defaultPacking = packingCheckpoint(draft)
    return draft
  })
  const state = activePackingState(preparations)
  const ref = (index) => ({
    accountId: 'local',
    orderId: preparations[index].orderId,
    groupId: preparations[index].groups[0].id,
  })
  return { records, preparations, ...state, ref }
}
