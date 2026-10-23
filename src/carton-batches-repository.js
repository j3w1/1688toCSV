import {
  validateCartonBatch,
  assertCartonBatchContext,
  createLegacyCartonBatches,
  mergeCartonBatchRecords,
  cartonBatchIssues,
  assertCartonBatchEvidence,
  assertSingleOrderCarton,
} from './carton-batches.js'
import {
  retainCartonEvidence,
  transitionPhysicalMark,
  physicalMarkReadback,
} from './physical-mark-aliases.js'

/** The collection owns physical cartons across purchases; order annotations are source evidence. */
export function createCartonBatchesRepository({
  read,
  write,
  requested,
  nextEditTimestamp,
  guardChanges = async () => {},
}) {
  const stores = [
    'orders',
    'history',
    'preparations',
    'cartonBatches',
    'issuedCodes',
  ]
  async function state(tx) {
    return {
      records: await requested(tx.objectStore('orders').getAll()),
      history: await requested(tx.objectStore('history').getAll()),
      preparations: await requested(tx.objectStore('preparations').getAll()),
      batches: await requested(tx.objectStore('cartonBatches').getAll()),
      issuedCodes:
        (await requested(tx.objectStore('issuedCodes').getAll())) || [],
    }
  }
  async function seed(tx, loaded) {
    const value = loaded || (await state(tx))
    const identities = new Set(value.batches.map((batch) => batch.id))
    const known = new Set(
      value.batches.flatMap((batch) => batch.legacyKeys || [])
    )
    const occupied = new Set(
      value.batches.flatMap((batch) =>
        batch.contents.map((item) =>
          JSON.stringify([batch.accountId, item.orderId, item.entryId])
        )
      )
    )
    for (const batch of createLegacyCartonBatches(
      value.records,
      value.preparations,
      { physicalEvidenceOnly: true }
    )) {
      if (
        identities.has(batch.id) ||
        batch.legacyKeys.some((key) => known.has(key)) ||
        batch.contents.some((item) =>
          occupied.has(
            JSON.stringify([batch.accountId, item.orderId, item.entryId])
          )
        )
      )
        continue
      tx.objectStore('cartonBatches').put(batch)
      value.batches.push(batch)
      identities.add(batch.id)
      for (const key of batch.legacyKeys) known.add(key)
      for (const item of batch.contents)
        occupied.add(
          JSON.stringify([batch.accountId, item.orderId, item.entryId])
        )
    }
    return value
  }
  async function apply(
    tx,
    changes,
    { records, preparations, allowReview = false } = {}
  ) {
    const loaded = await state(tx)
    const previous = new Map(loaded.batches.map((batch) => [batch.id, batch]))
    const next = new Map(previous),
      result = []
    if (
      !Array.isArray(changes) ||
      new Set(changes.map((change) => change.after?.id || change.batch?.id))
        .size !== changes.length
    )
      throw new Error('Edit each carton batch once in a transaction')
    for (const change of changes) {
      const raw = change.after || change.batch,
        before = previous.get(raw?.id),
        expected =
          change.expectedRevision ??
          change.before?.revision ??
          raw?.revision ??
          0
      if ((before?.revision ?? 0) !== expected) {
        const error = new Error(
          'These cartons changed in another tab. Reload the carton list before saving.'
        )
        error.code = 'CARTON_BATCH_CONFLICT'
        throw error
      }
      const updatedAt = nextEditTimestamp(before?.updatedAt)
      const batch = validateCartonBatch({
        ...retainCartonEvidence(
          before,
          transitionPhysicalMark(
            before,
            raw,
            loaded.preparations,
            preparations || loaded.preparations,
            {
              decision: change.physicalMarkResolution,
              restoreHistory: change.restorePhysicalMarkHistory,
              updatedAt,
              issuedCodes: loaded.issuedCodes,
            }
          )
        ),
        revision: (before?.revision || 0) + 1,
        updatedAt,
        ...(raw?.deletedAt ? { deletedAt: updatedAt } : {}),
        ...(before?.legacyKeys?.length
          ? {
              legacyKeys: [
                ...new Set([...(raw.legacyKeys || []), ...before.legacyKeys]),
              ],
            }
          : {}),
      })
      if (before?.deletedAt && !change.restore && !batch.deletedAt)
        throw new Error(
          'This carton batch was removed. Reload before restoring it.'
        )
      next.set(batch.id, batch)
      result.push(batch)
    }
    await guardChanges(
      tx,
      result.map((batch) => ({ after: batch }))
    )
    assertCartonBatchEvidence([...next.values()], records || loaded.records, {
      history: loaded.history,
    })
    for (const batch of result) {
      assertSingleOrderCarton(batch)
      if (allowReview && batch.needsReview) continue
      assertCartonBatchContext(
        batch,
        records || loaded.records,
        preparations || loaded.preparations,
        [...next.values()]
      )
    }
    for (const batch of result) tx.objectStore('cartonBatches').put(batch)
    return result
  }
  async function restore(tx, incoming) {
    const store = tx.objectStore('cartonBatches'),
      previous = await requested(store.getAll())
    const merged = mergeCartonBatchRecords(previous, incoming)
    await guardChanges(
      tx,
      merged
        .filter((batch) => {
          const before = previous.find((old) => old.id === batch.id)
          return before && JSON.stringify(before) !== JSON.stringify(batch)
        })
        .map((after) => ({ after }))
    )
    const loaded = await state(tx)
    assertCartonBatchEvidence(merged, loaded.records, {
      history: loaded.history,
    })
    const old = new Map(previous.map((batch) => [batch.id, batch]))
    for (const batch of merged) {
      const needsReview =
        cartonBatchIssues(batch, loaded.records, loaded.preparations, merged)
          .length > 0
      if (old.get(batch.id) !== batch || (needsReview && !batch.needsReview))
        store.put(needsReview ? { ...batch, needsReview: true } : batch)
    }
    return seed(tx)
  }
  return {
    seed,
    apply,
    restore,
    api: {
      async listCartonBatches({
        accountId = 'local',
        month,
        storeId,
        includeDeleted = false,
      } = {}) {
        return write(
          stores,
          async (tx) => {
            const loaded = await seed(tx)
            return loaded.batches
              .filter(
                (batch) =>
                  batch.accountId === accountId &&
                  (!month || batch.month === month) &&
                  (!storeId || batch.storeId === storeId) &&
                  (includeDeleted || !batch.deletedAt)
              )
              .map((batch) => ({
                ...batch,
                ...(batch.physicalMark
                  ? physicalMarkReadback(batch, loaded.preparations)
                  : {}),
                ...(cartonBatchIssues(
                  batch,
                  loaded.records,
                  loaded.preparations,
                  loaded.batches
                ).length
                  ? { needsReview: true }
                  : {}),
              }))
          },
          { notify: false }
        )
      },
      async saveCartonBatch(
        batch,
        { expectedRevision = batch.revision ?? 0 } = {}
      ) {
        return write(
          stores,
          async (tx) =>
            (await apply(tx, [{ after: batch, expectedRevision }]))[0]
        )
      },
      async saveCartonBatches(changes) {
        return write(stores, (tx) => apply(tx, changes))
      },
      async removeCartonBatches(batches) {
        return write(stores, (tx) =>
          apply(
            tx,
            batches.map((batch) => ({
              after: { ...batch, deletedAt: new Date().toISOString() },
              expectedRevision: batch.revision,
            }))
          )
        )
      },
      async removeCartonBatch(
        batch,
        { expectedRevision = batch.revision } = {}
      ) {
        return write(
          stores,
          async (tx) =>
            (
              await apply(tx, [
                {
                  after: { ...batch, deletedAt: new Date().toISOString() },
                  expectedRevision,
                },
              ])
            )[0]
        )
      },
    },
  }
}
