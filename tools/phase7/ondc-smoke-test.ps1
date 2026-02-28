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
    try { Invoke-RestMethod -Uri $Url -Method Get | Out-Null; return } catch { Start-Sleep -Milliseconds 500 }
  }
  throw "API did not become healthy."
}

Load-EnvFile -Path (Join-Path $repoRoot ".env")

$apiProc = $null
$port = Get-Random -Minimum 4100 -Maximum 4999
[System.Environment]::SetEnvironmentVariable("PORT", [string]$port, "Process")
$baseApiUrl = "http://127.0.0.1:$port/api"

try {
  $apiProc = Start-Process -FilePath "node" -ArgumentList "apps/api/dist/main.js" -WorkingDirectory $repoRoot -PassThru
  Wait-ForApi -Url "$baseApiUrl/health" -Process $apiProc

  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $category = Invoke-RestMethod -Uri "$baseApiUrl/taxonomy/categories" -Method Post -ContentType "application/json" -Body (@{ name = "ONDC Smoke Category $ts" } | ConvertTo-Json)
  $product = Invoke-RestMethod -Uri "$baseApiUrl/catalog/products" -Method Post -ContentType "application/json" -Body (@{
      title = "ONDC Smoke Product $ts"
      brand = "PIM1"
      description = "ONDC test"
      categoryId = $category.id
      hsnCode = "62046200"
      gstRate = 18
      status = "draft"
    } | ConvertTo-Json)

  $mapping = Invoke-RestMethod -Uri "$baseApiUrl/ondc/mappings" -Method Post -ContentType "application/json" -Body (@{
      name = "ONDC Smoke Mapping"
      categoryId = $category.id
      nodeType = "seller_app"
      version = "1.2.0"
      requiredFields = @("title", "brand", "hsnCode")
      fieldMap = @{
        title = "descriptor.name"
        brand = "descriptor.brand"
        hsnCode = "item.hsn_code"
      }
      discoveryMetadata = @{
        domain = "ONDC:RET10"
      }
      isDefault = $true
    } | ConvertTo-Json -Depth 10)

  $simulation = Invoke-RestMethod -Uri "$baseApiUrl/ondc/products/$($product.id)/simulate?nodeType=seller_app&version=1.2.0" -Method Get
  if ($simulation.mappingId -ne $mapping.id) {
    throw "Expected default ONDC mapping to be selected."
  }

  $result = [PSCustomObject]@{
    productId = $product.id
    mappingId = $mapping.id
    publishReady = $simulation.publishReady
    missingFieldCount = $simulation.missingFields.Count
    checkedAt = (Get-Date).ToString("s")
  }
  Write-Output ($result | ConvertTo-Json -Compress)
} finally {
  if ($null -ne $apiProc -and -not $apiProc.HasExited) { Stop-Process -Id $apiProc.Id -Force }
}
