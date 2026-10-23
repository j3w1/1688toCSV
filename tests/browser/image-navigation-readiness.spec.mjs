import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { test, expect } from './extension-fixture.mjs'

let source
async function navigationSource() {
  if (!source) {
    const result = await build({
      stdin: {
        contents:
          "export { enableImageNavigation } from './src/image-copy-dialog.js'",
        resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
      },
      bundle: true,
      format: 'iife',
      globalName: 'Navigation',
      write: false,
    })
    source = result.outputFiles[0].text
  }
  return source
}

test('preview navigation cannot consume an action before a real image has dimensions', async ({
  extension,
}, testInfo) => {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.setContent(
    '<div id="viewport" style="width:400px;height:300px;overflow:auto"><figure id="figure"><button id="toggle"><img id="image"></button></figure></div><div id="tools"></div>'
  )
  await page.addScriptTag({ content: await navigationSource() })
  const data = await extension.inspector.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 80
    canvas.height = 60
    canvas.getContext('2d').fillRect(0, 0, 80, 60)
    return canvas.toDataURL('image/png')
  })
  let releaseImage, markRequested, markDelivered
  const held = new Promise((resolve) => {
    releaseImage = resolve
  })
  const requested = new Promise((resolve) => {
    markRequested = resolve
  })
  const delivered = new Promise((resolve) => {
    markDelivered = resolve
  })
  await page.route(
    `${extension.origin}/pending-navigation.png`,
    async (route) => {
      markRequested()
      await held
      await route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(data.split(',')[1], 'base64'),
      })
      markDelivered()
    }
  )
  await page.evaluate((origin) => {
    const viewport = document.querySelector('#viewport'),
      figure = document.querySelector('#figure'),
      toggle = document.querySelector('#toggle'),
      image = document.querySelector('#image'),
      tools = document.querySelector('#tools')
    image.src = `${origin}/pending-navigation.png`
    window.releaseNavigation = Navigation.enableImageNavigation(
      viewport,
      figure,
      toggle,
      image,
      tools
    )
  }, extension.origin)
  await requested
  const zoomIn = page.getByRole('button', { name: 'Zoom in', exact: true })
  const zoomOut = page.getByRole('button', { name: 'Zoom out', exact: true })
  const fit = page.getByRole('button', { name: 'Fit image', exact: true })
  const toggle = page.locator('#toggle')
  try {
    expect(
      await page.locator('#image').evaluate((image) => image.naturalWidth)
    ).toBe(0)
    // Native programmatic click is ignored once the control is disabled, just
    // like an early user click. Record the original enabled/no-op regression.
    await zoomIn.evaluate((button) => button.click())
    await testInfo.attach('pending-navigation-state', {
      body: JSON.stringify(
        await page.evaluate(() => ({
          width: document.querySelector('#image').naturalWidth,
          zoomDisabled: document.querySelector('[aria-label="Zoom in"]')
            .disabled,
          scale: document.querySelector('output').value,
        }))
      ),
      contentType: 'application/json',
    })
    for (const control of [zoomIn, zoomOut, fit, toggle])
      await expect(control).toBeDisabled()
  } finally {
    releaseImage()
    await delivered
  }
  await page.locator('#image').evaluate((image) => image.decode())
  await expect(zoomIn).toBeEnabled()
  await expect(fit).toBeEnabled()
  await expect(toggle).toBeEnabled()
  await zoomIn.click()
  await expect(page.locator('output')).toHaveJSProperty('value', '125%')
  await expect(zoomOut).toBeEnabled()
  await fit.click()
  await expect(page.locator('output')).toHaveJSProperty('value', '100%')
  await toggle.click()
  await expect(page.locator('output')).toHaveJSProperty('value', '200%')
  expect(
    await page
      .locator('#image')
      .evaluate((image) => ({
        width: image.naturalWidth,
        height: image.naturalHeight,
      }))
  ).toEqual({ width: 80, height: 60 })
  await page.evaluate(() => window.releaseNavigation())
})
