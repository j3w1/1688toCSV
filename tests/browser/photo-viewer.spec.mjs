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

async function expectNearestTagCorner(photo, code) {
  const image = await photo.locator('.photo-viewport img').boundingBox()
  const label = await photo
    .getByRole('button', { name: `Move label for tag ${code}`, exact: true })
    .boundingBox()
  const point = await photo
    .getByRole('button', { name: `Move point for tag ${code}`, exact: true })
    .boundingBox()
  const center = { x: label.x + label.width / 2, y: label.y + label.height / 2 }
  const anchor = { x: point.x + point.width / 2, y: point.y + point.height / 2 }
  const inset = image.width * 0.01
  const distances = [
    image.x + inset + label.width / 2,
    image.x + image.width - inset - label.width / 2,
  ].flatMap((x) =>
    [
      image.y + inset + label.height / 2,
      image.y + image.height - inset - label.height / 2,
    ].map((y) => Math.hypot(x - anchor.x, y - anchor.y))
  )
  expect(
    Math.hypot(center.x - anchor.x, center.y - anchor.y)
  ).toBeLessThanOrEqual(Math.min(...distances) + 1)
  expect(label.x).toBeGreaterThanOrEqual(image.x)
  expect(label.y).toBeGreaterThanOrEqual(image.y)
  expect(label.x + label.width).toBeLessThanOrEqual(image.x + image.width)
  expect(label.y + label.height).toBeLessThanOrEqual(image.y + image.height)
  return { image, center }
}

async function expectTagLayout(photo) {
  const layout = await photo
    .locator('.photo-variant-tag-controls')
    .evaluate((controls) => {
      const list = controls.querySelector('.photo-variant-tag-list')
      const bounds = list.getBoundingClientRect()
      const rect = (element) => {
        const value = element.getBoundingClientRect()
        return {
          left: value.left,
          right: value.right,
          top: value.top,
          bottom: value.bottom,
          centerY: value.top + value.height / 2,
        }
      }
      return {
        screenWidth: innerWidth,
        width: controls.clientWidth,
        scrollWidth: controls.scrollWidth,
        listWidth: list.clientWidth,
        listScrollWidth: list.scrollWidth,
        list: rect(list),
        custom: rect(controls.querySelector('.photo-tag-custom')),
        actions: rect(controls.querySelector('.product-photo-editor-actions')),
        scales: rect(controls.querySelector('.photo-tag-scales')),
        chips: [...list.children].map((chip) => {
          const rect = chip.getBoundingClientRect()
          return {
            left: rect.left - bounds.left,
            right: rect.right - bounds.left,
          }
        }),
        bars: [...controls.querySelectorAll('.photo-tag-size')].map((bar) => ({
          width: bar.clientWidth,
          scrollWidth: bar.scrollWidth,
          top: bar.getBoundingClientRect().top,
        })),
      }
    })
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width)
  expect(layout.listScrollWidth).toBeLessThanOrEqual(layout.listWidth)
  const inline = layout.screenWidth > 800 && layout.chips.length <= 8
  expect(layout.listWidth).toBeGreaterThanOrEqual(
    Math.min(inline ? 112 : 220, layout.width)
  )
  if (inline) {
    expect(layout.list.left).toBeGreaterThan(layout.custom.right)
    expect(layout.list.right).toBeLessThan(layout.actions.left)
    expect(layout.list.centerY).toBeCloseTo(layout.custom.centerY, 0)
    expect(layout.list.centerY).toBeCloseTo(layout.actions.centerY, 0)
    expect(layout.scales.top).toBeGreaterThan(layout.custom.bottom)
    expect(layout.bars[0].top).toBeCloseTo(layout.bars[1].top, 0)
  } else expect(layout.listWidth).toBeCloseTo(layout.width, 0)
  for (const chip of layout.chips) {
    expect(chip.left).toBeGreaterThanOrEqual(0)
    expect(chip.right).toBeLessThanOrEqual(layout.listWidth + 1)
  }
  for (const bar of layout.bars)
    expect(bar.scrollWidth).toBeLessThanOrEqual(bar.width)
}

