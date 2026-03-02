$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot
$dotenvPath = Join-Path $repoRoot ".env"

function Get-DotEnvValue {
  param(
    [string]$Path,
    [string]$Key
  )
  if (-not (Test-Path $Path)) {
    return $null
  }
  $line = Select-String -Path $Path -Pattern "^\s*$Key\s*=\s*(.+)\s*$" | Select-Object -First 1
  if ($null -eq $line) {
    return $null
  }
  $value = $line.Matches[0].Groups[1].Value.Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    return $value.Substring(1, $value.Length - 2)
  }
  return $value
}

# Force a deterministic DB URL for this smoke run, even if the user profile
# has a stale DATABASE_URL value that dotenv would otherwise keep.
$databaseUrl = Get-DotEnvValue -Path $dotenvPath -Key "DATABASE_URL"
if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
  $databaseUrl = "postgresql://postgres:postgres@localhost:5432/pim1?schema=public"
}
[System.Environment]::SetEnvironmentVariable("DATABASE_URL", $databaseUrl, "Process")
$env:DATABASE_URL = $databaseUrl

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
      Invoke-RestMethod -Uri $Url -Method Get | Out-Null
      return
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  throw "API did not become healthy within $TimeoutSeconds seconds."
}

$apiProc = $null
$runLogs = Join-Path $repoRoot ".runlogs"
if (-not (Test-Path $runLogs)) {
  New-Item -Path $runLogs -ItemType Directory | Out-Null
}
$runId = [Guid]::NewGuid().ToString("N")
$apiOutLog = Join-Path $runLogs "api-connector-$runId.out.log"
$apiErrLog = Join-Path $runLogs "api-connector-$runId.err.log"
$port = Get-Random -Minimum 4100 -Maximum 4999
[System.Environment]::SetEnvironmentVariable("PORT", [string]$port, "Process")
$baseApiUrl = "http://127.0.0.1:$port/api"

try {
  $apiProc = Start-Process -FilePath "node" -ArgumentList "-r", "dotenv/config", "apps/api/dist/main.js", "dotenv_config_path=.env" -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $apiOutLog -RedirectStandardError $apiErrLog
  Wait-ForApi -Url "$baseApiUrl/health" -Process $apiProc -StdOutLog $apiOutLog -StdErrLog $apiErrLog

  $login = Invoke-RestMethod -Uri "$baseApiUrl/auth/login" -Method Post -ContentType "application/json" -Body (@{
      userId = "connector-smoke"
      tenantId = "default"
      role = "admin"
    } | ConvertTo-Json)
  $headers = @{ Authorization = "Bearer $($login.accessToken)" }

  $definitions = Invoke-RestMethod -Uri "$baseApiUrl/connectors/definitions" -Method Get -Headers $headers
  if ($definitions.Count -lt 3) {
    throw "Expected at least 3 connector definitions."
  }

  $smokeAlias = "smoke-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
  $install = Invoke-RestMethod -Uri "$baseApiUrl/connectors/amazon-in/install" -Method Post -Headers $headers -ContentType "application/json" -Body (@{
      accountAlias = $smokeAlias
    } | ConvertTo-Json)
  if ($install.status -ne "ACTIVE") {
    throw "Expected installed connector status ACTIVE."
  }

  $installed = Invoke-RestMethod -Uri "$baseApiUrl/connectors/installed?limit=50" -Method Get -Headers $headers
  if ($installed.items.Count -lt 1) {
    throw "Expected at least one installed connector."
  }

  $reconnect = Invoke-RestMethod -Uri "$baseApiUrl/connectors/$($install.id)/reconnect" -Method Post -Headers $headers -ContentType "application/json" -Body "{}"
  if ($reconnect.status -ne "ACTIVE") {
    throw "Expected reconnect status ACTIVE."
  }

  $uninstall = Invoke-RestMethod -Uri "$baseApiUrl/connectors/$($install.id)/uninstall" -Method Post -Headers $headers -ContentType "application/json" -Body "{}"
  if ($uninstall.status -ne "DISABLED") {
    throw "Expected uninstall status DISABLED."
  }

  Write-Output (@{
      definitions = $definitions.Count
      installStatus = $install.status
      listCount = $installed.items.Count
      reconnectStatus = $reconnect.status
      uninstallStatus = $uninstall.status
      checkedAt = (Get-Date).ToString("s")
    } | ConvertTo-Json -Compress)
} finally {
  if ($null -ne $apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
}
