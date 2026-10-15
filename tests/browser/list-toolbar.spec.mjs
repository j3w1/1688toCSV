import { test, expect } from './extension-fixture.mjs'
import { readFile } from 'node:fs/promises'
import { createImportReport } from '../../src/import-report.js'

async function setup(extension, jobs = []) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async (jobs) => {
    const { mountListToolbar } = await import('/src/list-toolbar.js')
    const state = (window.toolbarTest = {
      jobs,
      calls: [],
      list: {
        total: 667,
        pageSize: 10,
        filterKey: 'synthetic-filter',
        orders: [
          { orderId: '10001', selected: true },
          { orderId: '10002', selected: true },
        ],
      },
    })
    window.toolbar = mountListToolbar(document, {
      readList: () => structuredClone(state.list),
      send: async (type, data) => {
        state.calls.push({ type, data })
        if (type === 'OPEN_LIBRARY' && state.blockLibrary)
          throw new Error(
            'Owl extension-created tab was blocked before presentation.'
          )
        if (type === 'IMPORT_STATUS')
          return { jobs: structuredClone(state.jobs) }
        if (type === 'IMPORT_REPORT') {
          if (!state.reportValue)
            throw new Error(
              'This import is no longer available. Refresh the order list.'
            )
          return structuredClone(state.reportValue)
        }
        if (type === 'IMPORT_START') {
          const job = {
            id: 'synthetic-job',
            state: 'running',
            phase: data.scope === 'all' ? 'scan' : 'details',
            page: 0,
            total: data.orderIds?.length || state.list.total,
            discovered: data.orderIds?.length || 0,
            completed: 0,
            failed: 0,
          }
          state.jobs = [job]
          return structuredClone(job)
        }
        if (type === 'IMPORT_PAUSE') state.jobs[0].state = 'paused'
        if (type === 'IMPORT_RESUME') {
          state.jobs[0].state = 'running'
          state.jobs[0].error = ''
        }
        return true
      },
    })
  }, jobs)
  return page
}
async function mutations(page) {
  return page.evaluate(() =>
    toolbarTest.calls.filter((call) => call.type !== 'IMPORT_STATUS')
  )
}

