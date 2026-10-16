import {
  copyCurrentImageBatch,
  revealCopyActions,
} from './copy-actions-helpers.mjs'
import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

const dimensions = [
  [960, 640],
  [320, 480],
  [640, 960],
]

async function seedPictures(extension) {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const pictures = await extension.inspector.evaluate(
    (sizes) =>
      sizes.map(([width, height]) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        context.fillStyle = '#567b4a'
        context.fillRect(0, 0, width, height)
        context.fillStyle = '#eebf66'
        context.fillRect(width - 20, height - 20, 20, 20)
        return canvas.toDataURL('image/png')
      }),
    dimensions
  )
  records[0].snapshot.items.forEach((item, index) => {
    item.thumbnail = pictures[index]
  })
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
  return { records, pictures }
}

async function openLibrary(extension) {
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  const page = await extension.context.newPage()
  await page.addInitScript(() => {
    if (localStorage.getItem('1688-library-purchase-months') === null)
      localStorage.setItem('1688-library-purchase-months', '[]')
  })
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  return page
}

test('packaged image loader requests the original CDN URL and reuses its cache', async ({
  extension,
}) => {
  const { pictures } = await seedPictures(extension)
  const original =
    'https://cbu01.alicdn.com/img/ibank/synthetic-full-image.jpg?_=2020'
  const sized = original.replace('.jpg?', '.jpg_64x64.jpg?')
  const requested = []
  await extension.context.route(
    'https://cbu01.alicdn.com/**',
    async (route) => {
      requested.push(route.request().url())
      await route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(pictures[0].split(',')[1], 'base64'),
      })
    }
  )
  const response = await extension.inspector.evaluate(
    async (url) => chrome.runtime.sendMessage({ type: 'IMAGE_GET', url }),
    sized
  )
  expect(response.ok, response.error).toBe(true)
  expect(response.data).toBe(pictures[0])
  const cached = await extension.inspector.evaluate(
    async (url) => chrome.runtime.sendMessage({ type: 'IMAGE_GET', url }),
    sized.replace('64x64', '200x200')
  )
  expect(cached.ok, cached.error).toBe(true)
  expect(cached.data).toBe(pictures[0])
  expect(requested).toEqual([original])
  expect(extension.unexpectedRequests).toEqual([])
})

test('single picture copies original non-square pixels with inline success', async ({
  extension,
}) => {
  await seedPictures(extension)
  const page = await openLibrary(extension)
  const row = page.locator('#sheet-body tr[data-selection-key]').first()
  const preview = row.locator('img')
  await expect
    .poll(() => preview.evaluate((image) => image.naturalWidth))
    .toBe(240)
  // The 72px preview uses a 240px thumbnail; copying still keeps all
  // original 960 × 640 pixels rather than the display-sized derivative.
  await expect(preview).toHaveCSS('width', '72px')
  const button = row.locator('.photo-copy-button')
  await expect(button).toHaveAccessibleName('Copy image')
  await row.locator('.photo-copy-tile').hover()
  const before = await button.boundingBox()
  expect(before.height).toBeLessThanOrEqual(30)
  expect(before.width).toBeLessThanOrEqual(30)
  await expect(button).toHaveText('')
  expect(
    await button.evaluate((node) => node.scrollWidth <= node.clientWidth)
  ).toBe(true)
  await button.click()
  await expect(button).toHaveAccessibleName('Copy image: Copied')
  await expect(button).toHaveClass(/copied/)
  await expect(row).toHaveAttribute('aria-selected', 'false')
  await expect(
    page.getByRole('dialog', { name: 'Product photo', exact: true })
  ).not.toBeVisible()
  await expect(
    page.getByRole('dialog', { name: 'Original product details', exact: true })
  ).not.toBeVisible()
  const after = await button.boundingBox()
  expect(after.width).toBe(before.width)
  expect(after.height).toBe(before.height)
  const size = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0]
    const picture = await createImageBitmap(await item.getType('image/png'))
    const dimensions = [picture.width, picture.height]
    picture.close()
    return dimensions
  })
  expect(size).toEqual(dimensions[0])
  await expect(page.locator('#feedback')).toBeEmpty()
  expect(extension.unexpectedRequests).toEqual([])
})

