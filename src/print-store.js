// Print settings, A4 presets and recent export jobs, kept in this browser's
// local storage. Labels and carton marks remember their settings separately.
import {
  DEFAULT_PRESET,
  normalizeLabelLayout,
  normalizeMarkLayout,
} from './print-layout.js'
import { printLanguage } from './print-language.js'
import { batchOrderIds } from './inventory-model.js'
import { physicalMarkSupersessionState } from './physical-mark-aliases.js'

export const PRINT_KEYS = Object.freeze({
  labels: '1688-print-labels',
  marks: '1688-print-carton-marks',
  presets: '1688-print-presets',
  recent: '1688-print-recent',
})
export const RECENT_LIMIT = 5
/** Larger exports are not kept in history rather than kept incomplete. */
export const RECENT_PRODUCT_LIMIT = 500
const PRESET_LIMIT = 20

function safeStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

const normalize = (kind, value) =>
  kind === 'marks' ? normalizeMarkLayout(value) : normalizeLabelLayout(value)

// Ids never derive from the name: any two distinct names stay distinct presets.
const newPresetId = () =>
  `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const refText = (value) =>
  typeof value === 'string' &&
  value &&
  value.length <= 512 &&
  !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null
const physicalScope = 'order-carton-mark'
const markRoles = ['recorded', 'current-product']
const baseCode = /^CE\d{8}$/
const physicalRefError = () =>
  new Error(
    'The captured carton mark changed. Review the current order before printing again.'
  )
const hasPhysicalRef = (ref) =>
  ref &&
  (ref.scope === physicalScope ||
    ref.batchId !== undefined ||
    ref.markRole !== undefined ||
    ref.sourceGuard !== undefined)
function cleanOrderCartonRef(ref) {
  if (
    ref?.scope !== physicalScope ||
    !['accountId', 'orderId', 'batchId', 'sourceObservedAt'].every((key) =>
      refText(ref[key])
    ) ||
    !Number.isFinite(Date.parse(ref.sourceObservedAt)) ||
    !Number.isSafeInteger(ref.index) ||
    ref.index < 0 ||
    !markRoles.includes(ref.markRole) ||
    !baseCode.test(ref.code) ||
    !(ref.currentProductCode === '' || baseCode.test(ref.currentProductCode)) ||
    !Number.isSafeInteger(ref.batchRevision) ||
    ref.batchRevision < 1 ||
    !Number.isSafeInteger(ref.preparationRevision) ||
    ref.preparationRevision < 0 ||
    typeof ref.sourceGuard !== 'string' ||
    !/^[0-9a-f]{64}$/.test(ref.sourceGuard) ||
    ['containerId', 'revisionId', 'draft', 'draftRevision', 'cartonId'].some(
      (key) => ref[key] !== undefined
    ) ||
    ((ref.contextContainerId !== undefined ||
      ref.amendmentEpoch !== undefined) &&
      (!refText(ref.contextContainerId) || !refText(ref.amendmentEpoch))) ||
    (ref.groupId !== undefined && !refText(ref.groupId)) ||
    (ref.productGroupId !== undefined &&
      (ref.markRole !== 'current-product' || !refText(ref.productGroupId)))
  )
    return null
  return {
    scope: physicalScope,
    accountId: ref.accountId,
    orderId: ref.orderId,
    batchId: ref.batchId,
    index: ref.index,
    markRole: ref.markRole,
    code: ref.code,
    currentProductCode: ref.currentProductCode,
    batchRevision: ref.batchRevision,
    preparationRevision: ref.preparationRevision,
    sourceObservedAt: ref.sourceObservedAt,
    sourceGuard: ref.sourceGuard,
    ...(ref.groupId !== undefined ? { groupId: ref.groupId } : {}),
    ...(ref.productGroupId !== undefined
      ? { productGroupId: ref.productGroupId }
      : {}),
    ...(ref.contextContainerId !== undefined
      ? {
          contextContainerId: ref.contextContainerId,
          amendmentEpoch: ref.amendmentEpoch,
        }
      : {}),
  }
}
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .filter((key) => value[key] !== undefined)
            .map((key) => [key, canonical(value[key])])
        )
      : value

/** Compact, complete captured source identity; no source/photo signature is stored. */
export async function makeOrderCartonPrintRef(
  context,
  { batchId, role = 'recorded', index = 0, productGroupId } = {}
) {
  const snapshot = context?.record?.snapshot,
    accountId = snapshot?.accountId || context?.record?.accountId || 'local',
    orderId = snapshot?.orderId,
    batch = context?.batches?.find((batch) => batch.id === batchId),
    owners = batch ? batchOrderIds(batch) : [],
    revisions = context?.revisions,
    amendment = context?.amendmentContext || revisions?.amendmentContext,
    preparationRevision = context?.preparation?.revision || 0
  if (
    !refText(accountId) ||
    !refText(orderId) ||
    !batch ||
    batch.deletedAt ||
    (batch.accountId || 'local') !== accountId ||
    owners.length !== 1 ||
    owners[0] !== orderId ||
    !Number.isSafeInteger(batch.count) ||
    batch.count < 1 ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    (batch.entitlementIndices
      ? !batch.entitlementIndices.includes(index)
      : index >= batch.count) ||
    !markRoles.includes(role) ||
    (productGroupId !== undefined &&
      (role !== 'current-product' || !refText(productGroupId))) ||
    !revisions ||
    typeof revisions.source !== 'string' ||
    !revisions.source ||
    revisions.observedAt !== snapshot.observedAt ||
    revisions.preparation !== preparationRevision ||
    revisions.cartons?.[batchId] !== batch.revision ||
    (context.preparation &&
      ((context.preparation.accountId || 'local') !== accountId ||
        context.preparation.orderId !== orderId)) ||
    ((batch.mark || batch.groups?.[0]) &&
      (batch.mark || batch.groups[0]).orderId !== orderId) ||
    (context.amendmentContext &&
      revisions.amendmentContext &&
      JSON.stringify(canonical(context.amendmentContext)) !==
        JSON.stringify(canonical(revisions.amendmentContext))) ||
    (amendment &&
      (!refText(amendment.containerId) || !refText(amendment.epoch)))
  )
    throw physicalRefError()
  const markState = physicalMarkSupersessionState(batch),
    supersession = [
      ...(batch.physicalMarkSupersessions || []),
      ...(batch.physicalMark?.supersededAliases || []),
    ].find(
      (entry) =>
        entry.code === batch.physicalMark?.code &&
        (entry.active !== false || entry.reviewRequired === true)
    )
  if (
    role === 'recorded' &&
    (markState.physicalMarkRelabelOnly ||
      markState.physicalMarkHistoricalReviewRequired ||
      batch.physicalMarkRelabelOnly === true ||
      batch.physicalMarkHistoricalReviewRequired === true)
  ) {
    const conflicts = supersession?.conflicts || [],
      conflict = conflicts.find((entry) => entry.containerId) || conflicts[0],
      code = batch.physicalMark?.code || '',
      historicalReview =
        markState.physicalMarkHistoricalReviewRequired ||
        batch.physicalMarkHistoricalReviewRequired === true ||
        supersession?.reviewRequired === true,
      message = historicalReview
        ? `The recorded mark ${code} needs historical ownership review. Print the current product mark and confirm physical relabeling.`
        : conflict?.containerId
          ? `The recorded mark ${code} belongs to shipment ${conflict.containerId} (revision ${conflict.revisionId || '—'}). Print the current product mark and confirm physical relabeling.`
          : conflict?.orderId
            ? `The recorded mark ${code} is currently reserved by purchase ${conflict.orderId}. This restriction clears when that purchase releases the code. Print the current product mark to relabel now.`
            : 'The recorded carton mark is superseded. Print the current product mark and confirm physical relabeling.'
    throw Object.assign(new Error(message), {
      code: 'PHYSICAL_MARK_RELABEL_REQUIRED',
      detail: {
        code,
        conflicts: structuredClone(conflicts),
        historicalReviewRequired: historicalReview,
        conflictKind: historicalReview
          ? 'historical-review'
          : markState.physicalMarkConflictKind,
      },
    })
  }
  const owner = context.preparation?.groups.find(
      (group) =>
        group.id ===
        (productGroupId || (batch.mark || batch.groups?.[0])?.groupId)
    ),
    currentProductCode = owner?.baseCode || '',
    code =
      role === 'recorded'
        ? batch.physicalMark?.code || currentProductCode
        : currentProductCode,
    artwork =
      role === 'recorded' && batch.physicalMark
        ? batch.physicalMark.artwork || null
        : owner
          ? {
              title: owner.title || '',
              spanishName: owner.spanishName || '',
              category: owner.category || '',
            }
          : null
  if (!baseCode.test(code)) throw physicalRefError()
  const bytes = new TextEncoder().encode(
    JSON.stringify(
      canonical({
        accountId,
        orderId,
        batchId,
        index,
        role,
        code,
        currentProductCode,
        artwork,
        productGroupId: productGroupId || null,
        revisions,
        amendmentContext: amendment || null,
      })
    )
  )
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const sourceGuard = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
  const ref = cleanOrderCartonRef({
    scope: physicalScope,
    accountId,
    orderId,
    batchId,
    index,
    markRole: role,
    code,
    currentProductCode,
    batchRevision: batch.revision,
    preparationRevision,
    sourceObservedAt: snapshot.observedAt,
    sourceGuard,
    ...(productGroupId !== undefined ? { productGroupId } : {}),
    ...(amendment
      ? {
          contextContainerId: amendment.containerId,
          amendmentEpoch: amendment.epoch,
        }
      : {}),
  })
  if (!ref) throw physicalRefError()
  return ref
}

export async function assertOrderCartonPrintRef(ref, context) {
  const cleaned = cleanOrderCartonRef(ref)
  if (!cleaned) throw physicalRefError()
  let expected
  try {
    expected = await makeOrderCartonPrintRef(context, {
      batchId: cleaned.batchId,
      role: cleaned.markRole,
      index: cleaned.index,
      productGroupId: cleaned.productGroupId,
    })
  } catch (error) {
    if (error.code === 'PHYSICAL_MARK_RELABEL_REQUIRED') throw error
    throw physicalRefError()
  }
  if (refKey(cleaned) !== refKey(expected)) throw physicalRefError()
  return true
}
export function orderCartonPrintIdentity(ref) {
  return cleanOrderCartonRef(ref)
}

function cleanPreset(input) {
  const name = String(input?.name ?? '')
    .trim()
    .slice(0, 40)
  if (!name) return null
  const layout = normalizeLabelLayout(input)
  return {
    id: String(input.id || newPresetId()).slice(0, 64),
    name,
    marginMm: layout.marginMm,
    offsetXMm: layout.offsetXMm,
    offsetYMm: layout.offsetYMm,
  }
}

/** Where a product lives: its order, group and (for labels) variant ids. */
function cleanRef(ref) {
  const text = (value) =>
    typeof value === 'string' &&
    value &&
    value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(value)
      ? value
      : null
  if (!ref || !text(ref.orderId)) return null
  if (hasPhysicalRef(ref)) return cleanOrderCartonRef(ref)
  const historical =
    ref.containerId !== undefined ||
    ref.revisionId !== undefined ||
    ref.draft !== undefined ||
    ref.draftRevision !== undefined
  const draft = ref.draft === true
  if (
    historical &&
    (!text(ref.containerId) ||
      (draft
        ? ref.revisionId !== null ||
          !Number.isSafeInteger(ref.draftRevision) ||
          ref.draftRevision < 1
        : !text(ref.revisionId) || ref.draftRevision !== undefined))
  )
    return null
  for (const key of ['accountId', 'cartonId', 'entryId'])
    if (ref[key] !== undefined && !text(ref[key])) return null
  if (
    !text(ref.groupId) &&
    !(historical && (text(ref.cartonId) || text(ref.entryId)))
  )
    return null
  return {
    orderId: ref.orderId,
    ...(text(ref.groupId) ? { groupId: ref.groupId } : {}),
    variantId: text(ref.variantId),
    ...(text(ref.accountId) ? { accountId: ref.accountId } : {}),
    ...(historical
      ? {
          containerId: ref.containerId,
          revisionId: ref.revisionId,
          ...(draft ? { draft: true, draftRevision: ref.draftRevision } : {}),
        }
      : {}),
    ...(text(ref.cartonId) ? { cartonId: ref.cartonId } : {}),
    ...(text(ref.entryId) ? { entryId: ref.entryId } : {}),
    ...(Array.isArray(ref.entryIds) &&
    ref.entryIds.length &&
    ref.entryIds.length <= 10000 &&
    ref.entryIds.every((entryId) => text(entryId))
      ? { entryIds: [...new Set(ref.entryIds)] }
      : {}),
    ...(Array.isArray(ref.cartonBatchIds) &&
    ref.cartonBatchIds.length &&
    ref.cartonBatchIds.length <= 10000 &&
    ref.cartonBatchIds.every(
      (id) => typeof id === 'string' && id && id.length <= 512
    )
      ? { cartonBatchIds: [...new Set(ref.cartonBatchIds)] }
      : {}),
  }
}
export const refKey = (ref) =>
  !ref
    ? ''
    : hasPhysicalRef(ref)
      ? JSON.stringify([
          physicalScope,
          ref.accountId,
          ref.orderId,
          ref.batchId,
          ref.index,
          ref.markRole,
          ref.code,
          ref.currentProductCode,
          ref.batchRevision,
          ref.preparationRevision,
          ref.sourceObservedAt,
          ref.sourceGuard,
          ref.contextContainerId || '',
          ref.amendmentEpoch || '',
          ref.productGroupId || '',
        ])
      : ref.containerId ||
          ref.revisionId ||
          ref.cartonId ||
          (ref.accountId && ref.accountId !== 'local')
        ? JSON.stringify([
            ref.accountId || 'local',
            ref.orderId,
            ref.groupId || '',
            ref.variantId || '',
            ref.containerId || '',
            ref.revisionId || '',
            ref.cartonId || '',
            ref.entryId || '',
            [...(ref.entryIds || [])].sort(),
            [...(ref.cartonBatchIds || [])].sort(),
            ...(ref.draft === true ? ['draft', ref.draftRevision] : []),
          ])
        : `${ref.orderId}/${ref.groupId}/${ref.variantId ?? ''}`

/** A draft reference is a captured version, never an alias for live Orders. */
export function assertContainerPrintRef(ref, manifest) {
  const cleaned = cleanRef(ref)
  if (
    !cleaned?.containerId ||
    cleaned.containerId !== manifest?.container?.id ||
    (cleaned.accountId || 'local') !==
      (manifest?.container?.accountId || 'local') ||
    (cleaned.draft
      ? manifest?.draft !== true ||
        manifest?.status === 'sealed' ||
        manifest?.revisionId != null ||
        manifest?.revision !== cleaned.draftRevision
      : manifest?.draft === true || manifest?.revisionId !== cleaned.revisionId)
  )
    throw new Error(
      cleaned?.draft
        ? 'This draft print reference has changed or is no longer available. Review the current container before printing again.'
        : 'The original container revision is unavailable. Review its print reference before printing again.'
    )
  return true
}

export function containerPrintIdentity(ref) {
  const value = cleanRef(ref)
  return value?.containerId
    ? {
        containerId: value.containerId,
        revisionId: value.revisionId,
        draft: value.draft === true,
        ...(value.draft ? { draftRevision: value.draftRevision } : {}),
      }
    : null
}

function cleanRefs(value) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > RECENT_PRODUCT_LIMIT
  )
    return undefined
  const refs = value.map(cleanRef)
  if (refs.some((ref) => !ref)) return undefined
  return [...new Map(refs.map((ref) => [refKey(ref), ref])).values()]
}

function cleanJob(input) {
  if (!input || !['labels', 'marks'].includes(input.kind)) return null
  if (
    !Array.isArray(input.products) ||
    input.products.length > RECENT_PRODUCT_LIMIT ||
    input.products.some(
      (product) =>
        (product?.refs !== undefined && !cleanRefs(product.refs)) ||
        (product?.ref !== undefined && !cleanRef(product.ref))
    )
  )
    return null
  const products = Array.isArray(input.products)
    ? input.products
        .filter((product) => typeof product?.code === 'string' && product.code)
        .map((product) => ({
          code: product.code,
          ...(cleanRef(product.ref) ? { ref: cleanRef(product.ref) } : {}),
          ...(cleanRefs(product.refs) ? { refs: cleanRefs(product.refs) } : {}),
          name:
            typeof product.name === 'string' ? product.name.slice(0, 120) : '',
          quantity: Math.max(0, Math.floor(Number(product.quantity)) || 0),
          ...(product.cap === null ||
          product.cap === undefined ||
          product.cap === ''
            ? {}
            : { cap: Math.max(0, Math.floor(Number(product.cap)) || 0) }),
        }))
    : []
  if (!products.length) return null
  const date = new Date(input.date)
  return {
    id: String(input.id || `${input.kind}-${date.getTime()}`).slice(0, 80),
    kind: input.kind,
    language: printLanguage(input.language),
    date: Number.isNaN(date.getTime())
      ? new Date(0).toISOString()
      : date.toISOString(),
    products,
    layout: normalize(input.kind, input.layout),
    pages: Math.max(0, Math.floor(Number(input.pages)) || 0),
    total: Math.max(0, Math.floor(Number(input.total)) || 0),
  }
}

/** Settings, presets and recent jobs over a Storage-like object. */
export function createPrintStore(storage = safeStorage()) {
  const read = (key, fallback) => {
    try {
      const value = JSON.parse(storage?.getItem(key) ?? 'null')
      return value ?? fallback
    } catch {
      return fallback
    }
  }
  const write = (key, value) => {
    try {
      storage?.setItem(key, JSON.stringify(value))
    } catch {}
  }
  const store = {
    layout(kind) {
      return normalize(kind, read(PRINT_KEYS[kind], {}))
    },
    saveLayout(kind, layout) {
      const value = normalize(kind, layout)
      write(PRINT_KEYS[kind], value)
      return value
    },
    presets() {
      const custom = read(PRINT_KEYS.presets, [])
      return [
        { ...DEFAULT_PRESET },
        ...(Array.isArray(custom) ? custom : [])
          .map(cleanPreset)
          .filter((preset) => preset && preset.id !== DEFAULT_PRESET.id),
      ]
    },
    /** Save or replace a named preset; returns it. */
    savePreset(input) {
      const name = String(input?.name ?? '').trim()
      // Saving under an existing name replaces that preset and keeps its id.
      const existing = store
        .presets()
        .slice(1)
        .find((entry) => entry.name === name)
      const preset = cleanPreset({
        ...input,
        id: existing?.id ?? newPresetId(),
      })
      if (!preset) throw new Error('Name the preset first.')
      if (
        preset.name === DEFAULT_PRESET.name ||
        preset.id === DEFAULT_PRESET.id
      )
        throw new Error(
          'Choose another name; the default preset stays as it is.'
        )
      const others = store
        .presets()
        .slice(1)
        .filter((entry) => entry.id !== preset.id && entry.name !== preset.name)
      write(PRINT_KEYS.presets, [...others, preset].slice(-PRESET_LIMIT))
      return preset
    },
    deletePreset(id) {
      if (id === DEFAULT_PRESET.id) return
      write(
        PRINT_KEYS.presets,
        store
          .presets()
          .slice(1)
          .filter((entry) => entry.id !== id)
      )
    },
    recentJobs() {
      const jobs = read(PRINT_KEYS.recent, [])
      return (Array.isArray(jobs) ? jobs : [])
        .map(cleanJob)
        .filter(Boolean)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, RECENT_LIMIT)
    },
    /** Remember an export; the five most recent across both types are kept. */
    recordJob(input) {
      const job = cleanJob({
        ...input,
        date: input.date ?? new Date().toISOString(),
      })
      if (!job) return null
      write(
        PRINT_KEYS.recent,
        [
          job,
          ...store.recentJobs().filter((entry) => entry.id !== job.id),
        ].slice(0, RECENT_LIMIT)
      )
      return job
    },
  }
  return store
}

/**
 * Rebuild a recent job against current product data. Products are found again
 * by their order, group and variant, never by code alone: a released code can
 * belong to another product now. `current` holds the entries found for the
 * job's references (each with its `ref`); quantities and caps come from the job.
 */
export function restoreJob(job, current) {
  const byRef = new Map(
    current.flatMap((item) =>
      (item.refs || (item.ref ? [item.ref] : [])).map((ref) => [
        refKey(ref),
        item,
      ])
    )
  )
  const items = new Map()
  const missing = []
  const changed = []
  for (const product of job.products) {
    const refs = product.refs || (product.ref ? [product.ref] : [])
    const matches = refs.map((ref) => byRef.get(refKey(ref)))
    const item = matches[0]
    // A historic shared quantity cannot be assigned to a surviving alias or
    // split across newly unlinked codes without another quantity review.
    if (!item || matches.some((match) => !match || match.key !== item.key)) {
      missing.push(product)
      continue
    }
    if (item.code !== product.code)
      changed.push({ from: product.code, to: item.code })
    const existing = items.get(item.key)
    if (existing) {
      existing.quantity += product.quantity
      for (const source of item.orders || [])
        if (!existing.orders?.some((entry) => entry.orderId === source.orderId))
          existing.orders = [...(existing.orders || []), source]
    } else
      items.set(item.key, {
        ...item,
        quantity: product.quantity,
        ...(product.cap === undefined ? {} : { cap: product.cap }),
      })
  }
  return {
    items: [...items.values()],
    missing,
    changed,
    layout: job.layout,
    kind: job.kind,
    date: job.date,
  }
}
