import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { revealCopyActions } from './copy-actions-helpers.mjs'
import { DEFAULT_LABEL_SETTINGS } from '../../src/labels.js'

async function observeImageWrites(page) {
  await page.evaluate(() => {
    window.individualImageWrites = []
    window.previewDigest = async (blob) =>
      [
        ...new Uint8Array(
          await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
        ),
      ].join(',')
    const write = navigator.clipboard.write.bind(navigator.clipboard)
    navigator.clipboard.write = async (items) => {
      const active = navigator.userActivation.isActive
      if (window.rejectIndividualWrite) {
        window.rejectIndividualWrite = false
        throw new Error('Synthetic individual image copy failure')
      }
      const formats = {}
      for (const type of items[0].types) {
        const blob = await items[0].getType(type)
        formats[type] =
          type === 'text/html'
            ? await blob.text()
            : await window.previewDigest(blob)
      }
      await write(items)
      window.individualImageWrites.push({ active, formats })
    }
  })
}

async function imageDigest(image) {
  return image.evaluate(async (image) =>
    window.previewDigest(await (await fetch(image.src)).blob())
  )
}

async function copyIndividual(dialog, index) {
  const figure = dialog.locator('.copy-preview figure').nth(index)
  const button = figure.locator('.photo-copy-button')
  await figure.locator('.photo-copy-tile').hover()
  await expect(button).toHaveCSS('opacity', '0.94')
  await button.click()
  await expect(button).toHaveClass(/copied/)
  await expect(button).toHaveAttribute('data-icon', 'check')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
  await expect(dialog.locator('.image-copy-batches .is-copied')).toHaveCount(0)
  return button
}

async function workspace(extension, count) {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.sellerMemberLogin = 'synthetic-batch-supplier'
  record.changedEntryIds = []
  record.snapshot.items = Array.from({ length: count }, (_, index) => ({
    ...record.snapshot.items[index % 3],
    entryId: String(9100000000000000000n + BigInt(index)),
    title: `合成玻璃花瓶${index + 1}`,
    productNumber: `BATCH-VASE-${index + 1}`,
    description: `合成玻璃花瓶${index + 1}\n货号：BATCH-VASE-${index + 1}`,
    skuProperties: [],
  }))
  const gross = record.snapshot.items.reduce(
    (sum, item) =>
      sum + Math.round(Number(item.price) * 100) * Number(item.quantity),
    0
  )
  const discount = record.snapshot.items.reduce(
    (sum, item) => sum + Math.round(Number(item.discount) * 100),
    0
  )
  Object.assign(record.snapshot.totals, {
    goodsGross: (gross / 100).toFixed(2),
    sourceDiscount: (discount / 100).toFixed(2),
    goodsNet: ((gross - discount) / 100).toFixed(2),
    payable: ((gross - discount) / 100).toFixed(2),
  })
  const result = await extension.inspector.evaluate(
    async (record) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders: [record],
          history: [],
          images: [],
        },
      }),
    record
  )
  expect(result.ok, result.error).toBe(true)
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    count
  )
  return { page, record }
}

