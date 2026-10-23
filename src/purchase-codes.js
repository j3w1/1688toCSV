import {
  activePackingState,
  allocatePreparation,
  barcodeValue,
  codePrefix,
  createPreparation,
  groupPackingMonth,
  validatePreparation,
  validateIssuedCode,
  codeReservationMembers,
  packingCodeSellerId,
} from './packing-model.js'
import {
  eligibleOrderItems,
  sourceRevision,
  stableValue,
} from './inventory-model.js'
import { physicalMarkOwner } from './physical-mark-aliases.js'

const key = (value) =>
  JSON.stringify([
    value.accountId || value.snapshot?.accountId || 'local',
    value.orderId || value.snapshot?.orderId,
  ])
const clone = (value) => structuredClone(value)
function codeError(code, message, detail = {}) {
  return Object.assign(new Error(message), { code, detail })
}

/** Gregorian source calendar text only: no device/UTC conversion or observation fallback. */
function calendarDate(value) {
  if (
    typeof value !== 'string' ||
    !/^20\d{2}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)?)?$/.test(
      value
    )
  )
    return null
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    ? value.slice(0, 10)
    : null
}
export function purchaseMonthForCodes(record) {
  const snapshot = record.snapshot ?? record
  const source = calendarDate(snapshot.purchasedAt)
  const resolution = record.purchaseDateResolution
  const date =
    source ??
    (resolution?.provenance === 'manual-confirmed' &&
    /^20\d{2}-\d{2}-\d{2}$/.test(resolution.date ?? '') &&
    calendarDate(resolution.updatedAt)
      ? calendarDate(resolution.date)
      : null)
  return date?.slice(0, 7) ?? null
}

/** Authored identity fills missing evidence; it cannot replace an unambiguous source. */
export function purchaseSupplierForCodes(record) {
  const snapshot = record.snapshot ?? record,
    spreadsheet = snapshot.sourceType === 'spreadsheet'
  const value = (value) =>
    typeof value === 'string' && value.trim() ? value.trim() : null
  const sourceStore = spreadsheet
    ? value(snapshot.store?.key)
    : snapshot.sellerUnavailable
      ? null
      : value(snapshot.sellerMemberLogin)
  const sourceSellerId = sourceStore
    ? spreadsheet
      ? (value(snapshot.sellerMemberLogin) ?? `store:${sourceStore}`)
      : sourceStore
    : null
  const resolution = record.supplierIdentityResolution
  const resolvedSellerId =
    resolution?.provenance === 'manual-confirmed' &&
    calendarDate(resolution.updatedAt)
      ? value(resolution.sellerId)
      : null
  const sellerId = sourceSellerId ?? resolvedSellerId
  return {
    sellerId,
    storeId: sellerId
      ? JSON.stringify([
          spreadsheet ? 'spreadsheet' : '1688',
          sourceStore ?? sellerId,
        ])
      : null,
    provenance: sourceSellerId
      ? 'source'
      : resolvedSellerId
        ? 'manual-confirmed'
        : null,
    conflict: Boolean(
      sourceSellerId && resolvedSellerId && sourceSellerId !== resolvedSellerId
    ),
    sourceSellerId,
    resolvedSellerId,
  }
}

/** Existing current issued prefixes are compatibility evidence, not migration targets. */
export function assertPurchaseCodeMonths({
  records,
  previous = [],
  preparations,
}) {
  const sources = new Map(records.map((record) => [key(record), record]))
  const before = new Map(
    previous.map((preparation) => [key(preparation), preparation])
  )
  for (const preparation of preparations) {
    const record = sources.get(key(preparation))
    if (!record)
      throw codeError(
        'PURCHASE_SOURCE_MISSING',
        'The purchase source changed. Review its codes again.',
        { orderId: preparation.orderId }
      )
    for (const group of preparation.groups) {
      const old = before
        .get(key(preparation))
        ?.groups.find((value) => value.id === group.id)
      if (
        old?.baseCode &&
        group.baseCode &&
        group.baseCode.slice(0, 6) === old.baseCode.slice(0, 6)
      )
        continue
      const inherited =
        group.sharedProductId &&
        previous.some(
          (candidate) =>
            candidate.accountId === preparation.accountId &&
            candidate.groups.some(
              (value) =>
                value.baseCode === group.baseCode &&
                (value.sharedProductId === group.sharedProductId ||
                  (!value.sharedProductId &&
                    candidate.orderId !== preparation.orderId))
            )
        )
      if (inherited) continue
      const month = purchaseMonthForCodes(record)
      if (!month)
        throw codeError(
          'PURCHASE_DATE_REQUIRED',
          'Resolve the original purchase date before generating new codes.',
          { orderId: preparation.orderId, groupId: group.id }
        )
      if (
        groupPackingMonth(preparation, group) !== month ||
        (group.baseCode && !group.baseCode.startsWith(codePrefix(month)))
      )
        throw codeError(
          'PURCHASE_CODE_MONTH',
          'New product codes must use the original purchase calendar month.',
          { orderId: preparation.orderId, groupId: group.id, month }
        )
    }
  }
  return preparations
}

const supportedLock = (lock) =>
  ['code-consumption', 'code-history'].includes(lock.kind)
const memberKey = (member) =>
  JSON.stringify([member.accountId || 'local', member.orderId, member.groupId])
const locksOf = (state) => state.locks ?? state.shipmentLocks ?? []

/** Current physical aliases occupy the SAME issued-code namespace as products.
 * Eligibility and current preparation membership determine release/revival;
 * historical snapshots and ordinary checkpoints never reserve a retired alias.
 */
export function physicalMarkReservations({
  preparations = [],
  records = [],
  orders = records,
  batches = [],
  cartonBatches = batches,
} = {}) {
  const result = []
  for (const batch of cartonBatches) {
    const physical = batch.physicalMark
    if (!physical) continue
    const orderId = batch.orderId || physical.originalMark.orderId
    const preparation = preparations.find(
      (value) =>
        value.accountId === batch.accountId && value.orderId === orderId
    )
    const record = orders.find(
      (value) => key(value) === key({ ...batch, orderId })
    )
    const prepared = new Set(
      preparation?.groups.flatMap((group) =>
        group.variants.flatMap((variant) => variant.entryIds)
      ) || []
    )
    const eligibility = new Map(
      record
        ? eligibleOrderItems(record, orders).map((item) => [
            item.entryId,
            item.eligible,
          ])
        : []
    )
    if (
      !physical.relatedEntryIds.some(
        (id) =>
          prepared.has(id) &&
          (eligibility.get(id) == null || BigInt(eligibility.get(id)) > 0n)
      )
    )
      continue
    const owner = physicalMarkOwner(batch, preparations)
    for (const alias of physical.aliases) {
      if (
        physical.supersededAliases?.some(
          (value) =>
            value.code === alias.code &&
            (value.active !== false || value.reviewRequired === true)
        )
      )
        continue
      // The mark can point at an independent product while its exact original
      // primary is still current. Reference that assignment; never create a
      // second primary owner for the same code. Removing it hands the alias to
      // the current carton lineage in this same final-state rebuild.
      const original = originalAliasOwner(batch, alias, preparations)
      const group = original?.group || owner?.group
      result.push({
        accountId: batch.accountId,
        orderId,
        groupId: group?.id || physical.originalMark.groupId,
        sellerId: alias.sellerId,
        month: alias.month,
        kind: 'base',
        code: alias.code,
        ...(group?.sharedProductId && group.baseCode === alias.code
          ? {
              sharedProductId: group.sharedProductId,
              sharedStoreId: group.sharedStoreId,
              members: [{ orderId, groupId: group.id }],
            }
          : {}),
        ownerSnapshot: {
          sellerName: record?.snapshot.sellerName || '',
          groupTitle: group?.title || '',
          spanishName: group?.spanishName || '',
          category: group?.category || '',
          variant: '',
          entryIds: physical.relatedEntryIds,
          photos: [],
        },
      })
    }
  }
  return result
}

