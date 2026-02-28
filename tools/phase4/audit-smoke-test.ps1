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
    [string]$Role = "admin",
    [string]$Actor = "audit-smoke"
  )
  $headers = @{
    "x-pim-role" = $Role
    "x-pim-actor" = $Actor
  }

  if ($null -ne $Body) {
    return Invoke-RestMethod -Uri $Url -Method $Method -Headers $headers -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 10)
  }
  return Invoke-RestMethod -Uri $Url -Method $Method -Headers $headers
}

Load-EnvFile -Path (Join-Path $repoRoot ".env")

$apiProc = $null
$port = Get-Random -Minimum 4100 -Maximum 4999
[System.Environment]::SetEnvironmentVariable("PORT", [string]$port, "Process")
$baseApiUrl = "http://127.0.0.1:$port/api"
$actor = "audit-smoke"

try {
  $apiProc = Start-Process -FilePath "node" -ArgumentList "apps/api/dist/main.js" -WorkingDirectory $repoRoot -PassThru
  Wait-ForApi -Url "$baseApiUrl/health" -Process $apiProc

  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $category = Invoke-ApiJson -Url "$baseApiUrl/taxonomy/categories" -Method "POST" -Role "admin" -Actor $actor -Body @{
    name = "Audit Category $ts"
  }

  $product = Invoke-ApiJson -Url "$baseApiUrl/catalog/products" -Method "POST" -Role "editor" -Actor $actor -Body @{
    title = "Audit Product $ts"
    brand = "PIM1"
    description = "Audit baseline validation"
    categoryId = $category.id
    status = "draft"
  }

  $bulkEdit = Invoke-ApiJson -Url "$baseApiUrl/bulk-edit/apply" -Method "POST" -Role "editor" -Actor $actor -Body @{
    scope = @{
      categoryId = $category.id
      status = "draft"
    }
    updates = @{
      status = "active"
    }
  }

  Start-Sleep -Milliseconds 800

  $logs = Invoke-ApiJson -Url "$baseApiUrl/audit/logs?actorId=$actor&limit=30" -Method "GET" -Role "admin" -Actor $actor
  if ($logs.Count -lt 3) {
    throw "Expected at least 3 audit log records for actor '$actor'."
  }

  $categoryLog = $logs | Where-Object { $_.resource -like "*/taxonomy/categories*" } | Select-Object -First 1
  $productLog = $logs | Where-Object { $_.resource -like "*/catalog/products*" } | Select-Object -First 1
  $bulkLog = $logs | Where-Object { $_.resource -like "*/bulk-edit/apply*" } | Select-Object -First 1
  if ($null -eq $categoryLog -or $null -eq $productLog -or $null -eq $bulkLog) {
    throw "Missing expected audit entries for taxonomy/catalog/bulk-edit operations."
  }

  foreach ($log in $logs | Select-Object -First 3) {
    if (-not $log.actorId -or -not $log.action -or -not $log.resource -or -not $log.createdAt) {
      throw "Audit log missing required baseline fields (actor/action/resource/timestamp)."
    }
  }

  $result = [PSCustomObject]@{
    actor = $actor
    categoryId = $category.id
    productId = $product.id
    bulkEditOperationId = $bulkEdit.id
    auditRecordsFetched = $logs.Count
    categoryAuditAction = $categoryLog.action
    productAuditAction = $productLog.action
    bulkAuditAction = $bulkLog.action
    checkedAt = (Get-Date).ToString("s")
  }
  Write-Output ($result | ConvertTo-Json -Compress)
} finally {
  if ($null -ne $apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
}
