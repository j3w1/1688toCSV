import test from 'node:test'
import assert from 'node:assert/strict'
import { utils, write } from 'xlsx'
import { databaseBrowser } from './fixtures/database-browser.mjs'

test('native local originals, whole report atomic validation/idempotency, draft recovery and v5 raw asset roundtrip', async () => {
  const fixture = await databaseBrowser()
  try {
    const result = await fixture.page.evaluate(async () => {
      const {
        openDatabase,
        fixture: { syntheticOrder },
        cells,
        reports,
        matches,
      } = window.modules
      const record = syntheticOrder()
      record.snapshot.items[0].productNumber = 'SKU'
      const db = await openDatabase({ name: 'synthetic-report-library' })
      await db.restoreBackup({
        format: '1688-order-library',
        version: 4,
        exportedAt: new Date().toISOString(),
        orders: [record],
        history: [],
        images: [],
        preparations: [],
        allocations: [],
        issuedCodes: [],
        packingPreferences: null,
        cartonBatches: [],
      })
      const text =
        'Carton no\tArticle\tPieces per carton\tWeight per carton kg\n001\tSKU\t10\t1.25\n002\tSKU\t20\t2.75'
      const original = await db.savePackingReportSource({
          orderId: '1001',
          kind: 'clipboard-tsv',
          text,
        }),
        stored = await db.getPackingReportSource(original)
      const context = await db.getPackingReportContext({ orderId: '1001' }),
        source = cells.parsePackingReportCells({ ...original, text }).source,
        analysis = reports.analyzePackingReport({ source, context }),
        review = reports.validatePackingReportReview({
          analysis,
          context,
          expectedContextRevisions: context.expectedRevisions,
        }),
        plan = matches.planPackingReportUpdate({
          interpretedReport: review.interpretedReport,
          newIdentityPool: ['report-a', 'report-b'],
        })
      if (!review.valid || plan.status !== 'ready')
        throw new Error(JSON.stringify({ review, plan }))
      const forged = structuredClone(plan)
      forged.commitPayload.cartonBatches[0].contents[0].quantity = '99'
      let atomic = false
      try {
        await db.commitPackingReportUpdate({
          orderId: '1001',
          plan: forged,
          expectedRevisions: plan.expectedRevisions,
          intentId: 'forged',
        })
      } catch (error) {
        atomic = error.code === 'REPORT_PAYLOAD_CHANGED'
      }
      const empty = (await db.getOperationalState({})).batches.length === 0
      const committed = await db.commitPackingReportUpdate({
          orderId: '1001',
          plan,
          expectedRevisions: plan.expectedRevisions,
          intentId: 'accept-report',
        }),
        retry = await db.commitPackingReportUpdate({
          orderId: '1001',
          plan,
          expectedRevisions: plan.expectedRevisions,
          intentId: 'accept-report',
        })
      const draft = await db.savePackingReportDraft({
        orderId: '1001',
        expectedRevision: 0,
        draft: {
          text: 'invalid\tdraft',
          rawCells: { quantity: 'bad' },
          generation: 7,
        },
      })
      const backup = await db.exportBackup({}),
        other = await openDatabase({ name: 'synthetic-report-restored' })
      await other.restoreBackup(backup)
      const restored = await other.getPackingReportSource(original),
        restoredDraft = await other.getPackingReportDraft({ orderId: '1001' }),
        state = await other.getOperationalState({})
      const originalOrder = (await db.getOperationalState({})).records[0]
      db.close()
      other.close()
      return {
        sameText: stored.text === text,
        atomic,
        empty,
        committed: committed.cartonBatches.length,
        retry: retry.report.revision === committed.report.revision,
        version: backup.version,
        rawRoundtrip: restored.text === text,
        draft: restoredDraft.value.rawCells.quantity,
        count: state.batches.length,
        purchase: originalOrder.snapshot.items[0].quantity,
        price: originalOrder.snapshot.items[0].price,
      }
    })
    assert.deepEqual(result, {
      sameText: true,
      atomic: true,
      empty: true,
      committed: 2,
      retry: true,
      version: 5,
      rawRoundtrip: true,
      draft: 'bad',
      count: 2,
      purchase: '100',
      price: '10.00',
    })
  } finally {
    await fixture.close()
  }
})

