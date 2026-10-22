import { test, expect } from './extension-fixture.mjs'

function snapshot(orderId, { fee = false, shipping = '0.00' } = {}) {
  const items = (fee ? ['Cup', 'Labels'] : ['Cup']).map((title, index) => ({
    entryId: String(index + 1),
    title,
    description: title,
    thumbnail: 'https://cbu01.alicdn.com/synthetic-payment-product.png',
    price: index ? '2.00' : '10.00',
    quantity: '1',
    sourceDiscount: '0.00',
    allocatedDiscount: '0.00',
    discount: '0.00',
  }))
  const goods = fee ? '12.00' : '10.00'
  return {
    schemaVersion: 1,
    accountId: 'local',
    orderId,
    sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
    sellerName: `Synthetic source ${orderId}`,
    sellerMemberLogin: 'synthetic-payment-store',
    status: 'Completed',
    observedAt: '2026-10-01T12:00:00.000Z',
    items,
    totals: {
      goodsGross: goods,
      goodsNet: goods,
      shipping,
      sourceDiscount: '0.00',
      orderAdjustment: '0.00',
      payable: shipping === '0.00' ? goods : '12.34',
    },
  }
}

async function openLibrary(extension, sources) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async (snapshots) => {
    window.paymentModel = await import('/src/payment-links.js')
    window.paymentDatabase = await import('/src/database.js')
    window.paymentName = `synthetic-linked-payments-${crypto.randomUUID()}`
    window.library = await paymentDatabase.openDatabase({ name: paymentName })
    for (const source of snapshots) await library.saveSnapshot(source)
  }, sources)
  return page
}

test('new payment links reject other or unknown stores atomically and preserve existing reviewed references', async ({
  extension,
}) => {
  const target = snapshot('12001'),
    sameStore = snapshot('12002'),
    other = snapshot('12003'),
    unknown = snapshot('12004')
  other.sellerName = target.sellerName
  other.sellerMemberLogin = 'another-payment-store'
  delete unknown.sellerMemberLogin
  const page = await openLibrary(extension, [target, sameStore, other, unknown])
  const result = await page.evaluate(async () => {
    const before = await library.exportBackup()
    const failures = []
    for (const sourceOrderId of ['12003', '12004']) {
      try {
        await library.linkPayment('12001', {
          sourceOrderId,
          reason: 'Rejected cross-store payment',
        })
        failures.push('unexpected success')
      } catch (error) {
        failures.push(error.message)
      }
    }
    const afterRejected = await library.exportBackup()
    const linked = await library.linkPayment('12001', {
      id: 'existing',
      sourceOrderId: '12002',
      reason: 'Recorded service',
    })
    const originalLink = structuredClone(linked.paymentLinks[0])
    const source = (await library.exportBackup()).orders.find(
      (record) => record.snapshot.orderId === '12002'
    ).snapshot
    source.sellerMemberLogin = 'identity-changed-after-review'
    source.observedAt = '2026-10-02T12:00:00.000Z'
    await library.saveSnapshot(source)
    const retained = await library.setPaymentLinks('12001', linked.paymentLinks)
    await library.unlinkPayment('12001', 'existing')
    const unlinked = await library.exportBackup()
    return {
      failures,
      before: before.orders,
      afterRejected: afterRejected.orders,
      originalLink,
      retained: retained.paymentLinks[0],
      unlinked: unlinked.orders,
    }
  })
  expect(result.failures).toHaveLength(2)
  for (const failure of result.failures)
    expect(failure).toMatch(/same known store and account/)
  expect(result.afterRejected).toEqual(result.before)
  expect(result.retained).toEqual(result.originalLink)
  expect(
    result.unlinked.find((record) => record.snapshot.orderId === '12001')
      .paymentLinks
  ).toEqual([])
  expect(
    result.unlinked.find((record) => record.snapshot.orderId === '12002')
      .packingExcludedEntryIds
  ).toEqual([])
})

