$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot
. (Join-Path $repoRoot "tools\dev\smoke-tenant.ps1")
. (Join-Path $repoRoot "tools\\dev\\smoke-auth.ps1")

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

function Get-FreePort {
  param(
    [int]$Min = 4100,
    [int]$Max = 4999,
    [int]$Attempts = 20
  )

  for ($i = 0; $i -lt $Attempts; $i++) {
    $candidate = Get-Random -Minimum $Min -Maximum $Max
    $listening = netstat -ano | Select-String -Pattern "LISTENING" | Select-String -Pattern "[:\.]$candidate\s"
    if (-not $listening) {
      return $candidate
    }
  }
  throw "Unable to find a free port in range $Min-$Max."
}

Load-EnvFile -Path (Join-Path $repoRoot ".env")
Set-SmokeTenantDatabaseUrl

$apiProc = $null
$port = Get-FreePort
[System.Environment]::SetEnvironmentVariable("PORT", [string]$port, "Process")
$baseApiUrl = "http://127.0.0.1:$port/api/v1"

try {
  $apiProc = Start-Process -FilePath "node" -ArgumentList "apps/api/dist/main.js" -WorkingDirectory $repoRoot -PassThru
  Wait-ForApi -Url "$baseApiUrl/health" -Process $apiProc -TimeoutSeconds 90
  Enable-SmokeAuthDefaults -BaseApiUrl $baseApiUrl

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
  Disable-SmokeAuthDefaults
  if ($null -ne $apiProc -and -not $apiProc.HasExited) { Stop-Process -Id $apiProc.Id -Force }
}