test('individual barcode and carton images keep their exact bytes and Excel label sizing without completing the batch', async ({
  extension,
}) => {
  const { page } = await workspace(extension, 2)
  await page.locator('#select-rows').click()
  await page.locator('#prepare-orders').click()
  await page
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const packing = page.locator('#packing-view')
  await expect(packing.locator('.preparation-group')).toHaveCount(2)
  await observeImageWrites(page)
  for (const [kind, action] of [
    ['barcode', 'Copy barcode images'],
    ['mark', 'Copy carton marks'],
  ]) {
    await revealCopyActions(page)
    await packing.getByRole('button', { name: action, exact: true }).click()
    const dialog = page.locator('.image-copy-dialog')
    await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
    const images = dialog.locator('.copy-preview img')
    await expect(images).toHaveCount(2)
    const expected = await Promise.all(
      [0, 1].map((index) => imageDigest(images.nth(index)))
    )
    expect(expected[0]).not.toBe(expected[1])
    const codes = await dialog.locator('figcaption .ce-code').allTextContents()
    expect(new Set(codes).size).toBe(2)
    await expect(dialog.locator('.ce-code-part')).toHaveCount(0)
    const before = await page.evaluate(() => individualImageWrites.length)
    for (const index of [0, 1]) {
      const button = dialog.locator('.photo-copy-button').nth(index)
      await page.mouse.move(0, 0)
      await expect(button).toHaveCSS('opacity', '0')
      await expect(button).toHaveCSS('pointer-events', 'none')
      if (!index) {
        await dialog.locator('.copy-preview-zoom').first().focus()
        await page.keyboard.press('Tab')
        await expect(button).toBeFocused()
        await expect(button).toHaveCSS('opacity', '0.94')
        await page.keyboard.press('Shift+Tab')
        await expect(dialog.locator('.copy-preview-zoom').first()).toBeFocused()
        await expect(button).toHaveCSS('opacity', '0.94')
        await dialog.locator('.image-copy-heading button').focus()
      }
      const copied = await copyIndividual(dialog, index)
      await expect(copied).toHaveAccessibleName(
        `Copy image ${index + 1}: Copied`
      )
      expect((await copied.boundingBox()).width).toBe(24)
      expect((await copied.boundingBox()).height).toBe(24)
      await expect(copied).toHaveText('')
      await expect(
        dialog.locator('.copy-preview-zoom').nth(index)
      ).toHaveAttribute('aria-pressed', 'false')
      await expect(dialog.locator('.image-copy-progress')).toContainText(
        `Image ${index + 1} copied`
      )
      await expect(dialog.locator('.image-copy-progress')).toContainText(
        '0 of 1 batches copied'
      )
      const entry = await page.evaluate(() => individualImageWrites.at(-1))
      expect(entry.active).toBe(true)
      expect(entry.formats['image/png']).toBe(expected[index])
      const label = await page.evaluate((html) => {
        const parsed = new DOMParser().parseFromString(html, 'text/html')
        const images = [...parsed.querySelectorAll('img')]
        return images.map((image) => ({
          width: image.style.width,
          height: image.style.height,
        }))
      }, entry.formats['text/html'])
      expect(label).toEqual([
        {
          width: `${DEFAULT_LABEL_SETTINGS[kind].widthMm}mm`,
          height: `${DEFAULT_LABEL_SETTINGS[kind].heightMm}mm`,
        },
      ])
    }
    expect(await page.evaluate(() => individualImageWrites.length)).toBe(
      before + 2
    )
    await dialog.locator('.image-copy-submit').click()
    await expect(dialog.locator('.image-copy-progress')).toContainText(
      'Copied 1 of 1 batches'
    )
    const htmlCount = await page.evaluate(
      () =>
        new DOMParser()
          .parseFromString(
            individualImageWrites.at(-1).formats['text/html'],
            'text/html'
          )
          .querySelectorAll('img').length
    )
    expect(htmlCount).toBe(2)
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
  expect(extension.unexpectedRequests).toEqual([])
})

test('photo, Excel-cells and Excel-image previews copy individual full PNGs and retry errors in the same popup', async ({
  extension,
}) => {
  const { page } = await workspace(extension, 3)
  await observeImageWrites(page)
  for (const action of ['copy-images', 'copy-excel', 'copy-excel-image']) {
    if (action !== 'copy-excel-image') await revealCopyActions(page)
    await page.locator(`#${action}`).click()
    const dialog = page.locator('.image-copy-dialog')
    await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
    const image = dialog.locator('.copy-preview img').first()
    const expected = await imageDigest(image)
    if (action === 'copy-excel-image') {
      await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click()
      await expect(dialog.locator('.copy-preview-zoom')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await dialog
        .getByRole('button', { name: 'Fit image', exact: true })
        .click()
      await page.evaluate(() => (window.rejectIndividualWrite = true))
      await dialog.locator('.photo-copy-tile').hover()
      await dialog.locator('.photo-copy-button').click()
      await expect(dialog.getByRole('alert')).toContainText(
        'Synthetic individual image copy failure'
      )
      await expect(dialog.locator('.photo-copy-button')).not.toHaveClass(
        /copied/
      )
      await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
    }
    await copyIndividual(dialog, 0)
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    expect(
      (await page.evaluate(() => individualImageWrites.at(-1))).formats[
        'image/png'
      ]
    ).toBe(expected)
    const pixels = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read()
      const image = await createImageBitmap(await item.getType('image/png'))
      const result = [image.width, image.height]
      image.close()
      return result
    })
    expect(pixels).toEqual(
      await image.evaluate((image) => [image.naturalWidth, image.naturalHeight])
    )
    await page.mouse.move(0, 0)
    await expect(dialog.locator('.photo-copy-button').first()).toHaveCSS(
      'opacity',
      '0'
    )
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
  expect(extension.unexpectedRequests).toEqual([])
})

test('copy batch feedback waits for clipboard completion, stays in the active dialog and restores for repeat copies', async ({
  extension,
}) => {
  const { page } = await workspace(extension, 3)
  await page.locator('#copy-excel-image').click()
  const dialog = page.locator('.image-copy-dialog')
  const copy = dialog.locator('.image-copy-submit')
  await expect(copy).toBeEnabled()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('#copy-excel-image')).not.toHaveClass(/copied/)
  await page.locator('[data-language="es"]').click()
  await page.evaluate(() => {
    const write = navigator.clipboard.write.bind(navigator.clipboard)
    window.feedbackWrites = 0
    navigator.clipboard.write = async (items) => {
      window.feedbackWrites++
      await new Promise((resolve, reject) => {
        window.finishFeedbackWrite = resolve
        window.failFeedbackWrite = reject
      })
      await write(items)
    }
  })
  await page.locator('#copy-excel-image').click()
  await expect(copy).toBeEnabled()
  const before = await copy.boundingBox()
  await copy.click()
  await expect(copy).toHaveText('Copiando…')
  await expect(copy).toBeDisabled()
  await expect(copy).not.toHaveClass(/copied/)
  await expect(dialog.locator('.is-copied')).toHaveCount(0)
  await page.evaluate(() => window.finishFeedbackWrite())
  await expect(copy).toHaveText('Copiado')
  await expect(copy).toHaveAttribute('data-icon', 'check')
  await expect(copy).toHaveAttribute('aria-live', 'polite')
  await expect(copy).toBeEnabled()
  await expect(dialog).toBeVisible()
  expect((await copy.boundingBox()).width).toBe(before.width)
  expect((await copy.boundingBox()).height).toBe(before.height)

  await copy.click()
  await expect(copy).toHaveText('Copiando…')
  await expect(copy).not.toHaveClass(/copied/)
  await page.evaluate(() =>
    window.failFeedbackWrite(new Error('Synthetic pending clipboard failure'))
  )
  await expect(dialog.getByRole('alert')).toContainText(
    'Synthetic pending clipboard failure'
  )
  await expect(copy).not.toHaveClass(/copied/)
  await expect(copy).toBeEnabled()
  await copy.click()
  await expect(copy).toHaveText('Copiando…')
  await page.evaluate(() => window.finishFeedbackWrite())
  await expect(copy).toHaveText('Copiado')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(copy).toHaveText('Copiar lote actual', { timeout: 4500 })
  await expect(copy).toHaveAttribute('data-icon', 'copy')
  await expect(copy).not.toHaveClass(/copied/)
  expect(await page.evaluate(() => window.feedbackWrites)).toBe(3)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('product photos copy every batch in one dialog, preserve full images and never write just by navigating', async ({
  extension,
}) => {
  const { page, record } = await workspace(extension, 23)
  await page.evaluate(() =>
    navigator.clipboard.writeText('untouched-until-copy')
  )
  await revealCopyActions(page)
  await page.locator('#copy-images').click()
  const dialog = page.locator('.image-copy-dialog')
  await dialog.evaluate((node) => {
    node.dataset.sessionProbe = 'same-dialog'
  })
  await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
  await expect(dialog.locator('.copy-preview img')).toHaveCount(20)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'untouched-until-copy'
  )
  const copied = []
  for (const [index, size] of [
    [0, 20],
    [1, 3],
  ]) {
    await expect(dialog.locator('.copy-preview img')).toHaveCount(size)
    const previews = await dialog
      .locator('.copy-preview img')
      .evaluateAll((images) => images.map((image) => image.src))
    await dialog.locator('.image-copy-submit').click()
    await expect(dialog.locator('.image-copy-submit')).toHaveText('Copied')
    await expect(dialog.locator('.image-copy-submit')).toHaveAttribute(
      'data-icon',
      'check'
    )
    await expect(dialog.locator(`[data-batch-index="${index}"]`)).toHaveClass(
      /is-copied/
    )
    const rows = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read()
      const html = await (await item.getType('text/html')).text()
      return [
        ...new DOMParser()
          .parseFromString(html, 'text/html')
          .querySelectorAll('img'),
      ].map((image) => image.src)
    })
    expect(rows).toEqual(previews)
    copied.push(...rows)
    if (!index) {
      await dialog
        .getByRole('button', { name: 'Next batch', exact: true })
        .click()
      await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
      await expect(dialog.locator('.image-copy-submit')).toHaveText(
        'Copy current batch'
      )
      await expect(dialog).toHaveAttribute('data-session-probe', 'same-dialog')
    }
  }
  expect(copied).toHaveLength(record.snapshot.items.length)
  await expect(dialog.locator('.image-copy-progress')).toContainText(
    'Copied 2 of 2'
  )
  await dialog
    .getByRole('button', { name: 'Previous batch', exact: true })
    .click()
  await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
  await expect(dialog.locator('[data-batch-index="0"]')).toHaveClass(
    /is-copied/
  )
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('#orders-view')).toBeVisible()
})

