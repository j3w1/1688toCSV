// Physical marks are evidence on existing cartons, not another code ledger.
const clone = (value) => structuredClone(value)
const base = /^CE\d{4}(?:0[1-9]|[1-9]\d)(?:0[1-9]|[1-9]\d)$/
const fail = (message) => {
  throw Object.assign(new Error(message), {
    code: 'PHYSICAL_MARK_REVIEW_REQUIRED',
  })
}
const text = (value) => typeof value === 'string' && value.trim().length > 0
const reference = (value) => {
  if (!text(value?.orderId) || !text(value?.groupId))
    fail('Retain the original physical mark owner.')
  return { orderId: value.orderId, groupId: value.groupId }
}
export const PHYSICAL_MARK_CHOICES = Object.freeze([
  'keep-recorded-mark',
  'relabel-reprint',
])

export function physicalMarkRelabelOnly(batch) {
  return Boolean(
    batch.physicalMark?.supersededAliases?.some(
      (alias) => alias.code === batch.physicalMark.code
    )
  )
}
export function physicalMarkResolutionChoices(batch) {
  return !batch.physicalMark
    ? []
    : physicalMarkRelabelOnly(batch)
      ? ['relabel-reprint']
      : [...PHYSICAL_MARK_CHOICES]
}
function assertPhysicalMarkChoice(batch, choice) {
  if (physicalMarkRelabelOnly(batch) && choice !== 'relabel-reprint')
    throw Object.assign(
      new Error(
        'This recorded mark was released and is now owned by another product or shipment. Reprint a current product mark and confirm actual physical relabeling.'
      ),
      { code: 'PHYSICAL_MARK_RELABEL_REQUIRED' }
    )
}

const sameReference = (left, right) =>
  left?.orderId === right?.orderId && left?.groupId === right?.groupId
const artworkValue = (value) =>
  value == null
    ? null
    : JSON.stringify(
        [
          'code',
          'baseCode',
          'orderId',
          'groupId',
          'title',
          'spanishName',
          'category',
          'chineseCategory',
          'provenance',
          'entryIds',
        ].map((field) => value[field])
      )
function artwork(owner, code) {
  return owner
    ? {
        code,
        baseCode: code,
        orderId: owner.mark.orderId,
        groupId: owner.mark.groupId,
        title: owner.group.title || '',
        spanishName: owner.group.spanishName || '',
        category: owner.group.category || '',
        chineseCategory: owner.group.category || '',
        entryIds: [
          ...new Set(
            owner.group.variants.flatMap((variant) => variant.entryIds)
          ),
        ],
        provenance: 'recorded-owner-text',
      }
    : null
}
function validateArtwork(input, code) {
  if (input == null) return null
  if (
    input.code !== code ||
    input.baseCode !== code ||
    input.provenance !== 'recorded-owner-text' ||
    !['title', 'spanishName', 'category', 'chineseCategory'].every(
      (field) => typeof input[field] === 'string'
    )
  )
    fail(
      'Retain the recorded mark owner text separately from current product labels.'
    )
  if (
    input.entryIds !== undefined &&
    (!Array.isArray(input.entryIds) ||
      input.entryIds.some(
        (id) => typeof id !== 'string' || !/^[1-9]\d*$/.test(id)
      ))
  )
    fail('Retain the recorded mark source-entry associations.')
  return {
    code,
    baseCode: code,
    ...reference(input),
    title: input.title,
    spanishName: input.spanishName,
    category: input.category,
    chineseCategory: input.chineseCategory,
    provenance: 'recorded-owner-text',
    ...(input.entryIds === undefined
      ? {}
      : { entryIds: [...new Set(input.entryIds)] }),
  }
}
export function physicalMarkResolutionRequired(batch) {
  const mark = batch.physicalMark
  return Boolean(
    mark &&
    (physicalMarkRelabelOnly(batch) ||
      (!mark.resolution &&
        (mark.code !== mark.productCode ||
          !sameReference(mark.originalMark, batch.mark ?? batch.groups?.[0]))))
  )
}

