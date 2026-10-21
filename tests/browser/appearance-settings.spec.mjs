import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

async function openWorkspace(extension) {
  const records = (
    await extension.inspector.evaluate(
      `(${createDemoRecords.toString()})(document)`
    )
  ).slice(0, 1)
  records[0].snapshot.status = '待付款'
  for (const item of records[0].snapshot.items) {
    item.title = '合成玻璃罐'
    item.skuProperties = [{ label: '颜色', value: '黑色', raw: '颜色：黑色' }]
    item.description = '合成玻璃罐\n颜色：黑色'
  }
  const restored = await extension.inspector.evaluate(
    (orders) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders,
          history: [],
          images: [],
        },
      }),
    records
  )
  expect(restored.ok, restored.error).toBe(true)
  const page = await extension.context.newPage()
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    3
  )
  return page
}
async function settings(page, tab) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await dialog.getByRole('tab', { name: tab, exact: true }).click()
  return dialog
}
async function save(dialog) {
  await dialog
    .getByRole('button', { name: 'Save settings', exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
}

test('tag picker ranks keyboard choices and Settings randomizes colors or removes a used tag with its scope', async ({
  extension,
}) => {
  const page = await openWorkspace(extension)
  let dialog = await settings(page, 'Tags')
  let catalog = dialog.locator('[data-tag-scope=order]')
  for (const name of ['Fragile', 'Fragile sale', 'Spare']) {
    await catalog.getByLabel('New order tag', { exact: true }).fill(name)
    await catalog
      .getByRole('button', { name: 'Create tag', exact: true })
      .click()
  }
  const oldTag = await catalog
    .getByLabel('Fragile background · Dark', { exact: true })
    .inputValue()
  await catalog
    .getByRole('button', { name: 'Randomize Fragile colors', exact: true })
    .click()
  const newTag = await catalog
    .getByLabel('Fragile background · Dark', { exact: true })
    .inputValue()
  await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click()
  const oldLabel = await dialog
    .getByLabel('Dates · Dark', { exact: true })
    .inputValue()
  await dialog
    .getByRole('button', { name: 'Randomize Dates colors', exact: true })
    .click()
  const newLabel = await dialog
    .getByLabel('Dates · Dark', { exact: true })
    .inputValue()
  expect(newLabel).not.toBe(oldLabel)
  expect(newTag).not.toBe(oldTag)
  await save(dialog)
  for (const toggle of await page
    .locator('.month-toggle[aria-expanded=false]')
    .all())
    await toggle.click()
  await page.locator('.order-card-meta').first().dblclick()
  dialog = page.locator('#order-details')
  const input = dialog.getByRole('combobox', { name: 'Tags', exact: true })
  await input.fill('frag')
  await expect(
    dialog.getByRole('option', { name: 'Fragile', exact: true })
  ).toHaveAttribute('aria-selected', 'true')
  await input.press('ArrowDown')
  await expect(
    dialog.getByRole('option', { name: 'Fragile sale', exact: true })
  ).toHaveAttribute('aria-selected', 'true')
  await input.press('Enter')
  await expect(dialog.locator('.order-tag-selected')).toContainText(
    'Fragile sale'
  )
  await input.fill('fra')
  await input.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(input).toHaveAttribute('aria-expanded', 'false')
  await input.press('ArrowDown')
  await expect(
    dialog.getByRole('option', { name: 'Fragile', exact: true })
  ).toHaveAttribute('aria-selected', 'true')
  await input.press('Enter')
  await dialog
    .getByRole('button', { name: 'Close order details', exact: true })
    .click()
  dialog = await settings(page, 'Appearance')
  catalog = dialog.locator('[data-tag-scope=order]')
  await expect(dialog.getByLabel('Dates · Dark', { exact: true })).toHaveValue(
    newLabel
  )
  await dialog.getByRole('tab', { name: 'Tags', exact: true }).click()
  await expect(
    catalog.getByLabel('Fragile background · Dark', { exact: true })
  ).toHaveValue(newTag)
  await catalog
    .getByRole('button', { name: 'Delete tag Fragile everywhere', exact: true })
    .click()
  const confirm = page.getByRole('dialog', {
    name: 'Delete tag everywhere?',
    exact: true,
  })
  await expect(confirm).toContainText('1 orders')
  await expect(confirm.locator('.order-tag-badge')).toHaveText('Fragile')
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(
    catalog.getByRole('button', {
      name: 'Delete tag Fragile everywhere',
      exact: true,
    })
  ).toBeVisible()
  await catalog
    .getByRole('button', { name: 'Delete tag Fragile everywhere', exact: true })
    .click()
  await confirm
    .getByRole('button', { name: 'Delete tag everywhere', exact: true })
    .click()
  await expect(
    catalog.getByRole('button', {
      name: 'Delete tag Fragile everywhere',
      exact: true,
    })
  ).toHaveCount(0)
  await catalog
    .getByRole('button', { name: 'Delete tag Spare everywhere', exact: true })
    .click()
  await expect(
    catalog.getByRole('button', {
      name: 'Delete tag Spare everywhere',
      exact: true,
    })
  ).toHaveCount(0)
  await expect(confirm).toHaveCount(0)
  await save(dialog)
  await page.reload()
  await expect(page.locator('.order-card-tags')).toContainText('Fragile sale')
  await expect(
    page
      .locator('.order-card-tags .order-tag-badge')
      .filter({ hasText: /^Fragile$/ })
  ).toHaveCount(0)
  expect(extension.unexpectedRequests).toEqual([])
})

test('settings keeps tabs and save visible while reset-all previews recommended colors without renaming tags', async ({
  extension,
}) => {
  const page = await openWorkspace(extension)
  let dialog = await settings(page, 'Appearance')
  await dialog
    .getByLabel('Dark palette', { exact: true })
    .selectOption('terracotta')
  await dialog
    .getByLabel('Awaiting payment · Dark', { exact: true })
    .fill('#abcdef')
  await dialog.getByRole('tab', { name: 'Tags', exact: true }).click()
  await dialog
    .getByLabel('New order tag', { exact: true })
    .fill('Keep this name')
  await dialog
    .locator('[data-tag-scope=order]')
    .getByRole('button', { name: 'Create tag', exact: true })
    .click()
  await dialog
    .getByLabel('Keep this name background · Light', { exact: true })
    .fill('#123456')
  await dialog
    .getByLabel('Keep this name text · Dark', { exact: true })
    .fill('#fedcba')
  const products = dialog.locator('[data-tag-scope=product]')
  await products
    .getByLabel('New product tag', { exact: true })
    .fill('Product draft')
  await products
    .getByRole('button', { name: 'Create tag', exact: true })
    .click()
  await products
    .getByLabel('Product draft background · Dark', { exact: true })
    .fill('#654321')
  await save(dialog)
  dialog = await settings(page, 'Appearance')
  await dialog
    .getByRole('button', {
      name: 'Reset all label and tag colors',
      exact: true,
    })
    .click()
  await expect(
    dialog.getByLabel('Awaiting payment · Dark', { exact: true })
  ).not.toHaveValue('#abcdef')
  await expect(dialog.getByLabel('Dark palette', { exact: true })).toHaveValue(
    'terracotta'
  )
  await expect(dialog.locator('.appearance-reset-status')).toContainText(
    'tag colors in Tags'
  )
  await expect(dialog.locator('.appearance-sample-labels')).toHaveCount(2)
  await dialog.getByRole('tab', { name: 'Tags', exact: true }).click()
  await expect(
    dialog.getByLabel('Keep this name background · Light', { exact: true })
  ).not.toHaveValue('#123456')
  await expect(
    dialog.getByLabel('Keep this name text · Dark', { exact: true })
  ).not.toHaveValue('#fedcba')
  await expect(
    products.getByLabel('Product draft background · Dark', { exact: true })
  ).not.toHaveValue('#654321')
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 })
    for (const tab of [
      'Labels',
      'Product names',
      'Size codes',
      'Product colors',
      'Materials',
      'Tags',
      'Appearance',
      'Data',
    ]) {
      await dialog.getByRole('tab', { name: tab, exact: true }).click()
      const panel = dialog.locator('.settings-panel:not([hidden])')
      await panel.evaluate((node) => {
        node.scrollTop = node.scrollHeight
      })
      const box = await dialog.boundingBox()
      const footer = await dialog.locator('.settings-footer').boundingBox()
      const tabs = await dialog.locator('.settings-tabs').boundingBox()
      expect(footer.y + footer.height).toBeLessThanOrEqual(box.y + box.height)
      expect(footer.y + footer.height).toBeLessThanOrEqual(800)
      expect(tabs.y).toBeGreaterThanOrEqual(box.y)
      expect(
        await panel.evaluate(
          (node) => node.scrollWidth <= node.clientWidth + 1
        ),
        `${tab} panel at ${width}px must contain its content`
      ).toBe(true)
    }
  }
  await save(dialog)
  await page.reload()
  dialog = await settings(page, 'Tags')
  await expect(
    dialog.getByLabel('Keep this name text · Dark', { exact: true })
  ).not.toHaveValue('#fedcba')
  await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click()
  await expect(dialog.getByLabel('Dark palette', { exact: true })).toHaveValue(
    'terracotta'
  )
})

