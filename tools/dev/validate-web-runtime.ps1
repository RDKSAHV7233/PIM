$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot

& (Join-Path $PSScriptRoot "recover-web-runtime.ps1")

$runlogDir = Join-Path $repoRoot ".runlogs"
if (-not (Test-Path $runlogDir)) {
  New-Item -ItemType Directory -Path $runlogDir | Out-Null
}

$apiProc = $null
$webProc = $null
try {
  $apiBaseCandidates = @()
  if ($env:PIM_API_BASE_URL) {
    $apiBaseCandidates += $env:PIM_API_BASE_URL.Trim()
  }
  $envFile = Join-Path $repoRoot ".env"
  if (Test-Path $envFile) {
    $envText = Get-Content -Raw $envFile
    $match = [regex]::Match($envText, 'PIM_API_BASE_URL\s*=\s*"?([^"\r\n]+)"?')
    if ($match.Success) {
      $apiBaseCandidates += $match.Groups[1].Value.Trim()
    }
  }
  $apiBaseCandidates += "http://127.0.0.1:4000/api"
  $apiBaseCandidates += "http://127.0.0.1:3001/api"
  $apiBaseUrl = ($apiBaseCandidates | Where-Object { $_ } | Select-Object -Unique | Select-Object -First 1)
  $apiHealthUrl = "$apiBaseUrl/health"

  $apiOut = Join-Path $runlogDir "validate-api.out.log"
  $apiErr = Join-Path $runlogDir "validate-api.err.log"
  $webOut = Join-Path $runlogDir "validate-web.out.log"
  $webErr = Join-Path $runlogDir "validate-web.err.log"

  $apiProc = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev:api" -WorkingDirectory $repoRoot -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr -PassThru

  $apiDeadline = (Get-Date).AddSeconds(90)
  $apiReady = $false
  while ((Get-Date) -lt $apiDeadline) {
    if ($apiProc.HasExited) {
      throw "API dev process exited early. See $apiErr"
    }
    try {
      $apiResponse = Invoke-WebRequest -Uri $apiHealthUrl -UseBasicParsing -TimeoutSec 3
      if ($apiResponse.StatusCode -eq 200) {
        $apiReady = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 700
    }
  }
  if (-not $apiReady) {
    throw "API runtime did not become healthy ($apiHealthUrl) within timeout. See $apiErr"
  }

  $webProc = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev:web" -WorkingDirectory $repoRoot -RedirectStandardOutput $webOut -RedirectStandardError $webErr -PassThru
  $deadline = (Get-Date).AddSeconds(210)
  $ok = $false
  $sandboxBlocked = $false
  while ((Get-Date) -lt $deadline) {
    if ($webProc.HasExited) {
      $webErrorText = ""
      if (Test-Path $webErr) {
        $webErrorText = Get-Content -Raw $webErr
      }
      if ($webErrorText -match "spawn EPERM") {
        $sandboxBlocked = $true
        break
      }
      throw "Web dev process exited early. See $webErr"
    }
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:3000" -UseBasicParsing -TimeoutSec 45
      if ($response.StatusCode -eq 200) {
        $ok = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 1200
    }
  }
  if (-not $ok) {
    if ($sandboxBlocked) {
      Write-Output '{"runtimeRecovery":"blocked","status":"sandbox-spawn-eperm","port":3000,"action":"run validate-web-runtime.ps1 on local workstation shell"}'
      return
    }
    throw "Web runtime did not become healthy on port 3000 within timeout. See $webErr"
  }
  Write-Output '{"runtimeRecovery":"pass","port":3000,"status":"healthy"}'
} finally {
  if ($null -ne $webProc -and -not $webProc.HasExited) {
    Stop-Process -Id $webProc.Id -Force
  }
  if ($null -ne $apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
  $portsToClean = @(3000, 4000)
  foreach ($port in $portsToClean) {
    $listenerPids = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($listenerPid in $listenerPids) {
      try {
        Stop-Process -Id $listenerPid -Force -ErrorAction Stop
      } catch {
      }
    }
  }
}
