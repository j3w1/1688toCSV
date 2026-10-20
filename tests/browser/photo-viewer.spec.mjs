import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { mkdir } from 'node:fs/promises'

async function openPhoto(extension) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const thumbnail = await extension.inspector.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 2400
    canvas.height = 1800
    const context = canvas.getContext('2d')
    context.fillStyle = '#a26c3d'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#f3eee5'
    context.fillRect(600, 450, 1200, 900)
    return canvas.toDataURL('image/png')
  })
  for (const record of records)
    for (const item of record.snapshot.items) item.thumbnail = thumbnail
  const result = await extension.inspector.evaluate(
    async (orders) =>
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
  expect(result.ok, result.error).toBe(true)
  const page = await extension.context.newPage()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  const trigger = page
    .locator('#sheet-body tr[data-selection-key]')
    .first()
    .getByRole('button', { name: /^Zoom product photo/ })
  await trigger.click()
  const photo = page.getByRole('dialog', {
      name: 'Product photo',
      exact: true,
    }),
    viewport = photo.locator('.photo-viewport'),
    image = viewport.locator('img')
  await expect(image).toBeVisible()
  await expect(image).toHaveJSProperty('naturalWidth', 2400)
  return { page, trigger, photo, viewport, image }
}

async function geometry(viewport) {
  return viewport.evaluate((element) => {
    const image = element.querySelector('img'),
      bounds = image.getBoundingClientRect(),
      viewportBounds = element.getBoundingClientRect()
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      scale: bounds.width / image.naturalWidth,
      viewportX: viewportBounds.x,
      viewportY: viewportBounds.y,
      viewportWidth: element.clientWidth,
      viewportHeight: element.clientHeight,
    }
  })
}

async function expectControlsWithinScreen(photo) {
  const layout = await photo.evaluate((dialog) => {
    const frame = dialog.querySelector('.photo-viewer-frame')
    const rect = (selector) => {
      const bounds = dialog.querySelector(selector).getBoundingClientRect()
      return {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      }
    }
    return {
      screen: { width: innerWidth, height: innerHeight },
      frame: {
        scrollWidth: frame.scrollWidth,
        clientWidth: frame.clientWidth,
        scrollHeight: frame.scrollHeight,
        clientHeight: frame.clientHeight,
      },
      viewport: rect('.photo-viewport'),
      status: rect('.photo-viewer-status'),
      close: rect('.dialog-close'),
      actions: rect('.photo-zoom-actions'),
    }
  })
  expect(layout.frame.scrollWidth).toBeLessThanOrEqual(layout.frame.clientWidth)
  expect(layout.frame.scrollHeight).toBeLessThanOrEqual(
    layout.frame.clientHeight
  )
  for (const bounds of [
    layout.viewport,
    layout.status,
    layout.close,
    layout.actions,
  ]) {
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(layout.screen.width)
    expect(bounds.bottom).toBeLessThanOrEqual(layout.screen.height)
    expect(bounds.width).toBeGreaterThan(0)
    expect(bounds.height).toBeGreaterThan(0)
  }
  expect(layout.actions.bottom).toBeLessThanOrEqual(layout.viewport.top + 1)
  expect(layout.viewport.bottom).toBeLessThanOrEqual(layout.status.top + 1)
}

test('photo wheel zoom stays under the pointer, dragging captures and cancels, and movement stays bounded', async ({
  extension,
}) => {
  const { page, photo, viewport } = await openPhoto(extension)
  const initial = await geometry(viewport)
  expect(initial.scale).toBeLessThan(1)
  await expect(photo.locator('.photo-zoom-value')).toHaveText(
    `${Math.round(initial.scale * 100)}%`
  )
  await photo
    .getByRole('button', { name: 'Actual size (100%)', exact: true })
    .click()
  const actual = await geometry(viewport)
  expect(actual.scale).toBeCloseTo(1)
  const anchor = {
      x: actual.viewportX + actual.viewportWidth * 0.6,
      y: actual.viewportY + actual.viewportHeight * 0.55,
    },
    sourcePoint = { x: anchor.x - actual.x, y: anchor.y - actual.y },
    pageScroll = await page.evaluate(() => scrollY)
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.wheel(0, -180)
  await expect
    .poll(async () => (await geometry(viewport)).scale)
    .toBeGreaterThan(1)
  const zoomed = await geometry(viewport)
  expect((anchor.x - zoomed.x) / zoomed.scale).toBeCloseTo(sourcePoint.x, 0)
  expect((anchor.y - zoomed.y) / zoomed.scale).toBeCloseTo(sourcePoint.y, 0)
  expect(await page.evaluate(() => scrollY)).toBe(pageScroll)

  await page.mouse.down()
  await page.mouse.move(anchor.x + 80, anchor.y + 45)
  await expect(viewport).toHaveClass(/dragging/)
  const dragged = await geometry(viewport)
  expect(dragged.x - zoomed.x).toBeCloseTo(80)
  expect(dragged.y - zoomed.y).toBeCloseTo(45)
  expect(
    await viewport.evaluate((element) => element.hasPointerCapture(1))
  ).toBe(true)
  await viewport.dispatchEvent('pointercancel', { pointerId: 1 })
  await expect(viewport).not.toHaveClass(/dragging/)
  await page.mouse.move(anchor.x + 140, anchor.y + 90)
  expect((await geometry(viewport)).x).toBeCloseTo(dragged.x)
  await page.mouse.up()

  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.down()
  await page.mouse.move(anchor.x - 5000, anchor.y)
  await page.mouse.up()
  const bounded = await geometry(viewport)
  expect(bounded.x + bounded.width).toBeCloseTo(
    bounded.viewportX + bounded.viewportWidth + 1
  )
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(anchor.x - 50, anchor.y - 50)
  await page.mouse.up({ button: 'right' })
  expect((await geometry(viewport)).x).toBeCloseTo(bounded.x)
})

