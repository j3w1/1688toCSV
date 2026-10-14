param([Parameter(Mandatory = $true)][string]$RequestBase64)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($RequestBase64)) | ConvertFrom-Json
[Console]::Error.WriteLine('Excel probe: reading the native HTML clipboard.')
$html = [System.Windows.Forms.Clipboard]::GetData('HTML Format')
if (!$html) { throw 'The browser HTML clipboard was not delivered to Windows.' }

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
  [Console]::Error.WriteLine('Excel probe: pasting browser clipboard HTML.')
  $sheet.PasteSpecial('HTML')
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
  $evidence = @{ case = $request.name; rows = $rows; columns = $columns; cells = $checkedCells; images = $checkedImages; clipboardImageHashes = $clipboardImageHashes; version = $excel.Version; pasteFormat = 'HTML' }
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
    }
  }
}
$evidence | ConvertTo-Json -Compress -Depth 8