test('native identical raw bytes share one asset but keep independent order-scoped reports and physical histories', async () => {
  const fixture = await databaseBrowser()
  try {
    const result = await fixture.page.evaluate(async () => {
      const {
          openDatabase,
          fixture: { syntheticOrder },
          cells,
          reports,
          matches,
        } = modules,
        db = await openDatabase({ name: 'synthetic-report-identity' }),
        orders = [syntheticOrder('1001'), syntheticOrder('1002')]
      for (const order of orders) order.snapshot.items[0].productNumber = 'SKU'
      await db.restoreBackup({
        format: '1688-order-library',
        version: 4,
        exportedAt: new Date().toISOString(),
        orders,
        history: [],
        images: [],
        preparations: [],
        allocations: [],
        issuedCodes: [],
        packingPreferences: null,
        cartonBatches: [],
      })
      const text = 'Carton no\tArticle\tPieces per carton\n001\tSKU\t10',
        ids = []
      for (const orderId of ['1001', '1002']) {
        const raw = await db.savePackingReportSource({
            orderId,
            kind: 'clipboard-tsv',
            text,
          }),
          context = await db.getPackingReportContext({ orderId }),
          source = cells.parsePackingReportCells({ ...raw, text }).source,
          analysis = reports.analyzePackingReport({ source, context }),
          review = reports.validatePackingReportReview({
            analysis,
            context,
            expectedContextRevisions: context.expectedRevisions,
          }),
          plan = matches.planPackingReportUpdate({
            interpretedReport: review.interpretedReport,
            newIdentityPool: [`physical-${orderId}`],
          })
        const saved = await db.commitPackingReportUpdate({
          orderId,
          plan,
          expectedRevisions: plan.expectedRevisions,
          intentId: `report-${orderId}`,
        })
        ids.push(saved.report.id)
      }
      const after = await db.exportBackup({}),
        raw = await db.savePackingReportSource({
          orderId: '1001',
          kind: 'clipboard-tsv',
          text,
        }),
        context = await db.getPackingReportContext({ orderId: '1001' }),
        analysis = reports.analyzePackingReport({
          source: cells.parsePackingReportCells({ ...raw, text }).source,
          context,
        }),
        review = reports.validatePackingReportReview({
          analysis,
          context,
          previousReportRevision: context.previousReports[0].revision,
          expectedContextRevisions: context.expectedRevisions,
        }),
        plan = matches.planPackingReportUpdate({
          interpretedReport: review.interpretedReport,
          priorReport: context.previousReports[0],
          physicalFacts: context.batches,
        })
      const noop = await db.commitPackingReportUpdate({
          orderId: '1001',
          plan,
          expectedRevisions: plan.expectedRevisions,
          intentId: 'no-op',
        }),
        final = await db.exportBackup({})
      db.close()
      return {
        different: ids[0] !== ids[1],
        assets: after.reportSources.length,
        owners: after.reportSources[0].owners.length,
        reports: after.packingReports.length,
        physical: after.cartonBatches
          .map((batch) => [batch.id, batch.orderId])
          .sort(),
        noop: noop.status,
        unchanged:
          final.cartonBatches.length === 2 &&
          final.packingReports.every((report) => report.revision === 1),
        source: final.orders.every(
          (order) =>
            order.snapshot.items[0].quantity === '100' &&
            order.snapshot.items[0].price === '10.00'
        ),
      }
    })
    assert.deepEqual(result, {
      different: true,
      assets: 1,
      owners: 2,
      reports: 2,
      physical: [
        ['physical-1001', '1001'],
        ['physical-1002', '1002'],
      ],
      noop: 'unchanged',
      unchanged: true,
      source: true,
    })
  } finally {
    await fixture.close()
  }
})