test('photo tags use the nearest corner in all quadrants and keep one or many chips free of horizontal scrolling', async ({
  extension,
}) => {
  test.setTimeout(60000)
  const { page, photo } = await openPhoto(extension)
  await startEditing(photo)
  const emptyHeight = await photo
    .locator('.photo-variant-tag-controls')
    .evaluate((controls) => controls.getBoundingClientRect().height)
  for (const [index, [x, y]] of [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.2, 0.8],
    [0.8, 0.8],
  ].entries()) {
    const code = ['A', 'B', 'C', 'D'][index]
    await placeTag(page, photo, code, x, y)
    const { image, center } = await expectNearestTagCorner(photo, code)
    expect(center.x < image.x + image.width / 2).toBe(x < 0.5)
    expect(center.y < image.y + image.height / 2).toBe(y < 0.5)
    if (index === 0) {
      expect(
        await photo
          .locator('.photo-variant-tag-controls')
          .evaluate((controls) => controls.getBoundingClientRect().height)
      ).toBeCloseTo(emptyHeight, 0)
      for (const width of [1280, 720, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await expectTagLayout(photo)
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 })
  }
  await expectTagLayout(photo)
  for (let index = 0; index < 14; index++)
    await placeTag(
      page,
      photo,
      `VAR${String(index).padStart(5, '0')}`,
      0.32 + (index % 5) * 0.1,
      0.38 + Math.floor(index / 5) * 0.1
    )
  for (const width of [1280, 720, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expectTagLayout(photo)
    await expectControlsWithinScreen(photo)
  }
  await photo.screenshot({ path: 'work/photo-tag-layout-mobile.png' })
})

async function choosePhotoScale(slider, percent) {
  await slider.press('Home')
  for (let count = 0; count < 32; count++) {
    if ((await slider.getAttribute('aria-valuetext')) === `${percent}%`) return
    await slider.press('ArrowRight')
  }
  throw new Error(`Photo size preset ${percent}% was not reachable`)
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
  // Observe the actual fonts drawn by the editor, alongside its native canvas
  // geometry. Glyph ink bounds can round by a pixel at different font sizes.
  await photo
    .locator('.photo-variant-tag-overlay canvas')
    .evaluate((canvas) => {
      const context = canvas.getContext('2d')
      const fillText = context.fillText
      canvas.tagFonts = {}
      context.fillText = function (code, ...position) {
        canvas.tagFonts[code] = parseFloat(this.font.match(/[\d.]+px/)[0])
        return fillText.call(this, code, ...position)
      }
    })
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
  const imageBeforeDrag = await photo
    .locator('.photo-viewport img')
    .boundingBox()
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 42,
    bounds.y + bounds.height / 2 + 15,
    { steps: 5 }
  )
  await page.mouse.up()
  expect((await label.boundingBox()).x).toBeCloseTo(bounds.x + 42, 0)
  expect((await label.boundingBox()).y).toBeCloseTo(bounds.y + 15, 0)
  await photo.getByRole('button', { name: 'Zoom in', exact: true }).click()
  const zoom = await photo.locator('.photo-zoom-value').textContent()
  await label.press('ArrowRight')
  await expect(photo.locator('.photo-zoom-value')).toHaveText(zoom)
  await photo.getByRole('button', { name: 'Fit', exact: true }).click()
  await placeTag(page, photo, 'BL', 0.65, 0.7)
  const readTagGeometry = () =>
    photo.locator('.photo-variant-tag-overlay').evaluate((overlay) =>
      [...overlay.querySelectorAll('.photo-tag-label')].map((label) => {
        const point = [...overlay.querySelectorAll('.photo-tag-point')].find(
          (point) => point.dataset.photoTag === label.dataset.photoTag
        )
        const code = label
          .getAttribute('aria-label')
          .replace('Move label for tag ', '')
        return {
          width: parseFloat(label.style.width),
          height: parseFloat(label.style.height),
          radius: (parseFloat(point.style.width) - 6) / 2,
          fontSize: overlay.querySelector('canvas').tagFonts[code],
        }
      })
    )
  const tagGeometry = await readTagGeometry()
  await choosePhotoScale(
    photo.getByRole('slider', { name: 'Tag size', exact: true }),
    200
  )
  const largerGeometry = await readTagGeometry()
  expect(largerGeometry).toHaveLength(2)
  for (let i = 0; i < 2; i++) {
    expect(largerGeometry[i].fontSize).toBeCloseTo(
      tagGeometry[i].fontSize * 2,
      5
    )
    expect(largerGeometry[i].radius).toBeCloseTo(tagGeometry[i].radius * 2, 5)
    for (const dimension of ['width', 'height'])
      expect(
        Math.abs(largerGeometry[i][dimension] - tagGeometry[i][dimension] * 2)
        // SVG style serialization rounds normalized bounds to four decimals.
      ).toBeLessThanOrEqual(2.001)
  }
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
  expect(edit.tags[0].labelX).toBeCloseTo(
    (bounds.x + bounds.width / 2 + 42 - imageBeforeDrag.x) /
      imageBeforeDrag.width +
      0.005,
    3
  )
  await photo.getByRole('button', { name: 'Close product photo' }).click()
  await page.reload()
  await trigger.click()
  await startEditing(photo)
  await expect(
    photo.getByRole('slider', { name: 'Tag size', exact: true })
  ).toHaveAttribute('aria-valuetext', '200%')
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

test('visual A–E and size shortcuts compose tags without changing existing codes and all tags save at 600%', async ({
  extension,
}) => {
  const { page, photo, trigger, viewport } = await openPhoto(extension)
  await startEditing(photo)
  const quick = photo.getByRole('group', { name: 'Quick model tags' })
  await expect(quick.getByRole('button')).toHaveText(['A', 'B', 'C', 'D', 'E'])
  await expect(quick.getByRole('combobox')).toHaveCount(0)
  await expect(
    quick.getByRole('button', { name: 'Add tag F', exact: true })
  ).toHaveCount(0)
  const sizes = photo.getByRole('group', { name: 'Quick size tags' })
  await expect(sizes.getByRole('button')).toHaveText([
    'XS',
    'S',
    'M',
    'L',
    'XL',
  ])
  await expect(
    sizes.getByRole('button', { name: 'Use tag size XXL', exact: true })
  ).toHaveCount(0)
  const track = await photo
    .getByRole('slider', { name: 'Tag size', exact: true })
    .boundingBox()
  expect(track.width).toBeGreaterThanOrEqual(220)
  expect(track.width).toBeLessThanOrEqual(260)
  const clickPhoto = async (x, y) => {
    const bounds = await photo.locator('.photo-viewport img').boundingBox()
    await page.mouse.click(
      bounds.x + bounds.width * x,
      bounds.y + bounds.height * y
    )
  }
  for (const [index, code] of ['A', 'B', 'C', 'D', 'E'].entries()) {
    const button = quick.getByRole('button', {
      name: `Add tag ${code}`,
      exact: true,
    })
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expect(photo.getByLabel('Variant tag', { exact: true })).toHaveValue(
      code
    )
    await expect(viewport).toHaveClass(/is-placing-tag/)
    const bounds = await photo.locator('.photo-viewport img').boundingBox()
    await page.mouse.click(
      bounds.x + bounds.width * (0.2 + (index % 3) * 0.3),
      bounds.y + bounds.height * (index < 3 ? 0.3 : 0.7)
    )
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    const chip = photo.getByRole('button', {
      name: `Select tag ${code}`,
      exact: true,
    })
    await chip.hover()
    await expect(chip).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    await expect(chip).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect(chip).toHaveCSS('outline-style', 'none')
    await expect(chip).not.toHaveCSS('box-shadow', 'none')
  }
  const chips = photo.locator('.photo-variant-tag-chip')
  await expect(chips).toHaveText(['A', 'B', 'C', 'D', 'E'])
  await quick
    .getByRole('button', { name: 'Add tag A', exact: true })
    .press('Enter')
  await viewport.press('Escape')
  await expect(viewport).not.toHaveClass(/is-placing-tag/)
  await expect(chips).toHaveCount(5)
  const codeInput = photo.getByLabel('Variant tag', { exact: true })
  // Optional model and size buttons compose; longest known size endings
  // replace each other while custom model text such as AX stays intact.
  await codeInput.fill('AXL')
  await sizes
    .getByRole('button', { name: 'Use tag size S', exact: true })
    .click()
  await expect(codeInput).toHaveValue('AS')
  await sizes
    .getByRole('button', { name: 'Use tag size S', exact: true })
    .click()
  await expect(codeInput).toHaveValue('A')
  await viewport.press('Escape')
  for (const [model, size, expected, x, y] of [
    ['A', 'S', 'AS', 0.25, 0.48],
    ['B', 'L', 'BL', 0.5, 0.48],
    ['A', 'XL', 'AXL', 0.75, 0.48],
    ['AX', 'S', 'AXS', 0.25, 0.9],
  ]) {
    await codeInput.fill(model)
    await sizes
      .getByRole('button', { name: `Use tag size ${size}`, exact: true })
      .click()
    await expect(codeInput).toHaveValue(expected)
    await clickPhoto(x, y)
  }
  await codeInput.fill('A')
  await quick.getByRole('button', { name: 'Add tag A', exact: true }).click()
  await expect(codeInput).toHaveValue('')
  await sizes
    .getByRole('button', { name: 'Use tag size XS', exact: true })
    .click()
  await expect(codeInput).toHaveValue('XS')
  await clickPhoto(0.5, 0.9)
  const expectedCodes = [
    'A',
    'B',
    'C',
    'D',
    'E',
    'AS',
    'BL',
    'AXL',
    'AXS',
    'XS',
  ]
  await expect(chips).toHaveText(expectedCodes)
  const slider = photo.getByRole('slider', { name: 'Tag size', exact: true })
  await slider.press('End')
  await expect(slider).toHaveAttribute('aria-valuetext', '600%')
  await slider.press('ArrowLeft')
  await expect(slider).toHaveAttribute('aria-valuetext', '575%')
  await slider.press('ArrowRight')
  await expect(
    photo.locator('.photo-tag-size:not(.photo-pointer-size) span')
  ).toHaveText('600%')
  await choosePhotoScale(
    photo.getByRole('slider', { name: 'Pointer size', exact: true }),
    200
  )
  await mkdir('work', { recursive: true })
  await photo.screenshot({ path: 'work/photo-tag-quick-600.png' })
  // Preserve the opaque preview artwork so the actual saved photo can be
  // compared with it, including the larger white-core black pointing circles.
  const preview = await photo
    .locator('.photo-variant-tag-overlay canvas')
    .evaluate((canvas) => canvas.toDataURL('image/png'))
  await photo.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(photo.getByRole('status')).toHaveText(
    'Photo saved. Original preserved.'
  )
  const edit = await savedPhotoEdit(extension)
  expect(edit.tagScale).toBe(6)
  expect(edit.pointerScale).toBe(2)
  expect(edit.tags.map((tag) => tag.code)).toEqual(expectedCodes)
  expect(edit.tags[0].labelX).toBeLessThan(0.5)
  expect(edit.tags[0].labelY).toBeLessThan(0.5)
  const pixels = await photo
    .locator('.photo-viewport img')
    .evaluate(async (saved, artwork) => {
      const overlay = new Image()
      overlay.src = artwork
      await overlay.decode()
      const canvas = document.createElement('canvas')
      canvas.width = overlay.naturalWidth
      canvas.height = overlay.naturalHeight
      const context = canvas.getContext('2d')
      context.drawImage(overlay, 0, 0)
      const before = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      ).data
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(saved, 0, 0)
      const after = context.getImageData(0, 0, canvas.width, canvas.height).data
      let checked = 0,
        different = 0
      for (let index = 0; index < before.length; index += 4) {
        if (before[index + 3] !== 255) continue
        checked++
        if (
          before
            .slice(index, index + 3)
            .some((value, channel) => value !== after[index + channel])
        )
          different++
      }
      return { checked, different }
    }, preview)
  expect(pixels.checked).toBeGreaterThan(1000)
  expect(pixels.different).toBe(0)
  await photo.getByRole('button', { name: 'Close product photo' }).click()
  await page.reload()
  await trigger.click()
  await startEditing(photo)
  await expect(slider).toHaveAttribute('aria-valuetext', '600%')
  await expect(
    photo.getByRole('slider', { name: 'Pointer size', exact: true })
  ).toHaveAttribute('aria-valuetext', '200%')
  await expect(chips).toHaveText(expectedCodes)
  for (const width of [720, 390]) {
    await page.setViewportSize({ width, height: 750 })
    await expectControlsWithinScreen(photo)
    for (const button of await quick.getByRole('button').all()) {
      const bounds = await button.boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    }
  }
  await photo.screenshot({ path: 'work/photo-tag-quick-mobile.png' })
})