test('bulk picture copying preserves full pixels in separate compact Excel cells', async ({
  extension,
}) => {
  const { records } = await seedPictures(extension)
  const page = await openLibrary(extension)
  await page
    .getByRole('option', {
      name: `Order ${records[0].snapshot.orderId}`,
      exact: true,
    })
    .click()
  for (const id of ['copy-images', 'copy-excel']) {
    const button = page.locator(`#${id}`)
    await revealCopyActions(page)
    await button.click()
    await copyCurrentImageBatch(page)
    await expect(button).toHaveText('Copied')
    await expect(button).toHaveClass(/copied/)
    const pictures = await page.evaluate(async () => {
      const item = (await navigator.clipboard.read())[0]
      const html = await (await item.getType('text/html')).text()
      const parsed = new DOMParser().parseFromString(html, 'text/html')
      const result = []
      for (const element of parsed.querySelectorAll('img')) {
        const image = new Image()
        image.src = element.src
        await image.decode()
        result.push({
          pixels: [image.naturalWidth, image.naturalHeight],
          display: [
            element.getAttribute('width'),
            element.getAttribute('height'),
          ],
          rowImages: element.closest('tr').querySelectorAll('img').length,
        })
      }
      return result
    })
    expect(pictures).toEqual(
      dimensions.map((pixels) => ({
        pixels,
        display: ['20', '20'],
        rowImages: 1,
      }))
    )
    await expect(page.locator('#feedback')).toBeEmpty()
  }
  expect(extension.unexpectedRequests).toEqual([])
})

test('clipboard failures stay next to the copy control and can be retried', async ({
  extension,
}) => {
  await seedPictures(extension)
  await extension.context.addInitScript(() => {
    const write = navigator.clipboard.write.bind(navigator.clipboard)
    let failNext = true
    navigator.clipboard.write = async (items) => {
      if (failNext) {
        failNext = false
        throw new Error('Synthetic clipboard permission failure')
      }
      return write(items)
    }
  })
  const page = await openLibrary(extension)
  const button = page.locator('#copy-values')
  await revealCopyActions(page)
  await button.click()
  await expect(button).toHaveText('Try again')
  await expect(button).toHaveClass(/copy-failed/)
  await expect(page.locator('.copy-error')).toHaveText(
    'Synthetic clipboard permission failure'
  )
  await expect(page.locator('#feedback')).toBeEmpty()
  await revealCopyActions(page)
  await button.click()
  await expect(button).toHaveText('Copied')
  await expect(button).toHaveClass(/copied/)
  await expect(page.locator('.copy-error')).toHaveCount(0)
  await expect(page.locator('#feedback')).toBeEmpty()
  expect(extension.unexpectedRequests).toEqual([])
})

test('repeated original photos count per row toward the clipboard batch budget', async ({
  extension,
}) => {
  const records = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  const seeded = await extension.inspector.evaluate(async (record) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1400
    const context = canvas.getContext('2d')
    const pixels = context.createImageData(1400, 1400)
    // Non-compressible synthetic pixels exercise the actual full PNG payload.
    for (let offset = 0; offset < pixels.data.length; offset += 65536)
      crypto.getRandomValues(pixels.data.subarray(offset, offset + 65536))
    for (let offset = 3; offset < pixels.data.length; offset += 4)
      pixels.data[offset] = 255
    context.putImageData(pixels, 0, 0)
    const bytesPerRow = canvas.toDataURL('image/png').length * 2
    // The accepted compressed source expands when copied losslessly to PNG.
    const image = canvas.toDataURL('image/jpeg', 0.4)
    canvas.width = canvas.height = 0
    for (const row of record.snapshot.items) row.thumbnail = image
    const response = await chrome.runtime.sendMessage({
      type: 'BACKUP_RESTORE',
      backup: {
        format: '1688-order-library',
        version: 1,
        exportedAt: new Date().toISOString(),
        orders: [record],
        history: [],
        images: [],
      },
    })
    return { response, bytesPerRow, sourceBytes: image.length }
  }, records[0])
  expect(seeded.response.ok, seeded.response.error).toBe(true)
  expect(seeded.sourceBytes).toBeLessThan(2_000_000)
  expect(seeded.bytesPerRow).toBeLessThan(32 * 1024 * 1024)
  expect(seeded.bytesPerRow * 3).toBeGreaterThan(32 * 1024 * 1024)
  await extension.context.addInitScript(() => {
    window.clipboardWrites = 0
    navigator.clipboard.write = async () => {
      window.clipboardWrites++
    }
  })
  const page = await openLibrary(extension)
  const button = page.locator('#copy-images')
  await revealCopyActions(page)
  await button.click()
  const batches = page.getByRole('dialog', {
    name: 'Product photos',
    exact: true,
  })
  await expect(batches).toBeVisible()
  await expect
    .poll(() => batches.locator('[data-batch-index]').count())
    .toBeGreaterThan(1)
  await batches.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(button).toHaveText('Product photos')
  expect(await page.evaluate(() => window.clipboardWrites)).toBe(0)
  expect(extension.unexpectedRequests).toEqual([])
})
