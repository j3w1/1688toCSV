// Local Windows acceptance probe. Never opens an existing workbook or saves one.
import { chromium } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { startPreview } from './preview.mjs'

if (process.platform !== 'win32')
  throw new Error('This check needs Windows desktop Excel.')
const preview = await startPreview()
const browser = await chromium.launch({
  channel: 'chromium',
  headless: false,
  args: ['--window-position=-2400,-2400'],
})
const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$html = [System.Windows.Forms.Clipboard]::GetData('HTML Format')
if (!$html -or !$html.Contains('Scented soy candle')) { throw 'The synthetic browser clipboard was not delivered to Windows.' }
$excel = $null; $book = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false; $excel.DisplayAlerts = $false
  $book = $excel.Workbooks.Add()
  $sheet = $book.Worksheets.Item(1)
  $sheet.Range('A1').Select() | Out-Null
  $sheet.PasteSpecial('HTML')
  $imageRows = @(); $imageColumns = @()
  foreach ($shape in $sheet.Shapes) { $imageRows += $shape.TopLeftCell.Row; $imageColumns += $shape.TopLeftCell.Column }
  $result = @{ rows=$sheet.UsedRange.Rows.Count; columns=$sheet.UsedRange.Columns.Count; images=$sheet.Shapes.Count; imageRows=$imageRows; imageColumns=$imageColumns; numericPrice=($sheet.Cells.Item(2,3).Value2 -is [double]); numericQuantity=($sheet.Cells.Item(2,4).Value2 -is [double]); descriptionIsFormula=$sheet.Cells.Item(2,2).HasFormula; version=$excel.Version }
  $result | ConvertTo-Json -Compress
} finally {
  if ($book) { $book.Close($false); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($book) }
  if ($excel) { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
}
`
try {
  const context = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await context.newPage()
  await page.goto(`${preview.url}/library.html`)
  await page.locator('#sheet-body tr').nth(7).waitFor()
  await page.getByRole('button', { name: 'Copy to Excel', exact: true }).click()
  await page
    .getByRole('status')
    .filter({ hasText: '8 product rows copied' })
    .waitFor()
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-STA',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 60_000 }
  )
  if (result.status !== 0)
    throw new Error(
      result.stderr || result.error?.message || 'Excel probe failed.'
    )
  const evidence = JSON.parse(result.stdout.trim())
  if (
    evidence.rows !== 9 ||
    evidence.columns !== 5 ||
    evidence.images !== 8 ||
    evidence.imageRows.join(',') !== '2,3,4,5,6,7,8,9' ||
    evidence.imageColumns.some((column) => column !== 1) ||
    !evidence.numericPrice ||
    !evidence.numericQuantity ||
    evidence.descriptionIsFormula
  )
    throw new Error(
      `Excel paste did not preserve the expected cells and image positions: ${JSON.stringify(evidence)}`
    )
  console.log(
    `Windows Excel clipboard check passed: ${JSON.stringify(evidence)}`
  )
} finally {
  await browser.close()
  await preview.close()
}
