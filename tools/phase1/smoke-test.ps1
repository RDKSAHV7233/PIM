$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot
. (Join-Path $repoRoot "tools\dev\smoke-tenant.ps1")
. (Join-Path $repoRoot "tools\\dev\\smoke-auth.ps1")

function Wait-ForApi {
  param(
    [string]$Url,
    [System.Diagnostics.Process]$Process,
    [string]$StdOutLog,
    [string]$StdErrLog,
    [int]$TimeoutSeconds = 60
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($null -ne $Process -and $Process.HasExited) {
      $stdout = if (Test-Path $StdOutLog) { (Get-Content $StdOutLog -Tail 80) -join "`n" } else { "" }
      $stderr = if (Test-Path $StdErrLog) { (Get-Content $StdErrLog -Tail 80) -join "`n" } else { "" }
      throw "API process exited before health check.`n--- stdout ---`n$stdout`n--- stderr ---`n$stderr"
    }
    try {
      $null = Invoke-RestMethod -Uri $Url -Method Get
      return
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  throw "API did not become healthy within $TimeoutSeconds seconds."
}

$envFile = Join-Path $repoRoot ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match "^\s*#") { return }
    if ($_ -match "^\s*$") { return }
    $parts = $_.Split("=", 2)
    if ($parts.Length -eq 2) {
      $name = $parts[0].Trim()
      $value = $parts[1].Trim().Trim('"')
      [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

Set-SmokeTenantDatabaseUrl
[System.Environment]::SetEnvironmentVariable("PIM_DEFAULT_ROLE", "admin", "Process")
[System.Environment]::SetEnvironmentVariable(
  "PIM_AUTH_IDENTITIES_JSON",
  (@{
      "smoke-admin" = @{
        tenantId = $env:PIM_SMOKE_TENANT_KEY
        role = "admin"
      }
    } | ConvertTo-Json -Compress),
  "Process"
)

$apiProc = $null
$apiOutLog = Join-Path $repoRoot "api-out.log"
$apiErrLog = Join-Path $repoRoot "api-err.log"
$port = Get-Random -Minimum 4100 -Maximum 4999
[System.Environment]::SetEnvironmentVariable("PORT", [string]$port, "Process")
$baseApiUrl = "http://127.0.0.1:$port/api/v1"
try {
  $apiProc = Start-Process -FilePath "node" -ArgumentList "apps/api/dist/main.js" -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $apiOutLog -RedirectStandardError $apiErrLog
  Wait-ForApi -Url "$baseApiUrl/health" -Process $apiProc -StdOutLog $apiOutLog -StdErrLog $apiErrLog
  Enable-SmokeAuthDefaults -BaseApiUrl $baseApiUrl

  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $categoryPayload = @{
    name = "Smoke Category $now"
  } | ConvertTo-Json

  $category = Invoke-RestMethod -Uri "$baseApiUrl/taxonomy/categories" -Method Post -ContentType "application/json" -Body $categoryPayload

  $productPayload = @{
    title       = "Smoke Product $now"
    description = "Phase 1 runtime smoke validation"
    brand       = "PIM1"
    categoryId  = $category.id
    status      = "draft"
  } | ConvertTo-Json
  $product = Invoke-RestMethod -Uri "$baseApiUrl/catalog/products" -Method Post -ContentType "application/json" -Body $productPayload

  $variantPayload = @{
    skuCode      = "SMOKE-$now"
    attributes   = @{
      size  = "M"
      color = "Black"
    }
    mrp          = 999
    sellingPrice = 799
    inventoryQty = 5
    status       = "active"
  } | ConvertTo-Json -Depth 6

  $variant = Invoke-RestMethod -Uri "$baseApiUrl/catalog/products/$($product.id)/variants" -Method Post -ContentType "application/json" -Body $variantPayload
  $productDetail = Invoke-RestMethod -Uri "$baseApiUrl/catalog/products/$($product.id)" -Method Get

  $result = [PSCustomObject]@{
    health          = "ok"
    categoryCreated = $category.id
    productCreated  = $product.id
    variantCreated  = $variant.id
    productVariants = $productDetail.variants.Count
    checkedAt       = (Get-Date).ToString("s")
  }

  Write-Output ($result | ConvertTo-Json -Compress)
} finally {
  Disable-SmokeAuthDefaults
  if ($null -ne $apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
}