test('photo fit, double-click, keyboard and reopen reset correctly at different viewport sizes', async ({
  extension,
}) => {
  const { page, trigger, photo, viewport, image } = await openPhoto(extension)
  const fitted = await geometry(viewport)
  await viewport.dblclick()
  await expect(photo.locator('.photo-zoom-value')).toHaveText('100%')
  await viewport.dblclick()
  await expect
    .poll(async () => (await geometry(viewport)).scale)
    .toBeCloseTo(fitted.scale)
  await viewport.focus()
  await page.keyboard.press('ArrowUp')
  expect((await geometry(viewport)).scale).toBeCloseTo(fitted.scale * 1.5)
  await page.keyboard.press('ArrowDown')
  expect((await geometry(viewport)).scale).toBeCloseTo(fitted.scale)
  await page.keyboard.press('+')
  expect((await geometry(viewport)).scale).toBeCloseTo(fitted.scale * 1.5)
  await page.keyboard.press('-')
  expect((await geometry(viewport)).scale).toBeCloseTo(fitted.scale)
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('0')
  expect((await geometry(viewport)).scale).toBeCloseTo(fitted.scale)
  await page.setViewportSize({ width: 720, height: 640 })
  await expect
    .poll(async () => (await geometry(viewport)).scale)
    .toBeLessThan(fitted.scale)
  const resized = await geometry(viewport)
  expect(resized.width).toBeLessThanOrEqual(resized.viewportWidth)
  expect(resized.height).toBeLessThanOrEqual(resized.viewportHeight)
  await expectControlsWithinScreen(photo)
  await photo
    .getByRole('button', { name: 'Actual size (100%)', exact: true })
    .click()
  await expect(photo.locator('.photo-zoom-value')).toHaveText('100%')
  await page.keyboard.press('f')
  expect((await geometry(viewport)).scale).toBeCloseTo(resized.scale)
  await page.keyboard.press('Escape')
  await expect(photo).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await expect(image).toBeVisible()
  expect((await geometry(viewport)).scale).toBeCloseTo(resized.scale)
  const dialogBox = await photo.boundingBox()
  await page.mouse.click(Math.max(2, dialogBox.x - 6), dialogBox.y + 20)
  await expect(photo).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('photo fullscreen uses a real fullscreen frame and remains usable when unavailable', async ({
  extension,
}) => {
  const { page, photo, viewport } = await openPhoto(extension)
  const button = photo.getByRole('button', { name: 'Fullscreen', exact: true })
  await button.click()
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.className))
    .toBe('photo-viewer-frame')
  await expect(
    photo.getByRole('button', { name: 'Exit fullscreen', exact: true })
  ).toHaveAttribute('aria-pressed', 'true')
  await expectControlsWithinScreen(photo)
  await page.setViewportSize({ width: 720, height: 640 })
  await expectControlsWithinScreen(photo)
  await photo
    .getByRole('button', { name: 'Exit fullscreen', exact: true })
    .click()
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement === null))
    .toBe(true)
  await expectControlsWithinScreen(photo)
  await button.click()
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.className))
    .toBe('photo-viewer-frame')
  await photo.getByRole('button', { name: 'Close product photo' }).click()
  await expect(photo).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement === null))
    .toBe(true)
  await page
    .locator('#sheet-body tr[data-selection-key]')
    .first()
    .getByRole('button', { name: /^Zoom product photo/ })
    .click()
  await expect(photo.locator('.photo-viewport img')).toBeVisible()
  await page.evaluate(() =>
    Object.defineProperty(document, 'fullscreenEnabled', {
      configurable: true,
      value: false,
    })
  )
  await button.click()
  await expect(photo.getByRole('status')).toContainText(
    'Fullscreen is unavailable'
  )
  await photo
    .getByRole('button', { name: 'Actual size (100%)', exact: true })
    .click()
  expect((await geometry(viewport)).scale).toBeCloseTo(1)
  await photo.getByRole('button', { name: 'Close product photo' }).click()
  await expect(photo).toHaveCount(0)
})