test('Tags review action stays compact beside its heading on desktop and narrow screens', async ({
  extension,
}) => {
  const page = await openWorkspace(extension)
  const dialog = await settings(page, 'Tags')
  const panel = dialog.locator('#settings-panel-tags')
  const header = panel.locator('.settings-tags-heading')
  const heading = header.getByRole('heading', { name: 'Tags', exact: true })
  const review = header.getByRole('button', {
    name: 'Review operational tags',
    exact: true,
  })
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 850 })
    const [titleBox, actionBox, headerBox] = await Promise.all([
      heading.boundingBox(),
      review.boundingBox(),
      header.boundingBox(),
    ])
    expect(actionBox.height).toBeLessThanOrEqual(30)
    expect(actionBox.x).toBeGreaterThan(titleBox.x + titleBox.width)
    expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(
      headerBox.x + headerBox.width + 1
    )
    expect(
      Math.abs(
        titleBox.y + titleBox.height / 2 - actionBox.y - actionBox.height / 2
      )
    ).toBeLessThanOrEqual(1)
    expect(
      await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    ).toBe(true)
  }
})

test('Tags keeps both catalogs separate from Appearance and preserves drafts through tab, language and failed-save changes', async ({
  extension,
}) => {
  const page = await openWorkspace(extension)
  await settings(page, 'Tags')
  const dialog = page.locator('#settings-dialog')
  const appearance = dialog.locator('#settings-panel-appearance')
  const tags = dialog.locator('#settings-panel-tags')
  await expect(appearance.locator('[data-tag-scope]')).toHaveCount(0)
  await expect(tags.locator('[data-tag-scope]')).toHaveCount(2)
  for (const [scope, name] of [
    ['order', 'Draft order'],
    ['product', 'Draft product'],
  ]) {
    const catalog = tags.locator(`[data-tag-scope=${scope}]`)
    await catalog.getByLabel(`New ${scope} tag`, { exact: true }).fill(name)
    await catalog
      .getByRole('button', { name: 'Create tag', exact: true })
      .click()
  }
  await tags
    .getByLabel('Draft order background · Dark', { exact: true })
    .fill('#123456')
  await page.setViewportSize({ width: 1280, height: 900 })
  await tags.getByRole('heading', { name: 'Tags', exact: true }).hover()
  await dialog.screenshot({ path: 'work/settings-tags.png' })
  await tags
    .getByRole('button', { name: 'Rename tag Draft order', exact: true })
    .click()
  const name = tags.locator('.order-tag-name-input')
  await name.fill('Renamed draft order')
  await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click()
  await appearance
    .getByLabel('Dark palette', { exact: true })
    .selectOption('terracotta')
  const other = await extension.context.newPage()
  await other.goto(`${extension.extensionBaseUrl}/library.html`)
  for (const [language, tabName, heading, helper] of [
    [
      'es',
      'Etiquetas',
      'Etiquetas de productos',
      'Renombrar o eliminar etiquetas guardadas',
    ],
    ['zh', '标签', '商品标签', '重命名和删除已保存的标签'],
  ]) {
    await other.locator(`#language-toggle [data-language=${language}]`).click()
    const tab = dialog.getByRole('tab', { name: tabName, exact: true })
    await expect(tab).toBeVisible()
    await tab.click()
    await expect(
      tags.getByRole('heading', { name: heading, exact: true })
    ).toBeVisible()
    await expect(tags).toContainText(helper)
    await expect(name).toHaveValue('Renamed draft order')
  }
  await other.locator('#language-toggle [data-language=en]').click()
  await name.fill('')
  await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click()
  await dialog
    .getByRole('button', { name: 'Save settings', exact: true })
    .click()
  await expect(
    dialog.getByRole('tab', { name: 'Tags', exact: true })
  ).toHaveAttribute('aria-selected', 'true')
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect(name).toHaveValue('')
  await expect(
    tags.getByLabel('Draft order background · Dark', { exact: true })
  ).toHaveValue('#123456')
  await expect(
    appearance.getByLabel('Dark palette', { exact: true })
  ).toHaveValue('terracotta')
  await dialog.locator('.error-notice-close').click()
  await name.fill('Renamed draft order')
  await save(dialog)
  const backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(backup.data.packingPreferences.value.orderTags).toHaveLength(1)
  expect(backup.data.packingPreferences.value.orderTags[0]).toMatchObject({
    name: 'Renamed draft order',
    colors: { dark: '#123456' },
  })
  expect(
    backup.data.packingPreferences.value.productTags.map((tag) => tag.name)
  ).toEqual(['Draft product'])
  expect(backup.data.packingPreferences.value.appearance.darkTheme).toBe(
    'terracotta'
  )
  await other.close()
})

