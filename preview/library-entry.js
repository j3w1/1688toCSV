import { startLibrary } from '../src/library.js'
import { createDemoRecords } from './library-fixture.js'
import { openDatabase } from '../src/database.js'
import { loadThumbnail } from '../src/images.js'
import {
  createReconciliationDraft,
  reconcileOrder,
  applyReconciliationCommand,
} from '../src/carton-reconciliation.js'

const records = createDemoRecords(document)
const repository = await openDatabase()
for (const record of records) {
  for (const item of record.snapshot.items) {
    item.title = item.description.startsWith('Scented')
      ? '合成香薰蜡烛'
      : item.description.startsWith('Glass')
        ? '合成无火香薰'
        : item.description.startsWith('Cotton')
          ? '合成棉绳收纳篮'
          : item.description.startsWith('Everyday')
            ? '合成帆布包'
            : '合成木质收纳盒'
    item.skuProperties = item.description
      .split('\n')[1]
      .split(' · ')
      .map((raw) => {
        const [label, ...value] = raw.split('：')
        return { label, value: value.join('：'), raw }
      })
      .filter((property) => property.label !== '货号')
  }
  await repository.saveSnapshot(record.snapshot)
}
// All examples use the production repository/planner, never a preview inventory.
const allOrders = await repository.listOrders()
const orderRefs = allOrders.map(({ accountId, snapshot }) => ({
  accountId: accountId || 'local',
  orderId: snapshot.orderId,
}))
const entryRefs = allOrders.flatMap(({ accountId, snapshot }) =>
  snapshot.items.map(({ entryId }) => ({
    accountId: accountId || 'local',
    orderId: snapshot.orderId,
    entryId,
  }))
)
const review = await repository.reviewPurchaseCodes({ orderRefs, entryRefs })
await repository.assignPurchaseCodes({
  plan: review.plan || review,
  expectedRevisions: review.expectedRevisions,
  intentId: 'synthetic-preview-codes-v1',
})
for (const ref of orderRefs.slice(0, 2)) {
  let context = await repository.getOrderReconciliation(ref)
  if (context.batches.some((batch) => !batch.deletedAt)) continue
  const values = Object.fromEntries(
    context.record.snapshot.items.map((item) => [item.entryId, '10'])
  )
  await repository.updateOrderCapacities({
    ...ref,
    values,
    expectedValues: Object.fromEntries(
      Object.keys(values).map((id) => [
        id,
        context.record.unitsPerCarton?.[id] ?? null,
      ])
    ),
    expectedObservedAt: context.record.snapshot.observedAt,
  })
  context = await repository.getOrderReconciliation(ref)
  let draft = createReconciliationDraft(context)
  for (const product of reconcileOrder({ ...context, draft }).products)
    if (product.remainder && BigInt(product.remainder) > 0n)
      draft = applyReconciliationCommand(
        draft,
        { type: 'separate', entryId: product.entryId },
        context
      )
  await repository.confirmOrderCartons({
    ...ref,
    draft,
    expectedRevisions: context.revisions,
    intentId: `synthetic-preview-confirm-${ref.orderId}`,
  })
}
let containers = await repository.listContainers({})
if (!containers.length) {
  const created = await repository.createContainer({
    name: 'Synthetic October 2026',
    period: '2026-10',
    intentId: 'synthetic-preview-container-v1',
  })
  const container = created.container || created
  await repository.includeContainerOrders({
    id: container.id,
    orderRefs: orderRefs.slice(0, 2),
    expectedRevision: container.revision,
    intentId: 'synthetic-preview-include-v1',
  })
}
document.querySelector('.local-label').textContent = 'Demo · synthetic orders'
await startLibrary(async (message) => {
  let data
  if (message.type === 'LIBRARY_QUERY')
    data = { orders: await repository.listOrders(), jobs: [] }
  else if (message.type === 'JOBS_QUERY') data = { jobs: [] }
  else if (message.type === 'IMAGE_GET')
    data = await loadThumbnail(message.url, repository)
  else if (message.type === 'LIBRARY_HISTORY') data = []
  else if (message.type === 'LIBRARY_NOTES') {
    data = await repository.setNotes(message.orderId, {
      notes: message.notes,
      tags: message.tags,
    })
  } else
    return {
      ok: false,
      error:
        'This is a synthetic preview. Use the installed extension for this action.',
    }
  return { ok: true, data }
}, repository)