test('pointer presets resize every circle independently and stay local to each photo through save and reload', async ({
  extension,
}) => {
  const { page, photo, trigger } = await openPhoto(extension)
  await startEditing(photo)
  await placeTag(page, photo, 'A', 0.25, 0.4)
  await placeTag(page, photo, 'BL', 0.7, 0.7)
  const bounds = (selector) =>
    photo.locator(selector).evaluateAll((nodes) =>
      nodes.map((node) => ({
        left: node.style.left,
        top: node.style.top,
        width: node.style.width,
        height: node.style.height,
      }))
    )
  const labels = await bounds('.photo-tag-label'),
    points = await bounds('.photo-tag-point')
  const pointer = photo.getByRole('slider', {
    name: 'Pointer size',
    exact: true,
  })
  await expect(pointer).toHaveAttribute('aria-valuetext', '100%')
  expect((await pointer.boundingBox()).width).toBeGreaterThanOrEqual(220)
  await pointer.press('End')
  await expect(pointer).toHaveAttribute('aria-valuetext', '400%')
  await choosePhotoScale(pointer, 250)
  await expect(photo.locator('.photo-pointer-size span')).toHaveText('250%')
  expect(await bounds('.photo-tag-label')).toEqual(labels)
  const larger = await bounds('.photo-tag-point')
  for (let index = 0; index < points.length; index++) {
    const previous = points[index],
      next = larger[index]
    expect(
      (parseFloat(next.width) - 6) / (parseFloat(previous.width) - 6)
    ).toBeCloseTo(2.5)
    expect(parseFloat(next.left) + parseFloat(next.width) / 2).toBeCloseTo(
      parseFloat(previous.left) + parseFloat(previous.width) / 2
    )
    expect(parseFloat(next.top) + parseFloat(next.height) / 2).toBeCloseTo(
      parseFloat(previous.top) + parseFloat(previous.height) / 2
    )
  }
  await photo.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(photo.getByRole('status')).toHaveText(
    'Photo saved. Original preserved.'
  )
  const saved = await savedPhotoEdit(extension)
  expect(saved.pointerScale).toBe(2.5)
  expect(saved).not.toHaveProperty('tagScale')
  await photo.getByRole('button', { name: 'Next photo', exact: true }).click()
  await startEditing(photo)
  await expect(pointer).toHaveAttribute('aria-valuetext', '100%')
  await photo.getByRole('button', { name: 'Cancel', exact: true }).click()
  await photo
    .getByRole('button', { name: 'Previous photo', exact: true })
    .click()
  await startEditing(photo)
  await expect(pointer).toHaveAttribute('aria-valuetext', '250%')
  await pointer.press('End')
  await photo.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await savedPhotoEdit(extension)).pointerScale).toBe(2.5)
  await photo.getByRole('button', { name: 'Close product photo' }).click()
  await page.reload()
  await trigger.click()
  await startEditing(photo)
  await expect(pointer).toHaveAttribute('aria-valuetext', '250%')
  await photo.getByRole('button', { name: 'Reset photo', exact: true }).click()
  await expect(pointer).toHaveAttribute('aria-valuetext', '100%')
  await photo.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await savedPhotoEdit(extension)).pointerScale).toBe(2.5)
})

