// Physical marks are evidence on existing cartons, not another code ledger.
const clone = (value) => structuredClone(value)
const base = /^CE\d{4}(?:0[1-9]|[1-9]\d)(?:0[1-9]|[1-9]\d)$/
const fail = (message) => {
  throw Object.assign(new Error(message), { code: 'PHYSICAL_MARK_REVIEW_REQUIRED' })
}
const text = (value) => typeof value === 'string' && value.trim().length > 0
const reference = (value) => {
  if (!text(value?.orderId) || !text(value?.groupId))
    fail('Retain the original physical mark owner.')
  return { orderId: value.orderId, groupId: value.groupId }
}
export const PHYSICAL_MARK_CHOICES = ['keep-recorded-mark', 'relabel-reprint']

function resolution(input, { pending = false } = {}) {
  if (input == null) return null
  if (
    !PHYSICAL_MARK_CHOICES.includes(input.choice) ||
    !text(input.reason) || input.reason.length > 2000 ||
    input.provenance !== 'manual-confirmed' ||
    (input.choice === 'relabel-reprint' && input.physicalRelabelConfirmed !== true) ||
    (!pending && !Number.isFinite(Date.parse(input.resolvedAt)))
  ) fail('Choose and explain the physical mark resolution; confirm actual relabeling when reprinting.')
  return {
    choice: input.choice,
    reason: input.reason.trim(),
    physicalRelabelConfirmed: input.choice === 'relabel-reprint',
    provenance: 'manual-confirmed',
    resolvedAt: input.resolvedAt ?? null,
  }
}
export function validatePhysicalMark(input, { pending = false } = {}) {
  if (!input || !base.test(input.code) || !base.test(input.originalCode) ||
      (input.productCode !== '' && !base.test(input.productCode)) ||
      !Array.isArray(input.aliases) || !input.aliases.length ||
      !Array.isArray(input.relatedEntryIds) || !input.relatedEntryIds.length ||
      input.relatedEntryIds.some((id) => !/^\d+$/.test(id)) ||
      !Array.isArray(input.history) || JSON.stringify(input).length > 131072)
    fail('Retain complete physical mark and code ownership evidence.')
  const aliases = input.aliases.map((alias) => {
    if (!base.test(alias.code) || !/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(alias.month) ||
        !alias.code.startsWith(`CE${alias.month.slice(2).replace('-', '')}`) || !text(alias.sellerId))
      fail('Retain the original physical mark namespace.')
    return { code: alias.code, month: alias.month, sellerId: alias.sellerId }
  })
  if (new Set(aliases.map((alias) => alias.code)).size !== aliases.length ||
      !aliases.some((alias) => alias.code === input.originalCode))
    fail('Retain each physical alias exactly once.')
  const result = {
    code: input.code, originalCode: input.originalCode,
    originalMark: reference(input.originalMark), productCode: input.productCode,
    relatedEntryIds: [...new Set(input.relatedEntryIds)], aliases,
    resolution: resolution(input.resolution, { pending }), history: clone(input.history),
  }
  if (input.retiredAt !== undefined) {
    if (!Number.isFinite(Date.parse(input.retiredAt)) || !text(input.retirementReason))
      fail('Retain the physical alias retirement reason and time.')
    result.retiredAt = input.retiredAt
    result.retirementReason = input.retirementReason
  }
  return result
}
export function physicalMarkOwner(batch, preparations) {
  const mark = batch.mark ?? batch.groups?.[0]
  const preparation = preparations.find((value) =>
    (value.accountId || 'local') === (batch.accountId || 'local') && value.orderId === mark?.orderId)
  const group = preparation?.groups.find((value) => value.id === mark?.groupId)
  return group ? { preparation, group, mark } : null
}