test('the list toolbar downloads complete import reports in every job state without starting work and releases files', async ({
  extension,
}) => {
  const page = await setup(extension)
  await page.evaluate(() => {
    window.reportUrls = []
    const create = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (blob) => {
      const url = create(blob)
      reportUrls.push(url)
      return url
    }
    const timeout = window.setTimeout.bind(window)
    window.setTimeout = (callback, delay, ...args) => {
      if (delay === 60000) window.releaseReportOnTimeout = callback
      return timeout(callback, delay, ...args)
    }
  })
  for (const state of [
    'running',
    'paused',
    'completed-with-errors',
    'completed',
  ]) {
    const job = {
      id: 'synthetic-report',
      kind: 'import',
      scope: 'all',
      phase: 'details',
      state,
      total: 667,
      page: 67,
      pageSize: 10,
      createdAt: '2026-10-14T12:00:00.000Z',
      updatedAt: '2026-10-14T12:01:00.000Z',
      filterKey: 'excluded private filter',
      orders: Array.from({ length: 667 }, (_, index) => ({
        orderId: String(10000 + index),
        sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${10000 + index}`,
        state:
          state === 'completed' || index < 21
            ? 'done'
            : index < 24
              ? 'failed'
              : state === 'completed-with-errors'
                ? 'done'
                : 'pending',
        ...(index >= 21 && index < 24
          ? {
              error:
                state === 'completed' ? '' : 'Synthetic reconciliation failure',
              lastFailure: {
                at: '2026-10-14T12:01:00.000Z',
                message: 'Synthetic reconciliation failure',
                diagnostics: {
                  version: 1,
                  fields: [{ label: '原价总计', value: '¥30.00' }],
                  products: { count: 2, gross: '25.00', discount: '1.00' },
                },
              },
            }
          : {}),
      })),
    }
    const value = createImportReport(job, 'test')
    await page.evaluate(
      async ({ job, value }) => {
        toolbarTest.jobs = [
          {
            ...job,
            discovered: value.counts.discovered,
            completed: value.counts.saved,
            failed: value.counts.failed,
          },
        ]
        toolbarTest.reportValue = value
        await toolbar.refresh()
      },
      { job, value }
    )
    const pending = page.waitForEvent('download')
    await page
      .getByRole('button', { name: 'Save import report', exact: true })
      .click()
    const download = await pending
    expect(download.suggestedFilename()).toMatch(
      /^1688-import-report-\d{4}-\d{2}-\d{2}\.json$/
    )
    expect(await download.failure()).toBeNull()
    const files = await extension.inspector.evaluate(() =>
      chrome.downloads.search({})
    )
    const latest = files.reduce((a, b) => (a.id > b.id ? a : b))
    expect(latest.state).toBe('complete')
    expect(JSON.parse(await readFile(latest.filename, 'utf8'))).toEqual(value)
    await expect(page.getByRole('status')).toContainText(
      'Import report save requested'
    )
    expect(
      (await mutations(page)).every(
        (call) => call.type === 'IMPORT_REPORT' && call.data.jobId === job.id
      )
    ).toBe(true)
    expect(await page.evaluate(() => toolbarTest.jobs[0].state)).toBe(state)
    const file = await page.evaluate(() => reportUrls.at(-1))
    expect(
      await page.evaluate(async (url) => (await fetch(url)).ok, file)
    ).toBe(true)
    if (state !== 'completed') {
      await page.evaluate(() => releaseReportOnTimeout())
      expect(
        await page.evaluate(async (url) => {
          try {
            await fetch(url)
            return false
          } catch {
            return true
          }
        }, file)
      ).toBe(true)
    }
  }
  // A stale button surfaces the durable-job error without saving or resuming.
  const before = await extension.inspector.evaluate(() =>
    chrome.downloads.search({})
  )
  await page.evaluate(() => {
    toolbarTest.reportValue = null
  })
  await page
    .getByRole('button', { name: 'Save import report', exact: true })
    .click()
  await expect(page.getByRole('status')).toHaveText(
    'This import is no longer available. Refresh the order list.'
  )
  expect(
    await extension.inspector.evaluate(() => chrome.downloads.search({}))
  ).toEqual(before)
  const remainingFile = await page.evaluate(() => reportUrls.at(-1))
  await page.evaluate(() => toolbar.dispose())
  expect(
    await page.evaluate(async (url) => {
      try {
        await fetch(url)
        return false
      } catch {
        return true
      }
    }, remainingFile)
  ).toBe(true)
  expect(extension.unexpectedRequests).toEqual([])
})

test('a bulk scan paused before discovery still confirms the complete requested total', async ({
  extension,
}) => {
  const page = await setup(extension, [
    {
      id: 'unscanned-bulk',
      state: 'paused',
      phase: 'scan',
      page: 0,
      total: 667,
      discovered: 0,
      completed: 0,
    },
  ])
  await page
    .getByRole('button', { name: 'Resume / retry', exact: true })
    .click()
  await expect(
    page.getByText('This job covers 667 orders.', { exact: false })
  ).toBeVisible()
  await expect(
    page.getByText('0 saved; 667 remaining.', { exact: false })
  ).toBeVisible()
  expect(await mutations(page)).toEqual([])
})

test('bulk import is secondary and requires confirmation of the exact filter scope', async ({
  extension,
}) => {
  const page = await setup(extension)
  await expect(
    page.getByRole('button', { name: 'Import selected', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Import all matching…', exact: true })
  ).not.toBeVisible()
  await page.getByText('More import options', { exact: true }).click()
  await page
    .getByRole('button', { name: 'Import all matching…', exact: true })
    .click()
  await expect(
    page.getByText('Import 667 orders across 67 pages?', { exact: true })
  ).toBeVisible()
  expect(await mutations(page)).toEqual([])
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await mutations(page)).toEqual([])
  await page
    .getByRole('button', { name: 'Import all matching…', exact: true })
    .click()
  await page.evaluate(() => {
    toolbarTest.list.filterKey = 'changed'
  })
  await page
    .getByRole('button', { name: 'Import all 667 orders', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText(
    'filters or order count changed'
  )
  expect(await mutations(page)).toEqual([])
  await page
    .getByRole('button', { name: 'Import all matching…', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Import all 667 orders', exact: true })
    .click()
  expect(await mutations(page)).toEqual([
    {
      type: 'IMPORT_START',
      data: {
        scope: 'all',
        expectedScope: { filterKey: 'changed', total: 667, pageSize: 10 },
      },
    },
  ])
  await expect(
    page.getByRole('button', { name: 'Pause import', exact: true })
  ).toBeVisible()
})

test('selected import shows progress, errors and working pause/resume on the list', async ({
  extension,
}) => {
  const page = await setup(extension)
  await page
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  expect(await mutations(page)).toEqual([])
  await page
    .getByRole('button', { name: 'Import 2 selected orders', exact: true })
    .click()
  expect(await mutations(page)).toEqual([
    {
      type: 'IMPORT_START',
      data: {
        scope: 'selected',
        orderIds: ['10001', '10002'],
        expectedScope: {
          filterKey: 'synthetic-filter',
          total: 667,
          pageSize: 10,
        },
      },
    },
  ])
  await expect(page.getByText(/0 saved \/ 2 discovered/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Import selected', exact: true })
  ).toBeDisabled()
  await page.evaluate(async () => {
    toolbarTest.jobs[0].failed = 1
    await toolbar.refresh()
  })
  const continuing = page.getByText(/1 failed; continuing/)
  await expect(continuing).toBeVisible()
  await expect(continuing).not.toHaveClass('error')
  await page.getByRole('button', { name: 'Pause import', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Import paused')
  await page.evaluate(async () => {
    toolbarTest.jobs[0].error = 'Synthetic page failure'
    await toolbar.refresh()
  })
  await expect(page.getByText(/Synthetic page failure/)).toBeVisible()
  await page
    .getByRole('button', { name: 'Resume / retry', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Resume 2 remaining orders', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Pause import', exact: true })
  ).toBeVisible()
  expect((await mutations(page)).map((x) => x.type)).toEqual([
    'IMPORT_START',
    'IMPORT_PAUSE',
    'IMPORT_RESUME',
  ])
  await page
    .getByRole('button', { name: 'Open Workspace', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText(
    'Workspace tab requested'
  )
})

test('blocked spreadsheet creation keeps completed import visible and offers current-tab navigation', async ({
  extension,
}) => {
  const page = await setup(extension, [
    {
      id: 'saved',
      state: 'completed',
      phase: 'details',
      total: 1,
      discovered: 1,
      completed: 1,
      failed: 0,
    },
  ])
  await page.evaluate(() => {
    toolbarTest.blockLibrary = true
  })
  await page
    .getByRole('button', { name: 'Open Workspace', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText(
    'workspace could not open in a new tab'
  )
  await expect(page.getByRole('status')).toContainText('saved orders are kept')
  await expect(
    page.getByText('completed · 1 saved / 1 discovered · 0 remaining', {
      exact: true,
    })
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Workspace address' })
  ).toBeVisible()
  await page.setViewportSize({ width: 320, height: 800 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page
    .getByRole('button', { name: 'Open Workspace here', exact: true })
    .click()
  expect((await mutations(page)).map((call) => call.type)).toEqual([
    'OPEN_LIBRARY',
    'OPEN_LIBRARY_HERE',
  ])
  await page.evaluate(async () => {
    toolbarTest.jobs[0].state = 'running'
    await toolbar.refresh()
  })
  await expect(
    page.getByRole('button', { name: 'Open Workspace here', exact: true })
  ).toBeDisabled()
})

test('an old bulk job also requires confirmation before resume and controls fit narrow screens', async ({
  extension,
}) => {
  const page = await setup(extension, [
    {
      id: 'legacy-bulk',
      state: 'paused',
      phase: 'details',
      page: 67,
      total: 667,
      discovered: 667,
      completed: 0,
      error: 'Previous import stopped',
    },
  ])
  await page.setViewportSize({ width: 320, height: 800 })
  await page
    .getByRole('button', { name: 'Resume / retry', exact: true })
    .click()
  await expect(
    page.getByText('Resume the bulk import?', { exact: true })
  ).toBeVisible()
  expect(await mutations(page)).toEqual([])
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await mutations(page)).toEqual([])
  await page
    .getByRole('button', { name: 'Resume / retry', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Resume 667 remaining orders', exact: true })
    .click()
  expect(await mutations(page)).toEqual([
    { type: 'IMPORT_RESUME', data: { jobId: 'legacy-bulk' } },
  ])
})

test('selected-order confirmation rejects a changed selection and single orders start directly', async ({
  extension,
}) => {
  const page = await setup(extension)
  await page
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  await page.evaluate(() => {
    toolbarTest.list.orders[1].selected = false
  })
  await page
    .getByRole('button', { name: 'Import 2 selected orders', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText(
    'selected orders changed'
  )
  expect(await mutations(page)).toEqual([])
  await page
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  expect((await mutations(page))[0].data.orderIds).toEqual(['10001'])
})

test('resuming a partial import confirms only its unsaved remainder', async ({
  extension,
}) => {
  const page = await setup(extension, [
    {
      id: 'part-done',
      state: 'paused',
      phase: 'details',
      scope: 'all',
      total: 67,
      discovered: 67,
      completed: 60,
      failed: 2,
    },
  ])
  await page
    .getByRole('button', { name: 'Resume / retry', exact: true })
    .click()
  await expect(
    page.getByText('60 saved; 7 remaining.', { exact: false })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Resume 7 remaining orders', exact: true })
  ).toBeVisible()
  expect(await mutations(page)).toEqual([])
})
