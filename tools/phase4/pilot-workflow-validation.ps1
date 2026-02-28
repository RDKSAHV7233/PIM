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

Load-EnvFile -Path (Join-Path $repoRoot ".env")

$apiProc = $null
$port = Get-Random -Minimum 4100 -Maximum 4999
[System.Environment]::SetEnvironmentVariable("PORT", [string]$port, "Process")
$baseApiUrl = "http://127.0.0.1:$port/api"

try {
  $apiProc = Start-Process -FilePath "node" -ArgumentList "apps/api/dist/main.js" -WorkingDirectory $repoRoot -PassThru
  Wait-ForApi -Url "$baseApiUrl/health" -Process $apiProc

  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $tenantKey = "pilot-tenant"
  $category = Invoke-RestMethod -Uri "$baseApiUrl/taxonomy/categories" -Method Post -ContentType "application/json" -Body (@{
      name = "Pilot Category $ts"
    } | ConvertTo-Json)

  $null = Invoke-RestMethod -Uri "$baseApiUrl/taxonomy/categories/$($category.id)/attributes" -Method Post -ContentType "application/json" -Body (@{
      key = "fabric"
      name = "Fabric"
      dataType = "text"
      required = $false
      appliesTo = "product"
    } | ConvertTo-Json)

  $templateV1 = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/templates" -Method Post -ContentType "application/json" -Body (@{
      tenantKey = $tenantKey
      categoryId = $category.id
      name = "Pilot Fashion Template"
      sourceFormat = "csv"
      mapping = @{
        title = "product_name"
        brand = "brand_name"
        description = "description"
        hsnCode = "hsn_code"
        gstRate = "gst_rate"
        attributes = "attributes"
      }
      chunkSize = 50
      maxRetries = 3
    } | ConvertTo-Json -Depth 10)

  $null = Invoke-RestMethod -Uri "$baseApiUrl/taxonomy/categories/$($category.id)/attributes" -Method Post -ContentType "application/json" -Body (@{
      key = "sleeve_length"
      name = "Sleeve Length"
      dataType = "text"
      required = $true
      appliesTo = "product"
    } | ConvertTo-Json)

  $templateV2 = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/templates" -Method Post -ContentType "application/json" -Body (@{
      tenantKey = $tenantKey
      categoryId = $category.id
      name = "Pilot Fashion Template"
      sourceFormat = "csv"
      mapping = @{
        title = "product_name"
        brand = "brand_name"
        description = "description"
        hsnCode = "hsn_code"
        gstRate = "gst_rate"
        attributes = "attributes"
      }
      chunkSize = 50
      maxRetries = 3
    } | ConvertTo-Json -Depth 10)

  $templates = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/templates?tenantKey=$tenantKey&categoryId=$($category.id)" -Method Get
  $v1Listed = $templates | Where-Object { $_.id -eq $templateV1.id } | Select-Object -First 1
  $v2Listed = $templates | Where-Object { $_.id -eq $templateV2.id } | Select-Object -First 1

  if ($templateV1.version -ne 1 -or $templateV2.version -ne 2) {
    throw "Template versioning validation failed."
  }
  if ($null -eq $v1Listed.compatibility -or $v1Listed.compatibility.compatible) {
    throw "Expected compatibility warning on v1 template."
  }
  if ($null -eq $v2Listed.compatibility -or -not $v2Listed.compatibility.compatible) {
    throw "Expected latest template to be compatible."
  }

  $goodCsv = @"
product_name,brand_name,description,hsn_code,gst_rate,attributes
Pilot Tee 1,PIM1,Pilot row 1,62046200,18,""{""""color"""":""""black"""",""""sleeve_length"""":""""half""""}""
Pilot Tee 2,PIM1,Pilot row 2,62046200,18,""{""""color"""":""""blue"""",""""sleeve_length"""":""""full""""}""
"@

  $goodJob = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs" -Method Post -ContentType "application/json" -Body (@{
      categoryId = $category.id
      sourceFormat = "csv"
      sourceName = "pilot-good.csv"
      csvContent = $goodCsv
      mapping = $templateV2.mapping
      chunkSize = 50
      maxRetries = 3
    } | ConvertTo-Json -Depth 10)

  $goodProcessed = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs/$($goodJob.id)/process" -Method Post -ContentType "application/json" -Body (@{
      chunkSize = 50
    } | ConvertTo-Json)
  if ($goodProcessed.status -ne "completed" -or $goodProcessed.successRows -lt 2) {
    throw "Pilot import success flow failed."
  }

  $badJob = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs" -Method Post -ContentType "application/json" -Body (@{
      categoryId = $category.id
      sourceFormat = "json"
      sourceName = "pilot-bad.json"
      rows = @(
        @{
          brand = "PIM1"
          description = "Missing title"
        }
      )
      chunkSize = 1
      maxRetries = 2
    } | ConvertTo-Json -Depth 10)

  $null = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/process" -Method Post -ContentType "application/json" -Body (@{
      chunkSize = 1
    } | ConvertTo-Json)
  $badSecond = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/process" -Method Post -ContentType "application/json" -Body (@{
      chunkSize = 1
    } | ConvertTo-Json)
  if ($badSecond.status -ne "dead_letter") {
    throw "Pilot dead-letter flow failed."
  }

  $errorReport = Invoke-WebRequest -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/error-report" -Method Get
  if (-not $errorReport.Content.Contains("dead_letter")) {
    throw "Pilot error report export validation failed."
  }

  $deadRows = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/rows?status=dead_letter&limit=10" -Method Get
  $null = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/rows/$($deadRows[0].id)/repair" -Method Post -ContentType "application/json" -Body (@{
      payload = @{
        title = "Recovered Pilot Product"
        hsnCode = "62046200"
        gstRate = 18
        attributes = @{
          sleeve_length = "half"
        }
      }
      requeue = $true
    } | ConvertTo-Json -Depth 10)
  $repaired = Invoke-RestMethod -Uri "$baseApiUrl/bulk-import/jobs/$($badJob.id)/rows/$($deadRows[0].id)/process" -Method Post -ContentType "application/json" -Body "{}"
  if ($repaired.status -ne "success") {
    throw "Pilot row repair flow failed."
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
    throw "Pilot bulk edit preview flow failed."
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
  if ($bulkEditApply.appliedCount -lt 2) {
    throw "Pilot bulk edit apply flow failed."
  }

  $result = [PSCustomObject]@{
    tenantKey = $tenantKey
    categoryId = $category.id
    templateV1 = $templateV1.id
    templateV2 = $templateV2.id
    templateV1Warnings = $v1Listed.compatibility.warnings.Count
    templateV2Compatible = $v2Listed.compatibility.compatible
    goodImportStatus = $goodProcessed.status
    goodImportSuccessRows = $goodProcessed.successRows
    deadLetterStatus = $badSecond.status
    errorReportOk = $true
    repairedStatus = $repaired.status
    bulkEditApplied = $bulkEditApply.appliedCount
    checkedAt = (Get-Date).ToString("s")
  }
  Write-Output ($result | ConvertTo-Json -Compress)
} finally {
  if ($null -ne $apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
}