test('linking defaults to the complete existing payable, atomically excludes the source and persists exact attribution', async ({
  extension,
}) => {
  const page = await openLibrary(extension, [
    snapshot('1001'),
    snapshot('1002', { shipping: '2.34' }),
  ])
  const result = await page.evaluate(async () => {
    const before = await library.exportBackup()
    const linked = await library.linkPayment(
      '1001',
      { id: 'labels', sourceOrderId: '1002', reason: 'Recorded labels' },
      { expectedUpdatedAt: '' }
    )
    const after = await library.exportBackup()
    const source = after.orders.find(
      (record) => record.snapshot.orderId === '1002'
    )
    const cost = paymentModel
      .paymentCostAdjustments(linked, after.orders)
      .get('1')
    library.close()
    window.library = await paymentDatabase.openDatabase({ name: paymentName })
    const reopened = await library.exportBackup()
    return {
      before: before.orders,
      after: after.orders,
      source,
      link: linked.paymentLinks[0],
      cost,
      reopened: reopened.orders,
    }
  })
  expect(result.link.amount).toBe('12.34')
  expect(result.link.targetEntryIds).toEqual(['1'])
  expect(result.link.sourceEvidence.shipping).toBe('2.34')
  expect(result.source.packingExcludedEntryIds).toEqual(['1'])
  expect(result.cost.linkedPaymentCharge).toBe('12.34')
  expect(result.cost.effectiveAmount).toBe('22.34')
  expect(result.after.map((record) => record.snapshot)).toEqual(
    result.before.map((record) => record.snapshot)
  )
  expect(result.reopened).toEqual(result.after)
})

test('same-order skipped fee is removed from its own attribution and prior skip survives unlink', async ({
  extension,
}) => {
  const page = await openLibrary(extension, [snapshot('2001', { fee: true })])
  const result = await page.evaluate(async () => {
    await library.setPackingExcluded('2001', ['2'], true)
    const prior = (await library.exportBackup()).orders[0]
    const linked = await library.linkPayment('2001', {
      id: 'fee',
      sourceOrderId: '2001',
      sourceEntryId: '2',
      reason: 'Recorded label fee',
    })
    const costs = Object.fromEntries(
      paymentModel.paymentCostAdjustments(linked, [linked])
    )
    const removed = await library.unlinkPayment('2001', 'fee', {
      expectedUpdatedAt: linked.paymentLinksUpdatedAt,
    })
    return { prior, linked, costs, removed }
  })
  expect(result.linked.paymentLinks[0].amount).toBe('2.00')
  expect(result.linked.paymentLinks[0].targetEntryIds).toEqual(['1'])
  expect(result.costs['1'].effectiveAmount).toBe('12.00')
  expect(result.costs['2'].effectiveAmount).toBe('0.00')
  expect(result.linked.paymentLinks[0].packingExclusions).toBeUndefined()
  expect(result.removed.packingExcludedEntryIds).toEqual(['2'])
  expect(result.removed.snapshot).toEqual(result.prior.snapshot)
})

test('unlink restores only authored exclusions and preserves newer user edits', async ({
  extension,
}) => {
  const page = await openLibrary(extension, [
    snapshot('3001'),
    snapshot('3002', { fee: true }),
  ])
  const result = await page.evaluate(async () => {
    await library.setPackingExcluded('3002', ['2'], true)
    let linked = await library.linkPayment('3001', {
      id: 'first',
      sourceOrderId: '3002',
      reason: 'Recorded service',
    })
    await library.unlinkPayment('3001', 'first', {
      expectedUpdatedAt: linked.paymentLinksUpdatedAt,
    })
    const restored = (await library.exportBackup()).orders.find(
      (record) => record.snapshot.orderId === '3002'
    )
    linked = await library.linkPayment('3001', {
      id: 'second',
      sourceOrderId: '3002',
      reason: 'Recorded service',
    })
    await library.setPackingExcluded('3002', ['1'], false)
    await library.setPackingExcluded('3002', ['1'], true)
    await library.unlinkPayment('3001', 'second', {
      expectedUpdatedAt: linked.paymentLinksUpdatedAt,
    })
    const retained = (await library.exportBackup()).orders.find(
      (record) => record.snapshot.orderId === '3002'
    )
    return { restored, retained }
  })
  expect(result.restored.packingExcludedEntryIds).toEqual(['2'])
  expect(result.retained.packingExcludedEntryIds.sort()).toEqual(['1', '2'])
})