/** A cancelable logical draft cannot be the only copy of an actual physical act. */
export function assertPhysicalMarkCommandContext(
  change,
  { contextContainerId } = {}
) {
  if (
    contextContainerId &&
    change.physicalMarkResolution?.choice === 'relabel-reprint'
  )
    throw Object.assign(
      new Error(
        'Relabeling must be confirmed on unsealed cartons. In an amendment, keep the recorded mark (shown beside the code) or finish the amendment first.'
      ),
      { code: 'PHYSICAL_RELABEL_AMENDMENT_PENDING' }
    )
}

function resolution(input, { pending = false } = {}) {
  if (input == null) return null
  if (
    !PHYSICAL_MARK_CHOICES.includes(input.choice) ||
    !text(input.reason) ||
    input.reason.length > 2000 ||
    input.provenance !== 'manual-confirmed' ||
    (input.choice === 'relabel-reprint' &&
      input.physicalRelabelConfirmed !== true) ||
    (!pending && !Number.isFinite(Date.parse(input.resolvedAt)))
  )
    fail(
      'Choose and explain the physical mark resolution; confirm actual relabeling when reprinting.'
    )
  return {
    choice: input.choice,
    reason: input.reason.trim(),
    physicalRelabelConfirmed: input.choice === 'relabel-reprint',
    provenance: 'manual-confirmed',
    resolvedAt: input.resolvedAt ?? null,
  }
}
export function validatePhysicalMark(input, { pending = false } = {}) {
  if (
    !input ||
    !base.test(input.code) ||
    !base.test(input.originalCode) ||
    (input.productCode !== '' && !base.test(input.productCode)) ||
    !Array.isArray(input.aliases) ||
    !input.aliases.length ||
    !Array.isArray(input.relatedEntryIds) ||
    !input.relatedEntryIds.length ||
    input.relatedEntryIds.some((id) => !/^[1-9]\d*$/.test(id)) ||
    !Array.isArray(input.history) ||
    JSON.stringify(input).length > 131072
  )
    fail('Retain complete physical mark and code ownership evidence.')
  const aliases = input.aliases.map((alias) => {
    if (
      !base.test(alias.code) ||
      !/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(alias.month) ||
      !alias.code.startsWith(`CE${alias.month.slice(2).replace('-', '')}`) ||
      !text(alias.sellerId)
    )
      fail('Retain the original physical mark namespace.')
    return { code: alias.code, month: alias.month, sellerId: alias.sellerId }
  })
  if (
    new Set(aliases.map((alias) => alias.code)).size !== aliases.length ||
    !aliases.some((alias) => alias.code === input.originalCode)
  )
    fail('Retain each physical alias exactly once.')
  const result = {
    code: input.code,
    originalCode: input.originalCode,
    originalMark: reference(input.originalMark),
    productCode: input.productCode,
    relatedEntryIds: [...new Set(input.relatedEntryIds)],
    aliases,
    resolution: resolution(input.resolution, { pending }),
    history: clone(input.history),
    originalArtwork: validateArtwork(input.originalArtwork, input.originalCode),
    artwork: validateArtwork(input.artwork, input.code),
  }
  if (input.supersededAliases !== undefined) {
    if (
      !Array.isArray(input.supersededAliases) ||
      new Set(input.supersededAliases.map((value) => value.code)).size !==
        input.supersededAliases.length
    )
      fail('Retain each superseded physical alias exactly once.')
    result.supersededAliases = input.supersededAliases.map((value) => {
      if (
        !aliases.some((alias) => alias.code === value.code) ||
        !Number.isFinite(Date.parse(value.at)) ||
        !text(value.reason) ||
        !Array.isArray(value.conflicts) ||
        !value.conflicts.length ||
        !Array.isArray(value.currentProducts)
      )
        fail(
          'Retain the actual conflicting owner and fresh identity of the superseded alias.'
        )
      return {
        code: value.code,
        at: value.at,
        reason: value.reason,
        conflicts: value.conflicts.map((conflict) => {
          if (
            !text(conflict.accountId) ||
            !text(conflict.orderId) ||
            !text(conflict.groupId) ||
            !['current-primary', 'code-history', 'code-consumption'].includes(
              conflict.kind
            ) ||
            (conflict.kind !== 'current-primary' &&
              (!text(conflict.containerId) ||
                !text(conflict.revisionId) ||
                !Number.isFinite(Date.parse(conflict.consumedAt))))
          )
            fail(
              'Retain the actual shipment or current owner that superseded this physical alias.'
            )
          return {
            accountId: conflict.accountId,
            ...reference(conflict),
            kind: conflict.kind,
            ...(conflict.kind === 'current-primary'
              ? {}
              : {
                  containerId: conflict.containerId,
                  revisionId: conflict.revisionId,
                  consumedAt: conflict.consumedAt,
                  ...(text(conflict.containerName)
                    ? { containerName: conflict.containerName }
                    : {}),
                }),
          }
        }),
        currentProducts: value.currentProducts.map((product) => {
          if (!base.test(product.productCode))
            fail('Retain the fresh current product identity.')
          return {
            mark: reference(product.mark),
            productCode: product.productCode,
          }
        }),
      }
    })
  }
  if (
    (result.resolution?.choice === 'relabel-reprint' &&
      result.code !== result.productCode) ||
    (result.code !== result.productCode &&
      !aliases.some((alias) => alias.code === result.code))
  )
    fail(
      'The recorded physical code must match its retained evidence and relabel attestation.'
    )
  if (input.retiredAt !== undefined) {
    if (
      !Number.isFinite(Date.parse(input.retiredAt)) ||
      !text(input.retirementReason)
    )
      fail('Retain the physical alias retirement reason and time.')
    result.retiredAt = input.retiredAt
    result.retirementReason = input.retirementReason
  }
  return result
}
export function physicalMarkOwner(batch, preparations) {
  const mark = batch.mark ?? batch.groups?.[0]
  const preparation = preparations.find(
    (value) =>
      (value.accountId || 'local') === (batch.accountId || 'local') &&
      value.orderId === mark?.orderId
  )
  const group = preparation?.groups.find((value) => value.id === mark?.groupId)
  return group ? { preparation, group, mark } : null
}