test('pointer inversion changes every dot and line, stays per photo and saves an explicit off value', async ({
  extension,
}) => {
  const { page, photo, trigger } = await openPhoto(extension)
  await startEditing(photo)
  await placeTag(page, photo, 'A', 0.25, 0.4)
  await placeTag(page, photo, 'B', 0.75, 0.6)
  const invert = photo.getByRole('button', {
    name: 'Invert pointer',
    exact: true,
  })
  await expect(invert).toHaveAttribute('aria-pressed', 'false')
  const geometry = await photo
    .locator('.photo-tag-label')
    .evaluateAll((nodes) => nodes.map((node) => node.style.cssText))
  await invert.click()
  await expect(invert).toHaveAttribute('aria-pressed', 'true')
  expect(
    await photo
      .locator('.photo-tag-label')
      .evaluateAll((nodes) => nodes.map((node) => node.style.cssText))
  ).toEqual(geometry)
  const cores = await photo
    .locator('.photo-variant-tag-overlay canvas')
    .evaluate((canvas) => {
      const context = canvas.getContext('2d')
      return [
        [0.25, 0.4],
        [0.75, 0.6],
      ].map(([x, y]) => [
        ...context.getImageData(
          Math.round(x * canvas.width),
          Math.round(y * canvas.height),
          1,
          1
        ).data,
      ])
    })
  expect(cores).toEqual([
    [0, 0, 0, 255],
    [0, 0, 0, 255],
  ])
  await photo.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(photo.getByRole('status')).toHaveText(
    'Photo saved. Original preserved.'
  )
  expect((await savedPhotoEdit(extension)).invertPointer).toBe(true)
  await photo.getByRole('button', { name: 'Next photo', exact: true }).click()
  await startEditing(photo)
  await expect(invert).toHaveAttribute('aria-pressed', 'false')
  await photo.getByRole('button', { name: 'Cancel', exact: true }).click()
  await photo
    .getByRole('button', { name: 'Previous photo', exact: true })
    .click()
  await startEditing(photo)
  await expect(invert).toHaveAttribute('aria-pressed', 'true')
  await invert.click()
  await photo.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await savedPhotoEdit(extension)).invertPointer).toBe(true)
  await startEditing(photo)
  await photo.getByRole('button', { name: 'Reset photo', exact: true }).click()
  await expect(invert).toHaveAttribute('aria-pressed', 'false')
  await photo.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await savedPhotoEdit(extension)).invertPointer).toBe(true)
  await photo
    .getByRole('button', { name: 'Close product photo', exact: true })
    .click()
  await page.reload()
  await trigger.click()
  await startEditing(photo)
  await expect(invert).toHaveAttribute('aria-pressed', 'true')
  await invert.click()
  await photo.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(photo.getByRole('status')).toHaveText(
    'Photo saved. Original preserved.'
  )
  expect((await savedPhotoEdit(extension)).invertPointer).toBe(false)
})

