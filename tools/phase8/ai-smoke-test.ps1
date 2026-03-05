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
      [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim().Trim('"'), "Process")
    }
  }
}

function Wait-ForApi {
  param([string]$Url, [System.Diagnostics.Process]$Process, [int]$TimeoutSeconds = 90)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($null -ne $Process -and $Process.HasExited) { throw "API exited before health check." }
    try { Invoke-RestMethod -Uri $Url -Method Get | Out-Null; return } catch { Start-Sleep -Milliseconds 500 }
  }
  throw "API did not become healthy."
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
  $category = Invoke-RestMethod -Uri "$baseApiUrl/taxonomy/categories" -Method Post -ContentType "application/json" -Body (@{ name = "AI Smoke Category $ts" } | ConvertTo-Json)
  $product = Invoke-RestMethod -Uri "$baseApiUrl/catalog/products" -Method Post -ContentType "application/json" -Body (@{
      title = "linen summer shirt"
      brand = "PIM1"
      description = "blue regular fit shirt for men"
      categoryId = $category.id
      status = "draft"
    } | ConvertTo-Json)

  $titleSuggestion = Invoke-RestMethod -Uri "$baseApiUrl/auto-suggestions/products/$($product.id)/title-suggestion" -Method Get
  $attrSuggestion = Invoke-RestMethod -Uri "$baseApiUrl/auto-suggestions/products/$($product.id)/attribute-enrichment" -Method Get
  $categorySuggestion = Invoke-RestMethod -Uri "$baseApiUrl/auto-suggestions/products/$($product.id)/category-suggestion" -Method Get
  $repair = Invoke-RestMethod -Uri "$baseApiUrl/auto-suggestions/products/$($product.id)/repair" -Method Post -ContentType "application/json" -Body (@{
      apply = $true
    } | ConvertTo-Json)
  $updated = Invoke-RestMethod -Uri "$baseApiUrl/catalog/products/$($product.id)" -Method Get

  if (-not $titleSuggestion.optimizedTitle) { throw "Missing AI title suggestion." }
  if (-not $repair.apply) { throw "Expected repair apply=true result." }

  $result = [PSCustomObject]@{
    productId = $product.id
    optimizedTitle = $titleSuggestion.optimizedTitle
    suggestedAttributeCount = ($attrSuggestion.suggestedAttributes.PSObject.Properties | Measure-Object).Count
    suggestedCategory = $categorySuggestion.suggestedCategoryId
    updatedTitle = $updated.title
    checkedAt = (Get-Date).ToString("s")
  }
  Write-Output ($result | ConvertTo-Json -Compress)
} finally {
  Disable-SmokeAuthDefaults
  if ($null -ne $apiProc -and -not $apiProc.HasExited) { Stop-Process -Id $apiProc.Id -Force }
}
