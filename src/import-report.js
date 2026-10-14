import { detailUrl } from './order-list.js'

/** A local diagnostic snapshot; deliberately excludes page content and filters. */
export function createImportReport(
  job,
  extensionVersion,
  exportedAt = new Date().toISOString()
) {
  const orders = (job.orders || []).map((order) => ({
    orderId: order.orderId,
    sourceUrl: detailUrl(order.sourceUrl, order.orderId),
    state: order.state,
    expectedRows: order.expectedRows ?? null,
    error: order.error || '',
  }))
  const saved = orders.filter((order) => order.state === 'done').length
  const failed = orders.filter((order) => order.state === 'failed').length
  const expected = Math.max(job.total || 0, orders.length)
  const errors = new Map()
  for (const order of orders.filter((order) => order.state === 'failed')) {
    const message = order.error || 'Could not read order'
    errors.set(message, (errors.get(message) || 0) + 1)
  }
  return {
    format: '1688-import-report',
    version: 1,
    extensionVersion,
    exportedAt,
    job: {
      id: job.id,
      kind: job.kind,
      scope: job.scope,
      state: job.state,
      phase: job.phase,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      scannedPages: job.page || 0,
      totalPages:
        job.scope === 'all' && job.pageSize
          ? Math.ceil(expected / job.pageSize)
          : null,
      error: job.error || '',
    },
    counts: {
      expected,
      discovered: orders.length,
      saved,
      failed,
      pending: orders.filter((order) => order.state === 'pending').length,
      undiscovered: expected - orders.length,
      remaining: expected - saved,
    },
    errors: [...errors].map(([message, count]) => ({ message, count })),
    orders,
  }
}