/** Explicit current mark contexts; contents determine references, never a guessed owner. */
export function physicalMarkOwnerChoices(
  batch,
  preparations,
  { eligibleEntryIds = [], storeId } = {}
) {
  if (storeId !== batch.storeId) return []
  const orderIds = [
    ...new Set(
      [
        batch.orderId,
        batch.physicalMark?.originalMark.orderId,
        ...(batch.contents || []).map((row) => row.orderId),
        ...(batch.groups || []).map((row) => row.orderId),
      ].filter(Boolean)
    ),
  ]
  if (orderIds.length !== 1) return []
  const orderId = orderIds[0],
    eligible = new Set(eligibleEntryIds),
    own = preparations.filter(
      (preparation) =>
        preparation.accountId === (batch.accountId || 'local') &&
        preparation.orderId === orderId
    ),
    rows = [
      ...(batch.contents || []),
      ...Object.values(batch.unitContents || {}).flat(),
    ],
    groups = own.flatMap((preparation) =>
      preparation.groups
        .filter((group) =>
          group.variants.some((variant) =>
            variant.entryIds.some(
              (id) =>
                rows.some((row) => row.entryId === id) ||
                (batch.unresolvedContents || []).some(
                  (claim) =>
                    claim.entryIds?.includes(id) || claim.groupId === group.id
                )
            )
          )
        )
        .map((group) => ({ orderId, groupId: group.id }))
    )
  return own.flatMap((preparation) =>
    preparation.groups
      .filter(
        (group) =>
          base.test(group.baseCode) &&
          (batch.orderId ||
            (group.month || preparation.month) === batch.month) &&
          group.variants.some((variant) =>
            variant.entryIds.some((id) => eligible.has(id))
          )
      )
      .map((group) => {
        const mark = { orderId, groupId: group.id }
        return {
          mark,
          productCode: group.baseCode,
          artwork: artwork({ preparation, group, mark }, group.baseCode),
          groups: clone(groups.length ? groups : batch.groups || []),
        }
      })
  )
}

