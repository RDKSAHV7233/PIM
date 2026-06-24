# ============================================================================
# stop-servers.ps1 - Kill any process occupying ports 3000 or 4000.
# Called by start-local-dev.ps1 to ensure a clean port state before binding.
# Safe to call repeatedly.
#
# Usage:
#   .\scripts\stop-servers.ps1                # kills ports 3000 and 4000
#   .\scripts\stop-servers.ps1 -Ports @(4000) # kills port 4000 only
# ============================================================================

param(
    [int[]]$Ports = @(3000, 4000)
)

foreach ($port in $Ports) {
    $connection = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
        Where-Object { $_.State -eq "Listen" -or $_.OwningProcess -ne 0 } |
        Select-Object -First 1

    if ($connection) {
        $processId = $connection.OwningProcess
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        $processName = if ($process) { $process.ProcessName } else { "unknown" }
        Write-Host "  Port $port occupied by PID $processId ($processName) - stopping..." -ForegroundColor Yellow
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
        Write-Host "  Port $port released." -ForegroundColor Green
    } else {
        Write-Host "  Port $port is free." -ForegroundColor DarkGray
    }
}
