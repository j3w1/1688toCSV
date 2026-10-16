import { expect } from '@playwright/test'

export async function revealCopyActions(page) {
  const host = page.locator('.compact-copy-actions:visible')
  if (!(await host.locator('.copy-actions-panel').isVisible()))
    await host.locator('.copy-actions-trigger').click()
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
