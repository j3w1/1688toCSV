import {
  eligiblePaymentItems,
  paymentSourceClock,
  paymentSourceEvidence,
  validatePaymentGraph,
  validatePaymentLinks,
} from './payment-links.js'
import { moneyToCents, centsToMoney } from './money.js'

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const sourceIds = (source, link) =>
  link.sourceEntryId === undefined
    ? source.snapshot.items.map((item) => item.entryId)
    : [link.sourceEntryId]
const rowClock = (source, id) =>
  source.packingExclusionsPartialClocks?.[id] ||
  source.packingExclusionsUpdatedAt ||
  ''
const stillOwned = (source, owner) =>
  (owner?.entryIds || []).filter(
    (id) =>
      source.packingExcludedEntryIds?.includes(id) &&
      rowClock(source, id) === owner.updatedAt
  )
const editable = (link) => ({
  id: link.id,
  sourceOrderId: link.sourceOrderId,
  sourceEntryId: link.sourceEntryId,
  amount: link.amount,
  reason: link.reason,
  targetEntryIds: link.targetEntryIds,
})

/** All link/evidence/exclusion writes share the caller's existing IDB transaction. */
export function createPaymentLinksRepository({
  read,
  write,
  requested,
  nextEditTimestamp,
  annotationEditClock,
}) {
  if (
    ![read, write, requested, nextEditTimestamp].every(
      (value) => typeof value === 'function'
    )
  )
    throw new Error('Payment links need the order repository context')

  function editExclusions(
    source,
    ids,
    excluded,
    ownedIds = [],
    { retimestamp = false } = {}
  ) {
    const current = new Set(source.packingExcludedEntryIds || [])
    const changed = ids.filter((id) => current.has(id) !== excluded)
    if (!changed.length && !retimestamp)
      return { source, changed, timestamp: '' }
    for (const id of changed) excluded ? current.add(id) : current.delete(id)
    const clockIds = [...new Set([...changed, ...(excluded ? ownedIds : [])])]
    // Reuse per-entry annotation clocks so editing a different fee row cannot
    // erase this link's ownership. Keep legacy unclocked exclusions conservative.
    const clockSource =
      source.packingExclusionsPartialClocks === undefined &&
      (source.packingExclusionsUpdatedAt ||
        !(source.packingExcludedEntryIds || []).length)
        ? { ...source, packingExclusionsPartialClocks: {} }
        : source
    const nextClock = () =>
      nextEditTimestamp(
        [
          source.packingExclusionsUpdatedAt || '',
          ...Object.values(source.packingExclusionsPartialClocks || {}),
        ]
          .sort()
          .at(-1)
      )
    const fallbackClock = annotationEditClock ? undefined : nextClock()
    const clocks = annotationEditClock
      ? annotationEditClock(clockSource, 'packingExcludedEntryIds', clockIds)
      : clockSource.packingExclusionsPartialClocks !== undefined
        ? {
            packingExclusionsPartialClocks: {
              ...clockSource.packingExclusionsPartialClocks,
              ...Object.fromEntries(clockIds.map((id) => [id, fallbackClock])),
            },
          }
        : { packingExclusionsUpdatedAt: fallbackClock }
    const result = {
      ...source,
      packingExcludedEntryIds: [...current],
      ...clocks,
    }
    return { source: result, changed, timestamp: rowClock(result, clockIds[0]) }
  }

  async function change(orderId, incoming, options = {}) {
    const {
      accountId = 'local',
      expectedUpdatedAt,
      expectedSourceClocks,
    } = options
    return write(['orders'], async (tx) => {
      const store = tx.objectStore('orders')
      const original = await requested(store.index('account').getAll(accountId))
      const working = new Map(
        original.map((record) => [
          record.snapshot.orderId,
          structuredClone(record),
        ])
      )
      let target = working.get(orderId)
      if (!target) throw new Error('Order was not found')
      if (
        expectedUpdatedAt !== undefined &&
        expectedUpdatedAt !== (target.paymentLinksUpdatedAt || '')
      )
        throw new Error('Payment links changed while this review was open')
      if (expectedSourceClocks !== undefined) {
        for (const [sourceId, expected] of Object.entries(
          expectedSourceClocks
        )) {
          const source = working.get(sourceId)
          if (!source || !same(paymentSourceClock(source), expected))
            throw new Error(
              'The source payment changed while this review was open'
            )
        }
      }
      const previous = target.paymentLinks || []
      const input =
        typeof incoming === 'function'
          ? incoming(structuredClone(previous))
          : incoming
      if (!Array.isArray(input))
        throw new Error('Payment links must be an array')
      const timestamp = nextEditTimestamp(target.paymentLinksUpdatedAt)
      const normalized = input.map((draft) => {
        if (!draft || typeof draft !== 'object')
          throw new Error('Payment links must contain reviewed payments')
        const source = working.get(draft.sourceOrderId)
        if (!source)
          throw new Error(
            'The linked payment source order was not found in this account'
          )
        const prior = previous.find((link) => link.id === draft.id)
        const evidence = paymentSourceEvidence(source, draft.sourceEntryId)
        const amount =
          draft.amount === undefined ? evidence.amount : draft.amount
        let exactAmount
        try {
          exactAmount = centsToMoney(moneyToCents(amount))
        } catch {
          throw new Error('Payment link amounts must use exact cents')
        }
        const candidate = {
          id: draft.id || crypto.randomUUID(),
          sourceOrderId: draft.sourceOrderId,
          ...(draft.sourceEntryId === undefined
            ? {}
            : { sourceEntryId: draft.sourceEntryId }),
          amount: exactAmount,
          reason: draft.reason,
          ...(draft.targetEntryIds === undefined
            ? {}
            : { targetEntryIds: draft.targetEntryIds }),
          reviewedAt: timestamp,
          sourceEvidence: evidence,
        }
        if (
          prior &&
          same(editable(prior), editable(candidate)) &&
          (!draft.sourceEvidence ||
            same(draft.sourceEvidence, prior.sourceEvidence)) &&
          (!draft.reviewedAt || draft.reviewedAt === prior.reviewedAt)
        )
          return structuredClone(prior)
        if (moneyToCents(candidate.amount) > moneyToCents(evidence.amount))
          throw new Error('Linked amounts exceed the existing source payment')
        return candidate
      })
      // Make all prospective fee/payment sources ineligible before freezing the
      // target goods. A same-order fee therefore cannot receive its own amount.
      target.paymentLinks = normalized
      const all = [...working.values()]
      for (const link of normalized) {
        if (link.targetEntryIds === undefined)
          link.targetEntryIds = eligiblePaymentItems(target, all).map(
            (item) => item.entryId
          )
      }
      target.paymentLinks = validatePaymentLinks(normalized)

      // When another target still uses a source, transfer the skip ownership to
      // its surviving link so the final unlink can restore the original state.
      for (const old of previous) {
        const kept = target.paymentLinks.find((link) => link.id === old.id)
        if (
          kept &&
          kept.sourceOrderId === old.sourceOrderId &&
          kept.sourceEntryId === old.sourceEntryId
        ) {
          if (old.packingExclusions) {
            const source = working.get(old.sourceOrderId)
            const owned = stillOwned(source, old.packingExclusions)
            if (owned.length)
              kept.packingExclusions = {
                ...old.packingExclusions,
                entryIds: owned,
              }
            else delete kept.packingExclusions
          }
          continue
        }
        if (!old.packingExclusions) continue
        let source = working.get(old.sourceOrderId)
        if (!source)
          throw new Error(
            'The linked payment source order was not found in this account'
          )
        const restore = []
        for (const id of old.packingExclusions.entryIds) {
          if (!stillOwned(source, old.packingExclusions).includes(id)) continue
          const survivor = [...working.values()]
            .flatMap((record) =>
              (record.paymentLinks || []).map((link) => ({ record, link }))
            )
            .find(
              ({ link }) =>
                link.sourceOrderId === old.sourceOrderId &&
                sourceIds(source, link).includes(id)
            )
          if (survivor) {
            const owned = [
              ...new Set([
                ...stillOwned(source, survivor.link.packingExclusions),
                id,
              ]),
            ]
            // A surviving link may own newer source rows. Retimestamp only
            // verified link-owned skips so their combined marker stays exact.
            const refreshed = editExclusions(source, [], true, owned, {
              retimestamp: true,
            })
            source = refreshed.source
            survivor.link.packingExclusions = {
              entryIds: owned,
              updatedAt: refreshed.timestamp,
            }
            if (survivor.record !== target)
              survivor.record.paymentLinksUpdatedAt = nextEditTimestamp(
                survivor.record.paymentLinksUpdatedAt
              )
          } else if (rowClock(source, id) === old.packingExclusions.updatedAt)
            restore.push(id)
        }
        const result = editExclusions(source, restore, false)
        working.set(source.snapshot.orderId, result.source)
        if (source.snapshot.orderId === orderId) target = result.source
      }
      for (const link of target.paymentLinks) {
        const source = working.get(link.sourceOrderId)
        const result = editExclusions(
          source,
          sourceIds(source, link),
          true,
          link.packingExclusions?.entryIds
        )
        working.set(source.snapshot.orderId, result.source)
        if (result.changed.length) {
          const prior = link.packingExclusions
          link.packingExclusions = {
            entryIds: [
              ...new Set([...(prior?.entryIds || []), ...result.changed]),
            ],
            updatedAt: result.timestamp,
          }
        }
        if (source.snapshot.orderId === orderId) target = result.source
      }
      const previousTarget = original.find(
        (record) => record.snapshot.orderId === orderId
      )
      if (!same(previousTarget.paymentLinks || [], target.paymentLinks || []))
        target.paymentLinksUpdatedAt = timestamp
      working.set(orderId, target)
      validatePaymentGraph([...working.values()])
      for (const record of working.values()) {
        const before = original.find(
          (value) => value.snapshot.orderId === record.snapshot.orderId
        )
        if (!same(before, record)) store.put(record)
      }
      return target
    })
  }

  return {
    setPaymentLinks: change,
    linkPayment(orderId, link, options) {
      return change(orderId, (links) => [...links, link], options)
    },
    unlinkPayment(orderId, linkId, options) {
      return change(
        orderId,
        (links) => {
          if (!links.some((link) => link.id === linkId))
            throw new Error('The payment link was not found')
          return links.filter((link) => link.id !== linkId)
        },
        options
      )
    },
    async getPaymentLinks(orderId, { accountId = 'local' } = {}) {
      return read(['orders'], async (tx) => {
        const target = await requested(
          tx.objectStore('orders').get([accountId, orderId])
        )
        if (!target) throw new Error('Order was not found')
        return structuredClone(target.paymentLinks || [])
      })
    },
  }
}
