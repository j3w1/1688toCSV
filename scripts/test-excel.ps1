$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$savedClipboard = [System.Windows.Forms.Clipboard]::GetDataObject()
try {
  & node (Join-Path $PSScriptRoot 'test-excel.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Browser-to-Excel clipboard verification failed.' }
} finally {
  if ($savedClipboard) { [System.Windows.Forms.Clipboard]::SetDataObject($savedClipboard, $true) }
  else { [System.Windows.Forms.Clipboard]::Clear() }
}
