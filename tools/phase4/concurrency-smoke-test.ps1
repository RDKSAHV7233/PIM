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
    [hashtable]$Body = $null
  )

  if ($null -ne $Body) {
    return Invoke-RestMethod -Uri $Url -Method $Method -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 10)
  }
  return Invoke-RestMethod -Uri $Url -Method $Method
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

  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $category = Invoke-ApiJson -Url "$baseApiUrl/taxonomy/categories" -Method "POST" -Body @{
    name = "Concurrency Category $ts"
  }

  $created = Invoke-ApiJson -Url "$baseApiUrl/catalog/products" -Method "POST" -Body @{
    title = "Concurrency Product $ts"
    description = "Base product"
    brand = "PIM1"
    categoryId = $category.id
    status = "draft"
  }

  $firstUpdate = Invoke-ApiJson -Url "$baseApiUrl/catalog/products/$($created.id)" -Method "PATCH" -Body @{
    expectedVersion = 1
    title = "Concurrency Product Updated"
    description = "Updated once"
    brand = "PIM1"
    categoryId = $category.id
    status = "active"
    attributes = @{}
  }

  $conflictCode = ""
  $conflictCurrentVersion = $null
  try {
    $null = Invoke-ApiJson -Url "$baseApiUrl/catalog/products/$($created.id)" -Method "PATCH" -Body @{
      expectedVersion = 1
      title = "Stale Update Attempt"
      description = "Should fail"
      brand = "PIM1"
      categoryId = $category.id
      status = "active"
      attributes = @{}
    }
    throw "Expected stale update attempt to return 409 conflict."
  } catch {
    if (-not $_.Exception.Response) {
      throw
    }
    $status = [int]$_.Exception.Response.StatusCode
    if ($status -ne 409) {
      throw "Expected 409 conflict, got $status"
    }
    $body = $_.ErrorDetails.Message
    if (-not $body) {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $body = $reader.ReadToEnd()
    }
    if (-not $body) {
      throw "Expected conflict payload body."
    }
    $parsed = $body | ConvertFrom-Json
    $conflictCode = $parsed.code
    if (-not $conflictCode -and $parsed.message -and $parsed.message.code) {
      $conflictCode = $parsed.message.code
    }
    $conflictCurrentVersion = $parsed.currentVersion
    if (-not $conflictCurrentVersion -and $parsed.message -and $parsed.message.currentVersion) {
      $conflictCurrentVersion = $parsed.message.currentVersion
    }
    if (-not $conflictCode) {
      throw "Expected VERSION_CONFLICT code in payload."
    }
  }

  $latest = Invoke-ApiJson -Url "$baseApiUrl/catalog/products/$($created.id)" -Method "GET"
  if ($latest.version -ne 2) {
    throw "Expected latest product version to be 2 after first update."
  }

  $result = [PSCustomObject]@{
    productId = $created.id
    createdVersion = $created.version
    firstUpdateVersion = $firstUpdate.version
    conflictCode = $conflictCode
    conflictCurrentVersion = $conflictCurrentVersion
    finalVersion = $latest.version
    finalStatus = $latest.status
    checkedAt = (Get-Date).ToString("s")
  }
  Write-Output ($result | ConvertTo-Json -Compress)
} finally {
  Disable-SmokeAuthDefaults
  if ($null -ne $apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
}
