import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

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
    .locator('#sheet-body tr')
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

  await viewport.focus()
  await page.keyboard.press('ArrowRight')
  expect((await geometry(viewport)).x).toBeCloseTo(dragged.x - 40)
  for (let index = 0; index < 50; index++)
    await page.keyboard.press('Shift+ArrowRight')
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
  await page.keyboard.press('+')
  expect((await geometry(viewport)).scale).toBeCloseTo(fitted.scale * 1.5)
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
    .locator('#sheet-body tr')
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
