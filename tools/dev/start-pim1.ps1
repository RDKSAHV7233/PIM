param(
  [switch]$SkipCacheReset,
  [switch]$Foreground,
  [ValidateSet("start", "dev")]
  [string]$WebMode = "start"
)

$ErrorActionPreference = "Stop"

function Get-PortPids {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $lines = netstat -ano | Select-String -Pattern "LISTENING"
  $pids = @()
  foreach ($line in $lines) {
    $text = ($line.ToString() -replace "\s+", " ").Trim()
    if ($text -match "[:\.]$Port\s") {
      $parts = $text.Split(" ")
      $procId = [int]$parts[$parts.Length - 1]
      if (-not $pids.Contains($procId)) {
        $pids += $procId
      }
    }
  }
  return $pids
}

function Stop-PortListeners {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $pids = Get-PortPids -Port $Port
  foreach ($procId in $pids) {
    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
    } catch {
      Write-Host "Could not stop PID $procId on port ${Port}: $($_.Exception.Message)"
    }
  }
}

function Wait-ForPort {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port,
    [int]$TimeoutSeconds = 40
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $pids = Get-PortPids -Port $Port
    if ($pids.Count -gt 0) {
      return $pids[0]
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Port $Port did not become ready in $TimeoutSeconds seconds."
}

function Wait-ForHttp {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [int]$TimeoutSeconds = 40
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $response.StatusCode
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  throw "HTTP endpoint $Url did not become ready in $TimeoutSeconds seconds."
}

function Get-FileTail {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [int]$Lines = 40
  )

  if (-not (Test-Path $Path)) {
    return "<no log file>"
  }

  return (Get-Content -Path $Path -Tail $Lines -ErrorAction SilentlyContinue) -join [Environment]::NewLine
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$runLogs = Join-Path $repoRoot ".runlogs"
if (-not (Test-Path $runLogs)) {
  New-Item -Path $runLogs -ItemType Directory | Out-Null
}
$runId = [Guid]::NewGuid().ToString("N")

Stop-PortListeners -Port 3000
Stop-PortListeners -Port 4000

if (-not $SkipCacheReset -and $WebMode -eq "dev") {
  $nextDir = Join-Path $repoRoot "apps\web\.next"
  if (Test-Path $nextDir) {
    try {
      Remove-Item -Recurse -Force $nextDir -ErrorAction Stop
    } catch {
      Write-Host "Skipping .next cache reset: $($_.Exception.Message)"
    }
  }
}

if ($WebMode -eq "start") {
  $buildIdPath = Join-Path $repoRoot "apps\web\.next\BUILD_ID"
  if (-not (Test-Path $buildIdPath)) {
    Write-Host "No production build found. Building @pim1/web..."
    npm.cmd run build --workspace @pim1/web
    if ($LASTEXITCODE -ne 0) {
      throw "Web build failed. Run 'npm run build --workspace @pim1/web' and fix errors."
    }
  }
}

$apiOut = Join-Path $runLogs "api-dev-$runId.out.log"
$apiErr = Join-Path $runLogs "api-dev-$runId.err.log"
$webOut = Join-Path $runLogs "web-dev-$runId.out.log"
$webErr = Join-Path $runLogs "web-dev-$runId.err.log"

$apiProcess = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev:api" -WorkingDirectory $repoRoot -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr -PassThru

if ($WebMode -eq "dev") {
  $webProcess = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev:web" -WorkingDirectory $repoRoot -RedirectStandardOutput $webOut -RedirectStandardError $webErr -PassThru
} else {
  $webProcess = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "start", "--workspace", "@pim1/web" -WorkingDirectory $repoRoot -RedirectStandardOutput $webOut -RedirectStandardError $webErr -PassThru
}

try {
  $webPid = Wait-ForPort -Port 3000 -TimeoutSeconds 10
} catch {
  $portPid = (Get-PortPids -Port 3000 | Select-Object -First 1)
  if ($null -ne $portPid) {
    $webPid = $portPid
  } elseif ($null -ne $webProcess) {
    $webPid = $webProcess.Id
  }
  Write-Host "Web port probe timed out; continuing with HTTP health check."
}

try {
  $apiPid = Wait-ForPort -Port 4000 -TimeoutSeconds 10
} catch {
  $portPid = (Get-PortPids -Port 4000 | Select-Object -First 1)
  if ($null -ne $portPid) {
    $apiPid = $portPid
  } elseif ($null -ne $apiProcess) {
    $apiPid = $apiProcess.Id
  }
  Write-Host "API port probe timed out; continuing with HTTP health check."
}

$webStatus = $null
$apiStatus = $null
try {
  $webStatus = Wait-ForHttp -Url "http://localhost:3000" -TimeoutSeconds 20
  $apiStatus = Wait-ForHttp -Url "http://localhost:4000/api/health" -TimeoutSeconds 20
} catch {
  Write-Host "HTTP health checks failed."
  Write-Host "---- web stderr ----"
  Write-Host (Get-FileTail -Path $webErr)
  Write-Host "---- web stdout ----"
  Write-Host (Get-FileTail -Path $webOut)
  Write-Host "---- api stderr ----"
  Write-Host (Get-FileTail -Path $apiErr)
  Write-Host "---- api stdout ----"
  Write-Host (Get-FileTail -Path $apiOut)
  throw
}

[pscustomobject]@{
  status = "ready"
  webUrl = "http://localhost:3000"
  apiUrl = "http://localhost:4000/api"
  webHttpStatus = $webStatus
  apiHttpStatus = $apiStatus
  webPortPid = $webPid
  apiPortPid = $apiPid
  starterPids = @{
    web = $webProcess.Id
    api = $apiProcess.Id
  }
  logs = @{
    webOut = $webOut
    webErr = $webErr
    apiOut = $apiOut
    apiErr = $apiErr
  }
} | ConvertTo-Json -Depth 4

if ($Foreground) {
  Write-Host ""
  Write-Host "Foreground mode enabled. Press Ctrl+C to stop PIM1 services."
  try {
    Wait-Process -Id $webProcess.Id, $apiProcess.Id
  } finally {
    foreach ($proc in @($webProcess, $apiProcess)) {
      if ($null -ne $proc) {
        try {
          if (-not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction Stop
          }
        } catch {
        }
      }
    }
  }
}