/** Capture from actual before state. Caller snapshots cannot claim an old printed code. */
export function transitionPhysicalMark(before, after, beforePreparations, afterPreparations, {
  decision, updatedAt = null, issuedCodes = [],
} = {}) {
  if (!before) {
    if (after.physicalMark) fail('A physical alias requires the retained prior carton evidence.')
    return after
  }
  const oldOwner = physicalMarkOwner(before, beforePreparations)
  const nextOwner = physicalMarkOwner(after, afterPreparations)
  const previous = before.physicalMark
  const recorded = previous?.code || before.markCode || oldOwner?.group.baseCode || ''
  const productCode = nextOwner?.group.baseCode || ''
  if (!base.test(recorded) || (!previous && recorded === productCode)) {
    const result = { ...after }
    delete result.physicalMark
    if (decision) fail('These cartons have no pending physical mark resolution.')
    return result
  }
  const aliases = clone(previous?.aliases || [])
  if (oldOwner && !aliases.some((value) => value.code === recorded)) {
    const code = recorded
    const issued = issuedCodes.find((value) => value.accountId === before.accountId && value.kind === 'base' && value.code === code)
    aliases.push({ code, month: issued?.month || oldOwner.group.month || oldOwner.preparation.month,
      sellerId: issued?.sellerId || oldOwner.preparation.sellerId })
  }
  if (!aliases.length) fail('Review the original physical mark ownership before changing it.')
  let physicalMark = {
    ...(previous ? clone(previous) : {}), code: recorded,
    originalCode: previous?.originalCode || recorded,
    originalMark: clone(previous?.originalMark || oldOwner.mark), productCode,
    aliases,
    relatedEntryIds: [...new Set([
      ...(previous?.relatedEntryIds || []),
      ...(nextOwner?.group.variants.flatMap((variant) => variant.entryIds) ||
        oldOwner?.group.variants.flatMap((variant) => variant.entryIds) || []),
    ])],
    resolution: previous?.productCode === productCode ? clone(previous.resolution) : null,
    history: clone(previous?.history || []),
  }
  if (previous && previous.productCode !== productCode)
    physicalMark.history.push({ kind: 'product-code-change', code: previous.code,
      productCode: previous.productCode, resolution: clone(previous.resolution), at: updatedAt })
  if (decision) {
    if (!productCode) fail('Choose a valid current product owner before resolving its physical mark.')
    const resolved = resolution({ ...decision, provenance: 'manual-confirmed', resolvedAt: updatedAt }, { pending: updatedAt === null })
    physicalMark.history.push({ kind: 'resolution', code: recorded, productCode,
      resolution: clone(resolved), at: updatedAt })
    physicalMark.resolution = resolved
    if (resolved.choice === 'relabel-reprint') physicalMark.code = productCode
  }
  physicalMark = validatePhysicalMark(physicalMark, { pending: updatedAt === null })
  return { ...after, physicalMark }
}

/** Pure grouping-review decision; commit the returned changes with the preparations. */
export function resolvePhysicalMarkChange(plan, { batchId, ...decision }) {
  const result = clone(plan)
  const change = result.changes.find((value) => value.after?.id === batchId)
  if (!change?.after.physicalMark) fail('Reopen the grouping review for these cartons.')
  const mark = change.after.physicalMark
  const resolved = resolution({ ...decision, provenance: 'manual-confirmed', resolvedAt: null }, { pending: true })
  change.physicalMarkResolution = { choice: resolved.choice, reason: resolved.reason,
    physicalRelabelConfirmed: resolved.physicalRelabelConfirmed }
  mark.resolution = resolved
  if (resolved.choice === 'relabel-reprint') mark.code = mark.productCode
  result.after[batchId] = clone(change.after)
  const review = result.reviews.find((value) => value.id === batchId)
  if (review) {
    review.physicalMark = clone(mark)
    review.physicalMarkCode = mark.code
    review.resolutionRequired = false
  }
  return result
}

export function physicalMarkReadback(batch, preparations = []) {
  const currentProductCode = physicalMarkOwner(batch, preparations)?.group.baseCode || batch.physicalMark?.productCode || ''
  const physicalMarkCode = batch.physicalMark?.code || batch.markCode || currentProductCode
  return {
    physicalMarkCode, currentProductCode,
    ...(batch.physicalMark ? { physicalMark: clone(batch.physicalMark) } : {}),
    physicalMarkResolutionRequired: Boolean(batch.physicalMark && !batch.physicalMark.resolution),
  }
}

/** Actual old snapshots win over draft/Undo histories, including explicit blank and zero. */
export function retainCartonEvidence(before, after) {
  if (!before) return after
  const original = clone(before)
  delete original.cartonHistory
  return { ...after,
    cartonHistory: [...clone(before.cartonHistory || []), original],
    ...(before.sourceFacts !== undefined ? { sourceFacts: clone(before.sourceFacts) } : {}),
  }
}
