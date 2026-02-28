$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot

function Load-EnvFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return }
  Get-Content $Path | ForEach-Object {
    if ($_ -match "^\s*#" -or $_ -match "^\s*$") { return }
    $parts = $_.Split("=", 2)
    if ($parts.Length -eq 2) {
      [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim().Trim('"'), "Process")
    }
  }
}

function Wait-ForApi {
  param([string]$Url, [System.Diagnostics.Process]$Process, [int]$TimeoutSeconds = 60)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($null -ne $Process -and $Process.HasExited) { throw "API exited before health check." }
    try {
      Invoke-RestMethod -Uri $Url -Method Get | Out-Null
      return
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  throw "API did not become healthy."
}

Load-EnvFile -Path (Join-Path $repoRoot ".env")

$apiProc = $null
$port = Get-Random -Minimum 4100 -Maximum 4999
[System.Environment]::SetEnvironmentVariable("PORT", [string]$port, "Process")
$baseApiUrl = "http://127.0.0.1:$port/api"
$tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgQfXl7wAAAAASUVORK5CYII="

try {
  $apiProc = Start-Process -FilePath "node" -ArgumentList "apps/api/dist/main.js" -WorkingDirectory $repoRoot -PassThru
  Wait-ForApi -Url "$baseApiUrl/health" -Process $apiProc

  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $category = Invoke-RestMethod -Uri "$baseApiUrl/taxonomy/categories" -Method Post -ContentType "application/json" -Body (@{
      name = "Phase5 Bulk Media Category $ts"
    } | ConvertTo-Json)

  $product = Invoke-RestMethod -Uri "$baseApiUrl/catalog/products" -Method Post -ContentType "application/json" -Body (@{
      title = "Phase5 Bulk Media Product $ts"
      brand = "PIM1"
      description = "Bulk media mapping smoke"
      categoryId = $category.id
      status = "draft"
    } | ConvertTo-Json)

  $skuCode = "BULK-MEDIA-$ts"
  $variant = Invoke-RestMethod -Uri "$baseApiUrl/catalog/products/$($product.id)/variants" -Method Post -ContentType "application/json" -Body (@{
      skuCode = $skuCode
      status = "draft"
      inventoryQty = 0
      attributes = @{
        color = "black"
      }
    } | ConvertTo-Json -Depth 10)

  $csv = @"
skuCode,contentBase64,fileName,mimeType,width,height
$skuCode,$tinyPngBase64,bulk-smoke.png,image/png,1200,1200
"@

  $bulk = Invoke-RestMethod -Uri "$baseApiUrl/media/bulk-associations" -Method Post -ContentType "application/json" -Body (@{
      csvContent = $csv
    } | ConvertTo-Json -Depth 10)

  if ($bulk.successRows -ne 1 -or $bulk.failedRows -ne 0) {
    throw "Expected 1 success and 0 failure in bulk association."
  }
  if (-not $bulk.rows[0].assetId) {
    throw "Expected bulk association row to return asset id."
  }

  $bulkDedup = Invoke-RestMethod -Uri "$baseApiUrl/media/bulk-associations" -Method Post -ContentType "application/json" -Body (@{
      csvContent = $csv
    } | ConvertTo-Json -Depth 10)
  if (-not $bulkDedup.rows[0].deduplicated) {
    throw "Expected second bulk association to mark deduplicated."
  }

  $assets = Invoke-RestMethod -Uri "$baseApiUrl/media/assets?variantId=$($variant.id)" -Method Get
  if ($assets.Count -lt 1) {
    throw "Expected media assets linked to variant after bulk association."
  }

  $result = [PSCustomObject]@{
    productId = $product.id
    variantId = $variant.id
    skuCode = $skuCode
    firstRunSuccess = $bulk.successRows
    secondRunDeduplicated = [bool]$bulkDedup.rows[0].deduplicated
    assetCount = $assets.Count
    checkedAt = (Get-Date).ToString("s")
  }
  Write-Output ($result | ConvertTo-Json -Compress)
} finally {
  if ($null -ne $apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
}