/** Capture from actual before state. Caller snapshots cannot claim an old printed code. */
export function transitionPhysicalMark(
  before,
  after,
  beforePreparations,
  afterPreparations,
  { decision, restoreHistory = false, updatedAt = null, issuedCodes = [] } = {}
) {
  if (restoreHistory !== false && restoreHistory !== true)
    fail('Request a typed logical keep-mark history restore.')
  if (!before) {
    if (after.physicalMark)
      fail('A physical alias requires the retained prior carton evidence.')
    return after
  }
  const oldOwner = physicalMarkOwner(before, beforePreparations)
  const nextOwner = physicalMarkOwner(after, afterPreparations)
  const previous = before.physicalMark
  const recorded =
    previous?.code ||
    (base.test(before.markCode)
      ? before.markCode
      : oldOwner?.group.baseCode || '')
  const productCode = nextOwner?.group.baseCode || ''
  if (!base.test(recorded) || (!previous && recorded === productCode)) {
    const result = { ...after }
    delete result.physicalMark
    if (decision)
      fail('These cartons have no pending physical mark resolution.')
    return result
  }
  const aliases = clone(previous?.aliases || [])
  if (oldOwner && !aliases.some((value) => value.code === recorded)) {
    const code = recorded
    const issued = issuedCodes.find(
      (value) =>
        value.accountId === before.accountId &&
        value.kind === 'base' &&
        value.code === code
    )
    aliases.push({
      code,
      month:
        issued?.month || oldOwner.group.month || oldOwner.preparation.month,
      sellerId: issued?.sellerId || oldOwner.preparation.sellerId,
    })
  }
  if (!aliases.length)
    fail('Review the original physical mark ownership before changing it.')
  let physicalMark = {
    ...(previous ? clone(previous) : {}),
    code: recorded,
    originalCode: previous?.originalCode || recorded,
    originalMark: clone(previous?.originalMark || oldOwner.mark),
    productCode,
    aliases,
    relatedEntryIds: [
      ...new Set([
        ...(previous?.relatedEntryIds || []),
        ...(before.contents || []).map((row) => row.entryId),
        ...(before.unresolvedContents || []).flatMap(
          (claim) => claim.entryIds || []
        ),
        ...Object.values(before.unitContents || {}).flatMap((rows) =>
          rows.map((row) => row.entryId)
        ),
        ...(after.contents || []).map((row) => row.entryId),
        ...(after.unresolvedContents || []).flatMap(
          (claim) => claim.entryIds || []
        ),
        ...Object.values(after.unitContents || {}).flatMap((rows) =>
          rows.map((row) => row.entryId)
        ),
        ...(oldOwner?.group.variants.flatMap((variant) => variant.entryIds) ||
          []),
        ...(nextOwner?.group.variants.flatMap((variant) => variant.entryIds) ||
          []),
      ]),
    ],
    resolution:
      previous?.productCode === productCode ? clone(previous.resolution) : null,
    history: clone(previous?.history || []),
    originalArtwork: previous
      ? clone(previous.originalArtwork ?? null)
      : artwork(oldOwner, recorded),
    artwork: previous
      ? clone(previous.artwork ?? null)
      : artwork(oldOwner, recorded),
  }
  if (previous && previous.productCode !== productCode)
    physicalMark.history.push({
      kind: 'product-code-change',
      code: previous.code,
      productCode: previous.productCode,
      resolution: clone(previous.resolution),
      at: updatedAt,
    })
  if (decision) {
    assertPhysicalMarkChoice({ physicalMark }, decision.choice)
    if (restoreHistory)
      fail('Choose a fresh resolution or a logical history restore, not both.')
    if (!productCode)
      fail(
        'Choose a valid current product owner before resolving its physical mark.'
      )
    const resolved = resolution(
      { ...decision, provenance: 'manual-confirmed', resolvedAt: updatedAt },
      { pending: updatedAt === null }
    )
    physicalMark.history.push({
      kind: 'resolution',
      code: recorded,
      productCode,
      resolution: clone(resolved),
      at: updatedAt,
    })
    physicalMark.resolution = resolved
    if (resolved.choice === 'relabel-reprint') {
      physicalMark.code = productCode
      physicalMark.artwork = artwork(nextOwner, productCode)
    }
  }
  if (restoreHistory) {
    assertPhysicalMarkChoice({ physicalMark }, 'keep-recorded-mark')
    if (!physicalMark.artwork)
      fail(
        'Known recorded artwork is required to restore a keep-mark relation from history.'
      )
    const requested = after.physicalMark,
      historical = [before, ...(before.cartonHistory || []).toReversed()].find(
        (entry) => {
          const saved = entry.physicalMark
          return (
            entry.id === before.id &&
            entry.accountId === before.accountId &&
            sameReference(entry.mark ?? entry.groups?.[0], nextOwner?.mark) &&
            saved?.resolution?.choice === 'keep-recorded-mark' &&
            requested?.resolution?.choice === 'keep-recorded-mark' &&
            saved.code === recorded &&
            requested.code === recorded &&
            saved.productCode === productCode &&
            requested.productCode === productCode &&
            saved.originalCode === physicalMark.originalCode &&
            requested.originalCode === physicalMark.originalCode &&
            sameReference(saved.originalMark, physicalMark.originalMark) &&
            sameReference(requested.originalMark, physicalMark.originalMark) &&
            saved.resolution.reason === requested.resolution.reason &&
            requested.resolution.provenance === saved.resolution.provenance &&
            requested.resolution.physicalRelabelConfirmed === false &&
            (requested.resolution.resolvedAt == null ||
              requested.resolution.resolvedAt ===
                saved.resolution.resolvedAt) &&
            artworkValue(saved.artwork) ===
              artworkValue(physicalMark.artwork) &&
            artworkValue(requested.artwork) ===
              artworkValue(physicalMark.artwork) &&
            artworkValue(saved.originalArtwork) ===
              artworkValue(physicalMark.originalArtwork) &&
            artworkValue(requested.originalArtwork) ===
              artworkValue(physicalMark.originalArtwork)
          )
        }
      )
    if (!historical || !productCode)
      fail(
        'The actual physical code, recorded artwork or retained keep-mark history no longer matches. Review the physical mark again.'
      )
    physicalMark.resolution = clone(historical.physicalMark.resolution)
    physicalMark.history.push({
      kind: 'logical-history-restore',
      code: recorded,
      productCode,
      restoredFromRevision: historical.revision,
      resolution: clone(physicalMark.resolution),
      at: updatedAt,
    })
  }
  physicalMark = validatePhysicalMark(physicalMark, {
    pending: updatedAt === null,
  })
  return { ...after, physicalMark }
}