test('reusable tags can be created in Settings and order details, autosave on close, search and keep mode colors', async ({
  extension,
}) => {
  const page = await openWorkspace(extension)
  let dialog = await settings(page, 'Tags')
  await dialog
    .getByLabel('New order tag', { exact: true })
    .fill('Display stock')
  await dialog
    .locator('[data-tag-scope=order]')
    .getByRole('button', { name: 'Create tag', exact: true })
    .click()
  await dialog
    .getByLabel('Display stock background · Dark', { exact: true })
    .fill('#ffcc88')
  await dialog
    .getByLabel('Display stock background · Light', { exact: true })
    .fill('#301800')
  await save(dialog)
  for (const toggle of await page
    .locator('.month-toggle[aria-expanded=false]')
    .all())
    await toggle.click()
  await page.locator('.order-card-meta').first().dblclick()
  dialog = page.locator('#order-details')
  const preventsExit = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
  expect(await preventsExit()).toBe(false)
  await dialog
    .getByRole('combobox', { name: 'Tags', exact: true })
    .fill('Display stock')
  expect(await preventsExit()).toBe(true)
  await dialog
    .getByRole('combobox', { name: 'Tags', exact: true })
    .press('Enter')
  await expect(dialog.locator('.order-tag-selected')).toContainText(
    'Display stock'
  )
  await dialog.getByLabel('Your notes').fill('Last typing before close')
  await dialog
    .getByRole('combobox', { name: 'Tags', exact: true })
    .fill('Locally created')
  await dialog
    .getByRole('button', { name: 'Close order details', exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
  expect(await preventsExit()).toBe(false)
  let badge = page
    .locator('.order-card-tags .order-tag-badge')
    .filter({ hasText: 'Display stock' })
  await expect(badge).toHaveCSS('background-color', 'rgb(255, 204, 136)')
  await expect(badge).toHaveCSS('color', 'rgb(0, 0, 0)')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(badge).toHaveCSS('background-color', 'rgb(48, 24, 0)')
  await expect(badge).toHaveCSS('color', 'rgb(255, 255, 255)')
  await page.reload()
  await page
    .getByRole('combobox', { name: 'Search orders', exact: true })
    .fill('Locally created')
  await expect(page.locator('.order-card')).toHaveCount(1)
  await page.locator('.order-card-meta').first().dblclick()
  await expect(page.getByLabel('Your notes')).toHaveValue(
    'Last typing before close'
  )
  await expect(page.locator('.order-tag-selected')).toContainText(
    'Locally created'
  )
  await page
    .getByRole('button', { name: 'Close order details', exact: true })
    .click()
  dialog = await settings(page, 'Tags')
  await expect(
    dialog.getByLabel('Locally created background · Dark', { exact: true })
  ).toBeVisible()
  expect(extension.unexpectedRequests).toEqual([])
})

test('Settings renames both tag catalogs everywhere, rejects duplicates and retains failed name drafts', async ({
  extension,
}) => {
  const page = await openWorkspace(extension)
  for (const toggle of await page
    .locator('.month-toggle[aria-expanded=false]')
    .all())
    await toggle.click()
  await page.locator('.order-card-meta').first().dblclick()
  let dialog = page.locator('#order-details')
  await dialog
    .getByRole('combobox', { name: 'Tags', exact: true })
    .fill('Fragile')
  await dialog
    .getByRole('button', { name: 'Close order details', exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
  await page.locator('.product-title').first().dblclick()
  dialog = page.locator('.product-details-dialog')
  await dialog
    .getByRole('combobox', { name: 'Product tags', exact: true })
    .fill('Fragile')
  await dialog
    .getByRole('button', { name: 'Close product details', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  dialog = await settings(page, 'Tags')
  for (const scope of ['order', 'product']) {
    const catalog = dialog.locator(`[data-tag-scope=${scope}]`)
    await catalog
      .getByRole('textbox', {
        name: scope === 'order' ? 'New order tag' : 'New product tag',
        exact: true,
      })
      .fill('Occupied')
    await catalog
      .getByRole('button', { name: 'Create tag', exact: true })
      .click()
  }
  await save(dialog)
  dialog = await settings(page, 'Tags')
  const orderCatalog = dialog.locator('[data-tag-scope=order]')
  const oldColors = await orderCatalog
    .locator('[data-tag-name=Fragile] .order-tag-badge')
    .evaluate((node) => ({
      background: getComputedStyle(node).backgroundColor,
      color: getComputedStyle(node).color,
    }))
  await orderCatalog
    .getByRole('button', { name: 'Rename tag Fragile', exact: true })
    .click()
  const orderName = orderCatalog.getByRole('textbox', {
    name: 'New name for Fragile',
    exact: true,
  })
  await orderName.fill('Occupied')
  await orderName.press('Enter')
  await expect(orderName).toBeFocused()
  await expect(orderName).toHaveAttribute('aria-invalid', 'true')
  await expect(orderCatalog.locator('.order-tag-rename-error')).toContainText(
    'already exists'
  )
  await orderName.fill('Order, renamed')
  await orderName.press('Enter')
  await expect(
    orderCatalog.getByRole('button', {
      name: 'Rename tag Order, renamed',
      exact: true,
    })
  ).toBeVisible()
  const renamedBadge = orderCatalog.locator(
    '[data-tag-name="Order, renamed"] .order-tag-badge'
  )
  await expect(renamedBadge).toHaveCSS('background-color', oldColors.background)
  await expect(renamedBadge).toHaveCSS('color', oldColors.color)
  await page.evaluate(() => {
    window.failRename = true
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (
        window.failRename &&
        this.name === 'packingPreferences' &&
        args[0]?.value?.productTags?.some(
          (tag) => tag.name === 'Product renamed'
        )
      )
        throw new DOMException(
          'Synthetic rename storage unavailable',
          'QuotaExceededError'
        )
      return put.apply(this, args)
    }
  })
  const productCatalog = dialog.locator('[data-tag-scope=product]')
  await productCatalog
    .getByRole('button', { name: 'Rename tag Fragile', exact: true })
    .click()
  const productName = productCatalog.getByRole('textbox', {
    name: 'New name for Fragile',
    exact: true,
  })
  await productName.fill('Product renamed')
  await productName.press('Enter')
  await expect(productName).toHaveValue('Product renamed')
  await expect(productName).toBeFocused()
  await expect(productCatalog.locator('.order-tag-rename-error')).toContainText(
    'Synthetic rename storage unavailable'
  )
  let backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(backup.data.orders[0].tags).toEqual(['Order, renamed'])
  expect(Object.values(backup.data.orders[0].productTags).flat()).toEqual([
    'Fragile',
  ])
  await page.evaluate(() => {
    window.failRename = false
  })
  await productCatalog
    .getByRole('button', { name: 'Save tag name', exact: true })
    .click()
  await expect(
    productCatalog.getByRole('button', {
      name: 'Rename tag Product renamed',
      exact: true,
    })
  ).toBeVisible()
  await productCatalog
    .getByRole('textbox', { name: 'New product tag', exact: true })
    .fill('Fresh')
  await productCatalog
    .getByRole('button', { name: 'Create tag', exact: true })
    .click()
  await productCatalog
    .getByRole('button', { name: 'Rename tag Fresh', exact: true })
    .click()
  await productCatalog
    .getByRole('textbox', { name: 'New name for Fresh', exact: true })
    .fill('Pending creation')
  await save(dialog)
  await expect(page.locator('.order-card-tags')).toContainText('Order, renamed')
  await expect(page.locator('.product-row-tags').first()).toHaveText(
    'Product renamed'
  )
  await page.reload()
  await expect(page.locator('.product-row-tags').first()).toHaveText(
    'Product renamed'
  )
  backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(backup.data.orders[0].tags).toEqual(['Order, renamed'])
  expect(Object.values(backup.data.orders[0].productTags).flat()).toEqual([
    'Product renamed',
  ])
  expect(
    backup.data.packingPreferences.value.productTags.map((tag) => tag.name)
  ).toContain('Pending creation')
  await page.locator('.product-title').first().dblclick()
  await expect(
    page
      .locator('.product-details-dialog')
      .getByRole('button', { name: /^Rename tag / })
  ).toHaveCount(0)
  expect(extension.unexpectedRequests).toEqual([])
})

test('Settings locks all edits during delayed validation and unlocks them after a failed save', async ({
  extension,
}) => {
  const page = await openWorkspace(extension)
  let dialog = await settings(page, 'Tags')
  let catalog = dialog.locator('[data-tag-scope=order]')
  await catalog.getByLabel('New order tag', { exact: true }).fill('Unused')
  await catalog.getByRole('button', { name: 'Create tag', exact: true }).click()
  await save(dialog)
  dialog = await settings(page, 'Tags')
  await dialog.getByRole('tab', { name: 'Labels', exact: true }).click()
  await dialog.getByLabel('Website', { exact: true }).fill('validation.example')
  await dialog.getByRole('tab', { name: 'Tags', exact: true }).click()
  catalog = dialog.locator('[data-tag-scope=order]')
  await catalog
    .getByRole('button', { name: 'Rename tag Unused', exact: true })
    .click()
  await catalog
    .getByRole('textbox', { name: 'New name for Unused', exact: true })
    .fill('Renamed before save')
  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      window.releaseSettingsValidation = (succeed) => {
        HTMLCanvasElement.prototype.toBlob = toBlob
        if (succeed) toBlob.call(this, callback, ...args)
        else callback(null)
      }
    }
  })
  await dialog
    .getByRole('button', { name: 'Save settings', exact: true })
    .click()
  await expect
    .poll(() => page.evaluate(() => Boolean(window.releaseSettingsValidation)))
    .toBe(true)
  // The flush renders a new catalog row. It must inherit the lock too.
  const lateRename = catalog.getByRole('button', {
    name: 'Rename tag Renamed before save',
    exact: true,
  })
  await expect(lateRename).toBeDisabled()
  await expect(
    catalog.getByLabel('New order tag', { exact: true })
  ).toBeDisabled()
  await expect(
    dialog.getByLabel('Dark palette', { exact: true })
  ).toBeDisabled()
  await expect(
    dialog.getByRole('button', { name: 'Close settings', exact: true })
  ).toBeDisabled()
  await expect(
    dialog.getByRole('status').filter({ hasText: 'Saving settings…' })
  ).toBeVisible()
  await lateRename.click({ force: true })
  await expect(catalog.locator('.order-tag-name-input')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await page.evaluate(() => window.releaseSettingsValidation(false))
  await expect(dialog.getByRole('alert')).toContainText(
    'could not encode the label PNG'
  )
  await expect(lateRename).toBeEnabled()
  await expect(dialog.getByLabel('Dark palette', { exact: true })).toBeEnabled()
  await expect(
    dialog.getByRole('button', { name: 'Close settings', exact: true })
  ).toBeEnabled()
  await dialog.locator('.error-notice-close').click()
  // A fresh rename after failure is accepted and the retired name stays retired.
  await lateRename.click()
  await catalog
    .getByRole('textbox', {
      name: 'New name for Renamed before save',
      exact: true,
    })
    .fill('Final unused name')
  await save(dialog)
  const backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(
    backup.data.packingPreferences.value.orderTags.map((tag) => tag.name)
  ).toEqual(['Final unused name'])
})

test('Settings cannot dismiss a pending tag rename and preserves its draft after storage fails', async ({
  extension,
}) => {
  const page = await openWorkspace(extension)
  let dialog = await settings(page, 'Tags')
  let catalog = dialog.locator('[data-tag-scope=product]')
  await catalog.getByLabel('New product tag', { exact: true }).fill('Original')
  await catalog.getByRole('button', { name: 'Create tag', exact: true }).click()
  await save(dialog)
  dialog = await settings(page, 'Tags')
  catalog = dialog.locator('[data-tag-scope=product]')
  await page.evaluate(() => {
    window.holdTagRename = true
    window.tagRenameStarted = false
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args)
      if (
        window.holdTagRename &&
        this.name === 'packingPreferences' &&
        args[0]?.value?.productTags?.some((tag) => tag.name === 'Kept draft')
      ) {
        window.tagRenameStarted = true
        const keepAlive = () => {
          if (!window.holdTagRename) {
            this.transaction.abort()
            return
          }
          this.get(args[0].id).onsuccess = keepAlive
        }
        keepAlive()
      }
      return request
    }
  })
  await catalog
    .getByRole('button', { name: 'Rename tag Original', exact: true })
    .click()
  const name = catalog.getByRole('textbox', {
    name: 'New name for Original',
    exact: true,
  })
  await name.fill('Kept draft')
  await name.press('Enter')
  await expect
    .poll(() => page.evaluate(() => window.tagRenameStarted))
    .toBe(true)
  await dialog
    .getByRole('button', { name: 'Close settings', exact: true })
    .click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await page.evaluate(() => {
    window.holdTagRename = false
  })
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect(name).toHaveValue('Kept draft')
  await expect(name).toBeFocused()
  await expect(catalog.locator('.order-tag-rename-error')).toContainText(
    'Your draft is still here'
  )
  await name.press('Enter')
  await expect(
    catalog.getByRole('button', { name: 'Rename tag Kept draft', exact: true })
  ).toBeVisible()
  await dialog
    .getByRole('button', { name: 'Close settings', exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
})

test('closing order details locks annotations until a delayed save finishes', async ({
  extension,
}) => {
  const page = await openWorkspace(extension)
  for (const toggle of await page
    .locator('.month-toggle[aria-expanded=false]')
    .all())
    await toggle.click()
  await page.locator('.order-card-meta').first().dblclick()
  const dialog = page.locator('#order-details')
  await page.evaluate(() => {
    window.holdOrderTagSave = true
    window.orderTagSaveStarted = false
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const result = put.apply(this, args)
      if (
        this.name === 'orders' &&
        args[0]?.notes === 'Closing draft' &&
        window.holdOrderTagSave
      ) {
        window.orderTagSaveStarted = true
        const key = [args[0].snapshot.accountId, args[0].snapshot.orderId]
        const keepAlive = () => {
          if (!window.holdOrderTagSave) return
          const request = this.get(key)
          request.onsuccess = keepAlive
        }
        keepAlive()
      }
      return result
    }
  })
  await dialog.getByLabel('Your notes').fill('Closing draft')
  const tags = dialog.getByRole('combobox', { name: 'Tags', exact: true })
  await tags.fill('Typed before close')
  await dialog
    .getByRole('button', { name: 'Close order details', exact: true })
    .click()
  await expect
    .poll(() => page.evaluate(() => window.orderTagSaveStarted))
    .toBe(true)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Your notes')).toBeDisabled()
  expect(await tags.evaluate((node) => Boolean(node.closest('[inert]')))).toBe(
    true
  )
  await page.keyboard.press('Escape')
  await expect(dialog.getByLabel('Your notes')).toBeDisabled()
  await page.evaluate(() => {
    window.holdOrderTagSave = false
  })
  await expect(dialog).not.toBeVisible()
  const backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  expect(backup.data.orders[0].notes).toBe('Closing draft')
  expect(backup.data.orders[0].tags).toEqual(['Typed before close'])
  await page.locator('.order-card-meta').first().dblclick()
  await expect(dialog.getByLabel('Your notes')).toBeEnabled()
  expect(await tags.evaluate((node) => Boolean(node.closest('[inert]')))).toBe(
    false
  )
})

test('custom tag foreground colors persist, Auto restores readable text and compact controls fit mobile', async ({
  extension,
}) => {
  const page = await openWorkspace(extension)
  let dialog = await settings(page, 'Tags')
  await dialog
    .getByLabel('New order tag', { exact: true })
    .fill('Display stock')
  await dialog
    .locator('[data-tag-scope=order]')
    .getByRole('button', { name: 'Create tag', exact: true })
    .click()
  await dialog
    .getByLabel('Display stock background · Dark', { exact: true })
    .fill('#ffcc88')
  await dialog
    .getByLabel('Display stock background · Light', { exact: true })
    .fill('#301800')
  await dialog
    .getByLabel('Display stock text · Dark', { exact: true })
    .fill('#543210')
  await dialog
    .getByLabel('Display stock text · Light', { exact: true })
    .fill('#ffeedd')
  await page.setViewportSize({ width: 375, height: 800 })
  const colorRow = dialog
    .locator('.order-tag-color-row')
    .filter({ hasText: 'Display stock' })
  await colorRow.scrollIntoViewIfNeeded()
  expect(
    await colorRow.evaluate((node) => node.scrollWidth <= node.clientWidth)
  ).toBe(true)
  for (const control of await colorRow
    .locator('input[type=color],button')
    .all()) {
    const box = await control.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(375)
  }
  await save(dialog)
  await page.setViewportSize({ width: 1280, height: 900 })
  for (const toggle of await page
    .locator('.month-toggle[aria-expanded=false]')
    .all())
    await toggle.click()
  await page.locator('.order-card-meta').first().dblclick()
  await page
    .getByRole('combobox', { name: 'Tags', exact: true })
    .fill('Display stock')
  await page
    .getByRole('button', { name: 'Close order details', exact: true })
    .click()
  await expect(page.locator('#order-details')).not.toBeVisible()
  const badge = page
    .locator('.order-card-tags .order-tag-badge')
    .filter({ hasText: 'Display stock' })
  await expect(badge).toHaveCSS('font-size', '11.5px')
  // Autosave also broadcasts a library refresh. A badge can be replaced between
  // the computed-style assertion and the geometry read, so retry the full check.
  await expect(async () => {
    await expect(badge).toBeVisible()
    const box = await badge.boundingBox()
    expect(box).not.toBeNull()
    expect(box.height).toBeGreaterThan(0)
    expect(box.height).toBeLessThan(20)
  }).toPass({ timeout: 5000 })
  await expect(badge).toHaveCSS('color', 'rgb(84, 50, 16)')
  await page.reload()
  await expect(badge).toHaveCSS('color', 'rgb(84, 50, 16)')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(badge).toHaveCSS('color', 'rgb(255, 238, 221)')
  dialog = await settings(page, 'Tags')
  await expect(
    dialog.getByLabel('Display stock text · Light', { exact: true })
  ).toHaveValue('#ffeedd')
  await dialog
    .getByRole('button', {
      name: 'Automatic text color for Display stock · Light',
      exact: true,
    })
    .click()
  await expect(
    dialog.getByLabel('Display stock text · Light', { exact: true })
  ).toHaveValue('#ffffff')
  await expect(
    dialog.getByLabel('Display stock background · Light', { exact: true })
  ).toHaveValue('#301800')
  await save(dialog)
  await expect(badge).toHaveCSS('color', 'rgb(255, 255, 255)')
})

test('appearance palettes and readable custom status/date colors persist across header mode switches and reloads', async ({
  extension,
}) => {
  const page = await openWorkspace(extension)
  let dialog = await settings(page, 'Appearance')
  await dialog.getByLabel('Dark palette', { exact: true }).selectOption('1688')
  await dialog
    .getByLabel('Light palette', { exact: true })
    .selectOption('terracotta')
  await dialog
    .getByLabel('Awaiting payment · Dark', { exact: true })
    .fill('#ff6600')
  await dialog.getByLabel('Dates · Light', { exact: true }).fill('#201000')
  await save(dialog)
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(29, 23, 19)'
  )
  await expect(page.locator('.order-section-band .order-status')).toHaveCSS(
    'background-color',
    'rgb(255, 102, 0)'
  )
  await expect(page.locator('.order-section-band .order-status')).toHaveCSS(
    'color',
    'rgb(0, 0, 0)'
  )
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(250, 243, 239)'
  )
  await expect(page.locator('.order-section-band .purchase-date')).toHaveCSS(
    'background-color',
    'rgb(32, 16, 0)'
  )
  await expect(page.locator('.order-section-band .purchase-date')).toHaveCSS(
    'color',
    'rgb(255, 255, 255)'
  )
  await page.reload()
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(250, 243, 239)'
  )
  dialog = await settings(page, 'Appearance')
  await expect(dialog.getByLabel('Light palette', { exact: true })).toHaveValue(
    'terracotta'
  )
  await expect(
    dialog.getByLabel('Awaiting payment · Dark', { exact: true })
  ).toHaveValue('#ff6600')
  await dialog
    .getByRole('button', { name: 'Reset Dates colors', exact: true })
    .click()
  await save(dialog)
  await expect(
    page.locator('.order-section-band .purchase-date')
  ).not.toHaveCSS('background-color', 'rgb(32, 16, 0)')
  expect(extension.unexpectedRequests).toEqual([])
})