function originalAliasOwner(batch, alias, preparations) {
  const physical = batch.physicalMark
  const references = [
    ...(alias.code === physical.originalCode ? [physical.originalMark] : []),
    ...[
      physical.originalArtwork,
      physical.artwork,
      ...(batch.cartonHistory || []).map(
        (entry) => entry.physicalMark?.artwork
      ),
    ].filter((value) => value?.code === alias.code),
  ]
  const preparation = preparations.find(
    (value) =>
      key(value) ===
      key({
        ...batch,
        orderId: batch.orderId || physical.originalMark.orderId,
      })
  )
  const group = preparation?.groups.find(
    (value) =>
      value.baseCode === alias.code &&
      references.some(
        (ref) => ref.orderId === preparation.orderId && ref.groupId === value.id
      )
  )
  return group ? { preparation, group } : null
}

function aliasConflicts(state, batch, alias) {
  const orderId = batch.orderId || batch.physicalMark.originalMark.orderId,
    owner =
      originalAliasOwner(batch, alias, state.preparations || []) ||
      physicalMarkOwner(batch, state.preparations || []),
    ownerId = owner?.group.id || batch.physicalMark.originalMark.groupId,
    allowed = (value) => value.orderId === orderId && value.groupId === ownerId,
    conflicts = []
  for (const preparation of state.preparations || []) {
    if (preparation.accountId !== batch.accountId) continue
    for (const group of preparation.groups)
      if (
        group.baseCode === alias.code &&
        !allowed({ ...preparation, groupId: group.id })
      )
        conflicts.push({
          accountId: preparation.accountId,
          orderId: preparation.orderId,
          groupId: group.id,
          kind: 'current-primary',
        })
  }
  for (const lock of locksOf(state).filter(supportedLock)) {
    if (lock.accountId !== batch.accountId) continue
    for (const lineage of lock.lineages)
      if (
        lineage.reservations.some(
          (value) => value.kind === 'base' && value.code === alias.code
        )
      )
        for (const member of lineage.members)
          if (!allowed(member)) {
            const containerName = state.containers?.find(
              (value) => value.id === lock.firstContainerId
            )?.name
            conflicts.push({
              ...member,
              kind: lock.kind,
              containerId: lock.firstContainerId,
              revisionId: lock.firstRevisionId,
              consumedAt: lock.consumedAt,
              ...(containerName ? { containerName } : {}),
            })
          }
  }
  return [
    ...new Map(conflicts.map((value) => [conflictKey(value), value])).values(),
  ]
}
const conflictKey = ({ containerName, ...value }) => stableValue(value)

function retirementEvidence(batch, alias, entry) {
  const retired = [batch, ...(batch.cartonHistory || [])].find(
    (value) =>
      sameRetiredLineage(value, batch, alias) &&
      Date.parse(value.physicalMark.retiredAt) <= Date.parse(entry.at) &&
      Date.parse(value.updatedAt) <= Date.parse(entry.at)
  )
  const event = batch.physicalMark.history.find(
    (value) =>
      value.kind === 'superseded' &&
      value.code === alias.code &&
      value.at === entry.at &&
      Array.isArray(value.conflicts) &&
      value.conflicts.some((owner) =>
        entry.conflicts.some(
          (claim) => conflictKey(owner) === conflictKey(claim)
        )
      )
  )
  return retired && event ? retired : null
}
function sameRetiredLineage(value, batch, alias) {
  return (
    value.id === batch.id &&
    value.accountId === batch.accountId &&
    value.physicalMark?.retiredAt &&
    value.physicalMark.originalCode === batch.physicalMark.originalCode &&
    stableValue(value.physicalMark.originalMark) ===
      stableValue(batch.physicalMark.originalMark) &&
    stableValue(value.physicalMark.originalArtwork) ===
      stableValue(batch.physicalMark.originalArtwork) &&
    value.physicalMark.aliases?.some(
      (candidate) => stableValue(candidate) === stableValue(alias)
    )
  )
}
function validReservationWitness(batch, alias, entry) {
  const witness = entry.reservationWitness,
    retired = retirementEvidence(batch, alias, entry)
  if (
    !witness ||
    !retired ||
    witness.batchId !== batch.id ||
    ![batch, ...(batch.cartonHistory || [])].some(
      (value) =>
        sameRetiredLineage(value, batch, alias) &&
        value.revision === witness.retiredRevision &&
        value.physicalMark?.retiredAt === witness.retiredAt &&
        value.physicalMark.aliases?.some(
          (candidate) => stableValue(candidate) === stableValue(alias)
        )
    )
  )
    return false
  const reservation = validateIssuedCode(witness.reservation)
  return (
    reservation.kind === 'base' &&
    reservation.accountId === batch.accountId &&
    reservation.code === alias.code &&
    reservation.month === alias.month &&
    reservation.sellerId === alias.sellerId &&
    entry.conflicts.some(
      (conflict) =>
        conflict.kind === 'current-primary' &&
        codeReservationMembers(reservation).some(
          (member) => memberKey(member) === memberKey(conflict)
        )
    ) &&
    batch.physicalMark.history.some(
      (event) =>
        ['superseded', 'superseded-update'].includes(event.kind) &&
        event.code === alias.code &&
        stableValue(event.reservationWitness) === stableValue(witness)
    )
  )
}
function reservationWitness(state, batch, alias, previous, conflicts) {
  if (!previous?.physicalMark?.retiredAt) return undefined
  const actual = (state.issuedCodes || []).find(
    (value) =>
      value.accountId === batch.accountId &&
      value.kind === 'base' &&
      value.code === alias.code &&
      value.month === alias.month &&
      value.sellerId === alias.sellerId &&
      conflicts.some(
        (conflict) =>
          conflict.kind === 'current-primary' &&
          codeReservationMembers(value).some(
            (member) => memberKey(member) === memberKey(conflict)
          )
      )
  )
  if (!actual) return undefined // Allocation previews have no new stored reservation yet.
  return {
    batchId: batch.id,
    retiredRevision: previous.revision,
    retiredAt: previous.physicalMark.retiredAt,
    reservation: clone(validateIssuedCode(actual)),
  }
}

