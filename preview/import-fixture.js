// Synthetic progress only. Never imported into the extension build.
export function demoImportProgress() {
  return {
    id: 'demo-import',
    state: 'running',
    phase: 'details',
    total: 24,
    completed: 17,
    failed: 1,
    discovered: 24,
    collectedRows: 136,
    countedOrders: 17,
    currentOrderId: '9990000000000000019',
    detailStage: 'reading',
    detailStartedAt: Date.now() - 8000,
    detailAttempts: 1,
    latestResult: {
      orderId: '9990000000000000018',
      outcome: 'saved',
      rows: 8,
      sellerName: 'Example homeware shop',
      payable: '168.40',
      at: new Date(Date.now() - 10000).toISOString(),
    },
  }
}
