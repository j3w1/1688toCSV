import test from 'node:test'
import assert from 'node:assert/strict'
import { CFB } from 'xlsx'
import { createContainerWorkbook } from '../src/container-export.js'
import { SYNTHETIC_PHOTO } from './fixtures/container-fixture.mjs'
import { databaseBrowser } from './fixtures/database-browser.mjs'

test('native whole-order reservation, stale tabs, logical loading, atomic seal and historical amendment', async () => {
  const fixture = await databaseBrowser()
  try {
    const result = await fixture.page.evaluate(async () => {
      const {
        openDatabase,
        fixture: { syntheticOrder, syntheticBatch },
      } = window.modules
      const db = await openDatabase({
        name: 'synthetic-container-transactions',
      })
      await db.restoreBackup({
        format: '1688-order-library',
        version: 4,
        exportedAt: new Date().toISOString(),
        orders: [
          syntheticOrder('1001', '270'),
          syntheticOrder('1002', '60'),
          syntheticOrder('1003', '100'),
        ],
        history: [],
        images: [],
        preparations: [],
        allocations: [],
        issuedCodes: [],
        packingPreferences: null,
        cartonBatches: [
          syntheticBatch('1001', 27, '270'),
          syntheticBatch('1002', 6, '60'),
          syntheticBatch('1003', 10, '100'),
        ],
      })
      const start = await db.getBacklog({}),
        a = await db.createContainer({ name: 'October', intentId: 'create-A' }),
        again = await db.createContainer({
          name: 'October',
          intentId: 'create-A',
        }),
        b = await db.createContainer({
          name: 'Conflicting',
          intentId: 'create-B',
        })
      let included = await db.includeContainerOrders({
        id: a.id,
        orderRefs: [{ orderId: '1001' }, { orderId: '1002' }],
        expectedRevision: a.revision,
        intentId: 'include-A',
      })
      let reservation = false
      try {
        await db.includeContainerOrders({
          id: b.id,
          orderRefs: [{ orderId: '1001' }],
          expectedRevision: b.revision,
          intentId: 'include-B',
        })
      } catch (error) {
        reservation = error.code === 'ORDER_RESERVED'
      }
      const initialUnconfirmed = included.cartons.every(
        (unit) => unit.state === 'unconfirmed'
      )
      let stale = false
      try {
        await db.markContainerLoaded({
          id: a.id,
          expectedRevision: a.revision,
          intentId: 'stale-load',
        })
      } catch (error) {
        stale = error.code === 'CONTAINER_REVISION_CONFLICT'
      }
      let view = await db.markContainerLoaded({
        id: a.id,
        expectedRevision: included.container.revision,
        intentId: 'mark-A',
      })
      const left = [
        view.cartons.filter((unit) => unit.orderId === '1001').at(-1),
        ...view.cartons.filter((unit) => unit.orderId === '1002').slice(-3),
      ]
      view = await db.setContainerLoading({
        id: a.id,
        expectedRevision: view.container.revision,
        decisions: left.map((unit) => ({
          cartonId: unit.id,
          state: 'left-behind',
        })),
        intentId: 'left-A',
      })
      const review = await db.reviewContainerSeal({
        id: a.id,
        expectedRevision: view.container.revision,
      })
      const sealArgs = {
        id: a.id,
        expectedRevision: view.container.revision,
        reviewToken: review.reviewToken,
        intentId: 'seal-A',
      }
      const manifest = await db.sealContainer(sealArgs),
        retry = await db.sealContainer(sealArgs),
        backlog = await db.getBacklog({})
      const before = JSON.stringify(
        await db.getContainerManifest({
          id: a.id,
          revisionId: manifest.revisionId,
        })
      )
      let sealed = await db.getContainerView({ id: a.id })
      const amended = await db.beginContainerAmendment({
        id: a.id,
        reason: 'Synthetic correction',
        expectedRevision: sealed.container.revision,
        intentId: 'amend-A',
      })
      const during = await db.getBacklog({})
      await db.cancelContainerAmendment({
        id: a.id,
        expectedRevision: amended.container.revision,
        intentId: 'cancel-amend',
      })
      const after = JSON.stringify(
        await db.getContainerManifest({
          id: a.id,
          revisionId: manifest.revisionId,
        })
      )
      db.close()
      return {
        start: start.totals.cartons,
        same: a.id === again.id,
        reservation,
        initialUnconfirmed,
        stale,
        ready: review.ready,
        loaded: manifest.totals.cartons,
        retry: retry.revisionId === manifest.revisionId,
        left: manifest.leftBehind.totals.cartons,
        backlog: backlog.totals.cartons,
        during: during.totals.cartons,
        history: before === after,
        untouched: manifest.leftBehind.products.some(
          (row) => row.orderId === '1003'
        ),
      }
    })
    assert.deepEqual(result, {
      start: 43,
      same: true,
      reservation: true,
      initialUnconfirmed: true,
      stale: true,
      ready: true,
      loaded: 29,
      retry: true,
      left: 4,
      backlog: 14,
      during: 14,
      history: true,
      untouched: false,
    })
  } finally {
    await fixture.close()
  }
})

test('native two connections reserve once; invalid compound facts roll back and retain recovery drafts', async () => {
  const fixture = await databaseBrowser()
  try {
    const setup = await fixture.page.evaluate(async () => {
      const {
        openDatabase,
        fixture: { syntheticOrder },
      } = modules
      const db = await openDatabase({ name: 'synthetic-two-tabs' })
      await db.restoreBackup({
        format: '1688-order-library',
        version: 4,
        exportedAt: new Date().toISOString(),
        orders: [syntheticOrder()],
        history: [],
        images: [],
        preparations: [],
        allocations: [],
        issuedCodes: [],
        packingPreferences: null,
        cartonBatches: [],
      })
      const a = await db.createContainer({ name: 'A' }),
        b = await db.createContainer({ name: 'B' })
      db.close()
      return { a, b }
    })
    const other = await fixture.newPage()
    const reserve = async (page, container) =>
      page.evaluate(async (container) => {
        const db = await modules.openDatabase({ name: 'synthetic-two-tabs' })
        try {
          await db.includeContainerOrders({
            id: container.id,
            orderRefs: [{ orderId: '1001' }],
            expectedRevision: container.revision,
            intentId: container.id,
          })
          return 'reserved'
        } catch (error) {
          return error.code
        } finally {
          db.close()
        }
      }, container)
    const reservations = await Promise.all([
      reserve(fixture.page, setup.a),
      reserve(other, setup.b),
    ])
    assert.deepEqual(reservations.sort(), ['ORDER_RESERVED', 'reserved'])
    const rollback = await fixture.page.evaluate(async () => {
      const {
          openDatabase,
          fixture: { syntheticBatch },
        } = modules,
        db = await openDatabase({ name: 'synthetic-two-tabs' }),
        ctx = await db.getOrderReconciliation({ orderId: '1001' })
      await db.saveOrderCartonDraft({
        orderId: '1001',
        expectedRevision: 0,
        draft: { rawCells: { quantity: 'invalid' }, generation: 8 },
      })
      let code
      try {
        await db.saveOrderCartonFacts({
          orderId: '1001',
          expectedRevisions: ctx.revisions,
          changes: [
            {
              after: syntheticBatch('1001', 1, '40', {
                id: 'first',
                revision: 0,
              }),
              expectedRevision: 0,
            },
            {
              after: syntheticBatch('1001', 1, '61', {
                id: 'second',
                revision: 0,
              }),
              expectedRevision: 0,
            },
          ],
          intentId: 'invalid-compound',
        })
      } catch (error) {
        code = error.code
      }
      const after = await db.getOrderReconciliation({ orderId: '1001' })
      db.close()
      return {
        code,
        batches: after.batches.length,
        draft: after.draft.value.rawCells.quantity,
        purchased: after.record.snapshot.items[0].quantity,
      }
    })
    assert.deepEqual(rollback, {
      code: 'CARTON_OVERALLOCATION',
      batches: 0,
      draft: 'invalid',
      purchased: '100',
    })
  } finally {
    await fixture.close()
  }
})

