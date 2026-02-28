$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot

Write-Output "[1/4] Stop listeners on port 3000..."
$listeners = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
foreach ($listenerPid in $listeners) {
  try {
    Stop-Process -Id $listenerPid -Force -ErrorAction Stop
    Write-Output "  - stopped PID $listenerPid"
  } catch {
    Write-Output "  - PID $listenerPid already stopped"
  }
}

Write-Output "[2/4] Remove stale Next.js cache..."
$nextDir = Join-Path $repoRoot "apps\\web\\.next"
if (Test-Path $nextDir) {
  Remove-Item $nextDir -Recurse -Force
  Write-Output "  - removed $nextDir"
} else {
  Write-Output "  - no .next directory found"
}

Write-Output "[3/4] Verify dependencies..."
npm install | Out-Null
Write-Output "  - npm install done"

Write-Output "[4/4] Recovery complete. Start web:"
Write-Output "  npm run dev:web"
