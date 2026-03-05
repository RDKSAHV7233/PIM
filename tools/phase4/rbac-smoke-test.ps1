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
      $name = $parts[0].Trim()
      $value = $parts[1].Trim().Trim('"')
      [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

function Wait-ForApi {
  param(
    [string]$Url,
    [System.Diagnostics.Process]$Process,
    [int]$TimeoutSeconds = 60
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($null -ne $Process -and $Process.HasExited) {
      throw "API process exited before health check."
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

function Invoke-ApiJson {
  param(
    [string]$Url,
    [ValidateSet("GET", "POST", "PATCH", "DELETE")] [string]$Method = "GET",
    [hashtable]$Body = $null,
    [hashtable]$Headers = $null
  )

  if ($null -ne $Body) {
    if ($null -ne $Headers) {
      return Invoke-RestMethod -Uri $Url -Method $Method -Headers $Headers -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 10)
    }
    return Invoke-RestMethod -Uri $Url -Method $Method -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 10)
  }
  if ($null -ne $Headers) {
    return Invoke-RestMethod -Uri $Url -Method $Method -Headers $Headers
  }
  return Invoke-RestMethod -Uri $Url -Method $Method
}

function Assert-Forbidden {
  param(
    [scriptblock]$Action,
    [string]$Label
  )
  try {
    & $Action | Out-Null
    throw "$Label expected 403 Forbidden but request succeeded."
  } catch {
    $statusCode = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }
    if ($statusCode -ne 403) {
      throw "$Label expected 403 Forbidden but got $statusCode."
    }
  }
}

Load-EnvFile -Path (Join-Path $repoRoot ".env")
Set-SmokeTenantDatabaseUrl

$apiProc = $null
$port = Get-Random -Minimum 4100 -Maximum 4999
[System.Environment]::SetEnvironmentVariable("PORT", [string]$port, "Process")
$baseApiUrl = "http://127.0.0.1:$port/api/v1"

try {
  $apiProc = Start-Process -FilePath "node" -ArgumentList "apps/api/dist/main.js" -WorkingDirectory $repoRoot -PassThru
  Wait-ForApi -Url "$baseApiUrl/health" -Process $apiProc
  Enable-SmokeAuthDefaults -BaseApiUrl $baseApiUrl
  $adminHeaders = Get-SmokeAuthHeaders -BaseApiUrl $baseApiUrl -UserId "smoke-admin" -Role "admin"
  $editorHeaders = Get-SmokeAuthHeaders -BaseApiUrl $baseApiUrl -UserId "smoke-editor" -Role "editor"
  $viewerHeaders = Get-SmokeAuthHeaders -BaseApiUrl $baseApiUrl -UserId "smoke-viewer" -Role "viewer"

  $health = Invoke-ApiJson -Url "$baseApiUrl/health" -Method "GET"
  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

  $adminCategory = Invoke-ApiJson -Url "$baseApiUrl/taxonomy/categories" -Method "POST" -Headers $adminHeaders -Body @{
    name = "RBAC Category $ts"
  }

  Assert-Forbidden -Label "Editor create category" -Action {
    Invoke-ApiJson -Url "$baseApiUrl/taxonomy/categories" -Method "POST" -Headers $editorHeaders -Body @{
      name = "Should Fail"
    }
  }

  $editorProduct = Invoke-ApiJson -Url "$baseApiUrl/catalog/products" -Method "POST" -Headers $editorHeaders -Body @{
    title = "RBAC Product $ts"
    brand = "PIM1"
    description = "RBAC editor write check"
    categoryId = $adminCategory.id
    status = "draft"
  }

  Assert-Forbidden -Label "Viewer create product" -Action {
    Invoke-ApiJson -Url "$baseApiUrl/catalog/products" -Method "POST" -Headers $viewerHeaders -Body @{
      title = "Viewer Fail Product"
      brand = "PIM1"
      description = "RBAC viewer blocked check"
      categoryId = $adminCategory.id
      status = "draft"
    }
  }

  Assert-Forbidden -Label "Editor create attribute definition" -Action {
    Invoke-ApiJson -Url "$baseApiUrl/taxonomy/categories/$($adminCategory.id)/attributes" -Method "POST" -Headers $editorHeaders -Body @{
      key = "rbac_key"
      name = "RBAC Attr"
      dataType = "text"
      required = $false
      appliesTo = "product"
    }
  }

  $adminAttribute = Invoke-ApiJson -Url "$baseApiUrl/taxonomy/categories/$($adminCategory.id)/attributes" -Method "POST" -Headers $adminHeaders -Body @{
    key = "rbac_ok"
    name = "RBAC Allowed Attr"
    dataType = "text"
    required = $false
    appliesTo = "product"
  }

  $viewerProducts = Invoke-ApiJson -Url "$baseApiUrl/catalog/products" -Method "GET" -Headers $viewerHeaders

  $result = [PSCustomObject]@{
    health = $health.status
    adminCategoryId = $adminCategory.id
    editorProductId = $editorProduct.id
    adminAttributeId = $adminAttribute.id
    viewerReadableProducts = $viewerProducts.Count
    checks = @{
      editorBlockedOnTaxonomyWrite = $true
      viewerBlockedOnCatalogWrite = $true
      editorAllowedCatalogWrite = $true
      adminAllowedTaxonomyWrite = $true
      viewerAllowedReads = $true
    }
    checkedAt = (Get-Date).ToString("s")
  }
  Write-Output ($result | ConvertTo-Json -Compress)
} finally {
  Disable-SmokeAuthDefaults
  if ($null -ne $apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
}