async function startEditing(photo) {
  await photo.getByRole('button', { name: 'Edit photo', exact: true }).click()
  await expect(
    photo.getByRole('button', { name: 'Add tag', exact: true })
  ).toBeEnabled()
  const code = await photo
    .getByLabel('Variant tag', { exact: true })
    .boundingBox()
  const add = await photo
    .getByRole('button', { name: 'Add tag', exact: true })
    .boundingBox()
  expect(code.width).toBeLessThanOrEqual(80)
  expect(code.height).toBeLessThanOrEqual(30)
  expect(code.y + code.height).toBeCloseTo(add.y + add.height, 0)
}

async function placeTag(page, photo, code, x, y) {
  await photo.getByLabel('Variant tag', { exact: true }).fill(code)
  await photo.getByRole('button', { name: 'Add tag', exact: true }).click()
  const bounds = await photo.locator('.photo-viewport img').boundingBox()
  await page.mouse.click(
    bounds.x + bounds.width * x,
    bounds.y + bounds.height * y
  )
  await expect(
    photo.getByRole('button', { name: `Select tag ${code}`, exact: true })
  ).toBeVisible()
}

async function savedPhotoEdit(extension) {
  return extension.inspector.evaluate(async () => {
    const result = await chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
    if (!result.ok) throw new Error(result.error)
    return result.data.orders
      .flatMap((order) => order.snapshot.items)
      .find((item) => item.photoEdits)?.photoEdits['0']
  })
}

test('photo tags place, rename and move with pointer and keyboard, then survive save and reload', async ({
  extension,
}) => {
  const { page, photo, trigger, viewport } = await openPhoto(extension)
  await startEditing(photo)
  await placeTag(page, photo, 'A', 0.35, 0.45)
  const point = photo.getByRole('button', {
    name: 'Move point for tag A',
    exact: true,
  })
  const pointBefore = await point.boundingBox()
  await point.press('ArrowRight')
  expect((await point.boundingBox()).x).toBeGreaterThan(pointBefore.x)
  await point.press('Shift+ArrowDown')
  await photo.getByLabel('Variant tag', { exact: true }).fill('AX')
  await photo.getByRole('button', { name: 'Rename tag', exact: true }).click()
  await expect(
    photo.getByRole('button', { name: 'Move point for tag AX', exact: true })
  ).toBeVisible()
  const label = photo.getByRole('button', {
    name: 'Move label for tag AX',
    exact: true,
  })
  const bounds = await label.boundingBox()
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 42,
    bounds.y + bounds.height / 2 - 15,
    { steps: 5 }
  )
  await page.mouse.up()
  expect((await label.boundingBox()).x).toBeCloseTo(bounds.x + 42, 0)
  expect((await label.boundingBox()).y).toBeCloseTo(bounds.y - 15, 0)
  await photo.getByRole('button', { name: 'Zoom in', exact: true }).click()
  const zoom = await photo.locator('.photo-zoom-value').textContent()
  await label.press('ArrowRight')
  await expect(photo.locator('.photo-zoom-value')).toHaveText(zoom)
  await photo.getByRole('button', { name: 'Fit', exact: true }).click()
  await placeTag(page, photo, 'BL', 0.65, 0.7)
  const tagWidths = await photo
    .locator('.photo-tag-label')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().width)
    )
  await photo
    .getByRole('slider', { name: 'Tag size', exact: true })
    .evaluate((input) => {
      input.value = '2'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const largerWidths = await photo
    .locator('.photo-tag-label')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().width)
    )
  expect(largerWidths).toHaveLength(2)
  for (let i = 0; i < 2; i++)
    expect(largerWidths[i] / tagWidths[i]).toBeCloseTo(2)
  await mkdir('work', { recursive: true })
  await photo.screenshot({ path: 'work/photo-variant-tags.png' })
  await photo.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(photo.getByRole('status')).toHaveText(
    'Photo saved. Original preserved.'
  )
  const edit = await savedPhotoEdit(extension)
  expect(edit.tags.map((tag) => tag.code)).toEqual(['AX', 'BL'])
  expect(edit.tagScale).toBe(2)
  expect(edit.tags[0].x).toBeCloseTo(0.355, 2)
  expect(edit.tags[0].y).toBeCloseTo(0.47, 2)
  expect(edit.tags[0].labelX).toBeGreaterThan(0.49)
  await photo.getByRole('button', { name: 'Close product photo' }).click()
  await page.reload()
  await trigger.click()
  await startEditing(photo)
  await expect(
    photo.getByRole('slider', { name: 'Tag size', exact: true })
  ).toHaveValue('2')
  await expect(
    photo.getByRole('button', { name: 'Select tag AX', exact: true })
  ).toBeVisible()
  await expect(
    photo.getByRole('button', { name: 'Select tag BL', exact: true })
  ).toBeVisible()
  await page.setViewportSize({ width: 720, height: 640 })
  await expectControlsWithinScreen(photo)
  await expect(viewport).toBeVisible()
})

