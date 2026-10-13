import { test, expect } from './extension-fixture.mjs'

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
  expect(await mutations(page)).toEqual([
    {
      type: 'IMPORT_START',
      data: { scope: 'selected', orderIds: ['10001', '10002'] },
    },
  ])
  await expect(page.getByText(/0 saved \/ 2 discovered/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Import selected', exact: true })
  ).toBeDisabled()
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
  await expect(
    page.getByRole('button', { name: 'Pause import', exact: true })
  ).toBeVisible()
  expect((await mutations(page)).map((x) => x.type)).toEqual([
    'IMPORT_START',
    'IMPORT_PAUSE',
    'IMPORT_RESUME',
  ])
  await page.getByRole('button', { name: 'Spreadsheet ↗', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(
    'Spreadsheet tab requested'
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
  await page.getByRole('button', { name: 'Spreadsheet ↗', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(
    'spreadsheet could not open in a new tab'
  )
  await expect(page.getByRole('status')).toContainText('saved orders are kept')
  await expect(
    page.getByText('completed · 1 saved / 1 discovered', { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Spreadsheet address' })
  ).toBeVisible()
  await page.setViewportSize({ width: 320, height: 800 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page
    .getByRole('button', { name: 'Open spreadsheet here', exact: true })
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
    page.getByRole('button', { name: 'Open spreadsheet here', exact: true })
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
    .getByRole('button', { name: 'Resume 667 orders', exact: true })
    .click()
  expect(await mutations(page)).toEqual([
    { type: 'IMPORT_RESUME', data: { jobId: 'legacy-bulk' } },
  ])
})
