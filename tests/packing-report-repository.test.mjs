import test from 'node:test'
import assert from 'node:assert/strict'
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
