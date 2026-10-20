import {
  planSharedProductLink,
  planSharedProductUnlink,
  repeatProductCandidates,
} from './repeat-products.js'

/** Planning is read-only; expected revisions and source observations guard the atomic save. */
export function createRepeatProductsRepository({
  read,
  requested,
  savePreparations,
}) {
  async function load() {
    return read(['orders', 'preparations'], async (tx) => ({
      records: await requested(tx.objectStore('orders').getAll()),
      preparations: await requested(tx.objectStore('preparations').getAll()),
    }))
  }
  const options = (plan, preview) => ({
    expectedRevisions: plan.preparations.map(
      (preparation) => preparation.revision
    ),
    expectedSnapshots: plan.expectedSnapshots,
    preserveNaming: true,
    allowSharedProductEdits: true,
    capturePrevious: !preview,
    preview,
  })
  function assertPlan(plan, operation) {
    if (
      plan?.operation !== operation ||
      !Array.isArray(plan.preparations) ||
      !plan.preparations.length ||
      !Array.isArray(plan.expectedSnapshots) ||
      !plan.expectedSnapshots.length
    )
      throw new Error(
        'Review the repeat purchase changes before applying them.'
      )
  }
  return {
    async getRepeatProductCandidates(source) {
      return repeatProductCandidates({ source, ...(await load()) })
    },
    async previewRepeatProductLink({ source, target }) {
      const state = await load()
      const plan = {
        ...planSharedProductLink({ source, target, ...state }),
        operation: 'link',
      }
      // Let normal allocation/ownership validation reject current collisions.
      plan.preparations = await savePreparations(
        plan.preparations,
        options(plan, true)
      )
      return plan
    },
    async linkRepeatProduct(plan) {
      assertPlan(plan, 'link')
      return savePreparations(plan.preparations, options(plan, false))
    },
    async previewRepeatProductUnlink({ source }) {
      const state = await load()
      const plan = {
        ...planSharedProductUnlink({ source, ...state }),
        operation: 'unlink',
      }
      const before = state.preparations.find(
        (preparation) =>
          preparation.orderId === source.orderId &&
          preparation.accountId === source.accountId
      )
      plan.preparations = await savePreparations(
        plan.preparations,
        options(plan, true)
      )
      const after = plan.preparations[0]
      const oldGroup = before.groups.find(
        (group) => group.id === source.groupId
      )
      const nextGroup = after.groups.find(
        (group) => group.id === source.groupId
      )
      const record = state.records.find(
        (entry) =>
          entry.snapshot.orderId === source.orderId &&
          (entry.snapshot.accountId || 'local') === source.accountId
      )
      plan.changes = oldGroup.variants.flatMap((variant) =>
        variant.entryIds.map((entryId) => {
          const item = record.snapshot.items.find(
            (item) => item.entryId === entryId
          )
          const next = nextGroup.variants.find(
            (entry) => entry.id === variant.id
          )
          return {
            accountId: source.accountId,
            orderId: source.orderId,
            entryId,
            sourceType: record.snapshot.sourceType,
            name: item.description || item.title,
            photo: item,
            features: structuredClone(
              record.productWorkflow?.[entryId]?.features || {}
            ),
            quantity: String(item.quantity),
            price: item.price,
            before:
              oldGroup.baseCode + variant.variantSuffix + variant.sizeSuffix,
            after: nextGroup.baseCode + next.variantSuffix + next.sizeSuffix,
          }
        })
      )
      return plan
    },
    async unlinkRepeatProduct(plan) {
      assertPlan(plan, 'unlink')
      return savePreparations(plan.preparations, options(plan, false))
    },
  }
}