test('native global physical identity cannot be overwritten by another order even with a current revision and review flag', async () => {
  const fixture = await databaseBrowser()
  try {
    const result = await fixture.page.evaluate(async () => {
      const {
          openDatabase,
          fixture: { syntheticOrder, syntheticBatch },
        } = modules,
        db = await openDatabase({ name: 'synthetic-owned-identity' })
      await db.restoreBackup({
        format: '1688-order-library',
        version: 4,
        exportedAt: new Date().toISOString(),
        orders: [syntheticOrder('1001'), syntheticOrder('1002')],
        history: [],
        images: [],
        preparations: [],
        allocations: [],
        issuedCodes: [],
        packingPreferences: null,
        cartonBatches: [
          syntheticBatch('1001', 1, '10', { id: 'stable-owned' }),
        ],
      })
      const context = await db.getOrderReconciliation({ orderId: '1002' })
      let code
      try {
        await db.saveOrderCartonFacts({
          orderId: '1002',
          expectedRevisions: context.revisions,
          changes: [
            {
              after: syntheticBatch('1002', 1, '10', {
                id: 'stable-owned',
                needsReview: true,
              }),
              expectedRevision: 1,
            },
          ],
          intentId: 'wrong-owner',
        })
      } catch (error) {
        code = error.code
      }
      const state = await db.getOperationalState({})
      db.close()
      return {
        code,
        owners: state.batches.map((batch) => [batch.id, batch.orderId]),
        quantities: state.records.map(
          (record) => record.snapshot.items[0].quantity
        ),
      }
    })
    assert.deepEqual(result, {
      code: 'CARTON_OWNERSHIP',
      owners: [['stable-owned', '1001']],
      quantities: ['100', '100'],
    })
  } finally {
    await fixture.close()
  }
})

test('native sealed report corrections stage complete payloads, cancel without mutation and reject ended amendment epochs', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(async () => {
      const {
        openDatabase,
        fixture: { syntheticOrder },
        cells,
        reports,
        matches,
      } = modules
      const db = await openDatabase({ name: 'synthetic-report-amendment' }),
        record = syntheticOrder()
      record.snapshot.items[0].productNumber = 'SKU'
      await db.restoreBackup({
        format: '1688-order-library',
        version: 4,
        exportedAt: new Date().toISOString(),
        orders: [record],
        history: [],
        images: [],
        preparations: [],
        allocations: [],
        issuedCodes: [],
        cartonBatches: [],
        packingPreferences: null,
      })
      async function plan(text, contextContainerId) {
        const raw = await db.savePackingReportSource({
          orderId: '1001',
          kind: 'clipboard-tsv',
          text,
        })
        const context = await db.getPackingReportContext({
          orderId: '1001',
          contextContainerId,
        })
        const source = cells.parsePackingReportCells({ ...raw, text }).source
        const analysis = reports.analyzePackingReport({ source, context })
        const prior = context.previousReports[0]
        const review = reports.validatePackingReportReview({
          analysis,
          context,
          previousReportRevision: prior?.revision ?? null,
          expectedContextRevisions: context.expectedRevisions,
        })
        if (!review.valid) throw new Error(JSON.stringify(review.issues))
        return {
          context,
          plan: matches.planPackingReportUpdate({
            interpretedReport: review.interpretedReport,
            priorReport: prior,
            physicalFacts: context.batches,
            sealedDependencies: context.sealedDependencies,
            newIdentityPool: prior ? [] : ['report-box'],
          }),
        }
      }
      const original =
        'Carton no\tArticle\tPieces per carton\tWeight per carton kg\n001\tSKU\t10\t1.25'
      let value = await plan(original)
      await db.commitPackingReportUpdate({
        orderId: '1001',
        plan: value.plan,
        expectedRevisions: value.context.expectedRevisions,
      })
      const c = await db.createContainer({ name: 'Report' })
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
        }),
        frozen = JSON.stringify(first)
      const changed = original.replace('1.25', '2.75')
      value = await plan(changed)
      const routed = await db.commitPackingReportUpdate({
        orderId: '1001',
        plan: value.plan,
        expectedRevisions: value.context.expectedRevisions,
      })
      view = await db.getContainerView({ id: c.id })
      view = await db.beginContainerAmendment({
        id: c.id,
        expectedRevision: view.container.revision,
        reason: 'Report correction',
      })
      const epoch = (
        await db.getOrderReconciliation({
          orderId: '1001',
          contextContainerId: c.id,
        })
      ).amendmentContext
      value = await plan(changed, c.id)
      if (value.plan.status !== 'ready')
        throw new Error(JSON.stringify(value.plan))
      const args = {
        orderId: '1001',
        contextContainerId: c.id,
        expectedAmendment: epoch,
        plan: value.plan,
        expectedRevisions: value.context.expectedRevisions,
      }
      await db.commitPackingReportUpdate(args)
      const staged = await db.getOrderReconciliation({
          orderId: '1001',
          contextContainerId: c.id,
        }),
        during = await db.getOperationalState({})
      view = await db.getContainerView({ id: c.id })
      await db.cancelContainerAmendment({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      const canceled = await db.getOperationalState({})
      view = await db.getContainerView({ id: c.id })
      await db.beginContainerAmendment({
        id: c.id,
        expectedRevision: view.container.revision,
        reason: 'Fresh correction',
      })
      let stale
      try {
        await db.commitPackingReportUpdate(args)
      } catch (error) {
        stale = error.code
      }
      value = await plan(changed, c.id)
      const fresh = (
        await db.getOrderReconciliation({
          orderId: '1001',
          contextContainerId: c.id,
        })
      ).amendmentContext
      await db.commitPackingReportUpdate({
        orderId: '1001',
        contextContainerId: c.id,
        expectedAmendment: fresh,
        plan: value.plan,
        expectedRevisions: value.context.expectedRevisions,
      })
      view = await db.getContainerView({ id: c.id })
      review = await db.reviewContainerSeal({
        id: c.id,
        expectedRevision: view.container.revision,
      })
      if (!review.ready) throw new Error(JSON.stringify(review.issues))
      const next = await db.applyContainerAmendment({
        id: c.id,
        expectedRevision: view.container.revision,
        reviewToken: review.reviewToken,
        reason: 'Fresh correction',
      })
      const after = await db.exportBackup({}),
        historical = await db.getContainerManifest({
          id: c.id,
          revisionId: first.revisionId,
        })
      db.close()
      return {
        route: routed.status,
        staged: staged.batches[0].weight,
        during: during.batches[0].weight,
        canceled: canceled.batches[0].weight,
        stale,
        after: after.cartonBatches[0].weight,
        revision: after.packingReports[0].revision,
        historic: JSON.stringify(historical) === frozen,
        loaded: next.products[0].quantity,
        purchased: after.orders[0].snapshot.items[0].quantity,
        price: after.orders[0].snapshot.items[0].price,
      }
    })
    assert.deepEqual(result, {
      route: 'amendment-required',
      staged: '2.75',
      during: '1.25',
      canceled: '1.25',
      stale: 'AMENDMENT_CONTEXT_CONFLICT',
      after: '2.75',
      revision: 2,
      historic: true,
      loaded: '10',
      purchased: '100',
      price: '10.00',
    })
  } finally {
    await browser.close()
  }
})