test('Excel preview matches copied bytes, errors retry in place, columns refresh all batch progress and old image URLs are released', async ({
  extension,
}) => {
  const { page } = await workspace(extension, 60)
  await page.evaluate(() => {
    window.batchWrites = []
    window.rejectBatchWrite = true
    window.digest = async (blob) =>
      [
        ...new Uint8Array(
          await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
        ),
      ].join(',')
    const write = navigator.clipboard.write.bind(navigator.clipboard)
    navigator.clipboard.write = async (items) => {
      if (window.rejectBatchWrite)
        throw new Error('Synthetic retryable copy failure')
      window.batchWrites.push(
        await window.digest(await items[0].getType('image/png'))
      )
      await write(items)
    }
  })
  await page.locator('#copy-excel-image').click()
  const dialog = page.locator('.image-copy-dialog')
  const primary = dialog.locator('.image-copy-submit')
  await expect(primary).toBeEnabled()
  const preview = dialog.locator('.copy-preview')
  const zoom = dialog.locator('.copy-preview-zoom')
  const originalSource = await zoom.locator('img').getAttribute('src')
  const beforeSize = await zoom.locator('img').boundingBox()
  await preview.hover()
  await page.mouse.wheel(0, -240)
  await expect(zoom).toHaveAttribute('aria-pressed', 'true')
  const enlargedSize = await zoom.locator('img').boundingBox()
  expect(enlargedSize.width).toBeGreaterThan(beforeSize.width)
  expect(await page.evaluate(() => window.batchWrites.length)).toBe(0)
  // Mouse panning does not accidentally activate the image's click-to-fit action.
  const viewport = await preview.boundingBox()
  const beforePan = await preview.evaluate((node) => ({
    left: node.scrollLeft,
    top: node.scrollTop,
  }))
  await page.mouse.move(
    viewport.x + viewport.width / 2,
    viewport.y + viewport.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    viewport.x + viewport.width / 2 - 80,
    viewport.y + viewport.height / 2 - 60,
    { steps: 5 }
  )
  await page.mouse.up()
  await expect(zoom).toHaveAttribute('aria-pressed', 'true')
  const afterPan = await preview.evaluate((node) => ({
    left: node.scrollLeft,
    top: node.scrollTop,
  }))
  expect(afterPan.left).toBeGreaterThan(beforePan.left)
  expect(afterPan.top).toBeGreaterThan(beforePan.top)
  await expect(zoom.locator('img')).toHaveAttribute('src', originalSource)
  await dialog.getByRole('button', { name: 'Fit image', exact: true }).click()
  await expect(zoom).toHaveAttribute('aria-pressed', 'false')
  await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(zoom).toHaveAttribute('aria-pressed', 'true')
  await zoom.focus()
  await preview.evaluate((node) => node.scrollTo(0, 0))
  await page.keyboard.press('ArrowDown')
  expect(await preview.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  await page.keyboard.press('0')
  await expect(zoom).toHaveAttribute('aria-pressed', 'false')
  const originalViewport = page.viewportSize()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() =>
      dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    )
    .toBe(true)
  await expect(
    dialog.getByRole('button', { name: 'Fit image', exact: true })
  ).toBeVisible()
  await page.setViewportSize(originalViewport)
  await dialog.getByRole('button', { name: 'Fit image', exact: true }).click()
  await zoom.click()
  await expect(zoom).toHaveAttribute('aria-pressed', 'true')
  expect(
    await preview.evaluate((node) => node.scrollWidth > node.clientWidth)
  ).toBe(true)
  await zoom.click()
  await expect(zoom).toHaveAttribute('aria-pressed', 'false')
  expect(
    await preview.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
  ).toBe(true)
  const oldUrl = await dialog.locator('.copy-preview img').getAttribute('src')
  await primary.click()
  await expect(dialog.getByRole('alert')).toContainText(
    'Synthetic retryable copy failure'
  )
  await expect(dialog.locator('.is-copied')).toHaveCount(0)
  await expect(primary).toHaveText('Try again')
  await expect(primary).not.toHaveClass(/copied/)
  await page.evaluate(() => {
    window.rejectBatchWrite = false
  })
  for (let batch = 0; batch < 2; batch++) {
    const previewHash = await dialog
      .locator('.copy-preview img')
      .evaluate(async (image) =>
        window.digest(await (await fetch(image.src)).blob())
      )
    await primary.click()
    await expect(primary).toHaveText('Copied')
    await expect(primary).toHaveAttribute('data-icon', 'check')
    await expect(dialog.locator(`[data-batch-index="${batch}"]`)).toHaveClass(
      /is-copied/
    )
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    expect(await page.evaluate(() => window.batchWrites.at(-1))).toBe(
      previewHash
    )
    if (!batch) {
      await dialog
        .getByRole('button', { name: 'Next batch', exact: true })
        .click()
      await expect(primary).toBeEnabled()
      await expect(dialog.locator('.copy-preview-zoom')).toHaveAttribute(
        'aria-pressed',
        'false'
      )
      expect(
        await page.evaluate(async (url) => {
          try {
            await fetch(url)
            return false
          } catch {
            return true
          }
        }, oldUrl)
      ).toBe(true)
    }
  }
  const before = await page.evaluate(() => window.batchWrites.length)
  await dialog
    .locator('[data-column="supplierWeight"] .excel-column-toggle')
    .click()
  await expect(primary).toBeEnabled()
  await expect(dialog.locator('.is-copied')).toHaveCount(0)
  await expect(primary).toHaveText('Copy current batch')
  expect(await page.evaluate(() => window.batchWrites.length)).toBe(before)
  const lastUrl = await dialog.locator('.copy-preview img').getAttribute('src')
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  // The native close event releases the preview and removes the dialog.
  await expect(dialog).toHaveCount(0)
  expect(
    await page.evaluate(async (url) => {
      try {
        await fetch(url)
        return false
      } catch {
        return true
      }
    }, lastUrl)
  ).toBe(true)
})