/** Pure grouping-review decision; commit the returned changes with the preparations. */
export function resolvePhysicalMarkChange(
  plan,
  { batchId, targetMark, ...decision }
) {
  const result = clone(plan)
  const change = result.changes.find((value) => value.after?.id === batchId)
  if (!change?.after.physicalMark)
    fail('Reopen the grouping review for these cartons.')
  const review = result.reviews.find((value) => value.id === batchId)
  if (targetMark) {
    const owner = review?.physicalMarkOwnerChoices?.find((choice) =>
      sameReference(choice.mark, targetMark)
    )
    if (!owner)
      fail('Choose a valid current mark owner from this purchase review.')
    change.after.mark = clone(owner.mark)
    change.after.groups = clone(owner.groups)
    if (owner.needsReview) change.after.needsReview = true
    else delete change.after.needsReview
    change.after.physicalMark.productCode = owner.productCode
    change.after.physicalMark.resolution = null
    review.currentProductCode = owner.productCode
    review.currentProductArtwork = clone(owner.artwork)
    review.destinationMark = clone(owner.mark)
    review.destinationGroups = clone(owner.groups)
    review.afterMarkCode = owner.productCode
    review.needsReview = Boolean(owner.needsReview)
    review.issues = clone(owner.issues || [])
    if (!owner.needsReview) review.kind = 'reanchor'
  }
  const mark = change.after.physicalMark
  assertPhysicalMarkChoice(change.after, decision.choice)
  if (!base.test(mark.productCode))
    fail(
      'Select an explicit current mark owner before resolving its physical mark.'
    )
  const resolved = resolution(
    { ...decision, provenance: 'manual-confirmed', resolvedAt: null },
    { pending: true }
  )
  change.physicalMarkResolution = {
    choice: resolved.choice,
    reason: resolved.reason,
    physicalRelabelConfirmed: resolved.physicalRelabelConfirmed,
  }
  mark.resolution = resolved
  mark.code =
    resolved.choice === 'relabel-reprint'
      ? mark.productCode
      : result.before[batchId]?.physicalMark?.code ||
        result.reviews.find((value) => value.id === batchId)?.beforeMarkCode ||
        mark.originalCode
  mark.artwork =
    resolved.choice === 'relabel-reprint'
      ? clone(
          result.reviews.find((value) => value.id === batchId)
            ?.currentProductArtwork ?? null
        )
      : clone(
          result.before[batchId]?.physicalMark?.artwork ??
            mark.originalArtwork ??
            null
        )
  result.after[batchId] = clone(change.after)
  if (review) {
    review.physicalMark = clone(mark)
    review.physicalMarkCode = mark.code
    review.resolutionRequired = false
    review.physicalMarkRelabelOnly = physicalMarkRelabelOnly(change.after)
    review.physicalMarkResolutionChoices = physicalMarkResolutionChoices(
      change.after
    )
    review.resolutionChoices = physicalMarkResolutionChoices(change.after)
    review.physicalMarkSupersessions = clone(mark.supersededAliases || [])
  }
  return result
}

