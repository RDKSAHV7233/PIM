$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot
. (Join-Path $repoRoot "tools\dev\smoke-tenant.ps1")
. (Join-Path $repoRoot "tools\\dev\\smoke-auth.ps1")
$script:apiOutLog = $null
$script:apiErrLog = $null

function Invoke-SmokeApi {
  param(
    [string]$Step,
    [string]$Uri,
    [string]$Method = "Get",
    [object]$Body = $null,
    [string]$ContentType = "application/json",
    [int]$TimeoutSeconds = 30
  )

  Write-Host "[phase4-smoke] $Step :: $Method $Uri"
  $params = @{
    Uri        = $Uri
    Method     = $Method
    TimeoutSec = $TimeoutSeconds
  }

  if ($null -ne $Body) {
    $jsonBody = if ($Body -is [string]) { $Body } else { ($Body | ConvertTo-Json -Depth 20) }
    $params["ContentType"] = $ContentType
    $params["Body"] = $jsonBody
  }

  try {
    return Invoke-RestMethod @params
  } catch {
    $stdout = if ($script:apiOutLog -and (Test-Path $script:apiOutLog)) { (Get-Content $script:apiOutLog -Tail 80) -join "`n" } else { "" }
    $stderr = if ($script:apiErrLog -and (Test-Path $script:apiErrLog)) { (Get-Content $script:apiErrLog -Tail 80) -join "`n" } else { "" }
    throw "Smoke step failed: $Step`nEndpoint: $Method $Uri`nTimeout: ${TimeoutSeconds}s`nError: $($_.Exception.Message)`n--- API stdout ---`n$stdout`n--- API stderr ---`n$stderr"
  }
}

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
$script:apiOutLog = $apiOutLog
$script:apiErrLog = $apiErrLog
$port = Get-Random -Minimum 4100 -Maximum 4999
[System.Environment]::SetEnvironmentVariable("PORT", [string]$port, "Process")
$baseApiUrl = "http://127.0.0.1:$port/api/v1"
try {
  $apiProc = Start-Process -FilePath "node" -ArgumentList "apps/api/dist/main.js" -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $apiOutLog -RedirectStandardError $apiErrLog
  Wait-ForApi -Url "$baseApiUrl/health" -Process $apiProc -StdOutLog $apiOutLog -StdErrLog $apiErrLog
  Enable-SmokeAuthDefaults -BaseApiUrl $baseApiUrl

  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $category = Invoke-SmokeApi -Step "Create category" -Uri "$baseApiUrl/taxonomy/categories" -Method Post -Body (@{
      name = "Phase4 Category $ts"
    })

  $mappingSuggestion = Invoke-SmokeApi -Step "Get mapping suggestions" -Uri "$baseApiUrl/bulk-import/mapping-suggestions" -Method Post -Body (@{
      headers = @("product_name", "brand_name", "description", "hsn_code", "gst_rate", "attributes")
    })
  if (-not $mappingSuggestion.mapping.title -or $mappingSuggestion.mapping.title -ne "product_name") {
    throw "Expected mapping suggestion to match product_name -> title."
  }

  $goodCsv = @"
product_name,brand_name,description,hsn_code,gst_rate,attributes
Good Tee 1,PIM1,Bulk row 1,62046200,18,""{""""color"""":""""black""""}""
Good Tee 2,PIM1,Bulk row 2,62046200,18,""{""""color"""":""""blue""""}""
"@

  $goodJob = Invoke-SmokeApi -Step "Create good bulk job" -Uri "$baseApiUrl/bulk-import/jobs" -Method Post -Body (@{
      categoryId   = $category.id
      sourceFormat = "csv"
      sourceName   = "phase4-good.csv"
      csvContent   = $goodCsv
      chunkSize    = 2
      maxRetries   = 2
    })

  $goodProcessed = Invoke-SmokeApi -Step "Process good bulk job" -Uri "$baseApiUrl/bulk-import/jobs/$($goodJob.id)/process" -Method Post -Body (@{
      chunkSize = 2
    })
  if ($goodProcessed.status -ne "completed" -or $goodProcessed.successRows -lt 2) {
    throw "Expected good bulk import job to complete with success rows."
  }

  $bulkEditPreview = Invoke-SmokeApi -Step "Bulk edit preview" -Uri "$baseApiUrl/bulk-edit/preview" -Method Post -Body (@{
      scope = @{
        categoryId = $category.id
        status = "draft"
      }
      updates = @{
        status = "active"
        gstRate = 12
      }
    })
  if ($bulkEditPreview.requestedCount -lt 2) {
    throw "Expected bulk edit preview to match imported products."
  }

  $bulkEditApply = Invoke-SmokeApi -Step "Bulk edit apply" -Uri "$baseApiUrl/bulk-edit/apply" -Method Post -Body (@{
      scope = @{
        categoryId = $category.id
        status = "draft"
      }
      updates = @{
        status = "active"
        gstRate = 12
      }
    })
  if ($bulkEditApply.status -eq "failed" -or $bulkEditApply.appliedCount -lt 2) {
    throw "Expected bulk edit apply to update imported products."
  }

  $bulkEditHistory = Invoke-SmokeApi -Step "Fetch bulk edit history" -Uri "$baseApiUrl/bulk-edit/operations?limit=5"
  if ($bulkEditHistory.Count -lt 1) {
    throw "Expected bulk edit history to include at least one operation."
  }

  $bulkEditOperation = Invoke-SmokeApi -Step "Fetch bulk edit operation details" -Uri "$baseApiUrl/bulk-edit/operations/$($bulkEditApply.id)"
  if ($bulkEditOperation.items.Count -lt 1) {
    throw "Expected bulk edit operation details to include item history."
  }

  $badJob = Invoke-SmokeApi -Step "Create bad bulk job" -Uri "$baseApiUrl/bulk-import/jobs" -Method Post -Body (@{
      categoryId   = $category.id
      sourceFormat = "json"
      sourceName   = "phase4-bad.json"
      rows         = @(
        @{
          brand       = "PIM1"
          description = "Missing title to trigger retries"
        }
      )
      chunkSize    = 1
      maxRetries   = 2
    })

  $badFirst = Invoke-SmokeApi -Step "Process bad job attempt 1" -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/process" -Method Post -Body (@{
      chunkSize = 1
    })
  if ($badFirst.status -ne "retrying") {
    throw "Expected bad job to be retrying after first process."
  }

  $badSecond = Invoke-SmokeApi -Step "Process bad job attempt 2" -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/process" -Method Post -Body (@{
      chunkSize = 1
    })
  if ($badSecond.status -ne "dead_letter" -or $badSecond.deadLetterRows -lt 1) {
    throw "Expected bad job to move to dead_letter."
  }

  $deadRows = Invoke-SmokeApi -Step "Fetch dead-letter rows" -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/rows?status=dead_letter&limit=10"
  if ($deadRows.Count -lt 1) {
    throw "Expected at least one dead-letter row."
  }

  $fixedRow = Invoke-SmokeApi -Step "Repair dead-letter row" -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/rows/$($deadRows[0].id)/repair" -Method Post -Body (@{
      payload = @{
        title      = "Recovered Product"
        hsnCode    = "62046200"
        gstRate    = 18
        attributes = @{
          color = "black"
        }
      }
      requeue = $true
    })
  if ($fixedRow.status -ne "queued") {
    throw "Expected repaired row to be queued."
  }

  $processedRow = Invoke-SmokeApi -Step "Process repaired row" -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/rows/$($deadRows[0].id)/process" -Method Post -Body "{}"
  if ($processedRow.status -ne "success") {
    throw "Expected repaired row processing to succeed."
  }

  $badJobAfterFix = Invoke-SmokeApi -Step "Fetch bad job after repair" -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)"
  if ($badJobAfterFix.status -ne "completed") {
    throw "Expected repaired bulk job to become completed."
  }

  $requeued = Invoke-SmokeApi -Step "Requeue DLQ rows" -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/requeue-dlq" -Method Post -Body (@{
      limit = 5
    })
  if ($requeued.deadLetterRows -ne 0) {
    throw "Expected no DLQ rows remaining after repair flow."
  }

  $result = [PSCustomObject]@{
    goodJobId        = $goodJob.id
    goodJobStatus    = $goodProcessed.status
    goodSuccessRows  = $goodProcessed.successRows
    mappingTitle     = $mappingSuggestion.mapping.title
    bulkEditPreview  = $bulkEditPreview.requestedCount
    bulkEditApplyId  = $bulkEditApply.id
    bulkEditApplied  = $bulkEditApply.appliedCount
    badJobId         = $badJob.id
    badFirstStatus   = $badFirst.status
    badSecondStatus  = $badSecond.status
    repairedRow      = $processedRow.id
    repairedStatus   = $processedRow.status
    badJobAfterFix   = $badJobAfterFix.status
    requeuedStatus   = $requeued.status
    requeuedDlqRows  = $requeued.deadLetterRows
    checkedAt        = (Get-Date).ToString("s")
  }
  Write-Output ($result | ConvertTo-Json -Compress)
} finally {
  Disable-SmokeAuthDefaults
  if ($null -ne $apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
}

