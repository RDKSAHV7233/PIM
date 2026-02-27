$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot

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

$apiProc = $null
$apiOutLog = Join-Path $repoRoot "api-out.log"
$apiErrLog = Join-Path $repoRoot "api-err.log"
$port = Get-Random -Minimum 4100 -Maximum 4999
[System.Environment]::SetEnvironmentVariable("PORT", [string]$port, "Process")
$baseApiUrl = "http://127.0.0.1:$port/api"
try {
  $apiProc = Start-Process -FilePath "node" -ArgumentList "apps/api/dist/main.js" -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $apiOutLog -RedirectStandardError $apiErrLog
  Wait-ForApi -Url "$baseApiUrl/health" -Process $apiProc -StdOutLog $apiOutLog -StdErrLog $apiErrLog

  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $category = Invoke-RestMethod -Uri "$baseApiUrl/taxonomy/categories" -Method Post -ContentType "application/json" -Body (@{
      name = "Phase4 Category $ts"
    } | ConvertTo-Json)

  $mappingSuggestion = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/mapping-suggestions" -Method Post -ContentType "application/json" -Body (@{
      headers = @("product_name", "brand_name", "description", "hsn_code", "gst_rate", "attributes")
    } | ConvertTo-Json -Depth 5)
  if (-not $mappingSuggestion.mapping.title -or $mappingSuggestion.mapping.title -ne "product_name") {
    throw "Expected mapping suggestion to match product_name -> title."
  }

  $goodCsv = @"
product_name,brand_name,description,hsn_code,gst_rate,attributes
Good Tee 1,PIM1,Bulk row 1,62046200,18,""{""""color"""":""""black""""}""
Good Tee 2,PIM1,Bulk row 2,62046200,18,""{""""color"""":""""blue""""}""
"@

  $goodJob = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs" -Method Post -ContentType "application/json" -Body (@{
      categoryId   = $category.id
      sourceFormat = "csv"
      sourceName   = "phase4-good.csv"
      csvContent   = $goodCsv
      chunkSize    = 2
      maxRetries   = 2
    } | ConvertTo-Json -Depth 10)

  $goodProcessed = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs/$($goodJob.id)/process" -Method Post -ContentType "application/json" -Body (@{
      chunkSize = 2
    } | ConvertTo-Json)
  if ($goodProcessed.status -ne "completed" -or $goodProcessed.successRows -lt 2) {
    throw "Expected good bulk import job to complete with success rows."
  }

  $bulkEditPreview = Invoke-RestMethod -Uri "$baseApiUrl/bulk-edit/preview" -Method Post -ContentType "application/json" -Body (@{
      scope = @{
        categoryId = $category.id
        status = "draft"
      }
      updates = @{
        status = "active"
        gstRate = 12
      }
    } | ConvertTo-Json -Depth 10)
  if ($bulkEditPreview.requestedCount -lt 2) {
    throw "Expected bulk edit preview to match imported products."
  }

  $bulkEditApply = Invoke-RestMethod -Uri "$baseApiUrl/bulk-edit/apply" -Method Post -ContentType "application/json" -Body (@{
      scope = @{
        categoryId = $category.id
        status = "draft"
      }
      updates = @{
        status = "active"
        gstRate = 12
      }
    } | ConvertTo-Json -Depth 10)
  if ($bulkEditApply.status -eq "failed" -or $bulkEditApply.appliedCount -lt 2) {
    throw "Expected bulk edit apply to update imported products."
  }

  $bulkEditHistory = Invoke-RestMethod -Uri "$baseApiUrl/bulk-edit/operations?limit=5" -Method Get
  if ($bulkEditHistory.Count -lt 1) {
    throw "Expected bulk edit history to include at least one operation."
  }

  $bulkEditOperation = Invoke-RestMethod -Uri "$baseApiUrl/bulk-edit/operations/$($bulkEditApply.id)" -Method Get
  if ($bulkEditOperation.items.Count -lt 1) {
    throw "Expected bulk edit operation details to include item history."
  }

  $badJob = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs" -Method Post -ContentType "application/json" -Body (@{
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
    } | ConvertTo-Json -Depth 10)

  $badFirst = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/process" -Method Post -ContentType "application/json" -Body (@{
      chunkSize = 1
    } | ConvertTo-Json)
  if ($badFirst.status -ne "retrying") {
    throw "Expected bad job to be retrying after first process."
  }

  $badSecond = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/process" -Method Post -ContentType "application/json" -Body (@{
      chunkSize = 1
    } | ConvertTo-Json)
  if ($badSecond.status -ne "dead_letter" -or $badSecond.deadLetterRows -lt 1) {
    throw "Expected bad job to move to dead_letter."
  }

  $deadRows = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/rows?status=dead_letter&limit=10" -Method Get
  if ($deadRows.Count -lt 1) {
    throw "Expected at least one dead-letter row."
  }

  $fixedRow = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/rows/$($deadRows[0].id)/repair" -Method Post -ContentType "application/json" -Body (@{
      payload = @{
        title      = "Recovered Product"
        hsnCode    = "62046200"
        gstRate    = 18
        attributes = @{
          color = "black"
        }
      }
      requeue = $true
    } | ConvertTo-Json -Depth 10)
  if ($fixedRow.status -ne "queued") {
    throw "Expected repaired row to be queued."
  }

  $processedRow = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/rows/$($deadRows[0].id)/process" -Method Post -ContentType "application/json" -Body "{}"
  if ($processedRow.status -ne "success") {
    throw "Expected repaired row processing to succeed."
  }

  $badJobAfterFix = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)" -Method Get
  if ($badJobAfterFix.status -ne "completed") {
    throw "Expected repaired bulk job to become completed."
  }

  $requeued = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/requeue-dlq" -Method Post -ContentType "application/json" -Body (@{
      limit = 5
    } | ConvertTo-Json)
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
  if ($null -ne $apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
}

