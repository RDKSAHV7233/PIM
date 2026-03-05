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
  $definitions = Invoke-RestMethod -Uri "$baseApiUrl/connectors/definitions" -Method Get
  foreach ($definition in $definitions) {
    try {
      $null = Invoke-RestMethod -Uri "$baseApiUrl/connectors/$($definition.slug)/install" -Method Post -ContentType "application/json" -Body (@{
          accountAlias = "phase3-$ts-$($definition.slug)"
        } | ConvertTo-Json)
    } catch {
      # Ignore already-installed/duplicate alias errors; smoke run only requires at least one active installation per connector.
    }
  }

  $category = Invoke-RestMethod -Uri "$baseApiUrl/taxonomy/categories" -Method Post -ContentType "application/json" -Body (@{
      name = "Phase3 Category $ts"
    } | ConvertTo-Json)

  $product = Invoke-RestMethod -Uri "$baseApiUrl/catalog/products" -Method Post -ContentType "application/json" -Body (@{
      title       = "Phase3 Product $ts"
      description = "Marketplace simulation smoke test"
      brand       = "PIM1"
      categoryId  = $category.id
      status      = "draft"
      attributes  = @{}
    } | ConvertTo-Json -Depth 5)

  $simulationBefore = Invoke-RestMethod -Uri "$baseApiUrl/marketplace/products/$($product.id)/simulate?channel=amazon" -Method Get
  if ($simulationBefore.missingFields.Count -lt 2) {
    throw "Expected marketplace simulator to detect missing fields before compliance fixes."
  }

  $template = Invoke-RestMethod -Uri "$baseApiUrl/marketplace/categories/$($category.id)/templates" -Method Post -ContentType "application/json" -Body (@{
      name           = "Amazon Template $ts"
      channel        = "amazon"
      requiredFields = @("title", "brand", "description", "hsnCode", "gstRate", "attributes.color", "attributes.material")
      fieldMap       = @{
        title               = "item_name"
        brand               = "brand_name"
        description         = "product_description"
        hsnCode             = "hsn_code"
        gstRate             = "tax_rate"
        "attributes.color"  = "color_name"
        "attributes.material" = "material_type"
      }
      isDefault      = $true
    } | ConvertTo-Json -Depth 10)

  $templates = Invoke-RestMethod -Uri "$baseApiUrl/marketplace/categories/$($category.id)/templates?channel=amazon" -Method Get
  if ($templates.Count -lt 1) {
    throw "Expected saved mapping template to be listed."
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
        color    = "black"
        material = "cotton"
        size     = "M"
      }
    } | ConvertTo-Json -Depth 6)

  $simAmazon = Invoke-RestMethod -Uri "$baseApiUrl/marketplace/products/$($product.id)/simulate?channel=amazon" -Method Get
  $simAmazonTemplate = Invoke-RestMethod -Uri "$baseApiUrl/marketplace/products/$($product.id)/simulate?channel=amazon&templateId=$($template.id)" -Method Get
  $simFlipkart = Invoke-RestMethod -Uri "$baseApiUrl/marketplace/products/$($product.id)/simulate?channel=flipkart" -Method Get
  $simMeesho = Invoke-RestMethod -Uri "$baseApiUrl/marketplace/products/$($product.id)/simulate?channel=meesho" -Method Get

  if ($simAmazon.missingFields.Count -ne 0 -or -not $simAmazon.exportReady) {
    throw "Amazon simulation expected exportReady with zero missing fields."
  }
  if ($simAmazonTemplate.missingFields.Count -ne 0 -or -not $simAmazonTemplate.exportReady) {
    throw "Amazon template simulation expected exportReady with zero missing fields."
  }
  if ($simFlipkart.missingFields.Count -ne 0 -or -not $simFlipkart.exportReady) {
    throw "Flipkart simulation expected exportReady with zero missing fields."
  }
  if ($simMeesho.missingFields.Count -ne 0 -or -not $simMeesho.exportReady) {
    throw "Meesho simulation expected exportReady with zero missing fields."
  }

  $goodJob = Invoke-RestMethod -Uri "$baseApiUrl/marketplace/products/$($product.id)/export-jobs" -Method Post -ContentType "application/json" -Body (@{
      channel    = "amazon"
      templateId = $template.id
      maxRetries = 3
    } | ConvertTo-Json -Depth 5)
  $goodJobProcessed = Invoke-RestMethod -Uri "$baseApiUrl/marketplace/export-jobs/$($goodJob.id)/process" -Method Post -ContentType "application/json" -Body "{}"
  if ($goodJobProcessed.status -ne "completed") {
    throw "Expected compliant export job to complete."
  }

  $badProduct = Invoke-RestMethod -Uri "$baseApiUrl/catalog/products" -Method Post -ContentType "application/json" -Body (@{
      title       = "Phase3 Bad Product $ts"
      description = "For retry and DLQ checks"
      brand       = "PIM1"
      categoryId  = $category.id
      status      = "draft"
      attributes  = @{}
    } | ConvertTo-Json -Depth 5)

  $badJob = Invoke-RestMethod -Uri "$baseApiUrl/marketplace/products/$($badProduct.id)/export-jobs" -Method Post -ContentType "application/json" -Body (@{
      channel    = "amazon"
      templateId = $template.id
      maxRetries = 2
    } | ConvertTo-Json -Depth 5)

  $badJobFirst = Invoke-RestMethod -Uri "$baseApiUrl/marketplace/export-jobs/$($badJob.id)/process" -Method Post -ContentType "application/json" -Body "{}"
  if ($badJobFirst.status -ne "retrying") {
    throw "Expected bad export job to move to retrying on first process."
  }
  $badJobSecond = Invoke-RestMethod -Uri "$baseApiUrl/marketplace/export-jobs/$($badJob.id)/process" -Method Post -ContentType "application/json" -Body "{}"
  if ($badJobSecond.status -ne "dead_letter") {
    throw "Expected bad export job to move to dead_letter after max retries."
  }
  $badJobRequeued = Invoke-RestMethod -Uri "$baseApiUrl/marketplace/export-jobs/$($badJob.id)/requeue" -Method Post -ContentType "application/json" -Body "{}"
  if ($badJobRequeued.status -ne "queued") {
    throw "Expected dead_letter job to be requeued."
  }

  $productJobs = Invoke-RestMethod -Uri "$baseApiUrl/marketplace/export-jobs?productId=$($product.id)" -Method Get
  if ($productJobs.Count -lt 1) {
    throw "Expected export jobs list to return at least one job."
  }

  $result = [PSCustomObject]@{
    productId          = $product.id
    riskBefore         = $simulationBefore.riskScore
    riskAfterAmazon    = $simAmazon.riskScore
    riskAfterFlipkart  = $simFlipkart.riskScore
    riskAfterMeesho    = $simMeesho.riskScore
    missingBefore      = $simulationBefore.missingFields.Count
    missingAfterAmazon = $simAmazon.missingFields.Count
    templateSaved      = $template.id
    goodJobStatus      = $goodJobProcessed.status
    badJobFirstStatus  = $badJobFirst.status
    badJobSecondStatus = $badJobSecond.status
    badJobRequeued     = $badJobRequeued.status
    checkedAt          = (Get-Date).ToString("s")
  }
  Write-Output ($result | ConvertTo-Json -Compress)
} finally {
  Disable-SmokeAuthDefaults
  if ($null -ne $apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
}
