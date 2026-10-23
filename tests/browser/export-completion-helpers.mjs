/** Arm before the click: encoding can outlast an assertion's five-second poll.
 * The production completion event follows source validation and every save.
 */
export async function observePrintExport(page) {
  await page.evaluate(() => {
    window.testPrintExportSettled = new Promise((resolve) =>
      document.addEventListener(
        'print-export-settled',
        (event) => resolve(event.detail),
        { once: true }
      )
    )
  })
  return () => page.evaluate(() => window.testPrintExportSettled)
}

export async function exportPdf(page, button) {
  const settled = await observePrintExport(page)
  await button.click()
  return settled()
}