test('native actual XLSX report replay commits and corrects atomically outside write transactions, rechecking concurrent source revisions', async () => {
  const browser = await databaseBrowser()
  const workbook = (weight) => {
    const book = utils.book_new(),
      sheet = utils.aoa_to_sheet([
        ['Carton no', 'Article', 'Pieces per carton', 'Weight per carton kg'],
        ['001', 'SKU', 10, weight],
        ['002', 'SKU', 20, 2.75],
      ])
    utils.book_append_sheet(book, sheet, 'Packing')
    return [
      ...new Uint8Array(
        write(book, { type: 'array', bookType: 'xlsx', compression: true })
      ),
    ]
  }
  try {
    const result = await browser.page.evaluate(
      async (bytes) => {
        const {
            openDatabase,
            fixture: { syntheticOrder },
            cells,
            reports,
            matches,
            workbooks,
          } = modules,
          db = await openDatabase({ name: 'synthetic-real-xlsx' }),
          other = await openDatabase({ name: 'synthetic-real-xlsx' }),
          record = syntheticOrder()
        record.snapshot.items[0].productNumber = 'SKU'
        await db.restoreBackup({
          format: '1688-order-library',
          version: 4,
          exportedAt: new Date().toISOString(),
          orders: [record],
          history: [],
          images: [],
          preparations: [],
          allocations: [],
          issuedCodes: [],
          cartonBatches: [],
          packingPreferences: null,
        })
        async function plan(buffer) {
          const raw = await db.savePackingReportSource({
              orderId: '1001',
              kind: 'xlsx',
              bytes: new Uint8Array(buffer),
              filename: 'synthetic-packing.xlsx',
            }),
            workbook = await workbooks.readStoreWorkbook(
              new Uint8Array(buffer),
              { filename: 'synthetic-packing.xlsx', reportEvidence: true }
            ),
            source = cells.adaptPackingReportWorkbook({ ...raw, workbook }),
            context = await db.getPackingReportContext({ orderId: '1001' }),
            analysis = reports.analyzePackingReport({ source, context }),
            prior = context.previousReports[0],
            review = reports.validatePackingReportReview({
              analysis,
              context,
              previousReportRevision: prior?.revision ?? null,
              expectedContextRevisions: context.expectedRevisions,
            })
          if (!review.valid) throw new Error(JSON.stringify(review.issues))
          const update = matches.planPackingReportUpdate({
            interpretedReport: review.interpretedReport,
            priorReport: prior,
            physicalFacts: context.batches,
            newIdentityPool: prior ? [] : ['xlsx-a', 'xlsx-b'],
          })
          if (update.status !== 'ready') throw new Error(JSON.stringify(update))
          return { raw, context, plan: update }
        }
        const original = await plan(bytes[0]),
          args = {
            orderId: '1001',
            plan: original.plan,
            expectedRevisions: original.context.expectedRevisions,
            intentId: 'xlsx-initial',
          }
        const first = await db.commitPackingReportUpdate(args),
          retry = await db.commitPackingReportUpdate(args)
        const correction = await plan(bytes[1])
        const nativeDigest = crypto.subtle.digest.bind(crypto.subtle)
        let entered, release
        const reached = new Promise((resolve) => {
            entered = resolve
          }),
          gate = new Promise((resolve) => {
            release = resolve
          })
        crypto.subtle.digest = async (...args) => {
          const value = await nativeDigest(...args)
          entered()
          await gate
          return value
        }
        const pending = db
          .commitPackingReportUpdate({
            orderId: '1001',
            plan: correction.plan,
            expectedRevisions: correction.context.expectedRevisions,
          })
          .then(
            () => null,
            (error) => error.code
          )
        await reached
        await other.updateOrderCapacities({
          orderId: '1001',
          values: { 2001: '7' },
          expectedValues: { 2001: null },
          expectedObservedAt: record.snapshot.observedAt,
        })
        release()
        const stale = await pending
        crypto.subtle.digest = nativeDigest
        const unchanged = (await db.getOperationalState({})).batches.find(
          (batch) => batch.id === 'xlsx-a'
        ).weight
        const refreshed = await plan(bytes[1]),
          corrected = await db.commitPackingReportUpdate({
            orderId: '1001',
            plan: refreshed.plan,
            expectedRevisions: refreshed.context.expectedRevisions,
          })
        const backup = await db.exportBackup({}),
          restored = await openDatabase({
            name: 'synthetic-real-xlsx-restored',
          })
        await restored.restoreBackup(JSON.parse(JSON.stringify(backup)))
        const asset = await restored.getPackingReportSource(refreshed.raw),
          state = await restored.getOperationalState({})
        const current = state.records[0]
        db.close()
        other.close()
        restored.close()
        return {
          first: first.cartonBatches.length,
          retry: retry.report.revision === first.report.revision,
          stale,
          unchanged,
          ids: corrected.cartonBatches.map((batch) => batch.id).sort(),
          weights: state.batches.map((batch) => batch.weight),
          label: state.batches[0].cartonNumber,
          revision: state.reports[0].revision,
          bytes:
            [...asset.bytes].every(
              (value, index) => value === bytes[1][index]
            ) && asset.bytes.length === bytes[1].length,
          quantity: current.snapshot.items[0].quantity,
          price: current.snapshot.items[0].price,
          capacity: current.unitsPerCarton['2001'],
        }
      },
      [workbook(1.25), workbook(3.25)]
    )
    assert.deepEqual(result, {
      first: 2,
      retry: true,
      stale: 'ORDER_REVISION_CONFLICT',
      unchanged: '1.25',
      ids: ['xlsx-a', 'xlsx-b'],
      weights: ['3.25', '2.75'],
      label: '001',
      revision: 2,
      bytes: true,
      quantity: '100',
      price: '10.00',
      capacity: 7,
    })
  } finally {
    await browser.close()
  }
})
