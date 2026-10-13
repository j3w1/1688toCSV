import { test, expect } from './extension-fixture.mjs'

async function openActionPopup(extension) {
  // This opens Chromium's native action surface, not a tab with an emulated
  // viewport. The existing fixture adapter only selects the synthetic order.
  await extension.popup.evaluate(async (tabId) => {
    await chrome.action.setPopup({ popup: `popup.html?fixtureTab=${tabId}` })
    await chrome.action.openPopup()
  }, extension.tabId)
  await expect
    .poll(() =>
      extension.popup.evaluate(
        () =>
          chrome.extension.getViews({ type: 'popup' })[0]?.document.body.dataset
            .state
      )
    )
    .toBe('ready')
}

async function popupLayout(extension) {
  return extension.popup.evaluate(() => {
    const view = chrome.extension.getViews({ type: 'popup' })[0]
    const document = view.document
    const button = document
      .getElementById('download-csv-order')
      .getBoundingClientRect()
    const alternate = document
      .getElementById('save-csv')
      .getBoundingClientRect()
    return {
      width: view.innerWidth,
      height: view.innerHeight,
      contentWidth: document.documentElement.scrollWidth,
      contentHeight: document.body.scrollHeight,
      buttonBottom: button.bottom,
      buttonWidth: button.width,
      alternateBottom: alternate.bottom,
      alternateWidth: alternate.width,
      rootBoxWidth: document.documentElement.getBoundingClientRect().width,
    }
  })
}

test('the native action popup opens at full width with compact ready content', async ({
  extension,
}) => {
  await openActionPopup(extension)
  const layout = await popupLayout(extension)
  expect(layout.width).toBeGreaterThanOrEqual(360)
  expect(layout.width).toBeLessThanOrEqual(380)
  expect(layout.rootBoxWidth).toBe(380)
  expect(layout.contentWidth).toBe(layout.width)
  expect(layout.height).toBeGreaterThan(0)
  expect(layout.height).toBeLessThanOrEqual(600)
  expect(layout.contentHeight).toBeLessThanOrEqual(600)
  expect(layout.buttonBottom).toBeLessThanOrEqual(layout.height)
  expect(extension.unexpectedRequests).toEqual([])
})

test('native popup recovery controls stay full width and long feedback can scroll', async ({
  extension,
}) => {
  await openActionPopup(extension)
  await extension.popup.evaluate(() => {
    const view = chrome.extension.getViews({ type: 'popup' })[0]
    view.chrome.downloads.download = async () => {
      throw new Error('USER_CANCELED')
    }
    view.document.getElementById('download-csv-order').click()
  })
  await expect
    .poll(() =>
      extension.popup.evaluate(
        () =>
          chrome.extension
            .getViews({ type: 'popup' })[0]
            ?.document.getElementById('save-csv').hidden
      )
    )
    .toBe(false)
  const recovered = await popupLayout(extension)
  expect(recovered.rootBoxWidth).toBe(380)
  // On short screens Chromium can add its native vertical scrollbar outside
  // the 380px document. The actual content must not shrink or overflow sideways.
  expect(recovered.width).toBeGreaterThanOrEqual(recovered.rootBoxWidth)
  expect(recovered.width).toBeLessThanOrEqual(400)
  expect(recovered.contentWidth).toBe(recovered.width)
  expect(recovered.height).toBeLessThanOrEqual(600)
  expect(recovered.contentHeight).toBeLessThanOrEqual(600)
  expect(recovered.alternateWidth).toBe(recovered.buttonWidth)
  expect(recovered.alternateWidth).toBeGreaterThan(300)
  expect(recovered.alternateBottom).toBeLessThanOrEqual(recovered.height + 1)

  await extension.popup.evaluate(() => {
    const view = chrome.extension.getViews({ type: 'popup' })[0]
    view.document.getElementById('feedback').textContent =
      'Synthetic diagnostic detail. '.repeat(100)
  })
  const overflowing = await popupLayout(extension)
  expect(overflowing.rootBoxWidth).toBe(380)
  expect(overflowing.width).toBe(recovered.width)
  expect(overflowing.contentWidth).toBe(overflowing.width)
  expect(overflowing.height).toBeLessThanOrEqual(600)
  expect(overflowing.contentHeight).toBeGreaterThan(overflowing.height)
  const scroll = await extension.popup.evaluate(() => {
    const view = chrome.extension.getViews({ type: 'popup' })[0]
    const scroller = view.document.scrollingElement
    scroller.scrollTop = scroller.scrollHeight
    return {
      top: scroller.scrollTop,
      overflow: view.getComputedStyle(scroller).overflowY,
    }
  })
  expect(scroll.overflow).toBe('auto')
  expect(scroll.top).toBeGreaterThan(0)
  expect(extension.unexpectedRequests).toEqual([])
})
