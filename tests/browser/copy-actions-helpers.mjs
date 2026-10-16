export async function revealCopyActions(page) {
  const host = page.locator('.compact-copy-actions:visible')
  if (!(await host.locator('.copy-actions-panel').isVisible()))
    await host.locator('.copy-actions-trigger').click()
}
