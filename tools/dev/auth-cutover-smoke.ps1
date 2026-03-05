$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot

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
      Invoke-RestMethod -Uri $Url -Method Get | Out-Null
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
      [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim().Trim('"'), "Process")
    }
  }
}

function Require-Ok {
  param(
    [bool]$Condition,
    [string]$Message
  )
  if (-not $Condition) {
    throw $Message
  }
}

function Get-BearerToken {
  param(
    [string]$BaseApiUrl
  )

  $login = Invoke-RestMethod -Uri "$BaseApiUrl/auth/login" -Method Post -ContentType "application/json" -Body (@{
      userId = "smoke-admin"
      tenantId = "default"
      role = "admin"
      expiresInMinutes = 30
    } | ConvertTo-Json)
  Require-Ok -Condition ($null -ne $login.accessToken -and $login.accessToken.Length -gt 20) -Message "Login did not return a usable JWT."
  return $login.accessToken
}

Load-EnvFile -Path (Join-Path $repoRoot ".env")

$apiProc = $null
$port = Get-Random -Minimum 4100 -Maximum 4999
[System.Environment]::SetEnvironmentVariable("PORT", [string]$port, "Process")
$baseApiUrl = "http://127.0.0.1:$port/api/v1"
try {
  $apiProc = Start-Process -FilePath "node" -ArgumentList "apps/api/dist/main.js" -WorkingDirectory $repoRoot -PassThru
  Wait-ForApi -Url "$baseApiUrl/health" -Process $apiProc

  $token = Get-BearerToken -BaseApiUrl $baseApiUrl
  $headers = @{
    Authorization = "Bearer $token"
    "x-pim-tenant" = "tenant-should-be-ignored"
  }

  $health = Invoke-RestMethod -Uri "$baseApiUrl/health" -Method Get
  Require-Ok -Condition ($health.status -eq "ok") -Message "Health endpoint failed."

  $stats = Invoke-RestMethod -Uri "$baseApiUrl/catalog/stats" -Method Get -Headers $headers
  Require-Ok -Condition ($null -ne $stats.products) -Message "Expected catalog stats with JWT auth."

  $legacyDisabledValue = $env:PIM_ALLOW_LEGACY_HEADERS
  Write-Output (@{
      baseApiUrl = $baseApiUrl
      tokenIssued = $true
      jwtCatalogStats = "ok"
      note = "For strict cutover, set PIM_ALLOW_LEGACY_HEADERS=false and verify header-only requests fail with 401/403."
      currentLegacyFlag = if ($legacyDisabledValue) { $legacyDisabledValue } else { "unset(default=true)" }
      checkedAt = (Get-Date).ToString("s")
    } | ConvertTo-Json -Compress)
} finally {
  if ($null -ne $apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
}
