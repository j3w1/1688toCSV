import {
  projectBacklog,
  orderKey,
  sourceRevision,
  inventoryError,
  stableValue,
  physicalUnits,
  assertOrderCartonConservation,
  committedCartonOwners,
  reservedOrderOwners,
  effectiveShipments,
  batchOrderIds,
  batchNeedsLegacyReview,
  eligibleOrderItems,
  wholeUnits,
} from './inventory-model.js'
import {
  captureContainerOrder,
  projectContainer,
  reconciliationRevisions,
  assertReconciliationRevisions,
  orderScopeState,
  validateContainerRecord,
} from './container-model.js'
import {
  validateCartonBatch,
  assertSingleOrderCarton,
} from './carton-batches.js'
import { repeatProductStoreIdentity } from './repeat-products.js'
import { reconcileOrder } from './carton-reconciliation.js'
import {
  validateInventoryDispositions,
  resolvedPurchaseDate,
} from './order-eligibility.js'
import { imageCacheKey, collectImageReferences } from './images.js'

export const OPERATIONAL_STORES = [
  'orders',
  'history',
  'preparations',
  'cartonBatches',
  'containers',
  'packingReports',
  'packingReportSources',
  'orderCartonDrafts',
  'shipmentLocks',
  'operationIntents',
  'packingPreferences',
  'images',
  'packingAllocations',
  'issuedCodes',
]
const clone = (value) => structuredClone(value)
const ref = (input) => ({
  accountId: input.accountId || 'local',
  orderId: input.orderId,
})
const fail = (code, message, detail) => {
  throw inventoryError(code, message, detail)
}
export function createContainerRepository({
  read,
  write,
  requested,
  nextEditTimestamp,
  codeHooks = {},
}) {
  async function state(tx) {
    const fields = {
      records: 'orders',
      history: 'history',
      preparations: 'preparations',
      batches: 'cartonBatches',
      containers: 'containers',
      reports: 'packingReports',
      locks: 'shipmentLocks',
      allocations: 'packingAllocations',
      issuedCodes: 'issuedCodes',
    }
    const entries = await Promise.all(
      Object.entries(fields).map(async ([key, name]) => [
        key,
        await requested(tx.objectStore(name).getAll()),
      ])
    )
    return {
      ...Object.fromEntries(entries),
      preferences: (
        await requested(tx.objectStore('packingPreferences').get('packing'))
      )?.value,
    }
  }
  function containerFor(state, id, expected) {
    const value = state.containers.find((value) => value.id === id)
    if (!value)
      fail('CONTAINER_MISSING', 'This container is no longer in the library.', {
        id,
      })
    if (expected !== undefined && expected !== value.revision)
      fail(
        'CONTAINER_REVISION_CONFLICT',
        'This container changed in another tab. Retain the draft and review again.',
        { id, expected, actual: value.revision }
      )
    return value
  }
  function amendmentFor(loaded, input, { physical = false } = {}) {
    if (!input.contextContainerId) return null
    const container = containerFor(loaded, input.contextContainerId)
    const expected =
      input.expectedAmendment ||
      input.expectedRevisions?.amendmentContext ||
      input.draft?.amendmentContext
    if (
      !container.amendment ||
      !container.draft ||
      container.status !== 'amending' ||
      !expected ||
      expected.containerId !== container.id ||
      expected.epoch !== container.amendment.epoch
    )
      fail(
        'AMENDMENT_CONTEXT_CONFLICT',
        'This amendment ended or changed. Retain the draft and reopen its exact context.'
      )
    if (input.orderId) {
      const included = container.draft.orders.some(
          (member) => orderKey(member) === orderKey(input)
        ),
        related =
          !physical &&
          loaded.locks.some(
            (lock) =>
              lock.kind === 'code-consumption' &&
              lock.firstContainerId === container.id &&
              (orderKey(lock) === orderKey(input) ||
                lock.lineages.some((lineage) =>
                  lineage.members.some(
                    (member) => orderKey(member) === orderKey(input)
                  )
                ))
          )
      if (!included && !related)
        fail(
          'AMENDMENT_ORDER_SCOPE',
          'This purchase is outside the reviewed amendment scope.'
        )
    }
    return container
  }
  function draftId(kind, reference, container) {
    return `${kind}:${orderKey(reference)}${container ? `:amendment:${container.amendment.epoch}` : ''}`
  }
  function amendmentToken(container) {
    return { containerId: container.id, epoch: container.amendment.epoch }
  }
  async function draftRecovery(tx, kind, reference, container) {
    const currentId = draftId(kind, reference, container),
      saved = await requested(tx.objectStore('orderCartonDrafts').getAll())
    return {
      draft: saved.find((draft) => draft.id === currentId) || null,
      recoveredDrafts: container
        ? saved.filter(
            (draft) =>
              draft.id !== currentId &&
              orderKey(draft) === orderKey(reference) &&
              draft.id.startsWith(`${kind}:`) &&
              draft.amendmentContext?.containerId === container.id
          )
        : [],
    }
  }
  function refreshedMember(loaded, container, member) {
    const fresh = captureContainerOrder(
        overlay(loaded, container),
        member,
        container.id,
        { reserveRemainder: member.reserveRemainder }
      ),
      oldIds = member.cartons.map((unit) => unit.id).sort(),
      newIds = fresh.cartons.map((unit) => unit.id).sort()
    if (stableValue(oldIds) !== stableValue(newIds)) {
      member.availabilityPending = true
      return member
    }
    fresh.availableBefore = member.availableBefore.map((prior) => {
      const current = fresh.availableBefore.find(
        (row) => row.entryId === prior.entryId
      )
      return {
        ...prior,
        quantity:
          prior.quantity === null || current?.quantity === null
            ? null
            : String(
                BigInt(prior.quantity) < BigInt(current?.quantity || '0')
                  ? BigInt(prior.quantity)
                  : BigInt(current?.quantity || '0')
              ),
      }
    })
    return Object.assign(member, fresh)
  }
  function requireDraft(container) {
    if (!container.draft || !['draft', 'amending'].includes(container.status))
      fail(
        'CONTAINER_NOT_EDITABLE',
        'Open a draft or an amendment before editing.',
        { id: container.id }
      )
  }
  function overlay(state, container) {
    if (!container?.amendment) return state
    const changes = container.draft?.cartonChanges || [],
      reports = container.draft?.reportChanges || []
    return {
      ...state,
      records: [
        ...state.records.filter(
          (record) =>
            !(container.draft?.orderChanges || []).some(
              (change) => orderKey(change.after) === orderKey(record)
            )
        ),
        ...(container.draft?.orderChanges || []).map((change) => change.after),
      ],
      preparations: [
        ...state.preparations.filter(
          (prep) =>
            !(container.draft?.preparationChanges || []).some(
              (change) => orderKey(change.after) === orderKey(prep)
            )
        ),
        ...(container.draft?.preparationChanges || []).map(
          (change) => change.after
        ),
      ],
      batches: [
        ...state.batches.filter(
          (batch) => !changes.some((change) => change.after.id === batch.id)
        ),
        ...changes.map((change) => change.after),
      ],
      reports: [
        ...state.reports.filter(
          (report) => !reports.some((value) => value.id === report.id)
        ),
        ...reports,
      ],
    }
  }
  function view(state, container, revisionId) {
    const result = projectContainer(overlay(state, container), container, {
      revisionId,
    })
    return {
      ...result,
      container: {
        ...result.container,
        revision: container.revision,
        ...(container.amendment
          ? { amendment: clone(container.amendment) }
          : {}),
      },
    }
  }
  function bump(container) {
    container.revision++
    container.updatedAt = nextEditTimestamp(container.updatedAt)
    return container
  }
  async function mutate(name, input, operation) {
    return write(OPERATIONAL_STORES, async (tx) => {
      const signature = stableValue({
          name,
          input: { ...input, intentId: undefined },
        }),
        id = input.intentId
      if (id !== undefined) {
        if (typeof id !== 'string' || !id.trim() || id.length > 512)
          fail('INVALID_INTENT', 'Use a stable operation intent.')
        const old = await requested(tx.objectStore('operationIntents').get(id))
        if (old) {
          if (old.signature !== signature)
            fail('INTENT_REUSED', 'This intent belongs to another operation.')
          return clone(old.result)
        }
      }
      const loaded = await state(tx),
        result = await operation(tx, loaded)
      if (
        id &&
        !(
          name === 'commitPackingReportUpdate' && result?.status === 'unchanged'
        )
      )
        tx.objectStore('operationIntents').add({
          id,
          signature,
          result: clone(result),
          createdAt: new Date().toISOString(),
        })
      return result
    })
  }
  function graph(state) {
    committedCartonOwners(state.containers)
    reservedOrderOwners(state.containers)
    const shipped = new Map()
    for (const { manifest } of effectiveShipments(state.containers))
      for (const row of manifest.products || []) {
        const key = JSON.stringify([
          row.accountId || 'local',
          row.orderId,
          row.entryId,
        ])
        shipped.set(key, (shipped.get(key) || 0n) + wholeUnits(row.quantity))
      }
    for (const record of state.records) {
      for (const item of eligibleOrderItems(record, state.records)) {
        const key = JSON.stringify([
          record.snapshot.accountId || 'local',
          record.snapshot.orderId,
          item.entryId,
        ])
        if (
          item.eligible === null ||
          (shipped.get(key) || 0n) > BigInt(item.eligible)
        )
          fail(
            'SHIPMENT_OVERALLOCATION',
            'Effective shipments exceed the current eligible purchase.',
            { orderId: record.snapshot.orderId, entryId: item.entryId }
          )
      }
    }
    for (const { manifest } of effectiveShipments(state.containers))
      for (const unit of manifest.cartons || []) {
        const batch = state.batches.find((batch) => batch.id === unit.batchId),
          current =
            batch && physicalUnits(batch).find((value) => value.id === unit.id)
        if (
          !current ||
          current.accountId !== unit.accountId ||
          current.orderId !== unit.orderId
        )
          fail(
            'SHIPMENT_CARTON_MISSING',
            'An effective shipment requires its current physical carton and purchase ownership.',
            { cartonId: unit.id }
          )
        const frozenBatch = manifest.batches.find(
          (value) => value.id === batch.id
        )
        const fields = [
          'contents',
          'weight',
          'volume',
          'len',
          'wid',
          'ht',
          'mark',
          'reference',
          'labelOrigin',
        ]
        if (
          fields.some(
            (field) => stableValue(current[field]) !== stableValue(unit[field])
          ) ||
          (unit.contents === null &&
            [
              'contents',
              'unresolvedContents',
              'contentsUnknown',
              'packingBasis',
              'count',
            ].some(
              (field) =>
                stableValue(batch[field]) !== stableValue(frozenBatch?.[field])
            )) ||
          (['weightBasis', 'volumeBasis'].some(
            (field) =>
              batch[field] === 'batch' || frozenBatch?.[field] === 'batch'
          ) &&
            ['weight', 'weightBasis', 'suppliedCbm', 'volumeBasis'].some(
              (field) =>
                stableValue(batch[field]) !== stableValue(frozenBatch?.[field])
            ))
        )
          fail(
            'SHIPMENT_CARTON_CHANGED',
            'Current physical facts contradict an effective shipment; review an amendment before restoring them.',
            { cartonId: unit.id }
          )
      }
    for (const container of state.containers)
      for (const member of container.draft?.orders || []) {
        if (member.reserveRemainder === false) continue
        const { record } = orderScopeState(state, member)
        for (const available of member.availableBefore || []) {
          const eligible = eligibleOrderItems(record, state.records).find(
            (item) => item.entryId === available.entryId
          )?.eligible
          const key = JSON.stringify([
            member.accountId || 'local',
            member.orderId,
            available.entryId,
          ])
          if (
            available.quantity !== null &&
            eligible !== null &&
            eligible !== undefined &&
            BigInt(available.quantity) + (shipped.get(key) || 0n) >
              BigInt(eligible)
          )
            fail(
              'ORDER_RESERVATION_CONFLICT',
              'An effective shipment or restored fact conflicts with the reserved purchase remainder.',
              { orderId: member.orderId, entryId: available.entryId }
            )
        }
      }
    for (const { manifest } of effectiveShipments(state.containers))
      for (const order of manifest.orders || [])
        if (
          !state.records.some((record) => orderKey(record) === orderKey(order))
        )
          fail(
            'SHIPMENT_SOURCE_MISSING',
            'A historical shipment source is missing.',
            { orderId: order.orderId }
          )
  }
  function guardChanges(
    loaded,
    changes,
    { contextContainerId, legacyResolution = false } = {}
  ) {
    for (const change of changes) {
      const after = change.after || change.batch,
        before = loaded.batches.find((batch) => batch.id === after?.id)
      assertSingleOrderCarton(after)
      if (
        before &&
        !after.deletedAt &&
        !legacyResolution &&
        (before.accountId !== after.accountId ||
          batchOrderIds(before).length !== 1 ||
          batchOrderIds(before)[0] !== batchOrderIds(after)[0])
      )
        fail(
          'CARTON_OWNERSHIP',
          'A stable physical carton cannot be transferred to another purchase through an ordinary edit.',
          { batchId: after.id }
        )
      if (
        before &&
        !before.deletedAt &&
        after.deletedAt &&
        batchNeedsLegacyReview(before) &&
        !legacyResolution
      )
        fail(
          'LEGACY_REVIEW_REQUIRED',
          'Review historical loading or physical repack before retiring these uncertain cartons.',
          { batchId: after.id }
        )
      if (
        !legacyResolution &&
        stableValue(before?.legacyResolution) !==
          stableValue(after.legacyResolution)
      )
        fail(
          'LEGACY_REVIEW_REQUIRED',
          'Use the explicit legacy review to change historical loading evidence.',
          { batchId: after.id }
        )
      if (
        before &&
        stableValue({ ...before, revision: 0, updatedAt: '' }) ===
          stableValue({ ...after, revision: 0, updatedAt: '' })
      )
        continue
      const dependencies = loaded.containers.filter((container) =>
        (container.revisions || []).some((revision) =>
          [
            ...(revision.cartons || []),
            ...(revision.leftBehind?.cartons || []),
          ].some((unit) => unit.batchId === after.id)
        )
      )
      if (dependencies.length && !contextContainerId)
        fail(
          'AMENDMENT_REQUIRED',
          'These historical carton facts need a reviewed container amendment.',
          {
            batchId: after.id,
            containerIds: dependencies.map((container) => container.id),
          }
        )
      if (contextContainerId) {
        const container = containerFor(loaded, contextContainerId)
        if (!container.amendment || !container.draft)
          fail(
            'AMENDMENT_REQUIRED',
            'Open the associated container amendment first.'
          )
        for (const other of dependencies.filter(
          (value) => value.id !== contextContainerId
        )) {
          const units =
            (other.revisions || [])
              .find(
                (revision) => revision.revisionId === other.effectiveRevisionId
              )
              ?.cartons.filter((unit) => unit.batchId === after.id) || []
          const current =
              before && !before.deletedAt ? physicalUnits(before) : [],
            next = !after.deletedAt ? physicalUnits(after) : []
          const meaning = (unit) =>
            unit
              ? stableValue({
                  id: unit.id,
                  reference: unit.reference,
                  labelOrigin: unit.labelOrigin,
                  quantity: unit.quantity,
                  contents: unit.contents,
                  weight: unit.weight,
                  volume: unit.volume,
                  len: unit.len,
                  wid: unit.wid,
                  ht: unit.ht,
                  mark: unit.mark,
                })
              : null
          if (
            (units.some((unit) => unit.contents === null) &&
              [
                'contents',
                'unresolvedContents',
                'contentsUnknown',
                'packingBasis',
                'count',
              ].some(
                (field) =>
                  stableValue(before?.[field]) !== stableValue(after[field])
              )) ||
            (units.length &&
              ['weight', 'weightBasis', 'suppliedCbm', 'volumeBasis'].some(
                (field) =>
                  stableValue(before?.[field]) !== stableValue(after[field])
              ) &&
              (before?.weightBasis === 'batch' ||
                before?.volumeBasis === 'batch')) ||
            units.some(
              (unit) =>
                meaning(current.find((value) => value.id === unit.id)) !==
                meaning(next.find((value) => value.id === unit.id))
            )
          )
            fail(
              'OTHER_SHIPMENT_DEPENDENCY',
              'This change affects another effective shipment; it cannot be rewritten by this amendment.',
              { batchId: after.id, containerId: other.id }
            )
        }
      }
    }
  }
  function normalizedChanges(
    loaded,
    reference,
    changes,
    { contextContainerId } = {}
  ) {
    const scope = orderScopeState(loaded, reference),
      seen = new Set()
    if (!Array.isArray(changes))
      fail('INVALID_CARTON_CHANGES', 'Choose complete carton changes.')
    return changes.map((change) => {
      const raw = change.after || change.batch,
        before = loaded.batches.find((batch) => batch.id === raw?.id)
      if (!raw || seen.has(raw.id))
        fail('INVALID_CARTON_CHANGES', 'Edit each physical batch once.')
      seen.add(raw.id)
      if (
        (change.expectedRevision ?? raw.revision ?? 0) !==
        (before?.revision ?? 0)
      )
        fail('CARTON_BATCH_CONFLICT', 'These cartons changed in another tab.', {
          batchId: raw.id,
        })
      if (before?.deletedAt && !raw.deletedAt && !change.restore)
        fail(
          'CARTON_TOMBSTONE',
          'A stale edit cannot restore removed cartons.',
          { batchId: raw.id }
        )
      if (
        before &&
        (before.accountId !== (reference.accountId || 'local') ||
          batchOrderIds(before).length !== 1 ||
          batchOrderIds(before)[0] !== reference.orderId)
      )
        fail(
          'CARTON_OWNERSHIP',
          'This physical identity already belongs to another purchase.',
          { batchId: raw.id }
        )
      const batch = validateCartonBatch({
        ...raw,
        ...(raw.unresolvedContents
          ? {
              unresolvedContents: raw.unresolvedContents.map(
                ({ supplierCode, ...claim }) => ({
                  ...claim,
                  ...(supplierCode == null ? {} : { supplierCode }),
                })
              ),
            }
          : {}),
        accountId: reference.accountId || 'local',
        orderId: reference.orderId,
        storeId:
          repeatProductStoreIdentity(scope.record) ||
          `order:${reference.accountId || 'local'}/${reference.orderId}`,
        revision: (before?.revision || 0) + 1,
        updatedAt: nextEditTimestamp(before?.updatedAt),
      })
      if (
        (raw.accountId && raw.accountId !== batch.accountId) ||
        (raw.orderId && raw.orderId !== batch.orderId)
      )
        fail('CARTON_OWNERSHIP', 'A carton belongs to exactly one purchase.')
      assertSingleOrderCarton(batch)
      const ids = new Set(
        scope.record.snapshot.items.map((item) => item.entryId)
      )
      if (
        batch.contents.some((item) => !ids.has(item.entryId)) ||
        batch.unresolvedContents?.some((claim) =>
          claim.entryIds.some((id) => !ids.has(id))
        ) ||
        Object.values(batch.unitContents || {}).some((rows) =>
          rows.some((row) => !ids.has(row.entryId))
        )
      )
        fail(
          'CARTON_SOURCE_MISSING',
          'Carton contents belong to another source purchase.'
        )
      return { after: batch, expectedRevision: before?.revision || 0 }
    })
  }
  function validateChanges(loaded, reference, changes, options) {
    guardChanges(loaded, changes, options)
    const batches = [
      ...loaded.batches.filter(
        (batch) => !changes.some((change) => change.after.id === batch.id)
      ),
      ...changes.map((change) => change.after),
    ]
    assertOrderCartonConservation(
      orderScopeState(loaded, reference).record,
      batches,
      { records: loaded.records, allowLegacy: true }
    )
    return batches
  }
  async function context(tx, reference, { contextContainerId } = {}) {
    const base = await state(tx),
      container = contextContainerId
        ? containerFor(base, contextContainerId)
        : null,
      loaded = contextContainerId
        ? overlay(base, containerFor(base, contextContainerId))
        : base,
      { record, preparation, batches } = orderScopeState(loaded, reference)
    if (container && (!container.amendment || !container.draft))
      fail('AMENDMENT_CONTEXT_CONFLICT', 'This amendment is no longer active.')
    const amendmentContext = container ? amendmentToken(container) : undefined
    const contextualPreparation =
      amendmentContext && preparation
        ? { ...preparation, amendmentContext }
        : preparation
    const reports = loaded.reports.filter(
        (report) => orderKey(report.orderKey || report) === orderKey(reference)
      ),
      recovery = await draftRecovery(tx, 'cartons', reference, container)
    const projection = {
      eligibility: Object.fromEntries(
        eligibleOrderItems(record, loaded.records).map((item) => [
          item.entryId,
          {
            purchased: item.purchased,
            eligible: item.eligible,
            reason: item.reason,
          },
        ])
      ),
      eligibleQuantities: eligibleOrderItems(record, loaded.records).map(
        (item) => ({
          entryId: item.entryId,
          purchased: item.purchased,
          eligible: item.eligible,
          reason: item.reason,
        })
      ),
      ...projectBacklog(loaded, {
        accountId: reference.accountId || 'local',
        includeFullyShipped: true,
      }).orders.find((order) => order.orderId === reference.orderId),
    }
    return {
      record,
      preparation: contextualPreparation,
      batches,
      reports,
      ...recovery,
      projection,
      revisions: {
        ...reconciliationRevisions(loaded, reference),
        ...(amendmentContext ? { amendmentContext } : {}),
      },
      ...(amendmentContext ? { amendmentContext } : {}),
    }
  }
  async function saveFacts(tx, loaded, input) {
    if (input.contextContainerId)
      amendmentFor(loaded, input, { physical: true })
    const reference = ref(input),
      base = input.contextContainerId
        ? overlay(loaded, containerFor(loaded, input.contextContainerId))
        : loaded
    assertReconciliationRevisions(base, reference, input.expectedRevisions)
    const changes = normalizedChanges(base, reference, input.changes, {
      contextContainerId: input.contextContainerId,
    })
    validateChanges(base, reference, changes, {
      contextContainerId: input.contextContainerId,
    })
    if (input.contextContainerId) {
      const container = containerFor(loaded, input.contextContainerId)
      requireDraft(container)
      if (!container.amendment)
        fail(
          'AMENDMENT_REQUIRED',
          'Open an amendment before staging historical facts.'
        )
      const prior = container.draft.cartonChanges || [],
        actual = new Map(loaded.batches.map((batch) => [batch.id, batch]))
      container.draft.cartonChanges = [
        ...prior.filter(
          (value) =>
            !changes.some((change) => change.after.id === value.after.id)
        ),
        ...changes.map((change) => ({
          ...change,
          expectedRevision: actual.get(change.after.id)?.revision || 0,
          after: {
            ...change.after,
            revision: (actual.get(change.after.id)?.revision || 0) + 1,
          },
        })),
      ]
      for (const member of container.draft.orders.filter(
        (member) => orderKey(member) === orderKey(reference)
      ))
        refreshedMember(loaded, container, member)
      bump(container)
      tx.objectStore('containers').put(container)
    } else
      for (const change of changes)
        tx.objectStore('cartonBatches').put(change.after)
    return context(tx, reference, {
      contextContainerId: input.contextContainerId,
    })
  }
  async function saveOrderMetadata(tx, loaded, input, field, change) {
    const reference = ref(input),
      container = amendmentFor(loaded, input)
    const effective = container ? overlay(loaded, container) : loaded,
      { record: current, preparation } = orderScopeState(effective, reference),
      before = clone(current),
      record = await change(clone(current), effective)
    if (stableValue(before.snapshot) !== stableValue(record.snapshot))
      fail(
        'SOURCE_IMMUTABLE',
        'Authored evidence cannot rewrite the original purchase snapshot.'
      )
    record.inventoryMetadataHistory = [
      ...(record.inventoryMetadataHistory || []),
      {
        field,
        before: clone(before[field] ?? null),
        after: clone(record[field] ?? null),
        updatedAt: new Date().toISOString(),
      },
    ]
    const next = {
      ...effective,
      records: [
        ...effective.records.filter(
          (value) => orderKey(value) !== orderKey(reference)
        ),
        record,
      ],
    }
    graph(next)
    if (container) {
      const original = orderScopeState(loaded, reference)
      container.draft.orderChanges = [
        ...(container.draft.orderChanges || []).filter(
          (value) => orderKey(value.after) !== orderKey(reference)
        ),
        {
          after: record,
          expectedSource: sourceRevision(original.record, original.preparation),
        },
      ]
      for (const member of container.draft.orders.filter(
        (member) => orderKey(member) === orderKey(reference)
      ))
        refreshedMember(loaded, container, member)
      bump(container)
      tx.objectStore('containers').put(container)
    } else tx.objectStore('orders').put(record)
    return {
      record,
      revisions: reconciliationRevisions(next, reference),
      ...(container
        ? {
            contextContainerId: container.id,
            containerRevision: container.revision,
          }
        : {}),
    }
  }
  function sealToken(loaded, container) {
    return stableValue({
      container,
      preferences: loaded.preferences,
      source: container.draft.orders.map((member) =>
        reconciliationRevisions(overlay(loaded, container), member)
      ),
      graph: loaded.containers.map((value) => ({
        id: value.id,
        revision: value.revision,
        effectiveRevisionId: value.effectiveRevisionId,
        draftOrders: value.draft?.orders.map((member) => ({
          accountId: member.accountId,
          orderId: member.orderId,
          reserveRemainder: member.reserveRemainder,
        })),
      })),
    })
  }
  async function freezeMedia(tx, manifest, media) {
    const images = await requested(tx.objectStore('images').getAll()),
      refs = collectImageReferences({
        orders: manifest.orders.map((order) => order.record),
      })
    const originals = images.filter((image) =>
        refs.has(imageCacheKey(image.url))
      ),
      byRef = new Map(
        originals.map((image) => [imageCacheKey(image.url), image.dataUrl])
      )
    const frozen = clone(manifest)
    const freezeRow = (row) => {
      const value = { ...row }
      if (typeof row.thumbnail === 'string')
        value.thumbnail =
          byRef.get(imageCacheKey(row.thumbnail)) || row.thumbnail
      if (Array.isArray(row.photos))
        value.photos = row.photos.map(
          (url) => byRef.get(imageCacheKey(url)) || url
        )
      return value
    }
    frozen.products = frozen.products.map(freezeRow)
    frozen.leftBehind.products = frozen.leftBehind.products.map(freezeRow)
    for (const order of frozen.orders)
      order.products = order.products.map(freezeRow)
    frozen.media = {
      ...clone(media || {}),
      imageRefs: [...refs],
      images: clone(originals),
    }
    return frozen
  }
  async function seal(tx, loaded, input, amendment) {
    const container = containerFor(loaded, input.id, input.expectedRevision)
    requireDraft(container)
    if (!!container.amendment !== amendment)
      fail('AMENDMENT_STATE', 'Use the matching seal or amendment action.')
    if (sealToken(loaded, container) !== input.reviewToken)
      fail(
        'SEAL_REVIEW_STALE',
        'The shipment graph changed; review again before sealing.'
      )
    const effective = overlay(loaded, container)
    for (const member of container.draft.orders) {
      const scope = orderScopeState(effective, member)
      assertOrderCartonConservation(scope.record, effective.batches, {
        records: effective.records,
        allowLegacy: true,
      })
    }
    const projected = projectContainer(effective, container)
    if (!projected.readiness.ready)
      fail(
        'SEAL_NOT_READY',
        'Resolve the loaded-scope issues before sealing.',
        { issues: projected.issues }
      )
    if (amendment && !(input.reason || container.amendment.reason)?.trim())
      fail('AMENDMENT_REASON', 'Explain this correction.')
    const revision = (container.revisions.at(-1)?.revision || 0) + 1,
      revisionId = `${container.id}/r${revision}`
    const manifest = await freezeMedia(
      tx,
      {
        ...projected,
        revisionId,
        revision,
        draft: false,
        status: 'sealed',
        sealedAt: new Date().toISOString(),
        container: {
          id: container.id,
          accountId: container.accountId,
          name: container.name,
          period: container.period,
          loadingDate: container.loadingDate,
        },
        cartons: projected.cartons.filter((unit) => unit.state === 'loaded'),
        ...(amendment
          ? { amendmentReason: input.reason || container.amendment.reason }
          : {}),
        issues: [],
        readiness: { ready: true, issues: [], warnings: projected.warnings },
      },
      input.media
    )
    const next = {
      ...container,
      status: 'sealed',
      effectiveRevisionId: revisionId,
      revisions: [...container.revisions, manifest],
      draft: null,
    }
    delete next.amendment
    bump(next)
    const graphState = {
      ...effective,
      containers: [
        ...effective.containers.filter((value) => value.id !== next.id),
        next,
      ],
    }
    graph(graphState)
    for (const change of container.draft.orderChanges || []) {
      const current = orderScopeState(loaded, change.after)
      if (
        sourceRevision(current.record, current.preparation) !==
        change.expectedSource
      )
        fail('SOURCE_CONFLICT', 'Staged amendment source evidence changed.')
      tx.objectStore('orders').put(change.after)
    }
    for (const change of container.draft.preparationChanges || []) {
      const current = loaded.preparations.find(
        (prep) => orderKey(prep) === orderKey(change.after)
      )
      if ((current?.revision || 0) !== change.expectedRevision)
        fail(
          'PACKING_REVISION_CONFLICT',
          'Staged amendment preparation changed.'
        )
      tx.objectStore('preparations').put(change.after)
    }
    for (const change of container.draft.cartonChanges || []) {
      const before = loaded.batches.find(
        (batch) => batch.id === change.after.id
      )
      if ((before?.revision || 0) !== change.expectedRevision)
        fail('CARTON_BATCH_CONFLICT', 'Amendment carton facts changed.', {
          batchId: change.after.id,
        })
      tx.objectStore('cartonBatches').put(change.after)
    }
    for (const report of container.draft.reportChanges || [])
      tx.objectStore('packingReports').put(report)
    const locks = codeHooks.consumptionLocksForManifest
      ? codeHooks.consumptionLocksForManifest(manifest, graphState)
      : loaded.locks
    if (
      container.draft.preparationChanges?.length &&
      codeHooks.commitPreparedState
    )
      await codeHooks.commitPreparedState(tx, { ...graphState, locks }, loaded)
    for (const lock of locks) tx.objectStore('shipmentLocks').put(lock)
    tx.objectStore('containers').put(next)
    return clone(manifest)
  }
  const api = {
    getOperationalState({ accountId = 'local' } = {}) {
      return read(OPERATIONAL_STORES, async (tx) => {
        const loaded = await state(tx)
        return {
          ...loaded,
          records: loaded.records.filter(
            (record) => (record.snapshot.accountId || 'local') === accountId
          ),
          preparations: loaded.preparations.filter(
            (prep) => prep.accountId === accountId
          ),
          batches: loaded.batches.filter(
            (batch) => batch.accountId === accountId
          ),
          containers: loaded.containers.filter(
            (value) => value.accountId === accountId
          ),
          reports: loaded.reports.filter(
            (report) => report.orderKey.accountId === accountId
          ),
          locks: loaded.locks.filter((lock) => lock.accountId === accountId),
        }
      })
    },
    getBacklog({ accountId = 'local' } = {}) {
      return read(OPERATIONAL_STORES, async (tx) =>
        projectBacklog(await state(tx), { accountId })
      )
    },
    getOrderReconciliation(input) {
      return read(OPERATIONAL_STORES, (tx) => context(tx, ref(input), input))
    },
    saveOrderCartonDraft(input) {
      return mutate('saveOrderCartonDraft', input, async (tx, loaded) => {
        const container = amendmentFor(loaded, input),
          id = draftId('cartons', ref(input), container),
          old = await requested(tx.objectStore('orderCartonDrafts').get(id))
        if ((old?.revision || 0) !== input.expectedRevision)
          fail('DRAFT_CONFLICT', 'The recovery draft changed in another tab.')
        const value = {
          id,
          ...ref(input),
          revision: (old?.revision || 0) + 1,
          value: clone(input.draft),
          ...(container ? { amendmentContext: amendmentToken(container) } : {}),
          updatedAt: nextEditTimestamp(old?.updatedAt),
        }
        tx.objectStore('orderCartonDrafts').put(value)
        return value
      })
    },
    updateOrderCapacities(input) {
      return mutate('updateOrderCapacities', input, (tx, loaded) =>
        saveOrderMetadata(tx, loaded, input, 'unitsPerCarton', (record) => {
          if (record.snapshot.observedAt !== input.expectedObservedAt)
            fail('SOURCE_CONFLICT', 'The purchase source changed.')
          for (const [entryId, value] of Object.entries(input.values || {})) {
            if (
              !record.snapshot.items.some((item) => item.entryId === entryId) ||
              stableValue(record.unitsPerCarton?.[entryId] ?? null) !==
                stableValue(input.expectedValues?.[entryId] ?? null)
            )
              fail(
                'CAPACITY_CONFLICT',
                'These capacities changed in another tab.',
                { entryId }
              )
            if (
              value !== null &&
              (!/^\d+$/.test(String(value)) || BigInt(value) < 1n)
            )
              fail(
                'INVALID_CAPACITY',
                'Capacity must be a positive whole number or blank.'
              )
          }
          record.unitsPerCarton = { ...record.unitsPerCarton }
          for (const [id, value] of Object.entries(input.values || {})) {
            if (value === null) delete record.unitsPerCarton[id]
            else record.unitsPerCarton[id] = String(value)
          }
          record.unitsPerCartonUpdatedAt = nextEditTimestamp(
            record.unitsPerCartonUpdatedAt
          )
          return record
        })
      )
    },
    resolvePurchaseDate(input) {
      return mutate('resolvePurchaseDate', input, (tx, loaded) =>
        saveOrderMetadata(
          tx,
          loaded,
          input,
          'purchaseDateResolution',
          (record, effective) => {
            if (record.snapshot.observedAt !== input.expectedObservedAt)
              fail('SOURCE_CONFLICT', 'The purchase source changed.')
            if (record.snapshot.purchasedAt)
              fail(
                'PURCHASE_DATE_EXISTS',
                'Keep the established original purchase date.'
              )
            if (
              effective.locks.some(
                (lock) =>
                  lock.kind === 'code-consumption' &&
                  orderKey(lock) === orderKey(input)
              ) &&
              !input.contextContainerId
            )
              fail(
                'AMENDMENT_REQUIRED',
                'A consumed purchase date requires a versioned amendment.'
              )
            if (
              record.purchaseDateResolution &&
              record.purchaseDateResolution.date !== input.date &&
              stableValue(input.expectedValue) !==
                stableValue(record.purchaseDateResolution)
            )
              fail(
                'PURCHASE_DATE_CONFLICT',
                'The reviewed purchase date changed; reload it before editing.'
              )
            record.purchaseDateResolution = {
              date: resolvedPurchaseDate(input.date),
              provenance: 'manual-confirmed',
              updatedAt: nextEditTimestamp(
                record.purchaseDateResolutionUpdatedAt
              ),
            }
            record.purchaseDateResolutionUpdatedAt =
              record.purchaseDateResolution.updatedAt
            return record
          }
        )
      )
    },
    resolvePurchaseSupplier(input) {
      return mutate('resolvePurchaseSupplier', input, (tx, loaded) =>
        saveOrderMetadata(
          tx,
          loaded,
          input,
          'supplierIdentityResolution',
          (record, effective) => {
            if (record.snapshot.observedAt !== input.expectedObservedAt)
              fail('SOURCE_CONFLICT', 'The supplier source changed.')
            if (
              typeof input.sellerId !== 'string' ||
              !input.sellerId.trim() ||
              input.sellerId.length > 160 ||
              /[\u0000-\u001f]/.test(input.sellerId)
            )
              fail(
                'SUPPLIER_IDENTITY_INVALID',
                'Enter the reviewed supplier identity.'
              )
            if (
              effective.locks.some(
                (lock) =>
                  lock.kind === 'code-consumption' &&
                  orderKey(lock) === orderKey(input)
              ) &&
              !input.contextContainerId
            )
              fail(
                'AMENDMENT_REQUIRED',
                'A consumed supplier identity requires a versioned amendment.'
              )
            if (
              record.supplierIdentityResolution &&
              record.supplierIdentityResolution.sellerId !== input.sellerId &&
              stableValue(input.expectedValue) !==
                stableValue(record.supplierIdentityResolution)
            )
              fail(
                'SUPPLIER_IDENTITY_CONFLICT',
                'The reviewed supplier identity changed; reload it before editing.'
              )
            record.supplierIdentityResolution = {
              sellerId: input.sellerId.trim(),
              provenance: 'manual-confirmed',
              updatedAt: nextEditTimestamp(
                record.supplierIdentityResolutionUpdatedAt
              ),
              ...(input.reason ? { reason: input.reason } : {}),
            }
            record.supplierIdentityResolutionUpdatedAt =
              record.supplierIdentityResolution.updatedAt
            return record
          }
        )
      )
    },
    setInventoryDispositions(input) {
      return mutate('setInventoryDispositions', input, (tx, loaded) =>
        saveOrderMetadata(
          tx,
          loaded,
          input,
          'inventoryDispositions',
          (record, effective) => {
            const changes = Array.isArray(input.entries)
                ? Object.fromEntries(
                    input.entries.map(({ entryId, kind, ...value }) => [
                      entryId,
                      kind === null ? null : { kind, ...value },
                    ])
                  )
                : input.entries,
              next = { ...(record.inventoryDispositions || {}) }
            for (const [id, value] of Object.entries(changes || {})) {
              if (
                stableValue(record.inventoryDispositions?.[id] ?? null) !==
                stableValue(input.expectedValues?.[id] ?? null)
              )
                fail(
                  'DISPOSITION_CONFLICT',
                  'An inventory disposition changed in another tab.',
                  { entryId: id }
                )
              if (value === null) delete next[id]
              else next[id] = value
            }
            record.inventoryDispositions = validateInventoryDispositions(
              next,
              record
            )
            record.inventoryDispositionsUpdatedAt = nextEditTimestamp(
              record.inventoryDispositionsUpdatedAt
            )
            record.inventoryDispositionClears = [
              ...new Set([
                ...(record.inventoryDispositionClears || []),
                ...Object.keys(changes || {}),
              ]),
            ]
            return record
          }
        )
      )
    },
    saveOrderCartonFacts(input) {
      return mutate('saveOrderCartonFacts', input, (tx, loaded) =>
        saveFacts(tx, loaded, input)
      )
    },
    confirmOrderCartons(input) {
      return mutate('confirmOrderCartons', input, async (tx, loaded) => {
        input = {
          ...input,
          contextContainerId:
            input.contextContainerId || input.draft?.contextContainerId,
        }
        if (input.contextContainerId)
          amendmentFor(loaded, input, { physical: true })
        const base = input.contextContainerId
            ? overlay(loaded, containerFor(loaded, input.contextContainerId))
            : loaded,
          scope = orderScopeState(base, ref(input))
        assertReconciliationRevisions(base, ref(input), input.expectedRevisions)
        const plan = reconcileOrder({
          ...scope,
          reports: base.reports.filter(
            (report) => orderKey(report.orderKey) === orderKey(input)
          ),
          draft: input.draft,
          projection: {
            eligibility: Object.fromEntries(
              eligibleOrderItems(scope.record, loaded.records).map((item) => [
                item.entryId,
                {
                  purchased: item.purchased,
                  eligible: item.eligible,
                  reason: item.reason,
                },
              ])
            ),
            eligibleQuantities: eligibleOrderItems(
              scope.record,
              loaded.records
            ).map((item) => ({
              entryId: item.entryId,
              purchased: item.purchased,
              eligible: item.eligible,
              reason: item.reason,
            })),
          },
        })
        if (plan.issues.some((issue) => issue.severity === 'error'))
          fail(
            'RECONCILIATION_INVALID',
            'Resolve the order reconciliation issues before confirming.',
            { issues: plan.issues }
          )
        const changes = []
        for (const proposal of plan.cartons.filter((value) =>
          ['modified', 'proposed', 'removal-proposed'].includes(value.state)
        )) {
          const before = scope.batches.find(
              (batch) => batch.id === proposal.id
            ),
            source = proposal
          changes.push({
            after: {
              ...source,
              id: before?.id || crypto.randomUUID(),
              accountId: input.accountId || 'local',
              orderId: input.orderId,
              storeId:
                repeatProductStoreIdentity(scope.record) ||
                `order:${input.accountId || 'local'}/${input.orderId}`,
              len: source.len || '',
              wid: source.wid || '',
              ht: source.ht || '',
              weight: source.weight || source.weightPerCarton || '',
              weightBasis: source.weightBasis || 'carton',
              suppliedCbm: source.suppliedCbm || '',
              groups: source.groups || [],
              ...(proposal.removalRequested
                ? { deletedAt: new Date().toISOString() }
                : {}),
              provenance: {
                kind: 'manual-confirmed',
                reason: 'Confirmed order reconciliation',
              },
            },
            expectedRevision: before?.revision || 0,
          })
        }
        const result = await saveFacts(tx, loaded, {
          ...input,
          contextContainerId: input.contextContainerId,
          changes,
        })
        const id = draftId(
            'cartons',
            input,
            input.contextContainerId
              ? containerFor(loaded, input.contextContainerId)
              : null
          ),
          old = await requested(tx.objectStore('orderCartonDrafts').get(id))
        if (old)
          tx.objectStore('orderCartonDrafts').put({
            ...old,
            revision: old.revision + 1,
            value: {},
            updatedAt: nextEditTimestamp(old.updatedAt),
          })
        return context(tx, ref(input), {
          contextContainerId: input.contextContainerId,
        })
      })
    },
    listContainers({ accountId = 'local' } = {}) {
      return read(['containers'], async (tx) =>
        (await requested(tx.objectStore('containers').getAll())).filter(
          (value) => value.accountId === accountId
        )
      )
    },
    createContainer(input) {
      return mutate('createContainer', input, async (tx) => {
        if (
          typeof input.name !== 'string' ||
          !input.name.trim() ||
          input.name.length > 160
        )
          fail('INVALID_CONTAINER_NAME', 'Give this container a name.')
        const container = {
          id: crypto.randomUUID(),
          accountId: input.accountId || 'local',
          name: input.name.trim(),
          period: input.period || '',
          loadingDate: input.loadingDate || '',
          status: 'draft',
          revision: 1,
          revisions: [],
          draft: { orders: [], decisions: {} },
          updatedAt: new Date().toISOString(),
        }
        tx.objectStore('containers').add(container)
        return container
      })
    },
    getContainerView({ id, revisionId }) {
      return read(OPERATIONAL_STORES, async (tx) => {
        const loaded = await state(tx)
        return view(loaded, containerFor(loaded, id), revisionId)
      })
    },
    getContainerManifest({ id, revisionId }) {
      return read(OPERATIONAL_STORES, async (tx) => {
        const loaded = await state(tx),
          container = containerFor(loaded, id)
        const result = projectContainer(overlay(loaded, container), container, {
          revisionId:
            revisionId ||
            (!container.draft ? container.effectiveRevisionId : undefined),
        })
        return {
          ...result,
          cartons: result.cartons.filter((unit) => unit.state === 'loaded'),
        }
      })
    },
    includeContainerOrders(input) {
      return mutate('includeContainerOrders', input, async (tx, loaded) => {
        const container = containerFor(loaded, input.id, input.expectedRevision)
        requireDraft(container)
        for (const reference of input.orderRefs || []) {
          if ((reference.accountId || 'local') !== container.accountId)
            fail(
              'CONTAINER_ACCOUNT',
              'Included purchases must belong to the container account.'
            )
          if (
            container.draft.orders.some(
              (member) => orderKey(member) === orderKey(reference)
            )
          )
            continue
          container.draft.orders.push(
            captureContainerOrder(loaded, reference, container.id)
          )
        }
        bump(container)
        tx.objectStore('containers').put(container)
        return view(loaded, container)
      })
    },
    removeContainerOrder(input) {
      return mutate('removeContainerOrder', input, async (tx, loaded) => {
        const container = containerFor(loaded, input.id, input.expectedRevision)
        requireDraft(container)
        const removed = container.draft.orders.filter(
          (member) => orderKey(member) === orderKey(input.orderRef)
        )
        container.draft.orders = container.draft.orders.filter(
          (member) => !removed.includes(member)
        )
        for (const unit of removed.flatMap((member) => member.cartons))
          delete container.draft.decisions[unit.id]
        bump(container)
        tx.objectStore('containers').put(container)
        return view(loaded, container)
      })
    },
    cancelContainer(input) {
      return mutate('cancelContainer', input, async (tx, loaded) => {
        const container = containerFor(loaded, input.id, input.expectedRevision)
        if (container.effectiveRevisionId)
          fail(
            'SEALED_CONTAINER',
            'Cancel the amendment rather than the effective shipment.'
          )
        requireDraft(container)
        container.status = 'canceled'
        container.draft = null
        bump(container)
        tx.objectStore('containers').put(container)
        return container
      })
    },
    setContainerLoading(input) {
      return mutate('setContainerLoading', input, async (tx, loaded) => {
        const container = containerFor(loaded, input.id, input.expectedRevision)
        requireDraft(container)
        const units = new Set(
            container.draft.orders.flatMap((member) =>
              member.cartons.map((unit) => unit.id)
            )
          ),
          seen = new Set()
        for (const decision of input.decisions || []) {
          if (
            !units.has(decision.cartonId) ||
            seen.has(decision.cartonId) ||
            !['loaded', 'left-behind', 'unconfirmed'].includes(decision.state)
          )
            fail(
              'INVALID_LOADING',
              'Choose each included physical carton once.'
            )
          seen.add(decision.cartonId)
          container.draft.decisions[decision.cartonId] = decision.state
        }
        bump(container)
        tx.objectStore('containers').put(container)
        return view(loaded, container)
      })
    },
    markContainerLoaded(input) {
      return mutate('markContainerLoaded', input, async (tx, loaded) => {
        const container = containerFor(loaded, input.id, input.expectedRevision)
        requireDraft(container)
        const selected = input.orderRefs || container.draft.orders
        for (const reference of selected) {
          const member = container.draft.orders.find(
            (member) => orderKey(member) === orderKey(reference)
          )
          if (!member)
            fail('ORDER_NOT_INCLUDED', 'This purchase is not included.')
          for (const unit of member.cartons)
            container.draft.decisions[unit.id] = 'loaded'
        }
        bump(container)
        tx.objectStore('containers').put(container)
        return view(loaded, container)
      })
    },
    setInterchangeableLoading(input) {
      return mutate('setInterchangeableLoading', input, async (tx, loaded) => {
        const container = containerFor(loaded, input.id, input.expectedRevision)
        requireDraft(container)
        const units = view(loaded, container).cartons.filter(
          (unit) => unit.batchId === input.batchId
        )
        if (
          !units.length ||
          units.some((unit) => !unit.interchangeable) ||
          !Number.isSafeInteger(input.leftBehind) ||
          input.leftBehind < 0 ||
          input.leftBehind > units.length
        )
          fail(
            'NOT_INTERCHANGEABLE',
            'Choose actual physical references when contents or measurements differ.'
          )
        units.forEach((unit, index) => {
          container.draft.decisions[unit.id] =
            index < units.length - input.leftBehind ? 'loaded' : 'left-behind'
        })
        bump(container)
        tx.objectStore('containers').put(container)
        return view(loaded, container)
      })
    },
    reviewContainerAvailability(input) {
      return read(OPERATIONAL_STORES, async (tx) => {
        const loaded = await state(tx),
          container = containerFor(loaded, input.id, input.expectedRevision)
        requireDraft(container)
        const next = container.draft.orders.map((member) =>
          captureContainerOrder(
            overlay(loaded, container),
            member,
            container.id,
            { reserveRemainder: member.reserveRemainder }
          )
        )
        return {
          reviewToken: stableValue({
            containerId: container.id,
            revision: container.revision,
            orders: next,
          }),
          before: clone(container.draft.orders),
          after: next,
        }
      })
    },
    applyContainerAvailability(input) {
      return mutate('applyContainerAvailability', input, async (tx, loaded) => {
        const container = containerFor(loaded, input.id, input.expectedRevision)
        requireDraft(container)
        const next = container.draft.orders.map((member) =>
          captureContainerOrder(
            overlay(loaded, container),
            member,
            container.id,
            { reserveRemainder: member.reserveRemainder }
          )
        )
        if (
          input.plan?.reviewToken !==
          stableValue({
            containerId: container.id,
            revision: container.revision,
            orders: next,
          })
        )
          fail(
            'AVAILABILITY_REVIEW_STALE',
            'Availability changed; review its complete before/after scope again.'
          )
        container.draft.orders = next
        const ids = new Set(
          next.flatMap((member) => member.cartons.map((unit) => unit.id))
        )
        container.draft.decisions = Object.fromEntries(
          Object.entries(container.draft.decisions).filter(([id]) =>
            ids.has(id)
          )
        )
        bump(container)
        tx.objectStore('containers').put(container)
        return view(loaded, container)
      })
    },
    reviewContainerSeal(input) {
      return read(OPERATIONAL_STORES, async (tx) => {
        const loaded = await state(tx),
          container = containerFor(loaded, input.id, input.expectedRevision)
        requireDraft(container)
        const projection = view(loaded, container)
        return {
          ready: projection.readiness.ready,
          issues: projection.issues,
          warnings: projection.warnings,
          reviewToken: sealToken(loaded, container),
          projection,
        }
      })
    },
    sealContainer(input) {
      return mutate('sealContainer', input, (tx, loaded) =>
        seal(tx, loaded, input, false)
      )
    },
    beginContainerAmendment(input) {
      return mutate('beginContainerAmendment', input, async (tx, loaded) => {
        const container = containerFor(loaded, input.id, input.expectedRevision)
        if (container.status !== 'sealed' || !input.reason?.trim())
          fail(
            'AMENDMENT_REASON',
            'Choose a sealed container and explain its correction.'
          )
        const manifest = container.revisions.find(
          (revision) => revision.revisionId === container.effectiveRevisionId
        )
        container.status = 'amending'
        container.amendment = {
          epoch: crypto.randomUUID(),
          reason: input.reason.trim(),
          baseRevisionId: manifest.revisionId,
        }
        container.draft = {
          orders: [],
          decisions: {},
          cartonChanges: [],
          reportChanges: [],
        }
        for (const order of manifest.orders) {
          const member = captureContainerOrder(loaded, order, container.id, {
            reserveRemainder: false,
          })
          container.draft.orders.push(member)
          for (const unit of member.cartons)
            container.draft.decisions[unit.id] = manifest.cartons.some(
              (loaded) => loaded.id === unit.id
            )
              ? 'loaded'
              : manifest.leftBehind.cartons.some((left) => left.id === unit.id)
                ? 'left-behind'
                : 'unconfirmed'
        }
        bump(container)
        tx.objectStore('containers').put(container)
        return view(loaded, container)
      })
    },
    cancelContainerAmendment(input) {
      return mutate('cancelContainerAmendment', input, async (tx, loaded) => {
        const container = containerFor(loaded, input.id, input.expectedRevision)
        if (!container.amendment)
          fail('AMENDMENT_STATE', 'No amendment is open.')
        container.status = 'sealed'
        container.draft = null
        delete container.amendment
        bump(container)
        tx.objectStore('containers').put(container)
        return view(loaded, container)
      })
    },
    applyContainerAmendment(input) {
      return mutate('applyContainerAmendment', input, async (tx, loaded) => {
        if (input.cartonChanges?.length)
          fail(
            'AMENDMENT_STAGE_FIRST',
            'Stage and review carton changes before applying the amendment.'
          )
        return seal(tx, loaded, input, true)
      })
    },
    reviewLegacyCarton(input) {
      return read(OPERATIONAL_STORES, async (tx) => {
        const loaded = await state(tx),
          batch = loaded.batches.find((batch) => batch.id === input.batchId)
        if (!batch || batch.revision !== input.expectedRevision)
          fail('CARTON_BATCH_CONFLICT', 'This legacy evidence changed.')
        const orderContexts = []
        for (const orderId of batchOrderIds(batch))
          orderContexts.push({
            accountId: batch.accountId,
            orderId,
            ...(await context(tx, { accountId: batch.accountId, orderId })),
          })
        return {
          batch,
          orderContexts,
          expectedOrderRevisions: Object.fromEntries(
            orderContexts.map((value) => [orderKey(value), value.revisions])
          ),
        }
      })
    },
    resolveLegacyCarton(input) {
      return mutate('resolveLegacyCarton', input, async (tx, loaded) => {
        const batch = loaded.batches.find((value) => value.id === input.batchId)
        if (
          !batch ||
          batch.revision !== input.expectedRevision ||
          (batch.deletedAt && !batchNeedsLegacyReview(batch))
        )
          fail('CARTON_BATCH_CONFLICT', 'This legacy evidence changed.')
        if (!input.reason?.trim() || input.attestNotShipped !== true)
          fail(
            'LEGACY_RESOLUTION_REASON',
            'Explain the reviewed facts and explicitly confirm these goods were not shipped.'
          )
        const affected = [
          ...new Set([
            ...batchOrderIds(batch),
            ...(input.ownerRef ? [input.ownerRef.orderId] : []),
          ]),
        ]
        for (const orderId of affected)
          assertReconciliationRevisions(
            loaded,
            { accountId: batch.accountId, orderId },
            input.expectedOrderRevisions?.[
              orderKey({ accountId: batch.accountId, orderId })
            ]
          )
        const original = clone(batch)
        delete original.cartonHistory
        const history = [...(batch.cartonHistory || []), original],
          updatedAt = nextEditTimestamp(batch.updatedAt)
        let next
        if (input.resolution === 'retired-after-repack') {
          if (input.attestRepacked !== true)
            fail(
              'LEGACY_REPACK_ATTESTATION',
              'Confirm the actual physical repack before retiring this evidence.'
            )
          next = {
            ...clone(batch),
            deletedAt: updatedAt,
            revision: batch.revision + 1,
            updatedAt,
            cartonHistory: history,
            legacyResolution: {
              kind: 'retired-after-repack',
              reason: input.reason.trim(),
              attestNotShipped: true,
              attestRepacked: true,
              reviewedAt: updatedAt,
            },
          }
        } else if (input.resolution === 'owner-corrected') {
          const owner = input.ownerRef
          if (
            !owner ||
            owner.accountId !== batch.accountId ||
            !affected.includes(owner.orderId) ||
            !Array.isArray(input.contents) ||
            input.contents.some((row) => row.orderId !== owner.orderId)
          )
            fail(
              'LEGACY_OWNER_REQUIRED',
              'Choose one actual purchase and its explicit supported contents.'
            )
          const own = orderScopeState(loaded, owner),
            groups = (batch.groups || []).filter(
              (group) => group.orderId === owner.orderId
            )
          next = validateCartonBatch({
            ...clone(batch),
            orderId: owner.orderId,
            storeId:
              repeatProductStoreIdentity(own.record) ||
              `order:${batch.accountId}/${owner.orderId}`,
            contents: input.contents,
            groups,
            mark: input.mark,
            packingBasis: batch.count === 1 ? 'exact' : 'aggregate',
            unresolvedContents: [],
            sourceFacts: batch.sourceFacts || original,
            cartonHistory: history,
            legacyResolution: {
              kind: 'owner-corrected',
              reason: input.reason.trim(),
              attestNotShipped: true,
              reviewedAt: updatedAt,
            },
            needsReview: false,
            revision: batch.revision + 1,
            updatedAt,
          })
        } else if (input.resolution === 'not-shipped') {
          if (batchOrderIds(batch).length !== 1)
            fail(
              'LEGACY_CROSS_ORDER',
              'Review an actual owner or physical repack before resolving cross-order facts.'
            )
          next = validateCartonBatch({
            ...batch,
            orderId: batchOrderIds(batch)[0],
            packingBasis:
              batch.packingBasis || (batch.count === 1 ? 'exact' : 'aggregate'),
            sourceFacts: batch.sourceFacts || original,
            cartonHistory: history,
            legacyResolution: {
              kind: 'not-shipped',
              reason: input.reason.trim(),
              attestNotShipped: true,
              reviewedAt: updatedAt,
            },
            needsReview: false,
            revision: batch.revision + 1,
            updatedAt,
          })
        } else
          fail(
            'LEGACY_RESOLUTION',
            'Choose an explicit supported legacy resolution.'
          )
        guardChanges(loaded, [{ after: next }], {
          contextContainerId: input.contextContainerId,
          legacyResolution: true,
        })
        const after = {
          ...loaded,
          batches: [
            ...loaded.batches.filter((value) => value.id !== batch.id),
            next,
          ],
        }
        for (const orderId of affected)
          assertOrderCartonConservation(
            orderScopeState(after, { accountId: batch.accountId, orderId })
              .record,
            after.batches,
            { records: after.records, allowLegacy: true }
          )
        if (input.contextContainerId) {
          const container = containerFor(loaded, input.contextContainerId)
          requireDraft(container)
          if (!container.amendment)
            fail('AMENDMENT_REQUIRED', 'Open the related amendment first.')
          container.draft.cartonChanges = [
            ...(container.draft.cartonChanges || []).filter(
              (change) => change.after.id !== next.id
            ),
            { after: next, expectedRevision: batch.revision },
          ]
          bump(container)
          tx.objectStore('containers').put(container)
        } else tx.objectStore('cartonBatches').put(next)
        return {
          batch: next,
          orderContexts: await Promise.all(
            affected.map(async (orderId) => ({
              accountId: batch.accountId,
              orderId,
              ...(await context(
                tx,
                { accountId: batch.accountId, orderId },
                input
              )),
            }))
          ),
        }
      })
    },
  }
  return {
    api,
    state,
    context,
    mutate,
    graph,
    overlay,
    guardChanges,
    normalizedChanges,
    validateChanges,
    saveFacts,
    saveOrderMetadata,
    amendmentFor,
    amendmentToken,
    draftId,
    draftRecovery,
    refreshedMember,
  }
}
