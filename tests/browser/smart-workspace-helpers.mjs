import { expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

/** Synthetic source facts enter through the real repository, never IDB writes. */
export async function seedSmartOrder(
  extension,
  { count = 2, quantity = '100', physical = false, uneven = false } = {}
) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const snapshot = structuredClone(records[0].snapshot)
  snapshot.orderId = '100000000000000001'
  snapshot.accountId = 'local'
  snapshot.sellerName = 'Synthetic smart cartons'
  snapshot.sellerMemberLogin = 'synthetic-smart-cartons'
  snapshot.purchasedAt = '2026-09-12T12:00:00+08:00'
  snapshot.observedAt = '2026-10-22T12:00:00.000Z'
  snapshot.sourceUrl = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${snapshot.orderId}`
  snapshot.items = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(snapshot.items[0]),
    entryId: `entry-${index}`,
    title: `合成商品 ${index + 1}`,
    description: `Synthetic source ${index + 1}\n原始文本 ${index + 1}`,
    productNumber: `SYN-${index + 1}`,
    skuProperties: [],
    quantity: uneven ? '63' : quantity,
    price: '2.00',
    sourceDiscount: '0.00',
    allocatedDiscount: '0.00',
    discount: '0.00',
  }))
  const total = (
    BigInt(uneven ? '63' : quantity) *
    BigInt(count) *
    200n
  ).toString()
  const yuan = `${total.slice(0, -2) || '0'}.${total.slice(-2).padStart(2, '0')}`
  snapshot.totals = {
    goodsGross: yuan,
    shipping: '0.00',
    sourceDiscount: '0.00',
    orderAdjustment: '0.00',
    goodsNet: yuan,
    payable: yuan,
  }
  return extension.inspector.evaluate(
    async ({ snapshot, physical, uneven }) => {
      const repository = await window.testRepository,
        planner = window.testPlanner,
        ref = { accountId: 'local', orderId: snapshot.orderId }
      await repository.saveSnapshot(snapshot)
      const review = await repository.reviewPurchaseCodes({
        orderRefs: [ref],
        entryRefs: snapshot.items.map(({ entryId }) => ({ ...ref, entryId })),
      })
      await repository.assignPurchaseCodes({
        plan: review.plan || review,
        expectedRevisions: review.expectedRevisions,
        intentId: crypto.randomUUID(),
      })
      let context = await repository.getOrderReconciliation(ref)
      const preparation = structuredClone(context.preparation)
      for (const [index, group] of preparation.groups.entries()) {
        group.spanishName = `SYNTHETIC ${index + 1}`
        group.category = '合成品'
      }
      await repository.savePreparations([preparation], {
        expectedRevisions: [preparation.revision],
      })
      context = await repository.getOrderReconciliation(ref)
      if (physical) {
        const values = Object.fromEntries(
          snapshot.items.map((item) => [item.entryId, '45'])
        )
        await repository.updateOrderCapacities({
          ...ref,
          values,
          expectedValues: Object.fromEntries(
            snapshot.items.map((item) => [item.entryId, null])
          ),
          expectedObservedAt: snapshot.observedAt,
        })
        context = await repository.getOrderReconciliation(ref)
        let draft = planner.createReconciliationDraft(context)
        if (uneven) {
          const pieces = ['13', '12', '11', '9', '9', '9'],
            weights = ['16.75', '14.62', '10.40', '5.63', '5.18', '4.64'],
            dimensions = [
              ['60', '50', '40'],
              ['60', '50', '40'],
              ['50', '43', '36'],
              ['48', '37', '27'],
              ['48', '37', '27'],
              ['48', '37', '27'],
            ]
          draft.capacities = {}
          draft.cartons = pieces.map((quantity, index) => ({
            id: `synthetic-uneven-${index}`,
            accountId: ref.accountId,
            orderId: ref.orderId,
            count: 1,
            packingBasis: 'exact',
            labelOrigin: 'reported',
            cartonNumber: String(index + 1),
            contents: [
              {
                orderId: ref.orderId,
                entryId: snapshot.items[0].entryId,
                quantity,
              },
            ],
            unresolvedContents: [],
            len: dimensions[index][0],
            wid: dimensions[index][1],
            ht: dimensions[index][2],
            weight: weights[index],
            weightBasis: 'carton',
            draftKind: 'manual',
          }))
        } else
          for (const product of planner.reconcileOrder({ ...context, draft })
            .products)
            if (product.remainder && BigInt(product.remainder) > 0n)
              draft = planner.applyReconciliationCommand(
                draft,
                { type: 'separate', entryId: product.entryId },
                context
              )
        await repository.confirmOrderCartons({
          ...ref,
          draft,
          expectedRevisions: context.revisions,
          intentId: crypto.randomUUID(),
        })
      }
      return ref
    },
    { snapshot, physical, uneven }
  )
}

export async function openSmartLibrary(extension) {
  const page = await extension.context.newPage()
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(
    page.locator('#sheet-body tr[data-selection-key]').first()
  ).toBeVisible()
  return page
}

export async function createSmartContainer(extension, orderRefs) {
  return extension.inspector.evaluate(async (orderRefs) => {
    const repository = await window.testRepository,
      created = await repository.createContainer({
        name: 'Synthetic container October',
        period: '2026-10',
        intentId: crypto.randomUUID(),
      }),
      container = created.container || created
    await repository.includeContainerOrders({
      id: container.id,
      orderRefs,
      expectedRevision: container.revision,
      intentId: crypto.randomUUID(),
    })
    return container.id
  }, orderRefs)
}
