import { expect } from '@playwright/test'

export async function revealCopyActions(page) {
  const host = page.locator('.compact-copy-actions:visible').filter({
    has: page.locator('.copy-actions-trigger[data-icon="copy"]'),
  })
  if (!(await host.locator('.copy-actions-panel').isVisible()))
    await host.locator('.copy-actions-trigger').click()
}

export async function revealGroupingActions(page) {
  const panel = page.locator('.packing-grouping-panel')
  if (!(await panel.isVisible()))
    await page
      .getByRole('button', { name: 'Grouping tools', exact: true })
      .click()
  return panel
}

export async function clickGroupingAction(page, name) {
  const panel = await revealGroupingActions(page)
  const action = panel.getByRole('button', { name, exact: true })
  await expect(action).toBeEnabled()
  await action.click()
}

export async function copyCurrentImageBatch(page) {
  const dialog = page.locator('.image-copy-dialog')
  const copy = dialog.getByRole('button', {
    name: 'Copy current batch',
    exact: true,
  })
  await expect(copy).toBeEnabled()
  await copy.click()
  await expect(dialog.locator('.image-copy-progress')).toContainText(
    'Paste into Excel'
  )
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).not.toBeVisible()
}
