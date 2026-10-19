import { test, expect } from './extension-fixture.mjs'

async function putJob(
  extension,
  state,
  completed = 0,
  id = 'synthetic-activity'
) {
  await extension.inspector.evaluate(
    ({ state, completed, id }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('1688-order-library')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('jobs', 'readwrite')
          tx.objectStore('jobs').put({
            id,
            state,
            kind: 'import',
            scope: 'selected',
            phase: 'details',
            updatedAt: new Date().toISOString(),
            total: 2,
            orders: [
              { orderId: '10001', state: completed >= 1 ? 'done' : 'pending' },
              {
                orderId: '5127523670009019539',
                state:
                  state === 'completed-with-errors'
                    ? 'failed'
                    : completed >= 2
                      ? 'done'
                      : 'pending',
                ...(state === 'completed-with-errors'
                  ? { error: 'Synthetic source mismatch' }
                  : {}),
              },
            ],
          })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
        }
      }),
    { state, completed, id }
  )
}

test('Activity uses distinct running and unread states and reading persists without modifying import jobs', async ({
  extension,
}) => {
  await putJob(extension, 'completed', 2)
  const page = await extension.context.newPage()
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const button = page.locator('#activity-open')
  await expect(button).toHaveAttribute('data-activity-state', 'unread')
  await expect(page.locator('#activity-count')).toHaveText('1 new')
  const unreadColor = await page
    .locator('#activity-count')
    .evaluate((node) => getComputedStyle(node).backgroundColor)
  await button.click()
  await expect(button).toHaveAttribute('data-activity-state', 'idle')
  await page
    .getByRole('button', { name: 'Close activity', exact: true })
    .click()
  await page.reload()
  await expect(button).toHaveAttribute('data-activity-state', 'idle')
  // A reload wakes the real import worker, which correctly pauses this raw
  // fixture without an owned reader tab. Publish the checkpoint in place.
  await putJob(extension, 'running', 1)
  await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'LIBRARY_UPDATED' })
  )
  // Read the state, text and paint together so the comparison cannot combine
  // two different job checkpoints across separate browser round trips.
  await expect
    .poll(() =>
      button.evaluate((node, unreadColor) => {
        const badge = node.querySelector('#activity-count')
        const background = getComputedStyle(badge).backgroundColor
        return {
          state: node.dataset.activityState,
          text: badge.textContent,
          background,
          differentFromUnread: background !== unreadColor,
        }
      }, unreadColor)
    )
    .toMatchObject({
      state: 'running',
      text: 'Running',
      differentFromUnread: true,
    })
  // Publish a paused checkpoint before testing the unread transition.
  await putJob(extension, 'paused', 1)
  await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'LIBRARY_UPDATED' })
  )
  await expect(button).toHaveAttribute('data-activity-state', 'unread')
  await button.click()
  await expect(page.locator('#activity-drawer')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('1688-workspace-activity-read'))[
            'synthetic-activity'
          ]
      )
    )
    .toBe('["paused",0,""]')
  await page
    .getByRole('button', { name: 'Close activity', exact: true })
    .click()
  await expect(page.locator('#activity-drawer')).not.toBeVisible()
  await putJob(extension, 'completed', 2)
  await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'LIBRARY_UPDATED' })
  )
  await expect(button).toHaveAttribute('data-activity-state', 'unread', {
    timeout: 10000,
  })
  await page.locator('#language-toggle [data-language=es]').click()
  await expect(page.locator('#activity-count')).toHaveText('1 nuevas')
  const job = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
  )
  expect(job.data.jobs[0].state).toBe('completed')
  expect(extension.unexpectedRequests).toEqual([])
})

test('Activity failures show the complete copyable order number with a new-tab source link', async ({
  extension,
}) => {
  await putJob(extension, 'completed-with-errors', 1)
  const page = await extension.context.newPage()
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await page.locator('#activity-open').click()
  const failure = page.locator('.job-error-line')
  await expect(failure).toContainText('5127523670009019539')
  await expect(failure.getByRole('button')).toHaveAccessibleName(
    'Copy order number: 5127523670009019539'
  )
  await expect(failure.getByRole('link')).toHaveAttribute(
    'href',
    /orderId=5127523670009019539$/
  )
  await expect(failure.getByRole('link')).toHaveAttribute('target', '_blank')
})

test('detail importing panel stays compact across remounts and progress updates without pausing', async ({
  extension,
}) => {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.setViewportSize({ width: 300, height: 650 })
  await page.evaluate(async () => {
    const { mountPageDownload } = await import('/src/page-download.js')
    window.panelCalls = []
    window.mountDetail = () => {
      window.detailPanel = mountPageDownload(
        document,
        () => ({ csv: 'a', filename: 'a.csv' }),
        { pauseImport: async (id) => panelCalls.push(id) }
      )
      detailPanel.updateProgress({
        id: 'synthetic-detail',
        state: 'running',
        phase: 'details',
        total: 5,
        completed: 2,
        failed: 0,
      })
    }
    mountDetail()
  })
  const panel = page.getByRole('complementary', { name: '1688toCSV' })
  await panel
    .getByRole('button', { name: 'Minimize import panel', exact: true })
    .click()
  await expect(panel.locator('.floating-panel-summary')).toHaveText(
    'Importing · 2/5 saved'
  )
  await expect(
    panel.getByRole('link', { name: 'Download CSV', exact: true })
  ).not.toBeVisible()
  await page.evaluate(() => mountDetail())
  await expect(
    panel.getByRole('button', { name: 'Restore import panel', exact: true })
  ).toBeVisible()
  await page.evaluate(() =>
    detailPanel.updateProgress({
      id: 'synthetic-detail',
      state: 'running',
      phase: 'details',
      total: 5,
      completed: 4,
      failed: 0,
    })
  )
  await expect(panel.locator('.floating-panel-summary')).toHaveText(
    'Importing · 4/5 saved'
  )
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(panel).toHaveCSS('background-color', 'rgb(36, 33, 29)')
  await panel
    .getByRole('button', { name: 'Restore import panel', exact: true })
    .focus()
  await page.keyboard.press('Enter')
  await expect(
    panel.getByRole('link', { name: 'Download CSV', exact: true })
  ).toBeVisible()
  expect(await page.evaluate(() => panelCalls)).toEqual([])
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})
