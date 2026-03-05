$ErrorActionPreference = "Stop"
Set-Location "C:\Users\Om Computers\PIM1"
if (Test-Path ".env") {
  Get-Content ".env" | ForEach-Object {
    if ($_ -match "^\s*#" -or $_ -match "^\s*$") { return }
    $parts = $_.Split("=", 2)
    if ($parts.Length -eq 2) {
      [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim().Trim('"'), "Process")
    }
  }
}
$env:JWT_BLOCKLIST_REDIS_DISABLED = "true"
if (-not $env:DATABASE_URL_POOLED) { $env:DATABASE_URL_POOLED = $env:DATABASE_URL }
if (-not $env:DATABASE_URL_DIRECT) { $env:DATABASE_URL_DIRECT = $env:DATABASE_URL }
if (-not $env:JWT_SECRET) { $env:JWT_SECRET = "pim1-local-dev-jwt-secret-minimum-length-32" }
if (-not $env:CREDENTIAL_ENCRYPTION_KEY_V1) { $env:CREDENTIAL_ENCRYPTION_KEY_V1 = "pim1-local-encryption-key-v1-minimum-32" }
if (-not $env:CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION) { $env:CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1" }
if (-not $env:R2_ACCOUNT_ID) { $env:R2_ACCOUNT_ID = "local" }
if (-not $env:R2_ACCESS_KEY_ID) { $env:R2_ACCESS_KEY_ID = "local" }
if (-not $env:R2_SECRET_ACCESS_KEY) { $env:R2_SECRET_ACCESS_KEY = "local" }
if (-not $env:R2_BUCKET_NAME) { $env:R2_BUCKET_NAME = "local" }
if (-not $env:R2_PUBLIC_URL) { $env:R2_PUBLIC_URL = "https://example.com" }
if (-not $env:APP_ENV) { $env:APP_ENV = "development" }
if (-not $env:FEATURE_REAL_SPAPI_VALIDATION) { $env:FEATURE_REAL_SPAPI_VALIDATION = "false" }
$port = 4777
$env:PORT = [string]$port
$p = Start-Process node -ArgumentList "apps/api/dist/main.js" -PassThru -RedirectStandardOutput "seq-out.log" -RedirectStandardError "seq-err.log"
Start-Sleep -Seconds 4
try {
  $base = "http://127.0.0.1:$port/api/v1"
  $runId = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $tenantA = "seq-a-$runId"
  $tenantB = "seq-b-$runId"
  $aLogin = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{userId="u-a";tenantId=$tenantA;role="admin";expiresInMinutes=30}|ConvertTo-Json)
  $bLogin = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{userId="u-b";tenantId=$tenantB;role="admin";expiresInMinutes=30}|ConvertTo-Json)
  $hA = @{ Authorization = "Bearer $($aLogin.accessToken)" }
  $hB = @{ Authorization = "Bearer $($bLogin.accessToken)" }
  $nameA = "SEQ A $runId"
  $nameB = "SEQ B $runId"
  Invoke-RestMethod -Uri "$base/taxonomy/categories" -Headers $hA -Method Post -ContentType "application/json" -Body (@{name=$nameA}|ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Uri "$base/taxonomy/categories" -Headers $hB -Method Post -ContentType "application/json" -Body (@{name=$nameB}|ConvertTo-Json) | Out-Null
  $listA = Invoke-RestMethod -Uri "$base/taxonomy/categories" -Headers $hA -Method Get
  $listB = Invoke-RestMethod -Uri "$base/taxonomy/categories" -Headers $hB -Method Get
  $result = [PSCustomObject]@{
    tenantAHasA = [bool]($listA | Where-Object { $_.name -eq $nameA })
    tenantAHasB = [bool]($listA | Where-Object { $_.name -eq $nameB })
    tenantBHasA = [bool]($listB | Where-Object { $_.name -eq $nameA })
    tenantBHasB = [bool]($listB | Where-Object { $_.name -eq $nameB })
    tenantA = $tenantA
    tenantB = $tenantB
  }
  Write-Output ($result | ConvertTo-Json -Compress)
} finally {
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
}