/** Derive recovery only from actual final primaries/locks and the stored prior
 * retirement. A caller-supplied supersession never releases a current alias.
 * The result is still the existing carton evidence, not a second code ledger.
 */
export function recoverPhysicalMarkAliases(
  state,
  previousBatches = state.batches || [],
  at = null,
  { validateClaims = true } = {}
) {
  historicalCodeReservations(locksOf(state))
  return (state.batches || []).map((batch) => {
    if (!batch.physicalMark) return batch
    const prior = previousBatches.find((value) => value.id === batch.id),
      previous = prior?.physicalMark,
      mark = clone(batch.physicalMark),
      trusted = previous?.supersededAliases || [],
      incoming = mark.supersededAliases || [],
      superseded = clone(trusted),
      recoveryAt =
        typeof at === 'function' ? at(batch.updatedAt) : at || batch.updatedAt
    for (const alias of mark.aliases) {
      const conflicts = aliasConflicts(state, batch, alias),
        known = superseded.find((value) => value.code === alias.code),
        claimed = incoming.find((value) => value.code === alias.code),
        witnessed =
          claimed?.reservationWitness &&
          validReservationWitness(batch, alias, claimed),
        historical =
          claimed && !prior && retirementEvidence(batch, alias, claimed),
        missingPermanent = claimed?.conflicts.some(
          (value) =>
            value.kind !== 'current-primary' &&
            !conflicts.some(
              (actual) => conflictKey(actual) === conflictKey(value)
            )
        )
      if (
        claimed &&
        !known &&
        (claimed.conflicts.some(
          (owner) => owner.accountId !== batch.accountId
        ) ||
          (prior && !previous?.retiredAt) ||
          (claimed.reservationWitness && !witnessed) ||
          (!prior && !mark.retiredAt && !historical) ||
          (!conflicts.length && !historical) ||
          (validateClaims && missingPermanent) ||
          (validateClaims &&
            conflicts.length &&
            claimed.conflicts.some(
              (value) =>
                !conflicts.some(
                  (actual) => conflictKey(actual) === conflictKey(value)
                ) && !(witnessed && value.kind === 'current-primary')
            )))
      )
        throw codeError(
          'PHYSICAL_MARK_RESTORE_CONFLICT',
          'Superseded physical aliases require actual retained retirement and conflicting current or shipment ownership.'
        )
      if (
        !known &&
        (conflicts.length || historical) &&
        (previous?.retiredAt || (!prior && (mark.retiredAt || historical)))
      ) {
        // An already consumed own lineage is permanent, even after retirement.
        if (
          conflicts.length &&
          locksOf(state).some(
            (lock) =>
              lock.accountId === batch.accountId &&
              lock.lineages?.some(
                (lineage) =>
                  lineage.baseCode === alias.code &&
                  lineage.members.some(
                    (member) =>
                      member.orderId ===
                      (batch.orderId || mark.originalMark.orderId)
                  )
              )
          )
        ) {
          if (claimed)
            throw codeError(
              'PHYSICAL_MARK_RESTORE_CONFLICT',
              'A permanent own shipment lineage cannot become a superseded alias.'
            )
          continue
        }
        const entry = {
          code: alias.code,
          at: claimed?.at || recoveryAt,
          reason:
            'The released physical alias is now reserved by another current product or shipment; use a fresh current product code and confirm physical relabeling.',
          conflicts: validateClaims
            ? conflicts.length
              ? [
                  ...new Map(
                    [
                      ...conflicts,
                      ...(claimed?.conflicts || []).filter(
                        (value) =>
                          !conflicts.some(
                            (actual) =>
                              conflictKey(actual) === conflictKey(value)
                          )
                      ),
                    ].map((value) => [conflictKey(value), value])
                  ).values(),
                ]
              : clone(claimed.conflicts)
            : claimed?.conflicts || conflicts,
          currentProducts: [],
          active: conflicts.length > 0,
          reviewRequired: !conflicts.length && !witnessed,
          ...(claimed?.reservationWitness ||
          reservationWitness(state, batch, alias, prior, conflicts)
            ? {
                reservationWitness:
                  claimed?.reservationWitness ||
                  reservationWitness(state, batch, alias, prior, conflicts),
              }
            : {}),
        }
        superseded.push(entry)
        if (!claimed) mark.history.push({ kind: 'superseded', ...clone(entry) })
        if (mark.code === alias.code && (entry.active || entry.reviewRequired))
          mark.resolution = null
      } else if (known) {
        if (
          conflicts.length &&
          known.active === false &&
          known.reviewRequired !== true &&
          !previous.retiredAt
        )
          throw codeError(
            'PACKING_CODE_CONFLICT',
            'The returned physical alias is currently reserved by its related goods.',
            { code: alias.code }
          )
        // Current holders lead the list used by canonical/typed refusal reasons.
        // Retain former holders behind them as corroborating witness history.
        if (conflicts.length) {
          if (known.active === false && mark.code === alias.code)
            mark.resolution = null
          known.conflicts = [
            ...conflicts,
            ...known.conflicts.filter(
              (value) =>
                !conflicts.some(
                  (actual) => conflictKey(actual) === conflictKey(value)
                )
            ),
          ]
        }
        known.active = conflicts.length > 0
        known.reviewRequired = known.reviewRequired === true
        const freshReview =
          known.reviewRequired &&
          mark.resolution?.choice === 'relabel-reprint' &&
          mark.resolution.physicalRelabelConfirmed === true &&
          mark.resolution.resolvedAt !== previous.resolution?.resolvedAt &&
          mark.history.some(
            (event) =>
              event.kind === 'resolution' &&
              event.resolution?.resolvedAt === mark.resolution.resolvedAt &&
              event.resolution.choice === 'relabel-reprint'
          )
        if (freshReview) {
          known.reviewRequired = false
          known.reviewedAt = mark.resolution.resolvedAt
        }
      }
    }
    if (!superseded.length) return batch
    const preparation = (state.preparations || []).find(
        (value) =>
          key(value) ===
          key({
            ...batch,
            orderId: batch.orderId || mark.originalMark.orderId,
          })
      ),
      record = (state.records || []).find(
        (value) => key(value) === key(preparation || {})
      ),
      eligible = record
        ? new Map(
            eligibleOrderItems(record, state.records).map((item) => [
              item.entryId,
              item.eligible,
            ])
          )
        : new Map(),
      currentProducts = (preparation?.groups || [])
        .filter(
          (group) =>
            group.baseCode &&
            group.variants.some((variant) =>
              variant.entryIds.some(
                (id) =>
                  mark.relatedEntryIds.includes(id) &&
                  (eligible.get(id) == null || BigInt(eligible.get(id)) > 0n)
              )
            )
        )
        .map((group) => ({
          mark: { orderId: preparation.orderId, groupId: group.id },
          productCode: group.baseCode,
        }))
    for (const entry of superseded) {
      entry.currentProducts = clone(currentProducts)
      const event = mark.history.findLast(
        (value) => value.kind === 'superseded' && value.code === entry.code
      )
      if (
        event &&
        !trusted.some((value) => value.code === entry.code) &&
        !incoming.some((value) => value.code === entry.code)
      )
        Object.assign(event, clone(entry))
      else if (
        stableValue(
          trusted.find((value) => value.code === entry.code) ||
            incoming.find((value) => value.code === entry.code)
        ) !== stableValue(entry)
      )
        mark.history.push({
          kind: 'superseded-update',
          ...clone(entry),
          at: recoveryAt,
        })
    }
    mark.supersededAliases = superseded
    if (stableValue(mark) === stableValue(batch.physicalMark)) return batch
    return { ...batch, physicalMark: mark }
  })
}

