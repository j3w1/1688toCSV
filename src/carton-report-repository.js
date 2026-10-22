import { consumptionLocksForManifest } from './purchase-codes.js'
import { OPERATIONAL_STORES } from './container-repository.js'
import {
  orderKey,
  stableValue,
  inventoryError,
  eligibleOrderItems,
  batchOrderIds,
} from './inventory-model.js'
import {
  reconciliationRevisions,
  assertReconciliationRevisions,
  validateContainerRecord,
} from './container-model.js'
import {
  parsePackingReportCells,
  adaptPackingReportWorkbook,
} from './packing-report-cells.js'
import {
  analyzePackingReport,
  validatePackingReportReview,
} from './packing-report-model.js'
import { planPackingReportUpdate } from './packing-report-matches.js'
import { readStoreWorkbook } from './store-workbook-reader.js'
import { barcodeValue } from './packing-model.js'
const clone = (value) => structuredClone(value)
const fail = (code, message, detail) => {
  throw inventoryError(code, message, detail)
}
const bytesFor = (value) =>
  value instanceof Uint8Array
    ? value.slice()
    : value instanceof ArrayBuffer
      ? new Uint8Array(value.slice(0))
      : typeof value === 'string'
        ? Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
        : null
const encode = (bytes) => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}
async function digest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}
export function encodeReportAsset(asset) {
  return {
    ...clone(asset),
    ...(asset.bytes
      ? { bytes: encode(bytesFor(asset.bytes)), bytesEncoding: 'base64' }
      : {}),
  }
}
export async function validateReportAsset(asset) {
  if (
    !asset ||
    typeof asset.rawAssetRef !== 'string' ||
    !/^local-report:[a-f0-9]{64}$/.test(asset.rawAssetRef) ||
    typeof asset.rawDigest !== 'string' ||
    !['clipboard-tsv', 'xlsx', 'xls'].includes(asset.kind) ||
    !Array.isArray(asset.owners) ||
    !asset.owners.length
  )
    fail('INVALID_REPORT_ASSET', 'Invalid original report asset.')
  const bytes =
    asset.kind === 'clipboard-tsv'
      ? typeof asset.text === 'string'
        ? new TextEncoder().encode(asset.text)
        : null
      : bytesFor(asset.bytes)
  if (
    !bytes ||
    bytes.length > (asset.kind === 'clipboard-tsv' ? 5 : 100) * 1024 * 1024 ||
    (await digest(bytes)) !== asset.rawDigest ||
    asset.rawAssetRef !== `local-report:${asset.rawDigest}`
  )
    fail(
      'REPORT_ASSET_DIGEST',
      'The original report bytes/text do not match their retained digest.'
    )
  const result = {
    ...clone(asset),
    ...(asset.kind === 'clipboard-tsv' ? {} : { bytes }),
  }
  delete result.bytesEncoding
  return result
}
export function validateOperationalBackup(input) {
  const value = {
    containers: [],
    packingReports: [],
    reportSources: [],
    orderCartonDrafts: [],
    shipmentLocks: [],
    operationIntents: [],
  }
  if (input.version < 5) return value
  for (const field of Object.keys(value)) {
    if (!Array.isArray(input[field]))
      fail('INVALID_OPERATIONAL_BACKUP', `Backup ${field} must be an array.`)
    value[field] = clone(input[field])
    const key = field === 'reportSources' ? 'rawAssetRef' : 'id'
    if (
      new Set(value[field].map((record) => record[key])).size !==
      value[field].length
    )
      fail('INVALID_OPERATIONAL_BACKUP', `Duplicate ${field} identity.`)
  }
  value.containers = value.containers.map(validateContainerRecord)
  for (const report of value.packingReports)
    if (
      !report.orderKey ||
      !Number.isSafeInteger(report.revision) ||
      report.revision < 1 ||
      !Array.isArray(report.rows) ||
      !report.source?.rawAssetRef
    )
      fail('INVALID_OPERATIONAL_BACKUP', 'Invalid report revision evidence.')
  for (const draft of value.orderCartonDrafts)
    if (
      !draft.id ||
      !draft.orderId ||
      !Number.isSafeInteger(draft.revision) ||
      draft.revision < 1
    )
      fail('INVALID_OPERATIONAL_BACKUP', 'Invalid recovery draft.')
  for (const source of value.reportSources)
    if (
      !/^local-report:[a-f0-9]{64}$/.test(source.rawAssetRef) ||
      !source.rawDigest ||
      !Array.isArray(source.owners)
    )
      fail('INVALID_OPERATIONAL_BACKUP', 'Invalid original source asset.')
  for (const report of value.packingReports) {
    if (
      !value.reportSources.some(
        (source) =>
          source.rawAssetRef === report.source.rawAssetRef &&
          source.rawDigest === report.source.rawDigest
      )
    )
      fail(
        'REPORT_SOURCE_MISSING',
        'An accepted report is missing its original source asset.'
      )
  }
  return value
}
export function createCartonReportRepository({
  read,
  write,
  requested,
  nextEditTimestamp,
  containerRepository: domain,
}) {
  async function reportContext(tx, input) {
    const base = await domain.state(tx),
      loaded = input.contextContainerId
        ? domain.overlay(
            base,
            base.containers.find(
              (container) => container.id === input.contextContainerId
            )
          )
        : base
    const value = await domain.context(tx, input, input),
      record = value.record,
      preparation = value.preparation
    if (
      record.snapshot.source === 'other' ||
      record.snapshot.sourceType === 'spreadsheet'
    )
      fail(
        'REPORT_ORDER_SOURCE',
        'Carton report intake augments an existing 1688 purchase.'
      )
    const previousReports = loaded.reports.filter(
        (report) => orderKey(report.orderKey) === orderKey(input)
      ),
      eligible = eligibleOrderItems(record, loaded.records)
    const products = record.snapshot.items.map((item) => {
      const group = preparation?.groups.find((group) =>
          group.variants.some((variant) =>
            variant.entryIds.includes(item.entryId)
          )
        ),
        variant = group?.variants.find((variant) =>
          variant.entryIds.includes(item.entryId)
        )
      const ceCodes = [group?.baseCode].filter(Boolean)
      try {
        if (group && variant) ceCodes.push(barcodeValue(group, variant))
      } catch {}
      const supplierCodes = [item.productNumber].filter(Boolean)
      for (const report of previousReports)
        for (const [id, decision] of Object.entries(report.decisions || {}))
          if (
            id.startsWith('codeAlias:') &&
            decision.value?.entryIds?.includes(item.entryId) &&
            decision.scope?.code
          )
            supplierCodes.push(decision.scope.code)
      return {
        entryId: item.entryId,
        groupId:
          group?.id ||
          `source:${item.sourceGroup || item.productNumber || item.entryId}`,
        purchased:
          eligible.find((row) => row.entryId === item.entryId)?.eligible || '0',
        ceCodes: [...new Set(ceCodes)],
        supplierCodes: [...new Set(supplierCodes)],
        name: item.title || item.description,
        photoRefs: clone(item.photos || [item.thumbnail].filter(Boolean)),
      }
    })
    const sealedDependencies = loaded.containers.flatMap((container) =>
      (container.revisions || []).flatMap((revision) =>
        [...(revision.cartons || []), ...(revision.leftBehind?.cartons || [])]
          .filter(
            (unit) =>
              unit.orderId === input.orderId &&
              unit.accountId === (input.accountId || 'local')
          )
          .map((unit) => ({
            batchId: unit.batchId,
            containerId: container.id,
            revisionId: revision.revisionId,
          }))
      )
    )
    return {
      accountId: input.accountId || 'local',
      orderId: input.orderId,
      sourceType: '1688',
      storeId: value.batches[0]?.storeId || null,
      sourceRevision: Date.parse(record.snapshot.observedAt),
      preparationRevision: preparation?.revision || 0,
      expectedRevisions: value.revisions,
      products,
      batches: value.batches,
      previousReports,
      sealedDependencies: sealedDependencies.filter(
        (dependency) => dependency.containerId !== input.contextContainerId
      ),
      manualFacts: value.batches.flatMap((batch) => batch.manualFacts || []),
    }
  }
  async function parseAsset(asset, reference) {
    const metadata = {
      sourceId: `source:${orderKey(reference)}:${asset.rawDigest}`,
      rawAssetRef: asset.rawAssetRef,
      rawDigest: asset.rawDigest,
    }
    if (asset.kind === 'clipboard-tsv') {
      const parsed = parsePackingReportCells({ ...metadata, text: asset.text })
      if (!parsed.source)
        fail(
          'REPORT_SOURCE_INVALID',
          'Original copied cells failed complete validation.',
          { issues: parsed.issues }
        )
      return parsed.source
    }
    return adaptPackingReportWorkbook({
      ...metadata,
      workbook: await readStoreWorkbook(bytesFor(asset.bytes), {
        filename: asset.filename || `report.${asset.kind}`,
        reportEvidence: true,
      }),
    })
  }
  const api = {
    getPackingReportContext(input) {
      return read(OPERATIONAL_STORES, (tx) => reportContext(tx, input))
    },
    async savePackingReportSource(input) {
      let bytes,
        text,
        kind = input.kind
      if (kind === 'clipboard-tsv') {
        if (typeof input.text !== 'string')
          fail('REPORT_SOURCE_INVALID', 'Original report text is required.')
        text = input.text
        bytes = new TextEncoder().encode(text)
      } else {
        bytes = bytesFor(input.bytes)
        if (!bytes)
          fail('REPORT_SOURCE_INVALID', 'Original workbook bytes are required.')
        kind = bytes[0] === 0x50 ? 'xlsx' : bytes[0] === 0xd0 ? 'xls' : null
        if (!kind)
          fail(
            'REPORT_SOURCE_INVALID',
            'Choose a genuine local Excel workbook.'
          )
      }
      const rawDigest = await digest(bytes),
        rawAssetRef = `local-report:${rawDigest}`,
        owner = {
          accountId: input.accountId || 'local',
          orderId: input.orderId,
        }
      const asset = await validateReportAsset({
        sourceId: `source:${rawDigest}`,
        rawAssetRef,
        rawDigest,
        kind,
        owners: [owner],
        ...(kind === 'clipboard-tsv' ? { text } : { bytes }),
        ...(input.filename ? { filename: input.filename } : {}),
        storedAt: new Date().toISOString(),
      })
      return write(OPERATIONAL_STORES, async (tx) => {
        await reportContext(tx, owner)
        const old = await requested(
          tx.objectStore('packingReportSources').get(rawAssetRef)
        )
        if (old) {
          asset.owners = [
            ...old.owners,
            ...(old.owners.some(
              (reference) => orderKey(reference) === orderKey(owner)
            )
              ? []
              : [owner]),
          ]
        }
        tx.objectStore('packingReportSources').put(asset)
        return {
          sourceId: `source:${orderKey(owner)}:${asset.rawDigest}`,
          rawAssetRef,
          rawDigest,
          kind,
          filename: asset.filename,
        }
      })
    },
    getPackingReportSource({ rawAssetRef }) {
      return read(['packingReportSources'], async (tx) => {
        const asset = await requested(
          tx.objectStore('packingReportSources').get(rawAssetRef)
        )
        if (!asset)
          fail('REPORT_SOURCE_MISSING', 'The original report asset is missing.')
        return asset
      })
    },
    savePackingReportDraft(input) {
      return domain.mutate(
        'savePackingReportDraft',
        input,
        async (tx, loaded) => {
          const container = domain.amendmentFor(loaded, input),
            id = domain.draftId('report', input, container),
            old = await requested(tx.objectStore('orderCartonDrafts').get(id))
          if ((old?.revision || 0) !== input.expectedRevision)
            fail(
              'DRAFT_CONFLICT',
              'The report recovery draft changed in another tab.'
            )
          const draft = {
            id,
            accountId: input.accountId || 'local',
            orderId: input.orderId,
            revision: (old?.revision || 0) + 1,
            value: clone(input.draft),
            updatedAt: nextEditTimestamp(old?.updatedAt),
          }
          tx.objectStore('orderCartonDrafts').put(draft)
          return draft
        }
      )
    },
    getPackingReportDraft(input) {
      return read(OPERATIONAL_STORES, async (tx) => {
        const loaded = await domain.state(tx),
          container = input.contextContainerId
            ? loaded.containers.find(
                (value) => value.id === input.contextContainerId
              )
            : null
        if (input.contextContainerId && !container?.amendment)
          fail(
            'AMENDMENT_CONTEXT_CONFLICT',
            'This amendment is no longer active.'
          )
        return requested(
          tx
            .objectStore('orderCartonDrafts')
            .get(domain.draftId('report', input, container))
        )
      })
    },
    commitPackingReportUpdate(input) {
      return domain.mutate(
        'commitPackingReportUpdate',
        input,
        async (tx, loaded) => {
          const reference = {
            accountId: input.accountId || 'local',
            orderId: input.orderId,
          }
          if (input.contextContainerId)
            domain.amendmentFor(loaded, input, { physical: true })
          if (input.plan?.status === 'unchanged') return { status: 'unchanged' }
          if (
            input.plan?.status === 'amendment-required' &&
            !input.contextContainerId
          ) {
            await apiDraft(tx, reference, input.plan)
            return {
              status: 'amendment-required',
              affectedShipmentRevisions: clone(
                input.plan.affectedShipmentRevisions
              ),
            }
          }
          if (!['ready', 'amendment-required'].includes(input.plan?.status))
            fail(
              'REPORT_REVIEW_REQUIRED',
              'Resolve the complete report review before committing.'
            )
          const supplied = input.plan.commitPayload,
            proposedReport = supplied?.report || input.plan.report
          if (
            !proposedReport ||
            orderKey(proposedReport.orderKey) !== orderKey(reference)
          )
            fail(
              'REPORT_REVIEW_INVALID',
              'The report plan belongs to another purchase.'
            )
          const effective = input.contextContainerId
            ? domain.overlay(
                loaded,
                loaded.containers.find(
                  (container) => container.id === input.contextContainerId
                )
              )
            : loaded
          assertReconciliationRevisions(
            effective,
            reference,
            input.expectedRevisions
          )
          const context = await reportContext(tx, {
              ...reference,
              contextContainerId: input.contextContainerId,
            }),
            asset = await requested(
              tx
                .objectStore('packingReportSources')
                .get(proposedReport.source.rawAssetRef)
            )
          if (
            !asset ||
            !asset.owners.some(
              (owner) => orderKey(owner) === orderKey(reference)
            ) ||
            asset.rawDigest !== proposedReport.source.rawDigest
          )
            fail(
              'REPORT_SOURCE_MISSING',
              'The report original does not belong to this purchase.'
            )
          const source = await parseAsset(asset, reference),
            analysis = analyzePackingReport({
              source,
              context,
              selection: proposedReport.selection,
              decisions: proposedReport.decisions,
              parserVersion: proposedReport.parserVersion,
            })
          let prior =
            context.previousReports.find(
              (report) => report.id === proposedReport.id
            ) || null
          if (!prior)
            prior =
              context.previousReports.find(
                (report) => report.source.rawDigest === asset.rawDigest
              ) || null
          const review = validatePackingReportReview({
            analysis,
            context,
            decisions: proposedReport.decisions,
            previousReportRevision: prior?.revision ?? null,
            expectedContextRevisions: input.expectedRevisions,
          })
          if (!review.valid)
            fail(
              'REPORT_REVIEW_INVALID',
              'Original report validation failed; no effective row was saved.',
              { issues: review.issues }
            )
          const equivalent = context.previousReports.find(
            (report) =>
              report.interpretationFingerprint ===
                review.interpretedReport.interpretationFingerprint &&
              report.semanticFingerprint ===
                review.interpretedReport.semanticFingerprint
          )
          if (equivalent && (!prior || equivalent.id === prior.id))
            return { status: 'unchanged', report: clone(equivalent) }
          const rows = supplied?.report?.rows || [],
            ids = new Map(
              rows.map((row) => [row.candidate.candidateKey, row.batchId])
            )
          const explicitMatches = {
            matches: Object.fromEntries(
              rows.map((row) => [
                row.candidate.candidateKey,
                prior?.rows.some((before) => before.batchId === row.batchId)
                  ? row.batchId
                  : 'new',
              ])
            ),
            removals: supplied?.removedBatchIds || [],
            manualConflicts: (input.plan.fieldDiff || [])
              .filter((field) => field.manualConflict)
              .map((field) => `${field.batchId}:${field.field}`),
            entitlements: Object.fromEntries(
              (supplied?.cartonBatches || [])
                .filter((batch) => batch.entitlementIndices)
                .map((batch) => [batch.id, batch.entitlementIndices])
            ),
            additionalReport: !prior,
            parserVersion: proposedReport.parserVersion,
          }
          const rebuilt = planPackingReportUpdate({
            interpretedReport: review.interpretedReport,
            priorReport: prior,
            physicalFacts: context.batches.filter((batch) => !batch.deletedAt),
            manualFacts: context.manualFacts,
            tombstones: context.batches.filter((batch) => batch.deletedAt),
            sealedDependencies: input.contextContainerId
              ? []
              : context.sealedDependencies,
            explicitMatches,
            newIdentityPool: rows
              .filter(
                (row) =>
                  !prior?.rows.some((before) => before.batchId === row.batchId)
              )
              .map((row) => row.batchId),
          })
          if (rebuilt.status === 'unchanged')
            return { status: 'unchanged', report: prior }
          if (rebuilt.status === 'amendment-required') {
            await apiDraft(tx, reference, input.plan)
            return {
              status: 'amendment-required',
              affectedShipmentRevisions: rebuilt.affectedShipmentRevisions,
            }
          }
          if (rebuilt.status !== 'ready')
            fail(
              'REPORT_REVIEW_INVALID',
              'Revalidation requires a new complete review.',
              {
                issues: rebuilt.issues,
                unresolvedMatches: rebuilt.unresolvedMatches,
              }
            )
          const payload = rebuilt.commitPayload
          if (
            stableValue(payload.cartonBatches) !==
              stableValue(supplied.cartonBatches) ||
            stableValue(payload.removedBatchIds) !==
              stableValue(supplied.removedBatchIds)
          )
            fail(
              'REPORT_PAYLOAD_CHANGED',
              'The complete report payload differs from the original review; no effective mutation occurred.'
            )
          const changes = payload.cartonBatches.map((after) => {
            const before = effective.batches.find(
                (batch) => batch.id === after.id
              ),
              candidate = payload.report.rows.find(
                (row) => row.batchId === after.id
              )?.candidate
            const labels = Object.fromEntries(
              (candidate?.entitlementRefs || []).flatMap((unit, position) =>
                unit.supplierLabel
                  ? [
                      [
                        after.entitlementIndices?.[position] ?? position,
                        unit.supplierLabel,
                      ],
                    ]
                  : []
              )
            )
            return {
              after: {
                ...after,
                ...Object.fromEntries(
                  [
                    'unitContents',
                    'unitMeasurements',
                    'sourceFacts',
                    'cartonHistory',
                  ]
                    .filter(
                      (field) =>
                        after[field] === undefined &&
                        before?.[field] !== undefined
                    )
                    .map((field) => [field, before[field]])
                ),
                ...(Object.keys(labels).length
                  ? { unitLabels: labels }
                  : before?.unitLabels
                    ? { unitLabels: before.unitLabels }
                    : {}),
              },
              expectedRevision:
                effective.batches.find((batch) => batch.id === after.id)
                  ?.revision || 0,
            }
          })
          for (const id of payload.removedBatchIds) {
            const before = effective.batches.find((batch) => batch.id === id)
            if (!before)
              fail(
                'REPORT_REMOVAL_MISSING',
                'A removed report batch is missing.'
              )
            changes.push({
              after: { ...before, deletedAt: new Date().toISOString() },
              expectedRevision: before.revision,
            })
          }
          const normalized = domain.normalizedChanges(
            effective,
            reference,
            changes,
            { contextContainerId: input.contextContainerId }
          )
          domain.validateChanges(effective, reference, normalized, {
            contextContainerId: input.contextContainerId,
          })
          const report = {
            ...payload.report,
            id: prior?.id || payload.report.id,
            revision: (prior?.revision || 0) + 1,
            updatedAt: nextEditTimestamp(prior?.updatedAt),
            history: [
              ...(prior?.history || []),
              ...(prior ? [clone(prior)] : []),
            ],
            rows: payload.report.rows,
          }
          if (input.contextContainerId) {
            await domain.saveFacts(tx, loaded, { ...input, changes })
            const container = loaded.containers.find(
              (container) => container.id === input.contextContainerId
            )
            container.draft.reportChanges = [
              ...(container.draft.reportChanges || []).filter(
                (value) => value.id !== report.id
              ),
              report,
            ]
            tx.objectStore('containers').put(container)
          } else {
            for (const change of normalized)
              tx.objectStore('cartonBatches').put(change.after)
            tx.objectStore('packingReports').put(report)
          }
          tx.objectStore('orderCartonDrafts').delete(
            domain.draftId(
              'report',
              reference,
              input.contextContainerId
                ? loaded.containers.find(
                    (value) => value.id === input.contextContainerId
                  )
                : null
            )
          )
          return {
            status: 'ready',
            report,
            cartonBatches: normalized.map((change) => change.after),
          }
        }
      )
    },
    async exportOperational(tx) {
      return {
        containers: await requested(tx.objectStore('containers').getAll()),
        packingReports: await requested(
          tx.objectStore('packingReports').getAll()
        ),
        reportSources: (
          await requested(tx.objectStore('packingReportSources').getAll())
        ).map(encodeReportAsset),
        orderCartonDrafts: await requested(
          tx.objectStore('orderCartonDrafts').getAll()
        ),
        shipmentLocks: await requested(
          tx.objectStore('shipmentLocks').getAll()
        ),
        operationIntents: await requested(
          tx.objectStore('operationIntents').getAll()
        ),
      }
    },
    async restoreOperational(tx, backup) {
      const fields = {
        containers: 'containers',
        packingReports: 'packingReports',
        reportSources: 'packingReportSources',
        orderCartonDrafts: 'orderCartonDrafts',
        shipmentLocks: 'shipmentLocks',
        operationIntents: 'operationIntents',
      }
      for (const [field, name] of Object.entries(fields))
        for (const incoming of backup[field] || []) {
          const value =
              field === 'reportSources'
                ? {
                    ...clone(incoming),
                    ...(incoming.bytes
                      ? { bytes: bytesFor(incoming.bytes) }
                      : {}),
                  }
                : clone(incoming),
            key = field === 'reportSources' ? value.rawAssetRef : value.id,
            store = tx.objectStore(name),
            old = await requested(store.get(key))
          if (old) {
            if (field === 'shipmentLocks') {
              if (stableValue(old) !== stableValue(value)) {
                // First-consumption identity can only gain independently validated historical evidence.
                if (
                  old.consumedAt !== value.consumedAt ||
                  old.firstContainerId !== value.firstContainerId
                )
                  fail(
                    'RESTORE_OPERATIONAL_CONFLICT',
                    'Permanent consumption history conflicts with this backup.',
                    { id: key }
                  )
                store.put({
                  ...value,
                  ...old,
                  lineages: [
                    ...(old.lineages || []),
                    ...(value.lineages || []).filter(
                      (lineage) =>
                        !old.lineages.some(
                          (current) =>
                            stableValue(current) === stableValue(lineage)
                        )
                    ),
                  ],
                })
              }
              continue
            }
            if (field === 'reportSources') {
              if (old.rawDigest !== value.rawDigest)
                fail(
                  'RESTORE_OPERATIONAL_CONFLICT',
                  'Original report content conflicts.'
                )
              continue
            }
            if (stableValue(old) === stableValue(value)) continue
            if ((old.revision || 0) >= (value.revision || 0))
              fail(
                'RESTORE_OPERATIONAL_CONFLICT',
                'A current or newer operational decision conflicts with the restored archive.',
                { field, id: key }
              )
            if (field === 'containers' && old.effectiveRevisionId) {
              if (
                old.revisions.some(
                  (before) =>
                    !value.revisions?.some(
                      (after) =>
                        after.revisionId === before.revisionId &&
                        stableValue(before) === stableValue(after)
                    )
                )
              )
                fail(
                  'RESTORE_OPERATIONAL_CONFLICT',
                  'Restore cannot discard or rewrite historical manifests.',
                  { id: key }
                )
              if (
                value.effectiveRevisionId !== old.effectiveRevisionId &&
                !value.revisions.some(
                  (revision) =>
                    revision.revisionId === value.effectiveRevisionId &&
                    revision.revision >
                      Math.max(
                        ...old.revisions.map((before) => before.revision)
                      )
                )
              )
                fail(
                  'RESTORE_OPERATIONAL_CONFLICT',
                  'Restore cannot roll back an effective shipment.',
                  { id: key }
                )
            }
          }
          store.put(value)
        }
      const restoredState = await domain.state(tx)
      for (const container of restoredState.containers)
        for (const manifest of container.revisions || []) {
          const expected = consumptionLocksForManifest(manifest, {
            ...restoredState,
            records: manifest.orders.map((order) => order.record),
            preparations: manifest.orders
              .map((order) => order.preparation)
              .filter(Boolean),
            locks: [],
          })
          for (const lock of expected) {
            const actual = restoredState.locks.find(
              (value) => value.id === lock.id
            )
            if (
              !actual ||
              lock.lineages.some(
                (lineage) =>
                  !actual.lineages?.some(
                    (current) =>
                      current.baseCode === lineage.baseCode &&
                      lineage.members.every((member) =>
                        current.members.some(
                          (value) => stableValue(value) === stableValue(member)
                        )
                      )
                  )
              )
            )
              fail(
                'RESTORE_LOCKS_MISSING',
                'A sealed manifest is missing its permanent consumption or historical code evidence.',
                { containerId: container.id, lockId: lock.id }
              )
          }
        }
      domain.graph(restoredState)
    },
  }
  async function apiDraft(tx, reference, value) {
    const id = `report:${orderKey(reference)}`,
      before = await requested(tx.objectStore('orderCartonDrafts').get(id))
    tx.objectStore('orderCartonDrafts').put({
      id,
      ...reference,
      revision: (before?.revision || 0) + 1,
      value: clone(value),
      updatedAt: nextEditTimestamp(before?.updatedAt),
    })
  }
  return {
    api: Object.fromEntries(
      Object.entries(api).filter(
        ([key]) => !['exportOperational', 'restoreOperational'].includes(key)
      )
    ),
    exportOperational: api.exportOperational,
    restoreOperational: api.restoreOperational,
  }
}
