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

function New-BenchmarkCsv {
  param([int]$Rows)
  $header = "product_name,brand_name,description,hsn_code,gst_rate,attributes"
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add($header)
  for ($i = 1; $i -le $Rows; $i += 1) {
    $attributes = """{""""color"""":""""black"""",""""size"""":""""M"""",""""row"""":$i}"""
    $line = "Benchmark Tee $i,PIM1,Benchmark row $i,62046200,18,$attributes"
    $lines.Add($line)
  }
  return ($lines -join "`n")
}

Load-EnvFile -Path (Join-Path $repoRoot ".env")

$apiProc = $null
$port = Get-Random -Minimum 4100 -Maximum 4999
[System.Environment]::SetEnvironmentVariable("PORT", [string]$port, "Process")
$baseApiUrl = "http://127.0.0.1:$port/api"
$targetRows = 1000
$chunkSize = 200

try {
  $apiProc = Start-Process -FilePath "node" -ArgumentList "apps/api/dist/main.js" -WorkingDirectory $repoRoot -PassThru
  Wait-ForApi -Url "$baseApiUrl/health" -Process $apiProc -TimeoutSeconds 60

  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $category = Invoke-RestMethod -Uri "$baseApiUrl/taxonomy/categories" -Method Post -ContentType "application/json" -Body (@{
      name = "Phase4 Benchmark $ts"
    } | ConvertTo-Json)

  $csvContent = New-BenchmarkCsv -Rows $targetRows
  $job = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs" -Method Post -ContentType "application/json" -Body (@{
      categoryId   = $category.id
      sourceFormat = "csv"
      sourceName   = "benchmark-1000.csv"
      csvContent   = $csvContent
      chunkSize    = $chunkSize
      maxRetries   = 3
    } | ConvertTo-Json -Depth 10)

  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  $iterations = 0
  $maxIterations = 30
  $current = $job
  while ($iterations -lt $maxIterations) {
    $iterations += 1
    $current = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs/$($job.id)/process" -Method Post -ContentType "application/json" -Body (@{
        chunkSize = $chunkSize
      } | ConvertTo-Json)

    if ($current.status -in @("completed", "dead_letter", "failed")) {
      break
    }
  }
  $timer.Stop()

  $finalJob = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs/$($job.id)" -Method Get
  $elapsedMs = [int][Math]::Round($timer.Elapsed.TotalMilliseconds)
  $elapsedSec = [Math]::Round($timer.Elapsed.TotalSeconds, 3)
  $successRate = if ($finalJob.totalRows -gt 0) {
    [Math]::Round(($finalJob.successRows * 100.0) / $finalJob.totalRows, 2)
  } else {
    0
  }
  $throughput = if ($elapsedSec -gt 0) {
    [Math]::Round($finalJob.successRows / $elapsedSec, 2)
  } else {
    0
  }

  if ($finalJob.totalRows -ne $targetRows) {
    throw "Benchmark row count mismatch. Expected $targetRows, got $($finalJob.totalRows)."
  }
  if ($finalJob.status -ne "completed") {
    throw "Benchmark job did not complete successfully. Final status: $($finalJob.status)."
  }
  if ($finalJob.successRows -ne $targetRows) {
    throw "Benchmark success rows mismatch. Expected $targetRows, got $($finalJob.successRows)."
  }

  $result = [PSCustomObject]@{
    benchmarkJobId      = $job.id
    targetRows          = $targetRows
    totalRows           = $finalJob.totalRows
    successRows         = $finalJob.successRows
    failedRows          = $finalJob.failedRows
    deadLetterRows      = $finalJob.deadLetterRows
    retryingRows        = $finalJob.metrics.retryingRows
    totalRetryAttempts  = $finalJob.metrics.totalRetryAttempts
    completedChunks     = $finalJob.metrics.completedChunks
    estimatedChunks     = $finalJob.metrics.estimatedChunks
    checkpointRow       = $finalJob.metrics.checkpointRow
    iterations          = $iterations
    elapsedMs           = $elapsedMs
    elapsedSec          = $elapsedSec
    throughputRowsPerSec = $throughput
    successRatePercent  = $successRate
    checkedAt           = (Get-Date).ToString("s")
  }
  Write-Output ($result | ConvertTo-Json -Compress)
} finally {
  if ($null -ne $apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
}