/** Persist the lifecycle on its existing physical evidence, without a new ledger. */
export function retirePhysicalMarkAliases(
  state,
  nextEditTimestamp,
  previousBatches = state.batches || []
) {
  const recovered = recoverPhysicalMarkAliases(
      state,
      previousBatches,
      nextEditTimestamp
    ),
    active = physicalMarkReservations({ ...state, batches: recovered })
  return recovered.map((batch, index) => {
    const physical = batch.physicalMark
    if (!physical) return batch
    const current = active.some(
      (reservation) =>
        reservation.accountId === batch.accountId &&
        reservation.orderId ===
          (batch.orderId || physical.originalMark.orderId) &&
        physical.aliases.some((alias) => alias.code === reservation.code)
    )
    const originalBatch = state.batches[index]
    if (current === !physical.retiredAt && batch === originalBatch) return batch
    const updatedAt = nextEditTimestamp(batch.updatedAt)
    const mark = clone(physical)
    if (current !== !physical.retiredAt)
      mark.history.push({
        kind: current ? 'revived' : 'retired',
        at: updatedAt,
        reason: current
          ? 'Related goods are current again; ownership revalidated.'
          : 'All related goods are retired or ineligible.',
      })
    if (current && physical.retiredAt) {
      delete mark.retiredAt
      delete mark.retirementReason
    } else if (!current && !physical.retiredAt) {
      mark.retiredAt = updatedAt
      mark.retirementReason = 'All related goods are retired or ineligible.'
    }
    const original = clone(originalBatch)
    delete original.cartonHistory
    return {
      ...batch,
      physicalMark: mark,
      revision: batch.revision + 1,
      updatedAt,
      cartonHistory: [...clone(originalBatch.cartonHistory || []), original],
    }
  })
}

function validateCodeLock(lock) {
  const text = (value) => typeof value === 'string' && value.trim().length > 0
  const invalid = () => {
    throw codeError(
      'INVALID_CODE_LOCK',
      'Historical code evidence is incomplete or has inconsistent ownership.'
    )
  }
  if (
    !text(lock.accountId) ||
    !text(lock.orderId) ||
    lock.id !== JSON.stringify([lock.kind, lock.accountId, lock.orderId]) ||
    !text(lock.firstContainerId) ||
    !text(lock.firstRevisionId) ||
    !calendarDate(lock.consumedAt) ||
    !Array.isArray(lock.lineages)
  )
    invalid()
  for (const lineage of lock.lineages) {
    if (
      lineage.physicalMarkAlias !== undefined &&
      (lineage.physicalMarkAlias !== true ||
        !/^CE\d{8}$/.test(lineage.productCode) ||
        lineage.productCode === lineage.baseCode ||
        !lock.lineages.some(
          (primary) =>
            !primary.physicalMarkAlias &&
            primary.baseCode === lineage.productCode &&
            primary.sharedProductId === lineage.sharedProductId &&
            lineage.members.every((member) =>
              primary.members.some(
                (value) => memberKey(member) === memberKey(value)
              )
            )
        ))
    )
      invalid()
    if (
      !Array.isArray(lineage.members) ||
      !lineage.members.length ||
      !Array.isArray(lineage.reservations) ||
      !lineage.reservations.some(
        (reservation) =>
          reservation.kind === 'base' && reservation.code === lineage.baseCode
      )
    )
      invalid()
    const owners = new Set()
    for (const member of lineage.members) {
      if (
        member.accountId !== lock.accountId ||
        !text(member.orderId) ||
        !text(member.groupId) ||
        owners.has(memberKey(member))
      )
        invalid()
      owners.add(memberKey(member))
    }
    for (const reservation of lineage.reservations) {
      const normalized = validateIssuedCode(reservation)
      if (
        normalized.accountId !== lock.accountId ||
        normalized.code.slice(0, 10) !== lineage.baseCode ||
        codeReservationMembers(normalized).some(
          (owner) => !owners.has(memberKey(owner))
        )
      )
        invalid()
    }
  }
}

/** Only sealed-reference namespaces reserve history; ordinary checkpoints do not. */
export function historicalCodeReservations(locks = []) {
  const reservations = []
  for (const lock of locks.filter(supportedLock)) {
    validateCodeLock(lock)
    if (!Array.isArray(lock.lineages))
      throw codeError(
        'INVALID_CODE_LOCK',
        'Historical code evidence is incomplete.'
      )
    for (const lineage of lock.lineages) {
      if (
        !Array.isArray(lineage.members) ||
        !lineage.members.length ||
        !Array.isArray(lineage.reservations)
      )
        throw codeError(
          'INVALID_CODE_LOCK',
          'Historical code lineage is incomplete.'
        )
      reservations.push(...lineage.reservations.map(validateIssuedCode))
    }
  }
  return activePackingState([], [], [], {
    historicalReservations: reservations,
  }).issuedCodes
}

