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

function Load-EnvFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return }
  Get-Content $Path | ForEach-Object {
    if ($_ -match "^\s*#" -or $_ -match "^\s*$") { return }
    $parts = $_.Split("=", 2)
    if ($parts.Length -eq 2) {
      $name = $parts[0].Trim()
      $value = $parts[1].Trim().Trim('"')
      [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

Load-EnvFile -Path (Join-Path $repoRoot ".env")
Set-SmokeTenantDatabaseUrl

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

  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

  $category = Invoke-RestMethod -Uri "$baseApiUrl/taxonomy/categories" -Method Post -ContentType "application/json" -Body (@{
      name = "Phase2 Category $ts"
    } | ConvertTo-Json)

  $attribute = Invoke-RestMethod -Uri "$baseApiUrl/taxonomy/categories/$($category.id)/attributes" -Method Post -ContentType "application/json" -Body (@{
      name      = "Fabric Type"
      key       = "fabric_type"
      dataType  = "text"
      required  = $true
      appliesTo = "product"
    } | ConvertTo-Json)

  $product = Invoke-RestMethod -Uri "$baseApiUrl/catalog/products" -Method Post -ContentType "application/json" -Body (@{
      title       = "Phase2 Product $ts"
      description = "Validation smoke test"
      brand       = "PIM1"
      categoryId  = $category.id
      status      = "draft"
      attributes  = @{}
    } | ConvertTo-Json -Depth 5)

  $issuesBefore = Invoke-RestMethod -Uri "$baseApiUrl/compliance/products/$($product.id)/issues" -Method Get
  if ($issuesBefore.Count -lt 2) {
    throw "Expected compliance issues after incomplete product save."
  }

  $null = Invoke-RestMethod -Uri "$baseApiUrl/catalog/products/$($product.id)" -Method Patch -ContentType "application/json" -Body (@{
      expectedVersion = if ($null -ne $product.version -and [int]$product.version -ge 1) { [int]$product.version } else { 1 }
      title       = $product.title
      description = $product.description
      brand       = $product.brand
      categoryId  = $product.categoryId
      status      = "active"
      hsnCode     = "62046200"
      gstRate     = 18
      attributes  = @{
        fabric_type = "cotton"
      }
    } | ConvertTo-Json -Depth 6)

  $null = Invoke-RestMethod -Uri "$baseApiUrl/compliance/products/$($product.id)/validate" -Method Post -ContentType "application/json" -Body "{}"
  $issuesAfter = Invoke-RestMethod -Uri "$baseApiUrl/compliance/products/$($product.id)/issues" -Method Get
  if ($issuesAfter.Count -ne 0) {
    throw "Expected zero open issues after compliant update."
  }

  $result = [PSCustomObject]@{
    categoryId            = $category.id
    attributeDefinitionId = $attribute.id
    productId             = $product.id
    issuesBefore          = $issuesBefore.Count
    issuesAfter           = $issuesAfter.Count
    checkedAt             = (Get-Date).ToString("s")
  }
  Write-Output ($result | ConvertTo-Json -Compress)
} finally {
  Disable-SmokeAuthDefaults
  if ($null -ne $apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
}