test('opening and unrelated photo edits retain legacy continuous sizes until a size bar moves', async ({
  extension,
}) => {
  const { page, photo, trigger } = await openPhoto(extension)
  await startEditing(photo)
  await placeTag(page, photo, 'A', 0.4, 0.5)
  await photo.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(photo.getByRole('status')).toHaveText(
    'Photo saved. Original preserved.'
  )
  await photo.getByRole('button', { name: 'Close product photo' }).click()
  const restored = await extension.inspector.evaluate(async () => {
    const exported = await chrome.runtime.sendMessage({ type: 'BACKUP_EXPORT' })
    if (!exported.ok) throw new Error(exported.error)
    const order = exported.data.orders.find((order) =>
      order.snapshot.items.some((item) => item.photoEdits)
    )
    const item = order.snapshot.items.find((item) => item.photoEdits)
    item.photoEdits['0'].tagScale = 1.88
    item.photoEdits['0'].pointerScale = 1.43
    // A changed backup observation must be newer than the current saved photo;
    // equal clocks intentionally preserve the local version during restore.
    order.snapshot.observedAt = new Date(
      Date.parse(order.snapshot.observedAt) + 1000
    ).toISOString()
    order.changedAt = order.lastCheckedAt = order.snapshot.observedAt
    return chrome.runtime.sendMessage({
      type: 'BACKUP_RESTORE',
      backup: exported.data,
    })
  })
  expect(restored.ok, restored.error).toBe(true)
  expect(await savedPhotoEdit(extension)).toMatchObject({
    tagScale: 1.88,
    pointerScale: 1.43,
  })
  await page.reload()
  await trigger.click()
  await startEditing(photo)
  const tags = photo.getByRole('slider', { name: 'Tag size', exact: true }),
    pointer = photo.getByRole('slider', { name: 'Pointer size', exact: true })
  await expect(tags).toHaveAttribute('aria-valuetext', '188%')
  await expect(pointer).toHaveAttribute('aria-valuetext', '143%')
  await photo.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await savedPhotoEdit(extension)).toMatchObject({
    tagScale: 1.88,
    pointerScale: 1.43,
  })
  await startEditing(photo)
  await photo
    .getByLabel('Canvas background', { exact: true })
    .evaluate((input) => {
      input.value = '#eeeeee'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  await expect(
    photo.getByRole('button', { name: 'Save photo', exact: true })
  ).toBeEnabled()
  await photo.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(photo.getByRole('status')).toHaveText(
    'Photo saved. Original preserved.'
  )
  expect(await savedPhotoEdit(extension)).toMatchObject({
    tagScale: 1.88,
    pointerScale: 1.43,
    background: '#eeeeee',
  })
  await startEditing(photo)
  await tags.press('ArrowRight')
  await pointer.press('ArrowRight')
  await expect(tags).toHaveAttribute('aria-valuetext', '225%')
  await expect(pointer).toHaveAttribute('aria-valuetext', '175%')
  await photo.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(photo.getByRole('status')).toHaveText(
    'Photo saved. Original preserved.'
  )
  expect(await savedPhotoEdit(extension)).toMatchObject({
    tagScale: 2.25,
    pointerScale: 1.75,
  })
})

test('photo composition keeps tag anchors on their product and rejects hiding a tagged point', async ({
  extension,
}) => {
  const { page, photo } = await openPhoto(extension)
  await startEditing(photo)
  await placeTag(page, photo, 'AS', 0.5, 0.5)
  const { image: initialImage, center: initialCenter } =
    await expectNearestTagCorner(photo, 'AS')
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
  expect(edit.tags[0].labelX).toBeCloseTo(
    (initialCenter.x - initialImage.x) / initialImage.width,
    3
  )
  expect(edit.tags[0].labelY).toBeCloseTo(
    (initialCenter.y - initialImage.y) / initialImage.height,
    3
  )
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
    await expect(
      photo.getByRole('slider', {
        name: language === 'es' ? 'Tamaño del punto' : '定位点大小',
        exact: true,
      })
    ).toHaveAttribute('aria-valuetext', '100%')
    await expect(
      photo.locator('.photo-tag-quick').first().getByRole('button')
    ).toHaveText(['A', 'B', 'C', 'D', 'E'])
    await expect(
      photo.locator('.photo-tag-quick-button').first()
    ).toHaveAttribute(
      'aria-label',
      language === 'es' ? 'Añadir etiqueta A' : '添加标记 A'
    )
  }
})