/** Final transaction guard: first consumption freezes identity, not mutable money/display fields. */
export function assertConsumedCodeChanges({
  previous = [],
  preparations,
  locks = [],
  amendment = false,
}) {
  const before = new Map(
    previous.map((preparation) => [key(preparation), preparation])
  )
  const final = new Map(before)
  for (const preparation of preparations)
    final.set(key(preparation), preparation)
  const consumed = locks.filter((lock) => lock.kind === 'code-consumption')
  // Fail closed on malformed permanent evidence, even on an unrelated edit.
  historicalCodeReservations(consumed)
  const consumedOrders = new Set(consumed.map(key))
  const fail = (detail) => {
    throw codeError(
      'CONSUMED_CODE_LINEAGE',
      'A sealed purchase or consumed code lineage cannot admit new links or ordinary identity edits. Review a container amendment for code corrections.',
      detail
    )
  }
  for (const preparation of final.values())
    for (const group of preparation.groups) {
      const old = before
        .get(key(preparation))
        ?.groups.find((entry) => entry.id === group.id)
      if (
        consumedOrders.has(key(preparation)) &&
        group.sharedProductId &&
        (!old || old.sharedProductId !== group.sharedProductId)
      )
        fail({ orderId: preparation.orderId, groupId: group.id })
    }
  for (const lock of consumed)
    for (const lineage of lock.lineages) {
      const allowed = new Set(lineage.members.map(memberKey))
      for (const preparation of final.values())
        for (const group of preparation.groups) {
          if ((preparation.accountId || 'local') !== lock.accountId) continue
          if (
            (lineage.sharedProductId &&
              group.sharedProductId === lineage.sharedProductId) ||
            group.baseCode === lineage.baseCode
          ) {
            if (!allowed.has(memberKey({ ...preparation, groupId: group.id })))
              fail({
                orderId: preparation.orderId,
                groupId: group.id,
                baseCode: lineage.baseCode,
              })
          }
        }
      // The primary consumed lineage freezes all member/variant identity. A
      // physical alias reserves a different old code for those same members.
      if (lineage.physicalMarkAlias) continue
      for (const member of lineage.members) {
        const old = before
          .get(key(member))
          ?.groups.find((entry) => entry.id === member.groupId)
        const group = final
          .get(key(member))
          ?.groups.find((entry) => entry.id === member.groupId)
        if (!group) {
          if (old) fail({ orderId: member.orderId, groupId: member.groupId })
          else continue
        }
        const reservations = lineage.reservations.filter((entry) =>
          codeReservationMembers(entry).some(
            (owner) =>
              owner.orderId === member.orderId &&
              owner.groupId === member.groupId
          )
        )
        const expectedShared =
          old?.sharedProductId ?? lineage.sharedProductId ?? undefined
        if (
          group.sharedProductId !== expectedShared ||
          (old && old.sharedStoreId !== group.sharedStoreId)
        )
          fail({ orderId: member.orderId, groupId: member.groupId })
        if (
          !amendment &&
          group.baseCode !== (old?.baseCode ?? lineage.baseCode)
        )
          fail({ orderId: member.orderId, groupId: member.groupId })
        const variants =
          old?.variants ??
          reservations
            .filter((entry) => entry.kind === 'barcode')
            .flatMap((entry) =>
              codeReservationMembers(entry)
                .filter(
                  (owner) =>
                    owner.orderId === member.orderId &&
                    owner.groupId === member.groupId
                )
                .map((owner) => ({
                  id: owner.variantId,
                  entryIds: owner.ownerSnapshot?.entryIds,
                  sharedVariantId: entry.sharedVariantId,
                  code: entry.code,
                }))
            )
        if (variants.length !== group.variants.length)
          fail({ orderId: member.orderId, groupId: member.groupId })
        for (const variant of variants) {
          const next = group.variants.find((entry) => entry.id === variant.id)
          if (
            !next ||
            next.sharedVariantId !== variant.sharedVariantId ||
            (variant.entryIds &&
              JSON.stringify([...variant.entryIds].sort()) !==
                JSON.stringify([...next.entryIds].sort())) ||
            (!amendment &&
              (old
                ? ['variantSuffix', 'sizeSuffix', 'needsSizeMapping'].some(
                    (field) => variant[field] !== next[field]
                  )
                : next.needsSizeMapping ||
                  barcodeValue(group, next) !== variant.code))
          )
            fail({
              orderId: member.orderId,
              groupId: member.groupId,
              variantId: variant.id,
            })
        }
      }
    }
  return preparations
}

/** Eligibility check for source/target and unshipped aliases of a consumed lineage. */
export function assertRepeatCodeEligibility({
  references,
  preparations,
  locks = [],
}) {
  const consumed = locks.filter((lock) => lock.kind === 'code-consumption')
  historicalCodeReservations(consumed)
  for (const reference of references) {
    const preparation = preparations.find(
      (value) => key(value) === key(reference)
    )
    const group = preparation?.groups.find(
      (value) => value.id === reference.groupId
    )
    if (!group)
      throw codeError(
        'PURCHASE_SOURCE_MISSING',
        'The linked product changed. Review it again.'
      )
    if (
      consumed.some(
        (lock) =>
          key(lock) === key(reference) ||
          lock.lineages.some(
            (lineage) =>
              lineage.members.some(
                (member) => memberKey(member) === memberKey(reference)
              ) ||
              (lock.accountId === preparation.accountId &&
                ((group.sharedProductId &&
                  group.sharedProductId === lineage.sharedProductId) ||
                  group.baseCode === lineage.baseCode))
          )
      )
    )
      throw codeError(
        'CONSUMED_CODE_LINEAGE',
        'This purchase belongs to a consumed code lineage and cannot accept new repeat links.',
        { orderId: reference.orderId, groupId: reference.groupId }
      )
  }
}

function manifestPreparations(manifest, state) {
  const preparations = new Map()
  for (const value of [
    ...(manifest.orders ?? []),
    ...(manifest.products ?? []),
    ...(manifest.leftBehind?.products ?? []),
    ...(manifest.cartons ?? []),
    ...(manifest.leftBehind?.cartons ?? []),
  ])
    if (value.preparation)
      preparations.set(key(value.preparation), value.preparation)
  for (const preparation of state.preparations ?? [])
    preparations.set(key(preparation), preparation)
  return [...preparations.values()]
}
function lineageFor(preparation, group, preparations, reservations) {
  const members = preparations.flatMap((candidate) =>
    candidate.groups
      .filter(
        (value) =>
          candidate.accountId === preparation.accountId &&
          (group.sharedProductId
            ? value.sharedProductId === group.sharedProductId
            : candidate.orderId === preparation.orderId &&
              value.id === group.id)
      )
      .map((value) => ({
        accountId: candidate.accountId,
        orderId: candidate.orderId,
        groupId: value.id,
      }))
  )
  const allowed = new Set(members.map(memberKey))
  return {
    sharedProductId: group.sharedProductId ?? null,
    baseCode: group.baseCode,
    members,
    reservations: reservations.filter(
      (reservation) =>
        reservation.accountId === preparation.accountId &&
        reservation.code.slice(0, 10) === group.baseCode &&
        codeReservationMembers(reservation).some((owner) =>
          allowed.has(memberKey(owner))
        )
    ),
  }
}
const lineageKey = (lineage) =>
  JSON.stringify([lineage.sharedProductId, lineage.baseCode])

