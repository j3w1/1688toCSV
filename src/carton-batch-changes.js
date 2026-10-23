import { groupPackingMonth } from './packing-model.js'
import {
  cartonBatchIssues,
  cartonBatchMark,
  cartonBatchMarkOwnerChoices,
} from './carton-batches.js'
import { repeatProductStoreIdentity } from './repeat-products.js'
import {
  transitionPhysicalMark,
  physicalMarkResolutionChoices,
  physicalMarkResolutionRequired,
  physicalMarkReadback,
  physicalMarkSupersessionState,
} from './physical-mark-aliases.js'
export { resolvePhysicalMarkChange } from './physical-mark-aliases.js'

const key = (accountId, orderId, entryId) =>
  JSON.stringify([accountId || 'local', orderId, entryId])
const refKey = (reference) =>
  JSON.stringify([reference.orderId, reference.groupId])

function owners(preparations) {
  const result = new Map()
  for (const preparation of preparations)
    for (const group of preparation.groups)
      for (const variant of group.variants)
        for (const entryId of variant.entryIds)
          result.set(key(preparation.accountId, preparation.orderId, entryId), {
            preparation,
            group,
            variant,
          })
  return result
}

function ownership(batch, values) {
  return batch.contents.map((item) => {
    const owner = values.get(key(batch.accountId, item.orderId, item.entryId))
    if (!owner) return null
    return {
      orderId: owner.preparation.orderId,
      groupId: owner.group.id,
      month: groupPackingMonth(owner.preparation, owner.group),
      sharedProductId: owner.group.sharedProductId || '',
      sharedStoreId: owner.group.sharedStoreId || '',
      baseCode: owner.group.baseCode,
    }
  })
}

function references(values) {
  return [
    ...new Map(
      values.filter(Boolean).map(({ orderId, groupId }) => {
        const reference = { orderId, groupId }
        return [refKey(reference), reference]
      })
    ).values(),
  ]
}

const distinct = (values) => [...new Set(values.filter(Boolean))]

function markOwner(batch, preparations, records) {
  const mark = cartonBatchMark(batch),
    preparation = preparations.find(
      (entry) =>
        entry.accountId === batch.accountId && entry.orderId === mark?.orderId
    ),
    group = preparation?.groups.find((entry) => entry.id === mark?.groupId),
    record = records.find(
      (entry) =>
        entry.snapshot.accountId === batch.accountId &&
        entry.snapshot.orderId === mark?.orderId
    )
  return group && record
    ? {
        ...mark,
        month: groupPackingMonth(preparation, group),
        baseCode: group.baseCode,
        storeId: repeatProductStoreIdentity(record),
      }
    : null
}

/**
 * Plan physical changes against the complete final preparation set, before review.
 * This never allocates individual boxes, copies month confirmations, or writes data.
 */
