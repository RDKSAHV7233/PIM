# ============================================================================
# stop-servers.ps1 — Kill any process occupying ports 3000 or 4000.
# Called at the top of start-local-dev.ps1 to ensure a clean port state
# before binding. Safe to call repeatedly (no-op when ports are free).
#
# Usage:
#   .\scripts\stop-servers.ps1                  # kills ports 3000 and 4000
#   .\scripts\stop-servers.ps1 -Ports @(4000)   # kills port 4000 only
# ============================================================================

param(
    [int[]]$Ports = @(3000, 4000)
)

foreach ($port in $Ports) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conn) {
        # Also check ESTABLISHED connections that may be holding the port
        $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
                Where-Object { $_.OwningProcess -ne 0 } |
                Select-Object -First 1
    }
    if ($conn) {
        $stalePid = ($conn | Select-Object -First 1).OwningProcess
        $proc = Get-Process -Id $stalePid -ErrorAction SilentlyContinue
        $procName = if ($proc) { $proc.ProcessName } else { "unknown" }
        Write-Host "  Port $port occupied by PID $stalePid ($procName) — stopping..." -ForegroundColor Yellow
        Stop-Process -Id $stalePid -Force -ErrorAction SilentlyContinue
        # Brief pause to allow the OS to release the socket.
        Start-Sleep -Milliseconds 500
        Write-Host "  Port $port released." -ForegroundColor Green
    } else {
        Write-Host "  Port $port is free." -ForegroundColor DarkGray
    }
}