/** Called only in the atomic successful seal/amend transaction; returns full append-only set. */
export function consumptionLocksForManifest(manifest, state = {}) {
  const existing = clone(locksOf(state))
  if (manifest.draft !== false || manifest.status !== 'sealed') return existing
  if (!manifest.container?.id || !manifest.revisionId || !manifest.sealedAt)
    throw codeError(
      'INVALID_CODE_LOCK',
      'A sealed code lock requires immutable container/revision/time evidence.'
    )
  const preparations = manifestPreparations(manifest, state)
  const reservations = activePackingState(
    preparations,
    state.allocations ?? [],
    state.issuedCodes ?? [],
    {
      historicalReservations: physicalMarkReservations({
        ...state,
        preparations,
        records: (manifest.orders || [])
          .map((order) => order.record)
          .filter(Boolean),
        batches: manifest.batches || state.batches,
        cartonBatches: manifest.batches || state.batches,
      }),
    }
  ).issuedCodes
  const loaded = new Set(
    (manifest.cartons ?? [])
      .filter(
        (carton) =>
          (carton.state === undefined || carton.state === 'loaded') &&
          (carton.count ?? 1) > 0
      )
      .map(key)
  )
  const references = new Map()
  const mention = (value, code) => {
    if (typeof code !== 'string' || !/^CE\d{8}[A-Z0-9]*$/.test(code)) return
    const order = key(value),
      codes = references.get(order) ?? new Set()
    codes.add(code)
    codes.add(code.slice(0, 10))
    references.set(order, codes)
  }
  for (const row of [
    ...(manifest.products ?? []),
    ...(manifest.leftBehind?.products ?? []),
    ...(manifest.leftBehind?.unprepared ?? []),
  ])
    for (const code of [
      row.barcode,
      row.baseCode,
      row.cartonMarkCode,
      row.group?.baseCode,
    ])
      mention(row, code)
  for (const carton of [
    ...(manifest.cartons ?? []),
    ...(manifest.leftBehind?.cartons ?? []),
  ])
    mention(carton, carton.markCode)
  const result = new Map(existing.map((lock) => [lock.id, lock]))
  for (const preparation of preparations)
    for (const kind of ['code-consumption', 'code-history']) {
      if (
        kind === 'code-consumption'
          ? !loaded.has(key(preparation))
          : !references.has(key(preparation))
      )
        continue
      const groups = preparation.groups.filter(
        (group) =>
          group.baseCode &&
          (kind === 'code-consumption' ||
            [...references.get(key(preparation))].some(
              (code) => code.slice(0, 10) === group.baseCode
            ))
      )
      if (!groups.length && kind === 'code-history') continue
      const id = JSON.stringify([
          kind,
          preparation.accountId,
          preparation.orderId,
        ]),
        old = result.get(id)
      const lineages = new Map(
        (old?.lineages ?? []).map((lineage) => [lineageKey(lineage), lineage])
      )
      for (const group of groups) {
        const lineage = lineageFor(
          preparation,
          group,
          preparations,
          reservations
        )
        if (kind === 'code-history')
          lineage.reservations = lineage.reservations.filter((reservation) =>
            references.get(key(preparation)).has(reservation.code)
          )
        // First membership is immutable for a consumed lineage. Only code-history
        // may record reviewed unconsumed aliases under an existing code.
        const prior = lineages.get(lineageKey(lineage))
        if (!prior) lineages.set(lineageKey(lineage), lineage)
        else if (kind === 'code-history') {
          const members = new Map(
            [...prior.members, ...lineage.members].map((member) => [
              memberKey(member),
              member,
            ])
          )
          lineages.set(lineageKey(lineage), {
            ...prior,
            members: [...members.values()],
            reservations: historicalCodeReservations([
              {
                ...old,
                kind: 'code-history',
                lineages: [
                  {
                    ...lineage,
                    reservations: [
                      ...prior.reservations,
                      ...lineage.reservations,
                    ],
                  },
                ],
              },
            ]),
          })
        }
      }
      for (const carton of [
        ...(manifest.cartons || []),
        ...(manifest.leftBehind?.cartons || []),
      ]) {
        if (key(carton) !== key(preparation) || !carton.physicalMark) continue
        if (
          kind === 'code-consumption' &&
          !(manifest.cartons || []).some((value) => value.id === carton.id)
        )
          continue
        const group = preparation.groups.find(
          (value) => value.id === carton.mark?.groupId
        )
        if (!group) continue
        for (const alias of carton.physicalMark.aliases) {
          if (alias.code === group.baseCode) continue
          if (
            carton.physicalMark.supersededAliases?.some(
              (value) =>
                value.code === alias.code &&
                (value.active !== false || value.reviewRequired === true)
            )
          )
            continue
          // An independent mark can still reference its exact original primary.
          // That group's ordinary consumed/history lineage already freezes it.
          if (originalAliasOwner(carton, alias, preparations)) continue
          const primary = lineageFor(
            preparation,
            group,
            preparations,
            reservations
          )
          const lineage = {
            ...primary,
            baseCode: alias.code,
            productCode: group.baseCode,
            physicalMarkAlias: true,
            reservations: reservations.filter(
              (reservation) =>
                reservation.accountId === preparation.accountId &&
                reservation.kind === 'base' &&
                reservation.code === alias.code &&
                codeReservationMembers(reservation).some((member) =>
                  primary.members.some(
                    (value) => memberKey(value) === memberKey(member)
                  )
                )
            ),
          }
          if (!lineage.reservations.length)
            throw codeError(
              'INVALID_CODE_LOCK',
              'A physical mark alias is missing its current reservation.'
            )
          if (!lineages.has(lineageKey(lineage)))
            lineages.set(lineageKey(lineage), lineage)
        }
      }
      result.set(id, {
        ...(old ?? {
          id,
          kind,
          accountId: preparation.accountId,
          orderId: preparation.orderId,
          firstContainerId: manifest.container.id,
          firstRevisionId: manifest.revisionId,
          consumedAt: manifest.sealedAt,
        }),
        lineages: [...lineages.values()],
      })
    }
  for (const order of loaded) {
    const [accountId, orderId] = JSON.parse(order),
      id = JSON.stringify(['code-consumption', accountId, orderId])
    if (!result.has(id))
      result.set(id, {
        id,
        kind: 'code-consumption',
        accountId,
        orderId,
        firstContainerId: manifest.container.id,
        firstRevisionId: manifest.revisionId,
        consumedAt: manifest.sealedAt,
        lineages: [],
      })
  }
  return [...result.values()]
}