export function planCartonBatchChanges({
  batches,
  records,
  beforePreparations,
  afterPreparations,
  issuedCodes = [],
}) {
  const beforeOwners = owners(beforePreparations)
  const afterOwners = owners(afterPreparations)
  const changes = [],
    before = {},
    after = {},
    reviews = []
  for (const batch of batches) {
    if (batch.deletedAt) continue
    const previous = ownership(batch, beforeOwners)
    const next = ownership(batch, afterOwners)
    const previousMark = markOwner(batch, beforePreparations, records),
      nextMark = markOwner(batch, afterPreparations, records),
      ownershipChanged =
        JSON.stringify(previous) !== JSON.stringify(next) ||
        JSON.stringify(previousMark) !== JSON.stringify(nextMark)
    const originalIssues = cartonBatchIssues(
      batch,
      records,
      beforePreparations,
      batches
    )
    const resultingIssues = cartonBatchIssues(
      batch,
      records,
      afterPreparations,
      batches
    )
    if (!resultingIssues.length && !ownershipChanged) continue
    // A source-refresh/legacy issue alone must not block unrelated subsequent edits.
    if ((batch.needsReview || originalIssues.length) && !ownershipChanged)
      continue

    const destinationGroups = references(next)
    const candidate = {
      ...structuredClone(batch),
      groups: destinationGroups.length
        ? destinationGroups
        : structuredClone(batch.groups),
    }
    const originalMark = cartonBatchMark(batch),
      markedPreparation = beforePreparations.find(
        (value) =>
          value.accountId === batch.accountId &&
          value.orderId === originalMark?.orderId
      ),
      markedGroup = markedPreparation?.groups.find(
        (value) => value.id === originalMark?.groupId
      ),
      markedEntries =
        markedGroup?.variants.flatMap((variant) => variant.entryIds) || [],
      markedOwners = markedEntries.map((id) => {
        const owner = afterOwners.get(
          key(batch.accountId, originalMark.orderId, id)
        )
        return owner
          ? {
              orderId: owner.preparation.orderId,
              groupId: owner.group.id,
              month: groupPackingMonth(owner.preparation, owner.group),
            }
          : null
      }),
      markedDestinations = references(markedOwners),
      markReanchor =
        !nextMark &&
        previousMark &&
        markedEntries.length > 0 &&
        markedOwners.every(Boolean) &&
        markedDestinations.length === 1 &&
        markedDestinations[0].orderId === previousMark.orderId &&
        (batch.orderId ||
          markedOwners.every((owner) => owner.month === batch.month))
    // One complete same-order destination is an ownership reanchor, never a
    // claim that the operator has replaced the mark already on the cartons.
    if (
      markReanchor &&
      (batch.mark ||
        refKey(candidate.groups[0]) !== refKey(markedDestinations[0]))
    )
      candidate.mark = structuredClone(markedDestinations[0])
    const mark = cartonBatchMark(batch),
      intactMark =
        nextMark &&
        nextMark.baseCode &&
        (batch.orderId || nextMark.month === batch.month) &&
        nextMark.storeId === batch.storeId
    // Changing which product owns a code must not silently change a physical
    // carton's printed mark, including a mark with no pieces in its contents.
    if (intactMark && refKey(candidate.groups[0]) !== refKey(mark))
      candidate.mark = structuredClone(mark)
    const legacyReanchor =
      !batch.mark &&
      !nextMark &&
      destinationGroups.length === 1 &&
      next.every((owner) => owner?.baseCode === previousMark?.baseCode)
    const intact = next.every(Boolean)
    const sameMonth =
      intact &&
      (batch.orderId || next.every((owner) => owner.month === batch.month))
    const candidateIssues =
      intact && sameMonth
        ? cartonBatchIssues(candidate, records, afterPreparations, batches)
        : resultingIssues
    const canReanchor =
      intact &&
      sameMonth &&
      (intactMark || legacyReanchor || markReanchor) &&
      !candidateIssues.length
    // Uncertain partitions retain their exact original physical evidence, not a split
    // copy of counts or confirmations attributed to every resulting code group.
    const proposed = transitionPhysicalMark(
      batch,
      canReanchor
        ? candidate
        : { ...structuredClone(batch), needsReview: true },
      beforePreparations,
      afterPreparations,
      { issuedCodes }
    )
    const reason = !intact
      ? 'missing-products'
      : !sameMonth
        ? 'packing-month'
        : !intactMark && !legacyReanchor
          ? 'carton-mark'
          : previous.some(
                (owner, index) =>
                  owner?.sharedProductId &&
                  owner.sharedProductId !== next[index]?.sharedProductId
              )
            ? 'shared-link'
            : 'code-groups'
    before[batch.id] = structuredClone(batch)
    after[batch.id] = proposed
    changes.push({ after: proposed, expectedRevision: batch.revision })
    reviews.push({
      id: batch.id,
      kind: canReanchor ? 'reanchor' : 'review',
      reason,
      month: batch.month,
      destinationMonths: distinct(next.map((owner) => owner?.month)),
      originalGroups: structuredClone(batch.groups),
      destinationGroups,
      originalMark: cartonBatchMark(batch),
      destinationMark: cartonBatchMark(proposed),
      beforeMarkCode: batch.physicalMark?.code || previousMark?.baseCode || '',
      beforeProductCode: previousMark?.baseCode || '',
      afterMarkCode:
        markOwner(proposed, afterPreparations, records)?.baseCode || '',
      cartonNumber: batch.cartonNumber || '',
      beforeCodes: distinct(previous.map((owner) => owner?.baseCode)),
      afterCodes: distinct(next.map((owner) => owner?.baseCode)),
      count: batch.count,
      received: batch.received,
      loaded: batch.loaded,
      contents: structuredClone(batch.contents),
      issues: canReanchor ? [] : [...new Set(candidateIssues)],
      needsReview: Boolean(proposed.needsReview),
      ...(proposed.physicalMark
        ? {
            physicalMark: structuredClone(proposed.physicalMark),
            physicalMarkCode: proposed.physicalMark.code,
            currentProductCode: proposed.physicalMark.productCode,
            resolutionRequired: physicalMarkResolutionRequired(proposed),
            currentProductArtwork: physicalMarkReadback(
              proposed,
              afterPreparations
            ).currentProductArtwork,
            ...physicalMarkSupersessionState(proposed),
            physicalMarkResolutionChoices:
              physicalMarkResolutionChoices(proposed),
            physicalMarkSupersessions:
              physicalMarkReadback(proposed).physicalMarkSupersessions,
            resolutionChoices: physicalMarkResolutionChoices(proposed),
            physicalMarkOwnerChoices: cartonBatchMarkOwnerChoices(
              proposed,
              records,
              afterPreparations,
              batches
            ),
          }
        : {}),
    })
  }
  return { changes, before, after, reviews }
}