test('duplicate or oversubscribed links abort the entire transaction and optimistic clocks reject stale review', async ({
  extension,
}) => {
  const page = await openLibrary(extension, [
    snapshot('4001'),
    snapshot('4002'),
    snapshot('4003'),
  ])
  const result = await page.evaluate(async () => {
    const source = (await library.exportBackup()).orders.find(
      (record) => record.snapshot.orderId === '4002'
    )
    const linked = await library.linkPayment(
      '4001',
      { id: 'first', sourceOrderId: '4002', reason: 'Recorded service' },
      {
        expectedSourceClocks: { 4002: paymentModel.paymentSourceClock(source) },
      }
    )
    const before = await library.exportBackup(),
      failures = []
    for (const task of [
      () =>
        library.linkPayment('4001', {
          id: 'duplicate',
          sourceOrderId: '4002',
          reason: 'Duplicate',
        }),
      () =>
        library.linkPayment('4003', {
          id: 'too-much',
          sourceOrderId: '4002',
          reason: 'Oversubscribed',
          amount: '1.00',
        }),
      () => library.setPaymentLinks('4001', [], { expectedUpdatedAt: '' }),
      () =>
        library.setPaymentLinks('4001', [], {
          expectedUpdatedAt: linked.paymentLinksUpdatedAt,
          expectedSourceClocks: {
            4002: paymentModel.paymentSourceClock(source),
          },
        }),
    ]) {
      try {
        await task()
        failures.push('unexpected success')
      } catch (error) {
        failures.push(error.message)
      }
    }
    const after = await library.exportBackup()
    return { failures, before: before.orders, after: after.orders }
  })
  expect(result.failures[0]).toContain('already linked')
  expect(result.failures[1]).toContain('exceed')
  expect(result.failures[2]).toContain('changed while')
  expect(result.failures[3]).toContain('source payment changed')
  expect(result.after).toEqual(result.before)
})

test('a split source payment transfers skip ownership until the final target unlinks', async ({
  extension,
}) => {
  const page = await openLibrary(extension, [
    snapshot('5001'),
    snapshot('5002'),
    snapshot('5003'),
  ])
  const result = await page.evaluate(async () => {
    await library.linkPayment('5001', {
      id: 'first',
      sourceOrderId: '5002',
      reason: 'First service share',
      amount: '4.00',
    })
    await library.linkPayment('5003', {
      id: 'second',
      sourceOrderId: '5002',
      reason: 'Second service share',
      amount: '6.00',
    })
    await library.unlinkPayment('5001', 'first')
    const midway = await library.exportBackup()
    await library.unlinkPayment('5003', 'second')
    const after = await library.exportBackup()
    return {
      sourceMidway: midway.orders.find(
        (record) => record.snapshot.orderId === '5002'
      ),
      otherMidway: midway.orders.find(
        (record) => record.snapshot.orderId === '5003'
      ),
      sourceAfter: after.orders.find(
        (record) => record.snapshot.orderId === '5002'
      ),
    }
  })
  expect(result.sourceMidway.packingExcludedEntryIds).toEqual(['1'])
  expect(result.otherMidway.paymentLinks[0].packingExclusions.entryIds).toEqual(
    ['1']
  )
  expect(result.sourceAfter.packingExcludedEntryIds).toEqual([])
})

test('deletion preserves surviving payment relationships and dangling backup restore is atomic', async ({
  extension,
}) => {
  const page = await openLibrary(extension, [
    snapshot('6001'),
    snapshot('6002'),
  ])
  const result = await page.evaluate(async () => {
    await library.linkPayment('6001', {
      id: 'service',
      sourceOrderId: '6002',
      reason: 'Recorded service',
    })
    const before = await library.exportBackup(),
      failures = []
    for (const ids of [['6002'], ['6001']]) {
      try {
        await library.removeOrders(ids)
        failures.push('unexpected success')
      } catch (error) {
        failures.push(error.message)
      }
    }
    const dangling = structuredClone(before)
    dangling.orders = dangling.orders.filter(
      (record) => record.snapshot.orderId !== '6002'
    )
    try {
      await library.restoreBackup(dangling)
      failures.push('unexpected success')
    } catch (error) {
      failures.push(error.message)
    }
    const afterRejected = await library.exportBackup()
    await library.removeOrders(['6001', '6002'])
    const afterCompleteRemoval = await library.exportBackup()
    return {
      before: before.orders,
      afterRejected: afterRejected.orders,
      afterCompleteRemoval: afterCompleteRemoval.orders,
      failures,
    }
  })
  expect(result.failures).not.toContain('unexpected success')
  expect(result.failures[0]).toMatch(/payment|linked|source/i)
  expect(result.failures[1]).toMatch(/payment|linked|unlink/i)
  expect(result.failures[2]).toMatch(/source order was not found/)
  expect(result.afterRejected).toEqual(result.before)
  expect(result.afterCompleteRemoval).toEqual([])
})