/** Read-only review. Returned drafts do not become reservations until one final transaction. */
export function planPurchaseCodeReview(
  state,
  { orderRefs = [], entryRefs = [] } = {}
) {
  const records = state.records ?? state.orders ?? [],
    preparations = state.preparations ?? []
  const byOrder = new Map(records.map((record) => [key(record), record]))
  const previous = new Map(
    preparations.map((preparation) => [key(preparation), preparation])
  )
  const selected = new Map()
  const issues = [],
    changes = [],
    drafts = [],
    expectedSnapshots = []
  const problem = (code, message, detail = {}, severity = 'error') =>
    issues.push({ code, message, ...detail, severity })
  for (const ref of orderRefs) selected.set(key(ref), new Set())
  for (const ref of entryRefs) {
    const ids = selected.get(key(ref)) ?? new Set()
    ids.add(ref.entryId)
    selected.set(key(ref), ids)
  }
  if (!selected.size)
    problem(
      'PURCHASE_SELECTION_REQUIRED',
      'Select purchase products before reviewing codes.'
    )
  for (const [order, ids] of selected) {
    const record = byOrder.get(order),
      old = previous.get(order)
    if (!record) {
      problem(
        'PURCHASE_SOURCE_MISSING',
        'The selected purchase changed. Refresh before assigning codes.'
      )
      continue
    }
    const eligible = eligibleOrderItems(record, records)
    if (!entryRefs.length)
      for (const value of eligible)
        if (value.eligible !== null && BigInt(value.eligible) > 0n)
          ids.add(value.entryId)
    const items = record.snapshot.items.filter((item) => ids.has(item.entryId))
    if (items.length !== ids.size) {
      problem(
        'PURCHASE_SOURCE_CHANGED',
        'The selected products changed. Refresh before assigning codes.',
        { orderId: record.snapshot.orderId }
      )
      continue
    }
    if (!items.length) continue
    for (const item of items) {
      const current = eligible.find((value) => value.entryId === item.entryId)
      if (
        !current ||
        current.eligible === null ||
        BigInt(current.eligible) <= 0n ||
        current.issues.length
      )
        problem(
          'PURCHASE_PRODUCT_INELIGIBLE',
          'Review the selected product inventory disposition before assigning codes.',
          { orderId: record.snapshot.orderId, entryId: item.entryId }
        )
    }
    const known = new Set(
      (old?.groups ?? []).flatMap((group) =>
        group.variants.flatMap((variant) => variant.entryIds)
      )
    )
    const missing = items.filter((item) => !known.has(item.entryId))
    const unallocated = (old?.groups ?? []).some(
      (group) =>
        !group.baseCode &&
        group.variants.some((variant) =>
          variant.entryIds.some((entryId) => ids.has(entryId))
        )
    )
    const month = purchaseMonthForCodes(record),
      supplier = purchaseSupplierForCodes(record)
    if (supplier.conflict) {
      problem(
        'SUPPLIER_IDENTITY_CONFLICT',
        'The original supplier identity disagrees with its authored resolution. Review the purchase evidence.',
        { orderId: record.snapshot.orderId }
      )
      continue
    }
    if (
      old?.groups.some((group) => group.baseCode) &&
      supplier.sellerId &&
      old.sellerId !== supplier.sellerId &&
      !hasReviewedSupplierCodeIdentity(record, old)
    ) {
      problem(
        'LEGACY_SUPPLIER_IDENTITY_REVIEW_REQUIRED',
        'Review the existing legacy supplier code identity before linking or assigning new codes. Issued codes and their owner remain unchanged.',
        {
          orderId: record.snapshot.orderId,
          legacyOwnerSellerId: old.sellerId,
          supplierIdentity: supplier,
        }
      )
      continue
    }
    if ((missing.length || unallocated) && !supplier.sellerId) {
      problem(
        'SELLER_IDENTITY_REQUIRED',
        'Resolve the original supplier identity before generating new codes.',
        { orderId: record.snapshot.orderId }
      )
      continue
    }
    const codeSnapshot = {
      ...record.snapshot,
      sellerMemberLogin: supplier.sellerId ?? record.snapshot.sellerMemberLogin,
      sellerUnavailable: !supplier.sellerId,
    }
    if ((missing.length || unallocated) && !month) {
      problem(
        'PURCHASE_DATE_REQUIRED',
        'Resolve the original purchase date before generating new codes.',
        { orderId: record.snapshot.orderId }
      )
      continue
    }
    let draft = old
      ? clone(old)
      : createPreparation(
          { ...codeSnapshot, items: [] },
          month,
          state.preferences?.vocabulary,
          state.preferences?.sizeVocabulary
        )
    if (missing.length) {
      const added = createPreparation(
        { ...codeSnapshot, items: missing },
        month,
        state.preferences?.vocabulary,
        state.preferences?.sizeVocabulary
      )
      draft.groups.push(...added.groups.map((group) => ({ ...group, month })))
    }
    if (!old?.groups.some((group) => group.baseCode) && supplier.sellerId)
      draft.sellerId = supplier.sellerId
    for (const group of draft.groups) if (!group.baseCode) group.month = month
    expectedSnapshots.push({
      accountId: record.snapshot.accountId || 'local',
      orderId: record.snapshot.orderId,
      observedAt: record.snapshot.observedAt,
      sourceRevision: sourceRevision(record, old),
      supplierIdentity: purchaseSupplierForCodes(record),
      codeIdentityReview: clone(record.supplierCodeIdentityReview ?? null),
    })
    drafts.push(validatePreparation(draft))
  }
  const historicalReservations = [
    ...historicalCodeReservations(locksOf(state)),
    ...physicalMarkReservations(state),
  ]
  const supplierIdentityEquivalences = supplierCodeIdentityEquivalences(records)
  let packing = activePackingState(
    preparations,
    state.allocations ?? [],
    state.issuedCodes ?? [],
    { historicalReservations, supplierIdentityEquivalences }
  )
  const proposed = []
  if (!issues.length) {
    try {
      assertPurchaseCodeMonths({
        records,
        previous: preparations,
        preparations: drafts,
      })
      assertConsumedCodeChanges({
        previous: preparations,
        preparations: drafts,
        locks: locksOf(state),
      })
      for (const draft of drafts) {
        const record = byOrder.get(key(draft))
        const allocation = allocatePreparation(
          draft,
          packing.allocations,
          packing.issuedCodes,
          {
            snapshot: record.snapshot,
            historicalReservations,
            supplierIdentityEquivalences,
          }
        )
        packing = allocation
        proposed.push(allocation.preparation)
      }
    } catch (error) {
      problem(
        error.code ?? 'PURCHASE_CODE_CONFLICT',
        error.message,
        error.detail
      )
    }
  }
  for (const draft of proposed) {
    const record = byOrder.get(key(draft)),
      old = previous.get(key(draft))
    for (const group of draft.groups)
      for (const variant of group.variants)
        for (const entryId of variant.entryIds) {
          if (!selected.get(key(draft))?.has(entryId)) continue
          const item = record.snapshot.items.find(
            (value) => value.entryId === entryId
          )
          const oldGroup = old?.groups.find((value) =>
            value.variants.some((entry) => entry.entryIds.includes(entryId))
          )
          const oldVariant = oldGroup?.variants.find((value) =>
            value.entryIds.includes(entryId)
          )
          changes.push({
            accountId: draft.accountId,
            orderId: draft.orderId,
            entryId,
            groupId: group.id,
            variantId: variant.id,
            photo: clone(item),
            name: item.description ?? item.title,
            before:
              oldGroup?.baseCode && oldVariant && !oldVariant.needsSizeMapping
                ? barcodeValue(oldGroup, oldVariant)
                : '',
            after: variant.needsSizeMapping ? '' : barcodeValue(group, variant),
            baseCode: group.baseCode,
            purchaseMonth: purchaseMonthForCodes(record),
            quantity: String(item.quantity),
            price: item.price,
            supplierIdentity: purchaseSupplierForCodes(record),
          })
          if (variant.needsSizeMapping)
            problem(
              'PURCHASE_SIZE_REQUIRED',
              'Resolve the source size before assigning a barcode.',
              { orderId: draft.orderId, entryId },
              'warning'
            )
        }
  }
  const expectedRevisions = proposed.map((draft) => draft.revision)
  const plan = {
    preparations: proposed,
    expectedSnapshots,
    expectedRevisions,
    selection: { orderRefs: clone(orderRefs), entryRefs: clone(entryRefs) },
    issues: clone(issues),
  }
  return { plan, changes, issues, expectedRevisions }
}

