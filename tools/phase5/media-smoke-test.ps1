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
  $category = Invoke-RestMethod -Uri "$baseApiUrl/taxonomy/categories" -Method Post -ContentType "application/json" -Body (@{ name = "Media Smoke Category $ts" } | ConvertTo-Json)
  $product = Invoke-RestMethod -Uri "$baseApiUrl/catalog/products" -Method Post -ContentType "application/json" -Body (@{
      title = "Media Smoke Product $ts"
      brand = "PIM1"
      description = "Media smoke description"
      categoryId = $category.id
      status = "draft"
    } | ConvertTo-Json)

  $asset = Invoke-RestMethod -Uri "$baseApiUrl/media/assets" -Method Post -ContentType "application/json" -Body (@{
      productId = $product.id
      fileName = "smoke-image.png"
      mimeType = "image/png"
      contentBase64 = $tinyPngBase64
      width = 1200
      height = 1200
    } | ConvertTo-Json -Depth 10)

  $validation = Invoke-RestMethod -Uri "$baseApiUrl/media/assets/$($asset.id)/validation?channel=amazon" -Method Get
  if (-not $validation.valid) {
    throw "Expected media validation to pass for amazon."
  }

  $list = Invoke-RestMethod -Uri "$baseApiUrl/media/assets?productId=$($product.id)" -Method Get
  if ($list.Count -lt 1) {
    throw "Expected at least one media asset for product."
  }

  $result = [PSCustomObject]@{
    productId = $product.id
    assetId = $asset.id
    channel = "amazon"
    valid = $validation.valid
    assetCount = $list.Count
    checkedAt = (Get-Date).ToString("s")
  }
  Write-Output ($result | ConvertTo-Json -Compress)
} finally {
  if ($null -ne $apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
}