test('later source amount changes require review and never silently refresh the saved linked amount', async ({
  extension,
}) => {
  const page = await openLibrary(extension, [
    snapshot('7001'),
    snapshot('7002'),
  ])
  const result = await page.evaluate(async () => {
    const linked = await library.linkPayment('7001', {
      id: 'service',
      sourceOrderId: '7002',
      reason: 'Recorded service',
    })
    const before = await library.exportBackup()
    const source = structuredClone(
      before.orders.find((record) => record.snapshot.orderId === '7002')
        .snapshot
    )
    source.observedAt = '2026-10-02T12:00:00.000Z'
    source.items[0].price = '8.00'
    Object.assign(source.totals, {
      goodsGross: '8.00',
      goodsNet: '8.00',
      payable: '8.00',
    })
    await library.saveSnapshot(source)
    const refreshed = await library.exportBackup()
    const target = refreshed.orders.find(
      (record) => record.snapshot.orderId === '7001'
    )
    const sourceRecord = refreshed.orders.find(
      (record) => record.snapshot.orderId === '7002'
    )
    const costs = paymentModel
      .paymentCostAdjustments(target, refreshed.orders)
      .get('1')
    const sourceCosts = paymentModel
      .paymentCostAdjustments(sourceRecord, refreshed.orders)
      .get('1')
    const reviews = paymentModel.validatePaymentGraph(refreshed.orders).reviews
    let staleFailure
    try {
      await library.setPaymentLinks('7001', [], {
        expectedUpdatedAt: linked.paymentLinksUpdatedAt,
        expectedSourceClocks: {
          7002: paymentModel.paymentSourceClock(
            before.orders.find((record) => record.snapshot.orderId === '7002')
          ),
        },
      })
    } catch (error) {
      staleFailure = error.message
    }
    return {
      savedAmount: target.paymentLinks[0].amount,
      costs,
      sourceCosts,
      reviews,
      staleFailure,
    }
  })
  expect(result.savedAmount).toBe('10.00')
  expect(result.costs.linkedPaymentCharge).toBe('10.00')
  expect(result.costs.needsReview).toBe(true)
  expect(result.sourceCosts.needsReview).toBe(true)
  expect(result.reviews[0].current.amount).toBe('8.00')
  expect(result.staleFailure).toContain('source payment changed')
})

test('skipping frozen receiving goods aborts until the linked scope is explicitly removed', async ({
  extension,
}) => {
  const page = await openLibrary(extension, [
    snapshot('8001'),
    snapshot('8002'),
  ])
  const result = await page.evaluate(async () => {
    await library.linkPayment('8001', {
      id: 'service',
      sourceOrderId: '8002',
      reason: 'Recorded service',
    })
    const before = await library.exportBackup()
    let failure
    try {
      await library.setPackingExcluded('8001', ['1'], true)
    } catch (error) {
      failure = error.message
    }
    const rejected = await library.exportBackup()
    await library.unlinkPayment('8001', 'service')
    const skipped = await library.setPackingExcluded('8001', ['1'], true)
    return {
      failure,
      before: before.orders,
      rejected: rejected.orders,
      skipped,
    }
  })
  expect(result.failure).toContain('eligible goods')
  expect(result.rejected).toEqual(result.before)
  expect(result.skipped.packingExcludedEntryIds).toEqual(['1'])
})