test('edited product color aliases, translations and swatches update tables and persist without touching seller text', async ({
  extension,
}) => {
  const page = await openWorkspace(extension)
  const dialog = await settings(page, 'Product colors')
  const row = dialog.locator('[data-color-rule=black]')
  await row
    .getByLabel('Seller color names', { exact: true })
    .fill('黑色|墨黑样本')
  await row.getByLabel('English', { exact: true }).fill('Ink black')
  await row.getByLabel('Chinese', { exact: true }).fill('墨黑')
  await row.getByLabel('Spanish', { exact: true }).fill('Negro tinta')
  await row.getByLabel('Color swatch', { exact: true }).fill('#121110')
  await save(dialog)
  await expect(
    page.locator('#sheet-body .product-color-hint').first()
  ).toHaveText('Ink black')
  await expect(
    page.locator('#sheet-body .product-color-hint i').first()
  ).toHaveCSS('background-color', 'rgb(18, 17, 16)')
  await page.locator('#language-toggle [data-language=es]').click()
  await expect(
    page.locator('#sheet-body .product-color-hint').first()
  ).toHaveText('Negro tinta')
  await page.reload()
  await expect(
    page.locator('#sheet-body .product-color-hint').first()
  ).toHaveText('Negro tinta')
  await page.locator('.product-title').first().dblclick()
  await expect(page.locator('.product-original-description pre')).toHaveText(
    '合成玻璃罐\n颜色：黑色'
  )
  await page.keyboard.press('Escape')
  const backup = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
  )
  const saved = backup.data.packingPreferences.value.colorVocabulary.find(
    (entry) => entry.id === 'black'
  )
  expect(saved.aliases).toEqual(['黑色', '墨黑样本'])
  expect(saved.labels.es).toBe('Negro tinta')
})

test('color-rule validation identifies the offending rule and settings remain usable at narrow widths', async ({
  extension,
}) => {
  const page = await openWorkspace(extension)
  await page.setViewportSize({ width: 390, height: 780 })
  const dialog = await settings(page, 'Product colors')
  await dialog
    .getByRole('combobox', { name: 'Search color rules' })
    .fill('White')
  const row = dialog.locator('[data-color-rule=white]')
  await row.getByLabel('Seller color names', { exact: true }).fill('黑色')
  await dialog
    .getByRole('button', { name: 'Save settings', exact: true })
    .click()
  await expect(
    dialog.getByRole('tab', { name: 'Product colors', exact: true })
  ).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.locator('[aria-invalid=true]')).toBeFocused()
  await expect(
    dialog
      .getByRole('tabpanel', { name: 'Product colors', exact: true })
      .locator('.appearance-validation')
  ).toContainText('黑色')
  await dialog
    .locator('[data-color-rule=white]')
    .getByLabel('Seller color names', { exact: true })
    .fill('白色|白')
  await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await expect(dialog.getByLabel('Dark palette', { exact: true })).toBeVisible()
  await dialog
    .getByLabel('Dark palette', { exact: true })
    .selectOption('apricot')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(23, 21, 18)'
  )
})
