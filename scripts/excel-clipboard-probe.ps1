param([Parameter(Mandatory = $true)][string]$RequestBase64)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($RequestBase64)) | ConvertFrom-Json
$pngPaste = $request.format -eq 'PNG'
$pngEvidence = $null
$workbookImageEvidence = $null
$disposablePath = $null
if ($pngPaste) {
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
public static class ExcelPngProbe {
  public static string[] Read(byte[] bytes) {
    using (var stream = new MemoryStream(bytes))
    using (var bitmap = new Bitmap(stream))
    using (var sha = SHA256.Create()) {
      var pixels = new byte[checked(bitmap.Width * bitmap.Height * 4)];
      var bounds = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
      var data = bitmap.LockBits(bounds, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      try {
        var row = new byte[bitmap.Width * 4];
        for (int y = 0; y < bitmap.Height; y++) {
          Marshal.Copy(IntPtr.Add(data.Scan0, y * data.Stride), row, 0, row.Length);
          for (int x = 0; x < bitmap.Width; x++) {
            int source = x * 4, target = (y * bitmap.Width + x) * 4;
            pixels[target] = row[source + 2];
            pixels[target + 1] = row[source + 1];
            pixels[target + 2] = row[source];
            pixels[target + 3] = row[source + 3];
          }
        }
      } finally { bitmap.UnlockBits(data); }
      return new[] {
        bitmap.Width.ToString(), bitmap.Height.ToString(),
        BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(),
        BitConverter.ToString(sha.ComputeHash(pixels)).Replace("-", "").ToLowerInvariant()
      };
    }
  }
}
'@
  function Get-PngEvidence([byte[]]$Bytes) {
    $result = [ExcelPngProbe]::Read($Bytes)
    return @{ width = [int]$result[0]; height = [int]$result[1]; sha256 = $result[2]; pixelSha256 = $result[3] }
  }
  function Assert-PngEvidence($Actual) {
    if ($Actual.width -ne $request.png.width -or $Actual.height -ne $request.png.height) {
      throw 'The pasted table picture has the wrong pixel dimensions.'
    }
    if ($Actual.pixelSha256 -cne $request.png.pixelSha256) {
      throw 'The pasted table picture pixels differ from the current selected products and saved preparation.'
    }
  }
  [Console]::Error.WriteLine('Excel probe: reading the native PNG clipboard.')
  $pngData = [System.Windows.Forms.Clipboard]::GetDataObject().GetData('PNG', $false)
  if ($pngData -is [IO.MemoryStream]) { $pngBytes = $pngData.ToArray() }
  elseif ($pngData -is [byte[]]) { $pngBytes = $pngData }
  else { throw 'The browser PNG clipboard was not delivered to Windows.' }
  $pngEvidence = Get-PngEvidence $pngBytes
  Assert-PngEvidence $pngEvidence
  $html = ''
} else {
  [Console]::Error.WriteLine('Excel probe: reading the native HTML clipboard.')
  $html = [System.Windows.Forms.Clipboard]::GetData('HTML Format')
  if (!$html) { throw 'The browser HTML clipboard was not delivered to Windows.' }
}

$imageMatches = [regex]::Matches([string]$html, 'data:image/png;base64,([A-Za-z0-9+/=]+)')
$clipboardImageHashes = @()
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  foreach ($match in $imageMatches) {
    $imageBytes = [Convert]::FromBase64String($match.Groups[1].Value)
    $clipboardImageHashes += ([BitConverter]::ToString($sha256.ComputeHash($imageBytes))).Replace('-', '').ToLowerInvariant()
  }
} finally { $sha256.Dispose() }
if ($request.imageHashes) {
  if ($clipboardImageHashes.Count -ne $request.imageHashes.Count) { throw 'Windows received the wrong number of label images.' }
  for ($index = 0; $index -lt $request.imageHashes.Count; $index++) {
    if ($clipboardImageHashes[$index] -ne $request.imageHashes[$index]) {
      throw 'The Windows clipboard label differs from the latest saved code and text.'
    }
  }
}