test('Excel preview preserves its image and zoom when style options toggle', async ({
  extension,
}) => {
  const { page } = await workspace(extension, 24)
  await page.locator('#copy-excel-image').click()
  const dialog = page.locator('.image-copy-dialog')
  await expect(dialog.locator('.image-copy-submit')).toBeEnabled({
    timeout: 20_000,
  })
  const preview = dialog.locator('.copy-preview-interactive')
  const image = preview.locator('img')
  const zoom = preview.locator('.copy-preview-zoom')
  const style = dialog.locator('.excel-style-details')
  const summary = style.locator('summary')
  const source = await image.getAttribute('src')
  await expect(style).toHaveJSProperty('open', false)
  await summary.click()
  await expect(style).toHaveJSProperty('open', true)
  await expect(image).toHaveAttribute('src', source)

  // Inspecting a preview must not regenerate the exported PNG or lose zoom.
  await dialog
    .locator('.image-copy-content')
    .evaluate((node) => node.scrollTo(0, 0))
  const bounds = await preview.boundingBox()
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + 150 }
  await page.mouse.move(point.x, point.y)
  await page.mouse.wheel(0, -240)
  await expect(zoom).toHaveAttribute('aria-pressed', 'true')
  const scale = await dialog.locator('.copy-preview-scale').textContent()
  const beforePan = await preview.evaluate((node) => ({
    left: node.scrollLeft,
    top: node.scrollTop,
  }))
  await page.mouse.down()
  await page.mouse.move(point.x - 60, point.y - 50, { steps: 5 })
  await page.mouse.up()
  await expect
    .poll(() => preview.evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(beforePan.left)
  await expect
    .poll(() => preview.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(beforePan.top)
  await summary.click()
  await expect(style).toHaveJSProperty('open', false)
  await expect(zoom).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.locator('.copy-preview-scale')).toHaveText(scale)
  await expect(image).toHaveAttribute('src', source)
  await dialog.getByRole('button', { name: 'Fit image', exact: true }).click()
  await expect(zoom).toHaveAttribute('aria-pressed', 'false')
  await expect(image).toHaveAttribute('src', source)
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

test('carton mark batches show all generated marks and copy in the same packing dialog', async ({
  extension,
}) => {
  const { page } = await workspace(extension, 6)
  await page.locator('#select-rows').click()
  await page.locator('#prepare-orders').click()
  await page
    .getByRole('button', { name: 'Assign codes and prepare', exact: true })
    .click()
  const packing = page.locator('#packing-view')
  await expect(packing.locator('.preparation-group')).toHaveCount(6)
  await revealCopyActions(page)
  await packing
    .getByRole('button', { name: 'Copy carton marks', exact: true })
    .click()
  const dialog = page.locator('.image-copy-dialog')
  for (const [index, count] of [
    [0, 4],
    [1, 2],
  ]) {
    await expect(dialog.locator('.image-copy-submit')).toBeEnabled()
    await expect(dialog.locator('.copy-preview img')).toHaveCount(count)
    await expect(dialog.locator('.copy-preview figcaption')).toHaveCount(count)
    await dialog.locator('.image-copy-submit').click()
    await expect(dialog.locator('.image-copy-submit')).toHaveText('Copied')
    await expect(dialog.locator('.image-copy-submit')).toHaveAttribute(
      'data-icon',
      'check'
    )
    await expect(dialog.locator(`[data-batch-index="${index}"]`)).toHaveClass(
      /is-copied/
    )
    const copiedCount = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read()
      const html = await (await item.getType('text/html')).text()
      return new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelectorAll('img').length
    })
    expect(copiedCount).toBe(count)
    await expect(page.locator('dialog[open]')).toHaveCount(1)
    if (!index)
      await dialog
        .getByRole('button', { name: 'Next batch', exact: true })
        .click()
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(packing).toBeVisible()
})