/** Portable reviewed equivalence, scoped to one source order and its actual code owners. */
export function supplierCodeIdentityEquivalences(records = []) {
  const result = []
  for (const record of records) {
    const review = record.supplierCodeIdentityReview,
      identity = purchaseSupplierForCodes(record)
    if (
      !review ||
      identity.conflict ||
      !identity.sellerId ||
      review.accountId !== (record.snapshot.accountId || 'local') ||
      review.orderId !== record.snapshot.orderId ||
      review.canonicalSellerId !== identity.sellerId ||
      review.storeId !== identity.storeId ||
      review.provenance !== 'manual-confirmed' ||
      !calendarDate(review.updatedAt) ||
      !review.reason?.trim() ||
      !calendarDate(review.reviewedObservedAt) ||
      !Number.isSafeInteger(review.reviewedPreparationRevision) ||
      review.reviewedPreparationRevision < 0 ||
      !Array.isArray(review.codeOwners) ||
      !review.legacySellerId ||
      review.codeOwners.some(
        (owner) => !owner.groupId || !/^CE\d{8}$/.test(owner.baseCode)
      )
    )
      continue
    result.push(clone(review))
  }
  return result
}
export function hasReviewedSupplierCodeIdentity(record, preparation) {
  const identity = purchaseSupplierForCodes(record)
  return Boolean(
    !identity.conflict &&
    identity.sellerId &&
    (preparation.sellerId === identity.sellerId ||
      supplierCodeIdentityEquivalences([record]).some(
        (review) => review.legacySellerId === preparation.sellerId
      ))
  )
}

/** One review previews identity equivalence; no code, prefix, reservation or source changes. */
export function planLegacySupplierIdentityReview(state, reference) {
  const record = (state.records ?? state.orders ?? []).find(
    (value) => key(value) === key(reference)
  )
  const preparation = (state.preparations ?? []).find(
    (value) => key(value) === key(reference)
  )
  if (!record || !preparation)
    throw codeError(
      'PURCHASE_SOURCE_MISSING',
      'The purchase code identity changed. Reopen the review.'
    )
  const identity = purchaseSupplierForCodes(record)
  if (!identity.sellerId || identity.conflict)
    throw codeError(
      'SELLER_IDENTITY_REQUIRED',
      'Resolve the original supplier identity before reviewing its historical code owner.'
    )
  const codeOwners = preparation.groups
    .filter(
      (group) =>
        group.baseCode &&
        packingCodeSellerId(preparation, group, state) === preparation.sellerId
    )
    .map((group) => ({ groupId: group.id, baseCode: group.baseCode }))
  const expectedSourceRevision = sourceRevision(record, preparation)
  const requiresAmendment = locksOf(state).some(
    (lock) =>
      lock.kind === 'code-consumption' &&
      (key(lock) === key(reference) ||
        lock.lineages.some((lineage) =>
          lineage.members.some((member) => key(member) === key(reference))
        ))
  )
  const plan = {
    accountId: preparation.accountId,
    orderId: preparation.orderId,
    legacySellerId: preparation.sellerId,
    canonicalSellerId: identity.sellerId,
    storeId: identity.storeId,
    codeOwners,
    expectedObservedAt: record.snapshot.observedAt,
    expectedPreparationRevision: preparation.revision,
    expectedSourceRevision,
    expectedSupplierResolution: clone(
      record.supplierIdentityResolution ?? null
    ),
    expectedEquivalence: clone(record.supplierCodeIdentityReview ?? null),
    requiresAmendment,
  }
  return {
    plan,
    changes: [
      {
        accountId: preparation.accountId,
        orderId: preparation.orderId,
        before: preparation.sellerId,
        after: identity.sellerId,
        codeOwners: clone(codeOwners),
        source: identity.provenance,
      },
    ],
    issues: [],
    expectedRevisions: [preparation.revision],
    requiresAmendment,
    affectedShipmentRevisions: clone(
      (state.affectedShipmentRevisions ?? []).filter(
        (value) => !value.orderId || value.orderId === preparation.orderId
      )
    ),
  }
}

/** Storage invokes inside its guarded confirmation transaction, never from rendering. */
export function applyLegacySupplierIdentityReview({
  state,
  plan,
  confirmed,
  amendment = false,
  updatedAt,
  reason,
}) {
  if (confirmed !== true)
    throw codeError(
      'IDENTITY_REVIEW_REQUIRED',
      'Confirm that the historical code owner and canonical supplier identify the same supplier.'
    )
  if (typeof reason !== 'string' || !reason.trim())
    throw codeError(
      'IDENTITY_REVIEW_REQUIRED',
      'Record the reason for confirming supplier identity equivalence.'
    )
  if (!calendarDate(updatedAt))
    throw codeError(
      'IDENTITY_REVIEW_REQUIRED',
      'The identity review requires its recorded confirmation time.'
    )
  const current = planLegacySupplierIdentityReview(state, plan).plan
  if (stableValue(current) !== stableValue(plan))
    throw codeError(
      'STALE_IDENTITY_REVIEW',
      'The source or preparation changed. Review the supplier identity again.'
    )
  if (current.requiresAmendment && !amendment)
    throw codeError(
      'CONSUMED_CODE_LINEAGE',
      'Consumed supplier identity corrections require a versioned container amendment.'
    )
  const record = (state.records ?? state.orders ?? []).find(
    (value) => key(value) === key(plan)
  )
  const review = {
    accountId: plan.accountId,
    orderId: plan.orderId,
    legacySellerId: plan.legacySellerId,
    canonicalSellerId: plan.canonicalSellerId,
    storeId: plan.storeId,
    codeOwners: clone(plan.codeOwners),
    provenance: 'manual-confirmed',
    updatedAt,
    reason: reason.trim(),
    reviewedObservedAt: plan.expectedObservedAt,
    reviewedPreparationRevision: plan.expectedPreparationRevision,
  }
  return { ...clone(record), supplierCodeIdentityReview: review }
}