test('native sealed restore rejects missing locks, inconsistent physical quantities and subset history without partial writes', async () => {
  const fixture = await databaseBrowser()
  try {
    const result = await fixture.page.evaluate(async () => {
      const {
          openDatabase,
          fixture: { syntheticOrder, syntheticBatch },
        } = modules,
        db = await openDatabase({ name: 'synthetic-restore-guards' })
      await db.restoreBackup({
        format: '1688-order-library',
        version: 4,
        exportedAt: new Date().toISOString(),
        orders: [syntheticOrder()],
        history: [],
        images: [],
        preparations: [],
        allocations: [],
        issuedCodes: [],
        packingPreferences: null,
        cartonBatches: [syntheticBatch()],
      })
      const c = await db.createContainer({ name: 'History' })
      let view = await db.includeContainerOrders({
        id: c.id,
        orderRefs: [{ orderId: '1001' }],
        expectedRevision: c.revision,
      })
      view = await db.markContainerLoaded({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      let review = await db.reviewContainerSeal({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      const first = await db.sealContainer({
        id: c.id,
        expectedRevision: view.container.revision,
        reviewToken: review.reviewToken,
        intentId: 'guard-seal',
      })
      view = await db.getContainerView({ id: c.id })
      view = await db.beginContainerAmendment({
        id: c.id,
        expectedRevision: view.container.revision,
        reason: 'Second revision',
      })
      review = await db.reviewContainerSeal({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      await db.applyContainerAmendment({
        id: c.id,
        expectedRevision: view.container.revision,
        reviewToken: review.reviewToken,
        reason: 'Second revision',
        intentId: 'guard-amend',
      })
      const backup = await db.exportBackup({}),
        old = JSON.stringify(
          await db.getContainerManifest({
            id: c.id,
            revisionId: first.revisionId,
          })
        )
      const omitted = structuredClone(backup)
      omitted.shipmentLocks = []
      const fresh = await openDatabase({ name: 'synthetic-missing-locks' })
      let lockCode
      try {
        await fresh.restoreBackup(omitted)
      } catch (error) {
        lockCode = error.code
      }
      const missingCurrent = structuredClone(backup)
      missingCurrent.cartonBatches = []
      let missingCurrentCode
      try {
        await fresh.restoreBackup(missingCurrent)
      } catch (error) {
        missingCurrentCode = error.code
      }
      const retiredCurrent = structuredClone(backup)
      retiredCurrent.cartonBatches[0].deletedAt = '2026-10-23T00:00:00.000Z'
      retiredCurrent.cartonBatches[0].updatedAt = '2026-10-23T00:00:00.000Z'
      retiredCurrent.cartonBatches[0].revision += 1
      let retiredCurrentCode
      try {
        await fresh.restoreBackup(retiredCurrent)
      } catch (error) {
        retiredCurrentCode = error.code
      }
      const changedCurrent = structuredClone(backup)
      changedCurrent.cartonBatches[0].weight = '9.99'
      changedCurrent.cartonBatches[0].revision += 1
      changedCurrent.cartonBatches[0].updatedAt = '2026-10-23T00:00:00.000Z'
      let changedCurrentCode
      try {
        await fresh.restoreBackup(changedCurrent)
      } catch (error) {
        changedCurrentCode = error.code
      }
      const empty = (await fresh.listOrders({})).length
      fresh.close()
      const subset = structuredClone(backup)
      subset.containers[0].revision += 10
      subset.containers[0].revisions = subset.containers[0].revisions.slice(1)
      let subsetCode
      try {
        await db.restoreBackup(subset)
      } catch (error) {
        subsetCode = error.code
      }
      const forged = structuredClone(backup)
      forged.containers[0].revisions[0].products[0].quantity = '99'
      let forgedCode
      try {
        await db.restoreBackup(forged)
      } catch (error) {
        forgedCode = error.code
      }
      const history =
        JSON.stringify(
          await db.getContainerManifest({
            id: c.id,
            revisionId: first.revisionId,
          })
        ) === old
      db.close()
      return {
        lockCode,
        missingCurrentCode,
        retiredCurrentCode,
        changedCurrentCode,
        empty,
        subsetCode,
        forgedCode,
        history,
      }
    })
    assert.deepEqual(result, {
      lockCode: 'RESTORE_LOCKS_MISSING',
      missingCurrentCode: 'SHIPMENT_CARTON_MISSING',
      retiredCurrentCode: 'SHIPMENT_CARTON_MISSING',
      changedCurrentCode: 'SHIPMENT_CARTON_CHANGED',
      empty: 0,
      subsetCode: 'RESTORE_OPERATIONAL_CONFLICT',
      forgedCode: 'INVALID_MANIFEST',
      history: true,
    })
  } finally {
    await fixture.close()
  }
})

test('actual pre-SEAL 2.9 and 464 full/monthly gzip archives upgrade with exact original quantities/value/codes/photos and held legacy loading', async () => {
  const { PRE_SEAL_ARCHIVES } =
      await import('./fixtures/container-fixture.mjs'),
    { createHash } = await import('node:crypto')
  for (const baseline of Object.values(PRE_SEAL_ARCHIVES))
    for (const archive of Object.values(baseline.archives))
      assert.equal(
        createHash('sha256')
          .update(Buffer.from(archive.base64, 'base64'))
          .digest('hex'),
        archive.sha256
      )
  const fixture = await databaseBrowser()
  try {
    const rows = await fixture.page.evaluate(async (fixtures) => {
      const { openDatabase, archive } = modules,
        results = []
      const decode = async (base64) =>
        archive.readBackupFile(
          new File(
            [
              Uint8Array.from(atob(base64), (character) =>
                character.charCodeAt(0)
              ),
            ],
            'synthetic-old.json.gz'
          )
        )
      const codeMap = (preps) =>
        preps
          .flatMap((prep) =>
            prep.groups.flatMap((group) =>
              group.variants.flatMap((variant) =>
                variant.entryIds.map((entryId) => [
                  entryId,
                  group.baseCode,
                  variant.variantSuffix,
                  variant.sizeSuffix,
                ])
              )
            )
          )
          .sort((a, b) => a[0].localeCompare(b[0]))
      for (const [name, baseline] of Object.entries(fixtures)) {
        const original = await decode(baseline.archives.full.base64)
        for (const kind of ['full', 'monthly', 'upgrade']) {
          const dbName = `synthetic-old-${name}-${kind}`
          if (kind === 'upgrade')
            await new Promise((resolve, reject) => {
              const request = indexedDB.open(dbName, 4)
              request.onupgradeneeded = () => {
                const db = request.result
                const stores = {
                  orders: ['snapshot.accountId', 'snapshot.orderId'],
                  history: [
                    'snapshot.accountId',
                    'snapshot.orderId',
                    'snapshot.observedAt',
                  ],
                  jobs: 'id',
                  images: 'url',
                  preparations: ['accountId', 'orderId'],
                  packingAllocations: ['accountId', 'month'],
                  issuedCodes: ['accountId', 'kind', 'code'],
                  packingPreferences: 'id',
                  cartonBatches: 'id',
                }
                for (const [store, keyPath] of Object.entries(stores)) {
                  const object = db.createObjectStore(store, { keyPath })
                  if (store === 'orders')
                    object.createIndex('account', 'snapshot.accountId')
                  if (store === 'history')
                    object.createIndex('order', [
                      'snapshot.accountId',
                      'snapshot.orderId',
                    ])
                  if (store === 'preparations')
                    object.createIndex('account', 'accountId')
                  if (store === 'cartonBatches')
                    object.createIndex('accountMonth', ['accountId', 'month'])
                }
              }
              request.onerror = () => reject(request.error)
              request.onsuccess = () => {
                const db = request.result,
                  tx = db.transaction([...db.objectStoreNames], 'readwrite')
                for (const [field, store] of Object.entries({
                  orders: 'orders',
                  history: 'history',
                  images: 'images',
                  preparations: 'preparations',
                  allocations: 'packingAllocations',
                  issuedCodes: 'issuedCodes',
                  cartonBatches: 'cartonBatches',
                }))
                  for (const value of original[field] || [])
                    tx.objectStore(store).put(value)
                if (original.packingPreferences)
                  tx.objectStore('packingPreferences').put({
                    id: 'packing',
                    ...original.packingPreferences,
                  })
                tx.oncomplete = () => {
                  db.close()
                  resolve()
                }
                tx.onabort = () => reject(tx.error)
              }
            })
          const db = await openDatabase({ name: dbName })
          if (kind === 'full') await db.restoreBackup(original)
          if (kind === 'monthly') {
            await db.restoreBackup(
              await decode(baseline.archives.september.base64)
            )
            await db.restoreBackup(
              await decode(baseline.archives.october.base64)
            )
          }
          const backup = await db.exportBackup({}),
            backlog = await db.getBacklog({})
          const quantity = backup.orders.reduce(
            (sum, record) =>
              sum +
              record.snapshot.items.reduce(
                (n, item) => n + BigInt(item.quantity),
                0n
              ),
            0n
          )
          const sources =
            JSON.stringify(backup.orders.map((record) => record.snapshot)) ===
            JSON.stringify(original.orders.map((record) => record.snapshot))
          const images = original.images.every((image) =>
            backup.images.some(
              (restored) =>
                restored.url === image.url && restored.dataUrl === image.dataUrl
            )
          )
          const physical = original.cartonBatches.every((batch) =>
            backup.cartonBatches.some(
              (restored) =>
                restored.id === batch.id &&
                restored.count === batch.count &&
                restored.weight === batch.weight &&
                restored.weightBasis === batch.weightBasis &&
                JSON.stringify(restored.contents) ===
                  JSON.stringify(batch.contents)
            )
          )
          results.push({
            name,
            kind,
            version: backup.version,
            quantity: String(quantity),
            value: backup.orders[0].snapshot.totals.goodsNet,
            shipping: backup.orders[0].snapshot.totals.shipping,
            payable: backup.orders[0].snapshot.totals.payable,
            sources,
            images,
            physical,
            codes:
              JSON.stringify(codeMap(backup.preparations)) ===
              JSON.stringify(codeMap(original.preparations)),
            sealed: backup.containers.length,
            legacyHeld: backup.cartonBatches.some(
              (batch) =>
                batch.loaded === 2 && batch.legacyReview && batch.needsReview
            ),
            backlogKnown: backlog.totals.quantityComplete,
          })
          db.close()
        }
      }
      return results
    }, PRE_SEAL_ARCHIVES)
    assert.equal(rows.length, 6)
    for (const row of rows)
      assert.deepEqual(
        row,
        {
          name: row.name,
          kind: row.kind,
          version: 5,
          quantity: '73',
          value: '124.53',
          shipping: '0.07',
          payable: '124.60',
          sources: true,
          images: true,
          physical: true,
          codes: true,
          sealed: 0,
          legacyHeld: true,
          backlogKnown: false,
        },
        JSON.stringify(row)
      )
  } finally {
    await fixture.close()
  }
})

test('native active amendment epoch stages preparation and identity; forged and canceled contexts cannot write effective state', async () => {
  const fixture = await databaseBrowser()
  try {
    const result = await fixture.page.evaluate(async () => {
      const {
          openDatabase,
          fixture: { syntheticOrder, syntheticBatch, syntheticManifest },
        } = modules,
        db = await openDatabase({ name: 'synthetic-amendment-epoch' })
      await db.restoreBackup({
        format: '1688-order-library',
        version: 4,
        exportedAt: new Date().toISOString(),
        orders: [syntheticOrder()],
        history: [],
        images: [],
        preparations: [],
        allocations: [],
        issuedCodes: [],
        packingPreferences: null,
        cartonBatches: [syntheticBatch()],
      })
      const initial = syntheticManifest().orders[0].preparation
      const [saved] = await db.savePreparations([initial], {
        expectedRevisions: [0],
        preserveNaming: true,
      })
      const c = await db.createContainer({ name: 'Epoch' })
      let view = await db.includeContainerOrders({
        id: c.id,
        orderRefs: [{ orderId: '1001' }],
        expectedRevision: c.revision,
      })
      view = await db.markContainerLoaded({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      let review = await db.reviewContainerSeal({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      const first = await db.sealContainer({
        id: c.id,
        expectedRevision: view.container.revision,
        reviewToken: review.reviewToken,
      })
      const original = JSON.stringify(first)
      let forged
      try {
        await db.savePreparations([saved], {
          expectedRevisions: [saved.revision],
          contextContainerId: 'forged',
          expectedAmendment: { containerId: 'forged', epoch: 'not-real' },
        })
      } catch (error) {
        forged = error.code
      }
      view = await db.getContainerView({ id: c.id })
      view = await db.beginContainerAmendment({
        id: c.id,
        expectedRevision: view.container.revision,
        reason: 'Reviewed correction',
      })
      const oldContext = await db.getOrderReconciliation({
          orderId: '1001',
          contextContainerId: c.id,
        }),
        candidate = structuredClone(oldContext.preparation)
      candidate.groups[0].baseCode = 'CE26090102'
      await db.saveOrderCartonDraft({
        orderId: '1001',
        expectedRevision: 0,
        draft: { count: 'invalid-count' },
        contextContainerId: c.id,
        expectedAmendment: oldContext.amendmentContext,
      })
      await db.savePackingReportDraft({
        orderId: '1001',
        expectedRevision: 0,
        draft: { text: 'invalid report' },
        contextContainerId: c.id,
        expectedAmendment: oldContext.amendmentContext,
      })
      await db.updateOrderCapacities({
        orderId: '1001',
        values: { 2001: '7' },
        expectedValues: { 2001: null },
        expectedObservedAt: oldContext.record.snapshot.observedAt,
        contextContainerId: c.id,
        expectedAmendment: oldContext.amendmentContext,
      })
      await db.savePreparations([candidate], {
        expectedRevisions: [candidate.revision],
        contextContainerId: c.id,
        expectedAmendment: oldContext.amendmentContext,
        preserveNaming: true,
      })
      await db.resolvePurchaseSupplier({
        orderId: '1001',
        sellerId: 'synthetic-factory',
        expectedObservedAt: oldContext.record.snapshot.observedAt,
        contextContainerId: c.id,
        expectedAmendment: oldContext.amendmentContext,
      })
      const during = await db.getOperationalState({}),
        staged = await db.getOrderReconciliation({
          orderId: '1001',
          contextContainerId: c.id,
        })
      view = await db.getContainerView({ id: c.id })
      await db.cancelContainerAmendment({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      const canceled = await db.getOperationalState({})
      view = await db.getContainerView({ id: c.id })
      view = await db.beginContainerAmendment({
        id: c.id,
        expectedRevision: view.container.revision,
        reason: 'Fresh correction',
      })
      let stale
      try {
        await db.savePreparations([oldContext.preparation], {
          expectedRevisions: [saved.revision],
          contextContainerId: c.id,
          expectedAmendment: oldContext.amendmentContext,
        })
      } catch (error) {
        stale = error.code
      }
      let staleCapacity
      try {
        await db.updateOrderCapacities({
          orderId: '1001',
          values: { 2001: '8' },
          expectedValues: { 2001: null },
          expectedObservedAt: oldContext.record.snapshot.observedAt,
          contextContainerId: c.id,
          expectedAmendment: oldContext.amendmentContext,
        })
      } catch (error) {
        staleCapacity = error.code
      }
      const ordinary = await db.getOrderReconciliation({ orderId: '1001' }),
        recoveredReport = await db.getPackingReportContext({
          orderId: '1001',
          contextContainerId: c.id,
        })
      const fresh = await db.getOrderReconciliation({
          orderId: '1001',
          contextContainerId: c.id,
        }),
        next = structuredClone(fresh.preparation)
      next.groups[0].baseCode = 'CE26090102'
      await db.savePreparations([next], {
        expectedRevisions: [next.revision],
        contextContainerId: c.id,
        expectedAmendment: fresh.amendmentContext,
        preserveNaming: true,
      })
      await db.resolvePurchaseSupplier({
        orderId: '1001',
        sellerId: 'synthetic-factory',
        expectedObservedAt: fresh.record.snapshot.observedAt,
        contextContainerId: c.id,
        expectedAmendment: fresh.amendmentContext,
      })
      view = await db.getContainerView({ id: c.id })
      review = await db.reviewContainerSeal({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      if (!review.ready) throw new Error(JSON.stringify(review.issues))
      await db.applyContainerAmendment({
        id: c.id,
        expectedRevision: view.container.revision,
        reviewToken: review.reviewToken,
        reason: 'Fresh correction',
      })
      const after = await db.exportBackup({}),
        history =
          JSON.stringify(
            await db.getContainerManifest({
              id: c.id,
              revisionId: first.revisionId,
            })
          ) === original
      db.close()
      return {
        forged,
        stale,
        staleCapacity,
        effectiveCapacity: during.records[0].unitsPerCarton?.['2001'] ?? null,
        stagedCapacity: staged.record.unitsPerCarton['2001'],
        canceledCapacity: canceled.records[0].unitsPerCarton?.['2001'] ?? null,
        ordinaryDraft: ordinary.draft,
        currentDraft: fresh.draft,
        recoveredCount: fresh.recoveredDrafts.length,
        recoveredValue: fresh.recoveredDrafts[0].value.count,
        originalEpoch:
          fresh.recoveredDrafts[0].amendmentContext.epoch ===
          oldContext.amendmentContext.epoch,
        reportDraft: recoveredReport.draft,
        recoveredReportValue: recoveredReport.recoveredDrafts[0].value.text,
        duringCode: during.preparations[0].groups[0].baseCode,
        duringIdentity: !!during.records[0].supplierIdentityResolution,
        stagedCode: staged.preparation.groups[0].baseCode,
        canceledCode: canceled.preparations[0].groups[0].baseCode,
        canceledIdentity: !!canceled.records[0].supplierIdentityResolution,
        afterCode: after.preparations[0].groups[0].baseCode,
        afterIdentity: after.orders[0].supplierIdentityResolution.provenance,
        oldReserved: after.shipmentLocks.some((lock) =>
          lock.lineages.some((lineage) =>
            lineage.reservations.some((code) => code.code === 'CE26090101')
          )
        ),
        history,
      }
    })
    assert.deepEqual(result, {
      forged: 'CONTAINER_MISSING',
      stale: 'AMENDMENT_CONTEXT_CONFLICT',
      staleCapacity: 'AMENDMENT_CONTEXT_CONFLICT',
      effectiveCapacity: null,
      stagedCapacity: 7,
      canceledCapacity: null,
      ordinaryDraft: null,
      currentDraft: null,
      recoveredCount: 1,
      recoveredValue: 'invalid-count',
      originalEpoch: true,
      reportDraft: null,
      recoveredReportValue: 'invalid report',
      duringCode: 'CE26090101',
      duringIdentity: false,
      stagedCode: 'CE26090102',
      canceledCode: 'CE26090101',
      canceledIdentity: false,
      afterCode: 'CE26090102',
      afterIdentity: 'manual-confirmed',
      oldReserved: true,
      history: true,
    })
  } finally {
    await fixture.close()
  }
})

test('native 1688 snapshot transport rejects non-China offset literals without weakening the original source clock contract', async () => {
  const fixture = await databaseBrowser()
  try {
    const result = await fixture.page.evaluate(async () => {
      const db = await modules.openDatabase({
          name: 'synthetic-date-rejection',
        }),
        record = modules.fixture.syntheticOrder()
      record.snapshot.purchasedAt = '2026-09-30T23:30:00-05:00'
      let message
      try {
        await db.saveSnapshot(record.snapshot)
      } catch (error) {
        message = error.message
      }
      const count = (await db.listOrders({})).length
      db.close()
      return { message, count }
    })
    assert.match(result.message, /valid purchase timestamp/)
    assert.equal(result.count, 0)
  } finally {
    await fixture.close()
  }
})

test('native amended partial shipments conserve source merchandise/discount/feature/additional/linked/freight cents and freeze the other shipment', async () => {
  const fixture = await databaseBrowser()
  try {
    const result = await fixture.page.evaluate(async () => {
      const {
          openDatabase,
          fixture: { syntheticOrder, syntheticBatch },
          payments,
        } = modules,
        db = await openDatabase({ name: 'synthetic-amended-money' }),
        record = syntheticOrder('1001', '3'),
        fee = syntheticOrder('1002', '1')
      Object.assign(record.snapshot.items[0], {
        sourceDiscount: '0.01',
        discount: '0.01',
      })
      Object.assign(record.snapshot.totals, {
        sourceDiscount: '0.01',
        goodsNet: '29.99',
        shipping: '0.01',
        payable: '30.00',
      })
      record.additionalCharges = [
        { id: 'handling', reason: 'Synthetic handling', amount: '0.01' },
      ]
      record.additionalChargesUpdatedAt = record.snapshot.observedAt
      record.productWorkflow = {
        2001: {
          features: {
            service: {
              name: 'Synthetic feature',
              unitCost: '0.01',
              included: false,
            },
          },
        },
      }
      record.productWorkflowUpdatedAt = record.snapshot.observedAt
      fee.snapshot.items[0].price = '0.01'
      Object.assign(fee.snapshot.totals, {
        goodsGross: '0.01',
        goodsNet: '0.01',
        payable: '0.01',
      })
      record.paymentLinks = [
        {
          id: 'link',
          sourceOrderId: '1002',
          targetEntryIds: ['2001'],
          amount: '0.01',
          reason: 'Synthetic supplier service',
          reviewedAt: record.snapshot.observedAt,
          sourceEvidence: payments.paymentSourceEvidence(fee),
        },
      ]
      record.paymentLinksUpdatedAt = record.snapshot.observedAt
      await db.restoreBackup({
        format: '1688-order-library',
        version: 4,
        exportedAt: new Date().toISOString(),
        orders: [record, fee],
        history: [],
        images: [],
        preparations: [],
        allocations: [],
        issuedCodes: [],
        packingPreferences: null,
        cartonBatches: [syntheticBatch('1001', 3, '3')],
      })
      async function ship(name, indices) {
        const container = await db.createContainer({ name })
        let view = await db.includeContainerOrders({
          id: container.id,
          orderRefs: [{ orderId: '1001' }],
          expectedRevision: container.revision,
        })
        view = await db.setContainerLoading({
          id: container.id,
          expectedRevision: view.container.revision,
          decisions: view.cartons.map((unit) => ({
            cartonId: unit.id,
            state: indices.includes(unit.index) ? 'loaded' : 'left-behind',
          })),
        })
        const review = await db.reviewContainerSeal({
          id: container.id,
          expectedRevision: view.container.revision,
        })
        if (!review.ready) throw new Error(JSON.stringify(review.issues))
        return db.sealContainer({
          id: container.id,
          expectedRevision: view.container.revision,
          reviewToken: review.reviewToken,
        })
      }
      const a = await ship('A', [0]),
        b = await ship('B', [1]),
        frozenB = JSON.stringify(b)
      const current = await db.getOrder('1001')
      const changed = structuredClone(current.snapshot)
      changed.observedAt = '2026-10-03T12:00:00.000Z'
      changed.totals.shipping = '0.02'
      changed.totals.payable = '30.01'
      await db.saveSnapshot(changed)
      async function amend(indices) {
        let view = await db.getContainerView({ id: a.container.id })
        view = await db.beginContainerAmendment({
          id: a.container.id,
          expectedRevision: view.container.revision,
          reason: 'Reviewed allocation correction',
        })
        view = await db.setContainerLoading({
          id: a.container.id,
          expectedRevision: view.container.revision,
          decisions: view.cartons.map((unit) => ({
            cartonId: unit.id,
            state: indices.includes(unit.index) ? 'loaded' : 'left-behind',
          })),
        })
        const review = await db.reviewContainerSeal({
          id: a.container.id,
          expectedRevision: view.container.revision,
        })
        if (!review.ready) throw new Error(JSON.stringify(review.issues))
        return db.applyContainerAmendment({
          id: a.container.id,
          expectedRevision: view.container.revision,
          reviewToken: review.reviewToken,
          reason: 'Reviewed allocation correction',
        })
      }
      const expanded = await amend([0, 2]),
        decreased = await amend([0]),
        c = await ship('C', [2]),
        effective = [decreased, b, c]
      const cents = (value) => {
        const [whole, fraction = ''] = value.split('.')
        return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
      }
      const sum = (field) =>
        String(
          effective.reduce(
            (total, manifest) => total + cents(manifest.products[0][field]),
            0n
          )
        )
      const invariant =
        JSON.stringify(
          await db.getContainerManifest({
            id: b.container.id,
            revisionId: b.revisionId,
          })
        ) === frozenB
      const backlog = await db.getBacklog({}),
        source = await db.getOrder('1001')
      db.close()
      return {
        initialFees: [
          a.products[0].freightAllocated,
          b.products[0].freightAllocated,
        ],
        expandedFee: expanded.products[0].freightAllocated,
        sourceAmount: sum('sourceAmount'),
        discount: sum('discount'),
        additional: sum('additionalCharge'),
        feature: sum('featureCharge'),
        linked: sum('linkedPaymentCharge'),
        freight: sum('freightAllocated'),
        effective: sum('effectiveAmount'),
        invariant,
        remaining: backlog.totals.quantity,
        sourceQuantity: source.snapshot.items[0].quantity,
        sourcePrice: source.snapshot.items[0].price,
      }
    })
    assert.deepEqual(result, {
      initialFees: ['0.00', '0.01'],
      expandedFee: '0.01',
      sourceAmount: '2999',
      discount: '1',
      additional: '1',
      feature: '3',
      linked: '1',
      freight: '2',
      effective: '3004',
      invariant: true,
      remaining: '0',
      sourceQuantity: '3',
      sourcePrice: '10.00',
    })
  } finally {
    await fixture.close()
  }
})

test('native legacy loading, cross-order and retired evidence require explicit review and never create duplicate availability', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(async () => {
      const {
        openDatabase,
        fixture: { syntheticOrder, syntheticBatch },
      } = modules
      const db = await openDatabase({ name: 'synthetic-legacy-review' })
      const cross = syntheticBatch('1002', 1, '10', {
        id: 'cross',
        packingBasis: 'exact',
        contents: [
          { orderId: '1002', entryId: '2001', quantity: '10' },
          { orderId: '1003', entryId: '2001', quantity: '10' },
        ],
        loaded: null,
      })
      cross.groups = [
        { orderId: '1002', groupId: 'legacy2' },
        { orderId: '1003', groupId: 'legacy3' },
      ]
      delete cross.orderId
      delete cross.packingBasis
      delete cross.unresolvedContents
      const retired = syntheticBatch('1004', 1, '10', {
        id: 'retired',
        loaded: 1,
        deletedAt: '2026-10-04T00:00:00.000Z',
      })
      await db.restoreBackup({
        format: '1688-order-library',
        version: 4,
        exportedAt: new Date().toISOString(),
        orders: ['1001', '1002', '1003', '1004'].map((id) =>
          syntheticOrder(id)
        ),
        history: [],
        images: [],
        preparations: [],
        allocations: [],
        issuedCodes: [],
        packingPreferences: null,
        cartonBatches: [
          syntheticBatch('1001', 10, '100', { loaded: 2 }),
          cross,
          retired,
        ],
      })
      const before = await db.getBacklog({})
      const a = await db.reviewLegacyCarton({
        batchId: 'batch-1001',
        expectedRevision: 1,
      })
      let denied
      try {
        await db.resolveLegacyCarton({
          batchId: a.batch.id,
          expectedRevision: 1,
          resolution: 'not-shipped',
          reason: 'No attestation',
          expectedOrderRevisions: a.expectedOrderRevisions,
        })
      } catch (error) {
        denied = error.code
      }
      await db.resolveLegacyCarton({
        batchId: a.batch.id,
        expectedRevision: 1,
        resolution: 'not-shipped',
        reason: 'Checked actual synthetic warehouse',
        attestNotShipped: true,
        expectedOrderRevisions: a.expectedOrderRevisions,
      })
      const x = await db.reviewLegacyCarton({
        batchId: 'cross',
        expectedRevision: 1,
      })
      let crossDenied
      try {
        await db.resolveLegacyCarton({
          batchId: 'cross',
          expectedRevision: 1,
          resolution: 'not-shipped',
          reason: 'Cross-order needs real owner',
          attestNotShipped: true,
          expectedOrderRevisions: x.expectedOrderRevisions,
        })
      } catch (error) {
        crossDenied = error.code
      }
      await db.resolveLegacyCarton({
        batchId: 'cross',
        expectedRevision: 1,
        resolution: 'owner-corrected',
        ownerRef: { accountId: 'local', orderId: '1002' },
        contents: [{ orderId: '1002', entryId: '2001', quantity: '10' }],
        reason: 'The other source was a transcription mistake',
        attestNotShipped: true,
        expectedOrderRevisions: x.expectedOrderRevisions,
      })
      const r = await db.reviewLegacyCarton({
        batchId: 'retired',
        expectedRevision: 1,
      })
      await db.resolveLegacyCarton({
        batchId: 'retired',
        expectedRevision: 1,
        resolution: 'not-shipped',
        reason: 'Actual boxes repacked before any shipment',
        attestNotShipped: true,
        expectedOrderRevisions: r.expectedOrderRevisions,
      })
      const after = await db.exportBackup({}),
        backlog = await db.getBacklog({})
      db.close()
      return {
        before: before.orders.map((o) => o.remainingQuantity),
        denied,
        crossDenied,
        after: backlog.orders.map((o) => o.remainingQuantity),
        crossOwners: after.cartonBatches
          .find((b) => b.id === 'cross')
          .contents.map((r) => r.orderId),
        originalOwners: after.cartonBatches
          .find((b) => b.id === 'cross')
          .sourceFacts.contents.map((r) => r.orderId),
        retired: !!after.cartonBatches.find((b) => b.id === 'retired')
          .deletedAt,
        seals: after.containers.length,
        source: after.orders.map((r) => [
          r.snapshot.items[0].quantity,
          r.snapshot.items[0].price,
        ]),
      }
    })
    assert.deepEqual(result, {
      before: [null, null, null, null],
      denied: 'LEGACY_RESOLUTION_REASON',
      crossDenied: 'LEGACY_CROSS_ORDER',
      after: ['100', '100', '100', '100'],
      crossOwners: ['1002'],
      originalOwners: ['1002', '1003'],
      retired: true,
      seals: 0,
      source: Array.from({ length: 4 }, () => ['100', '10.00']),
    })
  } finally {
    await browser.close()
  }
})

test('native seal freezes original image bytes, source snapshots, canonical labels and complete preferences across amendment', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(async () => {
      const {
        openDatabase,
        fixture: {
          syntheticOrder,
          syntheticBatch,
          syntheticManifest,
          SYNTHETIC_PHOTO,
        },
      } = modules
      const db = await openDatabase({ name: 'synthetic-frozen-media' }),
        ref = `local-image:${'1'.repeat(64)}`
      const record = syntheticOrder()
      record.snapshot.items[0].thumbnail = ref
      record.snapshot.items[0].photos = [ref]
      await db.restoreBackup({
        format: '1688-order-library',
        version: 4,
        exportedAt: new Date().toISOString(),
        orders: [record],
        history: [],
        images: [
          {
            url: ref,
            dataUrl: SYNTHETIC_PHOTO,
            storedAt: '2026-10-01T00:00:00.000Z',
          },
        ],
        preparations: [],
        allocations: [],
        issuedCodes: [],
        cartonBatches: [syntheticBatch()],
        packingPreferences: null,
      })
      const prep = syntheticManifest().orders[0].preparation,
        variant = prep.groups[0].variants[0]
      Object.assign(variant, {
        spanishName: 'VARIANTE',
        material: 'VIDRIO',
        materialSource: 'manual',
        variantSuffix: 'A',
        sizeSuffix: 'XL',
        size: 'Extra Large',
        variant: 'Rojo',
        needsSizeMapping: false,
      })
      await db.savePreparations([prep], {
        expectedRevisions: [0],
        preserveNaming: true,
      })
      const prefs = await db.savePackingPreferences({
        settings: {
          labelWidth: '100',
          customFont: 'Synthetic Font',
          labelOffsets: { x: 3, y: 4 },
        },
        logoDataUrl: SYNTHETIC_PHOTO,
      })
      const sourceBefore = JSON.stringify(
        (await db.getOperationalState({})).records[0].snapshot
      )
      const c = await db.createContainer({ name: 'Frozen' })
      let view = await db.includeContainerOrders({
        id: c.id,
        orderRefs: [{ orderId: '1001' }],
        expectedRevision: c.revision,
      })
      view = await db.markContainerLoaded({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      let review = await db.reviewContainerSeal({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      const first = await db.sealContainer({
        id: c.id,
        expectedRevision: view.container.revision,
        reviewToken: review.reviewToken,
      })
      const original = JSON.stringify(first)
      let imageDenied
      try {
        await db.putImage({
          url: ref,
          dataUrl: 'data:image/png;base64,AQID',
          storedAt: '2026-10-22T00:00:00.000Z',
        })
      } catch (error) {
        imageDenied = error.message
      }
      const forged = await db.exportBackup({})
      forged.images[0].dataUrl = 'data:image/png;base64,AQID'
      forged.images[0].storedAt = '2026-10-23T00:00:00.000Z'
      let restoreDenied
      try {
        await db.restoreBackup(forged)
      } catch (error) {
        restoreDenied = error.message
      }
      let deletionDenied
      try {
        await db.removeOrders(['1001'])
      } catch (error) {
        deletionDenied = error.message
      }
      await db.savePackingPreferences({
        ...prefs,
        settings: { ...prefs.settings, labelOffsets: { x: 99, y: 98 } },
      })
      view = await db.getContainerView({ id: c.id })
      view = await db.beginContainerAmendment({
        id: c.id,
        expectedRevision: view.container.revision,
        reason: 'Label correction',
      })
      const ctx = await db.getOrderReconciliation({
          orderId: '1001',
          contextContainerId: c.id,
        }),
        next = structuredClone(ctx.preparation)
      Object.assign(next.groups[0].variants[0], {
        spanishName: '',
        material: 'ACERO',
      })
      await db.savePreparations([next], {
        expectedRevisions: [next.revision],
        contextContainerId: c.id,
        expectedAmendment: ctx.amendmentContext,
        preserveNaming: true,
      })
      view = await db.getContainerView({ id: c.id })
      review = await db.reviewContainerSeal({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      const second = await db.applyContainerAmendment({
        id: c.id,
        expectedRevision: view.container.revision,
        reviewToken: review.reviewToken,
        reason: 'Label correction',
      })
      const saved = await db.getContainerManifest({
          id: c.id,
          revisionId: first.revisionId,
        }),
        backup = await db.exportBackup({})
      db.close()
      return {
        imageDenied: !!imageDenied,
        restoreDenied: !!restoreDenied,
        deletionDenied: /Historical shipments require/.test(
          deletionDenied || ''
        ),
        historic: JSON.stringify(saved) === original,
        originalRef: saved.orders[0].record.snapshot.items[0].thumbnail,
        rowPhoto: saved.products[0].thumbnail,
        raw: saved.media.images[0].dataUrl,
        fullPrefs: JSON.stringify(saved.preferences) === JSON.stringify(prefs),
        first: [
          saved.products[0].spanishName,
          saved.products[0].material,
          saved.products[0].variantSuffix,
          saved.products[0].sizeSuffix,
          saved.products[0].sourceSize,
          saved.products[0].variantDescription,
        ],
        second: [second.products[0].spanishName, second.products[0].material],
        source: JSON.stringify(backup.orders[0].snapshot) === sourceBefore,
        photoCount: backup.images.length,
      }
    })
    assert.deepEqual(result, {
      imageDenied: true,
      restoreDenied: true,
      deletionDenied: true,
      historic: true,
      originalRef: `local-image:${'1'.repeat(64)}`,
      rowPhoto: (await import('./fixtures/container-fixture.mjs'))
        .SYNTHETIC_PHOTO,
      raw: (await import('./fixtures/container-fixture.mjs')).SYNTHETIC_PHOTO,
      fullPrefs: true,
      first: ['VARIANTE', 'VIDRIO', 'A', 'XL', 'Extra Large', 'Rojo'],
      second: ['', 'ACERO'],
      source: true,
      photoCount: 1,
    })
  } finally {
    await browser.close()
  }
})

test('native restore cannot consume another open draft whole-order remainder and rolls back the full graph', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(async () => {
      const {
        openDatabase,
        fixture: { syntheticOrder, syntheticBatch },
      } = modules
      const initial = {
        format: '1688-order-library',
        version: 4,
        exportedAt: new Date().toISOString(),
        orders: [syntheticOrder()],
        history: [],
        images: [],
        preparations: [],
        allocations: [],
        issuedCodes: [],
        cartonBatches: [syntheticBatch()],
        packingPreferences: null,
      }
      const a = await openDatabase({ name: 'synthetic-local-reservation' }),
        b = await openDatabase({ name: 'synthetic-remote-shipment' })
      await a.restoreBackup(initial)
      await b.restoreBackup(initial)
      const reservation = await a.createContainer({ name: 'Local draft' })
      await a.includeContainerOrders({
        id: reservation.id,
        orderRefs: [{ orderId: '1001' }],
        expectedRevision: reservation.revision,
      })
      const shipment = await b.createContainer({ name: 'Remote shipment' })
      let view = await b.includeContainerOrders({
        id: shipment.id,
        orderRefs: [{ orderId: '1001' }],
        expectedRevision: shipment.revision,
      })
      view = await b.setContainerLoading({
        id: shipment.id,
        expectedRevision: view.container.revision,
        decisions: view.cartons.map((unit, i) => ({
          cartonId: unit.id,
          state: i === 0 ? 'loaded' : 'left-behind',
        })),
      })
      const review = await b.reviewContainerSeal({
        id: shipment.id,
        expectedRevision: view.container.revision,
      })
      await b.sealContainer({
        id: shipment.id,
        expectedRevision: view.container.revision,
        reviewToken: review.reviewToken,
      })
      const remote = await b.exportBackup({}),
        before = JSON.stringify(await a.getOperationalState({}))
      let conflict
      try {
        await a.restoreBackup(remote)
      } catch (error) {
        conflict = error.code || error.message
      }
      const unchanged =
        JSON.stringify(await a.getOperationalState({})) === before
      const backlog = await a.getBacklog({})
      a.close()
      b.close()
      return {
        conflict,
        unchanged,
        loaded: backlog.orders[0].loadedQuantity,
        remaining: backlog.orders[0].remainingQuantity,
        reserved: backlog.orders[0].reservation.containerId === reservation.id,
      }
    })
    assert.deepEqual(result, {
      conflict: 'ORDER_RESERVATION_CONFLICT',
      unchanged: true,
      loaded: '0',
      remaining: '100',
      reserved: true,
    })
  } finally {
    await browser.close()
  }
})

test('native v5 scoped backups close physical and financial dependencies, retain drafts and exclude unrelated code/photo context', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(async () => {
      const {
        openDatabase,
        validateBackup,
        payments,
        fixture: { syntheticOrder, syntheticBatch, syntheticManifest },
      } = modules
      const db = await openDatabase({ name: 'synthetic-v5-scope' }),
        target = syntheticOrder(),
        fee = syntheticOrder('1002', '1'),
        unrelated = syntheticOrder('1003')
      target.snapshot.items.push({
        ...target.snapshot.items[0],
        entryId: '2002',
        quantity: '5',
        price: '2.00',
      })
      Object.assign(target.snapshot.totals, {
        goodsGross: '1010.00',
        goodsNet: '1010.00',
        payable: '1010.00',
      })
      fee.snapshot.items[0].price = '0.01'
      Object.assign(fee.snapshot.totals, {
        goodsGross: '0.01',
        goodsNet: '0.01',
        payable: '0.01',
      })
      target.paymentLinks = [
        {
          id: 'scoped-link',
          sourceOrderId: '1002',
          targetEntryIds: ['2001'],
          amount: '0.01',
          reason: 'Scoped payment dependency',
          reviewedAt: target.snapshot.observedAt,
          sourceEvidence: payments.paymentSourceEvidence(fee),
        },
      ]
      target.paymentLinksUpdatedAt = target.snapshot.observedAt
      await db.restoreBackup({
        format: '1688-order-library',
        version: 4,
        exportedAt: new Date().toISOString(),
        orders: [target, fee, unrelated],
        history: [],
        images: [],
        preparations: [],
        allocations: [],
        issuedCodes: [],
        cartonBatches: [syntheticBatch()],
        packingPreferences: null,
      })
      const a = syntheticManifest().orders[0].preparation,
        b = structuredClone(a)
      a.groups[0].variants[0].entryIds.push('2002')
      b.orderId = '1003'
      b.groups[0].baseCode = 'CE26090102'
      await db.savePreparations([a, b], {
        expectedRevisions: [0, 0],
        preserveNaming: true,
      })
      const container = await db.createContainer({ name: 'Scoped container' })
      await db.includeContainerOrders({
        id: container.id,
        orderRefs: [{ orderId: '1001' }],
        expectedRevision: container.revision,
      })
      await db.saveOrderCartonDraft({
        orderId: '1001',
        expectedRevision: 0,
        draft: { rawCells: { count: 'invalid' } },
      })
      await db.savePackingReportDraft({
        orderId: '1003',
        expectedRevision: 0,
        draft: { text: 'unrelated invalid text' },
      })
      const filtered = await db.exportBackup({ orderIds: ['1001'] })
      validateBackup(filtered)
      let partialCode
      try {
        await db.exportBackup({
          packingScope: {
            months: ['2026-09'],
            orders: [
              { accountId: 'local', orderId: '1001', entryIds: ['2001'] },
            ],
          },
        })
      } catch (error) {
        partialCode = error.code
      }
      const scoped = await db.exportBackup({
        packingScope: {
          months: ['2026-09'],
          orders: [
            { accountId: 'local', orderId: '1001', entryIds: ['2001', '2002'] },
          ],
        },
      })
      validateBackup(scoped)
      const restored = await openDatabase({
        name: 'synthetic-v5-scope-restored',
      })
      await restored.restoreBackup(scoped)
      const context = await restored.getOrderReconciliation({
          orderId: '1001',
        }),
        state = await restored.getOperationalState({})
      db.close()
      restored.close()
      return {
        filtered: filtered.orders.map((r) => r.snapshot.orderId),
        filteredContainers: filtered.containers.length,
        scoped: scoped.orders.map((r) => r.snapshot.orderId),
        partialCode,
        codes: scoped.issuedCodes.map((code) => code.code),
        draftOrders: scoped.orderCartonDrafts.map((draft) => draft.orderId),
        restoredOrders: state.records.map((r) => r.snapshot.orderId),
        restoredContainers: state.containers.length,
        raw: context.draft.value.rawCells.count,
        quantity: context.record.snapshot.items.map((item) => item.quantity),
        price: context.record.snapshot.items.map((item) => item.price),
        linked: context.record.paymentLinks[0].amount,
      }
    })
    assert.deepEqual(result, {
      filtered: ['1001', '1002'],
      filteredContainers: 1,
      scoped: ['1001', '1002'],
      partialCode: 'PACKING_BACKUP_DEPENDENCY_REVIEW',
      codes: ['CE26090101', 'CE26090101'],
      draftOrders: ['1001'],
      restoredOrders: ['1001', '1002'],
      restoredContainers: 1,
      raw: 'invalid',
      quantity: ['100', '5'],
      price: ['10.00', '2.00'],
      linked: '0.01',
    })
  } finally {
    await browser.close()
  }
})

test('native confirmed capacity and facts predating preparation freeze valid same-order marks into actual workbook drawings', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(async () => {
      const {
          openDatabase,
          fixture: { syntheticOrder, syntheticBatch, syntheticManifest },
        } = modules,
        db = await openDatabase({ name: 'synthetic-canonical-default-mark' })
      await db.restoreBackup({
        format: '1688-order-library',
        version: 4,
        exportedAt: new Date().toISOString(),
        orders: [syntheticOrder('1001', '60'), syntheticOrder('1002', '20')],
        history: [],
        images: [],
        preparations: [],
        allocations: [],
        issuedCodes: [],
        cartonBatches: [syntheticBatch('1002', 2, '20')],
        packingPreferences: null,
      })
      const a = syntheticManifest().orders[0].preparation,
        b = structuredClone(a)
      b.orderId = '1002'
      b.groups[0].baseCode = 'CE26090102'
      await db.savePreparations([a, b], {
        expectedRevisions: [0, 0],
        preserveNaming: true,
      })
      await db.updateOrderCapacities({
        orderId: '1001',
        values: { 2001: '10' },
        expectedValues: { 2001: null },
        expectedObservedAt: '2026-10-01T12:00:00.000Z',
      })
      const context = await db.getOrderReconciliation({ orderId: '1001' })
      const confirmed = await db.confirmOrderCartons({
        orderId: '1001',
        draft: {},
        expectedRevisions: context.revisions,
      })
      const manifests = []
      for (const orderId of ['1001', '1002']) {
        const c = await db.createContainer({ name: `Mark ${orderId}` })
        let view = await db.includeContainerOrders({
          id: c.id,
          orderRefs: [{ orderId }],
          expectedRevision: c.revision,
        })
        view = await db.markContainerLoaded({
          id: c.id,
          expectedRevision: view.container.revision,
        })
        const review = await db.reviewContainerSeal({
          id: c.id,
          expectedRevision: view.container.revision,
        })
        if (!review.ready) throw new Error(JSON.stringify(review.issues))
        manifests.push(
          await db.sealContainer({
            id: c.id,
            expectedRevision: view.container.revision,
            reviewToken: review.reviewToken,
          })
        )
      }
      const backup = await db.exportBackup({}),
        other = await openDatabase({
          name: 'synthetic-canonical-default-mark-restored',
        })
      await other.restoreBackup(backup)
      const restored = await other.getContainerManifest({
        id: manifests[1].container.id,
      })
      db.close()
      other.close()
      return {
        capacityCount: confirmed.batches.reduce(
          (sum, batch) => sum + batch.count,
          0
        ),
        capacityMark: confirmed.batches[0].mark,
        oldSourceStillUnmarked: !backup.cartonBatches.find(
          (batch) => batch.id === 'batch-1002'
        ).mark,
        manifests,
        restored: JSON.stringify(restored) === JSON.stringify(manifests[1]),
      }
    })
    assert.equal(result.capacityCount, 6)
    assert.equal(result.capacityMark.orderId, '1001')
    assert.equal(result.oldSourceStillUnmarked, true)
    assert.equal(result.restored, true)
    for (const [index, manifest] of result.manifests.entries()) {
      const expected = index === 0 ? 'CE26090101' : 'CE26090102'
      assert(manifest.cartons.every((unit) => unit.markCode === expected))
      assert.equal(manifest.products[0].cartonMarkCode, expected)
      const requested = []
      const bytes = await createContainerWorkbook(manifest, {
        language: 'en',
        prepareImages: async (source, limits) => {
          if (limits.mark) requested.push(source.baseCode)
          return Object.fromEntries(
            ['photo', 'code', 'mark']
              .filter((kind) => limits[kind])
              .map((kind) => [
                kind,
                {
                  bytes: new Uint8Array(
                    Buffer.from(SYNTHETIC_PHOTO.split(',')[1], 'base64')
                  ),
                  mimeType: 'image/png',
                  width: 1,
                  height: 1,
                },
              ])
          )
        },
      })
      assert(requested.includes(expected))
      const archive = CFB.read(bytes, { type: 'array' }),
        drawings = archive.FullPaths.flatMap((path, index) =>
          /xl\/drawings\/drawing\d+\.xml$/.test(path)
            ? [new TextDecoder().decode(archive.FileIndex[index].content)]
            : []
        ).join('')
      assert.match(drawings, /name="mark-/)
    }
  } finally {
    await browser.close()
  }
})