test('reviewing newly added payment rows never claims a newer user-authored skip', async ({
  extension,
}) => {
  const page = await openLibrary(extension, [
    snapshot('9001'),
    snapshot('9002'),
  ])
  const addedRows = snapshot('9002', { fee: true })
  addedRows.observedAt = '2026-10-02T12:00:00.000Z'
  const result = await page.evaluate(async (source) => {
    const linked = await library.linkPayment('9001', {
      id: 'service',
      sourceOrderId: '9002',
      reason: 'Recorded service',
    })
    await library.setPackingExcluded('9002', ['1'], false)
    await library.setPackingExcluded('9002', ['1'], true)
    await library.saveSnapshot(source)
    const reviewed = await library.setPaymentLinks('9001', [
      { ...linked.paymentLinks[0], reason: 'Reviewed added source row' },
    ])
    const owned = reviewed.paymentLinks[0].packingExclusions.entryIds
    await library.unlinkPayment('9001', 'service')
    const after = await library.exportBackup()
    return {
      owned,
      source: after.orders.find((record) => record.snapshot.orderId === '9002'),
    }
  }, addedRows)
  expect(result.owned).toEqual(['2'])
  expect(result.source.packingExcludedEntryIds).toEqual(['1'])
})

test('split-source ownership combines different row clocks and preserves later user edits in either owner set', async ({
  extension,
}) => {
  const cases = [null, '1', '2'].map((userRow, index) => ({
    userRow,
    first: String(11001 + index * 10),
    source: String(11002 + index * 10),
    second: String(11003 + index * 10),
  }))
  const page = await openLibrary(
    extension,
    cases.flatMap(({ first, source, second }) => [
      snapshot(first),
      snapshot(source),
      snapshot(second),
    ])
  )
  const refreshed = cases.map(({ source }) => {
    const value = snapshot(source, { fee: true })
    value.observedAt = '2026-10-02T12:00:00.000Z'
    return value
  })
  const result = await page.evaluate(
    async ({ cases, refreshed }) => {
      const results = []
      for (const [index, entry] of cases.entries()) {
        await library.linkPayment(entry.first, {
          id: `first-${index}`,
          sourceOrderId: entry.source,
          amount: '4.00',
          reason: 'First recorded share',
        })
        const second = await library.linkPayment(entry.second, {
          id: `second-${index}`,
          sourceOrderId: entry.source,
          amount: '6.00',
          reason: 'Second recorded share',
        })
        await library.saveSnapshot(refreshed[index])
        await library.setPaymentLinks(entry.second, [
          { ...second.paymentLinks[0], reason: 'Reviewed added payment row' },
        ])
        if (entry.userRow) {
          await library.setPackingExcluded(entry.source, [entry.userRow], false)
          await library.setPackingExcluded(entry.source, [entry.userRow], true)
        }
        await library.unlinkPayment(entry.first, `first-${index}`)
        const midway = await library.exportBackup()
        const surviving = midway.orders.find(
          (record) => record.snapshot.orderId === entry.second
        ).paymentLinks[0]
        const sourceMidway = midway.orders.find(
          (record) => record.snapshot.orderId === entry.source
        )
        const owned = surviving.packingExclusions.entryIds
        const clocks = owned.map(
          (id) =>
            sourceMidway.packingExclusionsPartialClocks?.[id] ||
            sourceMidway.packingExclusionsUpdatedAt
        )
        await library.unlinkPayment(entry.second, `second-${index}`)
        const after = await library.exportBackup()
        results.push({
          userRow: entry.userRow,
          owned,
          clocks,
          ownerClock: surviving.packingExclusions.updatedAt,
          remaining: after.orders.find(
            (record) => record.snapshot.orderId === entry.source
          ).packingExcludedEntryIds,
        })
      }
      return results
    },
    { cases, refreshed }
  )
  expect(result[0].owned.sort()).toEqual(['1', '2'])
  expect(
    result[0].clocks.every((clock) => clock === result[0].ownerClock)
  ).toBe(true)
  expect(result[0].remaining).toEqual([])
  expect(result[1].owned).toEqual(['2'])
  expect(result[1].remaining).toEqual(['1'])
  expect(result[2].owned).toEqual(['1'])
  expect(result[2].remaining).toEqual(['2'])
})