test('photo tag validation, cancel, reset and removal preserve the saved edit until Save photo', async ({
  extension,
}) => {
  const { page, photo } = await openPhoto(extension)
  await startEditing(photo)
  await photo.getByLabel('Variant tag', { exact: true }).fill('!')
  await photo.getByRole('button', { name: 'Add tag', exact: true }).click()
  await expect(photo.locator('.photo-tag-label')).toHaveCount(0)
  await placeTag(page, photo, 'A', 0.4, 0.5)
  await photo.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(photo.getByRole('status')).toHaveText(
    'Photo saved. Original preserved.'
  )
  await startEditing(photo)
  await photo.getByRole('button', { name: 'Select tag A', exact: true }).click()
  await photo.getByLabel('Variant tag', { exact: true }).fill('BL')
  await photo.getByRole('button', { name: 'Rename tag', exact: true }).click()
  await photo.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await savedPhotoEdit(extension)).tags[0].code).toBe('A')
  await startEditing(photo)
  await expect(
    photo.getByRole('button', { name: 'Select tag A', exact: true })
  ).toBeVisible()
  await photo.getByRole('button', { name: 'Reset photo', exact: true }).click()
  await expect(photo.locator('.photo-tag-label')).toHaveCount(0)
  await photo.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await savedPhotoEdit(extension)).tags[0].code).toBe('A')
  await startEditing(photo)
  await photo
    .getByRole('button', { name: 'Move label for tag A', exact: true })
    .press('Delete')
  await expect(photo.locator('.photo-tag-label')).toHaveCount(0)
  await photo.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(photo.getByRole('status')).toHaveText(
    'Photo saved. Original preserved.'
  )
  expect((await savedPhotoEdit(extension)).tags).toEqual([])
})

test('photo composition keeps tag anchors on their product and rejects hiding a tagged point', async ({
  extension,
}) => {
  const { page, photo } = await openPhoto(extension)
  await startEditing(photo)
  await placeTag(page, photo, 'AS', 0.5, 0.5)
  const horizontal = photo.getByLabel('Horizontal position', { exact: true })
  await horizontal.evaluate((input) => {
    input.value = '0.1'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(
    photo.getByRole('button', { name: 'Save photo', exact: true })
  ).toBeEnabled()
  const moved = await photo
    .getByRole('button', { name: 'Move point for tag AS', exact: true })
    .boundingBox()
  const image = await photo.locator('.photo-viewport img').boundingBox()
  expect((moved.x + moved.width / 2 - image.x) / image.width).toBeCloseTo(0.6)
  await horizontal.evaluate((input) => {
    input.value = '1'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(photo.getByRole('status')).toHaveText(
    'This crop would hide a tagged point. Move or remove that tag first.'
  )
  await expect(horizontal).toHaveValue('0.1')
  await photo.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(photo.getByRole('status')).toHaveText(
    'Photo saved. Original preserved.'
  )
  const edit = await savedPhotoEdit(extension)
  expect(edit.x).toBe(0.1)
  expect(edit.tags[0].x).toBeCloseTo(0.6)
  expect(edit.tags[0].labelX).toBeCloseTo(0.64)
})

test('photo editor translates live without losing its composition or custom variant tags', async ({
  extension,
}) => {
  const { page } = await openPhoto(extension)
  const photo = page.locator('.product-photo-dialog')
  await startEditing(photo)
  await placeTag(page, photo, 'AX', 0.4, 0.5)
  await photo.locator('select').selectOption('cover')
  for (const [language, expected, fitLabel, renameLabel] of [
    [
      'es',
      'Etiqueta de variante',
      'Llenar el cuadrado (recortar)',
      'Renombrar',
    ],
    ['zh', '款式标记', '填满方形（裁剪）', '重命名'],
  ]) {
    await page
      .locator(`#language-toggle [data-language="${language}"]`)
      .evaluate((button) => button.click())
    await expect(photo.getByLabel(expected, { exact: true })).toHaveValue('AX')
    await expect(photo.locator('select')).toHaveValue('cover')
    await expect(photo.locator('option[value="cover"]')).toHaveText(fitLabel)
    await expect(
      photo.getByRole('button', { name: renameLabel, exact: true })
    ).toBeVisible()
    await expect(photo.locator('.photo-variant-tag-chip')).toHaveText('AX')
  }
})