export function physicalMarkReadback(batch, preparations = []) {
  const currentProductCode =
    physicalMarkOwner(batch, preparations)?.group.baseCode ||
    batch.physicalMark?.productCode ||
    ''
  const physicalMarkCode =
    batch.physicalMark?.code || batch.markCode || currentProductCode
  const knownContents = [
    ...(batch.contents || []),
    ...Object.values(batch.unitContents || {}).flat(),
  ]
  const currentProductCodes = [
    ...new Set(
      preparations
        .filter(
          (preparation) =>
            preparation.accountId === (batch.accountId || 'local')
        )
        .flatMap((preparation) =>
          preparation.groups
            .filter(
              (group) =>
                group.variants.some((variant) =>
                  knownContents.some(
                    (row) =>
                      row.orderId === preparation.orderId &&
                      variant.entryIds.includes(row.entryId)
                  )
                ) ||
                (batch.unresolvedContents || []).some(
                  (claim) =>
                    claim.orderId === preparation.orderId &&
                    claim.groupId === group.id
                )
            )
            .map((group) => group.baseCode)
        )
        .filter(Boolean)
    ),
  ]
  return {
    physicalMarkCode,
    currentProductCode,
    currentProductCodes,
    recordedArtwork: batch.physicalMark
      ? clone(batch.physicalMark.artwork ?? null)
      : artwork(physicalMarkOwner(batch, preparations), physicalMarkCode),
    currentProductArtwork: artwork(
      physicalMarkOwner(batch, preparations),
      currentProductCode
    ),
    ...(batch.physicalMark ? { physicalMark: clone(batch.physicalMark) } : {}),
    physicalMarkResolutionRequired: physicalMarkResolutionRequired(batch),
    physicalMarkRelabelOnly: physicalMarkRelabelOnly(batch),
    physicalMarkResolutionChoices: physicalMarkResolutionChoices(batch),
    physicalMarkSupersessions: clone(
      batch.physicalMark?.supersededAliases || []
    ),
  }
}

/** Actual old snapshots win over draft/Undo histories, including explicit blank and zero. */
export function retainCartonEvidence(before, after) {
  if (!before) return after
  const original = clone(before)
  delete original.cartonHistory
  return {
    ...after,
    cartonHistory: [...clone(before.cartonHistory || []), original],
    ...(before.sourceFacts !== undefined
      ? { sourceFacts: clone(before.sourceFacts) }
      : {}),
  }
}
