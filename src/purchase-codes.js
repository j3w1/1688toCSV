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
    state.issuedCodes ?? []
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
  const historicalReservations = historicalCodeReservations(locksOf(state))
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