$excel = $null; $books = $null; $book = $null; $sheets = $null; $sheet = $null; $shapes = $null; $used = $null
try {
  # A new automation instance and a new unsaved workbook. Never attach to the
  # user's Excel session and never open supplied or existing workbook files.
  [Console]::Error.WriteLine('Excel probe: creating an automation instance.')
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $books = $excel.Workbooks
  [Console]::Error.WriteLine('Excel probe: creating a disposable workbook.')
  $book = $books.Add()
  $sheets = $book.Worksheets
  $sheet = $sheets.Item(1)
  if ($pngPaste) {
    $destination = $sheet.Range('A1:I8')
    try {
      $destination.NumberFormat = '@'
      $destination.RowHeight = 18
      $destination.ColumnWidth = 16
    } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($destination) }
    $sentinel = $sheet.Range('K1')
    try { $sentinel.Value2 = 'Disposable template: preserve this cell' }
    finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($sentinel) }
  }
  # Exercise a prepared destination range, without touching a real template.
  foreach ($expected in $request.cells) {
    $cell = $sheet.Range($expected.address)
    try {
      $cell.NumberFormat = if ($expected.kind -eq 'number') { '0.00' } else { '@' }
      $cell.RowHeight = 15
      $cell.ColumnWidth = 18
    } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($cell) }
  }
  $target = $sheet.Range('A1')
  try { $target.Select() | Out-Null } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($target) }
  if ($pngPaste) {
    [Console]::Error.WriteLine('Excel probe: pasting the browser PNG as a picture.')
    $sheet.Paste()
  } else {
    [Console]::Error.WriteLine('Excel probe: pasting browser clipboard HTML.')
    $sheet.PasteSpecial('HTML')
  }
  $used = $sheet.UsedRange
  $usedRows = $used.Rows
  $usedColumns = $used.Columns
  try { $rows = $usedRows.Count; $columns = $usedColumns.Count }
  finally {
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($usedRows)
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($usedColumns)
  }
  if ($request.rows -and $rows -ne $request.rows) { throw "Excel pasted $rows rows, expected $($request.rows)." }
  if ($request.columns -and $columns -ne $request.columns) { throw "Excel pasted $columns columns, expected $($request.columns)." }

  $checkedCells = @()
  foreach ($expected in $request.cells) {
    $cell = $sheet.Range($expected.address)
    try {
      $value = $cell.Value2
      if ($cell.HasFormula) { throw "Excel interpreted $($expected.address) as a formula." }
      if ($expected.kind -eq 'number') {
        if ($value -isnot [double] -or [Math]::Abs($value - [double]$expected.value) -gt 0.0000001) {
          throw "Excel did not preserve the numeric value in $($expected.address)."
        }
      } elseif ([string]$value -cne [string]$expected.value) {
        throw "Excel did not preserve the text in $($expected.address)."
      }
      $checkedCells += @{ address = $expected.address; value = $value; numeric = ($value -is [double]); formula = [bool]$cell.HasFormula }
    } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($cell) }
  }

  $shapes = $sheet.Shapes
  if ($shapes.Count -ne $request.images.Count) { throw "Excel pasted $($shapes.Count) images, expected $($request.images.Count)." }
  $checkedImages = @()
  for ($index = 1; $index -le $shapes.Count; $index++) {
    $shape = $shapes.Item($index)
    $anchor = $null
    try {
      $anchor = $shape.TopLeftCell
      $expected = $request.images[$index - 1]
      $widthMm = [double]$shape.Width * 25.4 / 72
      $heightMm = [double]$shape.Height * 25.4 / 72
      if ($expected.row -and $anchor.Row -ne $expected.row) { throw "Image $index is in the wrong Excel row." }
      if ($expected.column -and $anchor.Column -ne $expected.column) { throw "Image $index is in the wrong Excel column." }
      # Tolerance is approximately one or two screen pixels of Excel's point rounding.
      if ($expected.widthMm -and [Math]::Abs($widthMm - $expected.widthMm) -gt 0.4) { throw "Image $index width is $widthMm mm, expected $($expected.widthMm) mm." }
      if ($expected.heightMm -and [Math]::Abs($heightMm - $expected.heightMm) -gt 0.4) { throw "Image $index height is $heightMm mm, expected $($expected.heightMm) mm." }
      $checkedImages += @{ row = $anchor.Row; column = $anchor.Column; widthMm = [Math]::Round($widthMm, 3); heightMm = [Math]::Round($heightMm, 3) }
    } finally {
      if ($anchor) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($anchor) }
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shape)
    }
  }
  if ($pngPaste) {
    # Read the actual embedded image, not a screenshot of an Excel rendering.
    # The only file written is this new synthetic workbook in the temp folder.
    $disposablePath = Join-Path ([IO.Path]::GetTempPath()) ('1688topl-excel-probe-' + [guid]::NewGuid().ToString('N') + '.xlsx')
    $book.SaveAs($disposablePath, 51)
    # Excel still owns the saved workbook; permit its existing write handle
    # while inspecting the archive through a read-only stream.
    $fileStream = [IO.File]::Open($disposablePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    $archive = $null
    try {
      $archive = New-Object IO.Compression.ZipArchive($fileStream, [IO.Compression.ZipArchiveMode]::Read)
      $media = @($archive.Entries | Where-Object { $_.FullName -like 'xl/media/*' -and $_.Length -gt 0 })
      if ($media.Count -ne 1) { throw 'Excel did not store exactly one table picture.' }
      $stream = $media[0].Open()
      $buffer = New-Object IO.MemoryStream
      try {
        $stream.CopyTo($buffer)
        $workbookImageEvidence = Get-PngEvidence $buffer.ToArray()
        Assert-PngEvidence $workbookImageEvidence
      } finally { $buffer.Dispose(); $stream.Dispose() }
    } finally {
      if ($archive) { $archive.Dispose() }
      $fileStream.Dispose()
    }
  }
  $evidence = @{ case = $request.name; rows = $rows; columns = $columns; cells = $checkedCells; images = $checkedImages; clipboardImageHashes = $clipboardImageHashes; clipboardPng = $pngEvidence; workbookImage = $workbookImageEvidence; version = $excel.Version; pasteFormat = $(if ($pngPaste) { 'PNG (default paste)' } else { 'HTML' }) }
} finally {
  try {
    try {
      [Console]::Error.WriteLine('Excel probe: releasing worksheet references.')
      foreach ($name in @('used', 'shapes', 'sheet', 'sheets')) {
        $reference = (Get-Variable -Name $name).Value
        if ($null -ne $reference) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($reference) }
        Set-Variable -Name $name -Value $null
      }
    } finally {
      [Console]::Error.WriteLine('Excel probe: closing the disposable workbook.')
      if ($book) { $book.Close($false) }
    }
  } finally {
    try {
      foreach ($name in @('book', 'books')) {
        $reference = (Get-Variable -Name $name).Value
        if ($null -ne $reference) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($reference) }
        Set-Variable -Name $name -Value $null
      }
    } finally {
      try {
        [Console]::Error.WriteLine('Excel probe: quitting its automation instance.')
        if ($excel) { $excel.Quit() }
      } finally {
        if ($excel) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel); $excel = $null }
      }
      [Console]::Error.WriteLine('Excel probe: cleanup complete.')
      if ($disposablePath -and (Test-Path -LiteralPath $disposablePath)) {
        Remove-Item -LiteralPath $disposablePath
      }
    }
  }
}
$evidence | ConvertTo-Json -Compress -Depth 8
