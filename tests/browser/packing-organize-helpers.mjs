import { expect } from './extension-fixture.mjs'

export async function openOrganizing(page) {
  const view = page.locator('#packing-view')
  const open = view.getByRole('button', { name: 'Organize', exact: true })
  if (await open.isVisible()) await open.click()
  await expect(view.locator('.packing-organize-toolbar')).toBeVisible()
  await view.locator('[data-action="organize-groups"]').click()
  return view
}

export async function finishOrganizing(page) {
  const done = page
    .locator('#packing-view')
    .getByRole('button', { name: 'Done', exact: true })
  if (await done.isVisible()) await done.click()
}

/** Select the same source group/variant through the user-visible Organize flow. */
export async function packingRemovalAction(container, kind = 'group') {
  const page = container.page()
  const identity = await container.evaluate((node, kind) => {
    const group = node.matches('.preparation-group')
      ? node
      : node.closest('.preparation-group') ||
        node.querySelector('.preparation-group')
    const variant =
      kind === 'product'
        ? node.matches('[data-variant-id]')
          ? node
          : node.querySelector('[data-variant-id]')
        : null
    return {
      groupId: group.dataset.groupId,
      orderId: group.closest('[data-packing-order]').dataset.packingOrder,
      variantId: variant?.dataset.variantId,
    }
  }, kind)
  const view = await openOrganizing(page)
  const group = view.locator(
    `[data-packing-order=${JSON.stringify(identity.orderId)}] .packing-organize-group[data-group-id=${JSON.stringify(identity.groupId)}]`
  )
  await group.scrollIntoViewIfNeeded()
  if (kind === 'product')
    await group.getByRole('button', { name: 'Products', exact: true }).click()
  const clear = view.getByRole('button', {
    name: 'Clear selection',
    exact: true,
  })
  if (await clear.isEnabled()) await clear.click()
  const selected =
    kind === 'product'
      ? view.locator(
          `.packing-organize-product[data-variant-id=${JSON.stringify(identity.variantId)}]`
        )
      : group
  await selected.locator('input[type="checkbox"]').check()
  const remove = view.getByRole('button', {
    name: 'Remove from packing',
    exact: true,
  })
  await expect(remove).toBeEnabled()
  return remove
}
